/**
 * Northstar RV-N2 — model-neutral LLM mapping seam for programme intake.
 *
 * Two mappings, following the same `SemanticExtractionClient` discipline from
 * src/ingest/semantic.ts:
 *   - mapRosterWithModel:  traveller list -> ProgrammeTravellerDrafts
 *   - mapEventBriefWithModel: event brief -> structured event + policy clauses
 *
 * Schemas are strict. Invalid model output (bad JSON or schema violation) is
 * returned as `{ ok: false, reason }` — there is no repair/guessing pass.
 * Validated output is converted to drafts/unresolved statements with the
 * same anti-fabrication discipline as the row adapters: missing fields stay
 * missing, commitment titles stay as notes + unresolved statements (ids are
 * assigned only at promotion).
 */
import { z } from 'zod';
import { AnchorEventKindSchema } from '../domain/entities.ts';
import type { ProgrammeTravellerDraft } from '../contracts/programmeIntake.ts';
import type { ChatMessage, CompletionRequest, CompletionResponse } from '../intelligence/client.ts';
import type { IsoDateTime } from '../domain/common.ts';

export interface ModelClientLike {
  complete(request: CompletionRequest, timeoutMs: number): Promise<CompletionResponse>;
}

const DEFAULT_MODEL = 'qwen-flash';
const DEFAULT_TIMEOUT_MS = 30_000;

const RosterTravellerSchema = z.strictObject({
  displayName: z.string(),
  email: z.string().optional(),
  phoneE164: z.string().optional(),
  dateOfBirth: z.string().optional(),
  nationalityCodes: z.array(z.string()).optional(),
  homeLocationText: z.string().optional(),
  accessibilityStatements: z.array(z.string()).optional(),
  notes: z.array(z.string()).optional(),
  commitmentTitles: z.array(z.string()).optional(),
});

export const RosterMappingOutputSchema = z.strictObject({
  travellers: z.array(RosterTravellerSchema).default([]),
  unresolvedStatements: z.array(z.string()).default([]),
});
export type RosterMappingOutput = z.infer<typeof RosterMappingOutputSchema>;

export const EventBriefOutputSchema = z.strictObject({
  eventName: z.string().optional(),
  eventKind: AnchorEventKindSchema.optional(),
  venueName: z.string().optional(),
  venueTimezone: z.string().optional(),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
  organiserName: z.string().optional(),
  instructions: z.string().optional(),
  policyClauses: z
    .array(
      z.strictObject({
        kind: z.string(),
        statement: z.string(),
        windowStart: z.string().optional(),
        windowEnd: z.string().optional(),
        amount: z.number().optional(),
        currency: z.string().optional(),
        approver: z.string().optional(),
      }),
    )
    .default([]),
});
export type EventBriefOutput = z.infer<typeof EventBriefOutputSchema>;

export type RosterMappingResult =
  | { ok: true; drafts: ProgrammeTravellerDraft[]; unresolvedStatements: string[] }
  | { ok: false; reason: string };

export type EventBriefResult =
  | { ok: true; value: EventBriefOutput }
  | { ok: false; reason: string };

const ROSTER_SYSTEM_PROMPT = [
  'You extract traveller roster data from free-form event intake text.',
  'Return a single JSON object with two top-level keys: "travellers" and "unresolvedStatements".',
  'Rules:',
  '  - Preserve every explicit statement verbatim. Do not paraphrase names or emails.',
  '  - Mark unknown fields as absent (omit the key). Never invent airports, nationalities, passports, dates, or bookings.',
  '  - "commitmentTitles" holds free-text titles only; never invent commitment ids.',
  '  - "unresolvedStatements" collects anything you could not cleanly attribute to a single traveller (group statements, ambiguous rows, "and guest" with no name).',
  '  - Do not wrap the JSON in prose, code fences, or commentary.',
].join('\n');

const EVENT_BRIEF_SYSTEM_PROMPT = [
  'You extract structured event + policy-clause data from a free-form event brief.',
  'Return a single JSON object with the keys defined below.',
  'Rules:',
  '  - Preserve explicit values verbatim. Never invent airports, dates, currencies, amounts, or approver names.',
  '  - Omit any key whose value is not explicitly stated.',
  '  - policyClauses[].kind must be a short UPPER_SNAKE_CASE label (e.g. FUNDED_WINDOW, SPEND_LIMIT, APPROVAL_ABOVE_SPEND, CHANGE_TERMS, CANCELLATION_TERMS). Unrecognised clauses still appear with a descriptive kind, but the deterministic adapter will reject them.',
  '  - Do not wrap the JSON in prose, code fences, or commentary.',
].join('\n');

function safeParseJson(text: string): unknown | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  const candidates: string[] = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1] !== undefined) candidates.push(fenced[1].trim());
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }
  for (const c of candidates) {
    try {
      return JSON.parse(c) as unknown;
    } catch {
      // try next
    }
  }
  return undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const v of value) {
    if (typeof v === 'string' && v.trim().length > 0) out.push(v.trim());
  }
  return out;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  return t.length > 0 ? t : undefined;
}

function asStringArrayOrEmpty(value: unknown): string[] {
  return asStringArray(value) ?? [];
}

function cleanPhone(value: string): string {
  const trimmed = value.trim();
  const cleaned = trimmed.replace(/[ \-()]/g, '');
  if (cleaned.startsWith('+')) {
    return '+' + cleaned.slice(1).replace(/[^\d]/g, '');
  }
  return cleaned.replace(/[^\d]/g, '');
}

function buildRosterMessages(input: { content: string; at: IsoDateTime }): ChatMessage[] {
  return [
    { role: 'system', content: ROSTER_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Reference time: ${input.at}\n\nIntake content:\n${input.content}`,
    },
  ];
}

function buildEventBriefMessages(input: { content: string; at: IsoDateTime }): ChatMessage[] {
  return [
    { role: 'system', content: EVENT_BRIEF_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Reference time: ${input.at}\n\nEvent brief:\n${input.content}`,
    },
  ];
}

/**
 * Map a free-form roster description into ProgrammeTravellerDrafts.
 * commitmentTitles are kept as notes and surfaced as unresolved statements
 * because authoritative commitment ids are assigned at promotion, never
 * invented here.
 */
export async function mapRosterWithModel(
  client: ModelClientLike,
  input: { content: string; at: IsoDateTime },
): Promise<RosterMappingResult> {
  let response: CompletionResponse;
  try {
    response = await client.complete(
      {
        model: DEFAULT_MODEL,
        messages: buildRosterMessages(input),
        responseFormat: 'json_object',
      },
      DEFAULT_TIMEOUT_MS,
    );
  } catch (err) {
    return { ok: false, reason: `model transport failure: ${(err as Error).message}` };
  }
  const parsed = safeParseJson(response.contentText);
  if (parsed === undefined) {
    return { ok: false, reason: 'model output was not valid JSON' };
  }
  const validated = RosterMappingOutputSchema.safeParse(parsed);
  if (!validated.success) {
    const issues = validated.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    return { ok: false, reason: `model output failed schema validation: ${issues.join('; ')}` };
  }
  const value = validated.data;
  const drafts: ProgrammeTravellerDraft[] = [];
  const modelUnresolved: string[] = [...value.unresolvedStatements];
  value.travellers.forEach((traveller, index) => {
    const displayName = traveller.displayName.trim();
    if (displayName === '') {
      modelUnresolved.push(`traveller[${index}]: blank displayName dropped`);
      return;
    }
    const identity: ProgrammeTravellerDraft['identity'] = {};
    const email = asString(traveller.email);
    if (email !== undefined) identity.email = email;
    const phone = asString(traveller.phoneE164);
    if (phone !== undefined) {
      const cleaned = cleanPhone(phone);
      if (cleaned.length > 0) identity.phoneE164 = cleaned;
    }
    const dob = asString(traveller.dateOfBirth);
    if (dob !== undefined) identity.dateOfBirth = dob;
    const draftId = `llm-${index + 1}`;
    const notes: string[] = [];
    const accessibility = asStringArrayOrEmpty(traveller.accessibilityStatements);
    const inputNotes = asStringArrayOrEmpty(traveller.notes);
    const titles = asStringArrayOrEmpty(traveller.commitmentTitles);
    if (titles.length > 0) {
      notes.push(...titles.map((t) => `commitment title: ${t}`));
      modelUnresolved.push(
        `traveller[${draftId}]: commitment titles cannot be promoted without ids: ${titles.join(' | ')}`,
      );
    }
    const nationality = asStringArray(traveller.nationalityCodes) ?? [];
    const home = asString(traveller.homeLocationText);
    const draft: ProgrammeTravellerDraft = {
      draftId,
      displayName,
      identity,
      nationalityCodes: nationality,
      accessibilityStatements: accessibility,
      notes: [...inputNotes, ...notes],
      anchorCommitmentIds: [],
    };
    if (home !== undefined) draft.homeLocationText = home;
    drafts.push(draft);
  });
  return { ok: true, drafts, unresolvedStatements: modelUnresolved };
}

/**
 * Map a free-form event brief into a structured event + policy clauses.
 * The clauses here are not yet executable rules — they pass through to
 * `recognizedPolicyClausesToRuleSet` which performs the deterministic
 * vocabulary / temporal normalization.
 */
export async function mapEventBriefWithModel(
  client: ModelClientLike,
  input: { content: string; at: IsoDateTime },
): Promise<EventBriefResult> {
  let response: CompletionResponse;
  try {
    response = await client.complete(
      {
        model: DEFAULT_MODEL,
        messages: buildEventBriefMessages(input),
        responseFormat: 'json_object',
      },
      DEFAULT_TIMEOUT_MS,
    );
  } catch (err) {
    return { ok: false, reason: `model transport failure: ${(err as Error).message}` };
  }
  const parsed = safeParseJson(response.contentText);
  if (parsed === undefined) {
    return { ok: false, reason: 'model output was not valid JSON' };
  }
  const validated = EventBriefOutputSchema.safeParse(parsed);
  if (!validated.success) {
    const issues = validated.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    return { ok: false, reason: `model output failed schema validation: ${issues.join('; ')}` };
  }
  return { ok: true, value: validated.data };
}

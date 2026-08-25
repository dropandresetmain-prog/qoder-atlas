/**
 * DR-5 — Traveller natural-language change intake.
 *
 * Converts traveller NL text into a validated ChangeRequest proposal. The
 * interpreter NEVER mutates state and NEVER executes provider actions: output
 * is a proposal object only; mutating resolution must flow through the
 * existing deterministic changeRequest.ts path.
 *
 * Two paths:
 * 1. Model path: when ModelStudioClient is configured and not in REPLAY, call
 *    it with a strict system prompt (schema-first, closed vocabularies, single
 *    bare JSON object) and zod-validate the response; validation failure =>
 *    fail closed, never guess.
 * 2. Deterministic path (credential-free default): model-free interpreter that
 *    handles supported request families via explicit patterns. Ambiguous/
 *    unsupported text => fail closed with a clarification request (structured
 *    uncertainty), never invented details.
 */
import { z } from 'zod';
import {
  ChangeRequestSchema,
  type ChangeRequest,
  type ResolutionTarget,
  type ChangeRequestIntentKind,
  type ChangeRequestUrgency,
} from '../contracts/changeRequest.ts';
import {
  EntityIdSchema,
  IsoDateTimeSchema,
  type IsoDateTime,
  type UncertaintyRecord,
} from '../domain/common.ts';
import type { ModelStudioClient, ModelTask } from '../intelligence/client.ts';
import {
  resolveChangeRequest,
  type ChangeRequestDeps,
  type ChangeRequestResolveOutcome,
} from './changeRequest.ts';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export interface ChangeIntakeDeps {
  /** Optional model client for the LLM path. Absent = deterministic only. */
  modelClient?: ModelStudioClient;
}

export interface ChangeIntakeInput {
  travellerId: string;
  tripId?: string;
  text: string;
  at: string;
}

export interface ChangeIntakeResult {
  ok: boolean;
  /** Validated ChangeRequest proposal when ok=true. */
  proposal?: ChangeRequest;
  /** Structured uncertainty when ok=false (clarification needed). */
  uncertainties?: UncertaintyRecord[];
  /** 'MODEL' = LLM path; 'DETERMINISTIC' = pattern-based. */
  provenance: 'MODEL' | 'DETERMINISTIC';
  /** Human-readable clarification request when ok=false. */
  clarificationNeeded?: string;
}

/**
 * Interpret traveller NL text as a validated ChangeRequest proposal. The
 * interpreter never mutates state; it produces a proposal object only.
 * Mutating resolution flows through resolveChangeRequest.
 */
export async function interpretChangeRequest(
  deps: ChangeIntakeDeps,
  input: ChangeIntakeInput,
): Promise<ChangeIntakeResult> {
  // Model path: when configured and not in REPLAY, use the LLM.
  if (deps.modelClient && deps.modelClient.isConfigured() && deps.modelClient.mode === 'LIVE') {
    return interpretViaModel(deps.modelClient, input);
  }
  // Deterministic path: pattern-based interpreter (credential-free default).
  return interpretDeterministic(input);
}

/**
 * Hand the validated proposal to the existing resolver. Proves the same
 * resolver consumes NL-derived and structured requests identically.
 */
export async function proposeThenResolve(
  deps: ChangeIntakeDeps & ChangeRequestDeps,
  input: ChangeIntakeInput,
): Promise<{ intake: ChangeIntakeResult; resolution?: ChangeRequestResolveOutcome }> {
  const intake = await interpretChangeRequest(deps, input);
  if (!intake.ok || !intake.proposal) {
    return { intake };
  }
  const resolution = await resolveChangeRequest(
    {
      trips: deps.trips,
      entities: deps.entities,
      signals: deps.signals,
      cases: deps.cases,
      audit: deps.audit,
    },
    { request: intake.proposal, at: input.at as IsoDateTime },
  );
  return { intake, resolution };
}

// ---------------------------------------------------------------------------
// Model path
// ---------------------------------------------------------------------------

const CHANGE_INTAKE_SYSTEM_PROMPT = `You interpret traveller natural-language change requests into structured ChangeRequest proposals.
Respond with a single JSON object and nothing else (no prose, no markdown, no code fences).
Extract only what the traveller actually states; never invent values.
Your JSON must match this schema EXACTLY (strict objects, no extra keys):

{
  "intentKind": one of ADJUST_TRIP_WINDOW | CHANGE_TRANSPORT_SCHEDULE | CHANGE_STAY | CANCEL_BOOKING | ADJUST_OBJECTIVE | OTHER (required);
  "urgency": one of HARD_INSTRUCTION | SOFT_PREFERENCE (required);
  "target": {
    "arriveBy"?: ISO-8601 timestamp with UTC offset (optional);
    "departAfter"?: ISO-8601 timestamp with UTC offset (optional);
    "departureOrigin"?: { "system": "airport-code", "value": string } when the traveller states they fly from a different airport (optional);
    "preferredStayProximityRef"?: { "entityType": "PLACE", "id": string } (optional);
    "transport"?: {
      "preferDirect"?: boolean;
      "earliestDeparture"?: ISO-8601 timestamp with UTC offset;
      "latestDeparture"?: ISO-8601 timestamp with UTC offset;
    } (optional);
    "objectiveEffects"?: array of { "objectiveId": string, "effect": "WAIVE" | "REPRIORITY", "newHardness"?: "HARD" | "SOFT", "reason"?: string } (default []);
  } (required);
  "fundingDeclaration"?: one of EVENT_FUNDED | TRAVELLER_FUNDED | SPLIT | UNKNOWN (optional);
}

If the traveller's text is ambiguous or you cannot determine the intent with confidence, respond with:
{ "clarificationNeeded": "string describing what is unclear" }

Never invent timestamps, entity ids, or other details the traveller did not state.`;

async function interpretViaModel(
  client: ModelStudioClient,
  input: ChangeIntakeInput,
): Promise<ChangeIntakeResult> {
  // The prompt's two output shapes are BOTH strict-valid: a bare
  // clarification object (ambiguity fail-closed) or the full structured
  // interpretation. A single strict object requiring intentKind would reject
  // every honest clarification — turning designed uncertainty into a schema
  // error instead of a clarification request.
  const modelOutputSchema = z.union([
    z.strictObject({
      clarificationNeeded: z.string().min(1),
    }),
    z.strictObject({
      intentKind: z.enum([
        'ADJUST_TRIP_WINDOW',
        'CHANGE_TRANSPORT_SCHEDULE',
        'CHANGE_STAY',
        'CANCEL_BOOKING',
        'ADJUST_OBJECTIVE',
        'OTHER',
      ]),
      urgency: z.enum(['HARD_INSTRUCTION', 'SOFT_PREFERENCE']),
      target: z.strictObject({
        arriveBy: IsoDateTimeSchema.optional(),
        departAfter: IsoDateTimeSchema.optional(),
        departureOrigin: z.strictObject({ system: z.string(), value: z.string() }).optional(),
        preferredStayProximityRef: z
          .strictObject({
            entityType: z.literal('PLACE'),
            id: EntityIdSchema,
          })
          .optional(),
        transport: z
          .strictObject({
            preferDirect: z.boolean().optional(),
            earliestDeparture: IsoDateTimeSchema.optional(),
            latestDeparture: IsoDateTimeSchema.optional(),
          })
          .optional(),
        objectiveEffects: z
          .array(
            z.strictObject({
              objectiveId: EntityIdSchema,
              effect: z.enum(['WAIVE', 'REPRIORITY']),
              newHardness: z.enum(['HARD', 'SOFT']).optional(),
              reason: z.string().optional(),
            }),
          )
          .default([]),
      }),
      fundingDeclaration: z.enum(['EVENT_FUNDED', 'TRAVELLER_FUNDED', 'SPLIT', 'UNKNOWN']).optional(),
      clarificationNeeded: z.string().optional(),
    }),
  ]);

  const task: ModelTask<z.infer<typeof modelOutputSchema>> = {
    id: 'change_intake_nl',
    systemPrompt: CHANGE_INTAKE_SYSTEM_PROMPT,
    userPrompt: `Traveller text: ${input.text}`,
    schema: modelOutputSchema,
  };

  const result = await client.call(task);
  if (!result.ok) {
    return {
      ok: false,
      uncertainties: [
        {
          id: `unc-model-${Date.now()}`,
          statement: `model call failed: ${result.error.category}:${result.error.code}`,
          aboutRefs: [],
          severity: 'HIGH',
        },
      ],
      provenance: 'MODEL',
      clarificationNeeded: 'Model interpretation failed; please rephrase or provide structured input.',
    };
  }

  const modelOutput = result.value;
  // A clarification (bare shape or flagged on the full shape) is designed
  // ambiguity fail-closed: structured uncertainty, never an invented proposal.
  if (modelOutput.clarificationNeeded) {
    return {
      ok: false,
      uncertainties: [
        {
          id: `unc-clarify-${Date.now()}`,
          statement: `model requests clarification: ${modelOutput.clarificationNeeded}`,
          aboutRefs: [],
          severity: 'MEDIUM',
        },
      ],
      provenance: 'MODEL',
      clarificationNeeded: modelOutput.clarificationNeeded,
    };
  }
  if (!('intentKind' in modelOutput)) {
    // Structurally unreachable (the union admits only the two shapes above);
    // kept as a fail-closed backstop rather than a cast.
    return {
      ok: false,
      uncertainties: [
        {
          id: `unc-schema-${Date.now()}`,
          statement: 'model output carried neither a clarification nor an interpretation',
          aboutRefs: [],
          severity: 'HIGH',
        },
      ],
      provenance: 'MODEL',
      clarificationNeeded: 'Model output did not produce a valid ChangeRequest; please rephrase.',
    };
  }

  // Build the full ChangeRequest proposal.
  const proposal = buildProposal(input, modelOutput.intentKind, modelOutput.urgency, modelOutput.target, modelOutput.fundingDeclaration);
  const validated = ChangeRequestSchema.safeParse(proposal);
  if (!validated.success) {
    return {
      ok: false,
      uncertainties: [
        {
          id: `unc-schema-${Date.now()}`,
          statement: `model output failed ChangeRequest schema validation: ${validated.error.issues.length} issue(s)`,
          aboutRefs: [],
          severity: 'HIGH',
        },
      ],
      provenance: 'MODEL',
      clarificationNeeded: 'Model output did not produce a valid ChangeRequest; please rephrase.',
    };
  }

  return {
    ok: true,
    proposal: validated.data,
    provenance: 'MODEL',
  };
}

// ---------------------------------------------------------------------------
// Deterministic path
// ---------------------------------------------------------------------------

interface DeterministicMatch {
  intentKind: ChangeRequestIntentKind;
  urgency: ChangeRequestUrgency;
  target: ResolutionTarget;
  fundingDeclaration?: 'EVENT_FUNDED' | 'TRAVELLER_FUNDED' | 'SPLIT' | 'UNKNOWN';
}

function interpretDeterministic(input: ChangeIntakeInput): ChangeIntakeResult {
  const text = input.text.trim();
  const match = matchPatterns(text);
  if (!match) {
    return {
      ok: false,
      uncertainties: [
        {
          id: `unc-nl-${Date.now()}`,
          statement: 'deterministic interpreter could not match the text to a supported request pattern',
          aboutRefs: [],
          severity: 'MEDIUM',
        },
      ],
      provenance: 'DETERMINISTIC',
      clarificationNeeded:
        'Could not interpret your request. Supported patterns: direct flight preference, specific departure/arrival times, stay extension/shortening with dates.',
    };
  }

  const proposal = buildProposal(input, match.intentKind, match.urgency, match.target, match.fundingDeclaration);
  const validated = ChangeRequestSchema.safeParse(proposal);
  if (!validated.success) {
    return {
      ok: false,
      uncertainties: [
        {
          id: `unc-schema-${Date.now()}`,
          statement: `deterministic output failed ChangeRequest schema validation: ${validated.error.issues.length} issue(s)`,
          aboutRefs: [],
          severity: 'HIGH',
        },
      ],
      provenance: 'DETERMINISTIC',
      clarificationNeeded: 'Interpreter produced an invalid proposal; please rephrase with more specific details.',
    };
  }

  return {
    ok: true,
    proposal: validated.data,
    provenance: 'DETERMINISTIC',
  };
}

function matchPatterns(text: string): DeterministicMatch | undefined {
  // Urgency detection: HARD_INSTRUCTION if text contains binding language.
  const isHard = /\b(must|need|require|insist|demand|urgent|immediately)\b/i.test(text);
  const urgency: ChangeRequestUrgency = isHard ? 'HARD_INSTRUCTION' : 'SOFT_PREFERENCE';

  // Funding detection.
  let fundingDeclaration: DeterministicMatch['fundingDeclaration'];
  if (/\b(self[-\s]?fund|pay myself|my expense|traveller[-\s]?fund)\b/i.test(text)) {
    fundingDeclaration = 'TRAVELLER_FUNDED';
  } else if (/\b(event[-\s]?fund|company[-\s]?fund|employer[-\s]?fund|org[-\s]?fund)\b/i.test(text)) {
    fundingDeclaration = 'EVENT_FUNDED';
  } else if (/\b(split|share|co[-\s]?fund)\b/i.test(text)) {
    fundingDeclaration = 'SPLIT';
  }

  // Pattern 1: Direct flight preference.
  if (/\b(direct\s*flight|prefer\s*direct|non[-\s]?stop)\b/i.test(text)) {
    return {
      intentKind: 'CHANGE_TRANSPORT_SCHEDULE',
      urgency,
      target: {
        transport: { preferDirect: true },
        objectiveEffects: [],
      },
      fundingDeclaration,
    };
  }

  // Pattern 2: Depart after specific time.
  const departAfterMatch = text.match(
    /depart\s*(?:after|from)\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[+-]\d{2}:\d{2}|Z))/i,
  );
  if (departAfterMatch) {
    const departAfter = departAfterMatch[1]!;
    const parsed = IsoDateTimeSchema.safeParse(departAfter);
    if (parsed.success) {
      return {
        intentKind: 'CHANGE_TRANSPORT_SCHEDULE',
        urgency,
        target: {
          transport: { earliestDeparture: parsed.data },
          objectiveEffects: [],
        },
        fundingDeclaration,
      };
    }
  }

  // Pattern 3: Arrive by specific time.
  const arriveByMatch = text.match(
    /arrive\s*(?:by|before)\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[+-]\d{2}:\d{2}|Z))/i,
  );
  if (arriveByMatch) {
    const arriveBy = arriveByMatch[1]!;
    const parsed = IsoDateTimeSchema.safeParse(arriveBy);
    if (parsed.success) {
      return {
        intentKind: 'ADJUST_TRIP_WINDOW',
        urgency,
        target: {
          arriveBy: parsed.data,
          objectiveEffects: [],
        },
        fundingDeclaration,
      };
    }
  }

  // Pattern 4: Extend stay until specific date.
  const extendMatch = text.match(
    /extend\s*(?:my\s*)?stay\s*(?:until|to)\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[+-]\d{2}:\d{2}|Z))/i,
  );
  if (extendMatch) {
    const departAfter = extendMatch[1]!;
    const parsed = IsoDateTimeSchema.safeParse(departAfter);
    if (parsed.success) {
      return {
        intentKind: 'CHANGE_STAY',
        urgency,
        target: {
          departAfter: parsed.data,
          objectiveEffects: [],
        },
        fundingDeclaration,
      };
    }
  }

  // Pattern 5: Shorten stay until specific date.
  const shortenMatch = text.match(
    /shorten\s*(?:my\s*)?stay\s*(?:until|to)\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[+-]\d{2}:\d{2}|Z))/i,
  );
  if (shortenMatch) {
    const departAfter = shortenMatch[1]!;
    const parsed = IsoDateTimeSchema.safeParse(departAfter);
    if (parsed.success) {
      return {
        intentKind: 'CHANGE_STAY',
        urgency,
        target: {
          departAfter: parsed.data,
          objectiveEffects: [],
        },
        fundingDeclaration,
      };
    }
  }

  // Pattern 6b: declared departure-gateway substitution ("I'm actually flying
  // from HND", "flying out of NRT"). Generic: any 3-letter airport code the
  // traveller states; whether it resolves to a known gateway is the planner's
  // evidence question, never the interpreter's guess.
  const originMatch = text.match(/\b(?:flying|departing|leaving)\s+(?:out\s+of\s+|from\s+)?([A-Za-z]{3})\b/i);
  if (originMatch) {
    return {
      intentKind: 'CHANGE_TRANSPORT_SCHEDULE',
      urgency,
      target: {
        departureOrigin: { system: 'airport-code', value: originMatch[1]!.toUpperCase() },
        objectiveEffects: [],
      },
      fundingDeclaration,
    };
  }

  // Pattern 6: Closer to a place (stay proximity).
  const proximityMatch = text.match(/(?:closer|nearer|near)\s+to\s+(?:place\s+)?(\S+)/i);
  if (proximityMatch && /\b(hotel|stay|accommodation)\b/i.test(text)) {
    const placeId = proximityMatch[1]!;
    const parsed = EntityIdSchema.safeParse(placeId);
    if (parsed.success) {
      return {
        intentKind: 'CHANGE_STAY',
        urgency,
        target: {
          preferredStayProximityRef: { entityType: 'PLACE', id: parsed.data },
          objectiveEffects: [],
        },
        fundingDeclaration,
      };
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildProposal(
  input: ChangeIntakeInput,
  intentKind: ChangeRequestIntentKind,
  urgency: ChangeRequestUrgency,
  target: ResolutionTarget,
  fundingDeclaration?: 'EVENT_FUNDED' | 'TRAVELLER_FUNDED' | 'SPLIT' | 'UNKNOWN',
): ChangeRequest {
  const proposal: ChangeRequest = {
    id: `cr-nl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    tripId: input.tripId ?? `trip-${input.travellerId}-default`,
    travellerId: input.travellerId,
    sourceId: 'src-nl-intake',
    authority: 'INFERRED',
    issuedAt: input.at as IsoDateTime,
    intentKind,
    urgency,
    utterance: input.text,
    target,
    ...(fundingDeclaration ? { fundingDeclaration } : {}),
  };
  return proposal;
}

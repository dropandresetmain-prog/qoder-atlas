/**
 * B3 — traveller and dynamic-context normalization.
 *
 * Semantics enforced here:
 * - explicit instructions outrank trip preferences, which outrank persistent
 *   preferences, which outrank latent inferences (frozen precedence ladder);
 * - accessibility is a HARD requirement/constraint, never a preference;
 * - legal/entry facts require authoritative-source evidence — a confident
 *   statement without it becomes recorded uncertainty, not a rule;
 * - operational estimates retain source, confidence and uncertainty.
 */
import { z } from 'zod';
import {
  EntityIdSchema,
  FactAuthoritySchema,
  FactSchema,
  IsoDateTimeSchema,
  type EntityId,
} from '../domain/common.ts';
import {
  AccessibilityRequirementKindSchema,
  TravellerSchema,
  type AccessibilityRequirementKind,
} from '../domain/entities.ts';
import {
  dominatingPreference,
  preferencePrecedence,
  PreferenceSchema,
  type Preference,
} from '../domain/preferences.ts';
import type { RuleSet } from '../domain/rules.ts';
import { TripSignalSchema } from '../operational/signal.ts';
import type { MutationOrigin } from '../operational/mutation.ts';
import {
  addUncertainty,
  emptyArtifacts,
  pushProposal,
  type IngestionArtifacts,
  type NormalizationEnv,
} from './artifacts.ts';
import { hashId } from './ids.ts';
import { buildRuleSetWithIds } from './ruleSets.ts';
import type { ExtractedTravellerContext } from './semantic.ts';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export const StructuredInstructionSchema = z.strictObject({
  statement: z.string(),
  issuedBy: EntityIdSchema,
  issuedAt: IsoDateTimeSchema,
});

export const StructuredPreferenceSchema = z.strictObject({
  statement: z.string(),
  scope: z.enum(['TRIP', 'PERSISTENT']).default('TRIP'),
  statedAt: IsoDateTimeSchema.optional(),
});

export const StructuredLatentPreferenceSchema = z.strictObject({
  statement: z.string(),
  evidence: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export const StructuredAccessibilitySchema = z.strictObject({
  kind: AccessibilityRequirementKindSchema.optional(),
  statement: z.string(),
});

export const StructuredTravellerContextSchema = z.strictObject({
  travellerId: EntityIdSchema.optional(),
  traveller: z
    .strictObject({
      name: z.string(),
      nationalityCodes: z.array(z.string()).optional(),
      communicationPreference: z.string().optional(),
      loyaltyContext: z.array(z.string()).optional(),
    })
    .optional(),
  instructions: z.array(StructuredInstructionSchema).default([]),
  preferences: z.array(StructuredPreferenceSchema).default([]),
  latentPreferences: z.array(StructuredLatentPreferenceSchema).default([]),
  accessibility: z.array(StructuredAccessibilitySchema).default([]),
});

/** Runtime validation of the frozen ResearchFinding interface. */
export const ResearchFindingSchema = z.strictObject({
  statement: z.string(),
  kind: z.enum(['LEGAL_ENTRY_FACT', 'OPERATIONAL_ESTIMATE']),
  authority: FactAuthoritySchema,
  sourceUris: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).optional(),
  uncertainty: z.string().optional(),
});
export type ResearchFindingInput = z.infer<typeof ResearchFindingSchema>;

export const StructuredResearchSchema = z.strictObject({
  destinationCountryCode: z.string().optional(),
  findings: z.array(z.unknown()).default([]),
});

// ---------------------------------------------------------------------------
// Common intermediate shape
// ---------------------------------------------------------------------------

interface TravellerContextInput {
  travellerId?: EntityId;
  travellerDraft?: {
    name: string;
    nationalityCodes?: string[];
    communicationPreference?: string;
    loyaltyContext?: string[];
  };
  instructions: Array<{ statement: string; issuedBy: EntityId; issuedAt: string }>;
  preferences: Array<{
    statement: string;
    scope: 'TRIP' | 'PERSISTENT';
    statedAt?: string;
  }>;
  latent: Array<{ statement: string; evidence?: string; confidence?: number }>;
  accessibility: Array<{ kind?: AccessibilityRequirementKind; statement: string }>;
  /** Demotion/validation notes recorded as uncertainties. */
  notes: string[];
}

// ---------------------------------------------------------------------------
// Precedence resolution
// ---------------------------------------------------------------------------

/**
 * Deterministic conflict resolution over the frozen precedence ladder.
 * Within one traveller+statement group, strictly lower-precedence preferences
 * are marked SUPERSEDED; equal precedence stays ACTIVE. The group key omits
 * trip scoping on purpose: a current explicit instruction outranks the same
 * statement expressed as a trip/persistent/latent preference.
 */
export function resolvePreferenceConflicts(preferences: Preference[]): Preference[] {
  const groups = new Map<string, Preference[]>();
  for (const preference of preferences) {
    const key = [preference.travellerId, preference.statement.trim().toLowerCase()].join('|');
    const group = groups.get(key);
    if (group) group.push(preference);
    else groups.set(key, [preference]);
  }
  const resolved: Preference[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort(
      (a, b) => preferencePrecedence(b) - preferencePrecedence(a),
    );
    const leader = sorted[0];
    for (const preference of sorted) {
      if (leader && preference !== leader && dominatingPreference(leader, preference) === leader) {
        resolved.push({ ...preference, status: 'SUPERSEDED' });
      } else {
        resolved.push(preference);
      }
    }
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Emission
// ---------------------------------------------------------------------------

export function emitTravellerContext(
  env: NormalizationEnv,
  input: TravellerContextInput,
  origin: MutationOrigin,
): IngestionArtifacts {
  const artifacts = emptyArtifacts();
  for (const note of input.notes) {
    addUncertainty(artifacts, env, note, 'MEDIUM');
  }

  const travellerId =
    input.travellerId ??
    env.context.travellerId ??
    (input.travellerDraft
      ? hashId('traveller', env.source.id, input.travellerDraft.name)
      : undefined);

  const requirements = input.accessibility.map((a, index) => ({
    id: hashId('acc', env.source.id, a.statement, String(index)),
    kind: a.kind ?? ('OTHER' as const),
    statement: a.statement,
    sourceId: env.source.id,
  }));

  // Traveller profile entity / facts.
  if (input.travellerDraft && travellerId) {
    const nationalityCodes = input.travellerDraft.nationalityCodes;
    const traveller = TravellerSchema.parse({
      id: travellerId,
      name: input.travellerDraft.name,
      ...(nationalityCodes && nationalityCodes.length > 0
        ? {
            nationalityCodes: FactSchema(z.array(z.string())).parse({
              value: nationalityCodes,
              sourceId: env.source.id,
              authority: env.source.authority,
              observedAt: env.now,
            }),
          }
        : {}),
      ...(input.travellerDraft.communicationPreference
        ? { communicationPreference: input.travellerDraft.communicationPreference }
        : {}),
      loyaltyContext: input.travellerDraft.loyaltyContext ?? [],
      accessibilityRequirements: requirements,
    });
    pushProposal(
      artifacts,
      env,
      origin,
      [{ op: 'UPSERT_ENTITY', entityType: 'TRAVELLER', id: travellerId, data: traveller }],
      'Traveller profile facts from ingested source',
    );
  }

  // Accessibility is a requirement: HARD constraint, never a preference.
  for (const requirement of requirements) {
    pushProposal(
      artifacts,
      env,
      origin,
      [
        {
          op: 'UPSERT_CONSTRAINT',
          constraint: {
            id: hashId('cons', env.source.id, requirement.statement),
            kind: 'ACCESSIBILITY',
            hardness: 'HARD',
            evaluator: 'SEMANTIC',
            status: 'UNKNOWN',
            description: requirement.statement,
            refs: travellerId
              ? [{ entityType: 'TRAVELLER', id: travellerId }]
              : [],
            parameters: { requirement },
            sourceId: env.source.id,
          },
        },
      ],
      'Accessibility requirement ingested as hard constraint',
    );
  }

  // Preferences/instructions become schema-validated Preference records,
  // conflict-resolved, and travel downstream as a TRAVELLER_INPUT signal.
  const hasPreferenceContent =
    input.instructions.length > 0 || input.preferences.length > 0 || input.latent.length > 0;

  if (hasPreferenceContent && !travellerId) {
    addUncertainty(
      artifacts,
      env,
      'Traveller preference/instruction content extracted but no traveller identity is available to bind it',
      'HIGH',
    );
    return artifacts;
  }
  if (!hasPreferenceContent) return artifacts;

  const preferences: Preference[] = [];
  for (const instruction of input.instructions) {
    preferences.push(
      PreferenceSchema.parse({
        id: hashId('pref', env.source.id, travellerId as string, instruction.statement, 'instruction'),
        travellerId: travellerId as EntityId,
        statement: instruction.statement,
        origin: {
          kind: 'EXPLICIT_INSTRUCTION',
          issuedAt: instruction.issuedAt,
          issuedBy: instruction.issuedBy,
        },
        sourceId: env.source.id,
      }),
    );
  }
  for (const preference of input.preferences) {
    const scope = preference.scope === 'TRIP' && env.context.tripId ? 'TRIP' : 'PERSISTENT';
    if (preference.scope === 'TRIP' && !env.context.tripId) {
      addUncertainty(
        artifacts,
        env,
        `Trip-scoped preference stored as persistent because no trip context was supplied: ${preference.statement}`,
        'LOW',
      );
    }
    preferences.push(
      PreferenceSchema.parse({
        id: hashId('pref', env.source.id, travellerId as string, preference.statement, scope),
        travellerId: travellerId as EntityId,
        ...(scope === 'TRIP' ? { tripId: env.context.tripId } : {}),
        statement: preference.statement,
        origin: {
          kind: scope === 'TRIP' ? 'EXPLICIT_TRIP_PREFERENCE' : 'EXPLICIT_PERSISTENT',
          ...(preference.statedAt ? { statedAt: preference.statedAt } : {}),
        },
        sourceId: env.source.id,
      }),
    );
  }
  for (const latent of input.latent) {
    preferences.push(
      PreferenceSchema.parse({
        id: hashId('pref', env.source.id, travellerId as string, latent.statement, 'latent'),
        travellerId: travellerId as EntityId,
        ...(env.context.tripId ? { tripId: env.context.tripId } : {}),
        statement: latent.statement,
        origin: {
          kind: 'LATENT_INFERRED',
          ...(latent.evidence ? { evidence: latent.evidence } : {}),
          ...(latent.confidence !== undefined ? { confidence: latent.confidence } : {}),
          inferredAt: env.now,
        },
        sourceId: env.source.id,
      }),
    );
  }

  const resolved = resolvePreferenceConflicts(preferences);
  const signal = TripSignalSchema.parse({
    id: hashId('signal', env.source.id, 'traveller-input', JSON.stringify(resolved.map((p) => p.id))),
    kind: 'TRAVELLER_INPUT',
    occurredAt: env.now,
    sourceId: env.source.id,
    authority: env.source.authority,
    ...(env.context.tripId ? { tripId: env.context.tripId } : {}),
    subjectRef: { entityType: 'TRAVELLER', id: travellerId as EntityId },
    summary: 'Traveller preferences/instructions ingested',
    payload: { preferences: resolved },
  });
  artifacts.signals.push(signal);
  return artifacts;
}

// ---------------------------------------------------------------------------
// Structured and semantic entry points
// ---------------------------------------------------------------------------

export function normalizeStructuredTravellerContext(
  env: NormalizationEnv,
  payload: unknown,
  origin: MutationOrigin,
): IngestionArtifacts {
  const artifacts = emptyArtifacts();
  const parsed = StructuredTravellerContextSchema.safeParse(payload);
  if (!parsed.success) {
    addUncertainty(
      artifacts,
      env,
      `Traveller context payload failed schema validation: ${formatIssues(parsed.error)}`,
      'HIGH',
    );
    return artifacts;
  }
  const data = parsed.data;
  const input: TravellerContextInput = {
    travellerId: data.travellerId,
    travellerDraft: data.traveller,
    instructions: [...data.instructions],
    preferences: data.preferences.map((p) => ({ ...p })),
    latent: [...data.latentPreferences],
    accessibility: [...data.accessibility],
    notes: [],
  };
  return mergeInto(artifacts, emitTravellerContext(env, input, origin));
}

/**
 * Semantic-path conversion with anti-fabrication demotions: model output may
 * not claim explicit instructions without verbatim evidence from an
 * appropriate direct source and a bindable issuer.
 */
export function normalizeExtractedTravellerContext(
  env: NormalizationEnv,
  extracted: ExtractedTravellerContext,
): IngestionArtifacts {
  const notes: string[] = [];
  const directSource = env.source.kind === 'MANUAL' || env.source.kind === 'PROFILE';

  const input: TravellerContextInput = {
    travellerDraft: extracted.travellerName
      ? { name: extracted.travellerName, nationalityCodes: extracted.nationalityCodes }
      : undefined,
    instructions: [],
    preferences: [],
    latent: [],
    accessibility: extracted.accessibility.map((a) => ({ ...a })),
    notes,
  };

  const travellerId =
    env.context.travellerId ??
    (extracted.travellerName
      ? hashId('traveller', env.source.id, extracted.travellerName)
      : undefined);

  for (const item of extracted.items) {
    if (item.basis === 'LATENT') {
      input.latent.push({
        statement: item.statement,
        evidence: item.quote,
        confidence: item.confidence,
      });
      continue;
    }
    if (item.basis === 'EXPLICIT_INSTRUCTION') {
      if (directSource && item.quote && travellerId) {
        input.instructions.push({
          statement: item.statement,
          issuedBy: travellerId,
          issuedAt: env.now,
        });
      } else {
        notes.push(
          `Claimed explicit instruction demoted to trip preference (missing quote/direct source/issuer): ${item.statement}`,
        );
        input.preferences.push({ statement: item.statement, scope: 'TRIP' });
      }
      continue;
    }
    input.preferences.push({
      statement: item.statement,
      scope: item.tripScoped === false ? 'PERSISTENT' : 'TRIP',
    });
  }

  return emitTravellerContext(env, input, 'AI');
}

// ---------------------------------------------------------------------------
// Research findings: legal gate + operational estimates
// ---------------------------------------------------------------------------

export function normalizeResearchFindings(
  env: NormalizationEnv,
  payload: unknown,
): IngestionArtifacts {
  const artifacts = emptyArtifacts();
  const parsed = StructuredResearchSchema.safeParse(payload);
  if (!parsed.success) {
    addUncertainty(
      artifacts,
      env,
      `Research findings payload failed schema validation: ${formatIssues(parsed.error)}`,
      'HIGH',
    );
    return artifacts;
  }

  const rules: Array<Record<string, unknown>> = [];
  for (const rawFinding of parsed.data.findings) {
    const findingParsed = ResearchFindingSchema.safeParse(rawFinding);
    if (!findingParsed.success) {
      addUncertainty(
        artifacts,
        env,
        `Research finding failed schema validation: ${formatIssues(findingParsed.error)}`,
        'HIGH',
      );
      continue;
    }
    const finding = findingParsed.data;
    if (finding.kind === 'LEGAL_ENTRY_FACT') {
      if (finding.authority === 'AUTHORITATIVE' && finding.sourceUris.length > 0) {
        rules.push({
          kind: 'ENTRY_REQUIREMENT',
          requirement: finding.statement,
          authoritativeSourceId: env.source.id,
          description: `Authoritative sources: ${finding.sourceUris.join(', ')}`,
        });
      } else {
        addUncertainty(
          artifacts,
          env,
          `Legal/entry claim lacks authoritative sourcing and was not turned into a rule: ${finding.statement}`,
          'HIGH',
        );
      }
      continue;
    }
    // OPERATIONAL_ESTIMATE — retain source/confidence/uncertainty, no numbers invented.
    rules.push({
      kind: 'OTHER',
      statement: finding.statement,
      description: `Operational estimate; confidence=${
        finding.confidence !== undefined ? String(finding.confidence) : 'UNKNOWN'
      }; uncertainty=${finding.uncertainty ?? 'none recorded'}`,
    });
  }

  if (rules.length > 0) {
    const name = parsed.data.destinationCountryCode
      ? `Entry requirements: ${parsed.data.destinationCountryCode}`
      : 'Entry requirements';
    const ruleSet = buildEntryRuleSet(env, name, rules, artifacts);
    if (ruleSet) artifacts.ruleSets.push(ruleSet);
  }
  return artifacts;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildEntryRuleSet(
  env: NormalizationEnv,
  name: string,
  rules: Array<Record<string, unknown>>,
  artifacts: IngestionArtifacts,
): RuleSet | undefined {
  const { ruleSet, issues } = buildRuleSetWithIds(env, { kind: 'ENTRY', name, rules });
  if (!ruleSet) {
    addUncertainty(
      artifacts,
      env,
      `Entry rule set failed validation: ${issues.join('; ')}`,
      'HIGH',
    );
    return undefined;
  }
  return ruleSet;
}

function formatIssues(error: z.ZodError): string {
  return formatIssueList(error).join('; ');
}

function formatIssueList(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
}

function mergeInto(target: IngestionArtifacts, more: IngestionArtifacts): IngestionArtifacts {
  target.proposals.push(...more.proposals);
  target.ruleSets.push(...more.ruleSets);
  target.signals.push(...more.signals);
  target.uncertainties.push(...more.uncertainties);
  return target;
}

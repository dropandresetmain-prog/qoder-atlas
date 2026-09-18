/**
 * NORTHSTAR v2 — Viable-only strategy recommendation (R1 / freeze C6).
 *
 * Only currently valid `VIABLE` RecoveryStrategies may enter comparison. The
 * comparator receives structured deterministic facts computed OUTSIDE any LLM
 * (price, timing, buffers, change count, blast radius, outcome delta, explicit
 * preferences, policy facts, uncertainty) and MAY additionally receive semantic
 * judgement for convenience / soft trade-offs / explanation.
 *
 * Hard boundaries the contract enforces structurally:
 *   - a recommendation names exactly one recommended strategy plus alternatives;
 *   - validation REJECTS a recommendation that names a non-viable, stale or
 *     foreign-case strategy;
 *   - recommendation basis entries are typed as deterministic fact, explicit
 *     preference or semantic judgement — so an AI convenience judgement can
 *     never masquerade as a hard policy fact;
 *   - there is NO scalar LLM "viability score" anywhere in this shape;
 *   - explicit preferences outrank inferred preferences; inferred preferences
 *     are labelled and cannot override explicit preferences or hard policy.
 *
 * AI may NOT assign PASS, override RC-6, bypass hard policy, or turn a
 * stale/rejected candidate into a recommendation. This module owns the shape
 * and the deterministic validation; the comparator implementation lives in the
 * planner lane.
 */
import { z } from 'zod';
import { SubjectIdSchema, TypedRefSchema, type SubjectId } from '../../../domain/v2/shared/identity.ts';

/** How a recommendation-basis entry was produced. Closed and ordered by trust. */
export const RecommendationBasisKindSchema = z.enum([
  'DETERMINISTIC_FACT',
  'EXPLICIT_PREFERENCE',
  'SEMANTIC_JUDGEMENT',
]);
export type RecommendationBasisKind = z.infer<typeof RecommendationBasisKindSchema>;

export const RecommendationBasisSchema = z.strictObject({
  code: z.string().regex(/^[a-z][a-z0-9_]*$/),
  summary: z.string().min(1).max(1024),
  kind: RecommendationBasisKindSchema,
});
export type RecommendationBasis = z.infer<typeof RecommendationBasisSchema>;

export const StrategyTradeoffSchema = z.strictObject({
  strategyRef: SubjectIdSchema,
  advantages: z.array(z.string().min(1).max(512)).default([]),
  disadvantages: z.array(z.string().min(1).max(512)).default([]),
});
export type StrategyTradeoff = z.infer<typeof StrategyTradeoffSchema>;

export const RecommendationUncertaintySchema = z.strictObject({
  code: z.string().regex(/^[a-z][a-z0-9_]*$/),
  summary: z.string().min(1).max(512),
  evidenceRefs: z.array(z.string().min(1)).default([]),
});
export type RecommendationUncertainty = z.infer<typeof RecommendationUncertaintySchema>;

export const RecommendationProvenanceSchema = z.strictObject({
  kind: z.enum(['DETERMINISTIC', 'AI_ASSISTED']),
  comparatorVersion: z.string().min(1),
  model: z.string().min(1).optional(),
  modelVersion: z.string().min(1).optional(),
});
export type RecommendationProvenance = z.infer<typeof RecommendationProvenanceSchema>;

/**
 * The frozen structured recommendation result. `recommendedStrategyRef` and
 * every `alternativeStrategyRefs` entry MUST be a current VIABLE strategy of
 * the SAME recovery case; `validateStrategyRecommendation` enforces this.
 */
export const StrategyRecommendationSchema = z.strictObject({
  recommendedStrategyRef: SubjectIdSchema,
  alternativeStrategyRefs: z.array(SubjectIdSchema).default([]),
  recommendationBasis: z.array(RecommendationBasisSchema).default([]),
  tradeoffs: z.array(StrategyTradeoffSchema).default([]),
  uncertainty: z.array(RecommendationUncertaintySchema).default([]),
  evidenceRefs: z.array(z.string().min(1)).default([]),
  provenance: RecommendationProvenanceSchema,
});
export type StrategyRecommendation = z.infer<typeof StrategyRecommendationSchema>;

/**
 * Preference precedence is FROZEN (freeze §"PREFERENCE / POLICY INPUTS"):
 *   1 explicit traveller preference
 *   2 explicit organisation/event policy
 *   3 deterministic facts
 *   4 inferred soft preference
 *   5 generic semantic judgement
 * A lower number always outranks a higher one. Hard constraints are already
 * enforced by RC-6 before comparison and are not re-litigated here.
 */
export const PreferencePrioritySchema = z.enum([
  'EXPLICIT_TRAVELLER',
  'EXPLICIT_ORGANISATION_POLICY',
  'DETERMINISTIC_FACT',
  'INFERRED_SOFT',
  'GENERIC_SEMANTIC',
]);
export type PreferencePriority = z.infer<typeof PreferencePrioritySchema>;

const PREFERENCE_RANK: Record<PreferencePriority, number> = {
  EXPLICIT_TRAVELLER: 1,
  EXPLICIT_ORGANISATION_POLICY: 2,
  DETERMINISTIC_FACT: 3,
  INFERRED_SOFT: 4,
  GENERIC_SEMANTIC: 5,
};

/** A single comparator preference input, labelled with its precedence and inferred-ness. */
export const ComparatorPreferenceSchema = z.strictObject({
  code: z.string().regex(/^[a-z][a-z0-9_]*$/),
  priority: PreferencePrioritySchema,
  /** True when the preference was inferred rather than explicitly declared. */
  inferred: z.boolean(),
  summary: z.string().min(1).max(512),
  subjectRef: TypedRefSchema.optional(),
});
export type ComparatorPreference = z.infer<typeof ComparatorPreferenceSchema>;

/**
 * Order preferences by precedence. Explicit always outranks inferred; an
 * inferred preference can never be ordered ahead of an explicit one even if a
 * caller mislabels it, because `inferred` forces rank >= INFERRED_SOFT.
 */
export function orderComparatorPreferences(
  preferences: readonly ComparatorPreference[],
): ComparatorPreference[] {
  return [...preferences]
    .map((p) => ({ preference: p, rank: effectiveRank(p) }))
    .sort((a, b) => a.rank - b.rank || a.preference.code.localeCompare(b.preference.code))
    .map((entry) => entry.preference);
}

function effectiveRank(preference: ComparatorPreference): number {
  const declared = PREFERENCE_RANK[preference.priority];
  // An inferred preference is demoted to at least INFERRED_SOFT precedence so
  // it can never outrank an explicit traveller/organisation preference.
  return preference.inferred ? Math.max(declared, PREFERENCE_RANK.INFERRED_SOFT) : declared;
}

/** A current viable strategy the comparator is allowed to consider. */
export interface ViableStrategyCandidate {
  strategyRef: SubjectId;
  recoveryCaseId: SubjectId;
  /** Must be 'VIABLE'; anything else is rejected before comparison. */
  viability: 'VIABLE' | 'NOT_VIABLE' | 'NOT_EXECUTABLE' | 'STALE_BASE' | 'REJECTED';
  /** True when the strategy's basis manifest is no longer current. */
  stale: boolean;
}

/** Closed refusal reasons so callers can report why a recommendation failed validation. */
export const RecommendationInvalidReasonSchema = z.enum([
  'RECOMMENDED_NOT_VIABLE',
  'RECOMMENDED_STALE',
  'RECOMMENDED_FOREIGN_CASE',
  'RECOMMENDED_NOT_IN_CANDIDATE_SET',
  'ALTERNATIVE_NOT_VIABLE',
  'ALTERNATIVE_STALE',
  'ALTERNATIVE_FOREIGN_CASE',
  'ALTERNATIVE_NOT_IN_CANDIDATE_SET',
  'ALTERNATIVE_EQUALS_RECOMMENDED',
  'NO_VIABLE_CANDIDATES',
]);
export type RecommendationInvalidReason = z.infer<typeof RecommendationInvalidReasonSchema>;

export type RecommendationValidationResult =
  | { ok: true }
  | { ok: false; reason: RecommendationInvalidReason; strategyRef?: SubjectId };

/**
 * Deterministically validate a recommendation against the current VIABLE
 * candidate set of one recovery case. This is the safety boundary that makes
 * "a rejected/stale/foreign candidate cannot become the recommendation"
 * structurally true rather than a convention.
 */
export function validateStrategyRecommendation(input: {
  recommendation: StrategyRecommendation;
  recoveryCaseId: SubjectId;
  viableCandidates: readonly ViableStrategyCandidate[];
}): RecommendationValidationResult {
  const { recommendation, recoveryCaseId, viableCandidates } = input;
  const usable = viableCandidates.filter((c) => c.viability === 'VIABLE' && !c.stale && c.recoveryCaseId === recoveryCaseId);
  if (usable.length === 0) return { ok: false, reason: 'NO_VIABLE_CANDIDATES' };
  const byRef = new Map(usable.map((c) => [c.strategyRef, c]));

  const check = (
    ref: SubjectId,
    role: 'RECOMMENDED' | 'ALTERNATIVE',
  ): RecommendationValidationResult => {
    const inSet = viableCandidates.find((c) => c.strategyRef === ref);
    if (!inSet || inSet.recoveryCaseId !== recoveryCaseId) {
      // Distinguish foreign-case from entirely-unknown so the refusal is explainable.
      if (inSet && inSet.recoveryCaseId !== recoveryCaseId) {
        return { ok: false, reason: role === 'RECOMMENDED' ? 'RECOMMENDED_FOREIGN_CASE' : 'ALTERNATIVE_FOREIGN_CASE', strategyRef: ref };
      }
      return { ok: false, reason: role === 'RECOMMENDED' ? 'RECOMMENDED_NOT_IN_CANDIDATE_SET' : 'ALTERNATIVE_NOT_IN_CANDIDATE_SET', strategyRef: ref };
    }
    if (inSet.viability !== 'VIABLE') {
      return { ok: false, reason: role === 'RECOMMENDED' ? 'RECOMMENDED_NOT_VIABLE' : 'ALTERNATIVE_NOT_VIABLE', strategyRef: ref };
    }
    if (inSet.stale) {
      return { ok: false, reason: role === 'RECOMMENDED' ? 'RECOMMENDED_STALE' : 'ALTERNATIVE_STALE', strategyRef: ref };
    }
    if (!byRef.has(ref)) {
      return { ok: false, reason: role === 'RECOMMENDED' ? 'RECOMMENDED_NOT_IN_CANDIDATE_SET' : 'ALTERNATIVE_NOT_IN_CANDIDATE_SET', strategyRef: ref };
    }
    return { ok: true };
  };

  const recommended = check(recommendation.recommendedStrategyRef, 'RECOMMENDED');
  if (!recommended.ok) return recommended;

  for (const alt of recommendation.alternativeStrategyRefs) {
    if (alt === recommendation.recommendedStrategyRef) {
      return { ok: false, reason: 'ALTERNATIVE_EQUALS_RECOMMENDED', strategyRef: alt };
    }
    const result = check(alt, 'ALTERNATIVE');
    if (!result.ok) return result;
  }
  return { ok: true };
}

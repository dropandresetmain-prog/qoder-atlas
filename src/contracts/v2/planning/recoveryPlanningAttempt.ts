/**
 * NORTHSTAR v2 — Recovery planning attempt + material decision evidence
 * (R1 / freeze C5) and the Recovery Planning Coordinator contract (C1).
 *
 * C5 frozen owner decision: HYBRID.
 *   - VIABLE executable alternatives remain proper RecoveryStrategy rows
 *     (existing `recovery_strategies` storage). This module does NOT re-store
 *     them; it references them by `strategyRef`.
 *   - MATERIAL considered-but-rejected proposals do NOT become RecoveryStrategy
 *     rows. They are retained as bounded evidence inside ONE immutable
 *     `RecoveryPlanningAttempt` record per completed planning basis.
 *   - low-value / junk / duplicate intermediate candidates may remain ephemeral;
 *   - NO chain-of-thought, hidden reasoning transcript or agent scratchpad is
 *     ever persisted. Every retained field is bounded and factual.
 *
 * C1: the coordinator is an application service that EXTENDS the current
 * `recoveryPlanning.ts` path — it is not a parallel engine. Workspace, actor,
 * UnitOfWork, capability registry, proposers, the deterministic evaluator
 * (RC-6), the read-tool dispatcher and persistence are dependencies of the
 * application composition, never model-controlled input. The coordinator owns
 * planning-artefact persistence; it does NOT own canonical mutation, hard
 * viability, authority, consequential execution, provider-observed truth or
 * case resolution.
 */
import { z } from 'zod';
import { SubjectIdSchema, type SubjectId } from '../../../domain/v2/shared/identity.ts';
import { compareInstants, InstantSchema } from '../../../domain/v2/shared/time.ts';
import { CurrencyCodeSchema, ExactMoneySchema } from '../../../domain/v2/shared/money.ts';
import { FxRateEvidenceSchema } from '../../../engine/fx.ts';
import { WorldSnapshotManifestSchema } from '../scope/readScope.ts';
import { StrategyViabilitySchema, type StrategyViability } from '../scenario/recoveryStrategy.ts';
import {
  RecoveryDomainDecisionSchema,
  RecoveryDomainIdSchema,
  type RecoveryDomainId,
} from './recoveryDomain.ts';
import {
  PlanningToolProvenanceSchema,
  PlanningToolResultStatusSchema,
  PlanningToolUncertaintySchema,
} from './planningTool.ts';
import { CapabilityFamilySchema, ToolOperationSchema } from '../../../operational/strategy.ts';
import {
  ImmediateChangeBlastRadiusSchema,
  OutcomeDeltaEntrySchema,
  ReassessmentClosureSchema,
} from './impactSemantics.ts';
import { StrategyRecommendationSchema } from './strategyRecommendation.ts';

/**
 * One bounded, factual evidence record retained from a dispatched read. The
 * `summary` is a short factual projection — explicitly NOT a reasoning
 * transcript and NOT a raw provider wire payload.
 */
export const PlanningSourceLinkSchema = z.strictObject({
  publisher: z.string().min(1).max(256),
  url: z.url().refine((value) => new URL(value).protocol === 'https:'),
  observedAt: InstantSchema,
});

export const PlanningEvidenceRecordSchema = z.strictObject({
  evidenceRef: z.string().min(1),
  /** Canonical `capability|operation|params` fingerprint that produced this. */
  requestFingerprint: z.string().min(1),
  capability: CapabilityFamilySchema,
  operation: ToolOperationSchema,
  status: PlanningToolResultStatusSchema,
  summary: z.string().min(1).max(1024),
  provenance: PlanningToolProvenanceSchema,
  uncertainty: z.array(PlanningToolUncertaintySchema).default([]),
  sourceLinks: z.array(PlanningSourceLinkSchema).max(8).optional(),
});
export type PlanningEvidenceRecord = z.infer<typeof PlanningEvidenceRecordSchema>;

/**
 * Why a material candidate ended where it did. Closed so the persisted record
 * can never imply a rejected candidate was recommended, or that a viable one
 * was silently dropped.
 */
export const MaterialCandidateDispositionSchema = z.enum([
  'REJECTED_VALIDATION',
  'REJECTED_DETERMINISTIC',
  'VIABLE_NOT_RECOMMENDED',
  'RECOMMENDED',
]);
export type MaterialCandidateDisposition = z.infer<typeof MaterialCandidateDispositionSchema>;

/** One provider-price line and its evidenced home-currency restatement. */
export const RecoveryCostLineEvidenceSchema = z.strictObject({
  kind: z.enum(['SELECT_OFFER', 'ADD_JOURNEY_STAY', 'POLICY_PENALTY_ESTIMATE']),
  providerAmount: ExactMoneySchema,
  homeAmount: ExactMoneySchema,
  fxEvidenceId: z.string().min(1).optional(),
  /** Policy penalty values are estimates, never observed charges. */
  observed: z.boolean(),
});
export type RecoveryCostLineEvidence = z.infer<typeof RecoveryCostLineEvidenceSchema>;

export const RecoveryCostUnavailableCodeSchema = z.enum([
  'CONTEXT_UNAVAILABLE',
  'INVALID_INPUT',
  'MISSING_EFFECT_PRICE',
  'MISSING_RATE_EVIDENCE',
  'FUTURE_RATE_EVIDENCE',
  'STALE_RATE_EVIDENCE',
  'UNTRUSTED_RATE_EVIDENCE',
  'INVALID_RATE_PRECISION',
  'UNSUPPORTED_MONEY_PRECISION',
]);
export type RecoveryCostUnavailableCode = z.infer<typeof RecoveryCostUnavailableCodeSchema>;

/** Closed cost evidence: an unavailable comparison is explicit and never free. */
export const MaterialCandidateCostComparisonSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('AVAILABLE'),
    homeCurrency: CurrencyCodeSchema,
    totalHomeAmount: ExactMoneySchema,
    lines: z.array(RecoveryCostLineEvidenceSchema).max(32),
    /** Full selected dated FX records, not opaque identifiers alone. */
    selectedFxEvidence: z.array(FxRateEvidenceSchema).max(32),
    comparedAt: InstantSchema,
  }),
  z.strictObject({
    status: z.literal('UNAVAILABLE'),
    code: RecoveryCostUnavailableCodeSchema,
    reason: z.string().min(1).max(512),
    comparedAt: InstantSchema,
  }),
]);
export type MaterialCandidateCostComparison = z.infer<typeof MaterialCandidateCostComparisonSchema>;

/** A bounded, presentation-safe projection of an evaluated proposed world. */
export const MaterialCandidateProposalSchema = z.strictObject({
  flights: z.array(z.strictObject({
    label: z.string().min(1).max(160),
    departure: InstantSchema,
    arrival: InstantSchema,
    departureTimeZone: z.string().min(1).max(128).optional(),
    arrivalTimeZone: z.string().min(1).max(128).optional(),
  })).max(4).default([]),
  stays: z.array(z.strictObject({
    placeLabel: z.string().min(1).max(160),
    start: InstantSchema,
    end: InstantSchema,
    timeZone: z.string().min(1).max(128).optional(),
  })).max(4).default([]),
  entryResults: z.array(z.strictObject({
    dimension: z.string().min(1).max(128),
    verdict: z.enum(['FAIL', 'UNKNOWN', 'PASS']),
    reasonCodes: z.array(z.string().min(1).max(160)).max(8).default([]),
  })).max(8).default([]),
  blockers: z.array(z.strictObject({
    dimension: z.string().min(1).max(128),
    verdict: z.enum(['FAIL', 'UNKNOWN']),
    reasonCode: z.string().min(1).max(160),
    timing: z.strictObject({
      gapMinutes: z.number().finite().optional(),
      requiredMinutes: z.number().finite().optional(),
      slackMinutes: z.number().finite().optional(),
      transferMinutes: z.number().finite().optional(),
    }).optional(),
  })).max(16).default([]),
});
export type MaterialCandidateProposal = z.infer<typeof MaterialCandidateProposalSchema>;

/**
 * Bounded evidence for ONE material candidate. `strategyRef` is present only
 * when the candidate was promoted to a persisted viable RecoveryStrategy;
 * a material rejected candidate has no RecoveryStrategy row and keeps its
 * decision-time projections here instead.
 */
export const MaterialCandidateEvidenceSchema = z.strictObject({
  candidateKey: z.string().min(1).max(256),
  proposerId: z.string().min(1),
  domainId: RecoveryDomainIdSchema,
  /** Present only when promoted to a persisted viable RecoveryStrategy. */
  strategyRef: SubjectIdSchema.optional(),
  disposition: MaterialCandidateDispositionSchema,
  /** References into this attempt's `evidence[]` that informed the candidate. */
  evidenceRefs: z.array(z.string().min(1)).default([]),
  /** Actual validation reason codes when REJECTED_VALIDATION. */
  validationReasonCodes: z.array(z.string().min(1)).default([]),
  viability: StrategyViabilitySchema.optional(),
  /** Actual RC-6 output decision codes — never rewritten by recommendation prose. */
  viabilityDecisionCodes: z.array(z.string().min(1)).default([]),
  immediateChangeBlastRadius: ImmediateChangeBlastRadiusSchema.optional(),
  reassessmentClosure: ReassessmentClosureSchema.optional(),
  outcomeDelta: z.array(OutcomeDeltaEntrySchema).default([]),
  /** Bounded facts from the evaluated overlay and its deterministic explanations. */
  proposal: MaterialCandidateProposalSchema.optional(),
  /** Optional only when no cost-comparison supplier is composed at all. */
  costComparison: MaterialCandidateCostComparisonSchema.optional(),
});
export type MaterialCandidateEvidence = z.infer<typeof MaterialCandidateEvidenceSchema>;

/**
 * Bounded factual provenance for an optional model call made while planning.
 * Prompts, raw responses, rationales and hidden reasoning never belong here.
 */
export const PlanningModelActivitySchema = z.strictObject({
  operation: z.literal('recovery.domain_suggestion'),
  providerId: z.string().min(1).max(128),
  model: z.string().min(1).max(256),
  mode: z.enum(['LIVE', 'REPLAY']),
  status: z.enum(['SUCCEEDED', 'FAILED']),
  /** Recorded only after the model call has completed. */
  observedAt: InstantSchema,
  latencyMs: z.number().int().nonnegative().optional(),
  errorCategory: z.enum([
    'NOT_CONFIGURED',
    'AUTH',
    'NETWORK',
    'TIMEOUT',
    'RATE_LIMITED',
    'PROVIDER_ERROR',
    'INVALID_OUTPUT',
    'UNAVAILABLE',
  ]).optional(),
});
export type PlanningModelActivity = z.infer<typeof PlanningModelActivitySchema>;

/**
 * ONE immutable bounded record per completed planning basis. Persisted as a
 * single `recovery_planning_attempts` row with bounded typed JSON columns plus
 * FKs to the case and basis assessment; viable strategy detail stays normalized
 * in `recovery_strategies` / `strategy_changes`.
 */
export const RecoveryPlanningAttemptSchema = z.strictObject({
  id: SubjectIdSchema,
  recoveryCaseId: SubjectIdSchema,
  basisAssessmentId: SubjectIdSchema,
  basisManifest: WorldSnapshotManifestSchema,
  startedAt: InstantSchema,
  completedAt: InstantSchema,
  coordinatorVersion: z.string().min(1),
  domains: z.array(RecoveryDomainDecisionSchema).default([]),
  evidence: z.array(PlanningEvidenceRecordSchema).default([]),
  modelActivities: z.array(PlanningModelActivitySchema).max(8).default([]),
  materialCandidates: z.array(MaterialCandidateEvidenceSchema).default([]),
  /** Viable strategies promoted to RecoveryStrategy rows during this attempt. */
  viableStrategyRefs: z.array(SubjectIdSchema).default([]),
  recommendation: StrategyRecommendationSchema.optional(),
}).refine(
  // Parity with migration 0125's `recovery_planning_attempts_interval_chk`
  // (completed_at >= started_at): a completed attempt spans a non-empty,
  // correctly ordered interval, so an inverted interval is rejected here in
  // application code as well as at the database CHECK.
  (v) => compareInstants(v.startedAt, v.completedAt) <= 0,
  { message: 'completedAt must not precede startedAt', path: ['completedAt'] },
);
export type RecoveryPlanningAttempt = z.infer<typeof RecoveryPlanningAttemptSchema>;

/**
 * Closed planning outcome. `NEEDS_EVIDENCE_OR_DECISION` and `NO_RECOVERY_FOUND`
 * are valid terminal results — bounded planning never fabricates a recovery.
 */
export const RecoveryPlanningOutcomeSchema = z.enum([
  'AWAITING_AUTHORITY',
  'NEEDS_EVIDENCE_OR_DECISION',
  'NO_RECOVERY_FOUND',
  'STALE_RETRY_REQUIRED',
]);
export type RecoveryPlanningOutcome = z.infer<typeof RecoveryPlanningOutcomeSchema>;

/** Why the coordinator was invoked. Bound to the basis it planned against. */
export const RecoveryPlanningReasonSchema = z.enum([
  'CASE_OPENED',
  'REASSESSMENT',
  'OPERATOR_REQUEST',
]);
export type RecoveryPlanningReason = z.infer<typeof RecoveryPlanningReasonSchema>;

/** The frozen C1 coordinator result. */
export const RecoveryPlanningResultSchema = z.strictObject({
  planningAttemptRef: SubjectIdSchema,
  basisAssessmentId: SubjectIdSchema,
  viableStrategyRefs: z.array(SubjectIdSchema).default([]),
  recommendation: StrategyRecommendationSchema.optional(),
  outcome: RecoveryPlanningOutcomeSchema,
});
export type RecoveryPlanningResult = z.infer<typeof RecoveryPlanningResultSchema>;

/** The frozen C1 coordinator input. */
export interface RecoveryPlanningInput {
  recoveryCaseId: SubjectId;
  reason: RecoveryPlanningReason;
}

/**
 * The frozen C1 Recovery Planning Coordinator port. The concrete implementation
 * extends/adapts `src/app/target/recoveryPlanning.ts` and is composed once
 * under the application; all heavy dependencies are injected by the
 * composition root, not supplied by a model.
 */
export interface RecoveryPlanningCoordinator {
  planCase(input: RecoveryPlanningInput): Promise<RecoveryPlanningResult>;
}

/**
 * MATERIALITY RULES (freeze §"MATERIAL DECISION EVIDENCE"). Generalized and
 * tested — never scenario-specific. A candidate is retained as material when
 * ANY rule matches; otherwise it may stay ephemeral. Junk/duplicate/malformed
 * candidates are NEVER material.
 */
export type MaterialityRuleCode =
  | 'distinct_recovery_approach'
  | 'reached_deterministic_evaluation'
  | 'meaningful_deterministic_rejection'
  | 'viable_not_recommended'
  | 'informed_recommendation';

/**
 * Determine whether a candidate is material and therefore must be retained in
 * the planning attempt. Pure and deterministic.
 *
 * A candidate is material when it:
 *   - reached deterministic RC-6 evaluation (has a viability), OR
 *   - was rejected by validation with at least one reason code (a meaningful
 *     deterministic rejection), OR
 *   - is a viable candidate that was not the recommended one, OR
 *   - materially informed the recommendation (caller-asserted via
 *     `informedRecommendation`).
 *
 * A candidate that is purely duplicate noise or malformed (no viability, no
 * validation reason, not viable, did not inform the recommendation) is NOT
 * material and may remain ephemeral.
 */
export function isMaterialCandidate(input: {
  viability?: StrategyViability;
  validationReasonCodes?: readonly string[];
  disposition: MaterialCandidateDisposition;
  informedRecommendation?: boolean;
}): { material: boolean; rules: MaterialityRuleCode[] } {
  const rules: MaterialityRuleCode[] = [];
  const reachedEvaluation = input.viability !== undefined;
  if (reachedEvaluation) rules.push('reached_deterministic_evaluation');

  const meaningfulRejection =
    input.disposition === 'REJECTED_DETERMINISTIC' ||
    (input.disposition === 'REJECTED_VALIDATION' && (input.validationReasonCodes?.length ?? 0) > 0);
  if (meaningfulRejection) rules.push('meaningful_deterministic_rejection');

  if (input.disposition === 'VIABLE_NOT_RECOMMENDED') rules.push('viable_not_recommended');
  if (input.disposition === 'RECOMMENDED') rules.push('distinct_recovery_approach');
  if (input.informedRecommendation) rules.push('informed_recommendation');

  // A distinct recovery approach is material when it is a non-duplicate
  // candidate that reached evaluation or informed the recommendation. The
  // caller's dedupe happens before this point; here we only assert the rule
  // when the candidate carries a disposition beyond pure validation-junk.
  if (reachedEvaluation && !rules.includes('distinct_recovery_approach')) {
    rules.push('distinct_recovery_approach');
  }

  const material =
    reachedEvaluation ||
    meaningfulRejection ||
    input.disposition === 'VIABLE_NOT_RECOMMENDED' ||
    input.disposition === 'RECOMMENDED' ||
    Boolean(input.informedRecommendation);

  return { material, rules: [...new Set(rules)].sort() };
}

export type { RecoveryDomainId, StrategyViability };

/**
 * NORTHSTAR R1 — pure selection layer between decision evidence and the
 * persisted attempt: comparator-fact derivation + planning-outcome mapping.
 *
 * Both functions operate ONLY on the frozen, already-validated evidence shapes
 * (MaterialCandidateEvidence from decisionEvidence.ts, which itself is a pure
 * re-projection of real RC-6 output). No PostgreSQL, no provider, no model, no
 * scenario branch: the same code serves every planning situation.
 *
 * The coordinator (lane P) computes candidate facts here, hands them to the
 * deterministic comparator (comparator.ts), and maps the resulting attempt state
 * to the closed RecoveryPlanningOutcome vocabulary here — so outcome selection
 * is auditable data logic, never prose.
 */
import type { SubjectId } from '../../domain/v2/shared/identity.ts';
import type {
  MaterialCandidateEvidence,
  RecoveryPlanningOutcome,
} from '../../contracts/v2/planning/recoveryPlanningAttempt.ts';
import type { CandidateComparisonFacts } from './comparator.ts';

/**
 * Derive the deterministic comparison facts for ONE material candidate from its
 * decision-time evidence. Every count comes from the frozen impact projections:
 *   - worseCount / betterCount from the outcomeDelta (projection C);
 *   - blastRadiusSize from the immediate blast radius (projection A).
 * Returns `undefined` for candidates that never reached RC-6 (validation
 * rejections) — they carry no viability and must not enter comparison.
 */
export function comparisonFactsFromEvidence(
  evidence: MaterialCandidateEvidence,
  extra?: Pick<CandidateComparisonFacts, 'declaredCostMinorUnits' | 'satisfiedPreferenceCodes' | 'semanticNotes'>,
): CandidateComparisonFacts | undefined {
  if (evidence.viability === undefined) return undefined;
  const blast = evidence.immediateChangeBlastRadius;
  const facts: CandidateComparisonFacts = {
    strategyRef: evidence.strategyRef ?? evidence.candidateKey as SubjectId,
    worseCount: evidence.outcomeDelta.filter((d) => d.delta === 'WORSE').length,
    betterCount: evidence.outcomeDelta.filter((d) => d.delta === 'BETTER').length,
    blastRadiusSize: blast ? blast.changedRefs.length + blast.directlyAffectedRefs.length : 0,
    ...(extra?.declaredCostMinorUnits !== undefined ? { declaredCostMinorUnits: extra.declaredCostMinorUnits } : {}),
    ...(extra?.satisfiedPreferenceCodes !== undefined ? { satisfiedPreferenceCodes: [...extra.satisfiedPreferenceCodes] } : {}),
    ...(extra?.semanticNotes !== undefined ? { semanticNotes: [...extra.semanticNotes] } : {}),
  };
  return facts;
}

export interface PlanningOutcomeFacts {
  /** True when the basis manifest is no longer the case's current assessment basis. */
  readonly basisStale: boolean;
  /** True when the bounded research budget was exhausted while evidence gaps remained. */
  readonly researchBudgetExhausted: boolean;
  /** True when the coordinator needs an explicit operator decision to continue (e.g. a waiver). */
  readonly operatorDecisionRequired: boolean;
  /** Viable strategies actually promoted to RecoveryStrategy rows in this attempt. */
  readonly viableStrategyCount: number;
  /** True when a validated recommendation was produced for the viable set. */
  readonly recommendationProduced: boolean;
}

/**
 * Map the terminal facts of one completed planning attempt to the closed
 * outcome vocabulary. Deterministic precedence:
 *   1. a stale basis can never yield a usable plan => STALE_RETRY_REQUIRED;
 *   2. promoted viable strategies WITH a validated recommendation =>
 *      AWAITING_AUTHORITY (the operator chooses among honest options);
 *   3. viable strategies but no recommendation, exhausted research, or a
 *      required operator decision => NEEDS_EVIDENCE_OR_DECISION (bounded
 *      planning stops and asks; it never fabricates);
 *   4. nothing viable found => NO_RECOVERY_FOUND (an honest terminal result).
 */
export function planningOutcomeOf(facts: PlanningOutcomeFacts): RecoveryPlanningOutcome {
  if (facts.basisStale) return 'STALE_RETRY_REQUIRED';
  if (facts.viableStrategyCount > 0) {
    if (facts.recommendationProduced && !facts.operatorDecisionRequired) return 'AWAITING_AUTHORITY';
    return 'NEEDS_EVIDENCE_OR_DECISION';
  }
  if (facts.researchBudgetExhausted || facts.operatorDecisionRequired) return 'NEEDS_EVIDENCE_OR_DECISION';
  return 'NO_RECOVERY_FOUND';
}

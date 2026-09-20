/**
 * Map connection / disruption progression onto product ConnectionProgression.
 * Generic — no scenario names.
 */
import type {
  AssessmentTone,
  ConnectionProgression,
  LdgSemanticState,
  ProductOperationalStatus,
  RemainderViability,
} from '../../../contracts/v2/product/readModels.ts';

export type ConnectionViabilityHint = 'VIABLE' | 'TIGHT' | 'IMPOSSIBLE' | 'UNKNOWN';

/**
 * Severity order used to aggregate several connection explanations into one
 * hint. Worst-of: a single IMPOSSIBLE (broken / negative-gap) connection wins
 * over any TIGHT one, regardless of the order the evaluator happened to sort
 * the explanations in (they are ordered by a stable content hash, NOT by
 * severity — see `resolution/evaluation/explain.ts` `dimension()`).
 */
const CONNECTION_SEVERITY: Record<ConnectionViabilityHint, number> = {
  VIABLE: 0,
  UNKNOWN: 1,
  TIGHT: 2,
  IMPOSSIBLE: 3,
};

/** The connection facts this classifier reads. Values use the evaluator's fact vocabulary (string | number | boolean | null). */
export interface ConnectionFacts {
  gapMinutes?: number | string | boolean | null;
}

function numericGap(value: number | string | boolean | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * A5 FIX-2C — derive the connection-viability hint from real M6 evaluator
 * output (the `connection_feasibility` dimension emitted by
 * `resolution/evaluation/evaluators/connection.ts`), never from a caller-
 * supplied SAFE/AT_RISK/IMPOSSIBLE label.
 *
 * The evaluator's own reason codes AND facts distinguish:
 *   - `connection_broken` — a same-place negative gap; waiting cannot recover
 *     it → IMPOSSIBLE (red / actionable);
 *   - `transfer_does_not_fit` — a different-place transfer whose gap is below
 *     the registered transfer time. This is ONLY tight when the gap is still
 *     positive (boardable later); a NEGATIVE gap means the downstream leg has
 *     already departed, which is physically impossible, not merely tight, so it
 *     is IMPOSSIBLE. The classification reads the evaluator's real `gapMinutes`
 *     fact rather than blindly treating every non-broken FAIL as TIGHT;
 *   - `connection_below_minimum` — a positive gap below the registered minimum
 *     connection time → TIGHT (amber / watch).
 *
 * `facts` is optional so existing minimal callers (verdict + reasonCode only)
 * keep working; an absent `gapMinutes` on `transfer_does_not_fit` stays TIGHT
 * (the conservative watch band), never silently upgraded to red. A flattened
 * top-level `gapMinutes` is also accepted for callers that pass a projection of
 * the explanation facts rather than the nested `facts` object.
 */
export function deriveConnectionViabilityFromEvaluator(dimension: {
  verdict: 'PASS' | 'FAIL' | 'UNKNOWN';
  reasonCode: string;
  facts?: ConnectionFacts;
  gapMinutes?: number | string | boolean | null;
}): ConnectionViabilityHint {
  if (dimension.verdict === 'PASS') return 'VIABLE';
  if (dimension.verdict === 'UNKNOWN') return 'UNKNOWN';
  // FAIL — use the evaluator's actual reason/facts semantics.
  if (dimension.reasonCode === 'connection_broken') return 'IMPOSSIBLE';
  if (dimension.reasonCode === 'transfer_does_not_fit') {
    const gap = numericGap(dimension.facts?.gapMinutes) ?? numericGap(dimension.gapMinutes);
    // A negative transfer gap = the onward leg has departed; not recoverable by
    // waiting. A non-negative (but below-transfer) gap stays a watch condition.
    return gap !== undefined && gap < 0 ? 'IMPOSSIBLE' : 'TIGHT';
  }
  // `connection_below_minimum` (positive gap below MCT) and any other FAIL code
  // stay in the watch band; only the explicit impossible cases above go red.
  return 'TIGHT';
}

/**
 * A5 FIX-2 — the ONE shared deterministic connection classification every
 * consumer reads (product status, remainder viability, graph semantic state,
 * planning eligibility, progression). It aggregates truthfully across the WHOLE
 * assessment so information is never lost to first-item ordering:
 *
 *   - `connectionViability` is the worst-of hint across ALL failing explanations
 *     of the `connection_feasibility` dimension (a broken connection anywhere in
 *     the set wins, independent of explanation order / content-hash sorting);
 *   - `separateBlockingFailure` is true when some OTHER applicable, blocking
 *     dimension definitively FAILs — so a merely-tight connection cannot project
 *     the whole trip as watchable amber while a separate failure is already red.
 *
 * Pure; no scenario/traveller/route identity.
 */
export interface ConnectionClassification {
  /** Worst-of connection hint, or `undefined` when no connection dimension applies. */
  readonly connectionViability?: ConnectionViabilityHint;
  /** True when a non-connection applicable+blocking dimension definitively FAILs. */
  readonly separateBlockingFailure: boolean;
}

/** Minimal structural assessment shape the classifier reads (status/facts optional). */
export interface ClassifiableAssessment {
  overallVerdict?: 'PASS' | 'FAIL' | 'UNKNOWN';
  dimensions: readonly {
    dimension: string;
    applicable: boolean;
    blocking?: boolean;
    verdict: 'PASS' | 'FAIL' | 'UNKNOWN';
    explanations: readonly {
      status?: 'PASS' | 'FAIL' | 'UNKNOWN';
      reasonCode: string;
      facts?: ConnectionFacts;
    }[];
  }[];
}

function worstHint(a: ConnectionViabilityHint | undefined, b: ConnectionViabilityHint): ConnectionViabilityHint {
  return a === undefined || CONNECTION_SEVERITY[b] > CONNECTION_SEVERITY[a] ? b : a;
}

export function classifyAssessmentConnection(assessment: ClassifiableAssessment | undefined | null): ConnectionClassification {
  const connectionDim = assessment?.dimensions.find((d) => d.dimension === 'connection_feasibility' && d.applicable);
  let connectionViability: ConnectionViabilityHint | undefined;
  if (connectionDim) {
    if (connectionDim.verdict === 'PASS') {
      connectionViability = 'VIABLE';
    } else if (connectionDim.verdict === 'UNKNOWN') {
      connectionViability = 'UNKNOWN';
    } else {
      // FAIL: aggregate worst-of across the FAILING explanations only. When an
      // explanation carries no `status` (minimal callers), treat every supplied
      // explanation as a candidate so single-explanation callers still work.
      const failing = connectionDim.explanations.filter((e) => e.status === undefined || e.status === 'FAIL');
      const considered = failing.length > 0 ? failing : connectionDim.explanations;
      for (const explanation of considered) {
        connectionViability = worstHint(
          connectionViability,
          deriveConnectionViabilityFromEvaluator({
            verdict: 'FAIL',
            reasonCode: explanation.reasonCode,
            ...(explanation.facts ? { facts: explanation.facts } : {}),
          }),
        );
      }
    }
  }
  const separateBlockingFailure = (assessment?.dimensions ?? []).some(
    (d) => d.applicable && d.blocking !== false && d.verdict === 'FAIL' && d.dimension !== 'connection_feasibility',
  );
  return { ...(connectionViability ? { connectionViability } : {}), separateBlockingFailure };
}

/**
 * Product operational status preserves the evaluator distinction between a
 * policy-tight connection (watch / amber) and a physically broken one (needs
 * attention / red). Whole-trip FAIL alone must not collapse both into
 * DISRUPTED — Overview and Event Overview already understand AT_RISK.
 *
 * A5 FIX-2B — amber means a GENUINELY watchable overall state: it is only
 * projected when a tight connection is the failure and no SEPARATE blocking
 * dimension (programme, objectives, …) definitively FAILs. A tight connection
 * plus a separate definitive blocking failure is red/DISRUPTED, because the
 * trip is not merely watchable — something else has already failed.
 */
export function productStatusFromAssessment(
  tone: AssessmentTone,
  connectionViability?: ConnectionViabilityHint,
  separateBlockingFailure = false,
): ProductOperationalStatus {
  if (tone === 'PASS') return 'READY';
  if (tone === 'UNKNOWN') return 'UNKNOWN';
  if (connectionViability === 'TIGHT' && !separateBlockingFailure) return 'AT_RISK';
  return 'DISRUPTED';
}

export function remainderViabilityFromAssessment(
  tone: AssessmentTone,
  connectionViability?: ConnectionViabilityHint,
  separateBlockingFailure = false,
): RemainderViability {
  if (tone === 'PASS') return 'VIABLE';
  if (tone === 'UNKNOWN') return 'UNKNOWN';
  if (connectionViability === 'TIGHT' && !separateBlockingFailure) return 'AT_RISK';
  return 'NOT_VIABLE';
}

/** Overview/Case graph node colour from the same connection-aware rule. */
export function semanticStateFromAssessment(
  tone: AssessmentTone,
  connectionViability?: ConnectionViabilityHint,
  separateBlockingFailure = false,
): LdgSemanticState {
  if (tone === 'PASS') return 'HEALTHY';
  if (tone === 'UNKNOWN') return 'UNKNOWN';
  if (connectionViability === 'TIGHT' && !separateBlockingFailure) return 'AFFECTED';
  return 'FAILED';
}

/**
 * Extract connection viability from a CURRENT assessment's connection
 * dimension, when present. Absent dimension → undefined (caller treats as
 * non-connection FAIL).
 *
 * A5 FIX-2A — aggregates the worst-of hint across ALL failing connection
 * explanations (via `classifyAssessmentConnection`), so a broken connection
 * cannot be hidden because another explanation sorts first. Explanations are
 * ordered by a stable content hash, never by severity, so reading only
 * `explanations[0]` was an information-loss defect.
 */
export function connectionViabilityFromAssessment(assessment: ClassifiableAssessment | undefined | null): ConnectionViabilityHint | undefined {
  return classifyAssessmentConnection(assessment).connectionViability;
}

export function mapConnectionProgression(input: {
  viability?: ConnectionViabilityHint;
  caseStatus?: string;
  partialRecoveryIncomplete?: boolean;
  allMandatoryActionsComplete?: boolean;
  wholeTripPass?: boolean;
}): ConnectionProgression {
  if (input.wholeTripPass && input.allMandatoryActionsComplete) return 'RECOVERED';
  if (input.partialRecoveryIncomplete) return 'STILL_UNRESOLVED';

  // A tight (below-minimum, still physically possible) connection stays in the
  // watch band even when a Case has opened or planning has already produced a
  // candidate. Premature AWAITING_AUTHORITY must not skip amber → red.
  if (input.viability === 'TIGHT'
    && input.caseStatus !== 'EXECUTING'
    && input.caseStatus !== 'RESOLVED'
    && input.caseStatus !== 'CLOSED') {
    return 'CONNECTION_AT_RISK';
  }

  if (input.caseStatus === 'AWAITING_AUTHORITY') return 'AWAITING_APPROVAL';
  if (input.caseStatus === 'EXECUTING') return 'EXECUTING_COORDINATED_RECOVERY';
  if (input.caseStatus === 'PLANNING' || input.caseStatus === 'OPEN') {
    if (input.viability === 'IMPOSSIBLE') return 'RECOVERY_PLANNING';
    return 'RECOVERY_PLANNING';
  }
  if (input.caseStatus === 'RESOLVED' || input.caseStatus === 'CLOSED') return 'RECOVERED';

  switch (input.viability) {
    case 'VIABLE':
      return 'CONNECTION_SAFE';
    case 'TIGHT':
      return 'CONNECTION_AT_RISK';
    case 'IMPOSSIBLE':
      return 'CONNECTION_IMPOSSIBLE';
    default:
      return 'HEALTHY';
  }
}

/**
 * True when a failing assessment warrants recovery planning (irreversible
 * replacement research), not merely operator monitoring.
 *
 * A connection that is only below the registered minimum (TIGHT / positive
 * gap) opens a Case for watchfulness but does not yet justify selling a
 * replacement. Physically broken connections (IMPOSSIBLE) and any other
 * blocking dimension (programme, objectives, …) remain planning-eligible.
 *
 * A5 FIX-2 — reads the SHARED `classifyAssessmentConnection` so eligibility
 * aggregates the whole failing-explanation set (never `explanations[0]`): a
 * broken connection anywhere in the set is eligible even if a tight one sorts
 * first, and a `transfer_does_not_fit` with a negative gap is eligible.
 */
export function recoveryPlanningEligibleFromAssessment(assessment: ClassifiableAssessment & {
  overallVerdict: 'PASS' | 'FAIL' | 'UNKNOWN';
}): boolean {
  if (assessment.overallVerdict !== 'FAIL') return false;
  const classification = classifyAssessmentConnection(assessment);
  // A separate blocking (non-connection) dimension failing is always eligible.
  if (classification.separateBlockingFailure) return true;
  // Otherwise eligibility rests on the connection truth: only an IMPOSSIBLE
  // (broken / negative-gap) connection justifies replacement planning; a merely
  // TIGHT connection stays monitorable and is NOT planning-eligible.
  return classification.connectionViability === 'IMPOSSIBLE';
}

/** Progressive delay path used by Jordan S2 acceptance (fixture timings later). */
export const JORDAN_CONNECTION_PROGRESSION_PATH: readonly ConnectionProgression[] = [
  'HEALTHY',
  'CONNECTION_SAFE',
  'CONNECTION_AT_RISK',
  'CONNECTION_IMPOSSIBLE',
  'RECOVERY_PLANNING',
  'AWAITING_APPROVAL',
  'EXECUTING_COORDINATED_RECOVERY',
  'CHECKING_RESULTS',
  'RECOVERED',
] as const;

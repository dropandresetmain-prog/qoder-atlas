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
 * M9 3A — derive the connection-viability hint from real M6 evaluator output
 * (the `connection_feasibility` dimension emitted by `resolution/evaluation/
 * evaluators/connection.ts`), never from a caller-supplied SAFE/AT_RISK/
 * IMPOSSIBLE label. The evaluator's own reason codes already distinguish a
 * broken (negative-gap) connection from one that is merely below the
 * registered minimum (positive gap, still insufficient) — this function only
 * maps that real distinction onto the existing `ConnectionViabilityHint`
 * union that `mapConnectionProgression` already consumes.
 */
export function deriveConnectionViabilityFromEvaluator(dimension: {
  verdict: 'PASS' | 'FAIL' | 'UNKNOWN';
  reasonCode: string;
}): ConnectionViabilityHint {
  if (dimension.verdict === 'PASS') return 'VIABLE';
  if (dimension.verdict === 'UNKNOWN') return 'UNKNOWN';
  // FAIL: 'connection_broken' / 'transfer_does_not_fit' with a negative gap is
  // no longer recoverable by waiting; a positive-but-insufficient gap
  // ('connection_below_minimum') is tight but not yet impossible.
  if (dimension.reasonCode === 'connection_broken') return 'IMPOSSIBLE';
  return 'TIGHT';
}

/**
 * Product operational status preserves the evaluator distinction between a
 * policy-tight connection (watch / amber) and a physically broken one (needs
 * attention / red). Whole-trip FAIL alone must not collapse both into
 * DISRUPTED — Overview and Event Overview already understand AT_RISK.
 *
 * Non-connection FAIL (programme, objectives, …) stays DISRUPTED when no
 * tight-connection viability is present.
 */
export function productStatusFromAssessment(
  tone: AssessmentTone,
  connectionViability?: ConnectionViabilityHint,
): ProductOperationalStatus {
  if (tone === 'PASS') return 'READY';
  if (tone === 'UNKNOWN') return 'UNKNOWN';
  if (connectionViability === 'TIGHT') return 'AT_RISK';
  return 'DISRUPTED';
}

export function remainderViabilityFromAssessment(
  tone: AssessmentTone,
  connectionViability?: ConnectionViabilityHint,
): RemainderViability {
  if (tone === 'PASS') return 'VIABLE';
  if (tone === 'UNKNOWN') return 'UNKNOWN';
  if (connectionViability === 'TIGHT') return 'AT_RISK';
  return 'NOT_VIABLE';
}

/** Overview/Case graph node colour from the same connection-aware rule. */
export function semanticStateFromAssessment(
  tone: AssessmentTone,
  connectionViability?: ConnectionViabilityHint,
): LdgSemanticState {
  if (tone === 'PASS') return 'HEALTHY';
  if (tone === 'UNKNOWN') return 'UNKNOWN';
  if (connectionViability === 'TIGHT') return 'AFFECTED';
  return 'FAILED';
}

/**
 * Extract connection viability from a CURRENT assessment's connection
 * dimension, when present. Absent dimension → undefined (caller treats as
 * non-connection FAIL).
 */
export function connectionViabilityFromAssessment(assessment: {
  dimensions: readonly {
    dimension: string;
    applicable: boolean;
    verdict: 'PASS' | 'FAIL' | 'UNKNOWN';
    explanations: readonly { reasonCode: string }[];
  }[];
} | undefined | null): ConnectionViabilityHint | undefined {
  const connectionDim = assessment?.dimensions.find((d) => d.dimension === 'connection_feasibility' && d.applicable);
  if (!connectionDim) return undefined;
  return deriveConnectionViabilityFromEvaluator({
    verdict: connectionDim.verdict,
    reasonCode: connectionDim.explanations[0]?.reasonCode ?? '',
  });
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
 */
export function recoveryPlanningEligibleFromAssessment(assessment: {
  overallVerdict: 'PASS' | 'FAIL' | 'UNKNOWN';
  dimensions: readonly {
    dimension: string;
    applicable: boolean;
    blocking: boolean;
    verdict: 'PASS' | 'FAIL' | 'UNKNOWN';
    explanations: readonly { reasonCode: string }[];
  }[];
}): boolean {
  if (assessment.overallVerdict !== 'FAIL') return false;
  const blocking = assessment.dimensions.filter(
    (d) => d.applicable && d.blocking && d.verdict === 'FAIL',
  );
  if (blocking.length === 0) return false;
  if (blocking.some((d) => d.dimension !== 'connection_feasibility')) return true;
  return blocking.some((d) => deriveConnectionViabilityFromEvaluator({
    verdict: 'FAIL',
    reasonCode: d.explanations[0]?.reasonCode ?? '',
  }) === 'IMPOSSIBLE');
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

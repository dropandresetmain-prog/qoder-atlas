/**
 * Map connection / disruption progression onto product ConnectionProgression.
 * Generic — no scenario names.
 */
import type { ConnectionProgression } from '../../../contracts/v2/product/readModels.ts';

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

export function mapConnectionProgression(input: {
  viability?: ConnectionViabilityHint;
  caseStatus?: string;
  partialRecoveryIncomplete?: boolean;
  allMandatoryActionsComplete?: boolean;
  wholeTripPass?: boolean;
}): ConnectionProgression {
  if (input.wholeTripPass && input.allMandatoryActionsComplete) return 'RECOVERED';
  if (input.partialRecoveryIncomplete) return 'STILL_UNRESOLVED';
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

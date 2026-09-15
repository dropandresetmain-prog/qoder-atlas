/**
 * Map connection / disruption progression onto product ConnectionProgression.
 * Generic — no scenario names.
 */
import type { ConnectionProgression } from '../../../contracts/v2/product/readModels.ts';

export type ConnectionViabilityHint = 'VIABLE' | 'TIGHT' | 'IMPOSSIBLE' | 'UNKNOWN';

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

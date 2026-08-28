/**
 * R3D — deterministic managed-travel presentation mapping.
 *
 * Backend/read-model status remains authoritative. This module collapses
 * managed-travel state into four operator-facing buckets for Overview and
 * Programme summary/fleet surfaces only. Local/self-arranged travellers are
 * an arrangement cohort, not a fifth workflow status.
 */
import type { ReadModelStatus, RemainderViability } from '../contracts/readmodels.ts';
import type { IsoDateTime } from '../domain/common.ts';

/** Four managed-travel workflow buckets shown on Overview / Programme. */
export type ManagedTravelPresentation =
  | 'CONFIRMED'
  | 'NEEDS_ATTENTION'
  | 'WATCHING'
  | 'UNCONFIRMED';

/** Fleet cell presentation: managed buckets plus Local arrangement cohort. */
export type FleetCellPresentation = ManagedTravelPresentation | 'LOCAL';

/**
 * Roster row operator-attention projection: managed workflow buckets plus LOCAL
 * for self-arranged travellers with no operator recovery work. Distinct from
 * fleet/travel-management colour (always LOCAL for self-arranged).
 */
export type RosterAttentionPresentation = ManagedTravelPresentation | 'LOCAL';

export const MANAGED_TRAVEL_LABEL: Record<ManagedTravelPresentation, string> = {
  CONFIRMED: 'Confirmed',
  NEEDS_ATTENTION: 'Needs Attention',
  WATCHING: 'Watching',
  UNCONFIRMED: 'Unconfirmed',
};

/** Dotgrid / roster-dot CSS class for each fleet presentation. */
export const FLEET_CELL_CLASS: Record<FleetCellPresentation, string> = {
  CONFIRMED: 'd-ok',
  NEEDS_ATTENTION: 'd-bad',
  WATCHING: 'd-watch',
  UNCONFIRMED: 'd-unconfirmed',
  LOCAL: 'd-local',
};

export interface ManagedTravelPresentationInput {
  status: ReadModelStatus;
  /** Explicit intake arrangement; Local cohort is separated before mapping. */
  travelArrangement?: 'NORTHSTAR_ARRANGED' | 'SELF_OR_OTHER_ARRANGED' | 'UNSPECIFIED';
  /** Pending human/traveller decisions currently requiring action. */
  pendingDecisionCount?: number;
  /** Traveller response gate when the case is waiting on the traveller. */
  travellerResponseStatus?: 'AWAITING' | 'RESPONDED' | 'NOT_REQUIRED';
}

/** Inputs for roster attention queue and row presentation attributes. */
export interface RosterPresentationInput extends ManagedTravelPresentationInput {
  /** Propagated whole-trip viability; independent of workflow status. */
  remainderViable?: RemainderViability;
  /** Open operator case exists (may be fan-out tracking only). */
  hasActiveCase?: boolean;
}

/**
 * Map authoritative trip/case signals to one managed-travel presentation
 * bucket. Does not mutate backend state.
 *
 * Action-required signals (disrupted, awaiting traveller/approval input)
 * outrank a calm underlying status so Overview/Programme never hide work.
 */
export function mapManagedTravelPresentation(
  input: ManagedTravelPresentationInput,
): ManagedTravelPresentation {
  const pending = input.pendingDecisionCount ?? 0;
  const awaitingTraveller =
    input.travellerResponseStatus === 'AWAITING' || input.status === 'NEEDS_TRAVELLER_INFO';

  if (input.status === 'UNKNOWN') return 'UNCONFIRMED';

  if (
    input.status === 'DISRUPTED' ||
    awaitingTraveller ||
    pending > 0
  ) {
    return 'NEEDS_ATTENTION';
  }

  if (input.status === 'READY' || input.status === 'RESOLVED') {
    return 'CONFIRMED';
  }

  // AT_RISK / RECOVERING / PLANNING / CHANGE_REQUESTED without a pending ask
  return 'WATCHING';
}

/** Fleet cell class for one participant row (Local cohort checked first). */
export function fleetPresentation(input: ManagedTravelPresentationInput): FleetCellPresentation {
  if (input.travelArrangement === 'SELF_OR_OTHER_ARRANGED') return 'LOCAL';
  return mapManagedTravelPresentation(input);
}

export function fleetCellClassFor(input: ManagedTravelPresentationInput): string {
  return FLEET_CELL_CLASS[fleetPresentation(input)];
}

/**
 * Fleet presentation that keeps self-arranged travellers visible when a shared
 * programme incident touches them. A self-arranged trip with an active case or
 * at-risk/unknown viability is WATCHING (amber), not silently LOCAL — but it is
 * never escalated to red unless a managed-recovery ask exists.
 */
export function fleetPresentationForRoster(input: RosterPresentationInput): FleetCellPresentation {
  if (input.travelArrangement === 'SELF_OR_OTHER_ARRANGED') {
    const programmeTouched =
      input.hasActiveCase ||
      input.remainderViable === 'AT_RISK' ||
      input.remainderViable === 'UNKNOWN';
    if (programmeTouched && input.remainderViable !== 'NOT_VIABLE') return 'WATCHING';
    return 'LOCAL';
  }
  return mapManagedTravelPresentation(input);
}

export function fleetCellClassForRoster(input: RosterPresentationInput): string {
  return FLEET_CELL_CLASS[fleetPresentationForRoster(input)];
}

export interface ManagedTravelBucketCounts {
  confirmed: number;
  needsAttention: number;
  watching: number;
  unconfirmed: number;
}

/** Aggregate managed-travel rows into the four presentation buckets. */
export function countManagedTravelBuckets(
  rows: readonly ManagedTravelPresentationInput[],
): ManagedTravelBucketCounts {
  const counts: ManagedTravelBucketCounts = {
    confirmed: 0,
    needsAttention: 0,
    watching: 0,
    unconfirmed: 0,
  };
  for (const row of rows) {
    if (row.travelArrangement === 'SELF_OR_OTHER_ARRANGED') continue;
    const bucket = mapManagedTravelPresentation(row);
    if (bucket === 'CONFIRMED') counts.confirmed += 1;
    else if (bucket === 'NEEDS_ATTENTION') counts.needsAttention += 1;
    else if (bucket === 'WATCHING') counts.watching += 1;
    else counts.unconfirmed += 1;
  }
  return counts;
}

/**
 * Sort fleet participants by earliest upcoming commitment time.
 * Presentation-only: missing/no upcoming commitment sorts last; ties by tripId.
 */
export function compareByEarliestCommitment(
  a: { tripId: string; earliestCommitmentAt?: IsoDateTime },
  b: { tripId: string; earliestCommitmentAt?: IsoDateTime },
): number {
  const aTime = a.earliestCommitmentAt;
  const bTime = b.earliestCommitmentAt;
  if (aTime && bTime) {
    const diff = aTime.localeCompare(bTime);
    if (diff !== 0) return diff;
  } else if (aTime && !bTime) {
    return -1;
  } else if (!aTime && bTime) {
    return 1;
  }
  return a.tripId.localeCompare(b.tripId);
}

/** Urgency ordering for attention lists (Overview roster / Programme table). */
export const ATTENTION_PRIORITY: Record<ManagedTravelPresentation, number> = {
  NEEDS_ATTENTION: 0,
  WATCHING: 1,
  UNCONFIRMED: 2,
  CONFIRMED: 3,
};

/** Roster sort priority including the LOCAL travel cohort bucket. */
export const ROSTER_ATTENTION_PRIORITY: Record<RosterAttentionPresentation, number> = {
  NEEDS_ATTENTION: 0,
  WATCHING: 1,
  UNCONFIRMED: 2,
  LOCAL: 3,
  CONFIRMED: 4,
};

/**
 * True when the operator must act (approval, traveller input, or managed-travel
 * recovery). Programme fan-out on a viable local traveller does not qualify.
 */
export function requiresOperatorRecoveryAttention(input: RosterPresentationInput): boolean {
  const pending = input.pendingDecisionCount ?? 0;
  const awaitingTraveller =
    input.travellerResponseStatus === 'AWAITING' || input.status === 'NEEDS_TRAVELLER_INFO';
  if (pending > 0 || awaitingTraveller) return true;

  if (input.travelArrangement === 'SELF_OR_OTHER_ARRANGED') {
    return false;
  }

  if (input.status === 'DISRUPTED') return true;
  if (input.hasActiveCase && input.remainderViable === 'NOT_VIABLE') return true;
  return mapManagedTravelPresentation(input) === 'NEEDS_ATTENTION';
}

/**
 * Operator-facing roster attention state for sorting and data-presentation.
 * Preserves travel arrangement (badge/dot), programme consequence (WATCHING),
 * and recovery intervention (NEEDS_ATTENTION) as separate ideas.
 */
export function rosterAttentionPresentation(
  input: RosterPresentationInput,
): RosterAttentionPresentation {
  if (requiresOperatorRecoveryAttention(input)) {
    return mapManagedTravelPresentation(input);
  }

  if (input.travelArrangement === 'SELF_OR_OTHER_ARRANGED') {
    const programmeTouched =
      input.hasActiveCase ||
      input.remainderViable === 'AT_RISK' ||
      input.remainderViable === 'UNKNOWN';
    if (programmeTouched && input.remainderViable !== 'NOT_VIABLE') {
      return 'WATCHING';
    }
    return 'LOCAL';
  }

  return mapManagedTravelPresentation(input);
}

export function compareByAttentionThenId(
  a: ManagedTravelPresentationInput & { tripId: string },
  b: ManagedTravelPresentationInput & { tripId: string },
): number {
  const aBucket = mapManagedTravelPresentation(a);
  const bBucket = mapManagedTravelPresentation(b);
  const diff = ATTENTION_PRIORITY[aBucket] - ATTENTION_PRIORITY[bBucket];
  return diff !== 0 ? diff : a.tripId.localeCompare(b.tripId);
}

export function compareRosterAttentionThenId(
  a: RosterPresentationInput & { tripId: string },
  b: RosterPresentationInput & { tripId: string },
): number {
  const aBucket = rosterAttentionPresentation(a);
  const bBucket = rosterAttentionPresentation(b);
  const diff = ROSTER_ATTENTION_PRIORITY[aBucket] - ROSTER_ATTENTION_PRIORITY[bBucket];
  return diff !== 0 ? diff : a.tripId.localeCompare(b.tripId);
}

/** Page size contracts locked by R3D user tests. */
export const OVERVIEW_ROSTER_PAGE_SIZE = 10;
export const ACTIVITY_PAGE_SIZE = 20;
export const CASE_PRIMARY_OPTION_LIMIT = 3;

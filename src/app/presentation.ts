/** Deterministic boundary between operational evidence and user-facing copy. */
import type { Constraint } from '../domain/constraints.ts';
import type { TripSignal } from '../operational/signal.ts';
import type { CaseResolution } from '../operational/case.ts';
import type { CandidateRejectionEvidence } from './planningLoop.ts';

export function presentCandidateRejection(evidence: readonly CandidateRejectionEvidence[], constraints: readonly Constraint[]): string | undefined {
  const first = evidence[0];
  if (!first) return undefined;
  if (first.kind === 'NO_CANDIDATE_OPERATIONS') return 'This option does not include a workable change.';
  if (first.kind === 'OVERLAY_REJECTED') return 'This option could not be checked safely.';
  if (first.status === 'UNKNOWN') return 'This option cannot be verified against one required trip condition.';
  const constraint = constraints.find((candidate) => candidate.id === first.constraintId);
  return constraint?.kind === 'TEMPORAL'
    ? 'This option does not meet a required timing condition.'
    : 'This option does not meet one required trip condition.';
}

/** Outcome and recorded losses are authoritative; stored trace text is not presentation copy. */
export function presentResolution(resolution: CaseResolution): string {
  switch (resolution.outcome) {
    case 'FULLY_RECOVERED': return 'Your trip is back on track.';
    case 'RECOVERED_WITH_LOSS': return 'The trip is workable again, but one original objective could not be preserved.';
    case 'ESCALATED_CLOSED': return 'This trip needs direct support to resolve.';
  }
}

export function presentUncertainties(raw: readonly string[]): string[] {
  return raw.length > 0 ? ['Some trip details still need confirmation.'] : [];
}

export function presentConstraintLabel(constraint: Constraint | undefined): string {
  return constraint?.description ?? 'Required trip condition';
}

export function presentApprovalReason(): string {
  return 'This change needs approval before it can proceed.';
}

export function presentActivity(action: string): string {
  const copy: Record<string, string> = {
    SIGNAL_PROCESSED: 'Trip change recorded',
    MUTATION_APPLIED: 'Trip details updated',
    PLANNING_COMPLETED: 'Recovery options planned and checked',
    AUTHORITY_DECIDED: 'Approval requirement determined',
    APPROVAL_RECORDED: 'Approval decision recorded',
    APPROVAL_REJECTED: 'Approval request refused',
    EXECUTION_COMPLETED: 'Recovery action executed',
    EXECUTION_REFUSED: 'Action blocked by the authority gate',
    CASE_VERIFIED: 'Recovery outcome verified against the trip',
  };
  return copy[action] ?? 'Trip activity recorded';
}

export function presentAction(operation: string): string {
  const copy: Record<string, string> = {
    'flight.change': 'Rebooking the flight',
    'flight.cancel': 'Cancelling the flight',
    'hotel.modify': 'Updating the hotel stay',
    'hotel.cancel': 'Cancelling the hotel stay',
    'simulation.provider_action': 'Applying the provider change',
  };
  return copy[operation] ?? 'Applying the travel change';
}

/**
 * Provider and engine signal vocabulary is useful audit evidence, not product
 * copy. Preserve an authored human sentence when one exists; otherwise map
 * the stable signal kind to a calm, provider-neutral explanation.
 */
export function presentSignalChange(signal: TripSignal): string {
  const summary = signal.summary?.trim();
  const looksInternal = summary
    ? /provider\s+(flight|stay)\s+state\s*:|\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/i.test(summary)
    : true;
  if (summary && !looksInternal) return summary;

  const copy: Record<TripSignal['kind'], string> = {
    FLIGHT_CANCELLATION: 'The airline cancelled the flight.',
    FLIGHT_SCHEDULE_CHANGE: 'The airline changed the flight schedule.',
    FLIGHT_DELAY: 'The airline reported a delay.',
    BOOKING_STATE_CHANGE: 'The provider changed the booking status.',
    PROVIDER_EVENT: 'A travel provider reported a change.',
    WEATHER_EVENT: 'Weather may affect this trip.',
    TRAVELLER_INPUT: 'The traveller asked for a trip change.',
    OPERATOR_INPUT: 'The operator reported a trip change.',
    ANCHOR_COMMITMENT_CHANGE: 'An event commitment changed.',
    OTHER: 'New information changed this trip.',
  };
  return copy[signal.kind];
}

/** Deterministic boundary between operational evidence and user-facing copy. */
import type { Constraint } from '../domain/constraints.ts';
import type { TripSignal } from '../operational/signal.ts';
import type { CaseResolution } from '../operational/case.ts';
import type { CostAllocation } from '../operational/intent.ts';
import type { CandidateRejectionEvidence } from './planningLoop.ts';
import { formatMoney } from '../ui/html.ts';

export function presentCandidateRejection(evidence: readonly CandidateRejectionEvidence[], constraints: readonly Constraint[]): string | undefined {
  const first = evidence[0];
  if (!first) return undefined;
  if (first.kind === 'NO_CANDIDATE_OPERATIONS') return 'This option does not include a workable change.';
  if (first.kind === 'OVERLAY_REJECTED') return 'This option could not be checked safely.';
  if (first.kind === 'DIRECT_FAILURE') return 'This option still leaves a broken connection or failed leg.';
  if (first.kind === 'CONSTRAINT' && first.status === 'UNKNOWN') return 'This option cannot be verified against one required trip condition.';
  if (first.kind === 'CONSTRAINT') {
    const constraint = constraints.find((candidate) => candidate.id === first.constraintId);
    return constraint?.kind === 'TEMPORAL'
      ? 'This option does not meet a required timing condition.'
      : 'This option does not meet one required trip condition.';
  }
  return undefined;
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
  if (!constraint) return 'Required trip condition';
  switch (constraint.kind) {
    case 'TEMPORAL':
      return constraint.description?.includes('buffer')
        ? 'Arrival leaves enough time before the commitment'
        : 'Timing still works for the commitment';
    case 'POLICY':
      return 'Travel grouping stays within policy limits';
    case 'FINANCIAL':
      return 'Cost stays within the programme policy';
    default:
      return constraint.description?.length && constraint.description.length < 120
        ? constraint.description
        : 'Required trip condition';
  }
}

/**
 * Parse evaluator evidence such as `gap 370min >= required 360min` into
 * judge-facing consequence copy. Raw minute arithmetic stays in the
 * machine-readable evidence; screens render the outcome.
 */
export function presentBufferEvidence(evidence: string | undefined): string | undefined {
  if (!evidence) return undefined;
  const match = /gap\s+(-?\d+)\s*min\s*(>=|<)\s*required\s+(\d+)\s*min/i.exec(evidence);
  if (!match) return undefined;
  const available = Number(match[1]);
  const comparator = match[2];
  const required = Number(match[3]);
  if (!Number.isFinite(available) || !Number.isFinite(required)) return undefined;
  if (comparator === '<' || available < required) {
    return 'Arrival does not leave enough preparation time before the commitment';
  }
  return 'Arrival leaves enough preparation time before the commitment';
}

const CHECK_RESULT_PREFIX: Record<'PASS' | 'FAIL' | 'UNKNOWN', string> = {
  PASS: 'Still meets',
  FAIL: 'No longer meets',
  UNKNOWN: 'Still checking',
};

/** Hero-facing consequence copy for buffer/timing evidence — no raw minute arithmetic. */
function presentBufferConsequence(
  evidence: string | undefined,
  result: 'PASS' | 'FAIL' | 'UNKNOWN',
): string | undefined {
  if (!evidence || !/gap\s+-?\d+\s*min/i.test(evidence)) return undefined;
  if (result === 'PASS') return 'Arrival still leaves enough time before the commitment';
  if (result === 'FAIL') return 'Arrival no longer protects the programme commitment';
  return 'Still checking arrival timing against the commitment';
}

/** Plain-language check row for operator case view. */
export function presentCheckLabel(
  constraint: Constraint | undefined,
  result: 'PASS' | 'FAIL' | 'UNKNOWN',
  evidence?: string,
): string {
  const buffer = presentBufferConsequence(evidence, result);
  if (buffer) return buffer;

  const base = presentConstraintLabel(constraint);
  if (result === 'PASS') {
    if (base.includes('Arrival')) return 'Arrival still leaves enough time before the commitment';
    if (base.includes('Timing')) return 'Timing still works for the commitment';
    if (base.includes('Hotel') || base.includes('stay')) return 'Hotel booking remains valid';
    return `${CHECK_RESULT_PREFIX.PASS}: ${base.charAt(0).toLowerCase()}${base.slice(1)}`;
  }
  if (result === 'FAIL') {
    if (base.includes('Arrival') || base.includes('buffer')) {
      return 'Original plan no longer meets the required arrival buffer';
    }
    // Never produce contradictory copy like "No longer meets: timing still works".
    if (base.includes('Timing') || /still works/i.test(base)) {
      return 'Timing no longer works for the commitment';
    }
    if (base.includes('Hotel') || base.includes('stay')) {
      return 'Hotel booking no longer satisfies the required stay window';
    }
    if (base.includes('grouping') || base.includes('policy')) {
      return 'No longer within the required policy limits';
    }
    return `Required condition failed: ${base.charAt(0).toLowerCase()}${base.slice(1)}`;
  }
  if (base.includes('transfer') || base.includes('Ground')) return 'Ground transfer timing still unconfirmed';
  return `${CHECK_RESULT_PREFIX.UNKNOWN}: ${base.charAt(0).toLowerCase()}${base.slice(1)}`;
}

export function presentApprovalReason(requestedFrom?: 'TRAVELLER' | 'ORGANISATION' | 'HUMAN_AGENT'): string {
  if (requestedFrom === 'TRAVELLER') {
    return 'This change needs traveller approval before it can proceed.';
  }
  if (requestedFrom === 'ORGANISATION' || requestedFrom === 'HUMAN_AGENT') {
    return 'This change needs organisation approval before it can proceed.';
  }
  return 'This change needs organisation or traveller approval before it can proceed.';
}

/**
 * Judge-facing funding summary: keep describeAllocation semantics but use
 * US$/S$ money convention instead of bare `90.54 USD` fragments.
 */
export function presentAllocationSummary(allocation: CostAllocation | undefined): string | undefined {
  if (!allocation) return undefined;
  if (allocation.coveredAmount && allocation.coveredBy) {
    return `${formatMoney(allocation.coveredAmount)} covered by ${payerPhrase(allocation.coveredBy)}`;
  }
  if (allocation.incrementalAmount && allocation.incrementalPayer) {
    return `${formatMoney(allocation.incrementalAmount)} payable by ${payerPhrase(allocation.incrementalPayer)}`;
  }
  return 'Funding allocation still unresolved';
}

function payerPhrase(payer: CostAllocation['coveredBy'] | CostAllocation['incrementalPayer']): string {
  switch (payer) {
    case 'EVENT_ORGANISATION':
      return 'the event organisation';
    case 'ORGANISATION':
      return 'the organisation';
    case 'TRAVELLER':
      return 'the traveller';
    default:
      return 'another payer';
  }
}

const SIGNAL_KIND_ACTIVITY: Record<string, string> = {
  FLIGHT_CANCELLATION: 'reported a flight cancellation',
  FLIGHT_SCHEDULE_CHANGE: 'reported a schedule change',
  FLIGHT_DELAY: 'reported a flight delay',
  BOOKING_STATE_CHANGE: 'reported a booking status change',
  PROVIDER_EVENT: 'reported a provider change',
  WEATHER_EVENT: 'reported weather that may affect the trip',
  TRAVELLER_INPUT: 'received a traveller update',
  OPERATOR_INPUT: 'received an operator update',
  ANCHOR_COMMITMENT_CHANGE: 'recorded a programme change',
  OTHER: 'recorded new trip information',
};

const AUTHORITY_OUTCOME_ACTIVITY: Record<string, string> = {
  REQUIRES_TRAVELLER: 'sent a choice to the traveller',
  REQUIRES_APPROVAL: 'requested approval before proceeding',
  AUTO_APPROVED: 'confirmed the recovery could proceed',
  BLOCKED: 'blocked the recovery action',
};

/** Strip internal IDs and engine vocabulary from activity feed copy. */
export function sanitizeActivityCopy(text: string | undefined): string | undefined {
  if (!text?.trim()) return undefined;
  let out = text.trim();
  out = out.replace(/place-hotel-[a-z0-9-]+/gi, 'Hotel');
  out = out.replace(/place-[a-z0-9-]+/gi, 'Place');
  out = out.replace(/\bel-trip-[a-z0-9-]+/gi, 'linked engagement');
  out = out.replace(/\b(?:trip|case|intent|signal|offer|strategy)-[a-z0-9-]+\b/gi, '');
  out = out.replace(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g, '');
  out = out.replace(/\bproviders?\b/gi, 'Travel provider');
  out = out.replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1').trim();
  if (!out || /^(trip|case|intent|signal|place|el-trip)-/i.test(out)) return undefined;
  return out;
}

export function presentActivity(action: string, payload?: Record<string, unknown>): string {
  const upper = action.toUpperCase();

  if (upper === 'SIGNAL_PROCESSED') {
    const kind = typeof payload?.kind === 'string' ? payload.kind : '';
    if (kind && SIGNAL_KIND_ACTIVITY[kind]) return SIGNAL_KIND_ACTIVITY[kind];
    return 'recorded a trip change';
  }

  if (upper === 'AUTHORITY_DECIDED') {
    const outcome = typeof payload?.outcome === 'string' ? payload.outcome : '';
    if (outcome && AUTHORITY_OUTCOME_ACTIVITY[outcome]) return AUTHORITY_OUTCOME_ACTIVITY[outcome];
    return 'determined what approval was needed';
  }

  if (upper === 'PLANNING_COMPLETED') {
    const count = payload?.feasibleCount ?? payload?.strategyCount;
    if (typeof count === 'number' && count > 0) {
      return `compared ${count} recovery option${count === 1 ? '' : 's'}`;
    }
    return 'checked recovery options';
  }

  if (upper === 'APPROVAL_RECORDED') {
    const verdict = payload?.verdict;
    if (verdict === 'DECLINED') return 'refused the approval request';
    if (verdict === 'APPROVED') return 'recorded the approval decision';
    return 'recorded an approval decision';
  }

  if (upper === 'EXECUTION_COMPLETED') {
    const operation = typeof payload?.operation === 'string' ? payload.operation : '';
    if (operation.includes('flight')) return 'confirmed the replacement flight';
    if (operation.includes('hotel')) return 'confirmed the hotel change';
    return 'completed the recovery action';
  }

  const copy: Record<string, string> = {
    MUTATION_APPLIED: 'updated trip details',
    APPROVAL_REJECTED: 'refused the approval request',
    EXECUTION_REFUSED: 'blocked the recovery action',
    CASE_VERIFIED: 'rechecked the trip after the booking changed',
    CASE_ESCALATED: 'handed the case to human support',
  };
  return copy[upper] ?? 'recorded trip activity';
}

/** Human-facing actor label from audit evidence — never generic "Providers". */
export function presentActivityActor(actor: string, payload?: Record<string, unknown>): string {
  const trimmed = actor?.trim() ?? '';
  if (!trimmed) return 'Northstar';
  // App/system actors are always Northstar — before keyword heuristics.
  if (trimmed === 'system' || trimmed.startsWith('app:')) return 'Northstar';

  if (typeof payload?.['providerId'] === 'string') {
    const id = String(payload['providerId']).toUpperCase();
    if (id.includes('ZIPAIR') || id.includes('ZG')) return 'ZIPAIR';
    if (id.includes('SCOOT') || id.includes('TR')) return 'Scoot';
    if (id.includes('CONCORDE')) return 'Concorde Hotel Singapore';
    if (id.includes('NUITEE') || id.includes('HOTEL')) return 'Hotel';
    if (id.includes('ATLAS') || id.includes('FLIGHT') || id.includes('AIR')) return 'Airline';
  }
  if (typeof payload?.['carrier'] === 'string' && String(payload['carrier']).trim()) {
    return String(payload['carrier']);
  }
  if (typeof payload?.['hotelName'] === 'string' && String(payload['hotelName']).trim()) {
    return String(payload['hotelName']);
  }

  if (/^providers?$/i.test(trimmed)) return 'Travel provider';
  if (/^signal$/i.test(trimmed)) return 'Travel provider';
  if (trimmed.includes('organiser') || trimmed.includes('ait')) return 'AiT organising team';
  if (trimmed.toLowerCase().includes('hotel')) return 'Hotel';
  if (trimmed.toLowerCase().includes('airline') || trimmed.toLowerCase().includes('flight')) return 'Airline';
  if (trimmed.toLowerCase().includes('provider')) return 'Travel provider';
  if (trimmed.toLowerCase().includes('traveller')) return 'Traveller';

  const humanized = trimmed.replace(/-/g, ' ').trim();
  if (!humanized || /^(trip|case|intent|signal|place)-/i.test(humanized)) return 'Northstar';
  return humanized;
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
 * Nominal action label for sentences like "Approval needed before X".
 * `presentAction` produces gerunds for activity feeds; approval queues need
 * the plain action so the sentence reads grammatically.
 */
export function presentActionNoun(operation: string): string {
  const copy: Record<string, string> = {
    'flight.change': 'the flight rebooking',
    'flight.cancel': 'the flight cancellation',
    'hotel.modify': 'the hotel stay change',
    'hotel.cancel': 'the hotel stay cancellation',
    'simulation.provider_action': 'the provider change',
  };
  return copy[operation] ?? 'the travel change';
}

/**
 * Provider and engine signal vocabulary is useful audit evidence, not product
 * copy. Preserve an authored human sentence when one exists; otherwise map
 * the stable signal kind to a calm, provider-neutral explanation.
 */
export function presentSignalChange(signal: TripSignal): string {
  const summary = signal.summary?.trim();
  const looksInternal = summary
    ? /provider\s+(flight|stay)\s+state\s*:|\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b|\bel-trip-|affecting engagement\s+\S+/i.test(
        summary,
      )
    : true;
  if (summary && !looksInternal) {
    return sanitizeActivityCopy(summary) ?? summary;
  }

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
  if (signal.kind === 'ANCHOR_COMMITMENT_CHANGE' && summary) {
    const cleaned = sanitizeActivityCopy(summary);
    if (cleaned) return cleaned;
  }
  return copy[signal.kind];
}

/**
 * Compose operator-facing "what changed" copy from structured case facts.
 * Generic — uses signal kind, threatened commitment, and failed checks only.
 */
export function presentDisruptedCaseSummary(input: {
  signal?: TripSignal;
  criticalObjectiveAtRisk?: string;
  failedCheckLabels?: readonly string[];
}): string | undefined {
  const base = input.signal ? presentSignalChange(input.signal) : undefined;
  const commitment = input.criticalObjectiveAtRisk?.trim();
  const bufferFail = input.failedCheckLabels?.find((label) =>
    /arrival buffer|preparation time|enough time|no longer works for the commitment|no longer protects/i.test(label),
  );

  if (input.signal?.kind === 'FLIGHT_SCHEDULE_CHANGE' && commitment) {
    const arrivalNote = bufferFail
      ? ' The new arrival timing no longer leaves enough preparation time.'
      : ' The new arrival timing threatens the programme commitment.';
    return `The airline rescheduled the inbound flight.${arrivalNote} ${commitment} is now at risk.`;
  }

  if (commitment && bufferFail) {
    return `${base ?? 'This trip changed.'} ${commitment} is now at risk because the new timing no longer leaves enough preparation time.`;
  }

  return base;
}

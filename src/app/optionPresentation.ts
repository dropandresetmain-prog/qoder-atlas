/**
 * Structured recovery-option presentation fields derived from authoritative
 * strategy / viability / authority evidence. Generic — no hero-ID branches.
 */
import type { EntityId, IsoDateTime } from '../domain/common.ts';
import type { Place } from '../domain/entities.ts';
import type { Engagement, TransportLeg } from '../domain/elements.ts';
import type { RecoveryStrategy } from '../operational/strategy.ts';
import type { AuthorityDecision, ActionIntent } from '../operational/intent.ts';
import type { CandidateRejectionEvidence } from './planningLoop.ts';
import type { ViabilityResult } from '../contracts/services.ts';
import { presentBufferEvidence } from './presentation.ts';
import { formatProgrammeInstant } from './presentationProjection.ts';
import { authorityNeededLabel } from '../ui/copy.ts';

function clock(iso: IsoDateTime): string | undefined {
  return /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso)?.slice(4).join(':');
}

function placeCode(place: Place | undefined): string | undefined {
  if (!place) return undefined;
  return place.externalRefs.find((ref) => ref.system === 'airport-code')?.value ?? place.name;
}

function proposedTransportLeg(strategy: RecoveryStrategy): TransportLeg | undefined {
  for (const operation of strategy.candidateOperations) {
    if (
      operation.op === 'UPSERT_ENTITY' &&
      operation.entityType === 'TRIP_ELEMENT' &&
      (operation.data as { elementKind?: string }).elementKind === 'TRANSPORT_LEG'
    ) {
      return operation.data as TransportLeg;
    }
  }
  return undefined;
}

function proposedStayCheckout(strategy: RecoveryStrategy): IsoDateTime | undefined {
  for (const operation of strategy.candidateOperations) {
    if (operation.op === 'UPSERT_FACT' && operation.factPath === 'data.checkOut') {
      const value = operation.value as { value?: IsoDateTime } | IsoDateTime | undefined;
      if (value && typeof value === 'object' && 'value' in value && typeof value.value === 'string') {
        return value.value;
      }
      if (typeof value === 'string') return value;
    }
    if (
      operation.op === 'UPSERT_ENTITY' &&
      operation.entityType === 'TRIP_ELEMENT' &&
      (operation.data as { elementKind?: string }).elementKind === 'STAY'
    ) {
      const stay = operation.data as { data?: { checkOut?: { value?: IsoDateTime } } };
      if (stay.data?.checkOut?.value) return stay.data.checkOut.value;
    }
  }
  return undefined;
}

function minutesBetween(earlier: IsoDateTime, later: IsoDateTime): number | undefined {
  const a = Date.parse(earlier);
  const b = Date.parse(later);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined;
  return Math.round((b - a) / 60_000);
}

function bufferFromViability(viability: ViabilityResult | undefined): string | undefined {
  if (!viability) return undefined;
  for (const result of viability.constraintResults) {
    const label = presentBufferEvidence(result.evidence);
    if (label) return label;
  }
  return undefined;
}

function bufferFromRejection(evidence: readonly CandidateRejectionEvidence[]): string | undefined {
  for (const item of evidence) {
    if (item.kind === 'CONSTRAINT' && item.evidence) {
      const label = presentBufferEvidence(item.evidence);
      if (label) return label;
    }
  }
  return undefined;
}

export interface OptionPresentationInput {
  strategy: RecoveryStrategy;
  feasible: boolean;
  recommended: boolean;
  rejectionEvidence: readonly CandidateRejectionEvidence[];
  viability?: ViabilityResult;
  intent?: ActionIntent;
  decision?: AuthorityDecision;
  engagement?: Engagement;
  places: ReadonlyMap<string, Place>;
  criticalObjectiveAtRisk?: string;
  softTradeoffs?: readonly string[];
  searchProvenance?: 'REPLAY' | 'LIVE' | 'RECORD';
  /** Governing MIN_BUFFER minutes when known from policy/constraints. */
  requiredBufferMinutes?: number;
}

export interface OptionPresentationFields {
  pros?: string[];
  cons?: string[];
  commitmentEffect?: string;
  authorityLabel?: string;
  provenanceLabel?: string;
  whyRecommended?: string;
  summary?: string;
  flags?: string[];
}

/**
 * Project structured judge-facing option fields from evidence already on the
 * strategy/viability/authority path. Never invents supplier facts.
 */
export function projectOptionPresentation(input: OptionPresentationInput): OptionPresentationFields {
  const pros: string[] = [];
  const cons: string[] = [];
  const flags: string[] = [];
  const leg = proposedTransportLeg(input.strategy);
  const arrival = leg?.data.scheduledArrival?.value;
  const departure = leg?.data.scheduledDeparture?.value;
  const origin = placeCode(input.places.get(leg?.data.originPlaceId ?? ''));
  const destination = placeCode(input.places.get(leg?.data.destinationPlaceId ?? ''));
  const commitmentStart = input.engagement?.data.startsAt.value;
  const commitmentTitle = input.engagement?.data.title;

  const bufferLabel =
    bufferFromViability(input.viability) ??
    bufferFromRejection(input.rejectionEvidence) ??
    (() => {
      if (
        arrival &&
        commitmentStart &&
        input.requiredBufferMinutes !== undefined &&
        Number.isFinite(input.requiredBufferMinutes)
      ) {
        const available = minutesBetween(arrival, commitmentStart);
        if (available === undefined) return undefined;
        const ok = available >= input.requiredBufferMinutes;
        return ok
          ? 'Arrival leaves enough preparation time before the commitment'
          : 'Arrival does not leave enough preparation time before the commitment';
      }
      return undefined;
    })();

  if (bufferLabel) {
    if (input.feasible) pros.push(bufferLabel);
    else cons.push(bufferLabel);
    flags.push(bufferLabel);
  }

  if (arrival && commitmentStart) {
    const available = minutesBetween(arrival, commitmentStart);
    const arrivalClock = clock(arrival);
    const commitmentClock = clock(commitmentStart);
    if (arrivalClock && commitmentClock) {
      flags.push(`Arrives ${arrivalClock} · commitment ${commitmentClock}`);
    }
    if (input.feasible && available !== undefined && available >= 0 && !bufferLabel) {
      pros.push('Arrival leaves enough preparation time before the commitment');
    }
  }

  if (origin && destination && departure && arrival) {
    const dep = clock(departure);
    const arr = clock(arrival);
    if (dep && arr) {
      pros.push(`${origin} ${dep} → ${destination} ${arr}`);
    }
  }

  const stayCheckout = proposedStayCheckout(input.strategy);
  if (stayCheckout) {
    const when = formatProgrammeInstant(stayCheckout);
    if (when) pros.push(`Stay extends through ${when}`);
  }

  if (input.feasible && commitmentTitle) {
    pros.push(`Keeps ${commitmentTitle}`);
  } else if (!input.feasible && input.criticalObjectiveAtRisk) {
    cons.push(`Does not protect: ${input.criticalObjectiveAtRisk}`);
  }

  for (const tradeoff of input.softTradeoffs ?? []) {
    if (tradeoff.trim()) cons.push(tradeoff.trim());
  }

  if (!input.feasible && input.rejectionEvidence.length > 0) {
    // Rejection reason is rendered separately; keep cons for extra context only.
  }

  let commitmentEffect: string | undefined;
  if (input.feasible && commitmentTitle) {
    commitmentEffect = `${commitmentTitle} remains viable`;
  } else if (!input.feasible && input.criticalObjectiveAtRisk) {
    commitmentEffect = `Leaves commitment at risk: ${input.criticalObjectiveAtRisk}`;
  } else if (input.feasible) {
    commitmentEffect = 'Whole-trip checks pass';
  } else {
    commitmentEffect = 'Does not satisfy a required trip condition';
  }

  let authorityLabel: string | undefined;
  if (input.decision && input.decision.outcome !== 'AUTO_APPROVED') {
    const requested =
      input.decision.outcome === 'REQUIRES_TRAVELLER'
        ? 'TRAVELLER'
        : input.decision.outcome === 'REQUIRES_ORGANISATION_APPROVER'
          ? 'ORGANISATION'
          : 'HUMAN_AGENT';
    authorityLabel = authorityNeededLabel(requested);
  } else if (input.intent?.operation.includes('flight') || input.intent?.operation.includes('hotel')) {
    authorityLabel = 'Organisation approval required';
  }

  const provenanceParts: string[] = [];
  if (input.searchProvenance === 'REPLAY') provenanceParts.push('Search evidence: REPLAY');
  else if (input.searchProvenance === 'LIVE') provenanceParts.push('Search evidence: LIVE');
  else if (input.searchProvenance === 'RECORD') provenanceParts.push('Search evidence: RECORD');
  if (input.intent) provenanceParts.push('Execution: simulated at provider boundary until observed');
  const provenanceLabel = provenanceParts.length > 0 ? provenanceParts.join(' · ') : undefined;

  let whyRecommended: string | undefined;
  if (input.recommended && input.feasible) {
    if (bufferLabel) {
      whyRecommended = `Recommended because it is the earliest evidenced option that protects the commitment (${bufferLabel}).`;
    } else if (stayCheckout) {
      whyRecommended =
        'Recommended because it extends the existing stay without changing flights or switching hotels.';
    } else {
      whyRecommended =
        'Recommended because it keeps the whole trip viable with the fewest soft tradeoffs among workable options.';
    }
  }

  const summaryParts: string[] = [];
  if (arrival && commitmentStart) {
    const arr = clock(arrival);
    const show = clock(commitmentStart);
    if (arr && show && bufferLabel) {
      summaryParts.push(`Arrival ${arr}; commitment ${show}; ${bufferLabel}.`);
    }
  }
  if (stayCheckout && !summaryParts.length) {
    const when = formatProgrammeInstant(stayCheckout);
    if (when) summaryParts.push(`Extend current stay through ${when}. No flight changes.`);
  }

  return {
    ...(pros.length > 0 ? { pros: unique(pros) } : {}),
    ...(cons.length > 0 ? { cons: unique(cons) } : {}),
    ...(commitmentEffect ? { commitmentEffect } : {}),
    ...(authorityLabel ? { authorityLabel } : {}),
    ...(provenanceLabel ? { provenanceLabel } : {}),
    ...(whyRecommended ? { whyRecommended } : {}),
    ...(summaryParts.length > 0 ? { summary: summaryParts.join(' ') } : {}),
    ...(flags.length > 0 ? { flags: unique(flags) } : {}),
  };
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/** Stable empty helper for callers that only need buffer parsing from evaluations. */
export function bufferLabelFromEvaluations(
  evaluations: ReadonlyArray<{ evidence?: string }>,
): string | undefined {
  for (const evaluation of evaluations) {
    const label = presentBufferEvidence(evaluation.evidence);
    if (label) return label;
  }
  return undefined;
}

export type { EntityId };

/**
 * C2 — deterministic Atlas raw -> frozen capability-type normalization.
 *
 * This is the single normalize path shared by LIVE, RECORD and REPLAY.
 * Mapping policy:
 * - Opaque workflow identifiers (routingIdentifier, sessionId) are preserved
 *   exactly and never reinterpreted.
 * - Atlas schedule strings are local-format provider values with unconfirmed
 *   timezone semantics; they are mapped to UTC-offset instants so they
 *   satisfy IsoDateTime without inventing a timezone.
 * - Rule letter codes are unmapped provider values: `T` maps to
 *   allowed/refundable, anything else stays restrictive and carries the raw
 *   code in notes. UNKNOWN stays UNKNOWN.
 * - No market/statistical inference from sandbox values.
 */
import type {
  FareRulesOutcome,
  FlightOffer,
  FlightSearchOutcome,
  FlightSegmentView,
  FlightVerifyOutcome,
} from '../../contracts/capabilities.ts';
import { IsoDateTimeSchema, type IsoDateTime, type Money } from '../../domain/common.ts';
import type {
  AtlasRule,
  AtlasRouting,
  AtlasSearchBody,
  AtlasSegment,
  AtlasVerifyBody,
} from './types.ts';

export interface PassengerCounts {
  adults: number;
  children?: number;
  infants?: number;
}

export function normalizeSearch(body: AtlasSearchBody, passengers: PassengerCounts): FlightSearchOutcome {
  const routings = body.routings ?? [];
  return { offers: routings.map((routing) => toFlightOffer(routing, passengers)) };
}

export function normalizeVerify(body: AtlasVerifyBody, passengers?: PassengerCounts): FlightVerifyOutcome {
  const priceChange = body.priceChange;
  const changed = priceChange?.isPriceChange === true;
  const outcome: FlightVerifyOutcome = { status: changed ? 'PRICE_CHANGED' : 'VERIFIED' };

  if (changed && passengers && priceChange) {
    const currency = body.routing?.currency;
    if (currency) {
      const updated = paxTotal(
        currency,
        passengers,
        priceChange.newAdultPrice,
        priceChange.newAdultTax,
        priceChange.newChildPrice,
        priceChange.newChildTax,
        priceChange.newInfantPrice,
        priceChange.newInfantTax,
      );
      if (updated) {
        outcome.updatedPrice = updated;
        const original = paxTotal(
          currency,
          passengers,
          priceChange.originalAdultPrice,
          priceChange.originalAdultTax,
          priceChange.originalChildPrice,
          priceChange.originalChildTax,
          priceChange.originalInfantPrice,
          priceChange.originalInfantTax,
        );
        if (original) {
          outcome.priceDelta = { currency: updated.currency, amount: round2(updated.amount - original.amount) };
        }
      }
    }
  }

  const requirements = bookingRequirements(body);
  if (requirements.length > 0) outcome.bookingRequirements = requirements;

  if (body.sessionId !== undefined) {
    // Opaque provider workflow state: preserved verbatim, never reinterpreted.
    outcome.workflowState = { sessionId: body.sessionId };
  }
  return outcome;
}

export function normalizeFareRules(rule: AtlasRule | undefined): FareRulesOutcome {
  if (!rule) return {};
  const outcome: FareRulesOutcome = {};

  const changes = rule.changesRules ?? [];
  if (changes.length > 0) {
    outcome.change = {
      allowed: changes.every((entry) => entry.changesStatus === 'T'),
      ...aggregateFee(changes.map((entry) => ({ amount: entry.changesFee, currency: entry.currency }))),
      ...statusNote(changes.map((entry) => entry.changesStatus), 'change'),
    };
    const noShow = noShowFrom(
      changes.map((entry) => ({ status: entry.revNoshow, fee: entry.revNoshowFee, currency: entry.currency })),
    );
    if (noShow) outcome.noShow = noShow;
  }

  const refunds = rule.refundRules ?? [];
  if (refunds.length > 0) {
    outcome.refund = {
      refundable: refunds.every((entry) => entry.refundStatus === 'T'),
      ...aggregateFee(refunds.map((entry) => ({ amount: entry.refundFee, currency: entry.currency }))),
      ...statusNote(refunds.map((entry) => entry.refundStatus), 'refund'),
    };
    if (!outcome.noShow) {
      const noShow = noShowFrom(
        refunds.map((entry) => ({ status: entry.refNoshow, fee: entry.refNoshowFee, currency: entry.currency })),
      );
      if (noShow) outcome.noShow = noShow;
    }
  }

  const baggage = (rule.baggageElements ?? []).filter(
    (element) => element.passengerType === 0 && ((element.baggagePiece ?? 0) > 0 || (element.baggageWeight ?? 0) > 0),
  );
  if (baggage.length > 0) {
    outcome.baggageIncluded = baggage.map(describeBaggage);
  }
  return outcome;
}

// ---------------------------------------------------------------------------

function toFlightOffer(routing: AtlasRouting, passengers: PassengerCounts): FlightOffer {
  const segments = [...routing.fromSegments, ...routing.retSegments].map(toSegmentView);
  if (segments.length === 0) {
    throw new Error('Atlas routing has no segments');
  }
  const total = paxTotal(
    routing.currency,
    passengers,
    routing.adultPrice,
    routing.adultTax,
    routing.childPrice,
    routing.childTax,
    routing.infantPrice,
    routing.infantTax,
  );
  if (!total) {
    throw new Error('Atlas routing has no usable price components');
  }

  const offer: FlightOffer = {
    offerId: routing.routingIdentifier,
    segments,
    totalPrice: total,
    availability: availabilityOf(routing),
  };
  const fareFamily = routing.fromSegments[0]?.fareFamily;
  if (fareFamily !== undefined && fareFamily !== '') offer.fareFamily = fareFamily;
  if (typeof routing.expireTime === 'string') offer.expiresAt = toIsoDateTime(routing.expireTime);
  return offer;
}

function toSegmentView(segment: AtlasSegment): FlightSegmentView {
  const view: FlightSegmentView = {
    origin: { system: 'IATA', value: segment.depAirport },
    destination: { system: 'IATA', value: segment.arrAirport },
    departure: atlasScheduleToIso(segment.depTime),
    arrival: atlasScheduleToIso(segment.arrTime),
  };
  if (segment.carrier !== undefined && segment.carrier !== '') view.carrierCode = segment.carrier;
  if (segment.flightNumber !== undefined && segment.flightNumber !== '') view.flightNumber = segment.flightNumber;
  const cabin = cabinOf(segment.cabinClass);
  if (cabin) view.cabin = cabin;
  return view;
}

function availabilityOf(routing: AtlasRouting): FlightOffer['availability'] {
  if (routing.riskSellout === true) return 'LIMITED';
  const seatCounts = [...routing.fromSegments, ...routing.retSegments]
    .map((segment) => segment.seatCount)
    .filter((count): count is number => typeof count === 'number');
  if (seatCounts.length === 0) return 'UNKNOWN';
  return Math.min(...seatCounts) > 0 ? 'AVAILABLE' : 'UNKNOWN';
}

function cabinOf(cabinClass: number | undefined): string | undefined {
  switch (cabinClass) {
    case 1:
      return 'ECONOMY';
    case 2:
      return 'PREMIUM_ECONOMY';
    case 3:
      return 'BUSINESS';
    default:
      return undefined;
  }
}

export function atlasScheduleToIso(value: string): IsoDateTime {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(value);
  if (!match) throw new Error(`unsupported Atlas schedule format: ${value}`);
  const iso = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00Z`;
  return toIsoDateTime(iso);
}

function toIsoDateTime(value: string): IsoDateTime {
  const parsed = IsoDateTimeSchema.safeParse(value);
  if (!parsed.success || Number.isNaN(Date.parse(value))) {
    throw new Error(`unsupported Atlas timestamp: ${value}`);
  }
  return parsed.data;
}

function paxTotal(
  currency: string,
  passengers: PassengerCounts,
  adultPrice?: number,
  adultTax?: number,
  childPrice?: number,
  childTax?: number,
  infantPrice?: number,
  infantTax?: number,
): Money | undefined {
  if (adultPrice === undefined || adultTax === undefined) return undefined;
  const children = passengers.children ?? 0;
  const infants = passengers.infants ?? 0;
  if (children > 0 && (childPrice === undefined || childTax === undefined)) return undefined;
  if (infants > 0 && (infantPrice === undefined || infantTax === undefined)) return undefined;
  const amount =
    passengers.adults * (adultPrice + adultTax) +
    children * ((childPrice ?? 0) + (childTax ?? 0)) +
    infants * ((infantPrice ?? 0) + (infantTax ?? 0));
  return { currency, amount: round2(amount) };
}

function bookingRequirements(body: AtlasVerifyBody): string[] {
  const requirements: string[] = [];
  const groups = body.bookingRequirement ?? {};
  for (const group of Object.keys(groups).sort()) {
    const fields = groups[group] ?? {};
    for (const field of Object.keys(fields).sort()) {
      if (fields[field]?.required === true) requirements.push(`${group}.${field}`);
    }
  }
  return requirements;
}

function aggregateFee(entries: ReadonlyArray<{ amount?: number; currency?: string }>): { fee?: Money } {
  const withFee = entries.filter(
    (entry): entry is { amount: number; currency: string } =>
      typeof entry.amount === 'number' && typeof entry.currency === 'string' && entry.currency.length === 3,
  );
  if (withFee.length === 0) return {};
  const currencies = new Set(withFee.map((entry) => entry.currency));
  if (currencies.size > 1) return {};
  // Conservative: the highest published fee dominates.
  const amount = Math.max(...withFee.map((entry) => entry.amount));
  return { fee: { currency: withFee[0]!.currency, amount: round2(amount) } };
}

function statusNote(statuses: ReadonlyArray<string | undefined>, subject: string): { notes?: string } {
  const nonAllowed = statuses.filter((status) => status !== 'T');
  if (nonAllowed.length === 0) return {};
  return { notes: `provider ${subject} status codes: ${statuses.map((status) => status ?? 'absent').join(', ')}` };
}

function noShowFrom(
  entries: ReadonlyArray<{ status?: string; fee?: number; currency?: string }>,
): FareRulesOutcome['noShow'] | undefined {
  if (entries.length === 0) return undefined;
  const statuses = entries.map((entry) => entry.status);
  if (statuses.every((status) => status === 'T')) {
    const fee = pickFee(entries);
    return fee ? { consequence: 'NO_SHOW_SUBJECT_TO_FEE', fee } : { consequence: 'NO_SHOW_SUBJECT_TO_FEE' };
  }
  if (statuses.every((status) => status === 'F')) {
    return { consequence: 'NO_SHOW_NOT_PERMITTED' };
  }
  return { consequence: `UNKNOWN provider no-show codes: ${statuses.map((status) => status ?? 'absent').join(', ')}` };
}

function pickFee(entries: ReadonlyArray<{ fee?: number; currency?: string }>): Money | undefined {
  const withFee = entries.filter(
    (entry): entry is { fee: number; currency: string } =>
      typeof entry.fee === 'number' && typeof entry.currency === 'string' && entry.currency.length === 3,
  );
  if (withFee.length === 0) return undefined;
  const currencies = new Set(withFee.map((entry) => entry.currency));
  if (currencies.size > 1) return undefined;
  return { currency: withFee[0]!.currency, amount: round2(Math.max(...withFee.map((entry) => entry.fee))) };
}

function describeBaggage(element: {
  baggagePiece?: number;
  baggageWeight?: number;
  baggageType?: string;
}): string {
  const type = element.baggageType ?? 'Baggage';
  const parts: string[] = [type];
  if ((element.baggagePiece ?? 0) > 0) parts.push(`${element.baggagePiece} piece`);
  if ((element.baggageWeight ?? 0) > 0) parts.push(`${element.baggageWeight}kg`);
  return parts.join(', ');
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

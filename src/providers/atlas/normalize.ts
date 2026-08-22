/**
 * C2 — deterministic Atlas raw -> frozen capability-type normalization.
 *
 * This is the single normalize path shared by LIVE, RECORD and REPLAY.
 * Mapping policy:
 * - Opaque workflow identifiers (routingIdentifier, sessionId) are preserved
 *   exactly and never reinterpreted.
 * - Atlas schedule strings (`YYYYMMDDHHmm`) are airport-local wall-clock
 *   times with no offset (confirmed against sandbox captures: cross-timezone
 *   legs shift by exactly the local-time difference of their endpoints).
 *   They are converted to honest instants with a caller-supplied IANA
 *   timezone resolver; an unresolvable airport fails normalization instead
 *   of fabricating a UTC offset (ADR-028).
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

/**
 * Resolves a provider airport code (e.g. an IATA code) to an IANA timezone
 * identifier. Supplied by the application from its authoritative place data;
 * the adapter itself carries no location knowledge.
 */
export type AtlasTimezoneResolver = (airportCode: string) => string | undefined;

export function normalizeSearch(
  body: AtlasSearchBody,
  passengers: PassengerCounts,
  timezoneResolver?: AtlasTimezoneResolver,
): FlightSearchOutcome {
  const routings = body.routings ?? [];
  return { offers: routings.map((routing) => toFlightOffer(routing, passengers, timezoneResolver)) };
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

function toFlightOffer(
  routing: AtlasRouting,
  passengers: PassengerCounts,
  timezoneResolver?: AtlasTimezoneResolver,
): FlightOffer {
  const segments = [...routing.fromSegments, ...routing.retSegments].map((segment) =>
    toSegmentView(segment, timezoneResolver),
  );
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

function toSegmentView(segment: AtlasSegment, timezoneResolver?: AtlasTimezoneResolver): FlightSegmentView {
  const view: FlightSegmentView = {
    origin: { system: 'IATA', value: segment.depAirport },
    destination: { system: 'IATA', value: segment.arrAirport },
    departure: atlasScheduleAtAirport(segment.depTime, segment.depAirport, timezoneResolver),
    arrival: atlasScheduleAtAirport(segment.arrTime, segment.arrAirport, timezoneResolver),
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

/**
 * Atlas schedule strings are airport-local wall-clock times (`YYYYMMDDHHmm`,
 * no offset). Converting them to an honest instant requires the airport's
 * IANA timezone; without a resolver or mapping the conversion refuses rather
 * than fabricating a `Z` suffix.
 */
export function atlasScheduleAtAirport(
  value: string,
  airportCode: string,
  timezoneResolver?: AtlasTimezoneResolver,
): IsoDateTime {
  if (!timezoneResolver) {
    throw new Error('atlas schedule normalization requires a timezone resolver (airport-local times)');
  }
  const timezone = timezoneResolver(airportCode);
  if (!timezone) {
    throw new Error(`cannot resolve timezone for airport ${airportCode}; refusing to fabricate a UTC offset`);
  }
  return atlasScheduleToIso(value, timezone);
}

export function atlasScheduleToIso(value: string, timezone: string): IsoDateTime {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(value);
  if (!match) throw new Error(`unsupported Atlas schedule format: ${value}`);
  const [, year, month, day, hour, minute] = match;
  return toIsoDateTime(atlasLocalScheduleToIso(value, timezone, Number(year), Number(month), Number(day), Number(hour), Number(minute)));
}

/**
 * Deterministic wall-clock -> instant conversion for an IANA timezone.
 *
 * The offset at the naive instant (interpreting the wall clock as UTC) picks
 * the pre-transition side, so DST folds (ambiguous local time) resolve to the
 * FIRST occurrence. When the true instant sits across a transition from the
 * naive instant, a second candidate from that instant's own offset is
 * checked. Nonexistent local times (DST gaps) and any input that does not
 * round-trip fail structured instead of guessing.
 */
function atlasLocalScheduleToIso(
  value: string,
  timezone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): string {
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const candidates: number[] = [];
  const first = naiveUtc - timezoneOffsetMinutes(naiveUtc, timezone) * 60_000;
  candidates.push(first);
  const second = naiveUtc - timezoneOffsetMinutes(first, timezone) * 60_000;
  if (second !== first) candidates.push(second);
  for (const instant of candidates) {
    if (renderLocalWall(instant, timezone) === value) {
      return formatIsoWithOffset(instant, timezone);
    }
  }
  throw new Error(`ambiguous local schedule ${value} in timezone ${timezone}`);
}

/** Signed UTC offset (minutes) of a timezone at a given instant. */
function timezoneOffsetMinutes(millis: number, timezone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = formatter.formatToParts(new Date(millis));
  const part = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const renderedUtc = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), 0);
  return Math.round((renderedUtc - millis) / 60_000);
}

function renderLocalWall(millis: number, timezone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = formatter.formatToParts(new Date(millis));
  const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? '00';
  return `${part('year')}${part('month')}${part('day')}${part('hour')}${part('minute')}`;
}

/** ISO string with the target timezone's own offset (host timezone never leaks). */
function formatIsoWithOffset(millis: number, timezone: string): string {
  const offsetMinutes = timezoneOffsetMinutes(millis, timezone);
  const shifted = new Date(millis + offsetMinutes * 60_000);
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${shifted.toISOString().slice(0, 19)}${sign}${hh}:${mm}`;
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

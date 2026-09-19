/**
 * Pure transport corridor spine.
 *
 * Shared by the research-request composition path and the transport proposer:
 * it navigates the current canonical world state to derive provider-neutral
 * flight.search research corridors for failing TRANSPORT journey items, and
 * correlates a dispatched flight.search result back to the journey item it
 * was for.
 *
 * Provider-neutral and fail-closed: an unresolvable place (no injected
 * airport resolver hit, no IANA tz, no intended window) becomes an honest
 * gap, never a fabricated corridor — and so does an underivable search
 * party (`passengers_unknown`). No PostgreSQL, no provider call, no
 * model, no scenario/persona branch, no hardcoded route/airport/passenger
 * literal — every provider-specific value flows through the injected
 * AirportResolver, and every passenger count flows through the injected
 * `passengersFor` resolver (derived from authoritative state) or the
 * injected static `passengers` value.
 */
import { createHash } from 'node:crypto';
import type { ExternalRef } from '../../contracts/capabilities.ts';
import { PlanningToolRequestSchema, type PlanningToolRequest } from '../../contracts/v2/planning/planningTool.ts';
import type { CapturedWorld, WJourneyItem, WPlace } from '../world/world.ts';
import type { FailingSubject } from './proposer.ts';

/** Resolves a place id to a provider airport ExternalRef, or undefined. INJECTED — this module never hardcodes an airport code or ref system. Fail-closed: undefined means "no honest airport for this place". */
export type AirportResolver = (placeId: string) => ExternalRef | undefined;

/**
 * Standard resolver over captured Place references. Historical `airport-code`
 * is normalized to the flight provider's IATA reference system; unknown refs
 * fail closed rather than guessing an airport.
 */
export function airportResolverFromCapturedWorld(world: CapturedWorld): AirportResolver {
  const places = indexPlaces(world);
  return (placeId) => {
    const found = places.get(placeId)?.externalRefs?.find((ref) =>
      ref.value.trim().length > 0 && (ref.system.toUpperCase() === 'IATA' || ref.system.toLowerCase() === 'airport-code'),
    );
    return found ? { system: 'IATA', value: found.value.trim() } : undefined;
  };
}

export interface TransportPassengers {
  adults: number;
  children?: number;
  infants?: number;
}

/**
 * Resolves the search party for ONE corridor from authoritative state, instead of
 * accepting a composition-wide constant. Returns an honest `unknown` rather than
 * inventing a party when the captured world cannot support a count.
 *
 * Provider-neutral and persona-neutral: the resolver sees only the corridor's
 * journey/item ids and the captured world.
 */
export type TransportPassengersResolver = (ctx: {
  journeyId: string;
  journeyItemId: string;
  world: CapturedWorld;
}) => TransportPassengers | { unknown: true; reason: string };

/**
 * The default state-derived resolver.
 *
 * Canonical state encodes NO age category (`travellers` carries identity and
 * lifecycle only; `reservation_allocations.allocation_role` is a free-form role,
 * not an age band), so children/infants are never invented and stay absent. Each
 * DERIVED PERSON maps to `adults`, because the read-only flight.search request
 * schema requires `adults >= 1` and a known person cannot otherwise be expressed;
 * that mapping is an explicit, documented uncertainty surfaced in planning
 * evidence, never a silent assumption.
 *
 * Derivation order, both authoritative:
 *   1. distinct travellers allocated to this journey item — the only place
 *      canonical state binds people to a journey item, and the capture already
 *      expands peer travellers on capacity-relevant lines;
 *   2. otherwise the corridor journey's own single traveller, legitimate because
 *      a Journey is 1:1 with its Traveller by schema (not by constant);
 *   3. otherwise fail closed — no fabricated corridor.
 */
export function travellersForJourneyItemPassengers(
  world: CapturedWorld,
  journeyItemId: string,
  journeyId: string,
): TransportPassengers | { unknown: true; reason: string } {
  const allocated = new Set<string>();
  for (const allocation of world.allocations) {
    if (allocation.journeyItemId !== journeyItemId) continue;
    if (allocation.travellerId.trim().length === 0) continue;
    allocated.add(allocation.travellerId);
  }
  if (allocated.size > 0) return { adults: allocated.size };

  const journey = world.journeys.find((candidate) => candidate.id === journeyId);
  if (journey && journey.travellerId.trim().length > 0) return { adults: 1 };

  return { unknown: true, reason: 'no_traveller_allocations_and_no_journey_traveller' };
}

/**
 * The passenger source for corridor derivation. Both arms are optional so the
 * pre-R3 static shape keeps compiling unchanged; `passengersFor` (per-corridor
 * derivation from authoritative state) is the R3 shape and wins when present.
 *
 * Neither is ever defaulted inside these modules. Supplying NEITHER is not a
 * silent `adults: 1` — it fails every corridor closed with a `passengers_unknown`
 * gap, which is the safer failure: a compile-time requirement to pass *something*
 * would not guarantee the value passed is truthful, while fail-closed derivation
 * does. Shared by every corridor-deriving caller (corridor builder, proposer,
 * offer materialization, coordinator) so resolver-vs-static precedence has one
 * definition.
 */
export interface TransportPassengerSource {
  /** Composition-wide static search party (pre-R3 shape, retained). */
  passengers?: TransportPassengers;
  /** Per-corridor search party derived from authoritative state (R3 shape); wins over `passengers`. */
  passengersFor?: TransportPassengersResolver;
}

export interface TransportCorridorOpts extends TransportPassengerSource {
  resolveAirport: AirportResolver;
}

export interface TransportCorridor {
  journeyItemId: string;
  journeyId: string;
  originPlaceId: string;
  destinationPlaceId: string;
  origin: ExternalRef;
  destination: ExternalRef;
  /** Local YYYY-MM-DD departure date at the origin place timezone, derived from the item's intendedWindow.start. */
  departureDate: string;
  passengers: TransportPassengers;
}

export type TransportGapReason =
  | 'no_transport_journey_item'
  | 'no_origin_place'
  | 'no_destination_place'
  | 'origin_airport_unresolved'
  | 'destination_airport_unresolved'
  | 'no_departure_window'
  | 'passengers_unknown';

export interface TransportCorridorGap {
  journeyItemId: string | null;
  reasonCode: TransportGapReason;
}

const SUBJECT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_\-:.]*$/;

/**
 * Derive a local YYYY-MM-DD at the given IANA timeZone from an ISO instant,
 * using the Intl API (no hardcoded offset table, no provider).
 */
function localDateAtTimeZone(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  const lookup = new Map(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value] as const));
  const year = lookup.get('year');
  const month = lookup.get('month');
  const day = lookup.get('day');
  if (!year || !month || !day) {
    throw new Error(`unable to derive local date for instant ${instant} in ${timeZone}`);
  }
  return `${year}-${month}-${day}`;
}

function indexPlaces(world: CapturedWorld): Map<string, WPlace> {
  const out = new Map<string, WPlace>();
  for (const place of world.places) out.set(place.id, place);
  return out;
}

function collectTransportJourneyItems(
  world: CapturedWorld,
  failing: readonly FailingSubject[],
): { items: WJourneyItem[]; journeysWithoutTransport: string[] } {
  const items: WJourneyItem[] = [];
  const journeysWithoutTransport: string[] = [];
  const seenItems = new Set<string>();
  const seenJourneysWithout = new Set<string>();

  const pushItem = (item: WJourneyItem): void => {
    if (seenItems.has(item.id)) return;
    seenItems.add(item.id);
    items.push(item);
  };

  for (const subject of failing) {
    const { kind, id } = subject.subject;
    if (kind === 'JOURNEY') {
      let foundForJourney = false;
      for (const item of world.journeyItems) {
        if (item.journeyId !== id) continue;
        if (item.kind !== 'TRANSPORT') continue;
        foundForJourney = true;
        pushItem(item);
      }
      if (!foundForJourney && !seenJourneysWithout.has(id)) {
        seenJourneysWithout.add(id);
        journeysWithoutTransport.push(id);
      }
    } else if (kind === 'JOURNEY_ITEM') {
      const item = world.journeyItems.find((candidate) => candidate.id === id);
      if (item && item.kind === 'TRANSPORT') pushItem(item);
    }
  }

  return { items, journeysWithoutTransport };
}

/** Pure: from the failing subjects, find their TRANSPORT journey items in the world and resolve each into a flight corridor (or an honest gap). Deterministic order: by journeyItemId. */
export function transportCorridors(
  world: CapturedWorld,
  failing: readonly FailingSubject[],
  opts: TransportCorridorOpts,
): { corridors: TransportCorridor[]; gaps: TransportCorridorGap[] } {
  const { items, journeysWithoutTransport } = collectTransportJourneyItems(world, failing);
  const places = indexPlaces(world);

  const corridors: TransportCorridor[] = [];
  const gaps: TransportCorridorGap[] = [];

  /** Resolve one corridor's search party: the injected resolver wins over a static value. Neither present fails closed. */
  const passengersFor = (item: WJourneyItem): TransportPassengers | { unknown: true; reason: string } => {
    if (opts.passengersFor) {
      return opts.passengersFor({ journeyId: item.journeyId, journeyItemId: item.id, world });
    }
    if (opts.passengers) return opts.passengers;
    return { unknown: true, reason: 'no_passenger_source_supplied' };
  };
  for (const journeyId of journeysWithoutTransport) {
    gaps.push({ journeyItemId: null, reasonCode: 'no_transport_journey_item' });
    void journeyId;
  }

  for (const item of items) {
    if (item.desiredOriginPlaceId === null) {
      gaps.push({ journeyItemId: item.id, reasonCode: 'no_origin_place' });
      continue;
    }
    if (item.desiredDestinationPlaceId === null) {
      gaps.push({ journeyItemId: item.id, reasonCode: 'no_destination_place' });
      continue;
    }
    const originPlace = places.get(item.desiredOriginPlaceId);
    const destinationPlace = places.get(item.desiredDestinationPlaceId);
    if (!originPlace) {
      gaps.push({ journeyItemId: item.id, reasonCode: 'no_origin_place' });
      continue;
    }
    if (!destinationPlace) {
      gaps.push({ journeyItemId: item.id, reasonCode: 'no_destination_place' });
      continue;
    }
    const origin = opts.resolveAirport(item.desiredOriginPlaceId);
    if (origin === undefined) {
      gaps.push({ journeyItemId: item.id, reasonCode: 'origin_airport_unresolved' });
      continue;
    }
    const destination = opts.resolveAirport(item.desiredDestinationPlaceId);
    if (destination === undefined) {
      gaps.push({ journeyItemId: item.id, reasonCode: 'destination_airport_unresolved' });
      continue;
    }
    if (item.intendedWindow === null) {
      gaps.push({ journeyItemId: item.id, reasonCode: 'no_departure_window' });
      continue;
    }
    // Fail closed on an underivable search party: never fabricate a corridor with
    // an invented passenger count.
    const resolvedPassengers = passengersFor(item);
    if ('unknown' in resolvedPassengers) {
      gaps.push({ journeyItemId: item.id, reasonCode: 'passengers_unknown' });
      continue;
    }
    let departureDate: string;
    try {
      departureDate = localDateAtTimeZone(item.intendedWindow.start, originPlace.timeZone);
    } catch {
      gaps.push({ journeyItemId: item.id, reasonCode: 'no_departure_window' });
      continue;
    }
    corridors.push({
      journeyItemId: item.id,
      journeyId: item.journeyId,
      originPlaceId: item.desiredOriginPlaceId,
      destinationPlaceId: item.desiredDestinationPlaceId,
      origin,
      destination,
      departureDate,
      passengers: resolvedPassengers,
    });
  }

  corridors.sort((a, b) => a.journeyItemId.localeCompare(b.journeyItemId));
  gaps.sort((a, b) => (a.journeyItemId ?? '').localeCompare(b.journeyItemId ?? '') || a.reasonCode.localeCompare(b.reasonCode));

  return { corridors, gaps };
}

/** Deterministic, SubjectId-safe request id per corridor (must satisfy /^[A-Za-z0-9][A-Za-z0-9_\-:.]*$/). Stable across reruns for the same corridor. */
export function transportRequestId(corridor: TransportCorridor): string {
  const digest = createHash('sha256')
    .update([
      corridor.journeyItemId,
      corridor.origin.system,
      corridor.origin.value,
      corridor.destination.system,
      corridor.destination.value,
      corridor.departureDate,
    ].join('|'))
    .digest('hex')
    .slice(0, 24);
  const id = `transport-req:${digest}`;
  if (!SUBJECT_ID_RE.test(id)) {
    throw new Error(`generated request id ${id} is not SubjectId-safe`);
  }
  return id;
}

/** Build the bounded read-only flight.search PlanningToolRequest for a corridor. capability='FLIGHT', operation='flight.search'. parameters MUST match the dispatch-level FLIGHT_SEARCH_PARAMETERS strict shape at src/app/dispatch.ts:38-51 exactly: {origin:{system,value}, destination:{system,value}, departureDate:'YYYY-MM-DD', passengers:{adults,children?,infants?}}. Do NOT add extra parameter keys (strict object). round is 1-based, passed in. */
export function flightSearchRequestFor(
  corridor: TransportCorridor,
  ctx: { round: number; purpose?: string; evidenceGapCode?: string },
): PlanningToolRequest {
  const passengers: Record<string, unknown> = { adults: corridor.passengers.adults };
  if (corridor.passengers.children !== undefined) {
    passengers.children = corridor.passengers.children;
  }
  if (corridor.passengers.infants !== undefined) {
    passengers.infants = corridor.passengers.infants;
  }

  const parameters = {
    origin: { system: corridor.origin.system, value: corridor.origin.value },
    destination: { system: corridor.destination.system, value: corridor.destination.value },
    departureDate: corridor.departureDate,
    passengers,
  };

  const purpose = ctx.purpose ?? `Research transport options for journey item ${corridor.journeyItemId}`;
  const evidenceGapCode = ctx.evidenceGapCode ?? 'transport_corridor_options';

  const request = PlanningToolRequestSchema.parse({
    id: transportRequestId(corridor),
    capability: 'FLIGHT',
    operation: 'flight.search',
    parameters,
    purpose,
    evidenceGapCode,
    round: ctx.round,
  });

  return request;
}

/** Correlate a dispatched result's requestId back to the journey item it researched. */
export function journeyItemIdForRequest(
  corridors: readonly TransportCorridor[],
  requestId: string,
): string | undefined {
  for (const corridor of corridors) {
    if (transportRequestId(corridor) === requestId) {
      return corridor.journeyItemId;
    }
  }
  return undefined;
}

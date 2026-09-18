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
 * gap, never a fabricated corridor. No PostgreSQL, no provider call, no
 * model, no scenario/persona branch, no hardcoded route/airport/passenger
 * literal — every provider-specific value flows through the injected
 * AirportResolver and the injected passenger counts.
 */
import { createHash } from 'node:crypto';
import type { ExternalRef } from '../../contracts/capabilities.ts';
import { PlanningToolRequestSchema, type PlanningToolRequest } from '../../contracts/v2/planning/planningTool.ts';
import type { CapturedWorld, WJourneyItem, WPlace } from '../world/world.ts';
import type { FailingSubject } from './proposer.ts';

/** Resolves a place id to a provider airport ExternalRef, or undefined. INJECTED — this module never hardcodes an airport code or ref system. Fail-closed: undefined means "no honest airport for this place". */
export type AirportResolver = (placeId: string) => ExternalRef | undefined;

export interface TransportPassengers {
  adults: number;
  children?: number;
  infants?: number;
}

export interface TransportCorridorOpts {
  resolveAirport: AirportResolver;
  /** Passenger counts for the search. INJECTED — never defaulted to a demo value inside this module. */
  passengers: TransportPassengers;
}

export interface TransportCorridor {
  journeyItemId: string;
  journeyId: string;
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
  | 'no_departure_window';

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
      origin,
      destination,
      departureDate,
      passengers: opts.passengers,
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

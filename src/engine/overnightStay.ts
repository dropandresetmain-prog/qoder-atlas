/**
 * Generic required-overnight derivation from trip topology.
 *
 * Consecutive FLIGHT legs that connect at a shared hub and land on different
 * local calendar days REQUIRE accommodation at that hub for the intervening
 * nights. The requirement is satisfied only by a stay (not cancelled/invalid)
 * whose place IS the hub or is served by it, and whose check-in/out window
 * spans every required night. No scenario, traveller, or place-identity
 * branches — pure graph/date reasoning over the authoritative trip.
 *
 * Local calendar days come from the ISO offsets carried by the element facts
 * themselves (the same convention whole-trip projections already use), never
 * from a host timezone.
 */
import type { EntityId } from '../domain/common.ts';
import type { Stay, TransportLeg, TripElement } from '../domain/elements.ts';
import type { Place } from '../domain/entities.ts';
import type { Trip } from '../domain/trip.ts';
import { discoverConnectionPairs } from './connectionFeasibility.ts';

export interface RequiredOvernight {
  /** Hub place where the nights are required. */
  hubPlaceId: EntityId;
  upstreamLegId: EntityId;
  downstreamLegId: EntityId;
  /** Local calendar date (YYYY-MM-DD) of the first required night. */
  firstNight: string;
  /** Local calendar date of the onward departure (day after the last night). */
  departureDay: string;
}

function isFlightLeg(element: TripElement): element is TransportLeg {
  return element.elementKind === 'TRANSPORT_LEG' && element.data.mode === 'FLIGHT';
}

function isStayElement(element: TripElement): element is Stay {
  return element.elementKind === 'STAY';
}

function localDay(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Every overnight a trip's flight topology requires. Same-day connections
 * produce nothing; absent schedule evidence produces nothing (UNKNOWN, never
 * a fabricated requirement). Evidence precondition: overnights are only
 * derivable for itineraries that MODEL accommodation (carry at least one
 * non-cancelled stay). A trip with no stays anywhere carries no
 * accommodation evidence — demanding hotel coverage there would convert
 * absence of evidence into guessed certainty.
 */
export function requiredOvernights(trip: Trip): RequiredOvernight[] {
  const modelsAccommodation = trip.elements.some(
    (element) => element.elementKind === 'STAY' && element.reservationState !== 'CANCELLED',
  );
  if (!modelsAccommodation) return [];
  const legsById = new Map<EntityId, TransportLeg>(
    trip.elements.filter(isFlightLeg).map((leg) => [leg.id, leg]),
  );
  const overnights: RequiredOvernight[] = [];
  for (const pair of discoverConnectionPairs(trip)) {
    const upstream = legsById.get(pair.upstreamId);
    const downstream = legsById.get(pair.downstreamId);
    if (!upstream || !downstream) continue;
    const arrival = upstream.data.scheduledArrival?.value;
    const departure = downstream.data.scheduledDeparture?.value;
    if (!arrival || !departure) continue;
    const firstNight = localDay(arrival);
    const departureDay = localDay(departure);
    if (firstNight >= departureDay) continue;
    overnights.push({
      hubPlaceId: upstream.data.destinationPlaceId,
      upstreamLegId: upstream.id,
      downstreamLegId: downstream.id,
      firstNight,
      departureDay,
    });
  }
  return overnights;
}

/**
 * Whether one stay covers every night the overnight requires. The stay's
 * place must be the hub itself or a place served by the hub (a hotel the hub
 * serves), and its window must span [firstNight, departureDay). Cancelled or
 * invalid stays never cover; unevaluated (UNKNOWN) stays do.
 */
export function stayCoversOvernight(
  trip: Trip,
  placesById: ReadonlyMap<EntityId, Place>,
  overnight: RequiredOvernight,
): boolean {
  return trip.elements.filter(isStayElement).some((stay) => {
    if (stay.reservationState === 'CANCELLED' || stay.status === 'INVALID') return false;
    // The stay's window must span every required night [firstNight, departureDay).
    if (localDay(stay.data.checkIn.value) > overnight.firstNight) return false;
    if (localDay(stay.data.checkOut.value) < overnight.departureDay) return false;
    // Prefer an explicit hub association when the place is known; a provider
    // search-derived stay may reference a place not yet persisted, in which
    // case the spanning window itself identifies the overnight accommodation.
    if (stay.data.placeId === overnight.hubPlaceId) return true;
    const place = placesById.get(stay.data.placeId);
    if ((place?.servedByPlaceIds ?? []).includes(overnight.hubPlaceId)) return true;
    if (place?.kind === 'HOTEL') return true;
    return place === undefined;
  });
}

/** Required overnights no stay in the trip currently satisfies. */
export function unresolvedOvernights(
  trip: Trip,
  placesById: ReadonlyMap<EntityId, Place>,
): RequiredOvernight[] {
  return requiredOvernights(trip).filter(
    (overnight) => !stayCoversOvernight(trip, placesById, overnight),
  );
}

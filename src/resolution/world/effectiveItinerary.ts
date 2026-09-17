/**
 * NORTHSTAR M6 — effective Journey / Programme / Service projection (pure).
 *
 * Derives, from canonical owners captured in one snapshot, what each Journey
 * item effectively is right now — without copying mutable truth anywhere:
 *
 *  - Journey / JourneyItem  = intended traveller state (window, desired places);
 *  - TransportService       = supplier-observed schedule (actual > estimated >
 *                             published, each kept separately; the selection is
 *                             explicit in `basis`, published is never overwritten);
 *  - Reservation / line     = supplier booking state (booking validity is its own
 *                             value, independent of whether the Journey works);
 *  - ProgrammeItem          = canonical programme schedule for engagements.
 *
 * "Booking valid, Journey invalid" is representable by construction: bookings
 * carry `bookingValid`; Journey viability is decided later by evaluators.
 */
import type { TypedRef } from '../../domain/v2/shared/identity.ts';
import { compareInstants } from '../../domain/v2/shared/time.ts';
import type { CapturedWorld, WJourneyItem, WReservationLine, WTransportService } from './world.ts';
import type { BookingState, EffectiveInstant, EffectiveItem, EffectiveJourney, EffectiveWorld } from './effectiveTypes.ts';

export type { BookingState, EffectiveInstant, EffectiveItem, EffectiveJourney, EffectiveWorld } from './effectiveTypes.ts';

export const EFFECTIVE_PROJECTION_VERSION = 'm6-effective/1';

const ref = (kind: TypedRef['kind'], id: string): TypedRef => ({ kind, id });

function serviceTime(service: WTransportService, which: 'departure' | 'arrival'): EffectiveInstant {
  const source = ref('TRANSPORT_SERVICE', service.id);
  for (const [basis, group] of [['ACTUAL', service.actual], ['ESTIMATED', service.estimated], ['PUBLISHED', service.published]] as const) {
    const observed = group[which];
    if (observed) return { value: observed.value, basis, source, evidenceId: observed.evidenceId };
  }
  return { value: null, basis: 'UNKNOWN', source, evidenceId: null };
}

function bookingState(world: CapturedWorld, line: WReservationLine): BookingState {
  const reservation = world.reservations.find((r) => r.id === line.reservationId);
  const entitlements = world.entitlements.filter((e) => e.lineIds.includes(line.id));
  const reasonCodes: string[] = [];
  let bookingValid: BookingState['bookingValid'];
  if (!reservation) {
    bookingValid = 'UNKNOWN';
    reasonCodes.push('reservation_not_captured');
  } else if (reservation.observedStatus === 'CANCELLED' || line.observedStatus === 'CANCELLED') {
    bookingValid = 'INVALID';
    reasonCodes.push(reservation.observedStatus === 'CANCELLED' ? 'reservation_cancelled' : 'line_cancelled');
  } else if (line.observedStatus === 'CONFIRMED' || line.observedStatus === 'FULFILLED') {
    bookingValid = 'VALID';
    reasonCodes.push(line.observedStatus === 'FULFILLED' ? 'line_fulfilled' : 'line_confirmed');
  } else {
    bookingValid = 'UNKNOWN';
    reasonCodes.push(line.observedStatus === 'HELD' ? 'line_held_not_confirmed' : 'line_status_unknown');
  }
  if (entitlements.some((e) => e.observedStatus === 'VOID' || e.observedStatus === 'REVOKED')) reasonCodes.push('entitlement_void_or_revoked');
  return {
    reservationRef: ref('RESERVATION', line.reservationId),
    lineRef: ref('RESERVATION_LINE', line.id),
    reservationStatus: reservation?.observedStatus ?? 'UNKNOWN',
    lineStatus: line.observedStatus,
    entitlementStatuses: entitlements.map((e) => e.observedStatus).sort(),
    bookingValid,
    reasonCodes,
  };
}

function intended(item: WJourneyItem, which: 'start' | 'end'): EffectiveInstant {
  const source = ref('JOURNEY_ITEM', item.id);
  const value = item.intendedWindow?.[which] ?? null;
  return { value, basis: value ? 'INTENDED' : 'UNKNOWN', source, evidenceId: null };
}

function projectItem(world: CapturedWorld, travellerId: string, item: WJourneyItem): EffectiveItem {
  const itemRef = ref('JOURNEY_ITEM', item.id);
  const allocations = world.allocations.filter((a) => a.journeyItemId === item.id);
  const lines = allocations
    .map((a) => world.reservationLines.find((l) => l.id === a.lineId))
    .filter((l): l is WReservationLine => l !== undefined);
  const bookings = [...new Map(lines.map((l) => [l.id, bookingState(world, l)])).values()].sort((a, b) => a.lineRef.id.localeCompare(b.lineRef.id));
  const divergences: string[] = [];
  const base = {
    itemRef, journeyRef: ref('JOURNEY', item.journeyId), travellerId, kind: item.kind, orderKey: item.orderKey,
    active: item.lifecycleStatus !== 'DROPPED' && item.lifecycleStatus !== 'COMPLETED',
    bookings, programmeItemRef: null, participationRef: null, programmeItemStatus: null,
  };

  if (item.kind === 'TRANSPORT') {
    // Cancelled-booking semantics (per item, truthful in both directions):
    //   • cancelled lines superseded by ≥1 active booking for this item use the
    //     active lines for CURRENT booking state — the traveller holds a live
    //     booking, and the replacement is what the rest of the item projects;
    //   • an item whose ONLY lines are cancelled keeps them, so its bookings
    //     are INVALID and evaluation FAILs — a displaced booking with nothing
    //     in its place is a real, blocking supplier-fulfilment failure;
    //   • cancelled history is never erased: booking_validity keeps failing
    //     explanations observable canonically (evaluators read this projection).
    const activeLines = lines.filter((l) => l.observedStatus !== 'CANCELLED');
    const currentLines = activeLines.length > 0 ? activeLines : lines;
    const bookedServiceIds = [...new Set(currentLines.map((l) => l.transportServiceId).filter((id): id is string => id !== null))].sort();
    const bookings = [...new Map(currentLines.map((l) => [l.id, bookingState(world, l)])).values()].sort((a, b) => a.lineRef.id.localeCompare(b.lineRef.id));
    if (item.selectedServiceId && bookedServiceIds.length > 0 && !bookedServiceIds.includes(item.selectedServiceId)) divergences.push('selected_service_differs_from_booked_service');
    if (bookedServiceIds.length > 1) divergences.push('multiple_booked_services_for_one_item');
    const serviceId = item.selectedServiceId ?? bookedServiceIds[0] ?? null;
    const service = serviceId ? world.transportServices.find((s) => s.id === serviceId) : undefined;
    if (serviceId && !service) divergences.push('service_not_captured');
    if (service && (service.originPlaceId !== item.desiredOriginPlaceId || service.destinationPlaceId !== item.desiredDestinationPlaceId)) {
      divergences.push('service_endpoints_differ_from_intent');
    }
    return {
      ...base,
      bookings,
      start: service ? serviceTime(service, 'departure') : intended(item, 'start'),
      end: service ? serviceTime(service, 'arrival') : intended(item, 'end'),
      startPlaceId: service?.originPlaceId ?? item.desiredOriginPlaceId,
      endPlaceId: service?.destinationPlaceId ?? item.desiredDestinationPlaceId,
      serviceRef: serviceId ? ref('TRANSPORT_SERVICE', serviceId) : null,
      divergences,
    };
  }

  if (item.kind === 'ENGAGEMENT') {
    if (item.participationId) {
      const participation = world.participations.find((p) => p.id === item.participationId);
      const programmeItem = participation ? world.programmeItems.find((p) => p.id === participation.programmeItemId) : undefined;
      if (!participation || !programmeItem) divergences.push('participation_or_programme_item_not_captured');
      const source = programmeItem ? ref('PROGRAMME_ITEM', programmeItem.id) : itemRef;
      const at = (which: 'start' | 'end'): EffectiveInstant =>
        programmeItem?.window ? { value: programmeItem.window[which], basis: 'PROGRAMME_SCHEDULE', source, evidenceId: null } : { value: null, basis: 'UNKNOWN', source, evidenceId: null };
      return {
        ...base,
        start: at('start'), end: at('end'),
        startPlaceId: programmeItem?.placeId ?? null, endPlaceId: programmeItem?.placeId ?? null,
        serviceRef: null,
        programmeItemRef: programmeItem ? ref('PROGRAMME_ITEM', programmeItem.id) : null,
        participationRef: ref('PARTICIPATION', item.participationId),
        programmeItemStatus: programmeItem?.lifecycleStatus ?? null,
        divergences,
      };
    }
    const at = (which: 'start' | 'end'): EffectiveInstant =>
      item.standaloneWindow ? { value: item.standaloneWindow[which], basis: 'STANDALONE_APPOINTMENT', source: itemRef, evidenceId: null } : intended(item, which);
    return { ...base, start: at('start'), end: at('end'), startPlaceId: null, endPlaceId: null, serviceRef: null, divergences };
  }

  // STAY / RESOURCE_USE: a booked line interval is supplier truth for occupancy; intent otherwise.
  const interval = lines.map((l) => l.interval).find((i) => i !== null) ?? null;
  const intervalLine = lines.find((l) => l.interval !== null);
  const at = (which: 'start' | 'end'): EffectiveInstant =>
    interval && intervalLine
      ? { value: interval[which], basis: 'SUPPLIER_INTERVAL', source: ref('RESERVATION_LINE', intervalLine.id), evidenceId: intervalLine.evidenceId }
      : intended(item, which);
  const resource = item.resourceId ? world.resources.find((r) => r.id === item.resourceId) : undefined;
  const placeId = lines.map((l) => l.placeId).find((p) => p !== null) ?? item.intendedPlaceId ?? item.intendedLocationPlaceId ?? resource?.locationPlaceId ?? null;
  if (item.intendedPlaceId && lines.some((l) => l.placeId !== null && l.placeId !== item.intendedPlaceId)) divergences.push('booked_place_differs_from_intent');
  return { ...base, start: at('start'), end: at('end'), startPlaceId: placeId, endPlaceId: placeId, serviceRef: null, divergences };
}

function compareItems(a: EffectiveItem, b: EffectiveItem): number {
  if (a.start.value && b.start.value) {
    const byTime = compareInstants(a.start.value, b.start.value);
    if (byTime !== 0) return byTime;
  }
  return a.orderKey.localeCompare(b.orderKey) || a.itemRef.id.localeCompare(b.itemRef.id);
}

export function projectEffectiveWorld(world: CapturedWorld): EffectiveWorld {
  const journeys: EffectiveJourney[] = [...world.journeys]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((journey) => {
      const items = world.journeyItems
        .filter((item) => item.journeyId === journey.id)
        .map((item) => projectItem(world, journey.travellerId, item));
      // Order by orderKey first so UNKNOWN-time items keep their intended position, then stable time sort.
      const ordered = items.sort((a, b) => a.orderKey.localeCompare(b.orderKey) || a.itemRef.id.localeCompare(b.itemRef.id));
      const timed = [...ordered].sort(compareItems);
      return {
        journeyRef: ref('JOURNEY', journey.id), tripRef: ref('TRIP', journey.tripId), travellerId: journey.travellerId,
        revision: journey.revision, lifecycleStatus: journey.lifecycleStatus, items: timed,
      };
    });
  return { journeys };
}

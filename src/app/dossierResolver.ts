/**
 * Mission 2 — per-intent dossier resolution for the composed executor.
 *
 * Booking identity must NEVER derive from LLM output and must NEVER be
 * scenario-keyed. Resolution follows authoritative graph state only:
 *
 *   intent.caseId -> RecoveryCase.tripId -> Trip.travellerIds -> dossier store
 *
 * Every bundle seeds dossiers through the same generic seed path; a trip
 * whose travellers have no validated dossier resolves nothing, and the
 * executor's fail-closed refusal semantics apply unchanged.
 */
import type { ActionIntent } from '../operational/intent.ts';
import type { CaseRepository, TripRepository } from '../contracts/repositories.ts';
import type { EntityId } from '../domain/common.ts';
import { STAY_RATE_BOOKING_REF_SYSTEM } from '../domain/elements.ts';
import type { BookingDossierStore } from './dossierStore.ts';
import type { FlightBookingDossier, HotelReplacementDossier } from './providerExecution.ts';

export interface DossierResolverDependencies {
  cases: CaseRepository;
  trips: TripRepository;
  dossiers: BookingDossierStore;
}

interface BookingRefEntry {
  system: string;
  reference: string;
}

function bookingRefsOf(intent: ActionIntent): BookingRefEntry[] {
  const raw = intent.parameters['bookingRefs'];
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is BookingRefEntry =>
      Boolean(entry) &&
      typeof entry === 'object' &&
      typeof (entry as Record<string, unknown>)['system'] === 'string' &&
      typeof (entry as Record<string, unknown>)['reference'] === 'string',
  );
}

async function travellerIdsForIntent(deps: DossierResolverDependencies, intent: ActionIntent): Promise<EntityId[]> {
  const recoveryCase = await deps.cases.getCase(intent.caseId);
  if (!recoveryCase) return [];
  const trip = await deps.trips.getTrip(recoveryCase.tripId);
  if (!trip) return [];
  return trip.travellerIds;
}

/**
 * Flight booking dossier: the first trip traveller with a validated flight
 * dossier. Passengers/contact/paymentRef come from the store verbatim —
 * never reconstructed from traveller display names or model output.
 */
export function createFlightDossierResolver(deps: DossierResolverDependencies) {
  return async (intent: ActionIntent): Promise<FlightBookingDossier | undefined> => {
    for (const travellerId of await travellerIdsForIntent(deps, intent)) {
      const record = await deps.dossiers.flightFor(travellerId);
      if (record) {
        return { passengers: record.passengers, contact: record.contact, paymentRef: record.paymentRef };
      }
    }
    return undefined;
  };
}

/**
 * Hotel replacement dossier: guest identity from the validated store,
 * replacement rate/displaced stay from authoritative trip + intent evidence.
 * The replacement rate id is the strategy's candidate booking reference the
 * intent already carries; the displaced stay is the trip's existing STAY
 * element booking reference (when one exists). Absent evidence => absent
 * field, never invented.
 */
export function createHotelDossierResolver(deps: DossierResolverDependencies) {
  return async (intent: ActionIntent): Promise<HotelReplacementDossier | undefined> => {
    const travellerIds = await travellerIdsForIntent(deps, intent);
    let record;
    for (const travellerId of travellerIds) {
      record = await deps.dossiers.hotelFor(travellerId);
      if (record) break;
    }
    if (!record) return undefined;

    const replacementRateId = bookingRefsOf(intent).find(
      (ref) => ref.system === STAY_RATE_BOOKING_REF_SYSTEM,
    )?.reference;
    if (!replacementRateId) return undefined;

    const recoveryCase = await deps.cases.getCase(intent.caseId);
    const trip = recoveryCase ? await deps.trips.getTrip(recoveryCase.tripId) : undefined;
    const stayElement = trip?.elements.find((element) => element.elementKind === 'STAY');
    const displacedBookingId =
      stayElement && stayElement.elementKind === 'STAY'
        ? stayElement.data.bookingRef?.reference
        : undefined;

    return {
      replacementRateId,
      guestNames: record.guestNames,
      ...(displacedBookingId ? { displacedBookingId } : {}),
      ...(record.paymentRef ? { paymentRef: record.paymentRef } : {}),
    };
  };
}

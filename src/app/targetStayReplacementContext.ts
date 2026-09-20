/**
 * Build the read-only hotel context for a captured stay replacement.
 *
 * Every provider-facing value in this module comes from either the captured
 * snapshot or an explicit protected binding.  A missing, stale, or ambiguous
 * binding returns no context; this module never fills in traveller or hotel
 * defaults.
 */
import { createHash } from 'node:crypto';
import type { ExternalRef, HotelSearchQuery } from '../contracts/capabilities.ts';
import {
  PlanningToolProvenanceSchema,
  type PlanningToolProvenance,
} from '../contracts/v2/planning/planningTool.ts';
import type { Instant } from '../domain/v2/shared/time.ts';
import { compareInstants, InstantIntervalSchema } from '../domain/v2/shared/time.ts';
import { normalizeExtractedTemporal } from '../ingest/temporal.ts';
import type { ProposalCandidate } from '../resolution/planning/proposer.ts';
import {
  type HotelPlanningContext,
  type StayReplacementContext,
  type StayReplacementContextResolver,
} from './targetHotelCompanionPlanning.ts';
import type { ResolvedOffer } from '../resolution/scenarios/overlay.ts';
import type { CapturedWorld, WCredential, WCredentialVersion } from '../resolution/world/world.ts';
import { projectEffectiveWorld } from '../resolution/world/effectiveItinerary.ts';

const SUBJECT_ID = /^[A-Za-z0-9][A-Za-z0-9_\-:.]*$/;
const NATIONALITY = /^[A-Z]{2}$/;

/** Protected provider and traveller facts supplied by the trusted coordinator. */
export interface StayReplacementBinding {
  reservationId: string;
  reservationLineId: string;
  /** Opaque provider stay element, keyed by the captured reservation identity. */
  stayElementId: string;
  propertyExternalRef: ExternalRef;
  passport: {
    credentialId: string;
    credentialVersionId: string;
    guestNationality: string;
  };
  guests: { adults: number; rooms: number };
  /** Existing visit only; this resolver never creates entry policy. */
  visitId: string;
  /** Source/booking provenance captured with the binding, never generated here. */
  provenance: PlanningToolProvenance;
}

function stableId(prefix: string, value: string): string {
  return `${prefix}:${createHash('sha256').update(value).digest('hex').slice(0, 32)}`;
}

function localParts(instant: Instant, timeZone: string): {
  date: string;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
} | undefined {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(instant));
    const values = new Map(parts.map((part) => [part.type, part.value]));
    const year = Number(values.get('year'));
    const month = Number(values.get('month'));
    const day = Number(values.get('day'));
    const hour = Number(values.get('hour'));
    const minute = Number(values.get('minute'));
    const second = Number(values.get('second'));
    const millis = new Date(instant).getUTCMilliseconds();
    if (![year, month, day, hour, minute, second, millis].every(Number.isInteger)
      || hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return undefined;
    return {
      date: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      hour, minute, second, millisecond: millis,
    };
  } catch {
    return undefined;
  }
}

/** Resolve a local wall-clock value through the repository's deterministic temporal normalizer. */
function localDateTimeToInstant(
  date: string,
  clock: Pick<ReturnType<typeof localParts> & object, 'hour' | 'minute' | 'second' | 'millisecond'>,
  timeZone: string,
): Instant | undefined {
  return normalizeExtractedTemporal(
    `${date}T${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}:${String(clock.second).padStart(2, '0')}`,
    timeZone,
  ) as Instant | undefined;
}

function sameRef(a: ExternalRef, b: ExternalRef): boolean {
  return a.system === b.system && a.value === b.value;
}

function currentPassport(
  world: CapturedWorld,
  journeyId: string,
  travellerId: string,
  binding: StayReplacementBinding,
): { credential: WCredential; version: WCredentialVersion } | undefined {
  const credentials = world.credentials.filter((candidate) => candidate.id === binding.passport.credentialId);
  const versions = world.credentialVersions.filter((candidate) => candidate.id === binding.passport.credentialVersionId);
  const selections = world.credentialSelections.filter((candidate) =>
    candidate.journeyId === journeyId && candidate.credentialId === binding.passport.credentialId
      && candidate.credentialVersionId === binding.passport.credentialVersionId
      && candidate.intendedVisitIds.includes(binding.visitId),
  );
  if (credentials.length !== 1 || versions.length !== 1 || selections.length !== 1) return undefined;
  const credential = credentials[0]!;
  const version = versions[0]!;
  if (credential.travellerId !== travellerId || credential.kind !== 'PASSPORT'
    || credential.currentVersionId !== version.id || version.credentialId !== credential.id
    || version.issuingStateCode !== binding.passport.guestNationality) return undefined;
  return { credential, version };
}

function validBinding(binding: StayReplacementBinding): boolean {
  const provenance = PlanningToolProvenanceSchema.safeParse(binding.provenance);
  return SUBJECT_ID.test(binding.reservationId)
    && SUBJECT_ID.test(binding.reservationLineId)
    && SUBJECT_ID.test(binding.stayElementId)
    && SUBJECT_ID.test(binding.visitId)
    && binding.propertyExternalRef.system.trim().length > 0
    && binding.propertyExternalRef.value.trim().length > 0
    && NATIONALITY.test(binding.passport.guestNationality)
    && Number.isSafeInteger(binding.guests.adults) && binding.guests.adults > 0
    && Number.isSafeInteger(binding.guests.rooms) && binding.guests.rooms > 0
    && provenance.success && provenance.data.sourceRefs.length > 0;
}

/**
 * Create the existing planner resolver from explicit protected bindings.
 * The returned function is pure and read-only with respect to the captured world.
 */
export function createStayReplacementContextResolver(binding: StayReplacementBinding): StayReplacementContextResolver {
  return ({ candidate, world, resolvedOffers, now }): StayReplacementContext | undefined => {
    if (!validBinding(binding)) return undefined;
    if (compareInstants(binding.provenance.observedAt, now) > 0) return undefined;
    // The line id is intentionally never treated as an item id; resolve the stay only from its allocation.
    const lineMatches = world.reservationLines.filter((line) => line.id === binding.reservationLineId);
    if (lineMatches.length !== 1) return undefined;
    const line = lineMatches[0]!;
    if (line.reservationId !== binding.reservationId || line.productType !== 'STAY'
      || !['HELD', 'CONFIRMED'].includes(line.observedStatus)) return undefined;
    const reservationMatches = world.reservations.filter((reservation) => reservation.id === binding.reservationId);
    if (reservationMatches.length !== 1 || reservationMatches[0]!.reservationType !== 'STAY'
      || !['HELD', 'CONFIRMED'].includes(reservationMatches[0]!.observedStatus)) return undefined;

    const allocations = world.allocations.filter((allocation) =>
      allocation.reservationId === line.reservationId && allocation.lineId === line.id && allocation.journeyItemId !== null,
    );
    if (allocations.length !== 1) return undefined;
    const allocation = allocations[0]!;
    const oldMatches = world.journeyItems.filter((item) => item.id === allocation.journeyItemId);
    if (oldMatches.length !== 1) return undefined;
    const old = oldMatches[0]!;
    if (old.kind !== 'STAY' || old.lifecycleStatus === 'DROPPED' || old.lifecycleStatus === 'COMPLETED') return undefined;
    const journeyMatches = world.journeys.filter((journey) => journey.id === old.journeyId);
    if (journeyMatches.length !== 1) return undefined;
    const journey = journeyMatches[0]!;
    if (allocation.travellerId !== journey.travellerId || !world.travellers.some((traveller) => traveller.id === journey.travellerId)) return undefined;

    const visitMatches = world.intendedVisits.filter((visit) => visit.id === binding.visitId && visit.journeyId === journey.id);
    if (visitMatches.length !== 1) return undefined;
    const visit = visitMatches[0]!;
    if (visit.transitIntent) return undefined;
    if (!currentPassport(world, journey.id, journey.travellerId, binding)) return undefined;

    const selects = candidate.effects.filter((effect): effect is Extract<ProposalCandidate['effects'][number], { effectKind: 'SELECT_OFFER' }> => effect.effectKind === 'SELECT_OFFER');
    if (selects.length !== 1) return undefined;
    const selected = selects[0]!;
    const offers = resolvedOffers.filter((offer) => offer.offerId === selected.offerId);
    if (offers.length !== 1) return undefined;
    const selectedService = world.transportServices.find((service) => service.id === offers[0]!.transportServiceId);
    const arrivalMatches = world.journeyItems.filter((item) => item.id === selected.journeyItemId);
    if (!selectedService || arrivalMatches.length !== 1 || arrivalMatches[0]!.kind !== 'TRANSPORT'
      || arrivalMatches[0]!.journeyId !== journey.id) return undefined;
    const arrivalItem = arrivalMatches[0]!;

    const originalEffective = projectEffectiveWorld(world).journeys.find((entry) => entry.journeyRef.id === journey.id);
    const originalArrival = originalEffective?.items.find((item) => item.itemRef.id === arrivalItem.id);
    const originalStay = originalEffective?.items.find((item) => item.itemRef.id === old.id);
    if (!originalArrival?.end.value || !originalStay?.start.value || !originalStay.end.value) return undefined;
    const placeId = originalStay.startPlaceId;
    const place = placeId ? world.places.find((candidatePlace) => candidatePlace.id === placeId) : undefined;
    const arrivalPlaceId = originalArrival.endPlaceId;
    const arrivalPlace = arrivalPlaceId ? world.places.find((candidatePlace) => candidatePlace.id === arrivalPlaceId) : undefined;
    if (!place || !place.externalRefs || place.externalRefs.filter((ref) => sameRef(ref, binding.propertyExternalRef)).length !== 1
      || !arrivalPlace || selectedService.destinationPlaceId !== arrivalPlace.id
      || !world.placeJurisdictions.some((membership) => membership.placeId === place.id && membership.jurisdictionId === visit.jurisdictionId)
      || !world.placeJurisdictions.some((membership) => membership.placeId === arrivalPlace.id && membership.jurisdictionId === visit.jurisdictionId)) return undefined;
    const candidateWorld = structuredClone(world);
    const candidateArrivalItem = candidateWorld.journeyItems.find((item) => item.id === arrivalItem.id);
    if (!candidateArrivalItem) return undefined;
    candidateArrivalItem.selectedServiceId = selectedService.id;
    const candidateEffective = projectEffectiveWorld(candidateWorld).journeys.find((entry) => entry.journeyRef.id === journey.id);
    const candidateArrival = candidateEffective?.items.find((item) => item.itemRef.id === arrivalItem.id);
    if (!candidateArrival?.end.value) return undefined;
    const originalArrivalParts = localParts(originalArrival.end.value, place.timeZone);
    const candidateArrivalParts = localParts(candidateArrival.end.value, place.timeZone);
    const originalStayParts = localParts(originalStay.start.value, place.timeZone);
    const originalCheckoutDate = localParts(originalStay.end.value, place.timeZone)?.date;
    if (!originalArrivalParts || !candidateArrivalParts || !originalStayParts || !originalCheckoutDate
      || candidateArrivalParts.date === originalStayParts.date) return undefined;

    const constraintMatches = world.constraints.filter((constraint) =>
      constraint.registeredType === 'stay_arrival_date_aligned'
        && constraint.owner.kind === 'JOURNEY' && constraint.owner.id === journey.id
        && constraint.operands.some((operand) => operand.key === 'original_stay_item' && operand.subject?.kind === 'JOURNEY_ITEM' && operand.subject.id === old.id)
        && constraint.operands.some((operand) => operand.key === 'arrival_item' && operand.subject?.kind === 'JOURNEY_ITEM' && operand.subject.id === arrivalItem.id),
    );
    if (constraintMatches.length !== 1) return undefined;

    const replacementStart = localDateTimeToInstant(candidateArrivalParts.date, originalStayParts, place.timeZone);
    if (!replacementStart) return undefined;
    const stayWindow = InstantIntervalSchema.safeParse({ start: replacementStart, end: originalStay.end.value });
    if (!stayWindow.success || Date.parse(stayWindow.data.start) >= Date.parse(stayWindow.data.end)) return undefined;
    if (compareInstants(visit.intended.start, stayWindow.data.start) > 0
      || compareInstants(visit.intended.end, stayWindow.data.end) < 0) return undefined;

    const query: HotelSearchQuery = {
      location: { externalRef: binding.propertyExternalRef },
      checkInDate: candidateArrivalParts.date,
      checkOutDate: originalCheckoutDate,
      guests: { adults: binding.guests.adults },
      rooms: binding.guests.rooms,
      guestNationality: binding.passport.guestNationality,
    };
    const proposedJourneyItemId = stableId('stay-replacement', `${candidate.key}|${old.id}|${binding.reservationLineId}|${selectedService.id}`);
    // The final replacement candidate cancels the old item before adding this one.
    // Refuse a pre-existing same-order peer so the overlay cannot create an ambiguous order.
    if (world.journeyItems.some((item) => item.id !== old.id && item.journeyId === journey.id
      && item.lifecycleStatus !== 'DROPPED' && item.lifecycleStatus !== 'COMPLETED' && item.orderKey === old.orderKey)) return undefined;
    const replacement: HotelPlanningContext = {
      baseCandidateKey: candidate.key,
      journeyId: journey.id,
      placeId: place.id,
      query,
      stayWindow: stayWindow.data,
      proposedJourneyItemId,
      orderKey: old.orderKey,
      visit: { kind: 'EXISTING', visitId: visit.id },
      provenance: binding.provenance,
    };
    return {
      oldJourneyItemId: old.id,
      reservationLineId: line.id,
      stayElementId: binding.stayElementId,
      replacement,
    };
  };
}

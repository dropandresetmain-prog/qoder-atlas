import assert from 'node:assert/strict';
import test from 'node:test';
import { createStayReplacementContextResolver, type StayReplacementBinding } from '../src/app/targetStayReplacementContext.ts';
import type { ProposalCandidate } from '../src/resolution/planning/proposer.ts';
import type { CapturedWorld } from '../src/resolution/world/world.ts';
import { applyScenarioOverlay } from '../src/resolution/scenarios/overlay.ts';

const originalStart = '2026-09-29T15:00:00+09:00';
const originalEnd = '2026-10-02T11:00:00+09:00';
const world = (): CapturedWorld => ({
  workspaceId: 'workspace-a', focus: [], edges: [],
  capture: { isolation: 'REPEATABLE_READ', readOnly: true, databaseSnapshot: 'snapshot-a', capturedAt: '2026-09-01T00:00:00Z', modelVersion: 'm6-world/1' },
  manifest: {} as CapturedWorld['manifest'],
  travellers: [{ id: 'traveller-a', revision: 1, lifecycleStatus: 'ACTIVE' }],
  profileAssertions: [],
  credentials: [{ id: 'passport-a', travellerId: 'traveller-a', kind: 'PASSPORT', issuerCountry: 'SG', currentVersionId: 'passport-a-v2' }],
  credentialVersions: [{ id: 'passport-a-v2', credentialId: 'passport-a', kind: 'PASSPORT', editionNumber: 2, issueDate: '2025-01-01', expiryDate: '2030-01-01', issuerStatus: 'VALID', physicallyAvailable: true, evidenceId: 'e-passport', issuingStateCode: 'SG', visaClass: null, permittedActivities: [], entriesAllowed: null, permittedStayDays: null }],
  credentialLinks: [], travelHistory: [], organisations: [],
  trips: [{ id: 'trip-a', revision: 1, purpose: 'business', lifecycleStatus: 'ACTIVE', intendedWindow: null, businessContextOrganisationId: null }],
  journeys: [{ id: 'journey-a', revision: 1, tripId: 'trip-a', travellerId: 'traveller-a', lifecycleStatus: 'ACTIVE', intendedWindow: null, responsibilityOrganisationId: null }],
  journeyItems: [
    { id: 'arrival-a', journeyId: 'journey-a', kind: 'TRANSPORT', orderKey: '10', lifecycleStatus: 'CONFIRMED', flexible: false, intendedWindow: null, desiredOriginPlaceId: 'airport-a', desiredDestinationPlaceId: 'airport-a', selectedServiceId: 'service-original', intendedPlaceId: null, requiredNights: null, participationId: null, standaloneTitle: null, standaloneWindow: null, resourceId: null, intendedLocationPlaceId: null },
    { id: 'stay-a', journeyId: 'journey-a', kind: 'STAY', orderKey: '20', lifecycleStatus: 'CONFIRMED', flexible: false, intendedWindow: { start: originalStart, end: originalEnd }, desiredOriginPlaceId: null, desiredDestinationPlaceId: null, selectedServiceId: null, intendedPlaceId: 'hotel-place-a', requiredNights: 2, participationId: null, standaloneTitle: null, standaloneWindow: null, resourceId: null, intendedLocationPlaceId: null },
  ],
  intendedVisits: [{ id: 'visit-a', journeyId: 'journey-a', jurisdictionId: 'jurisdiction-a', purpose: 'business visit', intended: { start: '2026-09-28T00:00:00Z', end: '2026-10-04T00:00:00Z' }, transitIntent: false }],
  credentialSelections: [{ id: 'selection-a', journeyId: 'journey-a', credentialId: 'passport-a', credentialVersionId: 'passport-a-v2', intendedVisitIds: ['visit-a'] }],
  coordinationGroups: [], groupMemberships: [], accompanimentRequirements: [], supportAssignments: [],
  transportServices: [
    { id: 'service-original', revision: 1, mode: 'FLIGHT', operator: 'carrier-a', originPlaceId: 'airport-a', destinationPlaceId: 'airport-a', published: { departure: null, arrival: { value: '2026-09-28T21:00:00Z', observedAt: '2026-09-01T00:00:00Z', evidenceId: 'e-original' } }, estimated: { departure: null, arrival: null }, actual: { departure: null, arrival: null } },
    { id: 'service-replacement', revision: 1, mode: 'FLIGHT', operator: 'carrier-b', originPlaceId: 'airport-a', destinationPlaceId: 'airport-a', published: { departure: null, arrival: { value: '2026-09-30T07:00:00Z', observedAt: '2026-09-01T00:00:00Z', evidenceId: 'e-replacement' } }, estimated: { departure: null, arrival: null }, actual: { departure: null, arrival: null } },
  ],
  resources: [],
  reservations: [{ id: 'reservation-a', revision: 1, reservationType: 'STAY', observedStatus: 'CONFIRMED', observedStatusAt: '2026-09-01T00:00:00Z', responsibleOrganisationId: null, responsibleTravellerId: 'traveller-a' }],
  reservationLines: [{ id: 'line-a', reservationId: 'reservation-a', productType: 'STAY', observedStatus: 'CONFIRMED', observedStatusAt: '2026-09-01T00:00:00Z', evidenceId: 'e-booking', transportServiceId: null, resourceId: null, placeId: 'hotel-place-a', interval: { start: originalStart, end: originalEnd } }],
  allocations: [{ id: 'allocation-a', reservationId: 'reservation-a', lineId: 'line-a', travellerId: 'traveller-a', journeyItemId: 'stay-a', role: 'TRAVELLER', quantity: 1 }],
  entitlements: [], budgets: [], budgetCommitments: [], costAllocations: [], fxObservations: [],
  programmes: [], programmeItems: [], participations: [], resourceAssignments: [],
  places: [{ id: 'hotel-place-a', revision: 1, name: 'Synthetic Gateway Hotel', placeType: 'HOTEL', timeZone: 'Asia/Tokyo', hasCoordinates: false, externalRefs: [{ system: 'nuitee', value: 'hotel-synthetic-a' }] }, { id: 'airport-a', revision: 1, name: 'Synthetic Airport', placeType: 'AIRPORT', timeZone: 'Asia/Tokyo', hasCoordinates: false, externalRefs: [] }],
  jurisdictions: [{ id: 'jurisdiction-a', revision: 1, name: 'Synthetic jurisdiction', regimeKind: 'ENTRY' }],
  placeJurisdictions: [{ placeId: 'hotel-place-a', jurisdictionId: 'jurisdiction-a', basis: 'AREA_MEMBERSHIP', areaVersionId: 'area-a', evidenceId: 'e-place' }, { placeId: 'airport-a', jurisdictionId: 'jurisdiction-a', basis: 'AREA_MEMBERSHIP', areaVersionId: 'area-a', evidenceId: 'e-airport-place' }],
  objectives: [], constraints: [{ id: 'constraint-a', revision: 1, registeredType: 'stay_arrival_date_aligned', hardness: 'HARD', owner: { kind: 'JOURNEY', id: 'journey-a' }, provenanceEvidenceId: 'e-constraint', operands: [
    { key: 'original_stay_item', kind: 'JOURNEY_ITEM', subject: { kind: 'JOURNEY_ITEM', id: 'stay-a' }, text: null, number: null, boolean: null, instant: null, localDate: null },
    { key: 'arrival_item', kind: 'JOURNEY_ITEM', subject: { kind: 'JOURNEY_ITEM', id: 'arrival-a' }, text: null, number: null, boolean: null, instant: null, localDate: null },
  ] }], dependencies: [], ruleSetVersions: [], ruleAssignments: [], informationVersions: [], coverage: [],
});

const binding = (): StayReplacementBinding => ({
  reservationId: 'reservation-a', reservationLineId: 'line-a', stayElementId: 'provider-stay-element-a',
  propertyExternalRef: { system: 'nuitee', value: 'hotel-synthetic-a' },
  passport: { credentialId: 'passport-a', credentialVersionId: 'passport-a-v2', guestNationality: 'SG' },
  guests: { adults: 1, rooms: 1 }, visitId: 'visit-a',
  provenance: { mode: 'REPLAY', providerId: 'booking-source', observedAt: '2026-09-01T00:00:00Z', sourceRefs: ['e-booking'] },
});

const candidate = (): ProposalCandidate => ({
  key: 'candidate-replacement-a',
  effects: [{ effectKind: 'SELECT_OFFER', journeyItemId: 'arrival-a', offerId: 'flight-offer-replacement' }],
  affectedSubjectRefs: [{ kind: 'JOURNEY_ITEM', id: 'arrival-a' }],
  rationale: 'selected transport changes the arrival date', assumptions: [],
});

const offers = [{ offerId: 'flight-offer-replacement', transportServiceId: 'service-replacement' }];

test('builds a same-property replacement for a changed arrival date without mutating the captured world', () => {
  const captured = world();
  const before = structuredClone(captured);
  const result = createStayReplacementContextResolver(binding())({ candidate: candidate(), world: captured, resolvedOffers: offers, now: '2026-09-01T00:00:00Z' });
  assert.ok(result);
  assert.equal(result.oldJourneyItemId, 'stay-a');
  assert.equal(result.stayElementId, 'provider-stay-element-a');
  assert.deepEqual(result.replacement.query.location.externalRef, { system: 'nuitee', value: 'hotel-synthetic-a' });
  assert.equal(result.replacement.query.checkInDate, '2026-09-30');
  assert.equal(result.replacement.query.checkOutDate, '2026-10-02');
  assert.deepEqual(result.replacement.query.guests, { adults: 1 });
  assert.equal(result.replacement.query.guestNationality, 'SG');
  assert.equal(result.replacement.stayWindow.end, originalEnd);
  assert.deepEqual(result.replacement.visit, { kind: 'EXISTING', visitId: 'visit-a' });
  assert.deepEqual(result.replacement.preferredPropertyRef, { system: 'nuitee', value: 'hotel-synthetic-a' });
  assert.deepEqual(captured, before);
});

test('area search expands replacement research beyond the displaced property while preferring it', () => {
  const captured = world();
  const withArea = binding();
  withArea.areaSearch = { latitude: 1.3, longitude: 103.84, radiusKm: 5 };
  const result = createStayReplacementContextResolver(withArea)({
    candidate: candidate(), world: captured, resolvedOffers: offers, now: '2026-09-01T00:00:00Z',
  });
  assert.ok(result);
  assert.deepEqual(result.replacement.query.location.coordinates, {
    latitude: 1.3, longitude: 103.84, radiusKm: 5,
  });
  assert.equal(result.replacement.query.location.externalRef, undefined);
  assert.deepEqual(result.replacement.preferredPropertyRef, { system: 'nuitee', value: 'hotel-synthetic-a' });
  assert.equal(result.replacement.query.checkInDate, '2026-09-30');
  assert.equal(result.replacement.query.checkOutDate, '2026-10-02');
});

test('fails closed for source, passport, property, or allocation ambiguity', () => {
  const cases: Array<(input: StayReplacementBinding, captured: CapturedWorld) => void> = [
    (input) => { input.provenance = { ...input.provenance, sourceRefs: [] }; },
    (input) => { input.passport = { ...input.passport, credentialVersionId: 'missing-version' }; },
    (input) => { input.propertyExternalRef = { system: 'nuitee', value: 'other-property' }; },
    (_input, captured) => { captured.allocations.push({ ...captured.allocations[0]!, id: 'allocation-ambiguous' }); },
  ];
  for (const mutate of cases) {
    const captured = world();
    const input = binding();
    mutate(input, captured);
    assert.equal(createStayReplacementContextResolver(input)({ candidate: candidate(), world: captured, resolvedOffers: offers, now: '2026-09-01T00:00:00Z' }), undefined);
  }
});

test('does not accept a selected service for a different destination', () => {
  const captured = world();
  captured.transportServices.push({ ...captured.transportServices[1]!, id: 'service-wrong-place', destinationPlaceId: 'hotel-place-a' });
  const inputCandidate = candidate();
  inputCandidate.effects[0] = { effectKind: 'SELECT_OFFER', journeyItemId: 'arrival-a', offerId: 'wrong-place-offer' };
  assert.equal(createStayReplacementContextResolver(binding())({ candidate: inputCandidate, world: captured, resolvedOffers: [{ offerId: 'wrong-place-offer', transportServiceId: 'service-wrong-place' }], now: '2026-09-01T00:00:00Z' }), undefined);
});

test('accepts the generated cancel-and-add overlay with the retired item order key', () => {
  const captured = world();
  const result = createStayReplacementContextResolver(binding())({ candidate: candidate(), world: captured, resolvedOffers: offers, now: '2026-09-01T00:00:00Z' });
  assert.ok(result);
  const overlay = applyScenarioOverlay({
    baseWorld: captured,
    resolvedOffers: offers,
    resolvedStayOffers: [{ offerId: 'stay-offer-a', placeId: 'hotel-place-a', stayWindow: result.replacement.stayWindow, price: { amount: '100.00', currency: 'USD' } }],
    scenarioChange: {
      id: 'change-a', recoveryStrategyId: 'strategy-a', strategyVersion: 1, basisAssessmentId: 'assessment-a',
      affectedSubjectRefs: [{ kind: 'JOURNEY', id: 'journey-a' }],
      effects: [
        { effectKind: 'SELECT_OFFER', journeyItemId: 'arrival-a', offerId: 'flight-offer-replacement' },
        { effectKind: 'CANCEL_STAY', journeyItemId: 'stay-a', reservationLineId: 'line-a', cancellationPenalty: { amount: '0', currency: 'USD' } },
        { effectKind: 'ADD_JOURNEY_STAY', proposedJourneyItemId: result.replacement.proposedJourneyItemId, journeyId: 'journey-a', orderKey: result.replacement.orderKey, offerId: 'stay-offer-a', offerPrice: { amount: '100.00', currency: 'USD' }, visit: result.replacement.visit },
      ],
    },
  });
  assert.equal(overlay.ok, true);
  if (!overlay.ok) return;
  assert.equal(overlay.value.proposedWorld.journeyItems.find((item) => item.id === 'stay-a')?.lifecycleStatus, 'DROPPED');
  assert.equal(overlay.value.proposedWorld.journeyItems.find((item) => item.id === result.replacement.proposedJourneyItemId)?.orderKey, '20');
});

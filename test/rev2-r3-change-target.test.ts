/**
 * REV-2 WP-R3 — carry the whole ResolutionTarget; select the leg by direction.
 *
 * Failing-first regression suite for the Review 2 finding:
 * - changeRequest.ts forwarded only arriveBy/departAfter into the
 *   TRAVELLER_INPUT payload (A2/A3 dimensions never reached the planner);
 * - northstarPlanner.windowShiftOutput bound the FIRST flight leg in array
 *   order regardless of direction (departAfter alone rebooked the OUTBOUND
 *   leg) and emitted one search for a two-dimension request.
 *
 * The fix forwards the complete declarative ResolutionTarget, selects the
 * affected leg by direction from place evidence (arriveBy -> leg arriving at
 * the event place; departAfter -> leg departing it), emits one search per
 * requested dimension, and records explicit uncertainty for every dimension
 * the planner cannot act on (preferDirect, stay proximity, objective
 * effects) — silent dropping is the defect.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { openDatabase } from '../src/persistence/database.ts';
import {
  SqliteAuditRepository,
  SqliteCaseRepository,
  SqliteSignalRepository,
  SqliteSourceRepository,
  SqliteTripRepository,
} from '../src/persistence/repositories.ts';
import { SqliteEntityStore } from '../src/persistence/entityStore.ts';
import { SqlMutationService } from '../src/engine/mutation.ts';
import { SqlitePreferenceStore } from '../src/app/preferenceStore.ts';
import { ProgrammeService } from '../src/app/programme.ts';
import { resolveChangeRequest } from '../src/app/changeRequest.ts';
import { buildTripSnapshot } from '../src/app/snapshot.ts';
import { NorthstarPlanner } from '../src/intelligence/northstarPlanner.ts';
import { ImpactAssessmentSchema } from '../src/operational/impact.ts';
import type { ProgrammeImportDraft } from '../src/contracts/programmeIntake.ts';
import type { AnchorEvent, Organisation, Place } from '../src/domain/entities.ts';
import type { TransportLeg } from '../src/domain/elements.ts';
import type { ChangeRequest } from '../src/contracts/changeRequest.ts';
import type { FlightOffer } from '../src/contracts/capabilities.ts';
import type { PlannerInput } from '../src/contracts/planner.ts';
import type { TripSignal } from '../src/operational/signal.ts';

const AT = '2026-09-01T00:00:00+00:00';

interface Harness {
  service: ProgrammeService;
  trips: SqliteTripRepository;
  entities: SqliteEntityStore;
  sources: SqliteSourceRepository;
  signals: SqliteSignalRepository;
  cases: SqliteCaseRepository;
  audit: SqliteAuditRepository;
  mutations: SqlMutationService;
  snapshotDeps: {
    trips: SqliteTripRepository;
    entities: SqliteEntityStore;
    preferences: SqlitePreferenceStore;
    sources: SqliteSourceRepository;
  };
}

function createHarness(): Harness {
  const db = openDatabase(':memory:');
  const trips = new SqliteTripRepository(db);
  const entities = new SqliteEntityStore(db);
  const sources = new SqliteSourceRepository(db);
  const signals = new SqliteSignalRepository(db);
  const cases = new SqliteCaseRepository(db);
  const audit = new SqliteAuditRepository(db);
  const preferences = new SqlitePreferenceStore(db);
  const mutations = new SqlMutationService({ db, trips, entities });
  const service = new ProgrammeService({ mutations, entities, trips, sources, audit });
  return {
    service,
    trips,
    entities,
    sources,
    signals,
    cases,
    audit,
    mutations,
    snapshotDeps: { trips, entities, preferences, sources },
  };
}

const HOME_PLACE = 'plc-evt-r3-home';
const EVENT_PLACE = 'plc-evt-r3-airport';

/** Synthetic two-leg programme: home airport HOM, event place EVT. */
async function setupTwoLegTrip(harness: Harness): Promise<{ tripId: string }> {
  const eventId = 'evt-r3';
  const organisation: Organisation = {
    id: `org-${eventId}`,
    name: 'Synthetic Programme Organiser',
    roles: ['EVENT_ORGANISER', 'PAYER'],
  };
  const home: Place = {
    id: HOME_PLACE,
    name: 'Synthetic Home Airport',
    kind: 'AIRPORT',
    timezone: 'UTC',
    externalRefs: [{ system: 'airport-code', value: 'HOM' }],
  };
  const event: Place = {
    id: EVENT_PLACE,
    name: 'Synthetic Event Airport',
    kind: 'AIRPORT',
    timezone: 'Asia/Singapore',
    externalRefs: [{ system: 'airport-code', value: 'EVT' }],
  };
  const anchorEvent: AnchorEvent = {
    id: eventId,
    name: 'Synthetic Programme Event',
    kind: 'CONFERENCE',
    placeId: EVENT_PLACE,
    window: { startsAt: '2026-09-07T00:00:00+08:00', endsAt: '2026-09-11T23:59:00+08:00' },
    organiserOrganisationId: organisation.id,
    commitments: [
      {
        id: `cmt-${eventId}-opening`,
        anchorEventId: eventId,
        title: 'Opening Session',
        kind: 'SESSION',
        placeId: EVENT_PLACE,
        startsAt: { value: '2026-09-08T15:00:00+08:00', sourceId: `src-${eventId}`, authority: 'AUTHORITATIVE', observedAt: AT },
        sourceId: `src-${eventId}`,
      },
    ],
    sourceIds: [],
  };
  await harness.service.applyProgrammeContext({
    at: AT,
    sourceId: `src-${eventId}`,
    organisation,
    anchorEvent,
    places: [home, event],
    ruleSets: [],
  });
  const draft: ProgrammeImportDraft = {
    id: `import-${eventId}`,
    anchorEventId: eventId,
    channel: 'BULK_IMPORT',
    sourceId: `src-${eventId}`,
    receivedAt: AT,
    travellers: [
      {
        draftId: 'draft-1',
        displayName: 'Traveller 01',
        identity: { email: 't1@example.test' },
        homeLocationText: 'HOM',
        nationalityCodes: ['SG'],
        accessibilityStatements: [],
        notes: [],
        anchorCommitmentIds: [`cmt-${eventId}-opening`],
      },
    ],
    unresolvedStatements: [],
  };
  const intake = await harness.service.intakeImportDraft({ importDraft: draft, at: AT });
  const tripId = intake.outcomes[0]!.tripId!;

  // Booked two-leg trip: outbound home -> event, return event -> home. The
  // RETURN leg is FIRST-irrelevant: direction must come from place evidence,
  // never array order.
  const fact = (value: string) => ({ value, sourceId: `src-${eventId}`, authority: 'AUTHORITATIVE' as const, observedAt: AT });
  const outbound: TransportLeg = {
    id: `el-${tripId}-out`,
    tripId,
    elementKind: 'TRANSPORT_LEG',
    importance: 'REQUIRED',
    flexibility: 'CHANGEABLE',
    reservationState: 'CONFIRMED',
    status: 'VALID',
    dependsOn: [],
    governedByRuleSetIds: [],
    data: {
      mode: 'FLIGHT',
      originPlaceId: HOME_PLACE,
      destinationPlaceId: EVENT_PLACE,
      scheduledDeparture: fact('2026-09-06T20:00:00+08:00'),
      scheduledArrival: fact('2026-09-06T21:30:00+08:00'),
      bookingRef: { system: 'flight-provider', reference: 'BOOKED-OUT' },
    },
  };
  const returning: TransportLeg = {
    id: `el-${tripId}-ret`,
    tripId,
    elementKind: 'TRANSPORT_LEG',
    importance: 'REQUIRED',
    flexibility: 'CHANGEABLE',
    reservationState: 'CONFIRMED',
    status: 'VALID',
    dependsOn: [],
    governedByRuleSetIds: [],
    data: {
      mode: 'FLIGHT',
      originPlaceId: EVENT_PLACE,
      destinationPlaceId: HOME_PLACE,
      scheduledDeparture: fact('2026-09-11T18:00:00+08:00'),
      scheduledArrival: fact('2026-09-11T23:30:00+08:00'),
      bookingRef: { system: 'flight-provider', reference: 'BOOKED-RET' },
    },
  };
  // Fill the promotion arrival slot too, so the trip's arrival constraint is
  // judged PASS rather than UNKNOWN by any downstream overlay.
  const arrivalSlot: TransportLeg = {
    ...outbound,
    id: `el-${tripId}-arrival`,
    reservationState: 'CONFIRMED',
    data: { ...outbound.data, bookingRef: { system: 'flight-provider', reference: 'BOOKED-ARRIVAL' } },
  };
  const trip = (await harness.trips.getTrip(tripId))!;
  await harness.mutations.applyProposal({
    id: 'prop-book-two-legs',
    origin: 'SYSTEM',
    sourceId: `src-${eventId}`,
    requestedAt: AT,
    rationale: 'book synthetic two-leg trip for the window-shift regression suite',
    operations: [
      { op: 'UPSERT_ENTITY', entityType: 'TRIP', id: tripId, data: { ...trip, elements: [...trip.elements, arrivalSlot, outbound, returning] } },
    ],
  });
  return { tripId };
}

function changeSignal(tripId: string, target: Record<string, unknown>): TripSignal {
  return {
    id: 'sig-cr-test',
    kind: 'TRAVELLER_INPUT',
    occurredAt: '2026-09-05T10:00:00+00:00',
    receivedAt: '2026-09-05T10:00:00+00:00',
    sourceId: 'src-traveller-web',
    authority: 'ASSERTED',
    tripId,
    summary: 'ChangeRequest cr-test',
    payload: { changeRequestId: 'cr-test', intentKind: 'ADJUST_TRIP_WINDOW', target },
  };
}

async function planWindowShift(harness: Harness, tripId: string, signal: TripSignal, offers: FlightOffer[]) {
  const snapshot = await buildTripSnapshot(harness.snapshotDeps, tripId, '2026-09-05T11:00:00+00:00');
  let counter = 0;
  const planner = new NorthstarPlanner(
    { plan: async () => ({ strategies: [], toolRequests: [], assumptions: [], uncertainties: [] }) },
    { idFactory: (prefix) => `${prefix}-${(counter += 1)}`, now: () => AT },
  );
  const input: PlannerInput = {
    caseId: 'case-cr-test',
    snapshot,
    triggeringSignals: [signal],
    impact: ImpactAssessmentSchema.parse({ id: 'imp-cr-test', tripId, assessedAt: AT, severity: 'MEDIUM' }),
    capabilityRegistry: [],
    priorToolResults: offers.length > 0 ? [{ toolRequestId: 'tool-1', summary: 'flight.search evidence', data: { offers } }] : [],
    priorActionResults: [],
  };
  return planner.plan(input);
}

const offer = (offerId: string, price: number, departure: string, arrival: string): FlightOffer => ({
  offerId,
  segments: [
    {
      origin: { system: 'airport-code', value: 'HOM' },
      destination: { system: 'airport-code', value: 'EVT' },
      departure,
      arrival,
    },
  ],
  totalPrice: { amount: price, currency: 'SGD' },
  availability: 'AVAILABLE',
});

test('rev2-r3: A1 arriveBy + departAfter emits one search per requested dimension', async () => {
  const harness = createHarness();
  const { tripId } = await setupTwoLegTrip(harness);
  const signal = changeSignal(tripId, {
    arriveBy: '2026-09-05T18:00:00+08:00',
    departAfter: '2026-09-12T00:00:00+08:00',
  });

  const output = await planWindowShift(harness, tripId, signal, []);
  assert.equal(output.toolRequests.length, 2, 'both dimensions must produce a search');
  const routes = output.toolRequests.map((request) => {
    const parameters = request.parameters as { origin: { value: string }; destination: { value: string }; departureDate: string };
    return `${parameters.origin.value}->${parameters.destination.value}@${parameters.departureDate}`;
  });
  assert.ok(routes.includes('HOM->EVT@2026-09-05'), 'arriveBy searches the inbound route on the requested day');
  assert.ok(routes.includes('EVT->HOM@2026-09-12'), 'departAfter searches the outbound-from-event route on the requested day');
  assert.equal(output.strategies.length, 0, 'no strategies before search evidence exists');
});

test('rev2-r3: departAfter alone rebooks the RETURN leg (direction from place evidence, not array order)', async () => {
  const harness = createHarness();
  const { tripId } = await setupTwoLegTrip(harness);
  const signal = changeSignal(tripId, { departAfter: '2026-09-12T00:00:00+08:00' });
  const replacement = offer('offer-later-return', 250, '2026-09-12T18:00:00+08:00', '2026-09-12T23:30:00+08:00');

  const output = await planWindowShift(harness, tripId, signal, [replacement]);
  assert.ok(output.strategies.length >= 1, 'evidence yields replacement strategies');
  for (const strategy of output.strategies) {
    const upsert = strategy.candidateOperations[0];
    assert.ok(upsert && upsert.op === 'UPSERT_ENTITY');
    if (upsert && upsert.op === 'UPSERT_ENTITY') {
      assert.equal(
        (upsert.data as { id: string }).id,
        `el-${tripId}-ret`,
        'departAfter must target the leg DEPARTING the event place, never the outbound leg',
      );
    }
  }
});

test('rev2-r3: arriveBy alone rebooks the leg ARRIVING at the event place; both dimensions cover both legs', async () => {
  const harness = createHarness();
  const { tripId } = await setupTwoLegTrip(harness);
  const earlier = offer('offer-earlier-arrival', 180, '2026-09-04T20:00:00+08:00', '2026-09-04T21:30:00+08:00');

  const arriveOnly = await planWindowShift(harness, tripId, changeSignal(tripId, { arriveBy: '2026-09-04T23:00:00+08:00' }), [earlier]);
  assert.ok(arriveOnly.strategies.length >= 1);
  for (const strategy of arriveOnly.strategies) {
    const upsert = strategy.candidateOperations[0];
    if (upsert && upsert.op === 'UPSERT_ENTITY') {
      assert.equal((upsert.data as { id: string }).id, `el-${tripId}-out`, 'arriveBy targets the leg arriving at the event place');
    }
  }

  const both = await planWindowShift(
    harness,
    tripId,
    changeSignal(tripId, { arriveBy: '2026-09-04T23:00:00+08:00', departAfter: '2026-09-12T00:00:00+08:00' }),
    [earlier],
  );
  const touchedLegs = new Set(
    both.strategies
      .map((strategy) => strategy.candidateOperations[0])
      .filter((op) => op && op.op === 'UPSERT_ENTITY')
      .map((op) => (op!.op === 'UPSERT_ENTITY' ? ((op!.data as { id: string }).id) : '')),
  );
  assert.ok(touchedLegs.has(`el-${tripId}-out`), 'A1 with evidence covers the inbound leg');
  assert.ok(touchedLegs.has(`el-${tripId}-ret`), 'A1 with evidence covers the return leg');
});

test('rev2-r3: unactionable dimensions (preferDirect, stay proximity, objective effects) produce explicit uncertainty, never silence', async () => {
  const harness = createHarness();
  const { tripId } = await setupTwoLegTrip(harness);

  const a2 = await planWindowShift(
    harness,
    tripId,
    changeSignal(tripId, { transport: { preferDirect: true } }),
    [],
  );
  assert.equal(a2.strategies.length, 0, 'preferDirect ranking is not supported yet — no fabricated strategies');
  assert.ok(
    a2.uncertainties.some((uncertainty) => /direct/i.test(uncertainty.statement)),
    'preferDirect must surface as explicit uncertainty',
  );

  const a3 = await planWindowShift(
    harness,
    tripId,
    changeSignal(tripId, { preferredStayProximityRef: { entityType: 'PLACE', id: EVENT_PLACE } }),
    [],
  );
  assert.equal(a3.strategies.length, 0);
  assert.ok(
    a3.uncertainties.some((uncertainty) => /stay|proximity/i.test(uncertainty.statement)),
    'stay proximity must surface as explicit uncertainty',
  );

  const objective = await planWindowShift(
    harness,
    tripId,
    changeSignal(tripId, { objectiveEffects: [{ objectiveId: `obj-${tripId}-1`, effect: 'WAIVE' }] }),
    [],
  );
  assert.equal(objective.strategies.length, 0);
  assert.ok(
    objective.uncertainties.some((uncertainty) => /objective/i.test(uncertainty.statement)),
    'objective effects must surface as explicit uncertainty (authority owns waivers)',
  );
});

test('rev2-r3: resolveChangeRequest forwards the complete declarative ResolutionTarget into the signal payload', async () => {
  const harness = createHarness();
  const { tripId } = await setupTwoLegTrip(harness);

  const request: ChangeRequest = {
    id: 'cr-full-target',
    tripId,
    travellerId: 'trv-evt-r3-draft-1',
    sourceId: 'src-traveller-web',
    authority: 'ASSERTED',
    issuedAt: '2026-09-05T10:00:00+00:00',
    intentKind: 'CHANGE_TRANSPORT_SCHEDULE',
    urgency: 'SOFT_PREFERENCE',
    utterance: 'direct flight if possible, and closer to the venue',
    target: {
      arriveBy: '2026-09-05T18:00:00+08:00',
      transport: { preferDirect: true },
      preferredStayProximityRef: { entityType: 'PLACE', id: EVENT_PLACE },
      objectiveEffects: [],
    },
  };
  const outcome = await resolveChangeRequest(
    { trips: harness.trips, entities: harness.entities, signals: harness.signals, cases: harness.cases, audit: harness.audit },
    { request, at: '2026-09-05T10:05:00+00:00' },
  );
  assert.equal(outcome.accepted, true, JSON.stringify(outcome.issues));

  const signals = await harness.signals.listSignalsForTrip(tripId);
  const carrier = signals.find((signal) => signal.kind === 'TRAVELLER_INPUT');
  assert.ok(carrier, 'the change request normalizes into a TRAVELLER_INPUT signal');
  const target = carrier!.payload['target'] as Record<string, unknown> | undefined;
  assert.ok(target, 'the signal payload carries the complete ResolutionTarget');
  assert.equal(target!['arriveBy'], '2026-09-05T18:00:00+08:00');
  assert.deepEqual(target!['transport'], { preferDirect: true });
  assert.deepEqual(target!['preferredStayProximityRef'], { entityType: 'PLACE', id: EVENT_PLACE });
  // Declarative only: no element ids, booking ids or provider operations.
  assert.equal(carrier!.payload['arriveBy'], undefined, 'no ad-hoc partial forwarding beside the full target');
});

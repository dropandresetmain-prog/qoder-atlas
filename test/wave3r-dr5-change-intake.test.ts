/**
 * DR-5 — Traveller natural-language change intake tests.
 *
 * Proves:
 * 1. At least 4 unseen NL phrasings (one per family) produce schema-valid
 *    ChangeRequest proposals with correct resolution targets.
 * 2. An ambiguous phrasing fails closed with clarification (no fabricated
 *    fields).
 * 3. NL-derived proposals entering the resolver behave identically to a
 *    hand-written structured ChangeRequest.
 * 4. REPLAY/deterministic mode requires no credentials.
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
import { ProgrammeService } from '../src/app/programme.ts';
import { resolveChangeRequest } from '../src/app/changeRequest.ts';
import {
  interpretChangeRequest,
  proposeThenResolve,
  type ChangeIntakeDeps,
} from '../src/app/changeIntake.ts';
import { ChangeRequestSchema, type ChangeRequest } from '../src/contracts/changeRequest.ts';
import type { ProgrammeImportDraft } from '../src/contracts/programmeIntake.ts';
import type { AnchorEvent, Organisation, Place } from '../src/domain/entities.ts';
import type { TransportLeg } from '../src/domain/elements.ts';

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
}

function createHarness(): Harness {
  const db = openDatabase(':memory:');
  const trips = new SqliteTripRepository(db);
  const entities = new SqliteEntityStore(db);
  const sources = new SqliteSourceRepository(db);
  const signals = new SqliteSignalRepository(db);
  const cases = new SqliteCaseRepository(db);
  const audit = new SqliteAuditRepository(db);
  const mutations = new SqlMutationService({ db, trips, entities });
  const service = new ProgrammeService({ mutations, entities, trips, sources, audit });
  return { service, trips, entities, sources, signals, cases, audit, mutations };
}

async function setupTrip(harness: Harness): Promise<{ tripId: string; travellerId: string }> {
  const eventId = 'evt-dr5';
  const organisation: Organisation = {
    id: `org-${eventId}`,
    name: 'Synthetic Programme Organiser',
    roles: ['EVENT_ORGANISER', 'PAYER'],
  };
  const venue: Place = {
    id: 'plc-dr5-venue',
    name: 'Synthetic Venue',
    kind: 'VENUE',
    timezone: 'Asia/Singapore',
    externalRefs: [],
  };
  const airport: Place = {
    id: 'plc-dr5-airport',
    name: 'Synthetic Airport',
    kind: 'AIRPORT',
    timezone: 'Asia/Singapore',
    externalRefs: [{ system: 'airport-code', value: 'SYN' }],
  };
  const anchorEvent: AnchorEvent = {
    id: eventId,
    name: 'Synthetic Programme Event',
    kind: 'CONFERENCE',
    placeId: 'plc-dr5-venue',
    window: { startsAt: '2026-09-07T00:00:00+08:00', endsAt: '2026-09-11T23:59:00+08:00' },
    organiserOrganisationId: organisation.id,
    commitments: [
      {
        id: `cmt-${eventId}-opening`,
        anchorEventId: eventId,
        title: 'Opening Session',
        kind: 'SESSION',
        placeId: 'plc-dr5-venue',
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
    places: [venue, airport],
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
        homeLocationText: 'SYN',
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
  const travellerId = `trv-${eventId}-draft-1`;
  return { tripId, travellerId };
}

// ---------------------------------------------------------------------------
// Test 1: Four unseen NL phrasings produce schema-valid proposals
// ---------------------------------------------------------------------------

test('dr5: four unseen NL phrasings produce schema-valid ChangeRequest proposals', async () => {
  const harness = createHarness();
  const { tripId, travellerId } = await setupTrip(harness);
  const deps: ChangeIntakeDeps = {};

  // Family 1: Pre-booking flight preference (direct flight).
  const directFlight = await interpretChangeRequest(deps, {
    travellerId,
    tripId,
    text: 'I prefer a direct flight if possible',
    at: AT,
  });
  assert.equal(directFlight.ok, true, 'direct flight preference should succeed');
  assert.ok(directFlight.proposal, 'proposal must exist');
  const validated1 = ChangeRequestSchema.safeParse(directFlight.proposal);
  assert.equal(validated1.success, true, 'proposal must validate against ChangeRequestSchema');
  assert.equal(validated1.data.intentKind, 'CHANGE_TRANSPORT_SCHEDULE');
  assert.equal(validated1.data.target.transport?.preferDirect, true);
  assert.equal(directFlight.provenance, 'DETERMINISTIC');

  // Family 2: Post-booking flight change (specific departure time).
  const departAfter = await interpretChangeRequest(deps, {
    travellerId,
    tripId,
    text: 'Please depart after 2026-09-08T10:00:00+08:00',
    at: AT,
  });
  assert.equal(departAfter.ok, true, 'depart after should succeed');
  assert.ok(departAfter.proposal, 'proposal must exist');
  const validated2 = ChangeRequestSchema.safeParse(departAfter.proposal);
  assert.equal(validated2.success, true, 'proposal must validate against ChangeRequestSchema');
  assert.equal(validated2.data.intentKind, 'CHANGE_TRANSPORT_SCHEDULE');
  assert.equal(validated2.data.target.transport?.earliestDeparture, '2026-09-08T10:00:00+08:00');
  assert.equal(departAfter.provenance, 'DETERMINISTIC');

  // Family 3: Hotel extension (extend stay until specific date).
  const extendStay = await interpretChangeRequest(deps, {
    travellerId,
    tripId,
    text: 'Extend my stay until 2026-09-12T23:59:00+08:00',
    at: AT,
  });
  assert.equal(extendStay.ok, true, 'extend stay should succeed');
  assert.ok(extendStay.proposal, 'proposal must exist');
  const validated3 = ChangeRequestSchema.safeParse(extendStay.proposal);
  assert.equal(validated3.success, true, 'proposal must validate against ChangeRequestSchema');
  assert.equal(validated3.data.intentKind, 'CHANGE_STAY');
  assert.equal(validated3.data.target.departAfter, '2026-09-12T23:59:00+08:00');
  assert.equal(extendStay.provenance, 'DETERMINISTIC');

  // Family 4: Add-on request (closer hotel to venue).
  const closerHotel = await interpretChangeRequest(deps, {
    travellerId,
    tripId,
    text: 'I need a hotel closer to place plc-dr5-venue',
    at: AT,
  });
  assert.equal(closerHotel.ok, true, 'closer hotel should succeed');
  assert.ok(closerHotel.proposal, 'proposal must exist');
  const validated4 = ChangeRequestSchema.safeParse(closerHotel.proposal);
  assert.equal(validated4.success, true, 'proposal must validate against ChangeRequestSchema');
  assert.equal(validated4.data.intentKind, 'CHANGE_STAY');
  assert.deepEqual(validated4.data.target.preferredStayProximityRef, {
    entityType: 'PLACE',
    id: 'plc-dr5-venue',
  });
  assert.equal(closerHotel.provenance, 'DETERMINISTIC');
});

// ---------------------------------------------------------------------------
// Test 2: Ambiguous phrasing fails closed with clarification
// ---------------------------------------------------------------------------

test('dr5: ambiguous phrasing fails closed with clarification (no fabricated fields)', async () => {
  const harness = createHarness();
  const { tripId, travellerId } = await setupTrip(harness);
  const deps: ChangeIntakeDeps = {};

  const ambiguous = await interpretChangeRequest(deps, {
    travellerId,
    tripId,
    text: 'I want to change something about my trip',
    at: AT,
  });
  assert.equal(ambiguous.ok, false, 'ambiguous text should fail');
  assert.equal(ambiguous.proposal, undefined, 'no proposal when ambiguous');
  assert.ok(ambiguous.uncertainties, 'uncertainties must exist');
  assert.ok(ambiguous.uncertainties!.length > 0, 'at least one uncertainty');
  assert.ok(ambiguous.clarificationNeeded, 'clarification request must exist');
  assert.equal(ambiguous.provenance, 'DETERMINISTIC');
  // No fabricated fields: the proposal is undefined, so nothing was invented.
});

// ---------------------------------------------------------------------------
// Test 3: NL-derived proposals behave identically to hand-written structured
// ---------------------------------------------------------------------------

test('dr5: NL-derived proposals entering the resolver behave identically to hand-written structured ChangeRequest', async () => {
  const harness = createHarness();
  const { tripId, travellerId } = await setupTrip(harness);
  const deps: ChangeIntakeDeps = {};

  // NL-derived proposal.
  const nlResult = await interpretChangeRequest(deps, {
    travellerId,
    tripId,
    text: 'I prefer a direct flight',
    at: AT,
  });
  assert.equal(nlResult.ok, true);
  assert.ok(nlResult.proposal);

  // Hand-written structured ChangeRequest with the same intent.
  const structured: ChangeRequest = {
    id: 'cr-structured',
    tripId,
    travellerId,
    sourceId: 'src-nl-intake',
    authority: 'INFERRED',
    issuedAt: AT,
    intentKind: 'CHANGE_TRANSPORT_SCHEDULE',
    urgency: 'SOFT_PREFERENCE',
    utterance: 'I prefer a direct flight',
    target: {
      transport: { preferDirect: true },
      objectiveEffects: [],
    },
  };

  // Resolve both through the same resolver.
  const nlResolve = await resolveChangeRequest(
    { trips: harness.trips, entities: harness.entities, signals: harness.signals, cases: harness.cases, audit: harness.audit },
    { request: nlResult.proposal!, at: '2026-09-05T10:00:00+00:00' },
  );
  const structuredResolve = await resolveChangeRequest(
    { trips: harness.trips, entities: harness.entities, signals: harness.signals, cases: harness.cases, audit: harness.audit },
    { request: structured, at: '2026-09-05T10:00:00+00:00' },
  );

  // Both should succeed and produce the same intentKind and urgency.
  assert.equal(nlResolve.accepted, true);
  assert.equal(structuredResolve.accepted, true);
  assert.equal(nlResolve.intentKind, structuredResolve.intentKind);
  assert.equal(nlResolve.urgency, structuredResolve.urgency);
  // Both should record the same implication about direct preference.
  assert.ok(nlResolve.implications.some((line) => /prefer direct/.test(line)));
  assert.ok(structuredResolve.implications.some((line) => /prefer direct/.test(line)));
});

// ---------------------------------------------------------------------------
// Test 4: REPLAY/deterministic mode requires no credentials
// ---------------------------------------------------------------------------

test('dr5: REPLAY/deterministic mode requires no credentials', async () => {
  const harness = createHarness();
  const { tripId, travellerId } = await setupTrip(harness);
  const deps: ChangeIntakeDeps = {}; // No modelClient = deterministic path.

  const result = await interpretChangeRequest(deps, {
    travellerId,
    tripId,
    text: 'I prefer a direct flight',
    at: AT,
  });
  assert.equal(result.ok, true);
  assert.equal(result.provenance, 'DETERMINISTIC');
  assert.ok(result.proposal);
  // No credentials were required; the deterministic path worked without them.
});

// ---------------------------------------------------------------------------
// Test 5: proposeThenResolve helper integrates intake + resolver
// ---------------------------------------------------------------------------

test('dr5: proposeThenResolve helper integrates intake and resolver', async () => {
  const harness = createHarness();
  const { tripId, travellerId } = await setupTrip(harness);
  const deps: ChangeIntakeDeps & {
    trips: SqliteTripRepository;
    entities: SqliteEntityStore;
    signals: SqliteSignalRepository;
    cases: SqliteCaseRepository;
    audit: SqliteAuditRepository;
  } = {
    trips: harness.trips,
    entities: harness.entities,
    signals: harness.signals,
    cases: harness.cases,
    audit: harness.audit,
  };

  const { intake, resolution } = await proposeThenResolve(deps, {
    travellerId,
    tripId,
    text: 'Extend my stay until 2026-09-12T23:59:00+08:00',
    at: AT,
  });
  assert.equal(intake.ok, true);
  assert.ok(intake.proposal);
  assert.ok(resolution);
  assert.equal(resolution.accepted, true);
  assert.equal(resolution.intentKind, 'CHANGE_STAY');
  // The resolver should have processed the departAfter target.
  assert.ok(resolution.implications.length > 0 || resolution.uncertainties.length > 0,
    'resolver should have produced implications or uncertainties for the stay extension');
});

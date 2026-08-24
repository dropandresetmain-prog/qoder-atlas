/**
 * DR-6 — Event-change preview + multi-traveller fan-out tests.
 *
 * Builds a synthetic programme of 8 travellers across two commitments, then:
 * 1. previewEventChange computes affected vs unaffected correctly
 * 2. preview leaves persisted state byte-identical (no mutations)
 * 3. commitEventChange mutates and opens cases ONLY for affected linked trips
 * 4. An alternate commitment change flows through the same code
 * 5. Unaffected travellers' trips carry no signal/case
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';

import { AppConfigSchema } from '../src/config/config.ts';
import { createAppServer } from '../src/server/http.ts';
import { composeAppRuntime } from '../src/app/compose.ts';
import {
  SqliteSignalRepository,
  SqliteCaseRepository,
  SqliteTripRepository,
  SqliteAuditRepository,
} from '../src/persistence/repositories.ts';
import { SqliteEntityStore } from '../src/persistence/entityStore.ts';
import { SqlMutationService } from '../src/engine/mutation.ts';
import { previewEventChange, commitEventChange } from '../src/app/eventChangePreview.ts';

const AT = '2026-09-01T00:00:00+00:00';
const EVENT_ID = 'evt-dr6';
const COMMITMENT_OPENING = `cmt-${EVENT_ID}-opening`;
const COMMITMENT_CLOSING = `cmt-${EVENT_ID}-closing`;

const runtimeConfig = AppConfigSchema.parse({
  environment: 'local',
  adapterMode: 'REPLAY',
  sqlitePath: ':memory:',
  fixturesDir: resolve('fixtures'),
  providers: { atlas: { env: 'sandbox' }, modelStudio: {}, googleRoutes: {} },
});

async function postJson(base: string, path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function makeRepos(composed: Awaited<ReturnType<typeof composeAppRuntime>>) {
  const trips = new SqliteTripRepository(composed.db);
  const entities = new SqliteEntityStore(composed.db);
  const signals = new SqliteSignalRepository(composed.db);
  const cases = new SqliteCaseRepository(composed.db);
  const audit = new SqliteAuditRepository(composed.db);
  const mutations = new SqlMutationService({ db: composed.db, trips, entities });
  return { trips, entities, signals, cases, audit, mutations };
}

async function setupProgramme(
  base: string,
  eventId: string,
  commitments: Array<{ id: string; title: string; startsAt: string; endsAt?: string }>,
  travellers: Array<{ draftId: string; displayName: string; email: string; commitmentIds: string[] }>,
) {
  const contextBody = {
    at: AT,
    sourceId: `src-${eventId}`,
    organisation: { id: `org-${eventId}`, name: `DR-6 ${eventId}`, roles: ['EVENT_ORGANISER', 'PAYER'] },
    anchorEvent: {
      id: eventId,
      name: `DR-6 Event ${eventId}`,
      kind: 'CONFERENCE',
      placeId: `plc-${eventId}-venue`,
      window: { startsAt: '2026-09-07T00:00:00+08:00', endsAt: '2026-09-11T23:59:00+08:00' },
      organiserOrganisationId: `org-${eventId}`,
      commitments: commitments.map((c) => ({
        id: c.id,
        anchorEventId: eventId,
        title: c.title,
        kind: 'SESSION',
        placeId: `plc-${eventId}-venue`,
        startsAt: { value: c.startsAt, sourceId: `src-${eventId}`, authority: 'AUTHORITATIVE', observedAt: AT },
        ...(c.endsAt ? { endsAt: { value: c.endsAt, sourceId: `src-${eventId}`, authority: 'AUTHORITATIVE', observedAt: AT } } : {}),
        sourceId: `src-${eventId}`,
      })),
      sourceIds: [],
    },
    places: [
      { id: `plc-${eventId}-venue`, name: `DR-6 Venue ${eventId}`, kind: 'VENUE', timezone: 'Asia/Singapore', externalRefs: [] },
    ],
    ruleSets: [],
  };
  const context = await postJson(base, '/api/programme/context', contextBody);
  assert.equal(context.status, 200);

  const bulk = await postJson(base, '/api/programme/import', {
    importDraft: {
      id: `import-${eventId}`,
      anchorEventId: eventId,
      channel: 'BULK_IMPORT',
      sourceId: `src-${eventId}`,
      receivedAt: AT,
      travellers: travellers.map((t) => ({
        draftId: t.draftId,
        displayName: t.displayName,
        identity: { email: t.email },
        homeLocationText: 'Somewhere',
        nationalityCodes: ['SG'],
        accessibilityStatements: [],
        notes: [],
        anchorCommitmentIds: t.commitmentIds,
      })),
      unresolvedStatements: [],
    },
    at: AT,
  });
  assert.equal(bulk.status, 200);
  assert.equal(bulk.body['promotedCount'], travellers.length);
  return bulk;
}

// ===========================================================================
// Test 1: preview computes affected vs unaffected correctly
// ===========================================================================
test('DR-6: preview computes affected vs unaffected correctly on multi-traveller programme', async () => {
  const composed = await composeAppRuntime(runtimeConfig);
  const server = createAppServer(runtimeConfig, composed.endpoints);
  await new Promise<void>((resolvePromise) => server.listen(0, resolvePromise));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;

  try {
    await setupProgramme(
      base,
      EVENT_ID,
      [
        { id: COMMITMENT_OPENING, title: 'Opening Session', startsAt: '2026-09-08T15:00:00+08:00', endsAt: '2026-09-08T17:00:00+08:00' },
        { id: COMMITMENT_CLOSING, title: 'Closing Session', startsAt: '2026-09-11T09:00:00+08:00' },
      ],
      [
        { draftId: 'draft-1', displayName: 'Traveller 01', email: 't1@example.test', commitmentIds: [COMMITMENT_OPENING] },
        { draftId: 'draft-2', displayName: 'Traveller 02', email: 't2@example.test', commitmentIds: [COMMITMENT_OPENING] },
        { draftId: 'draft-3', displayName: 'Traveller 03', email: 't3@example.test', commitmentIds: [COMMITMENT_OPENING] },
        { draftId: 'draft-4', displayName: 'Traveller 04', email: 't4@example.test', commitmentIds: [COMMITMENT_OPENING] },
        { draftId: 'draft-5', displayName: 'Traveller 05', email: 't5@example.test', commitmentIds: [COMMITMENT_OPENING] },
        { draftId: 'draft-6', displayName: 'Traveller 06', email: 't6@example.test', commitmentIds: [COMMITMENT_CLOSING] },
        { draftId: 'draft-7', displayName: 'Traveller 07', email: 't7@example.test', commitmentIds: [COMMITMENT_CLOSING] },
        { draftId: 'draft-8', displayName: 'Traveller 08', email: 't8@example.test', commitmentIds: [COMMITMENT_CLOSING] },
      ],
    );

    const repos = makeRepos(composed);

    // --- Preview: reschedule opening session. --------------------------------
    const preview = await previewEventChange(
      { entities: repos.entities, trips: repos.trips },
      {
        anchorEventId: EVENT_ID,
        commitmentId: COMMITMENT_OPENING,
        changeKind: 'RESCHEDULED',
        newStartsAt: '2026-09-08T10:00:00+08:00',
        newEndsAt: '2026-09-08T12:00:00+08:00',
        at: AT,
      },
    );

    // 8 total travellers
    assert.equal(preview.totalTravellers, 8);
    // 5 affected (linked to opening)
    assert.equal(preview.affected.length, 5, 'preview identifies 5 affected trips');
    // 3 unaffected (linked to closing)
    assert.equal(preview.unaffected.length, 3, 'preview identifies 3 unaffected trips');

    // Each affected trip has reasons and traveller ids
    for (const affected of preview.affected) {
      assert.ok(affected.reasons.length > 0, `affected trip ${affected.tripId} has reasons`);
      assert.ok(affected.travellerIds.length > 0, `affected trip ${affected.tripId} has traveller ids`);
    }

    // Each unaffected trip has reasons
    for (const unaffected of preview.unaffected) {
      assert.ok(unaffected.reasons.length > 0, `unaffected trip ${unaffected.tripId} has reasons`);
    }

  } finally {
    await new Promise<void>((resolvePromise, reject) =>
      server.close((error) => (error ? reject(error) : resolvePromise())),
    );
    composed.db.close();
  }
});

// ===========================================================================
// Test 2: preview leaves persisted state byte-identical
// ===========================================================================
test('DR-6: preview leaves persisted state byte-identical', async () => {
  const composed = await composeAppRuntime(runtimeConfig);
  const server = createAppServer(runtimeConfig, composed.endpoints);
  await new Promise<void>((resolvePromise) => server.listen(0, resolvePromise));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;

  try {
    const previewEventId = `${EVENT_ID}-preview`;
    const previewCommitment = `cmt-${previewEventId}-opening`;

    await setupProgramme(
      base,
      previewEventId,
      [
        { id: previewCommitment, title: 'Opening Session', startsAt: '2026-09-08T15:00:00+08:00', endsAt: '2026-09-08T17:00:00+08:00' },
      ],
      [
        { draftId: 'draft-p1', displayName: 'Preview Traveller 1', email: 'tp1@example.test', commitmentIds: [previewCommitment] },
        { draftId: 'draft-p2', displayName: 'Preview Traveller 2', email: 'tp2@example.test', commitmentIds: [previewCommitment] },
      ],
    );

    const repos = makeRepos(composed);

    // --- Capture state BEFORE preview. -------------------------------------
    const tripId1 = `trip-trv-${previewEventId}-draft-p1`;
    const tripId2 = `trip-trv-${previewEventId}-draft-p2`;

    const signalsBefore1 = await repos.signals.listSignalsForTrip(tripId1);
    const signalsBefore2 = await repos.signals.listSignalsForTrip(tripId2);
    const casesBefore1 = await repos.cases.listCasesForTrip(tripId1);
    const casesBefore2 = await repos.cases.listCasesForTrip(tripId2);
    const tripBefore1 = await repos.trips.getTrip(tripId1);
    const tripBefore2 = await repos.trips.getTrip(tripId2);

    // Capture full DB snapshot for byte-identical comparison
    const allEntitiesBefore = composed.db.prepare('SELECT * FROM entities ORDER BY id').all();
    const allSignalsBefore = composed.db.prepare('SELECT * FROM signals ORDER BY id').all();
    const allCasesBefore = composed.db.prepare('SELECT * FROM cases ORDER BY id').all();

    // --- Run preview. -------------------------------------------------------
    const preview = await previewEventChange(
      { entities: repos.entities, trips: repos.trips },
      {
        anchorEventId: previewEventId,
        commitmentId: previewCommitment,
        changeKind: 'RESCHEDULED',
        newStartsAt: '2026-09-08T10:00:00+08:00',
        newEndsAt: '2026-09-08T12:00:00+08:00',
        at: AT,
      },
    );

    // Preview should still identify affected trips
    assert.ok(preview.affected.length > 0, 'preview found affected trips');

    // --- Capture state AFTER preview. --------------------------------------
    const signalsAfter1 = await repos.signals.listSignalsForTrip(tripId1);
    const signalsAfter2 = await repos.signals.listSignalsForTrip(tripId2);
    const casesAfter1 = await repos.cases.listCasesForTrip(tripId1);
    const casesAfter2 = await repos.cases.listCasesForTrip(tripId2);
    const tripAfter1 = await repos.trips.getTrip(tripId1);
    const tripAfter2 = await repos.trips.getTrip(tripId2);

    const allEntitiesAfter = composed.db.prepare('SELECT * FROM entities ORDER BY id').all();
    const allSignalsAfter = composed.db.prepare('SELECT * FROM signals ORDER BY id').all();
    const allCasesAfter = composed.db.prepare('SELECT * FROM cases ORDER BY id').all();

    // --- Assert: state is byte-identical. ----------------------------------
    assert.deepEqual(signalsBefore1, signalsAfter1, 'preview did not create signals for trip 1');
    assert.deepEqual(signalsBefore2, signalsAfter2, 'preview did not create signals for trip 2');
    assert.deepEqual(casesBefore1, casesAfter1, 'preview did not open cases for trip 1');
    assert.deepEqual(casesBefore2, casesAfter2, 'preview did not open cases for trip 2');
    assert.deepEqual(tripBefore1, tripAfter1, 'preview did not mutate trip 1');
    assert.deepEqual(tripBefore2, tripAfter2, 'preview did not mutate trip 2');

    // Full DB byte-identical comparison
    assert.deepEqual(allEntitiesBefore, allEntitiesAfter, 'entities table byte-identical');
    assert.deepEqual(allSignalsBefore, allSignalsAfter, 'signals table byte-identical');
    assert.deepEqual(allCasesBefore, allCasesAfter, 'cases table byte-identical');

  } finally {
    await new Promise<void>((resolvePromise, reject) =>
      server.close((error) => (error ? reject(error) : resolvePromise())),
    );
    composed.db.close();
  }
});

// ===========================================================================
// Test 3: commitEventChange mutates and opens cases ONLY for affected linked trips
// ===========================================================================
test('DR-6: commitEventChange mutates and opens cases ONLY for affected linked trips', async () => {
  const composed = await composeAppRuntime(runtimeConfig);
  const server = createAppServer(runtimeConfig, composed.endpoints);
  await new Promise<void>((resolvePromise) => server.listen(0, resolvePromise));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;

  try {
    const commitEventId = `${EVENT_ID}-commit`;
    const commitOpening = `cmt-${commitEventId}-opening`;
    const commitClosing = `cmt-${commitEventId}-closing`;

    await setupProgramme(
      base,
      commitEventId,
      [
        { id: commitOpening, title: 'Opening Session', startsAt: '2026-09-08T15:00:00+08:00', endsAt: '2026-09-08T17:00:00+08:00' },
        { id: commitClosing, title: 'Closing Session', startsAt: '2026-09-11T09:00:00+08:00' },
      ],
      [
        { draftId: 'draft-c1', displayName: 'Commit Traveller 1', email: 'tc1@example.test', commitmentIds: [commitOpening] },
        { draftId: 'draft-c2', displayName: 'Commit Traveller 2', email: 'tc2@example.test', commitmentIds: [commitOpening] },
        { draftId: 'draft-c3', displayName: 'Commit Traveller 3', email: 'tc3@example.test', commitmentIds: [commitClosing] },
      ],
    );

    const repos = makeRepos(composed);

    // --- Commit: reschedule opening session. --------------------------------
    const outcome = await commitEventChange(
      {
        mutations: repos.mutations,
        entities: repos.entities,
        trips: repos.trips,
        signals: repos.signals,
        cases: repos.cases,
        audit: repos.audit,
      },
      {
        anchorEventId: commitEventId,
        commitmentId: commitOpening,
        changeKind: 'RESCHEDULED',
        newStartsAt: '2026-09-08T10:00:00+08:00',
        newEndsAt: '2026-09-08T12:00:00+08:00',
        at: AT,
      },
    );

    assert.equal(outcome.accepted, true, 'commit accepted');
    assert.equal(outcome.linkedTripCount, 2, '2 trips linked to opening');
    assert.equal(outcome.unlinkedTripCount, 1, '1 trip unlinked (closing)');
    assert.equal(outcome.processed.length, 2, '2 signals processed');

    // --- Verify: only linked trips have signals/cases. --------------------
    for (const processed of outcome.processed) {
      const tripSignals = await repos.signals.listSignalsForTrip(processed.tripId);
      const fanoutSignals = tripSignals.filter((s) => s.kind === 'ANCHOR_COMMITMENT_CHANGE');
      assert.ok(fanoutSignals.length > 0, `linked trip ${processed.tripId} has fan-out signal`);

      const tripCases = await repos.cases.listCasesForTrip(processed.tripId);
      assert.ok(tripCases.length > 0, `linked trip ${processed.tripId} has recovery case`);
    }

    // --- Verify: unlinked trip has NO signals/cases. ----------------------
    const unlinkedTripId = `trip-trv-${commitEventId}-draft-c3`;
    const unlinkedSignals = await repos.signals.listSignalsForTrip(unlinkedTripId);
    const unlinkedFanout = unlinkedSignals.filter((s) => s.kind === 'ANCHOR_COMMITMENT_CHANGE');
    assert.equal(unlinkedFanout.length, 0, 'unlinked trip has no fan-out signal');

    const unlinkedCases = await repos.cases.listCasesForTrip(unlinkedTripId);
    assert.equal(unlinkedCases.length, 0, 'unlinked trip has no case');

  } finally {
    await new Promise<void>((resolvePromise, reject) =>
      server.close((error) => (error ? reject(error) : resolvePromise())),
    );
    composed.db.close();
  }
});

// ===========================================================================
// Test 4: alternate commitment change flows through same code
// ===========================================================================
test('DR-6: alternate commitment change (RELOCATED) flows through same code', async () => {
  const composed = await composeAppRuntime(runtimeConfig);
  const server = createAppServer(runtimeConfig, composed.endpoints);
  await new Promise<void>((resolvePromise) => server.listen(0, resolvePromise));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;

  try {
    const altEventId = `${EVENT_ID}-alt`;
    const altCommitment = `cmt-${altEventId}-session`;
    const altNewVenue = `plc-${altEventId}-new-venue`;

    await setupProgramme(
      base,
      altEventId,
      [
        { id: altCommitment, title: 'Main Session', startsAt: '2026-09-08T15:00:00+08:00', endsAt: '2026-09-08T17:00:00+08:00' },
      ],
      [
        { draftId: 'draft-a1', displayName: 'Alt Traveller 1', email: 'ta1@example.test', commitmentIds: [altCommitment] },
        { draftId: 'draft-a2', displayName: 'Alt Traveller 2', email: 'ta2@example.test', commitmentIds: [altCommitment] },
      ],
    );

    const repos = makeRepos(composed);

    // --- Preview: RELOCATED change (different kind, different params). -----
    const preview = await previewEventChange(
      { entities: repos.entities, trips: repos.trips },
      {
        anchorEventId: altEventId,
        commitmentId: altCommitment,
        changeKind: 'RELOCATED',
        newPlaceId: altNewVenue,
        at: AT,
      },
    );

    assert.equal(preview.totalTravellers, 2);
    assert.equal(preview.affected.length, 2, 'both relocated trips are affected');
    assert.ok(preview.affected[0]!.reasons.some((r) => r.includes('relocated')), 'reason mentions relocation');

    // --- Commit: same RELOCATED change through the same code path. ---------
    const outcome = await commitEventChange(
      {
        mutations: repos.mutations,
        entities: repos.entities,
        trips: repos.trips,
        signals: repos.signals,
        cases: repos.cases,
        audit: repos.audit,
      },
      {
        anchorEventId: altEventId,
        commitmentId: altCommitment,
        changeKind: 'RELOCATED',
        newPlaceId: altNewVenue,
        at: AT,
      },
    );

    assert.equal(outcome.accepted, true, 'relocated commit accepted');
    assert.equal(outcome.linkedTripCount, 2, '2 trips linked');
    assert.equal(outcome.processed.length, 2, '2 signals processed for relocated trips');

  } finally {
    await new Promise<void>((resolvePromise, reject) =>
      server.close((error) => (error ? reject(error) : resolvePromise())),
    );
    composed.db.close();
  }
});

// ===========================================================================
// Test 5: unaffected travellers carry no signal/case after commit
// ===========================================================================
test('DR-6: unaffected travellers carry no signal/case after commit', async () => {
  const composed = await composeAppRuntime(runtimeConfig);
  const server = createAppServer(runtimeConfig, composed.endpoints);
  await new Promise<void>((resolvePromise) => server.listen(0, resolvePromise));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;

  try {
    const unaffEventId = `${EVENT_ID}-unaff`;
    const unaffOpening = `cmt-${unaffEventId}-opening`;
    const unaffClosing = `cmt-${unaffEventId}-closing`;

    await setupProgramme(
      base,
      unaffEventId,
      [
        { id: unaffOpening, title: 'Opening Session', startsAt: '2026-09-08T15:00:00+08:00', endsAt: '2026-09-08T17:00:00+08:00' },
        { id: unaffClosing, title: 'Closing Session', startsAt: '2026-09-11T09:00:00+08:00' },
      ],
      [
        { draftId: 'draft-u1', displayName: 'Unaffected Traveller 1', email: 'tu1@example.test', commitmentIds: [unaffOpening] },
        { draftId: 'draft-u2', displayName: 'Unaffected Traveller 2', email: 'tu2@example.test', commitmentIds: [unaffClosing] },
      ],
    );

    const repos = makeRepos(composed);

    // --- Commit: reschedule opening session. --------------------------------
    await commitEventChange(
      {
        mutations: repos.mutations,
        entities: repos.entities,
        trips: repos.trips,
        signals: repos.signals,
        cases: repos.cases,
        audit: repos.audit,
      },
      {
        anchorEventId: unaffEventId,
        commitmentId: unaffOpening,
        changeKind: 'RESCHEDULED',
        newStartsAt: '2026-09-08T10:00:00+08:00',
        newEndsAt: '2026-09-08T12:00:00+08:00',
        at: AT,
      },
    );

    // --- Verify: unaffected traveller (linked to closing) has NO signals/cases.
    const unaffectedTripId = `trip-trv-${unaffEventId}-draft-u2`;
    const unaffectedSignals = await repos.signals.listSignalsForTrip(unaffectedTripId);
    const unaffectedFanout = unaffectedSignals.filter((s) => s.kind === 'ANCHOR_COMMITMENT_CHANGE');
    assert.equal(unaffectedFanout.length, 0, 'unaffected trip has no fan-out signal');

    const unaffectedCases = await repos.cases.listCasesForTrip(unaffectedTripId);
    assert.equal(unaffectedCases.length, 0, 'unaffected trip has no case');

    // --- Verify: affected traveller (linked to opening) DOES have signals/cases.
    const affectedTripId = `trip-trv-${unaffEventId}-draft-u1`;
    const affectedSignals = await repos.signals.listSignalsForTrip(affectedTripId);
    const affectedFanout = affectedSignals.filter((s) => s.kind === 'ANCHOR_COMMITMENT_CHANGE');
    assert.ok(affectedFanout.length > 0, 'affected trip has fan-out signal');

    const affectedCases = await repos.cases.listCasesForTrip(affectedTripId);
    assert.ok(affectedCases.length > 0, 'affected trip has recovery case');

  } finally {
    await new Promise<void>((resolvePromise, reject) =>
      server.close((error) => (error ? reject(error) : resolvePromise())),
    );
    composed.db.close();
  }
});

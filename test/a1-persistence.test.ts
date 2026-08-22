/**
 * A1 evidence — T-PERSIST: repository round trips, version coherency,
 * process restart/reload, source content separation, audit queries.
 * All fixtures are generic; no scenario content.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDatabase, kvGet, SCHEMA_VERSION } from '../src/persistence/database.ts';
import {
  SqliteTripRepository,
  SqliteCaseRepository,
  SqliteSignalRepository,
  SqliteSourceRepository,
  SqliteAuditRepository,
  StaleVersionError,
} from '../src/persistence/repositories.ts';
import { SqliteEntityStore } from '../src/persistence/entityStore.ts';
import type { Trip } from '../src/domain/trip.ts';
import type { RecoveryCase } from '../src/operational/case.ts';
import type { TripSignal } from '../src/operational/signal.ts';
import type { SourceRecord } from '../src/domain/common.ts';
import type { RuleSet } from '../src/domain/rules.ts';

const NOW = '2026-08-20T10:00:00+00:00';

function makeTrip(version = 0): Trip {
  return {
    id: 'trip_persist_1',
    travellerIds: ['trv_p1'],
    elements: [],
    objectives: [],
    relations: [],
    governedByRuleSetIds: [],
    viability: 'UNKNOWN',
    version,
    updatedAt: NOW,
  };
}

function makeCase(version = 0): RecoveryCase {
  return {
    id: 'case_persist_1',
    tripId: 'trip_persist_1',
    status: 'DETECTED',
    openedAt: NOW,
    updatedAt: NOW,
    triggeredBySignalIds: [],
    affectedElementIds: [],
    failedConstraintIds: [],
    strategies: [],
    authorityDecisions: [],
    actionIntents: [],
    executionResults: [],
    version,
  };
}

test('persistence: trip round trip preserves full aggregate', async () => {
  const db = openDatabase(':memory:');
  const trips = new SqliteTripRepository(db);
  const trip = makeTrip();
  trip.elements.push({
    id: 'el_p1',
    tripId: trip.id,
    elementKind: 'TRANSPORT_LEG',
    importance: 'REQUIRED',
    flexibility: 'CHANGEABLE',
    reservationState: 'CONFIRMED',
    status: 'VALID',
    dependsOn: [],
    governedByRuleSetIds: [],
    data: {
      mode: 'FLIGHT',
      originPlaceId: 'plc_p_origin',
      destinationPlaceId: 'plc_p_dest',
      scheduledDeparture: {
        value: '2026-09-01T08:00:00+09:00',
        sourceId: 'src_p1',
        authority: 'CONNECTED',
        observedAt: NOW,
      },
    },
  });
  await trips.saveTrip(trip);
  const loaded = await trips.getTrip(trip.id);
  assert.deepEqual(loaded, trip);
  const summaries = await trips.listTrips();
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0]?.tripId, trip.id);
  assert.equal(await trips.getTrip('missing'), undefined);
});

test('persistence: saving a stale trip version is rejected', async () => {
  const db = openDatabase(':memory:');
  const trips = new SqliteTripRepository(db);
  await trips.saveTrip(makeTrip(3));
  await trips.saveTrip(makeTrip(3)); // idempotent equal-version save
  await assert.rejects(() => trips.saveTrip(makeTrip(2)), StaleVersionError);
  const loaded = await trips.getTrip('trip_persist_1');
  assert.equal(loaded?.version, 3);
});

test('persistence: schema-invalid trip cannot be saved', async () => {
  const db = openDatabase(':memory:');
  const trips = new SqliteTripRepository(db);
  const bad = { ...makeTrip(), travellerIds: [] } as unknown as Trip;
  await assert.rejects(() => trips.saveTrip(bad));
});

test('persistence: case round trip + open-case listing', async () => {
  const db = openDatabase(':memory:');
  const cases = new SqliteCaseRepository(db);
  await cases.saveCase(makeCase());
  const resolved = { ...makeCase(), id: 'case_persist_2', status: 'RESOLVED' as const };
  await cases.saveCase(resolved);
  assert.equal((await cases.listCasesForTrip('trip_persist_1')).length, 2);
  const open = await cases.listOpenCases();
  assert.equal(open.length, 1);
  assert.equal(open[0]?.id, 'case_persist_1');
});

test('persistence: signals are ordered chronologically across UTC offsets', async () => {
  const db = openDatabase(':memory:');
  const signals = new SqliteSignalRepository(db);
  const base: Omit<TripSignal, 'id' | 'occurredAt'> = {
    kind: 'OTHER',
    sourceId: 'src_p1',
    authority: 'CONNECTED',
    tripId: 'trip_persist_1',
    payload: {},
  };
  // Lexicographic order disagrees with chronological order here (ADR-023):
  // 01:00+09:00 == Aug 31 16:00Z is BEFORE 20:00-06:00 == Sep 01 02:00Z,
  // although the string "2026-09-01..." sorts after "2026-08-31...".
  await signals.saveSignal({ ...base, id: 'sig_utc_first', occurredAt: '2026-09-01T01:00:00+09:00' });
  await signals.saveSignal({ ...base, id: 'sig_utc_last', occurredAt: '2026-08-31T20:00:00-06:00' });
  const list = await signals.listSignalsForTrip('trip_persist_1');
  assert.deepEqual(
    list.map((s) => s.id),
    ['sig_utc_first', 'sig_utc_last'],
  );
});

test('persistence: source metadata and content stored separately', async () => {
  const db = openDatabase(':memory:');
  const sources = new SqliteSourceRepository(db);
  const source: SourceRecord = {
    id: 'src_p1',
    kind: 'BOOKING_CONFIRMATION',
    authority: 'CONNECTED',
    retrievedAt: NOW,
  };
  await sources.saveSource(source);
  await sources.saveSourceContent('src_p1', 'raw confirmation text');
  assert.deepEqual(await sources.getSource('src_p1'), source);
  assert.equal(await sources.getSourceContent('src_p1'), 'raw confirmation text');
  assert.equal(await sources.getSourceContent('missing'), undefined);
  assert.equal((await sources.listSources()).length, 1);
  assert.equal((await sources.listSources('EMAIL')).length, 0);
});

test('persistence: audit append + filtered query honors instant ordering', async () => {
  const db = openDatabase(':memory:');
  const audit = new SqliteAuditRepository(db);
  await audit.append({ occurredAt: '2026-08-20T09:00:00+00:00', actor: 'system', action: 'A', subject: 'trip_persist_1', payload: { n: 1 } });
  await audit.append({ occurredAt: '2026-08-20T19:30:00+09:00', actor: 'system', action: 'B', subject: 'trip_persist_1', payload: { n: 2 } });
  await audit.append({ occurredAt: '2026-08-21T00:00:00+00:00', actor: 'system', action: 'A', payload: { n: 3 } });

  const forTrip = await audit.query({ subject: 'trip_persist_1' });
  assert.equal(forTrip.length, 2);
  // Newest instant first: 19:30+09:00 == 10:30Z is after 09:00Z.
  assert.deepEqual(forTrip.map((e) => e.payload['n']), [2, 1]);

  const since = await audit.query({ since: '2026-08-20T18:01:00+09:00' });
  assert.deepEqual(since.map((e) => e.payload['n']), [3, 2]);
  // `since` is inclusive at the exact instant.
  const inclusive = await audit.query({ since: '2026-08-20T09:00:00+00:00' });
  assert.equal(inclusive.length, 3);

  const limited = await audit.query({ action: 'A', limit: 1 });
  assert.deepEqual(limited.map((e) => e.payload['n']), [3]);
});

test('persistence: entity store holds context entities and constraints', async () => {
  const db = openDatabase(':memory:');
  const store = new SqliteEntityStore(db);
  const ruleSet: RuleSet = {
    id: 'rs_p1',
    kind: 'ORGANISATION',
    name: 'Policy',
    sourceId: 'src_p1',
    rules: [],
  };
  await store.upsert({ entityType: 'RULE_SET', entity: ruleSet });
  const loaded = await store.get('RULE_SET', 'rs_p1');
  assert.equal(loaded?.entityType, 'RULE_SET');
  assert.deepEqual(loaded?.entity, ruleSet);
  assert.equal((await store.list('RULE_SET')).length, 1);
  await assert.rejects(() => store.upsert({ entityType: 'TRIP', entity: makeTrip() } as never));
});

test('persistence: trip and case survive process restart (file-backed reload)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-a1-'));
  const dbPath = join(dir, 'app.sqlite');
  try {
    const first = openDatabase(dbPath);
    await new SqliteTripRepository(first).saveTrip(makeTrip(1));
    await new SqliteCaseRepository(first).saveCase(makeCase(1));
    await new SqliteSourceRepository(first).saveSourceContent('src_p1', 'keep me');
    first.close();

    // Simulated restart: fresh connection, same file.
    const second = openDatabase(dbPath);
    assert.equal(kvGet(second, 'schema_version'), String(SCHEMA_VERSION));
    const trips = new SqliteTripRepository(second);
    const cases = new SqliteCaseRepository(second);
    const sources = new SqliteSourceRepository(second);
    const loadedTrip = await trips.getTrip('trip_persist_1');
    const loadedCase = await cases.getCase('case_persist_1');
    assert.equal(loadedTrip?.version, 1);
    assert.equal(loadedTrip?.travellerIds[0], 'trv_p1');
    assert.equal(loadedCase?.status, 'DETECTED');
    assert.equal(await sources.getSourceContent('src_p1'), 'keep me');
    // Version coherency still enforced after restart.
    await assert.rejects(() => trips.saveTrip(makeTrip(0)), StaleVersionError);
    second.close();
  } finally {
    // Best-effort: Windows can hold WAL side-file handles briefly after close.
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    } catch {
      // Leftover temp dir does not invalidate the restart evidence.
    }
  }
});

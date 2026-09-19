/**
 * M10 — target PostgreSQL programme import, focused proof.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed } from './m2Seed.ts';
import { importProgrammeBundle } from '../src/app/target/programmeImport.ts';
import { loadProgrammeSchedule } from '../src/app/target/readmodels/pgShellFacts.ts';
import { composeTargetEndpoints } from '../src/app/target/composeTargetEndpoints.ts';
import { createTargetAppServer } from '../src/server/targetHttp.ts';
import type { Pool } from '../src/persistence/postgres/pool.ts';

function queryText(args: unknown[]): string {
  const first = args[0];
  if (typeof first === 'string') return first;
  if (first && typeof first === 'object' && 'text' in first && typeof first.text === 'string') return first.text;
  return '';
}

/**
 * Test-only interruption at a real command boundary. The importer owns no
 * fault hook, so this keeps the production path and transaction boundaries
 * unchanged while proving a late command can fail and then be retried.
 */
async function failOnceOnSecondParticipation<T>(pool: Pool, operation: () => Promise<T>): Promise<T> {
  let participationInserts = 0;
  let injected = false;
  const probe = await pool.connect();
  const clientPrototype = Object.getPrototypeOf(probe) as { query: (...queryArgs: unknown[]) => unknown };
  probe.release();
  const originalQuery = clientPrototype.query;
  clientPrototype.query = function (...args: unknown[]) {
    const text = queryText(args);
    if (!injected && text.includes('INSERT INTO participations')) {
      participationInserts += 1;
      if (participationInserts === 2) {
        injected = true;
        throw new Error('injected importer interruption at second participation');
      }
    }
    return originalQuery.apply(this, args);
  };
  try {
    return await operation();
  } finally {
    clientPrototype.query = originalQuery;
  }
}

async function workspaceCounts(pool: Pool, workspaceId: string): Promise<Record<string, number>> {
  const tables = ['organisations', 'events', 'programmes', 'programme_items', 'travellers', 'trips', 'journeys', 'participations'];
  const rows = await Promise.all(tables.map(async (table) => {
    const result = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${table} WHERE workspace_id = $1`, [workspaceId]);
    return [table, Number(result.rows[0]!.count)] as const;
  }));
  return Object.fromEntries(rows);
}

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

test('importProgrammeBundle commits a full real bundle via the real command pipeline', async () => {
  const pool = await sharedTestPool();
  const seed = await beginSeed(pool, 'M10 programme import');
  await commitSeed(seed);

  const result = await importProgrammeBundle(pool, seed.workspaceId, seed.actorId, {
    organisationLegalName: 'Import Test Org',
    eventTitle: 'Import Test Event',
    programmeTitle: 'Import Test Programme',
    items: [
      { title: 'Session A', itemType: 'SESSION', windowStart: '2031-02-01T09:00:00.000Z', windowEnd: '2031-02-01T10:00:00.000Z' },
      { title: 'Session B', itemType: 'SESSION', windowStart: '2031-02-01T11:00:00.000Z', windowEnd: '2031-02-01T12:00:00.000Z' },
    ],
    travellers: [
      { displayName: 'Import Traveller A', participatesInItemIndices: [0, 1], obligation: 'REQUIRED' },
      { displayName: 'Import Traveller B', participatesInItemIndices: [1], obligation: 'OPTIONAL' },
    ],
  });

  assert.equal(result.itemIds.length, 2);
  assert.equal(result.travellers.length, 2);

  const items = await pool.query<{ id: string }>(
    'SELECT id FROM programme_items WHERE workspace_id = $1 AND programme_id = $2',
    [seed.workspaceId, result.programmeId],
  );
  assert.equal(items.rows.length, 2);

  const participations = await pool.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM participations WHERE workspace_id = $1 AND programme_item_id = ANY($2)',
    [seed.workspaceId, result.itemIds],
  );
  assert.equal(Number(participations.rows[0]!.count), 3, 'traveller A has 2 participations, traveller B has 1');
});

test('importProgrammeBundle rejects an out-of-range item reference with a clear error, no partial silent success', async () => {
  const pool = await sharedTestPool();
  const seed = await beginSeed(pool, 'M10 programme import bad ref');
  await commitSeed(seed);

  const before = await pool.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM organisations WHERE workspace_id = $1',
    [seed.workspaceId],
  );

  await assert.rejects(
    () => importProgrammeBundle(pool, seed.workspaceId, seed.actorId, {
      organisationLegalName: 'Bad Ref Org',
      eventTitle: 'Bad Ref Event',
      programmeTitle: 'Bad Ref Programme',
      items: [{ title: 'Only Session', itemType: 'SESSION', windowStart: '2031-03-01T09:00:00.000Z', windowEnd: '2031-03-01T10:00:00.000Z' }],
      travellers: [{ displayName: 'Confused Traveller', participatesInItemIndices: [5], obligation: 'REQUIRED' }],
    }),
    /references item index 5/,
  );

  const after = await pool.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM organisations WHERE workspace_id = $1',
    [seed.workspaceId],
  );
  assert.equal(after.rows[0]!.count, before.rows[0]!.count, 'bundle validation must happen before the first write');
});

test('importProgrammeBundle retries by stable import key without duplicate rows', async () => {
  const pool = await sharedTestPool();
  const seed = await beginSeed(pool, 'M10 programme import retry');
  await commitSeed(seed);

  const bundle = {
    importKey: 'retryable-programme-bundle',
    organisationLegalName: 'Retry Test Org',
    eventTitle: 'Retry Test Event',
    programmeTitle: 'Retry Test Programme',
    items: [{ title: 'Retry Session', itemType: 'SESSION', windowStart: '2031-05-01T09:00:00.000Z', windowEnd: '2031-05-01T10:00:00.000Z' }],
    travellers: [{ displayName: 'Retry Traveller', participatesInItemIndices: [0], obligation: 'REQUIRED' as const }],
  };

  const first = await importProgrammeBundle(pool, seed.workspaceId, seed.actorId, bundle);
  const second = await importProgrammeBundle(pool, seed.workspaceId, seed.actorId, bundle);
  assert.deepEqual(second, first, 'a retry must replay the same authoritative identifiers');

  const counts = await Promise.all([
    pool.query<{ count: string }>('SELECT count(*)::text AS count FROM organisations WHERE workspace_id = $1 AND id = $2', [seed.workspaceId, first.organisationId]),
    pool.query<{ count: string }>('SELECT count(*)::text AS count FROM events WHERE workspace_id = $1 AND id = $2', [seed.workspaceId, first.eventId]),
    pool.query<{ count: string }>('SELECT count(*)::text AS count FROM programmes WHERE workspace_id = $1 AND id = $2', [seed.workspaceId, first.programmeId]),
    pool.query<{ count: string }>('SELECT count(*)::text AS count FROM programme_items WHERE workspace_id = $1 AND id = ANY($2)', [seed.workspaceId, first.itemIds]),
    pool.query<{ count: string }>('SELECT count(*)::text AS count FROM travellers WHERE workspace_id = $1 AND id = $2', [seed.workspaceId, first.travellers[0]!.travellerId]),
    pool.query<{ count: string }>('SELECT count(*)::text AS count FROM trips WHERE workspace_id = $1 AND id = $2', [seed.workspaceId, first.travellers[0]!.tripId]),
    pool.query<{ count: string }>('SELECT count(*)::text AS count FROM journeys WHERE workspace_id = $1 AND id = $2', [seed.workspaceId, first.travellers[0]!.journeyId]),
    pool.query<{ count: string }>('SELECT count(*)::text AS count FROM participations WHERE workspace_id = $1 AND programme_item_id = ANY($2)', [seed.workspaceId, first.itemIds]),
  ]);
  for (const [index, result] of counts.entries()) {
    assert.equal(result.rows[0]!.count, '1', `replay count ${index}`);
  }
});

test('importProgrammeBundle exposes an unknown mid-prefix and converges after a late command retry', async () => {
  const pool = await sharedTestPool();

  // Keep an already populated, unrelated workspace beside the interrupted
  // import. A failure in one import must never bleed across workspace scope.
  const sentinel = await beginSeed(pool, 'M10 programme import sentinel');
  await commitSeed(sentinel);
  await importProgrammeBundle(pool, sentinel.workspaceId, sentinel.actorId, {
    importKey: 'mid-prefix-sentinel',
    organisationLegalName: 'Sentinel Organisation',
    eventTitle: 'Sentinel Event',
    programmeTitle: 'Sentinel Programme',
    items: [{ title: 'Sentinel Session', itemType: 'SESSION', windowStart: '2031-06-01T09:00:00.000Z', windowEnd: '2031-06-01T10:00:00.000Z' }],
    travellers: [{ displayName: 'Sentinel Traveller', participatesInItemIndices: [0], obligation: 'REQUIRED' }],
  });
  const sentinelBefore = await workspaceCounts(pool, sentinel.workspaceId);

  const target = await beginSeed(pool, 'M10 programme import interrupted');
  await commitSeed(target);
  const bundle = {
    importKey: 'mid-prefix-failure',
    organisationLegalName: 'Interrupted Organisation',
    eventTitle: 'Interrupted Event',
    programmeTitle: 'Interrupted Programme',
    items: [{ title: 'Interrupted Session', itemType: 'SESSION', windowStart: '2031-06-02T09:00:00.000Z', windowEnd: '2031-06-02T10:00:00.000Z' }],
    travellers: [
      { displayName: 'Interrupted Traveller A', participatesInItemIndices: [0], obligation: 'REQUIRED' as const },
      { displayName: 'Interrupted Traveller B', participatesInItemIndices: [0], obligation: 'OPTIONAL' as const },
    ],
  };

  await assert.rejects(
    () => failOnceOnSecondParticipation(pool, () => importProgrammeBundle(pool, target.workspaceId, target.actorId, bundle)),
    /injected importer interruption at second participation/,
  );

  const prefix = await workspaceCounts(pool, target.workspaceId);
  assert.deepEqual(prefix, {
    organisations: 1,
    events: 1,
    programmes: 1,
    programme_items: 1,
    travellers: 2,
    trips: 2,
    journeys: 2,
    participations: 1,
  }, 'the committed prefix is foreign-key closed at the failed command boundary');

  const prefixSchedule = await loadProgrammeSchedule(pool, target.workspaceId);
  assert.equal(prefixSchedule.populationSummary?.unknown, 1, 'missing assessment stays unknown');
  assert.equal(prefixSchedule.travellers?.[0]?.status, 'UNKNOWN', 'partial inventory cannot claim healthy readiness');
  assert.ok(prefixSchedule.missingInformation?.length, 'the visible prefix explains missing readiness information');

  // The one-shot interruption hook is gone: the exact bundle and deterministic import key
  // now replay the committed prefix and create only the missing suffix.
  const completed = await importProgrammeBundle(pool, target.workspaceId, target.actorId, bundle);
  assert.equal(completed.travellers.length, 2);
  const completeCounts = await workspaceCounts(pool, target.workspaceId);
  assert.deepEqual(completeCounts, {
    organisations: 1,
    events: 1,
    programmes: 1,
    programme_items: 1,
    travellers: 2,
    trips: 2,
    journeys: 2,
    participations: 2,
  }, 'retry converges without duplicate canonical rows');

  const membership = await pool.query<{ traveller_id: string; programme_item_id: string; obligation: string; accepted: boolean }>(
    `SELECT traveller_id, programme_item_id, obligation, accepted
       FROM participations
      WHERE workspace_id = $1
      ORDER BY traveller_id`,
    [target.workspaceId],
  );
  assert.deepEqual(
    membership.rows.map((row) => ({
      travellerId: row.traveller_id,
      itemId: row.programme_item_id,
      obligation: row.obligation,
      accepted: row.accepted,
    })),
    completed.travellers
      .map((traveller, index) => ({ travellerId: traveller.travellerId, itemId: completed.itemIds[0]!, obligation: index === 0 ? 'REQUIRED' : 'OPTIONAL', accepted: true }))
      .sort((a, b) => a.travellerId.localeCompare(b.travellerId)),
    'retry preserves the intended traveller-to-item memberships',
  );

  assert.deepEqual(await workspaceCounts(pool, sentinel.workspaceId), sentinelBefore, 'the sentinel workspace is unchanged');
});

test('POST /api/v2/programme/import is reachable over HTTP and commits real state', async () => {
  const pool = await sharedTestPool();
  const seed = await beginSeed(pool, 'M10 programme import http');
  await commitSeed(seed);

  const endpoints = await composeTargetEndpoints({ workspaceId: seed.workspaceId, actorId: seed.actorId });
  const server = createTargetAppServer({ environment: 'local', workspaceId: seed.workspaceId }, endpoints);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  try {
    const bundle = {
        organisationLegalName: 'HTTP Import Org',
        eventTitle: 'HTTP Import Event',
        programmeTitle: 'HTTP Import Programme',
        items: [{ title: 'HTTP Session', itemType: 'SESSION', windowStart: '2031-04-01T09:00:00.000Z', windowEnd: '2031-04-01T10:00:00.000Z' }],
        travellers: [{ displayName: 'HTTP Traveller', participatesInItemIndices: [0], obligation: 'REQUIRED' }],
    };
    const before = await pool.query('SELECT id FROM events WHERE workspace_id = $1', [seed.workspaceId]);
    const preview = await fetch(`http://127.0.0.1:${port}/api/v2/programme/import/preview`, {
      method: 'POST', body: JSON.stringify(bundle),
    });
    assert.equal(preview.status, 200);
    const reviewed = await preview.json() as { bundle: unknown; summary: { sessions: number; travellers: number }; mutatesAuthoritativeState: boolean };
    assert.equal(reviewed.mutatesAuthoritativeState, false);
    assert.deepEqual(reviewed.summary, { sessions: 1, travellers: 1 });
    const afterPreview = await pool.query('SELECT id FROM events WHERE workspace_id = $1', [seed.workspaceId]);
    assert.deepEqual(afterPreview.rows, before.rows, 'review creates no programme state');
    const invalid = await fetch(`http://127.0.0.1:${port}/api/v2/programme/import/preview`, {
      method: 'POST', body: JSON.stringify({ ...bundle, travellers: [{ displayName: 'Invalid reference', participatesInItemIndices: [9] }] }),
    });
    assert.equal(invalid.status, 400);
    const response = await fetch(`http://127.0.0.1:${port}/api/v2/programme/import`, {
      method: 'POST', body: JSON.stringify(reviewed.bundle),
    });
    assert.equal(response.status, 200);
    const body = await response.json() as { travellers: unknown[] };
    assert.equal(body.travellers.length, 1);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await endpoints.close();
  }
});

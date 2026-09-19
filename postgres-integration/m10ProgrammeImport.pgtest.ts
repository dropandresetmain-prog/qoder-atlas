/**
 * M10 — target PostgreSQL programme import, focused proof.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed } from './m2Seed.ts';
import { importProgrammeBundle } from '../src/app/target/programmeImport.ts';
import { composeTargetEndpoints } from '../src/app/target/composeTargetEndpoints.ts';
import { createTargetAppServer } from '../src/server/targetHttp.ts';

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

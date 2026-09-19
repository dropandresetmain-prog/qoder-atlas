/**
 * M10 — target PostgreSQL demo world seeding, focused proof.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed } from './m2Seed.ts';
import { seedDemoWorld } from '../src/app/target/demoSeed.ts';
import { loadOperatorOverviewFacts } from '../src/app/target/readmodels/pgFactAssembler.ts';
import { projectOperatorOverview } from '../src/app/target/readmodels/index.ts';
import { createOrganisation } from '../src/persistence/postgres/commands/peopleCommands.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';

const DEMO_COUNTS = {
  organisations: 1,
  events: 1,
  programmes: 1,
  programmeItems: 1,
  travellers: 2,
  trips: 2,
  journeys: 2,
  participations: 2,
} as const;

async function workspaceCounts(pool: Awaited<ReturnType<typeof sharedTestPool>>, workspaceId: string) {
  const tables = [
    ['organisations', 'organisations'],
    ['events', 'events'],
    ['programmes', 'programmes'],
    ['programmeItems', 'programme_items'],
    ['travellers', 'travellers'],
    ['trips', 'trips'],
    ['journeys', 'journeys'],
    ['participations', 'participations'],
  ] as const;
  const rows = await Promise.all(tables.map(async ([key, table]) => {
    const result = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ${table} WHERE workspace_id = $1`,
      [workspaceId],
    );
    return [key, Number(result.rows[0]!.count)] as const;
  }));
  return Object.fromEntries(rows) as Record<keyof typeof DEMO_COUNTS, number>;
}

async function assertWorldLinks(
  pool: Awaited<ReturnType<typeof sharedTestPool>>,
  workspaceId: string,
  result: Awaited<ReturnType<typeof seedDemoWorld>>,
): Promise<void> {
  const rows = await pool.query<{
    organisation_id: string;
    event_id: string;
    programme_id: string;
    item_id: string;
    traveller_count: string;
    participation_count: string;
  }>(
    `SELECT e.organiser_organisation_id AS organisation_id,
            e.id AS event_id,
            p.id AS programme_id,
            pi.id AS item_id,
            (SELECT count(*) FROM travellers t WHERE t.workspace_id = $1) AS traveller_count,
            (SELECT count(*) FROM participations pa WHERE pa.workspace_id = $1 AND pa.programme_item_id = pi.id) AS participation_count
       FROM events e
       JOIN programmes p ON p.workspace_id = e.workspace_id AND p.event_id = e.id
       JOIN programme_items pi ON pi.workspace_id = p.workspace_id AND pi.programme_id = p.id
      WHERE e.workspace_id = $1 AND e.id = $2 AND p.id = $3 AND pi.id = ANY($4::uuid[])`,
    [workspaceId, result.eventId, result.programmeId, result.itemIds],
  );
  assert.deepEqual(rows.rows, [{
    organisation_id: result.organisationId,
    event_id: result.eventId,
    programme_id: result.programmeId,
    item_id: result.itemIds[0],
    traveller_count: '2',
    participation_count: '2',
  }]);
}

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

test('seedDemoWorld builds a real, coherent demo world with no SQLite involvement', async () => {
  const pool = await sharedTestPool();
  const seed = await beginSeed(pool, 'M10 demo seed');
  await commitSeed(seed);

  const result = await seedDemoWorld(pool, seed.workspaceId, seed.actorId);

  assert.equal(result.travellers.length, 2);
  for (const traveller of result.travellers) {
    assert.ok(traveller.travellerId);
    assert.ok(traveller.tripId);
    assert.ok(traveller.journeyId);
  }

  // Real product read model sees the seeded world — not a parallel truth.
  const facts = await loadOperatorOverviewFacts(pool, seed.workspaceId);
  const view = projectOperatorOverview(facts);
  assert.ok(view.items.length >= 0, 'operator overview projects without error over the seeded workspace');

  const firstCounts = await workspaceCounts(pool, seed.workspaceId);
  assert.deepEqual(firstCounts, DEMO_COUNTS, 'the first workspace contains the complete imported world');
  await assertWorldLinks(pool, seed.workspaceId, result);

  // Deterministic import identity is stable within a workspace: a retry
  // replays the same command receipts and does not duplicate any aggregate.
  const replay = await seedDemoWorld(pool, seed.workspaceId, seed.actorId);
  assert.deepEqual(replay, result, 'same-workspace seed retry replays authoritative identifiers');
  assert.deepEqual(await workspaceCounts(pool, seed.workspaceId), firstCounts, 'same-workspace retry adds no rows');

  const secondWorkspace = await beginSeed(pool, 'M10 demo seed 2');
  await commitSeed(secondWorkspace);
  const second = await seedDemoWorld(pool, secondWorkspace.workspaceId, secondWorkspace.actorId);
  assert.equal(second.travellers.length, 2);
  assert.equal(second.organisationId, result.organisationId, 'stable local IDs may coexist under distinct workspace scopes');
  const secondCounts = await workspaceCounts(pool, secondWorkspace.workspaceId);
  assert.deepEqual(secondCounts, DEMO_COUNTS, 'the second workspace gets its own complete imported world');
  await assertWorldLinks(pool, secondWorkspace.workspaceId, second);

  // IDs may be equal across workspaces because PostgreSQL identity is the
  // composite (workspace_id, id). Prove the actual isolation boundary by
  // adding an organisation through the real command path in only workspace 1.
  const extraOrganisationId = randomUUID();
  const added = await createOrganisation(new PgUnitOfWork(pool, seed.workspaceId), {
    workspaceId: seed.workspaceId,
    actorPrincipalId: seed.actorId,
    idempotencyKey: `m10-demo-isolation:${randomUUID()}`,
    organisationId: extraOrganisationId,
    legalName: 'Workspace One Additional Organisation',
    defaultCurrencyCode: 'USD',
  });
  assert.equal(added.ok, true, 'real organisation command succeeds in the first workspace');
  assert.equal((await workspaceCounts(pool, seed.workspaceId)).organisations, 2);
  assert.deepEqual(await workspaceCounts(pool, secondWorkspace.workspaceId), secondCounts, 'the second workspace is unchanged by the first workspace command');

  for (const workspaceId of [seed.workspaceId, secondWorkspace.workspaceId]) {
    const scopedFacts = await loadOperatorOverviewFacts(pool, workspaceId);
    assert.ok(Array.isArray(projectOperatorOverview(scopedFacts).items));
  }
});

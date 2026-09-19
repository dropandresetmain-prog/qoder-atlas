/**
 * R4-F — the programme schedule read model must plan and run on real PostgreSQL
 * (regression: an ungrouped `pi.workspace_id` in a correlated subquery made
 * /programme return a raw SQL 500). Generic world; no scenario is keyed.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sharedTestPool } from './harness.ts';
import { openDisruptionCase } from './r1ProgrammeWorld.ts';
import { ActivityCursorError, loadActivityFeed, loadProgrammeSchedule } from '../src/app/target/readmodels/pgShellFacts.ts';
import { renderProductActivityFeed } from '../src/ui/screens/product-activity-feed.ts';

after(async () => { await (await sharedTestPool()).end(); });

test('loadProgrammeSchedule runs on PG and reports the affected case per item', async () => {
  const c = await openDisruptionCase('r4 programme schedule');
  const schedule = await loadProgrammeSchedule(c.pool, c.world.workspaceId);
  assert.ok(Array.isArray(schedule.items));
  assert.ok(schedule.items.length > 0, 'the world has programme items');
});

test('Activity pages preserve complete PG ordering across timestamp ties and new arrivals', async () => {
  const c = await openDisruptionCase('activity pagination');
  const workspaceId = c.world.workspaceId;
  // One command may change multiple subjects. Seed a bounded audit-page fixture
  // linked to a real command receipt, with a microsecond timestamp shared by rows.
  await c.pool.query(`INSERT INTO change_records
    (workspace_id, command_namespace, idempotency_key, actor_principal_id, subject_kind,
     subject_id, after_revision, occurred_at)
    SELECT workspace_id, command_namespace, idempotency_key, actor_principal_id, subject_kind,
           subject_id, after_revision, '2035-01-01T12:00:00.123456Z'::timestamptz
      FROM (SELECT * FROM change_records WHERE workspace_id = $1 LIMIT 1) source
      CROSS JOIN generate_series(1, 45)`, [workspaceId]);
  const expected = await c.pool.query<{ id: string }>(
    'SELECT id FROM change_records WHERE workspace_id = $1 ORDER BY occurred_at DESC, id DESC', [workspaceId]);
  const first = await loadActivityFeed(c.pool, workspaceId);
  assert.equal(first.entries.length, 20);
  assert.ok(first.nextCursor);
  assert.match(renderProductActivityFeed(first), /Older activity/);
  // A newly committed row cannot shift or duplicate the anchored older pages.
  await c.pool.query(`INSERT INTO change_records
    (workspace_id, command_namespace, idempotency_key, actor_principal_id, subject_kind,
     subject_id, after_revision, occurred_at)
    SELECT workspace_id, command_namespace, idempotency_key, actor_principal_id, subject_kind,
           subject_id, after_revision, '2036-01-01T12:00:00Z'::timestamptz
      FROM change_records WHERE workspace_id = $1 LIMIT 1`, [workspaceId]);
  const seen = first.entries.map((entry) => entry.entryRef);
  let cursor: string | undefined = first.nextCursor;
  while (cursor) {
    const page = await loadActivityFeed(c.pool, workspaceId, cursor);
    assert.equal(page.beforeCursor, cursor);
    assert.match(renderProductActivityFeed(page), /Latest activity/);
    seen.push(...page.entries.map((entry) => entry.entryRef));
    cursor = page.nextCursor;
  }
  assert.deepEqual(seen, expected.rows.map((row) => row.id));
  await assert.rejects(loadActivityFeed(c.pool, workspaceId, 'invalid'), ActivityCursorError);
  await assert.rejects(loadActivityFeed(c.pool, '00000000-0000-4000-8000-000000000001', first.nextCursor), ActivityCursorError);
});

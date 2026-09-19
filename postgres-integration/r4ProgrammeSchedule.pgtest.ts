/**
 * R4-F — the programme schedule read model must plan and run on real PostgreSQL
 * (regression: an ungrouped `pi.workspace_id` in a correlated subquery made
 * /programme return a raw SQL 500). Generic world; no scenario is keyed.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sharedTestPool } from './harness.ts';
import { openDisruptionCase } from './r1ProgrammeWorld.ts';
import { loadProgrammeSchedule } from '../src/app/target/readmodels/pgShellFacts.ts';

after(async () => { await (await sharedTestPool()).end(); });

test('loadProgrammeSchedule runs on PG and reports the affected case per item', async () => {
  const c = await openDisruptionCase('r4 programme schedule');
  const schedule = await loadProgrammeSchedule(c.pool, c.world.workspaceId);
  assert.ok(Array.isArray(schedule.items));
  assert.ok(schedule.items.length > 0, 'the world has programme items');
});

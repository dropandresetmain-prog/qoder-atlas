/**
 * Focused proof: the operator overview's bounded eventOverview projection is
 * produced from real PostgreSQL state (canonical bundle) on one snapshot.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { Pool } from '../src/persistence/postgres/pool.ts';
import { sharedTestPool } from './harness.ts';
import { loadDataset } from '../src/app/demo/datasetLoader.ts';
import { provisionDataset } from '../src/app/demo/provisionDataset.ts';
import { runBaselineEvaluation } from '../src/app/demo/baselineEvaluation.ts';
import { loadOperatorOverviewFacts } from '../src/app/target/readmodels/pgFactAssembler.ts';
import { projectOperatorOverview } from '../src/app/target/readmodels/index.ts';
import { EventOverviewSchema } from '../src/contracts/v2/product/readModels.ts';

const BUNDLE_DIR = fileURLToPath(new URL('../fixtures/programmes/ait-summit-2026/', import.meta.url));
const ACTOR = 'principal:event-overview-test';

let pool: Pool;

before(async () => {
  pool = await sharedTestPool();
});

after(async () => {
  await pool.end();
});

test('operator overview carries a bounded, schema-valid eventOverview', async () => {
  const dataset = await loadDataset(BUNDLE_DIR);
  const workspaceId = randomUUID();
  await pool.query('INSERT INTO workspaces (id, name) VALUES ($1, $2)', [workspaceId, `event-overview:${workspaceId}`]);
  const outcome = await provisionDataset({ pool, workspaceId, actorPrincipalId: ACTOR, dataset });
  assert.equal(outcome.status, 'MATERIALIZED');
  await runBaselineEvaluation({ pool, workspaceId, actorPrincipalId: ACTOR });

  const view = projectOperatorOverview(await loadOperatorOverviewFacts(pool, workspaceId));
  const eo = view.eventOverview;
  assert.ok(eo, 'eventOverview is present');
  EventOverviewSchema.parse(eo);
  assert.ok(eo.days.length >= 1 && eo.days.length <= 14);
  assert.ok(eo.landmarks.length > 0 && eo.landmarks.length <= 42);
  assert.ok(eo.dependencies.length <= 12);
  assert.ok(eo.cohorts.length <= 15);
  assert.ok((eo.relations?.length ?? 0) <= 256);
  assert.ok(eo.promotedTravellers.length <= 16);
  assert.equal(
    eo.cohorts.reduce((s, c) => s + c.total, 0) + eo.promotedTravellers.length,
    view.population.length,
    'cohorts + promoted cover the population',
  );
  const dayIdx = new Set(eo.days.map((d) => d.index));
  assert.ok(eo.landmarks.every((l) => dayIdx.has(l.dayIndex)));
  const nodeRefs = new Set([
    ...eo.dependencies.map((d) => d.ref),
    ...eo.landmarks.map((l) => l.ref),
    ...eo.cohorts.map((c) => c.ref),
    ...eo.promotedTravellers.map((t) => t.journeyRef),
  ]);
  for (const relation of eo.relations ?? []) {
    assert.ok(nodeRefs.has(relation.fromRef), `relation source is projected: ${relation.id}`);
    assert.ok(nodeRefs.has(relation.toRef), `relation target is projected: ${relation.id}`);
  }
  console.log(`[evidence] eventOverview ${JSON.stringify(eo)}`);
});

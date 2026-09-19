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
import { attachSeedSession, commitSeed, seedJourney, seedJourneyItem, seedTraveller, seedTrip } from './m2Seed.ts';
import { seedResource } from './m3Seed.ts';
import { loadDisclosedDisruptionEvent } from '../src/app/demo/providerDisruptionEventSource.ts';
import { acceptProviderDisruptionDemoEvent } from '../src/app/target/providerDisruptionIngress.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { openRecoveryCase } from '../src/persistence/postgres/commands/m8AuthorityCommands.ts';
import { attachCaseSubjects } from '../src/persistence/postgres/commands/caseLifecycleCommands.ts';

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

  // A shared canonical resource with no programme participation must still be
  // in the complete population and form a typed, legible dependency group.
  const seed = await attachSeedSession(pool, workspaceId, ACTOR);
  const resourceId = await seedResource(seed, 'EQUIPMENT');
  const resourceJourneys: string[] = [];
  for (const label of ['Resource traveller A', 'Resource traveller B']) {
    const traveller = await seedTraveller(seed, { displayName: label });
    const tripId = await seedTrip(seed, { purpose: 'Shared equipment test', lifecycleStatus: 'ACTIVE' });
    const journeyId = await seedJourney(seed, { tripId, travellerId: traveller.travellerId, lifecycleStatus: 'ACTIVE' });
    const journeyItem = await seedJourneyItem(seed, { journeyId, kind: 'RESOURCE_USE' });
    await seed.client.query(
      'UPDATE resource_use_item_details SET resource_id = $3 WHERE workspace_id = $1 AND journey_item_id = $2',
      [workspaceId, journeyItem.journeyItemId, resourceId],
    );
    resourceJourneys.push(journeyId);
  }
  await commitSeed(seed);

  const resourceView = projectOperatorOverview(await loadOperatorOverviewFacts(pool, workspaceId));
  const resourceOverview = resourceView.eventOverview!;
  const resourceDependency = resourceOverview.dependencies.find((dependency) => dependency.ref === `RESOURCE:${resourceId}`);
  assert.ok(resourceDependency, 'shared resource is a selected dependency');
  assert.equal(resourceDependency.kindLabel, 'Shared equipment');
  assert.equal(resourceDependency.label, 'Equipment at M3 Seed Resource Location');
  assert.equal(resourceDependency.travellerCount, 2);
  assert.ok(resourceJourneys.every((id) => resourceView.population.some((member) => member.journeyRef === `JOURNEY:${id}`)), 'no-programme journeys remain in the population');
  assert.ok((resourceOverview.cohorts.find((cohort) => cohort.ref === 'COHORT:unassigned')?.total ?? 0) >= 2, 'no-programme journeys form an unassigned cohort');
  // A supplier replacement starts with its own published schedule. It is
  // still a real change even when estimated and published times are equal.
  const event = await loadDisclosedDisruptionEvent(fileURLToPath(new URL('../data/ait-demo-input-pack/scenarios/s1-supplier-disruption/inputs/airline-schedule-change-id7159.json', import.meta.url)));
  const uow = () => new PgUnitOfWork(pool, workspaceId);
  const applied = await acceptProviderDisruptionDemoEvent({ pool, workspaceId, actorPrincipalId: ACTOR, uow }, event);
  assert.equal(applied.ok, true, JSON.stringify(applied));
  if (!applied.ok) return;
  const signalId = applied.changeSignalId;
  assert.ok(signalId);
  const replacement = await pool.query<{ subject_id: string }>(
    `SELECT subject_id FROM change_records WHERE workspace_id = $1 AND change_signal_id = $2 AND subject_kind = 'TRANSPORT_SERVICE'`,
    [workspaceId, signalId],
  );
  assert.equal(replacement.rowCount, 1);
  const serviceId = replacement.rows[0]!.subject_id;
  const clock = await pool.query<{ unchanged: boolean }>(
    `SELECT COALESCE(actual_arrival, estimated_arrival, published_arrival) = published_arrival AS unchanged FROM transport_services WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, serviceId],
  );
  assert.equal(clock.rows[0]!.unchanged, true);
  const opened = await openRecoveryCase(uow(), { workspaceId, actorPrincipalId: ACTOR, idempotencyKey: randomUUID(), openedAt: event.receivedAt });
  assert.ok(opened.ok);
  if (!opened.ok) return;
  const linked = await attachCaseSubjects(uow(), { workspaceId, actorPrincipalId: ACTOR, idempotencyKey: randomUUID(), caseId: opened.value.caseId, changeSignalIds: [signalId] });
  assert.ok(linked.ok);
  const changed = projectOperatorOverview(await loadOperatorOverviewFacts(pool, workspaceId));
  const changedDependency = changed.eventOverview!.dependencies.find((dependency) => dependency.ref === `SERVICE:${serviceId}`);
  assert.equal(changedDependency?.changed, true, 'applied canonical provenance marks the replacement as changed');
  assert.equal(changedDependency?.travellerCount, event.affectedBookings.length);
  assert.equal(changed.eventOverview!.blastRadius?.affectedCount, event.affectedBookings.length);
  assert.equal(changed.eventOverview!.cohorts.reduce((sum, cohort) => sum + cohort.total, 0) + changed.eventOverview!.promotedTravellers.length, changed.population.length);
  console.log(`[evidence] Overview covers ${changed.population.length} journeys; replacement footprint ${changedDependency?.travellerCount}`);
});

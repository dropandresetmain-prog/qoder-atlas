/**
 * M7 PostgreSQL — recovery case/strategy immutability, I-7 objective targets,
 * and candidate evaluation isolation from durable disposition tables.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed, seedRootSubject } from './m2Seed.ts';
import { seedPlace } from './m4Seed.ts';
import { seedJourney, seedTraveller, seedTrip } from './m6WorldSeed.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import {
  recordObjective,
  recordObjectiveTargets,
} from '../src/persistence/postgres/commands/knowledgeCommands.ts';
import { evaluateRecoveryStrategy } from '../src/resolution/scenarios/evaluate.ts';
import { ScenarioChangeSchema } from '../src/contracts/v2/scenario/scenarioChange.ts';
import { emptyWorld } from '../test/support/m6World.ts';
import type { WorldSnapshotManifest } from '../src/contracts/v2/scope/readScope.ts';

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

function mustOk<T>(outcome: { ok: boolean; value?: T; conflict?: { kind: string; message: string } }): T {
  if (!outcome.ok || outcome.value === undefined) {
    throw new Error(`${outcome.conflict?.kind}: ${outcome.conflict?.message}`);
  }
  return outcome.value;
}

test('I-7: objective targets and success_predicate_kind persist via command', async () => {
  const pool = await sharedTestPool();
  const seed = await beginSeed(pool, 'M7 I-7 objective targets');
  const traveller = await seedTraveller(seed, { displayName: 'Traveller T' });
  const tripId = await seedTrip(seed, { purpose: 'TEST' });
  const journeyId = await seedJourney(seed, { tripId, travellerId: traveller.travellerId });
  const placeId = await seedPlace(seed, { name: 'Session venue', placeType: 'VENUE' });
  await commitSeed(seed);

  const uow = new PgUnitOfWork(pool, seed.workspaceId);
  const actor = { workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID() };

  const recorded = mustOk(await recordObjective(uow, {
    ...actor,
    ownerKind: 'JOURNEY',
    ownerId: journeyId,
    successPredicate: 'Arrive before session',
    successPredicateKind: 'ARRIVAL_BY',
    hardness: 'HARD',
    priority: 1,
    targets: [
      { label: 'deadline', targetKind: 'TIME', atOrBefore: '2031-06-01T12:00:00.000Z' },
      { label: 'place', targetKind: 'PLACE', placeId },
    ],
  }));

  const kindRow = await pool.query<{ success_predicate_kind: string }>(
    `SELECT success_predicate_kind FROM objectives WHERE workspace_id = $1 AND id = $2`,
    [seed.workspaceId, recorded.objectiveId],
  );
  assert.equal(kindRow.rows[0]?.success_predicate_kind, 'ARRIVAL_BY');

  const targets = await pool.query<{ label: string; target_kind: string }>(
    `SELECT label, target_kind FROM objective_targets WHERE workspace_id = $1 AND objective_id = $2 ORDER BY label`,
    [seed.workspaceId, recorded.objectiveId],
  );
  assert.equal(targets.rowCount, 2);

  const appended = mustOk(await recordObjectiveTargets(uow, {
    ...actor,
    idempotencyKey: randomUUID(),
    objectiveId: recorded.objectiveId,
    expectedRevision: 1,
    targets: [{ label: 'money', targetKind: 'MONEY', amountMinor: 50000, currencyCode: 'USD' }],
  }));
  assert.equal(appended.revision, 2);

  const count = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM objective_targets WHERE workspace_id = $1 AND objective_id = $2`,
    [seed.workspaceId, recorded.objectiveId],
  );
  assert.equal(count.rows[0]?.n, '3');
});

test('M7 tables: recovery_strategy rows are immutable; overlay does not write dispositions', async () => {
  const pool = await sharedTestPool();
  const seed = await beginSeed(pool, 'M7 strategy persistence');
  const caseId = await seedRootSubject(seed, { kind: 'RECOVERY_CASE' });
  await seed.client.query(
    `INSERT INTO recovery_cases (workspace_id, id, lifecycle_status, created_by_actor_id)
     VALUES ($1, $2, 'OPEN', $3)`,
    [seed.workspaceId, caseId, seed.actorId],
  );
  const strategyId = await seedRootSubject(seed, { kind: 'RECOVERY_STRATEGY' });
  const scenario = {
    id: randomUUID(),
    recoveryStrategyId: strategyId,
    strategyVersion: 1,
    affectedSubjectRefs: [{ kind: 'JOURNEY', id: randomUUID() }],
    effects: [{ effectKind: 'WAIVE_OBJECTIVE', objectiveId: randomUUID(), rationale: 'loss proposal', disposition: 'WAIVED' }],
    basisAssessmentId: randomUUID(),
  };
  await seed.client.query(
    `INSERT INTO recovery_strategies
       (workspace_id, id, recovery_case_id, strategy_version, status, viability,
        base_manifest, scenario_change, created_by_actor_id)
     VALUES ($1, $2, $3, 1, 'PROPOSED', 'NOT_EXECUTABLE',
             '{}'::jsonb, $4::jsonb, $5)`,
    [seed.workspaceId, strategyId, caseId, JSON.stringify(scenario), seed.actorId],
  );
  await commitSeed(seed);

  await assert.rejects(
    () => pool.query(
      `UPDATE recovery_strategies SET status = 'SELECTED' WHERE workspace_id = $1 AND id = $2`,
      [seed.workspaceId, strategyId],
    ),
    /forbid_mutation|immutable|cannot|trigger|append-only/i,
  );

  const objectiveId = randomUUID();
  const journeyId = randomUUID();
  const world = emptyWorld({
    journeys: [{
      id: journeyId, revision: 1, tripId: randomUUID(), travellerId: randomUUID(),
      lifecycleStatus: 'ACTIVE', intendedWindow: null, responsibilityOrganisationId: null,
    }],
    objectives: [{
      id: objectiveId, revision: 1, owner: { kind: 'JOURNEY', id: journeyId },
      successPredicateKind: 'STATEMENT', hardness: 'HARD', priority: 1,
      disposition: 'ACTIVE', dispositionEvidenceId: null, targets: [],
    }],
    focus: [{ kind: 'JOURNEY', id: journeyId }],
  });
  const change = ScenarioChangeSchema.parse({
    id: randomUUID(),
    recoveryStrategyId: strategyId,
    strategyVersion: 1,
    affectedSubjectRefs: [{ kind: 'OBJECTIVE', id: objectiveId }],
    basisAssessmentId: randomUUID(),
    effects: [{
      effectKind: 'WAIVE_OBJECTIVE',
      objectiveId,
      rationale: 'proposed only',
      disposition: 'WAIVED',
    }],
  });
  const manifest: WorldSnapshotManifest = {
    evaluatedAt: '2031-01-01T00:00:00.000Z',
    evaluatorVersions: [],
    aggregateReads: [],
    scopeReads: [],
    evidenceReads: [],
    coverageReads: [],
    missingCoverage: [],
  };
  const evaluated = evaluateRecoveryStrategy({
    recoveryCaseId: caseId,
    strategyId,
    baseWorld: world,
    baseManifest: manifest,
    basisAssessmentId: change.basisAssessmentId,
    scenarioChange: change,
    now: '2031-01-01T00:00:00.000Z',
  });
  assert.equal(evaluated.ok, true);
  if (!evaluated.ok) return;
  assert.equal(world.objectives[0]!.disposition, 'ACTIVE');
  assert.equal(evaluated.value.proposedWorld.objectives[0]!.disposition, 'WAIVED');

  const dispositions = await pool.query(
    `SELECT 1 FROM objective_dispositions WHERE workspace_id = $1 LIMIT 1`,
    [seed.workspaceId],
  );
  assert.equal(dispositions.rowCount, 0);
});

test('M7 migrations 0100-0102 are applied', async () => {
  const pool = await sharedTestPool();
  const tables = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename = ANY($1::text[])
      ORDER BY tablename`,
    [['recovery_cases', 'recovery_strategies', 'strategy_changes', 'action_plans', 'action_intents', 'action_dependencies', 'case_action_links']],
  );
  assert.deepEqual(
    tables.rows.map((r) => r.tablename),
    [
      'action_dependencies',
      'action_intents',
      'action_plans',
      'case_action_links',
      'recovery_cases',
      'recovery_strategies',
      'strategy_changes',
    ],
  );
});

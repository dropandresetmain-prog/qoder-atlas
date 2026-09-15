/**
 * M9 / M7-M8 narrow correction: sequential CHANGE_PROGRAMME_ITEM_TIME intents
 * against the SAME Programme aggregate must succeed when ordered by the plan
 * DAG, while unrelated external concurrent advances still fail closed.
 *
 * Root cause addressed:
 * - compileActionPlan now captures PROGRAMME expectedRevision from the
 *   strategy base manifest (and orders same-Programme intents);
 * - after observed success, dependents are rebased to the authoritative
 *   post-action revision;
 * - the execution gate exempts AGGREGATE_ADVANCED only when the intent's
 *   (rebased) expectedRevision already matches the current head.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed, seedTraveller, seedTrip, seedJourney } from './m2Seed.ts';
import { seedEvent, seedProgramme, seedProgrammeItem, seedParticipation } from './m4Seed.ts';
import { PgUnitOfWork, type ExecuteOutcome } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { createPrincipal } from '../src/persistence/postgres/commands/peopleCommands.ts';
import { openRecoveryCase, persistActionPlan } from '../src/persistence/postgres/commands/m8AuthorityCommands.ts';
import { updateProgrammeItemSchedule } from '../src/persistence/postgres/commands/programmeCommands.ts';
import { executeInternalProgrammeItemSchedule } from '../src/persistence/postgres/execution/internalProgrammeExecutor.ts';
import { evaluateRecoveryStrategy } from '../src/resolution/scenarios/evaluate.ts';
import { compileActionPlan } from '../src/resolution/planning/compiler.ts';
import { ScenarioChangeSchema } from '../src/contracts/v2/scenario/scenarioChange.ts';
import { emptyWorld } from '../test/support/m6World.ts';
import type { WJourney, WObjective, WProgrammeItem, WParticipation } from '../src/resolution/world/world.ts';
import type { WorldSnapshotManifest } from '../src/contracts/v2/scope/readScope.ts';
import {
  loadRequiredAuthorityScopesOrFail,
  persistStrategyChangeRow,
  seedStoredExecutionAuthority,
  seedMinimalCurrentAssessment,
  prepareParams,
} from './m8ExecutionGateHelpers.ts';

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

const NOW = '2031-09-01T00:00:00.000Z';
const EXEC_NOW = '2032-01-01T00:00:00.000Z';

function mustOk<T>(o: ExecuteOutcome<T>): T {
  if (!o.ok) assert.fail(`${o.conflict.kind}: ${o.conflict.message}`);
  return o.value;
}

function emptyManifest(): WorldSnapshotManifest {
  return {
    evaluatedAt: NOW,
    evaluatorVersions: [],
    aggregateReads: [],
    scopeReads: [],
    evidenceReads: [],
    coverageReads: [],
    missingCoverage: [],
  };
}

async function seedBilateralWorld() {
  const pool = await sharedTestPool();
  const seed = await beginSeed(pool, 'M9 same-Programme sequential');
  const t1 = await seedTraveller(seed, { displayName: 'Side A traveller' });
  const t2 = await seedTraveller(seed, { displayName: 'Side B traveller' });
  const trip1 = await seedTrip(seed);
  const trip2 = await seedTrip(seed);
  const j1 = await seedJourney(seed, { tripId: trip1, travellerId: t1.travellerId });
  const j2 = await seedJourney(seed, { tripId: trip2, travellerId: t2.travellerId });
  const eventId = await seedEvent(seed, { lifecycleStatus: 'ACTIVE' });
  const programmeId = await seedProgramme(seed, { eventId, lifecycleStatus: 'ACTIVE' });
  const winA = { start: '2031-09-10T11:30:00.000Z', end: '2031-09-10T12:00:00.000Z' };
  const winB = { start: '2031-09-10T14:30:00.000Z', end: '2031-09-10T15:00:00.000Z' };
  const itemA = await seedProgrammeItem(seed, {
    programmeId, lifecycleStatus: 'SCHEDULED', scheduleAuthority: 'INTERNAL', window: winA,
  });
  const itemB = await seedProgrammeItem(seed, {
    programmeId, lifecycleStatus: 'SCHEDULED', scheduleAuthority: 'INTERNAL', window: winB,
  });
  await seedParticipation(seed, {
    programmeItemId: itemA.programmeItemId, travellerId: t1.travellerId, obligation: 'OPTIONAL', accepted: true,
  });
  await seedParticipation(seed, {
    programmeItemId: itemB.programmeItemId, travellerId: t2.travellerId, obligation: 'OPTIONAL', accepted: true,
  });
  await commitSeed(seed);

  const principalId = randomUUID();
  const uow = () => new PgUnitOfWork(pool, seed.workspaceId);
  mustOk(await createPrincipal(uow(), {
    workspaceId: seed.workspaceId,
    actorPrincipalId: seed.actorId,
    idempotencyKey: randomUUID(),
    principalId,
    actorType: 'HUMAN',
    authIssuer: 'https://issuer.invalid/same-programme',
    authSubject: principalId,
  }));
  const opened = mustOk(await openRecoveryCase(uow(), {
    workspaceId: seed.workspaceId,
    actorPrincipalId: seed.actorId,
    idempotencyKey: randomUUID(),
    openedAt: NOW,
  }));

  const journeyA: WJourney = {
    id: j1, revision: 1, tripId: trip1, travellerId: t1.travellerId,
    lifecycleStatus: 'ACTIVE', intendedWindow: null, responsibilityOrganisationId: null,
  };
  const journeyB: WJourney = {
    id: j2, revision: 1, tripId: trip2, travellerId: t2.travellerId,
    lifecycleStatus: 'ACTIVE', intendedWindow: null, responsibilityOrganisationId: null,
  };
  const objA: WObjective = {
    id: randomUUID(), revision: 1, owner: { kind: 'JOURNEY', id: j1 },
    successPredicateKind: 'STATEMENT', hardness: 'HARD', priority: 1,
    disposition: 'ACHIEVED', dispositionEvidenceId: null, targets: [],
  };
  const objB: WObjective = {
    id: randomUUID(), revision: 1, owner: { kind: 'JOURNEY', id: j2 },
    successPredicateKind: 'STATEMENT', hardness: 'HARD', priority: 1,
    disposition: 'ACHIEVED', dispositionEvidenceId: null, targets: [],
  };
  const wItemA: WProgrammeItem = {
    id: itemA.programmeItemId, programmeId, title: 'A', itemType: 'SESSION', placeId: null,
    window: winA, lifecycleStatus: 'SCHEDULED', scheduleAuthority: 'INTERNAL', operatingRequirements: null,
  };
  const wItemB: WProgrammeItem = {
    id: itemB.programmeItemId, programmeId, title: 'B', itemType: 'SESSION', placeId: null,
    window: winB, lifecycleStatus: 'SCHEDULED', scheduleAuthority: 'INTERNAL', operatingRequirements: null,
  };
  const pA: WParticipation = {
    id: randomUUID(), programmeItemId: itemA.programmeItemId, travellerId: t1.travellerId,
    obligation: 'OPTIONAL', accepted: true, preparationWindow: null,
  };
  const pB: WParticipation = {
    id: randomUUID(), programmeItemId: itemB.programmeItemId, travellerId: t2.travellerId,
    obligation: 'OPTIONAL', accepted: true, preparationWindow: null,
  };
  const world = emptyWorld({
    journeys: [journeyA, journeyB],
    objectives: [objA, objB],
    programmes: [{ id: programmeId, revision: 1, eventId, title: 'e', lifecycleStatus: 'ACTIVE' }],
    programmeItems: [wItemA, wItemB],
    participations: [pA, pB],
    focus: [
      { kind: 'PROGRAMME_ITEM', id: itemA.programmeItemId },
      { kind: 'PROGRAMME_ITEM', id: itemB.programmeItemId },
    ],
  });
  const scenarioChange = ScenarioChangeSchema.parse({
    id: randomUUID(),
    recoveryStrategyId: randomUUID(),
    strategyVersion: 1,
    affectedSubjectRefs: [
      { kind: 'PROGRAMME_ITEM', id: itemA.programmeItemId },
      { kind: 'PROGRAMME_ITEM', id: itemB.programmeItemId },
    ],
    basisAssessmentId: randomUUID(),
    effects: [
      { effectKind: 'CHANGE_PROGRAMME_ITEM_TIME', programmeItemId: itemA.programmeItemId, proposedWindow: winB },
      { effectKind: 'CHANGE_PROGRAMME_ITEM_TIME', programmeItemId: itemB.programmeItemId, proposedWindow: winA },
    ],
  });
  const baseManifestV1: WorldSnapshotManifest = {
    ...emptyManifest(),
    aggregateReads: [{ aggregateRef: { kind: 'PROGRAMME', id: programmeId }, revision: 1 }],
  };
  const evaluated = evaluateRecoveryStrategy({
    recoveryCaseId: opened.caseId,
    baseWorld: world,
    baseManifest: baseManifestV1,
    basisAssessmentId: scenarioChange.basisAssessmentId,
    scenarioChange,
    now: NOW,
  });
  assert.equal(evaluated.ok, true, JSON.stringify(evaluated));
  if (!evaluated.ok) throw new Error('evaluate failed');
  assert.equal(evaluated.value.strategy.viability, 'VIABLE');

  const compiled = compileActionPlan({ strategy: evaluated.value.strategy, now: NOW });
  assert.equal(compiled.ok, true);
  if (!compiled.ok) throw new Error('compile failed');
  const plan = compiled.value.plan;
  assert.equal(plan.intents.length, 2);
  assert.equal(plan.dependencies.some(
    (d) => d.fromActionIntentId === plan.intents[0]!.id && d.toActionIntentId === plan.intents[1]!.id,
  ), true, 'same-Programme intents must be ordered');
  for (const intent of plan.intents) {
    assert.deepEqual(intent.expectedRevisions, [{
      aggregateRef: { kind: 'PROGRAMME', id: programmeId },
      expectedRevision: 1,
    }]);
  }

  await persistStrategyChangeRow(pool, seed.workspaceId, seed.actorId, opened.caseId, scenarioChange, {
    baseManifest: baseManifestV1,
    candidateSummaries: [
      { subjectRef: { kind: 'JOURNEY', id: j1 } },
      { subjectRef: { kind: 'JOURNEY', id: j2 } },
    ],
  });
  mustOk(await persistActionPlan(uow(), {
    workspaceId: seed.workspaceId,
    actorPrincipalId: seed.actorId,
    idempotencyKey: randomUUID(),
    plan,
    recoveryStrategyId: scenarioChange.recoveryStrategyId,
  }));

  await seedMinimalCurrentAssessment(pool, seed.workspaceId, { kind: 'JOURNEY', id: j1 }, EXEC_NOW);
  await seedMinimalCurrentAssessment(pool, seed.workspaceId, { kind: 'JOURNEY', id: j2 }, EXEC_NOW);
  for (const intent of plan.intents) {
    const scope = await loadRequiredAuthorityScopesOrFail(pool, seed.workspaceId, intent.id);
    await seedStoredExecutionAuthority({
      pool,
      workspaceId: seed.workspaceId,
      actorId: seed.actorId,
      principalId,
      planId: plan.id,
      intentId: intent.id,
      scope,
      representedPartyRef: { kind: 'TRAVELLER', id: t1.travellerId },
      requirementRole: 'CASE_OWNER',
      now: EXEC_NOW,
    });
  }

  return {
    pool, seed, uow, principalId, plan, programmeId, itemA, itemB, winA, winB,
  };
}

describe('M9 same-Programme sequential CHANGE_PROGRAMME_ITEM_TIME', () => {
  test('two ordered intents on the same Programme both succeed; action 2 sees post-action-1 revision', async () => {
    const ctx = await seedBilateralWorld();
    const { pool, seed, uow, principalId, plan, programmeId, itemA, itemB, winA, winB } = ctx;

    const resultA = await executeInternalProgrammeItemSchedule(pool, uow(), prepareParams({
      workspaceId: seed.workspaceId,
      actorId: seed.actorId,
      planId: plan.id,
      intentId: plan.intents[0]!.id,
      principalId,
      now: EXEC_NOW,
    }));
    assert.equal(resultA.ok, true, !resultA.ok ? JSON.stringify(resultA.conflict) : '');
    if (!resultA.ok) return;
    assert.equal(resultA.value.programmeRevision, 2);

    const observed = await pool.query<{ source_owned_fields: { programmeRevision: number } }>(
      `SELECT source_owned_fields FROM execution_observations
        WHERE workspace_id = $1 AND action_intent_id = $2`,
      [seed.workspaceId, plan.intents[0]!.id],
    );
    assert.equal(observed.rows[0]!.source_owned_fields.programmeRevision, 2,
      'action 1 observation must record the authoritative post-mutation Programme revision');

    const resultB = await executeInternalProgrammeItemSchedule(pool, uow(), prepareParams({
      workspaceId: seed.workspaceId,
      actorId: seed.actorId,
      planId: plan.id,
      intentId: plan.intents[1]!.id,
      principalId,
      now: EXEC_NOW,
    }));
    assert.equal(resultB.ok, true, !resultB.ok ? JSON.stringify(resultB.conflict) : '');
    if (!resultB.ok) return;
    assert.equal(resultB.value.programmeRevision, 3,
      'action 2 must CAS against the post-action-1 authoritative revision');

    const itemARow = await pool.query<{ window_start: Date }>(
      'SELECT window_start FROM programme_items WHERE workspace_id = $1 AND id = $2',
      [seed.workspaceId, itemA.programmeItemId],
    );
    const itemBRow = await pool.query<{ window_start: Date }>(
      'SELECT window_start FROM programme_items WHERE workspace_id = $1 AND id = $2',
      [seed.workspaceId, itemB.programmeItemId],
    );
    assert.equal(itemARow.rows[0]!.window_start.toISOString(), winB.start);
    assert.equal(itemBRow.rows[0]!.window_start.toISOString(), winA.start);

    const head = await pool.query<{ revision: string }>(
      'SELECT revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2',
      [seed.workspaceId, programmeId],
    );
    assert.equal(Number(head.rows[0]!.revision), 3);
  });

  test('external concurrent Programme mutation still rejects the stale second intent', async () => {
    const ctx = await seedBilateralWorld();
    const { pool, seed, uow, principalId, plan, programmeId, itemB, winA } = ctx;

    const resultA = await executeInternalProgrammeItemSchedule(pool, uow(), prepareParams({
      workspaceId: seed.workspaceId,
      actorId: seed.actorId,
      planId: plan.id,
      intentId: plan.intents[0]!.id,
      principalId,
      now: EXEC_NOW,
    }));
    assert.equal(resultA.ok, true, !resultA.ok ? JSON.stringify(resultA.conflict) : '');
    if (!resultA.ok) return;

    // External write advances the Programme past the rebased expected revision.
    mustOk(await updateProgrammeItemSchedule(uow(), {
      workspaceId: seed.workspaceId,
      actorPrincipalId: seed.actorId,
      idempotencyKey: randomUUID(),
      programmeId,
      programmeItemId: itemB.programmeItemId,
      expectedProgrammeRevision: 2,
      window: {
        start: '2031-09-10T16:00:00.000Z',
        end: '2031-09-10T16:30:00.000Z',
      },
    }));

    const resultB = await executeInternalProgrammeItemSchedule(pool, uow(), prepareParams({
      workspaceId: seed.workspaceId,
      actorId: seed.actorId,
      planId: plan.id,
      intentId: plan.intents[1]!.id,
      principalId,
      now: EXEC_NOW,
    }));
    assert.equal(resultB.ok, false, 'external concurrent advance must fail closed');
    if (resultB.ok) return;
    assert.match(
      `${resultB.conflict.kind} ${resultB.conflict.message}`,
      /STALE_BASE|STALE_AGGREGATE_REVISION/,
    );

    const itemBRow = await pool.query<{ window_start: Date }>(
      'SELECT window_start FROM programme_items WHERE workspace_id = $1 AND id = $2',
      [seed.workspaceId, itemB.programmeItemId],
    );
    assert.notEqual(itemBRow.rows[0]!.window_start.toISOString(), winA.start,
      'second plan action must not have applied after external mutation');
  });

  test('replay/retry of the first successful action does not duplicate the mutation', async () => {
    const ctx = await seedBilateralWorld();
    const { pool, seed, uow, principalId, plan, itemA, winB } = ctx;
    const firstParams = prepareParams({
      workspaceId: seed.workspaceId,
      actorId: seed.actorId,
      planId: plan.id,
      intentId: plan.intents[0]!.id,
      principalId,
      now: EXEC_NOW,
    });

    const first = await executeInternalProgrammeItemSchedule(pool, uow(), firstParams);
    assert.equal(first.ok, true, !first.ok ? JSON.stringify(first.conflict) : '');
    if (!first.ok) return;
    assert.equal(first.value.programmeRevision, 2);

    // A fresh outer idempotency key still hits the known-success guard on the
    // immutable logical operation identity — no second mutation.
    const replay = await executeInternalProgrammeItemSchedule(pool, uow(), prepareParams({
      workspaceId: seed.workspaceId,
      actorId: seed.actorId,
      planId: plan.id,
      intentId: plan.intents[0]!.id,
      principalId,
      now: EXEC_NOW,
    }));
    assert.equal(replay.ok, true, !replay.ok ? JSON.stringify(replay.conflict) : '');
    if (!replay.ok) return;
    assert.equal(replay.value.replayed, true);
    assert.equal(replay.value.attemptId, first.value.attemptId);

    const attempts = await pool.query<{ id: string }>(
      `SELECT id FROM execution_attempts
        WHERE workspace_id = $1 AND action_intent_id = $2 AND status = 'OBSERVED_SUCCESS'`,
      [seed.workspaceId, plan.intents[0]!.id],
    );
    assert.equal(attempts.rows.length, 1, 'replay must not create a second successful attempt');

    const itemARow = await pool.query<{ window_start: Date }>(
      'SELECT window_start FROM programme_items WHERE workspace_id = $1 AND id = $2',
      [seed.workspaceId, itemA.programmeItemId],
    );
    assert.equal(itemARow.rows[0]!.window_start.toISOString(), winB.start);

    const head = await pool.query<{ revision: string }>(
      'SELECT revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2',
      [seed.workspaceId, ctx.programmeId],
    );
    assert.equal(Number(head.rows[0]!.revision), 2, 'replay must not advance the Programme again');
  });
});

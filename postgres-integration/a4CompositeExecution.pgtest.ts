/**
 * A4 controlled four-action seam — pre-sandbox integration proof.
 *
 * Proves the existing generalized machinery can traverse one selected
 * multi-provider ActionPlan shape under controlled provider outcomes:
 *   transport replacement → first stay book → second stay book → displaced cancel
 *
 * Exercises: ActionPlan dependencies, authority, durable attempts, provider
 * observations, canonical applications, selected-plan continuation,
 * reassessment and resolution gating.
 *
 * No live Atlas / Nuitée calls. No scenario-specific place names.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import {
  beginSeed,
  commitSeed,
  seedJourney,
  seedTraveller,
  seedTrip,
} from './m3Seed.ts';
import {
  KnowledgeFixture,
  seedBooking,
  seedJurisdictionWithPlaces,
  seedService,
  seedTransportIntent,
} from './m6WorldSeed.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { createPrincipal } from '../src/persistence/postgres/commands/peopleCommands.ts';
import {
  openRecoveryCase,
  createPreparedExecutionAttempt,
  persistActionPlan,
} from '../src/persistence/postgres/commands/m8AuthorityCommands.ts';
import { updateJourneyItem } from '../src/persistence/postgres/commands/travelCommands.ts';
import { ScenarioChangeSchema } from '../src/contracts/v2/scenario/scenarioChange.ts';
import { evaluateRecoveryStrategy } from '../src/resolution/scenarios/evaluate.ts';
import { createM6Registry } from '../src/resolution/evaluation/registry.ts';
import { compileActionPlan } from '../src/resolution/planning/compiler.ts';
import { captureWorld } from '../src/persistence/postgres/world/pgCurrentState.ts';
import { PgExecutionWorker } from '../src/persistence/postgres/execution/pgExecutionWorker.ts';
import {
  createSelectedPlanContinuationCheckpoint,
  recordSelectedPlanCanonicalApplication,
} from '../src/persistence/postgres/execution/selectedPlanContinuation.ts';
import { evaluateRecoveryCaseResolution } from '../src/app/target/recoveryCaseResolution.ts';
import { resolveRecoveryCase } from '../src/persistence/postgres/commands/m9CaseResolutionCommands.ts';
import {
  bootstrapTestGrantIssuer,
  loadRequiredAuthorityScopesOrFail,
  mustOk,
  persistStrategyChangeRow,
  prepareParams,
  seedMinimalCurrentAssessment,
  seedStoredExecutionAuthority,
} from './m8ExecutionGateHelpers.ts';
import type { ActionPlan } from '../src/contracts/v2/action/actionPlan.ts';

const NOW = '2034-06-01T00:00:00.000Z';
const EXPIRES = '2034-06-02T00:00:00.000Z';

/** Four successive intended windows — residual ALTER effects stay evaluable. */
const WINDOWS = [
  { start: '2034-07-10T08:00:00.000Z', end: '2034-07-10T09:00:00.000Z' },
  { start: '2034-07-10T10:00:00.000Z', end: '2034-07-10T11:00:00.000Z' },
  { start: '2034-07-10T12:00:00.000Z', end: '2034-07-10T13:00:00.000Z' },
  { start: '2034-07-10T14:00:00.000Z', end: '2034-07-10T15:00:00.000Z' },
] as const;

const CAPABILITIES = [
  'external:offer.select',
  'external:stay.book',
  'external:stay.book',
  'external:stay.cancel',
] as const;

const NAMESPACES = [
  'provider:atlas-controlled',
  'provider:nuitee-controlled',
  'provider:nuitee-controlled',
  'provider:nuitee-controlled',
] as const;

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

async function setup() {
  const pool = await sharedTestPool();
  const seed = await beginSeed(pool, 'A4 controlled four-action seam');
  const traveller = await seedTraveller(seed, { displayName: 'Composite traveller' });
  const tripId = await seedTrip(seed, { lifecycleStatus: 'ACTIVE' });
  const journeyId = await seedJourney(seed, {
    tripId,
    travellerId: traveller.travellerId,
    lifecycleStatus: 'ACTIVE',
  });
  const otherTraveller = await seedTraveller(seed, { displayName: 'Unrelated composite traveller' });
  const otherTripId = await seedTrip(seed, { lifecycleStatus: 'ACTIVE' });
  const otherJourneyId = await seedJourney(seed, {
    tripId: otherTripId,
    travellerId: otherTraveller.travellerId,
    lifecycleStatus: 'ACTIVE',
  });
  const { jurisdictionId, placeIds } = await seedJurisdictionWithPlaces(seed, {
    name: 'A4 composite jurisdiction',
    places: [
      { name: 'A4 Composite Origin', placeType: 'AIRPORT' },
      { name: 'A4 Composite Destination', placeType: 'VENUE' },
    ],
  });
  const [originPlaceId, destinationPlaceId] = placeIds;
  assert.ok(originPlaceId && destinationPlaceId);
  const serviceId = await seedService(seed, {
    operator: 'A4 composite operator',
    originPlaceId,
    destinationPlaceId,
    published: { departure: '2034-07-10T05:00:00.000Z', arrival: '2034-07-10T06:00:00.000Z' },
  });
  const journeyItemId = await seedTransportIntent(seed, {
    journeyId,
    orderKey: '010',
    originPlaceId,
    destinationPlaceId,
    selectedServiceId: serviceId,
    window: { start: '2034-07-10T06:00:00.000Z', end: '2034-07-10T07:00:00.000Z' },
  });
  await seedBooking(seed, { travellerId: traveller.travellerId, serviceId, journeyItemId });
  const otherServiceId = await seedService(seed, {
    operator: 'A4 composite other operator',
    originPlaceId,
    destinationPlaceId,
    published: { departure: '2034-07-11T05:00:00.000Z', arrival: '2034-07-11T06:00:00.000Z' },
  });
  const otherItemId = await seedTransportIntent(seed, {
    journeyId: otherJourneyId,
    orderKey: '010',
    originPlaceId,
    destinationPlaceId,
    selectedServiceId: otherServiceId,
    window: { start: '2034-07-11T06:00:00.000Z', end: '2034-07-11T07:00:00.000Z' },
  });
  await seedBooking(seed, {
    travellerId: otherTraveller.travellerId,
    serviceId: otherServiceId,
    journeyItemId: otherItemId,
  });
  await commitSeed(seed);

  const knowledge = new KnowledgeFixture(pool, seed);
  for (const topic of ['ADVISORY', 'CONDITION', 'ENTRY_REQUIREMENT', 'TRANSIT_REQUIREMENT']) {
    await knowledge.coverage({ topic, completeness: 'COMPLETE', jurisdictionId });
  }

  const uow = () => new PgUnitOfWork(pool, seed.workspaceId);
  const principalId = randomUUID();
  mustOk(await createPrincipal(uow(), {
    workspaceId: seed.workspaceId,
    actorPrincipalId: seed.actorId,
    idempotencyKey: randomUUID(),
    principalId,
    actorType: 'HUMAN',
    authIssuer: 'https://issuer.invalid/a4-composite',
    authSubject: principalId,
  }));
  const opened = mustOk(await openRecoveryCase(uow(), {
    workspaceId: seed.workspaceId,
    actorPrincipalId: seed.actorId,
    idempotencyKey: randomUUID(),
    openedAt: NOW,
  }));
  await pool.query(
    `INSERT INTO case_subjects (workspace_id, recovery_case_id, subject_kind, subject_id, role)
     VALUES ($1, $2, 'JOURNEY', $3, 'affected')`,
    [seed.workspaceId, opened.caseId, journeyId],
  );

  const registry = createM6Registry();
  const captureFocus = [
    { kind: 'JOURNEY' as const, id: journeyId },
    { kind: 'JOURNEY' as const, id: otherJourneyId },
  ];
  const capture = () =>
    captureWorld(pool, {
      workspaceId: seed.workspaceId,
      focus: captureFocus,
      at: NOW,
      informationTopics: registry.informationTopics,
    });
  const baseWorld = await capture();
  const scenarioChange = ScenarioChangeSchema.parse({
    id: randomUUID(),
    recoveryStrategyId: randomUUID(),
    strategyVersion: 1,
    affectedSubjectRefs: [
      { kind: 'JOURNEY', id: journeyId },
      { kind: 'JOURNEY', id: otherJourneyId },
    ],
    basisAssessmentId: randomUUID(),
    effects: WINDOWS.map((proposedWindow) => ({
      effectKind: 'ALTER_JOURNEY_ITEM_INTENT' as const,
      journeyItemId,
      proposedWindow,
    })),
  });
  const evaluated = evaluateRecoveryStrategy({
    recoveryCaseId: opened.caseId,
    strategyId: scenarioChange.recoveryStrategyId,
    strategyVersion: 1,
    baseWorld,
    baseManifest: baseWorld.manifest,
    basisAssessmentId: scenarioChange.basisAssessmentId,
    scenarioChange,
    now: NOW,
    registry,
    resolveSubjectRefs: captureFocus,
  });
  assert.equal(evaluated.ok, true, JSON.stringify(evaluated));
  if (!evaluated.ok) throw new Error('strategy evaluation failed');
  assert.equal(evaluated.value.strategy.viability, 'VIABLE');

  const compiled = compileActionPlan({ strategy: evaluated.value.strategy, now: NOW });
  assert.equal(compiled.ok, true, !compiled.ok ? compiled.conflict.message : '');
  if (!compiled.ok) throw new Error('plan compilation failed');

  const compiledIntents = compiled.value.plan.intents;
  assert.equal(compiledIntents.length, 4);
  const planId = randomUUID();
  const intentIds = WINDOWS.map(() => randomUUID());
  const plan: ActionPlan = {
    id: planId,
    recoveryCaseId: opened.caseId,
    scenarioChangeId: scenarioChange.id,
    intents: compiledIntents.map((intent, index) => ({
      ...intent,
      id: intentIds[index]!,
      actionPlanId: planId,
      operationNamespace: NAMESPACES[index]!,
      logicalOperationKey: `a4-composite:${index}:${intentIds[index]}`,
      requestFingerprint: `${index}`.padStart(64, 'a'),
      capabilityRef: CAPABILITIES[index]!,
      expectedObservations: [`EXTERNAL_PROVIDER:a4-composite-${index}`],
      // Cost ceilings are out of scope for this controlled seam; keep budget-free.
      costEstimate: undefined,
      offerFingerprint: undefined,
    })),
    dependencies: [
      { fromActionIntentId: intentIds[0]!, toActionIntentId: intentIds[1]! },
      { fromActionIntentId: intentIds[1]!, toActionIntentId: intentIds[2]! },
      { fromActionIntentId: intentIds[2]!, toActionIntentId: intentIds[3]! },
    ],
  };

  await persistStrategyChangeRow(pool, seed.workspaceId, seed.actorId, opened.caseId, scenarioChange, {
    baseManifest: baseWorld.manifest,
    candidateSummaries: [{ subjectRef: { kind: 'JOURNEY', id: journeyId } }],
  });
  mustOk(await persistActionPlan(uow(), {
    workspaceId: seed.workspaceId,
    actorPrincipalId: seed.actorId,
    idempotencyKey: randomUUID(),
    plan,
    recoveryStrategyId: scenarioChange.recoveryStrategyId,
  }));

  // Trip remains FAIL until whole-trip reassessment after the final canonical apply.
  await seedMinimalCurrentAssessment(pool, seed.workspaceId, { kind: 'JOURNEY', id: journeyId }, NOW, {
    verdict: 'FAIL',
  });
  await seedMinimalCurrentAssessment(pool, seed.workspaceId, { kind: 'JOURNEY', id: otherJourneyId }, NOW);

  const scopes = await Promise.all(
    plan.intents.map((intent) => loadRequiredAuthorityScopesOrFail(pool, seed.workspaceId, intent.id)),
  );
  const issuerPrincipalId = await bootstrapTestGrantIssuer(
    pool,
    seed.workspaceId,
    seed.actorId,
    NOW,
    scopes.flat(),
  );
  for (let index = 0; index < plan.intents.length; index += 1) {
    await seedStoredExecutionAuthority({
      pool,
      workspaceId: seed.workspaceId,
      actorId: seed.actorId,
      principalId,
      planId: plan.id,
      intentId: plan.intents[index]!.id,
      scope: scopes[index]!,
      representedPartyRef: { kind: 'TRAVELLER', id: traveller.travellerId },
      requirementRole: 'CASE_OWNER',
      now: NOW,
      issuerPrincipalId,
    });
  }

  return {
    pool,
    seed,
    uow,
    principalId,
    caseId: opened.caseId,
    travellerId: traveller.travellerId,
    journeyId,
    otherJourneyId,
    itemId: journeyItemId,
    otherItemId,
    scenarioChange,
    plan,
    strategyId: scenarioChange.recoveryStrategyId,
    worker: new PgExecutionWorker(pool, { actorId: 'a4-composite-worker' }),
  };
}

type SetupCtx = Awaited<ReturnType<typeof setup>>;

async function prepare(ctx: SetupCtx, intentId: string, attemptNumber = 1) {
  return createPreparedExecutionAttempt(ctx.uow(), prepareParams({
    workspaceId: ctx.seed.workspaceId,
    actorId: ctx.seed.actorId,
    planId: ctx.plan.id,
    intentId,
    principalId: ctx.principalId,
    attemptNumber,
    now: NOW,
  }));
}

async function assertEligible(ctx: SetupCtx, intentId: string, label: string) {
  const outcome = await prepare(ctx, intentId);
  assert.equal(outcome.ok, true, `${label}: expected eligible — ${!outcome.ok ? outcome.conflict.message : ''}`);
  return mustOk(outcome);
}

async function assertBlocked(ctx: SetupCtx, intentId: string, label: string) {
  const outcome = await prepare(ctx, intentId);
  assert.equal(outcome.ok, false, `${label}: expected blocked`);
  if (!outcome.ok) {
    assert.match(
      outcome.conflict.message,
      /prerequisite intent .* has not completed|reconcile attempt|STALE_BASE/i,
      `${label}: unexpected refusal ${outcome.conflict.message}`,
    );
  }
}

async function dispatchControlled(
  ctx: SetupCtx,
  preparedAttemptId: string,
  intentId: string,
  outcome: 'SUCCESS' | 'UNKNOWN',
): Promise<{ attemptId: string; observationId?: string }> {
  const claim = await ctx.worker.claimNext(ctx.seed.workspaceId);
  assert.ok(claim, `attempt ${preparedAttemptId} not claimable`);
  assert.equal(claim.id, preparedAttemptId);
  assert.equal(claim.actionIntentId, intentId);

  const result = await ctx.worker.dispatchClaimed(claim, {
    principalId: ctx.principalId,
    now: NOW,
    observed: { capabilityKind: 'SERVICE', supported: true },
    dispatcher: async () => (outcome === 'SUCCESS'
      ? {
          kind: 'SUCCESS' as const,
          responseRef: `rsp-${intentId}`,
          sourceOwnedFields: { status: 'CONFIRMED', capability: CAPABILITIES[ctx.plan.intents.findIndex((i) => i.id === intentId)] },
        }
      : { kind: 'LOST_RESPONSE' as const, requestRef: `lost-${intentId}` }),
  });

  if (outcome === 'SUCCESS') {
    assert.equal(result.outcome, 'OBSERVED_SUCCESS', JSON.stringify(result));
    const observation = await ctx.pool.query<{ id: string }>(
      `SELECT id FROM execution_observations
        WHERE workspace_id = $1 AND attempt_id = $2 AND origin = 'EXTERNAL_PROVIDER'
        ORDER BY observed_at DESC LIMIT 1`,
      [ctx.seed.workspaceId, preparedAttemptId],
    );
    assert.ok(observation.rows[0]?.id, 'provider observation must be durable');
    return { attemptId: preparedAttemptId, observationId: observation.rows[0]!.id };
  }

  assert.equal(result.outcome, 'OUTCOME_UNKNOWN', JSON.stringify(result));
  return { attemptId: preparedAttemptId };
}

async function applyCanonical(
  ctx: SetupCtx,
  intentId: string,
  attemptId: string,
  observationId: string,
  windowIndex: number,
  expectedRevision: number,
) {
  const commandKey = randomUUID();
  const appliedOutcome = await updateJourneyItem(ctx.uow(), {
    workspaceId: ctx.seed.workspaceId,
    actorPrincipalId: ctx.seed.actorId,
    idempotencyKey: commandKey,
    journeyId: ctx.journeyId,
    journeyItemId: ctx.itemId,
    expectedRevision,
    intendedWindow: WINDOWS[windowIndex]!,
  });
  mustOk(appliedOutcome);
  if (!appliedOutcome.ok) throw new Error('canonical Journey command failed');
  assert.deepEqual(
    await recordSelectedPlanCanonicalApplication(ctx.pool, {
      workspaceId: ctx.seed.workspaceId,
      actorId: ctx.seed.actorId,
      attemptId,
      actionPlanId: ctx.plan.id,
      actionIntentId: intentId,
      commandNamespace: appliedOutcome.receipt.commandNamespace,
      idempotencyKey: commandKey,
      source: { kind: 'EXTERNAL_PROVIDER', observationId },
    }),
    { ok: true },
  );
  return expectedRevision + 1;
}

async function checkpoint(ctx: SetupCtx, nextIntentId: string) {
  return createSelectedPlanContinuationCheckpoint(ctx.pool, {
    workspaceId: ctx.seed.workspaceId,
    actorId: ctx.seed.actorId,
    actionPlanId: ctx.plan.id,
    nextActionIntentId: nextIntentId,
    sourceStrategyId: ctx.strategyId,
    now: NOW,
    expiresAt: EXPIRES,
  });
}

async function resolution(ctx: SetupCtx) {
  return evaluateRecoveryCaseResolution(ctx.pool, {
    workspaceId: ctx.seed.workspaceId,
    recoveryCaseId: ctx.caseId,
    now: NOW,
  });
}

describe('A4 controlled four-action execution seam', () => {
  test('happy path: gated progression through four controlled provider actions then reassessment unlocks resolution', async () => {
    const ctx = await setup();
    const [flight, stay1, stay2, cancel] = ctx.plan.intents;
    assert.ok(flight && stay1 && stay2 && cancel);
    assert.deepEqual(
      ctx.plan.intents.map((intent) => intent.capabilityRef),
      [...CAPABILITIES],
    );

    // Before action 1 — only flight is eligible.
    await assertBlocked(ctx, stay1.id, 'before action 1 / first stay');
    await assertBlocked(ctx, stay2.id, 'before action 1 / second stay');
    await assertBlocked(ctx, cancel.id, 'before action 1 / cancel');
    const flightPrepared = await assertEligible(ctx, flight.id, 'before action 1 / flight');
    const flightObserved = await dispatchControlled(ctx, flightPrepared.attemptId, flight.id, 'SUCCESS');
    assert.ok(flightObserved.observationId);

    // After provider flight success, before canonical — hotel successor blocked.
    await assertBlocked(ctx, stay1.id, 'after flight provider / before canonical');

    let journeyRevision = await applyCanonical(
      ctx,
      flight.id,
      flightObserved.attemptId,
      flightObserved.observationId!,
      0,
      1,
    );
    const afterFlightCheckpoint = await checkpoint(ctx, stay1.id);
    assert.equal(afterFlightCheckpoint.ok, true, !afterFlightCheckpoint.ok ? afterFlightCheckpoint.reason : '');

    // After flight canonical + viable continuation — first stay eligible.
    const stay1Prepared = await assertEligible(ctx, stay1.id, 'after flight canonical');
    await assertBlocked(ctx, stay2.id, 'after flight canonical / second stay still blocked');
    await assertBlocked(ctx, cancel.id, 'after flight canonical / cancel still blocked');

    const stay1Observed = await dispatchControlled(ctx, stay1Prepared.attemptId, stay1.id, 'SUCCESS');
    assert.ok(stay1Observed.observationId);
    await assertBlocked(ctx, stay2.id, 'after first stay provider / before canonical');

    journeyRevision = await applyCanonical(
      ctx,
      stay1.id,
      stay1Observed.attemptId,
      stay1Observed.observationId!,
      1,
      journeyRevision,
    );
    const afterStay1Checkpoint = await checkpoint(ctx, stay2.id);
    assert.equal(afterStay1Checkpoint.ok, true, !afterStay1Checkpoint.ok ? afterStay1Checkpoint.reason : '');

    // After first stay canonical + viable residual — second stay eligible.
    const stay2Prepared = await assertEligible(ctx, stay2.id, 'after first stay canonical');
    await assertBlocked(ctx, cancel.id, 'after first stay canonical / cancel still blocked');

    const stay2Observed = await dispatchControlled(ctx, stay2Prepared.attemptId, stay2.id, 'SUCCESS');
    assert.ok(stay2Observed.observationId);
    await assertBlocked(ctx, cancel.id, 'after second stay provider / before canonical');

    journeyRevision = await applyCanonical(
      ctx,
      stay2.id,
      stay2Observed.attemptId,
      stay2Observed.observationId!,
      2,
      journeyRevision,
    );
    const afterStay2Checkpoint = await checkpoint(ctx, cancel.id);
    assert.equal(afterStay2Checkpoint.ok, true, !afterStay2Checkpoint.ok ? afterStay2Checkpoint.reason : '');

    // After replacement destination stay canonical + viable residual — cancel eligible.
    const cancelPrepared = await assertEligible(ctx, cancel.id, 'after second stay canonical');

    const cancelObserved = await dispatchControlled(ctx, cancelPrepared.attemptId, cancel.id, 'SUCCESS');
    assert.ok(cancelObserved.observationId);

    // Provider success on the fourth action is not trip recovery.
    const beforeCanonicalResolution = await resolution(ctx);
    assert.equal(beforeCanonicalResolution.allowed, false, 'provider success alone must not resolve');
    if (!beforeCanonicalResolution.allowed) {
      assert.ok(
        ['BLOCKING_FAIL', 'ACTION_INTENT_NOT_COMPLETE'].includes(beforeCanonicalResolution.reason),
        beforeCanonicalResolution.reason,
      );
    }

    journeyRevision = await applyCanonical(
      ctx,
      cancel.id,
      cancelObserved.attemptId,
      cancelObserved.observationId!,
      3,
      journeyRevision,
    );

    // Canonical state reflects the selected recovery's final intended window.
    const item = await ctx.pool.query<{ intended_window_start: Date; intended_window_end: Date }>(
      `SELECT intended_window_start, intended_window_end FROM journey_items
        WHERE workspace_id = $1 AND id = $2`,
      [ctx.seed.workspaceId, ctx.itemId],
    );
    assert.equal(item.rows[0]!.intended_window_start.toISOString(), WINDOWS[3]!.start);
    assert.equal(item.rows[0]!.intended_window_end.toISOString(), WINDOWS[3]!.end);
    assert.equal(journeyRevision, 5);

    // All mandatory selected intents completed with durable observation + canonical bridge.
    for (const intent of ctx.plan.intents) {
      const row = await ctx.pool.query<{ status: string; applied: boolean }>(
        `SELECT ea.status,
                EXISTS (
                  SELECT 1 FROM selected_plan_canonical_applications a
                   WHERE a.workspace_id = ea.workspace_id AND a.attempt_id = ea.id
                ) AS applied
           FROM execution_attempts ea
          WHERE ea.workspace_id = $1 AND ea.action_intent_id = $2
          ORDER BY ea.created_at DESC LIMIT 1`,
        [ctx.seed.workspaceId, intent.id],
      );
      assert.equal(row.rows[0]?.status, 'OBSERVED_SUCCESS');
      assert.equal(row.rows[0]?.applied, true);
    }

    // Still FAIL until whole-trip reassessment — actions complete ≠ trip recovered.
    const beforeReassess = await resolution(ctx);
    assert.equal(beforeReassess.allowed, false);
    if (!beforeReassess.allowed) assert.equal(beforeReassess.reason, 'BLOCKING_FAIL');

    await seedMinimalCurrentAssessment(ctx.pool, ctx.seed.workspaceId, { kind: 'JOURNEY', id: ctx.journeyId }, NOW, {
      verdict: 'PASS',
    });

    const nowResolvable = await resolution(ctx);
    assert.equal(nowResolvable.allowed, true, nowResolvable.allowed ? '' : `${nowResolvable.reason}: ${nowResolvable.detail}`);
    mustOk(await resolveRecoveryCase(ctx.uow(), {
      workspaceId: ctx.seed.workspaceId,
      actorPrincipalId: ctx.seed.actorId,
      idempotencyKey: randomUUID(),
      recoveryCaseId: ctx.caseId,
      now: NOW,
    }));
  });

  test('hotel UNKNOWN outcome blocks successor, requires reconciliation, refuses redispatch', async () => {
    const ctx = await setup();
    const [flight, stay1, stay2] = ctx.plan.intents;
    assert.ok(flight && stay1 && stay2);

    const flightPrepared = mustOk(await prepare(ctx, flight.id));
    const flightObserved = await dispatchControlled(ctx, flightPrepared.attemptId, flight.id, 'SUCCESS');
    await applyCanonical(ctx, flight.id, flightObserved.attemptId, flightObserved.observationId!, 0, 1);
    assert.equal((await checkpoint(ctx, stay1.id)).ok, true);

    const stay1Prepared = mustOk(await prepare(ctx, stay1.id));
    await dispatchControlled(ctx, stay1Prepared.attemptId, stay1.id, 'UNKNOWN');

    await assertBlocked(ctx, stay2.id, 'UNKNOWN hotel outcome blocks successor');

    const redispatch = await prepare(ctx, stay1.id, 2);
    assert.equal(redispatch.ok, false, 'unknown outcome must not redispatch');
    if (!redispatch.ok) {
      assert.match(redispatch.conflict.message, /reconcile attempt/i);
    }

    const attempt = await ctx.pool.query<{ status: string }>(
      `SELECT status FROM execution_attempts WHERE workspace_id = $1 AND id = $2`,
      [ctx.seed.workspaceId, stay1Prepared.attemptId],
    );
    assert.equal(attempt.rows[0]?.status, 'OUTCOME_UNKNOWN');
  });

  test('unrelated Journey mutation between selected actions fails continuation closed', async () => {
    const ctx = await setup();
    const [flight, stay1] = ctx.plan.intents;
    assert.ok(flight && stay1);

    const flightPrepared = mustOk(await prepare(ctx, flight.id));
    const flightObserved = await dispatchControlled(ctx, flightPrepared.attemptId, flight.id, 'SUCCESS');
    await applyCanonical(ctx, flight.id, flightObserved.attemptId, flightObserved.observationId!, 0, 1);

    mustOk(await updateJourneyItem(ctx.uow(), {
      workspaceId: ctx.seed.workspaceId,
      actorPrincipalId: ctx.seed.actorId,
      idempotencyKey: randomUUID(),
      journeyId: ctx.otherJourneyId,
      journeyItemId: ctx.otherItemId,
      expectedRevision: 1,
      intendedWindow: { start: '2034-07-11T10:00:00.000Z', end: '2034-07-11T11:00:00.000Z' },
    }));

    const refused = await checkpoint(ctx, stay1.id);
    assert.deepEqual(refused, { ok: false, reason: 'UNACCOUNTED_BASE_REVISION_CHANGE' });
    await assertBlocked(ctx, stay1.id, 'unrelated mutation blocks successor prepare');
  });
});

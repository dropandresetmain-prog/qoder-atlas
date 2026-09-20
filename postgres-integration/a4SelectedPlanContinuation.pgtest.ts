/**
 * A4 selected-plan continuation against the real PostgreSQL command ledger.
 *
 * Root-owned checkpoints (`createSelectedPlanContinuationCheckpoint`) derive
 * residual RC-6, revision accounting and prerequisites from durable rows.
 * External prerequisites require observation → canonical application before the
 * next intent may prepare.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import {
  beginSeed,
  commitSeed,
  seedJourney,
  seedOrganisation,
  seedTraveller,
  seedTrip,
  takeSeedEvidence,
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
  transitionExecutionAttempt,
  persistActionPlan,
} from '../src/persistence/postgres/commands/m8AuthorityCommands.ts';
import { updateJourneyItem } from '../src/persistence/postgres/commands/travelCommands.ts';
import { recordInformationRecord, ingestInformationVersion } from '../src/persistence/postgres/commands/knowledgeCommands.ts';
import { ScenarioChangeSchema } from '../src/contracts/v2/scenario/scenarioChange.ts';
import { evaluateRecoveryStrategy } from '../src/resolution/scenarios/evaluate.ts';
import { createM6Registry } from '../src/resolution/evaluation/registry.ts';
import { compileActionPlan } from '../src/resolution/planning/compiler.ts';
import { captureWorld } from '../src/persistence/postgres/world/pgCurrentState.ts';
import { evaluateStoredExecutionGate } from '../src/persistence/postgres/execution/storedExecutionGate.ts';
import {
  createSelectedPlanContinuationCheckpoint,
  recordSelectedPlanCanonicalApplication,
} from '../src/persistence/postgres/execution/selectedPlanContinuation.ts';
import {
  bootstrapTestGrantIssuer,
  loadRequiredAuthorityScopesOrFail,
  mustOk,
  persistStrategyChangeRow,
  seedMinimalCurrentAssessment,
  seedStoredExecutionAuthority,
} from './m8ExecutionGateHelpers.ts';
import type { ActionPlan } from '../src/contracts/v2/action/actionPlan.ts';

const NOW = '2032-02-01T00:00:00.000Z';
const EXPIRES = '2032-02-02T00:00:00.000Z';
const EXPIRED = '2032-01-31T23:59:59.000Z';

const DEFAULT_FIRST_WINDOW = { start: '2032-03-05T10:00:00.000Z', end: '2032-03-05T11:00:00.000Z' };
const DEFAULT_SECOND_WINDOW = { start: '2032-03-05T12:00:00.000Z', end: '2032-03-05T13:00:00.000Z' };
const ALT_FIRST_WINDOW = { start: '2032-04-10T14:00:00.000Z', end: '2032-04-10T15:00:00.000Z' };
const ALT_SECOND_WINDOW = { start: '2032-04-10T16:00:00.000Z', end: '2032-04-10T17:00:00.000Z' };

type WindowPair = { first: { start: string; end: string }; second: { start: string; end: string } };

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

async function transitionTo(
  pool: Awaited<ReturnType<typeof sharedTestPool>>,
  workspaceId: string,
  attemptId: string,
  terminal: 'OBSERVED_SUCCESS' | 'OUTCOME_UNKNOWN',
) {
  for (const [from, to] of [
    ['PREPARED', 'CLAIMED'],
    ['CLAIMED', 'DISPATCHING'],
    ['DISPATCHING', 'DISPATCHED'],
    ['DISPATCHED', terminal],
  ] as const) {
    assert.equal(await transitionExecutionAttempt(pool, { workspaceId, attemptId, from, to }), 'APPLIED');
  }
}

async function setup(windows: WindowPair = { first: DEFAULT_FIRST_WINDOW, second: DEFAULT_SECOND_WINDOW }) {
  const pool = await sharedTestPool();
  const seed = await beginSeed(pool, 'A4 selected-plan continuation');
  const traveller = await seedTraveller(seed, { displayName: 'Continuation traveller' });
  const tripId = await seedTrip(seed, { lifecycleStatus: 'ACTIVE' });
  const journeyId = await seedJourney(seed, { tripId, travellerId: traveller.travellerId, lifecycleStatus: 'ACTIVE' });
  const otherTraveller = await seedTraveller(seed, { displayName: 'Unrelated continuation traveller' });
  const otherTripId = await seedTrip(seed, { lifecycleStatus: 'ACTIVE' });
  const otherJourneyId = await seedJourney(seed, {
    tripId: otherTripId,
    travellerId: otherTraveller.travellerId,
    lifecycleStatus: 'ACTIVE',
  });
  const { jurisdictionId, placeIds } = await seedJurisdictionWithPlaces(seed, {
    name: 'A4 continuation jurisdiction',
    places: [
      { name: 'A4 Origin', placeType: 'AIRPORT' },
      { name: 'A4 Destination', placeType: 'VENUE' },
    ],
  });
  const [originPlaceId, destinationPlaceId] = placeIds;
  assert.ok(originPlaceId && destinationPlaceId, 'jurisdiction places required');
  const serviceId = await seedService(seed, {
    operator: 'A4 continuation operator',
    originPlaceId,
    destinationPlaceId,
    published: { departure: '2032-03-05T07:00:00.000Z', arrival: '2032-03-05T08:00:00.000Z' },
  });
  const journeyItemId = await seedTransportIntent(seed, {
    journeyId,
    orderKey: '010',
    originPlaceId,
    destinationPlaceId,
    selectedServiceId: serviceId,
    window: { start: '2032-03-05T08:00:00.000Z', end: '2032-03-05T09:00:00.000Z' },
  });
  await seedBooking(seed, { travellerId: traveller.travellerId, serviceId, journeyItemId });
  const otherServiceId = await seedService(seed, {
    operator: 'A4 continuation other operator',
    originPlaceId,
    destinationPlaceId,
    published: { departure: '2032-03-06T07:00:00.000Z', arrival: '2032-03-06T08:00:00.000Z' },
  });
  const otherItemId = await seedTransportIntent(seed, {
    journeyId: otherJourneyId,
    orderKey: '010',
    originPlaceId,
    destinationPlaceId,
    selectedServiceId: otherServiceId,
    window: { start: '2032-03-06T08:00:00.000Z', end: '2032-03-06T09:00:00.000Z' },
  });
  await seedBooking(seed, {
    travellerId: otherTraveller.travellerId,
    serviceId: otherServiceId,
    journeyItemId: otherItemId,
  });
  const publisherOrganisationId = await seedOrganisation(seed);
  const legalEvidenceId = takeSeedEvidence(seed);
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
    authIssuer: 'https://issuer.invalid/a4-continuation',
    authSubject: principalId,
  }));
  const opened = mustOk(await openRecoveryCase(uow(), {
    workspaceId: seed.workspaceId,
    actorPrincipalId: seed.actorId,
    idempotencyKey: randomUUID(),
    openedAt: NOW,
  }));
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
    affectedSubjectRefs: [{ kind: 'JOURNEY', id: journeyId }, { kind: 'JOURNEY', id: otherJourneyId }],
    basisAssessmentId: randomUUID(),
    effects: [
      {
        effectKind: 'ALTER_JOURNEY_ITEM_INTENT',
        journeyItemId,
        proposedWindow: windows.first,
      },
      {
        effectKind: 'ALTER_JOURNEY_ITEM_INTENT',
        journeyItemId,
        proposedWindow: windows.second,
      },
    ],
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
    resolveSubjectRefs: [{ kind: 'JOURNEY', id: journeyId }, { kind: 'JOURNEY', id: otherJourneyId }],
  });
  assert.equal(evaluated.ok, true, JSON.stringify(evaluated));
  if (!evaluated.ok) throw new Error('source strategy evaluation failed');
  assert.equal(evaluated.value.strategy.viability, 'VIABLE', JSON.stringify(evaluated.value.viabilityDecisions));
  const compiled = compileActionPlan({ strategy: evaluated.value.strategy, now: NOW });
  assert.equal(compiled.ok, true, !compiled.ok ? compiled.conflict.message : '');
  if (!compiled.ok) throw new Error('plan compilation failed');
  const plan = {
    ...compiled.value.plan,
    dependencies: [
      {
        fromActionIntentId: compiled.value.plan.intents[0]!.id,
        toActionIntentId: compiled.value.plan.intents[1]!.id,
      },
    ],
  };
  await persistStrategyChangeRow(pool, seed.workspaceId, seed.actorId, opened.caseId, scenarioChange, {
    baseManifest: baseWorld.manifest,
    candidateSummaries: [{ subjectRef: { kind: 'JOURNEY', id: journeyId } }],
  });
  mustOk(
    await persistActionPlan(uow(), {
      workspaceId: seed.workspaceId,
      actorPrincipalId: seed.actorId,
      idempotencyKey: randomUUID(),
      plan,
      recoveryStrategyId: scenarioChange.recoveryStrategyId,
    }),
  );
  await seedMinimalCurrentAssessment(pool, seed.workspaceId, { kind: 'JOURNEY', id: journeyId }, NOW);
  await seedMinimalCurrentAssessment(pool, seed.workspaceId, { kind: 'JOURNEY', id: otherJourneyId }, NOW);
  const scopes = await Promise.all(
    plan.intents.map((intent) => loadRequiredAuthorityScopesOrFail(pool, seed.workspaceId, intent.id)),
  );
  const issuerPrincipalId = await bootstrapTestGrantIssuer(pool, seed.workspaceId, seed.actorId, NOW, scopes.flat());
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
    issuerPrincipalId,
    travellerId: traveller.travellerId,
    journeyId,
    otherJourneyId,
    itemId: journeyItemId,
    otherItemId,
    publisherOrganisationId,
    legalEvidenceId,
    registry,
    capture,
    baseWorld,
    scenarioChange,
    plan,
    windows,
  };
}

type SetupCtx = Awaited<ReturnType<typeof setup>>;

async function persistExternalDependencyPlan(ctx: SetupCtx): Promise<ActionPlan> {
  const planId = randomUUID();
  const firstId = randomUUID();
  const secondId = randomUUID();
  const plan: ActionPlan = {
    ...ctx.plan,
    id: planId,
    intents: ctx.plan.intents.map((intent, index) => ({
      ...intent,
      id: index === 0 ? firstId : secondId,
      actionPlanId: planId,
      operationNamespace: 'provider:a4-continuation-fixture',
      logicalOperationKey: `a4-external-${index}-${randomUUID()}`,
      requestFingerprint: `${index}`.padStart(64, '0'),
      capabilityRef: 'external:continuation-fixture',
      expectedObservations: ['EXTERNAL_PROVIDER:continuation-fixture'],
    })),
    dependencies: [{ fromActionIntentId: firstId, toActionIntentId: secondId }],
  };
  mustOk(
    await persistActionPlan(ctx.uow(), {
      workspaceId: ctx.seed.workspaceId,
      actorPrincipalId: ctx.seed.actorId,
      idempotencyKey: randomUUID(),
      plan,
      recoveryStrategyId: ctx.scenarioChange.recoveryStrategyId,
      planVersion: 2,
    }),
  );
  for (const intent of plan.intents) {
    await seedStoredExecutionAuthority({
      pool: ctx.pool,
      workspaceId: ctx.seed.workspaceId,
      actorId: ctx.seed.actorId,
      principalId: ctx.principalId,
      planId,
      intentId: intent.id,
      scope: await loadRequiredAuthorityScopesOrFail(ctx.pool, ctx.seed.workspaceId, intent.id),
      representedPartyRef: { kind: 'TRAVELLER', id: ctx.travellerId },
      requirementRole: 'CASE_OWNER',
      now: NOW,
      issuerPrincipalId: ctx.issuerPrincipalId,
    });
  }
  return plan;
}

async function prepareAttempt(
  ctx: SetupCtx,
  plan: ActionPlan,
  intentId: string,
  attemptNumber = 1,
) {
  return createPreparedExecutionAttempt(ctx.uow(), {
    workspaceId: ctx.seed.workspaceId,
    actorPrincipalId: ctx.seed.actorId,
    idempotencyKey: randomUUID(),
    planId: plan.id,
    intentId,
    attemptNumber,
    principalId: ctx.principalId,
    now: NOW,
  });
}

async function applyFirstJourneyEffect(
  ctx: SetupCtx,
  plan: ActionPlan,
  intentId: string,
  attemptId: string,
  source: { kind: 'INTERNAL_COMMAND' } | { kind: 'EXTERNAL_PROVIDER'; observationId: string },
  proposedWindow: { start: string; end: string },
) {
  const commandKey = randomUUID();
  const appliedOutcome = await updateJourneyItem(ctx.uow(), {
    workspaceId: ctx.seed.workspaceId,
    actorPrincipalId: ctx.seed.actorId,
    idempotencyKey: commandKey,
    journeyId: ctx.journeyId,
    journeyItemId: ctx.itemId,
    expectedRevision: 1,
    intendedWindow: proposedWindow,
  });
  const applied = mustOk(appliedOutcome);
  if (!appliedOutcome.ok) throw new Error('canonical Journey command failed');
  assert.deepEqual(
    await recordSelectedPlanCanonicalApplication(ctx.pool, {
      workspaceId: ctx.seed.workspaceId,
      actorId: ctx.seed.actorId,
      attemptId,
      actionPlanId: plan.id,
      actionIntentId: intentId,
      commandNamespace: appliedOutcome.receipt.commandNamespace,
      idempotencyKey: commandKey,
      source,
    }),
    { ok: true },
  );
  return { applied, receipt: appliedOutcome.receipt, commandKey, appliedOutcome };
}

async function observeExternalSuccess(
  ctx: SetupCtx,
  attemptId: string,
  intentId: string,
  terminal: 'OBSERVED_SUCCESS' | 'OUTCOME_UNKNOWN' = 'OBSERVED_SUCCESS',
): Promise<{ observationId?: string }> {
  const { pool, seed } = ctx;
  for (const [from, to] of [
    ['PREPARED', 'CLAIMED'],
    ['CLAIMED', 'DISPATCHING'],
    ['DISPATCHING', 'DISPATCHED'],
  ] as const) {
    assert.equal(
      await transitionExecutionAttempt(pool, { workspaceId: seed.workspaceId, attemptId, from, to }),
      'APPLIED',
    );
  }
  if (terminal === 'OUTCOME_UNKNOWN') {
    assert.equal(
      await transitionExecutionAttempt(pool, {
        workspaceId: seed.workspaceId,
        attemptId,
        from: 'DISPATCHED',
        to: 'OUTCOME_UNKNOWN',
      }),
      'APPLIED',
    );
    return {};
  }
  const observationId = randomUUID();
  await pool.query(
    `INSERT INTO execution_observations (
       workspace_id, id, attempt_id, action_intent_id, origin, external_record_id,
       source_owned_fields, observed_at, owned_subject_refs, created_by_actor_id
     ) VALUES ($1,$2,$3,$4,'EXTERNAL_PROVIDER',$5,'{}'::jsonb,$6,'[]'::jsonb,$7)`,
    [seed.workspaceId, observationId, attemptId, intentId, randomUUID(), NOW, seed.actorId],
  );
  assert.equal(
    await transitionExecutionAttempt(pool, {
      workspaceId: seed.workspaceId,
      attemptId,
      from: 'DISPATCHED',
      to: 'OBSERVED_SUCCESS',
    }),
    'APPLIED',
  );
  return { observationId };
}

async function prepareAndApplyInternalFirst(
  ctx: SetupCtx,
  terminal: 'OBSERVED_SUCCESS' | 'OUTCOME_UNKNOWN' = 'OBSERVED_SUCCESS',
) {
  const first = ctx.plan.intents[0]!;
  const prepared = mustOk(await prepareAttempt(ctx, ctx.plan, first.id));
  const applied = await applyFirstJourneyEffect(
    ctx,
    ctx.plan,
    first.id,
    prepared.attemptId,
    { kind: 'INTERNAL_COMMAND' },
    ctx.windows.first,
  );
  await transitionTo(ctx.pool, ctx.seed.workspaceId, prepared.attemptId, terminal);
  return { first, prepared, ...applied };
}

async function createCheckpoint(
  ctx: SetupCtx,
  plan: ActionPlan,
  nextActionIntentId: string,
  expiresAt = EXPIRES,
) {
  return createSelectedPlanContinuationCheckpoint(ctx.pool, {
    workspaceId: ctx.seed.workspaceId,
    actorId: ctx.seed.actorId,
    actionPlanId: plan.id,
    nextActionIntentId,
    sourceStrategyId: ctx.scenarioChange.recoveryStrategyId,
    now: NOW,
    expiresAt,
  });
}

describe('A4 selected-plan continuation checkpoint', () => {
  test('internal prerequisite: checkpoint after canonical Journey mutation allows the successor gate', async () => {
    const ctx = await setup();
    const applied = await prepareAndApplyInternalFirst(ctx);
    const checkpoint = await createCheckpoint(ctx, ctx.plan, ctx.plan.intents[1]!.id);
    assert.equal(checkpoint.ok, true, !checkpoint.ok ? checkpoint.reason : '');
    const gate = await evaluateStoredExecutionGate(ctx.pool, {
      workspaceId: ctx.seed.workspaceId,
      intentId: ctx.plan.intents[1]!.id,
      principalId: ctx.principalId,
      now: NOW,
    });
    assert.equal(gate.allowed, true, !gate.allowed ? `${gate.reason}: ${gate.detail ?? ''}` : '');
  });

  test('external OBSERVED_SUCCESS without canonical application blocks successor prepare', async () => {
    const ctx = await setup();
    const externalPlan = await persistExternalDependencyPlan(ctx);
    const first = externalPlan.intents[0]!;
    const second = externalPlan.intents[1]!;
    const prepared = mustOk(await prepareAttempt(ctx, externalPlan, first.id));
    await observeExternalSuccess(ctx, prepared.attemptId, first.id);
    const blocked = await prepareAttempt(ctx, externalPlan, second.id);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) {
      assert.match(blocked.conflict.message, /prerequisite intent .* has not completed/);
    }
  });

  test('external success with observation, canonical receipt and checkpoint allows gate and prepare', async () => {
    const ctx = await setup();
    const externalPlan = await persistExternalDependencyPlan(ctx);
    const first = externalPlan.intents[0]!;
    const second = externalPlan.intents[1]!;
    const prepared = mustOk(await prepareAttempt(ctx, externalPlan, first.id));
    const observed = await observeExternalSuccess(ctx, prepared.attemptId, first.id);
    assert.ok(observed.observationId);
    await applyFirstJourneyEffect(
      ctx,
      externalPlan,
      first.id,
      prepared.attemptId,
      { kind: 'EXTERNAL_PROVIDER', observationId: observed.observationId! },
      ctx.windows.first,
    );
    const checkpoint = await createCheckpoint(ctx, externalPlan, second.id);
    assert.equal(checkpoint.ok, true, !checkpoint.ok ? checkpoint.reason : '');
    const gate = await evaluateStoredExecutionGate(ctx.pool, {
      workspaceId: ctx.seed.workspaceId,
      intentId: second.id,
      principalId: ctx.principalId,
      now: NOW,
    });
    assert.equal(gate.allowed, true, !gate.allowed ? `${gate.reason}: ${gate.detail ?? ''}` : '');
    mustOk(await prepareAttempt(ctx, externalPlan, second.id));
  });

  test('unrelated captured Journey mutation refuses checkpoint with UNACCOUNTED_BASE_REVISION_CHANGE', async () => {
    const ctx = await setup();
    const applied = await prepareAndApplyInternalFirst(ctx);
    mustOk(
      await updateJourneyItem(ctx.uow(), {
        workspaceId: ctx.seed.workspaceId,
        actorPrincipalId: ctx.seed.actorId,
        idempotencyKey: randomUUID(),
        journeyId: ctx.otherJourneyId,
        journeyItemId: ctx.otherItemId,
        expectedRevision: 1,
        intendedWindow: { start: '2032-03-06T10:00:00.000Z', end: '2032-03-06T11:00:00.000Z' },
      }),
    );
    const checkpoint = await createCheckpoint(ctx, ctx.plan, ctx.plan.intents[1]!.id);
    assert.deepEqual(checkpoint, { ok: false, reason: 'UNACCOUNTED_BASE_REVISION_CHANGE' });
    void applied;
  });

  test('OUTCOME_UNKNOWN prerequisite refuses checkpoint and blocks a second prepare for the same intent', async () => {
    const ctx = await setup();
    const applied = await prepareAndApplyInternalFirst(ctx, 'OUTCOME_UNKNOWN');
    const checkpoint = await createCheckpoint(ctx, ctx.plan, ctx.plan.intents[1]!.id);
    assert.deepEqual(checkpoint, { ok: false, reason: 'STORED_PLAN_RESIDUAL_MISMATCH' });
    const retry = await prepareAttempt(ctx, ctx.plan, applied.first.id, 2);
    assert.equal(retry.ok, false);
    if (!retry.ok) {
      assert.ok(
        /reconcile attempt/.test(retry.conflict.message) || retry.conflict.message.startsWith('STALE_BASE'),
        retry.conflict.message,
      );
    }
    const blockedSuccessor = await prepareAttempt(ctx, ctx.plan, ctx.plan.intents[1]!.id);
    assert.equal(blockedSuccessor.ok, false);
  });

  test('canonical application guards reject wrong plan id and internal intent with EXTERNAL_PROVIDER source', async () => {
    const ctx = await setup();
    const applied = await prepareAndApplyInternalFirst(ctx);
    const wrongPlan = await recordSelectedPlanCanonicalApplication(ctx.pool, {
      workspaceId: ctx.seed.workspaceId,
      actorId: ctx.seed.actorId,
      attemptId: applied.prepared.attemptId,
      actionPlanId: randomUUID(),
      actionIntentId: applied.first.id,
      commandNamespace: applied.receipt.commandNamespace,
      idempotencyKey: applied.commandKey,
      source: { kind: 'INTERNAL_COMMAND' },
    });
    assert.deepEqual(wrongPlan, { ok: false, reason: 'CANONICAL_APPLICATION_ATTEMPT_MISMATCH' });
    const wrongSource = await recordSelectedPlanCanonicalApplication(ctx.pool, {
      workspaceId: ctx.seed.workspaceId,
      actorId: ctx.seed.actorId,
      attemptId: applied.prepared.attemptId,
      actionPlanId: ctx.plan.id,
      actionIntentId: applied.first.id,
      commandNamespace: applied.receipt.commandNamespace,
      idempotencyKey: randomUUID(),
      source: { kind: 'EXTERNAL_PROVIDER', observationId: randomUUID() },
    });
    assert.deepEqual(wrongSource, { ok: false, reason: 'CANONICAL_APPLICATION_SOURCE_KIND_MISMATCH' });
  });

  test('expired checkpoint is not consumed; fresh replacement works; wrong next intent is rejected', async () => {
    const ctx = await setup();
    const applied = await prepareAndApplyInternalFirst(ctx);
    const nextIntentId = ctx.plan.intents[1]!.id;
    const expired = await createCheckpoint(ctx, ctx.plan, nextIntentId, EXPIRED);
    assert.equal(expired.ok, true, !expired.ok ? expired.reason : '');
    const staleGate = await evaluateStoredExecutionGate(ctx.pool, {
      workspaceId: ctx.seed.workspaceId,
      intentId: nextIntentId,
      principalId: ctx.principalId,
      now: NOW,
    });
    assert.equal(staleGate.allowed, false);
    if (!staleGate.allowed) assert.equal(staleGate.reason, 'STALE_BASE');
    const refreshed = await createCheckpoint(ctx, ctx.plan, nextIntentId);
    assert.equal(refreshed.ok, true, !refreshed.ok ? refreshed.reason : '');
    const allowedGate = await evaluateStoredExecutionGate(ctx.pool, {
      workspaceId: ctx.seed.workspaceId,
      intentId: nextIntentId,
      principalId: ctx.principalId,
      now: NOW,
    });
    assert.equal(allowedGate.allowed, true, !allowedGate.allowed ? `${allowedGate.reason}: ${allowedGate.detail ?? ''}` : '');
    const wrongNext = await createCheckpoint(ctx, ctx.plan, ctx.plan.intents[0]!.id);
    assert.deepEqual(wrongNext, { ok: false, reason: 'STORED_PLAN_RESIDUAL_MISMATCH' });
    const rows = await ctx.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM selected_plan_continuation_checkpoints
        WHERE workspace_id = $1 AND action_plan_id = $2 AND next_action_intent_id = $3`,
      [ctx.seed.workspaceId, ctx.plan.id, nextIntentId],
    );
    assert.equal(rows.rows[0]!.count, '2');
    void applied;
  });

  test('entry terms arriving after checkpoint invalidate the gate with STALE_BASE', async () => {
    const ctx = await setup();
    const applied = await prepareAndApplyInternalFirst(ctx);
    const checkpoint = await createCheckpoint(ctx, ctx.plan, ctx.plan.intents[1]!.id);
    assert.equal(checkpoint.ok, true, !checkpoint.ok ? checkpoint.reason : '');
    const informationRecordId = randomUUID();
    mustOk(
      await recordInformationRecord(ctx.uow(), {
        workspaceId: ctx.seed.workspaceId,
        actorPrincipalId: ctx.seed.actorId,
        idempotencyKey: randomUUID(),
        informationRecordId,
        publisherOrganisationId: ctx.publisherOrganisationId,
        externalPublicationKey: `entry-terms:${informationRecordId}`,
        topic: 'ENTRY_REQUIREMENT',
        sourceConnectionIdentity: 'fixture:legal-terms',
      }),
    );
    mustOk(
      await ingestInformationVersion(ctx.uow(), {
        workspaceId: ctx.seed.workspaceId,
        actorPrincipalId: ctx.seed.actorId,
        idempotencyKey: randomUUID(),
        informationRecordId,
        subtype: 'ADVISORY',
        externalEditionSequence: 1,
        issuedAt: NOW,
        receivedAt: NOW,
        observedAt: NOW,
        evidenceId: ctx.legalEvidenceId,
        normalizationVersion: 'a4-continuation/1',
        payloadHash: 'e'.repeat(64),
        expectedRevision: 1,
        detail: {
          sourceNativeSeverity: 'ENTRY_TERMS_CHANGED',
          riskTopics: ['entry'],
          publisherMeanings: [],
          detailSchemaVersion: 'a4-continuation/1',
        },
      }),
    );
    const gate = await evaluateStoredExecutionGate(ctx.pool, {
      workspaceId: ctx.seed.workspaceId,
      intentId: ctx.plan.intents[1]!.id,
      principalId: ctx.principalId,
      now: NOW,
    });
    assert.equal(gate.allowed, false);
    if (!gate.allowed) assert.equal(gate.reason, 'STALE_BASE');
    void applied;
  });

  test('second synthetic window shape still creates and consumes a checkpoint through the shared helpers', async () => {
    const ctx = await setup({ first: ALT_FIRST_WINDOW, second: ALT_SECOND_WINDOW });
    const applied = await prepareAndApplyInternalFirst(ctx);
    const checkpoint = await createCheckpoint(ctx, ctx.plan, ctx.plan.intents[1]!.id);
    assert.equal(checkpoint.ok, true, !checkpoint.ok ? checkpoint.reason : '');
    const gate = await evaluateStoredExecutionGate(ctx.pool, {
      workspaceId: ctx.seed.workspaceId,
      intentId: ctx.plan.intents[1]!.id,
      principalId: ctx.principalId,
      now: NOW,
    });
    assert.equal(gate.allowed, true, !gate.allowed ? `${gate.reason}: ${gate.detail ?? ''}` : '');
    void applied;
  });
});

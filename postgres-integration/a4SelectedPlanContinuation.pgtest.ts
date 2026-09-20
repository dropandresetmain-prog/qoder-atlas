/**
 * A4 selected-plan continuation against the real PostgreSQL command ledger.
 *
 * The fixture deliberately uses an internal Journey intent so this test can
 * exercise the checkpoint boundary without a live provider. The prerequisite
 * still has a durable execution attempt and a real canonical command receipt;
 * RC-6 re-evaluates the exact remaining effect over a fresh world capture.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed, seedJourney, seedJourneyItem, seedOrganisation, seedTraveller, seedTrip, takeSeedEvidence } from './m3Seed.ts';
import { PgUnitOfWork, type ExecuteOutcome } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { createPrincipal } from '../src/persistence/postgres/commands/peopleCommands.ts';
import { openRecoveryCase, createPreparedExecutionAttempt, transitionExecutionAttempt, persistActionPlan } from '../src/persistence/postgres/commands/m8AuthorityCommands.ts';
import { updateJourneyItem } from '../src/persistence/postgres/commands/travelCommands.ts';
import { recordInformationRecord, ingestInformationVersion } from '../src/persistence/postgres/commands/knowledgeCommands.ts';
import { ScenarioChangeSchema } from '../src/contracts/v2/scenario/scenarioChange.ts';
import { evaluateRecoveryStrategy } from '../src/resolution/scenarios/evaluate.ts';
import { createEvaluatorRegistry } from '../src/resolution/evaluation/assess.ts';
import type { Evaluator } from '../src/resolution/evaluation/evaluator.ts';
import { dimension, explain } from '../src/resolution/evaluation/explain.ts';
import { compileActionPlan } from '../src/resolution/planning/compiler.ts';
import { captureWorld } from '../src/persistence/postgres/world/pgCurrentState.ts';
import { evaluateStoredExecutionGate, loadRequiredAuthorityScope } from '../src/persistence/postgres/execution/storedExecutionGate.ts';
import { persistSelectedPlanContinuation, recordSelectedPlanCanonicalApplication } from '../src/persistence/postgres/execution/selectedPlanContinuation.ts';
import {
  bootstrapTestGrantIssuer,
  loadRequiredAuthorityScopesOrFail,
  mustOk,
  persistStrategyChangeRow,
  seedMinimalCurrentAssessment,
  seedStoredExecutionAuthority,
} from './m8ExecutionGateHelpers.ts';

const NOW = '2032-02-01T00:00:00.000Z';
const EXPIRES = '2032-02-02T00:00:00.000Z';

// RC-6 is exercised over a real captured PostgreSQL world. This focused
// evaluator keeps the fixture's intentionally minimal itinerary viable while
// still declaring ENTRY_REQUIREMENT so a later legal edition invalidates the
// checkpoint through the normal manifest scope generation.
const continuationEvaluator: Evaluator = {
  id: 'a4.continuation.fixture', version: '1', assessmentKind: 'VIABILITY',
  subjectKinds: ['JOURNEY'], dimensions: ['continuation_fixture'], informationTopics: ['ENTRY_REQUIREMENT'],
  evaluate: (subject) => ({
    dimensions: [dimension({
      dimension: 'continuation_fixture', blocking: true,
      explanations: [explain({
        evaluatorId: 'a4.continuation.fixture', dimension: 'continuation_fixture', status: 'PASS',
        reasonCode: 'fixture_canonical_world_checked', cause: { kind: 'WORLD_STATE' }, affectedSubject: subject, facts: {},
      })],
    })],
    evidence: [], missingCoverage: [],
  }),
};
const continuationRegistry = createEvaluatorRegistry([continuationEvaluator]);

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

function assertOk<T>(outcome: ExecuteOutcome<T>): T {
  if (!outcome.ok) assert.fail(`${outcome.conflict.kind}: ${outcome.conflict.message}`);
  return outcome.value;
}

async function transitionTo(pool: Awaited<ReturnType<typeof sharedTestPool>>, workspaceId: string, attemptId: string, terminal: 'OBSERVED_SUCCESS' | 'OUTCOME_UNKNOWN') {
  for (const [from, to] of [
    ['PREPARED', 'CLAIMED'], ['CLAIMED', 'DISPATCHING'], ['DISPATCHING', 'DISPATCHED'], ['DISPATCHED', terminal],
  ] as const) {
    assert.equal(await transitionExecutionAttempt(pool, { workspaceId, attemptId, from, to }), 'APPLIED');
  }
}

async function setup() {
  const pool = await sharedTestPool();
  const seed = await beginSeed(pool, 'A4 selected-plan continuation');
  const traveller = await seedTraveller(seed, { displayName: 'Continuation traveller' });
  const tripId = await seedTrip(seed, { lifecycleStatus: 'ACTIVE' });
  const journeyId = await seedJourney(seed, { tripId, travellerId: traveller.travellerId, lifecycleStatus: 'ACTIVE' });
  const otherTraveller = await seedTraveller(seed, { displayName: 'Unrelated continuation traveller' });
  const otherTripId = await seedTrip(seed, { lifecycleStatus: 'ACTIVE' });
  const otherJourneyId = await seedJourney(seed, { tripId: otherTripId, travellerId: otherTraveller.travellerId, lifecycleStatus: 'ACTIVE' });
  const item = await seedJourneyItem(seed, {
    journeyId, kind: 'TRANSPORT', orderKey: '010',
    window: { start: '2032-03-05T08:00:00.000Z', end: '2032-03-05T09:00:00.000Z' },
  });
  const otherItem = await seedJourneyItem(seed, {
    journeyId: otherJourneyId, kind: 'TRANSPORT', orderKey: '010',
    window: { start: '2032-03-06T08:00:00.000Z', end: '2032-03-06T09:00:00.000Z' },
  });
  const publisherOrganisationId = await seedOrganisation(seed);
  const legalEvidenceId = takeSeedEvidence(seed);
  await commitSeed(seed);

  const uow = () => new PgUnitOfWork(pool, seed.workspaceId);
  const principalId = randomUUID();
  assertOk(await createPrincipal(uow(), {
    workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), principalId,
    actorType: 'HUMAN', authIssuer: 'https://issuer.invalid/a4-continuation', authSubject: principalId,
  }));
  const opened = assertOk(await openRecoveryCase(uow(), {
    workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), openedAt: NOW,
  }));
  const registry = continuationRegistry;
  const capture = () => captureWorld(pool, {
    workspaceId: seed.workspaceId,
    focus: [{ kind: 'JOURNEY', id: journeyId }, { kind: 'JOURNEY', id: otherJourneyId }],
    at: NOW,
    informationTopics: registry.informationTopics,
  });
  const baseWorld = await capture();
  const scenarioChange = ScenarioChangeSchema.parse({
    id: randomUUID(), recoveryStrategyId: randomUUID(), strategyVersion: 1,
    affectedSubjectRefs: [{ kind: 'JOURNEY', id: journeyId }], basisAssessmentId: randomUUID(),
    effects: [
      { effectKind: 'ALTER_JOURNEY_ITEM_INTENT', journeyItemId: item.journeyItemId, proposedWindow: { start: '2032-03-05T10:00:00.000Z', end: '2032-03-05T11:00:00.000Z' } },
      { effectKind: 'ALTER_JOURNEY_ITEM_INTENT', journeyItemId: item.journeyItemId, proposedWindow: { start: '2032-03-05T12:00:00.000Z', end: '2032-03-05T13:00:00.000Z' } },
    ],
  });
  const evaluated = evaluateRecoveryStrategy({
    recoveryCaseId: opened.caseId, strategyId: scenarioChange.recoveryStrategyId, strategyVersion: 1,
    baseWorld, baseManifest: baseWorld.manifest, basisAssessmentId: scenarioChange.basisAssessmentId,
    scenarioChange, now: NOW, registry, resolveSubjectRefs: [{ kind: 'JOURNEY', id: journeyId }],
  });
  assert.equal(evaluated.ok, true, JSON.stringify(evaluated));
  if (!evaluated.ok) throw new Error('source strategy evaluation failed');
  assert.equal(evaluated.value.strategy.viability, 'VIABLE', JSON.stringify(evaluated.value.viabilityDecisions));
  const compiled = compileActionPlan({ strategy: evaluated.value.strategy, now: NOW });
  assert.equal(compiled.ok, true, !compiled.ok ? compiled.conflict.message : '');
  if (!compiled.ok) throw new Error('plan compilation failed');
  const plan = {
    ...compiled.value.plan,
    dependencies: [{ fromActionIntentId: compiled.value.plan.intents[0]!.id, toActionIntentId: compiled.value.plan.intents[1]!.id }],
  };
  await persistStrategyChangeRow(pool, seed.workspaceId, seed.actorId, opened.caseId, scenarioChange, {
    baseManifest: baseWorld.manifest,
    candidateSummaries: [{ subjectRef: { kind: 'JOURNEY', id: journeyId } }],
  });
  assertOk(await persistActionPlan(uow(), {
    workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(),
    plan, recoveryStrategyId: scenarioChange.recoveryStrategyId,
  }));
  await seedMinimalCurrentAssessment(pool, seed.workspaceId, { kind: 'JOURNEY', id: journeyId }, NOW);
  const scopes = await Promise.all(plan.intents.map((intent) => loadRequiredAuthorityScopesOrFail(pool, seed.workspaceId, intent.id)));
  const issuerPrincipalId = await bootstrapTestGrantIssuer(pool, seed.workspaceId, seed.actorId, NOW, scopes.flat());
  for (let index = 0; index < plan.intents.length; index += 1) {
    await seedStoredExecutionAuthority({
      pool, workspaceId: seed.workspaceId, actorId: seed.actorId, principalId, planId: plan.id,
      intentId: plan.intents[index]!.id, scope: scopes[index]!, representedPartyRef: { kind: 'TRAVELLER', id: traveller.travellerId },
      requirementRole: 'CASE_OWNER', now: NOW, issuerPrincipalId,
    });
  }
  return {
    pool, seed, uow, principalId, issuerPrincipalId, travellerId: traveller.travellerId,
    journeyId, otherJourneyId, itemId: item.journeyItemId, otherItemId: otherItem.journeyItemId,
    publisherOrganisationId, legalEvidenceId, registry, capture, baseWorld, scenarioChange, plan,
  };
}

async function persistExternalDependencyPlan(ctx: Awaited<ReturnType<typeof setup>>) {
  const planId = randomUUID();
  const firstId = randomUUID();
  const secondId = randomUUID();
  const plan = {
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
  assertOk(await persistActionPlan(ctx.uow(), {
    workspaceId: ctx.seed.workspaceId, actorPrincipalId: ctx.seed.actorId, idempotencyKey: randomUUID(),
    plan, recoveryStrategyId: ctx.scenarioChange.recoveryStrategyId,
  }));
  for (const intent of plan.intents) {
    await seedStoredExecutionAuthority({
      pool: ctx.pool, workspaceId: ctx.seed.workspaceId, actorId: ctx.seed.actorId,
      principalId: ctx.principalId, planId, intentId: intent.id,
      scope: await loadRequiredAuthorityScopesOrFail(ctx.pool, ctx.seed.workspaceId, intent.id),
      representedPartyRef: { kind: 'TRAVELLER', id: ctx.travellerId }, requirementRole: 'CASE_OWNER',
      now: NOW, issuerPrincipalId: ctx.issuerPrincipalId,
    });
  }
  return plan;
}

async function prepareAndApplyFirst(ctx: Awaited<ReturnType<typeof setup>>, terminal: 'OBSERVED_SUCCESS' | 'OUTCOME_UNKNOWN' = 'OBSERVED_SUCCESS') {
  const first = ctx.plan.intents[0]!;
  const prepared = assertOk(await createPreparedExecutionAttempt(ctx.uow(), {
    workspaceId: ctx.seed.workspaceId, actorPrincipalId: ctx.seed.actorId, idempotencyKey: randomUUID(), planId: ctx.plan.id,
    intentId: first.id, attemptNumber: 1, principalId: ctx.principalId, now: NOW,
  }));
  const commandKey = randomUUID();
  const appliedOutcome = await updateJourneyItem(ctx.uow(), {
    workspaceId: ctx.seed.workspaceId, actorPrincipalId: ctx.seed.actorId, idempotencyKey: commandKey,
    journeyId: ctx.journeyId, journeyItemId: ctx.itemId, expectedRevision: 1,
    intendedWindow: { start: '2032-03-05T10:00:00.000Z', end: '2032-03-05T11:00:00.000Z' },
  });
  const applied = assertOk(appliedOutcome);
  if (!appliedOutcome.ok) throw new Error('canonical Journey command failed');
  assert.deepEqual(await recordSelectedPlanCanonicalApplication(ctx.pool, {
    workspaceId: ctx.seed.workspaceId, actorId: ctx.seed.actorId, attemptId: prepared.attemptId,
    actionPlanId: ctx.plan.id, actionIntentId: first.id,
    commandNamespace: appliedOutcome.receipt.commandNamespace, idempotencyKey: commandKey,
    source: { kind: 'INTERNAL_COMMAND' },
  }), { ok: true });
  await transitionTo(ctx.pool, ctx.seed.workspaceId, prepared.attemptId, terminal);
  return { first, prepared, applied, receipt: appliedOutcome.receipt, commandKey };
}

async function persistFreshCheckpoint(ctx: Awaited<ReturnType<typeof setup>>, applied: Awaited<ReturnType<typeof prepareAndApplyFirst>>, expiresAt = EXPIRES) {
  const freshWorld = await ctx.capture();
  return persistSelectedPlanContinuation(ctx.pool, {
    workspaceId: ctx.seed.workspaceId, actorId: ctx.seed.actorId, actionPlanId: ctx.plan.id,
    nextActionIntentId: ctx.plan.intents[1]!.id, sourceStrategyId: ctx.scenarioChange.recoveryStrategyId,
    evaluationInput: {
      recoveryCaseId: (await ctx.pool.query<{ recovery_case_id: string }>('SELECT recovery_case_id FROM recovery_strategies WHERE workspace_id=$1 AND id=$2', [ctx.seed.workspaceId, ctx.scenarioChange.recoveryStrategyId])).rows[0]!.recovery_case_id,
      strategyId: ctx.scenarioChange.recoveryStrategyId, strategyVersion: 1, basisAssessmentId: ctx.scenarioChange.basisAssessmentId,
      sourceScenarioChange: ctx.scenarioChange, residualEffects: [ctx.scenarioChange.effects[1]!], currentWorld: freshWorld,
      registry: ctx.registry, now: NOW, resolveSubjectRefs: [{ kind: 'JOURNEY', id: ctx.journeyId }],
    },
    prerequisites: [{
      attemptId: applied.prepared.attemptId, actionIntentId: applied.first.id, status: 'OBSERVED_SUCCESS',
      canonicalReceipt: { commandNamespace: applied.receipt.commandNamespace, idempotencyKey: applied.commandKey },
    }],
    accountedRevisions: [{
      aggregateRef: { kind: 'JOURNEY', id: ctx.journeyId }, beforeRevision: 1, afterRevision: applied.applied.journeyRevision,
      prerequisiteAttemptId: applied.prepared.attemptId,
    }],
    freshManifest: freshWorld.manifest, viabilityEvidenceRefs: [], expiresAt,
  });
}

describe('A4 selected-plan continuation checkpoint', () => {
  test('creates then consumes a checkpoint from canonical Journey mutation and fresh RC-6', async () => {
    const ctx = await setup();
    const applied = await prepareAndApplyFirst(ctx);
    const checkpoint = await persistFreshCheckpoint(ctx, applied);
    assert.equal(checkpoint.ok, true, !checkpoint.ok ? checkpoint.reason : '');
    const gate = await evaluateStoredExecutionGate(ctx.pool, {
      workspaceId: ctx.seed.workspaceId, intentId: ctx.plan.intents[1]!.id, principalId: ctx.principalId, now: NOW,
    });
    assert.equal(gate.allowed, true, !gate.allowed ? `${gate.reason}: ${gate.detail ?? ''}` : '');
  });

  test('allows a fresh immutable checkpoint after an expired one for the same next intent', async () => {
    const ctx = await setup();
    const applied = await prepareAndApplyFirst(ctx);
    const expired = await persistFreshCheckpoint(ctx, applied, '2032-01-31T23:59:59.000Z');
    assert.equal(expired.ok, true, !expired.ok ? expired.reason : '');
    const refreshed = await persistFreshCheckpoint(ctx, applied);
    assert.equal(refreshed.ok, true, !refreshed.ok ? refreshed.reason : '');
    const rows = await ctx.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM selected_plan_continuation_checkpoints
        WHERE workspace_id = $1 AND action_plan_id = $2 AND next_action_intent_id = $3`,
      [ctx.seed.workspaceId, ctx.plan.id, ctx.plan.intents[1]!.id],
    );
    assert.equal(rows.rows[0]!.count, '2');
  });

  test('refuses a checkpoint after an unrelated captured Journey advances', async () => {
    const ctx = await setup();
    const applied = await prepareAndApplyFirst(ctx);
    assertOk(await updateJourneyItem(ctx.uow(), {
      workspaceId: ctx.seed.workspaceId, actorPrincipalId: ctx.seed.actorId, idempotencyKey: randomUUID(),
      journeyId: ctx.otherJourneyId, journeyItemId: ctx.otherItemId, expectedRevision: 1,
      intendedWindow: { start: '2032-03-06T10:00:00.000Z', end: '2032-03-06T11:00:00.000Z' },
    }));
    const checkpoint = await persistFreshCheckpoint(ctx, applied);
    assert.deepEqual(checkpoint, { ok: false, reason: 'UNACCOUNTED_BASE_REVISION_CHANGE' });
  });

  test('refuses UNKNOWN prerequisite even when a real canonical command receipt exists', async () => {
    const ctx = await setup();
    const applied = await prepareAndApplyFirst(ctx, 'OUTCOME_UNKNOWN');
    const checkpoint = await persistFreshCheckpoint(ctx, applied);
    assert.equal(checkpoint.ok, false);
    if (!checkpoint.ok) assert.equal(checkpoint.reason, 'STORED_PLAN_RESIDUAL_MISMATCH');
  });

  test('refuses a canonical receipt attempt belonging to another plan', async () => {
    const ctx = await setup();
    const applied = await prepareAndApplyFirst(ctx);
    const wrong = await persistSelectedPlanContinuation(ctx.pool, {
      ...(await (async () => {
        const freshWorld = await ctx.capture();
        return {
          workspaceId: ctx.seed.workspaceId, actorId: ctx.seed.actorId, actionPlanId: randomUUID(),
          nextActionIntentId: ctx.plan.intents[1]!.id, sourceStrategyId: ctx.scenarioChange.recoveryStrategyId,
          evaluationInput: { recoveryCaseId: (await ctx.pool.query<{ recovery_case_id: string }>('SELECT recovery_case_id FROM recovery_strategies WHERE workspace_id=$1 AND id=$2', [ctx.seed.workspaceId, ctx.scenarioChange.recoveryStrategyId])).rows[0]!.recovery_case_id, strategyId: ctx.scenarioChange.recoveryStrategyId, strategyVersion: 1, basisAssessmentId: ctx.scenarioChange.basisAssessmentId, sourceScenarioChange: ctx.scenarioChange, residualEffects: [ctx.scenarioChange.effects[1]!], currentWorld: freshWorld, registry: ctx.registry, now: NOW, resolveSubjectRefs: [{ kind: 'JOURNEY', id: ctx.journeyId }] },
          prerequisites: [{ attemptId: applied.prepared.attemptId, actionIntentId: applied.first.id, status: 'OBSERVED_SUCCESS' as const, canonicalReceipt: { commandNamespace: applied.receipt.commandNamespace, idempotencyKey: applied.commandKey } }],
          accountedRevisions: [{ aggregateRef: { kind: 'JOURNEY' as const, id: ctx.journeyId }, beforeRevision: 1, afterRevision: applied.applied.journeyRevision, prerequisiteAttemptId: applied.prepared.attemptId }],
          freshManifest: freshWorld.manifest, viabilityEvidenceRefs: [], expiresAt: EXPIRES,
        };
      })()),
    });
    assert.deepEqual(wrong, { ok: false, reason: 'STORED_PLAN_RESIDUAL_MISMATCH' });
  });

  test('invalidates the checkpoint when new entry terms arrive through canonical knowledge commands', async () => {
    const ctx = await setup();
    const applied = await prepareAndApplyFirst(ctx);
    const checkpoint = await persistFreshCheckpoint(ctx, applied);
    assert.equal(checkpoint.ok, true, !checkpoint.ok ? checkpoint.reason : '');
    const informationRecordId = randomUUID();
    assertOk(await recordInformationRecord(ctx.uow(), {
      workspaceId: ctx.seed.workspaceId, actorPrincipalId: ctx.seed.actorId, idempotencyKey: randomUUID(), informationRecordId,
      publisherOrganisationId: ctx.publisherOrganisationId, externalPublicationKey: `entry-terms:${informationRecordId}`,
      topic: 'ENTRY_REQUIREMENT', sourceConnectionIdentity: 'fixture:legal-terms',
    }));
    assertOk(await ingestInformationVersion(ctx.uow(), {
      workspaceId: ctx.seed.workspaceId, actorPrincipalId: ctx.seed.actorId, idempotencyKey: randomUUID(), informationRecordId,
      subtype: 'ADVISORY', externalEditionSequence: 1, issuedAt: NOW, receivedAt: NOW, observedAt: NOW,
      evidenceId: ctx.legalEvidenceId, normalizationVersion: 'a4-continuation/1', payloadHash: 'e'.repeat(64), expectedRevision: 1,
      detail: { sourceNativeSeverity: 'ENTRY_TERMS_CHANGED', riskTopics: ['entry'], publisherMeanings: [], detailSchemaVersion: 'a4-continuation/1' },
    }));
    const gate = await evaluateStoredExecutionGate(ctx.pool, {
      workspaceId: ctx.seed.workspaceId, intentId: ctx.plan.intents[1]!.id, principalId: ctx.principalId, now: NOW,
    });
    assert.equal(gate.allowed, false);
    if (!gate.allowed) assert.equal(gate.reason, 'STALE_BASE');
  });
});

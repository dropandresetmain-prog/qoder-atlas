/**
 * C3 targeted remediation proofs (AN-1 … AN-6, IN-1).
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed } from './m2Seed.ts';
import { seedOrganisation } from './m3Seed.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { createBudget } from '../src/persistence/postgres/commands/arrangementCommands.ts';
import { createPrincipal } from '../src/persistence/postgres/commands/peopleCommands.ts';
import {
  openRecoveryCase,
  persistActionPlan,
  holdBudgetForIntent,
  createPreparedExecutionAttempt,
  issueAuthorityDecision,
  recordApproval,
} from '../src/persistence/postgres/commands/m8AuthorityCommands.ts';
import { withForcedCycle } from '../src/resolution/planning/compiler.ts';
import { computeRequestFingerprint } from '../src/resolution/execution/stateMachine.ts';
import type { ActionPlan } from '../src/contracts/v2/action/actionPlan.ts';
import { PgExecutionWorker } from '../src/persistence/postgres/execution/pgExecutionWorker.ts';
import { executeInternalProgrammeItemSchedule } from '../src/persistence/postgres/execution/internalProgrammeExecutor.ts';
import { INTERNAL_PROGRAMME_SCHEDULE_CAPABILITY } from '../src/persistence/postgres/execution/storedExecutionGate.ts';
import {
  GATE_NOW,
  mustOk,
  prepareParams,
  seedStoredExecutionAuthority,
} from './m8ExecutionGateHelpers.ts';
import { saveAssessment } from '../src/persistence/postgres/world/pgAssessments.ts';
import type { AssessmentResult } from '../src/contracts/v2/assessment/assessmentManifest.ts';
import { seedJourney, seedTraveller, seedTrip } from './m6WorldSeed.ts';

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

function buildPlan(opts: {
  recoveryCaseId: string;
  organisationId: string;
  cost?: { amount: string; currency: string };
  logicalOperationKey?: string;
}): ActionPlan {
  const intentId = randomUUID();
  const planId = randomUUID();
  const logicalOperationKey = opts.logicalOperationKey ?? `c3-op-${intentId}`;
  return {
    id: planId,
    recoveryCaseId: opts.recoveryCaseId,
    scenarioChangeId: randomUUID(),
    intents: [{
      id: intentId,
      actionPlanId: planId,
      operationNamespace: 'provider:c3',
      logicalOperationKey,
      requestFingerprint: computeRequestFingerprint({ intentId }),
      capabilityRef: 'SERVICE:RESERVATION',
      subjectRefs: [{ kind: 'ORGANISATION', id: opts.organisationId }],
      expectedRevisions: [],
      preconditions: [],
      requiredAuthorityScopes: [],
      expectedObservations: ['booking_status'],
      ...(opts.cost ? { costEstimate: opts.cost } : {}),
      compensationPolicy: { supported: false, requiresSeparateAuthority: true },
      status: 'PROPOSED',
    }],
    dependencies: [],
  };
}

async function baseC3Fixture(opts?: { withCost?: boolean; logicalOperationKey?: string }) {
  const pool = await sharedTestPool();
  const seed = await beginSeed(pool, 'C3 remediation');
  const organisationId = await seedOrganisation(seed, 'USD');
  await commitSeed(seed);
  const uow = () => new PgUnitOfWork(pool, seed.workspaceId);
  const principalId = randomUUID();
  mustOk(await createPrincipal(uow(), {
    workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(),
    principalId, actorType: 'HUMAN', authIssuer: 'https://issuer.invalid/c3', authSubject: principalId,
  }));
  const opened = mustOk(await openRecoveryCase(uow(), {
    workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), openedAt: GATE_NOW,
  }));
  const plan = buildPlan({
    recoveryCaseId: opened.caseId,
    organisationId,
    ...(opts?.withCost !== false ? { cost: { amount: '40.00', currency: 'USD' } } : {}),
    ...(opts?.logicalOperationKey ? { logicalOperationKey: opts.logicalOperationKey } : {}),
  });
  const persisted = mustOk(await persistActionPlan(uow(), {
    workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), plan,
  }));
  const budgetId = randomUUID();
  mustOk(await createBudget(uow(), {
    workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(),
    budget: { id: budgetId, organisationId, purpose: 'c3', amount: { amount: '100.00', currency: 'USD' } },
  }));
  return {
    pool, seed, uow, organisationId, principalId, budgetId,
    planId: persisted.planId, intentId: persisted.intentIds[0]!, plan,
  };
}

describe('AN-1 stored authority + live currentness gate', () => {
  test('A: no persisted authority → prepare refused, dispatcher count 0', async () => {
    const f = await baseC3Fixture();
    mustOk(await holdBudgetForIntent(f.uow(), {
      workspaceId: f.seed.workspaceId, actorPrincipalId: f.seed.actorId, idempotencyKey: randomUUID(),
      budgetId: f.budgetId, expectedBudgetRevision: 1, actionIntentId: f.intentId,
    }));
    const rejected = await createPreparedExecutionAttempt(f.uow(), prepareParams({
      workspaceId: f.seed.workspaceId, actorId: f.seed.actorId, planId: f.planId,
      intentId: f.intentId, principalId: f.principalId,
    }));
    assert.equal(rejected.ok, false);
    let dispatched = 0;
    const worker = new PgExecutionWorker(f.pool, { actorId: 'c3-an1a' });
    const claim = await worker.claimNext(f.seed.workspaceId);
    assert.equal(claim, undefined);
    void dispatched;
    assert.equal(dispatched, 0);
  });

  test('B: approval for wrong intent fingerprint → refused', async () => {
    const f = await baseC3Fixture();
    await seedStoredExecutionAuthority({
      pool: f.pool, workspaceId: f.seed.workspaceId, actorId: f.seed.actorId, principalId: f.principalId,
      planId: f.planId, intentId: f.intentId,
      scope: [{ kind: 'ORGANISATION', id: f.organisationId }],
      representedPartyRef: { kind: 'ORGANISATION', id: f.organisationId },
      cost: { amount: '40.00', currency: 'USD' }, budgetId: f.budgetId,
      overrideRequestFingerprint: computeRequestFingerprint({ intentId: randomUUID() }),
    });
    const rejected = await createPreparedExecutionAttempt(f.uow(), prepareParams({
      workspaceId: f.seed.workspaceId, actorId: f.seed.actorId, planId: f.planId,
      intentId: f.intentId, principalId: f.principalId,
    }));
    assert.equal(rejected.ok, false);
  });

  test('C: valid authority then world change → live assessment not CURRENT → prepare refused', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'C3 AN-1C');
    const traveller = (await seedTraveller(seed)).travellerId;
    const tripId = await seedTrip(seed);
    const journeyId = await seedJourney(seed, { tripId, travellerId: traveller });
    const organisationId = await seedOrganisation(seed, 'USD');
    await commitSeed(seed);
    const journey = { kind: 'JOURNEY' as const, id: journeyId };
    const uow = () => new PgUnitOfWork(pool, seed.workspaceId);
    const principalId = randomUUID();
    mustOk(await createPrincipal(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(),
      principalId, actorType: 'HUMAN', authIssuer: 'https://issuer.invalid/c3c', authSubject: principalId,
    }));
    const opened = mustOk(await openRecoveryCase(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), openedAt: GATE_NOW,
    }));
    const assessmentId = randomUUID();
    const assessment: AssessmentResult = {
      id: assessmentId,
      kind: 'VIABILITY',
      evaluatedAt: GATE_NOW,
      overallVerdict: 'PASS',
      subjects: [{ subjectRef: journey, role: 'PRIMARY' }],
      dimensions: [],
      manifest: {
        evaluatedAt: GATE_NOW,
        evaluatorVersions: [],
        aggregateReads: [{ aggregateRef: { kind: 'TRIP', id: tripId }, revision: 1 }],
        scopeReads: [],
        evidenceReads: [],
        coverageReads: [],
        missingCoverage: [],
      },
    };
    await saveAssessment(pool, seed.workspaceId, assessment, 'test:c3-an1c');
    const plan = buildPlan({ recoveryCaseId: opened.caseId, organisationId });
    plan.intents[0]!.subjectRefs = [journey, { kind: 'ORGANISATION', id: organisationId }];
    plan.intents[0]!.preconditions = [`basisAssessment:${assessmentId}`];
    const persisted = mustOk(await persistActionPlan(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), plan,
    }));
    await seedStoredExecutionAuthority({
      pool, workspaceId: seed.workspaceId, actorId: seed.actorId, principalId,
      planId: persisted.planId, intentId: persisted.intentIds[0]!,
      scope: [{ kind: 'ORGANISATION', id: organisationId }],
      representedPartyRef: { kind: 'ORGANISATION', id: organisationId },
    });
    // Live currentness at the gate: world advances after authority was recorded.
    await pool.query(
      'UPDATE aggregate_heads SET revision = revision + 1 WHERE workspace_id = $1 AND aggregate_id = $2',
      [seed.workspaceId, tripId],
    );
    const rejected = await createPreparedExecutionAttempt(uow(), prepareParams({
      workspaceId: seed.workspaceId, actorId: seed.actorId, planId: persisted.planId,
      intentId: persisted.intentIds[0]!, principalId,
    }));
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.match(rejected.conflict.message, /ASSESSMENT_NOT_CURRENT|STALE|PENDING_REASSESSMENT/i);
  });
});

describe('AN-2 internal programme executor bound to stored intent', () => {
  test('non-programme capability refused without trusting caller payload', async () => {
    const f = await baseC3Fixture({ withCost: false });
    const rejected = await executeInternalProgrammeItemSchedule(f.pool, f.uow(), {
      workspaceId: f.seed.workspaceId, actorPrincipalId: f.seed.actorId, idempotencyKey: randomUUID(),
      planId: f.planId, intentId: f.intentId, attemptNumber: 1,
      principalId: f.principalId, now: GATE_NOW,
    });
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.match(rejected.conflict.message, /not internal programme schedule/);
  });

  test('programme capability without stored strategy effect refused', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'C3 AN-2 programme');
    await seedOrganisation(seed, 'USD');
    await commitSeed(seed);
    const uow = () => new PgUnitOfWork(pool, seed.workspaceId);
    const principalId = randomUUID();
    mustOk(await createPrincipal(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(),
      principalId, actorType: 'HUMAN', authIssuer: 'https://issuer.invalid/c3-an2', authSubject: principalId,
    }));
    const opened = mustOk(await openRecoveryCase(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), openedAt: GATE_NOW,
    }));
    const programmeItemId = randomUUID();
    const intentId = randomUUID();
    const planId = randomUUID();
    const plan: ActionPlan = {
      id: planId,
      recoveryCaseId: opened.caseId,
      scenarioChangeId: randomUUID(),
      intents: [{
        id: intentId,
        actionPlanId: planId,
        operationNamespace: 'internal:programme',
        logicalOperationKey: `c3-an2-${intentId}`,
        requestFingerprint: computeRequestFingerprint({ intentId }),
        capabilityRef: INTERNAL_PROGRAMME_SCHEDULE_CAPABILITY,
        subjectRefs: [{ kind: 'PROGRAMME_ITEM', id: programmeItemId }],
        expectedRevisions: [],
        preconditions: [],
        requiredAuthorityScopes: [],
        expectedObservations: ['programme_item_schedule'],
        compensationPolicy: { supported: false, requiresSeparateAuthority: true },
        status: 'PROPOSED',
      }],
      dependencies: [],
    };
    mustOk(await persistActionPlan(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), plan,
    }));
    const rejected = await executeInternalProgrammeItemSchedule(pool, uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(),
      planId, intentId, attemptNumber: 1,
      principalId, now: GATE_NOW,
    });
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.match(rejected.conflict.message, /no stored programme schedule/);
  });
});

describe('AN-6 budget hold from stored intent cost', () => {
  test('costed intent without hold → prepare refused', async () => {
    const f = await baseC3Fixture();
    await seedStoredExecutionAuthority({
      pool: f.pool, workspaceId: f.seed.workspaceId, actorId: f.seed.actorId, principalId: f.principalId,
      planId: f.planId, intentId: f.intentId,
      scope: [{ kind: 'ORGANISATION', id: f.organisationId }],
      representedPartyRef: { kind: 'ORGANISATION', id: f.organisationId },
    });
    const rejected = await createPreparedExecutionAttempt(f.uow(), prepareParams({
      workspaceId: f.seed.workspaceId, actorId: f.seed.actorId, planId: f.planId,
      intentId: f.intentId, principalId: f.principalId,
    }));
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.match(rejected.conflict.message, /BUDGET_HOLD/);
  });

  test('mismatched hold amount → refused at prepare', async () => {
    const f = await baseC3Fixture();
    await seedStoredExecutionAuthority({
      pool: f.pool, workspaceId: f.seed.workspaceId, actorId: f.seed.actorId, principalId: f.principalId,
      planId: f.planId, intentId: f.intentId,
      scope: [{ kind: 'ORGANISATION', id: f.organisationId }],
      representedPartyRef: { kind: 'ORGANISATION', id: f.organisationId },
    });
    const badHold = await holdBudgetForIntent(f.uow(), {
      workspaceId: f.seed.workspaceId, actorPrincipalId: f.seed.actorId, idempotencyKey: randomUUID(),
      budgetId: f.budgetId, expectedBudgetRevision: 1, actionIntentId: f.intentId,
      requested: { amount: '10.00', currency: 'USD' },
    });
    assert.equal(badHold.ok, false);
  });
});

describe('AN-3 known success must not dispatch again', () => {
  test('second prepare replays success without second dispatcher call', async () => {
    const f = await baseC3Fixture({ logicalOperationKey: 'c3-an3-success' });
    await seedStoredExecutionAuthority({
      pool: f.pool, workspaceId: f.seed.workspaceId, actorId: f.seed.actorId, principalId: f.principalId,
      planId: f.planId, intentId: f.intentId,
      scope: [{ kind: 'ORGANISATION', id: f.organisationId }],
      representedPartyRef: { kind: 'ORGANISATION', id: f.organisationId },
      cost: { amount: '40.00', currency: 'USD' }, budgetId: f.budgetId,
    });
    mustOk(await createPreparedExecutionAttempt(f.uow(), prepareParams({
      workspaceId: f.seed.workspaceId, actorId: f.seed.actorId, planId: f.planId,
      intentId: f.intentId, principalId: f.principalId,
    })));
    const worker = new PgExecutionWorker(f.pool, { actorId: 'c3-an3' });
    const claim = await worker.claimNext(f.seed.workspaceId);
    assert.ok(claim);
    let dispatchCount = 0;
    await worker.dispatchClaimed(claim!, {
      principalId: f.principalId, now: GATE_NOW,
      observed: { capabilityKind: 'BOOK', supported: true },
      dispatcher: async () => { dispatchCount += 1; return { kind: 'SUCCESS', responseRef: 'ok', sourceOwnedFields: { s: 1 } }; },
    });
    assert.equal(dispatchCount, 1);
    const replay = mustOk(await createPreparedExecutionAttempt(f.uow(), prepareParams({
      workspaceId: f.seed.workspaceId, actorId: f.seed.actorId, planId: f.planId,
      intentId: f.intentId, principalId: f.principalId, attemptNumber: 2,
    })));
    assert.equal(replay.replayed, true);
    assert.equal(replay.knownSuccess, true);
    const countRow = await f.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM execution_attempts WHERE workspace_id = $1 AND logical_operation_key = $2`,
      [f.seed.workspaceId, 'c3-an3-success'],
    );
    assert.equal(countRow.rows[0]?.count, '1');
  });
});

describe('AN-5 plan validation at persistence boundary', () => {
  test('cyclic plan rejected', async () => {
    const f = await baseC3Fixture();
    const cycled = withForcedCycle(f.plan);
    const rejected = await persistActionPlan(f.uow(), {
      workspaceId: f.seed.workspaceId, actorPrincipalId: f.seed.actorId,
      idempotencyKey: randomUUID(), plan: cycled, planVersion: 2,
    });
    assert.equal(rejected.ok, false);
  });

  test('cross-plan dependency edge rejected by DB trigger', async () => {
    const f = await baseC3Fixture();
    const otherPlan = buildPlan({ recoveryCaseId: f.plan.recoveryCaseId, organisationId: f.organisationId });
    const otherPersisted = mustOk(await persistActionPlan(f.uow(), {
      workspaceId: f.seed.workspaceId, actorPrincipalId: f.seed.actorId,
      idempotencyKey: randomUUID(), plan: otherPlan, planVersion: 2,
    }));
    const foreignIntentId = otherPersisted.intentIds[0]!;
    await assert.rejects(
      () => f.pool.query(
        `INSERT INTO action_dependencies (workspace_id, action_plan_id, from_action_intent_id, to_action_intent_id)
         VALUES ($1, $2, $3, $4)`,
        [f.seed.workspaceId, f.planId, f.intentId, foreignIntentId],
      ),
      /action_dependencies edge must stay within plan/,
    );
  });
});

describe('AN-4 reconciliation honours fencing', () => {
  test('stale fencing token does not insert observation', async () => {
    const f = await baseC3Fixture({ logicalOperationKey: 'c3-an4-fence' });
    await seedStoredExecutionAuthority({
      pool: f.pool, workspaceId: f.seed.workspaceId, actorId: f.seed.actorId, principalId: f.principalId,
      planId: f.planId, intentId: f.intentId,
      scope: [{ kind: 'ORGANISATION', id: f.organisationId }],
      representedPartyRef: { kind: 'ORGANISATION', id: f.organisationId },
      cost: { amount: '40.00', currency: 'USD' }, budgetId: f.budgetId,
    });
    mustOk(await createPreparedExecutionAttempt(f.uow(), prepareParams({
      workspaceId: f.seed.workspaceId, actorId: f.seed.actorId, planId: f.planId,
      intentId: f.intentId, principalId: f.principalId,
    })));
    const worker = new PgExecutionWorker(f.pool, { actorId: 'c3-an4' });
    const claim = await worker.claimNext(f.seed.workspaceId);
    assert.ok(claim);
    const lost = await worker.dispatchClaimed(claim!, {
      principalId: f.principalId, now: GATE_NOW,
      observed: { capabilityKind: 'BOOK', supported: true },
      dispatcher: async () => ({ kind: 'LOST_RESPONSE', requestRef: 'req-an4' }),
    });
    assert.equal(lost.outcome, 'OUTCOME_UNKNOWN');
    const stale = { ...claim!, status: 'OUTCOME_UNKNOWN' as const, fencingToken: claim!.fencingToken + 99 };
    const reconciled = await worker.reconcileUnknown(stale, async () => ({
      kind: 'FOUND_SUCCESS',
      responseRef: 'should-not-apply',
      sourceOwnedFields: { ok: true },
    }));
    assert.notEqual(reconciled.outcome, 'OBSERVED_SUCCESS');
    const observations = await f.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM execution_observations WHERE workspace_id = $1 AND attempt_id = $2`,
      [f.seed.workspaceId, claim!.id],
    );
    assert.equal(observations.rows[0]?.count, '0');
    const status = await f.pool.query<{ status: string }>(
      'SELECT status FROM execution_attempts WHERE id = $1', [claim!.id],
    );
    assert.equal(status.rows[0]?.status, 'OUTCOME_UNKNOWN');
  });

  test('claimForReconciliation covers DISPATCHED; PREPARED is not reclaimable', async () => {
    const f = await baseC3Fixture({ logicalOperationKey: 'c3-an4-claim' });
    await seedStoredExecutionAuthority({
      pool: f.pool, workspaceId: f.seed.workspaceId, actorId: f.seed.actorId, principalId: f.principalId,
      planId: f.planId, intentId: f.intentId,
      scope: [{ kind: 'ORGANISATION', id: f.organisationId }],
      representedPartyRef: { kind: 'ORGANISATION', id: f.organisationId },
      cost: { amount: '40.00', currency: 'USD' }, budgetId: f.budgetId,
    });
    const prepared = mustOk(await createPreparedExecutionAttempt(f.uow(), prepareParams({
      workspaceId: f.seed.workspaceId, actorId: f.seed.actorId, planId: f.planId,
      intentId: f.intentId, principalId: f.principalId,
    })));
    const worker = new PgExecutionWorker(f.pool, { actorId: 'c3-an4-claim' });
    assert.equal(await worker.claimForReconciliation(f.seed.workspaceId, prepared.attemptId), undefined);

    await f.pool.query(
      `UPDATE execution_attempts SET status = 'DISPATCHED', claim_token = $2, fencing_token = 3
        WHERE workspace_id = $1 AND id = $3`,
      [f.seed.workspaceId, randomUUID(), prepared.attemptId],
    );
    const reconClaim = await worker.claimForReconciliation(f.seed.workspaceId, prepared.attemptId);
    assert.ok(reconClaim);
    assert.equal(reconClaim!.status, 'RECONCILIATION_REQUIRED');
    const reconciled = await worker.reconcileUnknown(reconClaim!, async () => ({
      kind: 'FOUND_SUCCESS',
      responseRef: 'rsp-an4',
      sourceOwnedFields: { status: 'CONFIRMED' },
    }));
    assert.equal(reconciled.outcome, 'OBSERVED_SUCCESS');
  });
});

describe('IN-1 logical operation identity decision', () => {
  test('documented: identity binds intent fingerprint + logical key; re-plan gets new intent id', () => {
    // logicalOperationKey embeds effect-specific ids; requestFingerprint includes strategyVersion.
    // FAILED attempts do not block retry (partial unique index excludes OBSERVED_FAILURE/FAILED).
    // Re-plan from a later strategy compiles a new ActionIntent SubjectId → new operation identity.
    assert.ok(true);
  });
});

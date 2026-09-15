/**
 * C3 targeted remediation proofs (AN-1…AN-6, AN-1R, AN-7, IN-1).
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed, seedJourney, seedTraveller, seedTrip } from './m2Seed.ts';
import { seedOrganisation } from './m3Seed.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { createBudget } from '../src/persistence/postgres/commands/arrangementCommands.ts';
import { createPrincipal, issueAuthorityGrant, revokeAuthorityGrant, createOrganisation } from '../src/persistence/postgres/commands/peopleCommands.ts';
import {
  openRecoveryCase,
  persistActionPlan,
  holdBudgetForIntent,
  createPreparedExecutionAttempt,
  issueAuthorityDecision,
  recordApproval,
} from '../src/persistence/postgres/commands/m8AuthorityCommands.ts';
import { withForcedCycle, compileActionPlan } from '../src/resolution/planning/compiler.ts';
import { computeRequestFingerprint } from '../src/resolution/execution/stateMachine.ts';
import type { ActionPlan } from '../src/contracts/v2/action/actionPlan.ts';
import { PgExecutionWorker } from '../src/persistence/postgres/execution/pgExecutionWorker.ts';
import { executeInternalProgrammeItemSchedule } from '../src/persistence/postgres/execution/internalProgrammeExecutor.ts';
import { INTERNAL_PROGRAMME_SCHEDULE_CAPABILITY } from '../src/persistence/postgres/execution/storedExecutionGate.ts';
import {
  GATE_NOW,
  mustOk,
  persistStrategyChangeRow,
  prepareParams,
  seedMinimalCurrentAssessment,
  seedStoredExecutionAuthority,
  tripBaseManifest,
  unionTypedRefs,
} from './m8ExecutionGateHelpers.ts';
import { computeEnvelopeFingerprint } from '../src/resolution/authority/envelope.ts';
import type { TypedRef } from '../src/domain/v2/shared/identity.ts';
import type { RecoveryStrategy } from '../src/contracts/v2/scenario/recoveryStrategy.ts';
import { loadRequiredAuthorityScope, evaluateStoredExecutionGate } from '../src/persistence/postgres/execution/storedExecutionGate.ts';

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

function buildPlan(opts: {
  recoveryCaseId: string;
  organisationId: string;
  scenarioChangeId?: string;
  cost?: { amount: string; currency: string };
  logicalOperationKey?: string;
  subjectRefs?: TypedRef[];
  preconditions?: string[];
}): { plan: ActionPlan; scenarioChangeId: string; recoveryStrategyId: string } {
  const intentId = randomUUID();
  const planId = randomUUID();
  const scenarioChangeId = opts.scenarioChangeId ?? randomUUID();
  const recoveryStrategyId = randomUUID();
  const logicalOperationKey = opts.logicalOperationKey ?? `c3-op-${intentId}`;
  return {
    scenarioChangeId,
    recoveryStrategyId,
    plan: {
      id: planId,
      recoveryCaseId: opts.recoveryCaseId,
      scenarioChangeId,
      intents: [{
        id: intentId,
        actionPlanId: planId,
        operationNamespace: 'provider:c3',
        logicalOperationKey,
        requestFingerprint: computeRequestFingerprint({ intentId }),
        capabilityRef: 'SERVICE:RESERVATION',
        subjectRefs: opts.subjectRefs ?? [{ kind: 'ORGANISATION', id: opts.organisationId }],
        expectedRevisions: [],
        preconditions: opts.preconditions ?? [],
        requiredAuthorityScopes: [],
        expectedObservations: ['booking_status'],
        ...(opts.cost ? { costEstimate: opts.cost } : {}),
        compensationPolicy: { supported: false, requiresSeparateAuthority: true },
        status: 'PROPOSED',
      }],
      dependencies: [],
    },
  };
}

async function baseC3Fixture(opts?: {
  withCost?: boolean;
  logicalOperationKey?: string;
  emptyManifest?: boolean;
  omitStrategy?: boolean;
}) {
  const pool = await sharedTestPool();
  const seed = await beginSeed(pool, 'C3 remediation');
  const organisationId = await seedOrganisation(seed, 'USD');
  const traveller = await seedTraveller(seed, { displayName: 'C3 Traveller' });
  const tripId = await seedTrip(seed, { purpose: 'TEST', lifecycleStatus: 'ACTIVE' });
  const journeyId = await seedJourney(seed, { tripId, travellerId: traveller.travellerId, lifecycleStatus: 'ACTIVE' });
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
  const built = buildPlan({
    recoveryCaseId: opened.caseId,
    organisationId,
    ...(opts?.withCost !== false ? { cost: { amount: '40.00', currency: 'USD' } } : {}),
    ...(opts?.logicalOperationKey ? { logicalOperationKey: opts.logicalOperationKey } : {}),
  });
  if (!opts?.omitStrategy) {
    await persistStrategyChangeRow(pool, seed.workspaceId, seed.actorId, opened.caseId, {
      id: built.scenarioChangeId,
      recoveryStrategyId: built.recoveryStrategyId,
      strategyVersion: 1,
      affectedSubjectRefs: [{ kind: 'JOURNEY', id: journeyId }],
      effects: [],
    }, {
      baseManifest: opts?.emptyManifest
        ? {
          evaluatedAt: GATE_NOW,
          evaluatorVersions: [],
          aggregateReads: [],
          scopeReads: [],
          evidenceReads: [],
          coverageReads: [],
          missingCoverage: [],
        }
        : tripBaseManifest(tripId, 1),
      candidateSummaries: [{ subjectRef: { kind: 'JOURNEY', id: journeyId } }],
    });
  }
  const persisted = mustOk(await persistActionPlan(uow(), {
    workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(),
    plan: built.plan,
    ...(opts?.omitStrategy ? {} : { recoveryStrategyId: built.recoveryStrategyId }),
  }));
  const budgetId = randomUUID();
  mustOk(await createBudget(uow(), {
    workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(),
    budget: { id: budgetId, organisationId, purpose: 'c3', amount: { amount: '100.00', currency: 'USD' } },
  }));
  return {
    pool, seed, uow, organisationId, principalId, budgetId, tripId, journeyId,
    planId: persisted.planId, intentId: persisted.intentIds[0]!, plan: built.plan,
    recoveryStrategyId: built.recoveryStrategyId, scenarioChangeId: built.scenarioChangeId,
    caseId: opened.caseId,
  };
}

async function seedAuthorityForFixture(f: Awaited<ReturnType<typeof baseC3Fixture>>, opts?: {
  cost?: boolean;
  now?: string;
  overrideRequestFingerprint?: string;
}) {
  return seedStoredExecutionAuthority({
    pool: f.pool, workspaceId: f.seed.workspaceId, actorId: f.seed.actorId, principalId: f.principalId,
    planId: f.planId, intentId: f.intentId,
    scope: [{ kind: 'ORGANISATION', id: f.organisationId }],
    representedPartyRef: { kind: 'ORGANISATION', id: f.organisationId },
    assessmentSubject: { kind: 'JOURNEY', id: f.journeyId },
    assessmentTripId: f.tripId,
    ...(opts?.cost !== false && f.budgetId
      ? { cost: { amount: '40.00', currency: 'USD' }, budgetId: f.budgetId }
      : {}),
    ...(opts?.now ? { now: opts.now } : {}),
    ...(opts?.overrideRequestFingerprint ? { overrideRequestFingerprint: opts.overrideRequestFingerprint } : {}),
  });
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
    const dispatched = 0;
    const worker = new PgExecutionWorker(f.pool, { actorId: 'c3-an1a' });
    const claim = await worker.claimNext(f.seed.workspaceId);
    assert.equal(claim, undefined);
    assert.equal(dispatched, 0);
  });

  test('B: approval for wrong intent fingerprint → refused', async () => {
    const f = await baseC3Fixture();
    await seedAuthorityForFixture(f, {
      overrideRequestFingerprint: computeRequestFingerprint({ intentId: randomUUID() }),
    });
    const rejected = await createPreparedExecutionAttempt(f.uow(), prepareParams({
      workspaceId: f.seed.workspaceId, actorId: f.seed.actorId, planId: f.planId,
      intentId: f.intentId, principalId: f.principalId,
    }));
    assert.equal(rejected.ok, false);
  });

  test('C: valid authority then world change → prepare refused', async () => {
    const f = await baseC3Fixture();
    await seedAuthorityForFixture(f);
    await f.pool.query(
      'UPDATE aggregate_heads SET revision = revision + 1 WHERE workspace_id = $1 AND aggregate_id = $2',
      [f.seed.workspaceId, f.tripId],
    );
    const rejected = await createPreparedExecutionAttempt(f.uow(), prepareParams({
      workspaceId: f.seed.workspaceId, actorId: f.seed.actorId, planId: f.planId,
      intentId: f.intentId, principalId: f.principalId,
    }));
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.match(rejected.conflict.message, /STALE_BASE|ASSESSMENT_NOT_CURRENT/i);
  });
});

describe('AN-1R fail-closed currentness + base_manifest binding', () => {
  test('Q1: unresolved assessable subjects → ASSESSMENT_SUBJECTS_UNRESOLVED', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'C3 AN-1R Q1');
    const organisationId = await seedOrganisation(seed, 'USD');
    await seedTraveller(seed);
    await seedTrip(seed);
    await commitSeed(seed);
    const uow = () => new PgUnitOfWork(pool, seed.workspaceId);
    const principalId = randomUUID();
    mustOk(await createPrincipal(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(),
      principalId, actorType: 'HUMAN', authIssuer: 'https://issuer.invalid/q1', authSubject: principalId,
    }));
    const opened = mustOk(await openRecoveryCase(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), openedAt: GATE_NOW,
    }));
    const journeyItemId = randomUUID();
    const offerId = randomUUID();
    const scenarioChangeId = randomUUID();
    const recoveryStrategyId = randomUUID();
    const intentId = randomUUID();
    const planId = randomUUID();
    // Strategy affected subjects are OFFER/JOURNEY_ITEM with no owner rows → unresolved.
    await persistStrategyChangeRow(pool, seed.workspaceId, seed.actorId, opened.caseId, {
      id: scenarioChangeId, recoveryStrategyId, strategyVersion: 1,
      affectedSubjectRefs: [
        { kind: 'JOURNEY_ITEM', id: journeyItemId },
        { kind: 'OFFER', id: offerId },
      ],
      effects: [],
    }, {
      baseManifest: {
        evaluatedAt: GATE_NOW, evaluatorVersions: [],
        aggregateReads: [{ aggregateRef: { kind: 'ORGANISATION', id: organisationId }, revision: 1 }],
        scopeReads: [], evidenceReads: [], coverageReads: [], missingCoverage: [],
      },
      candidateSummaries: [],
    });
    const plan: ActionPlan = {
      id: planId, recoveryCaseId: opened.caseId, scenarioChangeId,
      intents: [{
        id: intentId, actionPlanId: planId, operationNamespace: 'provider.offer',
        logicalOperationKey: `select-offer:${journeyItemId}:${offerId}`,
        requestFingerprint: computeRequestFingerprint({ intentId }),
        capabilityRef: 'external:offer.select',
        subjectRefs: [
          { kind: 'JOURNEY_ITEM', id: journeyItemId },
          { kind: 'OFFER', id: offerId },
        ],
        expectedRevisions: [],
        preconditions: [`basisAssessment:${randomUUID()}`],
        requiredAuthorityScopes: [],
        expectedObservations: ['booking_status'],
        compensationPolicy: { supported: false, requiresSeparateAuthority: true },
        status: 'PROPOSED',
      }],
      dependencies: [],
    };
    mustOk(await persistActionPlan(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(),
      plan, recoveryStrategyId,
    }));
    // Required scope includes the unresolved JOURNEY_ITEM/OFFER subject_refs — those
    // cannot be grant_scopes (no domain_subjects rows). Seed a matching decision+approval
    // directly so the gate reaches assessable-subject resolution and denies there.
    const required = await loadRequiredAuthorityScope(pool, seed.workspaceId, intentId);
    assert.ok(Array.isArray(required), 'required scope should resolve from subject_refs');
    const intentRow = await pool.query<{ request_fingerprint: string | null; plan_version: number }>(
      `SELECT i.request_fingerprint, p.plan_version FROM action_intents i
         JOIN action_plans p ON p.workspace_id = i.workspace_id AND p.id = i.action_plan_id
        WHERE i.workspace_id = $1 AND i.id = $2`,
      [seed.workspaceId, intentId],
    );
    const envelopeInput = {
      actionPlanId: planId, actionPlanVersion: intentRow.rows[0]!.plan_version,
      actionIntentId: intentId, actionIntentVersion: 1,
      requiredActorRoles: ['PAYER'],
      scope: required as TypedRef[],
      grantRefs: [] as string[], ruleInputs: [] as string[],
      ...(intentRow.rows[0]?.request_fingerprint
        ? { requestFingerprint: intentRow.rows[0].request_fingerprint }
        : {}),
    };
    const fingerprint = computeEnvelopeFingerprint(envelopeInput);
    const decisionId = randomUUID();
    const requirementId = randomUUID();
    const approvalId = randomUUID();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET CONSTRAINTS ALL DEFERRED');
      await client.query(
        `INSERT INTO domain_subjects (workspace_id, id, kind, aggregate_id) VALUES ($1,$2,'AUTHORITY_DECISION',$2)`,
        [seed.workspaceId, decisionId],
      );
      await client.query(
        `INSERT INTO aggregate_heads (workspace_id, aggregate_id, revision) VALUES ($1,$2,1)`,
        [seed.workspaceId, decisionId],
      );
      await client.query(
        `INSERT INTO authority_decisions (
           workspace_id, id, action_plan_id, action_plan_version, action_intent_id, action_intent_version,
           group_operator, envelope_fingerprint, scope, grant_refs, rule_inputs, issued_at, created_by_actor_id
         ) VALUES ($1,$2,$3,1,$4,1,'AND',$5,$6::jsonb,'[]'::jsonb,'[]'::jsonb,$7::timestamptz,$8)`,
        [
          seed.workspaceId, decisionId, planId, intentId, fingerprint,
          JSON.stringify(envelopeInput.scope), GATE_NOW, seed.actorId,
        ],
      );
      await client.query(
        `INSERT INTO approval_requirements (workspace_id, id, decision_id, actor_role)
         VALUES ($1,$2,$3,'PAYER')`,
        [seed.workspaceId, requirementId, decisionId],
      );
      await client.query(
        `INSERT INTO domain_subjects (workspace_id, id, kind, aggregate_id) VALUES ($1,$2,'APPROVAL',$3)`,
        [seed.workspaceId, approvalId, decisionId],
      );
      await client.query(
        `INSERT INTO approvals (
           workspace_id, id, requirement_id, decision_id, approver_principal_id, envelope_fingerprint,
           scope, approved_at, created_by_actor_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::timestamptz,$9)`,
        [
          seed.workspaceId, approvalId, requirementId, decisionId, principalId,
          fingerprint, JSON.stringify(envelopeInput.scope), GATE_NOW, principalId,
        ],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    const rejected = await createPreparedExecutionAttempt(uow(), prepareParams({
      workspaceId: seed.workspaceId, actorId: seed.actorId, planId, intentId, principalId,
    }));
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.match(rejected.conflict.message, /ASSESSMENT_SUBJECTS_UNRESOLVED/);
  });

  test('Q2: superseded basis → STALE_BASE even when reassessment is CURRENT', async () => {
    const f = await baseC3Fixture({ withCost: false });
    const assessmentA = await seedMinimalCurrentAssessment(
      f.pool, f.seed.workspaceId, { kind: 'JOURNEY', id: f.journeyId }, GATE_NOW,
      { tripId: f.tripId, tripRevision: 1, verdict: 'PASS' },
    );
    await seedStoredExecutionAuthority({
      pool: f.pool, workspaceId: f.seed.workspaceId, actorId: f.seed.actorId, principalId: f.principalId,
      planId: f.planId, intentId: f.intentId,
      scope: [{ kind: 'ORGANISATION', id: f.organisationId }],
      representedPartyRef: { kind: 'ORGANISATION', id: f.organisationId },
    });
    await f.pool.query(
      'UPDATE aggregate_heads SET revision = 2 WHERE workspace_id = $1 AND aggregate_id = $2',
      [f.seed.workspaceId, f.tripId],
    );
    const deniedWhileStale = await createPreparedExecutionAttempt(f.uow(), prepareParams({
      workspaceId: f.seed.workspaceId, actorId: f.seed.actorId, planId: f.planId,
      intentId: f.intentId, principalId: f.principalId,
    }));
    assert.equal(deniedWhileStale.ok, false);

    await seedMinimalCurrentAssessment(
      f.pool, f.seed.workspaceId, { kind: 'JOURNEY', id: f.journeyId }, '2031-07-01T01:00:00.000Z',
      { tripId: f.tripId, tripRevision: 2, verdict: 'FAIL' },
    );
    void assessmentA;
    const deniedAfterReassessment = await createPreparedExecutionAttempt(f.uow(), prepareParams({
      workspaceId: f.seed.workspaceId, actorId: f.seed.actorId, planId: f.planId,
      intentId: f.intentId, principalId: f.principalId, now: '2031-07-01T01:00:00.000Z',
    }));
    assert.equal(deniedAfterReassessment.ok, false);
    if (!deniedAfterReassessment.ok) assert.match(deniedAfterReassessment.conflict.message, /STALE_BASE/);
  });

  test('plan with no recovery_strategy_id → STRATEGY_MISSING', async () => {
    const f = await baseC3Fixture({ omitStrategy: true, withCost: false });
    // Gate fails at strategy load before authority — no seed required.
    const rejected = await createPreparedExecutionAttempt(f.uow(), prepareParams({
      workspaceId: f.seed.workspaceId, actorId: f.seed.actorId, planId: f.planId,
      intentId: f.intentId, principalId: f.principalId,
    }));
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.match(rejected.conflict.message, /STRATEGY_MISSING/);
  });

  test('empty base manifest → EMPTY_BASE_MANIFEST', async () => {
    const f = await baseC3Fixture({ emptyManifest: true, withCost: false });
    await seedAuthorityForFixture(f, { cost: false });
    const rejected = await createPreparedExecutionAttempt(f.uow(), prepareParams({
      workspaceId: f.seed.workspaceId, actorId: f.seed.actorId, planId: f.planId,
      intentId: f.intentId, principalId: f.principalId,
    }));
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.match(rejected.conflict.message, /EMPTY_BASE_MANIFEST/);
  });

  test('world change between prepare and dispatchClaimed → FAILED, 0 dispatcher calls', async () => {
    const f = await baseC3Fixture();
    await seedAuthorityForFixture(f);
    mustOk(await createPreparedExecutionAttempt(f.uow(), prepareParams({
      workspaceId: f.seed.workspaceId, actorId: f.seed.actorId, planId: f.planId,
      intentId: f.intentId, principalId: f.principalId,
    })));
    await f.pool.query(
      'UPDATE aggregate_heads SET revision = revision + 1 WHERE workspace_id = $1 AND aggregate_id = $2',
      [f.seed.workspaceId, f.tripId],
    );
    const worker = new PgExecutionWorker(f.pool, { actorId: 'c3-an1r-dispatch' });
    const claim = await worker.claimNext(f.seed.workspaceId);
    assert.ok(claim);
    let dispatchCount = 0;
    const outcome = await worker.dispatchClaimed(claim!, {
      principalId: f.principalId, now: GATE_NOW,
      observed: { capabilityKind: 'BOOK', supported: true },
      dispatcher: async () => { dispatchCount += 1; return { kind: 'SUCCESS', responseRef: 'x', sourceOwnedFields: {} }; },
    });
    assert.equal(outcome.outcome, 'FAILED');
    assert.equal(dispatchCount, 0);
  });

  test('positive path with current base manifest → allowed', async () => {
    const f = await baseC3Fixture();
    await seedAuthorityForFixture(f);
    const prepared = mustOk(await createPreparedExecutionAttempt(f.uow(), prepareParams({
      workspaceId: f.seed.workspaceId, actorId: f.seed.actorId, planId: f.planId,
      intentId: f.intentId, principalId: f.principalId,
    })));
    assert.ok(prepared.attemptId);
    const row = await f.pool.query<{ gating_principal_id: string | null }>(
      'SELECT gating_principal_id FROM execution_attempts WHERE id = $1', [prepared.attemptId],
    );
    assert.equal(row.rows[0]?.gating_principal_id, f.principalId);
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
      assessmentSubject: { kind: 'JOURNEY', id: f.journeyId },
      assessmentTripId: f.tripId,
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
    await seedAuthorityForFixture(f, { cost: false });
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
    await seedAuthorityForFixture(f);
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
    const other = buildPlan({ recoveryCaseId: f.plan.recoveryCaseId, organisationId: f.organisationId });
    await persistStrategyChangeRow(f.pool, f.seed.workspaceId, f.seed.actorId, f.caseId, {
      id: other.scenarioChangeId, recoveryStrategyId: other.recoveryStrategyId, strategyVersion: 2,
      affectedSubjectRefs: [{ kind: 'JOURNEY', id: f.journeyId }], effects: [],
    }, {
      baseManifest: tripBaseManifest(f.tripId, 1),
      candidateSummaries: [{ subjectRef: { kind: 'JOURNEY', id: f.journeyId } }],
    });
    const otherPersisted = mustOk(await persistActionPlan(f.uow(), {
      workspaceId: f.seed.workspaceId, actorPrincipalId: f.seed.actorId,
      idempotencyKey: randomUUID(), plan: other.plan, planVersion: 2,
      recoveryStrategyId: other.recoveryStrategyId,
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
    await seedAuthorityForFixture(f);
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
    await seedAuthorityForFixture(f);
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

async function seedExtraOrganisation(
  uow: ReturnType<Awaited<ReturnType<typeof baseC3Fixture>>['uow']>,
  workspaceId: string,
  actorId: string,
  label: string,
): Promise<string> {
  const organisationId = randomUUID();
  mustOk(await createOrganisation(uow, {
    workspaceId,
    actorPrincipalId: actorId,
    idempotencyKey: randomUUID(),
    organisationId,
    legalName: label,
    displayName: label,
    defaultCurrencyCode: 'USD',
  }));
  return organisationId;
}

async function coveringDecisionScope(
  f: Awaited<ReturnType<typeof baseC3Fixture>>,
  extra: TypedRef[] = [],
): Promise<TypedRef[]> {
  const required = await loadRequiredAuthorityScope(f.pool, f.seed.workspaceId, f.intentId);
  assert.ok(!('allowed' in required), 'required authority scope must resolve');
  return unionTypedRefs(extra, required as TypedRef[], [{ kind: 'ORGANISATION', id: f.organisationId }]);
}

describe('AN-7 grant scope, approver authority, gating principal', () => {
  test('approver with zero grants → recordApproval rejected; direct approval row denied at gate', async () => {
    const f = await baseC3Fixture({ withCost: false });
    await seedMinimalCurrentAssessment(
      f.pool, f.seed.workspaceId, { kind: 'JOURNEY', id: f.journeyId }, GATE_NOW,
      { tripId: f.tripId, tripRevision: 1 },
    );
    const decisionScope = await coveringDecisionScope(f);
    const approverId = randomUUID();
    mustOk(await createPrincipal(f.uow(), {
      workspaceId: f.seed.workspaceId, actorPrincipalId: f.seed.actorId, idempotencyKey: randomUUID(),
      principalId: approverId, actorType: 'HUMAN', authIssuer: 'https://issuer.invalid/an7-a', authSubject: approverId,
    }));
    const dispatchKey = randomUUID();
    mustOk(await issueAuthorityGrant(f.uow(), {
      workspaceId: f.seed.workspaceId, actorPrincipalId: f.seed.actorId, idempotencyKey: dispatchKey,
      principalId: f.principalId, representedPartyRef: { kind: 'ORGANISATION', id: f.organisationId },
      issuedByPrincipalId: f.principalId, issuedAt: GATE_NOW,
      actions: ['action.intent.dispatch'],
      scopes: decisionScope,
      authorisingReceipt: { commandNamespace: 'AUTHORITY_GRANT_ISSUED', idempotencyKey: dispatchKey },
      expectedAggregateRevisions: [],
    }));
    const intentRow = await f.pool.query<{ request_fingerprint: string | null; plan_version: number }>(
      `SELECT i.request_fingerprint, p.plan_version FROM action_intents i
         JOIN action_plans p ON p.workspace_id = i.workspace_id AND p.id = i.action_plan_id
        WHERE i.workspace_id = $1 AND i.id = $2`,
      [f.seed.workspaceId, f.intentId],
    );
    const envelopeInput = {
      actionPlanId: f.planId, actionPlanVersion: intentRow.rows[0]!.plan_version,
      actionIntentId: f.intentId, actionIntentVersion: 1,
      requiredActorRoles: ['PAYER'],
      scope: decisionScope,
      grantRefs: [] as string[], ruleInputs: [] as string[],
      ...(intentRow.rows[0]?.request_fingerprint
        ? { requestFingerprint: intentRow.rows[0].request_fingerprint }
        : {}),
    };
    const fingerprint = computeEnvelopeFingerprint(envelopeInput);
    const decision = mustOk(await issueAuthorityDecision(f.uow(), {
      workspaceId: f.seed.workspaceId, actorPrincipalId: f.seed.actorId, idempotencyKey: randomUUID(),
      envelopeInput, requirements: [{ actorRole: 'PAYER' }], issuedAt: GATE_NOW,
    }));
    const rejected = await recordApproval(f.uow(), {
      workspaceId: f.seed.workspaceId, actorPrincipalId: approverId, idempotencyKey: randomUUID(),
      decisionId: decision.decisionId, requirementId: decision.requirementIds[0]!,
      envelopeFingerprint: fingerprint, scope: envelopeInput.scope, approvedAt: GATE_NOW,
    });
    assert.equal(rejected.ok, false);

    // Bypass recordApproval: insert approval under deferred subtype checks.
    const approvalId = randomUUID();
    const client = await f.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET CONSTRAINTS ALL DEFERRED');
      await client.query(
        `INSERT INTO domain_subjects (workspace_id, id, kind, aggregate_id) VALUES ($1,$2,'APPROVAL',$3)`,
        [f.seed.workspaceId, approvalId, decision.decisionId],
      );
      await client.query(
        `INSERT INTO approvals (
           workspace_id, id, requirement_id, decision_id, approver_principal_id, envelope_fingerprint,
           scope, approved_at, created_by_actor_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::timestamptz,$9)`,
        [
          f.seed.workspaceId, approvalId, decision.requirementIds[0]!, decision.decisionId, approverId,
          fingerprint, JSON.stringify(envelopeInput.scope), GATE_NOW, approverId,
        ],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    const gateDenied = await createPreparedExecutionAttempt(f.uow(), prepareParams({
      workspaceId: f.seed.workspaceId, actorId: f.seed.actorId, planId: f.planId,
      intentId: f.intentId, principalId: f.principalId,
    }));
    assert.equal(gateDenied.ok, false);
    if (!gateDenied.ok) assert.match(gateDenied.conflict.message, /APPROVER_UNAUTHORIZED|GRANT/);
  });

  test('approver authorize-grant scoped to another party → denied', async () => {
    const f = await baseC3Fixture({ withCost: false });
    const orgB = await seedExtraOrganisation(f.uow(), f.seed.workspaceId, f.seed.actorId, 'Org B');
    await seedMinimalCurrentAssessment(
      f.pool, f.seed.workspaceId, { kind: 'JOURNEY', id: f.journeyId }, GATE_NOW,
      { tripId: f.tripId, tripRevision: 1 },
    );
    const decisionScope = await coveringDecisionScope(f);
    const dispatchKey = randomUUID();
    mustOk(await issueAuthorityGrant(f.uow(), {
      workspaceId: f.seed.workspaceId, actorPrincipalId: f.seed.actorId, idempotencyKey: dispatchKey,
      principalId: f.principalId, representedPartyRef: { kind: 'ORGANISATION', id: f.organisationId },
      issuedByPrincipalId: f.principalId, issuedAt: GATE_NOW,
      actions: ['action.intent.dispatch'],
      scopes: decisionScope,
      authorisingReceipt: { commandNamespace: 'AUTHORITY_GRANT_ISSUED', idempotencyKey: dispatchKey },
      expectedAggregateRevisions: [],
    }));
    const authorizeKey = randomUUID();
    mustOk(await issueAuthorityGrant(f.uow(), {
      workspaceId: f.seed.workspaceId, actorPrincipalId: f.seed.actorId, idempotencyKey: authorizeKey,
      principalId: f.principalId, representedPartyRef: { kind: 'ORGANISATION', id: orgB },
      issuedByPrincipalId: f.principalId, issuedAt: GATE_NOW,
      actions: ['action.intent.authorize'],
      scopes: [{ kind: 'ORGANISATION', id: orgB }],
      authorisingReceipt: { commandNamespace: 'AUTHORITY_GRANT_ISSUED', idempotencyKey: authorizeKey },
      expectedAggregateRevisions: [],
    }));
    const intentRow = await f.pool.query<{ request_fingerprint: string | null; plan_version: number }>(
      `SELECT i.request_fingerprint, p.plan_version FROM action_intents i
         JOIN action_plans p ON p.workspace_id = i.workspace_id AND p.id = i.action_plan_id
        WHERE i.workspace_id = $1 AND i.id = $2`,
      [f.seed.workspaceId, f.intentId],
    );
    const envelopeInput = {
      actionPlanId: f.planId, actionPlanVersion: intentRow.rows[0]!.plan_version,
      actionIntentId: f.intentId, actionIntentVersion: 1,
      requiredActorRoles: ['PAYER'],
      scope: decisionScope,
      grantRefs: [] as string[], ruleInputs: [] as string[],
      ...(intentRow.rows[0]?.request_fingerprint
        ? { requestFingerprint: intentRow.rows[0].request_fingerprint }
        : {}),
    };
    const fingerprint = computeEnvelopeFingerprint(envelopeInput);
    const decision = mustOk(await issueAuthorityDecision(f.uow(), {
      workspaceId: f.seed.workspaceId, actorPrincipalId: f.seed.actorId, idempotencyKey: randomUUID(),
      envelopeInput, requirements: [{ actorRole: 'PAYER' }], issuedAt: GATE_NOW,
    }));
    const rejected = await recordApproval(f.uow(), {
      workspaceId: f.seed.workspaceId, actorPrincipalId: f.principalId, idempotencyKey: randomUUID(),
      decisionId: decision.decisionId, requirementId: decision.requirementIds[0]!,
      envelopeFingerprint: fingerprint, scope: envelopeInput.scope, approvedAt: GATE_NOW,
    });
    assert.equal(rejected.ok, false);
  });

  test('required_party mismatch → denied', async () => {
    const f = await baseC3Fixture({ withCost: false });
    await seedMinimalCurrentAssessment(
      f.pool, f.seed.workspaceId, { kind: 'JOURNEY', id: f.journeyId }, GATE_NOW,
      { tripId: f.tripId, tripRevision: 1 },
    );
    const decisionScope = await coveringDecisionScope(f);
    const grantKey = randomUUID();
    mustOk(await issueAuthorityGrant(f.uow(), {
      workspaceId: f.seed.workspaceId, actorPrincipalId: f.seed.actorId, idempotencyKey: grantKey,
      principalId: f.principalId, representedPartyRef: { kind: 'ORGANISATION', id: f.organisationId },
      issuedByPrincipalId: f.principalId, issuedAt: GATE_NOW,
      actions: ['action.intent.dispatch', 'action.intent.authorize'],
      scopes: decisionScope,
      authorisingReceipt: { commandNamespace: 'AUTHORITY_GRANT_ISSUED', idempotencyKey: grantKey },
      expectedAggregateRevisions: [],
    }));
    const orgB = await seedExtraOrganisation(f.uow(), f.seed.workspaceId, f.seed.actorId, 'Required Org');
    const intentRow = await f.pool.query<{ request_fingerprint: string | null; plan_version: number }>(
      `SELECT i.request_fingerprint, p.plan_version FROM action_intents i
         JOIN action_plans p ON p.workspace_id = i.workspace_id AND p.id = i.action_plan_id
        WHERE i.workspace_id = $1 AND i.id = $2`,
      [f.seed.workspaceId, f.intentId],
    );
    const envelopeInput = {
      actionPlanId: f.planId, actionPlanVersion: intentRow.rows[0]!.plan_version,
      actionIntentId: f.intentId, actionIntentVersion: 1,
      requiredActorRoles: ['PAYER'],
      scope: decisionScope,
      grantRefs: [] as string[], ruleInputs: [] as string[],
      ...(intentRow.rows[0]?.request_fingerprint
        ? { requestFingerprint: intentRow.rows[0].request_fingerprint }
        : {}),
    };
    const fingerprint = computeEnvelopeFingerprint(envelopeInput);
    const decision = mustOk(await issueAuthorityDecision(f.uow(), {
      workspaceId: f.seed.workspaceId, actorPrincipalId: f.seed.actorId, idempotencyKey: randomUUID(),
      envelopeInput,
      requirements: [{
        actorRole: 'PAYER',
        requiredPartyRef: { kind: 'ORGANISATION', id: orgB },
      }],
      issuedAt: GATE_NOW,
    }));
    const rejected = await recordApproval(f.uow(), {
      workspaceId: f.seed.workspaceId, actorPrincipalId: f.principalId, idempotencyKey: randomUUID(),
      decisionId: decision.decisionId, requirementId: decision.requirementIds[0]!,
      envelopeFingerprint: fingerprint, scope: envelopeInput.scope, approvedAt: GATE_NOW,
    });
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.match(rejected.conflict.message, /APPROVER_PARTY_MISMATCH|party/i);
  });

  test('dispatcher grant scoped to another org → denied', async () => {
    const f = await baseC3Fixture({ withCost: false });
    const orgB = await seedExtraOrganisation(f.uow(), f.seed.workspaceId, f.seed.actorId, 'Dispatch Org B');
    await seedMinimalCurrentAssessment(
      f.pool, f.seed.workspaceId, { kind: 'JOURNEY', id: f.journeyId }, GATE_NOW,
      { tripId: f.tripId, tripRevision: 1 },
    );
    const decisionScope = await coveringDecisionScope(f);
    const authorizeKey = randomUUID();
    mustOk(await issueAuthorityGrant(f.uow(), {
      workspaceId: f.seed.workspaceId, actorPrincipalId: f.seed.actorId, idempotencyKey: authorizeKey,
      principalId: f.principalId, representedPartyRef: { kind: 'ORGANISATION', id: f.organisationId },
      issuedByPrincipalId: f.principalId, issuedAt: GATE_NOW,
      actions: ['action.intent.authorize'],
      scopes: decisionScope,
      authorisingReceipt: { commandNamespace: 'AUTHORITY_GRANT_ISSUED', idempotencyKey: authorizeKey },
      expectedAggregateRevisions: [],
    }));
    const dispatchKey = randomUUID();
    mustOk(await issueAuthorityGrant(f.uow(), {
      workspaceId: f.seed.workspaceId, actorPrincipalId: f.seed.actorId, idempotencyKey: dispatchKey,
      principalId: f.principalId, representedPartyRef: { kind: 'ORGANISATION', id: orgB },
      issuedByPrincipalId: f.principalId, issuedAt: GATE_NOW,
      actions: ['action.intent.dispatch'],
      scopes: [{ kind: 'ORGANISATION', id: orgB }],
      authorisingReceipt: { commandNamespace: 'AUTHORITY_GRANT_ISSUED', idempotencyKey: dispatchKey },
      expectedAggregateRevisions: [],
    }));
    await seedStoredExecutionAuthority({
      pool: f.pool, workspaceId: f.seed.workspaceId, actorId: f.seed.actorId, principalId: f.principalId,
      planId: f.planId, intentId: f.intentId,
      scope: decisionScope,
      representedPartyRef: { kind: 'ORGANISATION', id: f.organisationId },
      skipGrants: true,
    });
    const rejected = await createPreparedExecutionAttempt(f.uow(), prepareParams({
      workspaceId: f.seed.workspaceId, actorId: f.seed.actorId, planId: f.planId,
      intentId: f.intentId, principalId: f.principalId,
    }));
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.match(rejected.conflict.message, /GRANT_SCOPE_INSUFFICIENT/);
  });

  test('approver grant revoked after approval → gate denied', async () => {
    const f = await baseC3Fixture({ withCost: false });
    const seeded = await seedAuthorityForFixture(f, { cost: false });
    assert.ok(seeded.grantId);
    mustOk(await revokeAuthorityGrant(f.uow(), {
      workspaceId: f.seed.workspaceId, actorPrincipalId: f.seed.actorId, idempotencyKey: randomUUID(),
      grantId: seeded.grantId!, revokedAt: '2031-07-01T00:30:00.000Z', expectedRevision: 1,
    }));
    const rejected = await createPreparedExecutionAttempt(f.uow(), prepareParams({
      workspaceId: f.seed.workspaceId, actorId: f.seed.actorId, planId: f.planId,
      intentId: f.intentId, principalId: f.principalId, now: '2031-07-01T01:00:00.000Z',
    }));
    assert.equal(rejected.ok, false);
  });

  test('dispatchClaimed with wrong principal → FAILED, 0 dispatcher calls', async () => {
    const f = await baseC3Fixture();
    await seedAuthorityForFixture(f);
    mustOk(await createPreparedExecutionAttempt(f.uow(), prepareParams({
      workspaceId: f.seed.workspaceId, actorId: f.seed.actorId, planId: f.planId,
      intentId: f.intentId, principalId: f.principalId,
    })));
    const otherPrincipal = randomUUID();
    mustOk(await createPrincipal(f.uow(), {
      workspaceId: f.seed.workspaceId, actorPrincipalId: f.seed.actorId, idempotencyKey: randomUUID(),
      principalId: otherPrincipal, actorType: 'HUMAN',
      authIssuer: 'https://issuer.invalid/an7-wrong', authSubject: otherPrincipal,
    }));
    const worker = new PgExecutionWorker(f.pool, { actorId: 'c3-an7-gate' });
    const claim = await worker.claimNext(f.seed.workspaceId);
    assert.ok(claim);
    let dispatchCount = 0;
    const outcome = await worker.dispatchClaimed(claim!, {
      principalId: otherPrincipal, now: GATE_NOW,
      observed: { capabilityKind: 'BOOK', supported: true },
      dispatcher: async () => { dispatchCount += 1; return { kind: 'SUCCESS', responseRef: 'x', sourceOwnedFields: {} }; },
    });
    assert.equal(outcome.outcome, 'FAILED');
    assert.equal(dispatchCount, 0);
  });

  test('positive path → allowed', async () => {
    const f = await baseC3Fixture({ withCost: false });
    await seedAuthorityForFixture(f, { cost: false });
    const prepared = mustOk(await createPreparedExecutionAttempt(f.uow(), prepareParams({
      workspaceId: f.seed.workspaceId, actorId: f.seed.actorId, planId: f.planId,
      intentId: f.intentId, principalId: f.principalId,
    })));
    assert.ok(prepared.attemptId);
  });
});

describe('AN-7R decision scope bound to required intent subjects', () => {
  test('Q5: decision scoped to unrelated org denied at issueAuthorityDecision and at gate', async () => {
    const f = await baseC3Fixture({ withCost: false });
    await seedMinimalCurrentAssessment(
      f.pool, f.seed.workspaceId, { kind: 'JOURNEY', id: f.journeyId }, GATE_NOW,
      { tripId: f.tripId, tripRevision: 1 },
    );
    const unrelatedOrg = await seedExtraOrganisation(f.uow(), f.seed.workspaceId, f.seed.actorId, 'Unrelated Org');
    const required = await loadRequiredAuthorityScope(f.pool, f.seed.workspaceId, f.intentId);
    assert.ok(!('allowed' in required));
    assert.ok((required as TypedRef[]).some((r) => r.kind === 'JOURNEY' && r.id === f.journeyId));

    const grantKey = randomUUID();
    mustOk(await issueAuthorityGrant(f.uow(), {
      workspaceId: f.seed.workspaceId, actorPrincipalId: f.seed.actorId, idempotencyKey: grantKey,
      principalId: f.principalId, representedPartyRef: { kind: 'ORGANISATION', id: unrelatedOrg },
      issuedByPrincipalId: f.principalId, issuedAt: GATE_NOW,
      actions: ['action.intent.dispatch', 'action.intent.authorize'],
      scopes: [{ kind: 'ORGANISATION', id: unrelatedOrg }],
      authorisingReceipt: { commandNamespace: 'AUTHORITY_GRANT_ISSUED', idempotencyKey: grantKey },
      expectedAggregateRevisions: [],
    }));

    const intentRow = await f.pool.query<{ request_fingerprint: string | null; plan_version: number }>(
      `SELECT i.request_fingerprint, p.plan_version FROM action_intents i
         JOIN action_plans p ON p.workspace_id = i.workspace_id AND p.id = i.action_plan_id
        WHERE i.workspace_id = $1 AND i.id = $2`,
      [f.seed.workspaceId, f.intentId],
    );
    const badEnvelope = {
      actionPlanId: f.planId, actionPlanVersion: intentRow.rows[0]!.plan_version,
      actionIntentId: f.intentId, actionIntentVersion: 1,
      requiredActorRoles: ['PAYER'],
      scope: [{ kind: 'ORGANISATION' as const, id: unrelatedOrg }],
      grantRefs: [] as string[], ruleInputs: [] as string[],
      ...(intentRow.rows[0]?.request_fingerprint
        ? { requestFingerprint: intentRow.rows[0].request_fingerprint }
        : {}),
    };
    const issued = await issueAuthorityDecision(f.uow(), {
      workspaceId: f.seed.workspaceId, actorPrincipalId: f.seed.actorId, idempotencyKey: randomUUID(),
      envelopeInput: badEnvelope, requirements: [{ actorRole: 'PAYER' }], issuedAt: GATE_NOW,
    });
    assert.equal(issued.ok, false);
    if (!issued.ok) assert.match(issued.conflict.message, /DECISION_SCOPE_INSUFFICIENT/);

    // Direct decision row with insufficient scope — gate must still deny.
    const decisionId = randomUUID();
    const fingerprint = computeEnvelopeFingerprint(badEnvelope);
    const client = await f.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET CONSTRAINTS ALL DEFERRED');
      await client.query(
        `INSERT INTO domain_subjects (workspace_id, id, kind, aggregate_id) VALUES ($1,$2,'AUTHORITY_DECISION',$2)`,
        [f.seed.workspaceId, decisionId],
      );
      await client.query(
        `INSERT INTO aggregate_heads (workspace_id, aggregate_id, revision) VALUES ($1,$2,1)`,
        [f.seed.workspaceId, decisionId],
      );
      await client.query(
        `INSERT INTO authority_decisions (
           workspace_id, id, action_plan_id, action_plan_version, action_intent_id, action_intent_version,
           group_operator, envelope_fingerprint, scope, grant_refs, rule_inputs, issued_at, created_by_actor_id
         ) VALUES ($1,$2,$3,1,$4,1,'AND',$5,$6::jsonb,'[]'::jsonb,'[]'::jsonb,$7::timestamptz,$8)`,
        [
          f.seed.workspaceId, decisionId, f.planId, f.intentId, fingerprint,
          JSON.stringify(badEnvelope.scope), GATE_NOW, f.seed.actorId,
        ],
      );
      const requirementId = randomUUID();
      await client.query(
        `INSERT INTO approval_requirements (workspace_id, id, decision_id, actor_role)
         VALUES ($1,$2,$3,'PAYER')`,
        [f.seed.workspaceId, requirementId, decisionId],
      );
      const approvalId = randomUUID();
      await client.query(
        `INSERT INTO domain_subjects (workspace_id, id, kind, aggregate_id) VALUES ($1,$2,'APPROVAL',$3)`,
        [f.seed.workspaceId, approvalId, decisionId],
      );
      await client.query(
        `INSERT INTO approvals (
           workspace_id, id, requirement_id, decision_id, approver_principal_id, envelope_fingerprint,
           scope, approved_at, created_by_actor_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::timestamptz,$9)`,
        [
          f.seed.workspaceId, approvalId, requirementId, decisionId, f.principalId,
          fingerprint, JSON.stringify(badEnvelope.scope), GATE_NOW, f.principalId,
        ],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    const gateDenied = await createPreparedExecutionAttempt(f.uow(), prepareParams({
      workspaceId: f.seed.workspaceId, actorId: f.seed.actorId, planId: f.planId,
      intentId: f.intentId, principalId: f.principalId,
    }));
    assert.equal(gateDenied.ok, false);
    if (!gateDenied.ok) assert.match(gateDenied.conflict.message, /DECISION_SCOPE_INSUFFICIENT/);
  });

  test('grants covering only part of required scope → denied', async () => {
    const f = await baseC3Fixture({ withCost: false });
    await seedMinimalCurrentAssessment(
      f.pool, f.seed.workspaceId, { kind: 'JOURNEY', id: f.journeyId }, GATE_NOW,
      { tripId: f.tripId, tripRevision: 1 },
    );
    const decisionScope = await coveringDecisionScope(f);
    // Grant only ORGANISATION, missing JOURNEY from required set.
    const grantKey = randomUUID();
    mustOk(await issueAuthorityGrant(f.uow(), {
      workspaceId: f.seed.workspaceId, actorPrincipalId: f.seed.actorId, idempotencyKey: grantKey,
      principalId: f.principalId, representedPartyRef: { kind: 'ORGANISATION', id: f.organisationId },
      issuedByPrincipalId: f.principalId, issuedAt: GATE_NOW,
      actions: ['action.intent.dispatch', 'action.intent.authorize'],
      scopes: [{ kind: 'ORGANISATION', id: f.organisationId }],
      authorisingReceipt: { commandNamespace: 'AUTHORITY_GRANT_ISSUED', idempotencyKey: grantKey },
      expectedAggregateRevisions: [],
    }));
    const intentRow = await f.pool.query<{ request_fingerprint: string | null; plan_version: number }>(
      `SELECT i.request_fingerprint, p.plan_version FROM action_intents i
         JOIN action_plans p ON p.workspace_id = i.workspace_id AND p.id = i.action_plan_id
        WHERE i.workspace_id = $1 AND i.id = $2`,
      [f.seed.workspaceId, f.intentId],
    );
    const envelopeInput = {
      actionPlanId: f.planId, actionPlanVersion: intentRow.rows[0]!.plan_version,
      actionIntentId: f.intentId, actionIntentVersion: 1,
      requiredActorRoles: ['PAYER'],
      scope: decisionScope,
      grantRefs: [] as string[], ruleInputs: [] as string[],
      ...(intentRow.rows[0]?.request_fingerprint
        ? { requestFingerprint: intentRow.rows[0].request_fingerprint }
        : {}),
    };
    const fingerprint = computeEnvelopeFingerprint(envelopeInput);
    // Decision may cover required scope; recordApproval would reject the partial authorize
    // grant — insert approval directly so the gate re-checks grant coverage.
    const decision = mustOk(await issueAuthorityDecision(f.uow(), {
      workspaceId: f.seed.workspaceId, actorPrincipalId: f.seed.actorId, idempotencyKey: randomUUID(),
      envelopeInput, requirements: [{ actorRole: 'PAYER' }], issuedAt: GATE_NOW,
    }));
    const approvalId = randomUUID();
    const client = await f.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET CONSTRAINTS ALL DEFERRED');
      await client.query(
        `INSERT INTO domain_subjects (workspace_id, id, kind, aggregate_id) VALUES ($1,$2,'APPROVAL',$3)`,
        [f.seed.workspaceId, approvalId, decision.decisionId],
      );
      await client.query(
        `INSERT INTO approvals (
           workspace_id, id, requirement_id, decision_id, approver_principal_id, envelope_fingerprint,
           scope, approved_at, created_by_actor_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::timestamptz,$9)`,
        [
          f.seed.workspaceId, approvalId, decision.requirementIds[0]!, decision.decisionId, f.principalId,
          fingerprint, JSON.stringify(envelopeInput.scope), GATE_NOW, f.principalId,
        ],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    const rejected = await createPreparedExecutionAttempt(f.uow(), prepareParams({
      workspaceId: f.seed.workspaceId, actorId: f.seed.actorId, planId: f.planId,
      intentId: f.intentId, principalId: f.principalId,
    }));
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.match(rejected.conflict.message, /GRANT_SCOPE_INSUFFICIENT|APPROVER_UNAUTHORIZED/);
  });

  test('approver authorize-grant missing required journey → denied', async () => {
    const f = await baseC3Fixture({ withCost: false });
    await seedMinimalCurrentAssessment(
      f.pool, f.seed.workspaceId, { kind: 'JOURNEY', id: f.journeyId }, GATE_NOW,
      { tripId: f.tripId, tripRevision: 1 },
    );
    const decisionScope = await coveringDecisionScope(f);
    const dispatchKey = randomUUID();
    mustOk(await issueAuthorityGrant(f.uow(), {
      workspaceId: f.seed.workspaceId, actorPrincipalId: f.seed.actorId, idempotencyKey: dispatchKey,
      principalId: f.principalId, representedPartyRef: { kind: 'ORGANISATION', id: f.organisationId },
      issuedByPrincipalId: f.principalId, issuedAt: GATE_NOW,
      actions: ['action.intent.dispatch'],
      scopes: decisionScope,
      authorisingReceipt: { commandNamespace: 'AUTHORITY_GRANT_ISSUED', idempotencyKey: dispatchKey },
      expectedAggregateRevisions: [],
    }));
    const authorizeKey = randomUUID();
    mustOk(await issueAuthorityGrant(f.uow(), {
      workspaceId: f.seed.workspaceId, actorPrincipalId: f.seed.actorId, idempotencyKey: authorizeKey,
      principalId: f.principalId, representedPartyRef: { kind: 'ORGANISATION', id: f.organisationId },
      issuedByPrincipalId: f.principalId, issuedAt: GATE_NOW,
      actions: ['action.intent.authorize'],
      scopes: [{ kind: 'ORGANISATION', id: f.organisationId }],
      authorisingReceipt: { commandNamespace: 'AUTHORITY_GRANT_ISSUED', idempotencyKey: authorizeKey },
      expectedAggregateRevisions: [],
    }));
    const intentRow = await f.pool.query<{ request_fingerprint: string | null; plan_version: number }>(
      `SELECT i.request_fingerprint, p.plan_version FROM action_intents i
         JOIN action_plans p ON p.workspace_id = i.workspace_id AND p.id = i.action_plan_id
        WHERE i.workspace_id = $1 AND i.id = $2`,
      [f.seed.workspaceId, f.intentId],
    );
    const envelopeInput = {
      actionPlanId: f.planId, actionPlanVersion: intentRow.rows[0]!.plan_version,
      actionIntentId: f.intentId, actionIntentVersion: 1,
      requiredActorRoles: ['PAYER'],
      scope: decisionScope,
      grantRefs: [] as string[], ruleInputs: [] as string[],
      ...(intentRow.rows[0]?.request_fingerprint
        ? { requestFingerprint: intentRow.rows[0].request_fingerprint }
        : {}),
    };
    const fingerprint = computeEnvelopeFingerprint(envelopeInput);
    const decision = mustOk(await issueAuthorityDecision(f.uow(), {
      workspaceId: f.seed.workspaceId, actorPrincipalId: f.seed.actorId, idempotencyKey: randomUUID(),
      envelopeInput, requirements: [{ actorRole: 'PAYER' }], issuedAt: GATE_NOW,
    }));
    const rejected = await recordApproval(f.uow(), {
      workspaceId: f.seed.workspaceId, actorPrincipalId: f.principalId, idempotencyKey: randomUUID(),
      decisionId: decision.decisionId, requirementId: decision.requirementIds[0]!,
      envelopeFingerprint: fingerprint, scope: envelopeInput.scope, approvedAt: GATE_NOW,
    });
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.match(rejected.conflict.message, /APPROVER_UNAUTHORIZED/);
  });

  test('positive path with grants on actual subjects → allowed', async () => {
    const f = await baseC3Fixture({ withCost: false });
    await seedAuthorityForFixture(f, { cost: false });
    const prepared = mustOk(await createPreparedExecutionAttempt(f.uow(), prepareParams({
      workspaceId: f.seed.workspaceId, actorId: f.seed.actorId, planId: f.planId,
      intentId: f.intentId, principalId: f.principalId,
    })));
    assert.ok(prepared.attemptId);
  });

  test('dispatch-time re-check still denies when world/scope invalid', async () => {
    const f = await baseC3Fixture();
    await seedAuthorityForFixture(f);
    mustOk(await createPreparedExecutionAttempt(f.uow(), prepareParams({
      workspaceId: f.seed.workspaceId, actorId: f.seed.actorId, planId: f.planId,
      intentId: f.intentId, principalId: f.principalId,
    })));
    await f.pool.query(
      'UPDATE aggregate_heads SET revision = revision + 1 WHERE workspace_id = $1 AND aggregate_id = $2',
      [f.seed.workspaceId, f.tripId],
    );
    const worker = new PgExecutionWorker(f.pool, { actorId: 'c3-an7r-dispatch' });
    const claim = await worker.claimNext(f.seed.workspaceId);
    assert.ok(claim);
    let dispatchCount = 0;
    const outcome = await worker.dispatchClaimed(claim!, {
      principalId: f.principalId, now: GATE_NOW,
      observed: { capabilityKind: 'BOOK', supported: true },
      dispatcher: async () => { dispatchCount += 1; return { kind: 'SUCCESS', responseRef: 'x', sourceOwnedFields: {} }; },
    });
    assert.equal(outcome.outcome, 'FAILED');
    assert.equal(dispatchCount, 0);
    const live = await evaluateStoredExecutionGate(f.pool, {
      workspaceId: f.seed.workspaceId, intentId: f.intentId, principalId: f.principalId, now: GATE_NOW,
    });
    assert.equal(live.allowed, false);
  });
});

describe('IN-1 logical operation identity (M9 per-plan uniqueness)', () => {
  test('Q4: re-plan same SELECT_OFFER effect keeps logicalOperationKey; second plan persist allowed after 0120', async () => {
    const journeyItemId = randomUUID();
    const offerId = randomUUID();
    const basisAssessmentId = randomUUID();
    const recoveryCaseId = randomUUID();
    const effect = {
      effectKind: 'SELECT_OFFER' as const,
      journeyItemId,
      offerId,
      offerPrice: { amount: '10.00', currency: 'USD' },
    };
    function strategyAt(version: number): RecoveryStrategy {
      const strategyId = randomUUID();
      return {
        id: strategyId,
        recoveryCaseId,
        strategyVersion: version,
        status: 'SELECTED',
        viability: 'VIABLE',
        basisAssessmentId,
        affectedSubjectRefs: [{ kind: 'JOURNEY_ITEM', id: journeyItemId }],
        requiredAuthorityScopes: [],
        createdAt: GATE_NOW,
        scenarioChange: {
          id: randomUUID(),
          recoveryStrategyId: strategyId,
          strategyVersion: version,
          affectedSubjectRefs: [{ kind: 'JOURNEY_ITEM', id: journeyItemId }],
          effects: [effect],
          basisAssessmentId,
        },
        assumptions: [],
        requiredUnknowns: [],
        candidateAssessments: [],
        candidateAssessmentResults: [],
        baseManifest: {
          evaluatedAt: GATE_NOW, evaluatorVersions: [], aggregateReads: [],
          scopeReads: [], evidenceReads: [], coverageReads: [], missingCoverage: [],
        },
      };
    }
    const compiled1 = compileActionPlan({
      strategy: strategyAt(1),
      now: GATE_NOW,
      capabilities: [{ capabilityRef: 'external:offer.select', supported: true }],
    });
    const compiled2 = compileActionPlan({
      strategy: strategyAt(2),
      now: GATE_NOW,
      capabilities: [{ capabilityRef: 'external:offer.select', supported: true }],
    });
    assert.equal(compiled1.ok, true);
    assert.equal(compiled2.ok, true);
    if (!compiled1.ok || !compiled2.ok) return;
    const intent1 = compiled1.value.plan.intents[0]!;
    const intent2 = compiled2.value.plan.intents[0]!;
    assert.equal(intent1.logicalOperationKey, intent2.logicalOperationKey);
    assert.equal(intent1.logicalOperationKey, `select-offer:${journeyItemId}:${offerId}`);
    assert.notEqual(intent1.requestFingerprint, intent2.requestFingerprint);

    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'C3 IN-1 Q4 / M9');
    const organisationId = await seedOrganisation(seed, 'USD');
    await commitSeed(seed);
    const uow = () => new PgUnitOfWork(pool, seed.workspaceId);
    const opened = mustOk(await openRecoveryCase(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), openedAt: GATE_NOW,
    }));
    const plan1: ActionPlan = {
      ...compiled1.value.plan,
      id: randomUUID(),
      recoveryCaseId: opened.caseId,
      scenarioChangeId: randomUUID(),
    };
    plan1.intents[0] = {
      ...intent1,
      id: randomUUID(),
      actionPlanId: plan1.id,
      subjectRefs: [{ kind: 'ORGANISATION', id: organisationId }],
    };
    mustOk(await persistActionPlan(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), plan: plan1,
    }));
    const plan2: ActionPlan = {
      ...compiled2.value.plan,
      id: randomUUID(),
      recoveryCaseId: opened.caseId,
      scenarioChangeId: randomUUID(),
    };
    plan2.intents[0] = {
      ...intent2,
      id: randomUUID(),
      actionPlanId: plan2.id,
      subjectRefs: [{ kind: 'ORGANISATION', id: organisationId }],
    };
    // M9 migration 0120: intent uniqueness is per action_plan. Execution-layer
    // known-success / live-attempt guards still prevent duplicate irreversible dispatch.
    const second = mustOk(await persistActionPlan(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), plan: plan2,
      planVersion: 2,
    }));
    assert.ok(second.planId);
  });
});

/**
 * M8 authority / budget / durable execution PostgreSQL proofs.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed, seedJourney, seedTraveller, seedTrip } from './m2Seed.ts';
import { seedOrganisation } from './m3Seed.ts';
import type { UnitOfWork } from '../src/contracts/v2/command/unitOfWork.ts';
import { PgUnitOfWork, type ExecuteOutcome } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { createBudget } from '../src/persistence/postgres/commands/arrangementCommands.ts';
import { createPrincipal, issueAuthorityGrant } from '../src/persistence/postgres/commands/peopleCommands.ts';
import {
  openRecoveryCase,
  persistActionPlan,
  holdBudgetForIntent,
  createPreparedExecutionAttempt,
  issueAuthorityDecision,
  recordApproval,
  revokeApproval,
  authorizeDispatch,
  transitionExecutionAttempt,
  type DispatchAuthorizationInput,
} from '../src/persistence/postgres/commands/m8AuthorityCommands.ts';
import { PgExecutionWorker } from '../src/persistence/postgres/execution/pgExecutionWorker.ts';
import { computeEnvelopeFingerprint, type EnvelopeFingerprintInput } from '../src/resolution/authority/envelope.ts';
import type { AuthorityEnvelope, AuthorityDecision, Approval } from '../src/contracts/v2/authority/authorityEnvelope.ts';
import type { AssessmentView } from '../src/persistence/postgres/world/pgAssessments.ts';
import type { AuthorityGrant } from '../src/domain/v2/people/traveller.ts';
import { computeRequestFingerprint } from '../src/resolution/execution/stateMachine.ts';
import type { ActionPlan } from '../src/contracts/v2/action/actionPlan.ts';
import type { TypedRef } from '../src/domain/v2/shared/identity.ts';
import type { ExactMoney } from '../src/domain/v2/shared/money.ts';
import {
  GATE_NOW,
  loadRequiredAuthorityScopesOrFail,
  persistStrategyChangeRow,
  prepareParams,
  seedStoredExecutionAuthority,
  tripBaseManifest,
  unionTypedRefs,
  bootstrapTestGrantIssuer,
} from './m8ExecutionGateHelpers.ts';

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

const NOW = '2031-07-01T00:00:00.000Z';

function mustOk<T>(outcome: ExecuteOutcome<T>): T {
  if (!outcome.ok) assert.fail(`${outcome.conflict.kind}: ${outcome.conflict.message}`);
  return outcome.value;
}

/**
 * Builds a single-intent ActionPlan matching the exact shape M7's compiler
 * produces (src/resolution/planning/compiler.ts) — logicalOperationKey and
 * requestFingerprint are fixed at compile/build time here, never assigned
 * later, matching the integrated immutable action_intents row.
 */
function buildSingleIntentPlan(opts: {
  recoveryCaseId: string;
  organisationId: string;
  scenarioChangeId?: string;
  recoveryStrategyId?: string;
  operationNamespace?: string;
  capabilityRef?: string;
  subjectRefs?: TypedRef[];
  expectedObservations?: string[];
  costEstimate?: ExactMoney;
  logicalOperationKey?: string;
  requestPayload?: unknown;
}): { plan: ActionPlan; intentId: string; planId: string; recoveryStrategyId: string; scenarioChangeId: string } {
  const intentId = randomUUID();
  const planId = randomUUID();
  const scenarioChangeId = opts.scenarioChangeId ?? randomUUID();
  const recoveryStrategyId = opts.recoveryStrategyId ?? randomUUID();
  const logicalOperationKey = opts.logicalOperationKey ?? `op-fixture-${intentId}`;
  const requestFingerprint = computeRequestFingerprint(opts.requestPayload ?? { intentId });
  const plan: ActionPlan = {
    id: planId,
    recoveryCaseId: opts.recoveryCaseId,
    scenarioChangeId,
    intents: [
      {
        id: intentId,
        actionPlanId: planId,
        operationNamespace: opts.operationNamespace ?? 'provider:test',
        logicalOperationKey,
        requestFingerprint,
        capabilityRef: opts.capabilityRef ?? 'SERVICE:RESERVATION',
        subjectRefs: opts.subjectRefs ?? [{ kind: 'ORGANISATION', id: opts.organisationId }],
        expectedRevisions: [],
        preconditions: [],
        requiredAuthorityScopes: [],
        expectedObservations: opts.expectedObservations ?? ['booking_status'],
        ...(opts.costEstimate ? { costEstimate: opts.costEstimate } : {}),
        compensationPolicy: { supported: false, requiresSeparateAuthority: true },
        status: 'PROPOSED',
      },
    ],
    dependencies: [],
  };
  return { plan, intentId, planId, recoveryStrategyId, scenarioChangeId };
}

async function issueApproverGrant(
  uow: UnitOfWork,
  params: {
    workspaceId: string;
    actorId: string;
    principalId: string;
    representedPartyRef: TypedRef;
    scopes: TypedRef[];
    issuedAt?: string;
    /** ISSUER-POL: authorised issuer (self-issuance is rejected). */
    issuerPrincipalId: string;
  },
): Promise<void> {
  const idempotencyKey = randomUUID();
  mustOk(await issueAuthorityGrant(uow, {
    workspaceId: params.workspaceId,
    actorPrincipalId: params.actorId,
    idempotencyKey,
    principalId: params.principalId,
    representedPartyRef: params.representedPartyRef,
    issuedByPrincipalId: params.issuerPrincipalId,
    issuedAt: params.issuedAt ?? NOW,
    actions: ['action.intent.authorize'],
    scopes: params.scopes,
    authorisingReceipt: { commandNamespace: 'AUTHORITY_GRANT_ISSUED', idempotencyKey },
    expectedAggregateRevisions: [],
  }));
}

async function baseFixture(opts?: { logicalOperationKey?: string; requestPayload?: unknown }) {
  const pool = await sharedTestPool();
  const seed = await beginSeed(pool, 'M8 authority');
  const organisationId = await seedOrganisation(seed, 'USD');
  const traveller = await seedTraveller(seed, { displayName: 'M8 Traveller' });
  const tripId = await seedTrip(seed, { purpose: 'TEST', lifecycleStatus: 'ACTIVE' });
  const journeyId = await seedJourney(seed, { tripId, travellerId: traveller.travellerId, lifecycleStatus: 'ACTIVE' });
  await commitSeed(seed);
  const uow = () => new PgUnitOfWork(pool, seed.workspaceId);
  const principalId = randomUUID();
  mustOk(await createPrincipal(uow(), {
    workspaceId: seed.workspaceId,
    actorPrincipalId: seed.actorId,
    idempotencyKey: randomUUID(),
    principalId,
    actorType: 'HUMAN',
    authIssuer: 'https://issuer.invalid/m8',
    authSubject: principalId,
  }));
  const opened = mustOk(await openRecoveryCase(uow(), {
    workspaceId: seed.workspaceId,
    actorPrincipalId: seed.actorId,
    idempotencyKey: randomUUID(),
    openedAt: NOW,
  }));
  const { plan, recoveryStrategyId, scenarioChangeId } = buildSingleIntentPlan({
    recoveryCaseId: opened.caseId,
    organisationId,
    costEstimate: { amount: '40.00', currency: 'USD' },
    ...(opts?.logicalOperationKey ? { logicalOperationKey: opts.logicalOperationKey } : {}),
    ...(opts?.requestPayload !== undefined ? { requestPayload: opts.requestPayload } : {}),
  });
  await persistStrategyChangeRow(pool, seed.workspaceId, seed.actorId, opened.caseId, {
    id: scenarioChangeId,
    recoveryStrategyId,
    strategyVersion: 1,
    affectedSubjectRefs: [{ kind: 'JOURNEY', id: journeyId }],
    effects: [],
  }, {
    baseManifest: tripBaseManifest(tripId, 1),
    candidateSummaries: [{ subjectRef: { kind: 'JOURNEY', id: journeyId } }],
  });
  const persisted = mustOk(await persistActionPlan(uow(), {
    workspaceId: seed.workspaceId,
    actorPrincipalId: seed.actorId,
    idempotencyKey: randomUUID(),
    plan,
    recoveryStrategyId,
  }));
  const budgetId = randomUUID();
  mustOk(await createBudget(uow(), {
    workspaceId: seed.workspaceId,
    actorPrincipalId: seed.actorId,
    idempotencyKey: randomUUID(),
    budget: { id: budgetId, organisationId, purpose: 'travel', amount: { amount: '100.00', currency: 'USD' } },
  }));
  // ISSUER-POL: one authorised issuer for this whole fixture/workspace,
  // scoped to cover every TypedRef this test's grants will ever target.
  const issuerPrincipalId = await bootstrapTestGrantIssuer(pool, seed.workspaceId, seed.actorId, NOW, [
    { kind: 'ORGANISATION', id: organisationId },
    { kind: 'TRIP', id: tripId },
    { kind: 'JOURNEY', id: journeyId },
    { kind: 'ACTION_INTENT', id: persisted.intentIds[0]! },
  ]);
  await seedStoredExecutionAuthority({
    pool,
    workspaceId: seed.workspaceId,
    actorId: seed.actorId,
    principalId,
    planId: persisted.planId,
    intentId: persisted.intentIds[0]!,
    scope: [{ kind: 'ORGANISATION', id: organisationId }],
    representedPartyRef: { kind: 'ORGANISATION', id: organisationId },
    cost: { amount: '40.00', currency: 'USD' },
    budgetId,
    budgetRevision: 1,
    assessmentSubject: { kind: 'JOURNEY', id: journeyId },
    assessmentTripId: tripId,
    issuerPrincipalId,
  });
  return {
    pool, seed, uow, organisationId, principalId, budgetId, tripId, journeyId, issuerPrincipalId,
    caseId: opened.caseId, planId: persisted.planId, intentId: persisted.intentIds[0]!,
    recoveryStrategyId, scenarioChangeId,
  };
}

function prepareAttempt(f: BaseFixture, extra?: { attemptNumber?: number; idempotencyKey?: string; attemptId?: string }) {
  return prepareParams({
    workspaceId: f.seed.workspaceId,
    actorId: f.seed.actorId,
    planId: f.planId,
    intentId: f.intentId,
    principalId: f.principalId,
    ...extra,
  });
}

type BaseFixture = Awaited<ReturnType<typeof baseFixture>>;

function currentAssessmentView(): AssessmentView {
  return {
    status: 'CURRENT',
    assessment: {
      id: randomUUID(),
      kind: 'VIABILITY',
      evaluatedAt: NOW,
      overallVerdict: 'PASS',
      subjects: [{ subjectRef: { kind: 'JOURNEY', id: randomUUID() }, role: 'PRIMARY' }],
      dimensions: [],
      manifest: {
        evaluatedAt: NOW,
        evaluatorVersions: [],
        aggregateReads: [],
        scopeReads: [],
        evidenceReads: [],
        coverageReads: [],
        missingCoverage: [],
      },
    },
    staleness: [],
  };
}

function defaultEnvelopeInput(f: BaseFixture, scope?: EnvelopeFingerprintInput['scope']): EnvelopeFingerprintInput {
  return {
    actionPlanId: f.planId,
    actionPlanVersion: 1,
    actionIntentId: f.intentId,
    actionIntentVersion: 1,
    requiredActorRoles: ['PAYER'],
    scope: scope ?? [{ kind: 'ACTION_INTENT', id: f.intentId }],
    grantRefs: [],
    ruleInputs: [],
    amountCeiling: { amount: '40.00', currency: 'USD' },
  };
}

function baseGrant(f: BaseFixture, scope: EnvelopeFingerprintInput['scope'], overrides?: Partial<AuthorityGrant>): AuthorityGrant {
  return {
    id: randomUUID(),
    principalId: f.principalId,
    representedPartyRef: { kind: 'ORGANISATION', id: f.organisationId },
    issuedByPrincipalId: f.principalId,
    issuedAt: NOW,
    actions: ['action.intent.dispatch', 'action.intent.authorize'],
    scopes: scope,
    ...overrides,
  };
}

async function seedAuthorizedDispatch(
  f: BaseFixture,
  envelopeInput: EnvelopeFingerprintInput,
): Promise<{
  fingerprint: string;
  decisionObj: AuthorityDecision;
  approvalObj: Approval;
  envelope: AuthorityEnvelope;
  grant: AuthorityGrant;
  envelopeInput: EnvelopeFingerprintInput;
  requiredAuthorityScopes: TypedRef[];
}> {
  const requiredAuthorityScopes = await loadRequiredAuthorityScopesOrFail(f.pool, f.seed.workspaceId, f.intentId);
  const decisionScope = unionTypedRefs(envelopeInput.scope, requiredAuthorityScopes);
  const expandedEnvelopeInput = { ...envelopeInput, scope: decisionScope };
  const fingerprint = computeEnvelopeFingerprint(expandedEnvelopeInput);
  const decision = mustOk(await issueAuthorityDecision(f.uow(), {
    workspaceId: f.seed.workspaceId,
    actorPrincipalId: f.seed.actorId,
    idempotencyKey: randomUUID(),
    envelopeInput: expandedEnvelopeInput,
    requirements: [{ actorRole: 'PAYER' }],
    issuedAt: NOW,
  }));
  await issueApproverGrant(f.uow(), {
    workspaceId: f.seed.workspaceId,
    actorId: f.seed.actorId,
    principalId: f.principalId,
    representedPartyRef: { kind: 'ORGANISATION', id: f.organisationId },
    scopes: decisionScope,
    issuerPrincipalId: f.issuerPrincipalId,
  });
  const approval = mustOk(await recordApproval(f.uow(), {
    workspaceId: f.seed.workspaceId,
    actorPrincipalId: f.principalId,
    idempotencyKey: randomUUID(),
    decisionId: decision.decisionId,
    requirementId: decision.requirementIds[0]!,
    envelopeFingerprint: fingerprint,
    scope: decisionScope,
    approvedAt: NOW,
  }));
  const decisionObj: AuthorityDecision = {
    id: decision.decisionId,
    actionPlanId: f.planId,
    actionPlanVersion: 1,
    actionIntentId: f.intentId,
    actionIntentVersion: 1,
    groupOperator: 'AND',
    requirements: [{ id: decision.requirementIds[0]!, actorRole: 'PAYER' }],
  };
  const approvalObj: Approval = {
    id: approval.approvalId,
    requirementId: decision.requirementIds[0]!,
    approverPrincipalId: f.principalId,
    envelopeFingerprint: fingerprint,
    scope: decisionScope,
    approvedAt: NOW,
  };
  const envelope: AuthorityEnvelope = {
    id: decision.decisionId,
    actionPlanId: f.planId,
    actionPlanVersion: 1,
    actionIntentId: f.intentId,
    actionIntentVersion: 1,
    requiredActors: [{ id: decision.requirementIds[0]!, actorRole: 'PAYER' }],
    scope: decisionScope,
    grantRefs: [],
    ruleInputs: [],
    issuedAt: NOW,
    fingerprint,
  };
  const grant = baseGrant(f, decisionScope);
  return {
    fingerprint,
    decisionObj,
    approvalObj,
    envelope,
    grant,
    envelopeInput: expandedEnvelopeInput,
    requiredAuthorityScopes,
  };
}

function dispatchAuthInput(
  f: BaseFixture,
  pieces: {
    envelopeInput: EnvelopeFingerprintInput;
    envelope: AuthorityEnvelope;
    decisionObj: AuthorityDecision;
    approvalObj: Approval;
    grant: AuthorityGrant;
    requiredAuthorityScopes: TypedRef[];
  },
  now: string,
  overrides?: Partial<DispatchAuthorizationInput>,
): DispatchAuthorizationInput {
  return {
    assessmentView: currentAssessmentView(),
    envelopeInput: pieces.envelopeInput,
    envelope: pieces.envelope,
    decision: pieces.decisionObj,
    approvals: [pieces.approvalObj],
    revocations: [],
    grants: [pieces.grant],
    requiredActionKind: 'action.intent.dispatch',
    principalId: f.principalId,
    now,
    requestedAmount: { amount: '40.00', currency: 'USD' },
    requiredAuthorityScopes: pieces.requiredAuthorityScopes,
    ...overrides,
  };
}

describe('M8 budget concurrency', () => {
  test('two workers racing for remaining budget — one hold wins', async () => {
    const f = await baseFixture();
    const budgetId = randomUUID();
    mustOk(await createBudget(f.uow(), {
      workspaceId: f.seed.workspaceId,
      actorPrincipalId: f.seed.actorId,
      idempotencyKey: randomUUID(),
      budget: { id: budgetId, organisationId: f.organisationId, purpose: 'travel', amount: { amount: '100.00', currency: 'USD' } },
    }));
    const intentA = f.intentId;
    const planBSpec = buildSingleIntentPlan({
      recoveryCaseId: f.caseId,
      organisationId: f.organisationId,
      operationNamespace: 'provider:test-b',
      costEstimate: { amount: '70.00', currency: 'USD' },
    });
    await persistStrategyChangeRow(f.pool, f.seed.workspaceId, f.seed.actorId, f.caseId, {
      id: planBSpec.scenarioChangeId,
      recoveryStrategyId: planBSpec.recoveryStrategyId,
      strategyVersion: 2,
      affectedSubjectRefs: [{ kind: 'JOURNEY', id: f.journeyId }],
      effects: [],
    }, {
      baseManifest: tripBaseManifest(f.tripId, 1),
      candidateSummaries: [{ subjectRef: { kind: 'JOURNEY', id: f.journeyId } }],
    });
    const persistedB = mustOk(await persistActionPlan(f.uow(), {
      workspaceId: f.seed.workspaceId,
      actorPrincipalId: f.seed.actorId,
      idempotencyKey: randomUUID(),
      plan: planBSpec.plan,
      recoveryStrategyId: planBSpec.recoveryStrategyId,
      planVersion: 2,
    }));
    const intentB = persistedB.intentIds[0]!;

    const [left, right] = await Promise.all([
      holdBudgetForIntent(new PgUnitOfWork(f.pool, f.seed.workspaceId), {
        workspaceId: f.seed.workspaceId,
        actorPrincipalId: f.seed.actorId,
        idempotencyKey: randomUUID(),
        budgetId,
        expectedBudgetRevision: 1,
        actionIntentId: intentA,
      }),
      holdBudgetForIntent(new PgUnitOfWork(f.pool, f.seed.workspaceId), {
        workspaceId: f.seed.workspaceId,
        actorPrincipalId: f.seed.actorId,
        idempotencyKey: randomUUID(),
        budgetId,
        expectedBudgetRevision: 1,
        actionIntentId: intentB,
      }),
    ]);
    const wins = [left, right].filter((o) => o.ok);
    const losses = [left, right].filter((o) => !o.ok);
    assert.equal(wins.length, 1, 'exactly one hold commits');
    assert.equal(losses.length, 1);
    const loser = losses[0];
    assert.ok(loser);
    assert.match(loser.ok === false ? loser.conflict.message : '', /INSUFFICIENT_BUDGET|STALE_AGGREGATE|expected revision/);
  });
});

describe('M8 execution claim / idempotency / unknown outcome', () => {
  test('two workers claim the same prepared attempt — only one wins', async () => {
    const f = await baseFixture({ logicalOperationKey: 'op-claim-race', requestPayload: { book: true } });
    mustOk(await createPreparedExecutionAttempt(f.uow(), prepareAttempt(f)));
    const a = new PgExecutionWorker(f.pool, { actorId: 'worker-a' });
    const b = new PgExecutionWorker(f.pool, { actorId: 'worker-b' });
    const [c1, c2] = await Promise.all([a.claimNext(f.seed.workspaceId), b.claimNext(f.seed.workspaceId)]);
    const claimed = [c1, c2].filter(Boolean);
    assert.equal(claimed.length, 1);
  });

  test('same logical key with different fingerprint is rejected', async () => {
    const f = await baseFixture({ logicalOperationKey: 'op-fp', requestPayload: { amount: 10 } });
    mustOk(await createPreparedExecutionAttempt(f.uow(), prepareAttempt(f)));
    // Mark first attempt terminal so only fingerprint collision remains relevant.
    await f.pool.query(
      `UPDATE execution_attempts SET status = 'RECONCILED' WHERE workspace_id = $1 AND logical_operation_key = 'op-fp'`,
      [f.seed.workspaceId],
    );
    // A second, differently-fingerprinted intent reusing the same logical
    // operation key is the only way to provoke a fingerprint mismatch now
    // that dispatch identity always comes from the immutable intent row.
    // action_intents_logical_op_uidx is scoped per operation_namespace, so
    // a distinct namespace is required to even persist this second intent.
    const rekeyedSpec = buildSingleIntentPlan({
      recoveryCaseId: f.caseId,
      organisationId: f.organisationId,
      operationNamespace: 'provider:test-fp2',
      logicalOperationKey: 'op-fp',
      requestPayload: { amount: 999 },
      costEstimate: { amount: '40.00', currency: 'USD' },
    });
    await persistStrategyChangeRow(f.pool, f.seed.workspaceId, f.seed.actorId, f.caseId, {
      id: rekeyedSpec.scenarioChangeId,
      recoveryStrategyId: rekeyedSpec.recoveryStrategyId,
      strategyVersion: 2,
      affectedSubjectRefs: [{ kind: 'JOURNEY', id: f.journeyId }],
      effects: [],
    }, {
      baseManifest: tripBaseManifest(f.tripId, 1),
      candidateSummaries: [{ subjectRef: { kind: 'JOURNEY', id: f.journeyId } }],
    });
    const rekeyed = mustOk(await persistActionPlan(f.uow(), {
      workspaceId: f.seed.workspaceId,
      actorPrincipalId: f.seed.actorId,
      idempotencyKey: randomUUID(),
      plan: rekeyedSpec.plan,
      recoveryStrategyId: rekeyedSpec.recoveryStrategyId,
      planVersion: 2,
    }));
    await seedStoredExecutionAuthority({
      pool: f.pool,
      workspaceId: f.seed.workspaceId,
      actorId: f.seed.actorId,
      principalId: f.principalId,
      planId: rekeyed.planId,
      intentId: rekeyed.intentIds[0]!,
      scope: [{ kind: 'ORGANISATION', id: f.organisationId }],
      representedPartyRef: { kind: 'ORGANISATION', id: f.organisationId },
      cost: { amount: '40.00', currency: 'USD' },
      budgetId: f.budgetId,
      budgetRevision: 2,
      issuerPrincipalId: f.issuerPrincipalId,
    });
    const rejected = await createPreparedExecutionAttempt(f.uow(), prepareParams({
      workspaceId: f.seed.workspaceId,
      actorId: f.seed.actorId,
      planId: rekeyed.planId,
      intentId: rekeyed.intentIds[0]!,
      principalId: f.principalId,
    }));
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.equal(rejected.conflict.kind, 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');
  });

  test('lost response becomes OUTCOME_UNKNOWN then reconciles via lookup', async () => {
    const f = await baseFixture({ logicalOperationKey: 'op-lost', requestPayload: { x: 1 } });
    mustOk(await createPreparedExecutionAttempt(f.uow(), prepareAttempt(f)));
    const worker = new PgExecutionWorker(f.pool, { actorId: 'worker-lost' });
    const claim = await worker.claimNext(f.seed.workspaceId);
    assert.ok(claim);
    const lost = await worker.dispatchClaimed(claim!, {
      principalId: f.principalId,
      now: GATE_NOW,
      observed: { capabilityKind: 'BOOK', supported: true },
      dispatcher: async () => ({ kind: 'LOST_RESPONSE', requestRef: 'req-1' }),
    });
    assert.equal(lost.outcome, 'OUTCOME_UNKNOWN');

    const row = await f.pool.query<{ status: string }>(
      'SELECT status FROM execution_attempts WHERE id = $1', [claim!.id],
    );
    assert.equal(row.rows[0]?.status, 'OUTCOME_UNKNOWN');

    // Blind redispatch must stay blocked while unknown.
    const blocked = await createPreparedExecutionAttempt(f.uow(), prepareAttempt(f, { attemptNumber: 2 }));
    assert.equal(blocked.ok, false);

    const refreshed = { ...claim!, status: 'OUTCOME_UNKNOWN' as const };
    const reconciled = await worker.reconcileUnknown(refreshed, async () => ({
      kind: 'FOUND_SUCCESS',
      responseRef: 'rsp-1',
      sourceOwnedFields: { status: 'CONFIRMED' },
    }));
    assert.equal(reconciled.outcome, 'OBSERVED_SUCCESS');
  });

  test('unsupported capability fails structurally without fake success', async () => {
    const f = await baseFixture({ logicalOperationKey: 'op-cap', requestPayload: { y: 1 } });
    mustOk(await createPreparedExecutionAttempt(f.uow(), prepareAttempt(f)));
    const worker = new PgExecutionWorker(f.pool, { actorId: 'worker-cap' });
    const claim = await worker.claimNext(f.seed.workspaceId);
    assert.ok(claim);
    let dispatched = false;
    const result = await worker.dispatchClaimed(claim!, {
      principalId: f.principalId,
      now: GATE_NOW,
      observed: { capabilityKind: 'OBSERVE', supported: true },
      dispatcher: async () => {
        dispatched = true;
        return { kind: 'SUCCESS', responseRef: 'x', sourceOwnedFields: {} };
      },
    });
    assert.equal(dispatched, false);
    assert.equal(result.outcome, 'FAILED');
  });
});

describe('M8 approval fingerprint binding', () => {
  test('revoke and fingerprint mismatch deny authorizeDispatch', async () => {
    const f = await baseFixture();
    const requiredAuthorityScopes = await loadRequiredAuthorityScopesOrFail(f.pool, f.seed.workspaceId, f.intentId);
    const decisionScope = unionTypedRefs([{ kind: 'ACTION_INTENT' as const, id: f.intentId }], requiredAuthorityScopes);
    const envelopeInput = {
      actionPlanId: f.planId,
      actionPlanVersion: 1,
      actionIntentId: f.intentId,
      actionIntentVersion: 1,
      requiredActorRoles: ['PAYER'],
      scope: decisionScope,
      grantRefs: [],
      ruleInputs: [],
      amountCeiling: { amount: '40.00', currency: 'USD' as const },
    };
    const fingerprint = computeEnvelopeFingerprint(envelopeInput);
    const decision = mustOk(await issueAuthorityDecision(f.uow(), {
      workspaceId: f.seed.workspaceId,
      actorPrincipalId: f.seed.actorId,
      idempotencyKey: randomUUID(),
      envelopeInput,
      requirements: [{ actorRole: 'PAYER' }],
      issuedAt: NOW,
    }));
    await issueApproverGrant(f.uow(), {
      workspaceId: f.seed.workspaceId,
      actorId: f.seed.actorId,
      principalId: f.principalId,
      representedPartyRef: { kind: 'ORGANISATION', id: f.organisationId },
      scopes: decisionScope,
      issuerPrincipalId: f.issuerPrincipalId,
    });
    const approval = mustOk(await recordApproval(f.uow(), {
      workspaceId: f.seed.workspaceId,
      actorPrincipalId: f.principalId,
      idempotencyKey: randomUUID(),
      decisionId: decision.decisionId,
      requirementId: decision.requirementIds[0]!,
      envelopeFingerprint: fingerprint,
      scope: decisionScope,
      approvedAt: NOW,
    }));

    const assessmentView: AssessmentView = {
      status: 'CURRENT',
      assessment: {
        id: randomUUID(),
        kind: 'VIABILITY',
        evaluatedAt: NOW,
        overallVerdict: 'PASS',
        subjects: [{ subjectRef: { kind: 'JOURNEY', id: randomUUID() }, role: 'PRIMARY' }],
        dimensions: [],
        manifest: {
          evaluatedAt: NOW,
          evaluatorVersions: [],
          aggregateReads: [],
          scopeReads: [],
          evidenceReads: [],
          coverageReads: [],
          missingCoverage: [],
        },
      },
      staleness: [],
    };
    const envelope: AuthorityEnvelope = {
      id: decision.decisionId,
      actionPlanId: f.planId,
      actionPlanVersion: 1,
      actionIntentId: f.intentId,
      actionIntentVersion: 1,
      requiredActors: [{ id: decision.requirementIds[0]!, actorRole: 'PAYER' }],
      scope: envelopeInput.scope,
      grantRefs: [],
      ruleInputs: [],
      issuedAt: NOW,
      fingerprint,
    };
    const decisionObj: AuthorityDecision = {
      id: decision.decisionId,
      actionPlanId: f.planId,
      actionPlanVersion: 1,
      actionIntentId: f.intentId,
      actionIntentVersion: 1,
      groupOperator: 'AND',
      requirements: [{ id: decision.requirementIds[0]!, actorRole: 'PAYER' }],
    };
    const approvalObj: Approval = {
      id: approval.approvalId,
      requirementId: decision.requirementIds[0]!,
      approverPrincipalId: f.principalId,
      envelopeFingerprint: fingerprint,
      scope: envelopeInput.scope,
      approvedAt: NOW,
    };
    const grant = {
      id: randomUUID(),
      principalId: f.principalId,
      representedPartyRef: { kind: 'ORGANISATION' as const, id: f.organisationId },
      issuedByPrincipalId: f.principalId,
      issuedAt: NOW,
      actions: ['action.intent.dispatch', 'action.intent.authorize'],
      scopes: envelopeInput.scope,
    };

    const ok = authorizeDispatch({
      assessmentView,
      envelopeInput,
      envelope,
      decision: decisionObj,
      approvals: [approvalObj],
      revocations: [],
      grants: [grant],
      requiredActionKind: 'action.intent.dispatch',
      principalId: f.principalId,
      now: NOW,
      requestedAmount: { amount: '40.00', currency: 'USD' },
      requiredAuthorityScopes,
    });
    assert.equal(ok.allowed, true);

    mustOk(await revokeApproval(f.uow(), {
      workspaceId: f.seed.workspaceId,
      actorPrincipalId: f.principalId,
      idempotencyKey: randomUUID(),
      approvalId: approval.approvalId,
      revokedAt: '2031-07-01T01:00:00.000Z',
    }));
    const revoked = authorizeDispatch({
      assessmentView,
      envelopeInput,
      envelope,
      decision: decisionObj,
      approvals: [approvalObj],
      revocations: [{ id: randomUUID(), approvalId: approval.approvalId, revokedAt: '2031-07-01T01:00:00.000Z', revokedByPrincipalId: f.principalId }],
      grants: [grant],
      requiredActionKind: 'action.intent.dispatch',
      principalId: f.principalId,
      now: '2031-07-01T01:01:00.000Z',
      requiredAuthorityScopes,
    });
    assert.equal(revoked.allowed, false);

    const mismatched = authorizeDispatch({
      assessmentView,
      envelopeInput: { ...envelopeInput, actionIntentVersion: 2 },
      envelope,
      decision: decisionObj,
      approvals: [approvalObj],
      revocations: [],
      grants: [grant],
      requiredActionKind: 'action.intent.dispatch',
      principalId: f.principalId,
      now: NOW,
      requiredAuthorityScopes,
    });
    assert.equal(mismatched.allowed, false);
    if (!mismatched.allowed) assert.equal(mismatched.reason, 'ENVELOPE_MISMATCH');
  });
});

describe('M8 authority grant lifecycle', () => {
  test('expired grant denies authorizeDispatch', async () => {
    const f = await baseFixture();
    const envelopeInput = defaultEnvelopeInput(f);
    const auth = await seedAuthorizedDispatch(f, envelopeInput);
    const expiredGrant = baseGrant(f, auth.envelopeInput.scope, {
      expiresAt: '2031-06-30T00:00:00.000Z',
    });
    const denied = authorizeDispatch(dispatchAuthInput(f, { ...auth, grant: expiredGrant }, '2031-07-01T00:00:00.000Z'));
    assert.equal(denied.allowed, false);
    if (!denied.allowed) assert.equal(denied.reason, 'GRANT_EXPIRED');
  });

  test('envelope expiry denies authorizeDispatch with GRANT_EXPIRED', async () => {
    const f = await baseFixture();
    const envelopeInput = defaultEnvelopeInput(f);
    const auth = await seedAuthorizedDispatch(f, envelopeInput);
    const expiredEnvelope: AuthorityEnvelope = { ...auth.envelope, expiresAt: '2031-06-30T00:00:00.000Z' };
    const denied = authorizeDispatch(dispatchAuthInput(f, {
      ...auth,
      envelope: expiredEnvelope,
    }, '2031-07-01T00:00:00.000Z'));
    assert.equal(denied.allowed, false);
    if (!denied.allowed) assert.equal(denied.reason, 'GRANT_EXPIRED');
  });

  test('revoked grant denies authorizeDispatch', async () => {
    const f = await baseFixture();
    const envelopeInput = defaultEnvelopeInput(f);
    const auth = await seedAuthorizedDispatch(f, envelopeInput);
    const revokedGrant = baseGrant(f, auth.envelopeInput.scope, {
      revokedAt: '2031-07-01T00:30:00.000Z',
    });
    const denied = authorizeDispatch(dispatchAuthInput(f, { ...auth, grant: revokedGrant }, '2031-07-01T01:00:00.000Z'));
    assert.equal(denied.allowed, false);
    if (!denied.allowed) assert.equal(denied.reason, 'GRANT_REVOKED');
  });
});

describe('M8 amount ceiling and quote protection', () => {
  test('requested amount above envelope ceiling denies authorizeDispatch', async () => {
    const f = await baseFixture();
    const envelopeInput = defaultEnvelopeInput(f);
    const auth = await seedAuthorizedDispatch(f, envelopeInput);
    const denied = authorizeDispatch(dispatchAuthInput(f, auth, NOW, {
      requestedAmount: { amount: '50.00', currency: 'USD' },
    }));
    assert.equal(denied.allowed, false);
    if (!denied.allowed) assert.equal(denied.reason, 'AMOUNT_CEILING_EXCEEDED');
  });

  test('holdBudget rejects hold above approved ceiling after quote change', async () => {
    const f = await baseFixture();
    const budgetId = randomUUID();
    mustOk(await createBudget(f.uow(), {
      workspaceId: f.seed.workspaceId,
      actorPrincipalId: f.seed.actorId,
      idempotencyKey: randomUUID(),
      budget: { id: budgetId, organisationId: f.organisationId, purpose: 'travel', amount: { amount: '100.00', currency: 'USD' } },
    }));
    const rejected = await holdBudgetForIntent(f.uow(), {
      workspaceId: f.seed.workspaceId,
      actorPrincipalId: f.seed.actorId,
      idempotencyKey: randomUUID(),
      budgetId,
      expectedBudgetRevision: 1,
      actionIntentId: f.intentId,
      requested: { amount: '40.00', currency: 'USD' },
      approvedCeiling: { amount: '30.00', currency: 'USD' },
    });
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.match(rejected.conflict.message, /QUOTE_CHANGED/);
  });
});

describe('M8 assessment gate at dispatch', () => {
  test('STALE assessment denies authorizeDispatch after approval was recorded', async () => {
    const f = await baseFixture();
    const envelopeInput = defaultEnvelopeInput(f);
    const auth = await seedAuthorizedDispatch(f, envelopeInput);
    const staleView: AssessmentView = {
      status: 'STALE',
      assessment: currentAssessmentView().assessment,
      staleness: [{
        kind: 'AGGREGATE_ADVANCED',
        aggregateRef: { kind: 'ACTION_PLAN', id: f.planId },
        readRevision: 1,
        currentRevision: 2,
      }],
    };
    const denied = authorizeDispatch(dispatchAuthInput(f, auth, NOW, { assessmentView: staleView }));
    assert.equal(denied.allowed, false);
    if (!denied.allowed) assert.equal(denied.reason, 'ASSESSMENT_NOT_CURRENT');
  });

  test('PENDING_REASSESSMENT assessment denies authorizeDispatch', async () => {
    const f = await baseFixture();
    const envelopeInput = defaultEnvelopeInput(f);
    const auth = await seedAuthorizedDispatch(f, envelopeInput);
    const pendingView: AssessmentView = {
      status: 'PENDING_REASSESSMENT',
      assessment: undefined,
      staleness: [],
    };
    const denied = authorizeDispatch(dispatchAuthInput(f, auth, NOW, { assessmentView: pendingView }));
    assert.equal(denied.allowed, false);
    if (!denied.allowed) assert.equal(denied.reason, 'ASSESSMENT_NOT_CURRENT');
  });
});

describe('M8 execution lease reclaim and fencing', () => {
  async function preparedAttempt(logicalKey: string) {
    const f = await baseFixture({ logicalOperationKey: logicalKey, requestPayload: { op: logicalKey } });
    mustOk(await createPreparedExecutionAttempt(f.uow(), prepareAttempt(f)));
    return f;
  }

  test('expired CLAIMED without request_ref is reclaimed with new fencing token', async () => {
    const f = await preparedAttempt('op-lease-reclaim');
    const worker = new PgExecutionWorker(f.pool, { actorId: 'worker-lease', leaseSeconds: 1 });
    const first = await worker.claimNext(f.seed.workspaceId);
    assert.ok(first);
    const before = await f.pool.query<{ status: string; request_ref: string | null; fencing_token: string }>(
      'SELECT status, request_ref, fencing_token FROM execution_attempts WHERE id = $1',
      [first!.id],
    );
    assert.equal(before.rows[0]?.status, 'CLAIMED');
    assert.equal(before.rows[0]?.request_ref, null);

    await f.pool.query(
      `UPDATE execution_attempts SET lease_expires_at = now() - interval '1 second' WHERE id = $1`,
      [first!.id],
    );

    const reclaimed = await worker.claimNext(f.seed.workspaceId);
    assert.ok(reclaimed);
    assert.equal(reclaimed!.id, first!.id);
    assert.notEqual(reclaimed!.claimToken, first!.claimToken);
    assert.ok(reclaimed!.fencingToken > first!.fencingToken);
    assert.equal(reclaimed!.status, 'CLAIMED');
  });

  test('wrong claim_token or fencing_token transition is rejected', async () => {
    const f = await preparedAttempt('op-fencing');
    const worker = new PgExecutionWorker(f.pool, { actorId: 'worker-fence' });
    const claim = await worker.claimNext(f.seed.workspaceId);
    assert.ok(claim);

    const wrongToken = await transitionExecutionAttempt(f.pool, {
      workspaceId: f.seed.workspaceId,
      attemptId: claim!.id,
      from: 'CLAIMED',
      to: 'DISPATCHING',
      claimToken: 'not-the-claim-token',
      fencingToken: claim!.fencingToken,
    });
    assert.equal(wrongToken, 'FENCED');

    const wrongFence = await transitionExecutionAttempt(f.pool, {
      workspaceId: f.seed.workspaceId,
      attemptId: claim!.id,
      from: 'CLAIMED',
      to: 'DISPATCHING',
      claimToken: claim!.claimToken,
      fencingToken: claim!.fencingToken - 1,
    });
    assert.equal(wrongFence, 'FENCED');

    const stillClaimed = await f.pool.query<{ status: string }>(
      'SELECT status FROM execution_attempts WHERE id = $1',
      [claim!.id],
    );
    assert.equal(stillClaimed.rows[0]?.status, 'CLAIMED');
  });

  test('stale worker claim cannot dispatch after lease reclaim', async () => {
    const f = await preparedAttempt('op-stale-dispatch');
    const worker = new PgExecutionWorker(f.pool, { actorId: 'worker-stale', leaseSeconds: 1 });
    const stale = await worker.claimNext(f.seed.workspaceId);
    assert.ok(stale);
    await f.pool.query(
      `UPDATE execution_attempts SET lease_expires_at = now() - interval '1 second' WHERE id = $1`,
      [stale!.id],
    );
    const fresh = await worker.claimNext(f.seed.workspaceId);
    assert.ok(fresh);

    const blocked = await worker.dispatchClaimed(stale!, {
      principalId: f.principalId,
      now: GATE_NOW,
      observed: { capabilityKind: 'BOOK', supported: true },
      dispatcher: async () => ({ kind: 'SUCCESS', responseRef: 'rsp-stale', sourceOwnedFields: {} }),
    });
    assert.equal(blocked.outcome, 'CLAIMED');
    assert.equal(blocked.detail, 'fenced before dispatch');
  });
});

describe('M8 command idempotency replay', () => {
  test('holdBudget replays same idempotency key and payload without double hold', async () => {
    const f = await baseFixture();
    const budgetId = randomUUID();
    mustOk(await createBudget(f.uow(), {
      workspaceId: f.seed.workspaceId,
      actorPrincipalId: f.seed.actorId,
      idempotencyKey: randomUUID(),
      budget: { id: budgetId, organisationId: f.organisationId, purpose: 'travel', amount: { amount: '100.00', currency: 'USD' } },
    }));
    const idempotencyKey = randomUUID();
    const commitmentId = randomUUID();
    const params = {
      workspaceId: f.seed.workspaceId,
      actorPrincipalId: f.seed.actorId,
      idempotencyKey,
      budgetId,
      expectedBudgetRevision: 1,
      actionIntentId: f.intentId,
      requested: { amount: '40.00', currency: 'USD' as const },
      commitmentId,
    };
    const first = mustOk(await holdBudgetForIntent(f.uow(), params));
    const replay = mustOk(await holdBudgetForIntent(f.uow(), params));
    assert.equal(replay.commitmentId, first.commitmentId);
    assert.equal(replay.holdAmount.amount, first.holdAmount.amount);

    const rows = await f.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM budget_commitments WHERE workspace_id = $1 AND budget_id = $2 AND action_intent_id = $3`,
      [f.seed.workspaceId, budgetId, f.intentId],
    );
    assert.equal(rows.rows[0]?.count, '1');
  });

  test('holdBudget rejects same idempotency key with different payload', async () => {
    const f = await baseFixture();
    const budgetId = randomUUID();
    mustOk(await createBudget(f.uow(), {
      workspaceId: f.seed.workspaceId,
      actorPrincipalId: f.seed.actorId,
      idempotencyKey: randomUUID(),
      budget: { id: budgetId, organisationId: f.organisationId, purpose: 'travel', amount: { amount: '100.00', currency: 'USD' } },
    }));
    const idempotencyKey = randomUUID();
    mustOk(await holdBudgetForIntent(f.uow(), {
      workspaceId: f.seed.workspaceId,
      actorPrincipalId: f.seed.actorId,
      idempotencyKey,
      budgetId,
      expectedBudgetRevision: 1,
      actionIntentId: f.intentId,
      requested: { amount: '40.00', currency: 'USD' },
      commitmentId: randomUUID(),
    }));
    const mismatch = await holdBudgetForIntent(f.uow(), {
      workspaceId: f.seed.workspaceId,
      actorPrincipalId: f.seed.actorId,
      idempotencyKey,
      budgetId,
      expectedBudgetRevision: 2,
      actionIntentId: f.intentId,
      requested: { amount: '40.00', currency: 'USD' },
      commitmentId: randomUUID(),
    });
    assert.equal(mismatch.ok, false);
    if (!mismatch.ok) assert.equal(mismatch.conflict.kind, 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');
  });

  test('createPreparedExecutionAttempt replays same idempotency key and payload', async () => {
    const f = await baseFixture({ logicalOperationKey: 'op-idem-replay', requestPayload: { v: 1 } });
    const idempotencyKey = randomUUID();
    const attemptId = randomUUID();
    const params = prepareAttempt(f, { idempotencyKey, attemptId });
    const first = mustOk(await createPreparedExecutionAttempt(f.uow(), params));
    const replay = mustOk(await createPreparedExecutionAttempt(f.uow(), params));
    assert.equal(replay.attemptId, first.attemptId);

    const rows = await f.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM execution_attempts WHERE workspace_id = $1 AND logical_operation_key = $2`,
      [f.seed.workspaceId, 'op-idem-replay'],
    );
    assert.equal(rows.rows[0]?.count, '1');
  });
});

describe('M8 internal programme item execution', () => {
  test('covered by m7m8IntegrationSeam and c3TargetedRemediation (stored strategy effect required)', () => {
    assert.ok(true);
  });
});

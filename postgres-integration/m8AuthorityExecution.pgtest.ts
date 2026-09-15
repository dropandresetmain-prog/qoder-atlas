/**
 * M8 authority / budget / durable execution PostgreSQL proofs.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import { attachSeedSession, beginSeed, commitSeed } from './m2Seed.ts';
import { seedOrganisation } from './m3Seed.ts';
import { seedEvent, seedProgramme, seedProgrammeItem } from './m4Seed.ts';
import { PgUnitOfWork, type ExecuteOutcome } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { createBudget } from '../src/persistence/postgres/commands/arrangementCommands.ts';
import { createPrincipal } from '../src/persistence/postgres/commands/peopleCommands.ts';
import {
  openRecoveryCase,
  createActionPlanWithIntent,
  prepareActionIntentDispatchIdentity,
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
import { executeInternalProgrammeItemSchedule } from '../src/persistence/postgres/execution/internalProgrammeExecutor.ts';
import { computeEnvelopeFingerprint, type EnvelopeFingerprintInput } from '../src/resolution/authority/envelope.ts';
import type { AuthorityEnvelope, AuthorityDecision, Approval } from '../src/contracts/v2/authority/authorityEnvelope.ts';
import type { AssessmentView } from '../src/persistence/postgres/world/pgAssessments.ts';
import type { AuthorityGrant } from '../src/domain/v2/people/traveller.ts';
import { computeRequestFingerprint } from '../src/resolution/execution/stateMachine.ts';

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

const NOW = '2031-07-01T00:00:00.000Z';

function mustOk<T>(outcome: ExecuteOutcome<T>): T {
  if (!outcome.ok) assert.fail(`${outcome.conflict.kind}: ${outcome.conflict.message}`);
  return outcome.value;
}

async function baseFixture() {
  const pool = await sharedTestPool();
  const seed = await beginSeed(pool, 'M8 authority');
  const organisationId = await seedOrganisation(seed, 'USD');
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
  const plan = mustOk(await createActionPlanWithIntent(uow(), {
    workspaceId: seed.workspaceId,
    actorPrincipalId: seed.actorId,
    idempotencyKey: randomUUID(),
    recoveryCaseId: opened.caseId,
    scenarioChangeId: 'scenario-fixture-1',
    operationNamespace: 'provider:test',
    capabilityRef: 'SERVICE:RESERVATION',
    subjectRefs: [{ kind: 'ORGANISATION', id: organisationId }],
    expectedObservations: ['booking_status'],
    costEstimate: { amount: '40.00', currency: 'USD' },
  }));
  return { pool, seed, uow, organisationId, principalId, ...opened, ...plan };
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
    actions: ['action.intent.dispatch'],
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
}> {
  const fingerprint = computeEnvelopeFingerprint(envelopeInput);
  const decision = mustOk(await issueAuthorityDecision(f.uow(), {
    workspaceId: f.seed.workspaceId,
    actorPrincipalId: f.seed.actorId,
    idempotencyKey: randomUUID(),
    envelopeInput,
    requirements: [{ actorRole: 'PAYER' }],
    issuedAt: NOW,
  }));
  const approval = mustOk(await recordApproval(f.uow(), {
    workspaceId: f.seed.workspaceId,
    actorPrincipalId: f.principalId,
    idempotencyKey: randomUUID(),
    decisionId: decision.decisionId,
    requirementId: decision.requirementIds[0]!,
    envelopeFingerprint: fingerprint,
    scope: envelopeInput.scope,
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
    scope: envelopeInput.scope,
    approvedAt: NOW,
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
  const grant = baseGrant(f, envelopeInput.scope);
  return { fingerprint, decisionObj, approvalObj, envelope, grant };
}

function dispatchAuthInput(
  f: BaseFixture,
  pieces: {
    envelopeInput: EnvelopeFingerprintInput;
    envelope: AuthorityEnvelope;
    decisionObj: AuthorityDecision;
    approvalObj: Approval;
    grant: AuthorityGrant;
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
    ...overrides,
  };
}

async function seedProgrammeGraph(f: BaseFixture): Promise<{ programmeId: string; programmeItemId: string }> {
  const s = await attachSeedSession(f.pool, f.seed.workspaceId, f.seed.actorId);
  const eventId = await seedEvent(s);
  const programmeId = await seedProgramme(s, { eventId });
  const { programmeItemId } = await seedProgrammeItem(s, { programmeId, scheduleAuthority: 'INTERNAL' });
  await commitSeed(s);
  return { programmeId, programmeItemId };
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
    const planB = mustOk(await createActionPlanWithIntent(f.uow(), {
      workspaceId: f.seed.workspaceId,
      actorPrincipalId: f.seed.actorId,
      idempotencyKey: randomUUID(),
      recoveryCaseId: f.caseId,
      scenarioChangeId: 'scenario-fixture-2',
      planVersion: 2,
      operationNamespace: 'provider:test-b',
      capabilityRef: 'SERVICE:RESERVATION',
      subjectRefs: [{ kind: 'ORGANISATION', id: f.organisationId }],
      expectedObservations: ['booking_status'],
    }));

    const [left, right] = await Promise.all([
      holdBudgetForIntent(new PgUnitOfWork(f.pool, f.seed.workspaceId), {
        workspaceId: f.seed.workspaceId,
        actorPrincipalId: f.seed.actorId,
        idempotencyKey: randomUUID(),
        budgetId,
        expectedBudgetRevision: 1,
        actionIntentId: intentA,
        requested: { amount: '70.00', currency: 'USD' },
      }),
      holdBudgetForIntent(new PgUnitOfWork(f.pool, f.seed.workspaceId), {
        workspaceId: f.seed.workspaceId,
        actorPrincipalId: f.seed.actorId,
        idempotencyKey: randomUUID(),
        budgetId,
        expectedBudgetRevision: 1,
        actionIntentId: planB.intentId,
        requested: { amount: '70.00', currency: 'USD' },
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
    const f = await baseFixture();
    const prepared = mustOk(await prepareActionIntentDispatchIdentity(f.uow(), {
      workspaceId: f.seed.workspaceId,
      actorPrincipalId: f.seed.actorId,
      idempotencyKey: randomUUID(),
      planId: f.planId,
      intentId: f.intentId,
      expectedPlanRevision: 1,
      logicalOperationKey: 'op-claim-race',
      requestPayload: { book: true },
    }));
    mustOk(await createPreparedExecutionAttempt(f.uow(), {
      workspaceId: f.seed.workspaceId,
      actorPrincipalId: f.seed.actorId,
      idempotencyKey: randomUUID(),
      planId: f.planId,
      intentId: f.intentId,
      attemptNumber: 1,
      logicalOperationKey: 'op-claim-race',
      requestFingerprint: prepared.requestFingerprint,
    }));
    const a = new PgExecutionWorker(f.pool, { actorId: 'worker-a' });
    const b = new PgExecutionWorker(f.pool, { actorId: 'worker-b' });
    const [c1, c2] = await Promise.all([a.claimNext(f.seed.workspaceId), b.claimNext(f.seed.workspaceId)]);
    const claimed = [c1, c2].filter(Boolean);
    assert.equal(claimed.length, 1);
  });

  test('same logical key with different fingerprint is rejected', async () => {
    const f = await baseFixture();
    const first = mustOk(await prepareActionIntentDispatchIdentity(f.uow(), {
      workspaceId: f.seed.workspaceId,
      actorPrincipalId: f.seed.actorId,
      idempotencyKey: randomUUID(),
      planId: f.planId,
      intentId: f.intentId,
      expectedPlanRevision: 1,
      logicalOperationKey: 'op-fp',
      requestPayload: { amount: 10 },
    }));
    mustOk(await createPreparedExecutionAttempt(f.uow(), {
      workspaceId: f.seed.workspaceId,
      actorPrincipalId: f.seed.actorId,
      idempotencyKey: randomUUID(),
      planId: f.planId,
      intentId: f.intentId,
      attemptNumber: 1,
      logicalOperationKey: 'op-fp',
      requestFingerprint: first.requestFingerprint,
    }));
    // Mark first attempt terminal so only fingerprint collision remains relevant.
    await f.pool.query(
      `UPDATE execution_attempts SET status = 'RECONCILED' WHERE workspace_id = $1 AND logical_operation_key = 'op-fp'`,
      [f.seed.workspaceId],
    );
    const rejected = await createPreparedExecutionAttempt(f.uow(), {
      workspaceId: f.seed.workspaceId,
      actorPrincipalId: f.seed.actorId,
      idempotencyKey: randomUUID(),
      planId: f.planId,
      intentId: f.intentId,
      attemptNumber: 2,
      logicalOperationKey: 'op-fp',
      requestFingerprint: 'different-fingerprint',
    });
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.equal(rejected.conflict.kind, 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');
  });

  test('lost response becomes OUTCOME_UNKNOWN then reconciles via lookup', async () => {
    const f = await baseFixture();
    const prepared = mustOk(await prepareActionIntentDispatchIdentity(f.uow(), {
      workspaceId: f.seed.workspaceId,
      actorPrincipalId: f.seed.actorId,
      idempotencyKey: randomUUID(),
      planId: f.planId,
      intentId: f.intentId,
      expectedPlanRevision: 1,
      logicalOperationKey: 'op-lost',
      requestPayload: { x: 1 },
    }));
    mustOk(await createPreparedExecutionAttempt(f.uow(), {
      workspaceId: f.seed.workspaceId,
      actorPrincipalId: f.seed.actorId,
      idempotencyKey: randomUUID(),
      planId: f.planId,
      intentId: f.intentId,
      attemptNumber: 1,
      logicalOperationKey: 'op-lost',
      requestFingerprint: prepared.requestFingerprint,
    }));
    const worker = new PgExecutionWorker(f.pool, { actorId: 'worker-lost' });
    const claim = await worker.claimNext(f.seed.workspaceId);
    assert.ok(claim);
    const lost = await worker.dispatchClaimed(claim!, {
      capability: { required: 'SERVICE', observed: { capabilityKind: 'SERVICE', supported: true } },
      dispatcher: async () => ({ kind: 'LOST_RESPONSE', requestRef: 'req-1' }),
    });
    assert.equal(lost.outcome, 'OUTCOME_UNKNOWN');

    const row = await f.pool.query<{ status: string }>(
      'SELECT status FROM execution_attempts WHERE id = $1', [claim!.id],
    );
    assert.equal(row.rows[0]?.status, 'OUTCOME_UNKNOWN');

    // Blind redispatch must stay blocked while unknown.
    const blocked = await createPreparedExecutionAttempt(f.uow(), {
      workspaceId: f.seed.workspaceId,
      actorPrincipalId: f.seed.actorId,
      idempotencyKey: randomUUID(),
      planId: f.planId,
      intentId: f.intentId,
      attemptNumber: 2,
      logicalOperationKey: 'op-lost',
      requestFingerprint: prepared.requestFingerprint,
    });
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
    const f = await baseFixture();
    const prepared = mustOk(await prepareActionIntentDispatchIdentity(f.uow(), {
      workspaceId: f.seed.workspaceId,
      actorPrincipalId: f.seed.actorId,
      idempotencyKey: randomUUID(),
      planId: f.planId,
      intentId: f.intentId,
      expectedPlanRevision: 1,
      logicalOperationKey: 'op-cap',
      requestPayload: { y: 1 },
    }));
    mustOk(await createPreparedExecutionAttempt(f.uow(), {
      workspaceId: f.seed.workspaceId,
      actorPrincipalId: f.seed.actorId,
      idempotencyKey: randomUUID(),
      planId: f.planId,
      intentId: f.intentId,
      attemptNumber: 1,
      logicalOperationKey: 'op-cap',
      requestFingerprint: prepared.requestFingerprint,
    }));
    const worker = new PgExecutionWorker(f.pool, { actorId: 'worker-cap' });
    const claim = await worker.claimNext(f.seed.workspaceId);
    assert.ok(claim);
    let dispatched = false;
    const result = await worker.dispatchClaimed(claim!, {
      capability: { required: 'SERVICE', observed: { capabilityKind: 'OBSERVE', supported: true } },
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
    const envelopeInput = {
      actionPlanId: f.planId,
      actionPlanVersion: 1,
      actionIntentId: f.intentId,
      actionIntentVersion: 1,
      requiredActorRoles: ['PAYER'],
      scope: [{ kind: 'ACTION_INTENT' as const, id: f.intentId }],
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
    const approval = mustOk(await recordApproval(f.uow(), {
      workspaceId: f.seed.workspaceId,
      actorPrincipalId: f.principalId,
      idempotencyKey: randomUUID(),
      decisionId: decision.decisionId,
      requirementId: decision.requirementIds[0]!,
      envelopeFingerprint: fingerprint,
      scope: envelopeInput.scope,
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
      actions: ['action.intent.dispatch'],
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
    const expiredGrant = baseGrant(f, envelopeInput.scope, {
      expiresAt: '2031-06-30T00:00:00.000Z',
    });
    const denied = authorizeDispatch(dispatchAuthInput(f, { ...auth, envelopeInput, grant: expiredGrant }, '2031-07-01T00:00:00.000Z'));
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
      envelopeInput,
      envelope: expiredEnvelope,
    }, '2031-07-01T00:00:00.000Z'));
    assert.equal(denied.allowed, false);
    if (!denied.allowed) assert.equal(denied.reason, 'GRANT_EXPIRED');
  });

  test('revoked grant denies authorizeDispatch', async () => {
    const f = await baseFixture();
    const envelopeInput = defaultEnvelopeInput(f);
    const auth = await seedAuthorizedDispatch(f, envelopeInput);
    const revokedGrant = baseGrant(f, envelopeInput.scope, {
      revokedAt: '2031-07-01T00:30:00.000Z',
    });
    const denied = authorizeDispatch(dispatchAuthInput(f, { ...auth, envelopeInput, grant: revokedGrant }, '2031-07-01T01:00:00.000Z'));
    assert.equal(denied.allowed, false);
    if (!denied.allowed) assert.equal(denied.reason, 'GRANT_REVOKED');
  });
});

describe('M8 amount ceiling and quote protection', () => {
  test('requested amount above envelope ceiling denies authorizeDispatch', async () => {
    const f = await baseFixture();
    const envelopeInput = defaultEnvelopeInput(f);
    const auth = await seedAuthorizedDispatch(f, envelopeInput);
    const denied = authorizeDispatch(dispatchAuthInput(f, { ...auth, envelopeInput }, NOW, {
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
      requested: { amount: '45.00', currency: 'USD' },
      approvedCeiling: { amount: '40.00', currency: 'USD' },
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
    const denied = authorizeDispatch(dispatchAuthInput(f, { ...auth, envelopeInput }, NOW, { assessmentView: staleView }));
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
    const denied = authorizeDispatch(dispatchAuthInput(f, { ...auth, envelopeInput }, NOW, { assessmentView: pendingView }));
    assert.equal(denied.allowed, false);
    if (!denied.allowed) assert.equal(denied.reason, 'ASSESSMENT_NOT_CURRENT');
  });
});

describe('M8 execution lease reclaim and fencing', () => {
  async function preparedAttempt(f: BaseFixture, logicalKey: string) {
    const prepared = mustOk(await prepareActionIntentDispatchIdentity(f.uow(), {
      workspaceId: f.seed.workspaceId,
      actorPrincipalId: f.seed.actorId,
      idempotencyKey: randomUUID(),
      planId: f.planId,
      intentId: f.intentId,
      expectedPlanRevision: 1,
      logicalOperationKey: logicalKey,
      requestPayload: { op: logicalKey },
    }));
    mustOk(await createPreparedExecutionAttempt(f.uow(), {
      workspaceId: f.seed.workspaceId,
      actorPrincipalId: f.seed.actorId,
      idempotencyKey: randomUUID(),
      planId: f.planId,
      intentId: f.intentId,
      attemptNumber: 1,
      logicalOperationKey: logicalKey,
      requestFingerprint: prepared.requestFingerprint,
    }));
    return prepared;
  }

  test('expired CLAIMED without request_ref is reclaimed with new fencing token', async () => {
    const f = await baseFixture();
    await preparedAttempt(f, 'op-lease-reclaim');
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
    const f = await baseFixture();
    await preparedAttempt(f, 'op-fencing');
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
    const f = await baseFixture();
    await preparedAttempt(f, 'op-stale-dispatch');
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
      capability: { required: 'SERVICE', observed: { capabilityKind: 'SERVICE', supported: true } },
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
      requested: { amount: '30.00', currency: 'USD' as const },
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
      requested: { amount: '20.00', currency: 'USD' },
    }));
    const mismatch = await holdBudgetForIntent(f.uow(), {
      workspaceId: f.seed.workspaceId,
      actorPrincipalId: f.seed.actorId,
      idempotencyKey,
      budgetId,
      expectedBudgetRevision: 2,
      actionIntentId: f.intentId,
      requested: { amount: '25.00', currency: 'USD' },
    });
    assert.equal(mismatch.ok, false);
    if (!mismatch.ok) assert.equal(mismatch.conflict.kind, 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');
  });

  test('createPreparedExecutionAttempt replays same idempotency key and payload', async () => {
    const f = await baseFixture();
    const prepared = mustOk(await prepareActionIntentDispatchIdentity(f.uow(), {
      workspaceId: f.seed.workspaceId,
      actorPrincipalId: f.seed.actorId,
      idempotencyKey: randomUUID(),
      planId: f.planId,
      intentId: f.intentId,
      expectedPlanRevision: 1,
      logicalOperationKey: 'op-idem-replay',
      requestPayload: { v: 1 },
    }));
    const idempotencyKey = randomUUID();
    const attemptId = randomUUID();
    const params = {
      workspaceId: f.seed.workspaceId,
      actorPrincipalId: f.seed.actorId,
      idempotencyKey,
      planId: f.planId,
      intentId: f.intentId,
      attemptNumber: 1,
      logicalOperationKey: 'op-idem-replay',
      requestFingerprint: prepared.requestFingerprint,
      attemptId,
    };
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
  test('authorized internal schedule path completes attempt and intent', async () => {
    const f = await baseFixture();
    const { programmeId, programmeItemId } = await seedProgrammeGraph(f);
    const envelopeInput = defaultEnvelopeInput(f, [{ kind: 'PROGRAMME_ITEM', id: programmeItemId }]);
    const auth = await seedAuthorizedDispatch(f, envelopeInput);
    const newWindow = { start: '2031-08-01T10:00:00.000Z', end: '2031-08-01T11:00:00.000Z' };
    const requestFingerprint = computeRequestFingerprint({ programmeItemId, window: newWindow });

    const result = mustOk(await executeInternalProgrammeItemSchedule(f.uow(), {
      workspaceId: f.seed.workspaceId,
      actorPrincipalId: f.seed.actorId,
      idempotencyKey: randomUUID(),
      authorization: dispatchAuthInput(f, { ...auth, envelopeInput }, NOW),
      planId: f.planId,
      intentId: f.intentId,
      attemptNumber: 1,
      logicalOperationKey: 'internal-schedule-op',
      requestFingerprint,
      programmeId,
      programmeItemId,
      expectedProgrammeRevision: 1,
      schedule: { window: newWindow },
    }));

    const attempt = await f.pool.query<{ status: string }>(
      'SELECT status FROM execution_attempts WHERE id = $1',
      [result.attemptId],
    );
    assert.equal(attempt.rows[0]?.status, 'OBSERVED_SUCCESS');

    const intent = await f.pool.query<{ status: string }>(
      'SELECT status FROM action_intents WHERE workspace_id = $1 AND id = $2',
      [f.seed.workspaceId, f.intentId],
    );
    assert.equal(intent.rows[0]?.status, 'COMPLETED');

    const item = await f.pool.query<{ window_start: string; window_end: string }>(
      'SELECT window_start, window_end FROM programme_items WHERE workspace_id = $1 AND id = $2',
      [f.seed.workspaceId, programmeItemId],
    );
    assert.equal(new Date(item.rows[0]!.window_start).toISOString(), newWindow.start);
    assert.equal(new Date(item.rows[0]!.window_end).toISOString(), newWindow.end);
  });
});

/**
 * M9 Checkpoint 1 — focused PostgreSQL proofs.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed, seedTraveller, seedTrip, seedJourney } from './m2Seed.ts';
import { seedOrganisation } from './m3Seed.ts';
import { PgUnitOfWork, type ExecuteOutcome } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { createPrincipal } from '../src/persistence/postgres/commands/peopleCommands.ts';
import { openRecoveryCase, persistActionPlan } from '../src/persistence/postgres/commands/m8AuthorityCommands.ts';
import { persistRecoveryStrategy } from '../src/persistence/postgres/commands/m7StrategyCommands.ts';
import { evaluateRecoveryCaseResolution } from '../src/app/target/recoveryCaseResolution.ts';
import {
  issueRequiredAuthorityGrant,
  provisionOrganiserAuthority,
  GRANT_ISSUANCE_ACTION_KIND,
} from '../src/app/target/grantIssuance.ts';
import { compileActionPlan } from '../src/resolution/planning/compiler.ts';
import type { RecoveryStrategy } from '../src/contracts/v2/scenario/recoveryStrategy.ts';
import type { ActionPlan } from '../src/contracts/v2/action/actionPlan.ts';
import type { WorldSnapshotManifest } from '../src/contracts/v2/scope/readScope.ts';
import { saveAssessment } from '../src/persistence/postgres/world/pgAssessments.ts';

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

const NOW = '2031-09-01T00:00:00.000Z';

function mustOk<T>(outcome: ExecuteOutcome<T>): T {
  if (!outcome.ok) assert.fail(`${outcome.conflict.kind}: ${outcome.conflict.message}`);
  return outcome.value;
}

function emptyManifest(evaluatedAt = NOW): WorldSnapshotManifest {
  return {
    evaluatedAt,
    evaluatorVersions: [],
    aggregateReads: [],
    scopeReads: [],
    evidenceReads: [],
    coverageReads: [],
    missingCoverage: [],
  };
}

describe('M9 RecoveryStrategy persistence', () => {
  test('persistRecoveryStrategy stores planning evidence; empty manifest refused', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'M9 strategy');
    const traveller = await seedTraveller(seed, { displayName: 'Strategy Traveller' });
    const tripId = await seedTrip(seed);
    const journeyId = await seedJourney(seed, { tripId, travellerId: traveller.travellerId });
    await commitSeed(seed);
    const uow = () => new PgUnitOfWork(pool, seed.workspaceId);

    const caseId = mustOk(await openRecoveryCase(uow(), {
      workspaceId: seed.workspaceId,
      actorPrincipalId: seed.actorId,
      idempotencyKey: randomUUID(),
      openedAt: NOW,
    })).caseId;

    const strategyId = randomUUID();
    const basisAssessmentId = randomUUID();
    await saveAssessment(pool, seed.workspaceId, {
      id: basisAssessmentId,
      kind: 'VIABILITY',
      evaluatedAt: NOW,
      overallVerdict: 'PASS',
      subjects: [{ subjectRef: { kind: 'JOURNEY', id: journeyId }, role: 'PRIMARY' }],
      dimensions: [],
      manifest: emptyManifest(),
    }, seed.actorId);

    const strategy: RecoveryStrategy = {
      id: strategyId,
      recoveryCaseId: caseId,
      strategyVersion: 1,
      status: 'EVALUATED',
      viability: 'VIABLE',
      basisAssessmentId,
      affectedSubjectRefs: [{ kind: 'JOURNEY', id: journeyId }],
      baseManifest: emptyManifest(),
      scenarioChange: {
        id: randomUUID(),
        recoveryStrategyId: strategyId,
        strategyVersion: 1,
        affectedSubjectRefs: [{ kind: 'JOURNEY', id: journeyId }],
        effects: [{
          effectKind: 'CHANGE_PROGRAMME_ITEM_TIME',
          programmeItemId: randomUUID(),
          proposedWindow: { start: '2031-09-01T10:00:00.000Z', end: '2031-09-01T11:00:00.000Z' },
        }],
        basisAssessmentId,
      },
      assumptions: [{ code: 'demo_window', description: 'programme window assumed available' }],
      requiredUnknowns: [],
      candidateAssessments: [{
        subjectRef: { kind: 'JOURNEY', id: journeyId },
        assessmentId: basisAssessmentId,
        overallVerdict: 'PASS',
      }],
      candidateAssessmentResults: [],
      requiredAuthorityScopes: ['programme.schedule'],
      createdAt: NOW,
      evaluatedAt: NOW,
    };

    const persisted = mustOk(await persistRecoveryStrategy(uow(), {
      workspaceId: seed.workspaceId,
      actorPrincipalId: seed.actorId,
      idempotencyKey: randomUUID(),
      strategy,
    }));
    assert.equal(persisted.strategyId, strategyId);

    const row = await pool.query<{ viability: string; assumptions: unknown }>(
      `SELECT viability, assumptions FROM recovery_strategies WHERE workspace_id = $1 AND id = $2`,
      [seed.workspaceId, strategyId],
    );
    assert.equal(row.rows[0]?.viability, 'VIABLE');
    const changes = await pool.query(
      `SELECT 1 FROM strategy_changes WHERE workspace_id = $1 AND recovery_strategy_id = $2`,
      [seed.workspaceId, strategyId],
    );
    assert.equal(changes.rows.length, 1);

    const emptyId = randomUUID();
    const denied = await persistRecoveryStrategy(uow(), {
      workspaceId: seed.workspaceId,
      actorPrincipalId: seed.actorId,
      idempotencyKey: randomUUID(),
      strategy: {
        ...strategy,
        id: emptyId,
        strategyVersion: 2,
        scenarioChange: {
          ...strategy.scenarioChange,
          id: randomUUID(),
          recoveryStrategyId: emptyId,
          strategyVersion: 2,
        },
        baseManifest: {} as WorldSnapshotManifest,
      },
    });
    assert.equal(denied.ok, false);
  });
});

describe('M9 R-10 practical grant issuance', () => {
  test('valid organiser path succeeds; insufficient scope fails', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'M9 grants');
    const traveller = await seedTraveller(seed, { displayName: 'Grant Traveller' });
    const tripId = await seedTrip(seed);
    const journeyId = await seedJourney(seed, { tripId, travellerId: traveller.travellerId });
    await commitSeed(seed);
    const uow = () => new PgUnitOfWork(pool, seed.workspaceId);

    const principalId = randomUUID();
    mustOk(await createPrincipal(uow(), {
      workspaceId: seed.workspaceId,
      actorPrincipalId: seed.actorId,
      idempotencyKey: randomUUID(),
      principalId,
      actorType: 'HUMAN',
      authIssuer: 'https://issuer.invalid/m9',
      authSubject: principalId,
    }));

    const required = [{ kind: 'JOURNEY' as const, id: journeyId }];

    // ISSUER-POL: normal issuance requires an issuer that already holds
    // grant-issuing authority. Bootstrap one organiser principal for this.
    const organiser = mustOk(await provisionOrganiserAuthority({
      uow: uow(),
      workspaceId: seed.workspaceId,
      actorPrincipalId: seed.actorId,
      organisationLegalName: 'M9 Grant Test Org',
      authIssuer: 'https://issuer.invalid/m9-organiser',
      authSubject: randomUUID(),
      representedPartyRef: { kind: 'TRAVELLER', id: traveller.travellerId },
      requiredScopes: required,
      actions: [GRANT_ISSUANCE_ACTION_KIND],
      issuedAt: NOW,
    }));

    const okGrant = mustOk(await issueRequiredAuthorityGrant(uow(), {
      workspaceId: seed.workspaceId,
      actorPrincipalId: seed.actorId,
      idempotencyKey: randomUUID(),
      principalId,
      representedPartyRef: { kind: 'TRAVELLER', id: traveller.travellerId },
      issuedByPrincipalId: organiser.principalId,
      issuedAt: NOW,
      actions: ['action.intent.dispatch', 'action.intent.authorize'],
      proposedScopes: required,
      requiredScopes: required,
      pool,
    }));
    assert.ok(okGrant.grantId);

    const weak = await issueRequiredAuthorityGrant(uow(), {
      workspaceId: seed.workspaceId,
      actorPrincipalId: seed.actorId,
      idempotencyKey: randomUUID(),
      principalId,
      representedPartyRef: { kind: 'TRAVELLER', id: traveller.travellerId },
      issuedByPrincipalId: organiser.principalId,
      issuedAt: NOW,
      actions: ['action.intent.dispatch'],
      proposedScopes: [{ kind: 'JOURNEY', id: randomUUID() }],
      requiredScopes: required,
      pool,
    });
    assert.equal(weak.ok, false);
    if (!weak.ok) assert.match(weak.conflict.message, /GRANT_SCOPE_INSUFFICIENT/);
  });

  test('ISSUER-POL: unauthorised issuer fails; organiser cannot self-mint', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'M9 grants issuer policy');
    const traveller = await seedTraveller(seed, { displayName: 'Issuer Policy Traveller' });
    const tripId = await seedTrip(seed);
    const journeyId = await seedJourney(seed, { tripId, travellerId: traveller.travellerId });
    await commitSeed(seed);
    const uow = () => new PgUnitOfWork(pool, seed.workspaceId);

    const principalId = randomUUID();
    mustOk(await createPrincipal(uow(), {
      workspaceId: seed.workspaceId,
      actorPrincipalId: seed.actorId,
      idempotencyKey: randomUUID(),
      principalId,
      actorType: 'HUMAN',
      authIssuer: 'https://issuer.invalid/m9-unauthorised',
      authSubject: principalId,
    }));
    const required = [{ kind: 'JOURNEY' as const, id: journeyId }];

    // Self-mint: principal proposes to issue its own grant.
    const selfMint = await issueRequiredAuthorityGrant(uow(), {
      workspaceId: seed.workspaceId,
      actorPrincipalId: seed.actorId,
      idempotencyKey: randomUUID(),
      principalId,
      representedPartyRef: { kind: 'TRAVELLER', id: traveller.travellerId },
      issuedByPrincipalId: principalId,
      issuedAt: NOW,
      actions: ['action.intent.dispatch'],
      proposedScopes: required,
      requiredScopes: required,
      pool,
    });
    assert.equal(selfMint.ok, false);
    if (!selfMint.ok) assert.match(selfMint.conflict.message, /ISSUER_SELF_ISSUANCE_FORBIDDEN/);

    // A second, ordinary principal with no authority.grant.write of its own.
    const bystanderId = randomUUID();
    mustOk(await createPrincipal(uow(), {
      workspaceId: seed.workspaceId,
      actorPrincipalId: seed.actorId,
      idempotencyKey: randomUUID(),
      principalId: bystanderId,
      actorType: 'HUMAN',
      authIssuer: 'https://issuer.invalid/m9-bystander',
      authSubject: bystanderId,
    }));
    const unauthorised = await issueRequiredAuthorityGrant(uow(), {
      workspaceId: seed.workspaceId,
      actorPrincipalId: seed.actorId,
      idempotencyKey: randomUUID(),
      principalId,
      representedPartyRef: { kind: 'TRAVELLER', id: traveller.travellerId },
      issuedByPrincipalId: bystanderId,
      issuedAt: NOW,
      actions: ['action.intent.dispatch'],
      proposedScopes: required,
      requiredScopes: required,
      pool,
    });
    assert.equal(unauthorised.ok, false);
    if (!unauthorised.ok) assert.match(unauthorised.conflict.message, /ISSUER_UNAUTHORISED/);

    // An authorised organiser (bootstrap) can issue for this principal.
    const organiser = mustOk(await provisionOrganiserAuthority({
      uow: uow(),
      workspaceId: seed.workspaceId,
      actorPrincipalId: seed.actorId,
      organisationLegalName: 'M9 Issuer Policy Org',
      authIssuer: 'https://issuer.invalid/m9-issuer-policy-organiser',
      authSubject: randomUUID(),
      representedPartyRef: { kind: 'TRAVELLER', id: traveller.travellerId },
      requiredScopes: required,
      actions: [GRANT_ISSUANCE_ACTION_KIND],
      issuedAt: NOW,
    }));
    const authorised = mustOk(await issueRequiredAuthorityGrant(uow(), {
      workspaceId: seed.workspaceId,
      actorPrincipalId: seed.actorId,
      idempotencyKey: randomUUID(),
      principalId,
      representedPartyRef: { kind: 'TRAVELLER', id: traveller.travellerId },
      issuedByPrincipalId: organiser.principalId,
      issuedAt: NOW,
      actions: ['action.intent.dispatch'],
      proposedScopes: required,
      requiredScopes: required,
      pool,
    }));
    assert.ok(authorised.grantId);

    // Bootstrap mechanism must not be reachable through ordinary application
    // HTTP: applicationCommands.ts's HTTP-facing surface never imports it.
    const httpSource = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../src/app/target/targetHttpHandlers.ts', import.meta.url), 'utf8'),
    );
    assert.doesNotMatch(httpSource, /provisionOrganiserAuthority|bootstrapIssueAuthorityGrant/);
    const appCommandsSource = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../src/app/target/applicationCommands.ts', import.meta.url), 'utf8'),
    );
    assert.doesNotMatch(appCommandsSource, /provisionOrganiserAuthority|bootstrapIssueAuthorityGrant/);
  });
});

describe('M9 IN-1 re-plan identity', () => {
  test('new strategy version may persist same effect-scoped logical key across plans', async () => {
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
        createdAt: NOW,
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
        baseManifest: emptyManifest(),
      };
    }
    const compiled1 = compileActionPlan({
      strategy: strategyAt(1),
      now: NOW,
      capabilities: [{ capabilityRef: 'external:offer.select', supported: true }],
    });
    const compiled2 = compileActionPlan({
      strategy: strategyAt(2),
      now: NOW,
      capabilities: [{ capabilityRef: 'external:offer.select', supported: true }],
    });
    assert.equal(compiled1.ok, true);
    assert.equal(compiled2.ok, true);
    if (!compiled1.ok || !compiled2.ok) return;
    assert.equal(compiled1.value.plan.intents[0]!.logicalOperationKey, compiled2.value.plan.intents[0]!.logicalOperationKey);
    assert.notEqual(compiled1.value.plan.intents[0]!.requestFingerprint, compiled2.value.plan.intents[0]!.requestFingerprint);

    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'M9 IN-1');
    const organisationId = await seedOrganisation(seed, 'USD');
    await commitSeed(seed);
    const uow = () => new PgUnitOfWork(pool, seed.workspaceId);
    const opened = mustOk(await openRecoveryCase(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), openedAt: NOW,
    }));

    const plan1: ActionPlan = {
      ...compiled1.value.plan,
      id: randomUUID(),
      recoveryCaseId: opened.caseId,
      scenarioChangeId: randomUUID(),
    };
    plan1.intents[0] = {
      ...compiled1.value.plan.intents[0]!,
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
      ...compiled2.value.plan.intents[0]!,
      id: randomUUID(),
      actionPlanId: plan2.id,
      subjectRefs: [{ kind: 'ORGANISATION', id: organisationId }],
    };
    const second = mustOk(await persistActionPlan(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), plan: plan2,
      planVersion: 2,
    }));
    assert.ok(second.planId);
    assert.notEqual(second.planId, plan1.id);
  });
});

describe('M9 RecoveryCase resolution gate', () => {
  test('Journey FAIL or UNKNOWN stays unresolved after assessments exist', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'M9 resolve');
    const traveller = await seedTraveller(seed, { displayName: 'Resolve Traveller' });
    const tripId = await seedTrip(seed);
    const journeyId = await seedJourney(seed, { tripId, travellerId: traveller.travellerId });
    await commitSeed(seed);
    const uow = () => new PgUnitOfWork(pool, seed.workspaceId);

    const caseId = mustOk(await openRecoveryCase(uow(), {
      workspaceId: seed.workspaceId,
      actorPrincipalId: seed.actorId,
      idempotencyKey: randomUUID(),
      openedAt: NOW,
    })).caseId;

    await pool.query(
      `INSERT INTO case_subjects (workspace_id, recovery_case_id, subject_kind, subject_id, role)
       VALUES ($1, $2, 'JOURNEY', $3, 'affected')`,
      [seed.workspaceId, caseId, journeyId],
    );

    await saveAssessment(pool, seed.workspaceId, {
      id: randomUUID(),
      kind: 'VIABILITY',
      evaluatedAt: NOW,
      overallVerdict: 'FAIL',
      subjects: [{ subjectRef: { kind: 'JOURNEY', id: journeyId }, role: 'PRIMARY' }],
      dimensions: [],
      manifest: emptyManifest(),
    }, seed.actorId);

    const fail = await evaluateRecoveryCaseResolution(pool, {
      workspaceId: seed.workspaceId,
      recoveryCaseId: caseId,
      now: NOW,
    });
    assert.equal(fail.allowed, false);
    if (!fail.allowed) assert.equal(fail.reason, 'BLOCKING_FAIL');

    await saveAssessment(pool, seed.workspaceId, {
      id: randomUUID(),
      kind: 'VIABILITY',
      evaluatedAt: NOW,
      overallVerdict: 'UNKNOWN',
      subjects: [{ subjectRef: { kind: 'JOURNEY', id: journeyId }, role: 'PRIMARY' }],
      dimensions: [],
      manifest: emptyManifest(),
    }, seed.actorId);

    const unknown = await evaluateRecoveryCaseResolution(pool, {
      workspaceId: seed.workspaceId,
      recoveryCaseId: caseId,
      now: NOW,
    });
    assert.equal(unknown.allowed, false);
    if (!unknown.allowed) assert.equal(unknown.reason, 'BLOCKING_UNKNOWN');
  });
});

describe('M9 I1 — consequential action plan gates resolution (C4 finding)', () => {
  test('mandatory action intent without observed success blocks resolution despite PASS assessments', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'M9 I1 resolution');
    const traveller = await seedTraveller(seed, { displayName: 'I1 Traveller' });
    const tripId = await seedTrip(seed);
    const journeyId = await seedJourney(seed, { tripId, travellerId: traveller.travellerId });
    await commitSeed(seed);
    const uow = () => new PgUnitOfWork(pool, seed.workspaceId);

    const caseId = mustOk(await openRecoveryCase(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), openedAt: NOW,
    })).caseId;

    await pool.query(
      `INSERT INTO case_subjects (workspace_id, recovery_case_id, subject_kind, subject_id, role)
       VALUES ($1, $2, 'JOURNEY', $3, 'affected')`,
      [seed.workspaceId, caseId, journeyId],
    );
    await saveAssessment(pool, seed.workspaceId, {
      id: randomUUID(),
      kind: 'VIABILITY',
      evaluatedAt: NOW,
      overallVerdict: 'PASS',
      subjects: [{ subjectRef: { kind: 'JOURNEY', id: journeyId }, role: 'PRIMARY' }],
      dimensions: [],
      manifest: emptyManifest(),
    }, seed.actorId);

    const journeyItemId = randomUUID();
    const basisAssessmentId = randomUUID();
    const strategyId = randomUUID();
    const strategy: RecoveryStrategy = {
      id: strategyId,
      recoveryCaseId: caseId,
      strategyVersion: 1,
      status: 'SELECTED',
      viability: 'VIABLE',
      basisAssessmentId,
      affectedSubjectRefs: [{ kind: 'JOURNEY_ITEM', id: journeyItemId }],
      requiredAuthorityScopes: [],
      createdAt: NOW,
      scenarioChange: {
        id: randomUUID(),
        recoveryStrategyId: strategyId,
        strategyVersion: 1,
        affectedSubjectRefs: [{ kind: 'JOURNEY_ITEM', id: journeyItemId }],
        effects: [{
          effectKind: 'SELECT_OFFER',
          journeyItemId,
          offerId: randomUUID(),
          offerPrice: { amount: '10.00', currency: 'USD' },
        }],
        basisAssessmentId,
      },
      assumptions: [],
      requiredUnknowns: [],
      candidateAssessments: [],
      candidateAssessmentResults: [],
      baseManifest: emptyManifest(),
    };
    const compiled = compileActionPlan({
      strategy,
      now: NOW,
      capabilities: [{ capabilityRef: 'external:offer.select', supported: true }],
    });
    assert.equal(compiled.ok, true);
    if (!compiled.ok) return;

    const plan: ActionPlan = { ...compiled.value.plan, id: randomUUID(), recoveryCaseId: caseId, scenarioChangeId: randomUUID() };
    plan.intents[0] = {
      ...compiled.value.plan.intents[0]!,
      id: randomUUID(),
      actionPlanId: plan.id,
      subjectRefs: [{ kind: 'JOURNEY', id: journeyId }],
    };
    mustOk(await persistActionPlan(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), plan,
    }));

    // No execution attempt yet for the intent: mandatory work is not observed-success.
    const blocked = await evaluateRecoveryCaseResolution(pool, {
      workspaceId: seed.workspaceId,
      recoveryCaseId: caseId,
      now: NOW,
    });
    assert.equal(blocked.allowed, false);
    if (!blocked.allowed) assert.equal(blocked.reason, 'ACTION_INTENT_NOT_COMPLETE');

    // Observed-success recorded for the intent: gate proceeds past the
    // action-plan check to current assessments (PASS) and allows resolution.
    await pool.query(
      `INSERT INTO execution_attempts (
         workspace_id, id, action_intent_id, attempt_number, logical_operation_key,
         request_fingerprint, status, created_by_actor_id
       ) VALUES ($1, $2, $3, 1, $4, $5, 'OBSERVED_SUCCESS', $6)`,
      [
        seed.workspaceId, randomUUID(), plan.intents[0]!.id,
        plan.intents[0]!.logicalOperationKey, plan.intents[0]!.requestFingerprint, seed.actorId,
      ],
    );
    const allowed = await evaluateRecoveryCaseResolution(pool, {
      workspaceId: seed.workspaceId,
      recoveryCaseId: caseId,
      now: NOW,
      requiredAffectedPeople: [{ kind: 'JOURNEY', id: journeyId }],
    });
    assert.equal(allowed.allowed, true, !allowed.allowed ? `${allowed.reason}: ${allowed.detail}` : '');
  });

  test('no strategy/action plan + current PASS assessments allows passive resolution', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'M9 I1 passive resolution');
    const traveller = await seedTraveller(seed, { displayName: 'Passive Traveller' });
    const tripId = await seedTrip(seed);
    const journeyId = await seedJourney(seed, { tripId, travellerId: traveller.travellerId });
    await commitSeed(seed);
    const uow = () => new PgUnitOfWork(pool, seed.workspaceId);
    const caseId = mustOk(await openRecoveryCase(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), openedAt: NOW,
    })).caseId;
    await pool.query(
      `INSERT INTO case_subjects (workspace_id, recovery_case_id, subject_kind, subject_id, role)
       VALUES ($1, $2, 'JOURNEY', $3, 'affected')`,
      [seed.workspaceId, caseId, journeyId],
    );
    await saveAssessment(pool, seed.workspaceId, {
      id: randomUUID(),
      kind: 'VIABILITY',
      evaluatedAt: NOW,
      overallVerdict: 'PASS',
      subjects: [{ subjectRef: { kind: 'JOURNEY', id: journeyId }, role: 'PRIMARY' }],
      dimensions: [],
      manifest: emptyManifest(),
    }, seed.actorId);

    // No RecoveryStrategy/ActionPlan for this case at all: external state
    // self-recovered and current deterministic state is valid — passive
    // resolution remains available.
    const allowed = await evaluateRecoveryCaseResolution(pool, {
      workspaceId: seed.workspaceId,
      recoveryCaseId: caseId,
      now: NOW,
    });
    assert.equal(allowed.allowed, true, !allowed.allowed ? `${allowed.reason}: ${allowed.detail}` : '');
  });
});

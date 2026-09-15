/**
 * M9 3C/3D — Jordan coordinated multi-action recovery plan, real dependency
 * ordering, and partial failure through PostgreSQL.
 *
 * One ActionPlan with five ActionIntents (onward flight, Narita overnight,
 * Singapore stay replacement, displaced stay cancellation, ground transfer).
 * Cancellation is dependency-gated on replacement success. Partial failure
 * (replacement CONFIRMED, cancellation FAILED) surfaces through real read
 * models; retry then resolves the case. Narita remains confirmed throughout.
 *
 * Progressive connection (3A) and TR867/TR885 viability (3B) are proven in
 * their focused pgtests; this file owns the multi-action + partial-failure
 * acceptance seam.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed, seedJourney, seedTraveller, seedTrip } from './m2Seed.ts';
import { PgUnitOfWork, type ExecuteOutcome } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { createPrincipal } from '../src/persistence/postgres/commands/peopleCommands.ts';
import {
  openRecoveryCase,
  persistActionPlan,
  createPreparedExecutionAttempt,
} from '../src/persistence/postgres/commands/m8AuthorityCommands.ts';
import { PgExecutionWorker } from '../src/persistence/postgres/execution/pgExecutionWorker.ts';
import { computeRequestFingerprint } from '../src/resolution/execution/stateMachine.ts';
import { evaluateRecoveryCaseResolution } from '../src/app/target/recoveryCaseResolution.ts';
import { resolveRecoveryCase } from '../src/persistence/postgres/commands/m9CaseResolutionCommands.ts';
import { loadRecoveryCaseFacts } from '../src/app/target/readmodels/pgFactAssembler.ts';
import { projectRecoveryCase } from '../src/app/target/readmodels/projectRecoveryCase.ts';
import {
  GATE_NOW,
  loadRequiredAuthorityScopesOrFail,
  persistStrategyChangeRow,
  prepareParams,
  seedStoredExecutionAuthority,
  tripBaseManifest,
} from './m8ExecutionGateHelpers.ts';
import type { ActionPlan, ActionIntent } from '../src/contracts/v2/action/actionPlan.ts';
import type { TypedRef } from '../src/domain/v2/shared/identity.ts';

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

const NOW = '2031-10-01T00:00:00.000Z';

function mustOk<T>(o: ExecuteOutcome<T>): T {
  if (!o.ok) assert.fail(`${o.conflict.kind}: ${o.conflict.message}`);
  return o.value;
}

function buildIntent(opts: {
  planId: string;
  operationNamespace: string;
  capabilityRef: string;
  subjectRefs: TypedRef[];
}): ActionIntent {
  const id = randomUUID();
  return {
    id,
    actionPlanId: opts.planId,
    operationNamespace: opts.operationNamespace,
    logicalOperationKey: `${opts.operationNamespace}:${id}`,
    requestFingerprint: computeRequestFingerprint({ id, capabilityRef: opts.capabilityRef }),
    capabilityRef: opts.capabilityRef,
    subjectRefs: opts.subjectRefs,
    expectedRevisions: [],
    preconditions: [],
    requiredAuthorityScopes: [],
    expectedObservations: ['booking_status'],
    compensationPolicy: { supported: false, requiresSeparateAuthority: true },
    status: 'PROPOSED',
  };
}

describe('M9 3C/3D Jordan coordinated multi-action recovery (real dependency + partial failure)', () => {
  test('replacement stay confirms before displaced cancel; partial failure is truthful; retry resolves; Narita retained', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'M9 3C/3D Jordan multi-action');
    const traveller = await seedTraveller(seed, { displayName: 'Jordan' });
    const tripId = await seedTrip(seed, { purpose: 'TEST', lifecycleStatus: 'ACTIVE' });
    const journeyId = await seedJourney(seed, {
      tripId, travellerId: traveller.travellerId, lifecycleStatus: 'ACTIVE',
    });
    await commitSeed(seed);

    const uow = () => new PgUnitOfWork(pool, seed.workspaceId);
    const principalId = randomUUID();
    mustOk(await createPrincipal(uow(), {
      workspaceId: seed.workspaceId,
      actorPrincipalId: seed.actorId,
      idempotencyKey: randomUUID(),
      principalId,
      actorType: 'HUMAN',
      authIssuer: 'https://issuer.invalid/m9-jordan',
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

    const planId = randomUUID();
    const recoveryStrategyId = randomUUID();
    const scenarioChangeId = randomUUID();
    const flightIntent = buildIntent({
      planId,
      operationNamespace: 'provider:flight',
      capabilityRef: 'external:flight.book',
      subjectRefs: [{ kind: 'JOURNEY', id: journeyId }],
    });
    const naritaIntent = buildIntent({
      planId,
      operationNamespace: 'provider:hotel',
      capabilityRef: 'external:hotel.book',
      subjectRefs: [{ kind: 'JOURNEY', id: journeyId }],
    });
    const singaporeReplacementIntent = buildIntent({
      planId,
      operationNamespace: 'provider:hotel',
      capabilityRef: 'external:hotel.book',
      subjectRefs: [{ kind: 'JOURNEY', id: journeyId }],
    });
    const singaporeDisplacedCancelIntent = buildIntent({
      planId,
      operationNamespace: 'provider:hotel',
      capabilityRef: 'external:hotel.cancel',
      subjectRefs: [{ kind: 'JOURNEY', id: journeyId }],
    });
    const groundTransferIntent = buildIntent({
      planId,
      operationNamespace: 'provider:transfer',
      capabilityRef: 'external:transfer.change',
      subjectRefs: [{ kind: 'JOURNEY', id: journeyId }],
    });

    const plan: ActionPlan = {
      id: planId,
      recoveryCaseId: opened.caseId,
      scenarioChangeId,
      intents: [
        flightIntent,
        naritaIntent,
        singaporeReplacementIntent,
        singaporeDisplacedCancelIntent,
        groundTransferIntent,
      ],
      dependencies: [{
        fromActionIntentId: singaporeReplacementIntent.id,
        toActionIntentId: singaporeDisplacedCancelIntent.id,
      }],
    };

    await persistStrategyChangeRow(pool, seed.workspaceId, seed.actorId, opened.caseId, {
      id: scenarioChangeId,
      recoveryStrategyId,
      strategyVersion: 1,
      affectedSubjectRefs: [{ kind: 'JOURNEY', id: journeyId }],
      effects: [],
      basisAssessmentId: randomUUID(),
    }, {
      baseManifest: tripBaseManifest(tripId, 1),
      candidateSummaries: [{ subjectRef: { kind: 'JOURNEY', id: journeyId } }],
    });
    mustOk(await persistActionPlan(uow(), {
      workspaceId: seed.workspaceId,
      actorPrincipalId: seed.actorId,
      idempotencyKey: randomUUID(),
      plan,
      recoveryStrategyId,
    }));

    for (const intent of plan.intents) {
      const scope = await loadRequiredAuthorityScopesOrFail(pool, seed.workspaceId, intent.id);
      await seedStoredExecutionAuthority({
        pool,
        workspaceId: seed.workspaceId,
        actorId: seed.actorId,
        principalId,
        planId,
        intentId: intent.id,
        scope,
        representedPartyRef: { kind: 'TRAVELLER', id: traveller.travellerId },
        assessmentSubject: { kind: 'JOURNEY', id: journeyId },
        assessmentTripId: tripId,
        requirementRole: 'CASE_OWNER',
        now: GATE_NOW,
      });
    }

    const worker = new PgExecutionWorker(pool, { actorId: 'jordan-recovery-worker' });

    async function execute(intentId: string, outcome: 'SUCCESS' | 'FAILURE', attemptNumber = 1): Promise<string> {
      const prepared = mustOk(await createPreparedExecutionAttempt(uow(), prepareParams({
        workspaceId: seed.workspaceId,
        actorId: seed.actorId,
        planId,
        intentId,
        principalId,
        now: GATE_NOW,
        attemptNumber,
      })));
      const claim = await worker.claimNext(seed.workspaceId);
      assert.ok(claim, `attempt not claimable for intent ${intentId}`);
      assert.equal(claim!.actionIntentId, intentId);
      const result = await worker.dispatchClaimed(claim!, {
        principalId,
        now: GATE_NOW,
        observed: { capabilityKind: 'SERVICE', supported: true },
        dispatcher: async () => (outcome === 'SUCCESS'
          ? {
              kind: 'SUCCESS' as const,
              responseRef: `rsp-${intentId}-${attemptNumber}`,
              sourceOwnedFields: { status: outcome === 'SUCCESS' ? 'CONFIRMED' : 'FAILED' },
            }
          : { kind: 'FAILURE' as const, error: 'provider declined the cancellation' }),
      });
      assert.equal(
        result.outcome,
        outcome === 'SUCCESS' ? 'OBSERVED_SUCCESS' : 'OBSERVED_FAILURE',
        JSON.stringify(result),
      );
      return prepared.attemptId;
    }

    // 3C: cancellation cannot prepare before replacement succeeds.
    const tooEarly = await createPreparedExecutionAttempt(uow(), prepareParams({
      workspaceId: seed.workspaceId,
      actorId: seed.actorId,
      planId,
      intentId: singaporeDisplacedCancelIntent.id,
      principalId,
      now: GATE_NOW,
    }));
    assert.equal(tooEarly.ok, false, 'cancellation must not dispatch before replacement completes');
    if (!tooEarly.ok) assert.match(tooEarly.conflict.message, /prerequisite/i);

    await execute(flightIntent.id, 'SUCCESS');
    await execute(naritaIntent.id, 'SUCCESS');
    await execute(singaporeReplacementIntent.id, 'SUCCESS');

    // 3D: cancellation fails for real after dependency is satisfied.
    await execute(singaporeDisplacedCancelIntent.id, 'FAILURE');

    const factsAfterFailure = await loadRecoveryCaseFacts(pool, seed.workspaceId, opened.caseId, NOW);
    assert.ok(factsAfterFailure);
    const viewAfterFailure = projectRecoveryCase(factsAfterFailure!);
    assert.equal(viewAfterFailure.duplicateBookingExposure.length, 1, JSON.stringify(viewAfterFailure.duplicateBookingExposure));
    const exposure = viewAfterFailure.duplicateBookingExposure[0]!;
    assert.equal(exposure.replacementActionRef, singaporeReplacementIntent.id);
    assert.equal(exposure.displacedActionRef, singaporeDisplacedCancelIntent.id);
    assert.equal(exposure.replacementObservation, 'CONFIRMED');
    assert.equal(exposure.displacedCancellationObservation, 'FAILED');
    assert.ok(viewAfterFailure.partialRecovery);
    assert.ok(viewAfterFailure.partialRecovery!.failed.includes(singaporeDisplacedCancelIntent.id));
    assert.ok(viewAfterFailure.partialRecovery!.succeeded.includes(singaporeReplacementIntent.id));
    assert.ok(viewAfterFailure.partialRecovery!.succeeded.includes(naritaIntent.id), 'Narita overnight remains confirmed');
    assert.ok(viewAfterFailure.remainingRecoveryWork.length > 0);

    const notYetResolvable = await evaluateRecoveryCaseResolution(pool, {
      workspaceId: seed.workspaceId,
      recoveryCaseId: opened.caseId,
      now: NOW,
    });
    assert.equal(notYetResolvable.allowed, false);
    if (!notYetResolvable.allowed) assert.equal(notYetResolvable.reason, 'ACTION_INTENT_NOT_COMPLETE');

    await execute(groundTransferIntent.id, 'SUCCESS');

    // Cancellation retry succeeds; Narita untouched.
    await execute(singaporeDisplacedCancelIntent.id, 'SUCCESS', 2);

    const factsAfterRecovery = await loadRecoveryCaseFacts(pool, seed.workspaceId, opened.caseId, NOW);
    assert.ok(factsAfterRecovery);
    const viewAfterRecovery = projectRecoveryCase(factsAfterRecovery!);
    assert.equal(viewAfterRecovery.duplicateBookingExposure.length, 0,
      'exposure clears once cancellation succeeds');
    assert.ok(viewAfterRecovery.partialRecovery);
    assert.equal(viewAfterRecovery.partialRecovery!.failed.length, 0);
    assert.ok(viewAfterRecovery.partialRecovery!.succeeded.includes(singaporeDisplacedCancelIntent.id));
    assert.ok(viewAfterRecovery.partialRecovery!.succeeded.includes(naritaIntent.id),
      'Narita overnight still confirmed after cancel retry');
    assert.equal(viewAfterRecovery.remainingRecoveryWork.length, 0);

    const nowResolvable = await evaluateRecoveryCaseResolution(pool, {
      workspaceId: seed.workspaceId,
      recoveryCaseId: opened.caseId,
      now: NOW,
    });
    assert.equal(nowResolvable.allowed, true, nowResolvable.allowed ? '' : `${nowResolvable.reason}: ${nowResolvable.detail}`);
    mustOk(await resolveRecoveryCase(uow(), {
      workspaceId: seed.workspaceId,
      actorPrincipalId: seed.actorId,
      idempotencyKey: randomUUID(),
      recoveryCaseId: opened.caseId,
      now: NOW,
    }));
    const statusRow = await pool.query<{ lifecycle_status: string }>(
      'SELECT lifecycle_status FROM recovery_cases WHERE workspace_id = $1 AND id = $2',
      [seed.workspaceId, opened.caseId],
    );
    assert.ok(['RESOLVED', 'CLOSED'].includes(statusRow.rows[0]!.lifecycle_status));
  });
});

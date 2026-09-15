/**
 * M9 — focused regression tests for the read-model fixes closed against the
 * C4 "current-assessment semantics" and "observation projection" findings.
 *
 * 1. `loadRecoveryCaseFacts` must derive whole-trip viability from each case
 *    subject's CURRENT assessment (via `currentAssessmentView`), never from
 *    "the last N assessment rows across every subject" — an old superseded
 *    verdict must never override the current one.
 * 2. `loadRecoveryActionFacts` must report the actual recorded execution
 *    outcome (CONFIRMED / CANCELLED / FAILED / OUTCOME_UNKNOWN) derived from
 *    the linked execution_attempts.status — never "CONFIRMED" just because
 *    an execution_observations row exists.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed, seedTraveller, seedTrip, seedJourney } from './m2Seed.ts';
import { PgUnitOfWork, type ExecuteOutcome } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { openRecoveryCase, persistActionPlan } from '../src/persistence/postgres/commands/m8AuthorityCommands.ts';
import { compileActionPlan } from '../src/resolution/planning/compiler.ts';
import { saveAssessment } from '../src/persistence/postgres/world/pgAssessments.ts';
import { loadRecoveryCaseFacts } from '../src/app/target/readmodels/pgFactAssembler.ts';
import type { RecoveryStrategy } from '../src/contracts/v2/scenario/recoveryStrategy.ts';
import type { ActionPlan } from '../src/contracts/v2/action/actionPlan.ts';
import type { WorldSnapshotManifest } from '../src/contracts/v2/scope/readScope.ts';

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

const NOW = '2031-07-01T12:00:00.000Z';
const EARLIER = '2031-07-01T08:00:00.000Z';

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

describe('M9 read model — current-assessment semantics (not "last N rows")', () => {
  test('a superseded FAIL does not keep the case looking broken after a CURRENT PASS', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'M9 currentness FAIL-then-PASS');
    const traveller = await seedTraveller(seed, { displayName: 'Currentness Traveller' });
    const tripId = await seedTrip(seed);
    const journeyId = await seedJourney(seed, { tripId, travellerId: traveller.travellerId });
    await commitSeed(seed);
    const uow = () => new PgUnitOfWork(pool, seed.workspaceId);

    const caseId = mustOk(await openRecoveryCase(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), openedAt: EARLIER,
    })).caseId;
    await pool.query(
      `INSERT INTO case_subjects (workspace_id, recovery_case_id, subject_kind, subject_id, role)
       VALUES ($1, $2, 'JOURNEY', $3, 'affected')`,
      [seed.workspaceId, caseId, journeyId],
    );

    // Old (superseded) assessment: FAIL.
    await saveAssessment(pool, seed.workspaceId, {
      id: randomUUID(),
      kind: 'VIABILITY',
      evaluatedAt: EARLIER,
      overallVerdict: 'FAIL',
      subjects: [{ subjectRef: { kind: 'JOURNEY', id: journeyId }, role: 'PRIMARY' }],
      dimensions: [],
      manifest: emptyManifest(EARLIER),
    }, seed.actorId);

    // New (current) assessment: PASS — supersedes the FAIL above.
    await saveAssessment(pool, seed.workspaceId, {
      id: randomUUID(),
      kind: 'VIABILITY',
      evaluatedAt: NOW,
      overallVerdict: 'PASS',
      subjects: [{ subjectRef: { kind: 'JOURNEY', id: journeyId }, role: 'PRIMARY' }],
      dimensions: [],
      manifest: emptyManifest(NOW),
    }, seed.actorId);

    const facts = await loadRecoveryCaseFacts(pool, seed.workspaceId, caseId, NOW);
    assert.ok(facts);
    // The old buggy assembler queried "latest 20 assessments across all case
    // subjects" unfiltered by currentness, so it would still see the earlier
    // FAIL row and report tripViability FAIL. Current-assessment semantics
    // must report PASS: only the CURRENT (superseding) row counts.
    assert.equal(facts!.tripViability.verdict, 'PASS');
    assert.equal(facts!.currentSemanticState, 'RECOVERED');
  });

  test('a subject with no current assessment reports UNKNOWN, not an invented verdict', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'M9 currentness no-assessment');
    const traveller = await seedTraveller(seed, { displayName: 'No Assessment Traveller' });
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

    const facts = await loadRecoveryCaseFacts(pool, seed.workspaceId, caseId, NOW);
    assert.ok(facts);
    assert.equal(facts!.tripViability.verdict, 'UNKNOWN');
    assert.ok(facts!.uncertainty?.some((u) => u.includes(journeyId)));
  });
});

describe('M9 read model — observation projection (real outcome, not "row exists = CONFIRMED")', () => {
  function buildSingleIntentPlan(caseId: string, capabilityRef: string): ActionPlan {
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
    if (!compiled.ok) throw new Error('compileActionPlan failed for test fixture');
    const plan: ActionPlan = { ...compiled.value.plan, id: randomUUID(), recoveryCaseId: caseId, scenarioChangeId: randomUUID() };
    plan.intents[0] = {
      ...compiled.value.plan.intents[0]!,
      id: randomUUID(),
      actionPlanId: plan.id,
      // Override to a domain-specific capability so the assembler's
      // domain/cancel-detection sees the shape this test targets.
      capabilityRef,
    };
    return plan;
  }

  async function recordAttempt(
    pool: Awaited<ReturnType<typeof sharedTestPool>>,
    workspaceId: string,
    actorId: string,
    intentId: string,
    status: string,
    origin: 'EXTERNAL_PROVIDER' | 'INTERNAL_COMMAND_RECEIPT',
  ): Promise<void> {
    const attemptId = randomUUID();
    await pool.query(
      `INSERT INTO execution_attempts (
         workspace_id, id, action_intent_id, attempt_number, logical_operation_key,
         request_fingerprint, status, created_by_actor_id
       ) VALUES ($1, $2, $3, 1, $4, $5, $6, $7)`,
      [workspaceId, attemptId, intentId, `logical-${intentId}`, `fingerprint-${intentId}`, status, actorId],
    );
    if (origin === 'EXTERNAL_PROVIDER') {
      await pool.query(
        `INSERT INTO execution_observations (
           workspace_id, id, attempt_id, action_intent_id, origin, external_record_id,
           source_owned_fields, observed_at, owned_subject_refs, created_by_actor_id
         ) VALUES ($1,$2,$3,$4,'EXTERNAL_PROVIDER',$5,'{}'::jsonb,$6,'[]'::jsonb,$7)`,
        [workspaceId, randomUUID(), attemptId, intentId, randomUUID(), NOW, actorId],
      );
    } else {
      await pool.query(
        `INSERT INTO execution_observations (
           workspace_id, id, attempt_id, action_intent_id, origin, command_receipt_ref,
           observed_at, owned_subject_refs, created_by_actor_id
         ) VALUES ($1,$2,$3,$4,'INTERNAL_COMMAND_RECEIPT',$5,$6,'[]'::jsonb,$7)`,
        [workspaceId, randomUUID(), attemptId, intentId, `receipt-${intentId}`, NOW, actorId],
      );
    }
  }

  test('a book-shaped success observation reads CONFIRMED; a cancel-shaped success reads CANCELLED; a failure reads FAILED', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'M9 observation projection');
    const traveller = await seedTraveller(seed, { displayName: 'Observation Traveller' });
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

    const bookPlan = buildSingleIntentPlan(caseId, 'external:hotel.book');
    mustOk(await persistActionPlan(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), plan: bookPlan,
    }));
    await recordAttempt(pool, seed.workspaceId, seed.actorId, bookPlan.intents[0]!.id, 'OBSERVED_SUCCESS', 'EXTERNAL_PROVIDER');

    const cancelPlan = buildSingleIntentPlan(caseId, 'external:hotel.cancel');
    mustOk(await persistActionPlan(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), plan: cancelPlan, planVersion: 2,
    }));
    await recordAttempt(pool, seed.workspaceId, seed.actorId, cancelPlan.intents[0]!.id, 'OBSERVED_SUCCESS', 'EXTERNAL_PROVIDER');

    const failedPlan = buildSingleIntentPlan(caseId, 'external:hotel.book');
    mustOk(await persistActionPlan(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), plan: failedPlan, planVersion: 3,
    }));
    await recordAttempt(pool, seed.workspaceId, seed.actorId, failedPlan.intents[0]!.id, 'OBSERVED_FAILURE', 'EXTERNAL_PROVIDER');

    const facts = await loadRecoveryCaseFacts(pool, seed.workspaceId, caseId, NOW);
    assert.ok(facts);
    const byIntent = new Map((facts!.recoveryActions ?? []).map((a) => [a.actionRef, a]));

    const book = byIntent.get(bookPlan.intents[0]!.id);
    assert.ok(book);
    assert.equal(book!.observationResult, 'CONFIRMED');
    assert.equal(book!.executionState, 'COMPLETED');

    const cancel = byIntent.get(cancelPlan.intents[0]!.id);
    assert.ok(cancel);
    assert.equal(cancel!.observationResult, 'CANCELLED');
    assert.equal(cancel!.executionState, 'COMPLETED');

    const failed = byIntent.get(failedPlan.intents[0]!.id);
    assert.ok(failed);
    assert.equal(failed!.observationResult, 'FAILED');
    assert.equal(failed!.executionState, 'FAILED');
  });
});

/**
 * R1 C9 — decision-time planning evidence on the REAL PostgreSQL Case read model.
 *
 * The attempt is produced by the actual RecoveryPlanningCoordinator against a
 * case opened through the normal runtime path, persisted through the atomic
 * completion command, then read back through
 *   findLatestRecoveryPlanningAttemptForCase -> loadRecoveryCaseFactsInner
 *   -> projectRecoveryCase
 * (via `loadRecoveryCaseFacts`, which wraps the inner loader in one snapshot).
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed, seedRootSubject } from './m2Seed.ts';
import { seedJourney, seedTraveller, seedTrip } from './m6WorldSeed.ts';
import { openDisruptionCase, R1_NOW, type OpenCase } from './r1ProgrammeWorld.ts';
import { createRecoveryPlanningCoordinator } from '../src/app/target/recoveryPlanningCoordinator.ts';
import { approveRecoveryStrategy } from '../src/app/target/recoveryApproval.ts';
import { runInternalExecutionPass } from '../src/app/target/executionPass.ts';
import { runCaseResolutionPass } from '../src/app/target/caseResolutionPass.ts';
import {
  findLatestRecoveryPlanningAttemptForCase,
  persistRecoveryPlanningAttempt,
} from '../src/persistence/postgres/commands/r1PlanningAttemptCommands.ts';
import { assemblePlanningAttempt } from '../src/resolution/planning/decisionEvidence.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { loadRecoveryCaseFacts } from '../src/app/target/readmodels/pgFactAssembler.ts';
import { projectRecoveryCase } from '../src/app/target/readmodels/projectRecoveryCase.ts';
import type { PlanningEvidenceView } from '../src/contracts/v2/product/readModels.ts';

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

async function view(c: Pick<OpenCase, 'pool'> & { workspaceId: string; caseId: string }, at = R1_NOW) {
  const facts = await loadRecoveryCaseFacts(c.pool, c.workspaceId, c.caseId, at);
  assert.ok(facts);
  return projectRecoveryCase(facts);
}

describe('C9 planning evidence on the PostgreSQL Case read model (coordinator-produced attempt)', () => {
  let c: OpenCase;
  let planned: PlanningEvidenceView;
  let strategyRef: string;
  after(async () => { if (c) await c.app.close(); });

  test('no attempt => no fabricated planning block', async () => {
    c = await openDisruptionCase('R1 C9 projection');
    const before = await view({ pool: c.pool, workspaceId: c.world.workspaceId, caseId: c.caseId });
    assert.equal(before.planningEvidence, undefined, 'a case that never planned carries no planning evidence');
    assert.equal(await findLatestRecoveryPlanningAttemptForCase(c.pool, c.world.workspaceId, c.caseId), undefined);
  });

  test('the persisted attempt loads into the Case projection with domains, candidates, impacts and recommendation', async () => {
    const coordinator = createRecoveryPlanningCoordinator({
      pool: c.pool, workspaceId: c.world.workspaceId, actorPrincipalId: c.world.actorId,
      uow: () => c.app.unitOfWork(), now: R1_NOW,
    });
    const result = await coordinator.planCase({ recoveryCaseId: c.caseId as never, reason: 'CASE_OPENED' });
    assert.equal(result.outcome, 'AWAITING_AUTHORITY');
    assert.ok(result.recommendation);
    strategyRef = result.recommendation.recommendedStrategyRef;

    const stored = await findLatestRecoveryPlanningAttemptForCase(c.pool, c.world.workspaceId, c.caseId);
    assert.ok(stored, 'attempt persisted through the normal PG path');
    assert.equal(stored.attempt.id, result.planningAttemptRef);

    const v = await view({ pool: c.pool, workspaceId: c.world.workspaceId, caseId: c.caseId });
    const pe = v.planningEvidence;
    assert.ok(pe, 'projection surfaces the persisted attempt');
    planned = pe;

    // Decision-time discriminator + horizon.
    assert.equal(pe.phase, 'DECISION_TIME');
    assert.equal(pe.asOf, stored.attempt.completedAt);
    assert.equal(pe.attemptRef, stored.attempt.id);
    assert.equal(pe.outcome.code, 'AWAITING_AUTHORITY');

    // Domains investigated vs not applicable, straight from the M6 blocking dimensions.
    const programme = pe.domains.find((d) => d.domain.code === 'PROGRAMME');
    assert.equal(programme?.disposition.code, 'INVESTIGATED');
    assert.equal(programme?.domain.label, 'Programme');
    assert.ok(pe.domains.filter((d) => d.domain.code !== 'PROGRAMME').every((d) => d.disposition.code === 'NOT_APPLICABLE'));

    // Candidates: one recommended viable, at least one deterministic rejection with reasons.
    const recommended = pe.candidates.find((cand) => cand.disposition.code === 'RECOMMENDED');
    assert.ok(recommended);
    assert.equal(recommended.strategyRef, strategyRef);
    const rejected = pe.candidates.filter((cand) => cand.disposition.code === 'REJECTED_DETERMINISTIC');
    assert.ok(rejected.length >= 1, 'a materially rejected alternative is retained');
    for (const r of rejected) {
      assert.ok(r.reasons.length >= 2, `deterministic rejection reasons: ${JSON.stringify(r.reasons)}`);
      assert.ok(r.reasons.includes('Not viable'));
      assert.equal(r.strategyRef, undefined, 'a rejected candidate is never a strategy row');
      assert.ok(r.outcomeDelta.some((d) => d.direction.code === 'WORSE'), 'the regression that caused rejection is visible');
    }

    // Viable strategies + recommendation reference real strategy rows.
    assert.deepEqual(pe.viableStrategies.map((s) => s.ref), [strategyRef]);
    assert.equal(pe.recommendation?.recommended.ref, strategyRef);
    assert.equal(pe.recommendation?.provenance.code, 'DETERMINISTIC');
    assert.ok(v.strategies.some((s) => s.strategyRef === strategyRef), 'current-state strategies[] carries the same option');
  });

  test('human labels are primary; the three impact concepts stay distinct', () => {
    for (const d of planned.domains) {
      assert.doesNotMatch(d.domain.label, UUID);
      assert.doesNotMatch(d.disposition.label, UUID);
    }
    const recommended = planned.candidates.find((cand) => cand.disposition.code === 'RECOMMENDED')!;
    assert.doesNotMatch(recommended.proposer.label, UUID);
    assert.doesNotMatch(recommended.domain.label, UUID);
    for (const label of [...recommended.reasons, planned.outcome.label, planned.recommendation!.recommended.label]) assert.doesNotMatch(label, UUID);
    for (const entry of recommended.outcomeDelta) {
      assert.doesNotMatch(entry.subject.label, UUID, 'label is human; the typed ref is secondary');
      assert.match(entry.subject.ref ?? '', UUID);
    }

    const blast = recommended.blastRadius;
    assert.ok(blast);
    // A. immediate change blast radius: the two swapped programme items.
    assert.equal(blast.changed.length, 2);
    assert.ok(blast.changed.every((r) => r.ref?.startsWith('PROGRAMME_ITEM:')));
    // B. directly affected: the failing subject only.
    assert.equal(blast.directlyAffected.length, 1);
    assert.ok(blast.directlyAffected.every((r) => r.ref?.startsWith('JOURNEY:')));
    // C. reassessment closure: the broader set RC-6 re-evaluated.
    assert.ok(blast.reassessed.length > blast.directlyAffected.length, 'closure is wider than the direct effect');
    // D. outcome delta is a separate structure again (verdict movement, not a ref set).
    assert.ok(recommended.outcomeDelta.some((d) => d.direction.code === 'BETTER' && d.baseline === 'FAIL' && d.candidate === 'PASS'));
    assert.ok(recommended.outcomeDelta.length >= blast.reassessed.length, 'delta covers every reassessed subject');
  });

  test('later canonical change does NOT rewrite the decision-time attempt', async () => {
    const before = JSON.stringify(planned);
    const attemptBefore = await c.pool.query(
      'SELECT id, completed_at, recommendation, material_candidates FROM recovery_planning_attempts WHERE workspace_id = $1 AND recovery_case_id = $2',
      [c.world.workspaceId, c.caseId],
    );
    assert.equal(attemptBefore.rowCount, 1);

    // Approve, execute (internal), reassess, resolve: canonical state moves on.
    const approved = await approveRecoveryStrategy(
      { pool: c.pool, workspaceId: c.world.workspaceId, actorPrincipalId: c.world.actorId, uow: () => c.app.unitOfWork(), now: R1_NOW, executorPrincipalId: c.executorPrincipalId },
      { caseId: c.caseId, strategyId: strategyRef, approverPrincipalId: c.operatorPrincipalId },
    );
    assert.equal(approved.ok, true, JSON.stringify(approved));
    const exec = { ...c.lifecycleCtx, executorPrincipalId: c.executorPrincipalId };
    assert.equal((await runInternalExecutionPass(exec)).executed, 1);
    await c.drain();
    assert.equal((await runInternalExecutionPass(exec)).executed, 1);
    await c.drain();
    assert.equal((await runCaseResolutionPass(c.lifecycleCtx)).resolved, 1);

    const later = '2031-06-03T00:00:00.000Z';
    const after = await view({ pool: c.pool, workspaceId: c.world.workspaceId, caseId: c.caseId });
    assert.equal(after.status, 'RESOLVED', 'current state moved on');
    assert.equal(after.tripViability.verdict, 'PASS');
    assert.equal(after.recoveryActions.length, 2);
    assert.equal(JSON.stringify(after.planningEvidence), before, 'decision-time evidence is byte-identical');
    const readLater = await view({ pool: c.pool, workspaceId: c.world.workspaceId, caseId: c.caseId }, later);
    assert.equal(readLater.planningEvidence?.asOf, planned.asOf, 'evidence horizon does not follow the read time');
    // The historical baseline stays FAIL even though the subject is now PASS.
    const delta = after.planningEvidence!.candidates.find((cand) => cand.disposition.code === 'RECOMMENDED')!.outcomeDelta;
    assert.ok(delta.some((d) => d.baseline === 'FAIL'));

    const attemptAfter = await c.pool.query(
      'SELECT id, completed_at, recommendation, material_candidates FROM recovery_planning_attempts WHERE workspace_id = $1 AND recovery_case_id = $2',
      [c.world.workspaceId, c.caseId],
    );
    assert.deepEqual(attemptAfter.rows, attemptBefore.rows);
  });
});

describe('C9 read-only tool provenance through the real loader', () => {
  test('tool evidence, provenance, uncertainty and rejected travel alternatives round-trip into the Case view', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'R1 C9 tool evidence');
    const traveller = await seedTraveller(seed, { displayName: 'Evidence Traveller' });
    const tripId = await seedTrip(seed, { purpose: 'TEST' });
    const journeyId = await seedJourney(seed, { tripId, travellerId: traveller.travellerId });
    const caseId = await seedRootSubject(seed, { kind: 'RECOVERY_CASE' });
    await seed.client.query(`INSERT INTO recovery_cases (workspace_id, id, lifecycle_status, created_by_actor_id) VALUES ($1, $2, 'PLANNING', $3)`, [seed.workspaceId, caseId, seed.actorId]);
    const basisAssessmentId = randomUUID();
    await seed.client.query(
      `INSERT INTO assessments (workspace_id, id, kind, subject_kind, subject_id, evaluated_at, overall_verdict, manifest_detail, manifest_schema_version, created_by_actor_id)
       VALUES ($1, $2, 'VIABILITY', 'JOURNEY', $3, $4::timestamptz, 'FAIL', $5::jsonb, 'r1-c9', $6)`,
      [seed.workspaceId, basisAssessmentId, journeyId, R1_NOW, JSON.stringify({ capture: null, coverageReads: [], missingCoverage: [], evaluatedAt: R1_NOW }), seed.actorId],
    );
    await commitSeed(seed);

    const evidenceRef = randomUUID();
    const attempt = assemblePlanningAttempt({
      id: randomUUID(), recoveryCaseId: caseId, basisAssessmentId,
      basisManifest: { evaluatedAt: R1_NOW, evaluatorVersions: [], aggregateReads: [], scopeReads: [], evidenceReads: [], coverageReads: [], missingCoverage: [] },
      startedAt: '2031-06-01T23:59:00.000Z', completedAt: R1_NOW, coordinatorVersion: 'r1-coordinator/1',
      domains: [{ domainId: 'TRANSPORT', source: 'DETERMINISTIC', disposition: 'INVESTIGATED', reasonCode: 'connection_feasibility_blocking' }],
      evidence: [{
        evidenceRef, requestFingerprint: 'FLIGHT|flight.search|{}', capability: 'FLIGHT', operation: 'flight.search', status: 'PARTIAL',
        summary: 'Two alternatives found on one corridor',
        provenance: { mode: 'REPLAY', providerId: 'provider-a', observedAt: R1_NOW, sourceRefs: [], recordingRef: 'rec-1' },
        uncertainty: [{ code: 'price_volatility', summary: 'Fares may change before booking' }],
      }],
      materialCandidates: [{
        candidateKey: 'transport#0', proposerId: 'proposer.transport-offer', domainId: 'TRANSPORT', disposition: 'REJECTED_DETERMINISTIC',
        evidenceRefs: [evidenceRef], validationReasonCodes: [], viability: 'NOT_VIABLE', viabilityDecisionCodes: ['arrival_after_requirement'],
        outcomeDelta: [{ subjectRef: { kind: 'JOURNEY', id: journeyId }, baseline: 'FAIL', candidate: 'FAIL', delta: 'UNCHANGED' }],
      }],
      viableStrategyRefs: [],
    });
    const stored = await persistRecoveryPlanningAttempt(new PgUnitOfWork(pool, seed.workspaceId), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), attempt, outcome: 'NO_RECOVERY_FOUND',
    });
    assert.equal(stored.ok, true, JSON.stringify(stored));

    const v = await view({ pool, workspaceId: seed.workspaceId, caseId });
    const pe = v.planningEvidence;
    assert.ok(pe);
    assert.equal(pe.outcome.label, 'No viable recovery found');
    assert.equal(pe.tools.length, 1);
    assert.equal(pe.tools[0]?.tool.label, 'Flight search');
    assert.equal(pe.tools[0]?.status.code, 'PARTIAL');
    assert.equal(pe.tools[0]?.provenanceMode.code, 'REPLAY');
    assert.equal(pe.tools[0]?.provider, 'provider-a');
    assert.deepEqual(pe.tools[0]?.uncertainties, ['Fares may change before booking']);
    assert.equal(pe.candidates[0]?.disposition.code, 'REJECTED_DETERMINISTIC');
    assert.deepEqual(pe.candidates[0]?.reasons, ['Not viable', 'Arrival after requirement']);
    assert.equal(pe.recommendation, undefined, 'no viable option => no recommendation');
    assert.deepEqual(pe.viableStrategies, []);
  });
});

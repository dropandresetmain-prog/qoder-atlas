/**
 * R1 L4A — durable recovery-case attention (the C8 ESCALATE surface), real PostgreSQL.
 *
 * Escalation is orthogonal to lifecycle phase: opening attention never moves the
 * case, approves nothing, resolves nothing and never touches canonical state.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed, seedRootSubject } from './m2Seed.ts';
import { seedJourney, seedTraveller, seedTrip } from './m6WorldSeed.ts';
import { openDisruptionCase, R1_NOW } from './r1ProgrammeWorld.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import {
  listRecoveryCaseAttention,
  openRecoveryCaseAttention,
  resolveRecoveryCaseAttention,
} from '../src/persistence/postgres/commands/caseAttentionCommands.ts';
import { createRecoveryPlanningCoordinator } from '../src/app/target/recoveryPlanningCoordinator.ts';
import { approveRecoveryStrategy } from '../src/app/target/recoveryApproval.ts';
import { runInternalExecutionPass } from '../src/app/target/executionPass.ts';
import { runCaseResolutionPass } from '../src/app/target/caseResolutionPass.ts';
import { loadRecoveryCaseFacts } from '../src/app/target/readmodels/pgFactAssembler.ts';
import { projectRecoveryCase } from '../src/app/target/readmodels/projectRecoveryCase.ts';
import type { Pool } from '../src/persistence/postgres/pool.ts';

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

function mustOk<T>(outcome: { ok: boolean; value?: T; conflict?: { kind: string; message: string } }): T {
  if (!outcome.ok || outcome.value === undefined) throw new Error(`${outcome.conflict?.kind}: ${outcome.conflict?.message}`);
  return outcome.value;
}

async function seedCase(pool: Pool) {
  const seed = await beginSeed(pool, 'R1 case attention');
  const traveller = await seedTraveller(seed, { displayName: 'Attention Traveller' });
  const tripId = await seedTrip(seed, { purpose: 'TEST' });
  const journeyId = await seedJourney(seed, { tripId, travellerId: traveller.travellerId });
  const caseId = await seedRootSubject(seed, { kind: 'RECOVERY_CASE' });
  await seed.client.query(`INSERT INTO recovery_cases (workspace_id, id, lifecycle_status, created_by_actor_id) VALUES ($1, $2, 'PLANNING', $3)`, [seed.workspaceId, caseId, seed.actorId]);
  const assessment = async () => {
    const id = randomUUID();
    await seed.client.query(
      `INSERT INTO assessments (workspace_id, id, kind, subject_kind, subject_id, evaluated_at, overall_verdict, manifest_detail, manifest_schema_version, created_by_actor_id)
       VALUES ($1, $2, 'VIABILITY', 'JOURNEY', $3, $4::timestamptz, 'FAIL', $5::jsonb, 'r1-attention', $6)`,
      [seed.workspaceId, id, journeyId, R1_NOW, JSON.stringify({ capture: null, coverageReads: [], missingCoverage: [], evaluatedAt: R1_NOW }), seed.actorId],
    );
    return id;
  };
  const basisA = await assessment();
  const basisB = await assessment();
  await commitSeed(seed);
  return { workspaceId: seed.workspaceId, actorId: seed.actorId, caseId, basisA, basisB };
}

const W1 = randomUUID();
const W2 = randomUUID();
const open = (uow: PgUnitOfWork, ctx: Awaited<ReturnType<typeof seedCase>>, basis: string, reason: 'no_safe_recovery_remaining' | 'human_evidence_or_decision_required', key = randomUUID()) =>
  openRecoveryCaseAttention(uow, { workspaceId: ctx.workspaceId, actorPrincipalId: ctx.actorId, idempotencyKey: key, caseId: ctx.caseId, basisAssessmentId: basis, reason, openedAt: R1_NOW });

describe('R1 case attention (C8 ESCALATE surface)', () => {
  test('ESCALATE opens durable attention without moving the case; visible in the Case read model', async () => {
    const pool = await sharedTestPool();
    const ctx = await seedCase(pool);
    const uow = new PgUnitOfWork(pool, ctx.workspaceId);

    const opened = mustOk(await open(uow, ctx, ctx.basisA, 'no_safe_recovery_remaining'));
    assert.equal(opened.created, true);
    assert.equal(opened.status, 'OPEN');

    const row = await pool.query<{ lifecycle_status: string; closed_at: Date | null }>('SELECT lifecycle_status, closed_at FROM recovery_cases WHERE workspace_id = $1 AND id = $2', [ctx.workspaceId, ctx.caseId]);
    assert.equal(row.rows[0]!.lifecycle_status, 'PLANNING', 'the case phase is untouched');
    assert.equal(row.rows[0]!.closed_at, null, 'attention does not resolve or close the case');

    const view = projectRecoveryCase((await loadRecoveryCaseFacts(pool, ctx.workspaceId, ctx.caseId, R1_NOW))!);
    assert.equal(view.status, 'PLANNING', 'case remains open in its own phase');
    assert.equal(view.attention.length, 1);
    const [a] = view.attention;
    assert.equal(a!.status.code, 'OPEN');
    assert.equal(a!.reason.code, 'no_safe_recovery_remaining');
    assert.equal(a!.reason.label, 'No safe automated recovery remains');
    assert.equal(a!.basisAssessmentRef, ctx.basisA);
    assert.equal(a!.openedAt, R1_NOW);
    assert.equal(a!.resolvedAt, undefined);
    assert.equal(view.planningEvidence, undefined, 'attention is not planning evidence and does not fabricate any');
    assert.equal(view.resolutionSummary, undefined, 'attention never implies resolution');
  });

  test('same case + basis + reason is idempotent, also across distinct wake keys; other keys open distinct records', async () => {
    const pool = await sharedTestPool();
    const ctx = await seedCase(pool);
    const uow = new PgUnitOfWork(pool, ctx.workspaceId);

    const first = mustOk(await open(uow, ctx, ctx.basisA, 'human_evidence_or_decision_required', W1));
    const sameKey = mustOk(await open(uow, ctx, ctx.basisA, 'human_evidence_or_decision_required', W1));
    const otherWake = mustOk(await open(uow, ctx, ctx.basisA, 'human_evidence_or_decision_required', W2));
    assert.equal(first.created, true);
    assert.equal(otherWake.created, false, 'a duplicate wake with a new idempotency key finds the same record');
    assert.equal(otherWake.attentionId, first.attentionId);
    assert.equal(sameKey.attentionId, first.attentionId);
    assert.equal((await listRecoveryCaseAttention(pool, ctx.workspaceId, ctx.caseId)).length, 1);

    // Distinct reason, and distinct basis, are distinct facts.
    mustOk(await open(uow, ctx, ctx.basisA, 'no_safe_recovery_remaining'));
    mustOk(await open(uow, ctx, ctx.basisB, 'human_evidence_or_decision_required'));
    assert.equal((await listRecoveryCaseAttention(pool, ctx.workspaceId, ctx.caseId)).length, 3);
  });

  test('a newer settled basis clears stale attention; resolved rows are immutable history', async () => {
    const pool = await sharedTestPool();
    const ctx = await seedCase(pool);
    const uow = new PgUnitOfWork(pool, ctx.workspaceId);
    mustOk(await open(uow, ctx, ctx.basisA, 'no_safe_recovery_remaining'));
    mustOk(await open(uow, ctx, ctx.basisB, 'human_evidence_or_decision_required'));

    const clear = () => resolveRecoveryCaseAttention(uow, {
      workspaceId: ctx.workspaceId, actorPrincipalId: ctx.actorId, idempotencyKey: `clear:${ctx.caseId}:${ctx.basisB}`,
      caseId: ctx.caseId, resolution: 'basis_superseded', currentBasisAssessmentId: ctx.basisB, resolvedAt: R1_NOW,
    });
    assert.equal(mustOk(await clear()).resolved, 1);
    assert.equal(mustOk(await clear()).resolved, 1, 'replay returns the original receipt, not a second write');
    const rows = await listRecoveryCaseAttention(pool, ctx.workspaceId, ctx.caseId);
    assert.deepEqual(rows.map((r) => [r.basisAssessmentId === ctx.basisA, r.status, r.resolutionCode]).sort(), [[false, 'OPEN', undefined], [true, 'RESOLVED', 'basis_superseded']].sort());

    const view = projectRecoveryCase((await loadRecoveryCaseFacts(pool, ctx.workspaceId, ctx.caseId, R1_NOW))!);
    assert.deepEqual(view.attention.map((a) => a.status.code).sort(), ['OPEN', 'RESOLVED']);
    assert.equal(view.attention.find((a) => a.status.code === 'RESOLVED')?.resolution?.label, 'Superseded by newer assessment');

    // Resolved history cannot be reopened or deleted; identity is immutable.
    await assert.rejects(() => pool.query(`UPDATE recovery_case_attention SET status = 'OPEN', resolved_at = NULL, resolved_by_actor_id = NULL, resolution_code = NULL WHERE workspace_id = $1 AND basis_assessment_id = $2`, [ctx.workspaceId, ctx.basisA]), /OPEN -> RESOLVED/);
    await assert.rejects(() => pool.query(`DELETE FROM recovery_case_attention WHERE workspace_id = $1`, [ctx.workspaceId]), /append-only/);
    await assert.rejects(() => pool.query(`UPDATE recovery_case_attention SET reason_code = 'no_safe_recovery_remaining', status = 'RESOLVED', resolved_at = now(), resolved_by_actor_id = 'x', resolution_code = 'case_resolved' WHERE workspace_id = $1 AND status = 'OPEN'`, [ctx.workspaceId]), /identity columns are immutable/);
  });

  test('refuses closed reason vocabulary, missing basis and terminal cases; no ESCALATED phase exists', async () => {
    const pool = await sharedTestPool();
    const ctx = await seedCase(pool);
    const uow = new PgUnitOfWork(pool, ctx.workspaceId);
    const bad = await open(uow, ctx, ctx.basisA, 'invented_reason' as never);
    assert.equal(bad.ok, false);
    const noBasis = await open(uow, ctx, randomUUID(), 'no_safe_recovery_remaining');
    assert.equal(noBasis.ok, false);

    await pool.query(`UPDATE recovery_cases SET lifecycle_status = 'CANCELLED', closed_at = now() WHERE workspace_id = $1 AND id = $2`, [ctx.workspaceId, ctx.caseId]);
    const terminal = await open(uow, ctx, ctx.basisA, 'no_safe_recovery_remaining');
    assert.equal(terminal.ok, false);
    assert.equal((await listRecoveryCaseAttention(pool, ctx.workspaceId, ctx.caseId)).length, 0);

    // The retired operational aggregate's ESCALATED phase is NOT resurrected.
    const phases = await pool.query<{ status: string }>('SELECT status FROM recovery_case_lifecycles');
    assert.ok(!phases.rows.some((r) => /ESCALAT/i.test(r.status)));
  });

  test('resolving the case through its owner clears open attention atomically', async () => {
    const c = await openDisruptionCase('R1 attention resolve');
    try {
      const ws = c.world.workspaceId;
      const coordinator = createRecoveryPlanningCoordinator({ pool: c.pool, workspaceId: ws, actorPrincipalId: c.world.actorId, uow: () => c.app.unitOfWork(), now: R1_NOW });
      const planned = await coordinator.planCase({ recoveryCaseId: c.caseId as never, reason: 'CASE_OPENED' });
      const basis = planned.basisAssessmentId;
      mustOk(await openRecoveryCaseAttention(c.app.unitOfWork(), {
        workspaceId: ws, actorPrincipalId: c.world.actorId, idempotencyKey: randomUUID(), caseId: c.caseId,
        basisAssessmentId: basis, reason: 'human_evidence_or_decision_required', openedAt: R1_NOW,
      }));
      const approved = await approveRecoveryStrategy(
        { pool: c.pool, workspaceId: ws, actorPrincipalId: c.world.actorId, uow: () => c.app.unitOfWork(), now: R1_NOW, executorPrincipalId: c.executorPrincipalId },
        { caseId: c.caseId, strategyId: planned.recommendation!.recommendedStrategyRef, approverPrincipalId: c.operatorPrincipalId },
      );
      assert.equal(approved.ok, true);
      const exec = { ...c.lifecycleCtx, executorPrincipalId: c.executorPrincipalId };
      await runInternalExecutionPass(exec); await c.drain(); await runInternalExecutionPass(exec); await c.drain();
      const res = await runCaseResolutionPass(c.lifecycleCtx); assert.equal(res.resolved, 1, JSON.stringify(res.outcomes));

      const rows = await listRecoveryCaseAttention(c.pool, ws, c.caseId);
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.status, 'RESOLVED');
      assert.equal(rows[0]!.resolutionCode, 'case_resolved');
      const view = projectRecoveryCase((await loadRecoveryCaseFacts(c.pool, ws, c.caseId, R1_NOW))!);
      assert.equal(view.status, 'RESOLVED');
      assert.ok(view.attention.every((a) => a.status.code === 'RESOLVED'), 'a RESOLVED case carries no OPEN attention');
    } finally {
      await c.app.close();
    }
  });
});

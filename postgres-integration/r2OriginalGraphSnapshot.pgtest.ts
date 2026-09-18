/**
 * R2 L1 — the immutable ORIGINAL focused Case graph snapshot (migration 0127),
 * real PostgreSQL.
 *
 * Part A proves the persistence contract on a hand-seeded case: first capture,
 * idempotent duplicates, no overwrite by a later/different capture, strict typed
 * round-trip, FK/ownership integrity, DB-level immutability and size bound, and
 * that a failed capture leaves nothing behind.
 *
 * Part B proves the lifecycle trigger and the "Original never moves" invariants
 * on the composed programme world driven by real C4 wakes: captured at the first
 * settled FAILING basis, before planning; byte-identical through planning,
 * approval, execution and resolution; CURRENT independently becomes healthy.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed, seedRootSubject } from './m2Seed.ts';
import { seedJourney, seedTraveller, seedTrip } from './m6WorldSeed.ts';
import { openDisruptionCase, R1_NOW, type OpenCase, type WorldSpec } from './r1ProgrammeWorld.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import {
  captureOriginalCaseGraphSnapshot,
  loadOriginalCaseGraphSnapshot,
} from '../src/persistence/postgres/commands/caseGraphSnapshotCommands.ts';
import { deriveOriginalGraphPayload, ensureOriginalCaseGraph } from '../src/app/target/originalCaseGraphCapture.ts';
import { createRecoveryPlanningCoordinator } from '../src/app/target/recoveryPlanningCoordinator.ts';
import { approveRecoveryStrategy } from '../src/app/target/recoveryApproval.ts';
import { runInternalExecutionPass } from '../src/app/target/executionPass.ts';
import { runRecoveryProgressionPass } from '../src/app/target/recoveryProgressionPass.ts';
import { loadRecoveryCaseFacts } from '../src/app/target/readmodels/pgFactAssembler.ts';
import { projectRecoveryCase } from '../src/app/target/readmodels/projectRecoveryCase.ts';
import { createPeriodicService } from '../src/app/runtimeServices.ts';
import type { OriginalGraphSnapshotPayload } from '../src/contracts/v2/product/readModels.ts';
import type { Pool } from '../src/persistence/postgres/pool.ts';

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

function mustOk<T>(outcome: { ok: boolean; value?: T; conflict?: { kind: string; message: string } }): T {
  if (!outcome.ok || outcome.value === undefined) throw new Error(`${outcome.conflict?.kind}: ${outcome.conflict?.message}`);
  return outcome.value;
}

const payload = (label = 'Replacement flight'): OriginalGraphSnapshotPayload => ({
  schemaVersion: 1,
  caseStatusAtCapture: 'OPEN',
  ldg: {
    scope: 'FOCUSED_CASE',
    nodes: [
      { ref: 'SERVICE_BOOKING:a', kind: 'SERVICE_BOOKING', label, semanticState: 'CHANGED', authority: 'AUTHORITATIVE' },
      { ref: 'TRAVELLER:t', kind: 'TRAVELLER', label: 'Alex Rivera', semanticState: 'FAILED', authority: 'AUTHORITATIVE', evaluation: 'CURRENT' },
    ],
    edges: [{ id: 'e1', fromRef: 'SERVICE_BOOKING:a', toRef: 'TRAVELLER:t', kind: 'RELIES_ON', authority: 'AUTHORITATIVE' }],
    change: { projectionRevision: 3, changedVisibleRefs: [], changedEdgeIds: [], currentSemanticState: 'FAILED' },
  },
  focusedGraph: { causalNodeRefs: ['SERVICE_BOOKING:a', 'TRAVELLER:t'], causalEdgeIds: ['e1'], unmappedCausalSteps: [] },
  subjectLabels: { 'JOURNEY:j': 'Alex Rivera' },
});

async function seedCase(pool: Pool, label: string) {
  const seed = await beginSeed(pool, label);
  const traveller = await seedTraveller(seed, { displayName: 'Snapshot Traveller' });
  const tripId = await seedTrip(seed, { purpose: 'TEST' });
  const journeyId = await seedJourney(seed, { tripId, travellerId: traveller.travellerId });
  const caseId = await seedRootSubject(seed, { kind: 'RECOVERY_CASE' });
  await seed.client.query(`INSERT INTO recovery_cases (workspace_id, id, lifecycle_status, created_by_actor_id) VALUES ($1, $2, 'OPEN', $3)`, [seed.workspaceId, caseId, seed.actorId]);
  const basis = randomUUID();
  await seed.client.query(
    `INSERT INTO assessments (workspace_id, id, kind, subject_kind, subject_id, evaluated_at, overall_verdict, manifest_detail, manifest_schema_version, created_by_actor_id)
     VALUES ($1, $2, 'VIABILITY', 'JOURNEY', $3, $4::timestamptz, 'FAIL', $5::jsonb, 'r2-snap', $6)`,
    [seed.workspaceId, basis, journeyId, R1_NOW, JSON.stringify({ capture: null, coverageReads: [], missingCoverage: [], evaluatedAt: R1_NOW }), seed.actorId],
  );
  await commitSeed(seed);
  return { workspaceId: seed.workspaceId, actorId: seed.actorId, caseId, basis };
}

describe('R2 Original graph snapshot persistence (real PostgreSQL)', () => {
  test('first capture succeeds and round-trips through the strict typed schema', async () => {
    const pool = await sharedTestPool();
    const ctx = await seedCase(pool, 'R2 snapshot first');
    const uow = new PgUnitOfWork(pool, ctx.workspaceId);
    assert.equal(await loadOriginalCaseGraphSnapshot(pool, ctx.workspaceId, ctx.caseId), undefined, 'nothing before capture');
    const out = mustOk(await captureOriginalCaseGraphSnapshot(uow, {
      workspaceId: ctx.workspaceId, actorPrincipalId: ctx.actorId, idempotencyKey: randomUUID(),
      caseId: ctx.caseId, basisAssessmentId: ctx.basis, capturedAt: R1_NOW, payload: payload(),
    }));
    assert.equal(out.captured, true);
    const loaded = await loadOriginalCaseGraphSnapshot(pool, ctx.workspaceId, ctx.caseId);
    assert.ok(loaded);
    assert.equal(loaded.capturedAt, R1_NOW);
    assert.equal(loaded.basisAssessmentRef, ctx.basis);
    assert.deepEqual(loaded.ldg, payload().ldg);
    assert.deepEqual(loaded.focusedGraph, payload().focusedGraph);
    assert.deepEqual(loaded.subjectLabels, payload().subjectLabels);
    // Semantic only: nothing render-shaped is stored.
    const raw = await pool.query<{ snapshot: unknown }>('SELECT snapshot FROM recovery_case_graph_snapshots WHERE workspace_id = $1', [ctx.workspaceId]);
    assert.doesNotMatch(JSON.stringify(raw.rows[0]!.snapshot), /<svg|<div|<style|viewBox|transform|animation/i);
  });

  test('duplicate capture is idempotent and a later, different capture can never overwrite the Original', async () => {
    const pool = await sharedTestPool();
    const ctx = await seedCase(pool, 'R2 snapshot dup');
    const uow = new PgUnitOfWork(pool, ctx.workspaceId);
    const cap = (key: string, p: OriginalGraphSnapshotPayload, at: string) => captureOriginalCaseGraphSnapshot(uow, {
      workspaceId: ctx.workspaceId, actorPrincipalId: ctx.actorId, idempotencyKey: key, caseId: ctx.caseId, basisAssessmentId: ctx.basis, capturedAt: at, payload: p,
    });
    const first = mustOk(await cap('k1', payload('First'), R1_NOW));
    const sameKey = mustOk(await cap('k1', payload('First'), R1_NOW));
    const otherWake = mustOk(await cap('k2', payload('First'), R1_NOW));
    const different = mustOk(await cap('k3', payload('A LATER, DIFFERENT GRAPH'), '2031-06-03T09:00:00.000Z'));
    assert.equal(first.captured, true);
    assert.equal(sameKey.captured, true, 'same key replays the original receipt');
    assert.equal(otherWake.captured, false);
    assert.equal(different.captured, false);
    const rows = await pool.query('SELECT 1 FROM recovery_case_graph_snapshots WHERE workspace_id = $1 AND recovery_case_id = $2', [ctx.workspaceId, ctx.caseId]);
    assert.equal(rows.rowCount, 1, 'exactly one Original per case');
    const loaded = await loadOriginalCaseGraphSnapshot(pool, ctx.workspaceId, ctx.caseId);
    assert.equal(loaded!.ldg.nodes[0]!.label, 'First');
    assert.equal(loaded!.capturedAt, R1_NOW);
  });

  test('the table itself refuses UPDATE and DELETE, a second kind, and an oversized payload', async () => {
    const pool = await sharedTestPool();
    const ctx = await seedCase(pool, 'R2 snapshot immut');
    const uow = new PgUnitOfWork(pool, ctx.workspaceId);
    mustOk(await captureOriginalCaseGraphSnapshot(uow, { workspaceId: ctx.workspaceId, actorPrincipalId: ctx.actorId, idempotencyKey: randomUUID(), caseId: ctx.caseId, capturedAt: R1_NOW, payload: payload() }));
    await assert.rejects(() => pool.query(`UPDATE recovery_case_graph_snapshots SET snapshot = '{}'::jsonb WHERE workspace_id = $1`, [ctx.workspaceId]), /immutable/);
    await assert.rejects(() => pool.query(`DELETE FROM recovery_case_graph_snapshots WHERE workspace_id = $1`, [ctx.workspaceId]), /immutable/);
    await assert.rejects(() => pool.query(
      `INSERT INTO recovery_case_graph_snapshots (workspace_id, recovery_case_id, snapshot_kind, schema_version, snapshot, captured_at, created_by_actor_id)
       VALUES ($1, $2, 'CURRENT', 1, '{}'::jsonb, now(), 'x')`, [ctx.workspaceId, ctx.caseId]), /snapshot_kind/);
    const other = await seedCase(pool, 'R2 snapshot big');
    const huge = JSON.stringify({ pad: 'x'.repeat(300_000) });
    await assert.rejects(() => pool.query(
      `INSERT INTO recovery_case_graph_snapshots (workspace_id, recovery_case_id, snapshot_kind, schema_version, snapshot, captured_at, created_by_actor_id)
       VALUES ($1, $2, 'ORIGINAL', 1, $3::jsonb, now(), 'x')`, [other.workspaceId, other.caseId, huge]), /snapshot_shape/);
  });

  test('the application boundary refuses unbounded/unknown shapes; nothing malformed is left behind', async () => {
    const pool = await sharedTestPool();
    const ctx = await seedCase(pool, 'R2 snapshot bounds');
    const uow = new PgUnitOfWork(pool, ctx.workspaceId);
    const bad = (p: unknown) => captureOriginalCaseGraphSnapshot(uow, { workspaceId: ctx.workspaceId, actorPrincipalId: ctx.actorId, idempotencyKey: randomUUID(), caseId: ctx.caseId, capturedAt: R1_NOW, payload: p as OriginalGraphSnapshotPayload });
    const p = payload();
    const tooMany = { ...p, ldg: { ...p.ldg, nodes: Array.from({ length: 201 }, (_, i) => ({ ...p.ldg.nodes[0]!, ref: `SERVICE_BOOKING:${i}` })) } };
    assert.equal((await bad(tooMany)).ok, false, 'node bound');
    assert.equal((await bad({ ...p, html: '<svg/>' })).ok, false, 'unknown keys (html/svg) are refused');
    assert.equal((await bad({ ...p, focusedGraph: { ...p.focusedGraph!, causalNodeRefs: ['SERVICE_BOOKING:ghost'] } })).ok, false, 'dangling causal ref');
    const n = await pool.query('SELECT 1 FROM recovery_case_graph_snapshots WHERE workspace_id = $1', [ctx.workspaceId]);
    assert.equal(n.rowCount, 0, 'no malformed row');
  });

  test('FK / ownership integrity: unknown case, foreign workspace case and foreign basis are refused and roll back', async () => {
    const pool = await sharedTestPool();
    const a = await seedCase(pool, 'R2 snapshot ws A');
    const b = await seedCase(pool, 'R2 snapshot ws B');
    const uowA = new PgUnitOfWork(pool, a.workspaceId);
    const cap = (caseId: string, basis?: string) => captureOriginalCaseGraphSnapshot(uowA, {
      workspaceId: a.workspaceId, actorPrincipalId: a.actorId, idempotencyKey: randomUUID(), caseId, ...(basis ? { basisAssessmentId: basis } : {}), capturedAt: R1_NOW, payload: payload(),
    });
    assert.equal((await cap(randomUUID())).ok, false, 'unknown case');
    assert.equal((await cap(b.caseId)).ok, false, 'case owned by another workspace');
    assert.equal((await cap(a.caseId, b.basis)).ok, false, 'basis assessment owned by another workspace');
    assert.equal((await cap(a.caseId, randomUUID())).ok, false, 'unknown basis assessment');
    const n = await pool.query('SELECT 1 FROM recovery_case_graph_snapshots WHERE workspace_id = ANY($1::uuid[])', [[a.workspaceId, b.workspaceId]]);
    assert.equal(n.rowCount, 0, 'every refused capture rolled back completely');
    mustOk(await cap(a.caseId, a.basis));
    assert.ok(await loadOriginalCaseGraphSnapshot(pool, a.workspaceId, a.caseId), 'a valid capture still succeeds after refusals');
  });

  test('a case with no truthful graph yet captures nothing (no fake "captured at creation")', async () => {
    const pool = await sharedTestPool();
    const ctx = await seedCase(pool, 'R2 snapshot notyet');
    const facts = (await loadRecoveryCaseFacts(pool, ctx.workspaceId, ctx.caseId, R1_NOW))!;
    assert.equal(deriveOriginalGraphPayload(projectRecoveryCase(facts)).ok, false);
    const res = await ensureOriginalCaseGraph(
      { pool, workspaceId: ctx.workspaceId, actorPrincipalId: ctx.actorId, uow: () => new PgUnitOfWork(pool, ctx.workspaceId) },
      { caseId: ctx.caseId, now: R1_NOW },
    );
    assert.equal(res.status, 'NOT_YET_TRUTHFUL');
    assert.equal(await loadOriginalCaseGraphSnapshot(pool, ctx.workspaceId, ctx.caseId), undefined);
  });
});

const SPEC: WorldSpec = { day: '2026-09-05', now: '2026-09-04T22:00:00.000Z' };

describe('R2 Original graph lifecycle: captured at the first settled failing basis, never moved after (real PostgreSQL)', () => {
  let c: OpenCase;
  after(async () => { if (c) await c.app.close(); });

  test('Original survives planning, approval, execution and resolution byte-identically while Current becomes healthy', async () => {
    c = await openDisruptionCase('R2 original lifecycle', SPEC);
    const ws = c.world.workspaceId;
    const now = c.now;
    const uow = () => c.app.unitOfWork();
    const planner = createRecoveryPlanningCoordinator({ pool: c.pool, workspaceId: ws, actorPrincipalId: c.world.actorId, uow, now });
    const progression = createPeriodicService({
      name: 'progression', pollMs: 60_000, now: () => now,
      run: () => runRecoveryProgressionPass({ pool: c.pool, workspaceId: ws, actorPrincipalId: c.world.actorId, uow, planner, now }),
    });
    const wake = async () => { await progression.runNow(); assert.equal(progression.health().lastError, undefined); };
    const original = () => loadOriginalCaseGraphSnapshot(c.pool, ws, c.caseId);
    const rawOriginal = async () => JSON.stringify((await c.pool.query('SELECT snapshot, captured_at, basis_assessment_id FROM recovery_case_graph_snapshots WHERE workspace_id = $1 AND recovery_case_id = $2', [ws, c.caseId])).rows);
    const current = async () => projectRecoveryCase((await loadRecoveryCaseFacts(c.pool, ws, c.caseId, now))!);
    const planCount = async () => Number((await c.pool.query<{ n: string }>('SELECT count(*)::text AS n FROM recovery_planning_attempts WHERE workspace_id = $1', [ws])).rows[0]!.n);

    // The case is open and failing, but no wake has run: nothing captured yet.
    assert.equal(await original(), undefined, 'not captured at case creation');
    assert.equal((await current()).originalFocusedGraph, undefined, 'honest unavailable before capture');

    // wake 1: capture happens BEFORE planning dispatch.
    await wake();
    assert.equal(await planCount(), 1);
    const captured = await original();
    assert.ok(captured, 'Original captured on the first settled failing basis');
    assert.equal(captured.capturedAt, now);
    assert.ok(captured.basisAssessmentRef, 'basis recorded');
    assert.equal(captured.caseStatusAtCapture, 'OPEN', 'captured before planning moved the case');
    assert.ok(captured.focusedGraph?.firstBreakpoint, 'a truthful focused graph with a first breakpoint');
    const frozen = await rawOriginal();
    const frozenView = JSON.stringify(captured);

    // The Case read path exposes exactly what is stored; CURRENT is separate.
    const planned = await current();
    assert.equal(JSON.stringify(planned.originalFocusedGraph), frozenView);
    assert.equal(planned.tripViability.verdict, 'FAIL');

    // duplicate wake / read polling never move it.
    await wake();
    for (let i = 0; i < 3; i += 1) await current();
    assert.equal(await rawOriginal(), frozen, 'duplicate wakes and polling do not mutate the Original');
    const again = await ensureOriginalCaseGraph({ pool: c.pool, workspaceId: ws, actorPrincipalId: c.world.actorId, uow }, { caseId: c.caseId, now });
    assert.equal(again.status, 'EXISTS');

    // approval, then execution, then reassessment.
    const strategyRef = planned.planningEvidence!.recommendation!.recommended.ref!;
    const approved = await approveRecoveryStrategy(
      { pool: c.pool, workspaceId: ws, actorPrincipalId: c.world.actorId, uow, now, executorPrincipalId: c.executorPrincipalId },
      { caseId: c.caseId, strategyId: strategyRef, approverPrincipalId: c.operatorPrincipalId },
    );
    assert.equal(approved.ok, true, JSON.stringify(approved));
    await wake();
    assert.equal(await rawOriginal(), frozen, 'approval does not mutate the Original');

    const exec = { ...c.lifecycleCtx, executorPrincipalId: c.executorPrincipalId };
    assert.equal((await runInternalExecutionPass(exec)).executed, 1);
    await c.drain();
    await wake();
    assert.equal(await rawOriginal(), frozen, 'partial execution does not mutate the Original');
    assert.equal((await runInternalExecutionPass(exec)).executed, 1);
    await c.drain();
    await wake();

    // resolution: Current is authoritative and healthy, Original is untouched.
    const final = await current();
    assert.equal(final.status, 'RESOLVED');
    assert.equal(final.tripViability.verdict, 'PASS');
    assert.equal(await rawOriginal(), frozen, 'resolution does not mutate the Original');
    assert.equal(JSON.stringify(final.originalFocusedGraph), frozenView, 'terminal reload still retrieves the identical Original');
    assert.notEqual(
      JSON.stringify(final.ldg.nodes.map((n) => n.semanticState)),
      JSON.stringify(captured.ldg.nodes.map((n) => n.semanticState)),
      'Current diverged from Original',
    );
    assert.equal(await planCount(), 1);
  });
});

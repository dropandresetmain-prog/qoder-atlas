/**
 * R1 L5 — the composed B1 acceptance path on real PostgreSQL.
 *
 *   provider-shaped change -> canonical state -> dependency propagation
 *   -> whole-trip FAIL -> C4 wake -> generalized planner -> relevant domains
 *   -> read-only transport research (checked-in REPLAY recording)
 *   -> provider-normalized offers -> transport candidates
 *   -> deterministic RC-6 -> material rejected/inferior travel evidence
 *   -> programme possibility -> blast / closure / outcome delta
 *   -> viable-only recommendation -> approval -> ActionPlan/ActionIntent
 *   -> existing internal execution -> observation -> canonical programme change
 *   -> reassessment -> C4 wake -> current PASS -> RecoveryCase RESOLVED
 *
 * The world is generic. The application contains no persona/event branch, and
 * this test does NOT encode "try flights, then programme": which strategy wins is
 * whatever the applicable domains, evidence, RC-6 and the comparator produce.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { sharedTestPool } from './harness.ts';
import { openDisruptionCase, worldAt, type OpenCase, type WorldSpec } from './r1ProgrammeWorld.ts';
import { createRecoveryPlanningCoordinator } from '../src/app/target/recoveryPlanningCoordinator.ts';
import { runRecoveryProgressionPass } from '../src/app/target/recoveryProgressionPass.ts';
import { approveRecoveryStrategy } from '../src/app/target/recoveryApproval.ts';
import { runInternalExecutionPass } from '../src/app/target/executionPass.ts';
import { createPeriodicService } from '../src/app/runtimeServices.ts';
import { createPlanningToolTransport } from '../src/resolution/planning/replayPlanningTransport.ts';
import { FileRecordingStore } from '../src/providers/recordingStore.ts';
import { AtlasFlightAdapter } from '../src/providers/atlas/adapter.ts';
import { loadRecoveryCaseFacts } from '../src/app/target/readmodels/pgFactAssembler.ts';
import { projectRecoveryCase } from '../src/app/target/readmodels/projectRecoveryCase.ts';

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

// The checked-in recording is a one-way search MNL->CEB on 2026-09-05 (Asia/Manila).
// These codes describe that fixture; the application code hardcodes none of them.
const SPEC: WorldSpec = {
  day: '2026-09-05',
  now: '2026-09-04T22:00:00.000Z',
  transport: { originIata: 'MNL', destinationIata: 'CEB', timeZone: 'Asia/Manila' },
};

function replayTransport(observedAt: string) {
  const adapter = new AtlasFlightAdapter({
    mode: 'REPLAY',
    store: new FileRecordingStore({ readDirs: ['fixtures/recordings'] }),
    timezoneResolver: (code: string) => (code === 'MNL' || code === 'CEB' ? 'Asia/Manila' : undefined),
  });
  return createPlanningToolTransport({ capabilities: { flight: adapter }, observedAt });
}

describe('R1 composed B1 (real PostgreSQL)', () => {
  let c: OpenCase;
  after(async () => { if (c) await c.app.close(); });

  test('the full loop, driven by C4 wakes, resolves the case and the Case read model explains it', async () => {
    c = await openDisruptionCase('R1 composed B1', SPEC);
    const ws = c.world.workspaceId;
    const now = c.now;
    const planner = createRecoveryPlanningCoordinator({
      pool: c.pool, workspaceId: ws, actorPrincipalId: c.world.actorId, uow: () => c.app.unitOfWork(), now,
      transportPlanning: { transport: replayTransport(now), passengers: { adults: 1 } },
    });
    const progression = createPeriodicService({
      name: 'progression', pollMs: 60_000, now: () => now,
      run: () => runRecoveryProgressionPass({ pool: c.pool, workspaceId: ws, actorPrincipalId: c.world.actorId, uow: () => c.app.unitOfWork(), planner, now }),
    });
    const wake = async () => {
      await progression.runNow();
      const health = progression.health();
      assert.equal(health.lastError, undefined, `progression wake error: ${health.lastError}`);
    };
    const count = async (table: string) =>
      Number((await c.pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table} WHERE workspace_id = $1`, [ws])).rows[0]!.n);

    // ---- wake 1: the failing case is planned by the generalized coordinator.
    assert.equal(await count('recovery_planning_attempts'), 0);
    await wake();
    assert.equal(await count('recovery_planning_attempts'), 1);
    const planned = projectRecoveryCase((await loadRecoveryCaseFacts(c.pool, ws, c.caseId, now))!);
    const pe = planned.planningEvidence;
    assert.ok(pe, 'the planning attempt is on the Case read model');

    // What changed / why the trip failed (authoritative rows, not inference).
    assert.equal(planned.cause?.changeSignalRef, `CHANGE_SIGNAL:${c.changeSignalId}`);
    assert.equal(planned.tripViability.verdict, 'FAIL');
    assert.deepEqual(planned.causalPath.map((step) => [step.dimension, step.reasonCode]), [['programme_participation', 'insufficient_arrival_readiness']]);

    // What NORTHSTAR investigated: the domains come from the failing dimension + reason.
    const investigated = pe.domains.filter((d) => d.disposition.code === 'INVESTIGATED').map((d) => d.domain.code).sort();
    assert.deepEqual(investigated, ['PROGRAMME', 'TRANSPORT']);

    // Transport evidence gathered read-only, with provenance.
    const search = pe.tools.find((t) => t.tool.code === 'flight.search');
    assert.ok(search, 'a read-only flight.search was performed');
    assert.equal(search.status.code, 'SUCCEEDED');
    assert.equal(search.provenanceMode.code, 'REPLAY');
    assert.equal(search.provider, 'atlas');

    // Material travel alternatives and why each was not chosen (deterministic RC-6 output).
    const travel = pe.candidates.filter((cand) => cand.domain.code === 'TRANSPORT');
    assert.ok(travel.length >= 1, 'provider-normalized offers became transport candidates');
    for (const cand of travel) {
      assert.equal(cand.disposition.code, 'REJECTED_DETERMINISTIC', 'no boardable offer restores readiness in time');
      assert.ok(cand.reasons.includes('Not viable'), JSON.stringify(cand.reasons));
      assert.equal(cand.strategyRef, undefined, 'a rejected offer is never a strategy row');
    }
    // The programme possibility, weighed by the SAME deterministic evaluation.
    const programme = pe.candidates.filter((cand) => cand.domain.code === 'PROGRAMME');
    assert.ok(programme.some((cand) => cand.disposition.code === 'REJECTED_DETERMINISTIC' && cand.reasons.includes('Regression fail')), 'a programme option that harms others is rejected');
    const recommended = pe.candidates.find((cand) => cand.disposition.code === 'RECOMMENDED');
    assert.ok(recommended, 'a viable-only recommendation exists');
    // Emergent for THIS fixture: RC-6 finds no boardable flight that restores readiness, so the viable lever is the programme.
    assert.equal(recommended.domain.code, 'PROGRAMME');
    const strategyRef = pe.recommendation!.recommended.ref!;
    assert.equal(recommended.strategyRef, strategyRef);
    assert.equal(pe.viableStrategies.length, 1, 'only viable strategies are persisted');

    // Precise impact: three distinct concepts.
    const blast = recommended.blastRadius!;
    assert.equal(blast.changed.length, 2);
    assert.equal(blast.directlyAffected.length, 1);
    assert.ok(blast.reassessed.length > blast.directlyAffected.length);
    assert.ok(recommended.outcomeDelta.some((d) => d.direction.code === 'BETTER' && d.baseline === 'FAIL' && d.candidate === 'PASS'));
    assert.ok(recommended.outcomeDelta.every((d) => d.direction.code !== 'WORSE'), 'the recommendation regresses nobody');

    // ---- wake 2: pending authority => WAIT; no second attempt, nothing executed.
    await wake();
    assert.equal(await count('recovery_planning_attempts'), 1);
    assert.equal(await count('execution_attempts'), 0);

    // ---- approval by the workspace operator -> ActionPlan/ActionIntents.
    const approved = await approveRecoveryStrategy(
      { pool: c.pool, workspaceId: ws, actorPrincipalId: c.world.actorId, uow: () => c.app.unitOfWork(), now, executorPrincipalId: c.executorPrincipalId },
      { caseId: c.caseId, strategyId: strategyRef, approverPrincipalId: c.operatorPrincipalId },
    );
    assert.equal(approved.ok, true, JSON.stringify(approved));
    if (!approved.ok) return;
    assert.equal(approved.report.intents.length, 2, 'a bilateral swap is two ordered internal intents');
    const capabilities = await c.pool.query<{ capability_ref: string }>('SELECT capability_ref FROM action_intents WHERE workspace_id = $1 AND action_plan_id = $2', [ws, approved.report.planId]);
    assert.ok(capabilities.rows.every((r) => r.capability_ref === 'internal:programme.schedule'), 'no external/provider intent was minted');

    // Progression only waits; the existing execution owner does the work.
    await wake();
    assert.equal(await count('execution_attempts'), 0, 'progression never dispatches execution');
    const early = await c.pool.query<{ window_start: Date }>('SELECT window_start FROM programme_items WHERE workspace_id = $1 AND id = $2', [ws, c.world.earlyItemId]);
    assert.equal(early.rows[0]!.window_start.toISOString(), worldAt(SPEC, '11:30'), 'canonical programme unchanged before execution');

    // ---- execution -> observation -> canonical programme change -> reassessment.
    const exec = { ...c.lifecycleCtx, executorPrincipalId: c.executorPrincipalId };
    const first = await runInternalExecutionPass(exec);
    assert.equal(first.executed, 1, JSON.stringify(first));
    await c.drain();
    await wake();
    const midStatus = await c.pool.query<{ lifecycle_status: string }>('SELECT lifecycle_status FROM recovery_cases WHERE workspace_id = $1 AND id = $2', [ws, c.caseId]);
    assert.notEqual(midStatus.rows[0]!.lifecycle_status, 'RESOLVED', 'half-executed recovery does not resolve');
    const second = await runInternalExecutionPass(exec);
    assert.equal(second.executed, 1, JSON.stringify(second));
    await c.drain();
    assert.equal(await count('execution_attempts'), 2);

    const swapped = await c.pool.query<{ id: string; window_start: Date }>('SELECT id, window_start FROM programme_items WHERE workspace_id = $1 AND id = ANY($2::uuid[])', [ws, [c.world.earlyItemId, c.world.lateItemId]]);
    assert.equal(swapped.rows.find((r) => r.id === c.world.earlyItemId)!.window_start.toISOString(), worldAt(SPEC, '14:30'));
    assert.equal(swapped.rows.find((r) => r.id === c.world.lateItemId)!.window_start.toISOString(), worldAt(SPEC, '11:30'));
    assert.equal(await c.verdict(c.world.people[0]!.journeyId), 'PASS', 'canonical change reassessed to a current PASS');

    // ---- final wake: current PASS + reconciled => RESOLVE.
    await wake();
    const final = projectRecoveryCase((await loadRecoveryCaseFacts(c.pool, ws, c.caseId, now))!);
    assert.equal(final.status, 'RESOLVED');
    assert.equal(final.tripViability.verdict, 'PASS');
    assert.ok(final.resolutionSummary);
    assert.equal(final.recoveryActions.length, 2);
    assert.ok(final.recoveryActions.every((a) => a.executionState === 'COMPLETED'), JSON.stringify(final.recoveryActions));
    assert.ok(final.attention.every((a) => a.status.code === 'RESOLVED'), 'no open human attention on a resolved case');
    assert.equal(await count('recovery_planning_attempts'), 1, 'the whole loop needed exactly one planning attempt');

    // Decision-time evidence is intact and separate from the recovered current state.
    assert.equal(JSON.stringify(final.planningEvidence), JSON.stringify(pe));
    assert.equal(final.planningEvidence?.phase, 'DECISION_TIME');
    const again = await runRecoveryProgressionPass({ pool: c.pool, workspaceId: ws, actorPrincipalId: c.world.actorId, uow: () => c.app.unitOfWork(), planner, now });
    assert.equal(again.candidates, 0, 'a resolved case is never progressed again');
  });
});

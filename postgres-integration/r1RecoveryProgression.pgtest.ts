/**
 * R1 L4B — Recovery Lifecycle Progression (C4) against real PostgreSQL.
 *
 * Group 1 drives the pass with a controlled evaluator so each frozen decision
 * (RESOLVE / WAIT / REPLAN / ESCALATE) is exercised in isolation with a spy
 * planner. Group 2 composes the REAL coordinator on the generic programme world
 * to prove idempotency under duplicate/overlapping wakes, supersession by a newer
 * basis, stale-basis refusal, and that progression never dispatches execution.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed, seedRootSubject, type SeedSession } from './m2Seed.ts';
import { seedJourney, seedJurisdictionWithPlaces, seedService, seedTransportIntent, seedTraveller, seedTrip } from './m6WorldSeed.ts';
import { applyProviderDelay, openDisruptionCase, R1_NOW, type OpenCase } from './r1ProgrammeWorld.ts';
import { captureWorld } from '../src/persistence/postgres/world/pgCurrentState.ts';
import { saveAssessment } from '../src/persistence/postgres/world/pgAssessments.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { projectEffectiveWorld } from '../src/resolution/world/effectiveItinerary.ts';
import { assessSubject, createEvaluatorRegistry } from '../src/resolution/evaluation/assess.ts';
import type { Evaluator } from '../src/resolution/evaluation/evaluator.ts';
import { dimension, explain } from '../src/resolution/evaluation/explain.ts';
import { runRecoveryProgressionPass } from '../src/app/target/recoveryProgressionPass.ts';
import { createRecoveryPlanningCoordinator, defaultDomainProposers } from '../src/app/target/recoveryPlanningCoordinator.ts';
import { approveRecoveryStrategy } from '../src/app/target/recoveryApproval.ts';
import { runInternalExecutionPass } from '../src/app/target/executionPass.ts';
import { listRecoveryCaseAttention } from '../src/persistence/postgres/commands/caseAttentionCommands.ts';
import type { RecoveryPlanningCoordinator, RecoveryPlanningInput } from '../src/contracts/v2/planning/recoveryPlanningAttempt.ts';
import type { StrategyProposer } from '../src/resolution/planning/proposer.ts';
import type { Pool } from '../src/persistence/postgres/pool.ts';
import type { TypedRef } from '../src/domain/v2/shared/identity.ts';

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

const ACTOR = 'principal:r1-progression-test';

// ---------------------------------------------------------------------------
// Group 1 — controlled evaluator + spy planner
// ---------------------------------------------------------------------------
const verdictFor = new Map<string, 'PASS' | 'FAIL' | 'UNKNOWN'>();
const controlled: Evaluator = {
  id: 'test.controlled', version: '1', assessmentKind: 'VIABILITY', subjectKinds: ['JOURNEY'], dimensions: ['controlled_requirement'], informationTopics: [],
  evaluate: (subject) => {
    const status = verdictFor.get(subject.id) ?? 'UNKNOWN';
    return {
      dimensions: [dimension({
        dimension: 'controlled_requirement', blocking: true,
        explanations: [explain({
          evaluatorId: 'test.controlled', dimension: 'controlled_requirement', status, reasonCode: status === 'FAIL' ? 'requirement_not_met' : 'requirement_checked',
          cause: { kind: 'WORLD_STATE' }, affectedSubject: subject, facts: { requiredMinutes: 150, availableMinutes: status === 'FAIL' ? 60 : 200 },
        })],
      })],
      evidence: [], missingCoverage: [],
    };
  },
};
const registry = createEvaluatorRegistry([controlled]);

interface Controlled { pool: Pool; seed: SeedSession; journey: TypedRef; caseId: string; calls: RecoveryPlanningInput[]; planner: RecoveryPlanningCoordinator }

async function controlledCase(): Promise<Controlled> {
  const pool = await sharedTestPool();
  const seed = await beginSeed(pool, 'R1 progression controlled');
  const geo = await seedJurisdictionWithPlaces(seed, { name: 'Regime', places: [{ name: 'A', placeType: 'STATION' }, { name: 'B', placeType: 'STATION' }] });
  const travellerId = (await seedTraveller(seed)).travellerId;
  const tripId = await seedTrip(seed);
  const journeyId = await seedJourney(seed, { tripId, travellerId });
  const serviceId = await seedService(seed, { mode: 'RAIL', operator: 'Operator', originPlaceId: geo.placeIds[0]!, destinationPlaceId: geo.placeIds[1]!, published: { departure: '2031-05-02T08:00:00.000Z', arrival: '2031-05-02T09:00:00.000Z' } });
  await seedTransportIntent(seed, { journeyId, orderKey: '010', originPlaceId: geo.placeIds[0]!, destinationPlaceId: geo.placeIds[1]!, selectedServiceId: serviceId });
  const caseId = await seedRootSubject(seed, { kind: 'RECOVERY_CASE' });
  await seed.client.query(`INSERT INTO recovery_cases (workspace_id, id, lifecycle_status, created_by_actor_id) VALUES ($1, $2, 'OPEN', $3)`, [seed.workspaceId, caseId, seed.actorId]);
  await seed.client.query(`INSERT INTO case_subjects (workspace_id, recovery_case_id, subject_kind, subject_id, role) VALUES ($1, $2, 'JOURNEY', $3, 'AFFECTED')`, [seed.workspaceId, caseId, journeyId]);
  await commitSeed(seed);
  const calls: RecoveryPlanningInput[] = [];
  const planner: RecoveryPlanningCoordinator = {
    async planCase(input) {
      calls.push(input);
      throw new Error('spy planner: no plan produced');
    },
  };
  return { pool, seed, journey: { kind: 'JOURNEY', id: journeyId }, caseId, calls, planner };
}

async function assess(c: Controlled, verdict: 'PASS' | 'FAIL' | 'UNKNOWN') {
  verdictFor.set(c.journey.id, verdict);
  const world = await captureWorld(c.pool, { workspaceId: c.seed.workspaceId, focus: [c.journey], at: R1_NOW, informationTopics: registry.informationTopics });
  const { result } = assessSubject({ registry, world, effective: projectEffectiveWorld(world), subject: c.journey, now: R1_NOW, assessmentId: randomUUID() });
  await saveAssessment(c.pool, c.seed.workspaceId, result, ACTOR);
  return result.id;
}

const pass = (c: Controlled) => runRecoveryProgressionPass({
  pool: c.pool, workspaceId: c.seed.workspaceId, actorPrincipalId: ACTOR, uow: () => new PgUnitOfWork(c.pool, c.seed.workspaceId), planner: c.planner, now: R1_NOW,
});

describe('C4 progression — each frozen decision (controlled evaluator, spy planner)', () => {
  test('no settled assessment => WAIT, nothing dispatched', async () => {
    const c = await controlledCase();
    const report = await pass(c);
    assert.equal(report.candidates, 1);
    assert.equal(report.outcomes[0]!.decision, 'WAIT');
    assert.equal(report.outcomes[0]!.reasonCode, 'assessment_not_settled');
    assert.equal(report.outcomes[0]!.dispatch, 'NONE');
    assert.equal(c.calls.length, 0);
    assert.equal((await listRecoveryCaseAttention(c.pool, c.seed.workspaceId, c.caseId)).length, 0);
  });

  test('CURRENT PASS + reconciled => RESOLVE through the existing owner; a terminal case is never progressed again', async () => {
    const c = await controlledCase();
    await assess(c, 'PASS');
    const first = await pass(c);
    assert.equal(first.outcomes[0]!.decision, 'RESOLVE');
    assert.equal(first.outcomes[0]!.dispatch, 'RESOLVED');
    const row = await c.pool.query<{ lifecycle_status: string }>('SELECT lifecycle_status FROM recovery_cases WHERE workspace_id = $1 AND id = $2', [c.seed.workspaceId, c.caseId]);
    assert.equal(row.rows[0]!.lifecycle_status, 'RESOLVED');
    const again = await pass(c);
    assert.equal(again.candidates, 0, 'terminal cases are excluded from progression');
    assert.equal(c.calls.length, 0);
  });

  test('BLOCKING_FAIL with recovery possible => REPLAN from the latest basis, via the planning owner only', async () => {
    const c = await controlledCase();
    const basis = await assess(c, 'FAIL');
    const report = await pass(c);
    const o = report.outcomes[0]!;
    assert.equal(o.decision, 'REPLAN');
    assert.equal(o.basisAssessmentId, basis);
    // The spy planner threw (it produced nothing): reported, never swallowed into success.
    assert.equal(o.dispatch, 'FAILED');
    assert.match(o.detail ?? '', /spy planner/);
    assert.deepEqual(c.calls.map((x) => [x.recoveryCaseId, x.reason]), [[c.caseId, 'CASE_OPENED']]);
  });

  test('UNKNOWN / human evidence needed => durable ESCALATE; a duplicate wake keeps one attention; the case stays open', async () => {
    const c = await controlledCase();
    const basis = await assess(c, 'UNKNOWN');
    const first = await pass(c);
    assert.equal(first.outcomes[0]!.decision, 'ESCALATE');
    assert.equal(first.outcomes[0]!.dispatch, 'ATTENTION_OPENED');
    const second = await pass(c);
    assert.equal(second.outcomes[0]!.decision, 'ESCALATE');
    const attention = await listRecoveryCaseAttention(c.pool, c.seed.workspaceId, c.caseId);
    assert.equal(attention.length, 1);
    assert.equal(attention[0]!.reasonCode, 'human_evidence_or_decision_required');
    assert.equal(attention[0]!.basisAssessmentId, basis);
    assert.equal(attention[0]!.status, 'OPEN');
    const row = await c.pool.query<{ lifecycle_status: string }>('SELECT lifecycle_status FROM recovery_cases WHERE workspace_id = $1 AND id = $2', [c.seed.workspaceId, c.caseId]);
    assert.equal(row.rows[0]!.lifecycle_status, 'OPEN', 'escalation does not move the case');
    assert.equal(c.calls.length, 0, 'no replan on an unknown verdict');
  });

  test('a newly-current assessment supersedes attention on the old basis', async () => {
    const c = await controlledCase();
    const oldBasis = await assess(c, 'UNKNOWN');
    await pass(c);
    const newBasis = await assess(c, 'FAIL');
    assert.notEqual(newBasis, oldBasis);
    const report = await pass(c);
    assert.equal(report.outcomes[0]!.basisAssessmentId, newBasis, 'progression binds to the newest settled basis');
    assert.equal(report.outcomes[0]!.decision, 'REPLAN');
    const attention = await listRecoveryCaseAttention(c.pool, c.seed.workspaceId, c.caseId);
    assert.deepEqual(attention.map((a) => [a.basisAssessmentId === oldBasis, a.status, a.resolutionCode]), [[true, 'RESOLVED', 'basis_superseded']]);
  });
});

// ---------------------------------------------------------------------------
// A5 FIX-1 — D2 tight-only connection is MONITORABLE (WAIT), never ESCALATE.
//
// The controlled evaluator emits ONLY a blocking `connection_feasibility` FAIL
// with `connection_below_minimum` (a positive gap below the registered minimum):
// overallVerdict FAIL, but replacement planning is intentionally NOT eligible
// (`recoveryPlanningEligibleFromAssessment` → false) because a merely-tight
// connection may still recover on its own. The honest progression decision is
// therefore WAIT (failing_state_monitorable): the case stays OPEN, nothing is
// planned, no actionable replacement recommendation is produced and NO attention
// is opened. This is the corrected truth — before FIX-1 the same basis fell
// through to ESCALATE / no_safe_recovery_remaining.
// ---------------------------------------------------------------------------
const tightVerdictFor = new Map<string, 'PASS' | 'FAIL' | 'UNKNOWN'>();
const tightConnection: Evaluator = {
  id: 'test.tightConnection', version: '1', assessmentKind: 'VIABILITY', subjectKinds: ['JOURNEY'], dimensions: ['connection_feasibility'], informationTopics: [],
  evaluate: (subject) => {
    const status = tightVerdictFor.get(subject.id) ?? 'UNKNOWN';
    if (status === 'PASS') {
      return {
        dimensions: [dimension({
          dimension: 'connection_feasibility', blocking: true,
          explanations: [explain({
            evaluatorId: 'test.tightConnection', dimension: 'connection_feasibility', status: 'PASS', reasonCode: 'connection_meets_minimum',
            cause: { kind: 'REQUIREMENT' }, affectedSubject: subject, facts: { gapMinutes: 45, requiredMinutes: 30 },
          })],
        })],
        evidence: [], missingCoverage: [],
      };
    }
    if (status === 'UNKNOWN') {
      return {
        dimensions: [dimension({
          dimension: 'connection_feasibility', blocking: true,
          explanations: [explain({
            evaluatorId: 'test.tightConnection', dimension: 'connection_feasibility', status: 'UNKNOWN', reasonCode: 'connection_time_unknown',
            cause: { kind: 'MISSING_INFORMATION' }, affectedSubject: subject, facts: { gapMinutes: null, requiredMinutes: null },
          })],
        })],
        evidence: [], missingCoverage: [],
      };
    }
    // FAIL — a TIGHT (below-minimum, still positive-gap) connection only.
    return {
      dimensions: [dimension({
        dimension: 'connection_feasibility', blocking: true,
        explanations: [explain({
          evaluatorId: 'test.tightConnection', dimension: 'connection_feasibility', status: 'FAIL', reasonCode: 'connection_below_minimum',
          cause: { kind: 'REQUIREMENT' }, affectedSubject: subject, facts: { gapMinutes: 12, requiredMinutes: 30 },
        })],
      })],
      evidence: [], missingCoverage: [],
    };
  },
};
const tightRegistry = createEvaluatorRegistry([tightConnection]);

async function assessTight(c: Controlled, verdict: 'PASS' | 'FAIL' | 'UNKNOWN') {
  tightVerdictFor.set(c.journey.id, verdict);
  const world = await captureWorld(c.pool, { workspaceId: c.seed.workspaceId, focus: [c.journey], at: R1_NOW, informationTopics: tightRegistry.informationTopics });
  const { result } = assessSubject({ registry: tightRegistry, world, effective: projectEffectiveWorld(world), subject: c.journey, now: R1_NOW, assessmentId: randomUUID() });
  await saveAssessment(c.pool, c.seed.workspaceId, result, ACTOR);
  return result.id;
}

describe('A5 FIX-1 progression — D2 tight-only connection is monitorable (WAIT), not ESCALATE', () => {
  test('a tight-only connection FAIL => WAIT failing_state_monitorable: case stays OPEN, nothing planned, no attention', async () => {
    const c = await controlledCase();
    const basis = await assessTight(c, 'FAIL');
    const report = await pass(c);
    const o = report.outcomes[0]!;
    assert.equal(o.decision, 'WAIT', JSON.stringify(o));
    assert.equal(o.reasonCode, 'failing_state_monitorable');
    assert.equal(o.basisAssessmentId, basis);
    assert.equal(o.dispatch, 'NONE', 'WAIT dispatches nothing');
    assert.equal(c.calls.length, 0, 'a monitorable tight connection never dispatches planning');
    assert.equal(report.planned, 0);
    assert.equal(report.escalated, 0);
    assert.equal(report.waiting, 1);
    // The case stays open (monitoring), never resolved/cancelled/escalated.
    const row = await c.pool.query<{ lifecycle_status: string }>('SELECT lifecycle_status FROM recovery_cases WHERE workspace_id = $1 AND id = $2', [c.seed.workspaceId, c.caseId]);
    assert.equal(row.rows[0]!.lifecycle_status, 'OPEN', 'a monitorable failing state keeps the case OPEN');
    // No actionable replacement recommendation and NO operator attention.
    const attempts = Number((await c.pool.query<{ n: string }>('SELECT count(*)::text AS n FROM recovery_planning_attempts WHERE workspace_id = $1', [c.seed.workspaceId])).rows[0]!.n);
    assert.equal(attempts, 0, 'no planning attempt for a monitorable basis');
    const attention = await listRecoveryCaseAttention(c.pool, c.seed.workspaceId, c.caseId);
    assert.equal(attention.length, 0, 'WAIT opens no attention');

    // Idempotent under a duplicate wake: the same settled basis WAITs again,
    // still planning nothing and opening nothing.
    const again = await pass(c);
    assert.equal(again.outcomes[0]!.decision, 'WAIT');
    assert.equal(again.outcomes[0]!.reasonCode, 'failing_state_monitorable');
    assert.equal(again.candidates, 1, 'the OPEN case is still a progression candidate');
    assert.equal(c.calls.length, 0);
    assert.equal((await listRecoveryCaseAttention(c.pool, c.seed.workspaceId, c.caseId)).length, 0);
  });

  test('the SAME tight connection, once it recovers to PASS, RESOLVEs through the existing owner', async () => {
    const c = await controlledCase();
    // First observe the tight-only FAIL and WAIT (monitor).
    await assessTight(c, 'FAIL');
    assert.equal((await pass(c)).outcomes[0]!.decision, 'WAIT');
    assert.equal((await pass(c)).outcomes[0]!.reasonCode, 'failing_state_monitorable');
    // A later observation shows the connection now meets the minimum: the case
    // resolves. Monitoring is a genuine holding state, not a dead end.
    await assessTight(c, 'PASS');
    const resolved = await pass(c);
    assert.equal(resolved.outcomes[0]!.decision, 'RESOLVE', JSON.stringify(resolved.outcomes));
    assert.equal(resolved.outcomes[0]!.dispatch, 'RESOLVED');
    const row = await c.pool.query<{ lifecycle_status: string }>('SELECT lifecycle_status FROM recovery_cases WHERE workspace_id = $1 AND id = $2', [c.seed.workspaceId, c.caseId]);
    assert.equal(row.rows[0]!.lifecycle_status, 'RESOLVED');
  });

  test('an UNKNOWN tight-connection assessment is NOT monitorable: it escalates for human evidence', async () => {
    const c = await controlledCase();
    await assessTight(c, 'UNKNOWN');
    const report = await pass(c);
    // currentStillFailing is false for UNKNOWN, so the monitorable WAIT does not
    // apply; the frozen contract escalates for human evidence/decision.
    assert.equal(report.outcomes[0]!.decision, 'ESCALATE', JSON.stringify(report.outcomes));
    assert.equal(report.outcomes[0]!.reasonCode, 'human_evidence_or_decision_required');
    assert.equal(report.outcomes[0]!.dispatch, 'ATTENTION_OPENED');
  });
});

// ---------------------------------------------------------------------------
// Group 2 — real coordinator on the generic programme world
// ---------------------------------------------------------------------------
function realPlanner(c: OpenCase, proposers?: Parameters<typeof createRecoveryPlanningCoordinator>[0]['proposers']) {
  return createRecoveryPlanningCoordinator({
    pool: c.pool, workspaceId: c.world.workspaceId, actorPrincipalId: c.world.actorId, uow: () => c.app.unitOfWork(), now: R1_NOW,
    ...(proposers ? { proposers } : {}),
  });
}
const worldPass = (c: OpenCase, planner: RecoveryPlanningCoordinator) => runRecoveryProgressionPass({
  pool: c.pool, workspaceId: c.world.workspaceId, actorPrincipalId: c.world.actorId, uow: () => c.app.unitOfWork(), planner, now: R1_NOW,
});
const count = async (c: OpenCase, table: string) =>
  Number((await c.pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table} WHERE workspace_id = $1`, [c.world.workspaceId])).rows[0]!.n);

describe('C4 progression — real coordinator, duplicate wakes, execution safety', () => {
  test('REPLAN plans once; duplicate and overlapping wakes never duplicate the attempt; pending authority WAITs; execution is never dispatched by progression', async () => {
    const c = await openDisruptionCase('R1 progression replan');
    try {
      const planner = realPlanner(c);
      // Two overlapping wakes race on the same basis.
      const [a, b] = await Promise.all([worldPass(c, planner), worldPass(c, planner)]);
      assert.equal(a.failed + b.failed, 0, JSON.stringify([a.outcomes, b.outcomes]));
      assert.equal(await count(c, 'recovery_planning_attempts'), 1, 'one attempt for the basis');
      const strategies = await count(c, 'recovery_strategies');
      assert.ok(strategies >= 1);
      const status = await c.pool.query<{ lifecycle_status: string }>('SELECT lifecycle_status FROM recovery_cases WHERE workspace_id = $1 AND id = $2', [c.world.workspaceId, c.caseId]);
      assert.equal(status.rows[0]!.lifecycle_status, 'AWAITING_AUTHORITY');

      // A later duplicate wake: pending authority => WAIT, no second attempt.
      const later = await worldPass(c, planner);
      assert.equal(later.outcomes[0]!.decision, 'WAIT');
      assert.equal(later.outcomes[0]!.reasonCode, 'authority_or_execution_pending');
      assert.equal(later.planned, 0);
      assert.equal(await count(c, 'recovery_planning_attempts'), 1);
      assert.equal(await count(c, 'recovery_strategies'), strategies);

      // Approval makes intents runnable; progression must still only WAIT and never execute.
      const attempt = await c.pool.query<{ recommendation: { recommendedStrategyRef: string } }>('SELECT recommendation FROM recovery_planning_attempts WHERE workspace_id = $1', [c.world.workspaceId]);
      const approved = await approveRecoveryStrategy(
        { pool: c.pool, workspaceId: c.world.workspaceId, actorPrincipalId: c.world.actorId, uow: () => c.app.unitOfWork(), now: R1_NOW, executorPrincipalId: c.executorPrincipalId },
        { caseId: c.caseId, strategyId: attempt.rows[0]!.recommendation.recommendedStrategyRef, approverPrincipalId: c.operatorPrincipalId },
      );
      assert.equal(approved.ok, true);
      const attemptsBefore = await count(c, 'execution_attempts');
      const waiting = await worldPass(c, planner);
      assert.equal(waiting.outcomes[0]!.decision, 'WAIT', JSON.stringify(waiting.outcomes));
      assert.equal(await count(c, 'execution_attempts'), attemptsBefore, 'progression never dispatches or retries execution');
      assert.equal(await count(c, 'recovery_planning_attempts'), 1);

      // The existing execution owner runs; only settled PASS + reconciled RESOLVEs.
      const exec = { ...c.lifecycleCtx, executorPrincipalId: c.executorPrincipalId };
      await runInternalExecutionPass(exec);
      const midway = await worldPass(c, planner);
      assert.notEqual(midway.outcomes[0]?.decision, 'RESOLVE', 'unsettled/incomplete execution does not resolve');
      await c.drain();
      await runInternalExecutionPass(exec);
      await c.drain();
      const done = await worldPass(c, planner);
      assert.equal(done.outcomes[0]!.decision, 'RESOLVE', JSON.stringify(done.outcomes));
      assert.equal(done.resolved, 1);
      const final = await c.pool.query<{ lifecycle_status: string }>('SELECT lifecycle_status FROM recovery_cases WHERE workspace_id = $1 AND id = $2', [c.world.workspaceId, c.caseId]);
      assert.equal(final.rows[0]!.lifecycle_status, 'RESOLVED');
      assert.equal((await worldPass(c, planner)).candidates, 0);
    } finally {
      await c.app.close();
    }
  });

  test('no safe recovery => durable ESCALATE; a newer basis supersedes the old attempt/attention and replans', async () => {
    const c = await openDisruptionCase('R1 progression escalate');
    try {
      const empty = realPlanner(c, []);
      const first = await worldPass(c, empty);
      assert.equal(first.outcomes[0]!.decision, 'REPLAN');
      assert.equal(first.planned, 1);
      const oldAttempt = await c.pool.query<{ basis_assessment_id: string; outcome: string }>('SELECT basis_assessment_id, outcome FROM recovery_planning_attempts WHERE workspace_id = $1', [c.world.workspaceId]);
      assert.equal(oldAttempt.rowCount, 1);
      assert.notEqual(oldAttempt.rows[0]!.outcome, 'AWAITING_AUTHORITY');

      const escalated = await worldPass(c, empty);
      assert.equal(escalated.outcomes[0]!.decision, 'ESCALATE');
      assert.equal(escalated.outcomes[0]!.dispatch, 'ATTENTION_OPENED');
      assert.equal((await worldPass(c, empty)).outcomes[0]!.decision, 'ESCALATE', 'duplicate wake decides the same thing');
      const open = await listRecoveryCaseAttention(c.pool, c.world.workspaceId, c.caseId);
      assert.equal(open.length, 1);
      assert.equal(open[0]!.basisAssessmentId, oldAttempt.rows[0]!.basis_assessment_id);
      const status = await c.pool.query<{ lifecycle_status: string }>('SELECT lifecycle_status FROM recovery_cases WHERE workspace_id = $1 AND id = $2', [c.world.workspaceId, c.caseId]);
      assert.ok(!['RESOLVED', 'CLOSED', 'CANCELLED', 'SUPERSEDED'].includes(status.rows[0]!.lifecycle_status), 'attention does not resolve the case');

      // The world changes again: a new settled basis supersedes the old one.
      await applyProviderDelay(c, '2031-06-02T12:45:00.000Z');
      await c.drain();
      const next = await worldPass(c, empty);
      assert.equal(next.outcomes[0]!.decision, 'REPLAN', JSON.stringify(next.outcomes));
      assert.notEqual(next.outcomes[0]!.basisAssessmentId, oldAttempt.rows[0]!.basis_assessment_id);
      const all = await listRecoveryCaseAttention(c.pool, c.world.workspaceId, c.caseId);
      assert.deepEqual(all.map((a) => [a.status, a.resolutionCode]), [['RESOLVED', 'basis_superseded']]);
      assert.equal(await count(c, 'recovery_planning_attempts'), 2, 'the old basis attempt is history; the new basis has its own');
    } finally {
      await c.app.close();
    }
  });

  test('an approved plan that completed without changing the basis has exhausted it: ESCALATE, never a replan of the same basis', async () => {
    const c = await openDisruptionCase('R1 progression exhausted basis');
    try {
      const planner = realPlanner(c);
      assert.equal((await worldPass(c, planner)).planned, 1);
      const attempt = await c.pool.query<{ recommendation: { recommendedStrategyRef: string } }>('SELECT recommendation FROM recovery_planning_attempts WHERE workspace_id = $1', [c.world.workspaceId]);
      const approved = await approveRecoveryStrategy(
        { pool: c.pool, workspaceId: c.world.workspaceId, actorPrincipalId: c.world.actorId, uow: () => c.app.unitOfWork(), now: R1_NOW, executorPrincipalId: c.executorPrincipalId },
        { caseId: c.caseId, strategyId: attempt.rows[0]!.recommendation.recommendedStrategyRef, approverPrincipalId: c.operatorPrincipalId },
      );
      assert.equal(approved.ok, true);
      if (!approved.ok) return;
      // Work in flight (approved, not yet executed) is the resolution gate's WAIT.
      assert.equal((await worldPass(c, planner)).outcomes[0]!.decision, 'WAIT');

      // Simulate observed provider success for every intent that left canonical state
      // (and therefore the assessed basis) untouched.
      for (const [i, intent] of approved.report.intents.entries()) {
        await c.pool.query(
          `INSERT INTO execution_attempts (workspace_id, id, action_intent_id, attempt_number, logical_operation_key, request_fingerprint, status, created_by_actor_id)
           SELECT ai.workspace_id, $3, ai.id, 1, ai.logical_operation_key, ai.request_fingerprint, 'OBSERVED_SUCCESS', $4
             FROM action_intents ai WHERE ai.workspace_id = $1 AND ai.id = $2`,
          [c.world.workspaceId, intent.intentId, randomUUID(), `r1-progression-test-${i}`],
        );
      }
      const escalated = await worldPass(c, planner);
      assert.equal(escalated.outcomes[0]!.decision, 'ESCALATE', JSON.stringify(escalated.outcomes));
      assert.equal(escalated.outcomes[0]!.reasonCode, 'no_safe_recovery_remaining');
      assert.equal(escalated.planned, 0);
      assert.equal((await worldPass(c, planner)).planned, 0);
      const attention = await listRecoveryCaseAttention(c.pool, c.world.workspaceId, c.caseId);
      assert.deepEqual(attention.map((a) => [a.reasonCode, a.status]), [['no_safe_recovery_remaining', 'OPEN']]);
      assert.equal(await count(c, 'recovery_planning_attempts'), 1);
    } finally {
      await c.app.close();
    }
  });

  test('a basis that goes stale mid-planning cannot advance the case; the next wake plans the new basis', async () => {
    const c = await openDisruptionCase('R1 progression stale');
    try {
      const real = defaultDomainProposers()[0]!.proposer as StrategyProposer;
      let raced = false;
      const racing: StrategyProposer = {
        id: real.id, version: real.version,
        async propose(input) {
          const candidates = await real.propose(input);
          if (!raced) {
            raced = true;
            // Canonical change + reassessment lands AFTER the basis was captured.
            await applyProviderDelay(c, '2031-06-02T12:45:00.000Z');
            await c.drain();
          }
          return candidates;
        },
      };
      const staleRun = await worldPass(c, realPlanner(c, [{ domain: 'PROGRAMME', proposer: racing }]));
      assert.equal(staleRun.failed, 1, JSON.stringify(staleRun.outcomes));
      assert.match(staleRun.outcomes[0]!.detail ?? '', /no longer current|pending reassessment/);
      assert.equal(await count(c, 'recovery_planning_attempts'), 0, 'nothing was promoted on the stale basis');
      assert.equal(await count(c, 'recovery_strategies'), 0);

      const recovered = await worldPass(c, realPlanner(c));
      assert.equal(recovered.failed, 0, JSON.stringify(recovered.outcomes));
      assert.equal(recovered.planned, 1);
      assert.equal(await count(c, 'recovery_planning_attempts'), 1);
    } finally {
      await c.app.close();
    }
  });
});

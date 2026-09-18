/** Isolated PostgreSQL-backed LangGraph spike: no normal runtime imports. */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Command, isInterrupted } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import type { RecoveryPlanningResult } from '../src/contracts/v2/planning/recoveryPlanningAttempt.ts';
import {
  LANGGRAPH_SPIKE_WORKFLOW_V1,
  createOuterWorkflowGraph,
  outerWorkflowThreadId,
  type OuterWorkflowServices,
} from '../src/spikes/langgraph/outerWorkflow.ts';

const CONNECTION = 'postgresql://northstar_test:northstar_test@localhost:55432/northstar_test';
const SCHEMA = 'langgraph_spike';
const openSavers: PostgresSaver[] = [];

after(async () => {
  await Promise.all(openSavers.map((saver) => saver.end()));
});

function saver(): PostgresSaver {
  const value = PostgresSaver.fromConnString(CONNECTION, { schema: SCHEMA });
  openSavers.push(value);
  return value;
}

function awaitingAuthority(caseId: string, basisAssessmentId: string): RecoveryPlanningResult {
  const strategyId = randomUUID();
  return {
    planningAttemptRef: randomUUID(),
    basisAssessmentId,
    viableStrategyRefs: [strategyId],
    recommendation: {
      recommendedStrategyRef: strategyId,
      alternativeStrategyRefs: [],
      recommendationBasis: [],
      tradeoffs: [],
      uncertainty: [],
      evidenceRefs: [],
      provenance: { kind: 'DETERMINISTIC', comparatorVersion: 'spike-test/1' },
    },
    outcome: 'AWAITING_AUTHORITY',
  } as RecoveryPlanningResult;
}

function services(params: { caseId: string; basis: string; stale?: boolean; calls: { plan: number; execute: number; reconcile: number } }): OuterWorkflowServices {
  return {
    planning: {
      async planCase({ recoveryCaseId }) {
        assert.equal(recoveryCaseId, params.caseId);
        params.calls.plan++;
        return awaitingAuthority(params.caseId, params.basis);
      },
    },
    async authorizeCurrentRecommendation() {
      return params.stale
        ? { kind: 'REPLAN', basisAssessmentId: params.basis, reason: 'recommendation_stale' }
        : { kind: 'WAIT', reason: 'approval_not_recorded' };
    },
    async requestExecution() {
      params.calls.execute++;
      return { kind: 'WAIT', reason: 'not_used_by_s1' };
    },
    async reconcile() {
      params.calls.reconcile++;
      return { kind: 'WAIT', reason: 'not_used_by_s1' };
    },
    async reassess() { return { basisAssessmentId: params.basis }; },
    async loadProgressionFacts() {
      return {
        recoveryCaseId: params.caseId,
        basisAssessmentId: params.basis,
        gate: { allowed: false, reason: 'ACTION_INTENT_NOT_COMPLETE', detail: 'test wait' },
        authorityOrExecutionPending: true,
        recoveryRemainsPossible: true,
      };
    },
    async resolveCase() { assert.fail('S1 must not resolve'); },
    async escalate() { assert.fail('S1 must not escalate'); },
  };
}

test('S1: Postgres checkpoint survives a new graph/checkpointer process and stores only workflow references', async () => {
  const caseId = randomUUID();
  const basis = randomUUID();
  const calls = { plan: 0, execute: 0, reconcile: 0 };
  const firstSaver = saver();
  await firstSaver.setup();
  const config = { configurable: { thread_id: outerWorkflowThreadId(caseId) }, durability: 'sync' as const };
  const first = createOuterWorkflowGraph(services({ caseId, basis, calls }), firstSaver);

  const interrupted = await first.invoke({ recoveryCaseId: caseId, workflowVersion: LANGGRAPH_SPIKE_WORKFLOW_V1 }, config);
  assert.ok(isInterrupted(interrupted), 'approval wait is a persisted interrupt');
  assert.equal(calls.plan, 1);
  const tuple = await firstSaver.getTuple(config);
  assert.ok(tuple, 'checkpoint exists after process-one interrupt');
  const values = tuple!.checkpoint.channel_values as Record<string, unknown>;
  assert.equal(values.recoveryCaseId, caseId);
  assert.equal(values.basisAssessmentId, basis);
  assert.equal(values.workflowVersion, LANGGRAPH_SPIKE_WORKFLOW_V1);
  for (const key of Object.keys(values)) {
    assert.match(key, /^(basisAssessmentId|planningAttemptRef|recommendedStrategyRef|recoveryCaseId|route|workflowVersion|branch:to:WAIT_FOR_APPROVAL)$/,
      `only graph reference/cursor channels are checkpointed; unexpected ${key}`);
  }

  // A new saver/graph models a new process with no in-memory graph state.
  const secondSaver = saver();
  const second = createOuterWorkflowGraph(services({ caseId, basis, calls }), secondSaver);
  const resumed = await second.invoke(new Command({ resume: { operatorEvent: 'approval_recorded' } }), config);
  assert.ok(!isInterrupted(resumed), 'new process resumed the persisted thread');
  assert.equal(calls.execute, 0, 'resume input is not business authority and did not execute');
});

test('S2: stale approval resumes to current planning and cannot invoke execution', async () => {
  const caseId = randomUUID();
  const basisA = randomUUID();
  const basisB = randomUUID();
  const calls = { plan: 0, execute: 0, reconcile: 0 };
  const firstSaver = saver();
  await firstSaver.setup();
  const config = { configurable: { thread_id: outerWorkflowThreadId(caseId) }, durability: 'sync' as const };
  const first = createOuterWorkflowGraph(services({ caseId, basis: basisA, calls }), firstSaver);
  assert.ok(isInterrupted(await first.invoke({ recoveryCaseId: caseId, workflowVersion: LANGGRAPH_SPIKE_WORKFLOW_V1 }, config)));

  // The authoritative service sees a provider/canonical change and refuses the
  // old approved basis. The graph resume payload carries no authority.
  const second = createOuterWorkflowGraph(services({ caseId, basis: basisB, stale: true, calls }), saver());
  const result = await second.invoke(new Command({ resume: { approved: true } }), config);
  assert.ok(isInterrupted(result), 'stale approval routed to a new planning/approval wait');
  assert.equal(calls.plan, 2, 'fresh planning ran after currentness rejection');
  assert.equal(calls.execute, 0, 'stale approval never reached the execution seam');
});

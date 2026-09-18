/**
 * Bounded LangGraph spike only. This is deliberately not composed by the
 * NORTHSTAR runtime. It tests whether a disposable graph cursor can call the
 * existing owners without taking ownership of business state or side effects.
 */
import { Annotation, Command, END, interrupt, START, StateGraph } from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import type { RecoveryPlanningResult } from '../../contracts/v2/planning/recoveryPlanningAttempt.ts';
import type { RecoveryProgressionResult } from '../../contracts/v2/planning/recoveryProgression.ts';
import { decideProgressionFromFacts, type ObservedProgressionFacts } from '../../resolution/planning/progressionFacts.ts';

export const LANGGRAPH_SPIKE_WORKFLOW_V1 = 'northstar-outer-workflow-spike/v1';

export type OuterWorkflowRoute =
  | 'PLAN'
  | 'WAIT_FOR_APPROVAL'
  | 'REQUEST_EXECUTION'
  | 'WAIT_OR_RECONCILE'
  | 'REASSESS'
  | 'PROGRESS'
  | 'RESOLVE'
  | 'ESCALATE'
  | 'END';

/** Only workflow refs/cursor data may cross LangGraph checkpoints. */
export const OuterWorkflowState = Annotation.Root({
  recoveryCaseId: Annotation<string>,
  basisAssessmentId: Annotation<string>,
  planningAttemptRef: Annotation<string>,
  recommendedStrategyRef: Annotation<string>,
  actionPlanRef: Annotation<string>,
  waitReason: Annotation<string>,
  workflowVersion: Annotation<string>,
  route: Annotation<OuterWorkflowRoute>,
});

export type OuterWorkflowStateValue = typeof OuterWorkflowState.State;

export interface PlanningService {
  planCase(input: { recoveryCaseId: string; reason: string }): Promise<RecoveryPlanningResult>;
}

/**
 * The adapter boundary intentionally mirrors NORTHSTAR application owners.
 * Implementations must reload PostgreSQL truth for every method. The graph has
 * no provider dispatcher and cannot issue an external mutation itself.
 */
export interface OuterWorkflowServices {
  planning: PlanningService;
  /** Read current recommendation/currentness/approval records, not resume input. */
  authorizeCurrentRecommendation(input: { recoveryCaseId: string; recommendedStrategyRef?: string }): Promise<
    | { kind: 'EXECUTE'; actionPlanRef: string }
    | { kind: 'REPLAN'; basisAssessmentId: string; reason: string }
    | { kind: 'WAIT'; reason: string }
    | { kind: 'ESCALATE'; reason: string }
  >;
  /** Calls NORTHSTAR's stored execution gate/worker seam. Never provider code directly. */
  requestExecution(input: { recoveryCaseId: string; actionPlanRef?: string }): Promise<
    | { kind: 'REASSESS' }
    | { kind: 'RECONCILE'; reason: string }
    | { kind: 'WAIT'; reason: string }
  >;
  /** Calls NORTHSTAR reconciliation only; it must never retry a provider mutation. */
  reconcile(input: { recoveryCaseId: string }): Promise<
    | { kind: 'REASSESS' }
    | { kind: 'WAIT'; reason: string }
  >;
  reassess(input: { recoveryCaseId: string }): Promise<{ basisAssessmentId: string }>;
  /** Reload observed resolution/authority/execution facts from NORTHSTAR. */
  loadProgressionFacts(input: { recoveryCaseId: string; basisAssessmentId?: string }): Promise<ObservedProgressionFacts>;
  resolveCase(input: { recoveryCaseId: string }): Promise<void>;
  /** Records/presents an existing truthful escalation result; no invented lifecycle state. */
  escalate(input: { recoveryCaseId: string; reason: string }): Promise<void>;
}

export function outerWorkflowThreadId(recoveryCaseId: string): string {
  return `northstar-recovery-case:${recoveryCaseId}`;
}

function routeForPlanning(result: RecoveryPlanningResult): OuterWorkflowRoute {
  return result.outcome === 'AWAITING_AUTHORITY' ? 'WAIT_FOR_APPROVAL' : 'ESCALATE';
}

function asUpdate(value: Record<string, unknown>, route: OuterWorkflowRoute): Command {
  return new Command({ update: { ...value, route }, goto: route === 'END' ? END : route });
}

/**
 * Build a graph with a supplied checkpointer. All state is reference-only;
 * each node delegates to a service that reloads authoritative PostgreSQL.
 * Execution/reconciliation intentionally have no LangGraph retry policy.
 */
export function createOuterWorkflowGraph(services: OuterWorkflowServices, checkpointer: BaseCheckpointSaver) {
  const loadOrReassess = async (state: OuterWorkflowStateValue) => {
    const reassessed = await services.reassess({ recoveryCaseId: state.recoveryCaseId });
    return asUpdate({ basisAssessmentId: reassessed.basisAssessmentId, workflowVersion: LANGGRAPH_SPIKE_WORKFLOW_V1 }, 'PLAN');
  };

  const plan = async (state: OuterWorkflowStateValue) => {
    const result = await services.planning.planCase({ recoveryCaseId: state.recoveryCaseId, reason: 'REASSESSMENT' });
    const recommendedStrategyRef = result.recommendation?.recommendedStrategyRef;
    return asUpdate({
      basisAssessmentId: result.basisAssessmentId,
      planningAttemptRef: result.planningAttemptRef,
      ...(recommendedStrategyRef ? { recommendedStrategyRef } : {}),
    }, routeForPlanning(result));
  };

  const waitForApproval = async (state: OuterWorkflowStateValue) => {
    // This MUST remain first: LangGraph restarts interrupted nodes from top.
    interrupt({ recoveryCaseId: state.recoveryCaseId, recommendedStrategyRef: state.recommendedStrategyRef, reason: 'approval_required' });
    const current = await services.authorizeCurrentRecommendation({
      recoveryCaseId: state.recoveryCaseId,
      recommendedStrategyRef: state.recommendedStrategyRef,
    });
    if (current.kind === 'EXECUTE') return asUpdate({ actionPlanRef: current.actionPlanRef, waitReason: undefined }, 'REQUEST_EXECUTION');
    if (current.kind === 'REPLAN') return asUpdate({ basisAssessmentId: current.basisAssessmentId, waitReason: current.reason }, 'PLAN');
    return asUpdate({ waitReason: current.reason }, current.kind === 'WAIT' ? 'END' : 'ESCALATE');
  };

  const requestExecution = async (state: OuterWorkflowStateValue) => {
    const outcome = await services.requestExecution({ recoveryCaseId: state.recoveryCaseId, actionPlanRef: state.actionPlanRef });
    if (outcome.kind === 'REASSESS') return asUpdate({}, 'REASSESS');
    return asUpdate({ waitReason: outcome.reason }, outcome.kind === 'RECONCILE' ? 'WAIT_OR_RECONCILE' : 'END');
  };

  const waitOrReconcile = async (state: OuterWorkflowStateValue) => {
    const outcome = await services.reconcile({ recoveryCaseId: state.recoveryCaseId });
    return outcome.kind === 'REASSESS' ? asUpdate({}, 'REASSESS') : asUpdate({ waitReason: outcome.reason }, 'END');
  };

  const reassess = async (state: OuterWorkflowStateValue) => {
    const result = await services.reassess({ recoveryCaseId: state.recoveryCaseId });
    return asUpdate({ basisAssessmentId: result.basisAssessmentId }, 'PROGRESS');
  };

  const progress = async (state: OuterWorkflowStateValue) => {
    const facts = await services.loadProgressionFacts({ recoveryCaseId: state.recoveryCaseId, basisAssessmentId: state.basisAssessmentId });
    const decision: RecoveryProgressionResult = decideProgressionFromFacts(facts);
    if (decision.decision === 'RESOLVE') return asUpdate({}, 'RESOLVE');
    if (decision.decision === 'REPLAN') return asUpdate({ basisAssessmentId: decision.basisAssessmentId, waitReason: decision.reasonCode }, 'PLAN');
    return asUpdate({ waitReason: decision.reasonCode }, decision.decision === 'WAIT' ? 'END' : 'ESCALATE');
  };

  const resolve = async (state: OuterWorkflowStateValue) => {
    await services.resolveCase({ recoveryCaseId: state.recoveryCaseId });
    return asUpdate({}, 'END');
  };
  const escalate = async (state: OuterWorkflowStateValue) => {
    await services.escalate({ recoveryCaseId: state.recoveryCaseId, reason: state.waitReason ?? 'human_evidence_or_decision_required' });
    return asUpdate({}, 'END');
  };

  return new StateGraph(OuterWorkflowState)
    .addNode('LOAD_OR_REASSESS', loadOrReassess, { ends: ['PLAN'] })
    .addNode('PLAN', plan, { ends: ['WAIT_FOR_APPROVAL', 'ESCALATE'] })
    .addNode('WAIT_FOR_APPROVAL', waitForApproval, { ends: ['REQUEST_EXECUTION', 'PLAN', 'ESCALATE', END] })
    .addNode('REQUEST_EXECUTION', requestExecution, { ends: ['REASSESS', 'WAIT_OR_RECONCILE', END] })
    .addNode('WAIT_OR_RECONCILE', waitOrReconcile, { ends: ['REASSESS', END] })
    .addNode('REASSESS', reassess, { ends: ['PROGRESS'] })
    .addNode('PROGRESS', progress, { ends: ['RESOLVE', 'PLAN', 'ESCALATE', END] })
    .addNode('RESOLVE', resolve, { ends: [END] })
    .addNode('ESCALATE', escalate, { ends: [END] })
    .addEdge(START, 'LOAD_OR_REASSESS')
    .compile({ checkpointer });
}

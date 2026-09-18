import {
  RecoveryCaseViewSchema,
  type RecoveryCaseView,
} from '../../../contracts/v2/product/readModels.ts';
import { buildChangeAwareness } from './changeAwareness.ts';
import { projectLiveDependencyGraph } from './liveDependencyGraph.ts';
import { projectFocusedGraph } from './projectFocusedGraph.ts';
import { projectPlanningEvidence } from './projectPlanningEvidence.ts';
import { projectCaseAttention } from './projectCaseAttention.ts';
import {
  deriveDuplicateBookingExposure,
  derivePartialRecovery,
  deriveRemainingRecoveryWork,
  projectRecoveryAction,
  sumAggregateRecoveryCost,
} from './recoveryActionProjection.ts';
import type { RecoveryCaseFacts } from './types.ts';

export function projectRecoveryCase(input: RecoveryCaseFacts): RecoveryCaseView {
  const ldg = projectLiveDependencyGraph({
    ...input,
    scope: 'FOCUSED_CASE',
  });
  const actions = input.recoveryActions ?? [];
  const recoveryActions = actions.map(projectRecoveryAction);
  const partialRecovery = input.partialRecovery ?? (actions.length > 0 ? derivePartialRecovery(actions) : undefined);
  const duplicateBookingExposure = input.duplicateBookingExposure
    ?? (actions.length > 0 ? deriveDuplicateBookingExposure(actions) : []);
  const remainingRecoveryWork = input.remainingRecoveryWork
    ?? (actions.length > 0 ? deriveRemainingRecoveryWork(actions) : []);
  const aggregateRecoveryCost = input.aggregateRecoveryCost ?? sumAggregateRecoveryCost(actions);

  const uncertainty = [...(input.uncertainty ?? [])];
  for (const exposure of duplicateBookingExposure) {
    const note = exposure.detail ?? 'duplicate booking/cost exposure';
    if (!uncertainty.includes(note)) uncertainty.push(note);
  }

  // C9: decision-time planning evidence, derived purely from the frozen attempt
  // record when one exists. Structurally separate from the current-state fields
  // above (its `phase`/`asOf` mark it as planning-time, freeze §12 line 529).
  const planningEvidence = input.planningAttempt
    ? projectPlanningEvidence(input.planningAttempt.attempt, input.planningAttempt.outcome, input.subjectHumanLabels)
    : undefined;

  // R2: backend-supplied mapping of the ordered causalPath onto the visible focused
  // graph, so the frontend never traverses topology for causality (FIG-5b). Pure
  // function of the produced `ldg` + `causalPath`; undefined when there is no path.
  const causalPath = (input.causalPath ?? []).map((step) => ({ ...step, facts: { ...step.facts }, relatedSubjectRefs: [...step.relatedSubjectRefs] }));
  const focusedGraph = projectFocusedGraph(ldg, causalPath);

  return RecoveryCaseViewSchema.parse({
    generatedAt: input.generatedAt,
    caseRef: input.caseRef,
    ...(input.cause ? { cause: { ...input.cause } } : {}),
    causalPath,
    ...(focusedGraph ? { focusedGraph } : {}),
    status: input.status,
    changeSummary: input.changeSummary,
    bookingServiceState: { ...input.bookingServiceState },
    tripViability: { ...input.tripViability },
    affectedItems: [...(input.affectedItems ?? [])],
    ...(input.criticalCommitment ? { criticalCommitment: input.criticalCommitment } : {}),
    ...(input.causalFailureReason ? { causalFailureReason: input.causalFailureReason } : {}),
    ...(input.requirementVsActual ? { requirementVsActual: { ...input.requirementVsActual } } : {}),
    strategies: (input.strategies ?? []).map((strategy) => ({
      strategyRef: strategy.strategyRef,
      version: strategy.version,
      viability: strategy.viability,
      status: strategy.status,
      optionNumber: strategy.optionNumber,
      changes: strategy.changes.map((change) => ({ ...change })),
      resolves: strategy.resolves.map((subject) => ({ ...subject })),
      projectedSummary: { ...strategy.projectedSummary },
      projectedPeople: strategy.projectedPeople.map((person) => ({ ...person })),
    })),
    authorityState: input.authorityState,
    executionState: input.executionState,
    reconciliationState: input.reconciliationState,
    uncertainty,
    ...(input.resolutionSummary ? { resolutionSummary: input.resolutionSummary } : {}),
    ...(input.connectionProgression ? { connectionProgression: input.connectionProgression } : {}),
    recoveryActions,
    ...(aggregateRecoveryCost ? { aggregateRecoveryCost } : {}),
    remainingRecoveryWork: [...remainingRecoveryWork],
    ...(partialRecovery ? { partialRecovery } : {}),
    duplicateBookingExposure: duplicateBookingExposure.map((e) => ({ ...e })),
    ...(planningEvidence ? { planningEvidence } : {}),
    attention: (input.attention ?? []).map(projectCaseAttention),
    ldg,
    change: buildChangeAwareness(input),
  });
}

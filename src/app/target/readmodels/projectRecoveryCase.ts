import {
  RecoveryCaseViewSchema,
  type RecoveryCaseView,
} from '../../../contracts/v2/product/readModels.ts';
import { buildChangeAwareness } from './changeAwareness.ts';
import { projectLiveDependencyGraph } from './liveDependencyGraph.ts';
import type { RecoveryCaseFacts } from './types.ts';

export function projectRecoveryCase(input: RecoveryCaseFacts): RecoveryCaseView {
  const ldg = projectLiveDependencyGraph({
    ...input,
    scope: 'FOCUSED_CASE',
  });
  return RecoveryCaseViewSchema.parse({
    generatedAt: input.generatedAt,
    caseRef: input.caseRef,
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
      projectedPeople: strategy.projectedPeople.map((person) => ({ ...person })),
    })),
    authorityState: input.authorityState,
    executionState: input.executionState,
    reconciliationState: input.reconciliationState,
    uncertainty: [...(input.uncertainty ?? [])],
    ...(input.resolutionSummary ? { resolutionSummary: input.resolutionSummary } : {}),
    ldg,
    change: buildChangeAwareness(input),
  });
}

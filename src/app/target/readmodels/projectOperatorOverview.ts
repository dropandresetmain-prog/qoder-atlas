import {
  OperatorOverviewSchema,
  type OperatorOverview,
} from '../../../contracts/v2/product/readModels.ts';
import { buildChangeAwareness } from './changeAwareness.ts';
import { buildEventOverview } from './eventOverview.ts';
import { projectLiveDependencyGraph } from './liveDependencyGraph.ts';
import type { OperatorOverviewFacts } from './types.ts';

export function projectOperatorOverview(input: OperatorOverviewFacts): OperatorOverview {
  const items = input.items.map((item) => ({
    tripRef: item.tripRef,
    travellerLabel: item.travellerLabel,
    status: item.status,
    remainderViability: item.remainderViability,
    ...(item.incidentRef ? { incidentRef: item.incidentRef } : {}),
    ...(item.caseRef ? { caseRef: item.caseRef } : {}),
    ...(item.whatChanged ? { whatChanged: item.whatChanged } : {}),
    affectedPeople: [...(item.affectedPeople ?? [])],
    affectedItems: [...(item.affectedItems ?? [])],
    ...(item.recoveryActivity ? { recoveryActivity: item.recoveryActivity } : {}),
    decisionRequired: item.decisionRequired ?? false,
    unresolvedUncertainty: [...(item.unresolvedUncertainty ?? [])],
  }));
  const summary = {
    ready: items.filter((item) => item.status === 'READY').length,
    atRisk: items.filter((item) => item.status === 'AT_RISK').length,
    disrupted: items.filter((item) => item.status === 'DISRUPTED').length,
    recovering: items.filter((item) => item.status === 'RECOVERING').length,
    unknown: items.filter((item) => item.status === 'UNKNOWN').length,
  };
  // The population is carried through, not recomputed: every status here is
  // an authoritative backend verdict. `populationSummary` counts that
  // collection, deliberately separate from `summary`, which stays a count of
  // the case-driven queue.
  const population = (input.population ?? []).map((entry) => ({
    journeyRef: entry.journeyRef,
    tripRef: entry.tripRef,
    travellerLabel: entry.travellerLabel,
    obligation: entry.obligation,
    status: entry.status,
    remainderViability: entry.remainderViability,
    evaluation: entry.evaluation,
    ...(entry.caseRef ? { caseRef: entry.caseRef } : {}),
  }));
  const populationSummary = {
    total: population.length,
    ready: population.filter((entry) => entry.status === 'READY').length,
    atRisk: population.filter((entry) => entry.status === 'AT_RISK').length,
    disrupted: population.filter((entry) => entry.status === 'DISRUPTED').length,
    recovering: population.filter((entry) => entry.status === 'RECOVERING').length,
    unknown: population.filter((entry) => entry.status === 'UNKNOWN').length,
    notAssessed: population.filter((entry) => entry.evaluation === 'NONE').length,
  };
  // Aggregate FIG-7 lifecycle only — count subjects already carrying
  // PENDING_REASSESSMENT from currentAssessmentView. Never infer completeness
  // from readiness counts or timers.
  const pendingCount = population.filter((entry) => entry.evaluation === 'PENDING_REASSESSMENT').length;
  const populationAssessmentLifecycle = {
    state: pendingCount > 0 ? ('RECONCILING' as const) : ('SETTLED' as const),
    pendingCount,
  };
  const ldg = projectLiveDependencyGraph({
    ...input,
    scope: 'DASHBOARD',
  });
  return OperatorOverviewSchema.parse({
    generatedAt: input.generatedAt,
    items,
    summary,
    population,
    populationSummary,
    populationAssessmentLifecycle,
    ...(input.eventContext ? { eventContext: input.eventContext } : {}),
    ...(input.eventOverviewSource
      ? { eventOverview: buildEventOverview({ source: input.eventOverviewSource, population: input.population ?? [], items: input.items }) }
      : {}),
    ldg,
    change: buildChangeAwareness(input),
    ...(input.demoIngress ? { demoIngress: input.demoIngress } : {}),
  });
}

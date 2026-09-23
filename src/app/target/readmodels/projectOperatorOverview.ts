import {
  OperatorOverviewSchema,
  type OperatorOverview,
} from '../../../contracts/v2/product/readModels.ts';
import { buildChangeAwareness } from './changeAwareness.ts';
import { buildEventOverview } from './eventOverview.ts';
import { projectLiveDependencyGraph } from './liveDependencyGraph.ts';
import type { OperatorItemFact, OperatorOverviewFacts } from './types.ts';

/**
 * Open-attention queue is for active cases only. Terminal RecoveryCase
 * lifecycles remain inspectable via Case history / population case links —
 * they must not inflate "Needs attention — N open stories".
 */
const TERMINAL_CASE_LIFECYCLES = new Set([
  'RESOLVED',
  'CLOSED',
  'CANCELLED',
  'SUPERSEDED',
]);

export function isOpenAttentionCaseLifecycle(lifecycleStatus: string | undefined): boolean {
  if (lifecycleStatus === undefined) return true;
  return !TERMINAL_CASE_LIFECYCLES.has(lifecycleStatus);
}

export function openAttentionItems(items: readonly OperatorItemFact[]): OperatorItemFact[] {
  return items.filter((item) => isOpenAttentionCaseLifecycle(item.caseLifecycleStatus));
}

export function projectOperatorOverview(input: OperatorOverviewFacts): OperatorOverview {
  const items = openAttentionItems(input.items).map((item) => ({
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
  // `summary` counts only the case-driven queue (`items`). `populationSummary`
  // counts the full traveller population. They diverge by design — e.g.
  // summary.ready === 0 while populationSummary.ready > 0 when no queue row
  // is READY but assessed travellers are.
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
      ? { eventOverview: buildEventOverview({ source: input.eventOverviewSource, population: input.population ?? [], items: openAttentionItems(input.items) }) }
      : {}),
    ldg,
    change: buildChangeAwareness(input),
    ...(input.demoIngress ? { demoIngress: input.demoIngress } : {}),
  });
}

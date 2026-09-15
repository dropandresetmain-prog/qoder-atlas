import {
  OperatorOverviewSchema,
  type OperatorOverview,
} from '../../../contracts/v2/product/readModels.ts';
import { buildChangeAwareness } from './changeAwareness.ts';
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
  const ldg = projectLiveDependencyGraph({
    ...input,
    scope: 'DASHBOARD',
  });
  return OperatorOverviewSchema.parse({
    generatedAt: input.generatedAt,
    items,
    summary,
    ldg,
    change: buildChangeAwareness(input),
  });
}

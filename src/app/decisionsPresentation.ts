/**
 * Decisions page projection (R3A).
 */
import type { EntityId, IsoDateTime } from '../domain/common.ts';
import type { DecidedDecisionRowView, DecisionsPageView, PendingDecisionRowView } from '../ui/operator-surfaces-view-model.ts';
import { formatRosterTime } from '../ui/html.ts';
import {
  decidedByLabel,
  formatDecisionCost,
  fundingSummaryForIntent,
  waitingOnLabel,
} from './casePresentation.ts';
import { projectApprovalsQueue } from './waveReadmodels.ts';
import { latestCaseFor, type ReadModelDependencies } from './readmodels.ts';
import { presentAction } from './presentation.ts';

export async function projectDecisionsPage(
  deps: ReadModelDependencies,
  generatedAt: IsoDateTime,
  options?: { anchorEventId?: EntityId },
): Promise<DecisionsPageView> {
  const queue = await projectApprovalsQueue(deps, generatedAt);
  const pending: PendingDecisionRowView[] = [];

  for (const item of queue.pending) {
    const trip = await deps.snapshot.trips.getTrip(item.tripId);
    if (!trip) continue;
    if (options?.anchorEventId && trip.anchorEventId !== options.anchorEventId) continue;
    const waitingOn = await waitingOnLabel(deps, trip, item.requestedFrom);
    pending.push({
      caseId: item.caseId,
      travellerName: item.travellerNames.join(', ') || 'Traveller',
      decision: `${item.action} requires a decision`,
      ...(item.amount ? { cost: formatDecisionCost(item.amount, item.funding?.summary) } : {}),
      ...(waitingOn ? { waitingOn } : {}),
      age: formatRosterTime(item.requestedAt, generatedAt),
    });
  }

  const decided: DecidedDecisionRowView[] = [];
  for (const summary of await deps.snapshot.trips.listTrips()) {
    const recoveryCase = await latestCaseFor(deps.cases, summary.tripId);
    if (!recoveryCase) continue;
    const trip = await deps.snapshot.trips.getTrip(summary.tripId);
    if (!trip) continue;
    if (options?.anchorEventId && trip.anchorEventId !== options.anchorEventId) continue;
    const travellerEntry = trip.travellerIds[0]
      ? await deps.snapshot.entities.get('TRAVELLER', trip.travellerIds[0])
      : undefined;
    const travellerName =
      travellerEntry?.entityType === 'TRAVELLER' ? travellerEntry.entity.name : trip.label ?? 'Traveller';

    for (const decision of recoveryCase.authorityDecisions) {
      if (!decision.approval) continue;
      const intent = recoveryCase.actionIntents.find((candidate) => candidate.id === decision.intentId);
      const decidedBy = await decidedByLabel(deps, decision);
      decided.push({
        caseId: recoveryCase.id,
        travellerName,
        decision: intent ? `${presentAction(intent.operation)} — ${decision.approval.decision.toLowerCase()}` : decision.approval.decision,
        ...(intent?.providerSpend
          ? {
              cost: formatDecisionCost(
                intent.providerSpend,
                fundingSummaryForIntent(intent.costAllocation),
              ),
            }
          : intent?.priceDelta
            ? {
                cost: formatDecisionCost(
                  intent.priceDelta,
                  fundingSummaryForIntent(intent.costAllocation),
                ),
              }
            : {}),
        ...(decidedBy ? { decidedBy } : {}),
        when: formatRosterTime(decision.approval.decidedAt, generatedAt),
      });
    }
  }

  decided.sort((a, b) => (b.when ?? '').localeCompare(a.when ?? ''));
  return { generatedAt, pending, decided: decided.slice(0, 20) };
}

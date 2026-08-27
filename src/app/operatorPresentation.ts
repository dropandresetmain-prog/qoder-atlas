/**
 * Operator overview presentation augmentations (R3A).
 */
import type { OperatorDashboardView } from '../contracts/readmodels.ts';
import type { OperatorDashboardAugmentations } from '../ui/screens/operator-dashboard.ts';
import type { ReadModelDependencies } from './readmodels.ts';
import { projectJourneyChain, latestCaseFor } from './readmodels.ts';
import { projectTravellerRoleLine } from './presentationProjection.ts';

export async function projectOperatorDashboardAugmentations(
  deps: ReadModelDependencies,
  view: OperatorDashboardView,
): Promise<OperatorDashboardAugmentations> {
  const chainByTrip = new Map<string, Awaited<ReturnType<typeof projectJourneyChain>>>();
  const roleByTrip = new Map<string, string | undefined>();
  const anchorEventIds = new Set<string>();

  for (const row of view.trips) {
    const trip = await deps.snapshot.trips.getTrip(row.tripId);
    if (!trip) continue;
    const recoveryCase = await latestCaseFor(deps.cases, row.tripId);
    chainByTrip.set(row.tripId, await projectJourneyChain(deps, trip, recoveryCase));
    if (trip.anchorEventId) anchorEventIds.add(trip.anchorEventId);
    const travellerId = trip.travellerIds[0];
    if (travellerId) {
      roleByTrip.set(row.tripId, await projectTravellerRoleLine(deps, row.tripId, travellerId));
    }
  }

  const onlyEventId = anchorEventIds.size === 1 ? [...anchorEventIds][0] : undefined;
  return {
    chainFor: (trip) => chainByTrip.get(trip.tripId),
    roleFor: (trip) => roleByTrip.get(trip.tripId),
    ...(onlyEventId ? { programmeHref: `/programme?event=${encodeURIComponent(onlyEventId)}` } : {}),
  };
}

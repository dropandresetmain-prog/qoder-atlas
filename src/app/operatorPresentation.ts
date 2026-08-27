/**
 * Operator overview presentation augmentations (R3A / R3D).
 */
import type { OperatorDashboardView } from '../contracts/readmodels.ts';
import type { IsoDateTime } from '../domain/common.ts';
import type { Engagement } from '../domain/elements.ts';
import type { Trip } from '../domain/trip.ts';
import type { OperatorDashboardAugmentations } from '../ui/screens/operator-dashboard.ts';
import type { ReadModelDependencies } from './readmodels.ts';
import { projectJourneyChain, latestCaseFor } from './readmodels.ts';
import { projectTravellerRoleLine } from './presentationProjection.ts';

/** Earliest upcoming engagement start; undefined when none remain ahead of `now`. */
export function earliestUpcomingCommitmentAt(trip: Trip, now: IsoDateTime): IsoDateTime | undefined {
  const upcoming = trip.elements
    .filter((element): element is Engagement => element.elementKind === 'ENGAGEMENT')
    .map((engagement) => engagement.data.startsAt.value)
    .filter((instant) => instant.localeCompare(now) >= 0)
    .sort((a, b) => a.localeCompare(b));
  return upcoming[0];
}

export async function projectOperatorDashboardAugmentations(
  deps: ReadModelDependencies,
  view: OperatorDashboardView,
): Promise<OperatorDashboardAugmentations> {
  const chainByTrip = new Map<string, Awaited<ReturnType<typeof projectJourneyChain>>>();
  const roleByTrip = new Map<string, string | undefined>();
  const earliestByTrip = new Map<string, IsoDateTime | undefined>();
  const anchorEventIds = new Set<string>();
  const now = view.generatedAt;

  for (const row of view.trips) {
    const trip = await deps.snapshot.trips.getTrip(row.tripId);
    if (!trip) continue;
    const recoveryCase = await latestCaseFor(deps.cases, row.tripId);
    chainByTrip.set(row.tripId, await projectJourneyChain(deps, trip, recoveryCase));
    earliestByTrip.set(row.tripId, earliestUpcomingCommitmentAt(trip, now));
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
    earliestCommitmentAtFor: (trip) => earliestByTrip.get(trip.tripId),
    ...(onlyEventId ? { programmeHref: `/programme?event=${encodeURIComponent(onlyEventId)}` } : {}),
  };
}

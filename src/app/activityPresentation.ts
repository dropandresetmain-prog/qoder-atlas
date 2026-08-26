/**
 * Programme-scale activity feed projection (R3A).
 */
import type { IsoDateTime } from '../domain/common.ts';
import type { ActivityDayGroupView, ActivityPageView } from '../ui/operator-surfaces-view-model.ts';
import { activityClock, glyphForActivityAction } from '../ui/operator-surfaces-view-model.ts';
import { formatActivityDayLabel } from './presentationProjection.ts';
import { projectTripActivity } from './waveReadmodels.ts';
import type { ReadModelDependencies } from './readmodels.ts';

export async function projectProgrammeActivityPage(
  deps: ReadModelDependencies,
  generatedAt: IsoDateTime,
): Promise<ActivityPageView> {
  const summaries = await deps.snapshot.trips.listTrips();
  const byDay = new Map<string, ActivityDayGroupView['items']>();

  for (const summary of summaries) {
    const activity = await projectTripActivity(deps, summary.tripId, generatedAt, 20);
    if (!activity) continue;
    for (const event of activity.events) {
      const dayKey = event.occurredAt.slice(0, 10) || 'Undated';
      const items = byDay.get(dayKey) ?? [];
      const glyph = glyphForActivityAction(event.action);
      items.push({
        who: event.actor,
        text: event.summary,
        ...(event.subject ? { sub: event.subject } : {}),
        time: activityClock(event.occurredAt),
        ...glyph,
      });
      byDay.set(dayKey, items);
    }
  }

  const days = [...byDay.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([dayKey, items]) => ({
      label: formatActivityDayLabel(`${dayKey}T12:00:00+00:00`, generatedAt),
      items,
    }));

  return { generatedAt, days };
}

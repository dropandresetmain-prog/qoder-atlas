/**
 * ActivityFeed (v2 read model) -> ActivityPageView (legacy view-model shape).
 *
 * Pure. Actors and subjects are turned into safe labels (no principal ids, no
 * `KIND:uuid` refs, no raw command tokens). Entries keep the backend order
 * (newest first) and are grouped by the day in their own offset, never shifted.
 */
import type { ActivityFeed } from '../../../contracts/v2/product/readModels.ts';
import type {
  ActivityDayGroupView,
  ActivityFeedItemView,
  ActivityPageView,
} from '../../../ui/operator-surfaces-view-model.ts';
import { activityClock } from '../../../ui/operator-surfaces-view-model.ts';
import { activityPhrase, actorPhrase, scrubText, subjectNoun } from './surfaceLabels.ts';

export interface ActivitySurfaceItem extends ActivityFeedItemView {
  /** Recovery case this entry belongs to, when one is known. */
  caseId?: string;
}
export interface ActivitySurfaceDay extends ActivityDayGroupView {
  items: ActivitySurfaceItem[];
}
export interface ActivitySurfaceView extends ActivityPageView {
  days: ActivitySurfaceDay[];
  truncated: boolean;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Entries carry a display label, not an ISO instant, so read day/time back out of it. */
const LABEL = /^(\d{1,2}) ([A-Za-z]{3}) (\d{4}), (\d{2}:\d{2})/;

function dayHeading(day: number, monthName: string, year: number, generatedAt: string): { key: string; label: string } {
  const monthIndex = MONTHS.indexOf(monthName);
  const key = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const weekday = monthIndex >= 0 ? WEEKDAYS[new Date(Date.UTC(year, monthIndex, day)).getUTCDay()] : undefined;
  const plain = `${weekday ? `${weekday} ` : ''}${day} ${monthName}`;
  const today = generatedAt.slice(0, 10);
  const yesterdayMs = Date.parse(`${today}T00:00:00Z`) - 86_400_000;
  const yesterday = Number.isFinite(yesterdayMs) ? new Date(yesterdayMs).toISOString().slice(0, 10) : '';
  if (key === today) return { key, label: `Today · ${plain}` };
  if (key === yesterday) return { key, label: `Yesterday · ${plain}` };
  return { key, label: plain };
}

export function adaptActivityFeedToActivityPage(view: ActivityFeed): ActivitySurfaceView {
  const days: ActivitySurfaceDay[] = [];
  const byKey = new Map<string, ActivitySurfaceDay>();
  for (const entry of view.entries) {
    const match = LABEL.exec(entry.atLabel);
    const heading = match
      ? dayHeading(Number(match[1]), match[2]!, Number(match[3]), view.generatedAt)
      : { key: 'undated', label: 'Earlier' };
    const subjectPhrase = entry.subjectName
      ? `${entry.subjectName}\u2019s trip`
      : subjectNoun(entry.subjectKind);
    const phrase = activityPhrase(entry.what.trim().toUpperCase().replace(/\s+/g, '_'), subjectPhrase);
    const reason = entry.reason ? scrubText(entry.reason) : '';
    const item: ActivitySurfaceItem = {
      who: actorPhrase(entry.actorKind),
      text: phrase.text,
      ...(reason ? { sub: reason } : {}),
      time: match ? match[4]! : activityClock(view.generatedAt),
      glyph: phrase.glyph,
      tone: phrase.tone,
      ...(entry.caseRef ? { caseId: entry.caseRef } : {}),
    };
    let group = byKey.get(heading.key);
    if (!group) {
      group = { label: heading.label, items: [] };
      byKey.set(heading.key, group);
      days.push(group);
    }
    group.items.push(item);
  }
  return { generatedAt: view.generatedAt, days, truncated: view.truncated };
}

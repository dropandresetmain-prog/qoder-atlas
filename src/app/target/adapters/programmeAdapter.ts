/**
 * ProgrammeSchedule (v2 read model) -> the legacy programme timeline shapes
 * (`ProgrammeTimelineDayView` / `ProgrammeTimelineItemView`).
 *
 * Pure. Days and clock times are read from each item's own ISO offset, so the
 * event's time zone is never shifted to the server's. The v2 schedule carries
 * sessions and accepted participation counts, not a traveller roster or
 * per-traveller status, so this adapter does not fabricate a roster: the
 * legacy roster/summary tiles are intentionally not produced here.
 */
import type { ProgrammeSchedule } from '../../../contracts/v2/product/readModels.ts';
import type {
  ProgrammeTimelineDayView,
  ProgrammeTimelineItemView,
} from '../../../ui/screens/operator-programme.ts';
import { scrubText } from './surfaceLabels.ts';

export interface ProgrammeSurfaceItem extends ProgrammeTimelineItemView {
  /** Open case touching someone committed to this session, when the backend knows one. */
  caseId?: string;
  caseCount: number;
  endLabel?: string;
  required: number;
  optional: number;
  inPerson: boolean;
}

export interface ProgrammeSurfaceDay extends ProgrammeTimelineDayView {
  items: readonly ProgrammeSurfaceItem[];
}

export interface ProgrammeSurfaceView {
  generatedAt: string;
  eventName: string;
  days: ProgrammeSurfaceDay[];
  sessionCount: number;
  dayCount: number;
  /** Sessions with an open recovery case among their attendees. */
  affected: ProgrammeSurfaceItem[];
  populationSummary?: NonNullable<ProgrammeSchedule['populationSummary']>;
  travellers: NonNullable<ProgrammeSchedule['travellers']>;
  endangeredCommitments: NonNullable<ProgrammeSchedule['endangeredCommitments']>;
  missingInformation: NonNullable<ProgrammeSchedule['missingInformation']>;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

function parts(iso: string): { dayKey: string; dayLabel: string; time: string } | undefined {
  const match = ISO.exec(iso);
  if (!match) return undefined;
  const [, y, m, d, hh, mm] = match;
  const weekday = WEEKDAYS[new Date(Date.UTC(Number(y), Number(m) - 1, Number(d))).getUTCDay()];
  return {
    dayKey: `${y}-${m}-${d}`,
    dayLabel: `${weekday} ${Number(d)} ${MONTHS[Number(m) - 1]}`,
    time: `${hh}:${mm}`,
  };
}

export function adaptProgrammeScheduleToTimeline(view: ProgrammeSchedule): ProgrammeSurfaceView {
  const byDay = new Map<string, { label: string; items: ProgrammeSurfaceItem[] }>();
  const unscheduled: ProgrammeSurfaceItem[] = [];
  const affected: ProgrammeSurfaceItem[] = [];
  for (const item of view.items) {
    const start = item.windowStart ? parts(item.windowStart) : undefined;
    const end = item.windowEnd ? parts(item.windowEnd) : undefined;
    const place = item.placeLabel ? scrubText(item.placeLabel) : '';
    const caseCount = item.affectedCaseCount ?? (item.affectedCaseRef ? 1 : 0);
    const row: ProgrammeSurfaceItem = {
      key: item.itemRef,
      timeLabel: start?.time ?? 'Time to be set',
      title: scrubText(item.label) || 'Programme session',
      tone: caseCount > 0 ? 'watch' : 'ok',
      ...(place ? { tag: place } : {}),
      ...(item.affectedCaseRef ? { caseId: item.affectedCaseRef } : {}),
      caseCount,
      ...(end && start && end.dayKey === start.dayKey ? { endLabel: end.time } : {}),
      required: item.requiredParticipants,
      optional: item.optionalParticipants,
      inPerson: item.requiresPhysicalPresence,
    };
    if (caseCount > 0) affected.push(row);
    if (!start) {
      unscheduled.push(row);
      continue;
    }
    const group = byDay.get(start.dayKey) ?? { label: start.dayLabel, items: [] };
    group.items.push(row);
    byDay.set(start.dayKey, group);
  }
  const days: ProgrammeSurfaceDay[] = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, group]) => ({
      dateLabel: group.label,
      items: group.items.sort((a, b) => a.timeLabel.localeCompare(b.timeLabel) || a.title.localeCompare(b.title)),
    }));
  if (unscheduled.length > 0) days.push({ dateLabel: 'Not yet scheduled', items: unscheduled });
  return {
    generatedAt: view.generatedAt,
    eventName: scrubText(view.eventTitle) || 'Event programme',
    days,
    sessionCount: view.items.length,
    dayCount: byDay.size,
    affected,
    populationSummary: view.populationSummary,
    travellers: view.travellers ?? [],
    endangeredCommitments: view.endangeredCommitments ?? [],
    missingInformation: view.missingInformation ?? [],
  };
}

/** "Tue 30 Sep, 09:00–10:30" in the window's own offset (never shifted). */
export function formatWindowRange(window: { start: string; end: string }): string {
  const start = parts(window.start);
  const end = parts(window.end);
  if (!start) return 'Time not set';
  if (!end) return `${start.dayLabel}, ${start.time}`;
  return end.dayKey === start.dayKey
    ? `${start.dayLabel}, ${start.time}–${end.time}`
    : `${start.dayLabel}, ${start.time} – ${end.dayLabel}, ${end.time}`;
}

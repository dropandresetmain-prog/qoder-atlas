/**
 * UI-local projections for the Decisions (D1) and Activity feed screens.
 *
 * Frozen OperatorDashboardView / Wave ApprovalsQueueView / TripActivityView
 * cover the data the integrator can project. These shapes are the richer
 * information architecture the approved renders expect (decide-by, age,
 * day-grouped feed glyphs). Screens render any conforming view; fields that
 * the backend cannot yet project are simply omitted — never fabricated at
 * render time.
 */
import type { EntityId, IsoDateTime } from '../domain/common.ts';
import type { OperatorDashboardView, OperatorDecisionRequest } from '../contracts/readmodels.ts';
import type { ApprovalsQueueView, TripActivityView } from '../app/waveReadmodels.ts';
import { formatMoney, formatRosterTime, formatShort } from './html.ts';

/** One row on the Decisions "Waiting now" table. */
export interface PendingDecisionRowView {
  caseId: EntityId;
  travellerName: string;
  /** Plain-language description of the outstanding decision. */
  decision: string;
  /** Cost / policy line when known, e.g. "SGD 310 (cap 250)". */
  cost?: string;
  /** Who must act, e.g. "Felix Hartono" or "Arjun (traveller)". */
  waitingOn?: string;
  /** Urgency cue, e.g. "Today — fares move". */
  decideBy?: string;
  /** Age relative to generatedAt, e.g. "25m". */
  age?: string;
}

/** One row on the Decisions "Decided recently" table. */
export interface DecidedDecisionRowView {
  caseId?: EntityId;
  travellerName: string;
  decision: string;
  cost?: string;
  decidedBy?: string;
  when?: string;
}

export interface DecisionsPageView {
  generatedAt: IsoDateTime;
  pending: PendingDecisionRowView[];
  decided: DecidedDecisionRowView[];
}

/** Glyph tone for activity feed rows (maps to `.fg-*` classes). */
export type ActivityGlyphTone = 'signal' | 'work' | 'ask' | 'done' | 'info';

export interface ActivityFeedItemView {
  /** Bold lead, e.g. "Northstar" or "Signal". */
  who: string;
  /** Plain-language summary after the em dash. */
  text: string;
  /** Supporting detail line. */
  sub?: string;
  /** Clock time in source offset, e.g. "09:02". */
  time: string;
  glyph: string;
  tone: ActivityGlyphTone;
}

export interface ActivityDayGroupView {
  /** Day heading, e.g. "Today · Tue 22 Sep". */
  label: string;
  items: ActivityFeedItemView[];
}

export interface ActivityPageView {
  generatedAt: IsoDateTime;
  days: ActivityDayGroupView[];
}

/**
 * Project a minimal Decisions page from the frozen dashboard. Only pending
 * rows are filled — decided history and decide-by/age need richer backend
 * evidence and are left empty rather than guessed.
 */
export function decisionsFromDashboard(view: OperatorDashboardView): DecisionsPageView {
  const pending: PendingDecisionRowView[] = [];
  for (const trip of view.trips) {
    for (const decision of trip.pendingDecisions) {
      pending.push(pendingRowFromTrip(trip.travellerNames[0] ?? trip.label ?? 'Traveller', decision, view.generatedAt));
    }
  }
  return { generatedAt: view.generatedAt, pending, decided: [] };
}

/**
 * Prefer the Wave approval projection when it is available: unlike the
 * dashboard's legacy summary, it preserves traveller, organisation, and
 * human-agent authority outcomes from the persisted decision.
 */
export function decisionsFromApprovalsQueue(view: ApprovalsQueueView): DecisionsPageView {
  return {
    generatedAt: view.generatedAt,
    pending: view.pending.map((decision) => ({
      caseId: decision.caseId,
      travellerName: decision.travellerNames.join(', ') || 'Traveller',
      decision: `${decision.action} requires a decision`,
      ...(decision.amount ? { cost: formatMoney(decision.amount) } : {}),
      waitingOn:
        decision.requestedFrom === 'TRAVELLER'
          ? 'Traveller'
          : decision.requestedFrom === 'ORGANISATION'
            ? 'Organisation'
            : 'Organiser',
      age: formatRosterTime(decision.requestedAt, view.generatedAt),
    })),
    // Decided history is not yet a programme-level projection. Leave it
    // empty rather than reconstructing or inventing approval evidence.
    decided: [],
  };
}

function pendingRowFromTrip(
  travellerName: string,
  decision: OperatorDecisionRequest,
  generatedAt: IsoDateTime,
): PendingDecisionRowView {
  const waitingOn =
    decision.decisionType === 'APPROVAL'
      ? 'Organisation'
      : `${travellerName} (traveller)`;
  return {
    caseId: decision.caseId,
    travellerName,
    decision: decision.description,
    ...(decision.amount ? { cost: formatMoney(decision.amount) } : {}),
    waitingOn,
    ...(decision.requestedAt
      ? {
          age: formatRosterTime(decision.requestedAt, generatedAt),
        }
      : {}),
  };
}

/** Map a Wave activity action string onto an approved glyph tone. Generic only. */
export function glyphForActivityAction(action: string): { glyph: string; tone: ActivityGlyphTone } {
  const upper = action.toUpperCase();
  if (upper.includes('SIGNAL') || upper.includes('CANCEL') || upper.includes('DISRUPT')) {
    return { glyph: '!', tone: 'signal' };
  }
  if (
    upper.includes('APPROVAL') ||
    upper.includes('REQUIRES') ||
    upper.includes('AWAITING') ||
    upper.includes('CHOICE') ||
    upper.includes('INPUT')
  ) {
    return { glyph: '?', tone: 'ask' };
  }
  if (
    upper.includes('RESOLVED') ||
    upper.includes('CONFIRMED') ||
    upper.includes('VERIFIED') ||
    upper.includes('BOOKED') ||
    upper.includes('DONE')
  ) {
    return { glyph: '✓', tone: 'done' };
  }
  if (upper.includes('PLAN') || upper.includes('SEARCH') || upper.includes('COMPAR') || upper.includes('CHECK')) {
    return { glyph: '◆', tone: 'work' };
  }
  return { glyph: 'i', tone: 'info' };
}

/** Clock portion of an ISO instant for feed rows. */
export function activityClock(iso: IsoDateTime): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  return match ? `${match[4]}:${match[5]}` : formatShort(iso);
}

/** Compose the existing real per-trip audit projections into one activity feed. */
export function activityFromTripActivities(
  generatedAt: IsoDateTime,
  activities: readonly TripActivityView[],
): ActivityPageView {
  const events = activities
    .flatMap((activity) => activity.events)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.action.localeCompare(b.action));
  const byDay = new Map<string, ActivityFeedItemView[]>();
  for (const event of events) {
    const day = event.occurredAt.slice(0, 10) || 'Undated';
    const glyph = glyphForActivityAction(event.action);
    const items = byDay.get(day) ?? [];
    items.push({
      who: event.actor,
      text: event.summary,
      ...(event.subject ? { sub: event.subject } : {}),
      time: activityClock(event.occurredAt),
      ...glyph,
    });
    byDay.set(day, items);
  }
  return {
    generatedAt,
    days: [...byDay.entries()].map(([label, items]) => ({ label, items })),
  };
}

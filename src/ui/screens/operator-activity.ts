/**
 * Operator Activity feed (approved activity.html).
 *
 * Audit trail in plain language: glyph · who — text · sub · time, grouped
 * by day. Renders only supplied feed items — never invents events.
 */
import type { ReadModelEnvelope } from '../../contracts/readmodels.ts';
import type { ActivityDayGroupView, ActivityFeedItemView, ActivityPageView } from '../operator-surfaces-view-model.ts';
import { escapeHtml, formatInstant } from '../html.ts';
import { errorPanel, loadingPanel } from '../components.ts';

const TONE_CLASS = {
  signal: 'fg-signal',
  work: 'fg-work',
  ask: 'fg-ask',
  done: 'fg-done',
  info: 'fg-info',
} as const;

function feedRow(item: ActivityFeedItemView, index: number): string {
  const sub = item.sub ? `<div class="f-sub">${escapeHtml(item.sub)}</div>` : '';
  return `
  <div class="frow" style="--i:${Math.min(index, 20)}" data-ui-feed-tone="${escapeHtml(item.tone)}">
    <span class="f-glyph ${TONE_CLASS[item.tone]}" aria-hidden="true">${escapeHtml(item.glyph)}</span>
    <div class="f-text"><span class="f-who">${escapeHtml(item.who)}</span> — ${escapeHtml(item.text)}${sub}</div>
    <span class="f-time">${escapeHtml(item.time)}</span>
  </div>`;
}

function dayGroup(day: ActivityDayGroupView, startIndex: number): { html: string; nextIndex: number } {
  let index = startIndex;
  const rows = day.items
    .map((item) => {
      const row = feedRow(item, index);
      index += 1;
      return row;
    })
    .join('');
  return {
    html: `<div class="feed-day">${escapeHtml(day.label)}</div>${rows}`,
    nextIndex: index,
  };
}

export function renderActivityBody(view: ActivityPageView): string {
  if (view.days.length === 0 || view.days.every((d) => d.items.length === 0)) {
    return `
<main class="shell" data-ui-screen="activity">
  <div class="page-head">
    <h1>Activity</h1>
    <p class="sub">Everything Northstar saw, did, and asked — in order. This is the audit trail, in plain language.</p>
    <p class="meta">Generated ${escapeHtml(formatInstant(view.generatedAt))}</p>
  </div>
  <div class="feed" data-ui-section="activity-feed">
    <p class="empty-note" style="padding:18px">No activity recorded yet.</p>
  </div>
</main>`;
  }

  let index = 0;
  const groups: string[] = [];
  for (const day of view.days) {
    if (day.items.length === 0) continue;
    const { html, nextIndex } = dayGroup(day, index);
    groups.push(html);
    index = nextIndex;
  }

  return `
<main class="shell" data-ui-screen="activity">
  <div class="page-head">
    <h1>Activity</h1>
    <p class="sub">Everything Northstar saw, did, and asked — in order. This is the audit trail, in plain language.</p>
    <p class="meta">Generated ${escapeHtml(formatInstant(view.generatedAt))}</p>
  </div>
  <div class="feed stagger" data-ui-section="activity-feed">
    ${groups.join('')}
  </div>
</main>`;
}

export function renderActivity(envelope: ReadModelEnvelope<ActivityPageView>): string {
  if (envelope.state === 'LOADING') {
    return `<main class="shell">${loadingPanel('Loading activity', 'Gathering everything Northstar saw, did, and asked.')}</main>`;
  }
  if (envelope.state === 'ERROR') {
    return `<main class="shell">${errorPanel('Activity is unavailable right now', envelope.errorMessage)}</main>`;
  }
  if (!envelope.data) {
    return `<main class="shell">${errorPanel('Activity is unavailable right now')}</main>`;
  }
  return renderActivityBody(envelope.data);
}

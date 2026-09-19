/**
 * Activity surface — what happened, who was involved and what Northstar did,
 * in plain language, grouped by day (legacy feed structure).
 *
 * Built from the v2 ActivityFeed through `adaptActivityFeedToActivityPage`, so
 * actors and subjects arrive as safe labels. Every entry that belongs to a
 * recovery case links to it. Nothing here interprets the record beyond that.
 */
import type { ActivityFeed } from '../../contracts/v2/product/readModels.ts';
import {
  adaptActivityFeedToActivityPage,
  type ActivitySurfaceItem,
  type ActivitySurfaceView,
} from '../../app/target/adapters/activityAdapter.ts';
import { caseHref } from '../../app/target/productShell.ts';
import { escapeHtml, formatInstant } from '../html.ts';

const TONE_CLASS = {
  signal: 'fg-signal',
  work: 'fg-work',
  ask: 'fg-ask',
  done: 'fg-done',
  info: 'fg-info',
} as const;

function feedRow(item: ActivitySurfaceItem): string {
  const sub = item.sub ? `<div class="f-sub">${escapeHtml(item.sub)}</div>` : '';
  const link = item.caseId
    ? ` <a class="f-link" href="${escapeHtml(caseHref(item.caseId))}" data-test="activity-case-link">Open case →</a>`
    : '';
  return `
  <div class="frow" data-ui-feed-tone="${item.tone}" data-test="activity-row"${item.caseId ? ` data-case-ref="${escapeHtml(item.caseId)}"` : ''}>
    <span class="f-glyph ${TONE_CLASS[item.tone]}" aria-hidden="true">${escapeHtml(item.glyph)}</span>
    <div class="f-text"><span class="f-who">${escapeHtml(item.who)}</span> — ${escapeHtml(item.text)}${link}${sub}</div>
    <span class="f-time">${escapeHtml(item.time)}</span>
  </div>`;
}

export function renderActivitySurface(view: ActivitySurfaceView): string {
  const days = view.days.filter((day) => day.items.length > 0);
  const body = days.length > 0
    ? days
      .map((day) => `<div class="feed-day">${escapeHtml(day.label)}</div>${day.items.map(feedRow).join('')}`)
      .join('')
    : '<p class="empty-note" style="padding:18px">No activity recorded yet.</p>';
  const count = days.reduce((sum, day) => sum + day.items.length, 0);
  return `
<main class="shell product-activity-feed" data-test="product-activity-feed" data-ui-screen="activity">
  <div class="page-head">
    <h1>Activity</h1>
    <p class="sub">What happened, who was involved, and what Northstar did — in plain language.</p>
    <p class="meta">Generated ${escapeHtml(formatInstant(view.generatedAt))}</p>
  </div>
  <div class="feed" data-test="activity-feed" data-ui-section="activity-feed" data-poll-region="activity-feed">
    ${body}
  </div>
  <p class="footnote" data-poll-region="activity-footer">Showing the ${count} most recent ${count === 1 ? 'event' : 'events'}${view.truncated ? '; older activity is not shown on this page' : ''}.</p>
</main>`;
}

export function renderProductActivityFeed(view: ActivityFeed): string {
  return renderActivitySurface(adaptActivityFeedToActivityPage(view));
}

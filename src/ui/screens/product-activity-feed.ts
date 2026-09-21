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
  <div data-poll-region="activity-footer">
    <p class="footnote">Showing ${count} ${view.beforeCursor ? 'earlier' : 'latest'} ${count === 1 ? 'event' : 'events'}.</p>
    <nav aria-label="Activity pages">
      ${view.beforeCursor ? '<a href="/api/v2/operator/activity?format=html">Latest activity</a>' : ''}
      ${view.nextCursor ? `<a href="/api/v2/operator/activity?format=html&amp;before=${escapeHtml(encodeURIComponent(view.nextCursor))}">Older activity →</a>` : ''}
    </nav>
  </div>
</main>`;
}

export function renderProductActivityFeed(view: ActivityFeed): string {
  return renderActivitySurface(adaptActivityFeedToActivityPage(view));
}

const ACTIVITY_ICON = `<svg class="v5-activity-title-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>`;

/**
 * Compact Overview/Case rail projection of the same ActivityFeed vocabulary.
 * Does not invent entries or reinterpret actor/source language.
 */
export function renderCompactActivityRail(
  feed: ActivityFeed | undefined,
  options: { readonly limit?: number; readonly logHref?: string } = {},
): string {
  const limit = options.limit ?? 4;
  const logHref = options.logHref ?? '/activity';
  const surface = feed ? adaptActivityFeedToActivityPage(feed) : undefined;
  const seen = new Set<string>();
  const items = (surface?.days ?? []).flatMap((day) => day.items).filter((item) => {
    const key = `${item.who}\u0000${item.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
  const body = items.length === 0
    ? '<p class="cw-muted" data-test="overview-activity-empty">No activity recorded yet.</p>'
    : items.map((item) => {
      const link = item.caseId
        ? ` <a class="f-link" href="${escapeHtml(caseHref(item.caseId))}" data-test="activity-case-link">Open case →</a>`
        : '';
      const sub = item.sub ? `<p>${escapeHtml(item.sub)}</p>` : '';
      return `<div class="v5-activity-item" data-test="overview-activity-row" data-ui-feed-tone="${item.tone}"${item.caseId ? ` data-case-ref="${escapeHtml(item.caseId)}"` : ''}>
        <div class="v5-activity-bullet ${TONE_CLASS[item.tone]}" aria-hidden="true">${escapeHtml(item.glyph)}</div>
        <div><strong>${escapeHtml(item.who)} — ${escapeHtml(item.text)}${link}</strong>
          <p>${escapeHtml(item.time)}</p>${sub}</div></div>`;
    }).join('');
  return `<section class="v5-activity" aria-label="Northstar activity" data-test="overview-activity-rail">
    <h2 class="v5-rail-title">${ACTIVITY_ICON}Northstar activity</h2>
    ${body}
    <div class="v5-activity-footer"><span>Recent material activity</span>
      <a class="v5-text-button" href="${escapeHtml(logHref)}" data-test="overview-activity-log">View log →</a></div>
  </section>`;
}

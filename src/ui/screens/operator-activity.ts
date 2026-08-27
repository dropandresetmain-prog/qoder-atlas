/**
 * Operator Activity feed (approved activity.html).
 *
 * Audit trail in plain language: glyph · who — text · sub · time, grouped
 * by day. Renders only supplied feed items — never invents events.
 * R3D: paginate ~20 entries per page while preserving day grouping.
 */
import type { ReadModelEnvelope } from '../../contracts/readmodels.ts';
import type { ActivityDayGroupView, ActivityFeedItemView, ActivityPageView } from '../operator-surfaces-view-model.ts';
import { ACTIVITY_PAGE_SIZE } from '../presentationState.ts';
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
  <div class="frow" style="--i:${Math.min(index, 20)}" data-ui-feed-tone="${escapeHtml(item.tone)}" data-activity-row>
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
    html: `<div class="feed-day" data-activity-day>${escapeHtml(day.label)}</div>${rows}`,
    nextIndex: index,
  };
}

function activityPaginationScript(pageSize: number): string {
  return `
  <script>
  (function(){
    var feed = document.querySelector('[data-ui-section="activity-feed"]');
    var pagination = document.querySelector('[data-test="activity-pagination"]');
    var prev = document.querySelector('[data-activity-prev]');
    var next = document.querySelector('[data-activity-next]');
    var label = document.querySelector('[data-activity-page-label]');
    if (!feed) return;
    var pageSize = ${pageSize};
    var page = 0;
    var rows = Array.prototype.slice.call(feed.querySelectorAll('[data-activity-row]'));

    function render() {
      var pages = Math.max(1, Math.ceil(rows.length / pageSize));
      if (page >= pages) page = pages - 1;
      if (page < 0) page = 0;
      var start = page * pageSize;
      var end = start + pageSize;
      rows.forEach(function(row, idx){
        row.style.display = (idx >= start && idx < end) ? '' : 'none';
      });
      // Show a day header only when at least one of its following rows is visible.
      Array.prototype.slice.call(feed.querySelectorAll('[data-activity-day]')).forEach(function(day){
        var el = day.nextElementSibling;
        var show = false;
        while (el && !el.hasAttribute('data-activity-day')) {
          if (el.hasAttribute('data-activity-row') && el.style.display !== 'none') { show = true; break; }
          el = el.nextElementSibling;
        }
        day.style.display = show ? '' : 'none';
      });
      if (pagination) {
        pagination.hidden = rows.length <= pageSize;
        if (label) label.textContent = 'Page ' + (page + 1) + ' of ' + pages + ' · ' + rows.length + ' events';
        if (prev) prev.disabled = page <= 0;
        if (next) next.disabled = page >= pages - 1;
      }
    }

    if (prev) prev.addEventListener('click', function(){ page -= 1; render(); });
    if (next) next.addEventListener('click', function(){ page += 1; render(); });
    render();
  })();
  </script>`;
}

export function renderActivityBody(view: ActivityPageView): string {
  if (view.days.length === 0 || view.days.every((d) => d.items.length === 0)) {
    return `
<main class="shell" data-ui-screen="activity">
  <div class="page-head">
    <h1>Activity</h1>
    <p class="sub">What happened, who was involved, and what Northstar did — in plain language.</p>
    <p class="meta">Generated ${escapeHtml(formatInstant(view.generatedAt))}</p>
  </div>
  <div class="feed" data-ui-section="activity-feed" data-page-size="${ACTIVITY_PAGE_SIZE}">
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
    <p class="sub">What happened, who was involved, and what Northstar did — in plain language.</p>
    <p class="meta">Generated ${escapeHtml(formatInstant(view.generatedAt))}</p>
  </div>
  <div class="feed stagger" data-ui-section="activity-feed" data-page-size="${ACTIVITY_PAGE_SIZE}">
    ${groups.join('')}
  </div>
  <div class="roster-pagination" data-test="activity-pagination" hidden>
    <button type="button" class="btn btn-ghost btn-sm" data-activity-prev data-test="activity-prev">Previous</button>
    <span class="roster-page-label" data-activity-page-label data-test="activity-page-label"></span>
    <button type="button" class="btn btn-ghost btn-sm" data-activity-next data-test="activity-next">Next</button>
  </div>
  ${activityPaginationScript(ACTIVITY_PAGE_SIZE)}
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

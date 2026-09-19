/**
 * Programme surface — the event's schedule as the legacy day-by-day timeline,
 * plus the sessions whose attendees have an open recovery case.
 *
 * Built from the v2 ProgrammeSchedule via `adaptProgrammeScheduleToTimeline`.
 * Whether a session is reachable for a given person is the evaluator's answer
 * and lives on the Overview and Case surfaces; here a session is only flagged
 * when the backend reports an open case among its attendees, and it links to
 * that case.
 */
import type { ProgrammeSchedule } from '../../contracts/v2/product/readModels.ts';
import {
  adaptProgrammeScheduleToTimeline,
  type ProgrammeSurfaceItem,
  type ProgrammeSurfaceView,
} from '../../app/target/adapters/programmeAdapter.ts';
import { caseHref } from '../../app/target/productShell.ts';
import { escapeHtml, formatInstant } from '../html.ts';
import { renderProgrammeTimeSwapController } from '../programme-time-swap-controller.ts';

function tile(key: string, count: number, label: string, tone: string, attention = false): string {
  return `
  <div class="tile tone-${tone}${attention && count > 0 ? ' is-attention' : ''}" data-summary-key="${key}">
    <div class="tile-count">${count}</div>
    <div class="tile-label">${escapeHtml(label)}</div>
  </div>`;
}

function people(item: ProgrammeSurfaceItem): string {
  const parts = [`${item.required} required`];
  if (item.optional > 0) parts.push(`${item.optional} optional`);
  if (item.inPerson) parts.push('in person');
  return parts.join(' · ');
}

function timelineRow(item: ProgrammeSurfaceItem): string {
  const dot = item.tone === 'ok' ? 'd-ok' : item.tone === 'watch' ? 'd-watch' : '';
  const time = item.endLabel ? `${item.timeLabel}–${item.endLabel}` : item.timeLabel;
  const where = item.tag ? `<span class="tag">${escapeHtml(item.tag)}</span>` : '';
  const link = item.caseId
    ? `<a class="tag" href="${escapeHtml(caseHref(item.caseId))}" data-test="programme-case-link">${item.caseCount > 1 ? `${item.caseCount} open cases` : 'Open case'} →</a>`
    : '';
  return `<div class="tl-item${item.tone === 'endangered' ? ' endangered' : ''}" data-test="programme-item" data-item-ref="${escapeHtml(item.key)}"${item.caseId ? ` data-case-ref="${escapeHtml(item.caseId)}"` : ''}><span class="dot ${dot}"></span><span class="t">${escapeHtml(time)}</span><span class="ttl" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">${escapeHtml(item.title)}</span><span class="tag">${escapeHtml(people(item))}</span>${where}${link}</div>`;
}

function attentionSection(view: ProgrammeSurfaceView): string {
  if (view.affected.length === 0) return '';
  return `
  <section class="section" aria-label="Sessions to watch" data-poll-region="programme-attention">
    <h2>Sessions to watch <span class="count c-alert">${view.affected.length}</span></h2>
    ${view.affected.map((item) => `
    <div class="callout tone-watch" data-test="programme-attention">
      <h3>${escapeHtml(item.title)}</h3>
      <p>${item.caseCount === 1 ? 'One attendee has' : `${item.caseCount} attendees have`} an open recovery case that could affect this session.</p>
      <div class="btn-row"><a class="btn btn-ghost" href="${escapeHtml(caseHref(item.caseId!))}">Open case →</a></div>
    </div>`).join('')}
  </section>`;
}

function timeSwapSection(view: ProgrammeSchedule): string {
  const eligible = view.items.filter((item) => item.windowStart && item.windowEnd);
  if (eligible.length < 2) return '';
  const options = eligible.map((item) =>
    `<option value="${escapeHtml(item.itemRef)}">${escapeHtml(item.label)}</option>`).join('');
  return `
  <section class="section" aria-label="Preview a programme time swap" data-programme-time-swap data-test="programme-time-swap">
    <h2>Preview a time swap</h2>
    <p class="sub">See how exchanging these session times would affect attendees. Nothing changes during the preview.</p>
    <div class="panel" style="margin-top:14px">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">
        <label class="kv-label" for="programme-time-swap-a">First session
          <select id="programme-time-swap-a" data-programme-item-a style="display:block;width:100%;margin-top:6px;font:inherit;padding:8px">
            ${options}
          </select>
        </label>
        <label class="kv-label" for="programme-time-swap-b">Second session
          <select id="programme-time-swap-b" data-programme-item-b style="display:block;width:100%;margin-top:6px;font:inherit;padding:8px">
            ${options}
          </select>
        </label>
      </div>
      <div class="btn-row" style="margin-top:14px">
        <button type="button" class="btn btn-primary" data-programme-time-swap-preview data-test="programme-time-swap-preview">Preview time swap</button>
      </div>
      <p data-programme-time-swap-status data-test="programme-time-swap-status" role="status" aria-live="polite" style="margin:10px 0 0"></p>
    </div>
    <div data-programme-time-swap-result data-test="programme-time-swap-result" hidden style="margin-top:16px"></div>
  </section>`;
}

export function renderProgrammeSurface(view: ProgrammeSurfaceView, schedule?: ProgrammeSchedule): string {
  const scheduledCount = view.days
    .filter((day) => day.dateLabel !== 'Not yet scheduled')
    .reduce((sum, day) => sum + day.items.length, 0);
  const inPerson = view.days.reduce((sum, day) => sum + day.items.filter((item) => item.inPerson).length, 0);
  const timeline = view.days.length > 0
    ? `
  <section class="section" aria-label="Programme timeline" data-poll-region="programme-timeline">
    <h2>Programme timeline <span class="count">${view.sessionCount} ${view.sessionCount === 1 ? 'session' : 'sessions'} · ${view.dayCount} ${view.dayCount === 1 ? 'day' : 'days'}</span></h2>
    <div class="timeline" data-test="programme-schedule">${view.days.map((day) => `
      <div class="tl-day">
        <div class="tl-date">${escapeHtml(day.dateLabel)}</div>
        <div class="tl-items">${day.items.map(timelineRow).join('')}</div>
      </div>`).join('')}
    </div>
  </section>`
    : '<section class="section" data-poll-region="programme-timeline"><p class="empty-note">No programme sessions yet.</p></section>';
  return `
<main class="shell product-programme-schedule" data-test="product-programme-schedule" data-ui-screen="programme">
  <div class="page-head">
    <h1>${escapeHtml(view.eventName)}</h1>
    <p class="sub">Every session on the programme, day by day, and who it needs to work for.</p>
    <p class="meta">Event programme · generated ${escapeHtml(formatInstant(view.generatedAt))}</p>
  </div>
  <div class="tiles stagger" role="group" aria-label="Programme at a glance" data-poll-region="programme-summary" data-test="programme-summary-tiles">
    ${tile('sessions', view.sessionCount, 'Sessions', 'ok')}
    ${tile('days', view.dayCount, 'Days', 'ok')}
    ${tile('watch', view.affected.length, 'Sessions to watch', view.affected.length > 0 ? 'watch' : 'ok', true)}
    ${tile('in-person', inPerson, 'In person', 'neutral')}
    ${tile('unscheduled', view.sessionCount - scheduledCount, 'Not yet scheduled', 'neutral')}
  </div>
  ${attentionSection(view)}
  ${timeline}
  ${schedule ? timeSwapSection(schedule) : ''}
</main>`;
}

export function renderProductProgrammeSchedule(view: ProgrammeSchedule): string {
  return `${renderProgrammeSurface(adaptProgrammeScheduleToTimeline(view), view)}${renderProgrammeTimeSwapController()}`;
}

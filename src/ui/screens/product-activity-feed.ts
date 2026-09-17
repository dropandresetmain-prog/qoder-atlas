/**
 * Activity surface — committed changes, newest first.
 *
 * This is the audit trail as recorded, not a narrative: each line states when
 * it happened, who caused it, what subject moved and which command committed.
 * Nothing is summarised into an interpretation the record does not contain.
 */
import type { ActivityFeed } from '../../contracts/v2/product/readModels.ts';
import { escapeHtml, formatInstant } from '../html.ts';

function row(entry: ActivityFeed['entries'][number]): string {
  return `
    <div class="qrow" data-test="activity-row">
      <span class="q-glyph g-unk" aria-hidden="true">·</span>
      <div>
        <div class="q-name">${escapeHtml(entry.what)}</div>
        <div class="q-issue">${escapeHtml(entry.atLabel)} · ${escapeHtml(entry.actorLabel)}</div>
        <p class="b-extra">${escapeHtml(entry.subjectLabel)}${entry.reason ? ` · ${escapeHtml(entry.reason)}` : ''}</p>
      </div>
    </div>`;
}

export function renderProductActivityFeed(view: ActivityFeed): string {
  const body = view.entries.length > 0
    ? `<div class="queue" data-test="activity-feed">${view.entries.map(row).join('')}</div>`
    : '<p class="empty-note">No changes recorded in this workspace.</p>';
  return `
<main class="shell product-activity-feed" data-test="product-activity-feed">
  <div class="page-head">
    <h1>Activity</h1>
    <p class="sub">Committed changes to authoritative state, newest first.</p>
    <p class="meta">Generated ${escapeHtml(formatInstant(view.generatedAt))}</p>
  </div>
  <section class="section" aria-label="Recent changes">
    <h2>Recent changes <span class="count">${view.entries.length}</span></h2>
    ${body}
    ${view.truncated ? '<p class="b-extra">Older changes exist beyond this page.</p>' : ''}
  </section>
</main>`;
}

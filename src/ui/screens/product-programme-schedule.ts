/**
 * Programme surface — the event's schedule and who is committed to each item.
 *
 * Every value is rendered as supplied. Nothing here decides whether a
 * commitment is reachable, at risk or ready: that is the evaluator's answer
 * and it appears on the Overview surface, per subject.
 */
import type { ProgrammeSchedule } from '../../contracts/v2/product/readModels.ts';
import { escapeHtml, formatInstant } from '../html.ts';

function row(item: ProgrammeSchedule['items'][number]): string {
  const when = item.windowLabel
    ? escapeHtml(item.windowLabel)
    : '<span class="b-extra">Not scheduled</span>';
  const where = item.placeLabel
    ? escapeHtml(item.placeLabel)
    : '<span class="b-extra">No place stated</span>';
  const presence = item.requiresPhysicalPresence ? 'In person' : 'No presence requirement';
  return `
    <div class="qrow" data-test="programme-item" data-item-ref="${escapeHtml(item.itemRef)}">
      <span class="q-glyph g-unk" aria-hidden="true">·</span>
      <div>
        <div class="q-name">${escapeHtml(item.label)}</div>
        <div class="q-issue">${when} · ${where}</div>
        <p class="b-extra">${escapeHtml(item.itemType)} · ${escapeHtml(item.lifecycleStatus)} · ${escapeHtml(presence)}</p>
      </div>
      <div class="b-right">
        <span class="badge tone-neutral">${item.requiredParticipants} required</span>
        <span class="badge tone-neutral">${item.optionalParticipants} optional</span>
      </div>
    </div>`;
}

export function renderProductProgrammeSchedule(view: ProgrammeSchedule): string {
  const body = view.items.length > 0
    ? `<div class="queue" data-test="programme-schedule">${view.items.map(row).join('')}</div>`
    : '<p class="empty-note">No programme items in scope.</p>';
  return `
<main class="shell product-programme-schedule" data-test="product-programme-schedule">
  <div class="page-head">
    <h1>Programme</h1>
    <p class="sub">${escapeHtml(view.eventTitle)} — scheduled commitments and accepted participation.</p>
    <p class="meta">Generated ${escapeHtml(formatInstant(view.generatedAt))}</p>
  </div>
  <section class="section" aria-label="Programme items">
    <h2>Commitments <span class="count">${view.items.length}</span></h2>
    ${body}
  </section>
</main>`;
}

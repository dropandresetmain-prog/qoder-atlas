/**
 * Incident programme surface — who a change affects and what it does to the
 * programme, in plain language (traveller and incident parts only; the
 * Overview belongs to another lane).
 *
 * Travellers are shown by name with plain outcome wording; trips are reached
 * through a link, never by printing a reference; programme commitments carry a
 * plain state word. Current-versus-proposed programme text is passed through
 * only after identifiers are removed.
 */
import type { IncidentProgrammeView } from '../../contracts/v2/product/readModels.ts';
import {
  assessmentToneClass,
  ldgSemanticTone,
  remainderViabilityTone,
  semanticToneDotClass,
} from '../../app/target/adapters/operatorOverviewAdapter.ts';
import { CHECK_RESULT_LABEL, scrubText } from '../../app/target/adapters/surfaceLabels.ts';
import { caseHref } from '../../app/target/productShell.ts';
import { presentGraphState } from '../semantics/adapter.ts';
import { VIABILITY_LABEL } from '../copy.ts';
import { escapeHtml, formatInstant } from '../html.ts';

export interface IncidentProgrammeRenderOptions {
  /** The recovery case this incident belongs to; enables the back link. */
  caseRef?: string;
}

function badge(label: string, tone: string): string {
  return `<span class="badge tone-${tone}">${escapeHtml(label)}</span>`;
}

function technicalOutcome(outcome: IncidentProgrammeView['affectedSet'][number]['outcome']): string {
  return `<details class="technical-details"><summary>Technical details</summary><span>${escapeHtml(outcome)}</span></details>`;
}

/** Trip pages are addressed by journey id; other trip refs have no traveller page. */
function travellerHref(tripRef: string): string | undefined {
  return tripRef.startsWith('JOURNEY:')
    ? `/traveller?trip=${encodeURIComponent(tripRef.slice('JOURNEY:'.length))}`
    : undefined;
}

function affectedSetTable(view: IncidentProgrammeView): string {
  if (view.affectedSet.length === 0) return '<p class="empty-note">No travellers are affected.</p>';
  const rows = view.affectedSet
    .map((person) => {
      const href = travellerHref(person.tripRef);
      const outcome = CHECK_RESULT_LABEL[person.outcome];
      return `
      <tr data-test="affected-person">
        <td><strong>${escapeHtml(scrubText(person.personLabel) || 'Traveller')}</strong></td>
        <td>${badge(outcome, assessmentToneClass(person.outcome))}${technicalOutcome(person.outcome)}</td>
        <td>${badge(VIABILITY_LABEL[person.remainderViability], remainderViabilityTone(person.remainderViability))}</td>
        <td>${href ? `<a href="${escapeHtml(href)}" data-test="traveller-link">View trip →</a>` : ''}</td>
      </tr>`;
    })
    .join('');
  return `
    <div class="panel">
      <table class="traveller-table" data-test="affected-set">
        <thead>
          <tr><th>Traveller</th><th>Their session</th><th>Rest of the trip</th><th></th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function commitmentsList(view: IncidentProgrammeView): string {
  if (view.programmeCommitments.length === 0) {
    return '<p class="empty-note">No programme commitments in scope.</p>';
  }
  const rows = view.programmeCommitments
    .map(
      (item) => `
      <div class="tl-item" data-test="programme-commitment" data-item-ref="${escapeHtml(item.itemRef)}">
        <span class="dot ${semanticToneDotClass(ldgSemanticTone(item.state))}"></span>
        <span class="ttl">${escapeHtml(scrubText(item.label) || 'Programme session')}</span>
        ${item.windowLabel ? `<span class="t">${escapeHtml(item.windowLabel)}</span>` : ''}
        <span class="tag">${escapeHtml(presentGraphState(item.state).label)}</span>
      </div>`,
    )
    .join('');
  return `<div class="timeline"><div class="tl-items">${rows}</div></div>`;
}

function programmeStateCompare(view: IncidentProgrammeView): string {
  if (!view.currentProgrammeState && !view.proposedProgrammeState) return '';
  const current = scrubText(view.currentProgrammeState ?? '');
  const proposed = scrubText(view.proposedProgrammeState ?? '');
  const currentBox = `<div class="cc-box"><p class="kv-label">Current programme</p>${current ? `<p>${escapeHtml(current)}</p>` : '<p class="empty-note">Not available.</p>'}</div>`;
  if (!proposed) {
    return `<section class="section" data-poll-region="incident-programme-state"><h2>Programme state</h2>${currentBox}</section>`;
  }
  return `
    <section class="section" data-test="programme-state-compare" data-poll-region="incident-programme-state">
      <h2>Programme state</h2>
      <div class="change-compare">
        ${currentBox}
        <div class="cc-arrow" aria-hidden="true">→</div>
        <div class="cc-box to"><p class="kv-label">Proposed programme</p><p>${escapeHtml(proposed)}</p></div>
      </div>
    </section>`;
}

export function renderProductIncidentProgramme(
  view: IncidentProgrammeView,
  options: IncidentProgrammeRenderOptions = {},
): string {
  const back = options.caseRef
    ? `<a href="${escapeHtml(caseHref(options.caseRef))}" data-test="back-to-case">← Back to case</a> · `
    : '';
  const summary = scrubText(view.sourceChangeSummary) || 'A change is affecting the programme.';
  return `
<main class="shell product-incident-programme" data-test="product-incident-programme" data-ui-screen="incident-programme">
  <div class="page-head">
    <h1>How the change affects the programme</h1>
    <p class="sub">${escapeHtml(summary)}</p>
    <p class="meta">${back}Generated ${escapeHtml(formatInstant(view.generatedAt))}</p>
  </div>
  <section class="section" data-poll-region="incident-affected">
    <h2>Affected travellers <span class="count">${view.affectedSet.length}</span></h2>
    ${affectedSetTable(view)}
  </section>
  <section class="section" data-poll-region="incident-commitments">
    <h2>Programme commitments</h2>
    ${commitmentsList(view)}
  </section>
  ${programmeStateCompare(view)}
</main>`;
}

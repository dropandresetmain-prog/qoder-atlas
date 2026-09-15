/**
 * M9 — product incident programme surface from v2 IncidentProgrammeView.
 * Shows affected travellers, programme commitments, and current vs proposed
 * programme state without scenario-specific hardcoding.
 */
import type { IncidentProgrammeView } from '../../contracts/v2/product/readModels.ts';
import {
  assessmentToneClass,
  ldgSemanticTone,
  remainderViabilityTone,
} from '../../app/target/adapters/operatorOverviewAdapter.ts';
import { VIABILITY_LABEL } from '../copy.ts';
import { escapeHtml, formatInstant } from '../html.ts';

function badge(label: string, tone: string): string {
  return `<span class="badge tone-${tone}">${escapeHtml(label)}</span>`;
}

function affectedSetTable(view: IncidentProgrammeView): string {
  const rows = view.affectedSet
    .map(
      (person) => `
      <tr data-test="affected-person">
        <td>${escapeHtml(person.personLabel)}</td>
        <td class="num">${escapeHtml(person.tripRef)}</td>
        <td>${badge(person.outcome, assessmentToneClass(person.outcome))}</td>
        <td>${badge(VIABILITY_LABEL[person.remainderViability], remainderViabilityTone(person.remainderViability))}</td>
      </tr>`,
    )
    .join('');
  return `
    <div class="table-wrap table-panel">
      <table class="traveller-table" data-test="affected-set">
        <thead>
          <tr>
            <th>Traveller</th>
            <th>Trip</th>
            <th>Outcome</th>
            <th>Remainder</th>
          </tr>
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
        <span class="dot d-${ldgSemanticTone(item.state) === 'ok' ? 'ok' : ldgSemanticTone(item.state) === 'alert' ? 'bad' : 'watch'}"></span>
        <span class="ttl">${escapeHtml(item.label)}</span>
        ${item.windowLabel ? `<span class="t">${escapeHtml(item.windowLabel)}</span>` : ''}
        <span class="tag">${escapeHtml(item.state)}</span>
      </div>`,
    )
    .join('');
  return `<div class="timeline"><div class="tl-items">${rows}</div></div>`;
}

function programmeStateCompare(view: IncidentProgrammeView): string {
  if (!view.currentProgrammeState && !view.proposedProgrammeState) return '';
  const current = view.currentProgrammeState
    ? `<div class="cc-box"><p class="kv-label">Current programme</p><p>${escapeHtml(view.currentProgrammeState)}</p></div>`
    : `<div class="cc-box"><p class="kv-label">Current programme</p><p class="empty-note">Not supplied.</p></div>`;
  const proposed = view.proposedProgrammeState
    ? `<div class="cc-box to"><p class="kv-label">Proposed programme</p><p>${escapeHtml(view.proposedProgrammeState)}</p></div>`
    : '';
  if (!proposed) {
    return `<section class="section"><h2>Programme state</h2>${current}</section>`;
  }
  return `
    <section class="section" data-test="programme-state-compare">
      <h2>Programme state</h2>
      <div class="change-compare">
        ${current}
        <div class="cc-arrow" aria-hidden="true">→</div>
        ${proposed}
      </div>
    </section>`;
}

export function renderProductIncidentProgramme(view: IncidentProgrammeView): string {
  return `
<main class="shell product-incident-programme" data-test="product-incident-programme">
  <div class="page-head">
    <h1>Incident programme</h1>
    <p class="sub">${escapeHtml(view.sourceChangeSummary)}</p>
    <p class="meta">Incident ${escapeHtml(view.incidentRef)} · Generated ${escapeHtml(formatInstant(view.generatedAt))}</p>
  </div>
  <section class="section">
    <h2>Affected travellers <span class="count">${view.affectedSet.length}</span></h2>
    ${affectedSetTable(view)}
  </section>
  <section class="section">
    <h2>Programme commitments</h2>
    ${commitmentsList(view)}
  </section>
  ${programmeStateCompare(view)}
</main>`;
}

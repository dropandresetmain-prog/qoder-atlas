/**
 * Operator Decisions screen (approved D1).
 *
 * "Every place Northstar is waiting on a person — nothing waits silently."
 * Renders Waiting now + Decided recently tables from a DecisionsPageView.
 * Never fabricates decide-by, cost, or decided history.
 */
import type { ReadModelEnvelope } from '../../contracts/readmodels.ts';
import type { DecisionsPageView, DecidedDecisionRowView, PendingDecisionRowView } from '../operator-surfaces-view-model.ts';
import { escapeHtml, formatInstant, encodeUri } from '../html.ts';
import { errorPanel, loadingPanel } from '../components.ts';

function pendingRow(row: PendingDecisionRowView): string {
  const cost = row.cost ? `<td class="num">${escapeHtml(row.cost)}</td>` : '<td class="num">—</td>';
  const waiting = row.waitingOn ? `<td>${escapeHtml(row.waitingOn)}</td>` : '<td>—</td>';
  const decideBy = row.decideBy ? `<td>${escapeHtml(row.decideBy)}</td>` : '<td>—</td>';
  const age = row.age ? `<td class="num">${escapeHtml(row.age)}</td>` : '<td class="num">—</td>';
  return `<tr data-case-id="${escapeHtml(row.caseId)}">
  <td><strong>${escapeHtml(row.travellerName)}</strong></td>
  <td>${escapeHtml(row.decision)}</td>
  ${cost}
  ${waiting}
  ${decideBy}
  ${age}
  <td><a href="/operator/cases/${encodeUri(row.caseId)}" data-test="decision-link">Open case →</a></td>
</tr>`;
}

function decidedRow(row: DecidedDecisionRowView): string {
  const cost = row.cost ? `<td class="num">${escapeHtml(row.cost)}</td>` : '<td class="num">—</td>';
  const decidedBy = row.decidedBy ? `<td>${escapeHtml(row.decidedBy)}</td>` : '<td>—</td>';
  const when = row.when ? `<td class="num">${escapeHtml(row.when)}</td>` : '<td class="num">—</td>';
  const status = row.caseId
    ? `<td><a href="/operator/cases/${encodeUri(row.caseId)}"><span class="badge tone-done">Done</span></a></td>`
    : `<td><span class="badge tone-done">Done</span></td>`;
  return `<tr${row.caseId ? ` data-case-id="${escapeHtml(row.caseId)}"` : ''}>
  <td><strong>${escapeHtml(row.travellerName)}</strong></td>
  <td>${escapeHtml(row.decision)}</td>
  ${cost}
  ${decidedBy}
  ${when}
  ${status}
</tr>`;
}

function emptyTableNote(message: string): string {
  return `<p class="empty-note">${escapeHtml(message)}</p>`;
}

export function renderDecisionsBody(view: DecisionsPageView): string {
  const pendingCount = view.pending.length;
  const decidedCount = view.decided.length;
  const pendingTable =
    pendingCount > 0
      ? `<div class="panel">
  <table class="traveller-table" data-ui-section="decisions-pending">
    <thead><tr><th>Traveller</th><th>Decision</th><th>Cost</th><th>Waiting on</th><th>Decide by</th><th>Age</th><th></th></tr></thead>
    <tbody>${view.pending.map(pendingRow).join('')}</tbody>
  </table>
</div>`
      : `<div class="panel" data-ui-section="decisions-pending">${emptyTableNote('Nothing is waiting on a person right now.')}</div>`;

  const decidedTable =
    decidedCount > 0
      ? `<div class="panel">
  <table class="traveller-table" data-ui-section="decisions-decided">
    <thead><tr><th>Traveller</th><th>Decision</th><th>Cost</th><th>Decided by</th><th>When</th><th></th></tr></thead>
    <tbody>${view.decided.map(decidedRow).join('')}</tbody>
  </table>
  <p class="footnote">Every waiting decision also appears on the overview and in the traveller's chat — nothing hides in this queue.</p>
</div>`
      : `<div class="panel" data-ui-section="decisions-decided">${emptyTableNote('No recent decisions to show yet.')}</div>`;

  const pendingCountClass = pendingCount > 0 ? 'count c-alert' : 'count';
  return `
<main class="shell" data-ui-screen="decisions">
  <div class="page-head">
    <h1>Decisions</h1>
    <p class="sub">Every place Northstar is waiting on a person — nothing waits silently.</p>
    <p class="meta">Generated ${escapeHtml(formatInstant(view.generatedAt))}</p>
  </div>

  <section class="section" aria-label="Waiting now">
    <h2>Waiting now <span class="${pendingCountClass}">${pendingCount}</span></h2>
    ${pendingTable}
  </section>

  <section class="section" aria-label="Decided recently">
    <h2>Decided recently <span class="count">${decidedCount}</span></h2>
    ${decidedTable}
  </section>
</main>`;
}

export function renderDecisions(envelope: ReadModelEnvelope<DecisionsPageView>): string {
  if (envelope.state === 'LOADING') {
    return `<main class="shell">${loadingPanel('Loading decisions', 'Gathering every place Northstar is waiting on a person.')}</main>`;
  }
  if (envelope.state === 'ERROR') {
    return `<main class="shell">${errorPanel('Decisions are unavailable right now', envelope.errorMessage)}</main>`;
  }
  if (!envelope.data) {
    return `<main class="shell">${errorPanel('Decisions are unavailable right now')}</main>`;
  }
  return renderDecisionsBody(envelope.data);
}

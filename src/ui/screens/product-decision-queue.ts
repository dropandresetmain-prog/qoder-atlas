/**
 * Decisions surface — "every place Northstar is waiting on a person".
 *
 * Renders the legacy Waiting-now table structure from a `DecisionsSurfaceView`
 * adapted from the v2 DecisionQueue. Whether a case waits on a person is the
 * backend's `awaitingAuthority` flag, never inferred here; cases Northstar is
 * still working on are listed separately and are not called decisions. Cost,
 * decide-by and decision history are shown only if the backend supplies them.
 */
import type { DecisionQueue } from '../../contracts/v2/product/readModels.ts';
import {
  adaptDecisionQueueToDecisionsPage,
  type DecisionsSurfaceView,
  type WorkingCaseRowView,
} from '../../app/target/adapters/decisionsAdapter.ts';
import { caseHref } from '../../app/target/productShell.ts';
import type { PendingDecisionRowView } from '../operator-surfaces-view-model.ts';
import { escapeHtml, formatInstant } from '../html.ts';

const DASH = '<td class="num">—</td>';

function pendingRow(row: PendingDecisionRowView): string {
  const cell = (value: string | undefined): string => (value ? `<td>${escapeHtml(value)}</td>` : DASH);
  return `<tr data-test="decision-row" data-case-ref="${escapeHtml(row.caseId)}">
  <td><strong>${escapeHtml(row.travellerName)}</strong></td>
  <td>${escapeHtml(row.decision)}</td>
  ${cell(row.cost)}
  ${cell(row.waitingOn)}
  ${cell(row.decideBy)}
  <td class="num">${escapeHtml(row.age ?? '—')}</td>
  <td><a href="${escapeHtml(caseHref(row.caseId))}" data-test="decision-link">Open case →</a></td>
</tr>`;
}

function workingRow(row: WorkingCaseRowView): string {
  return `<tr data-test="working-row" data-case-ref="${escapeHtml(row.caseId)}">
  <td><strong>${escapeHtml(row.travellerName)}</strong></td>
  <td>${escapeHtml(row.detail)}</td>
  <td><span class="badge tone-active">${escapeHtml(row.stage)}</span></td>
  <td class="num">${escapeHtml(row.age ?? '—')}</td>
  <td><a href="${escapeHtml(caseHref(row.caseId))}" data-test="decision-link">Open case →</a></td>
</tr>`;
}

function recentRow(row: NonNullable<DecisionQueue['recentDecisions']>[number]): string {
  const decision = row.kind === 'approval' ? 'Approved' : 'Revoked';
  const caseCell = row.caseRef
    ? `<a href="${escapeHtml(caseHref(row.caseRef))}" data-test="recent-decision-link">Open case →</a>`
    : '—';
  return `<tr data-test="recent-decision-row"${row.caseRef ? ` data-case-ref="${escapeHtml(row.caseRef)}"` : ''}>
  <td><strong>${escapeHtml(row.label)}</strong></td>
  <td><span class="badge tone-done">${decision}</span></td>
  <td>${escapeHtml(row.actorLabel)}</td>
  <td class="num">${escapeHtml(formatInstant(row.decisionAt))}</td>
  <td>${caseCell}</td>
</tr>`;
}

export function renderDecisionsSurface(view: DecisionsSurfaceView): string {
  const waiting = view.pending.length > 0
    ? `<div class="panel">
  <table class="traveller-table" data-test="decision-queue">
    <thead><tr><th>Traveller</th><th>Decision</th><th>Cost</th><th>Waiting on</th><th>Decide by</th><th>Age</th><th></th></tr></thead>
    <tbody>${view.pending.map(pendingRow).join('')}</tbody>
  </table>
</div>`
    : '<div class="panel"><p class="empty-note">Nothing is waiting on a person right now.</p></div>';
  const working = view.working.length > 0
    ? `
  <section class="section" aria-label="Northstar is working on" data-poll-region="decisions-working">
    <h2>Northstar is working on <span class="count">${view.working.length}</span></h2>
    <div class="panel">
      <table class="traveller-table" data-test="working-cases">
        <thead><tr><th>Traveller</th><th>What is happening</th><th>Stage</th><th>Age</th><th></th></tr></thead>
        <tbody>${view.working.map(workingRow).join('')}</tbody>
      </table>
      <p class="footnote">These cases do not need a person yet. They move to “Waiting now” if approval is needed.</p>
    </div>
    </section>`
    : '';
  const recent = view.recent.length > 0
    ? `<div class="panel">
  <table class="traveller-table" data-test="recent-decisions">
    <thead><tr><th>Change</th><th>Decision</th><th>Decided by</th><th>When</th><th></th></tr></thead>
    <tbody>${view.recent.map(recentRow).join('')}</tbody>
  </table>
</div>`
    : '<div class="panel"><p class="empty-note">No recent decisions to show yet.</p></div>';
  const pendingCountClass = view.pending.length > 0 ? 'count c-alert' : 'count';
  return `
<main class="shell product-decision-queue" data-test="product-decision-queue" data-ui-screen="decisions">
  <div class="page-head">
    <h1>Decisions</h1>
    <p class="sub">Every place Northstar is waiting on a person — nothing waits silently.</p>
    <p class="meta">Generated ${escapeHtml(formatInstant(view.generatedAt))}</p>
  </div>
  <section class="section" aria-label="Waiting now" data-poll-region="decisions-waiting">
    <h2>Waiting now <span class="${pendingCountClass}">${view.pending.length}</span></h2>
    ${waiting}
  </section>
  <section class="section" aria-label="Decided recently" data-poll-region="decisions-recent">
    <h2>Decided recently <span class="count">${view.recent.length}</span></h2>
    ${recent}
  </section>${working}
</main>`;
}

export function renderProductDecisionQueue(view: DecisionQueue): string {
  return renderDecisionsSurface(adaptDecisionQueueToDecisionsPage(view));
}

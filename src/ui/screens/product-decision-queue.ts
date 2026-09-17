/**
 * Decisions surface — the recovery cases whose own lifecycle says they are
 * waiting on an operator.
 *
 * `awaitingAuthority` is a supplied backend flag, never inferred from status
 * text here, and an empty queue is rendered as an empty queue: a baseline
 * world with no disruption has nothing to decide.
 */
import type { DecisionQueue } from '../../contracts/v2/product/readModels.ts';
import { escapeHtml, formatInstant } from '../html.ts';

function row(decision: DecisionQueue['decisions'][number]): string {
  const who = decision.subjectLabels.length > 0
    ? escapeHtml(decision.subjectLabels.join(' · '))
    : '<span class="b-extra">No traveller subjects attached</span>';
  const glyph = decision.awaitingAuthority
    ? '<span class="q-glyph g-bad" aria-hidden="true">✕</span>'
    : '<span class="q-glyph g-active" aria-hidden="true">…</span>';
  return `
    <div class="qrow" data-test="decision-row" data-case-ref="${escapeHtml(decision.caseRef)}">
      ${glyph}
      <div>
        <div class="q-name">${who}</div>
        <div class="q-issue">Opened ${escapeHtml(decision.openedAtLabel)}</div>
      </div>
      <div class="b-right">
        <span class="badge tone-${decision.awaitingAuthority ? 'alert' : 'active'}">${escapeHtml(decision.status)}</span>
      </div>
    </div>`;
}

export function renderProductDecisionQueue(view: DecisionQueue): string {
  const awaiting = view.decisions.filter((decision) => decision.awaitingAuthority).length;
  const body = view.decisions.length > 0
    ? `<div class="queue" data-test="decision-queue">${view.decisions.map(row).join('')}</div>`
    : '<p class="empty-note">Nothing is waiting on a decision.</p>';
  return `
<main class="shell product-decision-queue" data-test="product-decision-queue">
  <div class="page-head">
    <h1>Decisions</h1>
    <p class="sub">Recovery work that cannot continue until an operator approves it.</p>
    <p class="meta">Generated ${escapeHtml(formatInstant(view.generatedAt))}</p>
  </div>
  ${awaiting > 0 ? `<div class="callout tone-alert" data-test="decisions-awaiting"><p class="callout-title">${awaiting} awaiting authority</p></div>` : ''}
  <section class="section" aria-label="Open cases">
    <h2>Open cases <span class="count">${view.decisions.length}</span></h2>
    ${body}
  </section>
</main>`;
}

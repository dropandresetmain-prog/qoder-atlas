/**
 * E2 — recovery case / trip detail (operator).
 *
 * Renders the full recovery narrative from the UI-local CaseDetailView:
 * what changed, what is affected downstream, the critical objective at
 * risk, what was checked, the options compared (including a rejected
 * attractive option with its reason), the approval requirement, current
 * action state, and the final recovered/resolved result.
 *
 * Pure function of typed data; malformed views are refused, not guessed.
 */
import type { ReadModelEnvelope } from '../../contracts/readmodels.ts';
import { OPTION_VERDICT_LABEL, STATUS_TONE } from '../copy.ts';
import { escapeHtml, formatCostDelta, formatInstant, formatMoney } from '../html.ts';
import {
  errorPanel,
  iconList,
  loadingPanel,
  optionalSection,
  statusBadge,
  toneClass,
  uncertaintyList,
  type IconRow,
} from '../components.ts';
import {
  caseDetailViewIssues,
  type ActionProgressView,
  type ApprovalRequirementView,
  type CaseCheckView,
  type CaseDetailView,
  type CaseResolutionView,
  type ChainLinkView,
  type RecoveryOptionView,
} from '../case-view-model.ts';

export const CASE_STEPS = [
  'Change detected',
  'Impact reviewed',
  'Options compared',
  'Decision & approval',
  'Plan in motion',
  'Trip confirmed',
] as const;

/**
 * Derive the current step from evidence in the view only. Returns
 * CASE_STEPS.length when fully confirmed, or undefined when progress
 * cannot honestly be shown (UNKNOWN).
 */
export function deriveStepIndex(view: CaseDetailView): number | undefined {
  if (view.status === 'UNKNOWN') return undefined;
  if (view.resolution !== undefined || view.status === 'RESOLVED') return CASE_STEPS.length;
  if (view.actions.some((action) => action.state === 'IN_PROGRESS' || action.state === 'DONE')) return 4;
  if (view.approval?.state === 'PENDING') return 3;
  if (view.options.length > 0) return 3;
  if (view.affectedItems.length > 0) return 1;
  if (view.whatChanged) return 0;
  return undefined;
}

function stepper(view: CaseDetailView): string {
  const current = deriveStepIndex(view);
  if (current === undefined) return '';
  const steps = CASE_STEPS.map((label, index) => {
    const cls = index < current ? 'step is-done' : index === current ? 'step is-current' : 'step';
    return `<div class="${cls}">${escapeHtml(label)}</div>`;
  }).join('');
  return `<div class="stepper" aria-label="Recovery progress">${steps}</div>`;
}

const CHECK_ICONS: Record<CaseCheckView['result'], { icon: string; iconClass: string }> = {
  PASS: { icon: '✓', iconClass: 'ic-pass' },
  FAIL: { icon: '✕', iconClass: 'ic-fail' },
  UNKNOWN: { icon: '?', iconClass: 'ic-unknown' },
};

// ---------------------------------------------------------------------------
// Journey chain — the trip as a chain of dependent components (DESIGN.md §4.2)
// ---------------------------------------------------------------------------

/** Visual state per link. Green is healthy, grey is missing/unverified. */
const CHAIN_LINK_STYLE: Record<ChainLinkView['state'], { cls: string; glyph: string; word: string }> = {
  CONFIRMED: { cls: 'st-confirmed', glyph: '✓', word: 'Confirmed' },
  PROPOSED: { cls: 'st-proposed', glyph: '◌', word: 'Proposed' },
  BROKEN: { cls: 'st-broken', glyph: '✕', word: 'Broken' },
  UNBOOKED: { cls: 'st-unbooked', glyph: '○', word: 'Not booked' },
  UNKNOWN: { cls: 'st-unknown', glyph: '?', word: 'Unconfirmed' },
  AT_RISK: { cls: 'st-atrisk', glyph: '▲', word: 'At risk' },
};

function chainLink(link: ChainLinkView): string {
  const style = CHAIN_LINK_STYLE[link.state];
  const glyph = link.commitment ? '✦' : style.glyph;
  const detail = link.detail ? `<div class="l-detail">${escapeHtml(link.detail)}</div>` : '';
  return `
  <div class="link ${style.cls}${link.commitment ? ' is-commitment' : ''}" data-link-state="${escapeHtml(link.state)}">
    <div class="l-kind"><span class="l-glyph" aria-hidden="true">${glyph}</span>${escapeHtml(link.kind)}</div>
    <div class="l-name">${escapeHtml(link.label)}</div>
    ${detail}
    <div class="l-state">${escapeHtml(style.word)}</div>
  </div>`;
}

/** The chain section; omitted entirely when the projection has no chain. */
function chainSection(chain: readonly ChainLinkView[] | undefined): string | undefined {
  if (!chain || chain.length === 0) return undefined;
  return `<div class="chain" role="list" aria-label="The trip as a chain of dependent parts">${chain.map(chainLink).join('')}</div>`;
}

function checksSection(checks: readonly CaseCheckView[]): string | undefined {
  if (checks.length === 0) return undefined;
  const rows: IconRow[] = checks.map((check) => ({
    ...CHECK_ICONS[check.result],
    text: check.label,
  }));
  return `<div class="panel">${iconList(rows)}
    <p class="choice-note">Checked against the fixed parts of the trip (event times, bookings, and policy limits).</p>
  </div>`;
}

const VERDICT_TONE: Record<RecoveryOptionView['verdict'], 'ok' | 'alert' | 'neutral'> = {
  VIABLE: 'ok',
  NOT_VIABLE: 'alert',
  UNKNOWN: 'neutral',
};

function optionCard(option: RecoveryOptionView): string {
  const classes = [
    'option-card',
    option.recommended ? 'is-recommended' : '',
    option.verdict === 'NOT_VIABLE' ? 'is-rejected' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const recommended = option.recommended ? '<span class="chip">Recommended</span>' : '';
  const verdict = `<span class="${toneClass(VERDICT_TONE[option.verdict], 'badge')}">${escapeHtml(OPTION_VERDICT_LABEL[option.verdict])}</span>`;
  const summary = option.summary ? `<p class="option-summary">${escapeHtml(option.summary)}</p>` : '';
  const cost = option.costDelta
    ? (() => {
        const delta = formatCostDelta(option.costDelta);
        return `<span class="chip ${delta.kind === 'saving' ? 'chip-saving' : 'chip-extra'}">${escapeHtml(delta.text)}</span>`;
      })()
    : '';
  const approval = option.requiresApproval ? '<span class="chip">Needs approval</span>' : '';
  const allocation = option.costAllocationSummary
    ? `<span class="chip">${escapeHtml(option.costAllocationSummary)}</span>`
    : '';
  const rejection = option.rejectionReason
    ? `<p class="rejection"><strong>Why not:</strong> ${escapeHtml(option.rejectionReason)}</p>`
    : '';
  return `
  <div class="${classes}" data-option-id="${escapeHtml(option.id)}" data-verdict="${escapeHtml(option.verdict)}">
    <div class="option-head">
      <h3 class="option-title">${escapeHtml(option.title)}</h3>
      ${recommended}
      ${verdict}
    </div>
    ${summary}
    <div class="option-meta">${cost}${approval}${allocation}</div>
    ${rejection}
  </div>`;
}

const APPROVAL_STATE_TONE: Record<ApprovalRequirementView['state'], 'watch' | 'ok' | 'alert'> = {
  PENDING: 'watch',
  APPROVED: 'ok',
  DECLINED: 'alert',
};

const APPROVAL_STATE_LABEL: Record<ApprovalRequirementView['state'], string> = {
  PENDING: 'Waiting',
  APPROVED: 'Approved',
  DECLINED: 'Declined',
};

function approvalPanel(approval?: ApprovalRequirementView): string | undefined {
  if (!approval) return undefined;
  const from = approval.requestedFrom === 'ORGANISATION' ? 'the organisation' : 'the traveller';
  const amount = approval.amount ? ` Amount: <strong>${escapeHtml(formatMoney(approval.amount))}</strong>.` : '';
  return `
  <div class="panel callout tone-${APPROVAL_STATE_TONE[approval.state]}" data-approval-state="${escapeHtml(approval.state)}">
    <p class="callout-title">Approval needed from ${escapeHtml(from)}</p>
    <p>${escapeHtml(approval.reason)}${amount}
      <span class="${toneClass(APPROVAL_STATE_TONE[approval.state], 'badge')}">${escapeHtml(APPROVAL_STATE_LABEL[approval.state])}</span>
    </p>
  </div>`;
}

const ACTION_ICONS: Record<ActionProgressView['state'], { icon: string; iconClass: string; label: string }> = {
  QUEUED: { icon: '○', iconClass: 'ic-queue', label: 'Queued' },
  IN_PROGRESS: { icon: '▶', iconClass: 'ic-progress', label: 'In progress' },
  DONE: { icon: '✓', iconClass: 'ic-pass', label: 'Done' },
  FAILED: { icon: '✕', iconClass: 'ic-fail', label: 'Failed' },
};

function actionsSection(actions: readonly ActionProgressView[]): string | undefined {
  if (actions.length === 0) return undefined;
  const rows: IconRow[] = actions.map((action) => ({
    ...ACTION_ICONS[action.state],
    text: `${action.label} — ${ACTION_ICONS[action.state].label}`,
  }));
  return `<div class="panel">${iconList(rows)}</div>`;
}

function resolutionPanel(resolution?: CaseResolutionView): string | undefined {
  if (!resolution) return undefined;
  if (resolution.outcome === 'FULLY_RECOVERED') {
    return `
    <div class="resolution is-full" data-outcome="FULLY_RECOVERED">
      <p class="res-title">Trip recovered</p>
      <p>${escapeHtml(resolution.summary)}</p>
    </div>`;
  }
  if (resolution.outcome === 'RECOVERED_WITH_LOSS') {
    const losses = (resolution.remainingLosses ?? [])
      .map((loss) => `<li>${escapeHtml(loss)}</li>`)
      .join('');
    return `
    <div class="resolution is-loss" data-outcome="RECOVERED_WITH_LOSS">
      <p class="res-title">Trip recovered — with a loss</p>
      <p>${escapeHtml(resolution.summary)}</p>
      ${losses ? `<p><strong>Could not be kept:</strong></p><ul>${losses}</ul>` : ''}
    </div>`;
  }
  return `
  <div class="resolution is-escalated" data-outcome="ESCALATED_CLOSED">
    <p class="res-title">Closed with direct support</p>
    <p>${escapeHtml(resolution.summary)}</p>
  </div>`;
}

/** Case detail body from a loaded, validated view. */
export function renderCaseDetailBody(view: CaseDetailView): string {
  const issues = caseDetailViewIssues(view);
  if (issues.length > 0) {
    return `<main class="shell">${errorPanel('This case cannot be displayed yet', issues.join('; '))}</main>`;
  }
  const tone = STATUS_TONE[view.status];
  const changed = view.whatChanged
    ? `<div class="${toneClass(tone, 'callout')}"><p class="callout-title">What changed</p><p>${escapeHtml(view.whatChanged)}</p></div>`
    : '';
  const critical = view.criticalObjectiveAtRisk
    ? `<div class="callout tone-alert"><p class="callout-title">Must not be missed</p><p>${escapeHtml(view.criticalObjectiveAtRisk)}</p></div>`
    : '';
  return `
<main class="shell">
  <div class="page-head">
    <h1>${escapeHtml(view.tripLabel ?? view.tripId)}</h1>
    <p class="sub">${escapeHtml(view.travellerNames.join(', '))}</p>
    <p class="meta">${statusBadge(view.status)} &nbsp; Updated ${escapeHtml(formatInstant(view.updatedAt))}</p>
  </div>
  ${stepper(view)}
  ${changed}
  ${optionalSection('The trip as it stands', chainSection(view.chain))}
  ${optionalSection(
    'What is affected',
    view.affectedItems.length > 0
      ? `<div class="panel"><ul class="plain-list">${view.affectedItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>${critical}`
      : critical || undefined,
  )}
  ${optionalSection('What we checked', checksSection(view.checks))}
  ${optionalSection(
    'Options on the table',
    view.options.length > 0 ? view.options.map(optionCard).join('') : undefined,
  )}
  ${optionalSection('Approval', approvalPanel(view.approval))}
  ${optionalSection('What is happening now', actionsSection(view.actions))}
  ${uncertaintyList(view.uncertainties)}
  ${optionalSection('Result', resolutionPanel(view.resolution))}
</main>`;
}

/** Full case screen from an envelope; honest about loading/error. */
export function renderCaseDetail(envelope: ReadModelEnvelope<CaseDetailView>): string {
  if (envelope.state === 'LOADING') {
    return `<main class="shell">${loadingPanel('Opening the case', 'We are loading the latest confirmed details.')}</main>`;
  }
  if (envelope.state === 'ERROR') {
    return `<main class="shell">${errorPanel('The case details are unavailable right now', envelope.errorMessage)}</main>`;
  }
  if (!envelope.data) {
    return `<main class="shell">${errorPanel('The case details are unavailable right now')}</main>`;
  }
  return renderCaseDetailBody(envelope.data);
}

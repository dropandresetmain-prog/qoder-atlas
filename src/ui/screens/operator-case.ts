/**
 * E2 — recovery case / trip detail (operator), approved C1–C6 layout.
 *
 * Two-column workspace: the main column tells the recovery narrative (lead
 * callout, journey chain as state cards, impact list, staged activity rows,
 * option cards with honest rejections, approval ask with funding split,
 * resolution); the sticky rail carries the ink commitment card, projected
 * case-fact sections, and the standing authority explainer.
 *
 * Pure function of typed data; malformed views are refused, not guessed.
 * Every optional block renders only when the projection supplies it.
 */
import type { ReadModelEnvelope } from '../../contracts/readmodels.ts';
import {
  CASE_ACTIVITY_DONE_TITLE,
  CASE_ACTIVITY_TITLE,
  CASE_APPROVAL_TITLE,
  CASE_AUTHORITY_COPY,
  CASE_AUTHORITY_TITLE,
  CASE_BADGE_APPROVAL_NEEDED,
  CASE_BADGE_HUMAN_DECISION,
  CASE_BADGE_OPTIONS_READY,
  CASE_CHECKS_TITLE,
  CASE_COMMITMENT_AT_STAKE_LABEL,
  CASE_COMMITMENT_FALLBACK_TITLE,
  CASE_COMMITMENT_HELD_LABEL,
  CASE_EXHAUSTED_TITLE,
  CASE_OPTIONS_ALL_REJECTED_TITLE,
  CASE_OPTIONS_FORMING_NOTE,
  CASE_OPTIONS_FORMING_TITLE,
  CASE_WAITING_DECISION_TITLE,
  CASE_WHAT_CHANGED_TITLE,
  CASE_WHAT_HAPPENED_TITLE,
  CASE_DOWNSTREAM_IMPACT_TITLE,
  CASE_STATUS_TIMELINE_TITLE,
  CASE_SELECTED_RECOVERY_TITLE,
  OPTION_VERDICT_LABEL,
  PAYER_LABEL,
  RESOLUTION_OUTCOME_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  authorityNeededLabel,
  caseOptionsHeading,
  type StatusTone,
} from '../copy.ts';
import { escapeHtml, formatCostDelta, formatInstant, formatMoney, formatPayable, formatPolicyEquivalent } from '../html.ts';
import { CASE_PRIMARY_OPTION_LIMIT } from '../presentationState.ts';
import {
  isProgrammeRecoveryFlow,
  selectCaseWorkspacePhase,
  shouldShowBeginCta,
  shouldShowExecuteCta,
  shouldShowOptionsPanel,
  shouldShowProgrammeChangeCta,
  shouldShowResolveCta,
} from '../caseLifecycle.ts';
import {
  chainLinkGlyph,
  errorPanel,
  loadingPanel,
  optionalSection,
  toneClass,
  uncertaintyList,
} from '../components.ts';
import {
  caseDetailViewIssues,
  type ActionProgressState,
  type AffectedItemView,
  type ApprovalRequirementView,
  type CaseCheckView,
  type CaseDetailView,
  type CaseRailSectionView,
  type CaseResolutionView,
  type ChainLinkView,
  type RecoveryOptionView,
  type StatusTimelineEntryView,
} from '../case-view-model.ts';

/** Approved recovery-progress steps (C2). */
export const CASE_STEPS = [
  'Trip change received',
  'Trip re-checked',
  'Recovery options compared',
  'Policy and approval checked',
  'Recommendation ready',
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
  if (view.options.length > 0) return 2;
  if (view.status === 'RECOVERING' || view.status === 'PLANNING') return 2;
  if (view.affectedItems.length > 0 || (view.affected?.length ?? 0) > 0 || view.checks.length > 0) return 1;
  if (view.whatChanged) return 0;
  return undefined;
}

/**
 * The stepper belongs to the in-flight "checking" state (approved C2):
 * recovery is under way but no option, decision, or resolution exists yet.
 */
function stepper(view: CaseDetailView): string {
  if (view.status !== 'RECOVERING' && view.status !== 'PLANNING') return '';
  if (view.options.length > 0 || view.approval?.state === 'PENDING' || view.resolution) return '';
  const current = deriveStepIndex(view);
  if (current === undefined) return '';
  const steps = CASE_STEPS.map((label, index) => {
    const cls = index < current ? 'step done' : index === current ? 'step current' : 'step';
    const line = index < CASE_STEPS.length - 1 ? '<span class="s-line"></span>' : '';
    return `<div class="${cls}"><span class="s-dot"></span><span class="s-label">${escapeHtml(label)}</span>${line}</div>`;
  }).join('');
  return `<div class="stepper" aria-label="Recovery progress">${steps}</div>`;
}

// ---------------------------------------------------------------------------
// Page-head badge — derived from case evidence, never asserted (C1–C6).
// ---------------------------------------------------------------------------

function caseBadge(view: CaseDetailView): { label: string; tone: StatusTone } {
  if (view.resolution?.outcome === 'ESCALATED_CLOSED') {
    return { label: CASE_BADGE_HUMAN_DECISION, tone: 'alert' };
  }
  if (view.resolution || view.status === 'RESOLVED') {
    return { label: STATUS_LABEL.RESOLVED, tone: STATUS_TONE.RESOLVED };
  }
  if (shouldShowExecuteCta(view) || selectCaseWorkspacePhase(view) === 'executing') {
    return { label: STATUS_LABEL.RECOVERING, tone: STATUS_TONE.RECOVERING };
  }
  if (view.approval?.state === 'PENDING') {
    if (view.approval.requestedFrom === 'TRAVELLER') {
      const who = view.travellerNames[0]?.trim() || 'traveller';
      return { label: `Waiting for ${who}`, tone: 'watch' };
    }
    // ORGANISATION and HUMAN_AGENT are both awaiting-authority — never
    // "Options on the table" once a proposal is staged for approval.
    return { label: CASE_BADGE_APPROVAL_NEEDED, tone: 'watch' };
  }
  if (!view.resolution && view.options.length > 0 && view.status === 'RECOVERING') {
    return { label: CASE_BADGE_OPTIONS_READY, tone: 'watch' };
  }
  return { label: STATUS_LABEL[view.status], tone: STATUS_TONE[view.status] };
}

// ---------------------------------------------------------------------------
// Journey chain — the trip as a chain of dependent components (DESIGN.md §4.2)
// ---------------------------------------------------------------------------

/** Visual state per link. Green is healthy, grey is missing/unverified. */
const CHAIN_LINK_STYLE: Record<ChainLinkView['state'], { cls: string; word: string }> = {
  CONFIRMED: { cls: 'st-confirmed', word: 'Confirmed' },
  PROPOSED: { cls: 'st-proposed', word: 'Proposed' },
  BROKEN: { cls: 'st-broken', word: 'Impacted' },
  UNBOOKED: { cls: 'st-unbooked', word: 'Not booked' },
  UNKNOWN: { cls: 'st-unknown', word: 'Details pending' },
  AT_RISK: { cls: 'st-atrisk', word: 'At risk' },
};

function unknownStateWord(link: ChainLinkView): string {
  const kind = link.kind.toLowerCase();
  if (kind.includes('transfer') || kind.includes('taxi') || kind.includes('ground')) {
    return 'Transfer confirmation pending';
  }
  if (kind.includes('stay') || kind.includes('hotel')) return 'Hotel confirmation pending';
  if (kind.includes('flight')) return 'Flight status pending';
  if (link.detail && /pending|unconfirmed|unknown|awaiting/i.test(link.detail)) {
    return link.detail.length < 48 ? link.detail : 'Confirmation pending';
  }
  return 'Details pending';
}

function chainLink(link: ChainLinkView): string {
  const style = CHAIN_LINK_STYLE[link.state];
  const isCommitment = Boolean(link.commitment) || link.kind.toLowerCase() === 'commitment';
  let word = link.stateLabel ?? (link.state === 'UNKNOWN' ? unknownStateWord(link) : style.word);
  if (isCommitment) {
    // Programme engagements are not bookings — never "Not booked" / "Details pending".
    if (link.state === 'UNBOOKED' || link.state === 'CONFIRMED' || link.state === 'UNKNOWN') word = 'Scheduled';
    else if (link.state === 'PROPOSED') word = 'Preserved';
    else if (link.state === 'AT_RISK') word = 'At risk';
    else if (link.state === 'BROKEN') word = 'Impacted';
  }
  const detail = link.detail ? `<div class="lk-detail">${escapeHtml(link.detail)}</div>` : '';
  return `
  <div class="link ${style.cls}${link.commitment ? ' is-commitment' : ''}" data-link-state="${escapeHtml(link.state)}">
    <div class="lk-kind"><span class="lk-g" aria-hidden="true">${chainLinkGlyph(link)}</span>${escapeHtml(link.kind)}</div>
    <div class="lk-label">${escapeHtml(sanitizeUserFacingLabel(link.label))}</div>
    ${detail}
    <div class="lk-state">${escapeHtml(word)}</div>
  </div>`;
}

/** Strip internal place/hotel identifiers from labels before render. */
function sanitizeUserFacingLabel(label: string): string {
  if (/place-hotel-|place-[a-z0-9-]+/i.test(label)) {
    return label.replace(/place-hotel-[a-z0-9-]+/gi, 'Hotel').replace(/place-[a-z0-9-]+/gi, 'Place');
  }
  return label;
}

/** The chain section; omitted entirely when the projection has no chain. */
function chainSection(chain: readonly ChainLinkView[] | undefined): string | undefined {
  if (!chain || chain.length === 0) return undefined;
  return `<div class="chain" role="list" aria-label="The trip as a chain of dependent parts">${chain.map(chainLink).join('')}</div>`;
}

// ---------------------------------------------------------------------------
// Lead callout — resolution, waiting-on-decision, exhausted, or what changed.
// ---------------------------------------------------------------------------

const RESOLUTION_TONE: Record<CaseResolutionView['outcome'], StatusTone> = {
  FULLY_RECOVERED: 'ok',
  RECOVERED_WITH_LOSS: 'watch',
  ESCALATED_CLOSED: 'alert',
};

function resolutionCallout(resolution: CaseResolutionView): string {
  // G3R-Closure fix H: every visible word comes from the deterministic
  // presentation map; the raw outcome enum stays in the data-* attribute
  // (machine state for audit/debug wiring), never in user copy.
  const losses = (resolution.remainingLosses ?? [])
    .map((loss) => `<li>${escapeHtml(loss)}</li>`)
    .join('');
  const lossBlock = losses
    ? `<p><strong>Could not be kept:</strong></p><ul>${losses}</ul>`
    : '';
  return `
  <div class="${toneClass(RESOLUTION_TONE[resolution.outcome], 'callout')}" data-outcome="${escapeHtml(resolution.outcome)}">
    <h3>${escapeHtml(RESOLUTION_OUTCOME_LABEL[resolution.outcome])}</h3>
    <p>${escapeHtml(resolution.summary)}</p>
    ${lossBlock}
  </div>`;
}

function leadCallout(view: CaseDetailView): string {
  if (view.resolution) return resolutionCallout(view.resolution);
  if (view.approval?.state === 'PENDING') {
    const amount = view.approval.amount
      ? ` Amount: <strong>${escapeHtml(formatMoney(view.approval.amount))}</strong>.`
      : '';
    const context = view.whatChanged ? `${escapeHtml(view.whatChanged)} ` : '';
    return `
    <div class="waiting-decision-block" data-test="waiting-decision-block">
      <h3>${escapeHtml(CASE_WAITING_DECISION_TITLE)}</h3>
      <p>${context}${escapeHtml(view.approval.reason)}${amount}</p>
    </div>`;
  }
  if (view.planningExhausted) {
    const body = view.whatChanged ? `<p>${escapeHtml(view.whatChanged)}</p>` : '';
    return `
    <div class="callout tone-alert">
      <h3>${escapeHtml(CASE_EXHAUSTED_TITLE)}</h3>
      ${body}
    </div>`;
  }
  if (view.whatChanged) {
    return `
    <div class="${toneClass(STATUS_TONE[view.status], 'callout')}" data-test="what-happened-block">
      <h3>${escapeHtml(CASE_WHAT_HAPPENED_TITLE)}</h3>
      <p>${escapeHtml(view.whatChanged)}</p>
    </div>`;
  }
  return '';
}

// ---------------------------------------------------------------------------
// Status timeline — progressive evidence when multiple signals exist (Pass 2).
// ---------------------------------------------------------------------------

const TIMELINE_TONE: Record<NonNullable<StatusTimelineEntryView['tone']>, string> = {
  neutral: 'tone-neutral',
  watch: 'tone-watch',
  alert: 'tone-alert',
  ok: 'tone-ok',
};

function statusTimelineSection(view: CaseDetailView): string {
  const timeline = view.statusTimeline;
  if (!timeline || timeline.length === 0) return '';
  const rows = timeline
    .map((entry) => {
      const tone = TIMELINE_TONE[entry.tone ?? 'neutral'];
      const when = entry.at ? `<time class="status-tl-at" datetime="${escapeHtml(entry.at)}">${escapeHtml(formatInstant(entry.at))}</time>` : '';
      const detail = entry.detail ? `<p class="status-tl-detail">${escapeHtml(entry.detail)}</p>` : '';
      return `
      <li class="status-tl-row ${tone}" data-test="status-timeline-entry">
        ${when}
        <p class="status-tl-label">${escapeHtml(entry.label)}</p>
        ${detail}
      </li>`;
    })
    .join('');
  return `
  <section class="section" aria-label="${escapeHtml(CASE_STATUS_TIMELINE_TITLE)}" data-test="status-timeline">
    <h2>${escapeHtml(CASE_STATUS_TIMELINE_TITLE)}</h2>
    <ol class="status-timeline">${rows}</ol>
  </section>`;
}

// ---------------------------------------------------------------------------
// Impact — "What this affects" (Pass 2). Rich per-item states when the
// projection supplies them; the plain string list is the honest fallback.
// ---------------------------------------------------------------------------

/**
 * Resolved cases keep an explicit change record under the resolution callout
 * (approved C6 "What changed" section).
 */
function resolvedChangeSection(view: CaseDetailView): string {
  if (!view.resolution || !view.whatChanged) return '';
  return `
  <section class="section" aria-label="${escapeHtml(CASE_WHAT_CHANGED_TITLE)}">
    <h2>${escapeHtml(CASE_WHAT_CHANGED_TITLE)}</h2>
    <div class="panel"><p>${escapeHtml(view.whatChanged)}</p></div>
  </section>`;
}

const AFFECTED_ICON: Record<AffectedItemView['state'], { icon: string; iconClass: string }> = {
  BROKEN: { icon: '✕', iconClass: 'ic-fail' },
  AT_RISK: { icon: '▲', iconClass: 'ic-watch' },
  UNKNOWN: { icon: '?', iconClass: 'ic-unknown' },
  INTACT: { icon: '✓', iconClass: 'ic-pass' },
};

function affectedSection(view: CaseDetailView): string {
  const rich = view.affected && view.affected.length > 0;
  const plain = view.affectedItems.length > 0;
  // The commitment callout falls back inline only when no structured rail
  // card exists — otherwise the ink rail card carries it (no duplication).
  const critical =
    !view.commitment && view.criticalObjectiveAtRisk
      ? `<div class="callout tone-alert"><p class="callout-title">${escapeHtml(CASE_COMMITMENT_FALLBACK_TITLE)}</p><p>${escapeHtml(view.criticalObjectiveAtRisk)}</p></div>`
      : '';
  if (!rich && !plain) return critical;
  const list = rich
    ? `<ul class="icon-list">${view.affected!
        .map((item) => {
          const style = AFFECTED_ICON[item.state];
          const detail = item.detail ? ` — ${escapeHtml(item.detail)}` : '';
          return `<li><span class="ic ${style.iconClass}" aria-hidden="true">${style.icon}</span><span><strong>${escapeHtml(item.label)}</strong>${detail}</span></li>`;
        })
        .join('')}</ul>`
    : `<ul class="plain-list">${view.affectedItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
  return `
  <section class="section" aria-label="${escapeHtml(CASE_DOWNSTREAM_IMPACT_TITLE)}" data-test="downstream-impact">
    <h2>${escapeHtml(CASE_DOWNSTREAM_IMPACT_TITLE)}</h2>
    <div class="panel">${list}</div>
    ${critical}
  </section>`;
}

// ---------------------------------------------------------------------------
// Staged activity — "What Northstar is doing right now" (approved C2 rows).
// ---------------------------------------------------------------------------

const ACTION_ROW: Record<ActionProgressState, { cls: string; icon: string }> = {
  DONE: { cls: 'done', icon: '✓' },
  IN_PROGRESS: { cls: 'doing', icon: '⟳' },
  QUEUED: { cls: 'queued', icon: '○' },
  FAILED: { cls: 'failed', icon: '✕' },
};

function activitySection(view: CaseDetailView): string {
  if (view.actions.length === 0) return '';
  const phase = selectCaseWorkspacePhase(view);
  // Do not leak recommended flight/strategy titles before Begin / authority.
  const revealRecommendationDetail =
    phase === 'awaiting_authority' ||
    phase === 'execute' ||
    phase === 'executing' ||
    phase === 'resolved' ||
    view.approval?.state === 'APPROVED' ||
    view.approval?.state === 'PENDING';
  const rows = view.actions
    .map((action) => {
      const style = ACTION_ROW[action.state];
      const detail =
        revealRecommendationDetail || !action.detail
          ? action.detail
          : undefined;
      const sub = detail ? `<span class="c-sub">${escapeHtml(detail)}</span>` : '';
      return `<div class="check-row ${style.cls}"><span class="c-ic">${style.icon}</span><span class="c-t">${escapeHtml(action.label)}</span>${sub}</div>`;
    })
    .join('');
  const allDone = view.actions.every((action) => action.state === 'DONE');
  const title = allDone ? CASE_ACTIVITY_DONE_TITLE : CASE_ACTIVITY_TITLE;
  return `
  <section class="section" aria-label="${escapeHtml(title)}">
    <h2>${escapeHtml(title)}</h2>
    <div class="panel">${rows}</div>
  </section>`;
}

// ---------------------------------------------------------------------------
// Checks already run (approved C1) — the deterministic evidence list.
// ---------------------------------------------------------------------------

const CHECK_ICONS: Record<CaseCheckView['result'], { icon: string; iconClass: string }> = {
  PASS: { icon: '✓', iconClass: 'ic-pass' },
  FAIL: { icon: '✕', iconClass: 'ic-fail' },
  UNKNOWN: { icon: '?', iconClass: 'ic-unknown' },
};

function checksSection(checks: readonly CaseCheckView[]): string {
  if (checks.length === 0) return '';
  const rows = [...new Map(checks.map((check) => [`${check.result}:${check.label}`, check])).values()]
    .map((check) => {
      const style = CHECK_ICONS[check.result];
      return `<li><span class="ic ${style.iconClass}" aria-hidden="true">${style.icon}</span><span>${escapeHtml(check.label)}</span></li>`;
    })
    .join('');
  return `
  <section class="section" aria-label="${escapeHtml(CASE_CHECKS_TITLE)}">
    <h2>${escapeHtml(CASE_CHECKS_TITLE)}</h2>
    <div class="panel">
      <ul class="icon-list">${rows}</ul>
      <p class="footnote">Checked against the fixed parts of the trip (event times, bookings, and policy limits).</p>
    </div>
  </section>`;
}

// ---------------------------------------------------------------------------
// Options (approved C3/C5) — cards with consequence flags and honest "why
// not" blocks; skeleton placeholder while candidates are still being scored.
// ---------------------------------------------------------------------------

function optionsFormingSection(view: CaseDetailView): string {
  if (view.status !== 'RECOVERING' && view.status !== 'PLANNING') return '';
  if (view.options.length > 0 || view.planningExhausted || view.resolution) return '';
  return `
  <section class="section" aria-label="${escapeHtml(CASE_OPTIONS_FORMING_TITLE)}">
    <h2>${escapeHtml(CASE_OPTIONS_FORMING_TITLE)}</h2>
    <div class="panel">
      <div class="skeleton" style="height:64px"></div>
      <div class="skeleton" style="height:64px;margin-top:10px"></div>
      <p class="footnote">${escapeHtml(CASE_OPTIONS_FORMING_NOTE)}</p>
    </div>
  </section>`;
}

function wholeTripPlanBlock(plan: NonNullable<RecoveryOptionView['wholeTripPlan']>): string {
  const kindLabel: Record<(typeof plan.items)[number]['kind'], string> = {
    CHECKED: 'Checked',
    RECOMMENDED: 'Recommended / requires confirmation',
    EXECUTABLE: 'Handled by Northstar',
    MANUAL_FOLLOWUP: 'Provider follow-up',
  };
  const categoryOrder = ['FLIGHT', 'OVERNIGHT', 'HOTEL', 'ENTRY', 'INSURANCE', 'EVENT', 'COST'] as const;
  const sorted = [...plan.items].sort(
    (a, b) => categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category),
  );
  const items = sorted
    .map((item) => {
      // FLIGHT items carrying a `before` render as an explicit Before/After
      // comparison — the judge sees exactly which booking is being replaced.
      const body = item.before
        ? `<p class="whole-trip-before" data-test="whole-trip-before"><strong>Before.</strong> ${escapeHtml(item.before)} — no longer works as booked</p>
      <p class="whole-trip-after" data-test="whole-trip-after"><strong>After.</strong> ${escapeHtml(item.finding)}</p>`
        : `<p>${escapeHtml(item.finding)}</p>`;
      const status = item.statusLabel
        ? `<span class="badge tone-${item.statusTone ?? 'neutral'}" data-test="whole-trip-status">${escapeHtml(item.statusLabel)}</span>`
        : `<span class="whole-trip-kind">${escapeHtml(kindLabel[item.kind])}</span>`;
      return `
    <div class="whole-trip-item" data-plan-kind="${escapeHtml(item.kind)}" data-plan-category="${escapeHtml(item.category)}" data-test="whole-trip-item">
      <p class="whole-trip-item-title"><strong>${escapeHtml(item.title)}</strong> ${status}</p>
      ${body}
    </div>`;
    })
    .join('');
  const knownCost = plan.knownIncrementalCost
    ? `<p class="whole-trip-known-cost" data-test="whole-trip-known-cost"><strong>Known incremental cost:</strong> ${escapeHtml(formatMoney(plan.knownIncrementalCost))}</p>`
    : '';
  const costNotes =
    (plan.costNotes?.length ?? 0) > 0
      ? `<ul class="whole-trip-cost-notes">${plan.costNotes!.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul>`
      : '';
  return `
    <div class="whole-trip-plan" data-test="whole-trip-plan">
      <p class="whole-trip-headline"><strong>${escapeHtml(plan.headline)}</strong></p>
      <p class="whole-trip-compare-kicker">Before → after across the whole trip</p>
      ${items}
      ${knownCost}
      ${costNotes}
    </div>`;
}

function optionCard(option: RecoveryOptionView, role: 'recommended' | 'alternative' | 'more' = 'more'): string {
  const selectable = option.verdict !== 'NOT_VIABLE';
  const classes = [
    'option-card',
    option.recommended ? 'is-recommended' : '',
    option.verdict === 'NOT_VIABLE' ? 'is-rejected' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const recommended = option.recommended ? '<span class="badge tone-ok">Recommended</span>' : '';
  const alternative =
    role === 'alternative' && !option.recommended
      ? '<span class="badge tone-watch">Alternative</span>'
      : '';
  // A still-being-checked option says so; viable/rejected verdicts speak
  // through the card treatment itself (inset colour, why-not block).
  const checking =
    option.verdict === 'UNKNOWN'
      ? `<span class="chip">${escapeHtml(OPTION_VERDICT_LABEL.UNKNOWN)}</span>`
      : '';
  const cost = option.providerCost || option.costDelta
    ? (() => {
        const chips: string[] = [];
        if (option.providerCost) {
          // One charge, one chip: the provider amount leads; the home-policy
          // restatement rides along as a parenthetical, never a second chip.
          const policyNote = option.costDelta
            ? ` <span class="chip-policy-note" data-test="option-policy-equivalent">(${escapeHtml(formatPolicyEquivalent(option.costDelta))})</span>`
            : '';
          chips.push(
            `<span class="chip chip-payable" data-test="option-payable">${escapeHtml(formatPayable(option.providerCost))}${policyNote}</span>`,
          );
        } else if (option.costDelta) {
          const delta = formatCostDelta(option.costDelta);
          chips.push(
            `<span class="chip ${delta.kind === 'saving' ? 'chip-saving' : 'chip-cost'}">${escapeHtml(delta.text)}</span>`,
          );
        }
        return chips.join('');
      })()
    : '';
  const approval = option.requiresApproval
    ? `<span class="chip chip-cost">${escapeHtml(option.authorityLabel ?? 'Needs approval')}</span>`
    : '';
  const allocation = option.costAllocationSummary
    ? `<span class="chip">${escapeHtml(option.costAllocationSummary)}</span>`
    : '';
  const body = option.summary
    ? `<div class="opt-body">${escapeHtml(sanitizeUserFacingLabel(option.summary))}</div>`
    : '';
  const pros =
    (option.pros?.length ?? 0) > 0
      ? `<ul class="opt-pros" data-test="option-pros">${option.pros!.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
      : '';
  const cons =
    (option.cons?.length ?? 0) > 0
      ? `<ul class="opt-cons" data-test="option-cons">${option.cons!.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
      : '';
  const commitment =
    option.commitmentEffect
      ? `<div class="opt-commitment" data-test="option-commitment"><strong>Commitment.</strong> ${escapeHtml(option.commitmentEffect)}</div>`
      : '';
  const flags =
    (option.flags?.length ?? 0) > 0
      ? `<div class="opt-flags">${option.flags!.map((flag) => `<span class="chip">${escapeHtml(flag)}</span>`).join('')}</div>`
      : '';
  const why =
    option.recommended && option.whyRecommended
      ? `<div class="why-recommended" data-test="why-recommended"><strong>Why recommended.</strong> ${escapeHtml(option.whyRecommended)}</div>`
      : '';
  const whyNot = option.rejectionReason
    ? `<div class="why-not"><strong>${escapeHtml(OPTION_VERDICT_LABEL.NOT_VIABLE)}.</strong> ${escapeHtml(option.rejectionReason)}</div>`
    : '';
  const wholeTripPlan = option.wholeTripPlan ? wholeTripPlanBlock(option.wholeTripPlan) : '';
  return `
  <div class="${classes}" data-option-id="${escapeHtml(option.id)}" data-verdict="${escapeHtml(option.verdict)}" data-test="strategy-option" data-option-selectable="${selectable ? 'true' : 'false'}">
    <div class="opt-head">
      <span class="opt-title">${escapeHtml(sanitizeUserFacingLabel(option.title))}</span>
      ${recommended}
      ${alternative}
      ${checking}
      ${cost}
      ${allocation}
      ${approval}
    </div>
    ${wholeTripPlan}
    ${body}
    ${why}
    ${commitment}
    ${pros}
    ${cons}
    ${flags}
    ${whyNot}
  </div>`;
}

function optionsSection(view: CaseDetailView): string {
  if (!shouldShowOptionsPanel(view) || view.options.length === 0) return '';
  const allRejected = view.options.every((option) => option.verdict === 'NOT_VIABLE');
  if (allRejected) {
    return `
  <div data-case-options-panel>
  <section class="section" aria-label="Recovery options" data-test="case-options">
    <h2>${escapeHtml(CASE_OPTIONS_ALL_REJECTED_TITLE)}</h2>
    ${view.options.map((option) => optionCard(option, 'more')).join('')}
  </section>
  </div>`;
  }

  const phase = selectCaseWorkspacePhase(view);
  // Awaiting authority: keep the staged/selected recovery visible; collapse alternatives.
  if (phase === 'awaiting_authority') {
    const selected =
      view.options.find((option) => option.recommended) ??
      view.options.find((option) => option.verdict === 'VIABLE') ??
      view.options[0]!;
    const alternatives = view.options.filter((option) => option.id !== selected.id);
    const moreBlock =
      alternatives.length > 0
        ? `<details class="more-options" data-test="more-options">
    <summary>Other options considered <span class="count">${alternatives.length}</span></summary>
    <div class="more-options-body">${alternatives.map((option) => optionCard(option, 'more')).join('')}</div>
  </details>`
        : '';
    return `
  <div data-case-options-panel>
  <section class="section" aria-label="Selected recovery" data-test="case-options" data-options-mode="awaiting_authority" data-primary-option-count="1">
    <h2>${escapeHtml(CASE_SELECTED_RECOVERY_TITLE)}</h2>
    <div class="primary-options" data-test="primary-options">${optionCard(selected, 'recommended')}</div>
    ${moreBlock}
  </section>
  </div>`;
  }

  // Preserve engine recommendation truth: recommended first, then other
  // viable/unknown candidates, then rejected. Primary surface shows at most 3.
  const recommended = view.options.filter((option) => option.recommended);
  const otherPrimary = view.options.filter(
    (option) => !option.recommended && option.verdict !== 'NOT_VIABLE',
  );
  const rejected = view.options.filter((option) => option.verdict === 'NOT_VIABLE' && !option.recommended);
  const ranked = [...recommended, ...otherPrimary, ...rejected];
  const primary = ranked.slice(0, CASE_PRIMARY_OPTION_LIMIT);
  const more = ranked.slice(CASE_PRIMARY_OPTION_LIMIT);
  const primaryRecommendedCount = primary.filter((option) => option.recommended).length;
  const title =
    primaryRecommendedCount === 1 && primary.length > 1
      ? 'Recommended next step and alternatives'
      : caseOptionsHeading(primary.length);

  const primaryCards = primary
    .map((option, index) => {
      if (option.recommended) return optionCard(option, 'recommended');
      if (option.verdict !== 'NOT_VIABLE' && index < CASE_PRIMARY_OPTION_LIMIT) {
        return optionCard(option, 'alternative');
      }
      return optionCard(option, 'more');
    })
    .join('');

  const moreBlock =
    more.length > 0
      ? `<details class="more-options" data-test="more-options">
    <summary>More options <span class="count">${more.length}</span></summary>
    <div class="more-options-body">${more.map((option) => optionCard(option, 'more')).join('')}</div>
  </details>`
      : '';

  return `
  <div data-case-options-panel>
  <section class="section" aria-label="Recovery options" data-test="case-options" data-primary-option-count="${primary.length}">
    <h2>${escapeHtml(title)}</h2>
    <div class="primary-options" data-test="primary-options">${primaryCards}</div>
    ${moreBlock}
  </section>
  </div>`;
}

// ---------------------------------------------------------------------------
// Approval (approved C4) — the ask, the deterministic funding split when the
// projection carries an allocation, and the wired approve/decline forms.
// ---------------------------------------------------------------------------

const APPROVAL_STATE_TONE: Record<ApprovalRequirementView['state'], StatusTone> = {
  PENDING: 'watch',
  APPROVED: 'ok',
  DECLINED: 'alert',
};

const APPROVAL_STATE_LABEL: Record<ApprovalRequirementView['state'], string> = {
  PENDING: 'Waiting',
  APPROVED: 'Approved',
  DECLINED: 'Declined',
};

/** Funding split bar; rendered only from a complete deterministic allocation. */
function fundingSplitBlock(view: CaseDetailView): string {
  const allocation = view.funding?.allocation;
  if (!allocation) return '';
  const travellerName = view.travellerNames[0] ?? PAYER_LABEL.TRAVELLER;

  // Traveller-only incremental (typical personal extension): make payer obvious.
  if (
    allocation.incrementalAmount &&
    allocation.incrementalPayer &&
    !allocation.coveredAmount
  ) {
    const payer =
      allocation.incrementalPayer === 'TRAVELLER' ? travellerName : PAYER_LABEL[allocation.incrementalPayer];
    return `
    <div class="funding-callout" data-test="funding-traveller-incremental">
      <p><strong>Personal incremental cost</strong> — ${escapeHtml(payer)} pays ${escapeHtml(formatMoney(allocation.incrementalAmount))}.</p>
      <p class="footnote">The organiser incurs no new cost for this extension. Event-funded baseline stay is unchanged; ${escapeHtml(payer)} pays the personal increment. No flight changes.</p>
    </div>`;
  }

  // Organisation-only covered amount.
  if (
    allocation.coveredAmount &&
    allocation.coveredBy &&
    !allocation.incrementalAmount
  ) {
    return `
    <div class="funding-callout" data-test="funding-organisation-covered">
      <p><strong>Organisation-funded</strong> — ${escapeHtml(PAYER_LABEL[allocation.coveredBy])} covers ${escapeHtml(formatMoney(allocation.coveredAmount))}.</p>
    </div>`;
  }

  if (
    !allocation.coveredAmount ||
    !allocation.incrementalAmount ||
    !allocation.coveredBy ||
    !allocation.incrementalPayer ||
    allocation.coveredAmount.currency !== allocation.incrementalAmount.currency
  ) {
    return '';
  }
  const covered = allocation.coveredAmount.amount;
  const incremental = allocation.incrementalAmount.amount;
  const total = covered + incremental;
  if (!(total > 0)) return '';
  const coveredPct = Math.round((covered / total) * 1000) / 10;
  const incrementalPct = Math.round((1000 - coveredPct * 10)) / 10;
  const incrementalPayer =
    allocation.incrementalPayer === 'TRAVELLER' ? travellerName : PAYER_LABEL[allocation.incrementalPayer];
  return `
    <div class="splitbar" aria-label="Funding split">
      <div class="sp-org" style="width:${coveredPct}%"></div>
      <div class="sp-trav" style="width:${incrementalPct}%"></div>
    </div>
    <div class="split-legend">
      <span><i style="background:var(--ink)"></i>${escapeHtml(PAYER_LABEL[allocation.coveredBy])} — ${escapeHtml(formatMoney(allocation.coveredAmount))}</span>
      <span><i style="background:var(--watch-f)"></i>${escapeHtml(incrementalPayer)} — ${escapeHtml(formatMoney(allocation.incrementalAmount))}</span>
    </div>`;
}

function approvalSection(view: CaseDetailView): string {
  const approval = view.approval;
  if (!approval) return '';
  const amount = approval.amount
    ? ` Amount: <strong>${escapeHtml(formatMoney(approval.amount))}</strong>.`
    : '';

  let actionForms = '';
  if (
    approval.state === 'PENDING' &&
    approval.requestedFrom === 'TRAVELLER'
  ) {
    // Operator must not approve on the traveller's behalf. Traveller surface owns Approve.
    const waitingFor =
      view.travellerNames?.[0]?.trim() ||
      view.tripLabel?.trim() ||
      'the traveller';
    actionForms = `
    <div class="panel waiting-traveller" data-test="waiting-for-traveller" data-case-cta="awaiting_traveller">
      <p class="planning-kicker">Traveller decision required</p>
      <p class="planning-result-title">Waiting for ${escapeHtml(waitingFor)}</p>
      <p>Northstar will not change the booking until ${escapeHtml(waitingFor)} approves on the traveller surface.</p>
      <p class="btn-row" style="margin-top:12px">
        <a href="/traveller?trip=${escapeHtml(view.tripId)}" class="btn btn-ghost btn-sm" data-test="open-traveller-surface">Open traveller view</a>
      </p>
    </div>`;
  } else if (
    approval.state === 'PENDING' &&
    (approval.requestedFrom === 'ORGANISATION' || approval.requestedFrom === 'HUMAN_AGENT') &&
    approval.approver &&
    approval.intentId
  ) {
    const payable =
      view.options.find((option) => option.recommended)?.providerCost ??
      view.options.find((option) => option.providerCost)?.providerCost ??
      approval.amount;
    const approveLabel = payable
      ? `Approve as organiser ${formatMoney(payable)}`
      : 'Approve as organiser';
    actionForms = `
    <div class="btn-row">
      <form method="POST" action="/api/runtime/decide" class="inline-form" data-test="organisation-approve-form">
        <input type="hidden" name="caseId" value="${escapeHtml(view.caseId)}">
        <input type="hidden" name="intentId" value="${escapeHtml(approval.intentId)}">
        <input type="hidden" name="decidedBy.entityType" value="${escapeHtml(approval.approver.entityType)}">
        <input type="hidden" name="decidedBy.id" value="${escapeHtml(approval.approver.id)}">
        <input type="hidden" name="at" value="${escapeHtml(view.updatedAt)}">
        <input type="hidden" name="verdict" value="APPROVED">
        <button type="submit" class="btn btn-primary">${escapeHtml(approveLabel)}</button>
      </form>
      <form method="POST" action="/api/runtime/decide" class="inline-form" data-test="organisation-decline-form">
        <input type="hidden" name="caseId" value="${escapeHtml(view.caseId)}">
        <input type="hidden" name="intentId" value="${escapeHtml(approval.intentId)}">
        <input type="hidden" name="decidedBy.entityType" value="${escapeHtml(approval.approver.entityType)}">
        <input type="hidden" name="decidedBy.id" value="${escapeHtml(approval.approver.id)}">
        <input type="hidden" name="at" value="${escapeHtml(view.updatedAt)}">
        <input type="hidden" name="verdict" value="DECLINED">
        <button type="submit" class="btn btn-danger-ghost" data-does-not-execute>Decline</button>
      </form>
    </div>`;
  } else if (approval.state === 'PENDING' && approval.requestedFrom === 'HUMAN_AGENT') {
    actionForms = `<p class="footnote">${escapeHtml(authorityNeededLabel('HUMAN_AGENT'))}, but no single in-scope organisation principal is available in the current programme.</p>`;
  } else if (approval.state === 'PENDING' && approval.requestedFrom === 'ORGANISATION') {
    actionForms = '<p class="footnote">An in-scope organisation approver is not available in the current programme. Nothing has been approved.</p>';
  }

  return `
  <section class="section" aria-label="${escapeHtml(CASE_APPROVAL_TITLE)}">
    <h2>${escapeHtml(CASE_APPROVAL_TITLE)}</h2>
    <div class="panel" data-approval-state="${escapeHtml(approval.state)}">
      <p class="callout-title">${escapeHtml(authorityNeededLabel(approval.requestedFrom))}
        <span class="${toneClass(APPROVAL_STATE_TONE[approval.state], 'badge')}">${escapeHtml(APPROVAL_STATE_LABEL[approval.state])}</span>
      </p>
      <p>${escapeHtml(approval.reason)}${amount}</p>
      ${approval.state === 'PENDING' ? fundingSplitBlock(view) : ''}
      ${actionForms}
    </div>
  </section>`;
}

// ---------------------------------------------------------------------------
// Recovery actions (wired plan/begin forms) and the honest exhausted state.
// ---------------------------------------------------------------------------

function primaryActionPanel(view: CaseDetailView): string {
  const actions = recoveryActionsInner(view);
  const approval =
    view.approval?.state === 'PENDING' && !view.resolution
      ? approvalSection(view).replace('<section', '<section data-ui-section="primary-approval"')
      : '';
  if (!actions && !approval) return '';
  return `
  <section class="section section-primary-action" aria-label="What to do next" data-test="primary-action-panel">
    <h2>What to do next</h2>
    ${actions}
    ${approval}
  </section>`;
}

function canEscalate(view: CaseDetailView): boolean {
  if (view.resolution) return false;
  if (view.approval?.state === 'PENDING') return false;
  if (view.status === 'RESOLVED') return false;
  return (
    view.planningExhausted === true ||
    view.status === 'CHANGE_REQUESTED' ||
    (view.options.length > 0 && view.options.every((option) => option.verdict === 'NOT_VIABLE'))
  );
}

function escalationPanel(view: CaseDetailView): string {
  if (!canEscalate(view)) return '';
  return `
    <form method="POST" action="/api/runtime/escalate" class="inline-form" data-test="escalate-form">
      <input type="hidden" name="caseId" value="${escapeHtml(view.caseId)}">
      <input type="hidden" name="at" value="${escapeHtml(view.updatedAt)}">
      <button type="submit" class="btn btn-secondary" data-test="escalate-btn">Escalate · hand off to human support</button>
    </form>`;
}

function programmeChangeButton(view: CaseDetailView): string {
  const attrs = [
    'type="button"',
    'class="btn btn-primary"',
    'data-programme-change-launch',
    'data-test="preview-programme-change-btn"',
    `data-anchor-event-id="${escapeHtml(view.anchorEventId ?? '')}"`,
  ];
  if (view.programmeChangeCommitmentId) {
    attrs.push(`data-default-commitment-id="${escapeHtml(view.programmeChangeCommitmentId)}"`);
  }
  if (view.programmeChangeProposedStartsAt) {
    attrs.push(`data-default-new-starts-at="${escapeHtml(view.programmeChangeProposedStartsAt)}"`);
  }
  if (view.programmeChangeProposedEndsAt) {
    attrs.push(`data-default-new-ends-at="${escapeHtml(view.programmeChangeProposedEndsAt)}"`);
  }
  return `<button ${attrs.join(' ')}>Preview programme change</button>`;
}

function recoveryActionsInner(view: CaseDetailView): string {
  if (view.resolution || view.status === 'RESOLVED') {
    return `
      <div class="panel recovery-actions" data-ui-section="recovery-actions" data-case-cta="resolved">
        <p class="planning-kicker">Trip recovered</p>
        <p class="planning-result-title">This case is resolved</p>
        <p>The authoritative trip is up to date. Reopening this case does not restart recovery.</p>
        <a class="btn btn-primary" href="/operator" data-test="back-to-overview">Back to Overview</a>
      </div>`;
  }

  if (selectCaseWorkspacePhase(view) === 'executing') {
    return `
      <div class="panel recovery-actions" data-ui-section="recovery-actions" data-case-cta="executing">
        <p class="planning-kicker">Execution in progress</p>
        <p class="planning-result-title">Applying the approved recovery</p>
        <p>Northstar is applying the approved recovery, checking the supplier result, and rechecking the trip.</p>
      </div>`;
  }

  if (shouldShowExecuteCta(view) && view.approval?.intentId) {
    return `
      <div class="panel recovery-actions" data-ui-section="recovery-actions" data-case-cta="execute">
        <p class="planning-kicker">Approval recorded</p>
        <p class="planning-result-title">Execute the approved recovery</p>
        <p>Northstar will now execute, observe the result, and re-check the trip.</p>
        <form method="POST" action="/api/runtime/execute" class="inline-form" data-test="execute-approved-strategy-form">
          <input type="hidden" name="caseId" value="${escapeHtml(view.caseId)}">
          <input type="hidden" name="intentId" value="${escapeHtml(view.approval.intentId)}">
          <input type="hidden" name="at" value="${escapeHtml(view.updatedAt)}">
          <button type="submit" class="btn btn-primary" data-test="execute-approved-strategy-btn">Execute approved recovery</button>
        </form>
      </div>`;
  }

  if (view.approval?.state === 'PENDING') {
    return '';
  }

  if (isProgrammeRecoveryFlow(view)) {
    const showRecommendation = view.programmeRecoveryStage === 'programme_recommendation';
    const travelPanel = `
      <div class="panel recovery-actions" data-ui-section="recovery-actions" data-resolve-northstar-cta data-case-cta="plan" data-programme-travel-panel${showRecommendation ? ' hidden' : ''}>
        <p class="planning-kicker">Travel alone cannot save this objective</p>
        <p class="planning-result-title">Find a way to protect the headline</p>
        <p>Northstar will verify the airline replacement, test it against the current headline, and check whether a programme change can restore viability.</p>
        <button type="button" class="btn btn-primary" data-programme-travel-analysis data-test="programme-travel-analysis-btn">Check travel and programme options</button>
      </div>`;
    const proposedWhen =
      view.programmeChangeProposedStartsAt && view.programmeChangeProposedEndsAt
        ? 'the later headline time'
        : 'a later programme slot';
    const recommendationPanel = `
      <div class="panel recovery-actions" data-ui-section="recovery-actions" data-case-cta="programme" data-programme-recommendation${showRecommendation ? '' : ' hidden'}>
        <p class="planning-kicker">Programme recovery recommended</p>
        <p class="planning-result-title">Protect the headline by moving the programme, not buying another flight</p>
        <p>Northstar can test ${escapeHtml(proposedWhen)} against every linked traveller before the organiser commits anything.</p>
        ${programmeChangeButton(view)}
        ${escalationPanel(view)}
      </div>`;
    return travelPanel + recommendationPanel;
  }

  if (shouldShowProgrammeChangeCta(view)) {
    const proposedWhen =
      view.programmeChangeProposedStartsAt && view.programmeChangeProposedEndsAt
        ? 'the later headline time'
        : 'a later programme slot';
    return `
      <div class="panel recovery-actions" data-ui-section="recovery-actions" data-case-cta="programme" data-programme-recommendation>
        <p class="planning-kicker">Programme recovery recommended</p>
        <p class="planning-result-title">Protect the headline by moving the programme, not buying another flight</p>
        <p>Northstar can test ${escapeHtml(proposedWhen)} against every linked traveller before the organiser commits anything.</p>
        ${programmeChangeButton(view)}
        ${escalationPanel(view)}
      </div>`;
  }

  if (view.planningExhausted && view.options.length === 0) {
    return `
      <div class="panel recovery-actions is-exhausted" data-ui-section="recovery-actions" data-test="planning-exhausted-note" data-case-cta="exhausted">
        <ul class="planning-checks" aria-label="Planning checks completed">
          <li><span aria-hidden="true">✓</span><span><strong>Changed booking checked</strong><small>The provider change is reflected in the trip.</small></span></li>
          <li><span aria-hidden="true">✓</span><span><strong>Rest of the trip checked</strong><small>The failed trip conditions above still need to be protected.</small></span></li>
          <li><span aria-hidden="true">—</span><span><strong>Recovery inventory compared</strong><small>No candidate was returned for safe deterministic checking.</small></span></li>
        </ul>
        <p class="planning-next"><strong>Nothing has been changed.</strong> The trip remains unresolved and needs direct operator support.</p>
        ${escalationPanel(view)}
      </div>`;
  }

  if (view.options.length > 0 && view.options.every((option) => option.verdict === 'NOT_VIABLE')) {
    return `
      <div class="panel recovery-actions is-exhausted" data-ui-section="recovery-actions" data-case-cta="exhausted">
        <p>No automated recovery option works for this request. Review the rejected options below or hand the case to human support.</p>
        ${escalationPanel(view)}
      </div>`;
  }

  if (shouldShowBeginCta(view)) {
    const recommendedOption =
      view.options.find((o) => o.recommended) ?? view.options.find((o) => o.verdict === 'VIABLE');
    if (!recommendedOption) return '';
    // Truthfulness: the real authority outcome is only known after `begin` runs.
    // Never assert "no approval required" here — a human-approval case must not
    // be presented as auto-approved before the check happens.
    return `
      <div class="panel recovery-actions" data-ui-section="recovery-begin" data-case-begin-panel data-case-cta="begin">
        <p class="planning-kicker">Recovery options ready</p>
        <p class="planning-result-title">Begin the recommended recovery</p>
        <p>Starting stages the selected recovery and runs the required approval and execution checks. Option details appear after you begin.</p>
        <form method="POST" action="/api/runtime/begin" class="inline-form" data-test="begin-strategy-form">
          <input type="hidden" name="caseId" value="${escapeHtml(view.caseId)}">
          <input type="hidden" name="strategyId" value="${escapeHtml(recommendedOption.id)}">
          <input type="hidden" name="at" value="${escapeHtml(view.updatedAt)}">
          <button type="submit" class="btn btn-primary" data-test="begin-strategy-btn">Begin recovery</button>
        </form>
      </div>`;
  }

  if (shouldShowResolveCta(view)) {
    const programmeTravel = isProgrammeRecoveryFlow(view);
    return `
      <div class="panel recovery-actions" data-ui-section="recovery-actions" data-resolve-northstar-cta data-case-cta="plan">
        <p class="planning-kicker">${programmeTravel ? 'Travel alone cannot save this objective' : 'Impacted trip'}</p>
        <p class="planning-result-title">${programmeTravel ? 'Find a way to protect the headline' : 'Find a recovery'}</p>
        <p>${
          programmeTravel
            ? 'Northstar will verify the airline replacement, test it against the current headline, and check whether a programme change can restore viability.'
            : 'Northstar will re-check the whole trip against the new reality, compare workable fixes, and tell you who needs to approve what — before anything is booked.'
        }</p>
        <button type="button" class="btn btn-primary" ${
          programmeTravel ? 'data-programme-travel-analysis data-test="programme-travel-analysis-btn"' : 'data-resolve-northstar data-test="resolve-northstar-btn"'
        }>${programmeTravel ? 'Check travel and programme options' : 'Find a recovery'}</button>
        <form method="POST" action="/api/runtime/plan" class="inline-form" data-test="plan-recovery-form" hidden>
          <input type="hidden" name="caseId" value="${escapeHtml(view.caseId)}">
          <input type="hidden" name="at" value="${escapeHtml(view.updatedAt)}">
        </form>
      </div>`;
  }

  return '';
}

/** Funding summary; the split itself renders inside the pending approval ask. */
function fundingPanel(view: CaseDetailView): string {
  if (!view.funding || view.approval?.state === 'PENDING') return '';
  return `
  <section class="section" aria-label="Cost and funding">
    <h2>Cost and funding</h2>
    <div class="panel funding-panel"><p class="callout-title">How this change is funded</p><p>${escapeHtml(view.funding.summary)}</p>${fundingSplitBlock(view)}</div>
  </section>`;
}

// ---------------------------------------------------------------------------
// Rail (approved C1–C6): ink commitment card, projected case sections, and
// the standing authority explainer.
// ---------------------------------------------------------------------------

function commitmentCard(view: CaseDetailView): string {
  if (!view.commitment) return '';
  const held =
    view.resolution?.outcome === 'FULLY_RECOVERED' || view.resolution?.outcome === 'RECOVERED_WITH_LOSS';
  const label = held ? CASE_COMMITMENT_HELD_LABEL : CASE_COMMITMENT_AT_STAKE_LABEL;
  const body = view.commitment.body ? `<p class="rc-body">${escapeHtml(view.commitment.body)}</p>` : '';
  const ifMissed = view.commitment.ifMissed
    ? `<div class="rc-row"><span class="k">If missed</span><span class="v">${escapeHtml(view.commitment.ifMissed)}</span></div>`
    : '';
  return `
  <div class="rail-card ink">
    <p class="kv-label">${escapeHtml(label)}</p>
    <p class="rc-title">${escapeHtml(view.commitment.title)}</p>
    ${body}
    ${ifMissed}
  </div>`;
}

function railSectionCard(section: CaseRailSectionView): string {
  const rows = section.rows
    .map(
      (row) =>
        `<div class="rc-row"><span class="k">${escapeHtml(row.label)}</span><span class="v">${escapeHtml(row.value)}</span></div>`,
    )
    .join('');
  const note = section.note ? `<p class="rc-body">${escapeHtml(section.note)}</p>` : '';
  return `
  <div class="rail-card">
    <p class="kv-label">${escapeHtml(section.title)}</p>
    ${note}
    ${rows}
  </div>`;
}

function authorityCard(): string {
  return `
  <div class="rail-card">
    <p class="kv-label">${escapeHtml(CASE_AUTHORITY_TITLE)}</p>
    <p class="rc-body">${escapeHtml(CASE_AUTHORITY_COPY)}</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// Screen assembly
// ---------------------------------------------------------------------------

/** Case detail body from a loaded, validated view. */
export function renderCaseDetailBody(view: CaseDetailView): string {
  const issues = caseDetailViewIssues(view);
  if (issues.length > 0) {
    return `<main class="shell">${errorPanel('This case cannot be displayed yet', issues.join('; '))}</main>`;
  }
  const badge = caseBadge(view);
  const initialPhase = selectCaseWorkspacePhase(view);
  const programmeRecovery = isProgrammeRecoveryFlow(view);
  const programmeStage = view.programmeRecoveryStage ?? '';
  const planningSteps = programmeRecovery
    ? JSON.stringify([
        'Verifying the airline replacement',
        'Testing current arrival against the headline',
        'Comparing workable travel alternatives',
        'Headline commitment still fails',
        'Testing a possible programme change without touching the programme',
      ])
    : view.recoveryAnalysisSteps
      ? JSON.stringify(view.recoveryAnalysisSteps)
      : '';
  const rail = `
    <aside class="case-rail">
      ${commitmentCard(view)}
      ${(view.railSections ?? []).map(railSectionCard).join('')}
      ${authorityCard()}
    </aside>`;
  return `
<main class="shell case-workspace" data-case-workspace data-case-id="${escapeHtml(view.caseId)}" data-case-phase="${initialPhase}" data-test="case-phase-${initialPhase}"${
    programmeRecovery ? ` data-programme-recovery="true" data-programme-recovery-stage="${escapeHtml(programmeStage)}"` : ''
  }${planningSteps ? ` data-transition-planning='${escapeHtml(planningSteps)}'` : ''}>
  <div class="page-head">
    <h1>${escapeHtml(view.tripLabel ?? (view.travellerNames.join(', ') || view.tripId))} <span class="${toneClass(badge.tone, 'badge')}" role="status" aria-label="Case status: ${escapeHtml(badge.label)}">${escapeHtml(badge.label)}</span></h1>
    ${view.tripLabel?.trim() && view.travellerNames.join(', ') !== view.tripLabel ? `<p class="sub">${escapeHtml(view.travellerNames.join(', '))}</p>` : ''}
    <p class="meta"><a href="/operator">← Overview</a> · Updated ${escapeHtml(formatInstant(view.updatedAt))}</p>
  </div>
  ${stepper(view)}
  <div class="case-grid">
    <div>
      ${leadCallout(view)}
      ${statusTimelineSection(view)}
      ${optionalSection('Trip status', chainSection(view.chain))}
      ${affectedSection(view)}
      ${optionsFormingSection(view)}
      ${optionsSection(view)}
      ${primaryActionPanel(view)}
      ${checksSection(view.checks)}
      ${resolvedChangeSection(view)}
      ${activitySection(view)}
      ${view.approval && view.approval.state !== 'PENDING' ? approvalSection(view) : ''}
      ${fundingPanel(view)}
      ${uncertaintyList(view.uncertainties)}
    </div>
    ${rail}
  </div>
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

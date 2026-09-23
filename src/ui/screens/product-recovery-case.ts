/**
 * A3 operator decision workspace. Default view is the operational summary;
 * disclosures preserve full evidence. Graph state and native disclosures
 * survive refresh. Stops before consequential A4 work.
 */
import type { ActivityFeed, PlanningCandidateView, RecoveryCaseView, RecoveryStrategyView } from '../../contracts/v2/product/readModels.ts';
import { executionBlockerLine, executionBlockerShort, presentCaseWorkspace, type CaseRow, type CaseWorkspaceModel } from '../../app/target/adapters/caseWorkspacePresenter.ts';
import { SHELL_LINKS } from '../../app/target/productShell.ts';
import { CASE_COPY, CASE_CHANGE_TYPE_SENTENCE, CASE_REASON_SENTENCE } from '../copy.ts';
import { escapeHtml, formatInstant } from '../html.ts';
import { renderFocusedCaseGraph } from '../graph/index.ts';
import { renderCompactActivityRail } from './product-activity-feed.ts';
import { buildOriginalCurrentRegion, originalCurrentToggleScript } from '../originalCurrent.ts';
import { casePollingScript } from '../casePolling.ts';
import { OPERATOR_WORKSPACE_STYLES } from '../operatorWorkspaceStyles.ts';
import { renderCaseWorkspaceScript } from '../operatorWorkspaceClient.ts';
import { presentAssessment } from '../semantics/adapter.ts';
import {
  authorityLabel, candidateFor, changeSummary, decisionActionState, decisionCosts,
  decisionMoney, decisionOptions, decisionText, decisionTime, decisionTitle,
  groupedResearch, partitionRecoveryOptions, rejectionSummary,
} from '../caseDecisionPresentation.ts';

const e = escapeHtml;
const list = (items: readonly string[]): string => `<ul class="cw-compact-list">${items.map((item) => `<li>${e(item)}</li>`).join('')}</ul>`;
const raw = (value: unknown): string => `<pre class="cw-raw">${e(JSON.stringify(value, null, 2) ?? '')}</pre>`;
function region(name: string, html: string, extraClass = ''): string {
  return `<div data-poll-region="${name}"${extraClass ? ` class="${extraClass}"` : ''}>${html}</div>`;
}
function details(key: string, summary: string, body: string): string {
  return `<details class="cw-details" data-region-key="${e(key)}" data-test="${e(key)}"><summary>${e(summary)}</summary>${body}</details>`;
}
function badge(label: string, tone: string): string { return `<span class="badge tone-${tone}">${e(label)}</span>`; }

function headerHtml(view: RecoveryCaseView, m: CaseWorkspaceModel): string {
  const fallback = decisionText(view.changeSummary,
    (view.cause && CASE_CHANGE_TYPE_SENTENCE[view.cause.changeType]) || 'The current trip needs attention.');
  const problem = m.whereItBreaks
    ? `<span data-test="focused-graph-first-breakpoint">Where it breaks: <strong>${e(m.whereItBreaks.label)}</strong> — ${e(m.whereItBreaks.phrase)}.</span>`
    : e(fallback);
  return `<div class="page-head v5-case-head">
    <p class="v5-breadcrumb"><a href="${SHELL_LINKS.dashboard}" data-test="back-to-overview">${e(CASE_COPY.backToOverview)}</a></p>
    <h1>${e(m.heading)} ${badge(m.statusLabel, m.statusTone)}</h1>
    <p class="sub" data-test="case-problem">${problem}</p>
    <p class="cw-muted v5-case-updated">Updated <time datetime="${e(m.generatedAt)}">${e(formatInstant(m.generatedAt))}</time></p></div>`;
}

function graphHtml(view: RecoveryCaseView, m: CaseWorkspaceModel): string {
  const currentHtml = renderFocusedCaseGraph({ ldg: view.ldg,
    ...(view.focusedGraph ? { focusedGraph: view.focusedGraph } : {}), caseStatus: view.status });
  const stored = view.originalFocusedGraph;
  const toggle = buildOriginalCurrentRegion({ currentHtml, ...(stored ? { original: {
    graphHtml: renderFocusedCaseGraph({ ldg: stored.ldg,
      ...(stored.focusedGraph ? { focusedGraph: stored.focusedGraph } : {}),
      caseStatus: stored.caseStatusAtCapture, role: 'original', includeAssets: false }),
    capturedAt: stored.capturedAt, capturedLabel: formatInstant(stored.capturedAt),
  } } : {}) });
  return `<section class="section cw-graph" data-test="focused-case-graph-section">
    <div class="v5-graph-topline"></div>
    ${m.phase === 'recovered' ? `<p class="graph-caption" data-test="graph-resolved-note">${e(CASE_COPY.graphResolvedNote)}</p>` : ''}${toggle}</section>`;
}

function affectsHtml(m: CaseWorkspaceModel): string {
  if (!m.affects.items.length && !m.affects.healthyNote) return '';
  // Preview the already-supplied labels in the summary so the operator can read
  // what is affected without opening the disclosure.
  const preview = m.affects.items.map((item) => item.label).join(' · ');
  return `<details class="cw-details v5-affects" data-test="case-affects" data-region-key="case-affects"><summary><span class="v5-affects-label">${e(CASE_COPY.whatThisAffects)}</span>${preview ? `<span class="v5-affects-preview">${e(preview)}</span>` : ''}</summary>
    <ul class="cw-compact-list">${m.affects.items.map((item) => `<li data-tone="${item.tone}"><strong>${e(item.label)}</strong> — ${e(item.note)}</li>`).join('')}</ul>
    ${m.affects.healthyNote ? `<p class="cw-muted">${e(m.affects.healthyNote)}</p>` : ''}</details>`;
}

function changesHtml(strategy: RecoveryStrategyView): string {
  return `<ul class="cw-compact-list">${strategy.changes.map((change) => {
    const appliedWindow = change.currentWindow && change.proposedWindow
      && change.currentWindow.start === change.proposedWindow.start && change.currentWindow.end === change.proposedWindow.end;
    return `<li data-test="strategy-change" data-subject-ref="${e(change.subjectRef)}" data-change-state="${appliedWindow ? 'IN_EFFECT' : 'PROPOSED'}">${e(changeSummary(change))}</li>`;
  }).join('')}</ul>`;
}

function cancelStayNoteHtml(strategy: RecoveryStrategyView): string {
  const cancel = strategy.changes.find((change) => change.effectKind === 'CANCEL_STAY');
  if (!cancel) return '';
  const parts = ['Cancellation of the displaced stay is proposed, not completed.'];
  if (cancel.freeCancellationUntil && cancel.scheduledCancellationPenalty) {
    parts.push(
      `Free cancellation is available until ${decisionTime(cancel.freeCancellationUntil, cancel.timeZone)}; after that, potential loss ${decisionMoney(cancel.scheduledCancellationPenalty)}.`,
    );
  } else if (cancel.cancellationPenalty) {
    parts.push(`Current cancellation loss ${decisionMoney(cancel.cancellationPenalty)}.`);
  }
  return `<p class="cw-muted" data-test="cancel-stay-economics">${e(parts.join(' '))}</p>`;
}

/** Compact spend/loss for the decision panel only — not a second full table. */
function moneySummaryHtml(candidate: PlanningCandidateView | undefined): string {
  const cost = decisionCosts(candidate?.costComparison);
  if (cost.unavailable) {
    return `<div class="cw-metrics cw-metrics-unknown">
      <div class="cw-metric" data-test="cost-new-spend"><small>NEW SPEND</small><strong>Not compared</strong></div>
      <div class="cw-metric" data-test="cost-potential-loss"><small>POTENTIAL DISPLACED-BOOKING LOSS</small><strong>Not compared</strong></div>
    </div>
    <p class="cw-muted" data-test="cost-unavailable">${e(cost.unavailable)}</p>`;
  }
  const exposureNote = cost.exposure.some((line) => /up to/i.test(line.kind.label))
    ? ' · up to (source maximum)'
    : ' · estimate';
  return `<div class="cw-metrics" data-test="cost-separated">
    <div class="cw-metric cw-metric-spend" data-test="cost-new-spend"><small>NEW SPEND</small><strong>${e(cost.newSpend?.join(' + ') ?? 'Not supplied')}</strong><span class="cw-metric-note">Proposed expenditure · home currency</span></div>
    <div class="cw-metric cw-metric-exposure" data-test="cost-potential-loss"><small>POTENTIAL DISPLACED-BOOKING LOSS</small><strong>${e(cost.potentialLoss?.join(' + ') ?? 'Not supplied')}</strong><span class="cw-metric-note">Not a confirmed charge${exposureNote}</span></div>
  </div>
  ${cost.providerSpend ? `<p class="cw-muted">Original provider currency: ${e(cost.providerSpend.join(' + '))}.</p>` : ''}`;
}

function costBreakdownHtml(candidate: PlanningCandidateView | undefined, key: string): string {
  const cost = decisionCosts(candidate?.costComparison);
  if (cost.unavailable || !cost.comparison) return '';
  const rows = (lines: typeof cost.spend, category: 'spend' | 'exposure' | 'other'): string => lines.map((line) => `<tr>
    <td>${e(decisionText(line.kind.label, 'Comparison item'))}${category === 'exposure' ? '<br>Potential loss · estimate only' : category === 'spend' ? '<br>Proposed expenditure' : '<br>Other recorded comparison item'}</td>
    <td>${e(decisionMoney(line.providerAmount))}</td><td>${e(decisionMoney(line.homeAmount))}</td></tr>`).join('');
  const fx = cost.comparison.selectedFxEvidence ?? [];
  return details(`cost-evidence-${key}`, 'Cost breakdown and FX evidence',
    `<p class="cw-muted">Comparison figures, not confirmed charges or refunds. Potential loss is separate from new spending.</p>
    <table class="cw-cost-table"><thead><tr><th scope="col">Item</th><th scope="col">Provider currency</th><th scope="col">Home comparison</th></tr></thead>
    <tbody>${rows(cost.spend, 'spend')}${rows(cost.exposure, 'exposure')}${rows(cost.other, 'other')}</tbody></table>
    <p>Compared total: <strong>${e(decisionMoney(cost.comparison.totalHomeAmount))}</strong> · ${e(formatInstant(cost.comparison.comparedAt))}</p>
    ${fx.length ? list(fx.map((rate) => `${decisionText(rate.source.label, 'Recorded exchange-rate source')}: ${rate.baseCurrency} → ${rate.homeCurrency} at ${rate.rate}; reference ${formatInstant(rate.observedAt)}${rate.validUntil ? `; valid until ${formatInstant(rate.validUntil)}` : ''}.`)) : '<p>No exchange-rate record was supplied.</p>'}`);
}

/**
 * Shared with alternatives/rejected candidates, which must keep rendering
 * exactly as before (verified by the operator-ui-convergence suite). `parts`
 * lets the recommendation card pull the itinerary and the programme
 * commitments into separate steps without changing any other caller.
 */
interface ProposalHtmlOptions {
  readonly parts?: 'itinerary' | 'commitments';
  /** Step 2 only: tuck each directly-shown check's dense timing line behind a disclosure. */
  readonly timingDisclosure?: boolean;
}
function proposalHtml(candidate: PlanningCandidateView | undefined, options?: ProposalHtmlOptions): string {
  const p = candidate?.proposal;
  if (!p) {
    if (options?.parts === 'commitments') return '';
    return '<p class="cw-muted">Detailed itinerary evidence was not supplied for this option.</p>';
  }
  const flights = p.flights.map((flight) => `<article><p class="cw-kicker">Flight</p><h4>${e(decisionText(flight.label, 'Replacement flight'))}</h4>
    ${flight.originLabel || flight.destinationLabel ? `<p>${e(decisionText(flight.originLabel, 'Origin not supplied'))} → ${e(decisionText(flight.destinationLabel, 'Destination not supplied'))}</p>` : ''}
    <dl class="cw-times"><div><dt>Depart</dt><dd>${e(decisionTime(flight.departure, flight.departureTimeZone))}</dd></div><div><dt>Arrive</dt><dd>${e(decisionTime(flight.arrival, flight.arrivalTimeZone))}</dd></div></dl></article>`).join('');
  const stays = p.stays.map((stay) => {
    const property = stay.propertyLabel ?? stay.placeLabel;
    const placeContext = stay.propertyLabel && stay.propertyLabel !== stay.placeLabel
      ? `<p class="cw-muted">Place context: ${e(stay.placeLabel)}</p>`
      : '';
    return `<article><p class="cw-kicker">Accommodation</p><h4>${e(decisionText(property, 'Property not supplied'))}</h4>
    ${placeContext}<p>${e(decisionTime(stay.start, stay.timeZone))} → ${e(decisionTime(stay.end, stay.timeZone))}</p></article>`;
  }).join('');
  const itineraryHtml = `<div class="cw-itinerary">${flights}${stays}</div>`;
  if (options?.parts === 'itinerary') return itineraryHtml;

  const checks = p.programmeChecks ?? [];
  const primaryChecks = checks.filter((c) => c.verdict !== 'PASS');
  if (options?.parts !== 'commitments') {
    primaryChecks.push(...checks.filter((c) => c.verdict === 'PASS').slice(0, Math.max(0, 3 - primaryChecks.length)));
  }
  const remainingChecks = checks.filter((c) => !primaryChecks.includes(c));
  const check = (c: typeof checks[number], wrapTiming: boolean): string => {
    const timingLine = c.availableMinutes === undefined && c.requiredMinutes === undefined ? '' :
      `${c.availableMinutes === undefined ? '' : `${c.availableMinutes} min available`}${c.requiredMinutes === undefined ? '' : ` · ${c.requiredMinutes} min required`}${c.transferMinutes === undefined ? '' : ` · ${c.transferMinutes} min transfer`}`;
    const timingBlock = !timingLine ? '' : wrapTiming
      ? details(`programme-check-timing-${candidate?.candidateKey ?? 'option'}-${checks.indexOf(c)}`, 'Timing detail', `<p class="cw-muted">${timingLine}</p>`)
      : `<p class="cw-muted">${timingLine}</p>`;
    return `<article><h4>${e(decisionText(c.label, 'Programme commitment'))}</h4>
    <p>${c.verdict === 'PASS' ? 'Preserved under this proposal' : c.verdict === 'FAIL' ? 'Not satisfied under this proposal' : 'Not confirmed under this proposal'}</p>
    ${c.arrival || c.deadline ? `<p class="cw-muted">${c.arrival ? `Arrives ${e(decisionTime(c.arrival, c.timeZone))}` : ''}${c.deadline ? ` · required by ${e(decisionTime(c.deadline, c.timeZone))}` : ''}</p>` : ''}
    ${timingBlock}</article>`;
  };
  const commitmentsHeading = options?.parts === 'commitments' ? '' : '<h4>Programme commitments</h4>';
  const commitmentsHtml = `${checks.length ? `<div class="cw-block">${commitmentsHeading}<div class="cw-itinerary">${primaryChecks.map((c) => check(c, !!options?.timingDisclosure)).join('')}</div>
    ${remainingChecks.length ? details(`programme-checks-${candidate?.candidateKey ?? 'option'}`, options?.parts === 'commitments' ? 'View all trip checks' : `${remainingChecks.length} more commitment checks`, `<div class="cw-itinerary">${remainingChecks.map((c) => check(c, false)).join('')}</div>`) : ''}</div>` : ''}
    ${p.blockers.length ? `<div class="cw-block" data-test="proposal-conditions"><h4>Conditions still identified in this proposal</h4>${list(p.blockers.map((b) => `${b.verdict === 'FAIL' ? 'Failed' : 'Unconfirmed'} — ${CASE_REASON_SENTENCE[b.reasonCode] ?? 'a recorded check remains unresolved; see Technical details'}.`))}</div>` : ''}`;
  if (options?.parts === 'commitments') return commitmentsHtml;
  return `${itineraryHtml}${commitmentsHtml}`;
}

function conditionsList(view: RecoveryCaseView, m: CaseWorkspaceModel, candidate: PlanningCandidateView | undefined): string[] {
  const notes: string[] = [];
  for (const text of view.uncertainty) {
    const plainNote = decisionText(text, '');
    if (plainNote) notes.push(plainNote);
  }
  for (const note of m.researchNotes) {
    if (!notes.includes(note)) notes.push(note);
  }
  for (const blocker of candidate?.proposal?.blockers ?? []) {
    const line = `${blocker.verdict === 'FAIL' ? 'Failed' : 'Unconfirmed'} — ${CASE_REASON_SENTENCE[blocker.reasonCode] ?? 'a recorded check remains unresolved'}.`;
    if (!notes.includes(line)) notes.push(line);
  }
  return notes;
}

/**
 * One short sentence: only strategy.projectedSummary and the candidate's
 * PASS programme checks feed it. Never claims the trip is recovered.
 */
function recommendationVerdict(strategy: RecoveryStrategyView): string {
  const { pass, fail, unknown, total } = strategy.projectedSummary;
  const checksPart = total === 0
    ? 'No projected checks were recorded'
    : fail === 0 && unknown === 0
      ? `All ${total} projected checks pass`
      : `${pass} of ${total} projected checks pass`;
  const repaired = strategy.resolves.filter((person) => person.currentVerdict !== 'PASS' && person.projectedVerdict === 'PASS');
  const keepsPart = repaired[0]
    ? ` · restores ${truncateForGlance(decisionText(repaired[0].personLabel, 'the affected traveller'))}${repaired.length > 1 ? ` and ${repaired.length - 1} more` : ''}`
    : '';
  return `${checksPart}${keepsPart}.`;
}

/** ~40 chars for a glance cell; the full sentence still appears lower on the card. */
function truncateForGlance(text: string, max = 40): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function glanceChangesCell(strategy: RecoveryStrategyView, candidate: PlanningCandidateView | undefined): string {
  const moved = strategy.changes.filter((change) => change.effectKind === 'CHANGE_PROGRAMME_ITEM_TIME' || change.proposedWindow);
  if (moved.length > 0) {
    const first = changeSummary(moved[0]!);
    const more = moved.length > 1 ? `<span class="v5-glance-sub">+${moved.length - 1} more</span>` : '';
    return `${e(first)}${more}`;
  }
  const p = candidate?.proposal;
  const flight = p?.flights[0];
  if (flight) {
    const originLabel = flight.originLabel ? decisionText(flight.originLabel, '') : '';
    const destinationLabel = flight.destinationLabel ? decisionText(flight.destinationLabel, '') : '';
    const sub = originLabel && destinationLabel ? `<span class="v5-glance-sub">${e(originLabel)} → ${e(destinationLabel)}</span>` : '';
    return `${e(decisionText(flight.label, 'Replacement flight'))}${sub}`;
  }
  const stay = p?.stays[0];
  if (stay) return e(decisionText(stay.propertyLabel ?? stay.placeLabel, 'Not supplied'));
  return 'Not supplied';
}

function glanceProtectsCell(strategy: RecoveryStrategyView, candidate: PlanningCandidateView | undefined): string {
  const affected = candidate?.blastRadius?.directlyAffected ?? [];
  if (affected.length > 0) {
    const names = affected.slice(0, 2).map((item) => decisionText(item.label, 'Affected')).join(', ');
    const more = affected.length > 2 ? `<span class="v5-glance-sub">+${affected.length - 2} more</span>` : '';
    return `${e(names)}${more}`;
  }
  const repaired = strategy.resolves.filter((person) => person.currentVerdict !== 'PASS' && person.projectedVerdict === 'PASS');
  if (repaired.length === 0) return 'No failing outcome recorded';
  const names = repaired.slice(0, 2).map((person) => decisionText(person.personLabel, 'Traveller')).join(', ');
  const more = repaired.length > 2 ? `<span class="v5-glance-sub">+${repaired.length - 2} more</span>` : '';
  return `${e(names)}${more}`;
}

function glanceCostsCell(candidate: PlanningCandidateView | undefined): string {
  const cost = decisionCosts(candidate?.costComparison);
  if (cost.unavailable) return 'Not compared';
  return e(cost.newSpend?.join(' + ') ?? 'Not supplied');
}

function glanceBlockedByCell(strategy: RecoveryStrategyView): string {
  if (!strategy.executionBlocker) return 'Nothing blocking';
  return e(executionBlockerShort(strategy.executionBlocker));
}

function changeStepHtml(strategy: RecoveryStrategyView, candidate: PlanningCandidateView | undefined): string {
  const moves = strategy.changes.map((change) => changeSummary(change)).filter((line) => line.length > 0);
  const proposal = candidate?.proposal;
  const hasItinerary = (proposal?.flights.length ?? 0) + (proposal?.stays.length ?? 0) > 0;
  const itinerary = hasItinerary ? proposalHtml(candidate, { parts: 'itinerary' }) : '';
  if (moves.length === 0) return itinerary || proposalHtml(candidate, { parts: 'itinerary' });
  return `${list(moves)}${itinerary}`;
}

function affectedStepHtml(candidate: PlanningCandidateView | undefined): string {
  const blast = candidate?.blastRadius;
  if (!blast) return proposalHtml(candidate, { parts: 'commitments', timingDisclosure: true });
  const lines = [
    ...blast.changed.map((item) => `Changes ${decisionText(item.label, 'a recorded item')}`),
    ...blast.directlyAffected.map((item) => decisionText(item.label, 'Directly affected')),
  ];
  const primary = lines.length ? list(lines) : '<p class="cw-muted">No direct change was recorded for this option.</p>';
  const rest = blast.reassessed.length
    ? details(`trip-checks-${candidate?.candidateKey ?? 'option'}`, `View all trip checks (${blast.reassessed.length})`, list(blast.reassessed.map((item) => decisionText(item.label, 'Rechecked'))))
    : '';
  return `${primary}${rest}`;
}

function recommendationGlanceHtml(strategy: RecoveryStrategyView, candidate: PlanningCandidateView | undefined): string {
  return `<dl class="v5-rec-glance">
    <div class="v5-glance-cell"><dt>Changes</dt><dd>${glanceChangesCell(strategy, candidate)}</dd></div>
    <div class="v5-glance-cell"><dt>Protects</dt><dd>${glanceProtectsCell(strategy, candidate)}</dd></div>
    <div class="v5-glance-cell"><dt>Costs</dt><dd>${glanceCostsCell(candidate)}</dd></div>
    <div class="v5-glance-cell"><dt>Blocked by</dt><dd>${glanceBlockedByCell(strategy)}</dd></div>
  </dl>`;
}

/** Dominant recommendation card — same strategy/candidate as the decision panel. */
function travelOptionCardHtml(strategy: RecoveryStrategyView, view: RecoveryCaseView, recommended: boolean): string {
  const candidate = candidateFor(view, strategy);
  const outcomes = strategy.resolves.map((person) => `${decisionText(person.personLabel, 'Traveller')} — ${person.projectedVerdict === 'PASS' ? 'trip outcome passes under this proposal' : person.projectedVerdict === 'FAIL' ? 'trip outcome fails under this proposal' : 'trip outcome remains unconfirmed'}.`);
  const basis = (view.planningEvidence?.recommendation?.basis ?? [])
    .map((b) => decisionText(b.summary, '')).filter((text) => text.length > 0 && text.length <= 240).slice(0, 3);
  const reasons = [...outcomes, ...basis].slice(0, 3);
  const unresolved = view.uncertainty.map((text) => decisionText(text, '')).filter((text) => text.length > 0).slice(0, 3);
  return `<article class="cw-card cw-rec option-card${recommended ? ' is-recommended' : ''}" data-test="recovery-strategy" data-strategy-kind="travel" data-strategy-ref="${e(strategy.strategyRef)}" data-option-number="${strategy.optionNumber}">
    <div class="v5-rec-head">
      <p class="cw-kicker">${recommended ? 'Proposed — not yet applied' : `Travel option ${strategy.optionNumber}`}</p>
      <h3>${e(decisionTitle(strategy))}</h3>
      <p class="v5-rec-verdict">${e(recommendationVerdict(strategy))}</p>
    </div>
    ${recommendationGlanceHtml(strategy, candidate)}
    <section class="v5-rec-step" data-step="1"><h4>What changes</h4>${changeStepHtml(strategy, candidate)}</section>
    <section class="v5-rec-step" data-step="2"><h4>Directly affected</h4>${affectedStepHtml(candidate)}</section>
    <section class="v5-rec-step" data-step="3"><h4>Why this one</h4>
      <div class="cw-block">${list(reasons)}
        <p class="cw-muted">${strategy.projectedSummary.pass} passed · ${strategy.projectedSummary.fail} failed · ${strategy.projectedSummary.unknown} unconfirmed across ${strategy.projectedSummary.total} assessed item${strategy.projectedSummary.total === 1 ? '' : 's'}.</p>
        ${unresolved.length ? `<h4>Still unresolved</h4>${list(unresolved)}` : ''}
        ${details(`outcome-checks-${strategy.strategyRef}`, 'All projected outcome checks', list(strategy.resolves.map((c) => `${c.projectedVerdict === 'PASS' ? 'Passed' : c.projectedVerdict === 'FAIL' ? 'Failed' : 'Unconfirmed'} — ${decisionText(c.personLabel, 'Traveller')}`)))}
      </div>
    </section>
    ${strategy.changes.some((c) => c.effectKind === 'CANCEL_STAY') ? cancelStayNoteHtml(strategy) : ''}
    ${costBreakdownHtml(candidate, strategy.strategyRef)}
    ${strategy.executionBlocker ? `<p class="cw-muted" data-test="option-execution-blocker"><strong>Cannot be carried out yet:</strong> ${e(executionBlockerLine(strategy.executionBlocker))}</p>` : ''}
  </article>`;
}

function programmeSpendLabel(candidate: PlanningCandidateView | undefined): string {
  const cost = decisionCosts(candidate?.costComparison);
  if (cost.unavailable) return '$0 potential new spend';
  return cost.newSpend?.join(' + ') ?? 'SGD 0';
}

function programmeChangeRowsHtml(strategy: RecoveryStrategyView): string {
  const moves = strategy.changes.filter((change) => change.effectKind === 'CHANGE_PROGRAMME_ITEM_TIME' && change.proposedWindow);
  if (!moves.length) return '<p class="cw-muted">No programme time changes were recorded on this strategy.</p>';
  return `<div class="v5-programme-changes" data-test="programme-what-changes">${moves.map((change) => {
    const title = decisionText(change.subjectLabel, 'Programme item');
    const zone = change.timeZone;
    const before = change.currentWindow
      ? `${decisionTime(change.currentWindow.start, zone)} → ${decisionTime(change.currentWindow.end, zone)}`
      : 'Current window not supplied';
    const after = `${decisionTime(change.proposedWindow!.start, zone)} → ${decisionTime(change.proposedWindow!.end, zone)}`;
    return `<div class="v5-programme-change-row" data-test="programme-change-row">
      <strong>${e(title)}</strong>
      <p class="cw-muted">${e(before)}</p>
      <p data-test="programme-change-after"><span class="cw-kicker">After</span> ${e(after)}</p>
    </div>`;
  }).join('')}</div>`;
}

function programmeAlternativePanelHtml(view: RecoveryCaseView, strategy: RecoveryStrategyView, travelComparators: readonly RecoveryStrategyView[]): string {
  const candidate = candidateFor(view, strategy);
  const blast = candidate?.blastRadius;
  const directPeople = (blast?.directlyAffected ?? []).map((item) => decisionText(item.label, 'Participant')).filter(Boolean);
  const directItems = (blast?.changed ?? []).map((item) => decisionText(item.label, 'Changed item')).filter(Boolean);
  const reassessed = (blast?.reassessed ?? []).map((item) => decisionText(item.label, 'Rechecked')).filter(Boolean);
  const peopleCount = directPeople.length;
  const itemCount = Math.max(directItems.length, strategy.changes.filter((c) => c.effectKind === 'CHANGE_PROGRAMME_ITEM_TIME').length);
  const spend = decisionCosts(candidate?.costComparison);
  const programmeSpend = spend.unavailable ? 'Not compared' : (spend.newSpend?.join(' + ') ?? 'SGD 0');
  const travelCompare = travelComparators
    .map((travel) => {
      const cost = decisionCosts(candidateFor(view, travel)?.costComparison);
      if (cost.unavailable || !cost.newSpend?.length) return null;
      return cost.newSpend.join(' + ');
    })
    .find((value): value is string => Boolean(value));
  const basis = (view.planningEvidence?.recommendation?.basis ?? [])
    .map((b) => decisionText(b.summary, ''))
    .filter((text) => text.length > 0 && text.length <= 240)
    .slice(0, 4);
  const why = [
    ...strategy.resolves
      .filter((person) => person.currentVerdict !== 'PASS' && person.projectedVerdict === 'PASS')
      .map((person) => `Restores ${decisionText(person.personLabel, 'the affected traveller')}'s required commitment`),
    programmeSpend === 'SGD 0' || programmeSpend === 'Not compared' ? 'No new spend on this programme change' : `New spend ${programmeSpend}`,
    peopleCount || itemCount
      ? `Bounded direct blast radius · ${peopleCount || '—'} ${peopleCount === 1 ? 'person' : 'people'} · ${itemCount || '—'} programme ${itemCount === 1 ? 'item' : 'items'}`
      : 'Direct blast radius recorded on the candidate',
    strategy.projectedSummary.fail === 0
      ? 'No new failing trips after reassessment'
      : `${strategy.projectedSummary.fail} projected failure${strategy.projectedSummary.fail === 1 ? '' : 's'} remain after reassessment`,
    ...basis,
  ].slice(0, 5);
  // Approve only this programme strategy through the existing recover action.
  let approve = '';
  if (view.status === 'AWAITING_AUTHORITY' || view.status === 'OPEN') {
    if (strategy.executionBlocker) {
      approve = `<p class="cw-muted" data-test="programme-approve-blocked">${e(executionBlockerLine(strategy.executionBlocker))}</p>
        <button type="button" class="btn btn-primary" data-test="approve-programme-change" disabled>Approve programme change</button>`;
    } else {
      approve = `<button type="button" class="btn btn-primary" data-action="recover" data-test="approve-programme-change" data-strategy-ref="${e(strategy.strategyRef)}" data-case-ref="${e(view.caseRef)}" data-busy-label="Approving…">Approve programme change</button>`;
    }
  }
  const ctaSpend = programmeSpendLabel(candidate);
  return `<details class="v5-programme-alternative" data-test="programme-alternative" data-region-key="programme-alternative">
    <summary data-test="programme-alternative-cta">Consider programme change · ${e(ctaSpend)}</summary>
    <article class="cw-card cw-programme-alt" data-test="programme-alternative-panel" data-strategy-ref="${e(strategy.strategyRef)}" data-strategy-kind="programme">
      <p class="cw-kicker">Programme alternative</p>
      <h3>Change the programme — not another flight purchase</h3>
      <section data-test="programme-panel-what-changes"><h4>What changes</h4>${programmeChangeRowsHtml(strategy)}</section>
      <section data-test="programme-panel-who"><h4>Who is directly affected</h4>
        <p><strong>${peopleCount || '—'} ${peopleCount === 1 ? 'person' : 'people'}</strong> · <strong>${itemCount || '—'} programme ${itemCount === 1 ? 'item' : 'items'}</strong></p>
        ${directPeople.length ? list(directPeople) : '<p class="cw-muted">Direct participants were not named on this candidate.</p>'}
      </section>
      <section data-test="programme-panel-economics"><h4>Economics</h4>
        <div class="cw-metrics" data-test="programme-cost-compare">
          <div class="cw-metric" data-test="programme-new-spend"><small>PROGRAMME CHANGE</small><strong>${e(programmeSpend)}</strong><span class="cw-metric-note">New spend</span></div>
          ${travelCompare
            ? `<div class="cw-metric" data-test="travel-compare-spend"><small>TRAVEL ALTERNATIVE</small><strong>${e(travelCompare)}</strong><span class="cw-metric-note">Provider-derived comparable</span></div>`
            : '<p class="cw-muted">No priced travel alternative is available to compare.</p>'}
        </div>
      </section>
      <section data-test="programme-panel-why"><h4>Why Northstar surfaced this</h4>${list(why)}</section>
      <section data-test="programme-panel-blast">${details('programme-blast-radius', 'View blast radius', `
        <div data-test="programme-blast-direct"><h5>Direct change</h5>
          ${directItems.length || directPeople.length
            ? list([...directItems.map((label) => `Programme item · ${label}`), ...directPeople.map((label) => `Participant · ${label}`)])
            : '<p class="cw-muted">No direct change set was recorded.</p>'}
        </div>
        <div data-test="programme-blast-reassess"><h5>Reassessment</h5>
          ${reassessed.length
            ? `<p class="cw-muted">Broader journeys/trips Northstar rechecked to ensure nothing else broke.</p>${list(reassessed)}`
            : '<p class="cw-muted">No broader reassessment set was recorded.</p>'}
        </div>`)}
      </section>
      <section class="v5-programme-approve" data-test="programme-panel-approve">${approve}
        <p data-test="recovery-controls-status" data-action-status role="status"></p>
      </section>
    </article>
  </details>`;
}

function recommendationHtml(view: RecoveryCaseView): string {
  const partitioned = partitionRecoveryOptions(view);
  if (partitioned.issue && !partitioned.travel.length && !partitioned.programmeAlternative) {
    return `<section class="section" id="cw-recommendation" data-test="recovery-controls"><div class="callout tone-watch" data-test="recommendation-unavailable"><p>${e(partitioned.issue)}</p></div></section>`;
  }
  const travelCards = partitioned.travel.slice(0, 3).map((strategy) =>
    travelOptionCardHtml(strategy, view, strategy === partitioned.recommendedTravel));
  const programme = partitioned.programmeAlternative
    ? programmeAlternativePanelHtml(view, partitioned.programmeAlternative, partitioned.travel)
    : '';
  if (!travelCards.length && !programme) return '';
  return `<section class="section" id="cw-recommendation" data-test="recovery-options-split">
    ${travelCards.length ? `<div data-test="normal-recovery-options">${travelCards.join('')}</div>` : ''}
    ${programme}
  </section>`;
}

function findRecoveryHtml(view: RecoveryCaseView, m: CaseWorkspaceModel): string {
  const chunks: string[] = [];
  if (m.showFindRecovery) chunks.push(`<div class="cw-card" data-test="find-recovery"><h3>${e(CASE_COPY.findRecovery)}</h3><p>${e(CASE_COPY.findRecoveryHint)}</p>
    <button type="button" class="btn btn-primary" data-action="recover" data-test="propose-strategies" data-case-ref="${e(view.caseRef)}" data-request-path="/api/v2/cases/${encodeURIComponent(view.caseRef)}/strategies" data-busy-label="Checking the trip…">${e(CASE_COPY.findRecovery)}</button>
    <p data-test="recovery-controls-status" data-action-status role="status"></p></div>`);
  if (m.noPlan) chunks.push(`<div class="cw-card" data-test="no-plan"><p>${e(CASE_COPY.noPlanBody)}</p>
    <button type="button" class="btn btn-ghost" data-action="escalate" data-test="escalate-case" data-case-ref="${e(view.caseRef)}" data-busy-label="Handing off…">${e(CASE_COPY.escalate)}</button><p data-test="recovery-controls-status" data-action-status role="status"></p></div>`);
  return chunks.join('');
}

function alternativesHtml(view: RecoveryCaseView): string {
  const partitioned = partitionRecoveryOptions(view);
  // Programme strategies render in the distinct programme-alternative panel.
  const travelAlts = partitioned.travel.filter((s) => s !== partitioned.recommendedTravel);
  if (!travelAlts.length) return '';
  return details('viable-alternatives', `${travelAlts.length} other viable travel ${travelAlts.length === 1 ? 'alternative' : 'alternatives'}`,
    `<p class="cw-muted">Concise comparison first. Open an option for its full evaluation.</p>` + travelAlts.map((strategy) => {
      const candidate = candidateFor(view, strategy);
      const cost = decisionCosts(candidate?.costComparison);
      const spend = cost.newSpend?.join(' + ') ?? (cost.unavailable ? 'Cost not compared' : 'Not supplied');
      return `<article class="cw-card cw-alt option-card" data-test="recovery-strategy" data-strategy-kind="travel" data-strategy-ref="${e(strategy.strategyRef)}" data-option-number="${strategy.optionNumber}">
        <p class="cw-kicker">Alternative ${strategy.optionNumber}</p><h3>${e(decisionTitle(strategy))}</h3>
        <p class="cw-muted">Estimated new spend: ${e(spend)}</p>
        ${details(`alt-eval-${strategy.strategyRef}`, 'Full evaluation', `${proposalHtml(candidate)}${changesHtml(strategy)}${costBreakdownHtml(candidate, `alt-${strategy.strategyRef}`)}`)}
      </article>`;
    }).join(''));
}

/**
 * At most three compact rejection rows. Full human-readable evaluation stays
 * inside a closed disclosure — never append proposalHtml in the default view.
 */
function rejectedHtml(view: RecoveryCaseView, m: CaseWorkspaceModel): string {
  const considered = (view.planningEvidence?.candidates ?? []).filter((c) =>
    c.disposition.code === 'REJECTED_VALIDATION' || c.disposition.code === 'REJECTED_DETERMINISTIC');
  if (!considered.length) return '';
  // Candidates that present identically (same option name, status and recorded
  // reason) are one row with a count. Presentation-only: nothing is dropped, and
  // every candidate keeps its own evaluation disclosure.
  const buckets: { summary: ReturnType<typeof rejectionSummary>; members: typeof considered }[] = [];
  for (const candidate of considered) {
    const summary = rejectionSummary(candidate);
    const hit = buckets.find((bucket) => bucket.summary.label === summary.label
      && bucket.summary.status === summary.status && bucket.summary.reason === summary.reason);
    if (hit) hit.members.push(candidate);
    else buckets.push({ summary, members: [candidate] });
  }
  const shown = buckets.slice(0, 3);
  const preview = shown.map(({ summary: c, members }) => {
    const first = members[0]!;
    const evaluations = members.length === 1
      ? details(`rejection-eval-${first.candidateKey}`, 'Inspect evaluation', proposalHtml(first))
      : details(`rejection-eval-${first.candidateKey}`, `Inspect ${members.length} evaluations`,
        members.map((member) => `<div data-candidate-key="${e(member.candidateKey)}">${proposalHtml(member)}</div>`).join(''));
    return `<div class="cw-rejection" data-candidate-key="${e(first.candidateKey)}" data-grouped="${members.length}">
      <div><strong>${e(c.label)}</strong><p class="cw-muted">${e(c.status)}${members.length > 1 ? ` · ${members.length} options` : ''}</p></div>
      <div><p>${e(c.reason)}</p>
        ${evaluations}
      </div></div>`;
  }).join('');
  const shownCount = shown.reduce((sum, bucket) => sum + bucket.members.length, 0);
  return `<div class="cw-card cw-block" data-test="rejected-summary"><h3>${m.noPlan ? 'Why the automatic options stopped' : 'Why other options were not chosen'}</h3>
    ${preview}
    ${shownCount < considered.length ? `<p class="cw-muted">Showing ${shownCount} of ${considered.length} rejected options. Every recorded evaluation remains below.</p>` : ''}
  </div>`;
}

function allCandidatesHtml(view: RecoveryCaseView): string {
  const allCandidates = view.planningEvidence?.candidates ?? [];
  if (!allCandidates.length) return '';
  return details('other-options', `Show detailed evaluation (${allCandidates.length} recorded options)`,
    allCandidates.map((candidate) => {
      const c = rejectionSummary(candidate);
      return `<article data-candidate-key="${e(candidate.candidateKey)}"><h4>${e(c.label)} · ${e(c.status)}</h4><p>${e(c.reason)}</p>
        ${details(`evaluation-${candidate.candidateKey}`, 'Human-readable proposal details', proposalHtml(candidate))}
        ${details(`evaluation-raw-${candidate.candidateKey}`, 'Technical details', raw(candidate))}</article>`;
    }).join(''));
}

function approvalHtml(view: RecoveryCaseView, m: CaseWorkspaceModel): string {
  if (m.phase !== 'awaiting_approval' && view.status !== 'AWAITING_AUTHORITY') return '';
  const options = decisionOptions(view);
  const strategy = options.recommended;
  const candidate = strategy ? candidateFor(view, strategy) : undefined;
  const action = decisionActionState(view);
  const conditions = conditionsList(view, m, candidate);
  let actionControls = '';
  if (action.kind === 'ready') {
    actionControls = `<button type="button" class="btn btn-primary" data-action="recover" data-test="approve-recommendation" data-strategy-ref="${e(action.strategyRef)}" data-case-ref="${e(view.caseRef)}" data-busy-label="Approving…">Approve and execute</button>
      <button type="button" class="btn btn-ghost" data-action="decline" data-test="decline-recommendation" data-case-ref="${e(view.caseRef)}" data-busy-label="Recording…">Reject</button>`;
  } else if (action.kind === 'blocked') {
    actionControls = `<p id="decision-action-reason" class="cw-muted" data-test="decision-execution-blocker">${e(action.reason)}</p>
      <button type="button" class="btn btn-primary" data-test="approval-unavailable" aria-describedby="decision-action-reason" disabled>Approval unavailable</button>`;
  } else if (action.kind === 'unavailable') {
    actionControls = `<p id="decision-action-reason" class="cw-muted">${e(action.reason)}</p>
      <button type="button" class="btn btn-primary" data-test="approval-unavailable" aria-describedby="decision-action-reason" disabled>Approval unavailable</button>`;
  }
  return `<section class="cw-card cw-approve cw-approve-sticky" data-test="approval-panel" data-strategy-ref="${strategy ? e(strategy.strategyRef) : ''}">
    <p class="cw-kicker">Decision</p>
    <h2>Approval required before action.</h2>
    <p class="cw-muted v5-decision-intro">Authority is checked separately from whether the trip works.</p>
    <dl class="cw-approval-facts">
      <dt>Approval</dt><dd>${e(authorityLabel(view.authorityState))}</dd>
    </dl>
    ${moneySummaryHtml(candidate)}
    ${conditions.length ? `<p class="cw-muted">${conditions.length} material condition${conditions.length === 1 ? '' : 's'} recorded on the recommendation.</p>` : ''}
    ${actionControls}
    <p data-test="recovery-controls-status" data-action-status role="status"></p>
  </section>`;
}

function researchHtml(view: RecoveryCaseView, m: CaseWorkspaceModel): string {
  const evidence = view.planningEvidence;
  if (!evidence) {
    return `<section class="cw-card" data-test="case-activity"><h3>${e(m.activity.title)}</h3>${rowsHtml(m.activity.rows)}</section>`;
  }
  const groups = groupedResearch(view);
  const rows = groups.map((group) => {
    const outcome = [
      group.succeeded ? `${group.succeeded} completed` : '',
      group.partial ? `${group.partial} partial` : '',
      group.failed ? `${group.failed} failed` : '',
      group.unavailable ? `${group.unavailable} unavailable` : '',
      group.unconfirmed ? `${group.unconfirmed} unconfirmed` : '',
    ].filter(Boolean).join(' · ') || 'No recorded outcome';
    return `<tr data-test="research-group" data-research-group="${group.key}"><th scope="row">${e(group.label)}</th><td>${e(outcome)}</td><td class="cw-muted">${group.sources.map(e).join('<br>')}</td></tr>`;
  }).join('');
  const sources = m.researchSources;
  const sourceList = sources.map((source) => `<li><a href="${e(source.url)}" target="_blank" rel="noopener noreferrer">${e(source.publisher)}</a><br><span class="cw-muted">Checked ${e(source.checkedAt)}</span></li>`).join('');
  const total = evidence.tools.length + (evidence.modelActivities?.length ?? 0);
  return `<section class="cw-card" data-test="case-activity"><h3>What Northstar checked</h3>
    ${groups.length ? `<table class="cw-research-table"><thead><tr><th scope="col">Category</th><th scope="col">Observed outcome</th><th scope="col">Provider / source</th></tr></thead><tbody>${rows}</tbody></table>` : ''}
    ${!groups.length && evidence.domains.length ? list(evidence.domains.map((d) => `${decisionText(d.domain.label, 'Research domain')}: ${decisionText(d.disposition.label, 'Status not supplied')}`)) : ''}
    ${evidence.candidates.length ? `<p class="cw-muted">${evidence.candidates.length} material options evaluated. Rejection and alternative evidence are preserved above.</p>` : ''}
    ${sources.length ? details('evidence-sources', `Sources checked (${sources.length})`, `<ul class="cw-compact-list">${sourceList}</ul>`) : ''}
    ${details('technical-activity', `Show technical activity (${total} tool/model records)`, raw({ domains: evidence.domains, tools: evidence.tools, models: evidence.modelActivities }))}
  </section>`;
}

const ROW_ICON: Record<CaseRow['state'], string> = { done: '✓', doing: '⟳', queued: '○', failed: '✕', note: '–' };
function rowsHtml(rows: readonly CaseRow[]): string {
  return rows.map((row) => `<div class="check-row ${row.state === 'note' ? 'queued' : row.state}" data-row-state="${row.state}"><span class="c-ic" aria-hidden="true">${ROW_ICON[row.state]}</span><span class="c-t">${e(row.label)}</span>${row.note ? `<span class="c-sub">${e(row.note)}</span>` : ''}</div>`).join('');
}
function executionHtml(m: CaseWorkspaceModel): string {
  const execution = m.execution;
  if (!execution) return '';
  const pct = execution.total > 0 ? Math.round(execution.done / execution.total * 100) : 0;
  return `<section class="section" data-test="execution-progress" data-progress-done="${execution.done}" data-progress-total="${execution.total}"><h2>${e(execution.title)}</h2><div class="cw-card">
    <div class="cw-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>${rowsHtml(execution.rows)}${list(execution.warnings)}</div></section>`;
}
function resolutionHtml(m: CaseWorkspaceModel): string {
  if (!m.resolution) return '';
  return `<section class="section-primary-action" data-test="resolution-panel"><p class="cw-kicker">Trip recovered</p><h2>${e(m.resolution.title)}</h2><p>${e(m.resolution.body)}</p>
    <a class="btn btn-primary" href="${SHELL_LINKS.dashboard}" data-test="back-to-overview-cta">${e(CASE_COPY.backToOverviewButton)}</a></section>`;
}
function technicalHtml(view: RecoveryCaseView, m: CaseWorkspaceModel): string {
  return details('technical-details', CASE_COPY.technicalDetails,
    `<p>Full current case evidence: <a href="/api/v2/cases/${encodeURIComponent(view.caseRef)}">JSON view</a></p>
    ${m.technical.unmappedSteps.length ? `<div data-test="focused-graph-unmapped"><p>${m.technical.unmappedSteps.length} causal ${m.technical.unmappedSteps.length === 1 ? 'step' : 'steps'} not shown on the graph</p>${list(m.technical.unmappedSteps)}</div>` : ''}${raw(m.technical)}`);
}

function recommendSheet(view: RecoveryCaseView): string {
  const partitioned = partitionRecoveryOptions(view);
  const strategy = partitioned.programmeAlternative ?? partitioned.recommendedTravel ?? decisionOptions(view).recommended;
  const title = strategy
    ? (partitioned.programmeAlternative && strategy === partitioned.programmeAlternative
      ? 'Consider programme change'
      : decisionTitle(strategy))
    : 'Recommendation not ready';
  const href = partitioned.programmeAlternative && strategy === partitioned.programmeAlternative
    ? '#cw-recommendation'
    : '#cw-recommendation';
  return `<section class="v5-recommend-sheet" data-test="recommend-sheet"><p class="cw-kicker">Recommended recovery</p>
    <h2>${e(title)}</h2>
    <a class="btn btn-primary" href="${href}">Review recommendation →</a></section>`;
}
function caseActivityRail(view: RecoveryCaseView, feed: ActivityFeed | undefined, m: CaseWorkspaceModel): string {
  if (!feed) return compactActivity(m);
  const matched = feed.entries.filter((entry) => entry.caseRef === view.caseRef);
  const scoped = matched.length > 0 ? { ...feed, entries: matched } : feed;
  return renderCompactActivityRail(scoped, { limit: 4, logHref: SHELL_LINKS.activity });
}

function compactActivity(m: CaseWorkspaceModel): string {
  const rows = m.activity.rows.slice(0, 4);
  const body = rows.length
    ? rows.map((row) => `<div class="v5-activity-item"><div aria-hidden="true">${ROW_ICON[row.state]}</div><div><strong>${e(row.label)}</strong>${row.note ? `<p>${e(row.note)}</p>` : ''}</div></div>`).join('')
    : '<p class="cw-muted">No observable activity has been recorded for this case yet.</p>';
  return `<section aria-label="Northstar activity"><h2 class="v5-rail-title">Northstar activity</h2>${body}
    <button type="button" class="v5-text-button" data-drawer-from="[data-poll-region='activity']" data-drawer-title="Northstar activity">View log →</button></section>`;
}
/**
 * Whole-trip state in the rail foot. The supplied verdict is unchanged; only the
 * word an operator reads is. A trip is never implied recovered here unless the
 * supplied verdict says so.
 */
const TRIP_FOOT_LABEL: Record<string, string> = {
  PASS: 'Recovered', FAIL: 'Not yet recovered', UNKNOWN: 'Not confirmed',
};
function wholeTripFoot(view: RecoveryCaseView): string {
  const verdict = view.tripViability.verdict;
  const presented = presentAssessment(verdict);
  const label = TRIP_FOOT_LABEL[verdict] ?? presented.label;
  return `<div class="v5-trip-foot" data-test="whole-trip-state" data-trip-verdict="${e(verdict)}"><span>Whole trip</span><strong class="tone-${presented.tone}">${e(label)}</strong></div>`;
}

export function renderProductRecoveryCase(view: RecoveryCaseView, options: { readonly activity?: ActivityFeed } = {}): string {
  const m = presentCaseWorkspace(view);
  const attrs = `data-case-ref="${e(view.caseRef)}" data-case-status="${e(view.status)}" data-case-phase="${m.phase}" data-projection-revision="${e(String(view.change.projectionRevision))}"${view.change.changeCursor ? ` data-change-cursor="${e(view.change.changeCursor)}"` : ''}`;
  const optionsRegion = `<div data-test="recovery-controls" data-case-ref="${e(view.caseRef)}">
    ${recommendationHtml(view)}${findRecoveryHtml(view, m)}
  </div>`;
  return `${OPERATOR_WORKSPACE_STYLES}<main class="shell product-recovery-case case-workspace v5-workspace" data-test="product-recovery-case" ${attrs}>
    ${region('header', headerHtml(view, m))}
    <div class="v5-case-layout">
      <div class="v5-case-main">
        ${region('graph', graphHtml(view, m))}
        ${region('affects', affectsHtml(m))}
        <div class="v5-case-tabs" role="tablist" aria-label="Recovery evidence">
          <button type="button" class="v5-tab v5-tab-recommended is-active" data-case-tab="recovery" role="tab" aria-selected="true">Recommended recovery</button>
          <button type="button" class="v5-tab" data-case-tab="options" role="tab" aria-selected="false">Other options</button>
          <button type="button" class="v5-tab" data-case-tab="checks" role="tab" aria-selected="false">Checks &amp; sources</button>
        </div>
        <div class="v5-panel" data-case-panel="recovery">
          ${region('options', optionsRegion)}
          ${region('execution', executionHtml(m))}
          ${region('resolution', resolutionHtml(m))}
        </div>
        <div class="v5-panel" data-case-panel="options" hidden>
          ${region('alternatives', `${alternativesHtml(view)}${rejectedHtml(view, m)}${allCandidatesHtml(view)}`)}
        </div>
        <div class="v5-panel" data-case-panel="checks" hidden>
          ${region('activity', researchHtml(view, m))}
          ${region('technical', technicalHtml(view, m))}
        </div>
      </div>
      <aside class="v5-case-rail case-decision-rail" aria-label="Decision">
        ${recommendSheet(view)}
        ${region('approval', approvalHtml(view, m), 'cw-poll-approval')}
        ${caseActivityRail(view, options.activity, m)}
        ${wholeTripFoot(view)}
      </aside>
    </div>
    <dialog class="v5-drawer" data-v5-drawer>
      <div class="v5-drawer-head"><h2 data-v5-drawer-title>Details</h2><button type="button" data-v5-drawer-close>Close</button></div>
      <div class="v5-drawer-body" data-v5-drawer-body></div>
    </dialog>
  </main>${originalCurrentToggleScript()}${casePollingScript({ caseRef: view.caseRef })}${renderCaseWorkspaceScript()}`;
}

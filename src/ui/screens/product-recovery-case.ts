/**
 * A3 operator decision workspace. Default view is the operational summary;
 * disclosures preserve full evidence. Graph state and native disclosures
 * survive refresh. Stops before consequential A4 work.
 */
import type { PlanningCandidateView, RecoveryCaseView, RecoveryStrategyView } from '../../contracts/v2/product/readModels.ts';
import { presentCaseWorkspace, type CaseRow, type CaseWorkspaceModel } from '../../app/target/adapters/caseWorkspacePresenter.ts';
import { SHELL_LINKS } from '../../app/target/productShell.ts';
import { CASE_COPY, CASE_CHANGE_TYPE_SENTENCE, CASE_REASON_SENTENCE } from '../copy.ts';
import { escapeHtml, formatInstant } from '../html.ts';
import { renderFocusedCaseGraph } from '../graph/index.ts';
import { buildOriginalCurrentRegion, originalCurrentToggleScript } from '../originalCurrent.ts';
import { casePollingScript } from '../casePolling.ts';
import { OPERATOR_WORKSPACE_STYLES } from '../operatorWorkspaceStyles.ts';
import {
  authorityLabel, candidateFor, changeSummary, decisionActionState, decisionCosts,
  decisionMoney, decisionOptions, decisionText, decisionTime, decisionTitle,
  groupedResearch, rejectionSummary,
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

function headerHtml(m: CaseWorkspaceModel): string {
  return `<div class="page-head"><h1>${e(m.heading)} ${badge(m.statusLabel, m.statusTone)}</h1>
    <p class="sub">Trip recovery</p><p class="cw-muted"><a href="${SHELL_LINKS.dashboard}" data-test="back-to-overview">${e(CASE_COPY.backToOverview)}</a>
    · Updated <time datetime="${e(m.generatedAt)}">${e(formatInstant(m.generatedAt))}</time></p></div>`;
}

/** Situation: what changed + stake. No instructional “review the page” banner. */
function leadHtml(view: RecoveryCaseView, m: CaseWorkspaceModel): string {
  const changed = decisionText(view.changeSummary,
    (view.cause && CASE_CHANGE_TYPE_SENTENCE[view.cause.changeType]) || 'The current trip needs attention.');
  const reviewing = m.phase === 'awaiting_approval';
  const statusHint = reviewing
    ? `<p class="cw-status-hint" data-test="recommendation-status">Recommendation ready · <a href="#cw-recommendation">Review recommendation</a></p>`
    : '';
  return `<div class="cw-lead"><div class="callout tone-${m.lead.tone}" data-test="case-lead">
    <h2>${e(m.lead.title)}</h2><p>${e(changed)}</p>
    ${m.lead.stake ? `<p><strong>${e(m.lead.stake)}</strong></p>` : ''}
    ${statusHint}</div>
    ${m.attention ? `<div class="callout tone-alert" data-test="case-attention"><h2>${e(m.attention.title)}</h2><p>${e(m.attention.body)}</p></div>` : ''}</div>`;
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
  return `<section class="section cw-graph" data-test="focused-case-graph-section"><h2>${e(CASE_COPY.graphHeading)}</h2>
    ${m.whereItBreaks ? `<p class="graph-caption" data-test="focused-graph-first-breakpoint">Where it breaks: <strong>${e(m.whereItBreaks.label)}</strong> — ${e(m.whereItBreaks.phrase)}.</p>` : ''}
    ${m.phase === 'recovered' ? `<p class="graph-caption" data-test="graph-resolved-note">${e(CASE_COPY.graphResolvedNote)}</p>` : ''}${toggle}</section>`;
}

function affectsHtml(m: CaseWorkspaceModel): string {
  if (!m.affects.items.length && !m.affects.healthyNote) return '';
  return `<section class="section cw-affects" data-test="case-affects"><h2>${e(CASE_COPY.whatThisAffects)}</h2><div class="cw-card">
    <ul class="cw-compact-list">${m.affects.items.map((item) => `<li data-tone="${item.tone}"><strong>${e(item.label)}</strong> — ${e(item.note)}</li>`).join('')}</ul>
    ${m.affects.healthyNote ? `<p class="cw-muted">${e(m.affects.healthyNote)}</p>` : ''}</div></section>`;
}

function changesHtml(strategy: RecoveryStrategyView): string {
  return `<ul class="cw-compact-list">${strategy.changes.map((change) => {
    const appliedWindow = change.currentWindow && change.proposedWindow
      && change.currentWindow.start === change.proposedWindow.start && change.currentWindow.end === change.proposedWindow.end;
    return `<li data-test="strategy-change" data-subject-ref="${e(change.subjectRef)}" data-change-state="${appliedWindow ? 'IN_EFFECT' : 'PROPOSED'}">${e(changeSummary(change))}</li>`;
  }).join('')}</ul>`;
}

/** Compact spend/loss for the decision panel only — not a second full table. */
function moneySummaryHtml(candidate: PlanningCandidateView | undefined): string {
  const cost = decisionCosts(candidate?.costComparison);
  if (cost.unavailable) {
    return `<p class="cw-muted" data-test="cost-unavailable">${e(cost.unavailable.includes('could not be compared') ? cost.unavailable : `Cost could not be compared: ${cost.unavailable}`)}</p>`;
  }
  const exposureNote = cost.exposure.some((line) => /up to/i.test(line.kind.label))
    ? ' · up to (source maximum)'
    : ' · estimate';
  return `<div class="cw-metrics" data-test="cost-separated">
    <div class="cw-metric"><small>Estimated new spend · home currency</small><strong>${e(cost.newSpend?.join(' + ') ?? 'Not supplied')}</strong></div>
    <div class="cw-metric"><small>Potential cancellation loss${exposureNote}</small><strong>${e(cost.potentialLoss?.join(' + ') ?? 'Not supplied')}</strong></div>
  </div>
  ${cost.providerSpend ? `<p class="cw-muted">Original currency: ${e(cost.providerSpend.join(' + '))}.</p>` : ''}`;
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

function proposalHtml(candidate: PlanningCandidateView | undefined): string {
  const p = candidate?.proposal;
  if (!p) return '<p class="cw-muted">Detailed itinerary evidence was not supplied for this option.</p>';
  const flights = p.flights.map((flight) => `<article><p class="cw-kicker">Flight · proposed — not yet applied</p><h4>${e(decisionText(flight.label, 'Replacement flight'))}</h4>
    ${flight.originLabel || flight.destinationLabel ? `<p>${e(decisionText(flight.originLabel, 'Origin not supplied'))} → ${e(decisionText(flight.destinationLabel, 'Destination not supplied'))}</p>` : ''}
    <dl class="cw-times"><div><dt>Depart</dt><dd>${e(decisionTime(flight.departure, flight.departureTimeZone))}</dd></div><div><dt>Arrive</dt><dd>${e(decisionTime(flight.arrival, flight.arrivalTimeZone))}</dd></div></dl></article>`).join('');
  const stays = p.stays.map((stay) => {
    const property = stay.propertyLabel ?? stay.placeLabel;
    const placeContext = stay.propertyLabel && stay.propertyLabel !== stay.placeLabel
      ? `<p class="cw-muted">Place context: ${e(stay.placeLabel)}</p>`
      : '';
    return `<article><p class="cw-kicker">Accommodation · proposed — not yet applied</p><h4>${e(decisionText(property, 'Property not supplied'))}</h4>
    ${placeContext}<p>${e(decisionTime(stay.start, stay.timeZone))} → ${e(decisionTime(stay.end, stay.timeZone))}</p></article>`;
  }).join('');
  const checks = p.programmeChecks ?? [];
  const primaryChecks = checks.filter((c) => c.verdict !== 'PASS');
  primaryChecks.push(...checks.filter((c) => c.verdict === 'PASS').slice(0, Math.max(0, 3 - primaryChecks.length)));
  const remainingChecks = checks.filter((c) => !primaryChecks.includes(c));
  const check = (c: typeof checks[number]): string => `<article><h4>${e(decisionText(c.label, 'Programme commitment'))}</h4>
    <p>${c.verdict === 'PASS' ? 'Preserved under this proposal' : c.verdict === 'FAIL' ? 'Not satisfied under this proposal' : 'Not confirmed under this proposal'}</p>
    ${c.arrival || c.deadline ? `<p class="cw-muted">${c.arrival ? `Arrives ${e(decisionTime(c.arrival, c.timeZone))}` : ''}${c.deadline ? ` · required by ${e(decisionTime(c.deadline, c.timeZone))}` : ''}</p>` : ''}
    ${c.availableMinutes !== undefined || c.requiredMinutes !== undefined ? `<p class="cw-muted">${c.availableMinutes === undefined ? '' : `${c.availableMinutes} min available`}${c.requiredMinutes === undefined ? '' : ` · ${c.requiredMinutes} min required`}${c.transferMinutes === undefined ? '' : ` · ${c.transferMinutes} min transfer`}</p>` : ''}</article>`;
  return `<div class="cw-itinerary">${flights}${stays}</div>
    ${checks.length ? `<div class="cw-block"><h4>Programme commitments</h4><div class="cw-itinerary">${primaryChecks.map(check).join('')}</div>
    ${remainingChecks.length ? details(`programme-checks-${candidate?.candidateKey ?? 'option'}`, `${remainingChecks.length} more commitment checks`, `<div class="cw-itinerary">${remainingChecks.map(check).join('')}</div>`) : ''}</div>` : ''}
    ${p.blockers.length ? `<div class="cw-block" data-test="proposal-conditions"><h4>Conditions still identified in this proposal</h4>${list(p.blockers.map((b) => `${b.verdict === 'FAIL' ? 'Failed' : 'Unconfirmed'} — ${CASE_REASON_SENTENCE[b.reasonCode] ?? 'a recorded check remains unresolved; see Technical details'}.`))}</div>` : ''}`;
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

/** Dominant recommendation card — same strategy/candidate as the decision panel. */
function recommendationHtml(view: RecoveryCaseView): string {
  const options = decisionOptions(view);
  if (options.issue && !options.recommended) {
    return `<section class="section" id="cw-recommendation" data-test="recovery-controls"><div class="callout tone-watch" data-test="recommendation-unavailable"><p>${e(options.issue)}</p></div></section>`;
  }
  const strategy = options.recommended;
  if (!strategy) return '';
  const candidate = candidateFor(view, strategy);
  const outcomes = strategy.resolves.map((person) => `${decisionText(person.personLabel, 'Traveller')} — ${person.projectedVerdict === 'PASS' ? 'trip outcome passes under this proposal' : person.projectedVerdict === 'FAIL' ? 'trip outcome fails under this proposal' : 'trip outcome remains unconfirmed'}.`);
  const basis = (view.planningEvidence?.recommendation?.basis ?? [])
    .map((b) => decisionText(b.summary, '')).filter((text) => text.length > 0 && text.length <= 240).slice(0, 3);
  const reasons = [...outcomes, ...basis].slice(0, 3);
  return `<article class="cw-card cw-rec option-card is-recommended" id="cw-recommendation" data-test="recovery-strategy" data-strategy-ref="${e(strategy.strategyRef)}" data-option-number="${strategy.optionNumber}">
    <p class="cw-kicker">Recommended recovery · proposed — not yet applied</p>
    <h3>${e(decisionTitle(strategy))}</h3>
    ${proposalHtml(candidate)}
    <div class="cw-block"><h4>Why this proposal</h4>${list(reasons)}
      <p class="cw-muted">${strategy.projectedSummary.pass} passed · ${strategy.projectedSummary.fail} failed · ${strategy.projectedSummary.unknown} unconfirmed across ${strategy.projectedSummary.total} assessed items.</p>
      ${details(`outcome-checks-${strategy.strategyRef}`, 'All projected outcome checks', list(strategy.resolves.map((c) => `${c.projectedVerdict === 'PASS' ? 'Passed' : c.projectedVerdict === 'FAIL' ? 'Failed' : 'Unconfirmed'} — ${decisionText(c.personLabel, 'Traveller')}`)))}</div>
    ${strategy.changes.some((c) => c.effectKind === 'CANCEL_STAY') ? '<p class="cw-muted">Cancellation of the displaced stay is proposed, not completed.</p>' : ''}
    ${costBreakdownHtml(candidate, strategy.strategyRef)}
    ${strategy.executionBlocker ? `<p class="cw-muted" data-test="option-execution-blocker"><strong>Execution unavailable:</strong> ${e(decisionText(strategy.executionBlocker.message, 'This runtime cannot execute this option yet.'))}</p>` : ''}
  </article>`;
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
  const options = decisionOptions(view);
  if (!options.alternatives.length) return '';
  return details('viable-alternatives', `${options.alternatives.length} other viable ${options.alternatives.length === 1 ? 'alternative' : 'alternatives'}`,
    `<p class="cw-muted">Concise comparison first. Open an option for its full evaluation.</p>` + options.alternatives.map((strategy) => {
      const candidate = candidateFor(view, strategy);
      const cost = decisionCosts(candidate?.costComparison);
      const spend = cost.newSpend?.join(' + ') ?? (cost.unavailable ? 'Cost not compared' : 'Not supplied');
      return `<article class="cw-card cw-alt option-card" data-test="recovery-strategy" data-strategy-ref="${e(strategy.strategyRef)}" data-option-number="${strategy.optionNumber}">
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
  const preview = considered.slice(0, 3).map((candidate) => {
    const c = rejectionSummary(candidate);
    return `<div class="cw-rejection" data-candidate-key="${e(candidate.candidateKey)}">
      <div><strong>${e(c.label)}</strong><p class="cw-muted">${e(c.status)}</p></div>
      <div><p>${e(c.reason)}</p>
        ${details(`rejection-eval-${candidate.candidateKey}`, 'Inspect evaluation', proposalHtml(candidate))}
      </div></div>`;
  }).join('');
  return `<div class="cw-card cw-block" data-test="rejected-summary"><h3>${m.noPlan ? 'Why the automatic options stopped' : 'Why other options were not chosen'}</h3>
    ${preview}
    ${considered.length > 3 ? `<p class="cw-muted">Showing 3 of ${considered.length} rejected options. Every recorded evaluation remains below.</p>` : ''}
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
    <h2>${strategy ? e(decisionTitle(strategy)) : 'Recommendation not ready'}</h2>
    <dl class="cw-approval-facts">
      <dt>Current decision status</dt><dd>${e(authorityLabel(view.authorityState))}</dd>
      <dt>Approving party</dt><dd>The named approving party is not supplied in this case view. No organiser or traveller authority is assumed.</dd>
    </dl>
    ${moneySummaryHtml(candidate)}
    ${conditions.length ? `<h4>Material conditions</h4>${list(conditions.slice(0, 4))}${conditions.length > 4 ? `<p class="cw-muted">${conditions.length - 4} more in research details.</p>` : ''}<p class="cw-muted">Eligibility checks do not confirm admission or completed arrival formalities.</p>` : ''}
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
  return `<section class="cw-card" data-test="case-activity"><h3>NORTHSTAR activity</h3>
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

export function renderProductRecoveryCase(view: RecoveryCaseView): string {
  const m = presentCaseWorkspace(view);
  const attrs = `data-case-ref="${e(view.caseRef)}" data-case-status="${e(view.status)}" data-case-phase="${m.phase}" data-projection-revision="${e(String(view.change.projectionRevision))}"${view.change.changeCursor ? ` data-change-cursor="${e(view.change.changeCursor)}"` : ''}`;
  const optionsRegion = `<div data-test="recovery-controls" data-case-ref="${e(view.caseRef)}">
    ${recommendationHtml(view)}${findRecoveryHtml(view, m)}
  </div>`;
  return `${OPERATOR_WORKSPACE_STYLES}<main class="shell product-recovery-case case-workspace" data-test="product-recovery-case" ${attrs}>
    ${region('header', headerHtml(m))}
    ${region('lead', leadHtml(view, m))}
    ${region('affects', affectsHtml(m))}
    ${region('graph', graphHtml(view, m))}
    <div class="case-decision-grid">
      <div class="case-decision-main">
        ${region('options', optionsRegion)}
      </div>
      <aside class="case-decision-rail" aria-label="Decision">
        ${region('approval', approvalHtml(view, m), 'cw-poll-approval')}
      </aside>
    </div>
    <div class="case-follow">
      ${region('alternatives', `${alternativesHtml(view)}${rejectedHtml(view, m)}${allCandidatesHtml(view)}`)}
      ${region('activity', researchHtml(view, m))}
      ${region('execution', executionHtml(m))}
      ${region('resolution', resolutionHtml(m))}
      ${region('technical', technicalHtml(view, m))}
    </div>
  </main>${originalCurrentToggleScript()}${casePollingScript({ caseRef: view.caseRef })}`;
}

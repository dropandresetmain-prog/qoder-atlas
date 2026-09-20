/**
 * A3 operator decision workspace. All sections remain keyed polling regions;
 * graph state and native disclosures survive refresh through the existing
 * controllers. This candidate deliberately stops before consequential A4 work.
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
  A3_EXECUTION_PAUSE, authorityLabel, candidateFor, changeSummary, decisionCosts,
  decisionMoney, decisionOptions, decisionText, decisionTime, decisionTitle,
  groupedResearch, rejectionSummary,
} from '../caseDecisionPresentation.ts';

const e = escapeHtml;
const list = (items: readonly string[]): string => `<ul class="cw-compact-list">${items.map((item) => `<li>${e(item)}</li>`).join('')}</ul>`;
const raw = (value: unknown): string => `<pre class="cw-raw">${e(JSON.stringify(value, null, 2) ?? '')}</pre>`;
function region(name: string, html: string): string { return `<div data-poll-region="${name}">${html}</div>`; }
function details(key: string, summary: string, body: string): string {
  return `<details class="cw-details" data-region-key="${e(key)}" data-test="${e(key)}"><summary>${e(summary)}</summary>${body}</details>`;
}
function badge(label: string, tone: string): string { return `<span class="badge tone-${tone}">${e(label)}</span>`; }

function headerHtml(m: CaseWorkspaceModel): string {
  return `<div class="page-head"><h1>${e(m.heading)} ${badge(m.statusLabel, m.statusTone)}</h1>
    <p class="sub">Trip recovery</p><p class="cw-muted"><a href="${SHELL_LINKS.dashboard}" data-test="back-to-overview">${e(CASE_COPY.backToOverview)}</a>
    · Updated <time datetime="${e(m.generatedAt)}">${e(formatInstant(m.generatedAt))}</time></p></div>`;
}
function leadHtml(view: RecoveryCaseView, m: CaseWorkspaceModel): string {
  const reviewing = m.phase === 'awaiting_approval';
  // Do not repeat a presenter-selected fallback as though the planner selected it.
  const changed = decisionText(view.changeSummary,
    (view.cause && CASE_CHANGE_TYPE_SENTENCE[view.cause.changeType]) || 'The current trip needs attention.');
  const body = reviewing ? `${changed} Review the proposed recovery, costs and remaining conditions below.` : m.lead.body;
  return `<div class="cw-lead"><div class="callout tone-${m.lead.tone}" data-test="case-lead">
    <h2>${e(reviewing ? 'Recommendation review' : m.lead.title)}</h2><p>${e(body)}</p>
    ${m.lead.stake ? `<p><strong>${e(m.lead.stake)}</strong></p>` : ''}</div>
    ${m.attention ? `<div class="callout tone-alert" data-test="case-attention"><h2>${e(m.attention.title)}</h2><p>${e(m.attention.body)}</p></div>` : ''}</div>`;
}

/** V5.6 and immutable Original are deliberately unchanged. */
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
  return `<section class="section" data-test="case-affects"><h2>${e(CASE_COPY.whatThisAffects)}</h2><div class="cw-card">
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
function costHtml(candidate: PlanningCandidateView | undefined, key: string): string {
  const cost = decisionCosts(candidate?.costComparison);
  if (cost.unavailable) return `<p class="cw-muted" data-test="cost-unavailable">${e(cost.unavailable)}</p>`;
  const rows = (lines: typeof cost.spend, category: 'spend' | 'exposure' | 'other'): string => lines.map((line) => `<tr>
    <td>${e(decisionText(line.kind.label, 'Comparison item'))}${category === 'exposure' ? '<br>Potential loss · estimate only' : category === 'spend' ? '<br>Proposed expenditure' : '<br>Other recorded comparison item'}</td>
    <td>${e(decisionMoney(line.providerAmount))}</td><td>${e(decisionMoney(line.homeAmount))}</td></tr>`).join('');
  const fx = cost.comparison?.selectedFxEvidence ?? [];
  return `<div data-test="cost-separated">
    <div class="cw-metrics"><div class="cw-metric"><small>Estimated new spend · home currency</small><strong>${e(cost.newSpend?.join(' + ') ?? 'Not supplied')}</strong></div>
    <div class="cw-metric"><small>Potential cancellation loss · estimate</small><strong>${e(cost.potentialLoss?.join(' + ') ?? 'Not supplied')}</strong></div></div>
    ${cost.providerSpend ? `<p class="cw-muted">New spending in original provider currency: ${e(cost.providerSpend.join(' + '))}.</p>` : ''}
    <p class="cw-muted">These are comparison figures, not confirmed charges or refunds. Potential loss is separate from new spending; no cancellation is implied.</p>
    <table class="cw-cost-table"><thead><tr><th scope="col">Item</th><th scope="col">Provider currency</th><th scope="col">Home comparison</th></tr></thead>
    <tbody>${rows(cost.spend, 'spend')}${rows(cost.exposure, 'exposure')}${rows(cost.other, 'other')}</tbody></table>
    ${details(`cost-evidence-${key}`, 'FX and comparison evidence',
      `${cost.comparison ? `<p>Recorded comparison total (including the listed exposure): <strong>${e(decisionMoney(cost.comparison.totalHomeAmount))}</strong>.</p><p class="cw-muted">Compared ${e(formatInstant(cost.comparison.comparedAt))}.</p>` : ''}
      ${fx.length ? list(fx.map((rate) => `${decisionText(rate.source.label, 'Recorded exchange-rate source')}: ${rate.baseCurrency} → ${rate.homeCurrency} at ${rate.rate}; reference ${formatInstant(rate.observedAt)}${rate.validUntil ? `; valid until ${formatInstant(rate.validUntil)}` : ''}.`)) : '<p>No exchange-rate record was supplied.</p>'}`)}
  </div>`;
}
function proposalHtml(candidate: PlanningCandidateView | undefined): string {
  const p = candidate?.proposal;
  if (!p) return '<p class="cw-muted">Detailed itinerary evidence was not supplied for this option.</p>';
  const flights = p.flights.map((flight) => `<article><p class="cw-kicker">Flight · proposed</p><h4>${e(decisionText(flight.label, 'Replacement flight'))}</h4>
    ${flight.originLabel || flight.destinationLabel ? `<p>${e(decisionText(flight.originLabel, 'Origin not supplied'))} → ${e(decisionText(flight.destinationLabel, 'Destination not supplied'))}</p>` : ''}
    <dl class="cw-times"><div><dt>Depart</dt><dd>${e(decisionTime(flight.departure, flight.departureTimeZone))}</dd></div><div><dt>Arrive</dt><dd>${e(decisionTime(flight.arrival, flight.arrivalTimeZone))}</dd></div></dl></article>`).join('');
  // The current proposal has no stay-role field. Keep properties and windows
  // readable without guessing overnight/destination identity from city names.
  const stays = p.stays.map((stay) => `<article><p class="cw-kicker">Accommodation · proposed</p><h4>${e(decisionText(stay.placeLabel, 'Property not supplied'))}</h4>
    <p>${e(decisionTime(stay.start, stay.timeZone))} → ${e(decisionTime(stay.end, stay.timeZone))}</p></article>`).join('');
  const checks = p.programmeChecks ?? [];
  // Failed/unknown commitments must never disappear behind healthy context.
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
function optionHtml(view: RecoveryCaseView, strategy: RecoveryStrategyView, recommended: boolean): string {
  const candidate = candidateFor(view, strategy);
  const outcomes = strategy.resolves.map((person) => `${decisionText(person.personLabel, 'Traveller')} — ${person.projectedVerdict === 'PASS' ? 'trip outcome passes under this proposal' : person.projectedVerdict === 'FAIL' ? 'trip outcome fails under this proposal' : 'trip outcome remains unconfirmed'}.`);
  const basis = recommended ? (view.planningEvidence?.recommendation?.basis ?? [])
    .map((b) => decisionText(b.summary, '')).filter((text) => text.length > 0 && text.length <= 240).slice(0, 2) : [];
  return `<article class="cw-card ${recommended ? 'cw-rec option-card is-recommended' : 'cw-alt option-card'}" data-test="recovery-strategy" data-strategy-ref="${e(strategy.strategyRef)}" data-option-number="${strategy.optionNumber}">
    <p class="cw-kicker">${recommended ? 'Recommended recovery' : `Alternative ${strategy.optionNumber}`} · proposal only</p><h3>${e(decisionTitle(strategy))}</h3>
    <p class="cw-muted">No bookings or cancellations are implied by this recommendation.</p>
    ${proposalHtml(candidate)}
    <div class="cw-block"><h4>What would change</h4>${changesHtml(strategy)}${strategy.changes.some((c) => c.effectKind === 'CANCEL_STAY') ? '<p class="cw-muted">Cancellation of the displaced stay is proposed, not completed.</p>' : ''}</div>
    <div class="cw-block"><h4>${recommended ? 'Why NORTHSTAR recommends it' : 'Projected outcome'}</h4>${list([...outcomes, ...basis])}
    <p class="cw-muted">${strategy.projectedSummary.pass} passed · ${strategy.projectedSummary.fail} failed · ${strategy.projectedSummary.unknown} unconfirmed, across ${strategy.projectedSummary.total} assessed items. These are proposed-world checks, not completed recovery.</p></div>
    <div class="cw-block"><h4>Cost and exposure</h4>${costHtml(candidate, strategy.strategyRef)}</div>
    ${strategy.executionBlocker ? `<p class="cw-muted" data-test="option-execution-blocker"><strong>Execution unavailable:</strong> ${e(decisionText(strategy.executionBlocker.message, 'This runtime cannot execute this option yet.'))}</p>` : ''}
    ${details(`strategy-details-${strategy.strategyRef}`, 'Technical details', raw({ strategy, candidate }))}</article>`;
}
function optionsHtml(view: RecoveryCaseView, m: CaseWorkspaceModel): string {
  const options = decisionOptions(view);
  const chunks: string[] = [];
  if (options.issue) chunks.push(`<div class="callout tone-watch" data-test="recommendation-unavailable"><p>${e(options.issue)}</p></div>`);
  if (options.recommended) chunks.push(optionHtml(view, options.recommended, true));
  if (options.alternatives.length) chunks.push(details('viable-alternatives', `${options.alternatives.length} ${options.recommended ? 'other ' : ''}viable ${options.alternatives.length === 1 ? 'alternative' : 'alternatives'}`,
    options.alternatives.map((strategy) => optionHtml(view, strategy, false)).join('')));
  if (m.showFindRecovery) chunks.push(`<div class="cw-card" data-test="find-recovery"><h3>${e(CASE_COPY.findRecovery)}</h3><p>${e(CASE_COPY.findRecoveryHint)}</p>
    <button type="button" class="btn btn-primary" data-action="recover" data-test="propose-strategies" data-case-ref="${e(view.caseRef)}" data-request-path="/api/v2/cases/${encodeURIComponent(view.caseRef)}/strategies" data-busy-label="Checking the trip…">${e(CASE_COPY.findRecovery)}</button>
    <p data-test="recovery-controls-status" data-action-status role="status"></p></div>`);
  if (m.noPlan) chunks.push(`<div class="cw-card" data-test="no-plan"><p>${e(CASE_COPY.noPlanBody)}</p>
    <button type="button" class="btn btn-ghost" data-action="escalate" data-test="escalate-case" data-case-ref="${e(view.caseRef)}" data-busy-label="Handing off…">${e(CASE_COPY.escalate)}</button><p data-test="recovery-controls-status" data-action-status role="status"></p></div>`);
  const considered = (view.planningEvidence?.candidates ?? []).filter((c) => c.disposition.code === 'REJECTED_VALIDATION' || c.disposition.code === 'REJECTED_DETERMINISTIC');
  if (considered.length) {
    chunks.push(`<div class="cw-card cw-block" data-test="rejected-summary"><h3>${m.noPlan ? 'Why the automatic options stopped' : 'Why other options were not chosen'}</h3>${considered.slice(0, 3).map((candidate) => {
      const c = rejectionSummary(candidate);
      return `<div class="cw-rejection"><div><strong>${e(c.label)}</strong><p class="cw-muted">${e(c.status)}</p></div><div><p>${e(c.reason)}</p>${candidate.costComparison?.status === 'AVAILABLE' ? `<p class="cw-muted">Compared cost: ${e(decisionMoney(candidate.costComparison.totalHomeAmount))} (recorded comparison, including any listed exposure).</p>` : ''}</div></div>`;
    }).join('')}${considered.length > 3 ? `<p class="cw-muted">Showing 3 of ${considered.length} considered options that were rejected. Every recorded evaluation remains below.</p>` : ''}</div>`);
  }
  const allCandidates = view.planningEvidence?.candidates ?? [];
  if (allCandidates.length) chunks.push(details('other-options', `Show detailed evaluation (${allCandidates.length} recorded options)`, `<h4>Other options considered (${allCandidates.length})</h4>` + allCandidates.map((candidate) => {
    const c = rejectionSummary(candidate);
    return `<article><h4>${e(c.label)} · ${e(c.status)}</h4><p>${e(c.reason)}</p>${details(`evaluation-${candidate.candidateKey}`, 'Technical details', raw(candidate))}</article>`;
  }).join('')));
  return chunks.length ? `<section class="section" data-test="recovery-controls" data-case-ref="${e(view.caseRef)}"><h2>${options.recommended ? 'Recommended recovery' : 'Recovery options'}</h2>${chunks.join('')}</section>` : '';
}

function approvalHtml(view: RecoveryCaseView, m: CaseWorkspaceModel): string {
  if (m.phase !== 'awaiting_approval' && view.status !== 'AWAITING_AUTHORITY') return '';
  const strategy = decisionOptions(view).recommended;
  const cost = decisionCosts(strategy ? candidateFor(view, strategy)?.costComparison : undefined);
  return `<section class="cw-card cw-approve" data-test="approval-panel"><p class="cw-kicker">Decision checkpoint</p><h2>${strategy ? 'What you’re reviewing' : 'Recommendation not ready'}</h2>
    <p>${strategy ? e(decisionTitle(strategy)) : 'A specific current recommendation must be identified before approval.'}</p>
    <dl class="cw-approval-facts"><dt>Current decision status</dt><dd>${e(authorityLabel(view.authorityState))}</dd>
    <dt>Approving party</dt><dd>The named approving party is not supplied in this case view. No organiser or traveller authority is assumed.</dd>
    <dt>Estimated new spend</dt><dd>${e(cost.newSpend?.join(' + ') ?? 'Not supplied')}</dd><dt>Potential cancellation loss</dt><dd>${e(cost.potentialLoss?.join(' + ') ?? 'Not supplied')} · estimate only</dd></dl>
    ${strategy ? details('approval-changes', `${strategy.changes.length} proposed changes to review`, changesHtml(strategy)) : ''}
    ${strategy?.executionBlocker ? `<p data-test="decision-execution-blocker">${e(decisionText(strategy.executionBlocker.message, 'This option cannot be executed by this runtime yet.'))}</p>` : ''}
    ${m.researchNotes.length || view.uncertainty.length ? `<h4>Conditions to review</h4>${list([...new Set([...view.uncertainty.map((v) => decisionText(v, 'Details remain unconfirmed.')), ...m.researchNotes])].slice(0, 2))}<p class="cw-muted">See Evidence and remaining conditions for all supplied caveats.</p>` : ''}
    <p id="a3-execution-pause" class="cw-muted">${e(A3_EXECUTION_PAUSE)}</p>
    <button type="button" class="btn btn-primary" data-test="approval-unavailable" aria-describedby="a3-execution-pause" disabled>Approval and execution unavailable</button>
    <p data-test="recovery-controls-status" data-action-status role="status"></p></section>`;
}

function evidenceHtml(view: RecoveryCaseView, m: CaseWorkspaceModel): string {
  const sources = m.researchSources;
  const sourceList = sources.map((source) => `<li><a href="${e(source.url)}" target="_blank" rel="noopener noreferrer">${e(source.publisher)}</a><br><span class="cw-muted">Checked ${e(source.checkedAt)}</span></li>`).join('');
  const currentNotes = [...new Set(view.uncertainty.map((text) => decisionText(text, '')).filter(Boolean))];
  const formalities = m.researchNotes.filter((note) => !currentNotes.includes(note));
  const strategy = decisionOptions(view).recommended;
  const entry = strategy ? candidateFor(view, strategy)?.proposal?.entryResults ?? [] : [];
  return `<section class="cw-card" data-test="case-evidence"><h3>Evidence and remaining conditions</h3>
    ${view.planningEvidence ? `<p class="cw-muted">Evidence captured during planning: ${e(formatInstant(view.planningEvidence.asOf))}. Current trip state is shown separately in the graph.</p>` : '<p class="cw-muted">No planning evidence has been supplied yet.</p>'}
    ${entry.length ? `<h4>Entry checks for this proposal</h4>${list(entry.map((result) => `${result.dimension.split('_').join(' ')}: ${result.verdict === 'PASS' ? 'eligibility check passed' : result.verdict === 'FAIL' ? 'check failed' : 'not confirmed'}.`))}<p class="cw-muted">An eligibility check does not confirm admission or completion of arrival formalities.</p>` : ''}
    ${currentNotes.length ? `<h4>Still unresolved</h4>${list(currentNotes)}` : ''}
    ${formalities.length ? `<h4>Research caveats and formalities</h4>${list(formalities)}` : ''}
    ${view.remainingRecoveryWork.length ? details('remaining-work', 'Remaining recovery work', list(view.remainingRecoveryWork.map((text) => decisionText(text, 'See recorded recovery evidence for this outstanding item.')))) : ''}
    ${sources.length ? details('evidence-sources', `Sources checked (${sources.length})`, `<ul class="cw-compact-list">${sourceList}</ul>`) : '<p class="cw-muted">No linked sources were supplied.</p>'}
  </section>`;
}
function activityHtml(view: RecoveryCaseView, m: CaseWorkspaceModel): string {
  const evidence = view.planningEvidence;
  if (!evidence) return `<section class="cw-card" data-test="case-activity"><h3>${e(m.activity.title)}</h3>${rowsHtml(m.activity.rows)}</section>`;
  const groups = groupedResearch(view);
  const stages = groups.map((group) => `<article class="cw-stage" data-test="research-group" data-research-group="${group.key}"><h4>${e(group.label)}</h4>
    <p>${group.succeeded} completed${group.partial ? ` · ${group.partial} partial` : ''}${group.failed ? ` · ${group.failed} failed` : ''}${group.unavailable ? ` · ${group.unavailable} unavailable` : ''}${group.unconfirmed ? ` · ${group.unconfirmed} unconfirmed` : ''}</p>
    <p class="cw-muted">${group.sources.map(e).join('<br>')}</p></article>`).join('');
  const comparisons = evidence.candidates.filter((c) => c.costComparison?.status === 'AVAILABLE').length;
  const total = evidence.tools.length + (evidence.modelActivities?.length ?? 0);
  return `<section class="cw-card" data-test="case-activity"><h3>${e(m.activity.title)}</h3>${stages}${!groups.length && evidence.domains.length ? list(evidence.domains.map((d) => `${decisionText(d.domain.label, 'Research domain')}: ${decisionText(d.disposition.label, 'Status not supplied')}`)) : ''}
    ${comparisons ? `<article class="cw-stage"><h4>Cost and currency comparisons</h4><p>${comparisons} recorded comparisons. Price and FX provenance are available with each option.</p></article>` : ''}
    ${evidence.candidates.length ? `<article class="cw-stage"><h4>Whole-trip option evaluation</h4><p>${evidence.candidates.length} material options evaluated. Outcomes and rejection evidence are preserved in the comparison.</p></article>` : ''}
    ${details('technical-activity', `Show technical activity (${total} tool/model records)`, details('raw-activity-evidence', 'Technical details', raw({ domains: evidence.domains, tools: evidence.tools, models: evidence.modelActivities })))}</section>`;
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
function checkedHtml(view: RecoveryCaseView, m: CaseWorkspaceModel): string {
  // The older presenter's fallback can select a different executable option.
  // This rail must describe the same recorded recommendation as the main card.
  if (m.phase !== 'recovered') {
    const strategy = decisionOptions(view).recommended;
    if (!strategy) return '';
    return details('case-check-results', CASE_COPY.whatWeChecked, `<div data-test="case-checked">${list(strategy.resolves.map((c) => `${c.projectedVerdict === 'PASS' ? 'Passed' : c.projectedVerdict === 'FAIL' ? 'Failed' : 'Unconfirmed'} — ${decisionText(c.personLabel, 'Traveller')} under the recommended proposal.`))}
      <p class="cw-muted">${strategy.projectedSummary.pass} passed · ${strategy.projectedSummary.fail} failed · ${strategy.projectedSummary.unknown} unconfirmed across ${strategy.projectedSummary.total} assessed items. No recovery has been confirmed by these proposed-world checks.</p></div>`);
  }
  if (!m.checked.length) return '';
  return details('case-check-results', CASE_COPY.whatWeChecked, `<div data-test="case-checked">${list(m.checked.map((c) => `${c.ok === true ? 'Passed' : c.ok === false ? 'Failed' : 'Unconfirmed'} — ${c.label}`))}${m.checkedFootnote ? `<p class="cw-muted">${e(m.checkedFootnote)}</p>` : ''}</div>`);
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
function railHtml(m: CaseWorkspaceModel): string {
  return m.lead.stake ? `<section class="cw-card" data-test="rail-stake"><h3>Commitment at stake</h3><p>${e(m.lead.stake.replace(/^At stake: /, ''))}</p></section>` : '';
}

export function renderProductRecoveryCase(view: RecoveryCaseView): string {
  const m = presentCaseWorkspace(view);
  const attrs = `data-case-ref="${e(view.caseRef)}" data-case-status="${e(view.status)}" data-case-phase="${m.phase}" data-projection-revision="${e(String(view.change.projectionRevision))}"${view.change.changeCursor ? ` data-change-cursor="${e(view.change.changeCursor)}"` : ''}`;
  return `${OPERATOR_WORKSPACE_STYLES}<main class="shell product-recovery-case case-workspace" data-test="product-recovery-case" ${attrs}>
    ${region('header', headerHtml(m))}${region('lead', leadHtml(view, m))}
    <div class="case-grid"><div class="case-flow">
      ${region('graph', graphHtml(view, m))}${region('affects', affectsHtml(m))}${region('options', optionsHtml(view, m))}
      ${region('execution', executionHtml(m))}${region('resolution', resolutionHtml(m))}${region('technical', technicalHtml(view, m))}
    </div><aside class="case-rail" aria-label="Decision and evidence">
      ${region('approval', approvalHtml(view, m))}${region('rail', railHtml(m))}${region('evidence', evidenceHtml(view, m))}
      ${region('activity', activityHtml(view, m))}${region('checked', checkedHtml(view, m))}
    </aside></div></main>${originalCurrentToggleScript()}${casePollingScript({ caseRef: view.caseRef })}`;
}

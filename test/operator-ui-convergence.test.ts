/** A3 rendering contracts, using generic supplied views, no database/providers. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { OperatorOverview, PlanningCandidateView, PlanningToolEvidenceView, RecoveryCaseView, RecoveryStrategyView } from '../src/contracts/v2/product/readModels.ts';
import { renderProductRecoveryCase } from '../src/ui/screens/product-recovery-case.ts';
import { renderProductOperatorOverview } from '../src/ui/screens/product-operator-overview.ts';
import { A3_EXECUTION_PAUSE, decisionCosts, decisionOptions, groupedResearch, rejectionSummary, sameStrategy, sumDisplayedMoney } from '../src/ui/caseDecisionPresentation.ts';

const at = '2032-04-03T08:00:00.000Z';
const change = { projectionRevision: 7, changedVisibleRefs: [], changedEdgeIds: [], currentSemanticState: 'AFFECTED' as const, changeCursor: '91' };
const strategy = (id: string, n: number): RecoveryStrategyView => ({
  strategyRef: id, version: n, optionNumber: n, status: 'EVALUATED', viability: 'VIABLE',
  changes: [{ effectKind: 'SELECT_OFFER', subjectRef: 'JOURNEY_ITEM:leg', subjectLabel: 'Outbound travel' }],
  resolves: [{ subjectRef: 'JOURNEY:traveller', personLabel: 'Traveller Alpha', currentVerdict: 'FAIL', projectedVerdict: 'PASS' }],
  projectedSummary: { total: 1, pass: 1, fail: 0, unknown: 0 }, projectedPeople: [],
});
const candidate = (id: string, disposition: string = 'RECOMMENDED'): PlanningCandidateView => ({
  candidateKey: `option-${id}`, strategyRef: id,
  domain: { label: 'Transport', code: 'TRANSPORT' }, proposer: { label: 'Travel planning' },
  disposition: { label: 'Recorded result', code: disposition }, reasons: [], outcomeDelta: [],
  proposal: { flights: [{ label: 'Rail service 42', originLabel: 'Origin terminal', destinationLabel: 'Destination terminal', departure: at, arrival: '2032-04-03T10:00:00.000Z', departureTimeZone: 'UTC', arrivalTimeZone: 'UTC' }],
    stays: [{ placeLabel: 'Terminal hotel', start: at, end: '2032-04-04T08:00:00.000Z' }], entryResults: [], blockers: [], programmeChecks: [] },
  costComparison: { status: 'AVAILABLE', homeCurrency: 'SGD', comparedAt: at,
    totalHomeAmount: { amount: '160.00', currency: 'SGD' }, selectedFxEvidence: [{ source: { label: 'Published reference feed' }, baseCurrency: 'USD', homeCurrency: 'SGD', rate: 1.25, observedAt: at }],
    lines: [
      { kind: { code: 'SELECT_OFFER', label: 'Replacement travel' }, providerAmount: { amount: '80.00', currency: 'USD' }, homeAmount: { amount: '100.00', currency: 'SGD' }, observed: true },
      { kind: { code: 'ADD_JOURNEY_STAY', label: 'Accommodation' }, providerAmount: { amount: '32.00', currency: 'USD' }, homeAmount: { amount: '40.00', currency: 'SGD' }, observed: true },
      { kind: { code: 'POLICY_PENALTY_ESTIMATE', label: 'Cancellation exposure' }, providerAmount: { amount: '16.00', currency: 'USD' }, homeAmount: { amount: '20.00', currency: 'SGD' }, observed: false },
    ] },
});
function view(): RecoveryCaseView {
  return { generatedAt: at, caseRef: 'case-alpha', status: 'AWAITING_AUTHORITY', changeSummary: 'A booked service changed its schedule.', subjectLabels: {}, causalPath: [],
    bookingServiceState: { label: 'Transport booking', state: 'AFFECTED' }, tripViability: { label: 'Trip', verdict: 'FAIL' }, affectedItems: [],
    strategies: [{ ...strategy('selected', 1), executionBlocker: { code: 'NOT_COMPOSED', message: 'The booking provider is not enabled in this runtime.' } }, strategy('alternative', 2)],
    authorityState: 'PENDING', executionState: 'None', reconciliationState: 'Settled', uncertainty: ['Arrival formalities remain outstanding.'],
    recoveryActions: [], attention: [], remainingRecoveryWork: [], duplicateBookingExposure: [],
    planningEvidence: { phase: 'DECISION_TIME', asOf: at, attemptRef: 'attempt', coordinatorVersion: 'v1', outcome: { label: 'Awaiting authority', code: 'AWAITING_AUTHORITY' }, domains: [], tools: [], modelActivities: [],
      candidates: [candidate('selected'), candidate('alternative', 'VIABLE_NOT_RECOMMENDED')], viableStrategies: [{ label: 'Selected recovery', ref: 'RECOVERY_STRATEGY:selected' }, { label: 'Alternative recovery', ref: 'RECOVERY_STRATEGY:alternative' }],
      recommendation: { recommended: { label: 'Selected recovery', ref: 'RECOVERY_STRATEGY:selected' }, alternatives: [{ label: 'Alternative recovery', ref: 'RECOVERY_STRATEGY:alternative' }], basis: [], provenance: { label: 'Recorded comparison' } } },
    ldg: { scope: 'FOCUSED_CASE', nodes: [{ ref: 'JOURNEY:traveller', kind: 'TRAVELLER', label: 'Traveller Alpha', semanticState: 'FAILED', authority: 'AUTHORITATIVE' }], edges: [], change }, change,
  };
}
function overview(): OperatorOverview {
  const v = view();
  const population = Array.from({ length: 12 }, (_, i) => ({ journeyRef: `journey-${i}`, tripRef: `trip-${i}`, travellerLabel: `Participant ${i}`, obligation: 'REQUIRED' as const,
    status: i === 0 ? 'DISRUPTED' as const : 'READY' as const, remainderViability: i === 0 ? 'NOT_VIABLE' as const : 'VIABLE' as const,
    evaluation: 'CURRENT' as const, ...(i === 0 ? { caseRef: v.caseRef } : {}) }));
  return { generatedAt: at, summary: { ready: 0, disrupted: 1, atRisk: 0, recovering: 0, unknown: 0 },
    items: [{ tripRef: 'trip-0', travellerLabel: 'Participant 0', status: 'DISRUPTED', remainderViability: 'NOT_VIABLE', caseRef: v.caseRef, whatChanged: 'A booked service changed.', affectedPeople: [], affectedItems: ['journey-0'], decisionRequired: true, unresolvedUncertainty: [] }],
    population, populationSummary: { total: 12, ready: 11, disrupted: 1, atRisk: 0, recovering: 0, unknown: 0, notAssessed: 0 }, populationAssessmentLifecycle: { state: 'SETTLED', pendingCount: 0 },
    ldg: { ...v.ldg, scope: 'DASHBOARD' }, change };
}

test('Overview case navigation dominates and the full searchable population remains present', () => {
  const html = renderProductOperatorOverview(overview());
  assert.match(html, /data-test="attention-open-case">Open case →/);
  assert.match(html, /class="case-open"[^>]+data-test="population-case-link">Open case<\/a>/);
  assert.match(html, /data-test="population-traveller-link"[^>]*>Traveller view<\/a>/);
  assert.doesNotMatch(html, /Open case →Show interaction/);
  assert.equal((html.match(/data-test="population-row"[^>]*data-journey-ref=/g) ?? []).length, 12);
  assert.equal((html.match(/data-test="population-row" hidden[^>]*data-journey-ref=/g) ?? []).length, 2);
  assert.ok(html.indexOf('data-poll-region="overview-attention"') < html.indexOf('data-test="simulated-airline-update"'));
});
test('the recorded recommendation is not replaced by an executable alternative', () => {
  const result = decisionOptions(view());
  assert.equal(result.recommended?.strategyRef, 'selected');
  assert.equal(result.alternatives.length, 1);
  assert.equal(result.alternatives[0]?.strategyRef, 'alternative');
  assert.ok(sameStrategy('RECOVERY_STRATEGY:selected', 'selected'));
  assert.equal(sameStrategy('unexpected-selected', 'selected'), false);
});
test('no recorded recommendation means no invented recommended card', () => {
  const v = view(); delete v.planningEvidence!.recommendation;
  const result = decisionOptions(v);
  assert.equal(result.recommended, undefined);
  assert.equal(result.alternatives.length, 2);
  assert.ok(result.issue);
});
test('recommendation is expanded, alternatives collapsed, execution blocked with a reason', () => {
  const html = renderProductRecoveryCase(view());
  const recommended = html.indexOf('data-strategy-ref="selected"');
  const alternatives = html.indexOf('data-region-key="viable-alternatives"');
  assert.ok(recommended > 0 && recommended < alternatives);
  assert.match(html, /<details[^>]+data-region-key="viable-alternatives"[^>]*><summary>1 other viable alternative/);
  assert.doesNotMatch(html, /<details[^>]+data-region-key="viable-alternatives"[^>]*\bopen\b/);
  assert.match(html, /data-test="approval-panel"/);
  assert.match(html, /data-test="approval-unavailable"[^>]*disabled/);
  assert.ok(html.includes(A3_EXECUTION_PAUSE));
  assert.doesNotMatch(html, /<button[^>]+data-strategy-ref=/);
  assert.doesNotMatch(html, /<button[^>]+data-action="(?:recover|decline)"/);
  assert.match(html, /Arrival formalities remain outstanding/);
  assert.match(html, /named approving party is not supplied/);
});
test('exact price totals keep expenditure, provider currency and potential loss separate', () => {
  const cost = decisionCosts(candidate('selected').costComparison);
  assert.deepEqual(cost.newSpend, ['SGD 140.00']);
  assert.deepEqual(cost.providerSpend, ['USD 112.00']);
  assert.deepEqual(cost.potentialLoss, ['SGD 20.00']);
  assert.deepEqual(sumDisplayedMoney([{ amount: '0.10', currency: 'USD' }, { amount: '0.20', currency: 'USD' }]), ['USD 0.30']);
  assert.deepEqual(sumDisplayedMoney([{ amount: '1', currency: 'JPY' }, { amount: '0.20', currency: 'USD' }]), ['JPY 1', 'USD 0.20']);
  assert.equal(sumDisplayedMoney([{ amount: '1e5', currency: 'USD' }]), undefined);
  assert.equal(decisionCosts(undefined).unavailable?.includes('free'), true);
  const html = renderProductRecoveryCase(view());
  assert.match(html, /not confirmed charges or refunds/);
  assert.match(html, /Published reference feed/);
});
test('rejection uses recorded timing failure rather than an invented ranking reason', () => {
  const c = candidate('rejected', 'REJECTED_DETERMINISTIC');
  c.proposal!.blockers = [{ dimension: 'connection_feasibility', verdict: 'FAIL', reasonCode: 'connection_below_minimum', timing: { gapMinutes: 20, requiredMinutes: 50 } }];
  const result = rejectionSummary(c);
  assert.equal(result.status, 'Rejected');
  assert.match(result.reason, /not enough time to connect/);
  assert.match(result.reason, /Time available: 20 min; Time required: 50 min/);
  const v = view(); v.planningEvidence!.candidates.push(c);
  const html = renderProductRecoveryCase(v);
  assert.match(html, /data-test="rejected-summary"/);
  assert.match(html, /Show detailed evaluation \(3 recorded options\)/);
});
test('partial and unavailable research are not labelled completed successes', () => {
  const tool = (status: string): PlanningToolEvidenceView => ({ tool: { label: 'Hotel search', code: 'hotel.search' }, status: { label: status, code: status }, provenanceMode: { label: 'Live', code: 'LIVE' }, provider: 'Provider A', summary: 'Recorded response.', uncertainties: [], evidenceRef: `e-${status}` });
  const v = view(); v.planningEvidence!.tools = [tool('SUCCEEDED'), tool('PARTIAL'), tool('UNAVAILABLE')];
  const result = groupedResearch(v);
  assert.equal(result.length, 1);
  assert.deepEqual([result[0]!.succeeded, result[0]!.partial, result[0]!.unavailable], [1, 1, 1]);
  const html = renderProductRecoveryCase(v);
  assert.match(html, /1 completed · 1 partial · 1 unavailable/);
  assert.match(html, /Show technical activity \(3 tool\/model records\)/);
});
test('polling regions, immutable Original, graph and terminal behavior remain composed', () => {
  const v = view(), html = renderProductRecoveryCase(v);
  for (const name of ['header', 'lead', 'graph', 'affects', 'options', 'approval', 'execution', 'activity', 'checked', 'resolution', 'technical', 'rail', 'evidence']) {
    assert.equal((html.match(new RegExp(`data-poll-region="${name}"`, 'g')) ?? []).length, 1, name);
  }
  assert.match(html, /data-test="original-current-toggle"/);
  assert.match(html, /data-test="focused-case-graph"/);
  assert.match(html, /data-change-cursor="91"/);
  assert.match(html, /sinceCursor/);
  const terminal = renderProductRecoveryCase({ ...v, status: 'RESOLVED' });
  assert.doesNotMatch(terminal, /data-test="approval-panel"/);
  assert.doesNotMatch(terminal, /data-test="propose-strategies"/);
});
test('labels are escaped and generic rendering contains no persona branches', () => {
  const v = view(); v.planningEvidence!.candidates[0]!.proposal!.flights[0]!.label = '<img src=x onerror=alert(1)>';
  const html = renderProductRecoveryCase(v);
  assert.doesNotMatch(html, /<img src=x/);
  for (const file of ['src/ui/caseDecisionPresentation.ts', 'src/ui/screens/product-recovery-case.ts', 'src/ui/overview-graph/controller.ts']) {
    assert.doesNotMatch(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), /Sarah|Jordan|Batik|Narita/);
  }
});

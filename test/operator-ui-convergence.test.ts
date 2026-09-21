/** A3 rendering contracts, using generic supplied views, no database/providers. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { OperatorOverview, PlanningCandidateView, PlanningToolEvidenceView, RecoveryCaseView, RecoveryStrategyView } from '../src/contracts/v2/product/readModels.ts';
import { renderProductRecoveryCase } from '../src/ui/screens/product-recovery-case.ts';
import { renderProductOperatorOverview } from '../src/ui/screens/product-operator-overview.ts';
import { buildOverviewGraphModel } from '../src/ui/overview-graph/model.ts';
import {
  decisionActionState, decisionCosts, decisionOptions, groupedResearch, sameStrategy, sumDisplayedMoney,
} from '../src/ui/caseDecisionPresentation.ts';

const at = '2032-04-03T08:00:00.000Z';
const change = { projectionRevision: 7, changedVisibleRefs: [], changedEdgeIds: [], currentSemanticState: 'AFFECTED' as const, changeCursor: '91' };
const strategy = (id: string, n: number, effects: RecoveryStrategyView['changes'] = [{ effectKind: 'SELECT_OFFER', subjectRef: 'JOURNEY_ITEM:leg', subjectLabel: 'Outbound travel' }]): RecoveryStrategyView => ({
  strategyRef: id, version: n, optionNumber: n, status: 'EVALUATED', viability: 'VIABLE',
  changes: effects,
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
    ],
  },
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

function defaultVisible(html: string): string {
  return html.replace(/<details\b[^>]*>[\s\S]*?<\/details>/gi, '');
}

test('Overview case navigation dominates and the full searchable population remains present', () => {
  const html = renderProductOperatorOverview(overview());
  assert.match(html, /data-test="attention-open-case">Open case →/);
  assert.match(html, /class="case-open"[^>]+data-test="population-case-link">Open case<\/a>/);
  assert.match(html, /data-test="population-traveller-link"[^>]*>Traveller view<\/a>/);
  assert.doesNotMatch(html, /Open case →Show interaction/);
  assert.equal((html.match(/data-test="population-row"[^>]*data-journey-ref=/g) ?? []).length, 12);
  assert.equal((html.match(/data-test="population-row" hidden[^>]*data-journey-ref=/g) ?? []).length, 2);
  assert.ok(html.indexOf('data-test="simulated-airline-update"') < html.indexOf('data-poll-region="overview-attention"'),
    'demo control stays in the main column; Needs attention lives in the sticky rail after it');
  const graphAt = html.indexOf('data-test="event-overview-graph"');
  const attentionAt = html.indexOf('data-poll-region="overview-attention"');
  const summaryAt = html.indexOf('data-poll-region="overview-summary"');
  if (graphAt >= 0) {
    assert.ok(graphAt < summaryAt, 'event graph must precede compact readiness');
    assert.ok(graphAt < attentionAt, 'event graph must precede Needs attention');
  }
  assert.match(html, /data-test="overview-readiness"/);
  assert.match(html, /data-test="product-summary-tiles"/);
  assert.match(html, /data-test="decisions-needed"/);
  assert.doesNotMatch(html, /Open an affected case to review the proposed recovery/);
  assert.ok(html.includes('readout-buckets'));
  assert.doesNotMatch(html, /class="tiles" data-test="product-summary-tiles"/);
  assert.match(html, /data-poll-region="overview-activity"/);
  assert.match(html, /data-test="overview-activity-empty"/);
  assert.match(html, /data-test="overview-activity-log"[^>]*>View log →/);
});

test('Overview activity rail projects the latest real ActivityFeed without inventing entries', () => {
  const html = renderProductOperatorOverview(overview(), {
    activity: {
      generatedAt: at,
      truncated: false,
      entries: [
        {
          entryRef: 'entry-1',
          atLabel: 'Today · 09:00',
          actorLabel: 'Operator',
          subjectLabel: 'Participant 0',
          what: 'Opened a recovery case',
          actorKind: 'HUMAN',
          caseRef: 'case-alpha',
        },
        {
          entryRef: 'entry-2',
          atLabel: 'Today · 08:40',
          actorLabel: 'System',
          subjectLabel: 'Participant 0',
          what: 'Recorded a schedule change',
          actorKind: 'SYSTEM',
        },
        {
          entryRef: 'entry-3',
          atLabel: 'Today · 08:20',
          actorLabel: 'Service',
          subjectLabel: 'Participant 1',
          what: 'Observed a provider update',
          actorKind: 'SERVICE',
        },
        {
          entryRef: 'entry-4',
          atLabel: 'Today · 08:00',
          actorLabel: 'Operator',
          subjectLabel: 'Participant 2',
          what: 'Reviewed evidence',
          actorKind: 'HUMAN',
        },
        {
          entryRef: 'entry-5',
          atLabel: 'Yesterday · 17:00',
          actorLabel: 'System',
          subjectLabel: 'Participant 3',
          what: 'Should not appear beyond the rail limit',
          actorKind: 'SYSTEM',
        },
      ],
    },
  });
  assert.match(html, /data-test="overview-activity-rail"/);
  assert.match(html, /v5-activity-title-icon/);
  assert.equal((html.match(/data-test="overview-activity-row"/g) ?? []).length, 4);
  assert.doesNotMatch(html, /Should not appear beyond the rail limit/);
  assert.match(html, /data-case-ref="case-alpha"/);
  assert.match(html, /data-test="activity-case-link"[^>]*>Open case →/);
  assert.match(html, /data-ui-feed-tone=/);
  assert.doesNotMatch(html, /This rail does not invent a second feed/);
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
  const html = renderProductRecoveryCase(v);
  assert.match(html, /data-test="recommendation-unavailable"/);
  assert.doesNotMatch(html, /class="[^"]*is-recommended/);
  assert.doesNotMatch(html, /id="cw-recommendation"[^>]*data-strategy-ref="selected"/);
});

test('recommendation identity matches across main card and decision panel', () => {
  const html = renderProductRecoveryCase(view());
  assert.match(html, /data-test="recovery-strategy"[^>]*data-strategy-ref="selected"/);
  assert.match(html, /data-test="approval-panel"[^>]*data-strategy-ref="selected"/);
  assert.equal(decisionActionState(view()).kind, 'blocked');
});

test('action-state matrix: blocked, ready, unavailable, terminal', () => {
  const blocked = view();
  assert.equal(decisionActionState(blocked).kind, 'blocked');
  const htmlBlocked = renderProductRecoveryCase(blocked);
  assert.match(htmlBlocked, /data-test="approval-unavailable"[^>]*disabled/);
  assert.match(htmlBlocked, /data-test="decision-execution-blocker"/);
  assert.doesNotMatch(htmlBlocked, /Approval and execution are not enabled/);

  const ready = view();
  delete ready.strategies[0]!.executionBlocker;
  assert.deepEqual(decisionActionState(ready), { kind: 'ready', strategyRef: 'selected' });
  const htmlReady = renderProductRecoveryCase(ready);
  assert.match(htmlReady, /data-test="approve-recommendation"/);
  assert.match(htmlReady, /data-action="recover"/);
  assert.match(htmlReady, /data-strategy-ref="selected"/);
  assert.doesNotMatch(htmlReady, /data-test="approval-unavailable"/);

  const missing = view();
  delete missing.planningEvidence!.recommendation;
  assert.equal(decisionActionState(missing).kind, 'unavailable');

  const terminal = { ...view(), status: 'RESOLVED' as const };
  assert.equal(decisionActionState(terminal).kind, 'none');
  assert.doesNotMatch(renderProductRecoveryCase(terminal), /data-test="approval-panel"/);
});

test('programme-only recommendation uses the same renderer without hotel scaffolding', () => {
  const v = view();
  v.strategies = [strategy('programme', 1, [
    { effectKind: 'CHANGE_PROGRAMME_ITEM_TIME', subjectRef: 'PROGRAMME_ITEM:a', subjectLabel: 'Opening session',
      currentWindow: { start: at, end: '2032-04-03T09:00:00.000Z' }, proposedWindow: { start: '2032-04-03T10:00:00.000Z', end: '2032-04-03T11:00:00.000Z' } },
  ])];
  v.planningEvidence!.recommendation = { recommended: { label: 'Programme recovery', ref: 'RECOVERY_STRATEGY:programme' }, alternatives: [], basis: [], provenance: { label: 'Recorded comparison' } };
  v.planningEvidence!.candidates = [{
    ...candidate('programme'),
    proposal: { flights: [], stays: [], entryResults: [], blockers: [], programmeChecks: [{ label: 'Opening session', verdict: 'PASS', reasonCode: 'timing_ok', arrival: '2032-04-03T09:30:00.000Z', deadline: '2032-04-03T10:00:00.000Z', timeZone: 'UTC' }] },
    costComparison: { status: 'UNAVAILABLE', reason: 'No priced supplier change in this proposal.', comparedAt: at },
  }];
  const html = renderProductRecoveryCase(v);
  assert.match(html, /Reschedule the programme commitment/);
  assert.match(html, /data-strategy-ref="programme"/);
  assert.doesNotMatch(defaultVisible(html), /Terminal hotel/);
  assert.match(html, /data-test="cost-unavailable"/);
  assert.doesNotMatch(html, /SGD 0/);
});

test('rejected preview stays compact with closed evaluations', () => {
  const c1 = candidate('rejected-a', 'REJECTED_DETERMINISTIC');
  c1.proposal!.blockers = [{ dimension: 'connection_feasibility', verdict: 'FAIL', reasonCode: 'connection_below_minimum', timing: { gapMinutes: 20, requiredMinutes: 50 } }];
  const c2 = candidate('rejected-b', 'REJECTED_DETERMINISTIC');
  c2.proposal!.flights[0]!.label = 'Second rejected flight';
  c2.proposal!.flights[0]!.originLabel = 'Hidden origin terminal';
  const c3 = candidate('rejected-c', 'REJECTED_VALIDATION');
  c3.proposal!.flights[0]!.label = 'Third rejected flight';
  c3.proposal!.flights[0]!.destinationLabel = 'Hidden destination terminal';
  const v = view();
  v.planningEvidence!.candidates.push(c1, c2, c3);
  const html = renderProductRecoveryCase(v);
  assert.match(html, /data-test="rejected-summary"/);
  assert.match(html, /data-region-key="rejection-eval-option-rejected-a"/);
  assert.doesNotMatch(html, /<details[^>]+data-region-key="rejection-eval-option-rejected-a"[^>]*\bopen\b/);
  const visible = defaultVisible(html);
  assert.doesNotMatch(visible, /Hidden origin terminal/);
  assert.doesNotMatch(visible, /Hidden destination terminal/);
  assert.match(visible, /Second rejected flight/);
  assert.match(html, /Show detailed evaluation \(5 recorded options\)/);
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
  assert.match(html, /data-test="cost-separated"/);
  assert.match(html, /data-test="cost-new-spend"/);
  assert.match(html, /NEW SPEND/);
  assert.match(html, /data-test="cost-potential-loss"/);
  assert.match(html, /POTENTIAL DISPLACED-BOOKING LOSS/);
  assert.match(html, /Not a confirmed charge/);
  assert.match(html, /Published reference feed/);
  assert.match(html, /data-region-key="cost-evidence-selected"/);
});

test('arrival formality appears once in the default decision surface', () => {
  const html = renderProductRecoveryCase(view());
  const visible = defaultVisible(html);
  const matches = visible.match(/Arrival formalities remain outstanding/g) ?? [];
  assert.equal(matches.length, 1);
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

test('active-change footprint excludes unrelated attention travellers', () => {
  const model = buildOverviewGraphModel({
    ...overview(),
    eventOverview: {
      days: [{ index: 1, localDate: '2032-04-01', dateLabel: '1 Apr' }],
      landmarks: [{ ref: 'PROGRAMME_ITEM:opening', title: 'Opening', dayIndex: 1, health: 'GREEN', participantCount: 12, affectedCount: 0 }],
      dependencies: [{
        ref: 'SERVICE:shared', kindLabel: 'Flight', label: 'Shared flight', dayIndex: 1,
        health: 'RED', changed: true, travellerCount: 2, unresolvedCount: 1, clearedCount: 1, checkingCount: 0,
      }],
      cohorts: [],
      promotedTravellers: [
        { journeyRef: 'journey-on-dep', label: 'On dependency', roleLabel: 'Speaker', status: 'DISRUPTED', membership: 'UNRESOLVED', dependencyRef: 'SERVICE:shared' },
        { journeyRef: 'journey-other', label: 'Other attention', roleLabel: 'Speaker', status: 'DISRUPTED', membership: 'ATTENTION' },
        { journeyRef: 'journey-cleared', label: 'Cleared', roleLabel: 'Speaker', status: 'READY', membership: 'CLEARED', dependencyRef: 'SERVICE:shared' },
      ],
      promotedOverflow: 0,
      blastRadius: { dependencyRef: 'SERVICE:shared', affectedCount: 2, clearedCount: 1, checkingCount: 0, unresolvedCount: 1, landmarkRefs: ['PROGRAMME_ITEM:opening'] },
      relations: [],
    },
  });
  assert.ok(model?.focus);
  assert.ok(model!.focus!.incidentIds.includes('journey-on-dep'));
  assert.ok(!model!.focus!.incidentIds.includes('journey-other'));
  assert.equal(model!.focus!.unresolvedTravellerId, 'journey-on-dep');
  assert.match(model!.focus!.message, /Active change · Shared flight/);
});

test('polling regions, immutable Original, graph and layout order remain composed', () => {
  const v = view(), html = renderProductRecoveryCase(v);
  for (const name of ['header', 'lead', 'affects', 'graph', 'options', 'approval', 'alternatives', 'activity', 'execution', 'resolution', 'technical']) {
    assert.equal((html.match(new RegExp(`data-poll-region="${name}"`, 'g')) ?? []).length, 1, name);
  }
  const body = html.slice(html.indexOf('<main'));
  assert.ok(body.indexOf('data-poll-region="lead"') < body.indexOf('data-poll-region="graph"'));
  assert.ok(body.indexOf('data-poll-region="graph"') < body.indexOf('data-poll-region="affects"'));
  assert.ok(body.indexOf('data-poll-region="graph"') < body.indexOf('case-decision-grid'));
  assert.ok(body.indexOf('case-decision-grid') < body.indexOf('data-poll-region="alternatives"'));
  assert.match(html, /data-test="original-current-toggle"/);
  assert.match(html, /data-test="focused-case-graph"/);
  assert.match(html, /data-change-cursor="91"/);
  assert.match(html, /sinceCursor/);
  assert.match(html, /href="#cw-recommendation"/);
  assert.doesNotMatch(html, /Recommendation review/);
  assert.doesNotMatch(html, /What you’re reviewing/);
});

test('labels are escaped and generic rendering contains no persona branches', () => {
  const v = view(); v.planningEvidence!.candidates[0]!.proposal!.flights[0]!.label = '<img src=x onerror=alert(1)>';
  const html = renderProductRecoveryCase(v);
  assert.doesNotMatch(html, /<img src=x/);
  for (const file of ['src/ui/caseDecisionPresentation.ts', 'src/ui/screens/product-recovery-case.ts', 'src/ui/overview-graph/controller.ts', 'src/ui/overview-graph/model.ts']) {
    assert.doesNotMatch(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), /Sarah|Jordan|Batik|Narita/);
  }
});

/**
 * Lane E evidence — E1: journeys/state inventory + typed fixture proofs.
 * Proves: every frozen envelope/status state is inventoried; fixtures compile
 * against frozen read-model contracts; fixture data is self-consistent
 * (counts match trips, rejected options carry reasons, ids/timestamps valid);
 * user-facing vocabulary contains no internal jargon.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Strip all markup (tags + their attributes) down to text-node content only.
 * URL paths, form actions, hidden inputs and data-* attributes are
 * machine-readable DOM state, not user-visible copy — the forbidden-jargon
 * gate must judge what a human actually reads, never the whole raw HTML.
 */
function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

import { EntityIdSchema, IsoDateTimeSchema } from '../src/domain/common.ts';
import type { ReadModelStatus } from '../src/contracts/readmodels.ts';
import {
  FORBIDDEN_UI_TERMS,
  OPTION_VERDICT_LABEL,
  STATUS_EXPLANATION,
  STATUS_LABEL,
  TRAVELLER_HEADLINE,
  TRAVELLER_SUBLINE,
  VIABILITY_EXPLANATION,
  VIABILITY_LABEL,
} from '../src/ui/copy.ts';
import {
  REQUIRED_UI_TRIGGERS,
  UI_STATE_INVENTORY,
  type UiStateTrigger,
} from '../src/ui/state-inventory.ts';
import { caseDetailViewIssues, type CaseDetailView } from '../src/ui/case-view-model.ts';
import { renderOperatorDashboard, renderOperatorDashboardBody } from '../src/ui/screens/operator-dashboard.ts';
import { CASE_STEPS, deriveStepIndex, renderCaseDetail } from '../src/ui/screens/operator-case.ts';
import { renderTravellerTrip } from '../src/ui/screens/traveller.ts';
import { renderPage } from '../src/ui/page.ts';
import {
  CASE_FIXTURES,
  TRAVELLER_FIXTURES,
  awaitingApprovalTrip,
  awaitingTravellerTrip,
  disruptedTrip,
  operatorDashboard,
  operatorDashboardAlt,
  operatorDashboardError,
  operatorDashboardLoaded,
  operatorDashboardLoading,
  readyTrip,
  recoveringTrip,
  resolvedTrip,
  resolvedWithLossTrip,
  travellerAwaitingInputEnvelope,
  travellerDisruptedEnvelope,
  travellerError,
  travellerLoading,
  travellerResolvedWithLossEnvelope,
  unknownTrip,
} from '../src/ui/fixtures/readmodels.ts';

const ALL_STATUSES: readonly ReadModelStatus[] = [
  'READY',
  'AT_RISK',
  'DISRUPTED',
  'RECOVERING',
  'RESOLVED',
  'UNKNOWN',
];

test('state inventory covers every required UI trigger', () => {
  const covered = new Set<UiStateTrigger>(UI_STATE_INVENTORY.map((s) => s.trigger));
  for (const trigger of REQUIRED_UI_TRIGGERS) {
    assert.ok(covered.has(trigger), `inventory missing trigger: ${trigger}`);
  }
  for (const status of ALL_STATUSES) {
    assert.ok(covered.has(status), `inventory missing status: ${status}`);
  }
  for (const spec of UI_STATE_INVENTORY) {
    assert.ok(spec.answers.length > 0, `state ${spec.id} answers no journey question`);
    assert.ok(spec.userMeaning.length > 0, `state ${spec.id} has no user meaning`);
  }
});

test('fixtures cover the nine required lane states', () => {
  // Trip-level states.
  assert.equal(readyTrip.status, 'READY');
  assert.equal(disruptedTrip.status, 'DISRUPTED');
  assert.equal(recoveringTrip.status, 'RECOVERING');
  assert.equal(awaitingTravellerTrip.status, 'RECOVERING');
  assert.equal(awaitingTravellerTrip.travellerResponseStatus, 'AWAITING');
  assert.ok(awaitingTravellerTrip.pendingDecisions.some((d) => d.decisionType === 'INPUT'));
  assert.equal(awaitingApprovalTrip.status, 'RECOVERING');
  assert.ok(awaitingApprovalTrip.pendingDecisions.some((d) => d.decisionType === 'APPROVAL' && d.amount));
  assert.equal(unknownTrip.status, 'UNKNOWN');
  assert.ok(unknownTrip.uncertainties.length > 0);
  assert.equal(resolvedTrip.status, 'RESOLVED');
  assert.ok(resolvedTrip.resolutionSummary);
  assert.equal(resolvedWithLossTrip.status, 'RESOLVED');
  assert.match(resolvedWithLossTrip.resolutionSummary ?? '', /could not be preserved/);

  // Case-detail states: rejected option, approvals, actions, both outcomes.
  const ids = CASE_FIXTURES.map((f) => f.id);
  for (const required of [
    'rejected-option',
    'awaiting-traveller',
    'awaiting-approval',
    'actions-in-progress',
    'resolved-fully',
    'resolved-with-loss',
  ]) {
    assert.ok(ids.includes(required), `missing case fixture: ${required}`);
  }

  // Traveller surface states.
  const travellerIds = TRAVELLER_FIXTURES.map((f) => f.id);
  for (const required of [
    'ready',
    'disrupted',
    'recovering',
    'awaiting-input',
    'unknown',
    'resolved-fully',
    'resolved-with-loss',
  ]) {
    assert.ok(travellerIds.includes(required), `missing traveller fixture: ${required}`);
  }
});

test('rejected attractive option carries a hard downstream reason', () => {
  const rejected = CASE_FIXTURES.find((f) => f.id === 'rejected-option');
  assert.ok(rejected);
  const cheaper = rejected.view.options.find((o) => o.verdict === 'NOT_VIABLE');
  assert.ok(cheaper, 'expected a rejected option');
  assert.ok(cheaper.rejectionReason, 'rejected option must explain why');
  assert.ok((cheaper.costDelta?.amount ?? 0) < 0, 'demo pattern: cheaper option is the rejected one');
  assert.ok(
    rejected.view.options.some((o) => o.verdict === 'VIABLE' && o.recommended),
    'a viable recommended option must exist alongside the rejection',
  );
});

test('case fixtures pass the deterministic consistency guard', () => {
  for (const fixture of CASE_FIXTURES) {
    assert.deepEqual(caseDetailViewIssues(fixture.view), [], `issues in ${fixture.id}`);
  }
  const outcomes = CASE_FIXTURES.filter((f) => f.view.resolution).map((f) => f.view.resolution?.outcome);
  assert.ok(outcomes.includes('FULLY_RECOVERED'));
  assert.ok(outcomes.includes('RECOVERED_WITH_LOSS'));
});

test('dashboard summaries are consistent with their trips', () => {
  for (const dashboard of [operatorDashboard, operatorDashboardAlt]) {
    const count = (status: ReadModelStatus) => dashboard.trips.filter((t) => t.status === status).length;
    assert.equal(dashboard.summary.ready, count('READY'));
    assert.equal(dashboard.summary.atRisk, count('AT_RISK'));
    assert.equal(dashboard.summary.disrupted, count('DISRUPTED'));
    assert.equal(dashboard.summary.recovering, count('RECOVERING'));
    const decisions = dashboard.trips.reduce((n, t) => n + t.pendingDecisions.length, 0);
    assert.equal(dashboard.summary.awaitingDecision, decisions);
  }
});

test('fixture ids and timestamps satisfy the frozen domain formats', () => {
  const ids: string[] = [];
  const timestamps: string[] = [];
  for (const trip of [...operatorDashboard.trips, ...operatorDashboardAlt.trips]) {
    ids.push(trip.tripId);
    timestamps.push(trip.updatedAt);
    for (const decision of trip.pendingDecisions) {
      ids.push(decision.caseId);
      if (decision.requestedAt) timestamps.push(decision.requestedAt);
    }
  }
  for (const fixture of [...CASE_FIXTURES]) {
    ids.push(fixture.view.caseId, fixture.view.tripId);
    timestamps.push(fixture.view.updatedAt);
  }
  for (const fixture of [...TRAVELLER_FIXTURES]) {
    ids.push(fixture.view.tripId);
    timestamps.push(fixture.view.updatedAt);
    for (const request of fixture.view.inputRequested) {
      ids.push(request.caseId);
    }
  }
  for (const id of ids) {
    assert.equal(EntityIdSchema.safeParse(id).success, true, `bad EntityId: ${id}`);
  }
  for (const ts of timestamps) {
    assert.equal(IsoDateTimeSchema.safeParse(ts).success, true, `bad IsoDateTime: ${ts}`);
  }
});

test('user-facing vocabulary contains no internal jargon', () => {
  const copy = [
    ...Object.values(STATUS_LABEL),
    ...Object.values(STATUS_EXPLANATION),
    ...Object.values(TRAVELLER_HEADLINE),
    ...Object.values(TRAVELLER_SUBLINE),
    ...Object.values(VIABILITY_LABEL),
    ...Object.values(VIABILITY_EXPLANATION),
    ...Object.values(OPTION_VERDICT_LABEL),
    ...UI_STATE_INVENTORY.map((s) => s.userMeaning),
  ];
  for (const phrase of copy) {
    const lowered = phrase.toLowerCase();
    for (const term of FORBIDDEN_UI_TERMS) {
      assert.ok(!lowered.includes(term), `jargon "${term}" in: ${phrase}`);
    }
  }
});

// ---------------------------------------------------------------------------
// E2 — rendering proofs
// ---------------------------------------------------------------------------

function allRenderedScreens(): { id: string; html: string }[] {
  const screens: { id: string; html: string }[] = [
    { id: 'dashboard', html: renderOperatorDashboard(operatorDashboardLoaded) },
    { id: 'dashboard-alt', html: renderOperatorDashboard({ state: 'LOADED', data: operatorDashboardAlt }) },
    { id: 'dashboard-loading', html: renderOperatorDashboard(operatorDashboardLoading) },
    { id: 'dashboard-error', html: renderOperatorDashboard(operatorDashboardError) },
    { id: 'traveller-loading', html: renderTravellerTrip(travellerLoading) },
    { id: 'traveller-error', html: renderTravellerTrip(travellerError) },
  ];
  for (const fixture of CASE_FIXTURES) {
    screens.push({ id: `case-${fixture.id}`, html: renderCaseDetail({ state: 'LOADED', data: fixture.view }) });
  }
  for (const fixture of TRAVELLER_FIXTURES) {
    screens.push({ id: `traveller-${fixture.id}`, html: renderTravellerTrip({ state: 'LOADED', data: fixture.view }) });
  }
  return screens;
}

test('no internal jargon leaks into any rendered screen', () => {
  for (const screen of allRenderedScreens()) {
    // VISIBLE text only: URL paths, form actions, hidden inputs and data-*
    // attributes are machine-readable DOM state, not user-visible copy.
    const lowered = visibleText(screen.html).toLowerCase();
    for (const term of FORBIDDEN_UI_TERMS) {
      assert.ok(!lowered.includes(term), `jargon "${term}" leaked in ${screen.id}`);
    }
    // Generic internal vocabulary must not be primary UI language either.
    for (const term of ['trip signal', 'blast radius', 'recovery strategy']) {
      assert.ok(!lowered.includes(term), `internal phrase "${term}" leaked in ${screen.id}`);
    }
  }
});

test('dashboard renders every status and orders attention first', () => {
  const html = renderOperatorDashboardBody(operatorDashboard);
  for (const status of ALL_STATUSES) {
    assert.ok(html.includes(`data-status="${status}"`), `missing status card: ${status}`);
  }
  const disruptedAt = html.indexOf('data-status="DISRUPTED"');
  const readyAt = html.indexOf('data-status="READY"');
  assert.ok(disruptedAt >= 0 && readyAt >= 0 && disruptedAt < readyAt, 'disrupted must precede ready');
  assert.ok(html.includes('Decisions needed'), 'pending decisions panel expected');
  assert.ok(html.includes('Still unclear'), 'uncertainty must be visible');
});

test('operator rows stay in operator context and neutral rows are not fake links', () => {
  const activeCaseId = 'case-active-operator';
  const html = renderOperatorDashboardBody({
    ...operatorDashboard,
    trips: operatorDashboard.trips.map((trip, index) =>
      index === 0 ? { ...trip, activeCaseId } : trip,
    ),
  });
  assert.ok(html.includes(`href="/operator/cases/${activeCaseId}"`));
  assert.ok(!html.includes('href="/traveller?trip='), 'operator rows must never fall through to traveller UI');
});

test('switching typed fixture data changes nothing in component code paths', () => {
  const primary = renderOperatorDashboardBody(operatorDashboard);
  const alternate = renderOperatorDashboardBody(operatorDashboardAlt);
  assert.equal((primary.match(/data-trip-id=/g) ?? []).length, operatorDashboard.trips.length);
  assert.equal((alternate.match(/data-trip-id=/g) ?? []).length, operatorDashboardAlt.trips.length);
  assert.ok(alternate.includes('Dana Whitfield'));
  assert.ok(!alternate.includes('Alex Reyes'), 'datasets must not bleed into each other');
});

test('loading and error surfaces never fabricate data', () => {
  const loading = renderOperatorDashboard(operatorDashboardLoading);
  assert.ok(loading.includes('data-ui-state="loading"'));
  assert.ok(!loading.includes('Alex Reyes'));
  assert.ok(!loading.includes('data-trip-id'));

  const error = renderOperatorDashboard(operatorDashboardError);
  assert.ok(error.includes('data-ui-state="error"'));
  assert.ok(error.includes('trip summary service did not respond'));
  assert.ok(!error.includes('data-trip-id'));

  const loadingTraveller = renderTravellerTrip(travellerLoading);
  assert.ok(loadingTraveller.includes('data-ui-state="loading"'));
  const errorTraveller = renderTravellerTrip(travellerError);
  assert.ok(errorTraveller.includes('data-ui-state="error"'));
  assert.ok(errorTraveller.includes('Nothing about your trip has changed'));
});

test('case detail tells the full recovery story incl. rejected attractive option', () => {
  const rejected = CASE_FIXTURES.find((f) => f.id === 'rejected-option');
  assert.ok(rejected);
  const html = renderCaseDetail({ state: 'LOADED', data: rejected.view });
  assert.ok(html.includes('What changed'));
  assert.ok(html.includes('What this touches'));
  assert.ok(html.includes('Must not be missed'), 'critical objective must be called out');
  assert.ok(html.includes('Checks already run'));
  assert.ok(html.includes('data-verdict="NOT_VIABLE"'));
  assert.ok(html.includes('Arrives after the speaking slot'), 'rejection reason must be visible');
  assert.ok(html.includes('data-verdict="VIABLE"'));
  assert.ok(html.includes('Still being checked'), 'UNKNOWN option verdict rendered');
});

test('planning action exposes truthful in-flight stages before the real response', () => {
  const disrupted = CASE_FIXTURES.find((fixture) => fixture.id === 'rejected-option')!;
  const html = renderCaseDetail({
    state: 'LOADED',
    data: { ...disrupted.view, options: [], approval: undefined, status: 'DISRUPTED' },
  });
  assert.ok(html.includes('data-test="plan-recovery-btn"'));
  assert.ok(html.includes('data-planning-progress'));
  assert.ok(html.includes('Checking the changed flight'));
  assert.ok(html.includes('Comparing recovery options'));
  assert.ok(html.includes('Checking policy and approval'));
});

test('approval requirement is explicit with who, why, and amount', () => {
  const approvalCase = CASE_FIXTURES.find((f) => f.id === 'awaiting-approval');
  assert.ok(approvalCase);
  const html = renderCaseDetail({ state: 'LOADED', data: approvalCase.view });
  assert.ok(html.includes('Approval needed from the organisation'));
  assert.ok(html.includes('travel policy'));
  assert.ok(html.includes('data-approval-state="PENDING"'));
});

test('resolution outcomes render honestly, including loss', () => {
  const full = CASE_FIXTURES.find((f) => f.id === 'resolved-fully');
  const loss = CASE_FIXTURES.find((f) => f.id === 'resolved-with-loss');
  assert.ok(full && loss);
  const fullHtml = renderCaseDetail({ state: 'LOADED', data: full.view });
  assert.ok(fullHtml.includes('data-outcome="FULLY_RECOVERED"'));
  const lossHtml = renderCaseDetail({ state: 'LOADED', data: loss.view });
  assert.ok(lossHtml.includes('data-outcome="RECOVERED_WITH_LOSS"'));
  assert.ok(lossHtml.includes('Trip recovered — with a loss'));
  assert.ok(lossHtml.includes('Could not be kept'));
  assert.ok(lossHtml.includes('Welcome dinner with the organisers'));
  assert.ok(!lossHtml.includes('Everything originally planned is kept'));

  const travellerLoss = renderTravellerTrip(travellerResolvedWithLossEnvelope);
  assert.ok(travellerLoss.includes('could not be kept'), 'traveller loss must stay honest');
});

test('traveller surfaces: disrupted hero, decision buttons, viability', () => {
  const disrupted = renderTravellerTrip(travellerDisruptedEnvelope);
  assert.ok(disrupted.includes('Your trip needs attention'));
  assert.ok(disrupted.includes('traveller-shell'), 'mobile-first layout expected');

  const awaiting = renderTravellerTrip(travellerAwaitingInputEnvelope);
  assert.ok(awaiting.includes('We need your input'));
  assert.ok(awaiting.includes('data-case-id="case-choice"'));
  assert.equal((awaiting.match(/<button type="submit"/g) ?? []).length, 2);
  assert.ok(awaiting.includes('Nothing is booked until you choose'));
  assert.ok(awaiting.includes('data-viability="AT_RISK"'));

  // Regression (Mission 3 browser rehearsal): the decision form must be
  // interceptable by the progressive enhancement script and must carry the
  // decision vocabulary the /traveller-decision endpoint actually accepts —
  // a native form-encoded POST of option labels was refused as invalid_json,
  // leaving a raw error screen to a traveller who clicked a choice.
  assert.ok(awaiting.includes('class="choice-form inline-form"'), 'decision form must be enhancement-intercepted');
  assert.ok(awaiting.includes('name="decision"'), 'choice buttons must post the decision field');
  assert.ok(!awaiting.includes('name="choice"'), 'option labels are display-only, never the wire field');
});

test('traveller composer uses the existing generic change-request seam', () => {
  const view = { ...travellerDisruptedEnvelope.data!, travellerId: 'traveller-ui-test' };
  const html = renderTravellerTrip({ state: 'LOADED', data: view });
  assert.ok(html.includes('Ask Northstar'));
  assert.ok(html.includes('action="/api/traveller/change-request"'));
  assert.ok(html.includes('name="travellerId" value="traveller-ui-test"'));
  assert.ok(html.includes('name="tripId"'));
  assert.ok(html.includes('name="text"'));
});

test('a changed but still viable trip reassures without changing machine status', () => {
  const view = { ...travellerDisruptedEnvelope.data!, remainderViable: 'VIABLE' as const };
  const html = renderTravellerTrip({ state: 'LOADED', data: view });
  assert.ok(html.includes('data-status="DISRUPTED"'));
  assert.ok(html.includes('Your trip changed, but still works'));
});

test('mobile traveller page shell carries responsive metadata', () => {
  const page = renderPage(
    { title: 'Your trip', active: 'traveller', surface: 'traveller' },
    renderTravellerTrip(travellerDisruptedEnvelope),
  );
  assert.ok(page.includes('width=device-width, initial-scale=1'));
  assert.ok(page.includes('traveller-shell'));
  assert.ok(page.includes('<style>'), 'theme inlined: no static asset dependency');
});

test('recovery progress is derived from evidence, never asserted for UNKNOWN', () => {
  const unknownCase: CaseDetailView = {
    ...CASE_FIXTURES.find((f) => f.id === 'rejected-option')!.view,
    status: 'UNKNOWN',
  };
  assert.equal(deriveStepIndex(unknownCase), undefined);
  const resolvedCase = CASE_FIXTURES.find((f) => f.id === 'resolved-fully');
  assert.ok(resolvedCase);
  assert.equal(deriveStepIndex(resolvedCase.view), CASE_STEPS.length);
  const executing = CASE_FIXTURES.find((f) => f.id === 'actions-in-progress');
  assert.ok(executing);
  assert.equal(deriveStepIndex(executing.view), 4);
});

test('malformed case views are refused instead of guessed', () => {
  const broken = CASE_FIXTURES.find((f) => f.id === 'rejected-option');
  assert.ok(broken);
  const malformed: CaseDetailView = {
    ...broken.view,
    options: broken.view.options.map((option) =>
      option.verdict === 'NOT_VIABLE' ? { ...option, rejectionReason: undefined } : option,
    ),
  };
  const html = renderCaseDetail({ state: 'LOADED', data: malformed });
  assert.ok(html.includes('cannot be displayed'));
  assert.ok(!html.includes('data-verdict'));
});

test('dynamic values are HTML-escaped', () => {
  const hostile = {
    ...operatorDashboard,
    trips: [
      {
        ...readyTrip,
        label: '<script>alert(1)</script>',
        whatChanged: 'a < b & c > d "quoted"',
      },
    ],
    summary: { ready: 1, atRisk: 0, disrupted: 0, recovering: 0, awaitingDecision: 0 },
  };
  const html = renderOperatorDashboardBody(hostile);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('a &lt; b &amp; c &gt; d &quot;quoted&quot;'));
});

/**
 * Lane E evidence — E1: journeys/state inventory + typed fixture proofs.
 * Proves: every frozen envelope/status state is inventoried; fixtures compile
 * against frozen read-model contracts; fixture data is self-consistent
 * (counts match trips, rejected options carry reasons, ids/timestamps valid);
 * user-facing vocabulary contains no internal jargon.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

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
import { caseDetailViewIssues } from '../src/ui/case-view-model.ts';
import {
  CASE_FIXTURES,
  TRAVELLER_FIXTURES,
  awaitingApprovalTrip,
  awaitingTravellerTrip,
  disruptedTrip,
  operatorDashboard,
  operatorDashboardAlt,
  readyTrip,
  recoveringTrip,
  resolvedTrip,
  resolvedWithLossTrip,
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

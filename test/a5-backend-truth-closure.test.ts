/**
 * A5 backend truth — connection-aware product status and progression gating.
 * Pure tests; no PostgreSQL / scenario names.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyAssessmentConnection,
  connectionViabilityFromAssessment,
  deriveConnectionViabilityFromEvaluator,
  mapConnectionProgression,
  productStatusFromAssessment,
  recoveryPlanningEligibleFromAssessment,
  remainderViabilityFromAssessment,
  semanticStateFromAssessment,
} from '../src/app/target/readmodels/mapConnectionProgression.ts';
import { projectFocusedGraph } from '../src/app/target/readmodels/projectFocusedGraph.ts';
import { buildEventOverview } from '../src/app/target/readmodels/eventOverview.ts';
import { decisionActionState, decisionOptions } from '../src/ui/caseDecisionPresentation.ts';
import type { RecoveryCaseView } from '../src/contracts/v2/product/readModels.ts';
import type { OperatorPopulationFact } from '../src/app/target/readmodels/types.ts';

test('A5: evaluator TIGHT vs IMPOSSIBLE maps to amber vs red product status', () => {
  assert.equal(deriveConnectionViabilityFromEvaluator({
    verdict: 'FAIL', reasonCode: 'connection_below_minimum',
  }), 'TIGHT');
  assert.equal(deriveConnectionViabilityFromEvaluator({
    verdict: 'FAIL', reasonCode: 'connection_broken',
  }), 'IMPOSSIBLE');

  assert.equal(productStatusFromAssessment('FAIL', 'TIGHT'), 'AT_RISK');
  assert.equal(productStatusFromAssessment('FAIL', 'IMPOSSIBLE'), 'DISRUPTED');
  assert.equal(productStatusFromAssessment('FAIL'), 'DISRUPTED');
  assert.equal(productStatusFromAssessment('PASS'), 'READY');

  assert.equal(remainderViabilityFromAssessment('FAIL', 'TIGHT'), 'AT_RISK');
  assert.equal(remainderViabilityFromAssessment('FAIL', 'IMPOSSIBLE'), 'NOT_VIABLE');
  assert.equal(semanticStateFromAssessment('FAIL', 'TIGHT'), 'AFFECTED');
  assert.equal(semanticStateFromAssessment('FAIL', 'IMPOSSIBLE'), 'FAILED');
});

test('A5: Case OPEN/AWAITING_AUTHORITY at TIGHT stays CONNECTION_AT_RISK (not recovery sell)', () => {
  assert.equal(mapConnectionProgression({
    viability: 'TIGHT', caseStatus: 'OPEN',
  }), 'CONNECTION_AT_RISK');
  assert.equal(mapConnectionProgression({
    viability: 'TIGHT', caseStatus: 'AWAITING_AUTHORITY',
  }), 'CONNECTION_AT_RISK');
  assert.equal(mapConnectionProgression({
    viability: 'IMPOSSIBLE', caseStatus: 'OPEN',
  }), 'RECOVERY_PLANNING');
  assert.equal(mapConnectionProgression({
    viability: 'IMPOSSIBLE', caseStatus: 'AWAITING_AUTHORITY',
  }), 'AWAITING_APPROVAL');
});

test('A5: D2 monitoring suppresses actionable recommendation presentation', () => {
  const view = {
    status: 'AWAITING_AUTHORITY',
    connectionProgression: 'CONNECTION_AT_RISK',
    strategies: [{
      strategyRef: 's1', version: 1, viability: 'VIABLE', status: 'EVALUATED',
      optionNumber: 1, changes: [], resolves: [],
      projectedSummary: { headline: 'Replace travel' },
      projectedPeople: [],
    }],
    planningEvidence: {
      recommendation: { recommended: { ref: 's1', label: 'Recommended' }, alternatives: [], basis: [], provenance: { code: 'DETERMINISTIC', label: 'Deterministic' } },
    },
  } as unknown as RecoveryCaseView;

  assert.equal(decisionActionState(view).kind, 'unavailable');
  assert.equal(decisionOptions(view).recommended, undefined);
});

test('A5: broken connection firstBreakpoint prefers FAILED onward, not CHANGED arrival', () => {
  const ldg = {
    scope: 'FOCUSED_CASE' as const,
    nodes: [
      { ref: 'TIMING:in:ARRIVAL', kind: 'TIMING' as const, label: 'Arrival timing', semanticState: 'CHANGED' as const, authority: 'AUTHORITATIVE' as const, subjectRefs: ['JOURNEY_ITEM:in'], timing: { currentAt: '2031-01-01T12:00:00.000Z' } },
      { ref: 'SERVICE_BOOKING:onward', kind: 'SERVICE_BOOKING' as const, label: 'Onward', semanticState: 'HEALTHY' as const, authority: 'AUTHORITATIVE' as const },
      { ref: 'JOURNEY:j', kind: 'TRAVELLER' as const, label: 'Traveller', semanticState: 'FAILED' as const, authority: 'AUTHORITATIVE' as const },
    ],
    edges: [
      { id: 'MUST_HAPPEN_BEFORE:TIMING:in:ARRIVAL:SERVICE_BOOKING:onward', fromRef: 'TIMING:in:ARRIVAL', toRef: 'SERVICE_BOOKING:onward', kind: 'MUST_HAPPEN_BEFORE' as const, authority: 'AUTHORITATIVE' as const, semanticState: 'FAILED' as const },
    ],
    change: { projectionRevision: 1, changedVisibleRefs: [], changedEdgeIds: [], currentSemanticState: 'FAILED' as const },
  };
  const focused = projectFocusedGraph(ldg, [{
    subjectRef: 'JOURNEY:j',
    causeSubjectRef: 'JOURNEY_ITEM:in',
    dimension: 'connection_feasibility',
    reasonCode: 'connection_broken',
    evaluatorId: 'm6.connection',
    facts: { gapMinutes: -40, upstreamArrival: '2031-01-01T12:00:00.000Z' },
    relatedSubjectRefs: ['JOURNEY_ITEM:in', 'JOURNEY_ITEM:out'],
  }]);
  assert.equal(focused?.firstBreakpoint?.nodeRef, 'SERVICE_BOOKING:onward');
  assert.equal(focused?.firstBreakpoint?.reasonCode, 'connection_broken');
});

test('A5: Event Overview maps AT_RISK population to CHECKING (amber), not UNRESOLVED (red)', () => {
  const atRisk: OperatorPopulationFact = {
    journeyRef: 'JOURNEY:1',
    tripRef: 'TRIP:1',
    travellerLabel: 'Traveller 1',
    obligation: 'REQUIRED',
    status: 'AT_RISK',
    remainderViability: 'AT_RISK',
    evaluation: 'CURRENT',
    caseRef: 'case-1',
  };
  const ov = buildEventOverview({
    source: {
      programmeItems: [{
        itemRef: 'PROGRAMME_ITEM:1', title: 'Session', localDate: '2031-03-11',
        localTime: '10:00', windowStart: '2031-03-11T10:00:00Z',
      }],
      participations: [{ itemRef: 'PROGRAMME_ITEM:1', journeyRef: 'JOURNEY:1', obligation: 'REQUIRED' }],
      journeyServices: [{
        journeyRef: 'JOURNEY:1', serviceRef: 'SERVICE:A', mode: 'AIR', operator: 'Carrier',
        arrivalLocalDate: '2031-03-11', arrivalLocalTime: '09:00', publishedArrivalLocalTime: '08:00', changed: true,
      }],
    },
    population: [atRisk],
    items: [],
  });
  assert.equal(ov.promotedTravellers[0]?.membership, 'CHECKING');
  assert.equal(ov.promotedTravellers[0]?.status, 'AT_RISK');
});

test('A5: connectionViabilityFromAssessment reads evaluator reason codes', () => {
  assert.equal(connectionViabilityFromAssessment({
    dimensions: [{
      dimension: 'connection_feasibility', applicable: true, verdict: 'FAIL',
      explanations: [{ reasonCode: 'connection_below_minimum' }],
    }],
  }), 'TIGHT');
  assert.equal(connectionViabilityFromAssessment({
    dimensions: [{
      dimension: 'connection_feasibility', applicable: true, verdict: 'FAIL',
      explanations: [{ reasonCode: 'connection_broken' }],
    }],
  }), 'IMPOSSIBLE');
  assert.equal(connectionViabilityFromAssessment({
    dimensions: [{
      dimension: 'programme_participation', applicable: true, verdict: 'FAIL',
      explanations: [{ reasonCode: 'misses_required_item' }],
    }],
  }), undefined);
});

test('A5: tight-only connection FAIL is not planning-eligible; broken connection is', () => {
  assert.equal(recoveryPlanningEligibleFromAssessment({
    overallVerdict: 'FAIL',
    dimensions: [{
      dimension: 'connection_feasibility', applicable: true, blocking: true, verdict: 'FAIL',
      explanations: [{ reasonCode: 'connection_below_minimum' }],
    }],
  }), false);
  assert.equal(recoveryPlanningEligibleFromAssessment({
    overallVerdict: 'FAIL',
    dimensions: [{
      dimension: 'connection_feasibility', applicable: true, blocking: true, verdict: 'FAIL',
      explanations: [{ reasonCode: 'connection_broken' }],
    }],
  }), true);
  assert.equal(recoveryPlanningEligibleFromAssessment({
    overallVerdict: 'FAIL',
    dimensions: [{
      dimension: 'programme_participation', applicable: true, blocking: true, verdict: 'FAIL',
      explanations: [{ reasonCode: 'misses_required_item' }],
    }],
  }), true);
});

// ---------------------------------------------------------------------------
// A5 FIX-2 — the ONE shared connection classifier aggregates truthfully across
// the whole failing-explanation set and across a separate blocking dimension.
// These six cases are the required regression proof.
// ---------------------------------------------------------------------------

test('A5 FIX-2 (1): a tight-only connection projects amber (watchable), not red', () => {
  const assessment = {
    overallVerdict: 'FAIL' as const,
    dimensions: [{
      dimension: 'connection_feasibility', applicable: true, blocking: true, verdict: 'FAIL' as const,
      explanations: [{ status: 'FAIL' as const, reasonCode: 'connection_below_minimum', facts: { gapMinutes: 12 } }],
    }],
  };
  const c = classifyAssessmentConnection(assessment);
  assert.equal(c.connectionViability, 'TIGHT');
  assert.equal(c.separateBlockingFailure, false);
  assert.equal(productStatusFromAssessment('FAIL', c.connectionViability, c.separateBlockingFailure), 'AT_RISK');
  assert.equal(remainderViabilityFromAssessment('FAIL', c.connectionViability, c.separateBlockingFailure), 'AT_RISK');
  assert.equal(semanticStateFromAssessment('FAIL', c.connectionViability, c.separateBlockingFailure), 'AFFECTED');
  // A merely-tight connection is monitorable, NOT replacement-planning-eligible.
  assert.equal(recoveryPlanningEligibleFromAssessment(assessment), false);
});

test('A5 FIX-2 (2): a broken connection projects red, not amber', () => {
  const assessment = {
    overallVerdict: 'FAIL' as const,
    dimensions: [{
      dimension: 'connection_feasibility', applicable: true, blocking: true, verdict: 'FAIL' as const,
      explanations: [{ status: 'FAIL' as const, reasonCode: 'connection_broken', facts: { gapMinutes: -40 } }],
    }],
  };
  const c = classifyAssessmentConnection(assessment);
  assert.equal(c.connectionViability, 'IMPOSSIBLE');
  assert.equal(c.separateBlockingFailure, false);
  assert.equal(productStatusFromAssessment('FAIL', c.connectionViability, c.separateBlockingFailure), 'DISRUPTED');
  assert.equal(remainderViabilityFromAssessment('FAIL', c.connectionViability, c.separateBlockingFailure), 'NOT_VIABLE');
  assert.equal(semanticStateFromAssessment('FAIL', c.connectionViability, c.separateBlockingFailure), 'FAILED');
  // A physically broken connection IS replacement-planning-eligible.
  assert.equal(recoveryPlanningEligibleFromAssessment(assessment), true);
});

test('A5 FIX-2 (3): a tight connection PLUS a separate definitive blocking FAIL is red, not amber', () => {
  const assessment = {
    overallVerdict: 'FAIL' as const,
    dimensions: [
      {
        dimension: 'connection_feasibility', applicable: true, blocking: true, verdict: 'FAIL' as const,
        explanations: [{ status: 'FAIL' as const, reasonCode: 'connection_below_minimum', facts: { gapMinutes: 12 } }],
      },
      {
        dimension: 'programme_participation', applicable: true, blocking: true, verdict: 'FAIL' as const,
        explanations: [{ status: 'FAIL' as const, reasonCode: 'misses_required_item' }],
      },
    ],
  };
  const c = classifyAssessmentConnection(assessment);
  assert.equal(c.connectionViability, 'TIGHT');
  assert.equal(c.separateBlockingFailure, true);
  // The separate blocking failure wins the trip out of the amber watch band.
  assert.equal(productStatusFromAssessment('FAIL', c.connectionViability, c.separateBlockingFailure), 'DISRUPTED');
  assert.equal(remainderViabilityFromAssessment('FAIL', c.connectionViability, c.separateBlockingFailure), 'NOT_VIABLE');
  assert.equal(semanticStateFromAssessment('FAIL', c.connectionViability, c.separateBlockingFailure), 'FAILED');
  // A separate blocking dimension makes the case planning-eligible even though
  // the connection itself is only tight.
  assert.equal(recoveryPlanningEligibleFromAssessment(assessment), true);
});

test('A5 FIX-2 (3b): a NON-blocking separate FAIL does not pull a tight connection out of amber', () => {
  // An authorised objective loss is non-blocking, so it is not a "separate
  // blocking failure"; the tight connection stays watchable amber.
  const assessment = {
    overallVerdict: 'FAIL' as const,
    dimensions: [
      {
        dimension: 'connection_feasibility', applicable: true, blocking: true, verdict: 'FAIL' as const,
        explanations: [{ status: 'FAIL' as const, reasonCode: 'connection_below_minimum', facts: { gapMinutes: 12 } }],
      },
      {
        dimension: 'objective_coverage', applicable: true, blocking: false, verdict: 'FAIL' as const,
        explanations: [{ status: 'FAIL' as const, reasonCode: 'authorised_objective_loss' }],
      },
    ],
  };
  const c = classifyAssessmentConnection(assessment);
  assert.equal(c.connectionViability, 'TIGHT');
  assert.equal(c.separateBlockingFailure, false);
  assert.equal(productStatusFromAssessment('FAIL', c.connectionViability, c.separateBlockingFailure), 'AT_RISK');
  assert.equal(recoveryPlanningEligibleFromAssessment(assessment), false);
});

test('A5 FIX-2 (4): among multiple connections a broken one wins regardless of explanation order', () => {
  // Broken sorts LAST here; content-hash ordering is arbitrary w.r.t. severity,
  // so reading explanations[0] would wrongly report TIGHT.
  const assessment = {
    overallVerdict: 'FAIL' as const,
    dimensions: [{
      dimension: 'connection_feasibility', applicable: true, blocking: true, verdict: 'FAIL' as const,
      explanations: [
        { status: 'FAIL' as const, reasonCode: 'connection_below_minimum', facts: { gapMinutes: 15 } },
        { status: 'FAIL' as const, reasonCode: 'connection_below_minimum', facts: { gapMinutes: 9 } },
        { status: 'FAIL' as const, reasonCode: 'connection_broken', facts: { gapMinutes: -25 } },
      ],
    }],
  };
  const c = classifyAssessmentConnection(assessment);
  assert.equal(c.connectionViability, 'IMPOSSIBLE');
  assert.equal(productStatusFromAssessment('FAIL', c.connectionViability, c.separateBlockingFailure), 'DISRUPTED');
  assert.equal(recoveryPlanningEligibleFromAssessment(assessment), true);
});

test('A5 FIX-2 (5): reordering the explanations yields the identical classification (order-independence)', () => {
  const mk = (explanations: readonly { status: 'FAIL'; reasonCode: string; facts: { gapMinutes: number } }[]) => ({
    overallVerdict: 'FAIL' as const,
    dimensions: [{
      dimension: 'connection_feasibility', applicable: true, blocking: true, verdict: 'FAIL' as const,
      explanations,
    }],
  });
  const brokenFirst = mk([
    { status: 'FAIL', reasonCode: 'connection_broken', facts: { gapMinutes: -25 } },
    { status: 'FAIL', reasonCode: 'connection_below_minimum', facts: { gapMinutes: 15 } },
  ]);
  const brokenLast = mk([
    { status: 'FAIL', reasonCode: 'connection_below_minimum', facts: { gapMinutes: 15 } },
    { status: 'FAIL', reasonCode: 'connection_broken', facts: { gapMinutes: -25 } },
  ]);
  assert.deepEqual(classifyAssessmentConnection(brokenFirst), classifyAssessmentConnection(brokenLast));
  assert.equal(classifyAssessmentConnection(brokenFirst).connectionViability, 'IMPOSSIBLE');
  assert.equal(classifyAssessmentConnection(brokenLast).connectionViability, 'IMPOSSIBLE');
});

test('A5 FIX-2 (6): transfer_does_not_fit classifies from the evaluator real gap fact, not blind TIGHT', () => {
  // A NEGATIVE transfer gap = the onward leg has already departed: physically
  // impossible, red, planning-eligible.
  const impossible = {
    overallVerdict: 'FAIL' as const,
    dimensions: [{
      dimension: 'connection_feasibility', applicable: true, blocking: true, verdict: 'FAIL' as const,
      explanations: [{ status: 'FAIL' as const, reasonCode: 'transfer_does_not_fit', facts: { gapMinutes: -5 } }],
    }],
  };
  assert.equal(classifyAssessmentConnection(impossible).connectionViability, 'IMPOSSIBLE');
  assert.equal(productStatusFromAssessment('FAIL', 'IMPOSSIBLE', false), 'DISRUPTED');
  assert.equal(recoveryPlanningEligibleFromAssessment(impossible), true);

  // A POSITIVE transfer gap below the registered transfer time is merely tight:
  // watchable amber, not planning-eligible.
  const tight = {
    overallVerdict: 'FAIL' as const,
    dimensions: [{
      dimension: 'connection_feasibility', applicable: true, blocking: true, verdict: 'FAIL' as const,
      explanations: [{ status: 'FAIL' as const, reasonCode: 'transfer_does_not_fit', facts: { gapMinutes: 20 } }],
    }],
  };
  assert.equal(classifyAssessmentConnection(tight).connectionViability, 'TIGHT');
  assert.equal(productStatusFromAssessment('FAIL', 'TIGHT', false), 'AT_RISK');
  assert.equal(recoveryPlanningEligibleFromAssessment(tight), false);

  // An absent gap fact stays conservatively TIGHT (never silently upgraded to red).
  const noGap = {
    overallVerdict: 'FAIL' as const,
    dimensions: [{
      dimension: 'connection_feasibility', applicable: true, blocking: true, verdict: 'FAIL' as const,
      explanations: [{ status: 'FAIL' as const, reasonCode: 'transfer_does_not_fit' }],
    }],
  };
  assert.equal(classifyAssessmentConnection(noGap).connectionViability, 'TIGHT');
});

test('A5 FIX-2: classify ignores PASS/UNKNOWN explanations and non-applicable connection dimensions', () => {
  // A PASS connection dimension is VIABLE, not aggregated with stale FAILs.
  assert.equal(classifyAssessmentConnection({
    dimensions: [{
      dimension: 'connection_feasibility', applicable: true, blocking: true, verdict: 'PASS' as const,
      explanations: [{ status: 'PASS' as const, reasonCode: 'connection_meets_minimum' }],
    }],
  }).connectionViability, 'VIABLE');
  // A non-applicable connection dimension contributes no hint.
  assert.equal(classifyAssessmentConnection({
    dimensions: [{
      dimension: 'connection_feasibility', applicable: false, blocking: true, verdict: 'FAIL' as const,
      explanations: [{ status: 'FAIL' as const, reasonCode: 'connection_broken' }],
    }],
  }).connectionViability, undefined);
});

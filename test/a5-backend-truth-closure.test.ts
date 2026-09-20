/**
 * A5 backend truth — connection-aware product status and progression gating.
 * Pure tests; no PostgreSQL / scenario names.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
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

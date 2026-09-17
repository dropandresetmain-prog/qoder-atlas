/**
 * Overview populationAssessmentLifecycle — derived only from authoritative
 * per-subject evaluation (PENDING_REASSESSMENT), never from readiness counts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectOperatorOverview } from '../src/app/target/readmodels/projectOperatorOverview.ts';
import type { OperatorOverviewFacts } from '../src/app/target/readmodels/types.ts';

const generatedAt = '2031-09-15T08:00:00.000Z';

function baseFacts(population: OperatorOverviewFacts['population']): OperatorOverviewFacts {
  return {
    generatedAt,
    projectionRevision: 7,
    changedVisibleRefs: [],
    changedEdgeIds: [],
    currentSemanticState: 'HEALTHY',
    nodes: [],
    edges: [],
    items: [],
    population,
  };
}

test('empty population is SETTLED with pendingCount 0', () => {
  const view = projectOperatorOverview(baseFacts([]));
  assert.deepEqual(view.populationAssessmentLifecycle, { state: 'SETTLED', pendingCount: 0 });
});

test('CURRENT subjects alone are SETTLED', () => {
  const view = projectOperatorOverview(baseFacts([
    {
      journeyRef: 'JOURNEY:a',
      tripRef: 'TRIP:a',
      travellerLabel: 'A',
      obligation: 'REQUIRED',
      status: 'READY',
      remainderViability: 'VIABLE',
      evaluation: 'CURRENT',
    },
    {
      journeyRef: 'JOURNEY:b',
      tripRef: 'TRIP:b',
      travellerLabel: 'B',
      obligation: 'OPTIONAL',
      status: 'DISRUPTED',
      remainderViability: 'NOT_VIABLE',
      evaluation: 'CURRENT',
    },
  ]));
  assert.deepEqual(view.populationAssessmentLifecycle, { state: 'SETTLED', pendingCount: 0 });
  assert.equal(view.populationSummary.ready, 1);
  assert.equal(view.populationSummary.disrupted, 1);
});

test('any PENDING_REASSESSMENT makes RECONCILING with truthful pendingCount', () => {
  const view = projectOperatorOverview(baseFacts([
    {
      journeyRef: 'JOURNEY:a',
      tripRef: 'TRIP:a',
      travellerLabel: 'A',
      obligation: 'REQUIRED',
      status: 'UNKNOWN',
      remainderViability: 'UNKNOWN',
      evaluation: 'PENDING_REASSESSMENT',
    },
    {
      journeyRef: 'JOURNEY:b',
      tripRef: 'TRIP:b',
      travellerLabel: 'B',
      obligation: 'REQUIRED',
      status: 'UNKNOWN',
      remainderViability: 'UNKNOWN',
      evaluation: 'PENDING_REASSESSMENT',
    },
    {
      journeyRef: 'JOURNEY:c',
      tripRef: 'TRIP:c',
      travellerLabel: 'C',
      obligation: 'OPTIONAL',
      status: 'READY',
      remainderViability: 'VIABLE',
      evaluation: 'CURRENT',
    },
  ]));
  assert.deepEqual(view.populationAssessmentLifecycle, { state: 'RECONCILING', pendingCount: 2 });
  // Projector does not invent settled readiness from pending subjects.
  assert.equal(view.populationSummary.ready, 1);
  assert.equal(view.populationSummary.unknown, 2);
});

test('STALE alone does not mark RECONCILING (only open reassessment work does)', () => {
  const view = projectOperatorOverview(baseFacts([
    {
      journeyRef: 'JOURNEY:a',
      tripRef: 'TRIP:a',
      travellerLabel: 'A',
      obligation: 'REQUIRED',
      status: 'UNKNOWN',
      remainderViability: 'UNKNOWN',
      evaluation: 'STALE',
    },
  ]));
  assert.deepEqual(view.populationAssessmentLifecycle, { state: 'SETTLED', pendingCount: 0 });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  projectLiveDependencyGraph,
  projectOperatorOverview,
  projectRecoveryCase,
  projectTravellerTrip,
} from '../src/app/target/readmodels/index.ts';

const generatedAt = '2031-05-01T00:00:00.000Z';

const graphFacts = {
  generatedAt,
  projectionRevision: 4,
  changedVisibleRefs: ['booking-1'],
  changedEdgeIds: [] as const,
  previousSemanticState: 'HEALTHY' as const,
  currentSemanticState: 'AFFECTED' as const,
  changedAt: generatedAt,
  changeSource: 'provider update',
  nodes: [
    { ref: 'incident-1', kind: 'DISRUPTION' as const, label: 'Service interruption', semanticState: 'AFFECTED' as const },
    { ref: 'booking-1', kind: 'SERVICE_BOOKING' as const, label: 'Transport booking', semanticState: 'AFFECTED' as const },
  ],
  edges: [{ id: 'booking-1->incident-1', fromRef: 'booking-1', toRef: 'incident-1', kind: 'AFFECTED_BY' as const }],
};

test('recovery case keeps booking health separate from trip failure', () => {
  const view = projectRecoveryCase({
    ...graphFacts,
    caseRef: 'case-1',
    status: 'OPEN',
    changeSummary: 'A booked service changed.',
    bookingServiceState: { label: 'Booking', state: 'AFFECTED' },
    tripViability: { label: 'Remaining trip', verdict: 'FAIL' },
    authorityState: 'Awaiting review',
    executionState: 'Not started',
    reconciliationState: 'Not started',
  });
  assert.equal(view.bookingServiceState.state, 'AFFECTED');
  assert.equal(view.tripViability.verdict, 'FAIL');
});

test('LDG exposes presentation refs and labels, never raw table names', () => {
  const graph = projectLiveDependencyGraph({ ...graphFacts, scope: 'DASHBOARD' });
  const encoded = JSON.stringify(graph);
  assert.doesNotMatch(encoded, /booking_table|trip_table|raw_sql_table/i);
  assert.equal(graph.nodes[0]?.label, 'Service interruption');
});

test('change awareness carries the previous and current semantic states', () => {
  const graph = projectLiveDependencyGraph({ ...graphFacts, scope: 'FOCUSED_CASE' });
  assert.equal(graph.change.previousSemanticState, 'HEALTHY');
  assert.equal(graph.change.currentSemanticState, 'AFFECTED');
  assert.deepEqual(graph.change.changedVisibleRefs, ['booking-1']);
});

test('operator overview produces deterministic status buckets', () => {
  const view = projectOperatorOverview({
    ...graphFacts,
    items: [
      { tripRef: 'trip-1', travellerLabel: 'Traveller one', status: 'READY', remainderViability: 'VIABLE' },
      { tripRef: 'trip-2', travellerLabel: 'Traveller two', status: 'AT_RISK', remainderViability: 'AT_RISK' },
      { tripRef: 'trip-3', travellerLabel: 'Traveller three', status: 'DISRUPTED', remainderViability: 'NOT_VIABLE' },
      { tripRef: 'trip-4', travellerLabel: 'Traveller four', status: 'RECOVERING', remainderViability: 'UNKNOWN' },
      { tripRef: 'trip-5', travellerLabel: 'Traveller five', status: 'UNKNOWN', remainderViability: 'UNKNOWN' },
    ],
  });
  assert.deepEqual(view.summary, { ready: 1, atRisk: 1, disrupted: 1, recovering: 1, unknown: 1 });
});

test('traveller trip answers the required questions', () => {
  const view = projectTravellerTrip({
    ...graphFacts,
    tripRef: 'trip-1',
    amIOkay: 'UNKNOWN',
    whatChanged: 'A booked service changed.',
    whatMattersNow: 'Protect the next commitment.',
    whatNorthstarIsDoing: 'Checking recovery options.',
    whatDoYouNeedFromMe: 'Wait for an approval request.',
    doesTheRestWork: 'AT_RISK',
  });
  assert.equal(view.amIOkay, 'UNKNOWN');
  assert.ok(view.whatChanged);
  assert.ok(view.whatMattersNow);
  assert.ok(view.whatNorthstarIsDoing);
  assert.ok(view.whatDoYouNeedFromMe);
  assert.equal(view.doesTheRestWork, 'AT_RISK');
});

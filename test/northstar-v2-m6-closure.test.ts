/**
 * M6 — registered dependency closure (pure). F11: only registered semantics
 * propagate; cycles terminate deterministically; no graph database.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeClosure, DEPENDENCY_REGISTRY, registeredEdgeIssue } from '../src/resolution/impact/closure.ts';
import { DependencySemanticSchema, type DependencyEdge } from '../src/contracts/v2/assessment/explanation.ts';

const ref = (kind: 'TRANSPORT_SERVICE' | 'RESERVATION_LINE' | 'JOURNEY_ITEM' | 'JOURNEY' | 'TRAVELLER' | 'COORDINATION_GROUP' | 'RESOURCE' | 'PROGRAMME_ITEM', id: string) => ({ kind, id });

const service = ref('TRANSPORT_SERVICE', 's1');
const line = ref('RESERVATION_LINE', 'l1');
const itemA = ref('JOURNEY_ITEM', 'ia');
const itemB = ref('JOURNEY_ITEM', 'ib');
const journeyA = ref('JOURNEY', 'ja');
const journeyB = ref('JOURNEY', 'jb');
const journeyC = ref('JOURNEY', 'jc');
const group = ref('COORDINATION_GROUP', 'g1');

const sharedServiceEdges: DependencyEdge[] = [
  { semantic: 'SERVICE_SUPPLIES_LINE', from: service, to: line },
  { semantic: 'ALLOCATION_FULFILS_ITEM', from: line, to: itemA },
  { semantic: 'ALLOCATION_FULFILS_ITEM', from: line, to: itemB },
  { semantic: 'ITEM_OF_JOURNEY', from: itemA, to: journeyA },
  { semantic: 'ITEM_OF_JOURNEY', from: itemB, to: journeyB },
];

test('registry covers every declared semantic exactly once', () => {
  const registered = DEPENDENCY_REGISTRY.map((entry) => entry.semantic).sort();
  assert.deepEqual(registered, [...DependencySemanticSchema.options].sort());
});

test('a shared service change reaches every allocated Journey with a cause-to-subject path', () => {
  const result = computeClosure({ causes: [service], edges: sharedServiceEdges });
  const byKey = new Map(result.reached.map((r) => [`${r.subject.kind}:${r.subject.id}`, r]));
  assert.ok(byKey.has('JOURNEY:ja') && byKey.has('JOURNEY:jb'));
  assert.deepEqual(byKey.get('JOURNEY:ja')?.path.map((e) => e.semantic), ['SERVICE_SUPPLIES_LINE', 'ALLOCATION_FULFILS_ITEM', 'ITEM_OF_JOURNEY']);
  assert.equal(byKey.get('JOURNEY:ja')?.depth, 3);
  assert.equal(result.truncated, false);
});

test('direction is enforced: a Journey change does not flow back to the supplier service', () => {
  const result = computeClosure({ causes: [journeyA], edges: sharedServiceEdges });
  assert.deepEqual(result.reached.map((r) => r.subject), [journeyA]);
});

test('BOTH semantics traverse either way: one member reaches the group and its other members', () => {
  const edges: DependencyEdge[] = [
    { semantic: 'GROUP_MEMBERSHIP', from: group, to: journeyA },
    { semantic: 'GROUP_MEMBERSHIP', from: group, to: journeyC },
  ];
  const result = computeClosure({ causes: [journeyA], edges });
  const reached = result.reached.map((r) => `${r.subject.kind}:${r.subject.id}`);
  assert.deepEqual(reached, ['JOURNEY:ja', 'COORDINATION_GROUP:g1', 'JOURNEY:jc']);
  const viaGroup = result.reached.find((r) => r.subject.id === 'jc');
  assert.deepEqual(viaGroup?.path, [
    { semantic: 'GROUP_MEMBERSHIP', from: journeyA, to: group },
    { semantic: 'GROUP_MEMBERSHIP', from: group, to: journeyC },
  ]);
});

test('cycles terminate and the result is independent of edge order', () => {
  const resource = ref('RESOURCE', 'r1');
  const activityA = ref('PROGRAMME_ITEM', 'pa');
  const activityB = ref('PROGRAMME_ITEM', 'pb');
  const cyclic: DependencyEdge[] = [
    { semantic: 'RESOURCE_ASSIGNED_TO_ACTIVITY', from: resource, to: activityA },
    { semantic: 'RESOURCE_ASSIGNED_TO_ACTIVITY', from: resource, to: activityB },
    { semantic: 'EXPLICIT_CONNECTS_TO', from: activityA, to: activityB },
    { semantic: 'EXPLICIT_CONNECTS_TO', from: activityB, to: activityA },
  ];
  const forward = computeClosure({ causes: [activityA], edges: cyclic });
  const reversed = computeClosure({ causes: [activityA], edges: [...cyclic].reverse() });
  assert.deepEqual(forward, reversed);
  assert.equal(forward.reached.length, 3);
  assert.equal(forward.truncated, false);
});

test('an unregistered or kind-mismatched edge is reported and never traversed', () => {
  const bogus = [
    { semantic: 'SHARES_RESOURCE_WITH', from: journeyA, to: journeyB } as unknown as DependencyEdge,
    { semantic: 'ITEM_OF_JOURNEY', from: journeyA, to: journeyB } as DependencyEdge,
  ];
  assert.match(registeredEdgeIssue(bogus[0]!) ?? '', /unregistered/);
  assert.match(registeredEdgeIssue(bogus[1]!) ?? '', /cannot start at JOURNEY/);
  const result = computeClosure({ causes: [journeyA], edges: bogus });
  assert.equal(result.rejectedEdges.length, 2);
  assert.deepEqual(result.reached.map((r) => r.subject), [journeyA]);
});

test('maxDepth truncation is explicit, never silent', () => {
  const result = computeClosure({ causes: [service], edges: sharedServiceEdges, maxDepth: 1 });
  assert.equal(result.truncated, true);
  assert.ok(result.reached.every((r) => r.depth <= 1));
});

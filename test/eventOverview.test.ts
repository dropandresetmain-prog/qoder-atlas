/**
 * buildEventOverview — pure, generic derivation of the bounded Event Overview
 * projection. Synthetic neutral fixtures only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEventOverview } from '../src/app/target/readmodels/eventOverview.ts';
import { projectOperatorOverview } from '../src/app/target/readmodels/projectOperatorOverview.ts';
import { EventOverviewSchema, OperatorOverviewSchema } from '../src/contracts/v2/product/readModels.ts';
import { adaptOperatorOverviewToDashboard } from '../src/app/target/adapters/operatorOverviewAdapter.ts';
import { renderProductOperatorOverview } from '../src/ui/screens/product-operator-overview.ts';
import type { EventOverviewSourceFacts, OperatorOverviewFacts, OperatorPopulationFact } from '../src/app/target/readmodels/types.ts';
import { computeOverviewLayout } from '../src/ui/overview-graph/layout.ts';
import type { OgNode, OverviewGraphModel } from '../src/ui/overview-graph/model.ts';

type Status = OperatorPopulationFact['status'];
type Evaluation = OperatorPopulationFact['evaluation'];

function pop(n: number, status: Status = 'READY', evaluation: Evaluation = 'CURRENT', extra: Partial<OperatorPopulationFact> = {}): OperatorPopulationFact {
  const id = String(n).padStart(3, '0');
  return {
    journeyRef: `JOURNEY:${id}`,
    tripRef: `TRIP:${id}`,
    travellerLabel: `Traveller ${id}`,
    obligation: 'REQUIRED',
    status,
    remainderViability: status === 'READY' ? 'VIABLE' : status === 'DISRUPTED' ? 'NOT_VIABLE' : 'UNKNOWN',
    evaluation,
    ...extra,
  };
}

function item(n: number, day: number, hour: number) {
  const id = String(n).padStart(3, '0');
  const dd = String(10 + day).padStart(2, '0');
  const hh = String(hour).padStart(2, '0');
  return { itemRef: `PROGRAMME_ITEM:${id}`, title: `Session ${id}`, localDate: `2031-03-${dd}`, localTime: `${hh}:00`, windowStart: `2031-03-${dd}T${hh}:00:00Z` };
}

function svc(journey: number, service: string, changed = false) {
  return {
    journeyRef: `JOURNEY:${String(journey).padStart(3, '0')}`,
    serviceRef: `SERVICE:${service}`,
    mode: 'AIR' as const,
    operator: `Service ${service}`,
    arrivalLocalDate: '2031-03-11',
    arrivalLocalTime: changed ? '10:40' : '07:25',
    publishedArrivalLocalTime: '07:25',
    changed,
  };
}

function part(journey: number, itemN: number, obligation: 'REQUIRED' | 'OPTIONAL' | 'INFORMED' = 'REQUIRED') {
  return { itemRef: `PROGRAMME_ITEM:${String(itemN).padStart(3, '0')}`, journeyRef: `JOURNEY:${String(journey).padStart(3, '0')}`, obligation };
}

// 3 days x 6 items; travellers attend two items on a day derived from their id.
function baseSource(n: number, changedService = false): EventOverviewSourceFacts {
  const programmeItems = [];
  for (let d = 1; d <= 3; d++) for (let k = 1; k <= 6; k++) programmeItems.push(item(d * 10 + k, d, 8 + k));
  const participations = [];
  for (let j = 1; j <= n; j++) {
    const d = (j % 3) + 1;
    participations.push(part(j, d * 10 + 1), part(j, d * 10 + 2));
  }
  const journeyServices = [];
  for (let j = 1; j <= n; j++) journeyServices.push(svc(j, j % 2 === 0 ? 'Alpha' : 'Beta', changedService && j % 2 === 0));
  return { programmeItems, participations, journeyServices };
}

test('healthy world: shared dependencies, capped landmarks, cohorts cover population, no blast', () => {
  const population = Array.from({ length: 12 }, (_, i) => pop(i + 1));
  const ov = buildEventOverview({ source: baseSource(12), population, items: [] });
  EventOverviewSchema.parse(ov);
  assert.equal(ov.days.length, 3);
  assert.equal(ov.days[0]!.dateLabel, 'Tue 11 Mar');
  assert.equal(ov.blastRadius, undefined);
  assert.equal(ov.promotedTravellers.length, 0);
  assert.equal(ov.promotedOverflow, 0);
  assert.equal(ov.cohorts.reduce((s, c) => s + c.total, 0), population.length);
  assert.ok(ov.dependencies.length === 2 && ov.dependencies.every((d) => !d.changed && d.health === 'GREEN' && d.clearedCount === 0));
  for (let d = 1; d <= 3; d++) assert.ok(ov.landmarks.filter((l) => l.dayIndex === d).length <= 4);
  assert.ok(ov.landmarks.every((l) => l.health === 'GREEN'));
  assert.ok(ov.dependencies.every((d) => d.feedsLandmarkRef));
});

test('changed shared dependency: memberships, blast counts, landmark health, promotion cap', () => {
  const population: OperatorPopulationFact[] = [];
  // Even journeys share the changed service: 2..40 => 20 members.
  for (let j = 1; j <= 40; j++) {
    if (j % 2 !== 0) population.push(pop(j));
    else if (j <= 10) population.push(pop(j, 'READY', 'CURRENT')); // cleared
    else if (j <= 20) population.push(pop(j, 'DISRUPTED', 'CURRENT')); // unresolved
    else population.push(pop(j, 'UNKNOWN', 'PENDING_REASSESSMENT')); // checking
  }
  const ov = buildEventOverview({ source: baseSource(40, true), population, items: [] });
  EventOverviewSchema.parse(ov);
  const br = ov.blastRadius!;
  assert.equal(br.affectedCount, 20);
  assert.equal(br.clearedCount, 5);
  assert.equal(br.unresolvedCount, 5);
  assert.equal(br.checkingCount, 10);
  assert.equal(br.dependencyRef, 'SERVICE:Alpha');
  const dep = ov.dependencies[0]!;
  assert.equal(dep.ref, 'SERVICE:Alpha');
  assert.ok(dep.changed && dep.health === 'AMBER');
  assert.equal(dep.detailLabel, 'Arrives 10:40 · was 07:25');
  assert.equal(dep.travellerCount, 20);
  assert.equal(ov.promotedTravellers.length, 16);
  assert.equal(ov.promotedOverflow, 4);
  assert.deepEqual(ov.promotedTravellers.slice(0, 5).map((t) => t.membership), Array(5).fill('UNRESOLVED'));
  assert.ok(ov.promotedTravellers.every((t) => t.dependencyRef === 'SERVICE:Alpha' && t.roleLabel === 'Required attendee'));
  assert.equal(ov.promotedTravellers.length + ov.cohorts.reduce((s, c) => s + c.total, 0), population.length);
  assert.ok(ov.landmarks.some((l) => l.health === 'RED'));
  assert.ok(br.landmarkRefs.length > 0 && br.landmarkRefs.length <= 12);
});

test('cleared members remain promoted and listed after the others', () => {
  const population = [pop(1), pop(2), pop(3, 'DISRUPTED'), pop(4, 'UNKNOWN', 'STALE')];
  const src: EventOverviewSourceFacts = {
    programmeItems: [item(1, 1, 9)],
    participations: population.map((_, i) => part(i + 1, 1)),
    journeyServices: [svc(1, 'Alpha', true), svc(2, 'Alpha', true), svc(3, 'Alpha', true), svc(4, 'Alpha', true)],
  };
  const ov = buildEventOverview({ source: src, population, items: [] });
  assert.deepEqual(ov.promotedTravellers.map((t) => t.membership), ['UNRESOLVED', 'CHECKING', 'CLEARED', 'CLEARED']);
  assert.deepEqual(ov.blastRadius && [ov.blastRadius.clearedCount, ov.blastRadius.checkingCount, ov.blastRadius.unresolvedCount], [2, 1, 1]);
  assert.equal(ov.landmarks[0]!.health, 'RED');
  assert.equal(ov.landmarks[0]!.affectedCount, 2);
});

test('AMBER landmark when a participant is only being checked', () => {
  const population = [pop(1), pop(2, 'UNKNOWN', 'PENDING_REASSESSMENT')];
  const src: EventOverviewSourceFacts = {
    programmeItems: [item(1, 1, 9)],
    participations: [part(1, 1), part(2, 1)],
    journeyServices: [],
  };
  const ov = buildEventOverview({ source: src, population, items: [] });
  assert.equal(ov.landmarks[0]!.health, 'AMBER');
  assert.equal(ov.blastRadius, undefined);
});

test('generic: no case and no change means no promotion; case with non-ready status promotes as ATTENTION', () => {
  const quiet = buildEventOverview({ source: baseSource(6), population: Array.from({ length: 6 }, (_, i) => pop(i + 1, 'DISRUPTED')), items: [] });
  assert.equal(quiet.promotedTravellers.length, 0);
  const withCase = buildEventOverview({
    source: baseSource(6),
    population: [pop(1, 'DISRUPTED', 'CURRENT', { caseRef: 'case-x' }), ...Array.from({ length: 5 }, (_, i) => pop(i + 2))],
    items: [],
  });
  assert.equal(withCase.promotedTravellers.length, 1);
  assert.equal(withCase.promotedTravellers[0]!.membership, 'ATTENTION');
  assert.equal(withCase.promotedTravellers[0]!.caseRef, 'case-x');
  assert.ok(withCase.promotedTravellers[0]!.landmarkRef);
  assert.equal(withCase.blastRadius, undefined);
});

test('empty source still yields a valid empty projection', () => {
  const ov = buildEventOverview({ source: { programmeItems: [], participations: [], journeyServices: [] }, population: [], items: [] });
  EventOverviewSchema.parse(ov);
  assert.deepEqual(ov.days, []);
  assert.deepEqual(ov.cohorts, []);
});

test('deterministic: equal input, equal output regardless of row order', () => {
  const population = Array.from({ length: 20 }, (_, i) => pop(i + 1, i % 3 === 0 ? 'DISRUPTED' : 'READY'));
  const source = baseSource(20, true);
  const a = buildEventOverview({ source, population, items: [] });
  const b = buildEventOverview({
    source: {
      programmeItems: [...source.programmeItems].reverse(),
      participations: [...source.participations].reverse(),
      journeyServices: [...source.journeyServices].reverse(),
    },
    population,
    items: [],
  });
  assert.deepEqual(a, b);
});

test('projectOperatorOverview includes a schema-valid eventOverview only when source is present', () => {
  const population = Array.from({ length: 8 }, (_, i) => pop(i + 1));
  const facts: OperatorOverviewFacts = {
    generatedAt: '2031-03-10T08:00:00.000Z',
    projectionRevision: 1,
    changedVisibleRefs: [],
    changedEdgeIds: [],
    currentSemanticState: 'HEALTHY',
    nodes: [],
    edges: [],
    items: [],
    population,
  };
  assert.equal(OperatorOverviewSchema.parse(projectOperatorOverview(facts)).eventOverview, undefined);
  const view = projectOperatorOverview({ ...facts, eventOverviewSource: baseSource(8) });
  OperatorOverviewSchema.parse(view);
  assert.ok(view.eventOverview && view.eventOverview.days.length === 3);
});

test('operator overview keeps attention queue and full managed population', () => {
  const population = [
    pop(1, 'DISRUPTED', 'CURRENT', { caseRef: 'CASE:one' }),
    pop(2, 'READY'),
  ];
  const facts: OperatorOverviewFacts = {
    generatedAt: '2031-03-10T08:00:00.000Z',
    projectionRevision: 1,
    changedVisibleRefs: [],
    changedEdgeIds: [],
    currentSemanticState: 'AFFECTED',
    nodes: [],
    edges: [],
    items: [{
      tripRef: 'TRIP:001',
      travellerLabel: 'Traveller 001',
      status: 'DISRUPTED',
      remainderViability: 'NOT_VIABLE',
      caseRef: 'CASE:one',
      affectedPeople: [],
      affectedItems: [],
      decisionRequired: true,
      unresolvedUncertainty: [],
    }],
    population,
    eventOverviewSource: baseSource(2),
  };
  const view = projectOperatorOverview(facts);
  const surface = adaptOperatorOverviewToDashboard(view);
  const html = renderProductOperatorOverview(view);

  assert.equal(surface.attentionCount, 1);
  assert.equal(surface.rosterCount, 2);
  assert.match(surface.attentionHtml, /data-test="overview-item"/);
  assert.match(surface.rosterHtml, /data-test="population-row"/);
  assert.match(html, /data-test="event-overview-graph"/);
  assert.match(html, /Traveller 001/);
  assert.match(html, /Traveller 002/);
});

function geometryNode(id: string, kind: OgNode['kind'], dayIndex?: number): OgNode {
  return {
    id,
    kind,
    health: kind === 'cohort' ? 'neutral' : 'green',
    type: kind,
    title: id,
    ...(dayIndex === undefined ? {} : { dayIndex }),
    dim: false,
    faded: false,
    attention: false,
  };
}

function overviewGeometryFixture(): OverviewGraphModel {
  const days = Array.from({ length: 14 }, (_, i) => ({ index: i + 1, title: `Day ${i + 1}`, sub: `Date ${i + 1}` }));
  const landmarks = Array.from({ length: 42 }, (_, i) => geometryNode(`landmark-${i}`, 'landmark', (i % 14) + 1));
  const dependencies = Array.from({ length: 12 }, (_, i) => geometryNode(`dependency-${i}`, 'dependency', (i % 14) + 1));
  const travellers = Array.from({ length: 16 }, (_, i) => geometryNode(`traveller-${i}`, 'traveller'));
  const cohorts = [
    geometryNode('cohort-1', 'cohort', 4),
    geometryNode('cohort-2', 'cohort', 4),
    geometryNode('cohort-3', 'cohort', 4),
  ];
  const relations = dependencies.map((node, i) => ({
    id: `dep:${node.id}>landmark-${i}`,
    from: node.id,
    to: `landmark-${i}`,
    health: 'green' as const,
    live: true,
    dim: false,
  }));
  return { days, nodes: [...dependencies, ...landmarks, ...travellers, ...cohorts], relations, active: false };
}

test('overview layout keeps packed dependencies above the spine and cards disjoint at stress counts', () => {
  const fixture = overviewGeometryFixture();
  const layout = computeOverviewLayout(fixture);
  const entries = [...layout.boxes.entries()];

  for (let i = 0; i < entries.length; i += 1) {
    const [leftId, left] = entries[i]!;
    assert.ok(left.x >= 0 && left.y >= 0, `${leftId} starts inside the world`);
    assert.ok(left.x + left.w <= layout.width, `${leftId} ends inside the world width`);
    assert.ok(left.y + left.h <= layout.height, `${leftId} ends inside the world height`);
    for (let j = i + 1; j < entries.length; j += 1) {
      const [rightId, right] = entries[j]!;
      const overlaps = left.x < right.x + right.w && right.x < left.x + left.w
        && left.y < right.y + right.h && right.y < left.y + left.h;
      assert.equal(overlaps, false, `${leftId} must not overlap ${rightId}`);
    }
  }

  const dependencyBoxes = entries.filter(([id]) => id.startsWith('dependency-')).map(([, box]) => box);
  assert.ok(dependencyBoxes.every((box) => box.y + box.h <= layout.lane.y), 'all dependency rows clear the programme lane');
  assert.equal(layout.width, 14 * 330 + 40, 'world width stays bounded by programme territories');

  const sameDayCohorts = entries.filter(([id]) => id.startsWith('cohort-')).map(([, box]) => box);
  assert.equal(new Set(sameDayCohorts.map((box) => box.y)).size, sameDayCohorts.length, 'same-day cohorts stack into distinct rows');

  const wrapped = computeOverviewLayout({ ...fixture, days: fixture.days.slice(0, 2) });
  const wrappedDependencies = [...wrapped.boxes.entries()]
    .filter(([id]) => id.startsWith('dependency-'))
    .map(([, box]) => box);
  assert.ok(new Set(wrappedDependencies.map((box) => box.y)).size > 1, 'bounded dependency packing exercises multiple rows');
  assert.ok(wrappedDependencies.every((box) => box.y + box.h <= wrapped.lane.y), 'wrapped dependency rows clear the programme lane');
});

test('late-day dependency targets do not create nearly empty packing rows', () => {
  const days = [{ index: 1, title: 'One', sub: '' }, { index: 2, title: 'Two', sub: '' }, { index: 3, title: 'Three', sub: '' }];
  const nodes = Array.from({ length: 12 }, (_, i) => geometryNode(`shared-${i}`, 'dependency', 3));
  const layout = computeOverviewLayout({ days, nodes, relations: [], active: false });
  const boxes = [...layout.boxes.values()];
  assert.equal(new Set(boxes.map((box) => box.y)).size, 3, 'twelve cards use the three rows available at five cards per row');
  assert.ok(boxes.every((box) => box.x + box.w <= layout.width));
});

/**
 * M6 evaluator registry: every contract family is registered once, dimensions
 * never collide, topics are the union the snapshot must record, and composing
 * an empty Journey never yields PASS by absence.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { M6_EVALUATORS, createM6Registry } from '../src/resolution/evaluation/registry.ts';
import { assessSubject } from '../src/resolution/evaluation/assess.ts';
import { emptyWorld, effectiveOf, id } from './support/m6World.ts';

const CONTRACT_FAMILIES = [
  'm6.booking', 'm6.connection', 'm6.credentials', 'm6.entry', 'm6.funding', 'm6.group', 'm6.information', 'm6.objective', 'm6.overnight', 'm6.participation', 'm6.support',
];

test('registry holds every contract family once with no dimension collision', () => {
  const registry = createM6Registry();
  const ids = registry.evaluators.map((e) => e.id);
  for (const family of CONTRACT_FAMILIES) assert.ok(ids.includes(family), `missing ${family}`);
  assert.equal(new Set(ids).size, ids.length);
  const dims = M6_EVALUATORS.flatMap((e) => e.dimensions);
  assert.equal(new Set(dims).size, dims.length);
  for (const topic of ['ADVISORY', 'CONDITION', 'ENTRY_REQUIREMENT', 'TRANSIT_REQUIREMENT']) assert.ok(registry.informationTopics.includes(topic), `topic ${topic}`);
  for (const e of M6_EVALUATORS) assert.deepEqual(e.subjectKinds, ['JOURNEY'], `${e.id} assesses Journeys`);
});

test('a Journey with no captured facts is UNKNOWN overall, never PASS, and deterministic', () => {
  const tripId = id();
  const travellerId = id();
  const journeyId = id();
  const world = emptyWorld({
    trips: [{ id: tripId, revision: 1, purpose: 'LEISURE', lifecycleStatus: 'PLANNED', intendedWindow: null, businessContextOrganisationId: null }],
    journeys: [{ id: journeyId, revision: 1, tripId, travellerId, lifecycleStatus: 'PLANNED', intendedWindow: null, responsibilityOrganisationId: null }],
  });
  const run = () => assessSubject({ registry: createM6Registry(), world, effective: effectiveOf(world), subject: { kind: 'JOURNEY', id: journeyId }, now: '2030-01-01T00:00:00.000Z', assessmentId: '00000000-0000-4000-8000-000000000001' }).result;
  const first = run();
  assert.notEqual(first.overallVerdict, 'PASS');
  for (const d of first.dimensions) if (!d.applicable) assert.equal(d.blocking, false, `${d.dimension} not applicable must not block`);
  assert.deepEqual(run(), first);
  const versions = first.manifest.evaluatorVersions.map((v) => v.evaluatorId);
  for (const family of CONTRACT_FAMILIES) assert.ok(versions.includes(family), `manifest records ${family}`);
});

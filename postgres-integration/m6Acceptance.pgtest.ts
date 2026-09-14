/**
 * M6 acceptance over real PostgreSQL — AT01, AT02, AT06, AT10, AT12, AT13
 * evaluator portions (docs/IMPLEMENTATION_PLAN.md §10), all through the ONE
 * registry (`createM6Registry`) and the `evaluateImpact` entry point:
 *
 *  - a canonical ProgrammeItem move, made by the real M4 command, invalidates
 *    every linked Journey and not an unrelated one, then helps one traveller
 *    and harms another (two assessments, never averaged), and the harmed
 *    traveller's booking stays VALID while the Journey is not viable;
 *  - a shared reservation line reaches exactly its allocated travellers across
 *    two Trips, and never a co-traveller of the same Trip on another service;
 *  - absent entry coverage is UNKNOWN; complete coverage with no rule PASSes;
 *    a newly assigned applicable rule invalidates and then FAILs; coverage
 *    expiry invalidates by the clock alone; new applicable information
 *    invalidates;
 *  - every blast-radius field is typed (reason codes, registered semantics,
 *    refs), so a consumer never parses prose.
 *
 * Scenario facts live only in this file's fixture data.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import type { Pool } from '../src/persistence/postgres/pool.ts';
import { beginSeed, commitSeed, type SeedSession } from './m2Seed.ts';
import { seedEvent, seedParticipation, seedProgramme, seedProgrammeItem } from './m4Seed.ts';
import {
  KnowledgeFixture,
  seedBooking,
  seedEngagementIntent,
  seedIntendedVisit,
  seedJourney,
  seedJurisdictionWithPlaces,
  seedService,
  seedTransportIntent,
  seedTraveller,
  seedTrip,
} from './m6WorldSeed.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { updateProgrammeItemSchedule } from '../src/persistence/postgres/commands/programmeCommands.ts';
import { evaluateImpact, type EvaluationRun } from '../src/persistence/postgres/world/pgEvaluation.ts';
import { currentAssessmentView, enqueueDueReassessments } from '../src/persistence/postgres/world/pgAssessments.ts';
import { createM6Registry } from '../src/resolution/evaluation/registry.ts';
import { DEPENDENCY_REGISTRY } from '../src/resolution/impact/closure.ts';
import type { AssessmentDimension, AssessmentResult } from '../src/contracts/v2/assessment/assessmentManifest.ts';
import type { TypedRef } from '../src/domain/v2/shared/identity.ts';

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

const NOW = '2031-06-01T00:00:00.000Z';
const registry = createM6Registry();
const REASON_CODE = /^[a-z][a-z0-9_]*$/;
const SEMANTICS = new Set(DEPENDENCY_REGISTRY.map((r) => r.semantic));

const journeyRef = (id: string): TypedRef => ({ kind: 'JOURNEY', id });

function assessmentOf(run: EvaluationRun, journeyId: string): AssessmentResult {
  const found = run.assessments.find((a) => a.subjects[0]?.subjectRef.id === journeyId);
  assert.ok(found, `assessment for Journey ${journeyId}`);
  return found;
}

function dim(assessment: AssessmentResult, name: string): AssessmentDimension {
  const found = assessment.dimensions.find((d) => d.dimension === name);
  assert.ok(found, `dimension ${name} in ${assessment.dimensions.map((d) => d.dimension).join(',')}`);
  return found;
}

const reasonCodes = (d: AssessmentDimension) => d.explanations.map((e) => e.reasonCode);

/** Structural "no prose needed" check over a whole run. */
function assertMachineQueryable(run: EvaluationRun): void {
  for (const a of run.assessments) {
    for (const d of a.dimensions) {
      for (const e of d.explanations) {
        assert.match(e.reasonCode, REASON_CODE, `${d.dimension} reason code`);
        for (const edge of e.dependencyPath) assert.ok(SEMANTICS.has(edge.semantic), `registered semantic ${edge.semantic}`);
        for (const value of Object.values(e.facts)) assert.ok(value === null || ['string', 'number', 'boolean'].includes(typeof value), 'typed facts');
      }
    }
  }
  for (const s of run.blastRadius.affectedSubjects) for (const edge of s.path) assert.ok(SEMANTICS.has(edge.semantic));
}

/** Status plus the typed staleness/open work, so a failed expectation says why. */
async function viewStatus(pool: Pool, workspaceId: string, journeyId: string, now = NOW): Promise<string> {
  const view = await currentAssessmentView(pool, workspaceId, journeyRef(journeyId), 'VIABILITY', now);
  return view.status === 'CURRENT' ? 'CURRENT' : `${view.status} ${JSON.stringify({ staleness: view.staleness, openWork: view.openWork })}`;
}

async function assertStatus(expected: string, pool: Pool, workspaceId: string, journeyId: string, now = NOW): Promise<void> {
  const actual = await viewStatus(pool, workspaceId, journeyId, now);
  assert.equal(actual.split(' ')[0], expected, actual);
}

/* ------------------------------------------------------------------------ */
/* Scenario 1 — corporate programme: one canonical schedule, two travellers  */
/* ------------------------------------------------------------------------ */

interface ProgrammeWorld {
  pool: Pool; seed: SeedSession; programmeId: string; programmeItemId: string;
  journeyEarly: string; journeyShuttle: string; journeyUnrelated: string;
}

async function programmeWorld(): Promise<ProgrammeWorld> {
  const pool = await sharedTestPool();
  const seed = await beginSeed(pool, 'M6 acceptance programme');
  const origin = await seedJurisdictionWithPlaces(seed, { name: 'Origin regime', places: [{ name: 'Origin station', placeType: 'STATION' }] });
  const host = await seedJurisdictionWithPlaces(seed, { name: 'Host regime', places: [{ name: 'Arrival hub', placeType: 'STATION' }, { name: 'Meeting venue', placeType: 'VENUE' }] });
  const elsewhere = await seedJurisdictionWithPlaces(seed, { name: 'Unrelated regime', places: [{ name: 'Far origin', placeType: 'STATION' }, { name: 'Far destination', placeType: 'STATION' }] });
  const [originId] = origin.placeIds as [string];
  const [hubId, venueId] = host.placeIds as [string, string];
  const [farA, farB] = elsewhere.placeIds as [string, string];

  const trip = async () => seedTrip(seed);
  const person = async () => (await seedTraveller(seed)).travellerId;
  const travellerEarly = await person();
  const travellerShuttle = await person();
  const travellerUnrelated = await person();
  const journeyEarly = await seedJourney(seed, { tripId: await trip(), travellerId: travellerEarly });
  const journeyShuttle = await seedJourney(seed, { tripId: await trip(), travellerId: travellerShuttle });
  const journeyUnrelated = await seedJourney(seed, { tripId: await trip(), travellerId: travellerUnrelated });

  const service = async (from: string, to: string, departure: string, arrival: string) =>
    seedService(seed, { mode: 'RAIL', operator: 'Operator', originPlaceId: from, destinationPlaceId: to, published: { departure, arrival, observedAt: '2031-05-01T00:00:00.000Z' } });
  const inbound = await service(originId, hubId, '2031-06-02T09:00:00.000Z', '2031-06-02T12:00:00.000Z');
  const earlyInbound = await service(originId, hubId, '2031-06-02T08:00:00.000Z', '2031-06-02T11:00:00.000Z');
  const outbound = await service(hubId, originId, '2031-06-02T15:30:00.000Z', '2031-06-02T18:30:00.000Z');
  const unrelatedService = await service(farA, farB, '2031-06-02T09:00:00.000Z', '2031-06-02T10:00:00.000Z');

  const book = async (journeyId: string, travellerId: string, orderKey: string, from: string, to: string, serviceId: string) => {
    const itemId = await seedTransportIntent(seed, { journeyId, orderKey, originPlaceId: from, destinationPlaceId: to, selectedServiceId: serviceId });
    await seedBooking(seed, { travellerId, serviceId, journeyItemId: itemId });
  };
  await book(journeyEarly, travellerEarly, '010', originId, hubId, inbound);
  await book(journeyShuttle, travellerShuttle, '010', originId, hubId, earlyInbound);
  await book(journeyShuttle, travellerShuttle, '030', hubId, originId, outbound);
  await book(journeyUnrelated, travellerUnrelated, '010', farA, farB, unrelatedService);

  const programmeId = await seedProgramme(seed, { eventId: await seedEvent(seed, { title: 'Annual meeting' }) });
  const { programmeItemId } = await seedProgrammeItem(seed, {
    programmeId, placeId: venueId, window: { start: '2031-06-02T14:00:00.000Z', end: '2031-06-02T15:00:00.000Z' }, lifecycleStatus: 'SCHEDULED',
  });
  for (const [journeyId, travellerId, orderKey] of [[journeyEarly, travellerEarly, '020'], [journeyShuttle, travellerShuttle, '020']] as const) {
    const participationId = await seedParticipation(seed, { programmeItemId, travellerId });
    await seedEngagementIntent(seed, { journeyId, orderKey, participationId });
  }
  await commitSeed(seed);

  const knowledge = new KnowledgeFixture(pool, seed);
  const place = (id: string) => ({ kind: 'PLACE', id });
  await knowledge.constraint({ registeredType: 'transfer_minutes', hardness: 'HARD', owner: place(hubId), operands: [
    { key: 'from_place', kind: 'SUBJECT_REF', value: place(hubId) }, { key: 'to_place', kind: 'SUBJECT_REF', value: place(venueId) }, { key: 'minutes', kind: 'NUMBER', value: 60 },
  ] });
  await knowledge.constraint({ registeredType: 'minimum_connection_minutes', hardness: 'HARD', owner: place(hubId), operands: [{ key: 'minutes', kind: 'NUMBER', value: 30 }] });
  return { pool, seed, programmeId, programmeItemId, journeyEarly, journeyShuttle, journeyUnrelated };
}

describe('M6 acceptance: one canonical schedule, individually assessed travellers (AT01, AT02)', () => {
  test('a programme move invalidates only linked Journeys, then helps one traveller and harms another while the booking stays valid', async () => {
    const w = await programmeWorld();
    const ws = w.seed.workspaceId;
    // One capture's manifest is the whole read set of that snapshot, so a subject captured together with
    // programme participants would conservatively read the programme too. The unrelated Journey is
    // therefore assessed from its own capture, as a reassessment worker would do per subject.
    const before = await evaluateImpact(w.pool, { workspaceId: ws, focus: [w.journeyEarly, w.journeyShuttle].map(journeyRef), now: NOW, registry, persist: { actorId: w.seed.actorId } });
    await evaluateImpact(w.pool, { workspaceId: ws, focus: [journeyRef(w.journeyUnrelated)], now: NOW, registry, persist: { actorId: w.seed.actorId } });
    assertMachineQueryable(before);
    const early0 = assessmentOf(before, w.journeyEarly);
    const shuttle0 = assessmentOf(before, w.journeyShuttle);
    assert.equal(dim(early0, 'programme_participation').verdict, 'PASS', JSON.stringify(reasonCodes(dim(early0, 'programme_participation'))));
    assert.equal(dim(shuttle0, 'programme_participation').verdict, 'FAIL');
    assert.ok(reasonCodes(dim(shuttle0, 'programme_participation')).includes('departs_before_item_ends'));
    for (const id of [w.journeyEarly, w.journeyShuttle, w.journeyUnrelated]) await assertStatus('CURRENT', w.pool, ws, id);

    // The one canonical schedule path (M4) moves the item earlier.
    const head = await w.pool.query<{ revision: string }>('SELECT revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2', [ws, w.programmeId]);
    const moved = await updateProgrammeItemSchedule(new PgUnitOfWork(w.pool, ws), {
      workspaceId: ws, actorPrincipalId: w.seed.actorId, idempotencyKey: `m6-at02:${randomUUID()}`,
      programmeId: w.programmeId, programmeItemId: w.programmeItemId, expectedProgrammeRevision: Number(head.rows[0]!.revision),
      window: { start: '2031-06-02T12:30:00.000Z', end: '2031-06-02T13:30:00.000Z' },
    });
    assert.ok(moved.ok, JSON.stringify(moved));

    // AT01: durable invalidation reaches every linked Journey and not the unrelated one.
    await assertStatus('PENDING_REASSESSMENT', w.pool, ws, w.journeyEarly);
    await assertStatus('PENDING_REASSESSMENT', w.pool, ws, w.journeyShuttle);
    await assertStatus('CURRENT', w.pool, ws, w.journeyUnrelated);

    const after = await evaluateImpact(w.pool, { workspaceId: ws, focus: [{ kind: 'PROGRAMME_ITEM', id: w.programmeItemId }], now: NOW, registry, persist: { actorId: w.seed.actorId } });
    assertMachineQueryable(after);
    assert.deepEqual(after.blastRadius.journeys.map((j) => j.journey.id).sort(), [w.journeyEarly, w.journeyShuttle].sort(), 'blast radius = linked Journeys only');

    // AT02: the same move harms one traveller and helps the other.
    const early1 = assessmentOf(after, w.journeyEarly);
    const shuttle1 = assessmentOf(after, w.journeyShuttle);
    assert.equal(dim(early1, 'programme_participation').verdict, 'FAIL', JSON.stringify(reasonCodes(dim(early1, 'programme_participation'))));
    assert.equal(dim(shuttle1, 'programme_participation').verdict, 'PASS', JSON.stringify(reasonCodes(dim(shuttle1, 'programme_participation'))));

    // Booking valid, Journey invalid.
    assert.equal(dim(early1, 'booking_validity').verdict, 'PASS');
    assert.ok(reasonCodes(dim(early1, 'booking_validity')).includes('booking_valid'));
    assert.equal(early1.overallVerdict, 'FAIL');

    // Why, without prose: typed causal path from the moved item to the harmed Journey.
    const harmed = after.blastRadius.journeys.find((j) => j.journey.id === w.journeyEarly)!;
    assert.equal(harmed.path[0]?.from.kind, 'PROGRAMME_ITEM');
    assert.equal(harmed.path.at(-1)?.to.id, w.journeyEarly);
    assert.ok(harmed.blockingIssues.some((i) => i.dimension === 'programme_participation' && i.verdict === 'FAIL'));
    const participationFail = dim(early1, 'programme_participation').explanations.find((e) => e.status === 'FAIL')!;
    assert.ok(participationFail.dependencyPath.length > 0, 'the failing explanation carries the causal path');
    assert.ok(!after.blastRadius.journeys.some((j) => j.journey.id === w.journeyShuttle && j.blockingIssues.some((i) => i.dimension === 'programme_participation')));
  });
});

/* ------------------------------------------------------------------------ */
/* Scenario 2 — shared booking across Trips                                  */
/* ------------------------------------------------------------------------ */

describe('M6 acceptance: shared reservation blast radius across Trips (AT06)', () => {
  test('a shared line reaches exactly its allocated travellers in two Trips, never a same-Trip co-traveller on another service', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'M6 acceptance shared booking');
    const region = await seedJurisdictionWithPlaces(seed, { name: 'Holiday regime', places: [{ name: 'Departure port', placeType: 'PORT' }, { name: 'Island port', placeType: 'PORT' }] });
    const [fromId, toId] = region.placeIds as [string, string];
    const familyTrip = await seedTrip(seed);
    const friendTrip = await seedTrip(seed);
    const parent = (await seedTraveller(seed)).travellerId;
    const friend = (await seedTraveller(seed)).travellerId;
    const sibling = (await seedTraveller(seed)).travellerId;
    const parentJourney = await seedJourney(seed, { tripId: familyTrip, travellerId: parent });
    const siblingJourney = await seedJourney(seed, { tripId: familyTrip, travellerId: sibling });
    const friendJourney = await seedJourney(seed, { tripId: friendTrip, travellerId: friend });
    const ferry = await seedService(seed, { mode: 'SEA', operator: 'Ferry operator', originPlaceId: fromId, destinationPlaceId: toId, published: { departure: '2031-07-01T08:00:00.000Z', arrival: '2031-07-01T10:00:00.000Z' } });
    const laterFerry = await seedService(seed, { mode: 'SEA', operator: 'Ferry operator', originPlaceId: fromId, destinationPlaceId: toId, published: { departure: '2031-07-01T14:00:00.000Z', arrival: '2031-07-01T16:00:00.000Z' } });
    const parentItem = await seedTransportIntent(seed, { journeyId: parentJourney, orderKey: '010', originPlaceId: fromId, destinationPlaceId: toId, selectedServiceId: ferry });
    const friendItem = await seedTransportIntent(seed, { journeyId: friendJourney, orderKey: '010', originPlaceId: fromId, destinationPlaceId: toId, selectedServiceId: ferry });
    const siblingItem = await seedTransportIntent(seed, { journeyId: siblingJourney, orderKey: '010', originPlaceId: fromId, destinationPlaceId: toId, selectedServiceId: laterFerry });
    const shared = await seedBooking(seed, { travellerId: parent, serviceId: ferry, journeyItemId: parentItem });
    const friendAllocation = await seedBooking(seed, { travellerId: friend, serviceId: ferry, journeyItemId: friendItem, reservationId: shared.reservationId });
    assert.equal(friendAllocation.lineId, shared.lineId, 'one line, two allocations');
    await seedBooking(seed, { travellerId: sibling, serviceId: laterFerry, journeyItemId: siblingItem });
    await commitSeed(seed);

    const focus: TypedRef[] = [{ kind: 'RESERVATION_LINE', id: shared.lineId }];
    const run = await evaluateImpact(pool, { workspaceId: seed.workspaceId, focus, now: NOW, registry });
    assertMachineQueryable(run);
    const affected = run.blastRadius.journeys;
    assert.deepEqual(affected.map((j) => j.journey.id).sort(), [parentJourney, friendJourney].sort());
    assert.equal(new Set(affected.map((j) => j.trip.id)).size, 2, 'one booking spans two Trips');
    assert.ok(!run.blastRadius.affectedSubjects.some((s) => s.subject.id === siblingJourney), 'Trip membership alone does not propagate a line change');
    for (const j of affected) {
      assert.equal(j.path[0]?.from.id, shared.lineId);
      assert.equal(j.path.at(-1)?.to.id, j.journey.id);
      assert.equal(assessmentOf(run, j.journey.id).subjects[0]?.subjectRef.id, j.journey.id, 'each person assessed separately');
    }

    // Deterministic closure: a second capture of the same world yields the same radius.
    const again = await evaluateImpact(pool, { workspaceId: seed.workspaceId, focus, now: NOW, registry });
    const shape = (r: EvaluationRun) => r.blastRadius.affectedSubjects.map((s) => `${s.depth}|${s.subject.kind}:${s.subject.id}|${s.path.map((e) => e.semantic).join('>')}`).sort();
    assert.deepEqual(shape(again), shape(run));
  });
});

/* ------------------------------------------------------------------------ */
/* Scenario 3 — entry knowledge: insertion, publication, clock, information  */
/* ------------------------------------------------------------------------ */

describe('M6 acceptance: entry knowledge invalidation (AT10, AT12, AT13)', () => {
  test('absent coverage is UNKNOWN; an inserted applicable rule invalidates and fails; coverage expiry invalidates by clock; new information invalidates', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'M6 acceptance entry');
    const origin = await seedJurisdictionWithPlaces(seed, { name: 'Departure regime', places: [{ name: 'Departure airport', placeType: 'AIRPORT' }] });
    const host = await seedJurisdictionWithPlaces(seed, { name: 'Destination regime', places: [{ name: 'Destination airport', placeType: 'AIRPORT' }] });
    const traveller = (await seedTraveller(seed)).travellerId;
    const journeyId = await seedJourney(seed, { tripId: await seedTrip(seed), travellerId: traveller });
    const flight = await seedService(seed, { operator: 'Carrier', originPlaceId: origin.placeIds[0]!, destinationPlaceId: host.placeIds[0]!, published: { departure: '2031-06-02T06:00:00.000Z', arrival: '2031-06-02T12:00:00.000Z' } });
    const item = await seedTransportIntent(seed, { journeyId, orderKey: '010', originPlaceId: origin.placeIds[0]!, destinationPlaceId: host.placeIds[0]!, selectedServiceId: flight });
    await seedBooking(seed, { travellerId: traveller, serviceId: flight, journeyItemId: item });
    await seedIntendedVisit(seed, { journeyId, jurisdictionId: host.jurisdictionId, purpose: 'BUSINESS', start: '2031-06-02T12:00:00.000Z', end: '2031-06-05T12:00:00.000Z' });
    await commitSeed(seed);
    const ws = seed.workspaceId;
    const knowledge = new KnowledgeFixture(pool, seed);
    const organisationId = await knowledge.organisation('Rule publisher', 'EUR');
    const evaluate = (now = NOW) => evaluateImpact(pool, { workspaceId: ws, focus: [journeyRef(journeyId)], now, registry, persist: { actorId: seed.actorId } });

    // Absence of entry knowledge is never PASS.
    const r0 = await evaluate();
    const entry0 = dim(assessmentOf(r0, journeyId), 'entry_feasibility');
    assert.equal(entry0.verdict, 'UNKNOWN');
    assert.ok(reasonCodes(entry0).includes('requirement_coverage_incomplete'), JSON.stringify(reasonCodes(entry0)));

    // Complete coverage with no applicable requirement: PASS, bounded by the coverage expiry.
    const expiresAt = '2031-06-01T06:00:00.000Z';
    await knowledge.coverage({ topic: 'ENTRY_REQUIREMENT', completeness: 'COMPLETE', jurisdictionId: host.jurisdictionId, expiresAt });
    await assertStatus('PENDING_REASSESSMENT', pool, ws, journeyId);
    const r1 = await evaluate();
    const a1 = assessmentOf(r1, journeyId);
    assert.equal(dim(a1, 'entry_feasibility').verdict, 'PASS', JSON.stringify(reasonCodes(dim(a1, 'entry_feasibility'))));
    assert.ok(reasonCodes(dim(a1, 'entry_feasibility')).includes('no_applicable_requirement_complete_coverage'));
    assert.equal(a1.manifest.nextInvalidationAt, expiresAt);

    // AT12: clock-only expiry, no database change; durable catch-up after downtime.
    await assertStatus('CURRENT', pool, ws, journeyId, '2031-06-01T05:59:59.000Z');
    const expired = await currentAssessmentView(pool, ws, journeyRef(journeyId), 'VIABILITY', expiresAt);
    assert.notEqual(expired.status, 'CURRENT', 'past nextInvalidationAt the stored result is never current');
    assert.ok(expired.staleness.some((s) => s.kind === 'CLOCK_EXPIRED'));
    assert.ok((await enqueueDueReassessments(pool, '2031-06-20T00:00:00.000Z')) >= 1);

    // AT10: an applicable rule inserted later invalidates although no read row changed, and is then evaluated.
    const r2base = await evaluate();
    assert.equal(dim(assessmentOf(r2base, journeyId), 'entry_feasibility').verdict, 'PASS');
    const ruleSet = await knowledge.publishedRuleSet({
      issuerOrganisationId: organisationId, policyFamily: 'entry',
      expression: { operator: 'PREDICATE', predicateId: 'journey.purpose_in', parameters: { purposes: ['LEISURE'] } },
    });
    await knowledge.assignRule({ ruleSetId: ruleSet.ruleSetId, jurisdictionId: host.jurisdictionId, validFrom: '2030-01-01T00:00:00.000Z' });
    await assertStatus('PENDING_REASSESSMENT', pool, ws, journeyId);
    const r2 = await evaluate();
    const entry2 = dim(assessmentOf(r2, journeyId), 'entry_feasibility');
    assert.equal(entry2.verdict, 'FAIL', JSON.stringify(reasonCodes(entry2)));
    assert.ok(reasonCodes(entry2).includes('requirement_not_met'));
    assert.ok(entry2.explanations.some((e) => e.evidenceRefs.some((ref) => ref.kind === 'RULE_SET_VERSION' && ref.id === ruleSet.versionId)), 'the edition is cited as evidence');
    assertMachineQueryable(r2);

    // AT13: newly applicable information on the visited jurisdiction invalidates.
    await knowledge.advisory({ publisherOrganisationId: organisationId, topic: 'ADVISORY', severity: 'LEVEL 2', jurisdictionId: host.jurisdictionId, issuedAt: '2031-05-31T00:00:00.000Z', effective: { start: '2031-05-31T00:00:00.000Z', end: '2031-07-01T00:00:00.000Z' } });
    await assertStatus('PENDING_REASSESSMENT', pool, ws, journeyId);
  });
});

describe('M6 acceptance: one engine', () => {
  test('materially different scenarios record the identical evaluator set', async () => {
    const w = await programmeWorld();
    const run = await evaluateImpact(w.pool, { workspaceId: w.seed.workspaceId, focus: [journeyRef(w.journeyUnrelated)], now: NOW, registry });
    const expected = registry.evaluators.map((e) => e.id);
    for (const a of run.assessments) {
      const recorded = a.manifest.evaluatorVersions.map((v) => v.evaluatorId).filter((id) => id !== 'm6.compose');
      assert.deepEqual(recorded, [...expected].sort());
    }
  });
});

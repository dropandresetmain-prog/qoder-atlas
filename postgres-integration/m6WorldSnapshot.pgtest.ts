/**
 * M6 P2 — WorldSnapshot read consistency, manifest completeness and
 * insertion/phantom invalidation (closes G1; DATA_STRUCTURE_LOGICAL_SCHEMA.md
 * §11.2; closure §6).
 *
 * Proves against real PostgreSQL:
 *  - the read session is one REPEATABLE READ READ ONLY snapshot: a concurrent
 *    committed write is invisible inside it, and a write through it is refused;
 *  - capture from a Journey records every read root revision, the scopes whose
 *    insertion could change the result (generation 0 when never advanced), the
 *    immutable evidence it relied on, and explicit missing coverage;
 *  - discovery follows only registered semantics: a shared service reaches both
 *    allocated travellers' Journeys and not an unrelated Journey;
 *  - currentness goes STALE, with a typed reason, on an aggregate revision
 *    change, a new participation, a new rule assignment on a visited
 *    jurisdiction, a new information edition, an unregistered topic, a new group
 *    member, and on the clock alone.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import type { Pool } from '../src/persistence/postgres/pool.ts';
import { beginSeed, commitSeed, attachSeedSession, type SeedSession } from './m2Seed.ts';
import { seedEvent, seedProgramme, seedProgrammeItem, seedParticipation } from './m4Seed.ts';
import {
  KnowledgeFixture,
  addGroupMember,
  seedBooking,
  seedCoordinationGroup,
  seedEngagementIntent,
  seedIntendedVisit,
  seedJourney,
  seedJurisdictionWithPlaces,
  seedService,
  seedTransportIntent,
  seedTraveller,
  seedTrip,
  seedUnlocatedPlace,
} from './m6WorldSeed.ts';
import { PgReadSessionFactory } from '../src/persistence/postgres/world/pgReadSession.ts';
import { PgCurrentStateReader, captureWorld } from '../src/persistence/postgres/world/pgCurrentState.ts';
import { assessManifestCurrentness } from '../src/resolution/world/currentness.ts';
import type { CapturedWorld } from '../src/resolution/world/world.ts';
import type { TypedRef } from '../src/domain/v2/shared/identity.ts';

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

const AT = '2031-03-01T00:00:00.000Z';
const TOPICS = ['ADVISORY', 'ENTRY_REQUIREMENT'] as const;

interface World {
  pool: Pool;
  seed: SeedSession;
  travellerA: string;
  travellerB: string;
  travellerC: string;
  journeyA: string;
  journeyB: string;
  journeyC: string;
  tripA: string;
  serviceId: string;
  itemA: string;
  programmeItemId: string;
  programmeId: string;
  jurisdictionId: string;
  hubPlaceId: string;
  venuePlaceId: string;
  unlocatedPlaceId: string;
  groupId: string;
  organisationId: string;
}

async function buildWorld(): Promise<World> {
  const pool = await sharedTestPool();
  const seed = await beginSeed(pool, 'M6 world snapshot fixture');
  const origin = await seedJurisdictionWithPlaces(seed, { name: 'Origin regime', places: [{ name: 'Origin terminal', placeType: 'AIRPORT' }] });
  const destination = await seedJurisdictionWithPlaces(seed, {
    name: 'Destination regime',
    places: [{ name: 'Arrival terminal', placeType: 'AIRPORT' }, { name: 'Conference venue', placeType: 'VENUE' }],
  });
  const unlocatedPlaceId = await seedUnlocatedPlace(seed, 'Unmapped side venue');
  const travellerA = (await seedTraveller(seed)).travellerId;
  const travellerB = (await seedTraveller(seed)).travellerId;
  const travellerC = (await seedTraveller(seed)).travellerId;
  const tripA = await seedTrip(seed);
  const tripB = await seedTrip(seed);
  const tripC = await seedTrip(seed);
  const journeyA = await seedJourney(seed, { tripId: tripA, travellerId: travellerA });
  const journeyB = await seedJourney(seed, { tripId: tripB, travellerId: travellerB });
  const journeyC = await seedJourney(seed, { tripId: tripC, travellerId: travellerC });

  const serviceId = await seedService(seed, {
    operator: 'Operator One', originPlaceId: origin.placeIds[0]!, destinationPlaceId: destination.placeIds[0]!,
    published: { departure: '2031-03-02T08:00:00.000Z', arrival: '2031-03-02T12:00:00.000Z', observedAt: '2031-02-01T00:00:00.000Z' },
  });
  const itemA = await seedTransportIntent(seed, { journeyId: journeyA, orderKey: '010', originPlaceId: origin.placeIds[0]!, destinationPlaceId: destination.placeIds[0]!, selectedServiceId: serviceId });
  const itemB = await seedTransportIntent(seed, { journeyId: journeyB, orderKey: '010', originPlaceId: origin.placeIds[0]!, destinationPlaceId: destination.placeIds[0]!, selectedServiceId: serviceId });
  const booking = await seedBooking(seed, { travellerId: travellerA, serviceId, journeyItemId: itemA });
  await seedBooking(seed, { travellerId: travellerB, serviceId, journeyItemId: itemB, reservationId: booking.reservationId });

  const eventId = await seedEvent(seed, { title: 'Annual meeting' });
  const programmeId = await seedProgramme(seed, { eventId });
  const { programmeItemId } = await seedProgrammeItem(seed, {
    programmeId, placeId: destination.placeIds[1]!, window: { start: '2031-03-02T15:00:00.000Z', end: '2031-03-02T16:00:00.000Z' }, lifecycleStatus: 'SCHEDULED',
  });
  const participationId = await seedParticipation(seed, { programmeItemId, travellerId: travellerA });
  await seedEngagementIntent(seed, { journeyId: journeyA, orderKey: '020', participationId });
  await seedIntendedVisit(seed, { journeyId: journeyA, jurisdictionId: destination.jurisdictionId, purpose: 'BUSINESS', start: '2031-03-02T12:00:00.000Z', end: '2031-03-05T00:00:00.000Z' });
  // A second transport intent for C that goes nowhere near the shared service.
  await seedTransportIntent(seed, { journeyId: journeyC, orderKey: '010', originPlaceId: unlocatedPlaceId, destinationPlaceId: origin.placeIds[0]! });
  const { groupId } = await seedCoordinationGroup(seed, { name: 'Delegation', journeyIds: [journeyA] });
  await commitSeed(seed);

  const knowledge = new KnowledgeFixture(pool, seed);
  const organisationId = await knowledge.organisation('Policy Owner', 'EUR');
  return {
    pool, seed, travellerA, travellerB, travellerC, journeyA, journeyB, journeyC, tripA, serviceId, itemA, programmeItemId, programmeId,
    jurisdictionId: destination.jurisdictionId, hubPlaceId: destination.placeIds[0]!, venuePlaceId: destination.placeIds[1]!, unlocatedPlaceId, groupId, organisationId,
  };
}

async function capture(w: World, focus: TypedRef[]): Promise<CapturedWorld> {
  return captureWorld(w.pool, { workspaceId: w.seed.workspaceId, focus, at: AT, informationTopics: TOPICS });
}

async function currentness(w: World, world: CapturedWorld, now = AT) {
  const state = await new PgCurrentStateReader(w.pool).loadFor(w.seed.workspaceId, world.manifest);
  return assessManifestCurrentness(world.manifest, state, now);
}

describe('M6 read session: one consistent read-only snapshot (G1)', () => {
  test('a concurrent committed write is invisible inside the session and a write through it is refused', async () => {
    const w = await buildWorld();
    const factory = new PgReadSessionFactory(w.pool);
    const observed = await factory.withReadSession(w.seed.workspaceId, async (session) => {
      assert.equal(session.info.isolation, 'REPEATABLE_READ');
      assert.ok(session.info.databaseSnapshot.length > 0);
      const [before] = await session.recordAggregates([{ kind: 'JOURNEY', id: w.journeyA }]);
      // Independent connection commits a head advance while the snapshot is open.
      await w.pool.query('UPDATE aggregate_heads SET revision = revision + 1 WHERE workspace_id = $1 AND aggregate_id = $2', [w.seed.workspaceId, w.journeyA]);
      const inside = await session.db.query<{ revision: string }>('SELECT revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2', [w.seed.workspaceId, w.journeyA]);
      await assert.rejects(
        () => session.db.query('UPDATE aggregate_heads SET revision = revision + 1 WHERE workspace_id = $1 AND aggregate_id = $2', [w.seed.workspaceId, w.journeyA]),
        /read-only transaction/i,
      );
      return { before: before?.revision, inside: Number(inside.rows[0]?.revision) };
    }).catch((error: unknown) => {
      // The refused write aborts the transaction; the session must still surface the proof values.
      throw error;
    });
    assert.equal(observed.inside, observed.before, 'the snapshot must not see a write committed after it started');
    const after = await w.pool.query<{ revision: string }>('SELECT revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2', [w.seed.workspaceId, w.journeyA]);
    assert.equal(Number(after.rows[0]?.revision), (observed.before ?? 0) + 1);
  });
});

describe('M6 world capture: manifest completeness', () => {
  test('capture from a Journey records revisions, insertion scopes, evidence and explicit missing coverage', async () => {
    const w = await buildWorld();
    const world = await capture(w, [{ kind: 'JOURNEY', id: w.journeyA }]);
    const m = world.manifest;
    assert.equal(m.capture?.isolation, 'REPEATABLE_READ');
    assert.equal(m.capture?.databaseSnapshot, world.capture.databaseSnapshot);

    const aggregateKeys = new Set(m.aggregateReads.map((r) => `${r.aggregateRef.kind}:${r.aggregateRef.id}`));
    for (const expected of [`JOURNEY:${w.journeyA}`, `TRIP:${w.tripA}`, `TRAVELLER:${w.travellerA}`, `TRANSPORT_SERVICE:${w.serviceId}`, `PROGRAMME:${w.programmeId}`, `JURISDICTION:${w.jurisdictionId}`, `PLACE:${w.venuePlaceId}`]) {
      assert.ok(aggregateKeys.has(expected), `manifest must record ${expected}`);
    }
    // A child is recorded under its root (JourneyItem -> Journey, line -> Reservation), never as its own counter.
    assert.ok(!m.aggregateReads.some((r) => r.aggregateRef.kind === 'JOURNEY_ITEM' || r.aggregateRef.kind === 'RESERVATION_LINE'));
    const heads = await w.pool.query<{ aggregate_id: string; revision: string }>('SELECT aggregate_id, revision FROM aggregate_heads WHERE workspace_id = $1', [w.seed.workspaceId]);
    const headById = new Map(heads.rows.map((r) => [r.aggregate_id, Number(r.revision)]));
    for (const read of m.aggregateReads) assert.equal(read.revision, headById.get(read.aggregateRef.id), `revision of ${read.aggregateRef.kind}`);

    const scopeKeys = new Set(m.scopeReads.map((s) => `${s.scopeKind}:${s.scopeId}`));
    for (const expected of [`JOURNEY:${w.journeyA}`, `TRIP:${w.tripA}`, `TRAVELLER:${w.travellerA}`, `PROGRAMME:${w.programmeId}`, `COORDINATION_GROUP:${w.groupId}`,
      `GEOGRAPHY:jurisdiction:${w.jurisdictionId}`, 'GEOGRAPHY:catalog', 'INFORMATION_TOPIC:ADVISORY', 'INFORMATION_TOPIC:ENTRY_REQUIREMENT', 'INFORMATION_TOPIC:*unregistered*']) {
      assert.ok(scopeKeys.has(expected), `manifest must record scope ${expected}`);
    }
    assert.ok(m.scopeReads.some((s) => s.scopeKind === 'INFORMATION_TOPIC' && s.scopeId === 'ENTRY_REQUIREMENT' && s.generation === 0), 'a never-advanced scope reads as generation 0');

    // Rows come from canonical owners.
    assert.equal(world.journeyItems.filter((i) => i.journeyId === w.journeyA).length, 2);
    assert.equal(world.transportServices[0]?.published.arrival?.value, '2031-03-02T12:00:00.000Z');
    assert.equal(world.programmeItems[0]?.window?.start, '2031-03-02T15:00:00.000Z');
    assert.ok(world.placeJurisdictions.some((pj) => pj.placeId === w.venuePlaceId && pj.jurisdictionId === w.jurisdictionId));
    assert.ok(m.evidenceReads.length > 0, 'immutable evidence relied on is recorded');
    assert.ok(m.missingCoverage.some((mc) => mc.scopeDescription.includes('knowledge coverage for topic ADVISORY')), 'absent coverage is explicit, never silent');
  });
});

describe('M6 discovery: registered semantics only', () => {
  test('a shared service reaches both allocated Journeys through typed edges and not an unrelated Journey', async () => {
    const w = await buildWorld();
    const world = await capture(w, [{ kind: 'TRANSPORT_SERVICE', id: w.serviceId }]);
    const journeyIds = new Set(world.journeys.map((j) => j.id));
    assert.ok(journeyIds.has(w.journeyA));
    assert.ok(journeyIds.has(w.journeyB), 'the other traveller on the shared service is in the blast radius');
    assert.ok(!journeyIds.has(w.journeyC), 'an unrelated Journey is not captured');
    const semantics = new Set(world.edges.map((e) => e.semantic));
    assert.ok(semantics.has('SERVICE_SUPPLIES_LINE'));
    assert.ok(semantics.has('ALLOCATION_FULFILS_ITEM'));
    assert.ok(semantics.has('ITEM_OF_JOURNEY'));
    // Deterministic: a second capture of an unchanged world yields identical edges and manifest reads.
    const again = await capture(w, [{ kind: 'TRANSPORT_SERVICE', id: w.serviceId }]);
    assert.deepEqual(again.edges, world.edges);
    assert.deepEqual(again.manifest.aggregateReads, world.manifest.aggregateReads);
    assert.deepEqual(again.manifest.scopeReads, world.manifest.scopeReads);
  });
});

describe('M6 currentness: insertion and time invalidation', () => {
  test('an unchanged world is current; each relevant change produces a typed stale reason', async () => {
    const w = await buildWorld();
    const knowledge = new KnowledgeFixture(w.pool, w.seed);

    const base = await capture(w, [{ kind: 'JOURNEY', id: w.journeyA }]);
    assert.deepEqual(await currentness(w, base), { current: true, reasons: [] });

    // 1. New participation for the traveller on a different item (phantom: no previously read row changed).
    const s1 = await attachSeedSession(w.pool, w.seed.workspaceId, w.seed.actorId);
    const { programmeItemId: otherItem } = await seedProgrammeItem(s1, { programmeId: w.programmeId, window: { start: '2031-03-03T09:00:00.000Z', end: '2031-03-03T10:00:00.000Z' }, lifecycleStatus: 'SCHEDULED' });
    await seedParticipation(s1, { programmeItemId: otherItem, travellerId: w.travellerA });
    await commitSeed(s1);
    const r1 = await currentness(w, base);
    assert.equal(r1.current, false);
    assert.ok(r1.reasons.some((r) => r.kind === 'SCOPE_ADVANCED' && r.scopeKind === 'TRAVELLER' && r.scopeId === w.travellerA), JSON.stringify(r1.reasons));

    // 2. New rule assignment on the visited jurisdiction.
    const base2 = await capture(w, [{ kind: 'JOURNEY', id: w.journeyA }]);
    const ruleSet = await knowledge.publishedRuleSet({ issuerOrganisationId: w.organisationId, policyFamily: 'entry', expression: { operator: 'PREDICATE', predicateId: 'fixture.always', parameters: {} } });
    await knowledge.assignRule({ ruleSetId: ruleSet.ruleSetId, jurisdictionId: w.jurisdictionId, validFrom: '2030-01-01T00:00:00.000Z' });
    const r2 = await currentness(w, base2);
    assert.ok(r2.reasons.some((r) => r.kind === 'SCOPE_ADVANCED' && r.scopeKind === 'GEOGRAPHY' && r.scopeId === `jurisdiction:${w.jurisdictionId}`), JSON.stringify(r2.reasons));

    // 3. New information edition on a registered topic, scoped to the jurisdiction.
    const base3 = await capture(w, [{ kind: 'JOURNEY', id: w.journeyA }]);
    await knowledge.advisory({ publisherOrganisationId: w.organisationId, topic: 'ADVISORY', severity: 'LEVEL 2', jurisdictionId: w.jurisdictionId, issuedAt: '2031-02-20T00:00:00.000Z', effective: { start: '2031-02-20T00:00:00.000Z', end: '2031-04-01T00:00:00.000Z' } });
    const r3 = await currentness(w, base3);
    assert.ok(r3.reasons.some((r) => r.kind === 'SCOPE_ADVANCED' && r.scopeKind === 'INFORMATION_TOPIC' && r.scopeId === 'ADVISORY'), JSON.stringify(r3.reasons));

    // 4. Information on a topic no evaluator is registered for still invalidates (unclassified cannot evade).
    const base4 = await capture(w, [{ kind: 'JOURNEY', id: w.journeyA }]);
    await knowledge.advisory({ publisherOrganisationId: w.organisationId, topic: `NEW_CATEGORY_${randomUUID().slice(0, 8)}`, severity: 'NOTICE', jurisdictionId: w.jurisdictionId, issuedAt: '2031-02-21T00:00:00.000Z', effective: { start: '2031-02-21T00:00:00.000Z', end: '2031-04-01T00:00:00.000Z' } });
    const r4 = await currentness(w, base4);
    assert.ok(r4.reasons.some((r) => r.kind === 'SCOPE_ADVANCED' && r.scopeKind === 'INFORMATION_TOPIC' && r.scopeId === '*unregistered*'), JSON.stringify(r4.reasons));

    // 5. New group member.
    const base5 = await capture(w, [{ kind: 'JOURNEY', id: w.journeyA }]);
    const s5 = await attachSeedSession(w.pool, w.seed.workspaceId, w.seed.actorId);
    await addGroupMember(s5, { groupId: w.groupId, journeyId: w.journeyC });
    await commitSeed(s5);
    const r5 = await currentness(w, base5);
    assert.ok(r5.reasons.some((r) => r.kind === 'SCOPE_ADVANCED' && r.scopeKind === 'COORDINATION_GROUP' && r.scopeId === w.groupId), JSON.stringify(r5.reasons));

    // 6. Aggregate revision change.
    const base6 = await capture(w, [{ kind: 'JOURNEY', id: w.journeyA }]);
    await w.pool.query('UPDATE aggregate_heads SET revision = revision + 1 WHERE workspace_id = $1 AND aggregate_id = $2', [w.seed.workspaceId, w.serviceId]);
    const r6 = await currentness(w, base6);
    assert.ok(r6.reasons.some((r) => r.kind === 'AGGREGATE_ADVANCED' && r.aggregateRef.kind === 'TRANSPORT_SERVICE' && r.aggregateRef.id === w.serviceId), JSON.stringify(r6.reasons));

    // 7. Clock-only expiry: no database change at all.
    const base7 = await capture(w, [{ kind: 'JOURNEY', id: w.journeyA }]);
    const timed = { ...base7.manifest, nextInvalidationAt: '2031-03-01T06:00:00.000Z' };
    const state = await new PgCurrentStateReader(w.pool).loadFor(w.seed.workspaceId, timed);
    assert.equal(assessManifestCurrentness(timed, state, '2031-03-01T05:59:59.000Z').current, true);
    const expired = assessManifestCurrentness(timed, state, '2031-03-01T06:00:00.000Z');
    assert.deepEqual(expired.reasons, [{ kind: 'CLOCK_EXPIRED', nextInvalidationAt: '2031-03-01T06:00:00.000Z', now: '2031-03-01T06:00:00.000Z' }]);
  });

  test('a change outside the captured scope does not stale the snapshot', async () => {
    const w = await buildWorld();
    const base = await capture(w, [{ kind: 'JOURNEY', id: w.journeyC }]);
    const s = await attachSeedSession(w.pool, w.seed.workspaceId, w.seed.actorId);
    // Traveller A gains a participation; Journey C's world does not read Traveller A.
    const { programmeItemId } = await seedProgrammeItem(s, { programmeId: w.programmeId, window: { start: '2031-03-04T09:00:00.000Z', end: '2031-03-04T10:00:00.000Z' }, lifecycleStatus: 'SCHEDULED' });
    await seedParticipation(s, { programmeItemId, travellerId: w.travellerA });
    await commitSeed(s);
    assert.deepEqual(await currentness(w, base), { current: true, reasons: [] });
  });
});

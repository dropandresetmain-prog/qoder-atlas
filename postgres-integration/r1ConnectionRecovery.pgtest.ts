/**
 * R1 second generality proof — a materially different PostgreSQL-backed situation
 * through the SAME coordinator, domain registry, evidence protocol, RC-6,
 * comparator and C4 progression as the composed programme case.
 *
 * Here there is no programme at all. A single traveller's inbound leg is delayed
 * until the onward connection is impossible (`connection_feasibility`), so the
 * registry activates TRANSPORT (and TRANSFER, which has no proposer) — never
 * PROGRAMME. Read-only flight research replays a checked-in recording; the viable
 * option is an external provider selection (SELECT_OFFER), which RC-6 judges on the
 * captured world exactly like any other candidate. Nothing in the application
 * knows this world: the corridor comes from canonical Place refs.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed } from './m2Seed.ts';
import {
  KnowledgeFixture, seedBooking, seedJourney, seedJurisdictionWithPlaces, seedService, seedTransportIntent, seedTraveller, seedTrip,
} from './m6WorldSeed.ts';
import { openDisruptionCase, worldAt, type DisruptedWorld, type OpenCase, type WorldSpec } from './r1ProgrammeWorld.ts';
import { createRecoveryPlanningCoordinator } from '../src/app/target/recoveryPlanningCoordinator.ts';
import { runRecoveryProgressionPass } from '../src/app/target/recoveryProgressionPass.ts';
import { approveRecoveryStrategy } from '../src/app/target/recoveryApproval.ts';
import { createPlanningToolTransport } from '../src/resolution/planning/replayPlanningTransport.ts';
import { FileRecordingStore } from '../src/providers/recordingStore.ts';
import { AtlasFlightAdapter } from '../src/providers/atlas/adapter.ts';
import { loadRecoveryCaseFacts } from '../src/app/target/readmodels/pgFactAssembler.ts';
import { projectRecoveryCase } from '../src/app/target/readmodels/projectRecoveryCase.ts';
import { randomUUID } from 'node:crypto';

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

const SPEC: WorldSpec = {
  day: '2026-09-05',
  now: '2026-09-04T22:00:00.000Z',
  transport: { originIata: 'MNL', destinationIata: 'CEB', timeZone: 'Asia/Manila' },
};

function replayTransport(observedAt: string) {
  const adapter = new AtlasFlightAdapter({
    mode: 'REPLAY',
    store: new FileRecordingStore({ readDirs: ['fixtures/recordings'] }),
    timezoneResolver: (code: string) => (code === 'MNL' || code === 'CEB' ? 'Asia/Manila' : undefined),
  });
  return createPlanningToolTransport({ capabilities: { flight: adapter }, observedAt });
}

/** origin --(inbound, recorded corridor)--> hub --(onward, no airport ref at the destination)--> destination */
async function seedConnectionWorld(label: string, spec: WorldSpec): Promise<DisruptedWorld> {
  const pool = await sharedTestPool();
  const seed = await beginSeed(pool, label);
  const tz = spec.transport!.timeZone;
  const at = (hhmm: string) => worldAt(spec, hhmm);
  const observedAt = new Date(Date.parse(spec.now) - 3 * 86_400_000).toISOString();
  const origin = await seedJurisdictionWithPlaces(seed, { name: 'Origin regime', places: [{ name: 'Origin', placeType: 'AIRPORT', timeZone: tz }] });
  const hub = await seedJurisdictionWithPlaces(seed, { name: 'Hub regime', places: [{ name: 'Hub', placeType: 'AIRPORT', timeZone: tz }] });
  const dest = await seedJurisdictionWithPlaces(seed, { name: 'Destination regime', places: [{ name: 'Destination', placeType: 'STATION', timeZone: tz }] });
  const [originId] = origin.placeIds as [string];
  const [hubId] = hub.placeIds as [string];
  const [destId] = dest.placeIds as [string];
  await seed.client.query(
    `INSERT INTO place_external_refs (workspace_id, id, place_id, provider_namespace, external_key, created_by_actor_id)
     VALUES ($1,$2,$3,'IATA',$4,$7), ($1,$5,$6,'IATA',$8,$7)`,
    [seed.workspaceId, randomUUID(), originId, spec.transport!.originIata, randomUUID(), hubId, seed.actorId, spec.transport!.destinationIata],
  );
  const traveller = await seedTraveller(seed, { displayName: 'Connection Traveller' });
  const tripId = await seedTrip(seed, { purpose: 'TEST', lifecycleStatus: 'ACTIVE' });
  const journeyId = await seedJourney(seed, { tripId, travellerId: traveller.travellerId, lifecycleStatus: 'ACTIVE' });
  const inboundServiceId = await seedService(seed, { mode: 'AIR', operator: 'Carrier', originPlaceId: originId, destinationPlaceId: hubId, published: { departure: at('05:00'), arrival: at('08:00'), observedAt } });
  const onwardServiceId = await seedService(seed, { mode: 'AIR', operator: 'Carrier', originPlaceId: hubId, destinationPlaceId: destId, published: { departure: at('12:00'), arrival: at('14:00'), observedAt } });
  const inboundItem = await seedTransportIntent(seed, { journeyId, orderKey: '010', originPlaceId: originId, destinationPlaceId: hubId, selectedServiceId: inboundServiceId, window: { start: at('03:00'), end: at('06:00') } });
  const onwardItem = await seedTransportIntent(seed, { journeyId, orderKey: '020', originPlaceId: hubId, destinationPlaceId: destId, selectedServiceId: onwardServiceId, window: { start: at('11:00'), end: at('13:00') } });
  await seedBooking(seed, { travellerId: traveller.travellerId, serviceId: inboundServiceId, journeyItemId: inboundItem });
  await seedBooking(seed, { travellerId: traveller.travellerId, serviceId: onwardServiceId, journeyItemId: onwardItem });
  await commitSeed(seed);
  const knowledge = new KnowledgeFixture(pool, seed);
  for (const jurisdictionId of [origin.jurisdictionId, hub.jurisdictionId, dest.jurisdictionId]) {
    for (const topic of ['ADVISORY', 'CONDITION', 'ENTRY_REQUIREMENT', 'TRANSIT_REQUIREMENT']) await knowledge.coverage({ topic, completeness: 'COMPLETE', jurisdictionId });
  }
  await knowledge.constraint({
    registeredType: 'minimum_connection_minutes', hardness: 'HARD', owner: { kind: 'PLACE', id: hubId },
    operands: [{ key: 'minutes', kind: 'NUMBER', value: 60 }],
  });
  return { spec, seed, workspaceId: seed.workspaceId, actorId: seed.actorId, people: [{ travellerId: traveller.travellerId, journeyId, tripId }], sharedServiceId: inboundServiceId };
}

describe('R1 second situation: a broken connection, no programme (real PostgreSQL)', () => {
  let c: OpenCase<DisruptedWorld>;
  after(async () => { if (c) await c.app.close(); });

  test('the same coordinator/registry/RC-6/comparator/C4 plan a different failure through a different domain', async () => {
    c = await openDisruptionCase<DisruptedWorld>('R1 connection recovery', SPEC, { seed: seedConnectionWorld, delayedArrival: worldAt(SPEC, '12:30') });
    const ws = c.world.workspaceId;
    const now = c.now;
    const planner = createRecoveryPlanningCoordinator({
      pool: c.pool, workspaceId: ws, actorPrincipalId: c.world.actorId, uow: () => c.app.unitOfWork(), now,
      transportPlanning: { transport: replayTransport(now), passengers: { adults: 1 } },
    });
    const wake = () => runRecoveryProgressionPass({ pool: c.pool, workspaceId: ws, actorPrincipalId: c.world.actorId, uow: () => c.app.unitOfWork(), planner, now });
    const view = async () => projectRecoveryCase((await loadRecoveryCaseFacts(c.pool, ws, c.caseId, now))!);
    const count = async (table: string) =>
      Number((await c.pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table} WHERE workspace_id = $1`, [ws])).rows[0]!.n);

    const first = await wake();
    assert.equal(first.planned, 1, JSON.stringify(first.outcomes));
    const v = await view();
    assert.deepEqual(v.causalPath.map((s) => s.dimension), ['connection_feasibility'], 'the failure is a broken connection');
    const pe = v.planningEvidence!;
    assert.ok(pe);

    // Different failure => different domains, from the same registry.
    const disposition = Object.fromEntries(pe.domains.map((d) => [d.domain.code, d.disposition.code]));
    assert.equal(disposition.TRANSPORT, 'INVESTIGATED');
    assert.equal(disposition.TRANSFER, 'INVESTIGATED');
    assert.equal(disposition.PROGRAMME, 'NOT_APPLICABLE');
    assert.equal(disposition.STAY, 'NOT_APPLICABLE');

    // Same read-only evidence protocol; the recorded corridor is searched, the unresolvable one is skipped, not invented.
    const searches = pe.tools.filter((t) => t.tool.code === 'flight.search');
    assert.equal(searches.length, 1, 'only the corridor with resolvable airports is researched');
    assert.equal(searches[0]!.provenanceMode.code, 'REPLAY');

    // Same RC-6 + comparator: one boardable offer restores the connection, the others do not.
    const travel = pe.candidates.filter((cand) => cand.domain.code === 'TRANSPORT');
    const recommended = travel.filter((cand) => cand.disposition.code === 'RECOMMENDED');
    const rejected = travel.filter((cand) => cand.disposition.code === 'REJECTED_DETERMINISTIC');
    assert.equal(recommended.length, 1, JSON.stringify(travel.map((t) => [t.disposition.code, t.reasons])));
    assert.ok(rejected.length >= 1, 'later offers that still miss the connection are retained as rejected evidence');
    assert.ok(rejected.every((cand) => cand.reasons.includes('Not viable')));
    assert.equal(pe.recommendation?.recommended.ref, recommended[0]!.strategyRef);
    assert.equal(pe.outcome.code, 'AWAITING_AUTHORITY');
    assert.equal(pe.viableStrategies.length, 1);
    const blast = recommended[0]!.blastRadius!;
    assert.ok(blast.changed.length >= 1 && blast.changed.every((r) => !r.ref?.startsWith('PROGRAMME_ITEM:')), `a transport selection changes travel state, not programme state: ${JSON.stringify(blast.changed)}`);
    assert.ok(recommended[0]!.outcomeDelta.some((d) => d.direction.code === 'BETTER' && d.baseline === 'FAIL' && d.candidate === 'PASS'));

    // Same C4: pending authority WAITs; duplicate wakes never replan.
    const second = await wake();
    assert.equal(second.outcomes[0]!.decision, 'WAIT');
    assert.equal(second.planned, 0);
    assert.equal(await count('recovery_planning_attempts'), 1);

    // The runtime approval path composes only internal capabilities: an external provider
    // selection is refused rather than fabricated, and nothing was dispatched.
    const refused = await approveRecoveryStrategy(
      { pool: c.pool, workspaceId: ws, actorPrincipalId: c.world.actorId, uow: () => c.app.unitOfWork(), now, executorPrincipalId: c.executorPrincipalId },
      { caseId: c.caseId, strategyId: recommended[0]!.strategyRef!, approverPrincipalId: c.operatorPrincipalId },
    );
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.match(refused.error.message, /refusing to fabricate provider capability/);
    assert.equal(await count('execution_attempts'), 0);
    assert.equal((await wake()).outcomes[0]!.decision, 'WAIT');
  });
});

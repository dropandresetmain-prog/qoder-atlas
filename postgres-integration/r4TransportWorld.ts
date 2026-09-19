/**
 * R4-F2 shared fixture (NOT a test): the R1 "broken connection" world extended
 * with what provider execution needs (organisation + budgets + structured legal
 * name), and a planned case with one recommended viable SELECT_OFFER strategy.
 * Used by r4AtlasOfferExecution.pgtest.ts (scripted provider) and
 * r4AtlasSandboxLive.pgtest.ts (opt-in real Atlas sandbox).
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import type { Pool } from '../src/persistence/postgres/pool.ts';
import { beginSeed, commitSeed } from './m2Seed.ts';
import { seedOrganisation } from './m3Seed.ts';
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
import { createBudget } from '../src/persistence/postgres/commands/arrangementCommands.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { recordTravellerBookingIdentity } from '../src/persistence/postgres/execution/providerExecutionInputs.ts';
import {
  EXTERNAL_OFFER_SELECT_STATEMENTS, type ExternalOfferExecutionDeps,
} from '../src/app/target/externalOfferExecution.ts';

export type { WorldSpec };
export { worldAt };

export const SPEC: WorldSpec = {
  day: '2026-09-05',
  now: '2026-09-04T22:00:00.000Z',
  transport: { originIata: 'MNL', destinationIata: 'CEB', timeZone: 'Asia/Manila' },
};

export interface TransportWorld extends DisruptedWorld { organisationId: string }

/** Budgets exist BEFORE planning (a budget created afterwards advances the org scope the strategy was based on). */
let seedBudgets = true;
const BUDGET_CURRENCIES = ['USD', 'PHP', 'SGD', 'MYR', 'JPY', 'VND'];

export function replayTransport(observedAt: string) {
  const adapter = new AtlasFlightAdapter({
    mode: 'REPLAY',
    store: new FileRecordingStore({ readDirs: ['fixtures/recordings'] }),
    timezoneResolver: (code: string) => (code === 'MNL' || code === 'CEB' ? 'Asia/Manila' : undefined),
  });
  return createPlanningToolTransport({ capabilities: { flight: adapter }, observedAt });
}

async function seedConnectionWorld(label: string, spec: WorldSpec): Promise<TransportWorld> {
  const pool = await sharedTestPool();
  const seed = await beginSeed(pool, label);
  const tz = spec.transport!.timeZone;
  const at = (hhmm: string) => worldAt(spec, hhmm);
  const observedAt = new Date(Date.parse(spec.now) - 3 * 86_400_000).toISOString();
  const organisationId = await seedOrganisation(seed, 'USD');
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
  // Structured legal name (the Traveller aggregate's own given/family split).
  await seed.client.query(
    `INSERT INTO traveller_names (workspace_id, id, traveller_id, name_kind, display_value, given_name, family_name, valid_from, evidence_id, created_by_actor_id)
     SELECT workspace_id, $3, traveller_id, 'LEGAL', 'Jane Connection', 'Jane', 'Connection', '2000-01-01', evidence_id, created_by_actor_id
       FROM traveller_names WHERE workspace_id = $1 AND id = $2`,
    [seed.workspaceId, traveller.displayNameId, randomUUID()],
  );
  const tripId = await seedTrip(seed, { purpose: 'TEST', lifecycleStatus: 'ACTIVE' });
  await seed.client.query('UPDATE trips SET business_context_organisation_id = $3 WHERE workspace_id = $1 AND id = $2', [seed.workspaceId, tripId, organisationId]);
  const journeyId = await seedJourney(seed, { tripId, travellerId: traveller.travellerId, lifecycleStatus: 'ACTIVE' });
  const inboundServiceId = await seedService(seed, { mode: 'AIR', operator: 'Carrier', originPlaceId: originId, destinationPlaceId: hubId, published: { departure: at('05:00'), arrival: at('08:00'), observedAt } });
  const onwardServiceId = await seedService(seed, { mode: 'AIR', operator: 'Carrier', originPlaceId: hubId, destinationPlaceId: destId, published: { departure: at('12:00'), arrival: at('14:00'), observedAt } });
  const inboundItem = await seedTransportIntent(seed, { journeyId, orderKey: '010', originPlaceId: originId, destinationPlaceId: hubId, selectedServiceId: inboundServiceId, window: { start: at('03:00'), end: at('06:00') } });
  const onwardItem = await seedTransportIntent(seed, { journeyId, orderKey: '020', originPlaceId: hubId, destinationPlaceId: destId, selectedServiceId: onwardServiceId, window: { start: at('11:00'), end: at('13:00') } });
  await seedBooking(seed, { travellerId: traveller.travellerId, serviceId: inboundServiceId, journeyItemId: inboundItem });
  await seedBooking(seed, { travellerId: traveller.travellerId, serviceId: onwardServiceId, journeyItemId: onwardItem });
  await commitSeed(seed);
  if (seedBudgets) {
    for (const currency of BUDGET_CURRENCIES) {
      const created = await createBudget(new PgUnitOfWork(pool, seed.workspaceId), {
        workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(),
        budget: { id: randomUUID(), organisationId, purpose: `travel recovery ${currency}`, amount: { amount: '100000000.00', currency } },
      });
      assert.equal(created.ok, true, JSON.stringify(created));
    }
  }
  const knowledge = new KnowledgeFixture(pool, seed);
  for (const jurisdictionId of [origin.jurisdictionId, hub.jurisdictionId, dest.jurisdictionId]) {
    for (const topic of ['ADVISORY', 'CONDITION', 'ENTRY_REQUIREMENT', 'TRANSIT_REQUIREMENT']) await knowledge.coverage({ topic, completeness: 'COMPLETE', jurisdictionId });
  }
  await knowledge.constraint({
    registeredType: 'minimum_connection_minutes', hardness: 'HARD', owner: { kind: 'PLACE', id: hubId },
    operands: [{ key: 'minutes', kind: 'NUMBER', value: 60 }],
  });
  return { spec, seed, workspaceId: seed.workspaceId, actorId: seed.actorId, people: [{ travellerId: traveller.travellerId, journeyId, tripId }], sharedServiceId: inboundServiceId, organisationId };
}


// ---------------------------------------------------------------------------
// Fixture: a planned case with a recommended viable SELECT_OFFER strategy.
// ---------------------------------------------------------------------------

export async function plannedTransportCase(label: string, options: { identity?: boolean; budget?: boolean; allowMultipleViable?: boolean; spec?: WorldSpec; transport?: (now: string) => ReturnType<typeof replayTransport>; transportPlanning?: (world: { pool: Pool; workspaceId: string; now: string }) => NonNullable<Parameters<typeof createRecoveryPlanningCoordinator>[0]['transportPlanning']> } = {}) {
  const SPEC_IN_USE = options.spec ?? SPEC;
  seedBudgets = options.budget !== false;
  const c: OpenCase<TransportWorld> = await openDisruptionCase<TransportWorld>(label, SPEC_IN_USE, { seed: seedConnectionWorld, delayedArrival: worldAt(SPEC_IN_USE, '12:30') });
  const ws = c.world.workspaceId;
  const planner = createRecoveryPlanningCoordinator({
    pool: c.pool, workspaceId: ws, actorPrincipalId: c.world.actorId, uow: () => c.app.unitOfWork(), now: c.now,
    transportPlanning: options.transportPlanning ? options.transportPlanning({ pool: c.pool, workspaceId: ws, now: c.now }) : { transport: (options.transport ?? replayTransport)(c.now), passengers: { adults: 1 } },
  });
  const wake = () => runRecoveryProgressionPass({ pool: c.pool, workspaceId: ws, actorPrincipalId: c.world.actorId, uow: () => c.app.unitOfWork(), planner, now: c.now });
  const planned = await wake();
  assert.equal(planned.planned, 1, JSON.stringify(planned.outcomes));
  const strategy = (await c.pool.query<{ id: string; scenario_change: { effects: { effectKind: string; offerPrice?: { amount: string; currency: string } }[] } }>(
    `SELECT id, scenario_change FROM recovery_strategies WHERE workspace_id = $1 AND recovery_case_id = $2 AND viability = 'VIABLE'`, [ws, c.caseId],
  )).rows;
  if (!options.allowMultipleViable) assert.equal(strategy.length, 1, 'exactly one viable transport strategy');
  assert.ok(strategy.length >= 1, 'at least one viable transport strategy');
  // With several viable options (live research) approve the cheapest: least sandbox spend, deterministic.
  const cheapest = [...strategy].sort((a, b) => Number(a.scenario_change.effects[0]!.offerPrice!.amount) - Number(b.scenario_change.effects[0]!.offerPrice!.amount) || a.id.localeCompare(b.id))[0]!;
  const strategyId = cheapest.id;
  const effect = cheapest.scenario_change.effects[0]!;
  assert.equal(effect.effectKind, 'SELECT_OFFER');
  const price = effect.offerPrice!;
  if (options.identity !== false) {
    await recordTravellerBookingIdentity(c.pool, { workspaceId: ws, actorId: c.world.actorId, travellerId: c.world.people[0]!.travellerId, gender: 'FEMALE', nationality: 'PH', contactEmail: process.env['R4_TEST_CONTACT_EMAIL'] ?? 'r4.traveller@example.com' });
  }
  const execCtx = (deps: ExternalOfferExecutionDeps) => ({
    pool: c.pool, workspaceId: ws, actorPrincipalId: c.world.actorId, uow: () => c.app.unitOfWork(), executorPrincipalId: c.executorPrincipalId, external: deps, now: c.now,
  });
  const approveNoDrain = () => approveRecoveryStrategy(
    { pool: c.pool, workspaceId: ws, actorPrincipalId: c.world.actorId, uow: () => c.app.unitOfWork(), now: c.now, executorPrincipalId: c.executorPrincipalId, externalCapabilities: EXTERNAL_OFFER_SELECT_STATEMENTS },
    { caseId: c.caseId, strategyId, approverPrincipalId: c.operatorPrincipalId },
  );
  // The budget hold invalidates the journey assessment (M6 triggers); the boot loop drains
  // reassessment before the execution gate sees CURRENT truth.
  const approve = async () => {
    const outcome = await approveNoDrain();
    if (outcome.ok) await c.drain();
    return outcome;
  };
  const count = async (sql: string, ...params: unknown[]) => Number((await c.pool.query<{ n: string }>(sql, [ws, ...params])).rows[0]!.n);
  const attempts = async () => (await c.pool.query<{ status: string; request_ref: string | null; attempt_number: number }>(
    'SELECT status, request_ref, attempt_number FROM execution_attempts WHERE workspace_id = $1 ORDER BY created_at', [ws],
  )).rows;
  const selectedService = async () => (await c.pool.query<{ selected_service_id: string }>(
    `SELECT t.selected_service_id FROM journey_items ji JOIN transport_item_details t ON t.workspace_id = ji.workspace_id AND t.journey_item_id = ji.id WHERE ji.workspace_id = $1 AND ji.journey_id = $2 ORDER BY ji.order_key`, [ws, c.world.people[0]!.journeyId],
  )).rows.map((r) => r.selected_service_id);
  return { c, ws, wake, strategyId, approve, approveNoDrain, execCtx, count, attempts, selectedService, price };
}


/**
 * Shared R1 PostgreSQL fixture: a generic seeded programme with one shared
 * inbound service, one early REQUIRED item its participant can no longer reach
 * after a delay, one later item held by a locally-arriving participant, and a
 * peer item. Drives the world through the normal runtime paths (baseline ->
 * provider-shaped change -> reassessment -> case escalation) to an OPEN
 * RecoveryCase. Contains no scenario names and no application branching.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed, type SeedSession } from './m2Seed.ts';
import { seedEvent, seedParticipation, seedProgramme, seedProgrammeItem } from './m4Seed.ts';
import {
  KnowledgeFixture, seedBooking, seedEngagementIntent, seedJourney, seedJurisdictionWithPlaces, seedService, seedTransportIntent,
  seedTraveller, seedTrip, takeSeedEvidence,
} from './m6WorldSeed.ts';
import { composeTargetApplication, type TargetApplication } from '../src/app/target/composeTargetApplication.ts';
import { acceptProviderShapedDemoEvent } from '../src/app/target/applicationCommands.ts';
import { runBaselineEvaluation } from '../src/app/demo/baselineEvaluation.ts';
import { captureWorld } from '../src/persistence/postgres/world/pgCurrentState.ts';
import { currentAssessmentView, type ReassessmentPipeline } from '../src/persistence/postgres/world/pgAssessments.ts';
import { projectEffectiveWorld } from '../src/resolution/world/effectiveItinerary.ts';
import { assessSubject } from '../src/resolution/evaluation/assess.ts';
import { createM6Registry } from '../src/resolution/evaluation/registry.ts';
import { runCaseEscalation } from '../src/app/target/caseEscalation.ts';
import { provisionWorkspaceAuthority } from '../src/app/target/workspaceAuthority.ts';
import type { Pool } from '../src/persistence/postgres/pool.ts';

export const R1_NOW = '2031-06-02T00:00:00.000Z';
export const EARLY_WINDOW = { start: '2031-06-02T11:30:00.000Z', end: '2031-06-02T12:00:00.000Z' };
export const LATE_WINDOW = { start: '2031-06-02T14:30:00.000Z', end: '2031-06-02T15:00:00.000Z' };
export const PEER_WINDOW = { start: '2031-06-02T16:00:00.000Z', end: '2031-06-02T17:00:00.000Z' };
export const BASELINE_ARRIVAL = '2031-06-02T08:00:00.000Z';
export const DELAYED_ARRIVAL = '2031-06-02T10:30:00.000Z';

export interface ProgrammeWorld {
  seed: SeedSession;
  workspaceId: string;
  actorId: string;
  people: { travellerId: string; journeyId: string; tripId: string }[];
  sharedServiceId: string;
  earlyItemId: string;
  lateItemId: string;
  peerItemId: string;
}

export interface OpenCase {
  world: ProgrammeWorld;
  app: TargetApplication;
  pool: Pool;
  caseId: string;
  changeSignalId: string;
  operatorPrincipalId: string;
  executorPrincipalId: string;
  drain: () => Promise<unknown>;
  verdict: (journeyId: string) => Promise<string | undefined>;
  lifecycleCtx: { pool: Pool; workspaceId: string; actorPrincipalId: string; uow: () => ReturnType<TargetApplication['unitOfWork']>; now: string };
}

export async function seedProgrammeWorld(label: string): Promise<ProgrammeWorld> {
  const seedPool = await sharedTestPool();
  const seed = await beginSeed(seedPool, label);
  const host = await seedJurisdictionWithPlaces(seed, { name: 'Host', places: [{ name: 'Venue', placeType: 'VENUE' }] });
  const origin = await seedJurisdictionWithPlaces(seed, { name: 'Origin', places: [{ name: 'Origin', placeType: 'STATION' }] });
  const venueId = host.placeIds[0]!;
  const originId = origin.placeIds[0]!;
  const people: ProgrammeWorld['people'] = [];
  for (let i = 0; i < 5; i += 1) {
    const t = await seedTraveller(seed, { displayName: `Participant ${i + 1}` });
    const tripId = await seedTrip(seed, { purpose: 'TEST', lifecycleStatus: 'ACTIVE' });
    const journeyId = await seedJourney(seed, { tripId, travellerId: t.travellerId, lifecycleStatus: 'ACTIVE' });
    people.push({ travellerId: t.travellerId, journeyId, tripId });
  }
  const sharedServiceId = await seedService(seed, { mode: 'AIR', operator: 'Carrier', originPlaceId: originId, destinationPlaceId: venueId, published: { departure: '2031-06-02T05:00:00.000Z', arrival: BASELINE_ARRIVAL } });
  const localServiceId = await seedService(seed, { mode: 'AIR', operator: 'Carrier', originPlaceId: originId, destinationPlaceId: venueId, published: { departure: '2031-06-02T04:00:00.000Z', arrival: '2031-06-02T07:00:00.000Z' } });
  for (const idx of [0, 2, 3, 4]) {
    const { journeyId, travellerId } = people[idx]!;
    const itemId = await seedTransportIntent(seed, { journeyId, orderKey: '010', originPlaceId: originId, destinationPlaceId: venueId, selectedServiceId: sharedServiceId });
    await seedBooking(seed, { travellerId, serviceId: sharedServiceId, journeyItemId: itemId });
  }
  {
    const { journeyId, travellerId } = people[1]!;
    const itemId = await seedTransportIntent(seed, { journeyId, orderKey: '010', originPlaceId: originId, destinationPlaceId: venueId, selectedServiceId: localServiceId });
    await seedBooking(seed, { travellerId, serviceId: localServiceId, journeyItemId: itemId });
  }
  const eventId = await seedEvent(seed, { lifecycleStatus: 'ACTIVE' });
  const programmeId = await seedProgramme(seed, { eventId, lifecycleStatus: 'ACTIVE' });
  const requirements = { requiresPhysicalPresence: true, readinessBufferMinutes: 150 };
  const earlyItem = await seedProgrammeItem(seed, { programmeId, title: 'Early required item', placeId: venueId, lifecycleStatus: 'SCHEDULED', scheduleAuthority: 'INTERNAL', window: EARLY_WINDOW, operatingRequirements: requirements });
  const lateItem = await seedProgrammeItem(seed, { programmeId, title: 'Later item', placeId: venueId, lifecycleStatus: 'SCHEDULED', scheduleAuthority: 'INTERNAL', window: LATE_WINDOW, operatingRequirements: requirements });
  const peerItem = await seedProgrammeItem(seed, { programmeId, title: 'Peer item', placeId: venueId, lifecycleStatus: 'SCHEDULED', scheduleAuthority: 'INTERNAL', window: PEER_WINDOW, operatingRequirements: requirements });
  const link = async (idx: number, itemId: string) => {
    const participationId = await seedParticipation(seed, { programmeItemId: itemId, travellerId: people[idx]!.travellerId, obligation: 'REQUIRED', accepted: true });
    await seedEngagementIntent(seed, { journeyId: people[idx]!.journeyId, orderKey: '020', participationId });
  };
  await link(0, earlyItem.programmeItemId);
  await link(1, lateItem.programmeItemId);
  for (const idx of [2, 3, 4]) await link(idx, peerItem.programmeItemId);
  await commitSeed(seed);
  const knowledge = new KnowledgeFixture(seedPool, seed);
  for (const jurisdictionId of [host.jurisdictionId, origin.jurisdictionId]) {
    for (const topic of ['ADVISORY', 'CONDITION', 'ENTRY_REQUIREMENT', 'TRANSIT_REQUIREMENT']) await knowledge.coverage({ topic, completeness: 'COMPLETE', jurisdictionId });
  }
  return {
    seed, workspaceId: seed.workspaceId, actorId: seed.actorId, people, sharedServiceId,
    earlyItemId: earlyItem.programmeItemId, lateItemId: lateItem.programmeItemId, peerItemId: peerItem.programmeItemId,
  };
}

/**
 * A provider-shaped ACTUAL-arrival change on the shared inbound service, through
 * the normal ingress command (canonical mutation + change signal). Returns the
 * change signal id. Reassessment still has to be drained by the caller.
 */
let observationTick = 0;
export async function applyProviderDelay(c: Pick<OpenCase, 'world' | 'app' | 'pool'>, arrival: string): Promise<string> {
  const { world, app, pool } = c;
  const revision = await pool.query<{ revision: string }>('SELECT revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2', [world.workspaceId, world.sharedServiceId]);
  const ingress = await acceptProviderShapedDemoEvent(
    { workspaceId: world.workspaceId, actorPrincipalId: world.actorId, uow: () => app.unitOfWork(), pool },
    { providerId: 'test-supplier', providerEventId: `evt-${randomUUID()}`, receivedAt: new Date(Date.parse('2031-06-01T23:00:00.000Z') + (observationTick++) * 60_000).toISOString(), disclosedAsSimulatedDemoInput: true,
      payload: { subjectKind: 'TRANSPORT_SERVICE', subjectId: world.sharedServiceId, expectedRevision: Number(revision.rows[0]!.revision), field: 'ACTUAL', arrival, evidenceId: takeSeedEvidence(world.seed) } },
  );
  assert.equal(ingress.ok, true, JSON.stringify(ingress));
  const changeSignalId = (ingress as { changeSignalId?: string }).changeSignalId;
  assert.ok(changeSignalId, 'ingress records a change signal');
  return changeSignalId;
}

/**
 * Seed the world, compose the application, provision authority, apply the
 * provider-shaped delay and escalate: returns an OPEN RecoveryCase whose
 * subject Journey is currently FAIL.
 */
export async function openDisruptionCase(label: string): Promise<OpenCase> {
  const world = await seedProgrammeWorld(label);
  const app = await composeTargetApplication({ workspaceId: world.workspaceId, actorId: world.actorId });
  const pool = app.pool;
  const registry = createM6Registry();
  const pipeline: ReassessmentPipeline = async (claim, assessmentId) => {
    const captured = await captureWorld(pool, { workspaceId: claim.workspaceId, focus: [claim.subject], at: R1_NOW, informationTopics: registry.informationTopics });
    return assessSubject({ registry, world: captured, effective: projectEffectiveWorld(captured), subject: claim.subject, now: R1_NOW, assessmentId }).result;
  };
  const drain = async () => {
    const result = await app.reassessmentWorker.drainAvailable(R1_NOW, pipeline, { workspaceId: world.workspaceId });
    assert.equal(result.stoppedReason, 'EMPTY', JSON.stringify(result));
    return result;
  };
  const verdict = async (journeyId: string) => {
    const view = await currentAssessmentView(pool, world.workspaceId, { kind: 'JOURNEY', id: journeyId }, 'VIABILITY', R1_NOW);
    assert.equal(view.status, 'CURRENT', `journey ${journeyId}: ${JSON.stringify(view.staleness)}`);
    return view.assessment?.overallVerdict;
  };
  const lifecycleCtx = { pool, workspaceId: world.workspaceId, actorPrincipalId: world.actorId, uow: () => app.unitOfWork(), now: R1_NOW };

  const baseline = await runBaselineEvaluation({ pool, workspaceId: world.workspaceId, actorPrincipalId: world.actorId, now: R1_NOW });
  assert.equal(baseline.evaluated, 5, JSON.stringify(baseline));
  assert.equal((await runCaseEscalation(lifecycleCtx)).opened, 0, 'healthy baseline opens nothing');

  const authority = await provisionWorkspaceAuthority({ pool, uow: () => app.unitOfWork(), workspaceId: world.workspaceId, actorPrincipalId: world.actorId, now: R1_NOW });
  assert.equal(authority.status, 'PROVISIONED', JSON.stringify(authority));
  app.runtimeHooks = { executorPrincipalId: authority.principals.executor };

  const changeSignalId = await applyProviderDelay({ world, app, pool }, DELAYED_ARRIVAL);
  await drain();
  assert.equal(await verdict(world.people[0]!.journeyId), 'FAIL');

  const escalation = await runCaseEscalation(lifecycleCtx);
  assert.equal(escalation.opened, 1, JSON.stringify(escalation));
  const caseId = escalation.outcomes.find((o) => o.caseId)!.caseId!;
  return {
    world, app, pool, caseId, changeSignalId, drain, verdict, lifecycleCtx,
    operatorPrincipalId: authority.principals.operator, executorPrincipalId: authority.principals.executor,
  };
}

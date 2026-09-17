/**
 * M6 P7 — immutable assessments, durable invalidation and reassessment.
 *
 * Proves against real PostgreSQL (0091):
 *  - a stored assessment round-trips exactly and is immutable;
 *  - currentness comes from heads/generations + injected clock, never a label;
 *  - an aggregate change and a phantom insertion enqueue durable work in the
 *    same transaction (coalesced to one open unit);
 *  - clock-only expiry enqueues work with no database change, including
 *    catch-up long after the due time;
 *  - the worker completes with supersession; a failed run is retryable then
 *    UNAVAILABLE, never silently current; a fenced worker cannot complete; a
 *    change during reassessment leaves new work behind.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import type { Pool } from '../src/persistence/postgres/pool.ts';
import { attachSeedSession, beginSeed, commitSeed, type SeedSession } from './m2Seed.ts';
import { seedEvent, seedParticipation, seedProgramme, seedProgrammeItem } from './m4Seed.ts';
import { seedJourney, seedJurisdictionWithPlaces, seedService, seedTransportIntent, seedTraveller, seedTrip } from './m6WorldSeed.ts';
import { captureWorld } from '../src/persistence/postgres/world/pgCurrentState.ts';
import {
  PgReassessmentWorker,
  currentAssessmentView,
  enqueueDueReassessments,
  loadAssessment,
  saveAssessment,
  type ReassessmentPipeline,
} from '../src/persistence/postgres/world/pgAssessments.ts';
import { projectEffectiveWorld } from '../src/resolution/world/effectiveItinerary.ts';
import { assessSubject, createEvaluatorRegistry } from '../src/resolution/evaluation/assess.ts';
import type { Evaluator } from '../src/resolution/evaluation/evaluator.ts';
import { dimension, explain } from '../src/resolution/evaluation/explain.ts';
import type { TypedRef } from '../src/domain/v2/shared/identity.ts';

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

const NOW = '2031-05-01T00:00:00.000Z';
const EXPIRES = '2031-05-01T12:00:00.000Z';

/** Generic mechanics-only evaluator: its content is irrelevant to persistence/invalidation. */
const itineraryPresence: Evaluator = {
  id: 'test.itinerary-presence', version: '1', assessmentKind: 'VIABILITY', subjectKinds: ['JOURNEY'], dimensions: ['itinerary_presence'], informationTopics: [],
  evaluate: (subject, { effective }) => {
    const journey = effective.journeys.find((j) => j.journeyRef.id === subject.id);
    return {
      dimensions: [dimension({
        dimension: 'itinerary_presence',
        explanations: [explain({ evaluatorId: 'test.itinerary-presence', dimension: 'itinerary_presence', status: journey && journey.items.length > 0 ? 'PASS' : 'UNKNOWN', reasonCode: 'items_counted', cause: { kind: 'WORLD_STATE' }, affectedSubject: subject, facts: { items: journey?.items.length ?? 0 } })],
      })],
      evidence: [], missingCoverage: [], nextInvalidationAt: EXPIRES,
    };
  },
};
const registry = createEvaluatorRegistry([itineraryPresence]);

interface Fixture { pool: Pool; seed: SeedSession; journey: TypedRef; travellerId: string; serviceId: string; programmeId: string }

async function fixture(): Promise<Fixture> {
  const pool = await sharedTestPool();
  const seed = await beginSeed(pool, 'M6 reassessment fixture');
  const geo = await seedJurisdictionWithPlaces(seed, { name: 'Regime', places: [{ name: 'A', placeType: 'STATION' }, { name: 'B', placeType: 'STATION' }] });
  const travellerId = (await seedTraveller(seed)).travellerId;
  const tripId = await seedTrip(seed);
  const journeyId = await seedJourney(seed, { tripId, travellerId });
  const serviceId = await seedService(seed, { mode: 'RAIL', operator: 'Operator', originPlaceId: geo.placeIds[0]!, destinationPlaceId: geo.placeIds[1]!, published: { departure: '2031-05-02T08:00:00.000Z', arrival: '2031-05-02T09:00:00.000Z' } });
  await seedTransportIntent(seed, { journeyId, orderKey: '010', originPlaceId: geo.placeIds[0]!, destinationPlaceId: geo.placeIds[1]!, selectedServiceId: serviceId });
  const eventId = await seedEvent(seed);
  const programmeId = await seedProgramme(seed, { eventId });
  await commitSeed(seed);
  return { pool, seed, journey: { kind: 'JOURNEY', id: journeyId }, travellerId, serviceId, programmeId };
}

const pipeline = (f: Fixture, now = NOW): ReassessmentPipeline => async (claim, assessmentId) => {
  const world = await captureWorld(f.pool, { workspaceId: claim.workspaceId, focus: [claim.subject], at: now, informationTopics: registry.informationTopics });
  return assessSubject({ registry, world, effective: projectEffectiveWorld(world), subject: claim.subject, now, assessmentId }).result;
};

async function assessNow(f: Fixture) {
  const world = await captureWorld(f.pool, { workspaceId: f.seed.workspaceId, focus: [f.journey], at: NOW, informationTopics: registry.informationTopics });
  const { result } = assessSubject({ registry, world, effective: projectEffectiveWorld(world), subject: f.journey, now: NOW, assessmentId: randomUUID() });
  await saveAssessment(f.pool, f.seed.workspaceId, result, 'principal:m6-test');
  return result;
}

async function openWork(f: Fixture) {
  return (await f.pool.query<{ reason: string; state: string; attempts: number }>(
    "SELECT reason, state, attempts FROM scheduled_reassessments WHERE workspace_id = $1 AND subject_id = $2 AND state IN ('PENDING', 'CLAIMED', 'UNAVAILABLE')",
    [f.seed.workspaceId, f.journey.id],
  )).rows;
}

describe('M6 assessments: immutable, round-trippable, current only by evidence', () => {
  test('store, reload exactly, refuse mutation, and report CURRENT only while the manifest holds', async () => {
    const f = await fixture();
    const result = await assessNow(f);
    const loaded = await loadAssessment(f.pool, f.seed.workspaceId, result.id);
    assert.deepEqual(loaded, result, 'the stored assessment reloads as the same contract value');
    await assert.rejects(() => f.pool.query('UPDATE assessments SET overall_verdict = $1 WHERE workspace_id = $2 AND id = $3', ['FAIL', f.seed.workspaceId, result.id]), /append-only|immutable|not permitted/i);
    const view = await currentAssessmentView(f.pool, f.seed.workspaceId, f.journey, 'VIABILITY', NOW);
    assert.equal(view.status, 'CURRENT');
    assert.equal(view.assessment?.id, result.id);
  });
});

describe('M6 invalidation: durable work in the changing transaction', () => {
  test('an aggregate change enqueues work; further changes coalesce into one open unit', async () => {
    const f = await fixture();
    await assessNow(f);
    assert.deepEqual(await openWork(f), []);
    await f.pool.query('UPDATE aggregate_heads SET revision = revision + 1 WHERE workspace_id = $1 AND aggregate_id = $2', [f.seed.workspaceId, f.serviceId]);
    assert.deepEqual(await openWork(f), [{ reason: 'INPUT_CHANGED', state: 'PENDING', attempts: 0 }]);
    await f.pool.query('UPDATE aggregate_heads SET revision = revision + 1 WHERE workspace_id = $1 AND aggregate_id = $2', [f.seed.workspaceId, f.serviceId]);
    assert.equal((await openWork(f)).length, 1);
    const view = await currentAssessmentView(f.pool, f.seed.workspaceId, f.journey, 'VIABILITY', NOW);
    assert.equal(view.status, 'PENDING_REASSESSMENT');
    assert.ok(view.staleness.some((r) => r.kind === 'AGGREGATE_ADVANCED'));
  });

  test('a phantom insertion (new participation, no read row changed) enqueues work; a rolled-back change enqueues none', async () => {
    const f = await fixture();
    await assessNow(f);
    const rolledBack = await attachSeedSession(f.pool, f.seed.workspaceId, f.seed.actorId);
    const { programmeItemId: ghost } = await seedProgrammeItem(rolledBack, { programmeId: f.programmeId });
    await seedParticipation(rolledBack, { programmeItemId: ghost, travellerId: f.travellerId });
    await rolledBack.client.query('ROLLBACK');
    rolledBack.client.release();
    assert.deepEqual(await openWork(f), [], 'a rolled-back change leaves no work');

    const s = await attachSeedSession(f.pool, f.seed.workspaceId, f.seed.actorId);
    const { programmeItemId } = await seedProgrammeItem(s, { programmeId: f.programmeId, window: { start: '2031-05-02T12:00:00.000Z', end: '2031-05-02T13:00:00.000Z' }, lifecycleStatus: 'SCHEDULED' });
    await seedParticipation(s, { programmeItemId, travellerId: f.travellerId });
    await commitSeed(s);
    assert.deepEqual(await openWork(f), [{ reason: 'INPUT_CHANGED', state: 'PENDING', attempts: 0 }]);
  });

  test('work raised against a superseded assessment is obsolete once a newer capture verifies current; a later change still pends', async () => {
    const f = await fixture();
    const first = await assessNow(f);
    await f.pool.query('UPDATE aggregate_heads SET revision = revision + 1 WHERE workspace_id = $1 AND aggregate_id = $2', [f.seed.workspaceId, f.serviceId]);
    assert.equal((await currentAssessmentView(f.pool, f.seed.workspaceId, f.journey, 'VIABILITY', NOW)).status, 'PENDING_REASSESSMENT');
    const second = await assessNow(f);
    assert.notEqual(second.id, first.id);
    const view = await currentAssessmentView(f.pool, f.seed.workspaceId, f.journey, 'VIABILITY', NOW);
    assert.equal(view.status, 'CURRENT', JSON.stringify(view.staleness));
    assert.equal(view.openWork, undefined, 'obsolete work is not reported against the newer result');
    await f.pool.query('UPDATE aggregate_heads SET revision = revision + 1 WHERE workspace_id = $1 AND aggregate_id = $2', [f.seed.workspaceId, f.serviceId]);
    assert.notEqual((await currentAssessmentView(f.pool, f.seed.workspaceId, f.journey, 'VIABILITY', NOW)).status, 'CURRENT', 'a change after the newer capture is never current');
  });
  test('clock-only expiry enqueues work without any database change, and catches up after downtime', async () => {
    const f = await fixture();
    await assessNow(f);
    assert.equal((await currentAssessmentView(f.pool, f.seed.workspaceId, f.journey, 'VIABILITY', '2031-05-01T11:59:59.000Z')).status, 'CURRENT');
    const expiredView = await currentAssessmentView(f.pool, f.seed.workspaceId, f.journey, 'VIABILITY', EXPIRES);
    assert.equal(expiredView.status, 'STALE', 'past nextInvalidationAt the stored result is stale even before a worker runs');
    assert.deepEqual(expiredView.staleness.map((r) => r.kind), ['CLOCK_EXPIRED']);
    // Downtime: the scheduler runs long after the due time and still finds it.
    await enqueueDueReassessments(f.pool, '2031-06-30T00:00:00.000Z');
    assert.deepEqual(await openWork(f), [{ reason: 'CLOCK_EXPIRY', state: 'PENDING', attempts: 0 }]);
  });
});

describe('M6 reassessment worker', () => {
  test('completes with supersession and the new result is CURRENT', async () => {
    const f = await fixture();
    const first = await assessNow(f);
    await f.pool.query('UPDATE aggregate_heads SET revision = revision + 1 WHERE workspace_id = $1 AND aggregate_id = $2', [f.seed.workspaceId, f.serviceId]);
    const worker = new PgReassessmentWorker(f.pool, { actorId: 'principal:m6-worker' });
    const outcome = await worker.runOnce(NOW, pipeline(f), f.seed.workspaceId);
    assert.equal(outcome.result, 'COMPLETED');
    const successor = await f.pool.query<{ supersedes_assessment_id: string }>('SELECT supersedes_assessment_id FROM assessments WHERE workspace_id = $1 AND id = $2', [f.seed.workspaceId, outcome.assessmentId]);
    assert.equal(successor.rows[0]?.supersedes_assessment_id, first.id);
    const view = await currentAssessmentView(f.pool, f.seed.workspaceId, f.journey, 'VIABILITY', NOW);
    assert.equal(view.status, 'CURRENT');
    assert.equal(view.assessment?.id, outcome.assessmentId);
  });

  test('a failing reassessment is retryable, then UNAVAILABLE — never silently current', async () => {
    const f = await fixture();
    await assessNow(f);
    await f.pool.query('UPDATE aggregate_heads SET revision = revision + 1 WHERE workspace_id = $1 AND aggregate_id = $2', [f.seed.workspaceId, f.serviceId]);
    const worker = new PgReassessmentWorker(f.pool, { actorId: 'principal:m6-worker', maxAttempts: 2 });
    const broken: ReassessmentPipeline = async () => { throw new Error('source reader unavailable'); };
    assert.equal((await worker.runOnce(NOW, broken, f.seed.workspaceId)).result, 'RETRY_SCHEDULED');
    const retrying = await currentAssessmentView(f.pool, f.seed.workspaceId, f.journey, 'VIABILITY', NOW);
    assert.equal(retrying.status, 'PENDING_REASSESSMENT');
    assert.equal(retrying.openWork?.lastError, 'source reader unavailable');
    assert.equal((await worker.runOnce(NOW, broken, f.seed.workspaceId)).claimed, false, 'backoff: not runnable yet');
    assert.equal((await worker.runOnce('2031-05-01T02:00:00.000Z', broken, f.seed.workspaceId)).result, 'UNAVAILABLE');
    const unavailable = await currentAssessmentView(f.pool, f.seed.workspaceId, f.journey, 'VIABILITY', NOW);
    assert.equal(unavailable.status, 'UNAVAILABLE');
    assert.ok(unavailable.staleness.length > 0, 'the old result is still reported as stale, not current');
  });

  test('an expired lease is reclaimed with a new fencing token and the stale worker cannot complete', async () => {
    const f = await fixture();
    await assessNow(f);
    await f.pool.query('UPDATE aggregate_heads SET revision = revision + 1 WHERE workspace_id = $1 AND aggregate_id = $2', [f.seed.workspaceId, f.serviceId]);
    const slow = new PgReassessmentWorker(f.pool, { actorId: 'principal:slow', leaseSeconds: 60 });
    const fast = new PgReassessmentWorker(f.pool, { actorId: 'principal:fast', leaseSeconds: 60 });
    const staleClaim = await slow.claim(NOW, f.seed.workspaceId);
    assert.ok(staleClaim);
    const later = '2031-05-01T00:05:00.000Z';
    const freshClaim = await fast.claim(later, f.seed.workspaceId);
    assert.ok(freshClaim);
    assert.ok(freshClaim.fencingToken > staleClaim.fencingToken);
    const staleResult = await pipeline(f)(staleClaim, randomUUID());
    assert.equal(await slow.complete(staleClaim, staleResult), 'FENCED');
    assert.equal(await fast.complete(freshClaim, await pipeline(f, later)(freshClaim, randomUUID())), 'COMPLETED');
  });

  test('a change committed while the pipeline runs leaves new durable work behind', async () => {
    const f = await fixture();
    await assessNow(f);
    await f.pool.query('UPDATE aggregate_heads SET revision = revision + 1 WHERE workspace_id = $1 AND aggregate_id = $2', [f.seed.workspaceId, f.serviceId]);
    const worker = new PgReassessmentWorker(f.pool, { actorId: 'principal:m6-worker' });
    const racing: ReassessmentPipeline = async (claim, assessmentId) => {
      const result = await pipeline(f)(claim, assessmentId);
      await f.pool.query('UPDATE aggregate_heads SET revision = revision + 1 WHERE workspace_id = $1 AND aggregate_id = $2', [f.seed.workspaceId, f.serviceId]);
      return result;
    };
    assert.equal((await worker.runOnce(NOW, racing, f.seed.workspaceId)).result, 'COMPLETED');
    assert.deepEqual(await openWork(f), [{ reason: 'INPUT_CHANGED', state: 'PENDING', attempts: 0 }]);
    assert.equal((await currentAssessmentView(f.pool, f.seed.workspaceId, f.journey, 'VIABILITY', NOW)).status, 'PENDING_REASSESSMENT');
  });
});

async function pendingCount(pool: Pool, workspaceId: string): Promise<number> {
  const result = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM scheduled_reassessments WHERE workspace_id = $1 AND state IN ('PENDING', 'CLAIMED')`,
    [workspaceId],
  );
  return Number(result.rows[0]!.n);
}

describe('M6 reassessment worker drain', () => {
  async function manyJourneys(count: number): Promise<{
    pool: Pool;
    workspaceId: string;
    journeys: TypedRef[];
    serviceId: string;
  }> {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'M6 drain fixture');
    const geo = await seedJurisdictionWithPlaces(seed, { name: 'Regime', places: [{ name: 'A', placeType: 'STATION' }, { name: 'B', placeType: 'STATION' }] });
    const tripId = await seedTrip(seed);
    const serviceId = await seedService(seed, { mode: 'RAIL', operator: 'Operator', originPlaceId: geo.placeIds[0]!, destinationPlaceId: geo.placeIds[1]!, published: { departure: '2031-05-02T08:00:00.000Z', arrival: '2031-05-02T09:00:00.000Z' } });
    const journeys: TypedRef[] = [];
    for (let i = 0; i < count; i += 1) {
      const travellerId = (await seedTraveller(seed)).travellerId;
      const journeyId = await seedJourney(seed, { tripId, travellerId });
      await seedTransportIntent(seed, { journeyId, orderKey: '010', originPlaceId: geo.placeIds[0]!, destinationPlaceId: geo.placeIds[1]!, selectedServiceId: serviceId });
      journeys.push({ kind: 'JOURNEY', id: journeyId });
    }
    await commitSeed(seed);
    for (const journey of journeys) {
      const world = await captureWorld(pool, { workspaceId: seed.workspaceId, focus: [journey], at: NOW, informationTopics: registry.informationTopics });
      const { result } = assessSubject({ registry, world, effective: projectEffectiveWorld(world), subject: journey, now: NOW, assessmentId: randomUUID() });
      await saveAssessment(pool, seed.workspaceId, result, 'principal:m6-drain');
    }
    await pool.query('UPDATE aggregate_heads SET revision = revision + 1 WHERE workspace_id = $1 AND aggregate_id = $2', [seed.workspaceId, serviceId]);
    return { pool, workspaceId: seed.workspaceId, journeys, serviceId };
  }

  const drainPipeline = (pool: Pool): ReassessmentPipeline => async (claim, assessmentId) => {
    const world = await captureWorld(pool, { workspaceId: claim.workspaceId, focus: [claim.subject], at: NOW, informationTopics: registry.informationTopics });
    return assessSubject({ registry, world, effective: projectEffectiveWorld(world), subject: claim.subject, now: NOW, assessmentId }).result;
  };

  test('drains every runnable item in one wake without sleeping between claims', async () => {
    const f = await manyJourneys(8);
    assert.equal(await pendingCount(f.pool, f.workspaceId), 8);
    const worker = new PgReassessmentWorker(f.pool, { actorId: 'principal:m6-drain' });
    const started = Date.now();
    const drain = await worker.drainAvailable(NOW, drainPipeline(f.pool), { workspaceId: f.workspaceId, concurrency: 1 });
    const elapsed = Date.now() - started;
    assert.equal(drain.stoppedReason, 'EMPTY');
    assert.equal(drain.processed, 8);
    assert.equal(drain.outcomes.COMPLETED, 8);
    assert.equal(await pendingCount(f.pool, f.workspaceId), 0);
    assert.ok(elapsed < 8_000, `continuous drain must not pay the 2s idle cadence per item; elapsed=${elapsed}ms`);
  });

  test('claims a concurrent batch in one wake and still drains to empty', async () => {
    const f = await manyJourneys(8);
    const worker = new PgReassessmentWorker(f.pool, { actorId: 'principal:m6-drain-batch' });
    const drain = await worker.drainAvailable(NOW, drainPipeline(f.pool), { workspaceId: f.workspaceId, concurrency: 4 });
    assert.equal(drain.stoppedReason, 'EMPTY');
    assert.ok(drain.processed >= 8, `processed ${drain.processed} claims for 8 subjects`);
    assert.equal(await pendingCount(f.pool, f.workspaceId), 0);
    for (const journey of f.journeys) {
      assert.equal((await currentAssessmentView(f.pool, f.workspaceId, journey, 'VIABILITY', NOW)).status, 'CURRENT');
    }
  });

  test('stops at maxItems while leaving remaining work pending', async () => {
    const f = await manyJourneys(6);
    const worker = new PgReassessmentWorker(f.pool, { actorId: 'principal:m6-drain-budget' });
    const drain = await worker.drainAvailable(NOW, drainPipeline(f.pool), { workspaceId: f.workspaceId, concurrency: 2, maxItems: 3 });
    assert.equal(drain.stoppedReason, 'MAX_ITEMS');
    assert.equal(drain.processed, 3);
    assert.equal(await pendingCount(f.pool, f.workspaceId), 3);
  });

  test('stops at maxMs rather than spinning', async () => {
    const f = await manyJourneys(4);
    const worker = new PgReassessmentWorker(f.pool, { actorId: 'principal:m6-drain-time' });
    const slow: ReassessmentPipeline = async (claim, assessmentId) => {
      await new Promise((resolve) => setTimeout(resolve, 120));
      return drainPipeline(f.pool)(claim, assessmentId);
    };
    const drain = await worker.drainAvailable(NOW, slow, { workspaceId: f.workspaceId, concurrency: 1, maxMs: 50 });
    assert.equal(drain.stoppedReason, 'MAX_MS');
    assert.equal(drain.processed, 1);
    assert.ok((await pendingCount(f.pool, f.workspaceId)) >= 3);
  });

  test('one failed assessment does not drop remaining runnable work', async () => {
    const f = await manyJourneys(5);
    const worker = new PgReassessmentWorker(f.pool, { actorId: 'principal:m6-drain-fail', maxAttempts: 3 });
    let failed = 0;
    const mixed: ReassessmentPipeline = async (claim, assessmentId) => {
      if (failed === 0) {
        failed += 1;
        throw new Error('source reader unavailable');
      }
      return drainPipeline(f.pool)(claim, assessmentId);
    };
    const drain = await worker.drainAvailable(NOW, mixed, { workspaceId: f.workspaceId, concurrency: 1 });
    assert.equal(drain.stoppedReason, 'EMPTY');
    assert.equal(drain.processed, 5);
    assert.equal(drain.outcomes.RETRY_SCHEDULED, 1);
    assert.equal(drain.outcomes.COMPLETED, 4);
    assert.equal(await pendingCount(f.pool, f.workspaceId), 1, 'the failed unit remains pending with backoff; the rest completed');
  });

  test('an empty queue returns EMPTY and claims nothing', async () => {
    const f = await fixture();
    await assessNow(f);
    const worker = new PgReassessmentWorker(f.pool, { actorId: 'principal:m6-drain-empty' });
    const drain = await worker.drainAvailable(NOW, pipeline(f), { workspaceId: f.seed.workspaceId });
    assert.equal(drain.processed, 0);
    assert.equal(drain.stoppedReason, 'EMPTY');
    assert.deepEqual(drain.outcomes, {});
  });
});

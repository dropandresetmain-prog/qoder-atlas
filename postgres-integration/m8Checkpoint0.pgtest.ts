/**
 * Checkpoint 0 PostgreSQL proofs:
 * 1. Authority/dispatch re-checks currentAssessmentView at decision time
 *    (CURRENT → approve path open → world change → PENDING → dispatch refused).
 * 2. PgReassessmentWorker.complete() bounded retry then durable requeue on
 *    serialization / unique conflict — no wait for lease expiry; fencing kept;
 *    no duplicate successful assessment.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import type { Pool } from '../src/persistence/postgres/pool.ts';
import { beginSeed, commitSeed, type SeedSession } from './m2Seed.ts';
import { seedJourney, seedJurisdictionWithPlaces, seedService, seedTransportIntent, seedTraveller, seedTrip } from './m6WorldSeed.ts';
import { captureWorld } from '../src/persistence/postgres/world/pgCurrentState.ts';
import {
  PgReassessmentWorker,
  currentAssessmentView,
  saveAssessment,
  type ReassessmentClaim,
  type ReassessmentPipeline,
} from '../src/persistence/postgres/world/pgAssessments.ts';
import { projectEffectiveWorld } from '../src/resolution/world/effectiveItinerary.ts';
import { assessSubject, createEvaluatorRegistry } from '../src/resolution/evaluation/assess.ts';
import type { Evaluator } from '../src/resolution/evaluation/evaluator.ts';
import { dimension, explain } from '../src/resolution/evaluation/explain.ts';
import type { TypedRef } from '../src/domain/v2/shared/identity.ts';
import { evaluateAuthorityDecisionGates } from '../src/resolution/authority/index.ts';
import type { AssessmentResult } from '../src/contracts/v2/assessment/assessmentManifest.ts';

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

const NOW = '2031-06-01T00:00:00.000Z';
const LATER = '2031-06-01T01:00:00.000Z';

const itineraryPresence: Evaluator = {
  id: 'test.itinerary-presence', version: '1', assessmentKind: 'VIABILITY', subjectKinds: ['JOURNEY'], dimensions: ['itinerary_presence'], informationTopics: [],
  evaluate: (subject, { effective }) => ({
    dimensions: [dimension({
      dimension: 'itinerary_presence',
      explanations: [explain({
        evaluatorId: 'test.itinerary-presence', dimension: 'itinerary_presence',
        status: effective.journeys.some((j) => j.journeyRef.id === subject.id) ? 'PASS' : 'UNKNOWN',
        reasonCode: 'items_counted', cause: { kind: 'WORLD_STATE' }, affectedSubject: subject, facts: {},
      })],
    })],
    evidence: [], missingCoverage: [],
  }),
};
const registry = createEvaluatorRegistry([itineraryPresence]);

interface Fixture { pool: Pool; seed: SeedSession; journey: TypedRef; serviceId: string }

async function fixture(): Promise<Fixture> {
  const pool = await sharedTestPool();
  const seed = await beginSeed(pool, 'M8 checkpoint0');
  const geo = await seedJurisdictionWithPlaces(seed, { name: 'Regime', places: [{ name: 'A', placeType: 'STATION' }, { name: 'B', placeType: 'STATION' }] });
  const travellerId = (await seedTraveller(seed)).travellerId;
  const tripId = await seedTrip(seed);
  const journeyId = await seedJourney(seed, { tripId, travellerId });
  const serviceId = await seedService(seed, {
    mode: 'RAIL', operator: 'Operator',
    originPlaceId: geo.placeIds[0]!, destinationPlaceId: geo.placeIds[1]!,
    published: { departure: '2031-06-02T08:00:00.000Z', arrival: '2031-06-02T09:00:00.000Z' },
  });
  await seedTransportIntent(seed, {
    journeyId, orderKey: '010',
    originPlaceId: geo.placeIds[0]!, destinationPlaceId: geo.placeIds[1]!,
    selectedServiceId: serviceId,
  });
  await commitSeed(seed);
  return { pool, seed, journey: { kind: 'JOURNEY', id: journeyId }, serviceId };
}

async function assessNow(f: Fixture, now = NOW): Promise<AssessmentResult> {
  const world = await captureWorld(f.pool, {
    workspaceId: f.seed.workspaceId, focus: [f.journey], at: now, informationTopics: registry.informationTopics,
  });
  const { result } = assessSubject({
    registry, world, effective: projectEffectiveWorld(world), subject: f.journey, now, assessmentId: randomUUID(),
  });
  await saveAssessment(f.pool, f.seed.workspaceId, result, 'principal:c0');
  return result;
}

const pipeline = (f: Fixture, now = NOW): ReassessmentPipeline => async (claim, assessmentId) => {
  const world = await captureWorld(f.pool, {
    workspaceId: claim.workspaceId, focus: [claim.subject], at: now, informationTopics: registry.informationTopics,
  });
  return assessSubject({
    registry, world, effective: projectEffectiveWorld(world), subject: claim.subject, now, assessmentId,
  }).result;
};

describe('Checkpoint 0: decision-time currentAssessmentView gate', () => {
  test('assessment current → gate open → world change → pending → dispatch refused', async () => {
    const f = await fixture();
    await assessNow(f);

    const current = await currentAssessmentView(f.pool, f.seed.workspaceId, f.journey, 'VIABILITY', NOW);
    assert.equal(current.status, 'CURRENT');
    const approved = evaluateAuthorityDecisionGates(current);
    assert.equal(approved.allowed, true, 'approval may proceed while assessment is current');

    await f.pool.query(
      'UPDATE aggregate_heads SET revision = revision + 1 WHERE workspace_id = $1 AND aggregate_id = $2',
      [f.seed.workspaceId, f.serviceId],
    );

    const after = await currentAssessmentView(f.pool, f.seed.workspaceId, f.journey, 'VIABILITY', LATER);
    assert.equal(after.status, 'PENDING_REASSESSMENT');
    const dispatch = evaluateAuthorityDecisionGates(after);
    assert.equal(dispatch.allowed, false, 'dispatch must refuse once assessment is not current');
    if (!dispatch.allowed) assert.equal(dispatch.reason, 'ASSESSMENT_NOT_CURRENT');
  });
});

describe('Checkpoint 0: PgReassessmentWorker.complete retry / durable requeue', () => {
  test('forced serialization on complete requeues without lease wait and preserves fencing', async () => {
    const f = await fixture();
    await assessNow(f);
    await f.pool.query(
      'UPDATE aggregate_heads SET revision = revision + 1 WHERE workspace_id = $1 AND aggregate_id = $2',
      [f.seed.workspaceId, f.serviceId],
    );

    const worker = new PgReassessmentWorker(f.pool, { actorId: 'principal:c0-worker', maxCompleteRetries: 2 });
    const claim = await worker.claim(NOW, f.seed.workspaceId);
    assert.ok(claim);
    const fencingBefore = claim!.fencingToken;
    const result = await pipeline(f, LATER)(claim!, randomUUID());

    type CompleteOnce = (c: ReassessmentClaim, r: AssessmentResult) => Promise<'COMPLETED' | 'FENCED'>;
    const original = (worker as unknown as { completeOnce: CompleteOnce }).completeOnce.bind(worker);
    let forced = 0;
    (worker as unknown as { completeOnce: CompleteOnce }).completeOnce = async (c, r) => {
      forced += 1;
      if (forced <= 2) {
        const err = new Error('forced serialization') as Error & { code: string };
        err.code = '40001';
        throw err;
      }
      return original(c, r);
    };

    const outcome = await worker.complete(claim!, result);
    assert.equal(outcome, 'REQUEUED');
    assert.equal(forced, 2, 'bounded in-process retries exhausted before requeue');

    const row = await f.pool.query<{ state: string; claim_token: string | null; fencing_token: string; last_error: string | null }>(
      'SELECT state, claim_token, fencing_token, last_error FROM scheduled_reassessments WHERE id = $1',
      [claim!.id],
    );
    assert.equal(row.rows[0]?.state, 'PENDING');
    assert.equal(row.rows[0]?.claim_token, null);
    assert.equal(Number(row.rows[0]?.fencing_token), fencingBefore, 'fencing token preserved across requeue');
    assert.match(row.rows[0]?.last_error ?? '', /complete_requeue:40001/);

    const worker2 = new PgReassessmentWorker(f.pool, { actorId: 'principal:c0-worker-2' });
    const reclaim = await worker2.claim(LATER, f.seed.workspaceId);
    assert.ok(reclaim);
    assert.ok(reclaim!.fencingToken > fencingBefore);
    const secondResult = await pipeline(f, LATER)(reclaim!, randomUUID());
    assert.equal(await worker2.complete(reclaim!, secondResult), 'COMPLETED');

    const assessments = await f.pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM assessments
        WHERE workspace_id = $1 AND subject_kind = $2 AND subject_id = $3 AND kind = 'VIABILITY'`,
      [f.seed.workspaceId, f.journey.kind, f.journey.id],
    );
    assert.equal(assessments.rows[0]?.n, '2');
  });

  test('forced unique-violation on complete requeues cleanly', async () => {
    const f = await fixture();
    await assessNow(f);
    await f.pool.query(
      'UPDATE aggregate_heads SET revision = revision + 1 WHERE workspace_id = $1 AND aggregate_id = $2',
      [f.seed.workspaceId, f.serviceId],
    );

    const worker = new PgReassessmentWorker(f.pool, { actorId: 'principal:c0-unique', maxCompleteRetries: 1 });
    const claim = await worker.claim(NOW, f.seed.workspaceId);
    assert.ok(claim);
    const result = await pipeline(f, LATER)(claim!, randomUUID());
    (worker as unknown as { completeOnce: () => Promise<never> }).completeOnce = async () => {
      const err = new Error('duplicate key value violates unique constraint') as Error & { code: string };
      err.code = '23505';
      throw err;
    };
    assert.equal(await worker.complete(claim!, result), 'REQUEUED');
    const state = await f.pool.query<{ state: string }>('SELECT state FROM scheduled_reassessments WHERE id = $1', [claim!.id]);
    assert.equal(state.rows[0]?.state, 'PENDING');
  });
});

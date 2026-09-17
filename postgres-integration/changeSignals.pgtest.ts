/**
 * ChangeSignal commands (R0, migration 0124) — recordChangeSignal /
 * completeChangeSignal and consequence provenance.
 *
 * Proves against real PostgreSQL:
 *  (a) recordChangeSignal is idempotent BY ORIGIN (workspace, origin_kind,
 *      origin_key), not merely by idempotency key: a replay with a
 *      different idempotency key and a different requested changeSignalId
 *      still resolves to the ALREADY-registered signal when the origin and
 *      content hash match; the same origin key with a DIFFERENT content
 *      hash is a DUPLICATE_REGISTRATION conflict.
 *  (b) completeChangeSignal is idempotent (a second completion is a safe
 *      no-op, never a second row), and both `change_signals` and
 *      `change_signal_completions` are append-only — UPDATE/DELETE reject.
 *  (c) Consequence provenance: a command executed through
 *      `PgUnitOfWork.underChangeSignal(id)` tags its `change_records` row
 *      AND the `scheduled_reassessments` row the 0091/0124 trigger enqueues
 *      for a subject whose stored assessment read the changed aggregate
 *      with that signal id; the identical command through a plain
 *      `PgUnitOfWork` leaves both columns NULL.
 *
 * This is generic command-and-trigger mechanics, not the T2 disruption
 * scenario — origin kind/key, change type and subjects here are arbitrary
 * test fixtures (AGENTS.md anti-hardcoding: no scenario name/id baked in).
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool } from '../src/persistence/postgres/pool.ts';
import { sharedTestPool, freshWorkspaceId } from './harness.ts';
import { beginSeed, commitSeed, takeSeedEvidence, type SeedSession } from './m2Seed.ts';
import { seedJourney, seedJurisdictionWithPlaces, seedService, seedTransportIntent, seedTraveller, seedTrip } from './m6WorldSeed.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { recordChangeSignal, completeChangeSignal, loadChangeSignal } from '../src/persistence/postgres/commands/changeSignalCommands.ts';
import { recordTransportObservation } from '../src/persistence/postgres/commands/arrangementCommands.ts';
import { captureWorld } from '../src/persistence/postgres/world/pgCurrentState.ts';
import { saveAssessment } from '../src/persistence/postgres/world/pgAssessments.ts';
import { projectEffectiveWorld } from '../src/resolution/world/effectiveItinerary.ts';
import { assessSubject, createEvaluatorRegistry } from '../src/resolution/evaluation/assess.ts';
import type { Evaluator } from '../src/resolution/evaluation/evaluator.ts';
import { dimension, explain } from '../src/resolution/evaluation/explain.ts';
import type { TypedRef } from '../src/domain/v2/shared/identity.ts';

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

const ACTOR = 'principal:change-signals-test';
const NOW = '2031-05-01T00:00:00.000Z';
const EXPIRES = '2031-05-01T12:00:00.000Z';

async function freshWorkspace(pool: Pool, label: string): Promise<string> {
  const workspaceId = freshWorkspaceId();
  await pool.query('INSERT INTO workspaces (id, name) VALUES ($1, $2)', [workspaceId, `change-signals:${label}:${workspaceId}`]);
  return workspaceId;
}

// ---------------------------------------------------------------------------
// (a) recordChangeSignal is idempotent by origin.
// ---------------------------------------------------------------------------
describe('recordChangeSignal — idempotent by origin identity', () => {
  test('same origin + same content hash replays to the originally-registered signal; same origin + different hash is DUPLICATE_REGISTRATION', async () => {
    const pool = await sharedTestPool();
    const workspaceId = await freshWorkspace(pool, 'origin-idempotency');
    const originKey = `TEST_ORIGIN_KEY:${randomUUID()}`;
    const firstSignalId = randomUUID();

    const first = await recordChangeSignal(new PgUnitOfWork(pool, workspaceId), {
      workspaceId,
      actorPrincipalId: ACTOR,
      idempotencyKey: `cs-test:${originKey}:register-1`,
      changeSignalId: firstSignalId,
      originKind: 'TEST_ORIGIN',
      originKey,
      changeType: 'TEST_CHANGE',
      contentHash: 'content-hash-a',
      receivedAt: NOW,
    });
    assert.equal(first.ok, true, first.ok ? '' : JSON.stringify(first.conflict));
    if (!first.ok) return;
    assert.equal(first.value.changeSignalId, firstSignalId);

    // Replay: a DIFFERENT idempotency key AND a DIFFERENT requested
    // changeSignalId, but the SAME origin identity and SAME content hash.
    // recordChangeSignal is idempotent by ORIGIN (workspace, origin_kind,
    // origin_key) checked inside the command body, not only by the outer
    // idempotency-key ledger — so this must resolve to the
    // already-registered signal, never mint (or return) a second one.
    const secondRequestedId = randomUUID();
    const replay = await recordChangeSignal(new PgUnitOfWork(pool, workspaceId), {
      workspaceId,
      actorPrincipalId: ACTOR,
      idempotencyKey: `cs-test:${originKey}:register-2`,
      changeSignalId: secondRequestedId,
      originKind: 'TEST_ORIGIN',
      originKey,
      changeType: 'TEST_CHANGE',
      contentHash: 'content-hash-a',
      receivedAt: NOW,
    });
    assert.equal(replay.ok, true, replay.ok ? '' : JSON.stringify(replay.conflict));
    if (!replay.ok) return;
    assert.equal(
      replay.value.changeSignalId, firstSignalId,
      'replay resolves to the originally-registered signal id, not the newly-requested one',
    );

    const rows = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM change_signals WHERE workspace_id = $1 AND origin_kind = $2 AND origin_key = $3`,
      [workspaceId, 'TEST_ORIGIN', originKey],
    );
    assert.equal(Number(rows.rows[0]!.n), 1, 'exactly one change_signals row for this origin identity');

    // Same origin key, a DIFFERENT content hash → DUPLICATE_REGISTRATION.
    const mismatch = await recordChangeSignal(new PgUnitOfWork(pool, workspaceId), {
      workspaceId,
      actorPrincipalId: ACTOR,
      idempotencyKey: `cs-test:${originKey}:register-3`,
      changeSignalId: randomUUID(),
      originKind: 'TEST_ORIGIN',
      originKey,
      changeType: 'TEST_CHANGE',
      contentHash: 'content-hash-b',
      receivedAt: NOW,
    });
    assert.equal(mismatch.ok, false, 'different substance under the same origin identity must be rejected');
    if (mismatch.ok) return;
    assert.equal(mismatch.conflict.kind, 'DUPLICATE_REGISTRATION', `got: ${JSON.stringify(mismatch.conflict)}`);

    const rowsAfterMismatch = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM change_signals WHERE workspace_id = $1 AND origin_kind = $2 AND origin_key = $3`,
      [workspaceId, 'TEST_ORIGIN', originKey],
    );
    assert.equal(Number(rowsAfterMismatch.rows[0]!.n), 1, 'the rejected mismatch writes nothing new');
  });
});

// ---------------------------------------------------------------------------
// (b) completeChangeSignal is idempotent; both tables are append-only.
// ---------------------------------------------------------------------------
describe('completeChangeSignal — idempotent completion; append-only rows', () => {
  test('a second completion is a safe no-op; change_signals and change_signal_completions reject UPDATE and DELETE', async () => {
    const pool = await sharedTestPool();
    const workspaceId = await freshWorkspace(pool, 'completion-immutability');
    const originKey = `TEST_ORIGIN_KEY:${randomUUID()}`;
    const changeSignalId = randomUUID();

    const registered = await recordChangeSignal(new PgUnitOfWork(pool, workspaceId), {
      workspaceId,
      actorPrincipalId: ACTOR,
      idempotencyKey: `cs-test:${originKey}:register`,
      changeSignalId,
      originKind: 'TEST_ORIGIN',
      originKey,
      changeType: 'TEST_CHANGE',
      contentHash: 'content-hash-c',
      receivedAt: NOW,
    });
    assert.equal(registered.ok, true, registered.ok ? '' : JSON.stringify(registered.conflict));

    const completedFirst = await completeChangeSignal(new PgUnitOfWork(pool, workspaceId), {
      workspaceId,
      actorPrincipalId: ACTOR,
      idempotencyKey: `cs-test:${originKey}:complete-1`,
      changeSignalId,
      completedAt: NOW,
    });
    assert.equal(completedFirst.ok, true, completedFirst.ok ? '' : JSON.stringify(completedFirst.conflict));

    const completedSecond = await completeChangeSignal(new PgUnitOfWork(pool, workspaceId), {
      workspaceId,
      actorPrincipalId: ACTOR,
      idempotencyKey: `cs-test:${originKey}:complete-2`,
      changeSignalId,
      completedAt: NOW,
    });
    assert.equal(completedSecond.ok, true, 'a second completion (different idempotency key, same signal) is a safe no-op');

    const completions = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM change_signal_completions WHERE workspace_id = $1 AND change_signal_id = $2`,
      [workspaceId, changeSignalId],
    );
    assert.equal(Number(completions.rows[0]!.n), 1, 'exactly one completion row exists, not two');

    const loaded = await loadChangeSignal(pool, workspaceId, changeSignalId);
    assert.ok(loaded, 'the signal loads');
    assert.ok(loaded!.completedAt, 'the loaded signal reports completed');

    await assert.rejects(
      () => pool.query(`UPDATE change_signals SET change_type = 'OTHER_CHANGE' WHERE workspace_id = $1 AND id = $2`, [workspaceId, changeSignalId]),
      /append-only|immutable|not permitted/i,
      'change_signals row must reject UPDATE',
    );
    await assert.rejects(
      () => pool.query(`DELETE FROM change_signals WHERE workspace_id = $1 AND id = $2`, [workspaceId, changeSignalId]),
      /append-only|immutable|not permitted/i,
      'change_signals row must reject DELETE',
    );
    await assert.rejects(
      () => pool.query(`UPDATE change_signal_completions SET outcome = 'APPLIED' WHERE workspace_id = $1 AND change_signal_id = $2`, [workspaceId, changeSignalId]),
      /append-only|immutable|not permitted/i,
      'change_signal_completions row must reject UPDATE',
    );
    await assert.rejects(
      () => pool.query(`DELETE FROM change_signal_completions WHERE workspace_id = $1 AND change_signal_id = $2`, [workspaceId, changeSignalId]),
      /append-only|immutable|not permitted/i,
      'change_signal_completions row must reject DELETE',
    );
  });
});

// ---------------------------------------------------------------------------
// (c) Consequence provenance: change_records + scheduled_reassessments carry
// the signal id when a command runs under underChangeSignal(id); a plain
// uow leaves both NULL. Mirrors m6Reassessment.pgtest.ts's fixture/pipeline
// (a mechanics-only evaluator; the JOURNEY's stored assessment reads the
// selected TRANSPORT_SERVICE's revision, so bumping that revision is what
// enqueues the reassessment).
// ---------------------------------------------------------------------------
const itineraryPresence: Evaluator = {
  id: 'test.change-signal-provenance', version: '1', assessmentKind: 'VIABILITY', subjectKinds: ['JOURNEY'], dimensions: ['itinerary_presence'], informationTopics: [],
  evaluate: (subject, { effective }) => {
    const journey = effective.journeys.find((j) => j.journeyRef.id === subject.id);
    return {
      dimensions: [dimension({
        dimension: 'itinerary_presence',
        explanations: [explain({ evaluatorId: 'test.change-signal-provenance', dimension: 'itinerary_presence', status: journey && journey.items.length > 0 ? 'PASS' : 'UNKNOWN', reasonCode: 'items_counted', cause: { kind: 'WORLD_STATE' }, affectedSubject: subject, facts: { items: journey?.items.length ?? 0 } })],
      })],
      evidence: [], missingCoverage: [], nextInvalidationAt: EXPIRES,
    };
  },
};
const registry = createEvaluatorRegistry([itineraryPresence]);

interface ProvenanceFixture { pool: Pool; seed: SeedSession; journey: TypedRef; serviceId: string }

async function provenanceFixture(label: string): Promise<ProvenanceFixture> {
  const pool = await sharedTestPool();
  const seed = await beginSeed(pool, `ChangeSignal provenance fixture ${label}`);
  const geo = await seedJurisdictionWithPlaces(seed, { name: 'Regime', places: [{ name: 'A', placeType: 'STATION' }, { name: 'B', placeType: 'STATION' }] });
  const travellerId = (await seedTraveller(seed)).travellerId;
  const tripId = await seedTrip(seed);
  const journeyId = await seedJourney(seed, { tripId, travellerId });
  const serviceId = await seedService(seed, {
    mode: 'RAIL', operator: 'Operator', originPlaceId: geo.placeIds[0]!, destinationPlaceId: geo.placeIds[1]!,
    published: { departure: '2031-05-02T08:00:00.000Z', arrival: '2031-05-02T09:00:00.000Z' },
  });
  await seedTransportIntent(seed, { journeyId, orderKey: '010', originPlaceId: geo.placeIds[0]!, destinationPlaceId: geo.placeIds[1]!, selectedServiceId: serviceId });
  await commitSeed(seed);
  return { pool, seed, journey: { kind: 'JOURNEY', id: journeyId }, serviceId };
}

async function assessNow(f: ProvenanceFixture): Promise<void> {
  const world = await captureWorld(f.pool, { workspaceId: f.seed.workspaceId, focus: [f.journey], at: NOW, informationTopics: registry.informationTopics });
  const { result } = assessSubject({ registry, world, effective: projectEffectiveWorld(world), subject: f.journey, now: NOW, assessmentId: randomUUID() });
  await saveAssessment(f.pool, f.seed.workspaceId, result, ACTOR);
}

async function currentServiceRevision(pool: Pool, workspaceId: string, serviceId: string): Promise<number> {
  const row = await pool.query<{ revision: string }>(
    'SELECT revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2',
    [workspaceId, serviceId],
  );
  return Number(row.rows[0]!.revision);
}

describe('ChangeSignal consequence provenance — change_records + scheduled_reassessments tagging', () => {
  test('a command run through underChangeSignal(id) tags change_records and the enqueued reassessment with that id', async () => {
    const f = await provenanceFixture('signalled');
    await assessNow(f);

    const originKey = `TEST_ORIGIN_KEY:${randomUUID()}`;
    const changeSignalId = randomUUID();
    const signalReg = await recordChangeSignal(new PgUnitOfWork(f.pool, f.seed.workspaceId), {
      workspaceId: f.seed.workspaceId,
      actorPrincipalId: ACTOR,
      idempotencyKey: `cs-test:${originKey}:register`,
      changeSignalId,
      originKind: 'TEST_ORIGIN',
      originKey,
      changeType: 'TEST_CHANGE',
      contentHash: 'content-hash-signalled',
      receivedAt: NOW,
    });
    assert.equal(signalReg.ok, true, signalReg.ok ? '' : JSON.stringify(signalReg.conflict));

    const evidenceId = takeSeedEvidence(f.seed);
    const observeIdempotencyKey = `cs-test:${originKey}:observe`;
    const expectedRevision = await currentServiceRevision(f.pool, f.seed.workspaceId, f.serviceId);
    const signalUow = new PgUnitOfWork(f.pool, f.seed.workspaceId).underChangeSignal(changeSignalId);
    const outcome = await recordTransportObservation(signalUow, {
      workspaceId: f.seed.workspaceId,
      actorPrincipalId: ACTOR,
      idempotencyKey: observeIdempotencyKey,
      serviceId: f.serviceId,
      expectedRevision,
      observation: { field: 'ACTUAL', arrival: '2031-05-02T10:15:00.000Z', observedAt: NOW, evidenceId },
      evidenceRefs: [evidenceId],
    });
    assert.equal(outcome.ok, true, outcome.ok ? '' : JSON.stringify(outcome.conflict));
    if (!outcome.ok) return;
    assert.equal(outcome.value.status, 'APPLIED', 'the observation actually advanced the aggregate');

    const changeRecordRows = await f.pool.query<{ change_signal_id: string | null }>(
      `SELECT change_signal_id FROM change_records WHERE workspace_id = $1 AND idempotency_key = $2`,
      [f.seed.workspaceId, observeIdempotencyKey],
    );
    assert.equal(changeRecordRows.rowCount, 1, 'exactly one change_records row for this command');
    assert.equal(changeRecordRows.rows[0]!.change_signal_id, changeSignalId, 'change_records.change_signal_id carries the signal id');

    const reassessmentRows = await f.pool.query<{ change_signal_id: string | null }>(
      `SELECT change_signal_id FROM scheduled_reassessments
        WHERE workspace_id = $1 AND subject_kind = 'JOURNEY' AND subject_id = $2 AND state IN ('PENDING', 'CLAIMED')`,
      [f.seed.workspaceId, f.journey.id],
    );
    assert.equal(reassessmentRows.rowCount, 1, 'exactly one open reassessment for the journey');
    assert.equal(reassessmentRows.rows[0]!.change_signal_id, changeSignalId, 'scheduled_reassessments.change_signal_id carries the signal id');
  });

  test('the identical command run through a plain uow (no signal) leaves both columns NULL', async () => {
    const f = await provenanceFixture('unsignalled');
    await assessNow(f);

    const evidenceId = takeSeedEvidence(f.seed);
    const observeIdempotencyKey = `plain-uow-test:${randomUUID()}`;
    const expectedRevision = await currentServiceRevision(f.pool, f.seed.workspaceId, f.serviceId);
    const outcome = await recordTransportObservation(new PgUnitOfWork(f.pool, f.seed.workspaceId), {
      workspaceId: f.seed.workspaceId,
      actorPrincipalId: ACTOR,
      idempotencyKey: observeIdempotencyKey,
      serviceId: f.serviceId,
      expectedRevision,
      observation: { field: 'ACTUAL', arrival: '2031-05-02T10:15:00.000Z', observedAt: NOW, evidenceId },
      evidenceRefs: [evidenceId],
    });
    assert.equal(outcome.ok, true, outcome.ok ? '' : JSON.stringify(outcome.conflict));
    if (!outcome.ok) return;
    assert.equal(outcome.value.status, 'APPLIED', 'the observation actually advanced the aggregate');

    const changeRecordRows = await f.pool.query<{ change_signal_id: string | null }>(
      `SELECT change_signal_id FROM change_records WHERE workspace_id = $1 AND idempotency_key = $2`,
      [f.seed.workspaceId, observeIdempotencyKey],
    );
    assert.equal(changeRecordRows.rowCount, 1, 'exactly one change_records row for this command');
    assert.equal(changeRecordRows.rows[0]!.change_signal_id, null, 'a plain uow leaves change_records.change_signal_id NULL');

    const reassessmentRows = await f.pool.query<{ change_signal_id: string | null }>(
      `SELECT change_signal_id FROM scheduled_reassessments
        WHERE workspace_id = $1 AND subject_kind = 'JOURNEY' AND subject_id = $2 AND state IN ('PENDING', 'CLAIMED')`,
      [f.seed.workspaceId, f.journey.id],
    );
    assert.equal(reassessmentRows.rowCount, 1, 'exactly one open reassessment for the journey');
    assert.equal(reassessmentRows.rows[0]!.change_signal_id, null, 'a plain uow leaves scheduled_reassessments.change_signal_id NULL');
  });
});

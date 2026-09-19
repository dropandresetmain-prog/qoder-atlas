/**
 * N1 — reusing an existing replacement TransportService row requires it to
 * match the CURRENT event's original (cancelled) service on corridor (origin,
 * destination, mode), the event's stated operator, and the event's stated
 * replacement schedule (a null stored published time never matches).
 *
 * Before this fix, `canonicalReplacementServiceId` could resolve to an
 * existing transport_services row (via external identity, or via the
 * schedule-derived mint which uses wildcard origin/destination — see the doc
 * comment on that function) with NOTHING checking that the row actually
 * belongs to the same corridor/schedule as the event being processed. Step 5
 * would then silently reuse a replacement service created by an unrelated
 * event, and travellers from a completely different corridor would be
 * reprotected onto it.
 *
 * Proven against real PostgreSQL in two fresh workspaces (one per test):
 *
 *   1. Corridor mismatch: event A reprotections ID7159 (CGK->SIN, air) onto a
 *      new replacement service ID7153. Event B then reprotections TR883
 *      (HND->SIN, air — a REAL, different-corridor fixture service; only the
 *      origin differs) onto the SAME replacement external identity ID7153,
 *      stating the SAME schedule as event A. VALIDATION_FAILED, zero
 *      mutation anywhere, TR883's own reservation lines untouched.
 *
 *   2. Same corridor, one workspace, sequential rejections: event A
 *      reprotections a 3-traveller subset of ID7159's cohort
 *      (IDSYN03/10/11) onto ID7153, leaving IDSYN14 and IDSYN30 CONFIRMED.
 *      Each later event targets the SAME real original ID7159 and the SAME
 *      replacement external identity ID7153, differing in exactly one way:
 *        C (IDSYN14): a different scheduledArrival than the stored row;
 *        D (IDSYN30): a different operator than the stored row;
 *        E (IDSYN30): correct operator/schedule, but the stored row's
 *          published_arrival has been nulled via SQL (test setup).
 *      Each → VALIDATION_FAILED, table counts unchanged, and ID7159's
 *      reservation lines byte-for-byte unchanged (the targeted booking's line
 *      is resolved by its PNR and asserted still CONFIRMED).
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Pool } from '../src/persistence/postgres/pool.ts';
import { sharedTestPool } from './harness.ts';
import { loadDataset, type LoadedDataset } from '../src/app/demo/datasetLoader.ts';
import { resolveSourceSubjects, SOURCE_RECORD_TYPES } from '../src/app/demo/externalIdentity.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import {
  acceptProviderDisruptionDemoEvent,
  type TransportServiceCancelledWithReprotectionEvent,
} from '../src/app/target/providerDisruptionIngress.ts';
import type { TargetCommandContext } from '../src/app/target/applicationCommands.ts';
import { aitWorldModeFromEnv, obtainAitSummitWorld } from './aitFixtureClone.ts';

const BUNDLE_DIR = fileURLToPath(new URL('../fixtures/programmes/ait-summit-2026/', import.meta.url));
const ACTOR = 'principal:t2-n1-corridor-guard-test';

const ORIGINAL_EXTERNAL_ID = 'ID7159@2026-09-30T10:45:00.000Z';
const REPLACEMENT_EXTERNAL_ID = 'ID7153@2026-10-01T00:45:00.000Z';
const REPLACEMENT_DEPARTURE = '2026-10-01T07:45:00+07:00';
const REPLACEMENT_ARRIVAL = '2026-10-01T10:30:00+08:00';
const OTHER_CORRIDOR_ORIGINAL_EXTERNAL_ID = 'TR883@2026-09-28T17:20:00.000Z';

const COUNTED_TABLES = [
  'transport_services',
  'reservations',
  'reservation_lines',
  'reservation_allocations',
  'external_records',
  'change_signals',
  'change_signal_completions',
  'command_receipts',
] as const;

let pool: Pool;
let dataset: LoadedDataset | undefined;
let sharedPool: Pool | undefined;
let disposeWorld: (() => Promise<void>) | undefined;

interface LineSnapshot {
  id: string;
  observed_status: string;
  observed_status_at: string | null;
  observation_evidence_id: string | null;
}

async function freshWorkspace(label: string): Promise<{ workspaceId: string; connectionId: string }> {
  // Each scenario gets its own pristine clone / fresh world (never reuse mutated).
  await disposeWorld?.().catch(() => undefined);
  disposeWorld = undefined;
  const t0 = performance.now();
  const world = await obtainAitSummitWorld({
    actorPrincipalId: ACTOR,
    includeBaseline: true,
    sharedPool,
    dataset,
  });
  disposeWorld = world.dispose;
  pool = world.pool;
  assert.ok(
    world.provisionStatus === 'MATERIALIZED' || world.provisionStatus === 'CLONED',
    `world ready via ${world.provisionStatus}`,
  );
  assert.ok((world.baselineEvaluated ?? 0) > 0, 'baseline evaluation assessed at least one journey');
  console.log(`[timing] N1 ${label} setup mode=${world.mode} setupMs=${(performance.now() - t0).toFixed(0)}`);
  return { workspaceId: world.workspaceId, connectionId: world.connectionId };
}

function ctxFor(workspaceId: string): TargetCommandContext {
  return {
    workspaceId,
    actorPrincipalId: ACTOR,
    uow: () => new PgUnitOfWork(pool, workspaceId),
    pool,
  };
}

async function tableCounts(workspaceId: string): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const table of COUNTED_TABLES) {
    const rows = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table} WHERE workspace_id = $1`, [workspaceId]);
    result[table] = Number(rows.rows[0]!.n);
  }
  return result;
}

async function linesForService(workspaceId: string, serviceId: string): Promise<LineSnapshot[]> {
  const rows = await pool.query<LineSnapshot>(
    `SELECT l.id, l.observed_status, l.observed_status_at::text AS observed_status_at, l.observation_evidence_id
       FROM reservation_lines l
       JOIN transport_line_details t ON t.workspace_id = l.workspace_id AND t.line_id = l.id
      WHERE l.workspace_id = $1 AND t.transport_service_id = $2
      ORDER BY l.id`,
    [workspaceId, serviceId],
  );
  return rows.rows;
}

/** The single reservation line on `serviceId` held by booking reference `pnr`. */
async function lineForBooking(workspaceId: string, serviceId: string, pnr: string): Promise<LineSnapshot> {
  const rows = await pool.query<LineSnapshot>(
    `SELECT DISTINCT l.id, l.observed_status, l.observed_status_at::text AS observed_status_at, l.observation_evidence_id
       FROM reservation_lines l
       JOIN transport_line_details t ON t.workspace_id = l.workspace_id AND t.line_id = l.id
       JOIN reservations res ON res.workspace_id = l.workspace_id AND res.id = l.reservation_id
       JOIN external_record_links rl ON rl.workspace_id = res.workspace_id AND rl.canonical_subject_id = res.id AND rl.superseded_at IS NULL
       JOIN external_records r ON r.workspace_id = rl.workspace_id AND r.id = rl.external_record_id
        AND r.record_type = 'SOURCE_BOOKING_REFERENCE'
      WHERE l.workspace_id = $1 AND t.transport_service_id = $2 AND r.external_id = $3`,
    [workspaceId, serviceId, pnr],
  );
  assert.equal(rows.rowCount, 1, `exactly one line on the service for booking ${pnr}`);
  return rows.rows[0]!;
}

describe('N1 — replacement service reuse requires matching corridor, operator and schedule', () => {
  before(async () => {
    if (aitWorldModeFromEnv() === 'fresh') {
      sharedPool = await sharedTestPool();
      pool = sharedPool;
      dataset = await loadDataset(BUNDLE_DIR);
    }
  });

  after(async () => {
    await disposeWorld?.().catch(() => undefined);
    await sharedPool?.end().catch(() => undefined);
  });

  test('different-corridor original service cannot reuse an existing replacement → VALIDATION_FAILED, zero mutation', async () => {
    const { workspaceId, connectionId } = await freshWorkspace('corridor');
    const ctx = ctxFor(workspaceId);
    const mapping = await resolveSourceSubjects(pool, workspaceId, connectionId);

    const original = mapping.get(`${SOURCE_RECORD_TYPES.TRANSPORT_SERVICE}:${ORIGINAL_EXTERNAL_ID}`);
    assert.ok(original, 'original service ID7159 resolves');

    // -- Event A: real disruption, creates the replacement service ID7153.
    const eventA: TransportServiceCancelledWithReprotectionEvent = {
      kind: 'TRANSPORT_SERVICE_CANCELLED_WITH_REPROTECTION',
      providerId: 'sim-airline-id',
      providerEventId: `sim-id-evt-n1-corridor-a-${randomUUID()}`,
      receivedAt: '2026-09-21T01:40:00.000Z',
      disclosedAsSimulatedDemoInput: true,
      originalService: { recordType: 'SOURCE_TRANSPORT_SERVICE', externalId: ORIGINAL_EXTERNAL_ID },
      replacementService: {
        recordType: 'SOURCE_TRANSPORT_SERVICE',
        externalId: REPLACEMENT_EXTERNAL_ID,
        operator: 'ID',
        scheduledDeparture: REPLACEMENT_DEPARTURE,
        scheduledArrival: REPLACEMENT_ARRIVAL,
      },
      affectedBookings: ['IDSYN03', 'IDSYN10', 'IDSYN11', 'IDSYN14', 'IDSYN30'].map((pnr) => ({
        recordType: 'SOURCE_BOOKING_REFERENCE' as const,
        externalId: pnr,
      })),
      reason: 'N1 corridor-guard scenario, event A (the real disruption).',
      provenanceKind: 'SCHEDULE_CHANGE',
    };

    const appliedA = await acceptProviderDisruptionDemoEvent(ctx, eventA);
    assert.equal(appliedA.ok, true, `event A applied: ${appliedA.ok ? '' : JSON.stringify(appliedA.error)}`);
    if (!appliedA.ok) return;
    assert.equal(appliedA.status, 'APPLIED', 'event A status APPLIED');

    // -- Resolve the DIFFERENT-corridor original service (TR883, HND->SIN —
    // only the origin differs from ID7159's CGK->SIN) and its real booked
    // travellers.
    const otherOriginal = mapping.get(`${SOURCE_RECORD_TYPES.TRANSPORT_SERVICE}:${OTHER_CORRIDOR_ORIGINAL_EXTERNAL_ID}`);
    assert.ok(otherOriginal, `different-corridor original service ${OTHER_CORRIDOR_ORIGINAL_EXTERNAL_ID} resolves`);

    const bookingRefs = await pool.query<{ external_id: string }>(
      `SELECT DISTINCT r.external_id
         FROM reservation_lines l
         JOIN transport_line_details t ON t.workspace_id = l.workspace_id AND t.line_id = l.id
         JOIN reservation_allocations a ON a.workspace_id = l.workspace_id AND a.line_id = l.id
         JOIN reservations res ON res.workspace_id = l.workspace_id AND res.id = l.reservation_id
         JOIN external_records r ON r.workspace_id = l.workspace_id AND r.record_type = 'SOURCE_BOOKING_REFERENCE'
         JOIN external_record_links rl ON rl.workspace_id = r.workspace_id AND rl.external_record_id = r.id AND rl.superseded_at IS NULL
           AND rl.canonical_subject_id = res.id
        WHERE l.workspace_id = $1 AND t.transport_service_id = $2 AND l.observed_status = 'CONFIRMED'`,
      [workspaceId, otherOriginal.subject.id],
    );
    assert.ok(bookingRefs.rowCount! > 0, 'at least one booked booking reference on the different-corridor original service');

    // Verify the corridors really do differ before trusting the guard's
    // rejection to mean anything — origin/destination on the canonical rows,
    // not just the external ids.
    const corridorCheck = await pool.query<{ id: string; origin_place_id: string; destination_place_id: string }>(
      `SELECT id, origin_place_id, destination_place_id FROM transport_services WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
      [workspaceId, [original!.subject.id, otherOriginal.subject.id]],
    );
    const byId = new Map(corridorCheck.rows.map((r) => [r.id, r]));
    const originalRow = byId.get(original!.subject.id)!;
    const otherRow = byId.get(otherOriginal.subject.id)!;
    assert.notEqual(otherRow.origin_place_id, originalRow.origin_place_id, 'TR883 and ID7159 really do have different origins');
    assert.equal(otherRow.destination_place_id, originalRow.destination_place_id, 'both land at SIN — only origin differs');

    // -- Snapshot BEFORE event B: table counts + TR883's own reservation lines.
    const countsBefore = await tableCounts(workspaceId);
    const tr883LinesBefore = await linesForService(workspaceId, otherOriginal.subject.id);

    // -- Event B: a DIFFERENT-corridor original service (TR883) reprotecting
    // onto the SAME replacement external identity (ID7153), with the SAME
    // stated schedule as event A — isolating the corridor mismatch as the
    // only difference.
    const eventB: TransportServiceCancelledWithReprotectionEvent = {
      kind: 'TRANSPORT_SERVICE_CANCELLED_WITH_REPROTECTION',
      providerId: 'sim-airline-id',
      providerEventId: `sim-id-evt-n1-corridor-b-${randomUUID()}`,
      receivedAt: '2026-09-21T02:10:00.000Z',
      disclosedAsSimulatedDemoInput: true,
      originalService: { recordType: 'SOURCE_TRANSPORT_SERVICE', externalId: OTHER_CORRIDOR_ORIGINAL_EXTERNAL_ID },
      replacementService: {
        recordType: 'SOURCE_TRANSPORT_SERVICE',
        externalId: REPLACEMENT_EXTERNAL_ID,
        operator: 'ID',
        scheduledDeparture: REPLACEMENT_DEPARTURE,
        scheduledArrival: REPLACEMENT_ARRIVAL,
      },
      affectedBookings: bookingRefs.rows.map((r) => ({
        recordType: 'SOURCE_BOOKING_REFERENCE' as const,
        externalId: r.external_id,
      })),
      reason: 'N1 corridor-guard scenario, event B (wrong corridor, must be rejected).',
      provenanceKind: 'SCHEDULE_CHANGE',
    };

    const resultB = await acceptProviderDisruptionDemoEvent(ctx, eventB);
    assert.equal(resultB.ok, false, `event B (different corridor) must be rejected, got: ${JSON.stringify(resultB)}`);
    if (resultB.ok) return;
    assert.equal(resultB.error.code, 'VALIDATION_FAILED', `error code is VALIDATION_FAILED, got ${resultB.error.code}: ${resultB.error.message}`);

    // -- Zero mutation: table counts unchanged.
    const countsAfter = await tableCounts(workspaceId);
    assert.deepEqual(countsAfter, countsBefore, 'no table mutated by the rejected event B');

    // -- TR883's own reservation lines are byte-for-byte unchanged.
    const tr883LinesAfter = await linesForService(workspaceId, otherOriginal.subject.id);
    assert.deepEqual(tr883LinesAfter, tr883LinesBefore, "TR883's original reservation lines are unchanged");
  });

  test('mismatched replacement schedule, operator, or a null stored published time on the same corridor cannot reuse an existing replacement → VALIDATION_FAILED, zero mutation', async () => {
    const { workspaceId, connectionId } = await freshWorkspace('schedule');
    const ctx = ctxFor(workspaceId);
    const mapping = await resolveSourceSubjects(pool, workspaceId, connectionId);

    const original = mapping.get(`${SOURCE_RECORD_TYPES.TRANSPORT_SERVICE}:${ORIGINAL_EXTERNAL_ID}`);
    assert.ok(original, 'original service ID7159 resolves');

    // -- Event A: reprotections a 3-traveller SUBSET of ID7159's cohort,
    // leaving IDSYN14 (event C) and IDSYN30 (events D, E) CONFIRMED.
    const eventA: TransportServiceCancelledWithReprotectionEvent = {
      kind: 'TRANSPORT_SERVICE_CANCELLED_WITH_REPROTECTION',
      providerId: 'sim-airline-id',
      providerEventId: `sim-id-evt-n1-schedule-a-${randomUUID()}`,
      receivedAt: '2026-09-21T01:40:00.000Z',
      disclosedAsSimulatedDemoInput: true,
      originalService: { recordType: 'SOURCE_TRANSPORT_SERVICE', externalId: ORIGINAL_EXTERNAL_ID },
      replacementService: {
        recordType: 'SOURCE_TRANSPORT_SERVICE',
        externalId: REPLACEMENT_EXTERNAL_ID,
        operator: 'ID',
        scheduledDeparture: REPLACEMENT_DEPARTURE,
        scheduledArrival: REPLACEMENT_ARRIVAL,
      },
      affectedBookings: ['IDSYN03', 'IDSYN10', 'IDSYN11'].map((pnr) => ({
        recordType: 'SOURCE_BOOKING_REFERENCE' as const,
        externalId: pnr,
      })),
      reason: 'N1 schedule-guard scenario, event A (the real disruption, partial cohort).',
      provenanceKind: 'SCHEDULE_CHANGE',
    };

    const appliedA = await acceptProviderDisruptionDemoEvent(ctx, eventA);
    assert.equal(appliedA.ok, true, `event A applied: ${appliedA.ok ? '' : JSON.stringify(appliedA.error)}`);
    if (!appliedA.ok) return;
    assert.equal(appliedA.status, 'APPLIED', 'event A status APPLIED');

    // -- Snapshot BEFORE event C: table counts + IDSYN14's own line (still CONFIRMED).
    const countsBefore = await tableCounts(workspaceId);
    const originalLinesBefore = await linesForService(workspaceId, original!.subject.id);
    const idsyn14Before = await lineForBooking(workspaceId, original!.subject.id, 'IDSYN14');
    assert.equal(idsyn14Before.observed_status, 'CONFIRMED', 'IDSYN14 line is still CONFIRMED before event C');

    // -- Event C: SAME corridor (same real original service ID7159, by
    // construction), SAME replacement external identity ID7153, but a
    // DIFFERENT stated scheduledArrival than what event A caused to be
    // stored (one hour later) — isolating the schedule mismatch.
    const mismatchedArrival = '2026-10-01T11:30:00+08:00';
    assert.notEqual(mismatchedArrival, REPLACEMENT_ARRIVAL, 'sanity: the stated arrival really differs from what is stored');
    const eventC: TransportServiceCancelledWithReprotectionEvent = {
      kind: 'TRANSPORT_SERVICE_CANCELLED_WITH_REPROTECTION',
      providerId: 'sim-airline-id',
      providerEventId: `sim-id-evt-n1-schedule-c-${randomUUID()}`,
      receivedAt: '2026-09-21T02:10:00.000Z',
      disclosedAsSimulatedDemoInput: true,
      originalService: { recordType: 'SOURCE_TRANSPORT_SERVICE', externalId: ORIGINAL_EXTERNAL_ID },
      replacementService: {
        recordType: 'SOURCE_TRANSPORT_SERVICE',
        externalId: REPLACEMENT_EXTERNAL_ID,
        operator: 'ID',
        scheduledDeparture: REPLACEMENT_DEPARTURE,
        scheduledArrival: mismatchedArrival,
      },
      affectedBookings: [{ recordType: 'SOURCE_BOOKING_REFERENCE' as const, externalId: 'IDSYN14' }],
      reason: 'N1 schedule-guard scenario, event C (wrong schedule, must be rejected).',
      provenanceKind: 'SCHEDULE_CHANGE',
    };

    const resultC = await acceptProviderDisruptionDemoEvent(ctx, eventC);
    assert.equal(resultC.ok, false, `event C (mismatched schedule) must be rejected, got: ${JSON.stringify(resultC)}`);
    if (resultC.ok) return;
    assert.equal(resultC.error.code, 'VALIDATION_FAILED', `error code is VALIDATION_FAILED, got ${resultC.error.code}: ${resultC.error.message}`);

    // -- Zero mutation: table counts unchanged.
    const countsAfter = await tableCounts(workspaceId);
    assert.deepEqual(countsAfter, countsBefore, 'no table mutated by the rejected event C');

    // -- IDSYN14's own line is byte-for-byte unchanged (still CONFIRMED).
    const originalLinesAfter = await linesForService(workspaceId, original!.subject.id);
    assert.deepEqual(originalLinesAfter, originalLinesBefore, "ID7159's reservation lines (including IDSYN14) are unchanged");

    // -- Event D: SAME corridor and schedule as what event A caused to be
    // stored, but a DIFFERENT stated operator — isolating the operator
    // mismatch. Reuses this same workspace/replacement row rather than
    // provisioning a second one (~2min each); IDSYN30 was left CONFIRMED by
    // event A (which only cancelled IDSYN03/10/11) and is untargeted by the
    // rejected event C.
    const idsyn30Before = await lineForBooking(workspaceId, original!.subject.id, 'IDSYN30');
    assert.equal(idsyn30Before.observed_status, 'CONFIRMED', 'IDSYN30 line is still CONFIRMED before event D');

    const mismatchedOperator = 'ZZ';
    assert.notEqual(mismatchedOperator, 'ID', 'sanity: the stated operator really differs from what is stored');
    const eventD: TransportServiceCancelledWithReprotectionEvent = {
      kind: 'TRANSPORT_SERVICE_CANCELLED_WITH_REPROTECTION',
      providerId: 'sim-airline-id',
      providerEventId: `sim-id-evt-n1-operator-d-${randomUUID()}`,
      receivedAt: '2026-09-21T02:20:00.000Z',
      disclosedAsSimulatedDemoInput: true,
      originalService: { recordType: 'SOURCE_TRANSPORT_SERVICE', externalId: ORIGINAL_EXTERNAL_ID },
      replacementService: {
        recordType: 'SOURCE_TRANSPORT_SERVICE',
        externalId: REPLACEMENT_EXTERNAL_ID,
        operator: mismatchedOperator,
        scheduledDeparture: REPLACEMENT_DEPARTURE,
        scheduledArrival: REPLACEMENT_ARRIVAL,
      },
      affectedBookings: [{ recordType: 'SOURCE_BOOKING_REFERENCE' as const, externalId: 'IDSYN30' }],
      reason: 'N1 operator-guard scenario, event D (wrong operator, must be rejected).',
      provenanceKind: 'SCHEDULE_CHANGE',
    };

    const countsBeforeD = await tableCounts(workspaceId);
    const resultD = await acceptProviderDisruptionDemoEvent(ctx, eventD);
    assert.equal(resultD.ok, false, `event D (mismatched operator) must be rejected, got: ${JSON.stringify(resultD)}`);
    if (resultD.ok) return;
    assert.equal(resultD.error.code, 'VALIDATION_FAILED', `error code is VALIDATION_FAILED, got ${resultD.error.code}: ${resultD.error.message}`);

    const countsAfterD = await tableCounts(workspaceId);
    assert.deepEqual(countsAfterD, countsBeforeD, 'no table mutated by the rejected event D');

    const originalLinesAfterD = await linesForService(workspaceId, original!.subject.id);
    assert.deepEqual(originalLinesAfterD, originalLinesAfter, "ID7159's reservation lines (including IDSYN30) are unchanged after event D");

    // -- Event E: a stored NULL published_arrival must be treated as a
    // schedule mismatch (VALIDATION_FAILED), never as a `.getTime()`
    // TypeError. Corrupts the stored ID7153 row directly via SQL (test setup
    // only — not itself asserted as part of the guard's own behaviour) since
    // no code path in this ingress otherwise nulls a published time once set.
    await pool.query(
      `UPDATE transport_services SET published_arrival = NULL WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, appliedA.replacementServiceId],
    );

    const eventE: TransportServiceCancelledWithReprotectionEvent = {
      kind: 'TRANSPORT_SERVICE_CANCELLED_WITH_REPROTECTION',
      providerId: 'sim-airline-id',
      providerEventId: `sim-id-evt-n1-null-arrival-e-${randomUUID()}`,
      receivedAt: '2026-09-21T02:30:00.000Z',
      disclosedAsSimulatedDemoInput: true,
      originalService: { recordType: 'SOURCE_TRANSPORT_SERVICE', externalId: ORIGINAL_EXTERNAL_ID },
      replacementService: {
        recordType: 'SOURCE_TRANSPORT_SERVICE',
        externalId: REPLACEMENT_EXTERNAL_ID,
        operator: 'ID',
        scheduledDeparture: REPLACEMENT_DEPARTURE,
        scheduledArrival: REPLACEMENT_ARRIVAL,
      },
      affectedBookings: [{ recordType: 'SOURCE_BOOKING_REFERENCE' as const, externalId: 'IDSYN30' }],
      reason: 'N1 null-published-time guard scenario, event E (stored arrival is NULL, must be rejected).',
      provenanceKind: 'SCHEDULE_CHANGE',
    };

    const countsBeforeE = await tableCounts(workspaceId);
    const resultE = await acceptProviderDisruptionDemoEvent(ctx, eventE);
    assert.equal(resultE.ok, false, `event E (null stored published_arrival) must be rejected, got: ${JSON.stringify(resultE)}`);
    if (resultE.ok) return;
    assert.equal(resultE.error.code, 'VALIDATION_FAILED', `error code is VALIDATION_FAILED, got ${resultE.error.code}: ${resultE.error.message}`);

    const countsAfterE = await tableCounts(workspaceId);
    assert.deepEqual(countsAfterE, countsBeforeE, 'no table mutated by the rejected event E');

    const originalLinesAfterE = await linesForService(workspaceId, original!.subject.id);
    assert.deepEqual(originalLinesAfterE, originalLinesAfterD, "ID7159's reservation lines are unchanged after event E");
  });
});

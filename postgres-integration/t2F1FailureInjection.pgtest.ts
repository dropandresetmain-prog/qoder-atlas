/**
 * F1 failure-injection — multi-command ingress survives partial failure.
 *
 * Proves against real PostgreSQL that the Sarah disruption ingress is crash-
 * safe WITHOUT a runtime mode switch: every step runs through the normal
 * command pipeline (each command opens its own UnitOfWork transaction that
 * commits its domain rows and its command receipt atomically), and the crash
 * is injected BETWEEN commands — before the next required step executes.
 *
 * For each of the three injection points, ordered tests prove:
 *   1. First attempt: commands up to the seam commit for real; the wrapper
 *      UnitOfWork throws the injected crash error when the seam command's
 *      idempotency key is next, so no receipt and no canonical mutation of
 *      the seam step exist afterwards.
 *   2. Retry: a plain (unwrapped) re-delivery of the SAME event completes —
 *      completed steps replay their stored receipts through the command
 *      ledger, missing steps execute fresh — returning status APPLIED.
 *   3. The full canonical state is verified complete (cancelled original
 *      lines, replacement service, replacement reservations/lines/
 *      allocations, journey selected-service updates, source/evidence,
 *      external records/links, ChangeSignal registered + completed).
 *   4. Duplicate delivery of the same event → status ALREADY_APPLIED
 *      (granted ONLY by the durable ChangeSignal completion written last),
 *      zero duplicate rows of any counted kind.
 *
 * No test-only branch in production code: the crash seam is a wrapper over
 * the real PgUnitOfWork keyed on command idempotency keys, which are part of
 * the ingress's own deterministic identity scheme
 * (`demo-ingress:<providerId>:<providerEventId>:<step>`).
 */
import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Pool } from '../src/persistence/postgres/pool.ts';
import { sharedTestPool } from './harness.ts';
import { loadDataset, type LoadedDataset } from '../src/app/demo/datasetLoader.ts';
import { provisionDataset } from '../src/app/demo/provisionDataset.ts';
import { runBaselineEvaluation } from '../src/app/demo/baselineEvaluation.ts';
import { resolveSourceSubjects, SOURCE_RECORD_TYPES } from '../src/app/demo/externalIdentity.ts';
import { PgUnitOfWork, type ExecuteOutcome } from '../src/persistence/postgres/pgUnitOfWork.ts';
import type { DomainCommandEnvelope } from '../src/contracts/v2/command/domainCommand.ts';
import {
  acceptProviderDisruptionDemoEvent,
  canonicalDisruptionEventHash,
  type TransportServiceCancelledWithReprotectionEvent,
} from '../src/app/target/providerDisruptionIngress.ts';
import type { TargetCommandContext } from '../src/app/target/applicationCommands.ts';

const BUNDLE_DIR = fileURLToPath(new URL('../fixtures/programmes/ait-summit-2026/', import.meta.url));
const ACTOR = 'principal:t2-f1-crash-test';

/** Mirror of the ingress's local uuidV5 + namespace — identity determinism is part of the retry contract. */
const DATASET_NAMESPACE = '6f6a1d4c-1b2e-4d3a-9c7f-2a5b8e0d4c11';

function uuidV5(namespace: string, name: string): string {
  const hash = createHash('sha1').update(Buffer.from(namespace.replace(/-/g, ''), 'hex')).update(Buffer.from(name, 'utf8')).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

class Mint {
  private readonly workspaceId: string;
  private readonly datasetKey: string;

  constructor(workspaceId: string, datasetKey: string) {
    this.workspaceId = workspaceId;
    this.datasetKey = datasetKey;
  }

  id(kind: string, ...parts: (string | number)[]): string {
    return uuidV5(DATASET_NAMESPACE, `${this.workspaceId}|${this.datasetKey}|${kind}|${parts.join('|')}`);
  }
}

/**
 * Crash seam: a UnitOfWork wrapper that lets every command through until the
 * configured seam command arrives, then throws as if the process died.
 * `exact` matches a whole idempotency key; `prefix` matches any key starting
 * with the given prefix (for step commands whose keys carry per-allocation
 * suffixes). Command receipts commit atomically WITH their domain rows
 * inside `uow.execute`, so "receipt missing but rows exist" is unreachable —
 * a command either fully committed or did not run, exactly like a real crash
 * between transactions.
 *
 * The ingress (R0) derives its own `signalUow = () => ctx.uow().underChangeSignal(id)`
 * for Steps 4-7 — a FRESH real `PgUnitOfWork` instance, not this proxy. Left
 * unhandled, `underChangeSignal` would silently escape the crash injection
 * (every command from Step 4 on would stop being interceptable), so the trap
 * below also intercepts `underChangeSignal` and re-wraps its result with the
 * SAME seam, keeping every derived unit of work crash-injectable.
 */
function crashingUnitOfWork(real: PgUnitOfWork, seam: { exact?: string; prefix?: string }): PgUnitOfWork {
  const proxy = new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === 'underChangeSignal') {
        return (changeSignalId: string): PgUnitOfWork => {
          const inner = (Reflect.get(target, 'underChangeSignal', target) as (id: string) => PgUnitOfWork).call(target, changeSignalId);
          return crashingUnitOfWork(inner, seam);
        };
      }
      if (prop !== 'execute') {
        return Reflect.get(target, prop, receiver);
      }
      return async <T>(
        envelope: DomainCommandEnvelope,
        fn: Parameters<PgUnitOfWork['execute']>[1],
      ): Promise<ExecuteOutcome<T>> => {
        const hit =
          (seam.exact !== undefined && envelope.idempotencyKey === seam.exact) ||
          (seam.prefix !== undefined && envelope.idempotencyKey.startsWith(seam.prefix));
        if (hit) {
          throw new Error(`[f1-injection] simulated crash before command ${envelope.idempotencyKey}`);
        }
        return (await Reflect.get(target, 'execute', target).call(target, envelope, fn)) as ExecuteOutcome<T>;
      };
    },
  });
  return proxy as PgUnitOfWork;
}

async function count(pool: Pool, workspaceId: string, table: string): Promise<number> {
  const result = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table} WHERE workspace_id = $1`, [
    workspaceId,
  ]);
  return Number(result.rows[0]!.n);
}

interface CrashWorkspace {
  workspaceId: string;
  connectionId: string;
  originalServiceId: string;
  affectedPnrs: string[];
  event: TransportServiceCancelledWithReprotectionEvent;
}

let pool: Pool;
let dataset: LoadedDataset;

async function prepareWorkspace(): Promise<CrashWorkspace> {
  const workspaceId = randomUUID();
  await pool.query('INSERT INTO workspaces (id, name) VALUES ($1, $2)', [workspaceId, `t2-f1-crash:${workspaceId}`]);
  const outcome = await provisionDataset({ pool, workspaceId, actorPrincipalId: ACTOR, dataset });
  assert.equal(outcome.status, 'MATERIALIZED');

  const connectionResult = await pool.query<{ connection_id: string }>(
    `SELECT DISTINCT connection_id FROM external_records WHERE workspace_id = $1 LIMIT 1`,
    [workspaceId],
  );
  assert.equal(connectionResult.rowCount, 1, 'exactly one provisioning connection');
  const connectionId = connectionResult.rows[0]!.connection_id;

  const mapping = await resolveSourceSubjects(pool, workspaceId, connectionId);
  const originalServiceExternalId = 'ID7159@2026-09-30T10:45:00.000Z';
  const originalServiceMapping = mapping.get(`${SOURCE_RECORD_TYPES.TRANSPORT_SERVICE}:${originalServiceExternalId}`);
  assert.ok(originalServiceMapping, 'original service resolves');
  const originalServiceId = originalServiceMapping.subject.id;

  await runBaselineEvaluation({ pool, workspaceId, actorPrincipalId: ACTOR });

  const affectedPnrs = ['IDSYN14', 'IDSYN03', 'IDSYN10', 'IDSYN11', 'IDSYN30'];
  const event: TransportServiceCancelledWithReprotectionEvent = {
    kind: 'TRANSPORT_SERVICE_CANCELLED_WITH_REPROTECTION',
    providerId: 'sim-airline-id',
    providerEventId: `sim-id-evt-f1-${randomUUID()}`,
    receivedAt: '2026-09-21T01:40:00.000Z',
    disclosedAsSimulatedDemoInput: true,
    originalService: { recordType: 'SOURCE_TRANSPORT_SERVICE', externalId: originalServiceExternalId },
    replacementService: {
      recordType: 'SOURCE_TRANSPORT_SERVICE',
      externalId: 'ID7153@2026-10-01T00:45:00.000Z',
      operator: 'ID',
      scheduledDeparture: '2026-10-01T07:45:00+07:00',
      scheduledArrival: '2026-10-01T10:30:00+08:00',
    },
    affectedBookings: affectedPnrs.map((pnr) => ({ recordType: 'SOURCE_BOOKING_REFERENCE', externalId: pnr })),
    reason: 'F1 failure-injection scenario.',
    provenanceKind: 'SCHEDULE_CHANGE',
  };
  return { workspaceId, connectionId, originalServiceId, affectedPnrs, event };
}

function realContext(w: CrashWorkspace): TargetCommandContext {
  return {
    workspaceId: w.workspaceId,
    actorPrincipalId: ACTOR,
    uow: () => new PgUnitOfWork(pool, w.workspaceId),
    pool,
  };
}

function crashingContext(w: CrashWorkspace, seam: { exact?: string; prefix?: string }): TargetCommandContext {
  return {
    workspaceId: w.workspaceId,
    actorPrincipalId: ACTOR,
    uow: () => crashingUnitOfWork(new PgUnitOfWork(pool, w.workspaceId), seam),
    pool,
  };
}

interface CountsSnapshot {
  transportServices: number;
  reservations: number;
  reservationLines: number;
  reservationAllocations: number;
  externalRecords: number;
  externalRecordLinks: number;
  changeSignals: number;
  changeSignalCompletions: number;
  scheduledReassessments: number;
}

async function snapshotCounts(w: CrashWorkspace): Promise<CountsSnapshot> {
  return {
    transportServices: await count(pool, w.workspaceId, 'transport_services'),
    reservations: await count(pool, w.workspaceId, 'reservations'),
    reservationLines: await count(pool, w.workspaceId, 'reservation_lines'),
    reservationAllocations: await count(pool, w.workspaceId, 'reservation_allocations'),
    externalRecords: await count(pool, w.workspaceId, 'external_records'),
    externalRecordLinks: await count(pool, w.workspaceId, 'external_record_links'),
    changeSignals: await count(pool, w.workspaceId, 'change_signals'),
    changeSignalCompletions: await count(pool, w.workspaceId, 'change_signal_completions'),
    scheduledReassessments: await count(pool, w.workspaceId, 'scheduled_reassessments'),
  };
}

/** Minted ids for one event delivery, derived exactly as the ingress derives them. */
function idsFor(w: CrashWorkspace) {
  const minter = new Mint(w.workspaceId, `disruption:${w.event.providerId}:${w.event.providerEventId}`);
  const serviceMinter = new Mint(w.workspaceId, 'disruption-replacement-service');
  // F5: the replacement service id is connection-scoped schedule-derived —
  // carrier|departureInstant (from the provider externalId form
  // `carrier@instant`) — NOT event-scoped, so retries and later events
  // referencing the same real service resolve to the same canonical service.
  const at = w.event.replacementService.externalId.lastIndexOf('@');
  const carrier = w.event.replacementService.externalId.slice(0, at);
  const departureInstant = w.event.replacementService.externalId.slice(at + 1);
  const replacementServiceId = serviceMinter.id('transport-service', carrier, new Date(departureInstant).toISOString(), '*', '*');
  return {
    sourceId: minter.id('source', w.event.providerEventId),
    evidenceId: minter.id('evidence', w.event.providerEventId),
    replacementServiceId,
    changeSignalId: minter.id('change-signal', w.event.providerEventId),
    replacementReservationId: (pnr: string) => minter.id('reservation', pnr),
  };
}

/**
 * All three crash seams below sit AFTER Step 3.5 (ChangeSignal
 * registration) and BEFORE Step 8 (ChangeSignal completion): the signal
 * itself must exist (registered before the crash point), but it must not
 * yet be completed.
 */
async function assertSignalRegisteredButNotCompleted(w: CrashWorkspace): Promise<void> {
  const ids = idsFor(w);
  const signalRows = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM change_signals WHERE workspace_id = $1 AND id = $2`,
    [w.workspaceId, ids.changeSignalId],
  );
  assert.equal(Number(signalRows.rows[0]!.n), 1, 'change signal registered before the crash point');
  const completionRows = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM change_signal_completions WHERE workspace_id = $1 AND change_signal_id = $2`,
    [w.workspaceId, ids.changeSignalId],
  );
  assert.equal(Number(completionRows.rows[0]!.n), 0, 'no change signal completion after crash');
}

/**
 * The complete canonical truth after ANY crash+retry, at EVERY seam:
 * every required step of the ingress committed exactly once.
 */
async function assertCompleteCanonicalState(w: CrashWorkspace): Promise<void> {
  const { workspaceId } = w;
  const ids = idsFor(w);
  const mapping = await resolveSourceSubjects(pool, workspaceId, w.connectionId);

  // Source + evidence provenance (Step 3).
  const sourceRow = await pool.query<{ content_hash: string }>(
    `SELECT content_hash FROM source_records WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, ids.sourceId],
  );
  assert.equal(sourceRow.rowCount, 1, 'source record exists after retry');
  assert.equal(sourceRow.rows[0]!.content_hash, canonicalDisruptionEventHash(w.event), 'source content hash matches the event');

  const evidenceRow = await pool.query<{ assertion_type: string }>(
    `SELECT assertion_type FROM evidence_records WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, ids.evidenceId],
  );
  assert.equal(evidenceRow.rowCount, 1, 'evidence record exists after retry');
  assert.equal(evidenceRow.rows[0]!.assertion_type, 'TRANSPORT_SERVICE_CANCELLED_WITH_REPROTECTION', 'evidence assertion type matches');

  // Replacement service (Step 5).
  const serviceRow = await pool.query<{ id: string }>(
    `SELECT id FROM transport_services WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, ids.replacementServiceId],
  );
  assert.equal(serviceRow.rowCount, 1, 'exactly one replacement service exists');

  for (const pnr of w.affectedPnrs) {
    const pnrMapping = mapping.get(`${SOURCE_RECORD_TYPES.RESERVATION}:${pnr}`);
    assert.ok(pnrMapping, `PNR ${pnr} resolves`);
    const originalReservationId = pnrMapping.subject.id;

    // Step 4: original line CANCELLED, stamped with this event's evidence.
    const originalLines = await pool.query<{ line_id: string; observed_status: string; observation_evidence_id: string }>(
      `SELECT l.id AS line_id, l.observed_status, l.observation_evidence_id
         FROM reservation_lines l
         JOIN transport_line_details tld ON tld.workspace_id = l.workspace_id AND tld.line_id = l.id
        WHERE l.workspace_id = $1 AND l.reservation_id = $2 AND tld.transport_service_id = $3`,
      [workspaceId, originalReservationId, w.originalServiceId],
    );
    assert.ok(originalLines.rows.length > 0, `PNR ${pnr} original line exists`);
    for (const line of originalLines.rows) {
      assert.equal(line.observed_status, 'CANCELLED', `PNR ${pnr} original line CANCELLED after retry`);
      assert.equal(line.observation_evidence_id, ids.evidenceId, `PNR ${pnr} cancellation evidence matches`);
    }

    // Step 6: replacement reservation with a CONFIRMED line on the replacement service.
    const replacementReservationId = ids.replacementReservationId(pnr);
    const replacementLines = await pool.query<{ observed_status: string }>(
      `SELECT l.observed_status
         FROM reservation_lines l
         JOIN transport_line_details tld ON tld.workspace_id = l.workspace_id AND tld.line_id = l.id
        WHERE l.workspace_id = $1 AND l.reservation_id = $2 AND tld.transport_service_id = $3`,
      [workspaceId, replacementReservationId, ids.replacementServiceId],
    );
    assert.ok(replacementLines.rowCount! > 0, `PNR ${pnr} replacement line exists on the replacement service`);
    for (const line of replacementLines.rows) {
      assert.equal(line.observed_status, 'CONFIRMED', `PNR ${pnr} replacement line CONFIRMED`);
    }

    // Step 6: allocations bind the SAME (travellerId, journeyItemId) pairs as
    // the displaced (cancelled-on-original-service) lines.
    const originalPairs = await pool.query<{ traveller_id: string; journey_item_id: string | null }>(
      `SELECT DISTINCT a.traveller_id, a.journey_item_id
         FROM reservation_allocations a
         JOIN reservation_lines l ON l.workspace_id = a.workspace_id AND l.id = a.line_id AND l.reservation_id = a.reservation_id
         JOIN transport_line_details t ON t.workspace_id = l.workspace_id AND t.line_id = l.id
        WHERE a.workspace_id = $1 AND a.reservation_id = $2 AND t.transport_service_id = $3`,
      [workspaceId, originalReservationId, w.originalServiceId],
    );
    const replacementPairs = await pool.query<{ traveller_id: string; journey_item_id: string | null }>(
      `SELECT DISTINCT traveller_id, journey_item_id FROM reservation_allocations WHERE workspace_id = $1 AND reservation_id = $2`,
      [workspaceId, replacementReservationId],
    );
    const key = (r: { traveller_id: string; journey_item_id: string | null }) => `${r.traveller_id}:${r.journey_item_id ?? 'none'}`;
    assert.deepEqual(
      replacementPairs.rows.map(key).sort(),
      originalPairs.rows.map(key).sort(),
      `PNR ${pnr} replacement allocations bind the same (traveller, journey item) pairs`,
    );

    // Step 6: journey selection flipped to the replacement service.
    for (const pair of originalPairs.rows) {
      if (!pair.journey_item_id) continue;
      const item = await pool.query<{ selected_service_id: string | null }>(
        `SELECT selected_service_id FROM transport_item_details WHERE workspace_id = $1 AND journey_item_id = $2`,
        [workspaceId, pair.journey_item_id],
      );
      assert.equal(item.rowCount, 1, `journey item ${pair.journey_item_id} has transport details`);
      assert.equal(item.rows[0]!.selected_service_id, ids.replacementServiceId, `journey item ${pair.journey_item_id} selected the replacement service`);
    }

    // Step 7: external identity — service record + synthetic booking ref, both LINKED.
    const serviceRecord = await pool.query<{ identity_state: string; canonical_subject_id: string }>(
      `SELECT r.identity_state, l.canonical_subject_id
         FROM external_records r
         JOIN external_record_links l ON l.workspace_id = r.workspace_id AND l.external_record_id = r.id AND l.superseded_at IS NULL
        WHERE r.workspace_id = $1 AND r.record_type = $2 AND r.external_id = $3`,
      [workspaceId, SOURCE_RECORD_TYPES.TRANSPORT_SERVICE, w.event.replacementService.externalId],
    );
    assert.equal(serviceRecord.rowCount, 1, 'replacement service external record exists and is linked');
    assert.equal(serviceRecord.rows[0]!.identity_state, 'LINKED', 'replacement service external record is LINKED');
    assert.equal(serviceRecord.rows[0]!.canonical_subject_id, ids.replacementServiceId, 'replacement service record links to the canonical service');

    const syntheticExternalId = `REPROTECTED:${w.event.providerEventId}:${pnr}`;
    const bookingRecord = await pool.query<{ identity_state: string; canonical_subject_id: string }>(
      `SELECT r.identity_state, l.canonical_subject_id
         FROM external_records r
         JOIN external_record_links l ON l.workspace_id = r.workspace_id AND l.external_record_id = r.id AND l.superseded_at IS NULL
        WHERE r.workspace_id = $1 AND r.record_type = $2 AND r.external_id = $3`,
      [workspaceId, SOURCE_RECORD_TYPES.RESERVATION, syntheticExternalId],
    );
    assert.equal(bookingRecord.rowCount, 1, `synthetic booking record for ${pnr} exists and is linked`);
    assert.equal(bookingRecord.rows[0]!.identity_state, 'LINKED', `synthetic booking record for ${pnr} is LINKED`);
    assert.equal(bookingRecord.rows[0]!.canonical_subject_id, replacementReservationId, `synthetic booking record for ${pnr} links to the replacement reservation`);
  }

  // Step 8: ChangeSignal registered once and completed exactly once
  // (only-after-every-step truth; migration 0124 replaces the old
  // information-record completion marker one-for-one).
  const signalRows = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM change_signals WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, ids.changeSignalId],
  );
  assert.equal(Number(signalRows.rows[0]!.n), 1, 'exactly one change signal exists after retry');
  const completionRows = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM change_signal_completions WHERE workspace_id = $1 AND change_signal_id = $2`,
    [workspaceId, ids.changeSignalId],
  );
  assert.equal(Number(completionRows.rows[0]!.n), 1, 'exactly one change signal completion exists after retry');
}

// ---------------------------------------------------------------------------
// Ordered tests — one workspace per crash point, crash → retry → duplicate.
// ---------------------------------------------------------------------------

describe('F1 failure injection — provider disruption ingress survives partial failure', () => {
  before(async () => {
    pool = await sharedTestPool();
    dataset = await loadDataset(BUNDLE_DIR);
  });

  test('setup: three workspaces provisioned, one per crash point', async () => {
    points.beforeReplacementService.workspace = await prepareWorkspace();
    points.afterReservationsBeforeLines.workspace = await prepareWorkspace();
    points.beforeExternalRecords.workspace = await prepareWorkspace();
  });

  // -- Crash point 1: before replacement service creation, after cancellations
  test('point 1 first attempt: crash BEFORE the replacement service step — all five cancellations committed, replacement service NOT created, change signal not completed', async () => {
    const w = points.beforeReplacementService.workspace!;
    const ids = idsFor(w);

    const first = await acceptProviderDisruptionDemoEvent(
      crashingContext(w, { exact: `demo-ingress:${w.event.providerId}:${w.event.providerEventId}:replacement-service` }),
      w.event,
    );
    assert.equal(first.ok, false, 'first attempt crashes at the seam');
    if (first.ok) return;
    assert.match(first.error.message, /\[f1-injection\] simulated crash/, 'crash surfaced as the injected error');

    // Cancellations committed before the crash.
    const mapping = await resolveSourceSubjects(pool, w.workspaceId, w.connectionId);
    for (const pnr of w.affectedPnrs) {
      const pnrMapping = mapping.get(`${SOURCE_RECORD_TYPES.RESERVATION}:${pnr}`);
      assert.ok(pnrMapping, `PNR ${pnr} resolves`);
      const lines = await pool.query<{ observed_status: string; observation_evidence_id: string }>(
        `SELECT l.observed_status, l.observation_evidence_id
           FROM reservation_lines l
           JOIN transport_line_details tld ON tld.workspace_id = l.workspace_id AND tld.line_id = l.id
          WHERE l.workspace_id = $1 AND l.reservation_id = $2 AND tld.transport_service_id = $3`,
        [w.workspaceId, pnrMapping.subject.id, w.originalServiceId],
      );
      assert.ok(lines.rows.length > 0, `PNR ${pnr} has a line on the original service`);
      for (const line of lines.rows) {
        assert.equal(line.observed_status, 'CANCELLED', `PNR ${pnr} original line CANCELLED before crash`);
        assert.equal(line.observation_evidence_id, ids.evidenceId, `PNR ${pnr} cancellation stamped with this event's evidence id`);
      }
    }

    // Replacement service NOT created, change signal not completed.
    const serviceRows = await pool.query<{ id: string }>(
      `SELECT id FROM transport_services WHERE workspace_id = $1 AND id = $2`,
      [w.workspaceId, ids.replacementServiceId],
    );
    assert.equal(serviceRows.rowCount, 0, 'replacement service row absent after crash');
    await assertSignalRegisteredButNotCompleted(w);
  });

  test('point 1 retry: same event re-delivered → APPLIED with complete canonical state; duplicate → ALREADY_APPLIED with zero duplicates', async () => {
    const w = points.beforeReplacementService.workspace!;

    const retry = await acceptProviderDisruptionDemoEvent(realContext(w), w.event);
    assert.equal(retry.ok, true, `retry succeeds: ${retry.ok ? '' : JSON.stringify(retry.error)}`);
    if (!retry.ok) return;
    assert.equal(retry.status, 'APPLIED', 'retry status is APPLIED');

    await assertCompleteCanonicalState(w);

    const before = await snapshotCounts(w);
    const dup = await acceptProviderDisruptionDemoEvent(realContext(w), w.event);
    assert.equal(dup.ok, true, 'duplicate delivery resolves ok');
    if (!dup.ok) return;
    assert.equal(dup.status, 'ALREADY_APPLIED', 'duplicate delivery is ALREADY_APPLIED');
    assert.deepEqual(await snapshotCounts(w), before, 'zero duplicate rows of any counted kind');
  });

  // -- Crash point 2: after replacement reservations exist, before final line/allocation/selection
  test('point 2 first attempt: crash AFTER reservation creation but BEFORE the first replacement line — reservations exist with no lines/allocations, change signal not completed', async () => {
    const w = points.afterReservationsBeforeLines.workspace!;
    const ids = idsFor(w);
    const firstPnr = w.affectedPnrs[0]!;

    const first = await acceptProviderDisruptionDemoEvent(
      crashingContext(w, { prefix: `demo-ingress:${w.event.providerId}:${w.event.providerEventId}:line:${firstPnr}:` }),
      w.event,
    );
    assert.equal(first.ok, false, 'first attempt crashes before the first replacement line');
    if (first.ok) return;
    assert.match(first.error.message, /\[f1-injection\] simulated crash/, 'crash surfaced as the injected error');

    // Replacement reservations committed; no lines/allocations yet.
    for (const pnr of w.affectedPnrs) {
      const reservationRow = await pool.query<{ id: string; observed_status: string }>(
        `SELECT id, observed_status FROM reservations WHERE workspace_id = $1 AND id = $2`,
        [w.workspaceId, ids.replacementReservationId(pnr)],
      );
      assert.equal(reservationRow.rowCount, 1, `replacement reservation for ${pnr} exists after crash`);
      assert.equal(reservationRow.rows[0]!.observed_status, 'CONFIRMED', `replacement reservation for ${pnr} is CONFIRMED`);

      const lines = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM reservation_lines WHERE workspace_id = $1 AND reservation_id = $2`,
        [w.workspaceId, ids.replacementReservationId(pnr)],
      );
      assert.equal(Number(lines.rows[0]!.n), 0, `replacement reservation for ${pnr} has zero lines after crash`);
      const allocations = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM reservation_allocations WHERE workspace_id = $1 AND reservation_id = $2`,
        [w.workspaceId, ids.replacementReservationId(pnr)],
      );
      assert.equal(Number(allocations.rows[0]!.n), 0, `replacement reservation for ${pnr} has zero allocations after crash`);
    }

    await assertSignalRegisteredButNotCompleted(w);
  });

  test('point 2 retry: same event re-delivered → APPLIED with complete canonical state; duplicate → ALREADY_APPLIED with zero duplicates', async () => {
    const w = points.afterReservationsBeforeLines.workspace!;

    const retry = await acceptProviderDisruptionDemoEvent(realContext(w), w.event);
    assert.equal(retry.ok, true, `retry succeeds: ${retry.ok ? '' : JSON.stringify(retry.error)}`);
    if (!retry.ok) return;
    assert.equal(retry.status, 'APPLIED', 'retry status is APPLIED');

    await assertCompleteCanonicalState(w);

    const before = await snapshotCounts(w);
    const dup = await acceptProviderDisruptionDemoEvent(realContext(w), w.event);
    assert.equal(dup.ok, true, 'duplicate delivery resolves ok');
    if (!dup.ok) return;
    assert.equal(dup.status, 'ALREADY_APPLIED', 'duplicate delivery is ALREADY_APPLIED');
    assert.deepEqual(await snapshotCounts(w), before, 'zero duplicate rows of any counted kind');
  });

  // -- Crash point 3: before external-record/link creation
  test('point 3 first attempt: crash BEFORE external-record/link creation — reservations, lines, allocations, selection all committed; no external records for the event, change signal not completed', async () => {
    const w = points.beforeExternalRecords.workspace!;
    const ids = idsFor(w);

    const first = await acceptProviderDisruptionDemoEvent(
      crashingContext(w, { exact: `demo-ingress:${w.event.providerId}:${w.event.providerEventId}:external-service` }),
      w.event,
    );
    assert.equal(first.ok, false, 'first attempt crashes before external identity');
    if (first.ok) return;
    assert.match(first.error.message, /\[f1-injection\] simulated crash/, 'crash surfaced as the injected error');

    // All reservation-side work committed before the crash.
    for (const pnr of w.affectedPnrs) {
      const lines = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM reservation_lines WHERE workspace_id = $1 AND reservation_id = $2`,
        [w.workspaceId, ids.replacementReservationId(pnr)],
      );
      assert.ok(Number(lines.rows[0]!.n) > 0, `replacement reservation for ${pnr} has lines after crash`);
      const allocations = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM reservation_allocations WHERE workspace_id = $1 AND reservation_id = $2`,
        [w.workspaceId, ids.replacementReservationId(pnr)],
      );
      assert.ok(Number(allocations.rows[0]!.n) > 0, `replacement reservation for ${pnr} has allocations after crash`);
    }

    // No external records for the replacement service or synthetic booking refs.
    const externalForEvent = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM external_records WHERE workspace_id = $1 AND (external_id = $2 OR external_id LIKE $3)`,
      [w.workspaceId, w.event.replacementService.externalId, `REPROTECTED:${w.event.providerEventId}:%`],
    );
    assert.equal(Number(externalForEvent.rows[0]!.n), 0, 'no external records for this event after crash');

    await assertSignalRegisteredButNotCompleted(w);
  });

  test('point 3 retry: same event re-delivered → APPLIED with complete canonical state; duplicate → ALREADY_APPLIED with zero duplicates', async () => {
    const w = points.beforeExternalRecords.workspace!;

    const retry = await acceptProviderDisruptionDemoEvent(realContext(w), w.event);
    assert.equal(retry.ok, true, `retry succeeds: ${retry.ok ? '' : JSON.stringify(retry.error)}`);
    if (!retry.ok) return;
    assert.equal(retry.status, 'APPLIED', 'retry status is APPLIED');

    await assertCompleteCanonicalState(w);

    const before = await snapshotCounts(w);
    const dup = await acceptProviderDisruptionDemoEvent(realContext(w), w.event);
    assert.equal(dup.ok, true, 'duplicate delivery resolves ok');
    if (!dup.ok) return;
    assert.equal(dup.status, 'ALREADY_APPLIED', 'duplicate delivery is ALREADY_APPLIED');
    assert.deepEqual(await snapshotCounts(w), before, 'zero duplicate rows of any counted kind');
  });
});

interface PointState {
  workspace?: CrashWorkspace;
}
const points: Record<'beforeReplacementService' | 'afterReservationsBeforeLines' | 'beforeExternalRecords', PointState> = {
  beforeReplacementService: {},
  afterReservationsBeforeLines: {},
  beforeExternalRecords: {},
};

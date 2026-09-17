/**
 * F5 focused — replacement TransportService identity is NOT keyed to the
 * provider event identity.
 *
 * The replacement service id is minted from the provider's SERVICE identity
 * (recordType + externalId on the connection), not from `providerEventId`.
 * A later, DIFFERENT provider event that references the SAME real replacement
 * service must therefore resolve to the same canonical TransportService row
 * (F5: no duplicate), and the duplicate path must still terminate in the
 * completion-marker-granted ALREADY_APPLIED.
 *
 * Proven against real PostgreSQL in one workspace:
 *   1. Event A: ID7159 cancelled, five cohort bookings involuntarily
 *      reprotectioned onto replacement service ID7153 → APPLIED.
 *   2. Event B (different providerEventId, a DIFFERENT original service with
 *      its own booked traveller, SAME replacement external identity
 *      ID7153@...) → APPLIED, and event B's replacementServiceId equals
 *      event A's — one canonical service, reused, not duplicated.
 *   3. Duplicate delivery of event B → ALREADY_APPLIED (marker-granted).
 */
import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Pool } from '../src/persistence/postgres/pool.ts';
import { sharedTestPool } from './harness.ts';
import { loadDataset, type LoadedDataset } from '../src/app/demo/datasetLoader.ts';
import { provisionDataset } from '../src/app/demo/provisionDataset.ts';
import { runBaselineEvaluation } from '../src/app/demo/baselineEvaluation.ts';
import { resolveSourceSubjects, SOURCE_RECORD_TYPES } from '../src/app/demo/externalIdentity.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import {
  acceptProviderDisruptionDemoEvent,
  type TransportServiceCancelledWithReprotectionEvent,
} from '../src/app/target/providerDisruptionIngress.ts';
import type { TargetCommandContext } from '../src/app/target/applicationCommands.ts';

const BUNDLE_DIR = fileURLToPath(new URL('../fixtures/programmes/ait-summit-2026/', import.meta.url));
const ACTOR = 'principal:t2-f5-service-identity-test';
const REPLACEMENT_EXTERNAL_ID = 'ID7153@2026-10-01T00:45:00.000Z';

let pool: Pool;
let dataset: LoadedDataset;

describe('F5 — replacement service identity resolves via external identity, not provider event identity', () => {
  before(async () => {
    pool = await sharedTestPool();
    dataset = await loadDataset(BUNDLE_DIR);
  });

  test('a second provider event referencing the same real replacement service reuses the canonical service; duplicate delivery is ALREADY_APPLIED', async () => {
    // -- Workspace provisioning.
    const workspaceId = randomUUID();
    await pool.query('INSERT INTO workspaces (id, name) VALUES ($1, $2)', [workspaceId, `t2-f5:${workspaceId}`]);
    const outcome = await provisionDataset({ pool, workspaceId, actorPrincipalId: ACTOR, dataset });
    assert.equal(outcome.status, 'MATERIALIZED');

    const connectionResult = await pool.query<{ connection_id: string }>(
      `SELECT DISTINCT connection_id FROM external_records WHERE workspace_id = $1 LIMIT 1`,
      [workspaceId],
    );
    assert.equal(connectionResult.rowCount, 1, 'exactly one provisioning connection');
    const connectionId = connectionResult.rows[0]!.connection_id;

    await runBaselineEvaluation({ pool, workspaceId, actorPrincipalId: ACTOR });

    const ctx: TargetCommandContext = {
      workspaceId,
      actorPrincipalId: ACTOR,
      uow: () => new PgUnitOfWork(pool, workspaceId),
      pool,
    };

    const mapping = await resolveSourceSubjects(pool, workspaceId, connectionId);
    const firstOriginalExternalId = 'ID7159@2026-09-30T10:45:00.000Z';
    const firstOriginal = mapping.get(`${SOURCE_RECORD_TYPES.TRANSPORT_SERVICE}:${firstOriginalExternalId}`);
    assert.ok(firstOriginal, 'original service ID7159 resolves');

    // -- Event A: the approved disruption, reprotections the cohort onto ID7153.
    const eventA: TransportServiceCancelledWithReprotectionEvent = {
      kind: 'TRANSPORT_SERVICE_CANCELLED_WITH_REPROTECTION',
      providerId: 'sim-airline-id',
      providerEventId: `sim-id-evt-f5-a-${randomUUID()}`,
      receivedAt: '2026-09-21T01:40:00.000Z',
      disclosedAsSimulatedDemoInput: true,
      originalService: { recordType: 'SOURCE_TRANSPORT_SERVICE', externalId: firstOriginalExternalId },
      replacementService: {
        recordType: 'SOURCE_TRANSPORT_SERVICE',
        externalId: REPLACEMENT_EXTERNAL_ID,
        operator: 'ID',
        scheduledDeparture: '2026-10-01T07:45:00+07:00',
        scheduledArrival: '2026-10-01T10:30:00+08:00',
      },
      affectedBookings: ['IDSYN14', 'IDSYN03', 'IDSYN10', 'IDSYN11', 'IDSYN30'].map((pnr) => ({
        recordType: 'SOURCE_BOOKING_REFERENCE' as const,
        externalId: pnr,
      })),
      reason: 'F5 service-identity scenario, event A.',
      provenanceKind: 'SCHEDULE_CHANGE',
    };

    const appliedA = await acceptProviderDisruptionDemoEvent(ctx, eventA);
    assert.equal(appliedA.ok, true, `event A applied: ${appliedA.ok ? '' : JSON.stringify(appliedA.error)}`);
    if (!appliedA.ok) return;
    assert.equal(appliedA.status, 'APPLIED', 'event A status APPLIED');

    // -- Event B: different providerEventId, a DIFFERENT original service that
    // really has a booked traveller, SAME replacement external identity.
    const secondOriginalExternalId = 'TR883@2026-09-28T17:20:00.000Z';
    const secondOriginal = mapping.get(`${SOURCE_RECORD_TYPES.TRANSPORT_SERVICE}:${secondOriginalExternalId}`);
    assert.ok(secondOriginal, `second original service ${secondOriginalExternalId} resolves`);

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
      [workspaceId, secondOriginal.subject.id],
    );
    assert.ok(bookingRefs.rowCount! > 0, 'at least one booked booking reference on the second original service');

    const eventB: TransportServiceCancelledWithReprotectionEvent = {
      kind: 'TRANSPORT_SERVICE_CANCELLED_WITH_REPROTECTION',
      providerId: 'sim-airline-id',
      providerEventId: `sim-id-evt-f5-b-${randomUUID()}`,
      receivedAt: '2026-09-21T02:10:00.000Z',
      disclosedAsSimulatedDemoInput: true,
      originalService: { recordType: 'SOURCE_TRANSPORT_SERVICE', externalId: secondOriginalExternalId },
      replacementService: {
        recordType: 'SOURCE_TRANSPORT_SERVICE',
        externalId: REPLACEMENT_EXTERNAL_ID,
        operator: 'ID',
        scheduledDeparture: '2026-10-01T07:45:00+07:00',
        scheduledArrival: '2026-10-01T10:30:00+08:00',
      },
      affectedBookings: bookingRefs.rows.map((r) => ({
        recordType: 'SOURCE_BOOKING_REFERENCE' as const,
        externalId: r.external_id,
      })),
      reason: 'F5 service-identity scenario, event B.',
      provenanceKind: 'SCHEDULE_CHANGE',
    };

    const appliedB = await acceptProviderDisruptionDemoEvent(ctx, eventB);
    assert.equal(appliedB.ok, true, `event B applied: ${appliedB.ok ? '' : JSON.stringify(appliedB.error)}`);
    if (!appliedB.ok) return;
    assert.equal(appliedB.status, 'APPLIED', 'event B status APPLIED');

    // THE F5 TRUTH: both events resolve the SAME canonical replacement service.
    assert.equal(
      appliedB.replacementServiceId, appliedA.replacementServiceId,
      'event B resolves the SAME canonical replacement service as event A (identity from the service, not the event)',
    );

    // Exactly ONE canonical TransportService row for the provider service identity.
    const serviceRows = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM transport_services s
         JOIN external_records r ON r.workspace_id = s.workspace_id AND r.record_type = 'SOURCE_TRANSPORT_SERVICE' AND r.external_id = $2
         JOIN external_record_links l ON l.workspace_id = r.workspace_id AND l.external_record_id = r.id AND l.superseded_at IS NULL
           AND l.canonical_subject_id = s.id
        WHERE s.workspace_id = $1`,
      [workspaceId, REPLACEMENT_EXTERNAL_ID],
    );
    assert.equal(Number(serviceRows.rows[0]!.n), 1, 'exactly one canonical TransportService for the ID7153 external identity');

    // Duplicate delivery of event B → marker-granted ALREADY_APPLIED.
    const dup = await acceptProviderDisruptionDemoEvent(ctx, eventB);
    assert.equal(dup.ok, true, 'duplicate event B resolves ok');
    if (!dup.ok) return;
    assert.equal(dup.status, 'ALREADY_APPLIED', 'duplicate event B is ALREADY_APPLIED');
  });
});

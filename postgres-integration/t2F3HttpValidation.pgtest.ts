/**
 * F3 — HTTP Validation Boundary Tests
 *
 * Proves against real PostgreSQL that the HTTP boundary correctly validates
 * provider-disruption event input before any canonical mutation occurs.
 *
 * Tests:
 * a. Malformed (non-JSON) body → HTTP 400, error code VALIDATION_FAILED, zero mutation
 * b. Valid JSON but wrong kind → HTTP 400, zero mutation
 * c. Valid direct event body → HTTP 202 status APPLIED
 * d. Empty body with NORTHSTAR_DEMO_DISRUPTION_EVENT_FILE configured → HTTP 202 (file-driven path)
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { Pool } from '../src/persistence/postgres/pool.ts';
import { sharedTestPool } from './harness.ts';
import { loadDataset, type LoadedDataset } from '../src/app/demo/datasetLoader.ts';
import { provisionDataset } from '../src/app/demo/provisionDataset.ts';
import { composeTargetApplication, type TargetApplication } from '../src/app/target/composeTargetApplication.ts';
import { handleTargetProductHttp } from '../src/app/target/targetHttpHandlers.ts';
import { resolveSourceSubjects, SOURCE_RECORD_TYPES } from '../src/app/demo/externalIdentity.ts';
import type { TransportServiceCancelledWithReprotectionEvent } from '../src/app/target/providerDisruptionIngress.ts';

const BUNDLE_DIR = fileURLToPath(new URL('../fixtures/programmes/ait-summit-2026/', import.meta.url));
const ACTOR = 'principal:t2-f3-http-validation-test';

let pool: Pool;
let dataset: LoadedDataset;

before(async () => {
  pool = await sharedTestPool();
  dataset = await loadDataset(BUNDLE_DIR);
});

after(async () => {
  await pool.end();
});

async function freshWorkspace(): Promise<string> {
  const workspaceId = randomUUID();
  await pool.query('INSERT INTO workspaces (id, name) VALUES ($1, $2)', [workspaceId, `t2-f3:${workspaceId}`]);
  return workspaceId;
}

/**
 * Drive the real HTTP handler with req/res stubs.
 * Supports three body modes:
 * - undefined: no body (empty iterator)
 * - string: raw string (for malformed JSON)
 * - object: JSON-serialized
 */
async function callHandler(
  app: TargetApplication,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown | string,
): Promise<{ status: number; body: string }> {
  let status = 0;
  const chunks: string[] = [];
  const res = {
    writeHead(code: number) {
      status = code;
      return res;
    },
    end(payload?: string) {
      if (payload) chunks.push(payload);
    },
  };
  const req = {
    method,
    url: path,
    [Symbol.asyncIterator]: async function* () {
      if (body !== undefined) {
        if (typeof body === 'string') {
          yield Buffer.from(body);
        } else {
          yield Buffer.from(JSON.stringify(body));
        }
      }
    },
  };
  const handled = await handleTargetProductHttp(
    { app },
    req as unknown as Parameters<typeof handleTargetProductHttp>[1],
    res as unknown as Parameters<typeof handleTargetProductHttp>[2],
    new URL(path, 'http://localhost'),
  );
  assert.ok(handled, `${method} ${path} was handled`);
  return { status, body: chunks.join('') };
}

async function count(workspaceId: string, table: string): Promise<number> {
  const result = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table} WHERE workspace_id = $1`, [
    workspaceId,
  ]);
  return Number(result.rows[0]!.n);
}

// ---------------------------------------------------------------------------
// Shared state across the ordered test steps.
// ---------------------------------------------------------------------------
interface TestState {
  workspaceId: string;
  app: TargetApplication;
  connectionId: string;
  originalServiceExternalId: string;
  originalServiceId: string;
}

const state: Partial<TestState> = {};

// ---------------------------------------------------------------------------
// Ordered test steps — each proves one truth.
// ---------------------------------------------------------------------------

describe('F3 HTTP validation boundary', () => {
  test('step 1: provision workspace and compose application', async () => {
    const workspaceId = await freshWorkspace();
    state.workspaceId = workspaceId;

    // Provision the canonical dataset.
    const outcome = await provisionDataset({ pool, workspaceId, actorPrincipalId: ACTOR, dataset });
    assert.equal(outcome.status, 'MATERIALIZED');
    if (outcome.status !== 'MATERIALIZED') return;

    // Resolve the provisioning connection.
    const connectionResult = await pool.query<{ connection_id: string }>(
      `SELECT DISTINCT connection_id FROM external_records WHERE workspace_id = $1 LIMIT 1`,
      [workspaceId],
    );
    assert.equal(connectionResult.rowCount, 1, 'exactly one provisioning connection');
    state.connectionId = connectionResult.rows[0]!.connection_id;

    const mapping = await resolveSourceSubjects(pool, workspaceId, state.connectionId);

    // Resolve the original service external identity.
    const originalServiceExternalId = 'ID7159@2026-09-30T10:45:00.000Z';
    state.originalServiceExternalId = originalServiceExternalId;

    const originalServiceMapping = mapping.get(`${SOURCE_RECORD_TYPES.TRANSPORT_SERVICE}:${originalServiceExternalId}`);
    assert.ok(originalServiceMapping, `original service ${originalServiceExternalId} resolves through external identity`);
    assert.equal(originalServiceMapping.subject.kind, 'TRANSPORT_SERVICE');
    state.originalServiceId = originalServiceMapping.subject.id;

    // Set the disclosed event file env var BEFORE composing the application.
    // This enables the empty-body path to load the event from file.
    process.env.NORTHSTAR_DEMO_DISRUPTION_EVENT_FILE = 'data/ait-demo-input-pack/scenarios/s1-supplier-disruption/inputs/airline-schedule-change-id7159.json';

    // Compose the target application.
    state.app = await composeTargetApplication({ workspaceId });
  });

  test('step 2a: malformed (non-JSON) body → HTTP 400, error code VALIDATION_FAILED, zero mutation', async () => {
    const { workspaceId, app } = state;
    if (!workspaceId || !app) return;

    // Count before.
    const transportServicesBefore = await count(workspaceId, 'transport_services');
    const reservationsBefore = await count(workspaceId, 'reservations');
    const reservationLinesBefore = await count(workspaceId, 'reservation_lines');
    const reservationAllocationsBefore = await count(workspaceId, 'reservation_allocations');
    const externalRecordsBefore = await count(workspaceId, 'external_records');
    const informationRecordsBefore = await count(workspaceId, 'information_records');
    const commandReceiptsBefore = await count(workspaceId, 'command_receipts');

    // POST malformed body (non-JSON string).
    const response = await callHandler(app, 'POST', '/api/v2/demo/provider-event/airline-rebooking', 'this is not json{{{');
    assert.equal(response.status, 400, `malformed body returns 400, got ${response.status}: ${response.body}`);

    const result = JSON.parse(response.body);
    assert.equal(result.code, 'VALIDATION_FAILED', `error code is VALIDATION_FAILED, got ${result.code}`);
    assert.ok(result.message.toLowerCase().includes('json'), `message mentions JSON: ${result.message}`);

    // Verify zero mutation.
    assert.equal(await count(workspaceId, 'transport_services'), transportServicesBefore, 'no transport services mutated');
    assert.equal(await count(workspaceId, 'reservations'), reservationsBefore, 'no reservations mutated');
    assert.equal(await count(workspaceId, 'reservation_lines'), reservationLinesBefore, 'no reservation lines mutated');
    assert.equal(await count(workspaceId, 'reservation_allocations'), reservationAllocationsBefore, 'no reservation allocations mutated');
    assert.equal(await count(workspaceId, 'external_records'), externalRecordsBefore, 'no external records mutated');
    assert.equal(await count(workspaceId, 'information_records'), informationRecordsBefore, 'no information records mutated');
    assert.equal(await count(workspaceId, 'command_receipts'), commandReceiptsBefore, 'no command receipts mutated');
  });

  test('step 2b: valid JSON but wrong kind → HTTP 400, zero mutation', async () => {
    const { workspaceId, app } = state;
    if (!workspaceId || !app) return;

    // Count before.
    const transportServicesBefore = await count(workspaceId, 'transport_services');
    const reservationsBefore = await count(workspaceId, 'reservations');
    const reservationLinesBefore = await count(workspaceId, 'reservation_lines');
    const reservationAllocationsBefore = await count(workspaceId, 'reservation_allocations');
    const externalRecordsBefore = await count(workspaceId, 'external_records');
    const informationRecordsBefore = await count(workspaceId, 'information_records');
    const commandReceiptsBefore = await count(workspaceId, 'command_receipts');

    // POST valid JSON but wrong kind.
    const wrongKindEvent = {
      kind: 'TRANSPORT_SCHEDULE_OBSERVED',
      someField: 'someValue',
    };
    const response = await callHandler(app, 'POST', '/api/v2/demo/provider-event/airline-rebooking', wrongKindEvent);
    assert.equal(response.status, 400, `wrong kind returns 400, got ${response.status}: ${response.body}`);

    const result = JSON.parse(response.body);
    assert.equal(result.code, 'VALIDATION_FAILED', `error code is VALIDATION_FAILED, got ${result.code}`);
    assert.ok(result.message.toLowerCase().includes('kind') || result.message.toLowerCase().includes('transport_service_cancelled_with_reprotection'), `message mentions kind or expected kind: ${result.message}`);

    // Verify zero mutation.
    assert.equal(await count(workspaceId, 'transport_services'), transportServicesBefore, 'no transport services mutated');
    assert.equal(await count(workspaceId, 'reservations'), reservationsBefore, 'no reservations mutated');
    assert.equal(await count(workspaceId, 'reservation_lines'), reservationLinesBefore, 'no reservation lines mutated');
    assert.equal(await count(workspaceId, 'reservation_allocations'), reservationAllocationsBefore, 'no reservation allocations mutated');
    assert.equal(await count(workspaceId, 'external_records'), externalRecordsBefore, 'no external records mutated');
    assert.equal(await count(workspaceId, 'information_records'), informationRecordsBefore, 'no information records mutated');
    assert.equal(await count(workspaceId, 'command_receipts'), commandReceiptsBefore, 'no command receipts mutated');
  });

  test('step 2c: valid direct event body → HTTP 202 status APPLIED', async () => {
    const { workspaceId, app, originalServiceExternalId } = state;
    if (!workspaceId || !app || !originalServiceExternalId) return;

    // Use the same event as the T2 test step 2.
    const event: TransportServiceCancelledWithReprotectionEvent = {
      kind: 'TRANSPORT_SERVICE_CANCELLED_WITH_REPROTECTION',
      providerId: 'sim-airline-id',
      providerEventId: 'sim-id-evt-20260921-cgk-001',
      receivedAt: '2026-09-21T01:40:00.000Z',
      disclosedAsSimulatedDemoInput: true,
      originalService: {
        recordType: 'SOURCE_TRANSPORT_SERVICE',
        externalId: originalServiceExternalId,
      },
      replacementService: {
        recordType: 'SOURCE_TRANSPORT_SERVICE',
        externalId: 'ID7153@2026-10-01T00:45:00.000Z',
        operator: 'ID',
        scheduledDeparture: '2026-10-01T07:45:00+07:00',
        scheduledArrival: '2026-10-01T10:30:00+08:00',
      },
      affectedBookings: [
        { recordType: 'SOURCE_BOOKING_REFERENCE', externalId: 'IDSYN14' },
        { recordType: 'SOURCE_BOOKING_REFERENCE', externalId: 'IDSYN03' },
        { recordType: 'SOURCE_BOOKING_REFERENCE', externalId: 'IDSYN10' },
        { recordType: 'SOURCE_BOOKING_REFERENCE', externalId: 'IDSYN11' },
        { recordType: 'SOURCE_BOOKING_REFERENCE', externalId: 'IDSYN30' },
      ],
      reason: 'Aircraft rotation constraint following network-wide disruption earlier in September.',
      provenanceKind: 'SCHEDULE_CHANGE',
    };

    const response = await callHandler(app, 'POST', '/api/v2/demo/provider-event/airline-rebooking', event);
    assert.equal(response.status, 202, `valid event returns 202, got ${response.status}: ${response.body}`);

    const result = JSON.parse(response.body);
    assert.equal(result.status, 'APPLIED', `ingress status is APPLIED, got ${result.status}`);
    assert.ok(result.ok === true || result.status === 'APPLIED', 'ingress succeeded');
  });

  test('step 2d: empty body with NORTHSTAR_DEMO_DISRUPTION_EVENT_FILE configured → HTTP 202 (file-driven path)', async () => {
    const { workspaceId, app } = state;
    if (!workspaceId || !app) return;

    // The env var was set in step 1 before composing the application.
    // POST with empty body (no chunks yielded).
    const response = await callHandler(app, 'POST', '/api/v2/demo/provider-event/airline-rebooking', undefined);
    assert.equal(response.status, 202, `empty body with env var configured returns 202, got ${response.status}: ${response.body}`);

    const result = JSON.parse(response.body);
    // The file-driven path should succeed (ALREADY_APPLIED since step 2c already applied the same event).
    assert.ok(result.status === 'APPLIED' || result.status === 'ALREADY_APPLIED', `status is APPLIED or ALREADY_APPLIED, got ${result.status}`);
  });
});

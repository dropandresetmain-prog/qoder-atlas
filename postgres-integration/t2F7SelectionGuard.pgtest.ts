/**
 * F7 — Selection Guard Tests
 *
 * Proves against real PostgreSQL that the selectedServiceId guard in
 * pgJourneyRepository correctly refuses non-TRANSPORT journey items and
 * correctly accepts TRANSPORT journey items.
 *
 * Tests:
 * a. Non-TRANSPORT journey item + selectedServiceId → throws error containing
 *    JOURNEY_ITEM_UPDATED_VALIDATION_FAILED; aggregate_heads revision unchanged;
 *    no new command_receipts row.
 * b. TRANSPORT journey item + selectedServiceId → ok; selected_service_id updated;
 *    journey revision advanced by 1; one new receipt row; scheduled_reassessments
 *    row enqueued.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { Pool } from '../src/persistence/postgres/pool.ts';
import { sharedTestPool } from './harness.ts';
import { loadDataset, type LoadedDataset } from '../src/app/demo/datasetLoader.ts';
import { provisionDataset } from '../src/app/demo/provisionDataset.ts';
import { resolveSourceSubjects, SOURCE_RECORD_TYPES } from '../src/app/demo/externalIdentity.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { updateJourneyItem } from '../src/persistence/postgres/commands/travelCommands.ts';
import { runBaselineEvaluation } from '../src/app/demo/baselineEvaluation.ts';

const BUNDLE_DIR = fileURLToPath(new URL('../fixtures/programmes/ait-summit-2026/', import.meta.url));
const ACTOR = 'principal:t2-f7-selection-guard-test';

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
  await pool.query('INSERT INTO workspaces (id, name) VALUES ($1, $2)', [workspaceId, `t2-f7:${workspaceId}`]);
  return workspaceId;
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
  connectionId: string;
  originalServiceId: string;
}

const state: Partial<TestState> = {};

// ---------------------------------------------------------------------------
// Ordered test steps.
// ---------------------------------------------------------------------------

describe('F7 selection guard', () => {
  test('step 1: provision workspace and run baseline evaluation', async () => {
    const workspaceId = await freshWorkspace();
    state.workspaceId = workspaceId;

    const outcome = await provisionDataset({ pool, workspaceId, actorPrincipalId: ACTOR, dataset });
    assert.equal(outcome.status, 'MATERIALIZED');
    if (outcome.status !== 'MATERIALIZED') return;

    const connectionResult = await pool.query<{ connection_id: string }>(
      `SELECT DISTINCT connection_id FROM external_records WHERE workspace_id = $1 LIMIT 1`,
      [workspaceId],
    );
    assert.equal(connectionResult.rowCount, 1, 'exactly one provisioning connection');
    state.connectionId = connectionResult.rows[0]!.connection_id;

    const mapping = await resolveSourceSubjects(pool, workspaceId, state.connectionId);
    const originalServiceExternalId = 'ID7159@2026-09-30T10:45:00.000Z';
    const originalServiceMapping = mapping.get(`${SOURCE_RECORD_TYPES.TRANSPORT_SERVICE}:${originalServiceExternalId}`);
    assert.ok(originalServiceMapping, `original service ${originalServiceExternalId} resolves`);
    state.originalServiceId = originalServiceMapping.subject.id;

    // Run baseline evaluation to create assessment_inputs rows.
    // The reassessment trigger only enqueues when assessment_inputs exist.
    const baseline = await runBaselineEvaluation({ pool, workspaceId, actorPrincipalId: ACTOR });
    assert.ok(baseline.evaluated > 0, 'baseline evaluation assessed at least one journey');
  });

  test('step 2a: non-TRANSPORT journey item + selectedServiceId → throws JOURNEY_ITEM_UPDATED_VALIDATION_FAILED, revision unchanged, no receipt', async () => {
    const { workspaceId, originalServiceId } = state;
    if (!workspaceId || !originalServiceId) return;

    // Find a non-TRANSPORT journey item (STAY or ENGAGEMENT).
    const nonTransportItem = await pool.query<{
      id: string;
      journey_id: string;
      kind: string;
    }>(
      `SELECT i.id, i.journey_id, i.kind
       FROM journey_items i
       WHERE i.workspace_id = $1 AND i.kind <> 'TRANSPORT'
       LIMIT 1`,
      [workspaceId],
    );
    assert.ok(nonTransportItem.rowCount! > 0, 'at least one non-TRANSPORT journey item exists');
    const item = nonTransportItem.rows[0]!;
    assert.ok(['STAY', 'ENGAGEMENT', 'RESOURCE_USE'].includes(item.kind), `item kind is non-TRANSPORT: ${item.kind}`);

    // Read the journey's current revision.
    const revisionBefore = await pool.query<{ revision: string }>(
      `SELECT revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2`,
      [workspaceId, item.journey_id],
    );
    assert.equal(revisionBefore.rowCount, 1, 'journey aggregate head exists');
    const revisionBeforeNum = Number(revisionBefore.rows[0]!.revision);

    // Count command_receipts before.
    const receiptsBefore = await count(workspaceId, 'command_receipts');

    // Attempt to update the non-TRANSPORT item with selectedServiceId.
    const uow = new PgUnitOfWork(pool, workspaceId);
    const idempotencyKey = `f7-test-non-transport-${item.id}`;

    let thrownError: Error | undefined;
    try {
      await updateJourneyItem(uow, {
        workspaceId,
        actorPrincipalId: ACTOR,
        idempotencyKey,
        journeyId: item.journey_id,
        journeyItemId: item.id,
        expectedRevision: revisionBeforeNum,
        selectedServiceId: originalServiceId,
      });
    } catch (error) {
      thrownError = error instanceof Error ? error : new Error(String(error));
    }

    // Assert the error was thrown and contains the expected message.
    assert.ok(thrownError, 'updateJourneyItem should throw for non-TRANSPORT item with selectedServiceId');
    assert.ok(
      thrownError!.message.includes('JOURNEY_ITEM_UPDATED_VALIDATION_FAILED'),
      `error message contains JOURNEY_ITEM_UPDATED_VALIDATION_FAILED: ${thrownError!.message}`,
    );
    assert.ok(
      thrownError!.message.includes('selectedServiceId is only valid on TRANSPORT'),
      `error message mentions selectedServiceId guard: ${thrownError!.message}`,
    );

    // Verify the journey's aggregate_heads revision is UNCHANGED.
    const revisionAfter = await pool.query<{ revision: string }>(
      `SELECT revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2`,
      [workspaceId, item.journey_id],
    );
    const revisionAfterNum = Number(revisionAfter.rows[0]!.revision);
    assert.equal(revisionAfterNum, revisionBeforeNum, 'journey revision is unchanged after failed update');

    // Verify no new command_receipts row for this idempotency key.
    const receiptCheck = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM command_receipts WHERE workspace_id = $1 AND idempotency_key = $2`,
      [workspaceId, idempotencyKey],
    );
    assert.equal(Number(receiptCheck.rows[0]!.n), 0, 'no command_receipts row for the failed idempotency key');

    // Also verify total command_receipts count is unchanged.
    const receiptsAfter = await count(workspaceId, 'command_receipts');
    assert.equal(receiptsAfter, receiptsBefore, 'total command_receipts count unchanged');
  });

  test('step 2b: TRANSPORT journey item + selectedServiceId → ok, selected_service_id updated, revision +1, receipt exists, reassessment enqueued', async () => {
    const { workspaceId, originalServiceId } = state;
    if (!workspaceId || !originalServiceId) return;

    // Find a TRANSPORT journey item with a confirmed allocation.
    // Use the same approach as the T2 test: find journey_items kind='TRANSPORT'
    // joined to allocations.
    const transportItem = await pool.query<{
      id: string;
      journey_id: string;
      selected_service_id: string | null;
    }>(
      `SELECT DISTINCT i.id, i.journey_id, tr.selected_service_id
       FROM journey_items i
       JOIN transport_item_details tr ON tr.workspace_id = i.workspace_id AND tr.journey_item_id = i.id
       JOIN reservation_allocations ra ON ra.workspace_id = i.workspace_id AND ra.journey_item_id = i.id
       WHERE i.workspace_id = $1 AND i.kind = 'TRANSPORT'
       LIMIT 1`,
      [workspaceId],
    );
    assert.ok(transportItem.rowCount! > 0, 'at least one TRANSPORT journey item with allocation exists');
    const item = transportItem.rows[0]!;

    // Read the journey's current revision.
    const revisionBefore = await pool.query<{ revision: string }>(
      `SELECT revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2`,
      [workspaceId, item.journey_id],
    );
    assert.equal(revisionBefore.rowCount, 1, 'journey aggregate head exists');
    const revisionBeforeNum = Number(revisionBefore.rows[0]!.revision);

    // Count command_receipts and scheduled_reassessments before.
    const receiptsBefore = await count(workspaceId, 'command_receipts');
    const reassessmentsBefore = await count(workspaceId, 'scheduled_reassessments');

    // Use a different service id than the current one (or the original service id
    // if the item has no selected service yet). We use the original service id
    // which is a valid transport service in this workspace.
    const serviceIdToSelect = originalServiceId;

    // Call updateJourneyItem.
    const uow = new PgUnitOfWork(pool, workspaceId);
    const idempotencyKey = `f7-test-transport-${item.id}`;

    const outcome = await updateJourneyItem(uow, {
      workspaceId,
      actorPrincipalId: ACTOR,
      idempotencyKey,
      journeyId: item.journey_id,
      journeyItemId: item.id,
      expectedRevision: revisionBeforeNum,
      selectedServiceId: serviceIdToSelect,
    });

    // Assert outcome is ok.
    assert.ok(outcome.ok, `updateJourneyItem should succeed for TRANSPORT item, got: ${JSON.stringify(outcome)}`);
    if (!outcome.ok) return;

    // Assert transport_item_details.selected_service_id now equals the service.
    const detailAfter = await pool.query<{ selected_service_id: string }>(
      `SELECT selected_service_id FROM transport_item_details WHERE workspace_id = $1 AND journey_item_id = $2`,
      [workspaceId, item.id],
    );
    assert.equal(detailAfter.rowCount, 1, 'transport_item_details row exists');
    assert.equal(detailAfter.rows[0]!.selected_service_id, serviceIdToSelect, 'selected_service_id updated');

    // Assert journey revision advanced by exactly 1.
    const revisionAfter = await pool.query<{ revision: string }>(
      `SELECT revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2`,
      [workspaceId, item.journey_id],
    );
    const revisionAfterNum = Number(revisionAfter.rows[0]!.revision);
    assert.equal(revisionAfterNum, revisionBeforeNum + 1, `journey revision advanced by exactly 1 (${revisionBeforeNum} → ${revisionAfterNum})`);

    // Assert one new command_receipts row exists for this idempotency key.
    const receiptsAfter = await count(workspaceId, 'command_receipts');
    assert.equal(receiptsAfter, receiptsBefore + 1, 'exactly one new command_receipts row');

    const receiptCheck = await pool.query<{ command_namespace: string; idempotency_key: string }>(
      `SELECT command_namespace, idempotency_key FROM command_receipts WHERE workspace_id = $1 AND idempotency_key = $2`,
      [workspaceId, idempotencyKey],
    );
    assert.equal(receiptCheck.rowCount, 1, 'command_receipts row exists for the idempotency key');
    assert.equal(receiptCheck.rows[0]!.command_namespace, 'JOURNEY_ITEM_UPDATED', 'receipt command namespace is JOURNEY_ITEM_UPDATED');

    // Assert a scheduled_reassessments row was enqueued for this journey.
    const reassessmentsAfter = await count(workspaceId, 'scheduled_reassessments');
    assert.ok(reassessmentsAfter > reassessmentsBefore, 'scheduled_reassessments count increased');

    const reassessmentCheck = await pool.query<{ id: string; state: string; reason: string }>(
      `SELECT id, state, reason FROM scheduled_reassessments
       WHERE workspace_id = $1 AND subject_kind = 'JOURNEY' AND subject_id = $2 AND assessment_kind = 'VIABILITY'`,
      [workspaceId, item.journey_id],
    );
    assert.ok(reassessmentCheck.rowCount! > 0, 'scheduled_reassessment exists for the journey');
    const reassessment = reassessmentCheck.rows[0]!;
    assert.equal(reassessment.reason, 'INPUT_CHANGED', 'reassessment reason is INPUT_CHANGED');
    assert.ok(['PENDING', 'CLAIMED', 'DONE'].includes(reassessment.state), `reassessment state is valid: ${reassessment.state}`);
  });
});

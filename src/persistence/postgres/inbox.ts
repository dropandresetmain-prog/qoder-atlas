/**
 * Inbox delivery ingestion (0007): capture + resumable per-target work
 * creation in one transaction. Not part of `PgUnitOfWork.execute` — an
 * inbound delivery is not itself a domain command (DATA_STRUCTURE_LOGICAL_SCHEMA.md
 * §8's inbox/outbox live alongside domain commands, not inside their
 * transaction protocol).
 */
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';

export function deliveryPayloadHash(rawPayload: unknown): string {
  return createHash('sha256').update(JSON.stringify(rawPayload), 'utf8').digest('hex');
}

export type DeliverInboxMessageResult =
  | { outcome: 'ACCEPTED'; deliveryId: string; workItemIds: string[] }
  | { outcome: 'DUPLICATE'; deliveryId: string }
  | { outcome: 'QUARANTINED_CONFLICT'; originalDeliveryId: string; conflictId: string };

export async function deliverInboxMessage(
  pool: Pool,
  params: {
    workspaceId: string;
    sourceConnectionId: string;
    deliveryKey: string;
    rawPayload: unknown;
    sourceRef?: string;
    /** Handler/target pairs to enqueue resumable work for, in the SAME transaction as the capture. */
    handlers: { handlerKey: string; targetKey: string }[];
  },
): Promise<DeliverInboxMessageResult> {
  const payloadHash = deliveryPayloadHash(params.rawPayload);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO inbox_deliveries (workspace_id, source_connection_id, delivery_key, payload_hash, source_ref, raw_payload)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (workspace_id, source_connection_id, delivery_key) DO NOTHING
       RETURNING id`,
      [params.workspaceId, params.sourceConnectionId, params.deliveryKey, payloadHash, params.sourceRef ?? null, JSON.stringify(params.rawPayload)],
    );

    if (inserted.rows[0]) {
      const deliveryId = inserted.rows[0].id;
      const workItemIds: string[] = [];
      for (const handler of params.handlers) {
        const workRow = await client.query<{ id: string }>(
          `INSERT INTO inbox_work (workspace_id, delivery_id, handler_key, target_key)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (delivery_id, handler_key, target_key) DO NOTHING
           RETURNING id`,
          [params.workspaceId, deliveryId, handler.handlerKey, handler.targetKey],
        );
        if (workRow.rows[0]) workItemIds.push(workRow.rows[0].id);
      }
      await client.query('COMMIT');
      return { outcome: 'ACCEPTED', deliveryId, workItemIds };
    }

    // Row already exists — distinguish idempotent duplicate from a genuine conflict.
    const existing = await client.query<{ id: string; payload_hash: string }>(
      `SELECT id, payload_hash FROM inbox_deliveries
       WHERE workspace_id = $1 AND source_connection_id = $2 AND delivery_key = $3`,
      [params.workspaceId, params.sourceConnectionId, params.deliveryKey],
    );
    const existingRow = existing.rows[0];
    if (!existingRow) throw new Error('inbox_deliveries row disappeared within its own transaction');

    if (existingRow.payload_hash === payloadHash) {
      await client.query('COMMIT');
      return { outcome: 'DUPLICATE', deliveryId: existingRow.id };
    }

    const conflict = await client.query<{ id: string }>(
      `INSERT INTO inbox_delivery_conflicts (workspace_id, original_delivery_id, conflicting_payload_hash, conflicting_raw_payload)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [params.workspaceId, existingRow.id, payloadHash, JSON.stringify(params.rawPayload)],
    );
    await client.query('COMMIT');
    const conflictId = conflict.rows[0]?.id;
    if (!conflictId) throw new Error('inbox_delivery_conflicts insert returned no id');
    return { outcome: 'QUARANTINED_CONFLICT', originalDeliveryId: existingRow.id, conflictId };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

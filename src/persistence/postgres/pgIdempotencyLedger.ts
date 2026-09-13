/**
 * PostgreSQL implementation of `IdempotencyLedger`
 * (src/contracts/v2/command/unitOfWork.ts) over `command_receipts`
 * (migration 0004). Must run inside an active UnitOfWork transaction: the
 * caller (`PgUnitOfWork.execute`) has already taken
 * `pg_advisory_xact_lock(idempotencyLockKey(...))` for this exact
 * (workspace, namespace, key) tuple, so the SELECT below cannot race with
 * another transaction claiming the same key.
 */
import type { IdempotencyLedger } from '../../contracts/v2/command/unitOfWork.ts';
import type { CommandReceipt } from '../../contracts/v2/command/domainCommand.ts';
import { currentTransactionClient } from './transactionContext.ts';

interface ReceiptRow {
  workspace_id: string;
  command_namespace: string;
  idempotency_key: string;
  payload_hash: string;
  result_ref: string;
  committed_revisions: unknown;
  committed_at: string;
}

function toCommandReceipt(row: ReceiptRow): CommandReceipt {
  return {
    workspaceId: row.workspace_id,
    commandNamespace: row.command_namespace,
    idempotencyKey: row.idempotency_key,
    payloadHash: row.payload_hash,
    resultRef: row.result_ref,
    committedRevisions: row.committed_revisions as CommandReceipt['committedRevisions'],
    committedAt: new Date(row.committed_at).toISOString(),
  };
}

export class PgIdempotencyLedger implements IdempotencyLedger {
  async claim(
    workspaceId: string,
    commandNamespace: string,
    idempotencyKey: string,
    payloadHash: string,
  ): Promise<{ outcome: 'NEW' } | { outcome: 'REPLAY'; receipt: CommandReceipt } | { outcome: 'HASH_MISMATCH' }> {
    const client = currentTransactionClient();
    const result = await client.query<ReceiptRow>(
      `SELECT workspace_id, command_namespace, idempotency_key, payload_hash, result_ref, committed_revisions, committed_at
       FROM command_receipts
       WHERE workspace_id = $1 AND command_namespace = $2 AND idempotency_key = $3`,
      [workspaceId, commandNamespace, idempotencyKey],
    );
    const row = result.rows[0];
    if (!row) return { outcome: 'NEW' };
    if (row.payload_hash !== payloadHash) return { outcome: 'HASH_MISMATCH' };
    return { outcome: 'REPLAY', receipt: toCommandReceipt(row) };
  }
}

/** Inserts the immutable receipt once a command has committed its domain writes. */
export async function insertCommandReceipt(receipt: CommandReceipt): Promise<void> {
  const client = currentTransactionClient();
  await client.query(
    `INSERT INTO command_receipts
       (workspace_id, command_namespace, idempotency_key, payload_hash, result_ref, committed_revisions, committed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      receipt.workspaceId,
      receipt.commandNamespace,
      receipt.idempotencyKey,
      receipt.payloadHash,
      receipt.resultRef,
      JSON.stringify(receipt.committedRevisions),
      receipt.committedAt,
    ],
  );
}

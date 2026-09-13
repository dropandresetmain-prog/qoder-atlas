/**
 * Claim/lease/fencing primitives shared by `inbox_work` (0007) and `outbox`
 * (0008). Workers run their own short-lived transactions per claim — this is
 * deliberately NOT part of `PgUnitOfWork.execute` (worker claim/complete
 * cycles are not domain commands and must not hold a domain-command
 * transaction open across a handler dispatch).
 *
 * `FOR UPDATE SKIP LOCKED` is the standard safe pattern for two independent
 * workers competing for the same runnable-work queue: at most one concurrent
 * claimant can win a given row, and a second worker skips rows already
 * locked by another in-flight claim rather than blocking on them.
 *
 * Reclaiming an expired lease is folded into the SAME claim query (the
 * `state = 'CLAIMED' AND lease_expires_at < now()` branch): claiming an
 * expired-lease row bumps `fencing_token`, so a stale worker's later
 * `complete*`/`fail*` call — which must present the fencing_token it was
 * originally handed — matches zero rows and is refused. That is the fencing
 * guarantee: a stale worker cannot commit as the current owner.
 */
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

export interface ClaimedInboxWork {
  id: string;
  workspaceId: string;
  deliveryId: string;
  handlerKey: string;
  targetKey: string;
  attempts: number;
  claimToken: string;
  fencingToken: number;
  leaseExpiresAt: string;
}

interface InboxWorkRow {
  id: string;
  workspace_id: string;
  delivery_id: string;
  handler_key: string;
  target_key: string;
  attempts: number;
  claim_token: string;
  fencing_token: string;
  lease_expires_at: string;
}

function toClaimedInboxWork(row: InboxWorkRow): ClaimedInboxWork {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    deliveryId: row.delivery_id,
    handlerKey: row.handler_key,
    targetKey: row.target_key,
    attempts: row.attempts,
    claimToken: row.claim_token,
    fencingToken: Number(row.fencing_token),
    leaseExpiresAt: row.lease_expires_at,
  };
}

export async function claimNextInboxWork(pool: Pool, leaseSeconds = 30): Promise<ClaimedInboxWork | undefined> {
  const claimToken = randomUUID();
  const result = await pool.query<InboxWorkRow>(
    `UPDATE inbox_work
     SET state = 'CLAIMED', claim_token = $1, fencing_token = fencing_token + 1,
         lease_expires_at = now() + ($2 * interval '1 second'), attempts = attempts + 1, updated_at = now()
     WHERE id = (
       SELECT id FROM inbox_work
       WHERE (state = 'PENDING' AND next_run_at <= now())
          OR (state = 'CLAIMED' AND lease_expires_at < now())
       ORDER BY next_run_at
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     RETURNING id, workspace_id, delivery_id, handler_key, target_key, attempts, claim_token, fencing_token, lease_expires_at`,
    [claimToken, leaseSeconds],
  );
  const row = result.rows[0];
  return row ? toClaimedInboxWork(row) : undefined;
}

/** Returns `false` if the claim was fenced out (lease expired and reclaimed by another worker). */
export async function completeInboxWork(
  pool: Pool,
  work: Pick<ClaimedInboxWork, 'id' | 'claimToken' | 'fencingToken'>,
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE inbox_work SET state = 'DONE', updated_at = now()
     WHERE id = $1 AND claim_token = $2 AND fencing_token = $3 AND state = 'CLAIMED'`,
    [work.id, work.claimToken, work.fencingToken],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Returns `false` if the claim was fenced out. On success, the row returns to PENDING for a bounded retry. */
export async function failInboxWork(
  pool: Pool,
  work: Pick<ClaimedInboxWork, 'id' | 'claimToken' | 'fencingToken'>,
  errorMessage: string,
  retryDelaySeconds = 5,
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE inbox_work
     SET state = 'PENDING', next_run_at = now() + ($4 * interval '1 second'), last_error = $5, updated_at = now()
     WHERE id = $1 AND claim_token = $2 AND fencing_token = $3 AND state = 'CLAIMED'`,
    [work.id, work.claimToken, work.fencingToken, retryDelaySeconds, errorMessage],
  );
  return (result.rowCount ?? 0) > 0;
}

export interface ClaimedOutboxRow {
  id: string;
  workspaceId: string;
  subjectKind: string;
  subjectId: string;
  destinationKind: string;
  payload: unknown;
  claimToken: string;
  fencingToken: number;
}

interface OutboxRow {
  id: string;
  workspace_id: string;
  subject_kind: string;
  subject_id: string;
  destination_kind: string;
  payload: unknown;
  claim_token: string;
  fencing_token: string;
}

function toClaimedOutboxRow(row: OutboxRow): ClaimedOutboxRow {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    subjectKind: row.subject_kind,
    subjectId: row.subject_id,
    destinationKind: row.destination_kind,
    payload: row.payload,
    claimToken: row.claim_token,
    fencingToken: Number(row.fencing_token),
  };
}

export async function claimNextOutboxRow(pool: Pool, leaseSeconds = 30): Promise<ClaimedOutboxRow | undefined> {
  const claimToken = randomUUID();
  const result = await pool.query<OutboxRow>(
    `UPDATE outbox
     SET state = 'CLAIMED', claim_token = $1, fencing_token = fencing_token + 1,
         lease_expires_at = now() + ($2 * interval '1 second'), attempts = attempts + 1
     WHERE id = (
       SELECT id FROM outbox
       WHERE (state = 'PENDING')
          OR (state = 'CLAIMED' AND lease_expires_at < now())
       ORDER BY created_at
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     RETURNING id, workspace_id, subject_kind, subject_id, destination_kind, payload, claim_token, fencing_token`,
    [claimToken, leaseSeconds],
  );
  const row = result.rows[0];
  return row ? toClaimedOutboxRow(row) : undefined;
}

export async function markOutboxPublished(
  pool: Pool,
  work: Pick<ClaimedOutboxRow, 'id' | 'claimToken' | 'fencingToken'>,
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE outbox SET state = 'PUBLISHED', published_at = now()
     WHERE id = $1 AND claim_token = $2 AND fencing_token = $3 AND state = 'CLAIMED'`,
    [work.id, work.claimToken, work.fencingToken],
  );
  return (result.rowCount ?? 0) > 0;
}

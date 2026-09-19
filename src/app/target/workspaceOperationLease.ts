/**
 * One workspace-wide PostgreSQL lease for operations that must not overlap
 * with consequential provider dispatch. The checked-out session owns the
 * advisory lock, while callers remain free to use normal short-lived queries
 * and never hold a SQL transaction across network work.
 */
import type { Pool, PoolClient } from '../../persistence/postgres/pool.ts';

const LEASE_NAMESPACE = 'northstar:workspace-operation';

export interface WorkspaceOperationLease {
  readonly client: PoolClient;
  release(): Promise<void>;
}

/**
 * Attempts to reserve one workspace for a reset or a whole external
 * dispatch/reconciliation cycle. `undefined` means another process owns it.
 */
export async function tryAcquireWorkspaceOperationLease(
  pool: Pool,
  workspaceId: string,
): Promise<WorkspaceOperationLease | undefined> {
  const client = await pool.connect();
  let held = false;
  try {
    const result = await client.query<{ ok: boolean }>(
      `SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS ok`,
      [LEASE_NAMESPACE, workspaceId],
    );
    held = result.rows[0]?.ok === true;
    if (!held) {
      client.release();
      return undefined;
    }
    return {
      client,
      async release() {
        try {
          await client.query(`SELECT pg_advisory_unlock(hashtext($1), hashtext($2))`, [LEASE_NAMESPACE, workspaceId]);
        } finally {
          client.release();
        }
      },
    };
  } catch (error) {
    if (held) {
      await client.query(`SELECT pg_advisory_unlock(hashtext($1), hashtext($2))`, [LEASE_NAMESPACE, workspaceId]).catch(() => undefined);
    }
    client.release();
    throw error;
  }
}

/**
 * PostgreSQL implementation of `AggregateHeadReader`
 * (src/contracts/v2/command/unitOfWork.ts) over `aggregate_heads`
 * (migration 0003).
 *
 * Design note: neither `TypedRef` nor `AggregateHeadReader.loadHead`/
 * `lockHeads` carry a `workspaceId` parameter in the frozen C0 contract, so a
 * reader instance is scoped to exactly one workspace at construction time
 * (the same workspace the owning `PgUnitOfWork` is bound to) rather than
 * taking workspace as a per-call argument — a construction-time choice, not
 * a change to the interface's semantics.
 */
import type { Pool } from 'pg';
import type { AggregateHeadReader } from '../../contracts/v2/command/unitOfWork.ts';
import type { RootRevision, TypedRef } from '../../domain/v2/shared/identity.ts';
import { currentTransactionClient } from './transactionContext.ts';

interface HeadRow {
  aggregate_id: string;
  revision: string; // bigint comes back as string from node-postgres
}

export class PgAggregateHeadReader implements AggregateHeadReader {
  private readonly pool: Pool;
  private readonly workspaceId: string;

  constructor(pool: Pool, workspaceId: string) {
    this.pool = pool;
    this.workspaceId = workspaceId;
  }

  /** Read-only snapshot read outside any transaction. */
  async loadHead(ref: TypedRef): Promise<RootRevision | undefined> {
    const result = await this.pool.query<HeadRow>(
      'SELECT aggregate_id, revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2',
      [this.workspaceId, ref.id],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return { aggregateRef: ref, revision: Number(row.revision) };
  }

  /**
   * Locks the given roots in ascending `aggregate_id` order — a stable order
   * shared by every caller — to avoid deadlocks between concurrent commands
   * touching overlapping sets of aggregates. Must run inside an active
   * UnitOfWork transaction (`currentTransactionClient()`).
   */
  async lockHeads(refs: TypedRef[]): Promise<RootRevision[]> {
    if (refs.length === 0) return [];
    const client = currentTransactionClient();
    const ids = [...new Set(refs.map((r) => r.id))].sort();
    const result = await client.query<HeadRow>(
      `SELECT aggregate_id, revision FROM aggregate_heads
       WHERE workspace_id = $1 AND aggregate_id = ANY($2::uuid[])
       ORDER BY aggregate_id
       FOR UPDATE`,
      [this.workspaceId, ids],
    );
    const byId = new Map(result.rows.map((row) => [row.aggregate_id, Number(row.revision)]));
    const out: RootRevision[] = [];
    for (const ref of refs) {
      const revision = byId.get(ref.id);
      if (revision !== undefined) out.push({ aggregateRef: ref, revision });
    }
    return out;
  }
}

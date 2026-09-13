/**
 * PostgreSQL implementation of `ScopeGenerationLedger`
 * (src/contracts/v2/command/unitOfWork.ts) over `scope_generations`
 * (migration 0006). Workspace-bound at construction — see
 * pgAggregateHeadReader.ts's design note; `ScopeGenerationRef` carries no
 * workspaceId either.
 *
 * `advance` relies entirely on the enclosing `PgUnitOfWork.execute`
 * transaction running at SERIALIZABLE with bounded whole-transaction retry
 * (docs/work/ACTIVE_TASK.md decision #5): a genuine predicate conflict
 * between two concurrent `advance` calls on the same scope surfaces here as
 * a `40001 serialization_failure`, which this method does NOT catch — a
 * single already-aborted SERIALIZABLE transaction cannot retry one
 * statement in isolation, only the whole transaction can be restarted, which
 * is `execute`'s job.
 */
import type { ScopeGenerationLedger } from '../../contracts/v2/command/unitOfWork.ts';
import type { ScopeGenerationRef } from '../../domain/v2/shared/identity.ts';
import { currentTransactionClient } from './transactionContext.ts';

type ScopeRef = Pick<ScopeGenerationRef, 'scopeKind' | 'scopeId'>;

export class PgScopeGenerationLedger implements ScopeGenerationLedger {
  private readonly workspaceId: string;

  constructor(workspaceId: string) {
    this.workspaceId = workspaceId;
  }

  async currentGeneration(ref: ScopeRef): Promise<number> {
    const client = currentTransactionClient();
    const result = await client.query<{ generation: string }>(
      'SELECT generation FROM scope_generations WHERE workspace_id = $1 AND scope_kind = $2 AND scope_id = $3',
      [this.workspaceId, ref.scopeKind, ref.scopeId],
    );
    return result.rows[0] ? Number(result.rows[0].generation) : 0;
  }

  async advance(ref: ScopeRef): Promise<number> {
    const client = currentTransactionClient();
    const result = await client.query<{ generation: string }>(
      `INSERT INTO scope_generations (workspace_id, scope_kind, scope_id, generation, updated_at)
       VALUES ($1, $2, $3, 1, now())
       ON CONFLICT (workspace_id, scope_kind, scope_id)
       DO UPDATE SET generation = scope_generations.generation + 1, updated_at = now()
       RETURNING generation`,
      [this.workspaceId, ref.scopeKind, ref.scopeId],
    );
    const row = result.rows[0];
    if (!row) throw new Error('scope_generations upsert returned no row');
    return Number(row.generation);
  }
}

/**
 * Read-only snapshot version outside any transaction (e.g. for a WorldSnapshot
 * manifest read at REPEATABLE READ — see DATA_STRUCTURE_LOGICAL_SCHEMA.md §11.2).
 */
export async function readScopeGenerationSnapshot(
  pool: import('pg').Pool,
  workspaceId: string,
  ref: ScopeRef,
): Promise<number> {
  const result = await pool.query<{ generation: string }>(
    'SELECT generation FROM scope_generations WHERE workspace_id = $1 AND scope_kind = $2 AND scope_id = $3',
    [workspaceId, ref.scopeKind, ref.scopeId],
  );
  return result.rows[0] ? Number(result.rows[0].generation) : 0;
}

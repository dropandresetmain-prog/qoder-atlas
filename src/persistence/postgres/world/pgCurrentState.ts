/**
 * PostgreSQL `CurrentStateReader` (src/resolution/world/currentness.ts) and the
 * capture composition that binds a read session to the world reader.
 */
import type { Pool } from 'pg';
import type { WorldSnapshotManifest } from '../../../contracts/v2/scope/readScope.ts';
import type { CurrentState, CurrentStateReader } from '../../../resolution/world/currentness.ts';
import type { CapturedWorld } from '../../../resolution/world/world.ts';
import { PgReadSessionFactory } from './pgReadSession.ts';
import { PgWorldReader, type WorldCaptureRequest } from './pgWorldReader.ts';

export class PgCurrentStateReader implements CurrentStateReader {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async loadFor(workspaceId: string, manifest: WorldSnapshotManifest): Promise<CurrentState> {
    const aggregateIds = [...new Set(manifest.aggregateReads.map((r) => r.aggregateRef.id))];
    const client = await this.pool.connect();
    try {
      // Heads and generations from one snapshot, so a concurrent write cannot split them.
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const heads = await client.query<{ kind: string; id: string; revision: string }>(
        `SELECT ds.kind, h.aggregate_id AS id, h.revision
           FROM aggregate_heads h JOIN domain_subjects ds ON ds.workspace_id = h.workspace_id AND ds.id = h.aggregate_id
          WHERE h.workspace_id = $1 AND h.aggregate_id = ANY($2::uuid[])`,
        [workspaceId, aggregateIds],
      );
      const scopes = await client.query<{ scope_kind: string; scope_id: string; generation: string }>(
        `SELECT scope_kind, scope_id, generation FROM scope_generations
          WHERE workspace_id = $1 AND (scope_kind, scope_id) IN (SELECT * FROM unnest($2::text[], $3::text[]))`,
        [workspaceId, manifest.scopeReads.map((s) => s.scopeKind), manifest.scopeReads.map((s) => s.scopeId)],
      );
      await client.query('COMMIT');
      return {
        heads: new Map(heads.rows.map((row) => [`${row.kind}:${row.id}`, Number(row.revision)])),
        scopes: new Map(scopes.rows.map((row) => [`${row.scope_kind}:${row.scope_id}`, Number(row.generation)])),
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

/** Captures one consistent world slice: a read session wrapped around the world reader. */
export async function captureWorld(pool: Pool, request: WorldCaptureRequest): Promise<CapturedWorld> {
  return new PgReadSessionFactory(pool).withReadSession(request.workspaceId, (session) => new PgWorldReader().capture(session, request));
}

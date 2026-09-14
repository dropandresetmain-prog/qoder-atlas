/**
 * PostgreSQL `ReadSessionFactory` (src/resolution/world/readSession.ts).
 *
 * One pooled connection, `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`:
 * every statement in the session sees the snapshot taken by its first query,
 * and PostgreSQL rejects any write (`25006 read_only_sql_transaction`). This is
 * deliberately not `PgUnitOfWork.execute`: no idempotency claim, no head locks,
 * no SERIALIZABLE retry loop, no receipt. Evaluation runs after the session
 * ends, over the immutable captured slice (DATA_STRUCTURE_LOGICAL_SCHEMA.md
 * §11.2: "Evaluation can run outside the read transaction").
 */
import type { Pool, PoolClient } from 'pg';
import type { RootRevision, ScopeGenerationRef, SubjectKind, TypedRef } from '../../../domain/v2/shared/identity.ts';
import type { CoverageRecord, MissingCoverage } from '../../../contracts/v2/scope/readScope.ts';
import type { ManifestRecorder, ReadSession, ReadSessionFactory, ReadSessionInfo, ReadQueryable } from '../../../resolution/world/readSession.ts';

export class ManifestAccumulator implements ManifestRecorder {
  private readonly aggregates = new Map<string, RootRevision>();
  private readonly scopes = new Map<string, ScopeGenerationRef>();
  private readonly evidenceIds = new Set<string>();
  private readonly coverageByKey = new Map<string, CoverageRecord>();
  private readonly missingByKey = new Map<string, MissingCoverage>();

  aggregate(read: RootRevision): void {
    this.aggregates.set(`${read.aggregateRef.kind}:${read.aggregateRef.id}`, read);
  }
  scope(read: ScopeGenerationRef): void {
    this.scopes.set(`${read.scopeKind}:${read.scopeId}`, read);
  }
  evidence(id: string): void {
    this.evidenceIds.add(id);
  }
  coverage(read: CoverageRecord): void {
    this.coverageByKey.set(`${read.readerId}|${read.queryBoundsDescription}`, read);
  }
  missing(missing: MissingCoverage): void {
    const subject = missing.subjectRef ? `${missing.subjectRef.kind}:${missing.subjectRef.id}` : '';
    this.missingByKey.set(`${subject}|${missing.scopeDescription}|${missing.reason}`, missing);
  }

  /** Deterministically ordered snapshot of everything recorded. */
  toManifestParts() {
    const byKey = <T>(map: Map<string, T>) => [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
    return {
      aggregateReads: byKey(this.aggregates),
      scopeReads: byKey(this.scopes),
      evidenceReads: [...this.evidenceIds].sort(),
      coverageReads: byKey(this.coverageByKey),
      missingCoverage: byKey(this.missingByKey),
    };
  }
}

class PgReadSession implements ReadSession {
  readonly manifest = new ManifestAccumulator();
  readonly info: ReadSessionInfo;
  readonly db: ReadQueryable;
  private readonly client: PoolClient;

  constructor(client: PoolClient, info: ReadSessionInfo) {
    this.client = client;
    this.info = info;
    this.db = client as unknown as ReadQueryable;
  }

  manifestParts() {
    return this.manifest.toManifestParts();
  }

  async recordAggregates(refs: TypedRef[]): Promise<RootRevision[]> {
    const ids = [...new Set(refs.map((ref) => ref.id))];
    if (ids.length === 0) return [];
    const result = await this.client.query<{ id: string; kind: string; root_id: string; root_kind: string; revision: string }>(
      `SELECT ds.id, ds.kind, root.id AS root_id, root.kind AS root_kind, h.revision
         FROM domain_subjects ds
         JOIN domain_subjects root ON root.workspace_id = ds.workspace_id AND root.id = ds.aggregate_id
         JOIN aggregate_heads h ON h.workspace_id = ds.workspace_id AND h.aggregate_id = ds.aggregate_id
        WHERE ds.workspace_id = $1 AND ds.id = ANY($2::uuid[])`,
      [this.info.workspaceId, ids],
    );
    const found = new Map(result.rows.map((row) => [`${row.kind}:${row.id}`, row]));
    const reads: RootRevision[] = [];
    for (const ref of refs) {
      const row = found.get(`${ref.kind}:${ref.id}`);
      if (!row) {
        this.manifest.missing({ subjectRef: ref, scopeDescription: 'aggregate head for a referenced subject', reason: 'SOURCE_INCOMPLETE' });
        continue;
      }
      const read: RootRevision = { aggregateRef: { kind: row.root_kind as SubjectKind, id: row.root_id }, revision: Number(row.revision) };
      this.manifest.aggregate(read);
      reads.push(read);
    }
    return reads;
  }

  async recordScopes(scopes: Pick<ScopeGenerationRef, 'scopeKind' | 'scopeId'>[]): Promise<ScopeGenerationRef[]> {
    if (scopes.length === 0) return [];
    const result = await this.client.query<{ scope_kind: string; scope_id: string; generation: string }>(
      `SELECT scope_kind, scope_id, generation FROM scope_generations
        WHERE workspace_id = $1 AND (scope_kind, scope_id) IN (SELECT * FROM unnest($2::text[], $3::text[]))`,
      [this.info.workspaceId, scopes.map((s) => s.scopeKind), scopes.map((s) => s.scopeId)],
    );
    const found = new Map(result.rows.map((row) => [`${row.scope_kind}:${row.scope_id}`, Number(row.generation)]));
    return scopes.map((scope) => {
      const read: ScopeGenerationRef = { ...scope, generation: found.get(`${scope.scopeKind}:${scope.scopeId}`) ?? 0 };
      this.manifest.scope(read);
      return read;
    });
  }
}

export class PgReadSessionFactory implements ReadSessionFactory {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async withReadSession<T>(workspaceId: string, fn: (session: ReadSession) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      // The first statement fixes the snapshot; capture its identity for the manifest.
      const snap = await client.query<{ snapshot: string; started_at: Date }>('SELECT pg_current_snapshot()::text AS snapshot, now() AS started_at');
      const row = snap.rows[0];
      if (!row) throw new Error('read session could not capture its snapshot');
      const session = new PgReadSession(client, {
        workspaceId,
        isolation: 'REPEATABLE_READ',
        readOnly: true,
        databaseSnapshot: row.snapshot,
        transactionStartedAt: row.started_at.toISOString(),
      });
      const value = await fn(session);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

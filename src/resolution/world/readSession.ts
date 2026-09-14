/**
 * NORTHSTAR M6 — snapshot-consistent read session (closes G1).
 *
 * docs/refactor/evidence/M2_INTEGRATION_DECISIONS.md G1: "M6 owns the decision
 * and implementation for snapshot-consistent read transactions / WorldSnapshot
 * capture ... No UnitOfWork mutation." The mutation `UnitOfWork` stays exactly
 * as frozen. Reads that must be mutually consistent run inside ONE
 * `ReadSession`: a PostgreSQL `REPEATABLE READ READ ONLY` transaction, so every
 * query sees the same snapshot and no write can be attempted through it.
 *
 * The session also records the manifest: every aggregate revision, scope
 * generation, evidence/edition id and coverage record read through it. A
 * caller cannot capture rows without the manifest entries that make their
 * currentness checkable later.
 */
import type { TypedRef, RootRevision, ScopeGenerationRef } from '../../domain/v2/shared/identity.ts';
import type { Instant } from '../../domain/v2/shared/time.ts';
import type { CoverageRecord, MissingCoverage, WorldSnapshotManifest } from '../../contracts/v2/scope/readScope.ts';

/** A minimal query surface: the same shape `pg.PoolClient.query` provides, restricted to reads by the transaction mode. */
export interface ReadQueryable {
  query<R extends Record<string, unknown> = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: R[] }>;
}

export interface ManifestRecorder {
  aggregate(read: RootRevision): void;
  scope(read: ScopeGenerationRef): void;
  evidence(id: string): void;
  coverage(read: CoverageRecord): void;
  missing(missing: MissingCoverage): void;
}

export interface ReadSessionInfo {
  workspaceId: string;
  isolation: 'REPEATABLE_READ';
  readOnly: true;
  /** `pg_current_snapshot()` captured at the start of the session. */
  databaseSnapshot: string;
  /** Transaction timestamp (`now()` inside the snapshot) — the database's view of "when". */
  transactionStartedAt: Instant;
}

export interface ReadSession {
  readonly info: ReadSessionInfo;
  readonly db: ReadQueryable;
  readonly manifest: ManifestRecorder;
  /** Everything recorded so far, deterministically ordered. */
  manifestParts(): Pick<WorldSnapshotManifest, 'aggregateReads' | 'scopeReads' | 'evidenceReads' | 'coverageReads' | 'missingCoverage'>;
  /** Reads the current revision of each aggregate root that owns `refs`, and records them. */
  recordAggregates(refs: TypedRef[]): Promise<RootRevision[]>;
  /** Reads (and records) scope generations; a scope never advanced reads as generation 0. */
  recordScopes(scopes: Pick<ScopeGenerationRef, 'scopeKind' | 'scopeId'>[]): Promise<ScopeGenerationRef[]>;
}

export interface ReadSessionFactory {
  /**
   * Runs `fn` inside one consistent read-only snapshot. The transaction always
   * ends (COMMIT of a read-only transaction, or ROLLBACK on error) before the
   * returned promise settles; `fn` must not retain the session.
   */
  withReadSession<T>(workspaceId: string, fn: (session: ReadSession) => Promise<T>): Promise<T>;
}

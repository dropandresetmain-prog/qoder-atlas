/**
 * NORTHSTAR v2 — PostgreSQL `SupportReadQueries` (M2 lane S).
 *
 * The frozen read seam `src/contracts/v2/repository/queries.ts#SupportReadQueries`.
 * One statement per method, each anchored on the index its contract names:
 *
 *  - `requirementsForTraveller` → `idx_accompaniment_requirements_supported`
 *    (0027: `(workspace_id, supported_traveller_id, coverage_start)`).
 *  - `requirementsEligibleForSupporter` →
 *    `idx_accompaniment_eligible_supporters_traveller` (0027:
 *    `(workspace_id, supporter_traveller_id)`).
 *  - `supportScopesForTravellerInWindow` →
 *    `idx_support_assignment_scopes_traveller_window` (0028:
 *    `(workspace_id, supporter_traveller_id, scope_start, scope_end)`).
 *  - `handoffsReceivedBy` → `idx_support_assignment_handoffs_to` (0028:
 *    `(workspace_id, to_supporter_traveller_id, handoff_at)`).
 *
 * These return the minimum identifying tuple needed to continue a computation —
 * never a support verdict. Whether coverage is actually met is an Assessment
 * result (F13), and no column in this family encodes one: there is nothing here
 * that could be read as a boolean "is supported".
 *
 * Invariants preserved by construction: `requirementsForTraveller` returns
 * *editions* (one row per `(id, version)`), and
 * `supportScopesForTravellerInWindow` returns one row per stored segment, so two
 * adjacent committed scopes can never be folded into one by this seam. Every
 * instant is rendered with `to_char(... AT TIME ZONE 'UTC', ...)` so the domain
 * `Instant` normal form never depends on the session timezone.
 */
import type { QueryResult, QueryResultRow } from 'pg';
import type { SupportReadQueries } from '../../../contracts/v2/repository/queries.ts';
import type { Instant, InstantInterval } from '../../../domain/v2/shared/time.ts';

/**
 * The callable slice of `Pool`/`PoolClient` (both satisfy it structurally). The
 * frozen `UnitOfWork` offers no read transaction, so a read port has to name the
 * driver surface it needs — and nothing more.
 */
export type Queryable = {
  query<TRow extends QueryResultRow>(sql: string, values?: unknown[]): Promise<QueryResult<TRow>>;
};

type RequirementEditionRow = {
  requirement_id: string;
  version: number;
  coverage_start: string;
  coverage_end: string;
  minimum_simultaneous_supporters: number;
  maximum_handoff_gap_minutes: number;
};

type EligibilityRow = {
  requirement_id: string;
  version: number;
  supported_traveller_id: string;
  coverage_start: string;
  coverage_end: string;
};

type ScopeRow = {
  assignment_id: string;
  constraint_definition_id: string;
  constraint_definition_version: number;
  lifecycle_status: string;
  scope_start: string;
  scope_end: string;
};

type HandoffRow = {
  assignment_id: string;
  from_supporter_traveller_id: string;
  handoff_at: string;
};

export class PgSupportReadQueries implements SupportReadQueries {
  private readonly db: Queryable;
  private readonly workspaceId: string;

  constructor(db: Queryable, workspaceId: string) {
    this.db = db;
    this.workspaceId = workspaceId;
  }

  /**
   * Editions that pin a supported person. `window` narrows by overlap when given;
   * omitting it is a request for every edition, including superseded ones,
   * because an assignment may legitimately pin an older edition.
   */
  async requirementsForTraveller(
    workspaceId: string,
    travellerId: string,
    window?: InstantInterval,
  ): Promise<
    {
      requirementId: string;
      version: number;
      coverage: InstantInterval;
      minimumSimultaneousSupporters: number;
      maximumHandoffGapMinutes: number;
    }[]
  > {
    const result = await this.db.query<RequirementEditionRow>(
      `SELECT r.id AS requirement_id, r.version,
              to_char(r.coverage_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS coverage_start,
              to_char(r.coverage_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS coverage_end,
              r.minimum_simultaneous_supporters, r.maximum_handoff_gap_minutes
         FROM accompaniment_requirements r
        WHERE r.workspace_id = $1
          AND r.supported_traveller_id = $2
          AND ($3::timestamptz IS NULL OR (r.coverage_start < $4 AND r.coverage_end > $3))
        ORDER BY r.id, r.version`,
      [this.scoped(workspaceId), travellerId, window?.start ?? null, window?.end ?? null],
    );
    return result.rows.map((row) => ({
      requirementId: row.requirement_id,
      version: row.version,
      coverage: { start: row.coverage_start, end: row.coverage_end },
      minimumSimultaneousSupporters: row.minimum_simultaneous_supporters,
      maximumHandoffGapMinutes: row.maximum_handoff_gap_minutes,
    }));
  }

  /**
   * "Who else could cover this?" — derived only from the eligible set of the
   * exact edition, so it never implies the supporter is currently assigned.
   */
  async requirementsEligibleForSupporter(workspaceId: string, supporterTravellerId: string): Promise<
    {
      requirementId: string;
      version: number;
      supportedTravellerId: string;
      coverage: InstantInterval;
    }[]
  > {
    const result = await this.db.query<EligibilityRow>(
      `SELECT e.requirement_id, e.requirement_version AS version, r.supported_traveller_id,
              to_char(r.coverage_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS coverage_start,
              to_char(r.coverage_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS coverage_end
         FROM accompaniment_eligible_supporters e
         JOIN accompaniment_requirements r
           ON r.workspace_id = e.workspace_id
          AND r.id = e.requirement_id
          AND r.version = e.requirement_version
        WHERE e.workspace_id = $1 AND e.supporter_traveller_id = $2
        ORDER BY e.requirement_id, e.requirement_version`,
      [this.scoped(workspaceId), supporterTravellerId],
    );
    return result.rows.map((row) => ({
      requirementId: row.requirement_id,
      version: row.version,
      supportedTravellerId: row.supported_traveller_id,
      coverage: { start: row.coverage_start, end: row.coverage_end },
    }));
  }

  /**
   * A supporter's committed time, one row per stored segment. `excludeStatuses`
   * filters assignment lifecycle (e.g. drop `['PROPOSED','WITHDRAWN']` to count
   * only relied-upon commitments); it never rewrites a status.
   */
  async supportScopesForTravellerInWindow(
    workspaceId: string,
    supporterTravellerId: string,
    window: InstantInterval,
    opts?: { excludeStatuses?: string[] },
  ): Promise<
    {
      assignmentId: string;
      requirementId: string;
      requirementVersion: number;
      assignmentStatus: string;
      scope: InstantInterval;
    }[]
  > {
    const excluded = opts?.excludeStatuses && opts.excludeStatuses.length > 0 ? opts.excludeStatuses : null;
    const result = await this.db.query<ScopeRow>(
      `SELECT s.assignment_id, a.constraint_definition_id, a.constraint_definition_version,
              a.lifecycle_status,
              to_char(s.scope_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS scope_start,
              to_char(s.scope_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS scope_end
         FROM support_assignment_scopes s
         JOIN support_assignments a
           ON a.workspace_id = s.workspace_id AND a.id = s.assignment_id
        WHERE s.workspace_id = $1
          AND s.supporter_traveller_id = $2
          AND s.scope_start < $4 AND s.scope_end > $3
          AND ($5::text[] IS NULL OR NOT (a.lifecycle_status = ANY($5::text[])))
        ORDER BY s.scope_start, s.assignment_id, s.id`,
      [this.scoped(workspaceId), supporterTravellerId, window.start, window.end, excluded],
    );
    return result.rows.map((row) => ({
      assignmentId: row.assignment_id,
      requirementId: row.constraint_definition_id,
      requirementVersion: row.constraint_definition_version,
      assignmentStatus: row.lifecycle_status,
      scope: { start: row.scope_start, end: row.scope_end },
    }));
  }

  /**
   * Continuation obligations a supporter received at or after `from`. A handoff
   * is the named transition itself; whether the gap around it is permitted is the
   * requirement's arithmetic, evaluated in the domain, never inferred here.
   */
  async handoffsReceivedBy(
    workspaceId: string,
    supporterTravellerId: string,
    from: Instant,
  ): Promise<{ assignmentId: string; fromSupporterTravellerId: string; handoffAt: Instant }[]> {
    const result = await this.db.query<HandoffRow>(
      `SELECT f.assignment_id, f.from_supporter_traveller_id,
              to_char(f.handoff_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS handoff_at
         FROM support_assignment_handoffs f
        WHERE f.workspace_id = $1
          AND f.to_supporter_traveller_id = $2
          AND f.handoff_at >= $3
        ORDER BY f.handoff_at, f.assignment_id, f.from_supporter_traveller_id`,
      [this.scoped(workspaceId), supporterTravellerId, from],
    );
    return result.rows.map((row) => ({
      assignmentId: row.assignment_id,
      fromSupporterTravellerId: row.from_supporter_traveller_id,
      handoffAt: row.handoff_at as Instant,
    }));
  }

  private scoped(workspaceId: string): string {
    if (workspaceId !== this.workspaceId) {
      throw new Error(
        `PgSupportReadQueries is bound to workspace ${this.workspaceId}; refuses to read for ${workspaceId}`,
      );
    }
    return workspaceId;
  }
}

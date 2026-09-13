/**
 * NORTHSTAR v2 — PostgreSQL `CoordinationReadQueries` (M2 lane S).
 *
 * The read-only reverse lookups frozen in
 * `src/contracts/v2/repository/queries.ts#CoordinationReadQueries`. Each method
 * is exactly one statement, anchored on the access path the DDL actually offers:
 *
 *  - `coordinationGroupsCovering` → `idx_coordination_groups_effective`
 *    (0029: `(workspace_id, effective_start, effective_end) WHERE
 *    effective_start IS NOT NULL`) as the driving index. Its join to
 *    `group_memberships` runs on the leading columns of
 *    `group_memberships_one_per_journey_uidx` (`workspace_id,
 *    coordination_group_id, journey_id`). It cannot run on
 *    `idx_group_memberships_group_window`, which is partial on
 *    `effective_start IS NOT NULL` and so does not cover the branch that admits a
 *    membership with no declared range. The contract comment names
 *    `idx_group_memberships_journey` here instead, which no statement without a
 *    Journey argument can use — reported as a contract/DDL mismatch, not patched.
 *  - `groupsCoveringJourneyItem` → `idx_group_membership_items_item` (0026:
 *    `(workspace_id, journey_item_id)`).
 *
 * `PgUnitOfWork` has no read-only transaction in the frozen contract (an
 * accepted M2 gap), so these classes take an explicit `Queryable` instead of
 * reaching for the ambient client.
 *
 * Time semantics, deliberately asymmetric and stated here because it is the kind
 * of rule a caller would otherwise guess: a *group* answers "does this shared
 * scope cover W?", which is a coverage claim, so a group with no recorded
 * effective range is excluded — absence of a claim is UNKNOWN, never coverage.
 * A *membership* answers "does this Journey participate?", which the row's
 * existence already claims; its optional range can only narrow that claim, so an
 * undeclared membership participates in any window.
 */
import type { QueryResult, QueryResultRow } from 'pg';
import type { CoordinationReadQueries } from '../../../contracts/v2/repository/queries.ts';
import type { InstantInterval } from '../../../domain/v2/shared/time.ts';

/**
 * The callable slice of `Pool`/`PoolClient` (both satisfy it structurally). The
 * frozen `UnitOfWork` offers no read transaction, so a read port has to name the
 * driver surface it needs — and nothing more. `Pool | PoolClient` itself is not
 * used because a union of overloaded `query` signatures is not directly callable.
 */
export type Queryable = {
  query<TRow extends QueryResultRow>(sql: string, values?: unknown[]): Promise<QueryResult<TRow>>;
};

type GroupCoverageRow = {
  group_id: string;
  name: string;
  journey_ids: string[];
};

type ItemScopeRow = {
  group_id: string;
  membership_id: string;
  journey_id: string;
};

export class PgCoordinationReadQueries implements CoordinationReadQueries {
  private readonly db: Queryable;
  private readonly workspaceId: string;

  constructor(db: Queryable, workspaceId: string) {
    this.db = db;
    this.workspaceId = workspaceId;
  }

  async coordinationGroupsCovering(
    workspaceId: string,
    window: InstantInterval,
  ): Promise<{ groupId: string; name: string; journeyIds: string[] }[]> {
    const result = await this.db.query<GroupCoverageRow>(
      `SELECT g.id AS group_id, g.name,
              COALESCE(array_agg(m.journey_id::text ORDER BY m.journey_id::text), '{}'::text[]) AS journey_ids
         FROM coordination_groups g
         JOIN group_memberships m
           ON m.workspace_id = g.workspace_id AND m.coordination_group_id = g.id
          AND (m.effective_start IS NULL OR (m.effective_start < $3 AND m.effective_end > $2))
        WHERE g.workspace_id = $1
          AND g.effective_start IS NOT NULL
          AND g.effective_start < $3
          AND g.effective_end > $2
          AND g.lifecycle_status <> 'CANCELLED'
        GROUP BY g.id, g.name
        ORDER BY g.id`,
      [this.scoped(workspaceId), window.start, window.end],
    );
    return result.rows.map((row) => ({ groupId: row.group_id, name: row.name, journeyIds: [...row.journey_ids] }));
  }

  async groupsCoveringJourneyItem(
    workspaceId: string,
    journeyItemId: string,
  ): Promise<{ groupId: string; membershipId: string; journeyId: string }[]> {
    const result = await this.db.query<ItemScopeRow>(
      `SELECT i.membership_id, m.coordination_group_id AS group_id, m.journey_id
         FROM group_membership_items i
         JOIN group_memberships m
           ON m.workspace_id = i.workspace_id AND m.id = i.membership_id
        WHERE i.workspace_id = $1 AND i.journey_item_id = $2
        ORDER BY m.coordination_group_id, i.membership_id`,
      [this.scoped(workspaceId), journeyItemId],
    );
    return result.rows.map((row) => ({
      groupId: row.group_id,
      membershipId: row.membership_id,
      journeyId: row.journey_id,
    }));
  }

  private scoped(workspaceId: string): string {
    if (workspaceId !== this.workspaceId) {
      throw new Error(
        `PgCoordinationReadQueries is bound to workspace ${this.workspaceId}; refuses to read for ${workspaceId}`,
      );
    }
    return workspaceId;
  }
}

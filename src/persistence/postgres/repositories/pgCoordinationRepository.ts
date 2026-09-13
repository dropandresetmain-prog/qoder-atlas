/**
 * NORTHSTAR v2 — PostgreSQL `CoordinationRepository` (M2 lane S).
 *
 * Implements `src/contracts/v2/repository/travel.ts#CoordinationRepository`
 * against the real DDL of `0026_coordination_groups.sql`
 * (`coordination_groups`, `group_memberships`, `group_membership_items`).
 *
 * Division of labour (frozen for M2): this class contains typed-row SQL and
 * nothing else. Every write runs on `currentTransactionClient()` — the ambient
 * `PoolClient` installed by `PgUnitOfWork.execute` — and never calls
 * `uow.execute`, never touches `aggregate_heads`, `change_records` or `outbox`.
 * `COORDINATION_GROUP` is a root subject (0026 installs its subtype checker),
 * so the *handler* owns `createRoot`/`advanceHead`/audit trail; a repository
 * method can therefore never silently move a revision.
 *
 * Reads need the same ambient transaction on purpose: a handler must see its own
 * uncommitted rows. Read-only lookups that run outside a command live in
 * `queries/pgCoordinationReadQueries.ts`, which takes an explicit `Queryable`.
 *
 * Aggregate policy note: `group_memberships` and `group_membership_items` are
 * children of the group aggregate (the DDL gives them no registry subject and no
 * head of their own), and a membership is *scope*, not relationship,
 * responsibility or authority (F05 keeps those in 0018/0019).
 */
import type { ActorContext } from '../../../contracts/v2/repository/people.ts';
import type { CoordinationRepository, OptionalWindow } from '../../../contracts/v2/repository/travel.ts';
import type { CoordinationGroup, GroupMembership, LifecycleStatus } from '../../../domain/v2/trip/trip.ts';
import { currentTransactionClient } from '../transactionContext.ts';

/**
 * `0027`/`0026` keep half-open windows as two nullable `timestamptz` columns with
 * a shape CHECK; the pair is written together or not at all.
 */
interface GroupRow {
  id: string;
  workspace_id: string;
  name: string;
  purpose: string | null;
  lifecycle_status: string;
  effective_start: Date | null;
  effective_end: Date | null;
  /** `aggregate_heads.revision` is a bigint, so node-postgres returns a string. */
  revision: string;
}

interface MembershipRow {
  id: string;
  coordination_group_id: string;
  journey_id: string;
  effective_start: Date | null;
  effective_end: Date | null;
}

function windowOf(start: Date | null, end: Date | null): OptionalWindow | undefined {
  if (!start || !end) return undefined;
  return { start: start.toISOString(), end: end.toISOString() };
}

function mapGroup(row: GroupRow): CoordinationGroup {
  const group: CoordinationGroup = {
    id: row.id,
    workspaceId: row.workspace_id,
    // Read from `aggregate_heads`: §1 makes that the single current-revision
    // counter for the root, and a root is its own aggregate identity.
    revision: Number(row.revision),
    name: row.name,
    lifecycleStatus: row.lifecycle_status as LifecycleStatus,
  };
  const effectiveRange = windowOf(row.effective_start, row.effective_end);
  return effectiveRange ? { ...group, effectiveRange } : group;
}

function mapMembership(row: MembershipRow, scopeItemIds: string[]): GroupMembership {
  const membership: GroupMembership = {
    id: row.id,
    coordinationGroupId: row.coordination_group_id,
    journeyId: row.journey_id,
    scopeItemIds,
  };
  const effectiveRange = windowOf(row.effective_start, row.effective_end);
  return effectiveRange ? { ...membership, effectiveRange } : membership;
}

export class PgCoordinationRepository implements CoordinationRepository {
  private readonly workspaceId: string;

  constructor(workspaceId: string) {
    this.workspaceId = workspaceId;
  }

  /**
   * Every statement is workspace-scoped. A call that cites a different workspace
   * than the one this instance is bound to is a programming error, not a tenant
   * switch, so it fails closed instead of quietly cross-reading.
   */
  private scope(...candidates: (string | undefined)[]): string {
    for (const candidate of candidates) {
      if (candidate !== undefined && candidate !== this.workspaceId) {
        throw new Error(
          `PgCoordinationRepository is bound to workspace ${this.workspaceId}; refuses to write for ${candidate}`,
        );
      }
    }
    return this.workspaceId;
  }

  /**
   * `purpose` is not in the frozen `CoordinationGroup` type even though 0026
   * stores it, so the only port-compatible way to persist a group's business
   * purpose is this widened (optional) parameter: a caller that ignores the port
   * entirely still typechecks. The consequence is that the column is
   * write-through-the-port-only — `loadGroup` cannot surface it, because the
   * return type has no field for it — which is reported as a contract gap rather
   * than patched by inventing a field.
   */
  async createGroup(params: {
    group: CoordinationGroup;
    purpose?: string;
    actor: ActorContext;
  }): Promise<void> {
    const client = currentTransactionClient();
    const workspaceId = this.scope(params.group.workspaceId, params.actor.workspaceId);
    const result = await client.query(
      `INSERT INTO coordination_groups
         (workspace_id, id, name, purpose, lifecycle_status,
          effective_start, effective_end, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        workspaceId,
        params.group.id,
        params.group.name,
        params.purpose ?? null,
        params.group.lifecycleStatus,
        params.group.effectiveRange?.start ?? null,
        params.group.effectiveRange?.end ?? null,
        params.actor.actorPrincipalId,
      ],
    );
    this.assertWritten(result.rowCount, 'create coordination_groups row');
  }

  async loadGroup(workspaceId: string, groupId: string): Promise<CoordinationGroup | undefined> {
    const client = currentTransactionClient();
    const scope = this.scope(workspaceId);
    const result = await client.query<GroupRow>(
      `SELECT g.workspace_id, g.id, g.name, g.purpose, g.lifecycle_status,
              g.effective_start, g.effective_end, h.revision
         FROM coordination_groups g
         JOIN aggregate_heads h
           ON h.workspace_id = g.workspace_id AND h.aggregate_id = g.id
        WHERE g.workspace_id = $1 AND g.id = $2`,
      [scope, groupId],
    );
    const row = result.rows[0];
    return row ? mapGroup(row) : undefined;
  }

  /**
   * `purpose: null` clears the business purpose; omission leaves it alone.
   * `effectiveRange` can be set or narrowed but not removed, because the frozen
   * port types it as `OptionalWindow | undefined` with no explicit-null branch
   * (reported as a contract limitation, not patched here).
   */
  async updateGroup(params: {
    workspaceId: string;
    groupId: string;
    name?: string;
    purpose?: string | null;
    effectiveRange?: OptionalWindow | undefined;
    lifecycleStatus?: LifecycleStatus;
    actor: ActorContext;
  }): Promise<void> {
    const client = currentTransactionClient();
    const scope = this.scope(params.workspaceId, params.actor.workspaceId);

    const sets: string[] = [];
    const values: unknown[] = [];
    const assign = (column: string, value: unknown): void => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };

    if (params.name !== undefined) assign('name', params.name);
    if (params.purpose !== undefined) assign('purpose', params.purpose);
    if (params.lifecycleStatus !== undefined) assign('lifecycle_status', params.lifecycleStatus);
    if (params.effectiveRange !== undefined) {
      assign('effective_start', params.effectiveRange.start);
      assign('effective_end', params.effectiveRange.end);
    }
    if (sets.length === 0) return;

    values.push(scope, params.groupId);
    const result = await client.query(
      `UPDATE coordination_groups
          SET ${sets.join(', ')}, updated_at = now()
        WHERE workspace_id = $${values.length - 1} AND id = $${values.length}`,
      values,
    );
    this.assertWritten(result.rowCount, 'update coordination_groups row');
  }

  /**
   * Ensures the membership exists and records its declared item scope. Both
   * inserts are `ON CONFLICT DO NOTHING`: `shareJourneyItem` re-declares the very
   * membership it is narrowing, and a serializable replay of a command callback
   * must never turn into a unique violation (C1 amendment c). A membership row
   * for a *different* id under the same (group, journey) is still rejected by
   * `group_memberships_one_per_journey_uidx`, and 0026's deferred trigger is what
   * proves each named item actually belongs to this membership's Journey.
   */
  async addMembership(params: { membership: GroupMembership; actor: ActorContext }): Promise<void> {
    const client = currentTransactionClient();
    const scope = this.scope(params.actor.workspaceId);
    const { membership } = params;

    await client.query(
      `INSERT INTO group_memberships
         (workspace_id, id, coordination_group_id, journey_id,
          effective_start, effective_end, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (workspace_id, id) DO NOTHING`,
      [
        scope,
        membership.id,
        membership.coordinationGroupId,
        membership.journeyId,
        membership.effectiveRange?.start ?? null,
        membership.effectiveRange?.end ?? null,
        params.actor.actorPrincipalId,
      ],
    );

    const itemIds = [...new Set(membership.scopeItemIds ?? [])];
    if (itemIds.length > 0) {
      await client.query(
        `INSERT INTO group_membership_items (workspace_id, membership_id, journey_item_id)
         SELECT $1, $2, u.journey_item_id FROM unnest($3::uuid[]) AS u(journey_item_id)
         ON CONFLICT (workspace_id, membership_id, journey_item_id) DO NOTHING`,
        [scope, membership.id, itemIds],
      );
    }
  }

  async listMemberships(workspaceId: string, groupId: string): Promise<GroupMembership[]> {
    const client = currentTransactionClient();
    const scope = this.scope(workspaceId);
    const memberships = await client.query<MembershipRow>(
      `SELECT id, coordination_group_id, journey_id, effective_start, effective_end
         FROM group_memberships
        WHERE workspace_id = $1 AND coordination_group_id = $2
        ORDER BY journey_id`,
      [scope, groupId],
    );
    return this.attachScopeItems(scope, memberships.rows);
  }

  async listGroupsForJourney(workspaceId: string, journeyId: string): Promise<CoordinationGroup[]> {
    const client = currentTransactionClient();
    const scope = this.scope(workspaceId);
    const result = await client.query<GroupRow>(
      `SELECT g.workspace_id, g.id, g.name, g.purpose, g.lifecycle_status,
              g.effective_start, g.effective_end, h.revision
         FROM coordination_groups g
         JOIN aggregate_heads h
           ON h.workspace_id = g.workspace_id AND h.aggregate_id = g.id
         JOIN group_memberships m
           ON m.workspace_id = g.workspace_id AND m.coordination_group_id = g.id
        WHERE g.workspace_id = $1 AND m.journey_id = $2
        ORDER BY g.id`,
      [scope, journeyId],
    );
    return result.rows.map(mapGroup);
  }

  /**
   * Removing a membership is the group's decision, so it is the group aggregate
   * whose head the handler advances. `group_membership_items` follows by
   * ON DELETE CASCADE — narrowing shared scope never deletes the JourneyItem.
   */
  async removeMembership(params: {
    workspaceId: string;
    groupId: string;
    journeyId: string;
    actor: ActorContext;
  }): Promise<void> {
    const client = currentTransactionClient();
    const scope = this.scope(params.workspaceId, params.actor.workspaceId);
    const result = await client.query(
      `DELETE FROM group_memberships
        WHERE workspace_id = $1 AND coordination_group_id = $2 AND journey_id = $3`,
      [scope, params.groupId, params.journeyId],
    );
    this.assertWritten(result.rowCount, 'delete group_memberships row');
  }

  /**
   * `GroupMembership.scopeItemIds` is optional, so a membership with no item rows
   * is distinguishable from one that names items; both are returned, and the
   * empty case yields `[]` rather than `undefined`.
   */
  private async attachScopeItems(workspaceId: string, rows: MembershipRow[]): Promise<GroupMembership[]> {
    if (rows.length === 0) return [];
    const client = currentTransactionClient();
    const items = await client.query<{ membership_id: string; journey_item_id: string }>(
      `SELECT membership_id, journey_item_id
         FROM group_membership_items
        WHERE workspace_id = $1 AND membership_id = ANY($2::uuid[])
        ORDER BY membership_id, journey_item_id`,
      [workspaceId, [...new Set(rows.map((row) => row.id))]],
    );
    const byMembership = new Map<string, string[]>();
    for (const row of items.rows) {
      const bucket = byMembership.get(row.membership_id);
      if (bucket) bucket.push(row.journey_item_id);
      else byMembership.set(row.membership_id, [row.journey_item_id]);
    }
    return rows.map((row) => mapMembership(row, byMembership.get(row.id) ?? []));
  }

  private assertWritten(rowCount: number | null, what: string): void {
    if (rowCount !== 1) {
      throw new Error(`coordination write affected ${rowCount ?? 0} row(s) while trying to ${what}`);
    }
  }
}

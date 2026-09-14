/**
 * PostgreSQL implementation of `ResourceAssignmentRepository`
 * (src/contracts/v2/repository/programmes.ts) over `resource_assignments`
 * (migration 0058). `resource_id` is M3's opaque, deferred-FK reference
 * (docs/refactor/evidence/M4.md); this class does not validate it.
 */
import type { PoolClient } from 'pg';
import type { ResourceAssignmentRepository } from '../../../contracts/v2/repository/programmes.ts';
import type { ActorContext } from '../../../contracts/v2/repository/people.ts';
import { ResourceAssignmentSchema, type ResourceAssignment } from '../../../domain/v2/programmes/programme.ts';
import { currentTransactionClient } from '../transactionContext.ts';

interface ResourceAssignmentRow {
  id: string;
  activity_id: string;
  resource_id: string;
  quantity: number;
  lifecycle_status: string;
}

const SELECT = `SELECT id, activity_id, resource_id, quantity, lifecycle_status FROM resource_assignments`;

function toAssignment(row: ResourceAssignmentRow): ResourceAssignment {
  return ResourceAssignmentSchema.parse({
    id: row.id,
    activityId: row.activity_id,
    resourceId: row.resource_id,
    quantity: row.quantity,
    lifecycleStatus: row.lifecycle_status,
  });
}

export class PgResourceAssignmentRepository implements ResourceAssignmentRepository {
  private client(): PoolClient {
    return currentTransactionClient();
  }

  async create(params: {
    assignment: ResourceAssignment;
    activityKind: 'PROGRAMME_ITEM' | 'JOURNEY_ITEM';
    actor: ActorContext;
  }): Promise<void> {
    const { assignment } = params;
    const result = await this.client().query(
      `INSERT INTO resource_assignments
         (workspace_id, id, activity_kind, activity_id, resource_id, quantity, lifecycle_status, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        params.actor.workspaceId,
        assignment.id,
        params.activityKind,
        assignment.activityId,
        assignment.resourceId,
        assignment.quantity,
        assignment.lifecycleStatus,
        params.actor.actorPrincipalId,
      ],
    );
    if (result.rowCount !== 1) throw new Error(`resource assignment ${assignment.id} was not inserted`);
  }

  async load(workspaceId: string, assignmentId: string): Promise<ResourceAssignment | undefined> {
    const result = await this.client().query<ResourceAssignmentRow>(`${SELECT} WHERE workspace_id = $1 AND id = $2`, [
      workspaceId,
      assignmentId,
    ]);
    const row = result.rows[0];
    return row ? toAssignment(row) : undefined;
  }

  async listForActivity(
    workspaceId: string,
    activityKind: 'PROGRAMME_ITEM' | 'JOURNEY_ITEM',
    activityId: string,
  ): Promise<ResourceAssignment[]> {
    const result = await this.client().query<ResourceAssignmentRow>(
      `${SELECT} WHERE workspace_id = $1 AND activity_kind = $2 AND activity_id = $3 ORDER BY created_at`,
      [workspaceId, activityKind, activityId],
    );
    return result.rows.map(toAssignment);
  }

  async setLifecycleStatus(params: {
    workspaceId: string;
    assignmentId: string;
    lifecycleStatus: ResourceAssignment['lifecycleStatus'];
    actor: ActorContext;
  }): Promise<void> {
    const result = await this.client().query(
      `UPDATE resource_assignments SET lifecycle_status = $3, updated_at = now() WHERE workspace_id = $1 AND id = $2`,
      [params.workspaceId, params.assignmentId, params.lifecycleStatus],
    );
    if (result.rowCount !== 1) {
      throw new Error(`resource assignment ${params.assignmentId} not found in workspace ${params.workspaceId}`);
    }
  }
}

/**
 * NORTHSTAR v2 — PostgreSQL `SupportRepository` (M2 lane S).
 *
 * Implements `src/contracts/v2/repository/travel.ts#SupportRepository` against
 * the real DDL of `0027_accompaniment_requirements.sql` and
 * `0028_support_assignments.sql`.
 *
 * Typed-row SQL only, on the ambient `currentTransactionClient()`: no
 * `uow.execute`, no `aggregate_heads`/`change_records`/`outbox` writes. The
 * `SUPPORT_ASSIGNMENT` root's registration and revision are owned by the
 * command handler (0028 installs the subtype checker that makes it a root).
 *
 * The requirement/assignment split is structural here, not conventional:
 *  - `appendRequirement` can only ever add a new immutable `(id, version)` row
 *    plus that version's own eligible set (0027 marks the table `forbid_mutation`
 *    and keys the eligible table by the exact version);
 *  - the assignment writes change lifecycle status and fulfilment children only.
 *    They take no requirement parameter at all, so the pinned
 *    `(constraint_definition_id, constraint_definition_version)` composite FK
 *    cannot be moved by anything in this class;
 *  - there is no `is_supported`/boolean support column to write, because support
 *    is always a named requirement over named people on named intervals.
 */
import { createHash } from 'node:crypto';
import type { ActorContext } from '../../../contracts/v2/repository/people.ts';
import type { SupportRepository } from '../../../contracts/v2/repository/travel.ts';
import type {
  AccompanimentConstraintDefinition,
  SupportAssignment,
  SupportHandoff,
} from '../../../domain/v2/trip/support.ts';
import type { InstantInterval } from '../../../domain/v2/shared/time.ts';
import { currentTransactionClient } from '../transactionContext.ts';

/** UTC-rendered instant: the domain `Instant` contract and its string comparisons need one normal form. */
const UTC_ISO_FORMAT = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;

interface RequirementRow {
  id: string;
  version: number;
  supported_traveller_id: string;
  coverage_start: string;
  coverage_end: string;
  minimum_simultaneous_supporters: number;
  maximum_handoff_gap_minutes: number;
  provenance_evidence_id: string | null;
  eligible_supporter_ids: string[];
}

interface ScopeJson {
  supporter_traveller_id: string;
  interval_start: string;
  interval_end: string;
  scope_id: string;
}

interface HandoffJson {
  from_supporter_traveller_id: string;
  to_supporter_traveller_id: string;
  handoff_at: string;
}

interface AssignmentRow {
  id: string;
  constraint_definition_id: string;
  constraint_definition_version: number;
  lifecycle_status: SupportAssignment['lifecycleStatus'];
  revision: string;
  supporter_ids: string[];
  scopes: ScopeJson[] | null;
  handoffs: HandoffJson[] | null;
}

const REQUIREMENT_COLUMNS = `
  r.id, r.version, r.supported_traveller_id,
  to_char(r.coverage_start AT TIME ZONE 'UTC', ${UTC_ISO_FORMAT}) AS coverage_start,
  to_char(r.coverage_end AT TIME ZONE 'UTC', ${UTC_ISO_FORMAT}) AS coverage_end,
  r.minimum_simultaneous_supporters, r.maximum_handoff_gap_minutes, r.provenance_evidence_id,
  COALESCE((
    SELECT array_agg(e.supporter_traveller_id::text ORDER BY e.supporter_traveller_id)
      FROM accompaniment_eligible_supporters e
     WHERE e.workspace_id = r.workspace_id
       AND e.requirement_id = r.id
       AND e.requirement_version = r.version
  ), '{}'::text[]) AS eligible_supporter_ids`;

function mapRequirement(row: RequirementRow): AccompanimentConstraintDefinition {
  const definition: AccompanimentConstraintDefinition = {
    id: row.id,
    version: row.version,
    supportedTravellerId: row.supported_traveller_id,
    requiredCoverage: { start: row.coverage_start, end: row.coverage_end },
    minimumSimultaneousSupporters: row.minimum_simultaneous_supporters,
    eligibleSupporterTravellerIds: [...row.eligible_supporter_ids],
    maximumHandoffGapMinutes: row.maximum_handoff_gap_minutes,
  };
  return row.provenance_evidence_id ? { ...definition, provenanceEvidenceId: row.provenance_evidence_id } : definition;
}

function mapAssignment(row: AssignmentRow): SupportAssignment {
  return {
    id: row.id,
    revision: Number(row.revision),
    constraintDefinitionId: row.constraint_definition_id,
    constraintDefinitionVersion: row.constraint_definition_version,
    lifecycleStatus: row.lifecycle_status,
    assignedSupporterTravellerIds: [...row.supporter_ids],
    assignedScopes: (row.scopes ?? []).map((scope) => ({
      supporterTravellerId: scope.supporter_traveller_id,
      interval: { start: scope.interval_start, end: scope.interval_end } satisfies InstantInterval,
    })),
    handoffs: (row.handoffs ?? []).map((handoff) => ({
      fromSupporterTravellerId: handoff.from_supporter_traveller_id,
      toSupporterTravellerId: handoff.to_supporter_traveller_id,
      handoffAt: handoff.handoff_at,
    })),
  };
}

/**
 * `support_assignment_scopes.id` is a real primary key, but the frozen
 * `SupportAssignment.assignedScopes` element carries no id. Deriving it
 * deterministically from the assignment plus the segment identity keeps
 * `uow.execute` replay-safe (C1 amendment c) — a re-run of the callback rewrites
 * the same rows instead of minting new identities.
 */
function derivedScopeId(assignmentId: string, supporterTravellerId: string, start: string, end: string): string {
  const digest = createHash('sha1')
    .update(`m2-support-scope|${assignmentId}|${supporterTravellerId}|${start}|${end}`, 'utf8')
    .digest('hex');
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

/**
 * One statement per assignment read: the row plus its own aggregate revision and
 * its three fulfilment children aggregated as arrays, so a load cannot observe a
 * half-written assignment.
 */
const ASSIGNMENT_SELECT = `
  SELECT a.id, a.constraint_definition_id, a.constraint_definition_version, a.lifecycle_status,
         h.revision,
         COALESCE((
           SELECT array_agg(x.supporter_traveller_id::text ORDER BY x.supporter_traveller_id)
             FROM support_assignment_assignees x
            WHERE x.workspace_id = a.workspace_id AND x.assignment_id = a.id
         ), '{}'::text[]) AS supporter_ids,
         COALESCE((
           SELECT jsonb_agg(
                    jsonb_build_object(
                      'scope_id', s.id,
                      'supporter_traveller_id', s.supporter_traveller_id,
                      'interval_start', to_char(s.scope_start AT TIME ZONE 'UTC', ${UTC_ISO_FORMAT}),
                      'interval_end', to_char(s.scope_end AT TIME ZONE 'UTC', ${UTC_ISO_FORMAT})
                    )
                    ORDER BY s.scope_start, s.id)
             FROM support_assignment_scopes s
            WHERE s.workspace_id = a.workspace_id AND s.assignment_id = a.id
         ), '[]'::jsonb) AS scopes,
         COALESCE((
           SELECT jsonb_agg(
                    jsonb_build_object(
                      'from_supporter_traveller_id', f.from_supporter_traveller_id,
                      'to_supporter_traveller_id', f.to_supporter_traveller_id,
                      'handoff_at', to_char(f.handoff_at AT TIME ZONE 'UTC', ${UTC_ISO_FORMAT})
                    )
                    ORDER BY f.handoff_at, f.from_supporter_traveller_id, f.to_supporter_traveller_id)
             FROM support_assignment_handoffs f
            WHERE f.workspace_id = a.workspace_id AND f.assignment_id = a.id
         ), '[]'::jsonb) AS handoffs
    FROM support_assignments a
    JOIN aggregate_heads h
      ON h.workspace_id = a.workspace_id AND h.aggregate_id = a.id`;

export class PgSupportRepository implements SupportRepository {
  private readonly workspaceId: string;

  constructor(workspaceId: string) {
    this.workspaceId = workspaceId;
  }

  /** Cross-workspace citation is a programming error, never a tenant switch. */
  private scope(...candidates: (string | undefined)[]): string {
    for (const candidate of candidates) {
      if (candidate !== undefined && candidate !== this.workspaceId) {
        throw new Error(
          `PgSupportRepository is bound to workspace ${this.workspaceId}; refuses to write for ${candidate}`,
        );
      }
    }
    return this.workspaceId;
  }

  /**
   * Append-only: a new edition restates its own eligible set (0027 keys the
   * association by the exact version and forbids mutation of the requirement), so
   * an existing assignment can never ride along with a quietly edited rule.
   */
  async appendRequirement(params: {
    requirement: AccompanimentConstraintDefinition;
    actor: ActorContext;
  }): Promise<void> {
    const client = currentTransactionClient();
    const workspaceId = this.scope(params.actor.workspaceId);
    const { requirement } = params;

    const inserted = await client.query(
      `INSERT INTO accompaniment_requirements
         (workspace_id, id, version, supported_traveller_id, coverage_start, coverage_end,
          minimum_simultaneous_supporters, maximum_handoff_gap_minutes, provenance_evidence_id,
          created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        workspaceId,
        requirement.id,
        requirement.version,
        requirement.supportedTravellerId,
        requirement.requiredCoverage.start,
        requirement.requiredCoverage.end,
        requirement.minimumSimultaneousSupporters,
        requirement.maximumHandoffGapMinutes,
        requirement.provenanceEvidenceId ?? null,
        params.actor.actorPrincipalId,
      ],
    );
    this.assertWritten(inserted.rowCount, 'insert accompaniment_requirements row');

    const eligible = [...new Set(requirement.eligibleSupporterTravellerIds)];
    await client.query(
      `INSERT INTO accompaniment_eligible_supporters
         (workspace_id, requirement_id, requirement_version, supporter_traveller_id)
       SELECT $1, $2, $3, u.supporter_traveller_id FROM unnest($4::uuid[]) AS u(supporter_traveller_id)`,
      [workspaceId, requirement.id, requirement.version, eligible],
    );
  }

  async loadRequirement(
    workspaceId: string,
    requirementId: string,
    version: number,
  ): Promise<AccompanimentConstraintDefinition | undefined> {
    const client = currentTransactionClient();
    const result = await client.query<RequirementRow>(
      `SELECT ${REQUIREMENT_COLUMNS} FROM accompaniment_requirements r
        WHERE r.workspace_id = $1 AND r.id = $2 AND r.version = $3`,
      [this.scope(workspaceId), requirementId, version],
    );
    const row = result.rows[0];
    return row ? mapRequirement(row) : undefined;
  }

  async listRequirementVersions(
    workspaceId: string,
    requirementId: string,
  ): Promise<AccompanimentConstraintDefinition[]> {
    const client = currentTransactionClient();
    const result = await client.query<RequirementRow>(
      `SELECT ${REQUIREMENT_COLUMNS} FROM accompaniment_requirements r
        WHERE r.workspace_id = $1 AND r.id = $2
        ORDER BY r.version`,
      [this.scope(workspaceId), requirementId],
    );
    return result.rows.map(mapRequirement);
  }

  async latestRequirementVersion(
    workspaceId: string,
    requirementId: string,
  ): Promise<AccompanimentConstraintDefinition | undefined> {
    const client = currentTransactionClient();
    const result = await client.query<RequirementRow>(
      `SELECT ${REQUIREMENT_COLUMNS} FROM accompaniment_requirements r
        WHERE r.workspace_id = $1 AND r.id = $2
        ORDER BY r.version DESC
        LIMIT 1`,
      [this.scope(workspaceId), requirementId],
    );
    const row = result.rows[0];
    return row ? mapRequirement(row) : undefined;
  }

  /**
   * Writes the assignment root's typed row and all three fulfilment children.
   * 0028's deferred `assert_support_assignment_consistency` is the database's own
   * copy of "an assignment cannot widen its governing requirement"; the handler's
   * `assignmentSatisfiesDefinition` check exists to return typed reasons instead
   * of a commit-time exception.
   */
  async createAssignment(params: { assignment: SupportAssignment; actor: ActorContext }): Promise<void> {
    const client = currentTransactionClient();
    const workspaceId = this.scope(params.actor.workspaceId);
    const { assignment } = params;

    const inserted = await client.query(
      `INSERT INTO support_assignments
         (workspace_id, id, constraint_definition_id, constraint_definition_version,
          lifecycle_status, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        workspaceId,
        assignment.id,
        assignment.constraintDefinitionId,
        assignment.constraintDefinitionVersion,
        assignment.lifecycleStatus,
        params.actor.actorPrincipalId,
      ],
    );
    this.assertWritten(inserted.rowCount, 'insert support_assignments row');

    await this.writeAssignees(workspaceId, assignment.id, assignment.assignedSupporterTravellerIds);
    await this.writeScopes(workspaceId, assignment.id, assignment.assignedScopes);
    await this.writeHandoffs(workspaceId, assignment.id, assignment.handoffs);
  }

  async loadAssignment(workspaceId: string, assignmentId: string): Promise<SupportAssignment | undefined> {
    const client = currentTransactionClient();
    const result = await client.query<AssignmentRow>(
      `${ASSIGNMENT_SELECT} WHERE a.workspace_id = $1 AND a.id = $2`,
      [this.scope(workspaceId), assignmentId],
    );
    const row = result.rows[0];
    return row ? mapAssignment(row) : undefined;
  }

  async listAssignmentsForRequirement(
    workspaceId: string,
    requirementId: string,
    version: number,
  ): Promise<SupportAssignment[]> {
    const client = currentTransactionClient();
    const result = await client.query<AssignmentRow>(
      `${ASSIGNMENT_SELECT} WHERE a.workspace_id = $1 AND a.constraint_definition_id = $2
         AND a.constraint_definition_version = $3 ORDER BY a.id`,
      [this.scope(workspaceId), requirementId, version],
    );
    return result.rows.map(mapAssignment);
  }

  /** Lifecycle only: the pinned requirement edition is not an assignment-settable column. */
  async setAssignmentStatus(params: {
    workspaceId: string;
    assignmentId: string;
    lifecycleStatus: SupportAssignment['lifecycleStatus'];
    actor: ActorContext;
  }): Promise<void> {
    const client = currentTransactionClient();
    const result = await client.query(
      `UPDATE support_assignments
          SET lifecycle_status = $3, updated_at = now()
        WHERE workspace_id = $1 AND id = $2`,
      [this.scope(params.workspaceId, params.actor.workspaceId), params.assignmentId, params.lifecycleStatus],
    );
    this.assertWritten(result.rowCount, 'update support_assignments row');
  }

  /**
   * Replaces the selected fulfilment (assignees, scope segments, handoffs) by
   * deleting and re-inserting the children; `support_assignments` itself is not
   * even addressed, so the composite-FK pin to `(id, version)` is untouched by
   * construction. Child deletion cascades to scopes and handoffs per 0028.
   */
  async replaceAssignmentScope(params: {
    workspaceId: string;
    assignmentId: string;
    assignedSupporterTravellerIds: string[];
    assignedScopes: { supporterTravellerId: string; interval: InstantInterval }[];
    handoffs: SupportAssignment['handoffs'];
    actor: ActorContext;
  }): Promise<void> {
    const client = currentTransactionClient();
    const workspaceId = this.scope(params.workspaceId, params.actor.workspaceId);
    await client.query(
      `DELETE FROM support_assignment_assignees WHERE workspace_id = $1 AND assignment_id = $2`,
      [workspaceId, params.assignmentId],
    );
    await this.writeAssignees(workspaceId, params.assignmentId, params.assignedSupporterTravellerIds);
    await this.writeScopes(workspaceId, params.assignmentId, params.assignedScopes);
    await this.writeHandoffs(workspaceId, params.assignmentId, params.handoffs);
  }

  private async writeAssignees(workspaceId: string, assignmentId: string, supporterIds: string[]): Promise<void> {
    const client = currentTransactionClient();
    const unique = [...new Set(supporterIds)];
    await client.query(
      `INSERT INTO support_assignment_assignees (workspace_id, assignment_id, supporter_traveller_id)
       SELECT $1, $2, u.supporter_traveller_id FROM unnest($3::uuid[]) AS u(supporter_traveller_id)`,
      [workspaceId, assignmentId, unique],
    );
  }

  private async writeScopes(
    workspaceId: string,
    assignmentId: string,
    scopes: { supporterTravellerId: string; interval: InstantInterval }[],
  ): Promise<void> {
    if (scopes.length === 0) return;
    const client = currentTransactionClient();
    const params: unknown[] = [workspaceId, assignmentId];
    const seen = new Set<string>();
    const tuples: string[] = [];
    for (const scope of scopes) {
      const scopeId = derivedScopeId(assignmentId, scope.supporterTravellerId, scope.interval.start, scope.interval.end);
      if (seen.has(scopeId)) continue; // the same supporter + segment twice is one fact, not two rows
      seen.add(scopeId);
      params.push(scopeId, scope.supporterTravellerId, scope.interval.start, scope.interval.end);
      const base = params.length - 3;
      tuples.push(`($1, $${base}, $2, $${base + 1}, $${base + 2}, $${base + 3})`);
    }
    await client.query(
      `INSERT INTO support_assignment_scopes
         (workspace_id, id, assignment_id, supporter_traveller_id, scope_start, scope_end)
       VALUES ${tuples.join(', ')}`,
      params,
    );
  }

  private async writeHandoffs(workspaceId: string, assignmentId: string, handoffs: SupportHandoff[]): Promise<void> {
    if (handoffs.length === 0) return;
    const client = currentTransactionClient();
    const params: unknown[] = [workspaceId, assignmentId];
    const seen = new Set<string>();
    const tuples: string[] = [];
    for (const handoff of handoffs) {
      const key = `${handoff.fromSupporterTravellerId}>${handoff.toSupporterTravellerId}@${handoff.handoffAt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      params.push(handoff.fromSupporterTravellerId, handoff.toSupporterTravellerId, handoff.handoffAt);
      const base = params.length - 2;
      tuples.push(`($1, $2, $${base}, $${base + 1}, $${base + 2})`);
    }
    await client.query(
      `INSERT INTO support_assignment_handoffs
         (workspace_id, assignment_id, from_supporter_traveller_id, to_supporter_traveller_id, handoff_at)
       VALUES ${tuples.join(', ')}`,
      params,
    );
  }

  private assertWritten(rowCount: number | null, what: string): void {
    if (rowCount !== 1) {
      throw new Error(`support write affected ${rowCount ?? 0} row(s) while trying to ${what}`);
    }
  }
}

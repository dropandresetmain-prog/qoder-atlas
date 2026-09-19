import {
  ChangeRequestRecordSchema,
  type ChangeRequestRecord,
} from '../../../contracts/v2/change/changeRequest.ts';
import type { ChangeRequestReadRepository } from '../../../contracts/v2/repository/changeRequests.ts';
import type { Queryable } from '../commandSupport.ts';

/** Read-only reconstruction of one immutable request revision and its target links. */
export class PgChangeRequestRepository implements ChangeRequestReadRepository {
  private readonly db: Queryable;

  constructor(db: Queryable) {
    this.db = db;
  }

  async loadChangeRequest(workspaceId: string, changeRequestId: string): Promise<ChangeRequestRecord | undefined> {
    const result = await this.db.query<{
      id: string;
      requester_principal_id: string;
      represented_traveller_id: string;
      journey_id: string;
      lifecycle_status: string;
      revision: number;
      intent_kind: string;
      urgency: string;
      desired_target: unknown;
      funding_declaration: string | null;
      source_utterance: string;
      source_record_id: string;
      submitted_at: Date;
      targets: { role: string; kind: string; id: string }[];
    }>(
      `SELECT r.id, r.requester_principal_id, r.represented_traveller_id, r.journey_id, r.lifecycle_status,
              v.revision, v.intent_kind, v.urgency, v.desired_target, v.funding_declaration,
              v.source_utterance, v.source_record_id, v.submitted_at,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object('role', t.target_role, 'kind', t.target_kind, 'id', t.target_id)
                                 ORDER BY t.target_role, t.target_kind, t.target_id)
                  FROM change_request_targets t
                 WHERE t.workspace_id = r.workspace_id AND t.change_request_id = r.id AND t.request_revision = v.revision
              ), '[]'::jsonb) AS targets
         FROM change_requests r
         JOIN change_request_revisions v ON v.workspace_id = r.workspace_id AND v.change_request_id = r.id
        WHERE r.workspace_id = $1 AND r.id = $2
        ORDER BY v.revision DESC
        LIMIT 1`,
      [workspaceId, changeRequestId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return ChangeRequestRecordSchema.parse({
      id: row.id,
      requesterPrincipalId: row.requester_principal_id,
      representedTravellerId: row.represented_traveller_id,
      journeyId: row.journey_id,
      lifecycle: row.lifecycle_status,
      revision: row.revision,
      sourceRecordId: row.source_record_id,
      sourceUtterance: row.source_utterance,
      submittedAt: row.submitted_at.toISOString(),
      intentKind: row.intent_kind,
      urgency: row.urgency,
      desiredTarget: row.desired_target,
      ...(row.funding_declaration ? { fundingDeclaration: row.funding_declaration } : {}),
      targets: row.targets.map((target) => ({ role: target.role, targetRef: { kind: target.kind, id: target.id } })),
    });
  }
}

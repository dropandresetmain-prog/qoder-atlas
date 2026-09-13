/**
 * NORTHSTAR M2 lane P — governance reverse-lookup reads.
 *
 * Read-only over `Queryable` for the same accepted-gap reason as
 * `pgCredentialReadQueries.ts`. Every statement is a single statement and is
 * workspace-scoped on each side of each join.
 *
 * F05 boundary these reads must not blur: responsibility is borne by an
 * Organisation party and answers "who is accountable for this subject"; it never
 * authorises an action. Authority answers only through the grant tables. Keeping
 * the two in separate methods is what stops a later milestone from treating one
 * as evidence of the other.
 */
import type { Instant, DateInterval } from '../../../domain/v2/shared/time.ts';
import type { SubjectKind, TypedRef } from '../../../domain/v2/shared/identity.ts';
import type { ResponsibilityRole } from '../../../domain/v2/people/traveller.ts';
import type { GovernanceReadQueries } from '../../../contracts/v2/repository/queries.ts';
import type { Queryable } from '../commandSupport.ts';

interface GrantHitRow {
  grant_id: string;
  action_kinds: string[] | null;
  scope_refs: { kind: SubjectKind; id: string }[] | null;
  represented_party_kind: SubjectKind;
  represented_party_id: string;
  expires_at: Date | null;
}

interface ResponsibilityRow {
  assignment_id: string;
  role: ResponsibilityRole;
  subject_kind: SubjectKind;
  subject_id: string;
  organisation_id: string;
  effective_from: string;
  effective_to: string | null;
}

export class PgGovernanceReadQueries implements GovernanceReadQueries {
  private readonly db: Queryable;

  constructor(db: Queryable) {
    this.db = db;
  }

  /**
   * `idx_authority_grants_principal (workspace_id, principal_id, revoked_at,
   * expires_at)` from 0019 supplies the two equality prefixes plus the
   * revocation/expiry filters, and 0029's
   * `idx_authority_grants_principal_effective (workspace_id, principal_id,
   * issued_at DESC)` is the as-of ordering the same predicate needs. Children are
   * aggregated in-statement so scope narrowing stays visible to M9 (a
   * global-looking grant is only global-looking if its scope rows say so).
   */
  async grantsEffectiveFor(
    workspaceId: string,
    principalId: string,
    at: Instant,
  ): Promise<
    {
      grantId: string;
      actionKinds: string[];
      scopeRefs: TypedRef[];
      representedPartyRef: TypedRef | null;
      expiresAt: Instant | null;
    }[]
  > {
    const result = await this.db.query<GrantHitRow>(
      `SELECT g.id AS grant_id,
              (SELECT COALESCE(array_agg(a.action_kind ORDER BY a.action_kind), '{}')
                 FROM grant_actions a
                WHERE a.workspace_id = g.workspace_id AND a.grant_id = g.id) AS action_kinds,
              (SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', s.scope_kind, 'id', s.scope_id)
                                         ORDER BY s.scope_kind, s.scope_id), '[]'::jsonb)
                 FROM grant_scopes s
                WHERE s.workspace_id = g.workspace_id AND s.grant_id = g.id) AS scope_refs,
              g.represented_party_kind,
              g.represented_party_id,
              g.expires_at
         FROM authority_grants g
        WHERE g.workspace_id = $1
          AND g.principal_id = $2
          AND g.revoked_at IS NULL
          AND g.issued_at <= $3::timestamptz
          AND (g.expires_at IS NULL OR g.expires_at > $3::timestamptz)
        ORDER BY g.issued_at, g.id`,
      [workspaceId, principalId, at],
    );
    return result.rows.map((row) => ({
      grantId: row.grant_id,
      actionKinds: row.action_kinds ?? [],
      scopeRefs: (row.scope_refs ?? []).map((ref) => ({ kind: ref.kind, id: ref.id })),
      // 0019 stores both halves NOT NULL; the port's `| null` stays unfilled.
      representedPartyRef: { kind: row.represented_party_kind, id: row.represented_party_id },
      expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
    }));
  }

  /**
   * `idx_grant_actions_action (workspace_id, action_kind, grant_id)` drives this
   * audit/review lookup, so an action kind that was never registered in
   * `authority_action_kinds` returns no principal rather than matching every
   * grant.
   */
  async principalsHoldingAction(workspaceId: string, actionKind: string, at: Instant): Promise<string[]> {
    const result = await this.db.query<{ principal_id: string }>(
      `SELECT DISTINCT g.principal_id
         FROM grant_actions a
         JOIN authority_grants g ON g.workspace_id = a.workspace_id AND g.id = a.grant_id
        WHERE a.workspace_id = $1
          AND a.action_kind = $2
          AND g.revoked_at IS NULL
          AND g.issued_at <= $3::timestamptz
          AND (g.expires_at IS NULL OR g.expires_at > $3::timestamptz)
        ORDER BY g.principal_id`,
      [workspaceId, actionKind, at],
    );
    return result.rows.map((row) => row.principal_id);
  }

  /**
   * `idx_responsibility_assignments_subject (workspace_id, subject_ref_kind,
   * subject_ref_id)`: the ref pairs are expanded with `unnest` so each row
   * matches on its exact `(kind, id)` pair — a right-id/wrong-kind pair simply
   * finds nothing, which is the C1 typed-identity rule expressed in SQL rather
   * than in application convention.
   */
  async responsibilitiesForSubjects(workspaceId: string, subjectRefs: TypedRef[]): Promise<
    {
      assignmentId: string;
      role: ResponsibilityRole;
      subjectKind: SubjectKind;
      subjectId: string;
      organisationId: string;
      effectiveRange: DateInterval;
    }[]
  > {
    const kinds = subjectRefs.map((ref) => ref.kind);
    const ids = subjectRefs.map((ref) => ref.id);
    const result = await this.db.query<ResponsibilityRow>(
      `SELECT r.id AS assignment_id,
              r.role,
              r.subject_ref_kind AS subject_kind,
              r.subject_ref_id AS subject_id,
              r.organisation_id,
              to_char(r.effective_from, 'YYYY-MM-DD') AS effective_from,
              to_char(r.effective_to, 'YYYY-MM-DD') AS effective_to
         FROM responsibility_assignments r
         JOIN unnest($2::text[], $3::uuid[]) AS wanted(subject_kind, subject_id)
           ON wanted.subject_kind = r.subject_ref_kind
          AND wanted.subject_id = r.subject_ref_id
        WHERE r.workspace_id = $1
        ORDER BY r.effective_from, r.id`,
      [workspaceId, kinds, ids],
    );
    return result.rows.map((row) => ({
      assignmentId: row.assignment_id,
      role: row.role,
      subjectKind: row.subject_kind,
      subjectId: row.subject_id,
      organisationId: row.organisation_id,
      effectiveRange: { start: row.effective_from, end: row.effective_to ?? undefined } as DateInterval,
    }));
  }
}

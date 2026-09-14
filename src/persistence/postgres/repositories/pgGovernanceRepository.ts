/**
 * NORTHSTAR M2 lane P — PostgreSQL `GovernanceRepository`.
 *
 * Typed-row SQL only, exactly as for `PgTravellerRepository`: every statement
 * runs on the ambient `PgUnitOfWork` transaction client and writes only the
 * governance tables this lane owns (`organisations`, `principals`,
 * `organisation_memberships`, `responsibility_assignments`, `authority_grants`,
 * `grant_actions`, `grant_scopes`). Idempotency, head registration/advance and
 * the audit trail belong to `peopleCommands.ts`.
 *
 * F05 is the reason these three tables are separate: a human relationship, a
 * responsibility and an authority grant are distinct facts, and nothing in this
 * file writes one on behalf of another. Recording a responsibility never touches
 * `authority_grants`, and neither `organisations` nor `organisation_memberships`
 * is consulted when deciding whether a principal may act — only the grant rows
 * and their registered action kinds are (0019).
 */
import type { AuthorityGrant, ResponsibilityAssignment } from '../../../domain/v2/people/traveller.ts';
import type { LocalDate } from '../../../domain/v2/shared/time.ts';
import type { SubjectKind, TypedRef } from '../../../domain/v2/shared/identity.ts';
import { currentTransactionClient } from '../transactionContext.ts';
import type {
  ActorContext,
  GovernanceRepository,
  NewOrganisation,
  NewPrincipal,
  OrganisationMembershipRecord,
} from '../../../contracts/v2/repository/people.ts';

interface OrganisationRow {
  id: string;
  legal_name: string;
  display_name: string | null;
  default_currency_code: string;
  lifecycle_status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
}

interface PrincipalRow {
  id: string;
  auth_issuer: string;
  auth_subject: string;
  actor_type: 'HUMAN' | 'SERVICE' | 'SYSTEM';
}

interface ResponsibilityRow {
  id: string;
  organisation_id: string;
  subject_ref_kind: SubjectKind;
  subject_ref_id: string;
  role: ResponsibilityAssignment['role'];
  effective_from: string;
  effective_to: string | null;
}

interface GrantRow {
  id: string;
  principal_id: string;
  represented_party_kind: SubjectKind;
  represented_party_id: string;
  issued_by_principal_id: string;
  evidence_id: string | null;
  issued_at: Date;
  expires_at: Date | null;
  revoked_at: Date | null;
  limits: Record<string, unknown> | null;
  actions: string[];
  scopes: { kind: SubjectKind; id: string }[];
}

const DATE = (column: string): string => `to_char(${column}, 'YYYY-MM-DD')`;

/**
 * Grant children are aggregated in-statement, so one read returns a whole grant.
 * Both aggregates are ordered, which keeps a replayed command's derived value
 * byte-stable: the action vocabulary is joined (`0019`'s FK to
 * `authority_action_kinds`), never pattern-matched, and scopes keep their exact
 * `(kind, id)` pair.
 */
const GRANT_CHILD_COLUMNS = `
  (SELECT COALESCE(array_agg(a.action_kind ORDER BY a.action_kind), '{}')
     FROM grant_actions a
    WHERE a.workspace_id = g.workspace_id AND a.grant_id = g.id) AS actions,
  (SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', s.scope_kind, 'id', s.scope_id) ORDER BY s.scope_kind, s.scope_id), '[]'::jsonb)
     FROM grant_scopes s
    WHERE s.workspace_id = g.workspace_id AND s.grant_id = g.id) AS scopes`;

function toResponsibility(row: ResponsibilityRow): ResponsibilityAssignment {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    subjectRef: { kind: row.subject_ref_kind, id: row.subject_ref_id },
    role: row.role,
    effectiveRange: {
      start: row.effective_from as LocalDate,
      end: (row.effective_to ?? undefined) as LocalDate | undefined,
    },
  };
}

function toGrant(row: GrantRow): AuthorityGrant {
  // GAP(G-P11): `GovernanceReadQueries.grantsEffectiveFor` types
  // `representedPartyRef` nullable while 0019 makes both halves NOT NULL, so the
  // stored fact can never be "no represented party".
  const grant: AuthorityGrant = {
    id: row.id,
    principalId: row.principal_id,
    representedPartyRef: { kind: row.represented_party_kind, id: row.represented_party_id },
    issuedByPrincipalId: row.issued_by_principal_id,
    issuedAt: row.issued_at.toISOString(),
    actions: row.actions,
    scopes: row.scopes,
  };
  if (row.evidence_id !== null) grant.evidenceId = row.evidence_id;
  if (row.expires_at !== null) grant.expiresAt = row.expires_at.toISOString();
  if (row.revoked_at !== null) grant.revokedAt = row.revoked_at.toISOString();
  if (row.limits !== null) grant.limits = row.limits;
  return grant;
}

export class PgGovernanceRepository implements GovernanceRepository {
  private readonly workspaceId: string;

  constructor(workspaceId: string) {
    this.workspaceId = workspaceId;
  }

  /**
   * Identity-registry read for command preconditions: whether a subject id is
   * already registered in this workspace, and under which kind. A client-supplied
   * id that is already a subject must surface as a typed duplicate conflict
   * rather than as an `aggregate_heads` primary-key violation, and a TypedRef
   * whose kind does not match its id must be reportable even where a discriminating
   * FK is deferred to COMMIT. (The frozen `SubjectRegistryReadQueries` port has
   * no implementation in this lane's file set, so handlers use this typed read.)
   */
  async loadSubject(workspaceId: string, id: string): Promise<{ kind: SubjectKind; aggregateId: string } | undefined> {
    const client = currentTransactionClient();
    const result = await client.query<{ kind: SubjectKind; aggregate_id: string }>(
      'SELECT kind, aggregate_id FROM domain_subjects WHERE workspace_id = $1 AND id = $2',
      [workspaceId, id],
    );
    const row = result.rows[0];
    return row ? { kind: row.kind, aggregateId: row.aggregate_id } : undefined;
  }

  async createOrganisation(params: NewOrganisation): Promise<void> {
    const client = currentTransactionClient();
    const { organisation, actor } = params;
    await client.query(
      `INSERT INTO organisations
         (workspace_id, id, legal_name, display_name, default_currency_code, lifecycle_status, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        this.workspaceId,
        organisation.id,
        organisation.legalName,
        organisation.displayName ?? null,
        organisation.defaultCurrencyCode,
        organisation.lifecycleStatus,
        actor.actorPrincipalId,
      ],
    );
  }

  async loadOrganisation(
    workspaceId: string,
    organisationId: string,
  ): Promise<NewOrganisation['organisation'] | undefined> {
    const client = currentTransactionClient();
    const result = await client.query<OrganisationRow>(
      `SELECT id, legal_name, display_name, default_currency_code, lifecycle_status
         FROM organisations WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, organisationId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      id: row.id,
      legalName: row.legal_name,
      displayName: row.display_name ?? undefined,
      defaultCurrencyCode: row.default_currency_code,
      lifecycleStatus: row.lifecycle_status,
    };
  }

  async createPrincipal(params: NewPrincipal): Promise<void> {
    const client = currentTransactionClient();
    const { principal, actor } = params;
    await client.query(
      `INSERT INTO principals (workspace_id, id, auth_issuer, auth_subject, actor_type, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        this.workspaceId,
        principal.id,
        principal.authIssuer,
        principal.authSubject,
        principal.actorType,
        actor.actorPrincipalId,
      ],
    );
  }

  async loadPrincipal(workspaceId: string, principalId: string): Promise<NewPrincipal['principal'] | undefined> {
    const client = currentTransactionClient();
    const result = await client.query<PrincipalRow>(
      'SELECT id, auth_issuer, auth_subject, actor_type FROM principals WHERE workspace_id = $1 AND id = $2',
      [workspaceId, principalId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      id: row.id,
      actorType: row.actor_type,
      authIssuer: row.auth_issuer,
      authSubject: row.auth_subject,
    };
  }

  /**
   * Only the membership row is written here. The role vocabulary, the
   * `valid_until > valid_from` rule and 0011's `EXCLUDE USING gist`
   * no-overlapping-role rule are the database's, so this method neither
   * re-implements them nor reads them back to decide.
   */
  async recordMembership(params: {
    membership: OrganisationMembershipRecord;
    actor: ActorContext;
  }): Promise<void> {
    const client = currentTransactionClient();
    const { membership, actor } = params;
    await client.query(
      `INSERT INTO organisation_memberships
         (workspace_id, id, organisation_id, principal_id, role,
          valid_from, valid_until, evidence_id, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6::date, $7::date, $8, $9)`,
      [
        this.workspaceId,
        membership.id,
        membership.organisationId,
        membership.principalId,
        membership.role,
        membership.validRange.start,
        membership.validRange.end ?? null,
        membership.evidenceId,
        actor.actorPrincipalId,
      ],
    );
  }

  /** Writes only the assignment row; 0018's COMMIT-time assertions own the role/kind whitelist and the registry TypedRef check. */
  async assignResponsibility(params: {
    assignment: ResponsibilityAssignment;
    actor: ActorContext;
  }): Promise<void> {
    const client = currentTransactionClient();
    const { assignment } = params;
    await client.query(
      `INSERT INTO responsibility_assignments
         (workspace_id, id, organisation_id, subject_ref_kind, subject_ref_id, role,
          effective_from, effective_to, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8::date, $9)`,
      [
        this.workspaceId,
        assignment.id,
        assignment.organisationId,
        assignment.subjectRef.kind,
        assignment.subjectRef.id,
        assignment.role,
        assignment.effectiveRange.start,
        assignment.effectiveRange.end ?? null,
        params.actor.actorPrincipalId,
      ],
    );
  }

  /**
   * `idx_responsibility_assignments_subject (workspace_id, subject_ref_kind,
   * subject_ref_id)`: both halves of the TypedRef are equality predicates, so a
   * right-id/wrong-kind lookup returns nothing rather than a foreign row.
   */
  async listResponsibilityForSubject(
    workspaceId: string,
    subjectRef: TypedRef,
  ): Promise<ResponsibilityAssignment[]> {
    const client = currentTransactionClient();
    const result = await client.query<ResponsibilityRow>(
      `SELECT id, organisation_id, subject_ref_kind, subject_ref_id, role,
              ${DATE('effective_from')} AS effective_from, ${DATE('effective_to')} AS effective_to
         FROM responsibility_assignments
        WHERE workspace_id = $1 AND subject_ref_kind = $2 AND subject_ref_id = $3
        ORDER BY effective_from, id`,
      [workspaceId, subjectRef.kind, subjectRef.id],
    );
    return result.rows.map(toResponsibility);
  }

  /**
   * Identity-only receipt read, beyond the frozen port, so the issuing command
   * can refuse a citation to a receipt that will never exist. The FK is
   * deferrable, so an unbacked citation would otherwise abort the transaction at
   * COMMIT — after the handler has already returned — and
   * `PgUnitOfWork.execute` rethrows a non-retryable serialization error raw
   * rather than turning it into a typed conflict.
   *
   * A receipt inserted by the *current* transaction is invisible to this read
   * until COMMIT, which is exactly the self-citing case the deferrable FK
   * allows; callers therefore treat `false` as "not a committed receipt" and
   * decide whether that is acceptable.
   */
  async receiptIsCommitted(
    workspaceId: string,
    commandNamespace: string,
    idempotencyKey: string,
  ): Promise<boolean> {
    const client = currentTransactionClient();
    const result = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM command_receipts
          WHERE workspace_id = $1 AND command_namespace = $2 AND idempotency_key = $3
       ) AS exists`,
      [workspaceId, commandNamespace, idempotencyKey],
    );
    return result.rows[0]?.exists === true;
  }

  /**
   * Inserts the grant and both child sets in one transaction; 0019's deferred
   * `authority_grants_children_assert` is what proves the min(1) action and
   * scope rules, and the discriminating FK on `grant_scopes`/represented party
   * is what proves a TypedRef's kind.
   *
   * The authorising receipt is persisted as `(command_namespace,
   * idempotency_key)` within this workspace and 0019 checks it against
   * `command_receipts` — deferred, because `PgUnitOfWork` inserts the receipt
   * row only after this handler body has run.
   */
  async issueAuthorityGrant(params: {
    grant: AuthorityGrant;
    receipt: { commandNamespace: string; idempotencyKey: string };
    actor: ActorContext;
  }): Promise<void> {
    const client = currentTransactionClient();
    const { grant, receipt } = params;
    await client.query(
      `INSERT INTO authority_grants
         (workspace_id, id, principal_id, represented_party_kind, represented_party_id,
          issued_by_principal_id, authorising_command_namespace, authorising_idempotency_key,
          issued_at, expires_at, revoked_at, evidence_id, limits, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10::timestamptz, $11::timestamptz, $12, $13::jsonb, $14)`,
      [
        this.workspaceId,
        grant.id,
        grant.principalId,
        grant.representedPartyRef.kind,
        grant.representedPartyRef.id,
        grant.issuedByPrincipalId,
        receipt.commandNamespace,
        receipt.idempotencyKey,
        grant.issuedAt,
        grant.expiresAt ?? null,
        grant.revokedAt ?? null,
        grant.evidenceId ?? null,
        grant.limits === undefined ? null : JSON.stringify(grant.limits),
        params.actor.actorPrincipalId,
      ],
    );
    for (const actionKind of grant.actions) {
      await client.query(
        'INSERT INTO grant_actions (workspace_id, grant_id, action_kind) VALUES ($1, $2, $3)',
        [this.workspaceId, grant.id, actionKind],
      );
    }
    for (const scope of grant.scopes) {
      await client.query(
        'INSERT INTO grant_scopes (workspace_id, grant_id, scope_kind, scope_id) VALUES ($1, $2, $3, $4)',
        [this.workspaceId, grant.id, scope.kind, scope.id],
      );
    }
  }

  /**
   * Effective-as-of grant read used by the authority seam: an unrevoked grant
   * issued at or before `at` whose expiry (if any) is still after `at`, matching
   * `isGrantCurrentlyEffective`'s half-open rule exactly. Children are
   * aggregated per grant so the closed action vocabulary is joined, never
   * pattern-matched.
   */
  async listEffectiveGrants(workspaceId: string, principalId: string, at: string): Promise<AuthorityGrant[]> {
    const client = currentTransactionClient();
    const result = await client.query<GrantRow>(
      `SELECT g.id, g.principal_id, g.represented_party_kind, g.represented_party_id,
              g.issued_by_principal_id, g.evidence_id, g.issued_at, g.expires_at, g.revoked_at, g.limits,
              ${GRANT_CHILD_COLUMNS}
         FROM authority_grants g
        WHERE g.workspace_id = $1
          AND g.principal_id = $2
          AND g.revoked_at IS NULL
          AND g.issued_at <= $3::timestamptz
          AND (g.expires_at IS NULL OR g.expires_at > $3::timestamptz)
        ORDER BY g.issued_at, g.id`,
      [workspaceId, principalId, at],
    );
    return result.rows.map(toGrant);
  }

  /**
   * Single-grant read, beyond the frozen port, so a revocation command can turn
   * "no such grant" and "already revoked" into typed conflicts before it spends a
   * head advance. Unlike `listEffectiveGrants` it filters on nothing but identity:
   * an expired or revoked grant is still returned, because the stored fact — not
   * its current effectiveness — is what the precondition is about.
   */
  async loadGrant(workspaceId: string, grantId: string): Promise<AuthorityGrant | undefined> {
    const client = currentTransactionClient();
    const result = await client.query<GrantRow>(
      `SELECT g.id, g.principal_id, g.represented_party_kind, g.represented_party_id,
              g.issued_by_principal_id, g.evidence_id, g.issued_at, g.expires_at, g.revoked_at, g.limits,
              ${GRANT_CHILD_COLUMNS}
         FROM authority_grants g
        WHERE g.workspace_id = $1 AND g.id = $2`,
      [workspaceId, grantId],
    );
    const row = result.rows[0];
    return row ? toGrant(row) : undefined;
  }

  /**
   * One EXISTS over the registered action vocabulary and the exact scope
   * TypedRef. An action kind absent from `authority_action_kinds` can never have
   * a `grant_actions` row (0019's FK), so it is reported as not-authorised
   * rather than matching everything.
   */
  async mayPrincipalAct(params: {
    workspaceId: string;
    principalId: string;
    actionKind: string;
    subjectRef: TypedRef;
    at: string;
  }): Promise<boolean> {
    const client = currentTransactionClient();
    const result = await client.query<{ authorised: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM authority_grants g
           JOIN grant_actions a ON a.workspace_id = g.workspace_id AND a.grant_id = g.id
           JOIN grant_scopes s ON s.workspace_id = g.workspace_id AND s.grant_id = g.id
          WHERE g.workspace_id = $1
            AND g.principal_id = $2
            AND a.action_kind = $3
            AND s.scope_kind = $4
            AND s.scope_id = $5
            AND g.revoked_at IS NULL
            AND g.issued_at <= $6::timestamptz
            AND (g.expires_at IS NULL OR g.expires_at > $6::timestamptz)
       ) AS authorised`,
      [
        params.workspaceId,
        params.principalId,
        params.actionKind,
        params.subjectRef.kind,
        params.subjectRef.id,
        params.at,
      ],
    );
    return result.rows[0]?.authorised === true;
  }

  /**
   * Revocation is the only mutation allowed on a grant: `authority_grants` is
   * not one of the append-only tables (0019 has no `forbid_mutation` trigger),
   * and `revoked_at` is a monotonic lifecycle fact guarded by
   * `authority_grants_revocation_after_issue`. The enclosing command's expected
   * revision on the AUTHORITY_GRANT root is what makes it compare-and-set.
   */
  async revokeAuthorityGrant(params: {
    workspaceId: string;
    grantId: string;
    revokedAt: string;
    actor: ActorContext;
  }): Promise<void> {
    const client = currentTransactionClient();
    const result = await client.query(
      `UPDATE authority_grants
          SET revoked_at = $3::timestamptz, updated_at = now()
        WHERE workspace_id = $1 AND id = $2 AND revoked_at IS NULL`,
      [params.workspaceId, params.grantId, params.revokedAt],
    );
    if (result.rowCount !== 1) {
      throw new Error(
        `revokeAuthorityGrant: no un-revoked authority_grants row for ${params.workspaceId}/${params.grantId}`,
      );
    }
  }
}

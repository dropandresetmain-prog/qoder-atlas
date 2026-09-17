/**
 * Workspace authority provisioning + request principal resolution (B1).
 *
 * The consequential path needs real principals: an approver who holds an
 * `action.intent.authorize` grant covering the deterministic required scope
 * of an intent, and a dispatcher who holds `action.intent.dispatch` over the
 * same scope (`storedExecutionGate.ts`). Authority is exact TypedRef
 * coverage — there is no Organisation→Journey inheritance (grantIssuance.ts)
 * — so a workspace's operating principals are provisioned once with
 * enumerated coverage of the subjects an intent can name (PROGRAMME,
 * PROGRAMME_ITEM, TRIP, JOURNEY).
 *
 * Principals (deterministic ids per workspace):
 *  - root      SYSTEM  bootstrap issuer-of-record (the one ISSUER-POL exemption)
 *  - issuer    SYSTEM  holds `authority.grant.write` over the coverage set
 *  - operator  HUMAN   holds `action.intent.authorize`; the approving principal
 *  - executor  SERVICE holds `action.intent.dispatch`; the runtime's dispatcher
 *
 * This is provisioning, not a decision: no authority decision or approval is
 * issued here. Every step is an ordinary idempotent command (deterministic
 * ids + keys), so a restart replays. Nothing here is reachable from HTTP.
 *
 * Known limit (recorded, not hidden): coverage is enumerated at provisioning
 * time. `bootstrapIssueAuthorityGrant` only works while the workspace holds
 * zero grants, so subjects created later are NOT covered until a fresh
 * workspace is provisioned. The report says so.
 */
import { canonicalPayloadHash } from '../../persistence/postgres/canonicalHash.ts';
import type { Pool } from '../../persistence/postgres/pool.ts';
import type { PgUnitOfWork } from '../../persistence/postgres/pgUnitOfWork.ts';
import type { TypedRef } from '../../domain/v2/shared/identity.ts';
import { createPrincipal, issueAuthorityGrant, bootstrapIssueAuthorityGrant, GRANT_ISSUANCE_ACTION_KIND } from '../../persistence/postgres/commands/peopleCommands.ts';
import { AUTHORIZE_ACTION_KIND, DISPATCH_ACTION_KIND, scopeCoversRequired } from '../../resolution/authority/authorize.ts';
import { loadGrantsForPrincipal } from '../../persistence/postgres/execution/storedExecutionGate.ts';
import { deterministicUuid, RUNTIME_ID_NAMESPACES } from './deterministicId.ts';

export type WorkspaceRole = 'root' | 'issuer' | 'operator' | 'executor';

export function workspacePrincipalId(workspaceId: string, role: WorkspaceRole): string {
  return deterministicUuid(RUNTIME_ID_NAMESPACES.authority, `${workspaceId}|principal|${role}`);
}

export interface WorkspaceAuthorityReport {
  status: 'PROVISIONED' | 'ALREADY_PROVISIONED' | 'NOTHING_TO_COVER';
  principals: Record<WorkspaceRole, string>;
  coverageCount: number;
  coverageHash: string;
  /** Subjects that exist now but are not covered by the issuer's grant (provisioning happened earlier with fewer subjects). */
  uncoveredSubjectCount: number;
  representedPartyRef: TypedRef;
}

async function coverageScopes(pool: Pool, workspaceId: string): Promise<TypedRef[]> {
  const scopes: TypedRef[] = [];
  const add = async (kind: TypedRef['kind'], table: string): Promise<void> => {
    const rows = await pool.query<{ id: string }>(`SELECT id FROM ${table} WHERE workspace_id = $1 ORDER BY id`, [workspaceId]);
    for (const row of rows.rows) scopes.push({ kind, id: row.id });
  };
  await add('PROGRAMME', 'programmes');
  await add('PROGRAMME_ITEM', 'programme_items');
  await add('TRIP', 'trips');
  await add('JOURNEY', 'journeys');
  return scopes;
}

/** The organiser organisation of the workspace's event when one exists; otherwise the principal represents itself. */
async function representedParty(pool: Pool, workspaceId: string, fallbackPrincipalId: string): Promise<TypedRef> {
  const organiser = await pool.query<{ organiser_organisation_id: string | null }>(
    'SELECT organiser_organisation_id FROM events WHERE workspace_id = $1 AND organiser_organisation_id IS NOT NULL ORDER BY created_at, id LIMIT 1',
    [workspaceId],
  );
  const id = organiser.rows[0]?.organiser_organisation_id;
  return id ? { kind: 'ORGANISATION', id } : { kind: 'PRINCIPAL', id: fallbackPrincipalId };
}

async function issuerCoverage(pool: Pool, workspaceId: string, issuerId: string, now: string): Promise<TypedRef[] | undefined> {
  const grants = (await loadGrantsForPrincipal(pool, workspaceId, issuerId, now)).filter((g) => g.actions.includes(GRANT_ISSUANCE_ACTION_KIND));
  if (grants.length === 0) return undefined;
  return grants.flatMap((g) => g.scopes);
}

export async function provisionWorkspaceAuthority(params: {
  pool: Pool;
  uow: () => PgUnitOfWork;
  workspaceId: string;
  actorPrincipalId: string;
  now: string;
  operatorAuthSubject?: string;
}): Promise<WorkspaceAuthorityReport> {
  const { pool, workspaceId, actorPrincipalId, now } = params;
  const ids: Record<WorkspaceRole, string> = {
    root: workspacePrincipalId(workspaceId, 'root'),
    issuer: workspacePrincipalId(workspaceId, 'issuer'),
    operator: workspacePrincipalId(workspaceId, 'operator'),
    executor: workspacePrincipalId(workspaceId, 'executor'),
  };
  const coverage = await coverageScopes(pool, workspaceId);
  const coverageHash = canonicalPayloadHash(coverage);
  const party = await representedParty(pool, workspaceId, ids.operator);
  const base = { workspaceId, actorPrincipalId };

  const principalSpecs: Array<{ role: WorkspaceRole; actorType: 'HUMAN' | 'SERVICE' | 'SYSTEM'; subject: string }> = [
    { role: 'root', actorType: 'SYSTEM', subject: `northstar:bootstrap:${workspaceId}` },
    { role: 'issuer', actorType: 'SYSTEM', subject: `northstar:issuer:${workspaceId}` },
    { role: 'operator', actorType: 'HUMAN', subject: params.operatorAuthSubject ?? `northstar:operator:${workspaceId}` },
    { role: 'executor', actorType: 'SERVICE', subject: `northstar:executor:${workspaceId}` },
  ];
  for (const spec of principalSpecs) {
    const created = await createPrincipal(params.uow(), {
      ...base,
      idempotencyKey: `workspace-authority:${workspaceId}:principal:${spec.role}`,
      principalId: ids[spec.role],
      actorType: spec.actorType,
      authIssuer: 'urn:northstar:workspace',
      authSubject: spec.subject,
    });
    if (!created.ok && created.conflict.kind !== 'DUPLICATE_REGISTRATION') {
      throw new Error(`workspace authority: cannot create ${spec.role} principal: ${created.conflict.kind}: ${created.conflict.message}`);
    }
  }

  if (coverage.length === 0) {
    return { status: 'NOTHING_TO_COVER', principals: ids, coverageCount: 0, coverageHash, uncoveredSubjectCount: 0, representedPartyRef: party };
  }

  const existingIssuer = await issuerCoverage(pool, workspaceId, ids.issuer, now);
  if (existingIssuer !== undefined) {
    const uncovered = coverage.filter((need) => !scopeCoversRequired(existingIssuer, [need])).length;
    return { status: 'ALREADY_PROVISIONED', principals: ids, coverageCount: coverage.length, coverageHash, uncoveredSubjectCount: uncovered, representedPartyRef: party };
  }

  const issuerKey = `workspace-authority:${workspaceId}:grant:issuer:${coverageHash}`;
  const issuerGrant = await bootstrapIssueAuthorityGrant(params.uow(), {
    ...base,
    idempotencyKey: issuerKey,
    grantId: deterministicUuid(RUNTIME_ID_NAMESPACES.authority, issuerKey),
    principalId: ids.issuer,
    representedPartyRef: { kind: 'PRINCIPAL', id: ids.issuer },
    issuedByPrincipalId: ids.root,
    issuedAt: now,
    actions: [GRANT_ISSUANCE_ACTION_KIND],
    scopes: coverage,
    authorisingReceipt: { commandNamespace: 'AUTHORITY_GRANT_ISSUED', idempotencyKey: issuerKey },
    expectedAggregateRevisions: [],
  });
  if (!issuerGrant.ok) throw new Error(`workspace authority: issuer bootstrap failed: ${issuerGrant.conflict.kind}: ${issuerGrant.conflict.message}`);

  for (const [role, actions] of [['operator', [AUTHORIZE_ACTION_KIND]], ['executor', [DISPATCH_ACTION_KIND]]] as const) {
    const key = `workspace-authority:${workspaceId}:grant:${role}:${coverageHash}`;
    const grant = await issueAuthorityGrant(params.uow(), {
      ...base,
      idempotencyKey: key,
      grantId: deterministicUuid(RUNTIME_ID_NAMESPACES.authority, key),
      principalId: ids[role],
      representedPartyRef: party,
      issuedByPrincipalId: ids.issuer,
      issuedAt: now,
      actions: [...actions],
      scopes: coverage,
      authorisingReceipt: { commandNamespace: 'AUTHORITY_GRANT_ISSUED', idempotencyKey: key },
      expectedAggregateRevisions: [],
    });
    if (!grant.ok) throw new Error(`workspace authority: ${role} grant failed: ${grant.conflict.kind}: ${grant.conflict.message}`);
  }
  return { status: 'PROVISIONED', principals: ids, coverageCount: coverage.length, coverageHash, uncoveredSubjectCount: 0, representedPartyRef: party };
}

/** HTTP request principal: an explicit, existing principal id, else the workspace operator. Never a fabricated identity. */
export async function resolveRequestPrincipal(
  pool: Pool,
  workspaceId: string,
  headerValue: string | undefined,
): Promise<{ ok: true; principalId: string; source: 'HEADER' | 'WORKSPACE_OPERATOR' } | { ok: false; reason: string }> {
  const candidate = headerValue?.trim() || workspacePrincipalId(workspaceId, 'operator');
  const found = await pool.query<{ id: string; status: string }>('SELECT id, status FROM principals WHERE workspace_id = $1 AND id = $2', [workspaceId, candidate]);
  const row = found.rows[0];
  if (!row) return { ok: false, reason: headerValue ? `principal ${candidate} is not registered in this workspace` : 'workspace operator principal is not provisioned' };
  if (row.status !== 'ACTIVE') return { ok: false, reason: `principal ${candidate} is ${row.status}` };
  return { ok: true, principalId: row.id, source: headerValue?.trim() ? 'HEADER' : 'WORKSPACE_OPERATOR' };
}

import type { Pool } from '../../persistence/postgres/pool.ts';
import type { PgUnitOfWork } from '../../persistence/postgres/pgUnitOfWork.ts';
import type { TypedRef } from '../../domain/v2/shared/identity.ts';
import { InstantSchema } from '../../domain/v2/shared/time.ts';
import { issueAuthorityGrant } from '../../persistence/postgres/commands/peopleCommands.ts';
import { loadGrantsForPrincipal } from '../../persistence/postgres/execution/storedExecutionGate.ts';
import { scopeCoversRequired } from '../../resolution/authority/authorize.ts';
import { deterministicUuid, RUNTIME_ID_NAMESPACES } from './deterministicId.ts';
import { workspacePrincipalId } from './workspaceAuthority.ts';

const REQUEST_ACTION = 'change.request.submit';
const GRANT_ISSUANCE_ACTION = 'authority.grant.write';

export type RequestAuthoritySkipReason =
  | 'JOURNEY_OUTSIDE_ISSUER_SCOPE'
  | 'ISSUER_UNAUTHORISED'
  | 'OPERATOR_NOT_PROVISIONED'
  | 'EXISTING_GRANT_PRESERVED'
  | 'GRANT_ISSUANCE_FAILED';

export interface RequestAuthoritySkippedJourney {
  journeyId: string;
  representedTravellerId: string;
  reason: RequestAuthoritySkipReason;
  detail?: string;
}

export interface WorkspaceRequestAuthorityReport {
  status: 'PROVISIONED' | 'PARTIAL' | 'ALREADY_PROVISIONED' | 'NOTHING_TO_PROVISION';
  operatorPrincipalId: string;
  issuerPrincipalId: string;
  journeyCount: number;
  provisionedCount: number;
  skipped: RequestAuthoritySkippedJourney[];
}

interface JourneyRow {
  id: string;
  traveller_id: string;
}

interface ExistingGrantRow {
  id: string;
  principal_id: string;
  represented_party_kind: string;
  represented_party_id: string;
  issued_by_principal_id: string;
  issued_at: Date;
  expires_at: Date | null;
  revoked_at: Date | null;
  action_kinds: string[] | null;
  scope_refs: { kind: string; id: string }[] | null;
}

function grantId(workspaceId: string, operatorPrincipalId: string, journeyId: string): string {
  return deterministicUuid(
    RUNTIME_ID_NAMESPACES.authority,
    `${workspaceId}|request-authority|${operatorPrincipalId}|${journeyId}`,
  );
}

function grantKey(workspaceId: string, operatorPrincipalId: string, journeyId: string): string {
  return `workspace-request-authority:${workspaceId}:${operatorPrincipalId}:${journeyId}`;
}

function exactRequestGrant(row: ExistingGrantRow, issuerPrincipalId: string, journeyId: string, travellerId: string): boolean {
  const actions = row.action_kinds ?? [];
  const scopes = row.scope_refs ?? [];
  return row.principal_id === row.principal_id
    && row.represented_party_kind === 'TRAVELLER'
    && row.represented_party_id === travellerId
    && row.issued_by_principal_id === issuerPrincipalId
    && actions.length === 1
    && actions[0] === REQUEST_ACTION
    && scopes.length === 1
    && scopes[0]?.kind === 'JOURNEY'
    && scopes[0]?.id === journeyId;
}

async function journeys(pool: Pool, workspaceId: string): Promise<JourneyRow[]> {
  const result = await pool.query<JourneyRow>(
    'SELECT id, traveller_id FROM journeys WHERE workspace_id = $1 ORDER BY id',
    [workspaceId],
  );
  return result.rows;
}

async function existingGrants(pool: Pool, workspaceId: string, operatorPrincipalId: string): Promise<ExistingGrantRow[]> {
  const result = await pool.query<ExistingGrantRow>(
    `SELECT g.id, g.principal_id, g.represented_party_kind, g.represented_party_id,
            g.issued_by_principal_id, g.issued_at, g.expires_at, g.revoked_at,
            (SELECT COALESCE(array_agg(a.action_kind ORDER BY a.action_kind), '{}')
               FROM grant_actions a
              WHERE a.workspace_id = g.workspace_id AND a.grant_id = g.id) AS action_kinds,
            (SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', s.scope_kind, 'id', s.scope_id)
                                       ORDER BY s.scope_kind, s.scope_id), '[]'::jsonb)
               FROM grant_scopes s
              WHERE s.workspace_id = g.workspace_id AND s.grant_id = g.id) AS scope_refs
       FROM authority_grants g
      WHERE g.workspace_id = $1 AND g.principal_id = $2
      ORDER BY g.id`,
    [workspaceId, operatorPrincipalId],
  );
  return result.rows;
}

async function principalStatus(pool: Pool, workspaceId: string, principalId: string): Promise<string | undefined> {
  const result = await pool.query<{ status: string }>(
    'SELECT status FROM principals WHERE workspace_id = $1 AND id = $2',
    [workspaceId, principalId],
  );
  return result.rows[0]?.status;
}

/**
 * Provision only the workspace operator's exact request authority for the
 * Journey rows already covered by the existing workspace issuer. This is a
 * boot/provisioning seam; it never creates principals, uses bootstrap grant
 * issuance, inherits Organisation scope, or grants execution/funding power.
 */
export async function provisionWorkspaceRequestAuthority(params: {
  pool: Pool;
  uow: () => PgUnitOfWork;
  workspaceId: string;
  actorPrincipalId: string;
  now: string;
}): Promise<WorkspaceRequestAuthorityReport> {
  const now = InstantSchema.parse(params.now);
  const operatorPrincipalId = workspacePrincipalId(params.workspaceId, 'operator');
  const issuerPrincipalId = workspacePrincipalId(params.workspaceId, 'issuer');
  const rows = await journeys(params.pool, params.workspaceId);
  const skipped: RequestAuthoritySkippedJourney[] = [];
  if (rows.length === 0) {
    return {
      status: 'NOTHING_TO_PROVISION', operatorPrincipalId, issuerPrincipalId,
      journeyCount: 0, provisionedCount: 0, skipped,
    };
  }

  if ((await principalStatus(params.pool, params.workspaceId, operatorPrincipalId)) !== 'ACTIVE') {
    for (const row of rows) skipped.push({ journeyId: row.id, representedTravellerId: row.traveller_id, reason: 'OPERATOR_NOT_PROVISIONED' });
    return {
      status: 'ALREADY_PROVISIONED', operatorPrincipalId, issuerPrincipalId,
      journeyCount: rows.length, provisionedCount: 0, skipped,
    };
  }

  const issuerGrants = (await loadGrantsForPrincipal(params.pool, params.workspaceId, issuerPrincipalId, now))
    .filter((grant) => grant.actions.includes(GRANT_ISSUANCE_ACTION));
  const existing = await existingGrants(params.pool, params.workspaceId, operatorPrincipalId);
  let provisionedCount = 0;

  for (const row of rows) {
    const stableGrantId = grantId(params.workspaceId, operatorPrincipalId, row.id);
    const stableExisting = existing.find((grant) => grant.id === stableGrantId);
    const semanticExisting = existing.find((grant) => exactRequestGrant(grant, issuerPrincipalId, row.id, row.traveller_id));
    if (stableExisting || semanticExisting) {
      const preserved = stableExisting ?? semanticExisting!;
      const state = preserved.revoked_at
        ? `revoked at ${preserved.revoked_at.toISOString()}`
        : preserved.expires_at
          ? `expires at ${preserved.expires_at.toISOString()}`
          : 'already present';
      skipped.push({
        journeyId: row.id, representedTravellerId: row.traveller_id,
        reason: 'EXISTING_GRANT_PRESERVED', detail: `grant ${preserved.id} ${state}`,
      });
      continue;
    }

    const requiredScope: TypedRef = { kind: 'JOURNEY', id: row.id };
    const issuerCoversJourney = issuerGrants.some((grant) => scopeCoversRequired(grant.scopes, [requiredScope]));
    if (!issuerCoversJourney) {
      skipped.push({
        journeyId: row.id, representedTravellerId: row.traveller_id,
        reason: issuerGrants.length > 0 ? 'JOURNEY_OUTSIDE_ISSUER_SCOPE' : 'ISSUER_UNAUTHORISED',
      });
      continue;
    }

    const key = grantKey(params.workspaceId, operatorPrincipalId, row.id);
    const issued = await issueAuthorityGrant(params.uow(), {
      workspaceId: params.workspaceId,
      actorPrincipalId: params.actorPrincipalId,
      idempotencyKey: key,
      grantId: stableGrantId,
      principalId: operatorPrincipalId,
      representedPartyRef: { kind: 'TRAVELLER', id: row.traveller_id },
      issuedByPrincipalId: issuerPrincipalId,
      issuedAt: now,
      actions: [REQUEST_ACTION],
      scopes: [requiredScope],
      authorisingReceipt: { commandNamespace: 'AUTHORITY_GRANT_ISSUED', idempotencyKey: key },
      expectedAggregateRevisions: [],
    });
    if (!issued.ok) {
      skipped.push({
        journeyId: row.id, representedTravellerId: row.traveller_id,
        reason: 'GRANT_ISSUANCE_FAILED', detail: `${issued.conflict.kind}: ${issued.conflict.message}`,
      });
      continue;
    }
    provisionedCount++;
  }

  const status = provisionedCount === 0
    ? (skipped.length > 0 ? 'ALREADY_PROVISIONED' : 'NOTHING_TO_PROVISION')
    : skipped.length > 0 ? 'PARTIAL' : 'PROVISIONED';
  return { status, operatorPrincipalId, issuerPrincipalId, journeyCount: rows.length, provisionedCount, skipped };
}

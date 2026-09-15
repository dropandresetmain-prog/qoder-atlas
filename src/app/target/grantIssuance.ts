/**
 * M9 R-10 — practical application grant issuance.
 *
 * Wraps the real `issueAuthorityGrant` command. Callers cannot loosen the
 * deterministic required scope: this facade unions intent-derived required
 * scopes into the grant and rejects any attempt to issue a strictly weaker
 * scope set than required.
 *
 * No Organisation→Journey inheritance. Exact TypedRef containment only.
 * If product later requires org-wide journey coverage, stop and write an
 * architecture decision — do not silently implement broad inheritance.
 */
import { randomUUID } from 'node:crypto';
import type { UnitOfWork } from '../../contracts/v2/command/unitOfWork.ts';
import type { TypedRef } from '../../domain/v2/shared/identity.ts';
import { typedConflict } from '../../domain/v2/shared/errors.ts';
import { scopeCoversRequired } from '../../resolution/authority/authorize.ts';
import {
  createOrganisation,
  createPrincipal,
  issueAuthorityGrant,
  type IssueAuthorityGrantParams,
} from '../../persistence/postgres/commands/peopleCommands.ts';
import type { ExecuteOutcome } from '../../persistence/postgres/pgUnitOfWork.ts';

export interface RequiredGrantIssuanceInput {
  workspaceId: string;
  actorPrincipalId: string;
  idempotencyKey: string;
  /** Principal that will hold the grant (organiser / operator). */
  principalId: string;
  /** Party the principal represents — Traveller or Organisation, never implied. */
  representedPartyRef: TypedRef;
  issuedByPrincipalId: string;
  issuedAt: string;
  expiresAt?: string;
  actions: IssueAuthorityGrantParams['actions'];
  /**
   * Caller-proposed scopes. Must cover `requiredScopes` by exact TypedRef
   * containment. Extra scopes are allowed; weaker/missing required scopes fail.
   */
  proposedScopes: TypedRef[];
  /** Deterministic required scopes (from intent subjects + resolved Journey/Trip). */
  requiredScopes: TypedRef[];
  authorisingReceipt?: IssueAuthorityGrantParams['authorisingReceipt'];
  grantId?: string;
  evidenceId?: string;
  limits?: IssueAuthorityGrantParams['limits'];
}

export type GrantIssuanceResult = {
  grantId: string;
  scopes: TypedRef[];
  requiredScopes: TypedRef[];
};

function refKey(ref: TypedRef): string {
  return `${ref.kind}:${ref.id}`;
}

/** True when proposed covers every required scope by exact kind+id match. */
export function proposedCoversRequired(proposed: readonly TypedRef[], required: readonly TypedRef[]): boolean {
  return scopeCoversRequired([...proposed], [...required]);
}

/**
 * Issue a grant that is at least as strong as the deterministic required scope.
 * Caller cannot choose a weaker scope than required.
 */
export async function issueRequiredAuthorityGrant(
  uow: UnitOfWork,
  input: RequiredGrantIssuanceInput,
): Promise<ExecuteOutcome<GrantIssuanceResult>> {
  if (input.requiredScopes.length === 0) {
    return {
      ok: false,
      conflict: typedConflict('VALIDATION_FAILED', 'requiredScopes must be non-empty for consequential grant issuance', []),
    };
  }
  if (!proposedCoversRequired(input.proposedScopes, input.requiredScopes)) {
    return {
      ok: false,
      conflict: typedConflict(
        'VALIDATION_FAILED',
        'GRANT_SCOPE_INSUFFICIENT: proposed scopes do not cover deterministic required scopes',
        input.requiredScopes,
      ),
    };
  }

  // Union proposed ∪ required so the stored grant always includes required refs
  // even if the caller listed supersets with different ordering.
  const scopeMap = new Map<string, TypedRef>();
  for (const scope of [...input.requiredScopes, ...input.proposedScopes]) {
    scopeMap.set(refKey(scope), scope);
  }
  const scopes = [...scopeMap.values()];
  const grantId = input.grantId ?? randomUUID();
  const authorisingReceipt = input.authorisingReceipt ?? {
    commandNamespace: 'AUTHORITY_GRANT_ISSUED',
    idempotencyKey: input.idempotencyKey,
  };

  const outcome = await issueAuthorityGrant(uow, {
    workspaceId: input.workspaceId,
    actorPrincipalId: input.actorPrincipalId,
    idempotencyKey: input.idempotencyKey,
    grantId,
    principalId: input.principalId,
    representedPartyRef: input.representedPartyRef,
    issuedByPrincipalId: input.issuedByPrincipalId,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    actions: input.actions,
    scopes,
    limits: input.limits,
    evidenceId: input.evidenceId,
    authorisingReceipt,
    expectedAggregateRevisions: [],
  });

  if (!outcome.ok) return outcome;
  return {
    ok: true,
    value: {
      grantId: outcome.value.grantId,
      scopes,
      requiredScopes: [...input.requiredScopes],
    },
    receipt: outcome.receipt,
  };
}

/** Demo/config bootstrap: create organiser principal + org + grant via real commands. */
export async function provisionOrganiserAuthority(params: {
  uow: UnitOfWork;
  workspaceId: string;
  actorPrincipalId: string;
  organisationLegalName: string;
  organisationDisplayName?: string;
  authIssuer: string;
  authSubject: string;
  representedPartyRef: TypedRef;
  requiredScopes: TypedRef[];
  actions: IssueAuthorityGrantParams['actions'];
  issuedAt: string;
  defaultCurrencyCode?: string;
  actorType?: 'HUMAN' | 'SERVICE' | 'SYSTEM';
}): Promise<ExecuteOutcome<{
  organisationId: string;
  principalId: string;
  grantId: string;
}>> {
  const orgKey = randomUUID();
  const org = await createOrganisation(params.uow, {
    workspaceId: params.workspaceId,
    actorPrincipalId: params.actorPrincipalId,
    idempotencyKey: `org:${orgKey}`,
    organisationId: orgKey,
    legalName: params.organisationLegalName,
    displayName: params.organisationDisplayName,
    defaultCurrencyCode: params.defaultCurrencyCode ?? 'USD',
  });
  if (!org.ok) return org;

  const principalId = randomUUID();
  const principal = await createPrincipal(params.uow, {
    workspaceId: params.workspaceId,
    actorPrincipalId: params.actorPrincipalId,
    idempotencyKey: `principal:${principalId}`,
    principalId,
    actorType: params.actorType ?? 'HUMAN',
    authIssuer: params.authIssuer,
    authSubject: params.authSubject,
  });
  if (!principal.ok) return principal;

  const grantKey = randomUUID();
  const grant = await issueRequiredAuthorityGrant(params.uow, {
    workspaceId: params.workspaceId,
    actorPrincipalId: params.actorPrincipalId,
    idempotencyKey: `grant:${grantKey}`,
    principalId,
    representedPartyRef: params.representedPartyRef,
    issuedByPrincipalId: principalId,
    issuedAt: params.issuedAt,
    actions: params.actions,
    proposedScopes: params.requiredScopes,
    requiredScopes: params.requiredScopes,
  });
  if (!grant.ok) return grant;

  return {
    ok: true,
    value: {
      organisationId: org.value.organisationId,
      principalId,
      grantId: grant.value.grantId,
    },
    receipt: grant.receipt,
  };
}

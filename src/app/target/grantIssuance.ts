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
 *
 * ISSUER-POL (M10): self-issuance rejection and issuer-authority-coverage
 * enforcement now live in `issueAuthorityGrant` itself
 * (`persistence/postgres/commands/peopleCommands.ts`), not only here — any
 * caller of that command gets the same protection, not just this facade.
 * This file's own job is narrower: compute/validate the required-vs-proposed
 * scope union (a product-layer concern, not an authority-policy one), and
 * route the one legitimate bootstrap case to the command's dedicated
 * `bootstrapIssueAuthorityGrant` export — never reachable from
 * `targetHttpHandlers.ts` or any ordinary application command.
 */
import { randomUUID } from 'node:crypto';
import type { UnitOfWork } from '../../contracts/v2/command/unitOfWork.ts';
import type { TypedRef } from '../../domain/v2/shared/identity.ts';
import { typedConflict, type TypedConflict } from '../../domain/v2/shared/errors.ts';
import { scopeCoversRequired } from '../../resolution/authority/authorize.ts';
import {
  createOrganisation,
  createPrincipal,
  issueAuthorityGrant,
  bootstrapIssueAuthorityGrant as bootstrapIssueAuthorityGrantCommand,
  GRANT_ISSUANCE_ACTION_KIND,
  type IssueAuthorityGrantParams,
} from '../../persistence/postgres/commands/peopleCommands.ts';
import type { ExecuteOutcome } from '../../persistence/postgres/pgUnitOfWork.ts';

export { GRANT_ISSUANCE_ACTION_KIND };

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

function unionScopes(a: readonly TypedRef[], b: readonly TypedRef[]): TypedRef[] {
  const scopeMap = new Map<string, TypedRef>();
  for (const scope of [...a, ...b]) scopeMap.set(refKey(scope), scope);
  return [...scopeMap.values()];
}

/** Validates the required/proposed scope invariant; returns the union or a conflict. */
function buildGrantScopesOrConflict(
  input: Pick<RequiredGrantIssuanceInput, 'requiredScopes' | 'proposedScopes'>,
): { ok: true; scopes: TypedRef[] } | { ok: false; conflict: TypedConflict } {
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
  return { ok: true, scopes: unionScopes(input.requiredScopes, input.proposedScopes) };
}

/**
 * Issue a grant that is at least as strong as the deterministic required scope.
 * Caller cannot choose a weaker scope than required. Normal M9/M10 issuance
 * path: `issueAuthorityGrant` (the command) enforces ISSUER-POL itself — the
 * issuer must already hold grant-issuing authority, self-issuance is
 * rejected — so this facade no longer duplicates that check; it only builds
 * the scope union and surfaces whatever conflict the command returns.
 */
export async function issueRequiredAuthorityGrant(
  uow: UnitOfWork,
  input: RequiredGrantIssuanceInput,
): Promise<ExecuteOutcome<GrantIssuanceResult>> {
  const built = buildGrantScopesOrConflict(input);
  if (!built.ok) return built;
  const scopes = built.scopes;

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

/**
 * BOOTSTRAP-ONLY grant issuance (the sole ISSUER-POL exemption).
 *
 * Seeds the very first `authority.grant.write`-holding principal in a fresh
 * workspace so the normal `issueRequiredAuthorityGrant` path (which requires
 * the issuer to already hold that authority) has something to build on.
 *
 * Never call this from `targetHttpHandlers.ts` or any ordinary application
 * command — it is not exported through `applicationCommands.ts` and no
 * `/api/v2/*` route may reach it, directly or indirectly.
 */
async function bootstrapIssueAuthorityGrant(
  uow: UnitOfWork,
  input: RequiredGrantIssuanceInput,
): Promise<ExecuteOutcome<GrantIssuanceResult>> {
  const built = buildGrantScopesOrConflict(input);
  if (!built.ok) return built;
  const scopes = built.scopes;

  const grantId = input.grantId ?? randomUUID();
  const authorisingReceipt = input.authorisingReceipt ?? {
    commandNamespace: 'AUTHORITY_GRANT_ISSUED',
    idempotencyKey: input.idempotencyKey,
  };

  const outcome = await bootstrapIssueAuthorityGrantCommand(uow, {
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

/**
 * Demo/config bootstrap: create organiser principal + org + grant via real
 * commands. The organiser principal never mints its own authority — a
 * dedicated bootstrap system principal (created here, scoped to this call)
 * is the issuer of record (ISSUER-POL).
 */
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

  // Bootstrap system principal: never the organiser itself. Exists solely to
  // be the issuer-of-record for the organiser's first grant in this workspace.
  const bootstrapPrincipalId = randomUUID();
  const bootstrapPrincipal = await createPrincipal(params.uow, {
    workspaceId: params.workspaceId,
    actorPrincipalId: params.actorPrincipalId,
    idempotencyKey: `bootstrap-principal:${bootstrapPrincipalId}`,
    principalId: bootstrapPrincipalId,
    actorType: 'SYSTEM',
    authIssuer: 'urn:northstar:bootstrap',
    authSubject: `bootstrap:${params.workspaceId}`,
  });
  if (!bootstrapPrincipal.ok) return bootstrapPrincipal;

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
  const grant = await bootstrapIssueAuthorityGrant(params.uow, {
    workspaceId: params.workspaceId,
    actorPrincipalId: params.actorPrincipalId,
    idempotencyKey: `grant:${grantKey}`,
    principalId,
    representedPartyRef: params.representedPartyRef,
    issuedByPrincipalId: bootstrapPrincipalId,
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

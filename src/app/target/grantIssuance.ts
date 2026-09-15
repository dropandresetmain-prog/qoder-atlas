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
 * ISSUER-POL (bounded, M9): migration 0019 flags "Grant issuer must have
 * issuance authority" as an architecture gap with no governing policy table.
 * A full table-enforced policy is left for a later milestone, but the normal
 * M9 issuance path below must not rely on unrestricted self-issuance:
 *  - the issuer must already hold a live `authority.grant.write` grant whose
 *    scope covers every scope being granted (reusing the M2 action-kind
 *    vocabulary — no new action kind invented);
 *  - a principal can never issue a grant to itself;
 *  - the one bootstrap exemption (`provisionOrganiserAuthority` /
 *    `bootstrapIssueAuthorityGrant`) seeds the very first such grant in a
 *    fresh workspace using a dedicated system principal as issuer — never
 *    the organiser itself — and is never reachable from `targetHttpHandlers.ts`
 *    or any ordinary application command.
 */
import { randomUUID } from 'node:crypto';
import type { UnitOfWork } from '../../contracts/v2/command/unitOfWork.ts';
import type { TypedRef } from '../../domain/v2/shared/identity.ts';
import { typedConflict, type TypedConflict } from '../../domain/v2/shared/errors.ts';
import { scopeCoversRequired } from '../../resolution/authority/authorize.ts';
import { loadGrantsForPrincipal } from '../../persistence/postgres/execution/storedExecutionGate.ts';
import type { Pool } from '../../persistence/postgres/pool.ts';
import {
  createOrganisation,
  createPrincipal,
  issueAuthorityGrant,
  type IssueAuthorityGrantParams,
} from '../../persistence/postgres/commands/peopleCommands.ts';
import type { ExecuteOutcome } from '../../persistence/postgres/pgUnitOfWork.ts';

/** Reused M2 action-kind vocabulary (0019) — the marker for grant-issuing authority. */
export const GRANT_ISSUANCE_ACTION_KIND = 'authority.grant.write';

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
  /** Read access used to verify the issuer holds grant-issuing authority (ISSUER-POL). */
  pool: Pool;
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
 * ISSUER-POL: the issuer must already hold a live `authority.grant.write`
 * grant whose scope covers every scope about to be issued, and a principal
 * may never issue a grant to itself. Bounded, application-level check — not
 * yet a table-enforced DB constraint (0019 gap remains recorded as such).
 */
async function assertIssuerMayIssue(
  pool: Pool,
  workspaceId: string,
  issuedByPrincipalId: string,
  principalId: string,
  targetScopes: readonly TypedRef[],
  now: string,
): Promise<TypedConflict | null> {
  if (issuedByPrincipalId === principalId) {
    return typedConflict(
      'VALIDATION_FAILED',
      `ISSUER_SELF_ISSUANCE_FORBIDDEN: principal ${principalId} cannot mint its own authority grant`,
      [],
    );
  }
  const issuerGrants = await loadGrantsForPrincipal(pool, workspaceId, issuedByPrincipalId, now);
  const issuing = issuerGrants.filter((g) => g.actions.includes(GRANT_ISSUANCE_ACTION_KIND));
  if (issuing.length === 0) {
    return typedConflict(
      'VALIDATION_FAILED',
      `ISSUER_UNAUTHORISED: ${issuedByPrincipalId} holds no live ${GRANT_ISSUANCE_ACTION_KIND} grant`,
      [],
    );
  }
  const covering = issuing.some((g) => scopeCoversRequired(g.scopes, targetScopes));
  if (!covering) {
    return typedConflict(
      'VALIDATION_FAILED',
      `ISSUER_SCOPE_INSUFFICIENT: ${issuedByPrincipalId} grant-issuing scope does not cover the scopes being issued`,
      [],
    );
  }
  return null;
}

/**
 * Issue a grant that is at least as strong as the deterministic required scope.
 * Caller cannot choose a weaker scope than required. Normal M9 issuance path:
 * the issuer must already hold grant-issuing authority (ISSUER-POL) — this is
 * NOT self-issuance and NOT the bootstrap exemption below.
 */
export async function issueRequiredAuthorityGrant(
  uow: UnitOfWork,
  input: RequiredGrantIssuanceInput,
): Promise<ExecuteOutcome<GrantIssuanceResult>> {
  const built = buildGrantScopesOrConflict(input);
  if (!built.ok) return built;
  const scopes = built.scopes;

  const issuerDenied = await assertIssuerMayIssue(
    input.pool,
    input.workspaceId,
    input.issuedByPrincipalId,
    input.principalId,
    scopes,
    input.issuedAt,
  );
  if (issuerDenied) return { ok: false, conflict: issuerDenied };

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
  input: Omit<RequiredGrantIssuanceInput, 'pool'>,
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

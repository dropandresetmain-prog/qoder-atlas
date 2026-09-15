/**
 * NORTHSTAR M8 — authorize / dispatch gate composing Checkpoint-0 gates,
 * envelope fingerprint, grants, and multi-actor approvals.
 *
 * C3 round 2 (AN-7): a dispatch grant counts only when its scopes cover every
 * envelope scope ref (exact TypedRef containment, matching M2 mayPrincipalAct).
 * An approval counts only when its approver holds a live authorize grant that
 * covers the same envelope scope (and matches required_party when set).
 */
import type { AssessmentView } from '../../persistence/postgres/world/pgAssessments.ts';
import type { AuthorityEnvelope, Approval, ApprovalRevocation, AuthorityDecision } from '../../contracts/v2/authority/authorityEnvelope.ts';
import { approvalCoversEnvelope, authorityIsSatisfied } from '../../contracts/v2/authority/authorityEnvelope.ts';
import type { AuthorityGrant } from '../../domain/v2/people/traveller.ts';
import type { TypedRef } from '../../domain/v2/shared/identity.ts';
import { evaluateAuthorityDecisionGates } from './decisionGates.ts';
import { computeEnvelopeFingerprint, type EnvelopeFingerprintInput } from './envelope.ts';
import { compareExactMoney, type ExactMoney } from '../../domain/v2/shared/money.ts';
import type { Instant } from '../../domain/v2/shared/time.ts';
import { compareInstants } from '../../domain/v2/shared/time.ts';

export const DISPATCH_ACTION_KIND = 'action.intent.dispatch';
export const AUTHORIZE_ACTION_KIND = 'action.intent.authorize';

export type AuthorizeDenialReason =
  | 'ASSESSMENT_NOT_CURRENT'
  | 'PAYER_HOME_CURRENCY_UNKNOWN'
  | 'ENVELOPE_MISMATCH'
  | 'APPROVALS_INCOMPLETE'
  | 'GRANT_MISSING'
  | 'GRANT_EXPIRED'
  | 'GRANT_REVOKED'
  | 'GRANT_SCOPE_INSUFFICIENT'
  | 'APPROVER_UNAUTHORIZED'
  | 'APPROVER_PARTY_MISMATCH'
  | 'AMOUNT_CEILING_EXCEEDED'
  | 'PRINCIPAL_REQUIRED'
  | 'ORG_IS_NOT_PRINCIPAL';

export type AuthorizeResult =
  | { allowed: true; envelopeFingerprint: string }
  | { allowed: false; reason: AuthorizeDenialReason; detail?: string };

/**
 * Organisation and Traveller are never authenticated principals. Descriptive
 * membership/guardian roles do not grant execution authority.
 */
export function assertAuthenticatedPrincipal(principalId: string | undefined): AuthorizeResult | null {
  if (!principalId || principalId.length === 0) {
    return { allowed: false, reason: 'PRINCIPAL_REQUIRED', detail: 'authenticated principal required' };
  }
  return null;
}

export function descriptiveRoleIsNotAuthority(): true {
  return true;
}

/** Exact TypedRef containment — same semantics as M2 `mayPrincipalAct` scope match. */
export function grantCoversEnvelopeScopes(grant: AuthorityGrant, envelopeScopes: readonly TypedRef[]): boolean {
  if (envelopeScopes.length === 0) return false;
  return envelopeScopes.every((scope) =>
    grant.scopes.some((gs) => gs.kind === scope.kind && gs.id === scope.id),
  );
}

function grantIsLive(grant: AuthorityGrant, now: Instant): boolean {
  return grant.revokedAt === undefined
    && compareInstants(now, grant.issuedAt) >= 0
    && (grant.expiresAt === undefined || compareInstants(now, grant.expiresAt) < 0);
}

function liveActionGrants(
  grants: readonly AuthorityGrant[],
  principalId: string,
  actionKind: string,
  now: Instant,
): AuthorityGrant[] {
  return grants.filter((g) =>
    g.principalId === principalId
    && g.actions.includes(actionKind)
    && grantIsLive(g, now),
  );
}

/** Approver must hold a live authorize grant covering envelope scope (+ required party). */
export function evaluateApproverAuthority(params: {
  approval: Approval;
  requirement: AuthorityDecision['requirements'][number];
  envelopeScopes: readonly TypedRef[];
  grants: readonly AuthorityGrant[];
  now: Instant;
}): AuthorizeResult | null {
  const live = liveActionGrants(params.grants, params.approval.approverPrincipalId, AUTHORIZE_ACTION_KIND, params.now);
  if (live.length === 0) {
    const matching = params.grants.filter((g) =>
      g.principalId === params.approval.approverPrincipalId && g.actions.includes(AUTHORIZE_ACTION_KIND),
    );
    const revoked = matching.some((g) => g.revokedAt !== undefined);
    const expired = matching.some((g) =>
      g.revokedAt === undefined && g.expiresAt !== undefined && compareInstants(params.now, g.expiresAt) >= 0,
    );
    return {
      allowed: false,
      reason: revoked ? 'GRANT_REVOKED' : expired ? 'GRANT_EXPIRED' : 'APPROVER_UNAUTHORIZED',
      detail: `approver ${params.approval.approverPrincipalId} lacks ${AUTHORIZE_ACTION_KIND}`,
    };
  }
  const covering = live.filter((g) => grantCoversEnvelopeScopes(g, params.envelopeScopes));
  if (covering.length === 0) {
    return {
      allowed: false,
      reason: 'APPROVER_UNAUTHORIZED',
      detail: `approver ${params.approval.approverPrincipalId} authorize grant does not cover envelope scope`,
    };
  }
  const requiredParty = params.requirement.requiredPartyRef;
  if (requiredParty) {
    const partyOk = covering.some((g) =>
      g.representedPartyRef.kind === requiredParty.kind && g.representedPartyRef.id === requiredParty.id,
    );
    if (!partyOk) {
      return {
        allowed: false,
        reason: 'APPROVER_PARTY_MISMATCH',
        detail: `required party ${requiredParty.kind}:${requiredParty.id}`,
      };
    }
  }
  return null;
}

export function evaluateConsequentialAuthorization(params: {
  assessmentView: AssessmentView;
  envelopeInput: EnvelopeFingerprintInput;
  envelope: AuthorityEnvelope;
  decision: AuthorityDecision;
  approvals: Approval[];
  revocations: ApprovalRevocation[];
  /** Dispatch-principal grants plus approver grants loaded at gate time. */
  grants: AuthorityGrant[];
  requiredActionKind: string;
  principalId: string;
  now: Instant;
  requestedAmount?: ExactMoney;
}): AuthorizeResult {
  const principalDenied = assertAuthenticatedPrincipal(params.principalId);
  if (principalDenied) return principalDenied;

  const gates = evaluateAuthorityDecisionGates(params.assessmentView);
  if (!gates.allowed) {
    return { allowed: false, reason: gates.reason, detail: 'status' in gates ? String(gates.status) : undefined };
  }

  const fingerprint = computeEnvelopeFingerprint(params.envelopeInput);
  if (fingerprint !== params.envelope.fingerprint) {
    return { allowed: false, reason: 'ENVELOPE_MISMATCH', detail: 'live fingerprint diverges from issued envelope' };
  }
  if (params.envelope.expiresAt && compareInstants(params.now, params.envelope.expiresAt) >= 0) {
    return { allowed: false, reason: 'GRANT_EXPIRED', detail: 'envelope expired' };
  }

  const liveDispatch = liveActionGrants(params.grants, params.principalId, params.requiredActionKind, params.now);
  if (liveDispatch.length === 0) {
    const matching = params.grants.filter((g) =>
      g.principalId === params.principalId && g.actions.includes(params.requiredActionKind),
    );
    const revoked = matching.some((g) => g.revokedAt !== undefined);
    const expired = matching.some((g) =>
      g.revokedAt === undefined && g.expiresAt !== undefined && compareInstants(params.now, g.expiresAt) >= 0,
    );
    return {
      allowed: false,
      reason: revoked ? 'GRANT_REVOKED' : expired ? 'GRANT_EXPIRED' : 'GRANT_MISSING',
      detail: params.requiredActionKind,
    };
  }
  const scopedDispatch = liveDispatch.filter((g) => grantCoversEnvelopeScopes(g, params.envelope.scope));
  if (scopedDispatch.length === 0) {
    return {
      allowed: false,
      reason: 'GRANT_SCOPE_INSUFFICIENT',
      detail: `${params.requiredActionKind} grant does not cover envelope scope`,
    };
  }

  if (!authorityIsSatisfied(params.decision, params.approvals, params.envelope, params.revocations, params.now)) {
    return { allowed: false, reason: 'APPROVALS_INCOMPLETE' };
  }

  for (const approval of params.approvals) {
    if (!approvalCoversEnvelope(approval, params.envelope, params.revocations, params.now)) continue;
    if (approval.envelopeFingerprint !== fingerprint) {
      return { allowed: false, reason: 'ENVELOPE_MISMATCH', detail: `approval ${approval.id}` };
    }
    const requirement = params.decision.requirements.find((r) => r.id === approval.requirementId);
    if (!requirement) {
      return { allowed: false, reason: 'APPROVALS_INCOMPLETE', detail: `requirement missing for approval ${approval.id}` };
    }
    const approverDenied = evaluateApproverAuthority({
      approval,
      requirement,
      envelopeScopes: params.envelope.scope,
      grants: params.grants,
      now: params.now,
    });
    if (approverDenied) return approverDenied;
  }

  if (params.requestedAmount && params.envelopeInput.amountCeiling) {
    if (params.requestedAmount.currency !== params.envelopeInput.amountCeiling.currency) {
      return { allowed: false, reason: 'AMOUNT_CEILING_EXCEEDED', detail: 'currency mismatch vs ceiling' };
    }
    if (compareExactMoney(params.requestedAmount, params.envelopeInput.amountCeiling) > 0) {
      return { allowed: false, reason: 'AMOUNT_CEILING_EXCEEDED' };
    }
  }

  return { allowed: true, envelopeFingerprint: fingerprint };
}

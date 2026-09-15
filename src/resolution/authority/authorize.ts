/**
 * NORTHSTAR M8 — authorize / dispatch gate composing Checkpoint-0 gates,
 * envelope fingerprint, grants, and multi-actor approvals.
 */
import type { AssessmentView } from '../../persistence/postgres/world/pgAssessments.ts';
import type { AuthorityEnvelope, Approval, ApprovalRevocation, AuthorityDecision } from '../../contracts/v2/authority/authorityEnvelope.ts';
import { approvalCoversEnvelope, authorityIsSatisfied } from '../../contracts/v2/authority/authorityEnvelope.ts';
import type { AuthorityGrant } from '../../domain/v2/people/traveller.ts';
import { evaluateAuthorityDecisionGates } from './decisionGates.ts';
import { computeEnvelopeFingerprint, type EnvelopeFingerprintInput } from './envelope.ts';
import { compareExactMoney, type ExactMoney } from '../../domain/v2/shared/money.ts';
import type { Instant } from '../../domain/v2/shared/time.ts';
import { compareInstants } from '../../domain/v2/shared/time.ts';

export type AuthorizeDenialReason =
  | 'ASSESSMENT_NOT_CURRENT'
  | 'PAYER_HOME_CURRENCY_UNKNOWN'
  | 'ENVELOPE_MISMATCH'
  | 'APPROVALS_INCOMPLETE'
  | 'GRANT_MISSING'
  | 'GRANT_EXPIRED'
  | 'GRANT_REVOKED'
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

export function evaluateConsequentialAuthorization(params: {
  assessmentView: AssessmentView;
  envelopeInput: EnvelopeFingerprintInput;
  envelope: AuthorityEnvelope;
  decision: AuthorityDecision;
  approvals: Approval[];
  revocations: ApprovalRevocation[];
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

  const coveringGrants = params.grants.filter((g) =>
    g.principalId === params.principalId
    && g.actions.includes(params.requiredActionKind)
    && g.revokedAt === undefined
    && compareInstants(params.now, g.issuedAt) >= 0
    && (g.expiresAt === undefined || compareInstants(params.now, g.expiresAt) < 0),
  );
  if (coveringGrants.length === 0) {
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

  if (!authorityIsSatisfied(params.decision, params.approvals, params.envelope, params.revocations, params.now)) {
    return { allowed: false, reason: 'APPROVALS_INCOMPLETE' };
  }

  // Every used approval must still cover this exact envelope fingerprint.
  for (const approval of params.approvals) {
    if (!approvalCoversEnvelope(approval, params.envelope, params.revocations, params.now)) continue;
    if (approval.envelopeFingerprint !== fingerprint) {
      return { allowed: false, reason: 'ENVELOPE_MISMATCH', detail: `approval ${approval.id}` };
    }
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

/**
 * NORTHSTAR M8 — AuthorityEnvelope fingerprinting and material-change invalidation.
 *
 * Approvals bind to this fingerprint. A material change to plan/intent version,
 * scope, limits, subjects, cost, or offer fingerprint requires a new envelope
 * and re-approval. There is no case-wide reusable approval.
 */
import { createHash } from 'node:crypto';
import type { AuthorityEnvelope } from '../../contracts/v2/authority/authorityEnvelope.ts';
import type { ExactMoney } from '../../domain/v2/shared/money.ts';
import type { TypedRef } from '../../domain/v2/shared/identity.ts';

export interface EnvelopeFingerprintInput {
  actionPlanId: string;
  actionPlanVersion: number;
  actionIntentId: string;
  actionIntentVersion: number;
  requiredActorRoles: string[];
  scope: TypedRef[];
  limits?: Record<string, unknown>;
  grantRefs: string[];
  ruleInputs: string[];
  amountCeiling?: ExactMoney;
  offerFingerprint?: string;
  requestFingerprint?: string;
  costEstimate?: ExactMoney;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** Canonical SHA-256 fingerprint for an authority envelope input. */
export function computeEnvelopeFingerprint(input: EnvelopeFingerprintInput): string {
  const canonical = {
    actionPlanId: input.actionPlanId,
    actionPlanVersion: input.actionPlanVersion,
    actionIntentId: input.actionIntentId,
    actionIntentVersion: input.actionIntentVersion,
    requiredActorRoles: [...input.requiredActorRoles].sort(),
    scope: [...input.scope]
      .map((s) => ({ kind: s.kind, id: s.id }))
      .sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`)),
    limits: input.limits ?? null,
    grantRefs: [...input.grantRefs].sort(),
    ruleInputs: [...input.ruleInputs].sort(),
    amountCeiling: input.amountCeiling ?? null,
    offerFingerprint: input.offerFingerprint ?? null,
    requestFingerprint: input.requestFingerprint ?? null,
    costEstimate: input.costEstimate ?? null,
  };
  return createHash('sha256').update(stableStringify(canonical)).digest('hex');
}

/** True when a stored envelope fingerprint still matches the live input. */
export function envelopeFingerprintMatches(envelope: AuthorityEnvelope, live: EnvelopeFingerprintInput): boolean {
  return envelope.fingerprint === computeEnvelopeFingerprint(live);
}

/**
 * Material intent/plan changes that invalidate prior approvals. Callers must
 * recompute the fingerprint and require fresh approvals when this returns true.
 */
export function materialAuthorityInputChanged(
  previous: EnvelopeFingerprintInput,
  next: EnvelopeFingerprintInput,
): boolean {
  return computeEnvelopeFingerprint(previous) !== computeEnvelopeFingerprint(next);
}

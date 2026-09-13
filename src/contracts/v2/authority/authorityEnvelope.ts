/**
 * NORTHSTAR v2 — AuthorityEnvelope.
 *
 * DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md §4.6/§10, DATA_STRUCTURE_LOGICAL_SCHEMA.md §7.
 * Approval must match the EXACT plan/action version, required actors and
 * limits it was issued against. Revocation is a new record; it can never
 * silently widen the original authority, and a refreshed result can reuse an
 * approval only while it still falls within this exact envelope.
 */
import { z } from 'zod';
import { SubjectIdSchema, TypedRefSchema } from '../../../domain/v2/shared/identity.ts';
import { InstantSchema } from '../../../domain/v2/shared/time.ts';

export const RequirementGroupOperatorSchema = z.enum(['AND', 'OR']);
export type RequirementGroupOperator = z.infer<typeof RequirementGroupOperatorSchema>;

export const ApprovalRequirementSchema = z.strictObject({
  id: SubjectIdSchema,
  actorRole: z.string().min(1),
  requiredPartyRef: TypedRefSchema.optional(),
});
export type ApprovalRequirement = z.infer<typeof ApprovalRequirementSchema>;

export const AuthorityDecisionSchema = z.strictObject({
  id: SubjectIdSchema,
  actionPlanId: SubjectIdSchema,
  actionPlanVersion: z.number().int().min(1),
  actionIntentId: SubjectIdSchema,
  actionIntentVersion: z.number().int().min(1),
  groupOperator: RequirementGroupOperatorSchema,
  requirements: z.array(ApprovalRequirementSchema).min(1),
  limits: z.record(z.string(), z.unknown()).optional(),
});
export type AuthorityDecision = z.infer<typeof AuthorityDecisionSchema>;

export const ApprovalSchema = z.strictObject({
  id: SubjectIdSchema,
  requirementId: SubjectIdSchema,
  approverPrincipalId: SubjectIdSchema,
  envelopeFingerprint: z.string().min(1),
  scope: z.array(TypedRefSchema).min(1),
  amountLimit: z.record(z.string(), z.unknown()).optional(),
  evidenceId: SubjectIdSchema.optional(),
  approvedAt: InstantSchema,
});
export type Approval = z.infer<typeof ApprovalSchema>;

export const ApprovalRevocationSchema = z.strictObject({
  id: SubjectIdSchema,
  approvalId: SubjectIdSchema,
  revokedAt: InstantSchema,
  revokedByPrincipalId: SubjectIdSchema,
});
export type ApprovalRevocation = z.infer<typeof ApprovalRevocationSchema>;

/** The exact envelope: what the approval was actually signed against. */
export const AuthorityEnvelopeSchema = z.strictObject({
  id: SubjectIdSchema,
  actionPlanId: SubjectIdSchema,
  actionPlanVersion: z.number().int().min(1),
  actionIntentId: SubjectIdSchema,
  actionIntentVersion: z.number().int().min(1),
  requiredActors: z.array(ApprovalRequirementSchema).min(1),
  scope: z.array(TypedRefSchema).min(1),
  limits: z.record(z.string(), z.unknown()).optional(),
  grantRefs: z.array(SubjectIdSchema).default([]),
  ruleInputs: z.array(SubjectIdSchema).default([]),
  issuedAt: InstantSchema,
  expiresAt: InstantSchema.optional(),
  fingerprint: z.string().min(1),
});
export type AuthorityEnvelope = z.infer<typeof AuthorityEnvelopeSchema>;

/**
 * An approval is usable for dispatch only if it matches THIS EXACT envelope
 * fingerprint, has not been revoked, and has not expired. A wider or looser
 * match is a bug, not a convenience.
 */
export function approvalCoversEnvelope(
  approval: Approval,
  envelope: AuthorityEnvelope,
  revocations: ApprovalRevocation[],
  now: string,
): boolean {
  if (approval.envelopeFingerprint !== envelope.fingerprint) return false;
  if (revocations.some((r) => r.approvalId === approval.id)) return false;
  if (envelope.expiresAt !== undefined && Date.parse(now) >= Date.parse(envelope.expiresAt)) return false;
  return true;
}

/** All required actors (per AND/OR grouping) must have a live covering approval before dispatch. */
export function authorityIsSatisfied(
  decision: AuthorityDecision,
  approvals: Approval[],
  envelope: AuthorityEnvelope,
  revocations: ApprovalRevocation[],
  now: string,
): boolean {
  const satisfiedRequirementIds = new Set(
    approvals
      .filter((a) => approvalCoversEnvelope(a, envelope, revocations, now))
      .map((a) => a.requirementId),
  );
  return decision.groupOperator === 'AND'
    ? decision.requirements.every((r) => satisfiedRequirementIds.has(r.id))
    : decision.requirements.some((r) => satisfiedRequirementIds.has(r.id));
}

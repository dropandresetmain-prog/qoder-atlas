/**
 * NORTHSTAR v2 — Recovery case attention (R1 / freeze C8 ESCALATE surface).
 *
 * ESCALATION IS ORTHOGONAL TO CASE PHASE. The RecoveryCase lifecycle
 * (OPEN -> PLANNING -> AWAITING_AUTHORITY -> EXECUTING -> terminal) says WHERE
 * recovery is; it deliberately has no "escalated" phase. A case can truthfully
 * stay in PLANNING while a human is also needed ("no safe automated recovery
 * remains", "more evidence or a decision is required"). That human-attention
 * condition is a small Case-owned operational record — NOT a lifecycle state,
 * NOT an approval, NOT a resolution and never a canonical trip mutation.
 *
 * One record is bound to (case, basis assessment, reason). A newer settled
 * basis supersedes it; resolving the case clears it. It carries a stable
 * machine reason plus a user-safe presentation derived from that reason — never
 * free text as the only semantics and never a reasoning transcript.
 */
import { z } from 'zod';

/** The frozen C8 ESCALATE reasons. Deliberately not a giant taxonomy. */
export const RecoveryCaseAttentionReasonSchema = z.enum([
  'no_safe_recovery_remaining',
  'human_evidence_or_decision_required',
]);
export type RecoveryCaseAttentionReason = z.infer<typeof RecoveryCaseAttentionReasonSchema>;

export const RecoveryCaseAttentionStatusSchema = z.enum(['OPEN', 'RESOLVED']);
export type RecoveryCaseAttentionStatus = z.infer<typeof RecoveryCaseAttentionStatusSchema>;

/** Why an attention record was cleared, by its owner. */
export const RecoveryCaseAttentionResolutionSchema = z.enum([
  'basis_superseded',
  'case_resolved',
]);
export type RecoveryCaseAttentionResolution = z.infer<typeof RecoveryCaseAttentionResolutionSchema>;

/** User-safe presentation, derived deterministically from the reason code. */
export const RECOVERY_CASE_ATTENTION_PRESENTATION: Record<RecoveryCaseAttentionReason, { label: string; detail: string }> = {
  no_safe_recovery_remaining: {
    label: 'No safe automated recovery remains',
    detail: 'The trip still fails and no safe automated recovery is available. A person needs to decide how to proceed.',
  },
  human_evidence_or_decision_required: {
    label: 'More evidence or a decision is needed',
    detail: 'The current situation cannot be settled automatically. A person needs to supply evidence or make a decision.',
  },
};

export const RECOVERY_CASE_ATTENTION_RESOLUTION_LABELS: Record<RecoveryCaseAttentionResolution, string> = {
  basis_superseded: 'Superseded by newer assessment',
  case_resolved: 'Case resolved',
};

/** The persisted record, as read back from PostgreSQL. */
export const RecoveryCaseAttentionRecordSchema = z.strictObject({
  id: z.string().uuid(),
  recoveryCaseId: z.string().uuid(),
  basisAssessmentId: z.string().uuid(),
  reasonCode: RecoveryCaseAttentionReasonSchema,
  status: RecoveryCaseAttentionStatusSchema,
  openedAt: z.string().datetime({ offset: true }),
  resolvedAt: z.string().datetime({ offset: true }).optional(),
  resolutionCode: RecoveryCaseAttentionResolutionSchema.optional(),
});
export type RecoveryCaseAttentionRecord = z.infer<typeof RecoveryCaseAttentionRecordSchema>;

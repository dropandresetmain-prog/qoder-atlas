/**
 * F1 — RecoveryCase state machine (ARCHITECTURE.md §15, FR-11).
 * An API success is not case resolution; observed viability determines it.
 * VERIFYING may loop back to ASSESSING/PLANNING.
 */
import { z } from 'zod';
import { EntityIdSchema, EntityRefSchema, IsoDateTimeSchema } from '../domain/common.ts';
import { AuthorityDecisionSchema, ActionIntentSchema, ExecutionResultSchema } from './intent.ts';
import { RecoveryStrategySchema } from './strategy.ts';

export const CaseStatusSchema = z.enum([
  'DETECTED',
  'ASSESSING',
  'PLANNING',
  'READY_TO_EXECUTE',
  'AWAITING_TRAVELLER',
  'AWAITING_APPROVAL',
  'ESCALATED',
  'EXECUTING',
  'VERIFYING',
  'RESOLVED',
]);
export type CaseStatus = z.infer<typeof CaseStatusSchema>;

/**
 * Allowed transitions; enforced deterministically by the case service (lane
 * A4). VERIFYING -> ASSESSING/PLANNING models the re-plan loop.
 * PLANNING / AWAITING_* / READY_TO_EXECUTE may resolve directly when
 * authorised non-execution mutation restores trip viability.
 */
export const CASE_TRANSITIONS: Record<CaseStatus, readonly CaseStatus[]> = {
  DETECTED: ['ASSESSING'],
  ASSESSING: ['PLANNING', 'ESCALATED', 'RESOLVED'],
  PLANNING: ['READY_TO_EXECUTE', 'AWAITING_TRAVELLER', 'AWAITING_APPROVAL', 'ESCALATED', 'RESOLVED'],
  READY_TO_EXECUTE: ['EXECUTING', 'AWAITING_TRAVELLER', 'AWAITING_APPROVAL', 'PLANNING', 'RESOLVED'],
  AWAITING_TRAVELLER: ['READY_TO_EXECUTE', 'PLANNING', 'ESCALATED', 'RESOLVED'],
  AWAITING_APPROVAL: ['READY_TO_EXECUTE', 'PLANNING', 'ESCALATED', 'RESOLVED'],
  ESCALATED: ['ASSESSING', 'RESOLVED'],
  EXECUTING: ['VERIFYING', 'ESCALATED'],
  VERIFYING: ['RESOLVED', 'ASSESSING', 'PLANNING', 'EXECUTING'],
  RESOLVED: [],
};

export const ResolutionOutcomeSchema = z.enum([
  'FULLY_RECOVERED',
  'RECOVERED_WITH_LOSS',
  'ESCALATED_CLOSED',
]);
export type ResolutionOutcome = z.infer<typeof ResolutionOutcomeSchema>;

/**
 * What the case is trying to achieve (ADR-038). RECOVERY restores viability
 * after disruption/change; INITIAL_PLANNING creates the first viable plan for
 * a trip that may have no elements yet. Both run through the SAME generalized
 * engine — this flag is classification evidence, never a fork in behaviour.
 */
export const CaseKindSchema = z.enum(['RECOVERY', 'INITIAL_PLANNING']);
export type CaseKind = z.infer<typeof CaseKindSchema>;

export const CaseResolutionSchema = z.strictObject({
  outcome: ResolutionOutcomeSchema,
  resolvedAt: IsoDateTimeSchema,
  summary: z.string().optional(),
  /** Remaining objective/element losses for RECOVERED_WITH_LOSS. */
  remainingLossRefs: z.array(EntityIdSchema).default([]),
});
export type CaseResolution = z.infer<typeof CaseResolutionSchema>;

/**
 * A single, case-scoped organiser approval that authorises the WHOLE
 * recovery, not just the intent it was recorded against (I4/PR-10 demo
 * contract fix). The presented recovery plan discloses every sequential
 * provider action Northstar will take (e.g. a replacement flight AND the
 * overnight hotel that follows it) before the organiser approves once; this
 * envelope preserves that single approval so a later intent within the SAME
 * case — a deterministic, policy-checked consequence of the SAME recovery,
 * never a new discretionary spend — does not surface a second human decision.
 * Recorded once, from the first ORGANISATION-decided APPROVED verdict in the
 * case's lifetime; never overwritten. Reuse never bypasses per-intent
 * deterministic authority (spend ceilings, BLOCKED outcomes): see
 * `beginStrategy` in recoveryExecution.ts.
 */
export const RecoveryApprovalEnvelopeSchema = z.strictObject({
  originIntentId: EntityIdSchema,
  approvedBy: EntityRefSchema,
  approvedAt: IsoDateTimeSchema,
});
export type RecoveryApprovalEnvelope = z.infer<typeof RecoveryApprovalEnvelopeSchema>;

export const RecoveryCaseSchema = z.strictObject({
  id: EntityIdSchema,
  tripId: EntityIdSchema,
  /** Defaults to RECOVERY so closed-checkpoint cases keep loading unchanged. */
  caseKind: CaseKindSchema.default('RECOVERY'),
  status: CaseStatusSchema,
  openedAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  triggeredBySignalIds: z.array(EntityIdSchema).default([]),
  affectedElementIds: z.array(EntityIdSchema).default([]),
  failedConstraintIds: z.array(EntityIdSchema).default([]),
  strategies: z.array(RecoveryStrategySchema).default([]),
  authorityDecisions: z.array(AuthorityDecisionSchema).default([]),
  actionIntents: z.array(ActionIntentSchema).default([]),
  executionResults: z.array(ExecutionResultSchema).default([]),
  resolution: CaseResolutionSchema.optional(),
  recoveryApproval: RecoveryApprovalEnvelopeSchema.optional(),
  version: z.number().int().nonnegative().default(0),
});
export type RecoveryCase = z.infer<typeof RecoveryCaseSchema>;

/** Deterministic transition guard used by the case service. */
export function isLegalCaseTransition(from: CaseStatus, to: CaseStatus): boolean {
  return CASE_TRANSITIONS[from].includes(to);
}

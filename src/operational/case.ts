/**
 * F1 — RecoveryCase state machine (ARCHITECTURE.md §15, FR-11).
 * An API success is not case resolution; observed viability determines it.
 * VERIFYING may loop back to ASSESSING/PLANNING.
 */
import { z } from 'zod';
import { EntityIdSchema, IsoDateTimeSchema } from '../domain/common.ts';
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
 */
export const CASE_TRANSITIONS: Record<CaseStatus, readonly CaseStatus[]> = {
  DETECTED: ['ASSESSING'],
  ASSESSING: ['PLANNING', 'ESCALATED', 'RESOLVED'],
  PLANNING: ['READY_TO_EXECUTE', 'AWAITING_TRAVELLER', 'AWAITING_APPROVAL', 'ESCALATED'],
  READY_TO_EXECUTE: ['EXECUTING', 'AWAITING_TRAVELLER', 'AWAITING_APPROVAL', 'PLANNING'],
  AWAITING_TRAVELLER: ['READY_TO_EXECUTE', 'PLANNING', 'ESCALATED'],
  AWAITING_APPROVAL: ['READY_TO_EXECUTE', 'PLANNING', 'ESCALATED'],
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

export const CaseResolutionSchema = z.strictObject({
  outcome: ResolutionOutcomeSchema,
  resolvedAt: IsoDateTimeSchema,
  summary: z.string().optional(),
  /** Remaining objective/element losses for RECOVERED_WITH_LOSS. */
  remainingLossRefs: z.array(EntityIdSchema).default([]),
});
export type CaseResolution = z.infer<typeof CaseResolutionSchema>;

export const RecoveryCaseSchema = z.strictObject({
  id: EntityIdSchema,
  tripId: EntityIdSchema,
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
  version: z.number().int().nonnegative().default(0),
});
export type RecoveryCase = z.infer<typeof RecoveryCaseSchema>;

/** Deterministic transition guard used by the case service. */
export function isLegalCaseTransition(from: CaseStatus, to: CaseStatus): boolean {
  return CASE_TRANSITIONS[from].includes(to);
}

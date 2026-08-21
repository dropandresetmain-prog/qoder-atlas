/**
 * F1 — ActionIntent, AuthorityDecision, ExecutionResult (FR-10, FR-11,
 * ARCHITECTURE.md §12). Every consequential external action is an ActionIntent
 * passing deterministic authority before execution. The LLM can never hold an
 * executable path to an irreversible/money-moving API.
 */
import { z } from 'zod';
import { EntityIdSchema, EntityRefSchema, IsoDateTimeSchema, MoneySchema } from '../domain/common.ts';
import { CapabilityFamilySchema } from './strategy.ts';

export const SideEffectLevelSchema = z.enum([
  'READ_ONLY',
  'REVERSIBLE',
  'IRREVERSIBLE',
  'MONEY_MOVING',
]);
export type SideEffectLevel = z.infer<typeof SideEffectLevelSchema>;

/**
 * Provider-neutral operation vocabulary. Concrete adapters map these to
 * provider endpoints (e.g. flight.search -> Atlas search.do); the mapping is
 * adapter-private.
 */
export const CapabilityOperationSchema = z.enum([
  'flight.search',
  'flight.verify',
  'flight.fare_rules',
  'flight.change',
  'flight.cancel',
  'flight.refund_quote',
  'hotel.context',
  'hotel.modify',
  'hotel.cancel',
  'routing.context',
  'research.entry_requirements',
  'research.local_context',
  'communication.notify',
  'communication.request_approval',
  'simulation.provider_action',
]);
export type CapabilityOperation = z.infer<typeof CapabilityOperationSchema>;

export const ActionIntentStatusSchema = z.enum([
  'PROPOSED',
  'AUTHORISED',
  'REJECTED',
  'SUPERSEDED',
  'EXECUTING',
  'EXECUTED',
  'FAILED',
]);
export type ActionIntentStatus = z.infer<typeof ActionIntentStatusSchema>;

export const ActionIntentSchema = z.strictObject({
  id: EntityIdSchema,
  caseId: EntityIdSchema,
  strategyId: EntityIdSchema.optional(),
  operation: CapabilityOperationSchema,
  capability: CapabilityFamilySchema,
  parameters: z.record(z.string(), z.unknown()).default({}),
  sideEffectLevel: SideEffectLevelSchema,
  priceDelta: MoneySchema.optional(),
  /** Evidence refs supporting the intent (viability results, quotes...). */
  evidenceRefs: z.array(EntityIdSchema).default([]),
  expectedResult: z.string().optional(),
  status: ActionIntentStatusSchema.default('PROPOSED'),
  createdAt: IsoDateTimeSchema,
});
export type ActionIntent = z.infer<typeof ActionIntentSchema>;

export const AuthorityOutcomeSchema = z.enum([
  'AUTO_APPROVED',
  'REQUIRES_TRAVELLER',
  'REQUIRES_ORGANISATION_APPROVER',
  'REQUIRES_HUMAN_AGENT',
  'BLOCKED',
]);
export type AuthorityOutcome = z.infer<typeof AuthorityOutcomeSchema>;

export const AuthorityDecisionSchema = z.strictObject({
  id: EntityIdSchema,
  intentId: EntityIdSchema,
  outcome: AuthorityOutcomeSchema,
  decidedAt: IsoDateTimeSchema,
  /** Deterministic rule trace: which rules/conditions produced the outcome. */
  ruleTrace: z.array(z.string()).default([]),
  conditions: z.array(z.string()).default([]),
  approval: z
    .strictObject({
      decidedAt: IsoDateTimeSchema,
      decidedBy: EntityRefSchema,
      decision: z.enum(['APPROVED', 'DECLINED']),
      note: z.string().optional(),
    })
    .optional(),
});
export type AuthorityDecision = z.infer<typeof AuthorityDecisionSchema>;

/**
 * Authorised execution envelope (FR-10, ADR-025). The executor seam accepts
 * an intent ONLY together with the deterministic AuthorityDecision that
 * authorised it. An ActionIntent merely constructed with status AUTHORISED
 * by an arbitrary caller/model is not executable evidence.
 */
export const AuthorisedExecutionSchema = z.strictObject({
  intent: ActionIntentSchema,
  authority: AuthorityDecisionSchema,
});
export type AuthorisedExecution = z.infer<typeof AuthorisedExecutionSchema>;

/**
 * Deterministic authority gate shared by executor implementations and tests.
 * Returns [] only when the paired authority decision is valid evidence for
 * executing the intent. Implementations MUST refuse to execute when this
 * returns any issue; intent.status alone is never sufficient.
 */
export function executionGateIssues(execution: AuthorisedExecution): string[] {
  const issues: string[] = [];
  const { intent, authority } = execution;

  if (authority.intentId !== intent.id) {
    issues.push(`authority decision ${authority.id} does not reference intent ${intent.id}`);
  }
  switch (authority.outcome) {
    case 'AUTO_APPROVED':
      break;
    case 'REQUIRES_TRAVELLER':
    case 'REQUIRES_ORGANISATION_APPROVER':
    case 'REQUIRES_HUMAN_AGENT':
      if (authority.approval === undefined) {
        issues.push(`outcome ${authority.outcome} requires a recorded approval`);
      } else if (authority.approval.decision !== 'APPROVED') {
        issues.push(`approval for outcome ${authority.outcome} was declined`);
      }
      break;
    case 'BLOCKED':
      issues.push('authority decision is BLOCKED; execution is forbidden');
      break;
  }
  return issues;
}

/** True only when the authority evidence permits crossing the execution boundary. */
export function isExecutable(execution: AuthorisedExecution): boolean {
  return executionGateIssues(execution).length === 0;
}

/** Where execution evidence came from (FR-15 + ADR-007 boundary simulation). */
export const ExecutionProvenanceSchema = z.enum(['LIVE', 'RECORD', 'REPLAY', 'SIMULATED']);
export type ExecutionProvenance = z.infer<typeof ExecutionProvenanceSchema>;

export const ExecutionStatusSchema = z.enum(['SUCCESS', 'FAILURE', 'UNAVAILABLE', 'TIMEOUT']);
export type ExecutionStatus = z.infer<typeof ExecutionStatusSchema>;

export const ExecutionResultSchema = z.strictObject({
  id: EntityIdSchema,
  intentId: EntityIdSchema,
  executedAt: IsoDateTimeSchema,
  status: ExecutionStatusSchema,
  provenance: ExecutionProvenanceSchema,
  /** Provider identifier when a real adapter produced the result. */
  providerId: z.string().optional(),
  resultSummary: z.string().optional(),
  /** Structured observed effects, to be mapped into validated mutations. */
  observedEffects: z.record(z.string(), z.unknown()).optional(),
  error: z
    .strictObject({
      code: z.string(),
      message: z.string(),
      retryable: z.boolean().optional(),
    })
    .optional(),
});
export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;

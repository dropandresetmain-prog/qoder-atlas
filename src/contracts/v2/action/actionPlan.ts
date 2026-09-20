/**
 * NORTHSTAR v2 — ActionPlan / ActionIntent.
 *
 * DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md §10, DATA_STRUCTURE_LOGICAL_SCHEMA.md §7.
 * An ActionPlan is an acyclic graph of typed ActionIntents. Each Intent owns
 * an immutable logical-operation identity reused across its dispatch
 * attempts — a second dispatch is never automatically a new operation.
 */
import { z } from 'zod';
import { SubjectIdSchema, TypedRefSchema, ExpectedRevisionSchema } from '../../../domain/v2/shared/identity.ts';
import { ExactMoneySchema } from '../../../domain/v2/shared/money.ts';
import { typedConflict, type TypedResult, ok } from '../../../domain/v2/shared/errors.ts';

export const ActionIntentStatusSchema = z.enum([
  'PROPOSED',
  'AUTHORIZED',
  'REJECTED',
  'SUPERSEDED',
  'EXECUTING',
  'COMPLETED',
  'FAILED',
]);
export type ActionIntentStatus = z.infer<typeof ActionIntentStatusSchema>;

export const CompensationPolicySchema = z.strictObject({
  supported: z.boolean(),
  requiresSeparateAuthority: z.boolean().default(true),
  description: z.string().optional(),
});
export type CompensationPolicy = z.infer<typeof CompensationPolicySchema>;

export const ActionIntentSchema = z.strictObject({
  id: SubjectIdSchema,
  actionPlanId: SubjectIdSchema,
  /** Identifies the external connection or internal executor namespace. */
  operationNamespace: z.string().min(1),
  /** Immutable once dispatch is prepared; reused by every ExecutionAttempt. */
  logicalOperationKey: z.string().min(1).optional(),
  requestFingerprint: z.string().min(1).optional(),
  /** Immutable index of the exact selected ScenarioChange effect this intent executes. */
  sourceEffectIndex: z.number().int().min(0).optional(),
  /** SHA-256 of the exact selected ScenarioChange effect. */
  sourceEffectFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  capabilityRef: z.string().min(1),
  subjectRefs: z.array(TypedRefSchema).min(1),
  expectedRevisions: z.array(ExpectedRevisionSchema).default([]),
  preconditions: z.array(z.string()).default([]),
  offerFingerprint: z.string().optional(),
  costEstimate: ExactMoneySchema.optional(),
  limits: z.record(z.string(), z.unknown()).optional(),
  requiredAuthorityScopes: z.array(z.string()).default([]),
  expectedObservations: z.array(z.string()).min(1),
  compensationPolicy: CompensationPolicySchema,
  status: ActionIntentStatusSchema,
});
export type ActionIntent = z.infer<typeof ActionIntentSchema>;

export const ActionDependencySchema = z.strictObject({
  fromActionIntentId: SubjectIdSchema,
  toActionIntentId: SubjectIdSchema,
});
export type ActionDependency = z.infer<typeof ActionDependencySchema>;

export const ActionPlanSchema = z.strictObject({
  id: SubjectIdSchema,
  recoveryCaseId: SubjectIdSchema,
  scenarioChangeId: SubjectIdSchema,
  intents: z.array(ActionIntentSchema).min(1),
  dependencies: z.array(ActionDependencySchema).default([]),
});
export type ActionPlan = z.infer<typeof ActionPlanSchema>;

/** Validates the dependency graph is acyclic. Uses a visited/in-progress set (Kahn-style detection). */
export function validateActionPlanAcyclic(plan: ActionPlan): TypedResult<true> {
  const intentIds = new Set(plan.intents.map((i) => i.id));
  for (const dep of plan.dependencies) {
    if (dep.fromActionIntentId === dep.toActionIntentId) {
      return { ok: false, conflict: typedConflict('ACYCLIC_GRAPH_VIOLATION', 'self-dependency is not allowed') };
    }
    if (!intentIds.has(dep.fromActionIntentId) || !intentIds.has(dep.toActionIntentId)) {
      return { ok: false, conflict: typedConflict('VALIDATION_FAILED', 'dependency references an intent outside this plan') };
    }
  }

  const adjacency = new Map<string, string[]>();
  for (const id of intentIds) adjacency.set(id, []);
  for (const dep of plan.dependencies) {
    adjacency.get(dep.fromActionIntentId)?.push(dep.toActionIntentId);
  }

  const state = new Map<string, 'VISITING' | 'DONE'>();
  const stack: string[] = [...intentIds];
  const visit = (node: string): boolean => {
    const status = state.get(node);
    if (status === 'DONE') return true;
    if (status === 'VISITING') return false;
    state.set(node, 'VISITING');
    for (const next of adjacency.get(node) ?? []) {
      if (!visit(next)) return false;
    }
    state.set(node, 'DONE');
    return true;
  };
  for (const id of stack) {
    if (!visit(id)) {
      return { ok: false, conflict: typedConflict('ACYCLIC_GRAPH_VIOLATION', 'action plan dependency graph contains a cycle') };
    }
  }
  return ok(true);
}

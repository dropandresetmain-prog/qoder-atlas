/**
 * F1 — Constraint model (ARCHITECTURE.md §3, ADR-012).
 *
 * Conditions like MUST_ARRIVE_BEFORE live here as constraint predicates,
 * never as new edge types. PASS / FAIL / UNKNOWN are distinct (FR-05);
 * UNKNOWN must never be coerced into PASS.
 */
import { z } from 'zod';
import { EntityIdSchema, EntityRefSchema } from './common.ts';

export const ConstraintKindSchema = z.enum([
  'TEMPORAL',
  'TRANSFER',
  'LOCATION',
  'ENTRY',
  'ACCESSIBILITY',
  'SUPPLIER',
  'POLICY',
  'FINANCIAL',
  'OBJECTIVE',
]);
export type ConstraintKind = z.infer<typeof ConstraintKindSchema>;

export const ConstraintHardnessSchema = z.enum(['HARD', 'SOFT']);
export type ConstraintHardness = z.infer<typeof ConstraintHardnessSchema>;

export const ConstraintEvaluatorSchema = z.enum(['DETERMINISTIC', 'SEMANTIC']);
export type ConstraintEvaluator = z.infer<typeof ConstraintEvaluatorSchema>;

export const ConstraintStatusSchema = z.enum(['PASS', 'FAIL', 'UNKNOWN']);
export type ConstraintStatus = z.infer<typeof ConstraintStatusSchema>;

export const ConstraintSchema = z.strictObject({
  id: EntityIdSchema,
  kind: ConstraintKindSchema,
  hardness: ConstraintHardnessSchema,
  evaluator: ConstraintEvaluatorSchema,
  status: ConstraintStatusSchema.default('UNKNOWN'),
  description: z.string().optional(),
  /** Entities/facts this constraint evaluates. */
  refs: z.array(EntityRefSchema).default([]),
  derivedFromRuleId: EntityIdSchema.optional(),
  ruleSetId: EntityIdSchema.optional(),
  /** Evaluator-specific structured parameters (window, buffer, threshold...). */
  parameters: z.record(z.string(), z.unknown()).optional(),
  sourceId: EntityIdSchema.optional(),
});
export type Constraint = z.infer<typeof ConstraintSchema>;

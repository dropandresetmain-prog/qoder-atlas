/**
 * F1 — ImpactAssessment: blast radius after a relevant state change (FR-06,
 * ARCHITECTURE.md §9). Hard failures never terminate the pipeline; losses are
 * recorded and recovery of remaining objectives continues.
 */
import { z } from 'zod';
import { EntityIdSchema, IsoDateTimeSchema, MoneySchema } from '../domain/common.ts';
import { ElementHealthSchema } from '../domain/elements.ts';

export const ImpactSeveritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export type ImpactSeverity = z.infer<typeof ImpactSeveritySchema>;

export const ElementImpactSchema = z.strictObject({
  elementId: EntityIdSchema,
  resultingStatus: ElementHealthSchema,
  reason: z.string(),
});
export type ElementImpact = z.infer<typeof ElementImpactSchema>;

export const ObjectiveImpactSchema = z.strictObject({
  objectiveId: EntityIdSchema,
  threatened: z.boolean(),
  reason: z.string(),
});
export type ObjectiveImpact = z.infer<typeof ObjectiveImpactSchema>;

/** Irreversible loss (e.g. an objective that can no longer be met). */
export const LossRecordSchema = z.strictObject({
  id: EntityIdSchema,
  description: z.string(),
  relatedRefs: z.array(EntityIdSchema).default([]),
  recordedAt: IsoDateTimeSchema,
});
export type LossRecord = z.infer<typeof LossRecordSchema>;

export const ImpactAssessmentSchema = z.strictObject({
  id: EntityIdSchema,
  tripId: EntityIdSchema,
  triggeredBySignalId: EntityIdSchema.optional(),
  assessedAt: IsoDateTimeSchema,
  severity: ImpactSeveritySchema,
  directFailures: z.array(ElementImpactSchema).default([]),
  affectedElements: z.array(ElementImpactSchema).default([]),
  threatenedObjectives: z.array(ObjectiveImpactSchema).default([]),
  irreversibleLosses: z.array(LossRecordSchema).default([]),
  affectedTravellerIds: z.array(EntityIdSchema).default([]),
  sharedResourceImpacts: z.array(EntityIdSchema).default([]),
  policyImplications: z.array(z.string()).default([]),
  insuranceImplications: z.array(z.string()).default([]),
  financialExposure: MoneySchema.optional(),
  unresolvedUnknowns: z.array(z.string()).default([]),
  recoveryHeadroom: z.string().optional(),
});
export type ImpactAssessment = z.infer<typeof ImpactAssessmentSchema>;

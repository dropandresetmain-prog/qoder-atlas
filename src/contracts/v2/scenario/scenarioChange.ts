/**
 * NORTHSTAR v2 — ScenarioChange.
 *
 * DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md §10, DATA_STRUCTURE_LOGICAL_SCHEMA.md §7.
 * A scenario registers typed proposed effects only. The closed `effectKind`
 * union IS the enforcement mechanism: there is no effect kind that could set
 * an assessment result, edit a published rule, or mark an action observed —
 * a candidate cannot become supplier-observed fact through this shape.
 */
import { z } from 'zod';
import { SubjectIdSchema, TypedRefSchema } from '../../../domain/v2/shared/identity.ts';

export const ScenarioEffectSchema = z.discriminatedUnion('effectKind', [
  z.strictObject({
    effectKind: z.literal('SELECT_OFFER'),
    journeyItemId: SubjectIdSchema,
    offerId: SubjectIdSchema,
  }),
  z.strictObject({
    effectKind: z.literal('PROPOSE_ALLOCATION'),
    reservationLineId: SubjectIdSchema,
    travellerId: SubjectIdSchema,
    journeyItemId: SubjectIdSchema.optional(),
  }),
  z.strictObject({
    effectKind: z.literal('CHANGE_PROGRAMME_ITEM_TIME'),
    programmeItemId: SubjectIdSchema,
    proposedWindow: z.strictObject({ start: z.iso.datetime({ offset: true }), end: z.iso.datetime({ offset: true }) }),
  }),
  z.strictObject({
    effectKind: z.literal('ALTER_JOURNEY_ITEM_INTENT'),
    journeyItemId: SubjectIdSchema,
    proposedWindow: z.strictObject({ start: z.iso.datetime({ offset: true }), end: z.iso.datetime({ offset: true }) }).optional(),
  }),
  z.strictObject({
    effectKind: z.literal('CHANGE_SUPPORT_ASSIGNMENT'),
    constraintDefinitionId: SubjectIdSchema,
    constraintDefinitionVersion: z.number().int().min(1),
    proposedAssignedSupporterTravellerIds: z.array(SubjectIdSchema).min(1),
  }),
  z.strictObject({
    effectKind: z.literal('WAIVE_OBJECTIVE'),
    objectiveId: SubjectIdSchema,
    rationale: z.string().min(1),
  }),
]);
export type ScenarioEffect = z.infer<typeof ScenarioEffectSchema>;

export const ScenarioChangeSchema = z.strictObject({
  id: SubjectIdSchema,
  recoveryStrategyId: SubjectIdSchema,
  strategyVersion: z.number().int().min(1),
  affectedSubjectRefs: z.array(TypedRefSchema).min(1),
  effects: z.array(ScenarioEffectSchema).min(1),
  basisAssessmentId: SubjectIdSchema,
});
export type ScenarioChange = z.infer<typeof ScenarioChangeSchema>;

import { z } from 'zod';
import { SubjectIdSchema } from '../../../domain/v2/shared/identity.ts';
import { ChangeRequestUrgencySchema, DesiredChangeTargetSchema } from '../change/changeRequest.ts';
import type { ChangeRequestRecord } from '../change/changeRequest.ts';

/**
 * Immutable request metadata carried beside a truthful current-world
 * assessment. It is planning context, never an asserted failure or current
 * Journey state.
 */
export const ChangeRequestPlanningBasisSchema = z.strictObject({
  changeRequestId: SubjectIdSchema,
  journeyId: SubjectIdSchema,
  representedTravellerId: SubjectIdSchema,
  contentRevision: z.number().int().min(1),
  lifecycleRevision: z.number().int().min(1),
  /** Only an explicitly accepted request may enter the planner. */
  lifecycle: z.literal('ACCEPTED_FOR_PLANNING'),
  urgency: ChangeRequestUrgencySchema,
  desiredTarget: DesiredChangeTargetSchema,
});
export type ChangeRequestPlanningBasis = z.infer<typeof ChangeRequestPlanningBasisSchema>;

/** Build planning context only from a canonical accepted request read. */
export function planningBasisFromChangeRequest(request: ChangeRequestRecord): ChangeRequestPlanningBasis {
  return ChangeRequestPlanningBasisSchema.parse({
    changeRequestId: request.id,
    journeyId: request.journeyId,
    representedTravellerId: request.representedTravellerId,
    contentRevision: request.contentRevision,
    lifecycleRevision: request.revision,
    lifecycle: request.lifecycle,
    urgency: request.urgency,
    desiredTarget: request.desiredTarget,
  });
}

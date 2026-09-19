import { z } from 'zod';

/** The request lifecycle records intake/planning disposition, never supplier fulfilment. */
export const ChangeRequestLifecycleSchema = z.enum([
  'SUBMITTED',
  'ACCEPTED_FOR_PLANNING',
  'WITHDRAWN',
  'CLOSED',
]);
export type ChangeRequestLifecycle = z.infer<typeof ChangeRequestLifecycleSchema>;

/** The closed roles make every UUID-bearing desired target target-native. */
export const ChangeRequestTargetRoleSchema = z.enum([
  'STAY_PROXIMITY_PLACE',
  'STAY_PLACE',
  'TRAVEL_WITH_TRAVELLER',
  'OBJECTIVE_EFFECT',
]);
export type ChangeRequestTargetRole = z.infer<typeof ChangeRequestTargetRoleSchema>;

export const CHANGE_REQUEST_TRANSITIONS: Readonly<Record<ChangeRequestLifecycle, readonly ChangeRequestLifecycle[]>> = {
  SUBMITTED: ['ACCEPTED_FOR_PLANNING', 'WITHDRAWN', 'CLOSED'],
  ACCEPTED_FOR_PLANNING: ['WITHDRAWN', 'CLOSED'],
  WITHDRAWN: [],
  CLOSED: [],
};

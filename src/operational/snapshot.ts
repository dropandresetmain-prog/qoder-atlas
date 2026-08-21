/**
 * F1 — TripSnapshot: planner-safe aggregate view (ARCHITECTURE.md §11).
 * Raw source payloads never enter snapshots; only source metadata.
 */
import { z } from 'zod';
import {
  EntityIdSchema,
  IsoDateTimeSchema,
  SourceRecordSchema,
} from '../domain/common.ts';
import { ConstraintSchema } from '../domain/constraints.ts';
import { OrganisationSchema, TravellerSchema, AnchorEventSchema, PlaceSchema } from '../domain/entities.ts';
import { PreferenceSchema } from '../domain/preferences.ts';
import { RuleSetSchema } from '../domain/rules.ts';
import { TripSchema } from '../domain/trip.ts';

export const TripSnapshotSchema = z.strictObject({
  tripId: EntityIdSchema,
  takenAt: IsoDateTimeSchema,
  tripVersion: z.number().int().nonnegative(),
  trip: TripSchema,
  travellers: z.array(TravellerSchema).default([]),
  organisations: z.array(OrganisationSchema).default([]),
  anchorEvent: AnchorEventSchema.optional(),
  places: z.array(PlaceSchema).default([]),
  ruleSets: z.array(RuleSetSchema).default([]),
  constraints: z.array(ConstraintSchema).default([]),
  preferences: z.array(PreferenceSchema).default([]),
  /** Metadata only — raw payloads stay in the source store. */
  sourceRecords: z.array(SourceRecordSchema).default([]),
});
export type TripSnapshot = z.infer<typeof TripSnapshotSchema>;

/**
 * F1 — preference model with strict precedence (ARCHITECTURE.md §6, ADR-014).
 *
 * Precedence (higher wins):
 *   1. current explicit instruction
 *   2. trip-specific explicit preference
 *   3. persistent explicit preference
 *   4. latent/inferred preference (soft ranking signal only)
 *
 * Accessibility, legal/entry, safety and explicit hard objectives are
 * requirements (constraints), never preferences.
 */
import { z } from 'zod';
import { EntityIdSchema, IsoDateTimeSchema } from './common.ts';

export const PreferenceOriginKindSchema = z.enum([
  'EXPLICIT_INSTRUCTION',
  'EXPLICIT_TRIP_PREFERENCE',
  'EXPLICIT_PERSISTENT',
  'LATENT_INFERRED',
]);
export type PreferenceOriginKind = z.infer<typeof PreferenceOriginKindSchema>;

/** Numeric precedence: larger value outranks smaller value. */
export const PREFERENCE_PRECEDENCE: Record<PreferenceOriginKind, number> = {
  EXPLICIT_INSTRUCTION: 4,
  EXPLICIT_TRIP_PREFERENCE: 3,
  EXPLICIT_PERSISTENT: 2,
  LATENT_INFERRED: 1,
};

export const PreferenceOriginSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('EXPLICIT_INSTRUCTION'),
    issuedAt: IsoDateTimeSchema,
    issuedBy: EntityIdSchema,
  }),
  z.strictObject({
    kind: z.literal('EXPLICIT_TRIP_PREFERENCE'),
    statedAt: IsoDateTimeSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal('EXPLICIT_PERSISTENT'),
    statedAt: IsoDateTimeSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal('LATENT_INFERRED'),
    evidence: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
    inferredAt: IsoDateTimeSchema.optional(),
  }),
]);
export type PreferenceOrigin = z.infer<typeof PreferenceOriginSchema>;

export const PreferenceStatusSchema = z.enum(['ACTIVE', 'SUPERSEDED', 'REVOKED']);
export type PreferenceStatus = z.infer<typeof PreferenceStatusSchema>;

export const PreferenceSchema = z.strictObject({
  id: EntityIdSchema,
  /** Who holds the preference. */
  travellerId: EntityIdSchema,
  /** Optional trip scope; absent means persistent across trips. */
  tripId: EntityIdSchema.optional(),
  statement: z.string(),
  origin: PreferenceOriginSchema,
  status: PreferenceStatusSchema.default('ACTIVE'),
  sourceId: EntityIdSchema,
});
export type Preference = z.infer<typeof PreferenceSchema>;

export function preferencePrecedence(preference: Preference): number {
  return PREFERENCE_PRECEDENCE[preference.origin.kind];
}

/**
 * Deterministic precedence comparison. Returns the dominating preference,
 * or `undefined` when neither dominates (equal precedence: caller decides,
 * e.g. by freshness). Latent preferences never dominate explicit ones.
 */
export function dominatingPreference(a: Preference, b: Preference): Preference | undefined {
  const diff = preferencePrecedence(a) - preferencePrecedence(b);
  if (diff > 0) return a;
  if (diff < 0) return b;
  return undefined;
}

/**
 * F1 — shared domain primitives: identifiers, timestamps, provenance, facts.
 *
 * ARCHITECTURE.md §5: critical facts carry value + source + authority +
 * confidence + freshness instead of one meaningless node-level score.
 * UNKNOWN is a valid state throughout; missing evidence never becomes certainty.
 */
import { z } from 'zod';

/** Entity identifiers are opaque strings; no scenario semantics encoded. */
export const EntityIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_\-:.]*$/);
export type EntityId = z.infer<typeof EntityIdSchema>;

/** ISO-8601 timestamp with explicit UTC offset (timezone safety, FR-05). */
export const IsoDateTimeSchema = z.iso.datetime({ offset: true });
export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;

/**
 * Fact authority ladder. Higher authority + freshness wins deterministic
 * truth-resolution; last-write-wins is forbidden (ARCHITECTURE.md §5).
 */
export const FactAuthoritySchema = z.enum(['AUTHORITATIVE', 'CONNECTED', 'ASSERTED', 'INFERRED']);
export type FactAuthority = z.infer<typeof FactAuthoritySchema>;

export const FACT_AUTHORITY_RANK: Record<FactAuthority, number> = {
  AUTHORITATIVE: 4,
  CONNECTED: 3,
  ASSERTED: 2,
  INFERRED: 1,
};

/** Returns the fact with stronger authority; on ties, the fresher observation. */
export function resolveAuthoritativeFact<T extends { authority: FactAuthority; observedAt: string }>(
  a: T,
  b: T,
): T {
  const rankDiff = FACT_AUTHORITY_RANK[a.authority] - FACT_AUTHORITY_RANK[b.authority];
  if (rankDiff !== 0) return rankDiff > 0 ? a : b;
  return a.observedAt >= b.observedAt ? a : b;
}

/** Reference to a persisted SourceRecord (see contracts/repositories.ts). */
export const SourceRefSchema = z.strictObject({
  sourceId: EntityIdSchema,
});
export type SourceRef = z.infer<typeof SourceRefSchema>;

/**
 * Kinds of ingested/context sources. Deliberately generic: ingestion lanes
 * map arbitrary documents into these, no scenario-specific kinds allowed.
 */
export const SourceKindSchema = z.enum([
  'WEBPAGE',
  'EMAIL',
  'DOCUMENT',
  'BOOKING_CONFIRMATION',
  'POLICY_DOCUMENT',
  'INSURANCE_DOCUMENT',
  'PROFILE',
  'PROVIDER_STATE',
  'RESEARCH',
  'MANUAL',
]);
export type SourceKind = z.infer<typeof SourceKindSchema>;

/** Persisted evidence record. Raw payloads stay outside trip state. */
export const SourceRecordSchema = z.strictObject({
  id: EntityIdSchema,
  kind: SourceKindSchema,
  title: z.string().optional(),
  uri: z.string().optional(),
  authority: FactAuthoritySchema,
  retrievedAt: IsoDateTimeSchema,
  contentRef: z.string().optional(),
  notes: z.string().optional(),
});
export type SourceRecord = z.infer<typeof SourceRecordSchema>;

/**
 * A critical fact with provenance/freshness. Wrap any value schema:
 * `FactSchema(z.string())`.
 */
export function FactSchema<ValueSchema extends z.ZodType>(valueSchema: ValueSchema) {
  return z.strictObject({
    value: valueSchema,
    sourceId: EntityIdSchema,
    authority: FactAuthoritySchema,
    confidence: z.number().min(0).max(1).optional(),
    observedAt: IsoDateTimeSchema,
    verifiedAt: IsoDateTimeSchema.optional(),
    validUntil: IsoDateTimeSchema.optional(),
  });
}
export type Fact<T> = {
  value: T;
  sourceId: EntityId;
  authority: FactAuthority;
  confidence?: number;
  observedAt: IsoDateTime;
  verifiedAt?: IsoDateTime;
  validUntil?: IsoDateTime;
};

/** Evidence freshness judgement: stale facts must degrade to UNKNOWN downstream. */
export function isFactStale(fact: { validUntil?: string }, now: string): boolean {
  return fact.validUntil !== undefined && fact.validUntil < now;
}

/** Duration envelope (ARCHITECTURE.md §7) — no fake precision. */
export const DurationEstimateSchema = z.strictObject({
  minimumMinutes: z.number().int().nonnegative().optional(),
  expectedMinutes: z.number().int().nonnegative(),
  conservativeMinutes: z.number().int().nonnegative().optional(),
  sourceId: EntityIdSchema,
  observedAt: IsoDateTimeSchema,
  quality: z.enum(['HIGH', 'MEDIUM', 'LOW']).default('MEDIUM'),
});
export type DurationEstimate = z.infer<typeof DurationEstimateSchema>;

export const MoneySchema = z.strictObject({
  amount: z.number(),
  currency: z.string().length(3),
});
export type Money = z.infer<typeof MoneySchema>;

/** Typed reference to any tracked entity, used by relations/constraints. */
export const EntityTypeSchema = z.enum([
  'ORGANISATION',
  'TRAVELLER',
  'ANCHOR_EVENT',
  'TRIP',
  'TRIP_ELEMENT',
  'TRIP_OBJECTIVE',
  'PLACE',
  'RULE_SET',
  'CONSTRAINT',
]);
export type EntityType = z.infer<typeof EntityTypeSchema>;

export const EntityRefSchema = z.strictObject({
  entityType: EntityTypeSchema,
  id: EntityIdSchema,
});
export type EntityRef = z.infer<typeof EntityRefSchema>;

/** Recorded uncertainty; never silently converted into certainty. */
export const UncertaintyRecordSchema = z.strictObject({
  id: EntityIdSchema,
  statement: z.string(),
  aboutRefs: z.array(EntityRefSchema).default([]),
  sourceId: EntityIdSchema.optional(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
});
export type UncertaintyRecord = z.infer<typeof UncertaintyRecordSchema>;

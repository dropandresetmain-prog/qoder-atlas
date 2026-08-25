/**
 * F1 — RuleSet / Policy model (ARCHITECTURE.md §3).
 *
 * Rules come from suppliers, organisations, events, entry/immigration sources
 * or insurance documents. Raw source material stays outside trip state;
 * structured rules keep provenance (FR-18: insurance ingested as data, not
 * hardcoded clauses).
 */
import { z } from 'zod';
import {
  DurationEstimateSchema,
  EntityIdSchema,
  IsoDateTimeSchema,
  MoneySchema,
} from './common.ts';
import { ImportanceSchema } from './elements.ts';

/** How transport concentration groups participants for correlated-risk checks. */
export const TransportConcentrationScopeSchema = z.enum(['BOOKING_REF', 'CARRIER_SERVICE']);
export type TransportConcentrationScope = z.infer<typeof TransportConcentrationScopeSchema>;

export const RuleSetKindSchema = z.enum([
  'SUPPLIER',
  'ORGANISATION',
  'EVENT',
  'ENTRY',
  'INSURANCE',
  'OTHER',
]);
export type RuleSetKind = z.infer<typeof RuleSetKindSchema>;

/**
 * Generic responsibility classes for who pays (ADR-037). Deliberately not
 * tied to any event-role semantics: deterministic allocation combines a
 * funded window with these classes and the traveller's own declaration.
 */
export const PayerSchema = z.enum(['EVENT_ORGANISATION', 'TRAVELLER', 'ORGANISATION', 'OTHER']);
export type Payer = z.infer<typeof PayerSchema>;

/** Who a rule directs decisions to; resolved deterministically by authority. */
export const ApproverPrincipalSchema = z.enum([
  'TRAVELLER',
  'ORGANISATION_APPROVER',
  'HUMAN_AGENT',
]);
export type ApproverPrincipal = z.infer<typeof ApproverPrincipalSchema>;

const RuleBase = {
  id: EntityIdSchema,
  sourceId: EntityIdSchema,
  description: z.string().optional(),
  /** Entity refs (elements/objectives/trips) the rule applies to; empty = all in scope. */
  appliesTo: z.array(EntityIdSchema).default([]),
};

export const PolicyRuleSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...RuleBase,
    kind: z.literal('TIME_WINDOW'),
    windowStart: IsoDateTimeSchema.optional(),
    windowEnd: IsoDateTimeSchema.optional(),
  }),
  z.strictObject({
    ...RuleBase,
    kind: z.literal('NO_SHOW_CUTOFF'),
    cutoffAt: IsoDateTimeSchema,
    consequence: z.string().optional(),
  }),
  z.strictObject({
    ...RuleBase,
    kind: z.literal('MIN_BUFFER'),
    buffer: DurationEstimateSchema,
  }),
  z.strictObject({
    ...RuleBase,
    kind: z.literal('SPEND_LIMIT'),
    maxAmount: MoneySchema,
    /** Recurrence semantics for the limit; absent means per-trip. */
    period: z.enum(['TRIP', 'NIGHT']).optional(),
  }),
  z.strictObject({
    ...RuleBase,
    kind: z.literal('APPROVAL_ABOVE_SPEND'),
    threshold: MoneySchema,
    approver: ApproverPrincipalSchema,
  }),
  z.strictObject({
    ...RuleBase,
    kind: z.literal('APPROVAL_REQUIRED'),
    approver: ApproverPrincipalSchema,
    /** Optional operation filter, e.g. only flight changes need approval. */
    operations: z.array(z.string()).optional(),
  }),
  z.strictObject({
    ...RuleBase,
    kind: z.literal('CHANGE_TERMS'),
    allowed: z.boolean(),
    fee: MoneySchema.optional(),
    repriceExpected: z.boolean().optional(),
  }),
  z.strictObject({
    ...RuleBase,
    kind: z.literal('CANCELLATION_TERMS'),
    refundable: z.boolean(),
    refundDeadline: IsoDateTimeSchema.optional(),
    fee: MoneySchema.optional(),
  }),
  z.strictObject({
    ...RuleBase,
    kind: z.literal('NO_SHOW_TERMS'),
    consequence: z.string(),
    fee: MoneySchema.optional(),
  }),
  z.strictObject({
    ...RuleBase,
    kind: z.literal('INSURANCE_COVERAGE'),
    coveredReasons: z.array(z.string()),
    excess: MoneySchema.optional(),
    maxPayout: MoneySchema.optional(),
  }),
  z.strictObject({
    ...RuleBase,
    /**
     * Funding coverage window (ADR-037): costs falling inside the window are
     * the covered payer's responsibility; incremental costs outside it fall
     * to `incrementalPayer`. Deterministic allocation/approval reasoning uses
     * this plus the traveller's own funding declaration — never hardcoded
     * extension semantics.
     */
    kind: z.literal('FUNDED_WINDOW'),
    windowStart: IsoDateTimeSchema.optional(),
    windowEnd: IsoDateTimeSchema.optional(),
    coveredBy: PayerSchema,
    incrementalPayer: PayerSchema.default('TRAVELLER'),
  }),
  z.strictObject({
    ...RuleBase,
    kind: z.literal('ENTRY_REQUIREMENT'),
    requirement: z.string(),
    /** Legal/entry facts require authoritative sourcing (FR-17, ADR-015). */
    authoritativeSourceId: EntityIdSchema,
  }),
  z.strictObject({
    ...RuleBase,
    /**
     * Correlated-risk / transport concentration (generic): flag when too many
     * critical-importance travellers share one booking reference or one
     * carrier service (carrier + departure). Threshold and scope come from
     * policy data — never scenario, city, or supplier hardcoding.
     */
    kind: z.literal('TRANSPORT_CONCENTRATION'),
    /** Maximum critical travellers allowed in one concentration group. */
    maxCriticalParticipants: z.number().int().nonnegative(),
    /** Importance that counts as critical for this rule; default REQUIRED. */
    criticalImportance: ImportanceSchema.default('REQUIRED'),
    scope: TransportConcentrationScopeSchema,
  }),
  z.strictObject({
    ...RuleBase,
    kind: z.literal('OTHER'),
    statement: z.string(),
  }),
]);
export type PolicyRule = z.infer<typeof PolicyRuleSchema>;

export const PolicyRuleKindSchema = z.enum([
  'TIME_WINDOW',
  'NO_SHOW_CUTOFF',
  'MIN_BUFFER',
  'SPEND_LIMIT',
  'APPROVAL_ABOVE_SPEND',
  'APPROVAL_REQUIRED',
  'CHANGE_TERMS',
  'CANCELLATION_TERMS',
  'NO_SHOW_TERMS',
  'INSURANCE_COVERAGE',
  'FUNDED_WINDOW',
  'ENTRY_REQUIREMENT',
  'TRANSPORT_CONCENTRATION',
  'OTHER',
]);
export type PolicyRuleKind = z.infer<typeof PolicyRuleKindSchema>;

export const RuleSetSchema = z.strictObject({
  id: EntityIdSchema,
  kind: RuleSetKindSchema,
  name: z.string(),
  ownerOrganisationId: EntityIdSchema.optional(),
  sourceId: EntityIdSchema,
  rules: z.array(PolicyRuleSchema).default([]),
});
export type RuleSet = z.infer<typeof RuleSetSchema>;

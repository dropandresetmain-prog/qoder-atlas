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

export const RuleSetKindSchema = z.enum([
  'SUPPLIER',
  'ORGANISATION',
  'EVENT',
  'ENTRY',
  'INSURANCE',
  'OTHER',
]);
export type RuleSetKind = z.infer<typeof RuleSetKindSchema>;

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
    kind: z.literal('ENTRY_REQUIREMENT'),
    requirement: z.string(),
    /** Legal/entry facts require authoritative sourcing (FR-17, ADR-015). */
    authoritativeSourceId: EntityIdSchema,
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
  'ENTRY_REQUIREMENT',
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

/**
 * Northstar — persisted FX normalization record on an ActionIntent (ADR-052).
 *
 * Kept as its own schema module so the frozen intent contract stays free of
 * engine imports while carrying the evidence of HOW a provider-currency
 * charge was restated into the organisation home currency for authority.
 */
import { z } from 'zod';
import { EntityIdSchema, IsoDateTimeSchema, MoneySchema } from '../domain/common.ts';

export const FxNormalizationRecordSchema = z.strictObject({
  /** Home currency the comparison was made in (organisation-configured). */
  homeCurrency: z.string().regex(/^[A-Z]{3}$/),
  /** The home-currency restatement authority actually evaluated. */
  homeSpend: MoneySchema,
  /** Home units per one provider-currency unit; exact for same-currency. */
  rate: z.number().positive(),
  /** Id of the FxRateEvidence used; `same_currency` needs no evidence. */
  fxSourceId: EntityIdSchema.optional(),
  /** Instant the rate's effective period was judged against. */
  normalizedAt: IsoDateTimeSchema,
});
export type FxNormalizationRecord = z.infer<typeof FxNormalizationRecordSchema>;

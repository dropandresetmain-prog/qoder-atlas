/**
 * Dataset / scenario bundle shape for organisation budget FX evidence.
 * Kept free of SQLite so PostgreSQL demo materialization can load it without
 * reaching the retired runtime.
 */
import { z } from 'zod';
import { FxRateEvidenceSchema, type FxRateEvidence } from '../engine/fx.ts';

export const FxRateBundleSchema = z.strictObject({
  rates: z.array(FxRateEvidenceSchema).default([]),
});
export type FxRateBundle = z.infer<typeof FxRateBundleSchema>;
export type { FxRateEvidence };

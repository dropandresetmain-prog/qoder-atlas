/**
 * F2 — provider result/error envelope and adapter modes (FR-15, ADR-008).
 *
 * LIVE calls the provider; RECORD calls it and stores the sanitized raw
 * payload; REPLAY loads the stored raw payload. All three feed the SAME
 * `normalize` step — there is no separate demo path.
 */
import { z } from 'zod';
import { IsoDateTimeSchema } from '../domain/common.ts';
import { AdapterModeSchema, type AdapterMode } from '../config/config.ts';

// AdapterMode is an F0 foundation output (config-owned); re-exported here so
// capability seams expose it alongside the envelope.
export { AdapterModeSchema };
export type { AdapterMode };

export const CapabilityErrorCategorySchema = z.enum([
  'NOT_CONFIGURED',
  'AUTH',
  'NETWORK',
  'TIMEOUT',
  'RATE_LIMITED',
  'INVALID_REQUEST',
  'PROVIDER_ERROR',
  'UNAVAILABLE',
]);
export type CapabilityErrorCategory = z.infer<typeof CapabilityErrorCategorySchema>;

export const CapabilityErrorSchema = z.strictObject({
  category: CapabilityErrorCategorySchema,
  code: z.string(),
  message: z.string(),
  retryable: z.boolean().optional(),
});
export type CapabilityError = z.infer<typeof CapabilityErrorSchema>;

export interface CapabilityMeta {
  providerId: string;
  mode: AdapterMode;
  requestedAt: string;
  latencyMs?: number;
  /** Present when RECORD persisted, or REPLAY loaded, a recording. */
  recordingId?: string;
}

/**
 * Structured result envelope. External failure is data, never an exception
 * that can crash a RecoveryCase (NFR-03).
 */
export type CapabilityResult<T> =
  | { ok: true; data: T; meta: CapabilityMeta }
  | { ok: false; error: CapabilityError; meta: CapabilityMeta };

export function capabilityOk<T>(data: T, meta: CapabilityMeta): CapabilityResult<T> {
  return { ok: true, data, meta };
}

export function capabilityError<T>(error: CapabilityError, meta: CapabilityMeta): CapabilityResult<T> {
  return { ok: false, error, meta };
}

/**
 * Sanitized provider-shaped recording (lane C owns the store). Raw payloads
 * must contain no secrets/unsafe personal data before storage.
 */
export const RecordingSchema = z.strictObject({
  id: z.string(),
  providerId: z.string(),
  operation: z.string(),
  recordedAt: IsoDateTimeSchema,
  sanitized: z.literal(true),
  raw: z.unknown(),
});
export type Recording = z.infer<typeof RecordingSchema>;

/**
 * Adapter shape enforcing the shared-normalization rule: LIVE/RECORD obtain a
 * raw payload from the provider, REPLAY obtains it from the recording store,
 * and the identical `normalize` runs in every mode.
 */
export interface ProviderAdapter<Request, Raw, Normalized> {
  readonly providerId: string;
  readonly mode: AdapterMode;
  obtainRaw(request: Request): Promise<Raw>;
  normalize(raw: Raw): Normalized;
}

/**
 * C1 — adapter execution with LIVE/RECORD/REPLAY semantics (FR-15, ADR-008).
 *
 * LIVE obtains the raw payload from the provider; RECORD does the same and
 * additionally persists a sanitized recording; REPLAY loads the recording.
 * All three modes run the adapter's identical `normalize` — there is no
 * separate demo path. External failure is structured data, never an
 * exception that can crash application logic (NFR-03).
 */
import { performance } from 'node:perf_hooks';
import {
  capabilityError,
  capabilityOk,
  type CapabilityError,
  type CapabilityMeta,
  type CapabilityResult,
  type ProviderAdapter,
} from '../contracts/envelope.ts';
import type { RecordingStore } from './recordingStore.ts';
import { recordingIdFor } from './recordingStore.ts';
import { sanitizeRaw } from './sanitize.ts';

/** Structured provider failure thrown by adapters instead of raw errors. */
export class CapabilityFailure extends Error {
  readonly capabilityError: CapabilityError;

  constructor(error: CapabilityError) {
    super(error.message);
    this.name = 'CapabilityFailure';
    this.capabilityError = error;
  }
}

export function capabilityFailure(
  category: CapabilityError['category'],
  code: string,
  message: string,
  retryable?: boolean,
): CapabilityFailure {
  return new CapabilityFailure({ category, code, message, ...(retryable === undefined ? {} : { retryable }) });
}

export interface RunAdapterOptions {
  operation: string;
  /** Secret values redacted from RECORD-persisted payloads. */
  secrets?: ReadonlyArray<string>;
}

export async function runAdapter<Request, Raw, Normalized>(
  adapter: ProviderAdapter<Request, Raw, Normalized>,
  store: RecordingStore,
  request: Request,
  options: RunAdapterOptions,
): Promise<CapabilityResult<Normalized>> {
  const requestedAt = new Date().toISOString();
  const startedAt = performance.now();
  const meta: CapabilityMeta = {
    providerId: adapter.providerId,
    mode: adapter.mode,
    requestedAt,
  };

  let raw: Raw;
  if (adapter.mode === 'REPLAY') {
    const recordingId = recordingIdFor(adapter.providerId, options.operation, request);
    let recording;
    try {
      recording = await store.load(adapter.providerId, options.operation, recordingId);
    } catch (error) {
      return capabilityError(
        {
          category: 'PROVIDER_ERROR',
          code: 'invalid_recording',
          message: `recording failed validation: ${error instanceof Error ? error.message : String(error)}`,
        },
        meta,
      );
    }
    if (!recording) {
      return capabilityError(
        {
          category: 'UNAVAILABLE',
          code: 'recording_not_found',
          message: `no recording for ${adapter.providerId}/${options.operation} (${recordingId})`,
        },
        meta,
      );
    }
    meta.recordingId = recordingId;
    raw = recording.raw as Raw;
  } else {
    try {
      raw = await adapter.obtainRaw(request);
    } catch (error) {
      return capabilityError(toCapabilityError(error), meta);
    }
    if (adapter.mode === 'RECORD') {
      const recordingId = recordingIdFor(adapter.providerId, options.operation, request);
      try {
        await store.save({
          id: recordingId,
          providerId: adapter.providerId,
          operation: options.operation,
          recordedAt: requestedAt,
          sanitized: true,
          raw: sanitizeRaw(raw, options.secrets ?? []),
        });
      } catch (error) {
        return capabilityError(
          {
            category: 'PROVIDER_ERROR',
            code: 'recording_write_failed',
            message: `could not persist recording: ${error instanceof Error ? error.message : String(error)}`,
          },
          meta,
        );
      }
      meta.recordingId = recordingId;
    }
  }

  let normalized: Normalized;
  try {
    normalized = adapter.normalize(raw);
  } catch (error) {
    return capabilityError(
      {
        category: 'PROVIDER_ERROR',
        code: 'invalid_raw_response',
        message: `normalization failed: ${error instanceof Error ? error.message : String(error)}`,
      },
      meta,
    );
  }

  meta.latencyMs = Math.round(performance.now() - startedAt);
  return capabilityOk(normalized, meta);
}

export function toCapabilityError(error: unknown): CapabilityError {
  if (error instanceof CapabilityFailure) return error.capabilityError;
  if (error instanceof Error) {
    const message = error.message;
    if (error.name === 'AbortError' || /timed?\s*out|timeout/i.test(message)) {
      return { category: 'TIMEOUT', code: 'request_timeout', message, retryable: true };
    }
    if (/fetch failed|network|ECONN|ENOTFOUND|ETIMEDOUT|socket/i.test(message)) {
      return { category: 'NETWORK', code: 'network_error', message, retryable: true };
    }
    return { category: 'PROVIDER_ERROR', code: 'provider_error', message };
  }
  return { category: 'PROVIDER_ERROR', code: 'provider_error', message: String(error) };
}

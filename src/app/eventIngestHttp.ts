/**
 * DR-3 — HTTP boundary for the flight-event ingress: `POST /api/events/atlas`.
 *
 * Mission 2 is credential-free: acceptance uses a documented/provider-shaped
 * Atlas event posted through this REAL endpoint (never a direct
 * processDisruption shortcut). The wire body is opaque `unknown` — schema
 * validation happens inside the Atlas normalizer (ingestProviderEvent),
 * which is exactly where Atlas's wire vocabulary belongs; this handler never
 * inspects the payload shape itself.
 */
import type { IsoDateTime } from '../domain/common.ts';
import { ingestProviderEvent, type EventIngestDeps } from './eventIngest.ts';

export type WireResult = { status: number; body: unknown };

/** Structured failure -> wire status; a raw exception never reaches the caller. */
function statusFor(outcomeStatus: string): number {
  switch (outcomeStatus) {
    case 'ACCEPTED':
      return 200;
    case 'DUPLICATE':
      return 200; // idempotent redelivery — not an error
    case 'INVALID_PAYLOAD':
      return 400;
    case 'CORRELATION_FAILED':
      return 422;
    default:
      return 500;
  }
}

export function createEventIngestHandlers(deps: EventIngestDeps): {
  atlasEvent(body: unknown, at: IsoDateTime): Promise<WireResult>;
} {
  return {
    async atlasEvent(body, at) {
      try {
        const outcome = await ingestProviderEvent(deps, 'atlas', body, at);
        return { status: statusFor(outcome.status), body: outcome };
      } catch (error) {
        // Structured failure, never a crash: an unexpected error still
        // becomes a well-formed response, not a thrown exception.
        return {
          status: 500,
          body: { status: 'INGRESS_ERROR', message: error instanceof Error ? error.message : String(error) },
        };
      }
    },
  };
}

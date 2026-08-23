/**
 * D4 — deterministic reasoning over RoutingCapability / TransferCapability
 * (Northstar Wave 2 — RV-N8).
 *
 * Lane C owns the capability adapters; this file lives under src/providers
 * and is dependency-injected (no app/runtime imports). Reasoning helpers
 * translate provider-neutral inputs (a flight arrival change, a booked
 * transfer pickup, an injected RoutingCapability) into deterministic
 * consequence classifications and a route context, honoring CapabilityResult
 * failure envelopes — external failure is data, never a crash.
 *
 * Design rules:
 *  - Deterministic: every classification is a pure function of its inputs.
 *  - Honest: any UNKNOWN input yields UNKNOWN classification.
 *  - Isolated: helpers accept the capability as an injected argument;
 *    tests pass scripted implementations, production passes the live
 *    capability descriptor.
 *  - No side effects: helpers never mutate state and never make a network
 *    call; they project the existing CapabilityResult envelope.
 */
import { compareInstants, instantMillis, type IsoDateTime } from '../../domain/common.ts';
import type { CapabilityResult, RouteContext, RoutingCapability, RoutingQuery } from '../../contracts/index.ts';

export type TransferWindowClassification = 'STILL_OK' | 'TIGHT' | 'MISSED' | 'UNKNOWN';

export interface TransferWindowInputs {
  /** Newly known flight arrival instant. */
  flightArrival: IsoDateTime;
  /** Pickup time already booked on the private transfer. */
  bookedPickupAt: IsoDateTime;
  /**
   * Required buffer between landing and pickup that must hold for a relaxed
   * (STILL_OK) classification. Defaults to 30 minutes when not provided.
   * Must be a non-negative integer minute count.
   */
  minimumBufferMinutes?: number;
  /**
   * Buffer below which the transfer is "tight" (driver may not be ready
   * in time) but still meetable. Defaults to 10 minutes. Must be in
   * [0, minimumBufferMinutes].
   */
  tightBufferMinutes?: number;
}

export interface TransferWindowOutcome {
  classification: TransferWindowClassification;
  /** Effective pickup window; reflects any UNKNOWN propagation. */
  availableMinutes?: number;
  reason: string;
}

const DEFAULT_MIN_BUFFER_MIN = 30;
const DEFAULT_TIGHT_BUFFER_MIN = 10;

/**
 * Classify the consequence of a flight arrival change on a booked private
 * transfer pickup. Deterministic, never guesses: any unparseable input
 * (non-ISO string, negative buffers) yields UNKNOWN with an honest reason.
 */
export function transferWindowImpact(input: TransferWindowInputs): TransferWindowOutcome {
  const minimum = input.minimumBufferMinutes ?? DEFAULT_MIN_BUFFER_MIN;
  const tight = input.tightBufferMinutes ?? DEFAULT_TIGHT_BUFFER_MIN;

  if (!Number.isInteger(minimum) || minimum < 0) {
    return unknownTransfer('minimum buffer must be a non-negative integer');
  }
  if (!Number.isInteger(tight) || tight < 0 || tight > minimum) {
    return unknownTransfer('tight buffer must be a non-negative integer ≤ minimum buffer');
  }

  let arrivalMs: number;
  let pickupMs: number;
  try {
    if (!hasOffset(input.flightArrival) || !hasOffset(input.bookedPickupAt)) {
      return unknownTransfer('flightArrival / bookedPickupAt must include a UTC offset');
    }
    arrivalMs = instantMillis(input.flightArrival);
    pickupMs = instantMillis(input.bookedPickupAt);
  } catch {
    return unknownTransfer('flightArrival / bookedPickupAt must be valid IsoDateTime values');
  }

  if (compareInstants(input.flightArrival, input.bookedPickupAt) > 0) {
    return {
      classification: 'MISSED',
      availableMinutes: -Math.round((arrivalMs - pickupMs) / 60000),
      reason: 'flight arrives after the booked transfer pickup time',
    };
  }

  const availableMinutes = Math.round((pickupMs - arrivalMs) / 60000);
  if (availableMinutes >= minimum) {
    return {
      classification: 'STILL_OK',
      availableMinutes,
      reason: `pickup follows arrival with at least ${minimum} minute buffer`,
    };
  }
  if (availableMinutes >= tight) {
    return {
      classification: 'TIGHT',
      availableMinutes,
      reason: `pickup follows arrival with ${availableMinutes} minute buffer (< ${minimum} minute comfortable target)`,
    };
  }
  return {
    classification: 'MISSED',
    availableMinutes,
    reason: `pickup follows arrival with only ${availableMinutes} minute buffer (< ${tight} minute minimum)`,
  };
}

function unknownTransfer(reason: string): TransferWindowOutcome {
  return { classification: 'UNKNOWN', reason };
}

/**
 * The IsoDateTime type is defined as an ISO-8601 string with an explicit UTC
 * offset. `Date.parse` accepts many shapes that don't carry an offset
 * (e.g. "2026-09-01T10:00" — interpreted as local time); reject those here
 * so reasoning never propagates an ambiguous instant.
 */
function hasOffset(value: string): boolean {
  return /(Z|[+-]\d{2}:?\d{2})$/.test(value);
}

// ---------------------------------------------------------------------------
// routeContextFor — projected RouteContext using an injected RoutingCapability
// ---------------------------------------------------------------------------

export interface RouteContextForOptions {
  /** RoutingCapability the helper talks to; production wires the live
   *  adapter, tests wire a scripted implementation. */
  routing: RoutingCapability;
  query: RoutingQuery;
}

export type RouteContextForResult =
  | { ok: true; context: RouteContext; unavailable?: undefined }
  | { ok: false; unavailable: true; reason: string; envelope: CapabilityResult<RouteContext> };

/**
 * Project a route context via an injected RoutingCapability. Honors
 * CapabilityResult failure envelopes: if the capability returns
 * { ok: false } the helper surfaces the failure as data, never throws
 * or fabricates a RouteContext.
 */
export async function routeContextFor(options: RouteContextForOptions): Promise<RouteContextForResult> {
  const envelope = await options.routing.getRouteContext(options.query);
  if (envelope.ok) {
    return { ok: true, context: envelope.data };
  }
  return {
    ok: false,
    unavailable: true,
    reason: envelope.error.message,
    envelope,
  };
}

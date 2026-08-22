/**
 * I3 — read-only tool dispatch.
 *
 * Fulfils planner ToolRequests against the wired capabilities. Safety is
 * enforced twice: the frozen ToolOperation vocabulary makes consequential
 * operations unrepresentable, and the dispatcher additionally re-validates
 * every request and refuses unknown families/operations with a structured
 * error. Parameter mapping is deterministic and scenario-neutral; malformed
 * parameters produce INVALID_REQUEST data, never guesses.
 */
import { z } from 'zod';
import type {
  FlightCapability,
  ResearchCapability,
  RoutingCapability,
} from '../contracts/capabilities.ts';
import type { CapabilityError, CapabilityResult } from '../contracts/envelope.ts';
import type { ToolRequest } from '../operational/strategy.ts';
import { ToolOperationSchema } from '../operational/strategy.ts';

export interface ToolDispatchCapabilities {
  flight?: FlightCapability;
  routing?: RoutingCapability;
  research?: ResearchCapability;
}

export type ToolDispatchResult =
  | { ok: true; data: Record<string, unknown>; providerId: string; mode: string; recordingId?: string }
  | { ok: false; error: CapabilityError };

const externalRef = z.strictObject({ system: z.string(), value: z.string() });

const FLIGHT_SEARCH_PARAMETERS = z.strictObject({
  origin: externalRef,
  destination: externalRef,
  departureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  passengers: z
    .strictObject({
      adults: z.number().int().min(1),
      children: z.number().int().min(0).optional(),
      infants: z.number().int().min(0).optional(),
    })
    .default({ adults: 1 }),
  cabinClass: z.enum(['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'ANY']).optional(),
  maxStops: z.number().int().min(0).optional(),
});

const FLIGHT_OFFER_PARAMETERS = z.strictObject({ offerId: z.string().min(1) });

const coordinates = z.strictObject({ latitude: z.number(), longitude: z.number() });

const ROUTING_CONTEXT_PARAMETERS = z.strictObject({
  origin: z.strictObject({ externalRef: externalRef.optional(), coordinates: coordinates.optional() }),
  destination: z.strictObject({ externalRef: externalRef.optional(), coordinates: coordinates.optional() }),
  mode: z.enum(['DRIVE', 'TRANSIT', 'WALK']).optional(),
  departAt: z.iso.datetime({ offset: true }).optional(),
});

const ENTRY_RESEARCH_PARAMETERS = z.strictObject({
  destinationCountryCode: z.string().min(2),
  nationalityCodes: z.array(z.string().min(2)).default([]),
  travelDate: z.string().optional(),
});

const LOCAL_CONTEXT_PARAMETERS = z.strictObject({
  topic: z.string().min(1),
  placeRef: externalRef.optional(),
});

function invalidParameters(detail: string): ToolDispatchResult {
  return {
    ok: false,
    error: { category: 'INVALID_REQUEST', code: 'invalid_tool_parameters', message: detail },
  };
}

function capabilityAbsent(operation: string): ToolDispatchResult {
  return {
    ok: false,
    error: {
      category: 'UNAVAILABLE',
      code: 'capability_not_wired',
      message: `no wired capability can fulfil read-only operation ${operation}`,
    },
  };
}

function toDispatchResult(result: CapabilityResult<unknown>): ToolDispatchResult {
  if (!result.ok) return { ok: false, error: result.error };
  return {
    ok: true,
    data: result.data as Record<string, unknown>,
    providerId: result.meta.providerId,
    mode: result.meta.mode,
    ...(result.meta.recordingId === undefined ? {} : { recordingId: result.meta.recordingId }),
  };
}

/**
 * Dispatch one read-only tool request. Never throws: external or parameter
 * failure is structured data the planning loop can surface as evidence.
 */
export async function dispatchToolRequest(
  capabilities: ToolDispatchCapabilities,
  request: ToolRequest,
): Promise<ToolDispatchResult> {
  // Defence in depth on top of the frozen ToolRequest schema.
  const operation = ToolOperationSchema.safeParse(request.operation);
  if (!operation.success) {
    return {
      ok: false,
      error: {
        category: 'INVALID_REQUEST',
        code: 'operation_not_read_only',
        message: `operation ${String(request.operation)} is not part of the frozen read-only tool vocabulary`,
      },
    };
  }

  switch (operation.data) {
    case 'flight.search': {
      if (!capabilities.flight) return capabilityAbsent(operation.data);
      const parsed = FLIGHT_SEARCH_PARAMETERS.safeParse(request.parameters);
      if (!parsed.success) return invalidParameters(`flight.search: ${parsed.error.issues.length} parameter issue(s)`);
      return toDispatchResult(await capabilities.flight.searchFlights(parsed.data));
    }
    case 'flight.verify': {
      if (!capabilities.flight) return capabilityAbsent(operation.data);
      const parsed = FLIGHT_OFFER_PARAMETERS.safeParse(request.parameters);
      if (!parsed.success) return invalidParameters(`flight.verify: ${parsed.error.issues.length} parameter issue(s)`);
      return toDispatchResult(await capabilities.flight.verifyOffer(parsed.data));
    }
    case 'flight.fare_rules': {
      if (!capabilities.flight) return capabilityAbsent(operation.data);
      const parsed = FLIGHT_OFFER_PARAMETERS.safeParse(request.parameters);
      if (!parsed.success) return invalidParameters(`flight.fare_rules: ${parsed.error.issues.length} parameter issue(s)`);
      return toDispatchResult(await capabilities.flight.getFareRules(parsed.data));
    }
    case 'flight.refund_quote': {
      // In the vocabulary but no adapter implements it yet: structured
      // unavailability, never a guess.
      return capabilityAbsent(operation.data);
    }
    case 'routing.context': {
      if (!capabilities.routing) return capabilityAbsent(operation.data);
      const parsed = ROUTING_CONTEXT_PARAMETERS.safeParse(request.parameters);
      if (!parsed.success) return invalidParameters(`routing.context: ${parsed.error.issues.length} parameter issue(s)`);
      return toDispatchResult(await capabilities.routing.getRouteContext(parsed.data));
    }
    case 'research.entry_requirements': {
      if (!capabilities.research) return capabilityAbsent(operation.data);
      const parsed = ENTRY_RESEARCH_PARAMETERS.safeParse(request.parameters);
      if (!parsed.success) {
        return invalidParameters(`research.entry_requirements: ${parsed.error.issues.length} parameter issue(s)`);
      }
      return toDispatchResult(await capabilities.research.researchEntryRequirements(parsed.data));
    }
    case 'research.local_context': {
      if (!capabilities.research) return capabilityAbsent(operation.data);
      const parsed = LOCAL_CONTEXT_PARAMETERS.safeParse(request.parameters);
      if (!parsed.success) {
        return invalidParameters(`research.local_context: ${parsed.error.issues.length} parameter issue(s)`);
      }
      return toDispatchResult(await capabilities.research.researchLocalContext(parsed.data));
    }
    case 'hotel.context':
    case 'hotel.search':
    case 'hotel.quote':
    case 'hotel.retrieve':
    case 'transfer.search':
    case 'transfer.quote':
    case 'transfer.retrieve':
      // No hotel/transfer adapter exists in this build; the request is honest data.
      return capabilityAbsent(operation.data);
    default:
      return capabilityAbsent(String(request.operation));
  }
}

/** Compact deterministic summary of a tool result for planner continuations. */
export function summarizeToolResult(operation: string, result: ToolDispatchResult): string {
  if (!result.ok) return `${operation} failed: ${result.error.category}/${result.error.code}`;
  const data = result.data;
  switch (operation) {
    case 'flight.search': {
      const offers = (data['offers'] ?? []) as Array<Record<string, unknown>>;
      const lines = offers.map((offer) => {
        const segments = (offer['segments'] ?? []) as Array<Record<string, unknown>>;
        const first = segments[0];
        const last = segments[segments.length - 1];
        const price = offer['totalPrice'] as { amount?: number; currency?: string } | undefined;
        return [
          `offer ${String(offer['offerId'] ?? '?')}`,
          first ? `${String(first['departure'])} dep` : '',
          last ? `${String(last['arrival'])} arr` : '',
          price ? `${price.amount ?? '?'} ${price.currency ?? ''}` : '',
          `availability ${String(offer['availability'] ?? 'UNKNOWN')}`,
        ]
          .filter(Boolean)
          .join(' ');
      });
      return `${operation}: ${offers.length} offer(s); ${lines.join(' | ')}`;
    }
    case 'flight.verify':
      return `${operation}: ${String(data['status'] ?? 'UNKNOWN')}`;
    case 'flight.fare_rules': {
      const change = data['change'] as { allowed?: boolean; fee?: { amount?: number; currency?: string } } | undefined;
      const refund = data['refund'] as { refundable?: boolean } | undefined;
      return `${operation}: change ${change ? (change.allowed ? 'allowed' : 'restricted') : 'UNKNOWN'}${
        change?.fee ? ` fee ${change.fee.amount ?? '?'} ${change.fee.currency ?? ''}` : ''
      }; refund ${refund ? (refund.refundable ? 'refundable' : 'non-refundable') : 'UNKNOWN'}`;
    }
    case 'routing.context': {
      const duration = data['duration'] as { expectedMinutes?: number; conservativeMinutes?: number } | undefined;
      return `${operation}: expected ${duration?.expectedMinutes ?? '?'} min (conservative ${duration?.conservativeMinutes ?? '?'} min)`;
    }
    case 'research.entry_requirements':
    case 'research.local_context': {
      const findings = (data['findings'] ?? []) as Array<Record<string, unknown>>;
      return `${operation}: ${findings.length} finding(s)`;
    }
    default:
      return `${operation}: completed`;
  }
}

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
  FlightTransactionCapability,
  HotelCapability,
  ResearchCapability,
  RoutingCapability,
} from '../contracts/capabilities.ts';
import type { CapabilityError, CapabilityResult } from '../contracts/envelope.ts';
import type { ToolRequest } from '../operational/strategy.ts';
import { ToolOperationSchema } from '../operational/strategy.ts';

export interface ToolDispatchCapabilities {
  flight?: FlightCapability;
  /** Transactional flight capability — ONLY its read-only operations are dispatchable. */
  flightTransactions?: FlightTransactionCapability;
  routing?: RoutingCapability;
  research?: ResearchCapability;
  hotel?: HotelCapability;
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

// Read-only transaction inspection (flight.order_status / cancel_quote /
// cancel_status): consequential create/pay/submit stay unreachable from
// tool dispatch — only these query shapes exist here.
const FLIGHT_ORDER_STATUS_PARAMETERS = z.strictObject({
  orderRef: z.string().min(1),
  clientReference: z.string().optional(),
});

const FLIGHT_CANCEL_STATUS_PARAMETERS = FLIGHT_ORDER_STATUS_PARAMETERS.extend({
  cancellationRequestRef: z.string().optional(),
});

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

// Hotel read-only operations. Parameter shapes mirror the frozen capability
// queries exactly, so a REPLAY recording keyed by the canonical query stays
// reachable through tool dispatch (same hash, same recording).
const HOTEL_STAY_CONTEXT_PARAMETERS = z.strictObject({ stayElementId: z.string().min(1) });

const HOTEL_SEARCH_PARAMETERS = z.strictObject({
  location: z.strictObject({
    externalRef: externalRef.optional(),
    coordinates: z
      .strictObject({ latitude: z.number(), longitude: z.number(), radiusKm: z.number().positive().optional() })
      .optional(),
  }),
  checkInDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOutDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // Deterministic occupancy defaults: recorded REPLAY queries were keyed
  // with these present, and a missing occupancy is never a guess at the
  // provider — it is this documented dispatch default.
  guests: z.strictObject({ adults: z.number().int().min(1), children: z.number().int().min(0).optional() }).default({ adults: 1 }),
  rooms: z.number().int().min(1).default(1),
});

const HOTEL_QUOTE_PARAMETERS = z.strictObject({
  rateId: z.string().min(1),
  workflowState: z.record(z.string(), z.unknown()).optional(),
});

const HOTEL_RETRIEVE_PARAMETERS = z.strictObject({ bookingId: z.string().min(1) });

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
    case 'flight.refund_quote':
      // In the vocabulary but no adapter implements it: structured
      // unavailability, never a guess (refund execution stays excluded).
      return capabilityAbsent(operation.data);
    case 'flight.order_status': {
      if (!capabilities.flightTransactions) return capabilityAbsent(operation.data);
      const parsed = FLIGHT_ORDER_STATUS_PARAMETERS.safeParse(request.parameters);
      if (!parsed.success) return invalidParameters(`flight.order_status: ${parsed.error.issues.length} parameter issue(s)`);
      return toDispatchResult(await capabilities.flightTransactions.retrieveOrder(parsed.data));
    }
    case 'flight.cancel_quote': {
      if (!capabilities.flightTransactions) return capabilityAbsent(operation.data);
      const parsed = FLIGHT_ORDER_STATUS_PARAMETERS.safeParse(request.parameters);
      if (!parsed.success) return invalidParameters(`flight.cancel_quote: ${parsed.error.issues.length} parameter issue(s)`);
      return toDispatchResult(await capabilities.flightTransactions.quoteCancellation(parsed.data));
    }
    case 'flight.cancel_status': {
      if (!capabilities.flightTransactions) return capabilityAbsent(operation.data);
      const parsed = FLIGHT_CANCEL_STATUS_PARAMETERS.safeParse(request.parameters);
      if (!parsed.success) return invalidParameters(`flight.cancel_status: ${parsed.error.issues.length} parameter issue(s)`);
      return toDispatchResult(await capabilities.flightTransactions.retrieveCancellationStatus(parsed.data));
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
    case 'hotel.context': {
      if (!capabilities.hotel) return capabilityAbsent(operation.data);
      const parsed = HOTEL_STAY_CONTEXT_PARAMETERS.safeParse(request.parameters);
      if (!parsed.success) return invalidParameters(`hotel.context: ${parsed.error.issues.length} parameter issue(s)`);
      return toDispatchResult(await capabilities.hotel.getStayContext(parsed.data));
    }
    case 'hotel.search': {
      if (!capabilities.hotel) return capabilityAbsent(operation.data);
      const parsed = HOTEL_SEARCH_PARAMETERS.safeParse(request.parameters);
      if (!parsed.success) return invalidParameters(`hotel.search: ${parsed.error.issues.length} parameter issue(s)`);
      return toDispatchResult(await capabilities.hotel.searchHotels(parsed.data));
    }
    case 'hotel.quote': {
      if (!capabilities.hotel) return capabilityAbsent(operation.data);
      const parsed = HOTEL_QUOTE_PARAMETERS.safeParse(request.parameters);
      if (!parsed.success) return invalidParameters(`hotel.quote: ${parsed.error.issues.length} parameter issue(s)`);
      return toDispatchResult(await capabilities.hotel.quoteRate(parsed.data));
    }
    case 'hotel.retrieve': {
      if (!capabilities.hotel) return capabilityAbsent(operation.data);
      const parsed = HOTEL_RETRIEVE_PARAMETERS.safeParse(request.parameters);
      if (!parsed.success) return invalidParameters(`hotel.retrieve: ${parsed.error.issues.length} parameter issue(s)`);
      return toDispatchResult(await capabilities.hotel.retrieveBooking(parsed.data));
    }
    case 'transfer.search':
    case 'transfer.quote':
    case 'transfer.retrieve':
      // No transfer adapter exists in this build; the request is honest data.
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
    case 'flight.order_status':
      return `${operation}: order ${String(data['orderRef'] ?? '?')} status ${String(data['status'] ?? 'UNKNOWN')}`;
    case 'flight.cancel_quote':
      return `${operation}: cancellation ${String(data['availability'] ?? 'UNKNOWN')}`;
    case 'flight.cancel_status':
      return `${operation}: cancellation ${String(data['status'] ?? 'UNKNOWN')}`;
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
    case 'hotel.search': {
      const properties = (data['properties'] ?? []) as Array<Record<string, unknown>>;
      const rates = (data['rates'] ?? []) as Array<Record<string, unknown>>;
      return `${operation}: ${properties.length} propert(y/ies), ${rates.length} rate(s)`;
    }
    case 'hotel.quote':
      return `${operation}: ${String(data['status'] ?? 'UNKNOWN')}${data['quoteId'] ? ` quoteId ${String(data['quoteId'])}` : ''}`;
    case 'hotel.retrieve':
      return `${operation}: ${String(data['status'] ?? 'UNKNOWN')}`;
    case 'hotel.context': {
      const propertyName = data['propertyName'];
      return `${operation}: ${typeof propertyName === 'string' ? propertyName : 'unknown property'}`;
    }
    default:
      return `${operation}: completed`;
  }
}

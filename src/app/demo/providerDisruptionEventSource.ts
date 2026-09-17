/**
 * Disclosed provider-disruption event source for the demo trigger.
 *
 * The founder-visible "simulated airline update" affordance posts without a
 * body: the event it applies is the organiser-disclosed input file configured
 * for this runtime (NORTHSTAR_DEMO_DISRUPTION_EVENT_FILE), exactly as the
 * upstream pack states it. Nothing here knows a specific airline, route or
 * persona — this is a generic reader for the disclosed schedule-change
 * document format; the demo facts live in the configured file alone.
 */
import { readFile } from 'node:fs/promises';
import { toInstant } from './datasetMapping.ts';
import type { TransportServiceCancelledWithReprotectionEvent } from '../target/providerDisruptionIngress.ts';

/** Configured disclosed-disruption input file, or undefined when unset. */
export function disruptionEventFileFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = (env.NORTHSTAR_DEMO_DISRUPTION_EVENT_FILE ?? '').trim();
  return raw === '' ? undefined : raw;
}

/** Minimal shape of the disclosed schedule-change document. */
interface DisclosedScheduleChange {
  provenance?: unknown;
  eventId?: unknown;
  eventType?: unknown;
  issuedAt?: unknown;
  sourceIds?: unknown;
  carrier?: { code?: unknown };
  flight?: {
    flightNumber?: unknown;
    originalSchedule?: { departure?: unknown };
    newSchedule?: { departure?: unknown; arrival?: unknown };
    reason?: unknown;
  };
  ticketedManagedTravellers?: Array<{ pnr?: unknown; segments?: unknown }>;
}

function string(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`disclosed disruption event: ${what} is missing`);
  }
  return value;
}

/**
 * The disclosed manifest states the involuntary rebooking as a segment
 * string `ORIG-DEST <original-flight> ? <replacement-flight>`; the
 * replacement service identity is the flight the travellers were reprotected
 * onto, in the same <flight>@<departure-instant> convention the dataset
 * materializer records services with (UTC instant).
 */
function replacementFlightFromSegments(segments: unknown, originalFlight: string): string {
  if (!Array.isArray(segments)) {
    throw new Error('disclosed disruption event: ticketedManagedTravellers[].segments missing');
  }
  const pattern = /\?\s*(\S+)\s*$/u;
  for (const segment of segments) {
    if (typeof segment !== 'string') continue;
    if (!segment.includes(originalFlight)) continue;
    const match = pattern.exec(segment.trim());
    if (match) return match[1]!;
  }
  throw new Error(`disclosed disruption event: no reprotected-to flight stated after "${originalFlight} ?"`);
}

/**
 * Read and map the disclosed document into the generic provider-event shape.
 * Only documents marked as simulated external events may enter the demo
 * ingress — anything else is refused, never silently applied.
 */
export async function loadDisclosedDisruptionEvent(filePath: string): Promise<TransportServiceCancelledWithReprotectionEvent> {
  const raw = JSON.parse(await readFile(filePath, 'utf8')) as DisclosedScheduleChange;

  if (raw.provenance !== 'SIMULATED_EXTERNAL_EVENT') {
    throw new Error('disclosed disruption event: provenance is not a disclosed simulated external event');
  }
  const providerEventId = string(raw.eventId, 'eventId');
  const carrierCode = string(raw.carrier?.code, 'carrier.code');
  const flightNumber = string(raw.flight?.flightNumber, 'flight.flightNumber');
  const originalDeparture = string(raw.flight?.originalSchedule?.departure, 'flight.originalSchedule.departure');
  const replacementDeparture = string(raw.flight?.newSchedule?.departure, 'flight.newSchedule.departure');
  const replacementArrival = string(raw.flight?.newSchedule?.arrival, 'flight.newSchedule.arrival');
  const travellers = Array.isArray(raw.ticketedManagedTravellers) ? raw.ticketedManagedTravellers : [];
  if (travellers.length === 0) throw new Error('disclosed disruption event: no ticketed travellers stated');

  // Provider identity: the source the organiser says the event came from.
  if (!Array.isArray(raw.sourceIds) || raw.sourceIds.length === 0) {
    throw new Error('disclosed disruption event: sourceIds missing');
  }
  const providerId = string(raw.sourceIds[0], 'sourceIds[0]').replace(/^src-/u, '');

  const replacementFlight = replacementFlightFromSegments(travellers[0]?.segments, flightNumber);

  return {
    kind: 'TRANSPORT_SERVICE_CANCELLED_WITH_REPROTECTION',
    providerId,
    providerEventId,
    receivedAt: string(raw.issuedAt, 'issuedAt'),
    disclosedAsSimulatedDemoInput: true,
    originalService: {
      recordType: 'SOURCE_TRANSPORT_SERVICE',
      externalId: `${flightNumber}@${toInstant(originalDeparture, 'originalSchedule.departure')}`,
    },
    replacementService: {
      recordType: 'SOURCE_TRANSPORT_SERVICE',
      externalId: `${replacementFlight}@${toInstant(replacementDeparture, 'newSchedule.departure')}`,
      operator: carrierCode,
      scheduledDeparture: replacementDeparture,
      scheduledArrival: replacementArrival,
    },
    affectedBookings: travellers.map((traveller) => ({
      recordType: 'SOURCE_BOOKING_REFERENCE',
      externalId: string(traveller.pnr, 'ticketedManagedTravellers[].pnr'),
    })),
    reason: string(raw.flight?.reason, 'flight.reason'),
    provenanceKind: string(raw.eventType, 'eventType'),
  };
}

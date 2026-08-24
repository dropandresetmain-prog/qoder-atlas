/**
 * DR-3 — generic (provider-neutral) flight-event ingress pipeline.
 *
 * provider HTTP ingress -> persist raw event inbox entry (SQLite) ->
 * deduplicate provider delivery -> [provider-specific normalization happens
 * in the injected ExternalFlightEventNormalizer] -> generic
 * ExternalProviderEventEnvelope -> correlate provider order refs to a trip
 * -> ASSERTED-at-most normalized TripSignal -> existing impact/recovery
 * machinery (RuntimeOrchestrator.processDisruption).
 *
 * This module knows NOTHING about Atlas (or any other provider)'s wire
 * vocabulary — that lives entirely behind the injected
 * ExternalFlightEventNormalizer (src/providers/*\/eventNormalizer.ts).
 * Generic inbox/application code here carries no provider status-code
 * assumptions.
 */
import type { EntityId, IsoDateTime } from '../domain/common.ts';
import type { ExternalFlightEventNormalizer } from '../contracts/capabilities.ts';
import type { TripRepository } from '../contracts/repositories.ts';
import type { TripSignal } from '../operational/signal.ts';
import type { RuntimeOrchestrator } from './runtime.ts';
import type { ProcessedSignal } from './signalPipeline.ts';
import type { EventInboxStore } from './eventInboxStore.ts';

export interface EventIngestDeps {
  inbox: EventInboxStore;
  normalizer: ExternalFlightEventNormalizer;
  trips: TripRepository;
  orchestrator: RuntimeOrchestrator;
}

export type EventIngestStatus =
  | 'ACCEPTED'
  | 'DUPLICATE'
  | 'INVALID_PAYLOAD'
  | 'CORRELATION_FAILED';

export interface EventIngestResultItem {
  signalId: EntityId;
  tripId: EntityId;
  caseId: EntityId;
  caseStatus: string;
  processed: ProcessedSignal;
}

export interface EventIngestOutcome {
  status: EventIngestStatus;
  providerId: string;
  providerEventId?: string;
  /** Present only when status === 'ACCEPTED'. */
  results?: EventIngestResultItem[];
  /** Present for INVALID_PAYLOAD / CORRELATION_FAILED. */
  issues?: string[];
}

/**
 * Correlate a provider's order references to a trip. Generic: any provider
 * whose bookingRef.reference matches one of the given refs resolves,
 * regardless of which adapter/system supplied it — this is not Atlas-
 * specific correlation logic.
 */
async function correlateOrderRefs(
  trips: TripRepository,
  providerOrderRefs: string[],
): Promise<{ tripId: EntityId; elementId: EntityId } | undefined> {
  if (providerOrderRefs.length === 0) return undefined;
  const refs = new Set(providerOrderRefs);
  for (const summary of await trips.listTrips()) {
    const trip = await trips.getTrip(summary.tripId);
    if (!trip) continue;
    for (const element of trip.elements) {
      if (element.elementKind !== 'TRANSPORT_LEG') continue;
      const reference = element.data.bookingRef?.reference;
      if (reference !== undefined && refs.has(reference)) {
        return { tripId: trip.id, elementId: element.id };
      }
    }
  }
  return undefined;
}

/**
 * Defense in depth: an externally-normalized signal must never carry
 * AUTHORITATIVE/CONNECTED authority (ADR-044). The normalizer contract
 * already enforces ASSERTED-at-best; this is a second, cheap check at the
 * generic ingress boundary in case a normalizer implementation regresses.
 */
function enforceAssertedCeiling(signal: TripSignal): TripSignal {
  if (signal.authority === 'AUTHORITATIVE' || signal.authority === 'CONNECTED') {
    return { ...signal, authority: 'ASSERTED' };
  }
  return signal;
}

/**
 * Ingest one raw provider-shaped event through the full generic pipeline.
 * Never throws: every failure mode (invalid payload, duplicate delivery,
 * correlation failure) is a structured EventIngestOutcome.
 */
export async function ingestProviderEvent(
  deps: EventIngestDeps,
  providerId: string,
  raw: unknown,
  at: IsoDateTime,
): Promise<EventIngestOutcome> {
  // 1. Normalize first (pure parse — no state touched) so we know the
  //    provider's own event identity for inbox dedup/persistence.
  const normalized = await deps.normalizer.normalize(raw);
  if (!normalized.ok) {
    return {
      status: 'INVALID_PAYLOAD',
      providerId,
      issues: [`${normalized.error.category}: ${normalized.error.code}: ${normalized.error.message}`],
    };
  }
  const { envelope, signals } = normalized.data;

  // 2. Persist the raw delivery BEFORE any further processing — this is
  //    the inbox entry that makes duplicate delivery detectable, and it
  //    exists regardless of what happens next.
  const delivery = await deps.inbox.recordDelivery({
    providerId: envelope.providerId,
    providerEventId: envelope.providerEventId,
    receivedAt: at,
    rawPayload: raw,
  });
  if (!delivery.inserted) {
    return { status: 'DUPLICATE', providerId, providerEventId: envelope.providerEventId };
  }

  // 3. Correlate provider order refs to a trip (generic, provider-neutral).
  const correlation = await correlateOrderRefs(deps.trips, envelope.providerOrderRefs);
  if (!correlation) {
    await deps.inbox.markProcessed(envelope.providerId, envelope.providerEventId, {
      status: 'CORRELATION_FAILED',
    });
    return {
      status: 'CORRELATION_FAILED',
      providerId,
      providerEventId: envelope.providerEventId,
      issues: [`no trip element's bookingRef matches provider order refs [${envelope.providerOrderRefs.join(', ')}]`],
    };
  }

  // 4. Feed each ASSERTED-ceiling signal through the SAME generic recovery
  //    pipeline every other disruption source uses.
  const results: EventIngestResultItem[] = [];
  for (const rawSignal of signals) {
    const signal = enforceAssertedCeiling({
      ...rawSignal,
      tripId: rawSignal.tripId ?? correlation.tripId,
      subjectRef: rawSignal.subjectRef ?? { entityType: 'TRIP_ELEMENT', id: correlation.elementId },
    });
    const processed = await deps.orchestrator.processDisruption(signal, at);
    results.push({
      signalId: signal.id,
      tripId: processed.tripId,
      caseId: processed.caseId,
      caseStatus: processed.caseStatus,
      processed,
    });
  }

  await deps.inbox.markProcessed(envelope.providerId, envelope.providerEventId, {
    status: 'ACCEPTED',
    tripId: correlation.tripId,
    ...(results[0] ? { signalId: results[0].signalId, caseId: results[0].caseId } : {}),
  });

  return { status: 'ACCEPTED', providerId, providerEventId: envelope.providerEventId, results };
}

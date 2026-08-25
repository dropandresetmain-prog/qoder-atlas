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
import { instantMillis } from '../domain/common.ts';
import type { ExternalFlightEventNormalizer } from '../contracts/capabilities.ts';
import type { TripRepository } from '../contracts/repositories.ts';
import type { TripSignal } from '../operational/signal.ts';
import type { RuntimeOrchestrator } from './runtime.ts';
import type { ProcessedSignal } from './signalPipeline.ts';
import type { EventInboxStore } from './eventInboxStore.ts';
import type { Trip } from '../domain/trip.ts';
import { hashId } from '../ingest/ids.ts';

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
): Promise<Array<{ tripId: EntityId; elementId: EntityId }>> {
  if (providerOrderRefs.length === 0) return [];
  const refs = new Set(providerOrderRefs);
  const matches: Array<{ tripId: EntityId; elementId: EntityId }> = [];
  for (const summary of await trips.listTrips()) {
    const trip = await trips.getTrip(summary.tripId);
    if (!trip) continue;
    for (const element of trip.elements) {
      if (element.elementKind !== 'TRANSPORT_LEG') continue;
      const reference = element.data.bookingRef?.reference;
      if (reference !== undefined && refs.has(reference)) {
        matches.push({ tripId: trip.id, elementId: element.id });
      }
    }
  }
  return matches;
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
 * Narrow correlated candidate elements within one trip using the provider
 * event's own segment evidence. Generic semantics:
 *
 *   booking/order reference narrows candidate bookings/trips;
 *   provider event/segment evidence narrows the affected element(s).
 *
 * Today the evidence used is the event's stated departure instant compared
 * against each leg's authoritative scheduled departure (instant comparison,
 * never string comparison). Exactly one survivor -> SEGMENT_EVIDENCE.
 * Otherwise the event is genuinely order-level/ambiguous: a deterministic
 * primary candidate (earliest departure, undated legs last) anchors the
 * trip-level impact and the ambiguity is recorded — no fabricated precision,
 * and never extra recovery cases merely because legs share one booking ref.
 */
function narrowAffectedElement(
  candidates: Array<{ elementId: EntityId; departureMs?: number }>,
  evidence: { departureIso?: string },
): { elementId: EntityId; resolution: 'SEGMENT_EVIDENCE' | 'ORDER_LEVEL_PRIMARY' } {
  if (candidates.length === 1) {
    return { elementId: candidates[0]!.elementId, resolution: 'SEGMENT_EVIDENCE' };
  }
  if (evidence.departureIso !== undefined) {
    const evidenceMs = Date.parse(evidence.departureIso);
    const survivors = candidates.filter(
      (candidate) => candidate.departureMs !== undefined && candidate.departureMs === evidenceMs,
    );
    if (survivors.length === 1) {
      return { elementId: survivors[0]!.elementId, resolution: 'SEGMENT_EVIDENCE' };
    }
  }
  const ordered = [...candidates].sort(
    (a, b) => (a.departureMs ?? Number.POSITIVE_INFINITY) - (b.departureMs ?? Number.POSITIVE_INFINITY),
  );
  return { elementId: ordered[0]!.elementId, resolution: 'ORDER_LEVEL_PRIMARY' };
}

/** Departure instant (epoch ms) of a transport-leg element, when dated. */
function legDepartureMs(trip: Trip, elementId: EntityId): number | undefined {
  const element = trip.elements.find((candidate) => candidate.id === elementId);
  if (element?.elementKind !== 'TRANSPORT_LEG') return undefined;
  return element.data.scheduledDeparture
    ? instantMillis(element.data.scheduledDeparture.value)
    : undefined;
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

  // 3. Correlate provider order refs to trips (generic, provider-neutral).
  //    The booking/order reference narrows candidate TRIPS; which element(s)
  //    inside a trip are affected is decided per signal by segment evidence.
  const correlations = await correlateOrderRefs(deps.trips, envelope.providerOrderRefs);
  if (correlations.length === 0) {
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

  // 4. Feed every affected trip through the SAME generic recovery pipeline
  //    every other disruption source uses. A provider order/service can cover
  //    several independent trips; every matched trip is processed. Within a
  //    trip, ONE signal is emitted per provider event — multiple legs sharing
  //    a real booking reference must not multiply into duplicate recovery
  //    cases (see narrowAffectedElement). Signal ids are stable per
  //    normalized source signal + canonical trip, so retries remain
  //    idempotent without attaching scenario identity to domain state.
  const correlationsByTrip = new Map<EntityId, Array<{ tripId: EntityId; elementId: EntityId }>>();
  for (const correlation of correlations) {
    const existing = correlationsByTrip.get(correlation.tripId) ?? [];
    existing.push(correlation);
    correlationsByTrip.set(correlation.tripId, existing);
  }

  const results: EventIngestResultItem[] = [];
  for (const rawSignal of signals) {
    for (const [tripId, tripCorrelations] of correlationsByTrip) {
      const trip = await deps.trips.getTrip(tripId);
      if (!trip) continue;
      const narrowed = narrowAffectedElement(
        tripCorrelations.map((correlation) => ({
          elementId: correlation.elementId,
          departureMs: legDepartureMs(trip, correlation.elementId),
        })),
        {
          departureIso:
            typeof rawSignal.payload['scheduledDeparture'] === 'string'
              ? (rawSignal.payload['scheduledDeparture'] as string)
              : undefined,
        },
      );
      const signal = enforceAssertedCeiling({
        ...rawSignal,
        id: hashId('sig-provider-impact', rawSignal.id, tripId),
        tripId,
        subjectRef: rawSignal.subjectRef ?? { entityType: 'TRIP_ELEMENT', id: narrowed.elementId },
        payload: {
          ...rawSignal.payload,
          // Evidence transparency: how the affected element was chosen inside
          // the matched booking. Never interpreted as business truth.
          correlation: {
            providerOrderRefs: envelope.providerOrderRefs,
            candidateElementCount: tripCorrelations.length,
            resolution: narrowed.resolution,
          },
        },
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
  }

  await deps.inbox.markProcessed(envelope.providerId, envelope.providerEventId, {
    status: 'ACCEPTED',
    tripId: correlations[0]!.tripId,
    ...(results[0] ? { signalId: results[0].signalId, caseId: results[0].caseId } : {}),
  });

  return { status: 'ACCEPTED', providerId, providerEventId: envelope.providerEventId, results };
}

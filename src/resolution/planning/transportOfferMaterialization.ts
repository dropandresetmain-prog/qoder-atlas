/**
 * R1 planning-only transport offer materialization.
 *
 * Provider search evidence is not a booking or canonical supplier truth. This
 * creates an isolated CapturedWorld copy only so RC-6 can evaluate a proposed
 * selection against a concrete service. It never writes PostgreSQL.
 */
import type { PlanningToolResult } from '../../contracts/v2/planning/planningTool.ts';
import type { Instant } from '../../domain/v2/shared/time.ts';
import type { ResolvedOffer } from '../scenarios/overlay.ts';
import type { CapturedWorld, WTransportService } from '../world/world.ts';
import type { FailingSubject } from './proposer.ts';
import { correlatedTransportOffers, type TransportCorrelatedOffer } from './proposers/transportProposer.ts';
import {
  transportCorridors,
  transportRequestId,
  type AirportResolver,
  type TransportCorridor,
  type TransportPassengerSource,
} from './transportCorridors.ts';

export interface MaterializedTransportOffers {
  world: CapturedWorld;
  resolvedOffers: readonly ResolvedOffer[];
  capturedServices: readonly WTransportService[];
}

function sameRef(a: { system: string; value: string }, b: { system: string; value: string }): boolean {
  return a.system.toUpperCase() === b.system.toUpperCase() && a.value.trim().toUpperCase() === b.value.trim().toUpperCase();
}

function materializeOffer(
  offer: TransportCorrelatedOffer,
  result: PlanningToolResult,
  corridor: TransportCorridor,
): WTransportService | undefined {
  const first = offer.offer.segments[0];
  const last = offer.offer.segments[offer.offer.segments.length - 1];
  // An offer that no longer describes the requested corridor is not silently
  // repurposed. Leaving it uncaptured makes the overlay reject it honestly.
  if (!first || !last || !sameRef(first.origin, corridor.origin) || !sameRef(last.destination, corridor.destination)) return undefined;
  const departure = { value: first.departure, observedAt: result.provenance.observedAt, evidenceId: null };
  const arrival = { value: last.arrival, observedAt: result.provenance.observedAt, evidenceId: null };
  return {
    id: offer.transportServiceId,
    revision: 0,
    mode: 'FLIGHT',
    operator: first.carrierCode ?? result.provenance.providerId ?? 'UNKNOWN',
    originPlaceId: corridor.originPlaceId,
    destinationPlaceId: corridor.destinationPlaceId,
    published: { departure, arrival },
    estimated: { departure: null, arrival: null },
    actual: { departure: null, arrival: null },
    researchedOffer: {
      rawOfferId: offer.rawOfferId,
      ...(result.provenance.providerId ? { providerId: result.provenance.providerId } : {}),
      provenance: {
        mode: result.provenance.mode,
        observedAt: result.provenance.observedAt,
        sourceRefs: [...result.provenance.sourceRefs],
        ...(result.provenance.recordingRef ? { recordingRef: result.provenance.recordingRef } : {}),
      },
      commercial: {
        amount: offer.offer.totalPrice.amount,
        currency: offer.offer.totalPrice.currency,
        availability: offer.offer.availability,
        ...(offer.offer.fareFamily ? { fareFamily: offer.offer.fareFamily } : {}),
        ...(offer.offer.expiresAt ? { expiresAt: offer.offer.expiresAt } : {}),
      },
      segments: offer.offer.segments.map((segment) => ({ ...segment })),
      uncertainty: result.uncertainty.map((item) => ({ code: item.code, summary: item.summary })),
    },
  };
}

/**
 * Adds only successfully researched, boardable, corridor-matching services to
 * a deep planning copy. Canonical service rows, reservation state, and the
 * original world object are unchanged.
 */
export function materializeTransportOffers(input: TransportPassengerSource & {
  world: CapturedWorld;
  failing: readonly FailingSubject[];
  toolResults: readonly PlanningToolResult[];
  now: Instant;
  resolveAirport: AirportResolver;
  maxOffersPerCorridor?: number;
}): MaterializedTransportOffers {
  const { corridors } = transportCorridors(input.world, input.failing, {
    resolveAirport: input.resolveAirport,
    ...(input.passengers ? { passengers: input.passengers } : {}),
    ...(input.passengersFor ? { passengersFor: input.passengersFor } : {}),
  });
  const correlated = correlatedTransportOffers({
    corridors,
    toolResults: input.toolResults,
    now: input.now,
    maxOffersPerCorridor: input.maxOffersPerCorridor ?? 6,
  });
  const corridorByItem = new Map(corridors.map((corridor) => [corridor.journeyItemId, corridor]));
  const resultByRequest = new Map(input.toolResults.map((result) => [result.requestId, result]));
  const capturedServices: WTransportService[] = [];
  const resolvedOffers: ResolvedOffer[] = [];
  for (const offer of correlated.offers) {
    const corridor = corridorByItem.get(offer.journeyItemId);
    const result = corridor ? resultByRequest.get(transportRequestId(corridor)) : undefined;
    if (!corridor || !result || result.status !== 'SUCCEEDED') continue;
    const service = materializeOffer(offer, result, corridor);
    if (!service) continue;
    capturedServices.push(service);
    resolvedOffers.push({ offerId: offer.offerKey, transportServiceId: service.id });
  }

  const world = structuredClone(input.world);
  const existing = new Set(world.transportServices.map((service) => service.id));
  world.transportServices.push(...capturedServices.filter((service) => !existing.has(service.id)));
  return { world, resolvedOffers, capturedServices };
}

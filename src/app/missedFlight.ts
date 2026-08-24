import type { EntityId, IsoDateTime } from '../domain/common.ts';
import { compareInstants } from '../domain/common.ts';
import type { TripSignal } from '../operational/signal.ts';
import type { RuntimeOrchestrator } from './runtime.ts';
import type { ProcessedSignal } from './signalPipeline.ts';
import type { MutationProposal } from '../operational/mutation.ts';
import type { TripRepository } from '../contracts/repositories.ts';
import type { MutationService } from '../contracts/services.ts';
import type { Trip } from '../domain/trip.ts';
import type { TransportLeg } from '../domain/elements.ts';

export interface MissedFlightInput {
  tripId: EntityId;
  elementId?: EntityId;
  travellerReport: string;
  at: IsoDateTime;
}

export interface MissedFlightOutcome {
  signalId: EntityId;
  caseId: EntityId;
  caseStatus: string;
  missedElementId: EntityId;
  processed: ProcessedSignal;
}

export interface MissedFlightDeps {
  orchestrator: RuntimeOrchestrator;
  trips: TripRepository;
  mutations: MutationService;
}

export async function reportMissedFlight(
  deps: MissedFlightDeps,
  input: MissedFlightInput,
): Promise<MissedFlightOutcome> {
  // 1. Deterministic correlation: resolve the missed element.
  const trip = await deps.trips.getTrip(input.tripId);
  if (!trip) throw new Error(`unknown trip ${input.tripId}`);

  const missedElementId = input.elementId ?? resolveEarliestUpcomingFlight(trip, input.at);
  if (!missedElementId) {
    throw new Error(`no upcoming FLIGHT TRANSPORT_LEG found on trip ${input.tripId}`);
  }

  const missedElement = trip.elements.find((e) => e.id === missedElementId);
  if (!missedElement) throw new Error(`element ${missedElementId} not found on trip ${input.tripId}`);
  if (missedElement.elementKind !== 'TRANSPORT_LEG') {
    throw new Error(`element ${missedElementId} is not a TRANSPORT_LEG`);
  }
  if (missedElement.data.mode !== 'FLIGHT') {
    throw new Error(`element ${missedElementId} is not a FLIGHT`);
  }

  // 2. Mark the element CANCELLED: the traveller missed it, so it's effectively
  //    cancelled for them. This mutation happens BEFORE signal processing so the
  //    impact engine sees the failure and assesses blast radius.
  if (missedElement.reservationState !== 'CANCELLED') {
    const safeAt = input.at.replace(/[^A-Za-z0-9_\-:.]/g, '_');
    const mutationProposal: MutationProposal = {
      id: `prop-missed-flight-${missedElementId}-${safeAt}`,
      origin: 'HUMAN',
      actorRef: { entityType: 'TRAVELLER', id: trip.travellerIds[0]! },
      sourceId: 'src_traveller_report',
      requestedAt: input.at,
      rationale: `traveller missed flight ${missedElementId}: ${input.travellerReport}`,
      operations: [
        {
          op: 'UPSERT_ENTITY',
          entityType: 'TRIP_ELEMENT',
          id: missedElement.id,
          data: { ...missedElement, reservationState: 'CANCELLED' },
        },
      ],
    };
    const mutationOutcome = await deps.mutations.applyProposal(mutationProposal);
    if (!mutationOutcome.accepted) {
      throw new Error(
        `missed-flight mutation rejected: ${mutationOutcome.issues.map((i) => i.message).join('; ')}`,
      );
    }
  }

  // 3. Construct a generic TRAVELLER_INPUT signal with structured payload.
  const safeAt = input.at.replace(/[^A-Za-z0-9_\-:.]/g, '_');
  const signalId = `sig-missed-flight-${missedElementId}-${safeAt}`;
  const signal: TripSignal = {
    id: signalId,
    kind: 'TRAVELLER_INPUT',
    occurredAt: input.at,
    receivedAt: input.at,
    sourceId: 'src_traveller_report',
    authority: 'ASSERTED',
    confidence: 1,
    tripId: input.tripId,
    subjectRef: { entityType: 'TRIP_ELEMENT', id: missedElementId },
    // DR-8: read verbatim as "what changed" copy downstream (readmodels.ts)
    // — the element id stays in subjectRef/payload for machine correlation,
    // never in the human-facing summary text.
    summary: 'Traveller reported missing a scheduled flight',
    payload: {
      event: 'MISSED_FLIGHT',
      elementId: missedElementId,
      travellerReport: input.travellerReport,
    },
  };

  // 4. Run through the generic processDisruption flow. The impact engine sees
  //    the cancelled element and assesses blast radius through the SAME
  //    machinery supplier cancellations use.
  const processed = await deps.orchestrator.processDisruption(signal, input.at);

  return {
    signalId: signal.id,
    caseId: processed.caseId,
    caseStatus: processed.caseStatus,
    missedElementId,
    processed,
  };
}

function resolveEarliestUpcomingFlight(trip: Trip, at: IsoDateTime): EntityId | undefined {
  const flightLegs = trip.elements
    .filter((element): element is TransportLeg => {
      if (element.elementKind !== 'TRANSPORT_LEG') return false;
      return element.data.mode === 'FLIGHT';
    })
    .filter((element) => {
      const departure = element.data.scheduledDeparture?.value;
      if (!departure) return false;
      return compareInstants(departure, at) > 0;
    })
    .sort((a, b) => {
      const aDep = a.data.scheduledDeparture?.value ?? '';
      const bDep = b.data.scheduledDeparture?.value ?? '';
      return compareInstants(aDep, bDep);
    });

  return flightLegs[0]?.id;
}

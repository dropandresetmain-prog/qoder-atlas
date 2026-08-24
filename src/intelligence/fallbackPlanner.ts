/**
 * D3 fallback — deterministic, model-free RecoveryPlanner.
 *
 * When Model Studio credentials are absent (credential-free REPLAY demo),
 * recovery planning must still complete the loop honestly. This planner
 * derives strategies ONLY from PlannerInput evidence:
 *
 * - round 1: for a directly-failed FLIGHT leg it emits a single read-only
 *   flight.search tool request (route/date derived from snapshot state);
 * - round 2: once flight.search evidence is present in priorToolResults, it
 *   enumerates one replacement strategy per normalized offer, with CONNECTED
 *   facts at the snapshot instant. Feasibility, rejection and ranking stay
 *   entirely with the deterministic viability engine — this planner claims
 *   nothing.
 *
 * No scenario facts live here: the planner knows the frozen contracts, never
 * scenario content. Any disruption without a failed FLIGHT leg degrades to an
 * honest empty plan with a visible uncertainty.
 */
import type { EntityId, IsoDateTime, UncertaintyRecord } from '../domain/common.ts';
import type { FlightOffer } from '../contracts/capabilities.ts';
import type { PlannerInput, PlannerOutput, RecoveryPlanner } from '../contracts/planner.ts';
import type { TransportLeg } from '../domain/elements.ts';
import type { MutationOperation } from '../operational/mutation.ts';
import type { RecoveryStrategy, ToolRequest } from '../operational/strategy.ts';
import { newId } from '../util/ids.ts';

export interface FallbackPlannerOptions {
  /** Injectable for deterministic test identifiers. */
  idFactory?: (prefix: string) => string;
  /** Injectable clock; defaults to wall time (strategies carry createdAt only). */
  now?: () => IsoDateTime;
}

export class DeterministicFallbackPlanner implements RecoveryPlanner {
  private readonly idFactory: (prefix: string) => string;
  private readonly now: () => IsoDateTime;

  constructor(options: FallbackPlannerOptions = {}) {
    this.idFactory = options.idFactory ?? newId;
    this.now = options.now ?? ((): IsoDateTime => new Date().toISOString());
  }

  async plan(input: PlannerInput): Promise<PlannerOutput> {
    const failedLeg = this.failedFlightLeg(input);
    if (!failedLeg) {
      return this.degraded('no directly-failed flight leg identified in the impact assessment');
    }

    const searchEvidence = this.flightSearchEvidence(input);
    if (!searchEvidence) {
      const request = this.searchRequest(input, failedLeg);
      if (!request) {
        return this.degraded(
          `failed flight leg ${failedLeg.id} carries no route/date evidence for a replacement search`,
        );
      }
      return {
        strategies: [],
        toolRequests: [request],
        assumptions: [`replacement options for ${failedLeg.id} must be searched before strategies are proposed`],
        uncertainties: [
          this.uncertainty(
            'deterministic fallback planner active: awaiting flight.search evidence before proposing replacements',
            'MEDIUM',
          ),
        ],
        rationale: 'fallback planner requests replacement evidence before proposing any strategy',
      };
    }

    const offers = [...searchEvidence.offers].sort((a, b) => {
      const priceDiff = a.totalPrice.amount - b.totalPrice.amount;
      if (priceDiff !== 0) return priceDiff;
      return a.offerId < b.offerId ? -1 : a.offerId > b.offerId ? 1 : 0;
    });

    const strategies: RecoveryStrategy[] = [];
    for (const offer of offers) {
      strategies.push(this.replacementStrategy(input, failedLeg, offer));
    }

    return {
      strategies,
      toolRequests: [],
      assumptions: [
        `each strategy replaces ${failedLeg.id} with one normalized flight.search offer at CONNECTED authority`,
      ],
      uncertainties: [
        this.uncertainty(
          'deterministic fallback planner: strategies are enumerated from flight.search evidence; feasibility, rejection and ranking are decided solely by the deterministic viability engine',
          'MEDIUM',
        ),
      ],
      rationale: 'fallback planner enumerates replacement offers; the viability engine owns feasibility',
    };
  }

  /** The directly-failed FLIGHT transport leg, if any. */
  private failedFlightLeg(input: PlannerInput): TransportLeg | undefined {
    const failureIds = new Set<EntityId>(input.impact.directFailures.map((failure) => failure.elementId));
    return input.snapshot.trip.elements.find(
      (element): element is TransportLeg =>
        element.elementKind === 'TRANSPORT_LEG' &&
        element.data.mode === 'FLIGHT' &&
        failureIds.has(element.id),
    );
  }

  /** flight.search data from prior tool results (last successful one wins). */
  private flightSearchEvidence(input: PlannerInput): { offers: FlightOffer[] } | undefined {
    for (let index = input.priorToolResults.length - 1; index >= 0; index -= 1) {
      const result = input.priorToolResults[index];
      if (!result) continue;
      const offers = (result.data as Record<string, unknown>)['offers'];
      if (Array.isArray(offers) && offers.length > 0) {
        return { offers: offers as FlightOffer[] };
      }
    }
    return undefined;
  }

  /** flight.search parameters from snapshot state only (route + original date). */
  private searchRequest(input: PlannerInput, leg: TransportLeg): ToolRequest | undefined {
    const originPlace = input.snapshot.places.find((place) => place.id === leg.data.originPlaceId);
    const destinationPlace = input.snapshot.places.find((place) => place.id === leg.data.destinationPlaceId);
    const originRef = originPlace?.externalRefs[0];
    const destinationRef = destinationPlace?.externalRefs[0];
    const departureDate = leg.data.scheduledDeparture?.value.slice(0, 10);
    if (!originRef || !destinationRef || !departureDate) return undefined;
    return {
      id: this.idFactory('tool'),
      capability: 'FLIGHT',
      operation: 'flight.search',
      parameters: {
        origin: { system: originRef.system, value: originRef.value },
        destination: { system: destinationRef.system, value: destinationRef.value },
        departureDate,
        passengers: { adults: 1 },
      },
      purpose: `find replacement flights for the failed leg ${leg.id}`,
    };
  }

  /** One replacement strategy per normalized offer; facts stay CONNECTED. */
  private replacementStrategy(input: PlannerInput, leg: TransportLeg, offer: FlightOffer): RecoveryStrategy {
    const first = offer.segments[0];
    const last = offer.segments[offer.segments.length - 1];
    const fact = (value: IsoDateTime) => ({
      value,
      sourceId: input.triggeringSignals[0]?.sourceId ?? 'src:runtime-fallback',
      authority: 'CONNECTED' as const,
      observedAt: input.snapshot.takenAt,
    });
    const candidateOperations: MutationOperation[] = [
      {
        op: 'UPSERT_ENTITY',
        entityType: 'TRIP_ELEMENT',
        data: {
          ...leg,
          reservationState: 'HELD',
          status: 'UNKNOWN',
          data: {
            ...leg.data,
            ...(first ? { scheduledDeparture: fact(first.departure) } : {}),
            ...(last ? { scheduledArrival: fact(last.arrival) } : {}),
            bookingRef: { system: 'flight-provider', reference: offer.offerId },
          },
        },
      },
    ];
    return {
      id: this.idFactory('strat'),
      caseId: input.caseId,
      // DR-8: this summary is read verbatim as the user-facing option title
      // downstream (readmodels.ts) — describe the replacement in clean,
      // human terms (departure time-of-day) rather than element/offer ids.
      summary: first
        ? `Rebook onto a replacement departing at ${first.departure.slice(11, 16)}`
        : `Rebook onto a replacement flight`,
      candidateOperations,
      toolRequests: [],
      assumptions: ['the offer schedule is CONNECTED evidence until execution observation confirms it'],
      uncertainties: [],
      expectedOutcomes: ['the cancelled leg is replaced by a schedulable confirmed alternative'],
      costImpact: offer.totalPrice,
      createdAt: this.now(),
    };
  }

  private degraded(reason: string): PlannerOutput {
    return {
      strategies: [],
      toolRequests: [],
      assumptions: [],
      uncertainties: [this.uncertainty(`deterministic fallback planner produced no strategies: ${reason}`, 'HIGH')],
      rationale: 'fallback planner failed closed; no strategies fabricated',
    };
  }

  private uncertainty(statement: string, severity: UncertaintyRecord['severity']): UncertaintyRecord {
    return { id: this.idFactory('unc'), statement, aboutRefs: [], severity };
  }
}

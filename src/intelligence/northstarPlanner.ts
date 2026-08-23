/**
 * Northstar RV-N3/RV-N5 — planner branches for the resolution wave (NS-G2).
 *
 * The generalized recovery pipeline converges four paths (0: no valid trip,
 * A: traveller target change, B: provider disruption, C: event-side change)
 * through ONE architecture. The existing fallback/model planners cover
 * failed-leg recovery (paths B/C replanning). This class adds the two
 * branches that were previously unrepresentable, as a RecoveryPlanner
 * WRAPPER — everything else (snapshot, tool dispatch, viability, authority,
 * execution, observation) is the shared loop, never duplicated:
 *
 *  - initial planning (path 0): an engagement-only trip has no failed leg,
 *    so recovery planners fail closed. Here the target is derived from the
 *    anchor-event window + engagement evidence; the planner requests
 *    flight.search evidence for (home airport -> event airport) and, when
 *    evidence exists, proposes HELD arrival legs. Unknown origin/destination
 *    evidence fails closed with uncertainty — never a fabricated route.
 *  - window shift (path A): a ChangeRequest carries arriveBy/departAfter in
 *    its TRAVELLER_INPUT signal payload. The planner requests flight.search
 *    for the same route on the requested date and proposes replacing the
 *    affected leg — the same encoding recovery uses.
 *
 * Both branches emit proposals ONLY; deterministic viability, authority and
 * execution gates downstream decide what actually changes.
 */
import type { EntityId, IsoDateTime, UncertaintyRecord } from '../domain/common.ts';
import type { FlightOffer } from '../contracts/capabilities.ts';
import type { PlannerInput, PlannerOutput, RecoveryPlanner } from '../contracts/planner.ts';
import type { TripSignal } from '../operational/signal.ts';
import type { MutationOperation } from '../operational/mutation.ts';
import type { RecoveryStrategy, ToolRequest } from '../operational/strategy.ts';
import type { Engagement, TransportLeg } from '../domain/elements.ts';
import type { Place } from '../domain/entities.ts';

function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Deterministic local-date arithmetic: YYYY-MM-DD minus one day. */
function previousLocalDate(iso: IsoDateTime): string {
  const day = iso.slice(0, 10);
  const millis = Date.parse(`${day}T00:00:00.000Z`) - 86_400_000;
  return new Date(millis).toISOString().slice(0, 10);
}

/** A place that resolves to a provider-facing external ref (airport code...). */
function airportRefFor(place: Place | undefined): { system: string; value: string } | undefined {
  return place?.externalRefs.find((ref) => ref.system === 'airport-code' && ref.value.length > 0);
}

export interface NorthstarPlannerOptions {
  idFactory?: (prefix: string) => string;
  now?: () => IsoDateTime;
}

export class NorthstarPlanner implements RecoveryPlanner {
  private readonly inner: RecoveryPlanner;
  private readonly idFactory: (prefix: string) => string;
  private readonly now: () => IsoDateTime;

  constructor(inner: RecoveryPlanner, options: NorthstarPlannerOptions = {}) {
    this.inner = inner;
    this.idFactory = options.idFactory ?? newId;
    this.now = options.now ?? ((): IsoDateTime => new Date().toISOString());
  }

  async plan(input: PlannerInput): Promise<PlannerOutput> {
    const initial = this.initialPlanningOutput(input);
    if (initial) return initial;
    const shifted = this.windowShiftOutput(input);
    if (shifted) return shifted;
    return this.inner.plan(input);
  }

  // -------------------------------------------------------------------------
  // Path 0 — engagement-only trip -> arrival strategies
  // -------------------------------------------------------------------------

  private initialPlanningOutput(input: PlannerInput): PlannerOutput | undefined {
    const elements = input.snapshot.trip.elements;
    const hasEngagement = elements.some((element) => element.elementKind === 'ENGAGEMENT');
    const hasBookedKind = elements.some(
      (element) => element.elementKind === 'TRANSPORT_LEG' || element.elementKind === 'STAY',
    );
    if (!hasEngagement || hasBookedKind) return undefined;

    const engagements = elements
      .filter((element): element is Engagement => element.elementKind === 'ENGAGEMENT')
      .sort((a, b) => a.data.startsAt.value.localeCompare(b.data.startsAt.value));
    const engagement = engagements[0];
    if (!engagement) return this.degraded('no engagement evidence to derive an arrival target from');

    // Destination airport: the event venue's airport ref (snapshot places),
    // falling back to the engagement place. Venue-kind places are linked to
    // their nearest airport through authoritative Place evidence only.
    const eventPlaceId = input.snapshot.anchorEvent?.placeId ?? engagement.data.placeId;
    const destinationPlace = this.placeById(input, eventPlaceId);
    const destinationRef = airportRefFor(destinationPlace);
    if (!destinationPlace || !destinationRef) {
      return this.degraded('no event airport evidence: the anchor-event place carries no airport-code ref');
    }

    // Origin airport: explicit traveller home-place airport ref. Missing
    // home evidence is never guessed.
    const origin = this.travellerHomeAirport(input);
    if (!origin) {
      return this.degraded(
        'initial planning requires explicit home-airport evidence on the traveller; missing facts stay missing',
      );
    }

    const windowStart = input.snapshot.anchorEvent?.window.startsAt;
    if (!windowStart) return this.degraded('anchor event carries no window evidence for an arrival target');
    // Deterministic arrival-date assumption: the day before the event window
    // opens. Recorded as an assumption — a planning heuristic, not a
    // fabricated provider fact.
    const departureDate = previousLocalDate(windowStart);

    const evidence = this.flightSearchEvidence(input);
    if (!evidence) {
      return {
        strategies: [],
        toolRequests: [this.searchRequest(origin.ref, destinationRef, departureDate, origin.placeId, destinationPlace.id)],
        assumptions: [
          `arrival search targets the day before the event window opens (${departureDate})`,
          'no arrival strategy is proposed before flight.search evidence exists',
        ],
        uncertainties: [
          this.uncertainty(
            'initial planning active: arrival options must be searched before any strategy is proposed',
            'MEDIUM',
          ),
        ],
        rationale: 'northstar initial-planning planner requests arrival evidence before proposing legs',
      };
    }

    const sourceId = input.triggeringSignals[0]?.sourceId ?? 'src:northstar-initial';
    const strategies = [...evidence.offers]
      .sort((a, b) => a.totalPrice.amount - b.totalPrice.amount || a.offerId.localeCompare(b.offerId))
      .map((offer) => this.arrivalStrategy(input, origin.placeId, destinationPlace.id, offer, sourceId));
    return {
      strategies,
      toolRequests: [],
      assumptions: [
        'each strategy adds one HELD arrival leg from normalized flight.search evidence at CONNECTED authority',
        'the viability engine — not this planner — decides feasibility',
      ],
      uncertainties: [],
      rationale: 'northstar initial-planning planner enumerates arrival offers; viability owns feasibility',
    };
  }

  /**
   * Home-airport evidence for the trip's first traveller. The traveller
   * record never fabricates a home; only an explicit homePlaceId with an
   * airport-code ref counts.
   */
  private travellerHomeAirport(input: PlannerInput): { placeId: EntityId; ref: { system: string; value: string } } | undefined {
    const traveller = input.snapshot.travellers[0];
    if (!traveller?.homePlaceId) return undefined;
    const home = this.placeById(input, traveller.homePlaceId);
    const ref = airportRefFor(home);
    if (!home || !ref) return undefined;
    return { placeId: home.id, ref };
  }

  private arrivalStrategy(
    input: PlannerInput,
    originPlaceId: EntityId,
    destinationPlaceId: EntityId,
    offer: FlightOffer,
    sourceId: string,
  ): RecoveryStrategy {
    const first = offer.segments[0];
    const last = offer.segments[offer.segments.length - 1];
    const fact = (value: IsoDateTime) => ({
      value,
      sourceId,
      authority: 'CONNECTED' as const,
      observedAt: input.snapshot.takenAt,
    });
    // Shared arrival slot: the promotion-time arrival constraint references
    // this trip-known element id (REV-2 WP-R2), so every offer fills the SAME
    // slot and the viability engine can judge it. The chosen offer stays
    // identifiable via bookingRef.
    const elementId = `el-${input.snapshot.tripId}-arrival`;
    const candidateOperations: MutationOperation[] = [
      {
        op: 'UPSERT_ENTITY',
        entityType: 'TRIP_ELEMENT',
        data: {
          id: elementId,
          tripId: input.snapshot.tripId,
          elementKind: 'TRANSPORT_LEG',
          importance: 'PREFERRED',
          flexibility: 'FIXED',
          reservationState: 'HELD',
          status: 'UNKNOWN',
          dependsOn: [],
          governedByRuleSetIds: [],
          data: {
            mode: 'FLIGHT',
            originPlaceId,
            destinationPlaceId,
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
      summary: `Book arrival on offer ${offer.offerId}`,
      candidateOperations,
      toolRequests: [],
      assumptions: ['the offer schedule is CONNECTED evidence until execution observation confirms it'],
      uncertainties: [],
      expectedOutcomes: ['the programme traveller gains a schedulable arrival before the anchor event window'],
      costImpact: offer.totalPrice,
      createdAt: this.now(),
    };
  }

  // -------------------------------------------------------------------------
  // Path A — ChangeRequest window shift -> replacement strategies
  // -------------------------------------------------------------------------

  private windowShiftOutput(input: PlannerInput): PlannerOutput | undefined {
    const trigger = this.windowShiftTrigger(input.triggeringSignals);
    if (!trigger) return undefined;

    const leg = input.snapshot.trip.elements.find(
      (element): element is TransportLeg =>
        element.elementKind === 'TRANSPORT_LEG' && element.data.mode === 'FLIGHT',
    );
    if (!leg) {
      return this.degraded('window-shift change request requires an existing flight leg to re-search');
    }
    const originPlace = this.placeById(input, leg.data.originPlaceId);
    const destinationPlace = this.placeById(input, leg.data.destinationPlaceId);
    const originRef = airportRefFor(originPlace);
    const destinationRef = airportRefFor(destinationPlace);
    if (!originRef || !destinationRef) {
      return this.degraded('flight leg places carry no airport-code refs; cannot re-search');
    }
    const requestedDate = trigger.date;

    const evidence = this.flightSearchEvidence(input);
    if (!evidence) {
      return {
        strategies: [],
        toolRequests: [
          this.searchRequest(originRef, destinationRef, requestedDate, leg.data.originPlaceId, leg.data.destinationPlaceId),
        ],
        assumptions: [`window shift requested for ${requestedDate}; replacement evidence required first`],
        uncertainties: [this.uncertainty('change-request resolution active: awaiting flight.search evidence', 'MEDIUM')],
        rationale: 'northstar window-shift planner requests replacement evidence before proposing',
      };
    }

    const sourceId = input.triggeringSignals[0]?.sourceId ?? 'src:northstar-change';
    const fact = (value: IsoDateTime) => ({
      value,
      sourceId,
      authority: 'CONNECTED' as const,
      observedAt: input.snapshot.takenAt,
    });
    const strategies = [...evidence.offers]
      .sort((a, b) => a.totalPrice.amount - b.totalPrice.amount || a.offerId.localeCompare(b.offerId))
      .map((offer): RecoveryStrategy => {
        const first = offer.segments[0];
        const last = offer.segments[offer.segments.length - 1];
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
          summary: `Rebook ${leg.id} on offer ${offer.offerId} (${trigger.kind})`,
          candidateOperations,
          toolRequests: [],
          assumptions: ['the offer schedule is CONNECTED evidence until execution observation confirms it'],
          uncertainties: [],
          expectedOutcomes: [`the trip window satisfies the traveller request (${trigger.kind} ${requestedDate})`],
          costImpact: offer.totalPrice,
          createdAt: this.now(),
        };
      });
    return {
      strategies,
      toolRequests: [],
      assumptions: ['window-shift strategies are enumerated from flight.search evidence; viability owns feasibility'],
      uncertainties: [],
      rationale: 'northstar window-shift planner enumerates replacement offers; viability owns feasibility',
    };
  }

  /** Extracts arriveBy/departAfter evidence from TRAVELLER_INPUT payloads. */
  private windowShiftTrigger(
    signals: TripSignal[],
  ): { kind: 'arriveBy' | 'departAfter'; date: string } | undefined {
    for (let index = signals.length - 1; index >= 0; index -= 1) {
      const signal = signals[index];
      if (!signal || signal.kind !== 'TRAVELLER_INPUT') continue;
      const payload = signal.payload as Record<string, unknown>;
      if (payload['changeRequestId'] === undefined) continue;
      const arriveBy = payload['arriveBy'];
      if (typeof arriveBy === 'string' && arriveBy.length >= 10) {
        return { kind: 'arriveBy', date: arriveBy.slice(0, 10) };
      }
      const departAfter = payload['departAfter'];
      if (typeof departAfter === 'string' && departAfter.length >= 10) {
        return { kind: 'departAfter', date: departAfter.slice(0, 10) };
      }
    }
    return undefined;
  }

  // -------------------------------------------------------------------------
  // Shared helpers
  // -------------------------------------------------------------------------

  /** Snapshot places are the only place evidence this planner consumes. */
  private placeById(input: PlannerInput, placeId: EntityId | undefined): Place | undefined {
    if (!placeId) return undefined;
    return input.snapshot.places.find((place) => place.id === placeId);
  }

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

  private searchRequest(
    originRef: { system: string; value: string },
    destinationRef: { system: string; value: string },
    departureDate: string,
    originPlaceId: EntityId,
    destinationPlaceId: EntityId,
  ): ToolRequest {
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
      purpose: `find flights for ${originPlaceId} -> ${destinationPlaceId} on ${departureDate}`,
    };
  }

  private degraded(reason: string): PlannerOutput {
    return {
      strategies: [],
      toolRequests: [],
      assumptions: [],
      uncertainties: [this.uncertainty(`northstar planner produced no strategies: ${reason}`, 'HIGH')],
      rationale: 'northstar planner failed closed; no strategies fabricated',
    };
  }

  private uncertainty(statement: string, severity: UncertaintyRecord['severity']): UncertaintyRecord {
    return { id: this.idFactory('unc'), statement, aboutRefs: [], severity };
  }
}

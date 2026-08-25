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
 *  - window shift (path A): a ChangeRequest carries the COMPLETE declarative
 *    ResolutionTarget in its TRAVELLER_INPUT signal payload (REV-2 WP-R3).
 *    The planner selects the affected leg BY DIRECTION from place evidence
 *    (arriveBy -> the leg arriving at the event place; departAfter -> the leg
 *    departing it — never array order), emits one flight.search per
 *    requested window dimension, and proposes replacing each dimension's leg
 *    once evidence exists. Dimensions the planner cannot act on (direct
 *    preference, departure bounds, stay proximity, objective effects) fail
 *    closed with explicit uncertainty — silent dropping is the defect.
 *
 * Both branches emit proposals ONLY; deterministic viability, authority and
 * execution gates downstream decide what actually changes.
 */
import type { EntityId, IsoDateTime, UncertaintyRecord } from '../domain/common.ts';
import { ResolutionTargetSchema, type ResolutionTarget } from '../contracts/changeRequest.ts';
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

/**
 * Deterministic id factory (REV-2 WP-R5): a per-prefix sequence. Given the
 * same input sequence the same ids come out, which keeps persisted case
 * state REPLAY-reproducible. Math.random() ids broke that (ADR-029).
 */
export function deterministicIdFactory(): (prefix: string) => string {
  const counters = new Map<string, number>();
  return (prefix: string): string => {
    const next = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, next);
    return `${prefix}-${String(next).padStart(4, '0')}`;
  };
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

/** A parsed change-request trigger: the full declarative target plus
 * explicit uncertainty statements for every dimension this planner cannot
 * act on. Failing closed with stated uncertainty replaces silent dropping. */
interface WindowShiftTrigger {
  target: ResolutionTarget;
  actionable: boolean;
  uncertaintyStatements: string[];
}

type WindowDimension = 'arriveBy' | 'departAfter';

export class NorthstarPlanner implements RecoveryPlanner {
  private readonly inner: RecoveryPlanner;
  private readonly idFactory: (prefix: string) => string;
  private readonly nowOverride: (() => IsoDateTime) | undefined;

  constructor(inner: RecoveryPlanner, options: NorthstarPlannerOptions = {}) {
    this.inner = inner;
    this.idFactory = options.idFactory ?? newId;
    // No wall-clock default (ADR-029, REV-2 WP-R5): without an explicit
    // override, strategy timestamps derive from the snapshot instant — the
    // evaluation 'at' — so REPLAY runs reproduce identical persisted state.
    this.nowOverride = options.now;
  }

  /** Strategy timestamps: explicit override, else the snapshot instant. */
  private instant(input: PlannerInput): IsoDateTime {
    return this.nowOverride ? this.nowOverride() : input.snapshot.takenAt;
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
    // their nearest airport through authoritative Place evidence only —
    // either the place's own airport-code ref or the generic servedBy
    // transport-gateway association (fix C).
    const eventPlaceId = input.snapshot.anchorEvent?.placeId ?? engagement.data.placeId;
    const destinationGateway = this.airportGatewayFor(input, eventPlaceId);
    if (!destinationGateway) {
      return this.degraded('no event airport evidence: the anchor-event place carries no airport-code ref and declares no serving transport gateway');
    }
    const destinationPlace = this.placeById(input, destinationGateway.placeId);
    if (!destinationPlace) {
      return this.degraded('no event airport evidence: the serving gateway place is not present in snapshot places');
    }
    const destinationRef = destinationGateway.ref;

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
      // DR-8: read verbatim as the user-facing option title downstream
      // (readmodels.ts) — no raw offer/element ids in it.
      summary: first
        ? `Book an arrival flight departing at ${first.departure.slice(11, 16)}`
        : 'Book an arrival flight',
      candidateOperations,
      toolRequests: [],
      assumptions: ['the offer schedule is CONNECTED evidence until execution observation confirms it'],
      uncertainties: [],
      expectedOutcomes: ['the programme traveller gains a schedulable arrival before the anchor event window'],
      costImpact: offer.totalPrice,
      createdAt: this.instant(input),
    };
  }

  // -------------------------------------------------------------------------
  // Path A — ChangeRequest window shift -> replacement strategies
  // -------------------------------------------------------------------------

  private windowShiftOutput(input: PlannerInput): PlannerOutput | undefined {
    const trigger = this.windowShiftTrigger(input.triggeringSignals);
    if (!trigger) return undefined;
    const { target } = trigger;
    const uncertainties = trigger.uncertaintyStatements.map((statement) => this.uncertainty(statement, 'MEDIUM'));

    // A target with no actionable window dimension still owns the planning
    // turn: return the recorded uncertainties instead of falling through to
    // the inner planner (which silently ignored A2/A3 requests).
    if (!trigger.actionable) {
      return {
        strategies: [],
        toolRequests: [],
        assumptions: [],
        uncertainties: [
          this.uncertainty(
            'change request carries no window dimension this planner can act on; unsupported dimensions are recorded, never silently dropped',
            'HIGH',
          ),
          ...uncertainties,
        ],
        rationale: 'northstar window-shift planner failed closed on unactionable target dimensions',
      };
    }

    const dimensions: WindowDimension[] = [
      ...(target.arriveBy !== undefined ? (['arriveBy'] as const) : []),
      ...(target.departAfter !== undefined ? (['departAfter'] as const) : []),
    ];
    const eventPlaceId =
      input.snapshot.anchorEvent?.placeId ??
      input.snapshot.trip.elements.find(
        (element): element is Engagement => element.elementKind === 'ENGAGEMENT',
      )?.data.placeId;
    const flightLegs = input.snapshot.trip.elements.filter(
      (element): element is TransportLeg =>
        element.elementKind === 'TRANSPORT_LEG' && element.data.mode === 'FLIGHT',
    );

    // Direction comes from PLACE evidence, never array order: arriveBy
    // targets the leg arriving AT the event place; departAfter the leg
    // departing FROM it. Matching is gateway-aware (fix C): a leg endpoint
    // and the event place compare by their RESOLVED transport gateway, so a
    // venue whose gateway is a separate airport place still matches legs
    // ending at that airport. When an itinerary leg matches, it outranks the
    // shared arrival slot (promotion-time constraint subject, REV-2 WP-R2);
    // the slot stays rebookable only when it IS the trip's only flight leg.
    const eventGatewayId = eventPlaceId ? this.airportGatewayFor(input, eventPlaceId)?.placeId : undefined;
    const legFor = (dimension: WindowDimension): TransportLeg | undefined => {
      if (!eventGatewayId) return undefined;
      const matches = flightLegs.filter((element) => {
        const endpointPlaceId =
          dimension === 'arriveBy' ? element.data.destinationPlaceId : element.data.originPlaceId;
        return this.airportGatewayFor(input, endpointPlaceId)?.placeId === eventGatewayId;
      });
      if (matches.length === 0) return undefined;
      const itinerary = matches.filter((element) => element.id !== `el-${input.snapshot.tripId}-arrival`);
      return itinerary[0] ?? matches[0];
    };

    // One search per requested dimension. A dimension with an existing leg
    // re-searches that leg's route; one without a leg falls back to the
    // home/event corridor when both ends carry airport evidence. Each
    // request carries a deterministic dimension-scoped id so round-2
    // evidence matching never confuses one dimension's offers with
    // another's (a two-dimension change proposes each dimension's leg from
    // ITS OWN search result).
    const toolRequests: ToolRequest[] = [];
    const selected: Array<{ dimension: WindowDimension; leg: TransportLeg; toolRequestId: string }> = [];
    for (const dimension of dimensions) {
      const requested = dimension === 'arriveBy' ? target.arriveBy : target.departAfter;
      const requestedDate = requested?.slice(0, 10);
      if (!requested || !requestedDate) continue;
      const leg = legFor(dimension);
      if (leg) {
        // Gateway-aware endpoint resolution (fix C): a leg endpoint without
        // its own airport ref may resolve through its servedBy transport
        // gateway; the gateway place becomes the search endpoint.
        const originGateway = this.airportGatewayFor(input, leg.data.originPlaceId);
        const destinationGateway = this.airportGatewayFor(input, leg.data.destinationPlaceId);
        if (!originGateway || !destinationGateway) {
          uncertainties.push(
            this.uncertainty(
              `${dimension} leg ${leg.id} places carry no airport-code refs (and no serving gateway resolves one); cannot re-search that leg`,
              'MEDIUM',
            ),
          );
          continue;
        }
        const toolRequestId = `tool-ws-${dimension}`;
        toolRequests.push(
          this.searchRequest(originGateway.ref, destinationGateway.ref, requestedDate, originGateway.placeId, destinationGateway.placeId, toolRequestId),
        );
        selected.push({ dimension, leg, toolRequestId });
        continue;
      }
      const corridor = this.windowCorridor(input, dimension, eventPlaceId);
      if (!corridor) {
        uncertainties.push(
          this.uncertainty(
            `${dimension} requested but no flight leg ${dimension === 'arriveBy' ? 'arrives at' : 'departs from'} the event place and no home/event corridor evidence exists; cannot derive a route`,
            'MEDIUM',
          ),
        );
        continue;
      }
      toolRequests.push(
        this.searchRequest(corridor.originRef, corridor.destinationRef, requestedDate, corridor.originPlaceId, corridor.destinationPlaceId),
      );
    }
    if (selected.length === 0) {
      return {
        strategies: [],
        toolRequests,
        assumptions: [],
        uncertainties,
        rationale: 'northstar window-shift planner found no rebookable leg; evidence requests and uncertainty only',
      };
    }

    // Per-dimension evidence: each dimension's strategies come from ITS OWN
    // search result (matched by the dimension-scoped tool request id). A
    // dimension whose search produced no offers is recorded as uncertainty —
    // never re-coloured with another dimension's offers. Legacy callers that
    // injected unscoped evidence fall back to the last global flight.search
    // result (single-dimension requests keep working unchanged).
    const evidenceForDimension = (toolRequestId: string): { offers: FlightOffer[] } | undefined => {
      for (let index = input.priorToolResults.length - 1; index >= 0; index -= 1) {
        const result = input.priorToolResults[index];
        if (!result || result.toolRequestId !== toolRequestId) continue;
        const offers = (result.data as Record<string, unknown>)['offers'];
        if (Array.isArray(offers) && offers.length > 0) return { offers: offers as FlightOffer[] };
        // A scoped result EXISTS for this dimension but carries no offers
        // (failed search): another dimension's evidence must never colour
        // this one — the honest outcome is uncertainty, recorded below.
        return undefined;
      }
      // No scoped result at all (legacy unscoped injection): fall back to
      // the last global flight.search evidence.
      return this.flightSearchEvidence(input);
    };
    const scopedEvidence = selected.map((entry) => ({ ...entry, evidence: evidenceForDimension(entry.toolRequestId) }));
    if (!scopedEvidence.some((entry) => entry.evidence)) {
      return {
        strategies: [],
        toolRequests,
        assumptions: [
          `window shift requested (${dimensions.join(', ')}); replacement evidence required first`,
        ],
        uncertainties: [
          this.uncertainty('change-request resolution active: awaiting flight.search evidence', 'MEDIUM'),
          ...uncertainties,
        ],
        rationale: 'northstar window-shift planner requests replacement evidence before proposing',
      };
    }
    for (const entry of scopedEvidence) {
      if (!entry.evidence) {
        uncertainties.push(
          this.uncertainty(
            `${entry.dimension}: no flight.search evidence was recorded for this dimension; no strategy fabricated for it`,
            'MEDIUM',
          ),
        );
      }
    }

    const sourceId = input.triggeringSignals[0]?.sourceId ?? 'src:northstar-change';
    const fact = (value: IsoDateTime) => ({
      value,
      sourceId,
      authority: 'CONNECTED' as const,
      observedAt: input.snapshot.takenAt,
    });
    const strategies: RecoveryStrategy[] = scopedEvidence
      .flatMap(({ dimension, leg, evidence }) =>
        evidence
          ? [...evidence.offers]
              .sort((a, b) => a.totalPrice.amount - b.totalPrice.amount || a.offerId.localeCompare(b.offerId))
              .map((offer): RecoveryStrategy => {
                const first = offer.segments[0];
                const last = offer.segments[offer.segments.length - 1];
                const windowEvidence = dimension === 'arriveBy' ? target.arriveBy : target.departAfter;
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
                // DR-8: read verbatim as the user-facing option title
                // downstream (readmodels.ts) — no raw leg/offer ids in it.
                const windowPhrase = dimension === 'arriveBy' ? 'arrive earlier' : 'depart later';
                return {
                  id: this.idFactory('strat'),
                  caseId: input.caseId,
                  summary: first
                    ? `Rebook to ${windowPhrase}, departing at ${first.departure.slice(11, 16)}`
                    : `Rebook to ${windowPhrase}`,
                  candidateOperations,
                  toolRequests: [],
                  assumptions: ['the offer schedule is CONNECTED evidence until execution observation confirms it'],
                  uncertainties: [],
                  expectedOutcomes: [`the trip window satisfies the traveller request (${dimension} ${windowEvidence})`],
                  costImpact: offer.totalPrice,
                  createdAt: this.instant(input),
                };
              })
          : [],
      );
    return {
      strategies,
      toolRequests,
      assumptions: ['window-shift strategies are enumerated from flight.search evidence; viability owns feasibility'],
      uncertainties,
      rationale: 'northstar window-shift planner enumerates replacement offers; viability owns feasibility',
    };
  }

  /**
   * Route evidence for a window dimension that has no existing leg:
   * arriveBy searches home -> event place; departAfter searches event
   * place -> home. Both ends need airport-code evidence; absence fails
   * closed upstream.
   */
  private windowCorridor(
    input: PlannerInput,
    dimension: WindowDimension,
    eventPlaceId: EntityId | undefined,
  ): { originRef: { system: string; value: string }; destinationRef: { system: string; value: string }; originPlaceId: EntityId; destinationPlaceId: EntityId } | undefined {
    if (!eventPlaceId) return undefined;
    // Gateway-aware (fix C): the event side resolves through the place's own
    // airport ref or its servedBy transport gateway; the gateway place is the
    // corridor endpoint.
    const eventGateway = this.airportGatewayFor(input, eventPlaceId);
    const home = this.travellerHomeAirport(input);
    if (!eventGateway || !home) return undefined;
    return dimension === 'arriveBy'
      ? { originRef: home.ref, destinationRef: eventGateway.ref, originPlaceId: home.placeId, destinationPlaceId: eventGateway.placeId }
      : { originRef: eventGateway.ref, destinationRef: home.ref, originPlaceId: eventGateway.placeId, destinationPlaceId: home.placeId };
  }

  /**
   * Extracts the COMPLETE ResolutionTarget from TRAVELLER_INPUT payloads.
   * Every dimension the window-shift planner cannot act on is captured as an
   * explicit uncertainty statement: silent dropping is the defect this
   * trigger exists to prevent (REV-2 WP-R3).
   */
  private windowShiftTrigger(signals: TripSignal[]): WindowShiftTrigger | undefined {
    for (let index = signals.length - 1; index >= 0; index -= 1) {
      const signal = signals[index];
      if (!signal || signal.kind !== 'TRAVELLER_INPUT') continue;
      const payload = signal.payload as Record<string, unknown>;
      if (payload['changeRequestId'] === undefined) continue;

      let target: ResolutionTarget | undefined;
      const parsed = ResolutionTargetSchema.safeParse(payload['target']);
      if (parsed.success) {
        target = parsed.data;
      } else {
        // Legacy payloads carried only the two window fields; keep reading
        // them so persisted signals stay interpretable.
        const arriveBy = payload['arriveBy'];
        const departAfter = payload['departAfter'];
        if (typeof arriveBy === 'string' || typeof departAfter === 'string') {
          target = {
            objectiveEffects: [],
            ...(typeof arriveBy === 'string' ? { arriveBy } : {}),
            ...(typeof departAfter === 'string' ? { departAfter } : {}),
          };
        }
      }
      if (!target) continue;

      const uncertaintyStatements: string[] = [];
      if (target.transport?.preferDirect) {
        uncertaintyStatements.push(
          'transport.preferDirect requested: direct-flight ranking is not supported by this planner yet; the preference is recorded, not silently dropped',
        );
      }
      if (target.transport?.earliestDeparture !== undefined || target.transport?.latestDeparture !== undefined) {
        uncertaintyStatements.push(
          'transport departure bounds requested: earliest/latest departure filtering is not supported by this planner yet; the bounds are recorded, not silently dropped',
        );
      }
      if (target.preferredStayProximityRef) {
        uncertaintyStatements.push(
          'stay proximity requested: no hotel search capability is composed yet; the proximity preference is recorded, not silently dropped',
        );
      }
      for (const effect of target.objectiveEffects) {
        uncertaintyStatements.push(
          `objective effect requested for ${effect.objectiveId} (${effect.effect}): objective waivers are authority-gated state changes, never planner-authored; the request is recorded for the authority stage`,
        );
      }
      return {
        target,
        actionable: target.arriveBy !== undefined || target.departAfter !== undefined,
        uncertaintyStatements,
      };
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

  /**
   * G3R-Closure fix C — gateway-aware airport resolution, fully generic.
   * A place resolves to an airport code through its OWN externalRefs, or —
   * when it carries none — through the generic `servedByPlaceIds`
   * association (Place -> servedBy -> transport gateway). The returned
   * placeId is the place that actually bears the airport code: a venue with
   * no own ref resolves to its serving gateway, so search endpoints and
   * leg endpoints stay honest about which place is the airport. Fail-closed
   * discipline is unchanged: no own ref and no gateway association (or none
   * of them carrying a ref) resolves to undefined — never guessed. The depth
   * bound guards against association cycles without any scenario knowledge.
   */
  private airportGatewayFor(
    input: PlannerInput,
    placeId: EntityId | undefined,
    depth = 0,
  ): { placeId: EntityId; ref: { system: string; value: string } } | undefined {
    if (!placeId || depth > 1) return undefined;
    const place = this.placeById(input, placeId);
    if (!place) return undefined;
    const direct = airportRefFor(place);
    if (direct) return { placeId: place.id, ref: direct };
    for (const gatewayId of place.servedByPlaceIds ?? []) {
      const gateway = this.airportGatewayFor(input, gatewayId, depth + 1);
      if (gateway) return gateway;
    }
    return undefined;
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
    id?: string,
  ): ToolRequest {
    return {
      id: id ?? this.idFactory('tool'),
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

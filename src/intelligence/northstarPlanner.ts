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
import type { Engagement, Stay, TransportLeg } from '../domain/elements.ts';
import { STAY_RATE_BOOKING_REF_SYSTEM as HOTEL_RATE_REF_SYSTEM } from '../domain/elements.ts';
import type { Place } from '../domain/entities.ts';
import type { HotelPropertyView, HotelRateView } from '../contracts/capabilities.ts';
import { hotelSearchGuestsFromOccupancy } from '../app/dispatch.ts';
import { formatMoney } from '../ui/html.ts';

/** Presentation bound: cheapest rate per distinct property, capped. */
const MAX_HOTEL_STRATEGIES = 3;

/** Normalized hotel.search evidence the stay-replacement planner consumes. */
interface HotelSearchEvidence {
  properties: HotelPropertyView[];
  rates: HotelRateView[];
}

/** Structural guards: only well-formed provider views become candidates. */
function isHotelPropertyView(value: unknown): value is HotelPropertyView {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record['propertyId'] === 'string' && record['propertyId'].length > 0;
}

function isHotelRateView(value: unknown): value is HotelRateView {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const price = record['totalPrice'] as Record<string, unknown> | undefined;
  return (
    typeof record['rateId'] === 'string' &&
    record['rateId'].length > 0 &&
    typeof record['propertyId'] === 'string' &&
    record['propertyId'].length > 0 &&
    price !== undefined &&
    typeof price === 'object' &&
    typeof price['amount'] === 'number' &&
    typeof price['currency'] === 'string'
  );
}

/**
 * Deterministic place id for a search-derived property: derived purely from
 * the property's provider externalRef — no scenario or name knowledge.
 */
function derivedPlaceIdFor(property: HotelPropertyView): EntityId {
  const primary = property.externalRefs?.[0];
  return `place-hotel-${primary ? `${primary.system}-${primary.value}` : property.propertyId}`.replace(
    /[^A-Za-z0-9_.:-]/g,
    '-',
  );
}

function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Human-readable airport chain from normalized offer segments (no guessing). */
function formatOfferRoute(offer: FlightOffer): string {
  if (offer.segments.length === 0) return 'unknown route';
  const codes: string[] = [];
  for (const segment of offer.segments) {
    const origin = segment.origin.value;
    const destination = segment.destination.value;
    if (codes.length === 0) codes.push(origin);
    codes.push(destination);
  }
  return codes.join('→');
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

type WindowDimension = 'arriveBy' | 'departAfter' | 'departureOrigin';

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
    // A change-request window target owns the planning turn: initial arrival
    // planning only speaks for engagement-only trips that carry NO traveller
    // change request (otherwise the window-shift branch must judge it).
    if (this.windowShiftTrigger(input.triggeringSignals)) return undefined;
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
      ...(target.departureOrigin !== undefined ? (['departureOrigin'] as const) : []),
    ];
    const hasStayDimensions =
      target.stayCheckOut !== undefined ||
      target.stayPlaceRef !== undefined ||
      target.preferredStayPlaceId !== undefined ||
      target.guests !== undefined;
    if (dimensions.length === 0 && hasStayDimensions) {
      // Stay-only target owns the whole turn.
      return this.stayChangeOutput(input, target, uncertainties);
    }
    // Mixed targets (stay + window dimensions) run BOTH evidence tracks: the
    // flight path below proposes leg replacements, the stay track proposes
    // replacement/extension stays. Each strategy stays one coherent
    // provider-executable option — they are alternatives ranked together,
    // never a silently half-executed combined mutation.
    const stayTrack = hasStayDimensions ? this.stayChangeOutput(input, target, []) : undefined;

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
    const selected: Array<{
      dimension: WindowDimension;
      /** Absent when the dimension has no existing leg and the strategy adds a shared slot leg instead. */
      leg?: TransportLeg;
      toolRequestId: string;
      /** departureOrigin: the declared gateway place replaces the leg's origin. */
      substitutedOriginPlaceId?: EntityId;
      /** No-leg corridor endpoints (arriveBy: home -> event; departAfter: event -> home). */
      corridorOriginPlaceId?: EntityId;
      corridorDestinationPlaceId?: EntityId;
    }> = [];
    for (const dimension of dimensions) {
      // Origin substitution (fix D/S7): the traveller declared a different
      // departure gateway. Re-search the arrival corridor FROM the declared
      // gateway on the leg's own departure date; the resolved gateway place
      // replaces the leg's origin in the proposed strategy. The declared ref
      // must resolve against programme Place evidence — an unresolvable
      // value stays uncertainty, never a guessed route.
      if (dimension === 'departureOrigin') {
        const declared = target.departureOrigin;
        if (!declared) continue;
        const declaredGateway = this.placeByExternalRef(input, declared);
        if (!declaredGateway) {
          uncertainties.push(
            this.uncertainty(
              `departureOrigin ${declared.system}:${declared.value} resolves to no known place in programme evidence; no route fabricated from it`,
              'MEDIUM',
            ),
          );
          continue;
        }
        const arrivalLeg = legFor('arriveBy');
        const destinationGateway = this.airportGatewayFor(
          input,
          arrivalLeg ? arrivalLeg.data.destinationPlaceId : eventPlaceId,
        );
        if (!destinationGateway) {
          uncertainties.push(
            this.uncertainty(
              'departureOrigin requested but no event gateway evidence exists; cannot derive the replacement corridor',
              'MEDIUM',
            ),
          );
          continue;
        }
        // Return-corridor honesty: substituting the departure origin does not
        // invent a new return terminus. An existing return that still lands at
        // the superseded home origin (or an explicitly preserved destination)
        // is PRESERVED. Only a return that neither matches the old home nor a
        // declared preserveReturnDestination stays an explicit uncertainty —
        // never silently rebooked on assumption.
        const supersededOriginPlaceId = arrivalLeg
          ? this.airportGatewayFor(input, arrivalLeg.data.originPlaceId)?.placeId
          : undefined;
        const preservedReturnRef = target.preserveReturnDestination;
        for (const candidate of flightLegs) {
          if (arrivalLeg && candidate.id === arrivalLeg.id) continue;
          if (this.airportGatewayFor(input, candidate.data.originPlaceId)?.placeId !== eventGatewayId) continue;
          const returnGateway = this.airportGatewayFor(input, candidate.data.destinationPlaceId);
          if (!returnGateway) continue;
          if (returnGateway.placeId === declaredGateway.place.id) continue;
          const matchesSupersededHome =
            supersededOriginPlaceId !== undefined && returnGateway.placeId === supersededOriginPlaceId;
          const matchesPreservedRef =
            preservedReturnRef !== undefined &&
            returnGateway.ref.system === preservedReturnRef.system &&
            returnGateway.ref.value.trim().toLowerCase() === preservedReturnRef.value.trim().toLowerCase();
          if (matchesSupersededHome || matchesPreservedRef) {
            // Recorded as an assumption on strategies later; skip uncertainty.
            continue;
          }
          uncertainties.push(
            this.uncertainty(
              `departureOrigin substituted to ${declared.system}:${declared.value}; the return leg departing the event gateway terminates at ${returnGateway.ref.system}:${returnGateway.ref.value} and that terminus is unverified — it is not rebooked on assumption`,
              'MEDIUM',
            ),
          );
          break;
        }
        const windowStart = input.snapshot.anchorEvent?.window.startsAt;
        const requestedDate =
          arrivalLeg?.data.scheduledDeparture?.value.slice(0, 10) ??
          (windowStart ? previousLocalDate(windowStart) : undefined);
        if (!requestedDate) {
          uncertainties.push(
            this.uncertainty(
              'departureOrigin requested but no departure-date evidence exists (no arrival leg, no event window); cannot schedule a search',
              'MEDIUM',
            ),
          );
          continue;
        }
        if (!arrivalLeg) {
          // No existing leg: evidence request only, like the corridor branch.
          toolRequests.push(
            this.searchRequest(
              { system: 'airport-code', value: declaredGateway.ref.value },
              destinationGateway.ref,
              requestedDate,
              declaredGateway.place.id,
              destinationGateway.placeId,
            ),
          );
          continue;
        }
        const toolRequestId = `tool-ws-${dimension}`;
        toolRequests.push(
          this.searchRequest(
            { system: 'airport-code', value: declaredGateway.ref.value },
            destinationGateway.ref,
            requestedDate,
            declaredGateway.place.id,
            destinationGateway.placeId,
            toolRequestId,
          ),
        );
        selected.push({ dimension, leg: arrivalLeg, toolRequestId, substitutedOriginPlaceId: declaredGateway.place.id });
        continue;
      }
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
      // No existing leg: the dimension-scoped request id keeps round-2
      // evidence matching honest, and the corridor endpoints let the
      // strategy builder add the trip's shared arrival/departure slot leg
      // (the same promotion-known slot the arrival constraints reference).
      const toolRequestId = `tool-ws-${dimension}`;
      toolRequests.push(
        this.searchRequest(corridor.originRef, corridor.destinationRef, requestedDate, corridor.originPlaceId, corridor.destinationPlaceId, toolRequestId),
      );
      selected.push({
        dimension,
        toolRequestId,
        corridorOriginPlaceId: corridor.originPlaceId,
        corridorDestinationPlaceId: corridor.destinationPlaceId,
      });
    }
    if (selected.length === 0) {
      if (stayTrack) {
        // No flight dimension produced a search: the stay track alone owns
        // this turn's output.
        return {
          ...stayTrack,
          toolRequests: [...toolRequests, ...stayTrack.toolRequests],
          uncertainties: [...uncertainties, ...stayTrack.uncertainties],
          rationale: `${stayTrack.rationale} (no rebookable leg for the window dimensions)`,
        };
      }
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
      if (stayTrack && stayTrack.strategies.length > 0) {
        return {
          strategies: stayTrack.strategies,
          toolRequests: [...toolRequests, ...stayTrack.toolRequests],
          assumptions: [
            ...stayTrack.assumptions,
            'flight replacement awaits flight.search evidence; only the stay track proposed this round',
          ],
          uncertainties: [
            this.uncertainty('change-request resolution active: awaiting flight.search evidence', 'MEDIUM'),
            ...uncertainties,
            ...stayTrack.uncertainties,
          ],
          rationale: 'northstar window-shift planner proposes stay replacements while flight evidence is pending',
        };
      }
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
      .flatMap(({ dimension, leg, evidence, substitutedOriginPlaceId, corridorOriginPlaceId, corridorDestinationPlaceId }) =>
        evidence
          ? [...evidence.offers]
              .sort(
                (a, b) =>
                  a.segments.length - b.segments.length ||
                  a.totalPrice.amount - b.totalPrice.amount ||
                  a.offerId.localeCompare(b.offerId),
              )
              .map((offer): RecoveryStrategy => {
                const first = offer.segments[0];
                const last = offer.segments[offer.segments.length - 1];
                const windowEvidence =
                  dimension === 'arriveBy'
                    ? target.arriveBy
                    : dimension === 'departAfter'
                      ? target.departAfter
                      : `${target.departureOrigin?.system}:${target.departureOrigin?.value}`;
                // With an existing leg the offer rebooks it; without one the
                // corridor evidence fills the trip's shared slot element —
                // arriveBy the promotion-known arrival slot the arrival
                // constraints already reference (REV-2 WP-R2), departAfter
                // the symmetric departure slot.
                const slotElementId =
                  dimension === 'arriveBy' ? `el-${input.snapshot.tripId}-arrival` : `el-${input.snapshot.tripId}-departure`;
                const candidateOperations: MutationOperation[] = [
                  {
                    op: 'UPSERT_ENTITY',
                    entityType: 'TRIP_ELEMENT',
                    data: leg
                      ? {
                          ...leg,
                          reservationState: 'HELD',
                          status: 'UNKNOWN',
                          data: {
                            ...leg.data,
                            // Origin substitution (fix D/S7): the strategy leg
                            // departs from the traveller-declared gateway, never
                            // from the superseded home gateway.
                            ...(substitutedOriginPlaceId ? { originPlaceId: substitutedOriginPlaceId } : {}),
                            ...(first ? { scheduledDeparture: fact(first.departure) } : {}),
                            ...(last ? { scheduledArrival: fact(last.arrival) } : {}),
                            bookingRef: { system: 'flight-provider', reference: offer.offerId },
                          },
                        }
                      : {
                          id: slotElementId,
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
                            originPlaceId: corridorOriginPlaceId,
                            destinationPlaceId: corridorDestinationPlaceId,
                            ...(first ? { scheduledDeparture: fact(first.departure) } : {}),
                            ...(last ? { scheduledArrival: fact(last.arrival) } : {}),
                            bookingRef: { system: 'flight-provider', reference: offer.offerId },
                          },
                        },
                  },
                ];
                // DR-8: read verbatim as the user-facing option title
                // downstream (readmodels.ts) — include normalized route so
                // connecting offers are never presented as direct.
                const routeLabel = formatOfferRoute(offer);
                const stopsLabel =
                  offer.segments.length <= 1
                    ? 'direct'
                    : `${offer.segments.length - 1} stop${offer.segments.length - 1 === 1 ? '' : 's'}`;
                const originLabel =
                  first?.origin?.value?.trim() ||
                  routeLabel.split('→')[0]?.trim() ||
                  'the new origin';
                const windowPhrase =
                  dimension === 'arriveBy'
                    ? 'arrive earlier'
                    : dimension === 'departAfter'
                      ? 'depart later'
                      : `fly from ${originLabel}`;
                const bookPhrase =
                  dimension === 'arriveBy' ? 'arrive by the requested time' : 'depart after the requested time';
                const summaryPhrase = leg ? windowPhrase : bookPhrase;
                const preserveAssumptions =
                  dimension === 'departureOrigin' && target.preserveReturnDestination
                    ? [
                        `explicit return destination preserved: ${target.preserveReturnDestination.system}:${target.preserveReturnDestination.value}`,
                      ]
                    : dimension === 'departureOrigin'
                      ? ['existing return leg terminus preserved when it matches the superseded home origin']
                      : [];
                return {
                  id: this.idFactory('strat'),
                  caseId: input.caseId,
                  summary: first
                    ? `${leg ? 'Rebook' : 'Book a flight'} ${routeLabel} (${stopsLabel}) to ${summaryPhrase}, departing at ${first.departure.slice(11, 16)}`
                    : `${leg ? 'Rebook' : 'Book a flight'} to ${summaryPhrase}`,
                  candidateOperations,
                  toolRequests: [],
                  assumptions: [
                    'the offer schedule is CONNECTED evidence until execution observation confirms it',
                    ...preserveAssumptions,
                  ],
                  uncertainties: [],
                  expectedOutcomes: [`the trip window satisfies the traveller request (${dimension} ${windowEvidence})`],
                  costImpact: offer.totalPrice,
                  createdAt: this.instant(input),
                };
              })
          : [],
      );
    return {
      strategies: [...strategies, ...(stayTrack?.strategies ?? [])],
      toolRequests: [...toolRequests, ...(stayTrack?.toolRequests ?? [])],
      assumptions: [
        'window-shift strategies are enumerated from flight.search evidence; viability owns feasibility',
        ...(stayTrack?.assumptions ?? []),
      ],
      uncertainties: [...uncertainties, ...(stayTrack?.uncertainties ?? [])],
      rationale: stayTrack
        ? 'northstar window-shift planner enumerates replacement offers and replacement stays from evidence; viability owns feasibility'
        : 'northstar window-shift planner enumerates replacement offers; viability owns feasibility',
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
      if (target.stayCheckOut !== undefined) {
        uncertaintyStatements.push(
          'stayCheckOut requested: replacement/extension strategies await hotel.search evidence; the target check-out is recorded, not silently dropped',
        );
      }
      if (target.stayPlaceRef !== undefined || target.preferredStayPlaceId !== undefined) {
        uncertaintyStatements.push(
          'stay property change requested: replacement options come from hotel.search evidence; the property preference is recorded, not silently dropped',
        );
      }
      if (target.guests !== undefined) {
        uncertaintyStatements.push(
          `stay occupancy requested (${target.guests} guest(s)): occupancy is wired into the evidence search and candidate rates; the count is recorded, not silently dropped`,
        );
      }
      if (target.travelWithTravellerIds !== undefined && target.travelWithTravellerIds.length > 0) {
        uncertaintyStatements.push(
          `cross-traveller association requested (${target.travelWithTravellerIds.length} peer traveller(s)): shared-transport grouping is assessed by concentration policy at request resolution; the desire is recorded, not silently dropped`,
        );
      }
      for (const effect of target.objectiveEffects) {
        uncertaintyStatements.push(
          `objective effect requested for ${effect.objectiveId} (${effect.effect}): objective waivers are authority-gated state changes, never planner-authored; the request is recorded for the authority stage`,
        );
      }
      return {
        target,
        // A declared departure-gateway substitution (fix D/S7) is itself an
        // actionable window dimension: it re-plans the arrival corridor from
        // the stated gateway even when no arriveBy/departAfter is requested.
        actionable:
          target.arriveBy !== undefined ||
          target.departAfter !== undefined ||
          target.departureOrigin !== undefined ||
          target.stayCheckOut !== undefined ||
          target.stayPlaceRef !== undefined ||
          target.preferredStayPlaceId !== undefined ||
          target.guests !== undefined,
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
   * Resolve a declared external ref (system + value) against snapshot place
   * evidence. Used by origin substitution (fix D/S7): the traveller's
   * declared gateway must name a known place; otherwise resolution fails
   * closed with explicit uncertainty — the value is never guessed.
   */
  private placeByExternalRef(
    input: PlannerInput,
    ref: { system: string; value: string },
  ): { place: Place; ref: { system: string; value: string } } | undefined {
    const wanted = ref.value.trim().toLowerCase();
    if (wanted === '') return undefined;
    for (const place of input.snapshot.places) {
      const match = place.externalRefs.find(
        (candidate) =>
          candidate.system === ref.system && candidate.value.trim().toLowerCase() === wanted,
      );
      if (match) return { place, ref: match };
    }
    return undefined;
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

  /**
   * Stay-track planning output for a stay-change target: evidence request on
   * the first pass, replacement/extension strategies once scoped hotel.search
   * evidence exists. `prefixUncertainties` carries the caller's recorded
   * uncertainty context (the full set for stay-only turns).
   */
  private stayChangeOutput(
    input: PlannerInput,
    target: ResolutionTarget,
    prefixUncertainties: UncertaintyRecord[],
  ): PlannerOutput {
    const stay = this.stayFor(input);
    if (!stay) {
      return {
        strategies: [],
        toolRequests: [],
        assumptions: [],
        uncertainties: [
          this.uncertainty(
            'stay change requested but the trip carries no booked Stay element; nothing to reconsider',
            'HIGH',
          ),
          ...prefixUncertainties,
        ],
        rationale: 'northstar window-shift planner failed closed: no stay evidence to replan',
      };
    }
    const toolRequests = this.stayChangeToolRequests(input, target);
    if (toolRequests.length === 0) {
      // No search could be derived (missing dates/place/location): fail
      // closed with the specific reason instead of fabricating candidates.
      return {
        strategies: [],
        toolRequests: [],
        assumptions: [],
        uncertainties: [
          this.uncertainty(
            'stay change requested but check-in/check-out dates or a resolvable place/location are missing; no search derivable',
            'HIGH',
          ),
          ...prefixUncertainties,
        ],
        rationale: 'northstar window-shift planner failed closed: stay-change search underivable',
      };
    }
    // Evidence gate: without scoped hotel.search results this is round 1 —
    // request evidence and stop. With results, enumerate candidate stays.
    const evidence = this.hotelSearchEvidence(input);
    if (!evidence || evidence.rates.length === 0) {
      // hotelSearchEvidence returns null when no prior tool-ws-stay result
      // exists (round 1) and a possibly-empty outcome when a result was
      // recorded. null must NOT count as "searched" — otherwise the
      // evidence-gate message collapses into the empty-rates message and
      // acceptance assertions lose the honest round-1 statement.
      const searched = evidence !== null && evidence !== undefined;
      return {
        strategies: [],
        toolRequests,
        assumptions: [],
        uncertainties: [
          searched
            ? this.uncertainty(
                'hotel.search returned no usable rates; no replacement stay fabricated from empty evidence',
                'MEDIUM',
              )
            : this.uncertainty(
                'stay change active: replacement/extension options must be searched before any strategy is proposed',
                'MEDIUM',
              ),
          ...prefixUncertainties,
        ],
        rationale: searched
          ? 'northstar window-shift planner found no hotel rates; no strategy fabricated'
          : 'northstar window-shift planner requests stay-change evidence before proposing',
      };
    }
    return this.stayReplacementOutput(input, target, stay, evidence, prefixUncertainties);
  }

  /**
   * Read-only hotel.search evidence requests for stay-change targets. Guests
   * come from the declared target occupancy, else the authoritative stay
   * element — absent both stays UNKNOWN (no default adults).
   */
  private stayChangeToolRequests(input: PlannerInput, target: ResolutionTarget): ToolRequest[] {
    const stay = this.stayFor(input);
    if (!stay) return [];
    const checkIn = stay.data.checkIn?.value.slice(0, 10);
    const checkOut = (target.stayCheckOut ?? stay.data.checkOut?.value)?.slice(0, 10);
    if (!checkIn || !checkOut) return [];
    const place =
      (target.preferredStayPlaceId ? this.placeById(input, target.preferredStayPlaceId) : undefined) ??
      this.placeById(input, stay.data.placeId);
    if (!place) return [];
    const location =
      target.stayPlaceRef !== undefined
        ? { externalRef: target.stayPlaceRef }
        : place.coordinates
          ? { coordinates: place.coordinates }
          : place.externalRefs[0]
            ? { externalRef: place.externalRefs[0] }
            : undefined;
    if (!location) return [];
    const guests = hotelSearchGuestsFromOccupancy(target.guests ?? stay.data.guests);
    return [
      {
        // Deterministic scoped id (same discipline as tool-ws-*): round 2
        // matches ITS OWN evidence by request id, never another search's.
        id: 'tool-ws-stay',
        capability: 'HOTEL',
        operation: 'hotel.search',
        parameters: {
          location,
          checkInDate: checkIn,
          checkOutDate: checkOut,
          ...(guests ? { guests } : {}),
        },
        purpose: `find replacement stay options near ${place.id}`,
      },
    ];
  }

  /** The trip's booked stay, when one exists. */
  private stayFor(input: PlannerInput): Stay | undefined {
    return input.snapshot.trip.elements.find((element): element is Stay => element.elementKind === 'STAY');
  }

  /**
   * Scoped hotel.search evidence from the planning loop's prior round,
   * matched by the deterministic request id. A recorded result that carries
   * no usable rates returns an EMPTY outcome (honest "searched, nothing
   * found"), never a fallthrough to unrelated evidence.
   */
  private hotelSearchEvidence(input: PlannerInput): HotelSearchEvidence | undefined | null {
    for (let index = input.priorToolResults.length - 1; index >= 0; index -= 1) {
      const result = input.priorToolResults[index];
      if (!result || result.toolRequestId !== 'tool-ws-stay') continue;
      const data = result.data as Record<string, unknown>;
      const properties = Array.isArray(data['properties']) ? (data['properties'] as unknown[]) : [];
      const rates = Array.isArray(data['rates']) ? (data['rates'] as unknown[]) : [];
      const outcome: HotelSearchEvidence = {
        properties: properties.filter(isHotelPropertyView),
        rates: rates.filter(isHotelRateView),
      };
      return outcome;
    }
    return null;
  }

  /**
   * Enumerate candidate replacement/extension strategies from hotel.search
   * evidence. Generic discipline:
   * - date-only / same-property extensions prefer rates whose provider id
   *   matches the incumbent (or declared same) property — never pad with
   *   unrelated hotels when the request is an extension;
   * - explicit property switches keep cheapest rate per DISTINCT property,
   *   capped for reviewable options (rank order is cheapest-first);
   * - each strategy UPSERTs the incumbent Stay element id (overlay replace
   *   semantics): new dates/place/bookingRef at HELD/UNKNOWN, occupancy from
   *   the declared target else unchanged;
   * - a property unknown to programme Place evidence gets a derived PLACE
   *   upsert keyed by its provider externalRef — no scenario knowledge;
   * - funding anchor flows from the candidate check-out/check-in fact via
   *   fundingAnchorFromCandidateOperations; costImpact is the rate's gross.
   */
  private stayReplacementOutput(
    input: PlannerInput,
    target: ResolutionTarget,
    stay: Stay,
    evidence: HotelSearchEvidence,
    uncertainties: UncertaintyRecord[],
  ): PlannerOutput {
    const sourceId = input.triggeringSignals[0]?.sourceId ?? 'src:northstar-change';
    const observedAt = input.snapshot.takenAt;
    const propertyById = new Map(evidence.properties.map((property) => [property.propertyId, property]));
    const cheapestByProperty = new Map<string, HotelRateView & { property?: HotelPropertyView }>();
    for (const rate of evidence.rates) {
      if (!propertyById.has(rate.propertyId)) continue;
      const incumbent = cheapestByProperty.get(rate.propertyId);
      if (!incumbent || rate.totalPrice.amount < incumbent.totalPrice.amount) {
        cheapestByProperty.set(rate.propertyId, rate);
      } else if (
        rate.totalPrice.amount === incumbent.totalPrice.amount &&
        rate.rateId.localeCompare(incumbent.rateId) < 0
      ) {
        cheapestByProperty.set(rate.propertyId, rate);
      }
    }

    const samePropertyExtension = this.isSamePropertyStayExtension(input, target, stay);
    const incumbentPropertyIds = samePropertyExtension
      ? this.incumbentHotelProviderIds(input, stay, target)
      : [];
    let rankedRates = [...cheapestByProperty.values()].sort(
      (a, b) =>
        a.totalPrice.amount - b.totalPrice.amount ||
        a.rateId.localeCompare(b.rateId),
    );
    if (samePropertyExtension) {
      const samePropertyRates = rankedRates.filter((rate) => incumbentPropertyIds.includes(rate.propertyId));
      if (samePropertyRates.length === 0) {
        return {
          strategies: [],
          toolRequests: [],
          assumptions: [],
          uncertainties: [
            this.uncertainty(
              'same-property stay extension requested but hotel.search evidence has no rate for the incumbent property; no unrelated hotel fabricated',
              'HIGH',
            ),
            ...uncertainties,
          ],
          rationale:
            'northstar window-shift planner failed closed: same-property extension requires incumbent-property rates',
        };
      }
      rankedRates = samePropertyRates;
    }
    const selected = rankedRates.slice(0, MAX_HOTEL_STRATEGIES);

    const strategies: RecoveryStrategy[] = selected.map((rate) => {
      const property = propertyById.get(rate.propertyId)!;
      // Place resolution: reuse a programme-known place only when provider
      // externalRef EVIDENCE ties the searched property to it; otherwise the
      // candidate introduces a derived place keyed by the provider ref. No
      // name guessing, no scenario knowledge.
      const knownPlace =
        input.snapshot.places.find((place) =>
          place.externalRefs.some(
            (ref) =>
              property.externalRefs?.some(
                (candidate) => candidate.system === ref.system && candidate.value === ref.value,
              ) ?? false,
          ),
        ) ??
        (samePropertyExtension ? this.placeById(input, stay.data.placeId) : undefined);
      const placeId = knownPlace ? knownPlace.id : derivedPlaceIdFor(property);
      const placeOperations = knownPlace
        ? []
        : [
            {
              op: 'UPSERT_ENTITY' as const,
              entityType: 'PLACE' as const,
              data: {
                id: placeId,
                name: property.name,
                kind: 'HOTEL' as const,
                ...(property.coordinates ? { coordinates: property.coordinates } : {}),
                externalRefs: property.externalRefs ?? [],
                servedByPlaceIds: [],
              },
            },
          ];
      // Facts NOT changed by the request carry their incumbent evidence
      // verbatim; a requested check-out keeps ASSERTED provenance — a
      // traveller declaration is never upgraded to provider certainty
      // before execution observes it.
      const requestedCheckOut = target.stayCheckOut;
      const requestedGuests = target.guests ?? stay.data.guests;
      const candidateOperations: MutationOperation[] = [
        ...placeOperations,
        {
          op: 'UPSERT_ENTITY' as const,
          entityType: 'TRIP_ELEMENT' as const,
          data: {
            id: stay.id,
            tripId: stay.tripId,
            elementKind: 'STAY',
            importance: stay.importance,
            flexibility: stay.flexibility,
            reservationState: 'HELD',
            status: 'UNKNOWN',
            dependsOn: stay.dependsOn,
            governedByRuleSetIds: stay.governedByRuleSetIds,
            data: {
              placeId,
              checkIn: stay.data.checkIn,
              ...(requestedCheckOut !== undefined
                ? {
                    checkOut: {
                      value: requestedCheckOut,
                      sourceId,
                      authority: 'ASSERTED' as const,
                      observedAt,
                    },
                  }
                : stay.data.checkOut !== undefined
                  ? { checkOut: stay.data.checkOut }
                  : {}),
              bookingRef: { system: HOTEL_RATE_REF_SYSTEM, reference: rate.rateId },
              ...(requestedGuests !== undefined ? { guests: requestedGuests } : {}),
              policyRuleSetIds: stay.data.policyRuleSetIds,
            },
          },
        },
      ];
      const nightsPhrase =
        requestedCheckOut && requestedCheckOut.slice(0, 10) !== stay.data.checkIn.value.slice(0, 10)
          ? (() => {
              const day = requestedCheckOut.slice(0, 10);
              const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
              if (!match) return ` through ${day}`;
              const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
              return ` through ${Number(match[3])} ${months[Number(match[2]) - 1] ?? match[2]}`;
            })()
          : '';
      // Exact provider payable — never round (541.83 must not become 542).
      const payableAmount = Number(rate.totalPrice.amount.toFixed(2));
      const payableLabel = formatMoney({ amount: payableAmount, currency: rate.totalPrice.currency });
      const summary = samePropertyExtension
        ? `Extend stay at ${property.name}${nightsPhrase} — ${payableLabel}`
        : `Switch stay to ${property.name}${nightsPhrase} — ${payableLabel}`;
      return {
        id: this.idFactory('strat'),
        caseId: input.caseId,
        summary,
        candidateOperations,
        toolRequests: [],
        assumptions: [
          'the quoted rate is CONNECTED evidence until execution observation confirms it',
          samePropertyExtension
            ? 'the incumbent stay property is preserved; only requested dates/occupancy change'
            : 'the displaced stay cancels only after the replacement observes CONFIRMED (executor-owned sequencing)',
        ],
        uncertainties: rate.refundable
          ? []
          : [
              {
                id: this.idFactory('unc'),
                statement: `rate ${rate.rateId} is non-refundable per provider evidence`,
                aboutRefs: [],
                severity: 'MEDIUM' as const,
              },
            ],
        expectedOutcomes: [
          samePropertyExtension
            ? `the trip's accommodation extends at the same property with a chargeable rate (${rate.refundable ? 'refundable' : 'non-refundable'})`
            : `the trip's accommodation satisfies the requested change with a chargeable replacement (${rate.refundable ? 'refundable' : 'non-refundable'} rate)`,
        ],
        costImpact: rate.totalPrice,
        createdAt: this.instant(input),
      };
    });

    return {
      strategies,
      toolRequests: [],
      assumptions: [
        samePropertyExtension
          ? 'same-property stay extensions are enumerated from matching hotel.search rates; viability owns feasibility'
          : 'replacement stays are enumerated from hotel.search evidence; viability owns feasibility',
        'funding allocation derives deterministically from the candidate stay check-out/check-in anchor',
      ],
      uncertainties,
      rationale: samePropertyExtension
        ? 'northstar window-shift planner enumerates same-property stay extensions from hotel.search evidence; viability owns feasibility'
        : 'northstar window-shift planner enumerates replacement stays from hotel.search evidence; viability owns feasibility',
    };
  }

  /**
   * Same-property extension when a check-out change is requested and no
   * different property is declared. An explicit stayPlaceRef /
   * preferredStayPlaceId that resolves to the incumbent still counts as
   * same-property (extend, do not switch).
   */
  private isSamePropertyStayExtension(
    input: PlannerInput,
    target: ResolutionTarget,
    stay: Stay,
  ): boolean {
    if (target.stayCheckOut === undefined) return false;
    if (target.preferredStayPlaceId !== undefined && target.preferredStayPlaceId !== stay.data.placeId) {
      return false;
    }
    if (target.stayPlaceRef !== undefined) {
      const incumbent = this.placeById(input, stay.data.placeId);
      const matchesIncumbent =
        incumbent?.externalRefs.some(
          (ref) =>
            ref.system === target.stayPlaceRef!.system &&
            ref.value.trim().toLowerCase() === target.stayPlaceRef!.value.trim().toLowerCase(),
        ) ?? false;
      if (!matchesIncumbent) return false;
    }
    return true;
  }

  /** Provider hotel ids that identify the incumbent stay property. */
  private incumbentHotelProviderIds(
    input: PlannerInput,
    stay: Stay,
    target: ResolutionTarget,
  ): string[] {
    const ids = new Set<string>();
    if (target.stayPlaceRef?.system === 'nuitee-hotel-id') {
      ids.add(target.stayPlaceRef.value);
    }
    const incumbent = this.placeById(input, stay.data.placeId);
    for (const ref of incumbent?.externalRefs ?? []) {
      if (ref.system === 'nuitee-hotel-id') ids.add(ref.value);
    }
    return [...ids];
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

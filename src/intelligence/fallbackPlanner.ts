/**
 * D3 fallback — deterministic, model-free RecoveryPlanner.
 *
 * When Model Studio credentials are absent (credential-free REPLAY demo),
 * recovery planning must still complete the loop honestly. This planner
 * derives strategies ONLY from PlannerInput evidence:
 *
 * - round 1: for a directly-failed FLIGHT leg it emits read-only flight.search
 *   tool requests for the failed leg's scheduled date and the next local
 *   calendar day (overnight recovery when same-day inventory is past/gone);
 * - round 2: once flight.search evidence is present in priorToolResults, it
 *   enumerates one replacement strategy per normalized offer whose departure
 *   is still at/after the snapshot instant. Feasibility, rejection and ranking
 *   stay entirely with the deterministic viability engine — this planner
 *   claims nothing.
 *
 * After the flight recovery executes, a SEQUENTIAL follow-up covers the
 * required overnight the repaired topology still demands:
 *
 * - when no failed leg remains but an uncovered required overnight exists,
 *   the planner emits one hotel.search request for the hub window;
 * - once hotel.search evidence is present, it enumerates hotel-only
 *   strategies whose candidate STAY carries the quoted provider rate ref, so
 *   intent derivation yields hotel.book and the provider-backed executor can
 *   quote/book/retrieve it. Nothing displaces an existing stay.
 *
 * No scenario facts live here: the planner knows the frozen contracts, never
 * scenario content. Any disruption without a failed FLIGHT leg and without a
 * required overnight degrades to an honest empty plan with a visible
 * uncertainty.
 */
import type { EntityId, IsoDateTime, UncertaintyRecord } from '../domain/common.ts';
import type { FlightOffer, HotelPropertyView, HotelRateView } from '../contracts/capabilities.ts';
import type { PlannerInput, PlannerOutput, RecoveryPlanner } from '../contracts/planner.ts';
import type { Place } from '../domain/entities.ts';
import type { TransportLeg } from '../domain/elements.ts';
import { STAY_RATE_BOOKING_REF_SYSTEM } from '../domain/elements.ts';
import type { MutationOperation } from '../operational/mutation.ts';
import type { RecoveryStrategy, ToolRequest } from '../operational/strategy.ts';
import { newId } from '../util/ids.ts';
import { unresolvedOvernights, type RequiredOvernight } from '../engine/overnightStay.ts';
import {
  collectHotelSearchEvidence,
  derivedPlaceIdFor,
  knownPlaceForProperty,
  rankHotelRates,
} from './hotelEvidence.ts';
import { formatMoney } from '../ui/html.ts';

/** Deterministic scoped id for the overnight hotel.search request. */
const OVERNIGHT_HOTEL_TOOL_ID = 'tool-overnight-stay';

export interface FallbackPlannerOptions {
  /** Injectable for deterministic test identifiers. */
  idFactory?: (prefix: string) => string;
  /** Injectable clock; defaults to wall time (strategies carry createdAt only). */
  now?: () => IsoDateTime;
}

/** Deterministic local-date arithmetic: YYYY-MM-DD plus one day. */
function nextLocalDate(isoDate: string): string {
  const millis = Date.parse(`${isoDate.slice(0, 10)}T00:00:00.000Z`) + 86_400_000;
  return new Date(millis).toISOString().slice(0, 10);
}

/** Offset (ms) of a timezone at a given instant (Intl-based, DST-aware). */
function timezoneOffsetMs(instantMs: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(instantMs))
      .map((part) => [part.type, part.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - instantMs;
}

/**
 * A date-only accommodation day becomes local midnight in the hub's timezone,
 * emitted with that timezone's explicit offset (e.g. 2026-09-30T00:00:00+09:00).
 * The offset form is required because downstream coverage reads the local
 * calendar day via iso.slice(0,10); a UTC instant for a positive-offset hub is
 * one calendar day behind and would break the overnight-window comparison.
 * Deterministic for a given date + tz database.
 */
function localMidnightIso(dateOnly: string, timeZone: string): IsoDateTime {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return dateOnly as IsoDateTime;
  const naiveUtc = Date.parse(`${dateOnly}T00:00:00Z`);
  let guess = naiveUtc;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    guess = naiveUtc - timezoneOffsetMs(guess, timeZone);
  }
  const offsetMs = timezoneOffsetMs(guess, timeZone);
  const sign = offsetMs >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMs);
  const hh = String(Math.floor(abs / 3_600_000)).padStart(2, '0');
  const mm = String(Math.floor((abs % 3_600_000) / 60_000)).padStart(2, '0');
  return `${dateOnly}T00:00:00${sign}${hh}:${mm}` as IsoDateTime;
}

/** Whole nights between two YYYY-MM-DD days (check-out day minus check-in day). */
function nightsBetween(firstNight: string, departureDay: string): number {
  const nights =
    (Date.parse(`${departureDay}T00:00:00.000Z`) - Date.parse(`${firstNight}T00:00:00.000Z`)) / 86_400_000;
  return Math.max(1, Math.round(nights));
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
      // Sequential recovery: with the flights repaired, a required overnight
      // the topology still demands is the next actionable dependency.
      const overnightOutput = this.overnightFollowUpOutput(input);
      if (overnightOutput) return overnightOutput;
      return this.degraded('no directly-failed flight leg identified in the impact assessment');
    }

    const searchEvidence = this.flightSearchEvidence(input);
    if (!searchEvidence) {
      const requests = this.searchRequests(input, failedLeg);
      if (requests.length === 0) {
        return this.degraded(
          `failed flight leg ${failedLeg.id} carries no route/date evidence for a replacement search`,
        );
      }
      return {
        strategies: [],
        toolRequests: requests,
        assumptions: [
          `replacement options for ${failedLeg.id} must be searched before strategies are proposed`,
          'same-day and next-day corridor searches are requested so overnight recovery remains representable when same-day departures are already past',
        ],
        uncertainties: [
          this.uncertainty(
            'deterministic fallback planner active: awaiting flight.search evidence before proposing replacements',
            'MEDIUM',
          ),
        ],
        rationale: 'fallback planner requests replacement evidence before proposing any strategy',
      };
    }

    // Offers whose departure is already past the snapshot instant cannot be
    // boarded — drop them before strategy enumeration so ranking never
    // prefers a departed service.
    const boardable = searchEvidence.offers.filter((offer) => {
      const departure = offer.segments[0]?.departure;
      return departure !== undefined && departure >= input.snapshot.takenAt;
    });

    const offers = [...boardable].sort((a, b) => {
      const priceDiff = a.totalPrice.amount - b.totalPrice.amount;
      if (priceDiff !== 0) return priceDiff;
      return a.offerId < b.offerId ? -1 : a.offerId > b.offerId ? 1 : 0;
    });

    if (offers.length === 0) {
      return {
        strategies: [],
        toolRequests: [],
        assumptions: [
          `flight.search evidence for ${failedLeg.id} contained no boardable offers at snapshot instant ${input.snapshot.takenAt}`,
        ],
        uncertainties: [
          this.uncertainty(
            'deterministic fallback planner: every returned offer departs before the planning instant; no replacement strategy fabricated from departed inventory',
            'HIGH',
          ),
        ],
        rationale: 'fallback planner failed closed: no boardable replacement offers remain',
      };
    }

    const strategies: RecoveryStrategy[] = [];
    for (const offer of offers) {
      strategies.push(this.replacementStrategy(input, failedLeg, offer));
    }

    return {
      strategies,
      toolRequests: [],
      assumptions: [
        `each strategy replaces ${failedLeg.id} with one normalized flight.search offer at CONNECTED authority`,
        'offers departing before the planning instant are excluded before strategy enumeration',
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

  /** The directly-failed FLIGHT transport leg whose corridor should be searched. */
  private failedFlightLeg(input: PlannerInput): TransportLeg | undefined {
    const failureIds = new Set<EntityId>(input.impact.directFailures.map((failure) => failure.elementId));
    const failedFlights = input.snapshot.trip.elements.filter(
      (element): element is TransportLeg =>
        element.elementKind === 'TRANSPORT_LEG' &&
        element.data.mode === 'FLIGHT' &&
        failureIds.has(element.id),
    );
    if (failedFlights.length === 0) return undefined;
    if (failedFlights.length === 1) return failedFlights[0];

    // Connection feasibility can mark both inbound and onward legs as direct
    // failures. Replacement search must target the onward corridor — the leg
    // whose origin is another failed flight leg's destination (hub handoff).
    for (const leg of failedFlights) {
      const originPlaceId = leg.data.originPlaceId;
      const inboundFailed = failedFlights.some(
        (other) => other.id !== leg.id && other.data.destinationPlaceId === originPlaceId,
      );
      if (inboundFailed) return leg;
    }

    // Fallback: latest-departing failed leg (onward segment in typical order).
    return [...failedFlights].sort((a, b) =>
      (a.data.scheduledDeparture?.value ?? '').localeCompare(b.data.scheduledDeparture?.value ?? ''),
    ).at(-1);
  }

  /**
   * Union of flight.search offers from prior tool results. Multiple corridor
   * dates (same-day + next-day) merge by offerId so overnight recovery can
   * surface when same-day inventory is past.
   */
  private flightSearchEvidence(input: PlannerInput): { offers: FlightOffer[] } | undefined {
    const byId = new Map<string, FlightOffer>();
    let sawSearch = false;
    for (const result of input.priorToolResults) {
      const offers = (result.data as Record<string, unknown>)['offers'];
      if (!Array.isArray(offers)) continue;
      sawSearch = true;
      for (const offer of offers as FlightOffer[]) {
        if (offer?.offerId) byId.set(offer.offerId, offer);
      }
    }
    if (!sawSearch) return undefined;
    return { offers: [...byId.values()] };
  }

  /**
   * flight.search parameters from snapshot state only (route + original date
   * and the next local calendar day). Two requests keep overnight recovery
   * representable without scenario knowledge.
   */
  private searchRequests(input: PlannerInput, leg: TransportLeg): ToolRequest[] {
    const originPlace = input.snapshot.places.find((place) => place.id === leg.data.originPlaceId);
    const destinationPlace = input.snapshot.places.find((place) => place.id === leg.data.destinationPlaceId);
    const originRef = originPlace?.externalRefs[0];
    const destinationRef = destinationPlace?.externalRefs[0];
    const departureDate = leg.data.scheduledDeparture?.value.slice(0, 10);
    if (!originRef || !destinationRef || !departureDate) return [];
    const dates = [departureDate, nextLocalDate(departureDate)];
    return dates.map((date, index) => ({
      id: this.idFactory('tool'),
      capability: 'FLIGHT' as const,
      operation: 'flight.search' as const,
      parameters: {
        origin: { system: originRef.system, value: originRef.value },
        destination: { system: destinationRef.system, value: destinationRef.value },
        departureDate: date,
        passengers: { adults: 1 },
      },
      purpose:
        index === 0
          ? `find replacement flights for the failed leg ${leg.id}`
          : `find next-day replacement flights for the failed leg ${leg.id} when overnight recovery is required`,
    }));
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

  // ---------------------------------------------------------------------------
  // Required-overnight follow-up (sequential hotel recovery)
  // ---------------------------------------------------------------------------

  /**
   * Hotel-only follow-up for an uncovered required overnight. Round 1
   * requests hotel.search evidence for the hub window; round 2 enumerates
   * one bookable stay strategy per ranked rate. Returns undefined when the
   * trip demands no overnight (or every one is already covered) — the caller
   * then degrades as before.
   */
  private overnightFollowUpOutput(input: PlannerInput): PlannerOutput | undefined {
    const placesById = new Map<EntityId, Place>(input.snapshot.places.map((place) => [place.id, place]));
    const overnights = unresolvedOvernights(input.snapshot.trip, placesById);
    if (overnights.length === 0) return undefined;
    const overnight = overnights[0]!;
    const hub = placesById.get(overnight.hubPlaceId);

    const evidence = collectHotelSearchEvidence(input.priorToolResults, OVERNIGHT_HOTEL_TOOL_ID);
    if (!evidence) {
      const location = this.overnightSearchLocation(hub);
      if (!location) {
        return {
          strategies: [],
          toolRequests: [],
          assumptions: [],
          uncertainties: [
            this.uncertainty(
              `a required overnight at ${overnight.hubPlaceId} (${overnight.firstNight} to ${overnight.departureDay}) cannot be searched: the hub carries no provider-mappable location evidence`,
              'HIGH',
            ),
          ],
          rationale: 'fallback planner failed closed: the overnight hub is not mappable to a provider location',
        };
      }
      const travellers = input.snapshot.travellers.length;
      return {
        strategies: [],
        toolRequests: [
          {
            id: OVERNIGHT_HOTEL_TOOL_ID,
            capability: 'HOTEL' as const,
            operation: 'hotel.search' as const,
            parameters: {
              location,
              checkInDate: overnight.firstNight,
              checkOutDate: overnight.departureDay,
              ...(travellers > 0 ? { guests: { adults: travellers } } : {}),
              rooms: 1,
            },
            purpose:
              `find accommodation for the required overnight at ${overnight.hubPlaceId} ` +
              `(${overnight.firstNight} to ${overnight.departureDay})`,
          },
        ],
        assumptions: [
          'the repaired flight topology still requires an overnight at the connection hub; accommodation evidence is requested before any booking is proposed',
        ],
        uncertainties: [
          this.uncertainty(
            'deterministic fallback planner active: awaiting hotel.search evidence before proposing an overnight stay',
            'MEDIUM',
          ),
        ],
        rationale: 'fallback planner requests overnight accommodation evidence before proposing any strategy',
      };
    }

    const ranked = rankHotelRates(evidence);
    if (ranked.length === 0) {
      return {
        strategies: [],
        toolRequests: [],
        assumptions: [],
        uncertainties: [
          this.uncertainty(
            `hotel.search evidence for the required overnight at ${overnight.hubPlaceId} contained no bookable rates; no stay fabricated`,
            'HIGH',
          ),
        ],
        rationale: 'fallback planner failed closed: no overnight rates in evidence',
      };
    }

    const hubTimezone = hub?.timezone;
    if (!hubTimezone) {
      return {
        strategies: [],
        toolRequests: [],
        assumptions: [],
        uncertainties: [
          this.uncertainty(
            `overnight rates exist for ${overnight.hubPlaceId} but the hub carries no timezone evidence; stay window cannot be normalized`,
            'HIGH',
          ),
        ],
        rationale: 'fallback planner failed closed: no timezone evidence for the overnight hub',
      };
    }

    const strategies = ranked.map(({ rate, property }, index) =>
      this.overnightStrategy(input, overnight, rate, property, index, hubTimezone),
    );
    return {
      strategies,
      toolRequests: [],
      assumptions: [
        'overnight stays are enumerated from hotel.search evidence; viability owns feasibility',
        'the candidate stay ADDS the required night; no existing stay is displaced',
      ],
      uncertainties: [
        this.uncertainty(
          'deterministic fallback planner: overnight strategies are enumerated from hotel.search evidence; feasibility, rejection and ranking are decided solely by the deterministic viability engine',
          'MEDIUM',
        ),
      ],
      rationale: 'fallback planner enumerates overnight accommodation; the viability engine owns feasibility',
    };
  }

  /** Provider-mappable location for the hub: coordinates first, then an external ref. */
  private overnightSearchLocation(
    hub: Place | undefined,
  ): { coordinates: { latitude: number; longitude: number } } | { externalRef: { system: string; value: string } } | undefined {
    if (!hub) return undefined;
    if (hub.coordinates) {
      return { coordinates: { latitude: hub.coordinates.latitude, longitude: hub.coordinates.longitude } };
    }
    const ref = hub.externalRefs[0];
    if (ref) return { externalRef: { system: ref.system, value: ref.value } };
    return undefined;
  }

  /** One bookable overnight-stay strategy for a ranked provider rate. */
  private overnightStrategy(
    input: PlannerInput,
    overnight: RequiredOvernight,
    rate: HotelRateView,
    property: HotelPropertyView,
    index: number,
    hubTimezone: string,
  ): RecoveryStrategy {
    const trip = input.snapshot.trip;
    const sourceId = input.triggeringSignals[0]?.sourceId ?? 'src:runtime-fallback';
    const observedAt = input.snapshot.takenAt;
    const fact = (value: IsoDateTime) => ({
      value,
      sourceId,
      authority: 'CONNECTED' as const,
      observedAt,
    });

    // Place resolution: reuse a programme-known place only when provider
    // externalRef evidence ties the searched property to it; otherwise the
    // candidate introduces a derived place keyed by the provider ref.
    const knownPlace = knownPlaceForProperty(input.snapshot.places, property);
    const placeId = knownPlace ? knownPlace.id : derivedPlaceIdFor(property);
    const placeOperations: MutationOperation[] = knownPlace
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

    const guests = input.snapshot.travellers.length;
    const candidateOperations: MutationOperation[] = [
      ...placeOperations,
      {
        op: 'UPSERT_ENTITY' as const,
        entityType: 'TRIP_ELEMENT' as const,
        data: {
          id: `el-${trip.id}-stay-overnight-${index + 1}`,
          tripId: trip.id,
          elementKind: 'STAY',
          importance: 'REQUIRED',
          flexibility: 'CHANGEABLE',
          reservationState: 'HELD',
          status: 'UNKNOWN',
          dependsOn: [],
          governedByRuleSetIds: [],
          data: {
            placeId,
            checkIn: fact(localMidnightIso(overnight.firstNight, hubTimezone)),
            checkOut: fact(localMidnightIso(overnight.departureDay, hubTimezone)),
            bookingRef: { system: STAY_RATE_BOOKING_REF_SYSTEM, reference: rate.rateId },
            ...(guests > 0 ? { guests } : {}),
            policyRuleSetIds: [],
          },
        },
      },
    ];

    const nights = nightsBetween(overnight.firstNight, overnight.departureDay);
    const nightsPhrase = nights === 1 ? 'one night' : `${nights} nights`;
    const payableAmount = Number(rate.totalPrice.amount.toFixed(2));
    const payableLabel = formatMoney({ amount: payableAmount, currency: rate.totalPrice.currency });
    return {
      id: this.idFactory('strat'),
      caseId: input.caseId,
      summary: `Book ${nightsPhrase} at ${property.name} — ${payableLabel}`,
      candidateOperations,
      toolRequests: [],
      assumptions: ['the quoted rate is CONNECTED evidence until execution observation confirms it'],
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
        `the required overnight at the connection hub is covered by a chargeable booking (${rate.refundable ? 'refundable' : 'non-refundable'} rate)`,
      ],
      costImpact: rate.totalPrice,
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

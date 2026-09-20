/**
 * Planning-local hotel research for a selected flight alternative.
 *
 * This module turns authoritative gap context plus normalized HOTEL reads into
 * candidate-only stay terms. It owns no canonical write, reservation, or
 * provider transaction. The coordinator supplies its output to the existing
 * transport proposer and RC-6 overlay in the same planning pass.
 */
import { createHash } from 'node:crypto';
import type { HotelRateView, HotelSearchOutcome, HotelSearchQuery } from '../contracts/capabilities.ts';
import type { PlanningToolProvenance, PlanningToolRequest, PlanningToolResult } from '../contracts/v2/planning/planningTool.ts';
import { PlanningToolProvenanceSchema, PlanningToolRequestSchema, planningToolRequestFingerprint, type PlanningResearchBudget } from '../contracts/v2/planning/planningTool.ts';
import type { DomainProposerInput, DomainStrategyProposer } from '../contracts/v2/planning/proposerAdaptation.ts';
import type { ScenarioEffect } from '../contracts/v2/scenario/scenarioChange.ts';
import { ExactMoneySchema, compareExactMoney, currencyExponent, type CurrencyCode, type ExactMoney } from '../domain/v2/shared/money.ts';
import { InstantIntervalSchema, type Instant } from '../domain/v2/shared/time.ts';
import type { CapturedWorld } from '../resolution/world/world.ts';
import { projectEffectiveWorld } from '../resolution/world/effectiveItinerary.ts';
import { MAX_CANDIDATES_PER_PROPOSER, ProposalCandidateSchema, type FailingSubject, type ProposalCandidate } from '../resolution/planning/proposer.ts';
import { materializeTransportOffers } from '../resolution/planning/transportOfferMaterialization.ts';
import type { PlanningToolTransport } from '../resolution/planning/researchDispatcher.ts';
import {
  createTransportProposer,
  resolveTransportOffers,
} from '../resolution/planning/proposers/transportProposer.ts';
import type { AirportResolver, TransportPassengerSource } from '../resolution/planning/transportCorridors.ts';
import { proposeOvernightCompanions, type QuotedStayOption, type UncoveredOvernightGap } from '../resolution/planning/proposers/overnightCompanions.ts';
import type { ResolvedOffer, ResolvedStayOffer } from '../resolution/scenarios/overlay.ts';

type StayVisit = Extract<ScenarioEffect, { effectKind: 'ADD_JOURNEY_STAY' }>['visit'];

const SUBJECT_ID = /^[A-Za-z0-9][A-Za-z0-9_\-:.]*$/;
const DEFAULT_MAX_PROPERTIES = 3;
const DEFAULT_MAX_RATES = 2;
/** Extra quote attempts reserved for destination-stay repair after overnight rates. */
const DEFAULT_REPLACEMENT_RATE_BONUS = 2;
const DEFAULT_MAX_COMBINED = 8;
// Overnight search/quote plus destination replacement (policy context, search,
// and alternate quotes) must share one bounded budget. Twelve requests is enough
// for overnight alone but starves replacement quotes once both are required.
const DEFAULT_BUDGET: PlanningResearchBudget = { maxRounds: 3, maxRequests: 18 };

/** The authoritative facts required before hotel research can be requested. */
export interface HotelPlanningContext {
  baseCandidateKey: string;
  journeyId: string;
  /** Existing captured place. Provider location is supplied separately in query. */
  placeId: string;
  query: HotelSearchQuery;
  /** Offset instants backed by the source/property facts used to build query. */
  stayWindow: { start: Instant; end: Instant };
  proposedJourneyItemId: string;
  orderKey: string;
  visit: StayVisit;
  provenance: PlanningToolProvenance;
}

export type HotelPlanningContextResolver = (input: {
  candidate: ProposalCandidate;
  gap: UncoveredOvernightGap;
  world: CapturedWorld;
  now: Instant;
}) => HotelPlanningContext | undefined;

/**
 * Authoritative inputs for retiring one captured destination-stay intent and
 * researching its same-property replacement. `stayElementId` stays protected
 * provider context: it is used only in the read-only hotel.context request.
 */
export interface StayReplacementContext {
  oldJourneyItemId: string;
  reservationLineId: string;
  stayElementId: string;
  replacement: HotelPlanningContext;
}

export type StayReplacementContextResolver = (input: {
  candidate: ProposalCandidate;
  world: CapturedWorld;
  resolvedOffers: readonly ResolvedOffer[];
  now: Instant;
}) => StayReplacementContext | undefined;

export interface HotelPlanningOptions {
  transport: PlanningToolTransport;
  resolveContext: HotelPlanningContextResolver;
  /** Optional authoritative destination-stay replacement facts. */
  resolveStayReplacement?: StayReplacementContextResolver;
  budget?: PlanningResearchBudget;
  maxPropertiesPerSearch?: number;
  maxRatesPerSearch?: number;
  maxCombinedCandidates?: number;
}

/** Protected planning-only provider terms needed by a future execution binder. */
export interface CapturedHotelQuote {
  baseCandidateKey: string;
  journeyId: string;
  context: Pick<HotelPlanningContext, 'placeId' | 'stayWindow' | 'provenance' | 'proposedJourneyItemId' | 'orderKey' | 'visit'>;
  offer: ResolvedStayOffer;
  provider: {
    propertyId: string;
    rateId: string;
    quoteId: string;
    workflowState?: Record<string, unknown>;
    searchRequestFingerprint: string;
    quoteProvenance: PlanningToolProvenance;
  };
  /** Present only when the quote can replace a captured stay with policy evidence. */
  replacement?: {
    oldJourneyItemId: string;
    reservationLineId: string;
    cancellationPenalty: ExactMoney;
    cancellationPenaltyBasis: 'PROVIDER_POLICY' | 'NONREFUNDABLE_BOOKING_PRICE_CEILING';
    provider: {
      stayElementId: string;
      policyProvenance: PlanningToolProvenance;
    };
  };
}

export interface HotelPlanningMaterialization {
  quotedStays: readonly CapturedHotelQuote[];
  resolvedStayOffers: readonly ResolvedStayOffer[];
}

function stableId(prefix: string, value: string): string {
  return `${prefix}:${createHash('sha256').update(value).digest('hex').slice(0, 32)}`;
}

function finiteCap(value: number | undefined, fallback: number): number | undefined {
  if (value === undefined) return fallback;
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function localDate(instant: Instant, timeZone: string): string | undefined {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instant));
    const values = new Map(parts.map((part) => [part.type, part.value]));
    const year = values.get('year'); const month = values.get('month'); const day = values.get('day');
    return year && month && day ? `${year}-${month}-${day}` : undefined;
  } catch { return undefined; }
}

function exactPrice(price: unknown): ExactMoney | undefined {
  if (price === null || typeof price !== 'object') return undefined;
  const raw = price as { amount?: unknown; currency?: unknown };
  if (typeof raw.amount !== 'number' || !Number.isFinite(raw.amount) || typeof raw.currency !== 'string') return undefined;
  // Provider prices arrive as JS numbers at this boundary. Never use toFixed:
  // it can silently lower/round a charge before viability and authority see it.
  const amount = String(raw.amount);
  if (/[eE]/.test(amount)) return undefined;
  const fraction = amount.split('.')[1] ?? '';
  if (fraction.length > currencyExponent(raw.currency as CurrencyCode)) return undefined;
  const parsed = ExactMoneySchema.safeParse({ amount, currency: raw.currency });
  return parsed.success && !parsed.data.amount.startsWith('-') ? parsed.data : undefined;
}

function cancellationPenalty(value: unknown, now: Instant): { amount: ExactMoney; basis: 'PROVIDER_POLICY' | 'NONREFUNDABLE_BOOKING_PRICE_CEILING' } | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const cancellation = (value as { cancellation?: unknown }).cancellation;
  if (cancellation === null || typeof cancellation !== 'object') return undefined;
  const raw = cancellation as { refundable?: unknown; deadline?: unknown; fee?: unknown; maximumLoss?: unknown; maximumLossBasis?: unknown };
  const fee = exactPrice(raw.fee);
  if (!fee) {
    // A supplier's non-refundable tag does not establish an exact refund or
    // charge. An explicitly normalized booking-price ceiling lets the operator
    // authorize the conservative exposure while the actual outcome remains open.
    const maximum = exactPrice(raw.maximumLoss);
    return raw.fee === undefined && raw.refundable === false && raw.maximumLossBasis === 'NONREFUNDABLE_BOOKING_PRICE'
      && maximum && compareExactMoney(maximum, { amount: '0', currency: maximum.currency }) > 0
      ? { amount: maximum, basis: 'NONREFUNDABLE_BOOKING_PRICE_CEILING' } : undefined;
  }
  try {
    if (compareExactMoney(fee, { amount: '0', currency: fee.currency }) > 0) return { amount: fee, basis: 'PROVIDER_POLICY' };
    const deadline = typeof raw.deadline === 'string' ? Date.parse(raw.deadline) : Number.NaN;
    // A zero cancellation amount is safe only when the provider explicitly
    // says this booking is refundable and its free-cancellation deadline is
    // still in the future. Missing policy evidence remains unknown.
    if (raw.refundable === true && Number.isFinite(deadline) && deadline > Date.parse(now)) return { amount: fee, basis: 'PROVIDER_POLICY' };
  } catch {
    return undefined;
  }
  return undefined;
}

function sameRate(a: HotelRateView, b: HotelRateView): boolean {
  return a.rateId === b.rateId && a.propertyId === b.propertyId
    && a.totalPrice.amount === b.totalPrice.amount && a.totalPrice.currency === b.totalPrice.currency;
}

function asSearchOutcome(value: unknown): HotelSearchOutcome | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const raw = value as { properties?: unknown; rates?: unknown };
  if (!Array.isArray(raw.properties) || !Array.isArray(raw.rates)) return undefined;
  const properties = raw.properties.filter((property): property is HotelSearchOutcome['properties'][number] =>
    property !== null && typeof property === 'object' && typeof (property as { propertyId?: unknown }).propertyId === 'string');
  const rates = raw.rates.filter((rate): rate is HotelRateView => rate !== null && typeof rate === 'object'
    && typeof (rate as HotelRateView).rateId === 'string' && typeof (rate as HotelRateView).propertyId === 'string'
    && exactPrice((rate as HotelRateView).totalPrice) !== undefined
    && ['AVAILABLE', 'LIMITED', 'UNKNOWN'].includes(String((rate as HotelRateView).availability)));
  return { properties, rates };
}

function quotedTerms(value: unknown): { quoteId: string; price: ExactMoney; workflowState?: Record<string, unknown> } | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const raw = value as { status?: unknown; quoteId?: unknown; quotedPrice?: unknown; workflowState?: unknown };
  if (raw.status !== 'QUOTED' || typeof raw.quoteId !== 'string' || raw.quoteId.length === 0) return undefined;
  const price = exactPrice(raw.quotedPrice);
  if (!price) return undefined;
  return {
    quoteId: raw.quoteId,
    price,
    ...(raw.workflowState !== undefined && raw.workflowState !== null && typeof raw.workflowState === 'object' && !Array.isArray(raw.workflowState)
      ? { workflowState: raw.workflowState as Record<string, unknown> } : {}),
  };
}

interface SearchBinding {
  context: HotelPlanningContext;
  fingerprint: string;
  request: PlanningToolRequest;
  replacement?: StayReplacementContext;
}
interface RateBinding extends SearchBinding { rate: HotelRateView; quoteRequestId: string; }
interface ReplacementBinding {
  replacement: StayReplacementContext;
  contextRequest: PlanningToolRequest;
}

function sameExternalRef(a: { system: string; value: string }, b: { system: string; value: string }): boolean {
  return a.system === b.system && a.value === b.value;
}

function requestedPropertyRef(place: CapturedWorld['places'][number], context: HotelPlanningContext): { system: string; value: string } | undefined {
  const ref = context.query.location.externalRef;
  if (!ref || !place.externalRefs?.some((captured) => sameExternalRef(captured, ref))) return undefined;
  return ref;
}

function propertyMatchesRef(
  property: HotelSearchOutcome['properties'][number],
  ref: { system: string; value: string },
): boolean {
  return property.propertyId === ref.value
    && property.externalRefs?.some((returned) => sameExternalRef(returned, ref)) === true;
}

function operandJourneyItemId(constraint: CapturedWorld['constraints'][number], key: string): string | undefined {
  const subject = constraint.operands.find((operand) => operand.key === key)?.subject;
  return subject?.kind === 'JOURNEY_ITEM' ? subject.id : undefined;
}

/**
 * Validate that an authoritative replacement context matches an actual
 * registered arrival-alignment failure for this flight candidate. The caller
 * cannot assert this by supplying ids alone.
 */
function validatedStayReplacement(input: {
  world: CapturedWorld;
  candidate: ProposalCandidate;
  resolvedOffers: readonly ResolvedOffer[];
  replacement: StayReplacementContext;
}): StayReplacementContext | undefined {
  const { world, candidate, resolvedOffers, replacement } = input;
  const old = world.journeyItems.find((item) => item.id === replacement.oldJourneyItemId);
  if (!old || old.kind !== 'STAY' || old.lifecycleStatus === 'DROPPED' || old.lifecycleStatus === 'COMPLETED') return undefined;
  const journey = world.journeys.find((candidateJourney) => candidateJourney.id === old.journeyId);
  const line = world.reservationLines.find((candidateLine) => candidateLine.id === replacement.reservationLineId);
  const reservation = line ? world.reservations.find((candidateReservation) => candidateReservation.id === line.reservationId) : undefined;
  const allocation = journey && line ? world.allocations.find((candidateAllocation) =>
    candidateAllocation.reservationId === line.reservationId && candidateAllocation.lineId === line.id
      && candidateAllocation.journeyItemId === old.id && candidateAllocation.travellerId === journey.travellerId,
  ) : undefined;
  if (!journey || !line || line.productType !== 'STAY' || !reservation || reservation.reservationType !== 'STAY' || !allocation) return undefined;
  if (!SUBJECT_ID.test(replacement.stayElementId) || replacement.replacement.baseCandidateKey !== candidate.key
    || replacement.replacement.journeyId !== journey.id) return undefined;

  const select = candidate.effects.filter((effect): effect is Extract<ScenarioEffect, { effectKind: 'SELECT_OFFER' }> => effect.effectKind === 'SELECT_OFFER');
  if (select.length !== 1) return undefined;
  const selected = select[0]!;
  const selectedServiceId = resolvedOffers.find((offer) => offer.offerId === selected.offerId)?.transportServiceId;
  if (!selectedServiceId) return undefined;
  const candidateWorld = structuredClone(world);
  const arrivalItem = candidateWorld.journeyItems.find((item) => item.id === selected.journeyItemId);
  if (!arrivalItem || arrivalItem.journeyId !== journey.id || arrivalItem.kind !== 'TRANSPORT') return undefined;
  arrivalItem.selectedServiceId = selectedServiceId;
  const effective = projectEffectiveWorld(candidateWorld).journeys.find((candidateJourney) => candidateJourney.journeyRef.id === journey.id);
  const candidateArrival = effective?.items.find((item) => item.itemRef.id === arrivalItem.id);
  const originalStay = effective?.items.find((item) => item.itemRef.id === old.id);
  const placeId = originalStay?.startPlaceId;
  const place = placeId ? world.places.find((candidatePlace) => candidatePlace.id === placeId) : undefined;
  if (!candidateArrival?.end.value || !originalStay?.start.value || !originalStay.end.value || !place) return undefined;
  const constraint = world.constraints.find((candidateConstraint) =>
    candidateConstraint.registeredType === 'stay_arrival_date_aligned'
      && candidateConstraint.owner.kind === 'JOURNEY' && candidateConstraint.owner.id === journey.id
      && operandJourneyItemId(candidateConstraint, 'original_stay_item') === old.id
      && operandJourneyItemId(candidateConstraint, 'arrival_item') === arrivalItem.id,
  );
  if (!constraint) return undefined;
  const candidateArrivalDate = localDate(candidateArrival.end.value, place.timeZone);
  const originalStartDate = localDate(originalStay.start.value, place.timeZone);
  const originalCheckoutDate = localDate(originalStay.end.value, place.timeZone);
  const replacementWindow = InstantIntervalSchema.safeParse(replacement.replacement.stayWindow);
  if (!candidateArrivalDate || !originalStartDate || !originalCheckoutDate || !replacementWindow.success || candidateArrivalDate === originalStartDate) return undefined;
  if (replacement.replacement.placeId !== placeId
    || localDate(replacementWindow.data.start, place.timeZone) !== candidateArrivalDate
    || localDate(replacementWindow.data.end, place.timeZone) !== originalCheckoutDate) return undefined;
  return replacement;
}

/**
 * A per-basis session. It records only normalized request/result correlations;
 * no provider raw payload is retained and no canonical state is changed.
 */
export function createHotelCompanionPlanning(input: TransportPassengerSource & {
  world: CapturedWorld;
  failing: readonly FailingSubject[];
  now: Instant;
  resolveAirport: AirportResolver;
  maxOffersPerCorridor?: number;
  hotel: HotelPlanningOptions;
}) {
  const maxProperties = finiteCap(input.hotel.maxPropertiesPerSearch, DEFAULT_MAX_PROPERTIES);
  const maxRates = finiteCap(input.hotel.maxRatesPerSearch, DEFAULT_MAX_RATES);
  const maxCombined = finiteCap(input.hotel.maxCombinedCandidates, DEFAULT_MAX_COMBINED);
  const budget = input.hotel.budget ?? DEFAULT_BUDGET;
  const searches = new Map<string, SearchBinding[]>();
  const quotes = new Map<string, RateBinding[]>();
  const replacementContexts = new Map<string, ReplacementBinding[]>();
  const passengerSource: TransportPassengerSource = input.passengersFor
    ? { passengersFor: input.passengersFor }
    : input.passengers ? { passengers: input.passengers } : {};

  const flightCandidates = async (results: readonly PlanningToolResult[]): Promise<{ candidates: ProposalCandidate[]; resolvedOffers: readonly ResolvedOffer[]; world: CapturedWorld }> => {
    const materialized = materializeTransportOffers({
      world: input.world, failing: input.failing, toolResults: results, now: input.now,
      resolveAirport: input.resolveAirport, ...passengerSource,
      ...(input.maxOffersPerCorridor !== undefined ? { maxOffersPerCorridor: input.maxOffersPerCorridor } : {}),
    });
    const base = createTransportProposer({
      resolveAirport: input.resolveAirport, ...passengerSource,
      ...(input.maxOffersPerCorridor !== undefined ? { maxOffersPerCorridor: input.maxOffersPerCorridor } : {}),
    });
    const candidates = await base.propose({
      workspaceId: 'planning-local', recoveryCaseId: 'planning-local', now: input.now,
      failing: input.failing, world: materialized.world,
      effective: projectEffectiveWorld(materialized.world),
      domain: 'TRANSPORT', evidence: { domainId: 'TRANSPORT', toolResults: results, evidenceRefs: [] }, preferences: [],
    });
    return { candidates, resolvedOffers: materialized.resolvedOffers, world: materialized.world };
  };

  const queueSearch = (
    out: PlanningToolRequest[],
    world: CapturedWorld,
    context: HotelPlanningContext,
    replacement?: StayReplacementContext,
  ): void => {
    const place = world.places.find((candidatePlace) => candidatePlace.id === context.placeId);
    const window = InstantIntervalSchema.safeParse(context.stayWindow);
    const provenance = PlanningToolProvenanceSchema.safeParse(context.provenance);
    const propertyRef = place ? requestedPropertyRef(place, context) : undefined;
    if (!place || !window.success || !provenance.success || !propertyRef
      || !SUBJECT_ID.test(context.proposedJourneyItemId) || context.orderKey.trim().length === 0) return;
    if (!context.query.guestNationality || !/^[A-Z]{2}$/.test(context.query.guestNationality)
      || context.query.guests === undefined || context.query.rooms === undefined
      || localDate(window.data.start, place.timeZone) !== context.query.checkInDate
      || localDate(window.data.end, place.timeZone) !== context.query.checkOutDate) return;
    const request = PlanningToolRequestSchema.safeParse({
      id: stableId('hotel-search', JSON.stringify(context.query)), capability: 'HOTEL', operation: 'hotel.search', parameters: context.query,
      purpose: replacement ? 'Research replacement accommodation at the captured property' : 'Research accommodation for an uncovered overnight itinerary gap',
      evidenceGapCode: replacement ? 'stay_replacement' : 'overnight_accommodation', round: 2,
    });
    if (!request.success) return;
    const fingerprint = planningToolRequestFingerprint(request.data);
    const alreadyQueued = out.some((queued) => planningToolRequestFingerprint(queued) === fingerprint);
    if (!alreadyQueued && out.length >= budget.maxRequests) return;
    const binding: SearchBinding = { context, fingerprint, request: request.data, ...(replacement ? { replacement } : {}) };
    searches.set(fingerprint, [...(searches.get(fingerprint) ?? []), binding]);
    if (!alreadyQueued) out.push(request.data);
  };

  const searchRequests = async (results: readonly PlanningToolResult[]): Promise<PlanningToolRequest[]> => {
    if (maxProperties === undefined || maxRates === undefined || maxCombined === undefined || maxCombined === 0) return [];
    const base = await flightCandidates(results);
    const gaps = proposeOvernightCompanions({ flightCandidates: base.candidates, world: base.world, resolvedOffers: base.resolvedOffers, quotedStayOptions: [], now: input.now });
    if (!gaps.ok) return [];
    const candidates = new Map(base.candidates.map((candidate) => [candidate.key, candidate]));
    const out: PlanningToolRequest[] = [];
    for (const gap of gaps.value.uncoveredGaps) {
      const candidate = candidates.get(gap.baseCandidateKey);
      if (!candidate) continue;
      const context = input.hotel.resolveContext({ candidate, gap, world: base.world, now: input.now });
      if (!context || context.baseCandidateKey !== candidate.key || context.journeyId !== gap.journeyId) continue;
      queueSearch(out, base.world, context);
    }
    if (input.hotel.resolveStayReplacement) {
      for (const candidate of base.candidates) {
        const supplied = input.hotel.resolveStayReplacement({ candidate, world: base.world, resolvedOffers: base.resolvedOffers, now: input.now });
        if (!supplied) continue;
        const replacement = validatedStayReplacement({ world: base.world, candidate, resolvedOffers: base.resolvedOffers, replacement: supplied });
        if (!replacement) continue;
        const contextRequest = PlanningToolRequestSchema.safeParse({
          id: stableId('hotel-context', replacement.stayElementId), capability: 'HOTEL', operation: 'hotel.context', parameters: { stayElementId: replacement.stayElementId },
          purpose: 'Research the captured stay cancellation policy before a replacement proposal', evidenceGapCode: 'stay_cancellation_policy', round: 2,
        });
        if (!contextRequest.success) continue;
        const alreadyQueued = out.some((request) => request.id === contextRequest.data.id);
        if (!alreadyQueued && out.length >= budget.maxRequests) continue;
        replacementContexts.set(contextRequest.data.id, [...(replacementContexts.get(contextRequest.data.id) ?? []), { replacement, contextRequest: contextRequest.data }]);
        if (!alreadyQueued) out.push(contextRequest.data);
        queueSearch(out, base.world, replacement.replacement, replacement);
      }
    }
    return out;
  };

  const quoteRequests = (results: readonly PlanningToolResult[]): PlanningToolRequest[] => {
    type QuoteCandidate = { request: PlanningToolRequest; replacement: boolean; fingerprint: string };
    const candidates: QuoteCandidate[] = [];
    const seenFingerprints = new Set<string>();
    for (const result of results) {
      if (result.operation !== 'hotel.search' || result.status !== 'SUCCEEDED') continue;
      const bindings = [...searches.values()].flat().filter((binding) => binding.request.id === result.requestId);
      const outcome = asSearchOutcome(result.normalizedEvidence);
      if (!outcome || bindings.length === 0) continue;
      const isReplacement = bindings.some((binding) => binding.replacement);
      const propertyIds = new Set(bindings.flatMap((binding) => {
        const place = input.world.places.find((candidate) => candidate.id === binding.context.placeId);
        const ref = place ? requestedPropertyRef(place, binding.context) : undefined;
        if (!ref) return [];
        return outcome.properties
          .filter((property) => propertyMatchesRef(property, ref))
          .slice(0, maxProperties ?? 0)
          .map((property) => property.propertyId);
      }));
      // Destination repair closes a hard stay dependency; give it alternate-rate
      // headroom before overnight fragments consume the shared quote budget.
      const rateLimit = (maxRates ?? 0) + (isReplacement ? DEFAULT_REPLACEMENT_RATE_BONUS : 0);
      for (const rate of outcome.rates.filter((candidate) => candidate.availability !== 'UNKNOWN' && propertyIds.has(candidate.propertyId)).slice(0, rateLimit)) {
        const request = PlanningToolRequestSchema.parse({
          id: stableId('hotel-quote', JSON.stringify({ rateId: rate.rateId })), capability: 'HOTEL', operation: 'hotel.quote', parameters: { rateId: rate.rateId },
          purpose: isReplacement ? 'Confirm replacement accommodation terms' : 'Confirm accommodation terms for an uncovered overnight itinerary gap',
          evidenceGapCode: isReplacement ? 'stay_replacement' : 'overnight_accommodation', round: 3,
        });
        const fingerprint = planningToolRequestFingerprint(request);
        if (seenFingerprints.has(fingerprint)) continue;
        const rateBindings = bindings.map((binding) => ({ ...binding, rate, quoteRequestId: request.id }));
        const existing = quotes.get(fingerprint) ?? [];
        if (existing.some((binding) => !sameRate(binding.rate, rate))) continue;
        quotes.set(fingerprint, [...existing, ...rateBindings]);
        seenFingerprints.add(fingerprint);
        candidates.push({ request, replacement: isReplacement, fingerprint });
      }
    }
    // Dispatch destination-repair quotes before overnight alternates so a tight
    // research budget still materialises dependency-closed candidates first.
    return [
      ...candidates.filter((candidate) => candidate.replacement).map((candidate) => candidate.request),
      ...candidates.filter((candidate) => !candidate.replacement).map((candidate) => candidate.request),
    ];
  };

  const materialize = (results: readonly PlanningToolResult[]): HotelPlanningMaterialization => {
    const quotedStays: CapturedHotelQuote[] = [];
    for (const result of results) {
      if (result.operation !== 'hotel.quote' || result.status !== 'SUCCEEDED') continue;
      const bindings = [...quotes.values()].flat().filter((binding) => binding.quoteRequestId === result.requestId);
      const terms = quotedTerms(result.normalizedEvidence);
      if (!terms) continue;
      for (const binding of bindings) {
        const replacement = binding.replacement;
        const policy = replacement
          ? replacementContexts.get(stableId('hotel-context', replacement.stayElementId))
            ?.map((contextBinding) => {
              const contextResult = results.find((candidate) => candidate.requestId === contextBinding.contextRequest.id
                && candidate.operation === 'hotel.context' && candidate.status === 'SUCCEEDED');
              const penalty = contextResult ? cancellationPenalty(contextResult.normalizedEvidence, input.now) : undefined;
              return penalty && contextResult ? { cancellationPenalty: penalty.amount, cancellationPenaltyBasis: penalty.basis, policyProvenance: contextResult.provenance } : undefined;
            })
            .find((candidate): candidate is { cancellationPenalty: ExactMoney; cancellationPenaltyBasis: 'PROVIDER_POLICY' | 'NONREFUNDABLE_BOOKING_PRICE_CEILING'; policyProvenance: PlanningToolProvenance } => candidate !== undefined)
          : undefined;
        if (replacement && !policy) continue;
        const offer: ResolvedStayOffer = {
          offerId: stableId('stay-offer', JSON.stringify({ rateId: binding.rate.rateId, propertyId: binding.rate.propertyId, placeId: binding.context.placeId, stayWindow: binding.context.stayWindow, price: terms.price, searchRequestFingerprint: binding.fingerprint })),
          placeId: binding.context.placeId, stayWindow: binding.context.stayWindow, price: terms.price,
        };
        quotedStays.push({
          baseCandidateKey: binding.context.baseCandidateKey, journeyId: binding.context.journeyId,
          context: { placeId: binding.context.placeId, stayWindow: binding.context.stayWindow, provenance: binding.context.provenance, proposedJourneyItemId: binding.context.proposedJourneyItemId, orderKey: binding.context.orderKey, visit: binding.context.visit },
          offer,
          provider: { propertyId: binding.rate.propertyId, rateId: binding.rate.rateId, quoteId: terms.quoteId, ...(terms.workflowState ? { workflowState: terms.workflowState } : {}), searchRequestFingerprint: binding.fingerprint, quoteProvenance: result.provenance },
          ...(replacement && policy ? {
            replacement: {
              oldJourneyItemId: replacement.oldJourneyItemId,
              reservationLineId: replacement.reservationLineId,
              cancellationPenalty: policy.cancellationPenalty,
              cancellationPenaltyBasis: policy.cancellationPenaltyBasis,
              provider: { stayElementId: replacement.stayElementId, policyProvenance: policy.policyProvenance },
            },
          } : {}),
        });
      }
    }
    const unique = new Map<string, ResolvedStayOffer>();
    for (const quote of quotedStays) unique.set(quote.offer.offerId, quote.offer);
    return { quotedStays, resolvedStayOffers: [...unique.values()] };
  };

  const proposer: DomainStrategyProposer = {
    id: 'proposer.transport-offer-with-overnight', version: '1', domains: ['TRANSPORT'],
    async propose(domainInput: DomainProposerInput): Promise<ProposalCandidate[]> {
      const base = createTransportProposer({ resolveAirport: input.resolveAirport, ...passengerSource, ...(input.maxOffersPerCorridor !== undefined ? { maxOffersPerCorridor: input.maxOffersPerCorridor } : {}) });
      const candidates = await base.propose(domainInput);
      const resolvedOffers = resolveTransportOffers({ world: domainInput.world, failing: domainInput.failing, toolResults: domainInput.evidence.toolResults, now: domainInput.now, resolveAirport: input.resolveAirport, ...passengerSource, ...(input.maxOffersPerCorridor !== undefined ? { maxOffersPerCorridor: input.maxOffersPerCorridor } : {}) }).resolvedOffers;
      const materialized = materialize(domainInput.evidence.toolResults);
      const options: QuotedStayOption[] = materialized.quotedStays.filter((quote) => quote.replacement === undefined).map((quote) => ({
        baseCandidateKey: quote.baseCandidateKey, journeyId: quote.journeyId, offerId: quote.offer.offerId, offer: quote.offer,
        proposedJourneyItemId: quote.context.proposedJourneyItemId, orderKey: quote.context.orderKey, visit: quote.context.visit,
      }));
      const companions = proposeOvernightCompanions({ flightCandidates: candidates, world: domainInput.world, resolvedOffers, quotedStayOptions: options, now: domainInput.now, maxCombinedCandidates: maxCombined });
      if (!companions.ok) return candidates;
      const replacementQuotes = materialized.quotedStays.filter((quote): quote is CapturedHotelQuote & { replacement: NonNullable<CapturedHotelQuote['replacement']> } => quote.replacement !== undefined);
      const companionByBase = new Map(companions.value.resolvedStayOffers.map((entry) => [entry.baseCandidateKey, entry.candidateKey]));
      const companionByKey = new Map(companions.value.candidates.map((candidate) => [candidate.key, candidate]));
      const baseByKey = new Map(candidates.map((candidate) => [candidate.key, candidate]));
      // Keep base flight alternatives, but allocate the bounded extra slots to
      // complete plans before partial overnight fragments. Otherwise a full
      // flight result set can consume every slot before destination repair.
      const output = [...candidates];
      const emitted = new Set(output.map((candidate) => candidate.key));
      const replacementCap = Math.min(maxCombined ?? 0, Math.max(0, MAX_CANDIDATES_PER_PROPOSER - output.length));
      let replacementCount = 0;
      for (const quote of replacementQuotes) {
        if (replacementCount >= replacementCap) break;
        if (!quote.replacement) continue;
        // Prefer the overnight-extended stem when that hard gap exists; otherwise
        // close the destination-stay dependency directly on the transport base.
        const companionKey = companionByBase.get(quote.baseCandidateKey);
        const stem = (companionKey ? companionByKey.get(companionKey) : undefined)
          ?? baseByKey.get(quote.baseCandidateKey);
        if (!stem) continue;
        const key = stableId('stay-replacement-candidate', JSON.stringify({
          stemKey: stem.key,
          oldJourneyItemId: quote.replacement.oldJourneyItemId,
          reservationLineId: quote.replacement.reservationLineId,
          offerId: quote.offer.offerId,
        }));
        if (emitted.has(key)) continue;
        const parsed = ProposalCandidateSchema.safeParse({
          key,
          effects: [
            ...stem.effects,
            { effectKind: 'CANCEL_STAY', journeyItemId: quote.replacement.oldJourneyItemId, reservationLineId: quote.replacement.reservationLineId, cancellationPenalty: quote.replacement.cancellationPenalty, cancellationPenaltyBasis: quote.replacement.cancellationPenaltyBasis },
            { effectKind: 'ADD_JOURNEY_STAY', proposedJourneyItemId: quote.context.proposedJourneyItemId, journeyId: quote.journeyId, orderKey: quote.context.orderKey, offerId: quote.offer.offerId, offerPrice: quote.offer.price, visit: quote.context.visit, replacesReservationLineId: quote.replacement.reservationLineId },
          ],
          affectedSubjectRefs: [
            ...stem.affectedSubjectRefs,
            { kind: 'JOURNEY_ITEM', id: quote.replacement.oldJourneyItemId },
            { kind: 'RESERVATION_LINE', id: quote.replacement.reservationLineId },
            { kind: 'JOURNEY', id: quote.journeyId },
            { kind: 'OFFER', id: quote.offer.offerId },
          ],
          rationale: 'Replace the required destination stay after the selected arrival changes its local date.',
          assumptions: stem.assumptions,
        });
        if (!parsed.success) continue;
        emitted.add(key);
        output.push(parsed.data);
        replacementCount += 1;
      }
      for (const candidate of companions.value.candidates) {
        if (output.length >= MAX_CANDIDATES_PER_PROPOSER) break;
        if (!emitted.has(candidate.key)) {
          output.push(candidate);
          emitted.add(candidate.key);
        }
      }
      return output;
    },
  };

  return {
    transport: input.hotel.transport,
    proposer,
    budget,
    nextRound: async ({ completedRound, results }: { completedRound: number; results: readonly PlanningToolResult[] }): Promise<readonly PlanningToolRequest[]> => {
      if (completedRound === 1) return searchRequests(results);
      if (completedRound === 2) return quoteRequests(results);
      return [];
    },
    materialize,
  };
}

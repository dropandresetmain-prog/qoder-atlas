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
import { ExactMoneySchema, currencyExponent, type ExactMoney } from '../domain/v2/shared/money.ts';
import { InstantIntervalSchema, type Instant } from '../domain/v2/shared/time.ts';
import type { CapturedWorld } from '../resolution/world/world.ts';
import { projectEffectiveWorld } from '../resolution/world/effectiveItinerary.ts';
import type { FailingSubject, ProposalCandidate } from '../resolution/planning/proposer.ts';
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
const DEFAULT_MAX_COMBINED = 8;
const DEFAULT_BUDGET: PlanningResearchBudget = { maxRounds: 3, maxRequests: 12 };

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

export interface HotelPlanningOptions {
  transport: PlanningToolTransport;
  resolveContext: HotelPlanningContextResolver;
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
  const parsed = ExactMoneySchema.safeParse({ amount: raw.amount.toFixed(currencyExponent(raw.currency as ExactMoney['currency'])), currency: raw.currency });
  return parsed.success && !parsed.data.amount.startsWith('-') ? parsed.data : undefined;
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

interface SearchBinding { context: HotelPlanningContext; fingerprint: string; request: PlanningToolRequest; }
interface RateBinding extends SearchBinding { rate: HotelRateView; quoteRequestId: string; }

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
      const place = base.world.places.find((candidatePlace) => candidatePlace.id === context.placeId);
      const window = InstantIntervalSchema.safeParse(context.stayWindow);
      const provenance = PlanningToolProvenanceSchema.safeParse(context.provenance);
      const hasProviderLocation = context.query.location.externalRef !== undefined
        || context.query.location.coordinates !== undefined;
      if (!place || !window.success || !provenance.success || !hasProviderLocation
        || !SUBJECT_ID.test(context.proposedJourneyItemId) || context.orderKey.trim().length === 0) continue;
      if (!context.query.guestNationality || !/^[A-Z]{2}$/.test(context.query.guestNationality)
        || context.query.guests === undefined || context.query.rooms === undefined
        || localDate(window.data.start, place.timeZone) !== context.query.checkInDate
        || localDate(window.data.end, place.timeZone) !== context.query.checkOutDate) continue;
      const request = PlanningToolRequestSchema.safeParse({
        id: stableId('hotel-search', JSON.stringify(context.query)), capability: 'HOTEL', operation: 'hotel.search', parameters: context.query,
        purpose: 'Research accommodation for an uncovered overnight itinerary gap', evidenceGapCode: 'overnight_accommodation', round: 2,
      });
      if (!request.success) continue;
      const fingerprint = planningToolRequestFingerprint(request.data);
      const binding: SearchBinding = { context, fingerprint, request: request.data };
      searches.set(fingerprint, [...(searches.get(fingerprint) ?? []), binding]);
      out.push(request.data);
    }
    return out;
  };

  const quoteRequests = (results: readonly PlanningToolResult[]): PlanningToolRequest[] => {
    const out: PlanningToolRequest[] = [];
    for (const result of results) {
      if (result.operation !== 'hotel.search' || result.status !== 'SUCCEEDED') continue;
      const bindings = [...searches.values()].flat().filter((binding) => binding.request.id === result.requestId);
      const outcome = asSearchOutcome(result.normalizedEvidence);
      if (!outcome || bindings.length === 0) continue;
      const propertyIds = new Set(outcome.properties.slice(0, maxProperties ?? 0).map((property) => property.propertyId));
      for (const rate of outcome.rates.filter((candidate) => candidate.availability !== 'UNKNOWN' && propertyIds.has(candidate.propertyId)).slice(0, maxRates ?? 0)) {
        const request = PlanningToolRequestSchema.parse({
          id: stableId('hotel-quote', JSON.stringify({ rateId: rate.rateId })), capability: 'HOTEL', operation: 'hotel.quote', parameters: { rateId: rate.rateId },
          purpose: 'Confirm accommodation terms for an uncovered overnight itinerary gap', evidenceGapCode: 'overnight_accommodation', round: 3,
        });
        const fingerprint = planningToolRequestFingerprint(request);
        const rateBindings = bindings.map((binding) => ({ ...binding, rate, quoteRequestId: request.id }));
        const existing = quotes.get(fingerprint) ?? [];
        if (existing.some((binding) => !sameRate(binding.rate, rate))) continue;
        quotes.set(fingerprint, [...existing, ...rateBindings]);
        out.push(request);
      }
    }
    return out;
  };

  const materialize = (results: readonly PlanningToolResult[]): HotelPlanningMaterialization => {
    const quotedStays: CapturedHotelQuote[] = [];
    for (const result of results) {
      if (result.operation !== 'hotel.quote' || result.status !== 'SUCCEEDED') continue;
      const bindings = [...quotes.values()].flat().filter((binding) => binding.quoteRequestId === result.requestId);
      const terms = quotedTerms(result.normalizedEvidence);
      if (!terms) continue;
      for (const binding of bindings) {
        const offer: ResolvedStayOffer = {
          offerId: stableId('stay-offer', JSON.stringify({ rateId: binding.rate.rateId, quoteId: terms.quoteId, propertyId: binding.rate.propertyId, price: terms.price })),
          placeId: binding.context.placeId, stayWindow: binding.context.stayWindow, price: terms.price,
        };
        quotedStays.push({
          baseCandidateKey: binding.context.baseCandidateKey, journeyId: binding.context.journeyId,
          context: { placeId: binding.context.placeId, stayWindow: binding.context.stayWindow, provenance: binding.context.provenance, proposedJourneyItemId: binding.context.proposedJourneyItemId, orderKey: binding.context.orderKey, visit: binding.context.visit },
          offer,
          provider: { propertyId: binding.rate.propertyId, rateId: binding.rate.rateId, quoteId: terms.quoteId, ...(terms.workflowState ? { workflowState: terms.workflowState } : {}), searchRequestFingerprint: binding.fingerprint, quoteProvenance: result.provenance },
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
      const options: QuotedStayOption[] = materialized.quotedStays.map((quote) => ({
        baseCandidateKey: quote.baseCandidateKey, journeyId: quote.journeyId, offerId: quote.offer.offerId, offer: quote.offer,
        proposedJourneyItemId: quote.context.proposedJourneyItemId, orderKey: quote.context.orderKey, visit: quote.context.visit,
      }));
      const companions = proposeOvernightCompanions({ flightCandidates: candidates, world: domainInput.world, resolvedOffers, quotedStayOptions: options, now: domainInput.now, maxCombinedCandidates: maxCombined });
      return companions.ok ? companions.value.candidates : candidates;
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

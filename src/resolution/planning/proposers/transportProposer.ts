/**
 * NORTHSTAR R1 — provider-assisted TRANSPORT recovery proposer (freeze C2/C4).
 *
 * This is the concrete generalized TRANSPORT proposer the R1 product truth
 * requires: it turns provider-assisted travel evidence (normalized
 * `flight.search` offers gathered through the C2 read-only tool protocol) into
 * ranked, bounded `SELECT_OFFER` proposal candidates for the failing TRANSPORT
 * journey items of a recovery case. It is a `DomainStrategyProposer` (C4): it
 * declares the TRANSPORT domain and consumes the additive
 * `PlanningEvidenceContext` the coordinator threads to it.
 *
 * STRICTLY PROPOSAL-ONLY. Like every proposer it cannot assert viability,
 * authority, execution or observed truth: each candidate is re-validated by
 * `validateProposalCandidates` against the closed `ScenarioEffect` vocabulary and
 * then evaluated by the REAL RC-6 overlay (`evaluateRecoveryStrategy`). Whether a
 * selected offer can actually be honored — the offer must resolve to a transport
 * service that EXISTS in the captured world (overlay.ts: "cannot fabricate
 * supplier selection") — is decided downstream, never here. A net-new researched
 * offer therefore needs materialization into a captured service before RC-6 can
 * make it VIABLE; that materialization is a persistence/runtime concern, not a
 * proposer concern (see the LOCAL handoff ledger).
 *
 * GENERALIZED, NOT SCENARIO-SPECIFIC. There is no persona, event, route, airport
 * or city branch. Corridors come from the pure `transportCorridors` spine over
 * canonical world state; airport refs come from the INJECTED resolver; passenger
 * counts are INJECTED; offers come from provider evidence. The ranking algorithm
 * is adapted from the historical northstar planner (fewest segments, then lowest
 * price, then a deterministic key) — a pure ordering, never a viability claim.
 *
 * Provider offer ids (Atlas `routingIdentifier`) are NOT SubjectId-safe, so every
 * emitted `SELECT_OFFER.offerId` is a deterministic SubjectId-safe key derived
 * from (journey item, raw offer id); the raw provider id is preserved in the
 * resolved-offer index for execution/reconciliation, never lost and never used as
 * a subject id.
 */
import { createHash } from 'node:crypto';
import type { FlightOffer, FlightSearchOutcome } from '../../../contracts/capabilities.ts';
import type { PlanningToolResult } from '../../../contracts/v2/planning/planningTool.ts';
import type { DomainProposerInput, DomainStrategyProposer } from '../../../contracts/v2/planning/proposerAdaptation.ts';
import type { RecoveryDomainId } from '../../../contracts/v2/planning/recoveryDomain.ts';
import type { TypedRef } from '../../../domain/v2/shared/identity.ts';
import type { ExactMoney } from '../../../domain/v2/shared/money.ts';
import { ExactMoneySchema, currencyExponent, type CurrencyCode } from '../../../domain/v2/shared/money.ts';
import { compareInstants, type Instant } from '../../../domain/v2/shared/time.ts';
import type { ResolvedOffer } from '../../scenarios/overlay.ts';
import type { ProposalCandidate } from '../proposer.ts';
import type { RequestPlanningContext } from '../changeRequestConstraints.ts';
import {
  transportCorridors,
  transportRequestId,
  journeyItemIdForRequest,
  type AirportResolver,
  type TransportCorridor,
  type TransportPassengerSource,
} from '../transportCorridors.ts';

export const TRANSPORT_PROPOSER_ID = 'proposer.transport-offer';
export const TRANSPORT_DOMAIN: RecoveryDomainId = 'TRANSPORT';

/** SubjectId-safe prefixes; every char is in /^[A-Za-z0-9][A-Za-z0-9_\-:.]*$/. */
const OFFER_KEY_PREFIX = 'transport-offer:';
const SERVICE_KEY_PREFIX = 'transport-service:';
const SUBJECT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_\-:.]*$/;

/** Hard bound on offers proposed per corridor; keeps the candidate set finite. */
const DEFAULT_MAX_OFFERS_PER_CORRIDOR = 6;

export interface TransportProposerOptions extends TransportPassengerSource {
  /** INJECTED place→provider-airport resolver. Never hardcoded here (fail-closed). */
  resolveAirport: AirportResolver;
  /** Max ranked offers proposed per corridor (bounded; defaults to 6). */
  maxOffersPerCorridor?: number;
}

/** Deterministic digest binding an offer to the journey item it was researched for. */
function offerDigest(journeyItemId: string, rawOfferId: string): string {
  return createHash('sha256').update(`${journeyItemId}|${rawOfferId}`).digest('hex').slice(0, 32);
}

/**
 * The deterministic, SubjectId-safe key a `SELECT_OFFER` effect uses for a
 * provider offer. The raw provider id is not SubjectId-safe (Atlas
 * routingIdentifiers contain '|', '^', '=' and spaces), so it is never used as a
 * subject id; this key is stable across reruns for the same (item, offer).
 */
export function transportOfferKey(journeyItemId: string, rawOfferId: string): string {
  const key = `${OFFER_KEY_PREFIX}${offerDigest(journeyItemId, rawOfferId)}`;
  if (!SUBJECT_ID_RE.test(key)) throw new Error(`derived offer key ${key} is not SubjectId-safe`);
  return key;
}

/**
 * The deterministic, SubjectId-safe prospective transport-service id a selected
 * offer would occupy. For an offer already captured this is matched to the real
 * service by the composition; for a net-new researched offer it is the id the
 * materialization seam (a persistence write) would create. The overlay only honors
 * a SELECT_OFFER whose service EXISTS in the captured world — this proposer never
 * fabricates that existence.
 */
export function prospectiveTransportServiceId(journeyItemId: string, rawOfferId: string): string {
  const id = `${SERVICE_KEY_PREFIX}${offerDigest(journeyItemId, rawOfferId)}`;
  if (!SUBJECT_ID_RE.test(id)) throw new Error(`derived service id ${id} is not SubjectId-safe`);
  return id;
}

/**
 * Convert a provider `Money` (float amount) to the contract's `ExactMoney`
 * (decimal string) at the currency's minor-unit exponent. Normalized Atlas prices
 * are round2 outputs (<= 2 dp), so `toFixed(exponent)` is exact; the result is
 * re-validated by `ExactMoneySchema` so a malformed amount fails closed rather
 * than silently entering a SELECT_OFFER effect. Returns undefined on failure.
 */
export function exactPriceOf(amount: number, currency: string): ExactMoney | undefined {
  if (!Number.isFinite(amount)) return undefined;
  const parsed = ExactMoneySchema.safeParse({ amount: amount.toFixed(currencyExponent(currency as CurrencyCode)), currency });
  return parsed.success ? parsed.data : undefined;
}

/** A normalized offer correlated to the journey item it was researched for. */
export interface CorrelatedOffer {
  journeyItemId: string;
  journeyId: string;
  rawOfferId: string;
  offerKey: string;
  transportServiceId: string;
  offer: FlightOffer;
  price: ExactMoney;
  segmentCount: number;
}

/**
 * Structural guard for a `flight.search` normalizedEvidence payload. The C2 result
 * carries `normalizedEvidence: unknown`; this recognises the provider-neutral
 * `FlightSearchOutcome` shape without trusting it blindly. Anything else is
 * ignored (never fabricated into an offer).
 */
function asFlightSearchOutcome(evidence: unknown): FlightSearchOutcome | undefined {
  if (evidence === null || typeof evidence !== 'object') return undefined;
  const offers = (evidence as { offers?: unknown }).offers;
  if (!Array.isArray(offers)) return undefined;
  const valid = offers.filter(
    (o): o is FlightOffer =>
      o !== null && typeof o === 'object'
      && typeof (o as FlightOffer).offerId === 'string'
      && Array.isArray((o as FlightOffer).segments)
      && (o as FlightOffer).segments.length > 0
      && typeof (o as FlightOffer).totalPrice === 'object'
      && (o as FlightOffer).totalPrice !== null
      && typeof (o as FlightOffer).totalPrice.amount === 'number'
      && typeof (o as FlightOffer).totalPrice.currency === 'string',
  );
  return { offers: valid };
}

/**
 * Rank offers with the historical northstar ordering: fewest segments first, then
 * lowest price, then a deterministic key tiebreak. A pure ordering — it never
 * decides viability (RC-6 does) and never inspects a traveller/event/route.
 */
function rankOffers(offers: readonly CorrelatedOffer[]): CorrelatedOffer[] {
  return [...offers].sort(
    (a, b) =>
      a.segmentCount - b.segmentCount
      || comparePrice(a, b)
      || a.offerKey.localeCompare(b.offerKey),
  );
}

/** Numeric price comparison within one corridor (offers share a currency). */
function comparePrice(a: CorrelatedOffer, b: CorrelatedOffer): number {
  return a.offer.totalPrice.amount - b.offer.totalPrice.amount;
}

/**
 * Pure: correlate the gathered `flight.search` evidence to corridors and produce
 * the boardable, ranked offers per journey item. Shared by the proposer (which
 * emits candidates) and `resolveTransportOffers` (which builds the evaluation
 * input), so the offer keys always align. Boardability drops an offer whose first
 * segment departs before `now` — an honest filter, never a viability claim.
 */
export function correlatedTransportOffers(input: {
  corridors: readonly TransportCorridor[];
  toolResults: readonly PlanningToolResult[];
  now: Instant;
  maxOffersPerCorridor: number;
}): { offers: CorrelatedOffer[]; resolvedOffers: ResolvedOffer[] } {
  const offers: CorrelatedOffer[] = [];
  const resolvedOffers: ResolvedOffer[] = [];

  for (const corridor of input.corridors) {
    const requestId = transportRequestId(corridor);
    const result = input.toolResults.find(
      (r) => r.requestId === requestId && r.operation === 'flight.search' && r.status === 'SUCCEEDED',
    );
    if (!result) continue;
    const outcome = asFlightSearchOutcome(result.normalizedEvidence);
    if (!outcome) continue;

    const boardable = outcome.offers.filter(
      (offer) => offer.segments[0] && compareInstants(offer.segments[0].departure, input.now) >= 0,
    );
    const correlated: CorrelatedOffer[] = [];
    for (const offer of boardable) {
      const price = exactPriceOf(offer.totalPrice.amount, offer.totalPrice.currency);
      if (!price) continue; // a price we cannot represent exactly is not proposed
      correlated.push({
        journeyItemId: corridor.journeyItemId,
        journeyId: corridor.journeyId,
        rawOfferId: offer.offerId,
        offerKey: transportOfferKey(corridor.journeyItemId, offer.offerId),
        transportServiceId: prospectiveTransportServiceId(corridor.journeyItemId, offer.offerId),
        offer,
        price,
        segmentCount: offer.segments.length,
      });
    }
    const ranked = rankOffers(correlated).slice(0, input.maxOffersPerCorridor);
    for (const c of ranked) {
      offers.push(c);
      resolvedOffers.push({ offerId: c.offerKey, transportServiceId: c.transportServiceId });
    }
  }

  return { offers, resolvedOffers };
}

/**
 * Build the `ResolvedOffer[]` evaluation input for a TRANSPORT planning basis from
 * the gathered research evidence. The coordinator/adapter threads this into
 * `evaluateRecoveryStrategy` so the overlay can honor a `SELECT_OFFER` whose
 * service is captured. Pure and deterministic; the SAME derivation the proposer
 * uses, so offer keys always align with the candidates.
 */
export function resolveTransportOffers(input: TransportPassengerSource & {
  world: DomainProposerInput['world'];
  failing: DomainProposerInput['failing'];
  toolResults: readonly PlanningToolResult[];
  now: Instant;
  resolveAirport: AirportResolver;
  maxOffersPerCorridor?: number;
}): { resolvedOffers: ResolvedOffer[]; corridors: TransportCorridor[] } {
  const { corridors } = transportCorridors(input.world, input.failing, {
    resolveAirport: input.resolveAirport,
    ...(input.passengers ? { passengers: input.passengers } : {}),
    ...(input.passengersFor ? { passengersFor: input.passengersFor } : {}),
  });
  const { resolvedOffers } = correlatedTransportOffers({
    corridors,
    toolResults: input.toolResults,
    now: input.now,
    maxOffersPerCorridor: input.maxOffersPerCorridor ?? DEFAULT_MAX_OFFERS_PER_CORRIDOR,
  });
  return { resolvedOffers, corridors };
}

/**
 * Create the concrete generalized TRANSPORT proposer. Returns a
 * `DomainStrategyProposer` the coordinator binds to the TRANSPORT domain via
 * `bindDomainProposer`; it consumes the domain's normalized `flight.search`
 * evidence and emits ranked, bounded `SELECT_OFFER` candidates.
 */
export function createTransportProposer(options: TransportProposerOptions): DomainStrategyProposer {
  const maxOffersPerCorridor = Math.max(1, options.maxOffersPerCorridor ?? DEFAULT_MAX_OFFERS_PER_CORRIDOR);
  return {
    id: TRANSPORT_PROPOSER_ID,
    version: '1',
    domains: [TRANSPORT_DOMAIN],
    async propose(input: DomainProposerInput): Promise<ProposalCandidate[]> {
      const { corridors } = transportCorridors(input.world, [
        ...input.failing,
        ...(input.requestedSubjects ?? []).map((subject) => ({ subject })),
      ], {
        resolveAirport: options.resolveAirport,
        ...(options.passengers ? { passengers: options.passengers } : {}),
        ...(options.passengersFor ? { passengersFor: options.passengersFor } : {}),
      });
      const { offers } = correlatedTransportOffers({
        corridors,
        toolResults: input.evidence.toolResults,
        now: input.now,
        maxOffersPerCorridor,
      });

      const candidates: ProposalCandidate[] = [];
      const emitted = new Set<string>();
      for (const c of offers) {
        const requestCodes = satisfiedRequestConstraints(input.requestContext, c);
        const hard = input.requestContext?.constraints.filter((constraint) => constraint.domain === 'TRANSPORT' && constraint.mode === 'HARD') ?? [];
        if (hard.some((constraint) => !requestCodes.includes(constraint.code))) continue;
        const key = `${TRANSPORT_PROPOSER_ID}:${c.journeyItemId}:${c.offerKey}`;
        if (emitted.has(key)) continue;
        emitted.add(key);
        const affected: TypedRef[] = [
          { kind: 'JOURNEY_ITEM', id: c.journeyItemId },
          { kind: 'JOURNEY', id: c.journeyId },
          { kind: 'OFFER', id: c.offerKey },
        ];
        const route = routeSummary(c.offer);
        candidates.push({
          key,
          effects: [{ effectKind: 'SELECT_OFFER', journeyItemId: c.journeyItemId, offerId: c.offerKey, offerPrice: c.price }],
          affectedSubjectRefs: affected,
          rationale: `Select researched transport offer (${route}, ${c.price.currency} ${c.price.amount}, ${c.segmentCount} segment(s)) for journey item ${c.journeyItemId}; ranked by fewest segments then lowest price. Selection is a proposal — RC-6 decides viability.`,
          assumptions: [
            {
              code: 'selected_service_captured_before_execution',
              description: 'The selected offer must resolve to a transport service captured in the world before the overlay can honor it; a net-new researched offer requires materialization. The proposer never fabricates that service.',
              subjectRef: { kind: 'OFFER', id: c.offerKey },
            },
          ],
          satisfiedRequestConstraintCodes: requestCodes,
        });
      }
      return candidates;
    },
  };
}

/** Deterministic offer-to-request comparison; absence is never treated as a match. */
function satisfiedRequestConstraints(context: RequestPlanningContext | undefined, candidate: CorrelatedOffer): string[] {
  if (!context) return [];
  const target = context.basis.desiredTarget;
  const first = candidate.offer.segments[0];
  const last = candidate.offer.segments[candidate.offer.segments.length - 1];
  if (!first || !last) return [];
  const satisfied = new Set<string>();
  if (target.arriveBy && compareInstants(last.arrival, target.arriveBy) <= 0) satisfied.add('request_arrive_by');
  if (target.departAfter && compareInstants(first.departure, target.departAfter) >= 0) satisfied.add('request_depart_after');
  if (target.transport?.preferDirect === true && candidate.segmentCount === 1) satisfied.add('request_prefer_direct');
  if (target.transport?.earliestDeparture && compareInstants(first.departure, target.transport.earliestDeparture) >= 0) satisfied.add('request_earliest_departure');
  if (target.transport?.latestDeparture && compareInstants(first.departure, target.transport.latestDeparture) <= 0) satisfied.add('request_latest_departure');
  return [...satisfied].sort();
}

/** Factual, provider-neutral route summary for a rationale (no fabrication). */
function routeSummary(offer: FlightOffer): string {
  const first = offer.segments[0];
  const last = offer.segments[offer.segments.length - 1];
  if (!first || !last) return 'unknown route';
  return `${first.origin.value}->${last.destination.value}`;
}

export { journeyItemIdForRequest };
export type { CorrelatedOffer as TransportCorrelatedOffer };

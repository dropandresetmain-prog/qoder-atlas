/**
 * R3 — provider-neutral read-only transport research for the NORMAL target boot.
 *
 * Normal boot composed the accepted R1 coordinator without transport research,
 * so TRANSPORT failed closed in the product runtime even though tests injected
 * it. This module closes that gap by reusing the existing stack — no second
 * engine:
 *
 *   provider config (LIVE | RECORD | REPLAY)
 *     -> the EXISTING Atlas flight adapter (one shared normalization path)
 *     -> the EXISTING read-only dispatchToolRequest vocabulary
 *     -> the EXISTING createPlanningToolTransport bridge
 *     -> the accepted RecoveryPlanningCoordinator transportPlanning dependency
 *
 * Everything injected here is application composition, never model-controlled.
 * Provenance stays truthful end to end: the adapter's mode flows into every
 * PlanningToolResult unchanged (REPLAY evidence says REPLAY), provider failure
 * stays visible FAILED/UNAVAILABLE evidence, and no silent provider fallback
 * exists. Only read-only operations are reachable: the closed ToolOperation
 * vocabulary plus dispatchToolRequest make a consequential booking/payment
 * unrepresentable, and this module widens nothing.
 *
 * No capability is fabricated: when composition cannot honestly supply one, the
 * caller receives `undefined` and the coordinator leaves TRANSPORT unavailable
 * (the frozen fail-closed behaviour).
 *
 * No persona/scenario/route/passenger literal exists here; the search party is
 * resolved per corridor from authoritative state by the resolver in
 * `transportCorridors.ts`, and provider facts live in config/recordings.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool } from '../persistence/postgres/pool.ts';
import type { AppConfig } from '../config/config.ts';
import { hasLiveCredentials } from '../config/config.ts';
import type { ToolDispatchCapabilities } from './dispatch.ts';
import { createPlanningToolTransport } from '../resolution/planning/replayPlanningTransport.ts';
import { travellersForJourneyItemPassengers, type TransportPassengersResolver } from '../resolution/planning/transportCorridors.ts';
import { FileRecordingStore, type RecordingStore } from '../providers/recordingStore.ts';
import { AtlasFlightAdapter } from '../providers/atlas/adapter.ts';
import type { AtlasTimezoneResolver } from '../providers/atlas/normalize.ts';
import type { FareRulesOutcome, FlightOffer, FlightVerifyOutcome } from '../contracts/capabilities.ts';
import type { PlanningToolResult } from '../contracts/v2/planning/planningTool.ts';

/**
 * Resolve an airport code to an IANA timezone from AUTHORITATIVE PostgreSQL
 * places (never a hardcoded offset table, never the retired SQLite store): a
 * place whose IATA/airport-code external ref equals the code contributes its
 * `time_zone`. Unknown codes return undefined so normalization fails honestly.
 *
 * Built per search (lazy) so places promoted after boot normalize honestly —
 * the same lazy contract the accepted composition uses.
 */
export function buildTargetTimezoneResolver(pool: Pool, workspaceId: string): () => Promise<AtlasTimezoneResolver | undefined> {
  return async () => {
    const rows = await pool.query<{ value: string; time_zone: string }>(
      `SELECT r.external_key AS value, p.time_zone
         FROM places p
         JOIN place_external_refs r
           ON r.workspace_id = p.workspace_id AND r.place_id = p.id
        WHERE p.workspace_id = $1
          AND lower(r.provider_namespace) IN ('iata', 'airport-code')
          AND r.external_key <> ''`,
      [workspaceId],
    );
    const byCode = new Map(rows.rows.map((row) => [row.value.toUpperCase(), row.time_zone]));
    return (airportCode: string) => byCode.get(airportCode.toUpperCase());
  };
}

/**
 * The read-only provider research seam handed to the recovery planning
 * coordinator: `transport` fulfils bounded read-only planning requests;
 * `passengersFor` derives the search party per corridor from the captured
 * planning world (authoritative allocations, else the journey's own traveller).
 */
export interface TargetTransportResearch {
  transport: ReturnType<typeof createPlanningToolTransport>;
  passengersFor: TransportPassengersResolver;
}

/**
 * Compose the read-only FLIGHT research seam for normal boot from the shared
 * AppConfig (the same config the legacy root reads, loaded from env). Returns
 * `undefined` — and the coordinator then leaves TRANSPORT unavailable — unless
 * an honest capability can be composed; never invents a provider.
 *
 * The recording store is constructed for every mode because it is the single
 * normalization path; LIVE additionally requires the provider's credentials to
 * be honest, RECORD requires a writable dir, REPLAY requires none.
 */
export function composeTargetTransportResearch(
  config: AppConfig,
  cwd: string,
  timezoneResolverFactory?: () => Promise<AtlasTimezoneResolver | undefined>,
  options: TransportResearchOptions = {},
): TargetTransportResearch | undefined {
  if (!flightCapabilityIsHonest(config)) return undefined;

  const flight = new AtlasFlightAdapter({
    mode: config.adapterMode,
    store: recordingStore(config, cwd),
    ...(timezoneResolverFactory ? { timezoneResolverFactory } : {}),
    ...(config.providers.atlas.baseUrl ? { baseUrl: config.providers.atlas.baseUrl } : {}),
    ...(config.providers.atlas.clientId ? { clientId: config.providers.atlas.clientId } : {}),
    ...(config.providers.atlas.clientSecret ? { clientSecret: config.providers.atlas.clientSecret } : {}),
  });
  const base = createPlanningToolTransport({
    capabilities: { flight } satisfies ToolDispatchCapabilities,
    observedAt: () => new Date().toISOString(),
  });
  return {
    transport: options.offerEnrichment
      ? withOfferEnrichment(base, flight, options.offerEnrichment)
      : base,
    passengersFor: ({ world, journeyId, journeyItemId }) =>
      travellersForJourneyItemPassengers(world, journeyItemId, journeyId),
  };
}

/**
 * When is composing the FLIGHT capability honest?
 *
 * REPLAY/RECORD run from the recording store, so a store is always enough.
 * LIVE would issue real provider traffic: without the provider's credentials
 * the adapter would fail every request at runtime, so composing it would
 * fabricate a capability the composition does not have. Fail closed instead.
 */
function flightCapabilityIsHonest(config: AppConfig): boolean {
  if (config.adapterMode !== 'LIVE') return true;
  return hasLiveCredentials(config, 'atlas');
}

/** Recording store from config paths: read dirs for all modes, write dir for RECORD. */
function recordingStore(config: AppConfig, cwd: string): RecordingStore {
  const readDirs = [config.recordingsDir, join(config.fixturesDir, 'recordings')];
  const scenarioRecordingDirs = readdirSync(join(cwd, config.fixturesDir, 'scenarios'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(config.fixturesDir, 'scenarios', entry.name, 'recordings'));
  return new FileRecordingStore({
    readDirs: [...readDirs, ...scenarioRecordingDirs],
    ...(config.adapterMode === 'RECORD' ? { writeDir: config.recordingsDir } : {}),
  });
}

/**
 * R4 (lane C) � read-only offer enrichment for transport research.
 *
 * `flight.search` alone yields schedule + price. Recovery decisions also need to
 * know whether the offer is still bookable at that price (verify) and what its
 * change / refund / no-show rules are (fare rules). Both are READ-ONLY Atlas
 * operations that already exist on the flight adapter, but the planner only
 * issues `flight.search` up front (it cannot know an offerId beforehand), so the
 * composed research seam performs a bounded follow-up itself, through the same
 * adapter and therefore the same LIVE/RECORD/REPLAY mode and normalization.
 *
 * The enrichment is attached to the search result's `normalizedEvidence` as an
 * additive `offerEnrichment` array. Existing consumers read only `offers`, so
 * nothing else changes; failure of a follow-up is recorded as data (category +
 * code, never provider free text) and never fails the search.
 *
 * Targets the same offers the transport proposer ranks first (fewest segments,
 * then lowest price) so the evidence lands where candidates are drawn from.
 */
export interface OfferEnrichmentOptions {
  /** Upper bound of offers enriched per search (each costs one verify + one fare-rules read). Default 3. */
  maxOffers?: number;
}

export interface TransportResearchOptions {
  /** Absent = no enrichment (pre-R4 behaviour). Present = bounded verify + fare-rule reads per search. */
  offerEnrichment?: OfferEnrichmentOptions;
}

export type OfferEnrichmentFailure = { error: { category: string; code: string } };

export interface OfferEnrichmentEntry {
  offerId: string;
  verification: FlightVerifyOutcome | OfferEnrichmentFailure;
  fareRules: FareRulesOutcome | OfferEnrichmentFailure;
}

export const DEFAULT_ENRICHED_OFFERS = 3;
const RATE_LIMIT_RETRIES = 4;
const PROVIDER_PACE_MS = 700;
const RATE_LIMIT_BACKOFF_MS = 2_000;

type ResearchFlight = Pick<AtlasFlightAdapter, 'verifyOffer' | 'getFareRules'>;

function rankForEnrichment(offers: readonly FlightOffer[], now: number): FlightOffer[] {
  return offers
    .filter((offer) => {
      const first = offer.segments[0];
      return first !== undefined && Date.parse(first.departure) >= now;
    })
    .sort(
      (a, b) =>
        a.segments.length - b.segments.length
        || a.totalPrice.amount - b.totalPrice.amount
        || a.offerId.localeCompare(b.offerId),
    );
}

export function withOfferEnrichment(
  base: TargetTransportResearch['transport'],
  flight: ResearchFlight,
  options: OfferEnrichmentOptions,
  clock: () => number = () => Date.now(),
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): TargetTransportResearch['transport'] {
  const limit = Math.max(1, options.maxOffers ?? DEFAULT_ENRICHED_OFFERS);
  return async (request) => {
    const result: PlanningToolResult = await base(request);
    if (request.operation !== 'flight.search' || result.status !== 'SUCCEEDED') return result;
    const evidence = result.normalizedEvidence as { offers?: FlightOffer[] } | undefined;
    if (!evidence || !Array.isArray(evidence.offers)) return result;

    const targets = rankForEnrichment(evidence.offers, clock()).slice(0, limit);
    const offerEnrichment: OfferEnrichmentEntry[] = [];
    // One bounded retry on provider rate limiting; anything else stays visible data.
    const withRetry = async <T extends { ok: boolean; error?: { category: string } }>(call: () => Promise<T>): Promise<T> => {
      for (let attempt = 0; ; attempt += 1) {
        const outcome = await call();
        if (outcome.ok || outcome.error?.category !== 'RATE_LIMITED' || attempt >= RATE_LIMIT_RETRIES) return outcome;
        await sleep(RATE_LIMIT_BACKOFF_MS * (attempt + 1));
      }
    };
    // Pace real provider traffic (the sandbox rate-limits bursts); REPLAY reads files.
    const paceMs = result.provenance.mode === 'REPLAY' ? 0 : PROVIDER_PACE_MS;
    for (const offer of targets) {
      if (paceMs > 0) await sleep(paceMs);
      const verify = await withRetry(() => flight.verifyOffer({ offerId: offer.offerId }));
      if (paceMs > 0) await sleep(paceMs);
      const rules = await withRetry(() => flight.getFareRules({ offerId: offer.offerId }));
      offerEnrichment.push({
        offerId: offer.offerId,
        verification: verify.ok ? verify.data : { error: { category: verify.error.category, code: verify.error.code } },
        fareRules: rules.ok ? rules.data : { error: { category: rules.error.category, code: rules.error.code } },
      });
    }
    return { ...result, normalizedEvidence: { ...evidence, offerEnrichment } };
  };
}

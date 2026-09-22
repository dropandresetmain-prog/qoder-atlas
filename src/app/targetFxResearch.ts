/**
 * Provider-neutral FX composition for the PostgreSQL target.
 *
 * Organisation FX observations remain first-class persisted evidence in
 * PostgreSQL. They default to CONNECTED unless an explicit source-authority
 * binding says otherwise. Frankfurter is only a dated CONNECTED supplement; the existing
 * LayeredFxRateResolver and deterministic selector retain ownership of
 * freshness, authority and future-rate handling.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AppConfig } from '../config/config.ts';
import type { FactAuthority } from '../domain/common.ts';
import { FxRateEvidenceSchema, type FxRateEvidence } from '../engine/fx.ts';
import { LayeredFxRateResolver } from './fxResolver.ts';
import { FrankfurterFxAdapter } from '../providers/frankfurter/adapter.ts';
import { FileRecordingStore, type RecordingStore } from '../providers/recordingStore.ts';
import { PgArrangementReadQueries } from '../persistence/postgres/queries/pgArrangementReadQueries.ts';
import type { FxObservationHit } from '../contracts/v2/repository/arrangementQueries.ts';
import type { Pool } from '../persistence/postgres/pool.ts';
import type { ScenarioEffect } from '../contracts/v2/scenario/scenarioChange.ts';
import type { CapturedWorld } from '../resolution/world/world.ts';

export interface TargetFxBudgetRates {
  ratesFor(baseCurrency: string, homeCurrency: string): Promise<FxRateEvidence[]>;
}

export interface TargetFxResearch {
  resolver: LayeredFxRateResolver;
  budgetRates: TargetFxBudgetRates;
  metadata: {
    family: 'FX';
    providerId: 'frankfurter';
    mode: AppConfig['adapterMode'];
    budgetDefaultAuthority: 'CONNECTED';
    supplementAuthority: 'CONNECTED';
    authoritativeSourceIds: readonly string[];
  };
}

export interface TargetFxResearchOptions {
  recordingStore?: RecordingStore;
  /** Explicit source authority binding; unlisted persisted sources stay CONNECTED. */
  sourceAuthorities?: Readonly<Record<string, FactAuthority>>;
}

/** Map a persisted FX observation into the existing resolver evidence shape. */
export function mapPgFxObservation(hit: FxObservationHit, authority: FactAuthority = 'CONNECTED'): FxRateEvidence | undefined {
  const rate = Number(hit.rate);
  const parsed = FxRateEvidenceSchema.safeParse({
    id: hit.observationId,
    baseCurrency: hit.baseCurrency,
    homeCurrency: hit.quoteCurrency,
    rate,
    sourceId: hit.sourceId,
    authority,
    observedAt: hit.asOf,
    ...(hit.expiresAt ? { validUntil: hit.expiresAt } : {}),
  });
  return parsed.success ? parsed.data : undefined;
}

/** Read all persisted evidence for a pair; temporal selection remains downstream. */
export function createPgBudgetFxRateReader(
  pool: Pool,
  workspaceId: string,
  options: { sourceAuthorities?: Readonly<Record<string, FactAuthority>> } = {},
): TargetFxBudgetRates {
  const queries = new PgArrangementReadQueries(pool);
  return {
    async ratesFor(baseCurrency, homeCurrency) {
      const rows = await queries.fxObservationsForPair(workspaceId, baseCurrency, homeCurrency);
      return rows
        .map((row) => mapPgFxObservation(row, options.sourceAuthorities?.[row.sourceId] ?? 'CONNECTED'))
        .filter((rate): rate is FxRateEvidence => rate !== undefined);
    },
  };
}

function recordingStore(config: AppConfig, cwd: string): RecordingStore {
  const readDirs = [config.recordingsDir, join(config.fixturesDir, 'recordings')];
  const scenariosRoot = join(cwd, config.fixturesDir, 'scenarios');
  const scenarioDirs: string[] = [];
  try {
    for (const entry of readdirSync(scenariosRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) scenarioDirs.push(join(config.fixturesDir, 'scenarios', entry.name, 'recordings'));
    }
  } catch {
    // A minimal focused composition may not have a scenario directory.
  }
  return new FileRecordingStore({
    readDirs: [...readDirs, ...scenarioDirs],
    ...(config.adapterMode === 'RECORD' ? { writeDir: config.recordingsDir } : {}),
  });
}

/** Compose the existing layered resolver against authoritative PG evidence and Frankfurter. */
export function composeTargetFxResearch(
  config: AppConfig,
  cwd: string,
  pool: Pool,
  workspaceId: string,
  options: TargetFxResearchOptions = {},
): TargetFxResearch {
  const budgetRates = createPgBudgetFxRateReader(pool, workspaceId, options);
  const frankfurter = new FrankfurterFxAdapter({
    mode: config.adapterMode,
    store: options.recordingStore ?? recordingStore(config, cwd),
    ...(config.providers.frankfurter.baseUrl ? { baseUrl: config.providers.frankfurter.baseUrl } : {}),
  });
  const resolver = new LayeredFxRateResolver({
    budgetRates,
    external: {
      quote: (request) => frankfurter.quote(request),
      todayIsoDate: () => new Date().toISOString().slice(0, 10),
    },
  });
  return {
    resolver,
    budgetRates,
    metadata: {
      family: 'FX',
      providerId: 'frankfurter',
      mode: config.adapterMode,
      budgetDefaultAuthority: 'CONNECTED',
      supplementAuthority: 'CONNECTED',
      authoritativeSourceIds: Object.entries(options.sourceAuthorities ?? {})
        .filter(([, authority]) => authority === 'AUTHORITATIVE')
        .map(([sourceId]) => sourceId)
        .sort(),
    },
  };
}

/** One captured FX read per currency pair and planning basis, shared by all alternatives. */
export function createTargetRecoveryCostContext(
  resolver: Pick<LayeredFxRateResolver, 'ratesFor'>,
  clock: () => string = () => new Date().toISOString(),
) {
  const ratesByWorld = new WeakMap<CapturedWorld, Map<string, Promise<FxRateEvidence[]>>>();
  return async (input: { effects: readonly ScenarioEffect[]; basis: { world: CapturedWorld } }) => {
    const world = input.basis.world;
    const journeyIds = new Set<string>();
    const currencies = new Set<string>();
    for (const effect of input.effects) {
      if (effect.effectKind === 'ADD_JOURNEY_STAY') {
        journeyIds.add(effect.journeyId);
        currencies.add(effect.offerPrice.currency);
      } else if (effect.effectKind === 'SELECT_OFFER' || effect.effectKind === 'CANCEL_STAY') {
        const item = world.journeyItems.find((candidate) => candidate.id === effect.journeyItemId);
        if (!item) return undefined;
        journeyIds.add(item.journeyId);
        if (effect.effectKind === 'CANCEL_STAY') currencies.add(effect.cancellationPenalty.currency);
        else if (effect.offerPrice) currencies.add(effect.offerPrice.currency);
      }
    }
    if (!journeyIds.size) {
      // No effect carries a provider price or penalty. Name the comparison
      // currency only when every organisation with a default currency agrees,
      // so a zero total can be stored without inventing a conversion.
      const currencies = new Set(
        world.organisations
          .map((organisation) => organisation.defaultCurrencyCode)
          .filter((currency): currency is string => currency !== null && currency.length > 0),
      );
      if (currencies.size !== 1) return undefined;
      return { homeCurrency: [...currencies][0]!, rates: [], comparedAt: clock() };
    }
    const organisationIds = new Set<string>();
    for (const journeyId of journeyIds) {
      const journey = world.journeys.find((candidate) => candidate.id === journeyId);
      if (!journey?.responsibilityOrganisationId) return undefined;
      organisationIds.add(journey.responsibilityOrganisationId);
    }
    // Multiple payers require an explicit allocation policy. The hero has one;
    // guessing a common currency for unrelated organisations is not permitted.
    if (organisationIds.size !== 1) return undefined;
    const homeCurrency = world.organisations.find((organisation) => organisationIds.has(organisation.id))?.defaultCurrencyCode;
    if (!homeCurrency) return undefined;
    let cache = ratesByWorld.get(world);
    if (!cache) { cache = new Map(); ratesByWorld.set(world, cache); }
    const pending: Promise<FxRateEvidence[]>[] = [];
    for (const currency of currencies) {
      if (currency === homeCurrency) continue;
      const key = `${currency}:${homeCurrency}`;
      let request = cache.get(key);
      if (!request) {
        request = resolver.ratesFor(currency, homeCurrency);
        cache.set(key, request);
      }
      pending.push(request);
    }
    const rates = (await Promise.all(pending)).flat();
    return { homeCurrency, rates, comparedAt: clock() };
  };
}

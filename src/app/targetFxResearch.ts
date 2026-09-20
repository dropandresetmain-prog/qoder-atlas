/**
 * Provider-neutral FX composition for the PostgreSQL target.
 *
 * Organisation FX observations remain first-class authoritative evidence in
 * PostgreSQL. Frankfurter is only a dated CONNECTED supplement; the existing
 * LayeredFxRateResolver and deterministic selector retain ownership of
 * freshness, authority and future-rate handling.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AppConfig } from '../config/config.ts';
import { FxRateEvidenceSchema, type FxRateEvidence } from '../engine/fx.ts';
import { LayeredFxRateResolver } from './fxResolver.ts';
import { FrankfurterFxAdapter } from '../providers/frankfurter/adapter.ts';
import { FileRecordingStore, type RecordingStore } from '../providers/recordingStore.ts';
import { PgArrangementReadQueries } from '../persistence/postgres/queries/pgArrangementReadQueries.ts';
import type { FxObservationHit } from '../contracts/v2/repository/arrangementQueries.ts';
import type { Pool } from '../persistence/postgres/pool.ts';

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
    budgetAuthority: 'AUTHORITATIVE';
    supplementAuthority: 'CONNECTED';
  };
}

export interface TargetFxResearchOptions {
  recordingStore?: RecordingStore;
}

/** Map a persisted organisation FX observation into the existing resolver evidence shape. */
export function mapPgFxObservation(hit: FxObservationHit): FxRateEvidence | undefined {
  const rate = Number(hit.rate);
  const parsed = FxRateEvidenceSchema.safeParse({
    id: hit.observationId,
    baseCurrency: hit.baseCurrency,
    homeCurrency: hit.quoteCurrency,
    rate,
    sourceId: hit.sourceId,
    authority: 'AUTHORITATIVE',
    observedAt: hit.asOf,
    ...(hit.expiresAt ? { validUntil: hit.expiresAt } : {}),
  });
  return parsed.success ? parsed.data : undefined;
}

/** Read all persisted evidence for a pair; temporal selection remains downstream. */
export function createPgBudgetFxRateReader(pool: Pool, workspaceId: string): TargetFxBudgetRates {
  const queries = new PgArrangementReadQueries(pool);
  return {
    async ratesFor(baseCurrency, homeCurrency) {
      const rows = await queries.fxObservationsForPair(workspaceId, baseCurrency, homeCurrency);
      return rows.map(mapPgFxObservation).filter((rate): rate is FxRateEvidence => rate !== undefined);
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
  const budgetRates = createPgBudgetFxRateReader(pool, workspaceId);
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
      budgetAuthority: 'AUTHORITATIVE',
      supplementAuthority: 'CONNECTED',
    },
  };
}

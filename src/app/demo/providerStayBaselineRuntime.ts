/**
 * Runtime composition for the explicit provider stay baseline bootstrap.
 *
 * LIVE/RECORD books at the provider (sandbox credentials required; RECORD
 * writes sanitized captures). REPLAY reproduces a recorded booking from the
 * corpus and moves no money. Nothing here runs unless an operator calls it.
 */
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { hasLiveCredentials, loadConfig, mergeEnvWithDotenvFiles } from '../../config/config.ts';
import { applyDemoProfileToEnv } from '../../config/demoProfiles.ts';
import { NuiteeAdapter } from '../../providers/hotel/nuiteeAdapter.ts';
import { FileRecordingStore } from '../../providers/recordingStore.ts';
import type { Pool } from '../../persistence/postgres/pool.ts';
import type { PgUnitOfWork } from '../../persistence/postgres/pgUnitOfWork.ts';
import { RecoveryResearchConfigurationSchema } from '../composeTargetRecoveryResearch.ts';
import { datasetDirectoryFromEnv } from './datasetLoader.ts';
import { bootstrapProviderStayBaseline, type ProviderStayBaselineResult } from './providerStayBaseline.ts';

export type ProviderStayBaselineRuntimeResult =
  | ProviderStayBaselineResult
  | { ok: false; code: 'NOT_CONFIGURED' | 'PROVIDER_UNAVAILABLE'; message: string };

export async function runProviderStayBaseline(input: {
  pool: Pool;
  uow: () => PgUnitOfWork;
  workspaceId: string;
  actorPrincipalId: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  observedAt?: string;
}): Promise<ProviderStayBaselineRuntimeResult & { mode?: string }> {
  const env = applyDemoProfileToEnv(mergeEnvWithDotenvFiles(input.env ?? process.env));
  const cwd = input.cwd ?? process.cwd();
  const config = loadConfig(env);
  const datasetDirectory = datasetDirectoryFromEnv(env);
  const researchPath = env.NORTHSTAR_RECOVERY_RESEARCH_CONFIG?.trim()
    || (datasetDirectory ? join(datasetDirectory, 'recovery-research.json') : undefined);
  if (!researchPath) return { ok: false, code: 'NOT_CONFIGURED', message: 'no recovery research configuration is available' };
  const parsed = RecoveryResearchConfigurationSchema.safeParse(JSON.parse(await readFile(resolve(cwd, researchPath), 'utf8')));
  const binding = parsed.success ? parsed.data.stayReplacementBinding : undefined;
  if (!binding) return { ok: false, code: 'NOT_CONFIGURED', message: 'recovery research configuration has no stay binding' };
  if (config.adapterMode !== 'REPLAY' && !hasLiveCredentials(config, 'nuitee')) {
    return { ok: false, code: 'PROVIDER_UNAVAILABLE', message: 'Nuitée sandbox credentials are required outside REPLAY' };
  }
  const recordingsDir = resolve(cwd, config.recordingsDir);
  const store = new FileRecordingStore({
    readDirs: [recordingsDir, resolve(cwd, config.fixturesDir, 'recordings')],
    ...(config.adapterMode === 'RECORD' ? { writeDir: recordingsDir } : {}),
  });
  const nuitee = config.providers.nuitee;
  const hotel = new NuiteeAdapter({
    mode: config.adapterMode,
    store,
    ...(nuitee.searchBaseUrl ? { searchBaseUrl: nuitee.searchBaseUrl } : {}),
    ...(nuitee.bookingBaseUrl ? { bookingBaseUrl: nuitee.bookingBaseUrl } : {}),
    ...(nuitee.apiKey ? { apiKey: nuitee.apiKey } : {}),
  });
  const result = await bootstrapProviderStayBaseline({
    pool: input.pool,
    uow: input.uow,
    workspaceId: input.workspaceId,
    actorPrincipalId: input.actorPrincipalId,
    hotel,
    mode: config.adapterMode,
    binding: {
      sourceBookingReference: binding.sourceBookingReference,
      propertyExternalRef: binding.propertyExternalRef,
      guestNationality: binding.passport.guestNationality,
      guests: binding.guests,
    },
    observedAt: input.observedAt ?? new Date().toISOString(),
  });
  return { ...result, mode: config.adapterMode };
}

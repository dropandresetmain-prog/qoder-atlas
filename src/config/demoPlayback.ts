/**
 * Founder video playback — explicit demo-only REPLAY execution of recorded
 * sandbox provider outcomes. Fail closed outside local/dev/demo + REPLAY.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AppConfig } from './config.ts';
import { ATLAS_SANDBOX_HOST } from '../providers/atlas/atlasSandboxHost.ts';
import { isCorpusIsolated } from '../providers/recordingStoreFactory.ts';

export const NORTHSTAR_DEMO_PLAYBACK_ENV = 'NORTHSTAR_DEMO_PLAYBACK';
export const NORTHSTAR_DEMO_PLAYBACK_SPEED_ENV = 'NORTHSTAR_DEMO_PLAYBACK_SPEED';

/** Placeholder Atlas/Nuitée credentials — never used when ADAPTER_MODE=REPLAY. */
export const DEMO_PLAYBACK_PLACEHOLDER_CREDENTIAL = 'demo-playback-not-used-in-replay';

export const DEMO_PLAYBACK_SANDBOX_BASE_URL = `https://${ATLAS_SANDBOX_HOST}/`;

export const DEFAULT_JORDAN_VIDEO_PLAYBACK_CORPUS = 'recordings/jordan-corpus-2026-09-23-cp6-staging';

const ALLOWED_ENVIRONMENTS = new Set<AppConfig['environment']>(['local', 'dev', 'demo']);

export function readDemoPlaybackSpeed(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env[NORTHSTAR_DEMO_PLAYBACK_SPEED_ENV]?.trim();
  if (!raw) return 1;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return parsed;
}

export function isDemoPlaybackRequested(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env[NORTHSTAR_DEMO_PLAYBACK_ENV]?.trim() === '1';
}

/** True when demo playback env gate + runtime config are all satisfied. */
export function isDemoPlaybackActive(
  config: AppConfig,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const requested = config.demoPlayback || isDemoPlaybackRequested(env);
  if (!requested) return false;
  if (!ALLOWED_ENVIRONMENTS.has(config.environment)) return false;
  if (config.adapterMode !== 'REPLAY') return false;
  return true;
}

export function researchModeAllowsProtectedExecution(
  researchMode: string,
  config: AppConfig,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (researchMode === 'RECORD' || researchMode === 'LIVE') return true;
  if (researchMode === 'REPLAY' && isDemoPlaybackActive(config, env)) return true;
  return false;
}

export interface DemoPlaybackPreflight {
  ok: boolean;
  issues: string[];
}

export function evaluateDemoPlaybackPreflight(
  config: AppConfig,
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
): DemoPlaybackPreflight {
  const issues: string[] = [];
  if (!isDemoPlaybackRequested(env)) {
    issues.push(`${NORTHSTAR_DEMO_PLAYBACK_ENV} must be 1`);
    return { ok: false, issues };
  }
  if (!ALLOWED_ENVIRONMENTS.has(config.environment)) {
    issues.push(`APP_ENVIRONMENT must be local, dev, or demo (got ${config.environment})`);
  }
  if (config.adapterMode !== 'REPLAY') {
    issues.push('ADAPTER_MODE must be REPLAY for video playback');
  }
  const corpusRoot = resolve(cwd, config.recordingsDir);
  if (!existsSync(corpusRoot)) {
    issues.push(`RECORDINGS_DIR does not exist: ${config.recordingsDir}`);
  } else if (!isCorpusIsolated(config.recordingsDir, cwd)) {
    issues.push(
      `RECORDINGS_DIR must be an isolated corpus (missing .corpus-isolated in ${config.recordingsDir})`,
    );
  }
  if (config.providers.modelStudio.apiKey?.trim()) {
    issues.push(
      'MODEL_STUDIO_API_KEY must be unset for deterministic playback (disable live Qwen)',
    );
  }
  return { ok: issues.length === 0, issues };
}

export function formatDemoPlaybackPreflightReport(preflight: DemoPlaybackPreflight): string {
  return [
    'Jordan video playback preflight failed.',
    '',
    'Required: NORTHSTAR_DEMO_PLAYBACK=1, APP_ENVIRONMENT=local|dev|demo, ADAPTER_MODE=REPLAY,',
    `isolated RECORDINGS_DIR (default ${DEFAULT_JORDAN_VIDEO_PLAYBACK_CORPUS}), no live Model Studio key.`,
    '',
    ...preflight.issues.map((issue) => `  - ${issue}`),
  ].join('\n');
}

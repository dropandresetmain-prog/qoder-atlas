/**
 * Founder demo profiles — minimal env composition for controlled RECORD runs.
 *
 * REPLAY remains the default when no profile is selected. The `record` profile
 * only adjusts adapter/sandbox markers; it does not bypass execution gates.
 */
import { ATLAS_SANDBOX_HOST } from '../providers/atlas/transactionAdapter.ts';
import { hasLiveCredentials, type AppConfig } from './config.ts';

export const NORTHSTAR_DEMO_PROFILE_ENV = 'NORTHSTAR_DEMO_PROFILE';

/** Env keys forced when `NORTHSTAR_DEMO_PROFILE=record` (founder transactional recording). */
export const RECORD_DEMO_PROFILE_OVERLAY: Readonly<Record<string, string>> = {
  ADAPTER_MODE: 'RECORD',
  ATLAS_ENV: 'sandbox',
  NORTHSTAR_SYNTHETIC_SANDBOX_INPUTS: '1',
};

const RECORD_PROFILE_FORCED_KEYS = Object.keys(RECORD_DEMO_PROFILE_OVERLAY) as (keyof typeof RECORD_DEMO_PROFILE_OVERLAY)[];

export type NorthstarDemoProfile = 'record';

export function resolveNorthstarDemoProfile(
  env: Record<string, string | undefined>,
): NorthstarDemoProfile | undefined {
  const raw = env[NORTHSTAR_DEMO_PROFILE_ENV]?.trim().toLowerCase();
  if (raw === 'record') return 'record';
  return undefined;
}

/**
 * Apply founder demo profile overlays after dotenv merge. Profile-owned keys
 * are forced for `record` so a sticky `ADAPTER_MODE=REPLAY` in `.env.local`
 * cannot accidentally weaken a RECORD founder boot.
 */
export function applyDemoProfileToEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  if (resolveNorthstarDemoProfile(env) !== 'record') {
    return { ...env };
  }
  const out: Record<string, string | undefined> = { ...env };
  for (const key of RECORD_PROFILE_FORCED_KEYS) {
    out[key] = RECORD_DEMO_PROFILE_OVERLAY[key];
  }
  return out;
}

export interface RecordProfilePreflight {
  ok: boolean;
  /** Human-readable missing/invalid configuration lines (no secret values). */
  issues: string[];
}

/**
 * Preflight for founder RECORD boot. Checks sandbox markers and required
 * credential *names* only — values must live in `.env.local`, never in repo.
 */
export function evaluateRecordProfilePreflight(config: AppConfig): RecordProfilePreflight {
  const issues: string[] = [];

  if (config.adapterMode !== 'RECORD') {
    issues.push('ADAPTER_MODE must be RECORD (set NORTHSTAR_DEMO_PROFILE=record or use npm run demo:record)');
  }
  if (config.providers.atlas.env !== 'sandbox') {
    issues.push('ATLAS_ENV must be sandbox (record profile enforces sandbox; no production Atlas host)');
  }

  if (!hasLiveCredentials(config, 'atlas')) {
    issues.push(
      'Atlas sandbox credentials required: ATLAS_BASE_URL, ATLAS_CLIENT_ID, ATLAS_CLIENT_SECRET',
    );
  } else {
    const baseUrl = config.providers.atlas.baseUrl;
    if (baseUrl) {
      try {
        if (new URL(baseUrl).hostname !== ATLAS_SANDBOX_HOST) {
          issues.push(
            `ATLAS_BASE_URL must use sandbox host ${ATLAS_SANDBOX_HOST} (production / non-sandbox hosts are refused at execution)`,
          );
        }
      } catch {
        issues.push('ATLAS_BASE_URL must be a valid absolute URL');
      }
    }
  }

  if (!hasLiveCredentials(config, 'nuitee')) {
    issues.push(
      'Nuitée sandbox credentials required for stay execution: NUITEE_API_KEY (optional NUITEE_SEARCH_BASE_URL / NUITEE_BOOKING_BASE_URL overrides)',
    );
  }

  return { ok: issues.length === 0, issues };
}

export function formatRecordProfilePreflightReport(preflight: RecordProfilePreflight): string {
  const lines = [
    'Jordan founder RECORD profile preflight failed.',
    '',
    'Boundary: Atlas sandbox + Nuitée sandbox only; ADAPTER_MODE=RECORD writes sanitized',
    'provider recordings under RECORDINGS_DIR. Execution uses sandbox test-balance funding —',
    'not production card rails. REPLAY default is unchanged when no profile is set.',
    '',
    'Configure credentials in .env.local (see .env.example and docs/work/JORDAN_FOUNDER_RECORD_PROFILE.md):',
    ...preflight.issues.map((issue) => `  - ${issue}`),
  ];
  return lines.join('\n');
}

/**
 * Generic preflight for acceptance scenario runs.
 *
 * Answers structural readiness questions only. Does not encode scenario
 * business truth (expected outcomes, viability, authority decisions).
 */
import { accessSync, constants, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadConfig, hasLiveCredentials, type AppConfig } from '../config/config.ts';
import {
  loadAcceptanceManifest,
  resolveManifestPath,
  resolvePackPath,
  type AcceptanceManifest,
} from './manifest.ts';
import { adapterModeFor, isSimulatedExternal } from './modes.ts';
import { hashDirectory, hashFile } from './hashes.ts';

export interface PreflightCheck {
  id: string;
  ok: boolean;
  detail: string;
}

export interface PreflightReport {
  ok: boolean;
  manifestPath: string;
  scenarioId: string;
  mode: AcceptanceManifest['mode'];
  adapterMode: ReturnType<typeof adapterModeFor>;
  checks: PreflightCheck[];
  globalInputPackHash?: string;
  localInputPackHash?: string;
}

export interface PreflightOptions {
  manifestPath: string;
  /** Override output/recording directory writability check. */
  recordingsDir?: string;
  evidenceDir?: string;
  cwd?: string;
  config?: AppConfig;
  env?: Record<string, string | undefined>;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T|$)/;
const ROUTE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9 _./-]{0,63}$/;

export function runPreflight(options: PreflightOptions): PreflightReport {
  const cwd = options.cwd ?? process.cwd();
  const manifestPath = resolveManifestPath(options.manifestPath, cwd);
  const checks: PreflightCheck[] = [];

  let manifest: AcceptanceManifest | undefined;
  try {
    manifest = loadAcceptanceManifest(manifestPath);
    checks.push({ id: 'scenario_input_valid', ok: true, detail: `manifest loaded: ${manifest.scenarioId}` });
  } catch (error) {
    checks.push({
      id: 'scenario_input_valid',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      manifestPath,
      scenarioId: 'unknown',
      mode: 'REPLAY',
      adapterMode: 'REPLAY',
      checks,
    };
  }

  const config = options.config ?? loadConfig(options.env ?? process.env, cwd);
  const adapterMode = adapterModeFor(manifest.mode);
  const recordingsDir = options.recordingsDir ?? config.recordingsDir;
  const evidenceDir = options.evidenceDir ?? join(cwd, 'output', 'acceptance');

  // Required env vars (names only — presence, not business meaning).
  for (const name of manifest.requiredEnv) {
    const present = Boolean((options.env ?? process.env)[name] ?? readEnvFromConfig(config, name));
    checks.push({
      id: `env:${name}`,
      ok: present || adapterMode === 'REPLAY' || isSimulatedExternal(manifest.mode),
      detail: present
        ? `${name} present`
        : adapterMode === 'REPLAY' || isSimulatedExternal(manifest.mode)
          ? `${name} absent (allowed for ${manifest.mode})`
          : `${name} missing`,
    });
  }

  // Provider adapter configuration for LIVE/RECORD.
  for (const provider of manifest.requiredProviders) {
    const liveOk = hasLiveCredentials(config, provider);
    const required = adapterMode === 'LIVE' || adapterMode === 'RECORD';
    checks.push({
      id: `provider:${provider}`,
      ok: !required || liveOk,
      detail: liveOk
        ? `${provider} credentials configured`
        : required
          ? `${provider} not configured for ${adapterMode}`
          : `${provider} not required for ${adapterMode}`,
    });
  }

  // Recording / evidence output paths writable.
  checks.push(writableCheck('recordings_path_writable', recordingsDir));
  checks.push(writableCheck('evidence_path_writable', evidenceDir));

  // Global / local input packs exist + version-compatible (path resolves).
  const globalPath = resolvePackPath(manifestPath, manifest.globalInputPack.path);
  const localPath = resolvePackPath(manifestPath, manifest.localInputPack.path);
  const globalOk = existsSync(globalPath);
  const localOk = existsSync(localPath);
  const globalHash = globalOk ? hashDirectory(globalPath) ?? hashFile(globalPath) : undefined;
  const localHash = localOk ? hashDirectory(localPath) ?? hashFile(localPath) : undefined;
  checks.push({
    id: 'global_input_version_compatible',
    ok: globalOk && Boolean(manifest.globalInputPack.version),
    detail: globalOk
      ? `global pack ${manifest.globalInputPack.packId}@${manifest.globalInputPack.version} at ${globalPath}`
      : `global pack missing at ${globalPath}`,
  });
  checks.push({
    id: 'local_input_version_compatible',
    ok: localOk && Boolean(manifest.localInputPack.version),
    detail: localOk
      ? `local pack ${manifest.localInputPack.packId}@${manifest.localInputPack.version} at ${localPath}`
      : `local pack missing at ${localPath}`,
  });

  // Canonical programme loaded (fixture presence — structural).
  const programmePath = join(cwd, config.fixturesDir, 'programmes', 'synthetic-summit', 'programme.json');
  let programme: { context?: { anchorEvent?: { id?: string } }; importDraft?: { travellers?: Array<{ draftId?: string }> } } | undefined;
  if (existsSync(programmePath)) {
    try {
      programme = JSON.parse(readFileSync(programmePath, 'utf8')) as typeof programme;
      checks.push({
        id: 'canonical_programme_loaded',
        ok: Boolean(programme?.context?.anchorEvent?.id),
        detail: `programme fixture present (${programme?.context?.anchorEvent?.id ?? 'no anchor'})`,
      });
    } catch (error) {
      checks.push({
        id: 'canonical_programme_loaded',
        ok: false,
        detail: `programme JSON invalid: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  } else {
    checks.push({
      id: 'canonical_programme_loaded',
      ok: false,
      detail: `programme fixture missing at ${programmePath}`,
    });
  }

  // Target travellers exist in programme drafts (structural id presence).
  if (manifest.expect.travellerIds.length > 0) {
    const draftIds = new Set(
      (programme?.importDraft?.travellers ?? []).map((t) => t.draftId).filter(Boolean) as string[],
    );
    const anchorId = programme?.context?.anchorEvent?.id;
    const missing: string[] = [];
    for (const travellerId of manifest.expect.travellerIds) {
      // Programme travellers use draftId "draft-N"; runtime ids look like
      // trv-{anchor}-draft-N. Preflight only checks structural presence.
      const draftSuffix = travellerId.match(/(draft-\d+)$/)?.[1];
      const ok =
        draftIds.has(travellerId) ||
        (draftSuffix !== undefined && draftIds.has(draftSuffix)) ||
        (anchorId !== undefined && travellerId === `trv-${anchorId}-${draftSuffix ?? ''}`);
      if (!ok) missing.push(travellerId);
    }
    checks.push({
      id: 'target_travellers_exist',
      ok: missing.length === 0,
      detail: missing.length === 0 ? 'all expected traveller ids resolve in programme' : `missing travellers: ${missing.join(', ')}`,
    });
  } else {
    checks.push({
      id: 'target_travellers_exist',
      ok: true,
      detail: 'no traveller expectations declared',
    });
  }

  // Route/date parameters structurally valid.
  const routeIssues: string[] = [];
  for (const [index, route] of manifest.routeParams.entries()) {
    if (route.origin !== undefined && !ROUTE_TOKEN.test(route.origin)) {
      routeIssues.push(`routeParams[${index}].origin structural invalid`);
    }
    if (route.destination !== undefined && !ROUTE_TOKEN.test(route.destination)) {
      routeIssues.push(`routeParams[${index}].destination structural invalid`);
    }
    if (route.date !== undefined && !ISO_DATE.test(route.date)) {
      routeIssues.push(`routeParams[${index}].date structural invalid`);
    }
  }
  checks.push({
    id: 'route_date_structurally_valid',
    ok: routeIssues.length === 0,
    detail: routeIssues.length === 0 ? 'route/date params structurally valid' : routeIssues.join('; '),
  });

  // Expected LIVE/RECORD/SIMULATED boundaries declared.
  const hasBoundaries = manifest.boundaries.length > 0;
  const modes = new Set(manifest.boundaries.map((b) => b.mode));
  checks.push({
    id: 'boundaries_declared',
    ok: hasBoundaries,
    detail: hasBoundaries
      ? `declared seams: ${manifest.boundaries.map((b) => `${b.seam}=${b.mode}`).join(', ')}`
      : 'no LIVE/RECORD/SIMULATED boundaries declared',
  });
  checks.push({
    id: 'boundaries_cover_run_mode',
    ok: modes.has(manifest.mode) || (isSimulatedExternal(manifest.mode) && [...modes].some(isSimulatedExternal)),
    detail: modes.has(manifest.mode)
      ? `run mode ${manifest.mode} appears in boundaries`
      : `run mode ${manifest.mode} not listed in boundaries`,
  });

  return {
    ok: checks.every((c) => c.ok),
    manifestPath,
    scenarioId: manifest.scenarioId,
    mode: manifest.mode,
    adapterMode,
    checks,
    ...(globalHash ? { globalInputPackHash: globalHash } : {}),
    ...(localHash ? { localInputPackHash: localHash } : {}),
  };
}

function writableCheck(id: string, dir: string): PreflightCheck {
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    return { id, ok: true, detail: `${dir} writable` };
  } catch (error) {
    // Also accept parent writable when dir does not yet exist.
    try {
      const parent = dirname(dir);
      mkdirSync(parent, { recursive: true });
      accessSync(parent, constants.W_OK);
      return { id, ok: true, detail: `${parent} writable (will create ${dir})` };
    } catch {
      return {
        id,
        ok: false,
        detail: `not writable: ${dir} (${error instanceof Error ? error.message : String(error)})`,
      };
    }
  }
}

/** Best-effort map of known config-backed env names for presence checks. */
function readEnvFromConfig(config: AppConfig, name: string): string | undefined {
  switch (name) {
    case 'ATLAS_CLIENT_ID':
      return config.providers.atlas.clientId;
    case 'ATLAS_CLIENT_SECRET':
      return config.providers.atlas.clientSecret;
    case 'ATLAS_BASE_URL':
      return config.providers.atlas.baseUrl;
    case 'NUITEE_API_KEY':
      return config.providers.nuitee.apiKey;
    case 'MODEL_STUDIO_API_KEY':
      return config.providers.modelStudio.apiKey;
    case 'GOOGLE_ROUTES_API_KEY':
      return config.providers.googleRoutes.apiKey;
    default:
      return undefined;
  }
}

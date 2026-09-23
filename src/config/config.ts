/**
 * Environment/config loader (F0).
 *
 * Invariants:
 * - The application starts with zero environment variables set (REPLAY/local default).
 * - Optional provider credentials are never required at startup; capability adapters
 *   decide at construction time whether their configured mode needs credentials.
 * - Variable names are frozen here and mirrored in `.env.example` / docs/ENVIRONMENT.md.
 * - Loading precedence: safe defaults → .env → .env.local → process environment.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { applyDemoProfileToEnv } from './demoProfiles.ts';

export const AdapterModeSchema = z.enum(['LIVE', 'RECORD', 'REPLAY']);
export type AdapterMode = z.infer<typeof AdapterModeSchema>;

const AtlasConfigSchema = z.object({
  env: z.string().default('sandbox'),
  baseUrl: z.string().optional(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
});

const ModelStudioConfigSchema = z.object({
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  model: z.string().optional(),
  timeoutMs: z.coerce.number().int().positive().optional(),
});

const OpenRouterConfigSchema = z.object({
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  model: z.string().optional(),
  timeoutMs: z.coerce.number().int().positive().optional(),
});

/**
 * Which model provider backs live intelligence. Model Studio remains the
 * default and the preferred WiT/Alibaba demo provider; OpenRouter is a
 * second first-class option selected explicitly via INTELLIGENCE_PROVIDER.
 * Provider choice never affects deterministic safety/authority — it only
 * selects which client composeRuntime wires into the same planner/research/
 * extraction seams.
 */
export const IntelligenceProviderSchema = z.enum(['model_studio', 'openrouter']);
export type IntelligenceProvider = z.infer<typeof IntelligenceProviderSchema>;

const GoogleRoutesConfigSchema = z.object({
  apiKey: z.string().optional(),
});

const NuiteeConfigSchema = z.object({
  searchBaseUrl: z.string().optional(),
  bookingBaseUrl: z.string().optional(),
  apiKey: z.string().optional(),
});

const FrankfurterConfigSchema = z.object({
  // Public key-less ECB reference-rate API; default points at the real host.
  baseUrl: z.string().optional(),
});

export const WorldSeedModeSchema = z.enum(['full', 'programme']);
export type WorldSeedMode = z.infer<typeof WorldSeedModeSchema>;

export const AppConfigSchema = z.object({
  environment: z.enum(['local', 'dev', 'demo']).default('local'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  adapterMode: AdapterModeSchema.default('REPLAY'),
  httpPort: z.coerce.number().int().positive().max(65535).default(8787),
  sqlitePath: z.string().default('data/app.sqlite'),
  recordingsDir: z.string().default('recordings'),
  fixturesDir: z.string().default('fixtures'),
  /**
   * Optional traveller-surface hero imagery. Empty means no hero image is
   * rendered and the layout falls back to its gradient. Imagery belongs to the
   * configured world, never to generic projection logic.
   */
  uiHeroImage: z.string().optional(),
  uiHeroImageAlt: z.string().optional(),
  /**
   * Optional JSON object mapping a commitment id to the proposal times an
   * organiser is expected to suggest, so one-click review starts from the
   * world's scripted change rather than a blank form. This is a world
   * affordance: unset or malformed means no defaults anywhere.
   */
  programmeChangePresets: z.string().optional(),
  /**
   * Boot/reset world composition. `programme` seeds only programme bundles
   * plus non-harness scenarios; `full` also seeds acceptance-harness scenario
   * trips. When omitted, `demo` environment defaults to `programme`.
   */
  worldSeedMode: WorldSeedModeSchema.optional(),
  /** Live intelligence provider feature flag (defaults to the Alibaba demo path). */
  intelligenceProvider: IntelligenceProviderSchema.default('model_studio'),
  providers: z.object({
    atlas: AtlasConfigSchema.prefault({}),
    modelStudio: ModelStudioConfigSchema.prefault({}),
    openRouter: OpenRouterConfigSchema.prefault({}),
    googleRoutes: GoogleRoutesConfigSchema.prefault({}),
    nuitee: NuiteeConfigSchema.prefault({}),
    frankfurter: FrankfurterConfigSchema.prefault({}),
  }),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

export interface ProgrammeChangePreset {
  startsAt: string;
  endsAt: string;
}

/**
 * Parse world-supplied proposal defaults. Never throws: a malformed value must
 * degrade to no defaults, not fail a live projection.
 */
export function parseProgrammeChangePresets(
  raw: string | undefined,
): Record<string, ProgrammeChangePreset> {
  if (!raw?.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, ProgrammeChangePreset> = {};
    for (const [commitmentId, value] of Object.entries(parsed)) {
      if (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as { startsAt?: unknown }).startsAt === 'string' &&
        typeof (value as { endsAt?: unknown }).endsAt === 'string'
      ) {
        out[commitmentId] = {
          startsAt: (value as { startsAt: string }).startsAt,
          endsAt: (value as { endsAt: string }).endsAt,
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function compactEnvValues(record: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue;
    const trimmed = value.trim();
    if (trimmed === '') continue;
    out[key] = trimmed;
  }
  return out;
}

function overlayEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}

/** Minimal `.env` parser: KEY=VALUE lines, `#` comments, no interpolation. */
export function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function mapEnv(env: Record<string, string | undefined>): Record<string, unknown> {
  const optional = (v: string | undefined): string | undefined => {
    if (v === undefined) return undefined;
    const trimmed = v.trim();
    return trimmed === '' ? undefined : trimmed;
  };
  return {
    environment: optional(env.APP_ENVIRONMENT),
    logLevel: optional(env.LOG_LEVEL),
    adapterMode: optional(env.ADAPTER_MODE),
    // Host PORT (Railway, etc.) wins over HTTP_PORT so the proxy health check matches.
    // Empty/whitespace HTTP_PORT must not displace PORT or force the local 8787 default.
    httpPort: optional(env.PORT) ?? optional(env.HTTP_PORT),
    sqlitePath: optional(env.SQLITE_PATH),
    recordingsDir: optional(env.RECORDINGS_DIR),
    fixturesDir: optional(env.FIXTURES_DIR),
    uiHeroImage: optional(env.UI_HERO_IMAGE),
    uiHeroImageAlt: optional(env.UI_HERO_IMAGE_ALT),
    programmeChangePresets: optional(env.DEMO_PROGRAMME_CHANGE_PRESETS),
    worldSeedMode: optional(env.WORLD_SEED_MODE),
    intelligenceProvider: optional(env.INTELLIGENCE_PROVIDER),
    providers: {
      atlas: {
        env: optional(env.ATLAS_ENV),
        baseUrl: optional(env.ATLAS_BASE_URL),
        clientId: optional(env.ATLAS_CLIENT_ID),
        clientSecret: optional(env.ATLAS_CLIENT_SECRET),
      },
      modelStudio: {
        baseUrl: optional(env.MODEL_STUDIO_BASE_URL),
        apiKey: optional(env.MODEL_STUDIO_API_KEY),
        model: optional(env.MODEL_STUDIO_MODEL),
        timeoutMs: optional(env.MODEL_STUDIO_TIMEOUT_MS),
      },
      openRouter: {
        baseUrl: optional(env.OPENROUTER_BASE_URL),
        apiKey: optional(env.OPENROUTER_API_KEY),
        model: optional(env.OPENROUTER_MODEL),
        timeoutMs: optional(env.OPENROUTER_TIMEOUT_MS),
      },
      googleRoutes: {
        apiKey: optional(env.GOOGLE_ROUTES_API_KEY),
      },
      nuitee: {
        searchBaseUrl: optional(env.NUITEE_SEARCH_BASE_URL),
        bookingBaseUrl: optional(env.NUITEE_BOOKING_BASE_URL),
        apiKey: optional(env.NUITEE_API_KEY),
      },
      frankfurter: {
        baseUrl: optional(env.FRANKFURTER_BASE_URL),
      },
    },
  };
}

/**
 * Raw `.env` then `.env.local` values, including blanks. Callers that need
 * boot convenience should use `mergeEnvWithDotenvFiles` so empty file values
 * do not block a later non-empty `.env.local` or process value.
 */
export function readDotenvFiles(cwd: string = process.cwd()): Record<string, string> {
  let fileEnv: Record<string, string> = {};
  const envPath = resolve(cwd, '.env');
  if (existsSync(envPath)) {
    fileEnv = parseEnvFile(readFileSync(envPath, 'utf8'));
  }
  let localEnv: Record<string, string> = {};
  const envLocalPath = resolve(cwd, '.env.local');
  if (existsSync(envLocalPath)) {
    localEnv = parseEnvFile(readFileSync(envLocalPath, 'utf8'));
  }
  return { ...fileEnv, ...localEnv };
}

/**
 * Merge dotenv files into an env snapshot for target boot (PG_TARGET_* and
 * NORTHSTAR_DEMO_DATASET_DIR included). Precedence: `.env` < `.env.local` <
 * caller env. Empty file values are ignored so `.env.example` blanks do not
 * hide a sticky workspace in `.env.local`. An explicit empty caller value
 * still wins, so tests can suppress a file-configured dataset directory.
 */
export function mergeEnvWithDotenvFiles(
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
): Record<string, string | undefined> {
  return applyDemoProfileToEnv({
    ...compactEnvValues(readDotenvFiles(cwd)),
    ...overlayEnv(env),
  });
}

/**
 * Load configuration.
 *
 * Precedence (lowest → highest):
 *   safe defaults → .env → .env.local → process environment
 *
 * Both `.env` and `.env.local` are optional; the application boots
 * without either. `.env.local` overrides `.env` for the same key;
 * real process environment always wins.
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
): AppConfig {
  // Precedence: defaults < .env < .env.local < process env < demo profile overlay
  const merged = mapEnv(applyDemoProfileToEnv({ ...readDotenvFiles(cwd), ...env }));
  return AppConfigSchema.parse(merged);
}

/** True when the given provider section has enough config for LIVE use. */
export function hasLiveCredentials(
  config: AppConfig,
  provider: 'atlas' | 'modelStudio' | 'openRouter' | 'googleRoutes' | 'nuitee',
): boolean {
  switch (provider) {
    case 'atlas': {
      const a = config.providers.atlas;
      return Boolean(a.baseUrl && a.clientId && a.clientSecret);
    }
    case 'modelStudio': {
      // The model defaults to MODEL_STUDIO_DEFAULT_MODEL inside the client,
      // so the API key alone makes LIVE reachable (mirrors the nuitee rule).
      const m = config.providers.modelStudio;
      return Boolean(m.apiKey);
    }
    case 'openRouter': {
      // Same rule: OPENROUTER_DEFAULT_MODEL/DEFAULT_BASE_URL cover the rest.
      const o = config.providers.openRouter;
      return Boolean(o.apiKey);
    }
    case 'googleRoutes':
      return Boolean(config.providers.googleRoutes.apiKey);
    case 'nuitee':
      // Both base URLs default to the real Nuitee Connect hosts (see the
      // Nuitée adapter), so the API key alone makes LIVE reachable.
      return Boolean(config.providers.nuitee.apiKey);
  }
}

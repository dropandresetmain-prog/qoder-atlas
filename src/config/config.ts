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

const GoogleRoutesConfigSchema = z.object({
  apiKey: z.string().optional(),
});

const NuiteeConfigSchema = z.object({
  searchBaseUrl: z.string().optional(),
  bookingBaseUrl: z.string().optional(),
  apiKey: z.string().optional(),
});

export const AppConfigSchema = z.object({
  environment: z.enum(['local', 'dev', 'demo']).default('local'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  adapterMode: AdapterModeSchema.default('REPLAY'),
  httpPort: z.coerce.number().int().positive().max(65535).default(8787),
  sqlitePath: z.string().default('data/app.sqlite'),
  recordingsDir: z.string().default('recordings'),
  fixturesDir: z.string().default('fixtures'),
  providers: z.object({
    atlas: AtlasConfigSchema.prefault({}),
    modelStudio: ModelStudioConfigSchema.prefault({}),
    googleRoutes: GoogleRoutesConfigSchema.prefault({}),
    nuitee: NuiteeConfigSchema.prefault({}),
  }),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

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
  const optional = (v: string | undefined): string | undefined =>
    v === undefined || v === '' ? undefined : v;
  return {
    environment: optional(env.APP_ENVIRONMENT),
    logLevel: optional(env.LOG_LEVEL),
    adapterMode: optional(env.ADAPTER_MODE),
    httpPort: optional(env.HTTP_PORT),
    sqlitePath: optional(env.SQLITE_PATH),
    recordingsDir: optional(env.RECORDINGS_DIR),
    fixturesDir: optional(env.FIXTURES_DIR),
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
      googleRoutes: {
        apiKey: optional(env.GOOGLE_ROUTES_API_KEY),
      },
      nuitee: {
        searchBaseUrl: optional(env.NUITEE_SEARCH_BASE_URL),
        bookingBaseUrl: optional(env.NUITEE_BOOKING_BASE_URL),
        apiKey: optional(env.NUITEE_API_KEY),
      },
    },
  };
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
  // Precedence: defaults < .env < .env.local < process env
  const merged = mapEnv({ ...fileEnv, ...localEnv, ...env });
  return AppConfigSchema.parse(merged);
}

/** True when the given provider section has enough config for LIVE use. */
export function hasLiveCredentials(
  config: AppConfig,
  provider: 'atlas' | 'modelStudio' | 'googleRoutes' | 'nuitee',
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
    case 'googleRoutes':
      return Boolean(config.providers.googleRoutes.apiKey);
    case 'nuitee':
      // Both base URLs default to the real Nuitee Connect hosts (see the
      // Nuitée adapter), so the API key alone makes LIVE reachable.
      return Boolean(config.providers.nuitee.apiKey);
  }
}

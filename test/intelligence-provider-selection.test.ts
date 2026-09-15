/**
 * OpenRouter provider-neutral seam — proves the provider feature flag,
 * OpenRouter's honest metadata, and that provider choice never affects the
 * deterministic safety boundary or the schema-validation path.
 *
 * These tests deliberately do not boot the full HTTP runtime with a LIVE
 * adapter mode (no existing test does — see integration.r1.test.ts and
 * northstar-convergence.test.ts, both REPLAY-only): `IntelligenceClient`
 * and `AppConfig` are exercised directly, which is where provider identity
 * actually lives, without risking any accidental network reach.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

import {
  AppConfigSchema,
  hasLiveCredentials,
  loadConfig,
} from '../src/config/config.ts';
import {
  IntelligenceClient,
  MODEL_STUDIO_DEFAULT_BASE_URL,
  MODEL_STUDIO_DEFAULT_MODEL,
  MODEL_STUDIO_PROVIDER_ID,
  OPENROUTER_DEFAULT_BASE_URL,
  OPENROUTER_DEFAULT_MODEL,
  OPENROUTER_PROVIDER_ID,
  ScriptedModelTransport,
} from '../src/intelligence/client.ts';
import { composeAppRuntime } from '../src/app/compose.ts';

const EchoSchema = z.strictObject({ message: z.string() });

// ---------------------------------------------------------------------------
// Config: feature flag + OpenRouter variables
// ---------------------------------------------------------------------------

test('config: INTELLIGENCE_PROVIDER defaults to model_studio', () => {
  const config = loadConfig({}, process.cwd());
  assert.equal(config.intelligenceProvider, 'model_studio');
  assert.equal(config.providers.openRouter.apiKey, undefined);
});

test('config: INTELLIGENCE_PROVIDER=openrouter and OPENROUTER_* variables load', () => {
  const config = loadConfig(
    {
      INTELLIGENCE_PROVIDER: 'openrouter',
      OPENROUTER_API_KEY: 'or-key',
      OPENROUTER_BASE_URL: 'https://openrouter.example.com/api/v1',
      OPENROUTER_MODEL: 'meta-llama/llama-3.1-8b-instruct:free',
      OPENROUTER_TIMEOUT_MS: '5000',
    },
    process.cwd(),
  );
  assert.equal(config.intelligenceProvider, 'openrouter');
  assert.equal(config.providers.openRouter.apiKey, 'or-key');
  assert.equal(config.providers.openRouter.baseUrl, 'https://openrouter.example.com/api/v1');
  assert.equal(config.providers.openRouter.model, 'meta-llama/llama-3.1-8b-instruct:free');
  assert.equal(config.providers.openRouter.timeoutMs, 5000);
});

test('config: an invalid INTELLIGENCE_PROVIDER value fails closed at parse time', () => {
  assert.throws(() => loadConfig({ INTELLIGENCE_PROVIDER: 'not-a-real-provider' }, process.cwd()));
});

test('hasLiveCredentials: openRouter follows the same api-key-alone rule as modelStudio', () => {
  const withoutKey = AppConfigSchema.parse({ providers: { openRouter: {} } });
  const withKey = AppConfigSchema.parse({ providers: { openRouter: { apiKey: 'or-key' } } });
  assert.equal(hasLiveCredentials(withoutKey, 'openRouter'), false);
  assert.equal(hasLiveCredentials(withKey, 'openRouter'), true);
});

// ---------------------------------------------------------------------------
// Client: honest provider identity + identical validation across providers
// ---------------------------------------------------------------------------

test('IntelligenceClient: Model Studio remains functional through the shared seam (default provider)', () => {
  const client = new IntelligenceClient({
    apiKey: 'k',
    transport: new ScriptedModelTransport(['{"message":"hi"}']),
  });
  assert.equal(client.providerId, MODEL_STUDIO_PROVIDER_ID);
  assert.equal(client.model, MODEL_STUDIO_DEFAULT_MODEL);
  assert.equal(client.baseUrl, MODEL_STUDIO_DEFAULT_BASE_URL);
});

test('IntelligenceClient: OpenRouter is selected purely by configuration and reports its own identity', async () => {
  const transport = new ScriptedModelTransport(['{"message":"hi"}']);
  const client = new IntelligenceClient({
    providerId: OPENROUTER_PROVIDER_ID,
    apiKey: 'or-key',
    model: OPENROUTER_DEFAULT_MODEL,
    baseUrl: OPENROUTER_DEFAULT_BASE_URL,
    transport,
  });
  assert.equal(client.providerId, OPENROUTER_PROVIDER_ID);
  assert.equal(client.model, OPENROUTER_DEFAULT_MODEL);
  assert.equal(client.baseUrl, OPENROUTER_DEFAULT_BASE_URL);

  const result = await client.call({ id: 'probe', systemPrompt: 's', userPrompt: 'u', schema: EchoSchema });
  assert.equal(result.ok, true);
  if (result.ok) {
    // Runtime status/telemetry must never call an OpenRouter call "model-studio".
    assert.equal(result.meta.providerId, OPENROUTER_PROVIDER_ID);
    assert.equal(result.meta.model, OPENROUTER_DEFAULT_MODEL);
  }
});

test('IntelligenceClient: `openrouter/free` is accepted as a model identifier', () => {
  const client = new IntelligenceClient({ providerId: OPENROUTER_PROVIDER_ID, apiKey: 'k', model: 'openrouter/free' });
  assert.equal(client.model, 'openrouter/free');
});

test('IntelligenceClient: malformed OpenRouter output fails closed exactly like any other provider', async () => {
  const client = new IntelligenceClient({
    providerId: OPENROUTER_PROVIDER_ID,
    apiKey: 'or-key',
    transport: new ScriptedModelTransport(['not json at all']),
  });
  const result = await client.call({ id: 'probe', systemPrompt: 's', userPrompt: 'u', schema: EchoSchema });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.category, 'INVALID_OUTPUT');
    assert.equal(result.error.code, 'model_output_not_json');
  }
});

test('IntelligenceClient: schema-violating OpenRouter output fails closed (no relaxed free-model validation)', async () => {
  const client = new IntelligenceClient({
    providerId: OPENROUTER_PROVIDER_ID,
    apiKey: 'or-key',
    transport: new ScriptedModelTransport(['{"message":42}']),
  });
  const result = await client.call({ id: 'probe', systemPrompt: 's', userPrompt: 'u', schema: EchoSchema });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.category, 'INVALID_OUTPUT');
});

test('IntelligenceClient: OpenRouter NOT_CONFIGURED is honest and never leaks a credential', async () => {
  const client = new IntelligenceClient({ providerId: OPENROUTER_PROVIDER_ID });
  const result = await client.call({ id: 'probe', systemPrompt: 's', userPrompt: 'u', schema: EchoSchema });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.category, 'NOT_CONFIGURED');
    assert.ok(result.error.message.includes('openrouter'));
    assert.ok(!result.error.message.includes('Model Studio'), 'must not claim to be Model Studio');
  }
});

test('IntelligenceClient: OpenRouter auth/network/rate-limit failures surface as structured data, never a throw', async () => {
  const { ModelTransportError } = await import('../src/intelligence/client.ts');
  const client = new IntelligenceClient({
    providerId: OPENROUTER_PROVIDER_ID,
    apiKey: 'or-key',
    transport: new ScriptedModelTransport([
      new ModelTransportError('AUTH', 'model_http_401', 'rejected credentials', false),
    ]),
  });
  const result = await client.call({ id: 'probe', systemPrompt: 's', userPrompt: 'u', schema: EchoSchema });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.category, 'AUTH');
});

// ---------------------------------------------------------------------------
// Runtime composition: REPLAY never calls out, regardless of provider choice
// ---------------------------------------------------------------------------

test('composeAppRuntime: REPLAY stays on the deterministic fallback planner even with OpenRouter selected and "configured"', async () => {
  const config = AppConfigSchema.parse({
    environment: 'local',
    adapterMode: 'REPLAY',
    sqlitePath: ':memory:',
    fixturesDir: 'fixtures',
    intelligenceProvider: 'openrouter',
    providers: {
      atlas: { env: 'sandbox' },
      modelStudio: {},
      openRouter: { apiKey: 'or-key-present-but-must-not-escape-replay' },
      googleRoutes: {},
    },
  });
  const composed = await composeAppRuntime(config);
  assert.equal(
    composed.plannerMode,
    'DETERMINISTIC_FALLBACK',
    'REPLAY must never make an external AI call, even when OpenRouter credentials are present',
  );
});

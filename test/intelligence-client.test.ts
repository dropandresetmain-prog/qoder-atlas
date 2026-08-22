/**
 * D1 — Model Studio structured client tests (T-AI schema/error boundary).
 * Uses saved/scripted model outputs; no live model calls.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

import {
  ModelStudioClient,
  ModelTransportError,
  ScriptedModelTransport,
  parseModelJson,
  toCapabilityErrorCategory,
} from '../src/intelligence/client.ts';

const EchoSchema = z.strictObject({
  message: z.string(),
  confidence: z.number().min(0).max(1).optional(),
});

function liveClient(responses: Array<string | ModelTransportError>, maxAttempts = 2): ModelStudioClient {
  return new ModelStudioClient({
    apiKey: 'sk-live-secret-marker',
    model: 'test-model',
    transport: new ScriptedModelTransport(responses),
    maxAttempts,
  });
}

test('client: constructs without credentials and reports NOT_CONFIGURED structurally', async () => {
  const client = new ModelStudioClient({});
  assert.equal(client.isConfigured(), false);
  const result = await client.call({
    id: 'task_probe',
    systemPrompt: 'sys',
    userPrompt: 'user',
    schema: EchoSchema,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.category, 'NOT_CONFIGURED');
    assert.ok(!result.error.message.includes('sk-'), 'error must not leak credential fragments');
  }
});

test('client: replay transport bypasses credential requirement with identical validation', async () => {
  const transport = new ScriptedModelTransport(['{"message":"saved reply"}']);
  const client = new ModelStudioClient({ transport });
  // Replay mode is explicitly not gated on credentials.
  const result = await client.call({
    id: 'task_replay',
    systemPrompt: 'sys',
    userPrompt: 'user',
    schema: EchoSchema,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.message, 'saved reply');
    assert.equal(result.meta.mode, 'REPLAY');
  }
});

test('client: valid structured output is accepted with meta', async () => {
  const client = liveClient(['{"message":"hello","confidence":0.5}']);
  const result = await client.call({ id: 'task_ok', systemPrompt: 's', userPrompt: 'u', schema: EchoSchema });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value, { message: 'hello', confidence: 0.5 });
    assert.equal(result.meta.model, 'test-model');
    assert.equal(result.meta.attempt, 1);
  }
});

test('client: malformed JSON fails closed without retry', async () => {
  const transport = new ScriptedModelTransport(['this is not JSON at all']);
  const client = new ModelStudioClient({ apiKey: 'k', transport, maxAttempts: 3 });
  const result = await client.call({ id: 'task_bad_json', systemPrompt: 's', userPrompt: 'u', schema: EchoSchema });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.category, 'INVALID_OUTPUT');
    assert.equal(result.error.code, 'model_output_not_json');
  }
  assert.equal(transport.requests.length, 1, 'malformed output must not be retried');
});

test('client: schema-violating output is rejected (fail closed)', async () => {
  const client = liveClient(['{"message":42,"confidence":7}']);
  const result = await client.call({ id: 'task_bad_schema', systemPrompt: 's', userPrompt: 'u', schema: EchoSchema });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.category, 'INVALID_OUTPUT');
});

test('client: unknown extra keys are rejected by strict schemas', async () => {
  const client = liveClient(['{"message":"ok","actionIntents":[]}']);
  const result = await client.call({ id: 'task_extra_keys', systemPrompt: 's', userPrompt: 'u', schema: EchoSchema });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.category, 'INVALID_OUTPUT');
});

test('client: bounded retry succeeds after retryable transport failure', async () => {
  const transport = new ScriptedModelTransport([
    new ModelTransportError('RATE_LIMITED', 'model_rate_limited', 'rate limited', true),
    '{"message":"second attempt"}',
  ]);
  const client = new ModelStudioClient({ apiKey: 'k', transport, maxAttempts: 2 });
  const result = await client.call({ id: 'task_retry', systemPrompt: 's', userPrompt: 'u', schema: EchoSchema });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.message, 'second attempt');
    assert.equal(result.meta.attempt, 2);
  }
  assert.equal(transport.requests.length, 2);
});

test('client: non-retryable transport failure does not retry', async () => {
  const transport = new ScriptedModelTransport([
    new ModelTransportError('AUTH', 'model_http_401', 'rejected credentials', false),
    '{"message":"never reached"}',
  ]);
  const client = new ModelStudioClient({ apiKey: 'k', transport, maxAttempts: 3 });
  const result = await client.call({ id: 'task_auth', systemPrompt: 's', userPrompt: 'u', schema: EchoSchema });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.category, 'AUTH');
  assert.equal(transport.requests.length, 1);
});

test('client: timeout category surfaces as structured TIMEOUT', async () => {
  const client = liveClient([new ModelTransportError('TIMEOUT', 'model_timeout', 'timed out', true)], 1);
  const result = await client.call({ id: 'task_timeout', systemPrompt: 's', userPrompt: 'u', schema: EchoSchema });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.category, 'TIMEOUT');
    assert.equal(result.error.retryable, true);
  }
});

test('client: retry budget is exhausted to a structured error, never a throw', async () => {
  const transport = new ScriptedModelTransport([
    new ModelTransportError('NETWORK', 'model_network', 'down', true),
    new ModelTransportError('NETWORK', 'model_network', 'still down', true),
  ]);
  const client = new ModelStudioClient({ apiKey: 'k', transport, maxAttempts: 2 });
  const result = await client.call({ id: 'task_network', systemPrompt: 's', userPrompt: 'u', schema: EchoSchema });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.category, 'NETWORK');
  assert.equal(transport.requests.length, 2);
});

test('client: error data never contains the API key', async () => {
  const client = liveClient([new ModelTransportError('PROVIDER_ERROR', 'model_http_500', 'boom', true)], 1);
  const result = await client.call({ id: 'task_secret', systemPrompt: 's', userPrompt: 'u', schema: EchoSchema });
  assert.equal(result.ok, false);
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes('sk-live-secret-marker'), 'secret leaked into result data');
});

test('parseModelJson: tolerates fences and prose, returns undefined on garbage', () => {
  assert.deepEqual(parseModelJson('{"a":1}'), { a: 1 });
  assert.deepEqual(parseModelJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseModelJson('Here you go: {"a":1} thanks'), { a: 1 });
  assert.equal(parseModelJson('no json anywhere'), undefined);
  assert.equal(parseModelJson(''), undefined);
});

test('toCapabilityErrorCategory: maps model categories onto the shared envelope', () => {
  assert.equal(toCapabilityErrorCategory('INVALID_OUTPUT'), 'INVALID_REQUEST');
  assert.equal(toCapabilityErrorCategory('NOT_CONFIGURED'), 'NOT_CONFIGURED');
  assert.equal(toCapabilityErrorCategory('TIMEOUT'), 'TIMEOUT');
});

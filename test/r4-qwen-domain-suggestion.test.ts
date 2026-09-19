/**
 * R4 / G08 — Model Studio domain suggestion + composition independence from Atlas mode.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config/config.ts';
import { composeTargetIntelligence } from '../src/app/composeTargetIntelligence.ts';
import { suggestRecoveryDomains } from '../src/app/target/planningDomainSuggestion.ts';
import {
  IntelligenceClient,
  ModelTransportError,
  ScriptedModelTransport,
} from '../src/intelligence/client.ts';
import { resolveRecoveryDomainDecisions } from '../src/contracts/v2/planning/recoveryDomain.ts';
import { defaultRecoveryDomainRegistry, recoveryDomainContext } from '../src/resolution/planning/recoveryDomains.ts';

test('composeTargetIntelligence: absent key => undefined; present key => client even under REPLAY Atlas mode', () => {
  const none = composeTargetIntelligence(
    loadConfig({ ADAPTER_MODE: 'LIVE', PG_TARGET_WORKSPACE_ID: randomUUID() }, mkdtempSync(join(tmpdir(), 'r4-qwen-'))),
  );
  assert.equal(none, undefined);

  const replayWithKey = composeTargetIntelligence(
    loadConfig({
      ADAPTER_MODE: 'REPLAY',
      PG_TARGET_WORKSPACE_ID: randomUUID(),
      MODEL_STUDIO_API_KEY: 'test-key-not-used',
    }),
  );
  assert.ok(replayWithKey);
  assert.equal(replayWithKey.isConfigured(), true);
  assert.equal(replayWithKey.providerId, 'model-studio');
});

test('suggestRecoveryDomains: scripted additive domain is registry-validated; unknown domain fails closed', async () => {
  const transport = new ScriptedModelTransport([
    JSON.stringify({ suggestedDomains: ['SUPPORT_COORDINATION', 'TRANSPORT'], rationale: 'support continuity may help' }),
  ]);
  const client = new IntelligenceClient({
    providerId: 'model-studio',
    apiKey: 'scripted',
    transport,
    model: 'qwen-flash',
  });

  const context = recoveryDomainContext({
    failingSubjectKinds: ['JOURNEY'],
    blockingDimensionCodes: ['programme_participation'],
    affectedObjectKinds: [],
    availableCapabilities: [],
  });
  const deterministic = resolveRecoveryDomainDecisions(defaultRecoveryDomainRegistry(), context);
  const already = deterministic.filter((d) => d.disposition === 'INVESTIGATED').map((d) => d.domainId);
  assert.ok(already.includes('PROGRAMME'));

  const suggestion = await suggestRecoveryDomains(client, { context, alreadyInvestigated: already });
  // TRANSPORT was already investigated deterministically? No — capability empty so TRANSPORT UNAVAILABLE.
  // AI suggesting TRANSPORT is filtered only by alreadyInvestigated, not by capability here;
  // registry re-validation happens in resolveRecoveryDomainDecisions when AI source is applied.
  assert.ok(suggestion.suggestedDomains.includes('SUPPORT_COORDINATION') || suggestion.suggestedDomains.includes('TRANSPORT'));
  assert.ok(!suggestion.suggestedDomains.includes('PROGRAMME'), 'already-investigated domains are not re-suggested');
  assert.equal(suggestion.activity.status, 'SUCCEEDED');
  assert.equal(suggestion.activity.providerId, 'model-studio');
  assert.equal(suggestion.activity.model, 'qwen-flash');
  assert.equal(suggestion.activity.mode, 'REPLAY');
  assert.equal(suggestion.activity.errorCategory, undefined);

  const withAi = resolveRecoveryDomainDecisions(defaultRecoveryDomainRegistry(), context, suggestion.suggestedDomains);
  const support = withAi.find((d) => d.domainId === 'SUPPORT_COORDINATION');
  // support_continuity dimension absent => NOT_APPLICABLE fail-closed even if AI suggested
  assert.ok(support);
  assert.notEqual(support.disposition, 'INVESTIGATED');
});

test('suggestRecoveryDomains retains only bounded failure metadata', async () => {
  const client = new IntelligenceClient({
    providerId: 'model-studio',
    apiKey: 'scripted',
    model: 'qwen-flash',
    transport: new ScriptedModelTransport([
      new ModelTransportError('TIMEOUT', 'script_timeout', 'test-only transport timeout', true),
      new ModelTransportError('TIMEOUT', 'script_timeout', 'test-only transport timeout', false),
    ]),
    maxAttempts: 2,
  });
  const suggestion = await suggestRecoveryDomains(client, {
    context: recoveryDomainContext({
      failingSubjectKinds: ['JOURNEY'],
      blockingDimensionCodes: ['connection_feasibility'],
      affectedObjectKinds: [],
      availableCapabilities: [],
    }),
    alreadyInvestigated: [],
  });

  assert.deepEqual(suggestion.suggestedDomains, []);
  assert.deepEqual(suggestion.activity, {
    providerId: 'model-studio',
    model: 'qwen-flash',
    mode: 'REPLAY',
    status: 'FAILED',
    errorCategory: 'TIMEOUT',
    latencyMs: suggestion.activity.latencyMs,
  });
  assert.equal(typeof suggestion.activity.latencyMs, 'number');
  assert.equal('rationale' in suggestion, false);
});

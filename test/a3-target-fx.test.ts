import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config/config.ts';
import { composeTargetFxResearch, mapPgFxObservation } from '../src/app/targetFxResearch.ts';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';

function hit(overrides: Partial<Parameters<typeof mapPgFxObservation>[0]> = {}) {
  return {
    observationId: 'fx-observation-1',
    baseCurrency: 'USD',
    quoteCurrency: 'SGD',
    rate: '1.2703',
    asOf: '2026-08-25T00:00:00.000Z',
    sourceId: 'org-budget-source',
    edition: '1',
    expiresAt: null,
    ...overrides,
  };
}

test('PG FX observations map to authoritative resolver evidence without inventing dates', () => {
  const mapped = mapPgFxObservation(hit());
  assert.deepEqual(mapped, {
    id: 'fx-observation-1',
    baseCurrency: 'USD',
    homeCurrency: 'SGD',
    rate: 1.2703,
    sourceId: 'org-budget-source',
    authority: 'AUTHORITATIVE',
    observedAt: '2026-08-25T00:00:00.000Z',
  });
  assert.equal(mapPgFxObservation(hit({ rate: 'not-a-rate' })), undefined);
});

test('target FX composition keeps PG budget evidence when Frankfurter replay is unavailable', async () => {
  const db = {
    async query() {
      return {
        rows: [{
          observation_id: 'fx-observation-1',
          base_currency: 'USD',
          quote_currency: 'SGD',
          rate: '1.2703',
          as_of: new Date('2026-08-25T00:00:00.000Z'),
          source_id: 'org-budget-source',
          edition: '1',
          expires_at: null,
        }],
      };
    },
  } as never;
  const recordingStore = { load: async () => undefined, save: async () => undefined };
  const composed = composeTargetFxResearch(
    loadConfig({ ADAPTER_MODE: 'REPLAY', PG_TARGET_WORKSPACE_ID: WORKSPACE }),
    process.cwd(),
    db,
    WORKSPACE,
    { recordingStore },
  );
  const rates = await composed.resolver.ratesFor('USD', 'SGD');
  assert.equal(rates.length, 1);
  assert.equal(rates[0]?.authority, 'AUTHORITATIVE');
  assert.equal(composed.metadata.supplementAuthority, 'CONNECTED');
});

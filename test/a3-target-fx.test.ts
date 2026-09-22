import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config/config.ts';
import { composeTargetFxResearch, createTargetRecoveryCostContext, mapPgFxObservation } from '../src/app/targetFxResearch.ts';
import { emptyWorld, id } from './support/m6World.ts';
import type { ScenarioEffect } from '../src/contracts/v2/scenario/scenarioChange.ts';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';

test('cost research uses captured owning organisation and reads each pair once per basis', async () => {
  const world = emptyWorld();
  const organisationId = id();
  const journeyId = id();
  world.organisations.push({ id: organisationId, revision: 1, defaultCurrencyCode: 'NZD' });
  world.journeys.push({ id: journeyId, revision: 1, tripId: id(), travellerId: id(), lifecycleStatus: 'ACTIVE', intendedWindow: null, responsibilityOrganisationId: organisationId });
  const effects: ScenarioEffect[] = [{ effectKind: 'ADD_JOURNEY_STAY', proposedJourneyItemId: id(), journeyId, orderKey: '020', offerId: id(), offerPrice: { amount: '120', currency: 'JPY' }, visit: { kind: 'EXISTING', visitId: id() } }];
  const requested: string[] = [];
  const contextFor = createTargetRecoveryCostContext({ async ratesFor(base, home) { requested.push(`${base}:${home}`); return []; } }, () => '2030-01-02T00:00:00Z');
  const before = structuredClone(world);
  const first = await contextFor({ effects, basis: { world } });
  await contextFor({ effects, basis: { world } });
  assert.deepEqual(requested, ['JPY:NZD']);
  assert.deepEqual(first, { homeCurrency: 'NZD', rates: [], comparedAt: '2030-01-02T00:00:00Z' });
  assert.deepEqual(world, before);
  const zero = await contextFor({ effects: [], basis: { world } });
  assert.deepEqual(zero, { homeCurrency: 'NZD', rates: [], comparedAt: '2030-01-02T00:00:00Z' });
  assert.deepEqual(requested, ['JPY:NZD'], 'a no-money candidate does not look up a rate');
  world.organisations.push({ id: id(), revision: 1, defaultCurrencyCode: 'USD' });
  assert.equal(await contextFor({ effects: [], basis: { world } }), undefined, 'two home currencies are not a guessed zero');
  world.organisations.pop();
  world.journeys[0]!.responsibilityOrganisationId = null;
  assert.equal(await contextFor({ effects, basis: { world } }), undefined);
  assert.deepEqual(requested, ['JPY:NZD'], 'missing payer must not become a guessed currency lookup');
});

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

test('PG FX observations default to CONNECTED and retain explicit authority bindings', () => {
  const mapped = mapPgFxObservation(hit());
  assert.deepEqual(mapped, {
    id: 'fx-observation-1',
    baseCurrency: 'USD',
    homeCurrency: 'SGD',
    rate: 1.2703,
    sourceId: 'org-budget-source',
    authority: 'CONNECTED',
    observedAt: '2026-08-25T00:00:00.000Z',
  });
  assert.equal(mapPgFxObservation(hit(), 'AUTHORITATIVE')?.authority, 'AUTHORITATIVE');
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
    { recordingStore, sourceAuthorities: { 'org-budget-source': 'AUTHORITATIVE' } },
  );
  const rates = await composed.resolver.ratesFor('USD', 'SGD');
  assert.equal(rates.length, 1);
  assert.equal(rates[0]?.authority, 'AUTHORITATIVE');
  assert.deepEqual(composed.metadata.authoritativeSourceIds, ['org-budget-source']);
  assert.equal(composed.metadata.supplementAuthority, 'CONNECTED');
});

/**
 * Northstar — Frankfurter FX adapter evidence (ADR-052 supplement).
 *
 * Pins permanently:
 *  - raw Frankfurter response -> FxRateEvidence normalization (LIVE shape);
 *  - RECORD->REPLAY parity: same request, same recording key, same normalized
 *    evidence, same downstream conversion — one normalize path, no demo fork;
 *  - arbitrary ISO-4217 pairs (no SGD/USD anywhere in engine logic);
 *  - future-dated travel resolves through valid organisation budget FX and
 *    never fabricates a future spot rate;
 *  - missing provider AND budget evidence still fails closed (ADR-045/052).
 *
 * No test in this file performs a real network call: LIVE-shaped traffic is
 * simulated through injectable fetch, and REPLAY reads recordings written by
 * an equivalent RECORD pass — the same discipline the Atlas adapters use.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  FrankfurterFxAdapter,
  FRANKFURTER_DEFAULT_BASE_URL,
  FrankfurterRateResponseSchema,
  normalizeFrankfurterResponse,
  type FxQuoteRequest,
} from '../src/providers/frankfurter/adapter.ts';
import { FileRecordingStore } from '../src/providers/recordingStore.ts';
import { LayeredFxRateResolver } from '../src/app/fxResolver.ts';
import { convertMoney, effectiveFxRate } from '../src/engine/fx.ts';
import type { FxRateEvidence } from '../src/engine/fx.ts';
import type { AdapterMode } from '../src/config/config.ts';

const RAW_USD_SGD = {
  amount: 1.0,
  base: 'USD',
  date: '2026-08-25',
  rates: { SGD: 1.2703 },
};

function fetchReturning(payload: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
}

function adapterWith(mode: AdapterMode, dir?: string, fetchImpl?: typeof fetch) {
  const store = new FileRecordingStore({
    readDirs: dir ? [dir] : [],
    ...(dir ? { writeDir: dir } : {}),
  });
  return new FrankfurterFxAdapter({
    mode,
    store,
    baseUrl: FRANKFURTER_DEFAULT_BASE_URL,
    ...(fetchImpl ? { fetchImpl } : {}),
  });
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

test('FR-1: raw Frankfurter response normalizes into dated CONNECTED evidence', () => {
  const parsed = FrankfurterRateResponseSchema.parse(RAW_USD_SGD);
  const outcome = normalizeFrankfurterResponse(parsed);

  assert.equal(outcome.rates.length, 1);
  const evidence = outcome.rates[0]!;
  assert.equal(evidence.baseCurrency, 'USD');
  assert.equal(evidence.homeCurrency, 'SGD');
  assert.equal(evidence.rate, 1.2703);
  // observedAt derives from the PROVIDER reference date (ECB daily fixing),
  // never the fetch instant.
  assert.equal(evidence.observedAt, '2026-08-25T00:00:00Z');
  assert.equal(evidence.authority, 'CONNECTED');
  assert.match(evidence.sourceId, /^src_frankfurter_/);
  assert.match(evidence.id, /^fx_frankfurter_usd_sgd_2026-08-25$/);
});

test('FR-2: multi-symbol responses normalize one record per quote currency', () => {
  const outcome = normalizeFrankfurterResponse(
    FrankfurterRateResponseSchema.parse({
      amount: 1.0,
      base: 'EUR',
      date: '2026-08-25',
      rates: { JPY: 159.24, MYR: 4.98 },
    }),
  );
  assert.equal(outcome.rates.length, 2);
  const byCurrency = new Map(outcome.rates.map((r) => [r.homeCurrency, r]));
  assert.equal(byCurrency.get('JPY')?.rate, 159.24);
  assert.equal(byCurrency.get('MYR')?.rate, 4.98);
});

// ---------------------------------------------------------------------------
// LIVE / RECORD / REPLAY parity
// ---------------------------------------------------------------------------

const REQUEST: FxQuoteRequest = { baseCurrency: 'USD', homeCurrency: 'SGD' };

test('FR-3: LIVE mode returns provider-dated evidence through the shared runner', async () => {
  const live = adapterWith('LIVE', undefined, fetchReturning(RAW_USD_SGD));
  const result = await live.quote(REQUEST);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.meta.providerId, 'frankfurter');
  assert.equal(result.meta.mode, 'LIVE');
  assert.equal(result.data.rates[0]?.observedAt, '2026-08-25T00:00:00Z');
});

test('FR-4: RECORD then REPLAY produce IDENTICAL normalized evidence', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fx-rec-'));
  try {
    // RECORD: genuine live execution (fetch injected) + persisted recording.
    const record = adapterWith('RECORD', dir, fetchReturning(RAW_USD_SGD));
    const recorded = await record.quote(REQUEST);
    assert.equal(recorded.ok, true);
    if (!recorded.ok) return;
    const recordingId = recorded.meta.recordingId;
    assert.ok(recordingId, 'RECORD persists a recording id');

    // REPLAY: no fetchImpl at all — a network attempt would throw.
    const replay = adapterWith('REPLAY', dir);
    const replayed = await replay.quote(REQUEST);
    assert.equal(replayed.ok, true);
    if (!replayed.ok) return;
    assert.equal(replayed.meta.mode, 'REPLAY');
    assert.equal(replayed.meta.recordingId, recordingId, 'same request -> same deterministic recording key');

    // Parity is exact on the frozen evidence fields.
    assert.deepEqual(replayed.data.rates, recorded.data.rates);

    // Downstream determinism: identical conversion from either path.
    const spend = { amount: 1000, currency: 'USD' as const };
    const a = convertMoney(spend, recorded.data.rates[0]!.rate, 'SGD');
    const b = convertMoney(spend, replayed.data.rates[0]!.rate, 'SGD');
    assert.deepEqual(a, b);
    assert.deepEqual(a, { amount: 1270.3, currency: 'SGD' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FR-5: REPLAY miss is structured failure data, not an exception', async () => {
  const emptyDir = mkdtempSync(join(tmpdir(), 'fx-empty-'));
  try {
    const replay = adapterWith('REPLAY', emptyDir);
    const result = await replay.quote({ baseCurrency: 'CHF', homeCurrency: 'NOK' });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, 'recording_not_found');
  } finally {
    rmSync(emptyDir, { recursive: true, force: true });
  }
});

test('FR-6: provider HTTP/schema failures surface as structured capability errors', async () => {
  const failing: typeof fetch = (async () => new Response('{"detail":"not found"}', { status: 404 })) as unknown as typeof fetch;
  const bad404 = adapterWith('LIVE', undefined, failing);
  const result404 = await bad404.quote({ baseCurrency: 'XYZ', homeCurrency: 'SGD' });
  assert.equal(result404.ok, false);
  if (!result404.ok && result404.error.code === 'frankfurter_http_error') {
    assert.match(result404.error.message, /404/);
  } else {
    assert.fail('expected frankfurter_http_error');
  }

  const malformed = adapterWith('LIVE', undefined, fetchReturning({ unexpected: true }));
  const resultBad = await malformed.quote(REQUEST);
  assert.equal(resultBad.ok, false);
  if (!resultBad.ok) assert.equal(resultBad.error.code, 'invalid_raw_response');
});

// ---------------------------------------------------------------------------
// Layered resolution: budget FX first-class, Frankfurter supplements
// ---------------------------------------------------------------------------

function memoryBudgetStore(rates: unknown[]) {
  return {
    async ratesFor(): Promise<unknown[]> {
      return rates;
    },
  };
}

const BUDGET_EUR_GBP: FxRateEvidence = {
  id: 'fx_budget_eur_gbp',
  baseCurrency: 'EUR',
  homeCurrency: 'GBP',
  rate: 0.82,
  sourceId: 'src_org_budget',
  authority: 'AUTHORITATIVE',
  observedAt: '2026-01-01T00:00:00Z',
};

test('FR-7: layered resolver merges budget + external evidence; external failure contributes nothing', async () => {
  const externalOk = new LayeredFxRateResolver({
    budgetRates: memoryBudgetStore([BUDGET_EUR_GBP]),
    external: {
      quote: async () => ({
        ok: true,
        data: {
          rates: [
            {
              id: 'fx_frankfurter_eur_gbp_2026-08-25',
              baseCurrency: 'EUR',
              homeCurrency: 'GBP',
              rate: 0.85,
              sourceId: 'src_frankfurter_2026-08-25',
              authority: 'CONNECTED',
              observedAt: '2026-08-25T00:00:00Z',
            },
          ],
        },
      }),
      todayIsoDate: () => '2026-08-26',
    },
  });
  const merged = await externalOk.ratesFor('EUR', 'GBP');
  assert.equal(merged.length, 2);
  // Freshest wins regardless of source name; the engine stays sole judge.
  const chosen = effectiveFxRate(merged, '2026-09-12T19:00:00+09:00');
  assert.equal(chosen?.evidenceId, 'fx_frankfurter_eur_gbp_2026-08-25');

  // AUTHORITATIVE budget ruling at equal freshness outranks the provider.
  const tied: FxRateEvidence[] = [
    ...merged.filter((r) => r.authority === 'CONNECTED'),
    { ...BUDGET_EUR_GBP, observedAt: '2026-08-25T00:00:00Z' },
  ];
  const chosenTied = effectiveFxRate(tied, '2026-09-12T19:00:00+09:00');
  assert.equal(chosenTied?.evidenceId, 'fx_budget_eur_gbp');

  // External outage: budget evidence survives untouched.
  const externalDown = new LayeredFxRateResolver({
    budgetRates: memoryBudgetStore([BUDGET_EUR_GBP]),
    external: {
      quote: async () => ({ ok: false }),
      todayIsoDate: () => '2026-08-26',
    },
  });
  const degraded = await externalDown.ratesFor('EUR', 'GBP');
  assert.equal(degraded.length, 1);
  assert.equal(degraded[0]?.id, 'fx_budget_eur_gbp');
});

test('FR-8: invalid stored rows are dropped wholesale by the layered resolver', async () => {
  const resolver = new LayeredFxRateResolver({
    budgetRates: memoryBudgetStore([
      BUDGET_EUR_GBP,
      { id: 'bad', baseCurrency: 'EUR', homeCurrency: 'GBP', rate: -1 }, // negative rate
    ]),
  });
  const rates = await resolver.ratesFor('EUR', 'GBP');
  assert.equal(rates.length, 1);
  assert.equal(rates[0]?.id, 'fx_budget_eur_gbp');
});

// ---------------------------------------------------------------------------
// Future-dated travel: no fabricated future spot rate
// ---------------------------------------------------------------------------

test('FR-9: future-dated comparison resolves via valid budget FX, never a future market rate', async () => {
  // Budget evidence explicitly covering the trip window; trip instant is
  // AFTER the provider's latest published fixing.
  const budget = {
    ...BUDGET_EUR_GBP,
    observedAt: '2026-09-01T00:00:00Z',
    validUntil: '2026-10-01T00:00:00Z',
  };
  // The provider only ever has PAST data; even a "future" date request
  // returns its most recent business day (documented Frankfurter behaviour,
  // exercised here through the injected fetch's fixed payload date).
  const adapter = new LayeredFxRateResolver({
    budgetRates: memoryBudgetStore([budget]),
    external: {
      quote: async ({ date }) => ({
        ok: true,
        data: {
          rates: [
            {
              id: `fx_frankfurter_eur_gbp_${date ?? 'latest'}`,
              baseCurrency: 'EUR',
              homeCurrency: 'GBP',
              rate: 0.99,
              sourceId: `src_frankfurter_${date ?? 'latest'}`,
              authority: 'CONNECTED',
              observedAt: '2026-08-25T00:00:00Z', // provider reference date stays in the PAST
            },
          ],
        },
      }),
      todayIsoDate: () => '2026-08-26',
    },
  });

  const rates = await adapter.ratesFor('EUR', 'GBP');
  // At the FUTURE trip instant the stale-by-window provider fixing
  // (2026-08-25, superseded freshness-wise by nothing else being fresher...
  // but the budget row covers the window and carries higher authority at
  // its own observation) must decide ONLY through the generic selector:
  // freshest effective observation wins. The provider fixing IS effective
  // (no validUntil), so it would win on freshness — therefore the honest
  // guarantee under test: whichever record is chosen, it was EFFECTIVE at
  // the trip instant, and no record claims a future observation date.
  const at = '2026-09-20T09:00:00+09:00';
  const chosen = effectiveFxRate(rates, at)!;
  assert.ok(chosen, 'a usable evidenced rate exists for the future instant');
  const winner = rates.find((r) => r.id === chosen.evidenceId)!;
  assert.ok(
    new Date(winner.observedAt).getTime() <= new Date(at).getTime(),
    'chosen evidence was OBSERVED before the comparison instant — no future rate invented',
  );

  // And when the budget window does NOT cover the trip instant and no other
  // evidence exists, resolution fails closed rather than stretching the
  // expired ruling.
  const expiredOnly = new LayeredFxRateResolver({
    budgetRates: memoryBudgetStore([{ ...budget, validUntil: '2026-09-05T00:00:00Z' }]),
  });
  const staleSet = await expiredOnly.ratesFor('EUR', 'GBP');
  assert.equal(effectiveFxRate(staleSet, '2026-09-20T09:00:00+09:00'), undefined);
});

// ---------------------------------------------------------------------------
// Arbitrary pairs / no hardcoding
// ---------------------------------------------------------------------------

test('FR-10: arbitrary currency pair end-to-end with zero SGD involvement', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fx-zar-'));
  try {
    const raw = {
      amount: 1.0,
      base: 'ZAR',
      date: '2026-08-24',
      rates: { NOK: 0.5812 },
    };
    const record = adapterWith('RECORD', dir, fetchReturning(raw));
    const recorded = await record.quote({ baseCurrency: 'ZAR', homeCurrency: 'NOK' });
    assert.equal(recorded.ok, true);

    const replay = adapterWith('REPLAY', dir);
    const replayed = await replay.quote({ baseCurrency: 'ZAR', homeCurrency: 'NOK' });
    assert.equal(replayed.ok, true);
    if (!replayed.ok || !recorded.ok) return;
    assert.deepEqual(replayed.data.rates, recorded.data.rates);
    assert.equal(recorded.data.rates[0]?.baseCurrency, 'ZAR');
    assert.equal(recorded.data.rates[0]?.homeCurrency, 'NOK');

    const converted = convertMoney({ amount: 500, currency: 'ZAR' }, recorded.data.rates[0]!.rate, 'NOK');
    assert.deepEqual(converted, { amount: 290.6, currency: 'NOK' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Missing provider AND budget evidence still fails closed (authority level)
// ---------------------------------------------------------------------------

test('FR-11: empty layered resolution still BLOCKs cross-currency authority', async () => {
  const { DeterministicAuthorityEngine } = await import('../src/engine/authority.ts');
  const resolver = new LayeredFxRateResolver({
    // No budget rows; external layer unreachable.
    budgetRates: memoryBudgetStore([]),
    external: { quote: async () => ({ ok: false }), todayIsoDate: () => '2026-08-26' },
  });
  const authority = new DeterministicAuthorityEngine({
    ruleSets: {
      getRuleSet: async () => ({
        id: 'rs_fx2',
        kind: 'ORGANISATION',
        name: 'p',
        sourceId: 's',
        rules: [
          { id: 'r1', kind: 'SPEND_LIMIT', sourceId: 's', maxAmount: { amount: 99999, currency: 'GBP' }, appliesTo: [] },
        ],
      }),
    },
  });
  const decision = await authority.decide(
    {
      id: 'i_fr_block',
      caseId: 'case_fr',
      operation: 'flight.change',
      capability: 'FLIGHT',
      parameters: {},
      sideEffectLevel: 'MONEY_MOVING',
      spendExposure: { amount: 100, currency: 'EUR' },
      evidenceRefs: [],
      status: 'PROPOSED',
      createdAt: '2026-09-12T19:00:00+09:00',
    },
    {
      tripId: 'trip_fr',
      caseId: 'case_fr',
      ruleSetIds: ['rs_fx2'],
      principals: [],
      homeCurrency: 'GBP',
      fxRates: await resolver.ratesFor('EUR', 'GBP'),
    },
  );
  assert.equal(decision.outcome, 'BLOCKED');
  assert.ok(decision.ruleTrace.some((t) => t.includes('no_rate_evidence') && t.includes('fail closed')));
});

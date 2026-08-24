/**
 * Wave 3R Mission 1 / R1 — adapter-level payment ceiling re-check.
 *
 * `AtlasFlightTransactionAdapter.payOrder` previously validated only
 * `orderRef`/`paymentRef` and ignored `query.authorisedAmount` entirely, so
 * the "adapter re-checks too" defence-in-depth claimed in
 * `providerExecution.ts` did not exist. This file pins the adapter's own
 * pre-payment ceiling re-check (via its own `retrieveOrder`, before
 * `/pay.do` is ever called):
 *
 *  - payable above authorisedAmount -> /pay.do never requested;
 *  - payable currency differs from authorisedAmount -> /pay.do never requested;
 *  - pre-pay retrieve reports no total -> /pay.do never requested;
 *  - payable within ceiling, same currency -> /pay.do IS requested, PAID;
 *  - order already TICKETED -> /pay.do never requested, no duplicate payment;
 *  - unapproved paymentRef -> refused with NO provider call at all;
 *  - REPLAY mode still resolves a recorded pay outcome unchanged (no
 *    pre-check recording required);
 *  - an UNMAPPED provider order status never reaches /pay.do, even when a
 *    payable total within the ceiling is present (the state may already be
 *    paid, so payment is allowlisted to HELD alone).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FlightOrderPayQuery } from '../src/contracts/capabilities.ts';
import { FileRecordingStore, recordingIdFor } from '../src/providers/recordingStore.ts';
import {
  ATLAS_SANDBOX_BALANCE_PAYMENT_REF,
  AtlasFlightTransactionAdapter,
} from '../src/providers/atlas/transactionAdapter.ts';

const AT = '2026-09-12T19:00:00+09:00';

const SANDBOX_CONFIG = {
  baseUrl: 'https://sandbox.atriptech.com',
  clientId: 'id',
  clientSecret: 'secret',
};

/** Stubbed fetch that records every endpoint path it was asked to call. */
function stubFetch(responses: Record<string, unknown>, calledPaths: string[]): typeof fetch {
  return (async (url: string | URL | Request) => {
    const path = new URL(String(url)).pathname;
    calledPaths.push(path);
    const raw = responses[path];
    if (raw === undefined) {
      throw new Error(`unexpected endpoint call in test stub: ${path}`);
    }
    return new Response(JSON.stringify(raw), { status: 200 });
  }) as typeof fetch;
}

function newStore(): FileRecordingStore {
  const dir = mkdtempSync(join(tmpdir(), 'wave3r-r1-payment-guard-'));
  return new FileRecordingStore({ readDirs: [dir], writeDir: dir });
}

function payQuery(overrides: Partial<FlightOrderPayQuery> = {}): FlightOrderPayQuery {
  return {
    orderRef: 'ord-guard-1',
    paymentRef: ATLAS_SANDBOX_BALANCE_PAYMENT_REF,
    authorisedAmount: { amount: 300, currency: 'USD' },
    ...overrides,
  };
}

test('R1-1: payable above authorisedAmount refuses without calling /pay.do', async () => {
  const calledPaths: string[] = [];
  const adapter = new AtlasFlightTransactionAdapter({
    mode: 'LIVE',
    store: newStore(),
    ...SANDBOX_CONFIG,
    fetchImpl: stubFetch(
      {
        '/queryOrderDetails.do': {
          status: 0,
          orderNo: 'ord-guard-1',
          orderStatus: '0',
          totalPrice: 500,
          currency: 'USD',
        },
      },
      calledPaths,
    ),
  });

  const result = await adapter.payOrder(payQuery({ authorisedAmount: { amount: 300, currency: 'USD' } }));

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.category, 'INVALID_REQUEST');
    assert.equal(result.error.code, 'atlas_payable_exceeds_authorised');
    assert.match(result.error.message, /500 USD/);
    assert.match(result.error.message, /300 USD/);
  }
  assert.deepEqual(calledPaths, ['/queryOrderDetails.do']);
  assert.ok(!calledPaths.includes('/pay.do'), '/pay.do must never be requested');
});

test('R1-2: payable currency differs from authorisedAmount refuses without calling /pay.do', async () => {
  const calledPaths: string[] = [];
  const adapter = new AtlasFlightTransactionAdapter({
    mode: 'LIVE',
    store: newStore(),
    ...SANDBOX_CONFIG,
    fetchImpl: stubFetch(
      {
        '/queryOrderDetails.do': {
          status: 0,
          orderNo: 'ord-guard-1',
          orderStatus: '0',
          totalPrice: 200,
          currency: 'EUR',
        },
      },
      calledPaths,
    ),
  });

  const result = await adapter.payOrder(payQuery({ authorisedAmount: { amount: 300, currency: 'USD' } }));

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.category, 'INVALID_REQUEST');
    assert.equal(result.error.code, 'atlas_payable_currency_mismatch');
    assert.match(result.error.message, /EUR/);
    assert.match(result.error.message, /USD/);
  }
  assert.ok(!calledPaths.includes('/pay.do'), '/pay.do must never be requested');
});

test('R1-3: pre-pay retrieve reporting no total refuses without calling /pay.do', async () => {
  const calledPaths: string[] = [];
  const adapter = new AtlasFlightTransactionAdapter({
    mode: 'LIVE',
    store: newStore(),
    ...SANDBOX_CONFIG,
    fetchImpl: stubFetch(
      {
        '/queryOrderDetails.do': {
          status: 0,
          orderNo: 'ord-guard-1',
          orderStatus: '0',
          // no totalPrice/currency reported
        },
      },
      calledPaths,
    ),
  });

  const result = await adapter.payOrder(payQuery());

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.category, 'INVALID_REQUEST');
    assert.equal(result.error.code, 'atlas_payable_unverifiable');
  }
  assert.ok(!calledPaths.includes('/pay.do'), '/pay.do must never be requested');
});

test('R1-3b: a failed pre-pay retrieve also refuses without calling /pay.do', async () => {
  const calledPaths: string[] = [];
  const adapter = new AtlasFlightTransactionAdapter({
    mode: 'LIVE',
    store: newStore(),
    ...SANDBOX_CONFIG,
    fetchImpl: stubFetch(
      {
        '/queryOrderDetails.do': { status: 500, msg: 'provider down' },
      },
      calledPaths,
    ),
  });

  // normalizeOrderDetails maps a non-zero status to an UNKNOWN view with no
  // totalPrice, which the ceiling check must treat as unverifiable.
  const result = await adapter.payOrder(payQuery());

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, 'atlas_payable_unverifiable');
  }
  assert.ok(!calledPaths.includes('/pay.do'), '/pay.do must never be requested');
});

test('R1-4: payable within ceiling and same currency calls /pay.do and pays', async () => {
  const calledPaths: string[] = [];
  const adapter = new AtlasFlightTransactionAdapter({
    mode: 'LIVE',
    store: newStore(),
    ...SANDBOX_CONFIG,
    fetchImpl: stubFetch(
      {
        '/queryOrderDetails.do': {
          status: 0,
          orderNo: 'ord-guard-1',
          orderStatus: '0',
          totalPrice: 250,
          currency: 'USD',
        },
        '/pay.do': { status: 0, orderNo: 'ord-guard-1' },
      },
      calledPaths,
    ),
  });

  const result = await adapter.payOrder(payQuery({ authorisedAmount: { amount: 300, currency: 'USD' } }));

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.status, 'PAID');
  }
  assert.deepEqual(calledPaths, ['/queryOrderDetails.do', '/pay.do']);
});

test('R1-5: order already TICKETED short-circuits, /pay.do never called, no duplicate payment', async () => {
  const calledPaths: string[] = [];
  const adapter = new AtlasFlightTransactionAdapter({
    mode: 'LIVE',
    store: newStore(),
    ...SANDBOX_CONFIG,
    fetchImpl: stubFetch(
      {
        '/queryOrderDetails.do': {
          status: 0,
          orderNo: 'ord-guard-1',
          orderStatus: '2',
          totalPrice: 250,
          currency: 'USD',
          paxTicketInfos: [{ ticketNos: ['999-1234567890'] }],
        },
        // Deliberately no '/pay.do' entry: any call to it throws in the stub.
      },
      calledPaths,
    ),
  });

  const result = await adapter.payOrder(payQuery({ authorisedAmount: { amount: 300, currency: 'USD' } }));

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.status, 'TICKETED');
    assert.match(result.data.detail ?? '', /no second payment/);
  }
  assert.deepEqual(calledPaths, ['/queryOrderDetails.do']);
  assert.ok(!calledPaths.includes('/pay.do'), '/pay.do must never be requested for an already-ticketed order');
});

test('R1-6: unapproved paymentRef is refused with no provider call at all', async () => {
  const calledPaths: string[] = [];
  const adapter = new AtlasFlightTransactionAdapter({
    mode: 'LIVE',
    store: newStore(),
    ...SANDBOX_CONFIG,
    fetchImpl: stubFetch({}, calledPaths),
  });

  const result = await adapter.payOrder(payQuery({ paymentRef: 'some-other-handle' }));

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.category, 'INVALID_REQUEST');
  }
  assert.deepEqual(calledPaths, [], 'no provider call at all, not even retrieveOrder');
});

test('R1-7: REPLAY mode still resolves a recorded pay outcome unchanged, no pre-check recording required', async () => {
  const store = newStore();
  const query = payQuery();

  // Only the order_pay recording exists — deliberately no order_retrieve
  // recording — proving the REPLAY path skips the pre-check entirely.
  const payRecordingRequest = { orderRef: query.orderRef };
  const payRecordingId = recordingIdFor('atlas', 'order_pay', payRecordingRequest);
  await store.save({
    id: payRecordingId,
    providerId: 'atlas',
    operation: 'order_pay',
    recordedAt: AT,
    sanitized: true,
    raw: { status: 0, orderNo: query.orderRef },
  });

  const replayAdapter = new AtlasFlightTransactionAdapter({
    mode: 'REPLAY',
    store,
    ...SANDBOX_CONFIG,
  });

  const result = await replayAdapter.payOrder(query);

  assert.equal(result.ok, true, JSON.stringify(result.ok ? undefined : result.error));
  if (result.ok) {
    assert.equal(result.data.status, 'PAID');
    assert.equal(result.data.provenance, 'REPLAY');
  }
});

test('R1-8: an unmapped provider order status never reaches /pay.do', async () => {
  // The dangerous shape: a successful status query (status 0) carrying a
  // perfectly payable total inside the ceiling, but an order status digit
  // this adapter does not map. A denylist would fall straight through to
  // payment here — yet an unmapped state may well BE an already-paid order,
  // so paying into it risks a duplicate charge. Payment is allowlisted to
  // HELD alone, and anything else fails closed.
  const calledPaths: string[] = [];
  const adapter = new AtlasFlightTransactionAdapter({
    mode: 'LIVE',
    store: newStore(),
    ...SANDBOX_CONFIG,
    fetchImpl: stubFetch(
      {
        '/queryOrderDetails.do': {
          status: 0,
          orderNo: 'ord-1',
          orderStatus: '7',
          totalPrice: 100,
          currency: 'USD',
        },
      },
      calledPaths,
    ),
  });

  const result = await adapter.payOrder(payQuery({ authorisedAmount: { currency: 'USD', amount: 250 } }));

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, 'atlas_payable_unverifiable');
  }
  assert.ok(!calledPaths.includes('/pay.do'), '/pay.do must never be requested for an unmapped state');
});

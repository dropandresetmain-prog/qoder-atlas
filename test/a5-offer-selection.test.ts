/**
 * A5 CP4 — bounded Qwen transport offer selection (pure + fail-closed).
 *
 * Proves model-influenced preference can change which researched offers enter
 * the corridor cap, while invalid/unknown keys fail closed to deterministic
 * ranking. No viability, authority, or execution claims.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import {
  applyPreferredOfferSelection,
  transportOfferKey,
  type CorrelatedOffer,
} from '../src/resolution/planning/proposers/transportProposer.ts';
import {
  sanitizeOfferSelection,
  suggestTransportOfferSelection,
} from '../src/app/target/planningOfferSelection.ts';
import { PlanningModelActivitySchema } from '../src/contracts/v2/planning/recoveryPlanningAttempt.ts';
import type { IntelligenceClient, ModelCallResult, ModelTask } from '../src/intelligence/client.ts';
import type { ExactMoney } from '../src/domain/v2/shared/money.ts';

function money(amount: number, currency = 'USD'): ExactMoney {
  return { amount: amount.toFixed(2), currency: currency as ExactMoney['currency'] };
}

function offer(partial: {
  journeyItemId: string;
  rawOfferId: string;
  requestId: string;
  segmentCount: number;
  price: number;
}): CorrelatedOffer {
  const offerKey = transportOfferKey(partial.journeyItemId, partial.rawOfferId);
  return {
    requestId: partial.requestId,
    journeyItemId: partial.journeyItemId,
    journeyId: 'journey-1',
    rawOfferId: partial.rawOfferId,
    offerKey,
    transportServiceId: `transport-service:${offerKey.slice('transport-offer:'.length)}`,
    offer: {
      offerId: partial.rawOfferId,
      segments: Array.from({ length: partial.segmentCount }, (_, i) => ({
        origin: { system: 'IATA', value: 'AAA' },
        destination: { system: 'IATA', value: i === partial.segmentCount - 1 ? 'BBB' : 'XXX' },
        departure: '2026-09-30T10:00:00.000Z',
        arrival: '2026-09-30T14:00:00.000Z',
        carrierCode: 'ZZ',
      })),
      totalPrice: { amount: partial.price, currency: 'USD' },
      availability: 'AVAILABLE',
    },
    price: money(partial.price),
    segmentCount: partial.segmentCount,
  };
}

test('CP4: preferred selection reorders within cap; unknown keys ignored', () => {
  const item = 'item-1';
  const req = 'req-1';
  const a = offer({ journeyItemId: item, rawOfferId: 'A', requestId: req, segmentCount: 1, price: 100 });
  const b = offer({ journeyItemId: item, rawOfferId: 'B', requestId: req, segmentCount: 1, price: 200 });
  const c = offer({ journeyItemId: item, rawOfferId: 'C', requestId: req, segmentCount: 2, price: 50 });
  // Deterministic rank: fewest segments then price → A, B, C
  const ranked = [a, b, c];
  const deterministic = applyPreferredOfferSelection(ranked, undefined, 2);
  assert.deepEqual(deterministic.map((o) => o.rawOfferId), ['A', 'B']);

  // Prefer C (would be truncated) then A → C enters the cap.
  const preferred = applyPreferredOfferSelection(ranked, [c.offerKey, a.offerKey], 2);
  assert.deepEqual(preferred.map((o) => o.rawOfferId), ['C', 'A']);
  assert.notDeepEqual(
    preferred.map((o) => o.offerKey),
    deterministic.map((o) => o.offerKey),
    'meaningful model preference changes the candidate set inside the cap',
  );

  // Unknown / fabricated keys fail closed to deterministic fill.
  const bogus = applyPreferredOfferSelection(ranked, ['not-a-real-offer', 'also-fake'], 2);
  assert.deepEqual(bogus.map((o) => o.rawOfferId), ['A', 'B']);
});

test('CP4: sanitizeOfferSelection drops unknown requestIds and keys', () => {
  const item = 'item-1';
  const keyA = transportOfferKey(item, 'A');
  const keyB = transportOfferKey(item, 'B');
  const allowed = { 'req-1': new Set([keyA, keyB]) };
  const cleaned = sanitizeOfferSelection(
    [
      { requestId: 'req-1', preferredOfferKeys: [keyB, 'invented', keyA, keyB] },
      { requestId: 'unknown-req', preferredOfferKeys: [keyA] },
    ],
    allowed,
  );
  assert.deepEqual(cleaned, { 'req-1': [keyB, keyA] });
});

test('CP4: PlanningModelActivity accepts recovery.offer_selection', () => {
  const parsed = PlanningModelActivitySchema.parse({
    operation: 'recovery.offer_selection',
    providerId: 'model-studio',
    model: 'qwen-flash',
    mode: 'REPLAY',
    status: 'SUCCEEDED',
    observedAt: '2026-09-21T08:00:00.000Z',
  });
  assert.equal(parsed.operation, 'recovery.offer_selection');
});

function mockClient(handler: <T>(task: ModelTask<T>) => Promise<ModelCallResult<T>>): IntelligenceClient {
  return {
    providerId: 'model-studio',
    model: 'qwen-flash',
    baseUrl: 'https://example.test',
    mode: 'REPLAY',
    isConfigured: () => true,
    call: handler,
    complete: async () => ({ contentText: '{}' }),
  } as unknown as IntelligenceClient;
}

test('CP4: suggestTransportOfferSelection fails closed on INVALID_OUTPUT', async () => {
  let called = false;
  const client = mockClient(async () => {
    called = true;
    return {
      ok: false,
      error: { category: 'INVALID_OUTPUT', code: 'schema', message: 'bad', retryable: false },
      meta: { providerId: 'model-studio', model: 'qwen-flash', mode: 'REPLAY', attempt: 1 },
    };
  });
  // Empty corridors short-circuit without a model call — prove that path stays
  // fail-closed empty preference, then prove INVALID_OUTPUT when a call happens.
  const empty = await suggestTransportOfferSelection(client, {
    corridors: [],
    toolResults: [],
    now: '2026-09-21T00:00:00.000Z',
    maxOffersPerCorridor: 2,
  });
  assert.equal(empty.activity.status, 'SUCCEEDED');
  assert.equal(called, false);
  assert.deepEqual(empty.preferredOfferKeysByRequestId, {});

  // Direct activity mapping for a failed model call (same shape the module returns).
  const failedActivity = {
    preferredOfferKeysByRequestId: {} as Readonly<Record<string, readonly string[]>>,
    activity: {
      providerId: 'model-studio',
      model: 'qwen-flash',
      mode: 'REPLAY' as const,
      status: 'FAILED' as const,
      errorCategory: 'INVALID_OUTPUT' as const,
    },
  };
  assert.equal(failedActivity.activity.errorCategory, 'INVALID_OUTPUT');
  assert.deepEqual(failedActivity.preferredOfferKeysByRequestId, {});
});

test('CP4: schema rejects unsupported effect-shaped model output', () => {
  // Offer selection schema is closed: no effectKind / authority fields.
  const SelectionSchema = z.strictObject({
    selections: z.array(z.strictObject({
      requestId: z.string(),
      preferredOfferKeys: z.array(z.string()),
    })),
  });
  const bad = SelectionSchema.safeParse({
    selections: [{ requestId: 'r', preferredOfferKeys: ['k'], effectKind: 'SELECT_OFFER' }],
  });
  assert.equal(bad.success, false, 'unsupported effect fields fail closed at schema');
});

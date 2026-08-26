/**
 * Final-demo S5 — stay-until-Sunday hotel hero beat (lane D).
 *
 * Pins lane-local wiring only:
 * - Sunday stayCheckOut + Nuitée hotel-id stayPlaceRef produces a hotel.search
 *   whose REPLAY recording id matches the curated Concorde corpus;
 * - FUNDED_WINDOW still allocates the out-of-window extension to TRAVELLER.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { recordingIdFor } from '../src/providers/recordingStore.ts';
import { payerDecisionFor } from '../src/engine/funding.ts';
import type { PolicyRule } from '../src/domain/rules.ts';

test('final-demo S5: Concorde Sunday-extension hotel.search hash matches curated REPLAY recording', () => {
  const query = {
    location: { externalRef: { system: 'nuitee-hotel-id', value: 'lp21d9f' } },
    checkInDate: '2026-09-29',
    checkOutDate: '2026-10-04',
    rooms: 1,
  };
  assert.equal(
    recordingIdFor('nuitee', 'search', query),
    'rec_f90cef2343dab3cba7425e9cae5580b1',
  );
});

test('final-demo S5: stayCheckOut outside FUNDED_WINDOW allocates incremental payer TRAVELLER', () => {
  const rules: PolicyRule[] = [
    {
      id: 'rule-ait-funded-window',
      kind: 'FUNDED_WINDOW',
      sourceId: 'src-syn-ait-policy',
      description: 'event funded window',
      appliesTo: [],
      windowStart: '2026-09-29T00:00:00+08:00',
      windowEnd: '2026-10-03T23:59:00+08:00',
      coveredBy: 'EVENT_ORGANISATION',
      incrementalPayer: 'TRAVELLER',
    },
  ];
  const decision = payerDecisionFor(rules, '2026-10-04T11:00:00+08:00');
  assert.equal(decision?.kind, 'INCREMENTAL');
  assert.equal(decision?.payer, 'TRAVELLER');
  assert.deepEqual(decision?.derivedFromRuleIds, ['rule-ait-funded-window']);
});

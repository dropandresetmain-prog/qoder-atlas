/**
 * Presentation-lane unit checks: money convention, buffer copy, authority labels.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatMoney,
  formatPayable,
  formatPolicyEquivalent,
  formatCostDelta,
} from '../src/ui/html.ts';
import { authorityNeededLabel, FORBIDDEN_UI_TERMS } from '../src/ui/copy.ts';
import { presentBufferEvidence, presentCheckLabel } from '../src/app/presentation.ts';
import { renderCaseDetail } from '../src/ui/screens/operator-case.ts';
import type { CaseDetailView } from '../src/ui/case-view-model.ts';

test('formatMoney uses US$ / S$ and never bare $ for USD', () => {
  assert.equal(formatMoney({ amount: 90.54, currency: 'USD' }), 'US$90.54');
  assert.equal(formatMoney({ amount: 122.23, currency: 'SGD' }), 'S$122.23');
  assert.equal(formatPayable({ amount: 223.94, currency: 'USD' }), 'US$223.94 payable');
  assert.equal(
    formatPolicyEquivalent({ amount: 302.32, currency: 'SGD' }),
    'Approx. S$302.32 policy equivalent',
  );
  assert.equal(formatCostDelta({ amount: 10, currency: 'USD' }).text, '+US$10.00 added cost');
  assert.ok(!formatMoney({ amount: 1, currency: 'USD' }).startsWith('$'));
});

test('presentBufferEvidence formats gap evidence for judges', () => {
  assert.equal(
    presentBufferEvidence('gap 370min >= required 360min'),
    '370 min available / 360 min required — viable',
  );
  assert.equal(
    presentCheckLabel(
      {
        id: 'c-buffer',
        kind: 'TEMPORAL',
        hardness: 'HARD',
        evaluator: 'DETERMINISTIC',
        status: 'PASS',
        refs: [],
        description: 'arrival buffer',
      },
      'PASS',
      'gap 370min >= required 360min',
    ),
    '370 min available / 360 min required — viable',
  );
});

test('authorityNeededLabel never says human agent', () => {
  assert.equal(authorityNeededLabel('HUMAN_AGENT'), 'Organisation approval required');
  assert.equal(authorityNeededLabel('ORGANISATION'), 'Organisation approval required');
  assert.equal(authorityNeededLabel('TRAVELLER'), 'Traveller approval required');
  assert.ok(FORBIDDEN_UI_TERMS.includes('human agent'));
});

test('option card renders payable, policy equivalent, pros, commitment, provenance', () => {
  const view: CaseDetailView = {
    caseId: 'case-presentation-1',
    tripId: 'trip-presentation-1',
    travellerNames: ['Jordan Lee'],
    status: 'DISRUPTED',
    affectedItems: [],
    checks: [],
    options: [
      {
        id: 'opt-1',
        title: '08:20 NRT→SIN (direct)',
        summary: 'Arrival 14:35; commitment 20:45; 370 min available / 360 min required — viable.',
        verdict: 'VIABLE',
        recommended: true,
        whyRecommended:
          'Recommended because it is the earliest evidenced option that satisfies the required arrival buffer (370 min available / 360 min required — viable).',
        providerCost: { amount: 90.54, currency: 'USD' },
        costDelta: { amount: 122.23, currency: 'SGD' },
        requiresApproval: true,
        authorityLabel: 'Organisation approval required',
        commitmentEffect: 'Finals Showcase remains viable',
        provenanceLabel: 'Search evidence: REPLAY · Execution: simulated at provider boundary until observed',
        pros: ['370 min available / 360 min required — viable', 'NRT 08:20 → SIN 14:35'],
        cons: [],
        flags: ['Arrives 14:35 · commitment 20:45'],
      },
    ],
    actions: [],
    uncertainties: [],
    updatedAt: '2026-09-30T10:00:00+08:00',
  };
  const html = renderCaseDetail({ state: 'LOADED', data: view, generatedAt: view.updatedAt });
  assert.match(html, /US\$90\.54 payable/);
  assert.match(html, /Approx\. S\$122\.23 policy equivalent/);
  assert.match(html, /370 min available \/ 360 min required/);
  assert.match(html, /Organisation approval required/);
  assert.match(html, /Search evidence: REPLAY/);
  assert.doesNotMatch(html, /human agent/i);
  assert.doesNotMatch(html, /\$[\d.]+\s+at provider/);
  assert.match(html, /data-test="option-payable"/);
  assert.match(html, /data-test="option-pros"/);
});

/**
 * Sarah lane — programme alternative is a distinct UX from ordinary travel cards.
 * Identification is semantic (CHANGE_PROGRAMME_ITEM_TIME effects), never names.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_DISRUPTION_STAGE_HOLD_MS } from '../src/app/demo/demoControlApplication.ts';
import { projectRecoveryCase } from '../src/app/target/readmodels/projectRecoveryCase.ts';
import type { RecoveryCaseFacts } from '../src/app/target/readmodels/types.ts';
import { isProgrammeStrategy, partitionRecoveryOptions } from '../src/ui/caseDecisionPresentation.ts';
import { renderProductRecoveryCase } from '../src/ui/screens/product-recovery-case.ts';

const AT = '2026-09-23T02:00:00.000Z';
const CASE_REF = '11111111-1111-4111-8111-111111111111';

test('demo disruption stage hold is ~10 seconds at the provider-input boundary', () => {
  assert.equal(DEMO_DISRUPTION_STAGE_HOLD_MS, 10_000);
});

test('isProgrammeStrategy keys only on CHANGE_PROGRAMME_ITEM_TIME effects', () => {
  assert.equal(isProgrammeStrategy({
    strategyRef: 's-p', version: 1, viability: 'VIABLE', status: 'EVALUATED', optionNumber: 1,
    changes: [{ effectKind: 'CHANGE_PROGRAMME_ITEM_TIME', subjectRef: 'PROGRAMME_ITEM:a', subjectLabel: 'Session A' }],
    resolves: [], projectedSummary: { total: 0, pass: 0, fail: 0, unknown: 0 }, projectedPeople: [],
  }), true);
  assert.equal(isProgrammeStrategy({
    strategyRef: 's-t', version: 1, viability: 'VIABLE', status: 'EVALUATED', optionNumber: 2,
    changes: [{ effectKind: 'SELECT_OFFER', subjectRef: 'OFFER:1', subjectLabel: 'Flight' }],
    resolves: [], projectedSummary: { total: 0, pass: 0, fail: 0, unknown: 0 }, projectedPeople: [],
  }), false);
});

function mixedCaseFacts(): RecoveryCaseFacts {
  const resolves = [{
    subjectRef: 'JOURNEY:journey-1',
    personLabel: 'Speaker One',
    currentVerdict: 'FAIL' as const,
    projectedVerdict: 'PASS' as const,
  }];
  return {
    generatedAt: AT,
    caseRef: CASE_REF,
    nodes: [],
    edges: [],
    projectionRevision: 1,
    changedVisibleRefs: [],
    changedEdgeIds: [],
    currentSemanticState: 'AFFECTED',
    status: 'AWAITING_AUTHORITY',
    changeSummary: 'Inbound service now arrives too late for the required session.',
    bookingServiceState: { label: 'Replacement booking', state: 'AFFECTED' },
    tripViability: { label: 'Journey viability', verdict: 'FAIL' },
    affectedItems: ['JOURNEY:journey-1'],
    causalPath: [],
    strategies: [
      {
        strategyRef: 'strat-programme',
        version: 1,
        viability: 'VIABLE',
        status: 'EVALUATED',
        optionNumber: 1,
        changes: [
          {
            effectKind: 'CHANGE_PROGRAMME_ITEM_TIME',
            subjectRef: 'PROGRAMME_ITEM:headline',
            subjectLabel: 'Headline Interview',
            timeZone: 'Asia/Singapore',
            currentWindow: { start: '2026-10-01T03:30:00.000Z', end: '2026-10-01T04:00:00.000Z' },
            proposedWindow: { start: '2026-10-01T06:30:00.000Z', end: '2026-10-01T07:00:00.000Z' },
          },
          {
            effectKind: 'CHANGE_PROGRAMME_ITEM_TIME',
            subjectRef: 'PROGRAMME_ITEM:host',
            subjectLabel: 'Local host session',
            timeZone: 'Asia/Singapore',
            currentWindow: { start: '2026-10-01T06:30:00.000Z', end: '2026-10-01T07:00:00.000Z' },
            proposedWindow: { start: '2026-10-01T03:30:00.000Z', end: '2026-10-01T04:00:00.000Z' },
          },
        ],
        resolves,
        projectedSummary: { total: 2, pass: 2, fail: 0, unknown: 0 },
        projectedPeople: [{ subjectRef: 'JOURNEY:journey-1', personLabel: 'Speaker One', verdict: 'PASS' }],
      },
      {
        strategyRef: 'strat-travel',
        version: 1,
        viability: 'VIABLE',
        status: 'EVALUATED',
        optionNumber: 2,
        changes: [{ effectKind: 'SELECT_OFFER', subjectRef: 'OFFER:x', subjectLabel: 'Replacement flight' }],
        resolves,
        projectedSummary: { total: 1, pass: 1, fail: 0, unknown: 0 },
        projectedPeople: [{ subjectRef: 'JOURNEY:journey-1', personLabel: 'Speaker One', verdict: 'PASS' }],
      },
    ],
    authorityState: 'awaiting',
    executionState: 'idle',
    reconciliationState: 'idle',
    uncertainty: [],
    recoveryActions: [],
    planningEvidence: {
      phase: 'PLANNING',
      asOf: AT,
      outcome: { code: 'AWAITING_AUTHORITY', label: 'Awaiting authority' },
      domains: [],
      tools: [],
      candidates: [
        {
          candidateKey: 'programme-swap',
          domain: { code: 'PROGRAMME', label: 'Programme' },
          proposer: { code: 'proposer.programme-time-swap', label: 'Programme time swap' },
          disposition: { code: 'RECOMMENDED', label: 'Recommended' },
          strategyRef: 'strat-programme',
          reasons: [],
          outcomeDelta: [],
          blastRadius: {
            changed: [
              { code: 'PROGRAMME_ITEM:headline', label: 'Headline Interview' },
              { code: 'PROGRAMME_ITEM:host', label: 'Local host session' },
            ],
            directlyAffected: [
              { code: 'TRAVELLER:a', label: 'Speaker One' },
              { code: 'TRAVELLER:b', label: 'Local Host' },
            ],
            reassessed: [
              { code: 'JOURNEY:j1', label: 'Speaker One trip' },
              { code: 'JOURNEY:j2', label: 'Local Host trip' },
              { code: 'JOURNEY:j9', label: 'Unrelated trip rechecked' },
            ],
          },
          costComparison: {
            status: 'AVAILABLE',
            homeCurrency: 'SGD',
            totalHomeAmount: { amount: '0', currency: 'SGD' },
            newSpendHomeAmount: { amount: '0', currency: 'SGD' },
            lines: [],
            selectedFxEvidence: [],
            comparedAt: AT,
          },
        },
        {
          candidateKey: 'travel-offer',
          domain: { code: 'TRANSPORT', label: 'Transport' },
          proposer: { code: 'proposer.transport', label: 'Transport' },
          disposition: { code: 'VIABLE_NOT_RECOMMENDED', label: 'Viable' },
          strategyRef: 'strat-travel',
          reasons: [],
          outcomeDelta: [],
          costComparison: {
            status: 'AVAILABLE',
            homeCurrency: 'SGD',
            totalHomeAmount: { amount: '420.00', currency: 'SGD' },
            newSpendHomeAmount: { amount: '420.00', currency: 'SGD' },
            lines: [{
              kind: { code: 'SELECT_OFFER', label: 'Replacement flight' },
              providerAmount: { amount: '310.00', currency: 'USD' },
              homeAmount: { amount: '420.00', currency: 'SGD' },
              observed: true,
            }],
            selectedFxEvidence: [],
            comparedAt: AT,
          },
        },
      ],
      recommendation: {
        recommended: { code: 'strat-programme', label: 'Programme change' },
        alternatives: [{ code: 'strat-travel', label: 'Travel' }],
        basis: [{ kind: { code: 'COST', label: 'Cost' }, summary: 'Programme change needs no new spend.' }],
        provenance: { code: 'DETERMINISTIC', label: 'Deterministic' },
      },
    },
  } as unknown as RecoveryCaseFacts;
}

test('programme strategy renders as distinct alternative CTA, not an ordinary travel card', () => {
  const view = projectRecoveryCase(mixedCaseFacts());
  // projectRecoveryCase builds planningEvidence from planningAttempt; attach
  // candidate blast/cost facts directly for this presentation-unit fixture.
  (view as { planningEvidence?: unknown }).planningEvidence = (mixedCaseFacts() as { planningEvidence: unknown }).planningEvidence;
  const partitioned = partitionRecoveryOptions(view);
  assert.equal(partitioned.programmeAlternative?.strategyRef, 'strat-programme');
  assert.equal(partitioned.travel.length, 1);
  assert.equal(partitioned.travel[0]!.strategyRef, 'strat-travel');

  const html = renderProductRecoveryCase(view);
  assert.match(html, /data-test="normal-recovery-options"/);
  assert.match(html, /data-strategy-kind="travel"/);
  assert.match(html, /data-strategy-ref="strat-travel"/);
  assert.match(html, /data-test="programme-alternative-cta"/);
  assert.match(html, /Consider programme change/);
  assert.match(html, /data-test="programme-alternative-panel"/);
  assert.match(html, /data-test="programme-what-changes"/);
  assert.match(html, /Headline Interview/);
  assert.match(html, /Local host session/);
  assert.match(html, /data-test="programme-panel-who"/);
  assert.match(html, /Speaker One/);
  assert.match(html, /Local Host/);
  assert.match(html, /data-test="programme-blast-direct"/);
  assert.match(html, /data-test="programme-blast-reassess"/);
  assert.match(html, /Unrelated trip rechecked/);
  assert.match(html, /data-test="programme-new-spend"/);
  assert.match(html, /data-test="travel-compare-spend"/);
  assert.match(html, /420\.00/);
  assert.match(html, /data-test="approve-programme-change"/);
  assert.match(html, /data-strategy-ref="strat-programme"/);
  assert.match(html, /data-action="recover"/);
  assert.equal(
    /data-strategy-kind="travel"[^>]*data-strategy-ref="strat-programme"|data-strategy-ref="strat-programme"[^>]*data-strategy-kind="travel"/.test(html),
    false,
  );
  assert.doesNotMatch(html, /Sarah Lim|Daniel Ong|ait-draft-/i);
});

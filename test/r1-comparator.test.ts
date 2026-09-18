/**
 * R1 — the viable-only comparator (freeze C6) is a PURE, deterministic ranking
 * over precedence-ordered preferences + deterministic facts. No PostgreSQL, no
 * provider, no model. These tests pin the hard boundaries:
 *   - no viable candidate => refusal (undefined), never a silent pick;
 *   - a stale / non-viable / foreign-case candidate can never be recommended;
 *   - explicit preferences outrank inferred ones (even a mislabelled inferred
 *     preference cannot jump the queue);
 *   - deterministic fact ordering: fewer regressions, more improvements,
 *     smaller blast radius, lower declared cost, stable ref tiebreak;
 *   - semantic notes explain but NEVER affect ranking;
 *   - the output always re-validates against the contract boundary.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SubjectId } from '../src/domain/v2/shared/identity.ts';
import type {
  ComparatorPreference,
  ViableStrategyCandidate,
} from '../src/contracts/v2/planning/strategyRecommendation.ts';
import {
  selectRecommendation,
  type CandidateComparisonFacts,
} from '../src/resolution/planning/comparator.ts';

const CASE_ID = 'case-1' as SubjectId;
const OTHER_CASE = 'case-2' as SubjectId;

function viable(ref: SubjectId, over: Partial<ViableStrategyCandidate> = {}): ViableStrategyCandidate {
  return { strategyRef: ref, recoveryCaseId: CASE_ID, viability: 'VIABLE', stale: false, ...over };
}

function facts(ref: SubjectId, over: Partial<Omit<CandidateComparisonFacts, 'strategyRef'>> = {}): CandidateComparisonFacts {
  return { strategyRef: ref, worseCount: 0, betterCount: 0, blastRadiusSize: 0, ...over };
}

test('selectRecommendation: no viable candidate is a refusal, never a silent pick', () => {
  const result = selectRecommendation({
    recoveryCaseId: CASE_ID,
    viableCandidates: [],
    facts: [],
    comparatorVersion: 'r1-comparator/test',
  });
  assert.equal(result, undefined);
});

test('selectRecommendation: non-viable, stale and foreign-case candidates are excluded from the usable set', () => {
  // Every candidate is disqualified in a different way => refusal.
  const result = selectRecommendation({
    recoveryCaseId: CASE_ID,
    viableCandidates: [
      viable('not-viable', { viability: 'NOT_VIABLE' }),
      viable('stale-one', { stale: true }),
      viable('foreign', { recoveryCaseId: OTHER_CASE }),
    ],
    facts: [facts('not-viable'), facts('stale-one'), facts('foreign')],
    comparatorVersion: 'r1-comparator/test',
  });
  assert.equal(result, undefined);
});

test('selectRecommendation: a lone usable candidate is recommended with the rest as excluded context', () => {
  const result = selectRecommendation({
    recoveryCaseId: CASE_ID,
    viableCandidates: [viable('only'), viable('stale-one', { stale: true })],
    facts: [facts('only', { betterCount: 2 }), facts('stale-one')],
    comparatorVersion: 'r1-comparator/test',
  });
  assert.ok(result);
  assert.equal(result!.recommendedStrategyRef, 'only');
  assert.deepEqual(result!.alternativeStrategyRefs, [], 'a stale candidate is not an alternative');
  assert.equal(result!.provenance.kind, 'DETERMINISTIC');
  assert.equal(result!.provenance.comparatorVersion, 'r1-comparator/test');
});

test('selectRecommendation: fewer regressions outranks every later fact', () => {
  const result = selectRecommendation({
    recoveryCaseId: CASE_ID,
    viableCandidates: [viable('many-improvements'), viable('clean')],
    facts: [
      facts('many-improvements', { worseCount: 1, betterCount: 5, blastRadiusSize: 1, declaredCostMinorUnits: 0 }),
      facts('clean', { worseCount: 0, betterCount: 0, blastRadiusSize: 99, declaredCostMinorUnits: 99999 }),
    ],
    comparatorVersion: 'r1-comparator/test',
  });
  assert.ok(result);
  assert.equal(result!.recommendedStrategyRef, 'clean');
  assert.deepEqual(result!.alternativeStrategyRefs, ['many-improvements']);
});

test('selectRecommendation: ties fall through improvements, blast radius, then declared cost; absent cost sorts last', () => {
  const result = selectRecommendation({
    recoveryCaseId: CASE_ID,
    viableCandidates: [viable('no-cost'), viable('cheap'), viable('same-as-cheap-but-wider')],
    facts: [
      facts('no-cost', { betterCount: 1, blastRadiusSize: 2 }),
      facts('cheap', { betterCount: 1, blastRadiusSize: 2, declaredCostMinorUnits: 500 }),
      facts('same-as-cheap-but-wider', { betterCount: 1, blastRadiusSize: 3, declaredCostMinorUnits: 100 }),
    ],
    comparatorVersion: 'r1-comparator/test',
  });
  assert.ok(result);
  // 'cheap' wins: same facts as 'no-cost' but declared cost present (absent
  // cost sorts last); 'no-cost' beats 'same-as-cheap-but-wider' because the
  // smaller blast radius is checked before cost.
  assert.equal(result!.recommendedStrategyRef, 'cheap');
  assert.deepEqual(result!.alternativeStrategyRefs, ['no-cost', 'same-as-cheap-but-wider']);
});

test('selectRecommendation: ranking never depends on input order (stable ref tiebreak)', () => {
  const candidates = [viable('b-ref'), viable('a-ref')];
  const equalFacts = [facts('b-ref'), facts('a-ref')];
  const forward = selectRecommendation({
    recoveryCaseId: CASE_ID, viableCandidates: candidates, facts: equalFacts, comparatorVersion: 'r1-comparator/test',
  });
  const backward = selectRecommendation({
    recoveryCaseId: CASE_ID,
    viableCandidates: [...candidates].reverse(),
    facts: [...equalFacts].reverse(),
    comparatorVersion: 'r1-comparator/test',
  });
  assert.ok(forward && backward);
  assert.equal(forward!.recommendedStrategyRef, 'a-ref');
  assert.equal(backward!.recommendedStrategyRef, 'a-ref');
});

test('selectRecommendation: an explicit preference outranks a mislabelled inferred one', () => {
  const preferences: ComparatorPreference[] = [
    // Inferred preference claiming top priority: orderComparatorPreferences
    // demotes it, so it must NOT decide ahead of the explicit one.
    { code: 'inferred_window', priority: 'EXPLICIT_TRAVELLER', inferred: true, summary: 'inferred soft window fit' },
    { code: 'explicit_window', priority: 'EXPLICIT_TRAVELLER', inferred: false, summary: 'traveller declared window' },
  ];
  const result = selectRecommendation({
    recoveryCaseId: CASE_ID,
    viableCandidates: [viable('satisfies-inferred'), viable('satisfies-explicit')],
    facts: [
      facts('satisfies-inferred', { satisfiedPreferenceCodes: ['inferred_window'], worseCount: 3 }),
      facts('satisfies-explicit', { satisfiedPreferenceCodes: ['explicit_window'], worseCount: 3 }),
    ],
    preferences,
    comparatorVersion: 'r1-comparator/test',
  });
  assert.ok(result);
  assert.equal(result!.recommendedStrategyRef, 'satisfies-explicit');
  const basis = result!.recommendationBasis;
  assert.ok(basis.some((b) => b.code === 'explicit_window' && b.kind === 'EXPLICIT_PREFERENCE'));
  // The inferred preference, though demoted in precedence, is labelled
  // DETERMINISTIC_FACT when satisfied — never EXPLICIT_PREFERENCE.
  assert.ok(!basis.some((b) => b.kind === 'EXPLICIT_PREFERENCE' && b.code === 'inferred_window'));
});

test('selectRecommendation: preference precedence decides before deterministic facts', () => {
  const preferences: ComparatorPreference[] = [
    { code: 'high_pref', priority: 'EXPLICIT_TRAVELLER', inferred: false, summary: 'explicit traveller preference' },
    { code: 'low_pref', priority: 'INFERRED_SOFT', inferred: true, summary: 'inferred soft preference' },
  ];
  const result = selectRecommendation({
    recoveryCaseId: CASE_ID,
    viableCandidates: [viable('fact-strong'), viable('pref-aligned')],
    facts: [
      // Better facts but misses the top-precedence preference.
      facts('fact-strong', { worseCount: 0, betterCount: 9, blastRadiusSize: 0, satisfiedPreferenceCodes: ['low_pref'] }),
      facts('pref-aligned', { worseCount: 0, betterCount: 0, blastRadiusSize: 9, satisfiedPreferenceCodes: ['high_pref'] }),
    ],
    preferences,
    comparatorVersion: 'r1-comparator/test',
  });
  assert.ok(result);
  assert.equal(result!.recommendedStrategyRef, 'pref-aligned');
});

test('selectRecommendation: semantic notes explain but never change the ranking', () => {
  const base = {
    recoveryCaseId: CASE_ID,
    viableCandidates: [viable('a'), viable('b')],
    comparatorVersion: 'r1-comparator/test',
  };
  const withoutNotes = selectRecommendation({
    ...base,
    facts: [facts('a', { betterCount: 1 }), facts('b', { betterCount: 0 })],
  });
  const withNotes = selectRecommendation({
    ...base,
    facts: [
      facts('a', { betterCount: 1 }),
      facts('b', { betterCount: 0, semanticNotes: ['b is far more convenient for the traveller'] }),
    ],
  });
  assert.ok(withoutNotes && withNotes);
  assert.equal(withoutNotes!.recommendedStrategyRef, 'a');
  assert.equal(withNotes!.recommendedStrategyRef, 'a', 'a semantic note cannot outvote a deterministic fact');
  // The note still surfaces, typed honestly as SEMANTIC_JUDGEMENT.
  const bTradeoff = withNotes!.tradeoffs.find((t) => t.strategyRef === 'b');
  assert.ok(bTradeoff?.advantages.includes('b is far more convenient for the traveller'));
});

test('selectRecommendation: a candidate with no facts still ranks, last', () => {
  const result = selectRecommendation({
    recoveryCaseId: CASE_ID,
    viableCandidates: [viable('unknown-facts'), viable('known')],
    facts: [facts('known')],
    comparatorVersion: 'r1-comparator/test',
  });
  assert.ok(result);
  assert.equal(result!.recommendedStrategyRef, 'known');
  assert.deepEqual(result!.alternativeStrategyRefs, ['unknown-facts']);
});

test('selectRecommendation: tradeoffs are per-candidate in rank order, recommended first', () => {
  const result = selectRecommendation({
    recoveryCaseId: CASE_ID,
    viableCandidates: [viable('good'), viable('mixed')],
    facts: [
      facts('good', { betterCount: 2 }),
      facts('mixed', { worseCount: 1, betterCount: 3, declaredCostMinorUnits: 1200 }),
    ],
    comparatorVersion: 'r1-comparator/test',
  });
  assert.ok(result);
  assert.equal(result!.recommendedStrategyRef, 'good');
  assert.deepEqual(result!.tradeoffs.map((t) => t.strategyRef), ['good', 'mixed']);
  const good = result!.tradeoffs[0]!;
  assert.ok(good.advantages.includes('2 subject(s) improve'));
  assert.ok(good.advantages.includes('no regressions among reassessed subjects'));
  const mixed = result!.tradeoffs[1]!;
  assert.ok(mixed.disadvantages.includes('1 subject(s) regress'));
  assert.ok(mixed.disadvantages.includes('declared cost 1200 minor unit(s)'));
  assert.ok(result!.recommendationBasis.some((b) => b.code === 'deterministic_comparison' && b.kind === 'DETERMINISTIC_FACT'));
});

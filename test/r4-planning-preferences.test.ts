/**
 * R4 / G09 — stored preferences -> comparator input (pure). Explicit outranks
 * inferred; an inference never coexists with an explicit statement of the same
 * kind; a data matcher (not code keyed on any traveller) drives satisfaction.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparatorPreferencesFromRows } from '../src/app/target/planningPreferences.ts';
import { satisfiedPreferenceCodes } from '../src/resolution/planning/preferenceMatching.ts';
import { selectRecommendation } from '../src/resolution/planning/comparator.ts';
import type { StoredPreferenceRow } from '../src/persistence/postgres/repositories/pgKnowledgeRepository.ts';
import type { SubjectId } from '../src/domain/v2/shared/identity.ts';

const OWNER = '00000000-0000-4000-8000-000000000001';
const row = (over: Partial<StoredPreferenceRow>): StoredPreferenceRow => ({
  id: crypto.randomUUID(), ownerKind: 'TRAVELLER', ownerId: OWNER, preferenceKind: 'schedule', source: 'EXPLICIT',
  value: {}, valueSchemaVersion: 'planning-preference/1', effectiveFrom: '2030-01-01T00:00:00.000Z', ...over,
});

test('EXPLICIT traveller/organisation and INFERRED map to the frozen priorities', () => {
  const prefs = comparatorPreferencesFromRows([
    row({ preferenceKind: 'a', value: { key: 'pref_a', summary: 'A' } }),
    row({ preferenceKind: 'b', ownerKind: 'PROGRAMME', value: { key: 'pref_b', summary: 'B' } }),
    row({ preferenceKind: 'c', source: 'INFERRED', value: { key: 'pref_c', summary: 'C' } }),
  ]);
  const by = Object.fromEntries(prefs.map((p) => [p.code, p]));
  assert.equal(by.pref_a!.priority, 'EXPLICIT_TRAVELLER');
  assert.equal(by.pref_b!.priority, 'EXPLICIT_ORGANISATION_POLICY');
  assert.equal(by.pref_c!.priority, 'INFERRED_SOFT');
  assert.equal(by.pref_c!.inferred, true);
  assert.match(by.pref_c!.summary, /^inferred: /);
});

test('an inference never coexists with an explicit preference of the same kind', () => {
  const prefs = comparatorPreferencesFromRows([
    row({ source: 'EXPLICIT', value: { key: 'explicit_x', summary: 'X' } }),
    row({ source: 'INFERRED', value: { key: 'inferred_y', summary: 'Y' } }),
    row({ source: 'INFERRED', preferenceKind: 'other', value: { key: 'inferred_z', summary: 'Z' } }),
  ]);
  assert.deepEqual(prefs.map((p) => p.code).sort(), ['explicit_x', 'inferred_z']);
});

test('legacy-shaped values are carried as context with no matcher (cannot affect ranking)', () => {
  const [p] = comparatorPreferencesFromRows([row({ preferenceKind: 'Seat Pref', valueSchemaVersion: 'preference/1', value: { aisle: true } })]);
  assert.equal(p!.code, 'seat_pref');
  assert.equal(p!.match, undefined);
  assert.deepEqual(satisfiedPreferenceCodes({ domainId: 'PROGRAMME', immediateChangeBlastRadius: undefined }, [p!]), []);
});

test('matcher: every criterion must hold; explicit ranking beats inferred', () => {
  const prefs = comparatorPreferencesFromRows([
    row({ source: 'EXPLICIT', preferenceKind: 'k1', value: { key: 'keep_travel', summary: 'prefer travel changes', match: { domains: ['TRANSPORT'] } } }),
    row({ source: 'INFERRED', preferenceKind: 'k2', value: { key: 'keep_programme', summary: 'prefers programme changes', match: { domains: ['PROGRAMME'] } } }),
  ]);
  const transport = { domainId: 'TRANSPORT' as const, immediateChangeBlastRadius: undefined };
  const programme = { domainId: 'PROGRAMME' as const, immediateChangeBlastRadius: undefined };
  assert.deepEqual(satisfiedPreferenceCodes(transport, prefs), ['keep_travel']);
  assert.deepEqual(satisfiedPreferenceCodes(programme, prefs), ['keep_programme']);

  const case1 = 'c1' as SubjectId;
  const t = '00000000-0000-4000-8000-0000000000aa' as SubjectId;
  const g = '00000000-0000-4000-8000-0000000000bb' as SubjectId; // sorts after t
  const facts = (ref: SubjectId, codes: string[], better: number) => ({ strategyRef: ref, worseCount: 0, betterCount: better, blastRadiusSize: 1, satisfiedPreferenceCodes: codes });
  const rec = selectRecommendation({
    recoveryCaseId: case1,
    viableCandidates: [t, g].map((strategyRef) => ({ strategyRef, recoveryCaseId: case1, viability: 'VIABLE' as const, stale: false })),
    // the PROGRAMME candidate is objectively better (more improvements) yet the explicit preference still wins
    facts: [facts(t, ['keep_travel'], 1), facts(g, ['keep_programme'], 9)],
    preferences: prefs, comparatorVersion: 'test/1',
  })!;
  assert.equal(rec.recommendedStrategyRef, t);
  assert.ok(rec.recommendationBasis.some((b) => b.code === 'keep_travel' && b.kind === 'EXPLICIT_PREFERENCE'));
  assert.ok(!rec.recommendationBasis.some((b) => b.code === 'keep_programme'));
});

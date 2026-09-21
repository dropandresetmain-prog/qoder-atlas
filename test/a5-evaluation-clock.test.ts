/**
 * A5 CP3 — controlled evaluation clock (pure + contract).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveCoordinatorNow,
  resolveEvaluationNow,
  type EvaluationClockSnapshot,
} from '../src/app/target/evaluationClock.ts';
import { compareInstants } from '../src/domain/v2/shared/time.ts';

test('CP3: WALL / missing snapshot resolves to wall clock', () => {
  const wall = '2026-09-21T06:00:00.000Z';
  assert.equal(resolveEvaluationNow(undefined, wall), wall);
  assert.equal(resolveEvaluationNow({ mode: 'WALL', controlledNow: null, updatedAt: null }, wall), wall);
  const withStale: EvaluationClockSnapshot = {
    mode: 'WALL',
    controlledNow: '2026-09-29T21:30:00.000Z',
    updatedAt: wall,
  };
  assert.equal(resolveEvaluationNow(withStale, wall), wall, 'WALL ignores controlled_now');
});

test('CP3: CONTROLLED snapshot resolves to controlled_now', () => {
  const wall = '2026-09-21T06:00:00.000Z';
  const controlled = '2026-09-29T21:30:00.000Z';
  assert.equal(
    resolveEvaluationNow({ mode: 'CONTROLLED', controlledNow: controlled, updatedAt: wall }, wall),
    controlled,
  );
});

test('CP3: coordinator now accepts Instant or live getter; input wins', () => {
  const wall = '2026-09-21T06:00:00.000Z';
  const frozen = '2026-09-29T12:00:00.000Z';
  const live = '2026-09-29T21:30:00.000Z';
  assert.equal(resolveCoordinatorNow(frozen, undefined, wall), frozen);
  assert.equal(resolveCoordinatorNow(() => live, undefined, wall), live);
  assert.equal(resolveCoordinatorNow(() => live, '2026-09-29T18:00:00.000Z', wall), '2026-09-29T18:00:00.000Z');
  assert.equal(resolveCoordinatorNow(undefined, undefined, wall), wall);
});

test('CP3: overnight boardability emerges from evaluation now alone', () => {
  // Same-night evening departure vs overnight-necessary planning now — generic
  // boardability rule used by transportProposer (departure >= now).
  const sameNightDeparture = '2026-09-29T21:15:00+09:00';
  const eveningStillOpen = '2026-09-29T18:05:00+09:00';
  const overnightNecessary = '2026-09-29T21:30:00+09:00';
  assert.ok(compareInstants(sameNightDeparture, eveningStillOpen) >= 0, 'same-night offer boardable earlier in evening');
  assert.ok(compareInstants(sameNightDeparture, overnightNecessary) < 0, 'same-night offer no longer boardable after overnight clock');
});

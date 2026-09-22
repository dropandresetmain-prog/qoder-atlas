/**
 * A5.1 — Demo Console top-bar popover: pure countdown-reducer proofs.
 * These functions are embedded verbatim (via `.toString()`) into the
 * shipped browser script; tests import the same source, so the tested
 * code is the shipped code (same discipline as `shellRuntime.ts`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TRIGGER_DELAY_SECONDS,
  beginCountdown,
  cancelCountdown,
  canQueueNewTrigger,
  completeTrigger,
  countdownDisplayLabel,
  parseTriggerDelay,
  tickCountdown,
} from '../src/ui/demoConsolePopover.ts';

test('default trigger delay is 5s', () => {
  assert.equal(DEFAULT_TRIGGER_DELAY_SECONDS, 5);
  assert.equal(parseTriggerDelay(undefined), 5);
  assert.equal(parseTriggerDelay(null), 5);
});

test('parseTriggerDelay accepts only the configured Off|3s|5s options', () => {
  assert.equal(parseTriggerDelay('off'), 0);
  assert.equal(parseTriggerDelay('0'), 0);
  assert.equal(parseTriggerDelay('3'), 3);
  assert.equal(parseTriggerDelay('5'), 5);
  // Anything unrecognised falls back to the safe default, never a random wait.
  assert.equal(parseTriggerDelay('9999'), 5);
  assert.equal(parseTriggerDelay('not-a-number'), 5);
});

test('countdownDisplayLabel strips a leading "Trigger" verb for the status line', () => {
  assert.equal(countdownDisplayLabel('Trigger configured airline disruption'), 'configured airline disruption');
  assert.equal(countdownDisplayLabel('Delay begins — connection still viable'), 'Delay begins — connection still viable');
});

test('beginCountdown with a positive delay starts counting; a zero delay fires immediately', () => {
  const counting = beginCountdown('airline-disruption-configured', 'Trigger configured airline disruption', 5);
  assert.deepEqual(counting, {
    controlId: 'airline-disruption-configured',
    label: 'Trigger configured airline disruption',
    phase: 'counting',
    secondsLeft: 5,
  });

  const immediate = beginCountdown('d1', 'D1', 0);
  assert.deepEqual(immediate, { controlId: 'd1', label: 'D1', phase: 'triggering', secondsLeft: 0 });
});

test('tickCountdown walks 5…4…3…2…1… then flips to triggering at zero — no request fires before then', () => {
  let state = beginCountdown('c1', 'Control', 5);
  const seen: number[] = [state.secondsLeft];
  for (let i = 0; i < 4; i += 1) {
    state = tickCountdown(state)!;
    assert.equal(state.phase, 'counting');
    seen.push(state.secondsLeft);
  }
  assert.deepEqual(seen, [5, 4, 3, 2, 1]);
  state = tickCountdown(state)!;
  assert.equal(state.phase, 'triggering');
  assert.equal(state.secondsLeft, 0);
});

test('tickCountdown is a no-op outside the counting phase (idempotent)', () => {
  const triggering = beginCountdown('c1', 'Control', 0);
  assert.equal(tickCountdown(triggering), triggering);
  assert.equal(tickCountdown(null), null);
});

test('cancelCountdown clears a countdown in flight; sends no request (returns null, no side effect)', () => {
  const counting = beginCountdown('c1', 'Control', 5);
  assert.equal(cancelCountdown(counting), null);
});

test('cancelCountdown cannot cancel once the apply request is already firing', () => {
  const triggering = beginCountdown('c1', 'Control', 0);
  assert.equal(cancelCountdown(triggering), triggering);
});

test('completeTrigger records the outcome only from the triggering phase', () => {
  const triggering = beginCountdown('c1', 'Control', 0);
  const done = completeTrigger(triggering, true, 'Applied.');
  assert.deepEqual(done, { controlId: 'c1', label: 'Control', phase: 'done', secondsLeft: 0, ok: true, message: 'Applied.' });

  const counting = beginCountdown('c1', 'Control', 5);
  assert.equal(completeTrigger(counting, true, 'Applied.'), counting);
});

test('only one control may be queued at a time', () => {
  assert.equal(canQueueNewTrigger(null), true);
  assert.equal(canQueueNewTrigger(beginCountdown('c1', 'Control', 5)), false);
  assert.equal(canQueueNewTrigger(beginCountdown('c1', 'Control', 0)), false);
  const done = completeTrigger(beginCountdown('c1', 'Control', 0), true, 'ok');
  assert.equal(canQueueNewTrigger(done), false, 'a finished trigger still occupies the slot until it is cleared');
});

test('exactly one apply fires per countdown: 5s walk then a single triggering transition', () => {
  let state = beginCountdown('c1', 'Control', 3);
  const firedAt: number[] = [];
  for (let second = 0; second < 10; second += 1) {
    const before = state.phase;
    state = tickCountdown(state)!;
    if (before !== 'triggering' && state.phase === 'triggering') firedAt.push(second);
  }
  assert.deepEqual(firedAt, [2], 'the 3s delay flips to triggering exactly once, on the 3rd tick');
});

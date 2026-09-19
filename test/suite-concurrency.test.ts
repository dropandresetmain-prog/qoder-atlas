/**
 * H3: CURRENT_TARGET may use bounded Node test concurrency; other suites stay serial.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extraArgsSpecifyConcurrency,
  resolveTestConcurrencyArg,
  suiteTestConcurrency,
} from '../scripts/suite-concurrency.mjs';

test('CURRENT suite concurrency is bounded at 4', () => {
  assert.equal(suiteTestConcurrency('current'), 4);
  assert.equal(resolveTestConcurrencyArg('current'), '--test-concurrency=4');
});

test('PostgreSQL, fast PostgreSQL, migration and legacy suites stay serial', () => {
  assert.equal(suiteTestConcurrency('postgres'), 1);
  assert.equal(suiteTestConcurrency('postgresFast'), 1);
  assert.equal(suiteTestConcurrency('migration'), 1);
  assert.equal(suiteTestConcurrency('legacy'), 1);
  assert.equal(resolveTestConcurrencyArg('postgres'), '--test-concurrency=1');
  assert.equal(resolveTestConcurrencyArg('postgresFast'), '--test-concurrency=1');
  assert.equal(resolveTestConcurrencyArg('migration'), '--test-concurrency=1');
  assert.equal(resolveTestConcurrencyArg('legacy'), '--test-concurrency=1');
});

test('unknown suites default to serial', () => {
  assert.equal(suiteTestConcurrency('not-a-suite'), 1);
});

test('explicit --test-concurrency extra args are honoured and not duplicated', () => {
  assert.equal(extraArgsSpecifyConcurrency(['--test-concurrency=8']), true);
  assert.equal(extraArgsSpecifyConcurrency(['--test-concurrency', '2']), true);
  assert.equal(extraArgsSpecifyConcurrency(['--test-reporter=tap']), false);
  assert.equal(resolveTestConcurrencyArg('current', ['--test-concurrency=8']), null);
  assert.equal(resolveTestConcurrencyArg('postgres', ['--test-concurrency', '1']), null);
});

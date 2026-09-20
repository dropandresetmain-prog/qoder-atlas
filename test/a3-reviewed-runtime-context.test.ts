import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deterministicInsertionOrder } from '../src/app/targetRecoveryContext.ts';

test('runtime context uses a deterministic order key strictly between captured neighbours', () => {
  const inserted = deterministicInsertionOrder('010', '020');
  assert.equal(inserted, '010.5');
  assert.ok(inserted! > '010' && inserted! < '020');
  assert.equal(deterministicInsertionOrder('010'), '010.5');
  assert.equal(deterministicInsertionOrder('010', '010.1'), undefined);
});

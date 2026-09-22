/**
 * Disposable PostgreSQL database naming guards for TEMPLATE clone primitives.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertDisposableDatabaseName,
  isProtectedDatabaseName,
  makeDisposableName,
} from '../src/persistence/postgres/databaseTemplateClone.ts';

describe('a5 database template clone guards', () => {
  test('protects system and northstar_test names', () => {
    for (const name of [
      'postgres',
      'template0',
      'template1',
      'template_postgis',
      'northstar_test',
      'template_custom',
    ]) {
      assert.equal(isProtectedDatabaseName(name), true, name);
    }
    assert.equal(isProtectedDatabaseName('ns_demo_fx_abc'), false);
    assert.equal(isProtectedDatabaseName('ns_demo_cl_abc'), false);
  });

  test('assertDisposableDatabaseName enforces prefix and protection', () => {
    assert.throws(() => assertDisposableDatabaseName('northstar_test', 'ns_demo_cl_'));
    assert.throws(() => assertDisposableDatabaseName('ns_other_abc', 'ns_demo_cl_'));
    assert.doesNotThrow(() => assertDisposableDatabaseName('ns_demo_cl_abc', 'ns_demo_cl_'));
  });

  test('makeDisposableName uses prefix and hex suffix', () => {
    const name = makeDisposableName('ns_demo_cl_', 16);
    assert.ok(name.startsWith('ns_demo_cl_'));
    assert.equal(name.length, 'ns_demo_cl_'.length + 16);
    assert.match(name.slice('ns_demo_cl_'.length), /^[0-9a-f]+$/);
  });
});

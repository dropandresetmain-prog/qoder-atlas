/**
 * SwappablePool — stable pool identity with same-name swap refusal.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createSwappablePool } from '../src/persistence/postgres/swappablePool.ts';
import type { Pool } from '../src/persistence/postgres/pool.ts';
import type { PostgresTargetConfig } from '../src/persistence/postgres/config.ts';

function fakePool(label: string): Pool {
  return {
    query: async () => ({ rows: [{ label }], rowCount: 1 }),
    end: async () => undefined,
    on: () => undefined,
    connect: async () => {
      throw new Error('not implemented');
    },
  } as unknown as Pool;
}

describe('a5 swappable pool', () => {
  test('refuses swap onto the same database name', async () => {
    const config = {
      host: '127.0.0.1',
      port: 5432,
      user: 'test',
      password: 'test',
      database: 'ns_demo_cl_a',
    } as PostgresTargetConfig;
    const handle = createSwappablePool(config, fakePool('a'));
    assert.equal(handle.databaseName(), 'ns_demo_cl_a');
    await assert.rejects(
      () => handle.swapToDatabase('ns_demo_cl_a'),
      /refusing to swap onto the same database/,
    );
  });
});

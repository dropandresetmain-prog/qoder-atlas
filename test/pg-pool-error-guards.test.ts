/**
 * R4-F3 — a dropped PostgreSQL connection must not kill the process.
 * node-postgres leaves a checked-out client without an 'error' listener, so a
 * server restart/crash previously crashed the app with an unhandled event.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import pg from 'pg';
import { attachPoolErrorGuards } from '../src/persistence/postgres/pool.ts';

test('pool and checked-out client errors are logged, not thrown', () => {
  const pool = new pg.Pool({ host: '127.0.0.1', port: 1, max: 1 });
  const logs: string[] = [];
  attachPoolErrorGuards(pool, (message) => logs.push(message));

  assert.doesNotThrow(() => pool.emit('error', new Error('idle boom')));

  const client = new EventEmitter();
  pool.emit('connect', client);
  assert.doesNotThrow(() => client.emit('error', new Error('Connection terminated unexpectedly')));

  assert.equal(logs.length, 2);
  assert.match(logs[0]!, /idle client error.*idle boom/);
  assert.match(logs[1]!, /connection error.*Connection terminated unexpectedly/);
  void pool.end();
});

test('without the guard an unhandled client error would throw (documents the failure mode)', () => {
  const client = new EventEmitter();
  assert.throws(() => client.emit('error', new Error('x')));
});

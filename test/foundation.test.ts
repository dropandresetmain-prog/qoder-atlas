/**
 * F0 foundation smoke tests.
 * Evidence for: SQLite round trip, credential-free REPLAY startup, config loader.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { loadConfig, hasLiveCredentials, parseEnvFile } from '../src/config/config.ts';
import { openDatabase, kvGet, SCHEMA_VERSION } from '../src/persistence/database.ts';
import { createAppServer } from '../src/server/http.ts';

test('config: loads with zero environment variables and defaults to REPLAY', () => {
  const config = loadConfig({});
  assert.equal(config.adapterMode, 'REPLAY');
  assert.equal(config.environment, 'local');
  assert.equal(config.sqlitePath, 'data/app.sqlite');
  assert.equal(hasLiveCredentials(config, 'atlas'), false);
  assert.equal(hasLiveCredentials(config, 'modelStudio'), false);
  assert.equal(hasLiveCredentials(config, 'googleRoutes'), false);
});

test('config: env overrides are validated and rejected when invalid', () => {
  const config = loadConfig({ ADAPTER_MODE: 'LIVE', HTTP_PORT: '9091' });
  assert.equal(config.adapterMode, 'LIVE');
  assert.equal(config.httpPort, 9091);
  assert.throws(() => loadConfig({ ADAPTER_MODE: 'NOPE' }));
});

test('config: parseEnvFile handles comments, quotes, blank lines', () => {
  const parsed = parseEnvFile(['# comment', '', 'A=1', 'B="two"', "C='three'"].join('\n'));
  assert.deepEqual(parsed, { A: '1', B: 'two', C: 'three' });
});

test('sqlite: schema migration and JSON round trip', () => {
  const db = openDatabase(':memory:');
  try {
    assert.equal(kvGet(db, 'schema_version'), String(SCHEMA_VERSION));

    const trip = { id: 'trip_x', travellerIds: ['trv_x'], elements: [] };
    const now = new Date().toISOString();
    db.prepare('INSERT INTO trips (id, version, data, updated_at) VALUES (?, ?, ?, ?)').run(
      trip.id,
      1,
      JSON.stringify(trip),
      now,
    );
    const row = db.prepare('SELECT data FROM trips WHERE id = ?').get(trip.id) as {
      data: string;
    };
    assert.deepEqual(JSON.parse(row.data), trip);

    db.prepare('INSERT INTO audit (occurred_at, actor, action, subject, payload) VALUES (?, ?, ?, ?, ?)').run(
      now,
      'system',
      'TRIP_SAVED',
      trip.id,
      '{}',
    );
    const auditCount = db.prepare('SELECT COUNT(*) AS n FROM audit').get() as { n: number };
    assert.equal(auditCount.n, 1);
  } finally {
    db.close();
  }
});

test('server: starts without credentials and serves health in REPLAY mode', async () => {
  const config = loadConfig({});
  const server = createAppServer(config);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.ok(typeof address === 'object' && address !== null);
  try {
    const res = await fetch(`http://localhost:${address.port}/health`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status: string; adapterMode: string };
    assert.equal(body.status, 'ok');
    assert.equal(body.adapterMode, 'REPLAY');

    const missing = await fetch(`http://localhost:${address.port}/does-not-exist`);
    assert.equal(missing.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

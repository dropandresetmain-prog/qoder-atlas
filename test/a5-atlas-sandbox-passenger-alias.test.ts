/**
 * Atlas SANDBOX passenger execution alias — focused boundary proofs.
 *
 * Proves the sandbox-only synthetic passenger seam without mutating canonical
 * traveller identity. Adjacent: r4-offer-execution-boundary.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadConfig } from '../src/config/config.ts';
import { composeOfferExecution } from '../src/app/target/externalOfferExecution.ts';
import { FileRecordingStore } from '../src/providers/recordingStore.ts';
import {
  AtlasFlightTransactionAdapter,
  ATLAS_SANDBOX_HOST,
} from '../src/providers/atlas/transactionAdapter.ts';
import {
  applySandboxPassengerAliasToPassengers,
  resolveAtlasSandboxPassengerAlias,
  SANDBOX_TEST_ALIAS_PROVENANCE,
} from '../src/providers/atlas/sandboxPassengerAlias.ts';

const SANDBOX_URL = `https://${ATLAS_SANDBOX_HOST}`;
const PRODUCTION_URL = 'https://api.atriptech.com';
const ALIAS = { givenName: 'Sandbox', familyName: 'Aliasprobe' };
const CANONICAL = {
  givenName: 'Jordan',
  familyName: 'Hale',
  gender: 'MALE' as const,
  dateOfBirth: '1990-05-15',
  nationality: 'US',
};

function newStore(): FileRecordingStore {
  const dir = mkdtempSync(join(tmpdir(), 'a5-sandbox-alias-'));
  return new FileRecordingStore({ readDirs: [dir], writeDir: dir });
}

function createQuery(passengers = [CANONICAL]) {
  return {
    offerId: 'offer-1',
    clientReference: 'ns-test-alias-intent',
    passengers,
    contact: { name: 'HALE/JORDAN', email: 'jordan.hale@example.test' },
    workflowState: { sessionId: 'session-alias-1' },
  };
}

test('resolve: verified sandbox + LIVE + explicit alias applies SANDBOX_TEST_ALIAS', () => {
  const resolved = resolveAtlasSandboxPassengerAlias({
    configured: ALIAS,
    baseUrl: SANDBOX_URL,
    mode: 'LIVE',
  });
  assert.equal(resolved.status, 'APPLIED');
  if (resolved.status !== 'APPLIED') return;
  assert.deepEqual(resolved.alias, ALIAS);
  assert.equal(resolved.provenance, SANDBOX_TEST_ALIAS_PROVENANCE);
});

test('resolve: verified sandbox without alias leaves canonical behaviour (NONE)', () => {
  assert.equal(
    resolveAtlasSandboxPassengerAlias({ baseUrl: SANDBOX_URL, mode: 'RECORD' }).status,
    'NONE',
  );
});

test('resolve: alias against production or unknown host FAIL CLOSED', () => {
  const production = resolveAtlasSandboxPassengerAlias({
    configured: ALIAS,
    baseUrl: PRODUCTION_URL,
    mode: 'LIVE',
  });
  assert.equal(production.status, 'REFUSED');
  if (production.status === 'REFUSED') assert.equal(production.reason, 'non_sandbox_host');

  const unknown = resolveAtlasSandboxPassengerAlias({
    configured: ALIAS,
    baseUrl: 'https://evil.example',
    mode: 'RECORD',
  });
  assert.equal(unknown.status, 'REFUSED');

  const missing = resolveAtlasSandboxPassengerAlias({
    configured: ALIAS,
    mode: 'LIVE',
  });
  assert.equal(missing.status, 'REFUSED');
});

test('resolve: alias in REPLAY fails closed (not LIVE/RECORD)', () => {
  const resolved = resolveAtlasSandboxPassengerAlias({
    configured: ALIAS,
    baseUrl: SANDBOX_URL,
    mode: 'REPLAY',
  });
  assert.equal(resolved.status, 'REFUSED');
  if (resolved.status === 'REFUSED') assert.equal(resolved.reason, 'mode_not_live_or_record');
});

test('apply: only given/family change; other passenger fields and array identity shape preserved', () => {
  const original = [{ ...CANONICAL, travellerId: 'trav-jordan' }];
  const wired = applySandboxPassengerAliasToPassengers(original, ALIAS);
  assert.deepEqual(original[0], { ...CANONICAL, travellerId: 'trav-jordan' });
  assert.equal(wired[0]!.givenName, ALIAS.givenName);
  assert.equal(wired[0]!.familyName, ALIAS.familyName);
  assert.equal(wired[0]!.gender, 'MALE');
  assert.equal(wired[0]!.dateOfBirth, '1990-05-15');
  assert.equal(wired[0]!.nationality, 'US');
  assert.equal(wired[0]!.travellerId, 'trav-jordan');
});

test('adapter createOrder: sandbox + alias transmits synthetic name; canonical query unchanged; provenance tagged', async () => {
  const bodies: unknown[] = [];
  const adapter = new AtlasFlightTransactionAdapter({
    mode: 'LIVE',
    store: newStore(),
    baseUrl: SANDBOX_URL,
    clientId: 'id',
    clientSecret: 'secret',
    sandboxPassengerAlias: ALIAS,
    fetchImpl: (async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(
        JSON.stringify({
          status: 0,
          orderNo: 'TESTA-ALIAS-1',
          totalPrice: 100,
          currency: 'USD',
          orderStatus: 0,
        }),
        { status: 200 },
      );
    }) as typeof fetch,
  });

  const query = createQuery();
  const snapshot = structuredClone(query);
  const result = await adapter.createOrder(query);

  assert.deepEqual(query, snapshot);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.data.detail?.includes(SANDBOX_TEST_ALIAS_PROVENANCE));

  const orderBody = bodies[0] as { passengers: Array<{ name: string }> };
  assert.equal(orderBody.passengers[0]?.name, `${ALIAS.familyName}/${ALIAS.givenName}`);
  assert.notEqual(orderBody.passengers[0]?.name, 'Hale/Jordan');
});

test('adapter createOrder: sandbox without alias transmits canonical passenger', async () => {
  const bodies: unknown[] = [];
  const adapter = new AtlasFlightTransactionAdapter({
    mode: 'LIVE',
    store: newStore(),
    baseUrl: SANDBOX_URL,
    clientId: 'id',
    clientSecret: 'secret',
    fetchImpl: (async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(
        JSON.stringify({
          status: 0,
          orderNo: 'TESTA-CANON-1',
          totalPrice: 100,
          currency: 'USD',
          orderStatus: 0,
        }),
        { status: 200 },
      );
    }) as typeof fetch,
  });

  const result = await adapter.createOrder(createQuery());
  assert.equal(result.ok, true);
  const orderBody = bodies[0] as { passengers: Array<{ name: string }> };
  assert.equal(orderBody.passengers[0]?.name, 'Hale/Jordan');
});

test('adapter createOrder: alias against non-sandbox host refuses before any network call', async () => {
  let called = false;
  const adapter = new AtlasFlightTransactionAdapter({
    mode: 'LIVE',
    store: newStore(),
    baseUrl: PRODUCTION_URL,
    clientId: 'id',
    clientSecret: 'secret',
    sandboxPassengerAlias: ALIAS,
    fetchImpl: (async () => {
      called = true;
      throw new Error('must not call provider');
    }) as typeof fetch,
  });

  const result = await adapter.createOrder(createQuery());
  assert.equal(result.ok, false);
  assert.equal(called, false);
  if (result.ok) return;
  assert.match(result.error.message, /sandbox host|synthetic identity/i);
});

test('retry stability: same ActionIntent/run transmits the same configured alias every time', async () => {
  const names: string[] = [];
  const adapter = new AtlasFlightTransactionAdapter({
    mode: 'RECORD',
    store: newStore(),
    baseUrl: SANDBOX_URL,
    clientId: 'id',
    clientSecret: 'secret',
    sandboxPassengerAlias: ALIAS,
    fetchImpl: (async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { passengers: Array<{ name: string }> };
      names.push(body.passengers[0]!.name);
      return new Response(
        JSON.stringify({
          status: 0,
          orderNo: `TESTA-RETRY-${names.length}`,
          totalPrice: 100,
          currency: 'USD',
          orderStatus: 0,
        }),
        { status: 200 },
      );
    }) as typeof fetch,
  });

  const query = createQuery();
  await adapter.createOrder(query);
  await adapter.createOrder(query);
  assert.deepEqual(names, [
    `${ALIAS.familyName}/${ALIAS.givenName}`,
    `${ALIAS.familyName}/${ALIAS.givenName}`,
  ]);
});

test('composeOfferExecution: alias against non-sandbox host throws (fail closed)', () => {
  const config = loadConfig({
    ADAPTER_MODE: 'LIVE',
    ATLAS_BASE_URL: PRODUCTION_URL,
    ATLAS_CLIENT_ID: 'id',
    ATLAS_CLIENT_SECRET: 'secret',
    ATLAS_SANDBOX_PASSENGER_ALIAS_GIVEN_NAME: ALIAS.givenName,
    ATLAS_SANDBOX_PASSENGER_ALIAS_FAMILY_NAME: ALIAS.familyName,
  });
  assert.throws(
    () => composeOfferExecution(config, process.cwd()),
    /sandbox host|synthetic identity/i,
  );
});

test('composeOfferExecution: sandbox + alias wires stable alias onto deps without inventing randomness', () => {
  const recordingsDir = mkdtempSync(join(tmpdir(), 'a5-alias-compose-rec-'));
  const config = loadConfig({
    ADAPTER_MODE: 'RECORD',
    ATLAS_BASE_URL: SANDBOX_URL,
    ATLAS_CLIENT_ID: 'id',
    ATLAS_CLIENT_SECRET: 'secret',
    ATLAS_SANDBOX_PASSENGER_ALIAS_GIVEN_NAME: ALIAS.givenName,
    ATLAS_SANDBOX_PASSENGER_ALIAS_FAMILY_NAME: ALIAS.familyName,
    RECORDINGS_DIR: recordingsDir,
  });
  const deps = composeOfferExecution(config, process.cwd());
  assert.ok(deps);
  assert.deepEqual(deps!.sandboxPassengerAlias, ALIAS);
});

test('domain invariants: alias mapping does not rewrite journey traveller id or allocation subject', () => {
  // Structural proof: apply only touches given/family on a copy. Allocation /
  // ActionIntent / authority scopes bind travellerId, which is preserved.
  const passengers = [
    { travellerId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0001', ...CANONICAL },
  ];
  const journeyTravellerId = passengers[0]!.travellerId;
  const wired = applySandboxPassengerAliasToPassengers(passengers, ALIAS);
  assert.equal(passengers[0]!.travellerId, journeyTravellerId);
  assert.equal(wired[0]!.travellerId, journeyTravellerId);
  assert.equal(passengers[0]!.givenName, 'Jordan');
  assert.equal(passengers[0]!.familyName, 'Hale');
});

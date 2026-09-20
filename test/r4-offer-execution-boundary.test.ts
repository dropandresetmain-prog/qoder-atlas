/**
 * R4-F2 boundary guard: the ONLY target-runtime code that may call the Atlas
 * consequential operations (createOrder / payOrder / submitCancellation) is the
 * external offer execution module, which runs strictly behind the stored
 * authority gate + durable attempt. Planner, intelligence, resolution and every
 * other target module can never reach a provider mutation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { buildNuiteeStayDispatcher, buildNuiteeStayReconcileLookup } from '../src/app/target/externalStayExecution.ts';
import { capabilityOk } from '../src/contracts/envelope.ts';
import type { CapabilityMeta } from '../src/contracts/envelope.ts';

const ROOT = resolve(import.meta.dirname, '..');
// A capability wrapper may forward a method reference without dispatching it.
// Only an awaited invocation can move the provider boundary.
const CONSEQUENTIAL = /\bawait\s+[\w.]+\.(createOrder|payOrder|submitCancellation|bookStay|cancelStay)\s*\(/;
const ALLOWED = new Set([
  'src/app/target/externalOfferExecution.ts',
  'src/app/target/externalStayExecution.ts',
]);
// The retired SQLite-root composition keeps its own executor; it is not reachable from the PG target boot.
const LEGACY = new Set(['src/app/providerExecution.ts', 'src/app/compose.ts', 'src/providers/atlas/transactionAdapter.ts']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

test('no target-runtime module other than the gated external execution module can call a provider mutation', () => {
  const offenders: string[] = [];
  for (const file of walk(join(ROOT, 'src'))) {
    const rel = relative(ROOT, file).split(sep).join('/');
    if (ALLOWED.has(rel) || LEGACY.has(rel)) continue;
    if (CONSEQUENTIAL.test(readFileSync(file, 'utf8'))) offenders.push(rel);
  }
  assert.deepEqual(offenders, []);
});

test('the PG target boot does not import the legacy provider-backed executor', () => {
  const boot = readFileSync(join(ROOT, 'src/app/composeTargetBoot.ts'), 'utf8');
  assert.equal(/providerExecution\.ts|from '\.\/compose\.ts'/.test(boot), false);
});

test('the external execution module only mutates after the stored gate and durable DISPATCHING transition (structure)', () => {
  const source = readFileSync(join(ROOT, 'src/app/target/externalOfferExecution.ts'), 'utf8');
  const prepare = source.indexOf('createPreparedExecutionAttempt(ctx.uow()');
  const dispatch = source.indexOf('worker.dispatchClaimed(');
  const mutate = source.indexOf('deps.transactions.createOrder(');
  assert.ok(prepare > 0 && dispatch > prepare, 'gate + durable PREPARED attempt precede dispatch');
  assert.ok(mutate > 0, 'the dispatcher is the only mutation site');
  const worker = readFileSync(join(ROOT, 'src/persistence/postgres/execution/pgExecutionWorker.ts'), 'utf8');
  assert.ok(worker.indexOf("to: 'DISPATCHING'") < worker.indexOf('await params.dispatcher(claim'), 'DISPATCHING is committed before the dispatcher runs');
  // N1: the provider order reference is durably checkpointed BEFORE the pay call.
  assert.ok(source.indexOf('control.checkpointRequestRef(') > mutate && source.indexOf('control.checkpointRequestRef(') < source.indexOf('deps.transactions.payOrder('), 'orderRef checkpoint precedes payOrder');
});

test('the stay executor only mutates after a durable attempt and reconciles known success into canonical state', () => {
  const source = readFileSync(join(ROOT, 'src/app/target/externalStayExecution.ts'), 'utf8');
  const prepare = source.indexOf('createPreparedExecutionAttempt(ctx.uow()');
  const dispatch = source.indexOf('worker.dispatchClaimed(');
  const book = source.indexOf('hotel.bookStay(');
  const cancel = source.indexOf('hotel.cancelStay(');
  assert.ok(prepare > 0 && dispatch > prepare, 'a durable PREPARED attempt precedes stay dispatch');
  assert.ok(book > 0 && cancel > 0, 'stay mutations are confined to this executor');
  assert.ok(source.indexOf('applyPendingCanonicalUpdates(ctx,canonical)') > 0, 'reconciled success retries canonical application without a second provider dispatch');
});

test('a refreshed stay quote with changed amount or currency refuses before booking; matching terms carry the approved payment reference', async () => {
  const meta = (): CapabilityMeta => ({ providerId: 'nuitee', mode: 'RECORD', requestedAt: '2030-01-01T00:00:00.000Z' });
  const inputs = {
    ready: true as const,
    binding: {
      id: 'binding', recoveryStrategyId: 'strategy', journeyId: 'journey', action: 'BOOK' as const, providerId: 'nuitee',
      providerRateId: 'rate-1', quoteHandle: 'quoted-1', quotedAmount: '100.00', quotedCurrency: 'USD',
    },
    travellerId: 'traveller', guestNames: ['Jane Connection'],
  };
  for (const quotedPrice of [{ amount: 101, currency: 'USD' }, { amount: 100, currency: 'PHP' }]) {
    let books = 0;
    const hotel = {
      quoteRate: async () => capabilityOk({ status: 'QUOTED' as const, quoteId: 'fresh-quote', quotedPrice }, meta()),
      bookStay: async () => { books += 1; throw new Error('booking must not be reached'); },
      retrieveBooking: async () => { throw new Error('retrieval must not be reached'); },
    } as never;
    const result = await buildNuiteeStayDispatcher(hotel, inputs, { amount: 100, currency: 'USD' }, 'intent-1', 'sandbox-payment')({} as never, { checkpointRequestRef: async () => true });
    assert.deepEqual(result, { kind: 'FAILURE', error: 'stay_quote_changed: re-enter authority' });
    assert.equal(books, 0);
  }
  let passedPaymentRef: string | undefined;
  const hotel = {
    quoteRate: async () => capabilityOk({ status: 'QUOTED' as const, quoteId: 'fresh-quote', quotedPrice: { amount: 100, currency: 'USD' } }, meta()),
    bookStay: async (request: { paymentRef?: string }) => {
      passedPaymentRef = request.paymentRef;
      return capabilityOk({ confirmed: true, bookingId: 'booking-1', totalPrice: { amount: 100, currency: 'USD' }, provenance: 'LIVE' as const }, meta());
    },
    retrieveBooking: async () => capabilityOk({ bookingId: 'booking-1', status: 'CONFIRMED' as const }, meta()),
  } as never;
  const result = await buildNuiteeStayDispatcher(hotel, inputs, { amount: 100, currency: 'USD' }, 'intent-1', 'sandbox-payment')({} as never, { checkpointRequestRef: async () => true });
  assert.equal(result.kind, 'SUCCESS');
  assert.equal(passedPaymentRef, 'sandbox-payment');
});

test('an ambiguous stay client-reference lookup stays unknown for zero or multiple matches and cannot redispatch', async () => {
  const meta = (): CapabilityMeta => ({ providerId: 'nuitee', mode: 'RECORD', requestedAt: '2030-01-01T00:00:00.000Z' });
  for (const bookings of [[], [
    { bookingId: 'booking-1', clientReference: 'ns-stay-test' },
    { bookingId: 'booking-2', clientReference: 'ns-stay-test' },
  ]]) {
    let lookups = 0;
    let mutations = 0;
    const pool = { query: async () => ({ rows: [{ request_ref: 'nuitee:clientref:ns-stay-test' }] }) } as never;
    const hotel = {
      findBookingsByClientReference: async () => { lookups += 1; return capabilityOk({ bookings }, meta()); },
      retrieveBooking: async () => { throw new Error('ambiguous result must not retrieve'); },
      bookStay: async () => { mutations += 1; throw new Error('reconciliation never books'); },
      cancelStay: async () => { mutations += 1; throw new Error('reconciliation never cancels'); },
    } as never;
    const result = await buildNuiteeStayReconcileLookup(pool, hotel)({ workspaceId: 'workspace', id: 'attempt' } as never);
    assert.deepEqual(result, { kind: 'STILL_UNKNOWN' });
    assert.equal(lookups, 1);
    assert.equal(mutations, 0);
  }
});

import { requiredAuthorityScope } from '../src/persistence/postgres/execution/storedExecutionGate.ts';

test('B1: a JOURNEY_ITEM requirement is dropped only when its own owning journey is required', () => {
  const item = { kind: 'JOURNEY_ITEM', id: 'item-2' } as never;
  const j1 = { kind: 'JOURNEY', id: 'j1' } as never;
  const j2 = { kind: 'JOURNEY', id: 'j2' } as never;
  const kinds = (refs: { kind: string; id: string }[]) => refs.map((r) => `${r.kind}:${r.id}`);
  // item owned by j2, but only j1 is resolved: the item stays required (no weaker authority).
  assert.deepEqual(kinds(requiredAuthorityScope([item], [j1], new Map([['item-2', 'j2']]))), ['JOURNEY:j1', 'JOURNEY_ITEM:item-2']);
  // unknown owner: fail closed.
  assert.ok(kinds(requiredAuthorityScope([item], [j1])).includes('JOURNEY_ITEM:item-2'));
  // owner resolved: the item is covered by its journey.
  assert.deepEqual(kinds(requiredAuthorityScope([item], [j1, j2], new Map([['item-2', 'j2']]))), ['JOURNEY:j1', 'JOURNEY:j2']);
  // OFFER refs are never independent requirements.
  assert.deepEqual(kinds(requiredAuthorityScope([{ kind: 'OFFER', id: 'o' } as never], [j1])), ['JOURNEY:j1']);
});

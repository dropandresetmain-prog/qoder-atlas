/**
 * R4-F2e (review N3) — an Atlas duplicate-detection hit (order.do status 318) is a pointer, never
 * proof. Before the external dispatcher adopts or pays the pointed-at order it must retrieve it
 * read-only and prove it is the current approved intent's order.
 *
 * No database: the pure validator, the Atlas normalizers, the recording sanitizer and the real
 * dispatcher (driven with a fake provider and a fake checkpoint control).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateExistingOrder, type ExpectedOrderTerms } from '../src/app/target/existingOrderValidation.ts';
import { buildAtlasOfferDispatcher, type ExternalOfferExecutionDeps } from '../src/app/target/externalOfferExecution.ts';
import { atlasOrderIdentity, normalizeOrderCreate, normalizeOrderDetails, ATLAS_SANDBOX_BALANCE_PAYMENT_REF } from '../src/providers/atlas/transactionAdapter.ts';
import { atlasScheduleToIso } from '../src/providers/atlas/normalize.ts';
import { sanitizeRaw } from '../src/providers/sanitize.ts';
import { capabilityOk } from '../src/contracts/envelope.ts';
import type { CapabilityMeta } from '../src/contracts/envelope.ts';
import type { FlightOrderIdentity, FlightOrderStatus, FlightOrderStatusView, FlightTransactionCapability } from '../src/contracts/capabilities.ts';

const TZ = 'Asia/Manila';
const expected: ExpectedOrderTerms = {
  passengers: [{ givenName: 'Jane', familyName: 'Connection', gender: 'FEMALE', nationality: 'PH' }],
  contactEmail: 'r4.traveller@example.com',
  origin: { code: 'MNL', timeZone: TZ },
  destination: { code: 'CEB', timeZone: TZ },
  departure: atlasScheduleToIso('202611031220', TZ),
  arrival: atlasScheduleToIso('202611031355', TZ),
  ceiling: { amount: 40, currency: 'USD' },
  quoted: { amount: 31.29, currency: 'USD' },
};

const identity = (over: Partial<FlightOrderIdentity> = {}): FlightOrderIdentity => ({
  passengers: [{ familyName: 'CONNECTION', givenName: 'JANE', gender: 'FEMALE', nationality: 'PH' }],
  contactEmails: ['R4.Traveller@example.com'],
  segments: [{ carrier: 'Z2', flightNumber: 'Z2783', originCode: 'MNL', destinationCode: 'CEB', departureLocal: '202611031220', arrivalLocal: '202611031355' }],
  ...over,
});
const view = (over: Partial<FlightOrderStatusView> = {}): FlightOrderStatusView => ({
  orderRef: 'TESTA-EXISTING', status: 'HELD', provenance: 'LIVE', totalPrice: { amount: 31.29, currency: 'USD' }, identity: identity(), ...over,
});

test('exact intended duplicate -> MATCH (case-insensitive names/e-mail; instants compared through the airport zones)', () => {
  assert.deepEqual(validateExistingOrder(view(), expected), { verdict: 'MATCH', orderStatus: 'HELD' });
  assert.deepEqual(validateExistingOrder(view({ status: 'TICKETED' }), expected), { verdict: 'MATCH', orderStatus: 'TICKETED' });
});

test('wrong traveller / party -> MISMATCH', () => {
  const other = validateExistingOrder(view({ identity: identity({ passengers: [{ familyName: 'STRANGER', givenName: 'SAM', gender: 'FEMALE' }] }) }), expected);
  assert.equal(other.verdict, 'MISMATCH');
  assert.ok(other.verdict === 'MISMATCH' && other.reasons.includes('passenger_mismatch'));
  const twoPax = validateExistingOrder(view({ identity: identity({ passengers: [{ familyName: 'CONNECTION', givenName: 'JANE', gender: 'FEMALE' }, { familyName: 'EXTRA', givenName: 'PAX', gender: 'MALE' }] }) }), expected);
  assert.ok(twoPax.verdict === 'MISMATCH' && twoPax.reasons.includes('passenger_count_mismatch'));
  const gender = validateExistingOrder(view({ identity: identity({ passengers: [{ familyName: 'CONNECTION', givenName: 'JANE', gender: 'MALE' }] }) }), expected);
  assert.ok(gender.verdict === 'MISMATCH' && gender.reasons.includes('passenger_gender_mismatch'));
  const booker = validateExistingOrder(view({ identity: identity({ contactEmails: ['someone.else@example.com'] }) }), expected);
  assert.ok(booker.verdict === 'MISMATCH' && booker.reasons.includes('contact_mismatch'));
});

test('wrong itinerary / offer (destination, departure, arrival) -> MISMATCH', () => {
  const seg = (over: object) => identity({ segments: [{ originCode: 'MNL', destinationCode: 'CEB', departureLocal: '202611031220', arrivalLocal: '202611031355', ...over }] });
  const dest = validateExistingOrder(view({ identity: seg({ destinationCode: 'DVO' }) }), expected);
  assert.ok(dest.verdict === 'MISMATCH' && dest.reasons.includes('destination_mismatch'));
  const later = validateExistingOrder(view({ identity: seg({ departureLocal: '202611031820', arrivalLocal: '202611032005' }) }), expected);
  assert.ok(later.verdict === 'MISMATCH' && later.reasons.includes('departure_time_mismatch') && later.reasons.includes('arrival_time_mismatch'));
  const otherDay = validateExistingOrder(view({ identity: seg({ departureLocal: '202611041220' }) }), expected);
  assert.equal(otherDay.verdict, 'MISMATCH');
});

test('wrong price / currency -> MISMATCH; a cancelled order is unusable', () => {
  const dear = validateExistingOrder(view({ totalPrice: { amount: 40.01, currency: 'USD' } }), expected);
  assert.ok(dear.verdict === 'MISMATCH' && dear.reasons.includes('price_exceeds_authorised_ceiling'));
  const fx = validateExistingOrder(view({ totalPrice: { amount: 1, currency: 'PHP' } }), expected);
  assert.ok(fx.verdict === 'MISMATCH' && fx.reasons.includes('price_currency_mismatch'));
  assert.equal(validateExistingOrder(view({ status: 'CANCELLED' }), expected).verdict, 'MISMATCH');
  assert.equal(validateExistingOrder(view({ status: 'FAILED' }), expected).verdict, 'MISMATCH');
});

test('ambiguous / insufficient identity -> INSUFFICIENT (fail closed)', () => {
  const noIdentity = validateExistingOrder(view({ identity: undefined as never }), expected);
  assert.deepEqual(noIdentity.verdict, 'INSUFFICIENT');
  const { identity: _dropped, ...noId } = view();
  assert.equal(validateExistingOrder(noId as FlightOrderStatusView, expected).verdict, 'INSUFFICIENT');
  assert.equal(validateExistingOrder(view({ identity: identity({ contactEmails: [] }) }), expected).verdict, 'INSUFFICIENT');
  assert.equal(validateExistingOrder(view({ status: 'UNKNOWN' }), expected).verdict, 'INSUFFICIENT');
  const { totalPrice: _price, ...noPrice } = view();
  assert.equal(validateExistingOrder(noPrice as FlightOrderStatusView, expected).verdict, 'INSUFFICIENT');
  assert.equal(validateExistingOrder(view({ identity: identity({ passengers: [{ familyName: 'CONNECTION', givenName: 'JANE' }] }) }), expected).verdict, 'INSUFFICIENT');
  assert.equal(validateExistingOrder(view(), { ...expected, departure: null }).verdict, 'INSUFFICIENT', 'a binding without itinerary times cannot prove the itinerary');
  assert.equal(validateExistingOrder(view({ identity: identity({ segments: [{ originCode: 'MNL', destinationCode: 'CEB', departureLocal: 'garbage', arrivalLocal: '202611031355' }] }) }), expected).verdict, 'INSUFFICIENT');
});

// ---- Atlas wire -> generic identity ---------------------------------------------------------

const WIRE = {
  status: 0, msg: 'success', orderNo: 'TESTA-EXISTING', orderStatus: '0', totalPrice: 31.29, currency: 'USD',
  paxTicketInfos: [{ name: 'CONNECTION/JANE', passengerType: 0, birthday: '19900131', gender: 'F', nationality: 'PH', ticketNos: [], contactEmails: ['r4.traveller@example.com'] }],
  routing: { routingIdentifier: 'opaque', fromSegments: [{ carrier: 'Z2', flightNumber: 'Z2783', depAirport: 'MNL', depTime: '202611031220', arrAirport: 'CEB', arrTime: '202611031355' }], retSegments: [] },
};

test('Atlas order details expose passenger/itinerary/contact identity; unparseable shapes expose none', () => {
  const parsed = normalizeOrderDetails(WIRE as never, 'TESTA-EXISTING', 'LIVE');
  assert.equal(parsed.status, 'HELD');
  assert.deepEqual(parsed.identity, {
    passengers: [{ familyName: 'CONNECTION', givenName: 'JANE', gender: 'FEMALE', dateOfBirth: '1990-01-31', nationality: 'PH' }],
    segments: [{ carrier: 'Z2', flightNumber: 'Z2783', originCode: 'MNL', destinationCode: 'CEB', departureLocal: '202611031220', arrivalLocal: '202611031355' }],
    contactEmails: ['r4.traveller@example.com'],
  });
  assert.equal(validateExistingOrder(parsed, expected).verdict, 'MATCH');
  assert.equal(atlasOrderIdentity({ ...WIRE, paxTicketInfos: [{ name: '[REDACTED]' }] } as never), undefined, 'a redacted (replayed) name proves nothing');
  assert.equal(atlasOrderIdentity({ ...WIRE, routing: null } as never), undefined);
  assert.equal(atlasOrderIdentity({ ...WIRE, routing: { ...WIRE.routing, retSegments: [{ flightNumber: 'Z2784' }] } } as never), undefined, 'a return itinerary is not representable => no identity => fail closed');
});

test('status 318 still yields the legacy adoption AND flags it as an unproven pointer with every candidate ref', () => {
  const out = normalizeOrderCreate({ status: 318, duplicateOrders: ['A-1', { orderNo: 'A-2' }, 'A-1'] } as never, 'LIVE');
  assert.equal(out.status, 'HELD');
  assert.equal(out.transactionState?.orderRef, 'A-1');
  assert.deepEqual(out.duplicateOfExisting, { orderRefs: ['A-1', 'A-2'] });
  assert.equal(normalizeOrderCreate({ status: 0, orderNo: 'N-1' } as never, 'LIVE').duplicateOfExisting, undefined);
});

test('recordings never keep passenger identity: paxTicketInfos names/birthdays/contacts are redacted, shape preserved', () => {
  const clean = sanitizeRaw({ ...WIRE, paxTicketInfos: [{ ...WIRE.paxTicketInfos[0]!, contactPhones: ['0086-1'], cardNum: '' }] }) as typeof WIRE;
  const pax = clean.paxTicketInfos[0] as Record<string, unknown>;
  assert.equal(pax['name'], '[REDACTED]');
  assert.equal(pax['birthday'], '[REDACTED]');
  assert.deepEqual(pax['contactEmails'], ['[REDACTED]']);
  assert.deepEqual(pax['contactPhones'], ['[REDACTED]']);
  assert.equal(pax['gender'], 'F');
  assert.equal(pax['cardNum'], '');
  assert.equal(JSON.stringify(clean).includes('CONNECTION'), false);
});

// ---- The real dispatcher against a fake provider --------------------------------------------

function harness(create: { refs: string[] | undefined; existing?: Partial<FlightOrderStatusView> | 'UNREADABLE'; existingStatus?: FlightOrderStatus }, withExpected = true) {
  const calls = { create: 0, pay: 0, retrieve: 0 };
  const checkpoints: string[] = [];
  const meta = (): CapabilityMeta => ({ providerId: 'atlas', mode: 'RECORD', requestedAt: new Date().toISOString() });
  let status: FlightOrderStatus = create.existingStatus ?? 'HELD';
  const transactions = {
    descriptor: { family: 'FLIGHT', providerId: 'atlas', mode: 'RECORD', supportedOperations: [], maxSideEffectLevel: 'MONEY_MOVING' },
    async createOrder() {
      calls.create += 1;
      return capabilityOk(create.refs
        ? { status: 'HELD' as const, provenance: 'LIVE' as const, transactionState: { orderRef: create.refs[0]! }, duplicateOfExisting: { orderRefs: create.refs } }
        : { status: 'HELD' as const, provenance: 'LIVE' as const, transactionState: { orderRef: 'NEW-1' }, totalPrice: { amount: 31.29, currency: 'USD' } }, meta());
    },
    async payOrder() { calls.pay += 1; status = 'TICKETED'; return capabilityOk({ status: 'PAID' as const, provenance: 'LIVE' as const }, meta()); },
    async retrieveOrder(q: { orderRef: string }) {
      calls.retrieve += 1;
      if (create.existing === 'UNREADABLE') return { ok: false as const, error: { category: 'NETWORK' as const, code: 'x', message: 'x' }, meta: meta() };
      return capabilityOk({ ...view({ orderRef: q.orderRef, status }), ...(create.existing ?? {}), ...(create.existing && 'status' in create.existing ? {} : { status }) }, meta());
    },
  } as unknown as FlightTransactionCapability;
  const deps: ExternalOfferExecutionDeps = {
    flight: { async verifyOffer() { return capabilityOk({ status: 'VERIFIED', workflowState: { sessionId: 's' } }, meta()); } } as never,
    transactions, mode: 'RECORD', paymentRef: ATLAS_SANDBOX_BALANCE_PAYMENT_REF, ticketingPoll: { attempts: 2, delayMs: 0 }, sleep: async () => undefined,
  };
  const inputs = {
    ready: true, binding: { providerOfferRef: 'offer-ref' }, contactName: 'Connection/Jane', contactEmail: expected.contactEmail,
    passengers: [{ givenName: 'Jane', familyName: 'Connection', gender: 'FEMALE' }],
  } as never;
  const counters = { verify: 0, create: 0, pay: 0 };
  const run = () => buildAtlasOfferDispatcher(deps, inputs, expected.ceiling, 'intent-1', counters, withExpected ? expected : undefined)(
    {} as never, { checkpointRequestRef: async (ref: string) => { checkpoints.push(ref); return true; } },
  );
  return { calls, checkpoints, run };
}

test('dispatcher: exactly the intended HELD duplicate is adopted (checkpointed) and then paid once, within the ceiling', async () => {
  const h = harness({ refs: ['TESTA-EXISTING'] });
  const result = await h.run();
  assert.equal(result.kind, 'SUCCESS');
  assert.deepEqual(h.checkpoints, ['atlas:order:TESTA-EXISTING']);
  assert.equal(h.calls.pay, 1);
  assert.equal(h.calls.create, 1);
});

test('dispatcher: an already TICKETED exact duplicate is adopted WITHOUT any payment', async () => {
  const h = harness({ refs: ['TESTA-EXISTING'], existingStatus: 'TICKETED' });
  const result = await h.run();
  assert.equal(result.kind, 'SUCCESS');
  assert.equal(h.calls.pay, 0, 'never a second charge');
  assert.deepEqual(h.checkpoints, ['atlas:order:TESTA-EXISTING']);
});

test('dispatcher: wrong traveller / itinerary / price duplicate -> FAILURE, no adopt (no checkpoint), no pay', async () => {
  const cases: Array<Partial<FlightOrderStatusView>> = [
    { identity: identity({ passengers: [{ familyName: 'STRANGER', givenName: 'SAM', gender: 'FEMALE' }] }) },
    { identity: identity({ segments: [{ originCode: 'MNL', destinationCode: 'DVO', departureLocal: '202611031220', arrivalLocal: '202611031355' }] }) },
    { totalPrice: { amount: 99, currency: 'USD' } },
    { totalPrice: { amount: 31.29, currency: 'PHP' } },
  ];
  for (const existing of cases) {
    const h = harness({ refs: ['TESTA-EXISTING'], existing });
    const result = await h.run();
    assert.equal(result.kind, 'FAILURE');
    assert.match((result as { error: string }).error, /duplicate_order_mismatch/);
    assert.deepEqual(h.checkpoints, []);
    assert.equal(h.calls.pay, 0);
  }
});

test('dispatcher: ambiguous / insufficient identity, unreadable order, several candidates or no approved terms -> unknown for a human; never paid, never a reconcile key', async () => {
  const unproven: Array<ReturnType<typeof harness>> = [
    harness({ refs: ['A'], existing: { identity: undefined as never } }),
    harness({ refs: ['A'], existing: 'UNREADABLE' }),
    harness({ refs: ['A', 'B'] }),
    harness({ refs: ['A'] }, false),
    harness({ refs: ['A'], existing: { identity: identity({ contactEmails: [] }) } }),
  ];
  for (const h of unproven) {
    const result = await h.run();
    assert.equal(result.kind, 'LOST_RESPONSE');
    assert.match((result as { requestRef: string }).requestRef, /^atlas:duplicate-unproven:/, 'not the reconcile key atlas:order:');
    assert.deepEqual(h.checkpoints, []);
    assert.equal(h.calls.pay, 0);
  }
});

test('dispatcher: a normal (non-duplicate) create is unchanged: checkpoint then pay', async () => {
  const h = harness({ refs: undefined });
  const result = await h.run();
  assert.equal(result.kind, 'SUCCESS');
  assert.deepEqual(h.checkpoints, ['atlas:order:NEW-1']);
  assert.equal(h.calls.pay, 1);
});

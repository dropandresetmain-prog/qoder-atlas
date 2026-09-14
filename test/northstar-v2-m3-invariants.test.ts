/**
 * M3 evidence — pure contract and boundary invariants.
 *
 * Database-backed lifecycle, allocation and stale-observation behaviour is
 * covered by postgres-integration/m3*.pgtest.ts. These checks keep the
 * deterministic rules visible without requiring a provider or database.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OfferSchema,
  ReservationAllocationSchema,
  ReservationSchema,
  ReservationLineSchema,
  ServiceEntitlementSchema,
  allocationMatchesJourneyTraveller,
  isOfferExpired,
} from '../src/domain/v2/arrangements/reservation.ts';
import { addExactMoney } from '../src/domain/v2/shared/money.ts';
import { capabilityOutcome, offerIsExecutable } from '../src/persistence/postgres/commands/arrangementCommands.ts';

const instant = '2026-09-14T09:00:00Z';
const evidenceId = '11111111-1111-4111-8111-111111111111';

test('M3: allocation is explicit and cannot borrow a Journey traveller', () => {
  const allocation = ReservationAllocationSchema.parse({
    id: 'allocation-1',
    reservationId: 'reservation-1',
    reservationLineId: 'line-1',
    travellerId: 'traveller-a',
    journeyItemId: 'journey-item-1',
    allocationRole: 'PRIMARY',
  });

  assert.equal(allocationMatchesJourneyTraveller(allocation, 'traveller-a'), true);
  assert.equal(allocationMatchesJourneyTraveller(allocation, 'traveller-b'), false);
  assert.equal(
    allocationMatchesJourneyTraveller({ travellerId: 'traveller-a' }, undefined),
    true,
  );
});

test('M3: known line status needs observation time while UNKNOWN remains explicit', () => {
  assert.equal(ReservationSchema.safeParse({
    id: 'reservation-unknown',
    revision: 1,
    reservationType: 'TRANSPORT',
    observedStatus: 'UNKNOWN',
    observedStatusAt: instant,
    responsibleTravellerId: 'traveller-a',
  }).success, false);
  assert.equal(ReservationLineSchema.safeParse({
    id: 'line-unknown',
    reservationId: 'reservation-1',
    productType: 'TRANSPORT',
    observedStatus: 'UNKNOWN',
  }).success, true);
  assert.equal(ReservationLineSchema.safeParse({
    id: 'line-confirmed-without-time',
    reservationId: 'reservation-1',
    productType: 'TRANSPORT',
    observedStatus: 'CONFIRMED',
  }).success, false);
  assert.equal(ReservationLineSchema.safeParse({
    id: 'line-confirmed',
    reservationId: 'reservation-1',
    productType: 'TRANSPORT',
    observedStatus: 'CONFIRMED',
    observedStatusAt: instant,
  }).success, true);
});

test('M3: entitlement issuance is evidence-backed and separate from confirmation', () => {
  assert.equal(ServiceEntitlementSchema.safeParse({
    id: 'entitlement-unknown',
    entitlementType: 'TICKET',
    observedStatus: 'UNKNOWN',
  }).success, true);
  assert.equal(ServiceEntitlementSchema.safeParse({
    id: 'entitlement-issued-without-evidence',
    entitlementType: 'TICKET',
    observedStatus: 'ISSUED',
    observedStatusAt: instant,
  }).success, false);
  assert.equal(ServiceEntitlementSchema.safeParse({
    id: 'entitlement-issued',
    entitlementType: 'TICKET',
    observedStatus: 'ISSUED',
    observedStatusAt: instant,
    evidenceId,
  }).success, true);
});

test('M3: offers expire at the boundary and executable checks remain deterministic', () => {
  const offer = OfferSchema.parse({
    id: 'offer-1',
    sourceId: 'source-1',
    price: { amount: '100.01', currency: 'SGD' },
    quotedAt: instant,
    expiresAt: '2026-09-14T10:00:00Z',
    fingerprint: 'offer-fingerprint-1',
  });

  assert.equal(isOfferExpired(offer, '2026-09-14T09:59:59Z'), false);
  assert.equal(isOfferExpired(offer, '2026-09-14T10:00:00Z'), true);
  assert.equal(offerIsExecutable(offer, '2026-09-14T09:59:59Z').ok, true);
  assert.equal(offerIsExecutable(offer, '2026-09-14T10:00:00Z').ok, false);
});

test('M3: capability and money decisions do not infer missing facts or use floats', () => {
  assert.equal(capabilityOutcome(undefined).ok, false);
  assert.equal(capabilityOutcome({ supported: false }).ok, false);
  assert.equal(capabilityOutcome({ supported: true }).ok, true);
  assert.deepEqual(
    addExactMoney({ amount: '999999999999999999.99', currency: 'SGD' }, { amount: '0.01', currency: 'SGD' }),
    { amount: '1000000000000000000.00', currency: 'SGD' },
  );
  assert.throws(() => addExactMoney({ amount: '1.00', currency: 'SGD' }, { amount: '1.00', currency: 'USD' }));
});

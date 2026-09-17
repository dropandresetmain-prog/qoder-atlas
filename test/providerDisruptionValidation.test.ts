/**
 * F6 — Provider Disruption Event Schema Validation
 *
 * Unit tests for validateProviderDisruptionEvent and TRANSPORT_MODES.
 * No database required — pure schema validation.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { validateProviderDisruptionEvent, TRANSPORT_MODES } from '../src/app/target/providerDisruptionIngress.ts';

describe('F6 provider disruption event validation', () => {
  const validMinimalEvent = {
    kind: 'TRANSPORT_SERVICE_CANCELLED_WITH_REPROTECTION',
    providerId: 'test-provider',
    providerEventId: 'test-event-001',
    receivedAt: '2026-09-21T01:40:00.000Z',
    disclosedAsSimulatedDemoInput: true,
    originalService: {
      recordType: 'SOURCE_TRANSPORT_SERVICE',
      externalId: 'ID7159@2026-09-30T10:45:00.000Z',
    },
    replacementService: {
      recordType: 'SOURCE_TRANSPORT_SERVICE',
      externalId: 'ID7153@2026-10-01T00:45:00.000Z',
      operator: 'ID',
      scheduledDeparture: '2026-10-01T07:45:00+07:00',
      scheduledArrival: '2026-10-01T10:30:00+08:00',
    },
    affectedBookings: [
      { recordType: 'SOURCE_BOOKING_REFERENCE', externalId: 'IDSYN14' },
    ],
    reason: 'Test disruption reason',
    provenanceKind: 'SCHEDULE_CHANGE',
  };

  test('valid minimal event passes validation', () => {
    const result = validateProviderDisruptionEvent(validMinimalEvent);
    assert.equal(result.ok, true, 'valid event should pass');
    if (result.ok) {
      assert.equal(result.event.kind, 'TRANSPORT_SERVICE_CANCELLED_WITH_REPROTECTION');
      assert.equal(result.event.providerId, 'test-provider');
      assert.equal(result.event.providerEventId, 'test-event-001');
    }
  });

  test('wrong kind → fail message mentions kind', () => {
    const badEvent = { ...validMinimalEvent, kind: 'TRANSPORT_SCHEDULE_OBSERVED' };
    const result = validateProviderDisruptionEvent(badEvent);
    assert.equal(result.ok, false, 'wrong kind should fail');
    if (!result.ok) {
      assert.ok(result.message.toLowerCase().includes('kind'), `message should mention kind: ${result.message}`);
    }
  });

  test('disclosedAsSimulatedDemoInput !== true → fail', () => {
    const badEvent = { ...validMinimalEvent, disclosedAsSimulatedDemoInput: false };
    const result = validateProviderDisruptionEvent(badEvent);
    assert.equal(result.ok, false, 'non-true disclosedAsSimulatedDemoInput should fail');
    if (!result.ok) {
      assert.ok(result.message.toLowerCase().includes('disclosed'), `message should mention disclosed: ${result.message}`);
    }
  });

  test('missing providerEventId → fail', () => {
    const badEvent = { ...validMinimalEvent, providerEventId: '' };
    const result = validateProviderDisruptionEvent(badEvent);
    assert.equal(result.ok, false, 'empty providerEventId should fail');
    if (!result.ok) {
      assert.ok(result.message.toLowerCase().includes('providereventid'), `message should mention providerEventId: ${result.message}`);
    }
  });

  test('unparsable receivedAt → fail', () => {
    const badEvent = { ...validMinimalEvent, receivedAt: 'not-a-date' };
    const result = validateProviderDisruptionEvent(badEvent);
    assert.equal(result.ok, false, 'unparsable receivedAt should fail');
    if (!result.ok) {
      assert.ok(result.message.toLowerCase().includes('receivedat'), `message should mention receivedAt: ${result.message}`);
    }
  });

  test('replacementService.externalId empty → fail', () => {
    const badEvent = {
      ...validMinimalEvent,
      replacementService: { ...validMinimalEvent.replacementService, externalId: '' },
    };
    const result = validateProviderDisruptionEvent(badEvent);
    assert.equal(result.ok, false, 'empty replacementService.externalId should fail');
    if (!result.ok) {
      assert.ok(result.message.toLowerCase().includes('externalid'), `message should mention externalId: ${result.message}`);
    }
  });

  test('scheduledDeparture not an instant → fail', () => {
    const badEvent = {
      ...validMinimalEvent,
      replacementService: { ...validMinimalEvent.replacementService, scheduledDeparture: 'not-an-instant' },
    };
    const result = validateProviderDisruptionEvent(badEvent);
    assert.equal(result.ok, false, 'non-instant scheduledDeparture should fail');
    if (!result.ok) {
      assert.ok(result.message.toLowerCase().includes('instant') || result.message.toLowerCase().includes('departure'), `message should mention instant/departure: ${result.message}`);
    }
  });

  test('mode present but outside TRANSPORT_MODES (e.g. "BOAT") → fail mentioning mode', () => {
    const badEvent = {
      ...validMinimalEvent,
      replacementService: { ...validMinimalEvent.replacementService, mode: 'BOAT' },
    };
    const result = validateProviderDisruptionEvent(badEvent);
    assert.equal(result.ok, false, 'invalid mode should fail');
    if (!result.ok) {
      assert.ok(result.message.toLowerCase().includes('mode'), `message should mention mode: ${result.message}`);
      // Verify TRANSPORT_MODES does not include BOAT
      assert.ok(!TRANSPORT_MODES.includes('BOAT' as typeof TRANSPORT_MODES[number]), 'BOAT should not be in TRANSPORT_MODES');
    }
  });

  test('mode "RAIL" passes', () => {
    const railEvent = {
      ...validMinimalEvent,
      replacementService: { ...validMinimalEvent.replacementService, mode: 'RAIL' },
    };
    const result = validateProviderDisruptionEvent(railEvent);
    assert.equal(result.ok, true, 'RAIL mode should pass');
    assert.ok(TRANSPORT_MODES.includes('RAIL'), 'RAIL should be in TRANSPORT_MODES');
  });

  test('TRANSPORT_MODES contains expected values', () => {
    assert.ok(TRANSPORT_MODES.includes('AIR'), 'TRANSPORT_MODES should include AIR');
    assert.ok(TRANSPORT_MODES.includes('RAIL'), 'TRANSPORT_MODES should include RAIL');
    assert.ok(TRANSPORT_MODES.includes('ROAD'), 'TRANSPORT_MODES should include ROAD');
    assert.ok(TRANSPORT_MODES.includes('SEA'), 'TRANSPORT_MODES should include SEA');
  });
});

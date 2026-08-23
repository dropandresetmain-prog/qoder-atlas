/**
 * RV-N8 — routing + private-transfer reasoning evidence (Northstar Wave 2).
 *
 * Proves, on the real reasoning helpers:
 *  - transferWindowImpact classifies the consequence of a flight arrival
 *    change on a booked transfer pickup — STILL_OK / TIGHT / MISSED — from
 *    explicit duration and buffer parameters;
 *  - any UNKNOWN input (non-ISO string, negative buffer, invalid buffer
 *    ordering) yields UNKNOWN classification, never a guess;
 *  - routeContextFor honors CapabilityResult failure envelopes (external
 *    failure is data), and projects a RouteContext when the injected
 *    RoutingCapability returns ok.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  routeContextFor,
  transferWindowImpact,
} from '../src/providers/index.ts';
import type {
  CapabilityDescriptor,
  CapabilityResult,
  RouteContext,
  RoutingCapability,
  RoutingQuery,
} from '../src/contracts/index.ts';
import type { IsoDateTime } from '../src/domain/common.ts';

const DESCRIPTOR: CapabilityDescriptor = {
  family: 'ROUTING',
  providerId: 'scripted-routing',
  mode: 'REPLAY',
  supportedOperations: ['routing.context'],
  maxSideEffectLevel: 'READ_ONLY',
};

function scriptedRouting(scripted: CapabilityResult<RouteContext>): RoutingCapability {
  return {
    descriptor: DESCRIPTOR,
    async getRouteContext(_query: RoutingQuery): Promise<CapabilityResult<RouteContext>> {
      return scripted;
    },
  };
}

function scriptedSequence(responses: ReadonlyArray<CapabilityResult<RouteContext>>): RoutingCapability {
  let index = 0;
  return {
    descriptor: DESCRIPTOR,
    async getRouteContext(_query: RoutingQuery): Promise<CapabilityResult<RouteContext>> {
      const next = responses[Math.min(index, responses.length - 1)]!;
      index += 1;
      return next;
    },
  };
}

// ---------------------------------------------------------------------------
// transferWindowImpact classifications
// ---------------------------------------------------------------------------

test('RV-N8 transfer: STILL_OK when pickup follows arrival with at least minimum buffer', () => {
  const result = transferWindowImpact({
    flightArrival: '2026-09-01T10:00:00+08:00' as IsoDateTime,
    bookedPickupAt: '2026-09-01T10:45:00+08:00' as IsoDateTime,
    minimumBufferMinutes: 30,
    tightBufferMinutes: 10,
  });
  assert.equal(result.classification, 'STILL_OK');
  assert.equal(result.availableMinutes, 45);
  assert.match(result.reason, /at least 30 minute/);
});

test('RV-N8 transfer: TIGHT when buffer is below the comfortable target but at/above tight minimum', () => {
  const result = transferWindowImpact({
    flightArrival: '2026-09-01T10:00:00+08:00' as IsoDateTime,
    bookedPickupAt: '2026-09-01T10:15:00+08:00' as IsoDateTime,
    minimumBufferMinutes: 30,
    tightBufferMinutes: 10,
  });
  assert.equal(result.classification, 'TIGHT');
  assert.equal(result.availableMinutes, 15);
  assert.match(result.reason, /TIGHT|15 minute buffer/);
});

test('RV-N8 transfer: MISSED when buffer is below the tight minimum', () => {
  const result = transferWindowImpact({
    flightArrival: '2026-09-01T10:00:00+08:00' as IsoDateTime,
    bookedPickupAt: '2026-09-01T10:05:00+08:00' as IsoDateTime,
    minimumBufferMinutes: 30,
    tightBufferMinutes: 10,
  });
  assert.equal(result.classification, 'MISSED');
  assert.equal(result.availableMinutes, 5);
});

test('RV-N8 transfer: MISSED when flight arrives after the booked pickup time', () => {
  const result = transferWindowImpact({
    flightArrival: '2026-09-01T11:00:00+08:00' as IsoDateTime,
    bookedPickupAt: '2026-09-01T10:00:00+08:00' as IsoDateTime,
  });
  assert.equal(result.classification, 'MISSED');
  assert.equal(result.availableMinutes, -60);
  assert.match(result.reason, /arrives after the booked transfer pickup/);
});

test('RV-N8 transfer: defaults are applied when buffers are omitted', () => {
  // 25-minute buffer: below the default 30-minute minimum, above the
  // default 10-minute tight minimum -> TIGHT.
  const tight = transferWindowImpact({
    flightArrival: '2026-09-01T10:00:00+08:00' as IsoDateTime,
    bookedPickupAt: '2026-09-01T10:25:00+08:00' as IsoDateTime,
  });
  assert.equal(tight.classification, 'TIGHT');

  // 35-minute buffer: above the default 30-minute minimum -> STILL_OK.
  const stillOk = transferWindowImpact({
    flightArrival: '2026-09-01T10:00:00+08:00' as IsoDateTime,
    bookedPickupAt: '2026-09-01T10:35:00+08:00' as IsoDateTime,
  });
  assert.equal(stillOk.classification, 'STILL_OK');
});

// ---------------------------------------------------------------------------
// UNKNOWN honesty
// ---------------------------------------------------------------------------

test('RV-N8 transfer: UNKNOWN when flightArrival is not a valid IsoDateTime', () => {
  const result = transferWindowImpact({
    flightArrival: 'not-an-iso-string' as IsoDateTime,
    bookedPickupAt: '2026-09-01T10:00:00+08:00' as IsoDateTime,
  });
  assert.equal(result.classification, 'UNKNOWN');
  assert.equal(result.availableMinutes, undefined);
  assert.match(result.reason, /UTC offset|valid IsoDateTime/);
});

test('RV-N8 transfer: UNKNOWN when bookedPickupAt is not a valid IsoDateTime', () => {
  const result = transferWindowImpact({
    flightArrival: '2026-09-01T10:00:00+08:00' as IsoDateTime,
    // Date.parse is permissive about many strings, but the IsoDateTime
    // schema requires an explicit UTC offset. A bare datetime is therefore
    // rejected at the input boundary.
    bookedPickupAt: '2026-09-01T10:00' as IsoDateTime,
  });
  assert.equal(result.classification, 'UNKNOWN');
});

test('RV-N8 transfer: UNKNOWN when minimum buffer is negative', () => {
  const result = transferWindowImpact({
    flightArrival: '2026-09-01T10:00:00+08:00' as IsoDateTime,
    bookedPickupAt: '2026-09-01T10:45:00+08:00' as IsoDateTime,
    minimumBufferMinutes: -5,
  });
  assert.equal(result.classification, 'UNKNOWN');
  assert.match(result.reason, /non-negative integer/);
});

test('RV-N8 transfer: UNKNOWN when tight buffer exceeds the minimum buffer', () => {
  const result = transferWindowImpact({
    flightArrival: '2026-09-01T10:00:00+08:00' as IsoDateTime,
    bookedPickupAt: '2026-09-01T10:45:00+08:00' as IsoDateTime,
    minimumBufferMinutes: 10,
    tightBufferMinutes: 20,
  });
  assert.equal(result.classification, 'UNKNOWN');
  assert.match(result.reason, /≤ minimum buffer/);
});

test('RV-N8 transfer: UNKNOWN when buffers are non-integer', () => {
  const result = transferWindowImpact({
    flightArrival: '2026-09-01T10:00:00+08:00' as IsoDateTime,
    bookedPickupAt: '2026-09-01T10:45:00+08:00' as IsoDateTime,
    minimumBufferMinutes: 30.5,
  });
  assert.equal(result.classification, 'UNKNOWN');
});

// ---------------------------------------------------------------------------
// routeContextFor — projection of an injected RoutingCapability
// ---------------------------------------------------------------------------

test('RV-N8 routing: routeContextFor projects a RouteContext from a scripted capability', async () => {
  const scripted: CapabilityResult<RouteContext> = {
    ok: true,
    data: {
      duration: {
        expectedMinutes: 35,
        sourceId: 'src_scripted',
        observedAt: '2026-09-01T09:00:00+08:00' as IsoDateTime,
        quality: 'MEDIUM',
      },
      distanceKm: 12.4,
    },
    meta: {
      providerId: 'scripted-routing',
      mode: 'REPLAY',
      requestedAt: '2026-09-01T09:00:00+08:00' as IsoDateTime,
    },
  };
  const result = await routeContextFor({
    routing: scriptedRouting(scripted),
    query: {
      origin: { externalRef: { system: 'google_place_id', value: 'place-origin' } },
      destination: { externalRef: { system: 'google_place_id', value: 'place-destination' } },
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.context.duration.expectedMinutes, 35);
  assert.equal(result.context.distanceKm, 12.4);
});

test('RV-N8 routing: routeContextFor returns failure data, never throws on external failure', async () => {
  const failure: CapabilityResult<RouteContext> = {
    ok: false,
    error: { category: 'NETWORK', code: 'routing_unreachable', message: 'routing offline', retryable: true },
    meta: { providerId: 'scripted-routing', mode: 'REPLAY', requestedAt: '2026-09-01T09:00:00+08:00' as IsoDateTime },
  };
  const result = await routeContextFor({
    routing: scriptedRouting(failure),
    query: {
      origin: { externalRef: { system: 'google_place_id', value: 'place-origin' } },
      destination: { externalRef: { system: 'google_place_id', value: 'place-destination' } },
    },
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.unavailable, true);
  assert.equal(result.reason, 'routing offline');
  const envelope = result.envelope;
  assert.equal(envelope.ok, false);
  if (envelope.ok) return;
  assert.equal(envelope.error.code, 'routing_unreachable');
  assert.equal(envelope.error.retryable, true);
});

test('RV-N8 routing: routeContextFor projects the latest scripted response across calls', async () => {
  const ok: CapabilityResult<RouteContext> = {
    ok: true,
    data: { duration: { expectedMinutes: 22, sourceId: 'src_seq', observedAt: '2026-09-01T09:00:00+08:00' as IsoDateTime, quality: 'MEDIUM' } },
    meta: { providerId: 'scripted-routing', mode: 'REPLAY', requestedAt: '2026-09-01T09:00:00+08:00' as IsoDateTime },
  };
  const failure: CapabilityResult<RouteContext> = {
    ok: false,
    error: { category: 'UNAVAILABLE', code: 'routing_no_route', message: 'no route for this query' },
    meta: { providerId: 'scripted-routing', mode: 'REPLAY', requestedAt: '2026-09-01T09:00:00+08:00' as IsoDateTime },
  };
  const routing = scriptedSequence([ok, failure]);
  const first = await routeContextFor({
    routing,
    query: { origin: { externalRef: { system: 'google_place_id', value: 'p' } }, destination: { externalRef: { system: 'google_place_id', value: 'q' } } },
  });
  assert.equal(first.ok, true);
  const second = await routeContextFor({
    routing,
    query: { origin: { externalRef: { system: 'google_place_id', value: 'p' } }, destination: { externalRef: { system: 'google_place_id', value: 'q' } } },
  });
  assert.equal(second.ok, false);
  if (second.ok) return;
  assert.equal(second.unavailable, true);
  assert.equal(second.reason, 'no route for this query');
});

test('RV-N8 transfer reasoning: does not mutate inputs', () => {
  const inputs = {
    flightArrival: '2026-09-01T10:00:00+08:00' as IsoDateTime,
    bookedPickupAt: '2026-09-01T10:45:00+08:00' as IsoDateTime,
    minimumBufferMinutes: 30,
    tightBufferMinutes: 10,
  };
  const snapshot = JSON.stringify(inputs);
  const result = transferWindowImpact(inputs);
  assert.equal(JSON.stringify(inputs), snapshot, 'inputs must be unchanged after classification');
  assert.equal(result.classification, 'STILL_OK');
});

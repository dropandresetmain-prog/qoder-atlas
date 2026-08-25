/**
 * DR-3 — real-time flight-event ingress.
 *
 * Proves, over the REAL HTTP boundary (POST /api/events/atlas), never a
 * direct processDisruption shortcut:
 * - a documented/provider-shaped Atlas event persists, correlates,
 *   normalizes and reaches the ordinary supplier-disruption recovery
 *   pipeline (impact -> case);
 * - the raw event is persisted BEFORE processing, and duplicate delivery of
 *   the same providerEventId produces no duplicate signal/case/action;
 * - an invalid/unparseable payload fails structurally (never a crash);
 * - a payload whose order refs correlate to no known trip element fails
 *   structurally instead of guessing a trip;
 * - the resulting signal never carries AUTHORITATIVE/CONNECTED authority —
 *   ASSERTED is the ceiling for an unauthenticated delivery channel (ADR-044).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import type { AddressInfo } from 'node:net';

import { AppConfigSchema } from '../src/config/config.ts';
import { createAppServer } from '../src/server/http.ts';
import { composeAppRuntime } from '../src/app/compose.ts';
import { loadScenario } from '../src/scenarios/loader.ts';

const FIXTURES_ROOT = resolve('fixtures');
const SCENARIO_A_DIR = join(FIXTURES_ROOT, 'scenarios', 'anchor-event-speaker');

const runtimeConfig = AppConfigSchema.parse({
  environment: 'local',
  adapterMode: 'REPLAY',
  sqlitePath: ':memory:',
  fixturesDir: FIXTURES_ROOT,
  providers: { atlas: { env: 'sandbox' }, modelStudio: {}, googleRoutes: {} },
});

async function postJson(
  base: string,
  path: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function withServer(
  work: (base: string, composed: Awaited<ReturnType<typeof composeAppRuntime>>) => Promise<void>,
): Promise<void> {
  const composed = await composeAppRuntime(runtimeConfig);
  const server = createAppServer(runtimeConfig, composed.endpoints);
  await new Promise<void>((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await work(base, composed);
  } finally {
    await new Promise<void>((resolvePromise, reject) =>
      server.close((error) => (error ? reject(error) : resolvePromise())),
    );
    composed.db.close();
  }
}

/** A documented/provider-shaped Atlas event (event/getPageList.do record shape). */
function atlasEvent(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    eventId: 'evt-atlas-0001',
    orderNo: 'FL-A-1001', // matches el_a_flight_out's bookingRef.reference
    eventType: 'FLIGHT_CANCELLATION',
    eventStatus: 1,
    eventTime: '2026-09-12T06:00:00+00:00',
    createTime: '2026-09-12T06:00:00+00:00',
    airline: 'XX',
    pnr: 'PNR001',
    paxName: 'Test Traveller',
    paxEmail: 'traveller@example.test',
    ...overrides,
  };
}

test('DR-3.1: a documented Atlas-shaped supplier disruption reaches the ordinary recovery pipeline', async () => {
  await withServer(async (base) => {
    const at = '2026-09-12T06:05:00+00:00';
    const res = await postJson(base, `/api/events/atlas?at=${encodeURIComponent(at)}`, atlasEvent());
    assert.equal(res.status, 200);
    assert.equal(res.body['status'], 'ACCEPTED');
    const results = res.body['results'] as Array<{ tripId: string; caseId: string; caseStatus: string }>;
    assert.equal(results.length, 1);
    assert.equal(results[0]!.tripId, 'trip_a');
    assert.ok(results[0]!.caseId, 'a recovery case was opened');
    assert.notEqual(results[0]!.caseStatus, undefined);

    // The SAME ordinary machinery: a case now exists for trip_a and is
    // visible through the normal case-detail projection.
    const caseRes = await fetch(`${base}/api/cases/${results[0]!.caseId}`);
    assert.equal(caseRes.status, 200);
    const caseBody = (await caseRes.json()) as { status: string; tripId: string };
    assert.equal(caseBody.tripId, 'trip_a');
  });
});

test('provider ingress fans one shared order reference out to every matched canonical trip', async () => {
  await withServer(async (base, composed) => {
    const original = await composed.readDeps.snapshot.trips.getTrip('trip_a');
    assert.ok(original, 'the seeded trip supplies a valid provider-booked transport element');

    // A second canonical trip can legitimately contain a transport element
    // issued under the same provider order/service reference. This is data,
    // not a scenario-specific relationship: ingress must process every
    // matching trip instead of silently picking the first repository row.
    const secondTripId = 'trip-provider-fanout';
    await composed.readDeps.snapshot.trips.saveTrip({
      ...original!,
      id: secondTripId,
      travellerIds: ['trv-provider-fanout'],
      elements: original!.elements.map((element, index) => ({
        ...element,
        id: `el-provider-fanout-${index}`,
        tripId: secondTripId,
        dependsOn: [],
      })),
      objectives: [],
      relations: [],
      version: 0,
      updatedAt: '2026-09-12T06:00:00+00:00',
    });

    const response = await postJson(
      base,
      '/api/events/atlas?at=2026-09-12T06%3A05%3A00%2B00%3A00',
      atlasEvent({ eventId: 'evt-atlas-shared-order' }),
    );
    assert.equal(response.status, 200);
    assert.equal(response.body['status'], 'ACCEPTED');
    const results = response.body['results'] as Array<{ tripId: string; signalId: string; caseId: string }>;
    assert.equal(results.length, 2, 'both matched transport elements enter the normal recovery pipeline');
    assert.deepEqual(new Set(results.map((result) => result.tripId)), new Set(['trip_a', secondTripId]));
    assert.equal(new Set(results.map((result) => result.signalId)).size, 2, 'each canonical impact has a distinct signal');
    assert.equal(new Set(results.map((result) => result.caseId)).size, 2, 'each trip receives its own recovery case');
  });
});

test('DR-3.2: raw event is persisted before processing; duplicate delivery produces no duplicate case', async () => {
  await withServer(async (base, composed) => {
    const at = '2026-09-12T06:05:00+00:00';
    const first = await postJson(base, `/api/events/atlas?at=${encodeURIComponent(at)}`, atlasEvent());
    assert.equal(first.status, 200);
    assert.equal(first.body['status'], 'ACCEPTED');

    const inboxRows = composed.db
      .prepare('SELECT provider_id, provider_event_id, processed_status FROM provider_event_inbox')
      .all() as Array<{ provider_id: string; provider_event_id: string; processed_status: string }>;
    assert.equal(inboxRows.length, 1, 'the raw delivery was persisted exactly once');
    assert.equal(inboxRows[0]!.provider_id, 'atlas');
    assert.equal(inboxRows[0]!.provider_event_id, 'evt-atlas-0001');
    assert.equal(inboxRows[0]!.processed_status, 'ACCEPTED');

    const casesBefore = (composed.db.prepare('SELECT COUNT(*) as n FROM cases').get() as { n: number }).n;

    // Redeliver the SAME providerEventId (a webhook retry / at-least-once
    // delivery). No new signal/case/action must result.
    const second = await postJson(base, `/api/events/atlas?at=${encodeURIComponent(at)}`, atlasEvent());
    assert.equal(second.status, 200);
    assert.equal(second.body['status'], 'DUPLICATE');
    assert.equal(second.body['providerEventId'], 'evt-atlas-0001');

    const inboxRowsAfter = composed.db.prepare('SELECT * FROM provider_event_inbox').all();
    assert.equal(inboxRowsAfter.length, 1, 'still exactly one inbox row after redelivery');
    const casesAfter = (composed.db.prepare('SELECT COUNT(*) as n FROM cases').get() as { n: number }).n;
    assert.equal(casesAfter, casesBefore, 'redelivery opened no additional case');
  });
});

test('DR-3.3: an invalid/unparseable payload fails structurally, never a crash', async () => {
  await withServer(async (base) => {
    const res = await postJson(base, '/api/events/atlas', { garbage: true });
    assert.equal(res.status, 400);
    assert.equal(res.body['status'], 'INVALID_PAYLOAD');
    assert.ok(Array.isArray(res.body['issues']) && (res.body['issues'] as unknown[]).length > 0);

    // The server is still up and healthy — a bad payload never crashed it.
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
  });
});

test('DR-3.4: order refs matching no known trip element fail correlation, never guess a trip', async () => {
  await withServer(async (base, composed) => {
    const res = await postJson(
      base,
      '/api/events/atlas',
      atlasEvent({ eventId: 'evt-atlas-unknown-order', orderNo: 'NO-SUCH-ORDER-REF' }),
    );
    assert.equal(res.status, 422);
    assert.equal(res.body['status'], 'CORRELATION_FAILED');

    // The delivery was still recorded (persisted before processing) but
    // marked as a correlation failure — never silently dropped, never
    // attached to an arbitrary trip.
    const row = composed.db
      .prepare('SELECT processed_status FROM provider_event_inbox WHERE provider_event_id = ?')
      .get('evt-atlas-unknown-order') as { processed_status: string } | undefined;
    assert.equal(row?.processed_status, 'CORRELATION_FAILED');
  });
});

test('DR-3.5: the resulting signal never carries AUTHORITATIVE/CONNECTED authority (ASSERTED ceiling)', async () => {
  await withServer(async (base, composed) => {
    const at = '2026-09-12T06:05:00+00:00';
    const res = await postJson(base, `/api/events/atlas?at=${encodeURIComponent(at)}`, atlasEvent());
    assert.equal(res.status, 200);
    const results = res.body['results'] as Array<{ caseId: string }>;

    const recoveryCase = await composed.readDeps.cases.getCase(results[0]!.caseId);
    assert.ok(recoveryCase, 'case exists');
    const signal = await composed.readDeps.signals.getSignal(recoveryCase!.triggeredBySignalIds[0]!);
    assert.ok(signal, 'triggering signal persisted');
    assert.equal(signal!.authority, 'ASSERTED', 'an unauthenticated delivery channel is ASSERTED at best');
    assert.notEqual(signal!.authority, 'AUTHORITATIVE');
    assert.notEqual(signal!.authority, 'CONNECTED');
  });
});

test('DR-3.6: an Atlas-shaped schedule-change event also reaches the recovery pipeline (not just cancellation)', async () => {
  await withServer(async (base) => {
    const at = '2026-09-12T06:05:00+00:00';
    const res = await postJson(
      base,
      `/api/events/atlas?at=${encodeURIComponent(at)}`,
      atlasEvent({
        eventId: 'evt-atlas-0002',
        eventType: 'SCHEDULE_CHANGE',
        depTime: '2026-09-13T10:15:00+00:00',
      }),
    );
    assert.equal(res.status, 200);
    assert.equal(res.body['status'], 'ACCEPTED');
    const results = res.body['results'] as Array<{ tripId: string; caseId: string }>;
    assert.equal(results[0]!.tripId, 'trip_a');
  });
});

test('DR-3.7: the fixed acceptance scenario referenced by this file still loads (referential sanity)', () => {
  const spec = loadScenario(SCENARIO_A_DIR);
  assert.equal(spec.trip.id, 'trip_a');
  const flightLeg = spec.trip.elements.find((e) => e.id === 'el_a_flight_out');
  assert.ok(flightLeg && flightLeg.elementKind === 'TRANSPORT_LEG');
  assert.equal(
    (flightLeg as { data: { bookingRef?: { reference?: string } } }).data.bookingRef?.reference,
    'FL-A-1001',
  );
});

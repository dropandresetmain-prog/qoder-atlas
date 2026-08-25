/**
 * DR-3 correlation semantics — one real booking reference covering several
 * legs of ONE trip.
 *
 * Proves over the REAL HTTP boundary (POST /api/events/atlas):
 * - a provider event whose segment evidence (depTime) identifies one leg
 *   inside a shared-reference booking correlates ONLY that leg
 *   (SEGMENT_EVIDENCE) and opens exactly ONE recovery case for the trip;
 * - an order-level event with NO segment evidence opens exactly ONE case
 *   (anchored deterministically at the earliest-departure candidate,
 *   ORDER_LEVEL_PRIMARY) instead of duplicating cases per shared leg;
 * - independent trips sharing nothing remain unaffected.
 *
 * Anti-fabrication guard: references are never suffixed/split per leg; the
 * ambiguity left by order-level events is recorded in the signal payload,
 * never resolved by guessing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';

import { AppConfigSchema } from '../src/config/config.ts';
import { createAppServer } from '../src/server/http.ts';
import { composeAppRuntime } from '../src/app/compose.ts';
import type { TransportLeg } from '../src/domain/elements.ts';

const FIXTURES_ROOT = resolve('fixtures');

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
    eventId: 'evt-atlas-shared-pnr',
    orderNo: 'FL-A-1001',
    eventType: 'FLIGHT_CANCELLATION',
    eventStatus: 1,
    eventTime: '2026-09-12T06:00:00+00:00',
    createTime: '2026-09-12T06:00:00+00:00',
    airline: 'XX',
    ...overrides,
  };
}

/**
 * Add one canonical trip whose TWO transport legs legitimately share ONE
 * provider booking reference (a real PNR covers every segment of a journey).
 * Legs differ only by departure instant so segment evidence can discriminate.
 */
async function seedSharedPnrTrip(
  composed: Awaited<ReturnType<typeof composeAppRuntime>>,
): Promise<{ tripId: string; legAId: string; legBId: string }> {
  const original = await composed.readDeps.snapshot.trips.getTrip('trip_a');
  assert.ok(original, 'the seeded trip supplies a valid provider-booked transport element');
  const template = original!.elements.find(
    (element): element is TransportLeg => element.elementKind === 'TRANSPORT_LEG',
  );
  assert.ok(template, 'seeded trip must include a TRANSPORT_LEG template');
  assert.ok(template.data.scheduledDeparture, 'template leg must carry a scheduled departure');

  const leg = (id: string, departureIso: string): TransportLeg => ({
    ...template,
    id,
    tripId: 'trip-shared-pnr',
    dependsOn: [],
    data: {
      ...template.data,
      scheduledDeparture: {
        ...template.data.scheduledDeparture!,
        value: departureIso,
      },
    },
  });

  const tripId = 'trip-shared-pnr';
  await composed.readDeps.snapshot.trips.saveTrip({
    ...original!,
    id: tripId,
    travellerIds: ['trv-shared-pnr'],
    elements: [leg('el-shared-pnr-a', '2026-09-12T06:00:00+00:00'), leg('el-shared-pnr-b', '2026-09-13T10:15:00+00:00')],
    objectives: [],
    relations: [],
    version: 0,
    updatedAt: '2026-09-12T06:00:00+00:00',
  });
  return { tripId, legAId: 'el-shared-pnr-a', legBId: 'el-shared-pnr-b' };
}

test('segment evidence narrows one shared-reference booking to the genuinely affected leg', async () => {
  await withServer(async (base, composed) => {
    const { tripId, legBId } = await seedSharedPnrTrip(composed);

    // The event names the later segment's departure instant explicitly.
    const res = await postJson(
      base,
      '/api/events/atlas?at=2026-09-12T06%3A05%3A00%2B00%3A00',
      atlasEvent({ eventId: 'evt-atlas-seg-evidence', depTime: '2026-09-13T10:15:00+00:00' }),
    );
    assert.equal(res.status, 200);
    assert.equal(res.body['status'], 'ACCEPTED');

    // One result row per AFFECTED TRIP (trip_a also carries the reference);
    // the shared-PNR trip contributes exactly ONE result, not one per leg.
    const results = res.body['results'] as Array<{ tripId: string; signalId: string; caseId: string }>;
    const mine = results.filter((result) => result.tripId === tripId);
    assert.equal(mine.length, 1, 'one event x one trip = exactly one signal, never one per shared leg');

    const recoveryCase = await composed.readDeps.cases.getCase(mine[0]!.caseId);
    assert.ok(recoveryCase);
    assert.deepEqual(
      [...recoveryCase!.affectedElementIds].sort(),
      [legBId].sort(),
      'only the evidence-matched leg is affected; the sibling leg stays untouched',
    );

    const signal = await composed.readDeps.signals.getSignal(mine[0]!.signalId);
    assert.ok(signal);
    assert.equal(signal!.subjectRef?.id, legBId, 'subject is the evidence-matched leg');
    assert.equal((signal!.payload['correlation'] as Record<string, unknown>)['resolution'], 'SEGMENT_EVIDENCE');
    assert.equal((signal!.payload['correlation'] as Record<string, unknown>)['candidateElementCount'], 2);
  });
});

test('an order-level event over one shared reference yields ONE case anchored deterministically, ambiguity recorded', async () => {
  await withServer(async (base, composed) => {
    const { tripId, legAId } = await seedSharedPnrTrip(composed);

    // No depTime: the event genuinely does not identify a segment.
    const res = await postJson(base, '/api/events/atlas', atlasEvent({ eventId: 'evt-atlas-order-level' }));
    assert.equal(res.status, 200);
    assert.equal(res.body['status'], 'ACCEPTED');

    const results = res.body['results'] as Array<{ tripId: string; signalId: string; caseId: string }>;
    const mine = results.filter((result) => result.tripId === tripId);
    assert.equal(mine.length, 1, 'no duplicate cases merely because legs share a booking reference');

    const recoveryCase = await composed.readDeps.cases.getCase(mine[0]!.caseId);
    assert.ok(recoveryCase);
    assert.ok(recoveryCase!.affectedElementIds.includes(legAId), 'deterministic primary anchor: earliest departure');

    const signal = await composed.readDeps.signals.getSignal(mine[0]!.signalId);
    assert.ok(signal);
    assert.equal((signal!.payload['correlation'] as Record<string, unknown>)['resolution'], 'ORDER_LEVEL_PRIMARY');
    assert.equal((signal!.payload['correlation'] as Record<string, unknown>)['candidateElementCount'], 2);
  });
});

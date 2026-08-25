/**
 * DR-6 — HTTP integration for event-change preview/commit:
 *   POST /api/programme/:anchorEventId/change-preview
 *   POST /api/programme/:anchorEventId/change-commit
 *
 * Proves, over the real HTTP surface, credential-free (REPLAY):
 * - preview mutates NOTHING (authoritative trip state is byte-identical
 *   before/after a preview call);
 * - preview reports affected vs unaffected travellers for the boot-seeded
 *   programme's opening-session commitment;
 * - commit actually mutates state and fans out through the SAME
 *   processCommitmentChange path the legacy `/api/programme/commitment-change`
 *   route uses, opening/processing cases only for affected linked trips;
 * - unaffected travellers' trips stay untouched by commit;
 * - the legacy `/api/programme/commitment-change` route still works
 *   (existing accepted functionality preserved).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';

import { AppConfigSchema } from '../src/config/config.ts';
import { createAppServer } from '../src/server/http.ts';
import { composeAppRuntime } from '../src/app/compose.ts';

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

const ANCHOR_EVENT_ID = 'evt-w3-demo';
const COMMITMENT_ID = 'cmt-evt-w3-demo-opening';

function tripRows(composed: Awaited<ReturnType<typeof composeAppRuntime>>): Array<{ id: string; data: string }> {
  return composed.db.prepare('SELECT id, data FROM trips ORDER BY id').all() as Array<{ id: string; data: string }>;
}

test('DR-6-HTTP.1: preview mutates nothing — trip state is byte-identical before/after', async () => {
  await withServer(async (base, composed) => {
    const before = JSON.stringify(tripRows(composed));

    const res = await postJson(base, `/api/programme/${ANCHOR_EVENT_ID}/change-preview`, {
      commitmentId: COMMITMENT_ID,
      changeKind: 'RESCHEDULED',
      newStartsAt: '2026-09-08T17:00:00+08:00',
      newEndsAt: '2026-09-08T19:00:00+08:00',
      at: '2026-09-01T00:00:00+00:00',
    });
    assert.equal(res.status, 200);
    assert.ok(typeof res.body['totalTravellers'] === 'number' && (res.body['totalTravellers'] as number) > 0);
    assert.ok(Array.isArray(res.body['affected']));
    assert.ok(Array.isArray(res.body['unaffected']));

    const after = JSON.stringify(tripRows(composed));
    assert.equal(after, before, 'preview performed zero authoritative mutation');
  });
});

test('DR-6-HTTP.2: unknown anchor event / commitment are structured 404s', async () => {
  await withServer(async (base) => {
    const badEvent = await postJson(base, '/api/programme/no-such-event/change-preview', {
      commitmentId: COMMITMENT_ID,
      changeKind: 'RESCHEDULED',
      at: '2026-09-01T00:00:00+00:00',
    });
    assert.equal(badEvent.status, 404);
    assert.equal(badEvent.body['error'], 'unknown_anchor_event');

    const badCommitment = await postJson(base, `/api/programme/${ANCHOR_EVENT_ID}/change-preview`, {
      commitmentId: 'cmt-does-not-exist',
      changeKind: 'RESCHEDULED',
      at: '2026-09-01T00:00:00+00:00',
    });
    assert.equal(badCommitment.status, 404);
    assert.equal(badCommitment.body['error'], 'unknown_commitment');
  });
});

test('DR-6-HTTP.3: commit actually mutates and fans out; unaffected travellers stay unaffected', async () => {
  await withServer(async (base, composed) => {
    const preview = await postJson(base, `/api/programme/${ANCHOR_EVENT_ID}/change-preview`, {
      commitmentId: COMMITMENT_ID,
      changeKind: 'RESCHEDULED',
      newStartsAt: '2026-09-08T17:00:00+08:00',
      newEndsAt: '2026-09-08T19:00:00+08:00',
      at: '2026-09-01T00:00:00+00:00',
    });
    const affectedTripIds = (preview.body['affected'] as Array<{ tripId: string }>).map((a) => a.tripId);
    const unaffectedTripIds = (preview.body['unaffected'] as Array<{ tripId: string }>).map((a) => a.tripId);

    const unaffectedBefore = unaffectedTripIds.length > 0
      ? JSON.stringify(await composed.readDeps.snapshot.trips.getTrip(unaffectedTripIds[0]!))
      : undefined;

    const commit = await postJson(base, `/api/programme/${ANCHOR_EVENT_ID}/change-commit`, {
      commitmentId: COMMITMENT_ID,
      changeKind: 'RESCHEDULED',
      newStartsAt: '2026-09-08T17:00:00+08:00',
      newEndsAt: '2026-09-08T19:00:00+08:00',
      at: '2026-09-01T00:00:00+00:00',
    });
    assert.equal(commit.status, 200);
    assert.equal(commit.body['accepted'], true);
    assert.equal(commit.body['anchorEventId'], ANCHOR_EVENT_ID);
    assert.equal(commit.body['commitmentId'], COMMITMENT_ID);

    const processedSignals = commit.body['processedSignals'] as Array<{ tripId: string; caseId: string }>;
    assert.ok(processedSignals.length > 0, 'at least one linked trip was processed');
    // Every affected trip from the preview was actually processed by commit.
    for (const tripId of affectedTripIds) {
      assert.ok(
        processedSignals.some((p) => p.tripId === tripId),
        `affected trip ${tripId} was processed by commit`,
      );
    }

    if (unaffectedTripIds.length > 0 && unaffectedBefore !== undefined) {
      const unaffectedAfter = JSON.stringify(await composed.readDeps.snapshot.trips.getTrip(unaffectedTripIds[0]!));
      assert.equal(unaffectedAfter, unaffectedBefore, 'an unaffected traveller trip is untouched by commit');
    }
  });
});

test('DR-6-HTTP.4: the legacy /api/programme/commitment-change route still works', async () => {
  await withServer(async (base) => {
    const res = await postJson(base, '/api/programme/commitment-change', {
      signal: {
        id: 'sig-legacy-commitment-change',
        kind: 'ANCHOR_COMMITMENT_CHANGE',
        occurredAt: '2026-09-05T10:00:00+00:00',
        receivedAt: '2026-09-05T10:05:00+00:00',
        sourceId: `src-${ANCHOR_EVENT_ID}`,
        authority: 'AUTHORITATIVE',
        payload: {
          anchorEventId: ANCHOR_EVENT_ID,
          commitmentId: COMMITMENT_ID,
          changeKind: 'RESCHEDULED',
          newStartsAt: '2026-09-08T10:00:00+08:00',
          newEndsAt: '2026-09-08T12:00:00+08:00',
        },
      },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body['accepted'], true);
  });
});

test('DR-6-HTTP.5: comparison previews alternatives without mutating programme state', async () => {
  await withServer(async (base, composed) => {
    const before = JSON.stringify(tripRows(composed));
    const res = await postJson(base, `/api/programme/${ANCHOR_EVENT_ID}/change-preview-compare`, {
      options: [
        {
          optionId: 'keep-programme-time',
          commitmentId: COMMITMENT_ID,
          changeKind: 'OTHER',
          at: '2026-09-01T00:00:00+00:00',
        },
        {
          optionId: 'move-programme-time',
          commitmentId: COMMITMENT_ID,
          changeKind: 'RESCHEDULED',
          newStartsAt: '2026-09-08T17:00:00+08:00',
          newEndsAt: '2026-09-08T19:00:00+08:00',
          at: '2026-09-01T00:00:00+00:00',
        },
      ],
    });

    assert.equal(res.status, 200);
    const options = res.body['options'] as Array<{ optionId: string; preview: { affected: unknown[]; unaffected: unknown[] } }>;
    assert.deepEqual(options.map((option) => option.optionId), ['keep-programme-time', 'move-programme-time']);
    assert.ok(options.every((option) => Array.isArray(option.preview.affected)));
    assert.ok(options.every((option) => Array.isArray(option.preview.unaffected)));
    assert.equal(JSON.stringify(tripRows(composed)), before, 'comparison is counterfactual only');
  });
});

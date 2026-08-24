/**
 * DR-10 — HTTP integration for programme roster/upload intake:
 *   POST /api/programme/roster/parse
 *   POST /api/programme/upload/draft
 *   POST /api/programme/upload/promote
 *
 * Proves, over the real HTTP surface, credential-free (REPLAY):
 * - roster CSV parses deterministically with structured issues for
 *   malformed rows, no state touched;
 * - draft generation does NOT mutate authoritative state;
 * - promotion goes through the validated ProgrammeService path and
 *   actually creates trips;
 * - malformed rows return structured issues rather than silently dropping.
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

const GOOD_ROSTER_CSV = `Name,Email,Home,Role,TravelRequired
Jordan Speaker,jordan@example.test,LAX,Keynote,true
Alex Local,alex@example.test,SYN,Panelist,false`;

const MALFORMED_ROSTER_CSV = `Name,Email,Home
,missing-name@example.test,LAX
Valid Person,valid@example.test,SYN`;

test('DR-10-HTTP.1: roster CSV parses deterministically, no state touched', async () => {
  await withServer(async (base, composed) => {
    const tripsBefore = (await composed.readDeps.snapshot.trips.listTrips()).length;

    const res = await postJson(base, '/api/programme/roster/parse', { rosterCsvText: GOOD_ROSTER_CSV });
    assert.equal(res.status, 200);
    const records = res.body['records'] as unknown[];
    assert.equal(records.length, 2);

    const tripsAfter = (await composed.readDeps.snapshot.trips.listTrips()).length;
    assert.equal(tripsAfter, tripsBefore, 'parsing touches no state');
  });
});

test('DR-10-HTTP.2: malformed rows return structured issues, never silently dropped', async () => {
  await withServer(async (base) => {
    const res = await postJson(base, '/api/programme/roster/parse', { rosterCsvText: MALFORMED_ROSTER_CSV });
    assert.equal(res.status, 200);
    const issues = res.body['issues'] as Array<{ rowNumber: number; reason: string }>;
    assert.ok(issues.length > 0, 'the row with no name produced a structured issue');
    const records = res.body['records'] as unknown[];
    assert.equal(records.length, 1, 'only the valid row became a record');
  });
});

test('DR-10-HTTP.3: draft generation does not mutate authoritative state', async () => {
  await withServer(async (base, composed) => {
    const tripsBefore = (await composed.readDeps.snapshot.trips.listTrips()).length;

    const res = await postJson(base, '/api/programme/upload/draft', {
      anchorEventId: 'evt-dr10-http',
      sourceId: 'src-dr10-http',
      at: '2026-09-01T00:00:00+00:00',
      eventBriefText: 'A test offsite event',
      rosterCsvText: GOOD_ROSTER_CSV,
      eventBrief: {
        eventName: 'DR-10 HTTP Test Offsite',
        eventKind: 'OFFSITE',
        venueName: 'Test Venue',
        venueTimezone: 'UTC',
        startsAt: '2026-10-01T10:00:00+00:00',
        endsAt: '2026-10-02T18:00:00+00:00',
        organiserName: 'Test Org',
      },
    });
    assert.equal(res.status, 200);
    assert.equal((res.body['importDraft'] as { travellers: unknown[] }).travellers.length, 2);

    const tripsAfter = (await composed.readDeps.snapshot.trips.listTrips()).length;
    assert.equal(tripsAfter, tripsBefore, 'draft generation touches no state');
  });
});

test('DR-10-HTTP.4: promotion goes through the validated ProgrammeService path and creates trips', async () => {
  await withServer(async (base, composed) => {
    const draftRes = await postJson(base, '/api/programme/upload/draft', {
      anchorEventId: 'evt-dr10-http-promote',
      sourceId: 'src-dr10-http-promote',
      at: '2026-09-01T00:00:00+00:00',
      eventBriefText: 'A test offsite event',
      rosterCsvText: GOOD_ROSTER_CSV,
      eventBrief: {
        eventName: 'DR-10 HTTP Promote Offsite',
        eventKind: 'OFFSITE',
        venueName: 'Test Venue',
        venueTimezone: 'UTC',
        startsAt: '2026-10-01T10:00:00+00:00',
        endsAt: '2026-10-02T18:00:00+00:00',
        organiserName: 'Test Org',
      },
    });
    assert.equal(draftRes.status, 200);

    const tripsBefore = (await composed.readDeps.snapshot.trips.listTrips()).length;

    const promoteRes = await postJson(base, '/api/programme/upload/promote', { draft: draftRes.body });
    assert.equal(promoteRes.status, 200);
    assert.equal(promoteRes.body['accepted'], true);
    assert.equal(promoteRes.body['contextAccepted'], true);

    const tripsAfter = (await composed.readDeps.snapshot.trips.listTrips()).length;
    assert.equal(tripsAfter, tripsBefore + 2, 'promotion actually created trips for both roster rows');

    // The promoted programme is now visible through the ordinary programme view.
    const viewRes = await fetch(
      `${base}/api/programme/evt-dr10-http-promote?at=${encodeURIComponent('2026-09-01T00:00:00+00:00')}`,
    );
    assert.equal(viewRes.status, 200);
    const view = (await viewRes.json()) as { summary: { total: number } };
    assert.equal(view.summary.total, 2);
  });
});

test('DR-10-HTTP.5: malformed wire body is a structured 400, never a crash', async () => {
  await withServer(async (base) => {
    const res = await postJson(base, '/api/programme/roster/parse', { notRosterCsvText: 'oops' });
    assert.equal(res.status, 400);
    assert.equal(res.body['error'], 'invalid_request');
  });
});

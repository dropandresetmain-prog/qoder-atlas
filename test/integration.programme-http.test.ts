/**
 * NS-G1 evidence — programme HTTP surface (integrator wiring).
 *
 * Proves, over the REAL composed HTTP server with zero credentials:
 * - GET  /api/programme/:anchorEventId projects the authoritative
 *   ProgrammeView (404 for unknown events, 400 for a bad instant);
 * - POST /api/programme/context creates programme context only through the
 *   validated mutation path (schema-invalid bodies -> 400, never state);
 * - POST /api/programme/import promotes drafts through the frozen intake
 *   contract at ~40-traveller scale and surfaces missing-info uncertainty;
 * - POST /api/programme/commitment-change fans an event-side change out to
 *   ONLY linked trips and refuses malformed payloads;
 * - arbitrary programme routes do not exist (no scenario-specific surface).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';

import { AppConfigSchema } from '../src/config/config.ts';
import { createAppServer } from '../src/server/http.ts';
import { composeAppRuntime } from '../src/app/compose.ts';

const FIXTURES_ROOT = resolve('fixtures');
const AT = '2026-09-01T00:00:00+00:00';

const runtimeConfig = AppConfigSchema.parse({
  environment: 'local',
  adapterMode: 'REPLAY',
  sqlitePath: ':memory:',
  fixturesDir: FIXTURES_ROOT,
  providers: { atlas: { env: 'sandbox' }, modelStudio: {}, googleRoutes: {} },
});

async function postJson(base: string, path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** Synthetic programme context; ids/data only, never real scenario content. */
function programmeContext(eventId: string) {
  const venuePlaceId = `plc-${eventId}-venue`;
  const airportPlaceId = `plc-${eventId}-airport`;
  const organisation = {
    id: `org-${eventId}`,
    name: 'Synthetic Programme Organiser',
    roles: ['EVENT_ORGANISER', 'PAYER'],
  };
  const places = [
    { id: venuePlaceId, name: 'Synthetic Venue', kind: 'VENUE', timezone: 'Asia/Singapore', externalRefs: [] },
    {
      id: airportPlaceId,
      name: 'Synthetic Airport',
      kind: 'AIRPORT',
      timezone: 'Asia/Singapore',
      externalRefs: [{ system: 'airport-code', value: 'SYN' }],
    },
  ];
  const anchorEvent = {
    id: eventId,
    name: 'Synthetic Programme Event',
    kind: 'CONFERENCE',
    placeId: venuePlaceId,
    window: { startsAt: '2026-09-07T00:00:00+08:00', endsAt: '2026-09-11T23:59:00+08:00' },
    organiserOrganisationId: organisation.id,
    commitments: [
      {
        id: `cmt-${eventId}-opening`,
        anchorEventId: eventId,
        title: 'Opening Session',
        kind: 'SESSION',
        placeId: venuePlaceId,
        startsAt: { value: '2026-09-08T15:00:00+08:00', sourceId: `src-${eventId}`, authority: 'AUTHORITATIVE', observedAt: AT },
        endsAt: { value: '2026-09-08T17:00:00+08:00', sourceId: `src-${eventId}`, authority: 'AUTHORITATIVE', observedAt: AT },
        sourceId: `src-${eventId}`,
      },
      {
        id: `cmt-${eventId}-closing`,
        anchorEventId: eventId,
        title: 'Closing Session',
        kind: 'SESSION',
        placeId: venuePlaceId,
        startsAt: { value: '2026-09-11T09:00:00+08:00', sourceId: `src-${eventId}`, authority: 'AUTHORITATIVE', observedAt: AT },
        sourceId: `src-${eventId}`,
      },
    ],
    sourceIds: [],
  };
  const ruleSets = [
    {
      id: `rs-${eventId}-funding`,
      kind: 'EVENT',
      name: 'event funding window',
      ownerOrganisationId: organisation.id,
      sourceId: `src-${eventId}`,
      rules: [
        {
          id: `rule-${eventId}-funded-window`,
          kind: 'FUNDED_WINDOW',
          sourceId: `src-${eventId}`,
          appliesTo: [],
          windowStart: '2026-09-07T00:00:00+08:00',
          windowEnd: '2026-09-11T23:59:00+08:00',
          coveredBy: 'EVENT_ORGANISATION',
          incrementalPayer: 'TRAVELLER',
        },
      ],
    },
  ];
  return { organisation, places, anchorEvent, ruleSets, venuePlaceId, airportPlaceId };
}

function travellersFor(eventId: string, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const n = index + 1;
    const sparse = n % 7 === 0;
    return {
      draftId: `draft-${n}`,
      displayName: `Traveller ${String(n).padStart(2, '0')}`,
      identity: sparse ? {} : { email: `t${n}@example.test` },
      ...(sparse ? {} : { homeLocationText: 'Somewhere' }),
      nationalityCodes: sparse ? [] : ['SG'],
      accessibilityStatements: [],
      notes: [],
      anchorCommitmentIds: [`cmt-${eventId}-opening`],
    };
  });
}

async function withProgrammeServer(fn: (base: string, composed: Awaited<ReturnType<typeof composeAppRuntime>>) => Promise<void>) {
  const composed = await composeAppRuntime(runtimeConfig);
  const server = createAppServer(runtimeConfig, composed.endpoints);
  await new Promise<void>((resolvePromise) => server.listen(0, resolvePromise));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  try {
    await fn(base, composed);
  } finally {
    await new Promise<void>((resolvePromise, reject) =>
      server.close((error) => (error ? reject(error) : resolvePromise())),
    );
    composed.db.close();
  }
}

test('programme HTTP: view/import/context/commitment-change surface end to end', async () => {
  await withProgrammeServer(async (base) => {
    const eventId = 'evt-http';
    const context = programmeContext(eventId);

    // Boundary validation before any state exists.
    const badView = await fetch(`${base}/api/programme/${eventId}?at=not-an-instant`);
    assert.equal(badView.status, 400);
    const unknownView = await fetch(`${base}/api/programme/${eventId}?at=${encodeURIComponent(AT)}`);
    assert.equal(unknownView.status, 404);
    const badContext = await postJson(base, '/api/programme/context', { at: AT, anchorEvent: { id: eventId } });
    assert.equal(badContext.status, 400, 'schema-invalid context bodies never reach state');

    // Create the programme context through the validated path.
    const createContext = await postJson(base, '/api/programme/context', {
      at: AT,
      sourceId: `src-${eventId}`,
      organisation: context.organisation,
      anchorEvent: context.anchorEvent,
      places: context.places,
      ruleSets: context.ruleSets,
    });
    assert.equal(createContext.status, 200);
    assert.equal(createContext.body['accepted'], true);

    // Import at ~40-traveller scale through the frozen intake contract.
    const importDraft = {
      id: `import-${eventId}`,
      anchorEventId: eventId,
      channel: 'BULK_IMPORT',
      sourceId: `src-${eventId}`,
      receivedAt: AT,
      travellers: travellersFor(eventId, 42),
      unresolvedStatements: [],
    };
    const bulk = await postJson(base, '/api/programme/import', { importDraft, at: AT });
    assert.equal(bulk.status, 200);
    assert.equal(bulk.body['accepted'], true);
    assert.equal(bulk.body['promotedCount'], 42);
    // Missing facts stay visible as explicit issues, never fabricated.
    const outcomes = bulk.body['outcomes'] as Array<{ draftId: string; issues: string[] }>;
    const sparse = outcomes.find((entry) => entry.draftId === 'draft-7');
    assert.ok(sparse, 'every 7th draft is sparse');
    assert.ok(sparse!.issues.some((issue) => /nationality/i.test(issue)), 'sparse travellers keep nationality missing');
    assert.ok(sparse!.issues.some((issue) => /home location/i.test(issue)), 'sparse travellers keep home location missing');

    // Malformed import bodies are refused at the boundary.
    const badImport = await postJson(base, '/api/programme/import', {
      importDraft: { ...importDraft, id: 'import-bad', travellers: [{ draftId: 'draft-x' }] },
      at: AT,
    });
    assert.equal(badImport.status, 400, 'drafts without displayName never promote');

    // The read model projects the authoritative programme state.
    const view = (await (await fetch(`${base}/api/programme/${eventId}?at=${encodeURIComponent(AT)}`)).json()) as {
      summary: { total: number; planning: number };
      travellers: Array<{ status: string; tripId: string }>;
    };
    assert.equal(view.summary.total, 42);
    assert.equal(view.travellers.length, 42);
    assert.equal(view.summary.planning, 42, 'fresh intakes have engagements only -> PLANNING');

    // Commitment change fans out ONLY to trips linked via the commitment.
    const fanOut = await postJson(base, '/api/programme/commitment-change', {
      signal: {
        id: `sig-${eventId}-move`,
        kind: 'ANCHOR_COMMITMENT_CHANGE',
        occurredAt: '2026-09-05T10:00:00+00:00',
        receivedAt: '2026-09-05T10:05:00+00:00',
        sourceId: `src-${eventId}`,
        authority: 'AUTHORITATIVE',
        payload: {
          anchorEventId: eventId,
          commitmentId: `cmt-${eventId}-opening`,
          changeKind: 'RESCHEDULED',
          newStartsAt: '2026-09-08T10:00:00+08:00',
          newEndsAt: '2026-09-08T12:00:00+08:00',
        },
      },
    });
    assert.equal(fanOut.status, 200);
    assert.equal(fanOut.body['accepted'], true);
    // Sparse travellers (every 7th) are linked too; all 42 drafts linked opening.
    assert.equal(fanOut.body['linkedTripCount'], 42);
    assert.ok((fanOut.body['processedSignals'] as unknown[]).length >= 42);

    // Malformed commitment-change payloads are refused without state surgery.
    const badFanOut = await postJson(base, '/api/programme/commitment-change', {
      signal: {
        id: `sig-${eventId}-bad`,
        kind: 'ANCHOR_COMMITMENT_CHANGE',
        occurredAt: '2026-09-05T11:00:00+00:00',
        sourceId: `src-${eventId}`,
        authority: 'AUTHORITATIVE',
        payload: { anchorEventId: eventId, commitmentId: `cmt-${eventId}-opening` }, // changeKind missing
      },
    });
    assert.equal(badFanOut.status, 409);
    assert.equal(badFanOut.body['accepted'], false);

    // No scenario-specific programme routes exist.
    const unknownAction = await postJson(base, '/api/programme/something-else', {});
    assert.equal(unknownAction.status, 404);
  });
});

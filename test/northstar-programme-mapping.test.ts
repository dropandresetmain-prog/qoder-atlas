/**
 * NS-G1 evidence — LLM-assisted intake mapping + programme HTML surface.
 *
 * Proves, with zero credentials (ScriptedModelTransport = REPLAY):
 * - POST /api/programme/map-roster turns free-form roster text into frozen
 *   ProgrammeTravellerDrafts; commitment TITLES never become ids; drafts do
 *   not promote any state by themselves;
 * - malformed model output fails closed (422), never a crash;
 * - POST /api/programme/map-brief runs brief extraction through the
 *   deterministic clause adapter and returns a ruleSet PROPOSAL only;
 * - the mapping endpoints refuse service (503) when no model seam exists;
 * - GET /programme renders the frozen ProgrammeView screen (200 for a known
 *   event, 404 error panel for an unknown one).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

import { openDatabase } from '../src/persistence/database.ts';
import {
  SqliteAuditRepository,
  SqliteCaseRepository,
  SqliteSignalRepository,
  SqliteSourceRepository,
  SqliteTripRepository,
} from '../src/persistence/repositories.ts';
import { SqliteEntityStore } from '../src/persistence/entityStore.ts';
import { SqlMutationService } from '../src/engine/mutation.ts';
import { SqlitePreferenceStore } from '../src/app/preferenceStore.ts';
import { OverlayViabilityEngine } from '../src/engine/overlay.ts';
import { ProgrammeService } from '../src/app/programme.ts';
import { createProgrammeHandlers } from '../src/app/programmeHttp.ts';
import { ScriptedModelTransport } from '../src/intelligence/client.ts';
import { AppConfigSchema } from '../src/config/config.ts';
import { createAppServer, type AppEndpoints } from '../src/server/http.ts';

const AT = '2026-09-01T00:00:00+00:00';

function createHarness() {
  const db = openDatabase(':memory:');
  const trips = new SqliteTripRepository(db);
  const entities = new SqliteEntityStore(db);
  const sources = new SqliteSourceRepository(db);
  const signals = new SqliteSignalRepository(db);
  const cases = new SqliteCaseRepository(db);
  const audit = new SqliteAuditRepository(db);
  const preferences = new SqlitePreferenceStore(db);
  const mutations = new SqlMutationService({ db, trips, entities });
  const service = new ProgrammeService({ mutations, entities, trips, sources, audit });
  const readDeps = {
    snapshot: { trips, entities, preferences, sources },
    signals,
    cases,
    audit,
    viability: new OverlayViabilityEngine(),
  };
  return { db, trips, mutations, entities, sources, signals, cases, audit, service, readDeps };
}

function programmeContextBody(eventId: string) {
  const venuePlaceId = `plc-${eventId}-venue`;
  return {
    at: AT,
    sourceId: `src-${eventId}`,
    organisation: { id: `org-${eventId}`, name: 'Synthetic Programme Organiser', roles: ['EVENT_ORGANISER', 'PAYER'] },
    anchorEvent: {
      id: eventId,
      name: 'Synthetic Programme Event',
      kind: 'CONFERENCE',
      placeId: venuePlaceId,
      window: { startsAt: '2026-09-07T00:00:00+08:00', endsAt: '2026-09-11T23:59:00+08:00' },
      organiserOrganisationId: `org-${eventId}`,
      commitments: [],
      sourceIds: [],
    },
    places: [{ id: venuePlaceId, name: 'Synthetic Venue', kind: 'VENUE', timezone: 'Asia/Singapore', externalRefs: [] }],
  };
}

const ROSTER_MODEL_OUTPUT = JSON.stringify({
  travellers: [
    { displayName: 'Alex Rivera', email: 'alex.rivera@example.test', nationalityCodes: ['BR'] },
    { displayName: 'Jordan Lee and guest', commitmentTitles: ['VIP Gala Dinner'] },
  ],
  unresolvedStatements: ['"and guest" has no name'],
});

const BRIEF_MODEL_OUTPUT = JSON.stringify({
  eventName: 'Synthetic Programme Event',
  eventKind: 'CONFERENCE',
  startsAt: '2026-09-07T00:00:00+08:00',
  endsAt: '2026-09-11T23:59:00+08:00',
  policyClauses: [
    {
      kind: 'FUNDED_WINDOW',
      statement: 'travel within the event window is paid by the organiser',
      windowStart: '2026-09-07T00:00:00+08:00',
      windowEnd: '2026-09-11T23:59:00+08:00',
    },
    { kind: 'NO_SMOKING_ROOMS', statement: 'do not book smoking rooms' },
  ],
});

function createMappingHandlers(harness: ReturnType<typeof createHarness>, transport?: ScriptedModelTransport) {
  return createProgrammeHandlers({
    service: harness.service,
    readDeps: harness.readDeps,
    mutations: harness.mutations,
    entities: harness.entities,
    trips: harness.trips,
    signals: harness.signals,
    cases: harness.cases,
    audit: harness.audit,
    ...(transport ? { modelClient: transport } : {}),
  });
}

test('mapping surface: REPLAY roster + brief mapping never fabricate or promote', async () => {
  const harness = createHarness();
  const transport = new ScriptedModelTransport([ROSTER_MODEL_OUTPUT, BRIEF_MODEL_OUTPUT]);
  const handlers = createMappingHandlers(harness, transport);

  // Roster mapping returns drafts only; titles stay unresolved.
  const roster = await handlers.mapRoster({ content: 'roster attached', at: AT, sourceId: 'src-evt-map' });
  assert.equal(roster.status, 200);
  const rosterBody = roster.body as { drafts: Array<{ displayName: string; anchorCommitmentIds: string[]; notes: string[] }>; unresolvedStatements: string[] };
  assert.equal(rosterBody.drafts.length, 2);
  assert.equal(rosterBody.drafts[0]?.displayName, 'Alex Rivera');
  for (const draft of rosterBody.drafts) {
    assert.deepEqual(draft.anchorCommitmentIds, [], 'commitment ids are never invented from titles');
  }
  assert.ok(rosterBody.unresolvedStatements.some((s) => /VIP Gala Dinner/.test(s)), 'titles surface as unresolved statements');

  // Nothing was promoted — mapping produces drafts, not state.
  assert.equal((await harness.trips.listTrips()).length, 0);

  // Brief mapping: recognized clause becomes a ruleSet PROPOSAL; the unknown
  // clause kind is recorded as uncertainty, never silently dropped.
  const brief = await handlers.mapBrief({
    content: 'brief attached',
    at: AT,
    sourceId: 'src-evt-map',
    timezone: 'Asia/Singapore',
  });
  assert.equal(brief.status, 200);
  const briefBody = brief.body as {
    event: { eventName?: string };
    ruleSet?: { rules: Array<{ kind: string }> };
    uncertainties: string[];
  };
  assert.equal(briefBody.event.eventName, 'Synthetic Programme Event');
  assert.ok(briefBody.ruleSet, 'FUNDED_WINDOW clause maps to a ruleSet proposal');
  assert.ok(briefBody.ruleSet!.rules.every((rule) => rule.kind === 'FUNDED_WINDOW'));
  assert.ok(briefBody.uncertainties.some((u) => /NO_SMOKING_ROOMS/.test(u)), 'unrecognized clause kinds stay visible');
  assert.equal((await harness.trips.listTrips()).length, 0, 'brief mapping never touches authoritative state');

  // Malformed model output fails closed.
  const badTransport = new ScriptedModelTransport(['this is not json']);
  const badHandlers = createMappingHandlers(harness, badTransport);
  const badRoster = await badHandlers.mapRoster({ content: 'roster', at: AT, sourceId: 'src-evt-map' });
  assert.equal(badRoster.status, 422);
  assert.equal((badRoster.body as { error: string }).error, 'mapping_failed');

  // Missing seam refuses service rather than guessing.
  const noSeam = createMappingHandlers(harness);
  assert.equal((await noSeam.mapRoster({ content: 'x', at: AT, sourceId: 's' })).status, 503);
  assert.equal((await noSeam.mapBrief({ content: 'x', at: AT, sourceId: 's' })).status, 503);

  // Boundary validation still applies.
  const invalidBody = await handlers.mapRoster({ content: '', at: AT, sourceId: 's' });
  assert.equal(invalidBody.status, 400);
});

test('programme HTML route renders the frozen ProgrammeView screen', async () => {
  const harness = createHarness();
  const eventId = 'evt-html';
  const handlers = createMappingHandlers(harness);
  const context = await handlers.applyContext(programmeContextBody(eventId));
  assert.equal(context.status, 200);

  const config = AppConfigSchema.parse({
    environment: 'local',
    adapterMode: 'REPLAY',
    sqlitePath: ':memory:',
    fixturesDir: 'fixtures',
    providers: { atlas: { env: 'sandbox' }, modelStudio: {}, googleRoutes: {} },
  });
  const endpoints: AppEndpoints = {
    now: () => AT,
    operatorDashboard: async () => {
      throw new Error('not wired in this test');
    },
    caseDetail: async () => undefined,
    travellerTrip: async () => undefined,
    firstTripId: async () => undefined,
    travellerDecision: async () => ({ accepted: false, error: 'not wired in this test' }),
    programme: handlers,
  };
  const server = createAppServer(config, endpoints);
  await new Promise<void>((resolvePromise) => server.listen(0, resolvePromise));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  try {
    const known = await fetch(`${base}/programme?event=${eventId}&at=${encodeURIComponent(AT)}`);
    assert.equal(known.status, 200);
    const html = await known.text();
    assert.match(html, /<!doctype html>/i);
    assert.ok(html.includes('Synthetic Programme Event'), 'programme page names the anchor event');

    const unknown = await fetch(`${base}/programme?event=evt-missing&at=${encodeURIComponent(AT)}`);
    assert.equal(unknown.status, 404);
    assert.ok((await unknown.text()).includes('unavailable'), 'unknown events render the honest error panel');

    const missingEvent = await fetch(`${base}/programme`);
    assert.equal(missingEvent.status, 400);
  } finally {
    await new Promise<void>((resolvePromise, reject) =>
      server.close((error) => (error ? reject(error) : resolvePromise())),
    );
    harness.db.close();
  }
});

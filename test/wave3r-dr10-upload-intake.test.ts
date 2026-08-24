/**
 * DR-10 — Upload Event Details onboarding test (Lane H).
 *
 * Proves:
 * 1. A representative roster CSV + event brief creates a valid draft programme bundle
 * 2. Promotion through existing contracts (ProgrammeService) succeeds
 * 3. Malformed roster rows surface as issues, not silent drops
 * 4. Missing facts remain uncertain (never fabricated)
 * 5. The deterministic path needs no credentials
 */
import test from 'node:test';
import assert from 'node:assert/strict';
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
import { ProgrammeService } from '../src/app/programme.ts';
import { parseRosterFromCsv } from '../src/app/rosterParser.ts';
import { createDraftProgrammeBundle, promoteDraftBundle } from '../src/app/uploadIntake.ts';
import type { AnchorEvent, Organisation, Place } from '../src/domain/entities.ts';

const AT = '2026-09-01T00:00:00+00:00';

interface Harness {
  service: ProgrammeService;
  trips: SqliteTripRepository;
  entities: SqliteEntityStore;
  sources: SqliteSourceRepository;
  signals: SqliteSignalRepository;
  cases: SqliteCaseRepository;
  audit: SqliteAuditRepository;
  mutations: SqlMutationService;
}

function createHarness(): Harness {
  const db = openDatabase(':memory:');
  const trips = new SqliteTripRepository(db);
  const entities = new SqliteEntityStore(db);
  const sources = new SqliteSourceRepository(db);
  const signals = new SqliteSignalRepository(db);
  const cases = new SqliteCaseRepository(db);
  const audit = new SqliteAuditRepository(db);
  const mutations = new SqlMutationService({ db, trips, entities });
  const service = new ProgrammeService({ mutations, entities, trips, sources, audit });
  return { service, trips, entities, sources, signals, cases, audit, mutations };
}

// ---------------------------------------------------------------------------
// Test 1: Representative roster CSV + event brief -> valid draft bundle
// ---------------------------------------------------------------------------

test('dr10: roster CSV + event brief creates valid draft programme bundle', () => {
  const rosterCsv = [
    'Speaker Name,Role,Home Location,Travel Required,Email,Phone',
    'Alice Chen,Keynote Speaker,San Francisco,yes,alice@example.com,+1-555-0101',
    'Bob Kumar,Panelist,New York,yes,bob@example.com,+1-555-0102',
    'Carol Wang,Workshop Lead,Seattle,no,carol@example.com,+1-555-0103',
  ].join('\n');

  const eventBrief = {
    eventName: 'Tech Summit 2026',
    eventKind: 'CONFERENCE' as const,
    venueName: 'Convention Center',
    venueTimezone: 'America/Los_Angeles',
    startsAt: '2026-10-15T09:00:00-07:00',
    endsAt: '2026-10-17T17:00:00-07:00',
    organiserName: 'Tech Events Inc',
  };

  const bundle = createDraftProgrammeBundle({
    anchorEventId: 'evt-tech-summit',
    sourceId: 'src-tech-summit',
    at: AT,
    eventBriefText: 'Tech Summit 2026 at Convention Center',
    rosterCsvText: rosterCsv,
    eventBrief,
  });

  // Draft bundle structure is valid.
  assert.ok(bundle.context);
  assert.ok(bundle.importDraft);
  assert.equal(bundle.importDraft.anchorEventId, 'evt-tech-summit');
  assert.equal(bundle.importDraft.channel, 'BULK_IMPORT');
  assert.equal(bundle.importDraft.travellers.length, 3);

  // Traveller drafts populated from roster.
  const alice = bundle.importDraft.travellers[0]!;
  assert.equal(alice.displayName, 'Alice Chen');
  assert.equal(alice.homeLocationText, 'San Francisco');
  assert.equal(alice.identity.email, 'alice@example.com');
  assert.ok(alice.notes.includes('role: Keynote Speaker'));
  assert.ok(alice.notes.includes('travel required'));

  const bob = bundle.importDraft.travellers[1]!;
  assert.equal(bob.displayName, 'Bob Kumar');
  assert.equal(bob.homeLocationText, 'New York');

  const carol = bundle.importDraft.travellers[2]!;
  assert.equal(carol.displayName, 'Carol Wang');
  assert.equal(carol.homeLocationText, 'Seattle');
  assert.ok(!carol.notes.includes('travel required'));

  // Context populated from event brief.
  assert.ok(bundle.context.organisation);
  assert.equal(bundle.context.organisation.name, 'Tech Events Inc');
  assert.ok(bundle.context.anchorEvent);
  assert.equal(bundle.context.anchorEvent.name, 'Tech Summit 2026');
  assert.equal(bundle.context.anchorEvent.kind, 'CONFERENCE');
  assert.ok(bundle.context.places);
  assert.equal(bundle.context.places.length, 1);
  assert.equal(bundle.context.places[0].name, 'Convention Center');

  // No parse issues for well-formed CSV.
  assert.equal(bundle.parseIssues.length, 0);
});

// ---------------------------------------------------------------------------
// Test 2: Promotion through existing contracts succeeds
// ---------------------------------------------------------------------------

test('dr10: draft bundle promotes through existing ProgrammeService contracts', async () => {
  const harness = createHarness();

  const rosterCsv = [
    'Speaker Name,Role,Home Location,Travel Required,Email',
    'David Lee,Speaker,Tokyo,yes,david@example.com',
    'Emma Smith,Panelist,London,yes,emma@example.com',
  ].join('\n');

  const eventBrief = {
    eventName: 'Global Forum',
    eventKind: 'CONFERENCE' as const,
    venueName: 'Grand Hotel',
    venueTimezone: 'Europe/London',
    startsAt: '2026-11-01T10:00:00+00:00',
    endsAt: '2026-11-03T18:00:00+00:00',
    organiserName: 'Global Events Ltd',
  };

  const bundle = createDraftProgrammeBundle({
    anchorEventId: 'evt-global-forum',
    sourceId: 'src-global-forum',
    at: AT,
    eventBriefText: 'Global Forum at Grand Hotel',
    rosterCsvText: rosterCsv,
    eventBrief,
  });

  // Promote through existing ProgrammeService.
  const result = await promoteDraftBundle(harness.service, bundle);

  assert.equal(result.contextAccepted, true);
  assert.equal(result.contextIssues.length, 0);
  assert.ok(result.intakeOutcome);
  assert.equal(result.intakeOutcome.accepted, true);
  assert.equal(result.intakeOutcome.outcomes.length, 2);
  assert.equal(result.intakeOutcome.outcomes.filter((o: any) => o.promoted).length, 2);

  // Verify trips were created.
  const tripSummaries = await harness.trips.listTrips();
  assert.equal(tripSummaries.length, 2);

  // Verify organisation, anchor event, and place were created.
  const orgEntry = await harness.entities.get('ORGANISATION', 'org-evt-global-forum');
  assert.ok(orgEntry);
  assert.equal(orgEntry.entityType, 'ORGANISATION');
  assert.equal(orgEntry.entity.name, 'Global Events Ltd');

  const eventEntry = await harness.entities.get('ANCHOR_EVENT', 'evt-global-forum');
  assert.ok(eventEntry);
  assert.equal(eventEntry.entityType, 'ANCHOR_EVENT');
  assert.equal(eventEntry.entity.name, 'Global Forum');

  const placeEntry = await harness.entities.get('PLACE', 'plc-evt-global-forum-venue');
  assert.ok(placeEntry);
  assert.equal(placeEntry.entityType, 'PLACE');
  assert.equal(placeEntry.entity.name, 'Grand Hotel');
});

// ---------------------------------------------------------------------------
// Test 3: Malformed roster rows surface as issues, not silent drops
// ---------------------------------------------------------------------------

test('dr10: malformed roster rows surface as parse issues', () => {
  const rosterCsv = [
    'Speaker Name,Role,Home Location,Travel Required,Email',
    'Valid Speaker,Keynote,Berlin,yes,valid@example.com',
    ',Panelist,Paris,yes,missing-name@example.com',
    'Another Valid,Workshop,Madrid,no,another@example.com',
  ].join('\n');

  const bundle = createDraftProgrammeBundle({
    anchorEventId: 'evt-malformed',
    sourceId: 'src-malformed',
    at: AT,
    eventBriefText: 'Event with malformed roster',
    rosterCsvText: rosterCsv,
    eventBrief: {
      eventName: 'Malformed Test Event',
      eventKind: 'CONFERENCE' as const,
      venueName: 'Test Venue',
      venueTimezone: 'Europe/Berlin',
      startsAt: '2026-12-01T10:00:00+01:00',
      endsAt: '2026-12-03T18:00:00+01:00',
      organiserName: 'Test Org',
    },
  });

  // Two valid rows parsed.
  assert.equal(bundle.importDraft.travellers.length, 2);
  assert.equal(bundle.importDraft.travellers[0]!.displayName, 'Valid Speaker');
  assert.equal(bundle.importDraft.travellers[1]!.displayName, 'Another Valid');

  // One malformed row surfaced as issue.
  assert.equal(bundle.parseIssues.length, 1);
  assert.equal(bundle.parseIssues[0]!.rowNumber, 3);
  assert.match(bundle.parseIssues[0]!.reason, /missing speaker name/i);

  // Issue also appears in unresolvedStatements.
  assert.equal(bundle.importDraft.unresolvedStatements.length, 1);
  assert.match(bundle.importDraft.unresolvedStatements[0]!, /row 3/i);
});

// ---------------------------------------------------------------------------
// Test 4: Missing facts remain uncertain (never fabricated)
// ---------------------------------------------------------------------------

test('dr10: missing facts remain uncertain, never fabricated', () => {
  const rosterCsv = [
    'Speaker Name,Email',
    'Minimal Speaker,minimal@example.com',
  ].join('\n');

  const bundle = createDraftProgrammeBundle({
    anchorEventId: 'evt-minimal',
    sourceId: 'src-minimal',
    at: AT,
    eventBriefText: 'Minimal event',
    rosterCsvText: rosterCsv,
    // No eventBrief provided.
  });

  // Traveller draft has minimal fields.
  assert.equal(bundle.importDraft.travellers.length, 1);
  const traveller = bundle.importDraft.travellers[0]!;
  assert.equal(traveller.displayName, 'Minimal Speaker');
  assert.equal(traveller.homeLocationText, undefined);
  assert.equal(traveller.notes.length, 0);

  // Uncertainties recorded for missing facts.
  assert.ok(bundle.uncertainties.length >= 3);
  const statements = bundle.uncertainties.map((u) => u.statement);
  assert.ok(statements.some((s) => /event brief not structured/i.test(s)));
  assert.ok(statements.some((s) => /organiser not supplied/i.test(s)));
  assert.ok(statements.some((s) => /anchor event not supplied/i.test(s)));
  assert.ok(statements.some((s) => /venue\/place not supplied/i.test(s)));

  // Context is minimal (no organisation, anchorEvent, places).
  assert.equal(bundle.context.organisation, undefined);
  assert.equal(bundle.context.anchorEvent, undefined);
  assert.equal(bundle.context.places, undefined);
});

// ---------------------------------------------------------------------------
// Test 5: Deterministic path needs no credentials
// ---------------------------------------------------------------------------

test('dr10: deterministic path requires no credentials', async () => {
  const harness = createHarness();

  const rosterCsv = [
    'Speaker Name,Role,Email',
    'No Cred Speaker,Speaker,nocred@example.com',
  ].join('\n');

  const bundle = createDraftProgrammeBundle({
    anchorEventId: 'evt-nocred',
    sourceId: 'src-nocred',
    at: AT,
    eventBriefText: 'No credentials needed',
    rosterCsvText: rosterCsv,
    eventBrief: {
      eventName: 'No-Cred Event',
      eventKind: 'OFFSITE' as const,
      venueName: 'Simple Venue',
      venueTimezone: 'UTC',
      startsAt: '2026-10-01T10:00:00+00:00',
      endsAt: '2026-10-02T18:00:00+00:00',
      organiserName: 'Simple Org',
    },
  });

  // Promote without any model credentials.
  const result = await promoteDraftBundle(harness.service, bundle);

  assert.equal(result.contextAccepted, true);
  assert.equal(result.intakeOutcome.accepted, true);
  assert.equal(result.intakeOutcome.outcomes.length, 1);
  assert.equal(result.intakeOutcome.outcomes[0].promoted, true);

  // Verify the trip was created.
  const tripSummaries = await harness.trips.listTrips();
  assert.equal(tripSummaries.length, 1);
  assert.equal(tripSummaries[0]!.label, 'No Cred Speaker');
});

// ---------------------------------------------------------------------------
// Test 6: Roster parser handles various header aliases
// ---------------------------------------------------------------------------

test('dr10: roster parser handles various header aliases', () => {
  const rosterCsv = [
    'Full Name,Job Title,City,Needs Travel,Contact Email',
    'Alias Test,Engineer,Singapore,yes,alias@example.com',
  ].join('\n');

  const result = parseRosterFromCsv(rosterCsv);

  assert.equal(result.records.length, 1);
  const aliasRecord = result.records[0]!;
  assert.equal(aliasRecord.speakerName, 'Alias Test');
  assert.equal(aliasRecord.role, 'Engineer');
  assert.equal(aliasRecord.homeLocation, 'Singapore');
  assert.equal(aliasRecord.travelRequired, true);
  assert.equal(aliasRecord.contact?.email, 'alias@example.com');
  assert.equal(result.issues.length, 0);
});

// ---------------------------------------------------------------------------
// Test 7: Policy text recorded as uncertainty
// ---------------------------------------------------------------------------

test('dr10: policy text recorded as uncertainty (not yet parsed)', () => {
  const rosterCsv = [
    'Speaker Name,Email',
    'Policy Test,policy@example.com',
  ].join('\n');

  const bundle = createDraftProgrammeBundle({
    anchorEventId: 'evt-policy',
    sourceId: 'src-policy',
    at: AT,
    eventBriefText: 'Event with policy',
    rosterCsvText: rosterCsv,
    policyText: 'All attendees must comply with the event code of conduct.',
    eventBrief: {
      eventName: 'Policy Event',
      eventKind: 'CONFERENCE' as const,
      venueName: 'Policy Venue',
      venueTimezone: 'UTC',
      startsAt: '2026-10-01T10:00:00+00:00',
      endsAt: '2026-10-02T18:00:00+00:00',
      organiserName: 'Policy Org',
    },
  });

  // Policy text recorded as uncertainty.
  const policyUncertainty = bundle.uncertainties.find((u) =>
    /policy text provided but not yet parsed/i.test(u.statement),
  );
  assert.ok(policyUncertainty);
  assert.equal(policyUncertainty.severity, 'MEDIUM');
});

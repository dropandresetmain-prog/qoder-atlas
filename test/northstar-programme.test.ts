/**
 * NS-G1 evidence — Wave 1 programme foundation.
 *
 * Proves, against a synthetic programme (no scenario fixture content):
 * - a ~40–45 traveller programme promotes cleanly through the frozen
 *   MutationService path;
 * - manual single intake and bulk intake use the SAME normalized contract;
 * - missing facts stay missing (never fabricated);
 * - shared commitments link to traveller Engagements/Trips;
 * - the programme read model projects authoritative state at scale;
 * - commitment change fan-out touches ONLY linked trips;
 * - funding allocation is deterministic (covered vs traveller-funded);
 * - an alternate event/location substitutes without application change.
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
import { SqlitePreferenceStore } from '../src/app/preferenceStore.ts';
import { ProgrammeService, processCommitmentChange, intakeUncertainties } from '../src/app/programme.ts';
import { projectProgrammeView } from '../src/app/programmeReadmodel.ts';
import { OverlayViabilityEngine } from '../src/engine/overlay.ts';
import { allocateCost } from '../src/engine/funding.ts';
import type { ProgrammeImportDraft } from '../src/contracts/programmeIntake.ts';
import type { AnchorEvent, Organisation, Place } from '../src/domain/entities.ts';
import type { RuleSet } from '../src/domain/rules.ts';
import type { TripSignal } from '../src/operational/signal.ts';

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
  readDeps: {
    snapshot: {
      trips: SqliteTripRepository;
      entities: SqliteEntityStore;
      preferences: SqlitePreferenceStore;
      sources: SqliteSourceRepository;
    };
    signals: SqliteSignalRepository;
    cases: SqliteCaseRepository;
    audit: SqliteAuditRepository;
    viability: OverlayViabilityEngine;
  };
}

function createHarness(): Harness {
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
  return {
    service,
    trips,
    entities,
    sources,
    signals,
    cases,
    audit,
    mutations,
    readDeps: {
      snapshot: { trips, entities, preferences, sources },
      signals,
      cases,
      audit,
      viability: new OverlayViabilityEngine(),
    },
  };
}

/** Synthetic programme context; ids/data only, never real scenario content. */
function programmeContext(eventId: string, venuePlaceId: string, airportPlaceId: string) {
  const organisation: Organisation = {
    id: `org-${eventId}`,
    name: 'Synthetic Programme Organiser',
    roles: ['EVENT_ORGANISER', 'PAYER'],
  };
  const venue: Place = {
    id: venuePlaceId,
    name: 'Synthetic Venue',
    kind: 'VENUE',
    timezone: 'Asia/Singapore',
    externalRefs: [],
  };
  const airport: Place = {
    id: airportPlaceId,
    name: 'Synthetic Airport',
    kind: 'AIRPORT',
    timezone: 'Asia/Singapore',
    externalRefs: [{ system: 'airport-code', value: 'SYN' }],
  };
  const anchorEvent: AnchorEvent = {
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
        startsAt: {
          value: '2026-09-08T15:00:00+08:00',
          sourceId: `src-${eventId}`,
          authority: 'AUTHORITATIVE',
          observedAt: AT,
        },
        endsAt: {
          value: '2026-09-08T17:00:00+08:00',
          sourceId: `src-${eventId}`,
          authority: 'AUTHORITATIVE',
          observedAt: AT,
        },
        sourceId: `src-${eventId}`,
      },
      {
        id: `cmt-${eventId}-closing`,
        anchorEventId: eventId,
        title: 'Closing Session',
        kind: 'SESSION',
        placeId: venuePlaceId,
        startsAt: {
          value: '2026-09-11T09:00:00+08:00',
          sourceId: `src-${eventId}`,
          authority: 'AUTHORITATIVE',
          observedAt: AT,
        },
        sourceId: `src-${eventId}`,
      },
    ],
    sourceIds: [],
  };
  const fundingRuleSet: RuleSet = {
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
  };
  return { organisation, places: [venue, airport], anchorEvent, ruleSets: [fundingRuleSet] };
}

function importDraft(eventId: string, sourceId: string, count: number, opts?: { sparse?: boolean }): ProgrammeImportDraft {
  const travellers = Array.from({ length: count }, (_, index) => {
    const n = index + 1;
    const sparse = opts?.sparse ?? n % 7 === 0;
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
  return {
    id: `import-${eventId}`,
    anchorEventId: eventId,
    channel: 'BULK_IMPORT',
    sourceId,
    receivedAt: AT,
    travellers,
    unresolvedStatements: [],
  };
}

test('nsg1: a 43-traveller programme promotes cleanly at scale', async () => {
  const harness = createHarness();
  const { service } = harness;
  const context = programmeContext('evt-scale', 'plc-venue', 'plc-airport');
  await service.applyProgrammeContext({
    at: AT,
    sourceId: 'src-evt-scale',
    organisation: context.organisation,
    anchorEvent: context.anchorEvent,
    places: context.places,
    ruleSets: context.ruleSets,
  });

  const result = await service.intakeImportDraft({
    importDraft: importDraft('evt-scale', 'src-evt-scale', 43),
    at: AT,
  });

  assert.equal(result.outcomes.length, 43);
  assert.equal(result.outcomes.filter((o) => o.promoted).length, 43);
  const tripSummaries = await harness.trips.listTrips();
  assert.equal(tripSummaries.length, 43);

  // Commitment linkage: every promoted trip carries an engagement of the
  // opening commitment, linked by id — never by title.
  for (const summary of tripSummaries) {
    const trip = await harness.trips.getTrip(summary.tripId);
    assert.ok(trip);
    assert.equal(trip.anchorEventId, 'evt-scale');
    const engagements = trip.elements.filter((e) => e.elementKind === 'ENGAGEMENT');
    assert.equal(engagements.length, 1);
    if (engagements[0]?.elementKind === 'ENGAGEMENT') {
      assert.equal(engagements[0].data.anchorCommitmentId, 'cmt-evt-scale-opening');
    }
    // Intake creates NO bookings and invents NO facts.
    assert.equal(trip.elements.filter((e) => e.elementKind !== 'ENGAGEMENT').length, 0);
  }
});

test('nsg1: manual single add and bulk import share the normalized contract', async () => {
  const harness = createHarness();
  const { service } = harness;
  const context = programmeContext('evt-eq', 'plc-venue', 'plc-airport');
  await service.applyProgrammeContext({
    at: AT,
    sourceId: 'src-evt-eq',
    organisation: context.organisation,
    anchorEvent: context.anchorEvent,
    places: context.places,
    ruleSets: context.ruleSets,
  });

  // Manual single traveller (channel MANUAL_ENTRY) ...
  const manual = await service.intakeImportDraft({
    importDraft: {
      id: 'import-manual',
      anchorEventId: 'evt-eq',
      channel: 'MANUAL_ENTRY',
      sourceId: 'src-evt-eq',
      receivedAt: AT,
      travellers: [
        {
          draftId: 'draft-manual-1',
          displayName: 'Manual Traveller',
          identity: { email: 'manual@example.test' },
          nationalityCodes: ['SG'],
          accessibilityStatements: [],
          notes: [],
          anchorCommitmentIds: ['cmt-evt-eq-opening'],
        },
      ],
      unresolvedStatements: [],
    },
    at: AT,
  });
  assert.equal(manual.outcomes[0]?.promoted, true);

  // ... versus the same traveller through the bulk contract shape.
  const bulkShape: ProgrammeImportDraft = {
    id: 'import-bulk',
    anchorEventId: 'evt-eq',
    channel: 'BULK_IMPORT',
    sourceId: 'src-evt-eq',
    receivedAt: AT,
    travellers: [
      {
        draftId: 'draft-bulk-1',
        displayName: 'Bulk Traveller',
        identity: { email: 'bulk@example.test' },
        nationalityCodes: ['SG'],
        accessibilityStatements: [],
        notes: [],
        anchorCommitmentIds: ['cmt-evt-eq-opening'],
      },
    ],
    unresolvedStatements: [],
  };
  const bulk = await service.intakeImportDraft({ importDraft: bulkShape, at: AT });
  assert.equal(bulk.outcomes[0]?.promoted, true);

  // Both travellers end up structurally identical trips (same element kinds,
  // same linkage, same viability) — equivalence is a promotion-time property.
  const manualTrip = await harness.trips.getTrip(manual.outcomes[0]!.tripId!);
  const bulkTrip = await harness.trips.getTrip(bulk.outcomes[0]!.tripId!);
  assert.ok(manualTrip && bulkTrip);
  const shape = (trip: typeof manualTrip) =>
    JSON.stringify({
      elements: trip!.elements.map((e) => ({
        kind: e.elementKind,
        importance: e.importance,
        reservation: e.reservationState,
        commitment: e.elementKind === 'ENGAGEMENT' ? e.data.anchorCommitmentId : undefined,
      })),
      objectives: trip!.objectives.map((o) => ({ hardness: o.hardness, status: o.status })),
      viability: trip!.viability,
    });
  assert.equal(shape(manualTrip), shape(bulkTrip));
});

test('nsg1: missing facts stay missing — never fabricated', async () => {
  const harness = createHarness();
  const { service } = harness;
  const context = programmeContext('evt-miss', 'plc-venue', 'plc-airport');
  await service.applyProgrammeContext({
    at: AT,
    sourceId: 'src-evt-miss',
    organisation: context.organisation,
    anchorEvent: context.anchorEvent,
    places: context.places,
    ruleSets: context.ruleSets,
  });

  const result = await service.intakeImportDraft({
    importDraft: {
      id: 'import-missing',
      anchorEventId: 'evt-miss',
      channel: 'LLM_MAPPED',
      sourceId: 'src-evt-miss',
      receivedAt: AT,
      travellers: [
        {
          draftId: 'draft-sparse',
          displayName: 'Sparse Traveller',
          identity: {},
          nationalityCodes: [],
          accessibilityStatements: [],
          notes: [],
          anchorCommitmentIds: [],
        },
      ],
      unresolvedStatements: ['passport number unreadable in the roster scan'],
    },
    at: AT,
  });

  const outcome = result.outcomes[0];
  assert.equal(outcome?.promoted, true);
  const trip = await harness.trips.getTrip(outcome!.tripId!);
  const travellerEntry = await harness.entities.get('TRAVELLER', trip!.travellerIds[0]!);
  assert.ok(travellerEntry?.entityType === 'TRAVELLER');
  assert.equal(travellerEntry.entity.nationalityCodes, undefined); // stays missing
  assert.equal(travellerEntry.entity.passports, undefined); // never invented
  assert.equal(travellerEntry.entity.homePlaceId, undefined);

  const uncertainties = intakeUncertainties(
    {
      id: 'import-missing',
      anchorEventId: 'evt-miss',
      channel: 'LLM_MAPPED',
      sourceId: 'src-evt-miss',
      receivedAt: AT,
      travellers: [],
      unresolvedStatements: ['passport number unreadable in the roster scan'],
    },
    result.outcomes,
  );
  assert.ok(uncertainties.length >= 1);
  assert.ok(outcome!.issues.some((issue) => issue.includes('nationality not supplied')));
});

test('nsg1: programme read model projects all travellers at scale', async () => {
  const harness = createHarness();
  const { service } = harness;
  const context = programmeContext('evt-view', 'plc-venue', 'plc-airport');
  await service.applyProgrammeContext({
    at: AT,
    sourceId: 'src-evt-view',
    organisation: context.organisation,
    anchorEvent: context.anchorEvent,
    places: context.places,
    ruleSets: context.ruleSets,
  });
  await service.intakeImportDraft({ importDraft: importDraft('evt-view', 'src-evt-view', 41), at: AT });

  const view = await projectProgrammeView(harness.readDeps, 'evt-view', AT);
  assert.ok(view);
  assert.equal(view.anchorEventName, 'Synthetic Programme Event');
  assert.equal(view.summary.total, 41);
  assert.equal(view.travellers.length, 41);
  // Freshly imported travellers have engagements only -> initial planning.
  assert.equal(view.summary.planning, 41);
  assert.deepEqual(view.travellers.map((t) => t.status), Array(41).fill('PLANNING'));
});

test('nsg1: commitment change fans out ONLY to linked trips', async () => {
  const harness = createHarness();
  const { service } = harness;
  const context = programmeContext('evt-fan', 'plc-venue', 'plc-airport');
  await service.applyProgrammeContext({
    at: AT,
    sourceId: 'src-evt-fan',
    organisation: context.organisation,
    anchorEvent: context.anchorEvent,
    places: context.places,
    ruleSets: context.ruleSets,
  });

  // Three travellers linked to the opening commitment.
  await service.intakeImportDraft({
    importDraft: {
      ...importDraft('evt-fan', 'src-evt-fan', 3),
      travellers: importDraft('evt-fan', 'src-evt-fan', 3).travellers.map((t) => ({
        ...t,
        anchorCommitmentIds: ['cmt-evt-fan-opening'],
      })),
    },
    at: AT,
  });
  // One traveller linked to the CLOSING commitment only (unaffected).
  await service.intakeImportDraft({
    importDraft: {
      id: 'import-fan-closing',
      anchorEventId: 'evt-fan',
      channel: 'MANUAL_ENTRY',
      sourceId: 'src-evt-fan',
      receivedAt: AT,
      travellers: [
        {
          draftId: 'draft-closing-1',
          displayName: 'Closing Traveller',
          identity: {},
          nationalityCodes: ['SG'],
          accessibilityStatements: [],
          notes: [],
          anchorCommitmentIds: ['cmt-evt-fan-closing'],
        },
      ],
      unresolvedStatements: [],
    },
    at: AT,
  });
  const tripCountBefore = (await harness.trips.listTrips()).length;
  assert.equal(tripCountBefore, 4);

  const signal: TripSignal = {
    id: 'sig-commitment-move',
    kind: 'ANCHOR_COMMITMENT_CHANGE',
    occurredAt: '2026-09-05T10:00:00+00:00',
    receivedAt: '2026-09-05T10:05:00+00:00',
    sourceId: 'src-evt-fan',
    authority: 'AUTHORITATIVE',
    summary: 'opening session moved earlier',
    payload: {
      anchorEventId: 'evt-fan',
      commitmentId: 'cmt-evt-fan-opening',
      changeKind: 'RESCHEDULED',
      newStartsAt: '2026-09-08T10:00:00+08:00',
      newEndsAt: '2026-09-08T12:00:00+08:00',
    },
  };

  const outcome = await processCommitmentChange(
    {
      mutations: harness.mutations,
      entities: harness.entities,
      trips: harness.trips,
      signals: harness.signals,
      cases: harness.cases,
      audit: harness.audit,
    },
    signal,
  );

  assert.equal(outcome.accepted, true);
  assert.equal(outcome.linkedTripCount, 3);
  assert.equal(outcome.unlinkedTripCount, 1);
  assert.equal(outcome.processed.length, 3);

  // Shared commitment truth updated through the validated path.
  const eventEntry = await harness.entities.get('ANCHOR_EVENT', 'evt-fan');
  assert.ok(eventEntry?.entityType === 'ANCHOR_EVENT');
  const commitment = eventEntry.entity.commitments.find((c) => c.id === 'cmt-evt-fan-opening');
  assert.equal(commitment?.startsAt.value, '2026-09-08T10:00:00+08:00');

  // Per-trip cases opened for linked trips only; the closing-only traveller
  // has no case and no signal.
  const closingTrip = (await harness.trips.listTrips()).find((s) => s.label === 'Closing Traveller');
  assert.ok(closingTrip);
  const closingCases = await harness.cases.listCasesForTrip(closingTrip!.tripId);
  assert.equal(closingCases.length, 0);
  const closingSignals = await harness.signals.listSignalsForTrip(closingTrip!.tripId);
  assert.equal(closingSignals.length, 0);
});

test('nsg1: invalid commitment change payload never mutates shared truth', async () => {
  const harness = createHarness();
  const { service } = harness;
  const context = programmeContext('evt-inv', 'plc-venue', 'plc-airport');
  await service.applyProgrammeContext({
    at: AT,
    sourceId: 'src-evt-inv',
    organisation: context.organisation,
    anchorEvent: context.anchorEvent,
    places: context.places,
    ruleSets: context.ruleSets,
  });

  const signal: TripSignal = {
    id: 'sig-bad-payload',
    kind: 'ANCHOR_COMMITMENT_CHANGE',
    occurredAt: '2026-09-05T10:00:00+00:00',
    sourceId: 'src-evt-inv',
    authority: 'AUTHORITATIVE',
    payload: { anchorEventId: 'evt-inv', commitmentId: 'cmt-evt-inv-opening' }, // changeKind missing
  };
  const outcome = await processCommitmentChange(
    {
      mutations: harness.mutations,
      entities: harness.entities,
      trips: harness.trips,
      signals: harness.signals,
      cases: harness.cases,
      audit: harness.audit,
    },
    signal,
  );
  assert.equal(outcome.accepted, false);
  assert.ok(outcome.issues.some((issue) => issue.code === 'COMMITMENT_CHANGE_PAYLOAD_INVALID'));
  const eventEntry = await harness.entities.get('ANCHOR_EVENT', 'evt-inv');
  assert.ok(eventEntry?.entityType === 'ANCHOR_EVENT');
  const commitment = eventEntry.entity.commitments.find((c) => c.id === 'cmt-evt-inv-opening');
  assert.equal(commitment?.startsAt.value, '2026-09-08T15:00:00+08:00'); // unchanged
});

test('nsg1: funded-window allocation is deterministic and honest', () => {
  const context = programmeContext('evt-fund', 'plc-venue', 'plc-airport');
  const rules = context.ruleSets[0]!.rules;

  // Inside the covered window -> event organisation pays.
  const covered = allocateCost({
    rules,
    priceDelta: { amount: 200, currency: 'SGD' },
    costAccruesAt: '2026-09-08T12:00:00+08:00',
  });
  assert.ok(covered);
  assert.equal(covered!.coveredBy, 'EVENT_ORGANISATION');
  assert.equal(covered!.coveredAmount?.amount, 200);
  assert.equal(covered!.incrementalAmount, undefined);

  // Outside (extension nights) -> traveller funds the increment.
  const extension = allocateCost({
    rules,
    priceDelta: { amount: 300, currency: 'SGD' },
    costAccruesAt: '2026-09-13T12:00:00+08:00',
  });
  assert.ok(extension);
  assert.equal(extension!.incrementalPayer, 'TRAVELLER');
  assert.equal(extension!.incrementalAmount?.amount, 300);
  assert.equal(extension!.coveredAmount, undefined);

  // No temporal anchor -> allocation cannot decide (UNKNOWN, not assumed).
  const unanchored = allocateCost({ rules, priceDelta: { amount: 100, currency: 'SGD' } });
  assert.equal(unanchored, undefined);

  // No funded-window rules at all -> unresolved.
  const none = allocateCost({ rules: [], priceDelta: { amount: 100, currency: 'SGD' }, costAccruesAt: AT });
  assert.equal(none, undefined);
});

test('nsg1: alternate event/location programme runs through the same code', async () => {
  const harness = createHarness();
  const { service } = harness;
  // Second, materially different programme: different ids, window, timezone,
  // venue kind — the application code path is identical.
  const context = programmeContext('evt-alt', 'plc-alt-venue', 'plc-alt-airport');
  const altEvent: AnchorEvent = {
    ...context.anchorEvent,
    id: 'evt-alt',
    name: 'Alternate Programme Event',
    kind: 'TOURNAMENT',
    placeId: 'plc-alt-venue',
    window: { startsAt: '2026-10-01T00:00:00+01:00', endsAt: '2026-10-04T23:59:00+01:00' },
    commitments: context.anchorEvent.commitments.map((c) => ({
      ...c,
      id: c.id.replace('evt-alt', 'evt-alt'),
      anchorEventId: 'evt-alt',
      placeId: 'plc-alt-venue',
      startsAt: { ...c.startsAt, value: '2026-10-02T10:00:00+01:00', sourceId: 'src-evt-alt' },
    })),
    sourceIds: [],
  };
  await service.applyProgrammeContext({
    at: AT,
    sourceId: 'src-evt-alt',
    organisation: { ...context.organisation, id: 'org-evt-alt' },
    anchorEvent: altEvent,
    places: [
      { id: 'plc-alt-venue', name: 'Alternate Venue', kind: 'VENUE', timezone: 'Europe/London', externalRefs: [] },
      { id: 'plc-alt-airport', name: 'Alternate Airport', kind: 'AIRPORT', timezone: 'Europe/London', externalRefs: [{ system: 'airport-code', value: 'ALT' }] },
    ],
    ruleSets: context.ruleSets.map((rs) => ({
      ...rs,
      id: 'rs-evt-alt-funding',
      ownerOrganisationId: 'org-evt-alt',
      sourceId: 'src-evt-alt',
      rules: rs.rules.map((rule) => ({
        ...rule,
        id: 'rule-evt-alt-funded-window',
        sourceId: 'src-evt-alt',
        windowStart: '2026-10-01T00:00:00+01:00',
        windowEnd: '2026-10-04T23:59:00+01:00',
      })),
    })),
  });

  const result = await service.intakeImportDraft({
    importDraft: {
      ...importDraft('evt-alt', 'src-evt-alt', 5),
      travellers: importDraft('evt-alt', 'src-evt-alt', 5).travellers.map((t) => ({
        ...t,
        anchorCommitmentIds: ['cmt-evt-alt-opening'],
      })),
    },
    at: AT,
  });
  assert.equal(result.outcomes.filter((o) => o.promoted).length, 5);

  const view = await projectProgrammeView(harness.readDeps, 'evt-alt', AT);
  assert.ok(view);
  assert.equal(view.anchorEventName, 'Alternate Programme Event');
  assert.equal(view.summary.total, 5);
});

test('nsg1: unknown commitment ids in drafts are rejected honestly', async () => {
  const harness = createHarness();
  const { service } = harness;
  const context = programmeContext('evt-link', 'plc-venue', 'plc-airport');
  await service.applyProgrammeContext({
    at: AT,
    sourceId: 'src-evt-link',
    organisation: context.organisation,
    anchorEvent: context.anchorEvent,
    places: context.places,
    ruleSets: context.ruleSets,
  });

  const result = await service.intakeImportDraft({
    importDraft: {
      id: 'import-link',
      anchorEventId: 'evt-link',
      channel: 'BULK_IMPORT',
      sourceId: 'src-evt-link',
      receivedAt: AT,
      travellers: [
        {
          draftId: 'draft-1',
          displayName: 'Linked Traveller',
          identity: {},
          nationalityCodes: ['SG'],
          accessibilityStatements: [],
          notes: [],
          anchorCommitmentIds: ['cmt-evt-link-opening', 'cmt-does-not-exist'],
        },
      ],
      unresolvedStatements: [],
    },
    at: AT,
  });

  const outcome = result.outcomes[0];
  assert.equal(outcome?.promoted, true);
  assert.ok(outcome!.issues.some((issue) => issue.includes('cmt-does-not-exist')));
  const trip = await harness.trips.getTrip(outcome!.tripId!);
  const engagements = trip!.elements.filter(
    (e): e is Extract<typeof e, { elementKind: 'ENGAGEMENT' }> => e.elementKind === 'ENGAGEMENT',
  );
  assert.equal(engagements.length, 1); // only the valid commitment linked
});

test('g3r-b: arrangement classification is explicit intake truth, independent of home locations', async () => {
  // G3R-Closure fix B: promote two cohorts with deliberately misleading
  // home locations — an "arranged" traveller whose home text matches the
  // event airport, and a "self-arranged" traveller whose home text is a
  // distant city. The authoritative classification and the projected counts
  // must follow ONLY the declared travelArrangement.
  const harness = createHarness();
  const { service } = harness;
  const context = programmeContext('evt-arr', 'plc-venue', 'plc-airport');
  await service.applyProgrammeContext({
    at: AT,
    sourceId: 'src-evt-arr',
    organisation: context.organisation,
    anchorEvent: context.anchorEvent,
    places: context.places,
    ruleSets: context.ruleSets,
  });

  const result = await service.intakeImportDraft({
    importDraft: {
      id: 'import-arr',
      anchorEventId: 'evt-arr',
      channel: 'BULK_IMPORT',
      sourceId: 'src-evt-arr',
      receivedAt: AT,
      travellers: [
        {
          draftId: 'draft-local-but-arranged',
          displayName: 'Local Yet Arranged',
          identity: {},
          // Home text equals the event airport code: a heuristic would call
          // this person local. The explicit declaration says otherwise.
          homeLocationText: 'SYN',
          nationalityCodes: ['SG'],
          accessibilityStatements: [],
          notes: [],
          anchorCommitmentIds: ['cmt-evt-arr-opening'],
          travelArrangement: 'NORTHSTAR_ARRANGED',
        },
        {
          draftId: 'draft-distant-but-self',
          displayName: 'Distant Yet Self-Arranged',
          identity: {},
          homeLocationText: 'Faraway City',
          nationalityCodes: ['SG'],
          accessibilityStatements: [],
          notes: [],
          anchorCommitmentIds: ['cmt-evt-arr-opening'],
          travelArrangement: 'SELF_OR_OTHER_ARRANGED',
        },
        {
          draftId: 'draft-undeclared',
          displayName: 'Undeclared Traveller',
          identity: {},
          nationalityCodes: [],
          accessibilityStatements: [],
          notes: [],
          anchorCommitmentIds: ['cmt-evt-arr-opening'],
        },
      ],
      unresolvedStatements: [],
    },
    at: AT,
  });
  assert.equal(result.outcomes.filter((o) => o.promoted).length, 3);

  const arranged = await harness.entities.get('TRAVELLER', 'trv-evt-arr-draft-local-but-arranged');
  assert.ok(arranged?.entityType === 'TRAVELLER');
  assert.equal(arranged.entity.travelArrangement, 'NORTHSTAR_ARRANGED');

  const self = await harness.entities.get('TRAVELLER', 'trv-evt-arr-draft-distant-but-self');
  assert.ok(self?.entityType === 'TRAVELLER');
  assert.equal(self.entity.travelArrangement, 'SELF_OR_OTHER_ARRANGED');

  // Undeclared stays UNSPECIFIED with an honest recorded decision.
  const undeclared = await harness.entities.get('TRAVELLER', 'trv-evt-arr-draft-undeclared');
  assert.ok(undeclared?.entityType === 'TRAVELLER');
  assert.equal(undeclared.entity.travelArrangement, 'UNSPECIFIED');
  const undeclaredOutcome = result.outcomes.find((o) => o.draftId === 'draft-undeclared');
  assert.ok(
    undeclaredOutcome!.issues.some((issue) => issue.includes('travel arrangement responsibility not declared')),
  );

  // The organiser projection reports explicit counts, never a location guess.
  const view = await projectProgrammeView(harness.readDeps, 'evt-arr', AT);
  assert.ok(view);
  assert.deepEqual(view.arrangementCounts, {
    total: 3,
    northstarArranged: 1,
    selfOrOtherArranged: 1,
    unspecified: 1,
  });
});

/**
 * R3A — Kimi projection closure evidence.
 *
 * Proves presentation fields derive from generic authoritative records,
 * absent data stays absent, alternate programmes share the same projection
 * path, and no hero-specific branching exists.
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
import { ProgrammeService } from '../src/app/programme.ts';
import { projectProgrammeView, projectProgrammeAugmentations } from '../src/app/programmeReadmodel.ts';
import { projectOperatorDashboardAugmentations } from '../src/app/operatorPresentation.ts';
import { projectTravellerPresentation } from '../src/app/travellerPresentation.ts';
import { projectOperatorDashboard } from '../src/app/readmodels.ts';
import { OverlayViabilityEngine } from '../src/engine/overlay.ts';
import type { AnchorEvent, Organisation, Place } from '../src/domain/entities.ts';
import type { RuleSet } from '../src/domain/rules.ts';
import type { RecoveryCase } from '../src/operational/case.ts';

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
  return {
    service,
    trips,
    entities,
    readDeps: {
      snapshot: { trips, entities, preferences, sources },
      signals,
      cases,
      audit,
      viability: new OverlayViabilityEngine(),
    },
  };
}

function programmeContext(eventId: string) {
  const organisation: Organisation = {
    id: `org-${eventId}`,
    name: 'Synthetic Organiser',
    roles: ['EVENT_ORGANISER'],
  };
  const venue: Place = {
    id: `plc-${eventId}-venue`,
    name: 'Synthetic Venue',
    kind: 'VENUE',
    timezone: 'Asia/Singapore',
    externalRefs: [],
  };
  const airport: Place = {
    id: `plc-${eventId}-airport`,
    name: 'Synthetic Airport',
    kind: 'AIRPORT',
    timezone: 'Asia/Singapore',
    externalRefs: [{ system: 'airport-code', value: 'SYN' }],
  };
  const airportA: Place = {
    id: `plc-${eventId}-remote`,
    name: 'Remote Airport',
    kind: 'AIRPORT',
    timezone: 'Asia/Singapore',
    externalRefs: [{ system: 'airport-code', value: 'AAA' }],
  };
  const anchorEvent: AnchorEvent = {
    id: eventId,
    name: `Event ${eventId}`,
    kind: 'CONFERENCE',
    placeId: venue.id,
    window: { startsAt: '2026-09-07T00:00:00+08:00', endsAt: '2026-09-11T23:59:00+08:00' },
    organiserOrganisationId: organisation.id,
    commitments: [
      {
        id: `cmt-${eventId}-opening`,
        anchorEventId: eventId,
        title: 'Opening Session',
        kind: 'SESSION',
        placeId: venue.id,
        startsAt: {
          value: '2026-09-30T09:00:00+08:00',
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
    id: `rs-${eventId}`,
    kind: 'EVENT',
    name: 'funding',
    ownerOrganisationId: organisation.id,
    sourceId: `src-${eventId}`,
    rules: [],
  };
  return { organisation, places: [venue, airport, airportA], anchorEvent, ruleSets: [fundingRuleSet] };
}

test('r3a: programme augmentations project role and arrival from intake truth', async () => {
  const harness = createHarness();
  const context = programmeContext('evt-r3a');
  await harness.service.applyProgrammeContext({
    at: AT,
    sourceId: 'src-evt-r3a',
    organisation: context.organisation,
    anchorEvent: context.anchorEvent,
    places: context.places,
    ruleSets: context.ruleSets,
  });

  await harness.service.intakeImportDraft({
    importDraft: {
      id: 'import-r3a',
      anchorEventId: 'evt-r3a',
      channel: 'BULK_IMPORT',
      sourceId: 'src-evt-r3a',
      receivedAt: AT,
      travellers: [
        {
          draftId: 'draft-managed',
          displayName: 'Managed Traveller',
          identity: {},
          nationalityCodes: ['SG'],
          accessibilityStatements: [],
          notes: ['Keynote speaker · Example Corp'],
          anchorCommitmentIds: ['cmt-evt-r3a-opening'],
          travelArrangement: 'NORTHSTAR_ARRANGED',
          declaredTravel: [
            {
              itemKind: 'TRANSPORT_LEG',
              mode: 'FLIGHT',
              originRef: { system: 'airport-code', value: 'AAA' },
              destinationRef: { system: 'airport-code', value: 'SYN' },
              scheduledDeparture: '2026-09-29T18:00:00+08:00',
              scheduledArrival: '2026-09-30T07:25:00+08:00',
              flexibility: 'CHANGEABLE',
              reservationState: 'CONFIRMED',
            },
          ],
          engagementImportance: [
            {
              commitmentId: 'cmt-evt-r3a-opening',
              role: 'SPEAKER',
              importance: 'REQUIRED',
              flexibility: 'FIXED',
            },
          ],
        },
        {
          draftId: 'draft-local',
          displayName: 'Local Traveller',
          identity: {},
          nationalityCodes: ['SG'],
          accessibilityStatements: [],
          notes: [],
          anchorCommitmentIds: ['cmt-evt-r3a-opening'],
          travelArrangement: 'SELF_OR_OTHER_ARRANGED',
        },
      ],
      unresolvedStatements: [],
    },
    at: AT,
  });

  const view = await projectProgrammeView(harness.readDeps, 'evt-r3a', AT);
  assert.ok(view);
  const augment = await projectProgrammeAugmentations(harness.readDeps, view);

  const managed = view.travellers.find((row) => row.travellerName === 'Managed Traveller');
  const local = view.travellers.find((row) => row.travellerName === 'Local Traveller');
  assert.ok(managed && local);

  assert.equal(augment.roleFor?.(managed), 'Keynote speaker · Example Corp');
  assert.match(augment.arrivalFor?.(managed) ?? '', /30 Sep · 07:25 · SYN/);
  assert.equal(augment.arrivalFor?.(local), 'Local');
  assert.equal(augment.roleFor?.(local), undefined);

  assert.ok(augment.timeline?.[0]?.dateLabel.match(/^\w{3} 30 Sep$/));
  assert.equal(augment.timeline?.[0]?.items[0]?.tag, 'Synthetic Venue');
});

test('r3a: sparse traveller keeps role and arrival absent', async () => {
  const harness = createHarness();
  const context = programmeContext('evt-sparse');
  await harness.service.applyProgrammeContext({
    at: AT,
    sourceId: 'src-evt-sparse',
    organisation: context.organisation,
    anchorEvent: context.anchorEvent,
    places: context.places,
    ruleSets: context.ruleSets,
  });

  await harness.service.intakeImportDraft({
    importDraft: {
      id: 'import-sparse',
      anchorEventId: 'evt-sparse',
      channel: 'MANUAL_ENTRY',
      sourceId: 'src-evt-sparse',
      receivedAt: AT,
      travellers: [
        {
          draftId: 'draft-sparse',
          displayName: 'Sparse Traveller',
          identity: {},
          nationalityCodes: [],
          accessibilityStatements: [],
          notes: [],
          anchorCommitmentIds: ['cmt-evt-sparse-opening'],
          travelArrangement: 'NORTHSTAR_ARRANGED',
        },
      ],
      unresolvedStatements: [],
    },
    at: AT,
  });

  const view = await projectProgrammeView(harness.readDeps, 'evt-sparse', AT);
  assert.ok(view);
  const augment = await projectProgrammeAugmentations(harness.readDeps, view);
  const row = view.travellers[0]!;
  assert.equal(augment.roleFor?.(row), undefined);
  assert.equal(augment.arrivalFor?.(row), undefined);
});

test('r3a: operator dashboard augmentations reuse the same role projection', async () => {
  const harness = createHarness();
  const context = programmeContext('evt-op');
  await harness.service.applyProgrammeContext({
    at: AT,
    sourceId: 'src-evt-op',
    organisation: context.organisation,
    anchorEvent: context.anchorEvent,
    places: context.places,
    ruleSets: context.ruleSets,
  });
  await harness.service.intakeImportDraft({
    importDraft: {
      id: 'import-op',
      anchorEventId: 'evt-op',
      channel: 'BULK_IMPORT',
      sourceId: 'src-evt-op',
      receivedAt: AT,
      travellers: [
        {
          draftId: 'draft-op',
          displayName: 'Operator Row',
          identity: {},
          nationalityCodes: ['SG'],
          accessibilityStatements: [],
          notes: ['Panel host'],
          anchorCommitmentIds: ['cmt-evt-op-opening'],
        },
      ],
      unresolvedStatements: [],
    },
    at: AT,
  });

  const dashboard = await projectOperatorDashboard(harness.readDeps, AT, { anchorEventId: 'evt-op' });
  const augment = await projectOperatorDashboardAugmentations(harness.readDeps, dashboard);
  const trip = dashboard.trips[0]!;
  assert.equal(augment.roleFor?.(trip), 'Panel host');
  assert.ok(augment.chainFor?.(trip)?.length);
  assert.equal(augment.programmeHref, '/programme?event=evt-op');
});

test('r3a: traveller presentation projects itinerary and progress generically', async () => {
  const harness = createHarness();
  const context = programmeContext('evt-trv');
  await harness.service.applyProgrammeContext({
    at: AT,
    sourceId: 'src-evt-trv',
    organisation: context.organisation,
    anchorEvent: context.anchorEvent,
    places: context.places,
    ruleSets: context.ruleSets,
  });
  const intake = await harness.service.intakeImportDraft({
    importDraft: {
      id: 'import-trv',
      anchorEventId: 'evt-trv',
      channel: 'BULK_IMPORT',
      sourceId: 'src-evt-trv',
      receivedAt: AT,
      travellers: [
        {
          draftId: 'draft-trv',
          displayName: 'Traveller One',
          identity: {},
          nationalityCodes: ['SG'],
          accessibilityStatements: [],
          notes: [],
          anchorCommitmentIds: ['cmt-evt-trv-opening'],
          declaredTravel: [
            {
              itemKind: 'TRANSPORT_LEG',
              mode: 'FLIGHT',
              originRef: { system: 'airport-code', value: 'AAA' },
              destinationRef: { system: 'airport-code', value: 'SYN' },
              scheduledDeparture: '2026-09-29T18:00:00+08:00',
              scheduledArrival: '2026-09-30T07:25:00+08:00',
              flexibility: 'CHANGEABLE',
              reservationState: 'CONFIRMED',
            },
          ],
        },
      ],
      unresolvedStatements: [],
    },
    at: AT,
  });

  const trip = await harness.trips.getTrip(intake.outcomes[0]!.tripId!);
  assert.ok(trip);

  const recoveryCase: RecoveryCase = {
    id: 'case-trv',
    tripId: trip.id,
    caseKind: 'RECOVERY',
    status: 'EXECUTING',
    version: 1,
    openedAt: AT,
    updatedAt: AT,
    triggeredBySignalIds: [],
    affectedElementIds: [trip.elements.find((element) => element.elementKind === 'TRANSPORT_LEG')!.id],
    failedConstraintIds: [],
    strategies: [],
    actionIntents: [
      {
        id: 'intent-1',
        caseId: 'case-trv',
        strategyId: 'strategy-1',
        operation: 'flight.search',
        capability: 'FLIGHT',
        parameters: {},
        sideEffectLevel: 'READ_ONLY',
        evidenceRefs: [],
        status: 'EXECUTING',
        createdAt: AT,
      },
    ],
    authorityDecisions: [],
    executionResults: [],
  };

  const presentation = await projectTravellerPresentation(
    { entities: harness.entities, verdictFor: () => undefined },
    trip,
    recoveryCase,
    'Make the opening session',
  );
  assert.ok(presentation);
  assert.equal(presentation!.eventName, 'Event evt-trv');
  assert.ok(presentation!.itinerary?.some((row) => row.title.includes('AAA')));
  assert.ok(presentation!.progress?.some((row) => row.state === 'doing'));
  assert.equal(presentation!.commitmentCard?.ifMissed, 'Make the opening session');
});

test('r3a: alternate event uses the same projection without hero branching', async () => {
  const harness = createHarness();
  for (const eventId of ['evt-alpha', 'evt-beta']) {
    const context = programmeContext(eventId);
    await harness.service.applyProgrammeContext({
      at: AT,
      sourceId: `src-${eventId}`,
      organisation: context.organisation,
      anchorEvent: context.anchorEvent,
      places: context.places,
      ruleSets: context.ruleSets,
    });
    await harness.service.intakeImportDraft({
      importDraft: {
        id: `import-${eventId}`,
        anchorEventId: eventId,
        channel: 'BULK_IMPORT',
        sourceId: `src-${eventId}`,
        receivedAt: AT,
        travellers: [
          {
            draftId: `draft-${eventId}`,
            displayName: `Person ${eventId}`,
            identity: {},
            nationalityCodes: ['SG'],
            accessibilityStatements: [],
            notes: [`Role for ${eventId}`],
            anchorCommitmentIds: [`cmt-${eventId}-opening`],
            travelArrangement: 'SELF_OR_OTHER_ARRANGED',
          },
        ],
        unresolvedStatements: [],
      },
      at: AT,
    });
    const view = await projectProgrammeView(harness.readDeps, eventId, AT);
    const augment = await projectProgrammeAugmentations(harness.readDeps, view!);
    assert.equal(augment.roleFor?.(view!.travellers[0]!), `Role for ${eventId}`);
    assert.equal(augment.arrivalFor?.(view!.travellers[0]!), 'Local');
  }
});

/**
 * Wave 3R — alternate-data generalization proof (T-GEN).
 *
 * Two materially different synthetic datasets (distinct event/traveller ids,
 * airports, timezones, funding windows, and spend thresholds) exercise the
 * SAME deterministic funding + changeRequest paths without scenario-pack
 * imports or S1–S8 business switches.
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
import { resolveChangeRequest } from '../src/app/changeRequest.ts';
import {
  allocateCost,
  describeAllocation,
  payerDecisionFor,
} from '../src/engine/funding.ts';
import type { ChangeRequest } from '../src/contracts/changeRequest.ts';
import type { ProgrammeImportDraft } from '../src/contracts/programmeIntake.ts';
import type { AnchorEvent, Organisation, Place } from '../src/domain/entities.ts';
import type { Payer, PolicyRule, RuleSet } from '../src/domain/rules.ts';

const AT = '2026-09-01T00:00:00+00:00';

interface FundingDataset {
  label: string;
  eventId: string;
  travellerId: string;
  airportCode: string;
  timezone: string;
  currency: string;
  windowStart: string;
  windowEnd: string;
  coveredAnchor: string;
  extensionAnchor: string;
  spendThreshold: number;
  coveredBy: Payer;
  arriveBy: string;
  rules: PolicyRule[];
}

function fundedWindowRule(
  id: string,
  windowStart: string,
  windowEnd: string,
  coveredBy: Payer,
  incrementalPayer: Payer,
): PolicyRule {
  return {
    id,
    sourceId: `src-${id}`,
    kind: 'FUNDED_WINDOW',
    appliesTo: [],
    windowStart,
    windowEnd,
    coveredBy,
    incrementalPayer,
  };
}

const DATASET_ALPHA: FundingDataset = {
  label: 'alpha-corridor',
  eventId: 'evt-gen-alpha',
  travellerId: 'trv-gen-alpha',
  airportCode: 'ORD',
  timezone: 'America/Chicago',
  currency: 'USD',
  windowStart: '2026-10-01T00:00:00-05:00',
  windowEnd: '2026-10-05T23:59:00-05:00',
  coveredAnchor: '2026-10-02T14:00:00-05:00',
  extensionAnchor: '2026-10-09T10:00:00-05:00',
  spendThreshold: 450,
  coveredBy: 'EVENT_ORGANISATION',
  arriveBy: '2026-10-02T08:00:00-05:00',
  rules: [],
};
DATASET_ALPHA.rules = [
  fundedWindowRule(
    'rule-alpha-covered',
    DATASET_ALPHA.windowStart,
    DATASET_ALPHA.windowEnd,
    DATASET_ALPHA.coveredBy,
    'TRAVELLER',
  ),
];

const DATASET_BETA: FundingDataset = {
  label: 'beta-corridor',
  eventId: 'evt-gen-beta',
  travellerId: 'trv-gen-beta',
  airportCode: 'CDG',
  timezone: 'Europe/Paris',
  currency: 'EUR',
  windowStart: '2026-11-01T00:00:00+01:00',
  windowEnd: '2026-11-06T23:59:00+01:00',
  coveredAnchor: '2026-11-03T09:30:00+01:00',
  extensionAnchor: '2026-11-12T18:00:00+01:00',
  spendThreshold: 820,
  coveredBy: 'ORGANISATION',
  arriveBy: '2026-11-03T07:00:00+01:00',
  rules: [],
};
DATASET_BETA.rules = [
  fundedWindowRule(
    'rule-beta-covered',
    DATASET_BETA.windowStart,
    DATASET_BETA.windowEnd,
    DATASET_BETA.coveredBy,
    'TRAVELLER',
  ),
];

function assertFundingCoherence(dataset: FundingDataset): void {
  const coveredDecision = payerDecisionFor(dataset.rules, dataset.coveredAnchor);
  assert.ok(coveredDecision, `${dataset.label}: covered anchor should decide`);
  assert.equal(coveredDecision!.kind, 'COVERED');
  assert.equal(coveredDecision!.payer, dataset.coveredBy);

  const extensionDecision = payerDecisionFor(dataset.rules, dataset.extensionAnchor);
  assert.ok(extensionDecision, `${dataset.label}: extension anchor should decide`);
  assert.equal(extensionDecision!.kind, 'INCREMENTAL');
  assert.equal(extensionDecision!.payer, 'TRAVELLER');

  const coveredAllocation = allocateCost({
    rules: dataset.rules,
    priceDelta: { amount: dataset.spendThreshold, currency: dataset.currency },
    costAccruesAt: dataset.coveredAnchor,
  });
  assert.ok(coveredAllocation);
  assert.equal(coveredAllocation!.coveredAmount?.amount, dataset.spendThreshold);
  assert.equal(coveredAllocation!.coveredAmount?.currency, dataset.currency);
  assert.ok(describeAllocation(coveredAllocation).includes(String(dataset.spendThreshold)));

  const extensionAllocation = allocateCost({
    rules: dataset.rules,
    priceDelta: { amount: dataset.spendThreshold + 50, currency: dataset.currency },
    costAccruesAt: dataset.extensionAnchor,
  });
  assert.ok(extensionAllocation);
  assert.equal(extensionAllocation!.incrementalPayer, 'TRAVELLER');
  assert.equal(extensionAllocation!.incrementalAmount?.amount, dataset.spendThreshold + 50);
}

test('wave3r-generalization: payerDecisionFor + allocateCost stay coherent across alternate datasets', () => {
  assertFundingCoherence(DATASET_ALPHA);
  assertFundingCoherence(DATASET_BETA);
  assert.notEqual(DATASET_ALPHA.eventId, DATASET_BETA.eventId);
  assert.notEqual(DATASET_ALPHA.airportCode, DATASET_BETA.airportCode);
  assert.notEqual(DATASET_ALPHA.spendThreshold, DATASET_BETA.spendThreshold);
  assert.notEqual(DATASET_ALPHA.coveredBy, DATASET_BETA.coveredBy);
});

interface Harness {
  service: ProgrammeService;
  trips: SqliteTripRepository;
  entities: SqliteEntityStore;
  signals: SqliteSignalRepository;
  cases: SqliteCaseRepository;
  audit: SqliteAuditRepository;
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
  return { service, trips, entities, signals, cases, audit };
}

function buildProgramme(dataset: FundingDataset) {
  const { eventId, travellerId, airportCode, timezone, windowStart, windowEnd, coveredAnchor, rules } =
    dataset;
  const organisation: Organisation = {
    id: `org-${eventId}`,
    name: 'Synthetic Organiser',
    roles: ['EVENT_ORGANISER', 'PAYER'],
  };
  const venueId = `plc-${eventId}-venue`;
  const airportId = `plc-${eventId}-airport`;
  const venue: Place = {
    id: venueId,
    name: 'Synthetic Venue',
    kind: 'VENUE',
    timezone,
    externalRefs: [],
  };
  const airport: Place = {
    id: airportId,
    name: 'Synthetic Airport',
    kind: 'AIRPORT',
    timezone,
    externalRefs: [{ system: 'airport-code', value: airportCode }],
  };
  const anchorEvent: AnchorEvent = {
    id: eventId,
    name: 'Synthetic Event',
    kind: 'CONFERENCE',
    placeId: venueId,
    window: { startsAt: windowStart, endsAt: windowEnd },
    organiserOrganisationId: organisation.id,
    commitments: [
      {
        id: `cmt-${eventId}-opening`,
        anchorEventId: eventId,
        title: 'Opening',
        kind: 'SESSION',
        placeId: venueId,
        startsAt: {
          value: coveredAnchor,
          sourceId: `src-${eventId}`,
          authority: 'AUTHORITATIVE',
          observedAt: AT,
        },
        sourceId: `src-${eventId}`,
      },
    ],
    sourceIds: [],
  };
  const ruleSets: RuleSet[] = [
    {
      id: `rs-${eventId}-funding`,
      kind: 'EVENT',
      name: 'Funding',
      ownerOrganisationId: organisation.id,
      sourceId: `src-${eventId}`,
      rules,
    },
  ];
  const importDraft: ProgrammeImportDraft = {
    id: `import-${eventId}`,
    anchorEventId: eventId,
    channel: 'MANUAL_ENTRY',
    sourceId: `src-${eventId}-intake`,
    receivedAt: AT,
    travellers: [
      {
        draftId: `draft-${travellerId}`,
        displayName: 'Synthetic Traveller',
        identity: {},
        nationalityCodes: [],
        accessibilityStatements: [],
        notes: [],
        homeLocationText: `${airportCode} corridor`,
        anchorCommitmentIds: [`cmt-${eventId}-opening`],
        engagementImportance: [
          {
            commitmentId: `cmt-${eventId}-opening`,
            importance: 'REQUIRED',
            flexibility: 'CHANGEABLE',
          },
        ],
      },
    ],
    unresolvedStatements: [],
  };
  return { organisation, anchorEvent, places: [venue, airport], ruleSets, importDraft, travellerId };
}

async function seedAndResolveWindowShift(
  harness: Harness,
  dataset: FundingDataset,
): Promise<{ tripId: string; implications: string[] }> {
  const programme = buildProgramme(dataset);
  const context = await harness.service.applyProgrammeContext({
    at: AT,
    sourceId: `src-${dataset.eventId}`,
    organisation: programme.organisation,
    anchorEvent: programme.anchorEvent,
    places: programme.places,
    ruleSets: programme.ruleSets,
  });
  assert.equal(context.accepted, true, `programme context rejected for ${dataset.eventId}`);

  const intake = await harness.service.intakeImportDraft({
    at: AT,
    importDraft: programme.importDraft,
  });
  assert.equal(intake.accepted, true, `intake rejected for ${dataset.eventId}`);
  assert.equal(intake.outcomes.length, 1);
  assert.equal(intake.outcomes[0]!.promoted, true);
  const tripId = intake.outcomes[0]!.tripId!;
  assert.ok(tripId);

  const request: ChangeRequest = {
    id: `cr-${dataset.eventId}`,
    tripId,
    travellerId: programme.travellerId,
    sourceId: `src-${dataset.eventId}-cr`,
    authority: 'ASSERTED',
    issuedAt: AT,
    intentKind: 'ADJUST_TRIP_WINDOW',
    urgency: 'HARD_INSTRUCTION',
    fundingDeclaration: 'TRAVELLER_FUNDED',
    target: { arriveBy: dataset.arriveBy, objectiveEffects: [] },
  };

  const outcome = await resolveChangeRequest(
    {
      trips: harness.trips,
      entities: harness.entities,
      signals: harness.signals,
      cases: harness.cases,
      audit: harness.audit,
    },
    { request, at: AT },
  );
  assert.equal(
    outcome.accepted,
    true,
    `change request rejected for ${dataset.eventId}: ${outcome.issues.join('; ')}`,
  );
  assert.ok(
    outcome.implications.some((line) => line.includes(`arriveBy ${dataset.arriveBy}`)) ||
      outcome.uncertainties.some((u) => /arriveBy requested/.test(u.statement)),
  );
  assert.ok(outcome.implications.some((line) => /funding payer decision/.test(line)));
  return { tripId, implications: outcome.implications };
}

test('wave3r-generalization: resolveChangeRequest derives implications for two alternate programmes', async () => {
  const harness = createHarness();

  const alpha = await seedAndResolveWindowShift(harness, DATASET_ALPHA);
  const beta = await seedAndResolveWindowShift(harness, DATASET_BETA);

  assert.notEqual(alpha.tripId, beta.tripId);
  assert.notEqual(alpha.implications.join('|'), beta.implications.join('|'));
  assert.ok(alpha.implications.some((line) => line.includes('rule-alpha-covered')));
  assert.ok(alpha.implications.some((line) => line.includes('EVENT_ORGANISATION')));
  assert.ok(beta.implications.some((line) => line.includes('rule-beta-covered')));
  assert.ok(beta.implications.some((line) => /incremental payer ORGANISATION|covered by ORGANISATION/.test(line)));
});

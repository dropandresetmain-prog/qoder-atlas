/**
 * REV-2 WP-R5 — determinism and allocation correctness.
 *
 * Failing-first regression suite for three Review 2 findings:
 *
 * 1. Funding: allocateCost returned on the first FUNDED_WINDOW rule that
 *    could DECIDE rather than the first whose window actually CONTAINS the
 *    cost anchor, so with multiple windows the payer depended on array order
 *    (and changeRequest feeds rules in alphabetical rule-set-id order). The
 *    payer must be stable under rule reordering: the first rule whose window
 *    CONTAINS the anchor governs; costs outside every window fall to the
 *    incremental payer per the documented input-order contract.
 *
 * 2. Planner determinism: the composed NorthstarPlanner was constructed with
 *    no overrides, so production strategy ids were Math.random() and
 *    createdAt was wall-clock — contradicting ADR-029 ("never
 *    wall-clock-stamped") and breaking REPLAY reproducibility. Strategy ids
 *    and createdAt must be deterministic; createdAt derives from the
 *    snapshot instant (the evaluation 'at'), never from the wall clock.
 *
 * 3. Timezone resolver: buildTimezoneResolver indexed EVERY externalRef
 *    value, so a city_code / venue ref colliding with an airport code
 *    silently yielded a wrong offset instead of ADR-028's structured
 *    fail-closed. Only refs whose system is 'airport-code' may resolve.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { resolve } from 'node:path';

import { openDatabase } from '../src/persistence/database.ts';
import {
  SqliteAuditRepository,
  SqliteSourceRepository,
  SqliteTripRepository,
} from '../src/persistence/repositories.ts';
import { SqliteEntityStore } from '../src/persistence/entityStore.ts';
import { SqlMutationService } from '../src/engine/mutation.ts';
import { SqlitePreferenceStore } from '../src/app/preferenceStore.ts';
import { ProgrammeService } from '../src/app/programme.ts';
import { buildTripSnapshot } from '../src/app/snapshot.ts';
import { buildTimezoneResolver } from '../src/app/planningLoop.ts';
import { composeAppRuntime } from '../src/app/compose.ts';
import { AppConfigSchema } from '../src/config/config.ts';
import { allocateCost } from '../src/engine/funding.ts';
import { ImpactAssessmentSchema } from '../src/operational/impact.ts';
import type { Payer, PolicyRule } from '../src/domain/rules.ts';
import type { AnchorEvent, Organisation, Place } from '../src/domain/entities.ts';
import type { TransportLeg } from '../src/domain/elements.ts';
import type { ProgrammeImportDraft } from '../src/contracts/programmeIntake.ts';
import type { FlightOffer } from '../src/contracts/capabilities.ts';
import type { PlannerInput } from '../src/contracts/planner.ts';
import type { TripSignal } from '../src/operational/signal.ts';

const AT = '2026-09-01T00:00:00+00:00';

// ---------------------------------------------------------------------------
// 1. Funding — payer stable under rule reordering
// ---------------------------------------------------------------------------

const windowRule = (
  id: string,
  windowStart: string,
  windowEnd: string,
  coveredBy: Payer,
  incrementalPayer: Payer,
): PolicyRule =>
  ({
    id,
    sourceId: 'src-funding',
    kind: 'FUNDED_WINDOW',
    windowStart,
    windowEnd,
    coveredBy,
    incrementalPayer,
  }) as PolicyRule;

test('rev2-r5: funding payer is stable under rule reordering (containing window governs)', () => {
  // ruleA's window CONTAINS the anchor; ruleB's window does not.
  const ruleA = windowRule('rule-window-a', '2026-10-01T00:00:00+08:00', '2026-10-04T23:59:00+08:00', 'EVENT_ORGANISATION', 'TRAVELLER');
  const ruleB = windowRule('rule-window-b', '2026-12-01T00:00:00+08:00', '2026-12-05T23:59:00+08:00', 'ORGANISATION', 'TRAVELLER');
  const anchored = { amount: 100, currency: 'SGD' };
  const anchor = '2026-10-02T12:00:00+08:00';

  const forward = allocateCost({ rules: [ruleA, ruleB], priceDelta: anchored, costAccruesAt: anchor });
  const reversed = allocateCost({ rules: [ruleB, ruleA], priceDelta: anchored, costAccruesAt: anchor });

  for (const [label, allocation] of [['forward', forward], ['reversed', reversed]] as const) {
    assert.ok(allocation, `${label}: allocation resolves`);
    assert.equal(allocation!.coveredBy, 'EVENT_ORGANISATION', `${label}: the window CONTAINING the anchor governs, not the first decidable rule`);
    assert.equal(allocation!.incrementalPayer, undefined, `${label}: not an incremental outcome`);
    assert.deepEqual(allocation!.derivedFromRuleIds, ['rule-window-a'], `${label}: evidence names the containing rule`);
  }

  // Outside every window: the cost falls to the incremental payer of the
  // first governing rule in INPUT order (the documented contract).
  const outside = allocateCost({ rules: [ruleB, ruleA], priceDelta: anchored, costAccruesAt: '2026-11-01T12:00:00+08:00' });
  assert.ok(outside);
  assert.equal(outside!.incrementalPayer, 'TRAVELLER');
  assert.deepEqual(outside!.derivedFromRuleIds, ['rule-window-b']);

  // No anchor, no rules: allocation stays UNKNOWN.
  assert.equal(allocateCost({ rules: [ruleA], priceDelta: anchored }), undefined);
  assert.equal(allocateCost({ rules: [], priceDelta: anchored, costAccruesAt: anchor }), undefined);
});

// ---------------------------------------------------------------------------
// 2. Planner determinism — composed-style planner (no overrides)
// ---------------------------------------------------------------------------

interface Harness {
  service: ProgrammeService;
  trips: SqliteTripRepository;
  entities: SqliteEntityStore;
  mutations: SqlMutationService;
  snapshotDeps: {
    trips: SqliteTripRepository;
    entities: SqliteEntityStore;
    preferences: SqlitePreferenceStore;
    sources: SqliteSourceRepository;
  };
}

function createHarness(): Harness {
  const db = openDatabase(':memory:');
  const trips = new SqliteTripRepository(db);
  const entities = new SqliteEntityStore(db);
  const sources = new SqliteSourceRepository(db);
  const audit = new SqliteAuditRepository(db);
  const preferences = new SqlitePreferenceStore(db);
  const mutations = new SqlMutationService({ db, trips, entities });
  const service = new ProgrammeService({ mutations, entities, trips, sources, audit });
  return { service, trips, entities, mutations, snapshotDeps: { trips, entities, preferences, sources } };
}

const HOME_PLACE = 'plc-evt-r5-home';
const EVENT_PLACE = 'plc-evt-r5-airport';
const SNAPSHOT_AT = '2026-09-05T11:00:00+00:00';

async function setupBookedTrip(harness: Harness): Promise<{ tripId: string }> {
  const eventId = 'evt-r5';
  const organisation: Organisation = { id: `org-${eventId}`, name: 'Synthetic Programme Organiser', roles: ['EVENT_ORGANISER', 'PAYER'] };
  const home: Place = {
    id: HOME_PLACE,
    name: 'Synthetic Home Airport',
    kind: 'AIRPORT',
    timezone: 'UTC',
    externalRefs: [{ system: 'airport-code', value: 'HOM' }],
  };
  const event: Place = {
    id: EVENT_PLACE,
    name: 'Synthetic Event Airport',
    kind: 'AIRPORT',
    timezone: 'Asia/Singapore',
    externalRefs: [{ system: 'airport-code', value: 'EVT' }],
  };
  const anchorEvent: AnchorEvent = {
    id: eventId,
    name: 'Synthetic Programme Event',
    kind: 'CONFERENCE',
    placeId: EVENT_PLACE,
    window: { startsAt: '2026-09-07T00:00:00+08:00', endsAt: '2026-09-11T23:59:00+08:00' },
    organiserOrganisationId: organisation.id,
    commitments: [
      {
        id: `cmt-${eventId}-opening`,
        anchorEventId: eventId,
        title: 'Opening Session',
        kind: 'SESSION',
        placeId: EVENT_PLACE,
        startsAt: { value: '2026-09-08T15:00:00+08:00', sourceId: `src-${eventId}`, authority: 'AUTHORITATIVE', observedAt: AT },
        sourceId: `src-${eventId}`,
      },
    ],
    sourceIds: [],
  };
  await harness.service.applyProgrammeContext({
    at: AT,
    sourceId: `src-${eventId}`,
    organisation,
    anchorEvent,
    places: [home, event],
    ruleSets: [],
  });
  const draft: ProgrammeImportDraft = {
    id: `import-${eventId}`,
    anchorEventId: eventId,
    channel: 'BULK_IMPORT',
    sourceId: `src-${eventId}`,
    receivedAt: AT,
    travellers: [
      {
        draftId: 'draft-1',
        displayName: 'Traveller 01',
        identity: { email: 't1@example.test' },
        homeLocationText: 'HOM',
        nationalityCodes: ['SG'],
        accessibilityStatements: [],
        notes: [],
        anchorCommitmentIds: [`cmt-${eventId}-opening`],
      },
    ],
    unresolvedStatements: [],
  };
  const intake = await harness.service.intakeImportDraft({ importDraft: draft, at: AT });
  const tripId = intake.outcomes[0]!.tripId!;

  const fact = (value: string) => ({ value, sourceId: `src-${eventId}`, authority: 'AUTHORITATIVE' as const, observedAt: AT });
  const outbound: TransportLeg = {
    id: `el-${tripId}-out`,
    tripId,
    elementKind: 'TRANSPORT_LEG',
    importance: 'REQUIRED',
    flexibility: 'CHANGEABLE',
    reservationState: 'CONFIRMED',
    status: 'VALID',
    dependsOn: [],
    governedByRuleSetIds: [],
    data: {
      mode: 'FLIGHT',
      originPlaceId: EVENT_PLACE,
      destinationPlaceId: HOME_PLACE,
      scheduledDeparture: fact('2026-09-11T18:00:00+08:00'),
      scheduledArrival: fact('2026-09-11T23:30:00+08:00'),
      bookingRef: { system: 'flight-provider', reference: 'BOOKED-RET' },
    },
  };
  const trip = (await harness.trips.getTrip(tripId))!;
  await harness.mutations.applyProposal({
    id: 'prop-book-r5',
    origin: 'SYSTEM',
    sourceId: `src-${eventId}`,
    requestedAt: AT,
    rationale: 'book synthetic return leg for the determinism regression suite',
    operations: [{ op: 'UPSERT_ENTITY', entityType: 'TRIP', id: tripId, data: { ...trip, elements: [...trip.elements, outbound] } }],
  });
  return { tripId };
}

const replacementOffer: FlightOffer = {
  offerId: 'offer-r5-later',
  segments: [
    {
      origin: { system: 'airport-code', value: 'EVT' },
      destination: { system: 'airport-code', value: 'HOM' },
      departure: '2026-09-12T18:00:00+08:00',
      arrival: '2026-09-12T23:30:00+08:00',
    },
  ],
  totalPrice: { amount: 250, currency: 'SGD' },
  availability: 'AVAILABLE',
};

test('rev2-r5: the COMPOSED runtime planner is deterministic — no Math.random ids, no wall-clock createdAt', async () => {
  const harness = createHarness();
  const { tripId } = await setupBookedTrip(harness);
  const snapshot = await buildTripSnapshot(harness.snapshotDeps, tripId, SNAPSHOT_AT);
  assert.equal(snapshot.takenAt, SNAPSHOT_AT);

  const signal: TripSignal = {
    id: 'sig-r5',
    kind: 'TRAVELLER_INPUT',
    occurredAt: '2026-09-05T10:00:00+00:00',
    receivedAt: '2026-09-05T10:00:00+00:00',
    sourceId: 'src-traveller-web',
    authority: 'ASSERTED',
    tripId,
    summary: 'ChangeRequest cr-r5',
    payload: { changeRequestId: 'cr-r5', intentKind: 'ADJUST_TRIP_WINDOW', target: { departAfter: '2026-09-12T00:00:00+08:00' } },
  };
  const input: PlannerInput = {
    caseId: 'case-r5',
    snapshot,
    triggeringSignals: [signal],
    impact: ImpactAssessmentSchema.parse({ id: 'imp-r5', tripId, assessedAt: AT, severity: 'MEDIUM' }),
    capabilityRegistry: [],
    priorToolResults: [{ toolRequestId: 'tool-1', summary: 'flight.search evidence', data: { offers: [replacementOffer] } }],
    priorActionResults: [],
  };

  // The EXACT planner the composed application constructs (credential-free
  // REPLAY boot). Pre-fix compose wired NorthstarPlanner with no overrides,
  // so production ids were Math.random() and createdAt was wall-clock;
  // tests injecting idFactory/now hid the defect. Two freshly composed
  // runtimes must emit IDENTICAL strategy ids/timestamps for the same
  // input — that is the REPLAY-reproducibility property.
  const config = AppConfigSchema.parse({
    environment: 'local',
    adapterMode: 'REPLAY',
    sqlitePath: ':memory:',
    fixturesDir: resolve('fixtures'),
    providers: { atlas: {}, modelStudio: {}, googleRoutes: {}, duffelStays: {} },
  });
  const firstRuntime = await composeAppRuntime(config);
  const secondRuntime = await composeAppRuntime(config);
  try {
    const first = await firstRuntime.planner.plan(input);
    const second = await secondRuntime.planner.plan(input);

    assert.ok(first.strategies.length >= 1, 'evidence yields replacement strategies');
    assert.deepEqual(
      first.strategies.map((strategy) => strategy.id),
      second.strategies.map((strategy) => strategy.id),
      'strategy ids are deterministic across composed runtimes (no Math.random)',
    );
    for (const strategy of [...first.strategies, ...second.strategies]) {
      assert.equal(
        strategy.createdAt,
        SNAPSHOT_AT,
        'createdAt derives from the snapshot instant (ADR-029), never the wall clock',
      );
    }
  } finally {
    firstRuntime.db.close();
    secondRuntime.db.close();
  }
});

// ---------------------------------------------------------------------------
// 3. Timezone resolver — airport-code refs only (ADR-028)
// ---------------------------------------------------------------------------

test('rev2-r5: timezone resolver only honours airport-code refs; colliding city refs fail closed', async () => {
  const harness = createHarness();
  await harness.entities.upsert({
    entityType: 'PLACE',
    entity: {
      id: 'plc-tz-home',
      name: 'Synthetic Home Airport',
      kind: 'AIRPORT',
      timezone: 'UTC',
      externalRefs: [{ system: 'airport-code', value: 'HOM' }],
    },
  });
  // A VENUE whose city_code ref COLLIDES with the home airport code and
  // carries a different zone. Pre-fix it silently overwrote HOM's offset.
  await harness.entities.upsert({
    entityType: 'PLACE',
    entity: {
      id: 'plc-tz-venue',
      name: 'Synthetic Venue',
      kind: 'VENUE',
      timezone: 'Asia/Singapore',
      externalRefs: [{ system: 'city_code', value: 'HOM' }],
    },
  });

  const resolve = await buildTimezoneResolver(harness.entities)();
  assert.equal(resolve('HOM'), 'UTC', 'airport-code evidence wins; the colliding city_code ref must not resolve');
  assert.equal(resolve('hom'), 'UTC', 'lookup stays case-insensitive for airport codes');
  assert.equal(resolve('ZZZ'), undefined, 'unknown codes fail closed (ADR-028), never guessed');
});

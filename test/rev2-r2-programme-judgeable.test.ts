/**
 * REV-2 WP-R2 — programme trips must actually be judgeable.
 *
 * Failing-first regression suite for the Review 2 finding: promoted programme
 * trips carried zero constraints, no governing rule sets and all-SOFT
 * objectives, so deterministic viability was inert for every Case 0 / Case A
 * path (absurd candidates were feasible=true with zero constraint results).
 *
 * The fix (src/app/programme.ts promotion, validated MutationService path
 * only): per commitment-linked engagement a deterministic TEMPORAL HARD
 * constraint binds the shared arrival slot (el-<trip>-arrival) to the
 * commitment start; organiser-owned rule sets attach to the trip; objective
 * hardness and absent buffers/rule sets are RECORDED DECISIONS, never silent
 * constants. NorthstarPlanner arrival strategies fill exactly that slot so
 * the overlay can judge them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { openDatabase } from '../src/persistence/database.ts';
import { SqliteAuditRepository, SqliteSourceRepository, SqliteTripRepository } from '../src/persistence/repositories.ts';
import { SqliteEntityStore } from '../src/persistence/entityStore.ts';
import { SqlMutationService } from '../src/engine/mutation.ts';
import { SqlitePreferenceStore } from '../src/app/preferenceStore.ts';
import { ProgrammeService, intakeUncertainties } from '../src/app/programme.ts';
import { buildTripSnapshot } from '../src/app/snapshot.ts';
import { OverlayViabilityEngine } from '../src/engine/overlay.ts';
import { NorthstarPlanner } from '../src/intelligence/northstarPlanner.ts';
import { ImpactAssessmentSchema } from '../src/operational/impact.ts';
import type { ProgrammeImportDraft } from '../src/contracts/programmeIntake.ts';
import type { AnchorEvent, Organisation, Place } from '../src/domain/entities.ts';
import type { RuleSet } from '../src/domain/rules.ts';
import type { MutationOperation } from '../src/operational/mutation.ts';
import type { FlightOffer } from '../src/contracts/capabilities.ts';
import type { PlannerInput } from '../src/contracts/planner.ts';

const AT = '2026-09-01T00:00:00+00:00';

interface Harness {
  service: ProgrammeService;
  trips: SqliteTripRepository;
  entities: SqliteEntityStore;
  sources: SqliteSourceRepository;
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
  return { service, trips, entities, sources, mutations, snapshotDeps: { trips, entities, preferences, sources } };
}

/** Synthetic programme context; ids/data only, never real scenario content. */
function programmeContext(eventId: string, opts?: { ruleSets?: RuleSet[] }) {
  const organisation: Organisation = {
    id: `org-${eventId}`,
    name: 'Synthetic Programme Organiser',
    roles: ['EVENT_ORGANISER', 'PAYER'],
  };
  // The event place carries an airport-code ref so northstar initial planning
  // has authoritative destination evidence; the home airport is AIRPORT-kind
  // so intake's home linkage can resolve it.
  const destination: Place = {
    id: `plc-${eventId}-dest`,
    name: 'Synthetic Destination Venue',
    kind: 'VENUE',
    timezone: 'Asia/Singapore',
    externalRefs: [{ system: 'airport-code', value: 'DST' }],
  };
  const home: Place = {
    id: `plc-${eventId}-home`,
    name: 'Synthetic Home Airport',
    kind: 'AIRPORT',
    timezone: 'UTC',
    externalRefs: [{ system: 'airport-code', value: 'HOM' }],
  };
  const anchorEvent: AnchorEvent = {
    id: eventId,
    name: 'Synthetic Programme Event',
    kind: 'CONFERENCE',
    placeId: destination.id,
    window: { startsAt: '2026-09-07T00:00:00+08:00', endsAt: '2026-09-11T23:59:00+08:00' },
    organiserOrganisationId: organisation.id,
    commitments: [
      {
        id: `cmt-${eventId}-opening`,
        anchorEventId: eventId,
        title: 'Opening Session',
        kind: 'SESSION',
        placeId: destination.id,
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
  return {
    organisation,
    places: [destination, home],
    anchorEvent,
    ruleSets: opts?.ruleSets ?? [fundingRuleSet],
  };
}

function singleTravellerDraft(eventId: string, sourceId: string, opts?: { home?: boolean }): ProgrammeImportDraft {
  return {
    id: `import-${eventId}`,
    anchorEventId: eventId,
    channel: 'BULK_IMPORT',
    sourceId,
    receivedAt: AT,
    travellers: [
      {
        draftId: 'draft-1',
        displayName: 'Traveller 01',
        identity: { email: 't1@example.test' },
        ...(opts?.home ? { homeLocationText: 'HOM' } : {}),
        nationalityCodes: ['SG'],
        accessibilityStatements: [],
        notes: [],
        anchorCommitmentIds: [`cmt-${eventId}-opening`],
      },
    ],
    unresolvedStatements: [],
  };
}

async function promoteOne(
  harness: Harness,
  eventId: string,
  opts?: { ruleSets?: RuleSet[]; home?: boolean },
): Promise<{ tripId: string; engagementId: string }> {
  const context = programmeContext(eventId, opts);
  await harness.service.applyProgrammeContext({
    at: AT,
    sourceId: `src-${eventId}`,
    organisation: context.organisation,
    anchorEvent: context.anchorEvent,
    places: context.places,
    ruleSets: context.ruleSets,
  });
  const result = await harness.service.intakeImportDraft({
    importDraft: singleTravellerDraft(eventId, `src-${eventId}`, opts),
    at: AT,
  });
  const outcome = result.outcomes[0];
  assert.equal(outcome?.promoted, true, `promotion failed: ${outcome?.issues.join('; ')}`);
  const tripId = outcome!.tripId!;
  const trip = await harness.trips.getTrip(tripId);
  assert.ok(trip);
  const engagementId = trip!.elements.find((e) => e.elementKind === 'ENGAGEMENT')!.id;
  return { tripId, engagementId };
}

const fact = (value: string) => ({
  value,
  sourceId: 'src-rev2-r2',
  authority: 'CONNECTED' as const,
  observedAt: AT,
});

function legOperation(tripId: string, elementId: string, arrival: string, departure?: string): MutationOperation {
  return {
    op: 'UPSERT_ENTITY',
    entityType: 'TRIP_ELEMENT',
    data: {
      id: elementId,
      tripId,
      elementKind: 'TRANSPORT_LEG',
      importance: 'PREFERRED',
      flexibility: 'FIXED',
      reservationState: 'HELD',
      status: 'UNKNOWN',
      dependsOn: [],
      governedByRuleSetIds: [],
      data: {
        mode: 'FLIGHT',
        originPlaceId: 'plc-nowhere-a',
        destinationPlaceId: 'plc-nowhere-b',
        ...(departure ? { scheduledDeparture: fact(departure) } : {}),
        scheduledArrival: fact(arrival),
      },
    },
  };
}

test('rev2-r2: a promoted programme trip carries a HARD TEMPORAL arrival constraint on its own elements', async () => {
  const harness = createHarness();
  const { tripId, engagementId } = await promoteOne(harness, 'evt-c1');

  const trip = (await harness.trips.getTrip(tripId))!;
  const tripRefIds = new Set([...trip.elements.map((e) => e.id), ...trip.objectives.map((o) => o.id)]);
  const constraints = (await harness.entities.list('CONSTRAINT'))
    .filter((entry) => entry.entityType === 'CONSTRAINT')
    .map((entry) => entry.entity)
    .filter((constraint) => constraint.refs.some((ref) => tripRefIds.has(ref.id)));

  assert.ok(constraints.length >= 1, 'promoted trip must carry at least one constraint');
  const arrival = constraints.find(
    (constraint) =>
      constraint.kind === 'TEMPORAL' &&
      constraint.hardness === 'HARD' &&
      constraint.evaluator === 'DETERMINISTIC' &&
      constraint.refs.some((ref) => ref.entityType === 'TRIP_ELEMENT' && ref.id === engagementId),
  );
  assert.ok(arrival, 'expected a HARD TEMPORAL DETERMINISTIC constraint binding arrival evidence to the engagement');
  // Arrival evidence is bound through the shared, promotion-known slot.
  assert.ok(
    arrival!.refs.some((ref) => ref.entityType === 'TRIP_ELEMENT' && ref.id === `el-${tripId}-arrival`),
    'arrival constraint must reference the deterministic arrival slot of this trip',
  );
  // No buffer evidence exists in programme intake: absence is recorded, not
  // fabricated as a default parameter.
  assert.equal(arrival!.parameters?.minBufferMinutes, undefined);
});

test('rev2-r2: organiser-owned rule sets govern the promoted trip; foreign-owned rule sets do not', async () => {
  const harness = createHarness();
  const foreign: RuleSet = {
    id: 'rs-foreign',
    kind: 'ORGANISATION',
    name: 'some other organisation policy',
    ownerOrganisationId: 'org-elsewhere',
    sourceId: 'src-evt-c2',
    rules: [],
  };
  const context = programmeContext('evt-c2');
  await harness.service.applyProgrammeContext({
    at: AT,
    sourceId: 'src-evt-c2',
    organisation: context.organisation,
    anchorEvent: context.anchorEvent,
    places: context.places,
    ruleSets: [...context.ruleSets, foreign],
  });
  const result = await harness.service.intakeImportDraft({
    importDraft: singleTravellerDraft('evt-c2', 'src-evt-c2'),
    at: AT,
  });
  const tripId = result.outcomes[0]!.tripId!;

  const trip = (await harness.trips.getTrip(tripId))!;
  assert.ok(
    trip.governedByRuleSetIds.includes('rs-evt-c2-funding'),
    'organiser-owned rule set must govern the promoted trip',
  );
  assert.ok(!trip.governedByRuleSetIds.includes('rs-foreign'), 'foreign-owned rule set must not attach');

  const snapshot = await buildTripSnapshot(harness.snapshotDeps, tripId, AT);
  assert.ok(snapshot.ruleSets.some((ruleSet) => ruleSet.id === 'rs-evt-c2-funding'));
});

test('rev2-r2: the absurd candidate is infeasible with a named hard failure', async () => {
  const harness = createHarness();
  const { tripId, engagementId } = await promoteOne(harness, 'evt-c3');
  const snapshot = await buildTripSnapshot(harness.snapshotDeps, tripId, AT);

  // The Review 2 absurd probe: departs 2099, arrives 1999, places nowhere in
  // the trip. Before the fix this was feasible=true with zero constraint
  // results; now a named hard constraint must block it.
  const absurd = legOperation(tripId, `el-${tripId}-absurd`, '1999-01-01T00:00:00+00:00', '2099-01-01T00:00:00+00:00');
  const viability = new OverlayViabilityEngine();
  const result = await viability.evaluateOverlay({ baseSnapshot: snapshot, candidateOperations: [absurd] });

  assert.equal(result.feasible, false, 'absurd candidate must not be feasible');
  assert.ok(result.constraintResults.length >= 1, 'viability must actually evaluate constraints');
  const constraintId = `c-${tripId}-arrival-before-${engagementId}`;
  const blocking = [...result.hardFailureIds, ...result.unknownIds];
  assert.ok(blocking.includes(constraintId), `arrival constraint ${constraintId} must be the named hard blocker`);
});

test('rev2-r2: a too-late arrival offer is rejected with deterministic evidence; a timely one passes', async () => {
  const harness = createHarness();
  const { tripId, engagementId } = await promoteOne(harness, 'evt-c4');
  const snapshot = await buildTripSnapshot(harness.snapshotDeps, tripId, AT);
  const constraintId = `c-${tripId}-arrival-before-${engagementId}`;
  const viability = new OverlayViabilityEngine();

  // Arrival after the commitment start (15:00) -> deterministic FAIL.
  const late = legOperation(tripId, `el-${tripId}-arrival`, '2026-09-08T16:30:00+08:00', '2026-09-08T12:00:00+08:00');
  const lateResult = await viability.evaluateOverlay({ baseSnapshot: snapshot, candidateOperations: [late] });
  assert.equal(lateResult.feasible, false);
  assert.ok(lateResult.hardFailureIds.includes(constraintId), 'too-late arrival must be a named HARD failure');
  const lateEval = lateResult.constraintResults.find((entry) => entry.constraintId === constraintId);
  assert.equal(lateEval?.status, 'FAIL');
  assert.ok(lateEval?.evidence && lateEval.evidence.length > 0, 'the FAIL must carry deterministic evidence');

  // Arrival well before the commitment start -> PASS, trip feasible.
  const timely = legOperation(tripId, `el-${tripId}-arrival`, '2026-09-06T21:30:00+08:00', '2026-09-06T20:00:00+08:00');
  const timelyResult = await viability.evaluateOverlay({ baseSnapshot: snapshot, candidateOperations: [timely] });
  assert.equal(timelyResult.feasible, true);
  const timelyEval = timelyResult.constraintResults.find((entry) => entry.constraintId === constraintId);
  assert.equal(timelyEval?.status, 'PASS');
});

test('rev2-r2: absent hardness/buffer/rule-set evidence is a recorded decision, surfaced as uncertainty', async () => {
  const harness = createHarness();
  const eventId = 'evt-c5';
  const draft = singleTravellerDraft(eventId, `src-${eventId}`);

  // No rule sets at all in this programme: the absence must be recorded,
  // never papered over with a fabricated governing policy.
  const context = programmeContext(eventId, { ruleSets: [] });
  await harness.service.applyProgrammeContext({
    at: AT,
    sourceId: `src-${eventId}`,
    organisation: context.organisation,
    anchorEvent: context.anchorEvent,
    places: context.places,
    ruleSets: context.ruleSets,
  });
  const result = await harness.service.intakeImportDraft({ importDraft: draft, at: AT });
  const outcome = result.outcomes[0]!;
  assert.equal(outcome.promoted, true);

  const decisions = outcome.issues.filter((issue) => issue.startsWith('recorded decision:'));
  assert.ok(decisions.some((issue) => /hardness/i.test(issue)), 'hardness derivation must be a recorded decision');
  assert.ok(decisions.some((issue) => /buffer/i.test(issue)), 'absent buffer evidence must be a recorded decision');
  assert.ok(decisions.some((issue) => /rule set/i.test(issue)), 'absent rule sets must be a recorded decision');

  const trip = (await harness.trips.getTrip(outcome.tripId!))!;
  assert.deepEqual(trip.governedByRuleSetIds, []);
  assert.ok(trip.objectives.every((objective) => objective.hardness === 'SOFT'));

  const uncertainties = intakeUncertainties(draft, result.outcomes);
  assert.ok(
    uncertainties.filter((uncertainty) => /recorded decision/i.test(uncertainty.statement)).length >= decisions.length,
    'every recorded decision must surface as an UncertaintyRecord',
  );
});

test('rev2-r2: NorthstarPlanner arrival strategies fill the shared slot and the overlay judges them', async () => {
  const harness = createHarness();
  const { tripId } = await promoteOne(harness, 'evt-c6', { home: true });
  const snapshot = await buildTripSnapshot(harness.snapshotDeps, tripId, AT);

  const homeRef = { system: 'airport-code', value: 'HOM' };
  const destRef = { system: 'airport-code', value: 'DST' };
  const offer = (offerId: string, price: number, departure: string, arrival: string): FlightOffer => ({
    offerId,
    segments: [{ origin: homeRef, destination: destRef, departure, arrival }],
    totalPrice: { amount: price, currency: 'SGD' },
    availability: 'AVAILABLE',
  });
  const timelyOffer = offer('offer-timely', 100, '2026-09-06T20:00:00+08:00', '2026-09-06T21:30:00+08:00');
  const lateOffer = offer('offer-late', 200, '2026-09-08T12:00:00+08:00', '2026-09-08T16:30:00+08:00');

  let counter = 0;
  const planner = new NorthstarPlanner(
    { plan: async () => ({ strategies: [], toolRequests: [], assumptions: [], uncertainties: [] }) },
    { idFactory: (prefix) => `${prefix}-${(counter += 1)}`, now: () => AT },
  );
  const input: PlannerInput = {
    caseId: 'case-rev2-r2',
    snapshot,
    triggeringSignals: [],
    impact: ImpactAssessmentSchema.parse({
      id: 'imp-rev2-r2',
      tripId,
      assessedAt: AT,
      severity: 'MEDIUM',
    }),
    capabilityRegistry: [],
    priorToolResults: [
      { toolRequestId: 'tool-1', summary: 'flight.search evidence', data: { offers: [timelyOffer, lateOffer] } },
    ],
    priorActionResults: [],
  };
  const output = await planner.plan(input);
  assert.equal(output.strategies.length, 2);

  // Every arrival strategy must fill the SAME promotion-known slot — that is
  // what makes the promotion-time constraint able to judge it.
  const slotId = `el-${tripId}-arrival`;
  for (const strategy of output.strategies) {
    const upsert = strategy.candidateOperations[0];
    assert.ok(upsert && upsert.op === 'UPSERT_ENTITY');
    if (upsert && upsert.op === 'UPSERT_ENTITY') assert.equal((upsert.data as { id: string }).id, slotId);
  }

  const viability = new OverlayViabilityEngine();
  const [timelyStrategy, lateStrategy] = output.strategies;
  const timelyResult = await viability.evaluateOverlay({
    baseSnapshot: snapshot,
    candidateOperations: timelyStrategy!.candidateOperations,
  });
  assert.equal(timelyResult.feasible, true, 'timely arrival strategy must be feasible');
  const lateResult = await viability.evaluateOverlay({
    baseSnapshot: snapshot,
    candidateOperations: lateStrategy!.candidateOperations,
  });
  assert.equal(lateResult.feasible, false, 'late arrival strategy must be infeasible');
  assert.ok(lateResult.hardFailureIds.length >= 1, 'late arrival must fail a named HARD constraint');
});

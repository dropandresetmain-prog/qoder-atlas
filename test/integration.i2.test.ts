/**
 * I2 evidence — TripSignal -> validated mutation -> ImpactAssessment.
 *
 * Proves: an authoritative disruption signal mutates state only through the
 * frozen mutation path; impact reads post-mutation state and matches the
 * fixture's own expectations (direct/affected/threatened); constraint
 * statuses + trip viability persist; weak evidence stays uncertain instead
 * of mutating; outranked facts never silently overwrite; the case lifecycle
 * opens DETECTED -> ASSESSING; the audit chain links signal -> mutation ->
 * impact -> case; and everything survives a full restart.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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
import { loadScenario } from '../src/scenarios/loader.ts';
import type { TripSignal } from '../src/operational/signal.ts';
import {
  SqlitePreferenceStore,
  processSignal,
  seedScenarioBundle,
} from '../src/app/index.ts';

const FIXTURES_ROOT = resolve('fixtures/scenarios');
const SCENARIO_A_DIR = join(FIXTURES_ROOT, 'anchor-event-speaker');

function createHarness(dbPath = ':memory:') {
  const db = openDatabase(dbPath);
  const trips = new SqliteTripRepository(db);
  const entities = new SqliteEntityStore(db);
  const sources = new SqliteSourceRepository(db);
  const signals = new SqliteSignalRepository(db);
  const cases = new SqliteCaseRepository(db);
  const audit = new SqliteAuditRepository(db);
  const preferences = new SqlitePreferenceStore(db);
  const mutations = new SqlMutationService({ db, trips, entities });
  const seedDeps = { mutations, sources, preferences, audit };
  const pipelineDeps = { trips, signals, entities, cases, mutations, audit };
  return { db, trips, entities, sources, signals, cases, audit, mutations, seedDeps, pipelineDeps };
}

test('i2: authoritative disruption signal mutates state through the validated path', async () => {
  const harness = createHarness();
  const spec = loadScenario(SCENARIO_A_DIR);
  await seedScenarioBundle(harness.seedDeps, SCENARIO_A_DIR);
  const versionBefore = (await harness.trips.getTrip(spec.trip.id))!.version;

  const result = await processSignal(harness.pipelineDeps, spec.disruption.signal);

  // The signal persisted and drove a real, accepted mutation proposal.
  assert.ok(await harness.signals.getSignal(spec.disruption.signal.id));
  assert.equal(result.mutationAccepted, true);
  assert.equal(result.mutationProposalId, `prop-signal-${spec.disruption.signal.id}`);
  assert.ok(result.appliedOperationCount >= 1);
  assert.ok(result.tripVersion > versionBefore, 'trip version must advance');

  // Direct effect: the subject element is cancelled; unrelated elements untouched.
  const subjectId = spec.disruption.signal.subjectRef!.id;
  const trip = (await harness.trips.getTrip(spec.trip.id))!;
  const subject = trip.elements.find((e) => e.id === subjectId)!;
  assert.equal(subject.reservationState, 'CANCELLED');
  for (const element of trip.elements) {
    if (element.id !== subjectId) {
      const original = spec.trip.elements.find((e) => e.id === element.id)!;
      assert.equal(element.reservationState, original.reservationState, `element ${element.id} must be untouched`);
    }
  }
  // Trip viability persisted as DISRUPTED (direct failure present).
  assert.equal(trip.viability, 'DISRUPTED');
});

test('i2: blast radius matches fixture expectations without blanket invalidation', async () => {
  const harness = createHarness();
  const spec = loadScenario(SCENARIO_A_DIR);
  await seedScenarioBundle(harness.seedDeps, SCENARIO_A_DIR);

  const result = await processSignal(harness.pipelineDeps, spec.disruption.signal);
  const { assessment } = result;

  assert.equal(assessment.severity, spec.expectations.impact.severity);
  assert.deepEqual(
    assessment.directFailures.map((f) => f.elementId).sort(),
    [...spec.expectations.impact.directFailureElementIds].sort(),
  );
  assert.deepEqual(
    assessment.affectedElements.map((a) => a.elementId).sort(),
    [...spec.expectations.impact.atRiskElementIds].sort(),
  );
  assert.deepEqual(
    assessment.threatenedObjectives.map((o) => o.objectiveId).sort(),
    [...spec.expectations.impact.threatenedObjectiveIds].sort(),
  );

  // Impact ran over POST-mutation state: the direct failure reason cites the
  // cancellation itself, and propagation stayed scoped (no blanket INVALID).
  const direct = assessment.directFailures[0]!;
  assert.match(direct.reason, /cancelled/i);
  for (const affected of assessment.affectedElements) {
    assert.equal(affected.resultingStatus, 'AT_RISK');
  }

  // Failed constraints are persisted with FAIL status through the mutation path.
  assert.ok(result.constraintEvaluations.some((e) => e.status === 'FAIL'));
  for (const evaluation of result.constraintEvaluations.filter((e) => e.status === 'FAIL')) {
    const entry = await harness.entities.get('CONSTRAINT', evaluation.constraintId);
    assert.ok(entry && entry.entityType === 'CONSTRAINT');
    if (entry && entry.entityType === 'CONSTRAINT') assert.equal(entry.entity.status, 'FAIL');
  }
});

test('i2: case opens DETECTED -> ASSESSING with signal-linked evidence', async () => {
  const harness = createHarness();
  const spec = loadScenario(SCENARIO_A_DIR);
  await seedScenarioBundle(harness.seedDeps, SCENARIO_A_DIR);

  const result = await processSignal(harness.pipelineDeps, spec.disruption.signal);
  assert.equal(result.caseStatus, 'ASSESSING');

  const recoveryCase = await harness.cases.getCase(result.caseId);
  assert.ok(recoveryCase, 'case persisted');
  assert.deepEqual(recoveryCase!.triggeredBySignalIds, [spec.disruption.signal.id]);
  assert.deepEqual(recoveryCase!.affectedElementIds.sort(), [
    ...spec.expectations.impact.directFailureElementIds,
    ...spec.expectations.impact.atRiskElementIds,
  ].sort());
  assert.ok(recoveryCase!.failedConstraintIds.length > 0);
  assert.equal(recoveryCase!.version, 1, 'open + one transition');

  // Re-processing the same signal must not duplicate the case.
  const again = await processSignal(harness.pipelineDeps, spec.disruption.signal);
  assert.equal(again.caseId, result.caseId);
  assert.equal((await harness.cases.listCasesForTrip(spec.trip.id)).length, 1);
});

test('i2: weak-authority cancellation mutates nothing and preserves uncertainty', async () => {
  const harness = createHarness();
  const spec = loadScenario(SCENARIO_A_DIR);
  await seedScenarioBundle(harness.seedDeps, SCENARIO_A_DIR);

  const weakSignal: TripSignal = {
    ...spec.disruption.signal,
    id: 'sig_i2_weak_cancel',
    authority: 'ASSERTED',
    confidence: 0.4,
  };
  const versionBefore = (await harness.trips.getTrip(spec.trip.id))!.version;
  const result = await processSignal(harness.pipelineDeps, weakSignal);

  // No state mutation: the element stays exactly as seeded.
  assert.equal(result.mutationProposalId, undefined);
  assert.equal(result.mutationAccepted, false);
  const trip = (await harness.trips.getTrip(spec.trip.id))!;
  const subject = trip.elements.find((e) => e.id === weakSignal.subjectRef!.id)!;
  assert.equal(subject.reservationState, 'CONFIRMED');

  // Impact keeps the threat visible as AT_RISK with an explicit unknown.
  assert.equal(result.assessment.directFailures.length, 0);
  assert.ok(result.assessment.affectedElements.some((a) => a.elementId === weakSignal.subjectRef!.id));
  assert.ok(result.assessment.unresolvedUnknowns.length > 0, 'uncertainty must stay visible');
  assert.equal(trip.viability, 'AT_RISK', 'weak evidence degrades to AT_RISK, never DISRUPTED certainty');
  assert.equal(result.tripVersion > versionBefore, true, 'impact persistence still advances the version');
});

test('i2: schedule facts update via UPSERT_FACT and outranked evidence is refused', async () => {
  const harness = createHarness();
  const spec = loadScenario(SCENARIO_A_DIR);
  await seedScenarioBundle(harness.seedDeps, SCENARIO_A_DIR);

  // Generic subject selection: first transport leg carrying a departure fact.
  const leg = spec.trip.elements.find(
    (e) => e.elementKind === 'TRANSPORT_LEG' && e.data.scheduledDeparture,
  );
  assert.ok(leg && leg.elementKind === 'TRANSPORT_LEG');
  const original = leg!.data.scheduledDeparture!;
  const delayedIso = new Date(Date.parse(original.value) + 2 * 3_600_000).toISOString().replace('Z', '+00:00');

  const delaySignal: TripSignal = {
    id: 'sig_i2_delay',
    kind: 'FLIGHT_DELAY',
    occurredAt: spec.disruption.signal.occurredAt,
    receivedAt: spec.disruption.signal.receivedAt,
    sourceId: spec.disruption.signal.sourceId,
    authority: 'AUTHORITATIVE',
    tripId: spec.trip.id,
    subjectRef: { entityType: 'TRIP_ELEMENT', id: leg!.id },
    payload: { scheduledDeparture: delayedIso },
  };
  const result = await processSignal(harness.pipelineDeps, delaySignal);
  assert.equal(result.mutationAccepted, true);
  const delayedTrip = (await harness.trips.getTrip(spec.trip.id))!;
  const delayedLeg = delayedTrip.elements.find((e) => e.id === leg!.id);
  assert.ok(delayedLeg && delayedLeg.elementKind === 'TRANSPORT_LEG');
  assert.equal(delayedLeg!.data.scheduledDeparture!.value, delayedIso);
  assert.equal(delayedLeg!.data.scheduledDeparture!.sourceId, delaySignal.sourceId);

  // Weaker authority observed later must NOT overwrite: FACT_OUTRANKED.
  const weakerSignal: TripSignal = {
    ...delaySignal,
    id: 'sig_i2_delay_weak',
    authority: 'ASSERTED',
    payload: { scheduledDeparture: new Date(Date.parse(delayedIso) + 3_600_000).toISOString().replace('Z', '+00:00') },
  };
  const refused = await processSignal(harness.pipelineDeps, weakerSignal);
  assert.equal(refused.mutationAccepted, false);
  assert.ok(refused.mutationIssues.some((issue) => issue.code === 'FACT_OUTRANKED'));
  const unchanged = (await harness.trips.getTrip(spec.trip.id))!;
  const unchangedLeg = unchanged.elements.find((e) => e.id === leg!.id);
  assert.ok(unchangedLeg && unchangedLeg.elementKind === 'TRANSPORT_LEG');
  assert.equal(unchangedLeg!.data.scheduledDeparture!.value, delayedIso);
});

test('i2: audit chain links signal -> mutation -> impact -> case', async () => {
  const harness = createHarness();
  const spec = loadScenario(SCENARIO_A_DIR);
  await seedScenarioBundle(harness.seedDeps, SCENARIO_A_DIR);
  const result = await processSignal(harness.pipelineDeps, spec.disruption.signal);

  const processed = await harness.audit.query({ action: 'SIGNAL_PROCESSED', subject: spec.trip.id });
  assert.equal(processed.length, 1);
  const payload = processed[0]!.payload;
  assert.equal(payload['signalId'], spec.disruption.signal.id);
  assert.equal(payload['mutationProposalId'], result.mutationProposalId);
  assert.equal(payload['impactId'], result.assessment.id);
  assert.equal(payload['caseId'], result.caseId);
  assert.equal(payload['severity'], spec.expectations.impact.severity);

  // The mutation service's own trail carries the signal proposal with provenance.
  const applied = await harness.audit.query({ action: 'MUTATION_APPLIED', subject: spec.trip.id });
  assert.ok(applied.length >= 2, 'signal mutation + impact mutation both audited');
  assert.ok(applied.some((entry) => JSON.stringify(entry.payload).includes(result.mutationProposalId!)));
});

test('i2: post-disruption state survives a full restart', async () => {
  const dbDir = mkdtempSync(join(tmpdir(), 'atlas-i2-restart-'));
  const dbPath = join(dbDir, 'app.sqlite');

  const first = createHarness(dbPath);
  const spec = loadScenario(SCENARIO_A_DIR);
  await seedScenarioBundle(first.seedDeps, SCENARIO_A_DIR);
  const result = await processSignal(first.pipelineDeps, spec.disruption.signal);
  const tripBefore = await first.trips.getTrip(spec.trip.id);
  const caseBefore = await first.cases.getCase(result.caseId);
  first.db.close();

  const second = createHarness(dbPath);
  assert.deepEqual(await second.trips.getTrip(spec.trip.id), tripBefore);
  assert.deepEqual(await second.cases.getCase(result.caseId), caseBefore);
  assert.ok(await second.signals.getSignal(spec.disruption.signal.id), 'signal persisted');
  assert.equal((await second.audit.query({ action: 'SIGNAL_PROCESSED' })).length, 1);
  second.db.close();
});

test('i2: identical signal + state produce identical impact (determinism)', async () => {
  const runs = [];
  for (let i = 0; i < 2; i += 1) {
    const harness = createHarness();
    const spec = loadScenario(SCENARIO_A_DIR);
    await seedScenarioBundle(harness.seedDeps, SCENARIO_A_DIR);
    const result = await processSignal(harness.pipelineDeps, spec.disruption.signal);
    runs.push({ assessment: result.assessment, evaluations: result.constraintEvaluations });
  }
  assert.deepEqual(runs[1]!.assessment, runs[0]!.assessment);
  assert.deepEqual(runs[1]!.evaluations, runs[0]!.evaluations);
});

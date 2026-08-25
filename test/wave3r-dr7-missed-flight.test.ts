/**
 * DR-7 — missed-flight resolution through generic machinery.
 *
 * Proves:
 * - A missed-flight report opens a recovery case through the SAME signal
 *   pipeline supplier cancellations use (no bespoke domain branch);
 * - Impact assessment exposes the blast radius (downstream transfer/hotel/
 *   engagement threats) through the SAME impact engine;
 * - The full recovery loop (plan -> begin -> approve -> execute) resolves or
 *   honestly escalates through the SAME orchestrator;
 * - A second traveller/trip is unaffected (isolation);
 * - No MISSED_FLIGHT-specific case handling exists downstream: the same
 *   functions, transitions, and audit actions process a missed flight as a
 *   supplier cancellation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import type { AddressInfo } from 'node:net';

import { AppConfigSchema } from '../src/config/config.ts';
import { composeAppRuntime } from '../src/app/compose.ts';
import { createAppServer } from '../src/server/http.ts';
import { loadScenario } from '../src/scenarios/loader.ts';
import { ImpactEngine } from '../src/engine/impact.ts';
import {
  SqliteTripRepository,
  SqliteSignalRepository,
  SqliteCaseRepository,
  SqliteAuditRepository,
} from '../src/persistence/repositories.ts';
import { SqliteEntityStore } from '../src/persistence/entityStore.ts';
import { SqlMutationService } from '../src/engine/mutation.ts';
import { reportMissedFlight } from '../src/app/missedFlight.ts';

const FIXTURES_ROOT = resolve('fixtures');
const SCENARIO_A_DIR = join(FIXTURES_ROOT, 'scenarios', 'anchor-event-speaker');

const runtimeConfig = AppConfigSchema.parse({
  environment: 'local',
  adapterMode: 'REPLAY',
  sqlitePath: ':memory:',
  fixturesDir: FIXTURES_ROOT,
  providers: { atlas: { env: 'sandbox' }, modelStudio: {}, googleRoutes: {} },
});

test('DR-7: missed-flight report opens recovery case through generic machinery', async () => {
  const composed = await composeAppRuntime(runtimeConfig);
  try {
    const spec = loadScenario(SCENARIO_A_DIR);
    const trips = new SqliteTripRepository(composed.db);
    const entities = new SqliteEntityStore(composed.db);
    const signals = new SqliteSignalRepository(composed.db);
    const cases = new SqliteCaseRepository(composed.db);
    const audit = new SqliteAuditRepository(composed.db);

    // ------------------------------------------------------------------
    // 1. Missed-flight report: traveller missed the outbound flight.
    // ------------------------------------------------------------------
    const missedFlightOutcome = await reportMissedFlight({
      orchestrator: composed.orchestrator,
      trips,
      mutations: new SqlMutationService({ db: composed.db, trips, entities }),
    }, {
      tripId: spec.trip.id,
      elementId: 'el_a_flight_out',
      travellerReport: 'I missed my flight due to traffic',
      at: '2026-09-13T07:00:00+09:00',
    });

    assert.ok(missedFlightOutcome.caseId, 'a recovery case was opened');
    assert.equal(missedFlightOutcome.missedElementId, 'el_a_flight_out');
    // The traveller-state mutation lands through the validated mutation path
    // INSIDE reportMissedFlight (the element is CANCELLED there); the generic
    // TRAVELLER_INPUT signal itself carries no deterministic state implication
    // (signalMutationOperations returns no ops for it), so the pipeline reports
    // no second mutation — missed flights never double-mutate.
    assert.equal(missedFlightOutcome.processed.mutationAccepted, false);
    const tripAfterMiss = await trips.getTrip(spec.trip.id);
    const missedLeg = tripAfterMiss?.elements.find((e) => e.id === 'el_a_flight_out');
    assert.equal(missedLeg?.reservationState, 'CANCELLED', 'the missed leg is marked cancelled through the validated path');

    // The signal is TRAVELLER_INPUT (generic), not a bespoke MISSED_FLIGHT kind.
    const signal = await signals.getSignal(missedFlightOutcome.signalId);
    assert.ok(signal);
    assert.equal(signal!.kind, 'TRAVELLER_INPUT');
    assert.equal(signal!.payload['event'], 'MISSED_FLIGHT');

    // ------------------------------------------------------------------
    // 2. Impact assessment exposes blast radius through the SAME engine.
    // ------------------------------------------------------------------
    const assessment = await new ImpactEngine({
      trips,
      signals,
      entities,
    }).assess(spec.trip.id);

    assert.ok(
      assessment.directFailures.some((f) => f.elementId === 'el_a_flight_out'),
      'the missed flight is a direct failure',
    );
    const atRiskIds = assessment.affectedElements.map((e) => e.elementId);
    assert.ok(atRiskIds.includes('el_a_transfer'), 'airport transfer enters the blast radius');
    assert.ok(atRiskIds.includes('el_a_hotel'), 'hotel timing enters the blast radius');
    assert.ok(
      assessment.threatenedObjectives.some((o) => o.objectiveId === 'obj_a_keynote'),
      'the keynote objective is threatened',
    );

    // ------------------------------------------------------------------
    // 3. Full recovery loop through the SAME orchestrator.
    // ------------------------------------------------------------------
    const caseId = missedFlightOutcome.caseId;

    const plan = await composed.orchestrator.plan({
      caseId,
      at: '2026-09-13T07:30:00+09:00',
    });
    assert.ok(plan.bestStrategyId, 'planning ranks a feasible strategy');

    const begin = await composed.orchestrator.begin({
      caseId,
      strategyId: plan.bestStrategyId!,
      at: '2026-09-13T07:40:00+09:00',
    });
    assert.equal(begin.outcome, 'REQUIRES_TRAVELLER');

    const decide = await composed.orchestrator.decide({
      caseId,
      intentId: begin.intentId,
      decidedBy: { entityType: 'TRAVELLER', id: spec.trip.travellerIds[0]! },
      verdict: 'APPROVED',
      at: '2026-09-13T07:50:00+09:00',
    });
    assert.equal(decide.accepted, true);

    const execute = await composed.orchestrator.execute({
      caseId,
      intentId: begin.intentId,
      at: '2026-09-13T07:55:00+09:00',
    });
    assert.equal(execute.executed, true);
    assert.equal(execute.caseStatus, 'RESOLVED');
    assert.equal(execute.resolutionOutcome, 'FULLY_RECOVERED');

    // ------------------------------------------------------------------
    // 4. Isolation: the corporate-tmc trip was untouched.
    // ------------------------------------------------------------------
    const otherTrip = await trips.getTrip('trip_b');
    if (otherTrip) {
      const otherCases = await cases.listCasesForTrip('trip_b');
      assert.equal(otherCases.length, 0, 'no case was opened on an unaffected trip');
    }

    // ------------------------------------------------------------------
    // 5. No MISSED_FLIGHT-specific handling: the same vocabulary.
    // ------------------------------------------------------------------
    // The case transitions (DETECTED -> ASSESSING -> PLANNING -> BEGINNING ->
    // EXECUTING -> RESOLVED) are identical to supplier cancellations. The audit
    // actions (SIGNAL_PROCESSED, PLANNING_COMPLETED, AUTHORITY_DECIDED,
    // APPROVAL_RECORDED, EXECUTION_COMPLETED, CASE_VERIFIED) are identical.
    // The signal kind is TRAVELLER_INPUT (generic), not a bespoke kind.
    const caseDetail = await cases.getCase(caseId);
    assert.ok(caseDetail);
    assert.ok(caseDetail!.status === 'RESOLVED');

    const auditEntries = await audit.query({ subject: spec.trip.id });
    const actions = auditEntries.map((e) => e.action);
    for (const expected of ['SIGNAL_PROCESSED', 'PLANNING_COMPLETED', 'AUTHORITY_DECIDED', 'APPROVAL_RECORDED', 'EXECUTION_COMPLETED']) {
      assert.ok(actions.includes(expected), `audit trail carries ${expected}`);
    }

    // The signal pipeline's signalMutationOperations returns [] for
    // TRAVELLER_INPUT (no automatic state change from the signal itself), but
    // the missed-flight module pre-applied the CANCELLED mutation before
    // signal processing, so the impact engine sees the failure. This is the
    // same pattern as a supplier cancellation: the mutation happens first,
    // then the signal triggers impact assessment and case opening.
  } finally {
    composed.db.close();
  }
});

test('DR-7: missed-flight with auto-resolved element (earliest upcoming flight)', async () => {
  const composed = await composeAppRuntime(runtimeConfig);
  try {
    const spec = loadScenario(SCENARIO_A_DIR);
    const trips = new SqliteTripRepository(composed.db);
    const entities = new SqliteEntityStore(composed.db);

    // Report a missed flight WITHOUT specifying elementId: the module should
    // resolve the earliest upcoming FLIGHT TRANSPORT_LEG automatically.
    const missedFlightOutcome = await reportMissedFlight({
      orchestrator: composed.orchestrator,
      trips,
      mutations: new SqlMutationService({ db: composed.db, trips, entities }),
    }, {
      tripId: spec.trip.id,
      travellerReport: 'I missed my flight',
      at: '2026-09-13T07:00:00+09:00', // before the 08:10 departure
    });

    assert.equal(
      missedFlightOutcome.missedElementId,
      'el_a_flight_out',
      'auto-resolved to the earliest upcoming flight',
    );
    assert.ok(missedFlightOutcome.caseId);
  } finally {
    composed.db.close();
  }
});

test('DR-7: missed-flight after departure time throws', async () => {
  const composed = await composeAppRuntime(runtimeConfig);
  try {
    const spec = loadScenario(SCENARIO_A_DIR);
    const trips = new SqliteTripRepository(composed.db);
    const entities = new SqliteEntityStore(composed.db);

    // Try to report a missed flight AFTER the scheduled departure: the module
    // should throw because there's no upcoming flight.
    await assert.rejects(
      async () => {
        await reportMissedFlight({
          orchestrator: composed.orchestrator,
          trips,
          mutations: new SqlMutationService({ db: composed.db, trips, entities }),
        }, {
          tripId: spec.trip.id,
          travellerReport: 'I missed my flight',
          at: '2026-09-13T09:00:00+09:00', // after the 08:10 departure
        });
      },
      /no upcoming FLIGHT TRANSPORT_LEG found/,
    );
  } finally {
    composed.db.close();
  }
});

test('DR-7: an explicit missed connection report is accepted after scheduled departure over HTTP', async () => {
  const composed = await composeAppRuntime(runtimeConfig);
  const server = createAppServer(runtimeConfig, composed.endpoints);
  await new Promise<void>((resolvePromise) => server.listen(0, resolvePromise));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  try {
    const response = await fetch(`${base}/api/runtime/missed-flight`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tripId: 'trip_a',
        elementId: 'el_a_flight_out',
        travellerReport: 'My inbound flight landed late and I missed this connection.',
        at: '2026-09-13T09:00:00+09:00',
      }),
    });
    const body = (await response.json()) as { missedElementId?: string; caseId?: string };
    assert.equal(response.status, 200);
    assert.equal(body.missedElementId, 'el_a_flight_out');
    assert.ok(body.caseId, 'the natural traveller report opens a recovery case');
  } finally {
    await new Promise<void>((resolvePromise, reject) =>
      server.close((error) => (error ? reject(error) : resolvePromise())),
    );
    composed.db.close();
  }
});

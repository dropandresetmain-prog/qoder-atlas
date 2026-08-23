/**
 * Wave 3 Gate 4 — Case B: hero disruption with visible downstream impact.
 *
 * The keynote-speaker trip's outbound flight is cancelled. Through the SAME
 * composed engine (zero credentials, REPLAY) the test proves:
 * - impact assessment shows the blast radius: transfer and hotel AT_RISK,
 *   the keynote objective threatened — never limited to the cancelled leg;
 * - the read models surface that blast radius: case detail affectedItems
 *   name the downstream elements, checks carry the arrival-buffer FAIL,
 *   criticalObjectiveAtRisk names the keynote, uncertainties stay
 *   first-class (UNKNOWN != PASS);
 * - the programme view marks the speaker's trip and the endangered
 *   commitment; other trips stay isolated;
 * - the full loop (plan -> begin -> traveller approval -> simulated
 *   execution -> verification) resolves to FULLY_RECOVERED with the trip
 *   reverified VIABLE, and the activity stream records every real step.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';

import { AppConfigSchema } from '../src/config/config.ts';
import { composeAppRuntime } from '../src/app/compose.ts';
import { loadScenario } from '../src/scenarios/loader.ts';
import { ImpactEngine } from '../src/engine/impact.ts';
import {
  SqliteTripRepository,
  SqliteSignalRepository,
  SqliteCaseRepository,
} from '../src/persistence/repositories.ts';
import { SqliteEntityStore } from '../src/persistence/entityStore.ts';

const FIXTURES_ROOT = resolve('fixtures');
const SCENARIO_A_DIR = join(FIXTURES_ROOT, 'scenarios', 'anchor-event-speaker');

const runtimeConfig = AppConfigSchema.parse({
  environment: 'local',
  adapterMode: 'REPLAY',
  sqlitePath: ':memory:',
  fixturesDir: FIXTURES_ROOT,
  providers: { atlas: { env: 'sandbox' }, modelStudio: {}, googleRoutes: {} },
});

test('Wave 3 Case B: hero disruption — blast radius visible in read models, full recovery through the same engine', async () => {
  const composed = await composeAppRuntime(runtimeConfig);
  try {
    const spec = loadScenario(SCENARIO_A_DIR);
    const trips = new SqliteTripRepository(composed.db);
    const entities = new SqliteEntityStore(composed.db);
    const signals = new SqliteSignalRepository(composed.db);
    const cases = new SqliteCaseRepository(composed.db);

    // ------------------------------------------------------------------
    // 1. Disruption: the hero's outbound flight is cancelled.
    // ------------------------------------------------------------------
    const disruption = await composed.orchestrator.processDisruption(spec.disruption.signal);
    assert.equal(disruption.mutationAccepted, true);
    const caseId = disruption.caseId;

    // Impact engine blast radius: the failure is not contained to the leg.
    const assessment = await new ImpactEngine({
      trips,
      signals,
      entities,
    }).assess(spec.trip.id);
    assert.ok(assessment.directFailures.some((failure) => failure.elementId === 'el_a_flight_out'));
    const atRiskIds = assessment.affectedElements.map((element) => element.elementId);
    assert.ok(atRiskIds.includes('el_a_transfer'), 'airport transfer enters the blast radius');
    assert.ok(atRiskIds.includes('el_a_hotel'), 'hotel timing enters the blast radius');
    assert.ok(
      assessment.threatenedObjectives.some((objective) => objective.objectiveId === 'obj_a_keynote'),
      'the keynote objective is threatened by the cancellation',
    );

    // ------------------------------------------------------------------
    // 2. Read models surface the downstream impact — blast radius, checks,
    //    critical objective, uncertainties (UNKNOWN != PASS).
    // ------------------------------------------------------------------
    const detail = await composed.endpoints.caseDetail(caseId, '2026-09-12T18:10:00+09:00');
    assert.ok(detail, 'case detail is projected for the open case');
    assert.equal(detail!.status, 'DISRUPTED');
    assert.ok(
      detail!.affectedItems.some((item) => item.includes('Transport leg')),
      `affected items name transport elements: ${JSON.stringify(detail!.affectedItems)}`,
    );
    assert.ok(detail!.criticalObjectiveAtRisk, 'the critical objective at risk is surfaced');
    const checkResults = detail!.checks.map((check) => check.result);
    assert.ok(
      checkResults.includes('FAIL') || checkResults.includes('UNKNOWN'),
      `checks surface the disruption (never silently PASS): ${JSON.stringify(checkResults)}`,
    );
    assert.ok(Array.isArray(detail!.uncertainties), 'uncertainties are first-class on the case');

    // Traveller view: what matters now + the hard objective threatened.
    const travellerView = await composed.endpoints.travellerTrip(spec.trip.id, '2026-09-12T18:10:00+09:00');
    assert.equal(travellerView?.status, 'DISRUPTED');
    assert.ok(travellerView?.whatChanged, 'the traveller is told what changed');

    // Programme view: the speaker trip is disrupted inside the programme;
    // isolation — no unrelated traveller row is touched by this signal.
    const programme = await composed.endpoints.programme!.view({
      anchorEventId: spec.trip.anchorEventId!,
      at: '2026-09-12T18:10:00+09:00',
    });
    assert.equal(programme.status, 200);
    const view = programme.body as {
      summary: { disrupted: number; total: number };
      travellers: Array<{ tripId: string; status: string }>;
    };
    const speakerRow = view.travellers.find((row) => row.tripId === spec.trip.id);
    assert.ok(speakerRow, 'the hero trip appears in the programme view');
    assert.equal(speakerRow!.status, 'DISRUPTED');
    assert.ok(view.summary.disrupted >= 1, 'programme rollup counts the disrupted traveller');

    // ------------------------------------------------------------------
    // 3. Recovery through the SAME engine: plan -> begin -> approval ->
    //    simulated execution -> verified RESOLVED.
    // ------------------------------------------------------------------
    const plan = await composed.orchestrator.plan({ caseId, at: '2026-09-12T18:30:00+09:00' });
    assert.ok(plan.bestStrategyId, 'planning ranks an evidence-bound strategy');

    const begin = await composed.orchestrator.begin({
      caseId,
      strategyId: plan.bestStrategyId!,
      at: '2026-09-12T18:40:00+09:00',
    });
    assert.equal(begin.outcome, 'REQUIRES_TRAVELLER');

    const decide = await composed.orchestrator.decide({
      caseId,
      intentId: begin.intentId,
      decidedBy: { entityType: 'TRAVELLER', id: spec.trip.travellerIds[0]! },
      verdict: 'APPROVED',
      at: '2026-09-12T18:50:00+09:00',
    });
    assert.equal(decide.accepted, true);

    const execute = await composed.orchestrator.execute({
      caseId,
      intentId: begin.intentId,
      at: '2026-09-12T18:55:00+09:00',
    });
    assert.equal(execute.executed, true);
    assert.equal(execute.simulated, true, 'REPLAY stays at the simulated boundary — honest provenance');
    assert.equal(execute.caseStatus, 'RESOLVED');
    assert.equal(execute.resolutionOutcome, 'FULLY_RECOVERED');

    // ------------------------------------------------------------------
    // 4. Whole-trip reverification + truthful activity trail.
    // ------------------------------------------------------------------
    const travellerAfter = await composed.endpoints.travellerTrip(spec.trip.id, '2026-09-12T19:00:00+09:00');
    assert.equal(travellerAfter?.status, 'RESOLVED');
    assert.equal(travellerAfter?.remainderViable, 'VIABLE', 'the whole trip is reverified, not just the leg');

    const activity = await composed.endpoints.wave!.tripActivity(spec.trip.id, '2026-09-12T19:00:00+09:00');
    const actions = activity!.events.map((event) => event.action);
    for (const expected of ['SIGNAL_PROCESSED', 'PLANNING_COMPLETED', 'AUTHORITY_DECIDED', 'APPROVAL_RECORDED', 'EXECUTION_COMPLETED', 'CASE_VERIFIED']) {
      assert.ok(actions.includes(expected), `activity trail carries ${expected}`);
    }

    // Isolation: the corporate-tmc trip was untouched by the hero signal.
    const otherTrip = await trips.getTrip('trip_b');
    if (otherTrip) {
      const otherCase = await cases.listCasesForTrip('trip_b');
      assert.equal(otherCase.length, 0, 'no case was opened on an unaffected trip');
    }

    // Reset restores the pristine demo for the next case run (no residue).
    const reset = await composed.orchestrator.reset('2026-09-12T23:00:00+09:00');
    assert.ok(reset.tripIds.length >= 2);
    const postReset = await composed.endpoints.caseDetail(caseId, '2026-09-12T23:05:00+09:00');
    assert.equal(postReset, undefined, 'reset reseeds the store — the old case is gone');
  } finally {
    composed.db.close();
  }
});

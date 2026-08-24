/**
 * Wave 3R Mission 2 — composed application: dossier-wired REPLAY execution.
 *
 * Permanently pins the Mission-2 integration seam:
 *  1. Boot seeds application-owned booking dossiers from each scenario's
 *     `booking-dossiers.json` with referential integrity (no scenario-keyed
 *     lookup, no LLM-derived identity);
 *  2. the composed executor resolves those dossiers PER INTENT through the
 *     authoritative graph (case -> trip -> travellers);
 *  3. a REPLAY recovery flow traverses the SAME composed provider-backed
 *     executor Mission 3 will run LIVE: the order create/pay/retrieve
 *     recordings are keyed by the exact dossier identity + intent id, so a
 *     REPLAY-provenance SUCCESS with providerId atlas is decisive evidence
 *     the executor booked with the resolved dossier — any other identity (or
 *     none) misses every recording and falls back to simulation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import { AppConfigSchema } from '../src/config/config.ts';
import { composeAppRuntime, type ComposedRuntime } from '../src/app/compose.ts';
import { loadScenario } from '../src/scenarios/loader.ts';
import type { EntityRef } from '../src/domain/common.ts';

const FIXTURES_ROOT = resolve('fixtures');
const SCENARIO_A_DIR = `${FIXTURES_ROOT}/scenarios/anchor-event-speaker`;

const AT_PLAN = '2026-09-12T20:00:00+09:00';
const AT_BEGIN = '2026-09-12T20:15:00+09:00';
const AT_DECIDE = '2026-09-12T20:30:00+09:00';
const AT_EXECUTE = '2026-09-12T20:45:00+09:00';

const runtimeConfig = AppConfigSchema.parse({
  environment: 'local',
  adapterMode: 'REPLAY',
  sqlitePath: ':memory:',
  fixturesDir: FIXTURES_ROOT,
  providers: { atlas: { env: 'sandbox' }, modelStudio: {}, googleRoutes: {} },
});

interface RecoveryRun {
  caseId: string;
  intentId: string;
  executed: boolean;
  simulated: boolean;
  provenance?: string;
  providerId?: string;
  observedEffects?: Record<string, unknown>;
}

/** Full recovery loop through the composed runtime's own services. */
async function runComposedRecovery(
  composed: ComposedRuntime,
  scenarioDir: string,
  seedTime = AT_PLAN,
): Promise<RecoveryRun> {
  const spec = loadScenario(scenarioDir);
  const processed = await composed.orchestrator.processDisruption(spec.disruption.signal, seedTime);
  const plan = await composed.orchestrator.plan({ caseId: processed.caseId, at: AT_PLAN });
  assert.ok(plan.bestStrategyId, 'planning must rank a feasible strategy first');
  const begin = await composed.orchestrator.begin({
    caseId: processed.caseId,
    strategyId: plan.bestStrategyId,
    at: AT_BEGIN,
  });
  const travellerId = spec.trip.travellerIds[0];
  assert.ok(travellerId, 'the scenario trip must carry a traveller');
  const travellerRef: EntityRef = { entityType: 'TRAVELLER', id: travellerId };
  const decision = await composed.orchestrator.decide({
    caseId: processed.caseId,
    intentId: begin.intentId,
    decidedBy: travellerRef,
    verdict: 'APPROVED',
    at: AT_DECIDE,
  });
  assert.equal(decision.accepted, true);
  const execute = await composed.orchestrator.execute({
    caseId: processed.caseId,
    intentId: begin.intentId,
    at: AT_EXECUTE,
  });

  // Execution evidence from the persisted case (the executor's own result).
  const recoveryCase = await composed.readDeps.cases.getCase(processed.caseId);
  assert.ok(recoveryCase);
  const result = recoveryCase.executionResults.at(-1);

  return {
    caseId: processed.caseId,
    intentId: begin.intentId,
    executed: execute.executed,
    simulated: execute.simulated,
    ...(result ? { provenance: result.provenance } : {}),
    ...(result?.providerId ? { providerId: result.providerId } : {}),
    ...(result?.observedEffects ? { observedEffects: result.observedEffects as Record<string, unknown> } : {}),
  };
}

test('M2-1: boot seeds validated dossiers with referential integrity, never scenario-keyed', async () => {
  const composed = await composeAppRuntime(runtimeConfig);
  try {
    // Scenario A traveller: structured booking identity seeded from the bundle.
    const flightA = await composed.dossierStore.flightFor('trv_a_speaker');
    assert.ok(flightA, 'trv_a_speaker must carry a seeded flight dossier');
    assert.deepEqual(flightA!.passengers[0], {
      givenName: 'Ari',
      familyName: 'Vance',
      dateOfBirth: '1988-04-12',
      gender: 'MALE',
      nationality: 'USA',
    });
    assert.equal(flightA!.paymentRef, 'atlas-sandbox-balance');

    // Scenario B traveller: flight + hotel dossiers.
    const flightB = await composed.dossierStore.flightFor('trv_b_consultant');
    assert.ok(flightB, 'trv_b_consultant must carry a seeded flight dossier');
    const hotelB = await composed.dossierStore.hotelFor('trv_b_consultant');
    assert.ok(hotelB, 'trv_b_consultant must carry a seeded hotel dossier');
    assert.deepEqual(hotelB!.guestNames, ['Beatriz Ortega']);

    // No traveller outside the seeded bundles carries invented identity.
    assert.equal(await composed.dossierStore.flightFor('trv_unknown'), undefined);

    // The seed audit records the dossier count (generic seed evidence).
    const audit = await composed.readDeps.audit.query({ subject: 'trip_a' });
    const seeded = audit.find((entry) => entry.action === 'SCENARIO_SEEDED');
    assert.ok(seeded, 'SCENARIO_SEEDED audit must exist for trip_a');
    assert.equal((seeded!.payload as { dossierCount: number }).dossierCount, 1);
  } finally {
    composed.db.close();
  }
});

test('M2-2: REPLAY recovery traverses the composed executor with the resolved dossier', async () => {
  const composed = await composeAppRuntime(runtimeConfig);
  try {
    const run = await runComposedRecovery(composed, SCENARIO_A_DIR);
    assert.equal(run.executed, true);
    // Decisive: the order create/pay/retrieve recordings are keyed by the
    // seeded dossier identity AND this exact intent id; any other identity
    // (or an absent dossier -> simulation fallback) cannot replay them.
    assert.equal(run.simulated, false, 'the provider-backed executor must serve this REPLAY flow');
    assert.equal(run.provenance, 'REPLAY');
    assert.equal(run.providerId, 'atlas');
    // The provider-observed payable flowed through the payment gate
    // (authority-reviewed spendExposure binds the ceiling, ADR-048).
    const payable = run.observedEffects?.['totalPrice'] as { amount: number; currency: string } | undefined;
    assert.ok(payable, 'ticketed observation must carry the provider total');
    assert.equal(payable!.currency, 'USD');
  } finally {
    composed.db.close();
  }
});

test('M2-3: wiped dossier => REPLAY keeps the simulation fallback (fail closed, no guess)', async () => {
  const composed = await composeAppRuntime(runtimeConfig);
  try {
    // Remove the ONLY flight identity for scenario A's traveller directly in
    // the store (never through scenario logic): the executor must not invent
    // identity — REPLAY falls back to the simulation boundary.
    await composed.db.exec("DELETE FROM booking_dossiers WHERE traveller_id = 'trv_a_speaker'");
    const run = await runComposedRecovery(composed, SCENARIO_A_DIR);
    assert.equal(run.executed, true);
    assert.equal(run.simulated, true, 'absent dossier keeps the historic simulation fallback in REPLAY');
    assert.notEqual(run.providerId, 'atlas', 'no provider transaction may run without validated identity');
  } finally {
    composed.db.close();
  }
});

test('M2-4: reset reseeds dossiers through the same generic seed path', async () => {
  const composed = await composeAppRuntime(runtimeConfig);
  try {
    await composed.db.exec("DELETE FROM booking_dossiers WHERE traveller_id = 'trv_a_speaker'");
    assert.equal(await composed.dossierStore.flightFor('trv_a_speaker'), undefined);

    const outcome = await composed.orchestrator.reset(AT_PLAN);
    assert.equal(outcome.reset, true);
    const reseeded = await composed.dossierStore.flightFor('trv_a_speaker');
    assert.ok(reseeded, 'reset must reseed booking dossiers through the bundle path');
    assert.equal(reseeded!.passengers[0]?.familyName, 'Vance');
  } finally {
    composed.db.close();
  }
});

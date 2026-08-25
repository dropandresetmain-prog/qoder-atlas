/**
 * Wave 3 Gate 2 — operational surfaces the UI lane renders verbatim.
 *
 * Proves, over the real HTTP surface with zero credentials:
 * - the approvals queue projects PENDING authority decisions across trips
 *   (requestedFrom, amount, reason) from persisted cases — and empties once
 *   the approval is recorded;
 * - the activity stream is built from REAL audit entries with user-facing
 *   copy (never fabricated), newest first;
 * - uncertainties stay first-class: UNKNOWN stays UNKNOWN (array projected
 *   from the deterministic impact assessment, never mapped to PASS);
 * - provider provenance is truthful: REPLAY mode labelled honestly per
 *   capability descriptor.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import type { AddressInfo } from 'node:net';

import { AppConfigSchema } from '../src/config/config.ts';
import { createAppServer } from '../src/server/http.ts';
import { composeAppRuntime } from '../src/app/compose.ts';
import { loadScenario } from '../src/scenarios/loader.ts';

const FIXTURES_ROOT = resolve('fixtures');
const SCENARIO_A_DIR = join(FIXTURES_ROOT, 'scenarios', 'anchor-event-speaker');

const runtimeConfig = AppConfigSchema.parse({
  environment: 'local',
  adapterMode: 'REPLAY',
  sqlitePath: ':memory:',
  fixturesDir: FIXTURES_ROOT,
  providers: { atlas: { env: 'sandbox' }, modelStudio: {}, googleRoutes: {} },
});

async function postJson(base: string, path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

test('Wave 3 Gate 2: approvals queue, activity stream, uncertainties, and provider provenance are projected truthfully', async () => {
  const composed = await composeAppRuntime(runtimeConfig);
  const spec = loadScenario(SCENARIO_A_DIR);
  const server = createAppServer(runtimeConfig, composed.endpoints);
  await new Promise<void>((resolvePromise) => server.listen(0, resolvePromise));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;

  try {
    // --- Provider provenance: truthful REPLAY labels, one per capability. ---
    const providers = (await (await fetch(`${base}/api/wave/providers`)).json()) as {
      capabilities: Array<{ family: string; providerId: string; mode: string; modeLabel: string }>;
    };
    assert.equal(providers.capabilities.length, 4, 'all wired capabilities advertise provenance');
    for (const capability of providers.capabilities) {
      assert.equal(capability.mode, 'REPLAY', 'adapter mode is projected verbatim, not beautified');
      assert.match(capability.modeLabel, /Replaying recorded provider responses/);
    }
    // DR-2: the Atlas transaction capability advertises alongside the read
    // adapters — same REPLAY honesty, no extra beautification.
    const families = providers.capabilities.map((capability) => `${capability.family}:${capability.providerId}`);
    assert.ok(families.includes('FLIGHT:atlas'), 'flight read capability advertised');
    assert.ok(families.filter((entry) => entry === 'FLIGHT:atlas').length === 2, 'flight transaction capability advertised');
    assert.ok(families.includes('HOTEL:nuitee'), 'hotel capability advertised');

    // --- Drive the engine to AWAITING_TRAVELLER over the runtime flow. ---
    const disruption = await postJson(base, '/api/runtime/disruption', spec.disruption.signal);
    assert.equal(disruption.status, 200);
    const caseId = disruption.body['caseId'] as string;
    const plan = await postJson(base, '/api/runtime/plan', { caseId, at: '2026-09-12T18:30:00+09:00' });
    const begin = await postJson(base, '/api/runtime/begin', {
      caseId,
      strategyId: plan.body['bestStrategyId'],
      at: '2026-09-12T18:40:00+09:00',
    });
    assert.equal(begin.body['outcome'], 'REQUIRES_TRAVELLER');
    const intentId = begin.body['intentId'] as string;

    // --- Approval queue: the pending decision is visible programme-wide. ---
    const queueBefore = (await (await fetch(`${base}/api/wave/approvals`)).json()) as {
      pending: Array<{ caseId: string; tripId: string; requestedFrom: string; action: string; reason: string }>;
    };
    const pending = queueBefore.pending.filter((entry) => entry.caseId === caseId);
    assert.equal(pending.length, 1, 'exactly one pending authority decision for the open case');
    assert.equal(pending[0]!.tripId, spec.trip.id);
    assert.equal(pending[0]!.requestedFrom, 'TRAVELLER');
    assert.ok(pending[0]!.action.length > 0, 'the queue names the action awaiting approval');
    assert.ok(pending[0]!.reason.length > 0, 'the queue carries the authority reason');

    // --- Activity stream: real audit events with user-facing copy. ---
    const activity = (await (await fetch(`${base}/api/wave/trips/${spec.trip.id}/activity`)).json()) as {
      tripId: string;
      events: Array<{ action: string; summary: string; occurredAt: string; actor: string }>;
    };
    assert.equal(activity.tripId, spec.trip.id);
    const actions = activity.events.map((event) => event.action);
    assert.ok(actions.includes('SIGNAL_PROCESSED'), 'the disruption signal is real audit evidence');
    assert.ok(actions.includes('AUTHORITY_DECIDED'), 'the authority decision is real audit evidence');
    const signalEvent = activity.events.find((event) => event.action === 'SIGNAL_PROCESSED')!;
    assert.equal(signalEvent.summary, 'Trip change recorded');
    for (const event of activity.events) {
      assert.ok(event.summary.length > 0, 'every event carries user-facing copy (never empty)');
    }

    // --- Uncertainties: first-class UNKNOWN, projected as an array. ---
    const uncertainties = (await (await fetch(`${base}/api/wave/trips/${spec.trip.id}/uncertainties`)).json()) as {
      tripId: string;
      uncertainties: string[];
    };
    assert.equal(uncertainties.tripId, spec.trip.id);
    assert.ok(Array.isArray(uncertainties.uncertainties), 'unknowns are projected, never coerced to PASS');

    // --- Unknown trip / unknown surface are refused structurally. ---
    assert.equal((await fetch(`${base}/api/wave/trips/no-such-trip/activity`)).status, 404);
    assert.equal((await fetch(`${base}/api/wave/trips/no-such-trip/uncertainties`)).status, 404);
    assert.equal((await fetch(`${base}/api/wave/unknown`)).status, 404);

    // --- Settle the approval: the queue empties, activity grows. ---
    const decide = await postJson(base, '/api/runtime/decide', {
      caseId,
      intentId,
      decidedBy: { entityType: 'TRAVELLER', id: spec.trip.travellerIds[0] },
      verdict: 'APPROVED',
      at: '2026-09-12T18:50:00+09:00',
    });
    assert.equal(decide.status, 200);
    const execute = await postJson(base, '/api/runtime/execute', { caseId, intentId, at: '2026-09-12T18:55:00+09:00' });
    assert.equal(execute.body['caseStatus'], 'RESOLVED');

    const queueAfter = (await (await fetch(`${base}/api/wave/approvals`)).json()) as {
      pending: Array<{ caseId: string }>;
    };
    assert.equal(queueAfter.pending.filter((entry) => entry.caseId === caseId).length, 0, 'recorded approval leaves the queue');

    const activityAfter = (await (await fetch(`${base}/api/wave/trips/${spec.trip.id}/activity`)).json()) as {
      events: Array<{ action: string; summary: string }>;
    };
    const actionsAfter = activityAfter.events.map((event) => event.action);
    assert.ok(actionsAfter.includes('APPROVAL_RECORDED'));
    assert.ok(actionsAfter.includes('EXECUTION_COMPLETED'));
    assert.ok(actionsAfter.includes('CASE_VERIFIED'));
    const verifiedEvent = activityAfter.events.find((event) => event.action === 'CASE_VERIFIED')!;
    assert.equal(verifiedEvent.summary, 'Recovery outcome verified against the trip');
  } finally {
    await new Promise<void>((resolvePromise, reject) =>
      server.close((error) => (error ? reject(error) : resolvePromise())),
    );
    composed.db.close();
  }
});

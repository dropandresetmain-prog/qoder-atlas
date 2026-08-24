/**
 * Wave 3 Gate 7 — deterministic demo reset/seed/reseed at programme scale.
 *
 * Proves, over the SAME composed runtime (zero credentials):
 * - boot composition seeds the scenario bundles AND the programme bundle
 *   (~42 travellers) through the same validated services the HTTP surface
 *   uses — no scenario-specific or programme-specific boot logic;
 * - reset() wipes EVERYTHING (trips, signals, cases, programme entities)
 *   and reseeds the identical starting state: same trips, same programme
 *   rollup, no open cases, no residue from any case flow;
 * - reseed is idempotent: two resets produce byte-identical trip rows and
 *   the same programme view;
 * - replay reliability: the recovery loop behaves identically across
 *   reset/re-run cycles.
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

test('Wave 3 Gate 7: boot seed, deterministic reset/reseed at programme scale, no residue', async () => {
  const composed = await composeAppRuntime(runtimeConfig);
  const spec = loadScenario(SCENARIO_A_DIR);
  const server = createAppServer(runtimeConfig, composed.endpoints);
  await new Promise<void>((resolvePromise) => server.listen(0, resolvePromise));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;

  try {
    // --- Boot seed: scenarios + programme, one composition, no surgery. ----
    assert.ok(composed.seededScenarioIds.length >= 2, 'scenario bundles seeded at boot');
    assert.equal(composed.seededProgrammes.length, 1, 'the programme bundle seeded at boot');
    // DR-9: the synthetic-summit programme carries the full 67-speaker
    // cohort (42 requiring Northstar-arranged travel, 25 local/self-arranged)
    // — every speaker is promoted to a Traveller + Trip regardless of travel
    // need (ProgrammeService.promoteOne creates one Trip per draft), so the
    // promoted cohort and programme rollup total are both 67, not 42.
    assert.equal(composed.seededProgrammes[0]!.promotedCount, 67, 'the demo programme carries the full 67-speaker cohort');

    const programmeEventId = composed.seededProgrammes[0]!.anchorEventId;
    const bootView = (await (await fetch(`${base}/api/programme/${programmeEventId}?at=${encodeURIComponent('2026-09-01T00:00:00+00:00')}`)).json()) as {
      summary: { total: number };
      travellers: Array<{ tripId: string }>;
    };
    assert.equal(bootView.summary.total, 67, 'programme rollup projects the seeded 67-speaker cohort');

    function tripRows(): Array<{ id: string; data: string }> {
      return composed.db.prepare('SELECT id, data FROM trips ORDER BY id').all() as Array<{ id: string; data: string }>;
    }
    const bootFingerprint = JSON.stringify(tripRows());
    // Derived, not hardcoded: however many trips boot seeding actually
    // produced (scenario bundle trips + one Trip per promoted speaker) is the
    // ground truth reset must reproduce exactly.
    const bootTripCount = tripRows().length;

    // --- Dirty the state with a real recovery flow (Case B residue). --------
    const disruption = await postJson(base, '/api/runtime/disruption', spec.disruption.signal);
    assert.equal(disruption.status, 200);
    const caseId = disruption.body['caseId'] as string;
    const plan = await postJson(base, '/api/runtime/plan', { caseId, at: '2026-09-12T18:30:00+09:00' });
    const begin = await postJson(base, '/api/runtime/begin', { caseId, strategyId: plan.body['bestStrategyId'], at: '2026-09-12T18:40:00+09:00' });
    await postJson(base, '/api/runtime/decide', {
      caseId,
      intentId: begin.body['intentId'],
      decidedBy: { entityType: 'TRAVELLER', id: spec.trip.travellerIds[0] },
      verdict: 'APPROVED',
      at: '2026-09-12T18:50:00+09:00',
    });
    const execute = await postJson(base, '/api/runtime/execute', { caseId, intentId: begin.body['intentId'], at: '2026-09-12T18:55:00+09:00' });
    assert.equal(execute.body['caseStatus'], 'RESOLVED');

    // Fan-out residue: a commitment change opens cases across the programme.
    const fanOut = await postJson(base, '/api/programme/commitment-change', {
      signal: {
        id: `sig-${programmeEventId}-gate7`,
        kind: 'ANCHOR_COMMITMENT_CHANGE',
        occurredAt: '2026-09-05T10:00:00+00:00',
        receivedAt: '2026-09-05T10:05:00+00:00',
        sourceId: `src-${programmeEventId}`,
        authority: 'AUTHORITATIVE',
        payload: {
          anchorEventId: programmeEventId,
          commitmentId: `cmt-${programmeEventId}-opening`,
          changeKind: 'RESCHEDULED',
          newStartsAt: '2026-09-08T10:00:00+08:00',
          newEndsAt: '2026-09-08T12:00:00+08:00',
        },
      },
    });
    assert.equal(fanOut.status, 200);
    const stateDirty = (await (await fetch(`${base}/api/runtime/state`)).json()) as { openCases: unknown[] };
    assert.ok(stateDirty.openCases.length > 0, 'state is genuinely dirty before reset');

    // --- Reset: one endpoint restores the exact pristine demo. --------------
    const reset1 = await postJson(base, '/api/runtime/reset', { at: '2026-09-12T23:00:00+09:00' });
    assert.equal(reset1.status, 200);
    assert.ok((reset1.body['seededProgrammes'] as Array<{ promotedCount: number }>).every((entry) => entry.promotedCount === 67));

    const stateAfterReset = (await (await fetch(`${base}/api/runtime/state`)).json()) as {
      trips: Array<{ tripId: string }>;
      openCases: unknown[];
    };
    assert.equal(stateAfterReset.openCases.length, 0, 'no case residue survives reset');
    assert.equal(stateAfterReset.trips.length, bootTripCount, 'scenario trips + 67-speaker programme reseeded identically to boot');
    const oldCase = await fetch(`${base}/api/cases/${caseId}`);
    assert.equal(oldCase.status, 404, 'the recovery case is gone after reset');

    // Programme state itself reseeded — the rollup matches the boot view.
    const viewAfterReset = (await (await fetch(`${base}/api/programme/${programmeEventId}?at=${encodeURIComponent('2026-09-01T00:00:00+00:00')}`)).json()) as {
      summary: { total: number };
    };
    assert.equal(viewAfterReset.summary.total, bootView.summary.total);

    // Idempotence: two resets yield byte-identical authoritative trip rows.
    await postJson(base, '/api/runtime/reset', { at: '2026-09-13T00:00:00+09:00' });
    assert.equal(JSON.stringify(tripRows()), bootFingerprint, 'reset is deterministic — identical reseed');

    // --- Replay reliability: the same loop completes again post-reset. ------
    const rerun = await postJson(base, '/api/runtime/disruption', spec.disruption.signal);
    assert.equal(rerun.status, 200);
    const rerunCaseId = rerun.body['caseId'] as string;
    assert.equal(rerunCaseId, caseId, 'identical signal replays to the identical case id');
    const rerunPlan = await postJson(base, '/api/runtime/plan', { caseId: rerunCaseId, at: '2026-09-12T18:30:00+09:00' });
    // Strategy ids are per-run UUIDs; the deterministic replay evidence is the
    // candidate SET: same summaries, same feasibility verdicts, same order.
    const strategyShape = (body: Record<string, unknown>) =>
      JSON.stringify(
        (body['strategies'] as Array<{ summary: string; feasible: boolean; rejectionReasons: string[] }>).map(
          (strategy) => ({ summary: strategy.summary, feasible: strategy.feasible, rejectionReasons: strategy.rejectionReasons }),
        ),
      );
    assert.equal(strategyShape(rerunPlan.body), strategyShape(plan.body), 'replay plans an equivalent strategy set');
    const bestSummary = (body: Record<string, unknown>) =>
      (body['strategies'] as Array<{ id: string; summary: string }>).find((s) => s.id === body['bestStrategyId'])?.summary;
    assert.equal(bestSummary(rerunPlan.body), bestSummary(plan.body), 'replay ranks the same best strategy');
  } finally {
    await new Promise<void>((resolvePromise, reject) =>
      server.close((error) => (error ? reject(error) : resolvePromise())),
    );
    composed.db.close();
  }
});

/**
 * R3 live product closure — user-facing contracts (not route-exists-only).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { AppConfigSchema } from '../src/config/config.ts';
import { composeAppRuntime } from '../src/app/compose.ts';
import { createAppServer } from '../src/server/http.ts';
import { STATUS_LABEL } from '../src/ui/copy.ts';
import { renderOperatorDashboardBody } from '../src/ui/screens/operator-dashboard.ts';
import { projectJourneyChain, projectOperatorDashboard } from '../src/app/readmodels.ts';
import { selectRecoveryCommitment } from '../src/app/chainProjection.ts';
import { projectDecisionsPage } from '../src/app/decisionsPresentation.ts';
import type { OperatorDashboardView } from '../src/contracts/readmodels.ts';

const FIXTURES = resolve('fixtures');
const EVENT = 'evt-ait-2026';
const AT = '2026-09-21T09:00:00+08:00';

const demoConfig = AppConfigSchema.parse({
  environment: 'demo',
  worldSeedMode: 'programme',
  adapterMode: 'REPLAY',
  sqlitePath: ':memory:',
  fixturesDir: FIXTURES,
  providers: { atlas: { env: 'sandbox' }, modelStudio: {}, googleRoutes: {}, nuitee: {} },
});

async function withPopulatedWorld(
  run: (ctx: Awaited<ReturnType<typeof composeAppRuntime>> & { base: string }) => Promise<void>,
): Promise<void> {
  const composed = await composeAppRuntime(demoConfig);
  const server = createAppServer(demoConfig, composed.endpoints);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const reset = await fetch(`${base}/api/demo/reset`, { method: 'POST' });
    assert.equal(reset.status, 200);
    await run({ ...composed, base });
  } finally {
    await new Promise<void>((done, fail) => server.close((error) => (error ? fail(error) : done())));
    composed.db.close();
  }
}

test('READY operator copy is Confirmed', () => {
  assert.equal(STATUS_LABEL.READY, 'Confirmed');
});

test('dashboard readout uses managed denominator from arrangement counts', () => {
  const view: OperatorDashboardView = {
    generatedAt: AT,
    summary: { ready: 30, atRisk: 2, disrupted: 4, recovering: 3, awaitingDecision: 2, managedConfirmed: 28 },
    arrangementCounts: { total: 67, northstarArranged: 42, selfOrOtherArranged: 25, unspecified: 0 },
    trips: Array.from({ length: 67 }, (_, i) => ({
      tripId: `trip-${i}`,
      travellerNames: [`Traveller ${i}`],
      status: i < 28 ? 'READY' : 'DISRUPTED',
      travelArrangement: i < 42 ? 'NORTHSTAR_ARRANGED' : 'SELF_OR_OTHER_ARRANGED',
      affectedItems: [],
      systemActivity: [],
      pendingDecisions: [],
      uncertainties: [],
      updatedAt: AT,
    })),
  };
  const html = renderOperatorDashboardBody(view);
  assert.match(html, /28<span class="unit">\/42<\/span>/);
  assert.match(html, /42 Northstar-managed · 25 local\/self · 67 participants/);
  assert.equal((html.match(/class="dotgrid"[\s\S]*?<\/div>/i)?.[0]?.match(/<i /g) ?? []).length, 67);
  assert.match(html, /l-unconfirmed/);
  assert.match(html, /l-local/);
  assert.match(html, /data-test="roster-search"/);
  assert.match(html, /data-page-size="10"/);
  assert.match(html, /data-test="roster-pagination"/);
  assert.doesNotMatch(html, /Recovery under way/);
  assert.match(html, />Needs Attention</);
});

test('active-case roster row links to case and offers Show interaction', () => {
  const view: OperatorDashboardView = {
    generatedAt: AT,
    summary: { ready: 0, atRisk: 0, disrupted: 1, recovering: 0, awaitingDecision: 0, managedConfirmed: 0 },
    arrangementCounts: { total: 1, northstarArranged: 1, selfOrOtherArranged: 0, unspecified: 0 },
    trips: [
      {
        tripId: 'trip-a',
        activeCaseId: 'case-a',
        travellerNames: ['Jordan Hale'],
        status: 'RECOVERING',
        affectedItems: [],
        systemActivity: [],
        pendingDecisions: [],
        uncertainties: [],
        updatedAt: AT,
      },
    ],
  };
  const html = renderOperatorDashboardBody(view);
  assert.match(html, /href="\/operator\/cases\/case-a"/);
  assert.match(html, /data-test="show-interaction"/);
  assert.match(html, /href="\/traveller\?trip=trip-a"/);
  assert.doesNotMatch(html, /Recovery case/);
});

test('populated AiT world projects 67 / 42 / 25 arrangement counts', async () => {
  await withPopulatedWorld(async ({ readDeps }) => {
    const view = await projectOperatorDashboard(readDeps, AT, { anchorEventId: EVENT });
    assert.equal(view.trips.length, 67);
    assert.equal(view.arrangementCounts.total, 67);
    assert.equal(view.arrangementCounts.northstarArranged, 42);
    assert.equal(view.arrangementCounts.selfOrOtherArranged, 25);
  });
});

test('journey chain collapses multi-commitment travellers to one commitment link', async () => {
  await withPopulatedWorld(async ({ readDeps }) => {
    const view = await projectOperatorDashboard(readDeps, AT, { anchorEventId: EVENT });
    const elena = view.trips.find((t) => t.travellerNames.some((n) => n.includes('Elena')));
    assert.ok(elena, 'Elena Tan should be in roster');
    const trip = await readDeps.snapshot.trips.getTrip(elena!.tripId);
    assert.ok(trip);
    const engagements = trip!.elements.filter((e) => e.elementKind === 'ENGAGEMENT');
    assert.ok(engagements.length > 3, 'Elena fixture should have many engagements');
    const chain = await projectJourneyChain(readDeps, trip!);
    assert.equal(chain.filter((l) => l.commitment).length, 1);
    assert.ok(selectRecoveryCommitment(trip!));
  });
});

test('decisions page pending count matches overview pending decisions for event scope', async () => {
  await withPopulatedWorld(async ({ readDeps }) => {
    const dashboard = await projectOperatorDashboard(readDeps, AT, { anchorEventId: EVENT });
    const overviewPending = dashboard.trips.reduce((n, t) => n + t.pendingDecisions.length, 0);
    const decisions = await projectDecisionsPage(readDeps, AT, { anchorEventId: EVENT });
    assert.equal(decisions.pending.length, overviewPending);
    assert.ok(decisions.pending.length > 0, 'populated world should expose pending authority decisions');
  });
});

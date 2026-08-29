/**
 * Focused evidence for the Jordan S2 sequential overnight-hotel closure.
 *
 * Proves, against the composed runtime in REPLAY:
 *  - the programme seeds Jordan's hotel booking dossier;
 *  - the Narita Gateway provider place survives seeding;
 *  - the ONE organiser approval of the flight recovery deterministically
 *    covers the internally-sequential Narita hotel action too — no second
 *    human decision is asked for it;
 *  - the SAME /api/runtime/execute call that runs the flight rebooking also
 *    carries the case through the still-required overnight hotel booking to
 *    FULLY_RECOVERED, internally: flight ActionIntent -> observe -> hotel
 *    ActionIntent (its own deterministic, envelope-covered AuthorityDecision)
 *    -> observe -> verify;
 *  - the whole-trip plan shows the Singapore stay as 'No change required'
 *    and the Narita hotel as Confirmed, with separate flight+hotel costs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';

import { AppConfigSchema } from '../src/config/config.ts';
import { createAppServer } from '../src/server/http.ts';
import { composeAppRuntime } from '../src/app/compose.ts';
import { runAcceptanceManifest } from '../src/acceptance/runner.ts';

const FIXTURES_ROOT = resolve('fixtures');
const CWD = resolve('.');
const TRIP = 'trip-trv-evt-ait-2026-ait-draft-09';
const TRAVELLER = 'trv-evt-ait-2026-ait-draft-09';

const demoConfig = AppConfigSchema.parse({
  environment: 'demo',
  worldSeedMode: 'programme',
  adapterMode: 'REPLAY',
  sqlitePath: ':memory:',
  fixturesDir: FIXTURES_ROOT,
  providers: { atlas: { env: 'sandbox' }, modelStudio: {}, googleRoutes: {}, nuitee: {} },
});

async function getJson(base: string, path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${base}${path}`);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

test('Jordan S2 overnight-hotel closure', async () => {
  const composed = await composeAppRuntime(demoConfig);
  const server = createAppServer(demoConfig, composed.endpoints);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    // 1. Programme hotel dossier seeding.
    const hotelDossier = await composed.dossierStore.hotelFor(TRAVELLER);
    assert.ok(hotelDossier, 'Jordan hotel dossier is seeded from the programme bundle');
    assert.deepEqual(hotelDossier.guestNames, ['Jordan Hale']);

    // 2. The Narita Gateway provider place survives seeding.
    const naritaEntry = await composed.readDeps.snapshot.entities.get('PLACE', 'place-hotel-narita-gateway');
    assert.ok(naritaEntry && naritaEntry.entityType === 'PLACE', 'Narita Gateway place is seeded');
    assert.ok(
      (naritaEntry.entity.externalRefs ?? []).some(
        (ref) => ref.system === 'nuitee-hotel-id' && ref.value === 'lp3a92f',
      ),
      'Narita Gateway place carries the Nuitée provider ref',
    );

    // 3. Drive the whole S2 flow in ONE pass. The organiser's single approval
    //    of the flight recovery deterministically covers the internally-
    //    sequential Narita hotel action too: the manifest's single
    //    "execute_recovery" step is asserted to resolve FULLY_RECOVERED
    //    directly — there is no separate plan/begin/decide/execute cycle for
    //    the hotel visible at the API boundary.
    const full = await runAcceptanceManifest({
      manifestPath: 'fixtures/acceptance/manifests/s2-missed-connection.json',
      cwd: CWD,
      baseUrl: base,
      skipPreflight: true,
      config: demoConfig,
      skipAssertions: false,
      evidenceDir: resolve('output', 's2-overnight-closure-test'),
    });
    const failed = full.evidence.steps.filter((s) => !s.ok);
    assert.equal(failed.length, 0, `S2 flow steps pass: ${JSON.stringify(failed)}`);

    const missedFlightStep = full.evidence.steps.find((s) => s.stepId === 'traveller_report_missed_connection');
    const caseId = (missedFlightStep?.response as { caseId?: string } | undefined)?.caseId;
    assert.ok(caseId, 'Jordan has a recovery case');

    // 4. The case resolves FULLY_RECOVERED and the trip is viable.
    const finalCase = await getJson(base, `/api/cases/${caseId}`);
    assert.equal(finalCase.body.status, 'RESOLVED', 'case resolves after the single execute call');
    const trip = await getJson(base, `/api/traveller/${TRIP}`);
    assert.equal(trip.body.remainderViable, 'VIABLE', 'trip is viable after the overnight is covered');

    server.close();
  } catch (error) {
    server.close();
    throw error;
  }
});

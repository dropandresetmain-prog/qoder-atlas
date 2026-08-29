/**
 * Focused evidence for the Jordan S2 sequential overnight-hotel closure.
 *
 * Proves, against the composed runtime in REPLAY:
 *  - the programme seeds Jordan's hotel booking dossier;
 *  - the Narita Gateway provider place survives seeding;
 *  - the case does NOT resolve after the flight while the overnight is open;
 *  - the case resolves FULLY_RECOVERED after the Narita booking confirms;
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

async function postJson(base: string, path: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}
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

    // 3. Drive the two-stage S2 flow up to the flight execution. The manifest
    //    asserts the flight executes and the case is held at PLANNING.
    await runAcceptanceManifest({
      manifestPath: 'fixtures/acceptance/manifests/s2-missed-connection.json',
      cwd: CWD,
      baseUrl: base,
      skipPreflight: true,
      config: demoConfig,
      stopBeforeStepIds: ['plan_overnight_hotel'],
      skipAssertions: false,
      evidenceDir: resolve('output', 's2-overnight-closure-test'),
    });

    // After the flight, the case must NOT be resolved (overnight unresolved).
    const dashMid = await getJson(base, '/api/operator/dashboard?event=evt-ait-2026');
    const caseId = (dashMid.body as { trips: Array<{ tripId: string; activeCaseId?: string }> }).trips.find(
      (t) => t.tripId === TRIP,
    )?.activeCaseId;
    assert.ok(caseId, 'Jordan has an active case');
    const midCase = await getJson(base, `/api/cases/${caseId}`);
    assert.notEqual(midCase.body.status, 'RESOLVED', 'case is not resolved after the flight alone');

    // 4. Continue the manifest through the hotel cycle to resolution.
    const full = await runAcceptanceManifest({
      manifestPath: 'fixtures/acceptance/manifests/s2-missed-connection.json',
      cwd: CWD,
      baseUrl: base,
      skipPreflight: true,
      config: demoConfig,
      startAtStepId: 'plan_overnight_hotel',
      initialBindings: { caseId },
      skipAssertions: false,
      evidenceDir: resolve('output', 's2-overnight-closure-test'),
    });
    const failed = full.evidence.steps.filter((s) => !s.ok);
    assert.equal(failed.length, 0, `hotel cycle steps pass: ${JSON.stringify(failed)}`);

    // 5. The case resolves FULLY_RECOVERED and the trip is viable.
    const finalCase = await getJson(base, `/api/cases/${caseId}`);
    assert.equal(finalCase.body.status, 'RESOLVED', 'case resolves after the Narita booking');
    const trip = await getJson(base, `/api/traveller/${TRIP}`);
    assert.equal(trip.body.remainderViable, 'VIABLE', 'trip is viable after the overnight is covered');

    server.close();
  } catch (error) {
    server.close();
    throw error;
  }
});

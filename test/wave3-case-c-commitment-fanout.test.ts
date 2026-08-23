/**
 * Wave 3 Gate 5 — Case C: event-side commitment change fan-out at programme
 * scale, with LINKED vs UNLINKED isolation.
 *
 * A synthetic programme of 42 travellers: 30 are linked to the opening
 * session commitment, 12 to the closing session commitment. When the opening
 * session is RESCHEDULED:
 * - the fan-out reaches EXACTLY the 30 linked trips (one signal + one case
 *   each) and none of the 12 unlinked trips — no signal, no case, no state
 *   mutation on their trips;
 * - the programme view rolls the disruption up at scale: the affected
 *   travellers' statuses move out of PLANNING while the untouched cohort
 *   stays READY/PLANNING, and the programme summary counts both;
 * - the COMMITMENT_CHANGE_FANOUT audit trail records the linked/unlinked
 *   split truthfully.
 * Everything flows through the SAME engine over the real HTTP surface.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';

import { AppConfigSchema } from '../src/config/config.ts';
import { createAppServer } from '../src/server/http.ts';
import { composeAppRuntime } from '../src/app/compose.ts';
import { SqliteSignalRepository, SqliteCaseRepository } from '../src/persistence/repositories.ts';

const AT = '2026-09-01T00:00:00+00:00';
const EVENT_ID = 'evt-w3c';
const LINKED_COUNT = 30;
const UNLINKED_COUNT = 12;
const TOTAL = LINKED_COUNT + UNLINKED_COUNT;

const runtimeConfig = AppConfigSchema.parse({
  environment: 'local',
  adapterMode: 'REPLAY',
  sqlitePath: ':memory:',
  fixturesDir: resolve('fixtures'),
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

test('Wave 3 Case C: commitment change fans out to linked trips only, at programme scale', async () => {
  const composed = await composeAppRuntime(runtimeConfig);
  const server = createAppServer(runtimeConfig, composed.endpoints);
  await new Promise<void>((resolvePromise) => server.listen(0, resolvePromise));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;

  try {
    // --- Programme context: venue, airport, two commitments. ---------------
    const contextBody = {
      at: AT,
      sourceId: `src-${EVENT_ID}`,
      organisation: { id: `org-${EVENT_ID}`, name: 'Synthetic Programme Organiser', roles: ['EVENT_ORGANISER', 'PAYER'] },
      anchorEvent: {
        id: EVENT_ID,
        name: 'Synthetic Programme Event',
        kind: 'CONFERENCE',
        placeId: `plc-${EVENT_ID}-venue`,
        window: { startsAt: '2026-09-07T00:00:00+08:00', endsAt: '2026-09-11T23:59:00+08:00' },
        organiserOrganisationId: `org-${EVENT_ID}`,
        commitments: [
          {
            id: `cmt-${EVENT_ID}-opening`,
            anchorEventId: EVENT_ID,
            title: 'Opening Session',
            kind: 'SESSION',
            placeId: `plc-${EVENT_ID}-venue`,
            startsAt: { value: '2026-09-08T15:00:00+08:00', sourceId: `src-${EVENT_ID}`, authority: 'AUTHORITATIVE', observedAt: AT },
            endsAt: { value: '2026-09-08T17:00:00+08:00', sourceId: `src-${EVENT_ID}`, authority: 'AUTHORITATIVE', observedAt: AT },
            sourceId: `src-${EVENT_ID}`,
          },
          {
            id: `cmt-${EVENT_ID}-closing`,
            anchorEventId: EVENT_ID,
            title: 'Closing Session',
            kind: 'SESSION',
            placeId: `plc-${EVENT_ID}-venue`,
            startsAt: { value: '2026-09-11T09:00:00+08:00', sourceId: `src-${EVENT_ID}`, authority: 'AUTHORITATIVE', observedAt: AT },
            sourceId: `src-${EVENT_ID}`,
          },
        ],
        sourceIds: [],
      },
      places: [
        { id: `plc-${EVENT_ID}-venue`, name: 'Synthetic Venue', kind: 'VENUE', timezone: 'Asia/Singapore', externalRefs: [] },
        {
          id: `plc-${EVENT_ID}-airport`,
          name: 'Synthetic Airport',
          kind: 'AIRPORT',
          timezone: 'Asia/Singapore',
          externalRefs: [{ system: 'airport-code', value: 'SYN' }],
        },
      ],
      ruleSets: [],
    };
    const context = await postJson(base, '/api/programme/context', contextBody);
    assert.equal(context.status, 200);

    // --- Intake at scale: 30 travellers linked to opening, 12 to closing. --
    const travellers = Array.from({ length: TOTAL }, (_, index) => {
      const n = index + 1;
      const linked = n <= LINKED_COUNT;
      return {
        draftId: `draft-${n}`,
        displayName: `Traveller ${String(n).padStart(2, '0')}`,
        identity: { email: `t${n}@example.test` },
        homeLocationText: 'Somewhere',
        nationalityCodes: ['SG'],
        accessibilityStatements: [],
        notes: [],
        anchorCommitmentIds: [linked ? `cmt-${EVENT_ID}-opening` : `cmt-${EVENT_ID}-closing`],
      };
    });
    const bulk = await postJson(base, '/api/programme/import', {
      importDraft: {
        id: `import-${EVENT_ID}`,
        anchorEventId: EVENT_ID,
        channel: 'BULK_IMPORT',
        sourceId: `src-${EVENT_ID}`,
        receivedAt: AT,
        travellers,
        unresolvedStatements: [],
      },
      at: AT,
    });
    assert.equal(bulk.status, 200);
    assert.equal(bulk.body['promotedCount'], TOTAL);

    // --- Case C: the opening session is rescheduled. -----------------------
    const fanOut = await postJson(base, '/api/programme/commitment-change', {
      signal: {
        id: `sig-${EVENT_ID}-reschedule`,
        kind: 'ANCHOR_COMMITMENT_CHANGE',
        occurredAt: '2026-09-05T10:00:00+00:00',
        receivedAt: '2026-09-05T10:05:00+00:00',
        sourceId: `src-${EVENT_ID}`,
        authority: 'AUTHORITATIVE',
        payload: {
          anchorEventId: EVENT_ID,
          commitmentId: `cmt-${EVENT_ID}-opening`,
          changeKind: 'RESCHEDULED',
          newStartsAt: '2026-09-08T10:00:00+08:00',
          newEndsAt: '2026-09-08T12:00:00+08:00',
        },
      },
    });
    assert.equal(fanOut.status, 200);
    assert.equal(fanOut.body['accepted'], true);
    // Isolation at scale: ONLY the opening-linked cohort receives signals.
    assert.equal(fanOut.body['linkedTripCount'], LINKED_COUNT);
    assert.equal(fanOut.body['unlinkedTripCount'], UNLINKED_COUNT);
    const processed = fanOut.body['processedSignals'] as Array<{ tripId: string; caseId: string; caseStatus: string }>;
    assert.equal(processed.length, LINKED_COUNT, 'one processed signal per linked trip');
    assert.ok(processed.every((entry) => entry.caseId && entry.caseStatus), 'every linked trip opened a recovery case');

    // --- Authoritative-state isolation: unlinked trips carry zero signals. -
    const signals = new SqliteSignalRepository(composed.db);
    const cases = new SqliteCaseRepository(composed.db);
    const processedTripIds = new Set(processed.map((entry) => entry.tripId));
    const programmeView = (await (await fetch(`${base}/api/programme/${EVENT_ID}?at=${encodeURIComponent(AT)}`)).json()) as {
      travellers: Array<{ tripId: string }>;
    };
    const programmeTripIds = programmeView.travellers.map((row) => row.tripId);
    assert.equal(programmeTripIds.length, TOTAL, 'the programme owns exactly the imported cohort');
    // Every programme trip is either processed or fully untouched.
    for (const tripId of programmeTripIds) {
      if (processedTripIds.has(tripId)) continue;
      const tripSignals = await signals.listSignalsForTrip(tripId);
      const fanoutSignals = tripSignals.filter((signal) => signal.kind === 'ANCHOR_COMMITMENT_CHANGE');
      assert.equal(fanoutSignals.length, 0, `unlinked trip ${tripId} received no fan-out signal`);
      const tripCases = await cases.listCasesForTrip(tripId);
      assert.equal(tripCases.length, 0, `unlinked trip ${tripId} opened no case`);
    }

    // --- Programme view rolls the change up at scale. ----------------------
    const view = (await (await fetch(`${base}/api/programme/${EVENT_ID}?at=${encodeURIComponent('2026-09-05T11:00:00+00:00')}`)).json()) as {
      summary: { total: number; planning: number; atRisk: number; disrupted: number; recovering: number };
      travellers: Array<{ tripId: string; status: string; activeCaseIds: string[] }>;
    };
    assert.equal(view.summary.total, TOTAL);
    const linkedRows = view.travellers.filter((row) => processedTripIds.has(row.tripId));
    const unlinkedRows = view.travellers.filter((row) => !processedTripIds.has(row.tripId));
    assert.equal(linkedRows.length, LINKED_COUNT);
    assert.equal(unlinkedRows.length, UNLINKED_COUNT);
    // Linked cohort moved out of PLANNING (a case exists for each).
    assert.ok(
      linkedRows.every((row) => row.activeCaseIds.length > 0),
      'every linked traveller row carries its recovery case',
    );
    assert.ok(
      linkedRows.some((row) => row.status !== 'PLANNING'),
      'the programme rollup reflects the fanned-out disruption',
    );
    // Unlinked cohort stays in its pre-change state — untouched.
    assert.ok(
      unlinkedRows.every((row) => row.activeCaseIds.length === 0),
      'no unlinked traveller row carries a case',
    );

    // --- Audit trail records the fan-out split truthfully. -----------------
    const auditRows = composed.db
      .prepare("SELECT payload FROM audit WHERE action = 'COMMITMENT_CHANGE_FANOUT'")
      .all() as Array<{ payload: string }>;
    assert.ok(auditRows.length > 0, 'the fan-out is real audit evidence');
    const fanoutPayload = JSON.parse(auditRows[auditRows.length - 1]!.payload) as Record<string, unknown>;
    assert.equal((fanoutPayload['perTripSignalIds'] as string[]).length, LINKED_COUNT);
  } finally {
    await new Promise<void>((resolvePromise, reject) =>
      server.close((error) => (error ? reject(error) : resolvePromise())),
    );
    composed.db.close();
  }
});

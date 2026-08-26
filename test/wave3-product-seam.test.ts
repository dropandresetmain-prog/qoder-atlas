/**
 * Wave 3 product convergence — integrated product smoke over the REAL seam.
 *
 * One composed runtime (REPLAY, zero credentials), one real HTTP server, and
 * Kimi's approved screens driven exclusively by authoritative Northstar
 * state. No fixtures wired to the truth path, no hardcoded demo values:
 *
 *  - baseline surfaces render real seeded state (operator, programme,
 *    traveller) and carry no fixture-only vocabulary;
 *  - Case B hero: flight cancellation -> plan -> begin -> traveller
 *    approval -> execution -> verified RESOLVED, with the journey chain,
 *    the traveller presentation (commitment card, rich Approve/Decline
 *    options keyed by the exact option strings), and honest provenance;
 *  - Case A: change request -> mixed funding allocation -> approval ->
 *    execution, projected through the same read models;
 *  - Case C: commitment change fans out to linked trips only; the
 *    programme surface rolls the change up at scale;
 *  - settle semantics: `.just-changed` appears ONLY when a rendered value
 *    actually changed between two server renders, never on first render;
 *  - RESET -> baseline is clean again, with no residue from Cases A/B/C.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';

import { AppConfigSchema } from '../src/config/config.ts';
import { createAppServer } from '../src/server/http.ts';
import { composeAppRuntime } from '../src/app/compose.ts';
import { loadScenario } from '../src/scenarios/loader.ts';
import { SqlMutationService } from '../src/engine/mutation.ts';
import { SqliteTripRepository } from '../src/persistence/repositories.ts';
import { SqliteEntityStore } from '../src/persistence/entityStore.ts';
import { FORBIDDEN_UI_TERMS } from '../src/ui/copy.ts';
import type { TransportLeg } from '../src/domain/elements.ts';

const FIXTURES_ROOT = resolve('fixtures');
const SCENARIO_A_DIR = `${FIXTURES_ROOT}/scenarios/anchor-event-speaker`;
const AT = '2026-09-01T00:00:00+00:00';

const runtimeConfig = AppConfigSchema.parse({
  environment: 'local',
  adapterMode: 'REPLAY',
  sqlitePath: ':memory:',
  fixturesDir: FIXTURES_ROOT,
  // Case A's HOM→EVT window-shift corpus lives in the test recordings.
  recordingsDir: 'test/fixtures/recordings',
  providers: { atlas: { env: 'sandbox' }, modelStudio: {}, googleRoutes: {}, nuitee: {} },
});

async function getHtml(base: string, path: string): Promise<{ status: number; html: string }> {
  const response = await fetch(`${base}${path}`);
  return { status: response.status, html: await response.text() };
}

async function postJson(base: string, path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function assertNoJargon(html: string, surface: string): void {
  const lowered = html.toLowerCase();
  for (const term of FORBIDDEN_UI_TERMS) {
    assert.ok(!lowered.includes(term), `jargon "${term}" leaked on ${surface}`);
  }
}

test('Wave 3 product convergence: approved UI runs on the real engine through HTTP', async () => {
  const composed = await composeAppRuntime(runtimeConfig);
  const spec = loadScenario(SCENARIO_A_DIR);
  const server = createAppServer(runtimeConfig, composed.endpoints);
  await new Promise<void>((resolvePromise) => server.listen(0, resolvePromise));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;

  try {
    // ===================================================================
    // BASELINE — real seeded state on every surface
    // ===================================================================
    const dashboard = await getHtml(base, '/operator');
    assert.equal(dashboard.status, 200);
    assert.ok(dashboard.html.includes('Operations overview'), 'dashboard renders from real state');
    assert.ok(dashboard.html.includes('trip_a'), 'the scenario trip is visible on the dashboard');
    assert.ok(!dashboard.html.includes('class="just-changed'), 'first render carries no settle marker (nothing changed yet)');
    assertNoJargon(dashboard.html, '/operator');

    const programmeEventId = composed.seededProgrammes[0]!.anchorEventId;
    const programmePage = await getHtml(base, `/programme?event=${encodeURIComponent(programmeEventId)}&at=${encodeURIComponent(AT)}`);
    assert.equal(programmePage.status, 200);
    assert.ok(programmePage.html.includes('42'), 'the 42-traveller cohort is rendered');
    assertNoJargon(programmePage.html, '/programme');

    const travellerPage = await getHtml(base, `/traveller?trip=${encodeURIComponent(spec.trip.id)}`);
    assert.equal(travellerPage.status, 200);
    // Kimi handoff item 2: the commitment card is built from the trip's
    // engagement + anchor-event evidence (the keynote engagement here).
    assert.ok(travellerPage.html.includes('The reason for the trip'), 'commitment card projected from real engagement evidence');
    assert.ok(travellerPage.html.includes('Opening keynote'), 'commitment title comes from the engagement, not a fixture');
    assert.ok(!travellerPage.html.includes('class="just-changed'), 'no settle marker on the first traveller render');
    assertNoJargon(travellerPage.html, '/traveller');

    // ===================================================================
    // CASE B — hero disruption through the full recovery lifecycle
    // ===================================================================
    const disruption = await postJson(base, '/api/runtime/disruption', spec.disruption.signal);
    assert.equal(disruption.status, 200);
    const caseId = disruption.body['caseId'] as string;
    const plan = await postJson(base, '/api/runtime/plan', { caseId, at: '2026-09-12T18:30:00+09:00' });
    assert.equal(plan.status, 200);
    const strategies = plan.body['strategies'] as Array<{ id: string; feasible: boolean }>;
    assert.ok(strategies.some((s) => s.feasible), 'replay evidence yields viable strategies');

    // Case view: journey chain (handoff item 1) renders the cancelled
    // flight broken and the commitment intact from authoritative state.
    const casePageDuring = await getHtml(base, `/operator/cases/${caseId}`);
    assert.equal(casePageDuring.status, 200);
    assert.ok(casePageDuring.html.includes('The trip as it stands'), 'the chain section renders');
    assert.ok(casePageDuring.html.includes('data-link-state="BROKEN"'), 'the cancelled flight renders broken');
    assert.ok(casePageDuring.html.includes('is-commitment'), 'the commitment link carries the ✦ marker');

    // Settle semantics (DESIGN.md §6.1): trip_a's status changed since the
    // baseline render, so its fleet cell AND roster row carry the marker —
    // and untouched trips carry none.
    const dashboardDuring = await getHtml(base, '/operator');
    const fleetClasses = /<i class="([^"]*)" [^>]*data-fleet-trip="trip_a"/.exec(dashboardDuring.html)?.[1] ?? '';
    assert.ok(fleetClasses.includes('just-changed'), 'the changed trip\'s fleet cell settles');
    const rowClasses = /<(?:div|a)\b[^>]*class="([^"]*)"[^>]*data-trip-id="trip_a"/.exec(dashboardDuring.html)?.[1] ?? '';
    assert.ok(rowClasses.includes('just-changed'), 'the changed trip\'s roster row settles');
    const untouched = /<i class="([^"]*)" [^>]*data-fleet-trip="trip_b"/.exec(dashboardDuring.html)?.[1];
    assert.ok(!untouched?.includes('just-changed'), 'an untouched trip does not settle');
    // A re-render with no new change carries no marker at all.
    const dashboardAgain = await getHtml(base, '/operator');
    assert.ok(
      !/<[^>]*class="just-changed/.test(dashboardAgain.html),
      'no settle marker when nothing changed between renders',
    );

    // Option cards + honest viability verdicts from persisted planning.
    assert.ok(casePageDuring.html.includes('option-card'), 'recovery options render as cards');

    // begin -> traveller approval -> execute.
    const begin = await postJson(base, '/api/runtime/begin', {
      caseId,
      strategyId: plan.body['bestStrategyId'],
      at: '2026-09-12T18:40:00+09:00',
    });
    assert.equal(begin.status, 200);

    // The case view now shows what a human must do (authority ran at begin).
    const casePageApproval = await getHtml(base, `/operator/cases/${caseId}`);
    assert.ok(casePageApproval.html.includes('Approval'), 'the approval requirement is visible once authority has run');

    // Traveller presentation (handoff items 2+3): rich options keyed by the
    // EXACT option strings the input request emits ('Approve'/'Decline').
    const travellerDuring = await getHtml(base, `/traveller?trip=${encodeURIComponent(spec.trip.id)}`);
    assert.equal(travellerDuring.status, 200);
    assert.ok(travellerDuring.html.includes('We need your input'), 'the decision card renders');
    assert.ok(travellerDuring.html.includes('value="APPROVED"'), 'the Approve option button exists');
    assert.ok(travellerDuring.html.includes('value="DECLINED"'), 'the Decline option button exists');
    // Approve carries rich presentation (route, commitment effect, funding);
    // Decline is an honest refusal with no rich detail and renders plain.
    assert.ok(travellerDuring.html.includes('optcard'), 'Approve renders as a rich option card (optionDetails matched the exact key)');
    const approveCard = /<button[^>]*value="APPROVED"[^>]*>([\s\S]*?)<\/button>/.exec(travellerDuring.html);
    assert.ok(approveCard, 'the Approve card exists');
    const approveCardHtml = approveCard?.[1] ?? '';
    assert.ok(approveCardHtml.includes('opt-route') || approveCardHtml.includes('opt-note'), 'the Approve card carries rich detail from real strategy evidence');

    const decide = await postJson(base, '/api/runtime/decide', {
      caseId,
      intentId: begin.body['intentId'],
      decidedBy: { entityType: 'TRAVELLER', id: spec.trip.travellerIds[0] },
      verdict: 'APPROVED',
      at: '2026-09-12T18:50:00+09:00',
    });
    assert.equal(decide.status, 200);
    const execute = await postJson(base, '/api/runtime/execute', {
      caseId,
      intentId: begin.body['intentId'],
      at: '2026-09-12T18:55:00+09:00',
    });
    assert.equal(execute.body['caseStatus'], 'RESOLVED', 'provider success + verification resolves the case');

    const casePageAfter = await getHtml(base, `/operator/cases/${caseId}`);
    assert.ok(casePageAfter.html.includes('Trip recovered'), 'the resolved outcome renders honestly');
    // Provenance honesty: the provider surface reports REPLAY, never LIVE.
    const providerSurface = (await (await fetch(`${base}/api/wave/providers`)).json()) as { capabilities: Array<{ modeLabel: string }> };
    assert.ok(providerSurface.capabilities.every((p) => p.modeLabel !== 'LIVE'), 'provider provenance never claims LIVE in replay');

    // Activity + uncertainties surfaces project real audit/assessment state.
    const activity = (await (await fetch(`${base}/api/wave/trips/${spec.trip.id}/activity`)).json()) as { items?: unknown[]; events?: unknown[] };
    assert.ok(activity, 'the activity surface answers for the recovered trip');
    const uncertainties = await fetch(`${base}/api/wave/trips/${spec.trip.id}/uncertainties`);
    assert.equal(uncertainties.status, 200);

    // ===================================================================
    // CASE A — change request with mixed funding on a small seeded programme
    // ===================================================================
    const EVENT_ID = 'evt-prod-convergence';
    const TZ = 'Asia/Singapore';
    const EVENT_PLACE = `plc-${EVENT_ID}-airport`;
    const HOME_PLACE = `plc-${EVENT_ID}-home`;
    const WINDOW_START = '2026-09-04T00:00:00+08:00';
    const WINDOW_END = '2026-09-11T23:59:00+08:00';

    const context = await postJson(base, '/api/programme/context', {
      at: AT,
      sourceId: `src-${EVENT_ID}`,
      organisation: { id: `org-${EVENT_ID}`, name: 'Product Convergence Organiser', roles: ['EVENT_ORGANISER', 'PAYER'] },
      anchorEvent: {
        id: EVENT_ID,
        name: 'Product Convergence Summit',
        kind: 'CONFERENCE',
        placeId: EVENT_PLACE,
        window: { startsAt: '2026-09-07T00:00:00+08:00', endsAt: '2026-09-11T23:59:00+08:00' },
        organiserOrganisationId: `org-${EVENT_ID}`,
        commitments: [
          {
            id: `cmt-${EVENT_ID}-opening`,
            anchorEventId: EVENT_ID,
            title: 'Opening Session',
            kind: 'SESSION',
            placeId: EVENT_PLACE,
            startsAt: { value: '2026-09-08T15:00:00+08:00', sourceId: `src-${EVENT_ID}`, authority: 'AUTHORITATIVE', observedAt: AT },
            sourceId: `src-${EVENT_ID}`,
          },
        ],
        sourceIds: [],
      },
      places: [
        { id: EVENT_PLACE, name: 'Event Airport', kind: 'AIRPORT', timezone: TZ, externalRefs: [{ system: 'airport-code', value: 'EVT' }] },
        { id: HOME_PLACE, name: 'Home Airport', kind: 'AIRPORT', timezone: TZ, externalRefs: [{ system: 'airport-code', value: 'HOM' }] },
      ],
      ruleSets: [
        {
          id: `rs-${EVENT_ID}-funding`,
          kind: 'EVENT',
          name: 'event funding window',
          ownerOrganisationId: `org-${EVENT_ID}`,
          sourceId: `src-${EVENT_ID}`,
          rules: [
            {
              id: `rule-${EVENT_ID}-funded-window`,
              kind: 'FUNDED_WINDOW',
              sourceId: `src-${EVENT_ID}`,
              appliesTo: [],
              windowStart: WINDOW_START,
              windowEnd: WINDOW_END,
              coveredBy: 'EVENT_ORGANISATION',
              incrementalPayer: 'TRAVELLER',
            },
          ],
        },
      ],
    });
    assert.equal(context.status, 200, 'the programme context applies over HTTP');

    const intake = await postJson(base, '/api/programme/import', {
      importDraft: {
        id: `import-${EVENT_ID}`,
        anchorEventId: EVENT_ID,
        channel: 'BULK_IMPORT',
        sourceId: `src-${EVENT_ID}`,
        receivedAt: AT,
        travellers: [
          {
            draftId: 'draft-1',
            displayName: 'Case A Traveller',
            identity: { email: 'case-a@example.test' },
            homeLocationText: 'HOM',
            nationalityCodes: ['SG'],
            accessibilityStatements: [],
            notes: [],
            anchorCommitmentIds: [`cmt-${EVENT_ID}-opening`],
          },
        ],
        unresolvedStatements: [],
      },
      at: AT,
    });
    assert.equal(intake.status, 200);
    const tripId = (intake.body['outcomes'] as Array<{ tripId: string }>)[0]!.tripId;
    const travellerId = `trv-${EVENT_ID}-draft-1`;

    // Book the arrival leg through the frozen mutation path (same service
    // the engine uses — no state surgery).
    const trips = new SqliteTripRepository(composed.db);
    const entities = new SqliteEntityStore(composed.db);
    const mutations = new SqlMutationService({ db: composed.db, trips, entities });
    const fact = (value: string) => ({ value, sourceId: `src-${EVENT_ID}`, authority: 'AUTHORITATIVE' as const, observedAt: AT });
    const arrival: TransportLeg = {
      id: `el-${tripId}-arrival`,
      tripId,
      elementKind: 'TRANSPORT_LEG',
      importance: 'REQUIRED',
      flexibility: 'CHANGEABLE',
      reservationState: 'CONFIRMED',
      status: 'VALID',
      dependsOn: [],
      governedByRuleSetIds: [],
      data: {
        mode: 'FLIGHT',
        originPlaceId: HOME_PLACE,
        destinationPlaceId: EVENT_PLACE,
        scheduledDeparture: fact('2026-09-06T20:00:00+08:00'),
        scheduledArrival: fact('2026-09-06T21:30:00+08:00'),
        bookingRef: { system: 'flight-provider', reference: 'BOOKED-OUT' },
      },
    };
    const tripBefore = (await trips.getTrip(tripId))!;
    await mutations.applyProposal({
      id: 'prop-book-convergence',
      origin: 'SYSTEM',
      sourceId: `src-${EVENT_ID}`,
      requestedAt: AT,
      rationale: 'book the arrival leg for the product convergence Case A smoke',
      operations: [{ op: 'UPSERT_ENTITY', entityType: 'TRIP', id: tripId, data: { ...tripBefore, elements: [...tripBefore.elements, arrival] } }],
    });

    // "I would like to arrive two days earlier — I'll pay extra myself."
    const change = await postJson(base, '/api/resolution/change-request', {
      request: {
        id: `cr-${EVENT_ID}-earlier`,
        tripId,
        travellerId,
        sourceId: 'src-traveller-web',
        authority: 'ASSERTED',
        issuedAt: '2026-09-03T00:00:00+00:00',
        intentKind: 'ADJUST_TRIP_WINDOW',
        urgency: 'HARD_INSTRUCTION',
        utterance: 'I would like to arrive two days earlier, and I will pay extra myself',
        target: { arriveBy: '2026-09-04T18:00:00+08:00', objectiveEffects: [] },
        fundingDeclaration: 'TRAVELLER_FUNDED',
      },
      at: '2026-09-03T00:00:00+00:00',
    });
    assert.equal(change.status, 200);
    const caseAId = change.body['caseId'] as string;
    assert.ok(change.body['implications'], 'the change request returns implications');

    const planA = await postJson(base, '/api/runtime/plan', { caseId: caseAId, at: '2026-09-03T01:00:00+00:00' });
    assert.equal(planA.status, 200);
    const beginA = await postJson(base, '/api/runtime/begin', {
      caseId: caseAId,
      strategyId: planA.body['bestStrategyId'],
      at: '2026-09-03T02:00:00+00:00',
    });
    assert.equal(beginA.status, 200);

    // Mixed funding surfaces on the case detail (ADR-037): the cost accrues
    // inside the covered window, so the event organisation pays even though
    // the traveller offered to.
    const caseAPage = await getHtml(base, `/operator/cases/${caseAId}`);
    assert.equal(caseAPage.status, 200);
    assert.ok(/covered by the event organisation/i.test(caseAPage.html), 'the funding allocation is projected from the deterministic CostAllocation');

    // Traveller approval prompt carries the same evidence; the decision is
    // made through the real lifecycle endpoint.
    const travellerA = await getHtml(base, `/traveller?trip=${encodeURIComponent(tripId)}`);
    assert.equal(travellerA.status, 200);
    assert.ok(/covered by the event organisation/i.test(travellerA.html), 'the approval prompt names who pays');
    const decision = await postJson(base, `/api/cases/${caseAId}/traveller-decision`, { decision: 'APPROVED' });
    assert.equal(decision.status, 200);
    assert.equal(decision.body['caseStatus'], 'RESOLVED', 'approval drives execution and verification to RESOLVED');

    // ===================================================================
    // CASE C — commitment change fan-out on the seeded 42-traveller programme
    // ===================================================================
    const beforeC = (await (await fetch(`${base}/api/programme/${programmeEventId}?at=${encodeURIComponent(AT)}`)).json()) as {
      travellers: Array<{ tripId: string; status: string; activeCaseIds: string[] }>;
    };
    const fanOut = await postJson(base, '/api/programme/commitment-change', {
      signal: {
        id: `sig-${programmeEventId}-convergence`,
        kind: 'ANCHOR_COMMITMENT_CHANGE',
        occurredAt: '2026-09-05T10:00:00+00:00',
        receivedAt: '2026-09-05T10:05:00+00:00',
        sourceId: `src-${programmeEventId}`,
        authority: 'AUTHORITATIVE',
        payload: {
          anchorEventId: programmeEventId,
          commitmentId: 'cmt-ait-d0-opening',
          changeKind: 'RESCHEDULED',
          newStartsAt: '2026-09-30T10:30:00+08:00',
          newEndsAt: '2026-09-30T11:00:00+08:00',
        },
      },
    });
    assert.equal(fanOut.status, 200);
    const processed = fanOut.body['processedSignals'] as Array<{ tripId: string }>;
    assert.ok(processed.length > 0, 'linked trips received the fan-out');

    const afterC = (await (await fetch(`${base}/api/programme/${programmeEventId}?at=${encodeURIComponent('2026-09-05T11:00:00+00:00')}`)).json()) as {
      travellers: Array<{ tripId: string; status: string; activeCaseIds: string[] }>;
    };
    assert.equal(afterC.travellers.length, beforeC.travellers.length, 'the cohort is intact after fan-out');
    const linkedIds = new Set(processed.map((entry) => entry.tripId));
    for (const row of afterC.travellers) {
      if (linkedIds.has(row.tripId)) {
        assert.ok(row.activeCaseIds.length > 0, `linked trip ${row.tripId} carries its case`);
      } else {
        assert.equal(row.activeCaseIds.length, 0, `unlinked trip ${row.tripId} is untouched`);
      }
    }
    // The programme HTML surface renders the same real rollup.
    const programmeAfterC = await getHtml(base, `/programme?event=${encodeURIComponent(programmeEventId)}&at=${encodeURIComponent('2026-09-05T11:00:00+00:00')}`);
    assert.equal(programmeAfterC.status, 200);
    for (const row of processed.slice(0, 3)) {
      assert.ok(programmeAfterC.html.includes(`data-trip-id="${row.tripId}"`), `affected traveller row ${row.tripId} renders`);
    }
    assertNoJargon(programmeAfterC.html, '/programme after fan-out');

    // ===================================================================
    // RESET -> baseline again, no residue
    // ===================================================================
    const reset = await postJson(base, '/api/runtime/reset', { at: '2026-09-12T23:00:00+09:00' });
    assert.equal(reset.status, 200);
    const state = (await (await fetch(`${base}/api/runtime/state`)).json()) as { openCases: unknown[]; trips: Array<{ tripId: string }> };
    assert.equal(state.openCases.length, 0, 'no case residue survives reset');

    const dashboardReset = await getHtml(base, '/operator');
    assert.equal(dashboardReset.status, 200);
    assert.ok(!dashboardReset.html.includes('class="just-changed'), 'settle memory clears on reset — the baseline never settles');
    const oldCase = await fetch(`${base}/api/cases/${caseId}`);
    assert.equal(oldCase.status, 404, 'Case B is gone after reset');
    const oldCaseA = await fetch(`${base}/api/cases/${caseAId}`);
    assert.equal(oldCaseA.status, 404, 'Case A is gone after reset');
    const programmeReset = (await (await fetch(`${base}/api/programme/${programmeEventId}?at=${encodeURIComponent(AT)}`)).json()) as {
      travellers: Array<{ activeCaseIds: string[] }>;
    };
    assert.ok(
      programmeReset.travellers.every((row) => row.activeCaseIds.length === 0),
      'Case C fan-out residue is wiped by reset',
    );

    // ===================================================================
    // Responsive / document shell sanity (no headless browser in REPLAY):
    // both shells carry the viewport meta and the binding theme.
    // ===================================================================
    for (const page of [dashboardReset, travellerPage]) {
      assert.ok(page.html.includes('name="viewport"'), 'responsive viewport meta present');
      assert.ok(page.html.includes('@media'), 'responsive media queries ship with the theme');
      assert.ok(page.html.includes('prefers-reduced-motion'), 'reduced-motion support ships with the theme');
    }
  } finally {
    await new Promise<void>((resolvePromise, reject) =>
      server.close((error) => (error ? reject(error) : resolvePromise())),
    );
    composed.db.close();
  }
});

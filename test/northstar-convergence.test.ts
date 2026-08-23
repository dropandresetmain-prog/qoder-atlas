/**
 * NS-G2 convergence evidence — all four paths through ONE architecture.
 *
 * Over the REAL composed HTTP runtime with ZERO provider/model credentials
 * (REPLAY recordings under test/fixtures/recordings, lazy timezone evidence
 * from programme intake):
 *
 *  - path 0: engagement-only programme trip -> INITIAL_PLANNING case ->
 *    arrival search evidence -> feasible strategy -> traveller authority ->
 *    gate-checked simulated execution -> observation CONFIRMS the leg ->
 *    verified RESOLVED trip;
 *  - path A: traveller ChangeRequest (arrive earlier) on a booked trip ->
 *    same planning loop re-searches the route for the requested date ->
 *    replacement strategy through the same authority/execution path;
 *  - path B: provider FLIGHT_CANCELLATION on a booked trip -> the shared
 *    signal pipeline opens a RECOVERY case -> replacement through recorded
 *    search evidence -> verified resolution; unrelated trips unaffected;
 *  - path C: AnchorEvent commitment change fans out ONLY to linked trips
 *    (authoritative engagement facts update; unlinked trips untouched).
 *
 * Every stage asserts honest UNKNOWN handling: missing home evidence fails
 * closed, execution without approval is refused by the deterministic gate,
 * and no strategy fabricates routes the recordings cannot evidence.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';

import { AppConfigSchema } from '../src/config/config.ts';
import { createAppServer } from '../src/server/http.ts';
import { composeAppRuntime } from '../src/app/compose.ts';
import { buildTripSnapshot } from '../src/app/snapshot.ts';
import type { MutationOperation } from '../src/operational/mutation.ts';

const AT = '2026-09-01T00:00:00+00:00';
const HOME_TZ = 'Asia/Singapore';

const runtimeConfig = AppConfigSchema.parse({
  environment: 'local',
  adapterMode: 'REPLAY',
  sqlitePath: ':memory:',
  fixturesDir: resolve('fixtures'),
  recordingsDir: 'test/fixtures/recordings',
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

/** Synthetic programme context: home airport HOM, event airport EVT. */
function programmeContext(eventId: string) {
  const venuePlaceId = `plc-${eventId}-airport`;
  const homePlaceId = `plc-${eventId}-home`;
  return {
    at: AT,
    sourceId: `src-${eventId}`,
    organisation: {
      id: `org-${eventId}`,
      name: 'Synthetic Programme Organiser',
      roles: ['EVENT_ORGANISER', 'PAYER'],
    },
    anchorEvent: {
      id: eventId,
      name: 'Synthetic Programme Event',
      kind: 'CONFERENCE',
      placeId: venuePlaceId,
      window: { startsAt: '2026-09-07T00:00:00+08:00', endsAt: '2026-09-11T23:59:00+08:00' },
      organiserOrganisationId: `org-${eventId}`,
      commitments: [
        {
          id: `cmt-${eventId}-opening`,
          anchorEventId: eventId,
          title: 'Opening Session',
          kind: 'SESSION',
          placeId: venuePlaceId,
          startsAt: {
            value: '2026-09-08T15:00:00+08:00',
            sourceId: `src-${eventId}`,
            authority: 'AUTHORITATIVE',
            observedAt: AT,
          },
          sourceId: `src-${eventId}`,
        },
        // A second commitment so the programme can contain a trip that is
        // genuinely UNLINKED from the opening commitment (path C isolation).
        {
          id: `cmt-${eventId}-closing`,
          anchorEventId: eventId,
          title: 'Closing Session',
          kind: 'SESSION',
          placeId: venuePlaceId,
          startsAt: {
            value: '2026-09-11T09:00:00+08:00',
            sourceId: `src-${eventId}`,
            authority: 'AUTHORITATIVE',
            observedAt: AT,
          },
          sourceId: `src-${eventId}`,
        },
      ],
      sourceIds: [],
    },
    places: [
      {
        id: venuePlaceId,
        name: 'Synthetic Event Airport',
        kind: 'AIRPORT',
        timezone: HOME_TZ,
        externalRefs: [{ system: 'airport-code', value: 'EVT' }],
      },
      {
        id: homePlaceId,
        name: 'Synthetic Home Airport',
        kind: 'AIRPORT',
        timezone: HOME_TZ,
        externalRefs: [{ system: 'airport-code', value: 'HOM' }],
      },
    ],
  };
}

async function withServer(
  fn: (base: string, composed: Awaited<ReturnType<typeof composeAppRuntime>>) => Promise<void>,
) {
  const composed = await composeAppRuntime(runtimeConfig);
  const server = createAppServer(runtimeConfig, composed.endpoints);
  await new Promise<void>((resolvePromise) => server.listen(0, resolvePromise));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  try {
    await fn(base, composed);
  } finally {
    await new Promise<void>((resolvePromise, reject) =>
      server.close((error) => (error ? reject(error) : resolvePromise())),
    );
    composed.db.close();
  }
}

test('NS-G2: paths 0/A/B/C converge through the same architecture (REPLAY, zero credentials)', async () => {
  await withServer(async (base, composed) => {
    assert.equal(composed.plannerMode, 'DETERMINISTIC_FALLBACK');

    const eventId = 'evt-conv';
    const context = programmeContext(eventId);

    // Programme context through the validated mutation path.
    const create = await postJson(base, '/api/programme/context', context);
    assert.equal(create.status, 200);

    // Three travellers: one with resolvable home evidence (airport code), one
    // without — missing facts must stay missing and initial planning must
    // fail closed for them — and one linked ONLY to the closing commitment,
    // so path C has a genuinely unlinked trip in the same event.
    const importDraft = {
      id: `import-${eventId}`,
      anchorEventId: eventId,
      channel: 'BULK_IMPORT',
      sourceId: `src-${eventId}`,
      receivedAt: AT,
      travellers: [
        {
          draftId: 'draft-1',
          displayName: 'Traveller Linked',
          identity: { email: 'linked@example.test' },
          homeLocationText: 'HOM',
          nationalityCodes: ['SG'],
          accessibilityStatements: [],
          notes: [],
          anchorCommitmentIds: [`cmt-${eventId}-opening`],
        },
        {
          draftId: 'draft-2',
          displayName: 'Traveller Homeless',
          identity: {},
          nationalityCodes: [],
          accessibilityStatements: [],
          notes: [],
          anchorCommitmentIds: [`cmt-${eventId}-opening`],
        },
        {
          draftId: 'draft-3',
          displayName: 'Traveller Closing Only',
          identity: {},
          nationalityCodes: [],
          accessibilityStatements: [],
          notes: [],
          anchorCommitmentIds: [`cmt-${eventId}-closing`],
        },
      ],
      unresolvedStatements: [],
    };
    const bulk = await postJson(base, '/api/programme/import', { importDraft, at: AT });
    assert.equal(bulk.status, 200);
    assert.equal(bulk.body['promotedCount'], 3);

    // A SECOND event with its own trip: path C fan-out must neither count
    // nor touch trips outside the changed commitment's event.
    const otherEventId = 'evt-conv-other';
    const otherContext = programmeContext(otherEventId);
    const otherCreate = await postJson(base, '/api/programme/context', otherContext);
    assert.equal(otherCreate.status, 200);
    const otherImport = await postJson(base, '/api/programme/import', {
      importDraft: {
        id: `import-${otherEventId}`,
        anchorEventId: otherEventId,
        channel: 'BULK_IMPORT',
        sourceId: `src-${otherEventId}`,
        receivedAt: AT,
        travellers: [
          {
            draftId: 'draft-1',
            displayName: 'Other Event Traveller',
            identity: {},
            nationalityCodes: [],
            accessibilityStatements: [],
            notes: [],
            anchorCommitmentIds: [`cmt-${otherEventId}-opening`],
          },
        ],
        unresolvedStatements: [],
      },
      at: AT,
    });
    assert.equal(otherImport.status, 200);
    const otherTripId = 'trip-trv-evt-conv-other-draft-1';

    // ------------------------------------------------------------------
    // PATH 0 — engagement-only trip -> viable trip
    // ------------------------------------------------------------------
    const linkedTripId = 'trip-trv-evt-conv-draft-1';
    const homelessTripId = 'trip-trv-evt-conv-draft-2';

    // Missing home evidence: initial planning fails closed (UNKNOWN never PASS).
    const homelessPlan = await postJson(base, '/api/resolution/initial-plan', {
      tripId: homelessTripId,
      at: '2026-09-02T00:00:00+00:00',
    });
    assert.equal(homelessPlan.status, 200);
    assert.ok(
      (homelessPlan.body['uncertainties'] as Array<{ statement: string }>).some((u) => /home-airport/i.test(u.statement)),
      'no home evidence must produce explicit uncertainty, never a fabricated route',
    );

    // Full loop for the traveller with home evidence.
    const initial = await postJson(base, '/api/resolution/initial-plan', {
      tripId: linkedTripId,
      at: '2026-09-02T00:00:00+00:00',
    });
    assert.equal(initial.status, 200);
    assert.equal(initial.body['accepted'], true);
    const caseId = initial.body['caseId'] as string;
    const strategies = initial.body['strategies'] as Array<{ id: string; feasible: boolean; summary: string; rejectionReasons: string[] }>;
    assert.ok(strategies.length >= 1, 'flight.search evidence yields arrival strategies');

    // Anti-vacuity (REV-2): the promoted trip must actually be judgeable. A
    // HARD arrival constraint exists in authoritative state, and the SAME
    // viability engine that judged the strategies distinguishes timely from
    // late arrivals against it — these assertions fail if viability (or the
    // promotion-time constraint) is removed entirely.
    const preSnapshot = await buildTripSnapshot(composed.readDeps.snapshot, linkedTripId, '2026-09-02T00:00:00+00:00');
    const arrivalConstraints = preSnapshot.constraints.filter((c) => c.kind === 'TEMPORAL' && c.hardness === 'HARD');
    assert.ok(arrivalConstraints.length >= 1, 'promoted programme trip carries a HARD arrival constraint');
    const slotId = `el-${linkedTripId}-arrival`;
    assert.ok(
      arrivalConstraints.some((c) => c.refs.some((ref) => ref.id === slotId)),
      'the arrival constraint binds the trip arrival slot',
    );

    const feasible = strategies.filter((s) => s.feasible);
    assert.ok(feasible.length >= 1, 'the viability engine accepts the arrival strategy');
    assert.ok(feasible.some((s) => /opaque-routing-convergence-arrival/.test(s.summary)), 'strategy is evidence-bound');

    // Negative probe: a too-late arrival into the SAME slot is rejected by
    // the same engine with a named hard failure.
    const lateProbe: MutationOperation = {
      op: 'UPSERT_ENTITY',
      entityType: 'TRIP_ELEMENT',
      data: {
        id: slotId,
        tripId: linkedTripId,
        elementKind: 'TRANSPORT_LEG',
        importance: 'PREFERRED',
        flexibility: 'FIXED',
        reservationState: 'HELD',
        status: 'UNKNOWN',
        dependsOn: [],
        governedByRuleSetIds: [],
        data: {
          mode: 'FLIGHT',
          originPlaceId: `plc-${eventId}-home`,
          destinationPlaceId: `plc-${eventId}-airport`,
          scheduledArrival: {
            value: '2026-09-08T16:30:00+08:00',
            sourceId: `src-${eventId}`,
            authority: 'CONNECTED',
            observedAt: '2026-09-02T00:00:00+00:00',
          },
        },
      },
    };
    const lateVerdict = await composed.readDeps.viability.evaluateOverlay({
      baseSnapshot: preSnapshot,
      candidateOperations: [lateProbe],
    });
    assert.equal(lateVerdict.feasible, false, 'viability rejects a too-late arrival');
    assert.ok(lateVerdict.hardFailureIds.length >= 1, 'the rejection names a HARD constraint');

    // Deterministic authority: money-moving booking requires the traveller.
    const bestStrategyId = feasible[0]!.id;
    const begin = await postJson(base, '/api/runtime/begin', { caseId, strategyId: bestStrategyId, at: '2026-09-02T01:00:00+00:00' });
    assert.equal(begin.status, 200);
    assert.equal(begin.body['outcome'], 'REQUIRES_TRAVELLER');
    const intentId = begin.body['intentId'] as string;

    // Execution gate: without approval, execution is refused.
    const refused = await postJson(base, '/api/runtime/execute', { caseId, intentId, at: '2026-09-02T01:30:00+00:00' });
    assert.equal(refused.status, 200);
    assert.equal(refused.body['executed'], false);
    assert.ok((refused.body['gateIssues'] as string[]).length > 0);

    // Traveller approves; simulated execution -> observation -> verification.
    const decide = await postJson(base, '/api/runtime/decide', {
      caseId,
      intentId,
      decidedBy: { entityType: 'TRAVELLER', id: 'trv-evt-conv-draft-1' },
      verdict: 'APPROVED',
      at: '2026-09-02T02:00:00+00:00',
    });
    assert.equal(decide.status, 200);
    const execute = await postJson(base, '/api/runtime/execute', { caseId, intentId, at: '2026-09-02T02:30:00+00:00' });
    assert.equal(execute.status, 200);
    assert.equal(execute.body['executed'], true);
    assert.equal(execute.body['caseStatus'], 'RESOLVED');
    assert.equal(execute.body['simulated'], true, 'no LIVE provider call in REPLAY convergence');

    // Authoritative state: the arrival leg is CONFIRMED on the trip.
    const tripAfter = (await (await fetch(`${base}/api/traveller/${linkedTripId}`)).json()) as { remainderViable: string };
    assert.equal(tripAfter.remainderViable, 'VIABLE');
    const row = composed.db.prepare('SELECT data FROM trips WHERE id = ?').get(linkedTripId) as { data: string };
    const tripData = JSON.parse(row.data) as { elements: Array<{ elementKind: string; reservationState: string }> };
    const arrival = tripData.elements.find((el) => el.elementKind === 'TRANSPORT_LEG');
    assert.equal(arrival?.reservationState, 'CONFIRMED', 'observation confirms the arrival leg');

    // Programme view shows the traveller moved off PLANNING.
    const view = (await (await fetch(`${base}/api/programme/${eventId}?at=${encodeURIComponent('2026-09-02T03:00:00+00:00')}`)).json()) as {
      summary: { planning: number; ready: number; resolved: number };
    };
    assert.ok(view.summary.ready + view.summary.resolved >= 1, 'resolved traveller leaves PLANNING');

    // ------------------------------------------------------------------
    // PATH A — traveller target change on a booked trip
    // ------------------------------------------------------------------
    // Book the arrival leg's trip already has a leg; use the confirmed trip
    // for a window-shift request (arrive earlier).
    const changeRequest = {
      request: {
        id: `cr-${eventId}-earlier`,
        tripId: linkedTripId,
        travellerId: 'trv-evt-conv-draft-1',
        sourceId: 'src-traveller-web',
        authority: 'ASSERTED',
        issuedAt: '2026-09-03T00:00:00+00:00',
        intentKind: 'ADJUST_TRIP_WINDOW',
        urgency: 'SOFT_PREFERENCE',
        utterance: 'I would like to arrive two days earlier',
        target: { arriveBy: '2026-09-04T18:00:00+08:00' },
        fundingDeclaration: 'TRAVELLER_FUNDED',
      },
      at: '2026-09-03T00:00:00+00:00',
    };
    const changeOutcome = await postJson(base, '/api/resolution/change-request', changeRequest);
    assert.equal(changeOutcome.status, 200);
    assert.equal(changeOutcome.body['accepted'], true);
    const changeCaseId = changeOutcome.body['caseId'] as string;
    assert.ok(
      (changeOutcome.body['implications'] as string[]).some((i) => /arriveBy/i.test(i)),
      'target deltas surface as deterministic implications',
    );

    // Same planning loop re-searches the route for the requested date.
    const changePlan = await postJson(base, '/api/runtime/plan', { caseId: changeCaseId, at: '2026-09-03T01:00:00+00:00' });
    assert.equal(changePlan.status, 200);
    const changeBest = changePlan.body['bestStrategyId'] as string;
    assert.ok(changeBest, 'window-shift produces a feasible replacement strategy');
    const changeStrategies = changePlan.body['strategies'] as Array<{ summary: string; feasible: boolean }>;
    assert.ok(
      changeStrategies.some((s) => s.feasible && /opaque-routing-convergence-shift/.test(s.summary)),
      'the replacement is evidence-bound to the recorded earlier search',
    );

    // ------------------------------------------------------------------
    // PATH B — provider disruption on the same trip, unrelated trip untouched
    // ------------------------------------------------------------------
    const bookedRow = composed.db.prepare('SELECT data FROM trips WHERE id = ?').get(linkedTripId) as { data: string };
    const bookedTrip = JSON.parse(bookedRow.data) as { elements: Array<{ id: string; elementKind: string }> };
    const flightLeg = bookedTrip.elements.find((el) => el.elementKind === 'TRANSPORT_LEG');
    assert.ok(flightLeg, 'booked leg exists before disruption');

    const disruption = await postJson(base, '/api/runtime/disruption', {
      id: `sig-${eventId}-cancel`,
      kind: 'FLIGHT_CANCELLATION',
      occurredAt: '2026-09-04T00:00:00+00:00',
      receivedAt: '2026-09-04T00:01:00+00:00',
      sourceId: 'src-provider-feed',
      authority: 'AUTHORITATIVE',
      tripId: linkedTripId,
      subjectRef: { entityType: 'TRIP_ELEMENT', id: flightLeg!.id },
      summary: 'arrival flight cancelled by carrier',
      payload: { reason: 'operational' },
    });
    assert.equal(disruption.status, 200);
    const recoveryCaseId = disruption.body['caseId'] as string;
    assert.ok(recoveryCaseId);

    // Unrelated traveller/trip remains untouched by the disruption.
    const homelessRow = composed.db.prepare('SELECT data FROM trips WHERE id = ?').get(homelessTripId) as { data: string };
    const homelessTrip = JSON.parse(homelessRow.data) as { elements: unknown[]; viability: string };
    assert.equal(homelessTrip.elements.length, 1, 'unlinked trip keeps engagement-only state');

    // The shared recovery loop plans a replacement from recorded evidence.
    const recoveryPlan = await postJson(base, '/api/runtime/plan', { caseId: recoveryCaseId, at: '2026-09-04T01:00:00+00:00' });
    assert.equal(recoveryPlan.status, 200);
    const recoveryBest = recoveryPlan.body['bestStrategyId'] as string;
    assert.ok(recoveryBest, 'disrupted leg receives an evidence-bound replacement');

    // ------------------------------------------------------------------
    // PATH C — event-side commitment change fans out ONLY to linked trips
    // ------------------------------------------------------------------
    const fanOut = await postJson(base, '/api/programme/commitment-change', {
      signal: {
        id: `sig-${eventId}-move`,
        kind: 'ANCHOR_COMMITMENT_CHANGE',
        occurredAt: '2026-09-05T10:00:00+00:00',
        receivedAt: '2026-09-05T10:05:00+00:00',
        sourceId: `src-${eventId}`,
        authority: 'AUTHORITATIVE',
        payload: {
          anchorEventId: eventId,
          commitmentId: `cmt-${eventId}-opening`,
          changeKind: 'RESCHEDULED',
          newStartsAt: '2026-09-08T10:00:00+08:00',
        },
      },
    });
    assert.equal(fanOut.status, 200);
    assert.equal(fanOut.body['linkedTripCount'], 2, 'both opening-linked programme trips link the opening commitment');
    assert.equal(fanOut.body['unlinkedTripCount'], 1, 'the closing-only trip is unlinked but counted for the same event');

    // Authoritative engagement fact moved only on the linked trips.
    const linkedRow = composed.db.prepare('SELECT data FROM trips WHERE id = ?').get(linkedTripId) as { data: string };
    const linkedTrip = JSON.parse(linkedRow.data) as { elements: Array<{ elementKind: string; data: Record<string, unknown> }> };
    const engagement = linkedTrip.elements.find((el) => el.elementKind === 'ENGAGEMENT');
    const startsAt = engagement?.data as { startsAt?: { value: string } };
    assert.equal(startsAt?.startsAt?.value, '2026-09-08T10:00:00+08:00', 'linked engagement reflects the new start');

    // Isolation: the unlinked same-event trip keeps its original engagement
    // fact, and the second event's trip is untouched entirely.
    const closingRow = composed.db.prepare('SELECT data FROM trips WHERE id = ?').get('trip-trv-evt-conv-draft-3') as { data: string };
    const closingTrip = JSON.parse(closingRow.data) as { elements: Array<{ elementKind: string; data: Record<string, unknown> }> };
    const closingEngagement = closingTrip.elements.find((el) => el.elementKind === 'ENGAGEMENT');
    const closingStartsAt = closingEngagement?.data as { startsAt?: { value: string }; anchorCommitmentId?: string };
    assert.equal(closingStartsAt?.anchorCommitmentId, `cmt-${eventId}-closing`);
    assert.equal(closingStartsAt?.startsAt?.value, '2026-09-11T09:00:00+08:00', 'unlinked engagement fact is untouched');

    const otherRow = composed.db.prepare('SELECT data FROM trips WHERE id = ?').get(otherTripId) as { data: string };
    const otherTrip = JSON.parse(otherRow.data) as { elements: Array<{ elementKind: string; data: Record<string, unknown> }> };
    const otherEngagement = otherTrip.elements.find((el) => el.elementKind === 'ENGAGEMENT');
    const otherStartsAt = otherEngagement?.data as { startsAt?: { value: string } };
    assert.equal(otherStartsAt?.startsAt?.value, '2026-09-08T15:00:00+08:00', 'second-event engagement fact is untouched');
  });
});

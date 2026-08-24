/**
 * Wave 3 Gate 3 — Case A: traveller change with MIXED FUNDING end-to-end.
 *
 * "I'd like to arrive two days earlier, stay through Sunday, and I'll pay
 * extra myself." Synthetic programme, synthetic travellers, REPLAY recordings,
 * zero credentials. The SAME engine processes the request:
 *
 *   resolveChangeRequest -> TRAVELLER_INPUT signal (funding evidence carried
 *   in the payload) -> planning loop (window-shift strategies) -> authority
 *   -> ActionIntent with the AUTHORITATIVE CostAllocation computed where the
 *   real cost is known (ADR-037) -> traveller approval -> gate-checked
 *   execution -> observation -> verified RESOLVED.
 *
 * Mixed funding evidence: the FUNDED_WINDOW rule covers the event window.
 *   - the earlier arrival rebooks INSIDE the covered window ->
 *     EVENT_ORGANISATION pays (covered), even though the traveller declared
 *     TRAVELLER_FUNDED — the declaration is evidence, never an allocation;
 *   - the Sunday departure extension accrues OUTSIDE every covered window ->
 *     the rule's incrementalPayer TRAVELLER pays.
 * Both allocations are deterministic (derivedFromRuleIds evidence), surfaced
 * in the begin outcome, the case-detail read model (options + funding), the
 * traveller approval prompt, and the AUTHORITY_DECIDED audit record.
 *
 * Also asserted: a single two-dimension request plans BOTH dimensions from
 * per-dimension search evidence (isolation: on a second traveller's trip);
 * execution without approval is refused by the deterministic gate; provider
 * success alone never resolves — only verification does.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import { AppConfigSchema } from '../src/config/config.ts';
import { composeAppRuntime } from '../src/app/compose.ts';
import {
  SqliteAuditRepository,
  SqliteCaseRepository,
  SqliteSignalRepository,
  SqliteSourceRepository,
  SqliteTripRepository,
} from '../src/persistence/repositories.ts';
import { SqliteEntityStore } from '../src/persistence/entityStore.ts';
import { SqlMutationService } from '../src/engine/mutation.ts';
import { ProgrammeService } from '../src/app/programme.ts';
import { resolveChangeRequest } from '../src/app/changeRequest.ts';
import type { ProgrammeImportDraft } from '../src/contracts/programmeIntake.ts';
import type { AnchorEvent, Organisation, Place } from '../src/domain/entities.ts';
import type { RuleSet } from '../src/domain/rules.ts';
import type { TransportLeg } from '../src/domain/elements.ts';
import type { ChangeRequest } from '../src/contracts/changeRequest.ts';

const AT = '2026-09-01T00:00:00+00:00';
const EVENT_ID = 'evt-w3a';
const TZ = 'Asia/Singapore';
const EVENT_PLACE = `plc-${EVENT_ID}-airport`;
const HOME_PLACE = `plc-${EVENT_ID}-home`;
// Covered funding window: the organisation pays costs accruing inside it;
// incremental costs outside it fall to the traveller (the demo's mixed split).
const WINDOW_START = '2026-09-04T00:00:00+08:00';
const WINDOW_END = '2026-09-11T23:59:00+08:00';

test('Wave 3 Case A: mixed funding — event covers the in-window arrival change, traveller pays the out-of-window extension', async () => {
  const config = AppConfigSchema.parse({
    environment: 'local',
    adapterMode: 'REPLAY',
    sqlitePath: ':memory:',
    fixturesDir: resolve('fixtures'),
    recordingsDir: 'test/fixtures/recordings',
    providers: { atlas: { env: 'sandbox' }, modelStudio: {}, googleRoutes: {}, nuitee: {} },
  });
  const composed = await composeAppRuntime(config);
  try {
    // Service-layer handles over the SAME database the composed runtime owns.
    const trips = new SqliteTripRepository(composed.db);
    const entities = new SqliteEntityStore(composed.db);
    const sources = new SqliteSourceRepository(composed.db);
    const signals = new SqliteSignalRepository(composed.db);
    const cases = new SqliteCaseRepository(composed.db);
    const audit = new SqliteAuditRepository(composed.db);
    const mutations = new SqlMutationService({ db: composed.db, trips, entities });
    const programme = new ProgrammeService({ mutations, entities, trips, sources, audit });

    // ------------------------------------------------------------------
    // Programme setup: funding window rule + two travellers
    // ------------------------------------------------------------------
    const organisation: Organisation = {
      id: `org-${EVENT_ID}`,
      name: 'Synthetic Programme Organiser',
      roles: ['EVENT_ORGANISER', 'PAYER'],
    };
    const places: Place[] = [
      {
        id: EVENT_PLACE,
        name: 'Synthetic Event Airport',
        kind: 'AIRPORT',
        timezone: TZ,
        externalRefs: [{ system: 'airport-code', value: 'EVT' }],
      },
      {
        id: HOME_PLACE,
        name: 'Synthetic Home Airport',
        kind: 'AIRPORT',
        timezone: TZ,
        externalRefs: [{ system: 'airport-code', value: 'HOM' }],
      },
    ];
    const anchorEvent: AnchorEvent = {
      id: EVENT_ID,
      name: 'Synthetic Programme Event',
      kind: 'CONFERENCE',
      placeId: EVENT_PLACE,
      window: { startsAt: '2026-09-07T00:00:00+08:00', endsAt: '2026-09-11T23:59:00+08:00' },
      organiserOrganisationId: organisation.id,
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
    };
    const fundingRuleSet: RuleSet = {
      id: `rs-${EVENT_ID}-funding`,
      kind: 'EVENT',
      name: 'event funding window',
      ownerOrganisationId: organisation.id,
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
    };
    const context = await programme.applyProgrammeContext({
      at: AT,
      sourceId: `src-${EVENT_ID}`,
      organisation,
      anchorEvent,
      places,
      ruleSets: [fundingRuleSet],
    });
    assert.equal(context.accepted, true);

    const draft: ProgrammeImportDraft = {
      id: `import-${EVENT_ID}`,
      anchorEventId: EVENT_ID,
      channel: 'BULK_IMPORT',
      sourceId: `src-${EVENT_ID}`,
      receivedAt: AT,
      travellers: [1, 2].map((n) => ({
        draftId: `draft-${n}`,
        displayName: `Traveller ${String(n).padStart(2, '0')}`,
        identity: { email: `t${n}@example.test` },
        homeLocationText: 'HOM',
        nationalityCodes: ['SG'],
        accessibilityStatements: [],
        notes: [],
        anchorCommitmentIds: [`cmt-${EVENT_ID}-opening`],
      })),
      unresolvedStatements: [],
    };
    const intake = await programme.intakeImportDraft({ importDraft: draft, at: AT });
    assert.equal(intake.outcomes.filter((o) => o.promoted).length, 2);
    const tripId = intake.outcomes[0]!.tripId!;
    const otherTripId = intake.outcomes[1]!.tripId!;
    const travellerId = 'trv-evt-w3a-draft-1';

    // Book BOTH legs through the frozen validated mutation path: arrival in
    // the shared arrival slot (promotion-time constraint subject) + return.
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
    const ret: TransportLeg = {
      id: `el-${tripId}-ret`,
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
        originPlaceId: EVENT_PLACE,
        destinationPlaceId: HOME_PLACE,
        scheduledDeparture: fact('2026-09-11T18:00:00+08:00'),
        scheduledArrival: fact('2026-09-11T19:30:00+08:00'),
        bookingRef: { system: 'flight-provider', reference: 'BOOKED-RET' },
      },
    };
    const trip = (await trips.getTrip(tripId))!;
    await mutations.applyProposal({
      id: 'prop-book-w3a',
      origin: 'SYSTEM',
      sourceId: `src-${EVENT_ID}`,
      requestedAt: AT,
      rationale: 'book synthetic outbound/return legs for the Wave 3 Case A suite',
      operations: [{ op: 'UPSERT_ENTITY', entityType: 'TRIP', id: tripId, data: { ...trip, elements: [...trip.elements, arrival, ret] } }],
    });

    const changeDeps = { trips, entities, signals, cases, audit };

    // ------------------------------------------------------------------
    // Planning capability: ONE two-dimension request plans BOTH dimensions
    // (isolated on the second traveller's trip — its state stays untouched).
    // ------------------------------------------------------------------
    const otherTrip = (await trips.getTrip(otherTripId))!;
    await mutations.applyProposal({
      id: 'prop-book-w3a-b',
      origin: 'SYSTEM',
      sourceId: `src-${EVENT_ID}`,
      requestedAt: AT,
      rationale: 'book synthetic legs for the second traveller',
      operations: [
        {
          op: 'UPSERT_ENTITY',
          entityType: 'TRIP',
          id: otherTripId,
          data: {
            ...otherTrip,
            elements: [
              ...otherTrip.elements,
              { ...arrival, id: `el-${otherTripId}-arrival`, tripId: otherTripId },
              { ...ret, id: `el-${otherTripId}-ret`, tripId: otherTripId },
            ],
          },
        },
      ],
    });
    const combinedRequest: ChangeRequest = {
      id: `cr-${EVENT_ID}-combined`,
      tripId: otherTripId,
      travellerId: 'trv-evt-w3a-draft-2',
      sourceId: 'src-traveller-web',
      authority: 'ASSERTED',
      issuedAt: '2026-09-03T00:00:00+00:00',
      intentKind: 'ADJUST_TRIP_WINDOW',
      urgency: 'SOFT_PREFERENCE',
      utterance: 'I would like to arrive two days earlier, stay through Sunday, and I will pay extra myself',
      target: { arriveBy: '2026-09-04T18:00:00+08:00', departAfter: '2026-09-13T00:00:00+08:00', objectiveEffects: [] },
      fundingDeclaration: 'TRAVELLER_FUNDED',
    };
    const combined = await resolveChangeRequest(changeDeps, { request: combinedRequest, at: '2026-09-03T00:00:00+00:00' });
    assert.equal(combined.accepted, true);
    const combinedPlan = await composed.orchestrator.plan({ caseId: combined.caseId!, at: '2026-09-03T01:00:00+00:00' });
    // DR-8: strategy summaries are user-facing copy and carry a plain-English
    // phrase per window dimension, not the raw enum name.
    assert.ok(
      combinedPlan.strategies.some((s) => s.feasible && /arrive earlier/.test(s.summary)),
      'the combined request plans the arriveBy dimension from its own search evidence',
    );
    assert.ok(
      combinedPlan.strategies.some((s) => s.feasible && /depart later/.test(s.summary)),
      'the combined request plans the departAfter dimension from its own search evidence',
    );

    // ------------------------------------------------------------------
    // Case A demo — request 1: arrive two days earlier
    // ------------------------------------------------------------------
    const request1: ChangeRequest = {
      id: `cr-${EVENT_ID}-earlier`,
      tripId,
      travellerId,
      sourceId: 'src-traveller-web',
      authority: 'ASSERTED',
      issuedAt: '2026-09-03T00:00:00+00:00',
      intentKind: 'ADJUST_TRIP_WINDOW',
      urgency: 'HARD_INSTRUCTION',
      utterance: 'I would like to arrive two days earlier',
      target: { arriveBy: '2026-09-04T18:00:00+08:00', objectiveEffects: [] },
      fundingDeclaration: 'TRAVELLER_FUNDED',
    };
    const outcome1 = await resolveChangeRequest(changeDeps, { request: request1, at: '2026-09-03T00:00:00+00:00' });
    assert.equal(outcome1.accepted, true);
    // Provisional payer decision at request time — amount-agnostic, evidence only.
    assert.ok(
      outcome1.implications.some((line) => /funding payer decision: covered by EVENT_ORGANISATION/.test(line)),
      `provisional window decision is recorded: ${JSON.stringify(outcome1.implications)}`,
    );
    // The funding anchor travels through the signal payload to the intent stage.
    const signal1 = await signals.getSignal(`sig-cr-${request1.id}`);
    assert.equal(signal1?.payload['fundingCostAccruesAt'], '2026-09-04T18:00:00+08:00');
    assert.equal(signal1?.payload['fundingDeclaration'], 'TRAVELLER_FUNDED');

    const plan1 = await composed.orchestrator.plan({ caseId: outcome1.caseId!, at: '2026-09-03T01:00:00+00:00' });
    const best1 = plan1.strategies.find((s) => s.id === plan1.bestStrategyId);
    assert.ok(best1?.feasible, 'an evidence-bound earlier-arrival strategy is feasible');

    const begin1 = await composed.orchestrator.begin({
      caseId: outcome1.caseId!,
      strategyId: plan1.bestStrategyId!,
      at: '2026-09-03T02:00:00+00:00',
    });
    assert.equal(begin1.outcome, 'REQUIRES_TRAVELLER');
    // MIXED FUNDING part 1: cost accrues INSIDE the covered window -> the
    // event organisation pays, even though the traveller offered to.
    assert.ok(begin1.funding, 'allocation is attached where the real cost is known');
    assert.equal(begin1.funding!.allocation.coveredBy, 'EVENT_ORGANISATION');
    assert.equal(begin1.funding!.allocation.incrementalPayer, undefined);
    assert.equal(begin1.funding!.allocation.coveredAmount?.amount, 165);
    assert.deepEqual(begin1.funding!.allocation.derivedFromRuleIds, [`rule-${EVENT_ID}-funded-window`]);

    // Traveller view: the pending prompt names who pays (evidence, not guess).
    const travellerView1 = await composed.endpoints.travellerTrip(tripId, '2026-09-03T02:30:00+00:00');
    assert.ok(
      travellerView1?.inputRequested.some((req) => /covered by the event organisation/.test(req.prompt)),
      `approval prompt carries the allocation: ${JSON.stringify(travellerView1?.inputRequested)}`,
    );

    // Gate: execution without approval is refused.
    const refused = await composed.orchestrator.execute({
      caseId: outcome1.caseId!,
      intentId: begin1.intentId,
      at: '2026-09-03T02:40:00+00:00',
    });
    assert.equal(refused.executed, false);
    assert.ok(refused.gateIssues.length > 0);

    const decide1 = await composed.orchestrator.decide({
      caseId: outcome1.caseId!,
      intentId: begin1.intentId,
      decidedBy: { entityType: 'TRAVELLER', id: travellerId },
      verdict: 'APPROVED',
      at: '2026-09-03T03:00:00+00:00',
    });
    assert.equal(decide1.accepted, true);
    const execute1 = await composed.orchestrator.execute({
      caseId: outcome1.caseId!,
      intentId: begin1.intentId,
      at: '2026-09-03T03:30:00+00:00',
    });
    assert.equal(execute1.executed, true);
    assert.equal(execute1.simulated, true, 'REPLAY execution stays at the simulated boundary');
    // Provider success alone never resolves — verification does.
    assert.equal(execute1.caseStatus, 'RESOLVED');
    assert.equal(execute1.resolutionOutcome, 'FULLY_RECOVERED');

    // Audit evidence carries the deterministic allocation.
    const authorityAudit = await audit.query({ action: 'AUTHORITY_DECIDED', subject: tripId });
    const allocationPayload = authorityAudit[authorityAudit.length - 1]?.payload['costAllocation'] as Record<string, unknown>;
    assert.equal(allocationPayload?.['coveredBy'], 'EVENT_ORGANISATION');

    // Read model evidence: case detail surfaces the allocation per option + case.
    const detail1 = await composed.endpoints.caseDetail(outcome1.caseId!, '2026-09-03T04:00:00+00:00');
    assert.ok(detail1?.funding, 'case detail carries the funding evidence');
    assert.ok(/covered by the event organisation/.test(detail1!.funding!.summary));
    assert.ok(
      detail1!.options.some((option) => option.costAllocation?.coveredBy === 'EVENT_ORGANISATION'),
      'the executed option projects its allocation verbatim',
    );

    // Authoritative state: the arrival slot now carries the new confirmed offer.
    const tripAfter1 = (await trips.getTrip(tripId))!;
    const slotAfter1 = tripAfter1.elements.find((el) => el.id === `el-${tripId}-arrival`);
    assert.equal(slotAfter1?.elementKind === 'TRANSPORT_LEG' ? slotAfter1.data.bookingRef?.reference : undefined, 'opaque-routing-convergence-shift');
    assert.equal(slotAfter1?.reservationState, 'CONFIRMED');

    // ------------------------------------------------------------------
    // Case A demo — request 2: stay through Sunday (depart later)
    // ------------------------------------------------------------------
    const request2: ChangeRequest = {
      id: `cr-${EVENT_ID}-sunday`,
      tripId,
      travellerId,
      sourceId: 'src-traveller-web',
      authority: 'ASSERTED',
      issuedAt: '2026-09-03T04:00:00+00:00',
      intentKind: 'ADJUST_TRIP_WINDOW',
      urgency: 'HARD_INSTRUCTION',
      utterance: 'I will stay through Sunday and pay the extra myself',
      target: { departAfter: '2026-09-13T00:00:00+08:00', objectiveEffects: [] },
      fundingDeclaration: 'TRAVELLER_FUNDED',
    };
    const outcome2 = await resolveChangeRequest(changeDeps, { request: request2, at: '2026-09-03T04:00:00+00:00' });
    assert.equal(outcome2.accepted, true);
    assert.notEqual(outcome2.caseId, outcome1.caseId, 'the resolved first case is not reused');
    // Provisional decision: the anchor sits OUTSIDE every covered window.
    assert.ok(
      outcome2.implications.some((line) => /funding payer decision: incremental payer TRAVELLER/.test(line)),
      `provisional decision names the traveller as incremental payer: ${JSON.stringify(outcome2.implications)}`,
    );

    const plan2 = await composed.orchestrator.plan({ caseId: outcome2.caseId!, at: '2026-09-03T05:00:00+00:00' });
    assert.ok(plan2.bestStrategyId, 'the departure extension receives an evidence-bound strategy');

    const begin2 = await composed.orchestrator.begin({
      caseId: outcome2.caseId!,
      strategyId: plan2.bestStrategyId!,
      at: '2026-09-03T06:00:00+00:00',
    });
    assert.equal(begin2.outcome, 'REQUIRES_TRAVELLER');
    // MIXED FUNDING part 2: cost accrues OUTSIDE the window -> the rule's
    // incrementalPayer (the traveller) pays the extension.
    assert.ok(begin2.funding);
    assert.equal(begin2.funding!.allocation.incrementalPayer, 'TRAVELLER');
    assert.equal(begin2.funding!.allocation.coveredBy, undefined);
    assert.equal(begin2.funding!.allocation.incrementalAmount?.amount, 180);
    assert.deepEqual(begin2.funding!.allocation.derivedFromRuleIds, [`rule-${EVENT_ID}-funded-window`]);

    const travellerView2 = await composed.endpoints.travellerTrip(tripId, '2026-09-03T06:30:00+00:00');
    assert.ok(
      travellerView2?.inputRequested.some((req) => /payable by the traveller/.test(req.prompt)),
      `approval prompt carries the incremental allocation: ${JSON.stringify(travellerView2?.inputRequested)}`,
    );

    await composed.orchestrator.decide({
      caseId: outcome2.caseId!,
      intentId: begin2.intentId,
      decidedBy: { entityType: 'TRAVELLER', id: travellerId },
      verdict: 'APPROVED',
      at: '2026-09-03T07:00:00+00:00',
    });
    const execute2 = await composed.orchestrator.execute({
      caseId: outcome2.caseId!,
      intentId: begin2.intentId,
      at: '2026-09-03T07:30:00+00:00',
    });
    assert.equal(execute2.executed, true);
    assert.equal(execute2.caseStatus, 'RESOLVED');
    assert.equal(execute2.resolutionOutcome, 'FULLY_RECOVERED');

    const tripAfter2 = (await trips.getTrip(tripId))!;
    const retAfter2 = tripAfter2.elements.find((el) => el.id === `el-${tripId}-ret`);
    assert.equal(retAfter2?.elementKind === 'TRANSPORT_LEG' ? retAfter2.data.bookingRef?.reference : undefined, 'opaque-routing-w3-depart-late');
    assert.equal(retAfter2?.reservationState, 'CONFIRMED');

    // Whole-trip reverification: after BOTH funded changes the trip is viable.
    const travellerViewFinal = await composed.endpoints.travellerTrip(tripId, '2026-09-03T08:00:00+00:00');
    assert.equal(travellerViewFinal?.remainderViable, 'VIABLE');

    // Isolation: the second traveller's trip kept its original bookings.
    const otherTripAfter = (await trips.getTrip(otherTripId))!;
    const otherArrival = otherTripAfter.elements.find((el) => el.id === `el-${otherTripId}-arrival`);
    assert.equal(otherArrival?.elementKind === 'TRANSPORT_LEG' ? otherArrival.data.bookingRef?.reference : undefined, 'BOOKED-OUT');
  } finally {
    composed.db.close();
  }
});

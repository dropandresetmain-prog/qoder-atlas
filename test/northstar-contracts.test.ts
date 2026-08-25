/**
 * RV-N0 — Northstar contract-freeze evidence.
 *
 * Proves, with schemas only (no feature implementation):
 *   A. AnchorCommitment linkage: event -> commitment -> per-trip engagement,
 *      with per-traveller importance, never global commitment hardness.
 *   B. Programme intake drafts are pre-authoritative and channel-neutral.
 *   C. Incomplete trips + INITIAL_PLANNING case kind (same engine, no fork).
 *   D. ChangeRequest/ResolutionTarget express three representative traveller
 *      requests through one declarative schema that cannot carry mutations.
 *   E. FUNDED_WINDOW policy + deterministic CostAllocation shape.
 *   F. ANCHOR_COMMITMENT_CHANGE is a first-class signal, payload-validated.
 *   G. ProgrammeView projects operator state over a whole programme.
 *   H/I. Hotel + transfer capability vocabularies stay tool-safe (read-only
 *        tool ops remain a subset of capability ops; consequential ops exist
 *        only for the authority path).
 *   J. Extracted temporals are normalized deterministically before promotion;
 *      unnormalizable time stays uncertainty, never an executable rule.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AnchorCommitmentSchema,
  AnchorEventSchema,
  PlaceSchema,
} from '../src/domain/entities.ts';
import { EngagementSchema } from '../src/domain/elements.ts';
import { TripSchema } from '../src/domain/trip.ts';
import { PolicyRuleSchema, RuleSetSchema } from '../src/domain/rules.ts';
import {
  AnchorCommitmentChangePayloadSchema,
  TripSignalSchema,
} from '../src/operational/signal.ts';
import { CaseKindSchema, CaseStatusSchema, RecoveryCaseSchema } from '../src/operational/case.ts';
import {
  CapabilityOperationSchema,
  CostAllocationSchema,
} from '../src/operational/intent.ts';
import {
  CapabilityFamilySchema,
  ToolOperationSchema,
  TOOL_OPERATION_FAMILY,
} from '../src/operational/strategy.ts';
import {
  ChangeRequestSchema,
  ResolutionTargetSchema,
} from '../src/contracts/changeRequest.ts';
import {
  ProgrammeImportDraftSchema,
  ProgrammeTravellerDraftSchema,
  PromotionOutcomeSchema,
} from '../src/contracts/programmeIntake.ts';
import type { ProgrammeView } from '../src/contracts/readmodels.ts';
import {
  normalizeExtractedTemporal,
  normalizeRuleDraftTemporals,
} from '../src/ingest/temporal.ts';

const AT = '2026-10-01T12:00:00+08:00';
const SOURCE = 'src_programme_brief_1';

test('G3R: gateway associations and declarative departure origins remain generic schema data', () => {
  const place = PlaceSchema.parse({
    id: 'place_venue',
    name: 'Conference venue',
    kind: 'VENUE',
    servedByPlaceIds: ['place_gateway'],
  });
  assert.deepEqual(place.servedByPlaceIds, ['place_gateway']);

  const target = ResolutionTargetSchema.parse({
    departureOrigin: { system: 'airport-code', value: 'ABC' },
  });
  assert.deepEqual(target.departureOrigin, { system: 'airport-code', value: 'ABC' });
  assert.equal(
    ResolutionTargetSchema.safeParse({ departureOrigin: { system: 'airport-code', value: 'ABC', route: 'forbidden' } }).success,
    false,
    'origin declaration is not a provider-action-shaped route payload',
  );
});

// ---------------------------------------------------------------------------
// A. AnchorCommitment linkage
// ---------------------------------------------------------------------------

test('anchor commitments: addressable event children without global hardness', () => {
  const commitment = AnchorCommitmentSchema.parse({
    id: 'ac_keynote_1',
    anchorEventId: 'ae_1',
    title: 'Opening session',
    kind: 'SESSION',
    placeId: 'place_venue',
    startsAt: { value: '2026-10-03T10:00:00+08:00', sourceId: SOURCE, authority: 'AUTHORITATIVE', observedAt: AT },
  });
  assert.equal(commitment.anchorEventId, 'ae_1');
  // No importance/hardness field exists on commitments; per-traveller binding
  // lives on the engagement element itself.
  assert.ok(!('importance' in commitment));
  assert.ok(!('hardness' in commitment));

  const event = AnchorEventSchema.parse({
    id: 'ae_1',
    name: 'Programme event',
    kind: 'CONFERENCE',
    window: { startsAt: '2026-10-02T09:00:00+08:00', endsAt: '2026-10-04T18:00:00+08:00' },
    commitments: [commitment],
  });
  assert.equal(event.commitments.length, 1);

  // AnchorEvent without commitments still parses (Checkpoint-C compatibility).
  const bare = AnchorEventSchema.parse({
    id: 'ae_2',
    name: 'Legacy event',
    kind: 'OFFSITE',
    window: { startsAt: '2026-10-02T09:00:00+08:00', endsAt: '2026-10-04T18:00:00+08:00' },
  });
  assert.deepEqual(bare.commitments, []);
});

test('anchor commitments: engagements link the same commitment with differing importance', () => {
  const base = {
    elementKind: 'ENGAGEMENT',
    tripId: 'trip_1',
    importance: 'REQUIRED',
    flexibility: 'FIXED',
    reservationState: 'NONE',
    status: 'UNKNOWN',
    data: {
      title: 'Opening session',
      placeId: 'place_venue',
      startsAt: { value: '2026-10-03T10:00:00+08:00', sourceId: SOURCE, authority: 'CONNECTED', observedAt: AT },
      anchorEventId: 'ae_1',
      anchorCommitmentId: 'ac_keynote_1',
      participantRole: 'presenter',
    },
  };
  const speaker = EngagementSchema.parse({ ...base, id: 'el_eng_speaker', importance: 'REQUIRED' });
  const attendee = EngagementSchema.parse({ ...base, id: 'el_eng_attendee', importance: 'OPTIONAL', tripId: 'trip_2' });
  assert.equal(speaker.data.anchorCommitmentId, attendee.data.anchorCommitmentId);
  assert.notEqual(speaker.importance, attendee.importance);
});

// ---------------------------------------------------------------------------
// B. Programme intake drafts
// ---------------------------------------------------------------------------

test('programme intake: one schema serves manual, bulk and LLM channels', () => {
  for (const channel of ['MANUAL_ENTRY', 'BULK_IMPORT', 'LLM_MAPPED', 'LATER_UPDATE'] as const) {
    const importDraft = ProgrammeImportDraftSchema.parse({
      id: `import_${channel.toLowerCase()}`,
      anchorEventId: 'ae_1',
      channel,
      sourceId: SOURCE,
      receivedAt: AT,
      travellers: [
        ProgrammeTravellerDraftSchema.parse({
          draftId: `draft_${channel.toLowerCase()}_1`,
          displayName: 'Traveller One',
          anchorCommitmentIds: ['ac_keynote_1'],
        }),
      ],
    });
    assert.equal(importDraft.travellers.length, 1);
  }
});

test('programme intake: sparse drafts are valid; authority only via promotion', () => {
  const sparse = ProgrammeTravellerDraftSchema.parse({
    draftId: 'draft_sparse',
    displayName: 'Only a name',
  });
  assert.deepEqual(sparse.identity, {});
  assert.deepEqual(sparse.anchorCommitmentIds, []);

  // Drafts carry no EntityId assignment and no trip mutation surface.
  assert.ok(!('travellerId' in sparse));
  assert.ok(!('tripId' in sparse));

  const outcome = PromotionOutcomeSchema.parse({
    draftId: 'draft_sparse',
    promoted: false,
    issues: ['home location could not be resolved to a place'],
  });
  assert.equal(outcome.promoted, false);
});

// ---------------------------------------------------------------------------
// C. Incomplete trips and initial planning cases
// ---------------------------------------------------------------------------

test('initial planning: a trip may exist with zero elements and UNKNOWN viability', () => {
  const trip = TripSchema.parse({
    id: 'trip_empty_1',
    travellerIds: ['trv_1'],
    anchorEventId: 'ae_1',
    updatedAt: AT,
  });
  assert.deepEqual(trip.elements, []);
  assert.deepEqual(trip.objectives, []);
  assert.equal(trip.viability, 'UNKNOWN');
});

test('initial planning: cases carry a kind flag without forking the lifecycle', () => {
  assert.deepEqual(CaseKindSchema.options, ['RECOVERY', 'INITIAL_PLANNING']);
  const initialCase = RecoveryCaseSchema.parse({
    id: 'case_initial_1',
    tripId: 'trip_empty_1',
    caseKind: 'INITIAL_PLANNING',
    status: 'DETECTED',
    openedAt: AT,
    updatedAt: AT,
  });
  assert.equal(initialCase.caseKind, 'INITIAL_PLANNING');
  assert.ok(CaseStatusSchema.options.includes('RESOLVED'));

  // Legacy cases without the flag default to RECOVERY (backward compatible).
  const legacyCase = RecoveryCaseSchema.parse({
    id: 'case_legacy_1',
    tripId: 'trip_1',
    status: 'DETECTED',
    openedAt: AT,
    updatedAt: AT,
  });
  assert.equal(legacyCase.caseKind, 'RECOVERY');
});

// ---------------------------------------------------------------------------
// D. ChangeRequest / ResolutionTarget
// ---------------------------------------------------------------------------

test('change requests: case A — arrive earlier + depart later, self-funded extension', () => {
  const request = ChangeRequestSchema.parse({
    id: 'cr_1',
    tripId: 'trip_1',
    travellerId: 'trv_1',
    sourceId: SOURCE,
    authority: 'ASSERTED',
    issuedAt: AT,
    intentKind: 'ADJUST_TRIP_WINDOW',
    urgency: 'SOFT_PREFERENCE',
    utterance: 'Can I arrive two days earlier and stay through Sunday? I will pay for the extra nights.',
    target: {
      arriveBy: '2026-10-01T18:00:00+08:00',
      departAfter: '2026-10-05T09:00:00+08:00',
    },
    fundingDeclaration: 'TRAVELLER_FUNDED',
  });
  assert.equal(request.fundingDeclaration, 'TRAVELLER_FUNDED');
  assert.ok(request.target.arriveBy);
  assert.ok(request.target.departAfter);
});

test('change requests: case A2 — later flight, prefer direct', () => {
  const request = ChangeRequestSchema.parse({
    id: 'cr_2',
    tripId: 'trip_1',
    travellerId: 'trv_1',
    sourceId: SOURCE,
    authority: 'ASSERTED',
    issuedAt: AT,
    intentKind: 'CHANGE_TRANSPORT_SCHEDULE',
    urgency: 'SOFT_PREFERENCE',
    target: {
      transport: { preferDirect: true, earliestDeparture: '2026-10-02T12:00:00+08:00' },
    },
  });
  assert.equal(request.target.transport?.preferDirect, true);
});

test('change requests: case A3 — hotel closer to the venue', () => {
  const request = ChangeRequestSchema.parse({
    id: 'cr_3',
    tripId: 'trip_1',
    travellerId: 'trv_1',
    sourceId: SOURCE,
    authority: 'ASSERTED',
    issuedAt: AT,
    intentKind: 'CHANGE_STAY',
    urgency: 'SOFT_PREFERENCE',
    target: {
      preferredStayProximityRef: { entityType: 'PLACE', id: 'place_venue' },
    },
  });
  assert.equal(request.target.preferredStayProximityRef?.id, 'place_venue');
});

test('change requests: target state is declarative and cannot carry mutations', () => {
  // The resolution target has no slot for element payloads, booking ids or
  // provider operations: desires never encode state changes.
  assert.throws(() =>
    ResolutionTargetSchema.parse({
      candidateOperations: [{ op: 'UPSERT_ENTITY', entityType: 'TRIP_ELEMENT' }],
    }),
  );
  assert.throws(() =>
    ResolutionTargetSchema.parse({
      elementId: 'el_flight_1',
      newSchedule: '2026-10-02T08:00:00+08:00',
    }),
  );
  const request = ChangeRequestSchema.parse({
    id: 'cr_plain',
    tripId: 'trip_1',
    travellerId: 'trv_1',
    sourceId: SOURCE,
    authority: 'ASSERTED',
    issuedAt: AT,
    intentKind: 'OTHER',
    urgency: 'HARD_INSTRUCTION',
    target: {},
  });
  assert.deepEqual(request.target.objectiveEffects, []);
});

// ---------------------------------------------------------------------------
// E. Mixed funding
// ---------------------------------------------------------------------------

test('funding: FUNDED_WINDOW rule and cost allocation are deterministic shapes', () => {
  const rule = PolicyRuleSchema.parse({
    id: 'rule_funded_window',
    sourceId: SOURCE,
    kind: 'FUNDED_WINDOW',
    windowStart: '2026-09-30T00:00:00+08:00',
    windowEnd: '2026-10-03T23:59:00+08:00',
    coveredBy: 'EVENT_ORGANISATION',
    incrementalPayer: 'TRAVELLER',
  });
  assert.equal(rule.kind, 'FUNDED_WINDOW');

  const ruleSet = RuleSetSchema.parse({
    id: 'rs_event_policy',
    kind: 'EVENT',
    name: 'Programme travel policy',
    sourceId: SOURCE,
    rules: [rule],
  });
  assert.equal(ruleSet.rules.length, 1);

  const allocation = CostAllocationSchema.parse({
    coveredAmount: { amount: 320, currency: 'SGD' },
    incrementalAmount: { amount: 480, currency: 'SGD' },
    coveredBy: 'EVENT_ORGANISATION',
    incrementalPayer: 'TRAVELLER',
    derivedFromRuleIds: ['rule_funded_window'],
  });
  assert.equal(allocation.incrementalPayer, 'TRAVELLER');
});

// ---------------------------------------------------------------------------
// F. Event-side change signal
// ---------------------------------------------------------------------------

test('event-side change: ANCHOR_COMMITMENT_CHANGE is its own signal kind with a typed payload', () => {
  const payload = AnchorCommitmentChangePayloadSchema.parse({
    anchorEventId: 'ae_1',
    commitmentId: 'ac_keynote_1',
    changeKind: 'RESCHEDULED',
    newStartsAt: '2026-10-03T10:00:00+08:00',
    summary: 'Shared programme item moved earlier',
  });
  const signal = TripSignalSchema.parse({
    id: 'sig_event_change_1',
    kind: 'ANCHOR_COMMITMENT_CHANGE',
    occurredAt: AT,
    sourceId: SOURCE,
    authority: 'AUTHORITATIVE',
    payload,
  });
  assert.equal(signal.kind, 'ANCHOR_COMMITMENT_CHANGE');
  // The signal carries no tripId: fan-out resolves affected trips generically.
  assert.equal(signal.tripId, undefined);

  // Misuse guard: an invalid payload shape is rejected, not reinterpreted.
  assert.throws(() => AnchorCommitmentChangePayloadSchema.parse({ changeKind: 'RESCHEDULED' }));
});

// ---------------------------------------------------------------------------
// G. Programme read model
// ---------------------------------------------------------------------------

test('programme read model: projection shape covers status rollup and endangered commitments', () => {
  const view: ProgrammeView = {
    generatedAt: AT,
    anchorEventId: 'ae_1',
    anchorEventName: 'Programme event',
    summary: {
      total: 42,
      ready: 30,
      planning: 5,
      needsTravellerInfo: 2,
      changeRequested: 1,
      atRisk: 1,
      disrupted: 1,
      recovering: 1,
      awaitingDecision: 1,
      resolved: 1,
      unknown: 0,
    },
    arrangementCounts: { total: 42, northstarArranged: 40, selfOrOtherArranged: 1, unspecified: 1 },
    travellers: [
      {
        tripId: 'trip_1',
        travellerId: 'trv_1',
        travellerName: 'Traveller One',
        status: 'READY',
        activeCaseIds: [],
        decisionsRequired: 0,
        uncertainties: [],
        updatedAt: AT,
      },
    ],
    endangeredCommitments: [
      {
        commitmentId: 'ac_keynote_1',
        title: 'Opening session',
        reason: 'engagement arrival buffer fails after commitment reschedule',
        affectedTravellerIds: ['trv_1'],
      },
    ],
    unresolvedUncertainties: ['replacement flight seat availability'],
  };
  assert.equal(view.summary.total, 42);
  assert.equal(view.endangeredCommitments.length, 1);
});

// ---------------------------------------------------------------------------
// H/I. Capability vocabulary safety
// ---------------------------------------------------------------------------

test('hotel + transfer vocabulary: read-only tool ops stay a subset of capability ops', () => {
  const capabilityOperations = new Set<string>(CapabilityOperationSchema.options);
  for (const operation of ToolOperationSchema.options) {
    assert.ok(capabilityOperations.has(operation), `tool op not a capability op: ${operation}`);
    assert.ok(TOOL_OPERATION_FAMILY[operation], `missing family mapping for ${operation}`);
  }
  // The planner must never gain the consequential entries.
  const toolSet = new Set<string>(ToolOperationSchema.options);
  for (const consequential of ['hotel.book', 'hotel.modify', 'hotel.cancel', 'transfer.book', 'transfer.amend', 'transfer.cancel']) {
    assert.ok(capabilityOperations.has(consequential), `missing capability op ${consequential}`);
    assert.ok(!toolSet.has(consequential), `consequential op leaked into tool vocabulary: ${consequential}`);
  }
  assert.ok(CapabilityFamilySchema.options.includes('TRANSFER'));
});

// ---------------------------------------------------------------------------
// J. Policy extraction temporal safety
// ---------------------------------------------------------------------------

test('temporal normalization: offset-bearing values pass through untouched', () => {
  const input = '2026-10-03T15:00:00+08:00';
  assert.equal(normalizeExtractedTemporal(input), input);
});

test('temporal normalization: naive datetimes normalize only with an explicit timezone', () => {
  const normalized = normalizeExtractedTemporal('2026-10-03T15:00', 'Asia/Singapore');
  assert.equal(normalized, '2026-10-03T15:00:00+08:00');

  const dateOnly = normalizeExtractedTemporal('2026-10-03', 'Asia/Singapore');
  assert.equal(dateOnly, '2026-10-03T00:00:00+08:00');

  // Without a timezone there is no honest answer: never guess an offset.
  assert.equal(normalizeExtractedTemporal('2026-10-03T15:00'), undefined);
  assert.equal(normalizeExtractedTemporal('2026-10-03T15:00', 'Not/AZone'), undefined);
  assert.equal(normalizeExtractedTemporal('3 Oct 2026 3pm', 'Asia/Singapore'), undefined);
});

test('temporal normalization: rule drafts promote normalized temporals, reject the rest', () => {
  const draft = {
    kind: 'TIME_WINDOW',
    windowStart: '2026-10-02T08:00',
    windowEnd: '2026-10-04T18:00',
  };
  const normalized = normalizeRuleDraftTemporals(draft, 'Asia/Singapore');
  const parsed = PolicyRuleSchema.safeParse({ id: 'rule_1', sourceId: SOURCE, ...normalized });
  assert.equal(parsed.success, true, 'timezone-anchored draft must promote');

  const hopeless = normalizeRuleDraftTemporals({ ...draft, windowStart: 'Oct 2nd morning' }, 'Asia/Singapore');
  const rejected = PolicyRuleSchema.safeParse({ id: 'rule_2', sourceId: SOURCE, ...hopeless });
  assert.equal(rejected.success, false, 'unnormalizable temporal must stay out of executable policy');
});

/**
 * F1 evidence — T-DOM: domain/schema contract proofs.
 * Proves the contracts can express the accepted scenario dimensions without
 * scenario-specific entity types.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ConstraintSchema,
  ConstraintStatusSchema,
  EntityTypeSchema,
  FactSchema,
  FACT_AUTHORITY_RANK,
  resolveAuthoritativeFact,
  isFactStale,
  IsoDateTimeSchema,
  TripElementSchema,
  TripSchema,
  RuleSetSchema,
} from '../src/domain/index.ts';
import {
  PreferenceSchema,
  dominatingPreference,
  preferencePrecedence,
} from '../src/domain/preferences.ts';
import {
  RecoveryCaseSchema,
  ResolutionOutcomeSchema,
  isLegalCaseTransition,
} from '../src/operational/case.ts';
import { MutationProposalSchema, ENTITY_SCHEMA_BY_TYPE } from '../src/operational/mutation.ts';

const AT = '2026-09-14T09:00:00+09:00';

test('transport: required + flexible + unbooked/on-demand leg is representable', () => {
  const transfer = {
    id: 'el_transfer',
    tripId: 'trip_1',
    elementKind: 'TRANSPORT_LEG',
    importance: 'REQUIRED',
    flexibility: 'FLEXIBLE',
    reservationState: 'NONE',
    data: {
      mode: 'TAXI_OR_RIDEHAIL',
      originPlaceId: 'plc_airport',
      destinationPlaceId: 'plc_hotel',
    },
  };
  const parsed = TripElementSchema.parse(transfer);
  assert.equal(parsed.importance, 'REQUIRED');
  assert.equal(parsed.flexibility, 'FLEXIBLE');
  assert.equal(parsed.reservationState, 'NONE');
  assert.equal(parsed.status, 'VALID'); // defaulted, not fabricated

  // And required + changeable + confirmed (the flight shape) is equally valid.
  const flight = TripElementSchema.parse({
    id: 'el_flight',
    tripId: 'trip_1',
    elementKind: 'TRANSPORT_LEG',
    importance: 'REQUIRED',
    flexibility: 'CHANGEABLE',
    reservationState: 'CONFIRMED',
    data: {
      mode: 'FLIGHT',
      originPlaceId: 'plc_a',
      destinationPlaceId: 'plc_b',
      scheduledDeparture: { value: AT, sourceId: 'src_provider', authority: 'AUTHORITATIVE', observedAt: AT },
      bookingRef: { system: 'provider-x', reference: 'REF1' },
    },
  });
  assert.equal(flight.elementKind, 'TRANSPORT_LEG');
});

test('constraints: PASS, FAIL and UNKNOWN are distinct and enforced', () => {
  assert.deepEqual(ConstraintStatusSchema.options, ['PASS', 'FAIL', 'UNKNOWN']);
  for (const status of ['PASS', 'FAIL', 'UNKNOWN'] as const) {
    const parsed = ConstraintSchema.parse({
      id: `c_${status.toLowerCase()}`,
      kind: 'TEMPORAL',
      hardness: 'HARD',
      evaluator: 'DETERMINISTIC',
      status,
    });
    assert.equal(parsed.status, status);
  }
  assert.throws(() => ConstraintSchema.parse({
    id: 'c_bad',
    kind: 'TEMPORAL',
    hardness: 'HARD',
    evaluator: 'DETERMINISTIC',
    status: 'MOSTLY_FINE',
  }));
});

test('preferences: explicit instruction outranks latent preference', () => {
  const explicit = PreferenceSchema.parse({
    id: 'pref_explicit',
    travellerId: 'trv_1',
    tripId: 'trip_1',
    statement: 'Get me there in time for the keynote, dinner is secondary',
    origin: { kind: 'EXPLICIT_INSTRUCTION', issuedAt: AT, issuedBy: 'trv_1' },
    sourceId: 'src_chat',
  });
  const latent = PreferenceSchema.parse({
    id: 'pref_latent',
    travellerId: 'trv_1',
    statement: 'Usually prefers direct flights',
    origin: { kind: 'LATENT_INFERRED', evidence: 'historical bookings', confidence: 0.6 },
    sourceId: 'src_inference',
  });
  assert.ok(preferencePrecedence(explicit) > preferencePrecedence(latent));
  assert.equal(dominatingPreference(explicit, latent), explicit);
  assert.equal(dominatingPreference(latent, explicit), explicit);
});

test('facts: authority, confidence and freshness are representable and resolvable', () => {
  const factSchema = FactSchema(IsoDateTimeSchema);
  const providerFact = factSchema.parse({
    value: AT,
    sourceId: 'src_provider_state',
    authority: 'AUTHORITATIVE',
    observedAt: AT,
    verifiedAt: AT,
    validUntil: '2026-09-14T23:59:00+09:00',
  });
  const emailFact = factSchema.parse({
    value: AT,
    sourceId: 'src_email',
    authority: 'CONNECTED',
    confidence: 0.8,
    observedAt: '2026-09-10T10:00:00+09:00',
  });
  assert.ok(FACT_AUTHORITY_RANK[providerFact.authority] > FACT_AUTHORITY_RANK[emailFact.authority]);
  assert.equal(resolveAuthoritativeFact(emailFact, providerFact), providerFact);
  assert.equal(isFactStale(providerFact, '2026-09-15T00:30:00+09:00'), true);
  assert.equal(isFactStale(providerFact, '2026-09-14T12:00:00+09:00'), false);
});

test('cases: FULLY_RECOVERED and RECOVERED_WITH_LOSS resolutions are representable', () => {
  assert.ok(ResolutionOutcomeSchema.parse('FULLY_RECOVERED'));
  assert.ok(ResolutionOutcomeSchema.parse('RECOVERED_WITH_LOSS'));

  const base = {
    id: 'case_1',
    tripId: 'trip_1',
    status: 'RESOLVED',
    openedAt: AT,
    updatedAt: AT,
  };
  const full = RecoveryCaseSchema.parse({
    ...base,
    resolution: { outcome: 'FULLY_RECOVERED', resolvedAt: AT },
  });
  const withLoss = RecoveryCaseSchema.parse({
    ...base,
    resolution: {
      outcome: 'RECOVERED_WITH_LOSS',
      resolvedAt: AT,
      remainingLossRefs: ['obj_dinner'],
    },
  });
  assert.equal(full.resolution?.outcome, 'FULLY_RECOVERED');
  assert.equal(withLoss.resolution?.outcome, 'RECOVERED_WITH_LOSS');
  assert.throws(() => ResolutionOutcomeSchema.parse('PARTIALLY_OK'));

  // State machine guards: VERIFYING may loop back; RESOLVED is terminal.
  assert.equal(isLegalCaseTransition('VERIFYING', 'ASSESSING'), true);
  assert.equal(isLegalCaseTransition('RESOLVED', 'EXECUTING'), false);
});

test('ontology: entity vocabulary is closed and scenario-neutral', () => {
  assert.deepEqual(EntityTypeSchema.options, [
    'ORGANISATION',
    'TRAVELLER',
    'ANCHOR_EVENT',
    'TRIP',
    'TRIP_ELEMENT',
    'TRIP_OBJECTIVE',
    'PLACE',
    'RULE_SET',
    'CONSTRAINT',
  ]);
  // Every declared entity type has a deterministic validation schema.
  for (const type of EntityTypeSchema.options) {
    assert.ok(ENTITY_SCHEMA_BY_TYPE[type], `missing schema for ${type}`);
  }
});

test('mutations: bounded vocabulary rejects unknown operations and entity types', () => {
  const valid = MutationProposalSchema.parse({
    id: 'mp_1',
    origin: 'AI',
    requestedAt: AT,
    operations: [
      { op: 'UPSERT_FACT', target: { entityType: 'TRIP_ELEMENT', id: 'el_flight' }, factPath: 'data.scheduledArrival', value: AT, sourceId: 'src_provider', authority: 'AUTHORITATIVE' },
      { op: 'WAIVE_OR_REPRIORITIZE_OBJECTIVE', objectiveId: 'obj_dinner', action: 'REPRIORITY', newHardness: 'SOFT', by: { entityType: 'TRAVELLER', id: 'trv_1' } },
    ],
  });
  assert.equal(valid.operations.length, 2);

  assert.throws(() => MutationProposalSchema.parse({
    id: 'mp_2',
    origin: 'AI',
    requestedAt: AT,
    operations: [{ op: 'DELETE_ANYTHING', target: 'whatever' }],
  }));
  assert.throws(() => MutationProposalSchema.parse({
    id: 'mp_3',
    origin: 'AI',
    requestedAt: AT,
    operations: [{ op: 'UPSERT_ENTITY', entityType: 'SPEAKER_DINNER_EVENT', data: {} }],
  }));
  assert.throws(() => MutationProposalSchema.parse({
    id: 'mp_empty',
    origin: 'AI',
    requestedAt: AT,
    operations: [],
  }));
});

test('trip aggregate: generic two-traveller trip with rules and objectives parses', () => {
  const trip = TripSchema.parse({
    id: 'trip_generic',
    travellerIds: ['trv_1'],
    updatedAt: AT,
    objectives: [{ id: 'obj_1', tripId: 'trip_generic', statement: 'Reach the meeting on time', hardness: 'HARD' }],
    governedByRuleSetIds: ['rs_policy'],
  });
  assert.equal(trip.objectives[0]?.status, 'ACTIVE');
  assert.equal(trip.viability, 'UNKNOWN');
  assert.equal(trip.version, 0);
});

test('rule sets: insurance/organisation/supplier rules parse generically', () => {
  const ruleSet = RuleSetSchema.parse({
    id: 'rs_insurance',
    kind: 'INSURANCE',
    name: 'Travel protection policy',
    sourceId: 'src_insurance_doc',
    rules: [
      {
        id: 'rule_cover_delay',
        kind: 'INSURANCE_COVERAGE',
        sourceId: 'src_insurance_doc',
        coveredReasons: ['trip_delay', 'missed_connection'],
        maxPayout: { amount: 500, currency: 'USD' },
      },
    ],
  });
  assert.equal(ruleSet.rules.length, 1);
  assert.throws(() => RuleSetSchema.parse({ id: 'rs_x', kind: 'MAGIC', name: 'x', sourceId: 's', rules: [] }));
});

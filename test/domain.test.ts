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
  compareInstants,
  instantMillis,
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
import { z } from 'zod';

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
  // Unevaluated elements default to UNKNOWN: missing evidence must not
  // become fabricated VALID certainty. An evaluated state must be asserted
  // explicitly (as the scenarios do for their pre-disruption state).
  assert.equal(parsed.status, 'UNKNOWN');
  const evaluated = TripElementSchema.parse({ ...transfer, status: 'VALID' });
  assert.equal(evaluated.status, 'VALID');

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

test('timestamps: ordering is chronological across differing UTC offsets, not lexical', () => {
  // 01:00Z expressed at +09:00 vs 02:30Z expressed at +00:00.
  // Lexically '2026-09-14T10:00:00+09:00' > '2026-09-14T02:30:00+00:00',
  // but chronologically the +00:00 instant is 90 minutes LATER.
  const lexicalWinnerButEarlier = '2026-09-14T10:00:00+09:00';
  const lexicalLoserButLater = '2026-09-14T02:30:00+00:00';

  assert.equal(instantMillis(lexicalWinnerButEarlier), Date.parse('2026-09-14T01:00:00Z'));
  assert.equal(compareInstants(lexicalWinnerButEarlier, lexicalLoserButLater), -1);
  assert.equal(compareInstants(lexicalLoserButLater, lexicalWinnerButEarlier), 1);
  assert.equal(compareInstants('2026-09-14T10:00:00+09:00', '2026-09-14T01:00:00+00:00'), 0);
  assert.throws(() => instantMillis('not-a-timestamp'), RangeError);

  // Truth-resolution on equal authority must pick the chronologically
  // fresher observation even when lexical order disagrees.
  const factSchema = FactSchema(z.string());
  const earlier = factSchema.parse({
    value: 'old',
    sourceId: 'src_1',
    authority: 'CONNECTED',
    observedAt: lexicalWinnerButEarlier,
  });
  const later = factSchema.parse({
    value: 'new',
    sourceId: 'src_2',
    authority: 'CONNECTED',
    observedAt: lexicalLoserButLater,
  });
  assert.equal(resolveAuthoritativeFact(earlier, later), later);
  assert.equal(resolveAuthoritativeFact(later, earlier), later);

  // Freshness across offsets: validUntil 2026-09-13T20:00Z expressed at
  // +09:00 is chronologically BEFORE now 2026-09-13T21:30Z, although the
  // lexical comparison ('2026-09-14...' > '2026-09-13...') would say fresh.
  const staleAcrossOffsets = { validUntil: '2026-09-14T05:00:00+09:00' };
  assert.equal(isFactStale(staleAcrossOffsets, '2026-09-13T21:30:00+00:00'), true);
  assert.equal(isFactStale(staleAcrossOffsets, '2026-09-13T19:00:00+00:00'), false);
  assert.equal(isFactStale({}, '2026-09-13T21:30:00+00:00'), false);
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

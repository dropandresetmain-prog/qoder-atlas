/**
 * A1 evidence — validated authoritative mutation (T-PROP mutation subset).
 * Only validated proposals mutate; invalid proposals are rejected atomically;
 * lower-authority/stale evidence never silently replaces stronger evidence;
 * provenance, audit and versions stay coherent.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { openDatabase } from '../src/persistence/database.ts';
import { SqliteTripRepository, SqliteAuditRepository } from '../src/persistence/repositories.ts';
import { SqliteEntityStore } from '../src/persistence/entityStore.ts';
import { SqlMutationService } from '../src/engine/mutation.ts';
import type { MutationProposal } from '../src/operational/mutation.ts';
import type { Trip } from '../src/domain/trip.ts';

const NOW = '2026-08-20T12:00:00+00:00';

function harness() {
  const db = openDatabase(':memory:');
  const trips = new SqliteTripRepository(db);
  const entities = new SqliteEntityStore(db);
  const audit = new SqliteAuditRepository(db);
  const mutations = new SqlMutationService({ db, trips, entities });
  return { db, trips, entities, audit, mutations };
}

function seedTrip(): Trip {
  return {
    id: 'trip_m1',
    travellerIds: ['trv_m1'],
    elements: [
      {
        id: 'el_m_flight',
        tripId: 'trip_m1',
        elementKind: 'TRANSPORT_LEG',
        importance: 'REQUIRED',
        flexibility: 'CHANGEABLE',
        reservationState: 'CONFIRMED',
        status: 'VALID',
        dependsOn: [],
        governedByRuleSetIds: [],
        data: {
          mode: 'FLIGHT',
          originPlaceId: 'plc_m_origin',
          destinationPlaceId: 'plc_m_dest',
          scheduledDeparture: {
            value: '2026-09-01T08:00:00+09:00',
            sourceId: 'src_m_provider',
            authority: 'AUTHORITATIVE',
            observedAt: '2026-08-19T09:00:00+09:00',
          },
          scheduledArrival: {
            value: '2026-09-01T11:00:00+09:00',
            sourceId: 'src_m_provider',
            authority: 'AUTHORITATIVE',
            observedAt: '2026-08-19T09:00:00+09:00',
          },
        },
      },
    ],
    objectives: [
      {
        id: 'obj_m1',
        tripId: 'trip_m1',
        statement: 'Attend the meeting',
        hardness: 'HARD',
        status: 'ACTIVE',
        linkedElementIds: ['el_m_flight'],
      },
    ],
    relations: [],
    governedByRuleSetIds: [],
    viability: 'UNKNOWN',
    version: 0,
    updatedAt: NOW,
  };
}

function proposal(overrides: Partial<MutationProposal>): MutationProposal {
  return {
    id: 'prop_m1',
    origin: 'SYSTEM',
    requestedAt: NOW,
    operations: [],
    ...overrides,
  };
}

test('mutation: schema-invalid proposal is rejected and audited', async () => {
  const { trips, mutations, audit } = harness();
  await trips.saveTrip(seedTrip());
  const bad = { ...proposal({}), operations: [] } as unknown as MutationProposal;
  const outcome = await mutations.applyProposal(bad);
  assert.equal(outcome.accepted, false);
  assert.ok(outcome.issues.some((i) => i.code === 'PROPOSAL_SCHEMA_INVALID'));
  const stored = await trips.getTrip('trip_m1');
  assert.equal(stored?.version, 0, 'no state change on rejection');
  const entries = await audit.query({ action: 'MUTATION_REJECTED' });
  assert.equal(entries.length, 1);
});

test('mutation: unknown entity type payload is rejected', async () => {
  const { trips, mutations } = harness();
  await trips.saveTrip(seedTrip());
  const outcome = await mutations.applyProposal(
    proposal({
      operations: [
        {
          op: 'UPSERT_ENTITY',
          entityType: 'TRIP_ELEMENT',
          data: { elementKind: 'HOVERCRAFT', id: 'el_bad', tripId: 'trip_m1' },
        },
      ],
    }),
  );
  assert.equal(outcome.accepted, false);
  assert.ok(outcome.issues.some((i) => i.code === 'ENTITY_SCHEMA_INVALID'));
  assert.equal((await trips.getTrip('trip_m1'))?.version, 0);
});

test('mutation: valid proposal applies, bumps version once, preserves audit', async () => {
  const { trips, mutations, audit } = harness();
  await trips.saveTrip(seedTrip());
  const outcome = await mutations.applyProposal(
    proposal({
      origin: 'PROVIDER',
      rationale: 'schedule change',
      operations: [
        {
          op: 'UPSERT_FACT',
          target: { entityType: 'TRIP_ELEMENT', id: 'el_m_flight' },
          factPath: 'data.scheduledDeparture',
          sourceId: 'src_m_provider',
          authority: 'AUTHORITATIVE',
          value: {
            value: '2026-09-01T09:30:00+09:00',
            sourceId: 'src_m_provider',
            authority: 'AUTHORITATIVE',
            observedAt: '2026-08-20T10:00:00+09:00',
          },
        },
        {
          op: 'ADD_RELATION',
          tripId: 'trip_m1',
          relation: {
            kind: 'DEPENDS_ON',
            from: { entityType: 'TRIP_OBJECTIVE', id: 'obj_m1' },
            to: { entityType: 'TRIP_ELEMENT', id: 'el_m_flight' },
          },
        },
      ],
    }),
  );
  assert.equal(outcome.accepted, true);
  assert.equal(outcome.appliedOperationCount, 2);
  const trip = await trips.getTrip('trip_m1');
  assert.equal(trip?.version, 1, 'one coherent version bump per proposal');
  const leg = trip?.elements.find((e) => e.id === 'el_m_flight');
  assert.equal(leg?.elementKind === 'TRANSPORT_LEG' && leg.data.scheduledDeparture?.value, '2026-09-01T09:30:00+09:00');
  assert.equal(trip?.relations.length, 1);
  const applied = await audit.query({ action: 'MUTATION_APPLIED' });
  assert.equal(applied.length, 1);
  assert.equal(applied[0]?.payload['proposalId'], 'prop_m1');
});

test('mutation: atomic rejection — one bad operation blocks the whole proposal', async () => {
  const { trips, mutations } = harness();
  await trips.saveTrip(seedTrip());
  const outcome = await mutations.applyProposal(
    proposal({
      operations: [
        {
          op: 'UPSERT_FACT',
          target: { entityType: 'TRIP_ELEMENT', id: 'el_m_flight' },
          factPath: 'data.scheduledArrival',
          sourceId: 'src_m_provider',
          authority: 'AUTHORITATIVE',
          value: {
            value: '2026-09-01T12:00:00+09:00',
            sourceId: 'src_m_provider',
            authority: 'AUTHORITATIVE',
            observedAt: '2026-08-20T10:00:00+09:00',
          },
        },
        {
          op: 'UPSERT_ENTITY',
          entityType: 'TRIP_ELEMENT',
          data: { id: 'el_ghost', tripId: 'trip_missing', elementKind: 'STAY' },
        },
      ],
    }),
  );
  assert.equal(outcome.accepted, false);
  const trip = await trips.getTrip('trip_m1');
  assert.equal(trip?.version, 0, 'no partial authoritative mutation');
  const leg = trip?.elements.find((e) => e.id === 'el_m_flight');
  assert.equal(
    leg?.elementKind === 'TRANSPORT_LEG' && leg.data.scheduledArrival?.value,
    '2026-09-01T11:00:00+09:00',
    'first operation was not partially applied',
  );
});

test('mutation: lower-authority fact cannot replace authoritative evidence', async () => {
  const { trips, mutations } = harness();
  await trips.saveTrip(seedTrip());
  const outcome = await mutations.applyProposal(
    proposal({
      operations: [
        {
          op: 'UPSERT_FACT',
          target: { entityType: 'TRIP_ELEMENT', id: 'el_m_flight' },
          factPath: 'data.scheduledDeparture',
          sourceId: 'src_m_rumor',
          authority: 'INFERRED',
          value: {
            value: '2026-09-01T23:00:00+09:00',
            sourceId: 'src_m_rumor',
            authority: 'INFERRED',
            observedAt: '2026-08-20T20:00:00+09:00', // newer observation, weaker authority
          },
        },
      ],
    }),
  );
  assert.equal(outcome.accepted, false);
  assert.ok(outcome.issues.some((i) => i.code === 'FACT_OUTRANKED'));
  const trip = await trips.getTrip('trip_m1');
  const leg = trip?.elements.find((e) => e.id === 'el_m_flight');
  assert.equal(
    leg?.elementKind === 'TRANSPORT_LEG' && leg.data.scheduledDeparture?.value,
    '2026-09-01T08:00:00+09:00',
    'authoritative evidence untouched',
  );
});

test('mutation: stale evidence (equal authority, older instant) cannot overwrite', async () => {
  const { trips, mutations } = harness();
  await trips.saveTrip(seedTrip());
  const outcome = await mutations.applyProposal(
    proposal({
      operations: [
        {
          op: 'UPSERT_FACT',
          target: { entityType: 'TRIP_ELEMENT', id: 'el_m_flight' },
          factPath: 'data.scheduledDeparture',
          sourceId: 'src_m_provider',
          authority: 'AUTHORITATIVE',
          value: {
            value: '2026-09-01T07:00:00+09:00',
            sourceId: 'src_m_provider',
            authority: 'AUTHORITATIVE',
            // Older instant than the stored observation (cross-offset check):
            // 17:00-06:00 == Aug 18 23:00Z < incumbent 09:00+09:00 == Aug 19 00:00Z.
            observedAt: '2026-08-18T17:00:00-06:00',
          },
        },
      ],
    }),
  );
  assert.equal(outcome.accepted, false);
  assert.ok(outcome.issues.some((i) => i.code === 'FACT_OUTRANKED'));
});

test('mutation: stale incumbent (expired validUntil) is replaced by fresher evidence', async () => {
  const { trips, mutations } = harness();
  const trip = seedTrip();
  const leg = trip.elements[0];
  if (leg?.elementKind === 'TRANSPORT_LEG' && leg.data.scheduledDeparture) {
    leg.data.scheduledDeparture.validUntil = '2026-08-19T23:00:00+00:00';
    leg.data.scheduledDeparture.authority = 'AUTHORITATIVE';
  }
  await trips.saveTrip(trip);
  const outcome = await mutations.applyProposal(
    proposal({
      operations: [
        {
          op: 'UPSERT_FACT',
          target: { entityType: 'TRIP_ELEMENT', id: 'el_m_flight' },
          factPath: 'data.scheduledDeparture',
          sourceId: 'src_m_provider',
          authority: 'CONNECTED',
          value: {
            value: '2026-09-01T10:00:00+09:00',
            sourceId: 'src_m_provider',
            authority: 'CONNECTED',
            observedAt: '2026-08-20T08:00:00+00:00',
          },
        },
      ],
    }),
  );
  assert.equal(outcome.accepted, true, 'expired authoritative fact may be superseded');
  const stored = await trips.getTrip('trip_m1');
  const storedLeg = stored?.elements.find((e) => e.id === 'el_m_flight');
  assert.equal(
    storedLeg?.elementKind === 'TRANSPORT_LEG' && storedLeg.data.scheduledDeparture?.authority,
    'CONNECTED',
  );
});

test('mutation: already-expired incoming fact is rejected', async () => {
  const { trips, mutations } = harness();
  await trips.saveTrip(seedTrip());
  const outcome = await mutations.applyProposal(
    proposal({
      operations: [
        {
          op: 'UPSERT_FACT',
          target: { entityType: 'TRIP_ELEMENT', id: 'el_m_flight' },
          factPath: 'data.scheduledDeparture',
          sourceId: 'src_m_provider',
          authority: 'AUTHORITATIVE',
          value: {
            value: '2026-09-01T10:00:00+09:00',
            sourceId: 'src_m_provider',
            authority: 'AUTHORITATIVE',
            observedAt: '2026-08-20T08:00:00+00:00',
            validUntil: '2026-08-20T09:00:00+00:00',
          },
        },
      ],
    }),
  );
  assert.equal(outcome.accepted, false);
  assert.ok(outcome.issues.some((i) => i.code === 'FACT_ALREADY_EXPIRED'));
});

test('mutation: UPSERT_ENTITY creates and updates elements with provenance intact', async () => {
  const { trips, mutations } = harness();
  await trips.saveTrip(seedTrip());
  const create = await mutations.applyProposal(
    proposal({
      id: 'prop_m2',
      operations: [
        {
          op: 'UPSERT_ENTITY',
          entityType: 'TRIP_ELEMENT',
          data: {
            id: 'el_m_transfer',
            tripId: 'trip_m1',
            elementKind: 'TRANSPORT_LEG',
            importance: 'REQUIRED',
            flexibility: 'FLEXIBLE',
            reservationState: 'NONE',
            dependsOn: [],
            governedByRuleSetIds: [],
            data: {
              mode: 'TAXI_OR_RIDEHAIL',
              originPlaceId: 'plc_m_dest',
              destinationPlaceId: 'plc_m_hotel',
            },
          },
        },
      ],
    }),
  );
  assert.equal(create.accepted, true);
  const trip = await trips.getTrip('trip_m1');
  const transfer = trip?.elements.find((e) => e.id === 'el_m_transfer');
  assert.equal(transfer?.status, 'UNKNOWN', 'unevaluated health defaults to UNKNOWN (ADR-027)');

  const mismatch = await mutations.applyProposal(
    proposal({
      id: 'prop_m3',
      operations: [
        {
          op: 'UPSERT_ENTITY',
          entityType: 'TRIP_ELEMENT',
          id: 'el_other',
          data: {
            id: 'el_m_transfer',
            tripId: 'trip_m1',
            elementKind: 'TRANSPORT_LEG',
            importance: 'REQUIRED',
            flexibility: 'FLEXIBLE',
            reservationState: 'NONE',
            data: { mode: 'WALKING', originPlaceId: 'a', destinationPlaceId: 'b' },
          },
        },
      ],
    }),
  );
  assert.equal(mismatch.accepted, false);
  assert.ok(mismatch.issues.some((i) => i.code === 'ENTITY_ID_MISMATCH'));
});

test('mutation: waive/reprioritize objective records explicit authority evidence', async () => {
  const { trips, mutations } = harness();
  await trips.saveTrip(seedTrip());
  const by = { entityType: 'TRAVELLER' as const, id: 'trv_m1' };

  const missingHardness = await mutations.applyProposal(
    proposal({
      id: 'prop_m4',
      operations: [{ op: 'WAIVE_OR_REPRIORITIZE_OBJECTIVE', objectiveId: 'obj_m1', action: 'REPRIORITY', by }],
    }),
  );
  assert.equal(missingHardness.accepted, false);

  const repriority = await mutations.applyProposal(
    proposal({
      id: 'prop_m5',
      operations: [
        {
          op: 'WAIVE_OR_REPRIORITIZE_OBJECTIVE',
          objectiveId: 'obj_m1',
          action: 'REPRIORITY',
          newHardness: 'SOFT',
          by,
          reason: 'meeting moved',
        },
      ],
    }),
  );
  assert.equal(repriority.accepted, true);
  let trip = await trips.getTrip('trip_m1');
  let objective = trip?.objectives.find((o) => o.id === 'obj_m1');
  assert.equal(objective?.hardness, 'SOFT');
  assert.equal(objective?.status, 'REPRIORITY');
  assert.equal(objective?.reprioritisation?.by.id, 'trv_m1');
  assert.equal(objective?.reprioritisation?.previousHardness, 'HARD');

  const waive = await mutations.applyProposal(
    proposal({
      id: 'prop_m6',
      operations: [{ op: 'WAIVE_OR_REPRIORITIZE_OBJECTIVE', objectiveId: 'obj_m1', action: 'WAIVE', by }],
    }),
  );
  assert.equal(waive.accepted, true);
  trip = await trips.getTrip('trip_m1');
  objective = trip?.objectives.find((o) => o.id === 'obj_m1');
  assert.equal(objective?.status, 'WAIVED');
});

test('mutation: UPSERT_CONSTRAINT persists through the entity store seam', async () => {
  const { trips, entities, mutations } = harness();
  await trips.saveTrip(seedTrip());
  const outcome = await mutations.applyProposal(
    proposal({
      id: 'prop_m7',
      operations: [
        {
          op: 'UPSERT_CONSTRAINT',
          constraint: {
            id: 'c_m1',
            kind: 'TEMPORAL',
            hardness: 'HARD',
            evaluator: 'DETERMINISTIC',
            status: 'UNKNOWN',
            refs: [{ entityType: 'TRIP_ELEMENT', id: 'el_m_flight' }],
            parameters: { minBufferMinutes: 30 },
          },
        },
      ],
    }),
  );
  assert.equal(outcome.accepted, true);
  const stored = await entities.get('CONSTRAINT', 'c_m1');
  assert.equal(stored?.entityType, 'CONSTRAINT');
  assert.equal((stored?.entity as { kind: string }).kind, 'TEMPORAL');
});

test('mutation: RULE_SET upsert keeps provenance in entity store', async () => {
  const { trips, entities, mutations } = harness();
  await trips.saveTrip(seedTrip());
  const outcome = await mutations.applyProposal(
    proposal({
      id: 'prop_m8',
      operations: [
        {
          op: 'UPSERT_ENTITY',
          entityType: 'RULE_SET',
          data: {
            id: 'rs_m1',
            kind: 'SUPPLIER',
            name: 'Supplier terms',
            sourceId: 'src_m_terms',
            rules: [
              {
                id: 'rule_m_cutoff',
                kind: 'NO_SHOW_CUTOFF',
                sourceId: 'src_m_terms',
                cutoffAt: '2026-09-02T02:00:00+09:00',
              },
            ],
          },
        },
      ],
    }),
  );
  assert.equal(outcome.accepted, true);
  const stored = await entities.get('RULE_SET', 'rs_m1');
  assert.equal(stored?.entityType, 'RULE_SET');
});

// ---------------------------------------------------------------------------
// PL-1 regressions: UPSERT_ENTITY must honour the same fact authority ladder
// as UPSERT_FACT — never last-write-wins through a whole-entity payload.
// ---------------------------------------------------------------------------

/** Seed element with the AUTHORITATIVE departure fact replaced. */
function elementWithDeparture(fact: {
  value: string;
  sourceId: string;
  authority: 'AUTHORITATIVE' | 'CONNECTED' | 'ASSERTED' | 'INFERRED';
  observedAt: string;
}): Trip {
  const trip = seedTrip();
  const leg = trip.elements[0];
  if (leg?.elementKind === 'TRANSPORT_LEG') {
    leg.data = { ...leg.data, scheduledDeparture: fact };
  }
  return trip;
}

test('mutation PL-1: weaker whole-entity upsert cannot replace a stronger fact', async () => {
  const { trips, mutations } = harness();
  const trip = seedTrip();
  await trips.saveTrip(trip);
  const incumbentLeg = trip.elements[0];
  assert.ok(incumbentLeg);

  // Same element, but its AUTHORITATIVE departure fact is downgraded to an
  // INFERRED rumor inside a whole-entity payload.
  const rumorElement = structuredClone(incumbentLeg);
  assert.equal(rumorElement.elementKind, 'TRANSPORT_LEG');
  rumorElement.data = {
    ...rumorElement.data,
    scheduledDeparture: {
      value: '2026-09-01T23:59:00+09:00',
      sourceId: 'src_m_rumor',
      authority: 'INFERRED',
      observedAt: '2026-08-20T20:00:00+09:00', // newer observation, weaker authority
    },
  };

  const outcome = await mutations.applyProposal(
    proposal({
      id: 'prop_pl1_weaker',
      operations: [{ op: 'UPSERT_ENTITY', entityType: 'TRIP_ELEMENT', id: 'el_m_flight', data: rumorElement }],
    }),
  );
  assert.equal(outcome.accepted, false);
  assert.ok(outcome.issues.some((i) => i.code === 'FACT_OUTRANKED' && i.path === 'data.scheduledDeparture'));
  const stored = await trips.getTrip('trip_m1');
  const leg = stored?.elements.find((e) => e.id === 'el_m_flight');
  assert.equal(
    leg?.elementKind === 'TRANSPORT_LEG' && leg.data.scheduledDeparture?.value,
    '2026-09-01T08:00:00+09:00',
    'authoritative evidence untouched',
  );
  assert.equal(stored?.version, 0);
});

test('mutation PL-1: equivalent UPSERT_FACT and UPSERT_ENTITY conflicts behave identically', async () => {
  const { trips, mutations } = harness();
  await trips.saveTrip(seedTrip());
  const weakerFact = {
    value: '2026-09-01T23:59:00+09:00',
    sourceId: 'src_m_rumor',
    authority: 'INFERRED' as const,
    observedAt: '2026-08-20T20:00:00+09:00',
  };

  const byFact = await mutations.applyProposal(
    proposal({
      id: 'prop_pl1_fact',
      operations: [
        {
          op: 'UPSERT_FACT',
          target: { entityType: 'TRIP_ELEMENT', id: 'el_m_flight' },
          factPath: 'data.scheduledDeparture',
          sourceId: weakerFact.sourceId,
          authority: weakerFact.authority,
          value: weakerFact,
        },
      ],
    }),
  );
  assert.equal(byFact.accepted, false);
  const factCodes = byFact.issues.map((i) => i.code).sort();

  const trip = seedTrip();
  const leg = trip.elements[0];
  assert.ok(leg);
  const element = structuredClone(leg);
  assert.equal(element.elementKind, 'TRANSPORT_LEG');
  element.data = { ...element.data, scheduledDeparture: weakerFact };
  const byEntity = await mutations.applyProposal(
    proposal({
      id: 'prop_pl1_entity',
      operations: [{ op: 'UPSERT_ENTITY', entityType: 'TRIP_ELEMENT', id: 'el_m_flight', data: element }],
    }),
  );
  assert.equal(byEntity.accepted, false, 'entity upsert must conflict exactly like the fact upsert');
  assert.deepEqual(byEntity.issues.map((i) => i.code).sort(), factCodes);
});

test('mutation PL-1: stronger or fresher facts still win through entity upsert', async () => {
  const { trips, mutations } = harness();
  // Incumbent is only CONNECTED; an AUTHORITATIVE provider confirmation wins.
  await trips.saveTrip(
    elementWithDeparture({
      value: '2026-09-01T08:00:00+09:00',
      sourceId: 'src_m_provider',
      authority: 'CONNECTED',
      observedAt: '2026-08-19T09:00:00+09:00',
    }),
  );
  const trip = seedTrip();
  const leg = trip.elements[0];
  assert.ok(leg);
  const stronger = structuredClone(leg);
  assert.equal(stronger.elementKind, 'TRANSPORT_LEG');
  stronger.data = {
    ...stronger.data,
    scheduledDeparture: {
      value: '2026-09-01T09:00:00+09:00',
      sourceId: 'src_m_provider',
      authority: 'AUTHORITATIVE',
      observedAt: '2026-08-20T10:00:00+09:00',
    },
  };
  const strongerOutcome = await mutations.applyProposal(
    proposal({
      id: 'prop_pl1_stronger',
      operations: [{ op: 'UPSERT_ENTITY', entityType: 'TRIP_ELEMENT', id: 'el_m_flight', data: stronger }],
    }),
  );
  assert.equal(strongerOutcome.accepted, true, 'stronger authority must replace weaker evidence');
  const afterStronger = await trips.getTrip('trip_m1');
  const legAfter = afterStronger?.elements.find((e) => e.id === 'el_m_flight');
  assert.equal(
    legAfter?.elementKind === 'TRANSPORT_LEG' && legAfter.data.scheduledDeparture?.value,
    '2026-09-01T09:00:00+09:00',
  );

  // Equal authority: fresher observation wins, older observation loses.
  const fresher = structuredClone(stronger);
  assert.equal(fresher.elementKind, 'TRANSPORT_LEG');
  fresher.data = {
    ...fresher.data,
    scheduledDeparture: {
      value: '2026-09-01T09:30:00+09:00',
      sourceId: 'src_m_provider',
      authority: 'AUTHORITATIVE',
      observedAt: '2026-08-20T12:00:00+09:00',
    },
  };
  const fresherOutcome = await mutations.applyProposal(
    proposal({
      id: 'prop_pl1_fresher',
      operations: [{ op: 'UPSERT_ENTITY', entityType: 'TRIP_ELEMENT', id: 'el_m_flight', data: fresher }],
    }),
  );
  assert.equal(fresherOutcome.accepted, true);

  const stale = structuredClone(fresher);
  assert.equal(stale.elementKind, 'TRANSPORT_LEG');
  stale.data = {
    ...stale.data,
    scheduledDeparture: {
      value: '2026-09-01T07:00:00+09:00',
      sourceId: 'src_m_provider',
      authority: 'AUTHORITATIVE',
      observedAt: '2026-08-20T11:00:00+09:00', // older than the fresher one now stored
    },
  };
  const staleOutcome = await mutations.applyProposal(
    proposal({
      id: 'prop_pl1_stale',
      operations: [{ op: 'UPSERT_ENTITY', entityType: 'TRIP_ELEMENT', id: 'el_m_flight', data: stale }],
    }),
  );
  assert.equal(staleOutcome.accepted, false);
  assert.ok(staleOutcome.issues.some((i) => i.code === 'FACT_OUTRANKED'));
  const finalLeg = (await trips.getTrip('trip_m1'))?.elements.find((e) => e.id === 'el_m_flight');
  assert.equal(
    finalLeg?.elementKind === 'TRANSPORT_LEG' && finalLeg.data.scheduledDeparture?.value,
    '2026-09-01T09:30:00+09:00',
    'fresher evidence retained',
  );
});

test('mutation PL-1: one outranked fact in a multi-fact entity blocks the whole write', async () => {
  const { trips, mutations } = harness();
  await trips.saveTrip(seedTrip());
  const trip = seedTrip();
  const leg = trip.elements[0];
  assert.ok(leg);

  // Arrival fact is stronger/fresher (should win), departure fact is weaker
  // (must lose) — the losing fact alone must reject the entire payload, so
  // the winning arrival is not applied either.
  const mixed = structuredClone(leg);
  assert.equal(mixed.elementKind, 'TRANSPORT_LEG');
  mixed.data = {
    ...mixed.data,
    scheduledDeparture: {
      value: '2026-09-01T06:00:00+09:00',
      sourceId: 'src_m_rumor',
      authority: 'INFERRED',
      observedAt: '2026-08-20T20:00:00+09:00',
    },
    scheduledArrival: {
      value: '2026-09-01T12:30:00+09:00',
      sourceId: 'src_m_provider',
      authority: 'AUTHORITATIVE',
      observedAt: '2026-08-20T20:00:00+09:00',
    },
  };
  const outcome = await mutations.applyProposal(
    proposal({
      id: 'prop_pl1_atomic',
      operations: [{ op: 'UPSERT_ENTITY', entityType: 'TRIP_ELEMENT', id: 'el_m_flight', data: mixed }],
    }),
  );
  assert.equal(outcome.accepted, false);
  const stored = await trips.getTrip('trip_m1');
  const storedLeg = stored?.elements.find((e) => e.id === 'el_m_flight');
  assert.equal(stored?.version, 0);
  assert.equal(
    storedLeg?.elementKind === 'TRANSPORT_LEG' && storedLeg.data.scheduledArrival?.value,
    '2026-09-01T11:00:00+09:00',
    'no partial application: the winning arrival fact must not leak in',
  );
  assert.equal(
    storedLeg?.elementKind === 'TRANSPORT_LEG' && storedLeg.data.scheduledDeparture?.value,
    '2026-09-01T08:00:00+09:00',
  );
});

test('mutation PL-1: context entity upserts respect incumbent facts too', async () => {
  const { trips, entities, mutations } = harness();
  await trips.saveTrip(seedTrip());

  const anchor = {
    id: 'anchor_pl1',
    name: 'Keynote',
    kind: 'CONFERENCE' as const,
    window: { startsAt: '2026-09-14T09:00:00+09:00', endsAt: '2026-09-14T10:00:00+09:00' },
    instructions: {
      value: 'Badge required; arrive 30 minutes early.',
      sourceId: 'src_m_organiser',
      authority: 'AUTHORITATIVE' as const,
      observedAt: '2026-08-19T09:00:00+00:00',
    },
    sourceIds: ['src_m_organiser'],
  };
  const create = await mutations.applyProposal(
    proposal({
      id: 'prop_pl1_anchor_create',
      operations: [{ op: 'UPSERT_ENTITY', entityType: 'ANCHOR_EVENT', id: anchor.id, data: anchor }],
    }),
  );
  assert.equal(create.accepted, true);

  // Weaker source tries to rewrite the instructions through a whole-entity
  // payload — must be rejected, and the stored entity must be untouched.
  const weaker = {
    ...anchor,
    instructions: {
      value: 'No badge needed.',
      sourceId: 'src_m_rumor',
      authority: 'INFERRED' as const,
      observedAt: '2026-08-20T09:00:00+00:00',
    },
  };
  const weakerOutcome = await mutations.applyProposal(
    proposal({
      id: 'prop_pl1_anchor_weaker',
      operations: [{ op: 'UPSERT_ENTITY', entityType: 'ANCHOR_EVENT', id: anchor.id, data: weaker }],
    }),
  );
  assert.equal(weakerOutcome.accepted, false);
  assert.ok(weakerOutcome.issues.some((i) => i.code === 'FACT_OUTRANKED' && i.path === 'instructions'));
  const stored = await entities.get('ANCHOR_EVENT', anchor.id);
  assert.equal(
    (stored?.entity as { instructions?: { value: string } }).instructions?.value,
    'Badge required; arrive 30 minutes early.',
  );

  // Authoritative restatement at a fresher instant still wins.
  const updated = {
    ...anchor,
    instructions: {
      value: 'Badge required; side entrance this week.',
      sourceId: 'src_m_organiser',
      authority: 'AUTHORITATIVE' as const,
      observedAt: '2026-08-20T09:00:00+00:00',
    },
  };
  const updatedOutcome = await mutations.applyProposal(
    proposal({
      id: 'prop_pl1_anchor_update',
      operations: [{ op: 'UPSERT_ENTITY', entityType: 'ANCHOR_EVENT', id: anchor.id, data: updated }],
    }),
  );
  assert.equal(updatedOutcome.accepted, true);
  const updatedStored = await entities.get('ANCHOR_EVENT', anchor.id);
  assert.equal(
    (updatedStored?.entity as { instructions?: { value: string } }).instructions?.value,
    'Badge required; side entrance this week.',
  );
});

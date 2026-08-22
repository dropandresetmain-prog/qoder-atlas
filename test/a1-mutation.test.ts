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

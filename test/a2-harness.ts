/**
 * Shared Lane A test harness: loads frozen scenario bundles and seeds them
 * into the persistence layer. Scenario-neutral — any ScenarioSpec loads.
 */
import { readFileSync } from 'node:fs';
import { openDatabase } from '../src/persistence/database.ts';
import {
  SqliteTripRepository,
  SqliteCaseRepository,
  SqliteSignalRepository,
  SqliteSourceRepository,
  SqliteAuditRepository,
} from '../src/persistence/repositories.ts';
import { SqliteEntityStore } from '../src/persistence/entityStore.ts';
import { SqlMutationService } from '../src/engine/mutation.ts';
import { ScenarioSpecSchema, type ScenarioSpec } from '../src/scenarios/spec.ts';
import type { TripElement } from '../src/domain/elements.ts';
import type { MutationProposal } from '../src/operational/mutation.ts';
import type { TripSnapshot } from '../src/operational/snapshot.ts';
import type { IsoDateTime } from '../src/domain/common.ts';

export function loadScenario(path: string): ScenarioSpec {
  return ScenarioSpecSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

export const SCENARIO_A_PATH = 'fixtures/scenarios/anchor-event-speaker/scenario.json';
export const SCENARIO_B_PATH = 'fixtures/scenarios/corporate-tmc/scenario.json';

export function scenarioHarness() {
  const db = openDatabase(':memory:');
  const trips = new SqliteTripRepository(db);
  const cases = new SqliteCaseRepository(db);
  const signals = new SqliteSignalRepository(db);
  const sources = new SqliteSourceRepository(db);
  const audit = new SqliteAuditRepository(db);
  const entities = new SqliteEntityStore(db);
  const mutations = new SqlMutationService({ db, trips, entities });
  return { db, trips, cases, signals, sources, audit, entities, mutations };
}

export type ScenarioHarness = ReturnType<typeof scenarioHarness>;

export async function seedScenario(h: ScenarioHarness, spec: ScenarioSpec): Promise<void> {
  await h.trips.saveTrip(spec.trip);
  await h.signals.saveSignal(spec.disruption.signal);
  for (const constraint of spec.constraints) {
    await h.entities.upsert({ entityType: 'CONSTRAINT', entity: constraint });
  }
  for (const ruleSet of spec.context.ruleSets) {
    await h.entities.upsert({ entityType: 'RULE_SET', entity: ruleSet });
  }
  for (const place of spec.context.places) {
    await h.entities.upsert({ entityType: 'PLACE', entity: place });
  }
  for (const traveller of spec.context.travellers) {
    await h.entities.upsert({ entityType: 'TRAVELLER', entity: traveller });
  }
  for (const organisation of spec.context.organisations) {
    await h.entities.upsert({ entityType: 'ORGANISATION', entity: organisation });
  }
  for (const anchorEvent of spec.context.anchorEvents) {
    await h.entities.upsert({ entityType: 'ANCHOR_EVENT', entity: anchorEvent });
  }
}

/**
 * Assemble a planner-safe snapshot from persisted authoritative state.
 * Same shape A4/integration will use to feed the viability engine.
 */
export async function snapshotOf(
  h: ScenarioHarness,
  tripId: string,
  takenAt: IsoDateTime,
): Promise<TripSnapshot> {
  const trip = await h.trips.getTrip(tripId);
  if (!trip) throw new Error(`unknown trip ${tripId}`);
  const constraints = (await h.entities.list('CONSTRAINT'))
    .filter((e): e is { entityType: 'CONSTRAINT'; entity: import('../src/domain/constraints.ts').Constraint } => e.entityType === 'CONSTRAINT')
    .map((e) => e.entity);
  const ruleSets = (await h.entities.list('RULE_SET'))
    .filter((e): e is { entityType: 'RULE_SET'; entity: import('../src/domain/rules.ts').RuleSet } => e.entityType === 'RULE_SET')
    .map((e) => e.entity);
  const places = (await h.entities.list('PLACE'))
    .filter((e): e is { entityType: 'PLACE'; entity: import('../src/domain/entities.ts').Place } => e.entityType === 'PLACE')
    .map((e) => e.entity);
  const travellers = (await h.entities.list('TRAVELLER'))
    .filter((e): e is { entityType: 'TRAVELLER'; entity: import('../src/domain/entities.ts').Traveller } => e.entityType === 'TRAVELLER')
    .map((e) => e.entity);
  const organisations = (await h.entities.list('ORGANISATION'))
    .filter((e): e is { entityType: 'ORGANISATION'; entity: import('../src/domain/entities.ts').Organisation } => e.entityType === 'ORGANISATION')
    .map((e) => e.entity);
  const anchor = trip.anchorEventId
    ? await h.entities.get('ANCHOR_EVENT', trip.anchorEventId)
    : undefined;
  return {
    tripId,
    takenAt,
    tripVersion: trip.version,
    trip,
    travellers,
    organisations,
    anchorEvent: anchor?.entityType === 'ANCHOR_EVENT' ? anchor.entity : undefined,
    places,
    ruleSets,
    constraints,
    preferences: [],
    sourceRecords: [],
  };
}

/**
 * Validated provider-origin proposal marking the disruption subject element
 * CANCELLED. Applied through MutationService — never by direct write.
 */
export function cancellationProposal(spec: ScenarioSpec): MutationProposal {
  const signal = spec.disruption.signal;
  if (signal.subjectRef?.entityType !== 'TRIP_ELEMENT') {
    throw new Error('scenario disruption has no element subject');
  }
  const element = spec.trip.elements.find((e) => e.id === signal.subjectRef!.id);
  if (!element) throw new Error(`subject element ${signal.subjectRef.id} not in trip`);
  const cancelled: TripElement = { ...element, reservationState: 'CANCELLED' };
  return {
    id: `prop-cancel-${signal.id}`,
    origin: 'PROVIDER',
    sourceId: signal.sourceId,
    requestedAt: signal.receivedAt ?? signal.occurredAt,
    rationale: `apply ${signal.kind} to ${element.id}`,
    operations: [
      { op: 'UPSERT_ENTITY', entityType: 'TRIP_ELEMENT', id: element.id, data: cancelled },
    ],
  };
}

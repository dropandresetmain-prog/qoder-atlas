/**
 * A1 — deterministic, pure application of MutationOperations to in-memory
 * aggregates. Shared by the authoritative MutationService and the A3 overlay
 * engine so candidate evaluation uses identical semantics. No I/O here.
 */
import type { Trip, TripObjective, TripRelation } from '../domain/trip.ts';
import type { TripElement } from '../domain/elements.ts';
import type { Constraint } from '../domain/constraints.ts';
import type { EntityRef, Fact } from '../domain/common.ts';
import { compareInstants, isFactStale } from '../domain/common.ts';
import { FACT_AUTHORITY_RANK } from '../domain/common.ts';
import type { Organisation, Traveller, AnchorEvent, Place } from '../domain/entities.ts';
import type { RuleSet } from '../domain/rules.ts';
import type { MutationOperation } from '../operational/mutation.ts';

/** Entity-store payload types handled outside the Trip aggregate. */
export type ContextEntity =
  | { entityType: 'ORGANISATION'; entity: Organisation }
  | { entityType: 'TRAVELLER'; entity: Traveller }
  | { entityType: 'ANCHOR_EVENT'; entity: AnchorEvent }
  | { entityType: 'PLACE'; entity: Place }
  | { entityType: 'RULE_SET'; entity: RuleSet }
  | { entityType: 'CONSTRAINT'; entity: Constraint };

export interface WorkingState {
  trips: Map<string, Trip>;
  /** Non-trip entities keyed by `${entityType}:${id}`. */
  entities: Map<string, ContextEntity>;
}

export interface AppliedOperation {
  op: MutationOperation;
  affectedTripId?: string;
  detail: string;
}

export type ApplyIssue = { code: string; message: string; path?: string };

/**
 * Result of applying one operation. `superseded` means the operation was a
 * no-op because existing evidence outranks it (never a silent overwrite).
 */
export type ApplyResult =
  | { ok: true; applied: AppliedOperation; superseded?: boolean }
  | { ok: false; issues: ApplyIssue[] };

export function entityKey(entityType: string, id: string): string {
  return `${entityType}:${id}`;
}

function relationEquals(a: TripRelation, b: TripRelation): boolean {
  return (
    a.kind === b.kind &&
    a.from.entityType === b.from.entityType &&
    a.from.id === b.from.id &&
    a.to.entityType === b.to.entityType &&
    a.to.id === b.to.id
  );
}

/** Resolve the trip containing an objective, if any. */
export function tripWithObjective(state: WorkingState, objectiveId: string): Trip | undefined {
  for (const trip of state.trips.values()) {
    if (trip.objectives.some((o) => o.id === objectiveId)) return trip;
  }
  return undefined;
}

/**
 * Resolve a fact-bearing entity for UPSERT_FACT. Returns a live object from
 * the working state plus the container trip (when inside a Trip aggregate).
 */
export function resolveFactTarget(
  state: WorkingState,
  target: EntityRef,
): { factHolder: Record<string, unknown>; trip?: Trip } | { issues: ApplyIssue[] } {
  if (target.entityType === 'TRIP') {
    const trip = state.trips.get(target.id);
    if (!trip) return { issues: [{ code: 'TARGET_NOT_FOUND', message: `trip ${target.id} not found` }] };
    return { factHolder: trip as unknown as Record<string, unknown>, trip };
  }
  if (target.entityType === 'TRIP_ELEMENT') {
    for (const trip of state.trips.values()) {
      const element = trip.elements.find((e) => e.id === target.id);
      if (element) return { factHolder: element as unknown as Record<string, unknown>, trip };
    }
    return { issues: [{ code: 'TARGET_NOT_FOUND', message: `element ${target.id} not found` }] };
  }
  if (target.entityType === 'TRIP_OBJECTIVE') {
    for (const trip of state.trips.values()) {
      const objective = trip.objectives.find((o) => o.id === target.id);
      if (objective) return { factHolder: objective as unknown as Record<string, unknown>, trip };
    }
    return { issues: [{ code: 'TARGET_NOT_FOUND', message: `objective ${target.id} not found` }] };
  }
  if (target.entityType === 'ANCHOR_EVENT') {
    const entry = state.entities.get(entityKey('ANCHOR_EVENT', target.id));
    if (entry && entry.entityType === 'ANCHOR_EVENT') {
      return { factHolder: entry.entity as unknown as Record<string, unknown> };
    }
    return { issues: [{ code: 'TARGET_NOT_FOUND', message: `anchor event ${target.id} not found` }] };
  }
  if (target.entityType === 'TRAVELLER') {
    const entry = state.entities.get(entityKey('TRAVELLER', target.id));
    if (entry && entry.entityType === 'TRAVELLER') {
      return { factHolder: entry.entity as unknown as Record<string, unknown> };
    }
    return { issues: [{ code: 'TARGET_NOT_FOUND', message: `traveller ${target.id} not found` }] };
  }
  return {
    issues: [
      {
        code: 'FACT_TARGET_UNSUPPORTED',
        message: `entity type ${target.entityType} cannot carry facts via UPSERT_FACT`,
      },
    ],
  };
}

/** Navigate a dot-path; returns the parent container and final key. */
function navigatePath(
  holder: Record<string, unknown>,
  factPath: string,
): { parent: Record<string, unknown>; key: string } | undefined {
  const segments = factPath.split('.');
  let current: Record<string, unknown> = holder;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i];
    if (segment === undefined) return undefined;
    const next = current[segment];
    if (typeof next !== 'object' || next === null) return undefined;
    current = next as Record<string, unknown>;
  }
  const key = segments[segments.length - 1];
  if (key === undefined) return undefined;
  return { parent: current, key };
}

function looksLikeFact(candidate: unknown): candidate is Fact<unknown> {
  if (typeof candidate !== 'object' || candidate === null) return false;
  const record = candidate as Record<string, unknown>;
  return typeof record['sourceId'] === 'string' && typeof record['authority'] === 'string' && typeof record['observedAt'] === 'string';
}

/**
 * Walk an incoming entity payload against its incumbent and collect every
 * fact-path where the existing evidence outranks the incoming fact. This
 * gives UPSERT_ENTITY the exact same authority ladder as UPSERT_FACT: a
 * whole-entity upsert can never silently bypass fact authority
 * (ARCHITECTURE.md §5). Non-fact fields are unaffected; facts absent from
 * the incoming payload are not touched by this check.
 */
function collectEntityFactConflicts(
  incumbent: unknown,
  incoming: unknown,
  path: string,
  issues: ApplyIssue[],
): void {
  if (looksLikeFact(incoming)) {
    if (looksLikeFact(incumbent) && !incomingFactWins(incumbent, incoming)) {
      issues.push({
        code: 'FACT_OUTRANKED',
        message: `incoming fact at ${path || '(root)'} is outranked by existing evidence (authority ${incumbent.authority} observed ${incumbent.observedAt})`,
        path: path || undefined,
      });
    }
    return;
  }
  if (typeof incoming !== 'object' || incoming === null || Array.isArray(incoming)) return;
  if (typeof incumbent !== 'object' || incumbent === null || Array.isArray(incumbent)) return;
  const incumbentRecord = incumbent as Record<string, unknown>;
  for (const [key, value] of Object.entries(incoming as Record<string, unknown>)) {
    collectEntityFactConflicts(incumbentRecord[key], value, path ? `${path}.${key}` : key, issues);
  }
}

/**
 * Fact conflict resolution per ARCHITECTURE.md §5: authority rank first, then
 * freshness; a stale incumbent never outranks fresh evidence.
 */
export function incomingFactWins(incumbent: Fact<unknown>, incoming: Fact<unknown>): boolean {
  const incumbentStale = isFactStale(incumbent, incoming.observedAt);
  const incomingStale = isFactStale(incoming, incoming.observedAt);
  if (incumbentStale && !incomingStale) return true;
  if (!incumbentStale && incomingStale) return false;
  const rankDiff = FACT_AUTHORITY_RANK[incoming.authority] - FACT_AUTHORITY_RANK[incumbent.authority];
  if (rankDiff !== 0) return rankDiff > 0;
  return compareInstants(incoming.observedAt, incumbent.observedAt) >= 0;
}

function upsertElementInTrip(trip: Trip, element: TripElement): void {
  const index = trip.elements.findIndex((e) => e.id === element.id);
  if (index >= 0) trip.elements[index] = element;
  else trip.elements.push(element);
}

function upsertObjectiveInTrip(trip: Trip, objective: TripObjective): void {
  const index = trip.objectives.findIndex((o) => o.id === objective.id);
  if (index >= 0) trip.objectives[index] = objective;
  else trip.objectives.push(objective);
}

/**
 * Apply one operation to the working state (mutates the WorkingState only).
 * All schema validation must already have succeeded; the errors produced here
 * are semantic (missing target, fact conflict, duplicate relation...).
 */
export function applyOperationToState(
  state: WorkingState,
  op: MutationOperation,
  at: string,
): ApplyResult {
  switch (op.op) {
    case 'UPSERT_ENTITY': {
      const data = op.data as { id: string; tripId?: string };
      const id = op.id ?? data.id;
      if (op.entityType === 'TRIP') {
        const trip = op.data as Trip;
        const incumbent = state.trips.get(trip.id);
        if (incumbent) {
          const issues: ApplyIssue[] = [];
          collectEntityFactConflicts(incumbent, trip, '', issues);
          if (issues.length > 0) return { ok: false, issues };
        }
        state.trips.set(trip.id, trip);
        return { ok: true, applied: { op, affectedTripId: trip.id, detail: `upsert trip ${trip.id}` } };
      }
      if (op.entityType === 'TRIP_ELEMENT') {
        const element = op.data as TripElement;
        const trip = state.trips.get(element.tripId);
        if (!trip) {
          return { ok: false, issues: [{ code: 'TARGET_NOT_FOUND', message: `element ${id}: parent trip ${element.tripId} not found` }] };
        }
        const incumbent = trip.elements.find((e) => e.id === element.id);
        if (incumbent) {
          const issues: ApplyIssue[] = [];
          collectEntityFactConflicts(incumbent, element, '', issues);
          if (issues.length > 0) return { ok: false, issues };
        }
        upsertElementInTrip(trip, element);
        return { ok: true, applied: { op, affectedTripId: trip.id, detail: `upsert element ${id}` } };
      }
      if (op.entityType === 'TRIP_OBJECTIVE') {
        const objective = op.data as TripObjective;
        const trip = state.trips.get(objective.tripId);
        if (!trip) {
          return { ok: false, issues: [{ code: 'TARGET_NOT_FOUND', message: `objective ${id}: parent trip ${objective.tripId} not found` }] };
        }
        const incumbent = trip.objectives.find((o) => o.id === objective.id);
        if (incumbent) {
          const issues: ApplyIssue[] = [];
          collectEntityFactConflicts(incumbent, objective, '', issues);
          if (issues.length > 0) return { ok: false, issues };
        }
        upsertObjectiveInTrip(trip, objective);
        return { ok: true, applied: { op, affectedTripId: trip.id, detail: `upsert objective ${id}` } };
      }
      const existing = state.entities.get(entityKey(op.entityType, id));
      if (existing) {
        const issues: ApplyIssue[] = [];
        collectEntityFactConflicts(existing.entity, op.data, '', issues);
        if (issues.length > 0) return { ok: false, issues };
      }
      const entry = { entityType: op.entityType, entity: op.data } as ContextEntity;
      state.entities.set(entityKey(op.entityType, id), entry);
      return { ok: true, applied: { op, detail: `upsert ${op.entityType} ${id}` } };
    }

    case 'UPSERT_FACT': {
      const resolved = resolveFactTarget(state, op.target);
      if ('issues' in resolved) return { ok: false, issues: resolved.issues };
      const location = navigatePath(resolved.factHolder, op.factPath);
      if (!location) {
        return {
          ok: false,
          issues: [{ code: 'FACT_PATH_INVALID', message: `fact path ${op.factPath} does not exist on ${op.target.id}` }],
        };
      }
      const incoming = op.value as Fact<unknown>;
      if (!looksLikeFact(incoming)) {
        return { ok: false, issues: [{ code: 'FACT_SHAPE_INVALID', message: `fact at ${op.factPath} is missing provenance fields` }] };
      }
      const incumbent = location.parent[location.key];
      if (looksLikeFact(incumbent) && !incomingFactWins(incumbent, incoming)) {
        // Never a silent overwrite: keep the stronger/current evidence and
        // surface the conflict explicitly.
        return { ok: false, issues: [{ code: 'FACT_OUTRANKED', message: `incoming fact for ${op.factPath} is outranked by existing evidence (authority ${incumbent.authority} observed ${incumbent.observedAt})` }] };
      }
      location.parent[location.key] = incoming;
      const affectedTripId = resolved.trip?.id;
      return {
        ok: true,
        applied: { op, affectedTripId, detail: `fact ${op.factPath} <- ${op.authority}@${op.sourceId}` },
        superseded: false,
      };
    }

    case 'ADD_RELATION': {
      const trip = state.trips.get(op.tripId);
      if (!trip) {
        return { ok: false, issues: [{ code: 'TARGET_NOT_FOUND', message: `trip ${op.tripId} not found` }] };
      }
      const exists = trip.relations.some((r) => relationEquals(r, op.relation));
      if (!exists) trip.relations.push(op.relation);
      return {
        ok: true,
        applied: { op, affectedTripId: op.tripId, detail: `add ${op.relation.kind} ${op.relation.from.id}->${op.relation.to.id}` },
        superseded: exists,
      };
    }

    case 'REMOVE_RELATION': {
      const trip = state.trips.get(op.tripId);
      if (!trip) {
        return { ok: false, issues: [{ code: 'TARGET_NOT_FOUND', message: `trip ${op.tripId} not found` }] };
      }
      const before = trip.relations.length;
      trip.relations = trip.relations.filter((r) => !relationEquals(r, op.relation));
      return {
        ok: true,
        applied: { op, affectedTripId: op.tripId, detail: `remove ${op.relation.kind} ${op.relation.from.id}->${op.relation.to.id}` },
        superseded: trip.relations.length === before,
      };
    }

    case 'UPSERT_CONSTRAINT': {
      state.entities.set(entityKey('CONSTRAINT', op.constraint.id), {
        entityType: 'CONSTRAINT',
        entity: op.constraint,
      });
      const tripIds = new Set<string>();
      for (const trip of state.trips.values()) {
        for (const ref of op.constraint.refs) {
          if (
            (ref.entityType === 'TRIP_ELEMENT' && trip.elements.some((e) => e.id === ref.id)) ||
            (ref.entityType === 'TRIP_OBJECTIVE' && trip.objectives.some((o) => o.id === ref.id)) ||
            (ref.entityType === 'TRIP' && trip.id === ref.id)
          ) {
            tripIds.add(trip.id);
          }
        }
      }
      return {
        ok: true,
        applied: {
          op,
          affectedTripId: tripIds.values().next().value,
          detail: `upsert constraint ${op.constraint.id}`,
        },
      };
    }

    case 'WAIVE_OR_REPRIORITIZE_OBJECTIVE': {
      const trip = tripWithObjective(state, op.objectiveId);
      if (!trip) {
        return { ok: false, issues: [{ code: 'TARGET_NOT_FOUND', message: `objective ${op.objectiveId} not found` }] };
      }
      const objective = trip.objectives.find((o) => o.id === op.objectiveId);
      if (!objective) {
        return { ok: false, issues: [{ code: 'TARGET_NOT_FOUND', message: `objective ${op.objectiveId} not found` }] };
      }
      if (objective.status === 'WAIVED') {
        return {
          ok: true,
          applied: { op, affectedTripId: trip.id, detail: `objective ${op.objectiveId} already waived` },
          superseded: true,
        };
      }
      if (op.action === 'WAIVE') {
        objective.status = 'WAIVED';
        return { ok: true, applied: { op, affectedTripId: trip.id, detail: `waive objective ${op.objectiveId} by ${op.by.id}` } };
      }
      if (op.newHardness === undefined) {
        return { ok: false, issues: [{ code: 'REPRIORITY_REQUIRES_HARDNESS', message: `REPRIORITY for ${op.objectiveId} requires newHardness` }] };
      }
      objective.reprioritisation = {
        at: at,
        by: op.by,
        previousHardness: objective.hardness,
        reason: op.reason,
      };
      objective.hardness = op.newHardness;
      objective.status = 'REPRIORITY';
      return {
        ok: true,
        applied: { op, affectedTripId: trip.id, detail: `reprioritize objective ${op.objectiveId} to ${op.newHardness} by ${op.by.id}` },
      };
    }
  }
}

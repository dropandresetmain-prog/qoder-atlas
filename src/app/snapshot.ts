/**
 * I1 — TripSnapshot assembly from persisted authoritative state.
 *
 * The snapshot is reconstructed entirely from the repositories/entity store:
 * no memory-only objects, so a process restart yields an identical snapshot
 * (FR-01, FR-14). Source payloads never enter the snapshot — only persisted
 * SourceRecord metadata for ids actually referenced by in-scope state.
 */
import type { EntityId, SourceRecord } from '../domain/common.ts';
import type { AnchorEvent, Organisation, Place, Traveller } from '../domain/entities.ts';
import type { Constraint } from '../domain/constraints.ts';
import type { RuleSet } from '../domain/rules.ts';
import type { ResolutionTarget } from '../contracts/changeRequest.ts';
import type { Trip } from '../domain/trip.ts';
import type { TripSnapshot } from '../operational/snapshot.ts';
import { TripSnapshotSchema } from '../operational/snapshot.ts';
import type { SourceRepository, TripRepository } from '../contracts/repositories.ts';
import type { EntityStore } from '../persistence/entityStore.ts';
import type { PreferenceStore } from './preferenceStore.ts';

export interface SnapshotDependencies {
  trips: TripRepository;
  entities: EntityStore;
  preferences: PreferenceStore;
  sources: SourceRepository;
}

/** Rebuild a planner-safe snapshot for one trip from persisted state only. */
export async function buildTripSnapshot(
  deps: SnapshotDependencies,
  tripId: EntityId,
  takenAt: string,
  /**
   * Optional resolution target behind the planning turn. Places the target
   * DECLARES (e.g. a substituted departure gateway) join the snapshot scope
   * so the planner can resolve them against authoritative evidence instead
   * of failing closed on an unseen place.
   */
  resolutionTarget?: ResolutionTarget,
): Promise<TripSnapshot> {
  const trip = await deps.trips.getTrip(tripId);
  if (!trip) throw new Error(`unknown trip ${tripId}`);

  const travellers: Traveller[] = [];
  for (const travellerId of trip.travellerIds) {
    const entry = await deps.entities.get('TRAVELLER', travellerId);
    if (entry && entry.entityType === 'TRAVELLER') travellers.push(entry.entity);
  }

  const anchorEntry = trip.anchorEventId
    ? await deps.entities.get('ANCHOR_EVENT', trip.anchorEventId)
    : undefined;
  const anchorEvent = anchorEntry?.entityType === 'ANCHOR_EVENT' ? anchorEntry.entity : undefined;

  const constraints = await constraintsForTrip(deps.entities, trip);

  const ruleSetIds = collectRuleSetIds(trip, travellers, constraints);
  const ruleSets: RuleSet[] = [];
  for (const ruleSetId of [...ruleSetIds].sort()) {
    const entry = await deps.entities.get('RULE_SET', ruleSetId);
    if (entry && entry.entityType === 'RULE_SET') ruleSets.push(entry.entity);
  }

  const organisationIds = new Set<EntityId>();
  if (trip.operatorOrganisationId) organisationIds.add(trip.operatorOrganisationId);
  if (anchorEvent?.organiserOrganisationId) organisationIds.add(anchorEvent.organiserOrganisationId);
  // Rule-set owners are in-scope principals too: a governing policy may name
  // an approving/paying organisation distinct from the operator, and authority
  // decisions are derived from this rule data. Generic ownerRef walk only.
  for (const ruleSet of ruleSets) {
    if (ruleSet.ownerOrganisationId) organisationIds.add(ruleSet.ownerOrganisationId);
  }
  const organisations: Organisation[] = [];
  for (const organisationId of [...organisationIds].sort()) {
    const entry = await deps.entities.get('ORGANISATION', organisationId);
    if (entry && entry.entityType === 'ORGANISATION') organisations.push(entry.entity);
  }

  const placeIds = collectPlaceIds(trip, anchorEvent, travellers);
  // Declared-target scope: a place the resolution target DECLARES joins the
  // snapshot scope so the planner can resolve it against authoritative
  // evidence instead of failing closed on an unseen place — by direct place
  // id (a declared replacement stay property) as well as by external ref
  // below (a substituted departure gateway the trip never touched yet).
  if (resolutionTarget?.preferredStayPlaceId) {
    const declaredStayEntry = await deps.entities.get('PLACE', resolutionTarget.preferredStayPlaceId);
    if (declaredStayEntry && declaredStayEntry.entityType === 'PLACE') {
      placeIds.add(declaredStayEntry.entity.id);
    }
  }
  // Declared-ref scope: an external ref named by the resolution target is
  // authoritative evidence the planner must be able to see (a declared
  // departure gateway that the trip never touched yet). Generic ref match
  // over AIRPORT places; unknown refs contribute nothing — never guessed.
  if (resolutionTarget) {
    for (const declared of declaredTargetRefs(resolutionTarget)) {
      for (const entry of await deps.entities.list('PLACE')) {
        if (entry.entityType !== 'PLACE' || entry.entity.kind !== 'AIRPORT') continue;
        if (
          entry.entity.externalRefs.some(
            (ref) => ref.system === declared.system && ref.value.trim().toLowerCase() === declared.value.trim().toLowerCase(),
          )
        ) {
          placeIds.add(entry.entity.id);
        }
      }
    }
  }
  // Gateway closure (G3R-Closure fix C): a referenced place may reach its
  // transport gateway only through the generic servedByPlaceIds association.
  // The snapshot must carry that gateway too — otherwise downstream engines
  // see the venue but not the airport serving it and degrade to uncertainty.
  // Bounded walk (depth 2) over authoritative Place evidence; no guessing.
  for (let depth = 0; depth < 2; depth += 1) {
    const expanded: EntityId[] = [];
    for (const placeId of placeIds) {
      const entry = await deps.entities.get('PLACE', placeId);
      if (entry && entry.entityType === 'PLACE') {
        for (const gatewayId of entry.entity.servedByPlaceIds ?? []) {
          if (!placeIds.has(gatewayId)) expanded.push(gatewayId);
        }
      }
    }
    for (const gatewayId of expanded) placeIds.add(gatewayId);
    if (expanded.length === 0) break;
  }
  const places: Place[] = [];
  for (const placeId of [...placeIds].sort()) {
    const entry = await deps.entities.get('PLACE', placeId);
    if (entry && entry.entityType === 'PLACE') places.push(entry.entity);
  }

  const preferences = await deps.preferences.listForTrip(tripId, trip.travellerIds);

  const sourceRecords = await referencedSourceRecords(deps.sources, [
    trip,
    ...travellers,
    ...organisations,
    ...(anchorEvent ? [anchorEvent] : []),
    ...places,
    ...ruleSets,
    ...constraints,
    ...preferences,
  ]);

  return TripSnapshotSchema.parse({
    tripId: trip.id,
    takenAt,
    tripVersion: trip.version,
    trip,
    travellers,
    organisations,
    ...(anchorEvent ? { anchorEvent } : {}),
    places,
    ruleSets,
    constraints,
    preferences,
    sourceRecords,
  });
}

/** Places referenced by the trip's elements, its anchor event, or travellers' homes. */
function collectPlaceIds(trip: Trip, anchorEvent: AnchorEvent | undefined, travellers: Traveller[]): Set<EntityId> {
  const ids = new Set<EntityId>();
  for (const element of trip.elements) {
    if (element.elementKind === 'TRANSPORT_LEG') {
      ids.add(element.data.originPlaceId);
      ids.add(element.data.destinationPlaceId);
    } else if (element.elementKind === 'STAY') {
      ids.add(element.data.placeId);
    } else if (element.elementKind === 'ENGAGEMENT' && element.data.placeId) {
      ids.add(element.data.placeId);
    }
  }
  if (anchorEvent?.placeId) ids.add(anchorEvent.placeId);
  // Northstar initial planning needs traveller home-airport evidence; home
  // places are authoritative Place evidence, not planner guesses.
  for (const traveller of travellers) {
    if (traveller.homePlaceId) ids.add(traveller.homePlaceId);
  }
  return ids;
}

/** External refs a resolution target declares; the snapshot must carry the places they name. */
function declaredTargetRefs(target: ResolutionTarget): Array<{ system: string; value: string }> {
  const refs: Array<{ system: string; value: string }> = [];
  if (target.departureOrigin) refs.push(target.departureOrigin);
  if (target.stayPlaceRef) refs.push(target.stayPlaceRef);
  return refs;
}

/**
 * Generic principal scope for one trip (REV-C WP-C4): the trip's travellers
 * plus every organisation reachable from authoritative state — the operator,
 * the anchor-event organiser, and the owners of governing rule sets. This is
 * the SAME walk `buildTripSnapshot` performs, exposed so approval-time scope
 * membership checks can never diverge from the snapshot principal scope.
 * Generic ref matching only; no scenario knowledge.
 */
export async function principalScopeForTrip(
  deps: { trips: TripRepository; entities: EntityStore },
  tripId: EntityId,
): Promise<{ travellers: Traveller[]; organisations: Organisation[] }> {
  const trip = await deps.trips.getTrip(tripId);
  if (!trip) throw new Error(`unknown trip ${tripId}`);

  const travellers: Traveller[] = [];
  for (const travellerId of trip.travellerIds) {
    const entry = await deps.entities.get('TRAVELLER', travellerId);
    if (entry && entry.entityType === 'TRAVELLER') travellers.push(entry.entity);
  }

  const anchorEntry = trip.anchorEventId
    ? await deps.entities.get('ANCHOR_EVENT', trip.anchorEventId)
    : undefined;
  const anchorEvent = anchorEntry?.entityType === 'ANCHOR_EVENT' ? anchorEntry.entity : undefined;

  const constraints = await constraintsForTrip(deps.entities, trip);
  const ruleSetIds = collectRuleSetIds(trip, travellers, constraints);

  const organisationIds = new Set<EntityId>();
  if (trip.operatorOrganisationId) organisationIds.add(trip.operatorOrganisationId);
  if (anchorEvent?.organiserOrganisationId) organisationIds.add(anchorEvent.organiserOrganisationId);
  // Rule-set owners are in-scope principals too: a governing policy may name
  // an approving/paying organisation distinct from the operator, and authority
  // decisions are derived from this rule data. Generic ownerRef walk only.
  for (const ruleSetId of [...ruleSetIds].sort()) {
    const entry = await deps.entities.get('RULE_SET', ruleSetId);
    if (entry && entry.entityType === 'RULE_SET' && entry.entity.ownerOrganisationId) {
      organisationIds.add(entry.entity.ownerOrganisationId);
    }
  }

  const organisations: Organisation[] = [];
  for (const organisationId of [...organisationIds].sort()) {
    const entry = await deps.entities.get('ORGANISATION', organisationId);
    if (entry && entry.entityType === 'ORGANISATION') organisations.push(entry.entity);
  }

  return { travellers, organisations };
}

/**
 * Constraints in scope for this trip: any stored constraint whose refs point
 * at one of the trip's elements or objectives. Generic ref matching — no
 * scenario knowledge.
 */
export async function constraintsForTrip(entities: EntityStore, trip: Trip): Promise<Constraint[]> {
  const tripRefIds = new Set<EntityId>([
    ...trip.elements.map((element) => element.id),
    ...trip.objectives.map((objective) => objective.id),
  ]);
  return (await entities.list('CONSTRAINT'))
    .filter((entry) => entry.entityType === 'CONSTRAINT')
    .map((entry) => entry.entity)
    .filter((constraint) => constraint.refs.some((ref) => tripRefIds.has(ref.id)));
}

/** Rule sets governing the trip, its elements, travellers or constraints. */
function collectRuleSetIds(
  trip: Trip,
  travellers: Traveller[],
  constraints: Constraint[],
): Set<EntityId> {
  const ids = new Set<EntityId>(trip.governedByRuleSetIds);
  for (const element of trip.elements) {
    for (const ruleSetId of element.governedByRuleSetIds) ids.add(ruleSetId);
    if (element.elementKind === 'STAY') {
      for (const ruleSetId of element.data.policyRuleSetIds) ids.add(ruleSetId);
    }
  }
  for (const traveller of travellers) {
    for (const ruleSetId of traveller.insuranceRuleSetIds) ids.add(ruleSetId);
  }
  for (const constraint of constraints) {
    if (constraint.ruleSetId) ids.add(constraint.ruleSetId);
  }
  return ids;
}

/**
 * Generic provenance walk: every `sourceId` string reachable inside the given
 * state objects. Recursive and scenario-neutral — it knows a field name, not
 * any scenario content.
 */
export function collectSourceIds(values: unknown[]): Set<EntityId> {
  const ids = new Set<EntityId>();
  const walk = (value: unknown): void => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (typeof value === 'object') {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (key === 'sourceId' && typeof child === 'string') ids.add(child);
        else walk(child);
      }
    }
  };
  for (const value of values) walk(value);
  return ids;
}

/** Source metadata for referenced ids; unknown ids are skipped, not invented. */
async function referencedSourceRecords(
  sources: SourceRepository,
  stateObjects: unknown[],
): Promise<SourceRecord[]> {
  const records: SourceRecord[] = [];
  for (const sourceId of [...collectSourceIds(stateObjects)].sort()) {
    const record = await sources.getSource(sourceId);
    if (record) records.push(record);
  }
  return records;
}

/**
 * NORTHSTAR M6 — L3 evaluator: `m6.group`.
 *
 * Two blocking dimensions:
 *
 *  - `travel_together`: every `travel_together` constraint owned by a
 *    coordination group the Journey belongs to (via the shared
 *    `constraintsFor`/`governingOwners` reasoning in reachability.ts, which
 *    already scopes owners to groups this Journey is a member of). For every
 *    member Journey captured in the world, its last active TRANSPORT item
 *    into the constraint's `destination_place` (or its last active TRANSPORT
 *    item when no destination operand is given) must share this Journey's
 *    own reference service.
 *  - `resource_capacity`: every resource the Journey uses (via resource
 *    assignments on its own items or on programme items its traveller
 *    participates in, and reservation lines on a resource allocated to it).
 *    Usage is the sum, over time, of PROPOSED/CONFIRMED resource-assignment
 *    quantities and non-cancelled reservation-line allocation quantities
 *    across the WHOLE world (not just this Journey's own footprint — the
 *    resource is shared), swept against the resource's capacity.
 *
 * Pure: reads only `(subject, { now, world, effective })`, no I/O.
 */
import type { TypedRef } from '../../../domain/v2/shared/identity.ts';
import type { Instant } from '../../../domain/v2/shared/time.ts';
import { compareInstants } from '../../../domain/v2/shared/time.ts';
import type { CapturedWorld } from '../../world/world.ts';
import type { EffectiveItem, EffectiveJourney, EffectiveWorld } from '../../world/effectiveTypes.ts';
import type { Evaluator, EvaluatorOutput } from '../evaluator.ts';
import { dimension, explain, notApplicable } from '../explain.ts';
import { constraintsFor } from '../reachability.ts';
import { operandSubjectId } from '../constraintTypes.ts';
import type { CausalExplanation, EvidenceRef } from '../../../contracts/v2/assessment/explanation.ts';

const EVALUATOR_ID = 'm6.group';
const TRAVEL_TOGETHER = 'travel_together';
const RESOURCE_CAPACITY = 'resource_capacity';

function dedupeEvidence(refs: EvidenceRef[]): EvidenceRef[] {
  const map = new Map<string, EvidenceRef>();
  for (const r of refs) map.set(`${r.kind}:${r.id}:${r.detail ?? ''}`, r);
  return [...map.values()].sort((a, b) => `${a.kind}:${a.id}:${a.detail ?? ''}`.localeCompare(`${b.kind}:${b.id}:${b.detail ?? ''}`));
}

/** Last (latest-time) active TRANSPORT item, optionally restricted to one ending at `destinationPlaceId`. */
function lastRelevantTransportItem(journey: EffectiveJourney, destinationPlaceId: string | undefined): EffectiveItem | undefined {
  const transports = journey.items.filter((i) => i.active && i.kind === 'TRANSPORT');
  const candidates = destinationPlaceId ? transports.filter((i) => i.endPlaceId === destinationPlaceId) : transports;
  return candidates[candidates.length - 1];
}

function evaluateTravelTogether(
  subject: TypedRef,
  journey: EffectiveJourney,
  world: CapturedWorld,
  effective: EffectiveWorld,
): { applicable: boolean; explanations: CausalExplanation[] } {
  const constraints = constraintsFor(world, journey, TRAVEL_TOGETHER).filter((c) => c.owner.kind === 'COORDINATION_GROUP');
  if (constraints.length === 0) return { applicable: false, explanations: [] };

  const explanations: CausalExplanation[] = [];
  for (const constraint of constraints) {
    const constraintRef: TypedRef = { kind: 'CONSTRAINT_DEFINITION', id: constraint.id };
    const groupRef: TypedRef = constraint.owner;
    const destinationPlaceId = operandSubjectId(constraint, 'destination_place');
    const referenceItem = lastRelevantTransportItem(journey, destinationPlaceId);

    if (!referenceItem || !referenceItem.serviceRef) {
      explanations.push(explain({
        evaluatorId: EVALUATOR_ID, dimension: TRAVEL_TOGETHER, status: 'UNKNOWN', reasonCode: 'reference_service_unknown',
        cause: { kind: 'MISSING_INFORMATION' },
        affectedSubject: subject, relatedSubjects: [constraintRef, groupRef],
        facts: { ...(destinationPlaceId ? { destinationPlaceId } : {}) },
        uncertainty: [{ kind: 'MISSING_INPUT', code: 'transport_service', subjectRef: subject }],
      }));
      continue;
    }
    const referenceServiceId = referenceItem.serviceRef.id;

    const memberships = world.groupMemberships.filter((m) => m.groupId === groupRef.id).sort((a, b) => a.journeyId.localeCompare(b.journeyId));
    for (const membership of memberships) {
      const memberJourney = effective.journeys.find((j) => j.journeyRef.id === membership.journeyId);
      if (!memberJourney) continue; // not captured: outside evaluable scope, not a claim either way
      const memberRef: TypedRef = { kind: 'JOURNEY', id: membership.journeyId };
      const memberItem = lastRelevantTransportItem(memberJourney, destinationPlaceId);

      if (!memberItem || !memberItem.serviceRef) {
        explanations.push(explain({
          evaluatorId: EVALUATOR_ID, dimension: TRAVEL_TOGETHER, status: 'UNKNOWN', reasonCode: 'member_service_unknown',
          cause: { kind: 'MISSING_INFORMATION' },
          affectedSubject: subject, relatedSubjects: [constraintRef, groupRef, memberRef],
          facts: { memberJourneyId: membership.journeyId, ...(destinationPlaceId ? { destinationPlaceId } : {}) },
          uncertainty: [{ kind: 'MISSING_INPUT', code: 'transport_service', subjectRef: memberRef }],
        }));
        continue;
      }

      const sameService = memberItem.serviceRef.id === referenceServiceId;
      explanations.push(explain({
        evaluatorId: EVALUATOR_ID, dimension: TRAVEL_TOGETHER, status: sameService ? 'PASS' : 'FAIL',
        reasonCode: sameService ? 'members_share_service' : 'members_split',
        cause: { kind: 'WORLD_STATE' },
        affectedSubject: subject,
        relatedSubjects: [constraintRef, groupRef, memberRef, referenceItem.serviceRef, memberItem.serviceRef],
        facts: {
          memberJourneyId: membership.journeyId, referenceServiceId, memberServiceId: memberItem.serviceRef.id,
          ...(destinationPlaceId ? { destinationPlaceId } : {}),
        },
      }));
    }
  }
  return { applicable: true, explanations };
}

function usedResourceIds(journeyId: string, travellerId: string, world: CapturedWorld): string[] {
  const itemIds = new Set(world.journeyItems.filter((i) => i.journeyId === journeyId).map((i) => i.id));
  const programmeItemIds = new Set(world.participations.filter((p) => p.travellerId === travellerId).map((p) => p.programmeItemId));
  const ids = new Set<string>();
  for (const a of world.resourceAssignments) {
    if (a.activityKind === 'JOURNEY_ITEM' && itemIds.has(a.activityId)) ids.add(a.resourceId);
    if (a.activityKind === 'PROGRAMME_ITEM' && programmeItemIds.has(a.activityId)) ids.add(a.resourceId);
  }
  for (const line of world.reservationLines) {
    if (!line.resourceId) continue;
    const allocated = world.allocations.some((al) => al.lineId === line.id && (
      (al.journeyItemId !== null && itemIds.has(al.journeyItemId)) ||
      (al.journeyItemId === null && al.travellerId === travellerId)
    ));
    if (allocated) ids.add(line.resourceId);
  }
  return [...ids].sort();
}

function activityWindow(world: CapturedWorld, effective: EffectiveWorld, activityKind: 'PROGRAMME_ITEM' | 'JOURNEY_ITEM', activityId: string): { start: Instant; end: Instant } | null {
  if (activityKind === 'PROGRAMME_ITEM') {
    const pi = world.programmeItems.find((p) => p.id === activityId);
    return pi?.window ?? null;
  }
  const item = effective.journeys.flatMap((j) => j.items).find((i) => i.itemRef.id === activityId);
  if (!item || item.start.value === null || item.end.value === null) return null;
  return { start: item.start.value, end: item.end.value };
}

interface UsageEntry { quantity: number; window: { start: Instant; end: Instant } | null }

function usageEntriesFor(resourceId: string, world: CapturedWorld, effective: EffectiveWorld): UsageEntry[] {
  const entries: UsageEntry[] = [];
  for (const a of world.resourceAssignments) {
    if (a.resourceId !== resourceId) continue;
    if (a.lifecycleStatus !== 'PROPOSED' && a.lifecycleStatus !== 'CONFIRMED') continue;
    entries.push({ quantity: a.quantity, window: activityWindow(world, effective, a.activityKind, a.activityId) });
  }
  for (const line of world.reservationLines) {
    if (line.resourceId !== resourceId) continue;
    if (line.observedStatus === 'CANCELLED') continue;
    for (const al of world.allocations.filter((x) => x.lineId === line.id)) {
      entries.push({ quantity: al.quantity, window: line.interval });
    }
  }
  return entries;
}

function evaluateResourceCapacity(
  subject: TypedRef,
  journey: EffectiveJourney,
  world: CapturedWorld,
  effective: EffectiveWorld,
): { applicable: boolean; explanations: CausalExplanation[] } {
  const resourceIds = usedResourceIds(journey.journeyRef.id, journey.travellerId, world);
  if (resourceIds.length === 0) return { applicable: false, explanations: [] };

  const explanations: CausalExplanation[] = [];
  for (const resourceId of resourceIds) {
    const resourceRef: TypedRef = { kind: 'RESOURCE', id: resourceId };
    const resource = world.resources.find((r) => r.id === resourceId);
    if (!resource || resource.capacity === null) {
      explanations.push(explain({
        evaluatorId: EVALUATOR_ID, dimension: RESOURCE_CAPACITY, status: 'UNKNOWN', reasonCode: 'capacity_unknown',
        cause: { kind: 'MISSING_INFORMATION' }, affectedSubject: subject, relatedSubjects: [resourceRef],
        facts: { resourceId },
        uncertainty: [{ kind: 'MISSING_INPUT', code: 'resource_capacity', subjectRef: resourceRef }],
      }));
      continue;
    }

    const entries = usageEntriesFor(resourceId, world, effective);
    if (entries.some((e) => e.window === null)) {
      explanations.push(explain({
        evaluatorId: EVALUATOR_ID, dimension: RESOURCE_CAPACITY, status: 'UNKNOWN', reasonCode: 'usage_time_unknown',
        cause: { kind: 'MISSING_INFORMATION' }, affectedSubject: subject, relatedSubjects: [resourceRef],
        facts: { resourceId },
        uncertainty: [{ kind: 'MISSING_INPUT', code: 'usage_time', subjectRef: resourceRef }],
      }));
      continue;
    }

    const timed = entries as { quantity: number; window: { start: Instant; end: Instant } }[];
    const events = timed.flatMap((e) => [{ t: e.window.start, delta: e.quantity }, { t: e.window.end, delta: -e.quantity }]);
    events.sort((a, b) => compareInstants(a.t, b.t) || a.delta - b.delta);
    let running = 0;
    let peak = 0;
    let peakAt: Instant | null = null;
    for (const ev of events) {
      running += ev.delta;
      if (running > peak) { peak = running; peakAt = ev.t; }
    }

    if (peak > resource.capacity) {
      explanations.push(explain({
        evaluatorId: EVALUATOR_ID, dimension: RESOURCE_CAPACITY, status: 'FAIL', reasonCode: 'capacity_exceeded',
        cause: { kind: 'WORLD_STATE' }, affectedSubject: subject, relatedSubjects: [resourceRef],
        facts: { resourceId, capacity: resource.capacity, usage: peak, ...(peakAt ? { at: peakAt } : {}) },
      }));
    } else {
      explanations.push(explain({
        evaluatorId: EVALUATOR_ID, dimension: RESOURCE_CAPACITY, status: 'PASS', reasonCode: 'capacity_within_limit',
        cause: { kind: 'WORLD_STATE' }, affectedSubject: subject, relatedSubjects: [resourceRef],
        facts: { resourceId, capacity: resource.capacity, usage: peak },
      }));
    }
  }
  return { applicable: true, explanations };
}

export const groupEvaluator: Evaluator = {
  id: EVALUATOR_ID,
  version: '1',
  assessmentKind: 'VIABILITY',
  subjectKinds: ['JOURNEY'],
  dimensions: [TRAVEL_TOGETHER, RESOURCE_CAPACITY],
  informationTopics: [],
  evaluate(subject, { world, effective }): EvaluatorOutput {
    const journey = effective.journeys.find((j) => j.journeyRef.id === subject.id);
    if (!journey) return { dimensions: [notApplicable(TRAVEL_TOGETHER), notApplicable(RESOURCE_CAPACITY)], evidence: [], missingCoverage: [] };

    const travelTogether = evaluateTravelTogether(subject, journey, world, effective);
    const resourceCapacity = evaluateResourceCapacity(subject, journey, world, effective);

    const dimensions = [
      travelTogether.applicable ? dimension({ dimension: TRAVEL_TOGETHER, explanations: travelTogether.explanations }) : notApplicable(TRAVEL_TOGETHER),
      resourceCapacity.applicable ? dimension({ dimension: RESOURCE_CAPACITY, explanations: resourceCapacity.explanations }) : notApplicable(RESOURCE_CAPACITY),
    ];
    const evidence = dedupeEvidence([...travelTogether.explanations, ...resourceCapacity.explanations].flatMap((e) => e.evidenceRefs));
    return { dimensions, evidence, missingCoverage: [] };
  },
};

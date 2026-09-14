/**
 * NORTHSTAR M6 — shared, pure itinerary reasoning used by several evaluators.
 *
 * - Which registered constraints govern a Journey (its own, its Trip's, its
 *   Traveller's, its responsible/business organisations', its groups', the
 *   programmes it participates in, and the places it touches).
 * - Whether a traveller can be at a place by an instant: the latest active
 *   effective transport arrival into that place (or into another place with a
 *   registered transfer time to it) no later than the deadline.
 *
 * Absence is never success: no route, unknown times, or a missing transfer
 * time are UNKNOWN with a typed uncertainty; only evidence makes PASS/FAIL.
 */
import type { TypedRef } from '../../domain/v2/shared/identity.ts';
import type { Instant } from '../../domain/v2/shared/time.ts';
import type { Uncertainty } from '../../contracts/v2/assessment/explanation.ts';
import type { CapturedWorld, WConstraintDefinition } from '../world/world.ts';
import type { EffectiveItem, EffectiveJourney } from '../world/effectiveTypes.ts';
import { operandNumber, operandSubjectId } from './constraintTypes.ts';
import { addMinutes, minutesBetween } from './explain.ts';

const key = (ref: TypedRef) => `${ref.kind}:${ref.id}`;

/** Owners whose constraints govern this Journey, most specific first. */
export function governingOwners(world: CapturedWorld, journey: EffectiveJourney): TypedRef[] {
  const j = world.journeys.find((x) => x.id === journey.journeyRef.id);
  const trip = j ? world.trips.find((t) => t.id === j.tripId) : undefined;
  const owners: TypedRef[] = [journey.journeyRef];
  if (trip) owners.push({ kind: 'TRIP', id: trip.id });
  owners.push({ kind: 'TRAVELLER', id: journey.travellerId });
  for (const m of world.groupMemberships.filter((m) => m.journeyId === journey.journeyRef.id)) owners.push({ kind: 'COORDINATION_GROUP', id: m.groupId });
  for (const p of world.participations.filter((p) => p.travellerId === journey.travellerId)) {
    const item = world.programmeItems.find((i) => i.id === p.programmeItemId);
    if (item) owners.push({ kind: 'PROGRAMME', id: item.programmeId }, { kind: 'PROGRAMME_ITEM', id: item.id });
  }
  for (const orgId of [j?.responsibilityOrganisationId, trip?.businessContextOrganisationId]) if (orgId) owners.push({ kind: 'ORGANISATION', id: orgId });
  for (const item of journey.items) for (const placeId of [item.startPlaceId, item.endPlaceId]) if (placeId) owners.push({ kind: 'PLACE', id: placeId });
  return [...new Map(owners.map((o) => [key(o), o])).values()];
}

export function constraintsFor(world: CapturedWorld, journey: EffectiveJourney, registeredType: string): WConstraintDefinition[] {
  const owners = new Set(governingOwners(world, journey).map(key));
  return world.constraints.filter((c) => c.registeredType === registeredType && owners.has(key(c.owner))).sort((a, b) => a.id.localeCompare(b.id));
}

/** Registered transfer minutes between two distinct places (either direction when only one is registered). */
export function transferMinutes(world: CapturedWorld, journey: EffectiveJourney, fromPlaceId: string, toPlaceId: string): { minutes: number; constraint: WConstraintDefinition } | undefined {
  const candidates = constraintsFor(world, journey, 'transfer_minutes');
  const exact = candidates.find((c) => operandSubjectId(c, 'from_place') === fromPlaceId && operandSubjectId(c, 'to_place') === toPlaceId);
  const reverse = candidates.find((c) => operandSubjectId(c, 'from_place') === toPlaceId && operandSubjectId(c, 'to_place') === fromPlaceId);
  const chosen = exact ?? reverse;
  const minutes = chosen ? operandNumber(chosen, 'minutes') : undefined;
  return chosen && minutes !== undefined ? { minutes, constraint: chosen } : undefined;
}

export interface ReachResult {
  status: 'PASS' | 'FAIL' | 'UNKNOWN';
  reasonCode: 'arrives_in_time' | 'arrives_after_deadline' | 'arrival_time_unknown' | 'no_route_to_place' | 'transfer_time_unknown';
  /** The transport item whose effective arrival was used. */
  item?: EffectiveItem;
  arrival?: Instant;
  transferMinutes?: number;
  readyAt?: Instant;
  slackMinutes?: number;
  constraint?: WConstraintDefinition;
  uncertainty: Uncertainty[];
}

/**
 * Can the traveller be at `placeId` by `deadline`? Uses the latest active
 * transport arriving at the place (or at a place with a registered transfer to
 * it) whose arrival is not after the deadline; if every candidate arrives after
 * the deadline, the earliest one is the evidence for FAIL.
 */
export function reachPlaceBy(world: CapturedWorld, journey: EffectiveJourney, placeId: string, deadline: Instant): ReachResult {
  const transports = journey.items.filter((i) => i.active && i.kind === 'TRANSPORT' && i.endPlaceId !== null);
  const direct = transports.filter((i) => i.endPlaceId === placeId);
  const viaTransfer = transports
    .filter((i) => i.endPlaceId !== placeId)
    .map((i) => ({ item: i, transfer: transferMinutes(world, journey, i.endPlaceId as string, placeId) }))
    .filter((c) => c.transfer !== undefined);

  const candidates: { item: EffectiveItem; transfer: number; constraint?: WConstraintDefinition }[] = [
    ...direct.map((item) => ({ item, transfer: 0 })),
    ...viaTransfer.map((c) => ({ item: c.item, transfer: c.transfer!.minutes, constraint: c.transfer!.constraint })),
  ];
  if (candidates.length === 0) {
    const arrivesElsewhere = transports.length > 0;
    return {
      status: 'UNKNOWN',
      reasonCode: arrivesElsewhere ? 'transfer_time_unknown' : 'no_route_to_place',
      uncertainty: [{ kind: 'MISSING_INPUT', code: arrivesElsewhere ? 'transfer_minutes' : 'route_to_place', subjectRef: { kind: 'PLACE', id: placeId } }],
    };
  }
  const timed = candidates.filter((c) => c.item.end.value !== null);
  if (timed.length === 0) {
    return { status: 'UNKNOWN', reasonCode: 'arrival_time_unknown', item: candidates[0]!.item, uncertainty: [{ kind: 'MISSING_INPUT', code: 'arrival_time', subjectRef: candidates[0]!.item.itemRef }] };
  }
  const scored = timed.map((c) => {
    const arrival = c.item.end.value as Instant;
    const readyAt = addMinutes(arrival, c.transfer);
    return { ...c, arrival, readyAt, slack: minutesBetween(readyAt, deadline) };
  });
  const inTime = scored.filter((s) => s.slack >= 0).sort((a, b) => a.slack - b.slack);
  if (inTime.length > 0) {
    const best = inTime[0]!;
    return { status: 'PASS', reasonCode: 'arrives_in_time', item: best.item, arrival: best.arrival, transferMinutes: best.transfer, readyAt: best.readyAt, slackMinutes: best.slack, ...(best.constraint ? { constraint: best.constraint } : {}), uncertainty: [] };
  }
  const earliest = scored.sort((a, b) => b.slack - a.slack)[0]!;
  return { status: 'FAIL', reasonCode: 'arrives_after_deadline', item: earliest.item, arrival: earliest.arrival, transferMinutes: earliest.transfer, readyAt: earliest.readyAt, slackMinutes: earliest.slack, ...(earliest.constraint ? { constraint: earliest.constraint } : {}), uncertainty: [] };
}

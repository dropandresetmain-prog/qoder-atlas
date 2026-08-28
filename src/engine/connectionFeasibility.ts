/**
 * Generic connection feasibility: compares predicted/observed inbound arrival
 * against onward departure using trip topology (CONNECTS_TO or inferred hub
 * pairs). No scenario, airport, or fixture branches.
 */
import type { EntityId, IsoDateTime } from '../domain/common.ts';
import { instantMillis } from '../domain/common.ts';
import type { TransportLeg, TripElement } from '../domain/elements.ts';
import type { Place } from '../domain/entities.ts';
import type { RuleSet } from '../domain/rules.ts';
import type { Trip, TripRelation } from '../domain/trip.ts';

function isFlightLeg(element: TripElement): element is TransportLeg {
  return element.elementKind === 'TRANSPORT_LEG' && element.data.mode === 'FLIGHT';
}

export type ConnectionViability = 'VIABLE' | 'TIGHT' | 'IMPOSSIBLE';

export interface ConnectionPairAssessment {
  upstreamId: EntityId;
  downstreamId: EntityId;
  marginMinutes: number;
  requiredBufferMinutes: number;
  viability: ConnectionViability;
  reason: string;
}

/** Fallback when no CONNECTION_BUFFER policy rule or relation meta is present. */
export const DEFAULT_CONNECTION_BUFFER_MINUTES = 90;

export interface ConnectionPairRef {
  upstreamId: EntityId;
  downstreamId: EntityId;
  minBufferMinutes: number;
}

function transportLegs(trip: Trip): TransportLeg[] {
  return trip.elements.filter(isFlightLeg);
}

function arrivalInstant(leg: TransportLeg): IsoDateTime | undefined {
  return leg.data.scheduledArrival?.value;
}

function departureInstant(leg: TransportLeg): IsoDateTime | undefined {
  return leg.data.scheduledDeparture?.value;
}

function marginMinutesBetween(arrival: IsoDateTime, departure: IsoDateTime): number {
  return Math.round((instantMillis(departure) - instantMillis(arrival)) / 60_000);
}

function minBufferFromRelation(relation: TripRelation): number | undefined {
  const raw = relation.meta?.['minBufferMinutes'];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
}

function minBufferFromRuleSets(ruleSets: readonly RuleSet[]): number | undefined {
  let best: number | undefined;
  for (const ruleSet of ruleSets) {
    for (const rule of ruleSet.rules) {
      if (rule.kind !== 'CONNECTION_BUFFER') continue;
      const minutes = rule.buffer.minimumMinutes ?? rule.buffer.expectedMinutes;
      if (minutes === undefined) continue;
      best = best === undefined ? minutes : Math.max(best, minutes);
    }
  }
  return best;
}

/** Discover connection pairs from CONNECTS_TO relations or consecutive hub-aligned legs. */
export function discoverConnectionPairs(trip: Trip, ruleSets: readonly RuleSet[] = []): ConnectionPairRef[] {
  const legs = transportLegs(trip);
  const byId = new Map(legs.map((leg) => [leg.id, leg]));
  const policyBuffer = minBufferFromRuleSets(ruleSets) ?? DEFAULT_CONNECTION_BUFFER_MINUTES;
  const pairs: ConnectionPairRef[] = [];
  const seen = new Set<string>();

  for (const relation of trip.relations) {
    if (relation.kind !== 'CONNECTS_TO') continue;
    if (relation.from.entityType !== 'TRIP_ELEMENT' || relation.to.entityType !== 'TRIP_ELEMENT') continue;
    const upstream = byId.get(relation.from.id);
    const downstream = byId.get(relation.to.id);
    if (!upstream || !downstream) continue;
    const key = `${upstream.id}->${downstream.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({
      upstreamId: upstream.id,
      downstreamId: downstream.id,
      minBufferMinutes: minBufferFromRelation(relation) ?? policyBuffer,
    });
  }

  const sorted = [...legs].sort((a, b) => {
    const ad = departureInstant(a) ?? arrivalInstant(a) ?? '';
    const bd = departureInstant(b) ?? arrivalInstant(b) ?? '';
    return ad.localeCompare(bd);
  });

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const upstream = sorted[index]!;
    const downstream = sorted[index + 1]!;
    if (upstream.data.destinationPlaceId !== downstream.data.originPlaceId) continue;
    const key = `${upstream.id}->${downstream.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({
      upstreamId: upstream.id,
      downstreamId: downstream.id,
      minBufferMinutes: policyBuffer,
    });
  }

  return pairs;
}

export function assessConnectionPairs(
  trip: Trip,
  ruleSets: readonly RuleSet[] = [],
): ConnectionPairAssessment[] {
  const legs = transportLegs(trip);
  const byId = new Map(legs.map((leg) => [leg.id, leg]));
  const assessments: ConnectionPairAssessment[] = [];

  for (const pair of discoverConnectionPairs(trip, ruleSets)) {
    const upstream = byId.get(pair.upstreamId);
    const downstream = byId.get(pair.downstreamId);
    if (!upstream || !downstream) continue;
    const arrival = arrivalInstant(upstream);
    const departure = departureInstant(downstream);
    if (!arrival || !departure) {
      assessments.push({
        upstreamId: pair.upstreamId,
        downstreamId: pair.downstreamId,
        marginMinutes: Number.NaN,
        requiredBufferMinutes: pair.minBufferMinutes,
        viability: 'TIGHT',
        reason: 'connection timing is not fully known yet',
      });
      continue;
    }

    const marginMinutes = marginMinutesBetween(arrival, departure);
    let viability: ConnectionViability = 'VIABLE';
    let reason = `${marginMinutes} minutes between arrival and onward departure`;
    if (marginMinutes <= 0) {
      viability = 'IMPOSSIBLE';
      reason = `onward departure is ${Math.abs(marginMinutes)} minutes before inbound arrival`;
    } else if (marginMinutes < pair.minBufferMinutes) {
      viability = 'TIGHT';
      reason = `only ${marginMinutes} minutes remain; ${pair.minBufferMinutes} minutes are required to make the connection`;
    }

    assessments.push({
      upstreamId: pair.upstreamId,
      downstreamId: pair.downstreamId,
      marginMinutes,
      requiredBufferMinutes: pair.minBufferMinutes,
      viability,
      reason,
    });
  }

  return assessments;
}

export function connectionFailureElementIds(
  assessments: readonly ConnectionPairAssessment[],
): { impossible: EntityId[]; tight: EntityId[] } {
  const impossible = new Set<EntityId>();
  const tight = new Set<EntityId>();
  for (const assessment of assessments) {
    if (assessment.viability === 'IMPOSSIBLE') {
      impossible.add(assessment.downstreamId);
      impossible.add(assessment.upstreamId);
    } else if (assessment.viability === 'TIGHT') {
      tight.add(assessment.downstreamId);
    }
  }
  return {
    impossible: [...impossible],
    tight: [...tight].filter((id) => !impossible.has(id)),
  };
}

export function isTransportElement(element: TripElement): element is TransportLeg {
  return isFlightLeg(element);
}

export function placeCodeFor(place: Place | undefined): string | undefined {
  if (!place) return undefined;
  return place.externalRefs.find((ref) => ref.system === 'airport-code')?.value ?? place.name;
}

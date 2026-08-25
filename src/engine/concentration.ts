/**
 * Deterministic TRANSPORT_CONCENTRATION assessment.
 *
 * Groups travellers who share a booking reference or a carrier service
 * (carrier identity + departure instant), counts those whose importance
 * matches the rule's criticalImportance, and reports violations when the
 * count exceeds maxCriticalParticipants.
 *
 * Pure and data-driven: threshold/scope/importance come from the rule.
 * No scenario, city, supplier, or traveller-name branching.
 */
import type { EntityId, IsoDateTime } from '../domain/common.ts';
import type { Importance, TransportLeg } from '../domain/elements.ts';
import type { PolicyRule } from '../domain/rules.ts';
import type { Trip } from '../domain/trip.ts';

export type TransportConcentrationRule = Extract<PolicyRule, { kind: 'TRANSPORT_CONCENTRATION' }>;

/** One traveller's declared presence on a transport service. */
export interface ConcentrationParticipant {
  travellerId: EntityId;
  importance: Importance;
  bookingRef?: { system: string; reference: string };
  carrierRef?: { system: string; value: string };
  departureAt?: IsoDateTime;
}

export interface ConcentrationViolation {
  groupKey: string;
  criticalCount: number;
  criticalTravellerIds: EntityId[];
  maxCriticalParticipants: number;
}

export interface ConcentrationAssessment {
  ok: boolean;
  violations: ConcentrationViolation[];
}

function groupKeyFor(
  rule: TransportConcentrationRule,
  participant: ConcentrationParticipant,
): string | undefined {
  if (rule.scope === 'BOOKING_REF') {
    if (!participant.bookingRef) return undefined;
    return `booking:${participant.bookingRef.system}:${participant.bookingRef.reference}`;
  }
  if (!participant.carrierRef || !participant.departureAt) return undefined;
  return `carrier:${participant.carrierRef.system}:${participant.carrierRef.value}:${participant.departureAt}`;
}

/**
 * Assess whether critical participants concentrate beyond the rule threshold.
 * Participants outside the rule's grouping scope (missing booking ref / carrier
 * evidence) are ignored — absence is not fabricated into a group.
 */
export function assessTransportConcentration(
  rule: TransportConcentrationRule,
  participants: ConcentrationParticipant[],
): ConcentrationAssessment {
  const groups = new Map<string, ConcentrationParticipant[]>();
  for (const participant of participants) {
    const key = groupKeyFor(rule, participant);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(participant);
    groups.set(key, list);
  }

  const violations: ConcentrationViolation[] = [];
  for (const [groupKey, members] of groups) {
    const critical = members.filter((member) => member.importance === rule.criticalImportance);
    // Distinct travellers — one person on two legs of the same service counts once.
    const criticalTravellerIds = [...new Set(critical.map((member) => member.travellerId))].sort();
    if (criticalTravellerIds.length > rule.maxCriticalParticipants) {
      violations.push({
        groupKey,
        criticalCount: criticalTravellerIds.length,
        criticalTravellerIds,
        maxCriticalParticipants: rule.maxCriticalParticipants,
      });
    }
  }

  return { ok: violations.length === 0, violations };
}

/**
 * Derive concentration participants from one or more trips.
 * Each traveller on a trip that carries an active TRANSPORT_LEG becomes one
 * participant per such leg, using the leg's importance (engagement-level
 * criticality is applied by callers that enrich importance when available).
 */
export function transportConcentrationParticipants(trips: Trip[]): ConcentrationParticipant[] {
  const participants: ConcentrationParticipant[] = [];
  for (const trip of trips) {
    const legs = trip.elements.filter(
      (element): element is TransportLeg =>
        element.elementKind === 'TRANSPORT_LEG' &&
        element.reservationState !== 'CANCELLED' &&
        element.status !== 'INVALID',
    );
    for (const travellerId of trip.travellerIds) {
      for (const leg of legs) {
        participants.push({
          travellerId,
          importance: leg.importance,
          ...(leg.data.bookingRef ? { bookingRef: leg.data.bookingRef } : {}),
          ...(leg.data.carrierRef ? { carrierRef: leg.data.carrierRef } : {}),
          ...(leg.data.scheduledDeparture
            ? { departureAt: leg.data.scheduledDeparture.value }
            : {}),
        });
      }
    }
  }
  return participants;
}

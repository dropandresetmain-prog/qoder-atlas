/**
 * Generic journey-chain projection rules (DESIGN.md §4.2).
 *
 * Operator surfaces show transport → stay → one recovery-relevant commitment,
 * not every programme engagement. Selection is deterministic and generic —
 * no scenario or traveller branching.
 */
import type { Engagement, Stay, TransportLeg, TripElement } from '../domain/elements.ts';
import type { Trip } from '../domain/trip.ts';
import type { RecoveryCase } from '../operational/case.ts';

/** Pick the commitment that matters for recovery / case context. */
export function selectRecoveryCommitment(trip: Trip, recoveryCase?: RecoveryCase): Engagement | undefined {
  const engagements = trip.elements.filter((element): element is Engagement => element.elementKind === 'ENGAGEMENT');
  if (engagements.length === 0) return undefined;
  const affected = new Set(recoveryCase?.affectedElementIds ?? []);

  const priority = (engagement: Engagement): number => {
    const isAffected = affected.has(engagement.id);
    const isRequired = engagement.importance === 'REQUIRED';
    if (isAffected && isRequired) return 0;
    if (isAffected) return 1;
    if (isRequired) return 2;
    return 3;
  };

  return [...engagements].sort((a, b) => {
    const diff = priority(a) - priority(b);
    if (diff !== 0) return diff;
    return a.data.startsAt.value.localeCompare(b.data.startsAt.value);
  })[0];
}

export function countOtherCommitments(trip: Trip, selected?: Engagement): number {
  const total = trip.elements.filter((element) => element.elementKind === 'ENGAGEMENT').length;
  return selected ? Math.max(0, total - 1) : Math.max(0, total - 1);
}

/** Transport legs and stays relevant to the journey, time-ordered within kind. */
export function selectJourneyTransportAndStay(trip: Trip): TripElement[] {
  const kindOrder: Record<TripElement['elementKind'], number> = { TRANSPORT_LEG: 0, STAY: 1, ENGAGEMENT: 2 };
  const journeyElements = trip.elements.filter((element) => element.elementKind !== 'ENGAGEMENT');
  return [...journeyElements].sort((a, b) => {
    const kindDiff = kindOrder[a.elementKind] - kindOrder[b.elementKind];
    if (kindDiff !== 0) return kindDiff;
    const timeA = elementMoment(a);
    const timeB = elementMoment(b);
    if (timeA && timeB) {
      const diff = timeA.localeCompare(timeB);
      if (diff !== 0) return diff;
    } else if (timeA || timeB) {
      return timeA ? -1 : 1;
    }
    return a.id.localeCompare(b.id);
  });
}

function elementMoment(element: TripElement): string | undefined {
  if (element.elementKind === 'TRANSPORT_LEG') {
    return element.data.scheduledDeparture?.value ?? element.data.scheduledArrival?.value;
  }
  if (element.elementKind === 'STAY') return element.data.checkIn.value;
  return element.data.startsAt.value;
}

export function isTransportLeg(element: TripElement): element is TransportLeg {
  return element.elementKind === 'TRANSPORT_LEG';
}

export function isStayElement(element: TripElement): element is Stay {
  return element.elementKind === 'STAY';
}

export function isEngagementElement(element: TripElement): element is Engagement {
  return element.elementKind === 'ENGAGEMENT';
}

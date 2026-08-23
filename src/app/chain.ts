/**
 * Wave 3 product convergence — journey chain projection (DESIGN.md §4.2).
 *
 * Kimi's case view renders the trip as a chain of dependent components
 * (flight — transfer — stay — ✦ commitment). This module builds that chain
 * strictly from authoritative state: element reservation states, health
 * statuses, case impact evidence, and the executing strategy's candidate
 * operations. Nothing here fabricates a booking or a state that the domain
 * does not already carry; an unknown fact renders UNKNOWN (grey + "?"),
 * never a confident colour.
 */
import type { IsoDateTime } from '../domain/common.ts';
import type { Place, AnchorEvent } from '../domain/entities.ts';
import type { Engagement, Stay, TransportLeg, TripElement } from '../domain/elements.ts';
import type { Trip } from '../domain/trip.ts';
import type { RecoveryCase } from '../operational/case.ts';
import type { ChainLinkState, ChainLinkView } from '../ui/case-view-model.ts';

const TRANSPORT_WORD: Record<TransportLeg['data']['mode'], string> = {
  FLIGHT: 'Flight',
  TRAIN: 'Train',
  FERRY: 'Ferry',
  PUBLIC_TRANSIT: 'Transit',
  TAXI_OR_RIDEHAIL: 'Taxi',
  PRIVATE_TRANSFER: 'Transfer',
  CAR_RENTAL: 'Car rental',
  WALKING: 'On foot',
  OTHER: 'Transport',
};

/** User-facing kind label; airport/station rail legs read as "Transfer". */
function kindLabel(element: TripElement, places: ReadonlyMap<string, Place>): string {
  if (element.elementKind === 'STAY') return 'Stay';
  if (element.elementKind === 'ENGAGEMENT') return 'Commitment';
  const leg = element as TransportLeg;
  if (leg.data.mode === 'FLIGHT') return 'Flight';
  const origin = places.get(leg.data.originPlaceId);
  if (origin && (origin.kind === 'AIRPORT' || origin.kind === 'RAIL_STATION')) return 'Transfer';
  return TRANSPORT_WORD[leg.data.mode];
}

function placeName(placeId: string | undefined, places: ReadonlyMap<string, Place>): string | undefined {
  if (!placeId) return undefined;
  const place = places.get(placeId);
  return place?.name ?? place?.externalRefs[0]?.value ?? placeId;
}

function formatDayTime(iso: IsoDateTime | undefined): string | undefined {
  if (!iso) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!match) return undefined;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(match[3])} ${months[Number(match[2]) - 1] ?? match[2]} · ${match[4]}:${match[5]}`;
}

function elementMoment(element: TripElement): IsoDateTime | undefined {
  if (element.elementKind === 'TRANSPORT_LEG') {
    return element.data.scheduledDeparture?.value ?? element.data.scheduledArrival?.value;
  }
  if (element.elementKind === 'STAY') return element.data.checkIn.value;
  return element.data.startsAt.value;
}

function transportLabel(leg: TransportLeg, places: ReadonlyMap<string, Place>): string {
  const from = placeName(leg.data.originPlaceId, places);
  const to = placeName(leg.data.destinationPlaceId, places);
  const route = from && to ? `${from} → ${to}` : undefined;
  return route ? `${TRANSPORT_WORD[leg.data.mode]} · ${route}` : TRANSPORT_WORD[leg.data.mode];
}

function stayDetail(stay: Stay, places: ReadonlyMap<string, Place>): string | undefined {
  const nights = Math.max(
    1,
    Math.round(
      (Date.parse(stay.data.checkOut.value) - Date.parse(stay.data.checkIn.value)) / 86_400_000,
    ),
  );
  const place = placeName(stay.data.placeId, places);
  const nightsText = `${nights} night${nights === 1 ? '' : 's'}`;
  return place ? `${place} · ${nightsText}` : nightsText;
}

function engagementLabel(engagement: Engagement, event: AnchorEvent | undefined): string {
  return event ? `${engagement.data.title} · ${event.name}` : engagement.data.title;
}

/**
 * Chain state is derived from evidence only:
 * health status dominates (INVALID = broken, AT_RISK = at risk); otherwise
 * the reservation state decides. A booking that was never made renders grey
 * (UNBOOKED), never green. Case impact evidence marks affected components
 * at-risk unless their own state already says worse.
 */
function linkState(element: TripElement, affected: ReadonlySet<string>, recoveryCase: RecoveryCase | undefined): ChainLinkState {
  if (element.status === 'INVALID') return 'BROKEN';
  if (element.status === 'AT_RISK') return 'AT_RISK';
  switch (element.reservationState) {
    case 'CANCELLED':
      return 'BROKEN';
    case 'NONE':
      return 'UNBOOKED';
    case 'UNKNOWN':
      return 'UNKNOWN';
    case 'HELD':
      // A hold opened by the executing strategy is a checked proposal;
      // any other hold is an unverified reservation.
      return recoveryCase && recoveryCase.status !== 'RESOLVED' && affected.has(element.id)
        ? 'PROPOSED'
        : 'AT_RISK';
    case 'CONFIRMED':
    case 'CHANGED':
    case 'COMPLETED':
      if (element.status === 'UNKNOWN' && element.reservationState !== 'COMPLETED') {
        // Reserved but never verified — colour honest, words explicit.
        return 'UNKNOWN';
      }
      return affected.has(element.id) && recoveryCase && recoveryCase.status !== 'RESOLVED'
        ? 'AT_RISK'
        : 'CONFIRMED';
    default:
      return 'UNKNOWN';
  }
}

function linkDetail(element: TripElement, state: ChainLinkState, places: ReadonlyMap<string, Place>): string | undefined {
  if (element.elementKind === 'TRANSPORT_LEG') {
    const when = formatDayTime(element.data.scheduledDeparture?.value);
    if (state === 'BROKEN') return when ? `No longer works as booked · ${when}` : 'No longer works as booked';
    return when;
  }
  if (element.elementKind === 'STAY') return stayDetail(element as Stay, places);
  const starts = formatDayTime(element.data.startsAt.value);
  return starts ? `${starts} · fixed` : 'Fixed — this cannot move';
}

/**
 * Project the journey chain for a case view. Ordered travel-first to
 * commitment by each element's earliest known instant; never fabricates an
 * element the trip does not have. Returns undefined when the trip has no
 * elements at all (the case view then falls back to the affected-items list).
 */
export function projectCaseChain(
  trip: Trip,
  recoveryCase: RecoveryCase | undefined,
  context: {
    places: ReadonlyMap<string, Place>;
    anchorEvent?: AnchorEvent;
  },
): ChainLinkView[] | undefined {
  if (trip.elements.length === 0) return undefined;
  const affected = new Set(recoveryCase?.affectedElementIds ?? []);
  const ordered = [...trip.elements].sort((a, b) => {
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

  const links: ChainLinkView[] = ordered.map((element) => {
    const state = linkState(element, affected, recoveryCase);
    const commitment =
      element.elementKind === 'ENGAGEMENT' && element.data.anchorCommitmentId !== undefined;
    const label =
      element.elementKind === 'TRANSPORT_LEG'
        ? transportLabel(element as TransportLeg, context.places)
        : element.elementKind === 'STAY'
          ? (() => {
              const place = placeName(element.data.placeId, context.places);
              return place ? `Hotel · ${place}` : 'Hotel';
            })()
          : engagementLabel(element as Engagement, context.anchorEvent);
    return {
      id: element.id,
      kind: kindLabel(element, context.places),
      label,
      ...(linkDetail(element, state, context.places) ? { detail: linkDetail(element, state, context.places) } : {}),
      state,
      ...(commitment ? { commitment: true } : {}),
    };
  });
  return links;
}

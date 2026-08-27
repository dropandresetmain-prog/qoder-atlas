/**
 * Journey chain projection for case views (DESIGN.md §4.2).
 *
 * Builds the trip as a chain of dependent components (flight — transfer —
 * stay — ✦ commitment) from authoritative state: element reservation states,
 * health statuses, and case impact evidence. Unknown facts render UNKNOWN,
 * never a confident colour.
 */
import type { IsoDateTime } from '../domain/common.ts';
import type { AnchorEvent, Place } from '../domain/entities.ts';
import type { Engagement, Stay, TransportLeg, TripElement } from '../domain/elements.ts';
import type { Trip } from '../domain/trip.ts';
import type { RecoveryCase } from '../operational/case.ts';
import type { ChainLinkState, ChainLinkView } from '../ui/case-view-model.ts';
import {
  buildChainPresentationContext,
  presentationLinkState,
  recoveryCommitmentIdFor,
  type ChainPresentationContext,
} from './chainPresentation.ts';
import {
  countOtherCommitments,
  isStayElement,
  isTransportLeg,
  selectJourneyTransportAndStay,
  selectRecoveryCommitment,
} from './chainProjection.ts';

export type { ChainPresentationContext } from './chainPresentation.ts';
export { buildChainPresentationContext, presentationLinkState } from './chainPresentation.ts';

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

function kindLabel(element: TripElement, places: ReadonlyMap<string, Place>): string {
  if (element.elementKind === 'STAY') return 'Stay';
  if (element.elementKind === 'ENGAGEMENT') return 'Commitment';
  const leg = element as TransportLeg;
  if (leg.data.mode === 'FLIGHT') return 'Flight';
  const origin = places.get(leg.data.originPlaceId);
  if (origin && (origin.kind === 'AIRPORT' || origin.kind === 'RAIL_STATION')) return 'Transfer';
  return TRANSPORT_WORD[leg.data.mode];
}

function looksLikeInternalPlaceId(value: string): boolean {
  return /^(place-hotel-|place-|pl_|hotel-id)/i.test(value) || /^[a-z]+-[a-z0-9-]{12,}$/i.test(value);
}

function placeName(placeId: string | undefined, places: ReadonlyMap<string, Place>): string | undefined {
  if (!placeId) return undefined;
  const place = places.get(placeId);
  const name = place?.name?.trim();
  if (name && !looksLikeInternalPlaceId(name)) return name;
  const external = place?.externalRefs[0]?.value?.trim();
  if (external && !looksLikeInternalPlaceId(external)) return external;
  // Never leak internal place/hotel identifiers into operator copy.
  return undefined;
}

function formatDayTime(iso: IsoDateTime | undefined): string | undefined {
  if (!iso) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!match) return undefined;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(match[3])} ${months[Number(match[2]) - 1] ?? match[2]} · ${match[4]}:${match[5]}`;
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
    Math.round((Date.parse(stay.data.checkOut.value) - Date.parse(stay.data.checkIn.value)) / 86_400_000),
  );
  const place = placeName(stay.data.placeId, places);
  const nightsText = `${nights} night${nights === 1 ? '' : 's'}`;
  return place ? `${place} · ${nightsText}` : nightsText;
}

function engagementLabel(engagement: Engagement, event: AnchorEvent | undefined): string {
  return event ? `${engagement.data.title} · ${event.name}` : engagement.data.title;
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

function linkTypeFor(element: TripElement): ChainLinkView['linkType'] {
  if (isTransportLeg(element)) return element.data.mode === 'FLIGHT' ? 'FLIGHT' : 'GROUND';
  if (isStayElement(element)) return 'STAY';
  return 'COMMITMENT';
}

/** Case-aware journey chain: travel → stay → one recovery-relevant commitment. */
export function projectCaseChain(
  trip: Trip,
  recoveryCase: RecoveryCase | undefined,
  context: {
    places: ReadonlyMap<string, Place>;
    anchorEvent?: AnchorEvent;
    presentation?: ChainPresentationContext;
  },
): ChainLinkView[] | undefined {
  if (trip.elements.length === 0) return undefined;
  const presentation =
    context.presentation ??
    buildChainPresentationContext({
      recoveryCase,
      recoveryCommitmentId: recoveryCommitmentIdFor(trip, recoveryCase),
    });
  const links: ChainLinkView[] = [];

  for (const element of selectJourneyTransportAndStay(trip)) {
    const state = presentationLinkState(element, presentation);
    const label =
      isTransportLeg(element)
        ? transportLabel(element, context.places)
        : isStayElement(element)
          ? (() => {
              const place = placeName(element.data.placeId, context.places);
              return place ? `Hotel · ${place}` : 'Hotel';
            })()
          : engagementLabel(element as Engagement, context.anchorEvent);
    const detail = linkDetail(element, state, context.places);
    links.push({
      id: element.id,
      kind: kindLabel(element, context.places),
      label,
      ...(detail ? { detail } : {}),
      state,
      linkType: linkTypeFor(element),
    });
  }

  const commitment = selectRecoveryCommitment(trip, recoveryCase);
  if (commitment) {
    const state = presentationLinkState(commitment, presentation);
    const others = countOtherCommitments(trip, commitment);
    const detail = linkDetail(commitment, state, context.places);
    const extra =
      others > 0 ? ` · +${others} other programme commitment${others === 1 ? '' : 's'}` : '';
    links.push({
      id: commitment.id,
      kind: 'Commitment',
      label: engagementLabel(commitment, context.anchorEvent),
      ...(detail ? { detail: `${detail}${extra}` } : others > 0 ? { detail: `+${others} other programme commitments` } : {}),
      state,
      commitment: true,
      linkType: 'COMMITMENT',
    });
  }

  return links.length > 0 ? links : undefined;
}

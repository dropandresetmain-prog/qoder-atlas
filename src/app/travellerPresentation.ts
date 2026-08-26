/**
 * Projects the optional concierge presentation from authoritative state.
 * Missing evidence stays absent; the renderer falls back to the frozen
 * TravellerTripView rather than inventing UI facts.
 */
import type { EntityStore } from '../persistence/entityStore.ts';
import type { IsoDateTime } from '../domain/common.ts';
import type {
  AnchorCommitment,
  AnchorEvent,
  Organisation,
  Place,
  Traveller,
} from '../domain/entities.ts';
import type { Engagement, TransportLeg } from '../domain/elements.ts';
import type { Trip } from '../domain/trip.ts';
import type { RecoveryCase } from '../operational/case.ts';
import { describeAllocation } from '../engine/funding.ts';
import type { TravellerOptionDetail, TravellerPresentation } from '../ui/traveller-presentation.ts';

export interface PresentationDeps {
  entities: EntityStore;
  /** Persisted deterministic planning verdicts, keyed by strategy id. */
  verdictFor: (strategyId: string) => { feasible: boolean } | undefined;
  bestStrategyId?: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortInstant(iso: IsoDateTime): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!match) return undefined;
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1] ?? match[2]} · ${match[4]}:${match[5]}`;
}

function clock(iso: IsoDateTime): string | undefined {
  return /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso)?.slice(4).join(':');
}

function placeLabel(place: Place | undefined): string | undefined {
  if (!place) return undefined;
  return place.externalRefs.find((ref) => ref.system === 'airport-code')?.value ?? place.name;
}

async function entityOf<T extends { id: string }>(
  entities: EntityStore,
  type: Parameters<EntityStore['get']>[0],
  id: string | undefined,
): Promise<T | undefined> {
  if (!id) return undefined;
  const entry = await entities.get(type, id);
  return entry ? (entry as unknown as { entity: T }).entity : undefined;
}

function primaryEngagement(trip: Trip): Engagement | undefined {
  const engagements = trip.elements.filter(
    (element): element is Engagement => element.elementKind === 'ENGAGEMENT',
  );
  const anchored = engagements.filter((engagement) => engagement.data.anchorCommitmentId !== undefined);
  const candidates = anchored.length > 0 ? anchored : engagements;
  return [...candidates].sort((a, b) => a.data.startsAt.value.localeCompare(b.data.startsAt.value))[0];
}

function proposedRoute(
  strategy: RecoveryCase['strategies'][number] | undefined,
  places: Map<string, Place>,
): TravellerOptionDetail['route'] | undefined {
  if (!strategy) return undefined;
  const upsert = strategy.candidateOperations.find(
    (operation) =>
      operation.op === 'UPSERT_ENTITY' &&
      operation.entityType === 'TRIP_ELEMENT' &&
      (operation.data as { elementKind?: string }).elementKind === 'TRANSPORT_LEG',
  );
  if (!upsert || upsert.op !== 'UPSERT_ENTITY') return undefined;
  const leg = upsert.data as TransportLeg;
  const departure = leg.data.scheduledDeparture?.value;
  const arrival = leg.data.scheduledArrival?.value;
  const origin = placeLabel(places.get(leg.data.originPlaceId));
  const destination = placeLabel(places.get(leg.data.destinationPlaceId));
  if (!origin || !destination || !departure || !arrival) return undefined;
  return {
    from: `${origin} ${clock(departure)}`,
    to: `${destination} ${clock(arrival)}`,
    stops: leg.data.mode === 'FLIGHT' ? 'Replacement offer' : 'Replacement',
  };
}

function projectOptionDetails(
  recoveryCase: RecoveryCase | undefined,
  deps: PresentationDeps,
  places: Map<string, Place>,
  criticalObjectiveAtRisk: string | undefined,
): Record<string, TravellerOptionDetail> | undefined {
  if (!recoveryCase) return undefined;
  const pending = recoveryCase.authorityDecisions.find(
    (decision) => decision.outcome === 'REQUIRES_TRAVELLER' && decision.approval === undefined,
  );
  if (!pending) return undefined;
  const intent = recoveryCase.actionIntents.find((candidate) => candidate.id === pending.intentId);
  const strategy = intent
    ? recoveryCase.strategies.find((candidate) => candidate.id === intent.strategyId)
    : undefined;
  const verdict = strategy ? deps.verdictFor(strategy.id) : undefined;
  const route = proposedRoute(strategy, places);
  const funding = intent?.costAllocation
    ? `Funding: ${describeAllocation(intent.costAllocation)}.`
    : '';
  const approve: TravellerOptionDetail = {
    commitmentEffect: verdict?.feasible ? 'keeps' : 'unknown',
    ...(route ? { route } : {}),
    ...(intent?.priceDelta || funding
      ? {
          note: [
            intent?.priceDelta ? `Extra cost ${intent.priceDelta.amount} ${intent.priceDelta.currency}.` : '',
            funding,
          ].filter(Boolean).join(' '),
        }
      : {}),
    ...(strategy && deps.bestStrategyId === strategy.id ? { flag: 'Recommended' } : {}),
  };
  const decline: TravellerOptionDetail = {
    commitmentEffect: criticalObjectiveAtRisk ? 'breaks' : 'unknown',
    note: criticalObjectiveAtRisk
      ? `Leaves "${criticalObjectiveAtRisk}" at risk — nothing changes.`
      : 'Nothing changes; the disruption stays as it is.',
  };
  // These keys deliberately match projectTravellerTrip's persisted input options.
  return { Approve: approve, Decline: decline };
}

export async function projectTravellerPresentation(
  deps: PresentationDeps,
  trip: Trip,
  recoveryCase: RecoveryCase | undefined,
  criticalObjectiveAtRisk: string | undefined,
): Promise<TravellerPresentation | undefined> {
  const engagement = primaryEngagement(trip);
  const places = new Map<string, Place>();
  for (const entry of await deps.entities.list('PLACE')) {
    if (entry.entityType === 'PLACE') places.set(entry.entity.id, entry.entity);
  }

  const event = trip.anchorEventId
    ? await entityOf<AnchorEvent>(deps.entities, 'ANCHOR_EVENT', trip.anchorEventId)
    : engagement
      ? await entityOf<AnchorEvent>(deps.entities, 'ANCHOR_EVENT', engagement.data.anchorEventId)
      : undefined;

  let commitmentCard: TravellerPresentation['commitmentCard'];
  if (engagement) {
    const commitment: AnchorCommitment | undefined = engagement.data.anchorCommitmentId
      ? event?.commitments.find((candidate) => candidate.id === engagement.data.anchorCommitmentId)
      : undefined;
    const place = await entityOf<Place>(deps.entities, 'PLACE', engagement.data.placeId ?? event?.placeId);
    const meta = [shortInstant(engagement.data.startsAt.value), placeLabel(place)].filter(Boolean).join(' · ');
    commitmentCard = {
      label: 'The reason for the trip',
      title: commitment?.title ?? engagement.data.title,
      ...(meta ? { meta } : {}),
    };
  }

  const traveller = await entityOf<Traveller>(deps.entities, 'TRAVELLER', trip.travellerIds[0]);
  let contactName: string | undefined;
  if (event?.organiserOrganisationId) {
    const organisation = await entityOf<Organisation>(
      deps.entities,
      'ORGANISATION',
      event.organiserOrganisationId,
    );
    if (organisation) contactName = `the ${organisation.name} team`;
  }

  const optionDetails = projectOptionDetails(recoveryCase, deps, places, criticalObjectiveAtRisk);
  if (!event && !traveller && !commitmentCard && !contactName && !optionDetails) return undefined;
  return {
    ...(event ? { eventName: event.name } : {}),
    ...(traveller ? { travellerName: traveller.name } : {}),
    ...(commitmentCard ? { commitmentCard } : {}),
    ...(optionDetails ? { optionDetails } : {}),
    ...(contactName ? { contactName } : {}),
  };
}

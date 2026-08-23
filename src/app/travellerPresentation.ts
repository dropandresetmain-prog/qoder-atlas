/**
 * Wave 3 product convergence — traveller presentation projection.
 *
 * Kimi's concierge surface accepts an optional TravellerPresentation:
 * destination hero, the ink commitment card, per-option rich detail keyed by
 * the EXACT option string of TravellerInputRequest.options, and a contact
 * name. This module builds all of it from authoritative state only:
 *
 * - the commitment card comes from the trip's engagement + anchor commitment
 *   + event evidence (title, time, place) — never invented;
 * - optionDetails are keyed 'Approve'/'Decline' because those are the exact
 *   strings projectTravellerTrip emits in inputRequested.options;
 *   'Approve' carries the pending intent's deterministic viability verdict
 *   and the replacement schedule the strategy proposes; 'Decline' carries the
 *   honest consequence of leaving the disruption as it stands;
 * - the hero image is omitted (no per-destination photography evidence) —
 *   the renderer's ink gradient is the honest fallback;
 * - absence of any piece of evidence omits that piece; nothing is faked.
 */
import type { EntityStore } from '../persistence/entityStore.ts';
import type { IsoDateTime } from '../domain/common.ts';
import type { AnchorCommitment, AnchorEvent, Organisation, Place } from '../domain/entities.ts';
import type { Engagement, TransportLeg } from '../domain/elements.ts';
import type { Trip } from '../domain/trip.ts';
import type { RecoveryCase } from '../operational/case.ts';
import { describeAllocation } from '../engine/funding.ts';
import type { TravellerOptionDetail, TravellerPresentation } from '../ui/traveller-presentation.ts';

export interface PresentationDeps {
  entities: EntityStore;
  /** Persisted deterministic verdicts by strategy id (planning-time truth). */
  verdictFor: (strategyId: string) => { feasible: boolean; rejectionReasons: string[] } | undefined;
  /** The strategy id the planner ranked first, when planning recorded one. */
  bestStrategyId?: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Compact schedule fragment, e.g. "6 Sep · 20:00". */
function shortInstant(iso: IsoDateTime): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!match) return undefined;
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1] ?? match[2]} · ${match[4]}:${match[5]}`;
}

/** Clock fragment, e.g. "20:00". */
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

/** The engagement this trip is built around: the commitment link. */
function primaryEngagement(trip: Trip): Engagement | undefined {
  const engagements = trip.elements.filter(
    (element): element is Engagement => element.elementKind === 'ENGAGEMENT',
  );
  const anchored = engagements.filter((engagement) => engagement.data.anchorCommitmentId !== undefined);
  const candidates = anchored.length > 0 ? anchored : engagements;
  return [...candidates].sort((a, b) => a.data.startsAt.value.localeCompare(b.data.startsAt.value))[0];
}

/** Replacement leg schedule proposed by the pending strategy, when any. */
function proposedRoute(
  strategy: RecoveryCase['strategies'][number] | undefined,
  places: Map<string, Place>,
): { from: string; to: string; stops: string } | undefined {
  if (!strategy) return undefined;
  const upsert = strategy.candidateOperations.find(
    (operation) =>
      operation.op === 'UPSERT_ENTITY' &&
      operation.entityType === 'TRIP_ELEMENT' &&
      (operation.data as { elementKind?: string }).elementKind === 'TRANSPORT_LEG',
  );
  if (!upsert || upsert.op !== 'UPSERT_ENTITY') return undefined;
  const data = upsert.data as TransportLeg;
  const departure = data.data.scheduledDeparture?.value;
  const arrival = data.data.scheduledArrival?.value;
  const origin = placeLabel(places.get(data.data.originPlaceId));
  const destination = placeLabel(places.get(data.data.destinationPlaceId));
  if (!origin || !destination || !departure || !arrival) return undefined;
  return {
    from: `${origin} ${clock(departure)}`,
    to: `${destination} ${clock(arrival)}`,
    stops: data.data.mode === 'FLIGHT' ? 'Replacement offer' : 'Replacement',
  };
}

function optionDetails(
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
  const approveEffect: TravellerOptionDetail['commitmentEffect'] = verdict
    ? verdict.feasible
      ? 'keeps'
      : 'unknown'
    : 'unknown';
  const funding = intent?.costAllocation
    ? `Funding: ${describeAllocation(intent.costAllocation)}.`
    : '';
  const approve: TravellerOptionDetail = {
    commitmentEffect: approveEffect,
    ...(proposedRoute(strategy, places) ? { route: proposedRoute(strategy, places) } : {}),
    ...(intent?.priceDelta || funding
      ? {
          note: [
            intent?.priceDelta
              ? `Extra cost ${intent.priceDelta.amount} ${intent.priceDelta.currency}.`
              : '',
            funding,
          ]
            .filter(Boolean)
            .join(' '),
        }
      : {}),
    ...(strategy && deps.bestStrategyId === strategy.id ? { flag: 'Recommended' } : {}),
  };

  const declineEffect: TravellerOptionDetail['commitmentEffect'] = criticalObjectiveAtRisk
    ? 'breaks'
    : 'unknown';
  const decline: TravellerOptionDetail = {
    commitmentEffect: declineEffect,
    ...(criticalObjectiveAtRisk
      ? { note: `Leaves "${criticalObjectiveAtRisk}" at risk — nothing changes.` }
      : { note: 'Nothing changes; the disruption stays as it is.' }),
  };
  return { Approve: approve, Decline: decline };
}

/**
 * Build the presentation for one trip from authoritative evidence. Every
 * field is optional downstream; an unknown fact stays absent.
 */
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

  let commitmentCard: TravellerPresentation['commitmentCard'];
  if (engagement) {
    const event = await entityOf<AnchorEvent>(deps.entities, 'ANCHOR_EVENT', engagement.data.anchorEventId ?? trip.anchorEventId);
    const commitment: AnchorCommitment | undefined = engagement.data.anchorCommitmentId
      ? event?.commitments.find((candidate) => candidate.id === engagement.data.anchorCommitmentId)
      : undefined;
    const place = await entityOf<Place>(deps.entities, 'PLACE', engagement.data.placeId ?? event?.placeId);
    const when = shortInstant(engagement.data.startsAt.value);
    const meta = [when, place ? placeLabel(place) ?? place.name : undefined].filter(Boolean).join(' · ');
    commitmentCard = {
      label: 'The reason for the trip',
      title: commitment ? commitment.title : engagement.data.title,
      ...(meta ? { meta } : {}),
    };
  }

  let contactName: string | undefined;
  const eventForContact = engagement
    ? await entityOf<AnchorEvent>(deps.entities, 'ANCHOR_EVENT', engagement.data.anchorEventId ?? trip.anchorEventId)
    : trip.anchorEventId
      ? await entityOf<AnchorEvent>(deps.entities, 'ANCHOR_EVENT', trip.anchorEventId)
      : undefined;
  if (eventForContact?.organiserOrganisationId) {
    const organisation = await entityOf<Organisation>(
      deps.entities,
      'ORGANISATION',
      eventForContact.organiserOrganisationId,
    );
    if (organisation) contactName = `the ${organisation.name} team`;
  }

  const details = optionDetails(recoveryCase, deps, places, criticalObjectiveAtRisk);

  if (!commitmentCard && !contactName && !details) return undefined;
  return {
    // Hero image omitted on purpose: there is no authoritative destination
    // photography; the theme's ink gradient is the honest fallback.
    ...(commitmentCard ? { commitmentCard } : {}),
    ...(details ? { optionDetails: details } : {}),
    ...(contactName ? { contactName } : {}),
  };
}

/**
 * Northstar RV-N1 — programme read model (frozen ProgrammeView contract).
 *
 * Pure projection over authoritative state: every trip of the AnchorEvent,
 * its status (reusing the same status derivation as the operator
 * dashboard), open cases and pending decisions, endangered commitments
 * derived from engagement/element evidence, and programme-level
 * uncertainties. No UI-local truth, no fixture data.
 */
import type { EntityId, IsoDateTime } from '../domain/common.ts';
import { compareInstants } from '../domain/common.ts';
import type { Trip } from '../domain/trip.ts';
import type { Engagement } from '../domain/elements.ts';
import type { CaseStatus } from '../operational/case.ts';
import type {
  AnchorEvent,
} from '../domain/entities.ts';
import type {
  EndangeredCommitmentView,
  ProgrammeArrangementCounts,
  ProgrammeStatusSummary,
  ProgrammeTravellerView,
  ProgrammeView,
} from '../contracts/readmodels.ts';
import type {
  ProgrammeAugmentations,
  ProgrammeTimelineItemView,
} from '../ui/screens/operator-programme.ts';
import type { Place } from '../domain/entities.ts';
import { ImpactEngine } from '../engine/impact.ts';
import {
  formatProgrammeDayLabel,
  projectTravellerArrivalSummary,
  projectTravellerRoleLine,
} from './presentationProjection.ts';
import { latestCaseFor, statusForTrip, statusFromCase, isTravellerChangeRequest, type ReadModelDependencies } from './readmodels.ts';

/**
 * Programme-level status derivation. Extends the operator-dashboard rules
 * with initial-planning awareness: a trip whose viability is still UNKNOWN
 * and that has no booked transport/stay yet is PLANNING, not READY.
 */
async function programmeStatusFor(trip: Trip, latestCaseStatus?: CaseStatus, isChangeRequest?: boolean) {
  if (latestCaseStatus) {
    return statusFromCase(latestCaseStatus, isChangeRequest);
  }
  if (trip.viability === 'UNKNOWN' && !trip.elements.some((element) => element.elementKind !== 'ENGAGEMENT')) {
    return 'PLANNING' as const;
  }
  return statusForTrip(trip, undefined);
}

export async function projectProgrammeView(
  deps: ReadModelDependencies,
  anchorEventId: EntityId,
  generatedAt: IsoDateTime,
): Promise<ProgrammeView | undefined> {
  const anchorEntry = await deps.snapshot.entities.get('ANCHOR_EVENT', anchorEventId);
  if (!anchorEntry || anchorEntry.entityType !== 'ANCHOR_EVENT') return undefined;
  const anchorEvent: AnchorEvent = anchorEntry.entity;

  const summary: ProgrammeStatusSummary = {
    total: 0,
    ready: 0,
    planning: 0,
    needsTravellerInfo: 0,
    changeRequested: 0,
    atRisk: 0,
    disrupted: 0,
    recovering: 0,
    awaitingDecision: 0,
    resolved: 0,
    unknown: 0,
  };

  const travellers: ProgrammeTravellerView[] = [];
  const unresolvedUncertainties: string[] = [];
  const impactedTripIds: EntityId[] = [];
  const arrangementCounts: ProgrammeArrangementCounts = {
    total: 0,
    northstarArranged: 0,
    selfOrOtherArranged: 0,
    unspecified: 0,
  };

  for (const item of await deps.snapshot.trips.listTrips()) {
    const trip = await deps.snapshot.trips.getTrip(item.tripId);
    if (!trip || trip.anchorEventId !== anchorEventId) continue;
    summary.total += 1;

    const recoveryCase = await latestCaseFor(deps.cases, trip.id);
    const isChangeRequest = recoveryCase ? await isTravellerChangeRequest(deps.signals, recoveryCase) : false;
    const status = await programmeStatusFor(trip, recoveryCase?.status, isChangeRequest);
    if (status === 'READY') summary.ready += 1;
    else if (status === 'PLANNING') summary.planning += 1;
    else if (status === 'NEEDS_TRAVELLER_INFO') summary.needsTravellerInfo += 1;
    else if (status === 'CHANGE_REQUESTED') summary.changeRequested += 1;
    else if (status === 'AT_RISK') summary.atRisk += 1;
    else if (status === 'DISRUPTED') summary.disrupted += 1;
    else if (status === 'RECOVERING') summary.recovering += 1;
    else if (status === 'RESOLVED') summary.resolved += 1;
    else summary.unknown += 1;

    let decisionsRequired = 0;
    if (recoveryCase) {
      decisionsRequired = recoveryCase.authorityDecisions.filter(
        (decision) =>
          (decision.outcome === 'REQUIRES_TRAVELLER' ||
            decision.outcome === 'REQUIRES_ORGANISATION_APPROVER' ||
            decision.outcome === 'REQUIRES_HUMAN_AGENT') &&
          decision.approval === undefined,
      ).length;
      if (decisionsRequired > 0) summary.awaitingDecision += 1;
    }

    const travellerId = trip.travellerIds[0] ?? 'unknown';
    let travellerName = travellerId;
    const travellerEntry = await deps.snapshot.entities.get('TRAVELLER', travellerId);
    if (travellerEntry?.entityType === 'TRAVELLER') {
      travellerName = travellerEntry.entity.name;
      // G3R-Closure fix B: organiser counts derive ONLY from the explicit
      // intake declaration persisted on the traveller. Absent declaration is
      // counted as unspecified — never guessed from home location.
      arrangementCounts.total += 1;
      switch (travellerEntry.entity.travelArrangement) {
        case 'NORTHSTAR_ARRANGED':
          arrangementCounts.northstarArranged += 1;
          break;
        case 'SELF_OR_OTHER_ARRANGED':
          arrangementCounts.selfOrOtherArranged += 1;
          break;
        default:
          arrangementCounts.unspecified += 1;
          break;
      }
    } else {
      arrangementCounts.total += 1;
      arrangementCounts.unspecified += 1;
    }

    const assessment = await new ImpactEngine({
      trips: deps.snapshot.trips,
      signals: deps.signals,
      entities: deps.snapshot.entities,
    }).assess(trip.id);
    for (const unknown of assessment.unresolvedUnknowns) {
      unresolvedUncertainties.push(`${travellerName}: ${unknown}`);
    }
    if (assessment.directFailures.length > 0 || assessment.affectedElements.length > 0) {
      impactedTripIds.push(trip.id);
    }

    travellers.push({
      tripId: trip.id,
      travellerId,
      travellerName,
      status,
      activeCaseIds: recoveryCase && recoveryCase.status !== 'RESOLVED' ? [recoveryCase.id] : [],
      decisionsRequired,
      uncertainties: assessment.unresolvedUnknowns,
      updatedAt: recoveryCase ? recoveryCase.updatedAt : trip.updatedAt,
    });
  }

  travellers.sort((a, b) => a.travellerName.localeCompare(b.travellerName) || a.tripId.localeCompare(b.tripId));

  return {
    generatedAt,
    anchorEventId,
    anchorEventName: anchorEvent.name,
    summary,
    arrangementCounts,
    travellers,
    endangeredCommitments: await endangeredCommitments(deps, anchorEvent, impactedTripIds),
    unresolvedUncertainties,
  };
}

/**
 * A commitment is endangered when deterministic evidence shows an
 * engagement of it failing or at risk on authoritative state — never from
 * prose or heuristics.
 */
async function endangeredCommitments(
  deps: ReadModelDependencies,
  anchorEvent: AnchorEvent,
  impactedTripIds: EntityId[],
): Promise<EndangeredCommitmentView[]> {
  if (impactedTripIds.length === 0) return [];
  const views: EndangeredCommitmentView[] = [];

  for (const commitment of anchorEvent.commitments) {
    const affectedTravellerIds: EntityId[] = [];
    let reason: string | undefined;

    for (const tripId of impactedTripIds) {
      const trip = await deps.snapshot.trips.getTrip(tripId);
      if (!trip) continue;
      const engagements = trip.elements.filter(
        (element): element is Engagement =>
          element.elementKind === 'ENGAGEMENT' && element.data.anchorCommitmentId === commitment.id,
      );
      for (const engagement of engagements) {
        if (engagement.status === 'INVALID') {
          reason = reason ?? `an engagement of “${commitment.title}” is no longer viable`;
        } else if (engagement.status === 'AT_RISK' && !reason) {
          reason = `an engagement of “${commitment.title}” is at risk`;
        }
        if (engagement.status === 'INVALID' || engagement.status === 'AT_RISK') {
          const travellerId = trip.travellerIds[0];
          if (travellerId && !affectedTravellerIds.includes(travellerId)) {
            affectedTravellerIds.push(travellerId);
          }
        }
      }
    }

    if (reason && affectedTravellerIds.length > 0) {
      views.push({
        commitmentId: commitment.id,
        title: commitment.title,
        reason,
        affectedTravellerIds: affectedTravellerIds.sort(),
      });
    }
  }

  // Deterministic secondary evidence: a commitment starting before now
  // while a linked trip is still DISRUPTED. Kept conservative: only when the
  // primary engagement-health evidence found nothing.
  return views;
}

/** Ordering helper for UI: commitments with the most affected travellers first. */
export function compareEndangered(a: EndangeredCommitmentView, b: EndangeredCommitmentView): number {
  const diff = b.affectedTravellerIds.length - a.affectedTravellerIds.length;
  return diff !== 0 ? diff : a.commitmentId.localeCompare(b.commitmentId);
}

/** Chronological commitment ordering for schedule surfaces. */
export function compareCommitmentTimes(a: { startsAt: { value: IsoDateTime } }, b: { startsAt: { value: IsoDateTime } }): number {
  return compareInstants(a.startsAt.value, b.startsAt.value);
}

/**
 * Optional presentation for the approved programme screen, projected from
 * persisted AnchorEvent commitments and the same programme view the page
 * already serves. It adds no programme state and does not infer changes.
 */
export async function projectProgrammeAugmentations(
  deps: ReadModelDependencies,
  view: ProgrammeView,
): Promise<ProgrammeAugmentations> {
  const anchorEntry = await deps.snapshot.entities.get('ANCHOR_EVENT', view.anchorEventId);
  if (!anchorEntry || anchorEntry.entityType !== 'ANCHOR_EVENT') return {};

  const places = new Map<string, Place>();
  for (const entry of await deps.snapshot.entities.list('PLACE')) {
    if (entry.entityType === 'PLACE') places.set(entry.entity.id, entry.entity);
  }

  const endangeredIds = new Set(view.endangeredCommitments.map((commitment) => commitment.commitmentId));
  const grouped = new Map<string, ProgrammeTimelineItemView[]>();
  for (const commitment of [...anchorEntry.entity.commitments].sort(compareCommitmentTimes)) {
    const instant = commitment.startsAt.value;
    const dayKey = instant.slice(0, 10);
    const venue = commitment.placeId ? places.get(commitment.placeId)?.name : undefined;
    const items = grouped.get(dayKey) ?? [];
    items.push({
      key: commitment.id,
      timeLabel: instant.slice(11, 16),
      title: commitment.title,
      ...(venue ? { tag: venue } : {}),
      tone: endangeredIds.has(commitment.id) ? 'endangered' : 'ok',
    });
    grouped.set(dayKey, items);
  }

  const activeCaseByTraveller = new Map(
    view.travellers
      .filter((traveller) => traveller.activeCaseIds[0] !== undefined)
      .map((traveller) => [traveller.travellerId, traveller.activeCaseIds[0]!]),
  );

  const roleByTrip = new Map<string, string | undefined>();
  const arrivalByTrip = new Map<string, string | undefined>();
  for (const traveller of view.travellers) {
    roleByTrip.set(traveller.tripId, await projectTravellerRoleLine(deps, traveller.tripId, traveller.travellerId));
    arrivalByTrip.set(
      traveller.tripId,
      await projectTravellerArrivalSummary(deps, traveller.tripId, traveller.travellerId),
    );
  }

  return {
    timeline: [...grouped.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dayKey, items]) => ({
        dateLabel: formatProgrammeDayLabel(`${dayKey}T12:00:00+00:00`),
        items,
      })),
    roleFor: (traveller) => roleByTrip.get(traveller.tripId),
    arrivalFor: (traveller) => arrivalByTrip.get(traveller.tripId),
    commitmentHrefFor: (commitment) => {
      const affectedTravellerId = commitment.affectedTravellerIds.find((id) => activeCaseByTraveller.has(id));
      const caseId = affectedTravellerId ? activeCaseByTraveller.get(affectedTravellerId) : undefined;
      return caseId ? { href: `/operator/cases/${encodeURIComponent(caseId)}`, label: 'Open recovery case →' } : undefined;
    },
  };
}

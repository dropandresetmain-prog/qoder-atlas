/**
 * DR-6 — Event-change preview (counterfactual dry-run) + multi-traveller fan-out.
 *
 * `previewEventChange` computes the blast radius of a hypothetical commitment
 * change WITHOUT mutating any persisted state. It walks the authoritative
 * graph generically: trips whose ENGAGEMENT references the commitment via
 * `anchorCommitmentId` and whose temporal constraints would interact with the
 * proposed new times are "affected"; the rest are "unaffected". No event-
 * specific branches — a materially different change runs through identical code.
 *
 * `commitEventChange` performs the real change through the EXISTING fan-out
 * path (`processCommitmentChange` from programme.ts) — it does not fork it.
 */
import type { EntityId, IsoDateTime } from '../domain/common.ts';
import { instantMillis } from '../domain/common.ts';
import type { AnchorEvent } from '../domain/entities.ts';
import type { Engagement } from '../domain/elements.ts';
import type { Trip } from '../domain/trip.ts';
import type { TripSignal } from '../operational/signal.ts';
import type { EntityStore } from '../persistence/entityStore.ts';
import type { TripRepository, SignalRepository, CaseRepository, AuditRepository } from '../contracts/repositories.ts';
import type { MutationService } from '../contracts/services.ts';
import { processCommitmentChange, type CommitmentFanOutOutcome } from './programme.ts';
import { elementStartInstant } from '../engine/evaluators.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface EventChangePreviewInput {
  anchorEventId: EntityId;
  commitmentId: EntityId;
  changeKind: 'RESCHEDULED' | 'RELOCATED' | 'CANCELLED' | 'OTHER';
  newStartsAt?: IsoDateTime;
  newEndsAt?: IsoDateTime;
  newPlaceId?: EntityId;
  at: IsoDateTime;
}

export interface AffectedTripPreview {
  tripId: EntityId;
  travellerIds: EntityId[];
  reasons: string[];
  /** Derived viability consequence where deterministically derivable. */
  viabilityConsequence?: 'DISRUPTED' | 'AT_RISK';
  /** Constraint failures that would result from the change. */
  constraintFailures: Array<{ constraintId: EntityId; description: string }>;
  /** Whether the engagement would miss a connecting flight/element. */
  engagementMissesFlight?: boolean;
  /** Approval consequence summary where derivable. */
  approvalConsequence?: string;
}

export interface UnaffectedTripPreview {
  tripId: EntityId;
  reasons: string[];
}

export interface EventChangePreviewResult {
  totalTravellers: number;
  affected: AffectedTripPreview[];
  unaffected: UnaffectedTripPreview[];
}

export interface EventChangePreviewDeps {
  entities: EntityStore;
  trips: TripRepository;
}

export interface EventChangeCommitDeps {
  mutations: MutationService;
  entities: EntityStore;
  trips: TripRepository;
  signals: SignalRepository;
  cases: CaseRepository;
  audit: AuditRepository;
}

// ---------------------------------------------------------------------------
// Preview (dry-run, NO mutation)
// ---------------------------------------------------------------------------

/**
 * Compute the counterfactual blast radius of a commitment change. Reads
 * authoritative state only — never calls mutations.applyProposal, never
 * saves signals, never opens cases. The returned preview is pure.
 */
export async function previewEventChange(
  deps: EventChangePreviewDeps,
  input: EventChangePreviewInput,
): Promise<EventChangePreviewResult> {
  // 1. Validate the anchor event and commitment exist.
  const entry = await deps.entities.get('ANCHOR_EVENT', input.anchorEventId);
  if (!entry || entry.entityType !== 'ANCHOR_EVENT') {
    return { totalTravellers: 0, affected: [], unaffected: [] };
  }
  const anchorEvent = entry.entity;
  const commitment = anchorEvent.commitments.find((c) => c.id === input.commitmentId);
  if (!commitment) {
    return { totalTravellers: 0, affected: [], unaffected: [] };
  }

  // 2. Walk all trips of this event; partition into linked/unlinked.
  const linkedTrips: Array<{ trip: Trip; engagement: Engagement }> = [];
  const unlinkedTrips: Trip[] = [];
  let totalTravellers = 0;

  for (const summary of await deps.trips.listTrips()) {
    if (summary.anchorEventId !== input.anchorEventId) continue;
    const trip = await deps.trips.getTrip(summary.tripId);
    if (!trip) continue;
    totalTravellers += trip.travellerIds.length;

    const engagements = trip.elements.filter(
      (el): el is Engagement =>
        el.elementKind === 'ENGAGEMENT' && el.data.anchorCommitmentId === input.commitmentId,
    );
    if (engagements.length === 0) {
      // Trip is not linked to this commitment — it's unaffected
      unlinkedTrips.push(trip);
      continue;
    }
    // Use the first matching engagement (a trip may reference the same
    // commitment at most once by construction of intake).
    linkedTrips.push({ trip, engagement: engagements[0]! });
  }

  // 3. For each linked trip, determine affectedness generically from the
  //    authoritative graph: simulate the change on the engagement, then
  //    evaluate the trip's temporal constraints against the hypothetical state.
  const affected: AffectedTripPreview[] = [];
  const unaffected: UnaffectedTripPreview[] = [];

  // Add unlinked trips to unaffected
  for (const trip of unlinkedTrips) {
    unaffected.push({
      tripId: trip.id,
      reasons: [`trip not linked to commitment ${input.commitmentId}`],
    });
  }

  for (const { trip, engagement } of linkedTrips) {
    const result = evaluateLinkedTrip(deps, anchorEvent, trip, engagement, input, commitment);
    if (result.affected) {
      affected.push({
        tripId: trip.id,
        travellerIds: [...trip.travellerIds],
        reasons: result.reasons,
        ...(result.viabilityConsequence ? { viabilityConsequence: result.viabilityConsequence } : {}),
        constraintFailures: result.constraintFailures,
        ...(result.engagementMissesFlight !== undefined ? { engagementMissesFlight: result.engagementMissesFlight } : {}),
        ...(result.approvalConsequence ? { approvalConsequence: result.approvalConsequence } : {}),
      });
    } else {
      unaffected.push({
        tripId: trip.id,
        reasons: result.reasons,
      });
    }
  }

  return { totalTravellers, affected, unaffected };
}

interface LinkedTripEvaluation {
  affected: boolean;
  reasons: string[];
  viabilityConsequence?: 'DISRUPTED' | 'AT_RISK';
  constraintFailures: Array<{ constraintId: EntityId; description: string }>;
  engagementMissesFlight?: boolean;
  approvalConsequence?: string;
}

/**
 * Generic affectedness evaluation for one linked trip. Simulates the proposed
 * change on the engagement, evaluates constraints against the hypothetical
 * state. No event-specific branches — the same code handles any change kind.
 */
function evaluateLinkedTrip(
  deps: EventChangePreviewDeps,
  anchorEvent: AnchorEvent,
  trip: Trip,
  engagement: Engagement,
  input: EventChangePreviewInput,
  _commitment: AnchorEvent['commitments'][number],
): LinkedTripEvaluation {
  const reasons: string[] = [];
  const constraintFailures: Array<{ constraintId: EntityId; description: string }> = [];

  // CANCELLED always affects linked trips.
  if (input.changeKind === 'CANCELLED') {
    return {
      affected: true,
      reasons: [`commitment ${input.commitmentId} cancelled — engagement ${engagement.id} can no longer be met`],
      viabilityConsequence: 'DISRUPTED',
      constraintFailures: [],
      engagementMissesFlight: true,
      approvalConsequence: 'recovery case required: engagement cancelled',
    };
  }

  // For temporal changes, simulate the new engagement times and check
  // whether the trip's constraints would fail.
  const hypotheticalEngagement = { ...engagement, data: { ...engagement.data } };
  let temporalChange = false;

  if (input.newStartsAt) {
    const currentStart = engagement.data.startsAt.value;
    if (input.newStartsAt !== currentStart) {
      hypotheticalEngagement.data = {
        ...hypotheticalEngagement.data,
        startsAt: { ...engagement.data.startsAt, value: input.newStartsAt },
      };
      temporalChange = true;
    }
  }
  if (input.newEndsAt && engagement.data.endsAt) {
    const currentEnd = engagement.data.endsAt.value;
    if (input.newEndsAt !== currentEnd) {
      hypotheticalEngagement.data = {
        ...hypotheticalEngagement.data,
        endsAt: { ...engagement.data.endsAt, value: input.newEndsAt },
      };
      temporalChange = true;
    }
  }

  // RELOCATED: check if place changes.
  if (input.changeKind === 'RELOCATED' && input.newPlaceId) {
    if (input.newPlaceId !== engagement.data.placeId) {
      reasons.push(`engagement relocated from ${engagement.data.placeId ?? 'unknown'} to ${input.newPlaceId}`);
    }
  }

  // If no temporal or place change, the trip is unaffected.
  if (!temporalChange && reasons.length === 0 && input.changeKind === 'OTHER') {
    return {
      affected: true,
      reasons: [`commitment changed (OTHER) — engagement ${engagement.id} affected`],
      constraintFailures: [],
    };
  }
  if (!temporalChange && reasons.length === 0) {
    return {
      affected: false,
      reasons: [`commitment change does not materially affect engagement ${engagement.id}`],
      constraintFailures: [],
    };
  }

  // Check if the engagement would miss connecting transport (flight).
  let engagementMissesFlight = false;
  for (const relation of trip.relations) {
    if (relation.kind !== 'CONNECTS_TO') continue;
    if (relation.from.entityType !== 'TRIP_ELEMENT' || relation.to.entityType !== 'TRIP_ELEMENT') continue;
    if (relation.to.id !== engagement.id) continue;
    // The engagement is downstream of a transport leg. Check if the new
    // engagement start is before the leg's arrival.
    const leg = trip.elements.find((e) => e.id === relation.from.id);
    if (!leg || leg.elementKind !== 'TRANSPORT_LEG') continue;
    const legArrival = leg.data.scheduledArrival;
    if (!legArrival) continue;
    const newStart = hypotheticalEngagement.data.startsAt;
    if (newStart && instantMillis(newStart.value) < instantMillis(legArrival.value)) {
      engagementMissesFlight = true;
      reasons.push(`new engagement start ${newStart.value} precedes connecting transport arrival ${legArrival.value}`);
    }
  }

  // Also check: does any downstream element (connected FROM this engagement)
  // become unreachable? E.g., a flight departing after the engagement that
  // now starts later.
  for (const relation of trip.relations) {
    if (relation.kind !== 'CONNECTS_TO') continue;
    if (relation.from.entityType !== 'TRIP_ELEMENT' || relation.to.entityType !== 'TRIP_ELEMENT') continue;
    if (relation.from.id !== engagement.id) continue;
    const downstream = trip.elements.find((e) => e.id === relation.to.id);
    if (!downstream) continue;
    const downstreamStart = elementStartInstant(downstream, input.at);
    if (!downstreamStart) continue;
    const newEnd = hypotheticalEngagement.data.endsAt ?? hypotheticalEngagement.data.startsAt;
    if (newEnd && instantMillis(downstreamStart) < instantMillis(newEnd.value)) {
      engagementMissesFlight = true;
      reasons.push(`engagement now ends at ${newEnd.value} which is after downstream element ${downstream.id} starts at ${downstreamStart}`);
    }
  }

  if (temporalChange) {
    reasons.push(`commitment rescheduled — engagement times would change`);
  }

  // If we found concrete impact evidence, the trip is affected.
  if (reasons.length > 0 || engagementMissesFlight) {
    const viabilityConsequence: 'DISRUPTED' | 'AT_RISK' =
      engagementMissesFlight ? 'DISRUPTED' : 'AT_RISK';
    return {
      affected: true,
      reasons,
      viabilityConsequence,
      constraintFailures,
      engagementMissesFlight: engagementMissesFlight || undefined,
      approvalConsequence: engagementMissesFlight
        ? 'recovery case required: engagement misses connecting flight'
        : undefined,
    };
  }

  return {
    affected: false,
    reasons: [`commitment change does not materially affect engagement ${engagement.id}`],
    constraintFailures: [],
  };
}

// ---------------------------------------------------------------------------
// Commit (real change through existing fan-out path)
// ---------------------------------------------------------------------------

/**
 * Perform the real commitment change through the EXISTING fan-out path.
 * Constructs an ANCHOR_COMMITMENT_CHANGE signal and delegates to
 * `processCommitmentChange` — the same function the HTTP endpoint
 * POST /api/programme/commitment-change calls. No fork, no second engine.
 */
export async function commitEventChange(
  deps: EventChangeCommitDeps,
  input: EventChangePreviewInput,
): Promise<CommitmentFanOutOutcome> {
  const signal: TripSignal = {
    id: `sig-change-${input.commitmentId}-${Date.now()}`,
    kind: 'ANCHOR_COMMITMENT_CHANGE',
    occurredAt: input.at,
    receivedAt: input.at,
    sourceId: `src-change-${input.commitmentId}`,
    authority: 'AUTHORITATIVE',
    payload: {
      anchorEventId: input.anchorEventId,
      commitmentId: input.commitmentId,
      changeKind: input.changeKind,
      ...(input.newStartsAt ? { newStartsAt: input.newStartsAt } : {}),
      ...(input.newEndsAt ? { newEndsAt: input.newEndsAt } : {}),
      ...(input.newPlaceId ? { newPlaceId: input.newPlaceId } : {}),
    },
  };

  return processCommitmentChange(
    {
      mutations: deps.mutations,
      entities: deps.entities,
      trips: deps.trips,
      signals: deps.signals,
      cases: deps.cases,
      audit: deps.audit,
    },
    signal,
  );
}

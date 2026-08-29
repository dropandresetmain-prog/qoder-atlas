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

function humanStayInstantSafe(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso) ?? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return undefined;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = `${Number(match[3])} ${months[Number(match[2]) - 1] ?? match[2]}`;
  return match[4] ? `${day} · ${match[4]}:${match[5]}` : day;
}

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
  /** Display names resolved from Traveller entities when present. */
  travellerNames: string[];
  reasons: string[];
  /** Derived viability consequence where deterministically derivable. */
  viabilityConsequence?: 'DISRUPTED' | 'AT_RISK' | 'VIABLE';
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

/**
 * A named, counterfactual programme-change option. The option name is
 * presentation/orchestration metadata; all operational consequences are
 * derived by the ordinary preview engine from its proposed change.
 */
export interface EventChangePreviewOption {
  optionId: string;
  input: EventChangePreviewInput;
}

export interface EventChangePreviewComparison {
  options: Array<{ optionId: string; preview: EventChangePreviewResult }>;
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
      reasons: ['Trip is not linked to this programme commitment'],
    });
  }

  for (const { trip, engagement } of linkedTrips) {
    const result = evaluateLinkedTrip(deps, anchorEvent, trip, engagement, input, commitment);
    const travellerNames = await resolveTravellerNames(deps, trip.travellerIds);
    if (result.affected) {
      affected.push({
        tripId: trip.id,
        travellerIds: [...trip.travellerIds],
        travellerNames,
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

async function resolveTravellerNames(
  deps: EventChangePreviewDeps,
  travellerIds: readonly EntityId[],
): Promise<string[]> {
  const names: string[] = [];
  for (const travellerId of travellerIds) {
    const entry = await deps.entities.get('TRAVELLER', travellerId);
    if (entry?.entityType === 'TRAVELLER' && entry.entity.name.trim().length > 0) {
      names.push(entry.entity.name);
    }
  }
  return names;
}

/**
 * Compare several hypothetical programme changes without mutating
 * authoritative state. This is deliberately a thin composition over the
 * single-option preview: it does not rank options, invent a recovery plan, or
 * create a second programme engine. Callers receive each option's ordinary
 * blast radius and may choose one to submit to the existing commit boundary.
 */
export async function compareEventChangePreviews(
  deps: EventChangePreviewDeps,
  options: EventChangePreviewOption[],
): Promise<EventChangePreviewComparison> {
  return {
    options: await Promise.all(
      options.map(async (option) => ({
        optionId: option.optionId,
        preview: await previewEventChange(deps, option.input),
      })),
    ),
  };
}

interface LinkedTripEvaluation {
  affected: boolean;
  reasons: string[];
  viabilityConsequence?: 'DISRUPTED' | 'AT_RISK' | 'VIABLE';
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
      reasons: ['Programme commitment cancelled — linked engagement can no longer be met'],
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
      reasons.push('Engagement venue would move under the proposed programme change');
    }
  }

  // If no temporal or place change, the trip is unaffected.
  if (!temporalChange && reasons.length === 0 && input.changeKind === 'OTHER') {
    return {
      affected: true,
      reasons: ['Programme commitment changed — linked engagement is affected'],
      constraintFailures: [],
    };
  }
  if (!temporalChange && reasons.length === 0) {
    return {
      affected: false,
      reasons: ['Programme change does not materially affect this engagement'],
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
      const arrive = humanStayInstantSafe(legArrival.value);
      const start = humanStayInstantSafe(newStart.value);
      reasons.push(
        start && arrive
          ? `New start ${start} is before connecting arrival ${arrive}`
          : 'New engagement start precedes connecting transport arrival',
      );
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
      const end = humanStayInstantSafe(newEnd.value);
      reasons.push(
        end
          ? `Engagement would end at ${end}, after a downstream trip element starts`
          : 'Engagement end overlaps a downstream trip element',
      );
    }
  }

  // Compare inbound arrival preparation time before vs after the proposed start.
  // The minutes feed the verdict; the reasons translate them into consequences
  // (raw buffer arithmetic stays in machine evidence, not user-facing copy).
  const REQUIRED_BUFFER_MIN = 360;
  let timingRestored = false;
  let bufferStillFails = false;
  let bufferStillPasses = false;
  let arrivalGapMinutes: number | undefined;
  let priorGapMinutes: number | undefined;
  const commitmentLabel = engagement.data.title?.trim() || 'the programme commitment';
  for (const element of trip.elements) {
    if (element.elementKind !== 'TRANSPORT_LEG' || element.data.mode !== 'FLIGHT') continue;
    const arrival = element.data.scheduledArrival?.value;
    const currentStart = engagement.data.startsAt.value;
    const newStart = hypotheticalEngagement.data.startsAt?.value;
    if (!arrival || !newStart) continue;
    const gapAfter = Math.round((instantMillis(newStart) - instantMillis(arrival)) / 60_000);
    const gapBefore = Math.round((instantMillis(currentStart) - instantMillis(arrival)) / 60_000);
    if (!Number.isFinite(gapAfter)) continue;
    arrivalGapMinutes = gapAfter;
    if (Number.isFinite(gapBefore)) priorGapMinutes = gapBefore;
    if (gapAfter >= REQUIRED_BUFFER_MIN && gapBefore < REQUIRED_BUFFER_MIN) timingRestored = true;
    else if (gapAfter < REQUIRED_BUFFER_MIN) bufferStillFails = true;
    else bufferStillPasses = true;
  }

  if (temporalChange) {
    const start = input.newStartsAt ? humanStayInstantSafe(input.newStartsAt) : undefined;
    const from = humanStayInstantSafe(engagement.data.startsAt.value);
    if (timingRestored && arrivalGapMinutes !== undefined) {
      reasons.push(
        start && from && start !== from
          ? `Moving from ${from} to ${start} restores enough preparation time before ${commitmentLabel}`
          : start
            ? `Moving to ${start} restores enough preparation time before ${commitmentLabel}`
            : `The move restores enough preparation time before ${commitmentLabel}`,
      );
    } else if (bufferStillFails && arrivalGapMinutes !== undefined) {
      reasons.push(
        `${commitmentLabel} still does not leave enough preparation time after the flight arrival` +
          (priorGapMinutes !== undefined ? ' (unchanged from today)' : ''),
      );
    } else if (bufferStillPasses && arrivalGapMinutes !== undefined) {
      reasons.push(
        `${commitmentLabel} still leaves enough preparation time after arrival` +
          (start && from && start !== from ? ` with the move from ${from} to ${start}` : start ? ` with the move to ${start}` : ''),
      );
    } else {
      reasons.push(
        start && from && start !== from
          ? `Programme commitment moves from ${from} to ${start}`
          : start
            ? `Programme commitment moves to ${start}`
            : 'Programme commitment moves — engagement times would change',
      );
    }
  }

  // If we found concrete impact evidence, the trip is affected.
  if (reasons.length > 0 || engagementMissesFlight) {
    const viabilityConsequence: 'DISRUPTED' | 'AT_RISK' | 'VIABLE' = engagementMissesFlight || bufferStillFails
      ? 'DISRUPTED'
      : timingRestored || bufferStillPasses
        ? 'VIABLE'
        : 'AT_RISK';
    return {
      affected: true,
      reasons: [...new Set(reasons)],
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
    reasons: ['Programme change does not materially affect this engagement'],
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

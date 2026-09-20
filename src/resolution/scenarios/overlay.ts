/**
 * NORTHSTAR M7 — isolated scenario overlay.
 *
 * Projects typed ScenarioChanges over a deep-cloned CapturedWorld. Canonical
 * PostgreSQL state is never touched. Owner semantics are preserved: intent
 * fields may be proposed; supplier observations, RuleSets, ConstraintDefinitions,
 * credentials and external facts cannot be rewritten by a candidate.
 *
 * Proposed objective disposition (I-7) updates only the overlay copy and
 * records an authority requirement for M8 — it does not append
 * objective_dispositions and does not relax unrelated mandatory constraints.
 */
import type { TypedRef } from '../../domain/v2/shared/identity.ts';
import { typedConflict, type TypedResult, ok, conflict } from '../../domain/v2/shared/errors.ts';
import { ExactMoneySchema, compareExactMoney, type ExactMoney } from '../../domain/v2/shared/money.ts';
import { InstantIntervalSchema, type Instant } from '../../domain/v2/shared/time.ts';
import type { ScenarioChange, ScenarioEffect } from '../../contracts/v2/scenario/scenarioChange.ts';
import { applyStayVisitOverlay } from './stayVisitOverlay.ts';
import type {
  CapturedWorld,
  WAllocation,
  WJourneyItem,
  WObjective,
  WProgrammeItem,
  WSupportAssignment,
} from '../world/world.ts';

export interface ResolvedOffer {
  offerId: string;
  /** Transport/service the offer selects. Must already exist in the captured world. */
  transportServiceId: string;
}

/**
 * A captured stay quote used only to build a candidate overlay. Unlike a
 * transport offer it does not pretend to be a TransportService, and it never
 * creates a Reservation/ReservationLine before external observation.
 */
export interface ResolvedStayOffer {
  offerId: string;
  placeId: string;
  stayWindow: { start: Instant; end: Instant };
  price: ExactMoney;
}

export interface OverlayApplyInput {
  baseWorld: CapturedWorld;
  scenarioChange: ScenarioChange;
  /** Known offers from search/capture — never fabricated inside the overlay. */
  resolvedOffers?: readonly ResolvedOffer[];
  /** Known stay offers from search/capture — separate from transport offers. */
  resolvedStayOffers?: readonly ResolvedStayOffer[];
}

export interface OverlayApplyResult {
  /** Candidate world — structurally separate from `baseWorld`. */
  proposedWorld: CapturedWorld;
  affectedSubjectRefs: TypedRef[];
  /** Authority scopes that M8 must satisfy before any durable disposition/action. */
  requiredAuthorityScopes: string[];
  appliedEffects: ScenarioEffect[];
}

function cloneWorld(world: CapturedWorld): CapturedWorld {
  return structuredClone(world);
}

function sameWorldRef(a: CapturedWorld, b: CapturedWorld): boolean {
  return a === b;
}

function refKey(ref: TypedRef): string {
  return `${ref.kind}:${ref.id}`;
}

function addAffected(set: Map<string, TypedRef>, ref: TypedRef): void {
  set.set(refKey(ref), ref);
}

function findJourneyItem(world: CapturedWorld, id: string): WJourneyItem | undefined {
  return world.journeyItems.find((i) => i.id === id);
}

function findProgrammeItem(world: CapturedWorld, id: string): WProgrammeItem | undefined {
  return world.programmeItems.find((i) => i.id === id);
}

function findObjective(world: CapturedWorld, id: string): WObjective | undefined {
  return world.objectives.find((o) => o.id === id);
}

function findSupportAssignment(world: CapturedWorld, constraintDefinitionId: string): WSupportAssignment | undefined {
  return world.supportAssignments.find((a) => a.requirementId === constraintDefinitionId);
}

/** Derive the calendar-night count at the captured stay place, never from a guessed offset. */
function localNights(window: { start: Instant; end: Instant }, timeZone: string): number | undefined {
  const localDay = (instant: Instant): { year: number; month: number; day: number } | undefined => {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(new Date(instant));
      const lookup = new Map(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value] as const));
      const year = Number(lookup.get('year'));
      const month = Number(lookup.get('month'));
      const day = Number(lookup.get('day'));
      return Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day) ? { year, month, day } : undefined;
    } catch {
      return undefined;
    }
  };
  const start = localDay(window.start);
  const end = localDay(window.end);
  if (!start || !end) return undefined;
  return Math.round((Date.UTC(end.year, end.month - 1, end.day) - Date.UTC(start.year, start.month - 1, start.day)) / 86_400_000);
}

/**
 * Apply a closed ScenarioEffect set to a deep clone. Rejects any attempt to
 * invent supplier confirmation, mutate judging criteria, or reference missing
 * subjects. Returns a TypedResult — never throws for expected candidate errors.
 */
export function applyScenarioOverlay(input: OverlayApplyInput): TypedResult<OverlayApplyResult> {
  const proposedWorld = cloneWorld(input.baseWorld);
  if (sameWorldRef(proposedWorld, input.baseWorld)) {
    return conflict(typedConflict('VALIDATION_FAILED', 'overlay clone must not alias the base world'));
  }

  const offers = new Map((input.resolvedOffers ?? []).map((o) => [o.offerId, o]));
  const resolvedStayOffers = input.resolvedStayOffers ?? [];
  const seenStayOfferIds = new Set<string>();
  for (const offer of resolvedStayOffers) {
    if (seenStayOfferIds.has(offer.offerId)) {
      return conflict(typedConflict('VALIDATION_FAILED', 'resolved stay offers contain a duplicate offer id; offer resolution is ambiguous', [
        { kind: 'OFFER', id: offer.offerId },
      ]));
    }
    seenStayOfferIds.add(offer.offerId);
  }
  const stayOffers = new Map(resolvedStayOffers.map((offer) => [offer.offerId, offer]));
  const affected = new Map<string, TypedRef>();
  const authority = new Set<string>();
  const applied: ScenarioEffect[] = [];

  for (const effect of input.scenarioChange.effects) {
    const appliedOne = applyEffect(proposedWorld, effect, offers, stayOffers, affected, authority);
    if (!appliedOne.ok) return appliedOne;
    applied.push(effect);
  }

  // Closed-union defence: ScenarioEffectSchema already excludes rule/assessment/
  // observation edits. Re-check judging criteria were not mutated relative to base.
  const criteriaIssue = judgingCriteriaMutated(input.baseWorld, proposedWorld);
  if (criteriaIssue) {
    return conflict(typedConflict('REQUIREMENT_WOULD_BE_RELAXED', criteriaIssue));
  }

  for (const ref of input.scenarioChange.affectedSubjectRefs) addAffected(affected, ref);

  return ok({
    proposedWorld,
    affectedSubjectRefs: [...affected.values()].sort((a, b) => refKey(a).localeCompare(refKey(b))),
    requiredAuthorityScopes: [...authority].sort(),
    appliedEffects: applied,
  });
}

function applyEffect(
  world: CapturedWorld,
  effect: ScenarioEffect,
  offers: Map<string, ResolvedOffer>,
  stayOffers: Map<string, ResolvedStayOffer>,
  affected: Map<string, TypedRef>,
  authority: Set<string>,
): TypedResult<true> {
  switch (effect.effectKind) {
    case 'SELECT_OFFER': {
      const item = findJourneyItem(world, effect.journeyItemId);
      if (!item) {
        return conflict(typedConflict('VALIDATION_FAILED', 'SELECT_OFFER journey item not in captured world', [
          { kind: 'JOURNEY_ITEM', id: effect.journeyItemId },
        ]));
      }
      const offer = offers.get(effect.offerId);
      if (!offer) {
        return conflict(typedConflict('VALIDATION_FAILED', 'SELECT_OFFER offer is not resolved; cannot fabricate supplier selection', [
          { kind: 'OFFER', id: effect.offerId },
        ]));
      }
      if (!world.transportServices.some((s) => s.id === offer.transportServiceId)) {
        return conflict(typedConflict('VALIDATION_FAILED', 'SELECT_OFFER service is not in captured world', [
          { kind: 'TRANSPORT_SERVICE', id: offer.transportServiceId },
        ]));
      }
      // Intent/selection only — never set reservation observedStatus or invent confirmation.
      item.selectedServiceId = offer.transportServiceId;
      addAffected(affected, { kind: 'JOURNEY_ITEM', id: item.id });
      addAffected(affected, { kind: 'JOURNEY', id: item.journeyId });
      authority.add('journey.service_selection');
      return ok(true);
    }
    case 'ADD_JOURNEY_STAY': {
      const journey = world.journeys.find((candidate) => candidate.id === effect.journeyId);
      if (!journey) {
        return conflict(typedConflict('VALIDATION_FAILED', 'ADD_JOURNEY_STAY journey not in captured world', [
          { kind: 'JOURNEY', id: effect.journeyId },
        ]));
      }
      if (!world.travellers.some((traveller) => traveller.id === journey.travellerId)) {
        return conflict(typedConflict('VALIDATION_FAILED', 'ADD_JOURNEY_STAY journey traveller not in captured world', [
          { kind: 'JOURNEY', id: journey.id },
          { kind: 'TRAVELLER', id: journey.travellerId },
        ]));
      }
      if (world.journeyItems.some((item) => item.id === effect.proposedJourneyItemId)) {
        return conflict(typedConflict('VALIDATION_FAILED', 'ADD_JOURNEY_STAY proposed journey item id already exists', [
          { kind: 'JOURNEY', id: journey.id },
        ]));
      }
      const offer = stayOffers.get(effect.offerId);
      if (!offer) {
        return conflict(typedConflict('VALIDATION_FAILED', 'ADD_JOURNEY_STAY offer is not resolved; cannot fabricate supplier selection', [
          { kind: 'OFFER', id: effect.offerId },
        ]));
      }
      const place = world.places.find((candidate) => candidate.id === offer.placeId);
      if (!place) {
        return conflict(typedConflict('VALIDATION_FAILED', 'ADD_JOURNEY_STAY offer place is not in captured world', [
          { kind: 'OFFER', id: effect.offerId },
          { kind: 'PLACE', id: offer.placeId },
        ]));
      }
      let window: ReturnType<typeof InstantIntervalSchema.safeParse>;
      try {
        window = InstantIntervalSchema.safeParse(offer.stayWindow);
      } catch {
        return conflict(typedConflict('VALIDATION_FAILED', 'ADD_JOURNEY_STAY offer window is not a valid positive offset-bearing interval', [
          { kind: 'OFFER', id: effect.offerId },
        ]));
      }
      if (!window.success) {
        return conflict(typedConflict('VALIDATION_FAILED', 'ADD_JOURNEY_STAY offer window is not a valid positive offset-bearing interval', [
          { kind: 'OFFER', id: effect.offerId },
        ]));
      }
      const offerPrice = ExactMoneySchema.safeParse(offer.price);
      if (!offerPrice.success) {
        return conflict(typedConflict('VALIDATION_FAILED', 'ADD_JOURNEY_STAY offer price is not exact money', [
          { kind: 'OFFER', id: effect.offerId },
        ]));
      }
      let pricesMatch = false;
      let hasNegativePrice = false;
      try {
        pricesMatch = effect.offerPrice.currency === offerPrice.data.currency
          && compareExactMoney(effect.offerPrice, offerPrice.data) === 0;
        hasNegativePrice = compareExactMoney(
          effect.offerPrice,
          { amount: '0', currency: effect.offerPrice.currency },
        ) < 0 || compareExactMoney(
          offerPrice.data,
          { amount: '0', currency: offerPrice.data.currency },
        ) < 0;
      } catch {
        return conflict(typedConflict('VALIDATION_FAILED', 'ADD_JOURNEY_STAY offer price is not an exact supported amount', [
          { kind: 'OFFER', id: effect.offerId },
        ]));
      }
      if (hasNegativePrice) {
        return conflict(typedConflict('VALIDATION_FAILED', 'ADD_JOURNEY_STAY purchase price cannot be negative', [
          { kind: 'OFFER', id: effect.offerId },
        ]));
      }
      if (!pricesMatch) {
        return conflict(typedConflict('VALIDATION_FAILED', 'ADD_JOURNEY_STAY effect price does not match resolved offer', [
          { kind: 'OFFER', id: effect.offerId },
        ]));
      }
      const requiredNights = localNights(window.data, place.timeZone);
      if (requiredNights === undefined || requiredNights <= 0) {
        return conflict(typedConflict('VALIDATION_FAILED', 'ADD_JOURNEY_STAY offer window does not contain a positive number of local nights', [
          { kind: 'OFFER', id: effect.offerId },
          { kind: 'PLACE', id: place.id },
        ]));
      }
      // This row exists only in the cloned candidate world. It carries intent
      // facts from the captured offer, never a reservation, allocation, or
      // supplier-observed status. The overlay itself is the proposed-state
      // convention; PLANNED remains the canonical JourneyItem lifecycle shape.
      world.journeyItems.push({
        id: effect.proposedJourneyItemId,
        journeyId: journey.id,
        kind: 'STAY',
        orderKey: effect.orderKey,
        lifecycleStatus: 'PLANNED',
        flexible: false,
        intendedWindow: { ...window.data },
        desiredOriginPlaceId: null,
        desiredDestinationPlaceId: null,
        selectedServiceId: null,
        intendedPlaceId: place.id,
        requiredNights,
        participationId: null,
        standaloneTitle: null,
        standaloneWindow: null,
        resourceId: null,
        intendedLocationPlaceId: null,
      });
      const visitApplied = applyStayVisitOverlay({
        world,
        journey,
        effect,
        placeId: place.id,
        stayWindow: window.data,
      });
      if (!visitApplied.ok) return visitApplied;
      // The proposed item has no canonical identity and therefore is never an
      // authority/impact subject. Its existing owning Journey and Traveller are.
      addAffected(affected, { kind: 'JOURNEY', id: journey.id });
      addAffected(affected, { kind: 'TRAVELLER', id: journey.travellerId });
      authority.add('journey.stay');
      return ok(true);
    }
    case 'CANCEL_STAY': {
      const item = findJourneyItem(world, effect.journeyItemId);
      if (!item || item.kind !== 'STAY' || item.lifecycleStatus === 'DROPPED' || item.lifecycleStatus === 'COMPLETED') {
        return conflict(typedConflict('VALIDATION_FAILED', 'CANCEL_STAY requires an active captured STAY journey item', [
          { kind: 'JOURNEY_ITEM', id: effect.journeyItemId },
        ]));
      }
      const journey = world.journeys.find((candidate) => candidate.id === item.journeyId);
      const line = world.reservationLines.find((candidate) => candidate.id === effect.reservationLineId);
      const reservation = line ? world.reservations.find((candidate) => candidate.id === line.reservationId) : undefined;
      const allocation = line && journey ? world.allocations.find((candidate) =>
        candidate.lineId === line.id && candidate.reservationId === line.reservationId
          && candidate.journeyItemId === item.id && candidate.travellerId === journey.travellerId,
      ) : undefined;
      if (!journey || !line || line.productType !== 'STAY' || !reservation || reservation.reservationType !== 'STAY' || !allocation) {
        return conflict(typedConflict('VALIDATION_FAILED', 'CANCEL_STAY line must be a captured STAY allocation for the owning Journey traveller', [
          { kind: 'JOURNEY_ITEM', id: item.id },
          { kind: 'RESERVATION_LINE', id: effect.reservationLineId },
        ]));
      }
      if (!['HELD', 'CONFIRMED'].includes(line.observedStatus)
        || !['HELD', 'CONFIRMED'].includes(reservation.observedStatus ?? 'UNKNOWN')) {
        return conflict(typedConflict('VALIDATION_FAILED', 'CANCEL_STAY requires an observed active stay; unknown or terminal supplier state must be reconciled first', [
          { kind: 'RESERVATION', id: reservation.id }, { kind: 'RESERVATION_LINE', id: line.id },
        ]));
      }
      const penalty = ExactMoneySchema.safeParse(effect.cancellationPenalty);
      if (!penalty.success) {
        return conflict(typedConflict('VALIDATION_FAILED', 'CANCEL_STAY penalty is not exact money', [{ kind: 'RESERVATION_LINE', id: line.id }]));
      }
      try {
        if (compareExactMoney(penalty.data, { amount: '0', currency: penalty.data.currency }) < 0) {
          return conflict(typedConflict('VALIDATION_FAILED', 'CANCEL_STAY penalty cannot be negative', [{ kind: 'RESERVATION_LINE', id: line.id }]));
        }
      } catch {
        return conflict(typedConflict('VALIDATION_FAILED', 'CANCEL_STAY penalty is not an exact supported amount', [{ kind: 'RESERVATION_LINE', id: line.id }]));
      }
      // Only the candidate's Journey intent changes. Reservation and line
      // observations remain external facts until a provider cancellation is observed.
      item.lifecycleStatus = 'DROPPED';
      addAffected(affected, { kind: 'JOURNEY_ITEM', id: item.id });
      addAffected(affected, { kind: 'JOURNEY', id: journey.id });
      addAffected(affected, { kind: 'RESERVATION', id: reservation.id });
      addAffected(affected, { kind: 'RESERVATION_LINE', id: line.id });
      authority.add('journey.stay.cancel');
      return ok(true);
    }
    case 'PROPOSE_ALLOCATION': {
      if (!world.reservationLines.some((l) => l.id === effect.reservationLineId)) {
        return conflict(typedConflict('VALIDATION_FAILED', 'PROPOSE_ALLOCATION line not in captured world', [
          { kind: 'RESERVATION_LINE', id: effect.reservationLineId },
        ]));
      }
      if (!world.travellers.some((t) => t.id === effect.travellerId)) {
        return conflict(typedConflict('VALIDATION_FAILED', 'PROPOSE_ALLOCATION traveller not in captured world', [
          { kind: 'TRAVELLER', id: effect.travellerId },
        ]));
      }
      const line = world.reservationLines.find((l) => l.id === effect.reservationLineId)!;
      const allocation: WAllocation = {
        id: `overlay-alloc:${effect.reservationLineId}:${effect.travellerId}`,
        reservationId: line.reservationId,
        lineId: effect.reservationLineId,
        travellerId: effect.travellerId,
        journeyItemId: effect.journeyItemId ?? null,
        role: 'TRAVELLER',
        quantity: 1,
      };
      world.allocations = [...world.allocations.filter(
        (a) => !(a.lineId === allocation.lineId && a.travellerId === allocation.travellerId),
      ), allocation];
      addAffected(affected, { kind: 'RESERVATION', id: line.reservationId });
      addAffected(affected, { kind: 'TRAVELLER', id: effect.travellerId });
      if (effect.journeyItemId) {
        const ji = findJourneyItem(world, effect.journeyItemId);
        if (ji) addAffected(affected, { kind: 'JOURNEY', id: ji.journeyId });
      }
      authority.add('reservation.allocation');
      return ok(true);
    }
    case 'CHANGE_PROGRAMME_ITEM_TIME': {
      const item = findProgrammeItem(world, effect.programmeItemId);
      if (!item) {
        return conflict(typedConflict('VALIDATION_FAILED', 'CHANGE_PROGRAMME_ITEM_TIME item not in captured world', [
          { kind: 'PROGRAMME_ITEM', id: effect.programmeItemId },
        ]));
      }
      if (item.scheduleAuthority !== 'INTERNAL' && item.scheduleAuthority !== 'SHARED') {
        return conflict(typedConflict(
          'CAPABILITY_UNSUPPORTED',
          'programme item schedule is not internally authoritative; external schedule changes require a supported capability',
          [{ kind: 'PROGRAMME_ITEM', id: item.id }],
        ));
      }
      item.window = { start: effect.proposedWindow.start, end: effect.proposedWindow.end };
      addAffected(affected, { kind: 'PROGRAMME_ITEM', id: item.id });
      addAffected(affected, { kind: 'PROGRAMME', id: item.programmeId });
      for (const p of world.participations.filter((x) => x.programmeItemId === item.id)) {
        addAffected(affected, { kind: 'TRAVELLER', id: p.travellerId });
        for (const j of world.journeys.filter((jj) => jj.travellerId === p.travellerId)) {
          addAffected(affected, { kind: 'JOURNEY', id: j.id });
        }
      }
      authority.add('programme.schedule');
      return ok(true);
    }
    case 'ALTER_JOURNEY_ITEM_INTENT': {
      const item = findJourneyItem(world, effect.journeyItemId);
      if (!item) {
        return conflict(typedConflict('VALIDATION_FAILED', 'ALTER_JOURNEY_ITEM_INTENT item not in captured world', [
          { kind: 'JOURNEY_ITEM', id: effect.journeyItemId },
        ]));
      }
      if (effect.proposedWindow) {
        item.intendedWindow = { start: effect.proposedWindow.start, end: effect.proposedWindow.end };
      }
      addAffected(affected, { kind: 'JOURNEY_ITEM', id: item.id });
      addAffected(affected, { kind: 'JOURNEY', id: item.journeyId });
      authority.add('journey.intent');
      return ok(true);
    }
    case 'CHANGE_SUPPORT_ASSIGNMENT': {
      const assignment = findSupportAssignment(world, effect.constraintDefinitionId);
      if (!assignment) {
        return conflict(typedConflict('VALIDATION_FAILED', 'CHANGE_SUPPORT_ASSIGNMENT assignment not in captured world', [
          { kind: 'CONSTRAINT_DEFINITION', id: effect.constraintDefinitionId },
        ]));
      }
      if (assignment.requirementVersion !== effect.constraintDefinitionVersion) {
        return conflict(typedConflict(
          'STALE_AGGREGATE_REVISION',
          'support assignment requirement version does not match proposed change',
          [{ kind: 'CONSTRAINT_DEFINITION', id: effect.constraintDefinitionId }],
        ));
      }
      const req = world.accompanimentRequirements.find(
        (r) => r.id === effect.constraintDefinitionId && r.version === effect.constraintDefinitionVersion,
      );
      if (!req) {
        return conflict(typedConflict('VALIDATION_FAILED', 'support requirement version not in captured world', [
          { kind: 'CONSTRAINT_DEFINITION', id: effect.constraintDefinitionId },
        ]));
      }
      for (const supporterId of effect.proposedAssignedSupporterTravellerIds) {
        if (!req.eligibleSupporterTravellerIds.includes(supporterId)) {
          return conflict(typedConflict(
            'REQUIREMENT_WOULD_BE_RELAXED',
            'proposed supporter is not in the governing eligible set',
            [{ kind: 'TRAVELLER', id: supporterId }],
          ));
        }
      }
      assignment.assigneeTravellerIds = [...effect.proposedAssignedSupporterTravellerIds];
      addAffected(affected, { kind: 'SUPPORT_ASSIGNMENT', id: assignment.id });
      addAffected(affected, { kind: 'TRAVELLER', id: req.supportedTravellerId });
      authority.add('support.assignment');
      return ok(true);
    }
    case 'WAIVE_OBJECTIVE': {
      const objective = findObjective(world, effect.objectiveId);
      if (!objective) {
        return conflict(typedConflict('VALIDATION_FAILED', 'WAIVE_OBJECTIVE objective not in captured world', [
          { kind: 'OBJECTIVE', id: effect.objectiveId },
        ]));
      }
      // Proposed disposition only — original objective identity/targets remain;
      // dispositionEvidenceId stays null until M8 authorises a durable record.
      objective.disposition = effect.disposition ?? 'WAIVED';
      objective.dispositionEvidenceId = null;
      addAffected(affected, { kind: 'OBJECTIVE', id: objective.id });
      addAffected(affected, objective.owner);
      authority.add('objective.disposition');
      authority.add(`objective.disposition:${effect.disposition ?? 'WAIVED'}`);
      return ok(true);
    }
    default: {
      const _exhaustive: never = effect;
      return conflict(typedConflict('VALIDATION_FAILED', `unsupported scenario effect ${JSON.stringify(_exhaustive)}`));
    }
  }
}

/**
 * Candidates may not loosen judging criteria. Comparing constraint/rule set
 * identity sets catches any accidental mutation path.
 */
function judgingCriteriaMutated(base: CapturedWorld, proposed: CapturedWorld): string | undefined {
  const baseConstraintIds = new Set(base.constraints.map((c) => c.id));
  const proposedConstraintIds = new Set(proposed.constraints.map((c) => c.id));
  for (const id of baseConstraintIds) {
    if (!proposedConstraintIds.has(id)) {
      return `candidate removed constraint ${id} from the evaluation basis`;
    }
    const before = base.constraints.find((c) => c.id === id)!;
    const after = proposed.constraints.find((c) => c.id === id)!;
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      return `candidate mutated constraint ${id}; strategies cannot edit judging criteria`;
    }
  }

  const baseRuleIds = new Set(base.ruleSetVersions.map((r) => r.id));
  for (const id of baseRuleIds) {
    const before = base.ruleSetVersions.find((r) => r.id === id)!;
    const after = proposed.ruleSetVersions.find((r) => r.id === id);
    if (!after || JSON.stringify(before) !== JSON.stringify(after)) {
      return `candidate mutated rule set edition ${id}; strategies cannot edit judging criteria`;
    }
  }

  // Supplier observations and credentials must be byte-identical.
  if (JSON.stringify(base.transportServices) !== JSON.stringify(proposed.transportServices)) {
    return 'candidate mutated transport service observations; cannot fabricate supplier confirmation';
  }
  if (JSON.stringify(base.reservationLines.map((l) => ({ id: l.id, observedStatus: l.observedStatus, evidenceId: l.evidenceId })))
    !== JSON.stringify(proposed.reservationLines.map((l) => ({ id: l.id, observedStatus: l.observedStatus, evidenceId: l.evidenceId })))) {
    return 'candidate mutated reservation observation status; cannot fabricate supplier confirmation';
  }
  if (JSON.stringify(base.credentialVersions) !== JSON.stringify(proposed.credentialVersions)) {
    return 'candidate mutated credential editions';
  }
  return undefined;
}

/** Test helper: proves overlay evaluation left the caller's base object graph untouched. */
export function assertCanonicalWorldUntouched(baseBefore: CapturedWorld, baseAfter: CapturedWorld): void {
  if (JSON.stringify(baseBefore) !== JSON.stringify(baseAfter)) {
    throw new Error('canonical CapturedWorld was mutated during scenario overlay evaluation');
  }
}

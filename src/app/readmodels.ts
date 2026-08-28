/**
 * I5 — real read models for the operator and traveller surfaces.
 *
 * Every field is projected from persisted authoritative state (trips, cases,
 * signals, audit, entities) — never from fixture data or UI-local truth.
 * Recovery-option verdicts are re-derived by the deterministic viability
 * engine on an isolated overlay of the CURRENT authoritative snapshot, so a
 * rejected option carries the engine's own reason. Copy stays user-facing:
 * no graph/constraint jargon, and simulated execution is labelled honestly.
 */
import type { EntityId, IsoDateTime } from '../domain/common.ts';
import type { Trip } from '../domain/trip.ts';
import type { TripElement, TransportMode } from '../domain/elements.ts';
import type { TripSignal } from '../operational/signal.ts';
import type { RecoveryCase } from '../operational/case.ts';
import type { CaseStatus } from '../operational/case.ts';
import type { AuthorityDecision, ActionIntent } from '../operational/intent.ts';
import type {
  OperatorDashboardView,
  OperatorDecisionRequest,
  OperatorTripView,
  ProgrammeArrangementCounts,
  ReadModelStatus,
  RemainderViability,
  TravellerInputRequest,
  TravellerTripView,
} from '../contracts/readmodels.ts';
import type {
  CaseCheckResult,
  CaseCheckView,
  CaseDetailView,
  ChainLinkView,
  RecoveryOptionView,
  ApprovalRequirementView,
  ActionProgressView,
} from '../ui/case-view-model.ts';
import type { CaseRepository, AuditRepository, SignalRepository } from '../contracts/repositories.ts';
import type { ViabilityEngine } from '../contracts/services.ts';
import { ImpactEngine } from '../engine/impact.ts';
import { evaluateConstraints, type EvaluationContext } from '../engine/evaluators.ts';
import type { Constraint } from '../domain/constraints.ts';
import type { RuleSet } from '../domain/rules.ts';
import { buildTripSnapshot, constraintsForTrip, principalScopeForTrip, type SnapshotDependencies } from './snapshot.ts';
import { evaluateCandidate, type CandidateRejectionEvidence } from './planningLoop.ts';
import { projectCaseChain } from './chain.ts';
import { buildChainPresentationContext, presentationLinkState } from './chainPresentation.ts';
import {
  countOtherCommitments,
  isStayElement,
  isTransportLeg,
  selectJourneyTransportAndStay,
  selectRecoveryCommitment,
} from './chainProjection.ts';
import type { AnchorEvent, Place } from '../domain/entities.ts';
import {
  presentAction,
  presentActivity,
  presentAllocationSummary,
  presentApprovalReason,
  presentCandidateRejection,
  presentCheckLabel,
  presentResolution,
  presentDisruptedCaseSummary,
  presentSignalChange,
  presentUncertainties,
} from './presentation.ts';
import { enrichCaseDetailView } from './casePresentation.ts';
import { projectOptionPresentation } from './optionPresentation.ts';
import { formatMoney } from '../ui/html.ts';
import { ResolutionTargetSchema } from '../contracts/changeRequest.ts';
import {
  pendingChangePhaseForCase,
  resolveSubstitutionTargetIds,
} from './substitutionTargets.ts';
import { projectWholeTripRecoveryPlan, wholeTripAnalysisSteps } from './wholeTripRecoveryPlan.ts';
import { buildEvaluationContext } from '../engine/evaluationContext.ts';

export interface ReadModelDependencies {
  snapshot: SnapshotDependencies;
  signals: SignalRepository;
  cases: CaseRepository;
  audit: AuditRepository;
  viability: ViabilityEngine;
}

function changeTargetFromSignal(signal: TripSignal | undefined) {
  if (!signal || signal.kind !== 'TRAVELLER_INPUT') return undefined;
  const payload = signal.payload as Record<string, unknown>;
  if (payload['changeRequestId'] === undefined) return undefined;
  const parsed = ResolutionTargetSchema.safeParse(payload['target']);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Stable source-incident identity from the triggering signal. Travellers hit
 * by the same real-world event (same flight change at the same instant, same
 * commitment change, same change request) share a key; independent incidents
 * stay distinct. Generic — built only from signal kind/payload/instant.
 */
export function incidentKeyForSignal(signal: TripSignal | undefined): string | undefined {
  if (!signal) return undefined;
  const payload = signal.payload as Record<string, unknown>;
  const str = (key: string): string | undefined =>
    typeof payload[key] === 'string' && (payload[key] as string).length > 0 ? (payload[key] as string) : undefined;
  const carrier = str('carrierCode');
  const flight = str('flightNumber');
  if (carrier && flight) {
    return `flight|${signal.kind}|${carrier}|${flight}|${signal.occurredAt}`;
  }
  const commitmentId = str('commitmentId');
  if (signal.kind === 'ANCHOR_COMMITMENT_CHANGE' && commitmentId) {
    return `commitment|${commitmentId}|${signal.occurredAt}`;
  }
  const changeRequestId = str('changeRequestId');
  if (signal.kind === 'TRAVELLER_INPUT' && changeRequestId) {
    return `change-request|${changeRequestId}`;
  }
  // Distinct, unattributable incident — never collapse with anything else.
  return `signal|${signal.id}`;
}

function primaryTriggeringSignal(signals: readonly TripSignal[]): TripSignal | undefined {
  if (signals.length === 0) return undefined;
  const missed = signals.find(
    (signal) =>
      signal.kind === 'TRAVELLER_INPUT' &&
      (signal.payload as Record<string, unknown>)['event'] === 'MISSED_FLIGHT',
  );
  if (missed) return missed;
  const changeRequest = signals.find(
    (signal) =>
      signal.kind === 'TRAVELLER_INPUT' &&
      typeof (signal.payload as Record<string, unknown>)['changeRequestId'] === 'string',
  );
  if (changeRequest) return changeRequest;
  return signals[signals.length - 1];
}

async function chainPresentationForCase(
  deps: ReadModelDependencies,
  input: {
    trip: Trip;
    recoveryCase: RecoveryCase;
    at: IsoDateTime;
    places: ReadonlyMap<string, Place>;
    bestStrategyId?: EntityId;
    triggeringSignals: readonly TripSignal[];
  },
): Promise<ReturnType<typeof buildChainPresentationContext>> {
  const { constraints, evaluations } = await currentConstraintEvaluations(deps, input.trip, input.at);
  const hardConstraintFailed = evaluations.some((evaluation) => {
    const constraint = constraints.find((candidate) => candidate.id === evaluation.constraintId);
    return constraint?.hardness === 'HARD' && evaluation.status === 'FAIL';
  });
  const changeTarget = changeTargetFromSignal(
    input.triggeringSignals.find((signal) => signal.kind === 'TRAVELLER_INPUT'),
  );
  const changeRequestCase = input.triggeringSignals.some(
    (signal) =>
      signal.kind === 'TRAVELLER_INPUT' &&
      typeof (signal.payload as Record<string, unknown>)['changeRequestId'] === 'string',
  );
  return buildChainPresentationContext({
    recoveryCase: input.recoveryCase,
    tripNotViable: deriveRemainderViability(constraints, evaluations, input.trip.viability) === 'NOT_VIABLE',
    hardConstraintFailed,
    recoveryCommitmentId: selectRecoveryCommitment(input.trip, input.recoveryCase)?.id,
    substitutionTargetIds: resolveSubstitutionTargetIds({
      trip: input.trip,
      recoveryCase: input.recoveryCase,
      bestStrategyId: input.bestStrategyId,
      changeTarget,
      places: input.places,
    }),
    pendingChangePhase: pendingChangePhaseForCase(input.recoveryCase, { changeRequestCase }),
  });
}

/** Rewrite bare `542 USD` / `122.23 SGD` fragments in strategy titles to US$/S$. */
function presentStrategyTitle(summary: string): string {
  return summary
    .replace(
      /(\d+(?:\.\d+)?)\s*(USD|SGD)\b/gi,
      (_match, amount: string, currency: string) =>
        formatMoney({ amount: Number(amount), currency: currency.toUpperCase() as 'USD' | 'SGD' }),
    )
    .replace(/\bthrough\s+(\d{4})-(\d{2})-(\d{2})\b/gi, (_m, y: string, mo: string, d: string) => {
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return `through ${Number(d)} ${months[Number(mo) - 1] ?? mo}`;
    })
    .replace(/\b(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?\b/g,
      (_m, _y: string, mo: string, d: string, hh: string, mm: string) => {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `${Number(d)} ${months[Number(mo) - 1] ?? mo} · ${hh}:${mm}`;
      });
}

function humanStayInstant(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso) ?? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return undefined;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = `${Number(match[3])} ${months[Number(match[2]) - 1] ?? match[2]}`;
  return match[4] ? `${day} · ${match[4]}:${match[5]}` : day;
}

/** Traveller-facing approval prompt from structured stay/funding evidence. */
function presentTravellerDecisionPrompt(
  recoveryCase: RecoveryCase,
  intent: NonNullable<ReturnType<typeof intentForDecision>>,
  trip: Trip,
  placeName: string | undefined,
): string {
  const strategy = recoveryCase.strategies.find((candidate) => candidate.id === intent.strategyId);
  const stayOp = strategy?.candidateOperations.find(
    (operation) =>
      operation.op === 'UPSERT_ENTITY' &&
      operation.entityType === 'TRIP_ELEMENT' &&
      (operation.data as { elementKind?: string }).elementKind === 'STAY',
  );
  const proposedStay =
    stayOp && stayOp.op === 'UPSERT_ENTITY'
      ? (stayOp.data as Extract<TripElement, { elementKind: 'STAY' }>)
      : undefined;
  const currentStay = trip.elements.find(
    (element): element is Extract<TripElement, { elementKind: 'STAY' }> => element.elementKind === 'STAY',
  );
  const property =
    placeName?.trim() ||
    (typeof strategy?.summary === 'string'
      ? /Extend stay at ([^—]+)/i.exec(strategy.summary)?.[1]?.trim()
      : undefined) ||
    'your hotel';
  const from = humanStayInstant(currentStay?.data.checkOut.value);
  const to = humanStayInstant(proposedStay?.data.checkOut?.value);
  const payable = intent.providerSpend
    ? formatMoney(intent.providerSpend)
    : intent.priceDelta
      ? formatMoney(intent.priceDelta)
      : undefined;
  const funding =
    intent.costAllocation?.incrementalPayer === 'TRAVELLER'
      ? ' Traveller-funded increment'
      : intent.costAllocation
        ? ` ${presentAllocationSummary(intent.costAllocation)}`
        : '';
  if (from && to) {
    return `Approve extending ${property}: ${from} → ${to}.${funding}${payable ? ` ${payable}.` : ''} No flight change.`;
  }
  const fundingNote = intent.costAllocation
    ? ` Funding: ${presentAllocationSummary(intent.costAllocation)}.`
    : intent.priceDelta
      ? ' Funding: who pays has not been determined yet.'
      : '';
  return `Approve the proposed change${payable ? ` (${payable})` : ''}?${fundingNote}`;
}

const ELEMENT_KIND_LABEL: Record<TripElement['elementKind'], string> = {
  TRANSPORT_LEG: 'Transport leg',
  STAY: 'Stay',
  ENGAGEMENT: 'Engagement',
};

const TRANSPORT_MODE_LABEL: Record<TransportMode, string> = {
  FLIGHT: 'flight',
  TRAIN: 'train',
  FERRY: 'ferry',
  PUBLIC_TRANSIT: 'public transit',
  TAXI_OR_RIDEHAIL: 'taxi',
  PRIVATE_TRANSFER: 'private transfer',
  CAR_RENTAL: 'rental car',
  WALKING: 'walking',
  OTHER: 'transport',
};

/** Generic audit-action -> user-facing activity copy. */

function describeElement(element: TripElement): string {
  const label = ELEMENT_KIND_LABEL[element.elementKind];
  if (element.elementKind === 'ENGAGEMENT') return label;
  // DR-8: the raw provider booking reference (e.g. an Atlas order id) is an
  // internal identifier, not user-facing copy — describe the element kind
  // and mode through label maps only, never a raw enum value. Machine-
  // readable identity still lives in the wire/JSON views and DOM data-*
  // attributes, never here.
  if (element.elementKind === 'TRANSPORT_LEG') return `${label} (${TRANSPORT_MODE_LABEL[element.data.mode]})`;
  return label;
}

/**
 * Derive ReadModelStatus from a RecoveryCase.
 *
 * DR-8: traveller-initiated change requests (TRAVELLER_INPUT signals) in
 * early case states (DETECTED/ASSESSING/PLANNING/ESCALATED) render as
 * CHANGE_REQUESTED, not DISRUPTED. Supplier-originated disruptions in the
 * same states render as DISRUPTED. This distinction is critical for user
 * copy: "The traveller asked for a change" vs "Plans changed and part of
 * this trip no longer works as booked."
 */
export function statusFromCase(
  status: CaseStatus,
  isTravellerChangeRequest: boolean = false,
): ReadModelStatus {
  switch (status) {
    case 'RESOLVED':
      return 'RESOLVED';
    case 'EXECUTING':
    case 'VERIFYING':
    case 'READY_TO_EXECUTE':
    case 'AWAITING_TRAVELLER':
    case 'AWAITING_APPROVAL':
      return 'RECOVERING';
    default:
      // DETECTED, ASSESSING, PLANNING, ESCALATED
      return isTravellerChangeRequest ? 'CHANGE_REQUESTED' : 'DISRUPTED';
  }
}

/**
 * DR-8: detect whether a case was triggered by a traveller change request.
 * A case is traveller-initiated when its triggering signal is a
 * TRAVELLER_INPUT kind. The signal kind is the authoritative evidence —
 * never inferred from case status or strategy content.
 */
export async function isTravellerChangeRequest(
  signals: SignalRepository,
  recoveryCase: RecoveryCase,
): Promise<boolean> {
  for (const signalId of recoveryCase.triggeredBySignalIds) {
    const signal = await signals.getSignal(signalId);
    if (signal?.kind === 'TRAVELLER_INPUT') return true;
  }
  return false;
}

export async function statusForTrip(trip: Trip, latestCase?: RecoveryCase, signals?: SignalRepository): Promise<ReadModelStatus> {
  if (latestCase) {
    const isChangeRequest = signals ? await isTravellerChangeRequest(signals, latestCase) : false;
    return statusFromCase(latestCase.status, isChangeRequest);
  }
  switch (trip.viability) {
    case 'VIABLE':
      return 'READY';
    case 'AT_RISK':
      return 'AT_RISK';
    case 'DISRUPTED':
      return 'DISRUPTED';
    case 'RECOVERING':
      return 'RECOVERING';
    default:
      return 'UNKNOWN';
  }
}

export async function latestCaseFor(cases: CaseRepository, tripId: EntityId): Promise<RecoveryCase | undefined> {
  const all = await cases.listCasesForTrip(tripId);
  const ordered = [...all].sort((a, b) => b.version - a.version || b.updatedAt.localeCompare(a.updatedAt));
  // A fresh request on a trip whose previous case already RESOLVED must not
  // be shadowed by the closed case: an OPEN case always wins over RESOLVED
  // ones; only among the same class does version/updatedAt decide.
  const open = ordered.filter((c) => c.status !== 'RESOLVED');
  return open[0] ?? ordered[0];
}

/** Deterministic constraint evaluation over current authoritative state. */
async function currentConstraintEvaluations(deps: ReadModelDependencies, trip: Trip, at: IsoDateTime) {
  const entities = deps.snapshot.entities;
  const constraints = await constraintsForTrip(entities, trip);
  const ctx: EvaluationContext = {
    trip,
    places: new Map(
      (await entities.list('PLACE'))
        .filter((entry) => entry.entityType === 'PLACE')
        .map((entry) => [entry.entity.id, entry.entity]),
    ),
    ruleSets: new Map<string, RuleSet>(
      (await entities.list('RULE_SET'))
        .filter((entry) => entry.entityType === 'RULE_SET')
        .map((entry) => [entry.entity.id, entry.entity]),
    ),
    travellers: (await entities.list('TRAVELLER'))
      .filter((entry) => entry.entityType === 'TRAVELLER')
      .map((entry) => entry.entity),
    now: at,
  };
  return { constraints, evaluations: evaluateConstraints(constraints, ctx) };
}

/**
 * Propagated whole-trip viability from constraint evaluations.
 * Independent of open-case workflow status (DISRUPTED case ≠ failed commitment).
 */
export function deriveRemainderViability(
  constraints: readonly Constraint[],
  evaluations: readonly { constraintId: string; status: string }[],
  tripViability: Trip['viability'],
): RemainderViability {
  const hardById = new Map<string, Constraint['hardness']>();
  for (const constraint of constraints) {
    hardById.set(constraint.id, constraint.hardness);
  }
  if (evaluations.some((e) => hardById.get(e.constraintId) === 'HARD' && e.status === 'FAIL')) {
    return 'NOT_VIABLE';
  }
  // A trip already reconciled as DISRUPTED carries a direct viability failure
  // (e.g. an impossible connection) even before a hard constraint re-fails on
  // this snapshot. It must not present as workable.
  if (tripViability === 'DISRUPTED') {
    return 'NOT_VIABLE';
  }
  if (evaluations.some((e) => hardById.get(e.constraintId) === 'HARD' && e.status === 'UNKNOWN')) {
    return 'UNKNOWN';
  }
  if (evaluations.some((e) => e.status === 'FAIL') || tripViability === 'AT_RISK') {
    return 'AT_RISK';
  }
  return 'VIABLE';
}

/** Provider payable for queues/CTAs — never substitute home-policy restatement. */
export function intentPayableAmount(intent: {
  providerSpend?: { amount: number; currency: string };
  priceDelta?: { amount: number; currency: string };
}): { amount: number; currency: string } | undefined {
  return intent.providerSpend ?? intent.priceDelta;
}

function pendingApprovalDecisions(recoveryCase: RecoveryCase): AuthorityDecision[] {
  return recoveryCase.authorityDecisions.filter(
    (decision) =>
      (decision.outcome === 'REQUIRES_TRAVELLER' ||
        decision.outcome === 'REQUIRES_ORGANISATION_APPROVER' ||
        decision.outcome === 'REQUIRES_HUMAN_AGENT') &&
      decision.approval === undefined,
  );
}

function intentForDecision(recoveryCase: RecoveryCase, decision: AuthorityDecision): ActionIntent | undefined {
  return recoveryCase.actionIntents.find((intent) => intent.id === decision.intentId);
}

// ---------------------------------------------------------------------------
// Operator dashboard
// ---------------------------------------------------------------------------

export async function projectOperatorDashboard(
  deps: ReadModelDependencies,
  generatedAt: IsoDateTime,
  options?: { anchorEventId?: EntityId },
): Promise<OperatorDashboardView> {
  const summaries = await deps.snapshot.trips.listTrips();
  const trips: OperatorTripView[] = [];
  const summary = { ready: 0, atRisk: 0, disrupted: 0, recovering: 0, awaitingDecision: 0, managedConfirmed: 0 };
  const arrangementCounts: ProgrammeArrangementCounts = {
    total: 0,
    northstarArranged: 0,
    selfOrOtherArranged: 0,
    unspecified: 0,
  };

  for (const item of summaries) {
    const trip = await deps.snapshot.trips.getTrip(item.tripId);
    if (!trip) continue;
    // Event-scoped operator projection: when an AnchorEvent is selected,
    // only that programme's trips appear as ordinary participants.
    if (options?.anchorEventId && trip.anchorEventId !== options.anchorEventId) continue;
    const recoveryCase = await latestCaseFor(deps.cases, trip.id);
    const status = await statusForTrip(trip, recoveryCase, deps.signals);
    if (status === 'READY') summary.ready += 1;
    else if (status === 'AT_RISK') summary.atRisk += 1;
    else if (status === 'DISRUPTED') summary.disrupted += 1;
    else if (status === 'RECOVERING') summary.recovering += 1;

    const travellerNames: string[] = [];
    let travelArrangement: OperatorTripView['travelArrangement'];
    for (const travellerId of trip.travellerIds) {
      const entry = await deps.snapshot.entities.get('TRAVELLER', travellerId);
      if (entry?.entityType === 'TRAVELLER') {
        travellerNames.push(entry.entity.name);
        if (entry.entity.travelArrangement) {
          travelArrangement = entry.entity.travelArrangement;
          arrangementCounts.total += 1;
          if (entry.entity.travelArrangement === 'NORTHSTAR_ARRANGED') {
            arrangementCounts.northstarArranged += 1;
            if (status === 'READY' || status === 'RESOLVED') summary.managedConfirmed += 1;
          } else if (entry.entity.travelArrangement === 'SELF_OR_OTHER_ARRANGED') {
            arrangementCounts.selfOrOtherArranged += 1;
          } else {
            arrangementCounts.unspecified += 1;
          }
        }
      }
    }
    if (!travelArrangement && trip.travellerIds.length > 0) {
      arrangementCounts.total += 1;
      arrangementCounts.unspecified += 1;
      travelArrangement = 'UNSPECIFIED';
    }
    let anchorEventName: string | undefined;
    if (trip.anchorEventId) {
      const entry = await deps.snapshot.entities.get('ANCHOR_EVENT', trip.anchorEventId);
      if (entry?.entityType === 'ANCHOR_EVENT') anchorEventName = entry.entity.name;
    }

    const signals = await deps.signals.listSignalsForTrip(trip.id);
    const lastSignal = signals[signals.length - 1];

    const pendingDecisions: OperatorDecisionRequest[] = [];
    if (recoveryCase) {
      for (const decision of pendingApprovalDecisions(recoveryCase)) {
        const intent = intentForDecision(recoveryCase, decision);
        const payable = intent ? intentPayableAmount(intent) : undefined;
        pendingDecisions.push({
          caseId: recoveryCase.id,
          decisionType: 'APPROVAL',
          description: `Approval needed before ${intent ? presentAction(intent.operation) : 'the recovery action'} can proceed`,
          ...(payable ? { amount: payable } : {}),
          requestedAt: decision.decidedAt,
        });
      }
    }
    if (pendingDecisions.length > 0) summary.awaitingDecision += 1;

    const auditTrail = await deps.audit.query({ subject: trip.id, limit: 8 });
    const systemActivity = [...new Set(auditTrail.map((entry) => presentActivity(entry.action)))];

    const assessment = await new ImpactEngine({
      trips: deps.snapshot.trips,
      signals: deps.signals,
      entities: deps.snapshot.entities,
    }).assess(trip.id);

    // Traveller-specific consequence for shared-incident differentiation.
    const { constraints, evaluations } = await currentConstraintEvaluations(deps, trip, generatedAt);
    const remainderViable = deriveRemainderViability(constraints, evaluations, trip.viability);

    let travellerResponseStatus: OperatorTripView['travellerResponseStatus'] = 'NOT_REQUIRED';
    if (recoveryCase) {
      const travellerDecisions = recoveryCase.authorityDecisions.filter((d) => d.outcome === 'REQUIRES_TRAVELLER');
      if (travellerDecisions.some((d) => d.approval !== undefined)) travellerResponseStatus = 'RESPONDED';
      else if (travellerDecisions.length > 0) travellerResponseStatus = 'AWAITING';
    }

    trips.push({
      tripId: trip.id,
      ...(recoveryCase && recoveryCase.status !== 'RESOLVED'
        ? { activeCaseId: recoveryCase.id }
        : recoveryCase?.status === 'RESOLVED'
          ? { historyCaseId: recoveryCase.id }
          : {}),
      ...(trip.label ? { label: trip.label } : {}),
      travellerNames,
      ...(travelArrangement ? { travelArrangement } : {}),
      ...(anchorEventName ? { anchorEventName } : {}),
      status,
      remainderViable,
      ...(lastSignal ? { whatChanged: presentSignalChange(lastSignal) } : {}),
      ...(lastSignal ? { incidentKey: incidentKeyForSignal(lastSignal) } : {}),
      affectedItems: recoveryCase
        ? recoveryCase.affectedElementIds
            .map((id) => trip.elements.find((element) => element.id === id))
            .filter((element): element is TripElement => Boolean(element))
            .map(describeElement)
            .map((label) => label.replace(/\bel-trip-[a-z0-9-]+/gi, 'trip element'))
        : [],
      systemActivity,
      pendingDecisions,
      uncertainties: presentUncertainties(assessment.unresolvedUnknowns),
      travellerResponseStatus,
      ...(recoveryCase?.resolution ? { resolutionSummary: presentResolution(recoveryCase.resolution) } : {}),
      updatedAt: recoveryCase ? recoveryCase.updatedAt : trip.updatedAt,
    });
  }

  // Participant roster = Northstar-managed + local/self-managed only.
  // Orphan/unspecified trips must not inflate the 67-participant hero truth.
  const participantTrips = trips.filter(
    (row) =>
      row.travellerNames.length > 0 &&
      (row.travelArrangement === 'NORTHSTAR_ARRANGED' ||
        row.travelArrangement === 'SELF_OR_OTHER_ARRANGED'),
  );

  return {
    generatedAt,
    summary,
    trips: participantTrips,
    arrangementCounts: {
      ...arrangementCounts,
      total: arrangementCounts.northstarArranged + arrangementCounts.selfOrOtherArranged,
      unspecified: 0,
    },
  };
}

const RESERVATION_LABEL: Record<TripElement['reservationState'], string> = {
  NONE: 'Not booked',
  HELD: 'Held while options are checked',
  CONFIRMED: 'Confirmed',
  CHANGED: 'Changed',
  CANCELLED: 'Cancelled',
  COMPLETED: 'Completed',
  UNKNOWN: 'Unconfirmed',
};

function chainStateFor(
  element: TripElement,
  presentation?: ReturnType<typeof buildChainPresentationContext>,
): ChainLinkView['state'] {
  if (presentation) return presentationLinkState(element, presentation);
  if (element.elementKind === 'ENGAGEMENT') {
    if (element.status === 'INVALID') return 'BROKEN';
    if (element.status === 'AT_RISK') return 'AT_RISK';
    return 'CONFIRMED';
  }
  if (element.status === 'INVALID' || element.reservationState === 'CANCELLED') return 'BROKEN';
  if (element.status === 'AT_RISK' || element.reservationState === 'CHANGED') return 'AT_RISK';
  if (element.reservationState === 'HELD') return 'PROPOSED';
  if (element.reservationState === 'UNKNOWN') return 'UNKNOWN';
  if (element.reservationState === 'NONE') return 'UNBOOKED';
  return 'CONFIRMED';
}

async function placeLabel(deps: ReadModelDependencies, placeId: EntityId): Promise<string> {
  const entry = await deps.snapshot.entities.get('PLACE', placeId);
  if (entry?.entityType !== 'PLACE') return 'Hotel';
  const name = entry.entity.name?.trim();
  if (name && !/^(place-hotel-|place-)/i.test(name)) return name;
  return 'Hotel';
}

/** Generic authoritative trip chain for roster mini-chains and case views. */
export async function projectJourneyChain(
  deps: ReadModelDependencies,
  trip: Trip,
  recoveryCase?: RecoveryCase,
  at?: IsoDateTime,
): Promise<ChainLinkView[]> {
  let presentation: ReturnType<typeof buildChainPresentationContext> | undefined;
  if (recoveryCase) {
    const when = at ?? recoveryCase.updatedAt;
    presentation = await chainPresentationForCase(deps, {
      trip,
      recoveryCase,
      at: when,
      places: new Map(),
      triggeringSignals: [],
    });
  }

  const chain: ChainLinkView[] = [];
  for (const element of selectJourneyTransportAndStay(trip)) {
    if (isTransportLeg(element)) {
      const origin = await placeLabel(deps, element.data.originPlaceId);
      const destination = await placeLabel(deps, element.data.destinationPlaceId);
      const mode = TRANSPORT_MODE_LABEL[element.data.mode];
      chain.push({
        id: element.id,
        kind: mode.charAt(0).toUpperCase() + mode.slice(1),
        label: `${origin} → ${destination}`,
        detail: RESERVATION_LABEL[element.reservationState],
        state: chainStateFor(element, presentation),
        linkType: element.data.mode === 'FLIGHT' ? 'FLIGHT' : 'GROUND',
      });
      continue;
    }
    if (isStayElement(element)) {
      chain.push({
        id: element.id,
        kind: 'Stay',
        label: await placeLabel(deps, element.data.placeId),
        detail: RESERVATION_LABEL[element.reservationState],
        state: chainStateFor(element, presentation),
        linkType: 'STAY',
      });
    }
  }

  const commitment = selectRecoveryCommitment(trip, recoveryCase);
  if (commitment) {
    const others = countOtherCommitments(trip, commitment);
    chain.push({
      id: commitment.id,
      kind: 'Commitment',
      label: commitment.data.title,
      detail:
        others > 0
          ? `${commitment.importance === 'REQUIRED' ? 'Must not be missed' : 'Part of this trip'} · +${others} other programme commitments`
          : commitment.importance === 'REQUIRED'
            ? 'Must not be missed'
            : 'Part of this trip',
      state: chainStateFor(commitment, presentation),
      commitment: true,
      linkType: 'COMMITMENT',
    });
  }
  return chain;
}

// ---------------------------------------------------------------------------
// Recovery case detail
// ---------------------------------------------------------------------------

export async function projectCaseDetail(
  deps: ReadModelDependencies,
  caseId: EntityId,
  at: IsoDateTime,
): Promise<CaseDetailView | undefined> {
  const recoveryCase = await deps.cases.getCase(caseId);
  if (!recoveryCase) return undefined;
  const trip = await deps.snapshot.trips.getTrip(recoveryCase.tripId);
  if (!trip) return undefined;

  const snapshot = await buildTripSnapshot(deps.snapshot, trip.id, at);
  const assessment = await new ImpactEngine({
    trips: deps.snapshot.trips,
    signals: deps.signals,
    entities: deps.snapshot.entities,
  }).assess(trip.id);

  const triggeringSignals: TripSignal[] = [];
  for (const signalId of recoveryCase.triggeredBySignalIds) {
    const signal = await deps.signals.getSignal(signalId);
    if (signal) triggeringSignals.push(signal);
  }

  const travellerNames: string[] = [];
  for (const travellerId of trip.travellerIds) {
    const entry = await deps.snapshot.entities.get('TRAVELLER', travellerId);
    if (entry?.entityType === 'TRAVELLER') travellerNames.push(entry.entity.name);
  }

  // Checks: deterministic constraint evaluation over current state.
  const { constraints, evaluations } = await currentConstraintEvaluations(deps, trip, at);
  const checks: CaseCheckView[] = evaluations.map((evaluation) => {
    const constraint: Constraint | undefined = constraints.find((c) => c.id === evaluation.constraintId);
    return {
      id: evaluation.constraintId,
      label: presentCheckLabel(constraint, evaluation.status as CaseCheckResult, evaluation.evidence),
      result: evaluation.status as CaseCheckResult,
    };
  });

  const requiredBufferMinutes = constraints
    .map((constraint) => {
      const raw = constraint.parameters?.['minBufferMinutes'];
      return typeof raw === 'number' ? raw : undefined;
    })
    .find((value): value is number => value !== undefined);

  // Critical objective currently threatened (HARD first).
  let criticalObjectiveAtRisk: string | undefined;
  for (const threatened of assessment.threatenedObjectives) {
    const objective = trip.objectives.find((o) => o.id === threatened.objectiveId);
    if (objective?.hardness === 'HARD') {
      criticalObjectiveAtRisk = objective.statement;
      break;
    }
  }

  const places = new Map<string, Place>();
  for (const entry of await deps.snapshot.entities.list('PLACE')) {
    if (entry.entityType === 'PLACE') places.set(entry.entity.id, entry.entity);
  }

  // Options: planning-time deterministic verdicts first (persisted in the
  // PLANNING_COMPLETED audit entry). Re-deriving overlays against current
  // post-resolution state is dishonest evidence: the executed strategy has
  // already changed the state it would evaluate against (waived objectives
  // and confirmed legs re-colour previously rejected options). Only fall
  // back to live re-evaluation when the planning audit carries no verdict.
  const planningAudit = await deps.audit.query({ action: 'PLANNING_COMPLETED', subject: trip.id });
  const latestPlanning = planningAudit[planningAudit.length - 1];
  const bestStrategyId = latestPlanning?.payload['bestStrategyId'] as EntityId | undefined;
  const persistedVerdicts = new Map<string, { feasible: boolean; rejectionEvidence: CandidateRejectionEvidence[] }>();
  const rawVerdicts = latestPlanning?.payload['candidateVerdicts'];
  if (Array.isArray(rawVerdicts)) {
    for (const entry of rawVerdicts) {
      if (
        entry &&
        typeof entry === 'object' &&
        typeof (entry as { strategyId?: unknown }).strategyId === 'string' &&
        typeof (entry as { feasible?: unknown }).feasible === 'boolean'
      ) {
        const verdict = entry as { strategyId: string; feasible: boolean; rejectionEvidence?: unknown };
        persistedVerdicts.set(verdict.strategyId, {
          feasible: verdict.feasible,
          rejectionEvidence: Array.isArray(verdict.rejectionEvidence)
            ? verdict.rejectionEvidence.filter((evidence): evidence is CandidateRejectionEvidence =>
              Boolean(evidence) && typeof evidence === 'object' && typeof (evidence as { kind?: unknown }).kind === 'string')
            : [],
        });
      }
    }
  }
  const options: RecoveryOptionView[] = [];
  const recoveryEngagement = selectRecoveryCommitment(trip, recoveryCase);
  const evalContext = await buildEvaluationContext(deps.snapshot.entities, trip, at);
  const ruleSets = [...evalContext.ruleSets.values()];
  for (const strategy of recoveryCase.strategies) {
    const persisted = persistedVerdicts.get(strategy.id);
    const candidate = persisted
      ? { feasible: persisted.feasible, rejectionEvidence: persisted.rejectionEvidence, viability: undefined as undefined }
      : await evaluateCandidate(deps.viability, snapshot, strategy);
    const intent = recoveryCase.actionIntents.find((i) => i.strategyId === strategy.id);
    const decision = intent
      ? recoveryCase.authorityDecisions.find((d) => d.intentId === intent.id)
      : undefined;
    const recommended = strategy.id === bestStrategyId;
    const presentation = projectOptionPresentation({
      strategy,
      feasible: candidate.feasible,
      recommended,
      rejectionEvidence: candidate.rejectionEvidence,
      ...(candidate.viability ? { viability: candidate.viability } : {}),
      ...(intent ? { intent } : {}),
      ...(decision ? { decision } : {}),
      ...(recoveryEngagement ? { engagement: recoveryEngagement } : {}),
      places,
      ...(criticalObjectiveAtRisk ? { criticalObjectiveAtRisk } : {}),
      ...(candidate.viability?.softTradeoffs ? { softTradeoffs: candidate.viability.softTradeoffs } : {}),
      searchProvenance: 'REPLAY',
      ...(requiredBufferMinutes !== undefined ? { requiredBufferMinutes } : {}),
    });
    options.push({
      id: strategy.id,
      title: presentStrategyTitle(strategy.summary),
      verdict: candidate.feasible ? 'VIABLE' : candidate.rejectionEvidence.length > 0 ? 'NOT_VIABLE' : 'UNKNOWN',
      ...(candidate.rejectionEvidence.length > 0
        ? { rejectionReason: presentCandidateRejection(candidate.rejectionEvidence, snapshot.constraints) }
        : {}),
      ...(recommended
        ? {
            recommended: true,
            whyRecommended:
              presentation.whyRecommended ??
              'Recommended because it keeps the whole trip viable with the fewest soft tradeoffs among workable options.',
          }
        : {}),
      ...(presentation.summary ? { summary: presentation.summary } : {}),
      ...(presentation.pros ? { pros: presentation.pros } : {}),
      ...(presentation.cons ? { cons: presentation.cons } : {}),
      ...(presentation.commitmentEffect ? { commitmentEffect: presentation.commitmentEffect } : {}),
      ...(presentation.authorityLabel ? { authorityLabel: presentation.authorityLabel } : {}),
      ...(presentation.provenanceLabel ? { provenanceLabel: presentation.provenanceLabel } : {}),
      ...(presentation.flags ? { flags: presentation.flags } : {}),
      // ADR-052: an FX-normalized intent freezes BOTH the home restatement
      // (spendExposure) and the original provider charge (providerSpend); the
      // view shows the restatement as the cost delta and keeps the provider
      // amount visible. Unnormalized strategies keep the raw costImpact.
      ...(intent?.providerSpend && intent.spendExposure
        ? { costDelta: intent.spendExposure, providerCost: intent.providerSpend }
        : strategy.costImpact
          ? { costDelta: strategy.costImpact }
          : {}),
      ...(decision && decision.outcome !== 'AUTO_APPROVED' ? { requiresApproval: true } : {}),
      // Mixed funding (ADR-037): the deterministic allocation persisted on
      // the intent — projected verbatim, never re-derived in the view.
      ...(intent?.costAllocation
        ? {
            costAllocation: intent.costAllocation,
            costAllocationSummary: presentAllocationSummary(intent.costAllocation),
          }
        : {}),
      ...(recommended && candidate.feasible
        ? (() => {
            const wholeTripPlan = projectWholeTripRecoveryPlan({
              trip,
              strategy,
              places,
              ruleSets,
              travellers: evalContext.travellers,
              ...(recoveryEngagement ? { engagement: recoveryEngagement } : {}),
              ...(intent ? { intent } : {}),
              ...(candidate.viability ? { viability: candidate.viability } : {}),
              feasible: candidate.feasible,
            });
            return wholeTripPlan ? { wholeTripPlan } : {};
          })()
        : {}),
    });
  }

  // Case-level funding evidence: the latest intent carrying an allocation.
  const fundedIntents = recoveryCase.actionIntents.filter((i) => i.costAllocation);
  const fundingIntent = fundedIntents[fundedIntents.length - 1];
  const funding =
    fundingIntent?.costAllocation && fundingIntent.priceDelta
      ? {
          allocation: fundingIntent.costAllocation,
          summary: presentAllocationSummary(fundingIntent.costAllocation) ?? 'Funding allocation still unresolved',
        }
      : undefined;

  // Approval requirement from the latest authority decision needing one.
  let approval: ApprovalRequirementView | undefined;
  const requiring = recoveryCase.authorityDecisions.filter((d) => d.outcome !== 'AUTO_APPROVED' && d.outcome !== 'BLOCKED');
  const latestRequiring = requiring[requiring.length - 1];
  if (latestRequiring) {
    const intent = intentForDecision(recoveryCase, latestRequiring);
    // The authority decision records only a principal TYPE. Expose an
    // organisation identity to the UI only when its authoritative scope is
    // unambiguous; a presentation layer must not pick among several valid
    // organisations. Human-agent outcomes deliberately carry no automatic
    // approver at all.
    const organisations =
      latestRequiring.outcome === 'REQUIRES_ORGANISATION_APPROVER' ||
      latestRequiring.outcome === 'REQUIRES_HUMAN_AGENT'
        ? (await principalScopeForTrip({ trips: deps.snapshot.trips, entities: deps.snapshot.entities }, trip.id)).organisations
        : [];
    const organisationApprover = organisations.length === 1 ? organisations[0] : undefined;
    approval = {
      requestedFrom:
        latestRequiring.outcome === 'REQUIRES_TRAVELLER'
          ? 'TRAVELLER'
          : latestRequiring.outcome === 'REQUIRES_ORGANISATION_APPROVER'
            ? 'ORGANISATION'
            : 'HUMAN_AGENT',
      intentId: latestRequiring.intentId,
      // HUMAN_AGENT may be decided by an unambiguous in-scope organisation
      // principal (authority allows ORGANISATION for HUMAN_AGENT).
      ...(organisationApprover ? { approver: { entityType: 'ORGANISATION' as const, id: organisationApprover.id } } : {}),
      reason: presentApprovalReason(
        latestRequiring.outcome === 'REQUIRES_TRAVELLER'
          ? 'TRAVELLER'
          : latestRequiring.outcome === 'REQUIRES_ORGANISATION_APPROVER'
            ? 'ORGANISATION'
            : 'HUMAN_AGENT',
      ),
      // CTA currency must match what the principal actually pays (provider
      // charge). Home-policy restatement stays on option chips, not the button.
      ...(intent?.providerSpend
        ? { amount: intent.providerSpend }
        : intent?.priceDelta
          ? { amount: intent.priceDelta }
          : {}),
      state: latestRequiring.approval
        ? latestRequiring.approval.decision === 'APPROVED'
          ? 'APPROVED'
          : 'DECLINED'
        : 'PENDING',
    };
  }

  // Action progress from persisted intents/execution results.
  const actions: ActionProgressView[] = recoveryCase.actionIntents.map((intent) => {
    const result = recoveryCase.executionResults.find((r) => r.intentId === intent.id);
    const state =
      intent.status === 'EXECUTED'
        ? 'DONE'
        : intent.status === 'EXECUTING'
          ? 'IN_PROGRESS'
          : intent.status === 'FAILED' || intent.status === 'REJECTED'
            ? 'FAILED'
            : 'QUEUED';
    const simulated = result?.provenance === 'SIMULATED';
    return {
      id: intent.id,
      label: `${presentAction(intent.operation)}${simulated ? ' (simulated at provider boundary)' : ''}`,
      state,
    };
  });

  const remainingLosses = (recoveryCase.resolution?.remainingLossRefs ?? [])
    .map((ref) => trip.objectives.find((o) => o.id === ref)?.statement)
    .filter((statement): statement is string => Boolean(statement));

  const isChangeRequest = triggeringSignals.some((s) => s.kind === 'TRAVELLER_INPUT');
  let anchorEvent: AnchorEvent | undefined;
  if (trip.anchorEventId) {
    const entry = await deps.snapshot.entities.get('ANCHOR_EVENT', trip.anchorEventId);
    if (entry?.entityType === 'ANCHOR_EVENT') anchorEvent = entry.entity;
  }
  const chainPresentation = await chainPresentationForCase(deps, {
    trip,
    recoveryCase,
    at,
    places,
    bestStrategyId,
    triggeringSignals,
  });
  const chain = projectCaseChain(trip, recoveryCase, {
    places,
    ...(anchorEvent ? { anchorEvent } : {}),
    presentation: chainPresentation,
  });

  const connectionDisruption =
    !isChangeRequest &&
    assessment.directFailures.some((failure) => {
      const element = trip.elements.find((candidate) => candidate.id === failure.elementId);
      return element?.elementKind === 'TRANSPORT_LEG';
    });
  const recoveryAnalysisSteps = connectionDisruption
    ? wholeTripAnalysisSteps({ trip, places, ruleSets })
    : undefined;

  // Honest "no automated recovery path" end-state: the planning loop has run
  // (the case moved past ASSESSING) yet produced no actionable strategy and
  // the case remains unresolved. Derived from persisted case status only —
  // never from scenario content. The view must say so plainly instead of
  // re-offering a planning action that already completed empty.
  const planningExhausted =
    recoveryCase.status !== 'DETECTED' &&
    recoveryCase.status !== 'ASSESSING' &&
    recoveryCase.strategies.length === 0 &&
    !recoveryCase.resolution;

  const caseStatus = statusFromCase(recoveryCase.status, isChangeRequest);
  const recoveryCommitment = selectRecoveryCommitment(trip, recoveryCase);
  const programmeChangeCommitmentId = recoveryCommitment?.data.anchorCommitmentId;
  // Fixture-keyed programme proposal presets (commitment entity ids from the
  // closed demo world). Presentation only — not person-specific branches.
  const PROGRAMME_CHANGE_PRESETS: Record<string, { startsAt: string; endsAt: string }> = {
    'cmt-ait-d1-headline-interview': {
      startsAt: '2026-10-01T15:30:00+08:00',
      endsAt: '2026-10-01T16:00:00+08:00',
    },
  };
  const programmePreset = programmeChangeCommitmentId
    ? PROGRAMME_CHANGE_PRESETS[programmeChangeCommitmentId]
    : undefined;
  const hardConstraintFailed = evaluations.some((evaluation) => {
    const constraint = constraints.find((candidate) => candidate.id === evaluation.constraintId);
    return constraint?.hardness === 'HARD' && evaluation.status === 'FAIL';
  });
  const travelRecoveryInsufficient =
    hardConstraintFailed ||
    assessment.threatenedObjectives.length > 0 ||
    Boolean(criticalObjectiveAtRisk) ||
    planningExhausted ||
    (options.length === 0 && evaluations.some((evaluation) => evaluation.status === 'FAIL'));
  const programmeChangeAvailable =
    Boolean(trip.anchorEventId && programmeChangeCommitmentId) &&
    recoveryCase.status !== 'RESOLVED' &&
    caseStatus === 'DISRUPTED' &&
    travelRecoveryInsufficient;

  return enrichCaseDetailView(
    {
      caseId: recoveryCase.id,
      tripId: trip.id,
      ...(trip.label ? { tripLabel: trip.label } : {}),
      travellerNames,
      status: caseStatus,
      ...(primaryTriggeringSignal(triggeringSignals) || criticalObjectiveAtRisk
        ? {
            whatChanged: presentDisruptedCaseSummary({
              signal: primaryTriggeringSignal(triggeringSignals),
              criticalObjectiveAtRisk,
              failedCheckLabels: checks.filter((check) => check.result === 'FAIL').map((check) => check.label),
            }),
          }
        : {}),
      affectedItems: recoveryCase.affectedElementIds
        .map((id) => trip.elements.find((element) => element.id === id))
        .filter((element): element is TripElement => Boolean(element))
        .map(describeElement),
      ...(criticalObjectiveAtRisk ? { criticalObjectiveAtRisk } : {}),
      ...(chain && chain.length > 0 ? { chain } : {}),
      checks,
      options,
      ...(approval ? { approval } : {}),
      actions,
      ...(funding ? { funding } : {}),
      uncertainties: presentUncertainties(assessment.unresolvedUnknowns),
      ...(planningExhausted ? { planningExhausted: true } : {}),
      ...(recoveryAnalysisSteps ? { recoveryAnalysisSteps } : {}),
      ...(programmeChangeAvailable
        ? {
            anchorEventId: trip.anchorEventId,
            programmeChangeAvailable: true,
            programmeRecoveryStage: 'travel_analysis' as const,
            ...(programmeChangeCommitmentId ? { programmeChangeCommitmentId } : {}),
            ...(programmePreset
              ? {
                  programmeChangeProposedStartsAt: programmePreset.startsAt,
                  programmeChangeProposedEndsAt: programmePreset.endsAt,
                }
              : {}),
          }
        : trip.anchorEventId
          ? { anchorEventId: trip.anchorEventId }
          : {}),
      ...(recoveryCase.resolution
        ? {
            resolution: {
              outcome: recoveryCase.resolution.outcome,
              summary: presentResolution(recoveryCase.resolution),
              ...(remainingLosses.length > 0 ? { remainingLosses } : {}),
            },
          }
        : {}),
      updatedAt: recoveryCase.updatedAt,
    },
    { recoveryCase, trip, triggeringSignals, places, anchorEvent },
  );
}

// ---------------------------------------------------------------------------
// Traveller view
// ---------------------------------------------------------------------------

export async function projectTravellerTrip(
  deps: ReadModelDependencies,
  tripId: EntityId,
  at: IsoDateTime,
): Promise<TravellerTripView | undefined> {
  const trip = await deps.snapshot.trips.getTrip(tripId);
  if (!trip) return undefined;
  const recoveryCase = await latestCaseFor(deps.cases, tripId);
  const status = await statusForTrip(trip, recoveryCase, deps.signals);

  const signals = await deps.signals.listSignalsForTrip(tripId);
  const lastSignal = signals[signals.length - 1];

  const assessment = await new ImpactEngine({
    trips: deps.snapshot.trips,
    signals: deps.signals,
    entities: deps.snapshot.entities,
  }).assess(tripId);

  let whatMattersNow: string | undefined;
  for (const threatened of assessment.threatenedObjectives) {
    const objective = trip.objectives.find((o) => o.id === threatened.objectiveId);
    if (objective?.hardness === 'HARD') {
      whatMattersNow = objective.statement;
      break;
    }
  }
  if (!whatMattersNow && recoveryCase?.resolution) whatMattersNow = presentResolution(recoveryCase.resolution);
  if (!whatMattersNow) {
    const requiredCommitment = trip.elements.find(
      (element) => element.elementKind === 'ENGAGEMENT' && element.importance === 'REQUIRED',
    );
    if (requiredCommitment?.elementKind === 'ENGAGEMENT') whatMattersNow = requiredCommitment.data.title;
  }

  const actionsInProgress: string[] = [];
  const inputRequested: TravellerInputRequest[] = [];
  if (recoveryCase) {
    for (const intent of recoveryCase.actionIntents) {
      if (intent.status === 'EXECUTED' || intent.status === 'REJECTED' || intent.status === 'FAILED') continue;
      const result = recoveryCase.executionResults.find((r) => r.intentId === intent.id);
      const simulated = result?.provenance === 'SIMULATED';
      actionsInProgress.push(
        `${presentAction(intent.operation)}${simulated ? ' (simulated provider response)' : ''}`,
      );
    }
    for (const decision of pendingApprovalDecisions(recoveryCase)) {
      if (decision.outcome !== 'REQUIRES_TRAVELLER') continue;
      const intent = intentForDecision(recoveryCase, decision);
      if (!intent) continue;
      const currentStay = trip.elements.find((element) => element.elementKind === 'STAY');
      const stayPlaceName =
        currentStay && currentStay.elementKind === 'STAY'
          ? await placeLabel(deps, currentStay.data.placeId)
          : undefined;
      inputRequested.push({
        caseId: recoveryCase.id,
        prompt: presentTravellerDecisionPrompt(recoveryCase, intent, trip, stayPlaceName),
        options: ['Approve', 'Decline'],
      });
    }
  }

  // Remainder viability: deterministic from current constraint evaluations.
  const { constraints, evaluations } = await currentConstraintEvaluations(deps, trip, at);
  const remainderViable = deriveRemainderViability(constraints, evaluations, trip.viability);

  return {
    tripId,
    ...(trip.travellerIds.length === 1 ? { travellerId: trip.travellerIds[0] } : {}),
    status,
    ...(lastSignal ? { whatChanged: presentSignalChange(lastSignal) } : {}),
    ...(whatMattersNow ? { whatMattersNow } : {}),
    actionsInProgress,
    inputRequested,
    remainderViable,
    ...(recoveryCase?.resolution ? { resolutionSummary: presentResolution(recoveryCase.resolution) } : {}),
    updatedAt: recoveryCase ? recoveryCase.updatedAt : trip.updatedAt,
  };
}

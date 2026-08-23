/**
 * I2 — signal pipeline: TripSignal -> validated mutation -> persisted trip
 * version -> deterministic impact -> recovery case lifecycle.
 *
 * Signals never mutate state directly (FR-04): the deterministic mapping
 * below turns a signal into MutationOperations, which only land through the
 * frozen MutationService. Impact assessment then reads the POST-mutation
 * authoritative state; resulting constraint statuses and trip viability are
 * themselves persisted through the same validated path. Every stage is
 * timestamped from signal evidence, never a wall clock.
 */
import type { EntityId, Fact, IsoDateTime } from '../domain/common.ts';
import { EntityIdSchema, IsoDateTimeSchema } from '../domain/common.ts';
import type { Trip } from '../domain/trip.ts';
import { ReservationStateSchema } from '../domain/elements.ts';
import { TripSignalSchema, type TripSignal } from '../operational/signal.ts';
import type { MutationOperation } from '../operational/mutation.ts';
import type { ImpactAssessment } from '../operational/impact.ts';
import type { CaseStatus } from '../operational/case.ts';
import type {
  AuditRepository,
  CaseRepository,
  SignalRepository,
  TripRepository,
} from '../contracts/repositories.ts';
import type { ConstraintEvaluation, MutationService, ValidationIssue } from '../contracts/services.ts';
import type { EntityStore } from '../persistence/entityStore.ts';
import { ImpactEngine, impactProposal } from '../engine/impact.ts';
import { evaluateConstraints } from '../engine/evaluators.ts';
import { buildEvaluationContext } from '../engine/evaluationContext.ts';
import { CaseService } from '../engine/case.ts';
import { constraintsForTrip } from './snapshot.ts';

export interface SignalPipelineDependencies {
  trips: TripRepository;
  signals: SignalRepository;
  entities: EntityStore;
  cases: CaseRepository;
  mutations: MutationService;
  audit: AuditRepository;
}

export interface ProcessedSignal {
  signalId: EntityId;
  tripId: EntityId;
  /** Absent when the signal implies no authoritative state change. */
  mutationProposalId?: EntityId;
  mutationAccepted: boolean;
  appliedOperationCount: number;
  mutationIssues: ValidationIssue[];
  /** Authoritative trip version after mutation + impact persistence. */
  tripVersion: number;
  assessment: ImpactAssessment;
  constraintEvaluations: ConstraintEvaluation[];
  caseId: EntityId;
  caseStatus: CaseStatus;
}

/**
 * Run one signal through the full I2 flow. Deterministic: identical signal +
 * identical persisted state always produce identical outcomes.
 */
export async function processSignal(
  deps: SignalPipelineDependencies,
  input: TripSignal,
): Promise<ProcessedSignal> {
  const signal = TripSignalSchema.parse(input);

  const tripId = signal.tripId ?? (await resolveTripForSubject(deps, signal));
  if (!tripId) {
    throw new Error(`cannot resolve a trip for signal ${signal.id}: no tripId and subject not found in any trip`);
  }

  // 1. Persist the signal itself: the audit chain starts here, and the
  //    impact engine re-reads it from the repository (no memory shortcuts).
  await deps.signals.saveSignal(signal);

  const tripBefore = await mustTrip(deps.trips, tripId);
  const at = signal.receivedAt ?? signal.occurredAt;

  // 2. Deterministic signal -> mutation mapping, applied through the frozen
  //    validated path. Weak evidence produces NO mutation: the impact engine
  //    keeps the element AT_RISK with an unresolved unknown instead.
  const operations = signalMutationOperations(signal, tripBefore);
  let mutationProposalId: EntityId | undefined;
  let mutationAccepted = false;
  let appliedOperationCount = 0;
  let mutationIssues: ValidationIssue[] = [];
  if (operations.length > 0) {
    mutationProposalId = `prop-signal-${signal.id}`;
    const outcome = await deps.mutations.applyProposal({
      id: mutationProposalId,
      origin: 'PROVIDER',
      sourceId: signal.sourceId,
      requestedAt: at,
      rationale: `apply ${signal.kind} signal ${signal.id} to authoritative state`,
      operations,
    });
    mutationAccepted = outcome.accepted;
    appliedOperationCount = outcome.appliedOperationCount;
    mutationIssues = outcome.issues;
  }

  // 3. Impact over the POST-mutation authoritative state (read-only engine).
  const trip = await mustTrip(deps.trips, tripId);
  const impactEngine = new ImpactEngine({ trips: deps.trips, signals: deps.signals, entities: deps.entities });
  const assessment = await impactEngine.assess(tripId, signal.id);

  // 4. Persist resulting constraint statuses + trip viability through the
  //    same mutation path — impact never writes state directly either.
  const constraints = await constraintsForTrip(deps.entities, trip);
  const context = await buildEvaluationContext(deps.entities, trip, assessment.assessedAt);
  const constraintEvaluations = evaluateConstraints(constraints, context);
  const impactOutcome = await deps.mutations.applyProposal(
    impactProposal(assessment, constraints, constraintEvaluations, trip),
  );
  if (!impactOutcome.accepted) {
    const detail = impactOutcome.issues.map((issue) => `${issue.code}: ${issue.message}`).join('; ');
    throw new Error(`impact proposal for signal ${signal.id} rejected: ${detail}`);
  }

  // 5. Recovery case lifecycle: DETECTED -> ASSESSING (frozen transition
  //    table enforced by CaseService). Re-processing an already-open case
  //    for the same signal is a no-op, not a duplicate.
  const caseService = new CaseService({ cases: deps.cases });
  const caseId = `case-${tripId}-${signal.id}`;
  const affectedElementIds = [
    ...assessment.directFailures.map((f) => f.elementId),
    ...assessment.affectedElements.map((a) => a.elementId),
  ];
  const failedConstraintIds = constraintEvaluations
    .filter((evaluation) => evaluation.status === 'FAIL')
    .map((evaluation) => evaluation.constraintId);
  let recoveryCase = await deps.cases.getCase(caseId);
  if (!recoveryCase) {
    recoveryCase = await caseService.open({
      id: caseId,
      tripId,
      openedAt: assessment.assessedAt,
      triggeredBySignalIds: [signal.id],
      affectedElementIds,
      failedConstraintIds,
    });
    recoveryCase = await caseService.transition(caseId, 'ASSESSING', assessment.assessedAt);
  }

  // 6. Audit link: signal -> mutation -> impact -> case, answering both
  //    "what changed?" and "what else does this affect?".
  await deps.audit.append({
    occurredAt: assessment.assessedAt,
    actor: 'app:signal-pipeline',
    action: 'SIGNAL_PROCESSED',
    subject: tripId,
    payload: {
      signalId: signal.id,
      kind: signal.kind,
      authority: signal.authority,
      sourceId: signal.sourceId,
      mutationProposalId,
      mutationAccepted,
      appliedOperationCount,
      impactId: assessment.id,
      severity: assessment.severity,
      directFailureIds: assessment.directFailures.map((f) => f.elementId),
      atRiskIds: assessment.affectedElements.map((a) => a.elementId),
      threatenedObjectiveIds: assessment.threatenedObjectives.map((o) => o.objectiveId),
      irreversibleLossCount: assessment.irreversibleLosses.length,
      unresolvedUnknowns: assessment.unresolvedUnknowns,
      caseId,
    },
  });

  const finalTrip = await mustTrip(deps.trips, tripId);
  return {
    signalId: signal.id,
    tripId,
    mutationProposalId,
    mutationAccepted,
    appliedOperationCount,
    mutationIssues,
    tripVersion: finalTrip.version,
    assessment,
    constraintEvaluations,
    caseId,
    caseStatus: recoveryCase.status,
  };
}

/**
 * Pure, deterministic signal -> operation mapping. Only authoritative or
 * connected evidence changes state; anything weaker leaves state untouched
 * so impact preserves the uncertainty.
 */
export function signalMutationOperations(signal: TripSignal, trip: Trip): MutationOperation[] {
  if (signal.subjectRef?.entityType !== 'TRIP_ELEMENT') return [];
  const element = trip.elements.find((e) => e.id === signal.subjectRef!.id);
  if (!element) return [];
  const observedAt = signal.receivedAt ?? signal.occurredAt;

  switch (signal.kind) {
    case 'FLIGHT_CANCELLATION': {
      if (signal.authority !== 'AUTHORITATIVE' && signal.authority !== 'CONNECTED') return [];
      if (element.reservationState === 'CANCELLED') return [];
      return [
        {
          op: 'UPSERT_ENTITY',
          entityType: 'TRIP_ELEMENT',
          id: element.id,
          data: { ...element, reservationState: 'CANCELLED' },
        },
      ];
    }
    case 'BOOKING_STATE_CHANGE': {
      const parsed = ReservationStateSchema.safeParse(signal.payload['reservationState']);
      if (!parsed.success || parsed.data === element.reservationState) return [];
      return [
        {
          op: 'UPSERT_ENTITY',
          entityType: 'TRIP_ELEMENT',
          id: element.id,
          data: { ...element, reservationState: parsed.data },
        },
      ];
    }
    case 'FLIGHT_SCHEDULE_CHANGE':
    case 'FLIGHT_DELAY': {
      if (element.elementKind !== 'TRANSPORT_LEG') return [];
      const operations: MutationOperation[] = [];
      for (const field of ['scheduledDeparture', 'scheduledArrival'] as const) {
        const parsed = IsoDateTimeSchema.safeParse(signal.payload[field]);
        if (!parsed.success) continue;
        const fact: Fact<IsoDateTime> = {
          value: parsed.data,
          sourceId: signal.sourceId,
          authority: signal.authority,
          observedAt,
        };
        operations.push({
          op: 'UPSERT_FACT',
          target: { entityType: 'TRIP_ELEMENT', id: element.id },
          factPath: `data.${field}`,
          value: fact,
          sourceId: signal.sourceId,
          authority: signal.authority,
        });
      }
      return operations;
    }
    case 'ANCHOR_COMMITMENT_CHANGE': {
      if (element.elementKind !== 'ENGAGEMENT') return [];
      if (signal.authority !== 'AUTHORITATIVE' && signal.authority !== 'CONNECTED') return [];
      if (signal.payload['changeKind'] === 'CANCELLED') {
        if (element.reservationState === 'CANCELLED') return [];
        return [
          {
            op: 'UPSERT_ENTITY',
            entityType: 'TRIP_ELEMENT',
            id: element.id,
            data: { ...element, reservationState: 'CANCELLED' },
          },
        ];
      }
      let data = { ...element.data };
      let changed = false;
      for (const [field, payloadKey] of [['startsAt', 'newStartsAt'], ['endsAt', 'newEndsAt']] as const) {
        const parsed = IsoDateTimeSchema.safeParse(signal.payload[payloadKey]);
        if (!parsed.success) continue;
        const fact: Fact<IsoDateTime> = {
          value: parsed.data,
          sourceId: signal.sourceId,
          authority: signal.authority,
          observedAt,
        };
        data = { ...data, [field]: fact };
        changed = true;
      }
      if (typeof signal.payload['newPlaceId'] === 'string') {
        const parsed = EntityIdSchema.safeParse(signal.payload['newPlaceId']);
        if (parsed.success && parsed.data !== element.data.placeId) {
          data = { ...data, placeId: parsed.data };
          changed = true;
        }
      }
      if (!changed) return [];
      return [
        {
          op: 'UPSERT_ENTITY',
          entityType: 'TRIP_ELEMENT',
          id: element.id,
          data: { ...element, data },
        },
      ];
    }
    default:
      // Signals without a deterministic state implication (weather, operator
      // input, ...) feed assessment/attention only — never guessed mutations.
      return [];
  }
}

/** Locate the trip owning a signal's subject element when tripId is absent. */
async function resolveTripForSubject(
  deps: SignalPipelineDependencies,
  signal: TripSignal,
): Promise<EntityId | undefined> {
  if (signal.subjectRef?.entityType !== 'TRIP_ELEMENT') return undefined;
  for (const summary of await deps.trips.listTrips()) {
    const trip = await deps.trips.getTrip(summary.tripId);
    if (trip?.elements.some((e) => e.id === signal.subjectRef!.id)) return trip.id;
  }
  return undefined;
}

async function mustTrip(trips: TripRepository, tripId: EntityId): Promise<Trip> {
  const trip = await trips.getTrip(tripId);
  if (!trip) throw new Error(`unknown trip ${tripId}`);
  return trip;
}

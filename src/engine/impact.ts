/**
 * A2 — ImpactEngine: deterministic blast-radius assessment (FR-06,
 * ARCHITECTURE.md §9).
 *
 * `assess()` is read-only: it loads authoritative state and returns an
 * ImpactAssessment. Persisting resulting constraint statuses / trip viability
 * goes through the validated mutation path (`impactMutations` + MutationService)
 * so the LLM never touches authoritative state directly.
 *
 * Propagation distinguishes direct failure, affected/at-risk, INVALID,
 * UNKNOWN, threatened objectives and irreversible loss. A hard objective
 * becoming impossible records a LossRecord and NEVER terminates propagation.
 */
import type { EntityId } from '../domain/common.ts';
import { instantMillis } from '../domain/common.ts';
import type { TripElement } from '../domain/elements.ts';
import type { RuleSet } from '../domain/rules.ts';
import type { Constraint, ConstraintStatus } from '../domain/constraints.ts';
import type { Trip } from '../domain/trip.ts';
import type {
  ElementImpact,
  ImpactAssessment,
  LossRecord,
  ObjectiveImpact,
} from '../operational/impact.ts';
import type {
  ImpactService,
} from '../contracts/services.ts';
import type { MutationOperation, MutationProposal } from '../operational/mutation.ts';
import type { TripRepository, SignalRepository } from '../contracts/repositories.ts';
import type { EntityStore } from '../persistence/entityStore.ts';
import { evaluateConstraints, isCancelled, elementStartInstant } from './evaluators.ts';
import { buildEvaluationContext } from './evaluationContext.ts';

export interface ImpactEngineDeps {
  trips: TripRepository;
  signals: SignalRepository;
  entities: EntityStore;
}

export class ImpactEngine implements ImpactService {
  private readonly trips: TripRepository;
  private readonly signals: SignalRepository;
  private readonly entities: EntityStore;

  constructor(deps: ImpactEngineDeps) {
    this.trips = deps.trips;
    this.signals = deps.signals;
    this.entities = deps.entities;
  }

  async assess(tripId: EntityId, signalId?: EntityId): Promise<ImpactAssessment> {
    const trip = await this.trips.getTrip(tripId);
    if (!trip) throw new Error(`unknown trip ${tripId}`);

    const signals = signalId
      ? await this.signals.listSignalsForTrip(tripId).then((all) => all.filter((s) => s.id === signalId))
      : await this.signals.listSignalsForTrip(tripId);
    const trigger = signals[signals.length - 1];

    const assessedAt = trigger?.receivedAt ?? trigger?.occurredAt ?? trip.updatedAt;
    const constraints = (await this.entities.list('CONSTRAINT'))
      .filter((entry) => entry.entityType === 'CONSTRAINT')
      .map((entry) => entry.entity);
    const ctx = await buildEvaluationContext(this.entities, trip, assessedAt);
    const ruleSets = ctx.ruleSets;

    const evaluations = evaluateConstraints(constraints, ctx);
    const statusByConstraint = new Map<string, ConstraintStatus>(
      evaluations.map((e) => [e.constraintId, e.status]),
    );

    const directFailures: ElementImpact[] = [];
    const affectedElements: ElementImpact[] = [];
    const unresolvedUnknowns: string[] = [];

    // 1. Direct failures: cancelled/INVALID elements, plus signal-implied
    //    failures. Strong signal authority makes the failure INVALID; weaker
    //    authority keeps it AT_RISK with an unresolved unknown.
    for (const element of trip.elements) {
      if (isCancelled(element) || element.status === 'INVALID') {
        directFailures.push({
          elementId: element.id,
          resultingStatus: 'INVALID',
          reason: element.reservationState === 'CANCELLED' ? 'reservation cancelled' : 'element INVALID',
        });
      }
    }
    for (const signal of signals) {
      if (signal.kind !== 'FLIGHT_CANCELLATION') continue;
      if (signal.subjectRef?.entityType !== 'TRIP_ELEMENT') continue;
      const subject = trip.elements.find((e) => e.id === signal.subjectRef!.id);
      if (!subject) continue;
      if (directFailures.some((f) => f.elementId === subject.id)) continue;
      // Authoritative post-signal evidence (e.g. an observed rebooking)
      // outranks the cancellation signal; the signal no longer implies failure.
      const signalInstant = signal.receivedAt ?? signal.occurredAt;
      const departureFact =
        subject.elementKind === 'TRANSPORT_LEG' ? subject.data.scheduledDeparture : undefined;
      if (
        departureFact &&
        departureFact.authority === 'AUTHORITATIVE' &&
        instantMillis(departureFact.observedAt) >= instantMillis(signalInstant)
      ) {
        continue;
      }
      if (signal.authority === 'AUTHORITATIVE' || signal.authority === 'CONNECTED') {
        directFailures.push({
          elementId: subject.id,
          resultingStatus: 'INVALID',
          reason: `signal ${signal.id} reports cancellation (${signal.authority})`,
        });
      } else {
        affectedElements.push({
          elementId: subject.id,
          resultingStatus: 'AT_RISK',
          reason: `signal ${signal.id} reports cancellation but evidence is ${signal.authority}`,
        });
        unresolvedUnknowns.push(`cancellation of ${subject.id} not confirmed (${signal.authority})`);
      }
    }

    // 2. Dependency propagation over CONNECTS_TO: INVALID upstream makes
    //    downstream AT_RISK (never blanket INVALID). A hard failure here never
    //    stops traversal. DEPENDS_ON feeds objective threats (step 3), not
    //    element health.
    const failedIds = new Set(directFailures.map((f) => f.elementId));
    const atRiskIds = new Set(affectedElements.map((a) => a.elementId));
    const byId = new Map(trip.elements.map((e) => [e.id, e]));
    const pending = [...failedIds];
    while (pending.length > 0) {
      const currentId = pending.shift()!;
      for (const relation of trip.relations) {
        if (relation.kind !== 'CONNECTS_TO') continue;
        if (relation.from.entityType !== 'TRIP_ELEMENT' || relation.to.entityType !== 'TRIP_ELEMENT') continue;
        if (relation.from.id !== currentId) continue;
        const downstream = byId.get(relation.to.id);
        if (!downstream) continue;
        if (failedIds.has(downstream.id) || atRiskIds.has(downstream.id) || isCancelled(downstream)) continue;
        atRiskIds.add(downstream.id);
        affectedElements.push({
          elementId: downstream.id,
          resultingStatus: 'AT_RISK',
          reason: `connected after failed ${currentId}; arrival chain evidence lost`,
        });
        pending.push(downstream.id);
      }
    }

    // 3. Threatened objectives: linked to (or dependent on) a failed/at-risk
    //    element.
    const threatenedObjectives: ObjectiveImpact[] = [];
    for (const objective of trip.objectives) {
      const linkedHit = objective.linkedElementIds.find((id) => failedIds.has(id) || atRiskIds.has(id));
      if (linkedHit) {
        threatenedObjectives.push({
          objectiveId: objective.id,
          threatened: true,
          reason: `linked element ${linkedHit} is ${failedIds.has(linkedHit) ? 'failed' : 'at risk'}`,
        });
        continue;
      }
      const dependency = trip.relations.find(
        (r) =>
          r.kind === 'DEPENDS_ON' &&
          r.from.entityType === 'TRIP_OBJECTIVE' &&
          r.from.id === objective.id &&
          r.to.entityType === 'TRIP_ELEMENT' &&
          (failedIds.has(r.to.id) || atRiskIds.has(r.to.id)),
      );
      if (dependency && dependency.to.entityType === 'TRIP_ELEMENT') {
        threatenedObjectives.push({
          objectiveId: objective.id,
          threatened: true,
          reason: `depends on ${dependency.to.id} which is ${failedIds.has(dependency.to.id) ? 'failed' : 'at risk'}`,
        });
      }
    }

    // 4. Irreversible losses: HARD objectives whose linked elements are all
    //    failed AND unrecoverable — FIXED bookings, or timed elements whose
    //    moment has already passed. A cancelled-but-changeable leg is still
    //    recoverable. Losses are recorded; propagation continues.
    const irreversibleLosses: LossRecord[] = [];
    for (const objective of trip.objectives) {
      if (objective.hardness !== 'HARD' || objective.linkedElementIds.length === 0) continue;
      const linked = objective.linkedElementIds
        .map((id) => byId.get(id))
        .filter((e): e is TripElement => Boolean(e));
      if (linked.length === 0) continue;
      const allLost = linked.every((e) => {
        if (!failedIds.has(e.id)) return false;
        if (e.flexibility === 'FIXED') return true;
        const start = elementStartInstant(e, assessedAt);
        return start !== undefined && instantMillis(start) <= instantMillis(assessedAt);
      });
      if (allLost) {
        irreversibleLosses.push({
          id: `loss-${objective.id}`,
          description: `objective ${objective.id} (${objective.statement}) can no longer be met`,
          relatedRefs: [objective.id, ...linked.map((e) => e.id)],
          recordedAt: assessedAt,
        });
      }
    }

    // 5. Policy / insurance implications from the rule sets in scope.
    const policyImplications: string[] = [];
    const insuranceImplications: string[] = [];
    for (const constraint of constraints) {
      const status = statusByConstraint.get(constraint.id);
      if (status !== 'FAIL') continue;
      const rule = resolveRule(constraint, ruleSets);
      if (rule?.kind === 'NO_SHOW_CUTOFF') {
        policyImplications.push(`no-show cutoff ${rule.cutoffAt} at risk for ${constraint.id}`);
      }
      if (rule?.kind === 'CANCELLATION_TERMS') {
        policyImplications.push(`cancellation terms (${constraint.id}) failing at assessment time`);
      }
      if (constraint.hardness === 'HARD') {
        policyImplications.push(`hard constraint ${constraint.id} fails`);
      }
    }
    for (const ruleSet of ruleSets.values()) {
      for (const rule of ruleSet.rules) {
        if (rule.kind === 'INSURANCE_COVERAGE') {
          insuranceImplications.push(`rule set ${ruleSet.id} declares insurance coverage (${rule.id})`);
        }
      }
    }

    // 6. Severity. Losses are CRITICAL; direct failure threatening objectives
    //    is HIGH; degraded state without threatened objectives is MEDIUM.
    //
    // PARK-7 (stop-and-ask, REV-C-FIX): severity intentionally ignores hard
    // constraint FAILs that threaten no objective. A hard policy/cutoff
    // failure with no threatened objective therefore caps at MEDIUM. This
    // remains deliberate pending review: changing severity semantics ripples
    // into planning urgency, UI attention ordering and fixture expectations;
    // blast radius is documented in the REV-C-FIX completion report. The
    // hard failures themselves are never lost — they surface in
    // `policyImplications`, constraint statuses, viability, and verification
    // regardless of severity.
    const severity = irreversibleLosses.length > 0
      ? 'CRITICAL'
      : directFailures.length > 0 && threatenedObjectives.length > 0
        ? 'HIGH'
        : directFailures.length > 0 || affectedElements.length > 0
          ? 'MEDIUM'
          : 'LOW';

    return {
      id: `impact-${tripId}${trigger ? `-${trigger.id}` : ''}`,
      tripId,
      triggeredBySignalId: trigger?.id,
      assessedAt,
      severity,
      directFailures,
      affectedElements,
      threatenedObjectives,
      irreversibleLosses,
      affectedTravellerIds: [...trip.travellerIds],
      sharedResourceImpacts: [],
      policyImplications,
      insuranceImplications,
      unresolvedUnknowns,
    };
  }
}

function resolveRule(constraint: Constraint, ruleSets: Map<string, RuleSet>) {
  const pool = constraint.ruleSetId
    ? [...(ruleSets.get(constraint.ruleSetId)?.rules ?? [])]
    : [...ruleSets.values()].flatMap((rs) => rs.rules);
  if (!constraint.derivedFromRuleId) return undefined;
  return pool.find((r) => r.id === constraint.derivedFromRuleId);
}

/**
 * Mutation proposal that persists an assessment's constraint statuses, the
 * derived trip viability AND the assessed irreversible losses. Must go
 * through MutationService — never applied directly to authoritative state.
 *
 * Loss binding (REV-C WP-C3, ADR-033): every assessed irreversible loss maps
 * to exactly one HARD objective (the loss id is `loss-<objectiveId>` and
 * `relatedRefs[0]` is that objective). At assessment time the affected
 * objective is marked LOST through this normal validated mutation path, so
 * the loss has an authoritative home and re-assessment after recovery cannot
 * silently "un-lose" it. The CaseVerifier then requires each lost objective
 * to be explicitly waived/reprioritised before FULLY_RECOVERED is possible.
 * Objectives already waived/reprioritised carry stronger evidence and are
 * left untouched (idempotent on re-assessment).
 */
export function impactProposal(
  assessment: ImpactAssessment,
  constraints: Constraint[],
  evaluations: Array<{ constraintId: EntityId; status: ConstraintStatus }>,
  trip: Trip,
): MutationProposal {
  const statusById = new Map(evaluations.map((e) => [e.constraintId, e.status]));
  const operations: MutationOperation[] = constraints
    .filter((c) => statusById.has(c.id) && statusById.get(c.id) !== c.status)
    .map((c) => ({
      op: 'UPSERT_CONSTRAINT' as const,
      constraint: { ...c, status: statusById.get(c.id)! },
    }));

  // Trip viability BEFORE loss bindings: operations apply sequentially to one
  // working state, and a whole-trip upsert replaces the aggregate — the
  // objective LOST upserts below must land on top of it, never under it.
  const viability =
    assessment.directFailures.length > 0
      ? 'DISRUPTED'
      : assessment.affectedElements.length > 0 || assessment.threatenedObjectives.length > 0
        ? 'AT_RISK'
        : trip.viability;
  if (viability !== trip.viability) {
    operations.push({
      op: 'UPSERT_ENTITY',
      entityType: 'TRIP',
      id: trip.id,
      data: { ...trip, viability },
    });
  }

  for (const loss of assessment.irreversibleLosses) {
    const objectiveId = loss.relatedRefs[0];
    const objective = objectiveId ? trip.objectives.find((o) => o.id === objectiveId) : undefined;
    if (!objective || objective.status !== 'ACTIVE') continue;
    operations.push({
      op: 'UPSERT_ENTITY',
      entityType: 'TRIP_OBJECTIVE',
      id: objective.id,
      data: { ...objective, status: 'LOST' },
    });
  }

  if (operations.length === 0) {
    operations.push({
      op: 'UPSERT_ENTITY',
      entityType: 'TRIP',
      id: trip.id,
      data: trip,
    });
  }
  return {
    id: `prop-impact-${assessment.id}`,
    origin: 'SYSTEM',
    requestedAt: assessment.assessedAt,
    rationale: `persist impact assessment ${assessment.id}`,
    operations,
  };
}

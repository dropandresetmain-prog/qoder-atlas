/**
 * Authoritative Trip viability reconciliation through the validated mutation
 * path (DR-1.2 machinery).
 *
 * Used after verification AND after programme import/promotion so imported
 * trips receive the same deterministic judgement the rest of the engine uses.
 * Never marks VIABLE merely because bookings exist — impact assessment and
 * hard-constraint evaluation decide.
 */
import type { EntityId, IsoDateTime } from '../domain/common.ts';
import type { Constraint } from '../domain/constraints.ts';
import type { Trip } from '../domain/trip.ts';
import type { ImpactAssessment } from '../operational/impact.ts';
import type { MutationService } from '../contracts/services.ts';
import type { TripRepository, SignalRepository } from '../contracts/repositories.ts';
import type { EntityStore } from '../persistence/entityStore.ts';
import { evaluateConstraints } from './evaluators.ts';
import { buildEvaluationContext } from './evaluationContext.ts';
import { ImpactEngine, impactProposal } from './impact.ts';

export type ViabilityReconciliationMode = 'post_verification' | 'baseline';

export interface ViabilityReconciliationDeps {
  trips: TripRepository;
  entities: EntityStore;
  signals: SignalRepository;
  mutations: MutationService;
}

export interface ViabilityReconciliationResult {
  tripId: EntityId;
  /** Viability before reconciliation. */
  previous: Trip['viability'];
  /** Viability after reconciliation (unchanged when evidence is insufficient). */
  next: Trip['viability'];
  /** True when a mutation proposal was accepted. */
  persisted: boolean;
  /** True when baseline mode left UNKNOWN because hard evidence was insufficient. */
  insufficientEvidence: boolean;
}

/**
 * Reconcile one trip's authoritative viability from current validated state.
 *
 * `baseline` mode keeps UNKNOWN when every hard constraint is still UNKNOWN
 * and impact found no determinate failures — genuine insufficiency must not
 * become AT_RISK/VIABLE. `post_verification` always applies the DR-1.2
 * reconcile formula (hard UNKNOWN binds as AT_RISK).
 */
export async function reconcileAuthoritativeTripViability(
  deps: ViabilityReconciliationDeps,
  tripId: EntityId,
  options: {
    mode: ViabilityReconciliationMode;
    evaluatedAt?: IsoDateTime;
    proposalIdPrefix?: string;
  },
): Promise<ViabilityReconciliationResult> {
  const trip = await deps.trips.getTrip(tripId);
  if (!trip) throw new Error(`unknown trip ${tripId}`);

  const impact = new ImpactEngine({
    trips: deps.trips,
    signals: deps.signals,
    entities: deps.entities,
  });
  const assessment = await impact.assess(tripId);
  const evaluatedAt = options.evaluatedAt ?? assessment.assessedAt;

  const tripRefIds = new Set<EntityId>([
    ...trip.elements.map((element) => element.id),
    ...trip.objectives.map((objective) => objective.id),
  ]);
  const constraints = (await deps.entities.list('CONSTRAINT'))
    .filter((entry) => entry.entityType === 'CONSTRAINT')
    .map((entry) => entry.entity)
    .filter((constraint) => constraint.refs.some((ref) => tripRefIds.has(ref.id)));

  const ctx = await buildEvaluationContext(deps.entities, trip, evaluatedAt);
  const evaluations = evaluateConstraints(constraints, ctx);

  if (
    options.mode === 'baseline' &&
    isInsufficientBaselineEvidence(trip, assessment, constraints, evaluations)
  ) {
    return {
      tripId,
      previous: trip.viability,
      next: trip.viability,
      persisted: false,
      insufficientEvidence: true,
    };
  }

  // Re-read after assessment: promotion may have just written the aggregate.
  const current = (await deps.trips.getTrip(tripId)) ?? trip;
  const deterministicInstant = evaluatedAt.replace(/\+/g, '-');
  const prefix = options.proposalIdPrefix ?? `prop-reconcile-${options.mode}`;
  const proposal = impactProposal(assessment, constraints, evaluations, current, {
    reconcileViability: true,
    proposalId: `${prefix}-${tripId}-${deterministicInstant}`,
    requestedAt: evaluatedAt,
  });

  if (proposal.operations.length === 0) {
    return {
      tripId,
      previous: current.viability,
      next: current.viability,
      persisted: false,
      insufficientEvidence: false,
    };
  }

  const outcome = await deps.mutations.applyProposal(proposal);
  const after = (await deps.trips.getTrip(tripId)) ?? current;
  return {
    tripId,
    previous: current.viability,
    next: after.viability,
    persisted: outcome.accepted,
    insufficientEvidence: false,
  };
}

/**
 * Baseline insufficiency: no direct failures, and either (a) every hard
 * constraint is still UNKNOWN, or (b) the trip has no transport/stay evidence
 * to judge. Soft-only / engagement-only state must not become VIABLE or
 * AT_RISK merely because bookings are absent.
 */
function isInsufficientBaselineEvidence(
  trip: Trip,
  assessment: ImpactAssessment,
  constraints: Constraint[],
  evaluations: Array<{ constraintId: EntityId; status: Constraint['status'] }>,
): boolean {
  if (assessment.directFailures.length > 0) return false;
  const hardnessById = new Map(constraints.map((c) => [c.id, c.hardness]));
  const hardEvals = evaluations.filter((e) => hardnessById.get(e.constraintId) === 'HARD');
  const hasDeterminateHard = hardEvals.some((e) => e.status === 'PASS' || e.status === 'FAIL');
  if (hasDeterminateHard) return false;
  const hasTravelEvidence = trip.elements.some(
    (element) => element.elementKind === 'TRANSPORT_LEG' || element.elementKind === 'STAY',
  );
  if (!hasTravelEvidence) return true;
  return hardEvals.length > 0 && hardEvals.every((e) => e.status === 'UNKNOWN');
}

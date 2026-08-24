/**
 * A4 — observation loop (FR-11, FR-15, ARCHITECTURE.md §13).
 *
 * Observation maps execution evidence into VALIDATED state mutations through
 * the MutationService — never a direct write. Provider/API success alone
 * never resolves a RecoveryCase: the verifier re-evaluates viability and the
 * deterministic outcome decides between FULLY_RECOVERED, RECOVERED_WITH_LOSS
 * or looping back into assessment/planning/verification.
 */
import { z } from 'zod';
import type { EntityId, IsoDateTime } from '../domain/common.ts';
import { MutationOperationSchema, type MutationProposal } from '../operational/mutation.ts';
import type { ExecutionResult } from '../operational/intent.ts';
import type { CaseResolution } from '../operational/case.ts';
import type { CaseStatus } from '../operational/case.ts';
import type { ImpactAssessment } from '../operational/impact.ts';
import type {
  MutationOutcome,
  MutationService,
  ObservationOutcome,
  ObservationService,
} from '../contracts/services.ts';
import type { Trip } from '../domain/trip.ts';
import type { Constraint } from '../domain/constraints.ts';
import { evaluateConstraints } from './evaluators.ts';
import { ImpactEngine, impactProposal, type ImpactEngineDeps } from './impact.ts';
import { buildEvaluationContext } from './evaluationContext.ts';

const ObservedOperationsSchema = z.array(MutationOperationSchema);

export class DeterministicObservationService implements ObservationService {
  private readonly mutations: MutationService;

  constructor(deps: { mutations: MutationService }) {
    this.mutations = deps.mutations;
  }

  async observe(result: ExecutionResult): Promise<ObservationOutcome> {
    if (result.status !== 'SUCCESS') {
      return {
        stateUpdated: false,
        appliedOperationCount: 0,
        reevaluationRequested: true,
        suggestedCaseStatus: 'ASSESSING',
      };
    }
    const rawOperations = (result.observedEffects as Record<string, unknown> | undefined)?.['operations'];
    if (rawOperations === undefined) {
      return {
        stateUpdated: false,
        appliedOperationCount: 0,
        reevaluationRequested: true,
        suggestedCaseStatus: 'VERIFYING',
      };
    }
    const parsed = ObservedOperationsSchema.safeParse(rawOperations);
    if (!parsed.success) {
      // Malformed provider effects fail safe: nothing mutates, re-plan.
      return {
        stateUpdated: false,
        appliedOperationCount: 0,
        reevaluationRequested: true,
        suggestedCaseStatus: 'ASSESSING',
      };
    }
    if (parsed.data.length === 0) {
      return {
        stateUpdated: false,
        appliedOperationCount: 0,
        reevaluationRequested: true,
        suggestedCaseStatus: 'VERIFYING',
      };
    }
    const proposal: MutationProposal = {
      id: `prop-observe-${result.id}`,
      origin: 'PROVIDER',
      sourceId: result.providerId ?? `exec:${result.id}`,
      requestedAt: result.executedAt,
      rationale: `observation of execution ${result.id} (${result.provenance})`,
      operations: parsed.data,
    };
    const outcome = await this.mutations.applyProposal(proposal);
    return {
      stateUpdated: outcome.accepted,
      appliedOperationCount: outcome.appliedOperationCount,
      reevaluationRequested: true,
      suggestedCaseStatus: outcome.accepted ? 'VERIFYING' : 'ASSESSING',
    };
  }
}

export interface VerificationResult {
  suggestedCaseStatus: CaseStatus;
  /** Present only when viability evidence supports resolving the case. */
  resolution?: CaseResolution;
  hardFailureIds: EntityId[];
  hardUnknownIds: EntityId[];
  remainingLossRefs: EntityId[];
}

/**
 * Deterministic resolution verifier. FULLY_RECOVERED requires no direct
 * failures, no hard constraint FAIL/UNKNOWN, no recorded objective loss AND
 * no assessed irreversible loss left unacknowledged. RECOVERED_WITH_LOSS
 * requires the same viability except for explicitly waived/reprioritised
 * objectives or assessed LOST objectives (recorded loss evidence). Anything
 * less loops back into the lifecycle — success alone never resolves.
 *
 * DR-1.2: when constructed with a MutationService, a resolution also
 * reconciles the AUTHORITATIVE Trip aggregate viability through the normal
 * validated mutation path — a resolved RecoveryCase can no longer leave the
 * trip stale at DISRUPTED. Reconciliation runs only after observation has
 * applied execution evidence and verification passes; provider success alone
 * never flips the aggregate. Without a MutationService (unit harnesses) the
 * verifier stays read-only.
 */
export class CaseVerifier {
  private readonly impact: ImpactEngine;
  private readonly trips: ImpactEngineDeps['trips'];
  private readonly entities: ImpactEngineDeps['entities'];
  private readonly mutations?: MutationService;

  constructor(deps: ImpactEngineDeps & { mutations?: MutationService }) {
    this.impact = new ImpactEngine(deps);
    this.trips = deps.trips;
    this.entities = deps.entities;
    this.mutations = deps.mutations;
  }

  /**
   * Verify post-execution state. Constraints are evaluated with the full
   * generic EvaluationContext shape shared with impact/viability
   * (buildEvaluationContext populates places, travellers, rule sets and the
   * anchor event) at the verification instant — the execution moment when
   * supplied, not the original assessment instant (PL-4). Truthfully, the
   * current evaluator vocabulary reads the trip and its rule sets from that
   * context; places/travellers/anchor event are carried so evaluators that
   * need them never degrade to UNKNOWN for a thin context, not because every
   * evaluator consumes them today (PARK-3: deriving new evidence, e.g.
   * accessibility requirements from traveller profiles, is logged scope, not
   * implemented behaviour).
   */
  async verify(tripId: EntityId, verifiedAt?: IsoDateTime): Promise<VerificationResult> {
    const assessment = await this.impact.assess(tripId);
    const tripRecord = await this.impactTrip(tripId);
    // Trip-scoped constraints: only those whose refs point at this trip's
    // elements or objectives. Constraints from other trips must not affect
    // this trip's verification (generic ref matching, no scenario knowledge).
    const tripRefIds = new Set<EntityId>([
      ...tripRecord.elements.map((element) => element.id),
      ...tripRecord.objectives.map((objective) => objective.id),
    ]);
    const constraints = (await this.entities.list('CONSTRAINT'))
      .filter((entry) => entry.entityType === 'CONSTRAINT')
      .map((entry) => entry.entity)
      .filter((constraint) => constraint.refs.some((ref) => tripRefIds.has(ref.id)));
    const evaluatedAt = verifiedAt ?? assessment.assessedAt;
    const ctx = await buildEvaluationContext(this.entities, tripRecord, evaluatedAt);
    const evaluations = evaluateConstraints(constraints, ctx);
    const hardnessById = new Map<string, Constraint['hardness']>(constraints.map((c) => [c.id, c.hardness]));
    const hardFailureIds = evaluations
      .filter((e) => hardnessById.get(e.constraintId) === 'HARD' && e.status === 'FAIL')
      .map((e) => e.constraintId);
    const hardUnknownIds = evaluations
      .filter((e) => hardnessById.get(e.constraintId) === 'HARD' && e.status === 'UNKNOWN')
      .map((e) => e.constraintId);

    if (assessment.directFailures.length > 0 || hardFailureIds.length > 0) {
      return {
        suggestedCaseStatus: 'PLANNING',
        hardFailureIds,
        hardUnknownIds,
        remainingLossRefs: [],
      };
    }
    if (hardUnknownIds.length > 0) {
      return { suggestedCaseStatus: 'VERIFYING', hardFailureIds, hardUnknownIds, remainingLossRefs: [] };
    }
    // Recorded loss evidence (REV-C WP-C3, ADR-033): waived/reprioritised
    // objectives PLUS objectives the impact assessment marked LOST. A loss
    // assessed at disruption time survives recovery of the remainder — the
    // re-assessment no longer reports it once the element is repaired, so the
    // persisted LOST status is what keeps resolution honest. An assessed loss
    // whose objective somehow carries no persisted evidence is included from
    // the current assessment as well: FULLY_RECOVERED is never returned while
    // any irreversible loss stands unacknowledged.
    const remainingLossRefs: EntityId[] = [];
    for (const objective of tripRecord.objectives) {
      if (objective.status === 'WAIVED' || objective.status === 'REPRIORITY' || objective.status === 'LOST') {
        remainingLossRefs.push(objective.id);
      }
    }
    for (const loss of assessment.irreversibleLosses) {
      const objectiveId = loss.relatedRefs[0];
      if (objectiveId && !remainingLossRefs.includes(objectiveId)) remainingLossRefs.push(objectiveId);
    }
    const outcome = remainingLossRefs.length > 0 ? 'RECOVERED_WITH_LOSS' : 'FULLY_RECOVERED';
    // DR-1.2: reconciliation happens only on a resolution outcome and through
    // the validated mutation path. The verification result stands regardless
    // of whether the reconciliation proposal is accepted (audit-only refusal).
    await this.reconcileTripViability(tripId, assessment, constraints, evaluations, evaluatedAt);
    return {
      suggestedCaseStatus: 'RESOLVED',
      resolution: {
        outcome,
        resolvedAt: evaluatedAt,
        summary: `viability re-evaluated at ${evaluatedAt}: ${outcome}`,
        remainingLossRefs,
      },
      hardFailureIds,
      hardUnknownIds,
      remainingLossRefs,
    };
  }

  private async impactTrip(tripId: EntityId): Promise<Trip> {
    const trip = await this.trips.getTrip(tripId);
    if (!trip) throw new Error(`unknown trip ${tripId}`);
    return trip;
  }

  /**
   * Persist the authoritative Trip aggregate viability derived from the
   * verification evidence (DR-1.2). Deterministic proposal id/instant:
   * identical verification evidence yields an identical proposal. Rejected
   * proposals never alter the verification outcome — the read model and the
   * aggregate stay auditable, never silently overridden.
   */
  private async reconcileTripViability(
    tripId: EntityId,
    assessment: ImpactAssessment,
    constraints: Constraint[],
    evaluations: Array<{ constraintId: EntityId; status: Constraint['status'] }>,
    evaluatedAt: IsoDateTime,
  ): Promise<void> {
    if (!this.mutations) return;
    // Re-read the aggregate NOW: observation evidence applied moments ago
    // must be inside the reconciliation payload, or the whole-trip upsert
    // would collide with the fact-authority ladder it is meant to respect.
    const tripRecord = await this.impactTrip(tripId);
    // EntityId-safe: ISO offsets carry '+' which the id pattern rejects.
    const deterministicInstant = evaluatedAt.replace(/\+/g, '-');
    const proposal = impactProposal(assessment, constraints, evaluations, tripRecord, {
      reconcileViability: true,
      proposalId: `prop-reconcile-${tripId}-${deterministicInstant}`,
      requestedAt: evaluatedAt,
    });
    if (proposal.operations.length === 0) return;
    const outcome: MutationOutcome = await this.mutations.applyProposal(proposal);
    if (!outcome.accepted) {
      // Audit-only: reconciliation refusal is evidence, not a verification fault.
    }
  }
}

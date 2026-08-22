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
import type {
  MutationService,
  ObservationOutcome,
  ObservationService,
} from '../contracts/services.ts';
import type { Trip } from '../domain/trip.ts';
import type { Constraint } from '../domain/constraints.ts';
import { evaluateConstraints } from './evaluators.ts';
import { ImpactEngine, type ImpactEngineDeps } from './impact.ts';
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
 * failures, no hard constraint FAIL/UNKNOWN and no recorded objective loss.
 * RECOVERED_WITH_LOSS requires the same viability except for explicitly
 * waived/reprioritised objectives (recorded loss evidence). Anything less
 * loops back into the lifecycle — success alone never resolves.
 */
export class CaseVerifier {
  private readonly impact: ImpactEngine;
  private readonly trips: ImpactEngineDeps['trips'];
  private readonly entities: ImpactEngineDeps['entities'];

  constructor(deps: ImpactEngineDeps) {
    this.impact = new ImpactEngine(deps);
    this.trips = deps.trips;
    this.entities = deps.entities;
  }

  /**
   * Verify post-execution state. Constraints evaluate with the SAME full
   * generic context the impact engine uses (places, travellers, rule sets,
   * anchor event) and at the verification instant — the execution moment
   * when supplied, not the original assessment instant (PL-4).
   */
  async verify(tripId: EntityId, verifiedAt?: IsoDateTime): Promise<VerificationResult> {
    const assessment = await this.impact.assess(tripId);
    const constraints = (await this.entities.list('CONSTRAINT'))
      .filter((entry) => entry.entityType === 'CONSTRAINT')
      .map((entry) => entry.entity);
    const tripRecord = await this.impactTrip(tripId);
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
    const remainingLossRefs = tripRecord.objectives
      .filter((o) => o.status === 'WAIVED' || o.status === 'REPRIORITY')
      .map((o) => o.id);
    const outcome = remainingLossRefs.length > 0 ? 'RECOVERED_WITH_LOSS' : 'FULLY_RECOVERED';
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
}

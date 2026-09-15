/**
 * NORTHSTAR M7 — candidate evaluation through the M6 registry.
 *
 * There is no planner-specific viability engine. Overlay worlds are projected
 * with the same effectiveItinerary helpers and assessed with createM6Registry().
 * Whole-strategy viability considers every affected Journey reached through
 * registered dependency semantics on the proposed world.
 */
import { randomUUID } from 'node:crypto';
import type { TypedRef } from '../../domain/v2/shared/identity.ts';
import type { Instant } from '../../domain/v2/shared/time.ts';
import { typedConflict, type TypedResult, ok, conflict } from '../../domain/v2/shared/errors.ts';
import type { AssessmentResult } from '../../contracts/v2/assessment/assessmentManifest.ts';
import type { ScenarioChange } from '../../contracts/v2/scenario/scenarioChange.ts';
import {
  RecoveryStrategySchema,
  strategyViabilityFromSubjectVerdicts,
  type RecoveryStrategy,
  type StrategyAssumption,
  type RequiredUnknown,
} from '../../contracts/v2/scenario/recoveryStrategy.ts';
import type { WorldSnapshotManifest } from '../../contracts/v2/scope/readScope.ts';
import { assessSubject, type EvaluatorRegistry } from '../evaluation/assess.ts';
import { createM6Registry } from '../evaluation/registry.ts';
import { computeClosure, refKey } from '../impact/closure.ts';
import { projectEffectiveWorld } from '../world/effectiveItinerary.ts';
import type { CapturedWorld } from '../world/world.ts';
import { assessManifestCurrentness, type CurrentState } from '../world/currentness.ts';
import { applyScenarioOverlay, type ResolvedOffer } from './overlay.ts';

export interface EvaluateStrategyInput {
  recoveryCaseId: string;
  strategyId?: string;
  strategyVersion?: number;
  baseWorld: CapturedWorld;
  baseManifest: WorldSnapshotManifest;
  basisAssessmentId: string;
  scenarioChange: ScenarioChange;
  now: Instant;
  /** Optional; defaults to the sole M6 registry. */
  registry?: EvaluatorRegistry;
  resolvedOffers?: readonly ResolvedOffer[];
  assumptions?: readonly StrategyAssumption[];
  requiredUnknowns?: readonly RequiredUnknown[];
  /**
   * When provided, the base manifest is checked for currentness before
   * evaluation. A stale base yields STALE_BASE and does not compile.
   */
  currentState?: CurrentState;
}

export interface EvaluateStrategyResult {
  strategy: RecoveryStrategy;
  proposedWorld: CapturedWorld;
  /** True when baseWorld JSON equals the pre-overlay snapshot (canonical untouched). */
  canonicalUntouched: boolean;
}

function journeySubjectsToAssess(world: CapturedWorld, seeds: readonly TypedRef[]): TypedRef[] {
  const closure = computeClosure({ causes: [...seeds], edges: world.edges });
  const journeys = new Map<string, TypedRef>();
  for (const seed of seeds) {
    if (seed.kind === 'JOURNEY') journeys.set(refKey(seed), seed);
  }
  for (const reached of closure.reached) {
    if (reached.subject.kind === 'JOURNEY') journeys.set(refKey(reached.subject), reached.subject);
  }
  // Also include journeys of travellers affected via programme participation seeds.
  for (const seed of seeds) {
    if (seed.kind === 'TRAVELLER') {
      for (const j of world.journeys.filter((jj) => jj.travellerId === seed.id)) {
        journeys.set(refKey({ kind: 'JOURNEY', id: j.id }), { kind: 'JOURNEY', id: j.id });
      }
    }
    if (seed.kind === 'PROGRAMME_ITEM') {
      for (const p of world.participations.filter((x) => x.programmeItemId === seed.id)) {
        for (const j of world.journeys.filter((jj) => jj.travellerId === p.travellerId)) {
          journeys.set(refKey({ kind: 'JOURNEY', id: j.id }), { kind: 'JOURNEY', id: j.id });
        }
      }
    }
  }
  // Fallback: if no journey resolved, assess every journey in the proposed world focus.
  if (journeys.size === 0) {
    for (const j of world.journeys) {
      journeys.set(refKey({ kind: 'JOURNEY', id: j.id }), { kind: 'JOURNEY', id: j.id });
    }
  }
  return [...journeys.values()].sort((a, b) => refKey(a).localeCompare(refKey(b)));
}

/**
 * Build and evaluate an immutable RecoveryStrategy version against an isolated
 * overlay world using the M6 evaluator registry.
 */
export function evaluateRecoveryStrategy(input: EvaluateStrategyInput): TypedResult<EvaluateStrategyResult> {
  const baseSnapshot = structuredClone(input.baseWorld);

  if (input.currentState) {
    const currentness = assessManifestCurrentness(input.baseManifest, input.currentState, input.now);
    if (!currentness.current) {
      const strategy = RecoveryStrategySchema.parse({
        id: input.strategyId ?? randomUUID(),
        recoveryCaseId: input.recoveryCaseId,
        strategyVersion: input.strategyVersion ?? 1,
        status: 'REJECTED',
        baseManifest: input.baseManifest,
        basisAssessmentId: input.basisAssessmentId,
        affectedSubjectRefs: input.scenarioChange.affectedSubjectRefs,
        scenarioChange: input.scenarioChange,
        assumptions: [...(input.assumptions ?? [])],
        requiredUnknowns: [...(input.requiredUnknowns ?? [])],
        candidateAssessments: [],
        candidateAssessmentResults: [],
        viability: 'STALE_BASE',
        requiredAuthorityScopes: [],
        createdAt: input.now,
        evaluatedAt: input.now,
        rejectionReason: `base manifest is stale: ${currentness.reasons.map((r) => r.kind).join(',')}`,
      });
      return ok({ strategy, proposedWorld: input.baseWorld, canonicalUntouched: true });
    }
  }

  const overlay = applyScenarioOverlay({
    baseWorld: input.baseWorld,
    scenarioChange: input.scenarioChange,
    resolvedOffers: input.resolvedOffers,
  });
  if (!overlay.ok) return overlay;

  const registry = input.registry ?? createM6Registry();
  const proposedWorld = overlay.value.proposedWorld;
  // Ensure focus includes affected subjects so impact paths remain meaningful.
  proposedWorld.focus = [
    ...new Map(
      [...proposedWorld.focus, ...overlay.value.affectedSubjectRefs].map((r) => [refKey(r), r] as const),
    ).values(),
  ];

  const effective = projectEffectiveWorld(proposedWorld);
  const subjects = journeySubjectsToAssess(proposedWorld, overlay.value.affectedSubjectRefs);
  const results: AssessmentResult[] = [];
  for (const subject of subjects) {
    const { result } = assessSubject({
      registry,
      world: proposedWorld,
      effective,
      subject,
      now: input.now,
      assessmentId: randomUUID(),
      kind: 'VIABILITY',
    });
    results.push(result);
  }

  const unknowns = [...(input.requiredUnknowns ?? [])];
  const viability = strategyViabilityFromSubjectVerdicts(
    results.map((r) => r.overallVerdict),
    unknowns.length,
  );

  const strategy = RecoveryStrategySchema.parse({
    id: input.strategyId ?? randomUUID(),
    recoveryCaseId: input.recoveryCaseId,
    strategyVersion: input.strategyVersion ?? 1,
    status: viability === 'VIABLE' ? 'EVALUATED' : 'REJECTED',
    baseManifest: input.baseManifest,
    basisAssessmentId: input.basisAssessmentId,
    affectedSubjectRefs: overlay.value.affectedSubjectRefs,
    scenarioChange: input.scenarioChange,
    assumptions: [...(input.assumptions ?? [])],
    requiredUnknowns: unknowns,
    candidateAssessments: results.map((r) => ({
      subjectRef: r.subjects[0]!.subjectRef,
      assessmentId: r.id,
      overallVerdict: r.overallVerdict,
    })),
    candidateAssessmentResults: results,
    viability,
    requiredAuthorityScopes: overlay.value.requiredAuthorityScopes,
    createdAt: input.now,
    evaluatedAt: input.now,
    ...(viability === 'VIABLE'
      ? {}
      : {
          rejectionReason:
            viability === 'NOT_EXECUTABLE'
              ? 'candidate assessment is UNKNOWN or required unknowns remain; UNKNOWN is not executable viability'
              : 'candidate assessment failed mandatory constraints for one or more affected subjects',
        }),
  });

  const canonicalUntouched = JSON.stringify(baseSnapshot) === JSON.stringify(input.baseWorld);
  if (!canonicalUntouched) {
    return conflict(typedConflict('VALIDATION_FAILED', 'canonical world was mutated during candidate evaluation'));
  }

  return ok({ strategy, proposedWorld, canonicalUntouched });
}

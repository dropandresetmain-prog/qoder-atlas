/**
 * NORTHSTAR M7 — candidate evaluation through the M6 registry.
 *
 * There is no planner-specific viability engine. Overlay worlds are projected
 * with the same effectiveItinerary helpers and assessed with createM6Registry().
 * Reached subjects (registered dependency closure + programme participation)
 * are reassessed on both the un-overlaid captured world and the overlay;
 * viability is the comparison, not "every reached subject is PASS".
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
  type StrategySubjectVerdict,
  type StrategyViabilityDecision,
} from '../../contracts/v2/scenario/recoveryStrategy.ts';
import type { WorldSnapshotManifest } from '../../contracts/v2/scope/readScope.ts';
import { assessSubject, type EvaluatorRegistry } from '../evaluation/assess.ts';
import { createM6Registry } from '../evaluation/registry.ts';
import { computeClosure, refKey } from '../impact/closure.ts';
import { projectEffectiveWorld } from '../world/effectiveItinerary.ts';
import type { CapturedWorld } from '../world/world.ts';
import { assessManifestCurrentness, type CurrentState } from '../world/currentness.ts';
import { applyScenarioOverlay, type ResolvedOffer, type ResolvedStayOffer } from './overlay.ts';

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
  /** Candidate-only stay quotes, separately typed so transport offers stay transport-only. */
  resolvedStayOffers?: readonly ResolvedStayOffer[];
  assumptions?: readonly StrategyAssumption[];
  requiredUnknowns?: readonly RequiredUnknown[];
  /**
   * When provided, the base manifest is checked for currentness before
   * evaluation. A stale base yields STALE_BASE and does not compile.
   */
  currentState?: CurrentState;
  /**
   * Subjects whose blocking recovery condition this candidate must resolve
   * (typically the case's currently FAIL JOURNEY/TRIP subjects). When omitted,
   * overlay-affected JOURNEY/TRIP subjects that FAIL on the un-overlaid world
   * must become PASS.
   */
  resolveSubjectRefs?: readonly TypedRef[];
}

export interface EvaluateStrategyResult {
  strategy: RecoveryStrategy;
  proposedWorld: CapturedWorld;
  /** True when baseWorld JSON equals the pre-overlay snapshot (canonical untouched). */
  canonicalUntouched: boolean;
  /** Same subjects assessed on the un-overlaid captured world. */
  baselineAssessments: RecoveryStrategy['candidateAssessments'];
  /** Closed-code vetoes that produced `strategy.viability`. Empty when VIABLE. */
  viabilityDecisions: StrategyViabilityDecision[];
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

function explicitResolveSubjects(input: EvaluateStrategyInput): TypedRef[] {
  const named = input.resolveSubjectRefs;
  if (!named || named.length === 0) return [];
  const out = new Map<string, TypedRef>();
  for (const ref of named) {
    if (ref.kind === 'JOURNEY' || ref.kind === 'TRIP') out.set(refKey(ref), ref);
  }
  return [...out.values()];
}

function assessSubjects(params: {
  registry: EvaluatorRegistry;
  world: CapturedWorld;
  subjects: readonly TypedRef[];
  now: Instant;
}): AssessmentResult[] {
  const effective = projectEffectiveWorld(params.world);
  const results: AssessmentResult[] = [];
  for (const subject of params.subjects) {
    const { result } = assessSubject({
      registry: params.registry,
      world: params.world,
      effective,
      subject,
      now: params.now,
      assessmentId: randomUUID(),
      kind: 'VIABILITY',
    });
    results.push(result);
  }
  return results;
}

function summaryOf(result: AssessmentResult) {
  return {
    subjectRef: result.subjects[0]!.subjectRef,
    assessmentId: result.id,
    overallVerdict: result.overallVerdict,
  };
}

function rejectionReasonFor(viability: RecoveryStrategy['viability']): string | undefined {
  if (viability === 'NOT_EXECUTABLE') {
    return 'candidate assessment is UNKNOWN or required unknowns remain; UNKNOWN is not executable viability';
  }
  if (viability === 'NOT_VIABLE') {
    return 'candidate assessment failed mandatory constraints for one or more affected subjects';
  }
  return undefined;
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
      return ok({ strategy, proposedWorld: input.baseWorld, canonicalUntouched: true, baselineAssessments: [], viabilityDecisions: [] });
    }
  }

  const overlay = applyScenarioOverlay({
    baseWorld: input.baseWorld,
    scenarioChange: input.scenarioChange,
    resolvedOffers: input.resolvedOffers,
    resolvedStayOffers: input.resolvedStayOffers,
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

  const explicitResolve = explicitResolveSubjects(input);
  const subjects = journeySubjectsToAssess(proposedWorld, [...overlay.value.affectedSubjectRefs, ...explicitResolve]);
  const results = assessSubjects({ registry, world: proposedWorld, subjects, now: input.now });
  const baselineResults = assessSubjects({ registry, world: input.baseWorld, subjects, now: input.now });
  const baselineBySubject = new Map(baselineResults.map((r) => [refKey(r.subjects[0]!.subjectRef), r]));

  const overlayResolveKeys = new Set(
    overlay.value.affectedSubjectRefs
      .filter((r) => r.kind === 'JOURNEY' || r.kind === 'TRIP')
      .map((r) => refKey(r)),
  );
  const explicitKeys = new Set(explicitResolve.map((r) => refKey(r)));
  const unknowns = [...(input.requiredUnknowns ?? [])];
  const pairs: StrategySubjectVerdict[] = results.map((r) => {
    const subjectRef = r.subjects[0]!.subjectRef;
    const key = refKey(subjectRef);
    const baseline = baselineBySubject.get(key)?.overallVerdict;
    const mustPass = explicitKeys.size > 0
      ? explicitKeys.has(key)
      : overlayResolveKeys.has(key) && baseline === 'FAIL';
    return { subjectRef, baseline, candidate: r.overallVerdict, mustPass };
  });
  const assessedKeys = new Set(pairs.map((p) => refKey(p.subjectRef as TypedRef)));
  const decisionsExtra: StrategyViabilityDecision[] = [];
  for (const ref of explicitResolve) {
    if (!assessedKeys.has(refKey(ref))) {
      decisionsExtra.push({ code: 'MISSING_MUST_PASS_SUBJECT', subjectRef: ref });
    }
  }
  const compared = strategyViabilityFromSubjectVerdicts(pairs, unknowns.length);
  const viabilityDecisions = [...compared.decisions, ...decisionsExtra];
  const viability = decisionsExtra.length > 0 && compared.viability === 'VIABLE'
    ? 'NOT_EXECUTABLE'
    : compared.viability;

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
    candidateAssessments: results.map(summaryOf),
    candidateAssessmentResults: results,
    viability,
    requiredAuthorityScopes: overlay.value.requiredAuthorityScopes,
    createdAt: input.now,
    evaluatedAt: input.now,
    ...(viability === 'VIABLE' ? {} : { rejectionReason: rejectionReasonFor(viability) }),
  });

  const canonicalUntouched = JSON.stringify(baseSnapshot) === JSON.stringify(input.baseWorld);
  if (!canonicalUntouched) {
    return conflict(typedConflict('VALIDATION_FAILED', 'canonical world was mutated during candidate evaluation'));
  }

  return ok({
    strategy,
    proposedWorld,
    canonicalUntouched,
    baselineAssessments: baselineResults.map(summaryOf),
    viabilityDecisions,
  });
}

/**
 * NORTHSTAR R1 — decision-evidence assembly (freeze C5/C7).
 *
 * This module is the PURE bridge between what RC-6 already produces
 * (`evaluateRecoveryStrategy` -> `EvaluateStrategyResult`, plus the M6
 * dependency closure) and the bounded, immutable decision evidence a
 * `RecoveryPlanningAttempt` persists. It adds NO viability semantics of its
 * own: it only re-projects deterministic evaluator output into the three FROZEN
 * impact semantics (C7) and the material-candidate evidence (C5), then
 * validates the assembled record against the contract schema.
 *
 * Why this is pure and Cloud-verifiable: every input is data the evaluator and
 * closure already return. There is no PostgreSQL, no provider, no model and no
 * scenario branch here. The concrete coordinator (lane P) calls it; the
 * persistence repository (lane E) stores exactly what it returns.
 *
 * The three projections stay SEPARATE end to end (freeze §"THREE IMPACT
 * SEMANTICS"):
 *   A. immediateChangeBlastRadius — from the validated ScenarioChange effects +
 *      affectedSubjectRefs (what the proposal itself touches).
 *   B. reassessmentClosure        — the subjects RC-6 actually reevaluated
 *      (candidate assessments), which may be much broader than A.
 *   C. outcomeDelta               — per-subject baseline -> candidate verdict
 *      captured at decision time, conservatively classified.
 */
import type { TypedRef } from '../../domain/v2/shared/identity.ts';
import type { ScenarioEffect } from '../../contracts/v2/scenario/scenarioChange.ts';
import type {
  RecoveryStrategy,
  StrategyViabilityDecision,
  SubjectAssessmentSummary,
} from '../../contracts/v2/scenario/recoveryStrategy.ts';
import type { EvaluateStrategyResult } from '../scenarios/evaluate.ts';
import { refKey } from '../impact/closure.ts';
import {
  buildImmediateChangeBlastRadius,
  buildOutcomeDelta,
  type ImmediateChangeBlastRadius,
  type OutcomeDeltaEntry,
  type ReassessmentClosure,
} from '../../contracts/v2/planning/impactSemantics.ts';
import {
  RecoveryPlanningAttemptSchema,
  MaterialCandidateEvidenceSchema,
  type MaterialCandidateDisposition,
  type MaterialCandidateEvidence,
  type MaterialCandidateCostComparison,
  type MaterialCandidateProposal,
  type PlanningEvidenceRecord,
  type PlanningModelActivity,
  type RecoveryDomainDecision,
  type RecoveryDomainId,
  type RecoveryPlanningAttempt,
  type StrategyRecommendation,
} from '../../contracts/v2/planning/index.ts';
import type { SubjectId } from '../../domain/v2/shared/identity.ts';
import type { Instant } from '../../domain/v2/shared/time.ts';
import type { WorldSnapshotManifest } from '../../contracts/v2/scope/readScope.ts';

/**
 * The object(s) one validated ScenarioEffect directly modifies, as typed refs.
 * This is a STRUCTURAL projection over the closed `effectKind` union — not a
 * scenario branch: each effect kind names the subjects it writes by
 * construction, and a new effect kind must extend this mapping (compile-time
 * exhaustiveness) rather than reach canonical state some other way.
 */
export function effectChangedRefs(effect: ScenarioEffect): TypedRef[] {
  switch (effect.effectKind) {
    case 'SELECT_OFFER':
      return [
        { kind: 'JOURNEY_ITEM', id: effect.journeyItemId },
        { kind: 'OFFER', id: effect.offerId },
      ];
    case 'ADD_JOURNEY_STAY':
      // The proposed item id is correlation-only until external observation;
      // the existing Journey and captured offer are the meaningful subjects.
      return [
        { kind: 'JOURNEY', id: effect.journeyId },
        { kind: 'OFFER', id: effect.offerId },
      ];
    case 'CANCEL_STAY':
      return [
        { kind: 'JOURNEY_ITEM', id: effect.journeyItemId },
        { kind: 'RESERVATION_LINE', id: effect.reservationLineId },
      ];
    case 'PROPOSE_ALLOCATION': {
      const refs: TypedRef[] = [
        { kind: 'RESERVATION_LINE', id: effect.reservationLineId },
        { kind: 'TRAVELLER', id: effect.travellerId },
      ];
      if (effect.journeyItemId !== undefined) {
        refs.push({ kind: 'JOURNEY_ITEM', id: effect.journeyItemId });
      }
      return refs;
    }
    case 'CHANGE_PROGRAMME_ITEM_TIME':
      return [{ kind: 'PROGRAMME_ITEM', id: effect.programmeItemId }];
    case 'ALTER_JOURNEY_ITEM_INTENT':
      return [{ kind: 'JOURNEY_ITEM', id: effect.journeyItemId }];
    case 'CHANGE_SUPPORT_ASSIGNMENT':
      return [
        { kind: 'CONSTRAINT_DEFINITION', id: effect.constraintDefinitionId },
        ...effect.proposedAssignedSupporterTravellerIds.map(
          (id): TypedRef => ({ kind: 'TRAVELLER', id }),
        ),
      ];
    case 'WAIVE_OBJECTIVE':
      return [{ kind: 'OBJECTIVE', id: effect.objectiveId }];
  }
}

/** A. immediateChangeBlastRadius from a validated strategy's scenario change. */
export function immediateBlastRadiusOf(strategy: RecoveryStrategy): ImmediateChangeBlastRadius {
  return buildImmediateChangeBlastRadius({
    effects: strategy.scenarioChange.effects.map((effect) => ({
      changedRefs: effectChangedRefs(effect),
    })),
    affectedSubjectRefs: strategy.scenarioChange.affectedSubjectRefs,
  });
}

function summaryRefs(summaries: readonly SubjectAssessmentSummary[]): TypedRef[] {
  return summaries.map((s) => ({ kind: s.subjectRef.kind, id: s.subjectRef.id }));
}

/**
 * B. reassessmentClosure — the subjects RC-6 actually reevaluated on the
 * overlay. `candidateAssessments` are exactly the journey/trip subjects the
 * evaluator assessed, so they are the honest closure that was reassessed (never
 * a recomputation, never the immediate blast radius).
 */
export function reassessmentClosureOf(strategy: RecoveryStrategy): ReassessmentClosure {
  const reached = new Map<string, TypedRef>();
  for (const ref of summaryRefs(strategy.candidateAssessments)) reached.set(refKey(ref), ref);
  return { reachedRefs: [...reached.values()].sort((a, b) => refKey(a).localeCompare(refKey(b))) };
}

/**
 * C. outcomeDelta — join the candidate assessments with the same subjects'
 * baseline (un-overlaid) assessments and classify conservatively. A subject
 * with no baseline is UNCHANGED (the contract never invents a healing claim).
 */
export function outcomeDeltaOf(result: EvaluateStrategyResult): OutcomeDeltaEntry[] {
  const baseline = new Map<string, SubjectAssessmentSummary['overallVerdict']>();
  for (const b of result.baselineAssessments) baseline.set(refKey(b.subjectRef), b.overallVerdict);
  const pairs = result.strategy.candidateAssessments.map((c) => {
    const key = refKey(c.subjectRef);
    const base = baseline.get(key);
    return {
      subjectRef: { kind: c.subjectRef.kind, id: c.subjectRef.id },
      ...(base !== undefined ? { baseline: base } : {}),
      candidate: c.overallVerdict,
    };
  });
  return buildOutcomeDelta(pairs);
}

/** Closed, deduped, sorted RC-6 decision codes — the evaluator's own words. */
export function viabilityDecisionCodesOf(
  decisions: readonly StrategyViabilityDecision[],
): string[] {
  return [...new Set(decisions.map((d) => d.code))].sort();
}

/** Disposition derived deterministically from RC-6 viability + recommendation. */
export function dispositionFor(viability: RecoveryStrategy['viability'], recommended: boolean): MaterialCandidateDisposition {
  if (viability === 'VIABLE') return recommended ? 'RECOMMENDED' : 'VIABLE_NOT_RECOMMENDED';
  return 'REJECTED_DETERMINISTIC';
}

function proposalFromEvaluation(result: EvaluateStrategyResult): MaterialCandidateProposal {
  const effects = result.strategy.scenarioChange.effects;
  const flights = effects.flatMap((effect) => {
    if (effect.effectKind !== 'SELECT_OFFER') return [];
    const item = result.proposedWorld.journeyItems.find((candidate) => candidate.id === effect.journeyItemId);
    const service = item?.selectedServiceId
      ? result.proposedWorld.transportServices.find((candidate) => candidate.id === item.selectedServiceId)
      : undefined;
    const departure = service?.estimated.departure?.value ?? service?.published.departure?.value;
    const arrival = service?.estimated.arrival?.value ?? service?.published.arrival?.value;
    return service && departure && arrival ? [{ label: service.operator, departure, arrival }] : [];
  }).slice(0, 4);
  const stays = effects.flatMap((effect) => {
    if (effect.effectKind !== 'ADD_JOURNEY_STAY') return [];
    const item = result.proposedWorld.journeyItems.find((candidate) => candidate.id === effect.proposedJourneyItemId);
    const place = item?.intendedPlaceId
      ? result.proposedWorld.places.find((candidate) => candidate.id === item.intendedPlaceId)
      : undefined;
    return item?.intendedWindow && place ? [{ placeLabel: place.name, start: item.intendedWindow.start, end: item.intendedWindow.end }] : [];
  }).slice(0, 4);
  const dimensions = result.strategy.candidateAssessmentResults.flatMap((assessment) => assessment.dimensions)
    .filter((dimension) => dimension.applicable && dimension.blocking);
  const blockers = dimensions.flatMap((dimension) => dimension.explanations
    .filter((explanation): explanation is typeof explanation & { status: 'FAIL' | 'UNKNOWN' } => explanation.status === 'FAIL' || explanation.status === 'UNKNOWN')
    .map((explanation) => ({ dimension: dimension.dimension, verdict: explanation.status, reasonCode: explanation.reasonCode })))
    .sort((a, b) => `${a.dimension}|${a.verdict}|${a.reasonCode}`.localeCompare(`${b.dimension}|${b.verdict}|${b.reasonCode}`))
    .filter((entry, index, all) => index === 0 || `${entry.dimension}|${entry.verdict}|${entry.reasonCode}` !== `${all[index - 1]!.dimension}|${all[index - 1]!.verdict}|${all[index - 1]!.reasonCode}`)
    .slice(0, 16);
  const entryResults = dimensions.filter((dimension) => dimension.dimension.startsWith('entry'))
    .map((dimension) => ({
      dimension: dimension.dimension,
      verdict: dimension.verdict,
      reasonCodes: [...new Set(dimension.explanations.map((explanation) => explanation.reasonCode))].sort().slice(0, 8),
    })).sort((a, b) => a.dimension.localeCompare(b.dimension)).slice(0, 8);
  return { flights, stays, entryResults, blockers };
}

export interface EvaluatedCandidateEvidenceInput {
  candidateKey: string;
  proposerId: string;
  domainId: RecoveryDomainId;
  /** Present only when the viable candidate was promoted to a persisted RecoveryStrategy. */
  strategyRef?: SubjectId;
  recommended: boolean;
  evidenceRefs?: readonly string[];
  costComparison?: MaterialCandidateCostComparison;
  result: EvaluateStrategyResult;
}

/**
 * Material decision evidence for ONE candidate that reached deterministic RC-6
 * evaluation. Carries the three SEPARATE impact projections and the actual
 * viability + decision codes. Validated against the contract schema.
 */
export function materialCandidateFromEvaluation(
  input: EvaluatedCandidateEvidenceInput,
): MaterialCandidateEvidence {
  const strategy = input.result.strategy;
  return MaterialCandidateEvidenceSchema.parse({
    candidateKey: input.candidateKey,
    proposerId: input.proposerId,
    domainId: input.domainId,
    ...(input.strategyRef !== undefined ? { strategyRef: input.strategyRef } : {}),
    disposition: dispositionFor(strategy.viability, input.recommended),
    evidenceRefs: [...(input.evidenceRefs ?? [])],
    validationReasonCodes: [],
    viability: strategy.viability,
    viabilityDecisionCodes: viabilityDecisionCodesOf(input.result.viabilityDecisions),
    immediateChangeBlastRadius: immediateBlastRadiusOf(strategy),
    reassessmentClosure: reassessmentClosureOf(strategy),
    outcomeDelta: outcomeDeltaOf(input.result),
    proposal: proposalFromEvaluation(input.result),
    ...(input.costComparison !== undefined ? { costComparison: input.costComparison } : {}),
  });
}

export interface ValidationRejectedEvidenceInput {
  candidateKey: string;
  proposerId: string;
  domainId: RecoveryDomainId;
  /** Actual validation reason codes from validateProposalCandidates. */
  validationReasonCodes: readonly string[];
  evidenceRefs?: readonly string[];
}

/**
 * Material decision evidence for a candidate rejected at schema validation with
 * at least one reason code (a meaningful deterministic rejection). It never
 * reached RC-6, so it carries no viability and no impact projections — the
 * absence is honest, not an empty claim.
 */
export function materialCandidateFromValidationRejection(
  input: ValidationRejectedEvidenceInput,
): MaterialCandidateEvidence {
  return MaterialCandidateEvidenceSchema.parse({
    candidateKey: input.candidateKey,
    proposerId: input.proposerId,
    domainId: input.domainId,
    disposition: 'REJECTED_VALIDATION',
    evidenceRefs: [...(input.evidenceRefs ?? [])],
    validationReasonCodes: [...input.validationReasonCodes],
    viabilityDecisionCodes: [],
    outcomeDelta: [],
  });
}

export interface AssemblePlanningAttemptInput {
  id: SubjectId;
  recoveryCaseId: SubjectId;
  basisAssessmentId: SubjectId;
  basisManifest: WorldSnapshotManifest;
  startedAt: Instant;
  completedAt: Instant;
  coordinatorVersion: string;
  domains: readonly RecoveryDomainDecision[];
  evidence: readonly PlanningEvidenceRecord[];
  modelActivities?: readonly PlanningModelActivity[];
  materialCandidates: readonly MaterialCandidateEvidence[];
  viableStrategyRefs: readonly SubjectId[];
  recommendation?: StrategyRecommendation;
}

/**
 * Assemble and validate ONE immutable RecoveryPlanningAttempt record. Returns
 * the contract-parsed value so the persisted row is exactly the validated
 * shape; throws (fail-closed) if any field violates the bounded contract.
 */
export function assemblePlanningAttempt(
  input: AssemblePlanningAttemptInput,
): RecoveryPlanningAttempt {
  return RecoveryPlanningAttemptSchema.parse({
    id: input.id,
    recoveryCaseId: input.recoveryCaseId,
    basisAssessmentId: input.basisAssessmentId,
    basisManifest: input.basisManifest,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    coordinatorVersion: input.coordinatorVersion,
    domains: [...input.domains],
    evidence: [...input.evidence],
    modelActivities: [...(input.modelActivities ?? [])],
    materialCandidates: [...input.materialCandidates],
    viableStrategyRefs: [...input.viableStrategyRefs],
    ...(input.recommendation !== undefined ? { recommendation: input.recommendation } : {}),
  });
}

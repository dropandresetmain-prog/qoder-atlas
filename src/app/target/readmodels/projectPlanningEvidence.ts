/**
 * C9 — pure projection of the frozen recovery-planning attempt (C1) onto the
 * decision-time `PlanningEvidenceView` carried by `RecoveryCaseView`.
 *
 * This answers freeze §12 Q4-Q12 (planning-time evidence) with HUMAN LABELS as
 * the primary explanation and typed refs / closed-vocab codes as SECONDARY
 * metadata (line 529: internal UUIDs/capability codes are never the primary
 * product explanation; planning-time evidence must be visibly distinguishable
 * from current authoritative state).
 *
 * It is a PURE function of the frozen contract record: it re-derives no
 * viability, invents no evidence, and never collapses the three distinct impact
 * semantics (immediateChangeBlastRadius / reassessmentClosure / outcomeDelta).
 * Closed vocabularies are labelled through exhaustive `Record<Enum, string>`
 * maps (so a new enum member fails typecheck rather than silently mislabeling);
 * open snake/dot codes (operations, reason codes, proposer ids, subject kinds)
 * go through a generic humanizer. No demo facts, no scenario branches.
 */
import type { PlanningEvidenceView, PlanningEvidenceLabel } from '../../../contracts/v2/product/readModels.ts';
import type {
  MaterialCandidateEvidence,
  RecoveryCostLineEvidence,
  PlanningEvidenceRecord,
  RecoveryPlanningAttempt,
  RecoveryPlanningOutcome,
} from '../../../contracts/v2/planning/recoveryPlanningAttempt.ts';
import type { RecoveryDomainDisposition, RecoveryDomainId } from '../../../contracts/v2/planning/recoveryDomain.ts';
import type { PlanningToolProvenanceMode, PlanningToolResultStatus } from '../../../contracts/v2/planning/planningTool.ts';
import type { OutcomeDeltaDirection } from '../../../contracts/v2/planning/impactSemantics.ts';
import type { RecommendationBasisKind, RecommendationProvenance } from '../../../contracts/v2/planning/strategyRecommendation.ts';
import type { StrategyViability } from '../../../contracts/v2/scenario/recoveryStrategy.ts';
import type { TypedRef } from '../../../domain/v2/shared/identity.ts';

/** Sentence-case a generic code (`flight.search` -> `Flight search`). */
function humanize(code: string): string {
  const words = code
    .split(/[._\-\s]+/)
    .filter((w) => w.length > 0)
    .map((w) => w.toLowerCase());
  if (words.length === 0) return code;
  const sentence = words.join(' ');
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

const DOMAIN_LABELS: Record<RecoveryDomainId, string> = {
  TRANSPORT: 'Transport',
  STAY: 'Stay',
  TRANSFER: 'Transfer',
  PROGRAMME: 'Programme',
  SUPPORT_COORDINATION: 'Support coordination',
  INFORMATION_RESEARCH: 'Information research',
};

const DOMAIN_DISPOSITION_LABELS: Record<RecoveryDomainDisposition, string> = {
  INVESTIGATED: 'Investigated',
  NOT_APPLICABLE: 'Not applicable',
  UNAVAILABLE: 'Unavailable',
};

const TOOL_STATUS_LABELS: Record<PlanningToolResultStatus, string> = {
  SUCCEEDED: 'Succeeded',
  PARTIAL: 'Partially succeeded',
  FAILED: 'Failed',
  UNAVAILABLE: 'Unavailable',
};

const PROVENANCE_MODE_LABELS: Record<PlanningToolProvenanceMode, string> = {
  LIVE: 'Live provider call',
  RECORD: 'Recorded provider call',
  REPLAY: 'Replayed recording',
  INTERNAL: 'Internal canonical state',
};

const OUTCOME_LABELS: Record<RecoveryPlanningOutcome, string> = {
  AWAITING_AUTHORITY: 'Awaiting operator authority',
  NEEDS_EVIDENCE_OR_DECISION: 'Needs more evidence or a decision',
  NO_RECOVERY_FOUND: 'No viable recovery found',
  STALE_RETRY_REQUIRED: 'Stale basis — planning retry required',
};

const CANDIDATE_DISPOSITION_LABELS: Record<MaterialCandidateEvidence['disposition'], string> = {
  REJECTED_VALIDATION: 'Rejected by validation',
  REJECTED_DETERMINISTIC: 'Rejected by deterministic evaluation',
  VIABLE_NOT_RECOMMENDED: 'Viable but not recommended',
  RECOMMENDED: 'Recommended',
};

const VIABILITY_LABELS: Record<StrategyViability, string> = {
  VIABLE: 'Viable',
  NOT_VIABLE: 'Not viable',
  NOT_EXECUTABLE: 'Not executable',
  STALE_BASE: 'Stale basis',
  REJECTED: 'Rejected',
};

const DELTA_DIRECTION_LABELS: Record<OutcomeDeltaDirection, string> = {
  BETTER: 'Better',
  WORSE: 'Worse',
  UNCHANGED: 'Unchanged',
};

const BASIS_KIND_LABELS: Record<RecommendationBasisKind, string> = {
  DETERMINISTIC_FACT: 'Deterministic fact',
  EXPLICIT_PREFERENCE: 'Explicit preference',
  SEMANTIC_JUDGEMENT: 'Semantic judgement',
};

const PROVENANCE_KIND_LABELS: Record<RecommendationProvenance['kind'], string> = {
  DETERMINISTIC: 'Deterministic comparator',
  AI_ASSISTED: 'AI-assisted comparator',
};

/** A typed subject/strategy ref presented as a human label + secondary ref. */
function refLabel(ref: TypedRef, humanLabels?: ReadonlyMap<string, string>): PlanningEvidenceLabel {
  const typedRef = `${ref.kind}:${ref.id}`;
  // R2 carry-forward: when authoritative identity supplies a display name for
  // this subject (e.g. a Journey's traveller name), it becomes the human label.
  // Generic kind wording is the honest fallback; the typed ref stays secondary.
  // Never a persona-specific lookup — the map is built from canonical state.
  const human = humanLabels?.get(typedRef);
  return { label: human && human.length > 0 ? human : humanize(ref.kind), ref: typedRef };
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * Project the frozen attempt + its closed outcome into the decision-time view.
 * Returns undefined only when no attempt exists, so the caller can spread it
 * conditionally and a case that never planned carries no planning evidence.
 *
 * `humanLabels` (R2 carry-forward) optionally resolves authoritative display
 * names for typed subject refs (key `<KIND>:<id>` -> display value), built by
 * the caller from canonical identity state. It only upgrades the human label;
 * refs/codes stay secondary and the generic kind label remains the fallback.
 */
export function projectPlanningEvidence(
  attempt: RecoveryPlanningAttempt,
  outcome: RecoveryPlanningOutcome,
  humanLabels?: ReadonlyMap<string, string>,
): PlanningEvidenceView {
  return {
    phase: 'DECISION_TIME',
    asOf: attempt.completedAt,
    attemptRef: attempt.id,
    coordinatorVersion: attempt.coordinatorVersion,
    outcome: { label: OUTCOME_LABELS[outcome], code: outcome },
    domains: attempt.domains.map((d) => ({
      domain: { label: DOMAIN_LABELS[d.domainId], code: d.domainId },
      disposition: { label: DOMAIN_DISPOSITION_LABELS[d.disposition], code: d.disposition },
      ...(d.reasonCode ? { reason: humanize(d.reasonCode) } : {}),
    })),
    tools: attempt.evidence.map(projectToolEvidence),
    modelActivities: attempt.modelActivities.map((activity) => ({ ...activity })),
    candidates: attempt.materialCandidates.map((candidate) => projectCandidate(candidate, humanLabels)),
    // Q8: the refs this attempt promoted to viable RecoveryStrategy rows. Their
    // rich human detail (option number, who each fixes, cost) lives in the
    // CURRENT-state `strategies[]` block of the same view; these are the
    // decision-time refs, labelled so a uuid is never the primary explanation.
    viableStrategies: attempt.viableStrategyRefs.map((ref) => ({
      label: 'Viable strategy option',
      ref,
    })),
    ...(attempt.recommendation ? { recommendation: projectRecommendation(attempt.recommendation) } : {}),
  };
}

function projectToolEvidence(evidence: PlanningEvidenceRecord): PlanningEvidenceView['tools'][number] {
  return {
    tool: { label: humanize(evidence.operation), code: evidence.operation },
    status: { label: TOOL_STATUS_LABELS[evidence.status], code: evidence.status },
    provenanceMode: {
      label: PROVENANCE_MODE_LABELS[evidence.provenance.mode],
      code: evidence.provenance.mode,
    },
    ...(evidence.provenance.providerId ? { provider: evidence.provenance.providerId } : {}),
    ...(evidence.provenance.observedAt ? { observedAt: evidence.provenance.observedAt } : {}),
    summary: evidence.summary,
    uncertainties: evidence.uncertainty.map((u) => u.summary),
    evidenceRef: evidence.evidenceRef,
    ...(evidence.sourceLinks ? { sourceLinks: evidence.sourceLinks } : {}),
  };
}

function projectCandidate(
  candidate: MaterialCandidateEvidence,
  humanLabels?: ReadonlyMap<string, string>,
): PlanningEvidenceView['candidates'][number] {
  // Human-readable reasons, deterministically ordered: viability verdict first,
  // then validation reason codes, then RC-6 viability decision codes. Each open
  // code is humanized; the raw codes stay available on the frozen record.
  const reasons: string[] = [];
  if (candidate.viability) reasons.push(VIABILITY_LABELS[candidate.viability]);
  reasons.push(...candidate.validationReasonCodes.map(humanize));
  reasons.push(...candidate.viabilityDecisionCodes.map(humanize));

  const hasBlastRadius =
    candidate.immediateChangeBlastRadius !== undefined || candidate.reassessmentClosure !== undefined;

  return {
    candidateKey: candidate.candidateKey,
    domain: { label: DOMAIN_LABELS[candidate.domainId], code: candidate.domainId },
    proposer: { label: humanize(candidate.proposerId), code: candidate.proposerId },
    disposition: {
      label: CANDIDATE_DISPOSITION_LABELS[candidate.disposition],
      code: candidate.disposition,
    },
    ...(candidate.strategyRef ? { strategyRef: candidate.strategyRef } : {}),
    reasons: dedupe(reasons),
    outcomeDelta: candidate.outcomeDelta.map((entry) => ({
      subject: refLabel(entry.subjectRef, humanLabels),
      direction: { label: DELTA_DIRECTION_LABELS[entry.delta], code: entry.delta },
      ...(entry.baseline ? { baseline: entry.baseline } : {}),
      candidate: entry.candidate,
    })),
    ...(hasBlastRadius
      ? {
          blastRadius: {
            changed: (candidate.immediateChangeBlastRadius?.changedRefs ?? []).map((ref) => refLabel(ref, humanLabels)),
            directlyAffected: (candidate.immediateChangeBlastRadius?.directlyAffectedRefs ?? []).map((ref) => refLabel(ref, humanLabels)),
            reassessed: (candidate.reassessmentClosure?.reachedRefs ?? []).map((ref) => refLabel(ref, humanLabels)),
          },
        }
      : {}),
    ...(candidate.costComparison ? { costComparison: projectCostComparison(candidate.costComparison) } : {}),
    ...(candidate.proposal ? { proposal: candidate.proposal } : {}),
  };
}

const COST_KIND_LABELS: Record<RecoveryCostLineEvidence['kind'], string> = {
  SELECT_OFFER: 'Replacement travel',
  ADD_JOURNEY_STAY: 'Accommodation',
  POLICY_PENALTY_ESTIMATE: 'Cancellation policy exposure (up to)',
};

function projectCostComparison(cost: NonNullable<MaterialCandidateEvidence['costComparison']>) {
  if (cost.status === 'UNAVAILABLE') {
    return { status: 'UNAVAILABLE' as const, reason: cost.reason, comparedAt: cost.comparedAt };
  }
  return {
    status: 'AVAILABLE' as const,
    homeCurrency: cost.homeCurrency,
    totalHomeAmount: cost.totalHomeAmount,
    lines: cost.lines.map((line) => ({
      kind: { label: COST_KIND_LABELS[line.kind], code: line.kind },
      providerAmount: line.providerAmount,
      homeAmount: line.homeAmount,
      observed: line.observed,
    })),
    selectedFxEvidence: cost.selectedFxEvidence.map((fx) => ({
      source: { label: humanize(fx.sourceId), code: fx.sourceId },
      baseCurrency: fx.baseCurrency,
      homeCurrency: fx.homeCurrency,
      rate: fx.rate,
      observedAt: fx.observedAt,
      ...(fx.validUntil ? { validUntil: fx.validUntil } : {}),
    })),
    comparedAt: cost.comparedAt,
  };
}

function projectRecommendation(
  recommendation: NonNullable<RecoveryPlanningAttempt['recommendation']>,
): NonNullable<PlanningEvidenceView['recommendation']> {
  const provenance = recommendation.provenance;
  return {
    recommended: { label: 'Recommended viable strategy', ref: recommendation.recommendedStrategyRef },
    alternatives: recommendation.alternativeStrategyRefs.map((ref) => ({
      label: 'Alternative viable strategy',
      ref,
    })),
    basis: recommendation.recommendationBasis.map((b) => ({
      kind: { label: BASIS_KIND_LABELS[b.kind], code: b.kind },
      summary: b.summary,
    })),
    provenance: {
      label: `${PROVENANCE_KIND_LABELS[provenance.kind]} ${provenance.comparatorVersion}`.trim(),
      code: provenance.kind,
    },
  };
}

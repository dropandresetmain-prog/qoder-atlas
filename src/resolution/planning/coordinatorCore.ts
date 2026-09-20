/**
 * NORTHSTAR R1 — Recovery Planning Coordinator CORE (freeze C1).
 *
 * This is the single generalized planning orchestration the freeze describes. It
 * EXTENDS the current `recoveryPlanning.ts` pipeline in spirit and reuses every
 * accepted piece — it is NOT a parallel engine and adds no viability semantics
 * of its own:
 *
 *   failing subjects (CURRENT FAIL assessments)
 *   -> deterministic recovery-domain registry (C3): which domains are relevant,
 *      decided ONLY by real blocking M6 dimension codes + available capabilities;
 *   -> optional bounded READ-ONLY research (C2) per investigated domain;
 *   -> StrategyProposer port per investigated domain (proposal-only);
 *   -> validateProposalCandidates (closed ScenarioEffect vocabulary);
 *   -> evaluateRecoveryStrategy (REAL RC-6 overlay vs current-world viability);
 *   -> decision-evidence assembly (C5/C7): three SEPARATE impact projections +
 *      honest rejection codes for every material candidate;
 *   -> deterministic comparator (C6): viable-only recommendation, never a silent
 *      pick, re-validated against the contract boundary;
 *   -> closed planning-outcome mapping (RecoveryPlanningOutcome);
 *   -> ONE immutable RecoveryPlanningAttempt (assemblePlanningAttempt).
 *
 * PURITY / Cloud-verifiability: this core takes the captured world, effective
 * world, current-state reader result, evaluator registry, proposers, preferences
 * and id/version minters as INJECTED data. It performs NO PostgreSQL, NO
 * provider call and NO model call itself (the optional research transport is
 * injected and, in Cloud tests, a checked-in REPLAY source). That is what lets
 * the SAME core be exercised over materially different planning situations —
 * the generality proof — with the real evaluator and comparator.
 *
 * The core returns the assembled attempt, the closed RecoveryPlanningResult, and
 * the VIABLE RecoveryStrategy rows to persist. The thin application adapter
 * (`src/app/target/recoveryPlanningCoordinator.ts`) owns the UnitOfWork writes:
 * it persists each viable strategy and the attempt in the SAME transaction. The
 * core never mutates canonical state and never owns execution/authority.
 */
import type { SubjectId } from '../../domain/v2/shared/identity.ts';
import { compareInstants, InstantSchema, type Instant } from '../../domain/v2/shared/time.ts';
import type { CapabilityFamily } from '../../operational/strategy.ts';
import type { EvaluatorRegistry } from '../evaluation/assess.ts';
import type { CapturedWorld } from '../world/world.ts';
import type { EffectiveWorld } from '../world/effectiveTypes.ts';
import { projectEffectiveWorld } from '../world/effectiveItinerary.ts';
import type { CurrentState } from '../world/currentness.ts';
import { ScenarioChangeSchema, type ScenarioEffect } from '../../contracts/v2/scenario/scenarioChange.ts';
import type { RecoveryStrategy } from '../../contracts/v2/scenario/recoveryStrategy.ts';
import type { EvaluateStrategyResult } from '../scenarios/evaluate.ts';
import { evaluateRecoveryStrategy } from '../scenarios/evaluate.ts';
import type { ResolvedOffer, ResolvedStayOffer } from '../scenarios/overlay.ts';
import {
  validateProposalCandidates,
  type FailingSubject,
  type StrategyProposer,
} from './proposer.ts';
import {
  bindDomainProposer,
  type DomainStrategyProposer,
  type PlanningEvidenceContext,
} from '../../contracts/v2/planning/proposerAdaptation.ts';
import {
  resolveRecoveryDomainDecisions,
  type RecoveryDomainContext,
  type RecoveryDomainDefinition,
  type RecoveryDomainId,
} from '../../contracts/v2/planning/recoveryDomain.ts';
import {
  DEFAULT_PLANNING_RESEARCH_BUDGET,
  type PlanningResearchBudget,
  type PlanningToolRequest,
  type PlanningToolResult,
} from '../../contracts/v2/planning/planningTool.ts';
import type { ComparatorPreference, StrategyRecommendation } from '../../contracts/v2/planning/strategyRecommendation.ts';
import type {
  MaterialCandidateEvidence,
  MaterialCandidateCostComparison,
  PlanningEvidenceRecord,
  RecoveryPlanningAttempt,
  RecoveryPlanningOutcome,
  RecoveryPlanningReason,
  RecoveryPlanningResult,
} from '../../contracts/v2/planning/recoveryPlanningAttempt.ts';
import { MaterialCandidateCostComparisonSchema } from '../../contracts/v2/planning/recoveryPlanningAttempt.ts';
import type { FxRateEvidence } from '../../engine/fx.ts';
import { dimensionReasonToken } from './recoveryDomains.ts';
import { dispatchResearch, type PlanningToolTransport, type NextResearchRound } from './researchDispatcher.ts';
import {
  materialCandidateFromEvaluation,
  materialCandidateFromValidationRejection,
  assemblePlanningAttempt,
} from './decisionEvidence.ts';
import { selectRecommendation, type CandidateComparisonFacts } from './comparator.ts';
import { satisfiedPreferenceCodes } from './preferenceMatching.ts';
import { comparisonFactsFromEvidence, planningOutcomeOf } from './planningSelection.ts';
import { compareRecoveryCosts, safeRecoveryCostMinorUnits } from './recoveryCostComparison.ts';

/**
 * A proposer bound to the single recovery domain it serves. The binding accepts
 * EITHER the base `StrategyProposer` (proposal over canonical state only, e.g.
 * the deterministic programme time-swap) OR a `DomainStrategyProposer` that also
 * consumes the domain's normalized read-only evidence (e.g. a transport proposer
 * reasoning over `flight.search` offers). A domain proposer is adapted to the
 * base port via `bindDomainProposer` at the propose site, binding the per-domain
 * evidence context; a base proposer is driven unchanged.
 */
export interface DomainProposerBinding {
  domain: RecoveryDomainId;
  proposer: StrategyProposer | DomainStrategyProposer;
}

/** The captured planning basis the coordinator plans against. All injected data. */
export interface PlanningBasis {
  workspaceId: string;
  recoveryCaseId: SubjectId;
  /** The CURRENT FAIL assessment this basis is bound to (drives staleness). */
  basisAssessmentId: SubjectId;
  reason: RecoveryPlanningReason;
  now: Instant;
  world: CapturedWorld;
  effective: EffectiveWorld;
  failing: readonly FailingSubject[];
  registry: EvaluatorRegistry;
  /** When present, the base manifest is checked for currentness (STALE_BASE). */
  currentState?: CurrentState;
}

/** Deterministic identity/version allocation, injected so the core stays pure. */
export interface CoordinatorMinters {
  attemptId: SubjectId;
  startedAt: Instant;
  mintStrategyId: (candidateKey: string) => SubjectId;
  mintScenarioChangeId: (strategyId: SubjectId) => SubjectId;
  /** First strategy version to allocate; increments per VIABLE candidate. */
  baseStrategyVersion: number;
}

export interface CoordinatorCoreDeps {
  domainRegistry: readonly RecoveryDomainDefinition[];
  availableCapabilities: readonly CapabilityFamily[];
  proposers: readonly DomainProposerBinding[];
  minters: CoordinatorMinters;
  coordinatorVersion: string;
  comparatorVersion: string;
  preferences?: readonly ComparatorPreference[];
  /** Optional AI-suggested domains; still validated fail-closed by the registry. */
  aiSuggestedDomains?: readonly RecoveryDomainId[];
  /** Optional bounded read-only research, per investigated domain. */
  research?: {
    transport: PlanningToolTransport;
    requestsByDomain: Readonly<Partial<Record<RecoveryDomainId, readonly (readonly PlanningToolRequest[])[]>>>;
    budget?: PlanningResearchBudget;
    /** Dependent reads for a domain's whole-trip proposal, under the same budget. */
    nextRound?: (input: Parameters<NextResearchRound>[0] & {
      domainId: RecoveryDomainId;
      basis: PlanningBasis;
    }) => ReturnType<NextResearchRound>;
  };
  /**
   * Optional, DOMAIN-AGNOSTIC resolver of the offers an overlay needs to honor a
   * `SELECT_OFFER` effect. Given one investigated domain's gathered evidence
   * context plus the basis, it returns the `ResolvedOffer[]` (offerId ->
   * transportServiceId) the RC-6 overlay requires; the core never knows these are
   * flight offers and never fabricates one. Absent for domains that emit no
   * offer-selecting effect (e.g. the programme time-swap), so existing behavior is
   * unchanged. The composition supplies the transport resolver
   * (`resolveTransportOffers`) for the TRANSPORT domain.
   */
  resolveOffersForDomain?: (ctx: {
    domainId: RecoveryDomainId;
    evidence: PlanningEvidenceContext;
    basis: PlanningBasis;
  }) => readonly ResolvedOffer[];
  /** Optional stay-offer resolver; kept separate from transport offer binding. */
  resolveStayOffersForDomain?: (ctx: {
    domainId: RecoveryDomainId;
    evidence: PlanningEvidenceContext;
    basis: PlanningBasis;
  }) => readonly ResolvedStayOffer[];
  /**
   * Optional planning-local evidence materialization. It may enrich only an
   * isolated captured-world copy (for example a searched flight offer) before
   * RC-6; it cannot mutate canonical state or create a reservation.
   */
  materializeWorldForDomain?: (ctx: {
    domainId: RecoveryDomainId;
    evidence: PlanningEvidenceContext;
    basis: PlanningBasis;
  }) => {
    world: CapturedWorld;
    resolvedOffers?: readonly ResolvedOffer[];
    resolvedStayOffers?: readonly ResolvedStayOffer[];
  } | undefined;
  /**
   * Optional captured cost context. It runs only after research and candidate
   * effects exist; it cannot alter RC-6, provider prices, or canonical state.
   */
  costContextForCandidate?: (input: {
    candidateKey: string;
    domainId: RecoveryDomainId;
    effects: readonly ScenarioEffect[];
    basis: PlanningBasis;
  }) => Promise<{ homeCurrency: string; rates: readonly FxRateEvidence[]; comparedAt: Instant } | undefined>;
}

export interface CoordinatorCoreOutput {
  /** The assembled, contract-validated immutable attempt record. */
  attempt: RecoveryPlanningAttempt;
  /** The frozen C1 result. */
  result: RecoveryPlanningResult;
  /** VIABLE strategies to persist (the adapter writes these + the attempt in one UoW). */
  viableStrategies: RecoveryStrategy[];
  /** True when the bounded research budget was exhausted with gaps remaining. */
  researchBudgetExhausted: boolean;
  /** Latest cost-evidence instant; persistence must not complete before this. */
  completionHorizon: Instant;
}

/** One dispatched read, tagged with the domain it was gathered for. Carries BOTH
 * the projected attempt record and the raw normalized result a domain proposer
 * consumes; the raw payload is never persisted (only the record is). */
interface DomainEvidence {
  domainId: RecoveryDomainId;
  record: PlanningEvidenceRecord;
  result: PlanningToolResult;
}

/** Type guard: a binding whose proposer is domain/evidence-aware (C4). */
function isDomainProposer(proposer: StrategyProposer | DomainStrategyProposer): proposer is DomainStrategyProposer {
  return Array.isArray((proposer as DomainStrategyProposer).domains);
}

interface EvaluatedCandidate {
  candidateKey: string;
  proposerId: string;
  domainId: RecoveryDomainId;
  result: EvaluateStrategyResult;
  costComparison?: MaterialCandidateCostComparison;
}

/** Only effects with externally priced or policy-cost terms need comparison evidence. */
function hasComparableCostEffect(effects: readonly ScenarioEffect[]): boolean {
  return effects.some((effect) =>
    effect.effectKind === 'SELECT_OFFER'
    || effect.effectKind === 'ADD_JOURNEY_STAY'
    || effect.effectKind === 'CANCEL_STAY');
}

function unavailableCost(code: 'CONTEXT_UNAVAILABLE' | 'MISSING_RATE_EVIDENCE', reason: string, comparedAt: Instant): MaterialCandidateCostComparison {
  return MaterialCandidateCostComparisonSchema.parse({ status: 'UNAVAILABLE', code, reason, comparedAt });
}

function declaredCostFacts(cost: MaterialCandidateCostComparison | undefined): Pick<CandidateComparisonFacts, 'declaredCostMinorUnits'> | undefined {
  if (cost?.status !== 'AVAILABLE') return undefined;
  const declaredCostMinorUnits = safeRecoveryCostMinorUnits(cost.totalHomeAmount);
  return declaredCostMinorUnits === undefined ? undefined : { declaredCostMinorUnits };
}

async function costComparisonForCandidate(input: {
  candidate: EvaluatedCandidate;
  basis: PlanningBasis;
  supplier: NonNullable<CoordinatorCoreDeps['costContextForCandidate']>;
}): Promise<MaterialCandidateCostComparison> {
  let context: { homeCurrency: string; rates: readonly FxRateEvidence[]; comparedAt: Instant } | undefined;
  try {
    context = await input.supplier({
      candidateKey: input.candidate.candidateKey,
      domainId: input.candidate.domainId,
      effects: input.candidate.result.strategy.scenarioChange.effects,
      basis: input.basis,
    });
  } catch {
    return unavailableCost('CONTEXT_UNAVAILABLE', 'captured home-currency cost context could not be obtained', input.basis.now);
  }
  if (!context) {
    return unavailableCost('CONTEXT_UNAVAILABLE', 'no captured home-currency cost context is available for this candidate', input.basis.now);
  }
  const comparedAt = InstantSchema.safeParse(context.comparedAt);
  if (!comparedAt.success) {
    return unavailableCost('CONTEXT_UNAVAILABLE', 'captured home-currency comparison instant is invalid', input.basis.now);
  }
  const compared = compareRecoveryCosts({
    effects: input.candidate.result.strategy.scenarioChange.effects,
    homeCurrency: context.homeCurrency,
    rates: context.rates,
    comparedAt: comparedAt.data,
  });
  if (!compared.ok) {
    return MaterialCandidateCostComparisonSchema.parse({
      status: 'UNAVAILABLE', code: compared.code, reason: compared.reason, comparedAt: comparedAt.data,
    });
  }
  const selectedFxEvidence = compared.selectedFxEvidence.map((id) => context.rates.find((rate) => rate.id === id));
  if (selectedFxEvidence.some((rate) => rate === undefined)) {
    return unavailableCost('MISSING_RATE_EVIDENCE', 'selected FX provenance is not present in the captured context', comparedAt.data);
  }
  return MaterialCandidateCostComparisonSchema.parse({
    status: 'AVAILABLE',
    homeCurrency: compared.homeCurrency,
    totalHomeAmount: compared.totalHomeAmount,
    newSpendHomeAmount: compared.newSpendHomeAmount,
    potentialLossHomeAmount: compared.potentialLossHomeAmount,
    lines: compared.lines,
    selectedFxEvidence,
    comparedAt: compared.comparedAt,
  });
}

/**
 * Extract the real blocking M6 dimension codes from the failing subjects'
 * assessments, plus the dimension-scoped reason tokens of their failing
 * explanations (see `dimensionReasonToken`) for activators that need the reason.
 */
export function blockingDimensionCodes(failing: readonly FailingSubject[]): Set<string> {
  const codes = new Set<string>();
  for (const f of failing) {
    for (const dim of f.assessment.dimensions) {
      if (dim.applicable && dim.blocking && dim.verdict !== 'PASS') {
        codes.add(dim.dimension);
        for (const explanation of dim.explanations) {
          if (explanation.status !== 'PASS') codes.add(dimensionReasonToken(dim.dimension, explanation.reasonCode));
        }
      }
    }
  }
  return codes;
}

function evidenceRefsForDomain(evidence: readonly DomainEvidence[], domainId: RecoveryDomainId): string[] {
  return evidence.filter((e) => e.domainId === domainId).map((e) => e.record.evidenceRef);
}

/**
 * Build the additive C4 evidence context a `DomainStrategyProposer` consumes for
 * one domain: the raw normalized read-only tool results (e.g. flight offers) plus
 * the attempt evidence refs the proposer should cite. Empty when no research was
 * gathered for the domain — a proposer then proposes from canonical state only or
 * emits an honest evidence-gap assumption, never a fabricated payload.
 */
function evidenceContextForDomain(evidence: readonly DomainEvidence[], domainId: RecoveryDomainId): PlanningEvidenceContext {
  const forDomain = evidence.filter((e) => e.domainId === domainId);
  return {
    domainId,
    toolResults: forDomain.map((e) => e.result),
    evidenceRefs: forDomain.map((e) => e.record.evidenceRef),
  };
}

/**
 * Run the generalized planning pipeline over ONE captured basis and return the
 * assembled attempt + result + viable strategies. Pure: every side effect is an
 * injected dependency; the core only composes deterministic, already-accepted
 * functions.
 */
export async function runRecoveryPlanning(
  basis: PlanningBasis,
  deps: CoordinatorCoreDeps,
): Promise<CoordinatorCoreOutput> {
  const { world, effective, now, registry, failing, recoveryCaseId, basisAssessmentId, workspaceId } = basis;

  // 1. Deterministic domain selection from the REAL blocking dimensions.
  const domainContext: RecoveryDomainContext = {
    failingSubjectKinds: new Set(failing.map((f) => f.subject.kind)),
    blockingDimensionCodes: blockingDimensionCodes(failing),
    affectedObjectKinds: new Set<string>(),
    availableCapabilities: new Set(deps.availableCapabilities),
  };
  const domains = resolveRecoveryDomainDecisions(deps.domainRegistry, domainContext, deps.aiSuggestedDomains ?? []);
  const investigated = domains.filter((d) => d.disposition === 'INVESTIGATED');

  // 2. Optional bounded read-only research per investigated domain (C2). The
  //    dispatcher cannot represent a consequential operation.
  const evidence: DomainEvidence[] = [];
  let researchBudgetExhausted = false;
  if (deps.research) {
    const budget = deps.research.budget ?? DEFAULT_PLANNING_RESEARCH_BUDGET;
    let dispatchedRequests = 0;
    for (const d of investigated) {
      const rounds = deps.research.requestsByDomain[d.domainId];
      if (!rounds || rounds.length === 0) continue;
      const nextRound = deps.research.nextRound;
      const outcome = await dispatchResearch({
        rounds, transport: deps.research.transport,
        budget: { ...budget, maxRequests: budget.maxRequests - dispatchedRequests },
        ...(nextRound ? { nextRound: (input) => nextRound({ ...input, domainId: d.domainId, basis }) } : {}),
      });
      // The request allowance belongs to the planning basis, not each domain.
      // Hotel and entry follow-ups cannot reset it by changing their domain.
      dispatchedRequests += outcome.results.length;
      // evidence[i] is the projected record for results[i] (dispatcher contract),
      // so zip them: each DomainEvidence keeps both the record (persisted) and the
      // raw normalized result (handed to a domain proposer, never persisted).
      outcome.evidence.forEach((record, i) => {
        evidence.push({ domainId: d.domainId, record, result: outcome.results[i]! });
      });
      if (!outcome.ok) researchBudgetExhausted = true;
    }
  }

  // 3-5. Propose (per investigated domain) -> validate -> evaluate (REAL RC-6).
  const evaluated: EvaluatedCandidate[] = [];
  const rejectedEvidence: MaterialCandidateEvidence[] = [];
  let anyStale = false;
  let nextVersion = deps.minters.baseStrategyVersion;
  let planningWorld = world;
  let planningEffective = effective;

  const proposersByDomain = new Map<RecoveryDomainId, (StrategyProposer | DomainStrategyProposer)[]>();
  for (const binding of deps.proposers) {
    const list = proposersByDomain.get(binding.domain) ?? [];
    list.push(binding.proposer);
    proposersByDomain.set(binding.domain, list);
  }

  for (const domain of investigated) {
    const domainProposers = proposersByDomain.get(domain.domainId) ?? [];
    const domainEvidenceRefs = evidenceRefsForDomain(evidence, domain.domainId);
    // The additive C4 context for this domain, built once and bound to every
    // domain-aware proposer. A base StrategyProposer ignores it (the adapter
    // passes the same base ProposerInput it always received).
    const evidenceContext = evidenceContextForDomain(evidence, domain.domainId);
    const domainBasis: PlanningBasis = { ...basis, world: planningWorld, effective: planningEffective };
    const materialized = deps.materializeWorldForDomain?.({
      domainId: domain.domainId,
      evidence: evidenceContext,
      basis: domainBasis,
    });
    if (materialized) {
      planningWorld = materialized.world;
      planningEffective = projectEffectiveWorld(planningWorld);
    }
    const evaluationBasis: PlanningBasis = { ...basis, world: planningWorld, effective: planningEffective };
    // Domain-agnostic offer resolution for the overlay. Only a domain whose
    // proposer can emit a `SELECT_OFFER` effect needs it; the composition supplies
    // the resolver (e.g. transport). Empty when no resolver is wired, so domains
    // that emit no offer-selecting effect are unaffected.
    const resolvedOffers = materialized?.resolvedOffers ?? (deps.resolveOffersForDomain
      ? deps.resolveOffersForDomain({ domainId: domain.domainId, evidence: evidenceContext, basis: evaluationBasis })
      : []);
    const resolvedStayOffers = materialized?.resolvedStayOffers ?? (deps.resolveStayOffersForDomain
      ? deps.resolveStayOffersForDomain({ domainId: domain.domainId, evidence: evidenceContext, basis: evaluationBasis })
      : []);
    for (const bound of domainProposers) {
      const proposer = isDomainProposer(bound)
        ? bindDomainProposer(bound, domain.domainId, { evidence: evidenceContext, preferences: deps.preferences ?? [] })
        : bound;
      const raw = await proposer.propose({ workspaceId, recoveryCaseId, now, failing, world: planningWorld, effective: planningEffective });
      const { accepted, rejected } = validateProposalCandidates(raw);
      for (const r of rejected) {
        rejectedEvidence.push(materialCandidateFromValidationRejection({
          candidateKey: `${proposer.id}#${r.index}`,
          proposerId: proposer.id,
          domainId: domain.domainId,
          validationReasonCodes: [r.reason],
          evidenceRefs: domainEvidenceRefs,
        }));
      }
      for (const candidate of accepted) {
        const strategyId = deps.minters.mintStrategyId(candidate.key);
        const scenarioChange = ScenarioChangeSchema.parse({
          id: deps.minters.mintScenarioChangeId(strategyId),
          recoveryStrategyId: strategyId,
          strategyVersion: nextVersion,
          affectedSubjectRefs: candidate.affectedSubjectRefs,
          effects: candidate.effects,
          basisAssessmentId,
        });
        const evaluatedResult = evaluateRecoveryStrategy({
          recoveryCaseId, strategyId, strategyVersion: nextVersion,
          baseWorld: planningWorld, baseManifest: world.manifest, basisAssessmentId,
          scenarioChange, now, registry,
          ...(basis.currentState ? { currentState: basis.currentState } : {}),
          ...(resolvedOffers.length > 0 ? { resolvedOffers } : {}),
          ...(resolvedStayOffers.length > 0 ? { resolvedStayOffers } : {}),
          assumptions: candidate.assumptions,
          resolveSubjectRefs: failing.map((f) => f.subject),
        });
        if (!evaluatedResult.ok) {
          rejectedEvidence.push(materialCandidateFromValidationRejection({
            candidateKey: candidate.key, proposerId: proposer.id, domainId: domain.domainId,
            validationReasonCodes: [`${evaluatedResult.conflict.kind}: ${evaluatedResult.conflict.message}`],
            evidenceRefs: domainEvidenceRefs,
          }));
          continue;
        }
        if (evaluatedResult.value.strategy.viability === 'STALE_BASE') anyStale = true;
        evaluated.push({ candidateKey: candidate.key, proposerId: proposer.id, domainId: domain.domainId, result: evaluatedResult.value });
        if (evaluatedResult.value.strategy.viability === 'VIABLE') nextVersion += 1;
      }
    }
  }

  // Cost normalization is comparison evidence only. It happens after all
  // candidate effects and provider research are captured, and never changes
  // the RC-6 result already recorded above.
  if (deps.costContextForCandidate) {
    for (const candidate of evaluated) {
      if (!hasComparableCostEffect(candidate.result.strategy.scenarioChange.effects)) continue;
      candidate.costComparison = await costComparisonForCandidate({
        candidate,
        basis,
        supplier: deps.costContextForCandidate,
      });
    }
  }

  const completionHorizon = evaluated.reduce<Instant>((latest, candidate) => {
    const comparedAt = candidate.costComparison?.comparedAt;
    return comparedAt !== undefined && compareInstants(comparedAt, latest) > 0 ? comparedAt : latest;
  }, now);

  // 6. Deterministic viable-only comparison (C6). Derive comparator facts from
  //    provisional evidence for the VIABLE set, then select the recommendation.
  const viable = evaluated.filter((e) => e.result.strategy.viability === 'VIABLE');
  const viableCandidates = viable.map((e) => ({
    strategyRef: e.result.strategy.id as SubjectId,
    recoveryCaseId,
    viability: 'VIABLE' as const,
    stale: false,
  }));
  // Minor units only carry an ordering inside one currency. Preserve the full
  // evidence for presentation, but decline to rank costs when viable candidates
  // were compared into different home currencies.
  const viableHomeCurrencies = new Set(viable.flatMap((candidate) =>
    candidate.costComparison?.status === 'AVAILABLE' ? [candidate.costComparison.homeCurrency] : []));
  const canRankDeclaredCosts = viableHomeCurrencies.size <= 1;
  const provisionalFacts: CandidateComparisonFacts[] = [];
  for (const e of viable) {
    const provisional = materialCandidateFromEvaluation({
      candidateKey: e.candidateKey, proposerId: e.proposerId, domainId: e.domainId,
      strategyRef: e.result.strategy.id as SubjectId, recommended: false, result: e.result,
      evidenceRefs: evidenceRefsForDomain(evidence, e.domainId),
    });
    const costFacts = canRankDeclaredCosts ? declaredCostFacts(e.costComparison) : undefined;
    const facts = comparisonFactsFromEvidence(provisional, deps.preferences?.length
      ? { ...(costFacts ?? {}), satisfiedPreferenceCodes: satisfiedPreferenceCodes(provisional, deps.preferences) }
      : costFacts);
    if (facts) provisionalFacts.push(facts);
  }
  const recommendation: StrategyRecommendation | undefined = viableCandidates.length > 0
    ? selectRecommendation({
        recoveryCaseId, viableCandidates, facts: provisionalFacts,
        preferences: deps.preferences, comparatorVersion: deps.comparatorVersion,
      })
    : undefined;
  const recommendedRef = recommendation?.recommendedStrategyRef;

  // 7. Final material evidence with the honest RECOMMENDED / VIABLE_NOT_RECOMMENDED
  //    disposition, plus every deterministic rejection retained.
  const materialCandidates: MaterialCandidateEvidence[] = [...rejectedEvidence];
  const viableStrategies: RecoveryStrategy[] = [];
  for (const e of evaluated) {
    const strategyRef = e.result.strategy.viability === 'VIABLE' ? (e.result.strategy.id as SubjectId) : undefined;
    const recommended = strategyRef !== undefined && strategyRef === recommendedRef;
    materialCandidates.push(materialCandidateFromEvaluation({
      candidateKey: e.candidateKey, proposerId: e.proposerId, domainId: e.domainId,
      ...(strategyRef !== undefined ? { strategyRef } : {}),
      recommended, result: e.result,
      evidenceRefs: evidenceRefsForDomain(evidence, e.domainId),
      ...(e.costComparison !== undefined ? { costComparison: e.costComparison } : {}),
    }));
    if (e.result.strategy.viability === 'VIABLE') viableStrategies.push(e.result.strategy);
  }

  // 8. Closed planning-outcome mapping + assemble the immutable attempt.
  const outcome: RecoveryPlanningOutcome = planningOutcomeOf({
    basisStale: anyStale,
    researchBudgetExhausted,
    operatorDecisionRequired: false,
    viableStrategyCount: viableStrategies.length,
    recommendationProduced: recommendation !== undefined,
  });

  const attempt = assemblePlanningAttempt({
    id: deps.minters.attemptId,
    recoveryCaseId,
    basisAssessmentId,
    basisManifest: world.manifest,
    startedAt: deps.minters.startedAt,
    completedAt: completionHorizon,
    coordinatorVersion: deps.coordinatorVersion,
    domains,
    evidence: evidence.map((e) => e.record),
    materialCandidates,
    viableStrategyRefs: viableStrategies.map((s) => s.id as SubjectId),
    ...(recommendation ? { recommendation } : {}),
  });

  const result: RecoveryPlanningResult = {
    planningAttemptRef: attempt.id,
    basisAssessmentId,
    viableStrategyRefs: attempt.viableStrategyRefs,
    ...(recommendation ? { recommendation } : {}),
    outcome,
  };

  return { attempt, result, viableStrategies, researchBudgetExhausted, completionHorizon };
}

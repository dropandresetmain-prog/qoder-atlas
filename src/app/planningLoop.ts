/**
 * I3 — recovery planning loop: snapshot + impact -> planner -> read-only
 * tool dispatch -> planner continuation -> strategies -> isolated overlays
 * -> deterministic viability -> deterministic ranking.
 *
 * The planner never claims viability: every candidate strategy is evaluated
 * by the frozen OverlayViabilityEngine on an isolated copy of the snapshot.
 * Hard-infeasible candidates (FAIL or UNKNOWN on any HARD constraint) can
 * never win; their deterministic rejection reasons are preserved as evidence.
 * The loop never mutates authoritative state.
 */
import type { EntityId, IsoDateTime, UncertaintyRecord } from '../domain/common.ts';
import type { ImpactAssessment } from '../operational/impact.ts';
import type { TripSignal } from '../operational/signal.ts';
import type { TripSnapshot } from '../operational/snapshot.ts';
import type { RecoveryStrategy, ToolRequest } from '../operational/strategy.ts';
import { isLegalCaseTransition, type CaseStatus } from '../operational/case.ts';
import type { CapabilityDescriptor } from '../contracts/capabilities.ts';
import type { PlannerInput, PlannerOutput, PriorToolResult, RecoveryPlanner } from '../contracts/planner.ts';
import type { ViabilityEngine, ViabilityResult } from '../contracts/services.ts';
import type { AuditRepository, CaseRepository } from '../contracts/repositories.ts';
import type { EntityStore } from '../persistence/entityStore.ts';
import { CaseService } from '../engine/case.ts';
import type { AtlasTimezoneResolver } from '../providers/atlas/normalize.ts';
import { canonicalJson } from '../providers/recordingStore.ts';
import { dispatchToolRequest, summarizeToolResult, type ToolDispatchCapabilities, type ToolDispatchResult } from './dispatch.ts';

export interface ToolActivity {
  request: ToolRequest;
  result: ToolDispatchResult;
  summary: string;
}

export interface PlannedCandidate {
  strategy: RecoveryStrategy;
  /** Absent when the strategy proposes no overlay operations to evaluate. */
  viability?: ViabilityResult;
  feasible: boolean;
  /** Deterministic rejection reasons; empty when feasible. */
  rejectionReasons: string[];
}

export interface PlanningLoopInput {
  caseId: EntityId;
  snapshot: TripSnapshot;
  triggeringSignals: TripSignal[];
  impact: ImpactAssessment;
  capabilityRegistry: CapabilityDescriptor[];
  /** Deterministic instant for case/audit timestamps (never a wall clock). */
  planningAt: IsoDateTime;
  priorActionResults?: PlannerInput['priorActionResults'];
}

export interface PlanningLoopDependencies {
  planner: RecoveryPlanner;
  capabilities: ToolDispatchCapabilities;
  viability: ViabilityEngine;
  cases: CaseRepository;
  audit: AuditRepository;
  /** Bound on planner<->tool rounds; determinism over open-ended looping. */
  maxRounds?: number;
}

export interface PlanningOutcome {
  caseId: EntityId;
  rounds: number;
  toolActivity: ToolActivity[];
  strategies: RecoveryStrategy[];
  candidates: PlannedCandidate[];
  /** Feasible candidates in deterministic rank order (best first). */
  rankedFeasibleIds: EntityId[];
  bestStrategyId?: EntityId;
  assumptions: string[];
  uncertainties: UncertaintyRecord[];
  rationale?: string;
}

/** Run the full I3 loop for one recovery case. */
export async function runPlanningLoop(
  deps: PlanningLoopDependencies,
  input: PlanningLoopInput,
): Promise<PlanningOutcome> {
  const maxRounds = deps.maxRounds ?? 2;
  const priorActionResults = input.priorActionResults ?? [];
  const toolActivity: ToolActivity[] = [];
  const activityByKey = new Map<string, ToolActivity>();
  const priorToolResults: PriorToolResult[] = [];
  const assumptions: string[] = [];
  const uncertainties: UncertaintyRecord[] = [];
  let rationale: string | undefined;
  let output: PlannerOutput | undefined;
  let rounds = 0;

  for (let round = 1; round <= maxRounds; round += 1) {
    rounds = round;
    output = await deps.planner.plan({
      caseId: input.caseId,
      snapshot: input.snapshot,
      triggeringSignals: input.triggeringSignals,
      impact: input.impact,
      capabilityRegistry: input.capabilityRegistry,
      priorToolResults,
      priorActionResults,
    });
    for (const assumption of output.assumptions) {
      if (!assumptions.includes(assumption)) assumptions.push(assumption);
    }
    for (const uncertainty of output.uncertainties) {
      if (!uncertainties.some((existing) => existing.statement === uncertainty.statement)) {
        uncertainties.push(uncertainty);
      }
    }
    rationale = output.rationale ?? rationale;

    // Collect read-only requests from both the plan level and per strategy.
    const requests = dedupeRequests([...output.toolRequests, ...output.strategies.flatMap((s) => s.toolRequests)]);
    const fresh = requests.filter((request) => !activityByKey.has(requestKey(request)));
    if (fresh.length === 0) break;

    for (const request of fresh) {
      const result = await dispatchToolRequest(deps.capabilities, request);
      const summary = summarizeToolResult(request.operation, result);
      const activity: ToolActivity = { request, result, summary };
      toolActivity.push(activity);
      activityByKey.set(requestKey(request), activity);
      priorToolResults.push({ toolRequestId: request.id, summary, data: result.ok ? result.data : {} });
    }
  }

  const strategies = output?.strategies ?? [];

  // Deterministic viability for every candidate, on isolated overlays only.
  const candidates: PlannedCandidate[] = [];
  for (const strategy of strategies) {
    candidates.push(await evaluateCandidate(deps.viability, input.snapshot, strategy));
  }

  // Ranking: hard-infeasible candidates can never win. Among the feasible,
  // fewer soft tradeoffs first, then lower declared cost, then planner order.
  const feasible = candidates.filter((candidate) => candidate.feasible);
  const ranked = feasible
    .map((candidate, plannerIndex) => ({ candidate, plannerIndex }))
    .sort((a, b) => {
      const tradeoffs = softTradeoffCount(a.candidate) - softTradeoffCount(b.candidate);
      if (tradeoffs !== 0) return tradeoffs;
      const costDiff = declaredCost(a.candidate.strategy) - declaredCost(b.candidate.strategy);
      if (costDiff !== 0) return costDiff;
      return a.plannerIndex - b.plannerIndex;
    })
    .map((entry) => entry.candidate);

  // Case lifecycle + persisted evidence.
  const caseService = new CaseService({ cases: deps.cases });
  const recoveryCase = await deps.cases.getCase(input.caseId);
  if (recoveryCase && transitionIsLegal(recoveryCase.status, 'PLANNING')) {
    await caseService.transition(input.caseId, 'PLANNING', input.planningAt);
  }
  await caseService.record(input.caseId, input.planningAt, { strategies });

  await deps.audit.append({
    occurredAt: input.planningAt,
    actor: 'app:planning-loop',
    action: 'PLANNING_COMPLETED',
    subject: input.snapshot.tripId,
    payload: {
      caseId: input.caseId,
      rounds,
      toolRequestCount: toolActivity.length,
      toolFailureCount: toolActivity.filter((activity) => !activity.result.ok).length,
      strategyCount: strategies.length,
      feasibleCount: feasible.length,
      bestStrategyId: ranked[0]?.strategy.id,
    },
  });

  return {
    caseId: input.caseId,
    rounds,
    toolActivity,
    strategies,
    candidates,
    rankedFeasibleIds: ranked.map((candidate) => candidate.strategy.id),
    bestStrategyId: ranked[0]?.strategy.id,
    assumptions,
    uncertainties,
    rationale,
  };
}

/** Deterministic overlay evaluation for one candidate (also used by I5 read models). */
export async function evaluateCandidate(
  viability: ViabilityEngine,
  snapshot: TripSnapshot,
  strategy: RecoveryStrategy,
): Promise<PlannedCandidate> {
  if (strategy.candidateOperations.length === 0) {
    return {
      strategy,
      feasible: false,
      rejectionReasons: ['strategy proposes no candidate operations; nothing can be deterministically evaluated'],
    };
  }
  let result: ViabilityResult;
  try {
    result = await viability.evaluateOverlay({ baseSnapshot: snapshot, candidateOperations: strategy.candidateOperations });
  } catch (error) {
    // Overlay rejection is deterministic evidence, not a crash.
    return {
      strategy,
      feasible: false,
      rejectionReasons: [`candidate operations rejected by overlay engine: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
  const rejectionReasons: string[] = [];
  for (const constraintId of result.hardFailureIds) {
    const evaluation = result.constraintResults.find((r) => r.constraintId === constraintId);
    rejectionReasons.push(
      `hard constraint ${constraintId} FAILS${evaluation?.evidence ? ` (${evaluation.evidence})` : ''}`,
    );
  }
  for (const constraintId of result.unknownIds) {
    const evaluation = result.constraintResults.find((r) => r.constraintId === constraintId);
    rejectionReasons.push(
      `hard constraint ${constraintId} unresolved (UNKNOWN${evaluation?.evidence ? `: ${evaluation.evidence}` : ''}) — never treated as PASS`,
    );
  }
  return { strategy, viability: result, feasible: result.feasible, rejectionReasons };
}

function transitionIsLegal(from: CaseStatus, to: CaseStatus): boolean {
  return from !== to && isLegalCaseTransition(from, to);
}

function requestKey(request: ToolRequest): string {
  return `${request.operation}|${canonicalJson(request.parameters)}`;
}

/** One dispatch per distinct (operation, parameters) pair, stable order. */
function dedupeRequests(requests: ToolRequest[]): ToolRequest[] {
  const seen = new Set<string>();
  const unique: ToolRequest[] = [];
  for (const request of requests) {
    const key = requestKey(request);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(request);
  }
  return unique;
}

function softTradeoffCount(candidate: PlannedCandidate): number {
  return candidate.viability?.softTradeoffs.length ?? 0;
}

/** Declared cost ranks after tradeoffs; undeclared costs sort last. */
function declaredCost(strategy: RecoveryStrategy): number {
  return strategy.costImpact?.amount ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Airport-code -> IANA timezone resolver built from persisted PLACE entities
 * (generic externalRef matching; the adapter carries no location knowledge,
 * ADR-028). Unknown codes return undefined so normalization fails honestly.
 */
export function buildTimezoneResolver(entities: EntityStore): () => Promise<AtlasTimezoneResolver> {
  return async () => {
    const byCode = new Map<string, string>();
    for (const entry of await entities.list('PLACE')) {
      if (entry.entityType !== 'PLACE') continue;
      const place = entry.entity;
      for (const ref of place.externalRefs ?? []) {
        if (place.timezone && ref.value) byCode.set(ref.value.toUpperCase(), place.timezone);
      }
    }
    return (airportCode: string) => byCode.get(airportCode.toUpperCase());
  };
}

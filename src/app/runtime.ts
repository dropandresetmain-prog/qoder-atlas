/**
 * R1/PL-3 — generic runtime recovery flow + deterministic reset/reseed.
 *
 * Exposes the full recovery lifecycle (TripSignal -> impact -> planning ->
 * authority/decision -> execution -> observation -> verification) as
 * scenario-neutral operations over persisted state. There are NO
 * scenario-specific operations here: callers supply a TripSignal, a case id,
 * a strategy id or an approver ref, and the engine resolves everything from
 * authoritative state. A third scenario runs through this unchanged.
 *
 * Reset is a single audited wipe + reseed through the SAME seed path
 * bootstrap uses (seedScenarioBundle over the frozen mutation service) — no
 * manual SQLite surgery anywhere in the demo flow.
 */
import type { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import type { EntityId, IsoDateTime } from '../domain/common.ts';
import type { EntityRef } from '../domain/common.ts';
import type { CapabilityDescriptor } from '../contracts/capabilities.ts';
import type { RecoveryPlanner } from '../contracts/planner.ts';
import type { MutationService, ViabilityEngine } from '../contracts/services.ts';
import type {
  AuditRepository,
  CaseRepository,
  SignalRepository,
  SourceRepository,
  TripRepository,
} from '../contracts/repositories.ts';
import type { EntityStore } from '../persistence/entityStore.ts';
import { withTransaction } from '../persistence/database.ts';
import { ImpactEngine } from '../engine/impact.ts';
import { listScenarioDirs } from '../scenarios/loader.ts';
import { buildTripSnapshot, type SnapshotDependencies } from './snapshot.ts';
import { processSignal, type ProcessedSignal } from './signalPipeline.ts';
import { runPlanningLoop, type ToolActivity } from './planningLoop.ts';
import type { ToolDispatchCapabilities } from './dispatch.ts';
import { seedScenarioBundle } from './bootstrap.ts';
import type { RecoveryExecutionService } from './recoveryExecution.ts';
import type { PreferenceStore } from './preferenceStore.ts';
import type { TripSignal } from '../operational/signal.ts';
import type { ActionIntent } from '../operational/intent.ts';
import type { Money } from '../domain/common.ts';
import { describeAllocation } from '../engine/funding.ts';

export interface RuntimeDependencies {
  db: DatabaseSync;
  trips: TripRepository;
  entities: EntityStore;
  sources: SourceRepository;
  signals: SignalRepository;
  cases: CaseRepository;
  audit: AuditRepository;
  preferences: PreferenceStore;
  mutations: MutationService;
  execution: RecoveryExecutionService;
  planner: RecoveryPlanner;
  capabilities: ToolDispatchCapabilities;
  capabilityDescriptors: CapabilityDescriptor[];
  viability: ViabilityEngine;
  /** Scenario bundles live under `<fixturesDir>/scenarios` (generic walk). */
  fixturesDir: string;
}

export interface RuntimePlanOutcome {
  caseId: EntityId;
  tripId: EntityId;
  rounds: number;
  strategies: Array<{
    id: EntityId;
    summary: string;
    feasible: boolean;
    rejectionReasons: string[];
    costImpact?: Money;
  }>;
  bestStrategyId?: EntityId;
  toolActivity: Array<{ operation: string; ok: boolean; summary: string }>;
  uncertainties: string[];
  rationale?: string;
  caseStatus: string;
}

export interface RuntimeBeginOutcome {
  caseId: EntityId;
  intentId: EntityId;
  strategyId: EntityId;
  outcome: string;
  caseStatus: string;
  executable: boolean;
  ruleTrace: string[];
  /** Mixed-funding allocation (ADR-037); absent when UNKNOWN. */
  funding?: { allocation: NonNullable<ActionIntent['costAllocation']>; summary: string };
}

export interface RuntimeDecisionOutcome {
  accepted: boolean;
  verdict: 'APPROVED' | 'DECLINED';
  caseStatus: string;
  reason?: string;
}

export interface RuntimeExecuteOutcome {
  executed: boolean;
  caseStatus: string;
  gateIssues: string[];
  resolutionOutcome?: string;
  remainingLossRefs: EntityId[];
  simulated: boolean;
}

export interface RuntimeResetOutcome {
  reset: true;
  seededScenarios: string[];
  tripIds: EntityId[];
}

/**
 * Orchestrates the runtime recovery lifecycle. Every stage reads and writes
 * only through the frozen application seams; nothing here knows any scenario.
 */
export class RuntimeOrchestrator {
  private readonly deps: RuntimeDependencies;

  constructor(deps: RuntimeDependencies) {
    this.deps = deps;
  }

  /** Stage 1 — TripSignal through the I2 pipeline (mutation -> impact -> case). */
  async processDisruption(signal: TripSignal): Promise<ProcessedSignal> {
    return processSignal(
      {
        trips: this.deps.trips,
        signals: this.deps.signals,
        entities: this.deps.entities,
        cases: this.deps.cases,
        mutations: this.deps.mutations,
        audit: this.deps.audit,
      },
      signal,
    );
  }

  /** Stage 2 — planning loop for an open case at a caller-supplied instant. */
  async plan(input: { caseId: EntityId; at: IsoDateTime }): Promise<RuntimePlanOutcome> {
    const recoveryCase = await this.deps.cases.getCase(input.caseId);
    if (!recoveryCase) throw new Error(`unknown recovery case ${input.caseId}`);
    const signalId = recoveryCase.triggeredBySignalIds[recoveryCase.triggeredBySignalIds.length - 1];
    const signal = signalId ? await this.deps.signals.getSignal(signalId) : undefined;
    if (!signal) throw new Error(`case ${input.caseId} has no persisted triggering signal`);

    // Impact over the CURRENT authoritative state; the planner and viability
    // engine see the same assessment the pipeline produced.
    const impact = await new ImpactEngine({
      trips: this.deps.trips,
      signals: this.deps.signals,
      entities: this.deps.entities,
    }).assess(recoveryCase.tripId, signal.id);

    const snapshot = await buildTripSnapshot(this.snapshotDeps(), recoveryCase.tripId, input.at);
    const outcome = await runPlanningLoop(
      {
        planner: this.deps.planner,
        capabilities: this.deps.capabilities,
        viability: this.deps.viability,
        cases: this.deps.cases,
        audit: this.deps.audit,
      },
      {
        caseId: input.caseId,
        snapshot,
        triggeringSignals: [signal],
        impact,
        capabilityRegistry: this.deps.capabilityDescriptors,
        planningAt: input.at,
      },
    );
    const after = await this.deps.cases.getCase(input.caseId);
    return {
      caseId: input.caseId,
      tripId: recoveryCase.tripId,
      rounds: outcome.rounds,
      strategies: outcome.candidates.map((candidate) => ({
        id: candidate.strategy.id,
        summary: candidate.strategy.summary,
        feasible: candidate.feasible,
        rejectionReasons: candidate.rejectionReasons,
        ...(candidate.strategy.costImpact ? { costImpact: candidate.strategy.costImpact } : {}),
      })),
      bestStrategyId: outcome.bestStrategyId,
      toolActivity: outcome.toolActivity.map(activityToWire),
      uncertainties: outcome.uncertainties.map((u) => u.statement),
      rationale: outcome.rationale,
      caseStatus: after?.status ?? recoveryCase.status,
    };
  }

  /** Stage 3 — strategy -> intent -> deterministic authority decision. */
  async begin(input: { caseId: EntityId; strategyId: EntityId; at: IsoDateTime }): Promise<RuntimeBeginOutcome> {
    const recoveryCase = await this.deps.cases.getCase(input.caseId);
    if (!recoveryCase) throw new Error(`unknown recovery case ${input.caseId}`);
    const strategy = recoveryCase.strategies.find((candidate) => candidate.id === input.strategyId);
    if (!strategy) throw new Error(`case ${input.caseId} has no strategy ${input.strategyId}`);
    const snapshot = await buildTripSnapshot(this.snapshotDeps(), recoveryCase.tripId, input.at);
    const staged = await this.deps.execution.beginStrategy({
      snapshot,
      caseId: input.caseId,
      strategy,
      at: input.at,
    });
    return {
      caseId: input.caseId,
      intentId: staged.intent.id,
      strategyId: strategy.id,
      outcome: staged.decision.outcome,
      caseStatus: staged.caseStatus,
      executable: staged.executable,
      ruleTrace: staged.decision.ruleTrace,
      ...(staged.intent.costAllocation
        ? { funding: { allocation: staged.intent.costAllocation, summary: describeAllocation(staged.intent.costAllocation) } }
        : {}),
    };
  }

  /** Stage 4 — approval/decline by a caller-named principal (type-checked). */
  async decide(input: {
    caseId: EntityId;
    intentId: EntityId;
    decidedBy: EntityRef;
    verdict: 'APPROVED' | 'DECLINED';
    at: IsoDateTime;
    note?: string;
  }): Promise<RuntimeDecisionOutcome> {
    const outcome = await this.deps.execution.recordApproval({
      caseId: input.caseId,
      intentId: input.intentId,
      decidedBy: input.decidedBy,
      decidedAt: input.at,
      verdict: input.verdict,
      ...(input.note ? { note: input.note } : {}),
    });
    return {
      accepted: outcome.accepted,
      verdict: input.verdict,
      caseStatus: outcome.caseStatus,
      ...(outcome.reason ? { reason: outcome.reason } : {}),
    };
  }

  /** Stage 5 — gate-checked execution -> observation -> verification. */
  async execute(input: { caseId: EntityId; intentId: EntityId; at: IsoDateTime }): Promise<RuntimeExecuteOutcome> {
    const outcome = await this.deps.execution.executeApproved(input);
    return {
      executed: outcome.executed,
      caseStatus: outcome.caseStatus,
      gateIssues: outcome.gateIssues,
      ...(outcome.verification?.resolution ? { resolutionOutcome: outcome.verification.resolution.outcome } : {}),
      remainingLossRefs: outcome.verification?.remainingLossRefs ?? [],
      simulated: outcome.result?.provenance === 'SIMULATED',
    };
  }

  /**
   * Deterministic reset/reseed: wipe every logical store in one transaction,
   * then reseed all accepted scenario bundles through the same validated seed
   * path bootstrap uses. Identical fixtures => identical starting state; no
   * manual database surgery needed to restore the demo.
   */
  async reset(at: IsoDateTime): Promise<RuntimeResetOutcome> {
    withTransaction(this.deps.db, () => {
      for (const table of ['audit', 'source_contents', 'sources', 'signals', 'cases', 'trips', 'entities', 'preferences']) {
        this.deps.db.exec(`DELETE FROM ${table}`);
      }
    });

    const seededScenarios: string[] = [];
    const tripIds: EntityId[] = [];
    for (const scenarioDir of listScenarioDirs(join(this.deps.fixturesDir, 'scenarios'))) {
      const outcome = await seedScenarioBundle(
        {
          mutations: this.deps.mutations,
          sources: this.deps.sources,
          preferences: this.deps.preferences,
          audit: this.deps.audit,
        },
        scenarioDir,
      );
      seededScenarios.push(outcome.scenarioId);
      tripIds.push(outcome.tripId);
    }
    await this.deps.audit.append({
      occurredAt: at,
      actor: 'app:runtime',
      action: 'RUNTIME_RESET',
      subject: tripIds[0],
      payload: { seededScenarios, tripIds },
    });
    return { reset: true, seededScenarios, tripIds };
  }

  private snapshotDeps(): SnapshotDependencies {
    return {
      trips: this.deps.trips,
      entities: this.deps.entities,
      preferences: this.deps.preferences,
      sources: this.deps.sources,
    };
  }
}

function activityToWire(activity: ToolActivity): { operation: string; ok: boolean; summary: string } {
  return { operation: activity.request.operation, ok: activity.result.ok, summary: activity.summary };
}

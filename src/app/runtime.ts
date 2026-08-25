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
import { runPlanningLoop, type CandidateRejectionEvidence, type ToolActivity } from './planningLoop.ts';
import type { ToolDispatchCapabilities } from './dispatch.ts';
import { seedScenarioBundle } from './bootstrap.ts';
import { listProgrammeDirs, seedProgrammeBundle } from './programmeSeed.ts';
import type { ProgrammeService } from './programme.ts';
import type { BookingDossierStore } from './dossierStore.ts';
import { signalHorizon, liftToHorizon, type RecoveryExecutionService } from './recoveryExecution.ts';
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
  /**
   * Optional programme bundles under `<fixturesDir>/programmes`: reset also
   * reseeds programme-scale state through the programme services. Absent
   * keeps the scenario-only reset semantics unchanged.
   */
  programmeService?: ProgrammeService;
  /**
   * Application-owned booking dossier store (Mission 2): reset wipes and
   * reseeds provider-facing booking identity through the same bundle path.
   * Absent keeps prior reset semantics (no dossiers seeded).
   */
  dossiers?: BookingDossierStore;
}

export interface RuntimePlanOutcome {
  caseId: EntityId;
  tripId: EntityId;
  rounds: number;
  strategies: Array<{
    id: EntityId;
    summary: string;
    feasible: boolean;
    rejectionEvidence: CandidateRejectionEvidence[];
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
  /** Programme bundles reseeded (empty when none are wired). */
  seededProgrammes: Array<{ anchorEventId: EntityId; promotedCount: number }>;
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

  /** Stage 1 — TripSignal through the I2 pipeline (mutation -> impact -> case).
   *
   * DR-1.1: when the caller supplies an explicit instant and the signal carries
   * no receivedAt of its own, the system stamps receivedAt with that instant so
   * the signal's causal instant is coherent with when the runtime actually
   * received it. Fixture-carried receivedAt is scenario truth and is preserved.
   */
  async processDisruption(signal: TripSignal, at?: IsoDateTime): Promise<ProcessedSignal> {
    const coherentSignal =
      signal.receivedAt === undefined && at !== undefined ? { ...signal, receivedAt: at } : signal;
    return processSignal(
      {
        trips: this.deps.trips,
        signals: this.deps.signals,
        entities: this.deps.entities,
        cases: this.deps.cases,
        mutations: this.deps.mutations,
        audit: this.deps.audit,
      },
      coherentSignal,
    );
  }

  /** Stage 2 — planning loop for an open case at a caller-supplied instant. */
  async plan(input: { caseId: EntityId; at: IsoDateTime }): Promise<RuntimePlanOutcome> {
    const recoveryCase = await this.deps.cases.getCase(input.caseId);
    if (!recoveryCase) throw new Error(`unknown recovery case ${input.caseId}`);
    const signalId = recoveryCase.triggeredBySignalIds[recoveryCase.triggeredBySignalIds.length - 1];
    const signal = signalId ? await this.deps.signals.getSignal(signalId) : undefined;
    if (!signal) throw new Error(`case ${input.caseId} has no persisted triggering signal`);

    // Timeline coherence (DR-1.1): planning happens causally downstream of the
    // disruption, so the planning/snapshot instant is lifted to the horizon.
    const at = liftToHorizon(
      input.at,
      await signalHorizon(this.deps.signals, recoveryCase.triggeredBySignalIds),
    );

    // Impact over the CURRENT authoritative state; the planner and viability
    // engine see the same assessment the pipeline produced.
    const impact = await new ImpactEngine({
      trips: this.deps.trips,
      signals: this.deps.signals,
      entities: this.deps.entities,
    }).assess(recoveryCase.tripId, signal.id);

    const snapshot = await buildTripSnapshot(this.snapshotDeps(), recoveryCase.tripId, at);
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
        planningAt: at,
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
        rejectionEvidence: candidate.rejectionEvidence,
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
   * then reseed all accepted scenario bundles AND programme bundles through
   * the same validated seed paths bootstrap uses. Identical fixtures =>
   * identical starting state (trips, programmes, audit) — no residue between
   * demo cases and no manual database surgery anywhere in the demo flow.
   */
  async reset(at: IsoDateTime): Promise<RuntimeResetOutcome> {
    withTransaction(this.deps.db, () => {
      const tables = ['audit', 'source_contents', 'sources', 'signals', 'cases', 'trips', 'entities', 'preferences'];
      if (this.deps.dossiers) tables.push('booking_dossiers');
      // Application-owned ingress dedup state (lazily created by the event
      // inbox store): reset must forget previously-delivered provider events
      // too, otherwise a deterministic rerun of the same acceptance manifest
      // is rejected as a duplicate delivery instead of re-executing.
      const inboxTable = this.deps.db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'provider_event_inbox'`)
        .get();
      if (inboxTable) tables.push('provider_event_inbox');
      for (const table of tables) {
        this.deps.db.exec(`DELETE FROM ${table}`);
      }
    });

    const seededScenarios: string[] = [];
    const tripIds: EntityId[] = [];
    for (const scenarioDir of listScenarioDirs(join(this.deps.fixturesDir, 'scenarios'))) {
      try {
        const outcome = await seedScenarioBundle(
          {
            mutations: this.deps.mutations,
            sources: this.deps.sources,
            preferences: this.deps.preferences,
            audit: this.deps.audit,
            ...(this.deps.dossiers ? { dossiers: this.deps.dossiers } : {}),
          },
          scenarioDir,
        );
        seededScenarios.push(outcome.scenarioId);
        tripIds.push(outcome.tripId);
      } catch {
        // Non-fatal: lightweight generic acceptance-descriptor packs (DR-9
        // S1-S4) live alongside full engine ScenarioSpec bundles under
        // fixtures/scenarios/ but do not conform to the ScenarioSpec
        // contract — reset must skip them exactly as boot composition does
        // (compose.ts), never fail the whole reset over a non-engine fixture.
      }
    }

    // Programme-scale state reseeds through the SAME services the HTTP
    // surface uses — the bundle carries all demo facts.
    const seededProgrammes: Array<{ anchorEventId: EntityId; promotedCount: number }> = [];
    if (this.deps.programmeService) {
      for (const programmeDir of listProgrammeDirs(join(this.deps.fixturesDir, 'programmes'))) {
        const outcome = await seedProgrammeBundle(this.deps.programmeService, programmeDir);
        seededProgrammes.push({ anchorEventId: outcome.anchorEventId, promotedCount: outcome.promotedCount });
        tripIds.push(...outcome.tripIds);
      }
    }

    await this.deps.audit.append({
      occurredAt: at,
      actor: 'app:runtime',
      action: 'RUNTIME_RESET',
      subject: tripIds[0],
      payload: { seededScenarios, tripIds, seededProgrammes },
    });
    return { reset: true, seededScenarios, tripIds, seededProgrammes };
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

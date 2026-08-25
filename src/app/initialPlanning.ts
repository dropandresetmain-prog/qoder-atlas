/**
 * Northstar RV-N3 — initial viable trip planning (Wave 2).
 *
 * A programme traveller imported via intake has an engagement-only Trip (zero
 * booked elements). This service does NOT introduce a second planning engine:
 * it routes the request through the EXISTING frozen pipeline (signal -> case ->
 * planning loop) and classifies the case as `INITIAL_PLANNING` so the same
 * downstream machinery can advance it. A thin deterministic wrapper stands
 * beside `processSignal` for the one place the frozen pipeline cannot set
 * `caseKind` (initial planning is not a recovery) — opening, transition and
 * audit are still via the frozen CaseService / CaseRepository / AuditRepository
 * seams; no direct repository writes, no state mutation outside the
 * `MutationService`.
 *
 * The planning loop is the same `runPlanningLoop` (I3) that recovery uses.
 * Strategies remain proposals: deterministic viability through the injected
 * ViabilityEngine decides feasible vs UNKNOWN, and a strategy with UNKNOWN
 * hard feasibility is reported as such (never PASS). The wrapper refuses a
 * trip that already has booked elements — that path goes through the
 * ordinary change-request / recovery flow, never a parallel engine.
 */
import type { EntityId, IsoDateTime, UncertaintyRecord } from '../domain/common.ts';
import { IsoDateTimeSchema } from '../domain/common.ts';
import { TripSignalSchema, type TripSignal } from '../operational/signal.ts';
import type { Trip } from '../domain/trip.ts';
import type { RecoveryStrategy } from '../operational/strategy.ts';
import type { CaseStatus, RecoveryCase } from '../operational/case.ts';
import type { ImpactAssessment } from '../operational/impact.ts';
import type { CapabilityDescriptor } from '../contracts/capabilities.ts';
import type { RecoveryPlanner } from '../contracts/planner.ts';
import type { ViabilityEngine } from '../contracts/services.ts';
import type { AuditRepository, CaseRepository, SignalRepository, TripRepository } from '../contracts/repositories.ts';
import type { EntityStore } from '../persistence/entityStore.ts';
import { CaseService } from '../engine/case.ts';
import { ImpactEngine } from '../engine/impact.ts';
import { buildTripSnapshot, type SnapshotDependencies } from './snapshot.ts';
import { runPlanningLoop, type CandidateRejectionEvidence, type PlannedCandidate, type PlanningLoopDependencies } from './planningLoop.ts';
import type { ToolDispatchCapabilities } from './dispatch.ts';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export interface InitialPlanningDeps {
  trips: TripRepository;
  entities: EntityStore;
  signals: SignalRepository;
  cases: CaseRepository;
  audit: AuditRepository;
  /**
   * Scriptable planner seam. The integrator wires the production planner;
   * tests inject a deterministic in-test registry.
   */
  planner: RecoveryPlanner;
  capabilities: ToolDispatchCapabilities;
  capabilityDescriptors: CapabilityDescriptor[];
  viability: ViabilityEngine;
  sources: SnapshotDependencies['sources'];
  preferences: SnapshotDependencies['preferences'];
  /**
   * Bound on planner<->tool rounds; matches the I3 default. Tests may lower
   * it to keep loops fast.
   */
  maxRounds?: number;
}

export interface InitialPlanningRequest {
  tripId: EntityId;
  at: IsoDateTime;
}

export interface InitialPlanningStrategyView {
  id: EntityId;
  summary: string;
  /** Determined by the injected ViabilityEngine; UNKNOWN hard feasibility never becomes true. */
  feasible: boolean;
  rejectionEvidence: CandidateRejectionEvidence[];
}

export interface InitialPlanningOutcome {
  accepted: boolean;
  caseId?: EntityId;
  caseStatus?: CaseStatus;
  tripId: EntityId;
  strategies: InitialPlanningStrategyView[];
  uncertainties: UncertaintyRecord[];
  issues: string[];
  rationale?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Open or reuse the trip's INITIAL_PLANNING case and run the I3 planning
 * loop against the trip snapshot at `at`. The case is classified via the
 * frozen CaseService with `caseKind: 'INITIAL_PLANNING'`; the wrapper around
 * `processSignal` exists only because that pipeline does not accept a
 * caseKind parameter today.
 *
 * The service refuses trips that are not in the planning-lane shape
 * (missing trip, or already has any non-NONE reservation). Refusal is a
 * structured outcome, not an exception.
 */
export async function startInitialPlanning(
  deps: InitialPlanningDeps,
  request: InitialPlanningRequest,
): Promise<InitialPlanningOutcome> {
  const trip = await deps.trips.getTrip(request.tripId);
  if (!trip) {
    return {
      accepted: false,
      tripId: request.tripId,
      strategies: [],
      uncertainties: [],
      issues: [`unknown trip ${request.tripId}`],
    };
  }
  if (hasBookedElement(trip)) {
    return {
      accepted: false,
      tripId: request.tripId,
      strategies: [],
      uncertainties: [],
      issues: ['trip already has booked elements; initial planning only applies to engagement-only trips'],
    };
  }

  const at = IsoDateTimeSchema.parse(request.at);

  // 1. Persist a TRAVELLER_INPUT signal (audit chain starts here; frozen
  //    signal vocabulary covers traveller desires; never overwrites authoritative
  //    state because the pipeline is read-only for this kind).
  const signal: TripSignal = TripSignalSchema.parse({
    id: `sig-init-${request.tripId}-${idifyInstant(at)}`,
    kind: 'TRAVELLER_INPUT',
    occurredAt: at,
    receivedAt: at,
    sourceId: `traveller-${trip.travellerIds[0] ?? 'system'}`,
    authority: 'ASSERTED',
    tripId: request.tripId,
    summary: 'programme traveller requires initial viable trip planning',
    payload: { request: 'INITIAL_PLANNING' },
  });
  await deps.signals.saveSignal(signal);

  // 2. Thin deterministic wrapper around the case pipeline: the frozen
  //    `processSignal` always opens a RECOVERY case; for INITIAL_PLANNING the
  //    case is opened with the right caseKind via the SAME CaseService /
  //    CaseRepository, never a fork.
  const caseService = new CaseService({ cases: deps.cases });
  const caseId = `case-init-${request.tripId}-${idifyInstant(at)}`;
  let recoveryCase: RecoveryCase | undefined = await deps.cases.getCase(caseId);
  if (!recoveryCase) {
    recoveryCase = await caseService.open({
      id: caseId,
      tripId: request.tripId,
      openedAt: at,
      caseKind: 'INITIAL_PLANNING',
      triggeredBySignalIds: [signal.id],
      affectedElementIds: [],
      failedConstraintIds: [],
    });
  }
  if (recoveryCase.status === 'DETECTED') {
    recoveryCase = await caseService.transition(caseId, 'ASSESSING', at);
  }

  // 3. Deterministic impact: a trip with no booked elements yields no direct
  //    failures, so the impact is the LOW-severity baseline; this is the same
  //    engine recovery uses.
  const impactEngine = new ImpactEngine({
    trips: deps.trips,
    signals: deps.signals,
    entities: deps.entities,
  });
  const impact: ImpactAssessment = await impactEngine.assess(request.tripId, signal.id);

  // 4. Snapshot at the planning instant; the planner sees the same state the
  //    rest of the engine sees.
  const snapshot = await buildTripSnapshot(
    { trips: deps.trips, entities: deps.entities, preferences: deps.preferences, sources: deps.sources },
    request.tripId,
    at,
  );

  // 5. Same I3 loop. The loop owns case->PLANNING transition and audit;
  //    nothing here bypasses those.
  const planningDeps: PlanningLoopDependencies = {
    planner: deps.planner,
    capabilities: deps.capabilities,
    viability: deps.viability,
    cases: deps.cases,
    audit: deps.audit,
    ...(deps.maxRounds !== undefined ? { maxRounds: deps.maxRounds } : {}),
  };
  const planningOutcome = await runPlanningLoop(planningDeps, {
    caseId,
    snapshot,
    triggeringSignals: [signal],
    impact,
    capabilityRegistry: deps.capabilityDescriptors,
    planningAt: at,
  });

  // 6. Per-candidate feasibility view for callers/read models. UNKNOWN hard
  //    feasibility is reported as `feasible: false` with engine-owned reasons
  //    (the same discipline the I3 read models use).
  const strategies: InitialPlanningStrategyView[] = planningOutcome.candidates.map(
    (candidate: PlannedCandidate) => ({
      id: candidate.strategy.id,
      summary: candidate.strategy.summary,
      feasible: candidate.feasible,
      rejectionEvidence: [...candidate.rejectionEvidence],
    }),
  );

  const after = await deps.cases.getCase(caseId);

  // 7. Audit the initial-planning completion with the candidate evidence so
  //    the read models can surface deterministic verdicts (mirrors the I3
  //    PLANNING_COMPLETED audit).
  await deps.audit.append({
    occurredAt: at,
    actor: 'app:initial-planning',
    action: 'INITIAL_PLANNING_COMPLETED',
    subject: request.tripId,
    payload: {
      caseId,
      caseKind: 'INITIAL_PLANNING',
      strategyCount: planningOutcome.strategies.length,
      feasibleCount: planningOutcome.candidates.filter((c) => c.feasible).length,
      bestStrategyId: planningOutcome.bestStrategyId,
      candidateVerdicts: planningOutcome.candidates.map((candidate) => ({
        strategyId: candidate.strategy.id,
        feasible: candidate.feasible,
        rejectionEvidence: candidate.rejectionEvidence,
      })),
    },
  });

  return {
    accepted: true,
    caseId,
    caseStatus: after?.status,
    tripId: request.tripId,
    strategies,
    uncertainties: planningOutcome.uncertainties,
    issues: [],
    ...(planningOutcome.rationale !== undefined ? { rationale: planningOutcome.rationale } : {}),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert an ISO instant to a deterministic EntityId-safe token. The frozen
 * EntityIdSchema accepts `[A-Za-z0-9_\-:.]` only, but ISO strings include
 * `T`, `+`, `:` and (for some zones) other characters. We substitute a
 * stable token so case/signal ids stay schema-valid.
 */
function idifyInstant(iso: IsoDateTime): string {
  return iso.replace(/[^A-Za-z0-9_\-:.]/g, '-');
}

/**
 * A zero-booked trip is one whose only elements are ENGAGEMENTs (or no
 * elements at all) AND every non-ENGAGEMENT element has `reservationState
 * === 'NONE'`. Programme-intake output already meets this shape; an
 * arbitrary user-built trip with a single HELD stay is refused.
 */
export function hasBookedElement(trip: Trip): boolean {
  for (const element of trip.elements) {
    if (element.reservationState !== 'NONE') return true;
  }
  return false;
}

/** Map an INITIAL_PLANNING outcome into the planner-owned strategies. */
export function strategiesFromOutcome(
  outcome: InitialPlanningOutcome,
  persisted: readonly RecoveryStrategy[],
): InitialPlanningStrategyView[] {
  if (outcome.strategies.length > 0) return outcome.strategies;
  return persisted.map((strategy) => ({
    id: strategy.id,
    summary: strategy.summary,
    feasible: false,
    rejectionEvidence: [{ kind: 'NO_CANDIDATE_OPERATIONS' }],
  }));
}

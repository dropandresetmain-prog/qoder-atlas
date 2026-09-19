/**
 * NORTHSTAR R1 — Recovery Planning Coordinator ADAPTER (freeze C1), the thin
 * application binding of the pure coordinator core to PostgreSQL.
 *
 * This is NOT a second engine. It implements the frozen
 * `RecoveryPlanningCoordinator.planCase` port by:
 *   1. reading the CURRENT planning basis from canonical PostgreSQL exactly as
 *      the accepted B1 seam does (case status -> failing subjects -> captured
 *      world -> current-state reader), using the same public read helpers;
 *   2. delegating ALL decision logic to the pure `runRecoveryPlanning` core
 *      (domain registry, proposers, REAL RC-6 evaluation, decision evidence,
 *      comparator, outcome mapping). The adapter adds no viability semantics;
 *   3. persisting the core's outputs through REAL commands: each VIABLE
 *      RecoveryStrategy via `persistRecoveryStrategy`, then the ONE immutable
 *      `RecoveryPlanningAttempt` via `persistRecoveryPlanningAttempt` (migration
 *      0125), then advancing the case phase with the existing lifecycle command;
 *   4. returning the frozen `RecoveryPlanningResult`.
 *
 * Ownership boundaries are preserved: the coordinator owns planning-artefact
 * persistence ONLY. It does not own canonical mutation (that stays with the
 * strategy/case commands), hard viability (RC-6), authority, consequential
 * execution, provider-observed truth or case resolution. Deterministic identity
 * is minted the same way as the B1 seam (`deterministicUuid`) so retries/replays
 * are idempotent per (case, basis, candidate).
 *
 * Cloud status: this adapter requires PostgreSQL and is therefore typechecked
 * and linted in Cloud but NOT executed here; its runtime acceptance is a LOCAL
 * integration-acceptance item (see docs/work/ACTIVE_TASK.md). The pure core it
 * delegates to IS executed and generality-proven in Cloud.
 */
import type { Pool } from '../../persistence/postgres/pool.ts';
import type { PgUnitOfWork } from '../../persistence/postgres/pgUnitOfWork.ts';
import type { TypedRef, SubjectId } from '../../domain/v2/shared/identity.ts';
import type { ApplicationError } from '../../contracts/v2/product/readModels.ts';
import type { CapturedWorld } from '../../resolution/world/world.ts';
import type { EffectiveWorld } from '../../resolution/world/effectiveTypes.ts';
import type { CurrentState } from '../../resolution/world/currentness.ts';
import type { EvaluatorRegistry } from '../../resolution/evaluation/assess.ts';
import type {
  RecoveryPlanningCoordinator,
  RecoveryPlanningInput,
  RecoveryPlanningResult,
} from '../../contracts/v2/planning/recoveryPlanningAttempt.ts';
import type { RecoveryDomainId } from '../../contracts/v2/planning/recoveryDomain.ts';
import type { StrategyProposer } from '../../resolution/planning/proposer.ts';
import type { CapabilityFamily } from '../../operational/strategy.ts';
import type { PlanningToolTransport } from '../../resolution/planning/researchDispatcher.ts';
import { captureWorld, PgCurrentStateReader } from '../../persistence/postgres/world/pgCurrentState.ts';
import { currentAssessmentView } from '../../persistence/postgres/world/pgAssessments.ts';
import { persistRecoveryPlanningCompletion } from '../../persistence/postgres/commands/r1PlanningAttemptCommands.ts';
import { createM6Registry } from '../../resolution/evaluation/registry.ts';
import { projectEffectiveWorld } from '../../resolution/world/effectiveItinerary.ts';
import { unmetProgrammeItems, type FailingSubject } from '../../resolution/planning/proposer.ts';
import { createProgrammeTimeSwapProposer } from '../../resolution/planning/proposers/programmeTimeSwapProposer.ts';
import { createTransportProposer } from '../../resolution/planning/proposers/transportProposer.ts';
import { materializeTransportOffers } from '../../resolution/planning/transportOfferMaterialization.ts';
import { airportResolverFromCapturedWorld, flightSearchRequestFor, transportCorridors, type AirportResolver, type TransportPassengerSource } from '../../resolution/planning/transportCorridors.ts';
import { defaultRecoveryDomainRegistry } from '../../resolution/planning/recoveryDomains.ts';
import {
  runRecoveryPlanning,
  type CoordinatorMinters,
  type DomainProposerBinding,
} from '../../resolution/planning/coordinatorCore.ts';
import { loadPlanningPreferences, preferenceOwnerIds } from './planningPreferences.ts';
import { advanceCasePhase } from './recoveryPlanning.ts';
import { deterministicUuid, RUNTIME_ID_NAMESPACES } from './deterministicId.ts';
import { applicationError } from './applicationCommands.ts';

export const R1_COORDINATOR_VERSION = 'r1-coordinator/1';
export const R1_COMPARATOR_VERSION = 'r1-comparator/1';

const TERMINAL = new Set(['RESOLVED', 'CLOSED', 'CANCELLED', 'SUPERSEDED']);

/** Dependencies of the coordinator adapter, all injected by the composition root. */
export interface RecoveryPlanningCoordinatorDeps {
  pool: Pool;
  workspaceId: string;
  actorPrincipalId: string;
  uow: () => PgUnitOfWork;
  now?: string;
  /** Domain-bound proposers; defaults to the shipped deterministic PROGRAMME proposer. */
  proposers?: readonly DomainProposerBinding[];
  /** Capability families actually available to this composition (drives fail-closed domain selection). */
  availableCapabilities?: readonly CapabilityFamily[];
  /** Domain registry; defaults to the frozen initial registry. */
  domainRegistry?: ReturnType<typeof defaultRecoveryDomainRegistry>;
  coordinatorVersion?: string;
  comparatorVersion?: string;
  /**
   * Optional provider read-only transport capability. Supplying it activates
   * generalized TRANSPORT research; omitting it leaves the domain unavailable
   * rather than inventing a provider or passenger count.
   *
   * The search party comes from `passengersFor` (derived per corridor from
   * authoritative state — the R3 shape the composition root supplies) or the
   * retained pre-R3 static `passengers` value; exactly one is required
   * (`TransportPassengerSource`). Neither is defaulted here.
   */
  transportPlanning?: {
    transport: PlanningToolTransport;
    resolveAirport?: AirportResolver;
    maxOffersPerCorridor?: number;
  } & TransportPassengerSource;
}

/** The default domain-bound proposers shipped with the runtime (the PROGRAMME time-swap). */
export function defaultDomainProposers(): DomainProposerBinding[] {
  return [{ domain: 'PROGRAMME' as RecoveryDomainId, proposer: createProgrammeTimeSwapProposer() as StrategyProposer }];
}

/**
 * G01: the coordinator NEVER advertises a capability family it was not composed
 * with. The only family it can derive on its own is FLIGHT, from the presence of
 * a real `transportPlanning` transport; everything else must be passed
 * explicitly by the composition root (derived from really-composed adapters).
 * No composition => empty => provider-backed domains fail closed UNAVAILABLE.
 */
export function derivedCapabilities(transportPlanning: unknown): readonly CapabilityFamily[] {
  return transportPlanning ? ['FLIGHT'] : [];
}

interface BasisCapture {
  failing: FailingSubject[];
  world: CapturedWorld;
  effective: EffectiveWorld;
  currentState: CurrentState;
  registry: EvaluatorRegistry;
  basisAssessmentId: string;
  programmeIds: string[];
}

async function caseStatus(pool: Pool, workspaceId: string, caseId: string): Promise<string | undefined> {
  const row = await pool.query<{ lifecycle_status: string }>(
    'SELECT lifecycle_status FROM recovery_cases WHERE workspace_id = $1 AND id = $2',
    [workspaceId, caseId],
  );
  return row.rows[0]?.lifecycle_status;
}

/**
 * Read the CURRENT planning basis from canonical PostgreSQL. Mirrors the
 * accepted B1 seam's basis capture exactly (same reads, same order) so the two
 * planning entry points cannot diverge on what "the current basis" means.
 */
/**
 * The case's CURRENT failing JOURNEY/TRIP subjects in the canonical order
 * (kind, id). The first one's assessment id IS the planning basis; the lifecycle
 * progression pass uses this same function so "the current basis" has exactly
 * one definition.
 */
export async function loadFailingCaseSubjects(pool: Pool, workspaceId: string, caseId: string, now: string): Promise<FailingSubject[]> {
  const subjects = await pool.query<{ subject_kind: string; subject_id: string }>(
    `SELECT subject_kind, subject_id FROM case_subjects WHERE workspace_id = $1 AND recovery_case_id = $2 AND subject_kind IN ('JOURNEY', 'TRIP') ORDER BY subject_kind, subject_id`,
    [workspaceId, caseId],
  );
  const failing: FailingSubject[] = [];
  for (const row of subjects.rows) {
    const subject: TypedRef = { kind: row.subject_kind as TypedRef['kind'], id: row.subject_id };
    const view = await currentAssessmentView(pool, workspaceId, subject, 'VIABILITY', now);
    if (view.status === 'CURRENT' && view.assessment && view.assessment.overallVerdict === 'FAIL') {
      failing.push({ subject, assessment: view.assessment });
    }
  }
  return failing;
}

async function capturePlanningBasis(deps: RecoveryPlanningCoordinatorDeps, caseId: string, now: string): Promise<BasisCapture | undefined> {
  const failing = await loadFailingCaseSubjects(deps.pool, deps.workspaceId, caseId, now);
  if (failing.length === 0) return undefined;

  const unmetItemIds = [...new Set(failing.flatMap((f) => unmetProgrammeItems(f.assessment).map((r) => r.id)))];
  const programmeRefs: TypedRef[] = unmetItemIds.length === 0 ? [] : (await deps.pool.query<{ programme_id: string }>(
    'SELECT DISTINCT programme_id FROM programme_items WHERE workspace_id = $1 AND id = ANY($2::uuid[]) ORDER BY programme_id',
    [deps.workspaceId, unmetItemIds],
  )).rows.map((r) => ({ kind: 'PROGRAMME' as const, id: r.programme_id }));

  const registry = createM6Registry();
  const world = await captureWorld(deps.pool, {
    workspaceId: deps.workspaceId,
    focus: [...failing.map((f) => f.subject), ...programmeRefs],
    at: now,
    informationTopics: registry.informationTopics,
  });
  const effective = projectEffectiveWorld(world);
  const currentState = await new PgCurrentStateReader(deps.pool).loadFor(deps.workspaceId, world.manifest);
  return { failing, world, effective, currentState, registry, basisAssessmentId: failing[0]!.assessment.id, programmeIds: programmeRefs.map((r) => r.id as string) };
}

/** Deterministic id/version minters, mirroring the B1 seam's planning namespace. */
function planningMinters(deps: RecoveryPlanningCoordinatorDeps, caseId: string, basisAssessmentId: string, now: string, baseStrategyVersion: number): CoordinatorMinters {
  const attemptId = deterministicUuid(RUNTIME_ID_NAMESPACES.planning, `${deps.workspaceId}|planning-attempt|${caseId}|${basisAssessmentId}`);
  return {
    attemptId: attemptId as SubjectId,
    startedAt: now,
    mintStrategyId: (candidateKey) =>
      deterministicUuid(RUNTIME_ID_NAMESPACES.planning, `${deps.workspaceId}|strategy|${caseId}|${basisAssessmentId}|${candidateKey}`) as SubjectId,
    mintScenarioChangeId: (strategyId) =>
      deterministicUuid(RUNTIME_ID_NAMESPACES.planning, `${strategyId}|scenario-change`) as SubjectId,
    baseStrategyVersion,
  };
}

async function nextStrategyVersion(pool: Pool, workspaceId: string, caseId: string): Promise<number> {
  const existing = await pool.query<{ max: string | null }>(
    'SELECT MAX(strategy_version)::text AS max FROM recovery_strategies WHERE workspace_id = $1 AND recovery_case_id = $2',
    [workspaceId, caseId],
  );
  return Number(existing.rows[0]?.max ?? 0) + 1;
}

export type CoordinatorPlanOutcome =
  | { ok: true; result: RecoveryPlanningResult }
  | { ok: false; error: ApplicationError };

/**
 * The concrete C1 coordinator. Composed once under the application; every heavy
 * dependency is injected, never model-controlled.
 */
export function createRecoveryPlanningCoordinator(deps: RecoveryPlanningCoordinatorDeps): RecoveryPlanningCoordinator & {
  planCaseDetailed(input: RecoveryPlanningInput): Promise<CoordinatorPlanOutcome>;
} {
  const coordinator: RecoveryPlanningCoordinator & {
    planCaseDetailed(input: RecoveryPlanningInput): Promise<CoordinatorPlanOutcome>;
  } = {
    async planCaseDetailed(input: RecoveryPlanningInput): Promise<CoordinatorPlanOutcome> {
      const now = deps.now ?? new Date().toISOString();
      const status = await caseStatus(deps.pool, deps.workspaceId, input.recoveryCaseId);
      if (!status) return { ok: false, error: applicationError('CASE_NOT_FOUND', `recovery case ${input.recoveryCaseId} does not exist`) };
      if (TERMINAL.has(status)) return { ok: false, error: applicationError('CASE_NOT_OPEN', `recovery case ${input.recoveryCaseId} is ${status}`) };

      const basis = await capturePlanningBasis(deps, input.recoveryCaseId, now);
      if (!basis) {
        // No currently-failing subject: nothing to plan. This is an honest empty
        // result, not an error — the case simply has no recovery basis right now.
        const attemptId = deterministicUuid(RUNTIME_ID_NAMESPACES.planning, `${deps.workspaceId}|planning-attempt|${input.recoveryCaseId}|empty`);
        return {
          ok: true,
          result: {
            planningAttemptRef: attemptId as SubjectId,
            basisAssessmentId: '' as SubjectId,
            viableStrategyRefs: [],
            outcome: 'NO_RECOVERY_FOUND',
          },
        };
      }

      const baseStrategyVersion = await nextStrategyVersion(deps.pool, deps.workspaceId, input.recoveryCaseId);
      await advanceCasePhase(deps, input.recoveryCaseId, 'PLANNING', 'planning started');

      const transportPlanning = deps.transportPlanning;
      const resolveAirport = transportPlanning
        ? transportPlanning.resolveAirport ?? airportResolverFromCapturedWorld(basis.world)
        : undefined;
      // The single passenger source for every corridor derivation below (proposer,
      // research requests, offer materialization). Exactly one arm is present per
      // TransportPassengerSource; it is never defaulted here.
      const passengerSource: TransportPassengerSource | undefined = transportPlanning
        ? (transportPlanning.passengersFor
          ? { passengersFor: transportPlanning.passengersFor, ...(transportPlanning.passengers ? { passengers: transportPlanning.passengers } : {}) }
          : { passengers: transportPlanning.passengers! })
        : undefined;
      const proposers = [...(deps.proposers ?? defaultDomainProposers())];
      if (transportPlanning && !proposers.some((binding) => binding.domain === 'TRANSPORT')) {
        proposers.push({
          domain: 'TRANSPORT',
          proposer: createTransportProposer({
            resolveAirport: resolveAirport!,
            ...passengerSource!,
            ...(transportPlanning.maxOffersPerCorridor ? { maxOffersPerCorridor: transportPlanning.maxOffersPerCorridor } : {}),
          }),
        });
      }
      const transportResearch = transportPlanning
        ? transportCorridors(basis.world, basis.failing, { resolveAirport: resolveAirport!, ...passengerSource! })
          .corridors.map((corridor) => flightSearchRequestFor(corridor, { round: 1 }))
        : [];

      // G09: stored EXPLICIT/INFERRED preferences of the affected owners feed the
      // comparator (explicit > inferred). Read-only; never a hard constraint.
      const preferences = await loadPlanningPreferences(
        deps.pool, deps.workspaceId,
        preferenceOwnerIds(basis.world, basis.failing, basis.programmeIds), now,
      );

      // 2. Delegate ALL decision logic to the pure core.
      const core = await runRecoveryPlanning(
        {
          workspaceId: deps.workspaceId,
          recoveryCaseId: input.recoveryCaseId,
          basisAssessmentId: basis.basisAssessmentId as SubjectId,
          reason: input.reason,
          now,
          world: basis.world,
          effective: basis.effective,
          failing: basis.failing,
          registry: basis.registry,
          currentState: basis.currentState,
        },
        {
          domainRegistry: deps.domainRegistry ?? defaultRecoveryDomainRegistry(),
          availableCapabilities: deps.availableCapabilities ?? derivedCapabilities(transportPlanning),
          proposers,
          ...(preferences.length > 0 ? { preferences } : {}),
          minters: planningMinters(deps, input.recoveryCaseId, basis.basisAssessmentId, now, baseStrategyVersion),
          coordinatorVersion: deps.coordinatorVersion ?? R1_COORDINATOR_VERSION,
          comparatorVersion: deps.comparatorVersion ?? R1_COMPARATOR_VERSION,
          ...(transportPlanning ? {
            research: { transport: transportPlanning.transport, requestsByDomain: { TRANSPORT: [transportResearch] } },
            materializeWorldForDomain: ({ domainId, evidence, basis: domainBasis }) => domainId === 'TRANSPORT'
              ? materializeTransportOffers({
                  world: domainBasis.world,
                  failing: domainBasis.failing,
                  toolResults: evidence.toolResults,
                  now: domainBasis.now,
                  resolveAirport: resolveAirport!,
                  ...passengerSource!,
                  ...(transportPlanning.maxOffersPerCorridor ? { maxOffersPerCorridor: transportPlanning.maxOffersPerCorridor } : {}),
                })
              : undefined,
          } : {}),
        },
      );

      // 3. One UnitOfWork makes viable strategies, their immutable decision
      // evidence, and the final case phase mutually visible to operators.
      const attemptPersisted = await persistRecoveryPlanningCompletion(deps.uow(), {
        workspaceId: deps.workspaceId,
        actorPrincipalId: deps.actorPrincipalId,
        idempotencyKey: `planning:completion:${input.recoveryCaseId}:${basis.basisAssessmentId}`,
        attempt: core.attempt,
        outcome: core.result.outcome,
        viableStrategies: core.viableStrategies,
      });
      if (!attemptPersisted.ok) {
        return { ok: false, error: applicationError('PLAN_PERSIST_FAILED', `planning completion: ${attemptPersisted.conflict.kind}: ${attemptPersisted.conflict.message}`) };
      }

      return { ok: true, result: { ...core.result, planningAttemptRef: attemptPersisted.value.attemptId as SubjectId } };
    },

    async planCase(input: RecoveryPlanningInput): Promise<RecoveryPlanningResult> {
      const detailed = await coordinator.planCaseDetailed(input);
      if (!detailed.ok) throw new Error(`${detailed.error.code}: ${detailed.error.message}`);
      return detailed.result;
    },
  };
  return coordinator;
}

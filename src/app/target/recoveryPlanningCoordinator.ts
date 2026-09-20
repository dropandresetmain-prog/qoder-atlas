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
import { assessManifestCurrentness, type CurrentState } from '../../resolution/world/currentness.ts';
import type { EvaluatorRegistry } from '../../resolution/evaluation/assess.ts';
import { RecoveryPlanningAttemptSchema } from '../../contracts/v2/planning/recoveryPlanningAttempt.ts';
import type {
  RecoveryPlanningCoordinator,
  RecoveryPlanningInput,
  RecoveryPlanningResult,
  PlanningModelActivity,
  PlanningEvidenceRecord,
} from '../../contracts/v2/planning/recoveryPlanningAttempt.ts';
import type { RecoveryDomainId } from '../../contracts/v2/planning/recoveryDomain.ts';
import type { StrategyProposer } from '../../resolution/planning/proposer.ts';
import type { CapabilityFamily } from '../../operational/strategy.ts';
import type { PlanningToolTransport } from '../../resolution/planning/researchDispatcher.ts';
import { captureWorld, PgCurrentStateReader } from '../../persistence/postgres/world/pgCurrentState.ts';
import { currentAssessmentView } from '../../persistence/postgres/world/pgAssessments.ts';
import { persistRecoveryPlanningAttempt, persistRecoveryPlanningCompletion } from '../../persistence/postgres/commands/r1PlanningAttemptCommands.ts';
import { createM6Registry } from '../../resolution/evaluation/registry.ts';
import { projectEffectiveWorld } from '../../resolution/world/effectiveItinerary.ts';
import { unmetProgrammeItems, type FailingSubject } from '../../resolution/planning/proposer.ts';
import { createProgrammeTimeSwapProposer } from '../../resolution/planning/proposers/programmeTimeSwapProposer.ts';
import { createTransportProposer } from '../../resolution/planning/proposers/transportProposer.ts';
import { persistOfferExecutionBindings } from '../../persistence/postgres/execution/providerExecutionInputs.ts';
import type { WTransportService } from '../../resolution/world/world.ts';
import type { ResolvedOffer } from '../../resolution/scenarios/overlay.ts';
import { materializeTransportOffers } from '../../resolution/planning/transportOfferMaterialization.ts';
import { airportResolverFromCapturedWorld, flightSearchRequestFor, transportCorridors, type AirportResolver, type TransportPassengerSource } from '../../resolution/planning/transportCorridors.ts';
import {
  createHotelCompanionPlanning,
  type HotelPlanningMaterialization,
  type HotelPlanningOptions,
} from '../targetHotelCompanionPlanning.ts';
import { defaultRecoveryDomainRegistry } from '../../resolution/planning/recoveryDomains.ts';
import {
  runRecoveryPlanning,
  type CoordinatorMinters,
  type DomainProposerBinding,
  type CoordinatorCoreDeps,
} from '../../resolution/planning/coordinatorCore.ts';
import { loadPlanningPreferences, preferenceOwnerIds } from './planningPreferences.ts';
import { suggestRecoveryDomains } from './planningDomainSuggestion.ts';
import { advanceCasePhase } from './recoveryPlanning.ts';
import { deterministicUuid, RUNTIME_ID_NAMESPACES } from './deterministicId.ts';
import { applicationError } from './applicationCommands.ts';
import type { IntelligenceClient } from '../../intelligence/client.ts';
import {
  resolveRecoveryDomainDecisions,
} from '../../contracts/v2/planning/recoveryDomain.ts';
import { blockingDimensionCodes } from '../../resolution/planning/coordinatorCore.ts';

export const R1_COORDINATOR_VERSION = 'r1-coordinator/1';
export const R1_COMPARATOR_VERSION = 'r1-comparator/1';

const TERMINAL = new Set(['RESOLVED', 'CLOSED', 'CANCELLED', 'SUPERSEDED']);

function completedAtAfterEvidence(
  completedAt: string,
  modelActivities: readonly PlanningModelActivity[],
  toolObservedAt: readonly string[],
  assembledAt: string,
): string {
  return [completedAt, assembledAt, ...modelActivities.map((activity) => activity.observedAt), ...toolObservedAt]
    .reduce((latest, candidate) => Date.parse(candidate) > Date.parse(latest) ? candidate : latest);
}

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
  /** Wall-clock completion time for durable evidence; injectable only for tests. */
  completionClock?: () => string;
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
  /**
   * Optional bounded HOTEL follow-up for a researched transport alternative.
   * The resolver supplies authoritative candidate-specific context; absence
   * leaves existing transport-only planning unchanged and invents no stay.
   */
  hotelPlanning?: HotelPlanningOptions;
  costContextForCandidate?: CoordinatorCoreDeps['costContextForCandidate'];
  /**
   * Bounded entry/property evidence preparation, shared by HTTP and progression.
   * Publication uses the existing knowledge commands outside the pure planner.
   * Its results are recaptured; a stale assessment waits for normal reassessment.
   */
  preparePlanningContext?: (input: {
    recoveryCaseId: string;
    now: string;
    world: CapturedWorld;
    failing: readonly FailingSubject[];
  }) => Promise<{
    additionalPlaceIds?: readonly string[];
    hotelPlanning?: HotelPlanningOptions;
    evidence?: readonly PlanningEvidenceRecord[];
  }>;
  /**
   * Optional Model Studio / Qwen client for hybrid domain suggestion.
   * Suggestions are registry-validated fail-closed; absence is honest (no AI).
   */
  intelligence?: IntelligenceClient;
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

async function capturePlanningBasis(deps: RecoveryPlanningCoordinatorDeps, caseId: string, now: string, additionalPlaceIds: readonly string[] = []): Promise<BasisCapture | undefined> {
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
    focus: [...failing.map((f) => f.subject), ...programmeRefs,
      ...additionalPlaceIds.map((id): TypedRef => ({ kind: 'PLACE', id }))],
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
  | { ok: true; result: RecoveryPlanningResult; hotelPlanningMaterialization?: HotelPlanningMaterialization }
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

      let basis = await capturePlanningBasis(deps, input.recoveryCaseId, now);
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

      let prepared: Awaited<ReturnType<NonNullable<RecoveryPlanningCoordinatorDeps['preparePlanningContext']>>> | undefined;
      if (deps.preparePlanningContext) {
        const originalBasis = basis;
        prepared = await deps.preparePlanningContext({ recoveryCaseId: input.recoveryCaseId, now, world: basis.world, failing: basis.failing });
        const preparationCompletedAt = deps.completionClock?.() ?? new Date().toISOString();
        const current = await new PgCurrentStateReader(deps.pool).loadFor(deps.workspaceId, originalBasis.world.manifest);
        const recaptured = await capturePlanningBasis(deps, input.recoveryCaseId, now, prepared.additionalPlaceIds);
        if (!recaptured || recaptured.basisAssessmentId !== originalBasis.basisAssessmentId
          || !assessManifestCurrentness(originalBasis.world.manifest, current, now).current) {
          // Retain truthful preparation evidence against the superseded basis.
          // This audit command promotes no strategy and does not bypass the
          // completion command's pending-reassessment/currentness checks.
          const attempt = RecoveryPlanningAttemptSchema.parse({
            id: planningMinters(deps, input.recoveryCaseId, originalBasis.basisAssessmentId, now, 1).attemptId,
            recoveryCaseId: input.recoveryCaseId, basisAssessmentId: originalBasis.basisAssessmentId,
            basisManifest: originalBasis.world.manifest, startedAt: now,
            completedAt: completedAtAfterEvidence(preparationCompletedAt, [],
              (prepared.evidence ?? []).flatMap((evidence) => evidence.provenance.observedAt ? [evidence.provenance.observedAt] : []), now),
            coordinatorVersion: deps.coordinatorVersion ?? R1_COORDINATOR_VERSION,
            evidence: prepared.evidence ?? [],
          });
          const retained = await persistRecoveryPlanningAttempt(deps.uow(), {
            workspaceId: deps.workspaceId, actorPrincipalId: deps.actorPrincipalId,
            idempotencyKey: `planning:preparation:${input.recoveryCaseId}:${originalBasis.basisAssessmentId}`,
            attempt, outcome: 'STALE_RETRY_REQUIRED',
          });
          if (!retained.ok) return { ok: false, error: applicationError('PLAN_PERSIST_FAILED', `planning preparation: ${retained.conflict.kind}`) };
          return { ok: true, result: { planningAttemptRef: retained.value.attemptId as SubjectId,
            basisAssessmentId: originalBasis.basisAssessmentId as SubjectId, viableStrategyRefs: [], outcome: 'STALE_RETRY_REQUIRED' } };
        }
        basis = recaptured;
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
      const hotelPlanning = prepared?.hotelPlanning ?? deps.hotelPlanning;
      const hotelCompanionPlanning = transportPlanning && hotelPlanning
        ? createHotelCompanionPlanning({
            world: basis.world,
            failing: basis.failing,
            now,
            resolveAirport: resolveAirport!,
            ...passengerSource!,
            ...(transportPlanning.maxOffersPerCorridor !== undefined ? { maxOffersPerCorridor: transportPlanning.maxOffersPerCorridor } : {}),
            hotel: hotelPlanning,
          })
        : undefined;
      const proposers = [...(deps.proposers ?? defaultDomainProposers())];
      if (transportPlanning && !proposers.some((binding) => binding.domain === 'TRANSPORT')) {
        proposers.push({
          domain: 'TRANSPORT',
          proposer: hotelCompanionPlanning?.proposer ?? createTransportProposer({
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

      const availableCapabilities = deps.availableCapabilities ?? derivedCapabilities(transportPlanning);
      const domainRegistry = deps.domainRegistry ?? defaultRecoveryDomainRegistry();

      // G08: optional Model Studio domain suggestion (hybrid C3). Deterministic
      // activations run first; AI may only ADD domains the registry re-validates.
      let aiSuggestedDomains: RecoveryDomainId[] | undefined;
      const modelActivities: PlanningModelActivity[] = [];
      if (deps.intelligence?.isConfigured()) {
        const domainContext = {
          failingSubjectKinds: new Set(basis.failing.map((f) => f.subject.kind)),
          blockingDimensionCodes: blockingDimensionCodes(basis.failing),
          affectedObjectKinds: new Set<string>(),
          availableCapabilities: new Set(availableCapabilities),
        };
        const deterministic = resolveRecoveryDomainDecisions(domainRegistry, domainContext);
        const already = deterministic
          .filter((d) => d.disposition === 'INVESTIGATED')
          .map((d) => d.domainId);
        const suggestion = await suggestRecoveryDomains(deps.intelligence, {
          context: domainContext,
          alreadyInvestigated: already,
        });
        // Captured after the structured ModelCallResult resolves. This records
        // operational provenance, never the prompt, raw output or rationale.
        modelActivities.push({
          operation: 'recovery.domain_suggestion',
          ...suggestion.activity,
          observedAt: new Date().toISOString(),
        });
        if (suggestion.suggestedDomains.length > 0) {
          aiSuggestedDomains = [...suggestion.suggestedDomains];
        }
        if (suggestion.activity.status === 'SUCCEEDED') {
          console.log(
            `[qwen] domain suggestion mode=${suggestion.activity.mode} model=${suggestion.activity.model}` +
              (aiSuggestedDomains?.length ? ` added=${aiSuggestedDomains.join(',')}` : ' (no additive domains)'),
          );
        }
      }

      // R4-F2: capture the planning-time provider offer identity so the external
      // execution boundary can later resolve the SubjectId-safe offer key back to
      // the researched provider offer (protected input, migration 0128).
      const capturedOfferServices: WTransportService[] = [];
      const capturedResolvedOffers: ResolvedOffer[] = [];
      let capturedHotelMaterialization: HotelPlanningMaterialization | undefined;

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
          domainRegistry,
          availableCapabilities,
          proposers,
          ...(deps.costContextForCandidate ? { costContextForCandidate: deps.costContextForCandidate } : {}),
          ...(preferences.length > 0 ? { preferences } : {}),
          ...(aiSuggestedDomains ? { aiSuggestedDomains } : {}),
          minters: planningMinters(deps, input.recoveryCaseId, basis.basisAssessmentId, now, baseStrategyVersion),
          coordinatorVersion: deps.coordinatorVersion ?? R1_COORDINATOR_VERSION,
          comparatorVersion: deps.comparatorVersion ?? R1_COMPARATOR_VERSION,
          ...(transportPlanning ? {
            research: {
              transport: hotelCompanionPlanning
                ? async (request) => request.capability === 'HOTEL'
                  ? hotelCompanionPlanning.transport(request)
                  : transportPlanning.transport(request)
                : transportPlanning.transport,
              requestsByDomain: { TRANSPORT: [transportResearch] },
              ...(hotelCompanionPlanning ? { budget: hotelCompanionPlanning.budget, nextRound: hotelCompanionPlanning.nextRound } : {}),
            },
            materializeWorldForDomain: ({ domainId, evidence, basis: domainBasis }) => {
              if (domainId !== 'TRANSPORT') return undefined;
              const materialized = materializeTransportOffers({
                world: domainBasis.world,
                failing: domainBasis.failing,
                toolResults: evidence.toolResults,
                now: domainBasis.now,
                resolveAirport: resolveAirport!,
                ...passengerSource!,
                ...(transportPlanning.maxOffersPerCorridor ? { maxOffersPerCorridor: transportPlanning.maxOffersPerCorridor } : {}),
              });
              capturedOfferServices.push(...materialized.capturedServices);
              capturedResolvedOffers.push(...materialized.resolvedOffers);
              if (hotelCompanionPlanning) {
                capturedHotelMaterialization = hotelCompanionPlanning.materialize(evidence.toolResults);
                return {
                  ...materialized,
                  resolvedStayOffers: capturedHotelMaterialization.resolvedStayOffers,
                };
              }
              return materialized;
            },
          } : {}),
        },
      );
      const assembledAt = deps.completionClock?.() ?? new Date().toISOString();
      const attempt = RecoveryPlanningAttemptSchema.parse({
        ...core.attempt,
        evidence: [...(prepared?.evidence ?? []), ...core.attempt.evidence],
        modelActivities,
        // The deterministic planning basis time remains `now`; the durable
        // evidence horizon is the actual assembly time, never before any model
        // or read-only provider observation retained in this attempt.
        completedAt: completedAtAfterEvidence(
          core.attempt.completedAt,
          modelActivities,
          [...(prepared?.evidence ?? []), ...core.attempt.evidence].flatMap((evidence) => evidence.provenance.observedAt ? [evidence.provenance.observedAt] : []),
          assembledAt,
        ),
      });

      // 3. One UnitOfWork makes viable strategies, their immutable decision
      // evidence, and the final case phase mutually visible to operators.
      const attemptPersisted = await persistRecoveryPlanningCompletion(deps.uow(), {
        workspaceId: deps.workspaceId,
        actorPrincipalId: deps.actorPrincipalId,
        idempotencyKey: `planning:completion:${input.recoveryCaseId}:${basis.basisAssessmentId}`,
        attempt,
        outcome: core.result.outcome,
        viableStrategies: core.viableStrategies,
      });
      if (!attemptPersisted.ok) {
        return { ok: false, error: applicationError('PLAN_PERSIST_FAILED', `planning completion: ${attemptPersisted.conflict.kind}: ${attemptPersisted.conflict.message}`) };
      }

      // R4-F2: bind each viable SELECT_OFFER strategy to its researched provider offer.
      if (capturedResolvedOffers.length > 0 && core.viableStrategies.length > 0) {
        await persistOfferExecutionBindings(deps.pool, {
          workspaceId: deps.workspaceId,
          actorId: deps.actorPrincipalId,
          recoveryCaseId: input.recoveryCaseId,
          strategies: core.viableStrategies,
          services: capturedOfferServices,
          resolvedOffers: capturedResolvedOffers,
        });
      }

      return {
        ok: true,
        result: { ...core.result, planningAttemptRef: attemptPersisted.value.attemptId as SubjectId },
        ...(capturedHotelMaterialization ? { hotelPlanningMaterialization: capturedHotelMaterialization } : {}),
      };
    },

    async planCase(input: RecoveryPlanningInput): Promise<RecoveryPlanningResult> {
      const detailed = await coordinator.planCaseDetailed(input);
      if (!detailed.ok) throw new Error(`${detailed.error.code}: ${detailed.error.message}`);
      return detailed.result;
    },
  };
  return coordinator;
}

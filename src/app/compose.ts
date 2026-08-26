/**
 * Checkpoint C composition — shared runtime wiring (R1/PL-3).
 *
 * Boots credential-free (REPLAY by default): seeds accepted scenario bundles
 * when the store is empty, wires the full recovery loop seams, and produces
 * the AppEndpoints surface (read models + generic runtime flow). main.ts and
 * the R1 integration test share this exact wiring — there is no separate
 * test-only demo path. Scenario-neutral: this module knows the bundle schema
 * and capability vocabulary, never scenario content.
 */
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AppConfig } from '../config/config.ts';
import type { EntityId, IsoDateTime } from '../domain/common.ts';
import { openDatabase } from '../persistence/database.ts';
import {
  SqliteAuditRepository,
  SqliteCaseRepository,
  SqliteSignalRepository,
  SqliteSourceRepository,
  SqliteTripRepository,
} from '../persistence/repositories.ts';
import { SqliteEntityStore } from '../persistence/entityStore.ts';
import { SqlMutationService } from '../engine/mutation.ts';
import { OverlayViabilityEngine } from '../engine/overlay.ts';
import { BoundaryExecutor } from '../engine/executor.ts';
import { DeterministicAuthorityEngine, ruleSetSource } from '../engine/authority.ts';
import { CaseVerifier, DeterministicObservationService } from '../engine/observation.ts';
import type { AppEndpoints } from '../server/http.ts';
import { AtlasFlightAdapter } from '../providers/atlas/adapter.ts';
import { AtlasFlightTransactionAdapter } from '../providers/atlas/transactionAdapter.ts';
import { GoogleRoutesAdapter } from '../providers/googleRoutes/adapter.ts';
import { NuiteeAdapter } from '../providers/hotel/nuiteeAdapter.ts';
import { FileRecordingStore } from '../providers/recordingStore.ts';
import { ModelStudioClient } from '../intelligence/client.ts';
import { ModelStudioRecoveryPlanner } from '../intelligence/planner.ts';
import { DeterministicFallbackPlanner } from '../intelligence/fallbackPlanner.ts';
import { deterministicIdFactory, NorthstarPlanner } from '../intelligence/northstarPlanner.ts';
import type { CapabilityDescriptor } from '../contracts/capabilities.ts';
import type { RecoveryPlanner } from '../contracts/planner.ts';
import type { ToolDispatchCapabilities } from './dispatch.ts';
import type { DatabaseSync } from 'node:sqlite';
import {
  buildTimezoneResolver,
  createRecoveryExecutor,
  projectApprovalsQueue,
  projectCaseDetail,
  projectJourneyChain,
  projectOperatorDashboard,
  projectProviderSurface,
  projectTravellerTrip,
  projectTripActivity,
  projectTripUncertainties,
  RecoveryExecutionService,
  seedScenarioBundle,
  settleTravellerDecision,
  latestCaseFor,
  SqlitePreferenceStore,
  type ReadModelDependencies,
} from './index.ts';
import { createProviderBackedExecutor } from './providerExecution.ts';
import { SqliteBookingDossierStore, type BookingDossierStore } from './dossierStore.ts';
import { SqliteFxRateStore, type FxRateStore } from './fxStore.ts';
import { FrankfurterFxAdapter } from '../providers/frankfurter/adapter.ts';
import { LayeredFxRateResolver } from './fxResolver.ts';
import { createFlightDossierResolver, createHotelDossierResolver } from './dossierResolver.ts';
import { RuntimeOrchestrator } from './runtime.ts';
import { createRuntimeHandlers } from './runtimeHttp.ts';
import { ProgrammeService } from './programme.ts';
import { listProgrammeDirs, seedProgrammeBundle } from './programmeSeed.ts';
import { resolveWorldSeedMode, shouldBootSeedScenario } from './worldSeed.ts';
import { createProgrammeHandlers } from './programmeHttp.ts';
import { projectProgrammeAugmentations } from './programmeReadmodel.ts';
import { projectTravellerPresentation } from './travellerPresentation.ts';
import { createResolutionHandlers } from './resolutionHttp.ts';
import { createChangeIntakeHandlers } from './changeIntakeHttp.ts';
import { createEventChangePreviewHandlers } from './eventChangePreviewHttp.ts';
import { createUploadIntakeHandlers } from './uploadIntakeHttp.ts';
import { SqliteEventInboxStore } from './eventInboxStore.ts';
import { createEventIngestHandlers } from './eventIngestHttp.ts';
import { AtlasFlightEventNormalizer } from '../providers/atlas/eventNormalizer.ts';
import { AtlasFlightStateReader } from '../providers/atlas/stateReader.ts';
import { loadScenario, listScenarioDirs } from '../scenarios/loader.ts';
import type { ScenarioSpec } from '../scenarios/spec.ts';
import type { DemoSurface } from '../server/http.ts';
import {
  DEMO_HERO_WORKFLOWS,
  DEMO_SCENARIO_REHEARSALS,
  demoManifestWorkflow,
  inspectPathsFromExpect,
} from './demoHeroes.ts';
import { runAcceptanceManifest } from '../acceptance/runner.ts';
import { loadAcceptanceManifest, resolveManifestPath } from '../acceptance/manifest.ts';
import {
  resolvePopulatedDemoOverviewPath,
  runPopulatedDemoWorld,
} from './demoWorld.ts';

export interface ComposedRuntime {
  db: DatabaseSync;
  endpoints: AppEndpoints;
  orchestrator: RuntimeOrchestrator;
  executionService: RecoveryExecutionService;
  readDeps: ReadModelDependencies;
  /**
   * Application-owned booking dossier store (Mission 2): provider-facing
   * booking identity seeded from operator/authoritative bundles and resolved
   * per intent by the composed executor. Exposed so integration evidence and
   * Mission-3 harnesses can verify seeding/resolution — never to derive
   * identity from model output.
   */
  dossierStore: BookingDossierStore;
  /** Application-owned FX evidence store (ADR-052). */
  fxRateStore: FxRateStore;
  /** Frankfurter reference-rate adapter (ADR-052 supplement). */
  frankfurter: FrankfurterFxAdapter;
  /** Layered budget-first FX resolution feeding authority (ADR-052). */
  fxRateResolver: LayeredFxRateResolver;
  /** The wired capability adapters (tool dispatch surface). */
  capabilities: ToolDispatchCapabilities;
  /** Advertised capability descriptors (registry evidence). */
  capabilityDescriptors: CapabilityDescriptor[];
  /** The composed recovery planner (deterministic id/timestamp wiring). */
  planner: RecoveryPlanner;
  /** Which planner powers runtime planning (credential check, not scenario). */
  plannerMode: 'MODEL_STUDIO' | 'DETERMINISTIC_FALLBACK';
  /** Seeded during composition (empty when the store was already populated). */
  seededScenarioIds: string[];
  /** Programme bundles seeded during composition (empty when populated). */
  seededProgrammes: Array<{ anchorEventId: EntityId; promotedCount: number }>;
  /**
   * The composed ProgrammeService — the SAME validated intake surface the
   * HTTP programme routes use. Exposed so harnesses/tests can seed programme
   * bundles through the real path without rewiring repositories; never a
   * second intake implementation.
   */
  programmeService: ProgrammeService;
}

/**
 * Compose the full application runtime over one SQLite database.
 *
 * DR-1.1: an optional injectable `clock` supplies the runtime's effective
 * "now" (defaults to the wall clock). Deterministic tests inject a fixed or
 * timeline-coherent instant so read models and the traveller-decision path are
 * reproducible; causal event time itself always flows through explicit `at`
 * parameters / the case causal horizon, never through this clock.
 */
export async function composeAppRuntime(
  config: AppConfig,
  db?: DatabaseSync,
  clock?: () => IsoDateTime,
): Promise<ComposedRuntime> {
  const database = db ?? openDatabase(config.sqlitePath);
  const trips = new SqliteTripRepository(database);
  const entities = new SqliteEntityStore(database);
  const sources = new SqliteSourceRepository(database);
  const signals = new SqliteSignalRepository(database);
  const cases = new SqliteCaseRepository(database);
  const audit = new SqliteAuditRepository(database);
  const preferences = new SqlitePreferenceStore(database);
  const dossiers = new SqliteBookingDossierStore(database);
  const fxRates = new SqliteFxRateStore(database);
  const eventInbox = new SqliteEventInboxStore(database);
  const mutations = new SqlMutationService({ db: database, trips, entities });

  // Deterministic generalized bootstrap: seed every accepted scenario bundle
  // when the store is empty. Fixture loading is allowed; scenario-specific
  // runtime behavior is not — every bundle is treated identically.
  const seededScenarioIds: string[] = [];
  const seededProgrammes: Array<{ anchorEventId: EntityId; promotedCount: number }> = [];
  // Programme seeding (boot + reset) runs through the SAME services the HTTP
  // surface uses; constructed once so both paths share one wiring.
  const bootProgrammeService = new ProgrammeService({
    mutations,
    entities,
    trips,
    sources,
    audit,
    signals,
  });
  if ((await trips.listTrips()).length === 0) {
    const scenariosRoot = join(config.fixturesDir, 'scenarios');
    const worldSeedMode = resolveWorldSeedMode(config);
    for (const entry of readdirSync(scenariosRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const scenarioDir = join(scenariosRoot, entry.name);
      if (!shouldBootSeedScenario(scenarioDir, worldSeedMode)) continue;
      try {
        const outcome = await seedScenarioBundle(
          { mutations, sources, preferences, audit, dossiers, fxRates },
          scenarioDir,
        );
        seededScenarioIds.push(outcome.scenarioId);
      } catch {
        // Non-fatal: some fixtures/scenarios/* directories are lightweight
        // generic acceptance-descriptor packs (DR-9 S1-S4), not full engine
        // ScenarioSpec bundles — they carry frozen-shape signals/requests for
        // other lanes' HTTP integration tests to consume directly, but they
        // are not meant to be boot-seeded Trips. A directory that fails the
        // full ScenarioSpec contract is skipped here exactly as the demo
        // panel's scenario loader already tolerates (see below).
      }
    }
    for (const programmeDir of listProgrammeDirs(join(config.fixturesDir, 'programmes'))) {
      const outcome = await seedProgrammeBundle(bootProgrammeService, programmeDir, { fxRates });
      seededProgrammes.push({ anchorEventId: outcome.anchorEventId, promotedCount: outcome.promotedCount });
    }
  }

  // Navigation must survive process restarts. `seededProgrammes` only records
  // work done during this boot, so derive persistent programme destinations
  // from authoritative trips and order them by programme size.
  const programmeTripCounts = new Map<EntityId, number>();
  for (const summary of await trips.listTrips()) {
    const trip = await trips.getTrip(summary.tripId);
    if (!trip?.anchorEventId) continue;
    programmeTripCounts.set(trip.anchorEventId, (programmeTripCounts.get(trip.anchorEventId) ?? 0) + 1);
  }
  const programmeEventIds = [...programmeTripCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([eventId]) => eventId);

  // Capability wiring: Atlas always present (REPLAY is credential-free);
  // Google Routes contributes only when configured or recorded; Nuitée
  // (liteAPI) replays the curated hotel corpus without credentials and fails
  // closed (NOT_CONFIGURED) for LIVE/RECORD without NUITEE_API_KEY. Scenario
  // bundles may ship their own recordings; the curated fixtures/recordings
  // corpus is readable by the composed app too. The Atlas transaction
  // adapter (DR-2) shares the same recording store and fails closed unless
  // the configured environment is unambiguously the Atlas sandbox.
  const recordingReadDirs = [
    ...readdirSync(join(config.fixturesDir, 'scenarios'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(config.fixturesDir, 'scenarios', entry.name, 'recordings')),
    join(config.fixturesDir, 'recordings'),
    config.recordingsDir,
  ];
  // RECORD persists sanitized provider-shaped payloads under recordingsDir so
  // later REPLAY shares the same normalizer path. LIVE/REPLAY never require a
  // writable store; writeDir is still set so RECORD does not fail closed on a
  // read-only store misconfiguration.
  const recordingStore = new FileRecordingStore({
    readDirs: recordingReadDirs,
    writeDir: config.recordingsDir,
  });
  const flight = new AtlasFlightAdapter({
    mode: config.adapterMode,
    store: recordingStore,
    baseUrl: config.providers.atlas.baseUrl,
    clientId: config.providers.atlas.clientId,
    clientSecret: config.providers.atlas.clientSecret,
    // Lazy: Northstar programme intake may promote airport places AFTER boot;
    // normalization must stay honest against current authoritative state.
    timezoneResolverFactory: buildTimezoneResolver(entities),
  });
  const flightTransactions = new AtlasFlightTransactionAdapter({
    mode: config.adapterMode,
    store: recordingStore,
    baseUrl: config.providers.atlas.baseUrl,
    clientId: config.providers.atlas.clientId,
    clientSecret: config.providers.atlas.clientSecret,
  });
  const routing = new GoogleRoutesAdapter({
    mode: config.adapterMode,
    store: recordingStore,
    apiKey: config.providers.googleRoutes.apiKey,
  });
  const hotel = new NuiteeAdapter({
    mode: config.adapterMode,
    store: recordingStore,
    searchBaseUrl: config.providers.nuitee.searchBaseUrl,
    bookingBaseUrl: config.providers.nuitee.bookingBaseUrl,
    apiKey: config.providers.nuitee.apiKey,
  });
  // ADR-052 supplement: key-less ECB reference rates via Frankfurter, sharing
  // the same recording store (REPLAY is credential-free and offline). The
  // adapter only produces evidence; the layered resolver keeps organisation
  // budget FX first-class and the engine stays the sole judge of staleness.
  const frankfurter = new FrankfurterFxAdapter({
    mode: config.adapterMode,
    store: recordingStore,
    baseUrl: config.providers.frankfurter?.baseUrl,
  });
  const fxRateResolver = new LayeredFxRateResolver({
    budgetRates: fxRates,
    external: {
      quote: (request) => frankfurter.quote(request),
      todayIsoDate: () => new Date().toISOString().slice(0, 10),
    },
  });
  const capabilities: ToolDispatchCapabilities = { flight, flightTransactions, routing, hotel };
  const capabilityDescriptors: CapabilityDescriptor[] = [
    flight.descriptor,
    flightTransactions.descriptor,
    routing.descriptor,
    hotel.descriptor,
  ];

  const viability = new OverlayViabilityEngine();
  const readDeps: ReadModelDependencies = {
    snapshot: { trips, entities, preferences, sources },
    signals,
    cases,
    audit,
    viability,
  };
  const strategyFor = async (intent: { caseId: EntityId; strategyId?: EntityId }) =>
    (await cases.getCase(intent.caseId))?.strategies.find((strategy) => strategy.id === intent.strategyId);
  const executionService = new RecoveryExecutionService({
    cases,
    audit,
    authority: new DeterministicAuthorityEngine({ ruleSets: ruleSetSource(entities) }),
    executor: createRecoveryExecutor({      // DR-2.8: provider-backed execution replaces simulation-first for the
      // operations the wired capabilities actually perform; the simulation
      // boundary remains the fallback for unwired operations (ADR-007) and
      // for REPLAY misses on recordings.
      inner: createProviderBackedExecutor({
        fallback: new BoundaryExecutor(),
        mode: config.adapterMode,
        // ADR-048: the payment ceiling is the authority-frozen
        // intent.spendExposure; the executor holds no strategy resolver, so
        // post-authority strategy mutations can never raise authorised spend.
        flight,
        flightTransactions,
        hotel,
        // Booking dossiers: provider-facing booking identity comes from the
        // application-owned validated store, resolved PER INTENT through the
        // authoritative graph (case -> trip -> travellers) — never from LLM
        // output, never scenario-keyed. Absent dossier => REPLAY keeps the
        // simulation fallback, LIVE/RECORD fails closed (ADR-050).
        flightDossier: createFlightDossierResolver({ cases, trips, dossiers }),
        hotelDossier: createHotelDossierResolver({ cases, trips, dossiers }),
      }),
      strategyFor,
    }),
    observation: new DeterministicObservationService({ mutations }),
    // DR-1.2: the verifier reconciles authoritative Trip viability through
    // the validated mutation path once a case resolves.
    verifier: new CaseVerifier({ trips, signals, entities, mutations }),
    trips,
    entities,
    // Funding evidence lives on triggering signals (change-request anchors).
    signals,
    // ADR-052: layered FX evidence resolution — organisation budget FX from
    // the store FIRST, Frankfurter reference rates as supplement; both feed
    // the same deterministic engine which fails closed on any gap.
    fxRates: fxRateResolver,
  });

  // Planner: LIVE Model Studio only when explicitly NOT in REPLAY mode AND
  // the API key is configured; REPLAY must never make external AI calls even
  // when credentials are present. The deterministic fallback planner is the
  // credential-free path that completes the loop without network calls.
  const modelClient = new ModelStudioClient({
    apiKey: config.providers.modelStudio.apiKey,
    model: config.providers.modelStudio.model,
    baseUrl: config.providers.modelStudio.baseUrl,
    // Multi-round LIVE planning (evidence gathering + strategy authoring)
    // routinely exceeds the client's 30s default; bounded retry still applies.
    timeoutMs: config.providers.modelStudio.timeoutMs ?? 90_000,
  });
  const useLivePlanner = config.adapterMode !== 'REPLAY' && modelClient.isConfigured();
  const basePlanner: RecoveryPlanner = useLivePlanner
    ? new ModelStudioRecoveryPlanner({ client: modelClient })
    // REV-2 WP-R5 doctrine extends to the fallback planner: persisted strategy
    // ids feed intent ids, and REPLAY reproducibility demands deterministic
    // ids — never randomUUID.
    : new DeterministicFallbackPlanner({ idFactory: deterministicIdFactory() });
  // Northstar branches (initial planning, window shift) wrap the base
  // planner; everything else flows through the shared I3 loop. Strategy
  // ids come from a deterministic per-prefix sequence (REV-2 WP-R5):
  // Math.random ids broke REPLAY reproducibility of persisted case state,
  // and createdAt derives from the snapshot instant — never wall-clock
  // (ADR-029).
  const planner: RecoveryPlanner = new NorthstarPlanner(basePlanner, {
    idFactory: deterministicIdFactory(),
  });

  const orchestrator = new RuntimeOrchestrator({
    db: database,
    trips,
    entities,
    sources,
    signals,
    cases,
    audit,
    preferences,
    mutations,
    execution: executionService,
    planner,
    capabilities,
    capabilityDescriptors,
    viability,
    fixturesDir: config.fixturesDir,
    programmeService: bootProgrammeService,
    dossiers,
    fxRates,
    environment: config.environment,
    worldSeedMode: config.worldSeedMode,
  });

  // Demo-only surface: load scenario specs for human clickaround triggers.
  // Loads each scenario's disruption signal so the demo panel can fire them
  // through the same orchestrator the HTTP surface uses. Never scenario-
  // specific: every bundle is treated identically.
  const scenarioSpecs = new Map<string, ScenarioSpec>();
  for (const dir of listScenarioDirs(join(config.fixturesDir, 'scenarios'))) {
    try {
      const spec = loadScenario(dir);
      const folderName = dir.split(/[\\/]/).pop() ?? spec.scenarioId;
      scenarioSpecs.set(folderName, spec);
    } catch {
      // Non-fatal: a broken scenario fixture must not prevent the app from booting.
    }
  }
  const demo: DemoSurface = {
    scenarioNames: () => [...scenarioSpecs.keys()],
    programmeEventIds: () => [...programmeEventIds],
    heroWorkflows: () =>
      DEMO_HERO_WORKFLOWS.map((workflow) => ({
        id: workflow.id,
        title: workflow.title,
        description: workflow.description,
      })),
    scenarioRehearsals: () =>
      DEMO_SCENARIO_REHEARSALS.map((workflow) => ({
        id: workflow.id,
        title: workflow.title,
        description: workflow.description,
        scenarioId: workflow.scenarioId ?? workflow.id,
      })),
    plannerMode: () => useLivePlanner ? 'MODEL_STUDIO' : 'DETERMINISTIC_FALLBACK',
    async reset(at) {
      try {
        const result = await orchestrator.reset(at);
        return { status: 200, body: { message: 'reset complete', ...result } };
      } catch (error) {
        return { status: 500, body: { error: error instanceof Error ? error.message : String(error) } };
      }
    },
    async resetPopulatedWorld(baseUrl) {
      try {
        const outcome = await runPopulatedDemoWorld({
          baseUrl,
          config,
          enforceAssertions: false,
        });
        return {
          status: outcome.ok ? 200 : 500,
          redirectTo: resolvePopulatedDemoOverviewPath(),
          body: {
            message: outcome.ok ? 'populated demo world ready' : 'populated demo world failed',
            ...outcome,
          },
        };
      } catch (error) {
        return {
          status: 500,
          redirectTo: resolvePopulatedDemoOverviewPath(),
          body: { error: error instanceof Error ? error.message : String(error) },
        };
      }
    },
    async triggerScenario(name, at) {
      const spec = scenarioSpecs.get(name);
      if (!spec) {
        return { status: 404, body: { error: `unknown scenario: ${name}` } };
      }
      try {
        // DR-1.1: the demo instant is no longer ignored — it gives a signal
        // without its own receivedAt a coherent system-owned receipt instant.
        const result = await orchestrator.processDisruption(spec.disruption.signal, at);
        return {
          status: 200,
          body: {
            scenarioId: spec.scenarioId,
            signalId: result.signalId,
            caseId: result.caseId,
            caseStatus: result.caseStatus,
            severity: result.assessment.severity,
          },
        };
      } catch (error) {
        return { status: 500, body: { error: error instanceof Error ? error.message : String(error) } };
      }
    },
    async launchHero(workflowId, _at, baseUrl) {
      const workflow = demoManifestWorkflow(workflowId);
      if (!workflow) {
        return { status: 404, body: { error: `unknown_hero_workflow: ${workflowId}` } };
      }
      try {
        const cwd = resolve('.');
        const manifestPath = resolveManifestPath(workflow.manifestPath, cwd);
        const manifest = loadAcceptanceManifest(manifestPath);
        const result = await runAcceptanceManifest({
          manifestPath,
          cwd,
          baseUrl,
          skipPreflight: true,
          config,
          stopBeforeStepIds: workflow.stopBeforeStepIds,
          // Demo launch drives real endpoints; semantic asserts remain in
          // acceptance CI. Status codes are still enforced by the runner.
          skipAssertions: true,
          evidenceDir: join(cwd, 'output', 'demo-hero-launches'),
        });
        const failed = result.evidence.steps.filter((step) => !step.ok);
        const ok = result.evidence.ok && failed.length === 0;
        return {
          status: ok ? 200 : 500,
          body: {
            workflowId: workflow.id,
            scenarioId: manifest.scenarioId,
            title: workflow.title,
            ok,
            stoppedBefore: workflow.stopBeforeStepIds,
            stepsRun: result.evidence.steps.filter((step) => !String(step.error ?? '').startsWith('skipped:')).length,
            steps: result.evidence.steps.map((step) => ({
              id: step.stepId,
              ok: step.ok,
              ...(step.error ? { error: step.error } : {}),
            })),
            inspectPaths: inspectPathsFromExpect(manifest.expect),
            evidencePath: result.evidencePath,
          },
        };
      } catch (error) {
        return { status: 500, body: { error: error instanceof Error ? error.message : String(error) } };
      }
    },
  };

  const programmeService = bootProgrammeService;
  const now = clock ?? ((): IsoDateTime => new Date().toISOString());
  const endpoints: AppEndpoints = {
    now,
    operatorDashboard: (at, options) =>
      projectOperatorDashboard(
        readDeps,
        at,
        options?.anchorEventId ? { anchorEventId: options.anchorEventId } : undefined,
      ),
    operatorDashboardAugmentations: async (view) => {
      const chainByTrip = new Map<string, Awaited<ReturnType<typeof projectJourneyChain>>>();
      const anchorEventIds = new Set<string>();
      for (const row of view.trips) {
        const trip = await trips.getTrip(row.tripId);
        if (!trip) continue;
        chainByTrip.set(row.tripId, await projectJourneyChain(readDeps, trip));
        if (trip.anchorEventId) anchorEventIds.add(trip.anchorEventId);
      }
      const onlyEventId = anchorEventIds.size === 1 ? [...anchorEventIds][0] : undefined;
      return {
        chainFor: (trip) => chainByTrip.get(trip.tripId),
        ...(onlyEventId ? { programmeHref: `/programme?event=${encodeURIComponent(onlyEventId)}` } : {}),
        ...(demo.resetPopulatedWorld
          ? { demoReset: { action: '/api/demo/reset?redirect=1', label: 'Reset demo' } }
          : {}),
      };
    },
    caseDetail: (caseId, at) => projectCaseDetail(readDeps, caseId, at),
    travellerTrip: (tripId, at) => projectTravellerTrip(readDeps, tripId, at),
    travellerPresentation: async (tripId, at) => {
      const trip = await trips.getTrip(tripId);
      if (!trip) return undefined;
      const recoveryCase = await latestCaseFor(cases, tripId);
      const detail = recoveryCase ? await projectCaseDetail(readDeps, recoveryCase.id, at) : undefined;
      return projectTravellerPresentation(
        {
          entities,
          verdictFor: (strategyId) => {
            const option = detail?.options.find((candidate) => candidate.id === strategyId);
            return option && option.verdict !== 'UNKNOWN'
              ? { feasible: option.verdict === 'VIABLE' }
              : undefined;
          },
          ...(detail?.options.find((option) => option.recommended)?.id
            ? { bestStrategyId: detail.options.find((option) => option.recommended)!.id }
            : {}),
        },
        trip,
        recoveryCase,
        detail?.criticalObjectiveAtRisk,
      );
    },
    firstTripId: async () => {
      const primaryEventId = programmeEventIds[0];
      const summaries = await trips.listTrips();
      if (primaryEventId) {
        for (const summary of summaries) {
          const trip = await trips.getTrip(summary.tripId);
          if (trip?.anchorEventId === primaryEventId) return trip.id;
        }
      }
      return summaries[0]?.tripId;
    },
    travellerDecision: async (caseId, body, at) => {
      const outcome = await settleTravellerDecision(
        { service: executionService, cases, trips },
        { caseId, verdict: body.decision, at, ...(body.note ? { note: body.note } : {}) },
      );
      return {
        accepted: outcome.accepted,
        ...(outcome.error ? { error: outcome.error } : {}),
        ...(outcome.verdict ? { verdict: outcome.verdict } : {}),
        ...(outcome.caseStatus ? { caseStatus: outcome.caseStatus } : {}),
        ...(outcome.execution?.verification?.resolution
          ? { resolutionOutcome: outcome.execution.verification.resolution.outcome }
          : {}),
      };
    },
    wave: {
      approvalsQueue: (at) => projectApprovalsQueue(readDeps, at),
      tripActivity: (tripId, at) => projectTripActivity(readDeps, tripId, at),
      tripUncertainties: (tripId, at) => projectTripUncertainties(readDeps, tripId, at),
      providers: (at) => Promise.resolve(projectProviderSurface(capabilityDescriptors, at)),
    },
    runtime: createRuntimeHandlers({
      orchestrator,
      trips,
      mutations,
      state: async () => ({
        trips: (await trips.listTrips()).map((summary) => ({
          tripId: summary.tripId,
          label: summary.label,
          viability: summary.viability,
          updatedAt: summary.updatedAt,
        })),
        openCases: (await cases.listOpenCases()).map((recoveryCase) => ({
          caseId: recoveryCase.id,
          tripId: recoveryCase.tripId,
          status: recoveryCase.status,
          strategyCount: recoveryCase.strategies.length,
        })),
      }),
    }),
    programme: createProgrammeHandlers({
      service: programmeService,
      readDeps,
      mutations,
      entities,
      trips,
      signals,
      cases,
      audit,
      modelClient,
    }),
    programmeAugmentations: (view) => projectProgrammeAugmentations(readDeps, view),
    resolution: createResolutionHandlers({
      trips,
      entities,
      signals,
      cases,
      audit,
      planner,
      capabilities,
      capabilityDescriptors,
      viability,
      sources,
      preferences,
    }),
    events: createEventIngestHandlers({
      inbox: eventInbox,
      normalizer: new AtlasFlightEventNormalizer(),
      trips,
      orchestrator,
      // DR-3 reconciliation: an ASSERTED push event is reconciled against the
      // provider's own current-state read through the shared REPLAY/LIVE
      // adapter path; the reconciled CONNECTED state legitimately outranks
      // the push (authority ladder untouched).
      reconciliation: {
        reader: new AtlasFlightStateReader({
          mode: config.adapterMode,
          store: recordingStore,
          baseUrl: config.providers.atlas.baseUrl,
          clientId: config.providers.atlas.clientId,
          clientSecret: config.providers.atlas.clientSecret,
        }),
        sources,
      },
    }),
    traveller: createChangeIntakeHandlers({
      // REPLAY is credential-free end to end. Passing a configured LIVE
      // client here would let natural-language intake escape the deterministic
      // boundary even though recovery planning correctly stays local.
      ...(useLivePlanner ? { modelClient } : {}),
      trips,
      entities,
      signals,
      cases,
      audit,
    }),
    eventChangePreview: createEventChangePreviewHandlers({
      mutations,
      entities,
      trips,
      signals,
      cases,
      audit,
    }),
    upload: createUploadIntakeHandlers(programmeService),
    demo,
  };

  return {
    db: database,
    endpoints,
    orchestrator,
    executionService,
    readDeps,
    dossierStore: dossiers,
    fxRateStore: fxRates,
    frankfurter,
    fxRateResolver,
    capabilities,
    capabilityDescriptors,
    planner,
    plannerMode: useLivePlanner ? 'MODEL_STUDIO' : 'DETERMINISTIC_FALLBACK',
    seededScenarioIds,
    seededProgrammes,
    programmeService,
  };
}

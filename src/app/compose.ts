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
import { join } from 'node:path';
import type { AppConfig } from '../config/config.ts';
import type { EntityId } from '../domain/common.ts';
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
  projectOperatorDashboard,
  projectProviderSurface,
  projectTravellerTrip,
  projectTripActivity,
  projectTripUncertainties,
  RecoveryExecutionService,
  seedScenarioBundle,
  settleTravellerDecision,
  SqlitePreferenceStore,
  type ReadModelDependencies,
} from './index.ts';
import { RuntimeOrchestrator } from './runtime.ts';
import { createRuntimeHandlers } from './runtimeHttp.ts';
import { ProgrammeService } from './programme.ts';
import { listProgrammeDirs, seedProgrammeBundle } from './programmeSeed.ts';
import { createProgrammeHandlers } from './programmeHttp.ts';
import { createResolutionHandlers } from './resolutionHttp.ts';
import { loadScenario, listScenarioDirs } from '../scenarios/loader.ts';
import type { ScenarioSpec } from '../scenarios/spec.ts';
import type { DemoSurface } from '../server/http.ts';

export interface ComposedRuntime {
  db: DatabaseSync;
  endpoints: AppEndpoints;
  orchestrator: RuntimeOrchestrator;
  executionService: RecoveryExecutionService;
  readDeps: ReadModelDependencies;
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
}

/** Compose the full application runtime over one SQLite database. */
export async function composeAppRuntime(config: AppConfig, db?: DatabaseSync): Promise<ComposedRuntime> {
  const database = db ?? openDatabase(config.sqlitePath);
  const trips = new SqliteTripRepository(database);
  const entities = new SqliteEntityStore(database);
  const sources = new SqliteSourceRepository(database);
  const signals = new SqliteSignalRepository(database);
  const cases = new SqliteCaseRepository(database);
  const audit = new SqliteAuditRepository(database);
  const preferences = new SqlitePreferenceStore(database);
  const mutations = new SqlMutationService({ db: database, trips, entities });

  // Deterministic generalized bootstrap: seed every accepted scenario bundle
  // when the store is empty. Fixture loading is allowed; scenario-specific
  // runtime behavior is not — every bundle is treated identically.
  const seededScenarioIds: string[] = [];
  const seededProgrammes: Array<{ anchorEventId: EntityId; promotedCount: number }> = [];
  // Programme seeding (boot + reset) runs through the SAME services the HTTP
  // surface uses; constructed once so both paths share one wiring.
  const bootProgrammeService = new ProgrammeService({ mutations, entities, trips, sources, audit });
  if ((await trips.listTrips()).length === 0) {
    const scenariosRoot = join(config.fixturesDir, 'scenarios');
    for (const entry of readdirSync(scenariosRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const outcome = await seedScenarioBundle(
        { mutations, sources, preferences, audit },
        join(scenariosRoot, entry.name),
      );
      seededScenarioIds.push(outcome.scenarioId);
    }
    for (const programmeDir of listProgrammeDirs(join(config.fixturesDir, 'programmes'))) {
      const outcome = await seedProgrammeBundle(bootProgrammeService, programmeDir);
      seededProgrammes.push({ anchorEventId: outcome.anchorEventId, promotedCount: outcome.promotedCount });
    }
  }

  const viability = new OverlayViabilityEngine();
  const readDeps: ReadModelDependencies = {
    snapshot: { trips, entities, preferences, sources },
    signals,
    cases,
    audit,
    viability,
  };
  const executionService = new RecoveryExecutionService({
    cases,
    audit,
    authority: new DeterministicAuthorityEngine({ ruleSets: ruleSetSource(entities) }),
    executor: createRecoveryExecutor({
      inner: new BoundaryExecutor(),
      strategyFor: async (intent) =>
        (await cases.getCase(intent.caseId))?.strategies.find((strategy) => strategy.id === intent.strategyId),
    }),
    observation: new DeterministicObservationService({ mutations }),
    verifier: new CaseVerifier({ trips, signals, entities }),
    trips,
    entities,
    // Funding evidence lives on triggering signals (change-request anchors).
    signals,
  });

  // Read-only capability wiring: Atlas always present (REPLAY is
  // credential-free); Google Routes contributes only when configured or
  // recorded; Nuitée (liteAPI) replays the curated hotel corpus without
  // credentials and fails closed (NOT_CONFIGURED) for LIVE/RECORD without
  // NUITEE_API_KEY. Scenario bundles may ship their own recordings; the
  // curated fixtures/recordings corpus is readable by the composed app too.
  const recordingReadDirs = [
    ...readdirSync(join(config.fixturesDir, 'scenarios'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(config.fixturesDir, 'scenarios', entry.name, 'recordings')),
    join(config.fixturesDir, 'recordings'),
    config.recordingsDir,
  ];
  const recordingStore = new FileRecordingStore({ readDirs: recordingReadDirs });
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
  const capabilities: ToolDispatchCapabilities = { flight, routing, hotel };
  const capabilityDescriptors: CapabilityDescriptor[] = [flight.descriptor, routing.descriptor, hotel.descriptor];

  // Planner: LIVE Model Studio only when explicitly NOT in REPLAY mode AND
  // the API key is configured; REPLAY must never make external AI calls even
  // when credentials are present. The deterministic fallback planner is the
  // credential-free path that completes the loop without network calls.
  const modelClient = new ModelStudioClient({
    apiKey: config.providers.modelStudio.apiKey,
    model: config.providers.modelStudio.model,
    baseUrl: config.providers.modelStudio.baseUrl,
  });
  const useLivePlanner = config.adapterMode !== 'REPLAY' && modelClient.isConfigured();
  const basePlanner: RecoveryPlanner = useLivePlanner
    ? new ModelStudioRecoveryPlanner({ client: modelClient })
    : new DeterministicFallbackPlanner();
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
    programmeEventIds: () => seededProgrammes.map((p) => p.anchorEventId),
    plannerMode: () => useLivePlanner ? 'MODEL_STUDIO' : 'DETERMINISTIC_FALLBACK',
    async reset(at) {
      try {
        const result = await orchestrator.reset(at);
        return { status: 200, body: { message: 'reset complete', ...result } };
      } catch (error) {
        return { status: 500, body: { error: error instanceof Error ? error.message : String(error) } };
      }
    },
    async triggerScenario(name, at) {
      const spec = scenarioSpecs.get(name);
      if (!spec) {
        return { status: 404, body: { error: `unknown scenario: ${name}` } };
      }
      try {
        const result = await orchestrator.processDisruption(spec.disruption.signal);
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
  };

  const programmeService = bootProgrammeService;
  const endpoints: AppEndpoints = {
    now: () => new Date().toISOString(),
    operatorDashboard: (at) => projectOperatorDashboard(readDeps, at),
    caseDetail: (caseId, at) => projectCaseDetail(readDeps, caseId, at),
    travellerTrip: (tripId, at) => projectTravellerTrip(readDeps, tripId, at),
    firstTripId: async () => (await trips.listTrips())[0]?.tripId,
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
    demo,
  };

  return {
    db: database,
    endpoints,
    orchestrator,
    executionService,
    readDeps,
    capabilities,
    capabilityDescriptors,
    planner,
    plannerMode: useLivePlanner ? 'MODEL_STUDIO' : 'DETERMINISTIC_FALLBACK',
    seededScenarioIds,
    seededProgrammes,
  };
}

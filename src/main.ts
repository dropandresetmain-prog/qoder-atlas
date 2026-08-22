/**
 * Application entrypoint — Checkpoint B composition.
 *
 * Boots credential-free (REPLAY by default): opens SQLite, seeds any accepted
 * scenario bundles found under the fixtures directory when the store is empty
 * (generic bootstrap — the runtime never knows which scenario it serves),
 * wires the full generalized recovery loop seams, and serves real operator /
 * traveller read models over HTTP.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config/config.ts';
import { openDatabase, kvGet } from './persistence/database.ts';
import {
  SqliteAuditRepository,
  SqliteCaseRepository,
  SqliteSignalRepository,
  SqliteSourceRepository,
  SqliteTripRepository,
} from './persistence/repositories.ts';
import { SqliteEntityStore } from './persistence/entityStore.ts';
import { SqlMutationService } from './engine/mutation.ts';
import { OverlayViabilityEngine } from './engine/overlay.ts';
import { BoundaryExecutor } from './engine/executor.ts';
import { DeterministicAuthorityEngine, ruleSetSource } from './engine/authority.ts';
import { CaseVerifier, DeterministicObservationService } from './engine/observation.ts';
import { createAppServer, type AppEndpoints } from './server/http.ts';
import {
  createRecoveryExecutor,
  projectCaseDetail,
  projectOperatorDashboard,
  projectTravellerTrip,
  RecoveryExecutionService,
  seedScenarioBundle,
  settleTravellerDecision,
  SqlitePreferenceStore,
  type ReadModelDependencies,
} from './app/index.ts';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDatabase(config.sqlitePath);
  const trips = new SqliteTripRepository(db);
  const entities = new SqliteEntityStore(db);
  const sources = new SqliteSourceRepository(db);
  const signals = new SqliteSignalRepository(db);
  const cases = new SqliteCaseRepository(db);
  const audit = new SqliteAuditRepository(db);
  const preferences = new SqlitePreferenceStore(db);
  const mutations = new SqlMutationService({ db, trips, entities });

  // Deterministic generalized bootstrap: seed every accepted scenario bundle
  // when the store is empty. Fixture loading is allowed; scenario-specific
  // runtime behavior is not — this loop treats all bundles identically.
  if ((await trips.listTrips()).length === 0) {
    const scenariosRoot = join(config.fixturesDir, 'scenarios');
    for (const entry of readdirSync(scenariosRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const outcome = await seedScenarioBundle({ mutations, sources, preferences, audit }, join(scenariosRoot, entry.name));
      console.log(`[atlas] seeded scenario bundle ${entry.name}: trip ${outcome.tripId}`);
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
  });

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
  };

  const server = createAppServer(config, endpoints);
  server.listen(config.httpPort, () => {
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : config.httpPort;
    console.log(
      `[atlas] AI Trip Recovery Layer started env=${config.environment} mode=${config.adapterMode} ` +
        `schema=v${kvGet(db, 'schema_version')} http=http://localhost:${port}/operator`,
    );
  });

  const shutdown = (signal: string): void => {
    console.log(`[atlas] received ${signal}, shutting down`);
    server.close(() => {
      db.close();
      process.exit(0);
    });
    // Hard exit if connections refuse to drain.
    setTimeout(() => process.exit(1), 3000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

void main();

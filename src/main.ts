/**
 * Application entrypoint — Checkpoint C composition.
 *
 * Boots credential-free (REPLAY by default), composes the full runtime
 * (bootstrap seeding, recovery loop seams, read models, generic runtime
 * disruption/reset flow — see src/app/compose.ts), and serves it over HTTP.
 * No scenario-specific endpoints.
 */
import { loadConfig } from './config/config.ts';
import { kvGet } from './persistence/database.ts';
import { createAppServer } from './server/http.ts';
import { composeAppRuntime } from './app/compose.ts';

async function main(): Promise<void> {
  const config = loadConfig();
  const composed = await composeAppRuntime(config);

  for (const scenarioId of composed.seededScenarioIds) {
    console.log(`[atlas] seeded scenario bundle ${scenarioId}`);
  }
  console.log(
    `[atlas] planner=${composed.plannerMode === 'MODEL_STUDIO' ? 'Model Studio (live)' : 'deterministic fallback (credential-free)'}`,
  );

  const server = createAppServer(config, composed.endpoints);
  server.on('error', (error) => {
    console.error('[atlas] failed to start HTTP server:', error);
    composed.db.close();
    process.exit(1);
  });
  server.listen(config.httpPort, '0.0.0.0', () => {
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : config.httpPort;
    const host = typeof address === 'object' && address !== null ? address.address : '0.0.0.0';
    console.log(
      `[atlas] AI Trip Recovery Layer started env=${config.environment} mode=${config.adapterMode} ` +
        `schema=v${kvGet(composed.db, 'schema_version')} http=http://${host}:${port}/operator`,
    );

    if (config.environment === 'demo' && composed.endpoints.demo?.resetPopulatedWorld) {
      const caseRow = composed.db.prepare('SELECT COUNT(*) AS c FROM cases').get() as { c: number };
      if (caseRow.c === 0) {
        const baseUrl = `http://127.0.0.1:${port}`;
        void composed.endpoints.demo.resetPopulatedWorld(baseUrl).then((outcome) => {
          if (outcome.status !== 200) {
            console.warn('[atlas] populated demo world bootstrap failed:', outcome.body);
          } else {
            console.log('[atlas] populated demo world bootstrapped for default Overview entry');
          }
        });
      }
    }
  });

  const shutdown = (signal: string): void => {
    console.log(`[atlas] received ${signal}, shutting down`);
    server.close(() => {
      composed.db.close();
      process.exit(0);
    });
    // Hard exit if connections refuse to drain.
    setTimeout(() => process.exit(1), 3000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

void main().catch((error: unknown) => {
  console.error('[atlas] startup failed:', error);
  process.exit(1);
});

/**
 * Application entrypoint — Checkpoint C composition.
 *
 * Boots credential-free (REPLAY by default), composes the full runtime
 * (bootstrap seeding, recovery loop seams, read models, generic runtime
 * disruption/reset flow — see src/app/compose.ts), and serves it over HTTP.
 * No scenario-specific endpoints.
 *
 * Railway: bind `PORT` on `0.0.0.0` as early as possible so platform health
 * checks succeed while composition/seeding is still running.
 */
import { createServer, type Server } from 'node:http';
import { loadConfig, type AppConfig } from './config/config.ts';
import { kvGet } from './persistence/database.ts';
import { createAppServer } from './server/http.ts';
import { composeAppRuntime } from './app/compose.ts';

function resolveListenPort(config: AppConfig): number {
  // Host PORT must win on Railway; empty HTTP_PORT must never displace it.
  const raw = process.env.PORT?.trim() || process.env.HTTP_PORT?.trim();
  if (raw) {
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) return parsed;
  }
  return config.httpPort;
}

async function listenEarlyHealth(port: number): Promise<Server> {
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (req.method === 'GET' && path === '/health') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ status: 'starting', time: new Date().toISOString() }));
      return;
    }
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Northstar is starting');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => resolve());
  });
  return server;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const listenPort = resolveListenPort(config);

  if (process.env.RAILWAY_ENVIRONMENT && !process.env.PORT?.trim()) {
    throw new Error(
      'Railway injects PORT for the public proxy; refusing to start without it ' +
        `(would bind ${listenPort} while the domain targets the platform PORT).`,
    );
  }

  console.log(
    `[atlas] listen target port=${listenPort} bind=0.0.0.0 ` +
      `env.PORT=${process.env.PORT ?? 'unset'} env.HTTP_PORT=${process.env.HTTP_PORT ?? 'unset'}`,
  );

  // Bind immediately so Railway healthchecks do not mark the deploy failed
  // while compose/seed work is still in progress.
  const early = await listenEarlyHealth(listenPort);
  console.log(`[atlas] early health listener ready on 0.0.0.0:${listenPort}`);

  let composed: Awaited<ReturnType<typeof composeAppRuntime>>;
  try {
    composed = await composeAppRuntime(config);
  } catch (error) {
    await closeServer(early).catch(() => undefined);
    throw error;
  }

  for (const scenarioId of composed.seededScenarioIds) {
    console.log(`[atlas] seeded scenario bundle ${scenarioId}`);
  }
  console.log(
    `[atlas] planner=${composed.plannerMode === 'MODEL_STUDIO' ? 'Model Studio (live)' : 'deterministic fallback (credential-free)'}`,
  );

  await closeServer(early);

  const server = createAppServer(config, composed.endpoints);
  server.on('error', (error) => {
    console.error('[atlas] failed to start HTTP server:', error);
    composed.db.close();
    process.exit(1);
  });
  server.listen(listenPort, '0.0.0.0', () => {
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : listenPort;
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

/**
 * Application entrypoint — M10 PostgreSQL-target-only boot.
 *
 * Normal NORTHSTAR operation has exactly one runtime: the PostgreSQL target
 * (`composeTargetBoot` -> `composeTargetApplication`/`composeTargetEndpoints`
 * -> `targetHttpHandlers.ts`). Nothing this file imports, directly or
 * transitively, touches SQLite — see `test/m10-runtime-purge.test.ts` for the
 * structural check that keeps that true, not just this comment.
 *
 * The legacy SQLite composition (`src/app/compose.ts`, `src/server/http.ts`)
 * still exists for existing test harnesses and the M10 migration rehearsal
 * (offline export reads legacy stores directly, never through a running
 * server) — it is not imported here and is never reachable from a normal
 * `npm run dev` / `npm start` boot.
 *
 * Railway: bind `PORT` on `0.0.0.0` as early as possible so platform health
 * checks succeed while composition is still running.
 */
import { createServer, type Server } from 'node:http';
import { loadConfig } from './config/config.ts';
import { composeTargetBoot } from './app/composeTargetBoot.ts';
import { createTargetAppServer } from './server/targetHttp.ts';

function resolveListenPort(configuredPort: number): number {
  // Host PORT must win on Railway; empty HTTP_PORT must never displace it.
  const raw = process.env.PORT?.trim() || process.env.HTTP_PORT?.trim();
  if (raw) {
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) return parsed;
  }
  return configuredPort;
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
  // `loadConfig` reads env only (zod parsing) — it never opens the SQLite
  // path it happens to also resolve; that field is simply unused here.
  const config = loadConfig(process.env);
  const listenPort = resolveListenPort(config.httpPort);

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
  // while composition is still in progress.
  const early = await listenEarlyHealth(listenPort);
  console.log(`[atlas] early health listener ready on 0.0.0.0:${listenPort}`);

  let boot: Awaited<ReturnType<typeof composeTargetBoot>>;
  try {
    boot = await composeTargetBoot(process.env);
  } catch (error) {
    await closeServer(early).catch(() => undefined);
    throw error;
  }

  await closeServer(early);

  const server = createTargetAppServer(
    { environment: boot.config.environment, workspaceId: boot.config.workspaceId },
    boot.endpoints,
  );
  server.on('error', (error) => {
    console.error('[atlas] failed to start HTTP server:', error);
    void boot.close().finally(() => process.exit(1));
  });
  server.listen(listenPort, '0.0.0.0', () => {
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : listenPort;
    const host = typeof address === 'object' && address !== null ? address.address : '0.0.0.0';
    console.log(
      `[atlas] AI Trip Recovery Layer started env=${boot.config.environment} runtime=POSTGRES_TARGET ` +
        `workspace=${boot.config.workspaceId} http=http://${host}:${port}/`,
    );
  });

  const shutdown = (signal: string): void => {
    console.log(`[atlas] received ${signal}, shutting down`);
    server.close(() => {
      void boot.close().finally(() => process.exit(0));
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

/**
 * M10 — the ONLY HTTP composition for normal NORTHSTAR operation.
 *
 * PostgreSQL-only: every route here is served by `handleTargetProductHttp`
 * (`src/app/target/targetHttpHandlers.ts`), which is verified to import
 * nothing under `src/persistence/{database,repositories,entityStore}.ts` or
 * any app-owned SQLite store. This module itself imports no SQLite module —
 * see `test/m10-runtime-purge.test.ts` for the structural check that keeps
 * that true.
 *
 * The legacy SQLite composition (`src/app/compose.ts` / `src/server/http.ts`)
 * is a separate, explicitly-opt-in module for migration rehearsal and
 * existing test harnesses only — `main.ts` does not import it by default.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TargetEndpoints } from '../app/target/composeTargetEndpoints.ts';

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(payload);
}

/** Allowlisted static presentation assets — never resolves outside fixtures/ui. */
const UI_ASSETS = ['northstar-logo.png'];

/**
 * Product route -> the read-only handler that renders it. GET only.
 *
 * `/operator` is an alias of `/`: Founder B1 (FB1-4) went looking for the
 * operator surface at the name the docs and the legacy runtime used, and got
 * a 404 from the normal PostgreSQL runtime. Both names now reach the same
 * authoritative handler.
 */
const SHELL_ROUTES: Record<string, string | undefined> = {
  '/': '/api/v2/operator/overview',
  '/operator': '/api/v2/operator/overview',
  '/programme': '/api/v2/operator/programme',
  '/decisions': '/api/v2/operator/decisions',
  '/activity': '/api/v2/operator/activity',
};

/*
 * The clean focused-case route `/operator/cases/:id` is answered by the
 * product handlers (`endpoints.handle`, first in `handle`), which render the
 * case IN PLACE inside the shell — there is deliberately no redirect to an
 * `/api/v2/...` URL here. The API route stays available for API/debug use.
 */

async function serveStaticAsset(res: ServerResponse, assetName: string): Promise<boolean> {
  if (!UI_ASSETS.includes(assetName)) return false;
  try {
    const assetPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../fixtures/ui',
      assetName,
    );
    const bytes = await readFile(assetPath);
    res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' });
    res.end(bytes);
    return true;
  } catch {
    return false;
  }
}

interface TargetServerOptions {
  environment: string;
  /** Workspace whose overview `/` redirects to. */
  workspaceId: string;
}

async function handle(
  options: TargetServerOptions,
  endpoints: TargetEndpoints,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (await endpoints.handle(req, res, url)) return;

  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, {
      status: 'ok',
      environment: options.environment,
      runtime: 'POSTGRES_TARGET',
      time: new Date().toISOString(),
    });
    return;
  }

  // Clean product routes for the shell's nav. Each is a GET that redirects to
  // the read-only handler which renders the same surface inside the shell, so
  // the chrome's links and the API surface can never drift apart.
  const shellRoute = SHELL_ROUTES[url.pathname];
  if (req.method === 'GET' && shellRoute) {
    res.writeHead(302, { location: `${shellRoute}?format=html` });
    res.end();
    return;
  }

  const uiAsset = url.pathname.startsWith('/assets/') ? url.pathname.slice('/assets/'.length) : '';
  if (req.method === 'GET' && uiAsset && (await serveStaticAsset(res, uiAsset))) return;

  sendJson(res, 404, { error: 'not_found', path: url.pathname });
}

/**
 * The sole normal-operation HTTP server. No SQLite composition is reachable
 * from this function or anything it calls.
 */
export function createTargetAppServer(options: TargetServerOptions, endpoints: TargetEndpoints): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    void handle(options, endpoints, req, res).catch((error) => {
      sendJson(res, 500, { error: 'internal', message: error instanceof Error ? error.message : String(error) });
    });
  });
}

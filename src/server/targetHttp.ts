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

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(302, { location: '/api/v2/operator/overview?format=html' });
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

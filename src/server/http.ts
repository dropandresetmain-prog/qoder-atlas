/**
 * Minimal HTTP server skeleton (F0) on node:http — no framework dependency.
 * Lane E (UI) and the integrator build real read-model endpoints on this seam;
 * the read models themselves live in `src/contracts/readmodels.ts` (F2).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AppConfig } from '../config/config.ts';

export interface HealthView {
  status: 'ok';
  environment: AppConfig['environment'];
  adapterMode: AppConfig['adapterMode'];
  time: string;
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

export function createAppServer(config: AppConfig): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/health') {
      const view: HealthView = {
        status: 'ok',
        environment: config.environment,
        adapterMode: config.adapterMode,
        time: new Date().toISOString(),
      };
      sendJson(res, 200, view);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/') {
      sendJson(res, 200, {
        name: 'AI Trip Recovery / Resolution Layer',
        adapterMode: config.adapterMode,
        checkpoint: 'A — foundation and contracts',
      });
      return;
    }
    sendJson(res, 404, { error: 'not_found', path: url.pathname });
  });
}

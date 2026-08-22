/**
 * I5 — minimal HTTP composition on node:http (no framework, ADR-002 scale).
 *
 * HTML surfaces render Lane E's pure screens from REAL projected read models
 * (src/app/readmodels.ts); JSON endpoints expose the same projections for
 * inspection. The traveller decision endpoint drives the actual authority /
 * execution lifecycle — it never mutates presentation state only.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AppConfig } from '../config/config.ts';
import type { EntityId, IsoDateTime } from '../domain/common.ts';
import type { OperatorDashboardView, TravellerTripView } from '../contracts/readmodels.ts';
import type { CaseDetailView } from '../ui/case-view-model.ts';
import { renderPage } from '../ui/page.ts';
import { renderOperatorDashboardBody } from '../ui/screens/operator-dashboard.ts';
import { renderCaseDetailBody, renderCaseDetail } from '../ui/screens/operator-case.ts';
import { renderTravellerTrip } from '../ui/screens/traveller.ts';

export interface HealthView {
  status: 'ok';
  environment: AppConfig['environment'];
  adapterMode: AppConfig['adapterMode'];
  time: string;
}

export interface TravellerDecisionBody {
  decision: 'APPROVED' | 'DECLINED';
  note?: string;
}

export interface TravellerDecisionHttpResult {
  accepted: boolean;
  error?: string;
  verdict?: 'APPROVED' | 'DECLINED';
  caseStatus?: string;
  resolutionOutcome?: string;
}

/** Application endpoints the HTTP surface projects; wired by the integrator. */
export interface AppEndpoints {
  now(): IsoDateTime;
  operatorDashboard(at: IsoDateTime): Promise<OperatorDashboardView>;
  caseDetail(caseId: EntityId, at: IsoDateTime): Promise<CaseDetailView | undefined>;
  travellerTrip(tripId: EntityId, at: IsoDateTime): Promise<TravellerTripView | undefined>;
  firstTripId(): Promise<EntityId | undefined>;
  travellerDecision(
    caseId: EntityId,
    body: TravellerDecisionBody,
    at: IsoDateTime,
  ): Promise<TravellerDecisionHttpResult>;
}

const PAGE_LINKS = { dashboard: '/operator', traveller: '/traveller' };

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendHtml(res: ServerResponse, statusCode: number, html: string): void {
  res.writeHead(statusCode, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(html),
  });
  res.end(html);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString('utf8');
      if (raw.length > 1_000_000) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolvePromise(raw));
    req.on('error', reject);
  });
}

export function createAppServer(config: AppConfig, endpoints?: AppEndpoints): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    void handle(config, endpoints, req, res).catch((error) => {
      sendJson(res, 500, { error: 'internal', message: error instanceof Error ? error.message : String(error) });
    });
  });
}

async function handle(
  config: AppConfig,
  endpoints: AppEndpoints | undefined,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const segments = url.pathname.split('/').filter(Boolean);

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
      checkpoint: 'B candidate — generalized vertical recovery loop',
      surfaces: endpoints ? ['/operator', '/traveller'] : [],
    });
    return;
  }

  if (!endpoints) {
    sendJson(res, 404, { error: 'not_found', path: url.pathname });
    return;
  }

  // --- Operator HTML surfaces -------------------------------------------
  if (req.method === 'GET' && url.pathname === '/operator') {
    const view = await endpoints.operatorDashboard(endpoints.now());
    const body = renderOperatorDashboardBody(view);
    sendHtml(res, 200, renderPage({ title: 'Operations overview', active: 'dashboard', links: PAGE_LINKS }, body));
    return;
  }
  if (req.method === 'GET' && segments[0] === 'operator' && segments[1] === 'cases' && segments[2]) {
    const at = endpoints.now();
    const view = await endpoints.caseDetail(segments[2], at);
    const body = view
      ? renderCaseDetailBody(view)
      : renderCaseDetail({ state: 'ERROR', errorMessage: `No recovery case ${segments[2]} is known`, generatedAt: at });
    sendHtml(res, view ? 200 : 404, renderPage({ title: 'Recovery case', active: 'case', links: PAGE_LINKS }, body));
    return;
  }

  // --- Traveller HTML surface -------------------------------------------
  if (req.method === 'GET' && url.pathname === '/traveller') {
    const at = endpoints.now();
    const tripId = url.searchParams.get('trip') ?? (await endpoints.firstTripId());
    const view = tripId ? await endpoints.travellerTrip(tripId, at) : undefined;
    const body = renderTravellerTrip(
      view ? { state: 'LOADED', data: view, generatedAt: at } : { state: 'ERROR', errorMessage: 'No trip is being managed yet', generatedAt: at },
    );
    sendHtml(
      res,
      view ? 200 : 404,
      renderPage({ title: 'Your trip', active: 'traveller', surface: 'traveller', links: PAGE_LINKS }, body),
    );
    return;
  }

  // --- JSON read models ---------------------------------------------------
  if (req.method === 'GET' && url.pathname === '/api/operator/dashboard') {
    sendJson(res, 200, await endpoints.operatorDashboard(endpoints.now()));
    return;
  }
  if (req.method === 'GET' && segments[0] === 'api' && segments[1] === 'cases' && segments[2]) {
    const view = await endpoints.caseDetail(segments[2], endpoints.now());
    if (!view) {
      sendJson(res, 404, { error: 'unknown_case', caseId: segments[2] });
      return;
    }
    sendJson(res, 200, view);
    return;
  }
  if (req.method === 'GET' && segments[0] === 'api' && segments[1] === 'traveller' && segments[2]) {
    const view = await endpoints.travellerTrip(segments[2], endpoints.now());
    if (!view) {
      sendJson(res, 404, { error: 'unknown_trip', tripId: segments[2] });
      return;
    }
    sendJson(res, 200, view);
    return;
  }

  // --- Traveller decision: drives the real authority/execution lifecycle ---
  if (req.method === 'POST' && segments[0] === 'api' && segments[1] === 'cases' && segments[2] && segments[3] === 'traveller-decision') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readBody(req));
    } catch {
      sendJson(res, 400, { error: 'invalid_json' });
      return;
    }
    const body = parsed as Partial<TravellerDecisionBody>;
    if (body.decision !== 'APPROVED' && body.decision !== 'DECLINED') {
      sendJson(res, 400, { error: 'decision must be APPROVED or DECLINED' });
      return;
    }
    const result = await endpoints.travellerDecision(
      segments[2],
      { decision: body.decision, ...(typeof body.note === 'string' ? { note: body.note } : {}) },
      endpoints.now(),
    );
    sendJson(res, result.accepted ? 200 : 409, result);
    return;
  }

  sendJson(res, 404, { error: 'not_found', path: url.pathname });
}

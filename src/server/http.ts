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
import type { OperatorDashboardView, ProgrammeView, TravellerTripView } from '../contracts/readmodels.ts';
import type { CaseDetailView } from '../ui/case-view-model.ts';
import type {
  ApprovalsQueueView,
  ProviderSurfaceView,
  TripActivityView,
  TripUncertaintiesView,
} from '../app/waveReadmodels.ts';
import { renderPage } from '../ui/page.ts';
import { renderOperatorDashboardBody } from '../ui/screens/operator-dashboard.ts';
import { renderCaseDetailBody, renderCaseDetail } from '../ui/screens/operator-case.ts';
import { renderProgramme } from '../ui/screens/operator-programme.ts';
import { renderTravellerTrip } from '../ui/screens/traveller.ts';
import { renderDemoPanel } from '../ui/screens/demo-panel.ts';

export interface HealthView {
  status: 'ok';
  environment: AppConfig['environment'];
  adapterMode: AppConfig['adapterMode'];
  time: string;
}

/**
 * Demo-only surface: scenario trigger + reset for local clickaround.
 * Never wired in production; only present when the composition loaded
 * scenario fixtures for demo convenience.
 */
export interface DemoSurface {
  scenarioNames(): string[];
  /** Seeded programme event IDs for demo navigation links. */
  programmeEventIds?(): string[];
  /** Which planner is active (for the demo banner display). */
  plannerMode?: () => 'MODEL_STUDIO' | 'DETERMINISTIC_FALLBACK';
  reset(at: IsoDateTime): Promise<{ status: number; body: unknown }>;
  triggerScenario(name: string, at: IsoDateTime): Promise<{ status: number; body: unknown }>;
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

/**
 * Generic runtime recovery flow (R1/PL-3). Handlers receive the parsed JSON
 * body and return the wire status + body; scenario-neutral validation and
 * engine calls live in the application layer that implements them.
 */
export interface RuntimeHandlers {
  disruption(body: unknown): Promise<{ status: number; body: unknown }>;
  plan(body: unknown): Promise<{ status: number; body: unknown }>;
  begin(body: unknown): Promise<{ status: number; body: unknown }>;
  decide(body: unknown): Promise<{ status: number; body: unknown }>;
  execute(body: unknown): Promise<{ status: number; body: unknown }>;
  reset(body: unknown): Promise<{ status: number; body: unknown }>;
  state(): Promise<{ status: number; body: unknown }>;
}

/**
 * Programme coordination surface (Northstar RV-N1/RV-N2). Handlers receive
 * wire JSON and return status + body; validation and engine calls live in
 * src/app/programmeHttp.ts. Present only when the programme service is
 * wired by the integrator.
 */
export interface ProgrammeHandlers {
  view(params: { anchorEventId: string; at: string }): Promise<{ status: number; body: unknown }>;
  applyContext(body: unknown): Promise<{ status: number; body: unknown }>;
  intakeImport(body: unknown): Promise<{ status: number; body: unknown }>;
  commitmentChange(body: unknown): Promise<{ status: number; body: unknown }>;
  mapRoster(body: unknown): Promise<{ status: number; body: unknown }>;
  mapBrief(body: unknown): Promise<{ status: number; body: unknown }>;
}

/**
 * Resolution surface (Northstar RV-N3/RV-N5). Initial planning for
 * engagement-only trips and traveller ChangeRequest resolution; handlers
 * receive wire JSON and return status + body.
 */
export interface ResolutionHandlers {
  initialPlan(body: unknown): Promise<{ status: number; body: unknown }>;
  changeRequest(body: unknown): Promise<{ status: number; body: unknown }>;
}

/**
 * Wave 3 operational surfaces (Gate 2): app-layer projections the UI lane
 * renders verbatim — approval queue, activity stream, uncertainties, and
 * truthful provider provenance. Never inferred on the frontend.
 */
export interface WaveSurfaces {
  approvalsQueue(at: IsoDateTime): Promise<ApprovalsQueueView>;
  tripActivity(tripId: EntityId, at: IsoDateTime): Promise<TripActivityView | undefined>;
  tripUncertainties(tripId: EntityId, at: IsoDateTime): Promise<TripUncertaintiesView | undefined>;
  providers(at: IsoDateTime): Promise<ProviderSurfaceView>;
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
  /** Present when the Wave 3 operational surfaces (approvals/activity/
   *  uncertainties/provenance) are wired. */
  wave?: WaveSurfaces;
  /** Present when the runtime recovery/reset flow is wired. */
  runtime?: RuntimeHandlers;
  /** Present when the Northstar programme surface is wired. */
  programme?: ProgrammeHandlers;
  /** Present when the Northstar resolution surface is wired. */
  resolution?: ResolutionHandlers;
  /** Demo-only: scenario triggers for local clickaround. */
  demo?: DemoSurface;
}

const PAGE_LINKS = { dashboard: '/operator', traveller: '/traveller' };

/** Build the demo banner options from the current config. */
function demoBannerOptions(config: AppConfig, endpoints?: AppEndpoints): { demoBanner: { adapterMode: 'LIVE' | 'RECORD' | 'REPLAY'; plannerMode?: 'MODEL_STUDIO' | 'DETERMINISTIC_FALLBACK' } } {
  return { demoBanner: { adapterMode: config.adapterMode, plannerMode: endpoints?.demo?.plannerMode?.() } };
}

/** Best-effort extraction of a seeded programme event ID for demo links. */
function seededProgrammeEventId(endpoints: AppEndpoints): string | undefined {
  return endpoints.demo?.programmeEventIds?.()[0];
}

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
      checkpoint: 'C candidate — generalized recovery + runtime disruption/reset flow',
      surfaces: endpoints
        ? [...['/operator', '/traveller'], ...(endpoints.runtime ? ['/api/runtime/state'] : [])]
        : [],
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
    sendHtml(res, 200, renderPage({ title: 'Operations overview', active: 'dashboard', links: PAGE_LINKS, ...demoBannerOptions(config, endpoints) }, body));
    return;
  }
  if (req.method === 'GET' && segments[0] === 'operator' && segments[1] === 'cases' && segments[2]) {
    const at = endpoints.now();
    const view = await endpoints.caseDetail(segments[2], at);
    const body = view
      ? renderCaseDetailBody(view)
      : renderCaseDetail({ state: 'ERROR', errorMessage: `No recovery case ${segments[2]} is known`, generatedAt: at });
    sendHtml(res, view ? 200 : 404, renderPage({ title: 'Recovery case', active: 'case', links: PAGE_LINKS, ...demoBannerOptions(config, endpoints) }, body));
    return;
  }

  // --- Programme HTML surface (Northstar RV-N10) --------------------------
  if (req.method === 'GET' && url.pathname === '/programme') {
    if (!endpoints.programme) {
      sendJson(res, 404, { error: 'not_found', path: url.pathname });
      return;
    }
    const at = url.searchParams.get('at') ?? endpoints.now();
    const eventId = url.searchParams.get('event');
    const outcome = eventId
      ? await endpoints.programme.view({ anchorEventId: eventId, at })
      : { status: 400, body: { error: 'missing_event_param' } };
    const body =
      outcome.status === 200
        ? renderProgramme({ state: 'LOADED', data: outcome.body as ProgrammeView, generatedAt: at })
        : renderProgramme({
            state: 'ERROR',
            errorMessage:
              outcome.status === 404
                ? `No programme is known for event ${eventId ?? ''}.`
                : 'The programme could not be loaded: the request was invalid.',
            generatedAt: at,
          });
    sendHtml(
      res,
      outcome.status === 200 ? 200 : outcome.status === 404 ? 404 : 400,
      renderPage({ title: 'Programme', active: 'dashboard', links: PAGE_LINKS, ...demoBannerOptions(config, endpoints) }, body),
    );
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
      renderPage({ title: 'Your trip', active: 'traveller', surface: 'traveller', links: PAGE_LINKS, ...demoBannerOptions(config, endpoints) }, body),
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

  // --- Wave 3 operational surfaces (Gate 2) -------------------------------
  if (req.method === 'GET' && segments[0] === 'api' && segments[1] === 'wave' && endpoints.wave) {
    if (segments[2] === 'approvals') {
      sendJson(res, 200, await endpoints.wave.approvalsQueue(endpoints.now()));
      return;
    }
    if (segments[2] === 'providers') {
      sendJson(res, 200, await endpoints.wave.providers(endpoints.now()));
      return;
    }
    if (segments[2] === 'trips' && segments[3]) {
      const tripId = segments[3];
      if (segments[4] === 'activity') {
        const view = await endpoints.wave.tripActivity(tripId, endpoints.now());
        if (!view) {
          sendJson(res, 404, { error: 'unknown_trip', tripId });
          return;
        }
        sendJson(res, 200, view);
        return;
      }
      if (segments[4] === 'uncertainties') {
        const view = await endpoints.wave.tripUncertainties(tripId, endpoints.now());
        if (!view) {
          sendJson(res, 404, { error: 'unknown_trip', tripId });
          return;
        }
        sendJson(res, 200, view);
        return;
      }
    }
    sendJson(res, 404, { error: 'not_found', path: url.pathname });
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

  // --- Generic runtime recovery flow (R1/PL-3) -----------------------------
  if (segments[0] === 'api' && segments[1] === 'runtime' && endpoints.runtime) {
    const action = segments[2];
    if (action === 'state' && req.method === 'GET') {
      const outcome = await endpoints.runtime.state();
      sendJson(res, outcome.status, outcome.body);
      return;
    }
    if (action === 'state') {
      sendJson(res, 405, { error: 'method_not_allowed', path: url.pathname });
      return;
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method_not_allowed', path: url.pathname });
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readBody(req));
    } catch {
      sendJson(res, 400, { error: 'invalid_json' });
      return;
    }
    const handlers = endpoints.runtime;
    switch (action) {
      case 'disruption':
      case 'plan':
      case 'begin':
      case 'decide':
      case 'execute':
      case 'reset': {
        const outcome = await handlers[action](parsed);
        sendJson(res, outcome.status, outcome.body);
        return;
      }
      default:
        sendJson(res, 404, { error: 'not_found', path: url.pathname });
        return;
    }
  }

  // --- Programme coordination surface (Northstar RV-N1/RV-N2) -------------
  if (endpoints.programme && segments[0] === 'api' && segments[1] === 'programme') {
    const handlers = endpoints.programme;
    if (req.method === 'GET' && segments[2]) {
      const at = url.searchParams.get('at') ?? endpoints.now();
      const outcome = await handlers.view({ anchorEventId: segments[2], at });
      sendJson(res, outcome.status, outcome.body);
      return;
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method_not_allowed', path: url.pathname });
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readBody(req));
    } catch {
      sendJson(res, 400, { error: 'invalid_json' });
      return;
    }
    if (segments[2] === 'context') {
      const outcome = await handlers.applyContext(parsed);
      sendJson(res, outcome.status, outcome.body);
      return;
    }
    if (segments[2] === 'import') {
      const outcome = await handlers.intakeImport(parsed);
      sendJson(res, outcome.status, outcome.body);
      return;
    }
    if (segments[2] === 'commitment-change') {
      const outcome = await handlers.commitmentChange(parsed);
      sendJson(res, outcome.status, outcome.body);
      return;
    }
    if (segments[2] === 'map-roster') {
      const outcome = await handlers.mapRoster(parsed);
      sendJson(res, outcome.status, outcome.body);
      return;
    }
    if (segments[2] === 'map-brief') {
      const outcome = await handlers.mapBrief(parsed);
      sendJson(res, outcome.status, outcome.body);
      return;
    }
    sendJson(res, 404, { error: 'not_found', path: url.pathname });
    return;
  }

  // --- Resolution surface (Northstar RV-N3/RV-N5) ---------------------------
  if (endpoints.resolution && segments[0] === 'api' && segments[1] === 'resolution') {
    const handlers = endpoints.resolution;
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method_not_allowed', path: url.pathname });
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readBody(req));
    } catch {
      sendJson(res, 400, { error: 'invalid_json' });
      return;
    }
    if (segments[2] === 'initial-plan') {
      const outcome = await handlers.initialPlan(parsed);
      sendJson(res, outcome.status, outcome.body);
      return;
    }
    if (segments[2] === 'change-request') {
      const outcome = await handlers.changeRequest(parsed);
      sendJson(res, outcome.status, outcome.body);
      return;
    }
    sendJson(res, 404, { error: 'not_found', path: url.pathname });
    return;
  }

  // --- Demo control panel (dev-only) --------------------------------------
  if (req.method === 'GET' && url.pathname === '/demo') {
    if (!endpoints.demo) {
      sendJson(res, 404, { error: 'demo_not_available' });
      return;
    }
    const programmeEventId = seededProgrammeEventId(endpoints);
    const body = renderDemoPanel({
      adapterMode: config.adapterMode,
      plannerMode: endpoints.demo.plannerMode?.() ?? 'DETERMINISTIC_FALLBACK',
      scenarioNames: endpoints.demo.scenarioNames(),
      programmeEventId,
    });
    sendHtml(
      res,
      200,
      renderPage(
        { title: 'Demo controls', active: 'dashboard', links: PAGE_LINKS, ...demoBannerOptions(config, endpoints) },
        body,
      ),
    );
    return;
  }
  if (endpoints.demo && segments[0] === 'api' && segments[1] === 'demo') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method_not_allowed', path: url.pathname });
      return;
    }
    if (segments[2] === 'reset') {
      const outcome = await endpoints.demo.reset(endpoints.now());
      sendJson(res, outcome.status, outcome.body);
      return;
    }
    if (segments[2] === 'trigger') {
      const name = url.searchParams.get('name');
      if (!name) {
        sendJson(res, 400, { error: 'missing_name_param' });
        return;
      }
      const outcome = await endpoints.demo.triggerScenario(name, endpoints.now());
      sendJson(res, outcome.status, outcome.body);
      return;
    }
    sendJson(res, 404, { error: 'not_found', path: url.pathname });
    return;
  }

  sendJson(res, 404, { error: 'not_found', path: url.pathname });
}

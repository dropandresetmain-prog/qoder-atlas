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
import type { ProgrammeAugmentations } from '../ui/screens/operator-programme.ts';
import type { OperatorDashboardAugmentations } from '../ui/screens/operator-dashboard.ts';
import type { TravellerPresentation } from '../ui/traveller-presentation.ts';
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
import { renderDecisions } from '../ui/screens/operator-decisions.ts';
import { renderActivity } from '../ui/screens/operator-activity.ts';
import { renderTravellerTrip } from '../ui/screens/traveller.ts';
import { renderDemoPanel } from '../ui/screens/demo-panel.ts';
import {
  activityFromTripActivities,
  decisionsFromApprovalsQueue,
  decisionsFromDashboard,
  type ActivityPageView,
  type DecisionsPageView,
} from '../ui/operator-surfaces-view-model.ts';
import { SettleTracker, addClassToTagsContaining } from './settle.ts';

export interface HealthView {
  status: 'ok';
  environment: AppConfig['environment'];
  adapterMode: AppConfig['adapterMode'];
  time: string;
}

/**
 * Demo-only surface: reset, legacy scenario triggers, and final hero launches
 * for local/deployed clickaround. Never wired into domain logic.
 */
export interface DemoSurface {
  scenarioNames(): string[];
  /** Seeded programme event IDs for demo navigation links. */
  programmeEventIds?(): string[];
  /** Final hero workflow ids launchable from the demo panel. */
  heroWorkflows?(): Array<{ id: string; title: string; description: string }>;
  /** Full S1–S8 acceptance-manifest rehearsals for diagnosis. */
  scenarioRehearsals?(): Array<{ id: string; title: string; description: string; scenarioId: string }>;
  /** Which planner is active (for the demo banner display). */
  plannerMode?: () => 'MODEL_STUDIO' | 'DETERMINISTIC_FALLBACK';
  /** Plain runtime reset (diagnostic). */
  reset(at: IsoDateTime): Promise<{ status: number; body: unknown; redirectTo?: string }>;
  /**
   * R2 populated demo world: single reset + scenario prefixes → Overview entry state.
   */
  resetPopulatedWorld?(
    baseUrl: string,
  ): Promise<{ status: number; body: unknown; redirectTo?: string }>;
  triggerScenario(name: string, at: IsoDateTime): Promise<{ status: number; body: unknown }>;
  /**
   * Launch a final hero workflow through existing acceptance manifest steps
   * against the live server base URL. Stops before automated authority
   * settlement when the catalog declares stop-before step ids.
   */
  launchHero?(
    workflowId: string,
    at: IsoDateTime,
    baseUrl: string,
  ): Promise<{ status: number; body: unknown }>;
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
  reportMissedFlight(body: unknown): Promise<{ status: number; body: unknown }>;
  escalate(body: unknown): Promise<{ status: number; body: unknown }>;
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
 * DR-3 — provider-neutral flight-event ingress surface. The real,
 * credential-free natural-source boundary: a provider-shaped event posted
 * here is persisted, deduplicated, normalized (behind the provider adapter)
 * and fed into the ordinary recovery pipeline — never a demo shortcut.
 */
export interface EventIngestHandlers {
  atlasEvent(body: unknown, at: IsoDateTime): Promise<{ status: number; body: unknown }>;
}

/**
 * DR-5 — natural-language traveller entry point. Converges on the SAME
 * resolveChangeRequest engine the structured `/api/resolution/change-request`
 * route uses; both entry points coexist.
 */
export interface TravellerHandlers {
  changeRequest(body: unknown): Promise<{ status: number; body: unknown }>;
}

/**
 * DR-6 — event-change preview (no-mutate dry-run) + commit. Commit performs
 * the real change through the SAME processCommitmentChange fan-out the
 * legacy `/api/programme/commitment-change` route uses.
 */
export interface EventChangePreviewHandlers {
  preview(anchorEventId: string, body: unknown): Promise<{ status: number; body: unknown }>;
  compare(anchorEventId: string, body: unknown): Promise<{ status: number; body: unknown }>;
  commit(anchorEventId: string, body: unknown): Promise<{ status: number; body: unknown }>;
}

/**
 * DR-10 — programme roster/upload intake. Draft generation never mutates
 * state; promotion goes through the existing validated ProgrammeService path.
 */
export interface UploadIntakeHandlers {
  rosterParse(body: unknown): Promise<{ status: number; body: unknown }>;
  uploadDraft(body: unknown): Promise<{ status: number; body: unknown }>;
  uploadPromote(body: unknown): Promise<{ status: number; body: unknown }>;
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
  operatorDashboard(at: IsoDateTime, options?: { anchorEventId?: string }): Promise<OperatorDashboardView>;
  /** Optional persisted chain/role presentation for the served Overview. */
  operatorDashboardAugmentations?: (view: OperatorDashboardView) => Promise<OperatorDashboardAugmentations>;
  caseDetail(caseId: EntityId, at: IsoDateTime): Promise<CaseDetailView | undefined>;
  travellerTrip(tripId: EntityId, at: IsoDateTime): Promise<TravellerTripView | undefined>;
  /** Optional persisted concierge presentation for the served traveller page. */
  travellerPresentation?: (tripId: EntityId, at: IsoDateTime) => Promise<TravellerPresentation | undefined>;
  /** Optional R3A decisions page projection (richer than legacy queue mappers). */
  decisionsPage?: (at: IsoDateTime, options?: { anchorEventId?: EntityId }) => Promise<DecisionsPageView>;
  activityPage?: (at: IsoDateTime, options?: { anchorEventId?: EntityId }) => Promise<ActivityPageView>;
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
  /** Optional persisted AnchorEvent presentation for the served programme UI. */
  programmeAugmentations?: (view: ProgrammeView) => Promise<ProgrammeAugmentations>;
  /** Present when the Northstar resolution surface is wired. */
  resolution?: ResolutionHandlers;
  /** Present when the DR-3 flight-event ingress is wired. */
  events?: EventIngestHandlers;
  /** Present when the DR-5 natural-language traveller entry point is wired. */
  traveller?: TravellerHandlers;
  /** Present when the DR-6 event-change preview/commit surface is wired. */
  eventChangePreview?: EventChangePreviewHandlers;
  /** Present when the DR-10 roster/upload intake surface is wired. */
  upload?: UploadIntakeHandlers;
  /** Demo-only: scenario triggers for local clickaround. */
  demo?: DemoSurface;
}

function pageLinks(endpoints: AppEndpoints): { dashboard: string; programme?: string; decisions: string; activity: string; traveller: string } {
  const eventId = seededProgrammeEventId(endpoints);
  return {
    dashboard: eventId ? `/operator?event=${encodeURIComponent(eventId)}` : '/operator',
    ...(eventId ? { programme: `/programme?event=${encodeURIComponent(eventId)}` } : {}),
    decisions: '/decisions',
    activity: '/activity',
    traveller: '/traveller',
  };
}

/** Resolve explicit operator event scope from the query string only. */
function operatorEventScope(url: URL): string | undefined {
  return url.searchParams.get('event') ?? undefined;
}

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
  const settle = new SettleTracker();
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    void handle(config, endpoints, settle, req, res).catch((error) => {
      sendJson(res, 500, { error: 'internal', message: error instanceof Error ? error.message : String(error) });
    });
  });
}

async function handle(
  config: AppConfig,
  endpoints: AppEndpoints | undefined,
  settle: SettleTracker,
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
    // Human entry: land on the operations overview. API discovery lives at /api.
    const eventId = endpoints ? seededProgrammeEventId(endpoints) : undefined;
    const location = eventId
      ? `/operator?event=${encodeURIComponent(eventId)}`
      : '/operator';
    res.writeHead(302, { location });
    res.end();
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api') {
    sendJson(res, 200, {
      name: 'AI Trip Recovery / Resolution Layer',
      adapterMode: config.adapterMode,
      checkpoint: 'C candidate — generalized recovery + runtime disruption/reset flow',
      surfaces: endpoints
        ? [...['/operator', '/decisions', '/activity', '/traveller'], ...(endpoints.runtime ? ['/api/runtime/state'] : [])]
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
    const eventId = operatorEventScope(url);
    const view = await endpoints.operatorDashboard(
      endpoints.now(),
      eventId ? { anchorEventId: eventId } : undefined,
    );
    const augment = endpoints.operatorDashboardAugmentations
      ? await endpoints.operatorDashboardAugmentations(view)
      : undefined;
    let body = renderOperatorDashboardBody(view, augment);
    const surfaceKey = eventId ?? 'all';
    const statusByTrip = new Map(view.trips.map((trip) => [trip.tripId, trip.status]));
    const changedKeys = settle.diffAndRecord(new Map(
      view.trips.map((trip) => [`operator:${surfaceKey}:trip:${trip.tripId}`, trip.status]),
    ));
    for (const key of changedKeys) {
      const prefix = `operator:${surfaceKey}:trip:`;
      const tripId = key.startsWith(prefix) ? key.slice(prefix.length) : undefined;
      if (!tripId || !statusByTrip.has(tripId)) continue;
      body = addClassToTagsContaining(body, `data-fleet-trip="${tripId}"`, 'just-changed');
      body = addClassToTagsContaining(body, `data-trip-id="${tripId}"`, 'just-changed');
    }
    sendHtml(res, 200, renderPage({ title: 'Operations overview', active: 'dashboard', links: pageLinks(endpoints), ...demoBannerOptions(config, endpoints) }, body));
    return;
  }
  if (req.method === 'GET' && segments[0] === 'operator' && segments[1] === 'cases' && segments[2]) {
    const at = endpoints.now();
    const caseId = decodeURIComponent(segments[2]);
    const view = await endpoints.caseDetail(caseId, at);
    const body = view
      ? renderCaseDetailBody(view)
      : renderCaseDetail({ state: 'ERROR', errorMessage: `No recovery case ${caseId} is known`, generatedAt: at });
    sendHtml(res, view ? 200 : 404, renderPage({ title: 'Recovery case', active: 'case', links: pageLinks(endpoints), ...demoBannerOptions(config, endpoints) }, body));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/decisions') {
    const at = endpoints.now();
    const eventId = operatorEventScope(url);
    let view: DecisionsPageView;
    if (endpoints.decisionsPage) {
      view = await endpoints.decisionsPage(at, eventId ? { anchorEventId: eventId } : undefined);
    } else {
      const queue = endpoints.wave ? await endpoints.wave.approvalsQueue(at) : undefined;
      view = queue
        ? decisionsFromApprovalsQueue(queue)
        : decisionsFromDashboard(
            await endpoints.operatorDashboard(at, eventId ? { anchorEventId: eventId } : undefined),
          );
    }
    sendHtml(
      res,
      200,
      renderPage(
        { title: 'Decisions', active: 'decisions', links: pageLinks(endpoints), decisionCount: view.pending.length, ...demoBannerOptions(config, endpoints) },
        renderDecisions({ state: 'LOADED', data: view, generatedAt: at }),
      ),
    );
    return;
  }
  if (req.method === 'GET' && url.pathname === '/activity') {
    const at = endpoints.now();
    const eventId = operatorEventScope(url);
    let view: ActivityPageView;
    if (endpoints.activityPage) {
      view = await endpoints.activityPage(at, eventId ? { anchorEventId: eventId } : undefined);
    } else if (!endpoints.wave) {
      sendHtml(
        res,
        200,
        renderPage(
          { title: 'Activity', active: 'activity', links: pageLinks(endpoints), ...demoBannerOptions(config, endpoints) },
          renderActivity({ state: 'ERROR', errorMessage: 'Activity projection is unavailable.', generatedAt: at }),
        ),
      );
      return;
    } else {
      const dashboard = await endpoints.operatorDashboard(at);
      const activities = (await Promise.all(
        dashboard.trips.map((trip) => endpoints.wave!.tripActivity(trip.tripId, at)),
      )).filter((activity): activity is TripActivityView => activity !== undefined);
      view = activityFromTripActivities(at, activities);
    }
    sendHtml(
      res,
      200,
      renderPage(
        { title: 'Activity', active: 'activity', links: pageLinks(endpoints), ...demoBannerOptions(config, endpoints) },
        renderActivity({ state: 'LOADED', data: view, generatedAt: at }),
      ),
    );
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
    const programmeView = outcome.status === 200 ? outcome.body as ProgrammeView : undefined;
    const augment = programmeView && endpoints.programmeAugmentations
      ? await endpoints.programmeAugmentations(programmeView)
      : undefined;
    const body =
      programmeView
        ? renderProgramme({ state: 'LOADED', data: programmeView, generatedAt: at }, augment)
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
      renderPage({ title: 'Programme', active: 'programme', links: pageLinks(endpoints), ...demoBannerOptions(config, endpoints) }, body),
    );
    return;
  }

  // --- Traveller HTML surface -------------------------------------------
  if (req.method === 'GET' && url.pathname === '/traveller') {
    const at = endpoints.now();
    const tripId = url.searchParams.get('trip') ?? (await endpoints.firstTripId());
    const view = tripId ? await endpoints.travellerTrip(tripId, at) : undefined;
    const presentation = view && tripId && endpoints.travellerPresentation
      ? await endpoints.travellerPresentation(tripId, at)
      : undefined;
    let body = renderTravellerTrip(
      view ? { state: 'LOADED', data: view, generatedAt: at } : { state: 'ERROR', errorMessage: 'No trip is being managed yet', generatedAt: at },
      presentation,
    );
    if (view && tripId) {
      const changed = settle.diffAndRecord(new Map([[`traveller:${tripId}:status`, view.status]]));
      if (changed.length > 0) {
        body = addClassToTagsContaining(body, `data-status="${view.status}"`, 'just-changed');
      }
    }
    sendHtml(
      res,
      view ? 200 : 404,
      renderPage({ title: 'Your trip', active: 'traveller', surface: 'traveller', links: pageLinks(endpoints), ...demoBannerOptions(config, endpoints) }, body),
    );
    return;
  }

  // --- JSON read models ---------------------------------------------------
  if (req.method === 'GET' && url.pathname === '/api/operator/dashboard') {
    const eventId = operatorEventScope(url);
    sendJson(
      res,
      200,
      await endpoints.operatorDashboard(
        endpoints.now(),
        eventId ? { anchorEventId: eventId } : undefined,
      ),
    );
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

  // --- DR-5: natural-language traveller change-request entry point --------
  if (endpoints.traveller && segments[0] === 'api' && segments[1] === 'traveller' && segments[2] === 'change-request') {
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
    const outcome = await endpoints.traveller.changeRequest(parsed);
    sendJson(res, outcome.status, outcome.body);
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
        if (action === 'reset' && outcome.status === 200) settle.reset();
        sendJson(res, outcome.status, outcome.body);
        return;
      }
      case 'escalate': {
        const outcome = await handlers.escalate(parsed);
        sendJson(res, outcome.status, outcome.body);
        return;
      }
      case 'missed-flight': {
        const outcome = await handlers.reportMissedFlight(parsed);
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
    // DR-10: /api/programme/roster/parse, /api/programme/upload/draft|promote.
    if (endpoints.upload && segments[2] === 'roster' && segments[3] === 'parse') {
      const outcome = await endpoints.upload.rosterParse(parsed);
      sendJson(res, outcome.status, outcome.body);
      return;
    }
    if (endpoints.upload && segments[2] === 'upload' && segments[3] === 'draft') {
      const outcome = await endpoints.upload.uploadDraft(parsed);
      sendJson(res, outcome.status, outcome.body);
      return;
    }
    if (endpoints.upload && segments[2] === 'upload' && segments[3] === 'promote') {
      const outcome = await endpoints.upload.uploadPromote(parsed);
      sendJson(res, outcome.status, outcome.body);
      return;
    }

    // DR-6: /api/programme/:anchorEventId/change-preview|change-commit —
    // segments[2] here is the dynamic anchorEventId, not a fixed action.
    if (endpoints.eventChangePreview && segments[2] && segments[3] === 'change-preview') {
      const outcome = await endpoints.eventChangePreview.preview(segments[2], parsed);
      sendJson(res, outcome.status, outcome.body);
      return;
    }
    if (endpoints.eventChangePreview && segments[2] && segments[3] === 'change-preview-compare') {
      const outcome = await endpoints.eventChangePreview.compare(segments[2], parsed);
      sendJson(res, outcome.status, outcome.body);
      return;
    }
    if (endpoints.eventChangePreview && segments[2] && segments[3] === 'change-commit') {
      const outcome = await endpoints.eventChangePreview.commit(segments[2], parsed);
      sendJson(res, outcome.status, outcome.body);
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

  // --- Flight-event ingress (DR-3) — real natural-source boundary --------
  if (endpoints.events && segments[0] === 'api' && segments[1] === 'events') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method_not_allowed', path: url.pathname });
      return;
    }
    if (segments[2] === 'atlas') {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { error: 'invalid_json' });
        return;
      }
      const at = url.searchParams.get('at') ?? endpoints.now();
      const outcome = await endpoints.events.atlasEvent(parsed, at);
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
      scenarioRehearsals: endpoints.demo.scenarioRehearsals?.() ?? [],
      heroWorkflows: endpoints.demo.heroWorkflows?.() ?? [],
      programmeEventId,
    });
    sendHtml(
      res,
      200,
      renderPage(
        { title: 'Demo controls', active: 'dashboard', links: pageLinks(endpoints), ...demoBannerOptions(config, endpoints) },
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
      const redirect = url.searchParams.get('redirect') === '1';
      const proto = String(req.headers['x-forwarded-proto'] ?? 'http').split(',')[0]!.trim();
      const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? `127.0.0.1:${config.httpPort}`)
        .split(',')[0]!
        .trim();
      const baseUrl = `${proto}://${host}`;
      const outcome = endpoints.demo.resetPopulatedWorld
        ? await endpoints.demo.resetPopulatedWorld(baseUrl)
        : await endpoints.demo.reset(endpoints.now());
      if (redirect && outcome.redirectTo) {
        res.writeHead(303, { Location: outcome.redirectTo });
        res.end();
        return;
      }
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
    if (segments[2] === 'launch' && endpoints.demo.launchHero) {
      const workflowId = url.searchParams.get('workflow') ?? url.searchParams.get('id');
      if (!workflowId) {
        sendJson(res, 400, { error: 'missing_workflow_param' });
        return;
      }
      const proto = String(req.headers['x-forwarded-proto'] ?? 'http').split(',')[0]!.trim();
      const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? `127.0.0.1:${config.httpPort}`)
        .split(',')[0]!
        .trim();
      const baseUrl = `${proto}://${host}`;
      const outcome = await endpoints.demo.launchHero(workflowId, endpoints.now(), baseUrl);
      sendJson(res, outcome.status, outcome.body);
      return;
    }
    sendJson(res, 404, { error: 'not_found', path: url.pathname });
    return;
  }

  sendJson(res, 404, { error: 'not_found', path: url.pathname });
}

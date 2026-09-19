/**
 * Target PostgreSQL HTTP handlers for M9 product read models and commands.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { ExpectedRevisionSchema } from '../../domain/v2/shared/identity.ts';
import { escapeHtml } from '../../ui/html.ts';
import { stageProgrammeTimeSwap } from './programmeTimeSwapStaging.ts';
import { approveRecoveryStrategy, externalExecutionBlockerForStrategyId } from './recoveryApproval.ts';
import { resolveRequestPrincipal, workspacePrincipalId } from './workspaceAuthority.ts';
import type { TargetApplication } from './composeTargetApplication.ts';
import {
  loadIncidentProgrammeFacts,
  loadOperatorOverviewFacts,
  loadRecoveryCaseFacts,
  loadTravellerTripFacts,
} from './readmodels/pgFactAssembler.ts';
import {
  projectIncidentProgramme,
  projectOperatorOverview,
  projectRecoveryCase,
  projectTravellerTrip,
} from './readmodels/index.ts';
import {
  acceptProviderShapedDemoEvent,
  commandEvaluateResolution,
  commandOpenRecoveryCase,
  commandPreviewAuthoritativeBilateralProgrammeTimeSwap,
  commandResolveCase,
  type ProviderShapedDemoEvent,
  type TargetCommandContext,
  type TransportScheduleObservedEvent,
} from './applicationCommands.ts';
import { acceptProviderDisruptionDemoEvent } from './providerDisruptionIngress.ts';
import type { TransportServiceCancelledWithReprotectionEvent } from './applicationCommands.ts';
import { disruptionEventFileFromEnv, loadDisclosedDisruptionEvent } from '../demo/providerDisruptionEventSource.ts';
import { seedDemoWorld } from './demoSeed.ts';
import { importProgrammeBundle, ProgrammeImportBundleSchema } from './programmeImport.ts';
import { ActivityCursorError, loadActivityFeed, loadDecisionQueue, loadProgrammeSchedule } from './readmodels/pgShellFacts.ts';
import { OVERVIEW_BACK, renderInShell, type ShellContext } from './productShell.ts';
import { loadShellChrome } from './readmodels/pgShellChrome.ts';
import { demoResetGate, resetDemoWorkspace } from '../demo/demoReset.ts';
import { datasetDirectoryFromEnv } from '../demo/datasetLoader.ts';
import { renderProductOperatorOverview } from '../../ui/screens/product-operator-overview.ts';
import { renderProductProgrammeSchedule } from '../../ui/screens/product-programme-schedule.ts';
import { renderProductDecisionQueue } from '../../ui/screens/product-decision-queue.ts';
import { renderProductActivityFeed } from '../../ui/screens/product-activity-feed.ts';
import { renderProductRecoveryCase } from '../../ui/screens/product-recovery-case.ts';
import { renderProductProgrammePreview } from '../../ui/screens/product-programme-preview.ts';
import { toLegacyRenderableShape } from './programmeTimeSwapPreview.ts';
import { renderProductIncidentProgramme } from '../../ui/screens/product-incident-programme.ts';
import { renderProductTravellerTrip } from '../../ui/screens/product-traveller-trip.ts';
import type { OperatorOverview } from '../../contracts/v2/product/readModels.ts';
import type { TypedRef } from '../../domain/v2/shared/identity.ts';

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

/**
 * Distinguishes "no body at all" (zero bytes — e.g. the founder trigger's
 * bodyless POST) from "a body that failed to parse as JSON". A non-empty
 * body that isn't JSON is a malformed direct delivery and must surface as a
 * validation failure, never silently fall back to file-driven behavior.
 */
async function readJsonOrMalformed(req: IncomingMessage): Promise<{ kind: 'empty' } | { kind: 'json'; body: unknown } | { kind: 'malformed'; message: string }> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (chunks.length === 0) return { kind: 'empty' };
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return { kind: 'json', body: JSON.parse(text) as unknown };
  } catch (error) {
    return { kind: 'malformed', message: error instanceof Error ? error.message : String(error) };
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(payload);
}

/**
 * Defect-1: `?sinceCursor=<xid8>` opts a GET into the "changed since"
 * comparison (see loadRecoveryCaseFacts/loadOperatorOverviewFacts) —
 * replaces the old `sinceRevision` numeric-revision query param, which
 * compared a transaction-start-ordered stamp with `>` and could permanently
 * miss a change committed out of xid order (see
 * docs/work/ACTIVE_TASK.md). Carried as an opaque string (never parsed as a
 * JS number) so the underlying 64-bit xid8 cursor is never truncated.
 * Omitted or empty is treated as a first read, never as "since cursor 0" — a
 * caller that doesn't echo back a real prior `changeCursor` gets an honestly
 * empty changed set, not a synthetic "everything changed".
 */
function parseSinceCursor(url: URL): string | undefined {
  const raw = url.searchParams.get('sinceCursor');
  return raw !== null && raw.length > 0 ? raw : undefined;
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(html);
}

function commandCtx(app: TargetApplication): TargetCommandContext {
  return {
    workspaceId: app.workspaceId,
    actorPrincipalId: `m9-http:${app.workspaceId}`,
    uow: () => app.unitOfWork(),
    pool: app.pool,
  };
}

export interface TargetHttpContext {
  app: TargetApplication;
}

/**
 * Shell chrome values taken from the overview read model. `eventName` is
 * present only when the backend identified one event for this workspace, so
 * the event select is either true or absent.
 */
function shellContext(view: OperatorOverview): ShellContext {
  return {
    ...(view.eventContext ? { eventName: view.eventContext.title } : {}),
    decisionCount: view.items.filter((item) => item.decisionRequired).length,
    ...resetChrome(),
  };
}

/** The persistent Reset demo control renders only where the reset gate is open. */
function resetChrome(): { resetDemo?: true } {
  return demoResetGate(process.env).open ? { resetDemo: true } : {};
}

/** Event name + decision count + reset gate for pages whose read model lacks them. */
async function pageChrome(ctx: TargetHttpContext): Promise<ShellContext> {
  return { ...(await loadShellChrome(ctx.app.pool, ctx.app.workspaceId)), ...resetChrome() };
}

/**
 * Serve one focused case. Used by BOTH the API route and the clean product
 * route `/operator/cases/:id`, so the case renders in place inside the shell
 * (no redirect to an API URL).
 */
async function serveCase(ctx: TargetHttpContext, res: ServerResponse, url: URL, caseId: string, html: boolean): Promise<void> {
  const sinceCursor = parseSinceCursor(url);
  const facts = await loadRecoveryCaseFacts(ctx.app.pool, ctx.app.workspaceId, caseId, undefined, sinceCursor);
  if (!facts) {
    if (html) sendHtml(res, 404, renderInShell('case', 'Case not found', { ...(await pageChrome(ctx)), backLink: OVERVIEW_BACK }, '<main class="shell" data-test="case-not-found"><div class="page-head"><h1>Case not found</h1></div><p class="meta">This case does not exist in this workspace.</p></main>'));
    else sendJson(res, 404, { error: 'CASE_NOT_FOUND' });
    return;
  }
  const projected = projectRecoveryCase(facts);
  // R4-F2 truthfulness: a viable option this runtime cannot actually execute carries an explicit blocker.
  const view = {
    ...projected,
    strategies: await Promise.all(projected.strategies.map(async (strategy) => {
      if (strategy.viability !== 'VIABLE') return strategy;
      const blocker = await externalExecutionBlockerForStrategyId(ctx.app.pool, ctx.app.workspaceId, strategy.strategyRef, ctx.app.runtimeHooks?.externalCapabilities);
      return blocker ? { ...strategy, executionBlocker: blocker } : strategy;
    })),
  };
  if (html) {
    // The shell carries the event name, open-decision count and Reset demo on
    // the Case page too; the Back link itself is rendered by the case screen
    // (renderBackLink) inside its page head.
    sendHtml(res, 200, renderInShell('case', 'Recovery case', await pageChrome(ctx), renderProductRecoveryCase(view)));
  } else {
    sendJson(res, 200, view);
  }
}

/**
 * Handle `/api/v2/*` product routes. Returns true when handled.
 */
export async function handleTargetProductHttp(
  ctx: TargetHttpContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const { pathname } = url;

  // Clean product route for one focused case: served IN PLACE (no redirect to
  // an /api/v2 URL), inside the shell.
  const cleanCase = pathname.match(/^\/operator\/cases\/([^/]+)$/);
  if (req.method === 'GET' && cleanCase) {
    try {
      await serveCase(ctx, res, url, decodeURIComponent(cleanCase[1]!), true);
    } catch (err) {
      sendJson(res, 500, { error: 'TARGET_HTTP_FAILURE', message: err instanceof Error ? err.message : 'unknown' });
    }
    return true;
  }

  if (!pathname.startsWith('/api/v2/')) return false;

  try {
    if (req.method === 'GET' && pathname === '/api/v2/health') {
      sendJson(res, 200, {
        kind: ctx.app.kind,
        workspaceId: ctx.app.workspaceId,
        sqliteAuthoritativeFallback: ctx.app.sqliteAuthoritativeFallback,
        // R0: what is actually running, from the one runtime-services root.
        runtimeServices: ctx.app.runtimeServices?.health() ?? [],
      });
      return true;
    }

    if (req.method === 'GET' && pathname === '/api/v2/operator/overview') {
      const sinceCursor = parseSinceCursor(url);
      const facts = await loadOperatorOverviewFacts(ctx.app.pool, ctx.app.workspaceId, undefined, sinceCursor);
      const view = projectOperatorOverview(facts);
      if (url.searchParams.get('format') === 'html') {
        // The shell's own chrome, not a second one: brand, event context and
        // the nav the operator navigates with. The decision count is the
        // read model's own `decisionRequired` total.
        sendHtml(
          res,
          200,
          renderInShell('dashboard', 'Operations overview', shellContext(view), renderProductOperatorOverview(view)),
        );
      } else {
        sendJson(res, 200, view);
      }
      return true;
    }

    if (req.method === 'GET' && pathname === '/api/v2/operator/programme') {
      const view = await loadProgrammeSchedule(ctx.app.pool, ctx.app.workspaceId);
      if (url.searchParams.get('format') === 'html') {
        sendHtml(
          res,
          200,
          renderInShell('programme', 'Programme', { eventName: view.eventTitle, ...(await pageChrome(ctx)) }, renderProductProgrammeSchedule(view)),
        );
      } else {
        sendJson(res, 200, view);
      }
      return true;
    }

    if (req.method === 'GET' && pathname === '/api/v2/operator/decisions') {
      const view = await loadDecisionQueue(ctx.app.pool, ctx.app.workspaceId);
      if (url.searchParams.get('format') === 'html') {
        const decisionCount = view.decisions.filter((decision) => decision.awaitingAuthority).length;
        sendHtml(res, 200, renderInShell('decisions', 'Decisions', { ...(await pageChrome(ctx)), decisionCount }, renderProductDecisionQueue(view)));
      } else {
        sendJson(res, 200, view);
      }
      return true;
    }

    if (req.method === 'GET' && pathname === '/api/v2/operator/activity') {
      let view;
      try {
        view = await loadActivityFeed(ctx.app.pool, ctx.app.workspaceId, url.searchParams.get('before') ?? undefined);
      } catch (error) {
        if (!(error instanceof ActivityCursorError)) throw error;
        if (url.searchParams.get('format') === 'html') {
          sendHtml(res, 400, renderInShell('activity', 'Activity', await pageChrome(ctx),
            '<main class="shell"><h1>This activity page is unavailable</h1><p>The link may be invalid or the demo may have been reset.</p><a href="/api/v2/operator/activity?format=html">Open latest activity</a></main>'));
        } else {
          sendJson(res, 400, { error: 'INVALID_ACTIVITY_CURSOR', message: error.message });
        }
        return true;
      }
      if (url.searchParams.get('format') === 'html') {
        sendHtml(res, 200, renderInShell('activity', 'Activity', await pageChrome(ctx), renderProductActivityFeed(view)));
      } else {
        sendJson(res, 200, view);
      }
      return true;
    }

    const caseMatch = pathname.match(/^\/api\/v2\/cases\/([^/]+)$/);
    if (req.method === 'GET' && caseMatch) {
      await serveCase(ctx, res, url, decodeURIComponent(caseMatch[1]!), url.searchParams.get('format') === 'html');
      return true;
    }

    const incidentMatch = pathname.match(/^\/api\/v2\/incidents\/([^/]+)\/programme$/);
    if (req.method === 'GET' && incidentMatch) {
      const caseId = decodeURIComponent(incidentMatch[1]!);
      const facts = await loadIncidentProgrammeFacts(ctx.app.pool, ctx.app.workspaceId, caseId);
      if (!facts) {
        sendJson(res, 404, { error: 'INCIDENT_NOT_FOUND' });
        return true;
      }
      const view = projectIncidentProgramme(facts);
      if (url.searchParams.get('format') === 'html') {
        sendHtml(res, 200, renderInShell('case', 'Programme impact', { ...(await pageChrome(ctx)), backLink: OVERVIEW_BACK }, renderProductIncidentProgramme(view, { caseRef: caseId })));
      } else {
        sendJson(res, 200, view);
      }
      return true;
    }

    const travellerMatch = pathname.match(/^\/api\/v2\/travellers\/journeys\/([^/]+)$/);
    if (req.method === 'GET' && travellerMatch) {
      const journeyId = decodeURIComponent(travellerMatch[1]!);
      const facts = await loadTravellerTripFacts(ctx.app.pool, ctx.app.workspaceId, journeyId);
      if (!facts) {
        sendJson(res, 404, { error: 'JOURNEY_NOT_FOUND' });
        return true;
      }
      const view = projectTravellerTrip(facts);
      if (url.searchParams.get('format') === 'html') {
        const chrome = await pageChrome(ctx);
        sendHtml(res, 200, renderInShell('traveller', 'Your trip', { ...chrome, backLink: OVERVIEW_BACK }, renderProductTravellerTrip(view, chrome.eventName)));
      } else {
        sendJson(res, 200, view);
      }
      return true;
    }

    if (req.method === 'POST' && pathname === '/api/v2/programme/time-swap/preview') {
      // Caller identifies the proposed change only (which two programme items
      // to swap); it may NOT supply evaluation/viability logic — the server
      // loads authoritative state and invokes the real evaluator itself (M9 1B).
      const body = (await readJson(req)) as {
        itemARef?: unknown; itemBRef?: unknown; recoveryCaseId?: unknown; now?: unknown;
      };
      if (typeof body.itemARef !== 'string' || typeof body.itemBRef !== 'string') {
        sendJson(res, 400, { error: 'VALIDATION_FAILED', message: 'itemARef and itemBRef (programme item ids) are required' });
        return true;
      }
      const outcome = await commandPreviewAuthoritativeBilateralProgrammeTimeSwap(commandCtx(ctx.app), {
        itemARef: body.itemARef,
        itemBRef: body.itemBRef,
        now: typeof body.now === 'string' ? body.now : new Date().toISOString(),
        ...(typeof body.recoveryCaseId === 'string' ? { recoveryCaseId: body.recoveryCaseId } : {}),
      });
      if (!outcome.ok) {
        sendJson(res, 422, { error: 'PREVIEW_FAILED', message: outcome.error });
        return true;
      }
      if (url.searchParams.get('format') === 'html') {
        const stageInput = {
          recoveryCaseId: body.recoveryCaseId, itemARef: body.itemARef, itemBRef: body.itemBRef,
          expectedProgrammeRevisions: outcome.result.expectedProgrammeRevisions,
        };
        const stageControl = outcome.result.previewAccepted && outcome.result.strategyViability === 'VIABLE'
          && typeof body.recoveryCaseId === 'string'
          ? `<div class="btn-row"><button type="button" class="btn btn-primary" data-programme-time-swap-stage="${escapeHtml(JSON.stringify(stageInput))}">Continue to approval</button></div>`
          : '';
        sendHtml(res, 200, renderProductProgrammePreview(toLegacyRenderableShape(outcome.result)) + stageControl);
      } else {
        sendJson(res, 200, outcome.result);
      }
      return true;
    }

    if (req.method === 'POST' && pathname === '/api/v2/cases') {
      const body = (await readJson(req)) as { openedAt?: string; caseId?: string; idempotencyKey?: string };
      const openedAt = body.openedAt ?? new Date().toISOString();
      const outcome = await commandOpenRecoveryCase(commandCtx(ctx.app), {
        openedAt,
        ...(body.caseId ? { caseId: body.caseId } : {}),
        ...(body.idempotencyKey ? { idempotencyKey: body.idempotencyKey } : {}),
      });
      sendJson(res, outcome.ok ? 200 : 409, outcome);
      return true;
    }

    // R3: proposal -> generalized coordinator (the SAME instance the C4
    // progression pass owns). The handler only requests planning: it chooses
    // no domains, dispatches no tools, evaluates no viability and persists no
    // strategies itself. Outcome mapping: CASE_NOT_FOUND -> 404; terminal /
    // persistence conflicts -> 409; an honest planning outcome reached despite
    // provider-research failure is 200 — the failure is visible evidence in
    // the attempt, not a server error. Idempotency is inherited from the
    // coordinator's deterministic per-(case, basis, candidate) identity.
    const strategiesMatch = pathname.match(/^\/api\/v2\/cases\/([^/]+)\/strategies$/);
    if (req.method === 'POST' && strategiesMatch) {
      const caseId = decodeURIComponent(strategiesMatch[1]!);
      const planner = ctx.app.runtimeHooks?.planner;
      if (!planner) {
        sendJson(res, 503, { ok: false, error: { code: 'PLANNER_NOT_COMPOSED', message: 'planning coordinator is not composed in this runtime', mutatesState: false } });
        return true;
      }
      const outcome = await planner.planCaseDetailed({ recoveryCaseId: caseId as never, reason: 'OPERATOR_REQUEST' });
      if (!outcome.ok) {
        const status = outcome.error.code === 'CASE_NOT_FOUND' ? 404 : 409;
        sendJson(res, status, { ok: false, error: outcome.error });
        return true;
      }
      sendJson(res, 200, { ok: true, result: outcome.result });
      return true;
    }

    // B1: persisted strategy -> plan -> authority decision -> approval by a
    // real principal (header `x-northstar-principal`, else the workspace
    // operator) -> execution pass runs now.
    const approveMatch = pathname.match(/^\/api\/v2\/cases\/([^/]+)\/strategies\/([^/]+)\/approve$/);
    if (req.method === 'POST' && approveMatch) {
      const caseId = decodeURIComponent(approveMatch[1]!);
      const strategyId = decodeURIComponent(approveMatch[2]!);
      const body = (await readJson(req)) as { now?: string } | null;
      const header = req.headers['x-northstar-principal'];
      const principal = await resolveRequestPrincipal(ctx.app.pool, ctx.app.workspaceId, Array.isArray(header) ? header[0] : header);
      if (!principal.ok) {
        sendJson(res, 403, { ok: false, error: { code: 'PRINCIPAL_UNRESOLVED', message: principal.reason, mutatesState: false } });
        return true;
      }
      const executorPrincipalId = ctx.app.runtimeHooks?.executorPrincipalId ?? workspacePrincipalId(ctx.app.workspaceId, 'executor');
      const outcome = await approveRecoveryStrategy(
        { pool: ctx.app.pool, workspaceId: ctx.app.workspaceId, actorPrincipalId: commandCtx(ctx.app).actorPrincipalId, uow: () => ctx.app.unitOfWork(), executorPrincipalId, ...(ctx.app.runtimeHooks?.externalCapabilities ? { externalCapabilities: ctx.app.runtimeHooks.externalCapabilities } : {}), ...(body?.now ? { now: body.now } : {}) },
        { caseId, strategyId, approverPrincipalId: principal.principalId },
      );
      if (outcome.ok) {
        // Execute now rather than on the next idle poll; the pass is idempotent.
        await ctx.app.runtimeHooks?.afterApproval?.();
      }
      const status = outcome.ok ? 200
        : outcome.error.code === 'CASE_NOT_FOUND' || outcome.error.code === 'STRATEGY_NOT_FOUND' ? 404
        : outcome.error.code === 'APPROVER_UNAUTHORIZED' || outcome.error.code === 'DISPATCHER_UNAUTHORIZED' ? 403
        : 409;
      sendJson(res, status, { ...outcome, principal: { id: principal.principalId, source: principal.source } });
      return true;
    }

    const evaluateMatch = pathname.match(/^\/api\/v2\/cases\/([^/]+)\/evaluate-resolution$/);
    if (req.method === 'POST' && evaluateMatch) {
      const caseId = decodeURIComponent(evaluateMatch[1]!);
      const body = (await readJson(req)) as { now?: string; requiredAffectedPeople?: TypedRef[] };
      const evaluation = await commandEvaluateResolution(commandCtx(ctx.app), {
        recoveryCaseId: caseId,
        now: body.now ?? new Date().toISOString(),
        ...(body.requiredAffectedPeople ? { requiredAffectedPeople: body.requiredAffectedPeople } : {}),
      });
      sendJson(res, 200, evaluation);
      return true;
    }

    const resolveMatch = pathname.match(/^\/api\/v2\/cases\/([^/]+)\/resolve$/);
    if (req.method === 'POST' && resolveMatch) {
      const caseId = decodeURIComponent(resolveMatch[1]!);
      const body = (await readJson(req)) as {
        now?: string;
        requiredAffectedPeople?: TypedRef[];
        idempotencyKey?: string;
      };
      const outcome = await commandResolveCase(commandCtx(ctx.app), {
        recoveryCaseId: caseId,
        now: body.now ?? new Date().toISOString(),
        ...(body.requiredAffectedPeople ? { requiredAffectedPeople: body.requiredAffectedPeople } : {}),
        ...(body.idempotencyKey ? { idempotencyKey: body.idempotencyKey } : {}),
      });
      sendJson(res, outcome.ok ? 200 : 409, outcome);
      return true;
    }

    if (req.method === 'POST' && pathname === '/api/v2/demo/provider-event') {
      const body = (await readJson(req)) as ProviderShapedDemoEvent;
      // Discriminate on kind field; absent kind = existing TRANSPORT_SCHEDULE_OBSERVED behavior
      if (body.kind === 'TRANSPORT_SERVICE_CANCELLED_WITH_REPROTECTION') {
        // This event type should go to the dedicated route
        sendJson(res, 400, { error: 'VALIDATION_FAILED', message: 'airline rebooking events must use /api/v2/demo/provider-event/airline-rebooking' });
        return true;
      }
      // After the kind check, body is a TransportScheduleObservedEvent
      const result = await acceptProviderShapedDemoEvent(commandCtx(ctx.app), body as TransportScheduleObservedEvent);
      sendJson(res, result.ok ? 202 : 400, result);
      return true;
    }

    if (req.method === 'POST' && pathname === '/api/v2/demo/provider-event/airline-rebooking') {
      // Two truthful delivery modes for the same provider-event boundary:
      //   • zero body bytes — the founder trigger; applies the
      //     organiser-disclosed input file configured for this runtime;
      //   • a JSON body — a direct provider event delivery. It must carry the
      //     disclosed event kind; anything else (malformed JSON, a different
      //     event kind, a schema-invalid event) is a 400 VALIDATION_FAILED
      //     with no mutation. A non-empty body never falls back to the file.
      const read = await readJsonOrMalformed(req);
      let event: TransportServiceCancelledWithReprotectionEvent;
      if (read.kind === 'empty') {
        const eventFile = disruptionEventFileFromEnv();
        if (eventFile === undefined) {
          sendJson(res, 400, { code: 'VALIDATION_FAILED', message: 'no disclosed simulated airline event is configured on this runtime' });
          return true;
        }
        event = await loadDisclosedDisruptionEvent(eventFile);
      } else if (read.kind === 'malformed') {
        sendJson(res, 400, { code: 'VALIDATION_FAILED', message: `request body is not valid JSON: ${read.message}` });
        return true;
      } else if (
        typeof read.body === 'object' && read.body !== null
        && (read.body as { kind?: unknown }).kind === 'TRANSPORT_SERVICE_CANCELLED_WITH_REPROTECTION'
      ) {
        event = read.body as TransportServiceCancelledWithReprotectionEvent;
      } else {
        sendJson(res, 400, { code: 'VALIDATION_FAILED', message: 'direct provider event delivery requires kind TRANSPORT_SERVICE_CANCELLED_WITH_REPROTECTION' });
        return true;
      }
      const result = await acceptProviderDisruptionDemoEvent(commandCtx(ctx.app), event);
      if (!result.ok) {
        const status = result.error.code === 'PROVIDER_INFO_UNAVAILABLE' ? 404 : 409;
        sendJson(res, status, result.error);
        return true;
      }
      sendJson(res, 202, result);
      return true;
    }

    if (req.method === 'POST' && pathname === '/api/v2/programme/import/preview') {
      const read = await readJsonOrMalformed(req);
      if (read.kind !== 'json') {
        sendJson(res, 400, { error: 'INVALID_PROGRAMME', message: 'Provide a programme to review.' });
        return true;
      }
      const parsed = ProgrammeImportBundleSchema.safeParse(read.body);
      if (!parsed.success) {
        sendJson(res, 400, {
          error: 'INVALID_PROGRAMME', message: 'Check the programme details before importing.',
          issues: parsed.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
        });
        return true;
      }
      // Review validates the same bundle as import and writes no canonical state.
      sendJson(res, 200, {
        bundle: parsed.data,
        summary: { sessions: parsed.data.items.length, travellers: parsed.data.travellers.length },
        mutatesAuthoritativeState: false,
      });
      return true;
    }

    if (req.method === 'POST' && pathname === '/api/v2/programme/time-swap/stage') {
      const parsed = z.strictObject({
        recoveryCaseId: z.string().uuid(), itemARef: z.string().uuid(), itemBRef: z.string().uuid(),
        expectedProgrammeRevisions: z.array(ExpectedRevisionSchema).min(1).max(2),
      }).safeParse(await readJson(req));
      if (!parsed.success) {
        sendJson(res, 400, { error: 'VALIDATION_FAILED', message: 'Review the session times and choose the recovery case first.' });
        return true;
      }
      const header = req.headers['x-northstar-principal'];
      const principal = await resolveRequestPrincipal(ctx.app.pool, ctx.app.workspaceId, Array.isArray(header) ? header[0] : header);
      if (!principal.ok) {
        sendJson(res, 403, { error: 'PRINCIPAL_UNRESOLVED', message: 'An active operator is required to prepare this change.' });
        return true;
      }
      const staged = await stageProgrammeTimeSwap({ pool: ctx.app.pool, uow: () => ctx.app.unitOfWork() }, {
        ...parsed.data, workspaceId: ctx.app.workspaceId, actorPrincipalId: principal.principalId, now: new Date().toISOString(),
      });
      sendJson(res, staged.ok ? 200 : 409, staged.ok ? {
        ...staged.value, caseHref: `/operator/cases/${encodeURIComponent(staged.value.recoveryCaseId)}`,
        requiresApproval: true, mutatesProgrammeState: false,
      } : { error: staged.error, message: 'The programme or recovery case changed, or this swap is no longer viable. Review a fresh preview.' });
      return true;
    }

    if (req.method === 'POST' && pathname === '/api/v2/programme/import') {
      try {
        const body = await readJson(req);
        const result = await importProgrammeBundle(ctx.app.pool, ctx.app.workspaceId, commandCtx(ctx.app).actorPrincipalId, body);
        sendJson(res, 200, result);
      } catch (error) {
        sendJson(res, 400, { error: 'PROGRAMME_IMPORT_FAILED', message: error instanceof Error ? error.message : String(error) });
      }
      return true;
    }

    if (req.method === 'POST' && pathname === '/api/v2/demo/reset') {
      // A runtime with a demo dataset gets the SAFE workspace-scoped reset
      // (src/app/demo/demoReset.ts): one locked transaction deleting only the
      // configured demo workspace's rows, then deterministic re-provisioning of
      // the healthy baseline. It is refused unless the demo/dev gate is open.
      // A runtime with NO dataset keeps the small placeholder-world seeder.
      if (datasetDirectoryFromEnv() !== undefined) {
        const gate = demoResetGate(process.env);
        if (!gate.open) {
          sendJson(res, 403, { error: gate.code, message: gate.message });
          return true;
        }
        const outcome = await resetDemoWorkspace({
          pool: ctx.app.pool,
          uow: () => ctx.app.unitOfWork(),
          workspaceId: ctx.app.workspaceId,
        });
        if (outcome.status === 'RESET') {
          sendJson(res, 200, {
            ok: true,
            workspaceId: outcome.workspaceId,
            deletedRows: outcome.deletedRows,
            tableCount: outcome.tables.length,
            provisioning: outcome.provisioning,
            baselineEvaluated: outcome.baselineEvaluated,
            timingsMs: outcome.timingsMs,
          });
        } else if (outcome.status === 'IN_PROGRESS') {
          sendJson(res, 409, { error: outcome.code, message: outcome.message });
        } else if (outcome.status === 'UNSUPPORTED') {
          sendJson(res, 409, { error: outcome.code, message: outcome.message });
        } else {
          sendJson(res, 403, { error: outcome.code, message: outcome.message });
        }
        return true;
      }
      try {
        const result = await seedDemoWorld(ctx.app.pool, ctx.app.workspaceId, commandCtx(ctx.app).actorPrincipalId);
        sendJson(res, 200, result);
      } catch (error) {
        sendJson(res, 500, { error: 'DEMO_SEED_FAILED', message: error instanceof Error ? error.message : String(error) });
      }
      return true;
    }

    sendJson(res, 404, { error: 'NOT_FOUND' });
    return true;
  } catch (err) {
    sendJson(res, 500, {
      error: 'TARGET_HTTP_FAILURE',
      message: err instanceof Error ? err.message : 'unknown',
    });
    return true;
  }
}

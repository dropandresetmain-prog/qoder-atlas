/**
 * Target PostgreSQL HTTP handlers for M9 product read models and commands.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
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
} from './applicationCommands.ts';
import { seedDemoWorld } from './demoSeed.ts';
import { importProgrammeBundle } from './programmeImport.ts';
import { renderProductOperatorOverview } from '../../ui/screens/product-operator-overview.ts';
import { renderProductRecoveryCase } from '../../ui/screens/product-recovery-case.ts';
import { renderProductProgrammePreview } from '../../ui/screens/product-programme-preview.ts';
import { toLegacyRenderableShape } from './programmeTimeSwapPreview.ts';
import { renderProductIncidentProgramme } from '../../ui/screens/product-incident-programme.ts';
import { renderProductTravellerTrip } from '../../ui/screens/product-traveller-trip.ts';
import type { TypedRef } from '../../domain/v2/shared/identity.ts';

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(payload);
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
 * Handle `/api/v2/*` product routes. Returns true when handled.
 */
export async function handleTargetProductHttp(
  ctx: TargetHttpContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const { pathname } = url;
  if (!pathname.startsWith('/api/v2/')) return false;

  try {
    if (req.method === 'GET' && pathname === '/api/v2/health') {
      sendJson(res, 200, {
        kind: ctx.app.kind,
        workspaceId: ctx.app.workspaceId,
        sqliteAuthoritativeFallback: ctx.app.sqliteAuthoritativeFallback,
      });
      return true;
    }

    if (req.method === 'GET' && pathname === '/api/v2/operator/overview') {
      const facts = await loadOperatorOverviewFacts(ctx.app.pool, ctx.app.workspaceId);
      const view = projectOperatorOverview(facts);
      if (url.searchParams.get('format') === 'html') {
        sendHtml(res, 200, renderProductOperatorOverview(view));
      } else {
        sendJson(res, 200, view);
      }
      return true;
    }

    const caseMatch = pathname.match(/^\/api\/v2\/cases\/([^/]+)$/);
    if (req.method === 'GET' && caseMatch) {
      const caseId = decodeURIComponent(caseMatch[1]!);
      const facts = await loadRecoveryCaseFacts(ctx.app.pool, ctx.app.workspaceId, caseId);
      if (!facts) {
        sendJson(res, 404, { error: 'CASE_NOT_FOUND' });
        return true;
      }
      const view = projectRecoveryCase(facts);
      if (url.searchParams.get('format') === 'html') {
        sendHtml(res, 200, renderProductRecoveryCase(view));
      } else {
        sendJson(res, 200, view);
      }
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
        sendHtml(res, 200, renderProductIncidentProgramme(view));
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
        sendHtml(res, 200, renderProductTravellerTrip(view));
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
        sendHtml(res, 200, renderProductProgrammePreview(toLegacyRenderableShape(outcome.result)));
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
      const result = await acceptProviderShapedDemoEvent(commandCtx(ctx.app), body);
      sendJson(res, result.ok ? 202 : 400, result);
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

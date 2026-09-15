/**
 * Target PostgreSQL HTTP handlers for M9 product read models and commands.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { TargetApplication } from './composeTargetApplication.ts';
import {
  loadOperatorOverviewFacts,
  loadRecoveryCaseFacts,
} from './readmodels/pgFactAssembler.ts';
import {
  projectOperatorOverview,
  projectRecoveryCase,
} from './readmodels/index.ts';
import { commandPreviewBilateralProgrammeTimeSwap } from './applicationCommands.ts';
import type { BilateralProgrammeTimeSwapInput } from './programmeTimeSwapPreview.ts';
import { renderProductOperatorOverview } from '../../ui/screens/product-operator-overview.ts';
import { renderProductRecoveryCase } from '../../ui/screens/product-recovery-case.ts';
import { renderProductProgrammePreview } from '../../ui/screens/product-programme-preview.ts';

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

    if (req.method === 'POST' && pathname === '/api/v2/programme/time-swap/preview') {
      const body = (await readJson(req)) as BilateralProgrammeTimeSwapInput;
      const preview = commandPreviewBilateralProgrammeTimeSwap(body);
      if (url.searchParams.get('format') === 'html') {
        sendHtml(res, 200, renderProductProgrammePreview(preview));
      } else {
        sendJson(res, 200, preview);
      }
      return true;
    }

    if (req.method === 'GET' && pathname === '/api/v2/health') {
      sendJson(res, 200, {
        kind: ctx.app.kind,
        workspaceId: ctx.app.workspaceId,
        sqliteAuthoritativeFallback: ctx.app.sqliteAuthoritativeFallback,
      });
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

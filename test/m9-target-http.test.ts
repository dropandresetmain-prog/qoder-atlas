/**
 * Focused coverage for M9 `/api/v2` route dispatch (no live Postgres required).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleTargetProductHttp } from '../src/app/target/targetHttpHandlers.ts';
import type { TargetApplication } from '../src/app/target/composeTargetApplication.ts';

function mockReq(method: string, body?: unknown): IncomingMessage {
  const payload = body === undefined ? '' : JSON.stringify(body);
  const req = Readable.from([Buffer.from(payload)]) as IncomingMessage;
  (req as { method?: string }).method = method;
  return req;
}

function mockRes(): ServerResponse & { statusCode: number; body: string; headers: Record<string, string> } {
  const state = { statusCode: 0, body: '', headers: {} as Record<string, string> };
  const res = {
    statusCode: 0,
    body: '',
    headers: state.headers,
    writeHead(code: number, headers?: Record<string, string>) {
      state.statusCode = code;
      res.statusCode = code;
      if (headers) Object.assign(state.headers, headers);
      return res;
    },
    end(chunk?: string | Buffer) {
      state.body = chunk ? String(chunk) : '';
      res.body = state.body;
      return res;
    },
  };
  return res as unknown as ServerResponse & { statusCode: number; body: string; headers: Record<string, string> };
}

describe('M9 target HTTP route dispatch', () => {
  test('non /api/v2 paths are not handled', async () => {
    const handled = await handleTargetProductHttp(
      { app: { workspaceId: 'ws' } as TargetApplication },
      mockReq('GET'),
      mockRes(),
      new URL('http://localhost/api/operator'),
    );
    assert.equal(handled, false);
  });

  test('health returns target kind without querying Postgres', async () => {
    const app = {
      kind: 'TARGET_POSTGRES',
      workspaceId: '11111111-1111-1111-1111-111111111111',
      sqliteAuthoritativeFallback: false,
    } as TargetApplication;
    const res = mockRes();
    const handled = await handleTargetProductHttp(
      { app },
      mockReq('GET'),
      res,
      new URL('http://localhost/api/v2/health'),
    );
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as { kind: string; sqliteAuthoritativeFallback: boolean };
    assert.equal(body.kind, 'TARGET_POSTGRES');
    assert.equal(body.sqliteAuthoritativeFallback, false);
  });

  test('demo provider-event ingress refuses undisclosed mutation shortcuts', async () => {
    const app = {
      kind: 'TARGET_POSTGRES',
      workspaceId: '11111111-1111-1111-1111-111111111111',
      sqliteAuthoritativeFallback: false,
    } as TargetApplication;
    const res = mockRes();
    const handled = await handleTargetProductHttp(
      { app },
      mockReq('POST', {
        providerId: 'atlas',
        providerEventId: 'evt-1',
        receivedAt: '2031-06-01T10:00:00.000Z',
        payload: {},
        disclosedAsSimulatedDemoInput: false,
      }),
      res,
      new URL('http://localhost/api/v2/demo/provider-event'),
    );
    assert.equal(handled, true);
    assert.equal(res.statusCode, 400);
  });
});

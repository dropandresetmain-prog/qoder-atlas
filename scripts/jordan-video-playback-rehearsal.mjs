/**
 * Jordan video playback — two full API rehearsals + Chromium sanity check.
 * Requires `npm run demo:playback` server on NORTHSTAR_FOUNDER_URL (default :8787).
 */
import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';

const BASE = process.env.NORTHSTAR_FOUNDER_URL ?? 'http://127.0.0.1:8787';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function json(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      accept: 'application/json',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try {
    return { status: res.status, body: text ? JSON.parse(text) : null };
  } catch {
    return { status: res.status, body: { raw: text } };
  }
}

async function waitFor(fn, { timeoutMs = 300_000, intervalMs = 2000, label }) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (last?.ok) return last;
    await sleep(intervalMs);
  }
  throw new Error(`timeout: ${label}; last=${JSON.stringify(last)}`);
}

async function runOnce(runIndex) {
  const report = { run: runIndex, steps: [] };
  const reset = await json('POST', '/api/v2/demo/reset');
  report.steps.push({ step: 'reset', status: reset.status, ok: reset.body?.ok });
  if (!reset.body?.ok) throw new Error(`reset failed: ${JSON.stringify(reset.body)}`);

  const baseline = await json('POST', '/api/v2/demo/provider-baseline');
  report.steps.push({ step: 'provider-baseline', status: baseline.status, ok: baseline.body?.ok });
  if (!baseline.body?.ok) throw new Error(`baseline failed: ${JSON.stringify(baseline.body)}`);

  for (const control of [
    'delay_begins_connection_viable',
    'delay_increases_connection_at_risk',
    'zg053_impossible',
  ]) {
    const applied = await json('POST', `/api/v2/demo/controls/${encodeURIComponent(control)}/apply`);
    report.steps.push({ step: control, status: applied.status, ok: applied.body?.ok !== false });
    if (applied.body?.ok === false) throw new Error(`${control}: ${JSON.stringify(applied.body)}`);
  }

  const caseReady = await waitFor(async () => {
    const ov = await json('GET', '/api/v2/operator/overview?format=json');
    const jordan = (ov.body?.population ?? []).find((t) => t.travellerLabel === 'Jordan Hale');
    const caseId = jordan?.caseRef ?? jordan?.openRecoveryCaseId;
    if (!caseId) return { ok: false, jordan };
    const caseView = await json('GET', `/api/v2/cases/${caseId}?format=json`);
    const lifecycle = caseView.body?.status ?? caseView.body?.lifecycle?.status;
    const strategies = caseView.body?.strategies ?? [];
    const pick =
      strategies.find((s) => s.status === 'RECOMMENDED')
      ?? strategies.find((s) => s.viability === 'VIABLE' && !s.executionBlocker)
      ?? strategies.find((s) => s.viability === 'VIABLE');
    const strategyId =
      caseView.body?.recommendation?.recommended?.ref
      ?? pick?.strategyRef;
    if (lifecycle === 'AWAITING_AUTHORITY' && strategyId) {
      return { ok: true, caseId, lifecycle, strategyId };
    }
    return { ok: false, lifecycle, strategyId, jordan };
  }, { label: 'recommendation', timeoutMs: 240_000 });

  report.recommendation = caseReady;

  const approve = await json(
    'POST',
    `/api/v2/cases/${caseReady.caseId}/strategies/${caseReady.strategyId}/approve`,
    {},
  );
  report.steps.push({ step: 'approve', status: approve.status, ok: approve.body?.ok });
  if (!approve.body?.ok) throw new Error(`approve failed: ${JSON.stringify(approve.body)}`);

  const recovered = await waitFor(async () => {
    const ov = await json('GET', '/api/v2/operator/overview?format=json');
    const jordan = (ov.body?.population ?? []).find((t) => t.travellerLabel === 'Jordan Hale');
    const needs = ov.body?.attention?.needsAttentionCount ?? ov.body?.needsAttentionCount;
    if (jordan?.evaluation === 'CURRENT' && jordan?.status === 'READY' && (needs === 0 || needs === '0')) {
      return { ok: true, jordan, needs };
    }
    const caseId = jordan?.caseRef ?? jordan?.openRecoveryCaseId;
    if (caseId) {
      const caseView = await json('GET', `/api/v2/cases/${caseId}?format=json`);
      const status = caseView.body?.status ?? caseView.body?.lifecycle?.status;
      if (status === 'RESOLVED') {
        return { ok: true, jordan, case: status };
      }
    }
    return { ok: false, jordan, needs };
  }, { label: 'recovered', timeoutMs: 180_000 });

  report.recovered = recovered;
  return report;
}

const summary = { runs: [], chromium: null, leaveHealthy: null };

for (const runIndex of [1, 2]) {
  summary.runs.push(await runOnce(runIndex));
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(`${BASE}/api/v2/operator/overview?format=html`, { waitUntil: 'domcontentloaded' });
summary.chromium = { title: await page.title(), url: page.url() };
await browser.close();

summary.leaveHealthy = await json('POST', '/api/v2/demo/reset');
console.log(JSON.stringify(summary, null, 2));

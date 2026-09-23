/**
 * Leave Jordan at D3 + AWAITING_AUTHORITY for founder recording (Approve onward).
 * Requires playback server: npm run demo:playback
 */
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

const reset = await json('POST', '/api/v2/demo/reset');
if (!reset.body?.ok) throw new Error(`reset failed: ${JSON.stringify(reset.body)}`);

const baseline = await json('POST', '/api/v2/demo/provider-baseline');
if (!baseline.body?.ok) throw new Error(`baseline failed: ${JSON.stringify(baseline.body)}`);

for (const control of [
  'delay_begins_connection_viable',
  'delay_increases_connection_at_risk',
  'zg053_impossible',
]) {
  const applied = await json('POST', `/api/v2/demo/controls/${encodeURIComponent(control)}/apply`);
  if (applied.body?.ok === false) throw new Error(`${control}: ${JSON.stringify(applied.body)}`);
}

const ready = await waitFor(async () => {
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
    ?? caseView.body?.planningEvidence?.comparator?.recommended?.ref
    ?? pick?.strategyRef;
  if (lifecycle === 'AWAITING_AUTHORITY' && strategyId) {
    return { ok: true, caseId, lifecycle, strategyId, jordan };
  }
  return { ok: false, lifecycle, caseId, strategyId };
}, { label: 'D3 recommendation', timeoutMs: 300_000 });

console.log(
  JSON.stringify(
    {
      ok: true,
      message: 'Ready to record from Approve',
      base: BASE,
      caseId: ready.caseId,
      strategyId: ready.strategyId,
      caseUrl: `${BASE}/api/v2/cases/${ready.caseId}?format=html`,
      overviewUrl: `${BASE}/api/v2/operator/overview?format=html`,
    },
    null,
    2,
  ),
);

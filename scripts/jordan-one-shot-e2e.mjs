/** Single full playback E2E (reset → D3 → approve → recovered). */
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
await json('POST', '/api/v2/demo/provider-baseline');
for (const control of [
  'delay_begins_connection_viable',
  'delay_increases_connection_at_risk',
  'zg053_impossible',
]) {
  await json('POST', `/api/v2/demo/controls/${encodeURIComponent(control)}/apply`);
}

const caseReady = await waitFor(async () => {
  const ov = await json('GET', '/api/v2/operator/overview?format=json');
  const jordan = (ov.body?.population ?? []).find((t) => t.travellerLabel === 'Jordan Hale');
  const caseId = jordan?.caseRef ?? jordan?.openRecoveryCaseId;
  if (!caseId) return { ok: false };
  const caseView = await json('GET', `/api/v2/cases/${caseId}?format=json`);
  const lifecycle = caseView.body?.status ?? caseView.body?.lifecycle?.status;
  const strategies = caseView.body?.strategies ?? [];
  const pick =
    strategies.find((s) => s.status === 'RECOMMENDED')
    ?? strategies.find((s) => s.viability === 'VIABLE' && !s.executionBlocker)
    ?? strategies.find((s) => s.viability === 'VIABLE');
  const strategyId = caseView.body?.recommendation?.recommended?.ref ?? pick?.strategyRef;
  if (lifecycle === 'AWAITING_AUTHORITY' && strategyId) return { ok: true, caseId, strategyId };
  return { ok: false, lifecycle };
}, { label: 'recommendation' });

const approve = await json(
  'POST',
  `/api/v2/cases/${caseReady.caseId}/strategies/${caseReady.strategyId}/approve`,
  {},
);
if (!approve.body?.ok) throw new Error(`approve failed: ${JSON.stringify(approve.body)}`);

const recovered = await waitFor(async () => {
  const ov = await json('GET', '/api/v2/operator/overview?format=json');
  const jordan = (ov.body?.population ?? []).find((t) => t.travellerLabel === 'Jordan Hale');
  const caseId = jordan?.caseRef ?? jordan?.openRecoveryCaseId;
  if (caseId) {
    const caseView = await json('GET', `/api/v2/cases/${caseId}?format=json`);
    const status = caseView.body?.status ?? caseView.body?.lifecycle?.status;
    if (status === 'RESOLVED') return { ok: true, status, jordan };
  }
  return { ok: false, jordan };
}, { label: 'recovered', timeoutMs: 300_000 });

console.log(JSON.stringify({ ok: true, recovered }, null, 2));

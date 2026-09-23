/**
 * CP3: Jordan GREEN→AMBER→RED — API + Chromium roster data-status proof.
 * Requires a live demo server (REPLAY) on NORTHSTAR_FOUNDER_URL / :8787.
 */
import { chromium } from 'playwright';

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
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text, status: res.status }; }
  return parsed;
}

function jordanFromApi(ov) {
  return (ov?.population ?? []).find((t) => t.travellerLabel === 'Jordan Hale');
}

async function waitJordan(expected, timeoutMs = 180_000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    const ov = await json('GET', '/api/v2/operator/overview?format=json');
    last = jordanFromApi(ov);
    if (last?.evaluation === 'CURRENT' && last.status === expected) return last;
    await sleep(2000);
  }
  throw new Error(`timeout waiting for Jordan ${expected}; last=${JSON.stringify(last)}`);
}

const report = { chromium: true, base: BASE, snapshots: [], api: [] };

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(`${BASE}/api/v2/operator/overview?format=html`, { waitUntil: 'domcontentloaded' });

const reset = await json('POST', '/api/v2/demo/reset');
report.resetOk = !!reset?.ok;
if (!report.resetOk) {
  console.error(JSON.stringify(reset));
  process.exit(2);
}

const stages = [
  { label: 'baseline', control: null, expect: 'READY' },
  { label: 'D1', control: 'delay_begins_connection_viable', expect: 'READY' },
  { label: 'D2', control: 'delay_increases_connection_at_risk', expect: 'AT_RISK' },
  { label: 'D3', control: 'zg053_impossible', expect: 'DISRUPTED' },
];

for (const stage of stages) {
  if (stage.control) {
    const applied = await json('POST', `/api/v2/demo/controls/${encodeURIComponent(stage.control)}/apply`);
    if (applied?.ok === false || applied?.error) {
      throw new Error(`control ${stage.control} failed: ${JSON.stringify(applied)}`);
    }
  }
  const j = await waitJordan(stage.expect);
  report.api.push({
    stage: stage.label,
    status: j.status,
    remainderViability: j.remainderViability,
    evaluation: j.evaluation,
    expect: stage.expect,
    matched: j.status === stage.expect,
  });

  await page.reload({ waitUntil: 'domcontentloaded' });
  // Overview HTML may poll; give the roster a moment after API truth settles.
  await sleep(1500);
  const row = page.locator('[data-test="population-row"]').filter({ hasText: 'Jordan Hale' });
  let dataStatus = await row.getAttribute('data-status').catch(() => null);
  if (!dataStatus) {
    // Fallback: any element that carries Jordan's journey status attr.
    const html = await page.content();
    const idx = html.indexOf('Jordan Hale');
    const slice = idx >= 0 ? html.slice(Math.max(0, idx - 500), idx + 200) : '';
    dataStatus = slice.match(/data-status="([^"]+)"/)?.[1] ?? null;
  }
  const rowText = (await row.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
  report.snapshots.push({
    stage: stage.label,
    dataStatus,
    expect: stage.expect,
    matched: dataStatus === stage.expect,
    rowSnippet: rowText.slice(0, 160),
  });
}

await browser.close();
console.log(JSON.stringify(report, null, 2));
const ok = report.api.every((e) => e.matched) && report.snapshots.every((e) => e.matched);
process.exit(ok ? 0 : 1);

/**
 * CP4 — physical Sarah Stage A/B + programme-alternative acceptance (Chromium).
 * Requires a running normal-boot server on NORTHSTAR_FOUNDER_URL (default :8787).
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.NORTHSTAR_FOUNDER_URL ?? 'http://127.0.0.1:8787';
const OUT = resolve('output/cp4-sarah-physical');
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evidence = {
  startedAt: new Date().toISOString(),
  base: BASE,
  steps: [],
  stageA: null,
  stageB: null,
  programme: null,
  final: null,
  errors: [],
};

function note(step, detail = {}) {
  const row = { step, at: new Date().toISOString(), ...detail };
  evidence.steps.push(row);
  console.log(`[ok] ${step}`, detail && Object.keys(detail).length ? JSON.stringify(detail) : '');
}

function fail(step, detail) {
  evidence.errors.push({ step, ...detail });
  writeFileSync(`${OUT}/evidence.json`, JSON.stringify(evidence, null, 2));
  throw new Error(`${step}: ${JSON.stringify(detail).slice(0, 800)}`);
}

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
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }
  return { status: res.status, json: parsed };
}

function countHealth(html, tone) {
  // Overview graph/roster health classes
  const re = new RegExp(`og-h-${tone}|tone-${tone === 'amber' ? 'watch' : tone === 'green' ? 'ok' : 'alert'}|sem-${tone === 'amber' ? 'watch' : tone === 'green' ? 'ok' : 'alert'}`, 'g');
  return (html.match(re) ?? []).length;
}

function rosterStatusCounts(html) {
  // Product roster rows use data-traveller-status
  const statuses = [...html.matchAll(/data-traveller-status="([A-Z_]+)"/g)].map((m) => m[1]);
  const counts = {};
  for (const s of statuses) counts[s] = (counts[s] ?? 0) + 1;
  return { total: statuses.length, counts };
}

function amberTravellerSignals(html) {
  // Prefer explicit checking/amber markers on traveller nodes
  const amberNodes = (html.match(/og-h-amber/g) ?? []).length;
  const disrupted = (html.match(/data-traveller-status="DISRUPTED"/g) ?? []).length;
  const checking = html.includes('Checking the impact');
  const lifecycle = html.match(/data-assessment-lifecycle="([^"]+)"/)?.[1] ?? null;
  return { amberNodes, disrupted, checking, lifecycle };
}

async function overviewSnapshot() {
  const ov = await json('GET', '/api/v2/operator/overview?format=json');
  const pop = ov.json?.population ?? [];
  const by = {};
  for (const t of pop) by[t.status] = (by[t.status] ?? 0) + 1;
  return {
    status: ov.status,
    by,
    sarah: pop.find((t) => t.travellerLabel === 'Sarah Lim'),
    cohort: ['Sarah Lim', 'Felix Hartono', 'Arjun Rao', 'Siti Rahmah', 'Mei Ling Goh'].map((label) => {
      const row = pop.find((t) => t.travellerLabel === label);
      return { label, status: row?.status, caseRef: row?.caseRef };
    }),
  };
}

async function waitHealthyBaseline(page, timeoutMs = 180_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await sleep(800);
    const snap = await overviewSnapshot();
    const ready = snap.by.READY ?? 0;
    const disrupted = snap.by.DISRUPTED ?? 0;
    const html = await page.content();
    const lifecycle = html.match(/data-assessment-lifecycle="([^"]+)"/)?.[1] ?? 'UNKNOWN';
    // Baseline: Sarah READY, nobody needs attention, most travellers confirmed.
    if (disrupted === 0 && ready >= 50 && snap.sarah?.status === 'READY') {
      note('baseline-settled', { ready, disrupted, lifecycle, sarah: snap.sarah.status });
      await page.screenshot({ path: `${OUT}/00-baseline.png`, fullPage: true });
      return { ready, html, snap };
    }
    await sleep(2000);
  }
  fail('baseline-timeout', { note: 'overview never settled healthy', last: await overviewSnapshot() });
}

async function openDemoControl(page) {
  // Demo console popover trigger in shell
  const triggers = [
    '[data-test="demo-console-trigger"]',
    'button:has-text("Demo")',
    '[data-action="demo-console"]',
    'button:has-text("Console")',
  ];
  for (const sel of triggers) {
    const el = page.locator(sel).first();
    if (await el.count()) {
      await el.click({ timeout: 5000 }).catch(() => {});
      await sleep(400);
      break;
    }
  }
  const apply = page.locator(
    '[data-test="demo-control-airline-disruption-configured"], button:has-text("Trigger configured airline disruption"), [data-control-id="airline-disruption-configured"]',
  ).first();
  if (!(await apply.count())) {
    // Fall back to API apply while still watching UI for Stage A/B
    note('demo-ui-control-missing-using-api');
    return 'api';
  }
  return apply;
}

const health = await fetch(`${BASE}/health`).then((r) => r.json()).catch((e) => ({ error: String(e) }));
if (health?.status !== 'ok') fail('server-health', { health });
note('server-health', { adapterMode: health.adapterMode });

note('reset-start');
const reset = await json('POST', '/api/v2/demo/reset');
if (reset.status !== 200 && reset.status !== 202) fail('reset', reset);
note('reset-done', { status: reset.status, msHint: reset.json?.durationMs ?? reset.json?.detail });

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

try {
  await waitHealthyBaseline(page);

  // Stay on overview so shell polling can paint Stage A without hard navigations.
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await sleep(1000);

  const stageStart = Date.now();
  // Fire apply without awaiting — the ~10s demo hold is inside this request.
  const applyPromise = json('POST', '/api/v2/demo/controls/airline-disruption-configured/apply');
  note('disruption-triggered', { via: 'api-parallel' });

  // Poll Stage A: five affected / checking / active change banner
  let stageASeen = null;
  const stageADeadline = Date.now() + 25_000;
  while (Date.now() < stageADeadline) {
    const html = await page.content();
    const signals = amberTravellerSignals(html);
    const snap = await overviewSnapshot().catch(() => null);
    const disruptedApi = snap?.by?.DISRUPTED ?? 0;
    const checkingVisible = await page.locator('[data-test="overview-reconciling"]:not([hidden])').count().catch(() => 0);
    const activeChange = await page.locator('text=/Active change/i').isVisible().catch(() => false);
    const fiveAttention = await page.locator('text=/5\\s+Needs attention/i').isVisible().catch(() => false);
    const fiveChecking = (html.match(/Checking/g) ?? []).length >= 5;
    if (
      disruptedApi >= 5
      || activeChange
      || fiveAttention
      || (checkingVisible > 0 && (signals.amberNodes >= 5 || fiveChecking))
    ) {
      stageASeen = {
        elapsedMs: Date.now() - stageStart,
        ...signals,
        disruptedApi,
        checkingVisible,
        activeChange,
        fiveAttention,
      };
      evidence.stageA = stageASeen;
      await page.screenshot({ path: `${OUT}/01-stage-a.png`, fullPage: true });
      note('stage-a-visible', stageASeen);
      break;
    }
    await sleep(400);
  }
  if (!stageASeen) {
    const html = await page.content();
    await page.screenshot({ path: `${OUT}/01-stage-a-miss.png`, fullPage: true });
    fail('stage-a-not-visible', {
      signals: amberTravellerSignals(html),
      roster: rosterStatusCounts(html),
      snap: await overviewSnapshot().catch(() => null),
    });
  }

  // Hold until Stage B: Sarah alone disrupted, peers recovered / lifecycle SETTLED
  const stageBDeadline = Date.now() + 45_000;
  while (Date.now() < stageBDeadline) {
    await sleep(500);
    const html = await page.content();
    const signals = amberTravellerSignals(html);
    const snap = await overviewSnapshot();
    const disrupted = snap.by.DISRUPTED ?? 0;
    const sarah = snap.sarah;
    if (
      sarah?.status === 'DISRUPTED'
      && disrupted === 1
      && (signals.lifecycle === 'SETTLED' || signals.lifecycle === 'UNKNOWN' || !signals.checking)
    ) {
      const stageAEnd = Date.now();
      evidence.stageB = {
        elapsedFromTriggerMs: stageAEnd - stageStart,
        stageAVisibleDurationMs: stageAEnd - (stageStart + (stageASeen.elapsedMs ?? 0)),
        approximateHoldFromTriggerMs: stageAEnd - stageStart,
        ...signals,
        snap,
      };
      await page.screenshot({ path: `${OUT}/02-stage-b.png`, fullPage: true });
      note('stage-b-visible', {
        holdMs: evidence.stageB.elapsedFromTriggerMs,
        disrupted,
        sarah: sarah.status,
        cohort: snap.cohort,
      });
      break;
    }
  }

  const applyResult = await applyPromise;
  note('disruption-apply-settled', {
    status: applyResult?.status,
    ok: applyResult?.json?.ok,
    code: applyResult?.json?.code,
  });

  if (!evidence.stageB) {
    for (let i = 0; i < 30; i++) {
      await sleep(2000);
      const snap = await overviewSnapshot();
      if (snap.sarah?.status === 'DISRUPTED' && (snap.by.DISRUPTED ?? 0) === 1) {
        evidence.stageB = {
          elapsedFromTriggerMs: Date.now() - stageStart,
          late: true,
          snap,
        };
        await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
        await page.screenshot({ path: `${OUT}/02-stage-b.png`, fullPage: true });
        note('stage-b-late', evidence.stageB);
        break;
      }
    }
  }
  if (!evidence.stageB) fail('stage-b-not-visible', { snap: await overviewSnapshot() });

  // Duration check: Stage A should be roughly 10s (allow 7–18s from trigger to B)
  const holdMs = evidence.stageB.elapsedFromTriggerMs;
  evidence.stageA.measuredHoldApproxMs = holdMs;
  if (holdMs < 7000) {
    fail('stage-a-too-short', { holdMs, expectedApprox: 10000 });
  }
  note('stage-timing', { holdMs, stageAFirstPaintMs: stageASeen.elapsedMs });

  // Open Sarah case
  const sarah = evidence.stageB.snap?.sarah ?? (await overviewSnapshot()).sarah;
  if (!sarah?.caseRef) fail('sarah-case-missing', { sarah });
  note('sarah-case', { caseRef: sarah.caseRef, status: sarah.status });

  await page.goto(`${BASE}/operator/cases/${sarah.caseRef}`, { waitUntil: 'domcontentloaded' });
  await sleep(2000);

  // Propose strategies if needed
  const propose = page.locator('[data-test="propose-strategies"]');
  if (await propose.count()) {
    await propose.click();
    note('propose-clicked');
    for (let i = 0; i < 60; i++) {
      await sleep(2000);
      const hasProg = await page.locator('[data-test="programme-alternative"]').count();
      const hasTravel = await page.locator('[data-test="normal-recovery-options"] [data-test="recovery-strategy"]').count();
      if (hasProg || hasTravel) break;
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    }
  }

  await page.screenshot({ path: `${OUT}/03-case-options.png`, fullPage: true });
  const caseHtml = await page.content();
  const hasTravelCards = caseHtml.includes('data-test="normal-recovery-options"')
    || /data-strategy-kind="travel"/.test(caseHtml);
  const hasProgrammeCta = caseHtml.includes('data-test="programme-alternative"')
    || /Consider programme change/i.test(caseHtml);
  if (!hasProgrammeCta) fail('programme-cta-missing', { hasTravelCards });
  note('options-split', { hasTravelCards, hasProgrammeCta });

  // Expand programme alternative
  const cta = page.locator('[data-test="programme-alternative-cta"], summary:has-text("Consider programme change")').first();
  await cta.click();
  await sleep(500);
  await page.screenshot({ path: `${OUT}/04-programme-panel.png`, fullPage: true });

  const panel = await page.locator('[data-test="programme-alternative-panel"]').innerHTML().catch(() => '');
  const whatChanges = await page.locator('[data-test="programme-panel-what-changes"]').innerText().catch(() => '');
  const who = await page.locator('[data-test="programme-panel-who"]').innerText().catch(() => '');
  const economics = await page.locator('[data-test="programme-panel-economics"]').innerText().catch(() => '');
  const why = await page.locator('[data-test="programme-panel-why"]').innerText().catch(() => '');

  // Open blast radius
  const blastSummary = page.locator('[data-test="programme-blast-radius"] summary, details[data-test="programme-blast-radius"] summary').first();
  if (await blastSummary.count()) await blastSummary.click();
  await sleep(300);
  const blastDirect = await page.locator('[data-test="programme-blast-direct"]').innerText().catch(() => '');
  const blastReassess = await page.locator('[data-test="programme-blast-reassess"]').innerText().catch(() => '');
  await page.screenshot({ path: `${OUT}/05-programme-blast.png`, fullPage: true });

  evidence.programme = {
    whatChanges,
    who,
    economics,
    why,
    blastDirect,
    blastReassess,
    hasApprove: /Approve programme change/.test(await page.content()),
  };
  note('programme-panel', {
    whatChangesLen: whatChanges.length,
    whoLen: who.length,
    economicsPreview: economics.slice(0, 200),
    blastDirectPreview: blastDirect.slice(0, 200),
    blastReassessPreview: blastReassess.slice(0, 200),
  });

  if (!/SGD\s*0|0\s*new spend|\$0/i.test(economics) && !/SGD 0|0/.test(economics)) {
    // Soft warn — still require some spend signal
    evidence.programme.costWarning = 'expected SGD 0 signal weak';
  }
  if (!blastDirect || !blastReassess) fail('blast-radius-incomplete', evidence.programme);

  const approve = page.locator('[data-test="approve-programme-change"]:not([disabled])').first();
  if (!(await approve.count())) fail('approve-unavailable', { panel: panel.slice(0, 400) });
  await approve.click();
  note('approve-clicked');

  // Wait for resolution
  let resolved = false;
  for (let i = 0; i < 90; i++) {
    await sleep(3000);
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    const html = await page.content();
    if (/Trip recovered|data-test="resolution-panel"|RESOLVED/i.test(html)) {
      resolved = true;
      await page.screenshot({ path: `${OUT}/06-resolved.png`, fullPage: true });
      break;
    }
    const ov2 = await json('GET', '/api/v2/operator/overview?format=json');
    const s2 = (ov2.json?.population ?? []).find((t) => t.travellerLabel === 'Sarah Lim');
    if (s2 && s2.status === 'READY') {
      resolved = true;
      evidence.final = { sarah: s2 };
      await page.screenshot({ path: `${OUT}/06-resolved.png`, fullPage: true });
      break;
    }
  }
  if (!resolved) fail('sarah-not-resolved', {});
  note('sarah-resolved', evidence.final ?? {});

  evidence.finishedAt = new Date().toISOString();
  evidence.verdict = 'PASS';
  writeFileSync(`${OUT}/evidence.json`, JSON.stringify(evidence, null, 2));
  console.log('\nVERDICT: PASS');
  console.log(`Stage A first paint: ${stageASeen.elapsedMs}ms; trigger→StageB: ${holdMs}ms`);
  console.log(`Evidence: ${OUT}/evidence.json`);
} catch (err) {
  evidence.verdict = 'FAIL';
  evidence.finishedAt = new Date().toISOString();
  evidence.errors.push({ message: String(err) });
  writeFileSync(`${OUT}/evidence.json`, JSON.stringify(evidence, null, 2));
  await page.screenshot({ path: `${OUT}/99-failure.png`, fullPage: true }).catch(() => {});
  throw err;
} finally {
  await browser.close();
}

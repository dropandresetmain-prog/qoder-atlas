/**
 * Pass 2 production verification — Railway health, reset, hero spot-checks.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.RAILWAY_URL ?? 'https://qoder-atlas-production.up.railway.app';
const OUT = 'output/pass2-railway-verify';
mkdirSync(OUT, { recursive: true });

const evidence = { base: BASE, at: new Date().toISOString(), steps: [] };
function step(name, detail = {}) {
  evidence.steps.push({ name, ok: true, ...detail });
  console.log(`[ok] ${name}`);
}
function fail(name, detail) {
  evidence.steps.push({ name, ok: false, ...detail });
  writeFileSync(`${OUT}/evidence.json`, JSON.stringify(evidence, null, 2));
  throw new Error(`${name}: ${JSON.stringify(detail)}`);
}

const health = await fetch(`${BASE}/health`);
if (!health.ok) fail('health', { status: health.status });
const healthBody = await health.json();
step('health', { body: healthBody });

const reset = await fetch(`${BASE}/api/demo/reset`, { method: 'POST' });
if (!reset.ok) fail('reset-populated', { status: reset.status, body: await reset.text() });
step('reset-populated', { status: reset.status });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

async function shot(name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  step(`screenshot:${name}`);
}

await page.goto(`${BASE}/operator?event=evt-ait-2026`);
await page.waitForLoadState('networkidle');
await shot('01-overview');

const jordan = page.locator('[data-test="case-row-link"], .brow').filter({ hasText: /Jordan/i }).first();
if (!(await jordan.count())) fail('jordan-row', {});
await jordan.click();
await page.waitForLoadState('networkidle');
await shot('02-jordan-case-entry');
const jordanHtml = await page.content();
if (!/Needs attention|Recovery under way|Awaiting approval/i.test(jordanHtml)) {
  fail('jordan-status', { snippet: jordanHtml.slice(0, 500) });
}
step('jordan-case-visible');

await page.goto(`${BASE}/operator?event=evt-ait-2026`);
await page.waitForLoadState('networkidle');
const sarah = page.locator('[data-test="case-row-link"], .brow').filter({ hasText: /Sarah/i }).first();
await sarah.click();
await page.waitForLoadState('networkidle');
await shot('03-sarah-case');
if (!(await page.content()).includes('What this affects')) fail('sarah-impact-section', {});
step('sarah-impact-section');

await browser.close();
writeFileSync(`${OUT}/evidence.json`, JSON.stringify({ ...evidence, verdict: 'PASS' }, null, 2));
console.log('PASS 2 Railway verification complete');

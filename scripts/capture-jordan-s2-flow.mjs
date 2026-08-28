/**
 * Capture Jordan S2 J-01 through J-08 browser evidence.
 * Requires demo server at HERO_BASE_URL (default http://127.0.0.1:8791).
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.HERO_BASE_URL ?? 'http://127.0.0.1:8791';
const EVENT = 'evt-ait-2026';
const OUT = resolve('output/jordan-s2-flow');
mkdirSync(OUT, { recursive: true });

async function reset() {
  const res = await fetch(`${BASE}/api/demo/reset`, { method: 'POST' });
  if (!res.ok) throw new Error(`reset failed ${res.status}`);
}

async function shot(page, name) {
  await page.screenshot({ path: resolve(OUT, `${name}.png`), fullPage: false });
}

async function openJordan(page) {
  await page.goto(`${BASE}/operator?event=${EVENT}`);
  await page.waitForLoadState('domcontentloaded');
  const search = page.locator('[data-test="roster-search"]');
  if (await search.count()) {
    await search.fill('Jordan');
    await page.waitForTimeout(300);
  }
  await page.locator('[data-test="case-row-link"], [data-test="case-history-link"], [data-test="decision-link"]').filter({ hasText: 'Jordan Hale' }).first().click();
  await page.waitForLoadState('domcontentloaded');
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

await reset();
await page.goto(`${BASE}/operator?event=${EVENT}`);
await page.waitForLoadState('domcontentloaded');
await shot(page, 'J-01-overview-baseline');

await openJordan(page);
await shot(page, 'J-02-delay-developing');
assertNoEngineTerms(await page.content());

if (await page.locator('[data-test="resolve-northstar-btn"]').count()) {
  await page.locator('[data-test="resolve-northstar-btn"]').click();
  await page.waitForTimeout(800);
  await shot(page, 'J-03-pre-emptive-analyse');
  await page.waitForSelector('[data-test="lifecycle-progress-overlay"], [data-test="case-options"], [data-test="begin-strategy-btn"]', { timeout: 25000 });
  await page.waitForTimeout(3200);
  await shot(page, 'J-04-northstar-analysis');
}

await page.waitForSelector('[data-test="case-options"], [data-test="whole-trip-plan"], [data-test="begin-strategy-btn"]', { timeout: 25000 });
await shot(page, 'J-05-recovery-recommendation');

if (await page.locator('[data-test="begin-strategy-btn"]').count()) {
  await page.locator('[data-test="begin-strategy-btn"]').click();
  await page.waitForSelector('[data-test="organisation-approve-form"]', { timeout: 20000 });
}
await shot(page, 'J-06-authority-approval');

await page.locator('[data-test="organisation-approve-form"] button[type="submit"]').click();
await page.waitForSelector('[data-test="execute-approved-strategy-btn"]', { timeout: 20000 });
await shot(page, 'J-07-ready-to-execute');

const overlay = page.waitForSelector('[data-test="lifecycle-progress-overlay"]', { timeout: 8000 });
await page.locator('[data-test="execute-approved-strategy-btn"]').click();
await overlay;
await page.waitForSelector('[data-test="case-phase-resolved"], [data-test="back-to-overview"]', { timeout: 30000 });
await shot(page, 'J-08-resolved-viable');

await browser.close();
console.log(`Jordan flow screenshots written to ${OUT}`);

function assertNoEngineTerms(html) {
  for (const term of ['ActionIntent', 'PLANNING_COMPLETED', 'directFailureIds', 'sig-provider-state']) {
    if (html.includes(term)) throw new Error(`engine term leaked to UI: ${term}`);
  }
}

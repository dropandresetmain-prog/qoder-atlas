/**
 * FINAL NORTHSTAR production pass — visual evidence capture.
 *
 * Boots the populated demo world in-memory and captures judge-facing
 * screenshots across all hero paths. Used for BEFORE (reproduce) and
 * AFTER (verification) evidence. No scenario branching: it drives the
 * same generic UI selectors the hero e2e uses.
 *
 * Usage: node --experimental-strip-types scripts/final-pass-capture.mjs <outDir> [phase]
 *   phase: "all" (default) | "static" | "jordan" | "sarah" | "jonas" | "oliver"
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { AppConfigSchema } from '../src/config/config.ts';
import { composeAppRuntime } from '../src/app/compose.ts';
import { createAppServer } from '../src/server/http.ts';
import { runPopulatedDemoWorld } from '../src/app/demoWorld.ts';

const OUT = resolve(process.argv[2] ?? 'output/final-pass');
const PHASE = process.argv[3] ?? 'all';
mkdirSync(OUT, { recursive: true });

const config = AppConfigSchema.parse({
  environment: 'demo',
  worldSeedMode: 'programme',
  adapterMode: 'REPLAY',
  sqlitePath: ':memory:',
  fixturesDir: resolve('fixtures'),
  providers: { atlas: { env: 'sandbox' }, modelStudio: {}, googleRoutes: {}, nuitee: {} },
});

const composed = await composeAppRuntime(config);
const server = createAppServer(config, composed.endpoints);
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;
const BASE = `http://127.0.0.1:${port}`;

const world = await runPopulatedDemoWorld({ baseUrl: BASE, config, enforceAssertions: false });
if (!world.ok) throw new Error(world.error ?? 'populated world failed');
console.log('[capture] populated world ready');

const browser = await chromium.launch({ headless: true });
const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

async function reset() {
  const res = await fetch(`${BASE}/api/demo/reset`, { method: 'POST' });
  if (res.status !== 200) throw new Error(`reset failed: ${res.status}`);
}

async function shot(page, name, opts = {}) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: opts.fullPage ?? true });
  console.log(`[capture] ${name}`);
}

async function shotEl(page, selector, name) {
  const el = page.locator(selector).first();
  await el.scrollIntoViewIfNeeded();
  await el.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`[capture] ${name}`);
}

async function gotoOverview(page) {
  await page.goto(`${BASE}/operator?event=evt-ait-2026`);
  await page.waitForLoadState('domcontentloaded');
}

async function openCase(page, name) {
  await gotoOverview(page);
  const search = page.locator('[data-test="roster-search"]');
  if (await search.count()) {
    await search.fill(name.split(' ')[0] ?? name);
    await page.waitForTimeout(200);
  }
  const row = page.locator('[data-roster-name]').filter({ hasText: new RegExp(name, 'i') });
  const caseHit = row.locator('[data-test="case-row-link"], [data-test="case-history-link"]');
  if (await caseHit.count()) {
    await caseHit.first().click();
  } else {
    await page.locator('[data-test="decision-link"]').filter({ hasText: name }).first().click();
  }
  await page.waitForLoadState('domcontentloaded');
}

// ---------------------------------------------------------------------------
// Static surfaces
// ---------------------------------------------------------------------------
async function captureStatic() {
  await reset();
  await gotoOverview(desktop);
  await desktop.waitForLoadState('networkidle');
  await shot(desktop, '01-overview');

  // Profile menu open (reset control lives here, never on the primary surface)
  await desktop.locator('[data-test="profile-menu-toggle"]').click();
  await desktop.waitForTimeout(300);
  await shot(desktop, '01b-overview-profile-open', { fullPage: false });
  await desktop.locator('[data-test="profile-menu-toggle"]').click();

  // Traveller chat input — mobile width (Jordan)
  await reset();
  await gotoOverview(desktop);
  const search = desktop.locator('[data-test="roster-search"]');
  if (await search.count()) await search.fill('Jordan');
  const row = desktop.locator('[data-trip-id]').filter({ hasText: 'Jordan Hale' }).first();
  await row.waitFor({ timeout: 15000 });
  const tripId = await row.getAttribute('data-trip-id');
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(`${BASE}/traveller?trip=${encodeURIComponent(tripId)}`);
  await mobile.waitForLoadState('networkidle');
  await shot(mobile, '02-traveller-mobile-jordan');
  await mobile.close();
}

// ---------------------------------------------------------------------------
// Jordan — S2 lifecycle
// ---------------------------------------------------------------------------
async function captureJordan() {
  await reset();
  await openCase(desktop, 'Jordan Hale');
  await desktop.waitForSelector('[data-test="organisation-approve-form"], [data-test="resolve-northstar-btn"], [data-test="begin-strategy-btn"]', { timeout: 20000 });
  await shot(desktop, '10-jordan-case-entry');
  if (await desktop.locator('[data-test="status-timeline"]').count()) {
    await shotEl(desktop, '[data-test="status-timeline"]', '10b-jordan-timeline');
  }

  if (await desktop.locator('[data-test="resolve-northstar-btn"]').count()) {
    await desktop.locator('[data-test="resolve-northstar-btn"]').click();
    await desktop.waitForSelector('[data-test="lifecycle-progress-overlay"]', { timeout: 8000 }).catch(() => null);
    await desktop.waitForTimeout(1400);
    await shot(desktop, '11-jordan-planning-overlay', { fullPage: false });
    await desktop.waitForSelector('[data-test="begin-strategy-btn"], [data-test="organisation-approve-form"], [data-test="case-options"]', { timeout: 20000 });
    await desktop.waitForTimeout(3200);
  }
  await shot(desktop, '12-jordan-options-selected-recovery');

  if (await desktop.locator('[data-test="begin-strategy-btn"]').count()) {
    const begin = desktop.waitForResponse((r) => r.url().includes('/api/runtime/begin'), { timeout: 20000 });
    await desktop.locator('[data-test="begin-strategy-btn"]').click();
    await begin;
    await desktop.waitForSelector('[data-test="organisation-approve-form"]', { timeout: 20000 });
  }
  await shot(desktop, '13-jordan-organiser-approval');
  // Selected recovery is staged once authority is live (impact-first contract).
  if (await desktop.locator('[data-test="case-options"]').count()) {
    await shotEl(desktop, '[data-test="case-options"]', '12b-jordan-flight-before-after-cost');
  }
  if (await desktop.locator('[data-test="whole-trip-plan"]').count()) {
    await shotEl(desktop, '[data-test="whole-trip-plan"]', '12c-jordan-hotels-plan');
  }

  const approve = desktop.locator('[data-test="organisation-approve-form"] button[type="submit"]');
  await approve.click();
  await desktop.waitForSelector('[data-test="execute-approved-strategy-btn"]', { timeout: 20000 });

  const execOverlay = desktop.waitForSelector('[data-test="lifecycle-progress-overlay"]', { timeout: 8000 }).catch(() => null);
  await desktop.locator('[data-test="execute-approved-strategy-btn"]').click();
  await execOverlay;
  await desktop.waitForTimeout(1200);
  await shot(desktop, '14-jordan-execute-overlay', { fullPage: false });
  await desktop.waitForSelector('[data-test="case-phase-resolved"], [data-test="back-to-overview"]', { timeout: 30000 });
  await desktop.waitForLoadState('domcontentloaded');
  await shot(desktop, '15-jordan-resolved');
}

// ---------------------------------------------------------------------------
// Sarah — S1→S3 programme change
// ---------------------------------------------------------------------------
async function captureSarah() {
  await reset();
  await openCase(desktop, 'Sarah Lim');
  await desktop.waitForLoadState('networkidle');
  await shot(desktop, '20-sarah-case-entry');

  const travelBtn = desktop.locator('[data-test="programme-travel-analysis-btn"]');
  if (await travelBtn.count()) {
    await travelBtn.click();
    await desktop.waitForSelector('[data-test="lifecycle-progress-overlay"]', { timeout: 8000 }).catch(() => null);
    await desktop.waitForTimeout(1400);
    await shot(desktop, '21-sarah-travel-analysis-overlay', { fullPage: false });
    await desktop.waitForSelector('[data-test="preview-programme-change-btn"]', { timeout: 20000 });
    await desktop.waitForTimeout(400);
  }
  await desktop.waitForSelector('[data-test="preview-programme-change-btn"]', { timeout: 20000 });
  await desktop.locator('[data-test="preview-programme-change-btn"]').click();
  await desktop.waitForSelector('[data-programme-change-modal]', { timeout: 10000 });
  await desktop.waitForTimeout(600);
  await shot(desktop, '22-sarah-now-vs-proposed');

  await desktop.locator('[data-programme-change-modal] [data-programme-change-preview]').click();
  await desktop.waitForSelector('[data-test="lifecycle-progress-overlay"]', { timeout: 8000 }).catch(() => null);
  await desktop.waitForTimeout(1400);
  await shot(desktop, '23-sarah-preview-impact-overlay', { fullPage: false });
  await desktop.waitForSelector('[data-test="programme-change-result"] [data-test="now-vs-proposed"]', { timeout: 20000 });
  await shot(desktop, '24-sarah-preview-result');
}

// ---------------------------------------------------------------------------
// Jonas — S5 selected recovery / authority
// ---------------------------------------------------------------------------
async function captureJonas() {
  await reset();
  await openCase(desktop, 'Jonas Berg');
  await desktop.waitForSelector('[data-test="primary-action-panel"], [data-test="resolve-northstar-btn"], [data-test="waiting-for-traveller"]', { timeout: 20000 });
  await desktop.waitForLoadState('networkidle');
  await shot(desktop, '30-jonas-case-selected-recovery');
}

// ---------------------------------------------------------------------------
// Oliver — S7 origin change
// ---------------------------------------------------------------------------
async function captureOliver() {
  await reset();
  await openCase(desktop, 'Oliver Bennett');
  await desktop.waitForSelector('[data-test="organisation-approve-form"], [data-test="resolve-northstar-btn"], [data-test="begin-strategy-btn"]', { timeout: 20000 });
  await desktop.waitForLoadState('networkidle');
  await shot(desktop, '40-oliver-case-entry');
  if (await desktop.locator('.chain').count()) {
    await shotEl(desktop, '.chain', '40b-oliver-trip-status-cards');
  }
  if (await desktop.locator('[data-test="resolve-northstar-btn"]').count()) {
    await desktop.locator('[data-test="resolve-northstar-btn"]').click();
    await desktop.waitForSelector('[data-test="begin-strategy-btn"], [data-test="organisation-approve-form"], [data-test="case-options"]', { timeout: 20000 });
    await desktop.waitForTimeout(3400);
    await shot(desktop, '41-oliver-options');
  }
}

try {
  if (PHASE === 'all' || PHASE === 'static') await captureStatic();
  if (PHASE === 'all' || PHASE === 'jordan') await captureJordan();
  if (PHASE === 'all' || PHASE === 'sarah') await captureSarah();
  if (PHASE === 'all' || PHASE === 'jonas') await captureJonas();
  if (PHASE === 'all' || PHASE === 'oliver') await captureOliver();
} catch (error) {
  console.error('[capture] failed:', error);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
console.log('[capture] evidence in', OUT);

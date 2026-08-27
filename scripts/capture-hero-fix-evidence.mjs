/**
 * Capture browser evidence for final hero acceptance REC fixes.
 * Run against a live demo server (default http://127.0.0.1:8791).
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.HERO_BASE_URL ?? 'http://127.0.0.1:8791';
const EVENT = 'evt-ait-2026';
const OUT = resolve('output/hero-acceptance/fixes');
mkdirSync(OUT, { recursive: true });

async function reset() {
  const res = await fetch(`${BASE}/api/demo/reset`, { method: 'POST' });
  if (!res.ok) throw new Error(`reset failed ${res.status}`);
}

async function shot(page, name) {
  await page.screenshot({ path: resolve(OUT, `${name}.png`), fullPage: false });
}

async function openCase(page, name) {
  await page.goto(`${BASE}/operator?event=${EVENT}`);
  await page.waitForLoadState('domcontentloaded');
  const search = page.locator('[data-test="roster-search"]');
  if (await search.count()) {
    await search.fill(name.split(' ')[0]);
    await page.waitForTimeout(200);
  }
  await page.locator('[data-test="case-row-link"], [data-test="case-history-link"], [data-test="decision-link"]').filter({ hasText: name }).first().click();
  await page.waitForLoadState('domcontentloaded');
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

await reset();
await page.goto(`${BASE}/operator?event=${EVENT}`);
await page.waitForLoadState('domcontentloaded');
await shot(page, '00-overview-shared-incident');
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(200);
await shot(page, '00-overview-roster');

// Jordan
await openCase(page, 'Jordan Hale');
await shot(page, 'J-02-case-entry');
if (await page.locator('[data-test="resolve-northstar-btn"]').count()) {
  await page.locator('[data-test="resolve-northstar-btn"]').click();
  await page.waitForTimeout(500);
}
if (await page.locator('[data-test="begin-strategy-btn"]').count()) {
  await page.locator('[data-test="begin-strategy-btn"]').click();
  await page.waitForSelector('[data-test="organisation-approve-form"]', { timeout: 20000 });
}
await shot(page, 'J-04-options-approve');
await page.locator('[data-test="organisation-approve-form"] button[type="submit"]').click();
await page.waitForSelector('[data-test="execute-approved-strategy-btn"]', { timeout: 20000 });
await shot(page, 'J-07-execute');
const jordanOverlay = page.waitForSelector('[data-test="lifecycle-progress-overlay"]', { timeout: 8000 });
await page.locator('[data-test="execute-approved-strategy-btn"]').click();
await jordanOverlay;
await shot(page, 'J-08-progress');
await page.waitForSelector('[data-test="case-phase-resolved"], [data-test="back-to-overview"]', { timeout: 30000 });
await shot(page, 'J-09-terminal');

// Sarah (no reset)
await page.goto(`${BASE}/operator?event=${EVENT}`);
await page.waitForLoadState('domcontentloaded');
await shot(page, 'S-01-overview');
const sarah = page.locator('[data-test="attention-queue"] a').filter({ hasText: /Sarah Lim/i });
if (await sarah.count()) await sarah.first().click();
else await openCase(page, 'Sarah Lim');
await page.waitForSelector('[data-test="preview-programme-change-btn"]', { timeout: 20000 });
await shot(page, 'S-02-case');
await page.locator('[data-test="preview-programme-change-btn"]').click();
await page.waitForSelector('[data-programme-change-modal]', { timeout: 10000 });
await shot(page, 'S-05-edit-modal-prefilled');
const modal = page.locator('[data-programme-change-modal]');
await modal.locator('[name="commitmentId"]').selectOption('cmt-ait-d1-headline-interview');
await modal.locator('[name="changeKind"]').selectOption('RESCHEDULED');
// Ensure ISO values remain on the inputs for submit even if human text is shown.
await modal.locator('[name="newStartsAt"]').evaluate((el) => {
  el.setAttribute('data-iso-value', '2026-10-01T15:30:00+08:00');
  el.value = '1 Oct · 15:30';
});
await modal.locator('[name="newEndsAt"]').evaluate((el) => {
  el.setAttribute('data-iso-value', '2026-10-01T16:00:00+08:00');
  el.value = '1 Oct · 16:00';
});
await modal.locator('[data-test="programme-change-preview"], [data-programme-change-preview]').click();
await page.waitForSelector('[data-test="now-vs-proposed"]', { timeout: 20000 });
await shot(page, 'S-06-now-proposed');
page.once('dialog', (d) => d.accept());
const sarahOverlay = page.waitForSelector('[data-test="lifecycle-progress-overlay"]', { timeout: 10000 });
await modal.locator('[data-test="programme-change-commit"]').click();
await sarahOverlay;
await shot(page, 'S-07-commit-progress');
await page.waitForTimeout(2800);
await page.goto(`${BASE}/operator?event=${EVENT}`);
await page.waitForLoadState('domcontentloaded');
await shot(page, 'S-09-overview-after');

// Oliver
await reset();
await openCase(page, 'Oliver Bennett');
await shot(page, 'O-02-case');
if (await page.locator('[data-test="resolve-northstar-btn"]').count()) {
  await page.locator('[data-test="resolve-northstar-btn"]').click();
  await page.waitForTimeout(500);
}
if (await page.locator('[data-test="begin-strategy-btn"]').count()) {
  await page.locator('[data-test="begin-strategy-btn"]').click();
  await page.waitForSelector('[data-test="organisation-approve-form"]', { timeout: 20000 });
}
await page.evaluate(() => window.scrollTo(0, 600));
await shot(page, 'O-04-options');
await page.locator('[data-test="organisation-approve-form"] button[type="submit"]').click();
await page.waitForSelector('[data-test="execute-approved-strategy-btn"]', { timeout: 20000 });
const oliverOverlay = page.waitForSelector('[data-test="lifecycle-progress-overlay"]', { timeout: 8000 });
await page.locator('[data-test="execute-approved-strategy-btn"]').click();
await oliverOverlay;
await shot(page, 'O-08-progress');
await page.waitForSelector('[data-test="case-phase-resolved"], [data-test="back-to-overview"]', { timeout: 30000 });
await shot(page, 'O-09-terminal');

// Jonas
await reset();
await openCase(page, 'Jonas Berg');
await shot(page, 'V-02-operator-waiting');
await page.goto(`${BASE}/operator?event=${EVENT}`);
const search = page.locator('[data-test="roster-search"]');
if (await search.count()) await search.fill('Jonas');
const row = page.locator('[data-trip-id]').filter({ hasText: 'Jonas Berg' }).first();
await row.waitFor({ timeout: 15000 });
const tripId = await row.getAttribute('data-trip-id');
await page.goto(`${BASE}/traveller?trip=${encodeURIComponent(tripId)}`);
await page.waitForLoadState('domcontentloaded');
await shot(page, 'V-06-traveller-decision');
const approve = page.locator('form[action*="traveller-decision"] button[type="submit"]').filter({ hasText: /Approve/i });
if (await approve.count()) {
  await approve.first().click();
  await page.waitForLoadState('networkidle');
}
await shot(page, 'V-07-after-approve');

console.log(JSON.stringify({ ok: true, out: OUT, tripId }, null, 2));
await browser.close();

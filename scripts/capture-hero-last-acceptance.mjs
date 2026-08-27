/**
 * Capture the six required browser evidence shots for last-acceptance fixes.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.HERO_BASE_URL ?? 'http://127.0.0.1:8787';
const EVENT = 'evt-ait-2026';
const OUT = resolve('output/hero-acceptance/last-fixes');
mkdirSync(OUT, { recursive: true });

async function reset() {
  const res = await fetch(`${BASE}/api/demo/reset`, { method: 'POST' });
  if (!res.ok) throw new Error(`reset failed ${res.status}`);
}

async function shot(page, name) {
  const path = resolve(OUT, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  return path;
}

async function openCase(page, name) {
  await page.goto(`${BASE}/operator?event=${EVENT}`);
  await page.waitForLoadState('domcontentloaded');
  const search = page.locator('[data-test="roster-search"]');
  if (await search.count()) {
    await search.fill(name.split(' ')[0]);
    await page.waitForTimeout(200);
  }
  await page
    .locator('[data-test="case-row-link"], [data-test="case-history-link"], [data-test="decision-link"]')
    .filter({ hasText: name })
    .first()
    .click();
  await page.waitForLoadState('domcontentloaded');
}

async function stageOrganiserApproval(page, name) {
  await openCase(page, name);
  if (await page.locator('[data-test="resolve-northstar-btn"]').count()) {
    await page.locator('[data-test="resolve-northstar-btn"]').click();
    await page.waitForSelector(
      '[data-test="begin-strategy-btn"], [data-test="organisation-approve-form"]',
      { timeout: 20000 },
    );
  }
  if (await page.locator('[data-test="begin-strategy-btn"]').count()) {
    const begin = page.waitForResponse((r) => r.url().includes('/api/runtime/begin'), { timeout: 20000 });
    await page.locator('[data-test="begin-strategy-btn"]').click();
    await begin;
    await page.waitForSelector('[data-test="organisation-approve-form"]', { timeout: 20000 });
  }
}

const notes = [];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

await reset();
await page.goto(`${BASE}/operator?event=${EVENT}`);
await page.waitForLoadState('domcontentloaded');
await page.waitForSelector('[data-test="shared-incident-group"]', { timeout: 20000 });
const group = page.locator('[data-test="shared-incident-group"]');
notes.push({
  shot: '01-s1-shared-incident',
  affected: await group.getAttribute('data-shared-affected'),
  workable: await group.getAttribute('data-shared-workable'),
  critical: await group.getAttribute('data-shared-critical'),
  text: (await group.textContent())?.replace(/\s+/g, ' ').trim(),
});
await shot(page, '01-s1-shared-incident');

await stageOrganiserApproval(page, 'Jordan Hale');
notes.push({
  shot: '02-jordan-awaiting-approval',
  phase: await page.locator('[data-case-workspace]').getAttribute('data-case-phase'),
  badge: (await page.locator('h1 [role="status"]').textContent())?.trim(),
  hasApprove: (await page.locator('[data-test="organisation-approve-form"]').count()) > 0,
  hasBegin: (await page.locator('[data-test="begin-strategy-btn"]').count()) > 0,
  hasResolve: (await page.locator('[data-test="resolve-northstar-btn"]').count()) > 0,
});
await shot(page, '02-jordan-awaiting-approval');

await reset();
await stageOrganiserApproval(page, 'Oliver Bennett');
notes.push({
  shot: '03-oliver-awaiting-approval',
  phase: await page.locator('[data-case-workspace]').getAttribute('data-case-phase'),
  badge: (await page.locator('h1 [role="status"]').textContent())?.trim(),
  hasApprove: (await page.locator('[data-test="organisation-approve-form"]').count()) > 0,
  hasBegin: (await page.locator('[data-test="begin-strategy-btn"]').count()) > 0,
  hasResolve: (await page.locator('[data-test="resolve-northstar-btn"]').count()) > 0,
});
await shot(page, '03-oliver-awaiting-approval');

await reset();
await openCase(page, 'Jonas Berg');
await page.waitForSelector('[data-test="waiting-for-traveller"], [data-test="primary-action-panel"]', {
  timeout: 20000,
});
const operatorHtml = await page.content();
notes.push({
  shot: '04-jonas-operator-waiting',
  badge: (await page.locator('h1 [role="status"]').textContent())?.trim(),
  hasTravellerApproveForm: /action="\/api\/cases\/[^"]+\/traveller-decision"/.test(operatorHtml),
  has542: /US\$542\.00/.test(operatorHtml),
  has54183: /US\$541\.83/.test(operatorHtml),
});
await shot(page, '04-jonas-operator-waiting');

await page.goto(`${BASE}/operator?event=${EVENT}`);
const search = page.locator('[data-test="roster-search"]');
if (await search.count()) await search.fill('Jonas');
const row = page.locator('[data-trip-id]').filter({ hasText: 'Jonas Berg' }).first();
await row.waitFor({ timeout: 15000 });
const tripId = await row.getAttribute('data-trip-id');
const overviewIssue =
  (await page.locator('[data-test="attention-queue"] a').filter({ hasText: /Jonas Berg/i }).first().locator('.q-issue').textContent().catch(() => '')) ||
  '';
notes.push({
  overviewJonasIssue: overviewIssue.replace(/\s+/g, ' ').trim(),
  overviewHas542: /US\$542\.00/.test(overviewIssue),
  overviewHas54183: /US\$541\.83/.test(overviewIssue),
  overviewHasBareSgd: /S\$731\.47/.test(overviewIssue),
});

await page.goto(`${BASE}/traveller?trip=${encodeURIComponent(tripId)}`);
await page.waitForLoadState('domcontentloaded');
const travellerHtml = await page.content();
notes.push({
  shot: '05-jonas-traveller-approval',
  has54183: /US\$541\.83/.test(travellerHtml),
  has542: /US\$542\.00/.test(travellerHtml),
  hasApprove: (await page.locator('form[action*="traveller-decision"] button[type="submit"]').count()) > 0,
});
await shot(page, '05-jonas-traveller-approval');

const approve = page.locator('form[action*="traveller-decision"] button[type="submit"]').filter({ hasText: /Approve/i });
if (await approve.count()) {
  await approve.first().click();
  await page.waitForLoadState('networkidle');
}
await openCase(page, 'Jonas Berg');
if (await page.locator('[data-test="execute-approved-strategy-btn"]').count()) {
  const overlay = page.waitForSelector('[data-test="lifecycle-progress-overlay"]', { timeout: 8000 }).catch(() => null);
  await page.locator('[data-test="execute-approved-strategy-btn"]').click();
  await overlay;
  await page.waitForSelector('[data-test="case-phase-resolved"], [data-test="back-to-overview"]', {
    timeout: 30000,
  });
}
const terminalHtml = await page.content();
notes.push({
  shot: '06-jonas-terminal-revisit',
  phase: await page.locator('[data-case-workspace]').getAttribute('data-case-phase'),
  has54183: /US\$541\.83/.test(terminalHtml),
  has542: /US\$542\.00/.test(terminalHtml),
});
await shot(page, '06-jonas-terminal-revisit');

writeFileSync(resolve(OUT, 'evidence-notes.json'), JSON.stringify(notes, null, 2));
await browser.close();
console.log(JSON.stringify({ out: OUT, notes }, null, 2));

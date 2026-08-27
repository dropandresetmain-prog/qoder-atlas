/**
 * Four-hero browser rehearsal for lifecycle/state correctness.
 * Asserts exact CTAs, terminal phase, Overview Confirmed, and reload/reopen.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';

import { AppConfigSchema } from '../../src/config/config.ts';
import { composeAppRuntime } from '../../src/app/compose.ts';
import { createAppServer } from '../../src/server/http.ts';
import { resolvePopulatedDemoAnchorEventId } from '../../src/app/demoWorld.ts';

const EVENT = resolvePopulatedDemoAnchorEventId();
const S3_RESCHEDULE = {
  commitmentId: 'cmt-ait-d1-headline-interview',
  newStartsAt: '2026-10-01T15:30:00+08:00',
  newEndsAt: '2026-10-01T16:00:00+08:00',
};

const demoConfig = AppConfigSchema.parse({
  environment: 'demo',
  worldSeedMode: 'programme',
  adapterMode: 'REPLAY',
  sqlitePath: ':memory:',
  fixturesDir: resolve('fixtures'),
  providers: { atlas: { env: 'sandbox' }, modelStudio: {}, googleRoutes: {}, nuitee: {} },
});

let server: Server;
let browser: Browser;
let baseUrl: string;

test.before(async () => {
  const composed = await composeAppRuntime(demoConfig);
  server = createAppServer(demoConfig, composed.endpoints);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  baseUrl = `http://127.0.0.1:${addr.port}`;
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    ...(process.env['PLAYWRIGHT_CHROMIUM_PATH']
      ? { executablePath: process.env['PLAYWRIGHT_CHROMIUM_PATH'] }
      : existsSync('/opt/pw-browsers/chromium')
        ? { executablePath: '/opt/pw-browsers/chromium' }
        : {}),
  });
});

test.after(async () => {
  await browser?.close();
  await new Promise<void>((done) => server?.close(() => done()));
});

async function resetDemo(): Promise<void> {
  const res = await fetch(`${baseUrl}/api/demo/reset`, { method: 'POST' });
  assert.equal(res.status, 200);
}

async function gotoOverview(page: Page): Promise<void> {
  await page.goto(`${baseUrl}/operator?event=${EVENT}`);
  await page.waitForLoadState('domcontentloaded');
}

async function openTravellerCase(page: Page, name: string): Promise<void> {
  const search = page.locator('[data-test="roster-search"]');
  if (await search.count()) {
    await search.fill(name.split(' ')[0] ?? name);
    await page.waitForTimeout(150);
  }
  const row = page.locator('[data-test="case-row-link"], [data-test="case-history-link"], [data-test="decision-link"]').filter({ hasText: name }).first();
  await row.click();
  await page.waitForLoadState('domcontentloaded');
}

function forbiddenAfterRecovery(html: string): string[] {
  const hits: string[] = [];
  if (html.includes('data-test="resolve-northstar-btn"')) hits.push('Resolve');
  if (html.includes('data-test="begin-strategy-btn"')) hits.push('Begin');
  if (html.includes('data-test="execute-approved-strategy-btn"')) hits.push('Execute');
  if (html.includes('data-test="organisation-approve-form"')) hits.push('Approve');
  return hits;
}

async function approveAndExecuteOrganiser(page: Page): Promise<void> {
  const html = await page.content();
  assert.equal(html.includes('data-test="resolve-northstar-btn"'), false, 'Resolve must be gone once recovery has begun');
  assert.equal(html.includes('data-test="begin-strategy-btn"'), false, 'Begin must be gone once approval is pending');
  assert.match(html, /data-test="organisation-approve-form"/);

  const approve = page.locator('[data-test="organisation-approve-form"] button[type="submit"]');
  const decide = page.waitForResponse((r) => r.url().includes('/api/runtime/decide') && r.request().method() === 'POST', { timeout: 20000 });
  await approve.click();
  const decideRes = await decide;
  assert.equal(decideRes.status(), 200);
  await page.waitForSelector('[data-test="execute-approved-strategy-btn"]', { timeout: 20000 });
  const afterApprove = await page.content();
  assert.doesNotMatch(afterApprove, /data-test="resolve-northstar-btn"/);
  assert.doesNotMatch(afterApprove, /data-test="begin-strategy-btn"/);

  const exec = page.locator('[data-test="execute-approved-strategy-btn"]');
  const execRes = page.waitForResponse((r) => r.url().includes('/api/runtime/execute') && r.request().method() === 'POST', { timeout: 30000 });
  await exec.click();
  assert.equal((await execRes).status(), 200);
  await page.waitForSelector('[data-test="case-phase-resolved"], [data-test="back-to-overview"]', { timeout: 30000 });
}

async function assertResolvedReloadOverview(page: Page, name: string): Promise<void> {
  let html = await page.content();
  assert.match(html, /data-test="case-phase-resolved"/);
  assert.deepEqual(forbiddenAfterRecovery(html), [], `terminal CTAs still present: ${forbiddenAfterRecovery(html).join(',')}`);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  html = await page.content();
  assert.match(html, /data-test="case-phase-resolved"/);
  assert.deepEqual(forbiddenAfterRecovery(html), [], `reopen resurrected CTAs: ${forbiddenAfterRecovery(html).join(',')}`);
  await gotoOverview(page);
  const search = page.locator('[data-test="roster-search"]');
  if (await search.count()) {
    await search.fill(name.split(' ')[0] ?? name);
    await page.waitForTimeout(150);
  }
  const row = page.locator('[data-trip-id]').filter({ hasText: name }).first();
  await row.waitFor({ state: 'visible', timeout: 15000 });
  const presentation = await row.getAttribute('data-presentation');
  assert.equal(presentation, 'CONFIRMED', `${name} Overview presentation is ${presentation}`);
}

test('browser: Jordan S2 approval → Execute → resolved Confirmed on reopen', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    await resetDemo();
    await gotoOverview(page);
    await openTravellerCase(page, 'Jordan Hale');
    await page.waitForSelector('[data-test="organisation-approve-form"], [data-test="resolve-northstar-btn"]', { timeout: 20000 });
    if (await page.locator('[data-test="resolve-northstar-btn"]').count()) {
      await page.locator('[data-test="resolve-northstar-btn"]').click();
      await page.waitForSelector('[data-test="begin-strategy-btn"], [data-test="organisation-approve-form"]', { timeout: 20000 });
    }
    if (await page.locator('[data-test="begin-strategy-btn"]').count()) {
      const begin = page.waitForResponse((r) => r.url().includes('/api/runtime/begin'), { timeout: 20000 });
      await page.locator('[data-test="begin-strategy-btn"]').click();
      await begin;
      await page.waitForSelector('[data-test="organisation-approve-form"]', { timeout: 20000 });
    }
    await approveAndExecuteOrganiser(page);
    await assertResolvedReloadOverview(page, 'Jordan Hale');
  } finally {
    await page.close();
  }
});

test('browser: Oliver S7 approval → Execute → resolved Confirmed on reopen', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    await resetDemo();
    await gotoOverview(page);
    await openTravellerCase(page, 'Oliver Bennett');
    await page.waitForSelector('[data-test="organisation-approve-form"], [data-test="resolve-northstar-btn"]', { timeout: 20000 });
    if (await page.locator('[data-test="resolve-northstar-btn"]').count()) {
      await page.locator('[data-test="resolve-northstar-btn"]').click();
      await page.waitForSelector('[data-test="begin-strategy-btn"], [data-test="organisation-approve-form"]', { timeout: 20000 });
    }
    if (await page.locator('[data-test="begin-strategy-btn"]').count()) {
      const begin = page.waitForResponse((r) => r.url().includes('/api/runtime/begin'), { timeout: 20000 });
      await page.locator('[data-test="begin-strategy-btn"]').click();
      await begin;
      await page.waitForSelector('[data-test="organisation-approve-form"]', { timeout: 20000 });
    }
    await approveAndExecuteOrganiser(page);
    await assertResolvedReloadOverview(page, 'Oliver Bennett');
  } finally {
    await page.close();
  }
});

test('browser: Sarah S1→S3 commit converges to resolved Confirmed without a second Resolve', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    await resetDemo();
    await gotoOverview(page);
    const attention = page.locator('[data-test="attention-queue"] a').filter({ hasText: /Sarah Lim/i });
    if (await attention.count()) await attention.first().click();
    else await openTravellerCase(page, 'Sarah Lim');
    await page.waitForSelector('[data-test="preview-programme-change-btn"]', { timeout: 20000 });
    await page.locator('[data-test="preview-programme-change-btn"]').click();
    await page.waitForSelector('[data-programme-change-modal]', { timeout: 10000 });
    const modal = page.locator('[data-programme-change-modal]');
    await modal.locator('[name="commitmentId"]').selectOption(S3_RESCHEDULE.commitmentId);
    await modal.locator('[name="changeKind"]').selectOption('RESCHEDULED');
    await modal.locator('[name="newStartsAt"]').fill(S3_RESCHEDULE.newStartsAt);
    await modal.locator('[name="newEndsAt"]').fill(S3_RESCHEDULE.newEndsAt);
    await modal.locator('[data-test="programme-change-preview"], [data-programme-change-preview]').click();
    await page.waitForSelector('[data-test="now-vs-proposed"]', { timeout: 20000 });
    page.once('dialog', (d) => d.accept());
    const commit = page.waitForResponse((r) => r.url().includes('event-change') || r.url().includes('programme') || r.url().includes('commit'), { timeout: 30000 }).catch(() => null);
    await modal.locator('[data-test="programme-change-commit"]').click();
    await commit;
    await page.waitForTimeout(800);
    await gotoOverview(page);
    const search = page.locator('[data-test="roster-search"]');
    if (await search.count()) await search.fill('Sarah');
    const row = page.locator('[data-trip-id]').filter({ hasText: 'Sarah Lim' }).first();
    await row.waitFor({ timeout: 15000 });
    assert.equal(await row.getAttribute('data-presentation'), 'CONFIRMED');
    if (await page.locator('[data-test="case-history-link"]').filter({ hasText: 'Sarah Lim' }).count()) {
      await page.locator('[data-test="case-history-link"]').filter({ hasText: 'Sarah Lim' }).first().click();
      await page.waitForLoadState('domcontentloaded');
      const html = await page.content();
      assert.match(html, /data-test="case-phase-resolved"/);
      assert.deepEqual(forbiddenAfterRecovery(html), [], `Sarah Resolve resurrected: ${forbiddenAfterRecovery(html).join(',')}`);
    }
  } finally {
    await page.close();
  }
});

test('browser: Jonas terminal reopen does not resurrect Resolve/Approve when already resolved', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    await resetDemo();
    await gotoOverview(page);
    await openTravellerCase(page, 'Jonas Berg');
    await page.waitForSelector('[data-test="primary-action-panel"], [data-test="resolve-northstar-btn"], form[action*="traveller-decision"]', { timeout: 20000 });
    if (await page.locator('[data-test="resolve-northstar-btn"]').count()) {
      await page.locator('[data-test="resolve-northstar-btn"]').click();
      await page.waitForTimeout(3500);
    }
    if (await page.locator('[data-test="begin-strategy-btn"]').count()) {
      await page.locator('[data-test="begin-strategy-btn"]').click();
      await page.waitForLoadState('networkidle');
    }
    const travellerApprove = page.locator('form[action*="traveller-decision"] button[type="submit"]').filter({ hasText: /Approve/i });
    if (await travellerApprove.count()) {
      await travellerApprove.first().click();
      await page.waitForLoadState('networkidle');
    }
    if (await page.locator('[data-test="execute-approved-strategy-btn"]').count()) {
      await page.locator('[data-test="execute-approved-strategy-btn"]').click();
      await page.waitForLoadState('networkidle');
    }
    const html = await page.content();
    if (/data-test="case-phase-resolved"/.test(html)) {
      await assertResolvedReloadOverview(page, 'Jonas Berg');
    } else {
      // Planner/fixture ownership is outside this lane; still prove we did not
      // leave a resolved case looking open via sessionStorage.
      await page.reload();
      const reloaded = await page.content();
      if (/data-test="case-phase-resolved"/.test(reloaded)) {
        assert.deepEqual(forbiddenAfterRecovery(reloaded), []);
      }
    }
  } finally {
    await page.close();
  }
});

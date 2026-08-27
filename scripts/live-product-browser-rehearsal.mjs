/**
 * R3 live product closure — mandatory browser hero rehearsal.
 * Uses operator UI clicks only (no /demo scenario manifests).
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { AppConfigSchema } from '../src/config/config.ts';
import { composeAppRuntime } from '../src/app/compose.ts';
import { createAppServer } from '../src/server/http.ts';

const OUT_DIR = 'output/live-product-rehearsal';
mkdirSync(OUT_DIR, { recursive: true });

const EVENT = 'evt-ait-2026';

const S3_RESCHEDULE = {
  commitmentId: 'cmt-ait-d1-headline-interview',
  newStartsAt: '2026-10-01T15:30:00+08:00',
  newEndsAt: '2026-10-01T16:00:00+08:00',
};

const steps = [];
function record(step, detail = {}) {
  steps.push({ step, at: new Date().toISOString(), ...detail });
  console.log(`[ok] ${step}`);
}
function fail(step, detail) {
  steps.push({ step, at: new Date().toISOString(), failed: true, ...detail });
  writeFileSync(`${OUT_DIR}/evidence.json`, JSON.stringify({ verdict: 'FAIL', steps }, null, 2));
  throw new Error(`rehearsal failed at ${step}: ${JSON.stringify(detail)}`);
}

const demoConfig = AppConfigSchema.parse({
  environment: 'demo',
  worldSeedMode: 'programme',
  adapterMode: 'REPLAY',
  sqlitePath: ':memory:',
  fixturesDir: resolve('fixtures'),
  providers: { atlas: { env: 'sandbox' }, modelStudio: {}, googleRoutes: {}, nuitee: {} },
});

const composed = await composeAppRuntime(demoConfig);
const server = createAppServer(demoConfig, composed.endpoints);
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;
const BASE = `http://127.0.0.1:${port}`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

async function resetDemo() {
  const res = await fetch(`${BASE}/api/demo/reset`, { method: 'POST' });
  if (!res.ok) fail('reset', { status: res.status });
  record('reset');
}

async function gotoOverview() {
  await page.goto(`${BASE}/operator?event=${EVENT}`);
  await page.waitForLoadState('networkidle');
}

async function clickTripRow(namePattern) {
  const row = page.locator('[data-test="case-row-link"], .brow').filter({ hasText: namePattern }).first();
  await row.click();
  await page.waitForLoadState('networkidle');
}

async function caseTerminalState() {
  const html = await page.content();
  if (/ESCALATED|hand off to human support|Trip recovered|RECOVERED|RESOLVED|back on track/i.test(html)) {
    return 'terminal';
  }
  if (/Preview programme change|Plan recovery|Begin recovery|Execute approved|Approve/i.test(html)) {
    return 'actionable';
  }
  return 'unknown';
}

async function approveAndExecuteIfPresent() {
  if (await page.locator('[data-test="organisation-approve-form"]').count()) {
    await page.locator('[data-test="organisation-approve-form"] button[type="submit"]').click();
    await page.waitForLoadState('networkidle');
    record('organiser-approve');
  }
  if (await page.locator('[data-test="execute-approved-strategy-btn"]').count()) {
    await page.locator('[data-test="execute-approved-strategy-btn"]').click();
    await page.waitForLoadState('networkidle');
    record('execute');
  }
}

async function runJordanS2() {
  await resetDemo();
  await gotoOverview();
  await page.screenshot({ path: `${OUT_DIR}/s2-01-overview.png`, fullPage: true });
  await clickTripRow('Jordan Hale');
  await page.waitForSelector('[data-test="primary-action-panel"]', { timeout: 15000 });
  await approveAndExecuteIfPresent();
  const state = await caseTerminalState();
  if (state !== 'terminal') fail('s2.terminal', { state });
  record('s2.terminal', { state });
}

async function runSarahS1S3() {
  await resetDemo();
  await gotoOverview();
  await clickTripRow('Sarah Lim');
  await page.waitForSelector('[data-test="preview-programme-change-btn"]', { timeout: 15000 });

  await page.locator('[data-test="preview-programme-change-btn"]').click();
  await page.waitForSelector('[data-programme-change-modal]', { timeout: 10000 });

  const modal = page.locator('[data-programme-change-modal]');
  await modal.locator('[name="commitmentId"]').selectOption(S3_RESCHEDULE.commitmentId);
  await modal.locator('[name="changeKind"]').selectOption('RESCHEDULED');
  await modal.locator('[name="newStartsAt"]').fill(S3_RESCHEDULE.newStartsAt);
  await modal.locator('[name="newEndsAt"]').fill(S3_RESCHEDULE.newEndsAt);
  page.once('dialog', (d) => d.accept());
  await modal.locator('[data-programme-change-preview]').click();
  await page.waitForTimeout(1500);
  await modal.locator('[data-programme-change-commit]').click({ timeout: 10000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(800);
  record('s1s3.programme-commit');

  const traveller = await (await fetch(`${BASE}/api/traveller/trip-trv-evt-ait-2026-ait-draft-14`)).json();
  if (traveller.remainderViable !== 'VIABLE') {
    fail('s1s3.terminal', { note: 'Sarah remainderViable not VIABLE after programme commit', remainderViable: traveller.remainderViable });
  }
  record('s1s3.terminal', { remainderViable: traveller.remainderViable, status: traveller.status });
}

async function runOliverS7() {
  await resetDemo();
  await gotoOverview();
  await clickTripRow('Oliver Bennett');
  await page.waitForSelector('[data-test="primary-action-panel"]', { timeout: 15000 });
  await approveAndExecuteIfPresent();
  const state = await caseTerminalState();
  if (state !== 'terminal') fail('s7.terminal', { state });
  record('s7.terminal', { state });
}

async function runJonasS5() {
  await resetDemo();
  await gotoOverview();
  await clickTripRow('Jonas Berg');
  await page.waitForSelector('[data-test="primary-action-panel"]', { timeout: 15000 });

  if (await page.locator('[data-test="plan-recovery-btn"]').count()) {
    await page.locator('[data-test="plan-recovery-btn"]').click();
    await page.waitForLoadState('networkidle');
  }
  if (await page.locator('[data-test="begin-strategy-btn"]').count()) {
    await page.locator('[data-test="begin-strategy-btn"]').click();
    await page.waitForLoadState('networkidle');
  }
  await approveAndExecuteIfPresent();
  const state = await caseTerminalState();
  if (state !== 'terminal') fail('s5.terminal', { state });
  record('s5.terminal', { state });
}

async function runEscalationBreadth(id, namePattern) {
  await resetDemo();
  await gotoOverview();
  await clickTripRow(namePattern);
  await page.waitForSelector('[data-test="primary-action-panel"], [data-test="escalate-btn"]', { timeout: 15000 });
  if (await page.locator('[data-test="escalate-btn"]').count()) {
    await page.locator('[data-test="escalate-btn"]').click();
    await page.waitForLoadState('networkidle');
    record(`${id}.escalate`);
  } else if (await page.locator('[data-test="plan-recovery-btn"]').count()) {
    await page.locator('[data-test="plan-recovery-btn"]').click();
    await page.waitForLoadState('networkidle');
    if (await page.locator('[data-test="escalate-btn"]').count()) {
      await page.locator('[data-test="escalate-btn"]').click();
      await page.waitForLoadState('networkidle');
      record(`${id}.escalate-after-plan`);
    }
  }
  const html = await page.content();
  if (!/ESCALATED|hand off|human support|RESOLVED/i.test(html)) {
    fail(`${id}.terminal`, { note: 'no terminal escalation state' });
  }
  record(`${id}.terminal`);
}

try {
  await runJordanS2();
  await runSarahS1S3();
  await runOliverS7();
  await runJonasS5();
  await runEscalationBreadth('s4', 'Ethan Yap');
  await runEscalationBreadth('s6', 'Hannah');
  await runEscalationBreadth('s8', 'Mei Ling');

  await resetDemo();
  await gotoOverview();
  await page.screenshot({ path: `${OUT_DIR}/final-overview.png`, fullPage: true });
  await page.goto(`${BASE}/decisions?event=${EVENT}`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${OUT_DIR}/final-decisions.png`, fullPage: true });

  writeFileSync(`${OUT_DIR}/evidence.json`, JSON.stringify({ verdict: 'PASS', steps, base: BASE }, null, 2));
  console.log('LIVE PRODUCT REHEARSAL PASS');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
  composed.db.close();
}

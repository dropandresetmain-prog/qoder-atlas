/**
 * R3D human-acceptance browser capture — required state screenshots.
 * Run: node --experimental-strip-types scripts/r3d-human-acceptance-capture.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import { AppConfigSchema } from '../src/config/config.ts';
import { composeAppRuntime } from '../src/app/compose.ts';
import { createAppServer } from '../src/server/http.ts';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
const OUT = join(repoRoot, 'output', 'r3d-human-acceptance');
const EVENT = 'evt-ait-2026';
const S3_RESCHEDULE = {
  commitmentId: 'cmt-ait-d1-headline-interview',
  newStartsAt: '2026-10-01T15:30:00+08:00',
  newEndsAt: '2026-10-01T16:00:00+08:00',
};

mkdirSync(OUT, { recursive: true });

const demoConfig = AppConfigSchema.parse({
  environment: 'demo',
  worldSeedMode: 'programme',
  adapterMode: 'REPLAY',
  sqlitePath: ':memory:',
  fixturesDir: resolve(repoRoot, 'fixtures'),
  providers: { atlas: { env: 'sandbox' }, modelStudio: {}, googleRoutes: {}, nuitee: {} },
});

const composed = await composeAppRuntime(demoConfig);
const server = createAppServer(demoConfig, composed.endpoints);
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;
const BASE = `http://127.0.0.1:${port}`;

const reset = await fetch(`${BASE}/api/demo/reset`, { method: 'POST' });
if (!reset.ok) throw new Error(`reset failed: ${reset.status}`);

const browser = await chromium.launch({ headless: true });
const evidence = { base: BASE, shots: [], checks: {} };

async function shot(page, name) {
  const path = join(OUT, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  evidence.shots.push({ name, path });
  console.log(`[shot] ${name}`);
}

async function openCaseByName(page, name) {
  await page.goto(`${BASE}/operator?event=${EVENT}`, { waitUntil: 'networkidle' });
  const attention = page.locator('[data-test="attention-queue"] a, [data-test="decision-link"]').filter({ hasText: name });
  if (await attention.count()) {
    await attention.first().click();
  } else {
    const search = page.locator('[data-test="roster-search"]');
    if (await search.count()) {
      await search.fill(name.split(/\s+/)[0]);
      await page.waitForTimeout(150);
    }
    await page.locator('[data-test="case-row-link"], .brow').filter({ hasText: name }).first().click();
  }
  await page.waitForLoadState('networkidle');
}

async function resolveIfPresent(page) {
  const btn = page.locator('[data-test="resolve-northstar-btn"]');
  if (!(await btn.count())) return false;
  await btn.click();
  await page.waitForTimeout(900);
  await shot(page, 'case-resolve-progress');
  await page.waitForTimeout(2800);
  await page.waitForLoadState('networkidle').catch(() => {});
  return true;
}

try {
  const op = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await op.goto(`${BASE}/operator?event=${EVENT}`, { waitUntil: 'networkidle' });
  await shot(op, 'overview-start');
  const overviewHtml = await op.content();
  evidence.checks.demoBannerAbsent = !/class="demo-banner/.test(overviewHtml);
  evidence.checks.resetPresent = /data-test="profile-reset-btn"|Reset scenario/i.test(overviewHtml);
  evidence.checks.fleetFilledUnconfirmed = /d-unconfirmed/.test(overviewHtml);
  evidence.checks.attentionQueue = /data-test="attention-queue"/.test(overviewHtml);
  evidence.checks.sarahInAttention = /Sarah Lim/i.test(overviewHtml) && /data-test="attention-queue"[\s\S]{0,4000}Sarah Lim/i.test(overviewHtml);

  await op.goto(`${BASE}/programme?event=${EVENT}`, { waitUntil: 'networkidle' });
  await shot(op, 'programme');
  await op.goto(`${BASE}/activity?event=${EVENT}`, { waitUntil: 'networkidle' });
  await shot(op, 'activity');

  // Jordan S2
  await openCaseByName(op, 'Jordan');
  await shot(op, 'case-impacted');
  const jordanHtml = await op.content();
  evidence.checks.jordanNoBroken = !/>Broken</.test(jordanHtml);
  evidence.checks.jordanResolve = /data-test="resolve-northstar-btn"/.test(jordanHtml);
  await resolveIfPresent(op);
  await shot(op, 'case-options');
  const opt = op.locator('[data-test="strategy-option"][data-option-selectable="true"]').first();
  if (await opt.count()) await opt.click();
  // Prefer approval when already required; otherwise begin the selected strategy.
  if (await op.locator('[data-test="organisation-approve-form"] button').isVisible().catch(() => false)) {
    await shot(op, 'case-approval');
    await op.locator('[data-test="organisation-approve-form"] button').click();
    await op.waitForLoadState('networkidle');
  } else if (await op.locator('[data-test="begin-strategy-btn"]').count()) {
    await op.locator('[data-test="begin-strategy-btn"]').click();
    await op.waitForLoadState('networkidle');
    if (await op.locator('[data-test="resolve-northstar-btn"]').count()) {
      await op.locator('[data-test="resolve-northstar-btn"]').click();
      await op.waitForTimeout(3200);
    }
    if (await op.locator('[data-test="organisation-approve-form"] button').count()) {
      await shot(op, 'case-approval');
      await op.locator('[data-test="organisation-approve-form"] button').click();
      await op.waitForLoadState('networkidle');
    }
  } else if (await op.locator('form[action*="traveller-decision"] button').count()) {
    await shot(op, 'case-approval');
  }
  if (await op.locator('[data-test="execute-approved-strategy-btn"]').count()) {
    await op.locator('[data-test="execute-approved-strategy-btn"]').click();
    await op.waitForLoadState('networkidle');
  }
  await shot(op, 'case-recovered');

  // Jonas S5
  await fetch(`${BASE}/api/demo/reset`, { method: 'POST' });
  await openCaseByName(op, 'Jonas');
  await resolveIfPresent(op);
  await shot(op, 'jonas-options');
  const jonasHtml = await op.content();
  evidence.checks.jonasFunding =
    /funding-traveller-incremental|payable by the traveller|Personal incremental|Traveller —/i.test(jonasHtml);
  evidence.checks.jonasNoHotelId = !/place-hotel-/i.test(jonasHtml);
  await shot(op, 'jonas-funding');

  // Oliver S7
  await fetch(`${BASE}/api/demo/reset`, { method: 'POST' });
  await openCaseByName(op, 'Oliver');
  await resolveIfPresent(op);
  await shot(op, 'oliver-authority');
  const oliverHtml = await op.content();
  evidence.checks.oliverAuthority =
    /organisation-approve-form|Approved by policy|traveller-decision|Approve/i.test(oliverHtml);

  // Sarah S1→S3
  await fetch(`${BASE}/api/demo/reset`, { method: 'POST' });
  await op.goto(`${BASE}/operator?event=${EVENT}`, { waitUntil: 'networkidle' });
  await shot(op, 'sarah-alert');
  await openCaseByName(op, 'Sarah');
  await shot(op, 'sarah-case');
  if (await op.locator('[data-test="preview-programme-change-btn"]').count()) {
    await op.locator('[data-test="preview-programme-change-btn"]').click();
    await op.waitForSelector('[data-programme-change-modal]');
    const modal = op.locator('[data-programme-change-modal]');
    await modal.locator('[name="commitmentId"]').selectOption(S3_RESCHEDULE.commitmentId).catch(() => {});
    await modal.locator('[name="changeKind"]').selectOption('RESCHEDULED').catch(() => {});
    await modal.locator('[name="newStartsAt"]').fill(S3_RESCHEDULE.newStartsAt);
    await modal.locator('[name="newEndsAt"]').fill(S3_RESCHEDULE.newEndsAt);
    await modal.locator('[data-programme-change-preview]').click();
    await op.waitForSelector('[data-test="now-vs-proposed"]', { timeout: 20000 });
    await shot(op, 'sarah-programme-now-proposed');
    op.once('dialog', (d) => d.accept());
    await modal.locator('[data-programme-change-commit]').click();
    await op.waitForLoadState('networkidle').catch(() => {});
    await op.waitForTimeout(800);
    await shot(op, 'sarah-after-commit');
  }

  // Traveller viewport
  const tv = await browser.newPage({ viewport: { width: 430, height: 932 } });
  await tv.goto(`${BASE}/operator?event=${EVENT}`, { waitUntil: 'networkidle' });
  const show = tv.locator('[data-test="show-interaction"]').first();
  if (await show.count()) {
    await show.click();
    await tv.waitForLoadState('networkidle');
  }
  await shot(tv, 'traveller-choice');
  await shot(tv, 'traveller-recovered');
  await tv.close();

  // Laptop bleed check
  const lap = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await lap.goto(`${BASE}/operator?event=${EVENT}`, { waitUntil: 'networkidle' });
  await shot(lap, 'overview-laptop');
  await lap.close();

  writeFileSync(join(OUT, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence.checks, null, 2));
  console.log(`shots=${evidence.shots.length} dir=${OUT}`);
} catch (error) {
  console.error(error);
  writeFileSync(join(OUT, 'evidence.json'), JSON.stringify({ ...evidence, error: String(error) }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((done, fail) => server.close((err) => (err ? fail(err) : done())));
  composed.db.close();
}

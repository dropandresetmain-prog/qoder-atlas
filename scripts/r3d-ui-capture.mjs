/**
 * R3D — fresh live-product UI screenshots (isolated REPLAY demo).
 *
 * Run: node --experimental-strip-types scripts/r3d-ui-capture.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import { AppConfigSchema } from '../src/config/config.ts';
import { composeAppRuntime } from '../src/app/compose.ts';
import { createAppServer } from '../src/server/http.ts';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
const OUT = join(repoRoot, 'output', 'r3d-ui');
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
const evidence = { base: BASE, shots: [] };

async function capture(name, url, viewport, prep) {
  const page = await browser.newPage({ viewport });
  await page.goto(url, { waitUntil: 'networkidle' });
  if (prep) await prep(page);
  await page.waitForTimeout(350);
  const path = join(OUT, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  evidence.shots.push({ name, path, viewport, url });
  console.log(`[shot] ${name}`);
  await page.close();
}

try {
  await capture('overview', `${BASE}/operator?event=${EVENT}`, { width: 1440, height: 1000 });
  await capture('overview-laptop', `${BASE}/operator?event=${EVENT}`, { width: 1280, height: 900 });
  await capture('programme', `${BASE}/programme?event=${EVENT}`, { width: 1440, height: 1000 });
  await capture('decisions', `${BASE}/decisions?event=${EVENT}`, { width: 1440, height: 1000 });
  await capture('activity', `${BASE}/activity?event=${EVENT}`, { width: 1440, height: 1000 });

  await capture('case-s2', `${BASE}/operator?event=${EVENT}`, { width: 1440, height: 1000 }, async (page) => {
    const row = page.locator('[data-test="case-row-link"], .brow').filter({ hasText: /Jordan|Chen/i }).first();
    if (await row.count()) {
      await row.click();
      await page.waitForLoadState('networkidle');
      const plan = page.getByRole('button', { name: /Plan recovery|Begin recovery|Check recovery/i }).first();
      if (await plan.count()) {
        await plan.click();
        await page.waitForTimeout(1200);
        await page.waitForLoadState('networkidle');
      }
    }
  });

  await capture('traveller-s2-or-s5', `${BASE}/operator?event=${EVENT}`, { width: 430, height: 932 }, async (page) => {
    const show = page.locator('[data-test="show-interaction"]').first();
    if (await show.count()) {
      await show.click();
      await page.waitForLoadState('networkidle');
    } else {
      await page.goto(`${BASE}/traveller`, { waitUntil: 'networkidle' });
    }
  });

  await capture('programme-change-preview', `${BASE}/programme?event=${EVENT}`, { width: 1440, height: 1000 }, async (page) => {
    const launch = page.locator('[data-programme-change-launch]').first();
    await launch.click();
    await page.waitForSelector('[data-programme-change-modal]');
    await page.selectOption('[name="commitmentId"]', S3_RESCHEDULE.commitmentId).catch(() => {});
    await page.fill('[name="newStartsAt"]', S3_RESCHEDULE.newStartsAt);
    await page.fill('[name="newEndsAt"]', S3_RESCHEDULE.newEndsAt);
    await page.click('[data-programme-change-preview]');
    await page.waitForSelector('[data-test="now-vs-proposed"]', { timeout: 15000 });
  });

  // Assert product pages do not render the demo banner chrome.
  const overviewHtml = await (await fetch(`${BASE}/operator?event=${EVENT}`)).text();
  const hasBanner = /class="demo-banner/.test(overviewHtml);
  evidence.demoBannerAbsent = !hasBanner;
  evidence.resetDemoPresent = /data-test="demo-reset-btn"|Reset demo/i.test(overviewHtml);
  evidence.fleetCount = (overviewHtml.match(/data-fleet-trip=/g) || []).length;
  evidence.pageSize = /data-page-size="10"/.test(overviewHtml);

  writeFileSync(join(OUT, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await browser.close();
  await new Promise((done, fail) => server.close((err) => (err ? fail(err) : done())));
  composed.db.close();
}

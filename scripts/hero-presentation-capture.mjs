/**
 * Presentation-lane hero screenshots for final/hero-presentation.
 * Run: node --experimental-strip-types scripts/hero-presentation-capture.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import { AppConfigSchema } from '../src/config/config.ts';
import { composeAppRuntime } from '../src/app/compose.ts';
import { createAppServer } from '../src/server/http.ts';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
const OUT = join(repoRoot, 'output', 'hero-presentation');
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

async function resetDemo() {
  const reset = await fetch(`${BASE}/api/demo/reset`, { method: 'POST' });
  if (!reset.ok) throw new Error(`reset failed: ${reset.status}`);
}

const browser = await chromium.launch({ headless: true });
const evidence = { base: BASE, shots: [], checks: [] };

async function shot(page, name) {
  const path = join(OUT, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  evidence.shots.push({ name, path });
  console.log(`[shot] ${name}`);
}

function note(check, ok, detail = '') {
  evidence.checks.push({ check, ok, detail });
  console.log(`[${ok ? 'ok' : 'miss'}] ${check}${detail ? ` — ${detail}` : ''}`);
}

async function openTravellerCase(page, name) {
  await page.goto(`${BASE}/operator?event=${EVENT}`, { waitUntil: 'networkidle' });
  const search = page.locator('[data-test="roster-search"]');
  if (await search.count()) {
    await search.fill(name.split(/\s+/)[0]);
    await page.waitForTimeout(150);
  }
  const row = page.locator('[data-test="case-row-link"], .brow').filter({ hasText: new RegExp(name, 'i') }).first();
  await row.click();
  await page.waitForLoadState('networkidle');
}

async function resolveIfPresent(page) {
  const btn = page.locator('[data-test="resolve-northstar-btn"]');
  if (await btn.count()) {
    await btn.click();
    await page.waitForTimeout(3400);
    await page.waitForLoadState('networkidle').catch(() => {});
  }
}

try {
  await resetDemo();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  // Overview / Programme / no demo banner
  await page.goto(`${BASE}/operator?event=${EVENT}`, { waitUntil: 'networkidle' });
  await shot(page, '01-overview');
  const overviewHtml = await page.content();
  note('no-demo-banner-overview', !/class="demo-banner"|data-test="demo-banner"/.test(overviewHtml));
  note('overview-67', /67/.test(overviewHtml));

  await page.goto(`${BASE}/programme?event=${EVENT}`, { waitUntil: 'networkidle' });
  await shot(page, '02-programme');

  // Jordan S2 — options after resolve
  await resetDemo();
  await openTravellerCase(page, 'Jordan');
  await shot(page, '03-jordan-case-entry');
  await resolveIfPresent(page);
  await shot(page, '04-jordan-options');
  const jordanHtml = await page.content();
  note('jordan-us-currency', /US\$/.test(jordanHtml), 'US$ present');
  note('jordan-no-bare-dollar-chip', !/\$[\d.]+\s+at provider/.test(jordanHtml));
  note('jordan-buffer-or-arrival', /370|14:35|20:45|min available|min required/.test(jordanHtml));
  note('jordan-no-human-agent', !/human agent/i.test(jordanHtml));
  note('jordan-organiser-authority', /Organisation approval required|Approve as organiser/i.test(jordanHtml));

  // Sarah programme preview
  await page.goto(`${BASE}/programme?event=${EVENT}`, { waitUntil: 'networkidle' });
  const launch = page.locator('[data-programme-change-launch]').first();
  if (await launch.count()) {
    await launch.click();
    await page.waitForSelector('[data-programme-change-modal]');
    await page.selectOption('[name="commitmentId"]', S3_RESCHEDULE.commitmentId).catch(() => {});
    await page.fill('[name="newStartsAt"]', S3_RESCHEDULE.newStartsAt);
    await page.fill('[name="newEndsAt"]', S3_RESCHEDULE.newEndsAt);
    await page.click('[data-programme-change-preview]');
    await page.waitForSelector('[data-test="now-vs-proposed"]', { timeout: 20000 });
    await shot(page, '05-sarah-programme-preview');
    const previewHtml = await page.content();
    note('sarah-human-times', /15:30|09:20|15:30–16:00|09:20–09:50/.test(previewHtml));
    note('sarah-named-blast', /Sarah|Elena/i.test(previewHtml));
    note('sarah-no-raw-iso-primary', !/>2026-10-01T15:30:00\+08:00</.test(previewHtml));
  } else {
    note('sarah-preview-launch', false, 'programme change launch missing');
  }

  // Oliver
  await resetDemo();
  await openTravellerCase(page, 'Oliver');
  await shot(page, '06-oliver-case-entry');
  await resolveIfPresent(page);
  await shot(page, '07-oliver-options');
  const oliverHtml = await page.content();
  note('oliver-tokyo-or-hnd', /HND|NRT|Tokyo|Haneda/i.test(oliverHtml));
  note('oliver-lhr-return', /LHR|London|SIN→LHR|Singapore.*London/i.test(oliverHtml));
  note('oliver-no-human-agent', !/human agent/i.test(oliverHtml));
  note('oliver-us-currency', /US\$/.test(oliverHtml));

  // Jonas traveller surface
  await resetDemo();
  await openTravellerCase(page, 'Jonas');
  await shot(page, '08-jonas-case-entry');
  await resolveIfPresent(page);
  await shot(page, '09-jonas-options');
  const jonasHtml = await page.content();
  note('jonas-concorde', /Concorde/i.test(jonasHtml));
  note('jonas-traveller-pays', /pays|Traveller|personal incremental|Jonas/i.test(jonasHtml));
  note('jonas-no-flight-change-claim', /No flight changes|Extend|extra night|incremental/i.test(jonasHtml));

  // Traveller hero image (Jonas or first available)
  const show = page.locator('[data-test="show-interaction"]').first();
  if (await show.count()) {
    await show.click();
    await page.waitForLoadState('networkidle');
  } else {
    const tripMatch = /\/traveller\?trip=([^"&\s]+)/.exec(jonasHtml);
    if (tripMatch) {
      await page.goto(`${BASE}/traveller?trip=${tripMatch[1]}`, { waitUntil: 'networkidle' });
    } else {
      await page.setViewportSize({ width: 430, height: 932 });
      await page.goto(`${BASE}/traveller`, { waitUntil: 'networkidle' });
    }
  }
  await page.setViewportSize({ width: 430, height: 932 });
  await shot(page, '10-traveller-hero');
  const travellerHtml = await page.content();
  note('traveller-hero-asset', /sg-dusk\.png/.test(travellerHtml));

  // Asset route exists
  const asset = await fetch(`${BASE}/assets/sg-dusk.png`);
  note('sg-dusk-asset-route', asset.ok && (asset.headers.get('content-type') || '').includes('png'));

  writeFileSync(join(OUT, 'evidence.json'), JSON.stringify(evidence, null, 2));
  const misses = evidence.checks.filter((c) => !c.ok);
  console.log(`\nshots=${evidence.shots.length} checks=${evidence.checks.length} misses=${misses.length}`);
  if (misses.length) {
    console.log('misses:', misses.map((m) => m.check).join(', '));
  }
} finally {
  await browser.close();
  server.close();
}

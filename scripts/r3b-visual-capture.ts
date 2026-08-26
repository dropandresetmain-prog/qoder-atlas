/**
 * R3B - capture live and fixture screenshots for visual convergence.
 * Run: node --experimental-strip-types scripts/r3b-visual-capture.ts [--live]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import type { Server } from 'node:http';

import { AppConfigSchema } from '../src/config/config.ts';
import { composeAppRuntime } from '../src/app/compose.ts';
import { createAppServer } from '../src/server/http.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(repoRoot, 'output', 'r3b-visual');
const previewDir = path.join(repoRoot, 'data', 'ui-preview');

const FIXTURE_SHOTS: Array<{ file: string; name: string; width: number; height: number }> = [
  { file: 'operator-dashboard.html', name: 'ref-o1-overview', width: 1440, height: 1900 },
  { file: 'operator-dashboard-alt.html', name: 'ref-o1-overview-alt', width: 1440, height: 1200 },
  { file: 'operator-programme.html', name: 'ref-p1-programme', width: 1440, height: 1900 },
  { file: 'operator-decisions.html', name: 'ref-d1-decisions', width: 1440, height: 1200 },
  { file: 'operator-activity.html', name: 'ref-activity', width: 1440, height: 1200 },
  { file: 'case-awaiting-approval.html', name: 'ref-c4-case', width: 1440, height: 2000 },
  { file: 'case-awaiting-traveller.html', name: 'ref-c1-case', width: 1440, height: 2000 },
  { file: 'operator-programme-p2.html', name: 'ref-p2-programme', width: 1440, height: 1900 },
  { file: 'traveller-disrupted.html', name: 'ref-t2-traveller', width: 430, height: 1200 },
  { file: 'traveller-awaiting-input.html', name: 'ref-t4-traveller', width: 430, height: 1400 },
  { file: 'traveller-recovering.html', name: 'ref-t3-traveller', width: 430, height: 1200 },
  { file: 'traveller-resolved-fully.html', name: 'ref-t7-traveller', width: 430, height: 1200 },
];

const HERO_TRIPS = [
  'trip-trv-evt-ait-2026-ait-draft-09', // S2 Jordan Hale
  'trip-trv-evt-ait-2026-ait-draft-14', // S1/S3 Sarah Lim
  'trip-trv-evt-ait-2026-ait-draft-38', // S7 Oliver Bennett
  'trip-trv-evt-ait-2026-ait-draft-35', // S5 Jonas Berg
];

const LIVE_SHOTS: Array<{ path: string; name: string; width: number; height: number; setup?: (base: string) => Promise<void> }> = [
  {
    path: '/operator?event=evt-ait-2026',
    name: 'live-o1-overview',
    width: 1440,
    height: 1900,
    setup: async (base) => {
      await fetch(`${base}/api/demo/reset`, { method: 'POST' });
    },
  },
  { path: '/programme?event=evt-ait-2026', name: 'live-p1-programme', width: 1440, height: 1900 },
  { path: '/decisions?event=evt-ait-2026', name: 'live-d1-decisions', width: 1440, height: 1200 },
  { path: '/activity?event=evt-ait-2026', name: 'live-activity', width: 1440, height: 1200 },
  { path: '/operator?event=evt-ait-2026', name: 'live-o1-overview-narrow', width: 820, height: 2200 },
];

async function captureUrl(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  url: string,
  outPath: string,
  width: number,
  height: number,
): Promise<void> {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: outPath, fullPage: true });
  await page.close();
}

async function captureFixtures(browser: Awaited<ReturnType<typeof chromium.launch>>): Promise<void> {
  for (const shot of FIXTURE_SHOTS) {
    const url = `file:///${path.join(previewDir, shot.file).replace(/\\/g, '/')}`;
    await captureUrl(browser, url, path.join(outDir, `${shot.name}.png`), shot.width, shot.height);
    console.log(`fixture: ${shot.name}`);
  }
}

async function captureLive(browser: Awaited<ReturnType<typeof chromium.launch>>, server: Server): Promise<void> {
  const addr = server.address();
  if (!addr || typeof addr !== 'object') throw new Error('server not listening');
  const base = `http://127.0.0.1:${addr.port}`;

  for (const shot of LIVE_SHOTS) {
    if (shot.setup) await shot.setup(base);
    await captureUrl(browser, `${base}${shot.path}`, path.join(outDir, `${shot.name}.png`), shot.width, shot.height);
    console.log(`live: ${shot.name}`);
  }

  for (const tripId of HERO_TRIPS) {
    const slug = tripId.replace(/[^a-z0-9-]+/gi, '-').slice(0, 40);
    await captureUrl(
      browser,
      `${base}/traveller?trip=${encodeURIComponent(tripId)}`,
      path.join(outDir, `live-hero-traveller-${slug}.png`),
      430,
      1400,
    );
    console.log(`live hero traveller: ${slug}`);
  }

  const casesRes = await fetch(`${base}/api/wave/approvals`);
  if (casesRes.ok) {
    const casesBody = (await casesRes.json()) as { pending?: Array<{ caseId: string; tripId: string }> };
    for (const row of casesBody.pending ?? []) {
      if (!HERO_TRIPS.includes(row.tripId)) continue;
      const slug = row.tripId.replace(/[^a-z0-9-]+/gi, '-').slice(0, 40);
      await captureUrl(
        browser,
        `${base}/operator/cases/${encodeURIComponent(row.caseId)}`,
        path.join(outDir, `live-hero-case-${slug}.png`),
        1440,
        2000,
      );
      console.log(`live hero case: ${slug}`);
    }
  }

  const probe = await browser.newPage();
  await probe.goto(`${base}/operator?event=evt-ait-2026`, { waitUntil: 'networkidle' });
  const tripLinks = await probe.$$eval('a[href*="/traveller"]', (els) =>
    els.map((el) => (el as HTMLAnchorElement).href).filter((h) => h.includes('trip=')),
  );
  await probe.close();

  const seen = new Set<string>();
  for (const href of tripLinks.slice(0, 8)) {
    const tripId = new URL(href).searchParams.get('trip');
    if (!tripId || seen.has(tripId)) continue;
    seen.add(tripId);
    const slug = tripId.replace(/[^a-z0-9-]+/gi, '-').slice(0, 40);
    await captureUrl(browser, href, path.join(outDir, `live-traveller-${slug}.png`), 430, 1400);
    console.log(`live traveller: ${slug}`);
  }
}

const live = process.argv.includes('--live');

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });

let server: Server | undefined;
if (live) {
  const config = AppConfigSchema.parse({
    environment: 'demo',
    worldSeedMode: 'programme',
    adapterMode: 'REPLAY',
    sqlitePath: path.join(repoRoot, 'data', 'app.sqlite'),
    fixturesDir: path.join(repoRoot, 'fixtures'),
    providers: { atlas: { env: 'sandbox' }, modelStudio: {}, googleRoutes: {}, nuitee: {} },
  });
  const composed = await composeAppRuntime(config);
  server = createAppServer(config, composed.endpoints);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
}

try {
  await captureFixtures(browser);
  if (live && server) await captureLive(browser, server);
} finally {
  await browser.close();
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
}

const manifest = {
  capturedAt: new Date().toISOString(),
  outDir,
  live,
  fixtures: FIXTURE_SHOTS.map((s) => s.name),
  liveShots: live ? LIVE_SHOTS.map((s) => s.name) : [],
};
await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`Wrote manifest to ${path.join(outDir, 'manifest.json')}`);

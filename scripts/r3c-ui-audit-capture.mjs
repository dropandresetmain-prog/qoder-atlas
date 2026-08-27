/**
 * R3C — recovered vs current UI visual audit capture.
 *
 * Evidence only: boots isolated REPLAY demo, serves docs/recovered_ui,
 * captures seven representative pairs, builds labelled compare images + contact sheet.
 *
 * Run: node --experimental-strip-types scripts/r3c-ui-audit-capture.mjs
 *
 * Does NOT modify product UI. Demo IDs are allowed here (audit tooling).
 */
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import { AppConfigSchema } from '../src/config/config.ts';
import { composeAppRuntime } from '../src/app/compose.ts';
import { createAppServer } from '../src/server/http.ts';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
const OUT = join(repoRoot, 'output', 'r3c-ui-audit');
const RECOVERED_DIR = join(repoRoot, 'docs', 'recovered_ui');
const EVENT = 'evt-ait-2026';
const S3_RESCHEDULE = {
  commitmentId: 'cmt-ait-d1-headline-interview',
  newStartsAt: '2026-10-01T15:30:00+08:00',
  newEndsAt: '2026-10-01T16:00:00+08:00',
};

mkdirSync(OUT, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8',
};

function startStaticServer(rootDir) {
  const server = createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      const rel = urlPath === '/' ? '/index.html' : urlPath;
      const filePath = resolve(rootDir, '.' + rel);
      if (!filePath.startsWith(resolve(rootDir))) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      if (!existsSync(filePath)) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const body = readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream' });
      res.end(body);
    } catch (err) {
      res.writeHead(500);
      res.end(String(err));
    }
  });
  return new Promise((resolveListen) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolveListen({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

async function shot(page, path, { fullPage = true } = {}) {
  await page.waitForTimeout(400);
  await page.screenshot({ path, fullPage });
}

function pngDataUrl(filePath) {
  const buf = readFileSync(filePath);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

async function labelledCompare(browser, recoveredPath, currentPath, outPath, family) {
  const page = await browser.newPage({ viewport: { width: 1480, height: 1100 } });
  const recoveredUrl = pngDataUrl(recoveredPath);
  const currentUrl = pngDataUrl(currentPath);
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { margin: 0; font-family: "Segoe UI", system-ui, sans-serif; background: #1a1d22; color: #f5f6f7; }
  .wrap { display: grid; grid-template-columns: 1fr 1fr; gap: 0; }
  .col { display: flex; flex-direction: column; background: #111; }
  .label {
    flex: none; padding: 10px 14px; font-size: 13px; font-weight: 700; letter-spacing: 0.08em;
    text-transform: uppercase; border-bottom: 1px solid rgba(255,255,255,0.12);
  }
  .label.rec { background: #2F6B47; }
  .label.cur { background: #C2431A; }
  .pane { flex: 1; background: #F2F4F5; display: flex; align-items: flex-start; justify-content: center; overflow: hidden; }
  img { width: 100%; height: auto; display: block; }
  .family { padding: 10px 14px; font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase;
    background: #14171C; border-bottom: 1px solid rgba(255,255,255,0.12); }
</style></head><body>
<div class="family">${family}</div>
<div class="wrap">
  <div class="col"><div class="label rec">RECOVERED REFERENCE</div><div class="pane"><img src="${recoveredUrl}"></div></div>
  <div class="col"><div class="label cur">CURRENT PRODUCT</div><div class="pane"><img src="${currentUrl}"></div></div>
</div>
</body></html>`;
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForFunction(() => {
    const imgs = [...document.images];
    return imgs.length >= 2 && imgs.every((i) => i.complete && i.naturalHeight > 0);
  }, { timeout: 60000 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: outPath, fullPage: true });
  await page.close();
}

async function contactSheet(browser, pairs, outPath) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  const blocks = pairs.map((p) => {
    const url = pngDataUrl(p.compare);
    return `<section><h2>${p.family}</h2><img src="${url}" alt="${p.family}"></section>`;
  }).join('\n');
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { margin: 0; padding: 24px; background: #14171C; color: #F5F6F7;
    font-family: "Segoe UI", system-ui, sans-serif; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  .sub { color: rgba(245,246,247,0.65); margin: 0 0 28px; font-size: 13px; }
  section { margin: 0 0 28px; background: #1c2026; border-radius: 12px; padding: 14px; }
  h2 { margin: 0 0 10px; font-size: 14px; letter-spacing: 0.06em; text-transform: uppercase; color: #E8B95F; }
  img { width: 100%; height: auto; display: block; border-radius: 8px; }
</style></head><body>
<h1>R3C side-by-side contact sheet</h1>
<p class="sub">RECOVERED REFERENCE (green label) | CURRENT PRODUCT (vermilion label) · design comparison only</p>
${blocks}
</body></html>`;
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalHeight > 0), { timeout: 120000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: outPath, fullPage: true });
  await page.close();
}

const gitSha = (() => {
  try {
    return readFileSync(join(repoRoot, '.git', 'HEAD'), 'utf8').trim();
  } catch {
    return 'unknown';
  }
})();

const manifest = {
  task: 'R3C',
  capturedAt: new Date().toISOString(),
  startingMainSha: 'd0520ba0f95a69e20bdf6cfb5a1e389d5ab4cdf2',
  headRef: gitSha,
  pairs: [],
  steps: [],
};

function record(step, detail = {}) {
  manifest.steps.push({ step, at: new Date().toISOString(), ...detail });
  console.log(`[ok] ${step}`);
}

const demoConfig = AppConfigSchema.parse({
  environment: 'demo',
  worldSeedMode: 'programme',
  adapterMode: 'REPLAY',
  sqlitePath: ':memory:',
  fixturesDir: resolve(repoRoot, 'fixtures'),
  providers: { atlas: { env: 'sandbox' }, modelStudio: {}, googleRoutes: {}, nuitee: {} },
});

const composed = await composeAppRuntime(demoConfig);
const appServer = createAppServer(demoConfig, composed.endpoints);
await new Promise((done) => appServer.listen(0, '127.0.0.1', done));
const appPort = appServer.address().port;
const APP = `http://127.0.0.1:${appPort}`;
record('app.boot', { base: APP, sqlite: ':memory:', adapterMode: 'REPLAY' });

const staticSrv = await startStaticServer(RECOVERED_DIR);
record('recovered.static', { base: staticSrv.base });

const browser = await chromium.launch({ headless: true });

async function resetDemo() {
  const res = await fetch(`${APP}/api/demo/reset`, { method: 'POST' });
  if (!res.ok) throw new Error(`reset failed ${res.status}`);
  record('demo.reset');
}

async function captureRecovered(family, htmlFile, viewport) {
  const page = await browser.newPage({ viewport });
  const url = `${staticSrv.base}/${htmlFile}`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  // Ensure CSS applied
  await page.waitForSelector('body', { timeout: 10000 });
  const out = join(OUT, `recovered-${family}.png`);
  await shot(page, out, { fullPage: true });
  await page.close();
  record(`capture.recovered.${family}`, { file: htmlFile, viewport, out });
  return out;
}

async function captureCurrent(family, setup, viewport) {
  const page = await browser.newPage({ viewport });
  const meta = await setup(page);
  const out = join(OUT, `current-${family}.png`);
  await shot(page, out, { fullPage: true });
  await page.close();
  record(`capture.current.${family}`, { ...meta, viewport, out });
  return { out, meta };
}

try {
  await resetDemo();

  // 1 Overview
  const recOverview = await captureRecovered('overview', 'o1-overview.html', { width: 1440, height: 1000 });
  const curOverview = await captureCurrent('overview', async (page) => {
    await page.goto(`${APP}/operator?event=${EVENT}`, { waitUntil: 'networkidle', timeout: 60000 });
    return { route: `/operator?event=${EVENT}`, state: 'populated overview after POST /api/demo/reset' };
  }, { width: 1440, height: 1000 });

  // 2 Programme
  const recProgramme = await captureRecovered('programme', 'p1-programme-healthy.html', { width: 1440, height: 1000 });
  const curProgramme = await captureCurrent('programme', async (page) => {
    await page.goto(`${APP}/programme?event=${EVENT}`, { waitUntil: 'networkidle', timeout: 60000 });
    return { route: `/programme?event=${EVENT}`, state: 'populated programme' };
  }, { width: 1440, height: 1000 });

  // 3 Case — Jordan / S2
  const recCase = await captureRecovered('case', 'c3-case-options.html', { width: 1440, height: 1000 });
  const curCase = await captureCurrent('case', async (page) => {
    await page.goto(`${APP}/operator?event=${EVENT}`, { waitUntil: 'networkidle', timeout: 60000 });
    const row = page.locator('[data-test="case-row-link"], .brow').filter({ hasText: 'Jordan Hale' }).first();
    await row.click();
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-test="primary-action-panel"], .case-grid, .option-card', { timeout: 20000 });
    return {
      route: page.url().replace(APP, ''),
      person: 'Jordan Hale',
      scenario: 'S2',
      state: 'populated entry — click Overview row → case workspace',
    };
  }, { width: 1440, height: 1000 });

  // 4 Decisions
  const recDecisions = await captureRecovered('decisions', 'd1-decisions.html', { width: 1440, height: 1000 });
  const curDecisions = await captureCurrent('decisions', async (page) => {
    await page.goto(`${APP}/decisions?event=${EVENT}`, { waitUntil: 'networkidle', timeout: 60000 });
    return { route: `/decisions?event=${EVENT}`, state: 'populated decisions' };
  }, { width: 1440, height: 1000 });

  // 5 Activity
  const recActivity = await captureRecovered('activity', 'activity.html', { width: 1440, height: 1000 });
  const curActivity = await captureCurrent('activity', async (page) => {
    await page.goto(`${APP}/activity?event=${EVENT}`, { waitUntil: 'networkidle', timeout: 60000 });
    return { route: `/activity?event=${EVENT}`, state: 'populated activity' };
  }, { width: 1440, height: 1000 });

  // 6 Traveller — Jordan mobile-first
  const travViewport = { width: 430, height: 932 };
  const recTraveller = await captureRecovered('traveller', 't4-choice.html', travViewport);
  const curTraveller = await captureCurrent('traveller', async (page) => {
    // Explicit Jordan S2 hero trip — do not scrape ambiguous "Show interaction" links
    const route = '/traveller?trip=trip-trv-evt-ait-2026-ait-draft-09';
    await page.goto(`${APP}${route}`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForSelector('.traveller-shell, .t-hero, .t-card', { timeout: 20000 });
    return {
      route,
      person: 'Jordan Hale',
      scenario: 'S2',
      state: 'populated traveller surface for Jordan hero trip (entry = recovery under way / organiser path)',
    };
  }, travViewport);

  // 7 Programme change — S1→S3 preview (Sarah)
  const recChange = await captureRecovered('programme-change', 'e1-change-preview.html', { width: 1440, height: 1000 });
  const curChange = await captureCurrent('programme-change', async (page) => {
    await resetDemo();
    await page.goto(`${APP}/operator?event=${EVENT}`, { waitUntil: 'networkidle', timeout: 60000 });
    const row = page.locator('[data-test="case-row-link"], .brow').filter({ hasText: 'Sarah Lim' }).first();
    await row.click();
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-test="preview-programme-change-btn"]', { timeout: 20000 });
    await page.locator('[data-test="preview-programme-change-btn"]').click();
    await page.waitForSelector('[data-programme-change-modal]', { timeout: 15000 });
    const modal = page.locator('[data-programme-change-modal]');
    await modal.locator('[name="commitmentId"]').selectOption(S3_RESCHEDULE.commitmentId);
    await modal.locator('[name="changeKind"]').selectOption('RESCHEDULED');
    await modal.locator('[name="newStartsAt"]').fill(S3_RESCHEDULE.newStartsAt);
    await modal.locator('[name="newEndsAt"]').fill(S3_RESCHEDULE.newEndsAt);
    // Preview if button exists (non-mutating)
    const previewBtn = modal.locator('[data-programme-change-preview]');
    if (await previewBtn.count()) {
      page.once('dialog', (d) => d.accept()).catch?.(() => {});
      try {
        page.once('dialog', (d) => d.accept());
      } catch { /* ignore */ }
      await previewBtn.click();
      await page.waitForTimeout(1200);
    }
    return {
      route: page.url().replace(APP, ''),
      person: 'Sarah Lim',
      scenario: 'S1→S3 programme-change preview',
      state: 'opened preview modal from Sarah case; filled S3 reschedule fields; clicked Preview if available',
      commitmentId: S3_RESCHEDULE.commitmentId,
    };
  }, { width: 1440, height: 1000 });

  const families = [
    { family: 'overview', recovered: recOverview, current: curOverview.out, meta: curOverview.meta, recoveredFile: 'o1-overview.html', viewport: '1440x1000' },
    { family: 'programme', recovered: recProgramme, current: curProgramme.out, meta: curProgramme.meta, recoveredFile: 'p1-programme-healthy.html', viewport: '1440x1000' },
    { family: 'case', recovered: recCase, current: curCase.out, meta: curCase.meta, recoveredFile: 'c3-case-options.html', viewport: '1440x1000' },
    { family: 'decisions', recovered: recDecisions, current: curDecisions.out, meta: curDecisions.meta, recoveredFile: 'd1-decisions.html', viewport: '1440x1000' },
    { family: 'activity', recovered: recActivity, current: curActivity.out, meta: curActivity.meta, recoveredFile: 'activity.html', viewport: '1440x1000' },
    { family: 'traveller', recovered: recTraveller, current: curTraveller.out, meta: curTraveller.meta, recoveredFile: 't4-choice.html', viewport: '430x932' },
    { family: 'programme-change', recovered: recChange, current: curChange.out, meta: curChange.meta, recoveredFile: 'e1-change-preview.html', viewport: '1440x1000' },
  ];

  const comparePairs = [];
  for (const f of families) {
    const compare = join(OUT, `compare-${f.family}.png`);
    await labelledCompare(browser, f.recovered, f.current, compare, f.family);
    record(`compare.${f.family}`, { compare });
    comparePairs.push({ family: f.family, compare });
    manifest.pairs.push({
      family: f.family,
      recoveredFile: f.recoveredFile,
      recoveredPng: `recovered-${f.family}.png`,
      currentPng: `current-${f.family}.png`,
      comparePng: `compare-${f.family}.png`,
      viewport: f.viewport,
      current: f.meta,
    });
  }

  const contactPath = join(OUT, 'R3C_SIDE_BY_SIDE_CONTACT_SHEET.png');
  await contactSheet(browser, comparePairs, contactPath);
  record('contact.sheet', { path: contactPath });

  const docsSheet = join(repoRoot, 'docs', 'ui-audit', 'R3C_SIDE_BY_SIDE_CONTACT_SHEET.png');
  copyFileSync(contactPath, docsSheet);
  record('contact.sheet.docs-copy', { path: docsSheet });

  manifest.verdict = 'CAPTURE_COMPLETE';
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('R3C UI AUDIT CAPTURE COMPLETE');
} catch (err) {
  console.error(err);
  manifest.verdict = 'CAPTURE_FAILED';
  manifest.error = String(err?.stack || err);
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((done) => appServer.close(done));
  await new Promise((done) => staticSrv.server.close(done));
  composed.db.close();
}

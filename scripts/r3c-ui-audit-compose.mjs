/**
 * Complete R3C compare/contact sheet from already-captured pair PNGs.
 * Run after r3c-ui-audit-capture.mjs if compare stage failed.
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
const OUT = join(repoRoot, 'output', 'r3c-ui-audit');

const FAMILIES = [
  'overview',
  'programme',
  'case',
  'decisions',
  'activity',
  'traveller',
  'programme-change',
];

function pngDataUrl(filePath) {
  return `data:image/png;base64,${readFileSync(filePath).toString('base64')}`;
}

async function labelledCompare(browser, recoveredPath, currentPath, outPath, family) {
  const page = await browser.newPage({ viewport: { width: 1480, height: 1100 } });
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
  .pane { background: #F2F4F5; }
  img { width: 100%; height: auto; display: block; }
  .family { padding: 10px 14px; font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase;
    background: #14171C; border-bottom: 1px solid rgba(255,255,255,0.12); }
</style></head><body>
<div class="family">${family}</div>
<div class="wrap">
  <div class="col"><div class="label rec">RECOVERED REFERENCE</div><div class="pane"><img src="${pngDataUrl(recoveredPath)}"></div></div>
  <div class="col"><div class="label cur">CURRENT PRODUCT</div><div class="pane"><img src="${pngDataUrl(currentPath)}"></div></div>
</div>
</body></html>`;
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalHeight > 0), { timeout: 60000 });
  await page.screenshot({ path: outPath, fullPage: true });
  await page.close();
  console.log(`[ok] compare.${family}`);
}

const browser = await chromium.launch({ headless: true });
const comparePairs = [];
try {
  for (const family of FAMILIES) {
    const recovered = join(OUT, `recovered-${family}.png`);
    const current = join(OUT, `current-${family}.png`);
    if (!existsSync(recovered) || !existsSync(current)) {
      throw new Error(`missing pair for ${family}`);
    }
    const compare = join(OUT, `compare-${family}.png`);
    await labelledCompare(browser, recovered, current, compare, family);
    comparePairs.push({ family, compare });
  }

  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  const blocks = comparePairs.map((p) =>
    `<section><h2>${p.family}</h2><img src="${pngDataUrl(p.compare)}" alt="${p.family}"></section>`,
  ).join('\n');
  await page.setContent(`<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { margin: 0; padding: 24px; background: #14171C; color: #F5F6F7; font-family: "Segoe UI", system-ui, sans-serif; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  .sub { color: rgba(245,246,247,0.65); margin: 0 0 28px; font-size: 13px; }
  section { margin: 0 0 28px; background: #1c2026; border-radius: 12px; padding: 14px; }
  h2 { margin: 0 0 10px; font-size: 14px; letter-spacing: 0.06em; text-transform: uppercase; color: #E8B95F; }
  img { width: 100%; height: auto; display: block; border-radius: 8px; }
</style></head><body>
<h1>R3C side-by-side contact sheet</h1>
<p class="sub">RECOVERED REFERENCE (green label) | CURRENT PRODUCT (vermilion label) · design comparison only</p>
${blocks}
</body></html>`, { waitUntil: 'load' });
  await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalHeight > 0), { timeout: 120000 });
  const contactPath = join(OUT, 'R3C_SIDE_BY_SIDE_CONTACT_SHEET.png');
  await page.screenshot({ path: contactPath, fullPage: true });
  await page.close();
  copyFileSync(contactPath, join(repoRoot, 'docs', 'ui-audit', 'R3C_SIDE_BY_SIDE_CONTACT_SHEET.png'));
  console.log('[ok] contact.sheet');

  const manifestPath = join(OUT, 'manifest.json');
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
  manifest.verdict = 'CAPTURE_COMPLETE';
  manifest.compareCompletedAt = new Date().toISOString();
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log('R3C COMPARE COMPLETE');
} finally {
  await browser.close();
}

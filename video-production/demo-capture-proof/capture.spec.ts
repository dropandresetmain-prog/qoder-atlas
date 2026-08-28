import {mkdir, rename, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';

const baseUrl = 'https://qoder-atlas-production.up.railway.app';
const outputDir = path.resolve('video-production/demo-capture-proof/output');
const rawVideoDir = path.join(outputDir, 'raw');
const proofPath = path.join(outputDir, 'playwright-proof.webm');

await mkdir(rawVideoDir, {recursive: true});

const browser = await chromium.launch({headless: true});
const context = await browser.newContext({
  viewport: {width: 1920, height: 1080},
  screen: {width: 1920, height: 1080},
  recordVideo: {dir: rawVideoDir, size: {width: 1920, height: 1080}},
});
const page = await context.newPage();
const video = page.video();

await page.goto(baseUrl, {waitUntil: 'domcontentloaded'});
await page.waitForFunction(() => document.fonts.status === 'loaded');
await page.getByRole('heading', {name: 'Operations overview'}).waitFor();
await page.waitForTimeout(1600);
await page.getByRole('link', {name: /Open case for Arjun Rao/}).first().click();
await page.getByRole('heading', {name: /Arjun Rao/}).waitFor();
await page.waitForTimeout(1800);
const checks = page.getByRole('region', {name: 'What we checked'});
await checks.scrollIntoViewIfNeeded();
await page.waitForTimeout(1200);
await page.mouse.wheel(0, 420);
await page.waitForTimeout(1500);
await page.screenshot({path: path.join(outputDir, 'inspection-final.png')});
await context.close();
await browser.close();

if (!video) throw new Error('Playwright did not attach a video recorder to the page.');
await rm(proofPath, {force: true});
await rename(await video.path(), proofPath);
await writeFile(path.join(outputDir, 'capture-report.json'), JSON.stringify({
  baseUrl, viewport: '1920x1080', recordVideo: '1920x1080',
  sequence: ['Open operations overview and wait for stable content', 'Open Arjun Rao read-only case', 'Pause on journey chain and commitment facts', 'Scroll to deterministic viability checks'],
}, null, 2));
console.log(`Recorded ${proofPath}`);

/// <reference lib="dom" />
/**
 * R4-F1 (C) — the V7.2 Event Overview graph must never intercept clicks meant
 * for the page: the sticky shell header (nav, Reset demo), the graph's own
 * toolbar, and the `Apply simulated airline update` control below it.
 *
 * Real Chromium, real shell + overview renderer, no database. For every scroll
 * position (so the graph passes UNDER the sticky header, the original defect)
 * and in both collapsed and expanded graph states, `elementFromPoint` at the
 * centre of each visible control must be the control or one of its descendants.
 * Skipped (not failed) only when no Chromium binary can be launched.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { projectOperatorOverview } from '../src/app/target/readmodels/projectOperatorOverview.ts';
import { renderProductOperatorOverview } from '../src/ui/screens/product-operator-overview.ts';
import { renderInShell } from '../src/app/target/productShell.ts';
import type { OperatorOverviewFacts, OperatorPopulationFact } from '../src/app/target/readmodels/types.ts';

function pop(n: number, status: OperatorPopulationFact['status'] = 'READY'): OperatorPopulationFact {
  const id = String(n).padStart(3, '0');
  return {
    journeyRef: `JOURNEY:${id}`, tripRef: `TRIP:${id}`, travellerLabel: `Traveller ${id}`, obligation: 'REQUIRED',
    status, remainderViability: status === 'READY' ? 'VIABLE' : 'NOT_VIABLE', evaluation: 'CURRENT',
  };
}

function pageHtml(): string {
  const items = [];
  for (let d = 1; d <= 3; d++) for (let k = 1; k <= 4; k++) {
    items.push({ itemRef: `PROGRAMME_ITEM:${d}${k}`, title: `Session ${d}${k}`, localDate: `2031-03-1${d}`, localTime: `0${8 + k}:00`, windowStart: `2031-03-1${d}T0${8 + k}:00:00Z` });
  }
  const journeys = Array.from({ length: 30 }, (_, i) => i + 1);
  const facts: OperatorOverviewFacts = {
    generatedAt: '2031-03-10T08:00:00.000Z', projectionRevision: 1, changedVisibleRefs: [], changedEdgeIds: [],
    currentSemanticState: 'AFFECTED', nodes: [], edges: [],
    items: [{
      tripRef: 'TRIP:002', travellerLabel: 'Traveller 002', status: 'DISRUPTED', remainderViability: 'NOT_VIABLE', caseRef: 'CASE:one',
      affectedPeople: [], affectedItems: [], decisionRequired: true, unresolvedUncertainty: [],
    }],
    population: journeys.map((j) => pop(j, j === 2 ? 'DISRUPTED' : 'READY')),
    eventOverviewSource: {
      programmeItems: items,
      participations: journeys.flatMap((j) => [
        { itemRef: `PROGRAMME_ITEM:${(j % 3) + 1}1`, journeyRef: `JOURNEY:${String(j).padStart(3, '0')}`, obligation: 'REQUIRED' as const },
        { itemRef: `PROGRAMME_ITEM:${(j % 3) + 1}2`, journeyRef: `JOURNEY:${String(j).padStart(3, '0')}`, obligation: 'REQUIRED' as const },
      ]),
      journeyServices: journeys.map((j) => ({
        journeyRef: `JOURNEY:${String(j).padStart(3, '0')}`, serviceRef: `SERVICE:${j % 2 ? 'A' : 'B'}`, mode: 'AIR' as const,
        operator: `Carrier ${j % 2 ? 'A' : 'B'}`, arrivalLocalDate: '2031-03-11', arrivalLocalTime: j % 2 ? '07:25' : '10:40',
        publishedArrivalLocalTime: '07:25', changed: j % 2 === 0,
      })),
    },
  };
  const view = { ...projectOperatorOverview(facts), demoIngress: { airlineRebookingConfigured: true } };
  return renderInShell('dashboard', 'Operations overview', { eventName: 'Test event', decisionCount: 1, resetDemo: true }, renderProductOperatorOverview(view as never));
}

let server: Server;
let browser: Browser | undefined;
let baseUrl = '';
let skipReason: string | undefined;

test.before(async () => {
  const html = pageHtml();
  server = createServer((_req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(html); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  baseUrl = `http://127.0.0.1:${addr.port}/`;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      ...(process.env['PLAYWRIGHT_CHROMIUM_PATH']
        ? { executablePath: process.env['PLAYWRIGHT_CHROMIUM_PATH'] }
        : existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {}),
    });
  } catch (err) {
    skipReason = `Chromium unavailable: ${(err as Error).message.split('\n')[0]}`;
  }
});

test.after(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

const CONTROLS = [
  '[data-test="simulated-airline-update-apply"]',
  '[data-test="simulated-airline-update"] > summary',
  '[data-action="reset-demo"]',
  'header nav a',
  '.og-toolbar button',
  '.og-seg button',
];

/** Blocked controls at the current scroll position (visible ones only). */
async function blockedControls(page: Page): Promise<string[]> {
  return page.evaluate((selectors: string[]) => {
    const blocked: string[] = [];
    for (const selector of selectors) {
      for (const el of Array.from(document.querySelectorAll(selector))) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) continue;
        const hit = document.elementFromPoint(cx, cy);
        if (hit === el || el.contains(hit)) continue;
        // A control legitimately covered by the sticky header it scrolled under is not a defect.
        if (selector !== 'header nav a' && selector !== '[data-action="reset-demo"]' && hit?.closest('header')) continue;
        const hitDesc = hit ? `${hit.tagName.toLowerCase()}.${(hit.getAttribute('class') ?? '').split(' ')[0]}` : 'nothing';
        blocked.push(`${selector} "${(el.textContent ?? '').trim().slice(0, 24)}" @${Math.round(cx)},${Math.round(cy)} covered by ${hitDesc}`);
      }
    }
    return blocked;
  }, CONTROLS);
}

async function sweep(page: Page): Promise<string[]> {
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  const problems: string[] = [];
  for (let y = 0; y <= total; y += 90) {
    await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y);
    for (const p of await blockedControls(page)) problems.push(`scrollY=${y}: ${p}`);
  }
  return problems;
}

async function activeDependencyCardsAreReachable(page: Page): Promise<void> {
  const cards = page.locator('.og-node.og-dependency:not(.og-dim)');
  assert.ok(await cards.count() > 0, 'the active shared dependency is rendered');
  const ids = await cards.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-og-node')));
  for (const id of ids) {
    assert.ok(id, 'dependency card has an identity');
    const blockedBy = await page.locator(`[data-og-node="${id}"]`).evaluate((card) => {
      const rect = card.getBoundingClientRect();
      const viewport = card.closest('.og-viewport')!.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(centerX, centerY);
      if (centerX < viewport.left || centerX > viewport.right || centerY < viewport.top || centerY > viewport.bottom) {
        return 'outside the graph viewport';
      }
      return hit === card || card.contains(hit) ? null : hit?.className || hit?.tagName || 'nothing';
    });
    assert.equal(blockedBy, null, `active shared dependency ${id} is visible and receives its own click`);
    await page.locator(`[data-og-node="${id}"]`).click({ timeout: 3000 });
    assert.equal(
      await page.locator('[data-og-inspector]').evaluate((inspector) => (inspector as HTMLElement).hidden),
      false,
      'selecting a dependency reveals its supplied description',
    );
  }
}

for (const mode of ['collapsed', 'expanded'] as const) {
  test(`overview controls stay clickable at every scroll position (${mode} graph)`, async (t) => {
    if (skipReason || !browser) { t.skip(skipReason ?? 'no browser'); return; }
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    try {
      await page.goto(baseUrl);
      await page.addStyleTag({ content: 'html{scroll-behavior:auto!important}' });
      await page.evaluate(() => { (document.querySelector('[data-test="simulated-airline-update"]') as HTMLDetailsElement).open = true; });
      assert.ok(await page.locator('.og-viewport').count() > 0, 'event overview graph rendered');
      if (mode === 'expanded') await page.locator('.og-toolbar button[aria-label="Expand graph"]').click();
      const problems = await sweep(page);
      assert.deepEqual(problems, [], problems.slice(0, 8).join('\n'));
    } finally {
      await page.close();
    }
  });
}

for (const [name, viewport, expand] of [
  ['default desktop', { width: 1440, height: 1000 }, false],
  ['expanded desktop', { width: 1440, height: 1000 }, true],
  ['expanded mobile', { width: 390, height: 844 }, true],
] as const) {
  test(`active shared dependency cards are visible and selectable (${name})`, async (t) => {
    if (skipReason || !browser) { t.skip(skipReason ?? 'no browser'); return; }
    const page = await browser.newPage({ viewport });
    try {
      await page.goto(baseUrl);
      if (expand) await page.locator('.og-toolbar button[aria-label="Expand graph"]').click();
      await activeDependencyCardsAreReachable(page);
    } finally {
      await page.close();
    }
  });
}

test('Apply and Reset actually receive a real click (not just hit-test)', async (t) => {
  if (skipReason || !browser) { t.skip(skipReason ?? 'no browser'); return; }
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  try {
    await page.goto(baseUrl);
    await page.evaluate(() => {
      (document.querySelector('[data-test="simulated-airline-update"]') as HTMLDetailsElement).open = true;
      const seen: string[] = [];
      (window as unknown as { __clicks: string[] }).__clicks = seen;
      document.addEventListener('click', (e) => {
        const target = (e.target as Element).closest('button,a,summary');
        seen.push(target?.getAttribute('data-test') ?? target?.getAttribute('data-action') ?? target?.tagName ?? 'none');
        e.preventDefault();
      }, true);
    });
    // Scroll so the graph sits under the sticky header, then click the header controls.
    await page.evaluate(() => { const vp = document.querySelector('.og-viewport')!; window.scrollBy(0, vp.getBoundingClientRect().top - 10); });
    await page.locator('[data-action="reset-demo"]').click({ timeout: 3000 });
    await page.locator('header nav a', { hasText: 'Programme' }).click({ timeout: 3000 });
    await page.locator('[data-test="simulated-airline-update-apply"]').click({ timeout: 3000 });
    const seen = await page.evaluate(() => (window as unknown as { __clicks: string[] }).__clicks);
    assert.deepEqual(seen, ['reset-demo-btn', 'A', 'simulated-airline-update-apply']);
  } finally {
    await page.close();
  }
});

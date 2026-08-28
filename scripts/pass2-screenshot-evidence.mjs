/**
 * Pass 2 local screenshot evidence — populated demo heroes.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { AppConfigSchema } from '../src/config/config.ts';
import { composeAppRuntime } from '../src/app/compose.ts';
import { createAppServer } from '../src/server/http.ts';
import { runPopulatedDemoWorld } from '../src/app/demoWorld.ts';

const OUT = resolve('output/pass2-screenshots');
mkdirSync(OUT, { recursive: true });

const config = AppConfigSchema.parse({
  environment: 'demo',
  worldSeedMode: 'programme',
  adapterMode: 'REPLAY',
  sqlitePath: ':memory:',
  fixturesDir: resolve('fixtures'),
  providers: { atlas: { env: 'sandbox' }, modelStudio: {}, googleRoutes: {}, nuitee: {} },
});

const composed = await composeAppRuntime(config);
const server = createAppServer(config, composed.endpoints);
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;
const BASE = `http://127.0.0.1:${port}`;

const world = await runPopulatedDemoWorld({ baseUrl: BASE, config, enforceAssertions: false });
if (!world.ok) throw new Error(world.error ?? 'populated world failed');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

async function shot(name, url = `${BASE}/operator?event=evt-ait-2026`) {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log(`shot ${name}`);
}

await shot('01-overview');
for (const hero of ['Jordan', 'Sarah', 'Jonas', 'Oliver']) {
  await page.goto(`${BASE}/operator?event=evt-ait-2026`);
  await page.waitForLoadState('networkidle');
  const search = page.locator('[data-test="roster-search"]');
  if (await search.count()) await search.fill(hero);
  await page.locator('[data-test="case-row-link"], .brow').filter({ hasText: new RegExp(hero, 'i') }).first().click();
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${OUT}/case-${hero.toLowerCase()}.png`, fullPage: true });
  console.log(`shot case-${hero.toLowerCase()}`);
}

await browser.close();
server.close();
console.log('screenshots in', OUT);

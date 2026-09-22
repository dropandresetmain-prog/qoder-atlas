/**
 * A5.1 — Demo Console top-bar popover, real Chromium / no database.
 *
 * Renders the actual shell (`renderInShell` + `page.ts` +
 * `demoConsolePopover.ts`) with `demoConsole: true`, serves it from a bare
 * http server, and stubs `/api/v2/demo/*` with `page.route` so the test
 * proves the CLIENT behaviour (popover, delay, countdown, single-flight,
 * cancel, preflight/reset wiring) without a Postgres dependency. The
 * backend endpoints themselves are unchanged and already covered by
 * `postgres-integration/a5DemoConsole.pgtest.ts`.
 *
 * Uses Playwright's virtual clock (`page.clock`) instead of real waits.
 * Skipped (not failed) when no Chromium binary can be launched.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { chromium, type Browser, type Page, type Route } from 'playwright';
import { renderInShell } from '../../src/app/target/productShell.ts';

function pageHtml(): string {
  return renderInShell(
    'dashboard',
    'Operations overview',
    { eventName: 'Test event', decisionCount: 0, demoConsole: true },
    '<main class="shell" data-test="product-operator-overview"><h1>Overview</h1></main>',
  );
}

const CONTROLS_FIXTURE = {
  workspaceId: 'ws-1',
  evaluationClock: { mode: 'WALL', now: '2026-09-22T00:00:00.000Z' },
  controls: [
    {
      id: 'airline-disruption-configured',
      kind: 'PROVIDER_EVENT',
      variant: 'CONFIGURED_AIRLINE_REBOOKING',
      group: 'Configured provider event',
      label: 'Trigger configured airline disruption',
      description: 'Applies the configured disclosed airline event.',
      order: 10,
    },
    {
      id: 'delay_begins_connection_viable',
      kind: 'PROVIDER_EVENT',
      variant: 'TIMELINE_PROVIDER_STAGE',
      stageId: 'delay_begins_connection_viable',
      group: 'Progressive delay',
      label: 'Delay begins — connection still viable',
      description: 'Provider-event stage.',
      order: 20,
    },
    {
      id: 'overnight_narita_necessary',
      kind: 'EVALUATION_CLOCK_ADVANCE',
      variant: 'TIMELINE_CLOCK_STAGE',
      stageId: 'overnight_narita_necessary',
      group: 'Progressive delay',
      label: 'Overnight in Narita becomes necessary',
      description: 'Clock advance stage.',
      order: 30,
    },
  ],
};

let server: Server;
let browser: Browser | undefined;
let baseUrl = '';
let skipReason: string | undefined;

test.before(async () => {
  const html = pageHtml();
  server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(html);
  });
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

interface RequestLog {
  apply: string[];
  preflight: number;
  reset: number;
}

async function withPage(
  t: { skip: (reason?: string) => void },
  run: (page: Page, log: RequestLog) => Promise<void>,
): Promise<void> {
  if (skipReason || !browser) { t.skip(skipReason ?? 'no browser'); return; }
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const log: RequestLog = { apply: [], preflight: 0, reset: 0 };
  try {
    await page.route('**/api/v2/demo/controls', (route: Route) => {
      void route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CONTROLS_FIXTURE) });
    });
    await page.route('**/api/v2/demo/controls/*/apply', (route: Route) => {
      const id = decodeURIComponent(route.request().url().split('/').slice(-2)[0] ?? '');
      log.apply.push(id);
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, controlId: id, kind: 'PROVIDER_EVENT', detail: 'Applied.', evaluationClock: { mode: 'WALL', now: '2026-09-22T00:00:05.000Z' } }),
      });
    });
    await page.route('**/api/v2/demo/preflight', (route: Route) => {
      log.preflight += 1;
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, summary: { requiredFailed: [], advisoryFailed: [] } }),
      });
    });
    await page.route('**/api/v2/demo/reset', (route: Route) => {
      log.reset += 1;
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, evaluationClock: { mode: 'WALL', now: '2026-09-22T00:00:00.000Z' } }),
      });
    });
    await page.route('**/operator', (route: Route) => {
      void route.fulfill({ status: 200, contentType: 'text/html', body: '<main>Overview</main>' });
    });
    // Paused virtual clock: setInterval/setTimeout only advance when the
    // test explicitly runs the clock forward — no real 5s waits.
    await page.clock.install();
    await page.clock.pauseAt(Date.now());
    await page.goto(baseUrl);
    await run(page, log);
  } finally {
    await page.close();
  }
}

test('Demo Console is a button (never an <a href="/demo/control">) and clicking it does not navigate', async (t) => {
  await withPage(t, async (page) => {
    const toggle = page.locator('[data-test="demo-console-toggle"]');
    assert.equal(await toggle.evaluate((el) => el.tagName), 'BUTTON');
    assert.equal(await page.locator('a[href="/demo/control"]').count(), 0, 'the faint link no longer navigates to the standalone page');
    await toggle.click();
    assert.equal(page.url(), baseUrl);
  });
});

test('clicking Demo Console opens an anchored popover without leaving Overview', async (t) => {
  await withPage(t, async (page) => {
    await page.locator('[data-test="demo-console-toggle"]').click();
    await assert.doesNotReject(page.locator('[data-test="demo-console-pop"]').waitFor({ state: 'visible', timeout: 2000 }));
    assert.ok(await page.locator('[data-test="product-operator-overview"]').isVisible(), 'the Overview page is still the one on screen');
  });
});

test('configured controls render from the existing GET /api/v2/demo/controls data (no hardcoding)', async (t) => {
  await withPage(t, async (page) => {
    await page.locator('[data-test="demo-console-toggle"]').click();
    await page.locator('[data-test="demo-console-pop-trigger-airline-disruption-configured"]').waitFor({ state: 'visible' });
    assert.equal(
      (await page.locator('[data-test="demo-console-pop-trigger-airline-disruption-configured"]').textContent())?.trim(),
      'Trigger configured airline disruption',
    );
    assert.equal(await page.locator('[data-test="demo-console-pop-group"][data-group="Progressive delay"] [data-demo-console="trigger"]').count(), 2);
  });
});

test('trigger delay: no request until the selected delay elapses, then exactly one fires; popover closes and a countdown shows', async (t) => {
  await withPage(t, async (page, log) => {
    await page.locator('[data-test="demo-console-toggle"]').click();
    await page.locator('[data-test="demo-console-pop-trigger-delay_begins_connection_viable"]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('input[name="dc-delay"]:checked').getAttribute('value'), '5', 'default delay is 5s');
    await page.locator('[data-test="demo-console-pop-trigger-delay_begins_connection_viable"]').click();

    await assert.doesNotReject(page.locator('[data-test="demo-console-pop"]').waitFor({ state: 'hidden', timeout: 2000 }), 'popover auto-closes when the delayed trigger begins');
    assert.deepEqual(log.apply, []);
    assert.equal(await page.locator('[data-test="demo-console-overlay"]').isHidden(), false);
    assert.match((await page.locator('[data-test="demo-console-overlay"]').innerText()), /in 5/);

    await page.clock.runFor(4000);
    assert.deepEqual(log.apply, [], 'still counting down at 4s of a 5s delay — no request yet');

    await page.clock.runFor(1500);
    await page.locator('[data-test="demo-console-overlay"]').getByText(/Applied\.|Triggering/).waitFor({ timeout: 2000 });
    assert.deepEqual(log.apply, ['delay_begins_connection_viable'], 'exactly one apply request fired');

    await page.clock.runFor(1000);
    assert.deepEqual(log.apply, ['delay_begins_connection_viable'], 'no duplicate request after the fact');
  });
});

test('Off delay fires immediately (still through the countdown/overlay plumbing, no special-casing)', async (t) => {
  await withPage(t, async (page, log) => {
    await page.locator('[data-test="demo-console-toggle"]').click();
    await page.locator('input[name="dc-delay"][value="off"]').check();
    await page.locator('[data-test="demo-console-pop-trigger-airline-disruption-configured"]').click();
    await page.waitForFunction(
      () => document.querySelector('[data-test="demo-console-overlay"]')?.textContent?.includes('Triggering')
        || document.querySelector('[data-test="demo-console-overlay"]')?.textContent?.includes('Applied'),
      { timeout: 2000 },
    );
    assert.deepEqual(log.apply, ['airline-disruption-configured']);
  });
});

test('Cancel during the countdown sends no request and clears the overlay', async (t) => {
  await withPage(t, async (page, log) => {
    await page.locator('[data-test="demo-console-toggle"]').click();
    await page.locator('[data-test="demo-console-pop-trigger-overnight_narita_necessary"]').click();
    await page.locator('[data-test="demo-console-overlay-cancel"]').waitFor({ state: 'visible' });
    await page.locator('[data-test="demo-console-overlay-cancel"]').click();
    assert.equal(await page.locator('[data-test="demo-console-overlay"]').isHidden(), true);

    await page.clock.runFor(10_000);
    assert.deepEqual(log.apply, [], 'cancelling sent no request even after the original delay would have elapsed');

    // Controls are usable again immediately after cancelling.
    await page.locator('[data-test="demo-console-toggle"]').click();
    assert.equal(await page.locator('[data-test="demo-console-pop-trigger-overnight_narita_necessary"]').isDisabled(), false);
  });
});

test('a second trigger cannot be queued while one is counting down', async (t) => {
  await withPage(t, async (page, log) => {
    await page.locator('[data-test="demo-console-toggle"]').click();
    await page.locator('[data-test="demo-console-pop-trigger-airline-disruption-configured"]').click();

    // Reopen the popover mid-countdown: every trigger button must be disabled.
    await page.locator('[data-test="demo-console-toggle"]').click();
    await page.locator('[data-test="demo-console-pop-trigger-delay_begins_connection_viable"]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-test="demo-console-pop-trigger-delay_begins_connection_viable"]').isDisabled(), true);
    assert.equal(await page.locator('[data-test="demo-console-pop-trigger-airline-disruption-configured"]').isDisabled(), true);
    // A disabled button ignores clicks; force a click anyway to prove no second control gets queued.
    await page.locator('[data-test="demo-console-pop-trigger-delay_begins_connection_viable"]').click({ force: true });

    await page.clock.runFor(6000);
    assert.deepEqual(log.apply, ['airline-disruption-configured'], 'only the first, originally-queued control ever applied');
  });
});

test('Preflight in the popover still calls POST /api/v2/demo/preflight', async (t) => {
  await withPage(t, async (page, log) => {
    await page.locator('[data-test="demo-console-toggle"]').click();
    await page.locator('[data-test="demo-console-pop-preflight-btn"]').click();
    await page.locator('[data-demo-console-status="preflight"]', { hasText: 'PASS' }).waitFor({ timeout: 2000 });
    assert.equal(log.preflight, 1);
  });
});

test('Reset Demo in the popover still calls POST /api/v2/demo/reset, with a confirmation prompt', async (t) => {
  await withPage(t, async (page, log) => {
    let dialogMessage = '';
    page.once('dialog', async (dialog) => { dialogMessage = dialog.message(); await dialog.accept(); });
    await page.locator('[data-test="demo-console-toggle"]').click();
    await page.locator('[data-test="demo-console-pop-reset-btn"]').click();
    await page.waitForFunction(() => window.location.pathname === '/operator', { timeout: 5000 });
    assert.match(dialogMessage, /reset/i);
    assert.equal(log.reset, 1);
  });
});

test('Reset Demo confirmation declined sends no request', async (t) => {
  await withPage(t, async (page, log) => {
    page.once('dialog', async (dialog) => { await dialog.dismiss(); });
    await page.locator('[data-test="demo-console-toggle"]').click();
    await page.locator('[data-test="demo-console-pop-reset-btn"]').click();
    await page.waitForTimeout(50);
    assert.equal(log.reset, 0);
  });
});

test('the standalone /demo/control fallback link is gone from the top bar, but the toggle exposes the same capabilities', async (t) => {
  await withPage(t, async (page) => {
    assert.equal(await page.locator('[data-test="demo-console-link"]').count(), 0);
    assert.equal(await page.locator('[data-test="reset-demo"]').count(), 0, 'the separate top-bar Reset Demo pill is gone');
    await page.locator('[data-test="demo-console-toggle"]').click();
    assert.equal(await page.locator('[data-test="demo-console-pop-reset-btn"]').count(), 1, 'Reset Demo now lives in the popover');
    assert.equal(await page.locator('[data-test="demo-console-pop-preflight-btn"]').count(), 1);
  });
});

test('survives the shell runtime region-patching the topbar (e.g. after a decision-count change): the toggle still opens the popover and controls still load', async (t) => {
  await withPage(t, async (page, log) => {
    // Prove the widget is *usable* first (matches production sequence: apply
    // -> a poll patches shell-topbar because content changed elsewhere).
    await page.locator('[data-test="demo-console-toggle"]').click();
    await page.locator('[data-test="demo-console-pop-trigger-airline-disruption-configured"]').waitFor({ state: 'visible' });
    await page.locator('[data-test="demo-console-toggle"]').click(); // close

    // Simulate the shell runtime's replaceRegion() swapping the whole
    // shell-topbar DOM for a byte-identical clone (same as a real poll that
    // finds the region's server-rendered HTML unchanged in shape but a new
    // node instance) -- this is what silently orphaned a cached toggle/pop/
    // overlay reference before the fix.
    await page.evaluate(() => {
      const live = document.querySelector('[data-poll-region="shell-topbar"]');
      if (!live) throw new Error('shell-topbar region not found');
      const clone = live.cloneNode(true) as HTMLElement;
      live.replaceWith(clone);
    });

    const toggleAfterPatch = page.locator('[data-test="demo-console-toggle"]');
    assert.equal(await toggleAfterPatch.count(), 1, 'toggle still present after the region patch');
    await toggleAfterPatch.click();
    await assert.doesNotReject(
      page.locator('[data-test="demo-console-pop"]').waitFor({ state: 'visible', timeout: 2000 }),
      'popover still opens on the patched toggle',
    );
    // The fresh (cloned) popover has no data-dc-loaded marker, so it must
    // refetch rather than staying stuck on stale/empty content.
    await page.locator('[data-test="demo-console-pop-trigger-airline-disruption-configured"]').waitFor({ state: 'visible', timeout: 2000 });

    await page.locator('[data-test="demo-console-pop-trigger-airline-disruption-configured"]').click();
    await page.clock.runFor(5500);
    await page.locator('[data-test="demo-console-overlay"]').getByText(/Applied\.|Triggering/).waitFor({ timeout: 2000 });
    assert.deepEqual(log.apply, ['airline-disruption-configured'], 'the trigger reached the backend even through the patched DOM');
  });
});

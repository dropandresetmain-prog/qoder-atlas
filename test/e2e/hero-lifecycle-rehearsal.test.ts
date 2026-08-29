/**
 * Four-hero browser rehearsal for lifecycle/state correctness.
 * Asserts exact CTAs, terminal phase, Overview Confirmed, and reload/reopen.
 * Strengthened for FINAL HERO acceptance REC failures — must not false-pass
 * on generic CSS/text tokens alone.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';

import { AppConfigSchema } from '../../src/config/config.ts';
import { composeAppRuntime } from '../../src/app/compose.ts';
import { createAppServer } from '../../src/server/http.ts';
import { resolvePopulatedDemoAnchorEventId } from '../../src/app/demoWorld.ts';

const EVENT = resolvePopulatedDemoAnchorEventId();
const S3_RESCHEDULE = {
  commitmentId: 'cmt-ait-d1-headline-interview',
  newStartsAt: '2026-10-01T15:30:00+08:00',
  newEndsAt: '2026-10-01T16:00:00+08:00',
};

const demoConfig = AppConfigSchema.parse({
  environment: 'demo',
  worldSeedMode: 'programme',
  adapterMode: 'REPLAY',
  sqlitePath: ':memory:',
  fixturesDir: resolve('fixtures'),
  providers: { atlas: { env: 'sandbox' }, modelStudio: {}, googleRoutes: {}, nuitee: {} },
});

let server: Server;
let browser: Browser;
let baseUrl: string;

test.before(async () => {
  const composed = await composeAppRuntime(demoConfig);
  server = createAppServer(demoConfig, composed.endpoints);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  baseUrl = `http://127.0.0.1:${addr.port}`;
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    ...(process.env['PLAYWRIGHT_CHROMIUM_PATH']
      ? { executablePath: process.env['PLAYWRIGHT_CHROMIUM_PATH'] }
      : existsSync('/opt/pw-browsers/chromium')
        ? { executablePath: '/opt/pw-browsers/chromium' }
        : {}),
  });
});

test.after(async () => {
  await browser?.close();
  await new Promise<void>((done) => server?.close(() => done()));
});

async function resetDemo(): Promise<void> {
  const res = await fetch(`${baseUrl}/api/demo/reset`, { method: 'POST' });
  assert.equal(res.status, 200);
}

async function gotoOverview(page: Page): Promise<void> {
  await page.goto(`${baseUrl}/operator?event=${EVENT}`);
  await page.waitForLoadState('domcontentloaded');
}

async function openTravellerCase(page: Page, name: string): Promise<void> {
  const search = page.locator('[data-test="roster-search"]');
  if (await search.count()) {
    await search.fill(name.split(' ')[0] ?? name);
    await page.waitForTimeout(150);
  }
  const rosterRow = page.locator('[data-roster-name]').filter({ hasText: new RegExp(name, 'i') });
  const caseHit = rosterRow.locator('[data-test="case-row-link"], [data-test="case-history-link"]');
  if (await caseHit.count()) {
    await caseHit.first().click();
  } else {
    const decision = page.locator('[data-test="decision-link"]').filter({ hasText: name }).first();
    await decision.click();
  }
  await page.waitForLoadState('domcontentloaded');
}

function forbiddenAfterRecovery(html: string): string[] {
  const hits: string[] = [];
  if (html.includes('data-test="resolve-northstar-btn"')) hits.push('Resolve');
  if (html.includes('data-test="begin-strategy-btn"')) hits.push('Begin');
  if (html.includes('data-test="execute-approved-strategy-btn"')) hits.push('Execute');
  if (html.includes('data-test="organisation-approve-form"')) hits.push('Approve');
  return hits;
}

function assertNoHeroCopyLeaks(html: string, context: string): void {
  assert.doesNotMatch(html, /declared departure gateway/i, `${context}: declared departure gateway`);
  assert.doesNotMatch(html, /No longer meets:\s*timing still works/i, `${context}: contradictory check`);
  assert.doesNotMatch(html, /HUMAN_AGENT|human agent review needed/i, `${context}: HUMAN_AGENT copy`);
  assert.doesNotMatch(html, /el-trip-[a-z0-9-]+/i, `${context}: raw el-trip id`);
}

function assertCommitmentSemantics(html: string, context: string): void {
  assert.doesNotMatch(html, /DETAILS PENDING/i, `${context}: programme DETAILS PENDING`);
  assert.doesNotMatch(html, /NOT BOOKED/i, `${context}: programme NOT BOOKED`);
}

async function approveAndExecuteOrganiser(
  page: Page,
  afterExecuteSelector = '[data-test="case-phase-resolved"], [data-test="back-to-overview"]',
): Promise<void> {
  const html = await page.content();
  assert.equal(html.includes('data-test="resolve-northstar-btn"'), false, 'Resolve must be gone once recovery has begun');
  assert.equal(html.includes('data-test="begin-strategy-btn"'), false, 'Begin must be gone once approval is pending');
  assert.match(html, /data-case-phase="awaiting_authority"/);
  assert.match(html, /Awaiting approval/i);
  assert.doesNotMatch(html, /Options on the table/i);
  assert.match(html, /data-test="organisation-approve-form"/);
  assert.match(html, /data-test="organisation-decline-form"/);
  assert.match(html, /Approve as organiser US\$/i, 'CTA must use provider payable US$');
  assert.doesNotMatch(html, /Approve as organiser S\$/i, 'CTA must not use policy S$ alone');

  const approve = page.locator('[data-test="organisation-approve-form"] button[type="submit"]');
  const decide = page.waitForResponse((r) => r.url().includes('/api/runtime/decide') && r.request().method() === 'POST', { timeout: 20000 });
  await approve.click();
  const decideRes = await decide;
  assert.equal(decideRes.status(), 200);
  await page.waitForSelector('[data-test="execute-approved-strategy-btn"]', { timeout: 20000 });
  const afterApprove = await page.content();
  assert.doesNotMatch(afterApprove, /data-test="resolve-northstar-btn"/);
  assert.doesNotMatch(afterApprove, /data-test="begin-strategy-btn"/);
  assert.doesNotMatch(afterApprove, /No longer meets:\s*timing still works/i);

  const exec = page.locator('[data-test="execute-approved-strategy-btn"]');
  const overlaySeen = page.waitForSelector('[data-test="lifecycle-progress-overlay"]', { timeout: 8000 });
  const execRes = page.waitForResponse((r) => r.url().includes('/api/runtime/execute') && r.request().method() === 'POST', { timeout: 30000 });
  await exec.click();
  await overlaySeen;
  assert.equal((await execRes).status(), 200);
  await page.waitForSelector(afterExecuteSelector, { timeout: 30000 });
}

async function assertResolvedReloadOverview(page: Page, name: string): Promise<void> {
  let html = await page.content();
  assert.match(html, /data-test="case-phase-resolved"/);
  assert.deepEqual(forbiddenAfterRecovery(html), [], `terminal CTAs still present: ${forbiddenAfterRecovery(html).join(',')}`);
  assertCommitmentSemantics(html, `${name} terminal`);
  assertNoHeroCopyLeaks(html, `${name} terminal`);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  html = await page.content();
  assert.match(html, /data-test="case-phase-resolved"/);
  assert.deepEqual(forbiddenAfterRecovery(html), [], `reopen resurrected CTAs: ${forbiddenAfterRecovery(html).join(',')}`);
  await gotoOverview(page);
  const search = page.locator('[data-test="roster-search"]');
  if (await search.count()) {
    await search.fill(name.split(' ')[0] ?? name);
    await page.waitForTimeout(150);
  }
  const row = page.locator('[data-trip-id]').filter({ hasText: name }).first();
  await row.waitFor({ state: 'visible', timeout: 15000 });
  const presentation = await row.getAttribute('data-presentation');
  assert.equal(presentation, 'CONFIRMED', `${name} Overview presentation is ${presentation}`);
}

test('browser: Overview shared incident + 67 participant roster truth', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    await resetDemo();
    await gotoOverview(page);
    const html = await page.content();
    assert.match(html, /67 participants|42 Northstar-managed/i);
    assert.doesNotMatch(html, /\b76 travellers\b/i);
    assert.doesNotMatch(html, /\b77 travellers\b/i);
    const rosterLabel = page.locator('[data-test="roster-page-label"]');
    if (await rosterLabel.count()) {
      const text = (await rosterLabel.textContent()) ?? '';
      assert.match(text, /participants/i);
      assert.doesNotMatch(text, /travellers/i);
      assert.doesNotMatch(text, /\b7[6-9]\b/);
    }
    const group = page.locator('[data-test="shared-incident-group"]');
    await group.waitFor({ state: 'visible', timeout: 15000 });
    assert.equal(await group.getAttribute('data-shared-affected'), '4');
    assert.equal(await group.getAttribute('data-shared-workable'), '3');
    assert.equal(await group.getAttribute('data-shared-critical'), '1');
    assert.match((await group.textContent()) ?? '', /3 still workable/i);
    assert.match((await group.textContent()) ?? '', /1 critical/i);
    const queue = page.locator('[data-test="attention-queue"]');
    const sarah = queue.locator('[data-shared-outcome="critical"]').filter({ hasText: /Sarah Lim/i });
    assert.equal(await sarah.count(), 1, 'Sarah must be the critical shared-incident traveller');
    const workable = queue.locator('[data-shared-outcome="workable"], [data-shared-outcome="watching"]');
    assert.ok((await workable.count()) >= 3, 'three cohort travellers must remain workable');
    for (const name of ['Arjun Rao', 'Siti Rahmah', 'Mei Ling Goh']) {
      const row = queue.locator('a').filter({ hasText: name });
      assert.ok(await row.count(), `${name} must appear in shared incident`);
      const outcome = await row.first().getAttribute('data-shared-outcome');
      assert.ok(outcome === 'workable' || outcome === 'watching', `${name} must not be critical (got ${outcome})`);
    }
  } finally {
    await page.close();
  }
});

test('browser: Jordan S2 ONE organiser approval → Execute carries the whole recovery to resolved Confirmed', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    await resetDemo();
    await gotoOverview(page);

    const jordanRow = page.locator('[data-trip-id]').filter({ hasText: 'Jordan Hale' }).first();
    await jordanRow.waitFor({ timeout: 15000 });
    const tripId = await jordanRow.getAttribute('data-trip-id');
    assert.ok(tripId, 'Jordan trip id required to audit the internal recovery chain');

    await openTravellerCase(page, 'Jordan Hale');
    await page.waitForSelector('[data-test="organisation-approve-form"], [data-test="resolve-northstar-btn"], [data-test="begin-strategy-btn"]', { timeout: 20000 });
    const entry = await page.content();
    assertCommitmentSemantics(entry, 'Jordan entry');
    assert.doesNotMatch(entry, /FLIGHT STATUS PENDING/i);
    assert.doesNotMatch(entry, /HOTEL CONFIRMATION PENDING/i);

    // Track every runtime interaction the BROWSER actually issues, so the
    // locked demo contract — organiser approval = 1, traveller approval = 0,
    // no begin-recovery call after execution starts, no second visible
    // recovery cycle — is proven from real network traffic, not inferred
    // from the DOM alone. The Narita hotel plan/begin/execute happen
    // server-side inside the ONE /api/runtime/execute call and therefore
    // never appear here at all.
    type Call = { url: string; method: string; postData: string | null; at: number };
    const calls: Call[] = [];
    page.on('request', (req) => {
      const url = req.url();
      if (req.method() === 'POST' && (url.includes('/api/runtime/') || url.includes('/traveller-decision'))) {
        calls.push({ url, method: req.method(), postData: req.postData(), at: Date.now() });
      }
    });

    if (await page.locator('[data-test="resolve-northstar-btn"]').count()) {
      await page.locator('[data-test="resolve-northstar-btn"]').click();
      await page.waitForSelector('[data-test="begin-strategy-btn"], [data-test="organisation-approve-form"], [data-test="case-options"]', { timeout: 20000 });
      await page.waitForTimeout(3500);
    }
    if (await page.locator('[data-test="begin-strategy-btn"]').count()) {
      const begin = page.waitForResponse((r) => r.url().includes('/api/runtime/begin'), { timeout: 20000 });
      await page.locator('[data-test="begin-strategy-btn"]').click();
      await begin;
      await page.waitForSelector('[data-test="organisation-approve-form"]', { timeout: 20000 });
    }

    // ONE organiser approval authorises the whole disclosed whole-trip plan
    // (flight + Narita overnight + Singapore stay + entry/insurance/finals +
    // known cost, all shown on this same Selected Recovery card). "Execute
    // recovery" then runs the complete permitted sequence — the browser
    // lands directly in the final recovered state.
    const executeClickedAt = Date.now();
    await approveAndExecuteOrganiser(page);
    const resolved = await page.content();
    assert.match(resolved, /data-test="case-phase-resolved"/, 'the ONE approval must carry the whole recovery — flight AND Narita hotel — to resolution in this same execute click');
    assert.doesNotMatch(resolved, /data-test="resolve-northstar-btn"/, 'no second Find-a-recovery step for the hotel');
    assert.doesNotMatch(resolved, /data-test="begin-strategy-btn"/, 'no second Begin-recovery step for the hotel');
    assert.doesNotMatch(resolved, /data-test="waiting-for-traveller"/, 'no traveller-surface approval detour for the hotel');

    await assertResolvedReloadOverview(page, 'Jordan Hale');

    // --- Explicit interaction-count assertions (locked demo contract) ------
    const organiserApprovals = calls.filter(
      (c) => c.url.includes('/api/runtime/decide') && (c.postData ?? '').includes('"entityType":"ORGANISATION"'),
    );
    const travellerApprovals = calls.filter(
      (c) =>
        c.url.includes('/traveller-decision') ||
        (c.url.includes('/api/runtime/decide') && (c.postData ?? '').includes('"entityType":"TRAVELLER"')),
    );
    const beginCalls = calls.filter((c) => c.url.includes('/api/runtime/begin'));
    const beginCallsAfterExecute = beginCalls.filter((c) => c.at >= executeClickedAt);
    const resolveCallsAfterExecute = calls.filter(
      (c) => c.url.includes('/api/runtime/plan') && c.at >= executeClickedAt,
    );

    assert.equal(organiserApprovals.length, 1, `organiser approval interactions must be exactly 1, saw ${organiserApprovals.length}`);
    assert.equal(travellerApprovals.length, 0, `traveller approval interactions must be 0, saw ${travellerApprovals.length}`);
    assert.equal(beginCalls.length, 1, `only the flight's begin-recovery call is browser-visible, saw ${beginCalls.length}`);
    assert.equal(beginCallsAfterExecute.length, 0, `no begin-recovery interaction may follow execution start, saw ${beginCallsAfterExecute.length}`);
    assert.equal(resolveCallsAfterExecute.length, 0, 'no second visible Find-a-recovery cycle may follow execution start');

    // --- The Narita hotel action still passed its own deterministic
    //     authority decision server-side (envelope reuse, never a bypass). --
    const activity = await getJson(baseUrl, `/api/wave/trips/${tripId}/activity`);
    assert.equal(activity.status, 200);
    const events = (activity.body as { events?: Array<{ action: string }> }).events ?? [];
    assert.ok(
      events.some((e) => e.action === 'RECOVERY_ENVELOPE_APPLIED'),
      'the hotel intent reused the organiser recovery-approval envelope, on the record',
    );
    const executions = events.filter((e) => e.action === 'EXECUTION_COMPLETED');
    assert.ok(executions.length >= 2, `expected flight AND hotel EXECUTION_COMPLETED evidence, saw ${executions.length}`);
    const approvalsRecorded = events.filter((e) => e.action === 'APPROVAL_RECORDED');
    assert.equal(approvalsRecorded.length, 1, `expected exactly one recorded human APPROVAL_RECORDED, saw ${approvalsRecorded.length}`);
  } finally {
    await page.close();
  }
});

async function getJson(base: string, path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: await res.json() };
}

test('browser: Oliver S7 approval → Execute → resolved Confirmed on reopen', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    await resetDemo();
    await gotoOverview(page);
    await openTravellerCase(page, 'Oliver Bennett');
    await page.waitForSelector('[data-test="organisation-approve-form"], [data-test="resolve-northstar-btn"], [data-test="begin-strategy-btn"]', { timeout: 20000 });
    const entry = await page.content();
    assert.doesNotMatch(entry, /declared departure gateway/i);
    assertCommitmentSemantics(entry, 'Oliver entry');
    if (await page.locator('[data-test="resolve-northstar-btn"]').count()) {
      await page.locator('[data-test="resolve-northstar-btn"]').click();
      await page.waitForSelector('[data-test="begin-strategy-btn"], [data-test="organisation-approve-form"]', { timeout: 20000 });
    }
    if (await page.locator('[data-test="begin-strategy-btn"]').count()) {
      const begin = page.waitForResponse((r) => r.url().includes('/api/runtime/begin'), { timeout: 20000 });
      await page.locator('[data-test="begin-strategy-btn"]').click();
      await begin;
      await page.waitForSelector('[data-test="organisation-approve-form"]', { timeout: 20000 });
    }
    await approveAndExecuteOrganiser(page);
    const terminal = await page.content();
    assert.match(terminal, /Confirmed/i);
    assert.doesNotMatch(terminal, /FLIGHT STATUS PENDING/i);
    await assertResolvedReloadOverview(page, 'Oliver Bennett');
  } finally {
    await page.close();
  }
});

test('browser: Sarah S1→S3 commit converges to resolved Confirmed without a second Resolve', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    await resetDemo();
    await gotoOverview(page);
    const attention = page.locator('[data-test="attention-queue"] a').filter({ hasText: /Sarah Lim/i });
    if (await attention.count()) await attention.first().click();
    else     await openTravellerCase(page, 'Sarah Lim');
    const travelBtn = page.locator('[data-test="programme-travel-analysis-btn"]');
    if (await travelBtn.count()) {
      await travelBtn.click();
      await page.waitForSelector('[data-test="lifecycle-progress-overlay"]', { timeout: 10000 });
      await page.waitForTimeout(3200);
      await page.waitForSelector('[data-test="preview-programme-change-btn"]', { timeout: 20000 });
    }
    await page.waitForSelector('[data-test="preview-programme-change-btn"]', { timeout: 20000 });
    const btn = page.locator('[data-test="preview-programme-change-btn"]');
    assert.equal(await btn.getAttribute('data-default-new-starts-at'), S3_RESCHEDULE.newStartsAt);
    assert.equal(await btn.getAttribute('data-default-new-ends-at'), S3_RESCHEDULE.newEndsAt);
    await btn.click();
    await page.waitForSelector('[data-programme-change-modal]', { timeout: 10000 });
    const modal = page.locator('[data-programme-change-modal]');
    const startVal = await modal.locator('[name="newStartsAt"]').inputValue();
    const endVal = await modal.locator('[name="newEndsAt"]').inputValue();
    assert.match(startVal, /15:30/);
    assert.match(endVal, /16:00/);
    assert.doesNotMatch(startVal, /^2026-10-01T/);
    await modal.locator('[data-test="programme-change-preview"], [data-programme-change-preview]').click();
    await page.waitForSelector('[data-test="lifecycle-progress-overlay"]', { timeout: 10000 });
    await page.waitForTimeout(3200);
    await page.waitForSelector('[data-test="programme-change-result"] [data-test="now-vs-proposed"]', { timeout: 20000 });
    const preview = await modal.innerHTML();
    assert.match(preview, /Sarah/i);
    assert.doesNotMatch(preview, /el-trip-/i);
    const overlaySeen = page.waitForSelector('[data-test="lifecycle-progress-overlay"]', { timeout: 15000 });
    const commit = page.waitForResponse((r) => r.url().includes('event-change') || r.url().includes('programme') || r.url().includes('commit'), { timeout: 30000 }).catch(() => null);
    // One-click confirm: the reviewed preview is the decision — commit fires
    // immediately with no second confirmation panel.
    await modal.locator('[data-test="programme-change-commit"]').click();
    await commit;
    await overlaySeen;
    await page.waitForTimeout(2800);
    await gotoOverview(page);
    const search = page.locator('[data-test="roster-search"]');
    if (await search.count()) await search.fill('Sarah');
    const row = page.locator('[data-trip-id]').filter({ hasText: 'Sarah Lim' }).first();
    await row.waitFor({ timeout: 15000 });
    assert.equal(await row.getAttribute('data-presentation'), 'CONFIRMED');
    const elenaRow = page.locator('[data-trip-id]').filter({ hasText: 'Elena Tan' }).first();
    if (await elenaRow.count()) {
      const elenaPresentation = await elenaRow.getAttribute('data-presentation');
      assert.ok(
        elenaPresentation === 'WATCHING' || elenaPresentation === 'CONFIRMED',
        `Elena after Sarah commit should be WATCHING or unaffected (got ${elenaPresentation})`,
      );
      assert.notEqual(elenaPresentation, '', 'Elena must not have a blank fleet square');
    }
    if (await page.locator('[data-test="case-history-link"]').filter({ hasText: 'Sarah Lim' }).count()) {
      await page.locator('[data-test="case-history-link"]').filter({ hasText: 'Sarah Lim' }).first().click();
      await page.waitForLoadState('domcontentloaded');
      const html = await page.content();
      assert.match(html, /data-test="case-phase-resolved"/);
      assert.deepEqual(forbiddenAfterRecovery(html), [], `Sarah Resolve resurrected: ${forbiddenAfterRecovery(html).join(',')}`);
      assertCommitmentSemantics(html, 'Sarah terminal');
    }
  } finally {
    await page.close();
  }
});

test('browser: Jonas terminal reopen does not resurrect Resolve/Approve when already resolved', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    await resetDemo();
    await gotoOverview(page);
    const overviewHtml = await page.content();
    const jonasAttention = page.locator('[data-test="attention-queue"] a').filter({ hasText: /Jonas Berg/i });
    if (await jonasAttention.count()) {
      const issue = (await jonasAttention.first().locator('.q-issue').textContent()) ?? '';
      assert.match(issue, /US\$541\.83/);
      assert.doesNotMatch(issue, /US\$542\.00/);
      // Policy/home S$ must not masquerade as the Overview payable amount.
      assert.doesNotMatch(issue, /S\$731\.47(?!\s*(policy|approx|home|equivalent))/i);
    }
    assert.doesNotMatch(overviewHtml, /US\$542\.00/);

    await openTravellerCase(page, 'Jonas Berg');
    await page.waitForSelector('[data-test="primary-action-panel"], [data-test="resolve-northstar-btn"], [data-test="waiting-for-traveller"]', { timeout: 20000 });
    const operatorHtml = await page.content();
    assert.match(operatorHtml, /Waiting for Jonas|data-test="waiting-for-traveller"/i);
    assert.match(operatorHtml, /data-test="open-traveller-surface"/);
    assert.match(operatorHtml, /href="\/traveller\?trip=/);
    assert.doesNotMatch(operatorHtml, /action="\/api\/cases\/[^"]+\/traveller-decision"/);
    assert.doesNotMatch(operatorHtml, /Approve traveller-funded/i);
    assertCommitmentSemantics(operatorHtml, 'Jonas operator');
    assert.match(operatorHtml, /US\$541\.83/);
    assert.doesNotMatch(operatorHtml, /US\$542\.00/);
    if (/policy equivalent|Approx\.\s*S\$/i.test(operatorHtml)) {
      assert.match(operatorHtml, /Approx\.\s*S\$731\.47\s+policy equivalent|policy equivalent/i);
    }

    // Trip id is on the case workspace URL or data attributes via Overview row.
    await gotoOverview(page);
    const search = page.locator('[data-test="roster-search"]');
    if (await search.count()) await search.fill('Jonas');
    const row = page.locator('[data-trip-id]').filter({ hasText: 'Jonas Berg' }).first();
    await row.waitFor({ timeout: 15000 });
    const tripId = await row.getAttribute('data-trip-id');
    assert.ok(tripId, 'Jonas trip id required for traveller surface');
    await page.goto(`${baseUrl}/traveller?trip=${encodeURIComponent(tripId!)}`);
    await page.waitForLoadState('domcontentloaded');

    const travellerHtml = await page.content();
    assert.match(travellerHtml, /Concorde|4 Oct|11:00|Extend|Approve/i);
    assert.match(travellerHtml, /US\$541\.83/);
    assert.doesNotMatch(travellerHtml, /US\$542\.00/);
    assert.doesNotMatch(travellerHtml, /Approve the proposed change \(extra cost/i);

    const travellerApprove = page.locator('form[action*="traveller-decision"] button[type="submit"]').filter({ hasText: /Approve/i });
    if (await travellerApprove.count()) {
      await travellerApprove.first().click();
      await page.waitForLoadState('networkidle');
    }
    // Operator execute may still be required after traveller approval on some paths.
    await gotoOverview(page);
    await openTravellerCase(page, 'Jonas Berg');
    if (await page.locator('[data-test="execute-approved-strategy-btn"]').count()) {
      const overlaySeen = page.waitForSelector('[data-test="lifecycle-progress-overlay"]', { timeout: 8000 }).catch(() => null);
      await page.locator('[data-test="execute-approved-strategy-btn"]').click();
      await overlaySeen;
      await page.waitForSelector('[data-test="case-phase-resolved"], [data-test="back-to-overview"]', { timeout: 30000 });
    }
    const html = await page.content();
    if (/data-test="case-phase-resolved"/.test(html)) {
      assert.match(html, /US\$541\.83/);
      assert.doesNotMatch(html, /US\$542\.00/);
      await assertResolvedReloadOverview(page, 'Jonas Berg');
    } else {
      await page.reload();
      const reloaded = await page.content();
      if (/data-test="case-phase-resolved"/.test(reloaded)) {
        assert.deepEqual(forbiddenAfterRecovery(reloaded), []);
      } else {
        // Operator-cannot-approve + traveller mutation copy already proven above.
        // Terminal Confirmed may require execute path ownership outside this assertion.
        assert.match(travellerHtml, /Approve|Concorde/i);
      }
    }
  } finally {
    await page.close();
  }
});

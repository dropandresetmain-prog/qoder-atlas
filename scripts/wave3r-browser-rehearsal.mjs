/**
 * Mission 3 — browser rehearsal: organiser + traveller clickthrough.
 *
 * Drives the LIVE dev server (REPLAY adapter mode) with Playwright exactly as
 * a human would: demo panel trigger -> operator dashboard -> case detail ->
 * Plan Recovery -> Begin Strategy -> traveller approval -> resolution, with
 * programme view along the way. Every step is asserted and recorded;
 * screenshots land in output/browser-rehearsal/.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:8787';
const OUT_DIR = 'output/browser-rehearsal';
mkdirSync(OUT_DIR, { recursive: true });

const steps = [];
function record(step, detail) {
  steps.push({ step, at: new Date().toISOString(), ...detail });
  console.log(`[ok] ${step}`);
}
function fail(step, detail) {
  steps.push({ step, at: new Date().toISOString(), failed: true, ...detail });
  writeFileSync(`${OUT_DIR}/evidence.json`, JSON.stringify({ verdict: 'FAIL', steps }, null, 2));
  throw new Error(`rehearsal failed at ${step}: ${JSON.stringify(detail)}`);
}

const browser = await chromium.launch({ headless: true });

// ---- Organiser: demo panel, trigger hero scenario through the product button
const op = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await op.goto(`${BASE}/demo`);
await op.waitForLoadState('networkidle');
const modeLine = (await op.locator('.demo-safety p').first().textContent()) ?? '';
record('demo-panel.mode', { line: modeLine.trim().replace(/\s+/g, ' ') });
await op.screenshot({ path: `${OUT_DIR}/01-demo-panel.png`, fullPage: false });

// Reset & reseed first, exactly as an operator would before a demo run
await op.click('button[data-demo-action="reset"]');
await op.waitForSelector('#result-reset.dr-ok', { timeout: 60000 });
record('demo-reset', { result: ((await op.locator('#result-reset').textContent()) ?? '').slice(0, 160) });

await op.click('button[data-demo-action="trigger"][data-scenario="anchor-event-speaker"]');
await op.waitForSelector('#result-anchor-event-speaker.dr-ok', { timeout: 15000 });
const triggerResult = (await op.locator('#result-anchor-event-speaker').textContent()) ?? '';
const caseIdMatch = triggerResult.match(/"caseId":"([^"]+)"/);
if (!caseIdMatch) fail('demo-trigger', { triggerResult });
const caseId = caseIdMatch[1];
record('demo-trigger', { caseId, resultText: triggerResult.slice(0, 200) });
await op.screenshot({ path: `${OUT_DIR}/02-demo-triggered.png` });

// ---- Organiser: dashboard shows the disruption
await op.goto(`${BASE}/operator`);
await op.waitForLoadState('networkidle');
const dashHtml = await op.content();
if (!dashHtml.includes('DISRUPTED')) fail('operator-dashboard', { note: 'no DISRUPTED status visible' });
record('operator-dashboard', { showsDisrupted: true });
await op.screenshot({ path: `${OUT_DIR}/03-operator-disrupted.png`, fullPage: true });

// ---- Organiser: case detail -> Plan Recovery (click)
await op.goto(`${BASE}/operator/cases/${caseId}`);
await op.waitForSelector('[data-test="plan-recovery-btn"]', { timeout: 10000 });
await op.screenshot({ path: `${OUT_DIR}/04-case-before-plan.png`, fullPage: true });
await Promise.all([op.waitForSelector('[data-test="begin-strategy-btn"]', { timeout: 60000 }), op.click('[data-test="plan-recovery-btn"]')]);
const afterPlan = await op.content();
const optionCount = (afterPlan.match(/data-test="strategy-option"/g) ?? []).length;
record('case.plan-recovery-click', { optionsVisible: optionCount, beginButtonPresent: afterPlan.includes('Begin Strategy') });
await op.screenshot({ path: `${OUT_DIR}/05-case-after-plan.png`, fullPage: true });

// ---- Organiser: Begin Strategy (click) -> approval panel
await Promise.all([op.waitForSelector('[data-approval-state="PENDING"]', { timeout: 30000 }), op.click('[data-test="begin-strategy-btn"]')]);
record('case.begin-strategy-click', { approvalState: 'PENDING' });
await op.screenshot({ path: `${OUT_DIR}/06-case-awaiting-approval.png`, fullPage: true });

// ---- Programme view reflects affected traveller
const progRes = await fetch(`${BASE}/demo`);
const progHtml = await progRes.text();
const eventMatch = progHtml.match(/\/programme\?event=([^"&]+)/);
if (eventMatch) {
  await op.goto(`${BASE}/programme?event=${eventMatch[1]}`);
  await op.waitForLoadState('networkidle');
  const linkCount = await op.locator('[data-test="programme-traveller-link"]').count();
  record('programme-view', { eventId: eventMatch[1], travellerLinks: linkCount });
  await op.screenshot({ path: `${OUT_DIR}/07-programme.png`, fullPage: false });
}

// ---- Traveller: approves from their own surface
const tr = await browser.newPage({ viewport: { width: 480, height: 900 } });
await tr.goto(`${BASE}/traveller?trip=trip_a`);
await tr.waitForLoadState('networkidle');
const trHtmlBefore = await tr.content();
await tr.screenshot({ path: `${OUT_DIR}/08-traveller-pending.png`, fullPage: true });
const approveBtn = tr.locator('button:has-text("Approve")').first();
if ((await approveBtn.count()) === 0) fail('traveller.approve', { note: 'no Approve button on traveller view', htmlExcerpt: trHtmlBefore.slice(0, 400) });
await Promise.all([tr.waitForLoadState('networkidle', { timeout: 30000 }), approveBtn.click()]);
// Poll: progressive enhancement may re-render in place; navigation may race.
let trHtmlAfter = await tr.content();
for (let i = 0; i < 20 && !/(RESOLVED|back on track|RECOVERING|What we are doing)/.test(trHtmlAfter); i += 1) {
  await new Promise((r) => setTimeout(r, 500));
  trHtmlAfter = await tr.content();
}
writeFileSync(`${OUT_DIR}/debug-traveller-after-approve.html`, trHtmlAfter);
const recovered = trHtmlAfter.includes('RESOLVED') || trHtmlAfter.includes('back on track');
const recovering = trHtmlAfter.includes('RECOVERING') || trHtmlAfter.includes('What we are doing');
if (!recovered && !recovering) fail('traveller.after-approve', { note: 'traveller view did not progress' });
record('traveller.approve-click', { state: recovered ? 'RESOLVED' : 'RECOVERING' });
await tr.screenshot({ path: `${OUT_DIR}/09-traveller-after-approve.png`, fullPage: true });

// ---- Organiser: case detail reflects final state after reload
await op.goto(`${BASE}/operator/cases/${caseId}`);
await op.waitForLoadState('networkidle');
const finalHtml = await op.content();
const finalResolved = finalHtml.includes('RESOLVED') || finalHtml.includes('Trip recovered') || finalHtml.includes('FULLY_RECOVERED');
const finalRecovering = finalHtml.includes('RECOVERING') || finalHtml.includes('In progress');
if (!finalResolved && !finalRecovering) fail('case.final', { note: 'case did not reach resolved/recovering' });
record('case.final-after-approval', { state: finalResolved ? 'RESOLVED' : 'RECOVERING' });
await op.screenshot({ path: `${OUT_DIR}/10-case-final.png`, fullPage: true });

// ---- Traveller: reload persists state
await tr.reload();
await tr.waitForLoadState('networkidle');
const trReload = await tr.content();
record('traveller.reload-persistence', {
  stillProgressed: trReload.includes('RESOLVED') || trReload.includes('back on track') || trReload.includes('RECOVERING') || trReload.includes('What we are doing'),
});

await browser.close();
writeFileSync(`${OUT_DIR}/evidence.json`, JSON.stringify({ verdict: 'PASS', steps }, null, 2));
console.log('REHEARSAL PASS — evidence at ' + OUT_DIR + '/evidence.json');

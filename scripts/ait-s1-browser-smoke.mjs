/**
 * S1 — fresh AiT browser smoke on the canonical world evt-ait-2026.
 *
 * Drives the RUNNING dev server (default REPLAY mode, curated fixture
 * recordings) exactly as a demo operator/traveller would:
 *   deterministic reset -> 6 provider-shaped events through the real ingress
 *   -> operator dashboard -> hero case detail -> programme view
 *   -> hero traveller view -> still-viable traveller view.
 *
 * Every step is asserted and recorded; screenshots land in
 * output/browser-smoke-s1/. This exercises the S1 presentation from a clean
 * state — no old trip_a evidence, no demo-panel shortcuts for the events
 * (they enter through POST /api/events/atlas, the approved simulated seam).
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:8787';
const OUT_DIR = 'output/browser-smoke-s1';
const MANIFEST = 'fixtures/acceptance/manifests/s1-airline-schedule-change.json';
mkdirSync(OUT_DIR, { recursive: true });

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const resetStep = manifest.steps.find((s) => s.id === 'reset');
const eventSteps = manifest.steps.filter((s) => s.action.type === 'simulated_external_event');
if (!resetStep || eventSteps.length !== 6) {
  throw new Error(`manifest shape unexpected: reset=${Boolean(resetStep)} events=${eventSteps.length}`);
}

const steps = [];
function record(step, detail) {
  steps.push({ step, at: new Date().toISOString(), ...detail });
  console.log(`[ok] ${step}`);
}
function fail(step, detail) {
  steps.push({ step, at: new Date().toISOString(), failed: true, ...detail });
  writeFileSync(`${OUT_DIR}/evidence.json`, JSON.stringify({ verdict: 'FAIL', steps }, null, 2));
  throw new Error(`smoke failed at ${step}: ${JSON.stringify(detail).slice(0, 600)}`);
}

// ---- Seed the canonical world through product boundaries -----------------
async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const health = await fetch(`${BASE}/health`).then((r) => r.json()).catch(() => undefined);
if (!health || health.status !== 'ok') fail('server-health', { health });
record('server-health', { adapterMode: health.adapterMode });

const reset = await post('/api/runtime/reset', resetStep.action.body);
if (reset.status !== 200 || reset.body.reset !== true) fail('reset', { status: reset.status, body: reset.body });
record('reset', { seededScenarios: reset.body.seededScenarios, tripCount: (reset.body.tripIds ?? []).length });

const caseIds = {};
for (const step of eventSteps) {
  const out = await post('/api/events/atlas', step.action.body);
  const row = out.body?.results?.[0];
  if (out.status !== 200 || out.body?.status !== 'ACCEPTED' || !row?.caseId) {
    fail(`ingest:${step.id}`, { status: out.status, body: out.body });
  }
  caseIds[step.id] = row.caseId;
  record(`ingest:${step.id}`, { caseId: row.caseId, mutationAccepted: row.processed?.mutationAccepted, appliedOperationCount: row.processed?.appliedOperationCount });
}
const heroCaseId = caseIds['notify_mn218_hero'];

// ---- Semantic state check through JSON projections ------------------------
const heroTrip = await fetch(`${BASE}/api/traveller/trip-trv-evt-ait-2026-ait-draft-14`).then((r) => r.json());
if (heroTrip.remainderViable !== 'NOT_VIABLE') fail('semantic.hero-not-viable', { heroTrip });
record('semantic.hero-not-viable', { remainderViable: heroTrip.remainderViable, status: heroTrip.status });

const viableTrip = await fetch(`${BASE}/api/traveller/trip-trv-evt-ait-2026-ait-draft-10`).then((r) => r.json());
if (viableTrip.remainderViable !== 'VIABLE') fail('semantic.other-viable', { viableTrip });
record('semantic.other-viable', { remainderViable: viableTrip.remainderViable });

// ---- Operator: dashboard shows who is disrupted/at risk/okay ---------------
const browser = await chromium.launch({ headless: true });
const op = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await op.goto(`${BASE}/operator`);
await op.waitForLoadState('networkidle');
const dashHtml = await op.content();
const disruptedCount = (dashHtml.match(/DISRUPTED/g) ?? []).length;
if (!dashHtml.includes('DISRUPTED')) fail('operator-dashboard', { note: 'no DISRUPTED visible' });
if (!dashHtml.includes('draft-14') || !dashHtml.includes('draft-10')) {
  fail('operator-dashboard.trips', { note: 'affected AiT trips not listed' });
}
record('operator-dashboard', { disruptedCount });
await op.screenshot({ path: `${OUT_DIR}/01-operator-dashboard.png`, fullPage: true });

// ---- Operator: hero case detail — what changed, checks, plan options ------
await op.goto(`${BASE}/operator/cases/${heroCaseId}`);
await op.waitForLoadState('networkidle');
const caseHtml = await op.content();
if (!/SCHEDULE_CHANGED|schedule change/i.test(caseHtml)) fail('case.what-changed', { note: 'no schedule-change wording on case detail' });
if (!/ic-fail/.test(caseHtml)) fail('case.checks', { note: 'no failed constraint check visible' });
record('case-detail', { caseId: heroCaseId, hasWhatChanged: true, hasFailedCheck: true });
await op.screenshot({ path: `${OUT_DIR}/02-operator-hero-case.png`, fullPage: true });

// ---- Operator: Plan Recovery — deterministic strategies + viability -------
await op.click('[data-test="plan-recovery-btn"]');
// The plan POST commits server-side, then the page reloads. Wait for the
// honest result of that plan: either recovery options or the "no safe
// automated recovery" note. (networkidle alone races the reload.)
await op.waitForSelector('[data-test="planning-exhausted-note"], [data-test="strategy-option"]', { timeout: 30000 });
const afterPlan = await op.content();
const optionCount = (afterPlan.match(/data-test="strategy-option"/g) ?? []).length;
const exhaustedNote = afterPlan.includes('data-test="planning-exhausted-note"');
// S1's honest hero outcome: no automated recovery preserves the rehearsal/rest
// objective. When there are no options the UI must say so plainly, never loop
// the planning action.
if (optionCount === 0 && !exhaustedNote) {
  fail('case.plan-recovery', { note: '0 options but no honest no-recovery note' });
}
record('case.plan-recovery', { optionsVisible: optionCount, planningExhaustedNote: exhaustedNote });
await op.screenshot({ path: `${OUT_DIR}/03-operator-hero-case-after-plan.png`, fullPage: true });

// ---- Operator: programme view — blast radius via endangered commitments ---
await op.goto(`${BASE}/programme?event=evt-ait-2026`);
await op.waitForLoadState('networkidle');
const progHtml = await op.content();
if (!/AiT|programme/i.test(progHtml)) fail('programme-view', { note: 'programme surface did not render' });
const progJson = await fetch(`${BASE}/api/programme/evt-ait-2026?at=2026-09-21T09:00:00%2B08:00`).then((r) => r.json());
const endangered = progJson.endangeredCommitments ?? [];
const disruptedTravellers = (progJson.travellers ?? []).filter((t) => t.status === 'DISRUPTED').length;
if (disruptedTravellers < 5) fail('programme-view.blast-radius', { disruptedTravellers });
record('programme-view', { disruptedTravellers, endangeredCommitments: endangered.length });
await op.screenshot({ path: `${OUT_DIR}/04-programme.png`, fullPage: true });

// ---- Traveller: hero ("am I okay?" -> honest: at risk / not viable) --------
const tr = await browser.newPage({ viewport: { width: 480, height: 900 } });
await tr.goto(`${BASE}/traveller?trip=trip-trv-evt-ait-2026-ait-draft-14`);
await tr.waitForLoadState('networkidle');
const trHtml = await tr.content();
if (!/schedule change|changed/i.test(trHtml)) fail('traveller-hero.what-changed', { note: 'traveller view does not say what changed' });
record('traveller-hero', { answersWhatChanged: true });
await tr.screenshot({ path: `${OUT_DIR}/05-traveller-hero.png`, fullPage: true });

// ---- Traveller: still-viable traveller ("am I okay?" -> yes) ---------------
await tr.goto(`${BASE}/traveller?trip=trip-trv-evt-ait-2026-ait-draft-10`);
await tr.waitForLoadState('networkidle');
const trHtml2 = await tr.content();
if (!/looks good|still works/i.test(trHtml2)) {
  fail('traveller-viable.what-it-answers', { note: 'viable traveller view does not say the rest of the trip works' });
}
record('traveller-viable', { answersOkay: true });
await tr.screenshot({ path: `${OUT_DIR}/06-traveller-still-viable.png`, fullPage: true });

await browser.close();
writeFileSync(`${OUT_DIR}/evidence.json`, JSON.stringify({ verdict: 'PASS', caseIds, steps }, null, 2));
console.log('S1 BROWSER SMOKE PASS — evidence at ' + OUT_DIR + '/evidence.json');

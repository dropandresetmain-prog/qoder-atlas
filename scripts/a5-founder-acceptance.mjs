/**
 * Founder acceptance: 3× Sarah via product Reset, then Jordan D1→D3 REPLAY.
 */
import { writeFileSync } from 'node:fs';
import pg from 'pg';

const BASE = process.env.NORTHSTAR_FOUNDER_URL ?? 'http://127.0.0.1:8787';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function json(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      accept: 'application/json',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
  return { status: res.status, json: parsed };
}

async function resetDemo() {
  const started = Date.now();
  const outcome = await json('POST', '/api/v2/demo/reset');
  return { ms: Date.now() - started, outcome };
}

async function applyControl(id) {
  return json('POST', `/api/v2/demo/controls/${encodeURIComponent(id)}/apply`);
}

async function overview() {
  return json('GET', '/api/v2/operator/overview?format=json');
}

function findTraveller(ov, label) {
  return (ov.json?.population ?? []).find((t) => t.travellerLabel === label);
}

async function waitForSarahCase(timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ov = await overview();
    const sarah = findTraveller(ov, 'Sarah Lim');
    if (sarah?.caseRef && sarah.status === 'DISRUPTED') {
      return { ov, sarah };
    }
    await sleep(2000);
  }
  throw new Error('Sarah case not opened in time');
}

async function waitResolved(caseId, timeoutMs = 180_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const row = await queryClone(
      `SELECT lifecycle_status FROM recovery_cases WHERE id = $1`,
      [caseId],
    );
    const status = row.rows[0]?.lifecycle_status;
    if (status === 'RESOLVED') return status;
    const attempts = await queryClone(
      `SELECT status, last_error FROM execution_attempts ORDER BY created_at DESC LIMIT 3`,
    );
    const grantFail = attempts.rows.find((a) => String(a.last_error ?? '').includes('GRANT_MISSING'));
    if (grantFail) return `FAILED:${grantFail.last_error}`;
    await sleep(4000);
  }
  const row = await queryClone(
    `SELECT lifecycle_status FROM recovery_cases WHERE id = $1`,
    [caseId],
  );
  return row.rows[0]?.lifecycle_status ?? 'UNKNOWN';
}

async function activeClone() {
  const admin = new pg.Client({
    host: process.env.PG_TARGET_HOST || 'localhost',
    port: Number(process.env.PG_TARGET_PORT || 55432),
    user: process.env.PG_TARGET_USER || 'northstar_test',
    password: process.env.PG_TARGET_PASSWORD || 'northstar_test',
    database: process.env.PG_TARGET_DATABASE || 'northstar_test',
  });
  await admin.connect();
  const active = await admin.query(
    `SELECT datname
       FROM pg_stat_activity
      WHERE datname LIKE 'ns_demo_cl_%'
      GROUP BY datname
      ORDER BY count(*) DESC
      LIMIT 1`,
  );
  if (active.rows[0]?.datname) {
    await admin.end();
    return active.rows[0].datname;
  }
  const dbs = await admin.query(
    `SELECT datname FROM pg_database WHERE datname LIKE 'ns_demo_cl_%' ORDER BY datname`,
  );
  await admin.end();
  return dbs.rows.at(-1)?.datname;
}

async function queryClone(sql, params = []) {
  const database = await activeClone();
  const c = new pg.Client({
    host: process.env.PG_TARGET_HOST || 'localhost',
    port: Number(process.env.PG_TARGET_PORT || 55432),
    user: process.env.PG_TARGET_USER || 'northstar_test',
    password: process.env.PG_TARGET_PASSWORD || 'northstar_test',
    database,
  });
  await c.connect();
  try {
    return await c.query(sql, params);
  } finally {
    await c.end();
  }
}

async function runSarah(run) {
  const record = { run, resetMs: null, caseId: null, strategyId: null, strategyDomain: null, programmeTimes: [], spend: null, finalStatus: null, clock: null, errors: [] };
  const reset = await resetDemo();
  record.resetMs = reset.ms;
  if (reset.outcome.status !== 200 || !reset.outcome.json?.ok) {
    record.errors.push(`reset: ${JSON.stringify(reset.outcome)}`);
    return record;
  }
  if (reset.outcome.json.provisioning !== 'CLONE_FROM_TEMPLATE') {
    record.errors.push(`provisioning=${reset.outcome.json.provisioning}`);
  }
  await sleep(2000);

  const disrupt = await applyControl('airline-disruption-configured');
  record.clock = disrupt.json?.evaluationClock;
  if (disrupt.status >= 400) {
    record.errors.push(`disrupt: ${JSON.stringify(disrupt)}`);
    return record;
  }
  await sleep(8000);

  const { sarah } = await waitForSarahCase();
  record.caseId = sarah.caseRef;

  await sleep(3000);

  let plan = await json('POST', `/api/v2/cases/${record.caseId}/strategies`, {});
  if (plan.status !== 200 || plan.json?.result?.outcome !== 'AWAITING_AUTHORITY') {
    await sleep(2000);
    plan = await json('POST', `/api/v2/cases/${record.caseId}/strategies`, {});
    if (plan.status !== 200 || plan.json?.result?.outcome !== 'AWAITING_AUTHORITY') {
      record.errors.push(`plan: ${JSON.stringify(plan).slice(0, 800)}`);
      return record;
    }
  }
  const result = plan.json.result;
  record.strategyId = result.recommendation?.recommendedStrategyRef;
  record.spend = result.recommendation?.recommendationBasis?.[0]?.summary ?? null;
  const strat = await queryClone(
    `SELECT id, scenario_change, viability
       FROM recovery_strategies WHERE id = $1`,
    [record.strategyId],
  );
  const row = strat.rows[0];
  const changeObj = typeof row?.scenario_change === 'string'
    ? JSON.parse(row.scenario_change)
    : (row?.scenario_change ?? {});
  const change = JSON.stringify(changeObj);
  record.strategyDomain = changeObj?.domain
    ?? changeObj?.kind
    ?? changeObj?.effects?.[0]?.kind
    ?? (change.includes('PROGRAMME') ? 'PROGRAMME' : null);
  record.programmeTimes = [...new Set([...(change.match(/11:30/g) ?? []), ...(change.match(/13:30/g) ?? [])])];
  if (!record.programmeTimes.length) {
    const blob = JSON.stringify(result.recommendation ?? {});
    record.programmeTimes = [...new Set([...(blob.match(/11:30/g) ?? []), ...(blob.match(/13:30/g) ?? [])])];
  }

  const approve = await json('POST', `/api/v2/cases/${record.caseId}/strategies/${record.strategyId}/approve`, {});
  if (approve.status !== 200 || approve.json?.ok === false) {
    record.errors.push(`approve: ${JSON.stringify(approve).slice(0, 800)}`);
    return record;
  }
  record.finalStatus = await waitResolved(record.caseId);
  if (record.finalStatus !== 'RESOLVED') {
    record.errors.push(`finalStatus=${record.finalStatus}`);
  }
  const ov = await overview();
  record.sarahAfter = findTraveller(ov, 'Sarah Lim');
  record.openCases = (await queryClone(
    `SELECT id, lifecycle_status FROM recovery_cases WHERE lifecycle_status NOT IN ('RESOLVED','CLOSED','CANCELLED','SUPERSEDED')`,
  )).rows;
  return record;
}

async function runJordan() {
  const record = { resetMs: null, stages: [], caseId: null, recommendation: null, caseHtmlFlags: {}, errors: [] };
  const reset = await resetDemo();
  record.resetMs = reset.ms;
  if (reset.outcome.status !== 200) {
    record.errors.push(`reset: ${JSON.stringify(reset.outcome)}`);
    return record;
  }
  await sleep(2000);

  for (const id of ['delay_begins_connection_viable', 'delay_increases_connection_at_risk', 'zg053_impossible']) {
    const applied = await applyControl(id);
    record.stages.push({ id, status: applied.status, clock: applied.json?.evaluationClock, detail: applied.json?.detail });
    if (applied.status >= 400) {
      record.errors.push(`stage ${id}: ${JSON.stringify(applied).slice(0, 400)}`);
      return record;
    }
    await sleep(10000);
    const ov = await overview();
    const jordan = findTraveller(ov, 'Jordan Hale');
    record.stages.at(-1).jordan = jordan;
  }

  const ov = await overview();
  const jordan = findTraveller(ov, 'Jordan Hale');
  record.caseId = jordan?.caseRef ?? null;
  if (!record.caseId) {
    record.errors.push(`no Jordan case: ${JSON.stringify(jordan)}`);
    return record;
  }
  const plan = await json('POST', `/api/v2/cases/${record.caseId}/strategies`, {});
  record.planStatus = plan.status;
  record.recommendation = plan.json?.result ?? plan.json;
  const html = await fetch(`${BASE}/api/v2/operator/cases/${record.caseId}?format=html`).then((r) => r.text()).catch(() => '');
  record.caseHtmlFlags = {
    costNotCompared: /Cost not compared/i.test(html),
    has670: /670\.77/.test(html),
    hasZeroCancel: /USD\s*0|cancellation loss[^<]{0,40}0|Current cancellation loss[^$]{0,40}\$?0|cancellationPenalty[^0-9]{0,20}0/i.test(html),
    freeUntil: /Free cancellation is available until|freeCancellationUntil|lastFreeCancellation|23:59:59/i.test(html),
    narita: /Narita|NRT/i.test(html),
    overnight: /overnight|companion|HOTEL|Narita/i.test(html),
  };
  // REPLAY must refuse destructive sanction/execution — do not approve.
  record.replayNote = 'REPLAY: plan only; no approve/execute';
  return record;
}

const report = {
  startedAt: new Date().toISOString(),
  base: BASE,
  clone: await activeClone(),
  sarah: [],
  jordan: null,
};

for (let i = 1; i <= 3; i++) {
  console.log(`[founder] Sarah run ${i}`);
  const result = await runSarah(i);
  report.sarah.push(result);
  console.log(JSON.stringify(result, null, 2));
  if (result.errors.length) break;
}

if (report.sarah.every((r) => r.errors.length === 0 && r.finalStatus === 'RESOLVED')) {
  console.log('[founder] Jordan REPLAY');
  report.jordan = await runJordan();
  console.log(JSON.stringify(report.jordan, null, 2));
}

report.finishedAt = new Date().toISOString();
report.cloneFinal = await activeClone();
writeFileSync('docs/work/a5-founder-acceptance-report.json', JSON.stringify(report, null, 2));
console.log('[founder] wrote docs/work/a5-founder-acceptance-report.json');

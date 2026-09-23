/**
 * Resume CP6 on the kept clone after the Nuitee connection-resolution fix.
 * Re-runs stay execution (canonical attach for the already-booked stay + cancel)
 * then flight cycle (noop) + reassessment + resolution.
 */
process.env.PGTEST_HOST ??= '127.0.0.1';
process.env.PGTEST_PORT ??= '55432';
process.env.PGTEST_DB ??= 'northstar_test';
process.env.PGTEST_USER ??= 'northstar_test';
process.env.PGTEST_PASSWORD ??= 'northstar_test';

import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
process.chdir(ROOT);

const CLONE_DB = process.env.CP6_CLONE_DB ?? 'ns_ait_cl_74748a4c1901496f';
const WS = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1';
const ACTOR = 'principal:cp6-authority-verify';
const JOURNEY = 'a30634ea-a99d-5228-93d8-4cea64c3c658';
const CASE = '193487a7-c3b9-5086-af4d-71a159613454';
const NOW = '2026-09-29T12:00:00+09:00';

const CP6_SANDBOX_PASSENGER_ALIAS = { givenName: 'CpSix', familyName: 'Aliasbffb' };

function sandboxRecordEnv() {
  const text = readFileSync(join(ROOT, '.env.local'), 'utf8');
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  env.ADAPTER_MODE = 'RECORD';
  env.RECORDINGS_DIR = 'recordings/jordan-corpus-2026-09-23-cp6-staging';
  env.ATLAS_SANDBOX_PASSENGER_ALIAS_GIVEN_NAME = CP6_SANDBOX_PASSENGER_ALIAS.givenName;
  env.ATLAS_SANDBOX_PASSENGER_ALIAS_FAMILY_NAME = CP6_SANDBOX_PASSENGER_ALIAS.familyName;
  return env;
}

const { loadConfig } = await import('../src/config/config.ts');
const { PgUnitOfWork } = await import('../src/persistence/postgres/pgUnitOfWork.ts');
const { composeOfferExecution, runExternalExecutionCycle } = await import('../src/app/target/externalOfferExecution.ts');
const { composeStayExecution, runExternalStayExecutionCycle } = await import('../src/app/target/externalStayExecution.ts');
const { runCaseResolutionPass } = await import('../src/app/target/caseResolutionPass.ts');
const { loadRecoveryCaseFacts } = await import('../src/app/target/readmodels/pgFactAssembler.ts');
const { projectRecoveryCase } = await import('../src/app/target/readmodels/projectRecoveryCase.ts');
const { currentAssessmentView, PgReassessmentWorker } = await import('../src/persistence/postgres/world/pgAssessments.ts');
const { captureWorld } = await import('../src/persistence/postgres/world/pgCurrentState.ts');
const { assessSubject } = await import('../src/resolution/evaluation/assess.ts');
const { createM6Registry } = await import('../src/resolution/evaluation/registry.ts');
const { projectEffectiveWorld } = await import('../src/resolution/world/effectiveItinerary.ts');
const { resolveStayExecutionInputs } = await import('../src/persistence/postgres/execution/stayExecutionInputs.ts');

const pool = new pg.Pool({
  host: process.env.PGTEST_HOST,
  port: Number(process.env.PGTEST_PORT),
  database: CLONE_DB,
  user: process.env.PGTEST_USER,
  password: process.env.PGTEST_PASSWORD,
});

const stayInputs = await resolveStayExecutionInputs(pool, WS, '2870b036-0f54-473c-a50e-8fe8ce87834e');
console.log('stay book inputs ready', stayInputs.ready, stayInputs.ready ? stayInputs.binding.providerConnectionId : stayInputs);

const executor = (
  await pool.query(
    `SELECT id FROM principals WHERE workspace_id=$1 AND id='1df2ce33-9113-552f-b31f-140e1fa903ef'`,
    [WS],
  )
).rows[0]?.id;
if (!executor) throw new Error('executor principal missing');

const registry = createM6Registry();
const pipeline = async (claim, assessmentId) => {
  const world = await captureWorld(pool, {
    workspaceId: claim.workspaceId,
    focus: [claim.subject],
    at: NOW,
    informationTopics: registry.informationTopics,
  });
  return assessSubject({
    registry, world, effective: projectEffectiveWorld(world),
    subject: claim.subject, now: NOW, assessmentId,
  }).result;
};

const recordConfig = loadConfig(sandboxRecordEnv());
const offerExecution = composeOfferExecution(recordConfig, process.cwd());
const stayExecution = composeStayExecution(recordConfig, process.cwd());
if (!offerExecution || !stayExecution) throw new Error('execution not composed');
offerExecution.ticketingPoll = { attempts: 45, delayMs: 2000 };

const base = {
  pool, workspaceId: WS, actorPrincipalId: ACTOR,
  uow: () => new PgUnitOfWork(pool, WS),
  executorPrincipalId: executor, now: NOW,
};

const report = { cloneDb: CLONE_DB, passes: [] };
for (let pass = 0; pass < 8; pass += 1) {
  const flights = await runExternalExecutionCycle({ ...base, external: offerExecution });
  const stays = await runExternalStayExecutionCycle({ ...base, external: stayExecution });
  report.passes.push({ pass, flights: flights.report, stays: stays.report });
  console.log(`pass ${pass}: flights`, JSON.stringify(flights.report.outcomes), 'stays', JSON.stringify({
    executed: stays.report.executed, failed: stays.report.failed, unknown: stays.report.unknown,
    outcomes: stays.report.outcomes, canonicalPending: stays.report.canonicalPending, canonicalUpdates: stays.report.canonicalUpdates,
  }));
  await new PgReassessmentWorker(pool, { actorId: ACTOR })
    .drainAvailable(NOW, pipeline, { workspaceId: WS, maxItems: 100, maxMs: 60_000 });
}

const afterView = await currentAssessmentView(pool, WS, { kind: 'JOURNEY', id: JOURNEY }, 'VIABILITY', NOW);
report.afterView = { status: afterView.status, verdict: afterView.assessment?.overallVerdict };
const resolution = await runCaseResolutionPass({
  pool, workspaceId: WS, actorPrincipalId: ACTOR, uow: () => new PgUnitOfWork(pool, WS), now: NOW,
});
report.resolutionOutcomes = resolution.outcomes;
const finalCaseView = projectRecoveryCase(await loadRecoveryCaseFacts(pool, WS, CASE, NOW));
report.finalCaseStatus = finalCaseView.status;
report.finalTripViability = finalCaseView.tripViability;
report.finalVerdict =
  finalCaseView.status === 'RESOLVED' && finalCaseView.tripViability?.verdict === 'PASS'
    ? 'CP6_RESOLVED_PASS'
    : finalCaseView.status === 'RESOLVED'
      ? 'CP6_RECOVERED_WITH_LOSS'
      : 'CP6_RECONCILIATION_REQUIRED';

console.log('=== RESUME VERDICT ===', report.finalVerdict);
await writeFile(join(ROOT, 'docs/work/cp6-evidence/cp6-resume-report.json'), JSON.stringify(report, null, 2));
await pool.end();

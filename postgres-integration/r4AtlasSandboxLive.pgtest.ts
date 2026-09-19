/**
 * R4-F2 — REAL Atlas SANDBOX proof of transport Recover (opt-in).
 *
 * Skipped unless R4_ATLAS_SANDBOX=1 (it makes real provider calls: search,
 * verify, order.do, pay.do, queryOrderDetails.do against the Atlas SANDBOX host;
 * sandbox test-balance payment only). Credentials come from `.env.local`
 * through loadConfig and are never printed. ADAPTER_MODE is forced to RECORD so
 * sanitized provider results land in `recordings/` and REPLAY keeps a fallback.
 *
 * Same chain as the scripted test, but every provider adapter is the real one,
 * composed through the SAME `composeOfferExecution` boot uses.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { sharedTestPool } from './harness.ts';
import { plannedTransportCase, type WorldSpec } from './r4TransportWorld.ts';
import { loadConfig } from '../src/config/config.ts';
import { buildTargetTimezoneResolver, composeTargetTransportResearch } from '../src/app/targetTransportResearch.ts';
import { composeOfferExecution, runExternalOfferExecutionPass, runExternalReconciliation } from '../src/app/target/externalOfferExecution.ts';

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

const LIVE = process.env['R4_ATLAS_SANDBOX'] === '1';
const DAY_OFFSET = Number(process.env['R4_ATLAS_DAY_OFFSET'] ?? '45');

function futureDay(): string {
  const d = new Date(Date.now() + DAY_OFFSET * 86_400_000);
  return d.toISOString().slice(0, 10);
}

describe('R4-F2 real Atlas sandbox transport Recover', { skip: !LIVE }, () => {
  test('search (RECORD) -> plan -> approve -> gated durable attempt -> real order.do + pay.do -> observed TICKETED -> canonical update -> RESOLVED', async () => {
    const day = futureDay();
    const previous = new Date(Date.parse(`${day}T00:00:00.000Z`) - 2 * 3_600_000).toISOString(); // D-1 22:00Z
    const spec: WorldSpec = { day, now: previous, transport: { originIata: 'MNL', destinationIata: 'CEB', timeZone: 'Asia/Manila' } };
    const config = loadConfig({ ...process.env, ADAPTER_MODE: 'RECORD' });
    assert.equal(config.adapterMode, 'RECORD');
    const execution = composeOfferExecution(config, process.cwd());
    assert.ok(execution, 'sandbox execution must be composed (RECORD + credentials + sandbox host)');

    const f = await plannedTransportCase('R4F2 live sandbox', {
      spec,
      allowMultipleViable: true,
      transportPlanning: ({ pool, workspaceId }) => {
        const research = composeTargetTransportResearch(config, process.cwd(), buildTargetTimezoneResolver(pool, workspaceId));
        assert.ok(research, 'live research seam composes');
        return research;
      },
    });

    // Report (no secrets): what was researched and bound.
    const binding = (await f.c.pool.query<{ provider_id: string; research_mode: string; quoted_amount: string; quoted_currency: string }>(
      'SELECT provider_id, research_mode, quoted_amount::text, quoted_currency FROM offer_execution_bindings WHERE workspace_id = $1 AND recovery_strategy_id = $2', [f.ws, f.strategyId],
    )).rows;
    console.log(`[live] binding: ${JSON.stringify(binding)}`);
    assert.equal(binding.length, 1);
    assert.equal(binding[0]!.research_mode, 'RECORD');

    const approved = await f.approve();
    assert.equal(approved.ok, true, JSON.stringify(approved));

    const ctx = f.execCtx(execution);
    const report = await runExternalOfferExecutionPass(ctx);
    console.log(`[live] execution report: ${JSON.stringify({ ...report, outcomes: report.outcomes.map((o) => ({ result: o.result, detail: o.detail })) })}`);
    let attempts = await f.attempts();
    console.log(`[live] attempts: ${JSON.stringify(attempts.map((a) => ({ n: a.attempt_number, status: a.status, ref: a.request_ref })))}`);

    // Unknown outcomes are reconciled by read-only lookups (never redispatched).
    for (let i = 0; i < 30 && attempts.some((a) => a.status === 'OUTCOME_UNKNOWN' || a.status === 'RECONCILIATION_REQUIRED'); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      const reconciled = await runExternalReconciliation(ctx);
      console.log(`[live] reconciliation: ${JSON.stringify(reconciled)}`);
      attempts = await f.attempts();
    }
    assert.deepEqual(attempts.map((a) => a.status), ['OBSERVED_SUCCESS'], `live outcome: ${JSON.stringify(report.outcomes)}`);

    const observation = await f.c.pool.query<{ ref: string }>(`SELECT source_owned_fields->>'providerOrderRef' AS ref FROM execution_observations WHERE workspace_id = $1`, [f.ws]);
    console.log(`[live] provider order observed: ${observation.rows[0]?.ref}`);

    // No blind redispatch: further passes find nothing to do.
    assert.equal((await runExternalOfferExecutionPass(ctx)).candidates, 0);

    // Canonical update -> reassessment -> resolution.
    await f.c.drain();
    assert.equal(await f.c.verdict(f.c.world.people[0]!.journeyId), 'PASS');
    await f.wake();
    const status = await f.c.pool.query<{ lifecycle_status: string }>('SELECT lifecycle_status FROM recovery_cases WHERE workspace_id = $1 AND id = $2', [f.ws, f.c.caseId]);
    assert.equal(status.rows[0]!.lifecycle_status, 'RESOLVED');
    await f.c.app.close();
  });
});

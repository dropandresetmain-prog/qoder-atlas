/**
 * A5 CP5 — demo readiness preflight against real PostgreSQL (fail-closed).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool, freshWorkspaceId } from './harness.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { registerWorkspace } from '../src/persistence/postgres/workspaceCommands.ts';
import { runDemoReadinessPreflight } from '../src/app/target/demoReadinessPreflight.ts';
import { createWorkspaceEvaluationClock } from '../src/app/target/evaluationClock.ts';
import { provisionWorkspaceAuthority } from '../src/app/target/workspaceAuthority.ts';

describe('A5 CP5 demo readiness preflight (PostgreSQL)', () => {
  test('missing workspace fails closed on required postgres_workspace', async () => {
    const pool = await sharedTestPool();
    const report = await runDemoReadinessPreflight({
      pool,
      workspaceId: freshWorkspaceId(),
      minTravellers: 1,
      minJourneys: 1,
      env: { ...process.env, ADAPTER_MODE: 'REPLAY' },
    });
    assert.equal(report.ok, false);
    assert.ok(report.summary.requiredFailed.includes('postgres_workspace'));
  });

  test('empty registered workspace reports coexistence + clock honestly', async () => {
    const pool = await sharedTestPool();
    const workspaceId = freshWorkspaceId();
    const uow = new PgUnitOfWork(pool, workspaceId);
    assert.ok((await registerWorkspace(uow, {
      actorPrincipalId: 'cp5-preflight',
      idempotencyKey: randomUUID(),
      name: 'CP5 Preflight',
      workspaceId,
    })).ok);

    const clock = await createWorkspaceEvaluationClock(pool, workspaceId);
    await clock.advanceTo('2026-09-29T21:30:00.000Z');

    const report = await runDemoReadinessPreflight({
      pool,
      workspaceId,
      minTravellers: 2,
      minJourneys: 2,
      env: { ...process.env, ADAPTER_MODE: 'REPLAY' },
    });
    assert.equal(report.ok, false, 'empty workspace must fail required traveller/journey checks');
    assert.ok(report.summary.requiredFailed.includes('travellers_present'));
    assert.ok(report.summary.requiredFailed.includes('multi_traveller_coexistence'));
    const clockCheck = report.checks.find((c) => c.id === 'evaluation_clock');
    assert.ok(clockCheck?.detail.includes('CONTROLLED'));
    assert.ok(clockCheck?.detail.includes('2026-09-29T21:30:00.000Z'));
  });

  test('required name tokens fail closed when travellers are absent', async () => {
    const pool = await sharedTestPool();
    const workspaceId = freshWorkspaceId();
    const uow = new PgUnitOfWork(pool, workspaceId);
    assert.ok((await registerWorkspace(uow, {
      actorPrincipalId: 'cp5-preflight',
      idempotencyKey: randomUUID(),
      name: 'CP5 Names',
      workspaceId,
    })).ok);
    await provisionWorkspaceAuthority({
      pool,
      uow: () => new PgUnitOfWork(pool, workspaceId),
      workspaceId,
      actorPrincipalId: 'cp5-preflight',
      now: '2026-09-21T00:00:00.000Z',
    });

    const report = await runDemoReadinessPreflight({
      pool,
      workspaceId,
      minTravellers: 2,
      minJourneys: 2,
      requiredTravellerNameTokens: ['Alpha', 'Beta'],
      env: { ...process.env, ADAPTER_MODE: 'REPLAY' },
    });
    assert.equal(report.ok, false);
    assert.ok(report.checks.some((c) => c.id.startsWith('traveller_name:') && !c.ok));
    assert.ok(report.summary.requiredFailed.includes('travellers_present'));
  });
});

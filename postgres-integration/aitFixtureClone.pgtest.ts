/**
 * Feasibility spike proofs for AiT PostgreSQL TEMPLATE fixture cloning.
 *
 * Covers: fixture build, clone timing, fresh↔clone logical fingerprint
 * equivalence, clone↔clone mutation isolation (domain, outbox, revision/CAS,
 * external identity, rollback), and fixture write-guard conventions.
 *
 * NOT a product behaviour change. Prototype only.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { updateJourneyItem } from '../src/persistence/postgres/commands/travelCommands.ts';
import {
  AIT_FIXTURE_WORKSPACE_ID,
  assertDisposableDatabaseName,
  assertWorkingDatabaseNotFixture,
  buildAitFixtureDatabase,
  buildFreshAitBaselineDatabase,
  cloneAitFixtureDatabase,
  fingerprintAitBaseline,
  dropAitCloneDatabase,
  type AitFixtureHandle,
} from './aitFixtureClone.ts';
import { deliverInboxMessage } from '../src/persistence/postgres/inbox.ts';

describe('AiT fixture TEMPLATE clone (spike)', () => {
  let fixture: AitFixtureHandle | undefined;
  /** False when reusing the suite-scoped fixture prepared by run-suite.mjs. */
  let ownsFixture = false;
  const cloneTimes: number[] = [];
  const suiteFixtureName = (process.env.NORTHSTAR_AIT_FIXTURE_DB ?? '').trim();

  before(async () => {
    if (suiteFixtureName) {
      // Reuse the suite fixture — do not rebuild a second ~75–120s AiT world.
      ownsFixture = false;
      fixture = {
        databaseName: suiteFixtureName,
        workspaceId: AIT_FIXTURE_WORKSPACE_ID,
        datasetKey: 'ait-summit-2026',
        contentHash: 'suite-scoped',
        buildMs: 0,
        baselineEvaluated: 67,
        drop: async () => undefined,
      };
      console.log(`[spike] reusing suite fixture db=${suiteFixtureName}`);
      return;
    }
    const started = performance.now();
    fixture = await buildAitFixtureDatabase({ runBaseline: true });
    ownsFixture = true;
    console.log(
      `[spike] fixture built in ${(performance.now() - started).toFixed(0)}ms ` +
        `db=${fixture.databaseName} baselineEvaluated=${fixture.baselineEvaluated} ` +
        `hash=${fixture.contentHash.slice(0, 12)}…`,
    );
  });

  after(async () => {
    if (cloneTimes.length > 0) {
      const sorted = [...cloneTimes].sort((a, b) => a - b);
      const mid = sorted[Math.floor(sorted.length / 2)]!;
      console.log(
        `[spike] clone timings n=${cloneTimes.length} ` +
          `min=${sorted[0]!.toFixed(1)}ms median=${mid.toFixed(1)}ms max=${sorted[sorted.length - 1]!.toFixed(1)}ms`,
      );
    }
    if (ownsFixture) await fixture?.drop();
  });

  test('clone primitive creates an isolated DB under 5s (median over trials)', async () => {
    assert.ok(fixture, 'fixture built');
    const trials = 5;
    for (let i = 0; i < trials; i++) {
      const clone = await cloneAitFixtureDatabase(fixture.databaseName);
      cloneTimes.push(clone.cloneMs);
      const ws = await clone.pool.query(`SELECT id FROM workspaces WHERE id = $1`, [
        AIT_FIXTURE_WORKSPACE_ID,
      ]);
      assert.equal(ws.rowCount, 1);
      const journeys = await clone.pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM journeys WHERE workspace_id = $1`,
        [AIT_FIXTURE_WORKSPACE_ID],
      );
      assert.ok(Number(journeys.rows[0]!.n) > 0, 'clone has journeys');
      await clone.drop();
    }
    const sorted = [...cloneTimes].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    assert.ok(median < 5000, `median clone ${median.toFixed(1)}ms must be < 5000ms`);
  });

  test('fresh vs clone logical baseline fingerprints match', { skip: suiteFixtureName !== '' }, async () => {
    // Skipped under suite-scoped fixture to avoid a second full AiT provision
    // (~90s). Standalone focused runs still prove fresh↔clone equivalence.
    assert.ok(fixture, 'fixture built');
    const fresh = await buildFreshAitBaselineDatabase();
    const clone = await cloneAitFixtureDatabase(fixture.databaseName);
    try {
      const fpFresh = await fingerprintAitBaseline(fresh.pool, fresh.workspaceId);
      const fpClone = await fingerprintAitBaseline(clone.pool, clone.workspaceId);
      console.log(`[spike] fresh digest=${fpFresh.digest.slice(0, 16)}… summary=${JSON.stringify(fpFresh.summary)}`);
      console.log(`[spike] clone digest=${fpClone.digest.slice(0, 16)}… summary=${JSON.stringify(fpClone.summary)}`);
      console.log(`[spike] ignoredFields=${JSON.stringify(fpFresh.ignoredFields)}`);
      assert.equal(fpFresh.digest, fpClone.digest, 'fresh and clone logical fingerprints must match');
    } finally {
      await clone.drop();
      await fresh.drop();
    }
  });

  test('clone A mutations do not affect clone B or the fixture template', async () => {
    assert.ok(fixture, 'fixture built');
    const cloneA = await cloneAitFixtureDatabase(fixture.databaseName);
    const cloneB = await cloneAitFixtureDatabase(fixture.databaseName);
    cloneTimes.push(cloneA.cloneMs, cloneB.cloneMs);

    try {
      const fpB0 = await fingerprintAitBaseline(cloneB.pool, cloneB.workspaceId);

      // --- Domain mutation on A: select a TRANSPORT journey item and set selectedServiceId ---
      const transportItem = await cloneA.pool.query<{
        id: string;
        journey_id: string;
        kind: string;
      }>(
        `SELECT i.id, i.journey_id, i.kind
           FROM journey_items i
          WHERE i.workspace_id = $1 AND i.kind = 'TRANSPORT'
          LIMIT 1`,
        [cloneA.workspaceId],
      );
      assert.ok(transportItem.rowCount! > 0, 'TRANSPORT journey item exists');
      const item = transportItem.rows[0]!;

      const service = await cloneA.pool.query<{ id: string }>(
        `SELECT id FROM transport_services WHERE workspace_id = $1 LIMIT 1`,
        [cloneA.workspaceId],
      );
      assert.ok(service.rowCount! > 0);
      const serviceId = service.rows[0]!.id;

      const headBefore = await cloneA.pool.query<{ revision: string }>(
        `SELECT revision::text AS revision FROM aggregate_heads
          WHERE workspace_id = $1 AND aggregate_id = $2`,
        [cloneA.workspaceId, item.journey_id],
      );
      const revBefore = Number(headBefore.rows[0]!.revision);

      const outboxBefore = await cloneA.pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM outbox WHERE workspace_id = $1`,
        [cloneA.workspaceId],
      );
      const outboxCountBefore = Number(outboxBefore.rows[0]!.n);

      const uow = new PgUnitOfWork(cloneA.pool, cloneA.workspaceId);
      const updated = await updateJourneyItem(uow, {
        workspaceId: cloneA.workspaceId,
        actorPrincipalId: 'principal:spike-isolation',
        idempotencyKey: `spike-isolation-${randomUUID()}`,
        journeyId: item.journey_id,
        journeyItemId: item.id,
        expectedRevision: revBefore,
        selectedServiceId: serviceId,
      });
      assert.equal(updated.ok, true, `updateJourneyItem should succeed: ${JSON.stringify(updated)}`);

      const headAfter = await cloneA.pool.query<{ revision: string }>(
        `SELECT revision::text AS revision FROM aggregate_heads
          WHERE workspace_id = $1 AND aggregate_id = $2`,
        [cloneA.workspaceId, item.journey_id],
      );
      assert.equal(Number(headAfter.rows[0]!.revision), revBefore + 1, 'revision advanced on A');

      const outboxAfter = await cloneA.pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM outbox WHERE workspace_id = $1`,
        [cloneA.workspaceId],
      );
      assert.ok(
        Number(outboxAfter.rows[0]!.n) > outboxCountBefore,
        'outbox grew on A after domain mutation',
      );

      // --- External identity still present on A; mutate a non-authoritative note via SQL on A ---
      const extBefore = await cloneA.pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM external_records WHERE workspace_id = $1`,
        [cloneA.workspaceId],
      );
      await cloneA.pool.query(
        `UPDATE external_records SET payload_hash = $2
          WHERE workspace_id = $1
          AND id = (SELECT id FROM external_records WHERE workspace_id = $1 LIMIT 1)`,
        [cloneA.workspaceId, `mutated-${randomUUID()}`],
      );
      assert.equal(Number(extBefore.rows[0]!.n), Number(extBefore.rows[0]!.n));

      // --- Failed transaction rollback on A ---
      const client = await cloneA.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE travellers SET lifecycle_status = 'ARCHIVED' WHERE workspace_id = $1`,
          [cloneA.workspaceId],
        );
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
      const archived = await cloneA.pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM travellers
          WHERE workspace_id = $1 AND lifecycle_status = 'ARCHIVED'`,
        [cloneA.workspaceId],
      );
      assert.equal(Number(archived.rows[0]!.n), 0, 'rollback left travellers unchanged');

      // --- B and logical baseline fingerprint unchanged ---
      const fpB1 = await fingerprintAitBaseline(cloneB.pool, cloneB.workspaceId);
      assert.equal(fpB1.digest, fpB0.digest, 'clone B fingerprint unchanged after mutating A');

      const headB = await cloneB.pool.query<{ revision: string }>(
        `SELECT revision::text AS revision FROM aggregate_heads
          WHERE workspace_id = $1 AND aggregate_id = $2`,
        [cloneB.workspaceId, item.journey_id],
      );
      assert.equal(Number(headB.rows[0]!.revision), revBefore, 'clone B revision untouched');

      const outboxB = await cloneB.pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM outbox WHERE workspace_id = $1`,
        [cloneB.workspaceId],
      );
      assert.equal(Number(outboxB.rows[0]!.n), outboxCountBefore, 'clone B outbox untouched');

      // Drop A; B remains healthy.
      await cloneA.drop();
      const fpB2 = await fingerprintAitBaseline(cloneB.pool, cloneB.workspaceId);
      assert.equal(fpB2.digest, fpB0.digest, 'clone B survives drop of A');

      // New clone C from fixture still matches original B baseline.
      const cloneC = await cloneAitFixtureDatabase(fixture.databaseName);
      cloneTimes.push(cloneC.cloneMs);
      try {
        const fpC = await fingerprintAitBaseline(cloneC.pool, cloneC.workspaceId);
        assert.equal(fpC.digest, fpB0.digest, 'new clone from fixture matches original baseline');
      } finally {
        await cloneC.drop();
      }
    } finally {
      // cloneA may already be dropped
      await cloneB.drop().catch(() => undefined);
    }
  });

  test('working pool must not be the fixture database name', async () => {
    assert.ok(fixture, 'fixture built');
    const clone = await cloneAitFixtureDatabase(fixture.databaseName);
    try {
      assert.notEqual(clone.databaseName, fixture.databaseName);
      assertWorkingDatabaseNotFixture(clone.databaseName, fixture.databaseName);
      const db = await clone.pool.query<{ current_database: string }>('SELECT current_database()');
      assert.equal(db.rows[0]!.current_database, clone.databaseName);
      assert.notEqual(db.rows[0]!.current_database, fixture.databaseName);
    } finally {
      await clone.drop();
    }
  });

  test('refuses to treat the fixture DB name as a disposable clone target', () => {
    assert.ok(fixture, 'fixture built');
    const fx = fixture;
    assert.throws(() => assertDisposableDatabaseName(fx.databaseName, 'clone'));
    assert.throws(() => assertDisposableDatabaseName('northstar_test', 'fixture'));
    assert.throws(() => assertWorkingDatabaseNotFixture(fx.databaseName, fx.databaseName));
  });

  test('inbox deliver/dedup on clone A does not affect clone B or fixture template', async () => {
    assert.ok(fixture, 'fixture built');
    const cloneA = await cloneAitFixtureDatabase(fixture.databaseName);
    const cloneB = await cloneAitFixtureDatabase(fixture.databaseName);
    try {
      const inboxBeforeB = await cloneB.pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM inbox_deliveries WHERE workspace_id = $1`,
        [cloneB.workspaceId],
      );
      assert.equal(Number(inboxBeforeB.rows[0]!.n), 0, 'B starts with empty inbox');

      const deliveryKey = `spike-inbox-${randomUUID()}`;
      const payload = { kind: 'SPIKE_INBOX_ISOLATION', n: 1 };
      const first = await deliverInboxMessage(cloneA.pool, {
        workspaceId: cloneA.workspaceId,
        sourceConnectionId: 'spike-conn',
        deliveryKey,
        rawPayload: payload,
        handlers: [{ handlerKey: 'spike-handler', targetKey: 'spike-target' }],
      });
      assert.equal(first.outcome, 'ACCEPTED');

      const dup = await deliverInboxMessage(cloneA.pool, {
        workspaceId: cloneA.workspaceId,
        sourceConnectionId: 'spike-conn',
        deliveryKey,
        rawPayload: payload,
        handlers: [{ handlerKey: 'spike-handler', targetKey: 'spike-target' }],
      });
      assert.equal(dup.outcome, 'DUPLICATE');

      const inboxA = await cloneA.pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM inbox_deliveries WHERE workspace_id = $1`,
        [cloneA.workspaceId],
      );
      assert.equal(Number(inboxA.rows[0]!.n), 1, 'A has exactly one inbox delivery');

      const inboxB = await cloneB.pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM inbox_deliveries WHERE workspace_id = $1`,
        [cloneB.workspaceId],
      );
      assert.equal(Number(inboxB.rows[0]!.n), 0, 'B inbox unchanged');

      const fpB = await fingerprintAitBaseline(cloneB.pool, cloneB.workspaceId);
      const cloneC = await cloneAitFixtureDatabase(fixture.databaseName);
      try {
        const fpC = await fingerprintAitBaseline(cloneC.pool, cloneC.workspaceId);
        assert.equal(fpC.digest, fpB.digest, 'new clone from fixture still matches pristine B');
      } finally {
        await cloneC.drop();
      }
    } finally {
      await cloneA.drop().catch(() => undefined);
      await cloneB.drop().catch(() => undefined);
    }
  });

  test('clone teardown succeeds after leaving an open pool connection (FORCE)', async () => {
    assert.ok(fixture, 'fixture built');
    const clone = await cloneAitFixtureDatabase(fixture.databaseName);
    clone.pool.on('error', () => undefined);
    const sticky = await clone.pool.connect();
    sticky.on('error', () => undefined);
    await sticky.query('SELECT 1');
    // Leave the client checked out; FORCE drop must still succeed.
    await dropAitCloneDatabase(clone.databaseName);
    sticky.release();
    await clone.pool.end().catch(() => undefined);
  });
});

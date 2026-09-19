/**
 * R4-F — the programme schedule read model must plan and run on real PostgreSQL
 * (regression: an ungrouped `pi.workspace_id` in a correlated subquery made
 * /programme return a raw SQL 500). Generic world; no scenario is keyed.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import { openDisruptionCase, seedProgrammeWorld } from './r1ProgrammeWorld.ts';
import { attachSeedSession, commitSeed, rollbackSeed } from './m2Seed.ts';
import { seedParticipation } from './m4Seed.ts';
import { persistStrategyChangeRow } from './m8ExecutionGateHelpers.ts';
import { ActivityCursorError, loadActivityFeed, loadDecisionQueue, loadProgrammeSchedule } from '../src/app/target/readmodels/pgShellFacts.ts';
import { renderProductActivityFeed } from '../src/ui/screens/product-activity-feed.ts';
import { issueAuthorityDecision, persistActionPlan, recordApproval, revokeApproval } from '../src/persistence/postgres/commands/m8AuthorityCommands.ts';
import { createPrincipal } from '../src/persistence/postgres/commands/peopleCommands.ts';
import type { ActionPlan } from '../src/contracts/v2/action/actionPlan.ts';
import { DecisionQueueSchema, ProgrammeScheduleSchema } from '../src/contracts/v2/product/readModels.ts';

after(async () => { await (await sharedTestPool()).end(); });

test('loadProgrammeSchedule runs on PG and reports the affected case per item', async () => {
  const c = await openDisruptionCase('r4 programme schedule', undefined, {
    seed: async (label, spec) => {
      const world = await seedProgrammeWorld(label, spec);
      const seed = await attachSeedSession((await sharedTestPool()), world.workspaceId, world.actorId);
      let committed = false;
      try {
        // The same failed Journey has one required commitment that fails and a
        // second required commitment whose own participation remains feasible.
        await seedParticipation(seed, {
          programmeItemId: world.peerItemId,
          travellerId: world.people[0]!.travellerId,
          obligation: 'REQUIRED',
          accepted: true,
        });
        await commitSeed(seed);
        committed = true;
        return world;
      } finally {
        if (!committed) await rollbackSeed(seed);
      }
    },
  });
  const schedule = await loadProgrammeSchedule(c.pool, c.world.workspaceId);
  ProgrammeScheduleSchema.parse(schedule);
  assert.ok(Array.isArray(schedule.items));
  assert.ok(schedule.items.length > 0, 'the world has programme items');
  assert.ok(schedule.populationSummary);
  assert.equal(schedule.populationSummary!.total, schedule.travellers!.length);
  assert.ok(schedule.travellers!.some((traveller) => traveller.journeyRefs.includes(c.world.people[0]!.journeyId)));
  assert.equal(new Set(schedule.items.map((item) => item.itemRef)).size, schedule.items.length, 'schedule items are not duplicated by participation rows');
  assert.ok(schedule.items.some((item) => item.affectedCaseRef), 'an affected programme item keeps its case link');
  assert.ok(schedule.endangeredCommitments?.some((commitment) => commitment.caseRefs.length > 0), 'endangered commitments keep case links');
  assert.ok(schedule.endangeredCommitments?.every((commitment) => new Set(commitment.affectedTravellerRefs).size === commitment.affectedTravellerRefs.length));
  const endangeredRefs = new Set(schedule.endangeredCommitments?.map((commitment) => commitment.commitmentRef));
  assert.ok(endangeredRefs.has(`PROGRAMME_ITEM:${c.world.earlyItemId}`), 'the failing required participation endangers its own item');
  assert.equal(endangeredRefs.has(`PROGRAMME_ITEM:${c.world.peerItemId}`), false, 'an unrelated required participation on the failed Journey stays safe');
  assert.equal(schedule.items.find((item) => item.itemRef === `PROGRAMME_ITEM:${c.world.peerItemId}`)?.affectedCaseRef, undefined);
});

test('Decision history reads approvals and revocations through their case plan without changing Waiting now', async () => {
  const c = await openDisruptionCase('r4 decision history');
  const journeyId = c.world.people[0]!.journeyId;
  const planId = randomUUID();
  const intentId = randomUUID();
  const recoveryStrategyId = randomUUID();
  const scenarioChangeId = randomUUID();
  await persistStrategyChangeRow(c.pool, c.world.workspaceId, c.world.actorId, c.caseId, {
    id: scenarioChangeId,
    recoveryStrategyId,
    strategyVersion: 1,
    affectedSubjectRefs: [{ kind: 'JOURNEY', id: journeyId }],
    effects: [],
  });
  const plan: ActionPlan = {
    id: planId,
    recoveryCaseId: c.caseId,
    scenarioChangeId,
    intents: [{
      id: intentId,
      actionPlanId: planId,
      operationNamespace: 'internal.programme',
      logicalOperationKey: `decision-history:${intentId}`,
      requestFingerprint: `fingerprint:${intentId}`,
      capabilityRef: 'internal.programme',
      subjectRefs: [{ kind: 'JOURNEY', id: journeyId }],
      expectedRevisions: [],
      preconditions: [],
      requiredAuthorityScopes: [],
      expectedObservations: ['programme_state'],
      compensationPolicy: { supported: false, requiresSeparateAuthority: true },
      status: 'PROPOSED',
    }],
    dependencies: [],
  };
  const persisted = await persistActionPlan(c.app.unitOfWork(), {
    workspaceId: c.world.workspaceId,
    actorPrincipalId: c.world.actorId,
    idempotencyKey: randomUUID(),
    plan,
    recoveryStrategyId,
  });
  assert.equal(persisted.ok, true, JSON.stringify(persisted));
  const scope = [{ kind: 'JOURNEY' as const, id: journeyId }];
  const decision = await issueAuthorityDecision(c.app.unitOfWork(), {
    workspaceId: c.world.workspaceId,
    actorPrincipalId: c.world.actorId,
    idempotencyKey: randomUUID(),
    envelopeInput: {
      actionPlanId: planId,
      actionPlanVersion: 1,
      actionIntentId: intentId,
      actionIntentVersion: 1,
      requiredActorRoles: ['CASE_OWNER'],
      scope,
      grantRefs: [],
      ruleInputs: [],
    },
    requirements: [{ actorRole: 'CASE_OWNER' }],
    issuedAt: c.now,
  });
  assert.equal(decision.ok, true, JSON.stringify(decision));
  const approval = await recordApproval(c.app.unitOfWork(), {
    workspaceId: c.world.workspaceId,
    actorPrincipalId: c.operatorPrincipalId,
    idempotencyKey: randomUUID(),
    decisionId: decision.value.decisionId,
    requirementId: decision.value.requirementIds[0]!,
    envelopeFingerprint: decision.value.fingerprint,
    scope,
    approvedAt: '2031-09-15T08:00:00.000Z',
  });
  assert.equal(approval.ok, true, JSON.stringify(approval));
  const revokerId = randomUUID();
  const revoker = await createPrincipal(c.app.unitOfWork(), {
    workspaceId: c.world.workspaceId,
    actorPrincipalId: c.operatorPrincipalId,
    idempotencyKey: randomUUID(),
    principalId: revokerId,
    actorType: 'SERVICE',
    authIssuer: 'urn:test:decision-history',
    authSubject: revokerId,
  });
  assert.equal(revoker.ok, true, JSON.stringify(revoker));
  const revoked = await revokeApproval(c.app.unitOfWork(), {
    workspaceId: c.world.workspaceId,
    actorPrincipalId: revokerId,
    idempotencyKey: randomUUID(),
    approvalId: approval.value.approvalId,
    revokedAt: '2031-09-15T09:00:00.000Z',
  });
  assert.equal(revoked.ok, true, JSON.stringify(revoked));

  const queue = await loadDecisionQueue(c.pool, c.world.workspaceId);
  DecisionQueueSchema.parse(queue);
  assert.equal(queue.decisions.find((row) => row.caseRef === c.caseId)?.awaitingAuthority, false, 'history must not turn an open case into a waiting decision');
  assert.deepEqual(queue.recentDecisions?.map((row) => row.kind), ['revocation', 'approval']);
  assert.ok(queue.recentDecisions?.every((row) => row.caseRef === c.caseId));
  assert.deepEqual(queue.recentDecisions?.map((row) => row.actorLabel), ['Reviewer', 'Person']);
  assert.deepEqual(queue.recentDecisions?.map((row) => row.label), ['Programme time change', 'Programme time change']);
  assert.ok(queue.recentDecisions?.every((row) => !row.label.includes('Participant')));
  assert.ok(queue.recentDecisions?.every((row) => !row.actorLabel.includes(c.operatorPrincipalId)));
});

test('Activity pages preserve complete PG ordering across timestamp ties and new arrivals', async () => {
  const c = await openDisruptionCase('activity pagination');
  const workspaceId = c.world.workspaceId;
  // One command may change multiple subjects. Seed a bounded audit-page fixture
  // linked to a real command receipt, with a microsecond timestamp shared by rows.
  await c.pool.query(`INSERT INTO change_records
    (workspace_id, command_namespace, idempotency_key, actor_principal_id, subject_kind,
     subject_id, after_revision, occurred_at)
    SELECT workspace_id, command_namespace, idempotency_key, actor_principal_id, subject_kind,
           subject_id, after_revision, '2035-01-01T12:00:00.123456Z'::timestamptz
      FROM (SELECT * FROM change_records WHERE workspace_id = $1 LIMIT 1) source
      CROSS JOIN generate_series(1, 45)`, [workspaceId]);
  const expected = await c.pool.query<{ id: string }>(
    'SELECT id FROM change_records WHERE workspace_id = $1 ORDER BY occurred_at DESC, id DESC', [workspaceId]);
  const first = await loadActivityFeed(c.pool, workspaceId);
  assert.equal(first.entries.length, 20);
  assert.ok(first.nextCursor);
  assert.match(renderProductActivityFeed(first), /Older activity/);
  // A newly committed row cannot shift or duplicate the anchored older pages.
  await c.pool.query(`INSERT INTO change_records
    (workspace_id, command_namespace, idempotency_key, actor_principal_id, subject_kind,
     subject_id, after_revision, occurred_at)
    SELECT workspace_id, command_namespace, idempotency_key, actor_principal_id, subject_kind,
           subject_id, after_revision, '2036-01-01T12:00:00Z'::timestamptz
      FROM change_records WHERE workspace_id = $1 LIMIT 1`, [workspaceId]);
  const seen = first.entries.map((entry) => entry.entryRef);
  let cursor: string | undefined = first.nextCursor;
  while (cursor) {
    const page = await loadActivityFeed(c.pool, workspaceId, cursor);
    assert.equal(page.beforeCursor, cursor);
    assert.match(renderProductActivityFeed(page), /Latest activity/);
    seen.push(...page.entries.map((entry) => entry.entryRef));
    cursor = page.nextCursor;
  }
  assert.deepEqual(seen, expected.rows.map((row) => row.id));
  await assert.rejects(loadActivityFeed(c.pool, workspaceId, 'invalid'), ActivityCursorError);
  await assert.rejects(loadActivityFeed(c.pool, '00000000-0000-4000-8000-000000000001', first.nextCursor), ActivityCursorError);
});

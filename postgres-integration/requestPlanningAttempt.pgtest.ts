import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed, seedJourney, seedRootSubject, seedTraveller, seedTrip, attachSeedSession } from './m2Seed.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { bootstrapIssueAuthorityGrant, createPrincipal } from '../src/persistence/postgres/commands/peopleCommands.ts';
import { submitChangeRequest, transitionChangeRequest } from '../src/persistence/postgres/commands/changeRequestCommands.ts';
import { persistRecoveryPlanningAttempt, persistRecoveryPlanningCompletion, loadRecoveryPlanningAttempt } from '../src/persistence/postgres/commands/r1PlanningAttemptCommands.ts';
import { assemblePlanningAttempt } from '../src/resolution/planning/decisionEvidence.ts';

const AT = '2031-06-01T12:00:00.000Z';
const LATER = '2031-06-01T12:00:05.000Z';

function mustOk<T>(outcome: { ok: boolean; value?: T; conflict?: { kind: string; message: string } }): T {
  assert.equal(outcome.ok, true, outcome.ok ? '' : `${outcome.conflict?.kind}: ${outcome.conflict?.message}`);
  return outcome.value!;
}

test('request planning attempt persists accepted immutable request basis beside a truthful PASS assessment', async () => {
  const pool = await sharedTestPool();
  const seed = await beginSeed(pool, 'request planning attempt');
  const traveller = await seedTraveller(seed, { displayName: 'Request planner traveller' });
  const tripId = await seedTrip(seed, { purpose: 'request planning' });
  const journeyId = await seedJourney(seed, { tripId, travellerId: traveller.travellerId });
  const caseId = await seedRootSubject(seed, { kind: 'RECOVERY_CASE' });
  await seed.client.query(`INSERT INTO recovery_cases (workspace_id, id, lifecycle_status, created_by_actor_id) VALUES ($1,$2,'PLANNING',$3)`, [seed.workspaceId, caseId, seed.actorId]);
  const assessmentId = randomUUID();
  await seed.client.query(
    `INSERT INTO assessments (workspace_id,id,kind,subject_kind,subject_id,evaluated_at,overall_verdict,manifest_detail,manifest_schema_version,created_by_actor_id)
     VALUES ($1,$2,'VIABILITY','JOURNEY',$3,$4::timestamptz,'PASS',$5::jsonb,'request-planning-test',$6)`,
    [seed.workspaceId, assessmentId, journeyId, AT, JSON.stringify({ capture: null, coverageReads: [], missingCoverage: [], evaluatedAt: AT }), seed.actorId],
  );
  await commitSeed(seed);

  const source = await attachSeedSession(pool, seed.workspaceId, seed.actorId);
  const sourceRecordId = await seedRootSubject(source, { kind: 'SOURCE_RECORD' });
  await source.client.query(
    `INSERT INTO source_records (workspace_id,id,source_identity,received_at,content_hash,content_type,capture_metadata,capture_metadata_version,created_by_actor_id)
     VALUES ($1,$2,'request-planning-test',$3::timestamptz,$4,'text/plain','{}','request-planning-test',$5)`,
    [seed.workspaceId, sourceRecordId, AT, 'f'.repeat(64), seed.actorId],
  );
  await commitSeed(source);

  const requesterId = randomUUID();
  const issuerId = randomUUID();
  const uow = () => new PgUnitOfWork(pool, seed.workspaceId);
  mustOk(await createPrincipal(uow(), { workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), principalId: requesterId, actorType: 'HUMAN', authIssuer: 'urn:test:requester', authSubject: requesterId }));
  mustOk(await createPrincipal(uow(), { workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), principalId: issuerId, actorType: 'SYSTEM', authIssuer: 'urn:test:issuer', authSubject: issuerId }));
  const grantKey = randomUUID();
  mustOk(await bootstrapIssueAuthorityGrant(uow(), {
    workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: grantKey, grantId: randomUUID(),
    principalId: requesterId, representedPartyRef: { kind: 'TRAVELLER', id: traveller.travellerId }, issuedByPrincipalId: issuerId,
    issuedAt: '1970-01-01T00:00:00.000Z', actions: ['change.request.submit'], scopes: [{ kind: 'JOURNEY', id: journeyId }],
    authorisingReceipt: { commandNamespace: 'AUTHORITY_GRANT_ISSUED', idempotencyKey: grantKey }, expectedAggregateRevisions: [],
  }));
  const requestId = randomUUID();
  mustOk(await submitChangeRequest(uow(), {
    workspaceId: seed.workspaceId, actorPrincipalId: requesterId, idempotencyKey: randomUUID(), changeRequestId: requestId,
    representedTravellerId: traveller.travellerId, journeyId, sourceRecordId, sourceUtterance: 'Please arrive before noon.', submittedAt: AT,
    intentKind: 'CHANGE_TRANSPORT_SCHEDULE', urgency: 'HARD_INSTRUCTION', desiredTarget: { arriveBy: '2031-06-02T12:00:00.000Z' },
  }, { authorizationNow: () => AT }));
  const accepted = mustOk(await transitionChangeRequest(uow(), {
    workspaceId: seed.workspaceId, actorPrincipalId: requesterId, idempotencyKey: randomUUID(), changeRequestId: requestId,
    expectedRevision: 1, from: 'SUBMITTED', to: 'ACCEPTED_FOR_PLANNING', transitionedAt: AT,
  }, { authorizationNow: () => AT }));

  const requestBasis = {
    changeRequestId: requestId, journeyId, representedTravellerId: traveller.travellerId,
    contentRevision: 1, lifecycleRevision: accepted.revision, lifecycle: 'ACCEPTED_FOR_PLANNING' as const,
    urgency: 'HARD_INSTRUCTION' as const, desiredTarget: { arriveBy: '2031-06-02T12:00:00.000Z', travelWithTravellerIds: [], objectiveEffects: [] },
  };
  const attempt = assemblePlanningAttempt({
    id: randomUUID(), recoveryCaseId: caseId, basisAssessmentId: assessmentId, requestBasis,
    basisManifest: { evaluatedAt: AT, evaluatorVersions: [], aggregateReads: [{ aggregateRef: { kind: 'CHANGE_REQUEST', id: requestId }, revision: accepted.revision }], scopeReads: [], evidenceReads: [], coverageReads: [], missingCoverage: [] },
    startedAt: AT, completedAt: LATER, coordinatorVersion: 'request-planning/1', domains: [], evidence: [], materialCandidates: [], viableStrategyRefs: [],
  });
  mustOk(await persistRecoveryPlanningAttempt(uow(), { workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), attempt, outcome: 'NO_RECOVERY_FOUND' }));
  const stored = await loadRecoveryPlanningAttempt(pool, seed.workspaceId, attempt.id);
  assert.deepEqual(stored?.attempt.requestBasis, requestBasis);
  // A later lifecycle transition advances the request aggregate head. The old
  // immutable request basis cannot complete a fresh planning attempt afterwards.
  const closed = mustOk(await transitionChangeRequest(uow(), {
    workspaceId: seed.workspaceId, actorPrincipalId: requesterId, idempotencyKey: randomUUID(), changeRequestId: requestId,
    expectedRevision: accepted.revision, from: 'ACCEPTED_FOR_PLANNING', to: 'CLOSED', transitionedAt: LATER,
  }, { authorizationNow: () => AT }));
  assert.equal(closed.revision, accepted.revision + 1);
  const head = await pool.query<{ revision: string }>('SELECT revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2', [seed.workspaceId, requestId]);
  assert.equal(Number(head.rows[0]?.revision), closed.revision);
  const staleAttempt = assemblePlanningAttempt({
    ...attempt,
    id: randomUUID(),
    completedAt: '2031-06-01T12:00:10.000Z',
  });
  const stale = await persistRecoveryPlanningCompletion(uow(), {
    workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(),
    attempt: staleAttempt, outcome: 'NEEDS_EVIDENCE_OR_DECISION', viableStrategies: [],
  });
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.equal(stale.conflict.kind, 'STALE_AGGREGATE_REVISION');
  const noTravelWrites = await pool.query<{ services: string; reservations: string }>(
    `SELECT (SELECT count(*)::text FROM transport_services WHERE workspace_id=$1) AS services, (SELECT count(*)::text FROM reservations WHERE workspace_id=$1) AS reservations`, [seed.workspaceId],
  );
  assert.deepEqual(noTravelWrites.rows[0], { services: '0', reservations: '0' });
});

after(async () => { const pool = await sharedTestPool(); await pool.end(); });

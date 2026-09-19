import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool } from '../src/persistence/postgres/pool.ts';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed, seedJourney, seedRootSubject, seedTraveller, seedTrip, attachSeedSession } from './m2Seed.ts';
import { seedPlace } from './m4Seed.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { bootstrapIssueAuthorityGrant, createPrincipal } from '../src/persistence/postgres/commands/peopleCommands.ts';
import { loadChangeRequest, submitChangeRequest, transitionChangeRequest } from '../src/persistence/postgres/commands/changeRequestCommands.ts';
import { admitChangeRequest } from '../src/app/target/changeRequestAdmission.ts';

const AT = '2030-01-01T00:00:00.000Z';
let pool: Pool;

function mustOk<T>(outcome: { ok: true; value: T } | { ok: false; conflict: unknown }): T {
  assert.equal(outcome.ok, true, outcome.ok ? '' : JSON.stringify(outcome.conflict));
  if (!outcome.ok) throw new Error('unreachable');
  return outcome.value;
}

before(async () => { pool = await sharedTestPool(); });
after(async () => { await pool?.end(); });

test('ChangeRequest persists immutable desired state under exact request authority without changing travel state', async () => {
  const seed = await beginSeed(pool, 'A1 ChangeRequest persistence');
  const represented = await seedTraveller(seed, { displayName: 'Represented traveller' });
  const other = await seedTraveller(seed, { displayName: 'Other traveller' });
  const trip = await seedTrip(seed, { purpose: 'Change request scope', lifecycleStatus: 'ACTIVE' });
  const otherTrip = await seedTrip(seed, { purpose: 'Other scope', lifecycleStatus: 'ACTIVE' });
  const journeyId = await seedJourney(seed, { tripId: trip, travellerId: represented.travellerId, lifecycleStatus: 'ACTIVE' });
  const otherJourneyId = await seedJourney(seed, { tripId: otherTrip, travellerId: other.travellerId, lifecycleStatus: 'ACTIVE' });
  const placeId = await seedPlace(seed, { name: 'Requested stay place' });
  await commitSeed(seed);

  const sourceSeed = await attachSeedSession(pool, seed.workspaceId, seed.actorId);
  const sourceRecordId = await seedRootSubject(sourceSeed, { kind: 'SOURCE_RECORD' });
  await sourceSeed.client.query(
    `INSERT INTO source_records (workspace_id, id, source_identity, received_at, content_hash, content_type, capture_metadata, capture_metadata_version, created_by_actor_id)
     VALUES ($1, $2, 'traveller-intake', $3::timestamptz, $4, 'text/plain', '{}', 'change-request/1', $5)`,
    [seed.workspaceId, sourceRecordId, AT, 'a'.repeat(64), seed.actorId],
  );
  await commitSeed(sourceSeed);

  const requesterId = randomUUID();
  const systemIssuerId = randomUUID();
  const uow = () => new PgUnitOfWork(pool, seed.workspaceId);
  const trustedClock = { authorizationNow: () => AT };
  mustOk(await createPrincipal(uow(), { workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), principalId: requesterId, actorType: 'HUMAN', authIssuer: 'urn:test:requester', authSubject: requesterId }));
  mustOk(await createPrincipal(uow(), { workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), principalId: systemIssuerId, actorType: 'SYSTEM', authIssuer: 'urn:test:issuer', authSubject: systemIssuerId }));
  const grantKey = randomUUID();
  const grant = mustOk(await bootstrapIssueAuthorityGrant(uow(), {
    workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: grantKey, grantId: randomUUID(),
    principalId: requesterId, representedPartyRef: { kind: 'TRAVELLER', id: represented.travellerId }, issuedByPrincipalId: systemIssuerId,
    issuedAt: '1970-01-01T00:00:00.000Z', actions: ['change.request.submit'], scopes: [{ kind: 'JOURNEY', id: journeyId }],
    authorisingReceipt: { commandNamespace: 'AUTHORITY_GRANT_ISSUED', idempotencyKey: grantKey }, expectedAggregateRevisions: [],
  }));

  const requestId = randomUUID();
  const submissionKey = randomUUID();
  const input = {
    workspaceId: seed.workspaceId, actorPrincipalId: requesterId, idempotencyKey: submissionKey,
    changeRequestId: requestId, representedTravellerId: represented.travellerId, journeyId, sourceRecordId,
    sourceUtterance: 'Please move my stay closer to the requested place.', submittedAt: AT,
    intentKind: 'CHANGE_STAY' as const, urgency: 'HARD_INSTRUCTION' as const,
    desiredTarget: { preferredStayPlaceId: placeId, travelWithTravellerIds: [other.travellerId] },
    fundingDeclaration: 'TRAVELLER_FUNDED' as const,
  };
  const beforeJourney = await pool.query<{ lifecycle_status: string }>('SELECT lifecycle_status FROM journeys WHERE workspace_id = $1 AND id = $2', [seed.workspaceId, journeyId]);
  const first = mustOk(await submitChangeRequest(uow(), input, trustedClock));
  assert.deepEqual(first, { changeRequestId: requestId, lifecycle: 'SUBMITTED', revision: 1 });
  const replay = mustOk(await submitChangeRequest(uow(), input, trustedClock));
  assert.deepEqual(replay, first, 'same idempotency key returns the original result');
  const hashConflict = await submitChangeRequest(uow(), { ...input, sourceUtterance: 'Changed payload under the same key.' }, trustedClock);
  assert.equal(hashConflict.ok, false);
  if (!hashConflict.ok) assert.equal(hashConflict.conflict.kind, 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');

  const stored = await loadChangeRequest(pool, seed.workspaceId, requestId);
  assert.ok(stored);
  assert.equal(stored.sourceUtterance, input.sourceUtterance);
  assert.equal(stored.sourceRecordId, sourceRecordId);
  assert.equal(stored.requesterPrincipalId, requesterId);
  assert.equal(stored.representedTravellerId, represented.travellerId);
  assert.deepEqual(stored.targets, [
    { role: 'STAY_PLACE', targetRef: { kind: 'PLACE', id: placeId } },
    { role: 'TRAVEL_WITH_TRAVELLER', targetRef: { kind: 'TRAVELLER', id: other.travellerId } },
  ]);
  const afterJourney = await pool.query<{ lifecycle_status: string }>('SELECT lifecycle_status FROM journeys WHERE workspace_id = $1 AND id = $2', [seed.workspaceId, journeyId]);
  assert.equal(afterJourney.rows[0]?.lifecycle_status, beforeJourney.rows[0]?.lifecycle_status, 'submission never changes canonical Journey state');
  const services = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM transport_services WHERE workspace_id = $1', [seed.workspaceId]);
  const reservations = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM reservations WHERE workspace_id = $1', [seed.workspaceId]);
  assert.equal(services.rows[0]?.n, 0);
  assert.equal(reservations.rows[0]?.n, 0);

  const accepted = mustOk(await transitionChangeRequest(uow(), { workspaceId: seed.workspaceId, actorPrincipalId: requesterId, idempotencyKey: randomUUID(), changeRequestId: requestId, expectedRevision: 1, from: 'SUBMITTED', to: 'ACCEPTED_FOR_PLANNING', transitionedAt: AT }, trustedClock));
  assert.deepEqual(accepted, { changeRequestId: requestId, lifecycle: 'ACCEPTED_FOR_PLANNING', revision: 2 });
  const acceptedRead = await loadChangeRequest(pool, seed.workspaceId, requestId);
  assert.equal(acceptedRead?.revision, 2, 'read exposes the current lifecycle revision for the next CAS');
  assert.equal(acceptedRead?.lifecycle, 'ACCEPTED_FOR_PLANNING');
  assert.equal(acceptedRead?.sourceUtterance, input.sourceUtterance, 'lifecycle changes preserve the immutable submitted desire');
  const stale = await transitionChangeRequest(uow(), { workspaceId: seed.workspaceId, actorPrincipalId: requesterId, idempotencyKey: randomUUID(), changeRequestId: requestId, expectedRevision: 1, from: 'SUBMITTED', to: 'WITHDRAWN', transitionedAt: AT }, trustedClock);
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.equal(stale.conflict.kind, 'STALE_AGGREGATE_REVISION');

  const crossTraveller = await submitChangeRequest(uow(), { ...input, idempotencyKey: randomUUID(), changeRequestId: randomUUID(), representedTravellerId: other.travellerId, journeyId: otherJourneyId }, trustedClock);
  assert.equal(crossTraveller.ok, false);
  if (!crossTraveller.ok) assert.equal(crossTraveller.conflict.kind, 'AUTHORITY_DENIED');
  const absentPrincipal = await submitChangeRequest(uow(), { ...input, actorPrincipalId: randomUUID(), idempotencyKey: randomUUID(), changeRequestId: randomUUID() }, trustedClock);
  assert.equal(absentPrincipal.ok, false);
  if (!absentPrincipal.ok) assert.equal(absentPrincipal.conflict.kind, 'AUTHORITY_DENIED');

  await pool.query("UPDATE principals SET status = 'SUSPENDED' WHERE workspace_id = $1 AND id = $2", [seed.workspaceId, requesterId]);
  const inactive = await submitChangeRequest(uow(), { ...input, idempotencyKey: randomUUID(), changeRequestId: randomUUID() }, trustedClock);
  assert.equal(inactive.ok, false);
  if (!inactive.ok) assert.equal(inactive.conflict.kind, 'AUTHORITY_DENIED');
  await pool.query("UPDATE principals SET status = 'ACTIVE' WHERE workspace_id = $1 AND id = $2", [seed.workspaceId, requesterId]);

  await pool.query('UPDATE authority_grants SET expires_at = $3::timestamptz WHERE workspace_id = $1 AND id = $2', [seed.workspaceId, grant.grantId, '2029-12-31T00:00:00.000Z']);
  const backdatedExpiry = await submitChangeRequest(uow(), { ...input, submittedAt: '2028-01-01T00:00:00.000Z', idempotencyKey: randomUUID(), changeRequestId: randomUUID() }, trustedClock);
  assert.equal(backdatedExpiry.ok, false, 'reported event time cannot backdate an expired request grant');
  if (!backdatedExpiry.ok) assert.equal(backdatedExpiry.conflict.kind, 'AUTHORITY_DENIED');
  await pool.query('UPDATE authority_grants SET expires_at = NULL WHERE workspace_id = $1 AND id = $2', [seed.workspaceId, grant.grantId]);

  // An execution-oriented grant for the same principal/scope is still not a
  // request grant. The command requires the distinct submit action exactly.
  await pool.query('DELETE FROM grant_actions WHERE workspace_id = $1 AND grant_id = $2', [seed.workspaceId, grant.grantId]);
  await pool.query("INSERT INTO grant_actions (workspace_id, grant_id, action_kind) VALUES ($1, $2, 'action.intent.dispatch')", [seed.workspaceId, grant.grantId]);
  const wrongAction = await submitChangeRequest(uow(), { ...input, idempotencyKey: randomUUID(), changeRequestId: randomUUID() }, trustedClock);
  assert.equal(wrongAction.ok, false);
  if (!wrongAction.ok) assert.equal(wrongAction.conflict.kind, 'AUTHORITY_DENIED');
  await pool.query('DELETE FROM grant_actions WHERE workspace_id = $1 AND grant_id = $2', [seed.workspaceId, grant.grantId]);
  await pool.query("INSERT INTO grant_actions (workspace_id, grant_id, action_kind) VALUES ($1, $2, 'change.request.submit')", [seed.workspaceId, grant.grantId]);

  await pool.query('UPDATE authority_grants SET revoked_at = $3::timestamptz WHERE workspace_id = $1 AND id = $2', [seed.workspaceId, grant.grantId, '2029-12-31T00:00:00.000Z']);
  const revoked = await transitionChangeRequest(uow(), { workspaceId: seed.workspaceId, actorPrincipalId: requesterId, idempotencyKey: randomUUID(), changeRequestId: requestId, expectedRevision: 2, from: 'ACCEPTED_FOR_PLANNING', to: 'CLOSED', transitionedAt: AT }, trustedClock);
  assert.equal(revoked.ok, false);
  if (!revoked.ok) assert.equal(revoked.conflict.kind, 'AUTHORITY_DENIED');
});

test('A1 admission is deterministic, grant-gated, and leaves canonical travel state untouched', async () => {
  const seed = await beginSeed(pool, 'A1 ChangeRequest admission');
  const represented = await seedTraveller(seed, { displayName: 'Represented traveller' });
  const other = await seedTraveller(seed, { displayName: 'Other traveller' });
  const trip = await seedTrip(seed, { purpose: 'Admission scope', lifecycleStatus: 'ACTIVE' });
  const otherTrip = await seedTrip(seed, { purpose: 'Other admission scope', lifecycleStatus: 'ACTIVE' });
  const journeyId = await seedJourney(seed, { tripId: trip, travellerId: represented.travellerId, lifecycleStatus: 'ACTIVE' });
  const otherJourneyId = await seedJourney(seed, { tripId: otherTrip, travellerId: other.travellerId, lifecycleStatus: 'ACTIVE' });
  await commitSeed(seed);

  const requesterId = randomUUID();
  const issuerId = randomUUID();
  const uow = () => new PgUnitOfWork(pool, seed.workspaceId);
  mustOk(await createPrincipal(uow(), { workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), principalId: requesterId, actorType: 'HUMAN', authIssuer: 'urn:test:requester', authSubject: requesterId }));
  mustOk(await createPrincipal(uow(), { workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), principalId: issuerId, actorType: 'SYSTEM', authIssuer: 'urn:test:issuer', authSubject: issuerId }));
  const grantId = randomUUID();
  const grantKey = randomUUID();
  mustOk(await bootstrapIssueAuthorityGrant(uow(), {
    workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: grantKey, grantId,
    principalId: requesterId, representedPartyRef: { kind: 'TRAVELLER', id: represented.travellerId }, issuedByPrincipalId: issuerId,
    issuedAt: '1970-01-01T00:00:00.000Z', actions: ['change.request.submit'], scopes: [{ kind: 'JOURNEY', id: journeyId }],
    authorisingReceipt: { commandNamespace: 'AUTHORITY_GRANT_ISSUED', idempotencyKey: grantKey }, expectedAggregateRevisions: [],
  }));

  let plannerCalls = 0;
  const deps = {
    pool,
    uow,
    planner: {
      async planCase(input: unknown) {
        plannerCalls++;
        return { acceptedBasis: input };
      },
    },
  };
  const admission = {
    workspaceId: seed.workspaceId, principalId: requesterId, journeyId,
    sourceUtterance: 'Please move my trip window.', intentKind: 'ADJUST_TRIP_WINDOW' as const,
    urgency: 'HARD_INSTRUCTION' as const, desiredTarget: { arriveBy: '2030-01-02T00:00:00.000Z', travelWithTravellerIds: [], objectiveEffects: [] },
    idempotencyKey: randomUUID(), now: AT,
  };
  const baselineSources = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM source_records WHERE workspace_id = $1', [seed.workspaceId]);
  const first = await admitChangeRequest(deps, admission);
  assert.equal(first.ok, true, first.ok ? '' : JSON.stringify(first.conflict));
  if (!first.ok) throw new Error('unreachable');
  assert.equal(first.value.lifecycle, 'ACCEPTED_FOR_PLANNING');
  assert.equal(first.value.planning.status, 'PLANNED');
  assert.equal(plannerCalls, 1);
  const replay = await admitChangeRequest(deps, admission);
  assert.equal(replay.ok, true, replay.ok ? '' : JSON.stringify(replay.conflict));
  if (!replay.ok) throw new Error('unreachable');
  assert.deepEqual(replay.value, first.value, 'same key resumes the same durable identities');
  assert.equal(plannerCalls, 2, 'a retry hands the same accepted case to the composed planner');

  const plannerFailure = await admitChangeRequest({
    ...deps,
    planner: { async planCase() { throw new Error('planner temporarily unavailable'); } },
  }, { ...admission, idempotencyKey: randomUUID() });
  assert.equal(plannerFailure.ok, true, plannerFailure.ok ? '' : JSON.stringify(plannerFailure.conflict));
  if (!plannerFailure.ok) throw new Error('unreachable');
  assert.equal(plannerFailure.value.lifecycle, 'ACCEPTED_FOR_PLANNING');
  assert.equal(plannerFailure.value.planning.status, 'RETRYABLE_FAILURE');

  const rows = await pool.query<{ source_count: number; request_count: number; signal_count: number; case_count: number }>(
    `SELECT
       (SELECT count(*)::int FROM source_records WHERE workspace_id = $1) AS source_count,
       (SELECT count(*)::int FROM change_requests WHERE workspace_id = $1) AS request_count,
       (SELECT count(*)::int FROM change_signals WHERE workspace_id = $1) AS signal_count,
       (SELECT count(*)::int FROM recovery_cases WHERE workspace_id = $1) AS case_count`,
    [seed.workspaceId],
  );
  assert.equal(rows.rows[0]?.source_count, (baselineSources.rows[0]?.n ?? 0) + 2);
  assert.equal(rows.rows[0]?.request_count, 2);
  assert.equal(rows.rows[0]?.signal_count, 2);
  assert.equal(rows.rows[0]?.case_count, 2);
  const stored = await loadChangeRequest(pool, seed.workspaceId, first.value.changeRequestId);
  assert.equal(stored?.lifecycle, 'ACCEPTED_FOR_PLANNING');
  assert.equal(stored?.representedTravellerId, represented.travellerId, 'traveller comes from the Journey');
  const links = await pool.query<{ subject_kind: string; subject_id: string }>(
    'SELECT subject_kind, subject_id FROM case_subjects WHERE workspace_id = $1 AND recovery_case_id = $2 ORDER BY subject_kind, subject_id',
    [seed.workspaceId, first.value.recoveryCaseId],
  );
  assert.deepEqual(links.rows, [
    { subject_kind: 'CHANGE_REQUEST', subject_id: first.value.changeRequestId },
    { subject_kind: 'JOURNEY', subject_id: journeyId },
    { subject_kind: 'TRAVELLER', subject_id: represented.travellerId },
  ]);
  const canonicalCounts = await pool.query<{ services: number; reservations: number; items: number }>(
    `SELECT
       (SELECT count(*)::int FROM transport_services WHERE workspace_id = $1) AS services,
       (SELECT count(*)::int FROM reservations WHERE workspace_id = $1) AS reservations,
       (SELECT count(*)::int FROM journey_items WHERE workspace_id = $1) AS items`,
    [seed.workspaceId],
  );
  assert.deepEqual(canonicalCounts.rows[0], { services: 0, reservations: 0, items: 0 });

  const beforeMismatch = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM source_records WHERE workspace_id = $1', [seed.workspaceId]);
  const mismatch = await admitChangeRequest(deps, { ...admission, sourceUtterance: 'A different utterance under the same key.' });
  assert.equal(mismatch.ok, false);
  if (!mismatch.ok) assert.equal(mismatch.conflict.kind, 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');
  const afterMismatch = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM source_records WHERE workspace_id = $1', [seed.workspaceId]);
  assert.equal(afterMismatch.rows[0]?.n, beforeMismatch.rows[0]?.n, 'payload mismatch writes no new source');

  const beforeRejected = await pool.query<{ sources: number; requests: number; cases: number }>(
    `SELECT
       (SELECT count(*)::int FROM source_records WHERE workspace_id = $1) AS sources,
       (SELECT count(*)::int FROM change_requests WHERE workspace_id = $1) AS requests,
       (SELECT count(*)::int FROM recovery_cases WHERE workspace_id = $1) AS cases`,
    [seed.workspaceId],
  );
  const crossTraveller = await admitChangeRequest(deps, { ...admission, journeyId: otherJourneyId, idempotencyKey: randomUUID() });
  assert.equal(crossTraveller.ok, false);
  const absentGrant = await admitChangeRequest(deps, { ...admission, idempotencyKey: randomUUID(), principalId: randomUUID() });
  assert.equal(absentGrant.ok, false);
  await pool.query('UPDATE authority_grants SET expires_at = $3::timestamptz WHERE workspace_id = $1 AND id = $2', [seed.workspaceId, grantId, '2029-12-31T00:00:00.000Z']);
  const expired = await admitChangeRequest(deps, { ...admission, idempotencyKey: randomUUID() });
  assert.equal(expired.ok, false);
  const afterRejected = await pool.query<{ sources: number; requests: number; cases: number }>(
    `SELECT
       (SELECT count(*)::int FROM source_records WHERE workspace_id = $1) AS sources,
       (SELECT count(*)::int FROM change_requests WHERE workspace_id = $1) AS requests,
       (SELECT count(*)::int FROM recovery_cases WHERE workspace_id = $1) AS cases`,
    [seed.workspaceId],
  );
  assert.deepEqual(afterRejected.rows[0], beforeRejected.rows[0], 'missing, cross-traveller, and expired grants write nothing');
});

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
  const first = mustOk(await submitChangeRequest(uow(), input));
  assert.deepEqual(first, { changeRequestId: requestId, lifecycle: 'SUBMITTED', revision: 1 });
  const replay = mustOk(await submitChangeRequest(uow(), input));
  assert.deepEqual(replay, first, 'same idempotency key returns the original result');
  const hashConflict = await submitChangeRequest(uow(), { ...input, sourceUtterance: 'Changed payload under the same key.' });
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

  const accepted = mustOk(await transitionChangeRequest(uow(), { workspaceId: seed.workspaceId, actorPrincipalId: requesterId, idempotencyKey: randomUUID(), changeRequestId: requestId, expectedRevision: 1, from: 'SUBMITTED', to: 'ACCEPTED_FOR_PLANNING', transitionedAt: AT }));
  assert.deepEqual(accepted, { changeRequestId: requestId, lifecycle: 'ACCEPTED_FOR_PLANNING', revision: 2 });
  const stale = await transitionChangeRequest(uow(), { workspaceId: seed.workspaceId, actorPrincipalId: requesterId, idempotencyKey: randomUUID(), changeRequestId: requestId, expectedRevision: 1, from: 'SUBMITTED', to: 'WITHDRAWN', transitionedAt: AT });
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.equal(stale.conflict.kind, 'STALE_AGGREGATE_REVISION');

  const crossTraveller = await submitChangeRequest(uow(), { ...input, idempotencyKey: randomUUID(), changeRequestId: randomUUID(), representedTravellerId: other.travellerId, journeyId: otherJourneyId });
  assert.equal(crossTraveller.ok, false);
  if (!crossTraveller.ok) assert.equal(crossTraveller.conflict.kind, 'AUTHORITY_DENIED');
  const absentPrincipal = await submitChangeRequest(uow(), { ...input, actorPrincipalId: randomUUID(), idempotencyKey: randomUUID(), changeRequestId: randomUUID() });
  assert.equal(absentPrincipal.ok, false);
  if (!absentPrincipal.ok) assert.equal(absentPrincipal.conflict.kind, 'AUTHORITY_DENIED');

  await pool.query("UPDATE principals SET status = 'SUSPENDED' WHERE workspace_id = $1 AND id = $2", [seed.workspaceId, requesterId]);
  const inactive = await submitChangeRequest(uow(), { ...input, idempotencyKey: randomUUID(), changeRequestId: randomUUID() });
  assert.equal(inactive.ok, false);
  if (!inactive.ok) assert.equal(inactive.conflict.kind, 'AUTHORITY_DENIED');
  await pool.query("UPDATE principals SET status = 'ACTIVE' WHERE workspace_id = $1 AND id = $2", [seed.workspaceId, requesterId]);

  // An execution-oriented grant for the same principal/scope is still not a
  // request grant. The command requires the distinct submit action exactly.
  await pool.query('DELETE FROM grant_actions WHERE workspace_id = $1 AND grant_id = $2', [seed.workspaceId, grant.grantId]);
  await pool.query("INSERT INTO grant_actions (workspace_id, grant_id, action_kind) VALUES ($1, $2, 'action.intent.dispatch')", [seed.workspaceId, grant.grantId]);
  const wrongAction = await submitChangeRequest(uow(), { ...input, idempotencyKey: randomUUID(), changeRequestId: randomUUID() });
  assert.equal(wrongAction.ok, false);
  if (!wrongAction.ok) assert.equal(wrongAction.conflict.kind, 'AUTHORITY_DENIED');
  await pool.query('DELETE FROM grant_actions WHERE workspace_id = $1 AND grant_id = $2', [seed.workspaceId, grant.grantId]);
  await pool.query("INSERT INTO grant_actions (workspace_id, grant_id, action_kind) VALUES ($1, $2, 'change.request.submit')", [seed.workspaceId, grant.grantId]);

  await pool.query('UPDATE authority_grants SET revoked_at = $3::timestamptz WHERE workspace_id = $1 AND id = $2', [seed.workspaceId, grant.grantId, '2029-12-31T00:00:00.000Z']);
  const revoked = await transitionChangeRequest(uow(), { workspaceId: seed.workspaceId, actorPrincipalId: requesterId, idempotencyKey: randomUUID(), changeRequestId: requestId, expectedRevision: 2, from: 'ACCEPTED_FOR_PLANNING', to: 'CLOSED', transitionedAt: AT });
  assert.equal(revoked.ok, false);
  if (!revoked.ok) assert.equal(revoked.conflict.kind, 'AUTHORITY_DENIED');
});

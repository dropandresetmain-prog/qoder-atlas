import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool } from '../src/persistence/postgres/pool.ts';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed, attachSeedSession, seedJourney, seedTraveller, seedTrip } from './m2Seed.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { provisionWorkspaceAuthority, workspacePrincipalId } from '../src/app/target/workspaceAuthority.ts';
import { provisionWorkspaceRequestAuthority } from '../src/app/target/workspaceRequestAuthority.ts';
import { revokeAuthorityGrant } from '../src/persistence/postgres/commands/peopleCommands.ts';

const NOW = '2030-01-01T00:00:00.000Z';
let pool: Pool;

function mustOk<T>(outcome: { ok: true; value: T } | { ok: false; conflict: unknown }): T {
  assert.equal(outcome.ok, true, outcome.ok ? '' : JSON.stringify(outcome.conflict));
  if (!outcome.ok) throw new Error('unreachable');
  return outcome.value;
}

before(async () => { pool = await sharedTestPool(); });
after(async () => { await pool?.end(); });

test('boot request authority grants exact Traveller/Journey submit scope and preserves lifecycle state', async () => {
  const seed = await beginSeed(pool, 'A1 workspace request authority');
  const firstTraveller = await seedTraveller(seed, { displayName: 'First traveller' });
  const secondTraveller = await seedTraveller(seed, { displayName: 'Second traveller' });
  const firstTrip = await seedTrip(seed, { purpose: 'First request scope', lifecycleStatus: 'ACTIVE' });
  const secondTrip = await seedTrip(seed, { purpose: 'Second request scope', lifecycleStatus: 'ACTIVE' });
  const firstJourneyId = await seedJourney(seed, { tripId: firstTrip, travellerId: firstTraveller.travellerId, lifecycleStatus: 'ACTIVE' });
  const secondJourneyId = await seedJourney(seed, { tripId: secondTrip, travellerId: secondTraveller.travellerId, lifecycleStatus: 'ACTIVE' });
  await commitSeed(seed);

  const uow = () => new PgUnitOfWork(pool, seed.workspaceId);
  const baseAuthority = await provisionWorkspaceAuthority({
    pool, uow, workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, now: NOW,
  });
  assert.equal(baseAuthority.status, 'PROVISIONED');

  const first = await provisionWorkspaceRequestAuthority({
    pool, uow, workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, now: NOW,
  });
  assert.equal(first.status, 'PROVISIONED');
  assert.equal(first.journeyCount, 2);
  assert.equal(first.provisionedCount, 2);
  assert.deepEqual(first.skipped, []);

  const operatorId = workspacePrincipalId(seed.workspaceId, 'operator');
  const issuerId = workspacePrincipalId(seed.workspaceId, 'issuer');
  const grants = await pool.query<{
    id: string; principal_id: string; represented_party_kind: string; represented_party_id: string;
    issued_by_principal_id: string; expires_at: Date | null; revoked_at: Date | null;
    actions: string[]; scopes: { kind: string; id: string }[];
  }>(
    `SELECT g.id, g.principal_id, g.represented_party_kind, g.represented_party_id,
            g.issued_by_principal_id, g.expires_at, g.revoked_at,
            (SELECT array_agg(a.action_kind ORDER BY a.action_kind) FROM grant_actions a WHERE a.workspace_id = g.workspace_id AND a.grant_id = g.id) AS actions,
            (SELECT jsonb_agg(jsonb_build_object('kind', s.scope_kind, 'id', s.scope_id) ORDER BY s.scope_kind, s.scope_id) FROM grant_scopes s WHERE s.workspace_id = g.workspace_id AND s.grant_id = g.id) AS scopes
       FROM authority_grants g
      WHERE g.workspace_id = $1 AND g.principal_id = $2
      ORDER BY g.id`,
    [seed.workspaceId, operatorId],
  );
  assert.equal(grants.rows.length, 2);
  assert.deepEqual(grants.rows.map((row) => ({
    principal: row.principal_id,
    party: [row.represented_party_kind, row.represented_party_id],
    issuer: row.issued_by_principal_id,
    actions: row.actions,
    scopes: row.scopes,
  })), [
    { principal: operatorId, party: ['TRAVELLER', firstTraveller.travellerId], issuer: issuerId, actions: ['change.request.submit'], scopes: [{ kind: 'JOURNEY', id: firstJourneyId }] },
    { principal: operatorId, party: ['TRAVELLER', secondTraveller.travellerId], issuer: issuerId, actions: ['change.request.submit'], scopes: [{ kind: 'JOURNEY', id: secondJourneyId }] },
  ].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  assert.ok(grants.rows.every((row) => row.expires_at === null && row.revoked_at === null));

  const again = await provisionWorkspaceRequestAuthority({
    pool, uow, workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, now: NOW,
  });
  assert.equal(again.status, 'ALREADY_PROVISIONED');
  assert.equal(again.provisionedCount, 0);
  assert.equal(again.skipped.length, 2);

  const firstGrantId = grants.rows.find((row) => row.represented_party_id === firstTraveller.travellerId)!.id;
  const secondGrantId = grants.rows.find((row) => row.represented_party_id === secondTraveller.travellerId)!.id;
  await pool.query('UPDATE authority_grants SET expires_at = $3::timestamptz WHERE workspace_id = $1 AND id = $2', [seed.workspaceId, firstGrantId, '2029-12-31T00:00:00.000Z']);
  const secondHead = await pool.query<{ revision: number }>('SELECT revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2', [seed.workspaceId, secondGrantId]);
  mustOk(await revokeAuthorityGrant(uow(), {
    workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(),
    grantId: secondGrantId, revokedAt: NOW, expectedRevision: secondHead.rows[0]!.revision,
  }));
  const preserved = await provisionWorkspaceRequestAuthority({
    pool, uow, workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, now: NOW,
  });
  assert.equal(preserved.status, 'ALREADY_PROVISIONED');
  assert.equal(preserved.provisionedCount, 0, 'expired and revoked grants are not silently recreated');
  assert.equal(preserved.skipped.filter((row) => row.reason === 'EXISTING_GRANT_PRESERVED').length, 2);

  const extraSeed = await attachSeedSession(pool, seed.workspaceId, seed.actorId);
  const thirdTraveller = await seedTraveller(extraSeed, { displayName: 'Third traveller' });
  const thirdTrip = await seedTrip(extraSeed, { purpose: 'Outside issuer scope', lifecycleStatus: 'ACTIVE' });
  const thirdJourneyId = await seedJourney(extraSeed, { tripId: thirdTrip, travellerId: thirdTraveller.travellerId, lifecycleStatus: 'ACTIVE' });
  await commitSeed(extraSeed);
  const issuerGrant = await pool.query<{ id: string; revision: number }>(
    `SELECT g.id, h.revision
       FROM authority_grants g
       JOIN aggregate_heads h ON h.workspace_id = g.workspace_id AND h.aggregate_id = g.id
       JOIN grant_actions a ON a.workspace_id = g.workspace_id AND a.grant_id = g.id
      WHERE g.workspace_id = $1 AND g.principal_id = $2 AND a.action_kind = 'authority.grant.write' AND g.revoked_at IS NULL
      LIMIT 1`,
    [seed.workspaceId, issuerId],
  );
  mustOk(await revokeAuthorityGrant(uow(), {
    workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(),
    grantId: issuerGrant.rows[0]!.id, revokedAt: NOW, expectedRevision: issuerGrant.rows[0]!.revision,
  }));
  const insufficient = await provisionWorkspaceRequestAuthority({
    pool, uow, workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, now: NOW,
  });
  assert.equal(insufficient.provisionedCount, 0);
  assert.deepEqual(insufficient.skipped.find((row) => row.journeyId === thirdJourneyId)?.reason, 'ISSUER_UNAUTHORISED');
  const requestGrantCount = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM authority_grants g
       JOIN grant_actions a ON a.workspace_id = g.workspace_id AND a.grant_id = g.id
      WHERE g.workspace_id = $1 AND g.principal_id = $2 AND a.action_kind = 'change.request.submit'`,
    [seed.workspaceId, operatorId],
  );
  assert.equal(requestGrantCount.rows[0]?.n, 2, 'insufficient issuer cannot bootstrap or inherit a new grant');
});

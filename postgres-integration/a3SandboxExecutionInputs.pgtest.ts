import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed, seedOrganisation, seedTraveller, takeSeedEvidence, type SeedSession } from './m3Seed.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { createExternalConnection, linkExternalRecord, observeExternalRecord } from '../src/persistence/postgres/commands/arrangementCommands.ts';
import { provisionSandboxExecutionInputs, SandboxExecutionInputError } from '../src/app/demo/sandboxExecutionInputs.ts';
import { resolveSandboxProtectedDocument } from '../src/app/demo/sandboxProtectedDocuments.ts';

const ENV = { ATLAS_ENV: 'sandbox', NORTHSTAR_SYNTHETIC_SANDBOX_INPUTS: '1' };

function mustOk<T>(outcome: { ok: true; value: T } | { ok: false; conflict: { kind: string; message: string } }): T {
  if (!outcome.ok) assert.fail(`${outcome.conflict.kind}: ${outcome.conflict.message}`);
  return outcome.value;
}

async function createMappedWorld(pool: Awaited<ReturnType<typeof sharedTestPool>>, label: string) {
  const seed = await beginSeed(pool, label);
  const organisationId = await seedOrganisation(seed, 'SGD');
  const traveller = await seedTraveller(seed);
  const organisationEvidence = takeSeedEvidence(seed);
  const travellerEvidence = takeSeedEvidence(seed);
  await commitSeed(seed);

  const connectionId = randomUUID();
  let revision = mustOk(await createExternalConnection(new PgUnitOfWork(pool, seed.workspaceId), {
    workspaceId: seed.workspaceId,
    actorPrincipalId: seed.actorId,
    idempotencyKey: `${label}:connection`,
    connection: { id: connectionId, organisationId, providerKind: 'A3_SYNTHETIC_SANDBOX' },
  })).revision;
  const organisationRecordId = randomUUID();
  const organisationRecord = mustOk(await observeExternalRecord(new PgUnitOfWork(pool, seed.workspaceId), {
    workspaceId: seed.workspaceId,
    actorPrincipalId: seed.actorId,
    idempotencyKey: `${label}:organisation-record`,
    connectionId,
    expectedRevision: revision,
    record: { id: organisationRecordId, recordType: 'SOURCE_ORGANISATION', externalId: 'org-source-1', identityState: 'UNVERIFIED', observedAt: '2030-01-01T00:00:00.000Z' },
  }));
  revision = organisationRecord.connectionRevision;
  revision = mustOk(await linkExternalRecord(new PgUnitOfWork(pool, seed.workspaceId), {
    workspaceId: seed.workspaceId,
    actorPrincipalId: seed.actorId,
    idempotencyKey: `${label}:organisation-link`,
    connectionId,
    expectedRevision: revision,
    link: { id: randomUUID(), externalRecordId: organisationRecordId, canonicalSubject: { kind: 'ORGANISATION', id: organisationId }, linkKind: 'SYSTEM_OF_RECORD', evidenceId: organisationEvidence, linkedAt: '2030-01-01T00:00:00.000Z' },
  })).connectionRevision;
  const travellerRecordId = randomUUID();
  const travellerRecord = mustOk(await observeExternalRecord(new PgUnitOfWork(pool, seed.workspaceId), {
    workspaceId: seed.workspaceId,
    actorPrincipalId: seed.actorId,
    idempotencyKey: `${label}:traveller-record`,
    connectionId,
    expectedRevision: revision,
    record: { id: travellerRecordId, recordType: 'SOURCE_TRAVELLER_DRAFT', externalId: 'traveller-source-1', identityState: 'UNVERIFIED', observedAt: '2030-01-01T00:00:00.000Z' },
  }));
  revision = travellerRecord.connectionRevision;
  revision = mustOk(await linkExternalRecord(new PgUnitOfWork(pool, seed.workspaceId), {
    workspaceId: seed.workspaceId,
    actorPrincipalId: seed.actorId,
    idempotencyKey: `${label}:traveller-link`,
    connectionId,
    expectedRevision: revision,
    link: { id: randomUUID(), externalRecordId: travellerRecordId, canonicalSubject: { kind: 'TRAVELLER', id: traveller.travellerId }, linkKind: 'SYSTEM_OF_RECORD', evidenceId: travellerEvidence, linkedAt: '2030-01-01T00:00:00.000Z' },
  })).connectionRevision;
  assert.ok(revision > 1);
  return { workspaceId: seed.workspaceId, actorId: seed.actorId, connectionId, travellerId: traveller.travellerId, organisationId, travellerEvidence };
}

function passportInput() {
  return {
    credentialId: '33333333-3333-4333-8333-333333333333',
    versionId: '44444444-4444-4444-8444-444444444444',
    syntheticDocumentMarker: 'NORTHSTAR-SYNTHETIC-NOT-VALID-FOR-TRAVEL-passport-1',
    issuerCountry: 'SG',
    issueDate: '2030-01-01',
    expiryDate: '2040-01-01',
    issuerStatus: 'UNKNOWN' as const,
    physicallyAvailable: true,
    observedAt: '2030-01-01T00:00:00.000Z',
  };
}

function input(budgetId: string, passport?: ReturnType<typeof passportInput>) {
  return {
    schemaVersion: 1,
    sandbox: { environment: 'sandbox', marker: 'synthetic-sandbox-inputs' },
    travellers: [{ sourceRef: 'SOURCE_TRAVELLER_DRAFT:traveller-source-1', bookingIdentity: { gender: 'FEMALE', contactEmail: 'synthetic@example.test', nationality: 'SG' }, ...(passport ? { passport } : {}) }],
    budgets: [{ organisationSourceRef: 'SOURCE_ORGANISATION:org-source-1', budget: { id: budgetId, purpose: 'synthetic sandbox flight booking', amount: { amount: '100.00', currency: 'SGD' } }, idempotencyKey: `a3-budget:${budgetId}` }],
  };
}

async function counts(pool: Awaited<ReturnType<typeof sharedTestPool>>, workspaceId: string) {
  const result = await pool.query<{ identities: string; budgets: string }>(
    `SELECT (SELECT count(*)::text FROM traveller_booking_identities WHERE workspace_id = $1) AS identities,
            (SELECT count(*)::text FROM budgets WHERE workspace_id = $1) AS budgets`,
    [workspaceId],
  );
  return result.rows[0]!;
}

after(async () => (await sharedTestPool()).end());

test('sandbox provision resolves source refs, is repeatable, isolated, and refuses conflicts before writes', async () => {
  const pool = await sharedTestPool();
  const first = await createMappedWorld(pool, 'A3 sandbox inputs one');
  const firstBudgetId = randomUUID();
  const provision = (world: typeof first, payload: unknown) => provisionSandboxExecutionInputs({
    db: pool,
    uow: () => new PgUnitOfWork(pool, world.workspaceId),
    workspaceId: world.workspaceId,
    actorPrincipalId: world.actorId,
    connectionId: world.connectionId,
    input: payload,
    env: ENV,
  });

  const created = await provision(first, input(firstBudgetId));
  assert.deepEqual(created, { workspaceId: first.workspaceId, connectionId: first.connectionId, travellersCreated: 1, travellersReused: 0, budgetsCreated: 1, budgetsReused: 0, passportsCreated: 0, passportsReused: 0 });
  assert.deepEqual(await counts(pool, first.workspaceId), { identities: '1', budgets: '1' });
  const replay = await provision(first, input(firstBudgetId));
  assert.equal(replay.travellersCreated, 0);
  assert.equal(replay.travellersReused, 1);
  assert.equal(replay.budgetsCreated, 0);
  assert.equal(replay.budgetsReused, 1);
  assert.deepEqual(await counts(pool, first.workspaceId), { identities: '1', budgets: '1' });

  const beforeConflict = await counts(pool, first.workspaceId);
  await assert.rejects(() => provision(first, { ...input(firstBudgetId), travellers: [{ sourceRef: 'SOURCE_TRAVELLER_DRAFT:traveller-source-1', bookingIdentity: { gender: 'MALE', contactEmail: 'synthetic@example.test', nationality: 'SG' } }] }), (error: unknown) => error instanceof SandboxExecutionInputError && error.code === 'CONFLICTING_EXISTING_INPUT');
  assert.deepEqual(await counts(pool, first.workspaceId), beforeConflict);

  const beforeUnknown = await counts(pool, first.workspaceId);
  await assert.rejects(() => provision(first, { ...input(randomUUID()), travellers: [{ sourceRef: 'SOURCE_TRAVELLER_DRAFT:unknown', bookingIdentity: { gender: 'FEMALE', contactEmail: 'synthetic@example.test' } }] }), (error: unknown) => error instanceof SandboxExecutionInputError && error.code === 'UNKNOWN_SOURCE_REF');
  assert.deepEqual(await counts(pool, first.workspaceId), beforeUnknown);

  const second = await createMappedWorld(pool, 'A3 sandbox inputs two');
  const secondRun = await provision(second, input(firstBudgetId));
  assert.equal(secondRun.travellersCreated, 1);
  assert.equal(secondRun.budgetsCreated, 1);
  assert.deepEqual(await counts(pool, second.workspaceId), { identities: '1', budgets: '1' });
  assert.deepEqual(await counts(pool, first.workspaceId), { identities: '1', budgets: '1' });
});

test('sandbox provision rejects source aliases for one canonical traveller before any writes', async () => {
  const pool = await sharedTestPool();
  const world = await createMappedWorld(pool, 'A3 sandbox inputs alias');
  const revision = (await pool.query<{ revision: string }>(
    'SELECT revision::text AS revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2',
    [world.workspaceId, world.connectionId],
  )).rows[0]!.revision;
  const aliasRecordId = randomUUID();
  const observed = mustOk(await observeExternalRecord(new PgUnitOfWork(pool, world.workspaceId), {
    workspaceId: world.workspaceId,
    actorPrincipalId: world.actorId,
    idempotencyKey: 'A3 sandbox inputs alias-record',
    connectionId: world.connectionId,
    expectedRevision: Number(revision),
    record: { id: aliasRecordId, recordType: 'SOURCE_TRAVELLER_DRAFT', externalId: 'traveller-source-alias', identityState: 'UNVERIFIED', observedAt: '2030-01-01T00:00:00.000Z' },
  }));
  mustOk(await linkExternalRecord(new PgUnitOfWork(pool, world.workspaceId), {
    workspaceId: world.workspaceId,
    actorPrincipalId: world.actorId,
    idempotencyKey: 'A3 sandbox inputs alias-link',
    connectionId: world.connectionId,
    expectedRevision: observed.connectionRevision,
    link: { id: randomUUID(), externalRecordId: aliasRecordId, canonicalSubject: { kind: 'TRAVELLER', id: world.travellerId }, linkKind: 'SYSTEM_OF_RECORD', evidenceId: world.travellerEvidence, linkedAt: '2030-01-01T00:00:00.000Z' },
  }));
  const before = await counts(pool, world.workspaceId);
  await assert.rejects(
    () => provisionSandboxExecutionInputs({
      db: pool,
      uow: () => new PgUnitOfWork(pool, world.workspaceId),
      workspaceId: world.workspaceId,
      actorPrincipalId: world.actorId,
      connectionId: world.connectionId,
      input: {
        ...input(randomUUID()),
        travellers: [
          input(randomUUID()).travellers[0],
          { sourceRef: 'SOURCE_TRAVELLER_DRAFT:traveller-source-alias', bookingIdentity: { gender: 'FEMALE', contactEmail: 'synthetic@example.test', nationality: 'SG' } },
        ],
      },
      env: ENV,
    }),
    (error: unknown) => error instanceof SandboxExecutionInputError && error.code === 'DUPLICATE_RESOLVED_TRAVELLER',
  );
  assert.deepEqual(await counts(pool, world.workspaceId), before, 'alias rejection leaves identities and budgets untouched');
});

test('sandbox passport provisions encrypted marker and credential edition, then reuses exact rows', async () => {
  const pool = await sharedTestPool();
  const world = await createMappedWorld(pool, 'A3 sandbox passport');
  const key = Buffer.alloc(32, 7);
  const documentKeyId = 'sandbox-passport-test-key-v1';
  const provision = (payload: unknown) => provisionSandboxExecutionInputs({
    db: pool,
    uow: () => new PgUnitOfWork(pool, world.workspaceId),
    workspaceId: world.workspaceId,
    actorPrincipalId: world.actorId,
    connectionId: world.connectionId,
    input: payload,
    env: ENV,
    documentKey: key,
    documentKeyId,
  });
  const budgetId = randomUUID();
  const passport = passportInput();
  const payload = input(budgetId, passport);
  const created = await provision(payload);
  assert.equal(created.passportsCreated, 1);
  assert.equal(created.passportsReused, 0);
  const rows = (await pool.query<{ storage_ref: string; issuer_country: string; expiry_date: string; physically_available: boolean }>(
    `SELECT p.document_number_storage_ref AS storage_ref, c.issuer_country, v.expiry_date::text AS expiry_date, v.physically_available
       FROM travel_credentials c JOIN credential_versions v ON v.workspace_id = c.workspace_id AND v.credential_id = c.id
       JOIN passport_details p ON p.workspace_id = v.workspace_id AND p.credential_version_id = v.id
      WHERE c.workspace_id = $1 AND c.id = $2`, [world.workspaceId, passport.credentialId],
  )).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.issuer_country, 'SG');
  assert.equal(rows[0]!.expiry_date, '2040-01-01');
  assert.equal(rows[0]!.physically_available, true);
  const document = await pool.query<{ document_number_content_hash: string; document_number_storage_ref: string; document_number_access_policy_id: string }>(
    'SELECT document_number_content_hash, document_number_storage_ref, document_number_access_policy_id FROM passport_details WHERE workspace_id = $1 AND credential_version_id = $2',
    [world.workspaceId, passport.versionId],
  );
  const plaintext = await resolveSandboxProtectedDocument({
    db: pool,
    workspaceId: world.workspaceId,
    document: { contentHash: document.rows[0]!.document_number_content_hash, storageRef: document.rows[0]!.document_number_storage_ref, accessPolicyId: document.rows[0]!.document_number_access_policy_id },
    key,
    keyId: documentKeyId,
    env: ENV,
  });
  assert.equal(plaintext, passport.syntheticDocumentMarker);
  const replay = await provision(payload);
  assert.equal(replay.passportsCreated, 0);
  assert.equal(replay.passportsReused, 1);
  assert.equal((await pool.query('SELECT count(*)::text AS count FROM credential_versions WHERE workspace_id = $1 AND credential_id = $2', [world.workspaceId, passport.credentialId])).rows[0]!.count, '1');
  await assert.rejects(() => provision(input(randomUUID(), { ...passport, issuerCountry: 'US' })), (error: unknown) => error instanceof SandboxExecutionInputError && error.code === 'CONFLICTING_EXISTING_INPUT');
});

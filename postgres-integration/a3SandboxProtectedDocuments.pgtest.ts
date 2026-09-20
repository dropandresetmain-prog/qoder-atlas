import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { beginSeed, commitSeed } from './m2Seed.ts';
import { sharedTestPool } from './harness.ts';
import { putSandboxProtectedDocument, resolveSandboxProtectedDocument, SandboxProtectedDocumentError } from '../src/app/demo/sandboxProtectedDocuments.ts';

const ENV = { ATLAS_ENV: 'sandbox', NORTHSTAR_SYNTHETIC_SANDBOX_INPUTS: '1' };
const plaintext = 'NORTHSTAR-SYNTHETIC-NOT-VALID-FOR-TRAVEL-passport-placeholder-1';

test('sandbox protected documents round-trip, reuse idempotently, and reject wrong credentials', async () => {
  const pool = await sharedTestPool();
  const seed = await beginSeed(pool, 'A3 synthetic protected document');
  await commitSeed(seed);
  const key = Buffer.alloc(32, 7);
  const ref = await putSandboxProtectedDocument({ db: pool, workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, plaintext, key, keyId: 'sandbox-key-1', env: ENV });
  assert.match(ref.storageRef, new RegExp(`^sandbox-pg://${seed.workspaceId}/`));
  assert.equal(await resolveSandboxProtectedDocument({ db: pool, workspaceId: seed.workspaceId, document: ref, key, keyId: 'sandbox-key-1', env: ENV }), plaintext);
  const retry = await putSandboxProtectedDocument({ db: pool, workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, plaintext, key, keyId: 'sandbox-key-1', env: ENV });
  assert.deepEqual(retry, ref);
  const count = await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM sandbox_protected_documents WHERE workspace_id = $1', [seed.workspaceId]);
  assert.equal(count.rows[0]?.n, '1');
  await assert.rejects(
    () => resolveSandboxProtectedDocument({ db: pool, workspaceId: seed.workspaceId, document: ref, key: Buffer.alloc(32, 8), keyId: 'sandbox-key-1', env: ENV }),
    (error: unknown) => error instanceof SandboxProtectedDocumentError && error.code === 'CORRUPT_OR_WRONG_KEY',
  );
  await assert.rejects(
    () => resolveSandboxProtectedDocument({ db: pool, workspaceId: seed.workspaceId, document: ref, key, keyId: 'sandbox-key-2', env: ENV }),
    (error: unknown) => error instanceof SandboxProtectedDocumentError && error.code === 'KEY_ID_MISMATCH',
  );
});

test('sandbox protected document refs are workspace and policy bound', async () => {
  const pool = await sharedTestPool();
  const first = await beginSeed(pool, 'A3 synthetic protected document ref');
  const second = await beginSeed(pool, 'A3 synthetic protected document other workspace');
  await commitSeed(first);
  await commitSeed(second);
  const key = Buffer.alloc(32, 9);
  const ref = await putSandboxProtectedDocument({ db: pool, workspaceId: first.workspaceId, actorPrincipalId: first.actorId, plaintext: `${plaintext}-ref`, key, keyId: 'sandbox-key-1', env: ENV });
  await assert.rejects(
    () => resolveSandboxProtectedDocument({ db: pool, workspaceId: second.workspaceId, document: ref, key, keyId: 'sandbox-key-1', env: ENV }),
    (error: unknown) => error instanceof SandboxProtectedDocumentError && (error.code === 'DOCUMENT_REF_MISMATCH' || error.code === 'DOCUMENT_NOT_FOUND'),
  );
  await assert.rejects(
    () => resolveSandboxProtectedDocument({ db: pool, workspaceId: first.workspaceId, document: { ...ref, accessPolicyId: 'other-policy' }, key, keyId: 'sandbox-key-1', env: ENV }),
    (error: unknown) => error instanceof SandboxProtectedDocumentError && error.code === 'INVALID_DOCUMENT_REF',
  );
  await assert.rejects(
    () => resolveSandboxProtectedDocument({ db: pool, workspaceId: first.workspaceId, document: { ...ref, contentHash: '0'.repeat(64) }, key, keyId: 'sandbox-key-1', env: ENV }),
    (error: unknown) => error instanceof SandboxProtectedDocumentError && error.code === 'DOCUMENT_REF_MISMATCH',
  );
  await assert.rejects(
    () => resolveSandboxProtectedDocument({ db: pool, workspaceId: first.workspaceId, document: { ...ref, storageRef: `sandbox-pg://${first.workspaceId}/${randomUUID()}` }, key, keyId: 'sandbox-key-1', env: ENV }),
    (error: unknown) => error instanceof SandboxProtectedDocumentError && error.code === 'DOCUMENT_NOT_FOUND',
  );
  await assert.rejects(
    () => pool.query('UPDATE sandbox_protected_documents SET auth_tag = $1 WHERE workspace_id = $2', [Buffer.alloc(16), first.workspaceId]),
    /sandbox_protected_documents is immutable/,
  );
  assert.notEqual(first.workspaceId, second.workspaceId);
});

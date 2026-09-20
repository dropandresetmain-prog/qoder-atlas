/**
 * Synthetic-only protected document custody for explicit SANDBOX rehearsals.
 *
 * This is intentionally a narrow PostgreSQL-backed encrypted store, not a
 * production document vault. The marker restriction prevents a caller from
 * placing a real passport or arbitrary private document into this seam.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { ProtectedDataRef } from '../../domain/v2/shared/identity.ts';
import { ProtectedDataRefSchema } from '../../domain/v2/shared/identity.ts';
import type { Pool, PoolClient } from '../../persistence/postgres/pool.ts';

export const SYNTHETIC_DOCUMENT_PREFIX = 'NORTHSTAR-SYNTHETIC-NOT-VALID-FOR-TRAVEL-';
export const SYNTHETIC_DOCUMENT_ACCESS_POLICY = 'synthetic-sandbox-document/1';
const STORAGE_PREFIX = 'sandbox-pg://';
const MARKER = new RegExp(`^${SYNTHETIC_DOCUMENT_PREFIX}[A-Za-z0-9._:-]{1,128}$`);
const Uuid = z.uuid();
const KeyId = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);

export type SandboxProtectedDocumentErrorCode =
  | 'SANDBOX_REQUIRED'
  | 'EXPLICIT_MARKER_REQUIRED'
  | 'INVALID_WORKSPACE'
  | 'INVALID_KEY'
  | 'INVALID_KEY_ID'
  | 'INVALID_SYNTHETIC_MARKER'
  | 'INVALID_DOCUMENT_REF'
  | 'DOCUMENT_NOT_FOUND'
  | 'DOCUMENT_REF_MISMATCH'
  | 'KEY_ID_MISMATCH'
  | 'CORRUPT_OR_WRONG_KEY'
  | 'CONTENT_MISMATCH'
  | 'PERSISTENCE_FAILED';

export class SandboxProtectedDocumentError extends Error {
  readonly code: SandboxProtectedDocumentErrorCode;

  constructor(code: SandboxProtectedDocumentErrorCode, message: string) {
    super(message);
    this.name = 'SandboxProtectedDocumentError';
    this.code = code;
  }
}

type Queryable = Pick<Pool | PoolClient, 'query'>;

interface StoredDocument {
  workspace_id: string;
  id: string;
  content_sha256: string;
  ciphertext: Buffer;
  nonce: Buffer;
  auth_tag: Buffer;
  key_id: string;
  access_policy_id: string;
}

export interface PutSandboxProtectedDocumentParams {
  db: Queryable;
  workspaceId: string;
  actorPrincipalId: string;
  plaintext: string;
  key: Uint8Array;
  keyId: string;
  env?: Record<string, string | undefined>;
}

export interface ResolveSandboxProtectedDocumentParams {
  db: Queryable;
  workspaceId: string;
  document: ProtectedDataRef;
  key: Uint8Array;
  keyId: string;
  env?: Record<string, string | undefined>;
}

export function isSyntheticSandboxMarker(value: string): boolean {
  return MARKER.test(value);
}

export function assertSyntheticSandboxDocumentEnvironment(env: Record<string, string | undefined>): void {
  if (env.ATLAS_ENV !== 'sandbox') {
    throw new SandboxProtectedDocumentError('SANDBOX_REQUIRED', 'synthetic protected documents require ATLAS_ENV=sandbox');
  }
  if (env.NORTHSTAR_SYNTHETIC_SANDBOX_INPUTS !== '1') {
    throw new SandboxProtectedDocumentError('EXPLICIT_MARKER_REQUIRED', 'synthetic protected documents require NORTHSTAR_SYNTHETIC_SANDBOX_INPUTS=1');
  }
}

function workspaceId(value: string): string {
  if (!Uuid.safeParse(value).success) throw new SandboxProtectedDocumentError('INVALID_WORKSPACE', 'workspace id is invalid');
  return value.toLowerCase();
}

function keyBytes(value: Uint8Array): Buffer {
  const key = Buffer.from(value);
  if (key.length !== 32) throw new SandboxProtectedDocumentError('INVALID_KEY', 'sandbox document key must be 32 bytes');
  return key;
}

function keyIdentifier(value: string): string {
  const parsed = KeyId.safeParse(value.trim());
  if (!parsed.success) throw new SandboxProtectedDocumentError('INVALID_KEY_ID', 'sandbox document key id is invalid');
  return parsed.data;
}

function marker(value: string): Buffer {
  if (!isSyntheticSandboxMarker(value)) {
    throw new SandboxProtectedDocumentError('INVALID_SYNTHETIC_MARKER', 'plaintext is not an accepted synthetic sandbox marker');
  }
  return Buffer.from(value, 'utf8');
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function documentIdFor(workspace: string, contentHash: string): string {
  const digest = createHash('sha256').update(`northstar:sandbox-document:${workspace}:${contentHash}`, 'utf8').digest();
  digest[6] = (digest[6]! & 0x0f) | 0x40;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function storageRef(workspace: string, id: string): string {
  return `${STORAGE_PREFIX}${workspace}/${id}`;
}

function aad(workspace: string, id: string): Buffer {
  return Buffer.from(`northstar:sandbox-document|${workspace}|${id}|${SYNTHETIC_DOCUMENT_ACCESS_POLICY}`, 'utf8');
}

function parseDocumentRef(workspace: string, ref: ProtectedDataRef): { contentHash: string; id: string } {
  if (!ProtectedDataRefSchema.safeParse(ref).success || ref.accessPolicyId !== SYNTHETIC_DOCUMENT_ACCESS_POLICY) {
    throw new SandboxProtectedDocumentError('INVALID_DOCUMENT_REF', 'protected document reference is not a synthetic sandbox reference');
  }
  const prefix = `${STORAGE_PREFIX}${workspace}/`;
  if (!ref.storageRef.startsWith(prefix)) throw new SandboxProtectedDocumentError('DOCUMENT_REF_MISMATCH', 'protected document reference is outside the workspace');
  const id = ref.storageRef.slice(prefix.length);
  if (!Uuid.safeParse(id).success) throw new SandboxProtectedDocumentError('INVALID_DOCUMENT_REF', 'protected document reference has an invalid id');
  if (!/^[0-9a-f]{64}$/.test(ref.contentHash)) throw new SandboxProtectedDocumentError('INVALID_DOCUMENT_REF', 'protected document reference has an invalid content hash');
  return { contentHash: ref.contentHash, id };
}

function encrypt(workspace: string, id: string, plaintext: Buffer, key: Buffer): { ciphertext: Buffer; nonce: Buffer; authTag: Buffer } {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad(workspace, id));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, nonce, authTag: cipher.getAuthTag() };
}

function decrypt(row: StoredDocument, workspace: string, key: Buffer): Buffer {
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, row.nonce);
    decipher.setAAD(aad(workspace, row.id));
    decipher.setAuthTag(row.auth_tag);
    return Buffer.concat([decipher.update(row.ciphertext), decipher.final()]);
  } catch {
    throw new SandboxProtectedDocumentError('CORRUPT_OR_WRONG_KEY', 'sandbox protected document authentication failed');
  }
}

function rowRef(row: StoredDocument, workspace: string): ProtectedDataRef {
  return { contentHash: row.content_sha256, storageRef: storageRef(workspace, row.id), accessPolicyId: row.access_policy_id };
}

async function byContentHash(db: Queryable, workspace: string, contentHash: string): Promise<StoredDocument | undefined> {
  const result = await db.query<StoredDocument>(
    `SELECT workspace_id, id, content_sha256, ciphertext, nonce, auth_tag, key_id, access_policy_id
       FROM sandbox_protected_documents WHERE workspace_id = $1 AND content_sha256 = $2`,
    [workspace, contentHash],
  );
  return result.rows[0];
}

async function byId(db: Queryable, workspace: string, id: string): Promise<StoredDocument | undefined> {
  const result = await db.query<StoredDocument>(
    `SELECT workspace_id, id, content_sha256, ciphertext, nonce, auth_tag, key_id, access_policy_id
       FROM sandbox_protected_documents WHERE workspace_id = $1 AND id = $2`,
    [workspace, id],
  );
  return result.rows[0];
}

function verifyStored(row: StoredDocument, workspace: string, key: Buffer, keyId: string, expectedHash: string, expectedPlaintext?: Buffer): Buffer {
  if (row.workspace_id !== workspace || row.access_policy_id !== SYNTHETIC_DOCUMENT_ACCESS_POLICY || row.content_sha256 !== expectedHash) {
    throw new SandboxProtectedDocumentError('DOCUMENT_REF_MISMATCH', 'stored sandbox protected document metadata does not match');
  }
  if (row.key_id !== keyId) throw new SandboxProtectedDocumentError('KEY_ID_MISMATCH', 'sandbox protected document key id does not match');
  if (row.nonce.length !== 12 || row.auth_tag.length !== 16) throw new SandboxProtectedDocumentError('CORRUPT_OR_WRONG_KEY', 'sandbox protected document metadata is corrupt');
  const plaintext = decrypt(row, workspace, key);
  if (sha256(plaintext) !== row.content_sha256 || !isSyntheticSandboxMarker(plaintext.toString('utf8'))) {
    throw new SandboxProtectedDocumentError('CORRUPT_OR_WRONG_KEY', 'sandbox protected document content integrity failed');
  }
  if (expectedPlaintext && !expectedPlaintext.equals(plaintext)) throw new SandboxProtectedDocumentError('CONTENT_MISMATCH', 'stored sandbox protected document content differs');
  return plaintext;
}

export async function putSandboxProtectedDocument(params: PutSandboxProtectedDocumentParams): Promise<ProtectedDataRef> {
  assertSyntheticSandboxDocumentEnvironment(params.env ?? process.env);
  const workspace = workspaceId(params.workspaceId);
  const key = keyBytes(params.key);
  const keyId = keyIdentifier(params.keyId);
  if (params.actorPrincipalId.trim().length === 0) throw new SandboxProtectedDocumentError('PERSISTENCE_FAILED', 'actor principal is required');
  const plaintext = marker(params.plaintext);
  const contentHash = sha256(plaintext);
  const id = documentIdFor(workspace, contentHash);
  const existing = await byContentHash(params.db, workspace, contentHash);
  if (existing) {
    verifyStored(existing, workspace, key, keyId, contentHash, plaintext);
    return rowRef(existing, workspace);
  }
  const encrypted = encrypt(workspace, id, plaintext, key);
  await params.db.query(
    `INSERT INTO sandbox_protected_documents
       (workspace_id, id, content_sha256, ciphertext, nonce, auth_tag, key_id, access_policy_id, created_by_actor_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (workspace_id, content_sha256) DO NOTHING`,
    [workspace, id, contentHash, encrypted.ciphertext, encrypted.nonce, encrypted.authTag, keyId, SYNTHETIC_DOCUMENT_ACCESS_POLICY, params.actorPrincipalId],
  );
  const stored = await byContentHash(params.db, workspace, contentHash);
  if (!stored) throw new SandboxProtectedDocumentError('PERSISTENCE_FAILED', 'sandbox protected document was not persisted');
  verifyStored(stored, workspace, key, keyId, contentHash, plaintext);
  return rowRef(stored, workspace);
}

export async function resolveSandboxProtectedDocument(params: ResolveSandboxProtectedDocumentParams): Promise<string> {
  assertSyntheticSandboxDocumentEnvironment(params.env ?? process.env);
  const workspace = workspaceId(params.workspaceId);
  const key = keyBytes(params.key);
  const keyId = keyIdentifier(params.keyId);
  const parsed = parseDocumentRef(workspace, params.document);
  const row = await byId(params.db, workspace, parsed.id);
  if (!row) throw new SandboxProtectedDocumentError('DOCUMENT_NOT_FOUND', 'sandbox protected document was not found');
  const plaintext = verifyStored(row, workspace, key, keyId, parsed.contentHash);
  if (rowRef(row, workspace).storageRef !== params.document.storageRef) throw new SandboxProtectedDocumentError('DOCUMENT_REF_MISMATCH', 'protected document storage reference does not match');
  return plaintext.toString('utf8');
}

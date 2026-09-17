/**
 * Deterministic identity minting for application-owned records (UUID v5).
 *
 * Runtime passes (escalation, authority provisioning, planning) must be
 * retry-safe and safe to run twice: the id a record gets is a function of
 * what it is for, never of when it was minted. Same helper shape as the
 * dataset materializer's `DatasetIdentityMinter`; no scenario input.
 */
import { createHash } from 'node:crypto';

function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}

export function deterministicUuid(namespace: string, name: string): string {
  const hash = createHash('sha1').update(uuidToBytes(namespace)).update(Buffer.from(name, 'utf8')).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Namespaces are per concern so the same name in two concerns never collides. */
export const RUNTIME_ID_NAMESPACES = {
  escalation: '3c1f0a52-6e7b-4b0e-9a3d-7f2c5e8d1a44',
  authority: '9b7d2e61-4c1a-4f8e-8a2b-5d6e7f8a9b0c',
  planning: '5e4d3c2b-1a09-4f8e-9d7c-6b5a4f3e2d1c',
} as const;

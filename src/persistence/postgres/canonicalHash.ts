/**
 * Deterministic payload hash for `DomainCommandEnvelope.canonicalPayloadHash`
 * (src/contracts/v2/command/domainCommand.ts). Object keys are sorted
 * recursively before hashing so semantically-identical payloads with
 * different key order hash identically.
 */
import { createHash } from 'node:crypto';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, canonicalize(v)] as const);
    return Object.fromEntries(entries);
  }
  return value;
}

export function canonicalPayloadHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(payload)), 'utf8').digest('hex');
}

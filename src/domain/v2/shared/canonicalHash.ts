/**
 * Deterministic JSON payload identity shared by planning and persistence.
 * Object keys are sorted recursively; array order remains significant.
 * This is the existing command hash implementation, not a second hash format.
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

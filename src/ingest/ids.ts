/**
 * B1 — deterministic identity for ingestion artifacts.
 * Identical inputs always produce identical ids, so re-ingesting the same
 * source is idempotent and downstream upserts merge instead of duplicating.
 */
import { createHash } from 'node:crypto';
import type { EntityId } from '../domain/common.ts';

export function hashId(prefix: string, ...parts: string[]): EntityId {
  const digest = createHash('sha256')
    .update(parts.join('\u0000'))
    .digest('hex')
    .slice(0, 16);
  return `${prefix}-${digest}`;
}

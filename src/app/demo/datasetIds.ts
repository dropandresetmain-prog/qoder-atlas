/**
 * Deterministic identity minting for dataset materialization.
 *
 * Every command in the target surface embeds the identifiers it is given into
 * the canonical payload it hashes for idempotency. A command that mints a
 * random id for its payload therefore hashes differently on a second run, and
 * a replay comes back as `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH` instead of
 * returning the original object. So the boundary mints the ids itself, as
 * RFC 4122 v5 UUIDs derived from (workspace, dataset, kind, source key).
 *
 * This is not "knowing" a generated UUID: the id is derived from the source's
 * own identity at the point the object is first materialized, and the
 * queryable resolution path stays the external identity mapping. Its purpose
 * is that re-running an interrupted materialization resumes on the same
 * objects instead of minting a second world.
 */
import { createHash } from 'node:crypto';

/** Fixed namespace for this boundary; any stable UUID would do. */
const DATASET_NAMESPACE = '6f6a1d4c-1b2e-4d3a-9c7f-2a5b8e0d4c11';

function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}

/** RFC 4122 §4.3 name-based UUID, SHA-1 (version 5). */
function uuidV5(namespace: string, name: string): string {
  const hash = createHash('sha1').update(uuidToBytes(namespace)).update(Buffer.from(name, 'utf8')).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Mints stable ids and idempotency keys for one (workspace, dataset) pair. */
export class DatasetIdentityMinter {
  private readonly prefix: string;

  constructor(workspaceId: string, datasetKey: string) {
    this.prefix = `${workspaceId}|${datasetKey}`;
  }

  /** Stable internal UUID for the object this dataset key names. */
  id(kind: string, ...parts: (string | number)[]): string {
    return uuidV5(DATASET_NAMESPACE, `${this.prefix}|${kind}|${parts.join('|')}`);
  }

  /** Stable idempotency key, so a re-run replays rather than duplicates. */
  key(step: string, ...parts: (string | number)[]): string {
    return `dataset:${this.prefix}:${step}:${parts.join('|')}`;
  }
}

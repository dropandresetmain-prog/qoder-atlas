/**
 * C1 — sanitized provider-shaped recording store (FR-15, ADR-008).
 *
 * Recording IDs are deterministic hashes of provider + operation + request,
 * so RECORD and REPLAY resolve the same recording for the same request and
 * replay is reproducible. Files follow the frozen RecordingSchema.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RecordingSchema, type Recording } from '../contracts/envelope.ts';

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function recordingIdFor(providerId: string, operation: string, request: unknown): string {
  const digest = createHash('sha256')
    .update(`${providerId}|${operation}|${canonicalJson(request)}`)
    .digest('hex');
  return `rec_${digest.slice(0, 32)}`;
}

export interface RecordingStore {
  load(providerId: string, operation: string, recordingId: string): Promise<Recording | undefined>;
  save(recording: Recording): Promise<void>;
}

export interface FileRecordingStoreOptions {
  /** Read roots searched in order (e.g. runtime store, then curated fixtures). */
  readDirs: ReadonlyArray<string>;
  /** Write root used by RECORD; recordings are created when omitted. */
  writeDir?: string;
}

export class FileRecordingStore implements RecordingStore {
  private readonly readDirs: ReadonlyArray<string>;
  private readonly writeDir?: string;

  constructor(options: FileRecordingStoreOptions) {
    this.readDirs = options.readDirs;
    this.writeDir = options.writeDir;
  }

  async load(
    providerId: string,
    operation: string,
    recordingId: string,
  ): Promise<Recording | undefined> {
    for (const dir of this.readDirs) {
      const path = this.filePath(dir, providerId, operation, recordingId);
      if (!existsSync(path)) continue;
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
      return RecordingSchema.parse(parsed);
    }
    return undefined;
  }

  async save(recording: Recording): Promise<void> {
    if (!this.writeDir) {
      throw new Error('recording store is read-only: no writeDir configured');
    }
    const path = this.filePath(this.writeDir, recording.providerId, recording.operation, recording.id);
    mkdirSync(join(this.writeDir, recording.providerId, recording.operation), { recursive: true });
    writeFileSync(path, `${JSON.stringify(recording, null, 2)}\n`, 'utf8');
  }

  private filePath(dir: string, providerId: string, operation: string, recordingId: string): string {
    return join(dir, providerId, operation, `${recordingId}.json`);
  }
}

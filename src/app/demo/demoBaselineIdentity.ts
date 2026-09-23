/**
 * Demo baseline identity — deterministic digest over authoritative inputs that
 * define a pristine demo world (schema, dataset, sandbox/research config).
 *
 * Used by demoBaselineClone to invalidate/rebuild frozen templates when seed
 * or schema truth changes. Callers supply precomputed component hashes.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { loadMigrationFiles } from '../../persistence/postgres/migrate.ts';

export interface DemoBaselineIdentityInput {
  migrationsFingerprint: string;
  datasetContentHash: string;
  sandboxInputsHash?: string;
  researchConfigHash?: string;
  /** Boot-time visit/entry readiness composition that stamps baseline assessments. */
  baselineReadinessHash?: string;
}

/** Stable sha256 digest over baseline component hashes (labeled, ordered). */
export function computeDemoBaselineIdentity(input: DemoBaselineIdentityInput): string {
  const hash = createHash('sha256');
  hash.update('migrations\0');
  hash.update(input.migrationsFingerprint);
  hash.update('\0dataset\0');
  hash.update(input.datasetContentHash);
  if (input.sandboxInputsHash !== undefined) {
    hash.update('\0sandbox\0');
    hash.update(input.sandboxInputsHash);
  }
  if (input.researchConfigHash !== undefined) {
    hash.update('\0research\0');
    hash.update(input.researchConfigHash);
  }
  if (input.baselineReadinessHash !== undefined) {
    hash.update('\0baseline-readiness\0');
    hash.update(input.baselineReadinessHash);
  }
  return hash.digest('hex');
}

/**
 * Fingerprint of on-disk migration SQL (version + per-file checksum), aligned
 * with the migration runner's checksum model.
 */
export function fingerprintMigrationsDirectory(migrationsDir: string): string {
  const files = loadMigrationFiles(migrationsDir);
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file.version);
    hash.update('\0');
    hash.update(file.checksum);
    hash.update('\0');
  }
  return hash.digest('hex');
}

/** sha256 of raw file bytes. */
export async function hashFileContent(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  return createHash('sha256').update(bytes).digest('hex');
}

/** Hash file when present; undefined when the path is missing (optional config). */
export async function hashOptionalFileContent(filePath: string): Promise<string | undefined> {
  try {
    return await hashFileContent(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

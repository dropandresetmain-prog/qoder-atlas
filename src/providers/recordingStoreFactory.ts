/**
 * Shared recording-store construction for LIVE / RECORD / REPLAY.
 *
 * When the configured recordings directory contains a `.corpus-isolated`
 * marker, read paths are restricted to that directory alone so a fresh corpus
 * cannot fall through to fixtures or scenario recordings.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AdapterMode } from '../config/config.ts';
import { FileRecordingStore, type RecordingStore } from './recordingStore.ts';

/** Marker filename that isolates RECORD/REPLAY to RECORDINGS_DIR only. */
export const CORPUS_ISOLATED_MARKER = '.corpus-isolated';

/**
 * Marker filename that freezes a corpus against RECORD writes entirely.
 * Distinct from `.corpus-isolated` (which only controls READ fallback):
 * a corpus can be isolated (reads restricted to it) while still accepting
 * new writes (e.g. a CP6-style staging copy), or frozen (no RECORD writes
 * permitted at all, e.g. a founder-approved evidence corpus), independent
 * of whether it also isolates reads. This is generic to any corpus in any
 * scenario — it is keyed only on the marker file's presence, never on a
 * corpus id, scenario name or script name.
 */
export const CORPUS_FROZEN_MARKER = '.corpus-frozen';

export function isCorpusIsolated(recordingsDir: string, cwd = process.cwd()): boolean {
  return existsSync(resolve(cwd, recordingsDir, CORPUS_ISOLATED_MARKER));
}

export function isCorpusFrozen(recordingsDir: string, cwd = process.cwd()): boolean {
  return existsSync(resolve(cwd, recordingsDir, CORPUS_FROZEN_MARKER));
}

export class FrozenCorpusWriteError extends Error {
  constructor(recordingsDir: string) {
    super(
      `Refusing to configure a RECORD write path into "${recordingsDir}": this corpus carries ` +
        `${CORPUS_FROZEN_MARKER}, marking it frozen/immutable evidence. Point RECORDINGS_DIR at an ` +
        `explicit scratch or staging copy instead of writing into a frozen corpus.`,
    );
    this.name = 'FrozenCorpusWriteError';
  }
}

export function listScenarioRecordingDirs(fixturesDir: string, cwd: string): string[] {
  const scenariosRoot = join(cwd, fixturesDir, 'scenarios');
  try {
    return readdirSync(scenariosRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(fixturesDir, 'scenarios', entry.name, 'recordings'));
  } catch {
    return [];
  }
}

export function recordingReadDirs(input: {
  recordingsDir: string;
  fixturesDir: string;
  cwd: string;
  /** When true, skip fixtures/scenario fallbacks even without a marker file. */
  forceIsolated?: boolean;
}): string[] {
  const recordingsDir = resolve(input.cwd, input.recordingsDir);
  if (input.forceIsolated || isCorpusIsolated(input.recordingsDir, input.cwd)) {
    return [recordingsDir];
  }
  return [
    recordingsDir,
    resolve(input.cwd, input.fixturesDir, 'recordings'),
    ...listScenarioRecordingDirs(input.fixturesDir, input.cwd).map((dir) => resolve(input.cwd, dir)),
  ];
}

export function createAppRecordingStore(input: {
  recordingsDir: string;
  fixturesDir: string;
  cwd: string;
  adapterMode: AdapterMode;
  forceIsolated?: boolean;
}): RecordingStore {
  const recordingsDir = resolve(input.cwd, input.recordingsDir);
  if (input.adapterMode === 'RECORD' && isCorpusFrozen(input.recordingsDir, input.cwd)) {
    throw new FrozenCorpusWriteError(input.recordingsDir);
  }
  return new FileRecordingStore({
    readDirs: recordingReadDirs(input),
    ...(input.adapterMode === 'RECORD' ? { writeDir: recordingsDir } : {}),
  });
}

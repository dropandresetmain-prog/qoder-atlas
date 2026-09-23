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

export function isCorpusIsolated(recordingsDir: string, cwd = process.cwd()): boolean {
  return existsSync(resolve(cwd, recordingsDir, CORPUS_ISOLATED_MARKER));
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
  return new FileRecordingStore({
    readDirs: recordingReadDirs(input),
    ...(input.adapterMode === 'RECORD' ? { writeDir: recordingsDir } : {}),
  });
}

/**
 * Corpus isolation: `.corpus-isolated` restricts recording reads to RECORDINGS_DIR.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CORPUS_FROZEN_MARKER,
  CORPUS_ISOLATED_MARKER,
  FrozenCorpusWriteError,
  createAppRecordingStore,
  isCorpusFrozen,
  isCorpusIsolated,
  recordingReadDirs,
} from '../src/providers/recordingStoreFactory.ts';

test('recordingReadDirs includes fixtures unless corpus is isolated', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'corpus-iso-'));
  mkdirSync(join(cwd, 'recordings'), { recursive: true });
  mkdirSync(join(cwd, 'fixtures', 'recordings'), { recursive: true });
  mkdirSync(join(cwd, 'fixtures', 'scenarios', 'demo', 'recordings'), { recursive: true });
  const dirs = recordingReadDirs({ recordingsDir: 'recordings', fixturesDir: 'fixtures', cwd });
  assert.equal(dirs.length, 3);
  assert.ok(dirs[0]!.endsWith('recordings'));
  assert.ok(dirs.some((d) => d.replace(/\\/g, '/').endsWith('fixtures/recordings')));
});

test('recordingReadDirs is sole corpus path when .corpus-isolated is present', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'corpus-iso-'));
  const corpus = join(cwd, 'recordings', 'jordan-corpus-2026-09-23');
  mkdirSync(corpus, { recursive: true });
  mkdirSync(join(cwd, 'fixtures', 'recordings'), { recursive: true });
  writeFileSync(join(corpus, CORPUS_ISOLATED_MARKER), 'isolated\n');
  assert.equal(isCorpusIsolated('recordings/jordan-corpus-2026-09-23', cwd), true);
  const dirs = recordingReadDirs({
    recordingsDir: 'recordings/jordan-corpus-2026-09-23',
    fixturesDir: 'fixtures',
    cwd,
  });
  assert.deepEqual(dirs, [join(cwd, 'recordings', 'jordan-corpus-2026-09-23')]);
});

test('createAppRecordingStore refuses a RECORD write path into a .corpus-frozen corpus', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'corpus-frozen-'));
  const corpus = join(cwd, 'recordings', 'frozen-corpus');
  mkdirSync(corpus, { recursive: true });
  writeFileSync(join(corpus, CORPUS_FROZEN_MARKER), 'frozen\n');
  assert.equal(isCorpusFrozen('recordings/frozen-corpus', cwd), true);
  assert.throws(
    () =>
      createAppRecordingStore({
        recordingsDir: 'recordings/frozen-corpus',
        fixturesDir: 'fixtures',
        cwd,
        adapterMode: 'RECORD',
      }),
    FrozenCorpusWriteError,
  );
});

test('createAppRecordingStore allows RECORD writes into an unmarked staging copy', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'corpus-frozen-'));
  const corpus = join(cwd, 'recordings', 'frozen-corpus');
  const staging = join(cwd, 'recordings', 'frozen-corpus-staging');
  mkdirSync(corpus, { recursive: true });
  mkdirSync(staging, { recursive: true });
  writeFileSync(join(corpus, CORPUS_FROZEN_MARKER), 'frozen\n');
  writeFileSync(join(staging, CORPUS_ISOLATED_MARKER), 'isolated\n');
  assert.doesNotThrow(() =>
    createAppRecordingStore({
      recordingsDir: 'recordings/frozen-corpus-staging',
      fixturesDir: 'fixtures',
      cwd,
      adapterMode: 'RECORD',
    }),
  );
});

test('REPLAY/LIVE modes never trip the frozen-corpus guard (guard is RECORD-only)', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'corpus-frozen-'));
  const corpus = join(cwd, 'recordings', 'frozen-corpus');
  mkdirSync(corpus, { recursive: true });
  writeFileSync(join(corpus, CORPUS_FROZEN_MARKER), 'frozen\n');
  assert.doesNotThrow(() =>
    createAppRecordingStore({
      recordingsDir: 'recordings/frozen-corpus',
      fixturesDir: 'fixtures',
      cwd,
      adapterMode: 'REPLAY',
    }),
  );
});

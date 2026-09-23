/**
 * Corpus isolation: `.corpus-isolated` restricts recording reads to RECORDINGS_DIR.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CORPUS_ISOLATED_MARKER,
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

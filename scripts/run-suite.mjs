#!/usr/bin/env node
/**
 * Runs exactly one classified test suite from `test/suites.json`.
 *
 * Suites are explicit file lists, never directory globs, so no command can
 * recursively rediscover the retired SQLite runtime tests that `npm test` is
 * required to stay away from. Adding a test file without classifying it makes
 * `npm run gate:test-boundary` fail rather than silently joining a suite.
 *
 * Usage: node scripts/run-suite.mjs <current|postgres|migration|legacy> [--list] [extra node --test args]
 */

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(resolve(repoRoot, 'test/suites.json'), 'utf8'));

const [suiteName, ...rest] = process.argv.slice(2);
const files = manifest.suites[suiteName];

if (files === undefined) {
  console.error(`Unknown suite "${suiteName ?? ''}". Available: ${Object.keys(manifest.suites).join(', ')}`);
  process.exit(2);
}

if (rest.includes('--list')) {
  for (const f of files) console.log(f);
  process.exit(0);
}

const classification = manifest.classification[suiteName];

if (classification === 'HISTORICAL_LEGACY') {
  console.warn('');
  console.warn('  ################################################################');
  console.warn('  #  HISTORICAL / NON-GATING / MANUAL ONLY                       #');
  console.warn('  #                                                              #');
  console.warn('  #  These tests exercise the RETIRED SQLite application runtime #');
  console.warn('  #  purged at M10/C5. They are archaeology, not current product #');
  console.warn('  #  correctness. Failures here are NOT a release blocker and    #');
  console.warn('  #  must NOT be fixed unless you were explicitly assigned       #');
  console.warn('  #  historical/migration investigation.                         #');
  console.warn('  ################################################################');
  console.warn('');
}

console.log(`suite "${suiteName}" (${classification}): ${files.length} file(s)`);

const result = spawnSync(
  process.execPath,
  ['--test', '--test-concurrency=1', ...rest.filter((a) => a !== '--list'), ...files],
  { cwd: repoRoot, stdio: 'inherit' },
);

process.exit(result.status ?? 1);

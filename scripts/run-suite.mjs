#!/usr/bin/env node
/**
 * Runs exactly one classified test suite from `test/suites.json`.
 *
 * Suites are explicit file lists, never directory globs, so no command can
 * recursively rediscover the retired SQLite runtime tests that `npm test` is
 * required to stay away from. Adding a test file without classifying it makes
 * `npm run gate:test-boundary` fail rather than silently joining a suite.
 *
 * Canonical verification is `npm test` / `npm run test:*`, which call this
 * runner. Do not treat raw `node --test` as the suite command: without the
 * manifest it can discover PostgreSQL, migration and historical files together.
 *
 * When the suite intersects `aitFixtureCloneConsumers`, a canonical AiT fixture
 * database is built once, exposed via NORTHSTAR_AIT_FIXTURE_DB, and dropped
 * after the suite. Explicit NORTHSTAR_PG_AIT_WORLD=fresh skips fixture build.
 *
 * Usage: node scripts/run-suite.mjs <current|postgres|postgresFast|migration|legacy> [--list] [extra node --test args]
 */

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveTestConcurrencyArg, suiteTestConcurrency } from './suite-concurrency.mjs';
import {
  dropSuiteAitFixture,
  prepareSuiteAitFixture,
  shouldSkipFixtureForEnv,
  suiteNeedsAitFixture,
} from './ait-fixture-suite.mjs';

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

const extra = rest.filter((a) => a !== '--list');
const concurrencyArg = resolveTestConcurrencyArg(suiteName, extra);
const nodeArgs = ['--test'];
if (concurrencyArg) nodeArgs.push(concurrencyArg);
nodeArgs.push(...extra, ...files);

const needsFixture = suiteNeedsAitFixture(manifest, suiteName, files);
const skipFixture = shouldSkipFixtureForEnv(process.env);

console.log(
  `suite "${suiteName}" (${classification}): ${files.length} file(s) concurrency=${suiteTestConcurrency(suiteName)}${concurrencyArg ? '' : ' (overridden)'}`,
);

let fixtureDatabaseName;
let exitCode = 1;

try {
  const childEnv = { ...process.env };
  if (needsFixture && !skipFixture) {
    console.log('[ait-fixture] preparing canonical AiT TEMPLATE fixture for this suite…');
    const prepared = await prepareSuiteAitFixture();
    fixtureDatabaseName = prepared.databaseName;
    childEnv.NORTHSTAR_AIT_FIXTURE_DB = fixtureDatabaseName;
    if (!(childEnv.NORTHSTAR_PG_AIT_WORLD ?? '').trim()) {
      childEnv.NORTHSTAR_PG_AIT_WORLD = 'clone';
    }
    console.log(
      `[ait-fixture] ready db=${fixtureDatabaseName} buildMs=${Math.round(prepared.buildMs)} ` +
        `baselineEvaluated=${prepared.baselineEvaluated} hash=${prepared.contentHash.slice(0, 12)}…`,
    );
  } else if (needsFixture && skipFixture) {
    console.log('[ait-fixture] skipped (NORTHSTAR_PG_AIT_WORLD=fresh)');
  }

  const result = spawnSync(process.execPath, nodeArgs, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: childEnv,
  });
  exitCode = result.status ?? 1;
} finally {
  if (fixtureDatabaseName) {
    console.log(`[ait-fixture] dropping fixture ${fixtureDatabaseName}`);
    try {
      await dropSuiteAitFixture(fixtureDatabaseName);
    } catch (error) {
      console.error(`[ait-fixture] drop failed: ${error}`);
      exitCode = exitCode === 0 ? 1 : exitCode;
    }
  }
}

process.exit(exitCode);

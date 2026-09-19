/**
 * Contract: AiT fixture suite lifecycle + PG concurrency remains serial.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suiteTestConcurrency } from '../scripts/suite-concurrency.mjs';
import { shouldSkipFixtureForEnv, suiteNeedsAitFixture } from '../scripts/ait-fixture-suite.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'test/suites.json'), 'utf8'));

describe('AiT fixture suite contract', () => {
  test('PostgreSQL suite concurrency remains 1', () => {
    assert.equal(suiteTestConcurrency('postgres'), 1);
  });

  test('suiteNeedsAitFixture is true only when consumers intersect the suite file list', () => {
    assert.equal(
      suiteNeedsAitFixture(manifest, 'postgres', ['postgres-integration/t2F3HttpValidation.pgtest.ts']),
      true,
    );
    assert.equal(
      suiteNeedsAitFixture(manifest, 'postgres', ['postgres-integration/productBaselineWorld.pgtest.ts']),
      false,
    );
    assert.equal(suiteNeedsAitFixture(manifest, 'current', manifest.suites.current), false);
  });

  test('productBaselineWorld is never a clone consumer', () => {
    const consumers = manifest.aitFixtureCloneConsumers?.postgres ?? [];
    assert.ok(!consumers.includes('postgres-integration/productBaselineWorld.pgtest.ts'));
    assert.ok(!consumers.includes('postgres-integration/migrate.pgtest.ts'));
  });

  test('NORTHSTAR_PG_AIT_WORLD=fresh skips suite fixture preparation', () => {
    assert.equal(shouldSkipFixtureForEnv({ NORTHSTAR_PG_AIT_WORLD: 'fresh' }), true);
    assert.equal(shouldSkipFixtureForEnv({ NORTHSTAR_PG_AIT_WORLD: 'clone' }), false);
    assert.equal(shouldSkipFixtureForEnv({}), false);
  });
});

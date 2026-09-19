/**
 * The fast PostgreSQL tier is an explicit, reviewable subset of the canonical
 * PostgreSQL manifest. Keep the heavyweight acceptance list here because it is
 * the tiering contract, while deriving the expected fast membership from the
 * canonical list so the two manifests cannot drift independently.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(resolve(ROOT, 'test/suites.json'), 'utf8')) as {
  classification: {
    postgres: string;
    postgresFast: string;
  };
  suites: {
    postgres: string[];
    postgresFast: string[];
    migration: string[];
    legacy: string[];
  };
};

const HEAVYWEIGHT_POSTGRES_FILES = [
  'postgres-integration/b1SarahWorldRecovery.pgtest.ts',
  'postgres-integration/productBaselineWorld.pgtest.ts',
  'postgres-integration/t2F1FailureInjection.pgtest.ts',
  'postgres-integration/t2F3HttpValidation.pgtest.ts',
  'postgres-integration/t2F5ServiceIdentity.pgtest.ts',
  'postgres-integration/t2F7SelectionGuard.pgtest.ts',
  'postgres-integration/t2N1ReplacementCorridorGuard.pgtest.ts',
  'postgres-integration/t2ProviderDisruptionReprotection.pgtest.ts',
  'postgres-integration/migrate.pgtest.ts',
  'postgres-integration/integrationCrossLane.pgtest.ts',
  'postgres-integration/aitFixtureClone.pgtest.ts',
] as const;

test('postgresFast is exactly the canonical postgres suite minus the accepted heavyweight exclusions', () => {
  const canonical = manifest.suites.postgres;
  const fast = manifest.suites.postgresFast;
  const excluded = new Set<string>(HEAVYWEIGHT_POSTGRES_FILES);

  assert.equal(manifest.classification.postgres, 'CURRENT_TARGET');
  assert.equal(manifest.classification.postgresFast, 'CURRENT_TARGET');
  assert.deepEqual(
    fast,
    canonical.filter((file) => !excluded.has(file)),
    'fast membership must be derived from canonical membership and the explicit exclusion contract',
  );

  const canonicalSet = new Set(canonical);
  for (const file of fast) {
    assert.ok(canonicalSet.has(file), `${file} must remain in canonical postgres`);
  }
});

test('all heavyweight exclusions remain canonical and absent from postgresFast', () => {
  const canonicalSet = new Set(manifest.suites.postgres);
  const fastSet = new Set(manifest.suites.postgresFast);

  for (const file of HEAVYWEIGHT_POSTGRES_FILES) {
    assert.ok(canonicalSet.has(file), `${file} must remain canonical PostgreSQL evidence`);
    assert.equal(fastSet.has(file), false, `${file} must be excluded from postgresFast`);
  }
});

test('postgresFast cannot include migration-boundary or historical-legacy files', () => {
  const migration = new Set(manifest.suites.migration);
  const legacy = new Set(manifest.suites.legacy);

  for (const file of manifest.suites.postgresFast) {
    assert.equal(migration.has(file), false, `${file} must not be a migration-boundary test`);
    assert.equal(legacy.has(file), false, `${file} must not be a historical-legacy test`);
  }
});

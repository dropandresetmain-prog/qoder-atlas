/**
 * Demo baseline identity — stable digest over schema/dataset/config inputs.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  computeDemoBaselineIdentity,
  fingerprintMigrationsDirectory,
} from '../src/app/demo/demoBaselineIdentity.ts';

const MIGRATIONS_DIR = fileURLToPath(
  new URL('../src/persistence/postgres/migrations/', import.meta.url),
);

describe('a5 demo baseline identity', () => {
  test('stable for identical component hashes', () => {
    const a = computeDemoBaselineIdentity({
      migrationsFingerprint: 'mig-a',
      datasetContentHash: 'ds-a',
      sandboxInputsHash: 'sb-a',
      researchConfigHash: 'rs-a',
    });
    const b = computeDemoBaselineIdentity({
      migrationsFingerprint: 'mig-a',
      datasetContentHash: 'ds-a',
      sandboxInputsHash: 'sb-a',
      researchConfigHash: 'rs-a',
    });
    assert.equal(a, b);
    assert.equal(a.length, 64);
  });

  test('changes when any component hash changes', () => {
    const base = {
      migrationsFingerprint: 'mig-a',
      datasetContentHash: 'ds-a',
      sandboxInputsHash: 'sb-a',
      researchConfigHash: 'rs-a',
    };
    const root = computeDemoBaselineIdentity(base);
    assert.notEqual(
      root,
      computeDemoBaselineIdentity({ ...base, migrationsFingerprint: 'mig-b' }),
    );
    assert.notEqual(
      root,
      computeDemoBaselineIdentity({ ...base, datasetContentHash: 'ds-b' }),
    );
    assert.notEqual(
      root,
      computeDemoBaselineIdentity({ ...base, sandboxInputsHash: 'sb-b' }),
    );
    assert.notEqual(
      root,
      computeDemoBaselineIdentity({ ...base, researchConfigHash: 'rs-b' }),
    );
    assert.notEqual(
      root,
      computeDemoBaselineIdentity({
        migrationsFingerprint: base.migrationsFingerprint,
        datasetContentHash: base.datasetContentHash,
      }),
    );
  });

  test('fingerprintMigrationsDirectory is non-empty for live migrations', () => {
    const fp = fingerprintMigrationsDirectory(MIGRATIONS_DIR);
    assert.equal(fp.length, 64);
    assert.match(fp, /^[0-9a-f]+$/);
  });
});

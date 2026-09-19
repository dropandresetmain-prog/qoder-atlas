/**
 * Suite-scoped AiT fixture prepare/teardown for `scripts/run-suite.mjs`.
 * Rebuilds once per invocation; no cross-session cache.
 */
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function suiteNeedsAitFixture(manifest, suiteName, files) {
  const consumers = manifest.aitFixtureCloneConsumers?.[suiteName];
  if (!Array.isArray(consumers) || consumers.length === 0) return false;
  const wanted = new Set(consumers);
  return files.some((f) => wanted.has(f));
}

export function shouldSkipFixtureForEnv(env = process.env) {
  return (env.NORTHSTAR_PG_AIT_WORLD ?? '').trim().toLowerCase() === 'fresh';
}

async function loadFixtureModule() {
  const modUrl = pathToFileURL(resolve(repoRoot, 'postgres-integration/aitFixtureClone.ts')).href;
  return import(modUrl);
}

export async function prepareSuiteAitFixture() {
  const { buildAitFixtureDatabase } = await loadFixtureModule();
  const fixture = await buildAitFixtureDatabase({ runBaseline: true });
  return {
    databaseName: fixture.databaseName,
    buildMs: fixture.buildMs,
    baselineEvaluated: fixture.baselineEvaluated,
    contentHash: fixture.contentHash,
  };
}

export async function dropSuiteAitFixture(databaseName) {
  if (!databaseName) return;
  const { dropAitFixtureDatabase } = await loadFixtureModule();
  await dropAitFixtureDatabase(databaseName);
}

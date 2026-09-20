import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { beginSeed, commitSeed } from './m2Seed.ts';
import { sharedTestPool } from './harness.ts';
import { createPgBudgetFxRateReader } from '../src/app/targetFxResearch.ts';

test('target FX reader maps persisted organisation observations for the layered resolver', async () => {
  const pool = await sharedTestPool();
  const seed = await beginSeed(pool, 'A3 target FX');
  await commitSeed(seed);
  const observationId = randomUUID();
  await pool.query(
    `INSERT INTO fx_observations
       (workspace_id, id, base_currency, quote_currency, rate, as_of, source_id, edition, expires_at, created_by_actor_id)
     VALUES ($1, $2, 'USD', 'SGD', '1.2703', '2026-08-25T00:00:00Z', 'org-budget-source', '1', '2026-12-31T00:00:00Z', $3)`,
    [seed.workspaceId, observationId, seed.actorId],
  );
  const reader = createPgBudgetFxRateReader(pool, seed.workspaceId);
  const rates = await reader.ratesFor('USD', 'SGD');
  assert.equal(rates.length, 1);
  assert.equal(rates[0]?.id, observationId);
  assert.equal(rates[0]?.authority, 'AUTHORITATIVE');
  assert.equal(rates[0]?.validUntil, '2026-12-31T00:00:00.000Z');
});

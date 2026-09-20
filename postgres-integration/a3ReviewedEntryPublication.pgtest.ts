import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createEphemeralDatabase, MIGRATIONS_DIR } from './harness.ts';
import { runMigrations } from '../src/persistence/postgres/migrate.ts';
import { beginSeed, commitSeed, seedJourney, seedOrganisation, seedTraveller, seedTrip } from './m3Seed.ts';
import { seedJurisdiction } from './m4Seed.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { captureWorld } from '../src/persistence/postgres/world/pgCurrentState.ts';
import { publishReviewedEntryKnowledge } from '../src/app/target/reviewedEntryPublication.ts';
import { coverageFor } from '../src/resolution/evaluation/evaluators/entry.ts';
import { ReviewedEntryPolicySchema } from '../src/resolution/planning/reviewedEntryEvidence.ts';

test('reviewed entry publication is source-verified, retryable and publishes complete scoped coverage last', async () => {
  const db = await createEphemeralDatabase();
  try {
    await runMigrations(db.pool, MIGRATIONS_DIR);
    const seed = await beginSeed(db.pool, 'Reviewed entry publication');
    const { travellerId } = await seedTraveller(seed);
    const tripId = await seedTrip(seed);
    const journeyId = await seedJourney(seed, { tripId, travellerId });
    const organisationId = await seedOrganisation(seed);
    const jurisdictionId = await seedJurisdiction(seed);
    await commitSeed(seed);
    const now = '2030-06-01T12:00:00.000Z';
    const source = { sourceId: 'official-test-source', url: 'https://authority.example/entry', publisher: 'Test public authority',
      text: 'Reviewed temporary-visit requirements', observedAt: '2030-06-01T11:30:00.000Z',
      contentSha256: createHash('sha256').update('Reviewed temporary-visit requirements').digest('hex') };
    const policy = ReviewedEntryPolicySchema.parse({
      id: 'temporary-entry-policy', countryCode: 'JP', nationalityCodes: ['SG'], purposes: ['tourism'],
      effectiveWindow: { start: '2030-05-01T00:00:00.000Z', end: '2030-07-01T00:00:00.000Z' },
      maxEvidenceAgeSeconds: 3600,
      sources: [{ sourceId: source.sourceId, url: source.url, publisher: source.publisher, contentSha256: source.contentSha256 }],
      expression: { operator: 'PREDICATE', predicateId: 'traveller.nationality_in', parameters: { codes: ['SG'] } },
    });
    const scope = { journeyId, visitId: randomUUID(), jurisdictionId, countryCode: 'JP', nationalityCode: 'SG', purpose: 'tourism',
      visitWindow: { start: '2030-06-20T00:00:00.000Z', end: '2030-06-21T00:00:00.000Z' } };
    const deps = { pool: db.pool, workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId,
      reviewerRef: { kind: 'ORGANISATION' as const, id: organisationId }, uow: () => new PgUnitOfWork(db.pool, seed.workspaceId) };
    const input = { policy, context: scope, now, actualOfficialDocumentEvidence: [source] };
    const count = async (table: 'knowledge_coverage' | 'rule_sets') => Number((await db.pool.query(
      `SELECT count(*) AS count FROM ${table} WHERE workspace_id = $1`, [seed.workspaceId],
    )).rows[0].count);
    const changed = await publishReviewedEntryKnowledge(deps, { ...input,
      actualOfficialDocumentEvidence: [{ ...source, text: 'Changed content with stale claimed hash' }] });
    assert.deepEqual(changed, { ok: false, reason: 'source_provenance_mismatch' });
    assert.equal(await count('rule_sets'), 0);
    assert.equal(await count('knowledge_coverage'), 0);

    // Real database rejection at the final command leaves a retryable prefix,
    // with no false complete-coverage claim. No internal command is mocked.
    await db.pool.query(`CREATE FUNCTION reject_test_entry_coverage() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected final coverage failure'; END; $$`);
    await db.pool.query(`CREATE TRIGGER reject_test_entry_coverage BEFORE INSERT ON knowledge_coverage
      FOR EACH ROW EXECUTE FUNCTION reject_test_entry_coverage()`);
    const interrupted = await publishReviewedEntryKnowledge(deps, input);
    assert.equal(interrupted.ok, false);
    assert.equal(await count('rule_sets'), 1);
    assert.equal(await count('knowledge_coverage'), 0);
    await db.pool.query('DROP TRIGGER reject_test_entry_coverage ON knowledge_coverage');
    const published = await publishReviewedEntryKnowledge(deps, input);
    assert.equal(published.ok, true, JSON.stringify(published));
    const repeated = await publishReviewedEntryKnowledge(deps, { ...input, now: '2030-06-01T12:01:00.000Z' });
    assert.deepEqual(repeated, published);
    assert.equal(await count('rule_sets'), 1);
    assert.equal(await count('knowledge_coverage'), 1);
    const world = await captureWorld(db.pool, { workspaceId: seed.workspaceId,
      focus: [{ kind: 'JOURNEY', id: journeyId }], at: now, informationTopics: ['ENTRY_REQUIREMENT'] });
    assert.equal(world.ruleSetVersions.length, 1);
    assert.equal(world.ruleSetVersions[0]!.policyFamily, 'entry');
    assert.equal(coverageFor(world, 'ENTRY_REQUIREMENT', jurisdictionId, now, scope).complete, true);
    assert.equal(coverageFor(world, 'ENTRY_REQUIREMENT', jurisdictionId, now, { ...scope, visitId: randomUUID() }).complete, false);
    assert.equal(coverageFor(world, 'ENTRY_REQUIREMENT', jurisdictionId, now,
      { ...scope, visitWindow: { ...scope.visitWindow, end: '2030-06-22T00:00:00.000Z' } }).complete, false);
    assert.equal(coverageFor(world, 'ENTRY_REQUIREMENT', jurisdictionId, '2030-06-01T12:30:00.000Z', scope).complete, false);
    assert.equal(world.intendedVisits.length, 0, 'research cannot create proposed travel intent');
    assert.equal(world.reservations.length, 0, 'research cannot book a stay');
  } finally {
    await db.drop();
  }
});

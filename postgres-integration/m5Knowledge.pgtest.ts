/**
 * M5 external knowledge, provenance, requirements and applicability against
 * real PostgreSQL/PostGIS. Every identity is generated in the fixture; the
 * tests exercise the same typed command and read ports M6 will consume.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed, seedTraveller, seedTrip } from './m2Seed.ts';
import { seedJurisdiction } from './m4Seed.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import {
  createOrganisation,
} from '../src/persistence/postgres/commands/peopleCommands.ts';
import {
  createRuleAssignment,
  createRuleSet,
  ingestInformationVersion,
  recordConstraintDefinition,
  recordEvidence,
  recordInformationRecord,
  recordInformationScope,
  recordKnowledgeCoverage,
  recordPreference,
  recordSource,
  recordObjective,
} from '../src/persistence/postgres/commands/knowledgeCommands.ts';
import { PgKnowledgeReadQueries } from '../src/persistence/postgres/queries/pgKnowledgeReadQueries.ts';
import {
  coverageSupportsUnqualifiedPass,
  informationVersionTemporalStatus,
  preferExplicitPreferences,
  rulePredicateRegistry,
} from '../src/domain/v2/knowledge/information.ts';
import type { TypedRef } from '../src/domain/v2/shared/identity.ts';

const T0 = Date.UTC(2030, 0, 1);
const at = (minutes: number): string => new Date(T0 + minutes * 60_000).toISOString();

function key(): string {
  return `m5:${randomUUID()}`;
}

function mustOk<T>(result: { ok: true; value: T } | { ok: false; conflict: { message: string } }): T {
  if (!result.ok) throw new Error(result.conflict.message);
  return result.value;
}

interface Fixture {
  pool: Pool;
  workspaceId: string;
  actorId: string;
  travellerId: string;
  tripId: string;
  jurisdictionId: string;
  organisationId: string;
  uow: PgUnitOfWork;
  sequence: number;
}

async function fixture(): Promise<Fixture> {
  const pool = await sharedTestPool();
  const seed = await beginSeed(pool, 'M5 integration fixture');
  const { travellerId } = await seedTraveller(seed);
  const tripId = await seedTrip(seed);
  // Integrated schema (0087): information scopes name real M4 jurisdictions.
  const jurisdictionId = await seedJurisdiction(seed, { name: 'M5 fixture jurisdiction' });
  await commitSeed(seed);
  const uow = new PgUnitOfWork(pool, seed.workspaceId);
  const organisationId = randomUUID();
  mustOk(await createOrganisation(uow, {
    workspaceId: seed.workspaceId,
    actorPrincipalId: seed.actorId,
    idempotencyKey: key(),
    organisationId,
    legalName: 'M5 Publisher',
    defaultCurrencyCode: 'SGD',
  }));
  return {
    pool,
    workspaceId: seed.workspaceId,
    actorId: seed.actorId,
    travellerId,
    tripId,
    jurisdictionId,
    organisationId,
    uow,
    sequence: 0,
  };
}

async function evidence(f: Fixture, subjectRef: TypedRef = { kind: 'ORGANISATION', id: f.organisationId }): Promise<string> {
  const sourceId = randomUUID();
  mustOk(await recordSource(f.uow, {
    workspaceId: f.workspaceId,
    actorPrincipalId: f.actorId,
    idempotencyKey: key(),
    sourceId,
    sourceIdentity: `publisher-feed:${f.organisationId}`,
    receivedAt: at(f.sequence++),
    contentHash: 'c'.repeat(64),
    contentType: 'application/json',
    protectedLocationRef: `vault://m5/${sourceId}`,
    rawContentHash: 'd'.repeat(64),
    rawAccessPolicyId: `policy:${f.workspaceId}`,
    captureMetadata: { capture: 'fixture' },
    captureMetadataVersion: 'm5-test/1',
  }));
  const evidenceId = randomUUID();
  mustOk(await recordEvidence(f.uow, {
    workspaceId: f.workspaceId,
    actorPrincipalId: f.actorId,
    idempotencyKey: key(),
    evidenceId,
    assertionType: 'M5_TEST_ASSERTION',
    observedAt: at(f.sequence++),
    issuedAt: at(f.sequence++),
    schemaVersion: 'm5-test/1',
    sourceIds: [sourceId],
    subjectRefs: [subjectRef],
    interpretationProvenance: 'deterministic integration fixture',
  }));
  return evidenceId;
}

function advisoryDetail() {
  return {
    sourceNativeSeverity: 'NOTICE',
    riskTopics: ['fixture-topic'],
    publisherMeanings: [{ code: 'NOTICE' }],
    sourceNativeDetail: { captured: true },
    detailSchemaVersion: 'advisory/1',
  };
}

describe('M5 knowledge lineage and provenance (real PostgreSQL)', () => {
  test('keeps publisher editions independent and quarantines duplicate or out-of-order delivery', async () => {
    const f = await fixture();
    const evidenceId = await evidence(f);
    const recordId = randomUUID();
    mustOk(await recordInformationRecord(f.uow, {
      workspaceId: f.workspaceId, actorPrincipalId: f.actorId, idempotencyKey: key(),
      informationRecordId: recordId, publisherOrganisationId: f.organisationId,
      externalPublicationKey: `publication:${recordId}`, topic: 'ENTRY_REQUIREMENT',
      sourceConnectionIdentity: `connection:${f.organisationId}`,
    }));
    const payloadHash = 'p'.repeat(64);
    const accepted = mustOk(await ingestInformationVersion(f.uow, {
      workspaceId: f.workspaceId, actorPrincipalId: f.actorId, idempotencyKey: key(),
      informationRecordId: recordId, subtype: 'ADVISORY', externalEditionSequence: 2,
      issuedAt: at(10), receivedAt: at(11), observedAt: at(12),
      effectiveWindow: { start: at(0), end: at(1000) }, evidenceId,
      normalizationVersion: 'm5-normalized/1', payloadHash, detail: advisoryDetail(),
      expectedRevision: 1,
    }));
    assert.equal(accepted.disposition, 'ACCEPTED');

    const future = mustOk(await ingestInformationVersion(f.uow, {
      workspaceId: f.workspaceId, actorPrincipalId: f.actorId, idempotencyKey: key(),
      informationRecordId: recordId, subtype: 'ADVISORY', externalEditionSequence: 3,
      issuedAt: at(13), receivedAt: at(14), observedAt: at(15),
      effectiveWindow: { start: at(100), end: at(200) }, evidenceId,
      supersedesInformationVersionId: accepted.informationVersionId,
      normalizationVersion: 'm5-normalized/1', payloadHash: 'f'.repeat(64), detail: advisoryDetail(),
      expectedRevision: 2,
    }));
    const retraction = mustOk(await ingestInformationVersion(f.uow, {
      workspaceId: f.workspaceId, actorPrincipalId: f.actorId, idempotencyKey: key(),
      informationRecordId: recordId, subtype: 'ADVISORY', externalEditionSequence: 4,
      issuedAt: at(16), receivedAt: at(17), observedAt: at(18),
      effectiveWindow: { start: at(300), end: at(400) }, evidenceId,
      retractsInformationVersionId: accepted.informationVersionId,
      normalizationVersion: 'm5-normalized/1', payloadHash: 'g'.repeat(64), detail: advisoryDetail(),
      expectedRevision: 3,
    }));
    assert.equal(informationVersionTemporalStatus({ effectiveWindow: { start: at(100), end: at(200) } }, at(50)), 'FUTURE_EFFECTIVE');
    assert.equal(informationVersionTemporalStatus({ effectiveWindow: { start: at(300), end: at(400) }, retractsInformationVersionId: accepted.informationVersionId }, at(50)), 'RETRACTED');

    const duplicate = mustOk(await ingestInformationVersion(f.uow, {
      workspaceId: f.workspaceId, actorPrincipalId: f.actorId, idempotencyKey: key(),
      informationRecordId: recordId, subtype: 'ADVISORY', externalEditionSequence: 2,
      issuedAt: at(10), receivedAt: at(11), observedAt: at(12),
      effectiveWindow: { start: at(0), end: at(1000) }, evidenceId,
      normalizationVersion: 'm5-normalized/1', payloadHash, detail: advisoryDetail(),
      expectedRevision: 4,
    }));
    assert.equal(duplicate.disposition, 'DUPLICATE_REPLAY');

    const mismatch = mustOk(await ingestInformationVersion(f.uow, {
      workspaceId: f.workspaceId, actorPrincipalId: f.actorId, idempotencyKey: key(),
      informationRecordId: recordId, subtype: 'ADVISORY', externalEditionSequence: 2,
      issuedAt: at(10), receivedAt: at(11), observedAt: at(12), evidenceId,
      normalizationVersion: 'm5-normalized/1', payloadHash: 'q'.repeat(64), detail: advisoryDetail(),
      expectedRevision: 4,
    }));
    assert.equal(mismatch.disposition, 'QUARANTINED');

    const outOfOrder = mustOk(await ingestInformationVersion(f.uow, {
      workspaceId: f.workspaceId, actorPrincipalId: f.actorId, idempotencyKey: key(),
      informationRecordId: recordId, subtype: 'ADVISORY', externalEditionSequence: 1,
      issuedAt: at(8), receivedAt: at(9), observedAt: at(9), evidenceId,
      normalizationVersion: 'm5-normalized/1', payloadHash: 'r'.repeat(64), detail: advisoryDetail(),
      expectedRevision: 4,
    }));
    assert.equal(outOfOrder.disposition, 'QUARANTINED');

    const rows = await f.pool.query<{ versions: string; quarantined: string; refs: string }>(
      `SELECT
         (SELECT count(*) FROM information_versions WHERE workspace_id = $1 AND information_record_id = $2) AS versions,
         (SELECT count(*) FROM information_quarantine WHERE workspace_id = $1 AND information_record_id = $2) AS quarantined,
         (SELECT count(*) FROM source_content_refs WHERE workspace_id = $1) AS refs`,
      [f.workspaceId, recordId],
    );
    assert.equal(Number(rows.rows[0]?.versions), 3);
    assert.equal(Number(rows.rows[0]?.quarantined), 2);
    assert.equal(Number(rows.rows[0]?.refs), 1);
    const reasons = await f.pool.query<{ rejection_reason: string }>(
      `SELECT rejection_reason FROM information_quarantine WHERE workspace_id = $1 ORDER BY created_at`,
      [f.workspaceId],
    );
    assert.deepEqual(reasons.rows.map((row) => row.rejection_reason), ['DUPLICATE_SEQUENCE_HASH_MISMATCH', 'OUT_OF_ORDER']);
    await assert.rejects(
      f.pool.query('UPDATE information_versions SET payload_hash = $1 WHERE workspace_id = $2 AND id = $3', ['z'.repeat(64), f.workspaceId, future.informationVersionId]),
      /append-only|immutable/,
    );
    assert.equal(retraction.disposition, 'ACCEPTED');
  });

  test('admits bounded rule expressions and resolves exact typed assignments', async () => {
    const f = await fixture();
    const expression = { operator: 'PREDICATE' as const, predicateId: 'credential.present', parameters: { kind: 'PASSPORT' } };
    const invalid = await createRuleSet(f.uow, {
      workspaceId: f.workspaceId, actorPrincipalId: f.actorId, idempotencyKey: key(), issuerRef: { kind: 'ORGANISATION', id: f.organisationId },
      policyFamily: 'ENTRY_REQUIREMENT', editionNumber: 1,
      expression: { operator: 'PREDICATE', predicateId: 'unsafe', parameters: { sql: 'select 1' } },
    });
    assert.equal(invalid.ok, false);
    if (!invalid.ok) assert.equal(invalid.conflict.kind, 'VALIDATION_FAILED');

    const invalidScript = await createRuleSet(f.uow, {
      workspaceId: f.workspaceId, actorPrincipalId: f.actorId, idempotencyKey: key(), issuerRef: { kind: 'ORGANISATION', id: f.organisationId },
      policyFamily: 'ENTRY_REQUIREMENT', editionNumber: 98,
      expression: { operator: 'PREDICATE', predicateId: 'unsafe', parameters: { script: 'return true' } },
    });
    assert.equal(invalidScript.ok, false);
    if (!invalidScript.ok) assert.equal(invalidScript.conflict.kind, 'VALIDATION_FAILED');

    const invalidUuid = await createRuleSet(f.uow, {
      workspaceId: f.workspaceId, actorPrincipalId: f.actorId, idempotencyKey: key(), issuerRef: { kind: 'ORGANISATION', id: 'not-a-uuid' },
      policyFamily: 'ENTRY_REQUIREMENT', editionNumber: 99, expression,
    });
    assert.equal(invalidUuid.ok, false);
    if (!invalidUuid.ok) assert.equal(invalidUuid.conflict.kind, 'VALIDATION_FAILED');

    const created = mustOk(await createRuleSet(f.uow, {
      workspaceId: f.workspaceId, actorPrincipalId: f.actorId, idempotencyKey: key(), issuerRef: { kind: 'ORGANISATION', id: f.organisationId },
      policyFamily: 'ENTRY_REQUIREMENT', editionNumber: 1, status: 'PUBLISHED', effectiveWindow: { start: at(0), end: at(2000) },
      publishedAt: at(1), publishedByActorId: f.actorId, expression,
      predicateRegistry: rulePredicateRegistry(['credential.present']),
      rules: [{ ruleKey: 'credential_present', statement: 'A required credential is present.', expression, severity: 'MANDATORY' }],
    }));
    const assignment = mustOk(await createRuleAssignment(f.uow, {
      workspaceId: f.workspaceId, actorPrincipalId: f.actorId, idempotencyKey: key(),
      ruleSetId: created.ruleSetId, ruleSetVersionId: created.versionId, subjectRef: { kind: 'TRAVELLER', id: f.travellerId },
      validFrom: at(0), validUntil: at(2000),
    }));
    await assert.rejects(
      f.pool.query('UPDATE rule_set_versions SET expression = $1 WHERE workspace_id = $2 AND id = $3', [JSON.stringify(expression), f.workspaceId, created.versionId]),
      /immutable/,
    );
    const queries = new PgKnowledgeReadQueries(f.pool, f.workspaceId);
    const found = await queries.ruleAssignmentsForSubject({ workspaceId: f.workspaceId, subjectRef: { kind: 'TRAVELLER', id: f.travellerId }, at: at(10) });
    assert.deepEqual(found.map((row) => row.assignmentId), [assignment.assignmentId]);
    assert.equal(found[0]?.ruleSetVersionId, created.versionId);
  });

  test('stores typed applicability, explicit-vs-inferred preferences, coverage and governing requirements', async () => {
    const f = await fixture();
    const provenance = await evidence(f, { kind: 'TRIP', id: f.tripId });
    const recordId = randomUUID();
    mustOk(await recordInformationRecord(f.uow, {
      workspaceId: f.workspaceId, actorPrincipalId: f.actorId, idempotencyKey: key(),
      informationRecordId: recordId, publisherOrganisationId: f.organisationId,
      externalPublicationKey: `publication:${recordId}`, topic: 'ADVISORY',
    }));
    const version = mustOk(await ingestInformationVersion(f.uow, {
      workspaceId: f.workspaceId, actorPrincipalId: f.actorId, idempotencyKey: key(),
      informationRecordId: recordId, subtype: 'ADVISORY', externalEditionSequence: 1,
      issuedAt: at(1), receivedAt: at(2), observedAt: at(3), effectiveWindow: { start: at(0), end: at(1000) },
      evidenceId: provenance, normalizationVersion: 'm5-normalized/1', payloadHash: 's'.repeat(64), detail: advisoryDetail(), expectedRevision: 1,
    }));
    const otherRecordId = randomUUID();
    mustOk(await recordInformationRecord(f.uow, {
      workspaceId: f.workspaceId, actorPrincipalId: f.actorId, idempotencyKey: key(),
      informationRecordId: otherRecordId, publisherOrganisationId: f.organisationId,
      externalPublicationKey: `publication:${otherRecordId}`, topic: 'ADVISORY',
    }));
    const wrongParentScope = await recordInformationScope(f.uow, {
      workspaceId: f.workspaceId, actorPrincipalId: f.actorId, idempotencyKey: key(),
      informationRecordId: otherRecordId, informationVersionId: version.informationVersionId,
      jurisdictionId: f.jurisdictionId, effectiveExposure: { start: at(0), end: at(1000) }, expectedRevision: 1,
    });
    assert.equal(wrongParentScope.ok, false);
    if (!wrongParentScope.ok) assert.equal(wrongParentScope.conflict.kind, 'VALIDATION_FAILED');
    const jurisdictionId = f.jurisdictionId;
    mustOk(await recordInformationScope(f.uow, {
      workspaceId: f.workspaceId, actorPrincipalId: f.actorId, idempotencyKey: key(),
      informationRecordId: recordId, informationVersionId: version.informationVersionId, jurisdictionId,
      effectiveExposure: { start: at(0), end: at(1000) }, expectedRevision: 2,
    }));
    mustOk(await recordPreference(f.uow, {
      workspaceId: f.workspaceId, actorPrincipalId: f.actorId, idempotencyKey: key(), ownerRef: { kind: 'TRAVELLER', id: f.travellerId },
      preferenceKind: 'seat', source: 'INFERRED', value: { aisle: true }, valueSchemaVersion: 'preference/1',
      effectiveWindow: { start: at(0), end: at(1000) }, evidenceId: provenance,
    }));
    mustOk(await recordPreference(f.uow, {
      workspaceId: f.workspaceId, actorPrincipalId: f.actorId, idempotencyKey: key(), ownerRef: { kind: 'TRAVELLER', id: f.travellerId },
      preferenceKind: 'seat', source: 'EXPLICIT', value: { aisle: false }, valueSchemaVersion: 'preference/1',
      effectiveWindow: { start: at(0), end: at(1000) }, evidenceId: provenance,
    }));
    const objective = mustOk(await recordObjective(f.uow, {
      workspaceId: f.workspaceId, actorPrincipalId: f.actorId, idempotencyKey: key(), ownerKind: 'TRIP', ownerId: f.tripId,
      successPredicate: 'all required journey items are viable', hardness: 'HARD', priority: 10,
    }));
    const constraint = mustOk(await recordConstraintDefinition(f.uow, {
      workspaceId: f.workspaceId, actorPrincipalId: f.actorId, idempotencyKey: key(), ownerRef: { kind: 'TRIP', id: f.tripId },
      registeredType: 'credential_requirement', hardness: 'HARD', parameterSchemaVersion: 'constraint/1', provenanceEvidenceId: provenance,
      operands: [{ key: 'credential_kind', kind: 'TEXT', value: 'PASSPORT' }],
    }));
    const coverage = mustOk(await recordKnowledgeCoverage(f.uow, {
      workspaceId: f.workspaceId, actorPrincipalId: f.actorId, idempotencyKey: key(), queryBounds: { jurisdictionId },
      queryBoundsVersion: 'coverage/1', topic: 'ADVISORY', edition: 'feed/1', completeness: 'COMPLETE',
      completenessLimitations: [], expiresAt: at(500), evidenceId: provenance,
    }));

    const queries = new PgKnowledgeReadQueries(f.pool, f.workspaceId);
    const applicable = await queries.applicableInformationVersions({ workspaceId: f.workspaceId, at: at(0), topic: 'ADVISORY', jurisdictionId });
    assert.equal(applicable[0]?.informationVersionId, version.informationVersionId);
    assert.deepEqual(await queries.informationScopesForVersion(f.workspaceId, version.informationVersionId), [
      {
        id: (await f.pool.query<{ id: string }>('SELECT id FROM information_scopes WHERE workspace_id = $1 AND information_version_id = $2', [f.workspaceId, version.informationVersionId])).rows[0]?.id,
        informationVersionId: version.informationVersionId, jurisdictionId, effectiveExposure: { start: at(0), end: at(1000) }, populationParameters: {},
      },
    ]);
    const storedPreferences = await f.pool.query<{ source: 'EXPLICIT' | 'INFERRED' }>(
      'SELECT source FROM preferences WHERE workspace_id = $1 AND owner_id = $2 ORDER BY created_at', [f.workspaceId, f.travellerId],
    );
    assert.equal(preferExplicitPreferences(storedPreferences.rows).at(0)?.source, 'EXPLICIT');
    assert.equal((await queries.coverageForTopic(f.workspaceId, 'ADVISORY', at(0))).at(0)?.id, coverage.coverageId);
    assert.equal((await queries.expiredKnowledge(f.workspaceId, at(501))).some((row) => row.id === coverage.coverageId), true);
    assert.equal((await queries.governingObjectives(f.workspaceId, { kind: 'TRIP', id: f.tripId })).at(0)?.id, objective.objectiveId);
    const governing = await queries.governingConstraints(f.workspaceId, { kind: 'TRIP', id: f.tripId });
    assert.equal(governing[0]?.id, constraint.constraintDefinitionId);
    assert.deepEqual(governing[0]?.operands, { credential_kind: 'PASSPORT' });

    const incomplete = mustOk(await recordKnowledgeCoverage(f.uow, {
      workspaceId: f.workspaceId, actorPrincipalId: f.actorId, idempotencyKey: key(), queryBounds: { jurisdictionId },
      queryBoundsVersion: 'coverage/1', topic: 'ADVISORY', edition: 'feed/2', completeness: 'INCOMPLETE',
      completenessLimitations: ['publisher omitted a category'], evidenceId: provenance,
    }));
    const unsupported = mustOk(await recordKnowledgeCoverage(f.uow, {
      workspaceId: f.workspaceId, actorPrincipalId: f.actorId, idempotencyKey: key(), queryBounds: { jurisdictionId },
      queryBoundsVersion: 'coverage/1', topic: 'ADVISORY', edition: 'feed/3', completeness: 'UNSUPPORTED_CATEGORY',
      completenessLimitations: ['category has no registered evaluator'], evidenceId: provenance,
    }));
    assert.equal(coverageSupportsUnqualifiedPass({ completeness: 'COMPLETE', completenessLimitations: [] }), true);
    assert.equal(coverageSupportsUnqualifiedPass({ completeness: 'INCOMPLETE', completenessLimitations: ['gap'] }), false);
    const coverageRows = await queries.coverageForTopic(f.workspaceId, 'ADVISORY', at(0));
    assert.equal(coverageRows.some((row) => row.id === incomplete.coverageId && row.completeness === 'INCOMPLETE'), true);
    assert.equal(coverageRows.some((row) => row.id === unsupported.coverageId && row.completeness === 'UNSUPPORTED_CATEGORY'), true);
    const constraintColumns = await f.pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'constraint_definitions'`,
    );
    assert.equal(constraintColumns.rows.some((row) => /pass|fail|unknown/i.test(row.column_name)), false);
  });
});

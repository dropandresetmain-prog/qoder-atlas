/**
 * R1 PostgreSQL — RecoveryPlanningAttempt persistence + migration 0125
 * constraints.
 *
 * CLOUD NOTE: this file requires a live PostgreSQL test database
 * (`npm run db:postgres:up` then `npm run test:postgres`). It is AUTHORED in the
 * Cloud sandbox but is NOT executed here and its passing is NOT claimed. It is
 * classified under the `postgres` suite in test/suites.json and is part of the
 * LOCAL integration-acceptance handoff.
 *
 * It pins the properties that make the attempt a trustworthy decision-evidence
 * record:
 *   - the command writes exactly one immutable row per (case, basis);
 *   - a replay of the same basis returns the stored outcome, not a second row;
 *   - `forbid_mutation()` rejects UPDATE/DELETE;
 *   - the unique (workspace, case, basis) index rejects a second attempt;
 *   - FKs to recovery_cases and assessments fail closed;
 *   - the completed_at >= started_at CHECK rejects an inverted interval;
 *   - bounded jsonb columns reject an oversized payload;
 *   - the read helpers round-trip the contract-parsed record.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed, seedRootSubject } from './m2Seed.ts';
import { seedJourney, seedTraveller, seedTrip } from './m6WorldSeed.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import {
  findRecoveryPlanningAttemptForBasis,
  loadRecoveryPlanningAttempt,
  persistRecoveryPlanningAttempt,
} from '../src/persistence/postgres/commands/r1PlanningAttemptCommands.ts';
import {
  assemblePlanningAttempt,
  materialCandidateFromValidationRejection,
} from '../src/resolution/planning/decisionEvidence.ts';
import type { WorldSnapshotManifest } from '../src/contracts/v2/scope/readScope.ts';
import type { Pool } from '../src/persistence/postgres/pool.ts';

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

const NOW = '2031-06-01T12:00:00.000Z';
const LATER = '2031-06-01T12:00:05.000Z';

function mustOk<T>(outcome: { ok: boolean; value?: T; conflict?: { kind: string; message: string } }): T {
  if (!outcome.ok || outcome.value === undefined) {
    throw new Error(`${outcome.conflict?.kind}: ${outcome.conflict?.message}`);
  }
  return outcome.value;
}

function manifest(): WorldSnapshotManifest {
  return { evaluatedAt: NOW, evaluatorVersions: [], aggregateReads: [], scopeReads: [], evidenceReads: [], coverageReads: [], missingCoverage: [] };
}

/** Seed a recovery case and a CURRENT assessment row to act as the FK basis. */
async function seedCaseAndBasis(pool: Pool) {
  const seed = await beginSeed(pool, 'R1 planning attempt persistence');
  const traveller = await seedTraveller(seed, { displayName: 'Attempt Traveller' });
  const tripId = await seedTrip(seed, { purpose: 'TEST' });
  const journeyId = await seedJourney(seed, { tripId, travellerId: traveller.travellerId });
  const caseId = await seedRootSubject(seed, { kind: 'RECOVERY_CASE' });
  await seed.client.query(
    `INSERT INTO recovery_cases (workspace_id, id, lifecycle_status, created_by_actor_id)
     VALUES ($1, $2, 'PLANNING', $3)`,
    [seed.workspaceId, caseId, seed.actorId],
  );
  const basisAssessmentId = randomUUID();
  await seed.client.query(
    `INSERT INTO assessments (workspace_id, id, kind, subject_kind, subject_id, evaluated_at, overall_verdict, manifest_detail, manifest_schema_version, created_by_actor_id)
     VALUES ($1, $2, 'VIABILITY', 'JOURNEY', $3, $4::timestamptz, 'FAIL', $5::jsonb, 'r1-planning-attempt-test', $6)`,
    [seed.workspaceId, basisAssessmentId, journeyId, NOW, JSON.stringify({ capture: null, coverageReads: [], missingCoverage: [], evaluatedAt: NOW }), seed.actorId],
  );
  await commitSeed(seed);
  return { workspaceId: seed.workspaceId, actorId: seed.actorId, caseId, basisAssessmentId, journeyId };
}

test('persistRecoveryPlanningAttempt writes one immutable row with denormalized outcome', async () => {
  const pool = await sharedTestPool();
  const ctx = await seedCaseAndBasis(pool);
  const uow = new PgUnitOfWork(pool, ctx.workspaceId);

  const rejected = materialCandidateFromValidationRejection({
    candidateKey: 'malformed', proposerId: 'some-proposer', domainId: 'TRANSPORT',
    validationReasonCodes: ['effects: too_small'],
  });
  const attempt = assemblePlanningAttempt({
    id: randomUUID(), recoveryCaseId: ctx.caseId, basisAssessmentId: ctx.basisAssessmentId,
    basisManifest: manifest(), startedAt: NOW, completedAt: LATER, coordinatorVersion: 'r1/1',
    domains: [{ domainId: 'PROGRAMME', source: 'DETERMINISTIC', disposition: 'INVESTIGATED', reasonCode: 'programme_obligation_unmet' }],
    evidence: [], materialCandidates: [rejected], viableStrategyRefs: [],
  });

  const result = mustOk(await persistRecoveryPlanningAttempt(uow, {
    workspaceId: ctx.workspaceId, actorPrincipalId: ctx.actorId, idempotencyKey: randomUUID(),
    attempt, outcome: 'NO_RECOVERY_FOUND',
  }));
  assert.equal(result.attemptId, attempt.id);
  assert.equal(result.outcome, 'NO_RECOVERY_FOUND');

  const row = await pool.query<{ outcome: string; material_candidates: unknown; coordinator_version: string }>(
    `SELECT outcome, material_candidates, coordinator_version FROM recovery_planning_attempts WHERE workspace_id = $1 AND id = $2`,
    [ctx.workspaceId, attempt.id],
  );
  assert.equal(row.rows[0]?.outcome, 'NO_RECOVERY_FOUND');
  assert.equal(row.rows[0]?.coordinator_version, 'r1/1');
  assert.ok(Array.isArray(row.rows[0]?.material_candidates));

  // forbid_mutation(): UPDATE and DELETE are rejected.
  await assert.rejects(
    () => pool.query(`UPDATE recovery_planning_attempts SET coordinator_version = 'tampered' WHERE workspace_id = $1 AND id = $2`, [ctx.workspaceId, attempt.id]),
    /forbid_mutation|immutable|cannot|trigger|append-only/i,
  );
  await assert.rejects(
    () => pool.query(`DELETE FROM recovery_planning_attempts WHERE workspace_id = $1 AND id = $2`, [ctx.workspaceId, attempt.id]),
    /forbid_mutation|immutable|cannot|trigger|append-only/i,
  );
});

test('persistRecoveryPlanningAttempt is idempotent per (case, basis): replay returns stored outcome', async () => {
  const pool = await sharedTestPool();
  const ctx = await seedCaseAndBasis(pool);
  const uow = new PgUnitOfWork(pool, ctx.workspaceId);
  const attempt = assemblePlanningAttempt({
    id: randomUUID(), recoveryCaseId: ctx.caseId, basisAssessmentId: ctx.basisAssessmentId,
    basisManifest: manifest(), startedAt: NOW, completedAt: LATER, coordinatorVersion: 'r1/1',
    domains: [], evidence: [], materialCandidates: [], viableStrategyRefs: [],
  });
  mustOk(await persistRecoveryPlanningAttempt(uow, {
    workspaceId: ctx.workspaceId, actorPrincipalId: ctx.actorId, idempotencyKey: randomUUID(),
    attempt, outcome: 'AWAITING_AUTHORITY',
  }));

  // A second attempt for the SAME basis is a replay: same stored outcome, no new row.
  const otherAttempt = assemblePlanningAttempt({
    id: randomUUID(), recoveryCaseId: ctx.caseId, basisAssessmentId: ctx.basisAssessmentId,
    basisManifest: manifest(), startedAt: NOW, completedAt: LATER, coordinatorVersion: 'r1/1',
    domains: [], evidence: [], materialCandidates: [], viableStrategyRefs: [],
  });
  const replay = mustOk(await persistRecoveryPlanningAttempt(uow, {
    workspaceId: ctx.workspaceId, actorPrincipalId: ctx.actorId, idempotencyKey: randomUUID(),
    attempt: otherAttempt, outcome: 'NO_RECOVERY_FOUND',
  }));
  assert.equal(replay.outcome, 'AWAITING_AUTHORITY', 'replay returns the originally stored outcome');
  assert.equal(replay.attemptId, attempt.id, 'replay returns the original attempt, not the new id');

  const count = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM recovery_planning_attempts WHERE workspace_id = $1 AND recovery_case_id = $2 AND basis_assessment_id = $3`,
    [ctx.workspaceId, ctx.caseId, ctx.basisAssessmentId],
  );
  assert.equal(count.rows[0]?.n, '1');
});

test('migration 0125 CHECKs: inverted interval and oversized jsonb are rejected at the DB', async () => {
  const pool = await sharedTestPool();
  const ctx = await seedCaseAndBasis(pool);

  // Inverted interval: completed_at < started_at violates the CHECK.
  await assert.rejects(
    () => pool.query(
      `INSERT INTO recovery_planning_attempts (workspace_id, id, recovery_case_id, basis_assessment_id, basis_manifest, started_at, completed_at, coordinator_version, outcome, created_by_actor_id)
       VALUES ($1,$2,$3,$4,'{}'::jsonb,$5::timestamptz,$6::timestamptz,'r1/1','NO_RECOVERY_FOUND',$7)`,
      [ctx.workspaceId, randomUUID(), ctx.caseId, ctx.basisAssessmentId, LATER, NOW, ctx.actorId],
    ),
    /interval_chk|check constraint|completed_at|violates/i,
  );

  // Oversized evidence jsonb (> 131072 bytes) violates the bounded-column CHECK.
  const huge = JSON.stringify([{ evidenceRef: 'x'.repeat(200000) }]);
  await assert.rejects(
    () => pool.query(
      `INSERT INTO recovery_planning_attempts (workspace_id, id, recovery_case_id, basis_assessment_id, basis_manifest, started_at, completed_at, coordinator_version, evidence, outcome, created_by_actor_id)
       VALUES ($1,$2,$3,$4,'{}'::jsonb,$5::timestamptz,$6::timestamptz,'r1/1',$7::jsonb,'NO_RECOVERY_FOUND',$8)`,
      [ctx.workspaceId, randomUUID(), ctx.caseId, ctx.basisAssessmentId, NOW, LATER, huge, ctx.actorId],
    ),
    /check constraint|pg_column_size|violates/i,
  );
});

test('migration 0125 FKs: a missing case or basis assessment is rejected', async () => {
  const pool = await sharedTestPool();
  const ctx = await seedCaseAndBasis(pool);

  // Missing recovery case.
  await assert.rejects(
    () => pool.query(
      `INSERT INTO recovery_planning_attempts (workspace_id, id, recovery_case_id, basis_assessment_id, basis_manifest, started_at, completed_at, coordinator_version, outcome, created_by_actor_id)
       VALUES ($1,$2,$3,$4,'{}'::jsonb,$5::timestamptz,$6::timestamptz,'r1/1','NO_RECOVERY_FOUND',$7)`,
      [ctx.workspaceId, randomUUID(), randomUUID(), ctx.basisAssessmentId, NOW, LATER, ctx.actorId],
    ),
    /foreign key|case_fk|violates/i,
  );

  // Missing basis assessment.
  await assert.rejects(
    () => pool.query(
      `INSERT INTO recovery_planning_attempts (workspace_id, id, recovery_case_id, basis_assessment_id, basis_manifest, started_at, completed_at, coordinator_version, outcome, created_by_actor_id)
       VALUES ($1,$2,$3,$4,'{}'::jsonb,$5::timestamptz,$6::timestamptz,'r1/1','NO_RECOVERY_FOUND',$7)`,
      [ctx.workspaceId, randomUUID(), ctx.caseId, randomUUID(), NOW, LATER, ctx.actorId],
    ),
    /foreign key|basis_fk|violates/i,
  );
});

test('read helpers round-trip the contract-parsed attempt', async () => {
  const pool = await sharedTestPool();
  const ctx = await seedCaseAndBasis(pool);
  const uow = new PgUnitOfWork(pool, ctx.workspaceId);
  const rejected = materialCandidateFromValidationRejection({
    candidateKey: 'malformed', proposerId: 'some-proposer', domainId: 'TRANSPORT',
    validationReasonCodes: ['effects: too_small'],
  });
  const attempt = assemblePlanningAttempt({
    id: randomUUID(), recoveryCaseId: ctx.caseId, basisAssessmentId: ctx.basisAssessmentId,
    basisManifest: manifest(), startedAt: NOW, completedAt: LATER, coordinatorVersion: 'r1/1',
    domains: [{ domainId: 'PROGRAMME', source: 'DETERMINISTIC', disposition: 'INVESTIGATED' }],
    evidence: [], materialCandidates: [rejected], viableStrategyRefs: [],
  });
  mustOk(await persistRecoveryPlanningAttempt(uow, {
    workspaceId: ctx.workspaceId, actorPrincipalId: ctx.actorId, idempotencyKey: randomUUID(),
    attempt, outcome: 'NEEDS_EVIDENCE_OR_DECISION',
  }));

  const byId = await loadRecoveryPlanningAttempt(pool, ctx.workspaceId, attempt.id);
  assert.ok(byId, 'attempt loads by id');
  assert.equal(byId!.outcome, 'NEEDS_EVIDENCE_OR_DECISION');
  assert.equal(byId!.attempt.id, attempt.id);
  assert.equal(byId!.attempt.materialCandidates.length, 1);
  assert.equal(byId!.attempt.recommendation, undefined);

  const byBasis = await findRecoveryPlanningAttemptForBasis(pool, ctx.workspaceId, ctx.caseId, ctx.basisAssessmentId);
  assert.ok(byBasis, 'attempt loads by (case, basis)');
  assert.equal(byBasis!.attempt.id, attempt.id);
});

test('migration 0125 objects are applied', async () => {
  const pool = await sharedTestPool();
  const tables = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1::text[]) ORDER BY tablename`,
    [['recovery_planning_attempts', 'recovery_planning_outcomes']],
  );
  assert.deepEqual(tables.rows.map((r) => r.tablename), ['recovery_planning_attempts', 'recovery_planning_outcomes']);
  const idx = await pool.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'recovery_planning_attempts' AND indexname = 'recovery_planning_attempts_case_basis_uidx'`,
  );
  assert.equal(idx.rows[0]?.indexname, 'recovery_planning_attempts_case_basis_uidx');
});

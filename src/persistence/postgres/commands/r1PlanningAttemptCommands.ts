/**
 * R1 — RecoveryPlanningAttempt persistence (migration 0125).
 *
 * A completed RecoveryPlanningAttempt is the single immutable decision-evidence
 * record for one planning basis (freeze C5). It is NOT a separately-addressed
 * aggregate root: `recovery_planning_attempts` has no `domain_subjects` identity
 * and 0125 registers no subject subtype checker, exactly like
 * `change_signal_completions` in 0124. It is evidence ABOUT a case's planning
 * basis, written once, never updated (0125's `forbid_mutation()` trigger), with
 * at most one row per (workspace, recovery_case, basis_assessment) enforced by a
 * unique index.
 *
 * The command runs through the normal idempotent `UnitOfWork` protocol so the
 * attempt write is atomic with the rest of the coordinator's completion unit of
 * work (viable RecoveryStrategy promotion, case phase advance). Because the row
 * is not an aggregate root, `advanced` is empty and no `change_records`/`outbox`
 * rows are emitted for it — the receipt + idempotency ledger still record the
 * command, mirroring `completeChangeSignal`.
 *
 * The persisted shape is exactly the contract-parsed `RecoveryPlanningAttempt`
 * plus the denormalized terminal `outcome` (from `RecoveryPlanningResult`, C1) so
 * read models and the Recovery Lifecycle Progression service can query the
 * outcome without re-deriving it. Nothing here is provider- or scenario-specific.
 */
import { z } from 'zod';
import {
  DomainCommandEnvelopeSchema,
  type DomainCommandEnvelope,
} from '../../../contracts/v2/command/domainCommand.ts';
import type { UnitOfWork } from '../../../contracts/v2/command/unitOfWork.ts';
import { typedConflict, type TypedConflict } from '../../../domain/v2/shared/errors.ts';
import {
  RecoveryPlanningAttemptSchema,
  RecoveryPlanningOutcomeSchema,
  type RecoveryPlanningAttempt,
  type RecoveryPlanningOutcome,
} from '../../../contracts/v2/planning/index.ts';
import type { RecoveryStrategy } from '../../../contracts/v2/scenario/recoveryStrategy.ts';
import { canonicalPayloadHash } from '../canonicalHash.ts';
import { appendAuditTrail, buildReceipt, type Queryable } from '../commandSupport.ts';
import { currentTransactionClient } from '../transactionContext.ts';
import type { ExecuteOutcome } from '../pgUnitOfWork.ts';
import {
  insertValidatedRecoveryStrategy,
  validateRecoveryStrategyForPersistence,
  type ValidatedRecoveryStrategyForPersistence,
} from './m7StrategyCommands.ts';

const SCHEMA_VERSION = '1';
const Uuid = z.string().uuid();

export interface PlanningAttemptCommandContext {
  workspaceId: string;
  actorPrincipalId: string;
  /** Deterministic per (case, basis); retries and replays share one identity. */
  idempotencyKey: string;
}

export interface PersistRecoveryPlanningAttemptParams extends PlanningAttemptCommandContext {
  attempt: RecoveryPlanningAttempt;
  /** Denormalized terminal outcome from the coordinator result (C1). */
  outcome: RecoveryPlanningOutcome;
}

export interface RecoveryPlanningAttemptPersistedResult {
  attemptId: string;
  recoveryCaseId: string;
  basisAssessmentId: string;
  outcome: RecoveryPlanningOutcome;
}

const attemptInput = z.strictObject({
  attempt: RecoveryPlanningAttemptSchema,
  outcome: RecoveryPlanningOutcomeSchema,
});

/**
 * The attempt's own id and its two FK ids are `uuid` columns, while the contract
 * models them as `SubjectId` (a broader regex). A uuid satisfies SubjectId, so
 * this only narrows at the DB boundary — a non-uuid id is a programming error
 * surfaced as VALIDATION_FAILED rather than a raw driver failure.
 */
function uuidIdOrConflict(label: string, value: string): TypedConflict | undefined {
  return Uuid.safeParse(value).success
    ? undefined
    : typedConflict('VALIDATION_FAILED', `${label} must be a uuid for persistence: ${value}`, []);
}

/**
 * Persist one immutable RecoveryPlanningAttempt. Idempotent: a second write for
 * the same (case, basis) returns the original as a replay (at most one attempt
 * per basis, enforced by `recovery_planning_attempts_case_basis_uidx`). A
 * concurrent unique violation is mapped to DUPLICATE_REGISTRATION.
 */
export async function persistRecoveryPlanningAttempt(
  uow: UnitOfWork,
  params: PersistRecoveryPlanningAttemptParams,
): Promise<ExecuteOutcome<RecoveryPlanningAttemptPersistedResult>> {
  const parsed = attemptInput.safeParse({ attempt: params.attempt, outcome: params.outcome });
  if (!parsed.success) {
    return { ok: false, conflict: typedConflict('VALIDATION_FAILED', parsed.error.message, []) };
  }
  const attempt = parsed.data.attempt;
  const outcome = parsed.data.outcome;

  for (const check of [
    uuidIdOrConflict('recovery_planning_attempts.id', attempt.id),
    uuidIdOrConflict('recovery_planning_attempts.recovery_case_id', attempt.recoveryCaseId),
    uuidIdOrConflict('recovery_planning_attempts.basis_assessment_id', attempt.basisAssessmentId),
  ]) {
    if (check) return { ok: false, conflict: check };
  }

  const payload = {
    attemptId: attempt.id,
    recoveryCaseId: attempt.recoveryCaseId,
    basisAssessmentId: attempt.basisAssessmentId,
    outcome,
  };
  const envelope: DomainCommandEnvelope = DomainCommandEnvelopeSchema.parse({
    commandType: 'RECOVERY_PLANNING_ATTEMPT_PERSISTED',
    schemaVersion: SCHEMA_VERSION,
    workspaceId: params.workspaceId,
    actorPrincipalId: params.actorPrincipalId,
    idempotencyKey: params.idempotencyKey,
    canonicalPayloadHash: canonicalPayloadHash(payload),
    basisAssessmentId: attempt.basisAssessmentId,
    typedPayload: payload,
    evidenceRefs: [],
  });
  const committedAt = new Date().toISOString();

  try {
    return await uow.execute<RecoveryPlanningAttemptPersistedResult>(envelope, async () => {
      const client = currentTransactionClient();

      // At most one attempt per basis: an existing row is a replay, never a
      // second evidence record. The stored outcome is returned unchanged.
      const existing = await client.query<{ id: string; outcome: string }>(
        'SELECT id, outcome FROM recovery_planning_attempts WHERE workspace_id = $1 AND recovery_case_id = $2 AND basis_assessment_id = $3',
        [params.workspaceId, attempt.recoveryCaseId, attempt.basisAssessmentId],
      );
      const prior = existing.rows[0];
      if (prior) {
        return {
          ok: true,
          value: {
            attemptId: prior.id,
            recoveryCaseId: attempt.recoveryCaseId,
            basisAssessmentId: attempt.basisAssessmentId,
            outcome: prior.outcome as RecoveryPlanningOutcome,
          },
          receipt: buildReceipt({
            envelope,
            value: {
              attemptId: prior.id,
              recoveryCaseId: attempt.recoveryCaseId,
              basisAssessmentId: attempt.basisAssessmentId,
              outcome: prior.outcome as RecoveryPlanningOutcome,
            },
            advanced: [],
            committedAt,
          }),
        };
      }

      // FK targets must exist; fail closed with a typed conflict rather than a
      // raw driver FK violation.
      const caseRow = await client.query<{ id: string }>(
        'SELECT id FROM recovery_cases WHERE workspace_id = $1 AND id = $2',
        [params.workspaceId, attempt.recoveryCaseId],
      );
      if (!caseRow.rows[0]) {
        return {
          ok: false,
          conflict: typedConflict('VALIDATION_FAILED', `recovery case ${attempt.recoveryCaseId} not found`, []),
        };
      }
      const basisRow = await client.query<{ id: string }>(
        'SELECT id FROM assessments WHERE workspace_id = $1 AND id = $2',
        [params.workspaceId, attempt.basisAssessmentId],
      );
      if (!basisRow.rows[0]) {
        return {
          ok: false,
          conflict: typedConflict('VALIDATION_FAILED', `basis assessment ${attempt.basisAssessmentId} not found`, []),
        };
      }

      await client.query(
        `INSERT INTO recovery_planning_attempts (
           workspace_id, id, recovery_case_id, basis_assessment_id, basis_manifest,
            started_at, completed_at, coordinator_version, domains, evidence, model_activities,
            material_candidates, viable_strategy_refs, recommendation, outcome,
            created_by_actor_id
          ) VALUES (
            $1,$2,$3,$4,$5::jsonb,$6::timestamptz,$7::timestamptz,$8,$9::jsonb,$10::jsonb,
            $11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15,$16
         )`,
        [
          params.workspaceId,
          attempt.id,
          attempt.recoveryCaseId,
          attempt.basisAssessmentId,
          JSON.stringify(attempt.basisManifest),
          attempt.startedAt,
          attempt.completedAt,
          attempt.coordinatorVersion,
           JSON.stringify(attempt.domains),
           JSON.stringify(attempt.evidence),
           JSON.stringify(attempt.modelActivities),
           JSON.stringify(attempt.materialCandidates),
           JSON.stringify(attempt.viableStrategyRefs),
           attempt.recommendation === undefined ? null : JSON.stringify(attempt.recommendation),
           outcome,
           params.actorPrincipalId,
        ],
      );

      const value: RecoveryPlanningAttemptPersistedResult = {
        attemptId: attempt.id,
        recoveryCaseId: attempt.recoveryCaseId,
        basisAssessmentId: attempt.basisAssessmentId,
        outcome,
      };
      // Not an aggregate root: no change_records/outbox rows are emitted for the
      // attempt itself (nothing advanced), matching `completeChangeSignal`. The
      // receipt + idempotency ledger still record the command.
      return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced: [], committedAt }) };
    });
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    const message = error instanceof Error ? error.message : String(error);
    if (code === '23505') {
      return {
        ok: false,
        conflict: typedConflict(
          'DUPLICATE_REGISTRATION',
          `recovery planning attempt for case ${attempt.recoveryCaseId} basis ${attempt.basisAssessmentId} already exists`,
          [],
        ),
      };
    }
    return { ok: false, conflict: typedConflict('VALIDATION_FAILED', message, []) };
  }
}

/**
 * Commits one completed planning basis as a single PostgreSQL command.
 *
 * A viable strategy without its immutable PlanningAttempt (or the inverse) is
 * not a truthful operator decision surface. The coordinator therefore uses
 * this composite command rather than independently committing its strategy,
 * attempt and AWAITING_AUTHORITY transition. It deliberately does not invent a
 * distributed transaction: all three records share the existing UnitOfWork.
 */
export async function persistRecoveryPlanningCompletion(
  uow: UnitOfWork,
  params: PlanningAttemptCommandContext & {
    attempt: RecoveryPlanningAttempt;
    outcome: RecoveryPlanningOutcome;
    viableStrategies: readonly RecoveryStrategy[];
  },
): Promise<ExecuteOutcome<RecoveryPlanningAttemptPersistedResult>> {
  const parsed = attemptInput.safeParse({ attempt: params.attempt, outcome: params.outcome });
  if (!parsed.success) return { ok: false, conflict: typedConflict('VALIDATION_FAILED', parsed.error.message, []) };
  const attempt = parsed.data.attempt;
  const outcome = parsed.data.outcome;
  for (const check of [
    uuidIdOrConflict('recovery_planning_attempts.id', attempt.id),
    uuidIdOrConflict('recovery_planning_attempts.recovery_case_id', attempt.recoveryCaseId),
    uuidIdOrConflict('recovery_planning_attempts.basis_assessment_id', attempt.basisAssessmentId),
  ]) {
    if (check) return { ok: false, conflict: check };
  }

  const validatedStrategies: ValidatedRecoveryStrategyForPersistence[] = [];
  for (const strategy of params.viableStrategies) {
    const validated = validateRecoveryStrategyForPersistence({ ...strategy, status: 'EVALUATED', candidateAssessmentResults: [] });
    if (!validated.ok) return validated;
    if (validated.value.strategy.viability !== 'VIABLE') {
      return { ok: false, conflict: typedConflict('VALIDATION_FAILED', `planning completion may only promote VIABLE strategy ${strategy.id}`, []) };
    }
    validatedStrategies.push(validated.value);
  }
  const expectedRefs = [...attempt.viableStrategyRefs].sort();
  const suppliedRefs = validatedStrategies.map((item) => item.strategy.id).sort();
  if (JSON.stringify(expectedRefs) !== JSON.stringify(suppliedRefs)) {
    return { ok: false, conflict: typedConflict('VALIDATION_FAILED', 'attempt viableStrategyRefs must exactly match promoted viable strategies', []) };
  }
  if ((outcome === 'AWAITING_AUTHORITY') !== (suppliedRefs.length > 0)) {
    return { ok: false, conflict: typedConflict('VALIDATION_FAILED', 'planning outcome and viable strategy set disagree', []) };
  }

  const payload = {
    attemptId: attempt.id,
    recoveryCaseId: attempt.recoveryCaseId,
    basisAssessmentId: attempt.basisAssessmentId,
    outcome,
    viableStrategyIds: suppliedRefs,
  };
  const envelope: DomainCommandEnvelope = DomainCommandEnvelopeSchema.parse({
    commandType: 'RECOVERY_PLANNING_COMPLETED',
    schemaVersion: SCHEMA_VERSION,
    workspaceId: params.workspaceId,
    actorPrincipalId: params.actorPrincipalId,
    idempotencyKey: params.idempotencyKey,
    canonicalPayloadHash: canonicalPayloadHash(payload),
    basisAssessmentId: attempt.basisAssessmentId,
    typedPayload: payload,
    evidenceRefs: [],
  });
  const committedAt = new Date().toISOString();

  try {
    return await uow.execute<RecoveryPlanningAttemptPersistedResult>(envelope, async () => {
      const client = currentTransactionClient();
      const caseRow = await client.query<{ lifecycle_status: string }>(
        'SELECT lifecycle_status FROM recovery_cases WHERE workspace_id = $1 AND id = $2 FOR UPDATE',
        [params.workspaceId, attempt.recoveryCaseId],
      );
      const status = caseRow.rows[0]?.lifecycle_status;
      if (!status) return { ok: false, conflict: typedConflict('VALIDATION_FAILED', `recovery case ${attempt.recoveryCaseId} not found`, []) };
      if (!['PLANNING', 'AWAITING_AUTHORITY'].includes(status)) {
        return { ok: false, conflict: typedConflict('STALE_AGGREGATE_REVISION', `recovery case ${attempt.recoveryCaseId} is ${status}, not a promotable planning phase`, []) };
      }
      const basis = await client.query<{ id: string; subject_kind: string; subject_id: string }>(
        `SELECT a.id, a.subject_kind, a.subject_id FROM assessments a
          WHERE a.workspace_id = $1 AND a.id = $2
            AND NOT EXISTS (SELECT 1 FROM assessments newer WHERE newer.workspace_id = a.workspace_id AND newer.supersedes_assessment_id = a.id)`,
        [params.workspaceId, attempt.basisAssessmentId],
      );
      if (!basis.rows[0]) {
        return { ok: false, conflict: typedConflict('STALE_AGGREGATE_REVISION', `planning basis ${attempt.basisAssessmentId} is no longer current`, []) };
      }
      const pending = await client.query<{ id: string }>(
        `SELECT id FROM scheduled_reassessments
          WHERE workspace_id = $1 AND subject_kind = $2 AND subject_id = $3
            AND assessment_kind = 'VIABILITY' AND state <> 'DONE' LIMIT 1`,
        [params.workspaceId, basis.rows[0].subject_kind, basis.rows[0].subject_id],
      );
      if (pending.rows[0]) {
        return { ok: false, conflict: typedConflict('STALE_AGGREGATE_REVISION', `planning basis ${attempt.basisAssessmentId} has pending reassessment work`, []) };
      }

      const existing = await client.query<{ id: string; outcome: string }>(
        `SELECT id, outcome FROM recovery_planning_attempts
          WHERE workspace_id = $1 AND recovery_case_id = $2 AND basis_assessment_id = $3`,
        [params.workspaceId, attempt.recoveryCaseId, attempt.basisAssessmentId],
      );
      if (existing.rows[0]) {
        return {
          ok: true,
          value: { attemptId: existing.rows[0].id, recoveryCaseId: attempt.recoveryCaseId, basisAssessmentId: attempt.basisAssessmentId, outcome: existing.rows[0].outcome as RecoveryPlanningOutcome },
          receipt: buildReceipt({ envelope, value: { attemptId: existing.rows[0].id, recoveryCaseId: attempt.recoveryCaseId, basisAssessmentId: attempt.basisAssessmentId, outcome: existing.rows[0].outcome as RecoveryPlanningOutcome }, advanced: [], committedAt }),
        };
      }

      const advanced = [] as Awaited<ReturnType<typeof insertValidatedRecoveryStrategy>>['advanced'];
      for (const validated of validatedStrategies) {
        const prior = await client.query<{ id: string }>(
          'SELECT id FROM recovery_strategies WHERE workspace_id = $1 AND id = $2',
          [params.workspaceId, validated.strategy.id],
        );
        if (prior.rows[0]) continue;
        const inserted = await insertValidatedRecoveryStrategy({
          workspaceId: params.workspaceId,
          actorPrincipalId: params.actorPrincipalId,
          validated,
        });
        advanced.push(...inserted.advanced);
      }

      await client.query(
        `INSERT INTO recovery_planning_attempts (
           workspace_id, id, recovery_case_id, basis_assessment_id, basis_manifest,
            started_at, completed_at, coordinator_version, domains, evidence, model_activities,
            material_candidates, viable_strategy_refs, recommendation, outcome,
            created_by_actor_id
          ) VALUES ($1,$2,$3,$4,$5::jsonb,$6::timestamptz,$7::timestamptz,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15,$16)`,
        [
          params.workspaceId, attempt.id, attempt.recoveryCaseId, attempt.basisAssessmentId,
           JSON.stringify(attempt.basisManifest), attempt.startedAt, attempt.completedAt,
           attempt.coordinatorVersion, JSON.stringify(attempt.domains), JSON.stringify(attempt.evidence),
           JSON.stringify(attempt.modelActivities),
           JSON.stringify(attempt.materialCandidates), JSON.stringify(attempt.viableStrategyRefs),
          attempt.recommendation === undefined ? null : JSON.stringify(attempt.recommendation),
          outcome, params.actorPrincipalId,
        ],
      );
      if (outcome === 'AWAITING_AUTHORITY' && status === 'PLANNING') {
        await client.query(
          `UPDATE recovery_cases SET lifecycle_status = 'AWAITING_AUTHORITY'
            WHERE workspace_id = $1 AND id = $2 AND lifecycle_status = 'PLANNING'`,
          [params.workspaceId, attempt.recoveryCaseId],
        );
      }
      const value: RecoveryPlanningAttemptPersistedResult = {
        attemptId: attempt.id,
        recoveryCaseId: attempt.recoveryCaseId,
        basisAssessmentId: attempt.basisAssessmentId,
        outcome,
      };
      await appendAuditTrail({ envelope, advanced, destinationKind: 'RECOVERY_PLANNING', payload: value });
      return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced, committedAt }) };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, conflict: typedConflict('VALIDATION_FAILED', message, []) };
  }
}

/** The persisted attempt row, re-parsed through the contract for round-trip fidelity. */
export interface RecoveryPlanningAttemptRow {
  attempt: RecoveryPlanningAttempt;
  outcome: RecoveryPlanningOutcome;
}

/** Read helper: one attempt by id. */
export async function loadRecoveryPlanningAttempt(
  db: Queryable,
  workspaceId: string,
  attemptId: string,
): Promise<RecoveryPlanningAttemptRow | undefined> {
  const result = await db.query<RecoveryPlanningAttemptRawRow>(
    `SELECT id, recovery_case_id, basis_assessment_id, basis_manifest, started_at, completed_at,
             coordinator_version, domains, evidence, model_activities, material_candidates, viable_strategy_refs,
            recommendation, outcome
       FROM recovery_planning_attempts
      WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, attemptId],
  );
  return rowToAttempt(result.rows[0]);
}

/** Read helper: the single attempt for a (case, basis), if any. */
export async function findRecoveryPlanningAttemptForBasis(
  db: Queryable,
  workspaceId: string,
  recoveryCaseId: string,
  basisAssessmentId: string,
): Promise<RecoveryPlanningAttemptRow | undefined> {
  const result = await db.query<RecoveryPlanningAttemptRawRow>(
    `SELECT id, recovery_case_id, basis_assessment_id, basis_manifest, started_at, completed_at,
             coordinator_version, domains, evidence, model_activities, material_candidates, viable_strategy_refs,
            recommendation, outcome
       FROM recovery_planning_attempts
      WHERE workspace_id = $1 AND recovery_case_id = $2 AND basis_assessment_id = $3`,
    [workspaceId, recoveryCaseId, basisAssessmentId],
  );
  return rowToAttempt(result.rows[0]);
}

/**
 * Read helper: the planning attempt the Case should show. Prefer an attempt
 * whose basis assessment is still current. Two attempts can share `completed_at`
 * when both were stamped with the evaluation clock; a superseded stale-retry
 * row must not hide the plan for the current basis just because its assessment
 * id sorts later. Among current bases, the latest completion wins, with the
 * basis id only as a stable final tiebreak.
 */
export async function findLatestRecoveryPlanningAttemptForCase(
  db: Queryable,
  workspaceId: string,
  recoveryCaseId: string,
): Promise<RecoveryPlanningAttemptRow | undefined> {
  const result = await db.query<RecoveryPlanningAttemptRawRow>(
    `SELECT id, recovery_case_id, basis_assessment_id, basis_manifest, started_at, completed_at,
             coordinator_version, domains, evidence, model_activities, material_candidates, viable_strategy_refs,
            recommendation, outcome
       FROM recovery_planning_attempts attempt
      WHERE attempt.workspace_id = $1 AND attempt.recovery_case_id = $2
      ORDER BY EXISTS (
                 SELECT 1 FROM assessments newer
                  WHERE newer.workspace_id = attempt.workspace_id
                    AND newer.supersedes_assessment_id = attempt.basis_assessment_id
               ) ASC,
               attempt.completed_at DESC,
               attempt.basis_assessment_id DESC
      LIMIT 1`,
    [workspaceId, recoveryCaseId],
  );
  return rowToAttempt(result.rows[0]);
}

/** The driver row shape for one `recovery_planning_attempts` row. */
interface RecoveryPlanningAttemptRawRow {
  id: string;
  recovery_case_id: string;
  basis_assessment_id: string;
  basis_manifest: unknown;
  started_at: Date;
  completed_at: Date;
  coordinator_version: string;
  domains: unknown;
  evidence: unknown;
  model_activities: unknown;
  material_candidates: unknown;
  viable_strategy_refs: unknown;
  recommendation: unknown | null;
  outcome: string;
}

function rowToAttempt(
  row: RecoveryPlanningAttemptRawRow | undefined,
): RecoveryPlanningAttemptRow | undefined {
  if (!row) return undefined;
  const attempt = RecoveryPlanningAttemptSchema.parse({
    id: row.id,
    recoveryCaseId: row.recovery_case_id,
    basisAssessmentId: row.basis_assessment_id,
    basisManifest: row.basis_manifest,
    startedAt: row.started_at.toISOString(),
    completedAt: row.completed_at.toISOString(),
    coordinatorVersion: row.coordinator_version,
    domains: row.domains,
    evidence: row.evidence,
    modelActivities: row.model_activities,
    materialCandidates: row.material_candidates,
    viableStrategyRefs: row.viable_strategy_refs,
    ...(row.recommendation === null || row.recommendation === undefined
      ? {}
      : { recommendation: row.recommendation }),
  });
  const outcome = RecoveryPlanningOutcomeSchema.parse(row.outcome);
  return { attempt, outcome };
}

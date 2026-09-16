/**
 * PostgreSQL assessment persistence, currentness view and durable reassessment
 * worker for M6 (0091).
 *
 * - `saveAssessment` writes one immutable AssessmentResult (registry subject,
 *   root, typed results, manifest input rows) in one transaction, optionally
 *   superseding the previous latest assessment of the same subject+kind.
 * - `currentAssessmentView` never reports CURRENT from stored state alone: it
 *   reloads the manifest's heads/generations and applies the injected clock.
 *   STALE / PENDING_REASSESSMENT / UNAVAILABLE are explicit.
 * - `PgReassessmentWorker` claims work with a lease and fencing token, runs the
 *   injected pipeline (capture -> project -> evaluate), and commits the new
 *   assessment together with completing its claim. A failed run becomes
 *   PENDING with backoff, then UNAVAILABLE after bounded attempts — never
 *   silently current. A stale worker cannot complete its replacement's claim.
 */
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { SubjectKind, TypedRef } from '../../../domain/v2/shared/identity.ts';
import type { Instant } from '../../../domain/v2/shared/time.ts';
import { AssessmentResultSchema, type AssessmentKind, type AssessmentResult } from '../../../contracts/v2/assessment/assessmentManifest.ts';
import type { WorldSnapshotManifest } from '../../../contracts/v2/scope/readScope.ts';
import type { AssessmentViewStatus } from '../../../contracts/v2/product/readModels.ts';
import { assessManifestCurrentness, type StalenessReason } from '../../../resolution/world/currentness.ts';
import { PgCurrentStateReader } from './pgCurrentState.ts';

export const MANIFEST_DETAIL_VERSION = 'm6-manifest-detail/1';
export const EXPLANATION_SCHEMA_VERSION = 'm6-explanation/1';

export interface StoredAssessment {
  result: AssessmentResult;
  supersedesAssessmentId: string | null;
}

async function insertAssessment(client: PoolClient, workspaceId: string, result: AssessmentResult, supersedes: string | null, actorId: string): Promise<void> {
  const parsed = AssessmentResultSchema.parse(result);
  const primary = parsed.subjects[0]!.subjectRef;
  const detail = {
    capture: parsed.manifest.capture ?? null,
    coverageReads: parsed.manifest.coverageReads,
    missingCoverage: parsed.manifest.missingCoverage,
    evaluatedAt: parsed.manifest.evaluatedAt,
  };
  await client.query('INSERT INTO aggregate_heads (workspace_id, aggregate_id, revision) VALUES ($1, $2, 1)', [workspaceId, parsed.id]);
  await client.query("INSERT INTO domain_subjects (workspace_id, id, kind, aggregate_id) VALUES ($1, $2, 'ASSESSMENT', $2)", [workspaceId, parsed.id]);
  await client.query(
    `INSERT INTO assessments (workspace_id, id, kind, subject_kind, subject_id, evaluated_at, overall_verdict, next_invalidation_at,
                              supersedes_assessment_id, manifest_detail, manifest_schema_version, created_by_actor_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [workspaceId, parsed.id, parsed.kind, primary.kind, primary.id, parsed.evaluatedAt, parsed.overallVerdict, parsed.manifest.nextInvalidationAt ?? null,
      supersedes, JSON.stringify(detail), MANIFEST_DETAIL_VERSION, actorId],
  );
  for (const s of parsed.subjects) {
    await client.query('INSERT INTO assessment_subjects (workspace_id, assessment_id, subject_kind, subject_id, role) VALUES ($1, $2, $3, $4, $5)',
      [workspaceId, parsed.id, s.subjectRef.kind, s.subjectRef.id, s.role]);
  }
  for (const d of parsed.dimensions) {
    await client.query(
      `INSERT INTO assessment_results (workspace_id, assessment_id, dimension, verdict, applicable, blocking, explanations, explanation_schema_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [workspaceId, parsed.id, d.dimension, d.verdict, d.applicable, d.blocking, JSON.stringify(d.explanations), EXPLANATION_SCHEMA_VERSION],
    );
  }
  const inputs: [string, string, number | null, number | null, string | null][] = [
    ...parsed.manifest.aggregateReads.map((r): [string, string, number | null, number | null, string | null] => ['AGGREGATE', `${r.aggregateRef.kind}:${r.aggregateRef.id}`, r.revision, null, null]),
    ...parsed.manifest.scopeReads.map((r): [string, string, number | null, number | null, string | null] => ['SCOPE', `${r.scopeKind}:${r.scopeId}`, null, r.generation, null]),
    ...parsed.manifest.evidenceReads.map((id): [string, string, number | null, number | null, string | null] => ['EVIDENCE', id, null, null, null]),
    ...parsed.manifest.evaluatorVersions.map((v): [string, string, number | null, number | null, string | null] => ['EVALUATOR', v.evaluatorId, null, null, v.version]),
  ];
  if (inputs.length > 0) {
    await client.query(
      `INSERT INTO assessment_inputs (workspace_id, assessment_id, input_kind, input_key, revision, generation, version)
       SELECT $1, $2, k, key, rev, gen, ver FROM unnest($3::text[], $4::text[], $5::bigint[], $6::bigint[], $7::text[]) AS t(k, key, rev, gen, ver)`,
      [workspaceId, parsed.id, inputs.map((i) => i[0]), inputs.map((i) => i[1]), inputs.map((i) => i[2]), inputs.map((i) => i[3]), inputs.map((i) => i[4])],
    );
  }
}

async function latestAssessmentId(client: Pool | PoolClient, workspaceId: string, subject: TypedRef, kind: AssessmentKind): Promise<string | null> {
  const result = await client.query<{ id: string }>(
    `SELECT a.id FROM assessments a
      WHERE a.workspace_id = $1 AND a.subject_kind = $2 AND a.subject_id = $3 AND a.kind = $4
        AND NOT EXISTS (SELECT 1 FROM assessments s WHERE s.workspace_id = a.workspace_id AND s.supersedes_assessment_id = a.id)`,
    [workspaceId, subject.kind, subject.id, kind],
  );
  return result.rows[0]?.id ?? null;
}

async function manifestStillCurrent(client: PoolClient, workspaceId: string, manifest: WorldSnapshotManifest): Promise<boolean> {
  const heads = await client.query<{ kind: string; id: string; revision: string }>(
    `SELECT ds.kind, h.aggregate_id AS id, h.revision FROM aggregate_heads h JOIN domain_subjects ds ON ds.workspace_id = h.workspace_id AND ds.id = h.aggregate_id
      WHERE h.workspace_id = $1 AND h.aggregate_id = ANY($2::uuid[])`,
    [workspaceId, [...new Set(manifest.aggregateReads.map((r) => r.aggregateRef.id))]],
  );
  const scopes = await client.query<{ scope_kind: string; scope_id: string; generation: string }>(
    `SELECT scope_kind, scope_id, generation FROM scope_generations
      WHERE workspace_id = $1 AND (scope_kind, scope_id) IN (SELECT * FROM unnest($2::text[], $3::text[]))`,
    [workspaceId, manifest.scopeReads.map((s) => s.scopeKind), manifest.scopeReads.map((s) => s.scopeId)],
  );
  const verdict = assessManifestCurrentness(
    { ...manifest, nextInvalidationAt: undefined },
    {
      heads: new Map(heads.rows.map((r) => [`${r.kind}:${r.id}`, Number(r.revision)])),
      scopes: new Map(scopes.rows.map((r) => [`${r.scope_kind}:${r.scope_id}`, Number(r.generation)])),
    },
    manifest.evaluatedAt,
  );
  return verdict.current;
}

/** Persists a result as the new latest assessment of its subject+kind. */
export async function saveAssessment(pool: Pool, workspaceId: string, result: AssessmentResult, actorId: string): Promise<{ supersedes: string | null }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    const subject = result.subjects[0]!.subjectRef;
    const supersedes = await latestAssessmentId(client, workspaceId, subject, result.kind);
    await insertAssessment(client, workspaceId, result, supersedes, actorId);
    await client.query('COMMIT');
    return { supersedes };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Reads a stored assessment back into the contract shape (manifest reconstructed from input rows + detail). */
export async function loadAssessment(pool: Pool | PoolClient, workspaceId: string, assessmentId: string): Promise<AssessmentResult | undefined> {
  const header = await pool.query<{ id: string; kind: string; subject_kind: string; subject_id: string; evaluated_at: Date; overall_verdict: string; next_invalidation_at: Date | null; manifest_detail: { capture: unknown; coverageReads: unknown[]; missingCoverage: unknown[]; evaluatedAt: string } }>(
    'SELECT * FROM assessments WHERE workspace_id = $1 AND id = $2', [workspaceId, assessmentId]);
  const row = header.rows[0];
  if (!row) return undefined;
  // Sequential queries: this may run on an ambient UnitOfWork PoolClient, which
  // cannot safely multiplex concurrent queries on one connection.
  const subjects = await pool.query<{ subject_kind: string; subject_id: string; role: string }>(
    'SELECT subject_kind, subject_id, role FROM assessment_subjects WHERE workspace_id = $1 AND assessment_id = $2 ORDER BY role, subject_kind, subject_id',
    [workspaceId, assessmentId],
  );
  const results = await pool.query<{ dimension: string; verdict: string; applicable: boolean; blocking: boolean; explanations: unknown[] }>(
    'SELECT dimension, verdict, applicable, blocking, explanations FROM assessment_results WHERE workspace_id = $1 AND assessment_id = $2 ORDER BY dimension',
    [workspaceId, assessmentId],
  );
  const inputs = await pool.query<{ input_kind: string; input_key: string; revision: string | null; generation: string | null; version: string | null }>(
    'SELECT input_kind, input_key, revision, generation, version FROM assessment_inputs WHERE workspace_id = $1 AND assessment_id = $2 ORDER BY input_kind, input_key',
    [workspaceId, assessmentId],
  );
  const split = (key: string) => {
    const at = key.indexOf(':');
    return [key.slice(0, at), key.slice(at + 1)] as const;
  };
  const nextInvalidationAt = row.next_invalidation_at ? row.next_invalidation_at.toISOString() : undefined;
  const manifest: WorldSnapshotManifest = {
    evaluatedAt: row.manifest_detail.evaluatedAt,
    ...(row.manifest_detail.capture ? { capture: row.manifest_detail.capture as WorldSnapshotManifest['capture'] } : {}),
    evaluatorVersions: inputs.rows.filter((i) => i.input_kind === 'EVALUATOR').map((i) => ({ evaluatorId: i.input_key, version: String(i.version) })),
    aggregateReads: inputs.rows.filter((i) => i.input_kind === 'AGGREGATE').map((i) => {
      const [kind, id] = split(i.input_key);
      return { aggregateRef: { kind: kind as SubjectKind, id }, revision: Number(i.revision) };
    }),
    scopeReads: inputs.rows.filter((i) => i.input_kind === 'SCOPE').map((i) => {
      const [scopeKind, scopeId] = split(i.input_key);
      return { scopeKind: scopeKind as WorldSnapshotManifest['scopeReads'][number]['scopeKind'], scopeId, generation: Number(i.generation) };
    }),
    evidenceReads: inputs.rows.filter((i) => i.input_kind === 'EVIDENCE').map((i) => i.input_key),
    coverageReads: row.manifest_detail.coverageReads as WorldSnapshotManifest['coverageReads'],
    missingCoverage: row.manifest_detail.missingCoverage as WorldSnapshotManifest['missingCoverage'],
    ...(nextInvalidationAt ? { nextInvalidationAt } : {}),
  };
  return AssessmentResultSchema.parse({
    id: row.id,
    kind: row.kind,
    evaluatedAt: row.evaluated_at.toISOString(),
    manifest,
    subjects: subjects.rows.map((s) => ({ subjectRef: { kind: s.subject_kind, id: s.subject_id }, role: s.role })),
    overallVerdict: row.overall_verdict,
    dimensions: results.rows.map((r) => ({
      dimension: r.dimension, verdict: r.verdict, applicable: r.applicable, blocking: r.blocking, explanations: r.explanations,
      reasons: [...new Set((r.explanations as { status: string; reasonCode: string }[]).map((e) => `${e.status}:${e.reasonCode}`))].sort(),
    })),
    ...(nextInvalidationAt ? { expiresAt: nextInvalidationAt } : {}),
  });
}

export type { AssessmentViewStatus };

export interface AssessmentView {
  status: AssessmentViewStatus;
  assessment?: AssessmentResult;
  staleness: StalenessReason[];
  openWork?: { id: string; reason: string; state: string; attempts: number; lastError: string | null };
}

/** Currentness from the database and the injected clock — never from a cached label. */
export async function currentAssessmentView(
  pool: Pool | PoolClient,
  workspaceId: string,
  subject: TypedRef,
  kind: AssessmentKind,
  now: Instant,
): Promise<AssessmentView> {
  const latestId = await latestAssessmentId(pool, workspaceId, subject, kind);
  const work = await pool.query<{ id: string; reason: string; state: string; attempts: number; last_error: string | null; cause_assessment_id: string | null }>(
    `SELECT id, reason, state, attempts, last_error, cause_assessment_id FROM scheduled_reassessments
      WHERE workspace_id = $1 AND subject_kind = $2 AND subject_id = $3 AND assessment_kind = $4 AND state <> 'DONE'
      ORDER BY created_at DESC LIMIT 1`,
    [workspaceId, subject.kind, subject.id, kind],
  );
  const candidate = work.rows[0];
  if (!latestId) {
    const openWork = candidate ? { id: candidate.id, reason: candidate.reason, state: candidate.state, attempts: candidate.attempts, lastError: candidate.last_error } : undefined;
    return { status: candidate?.state === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'NONE', staleness: [], ...(openWork ? { openWork } : {}) };
  }
  const assessment = await loadAssessment(pool, workspaceId, latestId);
  if (!assessment) return { status: 'NONE', staleness: [] };
  const state = await new PgCurrentStateReader(pool).loadFor(workspaceId, assessment.manifest);
  const verdict = assessManifestCurrentness(assessment.manifest, state, now);
  // Work raised against an assessment that has since been superseded is obsolete once the latest
  // manifest verifies current against live heads/generations and the clock: every input change that
  // raised it is already inside the newer capture. Otherwise the work still stands.
  const obsolete = candidate !== undefined && candidate.cause_assessment_id !== null && candidate.cause_assessment_id !== latestId && verdict.current;
  const open = obsolete ? undefined : candidate;
  const openWork = open ? { id: open.id, reason: open.reason, state: open.state, attempts: open.attempts, lastError: open.last_error } : undefined;
  if (open?.state === 'UNAVAILABLE') return { status: 'UNAVAILABLE', assessment, staleness: verdict.reasons, ...(openWork ? { openWork } : {}) };
  if (verdict.current && !open) return { status: 'CURRENT', assessment, staleness: [] };
  return { status: open ? 'PENDING_REASSESSMENT' : 'STALE', assessment, staleness: verdict.reasons, ...(openWork ? { openWork } : {}) };
}

/** Enqueues CLOCK_EXPIRY work for every latest assessment due at `now` (catches up after downtime). */
export async function enqueueDueReassessments(pool: Pool, now: Instant): Promise<number> {
  const result = await pool.query(
    `INSERT INTO scheduled_reassessments (workspace_id, subject_kind, subject_id, assessment_kind, reason, cause_assessment_id, invalidate_at, next_run_at)
     SELECT a.workspace_id, a.subject_kind, a.subject_id, a.kind, 'CLOCK_EXPIRY', a.id, a.next_invalidation_at, $1::timestamptz
       FROM assessments a
      WHERE a.next_invalidation_at IS NOT NULL AND a.next_invalidation_at <= $1::timestamptz
        AND NOT EXISTS (SELECT 1 FROM assessments s WHERE s.workspace_id = a.workspace_id AND s.supersedes_assessment_id = a.id)
     ON CONFLICT (workspace_id, subject_kind, subject_id, assessment_kind) WHERE state IN ('PENDING', 'CLAIMED') DO NOTHING`,
    [now],
  );
  return result.rowCount ?? 0;
}

export interface ReassessmentClaim {
  id: string;
  workspaceId: string;
  subject: TypedRef;
  kind: AssessmentKind;
  reason: string;
  attempts: number;
  claimToken: string;
  fencingToken: number;
}

/** Produces a fresh AssessmentResult for a claimed subject (capture -> project -> evaluate). */
export type ReassessmentPipeline = (claim: ReassessmentClaim, assessmentId: string) => Promise<AssessmentResult>;

export interface WorkerOutcome {
  claimed: boolean;
  result?: 'COMPLETED' | 'RETRY_SCHEDULED' | 'UNAVAILABLE' | 'FENCED' | 'REQUEUED';
  assessmentId?: string;
  error?: string;
}

const COMPLETE_RETRYABLE_CODES = new Set(['40001', '40P01', '23505']);

function isCompleteRetryableError(error: unknown): boolean {
  const code = (error as { code?: string } | undefined)?.code;
  return code !== undefined && COMPLETE_RETRYABLE_CODES.has(code);
}

export class PgReassessmentWorker {
  private readonly pool: Pool;
  private readonly actorId: string;
  private readonly maxAttempts: number;
  private readonly leaseSeconds: number;
  private readonly maxCompleteRetries: number;

  constructor(pool: Pool, options: { actorId: string; maxAttempts?: number; leaseSeconds?: number; maxCompleteRetries?: number }) {
    this.pool = pool;
    this.actorId = options.actorId;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.leaseSeconds = options.leaseSeconds ?? 60;
    this.maxCompleteRetries = options.maxCompleteRetries ?? 3;
  }

  async claim(now: Instant, workspaceId?: string): Promise<ReassessmentClaim | undefined> {
    const claimToken = randomUUID();
    const result = await this.pool.query<{ id: string; workspace_id: string; subject_kind: string; subject_id: string; assessment_kind: string; reason: string; attempts: number; fencing_token: string }>(
      `UPDATE scheduled_reassessments
          SET state = 'CLAIMED', claim_token = $1, fencing_token = fencing_token + 1, attempts = attempts + 1,
              lease_expires_at = $2::timestamptz + ($3 * interval '1 second'), updated_at = now()
        WHERE id = (
          SELECT id FROM scheduled_reassessments
           WHERE ((state = 'PENDING' AND next_run_at <= $2::timestamptz) OR (state = 'CLAIMED' AND lease_expires_at < $2::timestamptz))
             AND ($4::uuid IS NULL OR workspace_id = $4::uuid)
           ORDER BY next_run_at, id
           FOR UPDATE SKIP LOCKED
           LIMIT 1)
        RETURNING id, workspace_id, subject_kind, subject_id, assessment_kind, reason, attempts, fencing_token`,
      [claimToken, now, this.leaseSeconds, workspaceId ?? null],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      id: row.id, workspaceId: row.workspace_id, subject: { kind: row.subject_kind as SubjectKind, id: row.subject_id },
      kind: row.assessment_kind as AssessmentKind, reason: row.reason, attempts: row.attempts, claimToken, fencingToken: Number(row.fencing_token),
    };
  }

  /**
   * Stores the result and completes the claim atomically; refuses if the claim
   * was fenced by a newer worker. Serialization failures and single-successor
   * unique conflicts retry in-process (bounded), then durable-requeue to
   * PENDING so recovery does not wait on lease expiry. Fencing tokens are
   * preserved: requeue clears the claim token without bumping fencing.
   */
  async complete(claim: ReassessmentClaim, result: AssessmentResult): Promise<'COMPLETED' | 'FENCED' | 'REQUEUED'> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxCompleteRetries; attempt++) {
      try {
        return await this.completeOnce(claim, result);
      } catch (error) {
        lastError = error;
        if (!isCompleteRetryableError(error) || attempt >= this.maxCompleteRetries) break;
      }
    }
    if (lastError !== undefined && isCompleteRetryableError(lastError)) {
      const requeued = await this.requeueAfterCompleteFailure(claim, lastError);
      return requeued ? 'REQUEUED' : 'FENCED';
    }
    throw lastError;
  }

  private async completeOnce(claim: ReassessmentClaim, result: AssessmentResult): Promise<'COMPLETED' | 'FENCED'> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const held = await client.query<{ id: string }>(
        "SELECT id FROM scheduled_reassessments WHERE id = $1 AND state = 'CLAIMED' AND claim_token = $2 AND fencing_token = $3 FOR UPDATE",
        [claim.id, claim.claimToken, claim.fencingToken],
      );
      if (!held.rows[0]) {
        await client.query('ROLLBACK');
        return 'FENCED';
      }
      const supersedes = await latestAssessmentId(client, claim.workspaceId, claim.subject, claim.kind);
      await insertAssessment(client, claim.workspaceId, result, supersedes, this.actorId);
      await client.query(
        "UPDATE scheduled_reassessments SET state = 'DONE', result_assessment_id = $2, lease_expires_at = NULL, last_error = NULL, updated_at = now() WHERE id = $1",
        [claim.id, result.id],
      );
      // An input may have changed after the pipeline captured its world: that change's
      // trigger coalesced into this (then still open) claim. Re-check inside this
      // transaction and leave durable work behind rather than a silently stale latest.
      if (!(await manifestStillCurrent(client, claim.workspaceId, result.manifest))) {
        await client.query(
          `INSERT INTO scheduled_reassessments (workspace_id, subject_kind, subject_id, assessment_kind, reason, cause_assessment_id, cause_input_key)
           VALUES ($1, $2, $3, $4, 'INPUT_CHANGED', $5, 'changed-during-reassessment')
           ON CONFLICT (workspace_id, subject_kind, subject_id, assessment_kind) WHERE state IN ('PENDING', 'CLAIMED') DO NOTHING`,
          [claim.workspaceId, claim.subject.kind, claim.subject.id, claim.kind, result.id],
        );
      }
      await client.query('COMMIT');
      return 'COMPLETED';
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Durable recovery when complete() cannot commit: return the row to PENDING
   * under the same fencing token so another (or the same) worker can reclaim
   * without waiting for lease expiry, and without duplicating a successful
   * assessment (the failed transaction rolled back).
   */
  private async requeueAfterCompleteFailure(claim: ReassessmentClaim, error: unknown): Promise<boolean> {
    const message = error instanceof Error ? error.message : String(error);
    const code = (error as { code?: string } | undefined)?.code ?? 'unknown';
    const result = await this.pool.query(
      `UPDATE scheduled_reassessments
          SET state = 'PENDING', claim_token = NULL, lease_expires_at = NULL,
              last_error = $4, next_run_at = now(), updated_at = now()
        WHERE id = $1 AND state = 'CLAIMED' AND claim_token = $2 AND fencing_token = $3`,
      [claim.id, claim.claimToken, claim.fencingToken, `complete_requeue:${code}:${message}`.slice(0, 2000)],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async fail(claim: ReassessmentClaim, error: unknown, now: Instant): Promise<'RETRY_SCHEDULED' | 'UNAVAILABLE' | 'FENCED'> {
    const message = error instanceof Error ? error.message : String(error);
    const exhausted = claim.attempts >= this.maxAttempts;
    const backoffSeconds = 2 ** claim.attempts * 30;
    const result = await this.pool.query(
      `UPDATE scheduled_reassessments
          SET state = $4, last_error = $5, lease_expires_at = NULL, claim_token = NULL,
              next_run_at = $6::timestamptz + ($7 * interval '1 second'), updated_at = now()
        WHERE id = $1 AND state = 'CLAIMED' AND claim_token = $2 AND fencing_token = $3`,
      [claim.id, claim.claimToken, claim.fencingToken, exhausted ? 'UNAVAILABLE' : 'PENDING', message.slice(0, 2000), now, backoffSeconds],
    );
    if ((result.rowCount ?? 0) === 0) return 'FENCED';
    return exhausted ? 'UNAVAILABLE' : 'RETRY_SCHEDULED';
  }

  /** Claims and processes at most one unit of work. */
  async runOnce(now: Instant, pipeline: ReassessmentPipeline, workspaceId?: string): Promise<WorkerOutcome> {
    const claim = await this.claim(now, workspaceId);
    if (!claim) return { claimed: false };
    const assessmentId = randomUUID();
    let result: AssessmentResult;
    try {
      result = await pipeline(claim, assessmentId);
    } catch (error) {
      const outcome = await this.fail(claim, error, now);
      return { claimed: true, result: outcome, error: error instanceof Error ? error.message : String(error) };
    }
    const done = await this.complete(claim, result);
    return { claimed: true, result: done, ...(done === 'COMPLETED' ? { assessmentId } : {}) };
  }
}

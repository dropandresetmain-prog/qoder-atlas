/**
 * Baseline evaluation over a freshly materialized world.
 *
 * This runs the real M6 machinery — `captureWorld` -> `projectEffectiveWorld`
 * -> `assessSubject` -> `saveAssessment`, through `evaluateImpact`, the same
 * path the reassessment worker uses. No verdict is seeded, no dimension is
 * defaulted to PASS, and no subject is skipped for looking inconvenient: a
 * Journey with incomplete travel evidence is assessed and comes back UNKNOWN,
 * which is the truthful answer.
 *
 * R0 — one capture per Journey. Each assessment's manifest is therefore
 * bound to exactly its own subject's closure, which is what the reassessment
 * worker produces later (`composeTargetBoot`'s pipeline captures with
 * `focus: [claim.subject]`). Before R0 the baseline captured 20-Journey
 * slices and stamped every Journey in a slice with the slice-wide manifest,
 * so one changed reservation invalidated every slice-mate: a precision defect
 * in invalidation, not a semantics change (closure §6 asks for the narrowest
 * provable scope). Captures run with bounded concurrency; persistence stays
 * serial because `saveAssessment` runs SERIALIZABLE and concurrent writers on
 * the same tables would only fence each other out.
 *
 * It is restart-safe by asking a question about state rather than about this
 * process: only Journeys that hold no assessment at all are evaluated. A
 * restart against the same database therefore evaluates nothing, and a run
 * interrupted half-way finishes the remainder on the next boot.
 */
import type { Pool } from '../../persistence/postgres/pool.ts';
import type { TypedRef } from '../../domain/v2/shared/identity.ts';
import type { AssessmentResult } from '../../contracts/v2/assessment/assessmentManifest.ts';
import { evaluateImpact } from '../../persistence/postgres/world/pgEvaluation.ts';
import { saveAssessment } from '../../persistence/postgres/world/pgAssessments.ts';
import { createM6Registry } from '../../resolution/evaluation/registry.ts';

/** Concurrent captures in flight (each is one REPEATABLE READ read session). */
const CAPTURE_CONCURRENCY = 4;

export interface BaselineEvaluationReport {
  evaluated: number;
  verdicts: Record<string, number>;
}

/** Journeys with no assessment of any kind yet, in a deterministic order. */
async function unassessedJourneys(pool: Pool, workspaceId: string): Promise<string[]> {
  const result = await pool.query<{ id: string }>(
    `SELECT j.id
       FROM journeys j
      WHERE j.workspace_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM assessment_subjects s
           WHERE s.workspace_id = j.workspace_id
             AND s.subject_kind = 'JOURNEY' AND s.subject_id = j.id
        )
      ORDER BY j.id`,
    [workspaceId],
  );
  return result.rows.map((row) => row.id);
}

export async function runBaselineEvaluation(params: {
  pool: Pool;
  workspaceId: string;
  actorPrincipalId: string;
  now?: string;
  concurrency?: number;
}): Promise<BaselineEvaluationReport> {
  const { pool, workspaceId, actorPrincipalId } = params;
  const now = params.now ?? new Date().toISOString();
  const registry = createM6Registry();
  const pending = await unassessedJourneys(pool, workspaceId);
  const concurrency = Math.max(1, params.concurrency ?? CAPTURE_CONCURRENCY);
  const verdicts: Record<string, number> = {};
  let evaluated = 0;

  // Capture + evaluate concurrently (read-only sessions), persist serially in
  // deterministic Journey order.
  const results = new Map<string, AssessmentResult>();
  let next = 0;
  const runner = async (): Promise<void> => {
    for (;;) {
      const journeyId = pending[next++];
      if (journeyId === undefined) return;
      const focus: TypedRef[] = [{ kind: 'JOURNEY', id: journeyId }];
      const run = await evaluateImpact(pool, { workspaceId, focus, now, registry, assessFocusOnly: true });
      const own = run.assessments.find((a) => a.subjects.some((s) => s.subjectRef.kind === 'JOURNEY' && s.subjectRef.id === journeyId));
      // A capture that assessed nothing for its own focus is a real fault; the
      // Journey exists, so silence here would hide a broken evaluator path.
      if (!own) throw new Error(`baseline evaluation produced no assessment for journey ${journeyId}`);
      results.set(journeyId, own);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, () => runner()));

  for (const journeyId of pending) {
    const assessment = results.get(journeyId);
    if (!assessment) throw new Error(`baseline evaluation lost the assessment for journey ${journeyId}`);
    await saveAssessment(pool, workspaceId, assessment, actorPrincipalId);
    evaluated += 1;
    verdicts[assessment.overallVerdict] = (verdicts[assessment.overallVerdict] ?? 0) + 1;
  }

  return { evaluated, verdicts };
}

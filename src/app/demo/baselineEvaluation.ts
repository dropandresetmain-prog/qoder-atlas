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
 * It is restart-safe by asking a question about state rather than about this
 * process: only Journeys that hold no assessment at all are evaluated. A
 * restart against the same database therefore evaluates nothing, and a run
 * interrupted half-way finishes the remainder on the next boot.
 */
import type { Pool } from '../../persistence/postgres/pool.ts';
import type { TypedRef } from '../../domain/v2/shared/identity.ts';
import { evaluateImpact } from '../../persistence/postgres/world/pgEvaluation.ts';
import { createM6Registry } from '../../resolution/evaluation/registry.ts';

/** Capture slice size. One slice assesses every Journey it reaches. */
const BATCH = 20;

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
}): Promise<BaselineEvaluationReport> {
  const { pool, workspaceId, actorPrincipalId } = params;
  const now = params.now ?? new Date().toISOString();
  const registry = createM6Registry();
  const pending = await unassessedJourneys(pool, workspaceId);
  const verdicts: Record<string, number> = {};
  let evaluated = 0;

  // One capture slice assesses every Journey it reaches, not only the focus,
  // so a subject an earlier slice already covered is not assessed again —
  // that would persist a second assessment of the same world.
  const done = new Set<string>();
  for (const journeyId of pending) {
    if (done.has(journeyId)) continue;
    const focus: TypedRef[] = [];
    for (const candidate of pending) {
      if (focus.length >= BATCH) break;
      if (!done.has(candidate)) focus.push({ kind: 'JOURNEY', id: candidate });
    }
    const run = await evaluateImpact(pool, {
      workspaceId,
      focus,
      now,
      registry,
      persist: { actorId: actorPrincipalId },
    });
    for (const assessment of run.assessments) {
      for (const { subjectRef } of assessment.subjects) {
        if (subjectRef.kind === 'JOURNEY') done.add(subjectRef.id);
      }
      evaluated += 1;
      verdicts[assessment.overallVerdict] = (verdicts[assessment.overallVerdict] ?? 0) + 1;
    }
    // A slice that assessed nothing for its own focus is a real fault; without
    // this the loop would retry the same subject forever.
    if (!done.has(journeyId)) {
      throw new Error(`baseline evaluation produced no assessment for journey ${journeyId}`);
    }
  }

  return { evaluated, verdicts };
}

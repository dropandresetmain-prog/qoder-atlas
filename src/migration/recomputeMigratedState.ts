/**
 * M10 Phase 6 — recompute derived state after an import.
 *
 * Legacy health/viability/risk is never migrated as current truth. The legacy
 * verdicts that existed are archived as evidence by the importer
 * (`LEGACY_CONSTRAINT_STATUS`); current truth is produced here, by running
 * the *same* evaluation path the product runs — `evaluateImpact` over
 * `createM6Registry`, which is what `m9SarahTargetE2E.pgtest.ts` and
 * `composeTargetBoot` use. There is no migration-specific evaluator.
 */
import type { Pool } from '../persistence/postgres/pool.ts';
import { evaluateImpact } from '../persistence/postgres/world/pgEvaluation.ts';
import { createM6Registry } from '../resolution/evaluation/registry.ts';
import type { TypedRef } from '../domain/v2/shared/identity.ts';
import { appendValidation } from './migrationRunStore.ts';

export interface RecomputeRequest {
  workspaceId: string;
  actorPrincipalId: string;
  /** The run whose validations record this recompute. */
  runId: string;
  now: string;
}

export interface RecomputeResult {
  /** Journeys that received a freshly computed assessment. */
  journeySubjects: TypedRef[];
  assessments: { assessmentId: string; subject: TypedRef; overallVerdict: string }[];
}

/**
 * Every Journey the migration produced, read back from `legacy_id_map` so the
 * recompute scope is exactly what was migrated — not the whole workspace.
 */
export async function migratedJourneySubjects(
  pool: Pool,
  params: { workspaceId: string; sourceDataset: string },
): Promise<TypedRef[]> {
  const result = await pool.query<{ target_id: string }>(
    `SELECT target_id FROM legacy_id_map
     WHERE workspace_id = $1 AND source_dataset = $2 AND target_kind = 'JOURNEY'
     ORDER BY source_id`,
    [params.workspaceId, params.sourceDataset],
  );
  return result.rows.map((row) => ({ kind: 'JOURNEY' as const, id: row.target_id }));
}

/**
 * Recompute and persist CURRENT assessments for the migrated journeys.
 *
 * `evaluateImpact` assesses every Journey in the captured world for the given
 * focus, so passing the migrated journeys as focus produces real assessments
 * bound to real revisions/generations/evidence — the only kind the target
 * recognises as current.
 */
export async function recomputeMigratedState(
  pool: Pool,
  params: RecomputeRequest & { sourceDataset: string },
): Promise<RecomputeResult> {
  const journeySubjects = await migratedJourneySubjects(pool, {
    workspaceId: params.workspaceId,
    sourceDataset: params.sourceDataset,
  });

  if (journeySubjects.length === 0) {
    await appendValidation(pool, params.runId, {
      check: 'DERIVED_STATE_RECOMPUTED',
      passed: true,
      detail: 'no Journey migrated from this dataset, so there is no derived state to recompute',
    });
    return { journeySubjects, assessments: [] };
  }

  const run = await evaluateImpact(pool, {
    workspaceId: params.workspaceId,
    focus: journeySubjects,
    now: params.now,
    registry: createM6Registry(),
    persist: { actorId: params.actorPrincipalId },
  });

  const assessments = run.assessments.flatMap((assessment) => {
    const subject = assessment.subjects[0]?.subjectRef;
    return subject === undefined
      ? []
      : [{ assessmentId: assessment.id, subject, overallVerdict: assessment.overallVerdict }];
  });

  await appendValidation(pool, params.runId, {
    check: 'DERIVED_STATE_RECOMPUTED',
    passed: assessments.length > 0,
    detail:
      `recomputed ${assessments.length} assessment(s) for ${journeySubjects.length} migrated Journey(s) ` +
      'through the real M6 evaluator registry; no legacy verdict was imported as current',
  });

  return { journeySubjects, assessments };
}

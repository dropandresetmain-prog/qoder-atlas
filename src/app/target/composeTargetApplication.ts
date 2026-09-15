/**
 * M9 — target PostgreSQL application composition.
 *
 * ONE coherent runtime over accepted M2–M8 owners. No SQLite fallback for
 * authority, recovery truth, planning, execution, product read models, or
 * canonical domain writes.
 *
 * Legacy SQLite remains separately runnable via `src/app/compose.ts` for
 * M10 migration/reference — it is not imported here.
 */
import {
  composeTargetRuntime,
  type TargetRuntime,
} from '../../persistence/postgres/composeTargetRuntime.ts';
import type { PostgresTargetConfig } from '../../persistence/postgres/config.ts';
import type { PgUnitOfWork } from '../../persistence/postgres/pgUnitOfWork.ts';
import type { Pool } from '../../persistence/postgres/pool.ts';
import {
  PgReassessmentWorker,
  type ReassessmentPipeline,
} from '../../persistence/postgres/world/pgAssessments.ts';
import { M9_REPLAN_IDENTITY } from './replanIdentity.ts';
import { M9_OBJECTIVE_DISPOSITION_API_EXPOSED } from './objectiveDispositionBoundary.ts';

export interface TargetApplicationOptions {
  workspaceId: string;
  actorId?: string;
  postgres?: Partial<PostgresTargetConfig>;
  env?: NodeJS.ProcessEnv;
  /**
   * Optional reassessment pipeline. When provided with startReassessmentWorker,
   * the worker polls via runOnce.
   */
  reassessmentPipeline?: ReassessmentPipeline;
  startReassessmentWorker?: boolean;
  reassessmentPollMs?: number;
}

export interface TargetApplication {
  kind: 'TARGET_POSTGRES';
  workspaceId: string;
  pool: Pool;
  runtime: TargetRuntime;
  unitOfWork(): PgUnitOfWork;
  reassessmentWorker: PgReassessmentWorker;
  replanIdentity: typeof M9_REPLAN_IDENTITY;
  objectiveDispositionApiExposed: typeof M9_OBJECTIVE_DISPOSITION_API_EXPOSED;
  /** True when this process must not use SQLite for authoritative product paths. */
  sqliteAuthoritativeFallback: false;
  close(): Promise<void>;
}

/**
 * Compose the target application. Callers that need HTTP should attach
 * application command handlers separately — composition stays harness-agnostic.
 */
export async function composeTargetApplication(
  options: TargetApplicationOptions,
): Promise<TargetApplication> {
  const runtime = await composeTargetRuntime(options.postgres ?? {}, options.env ?? process.env);
  const actorId = options.actorId ?? `m9-app:${options.workspaceId}`;
  const reassessmentWorker = new PgReassessmentWorker(runtime.pool, { actorId });

  let pollTimer: ReturnType<typeof setInterval> | undefined;
  if (options.startReassessmentWorker && options.reassessmentPipeline) {
    const pipeline = options.reassessmentPipeline;
    const ms = options.reassessmentPollMs ?? 2_000;
    pollTimer = setInterval(() => {
      void reassessmentWorker.runOnce(new Date().toISOString(), pipeline, options.workspaceId).catch(() => undefined);
    }, ms);
    pollTimer.unref?.();
  }

  return {
    kind: 'TARGET_POSTGRES',
    workspaceId: options.workspaceId,
    pool: runtime.pool,
    runtime,
    unitOfWork: () => runtime.unitOfWorkFor(options.workspaceId),
    reassessmentWorker,
    replanIdentity: M9_REPLAN_IDENTITY,
    objectiveDispositionApiExposed: M9_OBJECTIVE_DISPOSITION_API_EXPOSED,
    sqliteAuthoritativeFallback: false,
    async close() {
      if (pollTimer) clearInterval(pollTimer);
      await runtime.close();
    },
  };
}

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
import { PgReassessmentWorker } from '../../persistence/postgres/world/pgAssessments.ts';
import type { RuntimeServices } from '../runtimeServices.ts';
import { M9_REPLAN_IDENTITY } from './replanIdentity.ts';
import { M9_OBJECTIVE_DISPOSITION_API_EXPOSED } from './objectiveDispositionBoundary.ts';

export interface TargetApplicationOptions {
  workspaceId: string;
  actorId?: string;
  postgres?: Partial<PostgresTargetConfig>;
  env?: NodeJS.ProcessEnv;
}

export interface TargetApplication {
  kind: 'TARGET_POSTGRES';
  workspaceId: string;
  pool: Pool;
  runtime: TargetRuntime;
  unitOfWork(): PgUnitOfWork;
  reassessmentWorker: PgReassessmentWorker;
  /**
   * Background workers (R0): composed and started by the boot root
   * (`composeTargetBoot` -> `src/app/runtimeServices.ts`), never here —
   * composition stays harness-agnostic and there is exactly one place a
   * worker loop can be started. Absent in test compositions that drive the
   * worker directly. `/api/v2/health` reports whatever is attached.
   */
  runtimeServices?: RuntimeServices;
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
      await runtime.close();
    },
  };
}

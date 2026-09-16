/**
 * M10 — the sole normal-operation composition root.
 *
 * PostgreSQL-only: composes `composeTargetEndpoints` (which composes
 * `composeTargetApplication`, verified to import nothing SQLite) plus a real
 * reassessment pipeline built from the actual M6 evaluator (`captureWorld` +
 * `createM6Registry` + `assessSubject` — the same pipeline
 * `m9SarahTargetE2E.pgtest.ts` proves end-to-end against real PostgreSQL, not
 * test-only scaffolding).
 *
 * `src/main.ts` calls this and only this for normal boot. The legacy SQLite
 * composition (`src/app/compose.ts`) is not imported here or transitively
 * from anything this module imports.
 */
import { loadConfig, type AppConfig } from '../config/config.ts';
import { composeTargetEndpoints, type TargetEndpoints } from './target/composeTargetEndpoints.ts';
import { captureWorld } from '../persistence/postgres/world/pgCurrentState.ts';
import { createM6Registry } from '../resolution/evaluation/registry.ts';
import { assessSubject } from '../resolution/evaluation/assess.ts';
import { projectEffectiveWorld } from '../resolution/world/effectiveItinerary.ts';
import type { ReassessmentPipeline } from '../persistence/postgres/world/pgAssessments.ts';
import type { Pool } from '../persistence/postgres/pool.ts';

export interface TargetBootConfig {
  environment: AppConfig['environment'];
  httpPort: number;
  workspaceId: string;
}

/** Resolve boot configuration strictly from env — never touches SQLite config/paths. */
export function loadTargetBootConfig(env: NodeJS.ProcessEnv = process.env): TargetBootConfig {
  const config = loadConfig(env);
  const workspaceId = (env.PG_TARGET_WORKSPACE_ID ?? '').trim();
  if (!workspaceId) {
    throw new Error(
      'PG_TARGET_WORKSPACE_ID is required: normal NORTHSTAR operation is PostgreSQL-target-only ' +
        'from M10 onward and has no default/implicit workspace.',
    );
  }
  return { environment: config.environment, httpPort: config.httpPort, workspaceId };
}

const registry = createM6Registry();

/** Real M6-evaluator-backed reassessment pipeline — no fixture/demo branching. */
function buildReassessmentPipeline(pool: Pool): ReassessmentPipeline {
  return async (claim, assessmentId) => {
    const now = new Date().toISOString();
    const world = await captureWorld(pool, {
      workspaceId: claim.workspaceId,
      focus: [claim.subject],
      at: now,
      informationTopics: registry.informationTopics,
    });
    return assessSubject({
      registry,
      world,
      effective: projectEffectiveWorld(world),
      subject: claim.subject,
      now,
      assessmentId,
    }).result;
  };
}

export interface ComposedTargetBoot {
  config: TargetBootConfig;
  endpoints: TargetEndpoints;
  close(): Promise<void>;
}

const REASSESSMENT_POLL_MS = 2_000;

export async function composeTargetBoot(env: NodeJS.ProcessEnv = process.env): Promise<ComposedTargetBoot> {
  const config = loadTargetBootConfig(env);
  // `composeTargetApplication`'s own startReassessmentWorker option needs the
  // pipeline at composition time, but the pipeline needs the pool that
  // composition itself produces — compose without it, then poll the already-
  // constructed `reassessmentWorker` directly (same call
  // `composeTargetApplication` would have made internally).
  const endpoints = await composeTargetEndpoints({ workspaceId: config.workspaceId, env });
  // Idempotent boot-time provisioning (same category as composeTargetRuntime
  // already running schema migrations at boot) — not a data/authority
  // decision. A workspace row must exist before any command referencing it
  // can commit; this never touches an already-provisioned workspace's data.
  await endpoints.app.pool.query(
    `INSERT INTO workspaces (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
    [config.workspaceId, `northstar:${config.workspaceId}`],
  );
  const pipeline = buildReassessmentPipeline(endpoints.app.pool);
  const pollTimer = setInterval(() => {
    void endpoints.app.reassessmentWorker
      .runOnce(new Date().toISOString(), pipeline, config.workspaceId)
      .catch(() => undefined);
  }, REASSESSMENT_POLL_MS);
  pollTimer.unref?.();
  return {
    config,
    endpoints,
    async close() {
      clearInterval(pollTimer);
      await endpoints.close();
    },
  };
}

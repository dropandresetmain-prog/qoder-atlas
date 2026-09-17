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
import { provisionConfiguredDataset } from './demo/provisionDataset.ts';
import { runBaselineEvaluation } from './demo/baselineEvaluation.ts';
import { captureWorld } from '../persistence/postgres/world/pgCurrentState.ts';
import { createM6Registry } from '../resolution/evaluation/registry.ts';
import { assessSubject } from '../resolution/evaluation/assess.ts';
import { projectEffectiveWorld } from '../resolution/world/effectiveItinerary.ts';
import type { ReassessmentPipeline } from '../persistence/postgres/world/pgAssessments.ts';
import type { Pool } from '../persistence/postgres/pool.ts';
import { composeRuntimeServices, createReassessmentService } from './runtimeServices.ts';

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

export async function composeTargetBoot(env: NodeJS.ProcessEnv = process.env): Promise<ComposedTargetBoot> {
  const config = loadTargetBootConfig(env);
  const endpoints = await composeTargetEndpoints({ workspaceId: config.workspaceId, env });
  // Idempotent boot-time provisioning (same category as composeTargetRuntime
  // already running schema migrations at boot) — not a data/authority
  // decision. A workspace row must exist before any command referencing it
  // can commit; this never touches an already-provisioned workspace's data.
  await endpoints.app.pool.query(
    `INSERT INTO workspaces (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
    [config.workspaceId, `northstar:${config.workspaceId}`],
  );

  // Idempotent dataset provisioning. Absent configuration this does nothing;
  // an already-provisioned dataset is reused; the same dataset identity with
  // different content fails the boot rather than layering a second world.
  // Nothing a browser can request reaches this path.
  const actorPrincipalId = `northstar-boot:${config.workspaceId}`;
  const provisioning = await provisionConfiguredDataset({
    pool: endpoints.app.pool,
    workspaceId: config.workspaceId,
    actorPrincipalId,
    env,
  });
  if (provisioning.status === 'MATERIALIZED') {
    console.log(
      `[atlas] provisioned dataset ${provisioning.datasetKey} ` +
        `content=${provisioning.contentHash.slice(0, 16)} ` +
        `counts=${JSON.stringify(provisioning.report.counts)}`,
    );
  } else if (provisioning.status === 'ALREADY_PROVISIONED') {
    console.log(
      `[atlas] dataset ${provisioning.datasetKey} already provisioned ` +
        `content=${provisioning.contentHash.slice(0, 16)} — reusing existing state`,
    );
  }

  // Baseline assessments come from the real evaluator, and only for subjects
  // that hold none. A restart against the same database evaluates nothing.
  const baseline = await runBaselineEvaluation({
    pool: endpoints.app.pool,
    workspaceId: config.workspaceId,
    actorPrincipalId,
  });
  if (baseline.evaluated > 0) {
    console.log(`[atlas] baseline evaluation assessed ${baseline.evaluated} journeys ${JSON.stringify(baseline.verdicts)}`);
  }

  // Background workers: one composition root, one lifecycle, one health
  // surface (src/app/runtimeServices.ts). The reassessment service enqueues
  // clock-expiry work and drains runnable work on every wake.
  const pipeline = buildReassessmentPipeline(endpoints.app.pool);
  const services = composeRuntimeServices([
    createReassessmentService({
      worker: endpoints.app.reassessmentWorker,
      pipeline,
      workspaceId: config.workspaceId,
      onWake(wake) {
        if (wake.error) {
          console.error(`[atlas] reassessment wake failed: ${wake.error}`);
        } else if (wake.drain && wake.drain.processed > 0) {
          console.log(
            `[atlas] reassessment drained ${wake.drain.processed} unit(s) in ${wake.drain.elapsedMs}ms ` +
              `(${wake.drain.stoppedReason}; due=${wake.dueEnqueued}; outcomes=${JSON.stringify(wake.drain.outcomes)})`,
          );
        }
      },
    }),
  ]);
  endpoints.app.runtimeServices = services;
  services.start();
  return {
    config,
    endpoints,
    async close() {
      services.stop();
      await endpoints.close();
    },
  };
}

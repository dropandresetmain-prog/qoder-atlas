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
import { loadConfig, mergeEnvWithDotenvFiles, type AppConfig } from '../config/config.ts';
import { composeTargetEndpoints, type TargetEndpoints } from './target/composeTargetEndpoints.ts';
import { provisionConfiguredDataset } from './demo/provisionDataset.ts';
import { runBaselineEvaluation } from './demo/baselineEvaluation.ts';
import { captureWorld } from '../persistence/postgres/world/pgCurrentState.ts';
import { createM6Registry } from '../resolution/evaluation/registry.ts';
import { assessSubject } from '../resolution/evaluation/assess.ts';
import { projectEffectiveWorld } from '../resolution/world/effectiveItinerary.ts';
import type { ReassessmentPipeline } from '../persistence/postgres/world/pgAssessments.ts';
import type { Pool } from '../persistence/postgres/pool.ts';
import { composeRuntimeServices, createPeriodicService, createReassessmentService } from './runtimeServices.ts';
import { runCaseEscalation } from './target/caseEscalation.ts';
import { runRecoveryProgressionPass } from './target/recoveryProgressionPass.ts';
import { createRecoveryPlanningCoordinator } from './target/recoveryPlanningCoordinator.ts';
import { buildTargetTimezoneResolver } from './targetTransportResearch.ts';
import { composeTransportFamilies } from './targetProviderFamilies.ts';
import { composeTargetIntelligence } from './composeTargetIntelligence.ts';
import { composeTargetRecoveryResearch } from './composeTargetRecoveryResearch.ts';
import { composeTargetFxResearch, createTargetRecoveryCostContext } from './targetFxResearch.ts';
import { runInternalExecutionPass } from './target/executionPass.ts';
import { composeOfferExecution, runExternalExecutionCycle, EXTERNAL_OFFER_SELECT_STATEMENTS } from './target/externalOfferExecution.ts';
import { provisionWorkspaceAuthority, workspacePrincipalId } from './target/workspaceAuthority.ts';

/** Idle cadence of the case lifecycle pass (escalation + resolution); a reassessment drain also triggers it immediately. */
const CASE_LIFECYCLE_POLL_MS = 5_000;
/** Idle cadence of the internal execution pass; an approval triggers it immediately. */
const EXECUTION_POLL_MS = 5_000;

export interface TargetBootConfig {
  environment: AppConfig['environment'];
  httpPort: number;
  workspaceId: string;
}

export interface ComposeTargetBootOptions {
  cwd?: string;
  /**
   * When true (default), merge `.env` / `.env.local` so daily `npm run dev`
   * can persist `PG_TARGET_*` and `NORTHSTAR_DEMO_DATASET_DIR`. PostgreSQL
   * tests that boot the composition should pass `false` so a developer file
   * cannot steal the test database or provision an unexpected dataset.
   */
  applyDotenvFiles?: boolean;
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

export async function composeTargetBoot(
  env: NodeJS.ProcessEnv = process.env,
  options: ComposeTargetBootOptions = {},
): Promise<ComposedTargetBoot> {
  const resolved: NodeJS.ProcessEnv =
    options.applyDotenvFiles === false
      ? env
      : mergeEnvWithDotenvFiles(env, options.cwd ?? process.cwd());
  const config = loadTargetBootConfig(resolved);
  const endpoints = await composeTargetEndpoints({ workspaceId: config.workspaceId, env: resolved });
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
    env: resolved,
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

  // B1: the workspace's operating principals and their enumerated authority
  // coverage (approver: authorize; runtime executor: dispatch). Idempotent;
  // never a decision or an approval. See workspaceAuthority.ts for the
  // coverage-at-provisioning limit it reports.
  const authority = await provisionWorkspaceAuthority({
    pool: endpoints.app.pool,
    uow: () => endpoints.app.unitOfWork(),
    workspaceId: config.workspaceId,
    actorPrincipalId,
    now: new Date().toISOString(),
    operatorAuthSubject: resolved.NORTHSTAR_OPERATOR_AUTH_SUBJECT?.trim() || undefined,
  });
  console.log(
    `[atlas] workspace authority ${authority.status} coverage=${authority.coverageCount} ` +
      `operator=${authority.principals.operator} executor=${authority.principals.executor}` +
      (authority.uncoveredSubjectCount > 0 ? ` UNCOVERED=${authority.uncoveredSubjectCount} (re-provision a fresh workspace to cover new subjects)` : ''),
  );
  const executorPrincipalId = workspacePrincipalId(config.workspaceId, 'executor');

  // Background workers: one composition root, one lifecycle, one health
  // surface (src/app/runtimeServices.ts). The reassessment service enqueues
  // clock-expiry work and drains runnable work on every wake.
  const pipeline = buildReassessmentPipeline(endpoints.app.pool);
  // T3/B1: case lifecycle = assessment -> RecoveryCase (escalation) and
  // reassessed truth -> RESOLVED (resolution gate). One reconcile-from-state
  // pass (idempotent, durable) on its own cadence, and run immediately after
  // any drain that produced assessments so lifecycle latency is not a second
  // idle poll.
  const lifecycleActor = `northstar-lifecycle:${config.workspaceId}`;
  // C4: the ONE post-reassessment progression owner (freeze C8). Composed once
  // here; it dispatches to existing owners only (resolution command, the C1
  // planning coordinator, case attention) and never executes or approves.
  //
  // R3: the coordinator is composed ONCE with provider-neutral read-only
  // transport research from the shared provider config (LIVE | RECORD | REPLAY
  // per ADAPTER_MODE; REPLAY needs no credentials, LIVE fails closed without
  // them). The search party is derived per corridor from authoritative state
  // (allocations, else the journey's own 1:1 traveller) — no passenger
  // constant anywhere in boot. The SAME instance is exposed to the product
  // HTTP planning trigger through `runtimeHooks` so the product path and C4
  // cannot diverge on planning truth.
  const adapterConfig = loadConfig(resolved);
  const families = composeTransportFamilies(
    adapterConfig,
    options.cwd ?? process.cwd(),
    buildTargetTimezoneResolver(endpoints.app.pool, config.workspaceId),
  );
  const transportResearch = families.transportPlanning;
  if (!transportResearch) {
    console.log('[atlas] transport research not composed (capability not honestly available) — TRANSPORT domain unavailable');
  } else {
    console.log(`[atlas] transport research composed (mode=${adapterConfig.adapterMode}, read-only)`);
  }
  // G08: Model Studio / Qwen is composed from credentials, independent of Atlas
  // ADAPTER_MODE — REPLAY Atlas must not silence a configured intelligence client.
  const intelligence = composeTargetIntelligence(adapterConfig);
  if (intelligence) {
    console.log(`[qwen] Model Studio composed (model=${intelligence.model}, mode=${intelligence.mode})`);
  } else {
    console.log('[qwen] Model Studio not composed (credentials absent) — AI domain suggestion unavailable');
  }
  const recoveryResearch = await composeTargetRecoveryResearch({
    config: adapterConfig,
    cwd: options.cwd ?? process.cwd(),
    configurationFile: resolved.NORTHSTAR_RECOVERY_RESEARCH_CONFIG,
    pool: endpoints.app.pool,
    workspaceId: config.workspaceId,
    actorPrincipalId: lifecycleActor,
    uow: () => endpoints.app.unitOfWork(),
    reviewerPrincipalId: authority.principals.operator,
  });
  console.log(recoveryResearch
    ? `[atlas] reviewed entry and hotel research composed (mode=${adapterConfig.adapterMode}, read-only)`
    : '[atlas] reviewed overnight research unavailable (explicit configuration and hotel credentials required)');
  const planner = createRecoveryPlanningCoordinator({
    pool: endpoints.app.pool,
    workspaceId: config.workspaceId,
    actorPrincipalId: lifecycleActor,
    uow: () => endpoints.app.unitOfWork(),
    // G01: advertise exactly the composed provider families (never a phantom set).
    availableCapabilities: [...families.availableCapabilities, ...(recoveryResearch ? ['HOTEL' as const, 'RESEARCH' as const] : [])],
    ...(recoveryResearch ? { preparePlanningContext: recoveryResearch.prepare } : {}),
    ...(recoveryResearch ? {
      costContextForCandidate: createTargetRecoveryCostContext(
        composeTargetFxResearch(adapterConfig, options.cwd ?? process.cwd(), endpoints.app.pool, config.workspaceId).resolver,
      ),
    } : {}),
    ...(transportResearch ? { transportPlanning: transportResearch } : {}),
    ...(intelligence ? { intelligence } : {}),
  });
  const lifecycle = createPeriodicService({
    name: 'caseLifecycle',
    pollMs: CASE_LIFECYCLE_POLL_MS,
    run: async (now) => {
      const escalation = await runCaseEscalation({ pool: endpoints.app.pool, workspaceId: config.workspaceId, actorPrincipalId: lifecycleActor, uow: () => endpoints.app.unitOfWork(), now });
      const resolution = await runRecoveryProgressionPass({ pool: endpoints.app.pool, workspaceId: config.workspaceId, actorPrincipalId: lifecycleActor, uow: () => endpoints.app.unitOfWork(), planner, now });
      return { escalation, resolution };
    },
    summarize: ({ escalation, resolution }) => ({
      escalation: { candidates: escalation.candidates, opened: escalation.opened, attached: escalation.attached, none: escalation.none, failed: escalation.failed },
      progression: { candidates: resolution.candidates, truncated: resolution.truncated, resolved: resolution.resolved, planned: resolution.planned, escalated: resolution.escalated, waiting: resolution.waiting, failed: resolution.failed },
    }),
    onRun({ escalation, resolution }) {
      if (escalation.opened > 0 || escalation.attached > 0 || escalation.failed > 0) {
        console.log(`[atlas] case escalation: opened=${escalation.opened} attached=${escalation.attached} failed=${escalation.failed} candidates=${escalation.candidates}`);
        for (const outcome of escalation.outcomes) {
          if (outcome.error) console.error(`[atlas] case escalation failed for ${outcome.subject.kind}:${outcome.subject.id}: ${outcome.error}`);
        }
      }
      if (resolution.resolved > 0 || resolution.planned > 0 || resolution.escalated > 0 || resolution.failed > 0) {
        console.log(`[atlas] case progression: resolved=${resolution.resolved} planned=${resolution.planned} escalated=${resolution.escalated} waiting=${resolution.waiting} failed=${resolution.failed}`);
        for (const outcome of resolution.outcomes) {
          if (outcome.dispatch !== 'NONE') console.log(`[atlas] case ${outcome.caseId}: ${outcome.decision}/${outcome.reasonCode} -> ${outcome.dispatch}${outcome.detail ? ` (${outcome.detail})` : ''}`);
        }
      }
    },
  });
  // B1: authorised internal intents -> durable execution -> observation ->
  // canonical update (M6 triggers then reassess). Runs on its own cadence and
  // immediately after an approval (targetHttpHandlers.ts calls runNow()).
  const execution = createPeriodicService({
    name: 'execution',
    pollMs: EXECUTION_POLL_MS,
    run: (now) =>
      runInternalExecutionPass({ pool: endpoints.app.pool, workspaceId: config.workspaceId, actorPrincipalId: `northstar-execution:${config.workspaceId}`, uow: () => endpoints.app.unitOfWork(), executorPrincipalId, now }),
    summarize: (report) => ({ candidates: report.candidates, executed: report.executed, deferred: report.deferred, failed: report.failed }),
    onRun(report) {
      for (const outcome of report.outcomes) {
        if (outcome.result === 'DEFERRED') continue;
        console.log(`[atlas] execution ${outcome.result} intent=${outcome.intentId} attempt=${outcome.attemptNumber}${outcome.detail ? ` (${outcome.detail})` : ''}`);
      }
    },
  });
  // R4-F2: `external:offer.select` through the Atlas SANDBOX. Composed only when
  // honest (LIVE|RECORD + sandbox host + credentials); otherwise absent and
  // approval refuses transport options with an explicit reason.
  const offerExecution = composeOfferExecution(adapterConfig, options.cwd ?? process.cwd());
  console.log(offerExecution
    ? `[atlas] sandbox offer execution composed (mode=${adapterConfig.adapterMode})`
    : '[atlas] sandbox offer execution not composed (needs ADAPTER_MODE=LIVE|RECORD + Atlas sandbox credentials) - transport Recover will be refused with an explicit reason');
  const externalExecution = offerExecution
    ? createPeriodicService({
        name: 'externalExecution',
        pollMs: EXECUTION_POLL_MS,
        run: async (now) => {
          const ctx = { pool: endpoints.app.pool, workspaceId: config.workspaceId, actorPrincipalId: `northstar-execution:${config.workspaceId}`, uow: () => endpoints.app.unitOfWork(), executorPrincipalId, external: offerExecution, now };
          return runExternalExecutionCycle(ctx);
        },
        summarize: ({ report, reconciliation, leaseUnavailable }) => ({ candidates: report.candidates, executed: report.executed, failed: report.failed, unknown: report.unknown, deferred: report.deferred, refused: report.refused, canonicalUpdates: report.canonicalUpdates + reconciliation.canonicalUpdates, reconciled: reconciliation.reconciled, stillUnknown: reconciliation.stillUnknown, leaseUnavailable }),
        onRun({ report, reconciliation, leaseUnavailable }) {
          if (leaseUnavailable) {
            console.log('[atlas] external execution deferred: workspace operation in progress');
            return;
          }
          for (const outcome of report.outcomes) {
            if (outcome.result === 'DEFERRED') continue;
            console.log(`[atlas] external execution ${outcome.result} intent=${outcome.intentId}${outcome.detail ? ` (${outcome.detail})` : ''}`);
          }
          for (const pending of report.canonicalPending) console.log(`[atlas] canonical update pending intent=${pending.intentId} (${pending.error})`);
          if (reconciliation.reconciled > 0) console.log(`[atlas] external reconciliation: reconciled=${reconciliation.reconciled} stillUnknown=${reconciliation.stillUnknown}`);
        },
      })
    : undefined;
  const escalation = lifecycle;
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
          // Fresh assessments: escalate/resolve now, and let a deferred
          // dependent intent proceed now that its gate can see CURRENT truth.
          void escalation.runNow();
          void execution.runNow();
          void externalExecution?.runNow();
        }
      },
    }),
    lifecycle,
    execution,
    ...(externalExecution ? [externalExecution] : []),
  ]);
  endpoints.app.runtimeServices = services;
  endpoints.app.runtimeHooks = {
    executorPrincipalId,
    ...(intelligence ? { intelligence } : {}),
    afterApproval: async () => { await execution.runNow(); await externalExecution?.runNow(); },
    ...(offerExecution ? { externalCapabilities: EXTERNAL_OFFER_SELECT_STATEMENTS } : {}),
    afterExecution: () => lifecycle.runNow(),
    // R3: the ONE planning coordinator instance (also used by the C4
    // progression pass above) so the product planning trigger cannot diverge
    // from, or duplicate, lifecycle planning.
    planner,
  };
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

/**
 * Apply one configured Demo Console / founder-QC control through existing
 * ingress and evaluation-clock seams. No scenario-specific branching.
 */
import { createHash } from 'node:crypto';
import type { Pool } from '../../persistence/postgres/pool.ts';
import type { PgUnitOfWork } from '../../persistence/postgres/pgUnitOfWork.ts';
import type { Instant } from '../../domain/v2/shared/time.ts';
import { acceptProviderShapedDemoEvent } from '../target/applicationCommands.ts';
import { acceptProviderDisruptionDemoEvent } from '../target/providerDisruptionIngress.ts';
import type { WorkspaceEvaluationClock } from '../target/evaluationClock.ts';
import { PgReassessmentWorker, type ReassessmentPipeline } from '../../persistence/postgres/world/pgAssessments.ts';
import { captureWorld } from '../../persistence/postgres/world/pgCurrentState.ts';
import { assessSubject } from '../../resolution/evaluation/assess.ts';
import { createM6Registry } from '../../resolution/evaluation/registry.ts';
import { projectEffectiveWorld } from '../../resolution/world/effectiveItinerary.ts';
import { runCaseEscalation } from '../target/caseEscalation.ts';
import { recordEvidence, recordSource } from '../../persistence/postgres/commands/knowledgeCommands.ts';
import { loadDisclosedDisruptionEvent } from './providerDisruptionEventSource.ts';
import {
  findTimelineStage,
  isClockOnlyStage,
  isProviderEventStage,
  type DelayStage,
  type DelayTimeline,
} from './progressiveDelayTimeline.ts';
import type { DemoControlCatalog, DemoControlDefinition } from './demoControlCatalog.ts';

export interface DemoControlApplyDeps {
  pool: Pool;
  workspaceId: string;
  actorPrincipalId: string;
  uow: () => PgUnitOfWork;
  /** Prefer the boot-owned clock so in-process cache stays authoritative. */
  evaluationClock: WorkspaceEvaluationClock;
  /**
   * When true (CLI / offline harness), drain reassessment + run escalation in
   * this call. When false (normal boot), rely on wakeWorkers / background services.
   */
  driveLifecycle?: boolean;
  /** Optional wake of boot reassessment/lifecycle after mutation or clock advance. */
  wakeWorkers?: () => Promise<void>;
}

export type DemoControlApplyResult =
  | {
      ok: true;
      controlId: string;
      kind: DemoControlDefinition['kind'];
      variant: DemoControlDefinition['variant'];
      evaluationClock: { mode: string; now: string };
      detail: string;
      ingress?: unknown;
      drained?: unknown;
      escalation?: unknown;
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

function buildPipeline(pool: Pool, evaluationNow: () => Instant): ReassessmentPipeline {
  const registry = createM6Registry();
  return async (claim, assessmentId) => {
    const now = evaluationNow();
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

async function drainAndEscalate(
  deps: DemoControlApplyDeps,
): Promise<{ drained: Awaited<ReturnType<PgReassessmentWorker['drainAvailable']>>; escalation: Awaited<ReturnType<typeof runCaseEscalation>> }> {
  const evaluationNow = (): Instant => deps.evaluationClock.now();
  const at = evaluationNow();
  const pipeline = buildPipeline(deps.pool, evaluationNow);
  const drained = await new PgReassessmentWorker(deps.pool, { actorId: deps.actorPrincipalId })
    .drainAvailable(at, pipeline, { workspaceId: deps.workspaceId, maxItems: 200, maxMs: 120_000 });
  const escalation = await runCaseEscalation({
    workspaceId: deps.workspaceId,
    actorPrincipalId: deps.actorPrincipalId,
    uow: deps.uow,
    pool: deps.pool,
    now: at,
  });
  return { drained, escalation };
}

async function resolveInboundServiceId(
  pool: Pool,
  workspaceId: string,
  timeline: DelayTimeline,
): Promise<string> {
  const flightNo = timeline.flightNo;
  if (!flightNo) {
    throw new Error('timeline.flightNo is required to resolve the inbound transport service from source identity');
  }
  const found = await pool.query<{ service_id: string }>(
    `SELECT l.canonical_subject_id AS service_id
       FROM external_record_links l
       JOIN external_records r ON r.workspace_id = l.workspace_id AND r.id = l.external_record_id
      WHERE l.workspace_id = $1
        AND l.canonical_subject_kind = 'TRANSPORT_SERVICE'
        AND l.superseded_at IS NULL
        AND r.record_type = 'SOURCE_TRANSPORT_SERVICE'
        AND r.external_id LIKE $2
      ORDER BY r.external_id
      LIMIT 1`,
    [workspaceId, `${flightNo}@%`],
  );
  if (found.rowCount !== 1) {
    throw new Error(`could not resolve inbound TRANSPORT_SERVICE for configured flight identity ${flightNo}`);
  }
  return found.rows[0]!.service_id;
}

/** Record durable source+evidence for a timeline provider-event stage. */
async function recordStageEvidence(
  deps: DemoControlApplyDeps,
  stage: DelayStage,
  serviceId: string,
  at: Instant,
): Promise<{ ok: true; evidenceId: string } | { ok: false; message: string }> {
  const contentHash = createHash('sha256')
    .update(`demo-control:${stage.eventId ?? stage.id}:${serviceId}`)
    .digest('hex');
  const sourceResult = await recordSource(deps.uow(), {
    workspaceId: deps.workspaceId,
    actorPrincipalId: deps.actorPrincipalId,
    idempotencyKey: `demo-control-stage:${stage.id}:source`,
    sourceIdentity: `demo-control-stage:${stage.eventId ?? stage.id}`,
    receivedAt: at,
    contentHash,
    contentType: 'application/json',
  });
  if (!sourceResult.ok) {
    return { ok: false, message: `failed to record stage source (${sourceResult.conflict.kind})` };
  }
  const evidenceResult = await recordEvidence(deps.uow(), {
    workspaceId: deps.workspaceId,
    actorPrincipalId: deps.actorPrincipalId,
    idempotencyKey: `demo-control-stage:${stage.id}:evidence`,
    assertionType: 'TRANSPORT_SCHEDULE_OBSERVED',
    observedAt: at,
    schemaVersion: 'demo-control/1',
    sourceIds: [sourceResult.value.sourceId],
    subjectRefs: [{ kind: 'TRANSPORT_SERVICE', id: serviceId }],
    interpretationProvenance: 'configured progressive-delay demo control',
  });
  if (!evidenceResult.ok) {
    return { ok: false, message: `failed to record stage evidence (${evidenceResult.conflict.kind})` };
  }
  return { ok: true, evidenceId: evidenceResult.value.evidenceId };
}

async function applyConfiguredAirlineRebooking(
  deps: DemoControlApplyDeps,
  catalog: DemoControlCatalog,
  control: DemoControlDefinition,
): Promise<DemoControlApplyResult> {
  const eventFile = catalog.disruptionEventFile;
  if (!eventFile) {
    return {
      ok: false,
      code: 'DISRUPTION_EVENT_NOT_CONFIGURED',
      message: 'No disclosed simulated airline event is configured on this runtime.',
    };
  }
  const event = await loadDisclosedDisruptionEvent(eventFile);
  const commandCtx = {
    workspaceId: deps.workspaceId,
    actorPrincipalId: deps.actorPrincipalId,
    uow: deps.uow,
    pool: deps.pool,
  };
  const ingress = await acceptProviderDisruptionDemoEvent(commandCtx, event);
  if (!ingress.ok) {
    return {
      ok: false,
      code: ingress.error.code,
      message: ingress.error.message ?? 'Provider disruption ingress failed.',
    };
  }
  let drained: unknown;
  let escalation: unknown;
  if (deps.driveLifecycle) {
    const life = await drainAndEscalate(deps);
    drained = life.drained;
    escalation = life.escalation;
  }
  await deps.wakeWorkers?.();
  return {
    ok: true,
    controlId: control.id,
    kind: control.kind,
    variant: control.variant,
    evaluationClock: { mode: deps.evaluationClock.snapshot().mode, now: deps.evaluationClock.now() },
    detail: ingress.status === 'ALREADY_APPLIED'
      ? 'Already applied. No duplicate incident created.'
      : 'Configured airline disruption applied through provider-event ingress.',
    ingress,
    ...(drained !== undefined ? { drained } : {}),
    ...(escalation !== undefined ? { escalation } : {}),
  };
}

async function applyTimelineProviderStage(
  deps: DemoControlApplyDeps,
  catalog: DemoControlCatalog,
  control: DemoControlDefinition,
  stage: DelayStage,
): Promise<DemoControlApplyResult> {
  if (!catalog.timeline) {
    return { ok: false, code: 'TIMELINE_NOT_CONFIGURED', message: 'Progressive delay timeline is not configured.' };
  }
  if (!isProviderEventStage(stage)) {
    return { ok: false, code: 'INVALID_STAGE', message: `Stage ${stage.id} is not a provider-event stage.` };
  }
  const serviceId = await resolveInboundServiceId(deps.pool, deps.workspaceId, catalog.timeline);
  const revision = await deps.pool.query<{ revision: string }>(
    `SELECT revision::text AS revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2`,
    [deps.workspaceId, serviceId],
  );
  if (revision.rowCount !== 1) {
    return { ok: false, code: 'AGGREGATE_MISSING', message: `Aggregate head missing for service ${serviceId}` };
  }

  const at = (stage.at ?? new Date().toISOString()) as Instant;
  const evidence = await recordStageEvidence(deps, stage, serviceId, at);
  if (!evidence.ok) {
    return { ok: false, code: 'EVIDENCE_FAILED', message: evidence.message };
  }
  const evidenceId = evidence.evidenceId;
  await deps.evaluationClock.advanceTo(at);

  const commandCtx = {
    workspaceId: deps.workspaceId,
    actorPrincipalId: deps.actorPrincipalId,
    uow: deps.uow,
    pool: deps.pool,
  };
  const ingress = await acceptProviderShapedDemoEvent(commandCtx, {
    providerId: 'configured-progressive-delay',
    providerEventId: stage.eventId!,
    receivedAt: at,
    disclosedAsSimulatedDemoInput: true,
    payload: {
      subjectKind: 'TRANSPORT_SERVICE',
      subjectId: serviceId,
      expectedRevision: Number(revision.rows[0]!.revision),
      field: 'ESTIMATED',
      arrival: stage.arrTime!,
      ...(stage.depTime ? { departure: stage.depTime } : {}),
      evidenceId,
    },
  });
  if (!ingress.ok) {
    return {
      ok: false,
      code: 'PROVIDER_EVENT_REJECTED',
      message: `Provider-event ingress failed for stage ${stage.id}.`,
    };
  }

  let drained: unknown;
  let escalation: unknown;
  if (deps.driveLifecycle) {
    const life = await drainAndEscalate(deps);
    drained = life.drained;
    escalation = life.escalation;
  }
  await deps.wakeWorkers?.();
  return {
    ok: true,
    controlId: control.id,
    kind: control.kind,
    variant: control.variant,
    evaluationClock: { mode: deps.evaluationClock.snapshot().mode, now: deps.evaluationClock.now() },
    detail: stage.narrative ?? `Applied provider-event stage ${stage.id}.`,
    ingress,
    ...(drained !== undefined ? { drained } : {}),
    ...(escalation !== undefined ? { escalation } : {}),
  };
}

async function applyTimelineClockStage(
  deps: DemoControlApplyDeps,
  control: DemoControlDefinition,
  stage: DelayStage,
): Promise<DemoControlApplyResult> {
  if (!isClockOnlyStage(stage) || !stage.planningNow) {
    return { ok: false, code: 'INVALID_STAGE', message: `Stage ${stage.id} is not a clock-only stage.` };
  }
  await deps.evaluationClock.advanceTo(stage.planningNow as Instant);
  const worker = new PgReassessmentWorker(deps.pool, { actorId: deps.actorPrincipalId });
  const due = await worker.enqueueDue(deps.evaluationClock.now(), deps.workspaceId);

  let drained: unknown;
  let escalation: unknown;
  if (deps.driveLifecycle) {
    const life = await drainAndEscalate(deps);
    drained = life.drained;
    escalation = life.escalation;
  }
  await deps.wakeWorkers?.();
  return {
    ok: true,
    controlId: control.id,
    kind: control.kind,
    variant: control.variant,
    evaluationClock: { mode: deps.evaluationClock.snapshot().mode, now: deps.evaluationClock.now() },
    detail: stage.narrative
      ?? `Advanced evaluation clock to ${stage.planningNow} (enqueued ${due} due reassessment(s)).`,
    ...(drained !== undefined ? { drained } : {}),
    ...(escalation !== undefined ? { escalation } : {}),
  };
}

/**
 * Apply one catalog control. Unknown / misconfigured controls fail closed.
 */
export async function applyDemoControl(
  deps: DemoControlApplyDeps,
  catalog: DemoControlCatalog,
  control: DemoControlDefinition,
): Promise<DemoControlApplyResult> {
  if (control.variant === 'CONFIGURED_AIRLINE_REBOOKING') {
    return applyConfiguredAirlineRebooking(deps, catalog, control);
  }

  if (!control.stageId) {
    return { ok: false, code: 'INVALID_CONTROL', message: `Control ${control.id} is missing stageId.` };
  }
  if (!catalog.timeline) {
    return { ok: false, code: 'TIMELINE_NOT_CONFIGURED', message: 'Progressive delay timeline is not configured.' };
  }
  const stage = findTimelineStage(catalog.timeline, control.stageId);
  if (!stage) {
    return { ok: false, code: 'UNKNOWN_STAGE', message: `Timeline stage not found: ${control.stageId}` };
  }

  if (control.variant === 'TIMELINE_PROVIDER_STAGE') {
    return applyTimelineProviderStage(deps, catalog, control, stage);
  }
  if (control.variant === 'TIMELINE_CLOCK_STAGE') {
    return applyTimelineClockStage(deps, control, stage);
  }
  return { ok: false, code: 'UNSUPPORTED_VARIANT', message: `Unsupported control variant for ${control.id}.` };
}

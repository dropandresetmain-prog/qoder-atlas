/**
 * A5.1 founder-QC progression harness for connection-loss rehearsal.
 *
 * Reads the configured progressive-delay timeline and applies each stage
 * through the same generic provider-event command the HTTP demo boundary uses,
 * or advances the workspace evaluation clock for clock-only stages.
 * Stage semantics live in scenario data; this script has no traveller/route
 * application branches and does not dispatch consequential provider actions.
 *
 * Usage:
 *   node --experimental-strip-types scripts/a5-founder-qc-progression.ts --list
 *   node --experimental-strip-types scripts/a5-founder-qc-progression.ts --next
 *   node --experimental-strip-types scripts/a5-founder-qc-progression.ts --stage delay_increases_connection_at_risk
 *   node --experimental-strip-types scripts/a5-founder-qc-progression.ts --stage overnight_narita_necessary
 *   node --experimental-strip-types scripts/a5-founder-qc-progression.ts --reset-cursor
 *
 * Requires PG_TARGET_* plus PG_TARGET_WORKSPACE_ID for the demo workspace.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTargetPool } from '../src/persistence/postgres/pool.ts';
import { loadPostgresTargetConfig } from '../src/persistence/postgres/config.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { acceptProviderShapedDemoEvent } from '../src/app/target/applicationCommands.ts';
import { runCaseEscalation } from '../src/app/target/caseEscalation.ts';
import { createWorkspaceEvaluationClock } from '../src/app/target/evaluationClock.ts';
import { PgReassessmentWorker, type ReassessmentPipeline } from '../src/persistence/postgres/world/pgAssessments.ts';
import { captureWorld } from '../src/persistence/postgres/world/pgCurrentState.ts';
import { assessSubject } from '../src/resolution/evaluation/assess.ts';
import { createM6Registry } from '../src/resolution/evaluation/registry.ts';
import { projectEffectiveWorld } from '../src/resolution/world/effectiveItinerary.ts';
import { attachSeedSession, commitSeed, takeSeedEvidence } from '../postgres-integration/m2Seed.ts';
import type { Instant } from '../src/domain/v2/shared/time.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TIMELINE_PATH = join(
  ROOT,
  'data/ait-demo-input-pack/scenarios/s2-missed-connection/inputs/progressive-delay-timeline.json',
);
const CURSOR_PATH = join(ROOT, '.local/a5-founder-qc-cursor.json');
const ACTOR = 'principal:a5-founder-qc-progression';

export interface DelayStage {
  id: string;
  at?: string;
  eventId?: string;
  eventType?: string;
  arrTime?: string;
  depTime?: string;
  connectionRemainingMinutes?: number;
  planningNow?: string;
  narrative?: string;
  phase?: string;
}

export interface DelayTimeline {
  flightNo?: string;
  orderNo?: string;
  stages: DelayStage[];
}

export function loadTimeline(path = TIMELINE_PATH): DelayTimeline {
  return JSON.parse(readFileSync(path, 'utf8')) as DelayTimeline;
}

/** Provider-event stages that mutate transport schedule observations. */
export function providerEventStages(timeline: DelayTimeline): DelayStage[] {
  return timeline.stages.filter((stage) => Boolean(stage.eventId && stage.arrTime));
}

/** Clock-only stages — advance the workspace evaluation clock, no provider event. */
export function clockOnlyStages(timeline: DelayTimeline): DelayStage[] {
  return timeline.stages.filter((stage) => Boolean(stage.planningNow) && !stage.eventId);
}

/** Ordered harness-driven stages: provider events, then clock-only advances. */
export function harnessDrivenStages(timeline: DelayTimeline): DelayStage[] {
  return [...providerEventStages(timeline), ...clockOnlyStages(timeline)];
}

export function isProviderEventStage(stage: DelayStage): boolean {
  return Boolean(stage.eventId && stage.arrTime);
}

export function isClockOnlyStage(stage: DelayStage): boolean {
  return Boolean(stage.planningNow) && !stage.eventId;
}

function say(message: string): void {
  process.stdout.write(`${message}\n`);
}

function loadCursor(): { nextIndex: number; applied: string[] } {
  if (!existsSync(CURSOR_PATH)) return { nextIndex: 0, applied: [] };
  return JSON.parse(readFileSync(CURSOR_PATH, 'utf8')) as { nextIndex: number; applied: string[] };
}

function saveCursor(cursor: { nextIndex: number; applied: string[] }): void {
  mkdirSync(dirname(CURSOR_PATH), { recursive: true });
  writeFileSync(CURSOR_PATH, `${JSON.stringify(cursor, null, 2)}\n`);
}

function parseArgs(argv: string[]): { list?: boolean; next?: boolean; reset?: boolean; stage?: string } {
  const out: { list?: boolean; next?: boolean; reset?: boolean; stage?: string } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--list') out.list = true;
    else if (arg === '--next') out.next = true;
    else if (arg === '--reset-cursor') out.reset = true;
    else if (arg === '--stage') out.stage = argv[++i];
  }
  return out;
}

function requireWorkspaceId(env: NodeJS.ProcessEnv): string {
  const workspaceId = env.PG_TARGET_WORKSPACE_ID?.trim();
  if (!workspaceId) throw new Error('PG_TARGET_WORKSPACE_ID is required');
  return workspaceId;
}

async function resolveInboundServiceId(
  pool: ReturnType<typeof createTargetPool>,
  workspaceId: string,
  timeline: DelayTimeline,
): Promise<string> {
  const flightNo = timeline.flightNo;
  if (!flightNo) throw new Error('timeline.flightNo is required to resolve the inbound transport service from source identity');
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

function buildPipeline(
  pool: ReturnType<typeof createTargetPool>,
  evaluationNow: () => Instant,
): ReassessmentPipeline {
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
  pool: ReturnType<typeof createTargetPool>,
  workspaceId: string,
  evaluationNow: () => Instant,
): Promise<{ drained: Awaited<ReturnType<PgReassessmentWorker['drainAvailable']>>; escalation: Awaited<ReturnType<typeof runCaseEscalation>> }> {
  const at = evaluationNow();
  const pipeline = buildPipeline(pool, evaluationNow);
  const drained = await new PgReassessmentWorker(pool, { actorId: ACTOR })
    .drainAvailable(at, pipeline, { workspaceId, maxItems: 200, maxMs: 120_000 });
  const commandCtx = {
    workspaceId,
    actorPrincipalId: ACTOR,
    uow: () => new PgUnitOfWork(pool, workspaceId),
    pool,
  };
  // Escalation only — progression needs the composed planner from normal boot.
  // With background services running, they continue against the controlled clock.
  const escalation = await runCaseEscalation({ ...commandCtx, now: at });
  return { drained, escalation };
}

async function applyProviderStage(stage: DelayStage, timeline: DelayTimeline): Promise<void> {
  const config = loadPostgresTargetConfig(process.env);
  const workspaceId = requireWorkspaceId(process.env);
  const pool = createTargetPool(config);
  try {
    const serviceId = await resolveInboundServiceId(pool, workspaceId, timeline);
    const revision = await pool.query<{ revision: string }>(
      `SELECT revision::text AS revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2`,
      [workspaceId, serviceId],
    );
    if (revision.rowCount !== 1) throw new Error(`aggregate head missing for service ${serviceId}`);

    const evidenceSeed = await attachSeedSession(pool, workspaceId, ACTOR, 1);
    const evidenceId = takeSeedEvidence(evidenceSeed);
    await commitSeed(evidenceSeed);

    const at = (stage.at ?? new Date().toISOString()) as Instant;
    // Keep background workers aligned with scenario time for this stage.
    const clock = await createWorkspaceEvaluationClock(pool, workspaceId);
    await clock.advanceTo(at);

    const commandCtx = {
      workspaceId,
      actorPrincipalId: ACTOR,
      uow: () => new PgUnitOfWork(pool, workspaceId),
      pool,
    };
    const ingress = await acceptProviderShapedDemoEvent(commandCtx, {
      providerId: 's2-configured-provider-event',
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
      throw new Error(`provider-event ingress failed: ${JSON.stringify(ingress)}`);
    }
    const { drained, escalation } = await drainAndEscalate(pool, workspaceId, () => clock.now());
    say(`Applied stage: ${stage.id}`);
    say(`  narrative: ${stage.narrative ?? '(none)'}`);
    say(`  connection remaining minutes: ${stage.connectionRemainingMinutes ?? 'n/a'}`);
    say(`  evaluation clock: CONTROLLED @ ${clock.now()}`);
    say(`  ingress revision: ${ingress.revision}; reassessment stop: ${drained.stoppedReason}`);
    say(`  case escalation: opened=${escalation.opened} attached=${escalation.attached}`);
    say('  Next: open Overview → Case and inspect V5.6 graph. Do not approve consequential actions from this harness.');
  } finally {
    await pool.end();
  }
}

/**
 * Advance the workspace evaluation clock to the stage's planningNow and
 * re-run reassessment + escalation so overnight/boardability emerges from
 * timing — no scenario-specific force path.
 */
async function applyClockOnlyStage(stage: DelayStage): Promise<void> {
  const planningNow = stage.planningNow;
  if (!planningNow) throw new Error(`clock-only stage ${stage.id} requires planningNow`);
  const config = loadPostgresTargetConfig(process.env);
  const workspaceId = requireWorkspaceId(process.env);
  const pool = createTargetPool(config);
  try {
    const clock = await createWorkspaceEvaluationClock(pool, workspaceId);
    await clock.advanceTo(planningNow as Instant);
    // CLOCK_EXPIRY enqueue so time-alone can stale+reassess.
    const worker = new PgReassessmentWorker(pool, { actorId: ACTOR });
    const due = await worker.enqueueDue(clock.now(), workspaceId);
    const { drained, escalation } = await drainAndEscalate(pool, workspaceId, () => clock.now());
    say(`Advanced evaluation clock: ${stage.id}`);
    say(`  narrative: ${stage.narrative ?? '(none)'}`);
    say(`  planningNow: ${planningNow}`);
    say(`  evaluation clock: CONTROLLED @ ${clock.now()}`);
    say(`  clock-expiry enqueued: ${due}; reassessment stop: ${drained.stoppedReason}; processed=${drained.processed}`);
    say(`  case escalation: opened=${escalation.opened} attached=${escalation.attached}`);
    say('  Overnight / boardability must emerge from timing at this controlled now — no forced recovery path.');
  } finally {
    await pool.end();
  }
}

async function applyStage(stage: DelayStage, timeline: DelayTimeline): Promise<void> {
  if (isProviderEventStage(stage)) {
    await applyProviderStage(stage, timeline);
    return;
  }
  if (isClockOnlyStage(stage)) {
    await applyClockOnlyStage(stage);
    return;
  }
  throw new Error(
    `stage ${stage.id} is neither a provider-event nor a clock-only stage (needs eventId+arrTime or planningNow)`,
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const timeline = loadTimeline();
  const eventStages = providerEventStages(timeline);
  const clockStages = clockOnlyStages(timeline);
  const driven = harnessDrivenStages(timeline);

  if (args.list || (!args.next && !args.stage && !args.reset)) {
    say('Provider-event stages (harness-driven):');
    for (const [index, stage] of eventStages.entries()) {
      say(`  ${index + 1}. ${stage.id} — ${stage.narrative ?? stage.eventType ?? ''}`);
    }
    say('Clock-only stages (harness advances workspace evaluation clock):');
    for (const [index, stage] of clockStages.entries()) {
      say(`  ${eventStages.length + index + 1}. ${stage.id} planningNow=${stage.planningNow} — ${stage.narrative ?? ''}`);
    }
    say(`Cursor file: ${CURSOR_PATH}`);
    if (!args.list && !args.next && !args.stage && !args.reset) {
      say('Pass --next, --stage <id>, --list, or --reset-cursor.');
    }
    return;
  }

  if (args.reset) {
    saveCursor({ nextIndex: 0, applied: [] });
    say('Cursor reset.');
    return;
  }

  const cursor = loadCursor();
  let stage: DelayStage | undefined;
  if (args.stage) {
    stage = driven.find((entry) => entry.id === args.stage)
      ?? timeline.stages.find((entry) => entry.id === args.stage);
    if (!stage) throw new Error(`unknown stage id: ${args.stage}`);
  } else if (args.next) {
    stage = driven[cursor.nextIndex];
    if (!stage) {
      say('All harness-driven stages already applied. Use --reset-cursor to restart, or --list.');
      return;
    }
  }

  if (!stage) throw new Error('no stage selected');
  await applyStage(stage, timeline);
  if (args.next) {
    cursor.applied.push(stage.id);
    cursor.nextIndex += 1;
    saveCursor(cursor);
  }
}

const isDirect = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

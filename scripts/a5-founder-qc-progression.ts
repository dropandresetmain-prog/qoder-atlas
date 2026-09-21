/**
 * A5.1 founder-QC progression harness for connection-loss rehearsal.
 *
 * Reads the configured progressive-delay timeline and applies each stage
 * through the shared Demo Console control application (same provider-event /
 * evaluation-clock seams). Stage semantics live in scenario data; this script
 * has no traveller/route application branches and does not dispatch
 * consequential provider actions.
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
import { createWorkspaceEvaluationClock } from '../src/app/target/evaluationClock.ts';
import { applyDemoControl } from '../src/app/demo/demoControlApplication.ts';
import { loadDemoControlCatalog, type DemoControlDefinition } from '../src/app/demo/demoControlCatalog.ts';
import {
  clockOnlyStages,
  findTimelineStage,
  harnessDrivenStages,
  isClockOnlyStage,
  isProviderEventStage,
  loadTimeline,
  providerEventStages,
  type DelayStage,
  type DelayTimeline,
} from '../src/app/demo/progressiveDelayTimeline.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TIMELINE_PATH = join(
  ROOT,
  'data/ait-demo-input-pack/scenarios/s2-missed-connection/inputs/progressive-delay-timeline.json',
);
const CURSOR_PATH = join(ROOT, '.local/a5-founder-qc-cursor.json');
const ACTOR = 'principal:a5-founder-qc-progression';

export type { DelayStage, DelayTimeline };
export {
  clockOnlyStages,
  harnessDrivenStages,
  isClockOnlyStage,
  isProviderEventStage,
  loadTimeline,
  providerEventStages,
};

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

function controlForStage(stage: DelayStage): DemoControlDefinition {
  if (isProviderEventStage(stage)) {
    return {
      id: stage.id,
      kind: 'PROVIDER_EVENT',
      variant: 'TIMELINE_PROVIDER_STAGE',
      stageId: stage.id,
      group: 'Progressive delay',
      label: stage.id,
      description: stage.narrative ?? stage.id,
      order: 0,
    };
  }
  if (isClockOnlyStage(stage)) {
    return {
      id: stage.id,
      kind: 'EVALUATION_CLOCK_ADVANCE',
      variant: 'TIMELINE_CLOCK_STAGE',
      stageId: stage.id,
      group: 'Progressive delay',
      label: stage.id,
      description: stage.narrative ?? stage.id,
      order: 0,
    };
  }
  throw new Error(
    `stage ${stage.id} is neither a provider-event nor a clock-only stage (needs eventId+arrTime or planningNow)`,
  );
}

async function applyStage(stage: DelayStage, timeline: DelayTimeline): Promise<void> {
  const config = loadPostgresTargetConfig(process.env);
  const workspaceId = requireWorkspaceId(process.env);
  const pool = createTargetPool(config);
  try {
    const evaluationClock = await createWorkspaceEvaluationClock(pool, workspaceId);
    const catalog = {
      ...loadDemoControlCatalog({
        ...process.env,
        NORTHSTAR_DEMO_PROGRESSIVE_DELAY_TIMELINE: TIMELINE_PATH,
      }),
      timeline,
      timelinePath: TIMELINE_PATH,
    };
    const result = await applyDemoControl(
      {
        pool,
        workspaceId,
        actorPrincipalId: ACTOR,
        uow: () => new PgUnitOfWork(pool, workspaceId),
        evaluationClock,
        driveLifecycle: true,
      },
      catalog,
      controlForStage(stage),
    );
    if (!result.ok) {
      throw new Error(`${result.code}: ${result.message}`);
    }
    if (isProviderEventStage(stage)) {
      say(`Applied stage: ${stage.id}`);
      say(`  narrative: ${stage.narrative ?? '(none)'}`);
      say(`  connection remaining minutes: ${stage.connectionRemainingMinutes ?? 'n/a'}`);
    } else {
      say(`Advanced evaluation clock: ${stage.id}`);
      say(`  narrative: ${stage.narrative ?? '(none)'}`);
      say(`  planningNow: ${stage.planningNow}`);
    }
    say(`  evaluation clock: ${result.evaluationClock.mode} @ ${result.evaluationClock.now}`);
    say(`  detail: ${result.detail}`);
    say('  Next: open Overview → Case and inspect product state. Do not approve consequential actions from this harness.');
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const timeline = loadTimeline(TIMELINE_PATH);
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
    stage = findTimelineStage(timeline, args.stage);
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

/**
 * A5 CP5 — demo readiness preflight CLI (read-only, fail-closed).
 *
 * Usage:
 *   node --experimental-strip-types scripts/a5-demo-readiness-preflight.ts
 *   node --experimental-strip-types scripts/a5-demo-readiness-preflight.ts --dataset <key>
 *   node --experimental-strip-types scripts/a5-demo-readiness-preflight.ts --require-name Sarah --require-name Jordan
 *
 * Requires PG_TARGET_* + PG_TARGET_WORKSPACE_ID. Does not provision, approve,
 * book, or mutate canonical state.
 */
import { createTargetPool } from '../src/persistence/postgres/pool.ts';
import { loadPostgresTargetConfig } from '../src/persistence/postgres/config.ts';
import { runDemoReadinessPreflight } from '../src/app/target/demoReadinessPreflight.ts';

function parseArgs(argv: string[]): {
  dataset?: string;
  requireNames: string[];
  json: boolean;
} {
  const requireNames: string[] = [];
  let dataset: string | undefined;
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--dataset') {
      dataset = argv[++i];
    } else if (arg === '--require-name') {
      const name = argv[++i];
      if (name) requireNames.push(name);
    } else if (arg === '--json') {
      json = true;
    }
  }
  return { ...(dataset ? { dataset } : {}), requireNames, json };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const workspaceId = process.env.PG_TARGET_WORKSPACE_ID?.trim();
  if (!workspaceId) {
    throw new Error('PG_TARGET_WORKSPACE_ID is required');
  }
  const config = loadPostgresTargetConfig(process.env);
  const pool = createTargetPool(config);
  try {
    const report = await runDemoReadinessPreflight({
      pool,
      workspaceId,
      ...(args.dataset ? { expectedDatasetKey: args.dataset } : {}),
      ...(args.requireNames.length > 0 ? { requiredTravellerNameTokens: args.requireNames } : {}),
    });
    if (args.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      process.stdout.write(`Demo readiness preflight: ${report.ok ? 'PASS' : 'FAIL'}\n`);
      process.stdout.write(`workspace=${report.workspaceId}\n`);
      for (const check of report.checks) {
        const mark = check.ok ? 'OK' : 'FAIL';
        process.stdout.write(`  [${mark}] (${check.severity}) ${check.id}: ${check.detail}\n`);
      }
      if (report.summary.requiredFailed.length > 0) {
        process.stdout.write(`required failures: ${report.summary.requiredFailed.join(', ')}\n`);
      }
      if (report.summary.advisoryFailed.length > 0) {
        process.stdout.write(`advisory gaps: ${report.summary.advisoryFailed.join(', ')}\n`);
      }
    }
    if (!report.ok) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

const isDirect = process.argv[1] && process.argv[1].includes('a5-demo-readiness-preflight');
if (isDirect) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export { parseArgs, main };

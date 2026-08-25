/**
 * CLI: acceptance scenario runner (LIVE / RECORD / REPLAY / SIMULATED_EXTERNAL_EVENT)
 *
 * Usage:
 *   node --experimental-strip-types scripts/acceptance-run.ts \
 *     --manifest fixtures/acceptance/manifests/s1-airline-schedule-change.json \
 *     --mode REPLAY
 *
 * Does not call Model Studio or Google Routes LIVE unless the composed app
 * mode and credentials would do so — prefer REPLAY/RECORD for Atlas/Nuitée.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runAcceptanceManifest } from '../src/acceptance/runner.ts';
import type { ScenarioExecutionMode } from '../src/acceptance/modes.ts';

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

const manifestPath = argValue('--manifest') ?? process.argv[2];
if (!manifestPath) {
  process.stderr.write(
    'usage: acceptance-run --manifest <path> [--mode LIVE|RECORD|REPLAY|SIMULATED_EXTERNAL_EVENT] [--evidence-dir <dir>]\n',
  );
  process.exit(2);
}

const modeArg = argValue('--mode') as ScenarioExecutionMode | undefined;
const evidenceDir = argValue('--evidence-dir') ?? resolve('output/acceptance');

const result = await runAcceptanceManifest({
  manifestPath,
  evidenceDir,
  ...(modeArg ? { mode: modeArg } : {}),
  ...(argValue('--base-url') ? { baseUrl: argValue('--base-url') } : {}),
  ...(process.argv.includes('--skip-preflight') ? { skipPreflight: true } : {}),
});

mkdirSync(evidenceDir, { recursive: true });
const latestPath = resolve(evidenceDir, 'latest.json');
writeFileSync(latestPath, `${JSON.stringify(result.evidence, null, 2)}\n`, 'utf8');

process.stdout.write(
  JSON.stringify(
    {
      ok: result.evidence.ok,
      evidencePath: result.evidencePath,
      latestPath,
      runId: result.evidence.runId,
      scenarioId: result.evidence.scenarioId,
      mode: result.evidence.mode,
      durationMs: result.evidence.durationMs,
      simulatedSeams: result.evidence.simulatedSeams,
      error: result.evidence.error,
    },
    null,
    2,
  ) + '\n',
);

process.exit(result.evidence.ok ? 0 : 1);

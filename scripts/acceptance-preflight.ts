/**
 * CLI: acceptance preflight
 *
 * Usage:
 *   node --experimental-strip-types scripts/acceptance-preflight.ts \
 *     --manifest fixtures/acceptance/manifests/s1-airline-schedule-change.json
 */
import { runPreflight } from '../src/acceptance/preflight.ts';

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

const manifestPath = argValue('--manifest') ?? process.argv[2];
if (!manifestPath) {
  process.stderr.write('usage: acceptance-preflight --manifest <path>\n');
  process.exit(2);
}

const report = runPreflight({
  manifestPath,
  ...(argValue('--evidence-dir') ? { evidenceDir: argValue('--evidence-dir') } : {}),
  ...(argValue('--recordings-dir') ? { recordingsDir: argValue('--recordings-dir') } : {}),
});

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(report.ok ? 0 : 1);

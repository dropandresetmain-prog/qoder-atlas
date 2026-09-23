/**
 * Founder Jordan transactional RECORD boot — normal main.ts with profile env.
 *
 * Safety: Atlas sandbox host + sandbox test-balance only; RECORD persists
 * sanitized provider captures; no production payment rails.
 */
import { mergeEnvWithDotenvFiles, loadConfig } from '../src/config/config.ts';
import {
  formatRecordProfilePreflightReport,
  evaluateRecordProfilePreflight,
  NORTHSTAR_DEMO_PROFILE_ENV,
} from '../src/config/demoProfiles.ts';

const merged = mergeEnvWithDotenvFiles({
  ...process.env,
  [NORTHSTAR_DEMO_PROFILE_ENV]: 'record',
});

for (const [key, value] of Object.entries(merged)) {
  if (value !== undefined) {
    process.env[key] = value;
  }
}

const preflight = evaluateRecordProfilePreflight(loadConfig(process.env));
if (!preflight.ok) {
  process.stderr.write(`${formatRecordProfilePreflightReport(preflight)}\n`);
  process.exit(1);
}

console.log(
  '[northstar] founder RECORD profile: ADAPTER_MODE=RECORD ATLAS_ENV=sandbox ' +
    'NORTHSTAR_SYNTHETIC_SANDBOX_INPUTS=1 — booting normal main (sandbox execution + recordings)',
);

await import('../src/main.ts');

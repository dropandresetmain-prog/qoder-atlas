/**
 * Founder Jordan video playback boot — normal main.ts with playback profile env.
 *
 * REPLAY provider outcomes only; NORTHSTAR state transitions remain real.
 */
import { mergeEnvWithDotenvFiles, loadConfig } from '../src/config/config.ts';
import {
  evaluateDemoPlaybackPreflight,
  formatDemoPlaybackPreflightReport,
  NORTHSTAR_DEMO_PLAYBACK_ENV,
} from '../src/config/demoPlayback.ts';
import { NORTHSTAR_DEMO_PROFILE_ENV } from '../src/config/demoProfiles.ts';

const merged = mergeEnvWithDotenvFiles({
  ...process.env,
  [NORTHSTAR_DEMO_PROFILE_ENV]: 'playback',
  [NORTHSTAR_DEMO_PLAYBACK_ENV]: '1',
});

for (const [key, value] of Object.entries(merged)) {
  if (value !== undefined) {
    process.env[key] = value;
  }
}

const preflight = evaluateDemoPlaybackPreflight(loadConfig(process.env));
if (!preflight.ok) {
  process.stderr.write(`${formatDemoPlaybackPreflightReport(preflight)}\n`);
  process.exit(1);
}

console.log(
  '[northstar] founder VIDEO PLAYBACK profile: ADAPTER_MODE=REPLAY, isolated CP6 staging corpus, zero provider network',
);

await import('../src/main.ts');

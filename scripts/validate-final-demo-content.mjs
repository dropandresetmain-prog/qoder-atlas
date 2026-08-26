/**
 * Standalone final-demo content coherence gate.
 * Authority: docs/FINAL_DEMO_CONTENT_SSOT.md
 */
import { spawnSync } from 'node:child_process';

const result = spawnSync(
  process.execPath,
  ['--experimental-strip-types', '--test', 'test/final-demo-content-coherence.test.ts'],
  { cwd: process.cwd(), stdio: 'inherit' },
);
process.exit(result.status ?? 1);

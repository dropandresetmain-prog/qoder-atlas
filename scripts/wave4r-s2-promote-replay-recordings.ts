/**
 * Promote Wave4 S2 Atlas search recordings into curated fixtures/recordings
 * for REPLAY acceptance. Copies only provider-boundary captures — does not
 * invent engine outcomes.
 *
 * Run from repo/worktree root:
 *   node --experimental-strip-types scripts/wave4r-s2-promote-replay-recordings.ts
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve('.');
const MAIN_RECORDINGS = resolve(ROOT, '../../recordings');
const ALT_MAIN = resolve(ROOT, '../../../recordings');
const recordingsRoot = existsSync(join(MAIN_RECORDINGS, 'private'))
  ? MAIN_RECORDINGS
  : existsSync(join(ALT_MAIN, 'private'))
    ? ALT_MAIN
    : join(ROOT, 'recordings');

const TARGETS: Array<{ from: string; to: string }> = [
  {
    from: join(recordingsRoot, 'private/atlas/search/rec_b92e556a48e8776d8211605aaeefa27d.json'),
    to: join(ROOT, 'fixtures/recordings/atlas/search/rec_b92e556a48e8776d8211605aaeefa27d.json'),
  },
  {
    from: join(recordingsRoot, 'private/atlas/search/rec_34518610b59c2573957a762d8df8c752.json'),
    to: join(ROOT, 'fixtures/recordings/atlas/search/rec_34518610b59c2573957a762d8df8c752.json'),
  },
  {
    from: join(recordingsRoot, 'private/atlas/search/rec_71d6274a2afd9394033fa18642e20e97.json'),
    to: join(ROOT, 'fixtures/recordings/atlas/search/rec_71d6274a2afd9394033fa18642e20e97.json'),
  },
];

let missing = 0;
for (const target of TARGETS) {
  if (!existsSync(target.from)) {
    process.stderr.write(`MISSING source: ${target.from}\n`);
    missing += 1;
    continue;
  }
  mkdirSync(dirname(target.to), { recursive: true });
  copyFileSync(target.from, target.to);
  process.stdout.write(`promoted ${target.to}\n`);
}
if (missing > 0) process.exit(1);
process.stdout.write('S2 REPLAY search recordings promoted\n');

#!/usr/bin/env node
/**
 * Copies the non-TypeScript runtime assets `tsc` does not emit into `dist`.
 *
 * `composeTargetRuntime` runs the PostgreSQL migrations at boot by reading
 * `persistence/postgres/migrations/*.sql` relative to its own module URL, so a
 * `dist` without those files cannot start at all — `npm start` fails with
 * ENOENT before the first migration. They are data the built artifact needs,
 * not build output, so they are copied rather than compiled.
 */

import { cpSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const assets = [{ from: 'src/persistence/postgres/migrations', to: 'dist/persistence/postgres/migrations', ext: '.sql' }];

for (const asset of assets) {
  const from = resolve(repoRoot, asset.from);
  const to = resolve(repoRoot, asset.to);
  if (!existsSync(from)) throw new Error(`build asset source missing: ${asset.from}`);
  cpSync(from, to, { recursive: true, filter: (src) => !src.endsWith('.ts') });
  const copied = readdirSync(to).filter((f) => f.endsWith(asset.ext)).length;
  const expected = readdirSync(from).filter((f) => f.endsWith(asset.ext)).length;
  if (copied !== expected) throw new Error(`${asset.to}: copied ${copied} ${asset.ext} files, expected ${expected}`);
  console.log(`build assets: ${copied} ${asset.ext} file(s) -> ${asset.to}`);
}

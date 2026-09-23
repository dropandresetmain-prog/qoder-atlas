/**
 * Quarantine every recording/capture that could influence Jordan RECORD/REPLAY,
 * then prepare an isolated fresh corpus directory.
 *
 * Evidence is preserved under recordings-quarantine/<stamp>/ with a SHA-256
 * manifest. Tracked fixture trees stay in place (avoiding a huge deletion
 * diff); the fresh corpus uses a `.corpus-isolated` marker so runtime reads
 * ONLY RECORDINGS_DIR.
 *
 * Usage:
 *   node --experimental-strip-types scripts/a5-quarantine-recordings.ts
 */
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORPUS_ISOLATED_MARKER } from '../src/providers/recordingStoreFactory.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STAMP = 'pre-2026-09-23-jordan-reset';
const QUARANTINE_ROOT = join(ROOT, 'recordings-quarantine', STAMP);
const CORPUS_ID = 'jordan-corpus-2026-09-23';
const CORPUS_DIR = join(ROOT, 'recordings', CORPUS_ID);

type ManifestEntry = {
  originalPath: string;
  quarantinePath: string;
  size: number;
  sha256: string;
  tracked: boolean;
  sourceRoot: string;
  action: 'copied' | 'moved';
};

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function trackedSet(): Set<string> {
  try {
    const raw = execSync('git ls-files -z', { cwd: ROOT, encoding: 'buffer' });
    const set = new Set<string>();
    for (const part of raw.toString('utf8').split('\0')) {
      if (part) set.add(part.replace(/\\/g, '/'));
    }
    return set;
  } catch {
    return new Set();
  }
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function gitHead(): string | null {
  try {
    return execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function collectRoots(): Array<{ key: string; path: string }> {
  const roots: Array<{ key: string; path: string }> = [
    { key: 'runtime-recordings', path: join(ROOT, 'recordings') },
    { key: 'fixtures-recordings', path: join(ROOT, 'fixtures', 'recordings') },
    { key: 'test-fixtures-recordings', path: join(ROOT, 'test', 'fixtures', 'recordings') },
  ];
  const scenarios = join(ROOT, 'fixtures', 'scenarios');
  if (existsSync(scenarios)) {
    for (const entry of readdirSync(scenarios, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(scenarios, entry.name, 'recordings');
      if (existsSync(path)) roots.push({ key: `scenario-${entry.name}`, path });
    }
  }
  return roots;
}

function isFreshCorpusPath(file: string): boolean {
  const rel = relative(join(ROOT, 'recordings'), file).replace(/\\/g, '/');
  return rel === CORPUS_ID || rel.startsWith(`${CORPUS_ID}/`);
}

function main(): void {
  const tracked = trackedSet();
  const entries: ManifestEntry[] = [];
  ensureDir(QUARANTINE_ROOT);

  for (const root of collectRoots()) {
    for (const file of listFiles(root.path)) {
      if (root.key === 'runtime-recordings' && isFreshCorpusPath(file)) continue;
      const relFromRoot = relative(ROOT, file).replace(/\\/g, '/');
      const relFromSource = relative(root.path, file).replace(/\\/g, '/');
      const quarantinePath = join(QUARANTINE_ROOT, root.key, relFromSource);
      ensureDir(dirname(quarantinePath));
      const size = statSync(file).size;
      const hash = sha256File(file);
      const isTracked = tracked.has(relFromRoot);
      copyFileSync(file, quarantinePath);
      let action: 'copied' | 'moved' = 'copied';
      // Move untracked runtime captures out of the active tree so they cannot
      // be committed into the fresh corpus by accident.
      if (root.key === 'runtime-recordings' && !isTracked) {
        try {
          rmSync(file);
          action = 'moved';
        } catch {
          try {
            renameSync(file, `${quarantinePath}.active-removed`);
            action = 'moved';
          } catch {
            // leave active copy; isolation marker still protects RECORD/REPLAY
          }
        }
      }
      entries.push({
        originalPath: relFromRoot,
        quarantinePath: relative(ROOT, quarantinePath).replace(/\\/g, '/'),
        size,
        sha256: hash,
        tracked: isTracked,
        sourceRoot: root.key,
        action,
      });
    }
  }

  ensureDir(CORPUS_DIR);
  writeFileSync(
    join(CORPUS_DIR, CORPUS_ISOLATED_MARKER),
    [
      'Jordan clean-room corpus isolation marker.',
      'When this file is present, NORTHSTAR reads ONLY this RECORDINGS_DIR',
      '(no fixtures/ or scenario recording fallback).',
      `corpusId=${CORPUS_ID}`,
      `createdAt=${new Date().toISOString()}`,
      '',
    ].join('\n'),
  );

  // Empty corpus skeleton README (committed).
  writeFileSync(
    join(CORPUS_DIR, 'README.md'),
    [
      `# ${CORPUS_ID}`,
      '',
      'Isolated Jordan RECORD → REPLAY corpus.',
      '',
      '- Marker: `.corpus-isolated` forces sole-directory REPLAY reads.',
      '- Previous corpora under `recordings-quarantine/pre-2026-09-23-jordan-reset/` are NON-CANONICAL.',
      '- Provider captures are written here during `npm run demo:record`.',
      '',
    ].join('\n'),
  );

  const manifest = {
    stamp: STAMP,
    status: 'QUARANTINED_NON_CANONICAL',
    createdAt: new Date().toISOString(),
    gitHead: gitHead(),
    quarantineRoot: relative(ROOT, QUARANTINE_ROOT).replace(/\\/g, '/'),
    freshCorpusDir: relative(ROOT, CORPUS_DIR).replace(/\\/g, '/'),
    corpusId: CORPUS_ID,
    isolation: {
      marker: CORPUS_ISOLATED_MARKER,
      effect: 'FileRecordingStore readDirs = [RECORDINGS_DIR] only',
    },
    counts: {
      total: entries.length,
      tracked: entries.filter((e) => e.tracked).length,
      untracked: entries.filter((e) => !e.tracked).length,
      moved: entries.filter((e) => e.action === 'moved').length,
      copied: entries.filter((e) => e.action === 'copied').length,
      bySourceRoot: Object.fromEntries(
        [...new Set(entries.map((e) => e.sourceRoot))].map((key) => [
          key,
          entries.filter((e) => e.sourceRoot === key).length,
        ]),
      ),
    },
    files: entries.sort((a, b) => a.originalPath.localeCompare(b.originalPath)),
  };

  writeFileSync(join(QUARANTINE_ROOT, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  ensureDir(join(ROOT, 'docs', 'work'));
  writeFileSync(
    join(ROOT, 'docs', 'work', 'JORDAN_RECORDINGS_QUARANTINE_MANIFEST.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  // Prove active corpus dir has no provider JSON yet.
  const corpusProviderFiles = listFiles(CORPUS_DIR).filter((f) => f.endsWith('.json'));
  const untrackedRuntimeLeft = listFiles(join(ROOT, 'recordings')).filter((f) => {
    if (isFreshCorpusPath(f)) return false;
    const rel = relative(ROOT, f).replace(/\\/g, '/');
    return !tracked.has(rel);
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: corpusProviderFiles.length === 0 && untrackedRuntimeLeft.length === 0,
        quarantineRoot: manifest.quarantineRoot,
        corpusDir: manifest.freshCorpusDir,
        corpusId: CORPUS_ID,
        quarantined: manifest.counts,
        corpusProviderJsonFiles: corpusProviderFiles.length,
        untrackedRuntimeLeft: untrackedRuntimeLeft.map((f) => relative(ROOT, f).replace(/\\/g, '/')),
        note: 'Tracked historical recordings remain on disk under recordings/ and fixtures/recordings but are NON-CANONICAL; .corpus-isolated prevents runtime reads.',
      },
      null,
      2,
    )}\n`,
  );

  if (corpusProviderFiles.length > 0 || untrackedRuntimeLeft.length > 0) process.exitCode = 2;
}

main();

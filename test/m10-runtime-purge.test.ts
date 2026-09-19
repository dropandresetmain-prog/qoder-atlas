/**
 * M10 runtime purge — structural proof that normal NORTHSTAR operation
 * cannot reach SQLite, not a grep spot-check.
 *
 * Parses the actual `import`/`export ... from` specifiers out of every file
 * reachable from `src/main.ts` (resolving relative paths exactly as Node's
 * ESM loader would) and asserts the forbidden SQLite module set never
 * appears in that transitive closure. A grep can miss an indirect import or
 * false-positive on a comment; this walks the real dependency graph a
 * module resolver would walk.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ENTRYPOINT = resolve(ROOT, 'src/main.ts');

/** Modules that must never be reachable from normal application execution. */
const FORBIDDEN_MODULES = [
  resolve(ROOT, 'src/persistence/database.ts'),
  resolve(ROOT, 'src/persistence/repositories.ts'),
  resolve(ROOT, 'src/persistence/entityStore.ts'),
  resolve(ROOT, 'src/app/preferenceStore.ts'),
  resolve(ROOT, 'src/app/dossierStore.ts'),
  resolve(ROOT, 'src/app/fxStore.ts'),
  resolve(ROOT, 'src/app/eventInboxStore.ts'),
  resolve(ROOT, 'src/app/compose.ts'),
  resolve(ROOT, 'src/app/runtime.ts'),
  resolve(ROOT, 'src/engine/mutation.ts'),
  resolve(ROOT, 'src/server/http.ts'),
  // M10 Phase 3: the offline migration reader/exporter. SQLite survives only
  // as read-only migration input, so the migration path must stay
  // unreachable from normal runtime composition — importing the exporter
  // into the product would reintroduce SQLite as a runtime by the back door.
  resolve(ROOT, 'src/migration/legacySqliteSource.ts'),
  resolve(ROOT, 'src/migration/legacyCategories.ts'),
  resolve(ROOT, 'src/migration/legacyExporter.ts'),
  // Phase 4/5: the importer writes to PostgreSQL through the normal command
  // surface, but it is still migration tooling and must never become
  // reachable from the running product.
  resolve(ROOT, 'src/migration/legacyImportContext.ts'),
  resolve(ROOT, 'src/migration/legacyCategoryHandlers.ts'),
  resolve(ROOT, 'src/migration/legacyImporter.ts'),
  resolve(ROOT, 'src/migration/migrationRunStore.ts'),
  resolve(ROOT, 'src/migration/recomputeMigratedState.ts'),
  resolve(ROOT, 'src/migration/legacyUncertainty.ts'),
];

/**
 * Value-edge extractors aligned with `scripts/test-boundary-gate.mjs`:
 * `import type` / `export type` are erased at emit (no runtime dependency).
 * Inline `import { type A }` still emits under verbatimModuleSyntax and counts.
 */
const FROM_RE = /(?:^|[\s;{(])(?:import|export)\s+(type\s+)?([^'"]*?)from\s*['"]([^'"]+)['"]/gm;
const DYNAMIC_RE = /(?:^|[\s;{(])import\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;
const BARE_RE = /(?:^|[\s;{(])import\s*['"]([^'"]+)['"]/gm;

function extractImportSpecifiers(sourceText: string): string[] {
  const specifiers: string[] = [];
  for (const match of sourceText.matchAll(FROM_RE)) {
    const isTypeOnly = Boolean(match[1]);
    if (isTypeOnly) continue;
    const specifier = match[3];
    if (specifier) specifiers.push(specifier);
  }
  for (const match of sourceText.matchAll(DYNAMIC_RE)) {
    if (match[1]) specifiers.push(match[1]);
  }
  for (const match of sourceText.matchAll(BARE_RE)) {
    if (match[1]) specifiers.push(match[1]);
  }
  return specifiers;
}

function resolveSpecifier(fromFile: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined; // bare/package specifier — not part of our source tree
  return resolve(dirname(fromFile), specifier);
}

/** BFS the real import graph from `entry`, returning every `.ts` file reached. */
function walkImportGraph(entry: string): Set<string> {
  const visited = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (visited.has(file)) continue;
    visited.add(file);
    let sourceText: string;
    try {
      sourceText = readFileSync(file, 'utf8');
    } catch {
      continue; // non-.ts resolution artifact (e.g. a .json import) — nothing further to walk
    }
    for (const specifier of extractImportSpecifiers(sourceText)) {
      const resolved = resolveSpecifier(file, specifier);
      if (resolved && !visited.has(resolved)) queue.push(resolved);
    }
  }
  return visited;
}

test('M10: no SQLite module is reachable from the real src/main.ts import graph', () => {
  const reached = walkImportGraph(ENTRYPOINT);
  assert.ok(reached.size > 50, `sanity: expected a large import graph, got ${reached.size} files`);

  const violations = FORBIDDEN_MODULES.filter((forbidden) => reached.has(forbidden));
  assert.deepEqual(
    violations,
    [],
    `src/main.ts's real import graph reaches forbidden SQLite/legacy module(s):\n${violations.join('\n')}`,
  );

  // Belt-and-suspenders: no file in the graph names node:sqlite directly.
  for (const file of reached) {
    const text = readFileSync(file, 'utf8');
    if (/from\s+['"]node:sqlite['"]/.test(text)) {
      assert.fail(`${file} imports node:sqlite directly, reachable from src/main.ts`);
    }
  }
});

test('M10: composeTargetBoot and composeTargetApplication import graphs are also SQLite-free', () => {
  for (const entry of [
    resolve(ROOT, 'src/app/composeTargetBoot.ts'),
    resolve(ROOT, 'src/app/target/composeTargetApplication.ts'),
    resolve(ROOT, 'src/app/target/composeTargetEndpoints.ts'),
  ]) {
    const reached = walkImportGraph(entry);
    const violations = FORBIDDEN_MODULES.filter((forbidden) => reached.has(forbidden));
    assert.deepEqual(violations, [], `${entry}'s import graph reaches: ${violations.join(', ')}`);
  }
});

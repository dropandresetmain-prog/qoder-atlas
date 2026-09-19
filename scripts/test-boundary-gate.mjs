#!/usr/bin/env node
/**
 * Test boundary gate.
 *
 * PostgreSQL is the sole NORTHSTAR runtime. SQLite survives only as an offline,
 * read-only migration input. This gate makes that boundary executable instead of
 * merely documented: it walks the real transitive import graph of every test file
 * and fails when a suite reaches code its classification forbids.
 *
 *   CURRENT_TARGET     must not reach the retired SQLite application runtime or `node:sqlite`.
 *   MIGRATION_BOUNDARY may reach `node:sqlite` and `src/migration/**` (SQLite is the input boundary).
 *   HISTORICAL_LEGACY  exempt; archaeology only, never gating.
 *
 * Usage:
 *   node scripts/test-boundary-gate.mjs            verify the committed classification
 *   node scripts/test-boundary-gate.mjs --report   print the computed reachability per file
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = resolve(repoRoot, 'test/suites.json');

/**
 * Retired SQLite application runtime. A CURRENT_TARGET test that reaches any of
 * these is exercising the runtime M10/C5 retired, not current product behaviour.
 */
const RETIRED_RUNTIME = [
  'src/app/bootstrap.ts',
  'src/app/compose.ts',
  'src/app/dossierStore.ts',
  'src/app/eventInboxStore.ts',
  'src/app/fxStore.ts',
  'src/app/preferenceStore.ts',
  'src/app/runtime.ts',
  'src/persistence/database.ts',
  'src/persistence/entityStore.ts',
  'src/persistence/repositories.ts',
];

const SQLITE_SPECIFIER = 'node:sqlite';

const posix = (p) => p.split(sep).join('/');

function listFiles(dir, predicate, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) listFiles(full, predicate, acc);
    else if (predicate(full)) acc.push(full);
  }
  return acc;
}

/**
 * `import type ... from` / `export type ... from` is erased at emit, so it
 * creates no runtime dependency — a test that only names a retired module's
 * TYPES never loads SQLite. `tsconfig.json` sets `verbatimModuleSyntax`, so
 * the inline `import { type A } from` form DOES still emit the import and is
 * deliberately treated as a value edge here.
 *
 * Runtime reachability is what the boundary is about, so value edges decide
 * pass/fail; type-only reach is surfaced by `--report` as information.
 */
const FROM_RE = /(?:^|[\s;{(])(?:import|export)\s+(type\s+)?([^'"]*?)from\s*['"]([^'"]+)['"]/gm;
const DYNAMIC_RE = /(?:^|[\s;{(])import\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;
const BARE_RE = /(?:^|[\s;{(])import\s*['"]([^'"]+)['"]/gm;

function readImports(file) {
  const src = readFileSync(file, 'utf8');
  const out = [];
  for (const m of src.matchAll(FROM_RE)) out.push({ spec: m[3], typeOnly: m[1] !== undefined });
  for (const m of src.matchAll(DYNAMIC_RE)) out.push({ spec: m[1], typeOnly: false });
  for (const m of src.matchAll(BARE_RE)) out.push({ spec: m[1], typeOnly: false });
  return out;
}

const importCache = new Map();

/**
 * Resolve everything a test file can reach, plus which bare specifiers it uses.
 * `valueOnly` walks only edges that survive emit.
 */
function reachable(entry, valueOnly) {
  const seen = new Set();
  const bare = new Set();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    let specs = importCache.get(file);
    if (specs === undefined) {
      specs = readImports(file);
      importCache.set(file, specs);
    }
    for (const { spec, typeOnly } of specs) {
      if (valueOnly && typeOnly) continue;
      if (!spec.startsWith('.')) {
        bare.add(spec);
        continue;
      }
      const target = resolve(dirname(file), spec);
      if (existsSync(target) && statSync(target).isFile()) stack.push(target);
    }
  }
  return { files: seen, bare };
}

function analyse(absFile) {
  const runtime = reachable(absFile, true);
  const runtimeRels = [...runtime.files].map((f) => posix(relative(repoRoot, f)));
  const anyRels = [...reachable(absFile, false).files].map((f) => posix(relative(repoRoot, f)));
  const retired = RETIRED_RUNTIME.filter((m) => runtimeRels.includes(m));
  return {
    retired,
    sqlite: runtime.bare.has(SQLITE_SPECIFIER),
    migration: runtimeRels.some((r) => r.startsWith('src/migration/')),
    // Names a retired module's types but never loads it — allowed, worth seeing.
    retiredTypesOnly: retired.length === 0 && RETIRED_RUNTIME.some((m) => anyRels.includes(m)),
  };
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const classOf = new Map();
const suiteOf = new Map();
const subsetOf = manifest.subsetOf ?? {};
for (const [suite, files] of Object.entries(manifest.suites)) {
  const cls = manifest.classification[suite];
  if (cls === undefined) throw new Error(`test/suites.json: suite "${suite}" has no classification`);
  const parent = subsetOf[suite];
  if (parent !== undefined) {
    const parentFiles = manifest.suites[parent];
    if (parentFiles === undefined) throw new Error(`test/suites.json: subset suite "${suite}" has no parent suite "${parent}"`);
    if (manifest.classification[parent] !== cls) {
      throw new Error(`test/suites.json: subset suite "${suite}" must share classification with parent suite "${parent}"`);
    }
    const parentSet = new Set(parentFiles);
    for (const f of files) {
      if (!parentSet.has(f)) {
        throw new Error(`test/suites.json: subset suite "${suite}" contains ${f}, which is not in parent suite "${parent}"`);
      }
    }
    continue;
  }
  for (const f of files) {
    if (classOf.has(f)) throw new Error(`test/suites.json: ${f} appears in more than one suite`);
    classOf.set(f, cls);
    suiteOf.set(f, suite);
  }
}

const discovered = [
  ...listFiles(resolve(repoRoot, 'test'), (f) => f.endsWith('.test.ts')),
  ...listFiles(resolve(repoRoot, 'postgres-integration'), (f) => f.endsWith('.pgtest.ts')),
].map((f) => posix(relative(repoRoot, f)));

const violations = [];
const report = [];

for (const file of discovered.sort()) {
  const cls = classOf.get(file);
  if (cls === undefined) {
    violations.push(`UNCLASSIFIED  ${file} — add it to test/suites.json under one of ${Object.keys(manifest.suites).join(', ')}`);
    continue;
  }
  const facts = analyse(resolve(repoRoot, file));
  report.push({ file, cls, suite: suiteOf.get(file), ...facts });
  if (cls !== 'CURRENT_TARGET') continue;
  if (facts.retired.length > 0) {
    violations.push(`BOUNDARY      ${file} — CURRENT_TARGET reaches retired SQLite runtime: ${facts.retired.join(', ')}`);
  }
  if (facts.sqlite) {
    violations.push(`BOUNDARY      ${file} — CURRENT_TARGET imports ${SQLITE_SPECIFIER}`);
  }
  if (facts.migration) {
    violations.push(`BOUNDARY      ${file} — CURRENT_TARGET reaches src/migration/** (classify it as migration-boundary instead)`);
  }
}

for (const file of classOf.keys()) {
  if (!discovered.includes(file)) {
    violations.push(`STALE         ${file} — listed in test/suites.json but does not exist`);
  }
}

if (process.argv.includes('--report')) {
  for (const r of report) {
    const flags = [
      r.retired.length > 0 ? `retired(${r.retired.length})` : '',
      r.sqlite ? 'sqlite' : '',
      r.migration ? 'migration' : '',
      r.retiredTypesOnly ? 'retired-types-only' : '',
    ]
      .filter(Boolean)
      .join(' ');
    console.log(`${r.cls.padEnd(19)} ${r.suite.padEnd(10)} ${r.file}${flags === '' ? '' : `  [${flags}]`}`);
  }
  const byClass = report.reduce((acc, r) => ({ ...acc, [r.cls]: (acc[r.cls] ?? 0) + 1 }), {});
  const bySuite = report.reduce((acc, r) => ({ ...acc, [r.suite]: (acc[r.suite] ?? 0) + 1 }), {});
  console.log('\nby class:', JSON.stringify(byClass));
  console.log('by suite:', JSON.stringify(bySuite));
}

if (violations.length > 0) {
  console.error(`\nTEST BOUNDARY GATE: ${violations.length} violation(s)\n`);
  for (const v of violations) console.error(`  ${v}`);
  console.error('\nSee docs/TESTING.md "Suite classification".');
  process.exit(1);
}

console.log(`TEST BOUNDARY GATE: CLEAN — ${discovered.length} test files classified, boundaries hold.`);

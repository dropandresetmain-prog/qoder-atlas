/**
 * Wave 3R anti-hardcoding gate — static scan of generic application/domain code.
 *
 * Scans src/app, src/engine, src/domain, src/intelligence, src/operational
 * for demo-specific identifiers, scenario switches, and quoted city/airport
 * literals. Comments and known false positives are excluded.
 *
 * Exit 0 = clean, 1 = findings.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SCAN_ROOTS = ['src/app', 'src/engine', 'src/domain', 'src/intelligence', 'src/operational'];

/** Demo/fixture tokens that must not appear in generic logic (any context after comment strip). */
const FORBIDDEN_TOKENS = [
  'ait-draft-',
  'evt-ait-',
  'MNSYN',
  'Meridian',
  'Wanderpay',
  'Marina Bay',
  'trip_a',
  'trip_b',
  'anchor-event-speaker',
];

/** Scenario-family switches in app/engine/domain code. */
const SCENARIO_SWITCH_RES = [
  /\bscenario\s*===\s*['"]S\d+['"]/,
  /\bfamily\s*===\s*['"]S\d+['"]/,
  /\bscenario\s*==\s*['"]S\d+['"]/,
  /\bfamily\s*==\s*['"]S\d+['"]/,
];

/** Quoted city/airport demo literals — not field names, not IANA zones. */
const QUOTED_GEO_RES = [
  /(['"])(Singapore|London|Tokyo|HND|SIN)\1/g,
];

/**
 * Allowlisted lines (after comment strip). Each entry documents a known benign hit.
 * - IANA timezone strings embed city names but are not demo geography literals.
 */
const LINE_ALLOWLIST_RES = [
  /Asia\/Singapore/,
  /Europe\/London/,
  /Asia\/Tokyo/,
];

function stripComments(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    if (source[i] === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (source[i] === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += source[i];
    i += 1;
  }
  return out;
}

function collectTsFiles(rootDir) {
  const files = [];
  function walk(dir) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      const st = statSync(path);
      if (st.isDirectory()) {
        if (entry === 'test' || entry === 'tests' || entry === 'fixtures' || entry === '__tests__') continue;
        walk(path);
        continue;
      }
      if (!entry.endsWith('.ts')) continue;
      if (entry.endsWith('.test.ts') || entry.endsWith('.spec.ts')) continue;
      files.push(path);
    }
  }
  walk(rootDir);
  return files.sort();
}

function isAllowlistedLine(line) {
  return LINE_ALLOWLIST_RES.some((re) => re.test(line));
}

function scanFile(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  const stripped = stripComments(raw);
  const lines = stripped.split('\n');
  const findings = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx += 1) {
    const line = lines[lineIdx];
    if (isAllowlistedLine(line)) continue;

    for (const token of FORBIDDEN_TOKENS) {
      let searchFrom = 0;
      while (searchFrom < line.length) {
        const hit = line.indexOf(token, searchFrom);
        if (hit === -1) break;
        findings.push({
          file: filePath,
          line: lineIdx + 1,
          kind: 'forbidden-token',
          detail: token,
          excerpt: line.trim().slice(0, 120),
        });
        searchFrom = hit + token.length;
      }
    }

    for (const re of SCENARIO_SWITCH_RES) {
      if (re.test(line)) {
        findings.push({
          file: filePath,
          line: lineIdx + 1,
          kind: 'scenario-switch',
          detail: re.source,
          excerpt: line.trim().slice(0, 120),
        });
      }
    }

    for (const re of QUOTED_GEO_RES) {
      re.lastIndex = 0;
      let match;
      while ((match = re.exec(line)) !== null) {
        findings.push({
          file: filePath,
          line: lineIdx + 1,
          kind: 'quoted-geo-literal',
          detail: match[2],
          excerpt: line.trim().slice(0, 120),
        });
      }
    }
  }

  return findings;
}

const allFiles = SCAN_ROOTS.flatMap((root) => collectTsFiles(root));
console.log(`anti-hardcoding scan roots: ${SCAN_ROOTS.join(', ')}`);
console.log(`typescript files scanned: ${allFiles.length}`);

const findings = allFiles.flatMap((file) => scanFile(file));

if (findings.length === 0) {
  console.log('VERDICT: CLEAN — no forbidden demo tokens, scenario switches, or quoted geo literals');
  process.exit(0);
}

console.log(`VERDICT: FINDINGS — ${findings.length} hit(s)`);
for (const finding of findings) {
  const rel = relative(process.cwd(), finding.file);
  console.log(`${finding.kind.toUpperCase()}: ${rel}:${finding.line} — ${finding.detail}`);
  console.log(`  ${finding.excerpt}`);
}
process.exit(1);

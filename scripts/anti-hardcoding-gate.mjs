#!/usr/bin/env node
/**
 * Anti-hardcoding gate — static scan that demo facts stay out of generic code.
 *
 * Product claim: one generic recovery engine, every hackathon-demo fact living in
 * data/config. This gate is the executable version of that claim.
 *
 * Coverage: every TypeScript file under src/ (whole tree, 180 files), classified
 * into tiers by path, plus a short reviewed list of declared demo modules.
 *
 * The scanner is exported and pure (scanSource / classifyPath / runGate) so
 * test/anti-hardcoding-gate.test.ts can prove detection works; an
 * unenforced guardrail is exactly how the previous regression shipped.
 *
 * Exit 0 = clean, 1 = findings. The `VERDICT:` line format is a contract — the
 * npm script and pipeline log parsers depend on it.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------

/**
 * - strict    Domain/engine/contract/ingest/persistence/config. Must never know a
 *             demo fact, not even via a provider name.
 * - app       Generic application, HTTP and presentation code (incl. the acceptance
 *             harness). Demo facts forbidden unless the file is a declared demo
 *             module below.
 * - provider  Concrete external provider adapters. Provider wire field names,
 *             sandbox hostnames and provider constants are legitimate here, so the
 *             demo brand / flight / venue / geo rules deliberately do not fire.
 * - demo      Declared demo-bootstrap and preview-fixture modules (allowlisted).
 * - excluded  Never scanned (generated or vendored output).
 */
export const TIERS = Object.freeze({
  STRICT: 'strict',
  APP: 'app',
  PROVIDER: 'provider',
  DEMO: 'demo',
  EXCLUDED: 'excluded',
});

/**
 * Directory prefix -> tier. Matched longest-prefix-first, so a specific entry can
 * carve a sub-tier out of a broader one. Unknown src/ paths fail closed to STRICT
 * (a new directory cannot quietly opt out of the gate).
 */
export const TIER_BY_PREFIX = Object.freeze([
  ['src/providers/', TIERS.PROVIDER],
  ['src/domain/', TIERS.STRICT],
  ['src/engine/', TIERS.STRICT],
  ['src/operational/', TIERS.STRICT],
  ['src/contracts/', TIERS.STRICT],
  ['src/ingest/', TIERS.STRICT],
  ['src/intake/', TIERS.STRICT],
  ['src/intelligence/', TIERS.STRICT],
  ['src/scenarios/', TIERS.STRICT],
  ['src/persistence/', TIERS.STRICT],
  ['src/util/', TIERS.STRICT],
  ['src/config/', TIERS.STRICT],
  ['src/acceptance/', TIERS.APP],
  ['src/app/', TIERS.APP],
  ['src/server/', TIERS.APP],
  ['src/ui/', TIERS.APP],
]);

/** Loose top-level entrypoints that are generic composition code. */
export const APP_EXPLICIT_FILES = Object.freeze(['src/main.ts']);

/** Directories never scanned: generated or vendored output, not authored source. */
export const EXCLUDED_DIR_NAMES = Object.freeze(['node_modules', 'dist', 'build', 'coverage', '.git']);

/**
 * REVIEWED demo layer — bootstrap modules whose whole job is to wire the hackathon
 * world (manifest paths, hero workflows, seeded demo scenario ids).
 *
 * SLATED TO MOVE OUT OF src/ (e.g. to demo/ or fixtures/) in the follow-up
 * demo-boundary task; while they live under src/ they stay on this short, audited
 * list. Nothing may be added here just because it has an inconvenient finding —
 * generic modules with real violations must stay violating.
 */
export const DECLARED_DEMO_FILES = Object.freeze(['src/app/demoHeroes.ts', 'src/app/demoWorld.ts']);

/**
 * Preview/test-only fixture corpora: the same demo-layer exemption, declared
 * separately because the reason differs (design-time screen preview, not runtime
 * bootstrap). Also slated to move out of src/ with the demo-boundary task.
 */
export const DECLARED_PREVIEW_FIXTURE_FILES = Object.freeze(['src/ui/fixtures/readmodels.ts']);

/** File suffixes scanned. */
export const SOURCE_SUFFIXES = Object.freeze(['.ts', '.tsx', '.mts']);

/**
 * IANA time-zone ids legitimately embed city names. Masked out of the scanned text
 * before geography rules run, so `Asia/Singapore` stays legal WITHOUT exempting the
 * whole source line (the previous gate skipped the entire matching line, which hid
 * any other violation sharing it).
 */
export const IANA_ZONE_MASK_RES = Object.freeze([/([A-Z][a-z]+)\/([A-Z][a-z_]+)/g]);

// ---------------------------------------------------------------------------
// Rules — add a line here to extend the gate
// ---------------------------------------------------------------------------

const STRICT_AND_APP = Object.freeze(['strict', 'app']);
const EVERYWHERE = Object.freeze(['strict', 'app', 'provider']);

/**
 * Detection rules. Patterns match unquoted substrings as well as string literals,
 * and are case-insensitive unless a pattern says otherwise.
 *
 * Demo persona names and draft ids are read from
 * data/ait-demo-input-pack/global/roster.json (ait-draft-09/14/35/38) and
 * fixtures/programmes/ait-summit-2026/programme.json — the roster carries 67
 * participants; these four are the hero personas whose identities leak into product
 * copy paths. Forename+surname matching is deliberate: bare surnames such as Lim or
 * Berg collide with unrelated identifiers and ordinary words.
 */
export const RULES = Object.freeze([
  {
    id: 'demo-persona',
    tiers: EVERYWHERE,
    patterns: [
      { re: /\bjordan\s+hale\b/iu, label: 'persona: Jordan Hale' },
      { re: /\bsarah\s+lim\b/iu, label: 'persona: Sarah Lim' },
      { re: /\bjonas\s+berg\b/iu, label: 'persona: Jonas Berg' },
      { re: /\boliver\s+bennett\b/iu, label: 'persona: Oliver Bennett' },
      { re: /\banthony\b/iu, label: 'demo operator persona: Anthony' },
      { re: /\bait-draft-\d+\b/u, label: 'persona draft id: ait-draft-*' },
    ],
  },

  {
    id: 'ait-id-namespace',
    tiers: EVERYWHERE,
    patterns: [
      { re: /\bevt-ait\b/iu, label: 'AiT event id: evt-ait-*' },
      { re: /\bait-summit\b/iu, label: 'AiT event slug / programme dir: ait-summit' },
      { re: /\borg-ait\b/iu, label: 'AiT org id: org-ait-*' },
      { re: /\bcmt-ait\b/iu, label: 'AiT commitment id: cmt-ait-*' },
      { re: /\bai\s+in\s+travel\b/iu, label: 'AiT brand: AI in Travel' },
      // Standalone AiT token, including the lower-case fragment generic code reaches
      // for inside a substring test. \b keeps waiting/detail/container/await out.
      { re: /\bait\b/iu, label: 'AiT brand token: AiT' },
    ],
  },

  /**
   * Legacy demo-world tokens carried forward from the previous gate version so
   * coverage never regresses.
   */
  {
    id: 'legacy-demo-token',
    tiers: EVERYWHERE,
    patterns: [
      { re: /\bmeridian\b/iu, label: 'demo org: Meridian' },
      { re: /\bwanderpay\b/iu, label: 'demo org: Wanderpay' },
      { re: /\btrip_[ab]\b/iu, label: 'demo fixture id: trip_a / trip_b' },
      { re: /\banchor-event-speaker\b/iu, label: 'demo fixture id: anchor-event-speaker' },
    ],
  },

  // --- demo carrier / hotel brands ---------------------------------------------
  // Derived from data/ait-demo-input-pack/global/places.json and the scenario
  // dossiers. Provider mock adapters legitimately replay supplier data, so the
  // provider tier is exempt from brand / flight / venue / geo rules.
  {
    id: 'demo-brand',
    tiers: STRICT_AND_APP,
    patterns: [
      { re: /\bzipair\b/iu, label: 'demo carrier: ZIPAIR' },
      { re: /\bscoot\b/iu, label: 'demo carrier: Scoot' },
      { re: /\bconcorde\b/iu, label: 'demo hotel supplier: Concorde' },
      { re: /\bharbourline\b/iu, label: 'demo hotel supplier: Harbourline' },
      { re: /\bbayview\b/iu, label: 'demo hotel supplier: Bayview' },
      { re: /\bpan\s+pacific\b/iu, label: 'demo venue: Pan Pacific' },
    ],
  },

  {
    id: 'demo-flight-code',
    tiers: STRICT_AND_APP,
    patterns: [
      { re: /\bmn3\d\d\b/iu, label: 'demo flight: MN3xx' },
      { re: /\bzg0\d\d\b/iu, label: 'demo flight: ZG0xx' },
      { re: /\bmnsyn\b/iu, label: 'demo route: MNSYN' },
      { re: /\bzgsyn\b/iu, label: 'demo route: ZGSYN' },
    ],
  },

  /**
   * Demo-corridor geography used as content or a condition rather than as a zone.
   * Not a rule against the product ever running in Singapore — a rule against
   * generic code branching on the demo corridor. IANA zones are masked first.
   */
  {
    id: 'demo-geo',
    tiers: STRICT_AND_APP,
    patterns: [
      { re: /\bmarina\s+bay\b/iu, label: 'demo venue: Marina Bay' },
      { re: /\bchangi\b/iu, label: 'demo airport: Changi' },
      { re: /\bnarita\b/iu, label: 'demo airport: Narita' },
      { re: /\bplace-mbs\b/iu, label: 'demo place id: place-mbs' },
      { re: /\btokyo\b/iu, label: 'demo corridor city: Tokyo' },
      { re: /\bsingapore\b/iu, label: 'demo corridor city: Singapore' },
      { re: /\blondon\b/iu, label: 'demo corridor city: London' },
      // IATA codes: upper-case-only whole words, which is exactly what a corridor
      // branch keys on, and which cannot collide with ordinary prose.
      { re: /\b(?:SIN|NRT|HND)\b/u, label: 'demo corridor IATA code' },
    ],
  },

  /** Generic code must not branch on which demo scenario it is serving. */
  {
    id: 'scenario-switch',
    tiers: STRICT_AND_APP,
    patterns: [
      { re: /\bscenario(?:id)?\s*[=!]==?\s*['"`][^'"`]+['"`]/iu, label: 'branch on scenarioId' },
      { re: /\bfamily\s*[=!]==?\s*['"`][^'"`]+['"`]/iu, label: 'branch on family' },
      { re: /[=!]==?\s*['"`]S\d['"`]/u, label: "comparison against 'S<n>' scenario id" },
    ],
  },

  /**
   * Demo data-pack paths and assets referenced from code. Deliberately narrow:
   * pack-layout conventions (join(dir, 'scenario.json'), 'programme.json',
   * 'booking-dossiers.json') are format, not demo facts, so only the AiT pack
   * paths and the demo hero asset are matched. A blanket `*.json` pattern lit up on
   * every fetch `response.json()` call and was rejected as noise.
   */
  {
    id: 'demo-fixture-ref',
    tiers: STRICT_AND_APP,
    patterns: [
      { re: /\bait-demo-input-pack\b/iu, label: 'demo fixture pack path' },
      { re: /\bfixtures\/programmes\b/iu, label: 'demo programme fixture path' },
      { re: /\bfixtures\/acceptance\b/iu, label: 'demo acceptance manifest path' },
      { re: /\bsg-dusk\b/iu, label: 'demo hero asset: sg-dusk' },
      { re: /\bplace-hotel-riverview\b/iu, label: 'demo place id in prompt examples' },
      { re: /\btrv-summit-attendee\b/iu, label: 'demo traveller cohort id in prompt examples' },
    ],
  },
]);

// ---------------------------------------------------------------------------
// Machinery
// ---------------------------------------------------------------------------

/**
 * Strip `//` and block comments before scanning.
 *
 * Applied to every scanned tier on purpose: a comment that *names* a demo fact
 * (e.g. `// "ZG023" for carrier "ZG" — never double-prefix`) is the boundary being
 * documented, not a hardcoded branch. Only executable text can encode a rule, so
 * comment text stays legal while the same token in code is a violation. String
 * literals are tracked so a `//` inside a URL or template is not mistaken for a
 * comment. Line structure is preserved (comments blanked, not removed) so reported
 * line numbers still point at real source lines.
 */
export function stripCommentsKeepLines(source) {
  const chars = [];
  let i = 0;
  let state = 'code';
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (state === 'code') {
      if (ch === '/' && next === '/') {
        state = 'line';
        chars.push(' ');
        i += 1;
        continue;
      }
      if (ch === '/' && next === '*') {
        state = 'block';
        chars.push(' ');
        i += 1;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') state = ch;
      chars.push(ch);
      i += 1;
      continue;
    }
    if (state === 'line') {
      if (ch === '\n') {
        state = 'code';
        chars.push('\n');
      } else {
        chars.push(' ');
      }
      i += 1;
      continue;
    }
    if (state === 'block') {
      if (ch === '*' && next === '/') {
        state = 'code';
        chars.push(' ');
        i += 1;
        continue;
      }
      chars.push(ch === '\n' ? '\n' : ' ');
      i += 1;
      continue;
    }
    const quote = state;
    if (ch === '\\') {
      chars.push(ch);
      if (i + 1 < source.length) chars.push(source[i + 1]);
      i += 2;
      continue;
    }
    if (ch === quote) state = 'code';
    chars.push(ch);
    i += 1;
  }
  return chars.join('');
}

function toPosix(path) {
  return path.split(sep).join(posix.sep);
}

/** Classify a repo-relative path into a tier (longest matching prefix wins). */
export function classifyPath(relPath) {
  const key = toPosix(relPath);
  if (DECLARED_DEMO_FILES.includes(key) || DECLARED_PREVIEW_FIXTURE_FILES.includes(key)) return TIERS.DEMO;
  if (EXCLUDED_DIR_NAMES.some((dir) => key.split(posix.sep).includes(dir))) return TIERS.EXCLUDED;
  if (APP_EXPLICIT_FILES.includes(key)) return TIERS.APP;
  // Anything outside src/ is not this gate's business; demo data is *supposed*
  // to live in fixtures/, data/ and recordings/.
  if (!key.startsWith('src/')) return TIERS.EXCLUDED;
  let bestPrefix = -1;
  let bestTier = TIERS.STRICT;
  for (const [prefix, tier] of TIER_BY_PREFIX) {
    if (key.startsWith(prefix) && prefix.length > bestPrefix) {
      bestPrefix = prefix.length;
      bestTier = tier;
    }
  }
  return bestTier;
}

function isSourceFile(name) {
  if (!SOURCE_SUFFIXES.some((suffix) => name.endsWith(suffix))) return false;
  return !name.endsWith('.test.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.d.ts');
}

/** Recursively collect scannable source files under rootDir, as repo-relative paths. */
export function collectSourceFiles(rootDir, cwd = process.cwd()) {
  const out = [];
  const absDir = join(cwd, rootDir);
  if (!existsSync(absDir)) return out;
  for (const entry of readdirSync(absDir)) {
    const abs = join(absDir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (EXCLUDED_DIR_NAMES.includes(entry)) continue;
      const rel = toPosix(relative(cwd, abs));
      out.push(...collectSourceFiles(rel, cwd));
      continue;
    }
    if (isSourceFile(entry)) out.push(toPosix(relative(cwd, abs)));
  }
  return out.sort();
}

/** Blank out allowlisted benign substrings (IANA zones) without dropping the line. */
export function maskAllowlisted(text) {
  let masked = text;
  for (const re of IANA_ZONE_MASK_RES) {
    masked = masked.replace(new RegExp(re.source, re.flags), (match) => ' '.repeat(match.length));
  }
  return masked;
}

const SCAN_RES = RULES.flatMap((rule) =>
  rule.tiers.map((tier) => ({
    tier,
    ruleId: rule.id,
    patterns: rule.patterns.map((p) => ({ re: new RegExp(p.re.source, p.re.flags.replace(/g/g, '')), label: p.label })),
  })),
);

/**
 * Scan one source text. Returns findings for the tier the path resolves to; empty
 * for demo/excluded tiers, which keeps every allowlist decision explicit.
 * Pure and side-effect free so tests can feed it fake in-memory files.
 */
export function scanSource(relPath, source) {
  const tier = classifyPath(relPath);
  if (tier === TIERS.DEMO || tier === TIERS.EXCLUDED) return [];
  const lines = maskAllowlisted(stripCommentsKeepLines(source)).split('\n');
  const byLocation = new Map();

  for (const scan of SCAN_RES) {
    if (scan.tier !== tier) continue;
    for (const { re, label } of scan.patterns) {
      for (let lineIdx = 0; lineIdx < lines.length; lineIdx += 1) {
        const line = lines[lineIdx];
        if (line.length === 0) continue;
        re.lastIndex = 0;
        if (!re.test(line)) continue;
        const key = `${lineIdx + 1}|${scan.ruleId}`;
        let entry = byLocation.get(key);
        if (!entry) {
          entry = { file: relPath, line: lineIdx + 1, tier, rule: scan.ruleId, details: [], excerpt: line.trim().slice(0, 140) };
          byLocation.set(key, entry);
        }
        if (!entry.details.includes(label)) entry.details.push(label);
      }
    }
  }

  return [...byLocation.values()]
    .sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule))
    .map((finding) => ({ ...finding, detail: finding.details.join('; ') }));
}

export function scanFile(relPath, cwd = process.cwd()) {
  return scanSource(relPath, readFileSync(join(cwd, relPath), 'utf8'));
}

/**
 * Run the whole gate over a real tree. Pure apart from reading the filesystem:
 * returns { files, findings, tierCounts } and never touches process state, so the
 * CLI wrapper and the self-test share one implementation.
 */
export function runGate(cwd = process.cwd()) {
  const files = collectSourceFiles('src', cwd);
  const findings = [];
  const tierCounts = {};
  for (const file of files) {
    const tier = classifyPath(file);
    tierCounts[tier] = (tierCounts[tier] ?? 0) + 1;
    findings.push(...scanFile(file, cwd));
  }
  findings.sort((a, b) => `${a.file}:${String(a.line).padStart(6, '0')}`.localeCompare(`${b.file}:${String(b.line).padStart(6, '0')}`));
  return { files, findings, tierCounts };
}

function main() {
  const { files, findings, tierCounts } = runGate(process.cwd());
  const tierSummary = Object.values(TIERS)
    .map((tier) => `${tier}=${tierCounts[tier] ?? 0}`)
    .join(' ');

  console.log('anti-hardcoding scan root: src (full tree)');
  console.log(`typescript files scanned: ${files.length} (${tierSummary})`);
  console.log(`rules: ${RULES.map((rule) => rule.id).join(', ')}`);
  console.log(
    `allowlisted demo modules: ${[...DECLARED_DEMO_FILES, ...DECLARED_PREVIEW_FIXTURE_FILES].join(', ')}`,
  );

  if (findings.length === 0) {
    console.log('VERDICT: CLEAN — no forbidden demo tokens, scenario switches, or quoted geo literals');
    process.exitCode = 0;
    return;
  }

  console.log(`VERDICT: FINDINGS — ${findings.length} hit(s)`);
  for (const finding of findings) {
    console.log(
      `${finding.rule.toUpperCase()}: ${finding.file}:${finding.line} [tier=${finding.tier}] — ${finding.detail}`,
    );
    console.log(`  ${finding.excerpt}`);
  }
  process.exitCode = 1;
}

const invokedDirectly =
  typeof process.argv[1] === 'string' &&
  pathToFileURL(resolve(process.argv[1])).href === pathToFileURL(fileURLToPath(import.meta.url)).href;

if (invokedDirectly) main();

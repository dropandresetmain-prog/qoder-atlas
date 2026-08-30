/**
 * Self-test for the anti-hardcoding gate.
 *
 * The gate exists because demo facts leaked into generic application code once
 * already, and a guardrail nobody proves still works is how that happened. The
 * previous version scanned 5 of 17 src roots and reported CLEAN while
 * `presentation.ts` branched on demo carrier names — a green light that meant
 * nothing. So this file proves three separate things:
 *
 * 1. DETECTION — planted demo facts in fake generic files are reported.
 * 2. ALLOWLISTS — provider sandbox constants, IANA zones, comments and declared
 *    demo modules do NOT fire (a gate that rejects everything gets disabled).
 * 3. THE REAL REPO — the live verdict is pinned to a reviewed exception set that
 *    may only shrink, and strict/provider tiers must be genuinely clean.
 *
 * Also covers the CLI contract (exit code + `VERDICT:` line) that pipeline
 * scripts depend on.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const GATE_URL = new URL('../scripts/anti-hardcoding-gate.mjs', import.meta.url);
const GATE_SCRIPT = fileURLToPath(GATE_URL);
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

interface GateFinding {
  file: string;
  line: number;
  tier: string;
  rule: string;
  detail: string;
  excerpt: string;
}

interface GateModule {
  readonly TIERS: {
    readonly STRICT: 'strict';
    readonly APP: 'app';
    readonly PROVIDER: 'provider';
    readonly DEMO: 'demo';
    readonly EXCLUDED: 'excluded';
  };
  readonly RULES: readonly { id: string; tiers: readonly string[] }[];
  readonly DECLARED_DEMO_FILES: readonly string[];
  readonly DECLARED_PREVIEW_FIXTURE_FILES: readonly string[];
  classifyPath(relPath: string): string;
  scanSource(relPath: string, source: string): GateFinding[];
  runGate(cwd?: string): { files: string[]; findings: GateFinding[]; tierCounts: Record<string, number> };
}

/**
 * scripts/ is deliberately plain JavaScript and is not part of the TypeScript
 * program, so the module is loaded through a variable specifier and typed here
 * instead of widening tsconfig with allowJs for one script.
 */
const gateSpec = GATE_URL.href;
const {
  DECLARED_DEMO_FILES,
  DECLARED_PREVIEW_FIXTURE_FILES,
  RULES,
  TIERS,
  classifyPath,
  runGate,
  scanSource,
} = (await import(gateSpec)) as GateModule;

/** rule ids the gate is expected to know; guards against silently deleting a rule. */
const EXPECTED_RULE_IDS = [
  'demo-persona',
  'ait-id-namespace',
  'legacy-demo-token',
  'demo-brand',
  'demo-flight-code',
  'demo-geo',
  'scenario-switch',
  'demo-fixture-ref',
];

/**
 * tsconfig sets noUncheckedIndexedAccess, so `findings[0]` is
 * `GateFinding | undefined`. Assert the expectation once and return it narrowed
 * rather than littering the tests with non-null assertions.
 */
function onlyFinding(findings: GateFinding[], what: string): GateFinding {
  assert.equal(findings.length, 1, `expected exactly one finding for ${what}, got ${findings.length}`);
  const first = findings[0];
  assert.ok(first, `missing expected finding for ${what}`);
  return first;
}

// ---------------------------------------------------------------------------
// 1. Detection: a planted demo fact must not pass
// ---------------------------------------------------------------------------

test('gate detects a planted hero persona in strict domain code', () => {
  const findings = scanSource(
    'src/engine/recovery.ts',
    "export function pick(name: string) {\n  if (name === 'Jordan Hale') return true;\n  return false;\n}\n",
  );
  assert.ok(findings.length > 0, 'Jordan Hale in generic engine code must be reported');
  const first = onlyFinding(findings, 'Jordan Hale in engine code');
  assert.equal(first.rule, 'demo-persona');
  assert.equal(first.tier, TIERS.STRICT);
  assert.equal(first.line, 2, 'reported line number must point at the real source line');
});

test('gate detects every hero persona name from the demo roster', () => {
  for (const name of ['Jordan Hale', 'Sarah Lim', 'Jonas Berg', 'Oliver Bennett']) {
    const findings = scanSource('src/domain/trip.ts', `const label = "${name}";\n`);
    assert.equal(findings.length, 1, `${name} must be reported exactly once`);
    assert.equal(onlyFinding(findings, name).rule, 'demo-persona');
  }
});

test('gate detects an AiT id namespace in unquoted substrings, not just literals', () => {
  const findings = scanSource('src/ingest/normalize.ts', 'const id = buildId("evt-ait-2026", traveller);\n');
  assert.ok(findings.some((f) => f.rule === 'ait-id-namespace'));

  // No quotes at all around the fragment: the previous gate only matched
  // exactly-quoted literals, so this is the class of defect that shipped.
  const bare = scanSource('src/app/presentation.ts', "if (actor.includes('ait')) return team;\n");
  assert.ok(
    bare.some((f) => f.rule === 'ait-id-namespace'),
    'a lower-case ait id fragment inside a substring test must be reported',
  );
});

test('gate detects demo brand, corridor geography and scenario switches in app code', () => {
  const brand = scanSource('src/app/presentation.ts', "if (id.includes('ZIPAIR')) return 'ZIPAIR';\n");
  assert.ok(brand.some((f) => f.rule === 'demo-brand'));

  const geo = scanSource('src/app/copy.ts', "if (origin === 'SIN' && dest === 'Tokyo') return true;\n");
  assert.ok(geo.some((f) => f.rule === 'demo-geo'));

  const venue = scanSource('src/engine/buffers.ts', "const place = 'Marina Bay';\n");
  assert.ok(venue.some((f) => f.rule === 'demo-geo'));

  const flight = scanSource('src/app/readmodels.ts', 'return carrier + "ZG023";\n');
  assert.ok(flight.some((f) => f.rule === 'demo-flight-code'));

  const sw = scanSource('src/engine/planner.ts', "if (scenarioId === 'S1') return fastPlan();\n");
  assert.ok(sw.some((f) => f.rule === 'scenario-switch'));

  const fixture = scanSource(
    'src/app/bootstrap.ts',
    "const manifest = 'fixtures/acceptance/manifests/s1-airline-schedule-change.json';\n",
  );
  assert.ok(fixture.some((f) => f.rule === 'demo-fixture-ref'));
});

test('gate still catches the legacy tokens it caught before', () => {
  const probes: ReadonlyArray<readonly [string, string]> = [
    ['src/domain/elements.ts', "const a = 'Meridian';\n"],
    ['src/domain/elements.ts', "const b = 'Wanderpay';\n"],
    ['src/engine/graph.ts', "const c = 'trip_a';\n"],
    ['src/operational/case.ts', "const d = 'anchor-event-speaker';\n"],
  ];
  for (const [path, source] of probes) {
    assert.ok(scanSource(path, source).length > 0, `${source.trim()} must not pass the gate`);
  }
});

test('persona names are forbidden inside provider adapters too', () => {
  // A provider adapter must not know who the demo travellers are.
  const findings = scanSource('src/providers/atlas/normalize.ts', 'const pax = ["Sarah Lim"];\n');
  assert.ok(findings.some((f) => f.rule === 'demo-persona'));
});

// ---------------------------------------------------------------------------
// 2. Allowlists: legitimate references must stay legal
// ---------------------------------------------------------------------------

test('provider sandbox hostnames and wire field names do not violate', () => {
  const source = [
    "export const ATLAS_SANDBOX_HOST = 'sandbox.atriptech.com';",
    "export const ATLAS_SANDBOX_BALANCE_PAYMENT_REF = 'atlas-sandbox-balance';",
    "const url = `https://${ATLAS_SANDBOX_HOST}/api/flight/search`;",
    "const flightNumber = raw['flight_no']; // sandbox returns ZG023 for carrier ZG",
    "const zone = 'Asia/Singapore';",
    "const hotel = 'Concorde Hotel Singapore';",
    '',
  ].join('\n');
  assert.deepEqual(scanSource('src/providers/atlas/transactionAdapter.ts', source), []);
});

test('IANA timezone ids stay allowed without exempting the rest of the line', () => {
  assert.deepEqual(scanSource('src/domain/trip.ts', "const tz = 'Asia/Singapore';\n"), []);
  assert.deepEqual(scanSource('src/domain/trip.ts', "return { zone: 'Asia/Tokyo' };\n"), []);
  assert.deepEqual(scanSource('src/domain/trip.ts', "return zone === 'Europe/London';\n"), []);

  // The old gate skipped the whole line, hiding real violations. Masking is
  // token-local, so the demo fact sharing the line is still reported.
  const mixed = scanSource('src/domain/trip.ts', "const tz = 'Asia/Singapore'; const label = 'Singapore';\n");
  assert.equal(onlyFinding(mixed, 'Singapore literal beside an IANA zone').rule, 'demo-geo');
});

test('comments naming a demo fact stay legal, code does not', () => {
  const commented = scanSource(
    'src/app/presentation.ts',
    ['// The sandbox returns ZG023 for carrier ZG.', '/** ZIPAIR and Scoot are demo carriers. */', 'export const x = 1;', ''].join(
      '\n',
    ),
  );
  assert.deepEqual(commented, []);

  const live = scanSource('src/app/presentation.ts', '// ZG023\nconst carrier = "ZG023";\n');
  assert.equal(onlyFinding(live, 'ZG023 in code below a comment').line, 2);
});

test('comment stripping does not mistake a URL for a comment', () => {
  const findings = scanSource('src/app/page.ts', "const link = '<a href=\"https://example.com/x\">ZIPAIR</a>';\n");
  assert.ok(
    findings.some((f) => f.rule === 'demo-brand'),
    'the // inside a string literal must not swallow the rest of the line',
  );
});

test('declared demo-bootstrap and preview-fixture modules are exempt', () => {
  const demoSource = "const hero = 'Jordan Hale'; const p = 'fixtures/acceptance/manifests/s1.json';\n";
  for (const path of [...DECLARED_DEMO_FILES, ...DECLARED_PREVIEW_FIXTURE_FILES]) {
    assert.equal(classifyPath(path), TIERS.DEMO, `${path} must classify as the declared demo tier`);
    assert.deepEqual(scanSource(path, demoSource), [], `${path} is allowlisted`);
  }
});

test('unknown src directories fail closed to the strict tier', () => {
  assert.equal(classifyPath('src/something-new/thing.ts'), TIERS.STRICT);
  assert.equal(classifyPath('src/main.ts'), TIERS.APP);
  assert.equal(classifyPath('src/acceptance/runner.ts'), TIERS.APP);
  assert.equal(classifyPath('docs/notes.ts'), TIERS.EXCLUDED);
  // The exemption is per file, not per directory: a neighbour of a demo module
  // is still scanned.
  assert.equal(classifyPath('src/app/readmodels.ts'), TIERS.APP);
  assert.ok(scanSource('src/app/readmodels.ts', "const id = 'cmt-ait-d1-headline-interview';\n").length > 0);
});

// ---------------------------------------------------------------------------
// 3. The real repository
// ---------------------------------------------------------------------------

/**
 * REVIEWED EXCEPTION SET — genuine demo facts currently living in generic
 * application code, keyed file#rule so it does not break when a neighbouring
 * agent shifts a line number.
 *
 * This is a ratchet that may only SHRINK. Every entry is a real finding waiting
 * for its fix, not an approved pattern: adding a file here is a review decision,
 * and deleting one is progress. Fixing a violation means removing the entry from
 * `presentation.ts`-style generic code, never adding a new exemption below.
 */
const ACCEPTED_DEMO_CONTAMINATION = [
  'src/acceptance/preflight.ts#ait-id-namespace',
  'src/app/presentation.ts#ait-id-namespace',
  'src/app/presentation.ts#demo-brand',
  'src/app/presentation.ts#demo-geo',
  'src/app/readmodels.ts#ait-id-namespace',
  'src/app/travellerPresentation.ts#demo-fixture-ref',
  'src/app/travellerPresentation.ts#demo-geo',
  'src/server/http.ts#demo-fixture-ref',
  'src/ui/page.ts#ait-id-namespace',
];

test('the real src tree scans far more than the old five roots', () => {
  const { files, tierCounts } = runGate(REPO_ROOT);
  const strict = tierCounts[TIERS.STRICT] ?? 0;
  const provider = tierCounts[TIERS.PROVIDER] ?? 0;
  assert.ok(files.length >= 175, `expected the whole src tree, scanned ${files.length} files`);
  assert.ok(strict > 70, `strict tier must be covered, got ${strict}`);
  assert.ok(provider > 10, `provider tier must be covered, got ${provider}`);
  assert.ok(files.includes('src/main.ts'), 'loose entrypoints are scanned');
  assert.ok(files.includes('src/ui/fixtures/readmodels.ts'), 'fixture dirs are scanned, not skipped');
});

test('strict and provider tiers are genuinely free of demo facts', () => {
  const { findings } = runGate(REPO_ROOT);
  assert.deepEqual(
    findings.filter((f) => f.tier === TIERS.STRICT),
    [],
    'domain/engine/contracts/ingest/persistence/config must carry no demo facts',
  );
  assert.deepEqual(
    findings.filter((f) => f.tier === TIERS.PROVIDER),
    [],
    'provider adapters may hold provider constants but no demo persona or AiT ids',
  );
});

test('the live verdict stays inside the reviewed exception set (shrink-only ratchet)', () => {
  const { findings } = runGate(REPO_ROOT);
  const actual = [...new Set(findings.map((f) => `${f.file}#${f.rule}`))].sort();
  const unreviewed = actual.filter((key) => !ACCEPTED_DEMO_CONTAMINATION.includes(key));
  assert.deepEqual(
    unreviewed,
    [],
    `new demo contamination in generic code, not yet reviewed: ${unreviewed.join(', ')}`,
  );

  // Exception-list hygiene. Fixing a violation means deleting its entry here; the
  // ratchet deliberately does not go red just because a neighbour already fixed
  // one, or their in-flight work would be blocked on my file.
  assert.equal(
    new Set(ACCEPTED_DEMO_CONTAMINATION).size,
    ACCEPTED_DEMO_CONTAMINATION.length,
    'the exception list contains a duplicate entry',
  );
  const registered = new Set(RULES.map((rule) => rule.id));
  for (const key of ACCEPTED_DEMO_CONTAMINATION) {
    const ruleId = key.split('#')[1];
    assert.ok(ruleId && registered.has(ruleId), `exception ${key} cites an unknown rule`);
  }
});

test('every rule is registered and none drifts out of the contract', () => {
  const registered = RULES.map((rule) => rule.id);
  assert.deepEqual(
    [...registered].sort(),
    [...EXPECTED_RULE_IDS].sort(),
    'the rule set changed — update this test deliberately, never silently',
  );
  const { findings } = runGate(REPO_ROOT);
  for (const finding of findings) {
    assert.ok(registered.includes(finding.rule), `finding cites unknown rule ${finding.rule}`);
  }
});

/**
 * Each rule gets one planted probe. The live tree never triggers several of them
 * (that is the point — they are waiting for a regression), so this is the only
 * thing that stops a rule from quietly rotting into dead code.
 */
const RULE_PROBES: Record<string, readonly [string, string]> = {
  'demo-persona': ['src/domain/trip.ts', "const who = 'Jordan Hale';\n"],
  'ait-id-namespace': ['src/ingest/normalize.ts', 'const id = "evt-ait-2026";\n'],
  'legacy-demo-token': ['src/domain/elements.ts', "const org = 'Meridian';\n"],
  'demo-brand': ['src/app/copy.ts', "if (name.includes('ZIPAIR')) return name;\n"],
  'demo-flight-code': ['src/app/readmodels.ts', 'return carrier + "ZG023";\n'],
  'demo-geo': ['src/engine/buffers.ts', "const place = 'Marina Bay';\n"],
  'scenario-switch': ['src/engine/planner.ts', "if (scenarioId === 'S1') return fastPlan();\n"],
  'demo-fixture-ref': ['src/app/bootstrap.ts', "const p = 'ait-demo-input-pack/global/roster.json';\n"],
};

test('every rule actually fires against a planted violation', () => {
  assert.deepEqual(Object.keys(RULE_PROBES).sort(), [...EXPECTED_RULE_IDS].sort());
  for (const [ruleId, [path, source]] of Object.entries(RULE_PROBES)) {
    const findings = scanSource(path, source);
    assert.ok(
      findings.some((f) => f.rule === ruleId),
      `rule ${ruleId} did not fire for ${source.trim()} — it is dead code`,
    );
  }
});

// ---------------------------------------------------------------------------
// 4. CLI contract
// ---------------------------------------------------------------------------

test('CLI exits non-zero with a VERDICT line when the tree has findings', () => {
  const run = spawnSync(process.execPath, [GATE_SCRIPT], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.match(run.stdout, /^VERDICT: FINDINGS — \d+ hit\(s\)$/m);
  assert.equal(run.status, 1);
  assert.match(run.stdout, /src\/app\/presentation\.ts:\d+ \[tier=app\]/);
});

test('CLI exits 0 with VERDICT CLEAN on a clean tree', () => {
  const root = mkdtempSync(join(tmpdir(), 'northstar-gate-'));
  mkdirSync(join(root, 'src', 'domain'), { recursive: true });
  writeFileSync(
    join(root, 'src', 'domain', 'trip.ts'),
    "export const zone = 'Asia/Singapore'; // the demo world is not hardcoded here\n",
  );
  const run = spawnSync(process.execPath, [GATE_SCRIPT], { cwd: root, encoding: 'utf8' });
  assert.match(run.stdout, /^VERDICT: CLEAN/m);
  assert.equal(run.status, 0, run.stdout + run.stderr);
});

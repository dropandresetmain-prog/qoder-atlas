/**
 * Validation gate for data/ait-demo-input-pack.
 *
 * Data/research milestone checks only — this script never touches src/**.
 * Run: node scripts/validate-ait-demo-inputs.mjs
 *
 * Checks:
 *  1. Every .json file under data/ait-demo-input-pack parses.
 *  2. Every object carries a `provenance` label from the allowed taxonomy,
 *     or lives inside sources/public-web (recorded PUBLIC_WEB normalization).
 *  3. Roster counts: 67 total, 42 NORTHSTAR_ARRANGED, 25 SELF_OR_OTHER_ARRANGED.
 *  4. Every traveller draft parses against ProgrammeTravellerDraftSchema and
 *     the batch against ProgrammeImportDraftSchema (repo contract, read-only).
 *  5. Every anchorCommitmentId referenced by a draft exists in the programme.
 *  6. Every scenario pack s1..s8 exists and declares provenance + sourceIds.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const PACK = join(ROOT, 'data', 'ait-demo-input-pack');

const TAXONOMY = new Set([
  'PUBLIC_WEB',
  'ORGANISER_SUPPLIED_SYNTHETIC',
  'TRAVELLER_SUPPLIED_SYNTHETIC',
  'PROVIDER_LIVE',
  'NATIVE_UI',
  'SIMULATED_EXTERNAL_EVENT',
]);

const problems = [];
const jsonFiles = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.json')) jsonFiles.push(p);
  }
}
walk(PACK);

// 1. parse
const parsed = new Map();
for (const f of jsonFiles) {
  try {
    parsed.set(f, JSON.parse(readFileSync(f, 'utf8')));
  } catch (err) {
    problems.push(`JSON parse failure: ${relative(ROOT, f)} — ${err.message}`);
  }
}

// 2. provenance labels (skip the registry itself; public-web files carry top-level provenance)
for (const [f, doc] of parsed) {
  if (f.endsWith('source-registry.json')) continue;
  const rel = relative(PACK, f);
  if (typeof doc?.provenance !== 'string') {
    problems.push(`missing provenance: ${rel}`);
  } else if (!TAXONOMY.has(doc.provenance)) {
    problems.push(`unknown provenance label '${doc.provenance}': ${rel}`);
  }
}

// 3. roster counts
const rosterFile = join(PACK, 'global', 'roster.json');
if (parsed.has(rosterFile)) {
  const roster = parsed.get(rosterFile);
  const travellers = roster.importDraft?.travellers ?? [];
  const total = travellers.length;
  const arranged = travellers.filter((t) => t.travelArrangement === 'NORTHSTAR_ARRANGED').length;
  const self = travellers.filter((t) => t.travelArrangement === 'SELF_OR_OTHER_ARRANGED').length;
  if (total !== 67) problems.push(`roster total ${total} != 67`);
  if (arranged !== 42) problems.push(`NORTHSTAR_ARRANGED ${arranged} != 42`);
  if (self !== 25) problems.push(`SELF_OR_OTHER_ARRANGED ${self} != 25`);

  // 4. contract validation (repo schemas, read-only import)
  try {
    const { ProgrammeImportDraftSchema } = await import(join(ROOT, 'src', 'contracts', 'programmeIntake.ts'));
    const result = ProgrammeImportDraftSchema.safeParse(roster.importDraft);
    if (!result.success) {
      for (const issue of result.error.issues.slice(0, 10)) {
        problems.push(`ProgrammeImportDraftSchema: ${issue.path.join('.')} — ${issue.message}`);
      }
    }
  } catch (err) {
    problems.push(`contract import failed (run with a TS-capable runner?): ${err.message}`);
  }

  // 5. commitment references resolve
  const programmeFile = join(PACK, 'global', 'programme.json');
  if (parsed.has(programmeFile)) {
    const commitments = parsed.get(programmeFile).anchorEvent?.commitments ?? [];
    const known = new Set(commitments.map((c) => c.id));
    for (const t of travellers) {
      for (const cmtId of t.anchorCommitmentIds ?? []) {
        if (!known.has(cmtId)) problems.push(`draft ${t.draftId}: unknown commitment ${cmtId}`);
      }
    }
  }
}

// 6. scenario packs
const scenarios = [
  's1-supplier-disruption',
  's2-missed-connection',
  's3-event-change-preview',
  's4-thursday-arrival',
  's5-sunday-extension',
  's6-hotel-partner',
  's7-tokyo-origin',
  's8-speaker-group-travel',
];
for (const s of scenarios) {
  const scenarioFile = join(PACK, 'scenarios', s, 'scenario.json');
  if (!parsed.has(scenarioFile)) {
    problems.push(`missing scenario pack: scenarios/${s}/scenario.json`);
    continue;
  }
  const doc = parsed.get(scenarioFile);
  if (!Array.isArray(doc.sourceIds) || doc.sourceIds.length === 0) {
    problems.push(`scenarios/${s}/scenario.json: missing sourceIds`);
  }
}

if (problems.length > 0) {
  console.error(`FAIL — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`OK — ${jsonFiles.length} JSON files under data/ait-demo-input-pack validated.`);

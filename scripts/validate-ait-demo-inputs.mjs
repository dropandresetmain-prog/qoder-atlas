/**
 * Validation gate for data/ait-demo-input-pack.
 *
 * Data/research milestone checks only — this script never touches src/**.
 * Run: node --experimental-strip-types scripts/validate-ait-demo-inputs.mjs
 *
 * Checks:
 *  1. Every .json file under data/ait-demo-input-pack parses.
 *  2. Every object carries a `provenance` label from the allowed taxonomy,
 *     or lives inside sources/public-web (recorded PUBLIC_WEB normalization).
 *  3. Roster counts: 67 total, 42 NORTHSTAR_ARRANGED, 25 SELF_OR_OTHER_ARRANGED.
 *  4. Every traveller draft parses against ProgrammeTravellerDraftSchema and
 *     the batch against ProgrammeImportDraftSchema; anchor-event.json against
 *     AnchorEventSchema and places.json against PlaceSchema (repo contracts,
 *     read-only).
 *  5. Every anchorCommitmentId referenced by a draft exists in anchor-event.json.
 *  6. Every scenario pack s1..s8 exists, declares provenance + sourceIds, and
 *     every listed input file exists, parses, carries a taxonomy provenance
 *     label and non-empty sourceIds.
 *  7. Role assignments in programme.json reference known drafts and commitments.
 *  8. organiser-policy.json ruleSets parse against RuleSetSchema (src/domain/rules.ts).
 *  9. programme-importance.json entries resolve to known drafts/commitments with
 *     importance/flexibility values from the repo enums (src/domain/elements.ts).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

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
const anchorEventFile = join(PACK, 'global', 'anchor-event.json');
const placesFile = join(PACK, 'global', 'places.json');
const programmeFile = join(PACK, 'global', 'programme.json');
const policyFile = join(PACK, 'global', 'organiser-policy.json');
const importanceFile = join(PACK, 'global', 'programme-importance.json');

// 4a. schema validation of global artifacts (repo schemas, read-only import)
let schemas;
try {
  const [intake, entities, rules, elements] = await Promise.all([
    import(pathToFileURL(join(ROOT, 'src', 'contracts', 'programmeIntake.ts'))),
    import(pathToFileURL(join(ROOT, 'src', 'domain', 'entities.ts'))),
    import(pathToFileURL(join(ROOT, 'src', 'domain', 'rules.ts'))),
    import(pathToFileURL(join(ROOT, 'src', 'domain', 'elements.ts'))),
  ]);
  schemas = { ...intake, ...entities, ...rules, ...elements };
} catch (err) {
  problems.push(`contract import failed (run via: node --experimental-strip-types): ${err.message}`);
}

function schemaCheck(fileName, label, schemaKey, jsonPath, pick = (doc) => doc) {
  if (!schemas || !parsed.has(jsonPath)) return undefined;
  const result = schemas[schemaKey].safeParse(pick(parsed.get(jsonPath)));
  if (!result.success) {
    for (const issue of result.error.issues.slice(0, 10)) {
      problems.push(`${fileName} ${label}: ${issue.path.join('.')} — ${issue.message}`);
    }
    return undefined;
  }
  return result.data;
}

const anchorEvent = schemaCheck(
  'anchor-event.json',
  'AnchorEventSchema',
  'AnchorEventSchema',
  anchorEventFile,
  (doc) => doc.anchorEvent,
);
if (schemas && parsed.has(placesFile)) {
  const placeSchema = schemas.PlaceSchema;
  for (const place of parsed.get(placesFile).places ?? []) {
    const result = placeSchema.safeParse(place);
    if (!result.success) {
      for (const issue of result.error.issues.slice(0, 5)) {
        problems.push(`places.json ${place.id ?? '?'}: ${issue.path.join('.')} — ${issue.message}`);
      }
    }
  }
}

if (parsed.has(rosterFile)) {
  const roster = parsed.get(rosterFile);
  const travellers = roster.importDraft?.travellers ?? [];
  const total = travellers.length;
  const arranged = travellers.filter((t) => t.travelArrangement === 'NORTHSTAR_ARRANGED').length;
  const self = travellers.filter((t) => t.travelArrangement === 'SELF_OR_OTHER_ARRANGED').length;
  if (total !== 67) problems.push(`roster total ${total} != 67`);
  if (arranged !== 42) problems.push(`NORTHSTAR_ARRANGED ${arranged} != 42`);
  if (self !== 25) problems.push(`SELF_OR_OTHER_ARRANGED ${self} != 25`);

  // 4b. contract validation of the import batch (repo schemas, read-only)
  if (schemas) {
    const result = schemas.ProgrammeImportDraftSchema.safeParse(roster.importDraft);
    if (!result.success) {
      for (const issue of result.error.issues.slice(0, 10)) {
        problems.push(`roster.json ProgrammeImportDraftSchema: ${issue.path.join('.')} — ${issue.message}`);
      }
    }
  }

  // 5. commitment references resolve
  if (anchorEvent) {
    const known = new Set(anchorEvent.commitments.map((c) => c.id));
    for (const t of travellers) {
      for (const cmtId of t.anchorCommitmentIds ?? []) {
        if (!known.has(cmtId)) problems.push(`draft ${t.draftId}: unknown commitment ${cmtId}`);
      }
    }
  }

  // 7. programme role assignments resolve against roster + commitments
  if (parsed.has(programmeFile) && anchorEvent) {
    const programme = parsed.get(programmeFile);
    const commitmentIds = new Set(anchorEvent.commitments.map((c) => c.id));
    const draftIds = new Set(travellers.map((t) => t.draftId));
    for (const assignment of programme.roleAssignments ?? []) {
      if (!commitmentIds.has(assignment.commitmentId)) {
        problems.push(`programme.json roleAssignment: unknown commitment ${assignment.commitmentId}`);
      }
      for (const d of assignment.draftIds ?? []) {
        if (!draftIds.has(d)) problems.push(`programme.json roleAssignment: unknown draft ${d}`);
      }
    }
    for (const day of programme.days ?? []) {
      for (const session of day.sessions ?? []) {
        if (!commitmentIds.has(session.commitmentId)) {
          problems.push(`programme.json schedule: unknown commitment ${session.commitmentId}`);
        }
      }
    }
  }

  // 9. programme-importance entries resolve with valid repo enum values
  if (parsed.has(importanceFile) && anchorEvent) {
    const importance = parsed.get(importanceFile);
    const commitmentIds = new Set(anchorEvent.commitments.map((c) => c.id));
    const draftIds = new Set(travellers.map((t) => t.draftId));
    const entries = [...(importance.entries ?? []), ...(importance.blanketEntries ?? [])];
    for (const entry of entries) {
      if (entry.draftId && !draftIds.has(entry.draftId)) {
        problems.push(`programme-importance.json: unknown draft ${entry.draftId}`);
      }
      if (entry.commitmentId && !commitmentIds.has(entry.commitmentId)) {
        problems.push(`programme-importance.json: unknown commitment ${entry.commitmentId}`);
      }
      if (schemas) {
        if (!schemas.ImportanceSchema.safeParse(entry.importance).success) {
          problems.push(`programme-importance.json ${entry.draftId}/${entry.commitmentId}: bad importance '${entry.importance}'`);
        }
        if (!schemas.FlexibilitySchema.safeParse(entry.flexibility).success) {
          problems.push(`programme-importance.json ${entry.draftId}/${entry.commitmentId}: bad flexibility '${entry.flexibility}'`);
        }
      }
    }
  }
}

// 8. organiser policy ruleSets parse against RuleSetSchema
if (schemas && parsed.has(policyFile)) {
  for (const ruleSet of parsed.get(policyFile).ruleSets ?? []) {
    const result = schemas.RuleSetSchema.safeParse(ruleSet);
    if (!result.success) {
      for (const issue of result.error.issues.slice(0, 10)) {
        problems.push(`organiser-policy.json ${ruleSet.id ?? '?'} RuleSetSchema: ${issue.path.join('.')} — ${issue.message}`);
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
  for (const input of doc.inputs ?? []) {
    const inputFile = join(PACK, 'scenarios', s, input.file);
    if (!parsed.has(inputFile)) {
      problems.push(`scenarios/${s}: listed input missing on disk: ${input.file}`);
      continue;
    }
    const inputDoc = parsed.get(inputFile);
    if (typeof inputDoc?.provenance !== 'string' || !TAXONOMY.has(inputDoc.provenance)) {
      problems.push(`scenarios/${s}/${input.file}: bad or missing provenance label`);
    }
    if (!Array.isArray(inputDoc?.sourceIds) || inputDoc.sourceIds.length === 0) {
      problems.push(`scenarios/${s}/${input.file}: missing sourceIds`);
    }
    if (input.provenance && input.provenance !== inputDoc?.provenance) {
      problems.push(`scenarios/${s}/${input.file}: manifest provenance '${input.provenance}' != file provenance '${inputDoc?.provenance}'`);
    }
  }
}

if (problems.length > 0) {
  console.error(`FAIL — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`OK — ${jsonFiles.length} JSON files under data/ait-demo-input-pack validated.`);

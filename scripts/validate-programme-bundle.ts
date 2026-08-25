/**
 * Validate a generated programme bundle against the frozen ProgrammeBundle
 * schema (the exact contract seedProgrammeBundle enforces). Usage:
 *   node --experimental-strip-types scripts/validate-programme-bundle.ts [path]
 */
import { readFileSync } from 'node:fs';
import { ProgrammeBundleSchema } from '../src/app/programmeSeed.ts';

const path = process.argv[2] ?? 'fixtures/programmes/ait-summit-2026/programme.json';
const parsed = ProgrammeBundleSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
if (!parsed.success) {
  console.error(`bundle INVALID: ${path}`);
  for (const issue of parsed.error.issues.slice(0, 20)) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}
console.log(
  `bundle valid: ${parsed.data.importDraft.anchorEventId}, ` +
    `${parsed.data.importDraft.travellers.length} travellers, ` +
    `${(parsed.data.context.places ?? []).length} places, ` +
    `${(parsed.data.context.ruleSets ?? []).length} rule sets`,
);

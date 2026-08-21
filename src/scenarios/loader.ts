/**
 * F3 — scenario bundle loader. Reads `scenario.json` from a scenario
 * directory, validates it against the generic ScenarioSpec contract, and
 * enforces referential integrity. Scenario-neutral code.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { ScenarioSpecSchema, validateScenarioReferences, type ScenarioSpec } from './spec.ts';

export class ScenarioLoadError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[] = []) {
    super(message);
    this.name = 'ScenarioLoadError';
    this.issues = issues;
  }
}

/** Load and validate one scenario bundle from its directory. */
export function loadScenario(scenarioDir: string): ScenarioSpec {
  const scenarioPath = join(scenarioDir, 'scenario.json');
  if (!existsSync(scenarioPath)) {
    throw new ScenarioLoadError(`scenario.json not found in ${scenarioDir}`);
  }
  const raw = readFileSync(scenarioPath, 'utf8');
  const parsed = ScenarioSpecSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`,
    );
    throw new ScenarioLoadError(`scenario schema validation failed for ${scenarioDir}`, issues);
  }
  const violations = validateScenarioReferences(parsed.data);
  if (violations.length > 0) {
    throw new ScenarioLoadError(`scenario referential integrity failed for ${scenarioDir}`, violations);
  }
  return parsed.data;
}

/** Resolve the absolute path of a source content file referenced by contentRef. */
export function sourceContentPath(scenarioDir: string, contentRef: string): string {
  return resolve(isAbsolute(contentRef) ? contentRef : join(scenarioDir, contentRef));
}

/** Verify every source with a contentRef has an existing file on disk. */
export function missingSourceFiles(scenarioDir: string, spec: ScenarioSpec): string[] {
  const missing: string[] = [];
  for (const source of spec.context.sources) {
    if (source.contentRef && !existsSync(sourceContentPath(scenarioDir, source.contentRef))) {
      missing.push(`${source.id}: ${source.contentRef}`);
    }
  }
  return missing;
}

/** List scenario directories under a fixtures root (directories containing scenario.json). */
export function listScenarioDirs(fixturesRoot: string): string[] {
  if (!existsSync(fixturesRoot)) return [];
  return readdirSync(fixturesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(fixturesRoot, entry.name))
    .filter((dir) => existsSync(join(dir, 'scenario.json')));
}

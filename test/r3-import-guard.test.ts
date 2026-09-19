/**
 * R3 — static import guard ensuring the legacy proposeRecoveryStrategies seam
 * stays retired from the product HTTP path.
 *
 * Reads source files with node:fs and asserts:
 *   1. targetHttpHandlers.ts does NOT import proposeRecoveryStrategies
 *   2. targetHttpHandlers.ts DOES reference runtimeHooks?.planner / planCaseDetailed
 *   3. composeTargetBoot.ts calls createRecoveryPlanningCoordinator exactly once
 *      and exposes it in runtimeHooks
 *   4. no file under src/app/target/ except recoveryPlanning.ts itself
 *      exports/imports proposeRecoveryStrategies (recoveryPlanning.ts keeps
 *      advanceCasePhase which is still live in recoveryApproval.ts +
 *      recoveryPlanningCoordinator.ts — that import is allowed)
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

function readSource(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

function walkFiles(dir: string, predicate: (path: string) => boolean): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...walkFiles(fullPath, predicate));
    } else if (predicate(fullPath)) {
      results.push(fullPath);
    }
  }
  return results;
}

describe('R3 import guard — legacy proposeRecoveryStrategies seam retired', () => {
  test('targetHttpHandlers.ts does NOT import proposeRecoveryStrategies', () => {
    const source = readSource('src/app/target/targetHttpHandlers.ts');
    assert.ok(
      !source.includes('proposeRecoveryStrategies'),
      'targetHttpHandlers.ts must not import or reference proposeRecoveryStrategies',
    );
  });

  test('targetHttpHandlers.ts DOES reference runtimeHooks?.planner and planCaseDetailed', () => {
    const source = readSource('src/app/target/targetHttpHandlers.ts');
    assert.ok(
      source.includes('runtimeHooks?.planner'),
      'targetHttpHandlers.ts must reference runtimeHooks?.planner',
    );
    assert.ok(
      source.includes('planCaseDetailed'),
      'targetHttpHandlers.ts must reference planCaseDetailed',
    );
  });

  test('composeTargetBoot.ts calls createRecoveryPlanningCoordinator exactly once', () => {
    const source = readSource('src/app/composeTargetBoot.ts');
    const matches = source.match(/createRecoveryPlanningCoordinator\s*\(/g);
    assert.ok(matches, 'composeTargetBoot.ts must call createRecoveryPlanningCoordinator');
    assert.equal(matches.length, 1, 'composeTargetBoot.ts must call createRecoveryPlanningCoordinator exactly once');
  });

  test('composeTargetBoot.ts exposes the planner in runtimeHooks', () => {
    const source = readSource('src/app/composeTargetBoot.ts');
    assert.ok(
      source.includes('runtimeHooks') && source.includes('planner'),
      'composeTargetBoot.ts must expose the planner in runtimeHooks',
    );
  });

  test('no file under src/app/target/ except recoveryPlanning.ts exports/imports proposeRecoveryStrategies', () => {
    const targetDir = join(ROOT, 'src/app/target');
    const tsFiles = walkFiles(targetDir, (path) => path.endsWith('.ts'));

    const violations: string[] = [];
    for (const file of tsFiles) {
      const relativePath = file.replaceAll('\\', '/').replace(ROOT.replaceAll('\\', '/') + '/', '');
      // recoveryPlanning.ts itself is allowed to define/proposeRecoveryStrategies
      if (relativePath === 'src/app/target/recoveryPlanning.ts') continue;

      const source = readFileSync(file, 'utf8');
      // Check for imports or exports of proposeRecoveryStrategies
      if (source.includes('proposeRecoveryStrategies')) {
        violations.push(relativePath);
      }
    }

    assert.equal(
      violations.length,
      0,
      `proposeRecoveryStrategies must not be imported/exported outside recoveryPlanning.ts. Violations: ${violations.join(', ')}`,
    );
  });

  test('recoveryPlanning.ts keeps advanceCasePhase which is still live', () => {
    const source = readSource('src/app/target/recoveryPlanning.ts');
    assert.ok(
      source.includes('advanceCasePhase'),
      'recoveryPlanning.ts must keep advanceCasePhase (still live in recoveryApproval.ts + recoveryPlanningCoordinator.ts)',
    );
  });

  test('recoveryApproval.ts and recoveryPlanningCoordinator.ts import advanceCasePhase from recoveryPlanning.ts', () => {
    const approvalSource = readSource('src/app/target/recoveryApproval.ts');
    const coordinatorSource = readSource('src/app/target/recoveryPlanningCoordinator.ts');

    assert.ok(
      approvalSource.includes('advanceCasePhase') && approvalSource.includes('recoveryPlanning'),
      'recoveryApproval.ts must import advanceCasePhase from recoveryPlanning.ts',
    );
    assert.ok(
      coordinatorSource.includes('advanceCasePhase') && coordinatorSource.includes('recoveryPlanning'),
      'recoveryPlanningCoordinator.ts must import advanceCasePhase from recoveryPlanning.ts',
    );
  });
});

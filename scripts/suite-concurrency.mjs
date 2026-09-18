/**
 * Suite-level Node test concurrency.
 *
 * CURRENT_TARGET (`current`) is no-DB / no-browser and may run with bounded
 * parallelism. PostgreSQL, migration, and historical legacy suites stay serial
 * until isolation and connection budgets are explicitly proven.
 */

export const DEFAULT_SUITE_CONCURRENCY = Object.freeze({
  current: 4,
  postgres: 1,
  migration: 1,
  legacy: 1,
});

export function extraArgsSpecifyConcurrency(args = []) {
  return args.some((arg) => arg === '--test-concurrency' || arg.startsWith('--test-concurrency='));
}

export function suiteTestConcurrency(suiteName) {
  return DEFAULT_SUITE_CONCURRENCY[suiteName] ?? 1;
}

/** `--test-concurrency=N`, or null when the caller already supplied one. */
export function resolveTestConcurrencyArg(suiteName, extraArgs = []) {
  if (extraArgsSpecifyConcurrency(extraArgs)) return null;
  return `--test-concurrency=${suiteTestConcurrency(suiteName)}`;
}

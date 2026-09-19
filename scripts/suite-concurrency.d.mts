export const DEFAULT_SUITE_CONCURRENCY: Readonly<{
  current: number;
  postgres: number;
  postgresFast: number;
  migration: number;
  legacy: number;
}>;

export function extraArgsSpecifyConcurrency(args?: string[]): boolean;
export function suiteTestConcurrency(suiteName: string): number;
export function resolveTestConcurrencyArg(suiteName: string, extraArgs?: string[]): string | null;

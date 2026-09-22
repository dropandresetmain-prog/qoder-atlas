/**
 * Mutable pool handle for demo clone handovers.
 *
 * Callers keep one object identity; Reset swaps the underlying PostgreSQL
 * database underneath so workers/planners that closed over the handle move
 * with the new working clone.
 */
import { createTargetPool, type Pool } from './pool.ts';
import type { PostgresTargetConfig } from './config.ts';

export interface SwappablePoolHandle {
  /** Stable identity used everywhere as the runtime Pool. */
  readonly pool: Pool;
  readonly databaseName: () => string;
  swapToDatabase(databaseName: string): Promise<{ previousDatabaseName: string; previousPool: Pool }>;
  end(): Promise<void>;
}

/**
 * Create a Pool proxy whose target database can be replaced. The returned
 * `pool` object identity never changes.
 */
export function createSwappablePool(config: PostgresTargetConfig, initialPool?: Pool): SwappablePoolHandle {
  let inner = initialPool ?? createTargetPool(config);
  let databaseName = config.database;
  const proxy = new Proxy({} as Pool, {
    get(_target, property, receiver) {
      if (property === 'then') return undefined;
      const value = Reflect.get(inner, property, receiver);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(inner) : value;
    },
    set(_target, property, value, receiver) {
      return Reflect.set(inner, property, value, receiver);
    },
  });

  return {
    pool: proxy,
    databaseName: () => databaseName,
    async swapToDatabase(nextDatabaseName: string) {
      if (nextDatabaseName === databaseName) {
        throw new Error(`refusing to swap onto the same database "${nextDatabaseName}"`);
      }
      const previousDatabaseName = databaseName;
      const previousPool = inner;
      const next = createTargetPool({ ...config, database: nextDatabaseName });
      await next.query('SELECT 1 AS ok');
      inner = next;
      databaseName = nextDatabaseName;
      return { previousDatabaseName, previousPool };
    },
    async end() {
      await inner.end();
    },
  };
}

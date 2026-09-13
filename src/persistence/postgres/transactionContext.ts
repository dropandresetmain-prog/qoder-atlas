/**
 * Exposes the PoolClient of the currently-open UnitOfWork transaction to
 * repository/domain-handler code without widening the frozen `UnitOfWork`
 * interface's `execute(envelope, fn)` callback signature (which only carries
 * `{ lockedHeads, expectedRevisions, expectedScopeGenerations }` per
 * `src/contracts/v2/command/unitOfWork.ts`). A handler running inside `fn`
 * calls `currentTransactionClient()` to get the same `PoolClient` the
 * enclosing `execute()` opened, so its own writes (typed rows, head advance,
 * change record, outbox) commit/rollback atomically with everything else.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { PoolClient } from 'pg';

const storage = new AsyncLocalStorage<PoolClient>();

export function runWithTransactionClient<T>(client: PoolClient, fn: () => Promise<T>): Promise<T> {
  return storage.run(client, fn);
}

export function currentTransactionClient(): PoolClient {
  const client = storage.getStore();
  if (!client) {
    throw new Error(
      'currentTransactionClient() called outside an active UnitOfWork.execute transaction',
    );
  }
  return client;
}

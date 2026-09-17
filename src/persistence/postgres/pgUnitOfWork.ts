/**
 * PostgreSQL `UnitOfWork` implementation (src/contracts/v2/command/unitOfWork.ts).
 *
 * Every command runs at SERIALIZABLE isolation with bounded whole-transaction
 * retry (docs/work/ACTIVE_TASK.md decisions #4-#5): this uniformly covers
 * both the simple expected-revision/row-lock case and the cross-root
 * predicate-invariant case the logical schema calls out separately (§11.1) —
 * a single mechanism, at some conservative throughput cost the M1 evidence
 * doc flags as a later tuning candidate, not a correctness gap.
 *
 * Order of operations inside one transaction, matching
 * DATA_STRUCTURE_LOGICAL_SCHEMA.md §11.1's numbered protocol:
 *   1. `pg_advisory_xact_lock` on (workspace, commandType, idempotencyKey) —
 *      the "claim" (nothing else with the same key can proceed concurrently).
 *   2. Idempotency lookup: REPLAY returns the original receipt without
 *      calling `fn`; HASH_MISMATCH conflicts without calling `fn`.
 *   3. Lock affected aggregate heads in stable order; validate expected
 *      revisions/scope generations.
 *   4. Call `fn` — the domain handler persists typed rows, advances heads,
 *      appends change_records/outbox, and returns a receipt.
 *   5. Insert the (immutable) command_receipts row; commit.
 */
import type { Pool, PoolClient } from 'pg';
import type {
  UnitOfWork,
  AggregateHeadReader,
  IdempotencyLedger,
  ScopeGenerationLedger,
} from '../../contracts/v2/command/unitOfWork.ts';
import {
  CommandReceiptSchema,
  parseCommandResult,
  type DomainCommandEnvelope,
  type CommandReceipt,
} from '../../contracts/v2/command/domainCommand.ts';
import { sameRef, type RootRevision, type ExpectedRevision, type ScopeGenerationRef, type TypedRef } from '../../domain/v2/shared/identity.ts';
import type { TypedConflict } from '../../domain/v2/shared/errors.ts';
import { typedConflict } from '../../domain/v2/shared/errors.ts';
import { PgAggregateHeadReader } from './pgAggregateHeadReader.ts';
import { PgIdempotencyLedger, insertCommandReceipt } from './pgIdempotencyLedger.ts';
import { PgScopeGenerationLedger } from './pgScopeGenerationLedger.ts';
import { runWithTransactionClient } from './transactionContext.ts';
import { idempotencyLockKey } from './advisoryLock.ts';

export const DEFAULT_MAX_SERIALIZATION_RETRIES = 3;

export type ExecuteOutcome<T> =
  | { ok: true; value: T; receipt: CommandReceipt }
  | { ok: false; conflict: TypedConflict };

export type ExecuteFn<T> = (ctx: {
  lockedHeads: RootRevision[];
  expectedRevisions: ExpectedRevision[];
  expectedScopeGenerations: ScopeGenerationRef[];
}) => Promise<ExecuteOutcome<T>>;

function isRetryableError(error: unknown): boolean {
  const code = (error as { code?: string } | undefined)?.code;
  return code === '40001' /* serialization_failure */ || code === '40P01' /* deadlock_detected */;
}

function dedupeRefs(refs: TypedRef[]): TypedRef[] {
  const seen = new Map<string, TypedRef>();
  for (const ref of refs) seen.set(`${ref.kind}:${ref.id}`, ref);
  return [...seen.values()];
}

export class PgUnitOfWork implements UnitOfWork {
  readonly heads: AggregateHeadReader;
  readonly idempotency: IdempotencyLedger;
  readonly scopes: ScopeGenerationLedger;

  private readonly pool: Pool;
  private readonly workspaceId: string;
  private readonly maxSerializationRetries: number;
  /**
   * R0 consequence provenance (migration 0124): when set, every transaction
   * this unit of work runs carries the transaction-local setting
   * `northstar.change_signal_id`, which `change_records` and the M6
   * reassessment-enqueue trigger record. Nothing else in the command
   * protocol changes; commands do not need to know they run under a signal.
   */
  private readonly changeSignalId: string | undefined;

  constructor(
    pool: Pool,
    workspaceId: string,
    maxSerializationRetries: number = DEFAULT_MAX_SERIALIZATION_RETRIES,
    options: { changeSignalId?: string } = {},
  ) {
    this.pool = pool;
    this.workspaceId = workspaceId;
    this.maxSerializationRetries = maxSerializationRetries;
    this.changeSignalId = options.changeSignalId;
    this.heads = new PgAggregateHeadReader(pool, workspaceId);
    this.idempotency = new PgIdempotencyLedger();
    this.scopes = new PgScopeGenerationLedger(workspaceId);
  }

  /** A unit of work whose commands execute as consequences of `changeSignalId` (see migration 0124). */
  underChangeSignal(changeSignalId: string): PgUnitOfWork {
    return new PgUnitOfWork(this.pool, this.workspaceId, this.maxSerializationRetries, { changeSignalId });
  }

  async execute<T>(envelope: DomainCommandEnvelope, fn: ExecuteFn<T>): Promise<ExecuteOutcome<T>> {
    if (envelope.workspaceId !== this.workspaceId) {
      return {
        ok: false,
        conflict: typedConflict(
          'VALIDATION_FAILED',
          `envelope.workspaceId ${envelope.workspaceId} does not match this UnitOfWork's bound workspace ${this.workspaceId}`,
        ),
      };
    }

    let attempt = 0;
    for (;;) {
      attempt++;
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        const outcome = await runWithTransactionClient(client, () => this.runBody(client, envelope, fn));
        if (outcome.ok) {
          await client.query('COMMIT');
        } else {
          await client.query('ROLLBACK');
        }
        return outcome;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        if (isRetryableError(error) && attempt < this.maxSerializationRetries) {
          continue;
        }
        if (isRetryableError(error)) {
          return {
            ok: false,
            conflict: typedConflict(
              'SERIALIZATION_RETRY_EXHAUSTED',
              `command could not commit after ${attempt} serializable transaction attempt(s); retry with fresh state`,
            ),
          };
        }
        throw error;
      } finally {
        client.release();
      }
    }
  }

  private async runBody<T>(
    client: PoolClient,
    envelope: DomainCommandEnvelope,
    fn: ExecuteFn<T>,
  ): Promise<ExecuteOutcome<T>> {
    const commandNamespace = envelope.commandType;
    if (this.changeSignalId !== undefined) {
      // Transaction-local (is_local = true): cleared at COMMIT/ROLLBACK, so a
      // pooled connection never leaks a signal into an unrelated command.
      await client.query("SELECT set_config('northstar.change_signal_id', $1, true)", [this.changeSignalId]);
    }
    await client.query('SELECT pg_advisory_xact_lock($1)', [
      idempotencyLockKey(envelope.workspaceId, commandNamespace, envelope.idempotencyKey).toString(),
    ]);

    const claim = await this.idempotency.claim(
      envelope.workspaceId,
      commandNamespace,
      envelope.idempotencyKey,
      envelope.canonicalPayloadHash,
    );
    if (claim.outcome === 'HASH_MISMATCH') {
      return {
        ok: false,
        conflict: typedConflict(
          'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH',
          `idempotency key ${envelope.idempotencyKey} was already used with a different payload`,
        ),
      };
    }
    if (claim.outcome === 'REPLAY') {
      return { ok: true, value: parseCommandResult(claim.receipt.resultRef) as T, receipt: claim.receipt };
    }

    const refs = dedupeRefs(envelope.expectedAggregateRevisions.map((r) => r.aggregateRef));
    const lockedHeads = await this.heads.lockHeads(refs);
    for (const expected of envelope.expectedAggregateRevisions) {
      const found = lockedHeads.find((h) => sameRef(h.aggregateRef, expected.aggregateRef));
      if (!found || found.revision !== expected.expectedRevision) {
        return {
          ok: false,
          conflict: typedConflict(
            'STALE_AGGREGATE_REVISION',
            `expected revision ${expected.expectedRevision} for ${expected.aggregateRef.kind}:${expected.aggregateRef.id}, found ${found?.revision ?? 'MISSING'}`,
            [expected.aggregateRef],
          ),
        };
      }
    }

    for (const expectedScope of envelope.expectedScopeGenerations) {
      const current = await this.scopes.currentGeneration(expectedScope);
      if (current !== expectedScope.generation) {
        return {
          ok: false,
          conflict: typedConflict(
            'SCOPE_GENERATION_MISMATCH',
            `expected generation ${expectedScope.generation} for scope ${expectedScope.scopeKind}:${expectedScope.scopeId}, found ${current}`,
          ),
        };
      }
    }

    const outcome = await fn({
      lockedHeads,
      expectedRevisions: envelope.expectedAggregateRevisions,
      expectedScopeGenerations: envelope.expectedScopeGenerations,
    });
    if (!outcome.ok) return outcome;

    const parsedReceipt = CommandReceiptSchema.safeParse(outcome.receipt);
    if (!parsedReceipt.success) {
      return {
        ok: false,
        conflict: typedConflict('VALIDATION_FAILED', 'command handler returned an invalid receipt'),
      };
    }
    const receipt = parsedReceipt.data;
    if (
      receipt.workspaceId !== envelope.workspaceId ||
      receipt.commandNamespace !== commandNamespace ||
      receipt.idempotencyKey !== envelope.idempotencyKey ||
      receipt.payloadHash !== envelope.canonicalPayloadHash
    ) {
      return {
        ok: false,
        conflict: typedConflict('VALIDATION_FAILED', 'command receipt does not match its command envelope'),
      };
    }

    await insertCommandReceipt(receipt);
    return { ok: true, value: outcome.value, receipt };
  }
}

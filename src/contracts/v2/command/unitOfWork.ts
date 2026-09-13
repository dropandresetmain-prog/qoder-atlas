/**
 * NORTHSTAR v2 — UnitOfWork boundary.
 *
 * DATA_STRUCTURE_LOGICAL_SCHEMA.md §11.1/§12. Domain handlers use this
 * interface instead of `save(anyEntity)` or direct SQL. All revision/scope
 * checks, idempotency, and outbox/audit writes happen inside one
 * short transaction. Behavioural contract only — M1 supplies the PostgreSQL
 * implementation; no runtime import happens during M0.
 */
import type { RootRevision, ExpectedRevision, ScopeGenerationRef, TypedRef } from '../../../domain/v2/shared/identity.ts';
import type { TypedConflict } from '../../../domain/v2/shared/errors.ts';
import type { DomainCommandEnvelope, CommandReceipt } from './domainCommand.ts';

export interface AggregateHeadReader {
  loadHead(ref: TypedRef): Promise<RootRevision | undefined>;
  /** Locks the given roots in a stable identity order to avoid deadlocks across concurrent commands. */
  lockHeads(refs: TypedRef[]): Promise<RootRevision[]>;
}

export interface IdempotencyLedger {
  /** Returns the committed receipt for an equal payload, or a conflict marker for a mismatched one. */
  claim(
    workspaceId: string,
    commandNamespace: string,
    idempotencyKey: string,
    payloadHash: string,
  ): Promise<{ outcome: 'NEW' } | { outcome: 'REPLAY'; receipt: CommandReceipt } | { outcome: 'HASH_MISMATCH' }>;
}

export interface ScopeGenerationLedger {
  currentGeneration(ref: Pick<ScopeGenerationRef, 'scopeKind' | 'scopeId'>): Promise<number>;
  /** Advances a scope's generation atomically within the enclosing transaction. */
  advance(ref: Pick<ScopeGenerationRef, 'scopeKind' | 'scopeId'>): Promise<number>;
}

export interface UnitOfWork {
  heads: AggregateHeadReader;
  idempotency: IdempotencyLedger;
  scopes: ScopeGenerationLedger;

  /**
   * Runs `fn` inside one short transaction. `fn` must validate expected
   * revisions/generations against the values passed here (already locked),
   * persist typed rows, advance every changed root exactly once, append
   * history/signal/outbox rows, and return either a receipt or a typed
   * conflict. The UnitOfWork commits on success and rolls back otherwise.
   */
  execute<T>(
    envelope: DomainCommandEnvelope,
    fn: (ctx: {
      lockedHeads: RootRevision[];
      expectedRevisions: ExpectedRevision[];
      expectedScopeGenerations: ScopeGenerationRef[];
    }) => Promise<{ ok: true; value: T; receipt: CommandReceipt } | { ok: false; conflict: TypedConflict }>,
  ): Promise<{ ok: true; value: T; receipt: CommandReceipt } | { ok: false; conflict: TypedConflict }>;
}

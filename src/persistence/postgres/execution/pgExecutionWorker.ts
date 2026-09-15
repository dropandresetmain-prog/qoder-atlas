/**
 * NORTHSTAR M8 — durable execution claim / unknown-outcome / reconciliation worker.
 *
 * External dispatch must have durable local attempt state BEFORE any network
 * call. Crash after DISPATCHING ⇒ OUTCOME_UNKNOWN ⇒ reconcile/lookup first.
 * Lease expiry never authorises blind retry.
 */
import { randomUUID } from 'node:crypto';
import type { Pool } from '../pool.ts';
import {
  canTransitionExecutionStatus,
  mayHaveBeenSent,
  type DurableExecutionStatus,
} from '../../../resolution/execution/stateMachine.ts';
import { requireProviderCapability, type CapabilityKind } from '../../../resolution/execution/capability.ts';
import { transitionExecutionAttempt } from '../commands/m8AuthorityCommands.ts';

export interface ExecutionClaim {
  id: string;
  workspaceId: string;
  actionIntentId: string;
  attemptNumber: number;
  logicalOperationKey: string;
  requestFingerprint: string;
  claimToken: string;
  fencingToken: number;
  status: DurableExecutionStatus;
  providerOperationKey: string | null;
}

export type ExternalDispatcher = (claim: ExecutionClaim) => Promise<
  | { kind: 'SUCCESS'; responseRef: string; sourceOwnedFields: Record<string, unknown>; externalRecordId?: string }
  | { kind: 'FAILURE'; responseRef?: string; error: string }
  | { kind: 'LOST_RESPONSE'; requestRef: string }
>;

export type ReconcileLookup = (claim: ExecutionClaim) => Promise<
  | { kind: 'FOUND_SUCCESS'; responseRef: string; sourceOwnedFields: Record<string, unknown>; externalRecordId?: string }
  | { kind: 'FOUND_FAILURE'; responseRef?: string; error: string }
  | { kind: 'STILL_UNKNOWN' }
>;

export class PgExecutionWorker {
  private readonly pool: Pool;
  private readonly options: { actorId: string; leaseSeconds?: number };

  constructor(pool: Pool, options: { actorId: string; leaseSeconds?: number }) {
    this.pool = pool;
    this.options = options;
  }

  /** Claims one PREPARED attempt (or reclaim expired CLAIMED that never dispatched). */
  async claimNext(workspaceId?: string): Promise<ExecutionClaim | undefined> {
    const claimToken = randomUUID();
    const leaseSeconds = this.options.leaseSeconds ?? 60;
    const result = await this.pool.query<{
      id: string; workspace_id: string; action_intent_id: string; attempt_number: number;
      logical_operation_key: string; request_fingerprint: string; fencing_token: string;
      status: DurableExecutionStatus; provider_operation_key: string | null;
    }>(
      `UPDATE execution_attempts
          SET status = 'CLAIMED', claim_token = $1, fencing_token = fencing_token + 1,
              lease_expires_at = now() + ($2 * interval '1 second'), updated_at = now()
        WHERE id = (
          SELECT id FROM execution_attempts
           WHERE (status = 'PREPARED'
              OR (status = 'CLAIMED' AND lease_expires_at < now() AND request_ref IS NULL))
             AND ($3::uuid IS NULL OR workspace_id = $3::uuid)
           ORDER BY created_at, id
           FOR UPDATE SKIP LOCKED
           LIMIT 1
        )
        RETURNING id, workspace_id, action_intent_id, attempt_number, logical_operation_key,
                  request_fingerprint, fencing_token, status, provider_operation_key`,
      [claimToken, leaseSeconds, workspaceId ?? null],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      actionIntentId: row.action_intent_id,
      attemptNumber: row.attempt_number,
      logicalOperationKey: row.logical_operation_key,
      requestFingerprint: row.request_fingerprint,
      claimToken,
      fencingToken: Number(row.fencing_token),
      status: 'CLAIMED',
      providerOperationKey: row.provider_operation_key,
    };
  }

  /**
   * Durable path: CLAIMED → DISPATCHING (committed) → adapter → DISPATCHED /
   * OBSERVED_* / OUTCOME_UNKNOWN. Capability must be supported; otherwise
   * structured unavailable without fake success.
   */
  async dispatchClaimed(
    claim: ExecutionClaim,
    params: {
      capability: { required: CapabilityKind; observed?: { capabilityKind: CapabilityKind; supported: boolean } | null };
      dispatcher: ExternalDispatcher;
    },
  ): Promise<{ outcome: DurableExecutionStatus; detail?: string }> {
    const capability = requireProviderCapability({
      required: params.capability.required,
      observed: params.capability.observed,
    });
    if (!capability.ok) {
      await transitionExecutionAttempt(this.pool, {
        workspaceId: claim.workspaceId,
        attemptId: claim.id,
        from: 'CLAIMED',
        to: 'FAILED',
        claimToken: claim.claimToken,
        fencingToken: claim.fencingToken,
        lastError: `${capability.reason}:${capability.escalation}:${capability.detail}`,
      });
      return { outcome: 'FAILED', detail: capability.detail };
    }

    const entering = await transitionExecutionAttempt(this.pool, {
      workspaceId: claim.workspaceId,
      attemptId: claim.id,
      from: 'CLAIMED',
      to: 'DISPATCHING',
      claimToken: claim.claimToken,
      fencingToken: claim.fencingToken,
    });
    if (entering !== 'APPLIED') return { outcome: 'CLAIMED', detail: 'fenced before dispatch' };

    let result: Awaited<ReturnType<ExternalDispatcher>>;
    try {
      result = await params.dispatcher(claim);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await transitionExecutionAttempt(this.pool, {
        workspaceId: claim.workspaceId,
        attemptId: claim.id,
        from: 'DISPATCHING',
        to: 'OUTCOME_UNKNOWN',
        claimToken: claim.claimToken,
        fencingToken: claim.fencingToken,
        lastError: message,
      });
      return { outcome: 'OUTCOME_UNKNOWN', detail: message };
    }

    if (result.kind === 'LOST_RESPONSE') {
      await transitionExecutionAttempt(this.pool, {
        workspaceId: claim.workspaceId,
        attemptId: claim.id,
        from: 'DISPATCHING',
        to: 'OUTCOME_UNKNOWN',
        claimToken: claim.claimToken,
        fencingToken: claim.fencingToken,
        requestRef: result.requestRef,
        lastError: 'lost_response',
      });
      return { outcome: 'OUTCOME_UNKNOWN' };
    }

    if (result.kind === 'FAILURE') {
      await transitionExecutionAttempt(this.pool, {
        workspaceId: claim.workspaceId,
        attemptId: claim.id,
        from: 'DISPATCHING',
        to: 'OBSERVED_FAILURE',
        claimToken: claim.claimToken,
        fencingToken: claim.fencingToken,
        responseRef: result.responseRef,
        lastError: result.error,
      });
      return { outcome: 'OBSERVED_FAILURE', detail: result.error };
    }

    // Persist observation then mark success.
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO execution_observations (
           workspace_id, id, attempt_id, action_intent_id, origin, external_record_id,
           source_owned_fields, observed_at, owned_subject_refs, created_by_actor_id
         ) VALUES ($1,$2,$3,$4,'EXTERNAL_PROVIDER',$5,$6::jsonb,now(),$7::jsonb,$8)`,
        [
          claim.workspaceId, randomUUID(), claim.id, claim.actionIntentId,
          result.externalRecordId ?? randomUUID(),
          JSON.stringify(result.sourceOwnedFields),
          JSON.stringify([{ kind: 'ACTION_INTENT', id: claim.actionIntentId }]),
          this.options.actorId,
        ],
      );
      const moved = await transitionExecutionAttempt(client, {
        workspaceId: claim.workspaceId,
        attemptId: claim.id,
        from: 'DISPATCHING',
        to: 'OBSERVED_SUCCESS',
        claimToken: claim.claimToken,
        fencingToken: claim.fencingToken,
        responseRef: result.responseRef,
      });
      if (moved !== 'APPLIED') {
        await client.query('ROLLBACK');
        return { outcome: 'DISPATCHING', detail: 'fenced during observation' };
      }
      await client.query('COMMIT');
      return { outcome: 'OBSERVED_SUCCESS' };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Reconcile OUTCOME_UNKNOWN / RECONCILIATION_REQUIRED via provider lookup — never blind retry. */
  async reconcileUnknown(claim: ExecutionClaim, lookup: ReconcileLookup): Promise<{ outcome: DurableExecutionStatus }> {
    if (!mayHaveBeenSent(claim.status) && claim.status !== 'OUTCOME_UNKNOWN' && claim.status !== 'RECONCILIATION_REQUIRED') {
      return { outcome: claim.status };
    }
    const from: DurableExecutionStatus = claim.status === 'OUTCOME_UNKNOWN' ? 'OUTCOME_UNKNOWN' : 'RECONCILIATION_REQUIRED';
    if (claim.status === 'OUTCOME_UNKNOWN') {
      await transitionExecutionAttempt(this.pool, {
        workspaceId: claim.workspaceId,
        attemptId: claim.id,
        from: 'OUTCOME_UNKNOWN',
        to: 'RECONCILIATION_REQUIRED',
        claimToken: claim.claimToken,
        fencingToken: claim.fencingToken,
      });
    }
    const found = await lookup(claim);
    if (found.kind === 'STILL_UNKNOWN') {
      return { outcome: 'RECONCILIATION_REQUIRED' };
    }
    if (found.kind === 'FOUND_FAILURE') {
      await transitionExecutionAttempt(this.pool, {
        workspaceId: claim.workspaceId,
        attemptId: claim.id,
        from: 'RECONCILIATION_REQUIRED',
        to: 'OBSERVED_FAILURE',
        claimToken: claim.claimToken,
        fencingToken: claim.fencingToken,
        responseRef: found.responseRef,
        lastError: found.error,
      });
      return { outcome: 'OBSERVED_FAILURE' };
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO execution_observations (
           workspace_id, id, attempt_id, action_intent_id, origin, external_record_id,
           source_owned_fields, observed_at, owned_subject_refs, created_by_actor_id
         ) VALUES ($1,$2,$3,$4,'EXTERNAL_PROVIDER',$5,$6::jsonb,now(),$7::jsonb,$8)`,
        [
          claim.workspaceId, randomUUID(), claim.id, claim.actionIntentId,
          found.externalRecordId ?? randomUUID(),
          JSON.stringify(found.sourceOwnedFields),
          JSON.stringify([{ kind: 'ACTION_INTENT', id: claim.actionIntentId }]),
          this.options.actorId,
        ],
      );
      await transitionExecutionAttempt(client, {
        workspaceId: claim.workspaceId,
        attemptId: claim.id,
        from: from === 'OUTCOME_UNKNOWN' ? 'RECONCILIATION_REQUIRED' : 'RECONCILIATION_REQUIRED',
        to: 'OBSERVED_SUCCESS',
        claimToken: claim.claimToken,
        fencingToken: claim.fencingToken,
        responseRef: found.responseRef,
      });
      await client.query('COMMIT');
      return { outcome: 'OBSERVED_SUCCESS' };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

export { canTransitionExecutionStatus };

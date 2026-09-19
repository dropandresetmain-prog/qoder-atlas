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
  type DurableExecutionStatus,
} from '../../../resolution/execution/stateMachine.ts';
import {
  externalCapabilityKindFromRef,
  evaluateStoredExecutionGate,
  isInternalCapability,
} from './storedExecutionGate.ts';
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
  /** Principal that passed the prepare gate; dispatch must use this identity. */
  gatingPrincipalId: string | null;
}

/**
 * Handed to the dispatcher by `dispatchClaimed`. `checkpointRequestRef` durably writes the
 * provider reference obtained mid-dispatch (e.g. an order number) onto THIS attempt, fenced by
 * the claim token + fencing token and only while the attempt is DISPATCHING. It returns false
 * when the write did not land (fenced, lease taken over, database error): the dispatcher MUST
 * then perform no further consequential provider call. It refreshes the lease on success.
 * (R4-F2d N1: a crash after the provider accepted a create must leave the reference on disk.)
 */
export interface DispatchControl {
  checkpointRequestRef(requestRef: string): Promise<boolean>;
}

export type ExternalDispatcher = (claim: ExecutionClaim, control: DispatchControl) => Promise<
  | { kind: 'SUCCESS'; responseRef: string; sourceOwnedFields: Record<string, unknown>; externalRecordId?: string }
  | { kind: 'FAILURE'; responseRef?: string; error: string }
  | { kind: 'LOST_RESPONSE'; requestRef: string }
>;

export type ReconcileLookup = (claim: ExecutionClaim) => Promise<
  | { kind: 'FOUND_SUCCESS'; responseRef: string; sourceOwnedFields: Record<string, unknown>; externalRecordId?: string }
  | { kind: 'FOUND_FAILURE'; responseRef?: string; error: string }
  | { kind: 'STILL_UNKNOWN' }
>;

const RECONCILABLE_STATUSES: DurableExecutionStatus[] = [
  'OUTCOME_UNKNOWN',
  'RECONCILIATION_REQUIRED',
  'DISPATCHING',
  'DISPATCHED',
];

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
      gating_principal_id: string | null;
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
                  request_fingerprint, fencing_token, status, provider_operation_key, gating_principal_id`,
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
      gatingPrincipalId: row.gating_principal_id,
    };
  }

  /** Claim one specific PREPARED attempt (never an expired/dispatching one). */
  async claimPrepared(workspaceId: string, attemptId: string): Promise<ExecutionClaim | undefined> {
    const claimToken = randomUUID();
    const leaseSeconds = this.options.leaseSeconds ?? 60;
    const result = await this.pool.query<{
      id: string; workspace_id: string; action_intent_id: string; attempt_number: number;
      logical_operation_key: string; request_fingerprint: string; fencing_token: string;
      provider_operation_key: string | null; gating_principal_id: string | null;
    }>(
      `UPDATE execution_attempts
          SET status = 'CLAIMED', claim_token = $3, fencing_token = fencing_token + 1,
              lease_expires_at = now() + ($4 * interval '1 second'), updated_at = now()
        WHERE workspace_id = $1 AND id = $2 AND status = 'PREPARED'
        RETURNING id, workspace_id, action_intent_id, attempt_number, logical_operation_key,
                  request_fingerprint, fencing_token, provider_operation_key, gating_principal_id`,
      [workspaceId, attemptId, claimToken, leaseSeconds],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      id: row.id, workspaceId: row.workspace_id, actionIntentId: row.action_intent_id, attemptNumber: row.attempt_number,
      logicalOperationKey: row.logical_operation_key, requestFingerprint: row.request_fingerprint, claimToken,
      fencingToken: Number(row.fencing_token), status: 'CLAIMED', providerOperationKey: row.provider_operation_key,
      gatingPrincipalId: row.gating_principal_id,
    };
  }

  /** Claim an uncertain attempt for reconciliation without redispatching. */
  async claimForReconciliation(workspaceId: string, attemptId: string): Promise<ExecutionClaim | undefined> {
    const claimToken = randomUUID();
    const leaseSeconds = this.options.leaseSeconds ?? 60;
    const result = await this.pool.query<{
      id: string; workspace_id: string; action_intent_id: string; attempt_number: number;
      logical_operation_key: string; request_fingerprint: string; fencing_token: string;
      status: DurableExecutionStatus; provider_operation_key: string | null;
      gating_principal_id: string | null;
    }>(
      `UPDATE execution_attempts
          SET last_error = CASE WHEN status IN ('DISPATCHING', 'DISPATCHED')
                                THEN 'stale_dispatch_lease_expired: dispatcher lost mid-flight; outcome unknown, read-only reconciliation only'
                                ELSE last_error END,
              status = 'RECONCILIATION_REQUIRED', claim_token = $4, fencing_token = fencing_token + 1,
              lease_expires_at = now() + ($5 * interval '1 second'), updated_at = now()
        WHERE workspace_id = $1 AND id = $2
          AND status = ANY($3::text[])
          -- A DISPATCHING/DISPATCHED attempt may be swept into reconciliation ONLY once its lease has
          -- lapsed (dispatcher dead). A live dispatcher's attempt is never taken over; a lapsed one
          -- may never return to dispatch eligibility, only to (read-only) reconciliation.
          AND (status IN ('OUTCOME_UNKNOWN', 'RECONCILIATION_REQUIRED')
               OR lease_expires_at IS NULL OR lease_expires_at < now())
        RETURNING id, workspace_id, action_intent_id, attempt_number, logical_operation_key,
                  request_fingerprint, fencing_token, status, provider_operation_key, gating_principal_id`,
      [workspaceId, attemptId, RECONCILABLE_STATUSES, claimToken, leaseSeconds],
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
      status: 'RECONCILIATION_REQUIRED',
      providerOperationKey: row.provider_operation_key,
      gatingPrincipalId: row.gating_principal_id,
    };
  }

  /**
   * Durable path: CLAIMED → DISPATCHING (committed) → adapter → DISPATCHED /
   * OBSERVED_* / OUTCOME_UNKNOWN. Re-checks stored authority/currentness at
   * dispatch time; capability derived from stored intent.capabilityRef.
   */
  async dispatchClaimed(
    claim: ExecutionClaim,
    params: {
      principalId: string;
      now: string;
      observed?: { capabilityKind: CapabilityKind; supported: boolean } | null;
      dispatcher: ExternalDispatcher;
    },
  ): Promise<{ outcome: DurableExecutionStatus; detail?: string }> {
    const gatingPrincipalId = claim.gatingPrincipalId;
    if (!gatingPrincipalId || gatingPrincipalId !== params.principalId) {
      await transitionExecutionAttempt(this.pool, {
        workspaceId: claim.workspaceId,
        attemptId: claim.id,
        from: 'CLAIMED',
        to: 'FAILED',
        claimToken: claim.claimToken,
        fencingToken: claim.fencingToken,
        lastError: `GATING_PRINCIPAL_MISMATCH: caller ${params.principalId} != stored ${gatingPrincipalId ?? 'null'}`,
      });
      return { outcome: 'FAILED', detail: 'GATING_PRINCIPAL_MISMATCH' };
    }
    const gate = await evaluateStoredExecutionGate(this.pool, {
      workspaceId: claim.workspaceId,
      intentId: claim.actionIntentId,
      principalId: gatingPrincipalId,
      now: params.now,
    });
    if (!gate.allowed) {
      await transitionExecutionAttempt(this.pool, {
        workspaceId: claim.workspaceId,
        attemptId: claim.id,
        from: 'CLAIMED',
        to: 'FAILED',
        claimToken: claim.claimToken,
        fencingToken: claim.fencingToken,
        lastError: `${gate.reason}:${gate.detail ?? ''}`,
      });
      return { outcome: 'FAILED', detail: gate.detail ?? gate.reason };
    }
    if (isInternalCapability(gate.capabilityRef)) {
      await transitionExecutionAttempt(this.pool, {
        workspaceId: claim.workspaceId,
        attemptId: claim.id,
        from: 'CLAIMED',
        to: 'FAILED',
        claimToken: claim.claimToken,
        fencingToken: claim.fencingToken,
        lastError: 'internal capability cannot use external dispatcher',
      });
      return { outcome: 'FAILED', detail: 'internal capability cannot use external dispatcher' };
    }
    const required = externalCapabilityKindFromRef(gate.capabilityRef) ?? 'SERVICE';
    const capability = requireProviderCapability({
      required,
      observed: params.observed,
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

    const leaseSeconds = this.options.leaseSeconds ?? 60;
    const control: DispatchControl = {
      checkpointRequestRef: async (requestRef) => {
        try {
          const written = await this.pool.query(
            `UPDATE execution_attempts
                SET request_ref = $3, lease_expires_at = now() + ($6 * interval '1 second'), updated_at = now()
              WHERE workspace_id = $1 AND id = $2 AND status = 'DISPATCHING'
                AND claim_token = $4 AND fencing_token = $5
                AND (request_ref IS NULL OR request_ref = $3)`,
            [claim.workspaceId, claim.id, requestRef, claim.claimToken, claim.fencingToken, leaseSeconds],
          );
          return (written.rowCount ?? 0) > 0;
        } catch {
          return false;
        }
      },
    };
    let result: Awaited<ReturnType<ExternalDispatcher>>;
    try {
      result = await params.dispatcher(claim, control);
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

  /** Reconcile uncertain attempts via provider lookup — never blind retry. */
  async reconcileUnknown(claim: ExecutionClaim, lookup: ReconcileLookup): Promise<{ outcome: DurableExecutionStatus }> {
    if (!RECONCILABLE_STATUSES.includes(claim.status) && claim.status !== 'OUTCOME_UNKNOWN') {
      return { outcome: claim.status };
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      if (claim.status === 'OUTCOME_UNKNOWN' || claim.status === 'DISPATCHING' || claim.status === 'DISPATCHED') {
        const toRecon = claim.status === 'OUTCOME_UNKNOWN' ? 'OUTCOME_UNKNOWN' : claim.status;
        const moved = await transitionExecutionAttempt(client, {
          workspaceId: claim.workspaceId,
          attemptId: claim.id,
          from: toRecon,
          to: 'RECONCILIATION_REQUIRED',
          claimToken: claim.claimToken,
          fencingToken: claim.fencingToken,
        });
        if (moved !== 'APPLIED') {
          await client.query('ROLLBACK');
          return { outcome: claim.status };
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    const found = await lookup(claim);
    if (found.kind === 'STILL_UNKNOWN') {
      return { outcome: 'RECONCILIATION_REQUIRED' };
    }

    const reconClient = await this.pool.connect();
    try {
      await reconClient.query('BEGIN');

      if (found.kind === 'FOUND_FAILURE') {
        const moved = await transitionExecutionAttempt(reconClient, {
          workspaceId: claim.workspaceId,
          attemptId: claim.id,
          from: 'RECONCILIATION_REQUIRED',
          to: 'OBSERVED_FAILURE',
          claimToken: claim.claimToken,
          fencingToken: claim.fencingToken,
          responseRef: found.responseRef,
          lastError: found.error,
        });
        if (moved !== 'APPLIED') {
          await reconClient.query('ROLLBACK');
          return { outcome: 'RECONCILIATION_REQUIRED' };
        }
        await reconClient.query('COMMIT');
        return { outcome: 'OBSERVED_FAILURE' };
      }

      await reconClient.query(
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
      const moved = await transitionExecutionAttempt(reconClient, {
        workspaceId: claim.workspaceId,
        attemptId: claim.id,
        from: 'RECONCILIATION_REQUIRED',
        to: 'OBSERVED_SUCCESS',
        claimToken: claim.claimToken,
        fencingToken: claim.fencingToken,
        responseRef: found.responseRef,
      });
      if (moved !== 'APPLIED') {
        await reconClient.query('ROLLBACK');
        return { outcome: 'RECONCILIATION_REQUIRED' };
      }
      await reconClient.query('COMMIT');
      return { outcome: 'OBSERVED_SUCCESS' };
    } catch (error) {
      await reconClient.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      reconClient.release();
    }
  }
}

export { canTransitionExecutionStatus };

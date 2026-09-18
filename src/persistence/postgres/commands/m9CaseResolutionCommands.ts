/**
 * M9 — commit RecoveryCase resolution after the deterministic gate allows it.
 */
import { DomainCommandEnvelopeSchema } from '../../../contracts/v2/command/domainCommand.ts';
import type { UnitOfWork } from '../../../contracts/v2/command/unitOfWork.ts';
import { typedConflict } from '../../../domain/v2/shared/errors.ts';
import type { TypedRef } from '../../../domain/v2/shared/identity.ts';
import { canonicalPayloadHash } from '../canonicalHash.ts';
import { appendAuditTrail, buildReceipt, type AdvancedRoot } from '../commandSupport.ts';
import type { ExecuteOutcome } from '../pgUnitOfWork.ts';
import { currentTransactionClient } from '../transactionContext.ts';
import { resolveOpenCaseAttention } from './caseAttentionCommands.ts';
import {
  evaluateRecoveryCaseResolution,
  type ResolutionGateInput,
} from '../../../app/target/recoveryCaseResolution.ts';

const SCHEMA_VERSION = '1';

export interface ResolveCaseIdentity {
  workspaceId: string;
  actorPrincipalId: string;
  idempotencyKey: string;
}

export async function resolveRecoveryCase(
  uow: UnitOfWork,
  params: ResolveCaseIdentity & ResolutionGateInput & { closedAt?: string },
): Promise<ExecuteOutcome<{
  caseId: string;
  resolutionKind: 'RECOVERED';
  summary: string;
}>> {
  const caseRef: TypedRef = { kind: 'RECOVERY_CASE', id: params.recoveryCaseId };
  const payload = {
    recoveryCaseId: params.recoveryCaseId,
    now: params.now,
    requiredAffectedPeople: params.requiredAffectedPeople ?? [],
  };
  const envelope = DomainCommandEnvelopeSchema.parse({
    commandType: 'RECOVERY_CASE_RESOLVED',
    schemaVersion: SCHEMA_VERSION,
    workspaceId: params.workspaceId,
    actorPrincipalId: params.actorPrincipalId,
    idempotencyKey: params.idempotencyKey,
    canonicalPayloadHash: canonicalPayloadHash(payload),
    expectedAggregateRevisions: [],
    typedPayload: payload,
    evidenceRefs: [],
  });
  const committedAt = params.closedAt ?? new Date().toISOString();

  try {
    return await uow.execute(envelope, async () => {
      const client = currentTransactionClient();
      const gate = await evaluateRecoveryCaseResolution(client, {
        workspaceId: params.workspaceId,
        recoveryCaseId: params.recoveryCaseId,
        now: params.now,
        requiredAffectedPeople: params.requiredAffectedPeople,
      });
      if (!gate.allowed) {
        return {
          ok: false,
          conflict: typedConflict('VALIDATION_FAILED', `${gate.reason}: ${gate.detail}`, [caseRef]),
        };
      }

      const updated = await client.query(
        `UPDATE recovery_cases
            SET lifecycle_status = 'RESOLVED',
                resolution_kind = $3,
                resolution_summary = $4,
                closed_at = $5::timestamptz
          WHERE workspace_id = $1 AND id = $2
            AND lifecycle_status NOT IN ('RESOLVED', 'CLOSED', 'CANCELLED', 'SUPERSEDED')`,
        [params.workspaceId, params.recoveryCaseId, gate.resolutionKind, gate.summary, committedAt],
      );
      if ((updated.rowCount ?? 0) !== 1) {
        return {
          ok: false,
          conflict: typedConflict('VALIDATION_FAILED', 'CASE_NOT_OPEN: concurrent close or missing case', [caseRef]),
        };
      }

      // A RESOLVED case never keeps an OPEN human-attention record (0126).
      await resolveOpenCaseAttention(client, {
        workspaceId: params.workspaceId,
        caseId: params.recoveryCaseId,
        actorPrincipalId: params.actorPrincipalId,
        resolution: 'case_resolved',
        resolvedAt: committedAt,
      });

      const value = {
        caseId: params.recoveryCaseId,
        resolutionKind: gate.resolutionKind,
        summary: gate.summary,
      };
      const advanced: AdvancedRoot[] = [];
      await appendAuditTrail({
        envelope,
        advanced,
        destinationKind: 'RECOVERY_CASE',
        payload: value,
      });
      return {
        ok: true,
        value,
        receipt: buildReceipt({ envelope, value, advanced, committedAt }),
      };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, conflict: typedConflict('VALIDATION_FAILED', message, [caseRef]) };
  }
}

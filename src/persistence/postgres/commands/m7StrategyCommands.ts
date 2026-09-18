/**
 * M9 — persist an evaluated RecoveryStrategy through a real command.
 *
 * Stores full planning evidence required by product/read models and the M8
 * execution gate (non-empty base_manifest, affected subjects, scenario change,
 * candidate assessment summaries, viability, assumptions/unknowns, authority
 * scopes). Execution remains denied when required strategy basis is missing.
 */
import { randomUUID } from 'node:crypto';
import { DomainCommandEnvelopeSchema } from '../../../contracts/v2/command/domainCommand.ts';
import type { UnitOfWork } from '../../../contracts/v2/command/unitOfWork.ts';
import {
  RecoveryStrategySchema,
  type RecoveryStrategy,
} from '../../../contracts/v2/scenario/recoveryStrategy.ts';
import { ScenarioChangeSchema } from '../../../contracts/v2/scenario/scenarioChange.ts';
import { typedConflict } from '../../../domain/v2/shared/errors.ts';
import type { ExpectedRevision, TypedRef } from '../../../domain/v2/shared/identity.ts';
import { canonicalPayloadHash } from '../canonicalHash.ts';
import {
  appendAuditTrail,
  buildReceipt,
  createRoot,
  type AdvancedRoot,
} from '../commandSupport.ts';
import type { ExecuteOutcome } from '../pgUnitOfWork.ts';
import { currentTransactionClient } from '../transactionContext.ts';

const SCHEMA_VERSION = '1';

export interface StrategyCommandIdentity {
  workspaceId: string;
  actorPrincipalId: string;
  idempotencyKey: string;
}

function ref(kind: TypedRef['kind'], id: string): TypedRef {
  return { kind, id };
}

function rootCreated(aggregateRef: TypedRef): AdvancedRoot {
  return { aggregateRef, beforeRevision: null, afterRevision: 1 };
}

function isNonEmptyManifest(manifest: unknown): boolean {
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) return false;
  const keys = Object.keys(manifest as Record<string, unknown>);
  return keys.length > 0;
}

export interface ValidatedRecoveryStrategyForPersistence {
  strategy: RecoveryStrategy;
  scenarioChange: RecoveryStrategy['scenarioChange'];
}

/** Shared persistence-boundary validation for standalone and composite planning commands. */
export function validateRecoveryStrategyForPersistence(
  candidate: RecoveryStrategy,
): { ok: true; value: ValidatedRecoveryStrategyForPersistence } | { ok: false; conflict: ReturnType<typeof typedConflict> } {
  let strategy: RecoveryStrategy;
  try {
    strategy = RecoveryStrategySchema.parse(candidate);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, conflict: typedConflict('VALIDATION_FAILED', message, []) };
  }
  let scenarioChange: RecoveryStrategy['scenarioChange'];
  try {
    scenarioChange = ScenarioChangeSchema.parse(strategy.scenarioChange);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, conflict: typedConflict('VALIDATION_FAILED', `scenarioChange: ${message}`, []) };
  }
  const strategyRef = ref('RECOVERY_STRATEGY', strategy.id);
  if (!isNonEmptyManifest(strategy.baseManifest)) {
    return { ok: false, conflict: typedConflict('VALIDATION_FAILED', 'EMPTY_BASE_MANIFEST: RecoveryStrategy requires a non-empty base_manifest', [strategyRef]) };
  }
  if (strategy.affectedSubjectRefs.length === 0) {
    return { ok: false, conflict: typedConflict('VALIDATION_FAILED', 'affected subjects required', [strategyRef]) };
  }
  if (scenarioChange.recoveryStrategyId !== strategy.id) {
    return { ok: false, conflict: typedConflict('VALIDATION_FAILED', 'scenarioChange.recoveryStrategyId must match strategy.id', [strategyRef]) };
  }
  if (scenarioChange.strategyVersion !== strategy.strategyVersion) {
    return { ok: false, conflict: typedConflict('VALIDATION_FAILED', 'scenarioChange.strategyVersion must match strategy.strategyVersion', [strategyRef]) };
  }
  return { ok: true, value: { strategy, scenarioChange } };
}

/** Inserts a previously validated strategy using the ambient UnitOfWork transaction. */
export async function insertValidatedRecoveryStrategy(params: {
  workspaceId: string;
  actorPrincipalId: string;
  validated: ValidatedRecoveryStrategyForPersistence;
}): Promise<{ value: { strategyId: string; strategyVersion: number }; advanced: AdvancedRoot[] }> {
  const { workspaceId, actorPrincipalId, validated } = params;
  const { strategy, scenarioChange } = validated;
  const client = currentTransactionClient();
  await createRoot({ workspaceId, id: strategy.id, kind: 'RECOVERY_STRATEGY' });
  const candidateSummaries = strategy.candidateAssessments.map((row) => ({
    subjectRef: row.subjectRef,
    assessmentId: row.assessmentId,
    overallVerdict: row.overallVerdict,
  }));
  await client.query(
    `INSERT INTO recovery_strategies (
       workspace_id, id, recovery_case_id, strategy_version, status, viability,
       basis_assessment_id, base_manifest, scenario_change, assumptions, required_unknowns,
       candidate_assessment_summaries, required_authority_scopes, rejection_reason,
       evaluated_at, created_by_actor_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14,$15::timestamptz,$16)`,
    [
      workspaceId, strategy.id, strategy.recoveryCaseId, strategy.strategyVersion,
      strategy.status, strategy.viability, strategy.basisAssessmentId,
      JSON.stringify(strategy.baseManifest), JSON.stringify(scenarioChange),
      JSON.stringify(strategy.assumptions), JSON.stringify(strategy.requiredUnknowns),
      JSON.stringify(candidateSummaries), JSON.stringify(strategy.requiredAuthorityScopes),
      strategy.rejectionReason ?? null, strategy.evaluatedAt ?? null, actorPrincipalId,
    ],
  );
  await client.query(
    `INSERT INTO strategy_changes (
       workspace_id, recovery_strategy_id, scenario_change_id, strategy_version,
       affected_subjects, effects, basis_assessment_id
     ) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`,
    [
      workspaceId, strategy.id, scenarioChange.id, strategy.strategyVersion,
      JSON.stringify(strategy.affectedSubjectRefs), JSON.stringify(scenarioChange.effects),
      scenarioChange.basisAssessmentId,
    ],
  );
  return {
    value: { strategyId: strategy.id, strategyVersion: strategy.strategyVersion },
    advanced: [rootCreated(ref('RECOVERY_STRATEGY', strategy.id))],
  };
}

export async function persistRecoveryStrategy(
  uow: UnitOfWork,
  params: StrategyCommandIdentity & {
    strategy: RecoveryStrategy;
    expectedAggregateRevisions?: ExpectedRevision[];
  },
): Promise<ExecuteOutcome<{ strategyId: string; strategyVersion: number }>> {
  const validated = validateRecoveryStrategyForPersistence(params.strategy);
  if (!validated.ok) return validated;
  const { strategy, scenarioChange } = validated.value;

  const strategyRef = ref('RECOVERY_STRATEGY', strategy.id);
  const payload = {
    strategyId: strategy.id,
    recoveryCaseId: strategy.recoveryCaseId,
    strategyVersion: strategy.strategyVersion,
    status: strategy.status,
    viability: strategy.viability,
  };

  const envelope = DomainCommandEnvelopeSchema.parse({
    commandType: 'RECOVERY_STRATEGY_PERSISTED',
    schemaVersion: SCHEMA_VERSION,
    workspaceId: params.workspaceId,
    actorPrincipalId: params.actorPrincipalId,
    idempotencyKey: params.idempotencyKey,
    canonicalPayloadHash: canonicalPayloadHash(payload),
    expectedAggregateRevisions: params.expectedAggregateRevisions ?? [],
    typedPayload: payload,
    evidenceRefs: [],
  });
  const committedAt = new Date().toISOString();

  try {
    return await uow.execute(envelope, async () => {
      const client = currentTransactionClient();
      const caseRow = await client.query<{ id: string }>(
        `SELECT id FROM recovery_cases WHERE workspace_id = $1 AND id = $2`,
        [params.workspaceId, strategy.recoveryCaseId],
      );
      if (!caseRow.rows[0]) {
        return {
          ok: false,
          conflict: typedConflict('VALIDATION_FAILED', `recovery case ${strategy.recoveryCaseId} not found`, [
            ref('RECOVERY_CASE', strategy.recoveryCaseId),
          ]),
        };
      }

      await createRoot({ workspaceId: params.workspaceId, id: strategy.id, kind: 'RECOVERY_STRATEGY' });

      const candidateSummaries = strategy.candidateAssessments.map((row) => ({
        subjectRef: row.subjectRef,
        assessmentId: row.assessmentId,
        overallVerdict: row.overallVerdict,
      }));

      await client.query(
        `INSERT INTO recovery_strategies (
           workspace_id, id, recovery_case_id, strategy_version, status, viability,
           basis_assessment_id, base_manifest, scenario_change, assumptions, required_unknowns,
           candidate_assessment_summaries, required_authority_scopes, rejection_reason,
           evaluated_at, created_by_actor_id
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14,$15::timestamptz,$16
         )`,
        [
          params.workspaceId,
          strategy.id,
          strategy.recoveryCaseId,
          strategy.strategyVersion,
          strategy.status,
          strategy.viability,
          strategy.basisAssessmentId,
          JSON.stringify(strategy.baseManifest),
          JSON.stringify(scenarioChange),
          JSON.stringify(strategy.assumptions),
          JSON.stringify(strategy.requiredUnknowns),
          JSON.stringify(candidateSummaries),
          JSON.stringify(strategy.requiredAuthorityScopes),
          strategy.rejectionReason ?? null,
          strategy.evaluatedAt ?? null,
          params.actorPrincipalId,
        ],
      );

      await client.query(
        `INSERT INTO strategy_changes (
           workspace_id, recovery_strategy_id, scenario_change_id, strategy_version,
           affected_subjects, effects, basis_assessment_id
         ) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`,
        [
          params.workspaceId,
          strategy.id,
          scenarioChange.id,
          strategy.strategyVersion,
          JSON.stringify(strategy.affectedSubjectRefs),
          JSON.stringify(scenarioChange.effects),
          scenarioChange.basisAssessmentId,
        ],
      );

      const value = { strategyId: strategy.id, strategyVersion: strategy.strategyVersion };
      const advanced = [rootCreated(strategyRef)];
      await appendAuditTrail({
        envelope,
        advanced,
        destinationKind: 'RECOVERY_STRATEGY',
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
    return { ok: false, conflict: typedConflict('VALIDATION_FAILED', message, [strategyRef]) };
  }
}

/** Convenience: mint a strategy id when the evaluator did not supply one. */
export function newRecoveryStrategyId(): string {
  return randomUUID();
}

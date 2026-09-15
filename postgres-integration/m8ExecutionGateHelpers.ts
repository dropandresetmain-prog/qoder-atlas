/**
 * Shared PostgreSQL helpers for C3 stored execution gate tests.
 */
import { randomUUID } from 'node:crypto';
import type { Pool } from '../src/persistence/postgres/pool.ts';
import { PgUnitOfWork, type ExecuteOutcome } from '../src/persistence/postgres/pgUnitOfWork.ts';
import {
  issueAuthorityDecision,
  recordApproval,
  holdBudgetForIntent,
} from '../src/persistence/postgres/commands/m8AuthorityCommands.ts';
import { issueAuthorityGrant } from '../src/persistence/postgres/commands/peopleCommands.ts';
import { computeEnvelopeFingerprint, type EnvelopeFingerprintInput } from '../src/resolution/authority/envelope.ts';
import { saveAssessment } from '../src/persistence/postgres/world/pgAssessments.ts';
import type { AssessmentResult } from '../src/contracts/v2/assessment/assessmentManifest.ts';
import type { TypedRef } from '../src/domain/v2/shared/identity.ts';
import type { ExactMoney } from '../src/domain/v2/shared/money.ts';
import assert from 'node:assert/strict';

export const GATE_NOW = '2031-07-01T00:00:00.000Z';

export function mustOk<T>(outcome: ExecuteOutcome<T>): T {
  if (!outcome.ok) assert.fail(`${outcome.conflict.kind}: ${outcome.conflict.message}`);
  return outcome.value;
}

export function defaultEnvelopeInput(opts: {
  planId: string;
  intentId: string;
  scope: TypedRef[];
  amountCeiling?: ExactMoney;
  planVersion?: number;
  requiredActorRoles?: string[];
}): EnvelopeFingerprintInput {
  return {
    actionPlanId: opts.planId,
    actionPlanVersion: opts.planVersion ?? 1,
    actionIntentId: opts.intentId,
    actionIntentVersion: 1,
    requiredActorRoles: opts.requiredActorRoles ?? ['PAYER'],
    scope: opts.scope,
    grantRefs: [],
    ruleInputs: [],
    ...(opts.amountCeiling ? { amountCeiling: opts.amountCeiling } : {}),
  };
}

export async function seedMinimalCurrentAssessment(
  pool: Pool,
  workspaceId: string,
  subject: TypedRef,
  now: string = GATE_NOW,
): Promise<AssessmentResult> {
  const result: AssessmentResult = {
    id: randomUUID(),
    kind: 'VIABILITY',
    evaluatedAt: now,
    overallVerdict: 'PASS',
    subjects: [{ subjectRef: subject, role: 'PRIMARY' }],
    dimensions: [],
    manifest: {
      evaluatedAt: now,
      evaluatorVersions: [],
      aggregateReads: [],
      scopeReads: [],
      evidenceReads: [],
      coverageReads: [],
      missingCoverage: [],
    },
  };
  await saveAssessment(pool, workspaceId, result, 'test:gate-helper');
  return result;
}

export async function seedStoredExecutionAuthority(opts: {
  pool: Pool;
  workspaceId: string;
  actorId: string;
  principalId: string;
  planId: string;
  intentId: string;
  scope: TypedRef[];
  representedPartyRef: TypedRef;
  cost?: ExactMoney;
  budgetId?: string;
  budgetRevision?: number;
  assessmentSubject?: TypedRef;
  requirementRole?: string;
  planVersion?: number;
  now?: string;
  /** When set, envelope fingerprint uses this instead of the stored intent fingerprint. */
  overrideRequestFingerprint?: string;
  /** Grant scopes must exist in domain_subjects; defaults to representedPartyRef. */
  grantScopes?: TypedRef[];
}): Promise<{ fingerprint: string; grantId: string }> {
  const now = opts.now ?? GATE_NOW;
  const requirementRole = opts.requirementRole ?? 'PAYER';
  const grantScopes = opts.grantScopes ?? [opts.representedPartyRef];
  const uow = () => new PgUnitOfWork(opts.pool, opts.workspaceId);
  if (opts.assessmentSubject) {
    await seedMinimalCurrentAssessment(opts.pool, opts.workspaceId, opts.assessmentSubject, now);
  }
  const intentRow = await opts.pool.query<{
    request_fingerprint: string | null;
    offer_fingerprint: string | null;
    cost_amount: string | null;
    cost_currency: string | null;
    plan_version: number;
  }>(
    `SELECT i.request_fingerprint, i.offer_fingerprint, i.cost_amount::text, i.cost_currency, p.plan_version
       FROM action_intents i JOIN action_plans p ON p.workspace_id = i.workspace_id AND p.id = i.action_plan_id
      WHERE i.workspace_id = $1 AND i.id = $2`,
    [opts.workspaceId, opts.intentId],
  );
  const ir = intentRow.rows[0]!;
  const cost = ir.cost_amount && ir.cost_currency
    ? { amount: ir.cost_amount, currency: ir.cost_currency }
    : opts.cost;
  const requestFingerprint = opts.overrideRequestFingerprint
    ?? ir.request_fingerprint
    ?? undefined;
  const envelopeInput: EnvelopeFingerprintInput = {
    ...defaultEnvelopeInput({
      planId: opts.planId,
      intentId: opts.intentId,
      scope: opts.scope,
      ...(cost ? { amountCeiling: cost } : {}),
      planVersion: ir.plan_version ?? opts.planVersion ?? 1,
      requiredActorRoles: [requirementRole],
    }),
    ...(requestFingerprint ? { requestFingerprint } : {}),
    ...(ir.offer_fingerprint && !opts.overrideRequestFingerprint
      ? { offerFingerprint: ir.offer_fingerprint }
      : {}),
    ...(cost ? { costEstimate: cost } : {}),
  };
  const fingerprint = computeEnvelopeFingerprint(envelopeInput);
  const grantIdempotency = randomUUID();
  const grant = mustOk(await issueAuthorityGrant(uow(), {
    workspaceId: opts.workspaceId,
    actorPrincipalId: opts.actorId,
    idempotencyKey: grantIdempotency,
    principalId: opts.principalId,
    representedPartyRef: opts.representedPartyRef,
    issuedByPrincipalId: opts.principalId,
    issuedAt: now,
    actions: ['action.intent.dispatch'],
    scopes: grantScopes,
    // Self-cite this command's own receipt (deferrable FK resolves at COMMIT).
    authorisingReceipt: { commandNamespace: 'AUTHORITY_GRANT_ISSUED', idempotencyKey: grantIdempotency },
    expectedAggregateRevisions: [],
  }));
  mustOk(await issueAuthorityDecision(uow(), {
    workspaceId: opts.workspaceId,
    actorPrincipalId: opts.actorId,
    idempotencyKey: randomUUID(),
    envelopeInput,
    requirements: [{ actorRole: requirementRole }],
    issuedAt: now,
  }));
  const decision = await opts.pool.query<{ id: string; requirement_ids: string[] }>(
    `SELECT d.id, array_agg(r.id ORDER BY r.actor_role) AS requirement_ids
       FROM authority_decisions d
       JOIN approval_requirements r ON r.workspace_id = d.workspace_id AND r.decision_id = d.id
      WHERE d.workspace_id = $1 AND d.action_intent_id = $2
      GROUP BY d.id, d.issued_at
      ORDER BY d.issued_at DESC, d.id DESC LIMIT 1`,
    [opts.workspaceId, opts.intentId],
  );
  const row = decision.rows[0]!;
  mustOk(await recordApproval(uow(), {
    workspaceId: opts.workspaceId,
    actorPrincipalId: opts.principalId,
    idempotencyKey: randomUUID(),
    decisionId: row.id,
    requirementId: row.requirement_ids[0]!,
    envelopeFingerprint: fingerprint,
    scope: opts.scope,
    approvedAt: now,
  }));
  if (opts.cost && opts.budgetId) {
    mustOk(await holdBudgetForIntent(uow(), {
      workspaceId: opts.workspaceId,
      actorPrincipalId: opts.actorId,
      idempotencyKey: randomUUID(),
      budgetId: opts.budgetId,
      expectedBudgetRevision: opts.budgetRevision ?? 1,
      actionIntentId: opts.intentId,
    }));
  }
  return { fingerprint, grantId: grant.grantId };
}

/** Persist recovery strategy + strategy_changes so internal executors can load effect payloads. */
export async function persistStrategyChangeRow(
  pool: Pool,
  workspaceId: string,
  actorId: string,
  recoveryCaseId: string,
  scenarioChange: {
    id: string;
    recoveryStrategyId: string;
    strategyVersion: number;
    affectedSubjectRefs: TypedRef[];
    effects: unknown[];
    basisAssessmentId?: string;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO recovery_strategies
       (workspace_id, id, recovery_case_id, strategy_version, status, viability,
        base_manifest, scenario_change, created_by_actor_id)
     VALUES ($1, $2, $3, $4, 'SELECTED', 'VIABLE', '{}'::jsonb, $5::jsonb, $6)`,
    [
      workspaceId, scenarioChange.recoveryStrategyId, recoveryCaseId, scenarioChange.strategyVersion,
      JSON.stringify(scenarioChange), actorId,
    ],
  );
  await pool.query(
    `INSERT INTO strategy_changes
       (workspace_id, recovery_strategy_id, scenario_change_id, strategy_version,
        affected_subjects, effects, basis_assessment_id)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
    [
      workspaceId, scenarioChange.recoveryStrategyId, scenarioChange.id, scenarioChange.strategyVersion,
      JSON.stringify(scenarioChange.affectedSubjectRefs), JSON.stringify(scenarioChange.effects),
      // Only cite a real assessment id; planner fixtures often use a random UUID placeholder.
      null,
    ],
  );
}

export function prepareParams(opts: {
  workspaceId: string;
  actorId: string;
  planId: string;
  intentId: string;
  principalId: string;
  attemptNumber?: number;
  idempotencyKey?: string;
  attemptId?: string;
  now?: string;
}) {
  return {
    workspaceId: opts.workspaceId,
    actorPrincipalId: opts.actorId,
    idempotencyKey: opts.idempotencyKey ?? randomUUID(),
    planId: opts.planId,
    intentId: opts.intentId,
    attemptNumber: opts.attemptNumber ?? 1,
    principalId: opts.principalId,
    now: opts.now ?? GATE_NOW,
    ...(opts.attemptId ? { attemptId: opts.attemptId } : {}),
  };
}

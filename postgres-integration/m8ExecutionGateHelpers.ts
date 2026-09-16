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
import {
  issueAuthorityGrant,
  bootstrapIssueAuthorityGrant,
  createPrincipal,
  GRANT_ISSUANCE_ACTION_KIND,
} from '../src/persistence/postgres/commands/peopleCommands.ts';
import { computeEnvelopeFingerprint, type EnvelopeFingerprintInput } from '../src/resolution/authority/envelope.ts';
import { loadRequiredAuthorityScope } from '../src/persistence/postgres/execution/storedExecutionGate.ts';
import { saveAssessment } from '../src/persistence/postgres/world/pgAssessments.ts';
import type { AssessmentResult } from '../src/contracts/v2/assessment/assessmentManifest.ts';
import type { TypedRef } from '../src/domain/v2/shared/identity.ts';
import type { ExactMoney } from '../src/domain/v2/shared/money.ts';
import type { WorldSnapshotManifest } from '../src/contracts/v2/scope/readScope.ts';
import assert from 'node:assert/strict';

export const GATE_NOW = '2031-07-01T00:00:00.000Z';

/** Unique union of TypedRefs, sorted for stable fingerprints. */
export function unionTypedRefs(...sets: readonly TypedRef[][]): TypedRef[] {
  const map = new Map<string, TypedRef>();
  for (const set of sets) {
    for (const ref of set) {
      map.set(`${ref.kind}:${ref.id}`, ref);
    }
  }
  return [...map.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
}

export async function loadRequiredAuthorityScopesOrFail(
  pool: Pool,
  workspaceId: string,
  intentId: string,
): Promise<TypedRef[]> {
  const required = await loadRequiredAuthorityScope(pool, workspaceId, intentId);
  if (!Array.isArray(required)) {
    assert.fail(`loadRequiredAuthorityScope denied: ${required.reason}${required.detail ? `: ${required.detail}` : ''}`);
  }
  return required;
}

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

/** Non-empty currentness boundary for a single aggregate root at a known revision. */
export function tripBaseManifest(tripId: string, revision: number, evaluatedAt: string = GATE_NOW): WorldSnapshotManifest {
  return {
    evaluatedAt,
    evaluatorVersions: [],
    aggregateReads: [{ aggregateRef: { kind: 'TRIP', id: tripId }, revision }],
    scopeReads: [],
    evidenceReads: [],
    coverageReads: [],
    missingCoverage: [],
  };
}

export async function seedMinimalCurrentAssessment(
  pool: Pool,
  workspaceId: string,
  subject: TypedRef,
  now: string = GATE_NOW,
  opts?: { tripId?: string; tripRevision?: number; assessmentId?: string; verdict?: 'PASS' | 'FAIL' },
): Promise<AssessmentResult> {
  const tripId = opts?.tripId;
  const tripRevision = opts?.tripRevision ?? 1;
  const result: AssessmentResult = {
    id: opts?.assessmentId ?? randomUUID(),
    kind: 'VIABILITY',
    evaluatedAt: now,
    overallVerdict: opts?.verdict ?? 'PASS',
    subjects: [{ subjectRef: subject, role: 'PRIMARY' }],
    dimensions: [],
    manifest: {
      evaluatedAt: now,
      evaluatorVersions: [],
      aggregateReads: tripId
        ? [{ aggregateRef: { kind: 'TRIP', id: tripId }, revision: tripRevision }]
        : [],
      scopeReads: [],
      evidenceReads: [],
      coverageReads: [],
      missingCoverage: [],
    },
  };
  await saveAssessment(pool, workspaceId, result, 'test:gate-helper');
  return result;
}

/**
 * ISSUER-POL test scaffolding: `issueAuthorityGrant` no longer permits
 * self-issuance or an issuer with no grant-issuing authority (enforced at
 * the command itself, not just the application facade). Fixtures need one
 * real, authorised issuer instead of each principal minting its own grant.
 *
 * Bootstraps a dedicated SYSTEM principal holding `authority.grant.write`
 * scoped to `coverageScopes` — pass every TypedRef this workspace's fixture
 * will ever need to grant sub-scopes of (e.g. the seeded organisation, trip
 * and journey), since scope coverage is exact-set containment, not
 * hierarchical. Call once per workspace (bootstrap only satisfies the
 * workspace's very first grant); reuse the returned principal id for every
 * later grant in that same workspace.
 */
export async function bootstrapTestGrantIssuer(
  pool: Pool,
  workspaceId: string,
  actorId: string,
  now: string,
  coverageScopesIn: TypedRef[],
): Promise<string> {
  const coverageScopes = unionTypedRefs(coverageScopesIn);
  const uow = new PgUnitOfWork(pool, workspaceId);
  // Self-issuance is forbidden even for the bootstrap path, so a throwaway
  // SYSTEM seed principal issues the grant and is never used again — the
  // recipient is the reusable issuer callers get back.
  const bootstrapSeedPrincipalId = randomUUID();
  mustOk(await createPrincipal(uow, {
    workspaceId,
    actorPrincipalId: actorId,
    idempotencyKey: randomUUID(),
    principalId: bootstrapSeedPrincipalId,
    actorType: 'SYSTEM',
    authIssuer: 'urn:northstar:test-bootstrap-seed',
    authSubject: `test-bootstrap-seed:${bootstrapSeedPrincipalId}`,
  }));
  const issuerPrincipalId = randomUUID();
  mustOk(await createPrincipal(uow, {
    workspaceId,
    actorPrincipalId: actorId,
    idempotencyKey: randomUUID(),
    principalId: issuerPrincipalId,
    actorType: 'SYSTEM',
    authIssuer: 'urn:northstar:test-issuer',
    authSubject: `test-issuer:${issuerPrincipalId}`,
  }));
  const idempotencyKey = randomUUID();
  mustOk(await bootstrapIssueAuthorityGrant(uow, {
    workspaceId,
    actorPrincipalId: actorId,
    idempotencyKey,
    grantId: randomUUID(),
    principalId: issuerPrincipalId,
    // The issuer represents itself, not any of the scopes it's authorised to
    // grant over — `coverageScopes` entries (JOURNEY/TRIP/ACTION_INTENT/...)
    // are frequently not valid `represented_party_kind` values at all
    // (0019's CHECK only allows TRAVELLER/ORGANISATION/
    // RESPONSIBILITY_ASSIGNMENT/PRINCIPAL); PRINCIPAL always is.
    representedPartyRef: { kind: 'PRINCIPAL', id: issuerPrincipalId },
    issuedByPrincipalId: bootstrapSeedPrincipalId,
    issuedAt: now,
    actions: [GRANT_ISSUANCE_ACTION_KIND],
    scopes: coverageScopes,
    authorisingReceipt: { commandNamespace: 'AUTHORITY_GRANT_ISSUED', idempotencyKey },
    expectedAggregateRevisions: [],
  }));
  return issuerPrincipalId;
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
  assessmentTripId?: string;
  assessmentTripRevision?: number;
  requirementRole?: string;
  planVersion?: number;
  now?: string;
  /** When set, envelope fingerprint uses this instead of the stored intent fingerprint. */
  overrideRequestFingerprint?: string;
  /**
   * Grant scopes must cover every envelope scope ref (exact TypedRef match).
   * Defaults to the envelope scope — not merely representedPartyRef.
   */
  grantScopes?: TypedRef[];
  /** Principal that records the approval; defaults to principalId (dispatcher). */
  approverPrincipalId?: string;
  /** Skip issuing grants (caller already seeded them). */
  skipGrants?: boolean;
  /**
   * Authorised issuer for the grants this call issues (ISSUER-POL). Pass a
   * principal already bootstrapped via `bootstrapTestGrantIssuer` when the
   * caller needs more than one grant issuance in the same workspace —
   * bootstrap itself only satisfies a workspace's very first grant. When
   * omitted, a fresh single-use issuer is bootstrapped scoped exactly to
   * `grantScopes`.
   */
  issuerPrincipalId?: string;
}): Promise<{ fingerprint: string; grantId: string | undefined }> {
  const now = opts.now ?? GATE_NOW;
  const requirementRole = opts.requirementRole ?? 'PAYER';
  const requiredAuthorityScopes = await loadRequiredAuthorityScopesOrFail(opts.pool, opts.workspaceId, opts.intentId);
  const decisionScope = unionTypedRefs(opts.scope, requiredAuthorityScopes);
  const grantScopes = opts.grantScopes ?? decisionScope;
  const approverPrincipalId = opts.approverPrincipalId ?? opts.principalId;
  const uow = () => new PgUnitOfWork(opts.pool, opts.workspaceId);
  if (opts.assessmentSubject) {
    await seedMinimalCurrentAssessment(opts.pool, opts.workspaceId, opts.assessmentSubject, now, {
      ...(opts.assessmentTripId ? { tripId: opts.assessmentTripId, tripRevision: opts.assessmentTripRevision ?? 1 } : {}),
    });
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
      scope: decisionScope,
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
  let grantId: string | undefined;
  if (!opts.skipGrants) {
    const issuerPrincipalId = opts.issuerPrincipalId
      ?? await bootstrapTestGrantIssuer(opts.pool, opts.workspaceId, opts.actorId, now, grantScopes);
    const grantIdempotency = randomUUID();
    const grant = mustOk(await issueAuthorityGrant(uow(), {
      workspaceId: opts.workspaceId,
      actorPrincipalId: opts.actorId,
      idempotencyKey: grantIdempotency,
      principalId: opts.principalId,
      representedPartyRef: opts.representedPartyRef,
      issuedByPrincipalId: issuerPrincipalId,
      issuedAt: now,
      // Dispatcher needs dispatch; same principal often also approves → authorize.
      actions: ['action.intent.dispatch', 'action.intent.authorize'],
      scopes: grantScopes,
      authorisingReceipt: { commandNamespace: 'AUTHORITY_GRANT_ISSUED', idempotencyKey: grantIdempotency },
      expectedAggregateRevisions: [],
    }));
    grantId = grant.grantId;
    if (approverPrincipalId !== opts.principalId) {
      const approverIdempotency = randomUUID();
      mustOk(await issueAuthorityGrant(uow(), {
        workspaceId: opts.workspaceId,
        actorPrincipalId: opts.actorId,
        idempotencyKey: approverIdempotency,
        principalId: approverPrincipalId,
        representedPartyRef: opts.representedPartyRef,
        issuedByPrincipalId: issuerPrincipalId,
        issuedAt: now,
        actions: ['action.intent.authorize'],
        scopes: grantScopes,
        authorisingReceipt: { commandNamespace: 'AUTHORITY_GRANT_ISSUED', idempotencyKey: approverIdempotency },
        expectedAggregateRevisions: [],
      }));
    }
  }
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
    actorPrincipalId: approverPrincipalId,
    idempotencyKey: randomUUID(),
    decisionId: row.id,
    requirementId: row.requirement_ids[0]!,
    envelopeFingerprint: fingerprint,
    scope: decisionScope,
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
  return { fingerprint, grantId };
}

/** Persist recovery strategy + strategy_changes so the gate and internal executors can load them. */
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
  opts?: {
    baseManifest?: WorldSnapshotManifest;
    candidateSummaries?: Array<{ subjectRef: TypedRef }>;
  },
): Promise<void> {
  const baseManifest = opts?.baseManifest ?? {
    evaluatedAt: GATE_NOW,
    evaluatorVersions: [],
    aggregateReads: [],
    scopeReads: [],
    evidenceReads: [],
    coverageReads: [],
    missingCoverage: [],
  };
  const candidateSummaries = opts?.candidateSummaries
    ?? scenarioChange.affectedSubjectRefs
      .filter((ref) => ref.kind === 'JOURNEY' || ref.kind === 'TRIP')
      .map((subjectRef) => ({ subjectRef }));
  await pool.query(
    `INSERT INTO recovery_strategies
       (workspace_id, id, recovery_case_id, strategy_version, status, viability,
        base_manifest, scenario_change, candidate_assessment_summaries, created_by_actor_id)
     VALUES ($1, $2, $3, $4, 'SELECTED', 'VIABLE', $5::jsonb, $6::jsonb, $7::jsonb, $8)`,
    [
      workspaceId, scenarioChange.recoveryStrategyId, recoveryCaseId, scenarioChange.strategyVersion,
      JSON.stringify(baseManifest), JSON.stringify(scenarioChange),
      JSON.stringify(candidateSummaries), actorId,
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

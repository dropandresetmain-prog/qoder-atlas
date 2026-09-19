/**
 * C3 canonical database-backed execution gate (AN-1R, AN-6, AN-7).
 *
 * The strategy's base manifest is the currentness boundary for dispatch. The
 * gate never manufactures an assessment or trusts caller-built subjects.
 */
import type { Pool, PoolClient } from '../pool.ts';
import type { TypedRef, SubjectKind } from '../../../domain/v2/shared/identity.ts';
import type { ExactMoney } from '../../../domain/v2/shared/money.ts';
import type { Instant } from '../../../domain/v2/shared/time.ts';
import type {
  AuthorityEnvelope,
  AuthorityDecision,
  Approval,
  ApprovalRevocation,
} from '../../../contracts/v2/authority/authorityEnvelope.ts';
import type { AuthorityGrant } from '../../../domain/v2/people/traveller.ts';
import { WorldSnapshotManifestSchema } from '../../../contracts/v2/scope/readScope.ts';
import { computeEnvelopeFingerprint, type EnvelopeFingerprintInput } from '../../../resolution/authority/envelope.ts';
import {
  AUTHORIZE_ACTION_KIND,
  DISPATCH_ACTION_KIND,
  evaluateConsequentialAuthorization,
  scopeCoversRequired,
  type AuthorizeResult,
} from '../../../resolution/authority/authorize.ts';
import { currentAssessmentView, type AssessmentView } from '../world/pgAssessments.ts';
import { PgCurrentStateReader } from '../world/pgCurrentState.ts';
import { assessManifestCurrentness } from '../../../resolution/world/currentness.ts';
import { compareExactMoney } from '../../../domain/v2/shared/money.ts';
import type { CapabilityKind } from '../../../resolution/execution/capability.ts';
import { observedProgrammeRevisionFromPrerequisites } from './programmeRevisionRefresh.ts';

export { DISPATCH_ACTION_KIND };
export const INTERNAL_PROGRAMME_SCHEDULE_CAPABILITY = 'internal:programme.schedule';

export interface StoredActionIntentRow {
  id: string;
  actionPlanId: string;
  planVersion: number;
  operationNamespace: string;
  logicalOperationKey: string;
  requestFingerprint: string;
  capabilityRef: string;
  subjectRefs: TypedRef[];
  expectedRevisions: { aggregateRef: TypedRef; expectedRevision: number }[];
  preconditions: string[];
  offerFingerprint: string | null;
  costAmount: string | null;
  costCurrency: string | null;
  limits: Record<string, unknown> | null;
  requiredAuthorityScopes: string[];
}

export type ExecutionGateDenial = { allowed: false; reason: string; detail?: string };
export type ExecutionGatePass = {
  allowed: true;
  authorityDecisionId: string;
  envelopeFingerprint: string;
  intent: StoredActionIntentRow;
  capabilityRef: string;
  requestedAmount?: ExactMoney;
};
export type ExecutionGateResult = ExecutionGatePass | ExecutionGateDenial;

const ASSESSABLE_SUBJECT_KINDS: ReadonlySet<SubjectKind> = new Set(['JOURNEY', 'TRIP']);
const SUCCESS_STATUSES = new Set(['OBSERVED_SUCCESS', 'COMPLETED', 'RECONCILED']);
const BLOCKING_STATUSES = new Set([
  'PREPARED', 'CLAIMED', 'DISPATCHING', 'DISPATCHED',
  'OUTCOME_UNKNOWN', 'RECONCILIATION_REQUIRED', ...SUCCESS_STATUSES,
]);
type Queryable = Pick<Pool | PoolClient, 'query'>;

function parseJsonArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

export async function loadStoredIntent(db: Queryable, workspaceId: string, intentId: string): Promise<StoredActionIntentRow | undefined> {
  const result = await db.query<{
    id: string; action_plan_id: string; plan_version: number; operation_namespace: string;
    logical_operation_key: string | null; request_fingerprint: string | null; capability_ref: string;
    subject_refs: unknown; expected_revisions: unknown; preconditions: unknown;
    offer_fingerprint: string | null; cost_amount: string | null; cost_currency: string | null;
    limits: unknown; required_authority_scopes: unknown;
  }>(
    `SELECT i.id, i.action_plan_id, p.plan_version, i.operation_namespace,
            i.logical_operation_key, i.request_fingerprint, i.capability_ref,
            i.subject_refs, i.expected_revisions, i.preconditions, i.offer_fingerprint,
            i.cost_amount::text AS cost_amount, i.cost_currency, i.limits,
            i.required_authority_scopes
       FROM action_intents i
       JOIN action_plans p ON p.workspace_id = i.workspace_id AND p.id = i.action_plan_id
      WHERE i.workspace_id = $1 AND i.id = $2`,
    [workspaceId, intentId],
  );
  const row = result.rows[0];
  if (!row || !row.logical_operation_key || !row.request_fingerprint) return undefined;
  return {
    id: row.id, actionPlanId: row.action_plan_id, planVersion: row.plan_version,
    operationNamespace: row.operation_namespace, logicalOperationKey: row.logical_operation_key,
    requestFingerprint: row.request_fingerprint, capabilityRef: row.capability_ref,
    subjectRefs: parseJsonArray<TypedRef>(row.subject_refs),
    expectedRevisions: parseJsonArray(row.expected_revisions),
    preconditions: parseJsonArray<string>(row.preconditions),
    offerFingerprint: row.offer_fingerprint, costAmount: row.cost_amount, costCurrency: row.cost_currency,
    limits: row.limits as Record<string, unknown> | null,
    requiredAuthorityScopes: parseJsonArray<string>(row.required_authority_scopes),
  };
}

export function buildEnvelopeInput(
  intent: StoredActionIntentRow,
  decision: { scope: TypedRef[]; grantRefs: string[]; ruleInputs: string[]; limits: Record<string, unknown> | null },
  requirements: { actorRole: string }[],
): EnvelopeFingerprintInput {
  const costEstimate = intent.costAmount && intent.costCurrency
    ? { amount: intent.costAmount, currency: intent.costCurrency }
    : undefined;
  return {
    actionPlanId: intent.actionPlanId, actionPlanVersion: intent.planVersion,
    actionIntentId: intent.id, actionIntentVersion: 1,
    requiredActorRoles: requirements.map((r) => r.actorRole).sort(),
    scope: decision.scope,
    ...(decision.limits ? { limits: decision.limits } : intent.limits ? { limits: intent.limits } : {}),
    grantRefs: decision.grantRefs, ruleInputs: decision.ruleInputs,
    ...(costEstimate ? { amountCeiling: costEstimate, costEstimate } : {}),
    ...(intent.offerFingerprint ? { offerFingerprint: intent.offerFingerprint } : {}),
    requestFingerprint: intent.requestFingerprint,
  };
}

async function loadAuthorityBundle(
  db: Queryable, workspaceId: string, intentId: string, envelopeFingerprint: string,
): Promise<{
  decision: AuthorityDecision; envelope: AuthorityEnvelope; approvals: Approval[];
  revocations: ApprovalRevocation[]; decisionId: string;
} | undefined> {
  const decisions = await db.query<{
    id: string; action_plan_id: string; action_plan_version: number; action_intent_id: string;
    action_intent_version: number; group_operator: 'AND' | 'OR'; envelope_fingerprint: string;
    scope: unknown; limits: unknown; grant_refs: unknown; rule_inputs: unknown;
    issued_at: Date; expires_at: Date | null;
  }>(
    `SELECT id, action_plan_id, action_plan_version, action_intent_id, action_intent_version,
            group_operator, envelope_fingerprint, scope, limits, grant_refs, rule_inputs,
            issued_at, expires_at
       FROM authority_decisions
      WHERE workspace_id = $1 AND action_intent_id = $2 AND envelope_fingerprint = $3
      ORDER BY issued_at DESC LIMIT 1`,
    [workspaceId, intentId, envelopeFingerprint],
  );
  const row = decisions.rows[0];
  if (!row) return undefined;
  const requirements = await db.query<{
    id: string; actor_role: string; required_party_kind: string | null; required_party_id: string | null;
  }>(
    `SELECT id, actor_role, required_party_kind, required_party_id
       FROM approval_requirements WHERE workspace_id = $1 AND decision_id = $2`,
    [workspaceId, row.id],
  );
  const approvalsRaw = await db.query<{
    id: string; requirement_id: string; approver_principal_id: string; envelope_fingerprint: string;
    scope: unknown; amount_limit_amount: string | null; amount_limit_currency: string | null; approved_at: Date;
  }>(
    `SELECT id, requirement_id, approver_principal_id, envelope_fingerprint, scope,
            amount_limit_amount::text, amount_limit_currency, approved_at
       FROM approvals WHERE workspace_id = $1 AND decision_id = $2`,
    [workspaceId, row.id],
  );
  const revocationsRaw = await db.query<{
    id: string; approval_id: string; revoked_at: Date; revoked_by_principal_id: string;
  }>(
    `SELECT r.id, r.approval_id, r.revoked_at, r.revoked_by_principal_id
       FROM approval_revocations r
       JOIN approvals a ON a.workspace_id = r.workspace_id AND a.id = r.approval_id
      WHERE r.workspace_id = $1 AND a.decision_id = $2`,
    [workspaceId, row.id],
  );
  const decision: AuthorityDecision = {
    id: row.id, actionPlanId: row.action_plan_id, actionPlanVersion: row.action_plan_version,
    actionIntentId: row.action_intent_id, actionIntentVersion: row.action_intent_version,
    groupOperator: row.group_operator,
    requirements: requirements.rows.map((r) => ({
      id: r.id, actorRole: r.actor_role,
      ...(r.required_party_kind && r.required_party_id
        ? { requiredPartyRef: { kind: r.required_party_kind as SubjectKind, id: r.required_party_id } }
        : {}),
    })),
    ...(row.limits ? { limits: row.limits as Record<string, unknown> } : {}),
  };
  const envelope: AuthorityEnvelope = {
    id: row.id, actionPlanId: row.action_plan_id, actionPlanVersion: row.action_plan_version,
    actionIntentId: row.action_intent_id, actionIntentVersion: row.action_intent_version,
    requiredActors: decision.requirements, scope: parseJsonArray<TypedRef>(row.scope),
    ...(row.limits ? { limits: row.limits as Record<string, unknown> } : {}),
    grantRefs: parseJsonArray<string>(row.grant_refs), ruleInputs: parseJsonArray<string>(row.rule_inputs),
    issuedAt: row.issued_at.toISOString(), ...(row.expires_at ? { expiresAt: row.expires_at.toISOString() } : {}),
    fingerprint: row.envelope_fingerprint,
  };
  const approvals: Approval[] = approvalsRaw.rows.map((a) => ({
    id: a.id, requirementId: a.requirement_id, approverPrincipalId: a.approver_principal_id,
    envelopeFingerprint: a.envelope_fingerprint, scope: parseJsonArray<TypedRef>(a.scope),
    approvedAt: a.approved_at.toISOString(),
    ...(a.amount_limit_amount && a.amount_limit_currency
      ? { amountLimit: { amount: a.amount_limit_amount, currency: a.amount_limit_currency } } : {}),
  }));
  const revocations: ApprovalRevocation[] = revocationsRaw.rows.map((r) => ({
    id: r.id, approvalId: r.approval_id, revokedAt: r.revoked_at.toISOString(),
    revokedByPrincipalId: r.revoked_by_principal_id,
  }));
  return { decision, envelope, approvals, revocations, decisionId: row.id };
}

export async function loadGrantsForPrincipal(db: Queryable, workspaceId: string, principalId: string, now: Instant): Promise<AuthorityGrant[]> {
  const result = await db.query<{
    id: string; principal_id: string; represented_party_kind: string; represented_party_id: string;
    issued_by_principal_id: string; issued_at: Date; expires_at: Date | null; revoked_at: Date | null;
    action_kinds: string[] | null; scope_refs: { kind: SubjectKind; id: string }[] | null;
  }>(
    `SELECT g.id, g.principal_id, g.represented_party_kind, g.represented_party_id,
            g.issued_by_principal_id, g.issued_at, g.expires_at, g.revoked_at,
            (SELECT COALESCE(array_agg(a.action_kind ORDER BY a.action_kind), '{}')
               FROM grant_actions a WHERE a.workspace_id = g.workspace_id AND a.grant_id = g.id) AS action_kinds,
            (SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', s.scope_kind, 'id', s.scope_id)
                                       ORDER BY s.scope_kind, s.scope_id), '[]'::jsonb)
               FROM grant_scopes s WHERE s.workspace_id = g.workspace_id AND s.grant_id = g.id) AS scope_refs
       FROM authority_grants g
      WHERE g.workspace_id = $1 AND g.principal_id = $2 AND g.revoked_at IS NULL
        AND g.issued_at <= $3::timestamptz
        AND (g.expires_at IS NULL OR g.expires_at > $3::timestamptz)`,
    [workspaceId, principalId, now],
  );
  return result.rows.map((row) => ({
    id: row.id, principalId: row.principal_id,
    representedPartyRef: { kind: row.represented_party_kind as SubjectKind, id: row.represented_party_id },
    issuedByPrincipalId: row.issued_by_principal_id, issuedAt: row.issued_at.toISOString(),
    ...(row.expires_at ? { expiresAt: row.expires_at.toISOString() } : {}),
    ...(row.revoked_at ? { revokedAt: row.revoked_at.toISOString() } : {}),
    actions: row.action_kinds ?? [], scopes: (row.scope_refs ?? []).map((s) => ({ kind: s.kind, id: s.id })),
  }));
}

async function loadStrategyForPlan(db: Queryable, workspaceId: string, actionPlanId: string): Promise<{
  scenarioChangeId: string; baseManifest: unknown; candidateSummaries: unknown; strategyId: string;
} | ExecutionGateDenial> {
  const result = await db.query<{
    scenario_change_id: string; recovery_strategy_id: string | null;
    base_manifest: unknown | null; candidate_assessment_summaries: unknown | null;
  }>(
    `SELECT p.scenario_change_id, p.recovery_strategy_id, s.base_manifest, s.candidate_assessment_summaries
       FROM action_plans p
       LEFT JOIN recovery_strategies s ON s.workspace_id = p.workspace_id AND s.id = p.recovery_strategy_id
      WHERE p.workspace_id = $1 AND p.id = $2`,
    [workspaceId, actionPlanId],
  );
  const row = result.rows[0];
  if (!row?.recovery_strategy_id || row.base_manifest === null || row.candidate_assessment_summaries === null) {
    return { allowed: false, reason: 'STRATEGY_MISSING' };
  }
  return {
    scenarioChangeId: row.scenario_change_id, strategyId: row.recovery_strategy_id,
    baseManifest: row.base_manifest, candidateSummaries: row.candidate_assessment_summaries,
  };
}

function subjectRef(value: unknown): TypedRef | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as { kind?: unknown; id?: unknown };
  return typeof candidate.kind === 'string' && typeof candidate.id === 'string'
    ? { kind: candidate.kind as SubjectKind, id: candidate.id } : undefined;
}

async function resolveAssessableSubjects(db: Queryable, workspaceId: string, seeds: TypedRef[]): Promise<TypedRef[]> {
  const resolved = new Map<string, TypedRef>();
  const add = (ref: TypedRef): void => {
    if (ASSESSABLE_SUBJECT_KINDS.has(ref.kind)) resolved.set(`${ref.kind}:${ref.id}`, ref);
  };
  const journeyItems = new Set<string>();
  const travellers = new Set<string>();
  const programmeItems = new Set<string>();
  for (const seed of seeds) {
    if (seed.kind === 'JOURNEY' || seed.kind === 'TRIP') add(seed);
    else if (seed.kind === 'JOURNEY_ITEM') journeyItems.add(seed.id);
    else if (seed.kind === 'TRAVELLER') travellers.add(seed.id);
    else if (seed.kind === 'PROGRAMME_ITEM') programmeItems.add(seed.id);
  }
  for (const id of [...journeyItems].sort()) {
    const result = await db.query<{ journey_id: string }>(
      'SELECT journey_id FROM journey_items WHERE workspace_id = $1 AND id = $2', [workspaceId, id],
    );
    for (const row of result.rows) add({ kind: 'JOURNEY', id: row.journey_id });
  }
  for (const id of [...travellers].sort()) {
    const result = await db.query<{ id: string }>(
      'SELECT id FROM journeys WHERE workspace_id = $1 AND traveller_id = $2', [workspaceId, id],
    );
    for (const row of result.rows) add({ kind: 'JOURNEY', id: row.id });
  }
  for (const id of [...programmeItems].sort()) {
    const result = await db.query<{ journey_id: string }>(
      `SELECT DISTINCT j.id AS journey_id
         FROM participations p
         JOIN journeys j ON j.workspace_id = p.workspace_id AND j.traveller_id = p.traveller_id
        WHERE p.workspace_id = $1 AND p.programme_item_id = $2`,
      [workspaceId, id],
    );
    for (const row of result.rows) add({ kind: 'JOURNEY', id: row.journey_id });
  }
  return [...resolved.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
}

/**
 * Deterministic authority subjects for an intent: stored subject_refs ∪
 * JOURNEY/TRIP subjects resolved from strategy affected/candidate data.
 * No caller or decision-issuer input.
 */
export function requiredAuthorityScope(
  intentSubjectRefs: readonly TypedRef[],
  resolvedAssessableSubjects: readonly TypedRef[],
): TypedRef[] {
  const map = new Map<string, TypedRef>();
  const journeyResolved = resolvedAssessableSubjects.some((ref) => ref.kind === 'JOURNEY');
  for (const ref of [...intentSubjectRefs, ...resolvedAssessableSubjects]) {
    // R4-F2: a SELECT_OFFER intent names an OFFER (a content-hash offer key, not a
    // registered subject: no grant can enumerate it; its identity and price are
    // bound by the envelope's offerFingerprint/requestFingerprint instead) and
    // the JOURNEY_ITEM it acts on. Authority for an item is authority over the
    // JOURNEY that owns it (already in the resolved set), so neither is an
    // independent exact-coverage requirement.
    if (ref.kind === 'OFFER') continue;
    if (ref.kind === 'JOURNEY_ITEM' && journeyResolved) continue;
    map.set(`${ref.kind}:${ref.id}`, ref);
  }
  return [...map.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
}

async function loadStrategySubjectSeeds(
  db: Queryable, workspaceId: string, strategy: { strategyId: string; scenarioChangeId: string; candidateSummaries: unknown },
): Promise<TypedRef[]> {
  const affected = await db.query<{ affected_subjects: unknown }>(
    `SELECT affected_subjects FROM strategy_changes
      WHERE workspace_id = $1 AND recovery_strategy_id = $2 AND scenario_change_id = $3`,
    [workspaceId, strategy.strategyId, strategy.scenarioChangeId],
  );
  const seeds = affected.rows.flatMap((row) => parseJsonArray<TypedRef>(row.affected_subjects));
  for (const summary of parseJsonArray<{ subjectRef?: unknown }>(strategy.candidateSummaries)) {
    const ref = subjectRef(summary.subjectRef);
    if (ref) seeds.push(ref);
  }
  return seeds;
}

/** Load the deterministic required authority scope for a stored intent (AN-7R). */
export async function loadRequiredAuthorityScope(
  pool: Pool | PoolClient,
  workspaceId: string,
  intentId: string,
): Promise<TypedRef[] | ExecutionGateDenial> {
  const intent = await loadStoredIntent(pool, workspaceId, intentId);
  if (!intent) return { allowed: false, reason: 'INTENT_MISSING' };
  const strategy = await loadStrategyForPlan(pool, workspaceId, intent.actionPlanId);
  if ('allowed' in strategy) return strategy;
  const seeds = await loadStrategySubjectSeeds(pool, workspaceId, strategy);
  const assessable = await resolveAssessableSubjects(pool, workspaceId, seeds);
  const required = requiredAuthorityScope(intent.subjectRefs, assessable);
  if (required.length === 0) {
    return { allowed: false, reason: 'ASSESSMENT_SUBJECTS_UNRESOLVED', detail: 'required authority scope is empty' };
  }
  return required;
}

async function requireAllAssessmentsCurrent(
  pool: Pool | PoolClient, workspaceId: string, subjects: TypedRef[], now: Instant,
): Promise<AssessmentView | ExecutionGateDenial> {
  if (subjects.length === 0) return { allowed: false, reason: 'ASSESSMENT_SUBJECTS_UNRESOLVED' };
  let primaryView: AssessmentView | undefined;
  for (const subject of subjects) {
    const view = await currentAssessmentView(pool, workspaceId, subject, 'VIABILITY', now);
    if (view.status !== 'CURRENT' || view.assessment === undefined) {
      return { allowed: false, reason: 'ASSESSMENT_NOT_CURRENT', detail: `${subject.kind}:${subject.id} is ${view.status}` };
    }
    primaryView ??= view;
  }
  return primaryView!;
}

async function requireBudgetHold(
  db: Queryable, workspaceId: string, intent: StoredActionIntentRow,
): Promise<ExecutionGateDenial | { ok: true; hold: ExactMoney }> {
  if (!intent.costAmount || !intent.costCurrency) return { ok: true, hold: { amount: '0', currency: 'USD' } };
  const expected: ExactMoney = { amount: intent.costAmount, currency: intent.costCurrency };
  const holds = await db.query<{ amount: string; currency: string }>(
    `SELECT amount::text AS amount, currency FROM budget_commitments
      WHERE workspace_id = $1 AND action_intent_id = $2 AND status = 'HELD'`,
    [workspaceId, intent.id],
  );
  if (holds.rows.length === 0) {
    return { allowed: false, reason: 'BUDGET_HOLD_MISSING', detail: 'costed intent requires a HELD budget commitment' };
  }
  const matching = holds.rows.find(
    (h) => h.currency === expected.currency && compareExactMoney({ amount: h.amount, currency: h.currency }, expected) === 0,
  );
  if (!matching) return { allowed: false, reason: 'BUDGET_HOLD_MISMATCH', detail: 'held amount/currency does not match stored intent cost' };
  return { ok: true, hold: expected };
}

export function externalCapabilityKindFromRef(capabilityRef: string): CapabilityKind | undefined {
  if (capabilityRef.startsWith('internal:')) return undefined;
  if (capabilityRef === 'external:offer.select') return 'BOOK';
  if (capabilityRef.includes('RESERVATION') || capabilityRef.includes('BOOK')) return 'BOOK';
  if (capabilityRef.includes('CANCEL')) return 'CANCEL';
  if (capabilityRef.includes('MODIFY') || capabilityRef.includes('SERVICE')) return 'SERVICE';
  if (capabilityRef.includes('OBSERVE')) return 'OBSERVE';
  return 'SERVICE';
}
export function isInternalCapability(capabilityRef: string): boolean {
  return capabilityRef.startsWith('internal:');
}

export async function evaluateStoredExecutionGate(
  pool: Pool | PoolClient,
  params: { workspaceId: string; intentId: string; principalId: string; now: Instant; requiredCapabilityRef?: string },
): Promise<ExecutionGateResult> {
  const intent = await loadStoredIntent(pool, params.workspaceId, params.intentId);
  if (!intent) return { allowed: false, reason: 'INTENT_MISSING' };
  if (params.requiredCapabilityRef && intent.capabilityRef !== params.requiredCapabilityRef) {
    return { allowed: false, reason: 'CAPABILITY_MISMATCH', detail: `intent capability ${intent.capabilityRef} != required ${params.requiredCapabilityRef}` };
  }
  const strategy = await loadStrategyForPlan(pool, params.workspaceId, intent.actionPlanId);
  if ('allowed' in strategy) return strategy;
  const manifestValue = typeof strategy.baseManifest === 'string'
    ? (() => { try { return JSON.parse(strategy.baseManifest); } catch { return strategy.baseManifest; } })()
    : strategy.baseManifest;
  const parsedManifest = WorldSnapshotManifestSchema.safeParse(manifestValue);
  if (!parsedManifest.success) return { allowed: false, reason: 'INVALID_BASE_MANIFEST', detail: parsedManifest.error.message };
  const manifest = parsedManifest.data;
  if (manifest.aggregateReads.length === 0 && manifest.scopeReads.length === 0) {
    return { allowed: false, reason: 'EMPTY_BASE_MANIFEST' };
  }
  const state = await new PgCurrentStateReader(pool).loadFor(params.workspaceId, manifest);
  const currentness = assessManifestCurrentness(manifest, state, params.now);
  if (!currentness.current) {
    // Narrow exemption: a dependent intent may see AGGREGATE_ADVANCED /
    // SCOPE_ADVANCED vs the original strategy base manifest when a same-plan
    // prerequisite already observed a Programme mutation (schedule updates
    // advance both the aggregate head and the PROGRAMME scope generation).
    // Allow only when every such reason is explained by that durable
    // observation matching the current head/generation. External concurrent
    // advances still fail closed.
    //
    // STALE_BASE hardening (M10): this is provably attributable to the same
    // valid execution chain, not merely "observed == current head" by
    // coincidence, because `observedProgrammeRevisionFromPrerequisites`
    // requires an actual `action_dependencies` edge into this intent from
    // the prerequisite — and migration 0113's `action_dependencies_same_plan`
    // trigger makes it impossible for that edge to reference an intent
    // outside this intent's own `action_plan_id` (raises at INSERT/UPDATE).
    // Combined with CAS-protected revision increments (a given revision
    // number is produced by exactly one committed write, ever), "the
    // prerequisite's own recorded observation equals the current head" can
    // only be true if that prerequisite's write was in fact the write that
    // produced the current head. A replanned/superseded plan gets fresh
    // action_intents rows, so old dependency edges can never satisfy a new
    // plan's lookup (`d.to_action_intent_id` never matches). An external or
    // unrelated concurrent mutation has no corresponding plan-scoped
    // dependency edge at all, so `observed` stays `undefined` and the reason
    // is left unexplained below.
    const unexplained: typeof currentness.reasons = [];
    for (const reason of currentness.reasons) {
      // R4-F2: a costed intent's own approval-time budget HOLD advances the Budget
      // aggregate the strategy base manifest read. Explained ONLY when this intent
      // itself holds a HELD commitment on that budget and every intervening revision
      // is a BUDGET_HOLD_CREATED change record (never an edit, release or other write).
      // Holds by other actions do not weaken this intent's own reserved funds.
      if (reason.kind === 'AGGREGATE_ADVANCED' && reason.aggregateRef.kind === 'BUDGET') {
        const own = await pool.query(
          `SELECT 1 FROM budget_commitments WHERE workspace_id = $1 AND budget_id = $2 AND action_intent_id = $3 AND status = 'HELD'`,
          [params.workspaceId, reason.aggregateRef.id, intent.id],
        );
        const intervening = await pool.query<{ n: string; holds: string }>(
          `SELECT count(*)::text AS n, count(*) FILTER (WHERE command_namespace = 'BUDGET_HOLD_CREATED')::text AS holds
             FROM change_records
            WHERE workspace_id = $1 AND subject_kind = 'BUDGET' AND subject_id = $2 AND after_revision > $3 AND after_revision <= $4`,
          [params.workspaceId, reason.aggregateRef.id, reason.readRevision, reason.currentRevision],
        );
        const row = intervening.rows[0]!;
        if ((own.rowCount ?? 0) > 0 && Number(row.n) === reason.currentRevision - reason.readRevision && row.n === row.holds) continue;
        unexplained.push(reason);
        continue;
      }
      if (reason.kind === 'AGGREGATE_ADVANCED' && reason.aggregateRef.kind === 'PROGRAMME') {
        const observed = await observedProgrammeRevisionFromPrerequisites(
          pool, params.workspaceId, intent.id, reason.aggregateRef.id,
        );
        if (observed !== undefined && observed === reason.currentRevision) continue;
        unexplained.push(reason);
        continue;
      }
      if (reason.kind === 'SCOPE_ADVANCED' && reason.scopeKind === 'PROGRAMME') {
        const observed = await observedProgrammeRevisionFromPrerequisites(
          pool, params.workspaceId, intent.id, reason.scopeId,
        );
        // Programme schedule mutation advances scope generation in lockstep
        // with the aggregate revision in the accepted M4 command path.
        if (observed !== undefined && observed === reason.currentGeneration) continue;
        unexplained.push(reason);
        continue;
      }
      unexplained.push(reason);
    }
    if (unexplained.length > 0) {
      return { allowed: false, reason: 'STALE_BASE', detail: JSON.stringify(currentness.reasons) };
    }
  }

  const decisionRow = await pool.query<{
    id: string; scope: unknown; limits: unknown; grant_refs: unknown; rule_inputs: unknown; group_operator: 'AND' | 'OR';
  }>(
    `SELECT id, scope, limits, grant_refs, rule_inputs, group_operator FROM authority_decisions
      WHERE workspace_id = $1 AND action_intent_id = $2 ORDER BY issued_at DESC LIMIT 1`,
    [params.workspaceId, params.intentId],
  );
  const decisionMeta = decisionRow.rows[0];
  if (!decisionMeta) return { allowed: false, reason: 'AUTHORITY_MISSING', detail: 'no persisted authority decision for intent' };
  const requirements = await pool.query<{ actor_role: string }>(
    'SELECT actor_role FROM approval_requirements WHERE workspace_id = $1 AND decision_id = $2',
    [params.workspaceId, decisionMeta.id],
  );
  const envelopeInput = buildEnvelopeInput(intent, {
    scope: parseJsonArray<TypedRef>(decisionMeta.scope),
    grantRefs: parseJsonArray<string>(decisionMeta.grant_refs),
    ruleInputs: parseJsonArray<string>(decisionMeta.rule_inputs),
    limits: decisionMeta.limits as Record<string, unknown> | null,
  }, requirements.rows.map((r) => ({ actorRole: r.actor_role })));
  const fingerprint = computeEnvelopeFingerprint(envelopeInput);
  const bundle = await loadAuthorityBundle(pool, params.workspaceId, params.intentId, fingerprint);
  if (!bundle) return { allowed: false, reason: 'ENVELOPE_MISMATCH', detail: 'stored authority does not match compiled intent envelope' };

  const affected = await pool.query<{ affected_subjects: unknown }>(
    `SELECT affected_subjects FROM strategy_changes
      WHERE workspace_id = $1 AND recovery_strategy_id = $2 AND scenario_change_id = $3`,
    [params.workspaceId, strategy.strategyId, strategy.scenarioChangeId],
  );
  const seeds = affected.rows.flatMap((row) => parseJsonArray<TypedRef>(row.affected_subjects));
  for (const summary of parseJsonArray<{ subjectRef?: unknown }>(strategy.candidateSummaries)) {
    const ref = subjectRef(summary.subjectRef);
    if (ref) seeds.push(ref);
  }
  const subjects = await resolveAssessableSubjects(pool, params.workspaceId, seeds);
  const assessmentView = await requireAllAssessmentsCurrent(pool, params.workspaceId, subjects, params.now);
  if ('allowed' in assessmentView && assessmentView.allowed === false) return assessmentView;

  const requiredScopes = requiredAuthorityScope(intent.subjectRefs, subjects);
  if (requiredScopes.length === 0) {
    return { allowed: false, reason: 'ASSESSMENT_SUBJECTS_UNRESOLVED', detail: 'required authority scope is empty' };
  }
  const decisionScope = parseJsonArray<TypedRef>(decisionMeta.scope);
  if (!scopeCoversRequired(decisionScope, requiredScopes)) {
    return {
      allowed: false,
      reason: 'DECISION_SCOPE_INSUFFICIENT',
      detail: 'decision scope does not cover required authority subjects',
    };
  }

  const principalIds = new Set([params.principalId, ...bundle.approvals.map((approval) => approval.approverPrincipalId)]);
  const grants = (await Promise.all(
    [...principalIds].sort().map((principalId) => loadGrantsForPrincipal(pool, params.workspaceId, principalId, params.now)),
  )).flat();
  const requestedAmount = intent.costAmount && intent.costCurrency
    ? { amount: intent.costAmount, currency: intent.costCurrency } : undefined;
  const auth: AuthorizeResult = evaluateConsequentialAuthorization({
    assessmentView: assessmentView as AssessmentView, envelopeInput, envelope: bundle.envelope,
    decision: bundle.decision, approvals: bundle.approvals, revocations: bundle.revocations,
    grants, requiredActionKind: DISPATCH_ACTION_KIND, principalId: params.principalId, now: params.now,
    requiredAuthorityScopes: requiredScopes,
    ...(requestedAmount ? { requestedAmount } : {}),
  });
  if (!auth.allowed) return { allowed: false, reason: auth.reason, detail: auth.detail };
  const budget = await requireBudgetHold(pool, params.workspaceId, intent);
  if ('allowed' in budget) return budget;
  return {
    allowed: true, authorityDecisionId: bundle.decisionId, envelopeFingerprint: fingerprint,
    intent, capabilityRef: intent.capabilityRef, ...(requestedAmount ? { requestedAmount } : {}),
  };
}

export async function findKnownSuccessAttempt(
  db: Queryable, workspaceId: string, logicalOperationKey: string, requestFingerprint: string,
): Promise<{ id: string; status: string } | undefined> {
  const result = await db.query<{ id: string; status: string }>(
    `SELECT id, status FROM execution_attempts
      WHERE workspace_id = $1 AND logical_operation_key = $2 AND request_fingerprint = $3
        AND status = ANY($4::text[]) ORDER BY created_at DESC LIMIT 1`,
    [workspaceId, logicalOperationKey, requestFingerprint, [...SUCCESS_STATUSES]],
  );
  return result.rows[0];
}

export async function findBlockingAttempt(
  db: Queryable, workspaceId: string, logicalOperationKey: string, requestFingerprint: string,
): Promise<{ id: string; status: string; request_fingerprint: string } | undefined> {
  const result = await db.query<{ id: string; status: string; request_fingerprint: string }>(
    `SELECT id, status, request_fingerprint FROM execution_attempts
      WHERE workspace_id = $1 AND logical_operation_key = $2 AND status = ANY($3::text[])
      ORDER BY created_at DESC LIMIT 1`,
    [workspaceId, logicalOperationKey, [...BLOCKING_STATUSES]],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  if (row.request_fingerprint !== requestFingerprint) return row;
  if (SUCCESS_STATUSES.has(row.status)) return row;
  return row;
}

export { AUTHORIZE_ACTION_KIND, BLOCKING_STATUSES, SUCCESS_STATUSES };

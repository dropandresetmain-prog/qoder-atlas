/**
 * Assemble product read-model facts from PostgreSQL (or in-memory inputs).
 *
 * Pure projectors stay in project*.ts — this module owns I/O and joins.
 * Missing tables/rows yield UNKNOWN / empty arrays — never invented certainty.
 */
import type { Pool, PoolClient } from '../../../persistence/postgres/pool.ts';
import type {
  AssessmentTone,
  AssessmentViewStatus,
  ConnectionProgression,
  RemainderViability,
} from '../../../contracts/v2/product/readModels.ts';
import type {
  IncidentProgrammeFacts,
  OperatorOverviewFacts,
  RecoveryActionFact,
  RecoveryCaseFacts,
  TravellerTripFacts,
} from './types.ts';
import { mapConnectionProgression, deriveConnectionViabilityFromEvaluator, type ConnectionViabilityHint } from './mapConnectionProgression.ts';
import {
  evaluateSharedDisruptionCohort,
  type CohortTravellerEvaluationInput,
} from '../cohortDisruption.ts';
import { currentAssessmentView } from '../../../persistence/postgres/world/pgAssessments.ts';
import type { TypedRef } from '../../../domain/v2/shared/identity.ts';

function isoNow(at?: string): string {
  return at ?? new Date().toISOString();
}

/** Either a checked-out client already inside a transaction, or a bare pool. */
export type Queryable = Pool | PoolClient;

const MAX_SAFE_STAMP = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Never silently truncate an xid8-derived stamp into the public `number`
 * `projectionRevision` field — throw loudly instead. In practice this never
 * fires: xid8 is a per-database transaction counter, nowhere near 2^53.
 */
function checkedRevisionNumber(stamp: bigint): number {
  if (stamp > MAX_SAFE_STAMP) {
    throw new Error(`EVALUATION_LIFECYCLE stamp ${stamp} exceeds Number.MAX_SAFE_INTEGER — cannot report as projectionRevision`);
  }
  return Number(stamp);
}

/** Shared PASS/FAIL/UNKNOWN -> node semanticState mapping (FIG-6 fidelity). */
const TONE_TO_STATE = { PASS: 'HEALTHY', FAIL: 'FAILED', UNKNOWN: 'UNKNOWN' } as const;

/**
 * Defect-1 fix. Stamps are `pg_current_xact_id()`, assigned at a
 * transaction's first write, not at commit — a transaction that starts
 * first (lower xid) but commits later than one that started after it can
 * make `stamp > sinceRevision` (comparing only the last-seen max) miss the
 * later commit forever, and independent autocommit `pool.query` calls can
 * each see a different snapshot within one logical read. The fix: every
 * projection read that must be internally consistent and must not miss a
 * change now runs inside one REPEATABLE READ transaction on a single
 * checked-out client. The transaction's own snapshot xmin, read as the first
 * statement (so it fixes the REPEATABLE READ snapshot), becomes the opaque
 * `changeCursor` returned to the caller: any transaction whose stamp is >=
 * that xmin might not have been visible yet at read time, so a caller
 * comparing a later read's stamps against this cursor with `>=` (never `>`)
 * can miss nothing — at-least-once, never zero times (a ref may be reported
 * twice; it is never silently dropped). READ ONLY because every caller here
 * only ever reads.
 */
export async function withProjectionSnapshot<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<{ value: T; changeCursor: string }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snap = await client.query<{ xmin: string }>(
      'SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS xmin',
    );
    const changeCursor = snap.rows[0]!.xmin;
    const value = await fn(client);
    await client.query('COMMIT');
    return { value, changeCursor };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * FIG-3 revision source, defect-1 corrected. `EVALUATION_LIFECYCLE`
 * (migrations 0121/0122/0123) is a scope_generations family bumped only by
 * the assessments/scheduled_reassessments triggers (per subject), the
 * recovery_cases trigger (per case) and the case-content triggers (0123:
 * action plans/intents/dependencies, execution attempts/observations,
 * strategies, case subjects) — deliberately never read by assessment_inputs
 * so it cannot feed the M6 invalidation triggers. Returns the raw
 * `last_advanced_xact` xid8 stamp as a `bigint` (via `::text` -> `BigInt`,
 * never through a JS `Number`, so no magnitude is ever silently truncated):
 * xid8 is a per-database, globally unique, strictly increasing value, so two
 * different real changes can never tie — a `>=` comparison against a
 * caller-supplied cursor, and a `MAX` across many subjects' values, both stay
 * exact at any scale. Read directly here (not through
 * PgScopeGenerationLedger/ScopeGenerationRef, which is typed to the general
 * invalidation-scope enum) to keep the isolation from assessment_inputs
 * explicit and unreachable from the general scope API. Must run against a
 * client already inside the caller's `withProjectionSnapshot` transaction —
 * never a bare pool — or its read can land on a different snapshot than the
 * rest of the projection.
 */
export async function readEvaluationLifecycleStamp(
  client: Queryable,
  workspaceId: string,
  subjectKind: string,
  subjectId: string,
  assessmentKind: string,
): Promise<bigint> {
  const result = await client.query<{ xact: string }>(
    `SELECT last_advanced_xact::text AS xact FROM scope_generations
      WHERE workspace_id = $1 AND scope_kind = 'EVALUATION_LIFECYCLE' AND scope_id = $2`,
    [workspaceId, `${subjectKind}:${subjectId}:${assessmentKind}`],
  );
  return result.rows[0] ? BigInt(result.rows[0].xact) : 0n;
}

export async function loadRecoveryActionFacts(
  pool: Queryable,
  workspaceId: string,
  caseId: string,
): Promise<RecoveryActionFact[]> {
  const plans = await pool.query<{ id: string }>(
    `SELECT id FROM action_plans WHERE workspace_id = $1 AND recovery_case_id = $2 ORDER BY plan_version`,
    [workspaceId, caseId],
  );
  if (plans.rows.length === 0) return [];

  const planIds = plans.rows.map((r) => r.id);
  const intents = await pool.query<{
    id: string;
    action_plan_id: string;
    capability_ref: string;
    status: string;
    cost_amount: string | null;
    cost_currency: string | null;
    required_authority_scopes: unknown;
    subject_refs: unknown;
  }>(
    `SELECT id, action_plan_id, capability_ref, status, cost_amount::text AS cost_amount, cost_currency,
            required_authority_scopes, subject_refs
       FROM action_intents
      WHERE workspace_id = $1 AND action_plan_id = ANY($2::uuid[])
      ORDER BY id`,
    [workspaceId, planIds],
  );

  const deps = await pool.query<{ from_action_intent_id: string; to_action_intent_id: string }>(
    `SELECT from_action_intent_id, to_action_intent_id
       FROM action_dependencies
      WHERE workspace_id = $1 AND action_plan_id = ANY($2::uuid[])`,
    [workspaceId, planIds],
  );

  const attempts = await pool.query<{
    action_intent_id: string;
    status: string;
  }>(
    `SELECT action_intent_id, status FROM execution_attempts
      WHERE workspace_id = $1 AND action_intent_id = ANY($2::uuid[])
      ORDER BY attempt_number DESC`,
    [workspaceId, intents.rows.map((i) => i.id)],
  );

  // Presence of an observation row (origin) is not the outcome — the actual
  // outcome lives on the linked execution_attempts.status. Join through
  // attempt_id so we never collapse FAILED/CANCELLED into "CONFIRMED" just
  // because an observation exists (see M9 C4 finding on observation projection).
  const observations = await pool.query<{
    action_intent_id: string;
    attempt_status: string;
  }>(
    `SELECT o.action_intent_id, ea.status AS attempt_status
       FROM execution_observations o
       JOIN execution_attempts ea
         ON ea.workspace_id = o.workspace_id AND ea.id = o.attempt_id
      WHERE o.workspace_id = $1 AND o.action_intent_id = ANY($2::uuid[])
      ORDER BY o.observed_at DESC`,
    [workspaceId, intents.rows.map((i) => i.id)],
  );

  const dependsOn = new Map<string, string[]>();
  for (const d of deps.rows) {
    // from must complete before to → to depends on from
    const list = dependsOn.get(d.to_action_intent_id) ?? [];
    list.push(d.from_action_intent_id);
    dependsOn.set(d.to_action_intent_id, list);
  }

  const latestAttempt = new Map<string, string>();
  for (const a of attempts.rows) {
    if (!latestAttempt.has(a.action_intent_id)) latestAttempt.set(a.action_intent_id, a.status);
  }
  // Real recorded outcome per intent — derived from the linked attempt's
  // status (never from observation "origin" alone, which says who reported
  // it, not what happened). Capability semantics (cancel vs book/modify)
  // decide whether an OBSERVED_SUCCESS reads as CONFIRMED or CANCELLED.
  const latestObs = new Map<string, string>();
  for (const o of observations.rows) {
    if (!latestObs.has(o.action_intent_id)) latestObs.set(o.action_intent_id, o.attempt_status);
  }

  return intents.rows.map((intent, index): RecoveryActionFact => {
    const capability = intent.capability_ref;
    const isCancelCapability = /cancel/i.test(capability);
    const domain = capability.includes('hotel') || capability.includes('stay')
      ? 'stay'
      : capability.includes('flight') || capability.includes('transport')
        ? 'travel'
        : capability.includes('programme')
          ? 'programme'
          : capability.includes('transfer') || capability.includes('ground')
            ? 'ground_transfer'
            : 'other';
    const subjectRefs = Array.isArray(intent.subject_refs)
      ? (intent.subject_refs as { kind?: string; id?: string }[]).map((s) => `${s.kind ?? 'SUBJECT'}:${s.id ?? ''}`)
      : [];
    const attemptStatus = latestAttempt.get(intent.id);
    const observedAttemptStatus = latestObs.get(intent.id);
    const obs = deriveObservationResult(observedAttemptStatus ?? attemptStatus, isCancelCapability);
    const executionState = mapIntentExecutionState(intent.status, attemptStatus, obs);
    const cost = intent.cost_amount && intent.cost_currency
      ? { amount: String(intent.cost_amount), currency: String(intent.cost_currency) }
      : undefined;

    return {
      actionRef: intent.id,
      domain,
      capability,
      subjectRefs,
      ...(cost ? { cost } : {}),
      authorityState: Array.isArray(intent.required_authority_scopes) && intent.required_authority_scopes.length > 0
        ? 'scopes_required'
        : 'none_required',
      dependencyOrder: index,
      dependsOnActionRefs: dependsOn.get(intent.id) ?? [],
      executionState,
      ...(obs ? { observationResult: obs } : {}),
      uncertainty: executionState === 'OUTCOME_UNKNOWN' ? ['execution outcome unknown'] : [],
    };
  });
}

/**
 * Map a durable execution_attempts.status to the actual recorded outcome —
 * never invent CONFIRMED from the mere presence of an observation row.
 * A successful cancel-shaped capability reads as CANCELLED, not CONFIRMED.
 */
function deriveObservationResult(
  attemptStatus: string | undefined,
  isCancelCapability: boolean,
): string | undefined {
  switch (attemptStatus) {
    case 'OBSERVED_SUCCESS':
    case 'RECONCILED':
    case 'COMPLETED':
      return isCancelCapability ? 'CANCELLED' : 'CONFIRMED';
    case 'OBSERVED_FAILURE':
    case 'FAILED':
      return 'FAILED';
    case 'OUTCOME_UNKNOWN':
    case 'RECONCILIATION_REQUIRED':
      return 'OUTCOME_UNKNOWN';
    default:
      return undefined;
  }
}

function mapIntentExecutionState(
  intentStatus: string,
  attemptStatus: string | undefined,
  observation: string | undefined,
): RecoveryActionFact['executionState'] {
  const obs = (observation ?? '').toUpperCase();
  if (obs.includes('FAIL') || attemptStatus === 'FAILED' || intentStatus === 'FAILED') return 'FAILED';
  if (obs.includes('UNKNOWN')) return 'OUTCOME_UNKNOWN';
  if (
    attemptStatus === 'OBSERVED_SUCCESS'
    || obs === 'CONFIRMED'
    || obs === 'CANCELLED'
    || obs === 'SUCCEEDED'
    || intentStatus === 'COMPLETED'
    || intentStatus === 'EXECUTED'
  ) {
    return 'COMPLETED';
  }
  if (attemptStatus === 'RUNNING' || intentStatus === 'EXECUTING') return 'EXECUTING';
  if (intentStatus === 'AUTHORIZED' || intentStatus === 'AUTHORISED') return 'AUTHORIZED';
  if (intentStatus === 'REJECTED') return 'REJECTED';
  if (intentStatus === 'SUPERSEDED') return 'SUPERSEDED';
  if (attemptStatus) return 'RECONCILING';
  return 'PROPOSED';
}

/**
 * Defect-1 fix: the actual query/join logic, run against a client already
 * inside the caller's `withProjectionSnapshot` transaction. Never call this
 * directly against a bare `Pool` — use `loadRecoveryCaseFacts` below, or (for
 * a caller that must read several cases/subjects under one shared snapshot,
 * e.g. the overview or incident-programme producers) open the transaction
 * once and call this per case within it.
 */
async function loadRecoveryCaseFactsInner(
  client: Queryable,
  workspaceId: string,
  caseId: string,
  at: string | undefined,
  /**
   * FIG-3/defect-1: when supplied, changedVisibleRefs names exactly the refs
   * whose own revision source (see readEvaluationLifecycleStamp) is >= this
   * cursor (at-least-once — never "every ref" or an unrelated id list).
   * Omitted on a first read, which honestly reports nothing changed (no
   * prior cursor to compare against) rather than everything.
   */
  sinceCursor: string | undefined,
): Promise<RecoveryCaseFacts | null> {
  const caseRow = await client.query<{
    id: string;
    lifecycle_status: string;
    opened_at: string;
    closed_at: string | null;
  }>(
    `SELECT id, lifecycle_status, opened_at, closed_at FROM recovery_cases WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, caseId],
  );
  const row = caseRow.rows[0];
  if (!row) return null;

  // FIG-3: the case's own revision source (0122's recovery_cases trigger;
  // 0123's case-content triggers), on the same global scale as each
  // subject's (see readEvaluationLifecycleStamp).
  const caseStamp = await readEvaluationLifecycleStamp(client, workspaceId, 'RECOVERY_CASE', caseId, 'CASE');
  const recoveryActions = await loadRecoveryActionFacts(client, workspaceId, caseId);
  const generatedAt = isoNow(at);

  const strategyRows = await client.query<{
    id: string;
    strategy_version: number;
    viability: string;
    status: string;
    candidate_assessment_summaries: unknown;
  }>(
    `SELECT id, strategy_version, viability, status, candidate_assessment_summaries
       FROM recovery_strategies
      WHERE workspace_id = $1 AND recovery_case_id = $2
      ORDER BY strategy_version DESC`,
    [workspaceId, caseId],
  );
  const strategies = strategyRows.rows.map((s) => {
    const summaries = Array.isArray(s.candidate_assessment_summaries)
      ? (s.candidate_assessment_summaries as { personLabel?: string; verdict?: string }[])
      : [];
    return {
      strategyRef: s.id,
      version: s.strategy_version,
      viability: s.viability,
      status: s.status,
      projectedPeople: summaries.map((row) => ({
        personLabel: row.personLabel ?? 'Traveller',
        verdict: (row.verdict === 'PASS' || row.verdict === 'FAIL' || row.verdict === 'UNKNOWN'
          ? row.verdict
          : 'UNKNOWN') as AssessmentTone,
      })),
    };
  });

  // Assessments for case subjects — best-effort. ORDER BY is required (FIG-1):
  // without it, edge/node array order (and any position-derived key) can
  // change between reads of the same content, causing false delete/recreate.
  const subjects = await client.query<{ subject_kind: string; subject_id: string; role: string }>(
    `SELECT subject_kind, subject_id, role FROM case_subjects
      WHERE workspace_id = $1 AND recovery_case_id = $2
      ORDER BY subject_kind, subject_id, role`,
    [workspaceId, caseId],
  );

  let tripVerdict: AssessmentTone = 'UNKNOWN';
  const uncertainty: string[] = [];
  if (subjects.rows.length === 0) uncertainty.push('no case subjects attached');

  // Per-subject CURRENT-assessment semantics (never "latest N assessments
  // across every subject" — an old superseded verdict must never decide the
  // case). CURRENT+PASS -> PASS, CURRENT+FAIL -> FAIL; STALE /
  // PENDING_REASSESSMENT / UNAVAILABLE / NONE all read as UNKNOWN with an
  // explicit staleness note (see M9 C4 current-assessment finding). Each
  // subject keeps its own tone/evaluation status (FIG-6/FIG-7) — the case's
  // aggregate verdict below must never be copied back onto every subject node.
  interface SubjectFact { ref: string; tone: AssessmentTone; evaluation: AssessmentViewStatus; stamp: bigint }
  const subjectFacts: SubjectFact[] = [];
  // M9 3A: derive connection viability from the real m6.connection dimension
  // (never a caller-supplied SAFE/AT_RISK/IMPOSSIBLE hint). Worst-of across
  // case subjects — one broken connection is enough to flag the case.
  const CONNECTION_SEVERITY: Record<ConnectionViabilityHint, number> = { VIABLE: 0, UNKNOWN: 1, TIGHT: 2, IMPOSSIBLE: 3 };
  let connectionViability: ConnectionViabilityHint | undefined;
  for (const s of subjects.rows) {
    const ref = `${s.subject_kind}:${s.subject_id}`;
    const stamp = await readEvaluationLifecycleStamp(client, workspaceId, s.subject_kind, s.subject_id, 'VIABILITY');
    const view = await currentAssessmentView(
      client,
      workspaceId,
      { kind: s.subject_kind, id: s.subject_id } as TypedRef,
      'VIABILITY',
      generatedAt,
    );
    if (view.status === 'CURRENT' && view.assessment) {
      const verdict = view.assessment.overallVerdict;
      const tone: AssessmentTone = verdict === 'PASS' ? 'PASS' : verdict === 'FAIL' ? 'FAIL' : 'UNKNOWN';
      subjectFacts.push({ ref, tone, evaluation: view.status, stamp });
      if (tone === 'UNKNOWN') {
        uncertainty.push(`${ref} current assessment verdict ${verdict}`);
      }
      const connectionDim = view.assessment.dimensions.find((d) => d.dimension === 'connection_feasibility' && d.applicable);
      if (connectionDim) {
        const derived = deriveConnectionViabilityFromEvaluator({
          verdict: connectionDim.verdict as 'PASS' | 'FAIL' | 'UNKNOWN',
          reasonCode: connectionDim.explanations[0]?.reasonCode ?? '',
        });
        if (!connectionViability || CONNECTION_SEVERITY[derived] > CONNECTION_SEVERITY[connectionViability]) {
          connectionViability = derived;
        }
      }
    } else {
      subjectFacts.push({ ref, tone: 'UNKNOWN', evaluation: view.status, stamp });
      uncertainty.push(`${ref} assessment ${view.status.toLowerCase()}`);
    }
  }
  const subjectTones = subjectFacts.map((f) => f.tone);
  if (subjectTones.some((t) => t === 'FAIL')) tripVerdict = 'FAIL';
  else if (subjectTones.length > 0 && subjectTones.every((t) => t === 'PASS')) tripVerdict = 'PASS';

  const partialIncomplete = recoveryActions.some((a) =>
    a.executionState === 'FAILED' || a.executionState === 'OUTCOME_UNKNOWN' || a.executionState === 'PENDING' || a.executionState === 'EXECUTING' || a.executionState === 'RECONCILING' || a.executionState === 'PROPOSED',
  );
  const connectionProgression: ConnectionProgression = mapConnectionProgression({
    caseStatus: row.lifecycle_status,
    partialRecoveryIncomplete: partialIncomplete && row.lifecycle_status === 'EXECUTING',
    allMandatoryActionsComplete: recoveryActions.length > 0 && !partialIncomplete,
    wholeTripPass: tripVerdict === 'PASS' && !partialIncomplete,
    ...(connectionViability ? { viability: connectionViability } : {}),
  });

  const status = (['OPEN', 'PLANNING', 'AWAITING_AUTHORITY', 'EXECUTING', 'RESOLVED', 'CLOSED', 'CANCELLED', 'SUPERSEDED'] as const)
    .includes(row.lifecycle_status as RecoveryCaseFacts['status'])
    ? (row.lifecycle_status as RecoveryCaseFacts['status'])
    : 'OPEN';

  const subjectFactByRef = new Map(subjectFacts.map((f) => [f.ref, f]));
  // FIG-3/defect-1: a per-node source revision — the case node's own
  // EVALUATION_LIFECYCLE xact stamp, each subject node's own — taken as their
  // maximum. Safe (unlike maxing small per-scope counters) because every
  // stamp is a globally unique, strictly increasing xid8: two different real
  // changes can never tie, so the max always moves when any component does.
  const caseRefStr = `case:${caseId}`;
  const maxStamp = subjectFacts.reduce((m, f) => (f.stamp > m ? f.stamp : m), caseStamp);
  const projectionRevision = checkedRevisionNumber(maxStamp);
  // Defect-1: exactly the refs whose own stamp is >= sinceCursor (at-least-
  // once — a ref whose stamp equals the caller's previous snapshot xmin
  // might not have been visible in that earlier read, so it is reported
  // again rather than risk a silent miss). Never "every case" or an
  // action-id list that doesn't match a node. Omitted sinceCursor (first
  // read) honestly reports nothing changed, not everything.
  const sinceCursorBig = sinceCursor === undefined ? undefined : BigInt(sinceCursor);
  const changedVisibleRefs = sinceCursorBig === undefined
    ? []
    : [
        ...(caseStamp >= sinceCursorBig ? [caseRefStr] : []),
        ...subjectFacts.filter((f) => f.stamp >= sinceCursorBig).map((f) => f.ref),
      ];
  return {
    generatedAt,
    projectionRevision,
    changedVisibleRefs,
    // These AFFECTED_BY edges carry no independent state (fixed kind,
    // AUTHORITATIVE authority) — their own presented fields never change, so
    // they are never marked changed even when an endpoint is (FIG-2/FIG-3).
    changedEdgeIds: [],
    currentSemanticState: tripVerdict === 'FAIL' ? 'FAILED' : tripVerdict === 'PASS' ? 'RECOVERED' : 'AFFECTED',
    nodes: [
      { ref: caseRefStr, kind: 'RECOVERY_PROPOSAL', label: 'Recovery case', semanticState: 'ACTIVE', authority: 'AUTHORITATIVE' },
      ...subjects.rows.map((s) => {
        const ref = `${s.subject_kind}:${s.subject_id}`;
        // FIG-6: each subject's own CURRENT verdict decides its node, never the
        // case's aggregate (a PASS subject must be able to read HEALTHY even
        // when another subject fails the whole case).
        const fact = subjectFactByRef.get(ref);
        const semanticState = fact ? TONE_TO_STATE[fact.tone] : 'UNKNOWN' as const;
        return {
          ref,
          kind: 'TRAVELLER' as const,
          label: s.subject_kind,
          semanticState,
          authority: 'AUTHORITATIVE' as const,
          caseRef: caseId,
          ...(fact ? { evaluation: fact.evaluation } : {}),
        };
      }),
    ],
    edges: subjects.rows.map((s) => ({
      // FIG-1: derived from the canonical relation, never array position —
      // stable across revisions and unique per (subject, case) pair.
      id: `AFFECTED_BY:${s.subject_kind}:${s.subject_id}:${caseRefStr}`,
      fromRef: `${s.subject_kind}:${s.subject_id}`,
      toRef: caseRefStr,
      kind: 'AFFECTED_BY' as const,
      authority: 'AUTHORITATIVE' as const,
    })),
    caseRef: caseId,
    status,
    changeSummary: 'Recovery case assembled from authoritative PostgreSQL state',
    bookingServiceState: {
      label: 'Bookings / actions',
      state: recoveryActions.some((a) => a.executionState === 'COMPLETED') ? 'RECOVERED' : 'AFFECTED',
    },
    tripViability: {
      label: 'Whole-trip viability',
      verdict: tripVerdict,
    },
    affectedItems: subjects.rows.map((s) => `${s.subject_kind}:${s.subject_id}`),
    strategies,
    authorityState: status === 'AWAITING_AUTHORITY'
      ? 'awaiting'
      : strategies.some((s) => s.status === 'SELECTED' || s.status === 'EVALUATED')
        ? 'recorded'
        : status === 'RESOLVED' || status === 'CLOSED'
          ? 'satisfied'
          : 'recorded',
    executionState: status === 'EXECUTING' ? 'executing' : status === 'RESOLVED' ? 'complete' : 'idle',
    reconciliationState: partialIncomplete ? 'reconciling' : 'idle',
    uncertainty,
    connectionProgression,
    recoveryActions,
    subjectFacts,
  };
}

/**
 * Defect-1 fix: opens the single REPEATABLE READ transaction and runs the
 * query/join logic against that one client, so this read can never mix
 * snapshots across its several queries and its `changeCursor` describes
 * exactly what it saw.
 */
export async function loadRecoveryCaseFacts(
  pool: Pool,
  workspaceId: string,
  caseId: string,
  at?: string,
  sinceCursor?: string,
): Promise<RecoveryCaseFacts | null> {
  const { value, changeCursor } = await withProjectionSnapshot(pool, (client) =>
    loadRecoveryCaseFactsInner(client, workspaceId, caseId, at, sinceCursor),
  );
  return value ? { ...value, changeCursor } : null;
}

async function loadOperatorOverviewFactsInner(
  client: Queryable,
  workspaceId: string,
  at: string | undefined,
  sinceCursor: string | undefined,
): Promise<OperatorOverviewFacts> {
  const generatedAt = isoNow(at);
  const sinceCursorBig = sinceCursor === undefined ? undefined : BigInt(sinceCursor);

  // ---- Case-driven operator queue (`items`) — existing semantics, unchanged
  // except the defect-4 `evaluation` fix below. ----
  const cases = await client.query<{ id: string; lifecycle_status: string }>(
    `SELECT id, lifecycle_status FROM recovery_cases WHERE workspace_id = $1 ORDER BY opened_at DESC LIMIT 50`,
    [workspaceId],
  );

  const items = [];
  const caseStamps: bigint[] = [];
  for (const c of cases.rows) {
    const facts = await loadRecoveryCaseFactsInner(client, workspaceId, c.id, generatedAt, undefined);
    if (!facts) continue;
    caseStamps.push(BigInt(facts.projectionRevision));
    const status = facts.tripViability.verdict === 'FAIL'
      ? 'DISRUPTED' as const
      : facts.tripViability.verdict === 'PASS'
        ? 'READY' as const
        : facts.status === 'EXECUTING'
          ? 'RECOVERING' as const
          : 'UNKNOWN' as const;
    const remainder: RemainderViability = facts.tripViability.verdict === 'FAIL'
      ? 'NOT_VIABLE'
      : facts.tripViability.verdict === 'PASS'
        ? 'VIABLE'
        : 'UNKNOWN';
    const affected = facts.affectedItems ?? [];
    let travellerLabel = affected[0] ?? 'Traveller';
    const firstJourney = affected.find((a) => a.startsWith('JOURNEY:'));
    if (firstJourney) {
      const journeyId = firstJourney.slice('JOURNEY:'.length);
      const named = await client.query<{ display_value: string }>(
        `SELECT n.display_value
           FROM journeys j
           JOIN travellers t ON t.workspace_id = j.workspace_id AND t.id = j.traveller_id
           JOIN traveller_names n ON n.workspace_id = t.workspace_id AND n.id = t.display_name_ref
          WHERE j.workspace_id = $1 AND j.id = $2`,
        [workspaceId, journeyId],
      );
      if (named.rows[0]?.display_value) travellerLabel = named.rows[0].display_value;
    }
    // Defect-4 fix: `evaluation` is set only when this item maps to exactly
    // one subject — never the case's first subject, and never an invented
    // aggregation across several. A multi-subject case's item honestly omits
    // the field rather than misreport one subject's lifecycle as the case's.
    const subjectFacts = facts.subjectFacts ?? [];
    const primaryEvaluation = subjectFacts.length === 1 ? subjectFacts[0]!.evaluation : undefined;
    items.push({
      tripRef: affected[0] ?? `case:${c.id}`,
      travellerLabel,
      status,
      remainderViability: remainder,
      caseRef: c.id,
      whatChanged: facts.changeSummary,
      affectedPeople: affected,
      affectedItems: affected,
      decisionRequired: facts.status === 'AWAITING_AUTHORITY',
      unresolvedUncertainty: facts.uncertainty ?? [],
      ...(primaryEvaluation ? { evaluation: primaryEvaluation } : {}),
    });
  }

  // ---- Defect-5 fix: DASHBOARD graph nodes come from the in-scope SUBJECT
  // POPULATION, not from `recovery_cases` — so a subject can render before
  // any case exists (closing the FIG-4 "no node before escalation" gap).
  //
  // Explicit scope key: every JOURNEY whose traveller holds an accepted
  // REQUIRED participation in an ACTIVE programme's programme_item. This
  // reuses the exact REQUIRED+accepted membership predicate
  // `loadIncidentProgrammeFacts` already treats as authoritative, bounded to
  // programmes with lifecycle_status = 'ACTIVE' — the schema has no single
  // per-workspace "the current programme" key (a workspace can hold many
  // events/programmes), so an unbounded `workspace_id` scan would not be "an
  // explicit scope key"; ACTIVE-programme membership is the smallest
  // additive population that is authoritative, bounded, and exercisable
  // before any case exists. Journeys exclude only CANCELLED — DRAFT is this
  // schema's normal pre-booking-confirmation status (seedJourney's own
  // default), not an out-of-scope state, and evaluation/assessment do not
  // gate on it elsewhere in this producer. LIMIT mirrors the existing
  // cases-query page size.
  const population = await client.query<{ journey_id: string }>(
    `SELECT DISTINCT j.id AS journey_id
       FROM journeys j
       JOIN participations p ON p.workspace_id = j.workspace_id AND p.traveller_id = j.traveller_id
       JOIN programme_items pi ON pi.workspace_id = p.workspace_id AND pi.id = p.programme_item_id
       JOIN programmes prog ON prog.workspace_id = pi.workspace_id AND prog.id = pi.programme_id
      WHERE j.workspace_id = $1
        AND j.lifecycle_status <> 'CANCELLED'
        AND p.obligation = 'REQUIRED' AND p.accepted = true
        AND prog.lifecycle_status = 'ACTIVE'
      ORDER BY j.id
      LIMIT 200`,
    [workspaceId],
  );

  const dashboardNodes: OperatorOverviewFacts['nodes'][number][] = [];
  const subjectStamps: bigint[] = [];
  const changedNodeRefs: string[] = [];
  for (const p of population.rows) {
    const ref = `JOURNEY:${p.journey_id}`;
    const stamp = await readEvaluationLifecycleStamp(client, workspaceId, 'JOURNEY', p.journey_id, 'VIABILITY');
    subjectStamps.push(stamp);
    if (sinceCursorBig !== undefined && stamp >= sinceCursorBig) changedNodeRefs.push(ref);
    const view = await currentAssessmentView(
      client,
      workspaceId,
      { kind: 'JOURNEY', id: p.journey_id } as TypedRef,
      'VIABILITY',
      generatedAt,
    );
    const tone: AssessmentTone = view.status === 'CURRENT' && view.assessment
      ? (view.assessment.overallVerdict === 'PASS' ? 'PASS' : view.assessment.overallVerdict === 'FAIL' ? 'FAIL' : 'UNKNOWN')
      : 'UNKNOWN';
    // caseRef (FIG-4): the most recently opened case this subject is
    // attached to, if any — an escalation marker, never identity.
    const caseLink = await client.query<{ recovery_case_id: string }>(
      `SELECT cs.recovery_case_id
         FROM case_subjects cs
         JOIN recovery_cases rc ON rc.workspace_id = cs.workspace_id AND rc.id = cs.recovery_case_id
        WHERE cs.workspace_id = $1 AND cs.subject_kind = 'JOURNEY' AND cs.subject_id = $2
        ORDER BY rc.opened_at DESC LIMIT 1`,
      [workspaceId, p.journey_id],
    );
    dashboardNodes.push({
      ref,
      kind: 'TRAVELLER' as const,
      label: 'JOURNEY',
      semanticState: TONE_TO_STATE[tone],
      authority: 'AUTHORITATIVE' as const,
      ...(caseLink.rows[0] ? { caseRef: caseLink.rows[0].recovery_case_id } : {}),
      evaluation: view.status,
    });
  }

  // Defect-5 edge gap: a subject's dependency on a transport service is real
  // (journey_items/transport_item_details), but that service has no
  // authoritative semantic-state source of its own and is not one of the
  // seven accepted LdgNodeKind categories — presenting it would mean either
  // inventing its state or shipping a node without one. Per the fix's own
  // fallback ("otherwise ship nodes only and report the edge gap; never
  // derive edges from topology or names"), this producer ships population
  // nodes only; see docs/work/ACTIVE_TASK.md for the gap note.
  const dashboardEdges: OperatorOverviewFacts['edges'] = [];

  // Defect-1: the overview's own scalar/changed-set span both the case queue
  // and the population graph, so the revision moves whenever anything the
  // dashboard actually presents changes, on the same xid8 scale as every
  // other projection.
  const maxStamp = [...caseStamps, ...subjectStamps].reduce((m, s) => (s > m ? s : m), 0n);
  const projectionRevision = checkedRevisionNumber(maxStamp);
  const changedVisibleRefs = sinceCursorBig === undefined ? [] : changedNodeRefs;

  return {
    generatedAt,
    projectionRevision,
    changedVisibleRefs,
    // The overview producer emits no edges (see the defect-5 gap note above).
    changedEdgeIds: [],
    currentSemanticState: items.some((i) => i.status === 'DISRUPTED') ? 'FAILED' : 'HEALTHY',
    nodes: dashboardNodes,
    edges: dashboardEdges,
    items,
  };
}

/**
 * Defect-1 fix: opens the single REPEATABLE READ transaction and runs the
 * whole overview (case queue + population graph) against that one client, so
 * every part of this read shares one consistent snapshot and one cursor.
 */
export async function loadOperatorOverviewFacts(
  pool: Pool,
  workspaceId: string,
  at?: string,
  sinceCursor?: string,
): Promise<OperatorOverviewFacts> {
  const { value, changeCursor } = await withProjectionSnapshot(pool, (client) =>
    loadOperatorOverviewFactsInner(client, workspaceId, at, sinceCursor),
  );
  return { ...value, changeCursor };
}

export function loadIncidentProgrammeFactsFromCohort(input: {
  incidentRef: string;
  sourceChangeSummary: string;
  generatedAt?: string;
  travellers: Parameters<typeof evaluateSharedDisruptionCohort>[0]['travellers'];
  programmeCommitments?: IncidentProgrammeFacts['programmeCommitments'];
  currentProgrammeState?: string;
  proposedProgrammeState?: string;
}): IncidentProgrammeFacts {
  const cohort = evaluateSharedDisruptionCohort({
    incidentRef: input.incidentRef,
    sourceChangeSummary: input.sourceChangeSummary,
    travellers: input.travellers,
  });
  const generatedAt = isoNow(input.generatedAt);
  return {
    generatedAt,
    projectionRevision: cohort.travellers.length,
    changedVisibleRefs: cohort.travellers.map((t) => t.travellerRef),
    changedEdgeIds: [],
    currentSemanticState: cohort.travellers.some((t) => t.outcome === 'FAIL') ? 'FAILED' : 'AFFECTED',
    nodes: [
      { ref: input.incidentRef, kind: 'DISRUPTION', label: 'Shared supplier disruption', semanticState: 'FAILED', authority: 'AUTHORITATIVE' },
      ...cohort.travellers.map((t) => {
        const semanticState = t.outcome === 'FAIL'
          ? 'FAILED' as const
          : t.outcome === 'PASS'
            ? 'HEALTHY' as const
            : 'UNKNOWN' as const;
        return {
          ref: t.travellerRef,
          kind: 'TRAVELLER' as const,
          label: t.personLabel,
          semanticState,
          authority: 'AUTHORITATIVE' as const,
        };
      }),
    ],
    edges: cohort.travellers.map((t) => ({
      id: `AFFECTED_BY:${t.travellerRef}:${input.incidentRef}`,
      fromRef: t.travellerRef,
      toRef: input.incidentRef,
      kind: 'AFFECTED_BY' as const,
      authority: 'AUTHORITATIVE' as const,
    })),
    incidentRef: input.incidentRef,
    sourceChangeSummary: input.sourceChangeSummary,
    affectedSet: cohort.travellers.map((t) => ({
      personLabel: t.personLabel,
      tripRef: t.tripRef,
      outcome: t.outcome,
      remainderViability: t.remainderViability,
    })),
    programmeCommitments: [...(input.programmeCommitments ?? [])],
    ...(input.currentProgrammeState ? { currentProgrammeState: input.currentProgrammeState } : {}),
    ...(input.proposedProgrammeState ? { proposedProgrammeState: input.proposedProgrammeState } : {}),
  };
}

export function buildTravellerTripFacts(input: {
  tripRef: string;
  amIOkay: 'YES' | 'NO' | 'UNKNOWN';
  doesTheRestWork: RemainderViability;
  whatChanged?: string;
  whatMattersNow?: string;
  whatNorthstarIsDoing?: string;
  whatDoYouNeedFromMe?: string;
  generatedAt?: string;
}): TravellerTripFacts {
  return {
    generatedAt: isoNow(input.generatedAt),
    projectionRevision: 1,
    changedVisibleRefs: [input.tripRef],
    changedEdgeIds: [],
    currentSemanticState: input.amIOkay === 'NO' ? 'FAILED' : input.amIOkay === 'YES' ? 'HEALTHY' : 'UNKNOWN',
    nodes: [{ ref: input.tripRef, kind: 'TRAVELLER', label: 'Your trip', semanticState: input.amIOkay === 'NO' ? 'FAILED' : 'HEALTHY', authority: 'AUTHORITATIVE' }],
    edges: [],
    tripRef: input.tripRef,
    amIOkay: input.amIOkay,
    ...(input.whatChanged ? { whatChanged: input.whatChanged } : {}),
    ...(input.whatMattersNow ? { whatMattersNow: input.whatMattersNow } : {}),
    ...(input.whatNorthstarIsDoing ? { whatNorthstarIsDoing: input.whatNorthstarIsDoing } : {}),
    ...(input.whatDoYouNeedFromMe ? { whatDoYouNeedFromMe: input.whatDoYouNeedFromMe } : {}),
    doesTheRestWork: input.doesTheRestWork,
  };
}

/**
 * Assemble Incident/Programme facts from a recovery case + programme rows.
 * Outcomes come from latest VIABILITY assessments on JOURNEY subjects — never
 * invented.
 *
 * Defect-3 fix: this PostgreSQL path used to delegate refs, revision and
 * changed refs entirely to `loadIncidentProgrammeFactsFromCohort` (the pure,
 * in-memory cohort builder) — which gave a traveller-*count* revision, marked
 * every traveller changed on every read regardless of what actually changed,
 * used raw traveller UUIDs as node refs (not the canonical `JOURNEY:<id>`
 * form the case graph uses for the same subject) and carried no `evaluation`.
 * The pure cohort builder (`evaluateSharedDisruptionCohort` below) is still
 * used for `affectedSet`'s outcome/remainderViability, and
 * `loadIncidentProgrammeFactsFromCohort` remains available unchanged for
 * `primaryScenarioVerticalLoop.ts`'s pure in-memory path — but this
 * PostgreSQL producer now builds its own nodes/edges/change-metadata,
 * reusing the exact subject facts (canonical ref, tone, evaluation, xid8
 * stamp) `loadRecoveryCaseFactsInner` already computed for the same case, on
 * the same shared snapshot.
 */
async function loadIncidentProgrammeFactsInner(
  client: Queryable,
  workspaceId: string,
  caseId: string,
  at: string | undefined,
  sinceCursor: string | undefined,
): Promise<IncidentProgrammeFacts | null> {
  const caseFacts = await loadRecoveryCaseFactsInner(client, workspaceId, caseId, at, sinceCursor);
  if (!caseFacts) return null;

  const journeySubjectFacts = (caseFacts.subjectFacts ?? []).filter((f) => f.ref.startsWith('JOURNEY:'));

  const travellers: CohortTravellerEvaluationInput[] = [];
  for (const f of journeySubjectFacts) {
    const journeyId = f.ref.slice('JOURNEY:'.length);
    const journey = await client.query<{ trip_id: string; traveller_id: string }>(
      `SELECT trip_id, traveller_id FROM journeys WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, journeyId],
    );
    const j = journey.rows[0];
    if (!j) continue;
    const name = await client.query<{ display_value: string }>(
      `SELECT n.display_value
         FROM travellers t
         JOIN traveller_names n ON n.workspace_id = t.workspace_id AND n.id = t.display_name_ref
        WHERE t.workspace_id = $1 AND t.id = $2`,
      [workspaceId, j.traveller_id],
    );
    const participation = await client.query<{ id: string }>(
      `SELECT p.id FROM participations p
        WHERE p.workspace_id = $1 AND p.traveller_id = $2 AND p.obligation = 'REQUIRED' AND p.accepted = true
        LIMIT 1`,
      [workspaceId, j.traveller_id],
    );
    // Reuse the case graph's own per-subject CURRENT-assessment tone — never
    // a second, independently-queried "latest assessment" that could race or
    // disagree with what the case view just presented for this same subject.
    travellers.push({
      travellerRef: j.traveller_id,
      personLabel: name.rows[0]?.display_value ?? `Traveller ${j.traveller_id.slice(0, 8)}`,
      tripRef: j.trip_id,
      journeyRef: journeyId,
      programmeOutcome: f.tone,
      remainderViability: f.tone === 'PASS' ? 'VIABLE' : f.tone === 'FAIL' ? 'NOT_VIABLE' : 'UNKNOWN',
      hasEvaluatedRequiredProgrammeDependency: participation.rows.length > 0,
    });
  }

  const programmeItems = await client.query<{
    id: string;
    title: string;
    window_start: Date | null;
    lifecycle_status: string;
  }>(
    `SELECT DISTINCT pi.id, pi.title, pi.window_start, pi.lifecycle_status
       FROM programme_items pi
       JOIN participations p ON p.workspace_id = pi.workspace_id AND p.programme_item_id = pi.id
       JOIN journeys j ON j.workspace_id = p.workspace_id AND j.traveller_id = p.traveller_id
       JOIN case_subjects cs ON cs.workspace_id = j.workspace_id AND cs.subject_id = j.id
      WHERE pi.workspace_id = $1 AND cs.recovery_case_id = $2 AND cs.subject_kind = 'JOURNEY'
      ORDER BY pi.window_start NULLS LAST`,
    [workspaceId, caseId],
  );

  const cohort = evaluateSharedDisruptionCohort({
    incidentRef: caseId,
    sourceChangeSummary: caseFacts.changeSummary,
    travellers,
  });

  const sinceCursorBig = sinceCursor === undefined ? undefined : BigInt(sinceCursor);
  const maxStamp = journeySubjectFacts.reduce((m, f) => ((f.stamp ?? 0n) > m ? f.stamp! : m), 0n);
  const projectionRevision = checkedRevisionNumber(maxStamp);
  // Defect-3: exactly the subjects whose own stamp is >= sinceCursor
  // (at-least-once, same rule as the case graph) — never "every traveller".
  const changedVisibleRefs = sinceCursorBig === undefined
    ? []
    : journeySubjectFacts.filter((f) => (f.stamp ?? 0n) >= sinceCursorBig).map((f) => f.ref);

  return {
    generatedAt: caseFacts.generatedAt,
    projectionRevision,
    changedVisibleRefs,
    changedEdgeIds: [],
    currentSemanticState: cohort.travellers.some((t) => t.outcome === 'FAIL') ? 'FAILED' : 'AFFECTED',
    nodes: [
      { ref: caseId, kind: 'DISRUPTION', label: 'Shared supplier disruption', semanticState: 'FAILED', authority: 'AUTHORITATIVE' },
      // Defect-3: canonical `JOURNEY:<id>` refs — the same form and the same
      // value the case graph already uses for this subject — never a raw
      // traveller UUID. `evaluation` is the same lookup the case view made.
      ...journeySubjectFacts.map((f) => ({
        ref: f.ref,
        kind: 'TRAVELLER' as const,
        label: f.ref,
        semanticState: TONE_TO_STATE[f.tone],
        authority: 'AUTHORITATIVE' as const,
        caseRef: caseId,
        evaluation: f.evaluation,
      })),
    ],
    edges: journeySubjectFacts.map((f) => ({
      id: `AFFECTED_BY:${f.ref}:${caseId}`,
      fromRef: f.ref,
      toRef: caseId,
      kind: 'AFFECTED_BY' as const,
      authority: 'AUTHORITATIVE' as const,
    })),
    incidentRef: caseId,
    sourceChangeSummary: caseFacts.changeSummary,
    affectedSet: cohort.travellers.map((t) => ({
      personLabel: t.personLabel,
      tripRef: t.tripRef,
      outcome: t.outcome,
      remainderViability: t.remainderViability,
    })),
    programmeCommitments: programmeItems.rows.map((pi) => ({
      itemRef: pi.id,
      label: pi.title,
      ...(pi.window_start ? { windowLabel: pi.window_start.toISOString() } : {}),
      state: pi.lifecycle_status === 'CANCELLED' ? 'FAILED' as const : 'ACTIVE' as const,
    })),
    currentProgrammeState: programmeItems.rows
      .map((pi) => `${pi.title}@${pi.window_start?.toISOString() ?? 'unscheduled'}`)
      .join('; ') || undefined,
  };
}

export async function loadIncidentProgrammeFacts(
  pool: Pool,
  workspaceId: string,
  caseId: string,
  at?: string,
  sinceCursor?: string,
): Promise<IncidentProgrammeFacts | null> {
  const { value, changeCursor } = await withProjectionSnapshot(pool, (client) =>
    loadIncidentProgrammeFactsInner(client, workspaceId, caseId, at, sinceCursor),
  );
  return value ? { ...value, changeCursor } : null;
}

/**
 * Assemble Traveller Trip facts from a journey subject linked to a case (optional).
 */
export async function loadTravellerTripFacts(
  pool: Pool,
  workspaceId: string,
  journeyId: string,
  at?: string,
): Promise<TravellerTripFacts | null> {
  const journey = await pool.query<{ trip_id: string; traveller_id: string; lifecycle_status: string }>(
    `SELECT trip_id, traveller_id, lifecycle_status FROM journeys WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, journeyId],
  );
  const j = journey.rows[0];
  if (!j) return null;

  const assessment = await pool.query<{ overall_verdict: string }>(
    `SELECT a.overall_verdict
       FROM assessments a
       JOIN assessment_subjects s ON s.workspace_id = a.workspace_id AND s.assessment_id = a.id
      WHERE a.workspace_id = $1 AND a.kind = 'VIABILITY'
        AND s.subject_kind = 'JOURNEY' AND s.subject_id = $2
      ORDER BY a.evaluated_at DESC LIMIT 1`,
    [workspaceId, journeyId],
  );
  const verdict = assessment.rows[0]?.overall_verdict;
  const amIOkay: 'YES' | 'NO' | 'UNKNOWN' =
    verdict === 'PASS' ? 'YES' : verdict === 'FAIL' ? 'NO' : 'UNKNOWN';
  const doesTheRestWork: RemainderViability =
    verdict === 'PASS' ? 'VIABLE' : verdict === 'FAIL' ? 'NOT_VIABLE' : 'UNKNOWN';

  const caseLink = await pool.query<{ recovery_case_id: string; lifecycle_status: string }>(
    `SELECT cs.recovery_case_id, rc.lifecycle_status
       FROM case_subjects cs
       JOIN recovery_cases rc ON rc.workspace_id = cs.workspace_id AND rc.id = cs.recovery_case_id
      WHERE cs.workspace_id = $1 AND cs.subject_kind = 'JOURNEY' AND cs.subject_id = $2
      ORDER BY rc.opened_at DESC LIMIT 1`,
    [workspaceId, journeyId],
  );
  const linked = caseLink.rows[0];

  return buildTravellerTripFacts({
    tripRef: j.trip_id,
    amIOkay,
    doesTheRestWork,
    generatedAt: isoNow(at),
    whatChanged: linked
      ? `Linked recovery case ${linked.recovery_case_id} is ${linked.lifecycle_status}`
      : 'No open recovery case linked to this journey',
    whatMattersNow: amIOkay === 'NO'
      ? 'Your participation is not viable under current assessments'
      : amIOkay === 'YES'
        ? 'Current assessment reports your journey as viable'
        : 'Viability is not yet known',
    whatNorthstarIsDoing: linked
      ? `Recovery case status: ${linked.lifecycle_status}`
      : 'Monitoring journey state',
    whatDoYouNeedFromMe: linked?.lifecycle_status === 'AWAITING_AUTHORITY'
      ? 'Authority decision may be required'
      : 'Nothing required from you right now unless contacted',
  });
}

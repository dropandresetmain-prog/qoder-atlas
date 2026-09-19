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
  CaseCauseView,
  CausalPathStep,
  ConnectionProgression,
  RemainderViability,
} from '../../../contracts/v2/product/readModels.ts';
import type {
  EventOverviewSourceFacts,
  IncidentProgrammeFacts,
  OperatorOverviewFacts,
  OperatorPopulationFact,
  RecoveryActionFact,
  RecoveryCaseFacts,
  RecoveryStrategyChangeFact,
  RecoveryStrategyFact,
  TravellerTripFacts,
} from './types.ts';
import { mapConnectionProgression, deriveConnectionViabilityFromEvaluator, type ConnectionViabilityHint } from './mapConnectionProgression.ts';
import {
  evaluateSharedDisruptionCohort,
  type CohortTravellerEvaluationInput,
} from '../cohortDisruption.ts';
import { currentAssessmentView } from '../../../persistence/postgres/world/pgAssessments.ts';
import { findLatestRecoveryPlanningAttemptForCase } from '../../../persistence/postgres/commands/r1PlanningAttemptCommands.ts';
import { humanizeCode } from '../../../domain/v2/shared/humanize.ts';
import { formatInstantUtc } from './projectFocusedCaseGraph.ts';
import { listRecoveryCaseAttention } from '../../../persistence/postgres/commands/caseAttentionCommands.ts';
import { loadOriginalCaseGraphSnapshot } from '../../../persistence/postgres/commands/caseGraphSnapshotCommands.ts';
import { disruptionEventFileFromEnv } from '../../demo/providerDisruptionEventSource.ts';
import { projectFocusedCaseGraphEnrichment } from './projectFocusedCaseGraph.ts';
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
 * Which field of each closed `ScenarioEffect` variant names the subject the
 * effect acts on, and what kind that subject is.
 *
 * This is driven by the ScenarioChange contract's own discriminated union —
 * not by any scenario. An effect kind that is not listed still projects, with
 * its typed ref omitted, rather than being silently dropped.
 */
const EFFECT_SUBJECT: Readonly<Record<string, { field: string; kind: string }>> = {
  CHANGE_PROGRAMME_ITEM_TIME: { field: 'programmeItemId', kind: 'PROGRAMME_ITEM' },
  ALTER_JOURNEY_ITEM_INTENT: { field: 'journeyItemId', kind: 'JOURNEY_ITEM' },
  SELECT_OFFER: { field: 'journeyItemId', kind: 'JOURNEY_ITEM' },
  PROPOSE_ALLOCATION: { field: 'reservationLineId', kind: 'RESERVATION_LINE' },
  CHANGE_SUPPORT_ASSIGNMENT: { field: 'constraintDefinitionId', kind: 'CONSTRAINT_DEFINITION' },
  WAIVE_OBJECTIVE: { field: 'objectiveId', kind: 'OBJECTIVE' },
};

/** `{kind,id}` -> `KIND:id`, or undefined when the value is not a typed ref. */
function typedRefString(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { kind, id } = value as { kind?: unknown; id?: unknown };
  if (typeof kind !== 'string' || kind.length === 0) return undefined;
  if (typeof id !== 'string' || id.length === 0) return undefined;
  return `${kind}:${id}`;
}

function asTone(value: unknown): AssessmentTone {
  return value === 'PASS' || value === 'FAIL' ? value : 'UNKNOWN';
}

function windowOf(value: unknown): { start: string; end: string } | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { start, end } = value as { start?: unknown; end?: unknown };
  if (typeof start !== 'string' || typeof end !== 'string') return undefined;
  return { start, end };
}

/**
 * Project the case's persisted recovery strategies into options an operator
 * can actually choose between.
 *
 * Two things the raw records cannot do alone:
 *
 *  - **Identity.** Candidate summaries store `subjectRef` only, because a
 *    strategy is an evaluation record, not a presentation record. Human names
 *    are resolved here through the same authoritative
 *    `journeys -> travellers -> traveller_names` join the overview queue uses.
 *    A subject that is not a Journey, or whose traveller cannot be resolved,
 *    keeps its typed ref as its label — never a fabricated "Traveller".
 *  - **Meaning.** What an option *does* lives in `strategy_changes.effects`.
 *    Joined against canonical programme state, a bilateral programme swap can
 *    be stated as the schedule move it is, with current and proposed windows,
 *    instead of a UUID and a version number.
 */
async function projectCaseStrategies(
  client: Queryable,
  workspaceId: string,
  rows: readonly {
    id: string;
    strategy_version: number;
    viability: string;
    status: string;
    candidate_assessment_summaries: unknown;
  }[],
  subjectFacts: readonly { ref: string; tone: AssessmentTone }[],
  uncertainty: string[],
): Promise<RecoveryStrategyFact[]> {
  if (rows.length === 0) return [];
  const strategyIds = rows.map((r) => r.id);

  // 1. Candidate summaries, read as they are actually persisted.
  const summariesByStrategy = new Map<string, { subjectRef: string; verdict: AssessmentTone }[]>();
  const journeyIds = new Set<string>();
  let unreadableSummaries = 0;
  for (const row of rows) {
    const raw = Array.isArray(row.candidate_assessment_summaries)
      ? (row.candidate_assessment_summaries as { subjectRef?: unknown; overallVerdict?: unknown }[])
      : [];
    const parsed: { subjectRef: string; verdict: AssessmentTone }[] = [];
    for (const entry of raw) {
      const ref = typedRefString(entry?.subjectRef);
      if (ref === undefined) {
        unreadableSummaries += 1;
        continue;
      }
      parsed.push({ subjectRef: ref, verdict: asTone(entry?.overallVerdict) });
      if (ref.startsWith('JOURNEY:')) journeyIds.add(ref.slice('JOURNEY:'.length));
    }
    summariesByStrategy.set(row.id, parsed);
  }
  if (unreadableSummaries > 0) {
    // Surfaced rather than swallowed: a summary that cannot be read is
    // missing information about the option, not a subject that happens to
    // be UNKNOWN.
    uncertainty.push(
      `${unreadableSummaries} candidate assessment summar${unreadableSummaries === 1 ? 'y' : 'ies'} could not be read`,
    );
  }

  // 2. Authoritative display identity for the Journey subjects.
  const labelByJourney = new Map<string, string>();
  if (journeyIds.size > 0) {
    const named = await client.query<{ journey_id: string; display_value: string }>(
      `SELECT j.id AS journey_id, n.display_value
         FROM journeys j
         JOIN travellers t ON t.workspace_id = j.workspace_id AND t.id = j.traveller_id
         JOIN traveller_names n ON n.workspace_id = t.workspace_id AND n.id = t.display_name_ref
        WHERE j.workspace_id = $1 AND j.id = ANY($2::uuid[])`,
      [workspaceId, [...journeyIds]],
    );
    for (const r of named.rows) labelByJourney.set(r.journey_id, r.display_value);
  }
  const personLabel = (ref: string): string =>
    ref.startsWith('JOURNEY:') ? labelByJourney.get(ref.slice('JOURNEY:'.length)) ?? ref : ref;

  // 3. What each option changes, from its own persisted effects.
  const effectRows = await client.query<{ recovery_strategy_id: string; effects: unknown }>(
    `SELECT recovery_strategy_id, effects
       FROM strategy_changes
      WHERE workspace_id = $1 AND recovery_strategy_id = ANY($2::uuid[])
      ORDER BY recovery_strategy_id, strategy_version`,
    [workspaceId, strategyIds],
  );
  interface EffectFact { effectKind: string; subjectRef?: string; proposedWindow?: { start: string; end: string } }
  const effectsByStrategy = new Map<string, EffectFact[]>();
  const programmeItemIds = new Set<string>();
  for (const row of effectRows.rows) {
    const list = effectsByStrategy.get(row.recovery_strategy_id) ?? [];
    const raw = Array.isArray(row.effects) ? (row.effects as Record<string, unknown>[]) : [];
    for (const effect of raw) {
      const effectKind = typeof effect?.effectKind === 'string' ? effect.effectKind : 'UNKNOWN_EFFECT';
      const mapping = EFFECT_SUBJECT[effectKind];
      const id = mapping ? effect[mapping.field] : undefined;
      const subjectRef = mapping && typeof id === 'string' && id.length > 0 ? `${mapping.kind}:${id}` : undefined;
      if (subjectRef?.startsWith('PROGRAMME_ITEM:')) {
        programmeItemIds.add(subjectRef.slice('PROGRAMME_ITEM:'.length));
      }
      const proposedWindow = windowOf(effect.proposedWindow);
      list.push({
        effectKind,
        ...(subjectRef ? { subjectRef } : {}),
        ...(proposedWindow ? { proposedWindow } : {}),
      });
    }
    effectsByStrategy.set(row.recovery_strategy_id, list);
  }

  // 4. Canonical programme state for the items those effects move, so the
  //    option can state current-vs-proposed timing rather than an id.
  const programmeItems = new Map<string, { title: string; window?: { start: string; end: string } }>();
  if (programmeItemIds.size > 0) {
    const items = await client.query<{ id: string; title: string; window_start: Date | null; window_end: Date | null }>(
      `SELECT id, title, window_start, window_end
         FROM programme_items
        WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
      [workspaceId, [...programmeItemIds]],
    );
    for (const item of items.rows) {
      programmeItems.set(item.id, {
        title: item.title,
        ...(item.window_start && item.window_end
          ? { window: { start: item.window_start.toISOString(), end: item.window_end.toISOString() } }
          : {}),
      });
    }
  }

  // 5. The case subjects that are blocking right now. "Who does this fix" is
  //    only meaningful against today's authoritative verdict.
  const blocking = subjectFacts.filter((f) => f.tone === 'FAIL');

  return rows.map((row, index) => {
    const summaries = summariesByStrategy.get(row.id) ?? [];
    const verdictByRef = new Map(summaries.map((entry) => [entry.subjectRef, entry.verdict]));
    const changes: RecoveryStrategyChangeFact[] = (effectsByStrategy.get(row.id) ?? []).map((effect) => {
      const item = effect.subjectRef?.startsWith('PROGRAMME_ITEM:')
        ? programmeItems.get(effect.subjectRef.slice('PROGRAMME_ITEM:'.length))
        : undefined;
      const subjectRef = effect.subjectRef ?? `${row.id}:${effect.effectKind}`;
      return {
        effectKind: effect.effectKind,
        subjectRef,
        subjectLabel: item?.title ?? subjectRef,
        ...(item?.window ? { currentWindow: item.window } : {}),
        ...(effect.proposedWindow ? { proposedWindow: effect.proposedWindow } : {}),
      };
    });
    const projectedPeople = summaries.map((entry) => ({
      subjectRef: entry.subjectRef,
      personLabel: personLabel(entry.subjectRef),
      verdict: entry.verdict,
    }));
    return {
      strategyRef: row.id,
      version: row.strategy_version,
      viability: row.viability,
      status: row.status,
      optionNumber: index + 1,
      changes,
      resolves: blocking.map((subject) => ({
        subjectRef: subject.ref,
        personLabel: personLabel(subject.ref),
        currentVerdict: subject.tone,
        // The option was assessed against this subject, or it was not; an
        // absent summary is UNKNOWN, never an optimistic PASS.
        projectedVerdict: verdictByRef.get(subject.ref) ?? 'UNKNOWN',
      })),
      projectedSummary: {
        total: projectedPeople.length,
        pass: projectedPeople.filter((p) => p.verdict === 'PASS').length,
        fail: projectedPeople.filter((p) => p.verdict === 'FAIL').length,
        unknown: projectedPeople.filter((p) => p.verdict === 'UNKNOWN').length,
      },
      projectedPeople,
    };
  });
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
    resolution_summary: string | null;
  }>(
    `SELECT id, lifecycle_status, opened_at, closed_at, resolution_summary FROM recovery_cases WHERE workspace_id = $1 AND id = $2`,
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

  // C9: the latest completed planning attempt (frozen C1 record + outcome) for
  // this case, surfaced as decision-time evidence in the projection. A case that
  // has never run the coordinator has no attempt row and carries none here —
  // never a fabricated planning record. Requires PG at runtime (LOCAL acceptance).
  const planningAttempt = await findLatestRecoveryPlanningAttemptForCase(client, workspaceId, caseId);
  // R1: durable human attention (C8 ESCALATE) — orthogonal to the case phase.
  const attention = await listRecoveryCaseAttention(client, workspaceId, caseId);
  // R2: the immutable Original focused graph (historical presentation evidence;
  // CURRENT never reads it). Absent until the first truthful focused graph.
  const originalFocusedGraph = await loadOriginalCaseGraphSnapshot(client, workspaceId, caseId);

  // Ascending, so option 1 is the first option this case produced. The
  // strategies themselves are projected further down, once each case
  // subject's CURRENT verdict is known — an option can only say who it fixes
  // by comparing its own projection against today's authoritative verdict.
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
      ORDER BY strategy_version ASC`,
    [workspaceId, caseId],
  );

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
  // T3: the deterministic causal path — every applicable blocking FAIL
  // explanation of every failing subject, exactly as the evaluator typed it.
  const causalPath: CausalPathStep[] = [];
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
      if (tone === 'FAIL') {
        for (const dim of view.assessment.dimensions) {
          if (!dim.applicable || !dim.blocking || dim.verdict !== 'FAIL') continue;
          for (const explanation of dim.explanations) {
            if (explanation.status !== 'FAIL') continue;
            causalPath.push({
              subjectRef: `${explanation.affectedSubject.kind}:${explanation.affectedSubject.id}`,
              ...(explanation.cause.subjectRef
                ? { causeSubjectRef: `${explanation.cause.subjectRef.kind}:${explanation.cause.subjectRef.id}` }
                : {}),
              dimension: dim.dimension,
              reasonCode: explanation.reasonCode,
              evaluatorId: explanation.evaluatorId,
              facts: { ...explanation.facts },
              relatedSubjectRefs: explanation.relatedSubjects.map((r) => `${r.kind}:${r.id}`),
            });
          }
        }
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

  // ---------------------------------------------------------------------------
  // R2: Load enrichment data for the focused case graph (journey composition,
  // programme commitments, human labels).
  // ---------------------------------------------------------------------------
  // Journey rows for the case's JOURNEY subjects.
  const journeyIds = subjects.rows.filter((s) => s.subject_kind === 'JOURNEY').map((s) => s.subject_id);
  const journeys = journeyIds.length > 0
    ? await client.query<{ id: string; trip_id: string; traveller_id: string; lifecycle_status: string; intended_window_start: string | null; intended_window_end: string | null }>(
        `SELECT id, trip_id, traveller_id, lifecycle_status, intended_window_start, intended_window_end
           FROM journeys
          WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
        [workspaceId, journeyIds],
      )
    : { rows: [] };

  // Journey item rows for those journeys.
  const journeyItems = journeys.rows.length > 0
    ? await client.query<{ id: string; journey_id: string; kind: 'TRANSPORT' | 'STAY' | 'ENGAGEMENT' | 'RESOURCE_USE'; order_key: string; lifecycle_status: string; intended_window_start: string | null; intended_window_end: string | null; selected_service_id: string | null }>(
        `SELECT ji.id, ji.journey_id, ji.kind, ji.order_key, ji.lifecycle_status, ji.intended_window_start, ji.intended_window_end,
                tid.selected_service_id
           FROM journey_items ji
           LEFT JOIN transport_item_details tid ON tid.workspace_id = ji.workspace_id AND tid.journey_item_id = ji.id
          WHERE ji.workspace_id = $1 AND ji.journey_id = ANY($2::uuid[])
          ORDER BY ji.journey_id, ji.order_key, ji.id`,
        [workspaceId, journeys.rows.map((j) => j.id)],
      )
    : { rows: [] };

  // Transport service rows referenced by TRANSPORT items.
  const serviceIds = journeyItems.rows.filter((i) => i.kind === 'TRANSPORT' && i.selected_service_id).map((i) => i.selected_service_id!);
  const transportServices = serviceIds.length > 0
    ? await client.query<{ id: string; mode: string; operator: string; origin_place_id: string; destination_place_id: string; origin_place_name: string | null; destination_place_name: string | null; published_departure: Date | null; published_arrival: Date | null; estimated_arrival: Date | null; actual_arrival: Date | null; destination_time_zone: string | null }>(
        `SELECT ts.id, ts.mode, ts.operator, ts.origin_place_id, ts.destination_place_id,
                po.name AS origin_place_name, pd.name AS destination_place_name,
                ts.published_departure, ts.published_arrival, ts.estimated_arrival,
                ts.actual_arrival, pd.time_zone AS destination_time_zone
           FROM transport_services ts
           LEFT JOIN places po ON po.workspace_id = ts.workspace_id AND po.id = ts.origin_place_id
           LEFT JOIN places pd ON pd.workspace_id = ts.workspace_id AND pd.id = ts.destination_place_id
          WHERE ts.workspace_id = $1 AND ts.id = ANY($2::uuid[])`,
        [workspaceId, serviceIds],
      )
    : { rows: [] };

  // Traveller display names for the journeys (for human labels).
  const travellerIds = journeys.rows.map((j) => j.traveller_id);
  const travellerLabelsByJourney = new Map<string, string>();
  if (travellerIds.length > 0) {
    const travellerNames = await client.query<{ journey_id: string; display_value: string }>(
      `SELECT j.id AS journey_id, n.display_value
         FROM journeys j
         JOIN travellers t ON t.workspace_id = j.workspace_id AND t.id = j.traveller_id
         JOIN traveller_names n ON n.workspace_id = t.workspace_id AND n.id = t.display_name_ref
        WHERE j.workspace_id = $1 AND j.id = ANY($2::uuid[])`,
      [workspaceId, journeyIds],
    );
    for (const r of travellerNames.rows) {
      travellerLabelsByJourney.set(r.journey_id, r.display_value);
    }
  }

  // Participation rows for the case's travellers.
  const participations = travellerIds.length > 0
    ? await client.query<{ id: string; programme_item_id: string; traveller_id: string; obligation: 'REQUIRED' | 'OPTIONAL' | 'INFORMED'; accepted: boolean }>(
        `SELECT id, programme_item_id, traveller_id, obligation, accepted
           FROM participations
          WHERE workspace_id = $1 AND traveller_id = ANY($2::uuid[])`,
        [workspaceId, travellerIds],
      )
    : { rows: [] };

  // Programme item rows referenced by participations.
  const programmeItemIds = participations.rows.map((p) => p.programme_item_id);
  const programmeItems = programmeItemIds.length > 0
    ? await client.query<{ id: string; programme_id: string; title: string; item_type: string; window_start: string | null; window_end: string | null; lifecycle_status: string }>(
        `SELECT id, programme_id, title, item_type, window_start, window_end, lifecycle_status
           FROM programme_items
          WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
        [workspaceId, [...new Set(programmeItemIds)]],
      )
    : { rows: [] };

  // Objective rows owned by the case's explicit JOURNEY/TRIP subjects, plus the
  // Trip owning every affected Journey. Trip objectives govern their member
  // journeys even when RecoveryCase subjects carry only JOURNEY refs.
  const objectiveOwnerRefs = new Map<string, { kind: 'JOURNEY' | 'TRIP'; id: string }>();
  for (const subject of subjects.rows) {
    if (subject.subject_kind === 'JOURNEY' || subject.subject_kind === 'TRIP') {
      objectiveOwnerRefs.set(`${subject.subject_kind}:${subject.subject_id}`, { kind: subject.subject_kind, id: subject.subject_id });
    }
  }
  for (const journey of journeys.rows) {
    objectiveOwnerRefs.set(`TRIP:${journey.trip_id}`, { kind: 'TRIP', id: journey.trip_id });
  }
  const objectiveOwners = [...objectiveOwnerRefs.values()];
  const objectives = objectiveOwners.length > 0
    ? await client.query<{ id: string; owner_kind: string; owner_id: string; success_predicate: string; success_predicate_kind: string; hardness: string; priority: number }>(
        `SELECT id, owner_kind, owner_id, success_predicate, success_predicate_kind, hardness, priority
           FROM objectives
          WHERE workspace_id = $1 AND (owner_kind, owner_id) IN (SELECT * FROM unnest($2::text[], $3::uuid[]))`,
        [workspaceId, objectiveOwners.map((owner) => owner.kind), objectiveOwners.map((owner) => owner.id)],
      )
    : { rows: [] };

  // Build assessment views map for enrichment (reuse subjectFacts + add item assessments).
  const assessmentViews = new Map<string, { status: AssessmentViewStatus; tone: AssessmentTone }>();
  for (const fact of subjectFacts) {
    assessmentViews.set(fact.ref, { status: fact.evaluation, tone: fact.tone });
  }
  // Add assessments for journey items (if any are assessed).
  for (const item of journeyItems.rows) {
    const itemRef = item.kind === 'TRANSPORT' && item.selected_service_id
      ? `SERVICE_BOOKING:${item.selected_service_id}`
      : item.kind === 'STAY'
        ? `TRANSFER_STAY:${item.id}`
        : null;
    if (!itemRef) continue;
    const view = await currentAssessmentView(
      client,
      workspaceId,
      { kind: 'JOURNEY_ITEM', id: item.id } as TypedRef,
      'VIABILITY',
      generatedAt,
    );
    if (view.status !== 'NONE') {
      const tone: AssessmentTone = view.assessment?.overallVerdict === 'PASS' ? 'PASS' : view.assessment?.overallVerdict === 'FAIL' ? 'FAIL' : 'UNKNOWN';
      assessmentViews.set(itemRef, { status: view.status, tone });
    }
  }
  // Programme/objective state is only used when it belongs to that canonical
  // subject. A journey-wide failure must never colour every commitment/objective.
  for (const programmeItem of programmeItems.rows) {
    const view = await currentAssessmentView(
      client,
      workspaceId,
      { kind: 'PROGRAMME_ITEM', id: programmeItem.id } as TypedRef,
      'VIABILITY',
      generatedAt,
    );
    if (view.status !== 'NONE') {
      const tone: AssessmentTone = view.assessment?.overallVerdict === 'PASS' ? 'PASS' : view.assessment?.overallVerdict === 'FAIL' ? 'FAIL' : 'UNKNOWN';
      assessmentViews.set(`PROGRAMME_ITEM:${programmeItem.id}`, { status: view.status, tone });
    }
  }
  for (const objective of objectives.rows) {
    const view = await currentAssessmentView(
      client,
      workspaceId,
      { kind: 'OBJECTIVE', id: objective.id } as TypedRef,
      'VIABILITY',
      generatedAt,
    );
    if (view.status !== 'NONE') {
      const tone: AssessmentTone = view.assessment?.overallVerdict === 'PASS' ? 'PASS' : view.assessment?.overallVerdict === 'FAIL' ? 'FAIL' : 'UNKNOWN';
      assessmentViews.set(`OBJECTIVE:${objective.id}`, { status: view.status, tone });
    }
  }

  // Call the pure enrichment projector.
  const enrichment = projectFocusedCaseGraphEnrichment({
    caseSubjects: subjects.rows,
    journeys: journeys.rows.map((j) => ({
      id: j.id,
      trip_id: j.trip_id,
      traveller_id: j.traveller_id,
      lifecycle_status: j.lifecycle_status,
      intended_window_start: j.intended_window_start,
      intended_window_end: j.intended_window_end,
    })),
    journeyItems: journeyItems.rows.map((i) => ({
      id: i.id,
      journey_id: i.journey_id,
      kind: i.kind,
      order_key: i.order_key,
      lifecycle_status: i.lifecycle_status,
      intended_window_start: i.intended_window_start,
      intended_window_end: i.intended_window_end,
      selectedServiceId: i.selected_service_id,
    })),
    transportServices: transportServices.rows.map((s) => ({
      id: s.id,
      mode: s.mode,
      operator: s.operator,
      origin_place_id: s.origin_place_id,
      destination_place_id: s.destination_place_id,
      origin_place_name: s.origin_place_name,
      destination_place_name: s.destination_place_name,
      published_departure: s.published_departure?.toISOString() ?? null,
      published_arrival: s.published_arrival?.toISOString() ?? null,
      estimated_arrival: s.estimated_arrival?.toISOString() ?? null,
      actual_arrival: s.actual_arrival?.toISOString() ?? null,
      destination_time_zone: s.destination_time_zone,
    })),
    participations: participations.rows,
    programmeItems: programmeItems.rows,
    objectives: objectives.rows,
    assessmentViews,
    causalPath,
    travellerLabelsByJourney,
    caseId,
  });

  // ---------------------------------------------------------------------
  // Recovery options, as an operator has to read them.
  //
  // `RecoveryStrategy` is a domain/evaluation record. It persists candidate
  // summaries as `subjectRef` / `assessmentId` / `overallVerdict` and keeps
  // its proposed effects in `strategy_changes` — it deliberately carries no
  // display names, and must not start carrying them just so a screen can
  // render. So the product read model does the resolving: it reads the
  // verdict that is actually stored, joins human identity from authoritative
  // canonical state, and explains each option from its own stored effects.
  // Nothing here is generated prose or inferred intent.
  // ---------------------------------------------------------------------
  const strategies = await projectCaseStrategies(client, workspaceId, strategyRows.rows, subjectFacts, uncertainty);

  // T3: the case's cause is the change signal linked through case_signals
  // (migration 0124) — the latest received one when several are linked.
  const signalRows = await client.query<{ id: string; origin_kind: string; change_type: string; received_at: Date; completed_at: Date | null }>(
    `SELECT s.id, s.origin_kind, s.change_type, s.received_at, c.completed_at
       FROM case_signals cs
       JOIN change_signals s ON s.workspace_id = cs.workspace_id AND s.id = cs.change_signal_id
       LEFT JOIN change_signal_completions c ON c.workspace_id = s.workspace_id AND c.change_signal_id = s.id
      WHERE cs.workspace_id = $1 AND cs.recovery_case_id = $2
      ORDER BY s.received_at DESC, s.id`,
    [workspaceId, caseId],
  );
  const causeRow = signalRows.rows[0];
  const cause: CaseCauseView | undefined = causeRow
    ? {
        changeSignalRef: `CHANGE_SIGNAL:${causeRow.id}`,
        originKind: causeRow.origin_kind,
        changeType: causeRow.change_type,
        receivedAt: causeRow.received_at.toISOString(),
        applied: causeRow.completed_at !== null,
      }
    : undefined;
  const firstBreak = causalPath[0];

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
      // The change signal is a first-class current-world input. Recovery case
      // workflow state stays in the Case workspace, never in this graph.
      ...(cause
        ? [{ ref: cause.changeSignalRef, kind: 'DISRUPTION' as const, label: humanizeCode(cause.changeType), semanticState: 'CHANGED' as const, authority: 'AUTHORITATIVE' as const, detail: `${humanizeCode(cause.originKind)} · received ${formatInstantUtc(cause.receivedAt)}` }]
        : []),
      ...subjects.rows.map((s) => {
        const ref = `${s.subject_kind}:${s.subject_id}`;
        // FIG-6: each subject's own CURRENT verdict decides its node, never the
        // case's aggregate (a PASS subject must be able to read HEALTHY even
        // when another subject fails the whole case).
        const fact = subjectFactByRef.get(ref);
        const semanticState = fact ? TONE_TO_STATE[fact.tone] : 'UNKNOWN' as const;
        // R2: use human label for JOURNEY subjects (traveller display name)
        const label = s.subject_kind === 'JOURNEY' 
          ? (travellerLabelsByJourney.get(s.subject_id) ?? s.subject_kind)
          : s.subject_kind;
        return {
          ref,
          kind: 'TRAVELLER' as const,
          label,
          semanticState,
          authority: 'AUTHORITATIVE' as const,
          caseRef: caseId,
          ...(fact ? { evaluation: fact.evaluation } : {}),
        };
      }),
      // R2: append enrichment nodes (SERVICE_BOOKING, TRANSFER_STAY, PROGRAMME_COMMITMENT, etc.)
      ...enrichment.nodes,
    ],
    edges: [
      ...(cause
        ? subjects.rows.map((s) => ({
            id: `AFFECTED_BY:${s.subject_kind}:${s.subject_id}:${cause.changeSignalRef}`,
            fromRef: `${s.subject_kind}:${s.subject_id}`,
            toRef: cause.changeSignalRef,
            kind: 'AFFECTED_BY' as const,
            authority: 'AUTHORITATIVE' as const,
          }))
        : []),
      // R2: append enrichment edges (RELIES_ON, MUST_HAPPEN_BEFORE, PARTICIPATES_IN, etc.)
      ...enrichment.edges,
    ],
    caseRef: caseId,
    ...(cause ? { cause } : {}),
    causalPath,
    status,
    changeSummary: cause
      ? `${cause.changeType} (${cause.originKind}) received ${cause.receivedAt}`
      : 'Recovery case assembled from authoritative PostgreSQL state',
    ...(firstBreak ? { causalFailureReason: `${firstBreak.dimension}: ${firstBreak.reasonCode}` } : {}),
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
    // Contract key format is `<KIND>:<id>` (types.ts subjectHumanLabels);
    // travellerLabelsByJourney is keyed by bare journey id, so re-key here at
    // the boundary. Same generic rule for any subject kind.
    subjectHumanLabels: new Map(
      [...travellerLabelsByJourney].map(([journeyId, label]) => [`JOURNEY:${journeyId}`, label]),
    ),
    ...(planningAttempt ? { planningAttempt } : {}),
    attention,
    ...(originalFocusedGraph ? { originalFocusedGraph } : {}),
    ...(row.resolution_summary ? { resolutionSummary: row.resolution_summary } : {}),
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
      ...(facts.cause ? { incidentRef: facts.cause.changeSignalRef } : {}),
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
  //
  // `traveller_label` is the node's label: the authoritative traveller
  // display name, taken through the exact join the overview queue above
  // already treats as the display-identity source (`travellers` ->
  // `traveller_names.display_value` via `display_name_ref`). Both columns are
  // NOT NULL and 0012's subtype trigger guarantees the ref selects exactly
  // one row for that traveller, so this stays an inner join with no
  // fabricated fallback — and no second lookup path.
  // One query now serves both collections, because both are the same
  // authoritative membership question asked at two widths, and asking it
  // twice on the same snapshot would just double the work:
  //
  //  - `population` (additive): every Journey whose traveller holds ANY
  //    accepted participation in an ACTIVE programme. This is "whose travel
  //    am I responsible for", which is what the baseline operator surface
  //    must show before any case exists.
  //  - `ldg.nodes` (unchanged): the REQUIRED+accepted subset, exactly the
  //    scope described below. Widening the graph would change an accepted
  //    contract; the wider population gets its own collection instead.
  //
  // `has_required` carries that distinction, and `obligation` reports the
  // strongest accepted obligation so the surface can say why a subject is in
  // scope rather than inferring it.
  const population = await client.query<{
    journey_id: string;
    trip_id: string;
    traveller_label: string;
    has_required: boolean;
    obligation: 'REQUIRED' | 'OPTIONAL' | 'INFORMED';
  }>(
    `SELECT j.id AS journey_id,
            j.trip_id,
            n.display_value AS traveller_label,
            bool_or(p.obligation = 'REQUIRED') AS has_required,
            CASE
              WHEN bool_or(p.obligation = 'REQUIRED') THEN 'REQUIRED'
              WHEN bool_or(p.obligation = 'OPTIONAL') THEN 'OPTIONAL'
              ELSE 'INFORMED'
            END AS obligation
       FROM journeys j
       JOIN travellers t ON t.workspace_id = j.workspace_id AND t.id = j.traveller_id
       JOIN traveller_names n ON n.workspace_id = t.workspace_id AND n.id = t.display_name_ref
       JOIN participations p ON p.workspace_id = j.workspace_id AND p.traveller_id = j.traveller_id
       JOIN programme_items pi ON pi.workspace_id = p.workspace_id AND pi.id = p.programme_item_id
       JOIN programmes prog ON prog.workspace_id = pi.workspace_id AND prog.id = pi.programme_id
      WHERE j.workspace_id = $1
        AND j.lifecycle_status <> 'CANCELLED'
        AND p.accepted = true
        AND prog.lifecycle_status = 'ACTIVE'
      GROUP BY j.id, j.trip_id, n.display_value
      ORDER BY j.id
      LIMIT 200`,
    [workspaceId],
  );

  const dashboardNodes: OperatorOverviewFacts['nodes'][number][] = [];
  const populationFacts: OperatorPopulationFact[] = [];
  const subjectStamps: bigint[] = [];
  const changedNodeRefs: string[] = [];
  for (const p of population.rows) {
    const ref = `JOURNEY:${p.journey_id}`;
    const subjectStamp = await readEvaluationLifecycleStamp(client, workspaceId, 'JOURNEY', p.journey_id, 'VIABILITY');
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
    const linkedCaseId = caseLink.rows[0]?.recovery_case_id;
    // R2: this node presents two authoritative things that move
    // independently — the subject's own evaluation (bumped in the subject's
    // `VIABILITY` scope) and its linkage to a case (opening the case and
    // attaching `case_subjects` bump `RECOVERY_CASE:<id>:CASE`, migrations
    // 0122/0123, never the subject's scope). Taking only the subject stamp
    // meant the next snapshot carried the new `caseRef` while the subject was
    // absent from `changedVisibleRefs`, so a renderer deciding what to
    // emphasise from the changed set missed the escalation. The node's
    // effective stamp is therefore the newer of the two authoritative stamps
    // it actually presents. Safe to max (see readEvaluationLifecycleStamp):
    // both are globally unique, strictly increasing xid8 values on one scale.
    // No business semantics change — the subject's tone/evaluation still come
    // only from its own CURRENT assessment.
    const linkedCaseStamp = linkedCaseId
      ? await readEvaluationLifecycleStamp(client, workspaceId, 'RECOVERY_CASE', linkedCaseId, 'CASE')
      : 0n;
    const stamp = linkedCaseStamp > subjectStamp ? linkedCaseStamp : subjectStamp;
    subjectStamps.push(stamp);
    if (sinceCursorBig !== undefined && stamp >= sinceCursorBig) changedNodeRefs.push(ref);

    // The population entry reports the same authoritative tone in the
    // product vocabulary `items` already uses, so the frontend compares like
    // with like and computes neither. A subject whose assessment is not
    // CURRENT reads UNKNOWN with its real lifecycle in `evaluation` — it is
    // never optimistically presented as ready.
    populationFacts.push({
      journeyRef: ref,
      tripRef: `TRIP:${p.trip_id}`,
      travellerLabel: p.traveller_label,
      obligation: p.obligation,
      status: tone === 'PASS' ? 'READY' : tone === 'FAIL' ? 'DISRUPTED' : 'UNKNOWN',
      remainderViability: tone === 'PASS' ? 'VIABLE' : tone === 'FAIL' ? 'NOT_VIABLE' : 'UNKNOWN',
      evaluation: view.status,
      ...(linkedCaseId ? { caseRef: linkedCaseId } : {}),
    });

    if (!p.has_required) continue;
    dashboardNodes.push({
      ref,
      kind: 'TRAVELLER' as const,
      label: p.traveller_label,
      semanticState: TONE_TO_STATE[tone],
      authority: 'AUTHORITATIVE' as const,
      ...(linkedCaseId ? { caseRef: linkedCaseId } : {}),
      evaluation: view.status,
    });
  }

  // ---- Event Overview source rows (bounded, same snapshot). Scope is the
  // same ACTIVE-programme predicate as the population above; the journey ids
  // are reused from `population`, so no per-journey assessment read repeats.
  // Local dates/times are computed here, in each row's own time zone, so the
  // pure builder holds no time-zone logic. ----
  const overviewJourneyIds = population.rows.map((r) => r.journey_id);
  const overviewItems = await client.query<{
    id: string;
    title: string;
    window_start_utc: string;
    local_date: string;
    local_time: string;
  }>(
    `SELECT pi.id, pi.title,
            to_char(pi.window_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS window_start_utc,
            to_char(pi.window_start AT TIME ZONE COALESCE(pi.time_zone, 'UTC'), 'YYYY-MM-DD') AS local_date,
            to_char(pi.window_start AT TIME ZONE COALESCE(pi.time_zone, 'UTC'), 'HH24:MI') AS local_time
       FROM programme_items pi
       JOIN programmes prog ON prog.workspace_id = pi.workspace_id AND prog.id = pi.programme_id
      WHERE pi.workspace_id = $1
        AND prog.lifecycle_status = 'ACTIVE'
        AND pi.lifecycle_status <> 'CANCELLED'
        AND pi.window_start IS NOT NULL
      ORDER BY pi.window_start, pi.id
      LIMIT 500`,
    [workspaceId],
  );
  const overviewParticipations = await client.query<{
    programme_item_id: string;
    journey_id: string;
    obligation: 'REQUIRED' | 'OPTIONAL' | 'INFORMED';
  }>(
    `SELECT p.programme_item_id, j.id AS journey_id, p.obligation
       FROM participations p
       JOIN programme_items pi ON pi.workspace_id = p.workspace_id AND pi.id = p.programme_item_id
       JOIN programmes prog ON prog.workspace_id = pi.workspace_id AND prog.id = pi.programme_id
       JOIN journeys j ON j.workspace_id = p.workspace_id AND j.traveller_id = p.traveller_id
      WHERE p.workspace_id = $1
        AND p.accepted = true
        AND prog.lifecycle_status = 'ACTIVE'
        AND pi.lifecycle_status <> 'CANCELLED'
        AND j.id = ANY($2::uuid[])
      ORDER BY pi.window_start NULLS LAST, p.programme_item_id, j.id
      LIMIT 2000`,
    [workspaceId, overviewJourneyIds],
  );
  const overviewServices = await client.query<{
    journey_id: string;
    service_id: string;
    mode: 'AIR' | 'RAIL' | 'ROAD' | 'SEA';
    operator: string;
    arrival_local_date: string | null;
    arrival_local_time: string | null;
    published_arrival_local_time: string | null;
    changed: boolean;
  }>(
    `SELECT DISTINCT ji.journey_id, s.id AS service_id, s.mode, s.operator,
            to_char(COALESCE(s.actual_arrival, s.estimated_arrival, s.published_arrival) AT TIME ZONE dp.time_zone, 'YYYY-MM-DD') AS arrival_local_date,
            to_char(COALESCE(s.actual_arrival, s.estimated_arrival, s.published_arrival) AT TIME ZONE dp.time_zone, 'HH24:MI') AS arrival_local_time,
            to_char(s.published_arrival AT TIME ZONE dp.time_zone, 'HH24:MI') AS published_arrival_local_time,
            ((COALESCE(s.actual_arrival, s.estimated_arrival) IS NOT NULL
              AND s.published_arrival IS NOT NULL
              AND COALESCE(s.actual_arrival, s.estimated_arrival) IS DISTINCT FROM s.published_arrival)
             OR (COALESCE(s.actual_departure, s.estimated_departure) IS NOT NULL
              AND s.published_departure IS NOT NULL
              AND COALESCE(s.actual_departure, s.estimated_departure) IS DISTINCT FROM s.published_departure)) AS changed
       FROM journey_items ji
       JOIN transport_item_details td ON td.workspace_id = ji.workspace_id AND td.journey_item_id = ji.id
       JOIN transport_services s ON s.workspace_id = td.workspace_id AND s.id = td.selected_service_id
       JOIN places dp ON dp.workspace_id = s.workspace_id AND dp.id = s.destination_place_id
      WHERE ji.workspace_id = $1
        AND ji.kind = 'TRANSPORT'
        AND ji.lifecycle_status <> 'DROPPED'
        AND ji.journey_id = ANY($2::uuid[])
      ORDER BY s.id, ji.journey_id
      LIMIT 1000`,
    [workspaceId, overviewJourneyIds],
  );
  const eventOverviewSource: EventOverviewSourceFacts = {
    programmeItems: overviewItems.rows.map((r) => ({
      itemRef: `PROGRAMME_ITEM:${r.id}`,
      title: r.title,
      localDate: r.local_date,
      localTime: r.local_time,
      windowStart: r.window_start_utc,
    })),
    participations: overviewParticipations.rows.map((r) => ({
      itemRef: `PROGRAMME_ITEM:${r.programme_item_id}`,
      journeyRef: `JOURNEY:${r.journey_id}`,
      obligation: r.obligation,
    })),
    journeyServices: overviewServices.rows.map((r) => ({
      journeyRef: `JOURNEY:${r.journey_id}`,
      serviceRef: `SERVICE:${r.service_id}`,
      mode: r.mode,
      operator: r.operator,
      ...(r.arrival_local_date ? { arrivalLocalDate: r.arrival_local_date } : {}),
      ...(r.arrival_local_time ? { arrivalLocalTime: r.arrival_local_time } : {}),
      ...(r.published_arrival_local_time ? { publishedArrivalLocalTime: r.published_arrival_local_time } : {}),
      changed: r.changed,
    })),
  };

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

  // Event context for the product shell: the ACTIVE programme's event, with
  // its organiser. A workspace can legitimately hold several events, so this
  // is reported only when exactly one ACTIVE programme identifies one — no
  // arbitrary "first row" is promoted to "the event you are working".
  const eventRows = await client.query<{
    event_id: string;
    title: string;
    programme_id: string;
    organiser_label: string | null;
  }>(
    `SELECT e.id AS event_id, e.title, prog.id AS programme_id, o.legal_name AS organiser_label
       FROM programmes prog
       JOIN events e ON e.workspace_id = prog.workspace_id AND e.id = prog.event_id
       LEFT JOIN organisations o
              ON o.workspace_id = e.workspace_id AND o.id = e.organiser_organisation_id
      WHERE prog.workspace_id = $1 AND prog.lifecycle_status = 'ACTIVE'
      LIMIT 2`,
    [workspaceId],
  );
  const eventRow = eventRows.rowCount === 1 ? eventRows.rows[0] : undefined;

  // Demo ingress configuration: the trigger is configurable only when the
  // workspace has a provisioning connection AND a disclosed disruption event
  // file is configured for this runtime.
  const connectionCheck = await client.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM external_connections WHERE workspace_id = $1 LIMIT 1',
    [workspaceId],
  );
  const hasExternalConnection = connectionCheck.rows[0]?.count !== '0';
  const hasDisclosedDisruptionEvent = disruptionEventFileFromEnv() !== undefined;

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
    population: populationFacts,
    eventOverviewSource,
    ...(eventRow
      ? {
        eventContext: {
          eventRef: `EVENT:${eventRow.event_id}`,
          title: eventRow.title,
          programmeRef: `PROGRAMME:${eventRow.programme_id}`,
          ...(eventRow.organiser_label ? { organiserLabel: eventRow.organiser_label } : {}),
        },
      }
      : {}),
    demoIngress: {
      airlineRebookingConfigured: hasExternalConnection && hasDisclosedDisruptionEvent,
    },
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
  itinerary?: readonly NonNullable<TravellerTripFacts['itinerary']>[number][];
  commitment?: TravellerTripFacts['commitment'];
  generatedAt?: string;
}): TravellerTripFacts {
  return {
    generatedAt: isoNow(input.generatedAt),
    projectionRevision: 1,
    changedVisibleRefs: [input.tripRef],
    changedEdgeIds: [],
    currentSemanticState: input.amIOkay === 'NO' ? 'FAILED' : input.amIOkay === 'YES' ? 'HEALTHY' : 'UNKNOWN',
    nodes: [{ ref: input.tripRef, kind: 'TRAVELLER', label: 'Your trip', semanticState: input.amIOkay === 'NO' ? 'FAILED' : input.amIOkay === 'YES' ? 'HEALTHY' : 'UNKNOWN', authority: 'AUTHORITATIVE' }],
    edges: [],
    tripRef: input.tripRef,
    amIOkay: input.amIOkay,
    ...(input.whatChanged ? { whatChanged: input.whatChanged } : {}),
    ...(input.whatMattersNow ? { whatMattersNow: input.whatMattersNow } : {}),
    ...(input.whatNorthstarIsDoing ? { whatNorthstarIsDoing: input.whatNorthstarIsDoing } : {}),
    ...(input.whatDoYouNeedFromMe ? { whatDoYouNeedFromMe: input.whatDoYouNeedFromMe } : {}),
    doesTheRestWork: input.doesTheRestWork,
    ...(input.itinerary && input.itinerary.length > 0 ? { itinerary: input.itinerary } : {}),
    ...(input.commitment ? { commitment: input.commitment } : {}),
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
  const { value } = await withProjectionSnapshot(pool, async (client) => {
    const generatedAt = isoNow(at);
    const journey = await client.query<{ trip_id: string; traveller_id: string }>(
      `SELECT trip_id, traveller_id FROM journeys WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, journeyId],
    );
    const j = journey.rows[0];
    if (!j) return null;

    const assessment = await currentAssessmentView(
      client,
      workspaceId,
      { kind: 'JOURNEY', id: journeyId } as TypedRef,
      'VIABILITY',
      generatedAt,
    );
    const verdict = assessment.status === 'CURRENT' ? assessment.assessment?.overallVerdict : undefined;
    const amIOkay: 'YES' | 'NO' | 'UNKNOWN' =
      verdict === 'PASS' ? 'YES' : verdict === 'FAIL' ? 'NO' : 'UNKNOWN';
    const doesTheRestWork: RemainderViability =
      verdict === 'PASS' ? 'VIABLE' : verdict === 'FAIL' ? 'NOT_VIABLE' : 'UNKNOWN';

    const travellerItems = await client.query<{
      kind: 'TRANSPORT' | 'STAY' | 'ENGAGEMENT' | 'RESOURCE_USE';
      lifecycle_status: string;
      intended_window_start: Date | null;
      intended_window_end: Date | null;
      order_key: string;
      operator: string | null;
      mode: string | null;
      origin_place_name: string | null;
      origin_time_zone: string | null;
      destination_place_name: string | null;
      destination_time_zone: string | null;
      published_departure: Date | null;
      published_arrival: Date | null;
      estimated_departure: Date | null;
      estimated_arrival: Date | null;
      actual_departure: Date | null;
      actual_arrival: Date | null;
      stay_place_name: string | null;
      stay_time_zone: string | null;
      engagement_title: string | null;
      engagement_place_name: string | null;
      engagement_time_zone: string | null;
      booking_status: string | null;
    }>(
      `SELECT ji.kind, ji.lifecycle_status, ji.intended_window_start, ji.intended_window_end, ji.order_key,
              ts.operator, ts.mode,
              po.name AS origin_place_name, po.time_zone AS origin_time_zone,
              pd.name AS destination_place_name, pd.time_zone AS destination_time_zone,
              ts.published_departure, ts.published_arrival,
              ts.estimated_departure, ts.estimated_arrival,
              ts.actual_departure, ts.actual_arrival,
              sp.name AS stay_place_name, sp.time_zone AS stay_time_zone,
              COALESCE(epi.title, eid.standalone_title) AS engagement_title,
              ep.name AS engagement_place_name, ep.time_zone AS engagement_time_zone,
              booking.booking_status
         FROM journey_items ji
         LEFT JOIN transport_item_details tid
           ON tid.workspace_id = ji.workspace_id AND tid.journey_item_id = ji.id
         LEFT JOIN LATERAL (
           SELECT CASE
                    WHEN count(DISTINCT tld.transport_service_id) = 1
                    THEN (array_agg(tld.transport_service_id))[1]
                    ELSE NULL
                  END AS transport_service_id,
                  CASE
                    WHEN count(*) = 0
                      OR count(DISTINCT tld.transport_service_id) <> 1
                      OR count(DISTINCT (rl.observed_status, r.observed_status)) <> 1
                      OR bool_or(rl.observed_status IS DISTINCT FROM r.observed_status)
                    THEN NULL
                    ELSE COALESCE(max(rl.observed_status), max(r.observed_status))
                  END AS booking_status,
                  max(rl.observed_status) AS line_status,
                  max(r.observed_status) AS reservation_status
             FROM reservation_allocations ra
             JOIN reservation_lines rl
               ON rl.workspace_id = ra.workspace_id AND rl.id = ra.line_id
             JOIN reservations r
               ON r.workspace_id = ra.workspace_id AND r.id = ra.reservation_id
             LEFT JOIN transport_line_details tld
               ON tld.workspace_id = rl.workspace_id AND tld.line_id = rl.id
            WHERE ra.workspace_id = ji.workspace_id
              AND ra.journey_item_id = ji.id
              AND ra.traveller_id = $3
              AND (tid.selected_service_id IS NULL OR tld.transport_service_id = tid.selected_service_id)
         ) booking ON true
         LEFT JOIN transport_services ts
           ON ts.workspace_id = ji.workspace_id
          AND ts.id = COALESCE(tid.selected_service_id, booking.transport_service_id)
         LEFT JOIN places po
           ON po.workspace_id = ts.workspace_id AND po.id = ts.origin_place_id
         LEFT JOIN places pd
           ON pd.workspace_id = ts.workspace_id AND pd.id = ts.destination_place_id
         LEFT JOIN stay_item_details sid
           ON sid.workspace_id = ji.workspace_id AND sid.journey_item_id = ji.id
         LEFT JOIN places sp
           ON sp.workspace_id = sid.workspace_id AND sp.id = sid.intended_place_id
         LEFT JOIN engagement_item_details eid
           ON eid.workspace_id = ji.workspace_id AND eid.journey_item_id = ji.id
         LEFT JOIN participations epart
           ON epart.workspace_id = eid.workspace_id AND epart.id = eid.participation_id
         LEFT JOIN programme_items epi
           ON epi.workspace_id = epart.workspace_id AND epi.id = epart.programme_item_id
         LEFT JOIN places ep
           ON ep.workspace_id = epi.workspace_id AND ep.id = epi.place_id
        WHERE ji.workspace_id = $1 AND ji.journey_id = $2
        ORDER BY ji.order_key, ji.id`,
      [workspaceId, journeyId, j.traveller_id],
    );

    const itinerary = travellerItems.rows.map((row) => {
      const status = row.kind === 'TRANSPORT'
        ? row.booking_status ?? 'UNKNOWN'
        : row.lifecycle_status;
      if (row.kind === 'TRANSPORT') {
        const startsAt = row.actual_departure ?? row.estimated_departure ?? row.published_departure;
        const endsAt = row.actual_arrival ?? row.estimated_arrival ?? row.published_arrival;
        return {
          label: row.operator || (row.mode ? `${row.mode} journey` : 'Travel segment'),
          ...(row.origin_place_name ? { originLabel: row.origin_place_name } : {}),
          ...(row.destination_place_name ? { destinationLabel: row.destination_place_name } : {}),
          ...(startsAt ? { startsAt: startsAt.toISOString() } : {}),
          ...(endsAt ? { endsAt: endsAt.toISOString() } : {}),
          ...(row.origin_time_zone ? { startTimeZone: row.origin_time_zone } : {}),
          ...(row.destination_time_zone ? { endTimeZone: row.destination_time_zone } : {}),
          status,
        };
      }
      const label = row.kind === 'STAY'
        ? row.stay_place_name ? `Stay at ${row.stay_place_name}` : 'Stay'
        : row.kind === 'ENGAGEMENT'
          ? row.engagement_title || 'Programme commitment'
          : 'Planned activity';
      const placeLabel = row.kind === 'STAY' ? row.stay_place_name : row.engagement_place_name;
      const timeZone = row.kind === 'STAY' ? row.stay_time_zone : row.engagement_time_zone;
      return {
        label,
        ...(placeLabel ? { placeLabel } : {}),
        ...(row.intended_window_start ? { startsAt: row.intended_window_start.toISOString() } : {}),
        ...(row.intended_window_end ? { endsAt: row.intended_window_end.toISOString() } : {}),
        ...(timeZone ? { startTimeZone: timeZone, endTimeZone: timeZone } : {}),
        status,
      };
    });

    const commitment = await client.query<{
      title: string;
      window_start: Date | null;
      window_end: Date | null;
      place_name: string | null;
      time_zone: string | null;
    }>(
      `SELECT pi.title, pi.window_start, pi.window_end, pz.name AS place_name, pz.time_zone
         FROM journey_items ji
         JOIN engagement_item_details eid
           ON eid.workspace_id = ji.workspace_id AND eid.journey_item_id = ji.id
         JOIN participations p
           ON p.workspace_id = eid.workspace_id AND p.id = eid.participation_id
          AND p.accepted AND p.obligation = 'REQUIRED'
         JOIN programme_items pi
           ON pi.workspace_id = p.workspace_id AND pi.id = p.programme_item_id
         LEFT JOIN places pz
           ON pz.workspace_id = pi.workspace_id AND pz.id = pi.place_id
        WHERE ji.workspace_id = $1 AND ji.journey_id = $2
        ORDER BY pi.window_start NULLS LAST, pi.id
        LIMIT 1`,
      [workspaceId, journeyId],
    );
    const commitmentRow = commitment.rows[0];
    const commitmentFact = commitmentRow
      ? {
        label: commitmentRow.title,
        ...(commitmentRow.window_start ? { windowStart: commitmentRow.window_start.toISOString() } : {}),
        ...(commitmentRow.window_end ? { windowEnd: commitmentRow.window_end.toISOString() } : {}),
        ...(commitmentRow.time_zone ? { timeZone: commitmentRow.time_zone } : {}),
        ...(commitmentRow.place_name ? { placeLabel: commitmentRow.place_name } : {}),
      }
      : undefined;

    const caseLink = await client.query<{ recovery_case_id: string; lifecycle_status: string }>(
      `SELECT cs.recovery_case_id, rc.lifecycle_status
         FROM case_subjects cs
         JOIN recovery_cases rc ON rc.workspace_id = cs.workspace_id AND rc.id = cs.recovery_case_id
        WHERE cs.workspace_id = $1 AND cs.subject_kind = 'JOURNEY' AND cs.subject_id = $2
        ORDER BY (rc.closed_at IS NULL) DESC, rc.opened_at DESC
        LIMIT 1`,
      [workspaceId, journeyId],
    );
    const linked = caseLink.rows[0];
    const caseProgress = linked
      ? ({
        OPEN: 'Northstar is monitoring a travel change affecting your trip.',
        PLANNING: 'Northstar is checking recovery options for your trip.',
        AWAITING_AUTHORITY: 'Northstar has prepared a recovery and is waiting for approval.',
        EXECUTING: 'Northstar is applying the approved recovery for your trip.',
        RESOLVED: 'Northstar completed the recovery for your trip.',
        CLOSED: 'Northstar has closed the recovery work for your trip.',
        CANCELLED: 'Northstar closed the recovery work for your trip.',
      } as Record<string, string>)[linked.lifecycle_status] ?? 'Northstar is monitoring a recovery case for your trip.'
      : undefined;

    return buildTravellerTripFacts({
      tripRef: j.trip_id,
      amIOkay,
      doesTheRestWork,
      generatedAt,
      ...(linked ? { whatChanged: 'A travel change is affecting this trip.' } : {}),
      whatMattersNow: amIOkay === 'NO'
        ? 'Your current plan needs attention.'
        : amIOkay === 'YES'
          ? 'Your current plan is viable.'
          : 'We are still checking your trip.',
      ...(caseProgress ? { whatNorthstarIsDoing: caseProgress } : {}),
      ...(linked?.lifecycle_status === 'AWAITING_AUTHORITY'
        ? { whatDoYouNeedFromMe: 'Nothing required from you right now. The recovery is waiting for approval.' }
        : {}),
      ...(linked?.lifecycle_status === 'RESOLVED' && amIOkay === 'YES'
        ? { whatChangedAfterRecovery: 'The recovery for this trip is complete.' }
        : {}),
      ...(itinerary.length > 0 ? { itinerary } : {}),
      ...(commitmentFact ? { commitment: commitmentFact } : {}),
    });
  });
  return value;
}

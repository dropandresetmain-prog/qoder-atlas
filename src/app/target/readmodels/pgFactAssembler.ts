/**
 * Assemble product read-model facts from PostgreSQL (or in-memory inputs).
 *
 * Pure projectors stay in project*.ts — this module owns I/O and joins.
 * Missing tables/rows yield UNKNOWN / empty arrays — never invented certainty.
 */
import type { Pool } from '../../../persistence/postgres/pool.ts';
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

export async function loadRecoveryActionFacts(
  pool: Pool,
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

export async function loadRecoveryCaseFacts(
  pool: Pool,
  workspaceId: string,
  caseId: string,
  at?: string,
): Promise<RecoveryCaseFacts | null> {
  const caseRow = await pool.query<{
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

  const recoveryActions = await loadRecoveryActionFacts(pool, workspaceId, caseId);
  const generatedAt = isoNow(at);

  const strategyRows = await pool.query<{
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
  const subjects = await pool.query<{ subject_kind: string; subject_id: string; role: string }>(
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
  interface SubjectFact { ref: string; tone: AssessmentTone; evaluation: AssessmentViewStatus }
  const subjectFacts: SubjectFact[] = [];
  // M9 3A: derive connection viability from the real m6.connection dimension
  // (never a caller-supplied SAFE/AT_RISK/IMPOSSIBLE hint). Worst-of across
  // case subjects — one broken connection is enough to flag the case.
  const CONNECTION_SEVERITY: Record<ConnectionViabilityHint, number> = { VIABLE: 0, UNKNOWN: 1, TIGHT: 2, IMPOSSIBLE: 3 };
  let connectionViability: ConnectionViabilityHint | undefined;
  for (const s of subjects.rows) {
    const ref = `${s.subject_kind}:${s.subject_id}`;
    const view = await currentAssessmentView(
      pool,
      workspaceId,
      { kind: s.subject_kind, id: s.subject_id } as TypedRef,
      'VIABILITY',
      generatedAt,
    );
    if (view.status === 'CURRENT' && view.assessment) {
      const verdict = view.assessment.overallVerdict;
      const tone: AssessmentTone = verdict === 'PASS' ? 'PASS' : verdict === 'FAIL' ? 'FAIL' : 'UNKNOWN';
      subjectFacts.push({ ref, tone, evaluation: view.status });
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
      subjectFacts.push({ ref, tone: 'UNKNOWN', evaluation: view.status });
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
  const TONE_TO_STATE = { PASS: 'HEALTHY', FAIL: 'FAILED', UNKNOWN: 'UNKNOWN' } as const;
  return {
    generatedAt,
    projectionRevision: recoveryActions.length + subjects.rows.length,
    changedVisibleRefs: recoveryActions.map((a) => a.actionRef),
    changedEdgeIds: [],
    currentSemanticState: tripVerdict === 'FAIL' ? 'FAILED' : tripVerdict === 'PASS' ? 'RECOVERED' : 'AFFECTED',
    nodes: [
      { ref: `case:${caseId}`, kind: 'RECOVERY_PROPOSAL', label: 'Recovery case', semanticState: 'ACTIVE', authority: 'AUTHORITATIVE' },
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
      id: `AFFECTED_BY:${s.subject_kind}:${s.subject_id}:case:${caseId}`,
      fromRef: `${s.subject_kind}:${s.subject_id}`,
      toRef: `case:${caseId}`,
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

export async function loadOperatorOverviewFacts(
  pool: Pool,
  workspaceId: string,
  at?: string,
): Promise<OperatorOverviewFacts> {
  const generatedAt = isoNow(at);
  const cases = await pool.query<{ id: string; lifecycle_status: string }>(
    `SELECT id, lifecycle_status FROM recovery_cases WHERE workspace_id = $1 ORDER BY opened_at DESC LIMIT 50`,
    [workspaceId],
  );

  const items = [];
  for (const c of cases.rows) {
    const facts = await loadRecoveryCaseFacts(pool, workspaceId, c.id, generatedAt);
    if (!facts) continue;
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
      const named = await pool.query<{ display_value: string }>(
        `SELECT n.display_value
           FROM journeys j
           JOIN travellers t ON t.workspace_id = j.workspace_id AND t.id = j.traveller_id
           JOIN traveller_names n ON n.workspace_id = t.workspace_id AND n.id = t.display_name_ref
          WHERE j.workspace_id = $1 AND j.id = $2`,
        [workspaceId, journeyId],
      );
      if (named.rows[0]?.display_value) travellerLabel = named.rows[0].display_value;
    }
    // The dashboard node's subject is the primary affected item (FIG-4); its
    // evaluation lifecycle (FIG-7) is that same subject's, reused from the
    // CURRENT-assessment lookup `loadRecoveryCaseFacts` already did.
    const primaryEvaluation = facts.subjectFacts?.[0]?.evaluation;
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

  const STATUS_TO_STATE = {
    READY: 'HEALTHY', AT_RISK: 'AFFECTED', DISRUPTED: 'FAILED', RECOVERING: 'ACTIVE', UNKNOWN: 'UNKNOWN',
  } as const;
  return {
    generatedAt,
    projectionRevision: items.length,
    changedVisibleRefs: items.map((i) => i.caseRef!).filter(Boolean) as string[],
    changedEdgeIds: [],
    currentSemanticState: items.some((i) => i.status === 'DISRUPTED') ? 'FAILED' : 'HEALTHY',
    nodes: items.map((i) => ({
      // FIG-4: keyed by the canonical subject ref the case graph already uses
      // (e.g. `JOURNEY:<id>`), not the bare case id — so the same subject
      // keeps one ref before and after escalation. caseRef is the separate
      // linkage/escalation marker, never identity.
      ref: i.tripRef,
      kind: 'DISRUPTION' as const,
      label: i.travellerLabel,
      // FIG-6: the full operational-status range, not a DISRUPTED-or-HEALTHY
      // collapse — AT_RISK/RECOVERING/UNKNOWN must not render green.
      semanticState: STATUS_TO_STATE[i.status],
      authority: 'AUTHORITATIVE' as const,
      ...(i.caseRef ? { caseRef: i.caseRef } : {}),
      ...(i.evaluation ? { evaluation: i.evaluation } : {}),
    })),
    edges: [],
    items,
  };
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
 * Outcomes come from latest VIABILITY assessments on JOURNEY subjects — never invented.
 */
export async function loadIncidentProgrammeFacts(
  pool: Pool,
  workspaceId: string,
  caseId: string,
  at?: string,
): Promise<IncidentProgrammeFacts | null> {
  const caseFacts = await loadRecoveryCaseFacts(pool, workspaceId, caseId, at);
  if (!caseFacts) return null;

  const journeySubjects = await pool.query<{ subject_id: string }>(
    `SELECT subject_id FROM case_subjects
      WHERE workspace_id = $1 AND recovery_case_id = $2 AND subject_kind = 'JOURNEY'`,
    [workspaceId, caseId],
  );

  const travellers: CohortTravellerEvaluationInput[] = [];
  for (const row of journeySubjects.rows) {
    const journey = await pool.query<{ trip_id: string; traveller_id: string }>(
      `SELECT trip_id, traveller_id FROM journeys WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, row.subject_id],
    );
    const j = journey.rows[0];
    if (!j) continue;
    const name = await pool.query<{ display_value: string }>(
      `SELECT n.display_value
         FROM travellers t
         JOIN traveller_names n ON n.workspace_id = t.workspace_id AND n.id = t.display_name_ref
        WHERE t.workspace_id = $1 AND t.id = $2`,
      [workspaceId, j.traveller_id],
    );
    const assessment = await pool.query<{ overall_verdict: string }>(
      `SELECT a.overall_verdict
         FROM assessments a
         JOIN assessment_subjects s ON s.workspace_id = a.workspace_id AND s.assessment_id = a.id
        WHERE a.workspace_id = $1 AND a.kind = 'VIABILITY'
          AND s.subject_kind = 'JOURNEY' AND s.subject_id = $2
        ORDER BY a.evaluated_at DESC LIMIT 1`,
      [workspaceId, row.subject_id],
    );
    const participation = await pool.query<{ id: string }>(
      `SELECT p.id FROM participations p
        WHERE p.workspace_id = $1 AND p.traveller_id = $2 AND p.obligation = 'REQUIRED' AND p.accepted = true
        LIMIT 1`,
      [workspaceId, j.traveller_id],
    );
    const verdictRaw = assessment.rows[0]?.overall_verdict;
    const programmeOutcome: AssessmentTone =
      verdictRaw === 'PASS' || verdictRaw === 'FAIL' || verdictRaw === 'UNKNOWN'
        ? verdictRaw
        : 'UNKNOWN';
    travellers.push({
      travellerRef: j.traveller_id,
      personLabel: name.rows[0]?.display_value ?? `Traveller ${j.traveller_id.slice(0, 8)}`,
      tripRef: j.trip_id,
      journeyRef: row.subject_id,
      programmeOutcome,
      remainderViability: programmeOutcome === 'PASS' ? 'VIABLE' : programmeOutcome === 'FAIL' ? 'NOT_VIABLE' : 'UNKNOWN',
      hasEvaluatedRequiredProgrammeDependency: participation.rows.length > 0,
    });
  }

  const programmeItems = await pool.query<{
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

  return loadIncidentProgrammeFactsFromCohort({
    incidentRef: caseId,
    sourceChangeSummary: caseFacts.changeSummary,
    generatedAt: caseFacts.generatedAt,
    travellers,
    programmeCommitments: programmeItems.rows.map((pi) => ({
      itemRef: pi.id,
      label: pi.title,
      ...(pi.window_start ? { windowLabel: pi.window_start.toISOString() } : {}),
      state: pi.lifecycle_status === 'CANCELLED' ? 'FAILED' as const : 'ACTIVE' as const,
    })),
    currentProgrammeState: programmeItems.rows
      .map((pi) => `${pi.title}@${pi.window_start?.toISOString() ?? 'unscheduled'}`)
      .join('; ') || undefined,
  });
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

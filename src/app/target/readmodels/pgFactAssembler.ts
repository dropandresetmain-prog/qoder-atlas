/**
 * Assemble product read-model facts from PostgreSQL (or in-memory inputs).
 *
 * Pure projectors stay in project*.ts — this module owns I/O and joins.
 * Missing tables/rows yield UNKNOWN / empty arrays — never invented certainty.
 */
import type { Pool } from '../../../persistence/postgres/pool.ts';
import type {
  AssessmentTone,
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
import { mapConnectionProgression } from './mapConnectionProgression.ts';
import { evaluateSharedDisruptionCohort } from '../cohortDisruption.ts';

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

  const observations = await pool.query<{
    action_intent_id: string;
    origin: string;
  }>(
    `SELECT action_intent_id, origin
       FROM execution_observations
      WHERE workspace_id = $1 AND action_intent_id = ANY($2::uuid[])
      ORDER BY observed_at DESC`,
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
  const latestObs = new Map<string, string>();
  for (const o of observations.rows) {
    if (!latestObs.has(o.action_intent_id)) {
      latestObs.set(
        o.action_intent_id,
        o.origin === 'INTERNAL_COMMAND_RECEIPT' || o.origin === 'EXTERNAL_PROVIDER'
          ? 'CONFIRMED'
          : o.origin,
      );
    }
  }

  return intents.rows.map((intent, index): RecoveryActionFact => {
    const capability = intent.capability_ref;
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
    const obs = latestObs.get(intent.id);
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

  // Assessments for case subjects — best-effort.
  const subjects = await pool.query<{ subject_kind: string; subject_id: string }>(
    `SELECT subject_kind, subject_id FROM case_subjects WHERE workspace_id = $1 AND recovery_case_id = $2`,
    [workspaceId, caseId],
  );

  let tripVerdict: AssessmentTone = 'UNKNOWN';
  const uncertainty: string[] = [];
  if (subjects.rows.length === 0) uncertainty.push('no case subjects attached');

  const assessments = await pool.query<{ overall_verdict: string }>(
    `SELECT a.overall_verdict
       FROM assessments a
       JOIN assessment_subjects s ON s.workspace_id = a.workspace_id AND s.assessment_id = a.id
      WHERE a.workspace_id = $1
        AND s.subject_id = ANY($2::uuid[])
      ORDER BY a.evaluated_at DESC
      LIMIT 20`,
    [workspaceId, subjects.rows.map((s) => s.subject_id)],
  );
  if (assessments.rows.some((a) => a.overall_verdict === 'FAIL')) tripVerdict = 'FAIL';
  else if (assessments.rows.length > 0 && assessments.rows.every((a) => a.overall_verdict === 'PASS')) tripVerdict = 'PASS';

  const partialIncomplete = recoveryActions.some((a) =>
    a.executionState === 'FAILED' || a.executionState === 'OUTCOME_UNKNOWN' || a.executionState === 'PENDING' || a.executionState === 'EXECUTING' || a.executionState === 'RECONCILING' || a.executionState === 'PROPOSED',
  );
  const connectionProgression: ConnectionProgression = mapConnectionProgression({
    caseStatus: row.lifecycle_status,
    partialRecoveryIncomplete: partialIncomplete && row.lifecycle_status === 'EXECUTING',
    allMandatoryActionsComplete: recoveryActions.length > 0 && !partialIncomplete,
    wholeTripPass: tripVerdict === 'PASS' && !partialIncomplete,
  });

  const status = (['OPEN', 'PLANNING', 'AWAITING_AUTHORITY', 'EXECUTING', 'RESOLVED', 'CLOSED', 'CANCELLED', 'SUPERSEDED'] as const)
    .includes(row.lifecycle_status as RecoveryCaseFacts['status'])
    ? (row.lifecycle_status as RecoveryCaseFacts['status'])
    : 'OPEN';

  return {
    generatedAt,
    projectionRevision: recoveryActions.length + assessments.rows.length,
    changedVisibleRefs: recoveryActions.map((a) => a.actionRef),
    currentSemanticState: tripVerdict === 'FAIL' ? 'FAILED' : tripVerdict === 'PASS' ? 'RECOVERED' : 'AFFECTED',
    nodes: [
      { ref: `case:${caseId}`, kind: 'RECOVERY_PROPOSAL', label: 'Recovery case', semanticState: 'ACTIVE', authority: 'AUTHORITATIVE' },
      ...subjects.rows.map((s) => {
        const semanticState = tripVerdict === 'FAIL' ? 'FAILED' as const : 'AFFECTED' as const;
        return {
          ref: `${s.subject_kind}:${s.subject_id}`,
          kind: 'TRAVELLER' as const,
          label: s.subject_kind,
          semanticState,
          authority: 'AUTHORITATIVE' as const,
        };
      }),
    ],
    edges: subjects.rows.map((s) => ({
      fromRef: `${s.subject_kind}:${s.subject_id}`,
      toRef: `case:${caseId}`,
      kind: 'AFFECTED_BY' as const,
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
    strategies: [],
    authorityState: status === 'AWAITING_AUTHORITY' ? 'awaiting' : 'recorded',
    executionState: status === 'EXECUTING' ? 'executing' : status === 'RESOLVED' ? 'complete' : 'idle',
    reconciliationState: partialIncomplete ? 'reconciling' : 'idle',
    uncertainty,
    connectionProgression,
    recoveryActions,
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
    items.push({
      tripRef: affected[0] ?? `case:${c.id}`,
      travellerLabel: affected[0] ?? 'Traveller',
      status,
      remainderViability: remainder,
      caseRef: c.id,
      whatChanged: facts.changeSummary,
      affectedPeople: affected,
      affectedItems: affected,
      decisionRequired: facts.status === 'AWAITING_AUTHORITY',
      unresolvedUncertainty: facts.uncertainty ?? [],
    });
  }

  return {
    generatedAt,
    projectionRevision: items.length,
    changedVisibleRefs: items.map((i) => i.caseRef!).filter(Boolean) as string[],
    currentSemanticState: items.some((i) => i.status === 'DISRUPTED') ? 'FAILED' : 'HEALTHY',
    nodes: items.map((i) => ({
      ref: i.caseRef ?? i.tripRef,
      kind: 'DISRUPTION' as const,
      label: i.travellerLabel,
      semanticState: i.status === 'DISRUPTED' ? 'FAILED' as const : 'HEALTHY' as const,
      authority: 'AUTHORITATIVE' as const,
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
      fromRef: t.travellerRef,
      toRef: input.incidentRef,
      kind: 'AFFECTED_BY' as const,
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

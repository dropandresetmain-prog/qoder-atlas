/**
 * Stage the existing bilateral programme time-swap as a RecoveryStrategy.
 *
 * Staging re-runs the authoritative preview, evaluates the same typed
 * ScenarioChange against a captured world, and persists only a VIABLE
 * strategy. It never approves a strategy and never mutates programme state.
 */
import type { Pool } from '../../persistence/postgres/pool.ts';
import type { PgUnitOfWork } from '../../persistence/postgres/pgUnitOfWork.ts';
import type { TypedRef, ExpectedRevision } from '../../domain/v2/shared/identity.ts';
import type { RecoveryStrategy } from '../../contracts/v2/scenario/recoveryStrategy.ts';
import { ScenarioChangeSchema, type ScenarioChange } from '../../contracts/v2/scenario/scenarioChange.ts';
import { captureWorld } from '../../persistence/postgres/world/pgCurrentState.ts';
import { createM6Registry } from '../../resolution/evaluation/registry.ts';
import { evaluateRecoveryStrategy } from '../../resolution/scenarios/evaluate.ts';
import { persistRecoveryStrategy } from '../../persistence/postgres/commands/m7StrategyCommands.ts';
import { currentAssessmentView } from '../../persistence/postgres/world/pgAssessments.ts';
import { deterministicUuid, RUNTIME_ID_NAMESPACES } from './deterministicId.ts';
import { previewAuthoritativeBilateralProgrammeTimeSwap } from './programmeTimeSwapPreview.ts';
import { canonicalPayloadHash } from '../../persistence/postgres/canonicalHash.ts';

const TERMINAL_CASE_STATUSES = new Set(['RESOLVED', 'CLOSED', 'CANCELLED', 'SUPERSEDED']);

export interface ProgrammeTimeSwapStagingInput {
  workspaceId: string;
  actorPrincipalId: string;
  recoveryCaseId: string;
  itemARef: string;
  itemBRef: string;
  now: string;
  /** If supplied, both items must still belong to these programme revisions. */
  expectedProgrammeRevisions?: readonly ExpectedRevision[];
  idempotencyKey?: string;
}

export interface ProgrammeTimeSwapStagingContext {
  pool: Pool;
  uow: () => PgUnitOfWork;
}

export interface StagedProgrammeTimeSwap {
  recoveryCaseId: string;
  strategyId: string;
  scenarioChangeId: string;
  strategyVersion: number;
}

export type ProgrammeTimeSwapStagingOutcome =
  | { ok: true; value: StagedProgrammeTimeSwap }
  | { ok: false; error: string };

/** Stable identity binds the exact case, unordered item pair, and programme revisions. */
export function programmeTimeSwapStrategyIdentity(input: {
  workspaceId: string;
  recoveryCaseId: string;
  itemARef: string;
  itemBRef: string;
  programmeRevisions: readonly { programmeId: string; revision: number }[];
  basisKey?: string;
}): { strategyId: string; scenarioChangeId: string; key: string } {
  const pair = [input.itemARef, input.itemBRef].sort().join('|');
  const revisions = [...input.programmeRevisions]
    .sort((a, b) => a.programmeId.localeCompare(b.programmeId))
    .map((row) => `${row.programmeId}@${row.revision}`)
    .join('|');
  const key = `programme-time-swap|${input.workspaceId}|${input.recoveryCaseId}|${pair}|${revisions}|${input.basisKey ?? ''}`;
  const strategyId = deterministicUuid(RUNTIME_ID_NAMESPACES.planning, key);
  return {
    key,
    strategyId,
    scenarioChangeId: deterministicUuid(RUNTIME_ID_NAMESPACES.planning, `${key}|scenario-change`),
  };
}

type ItemRow = {
  id: string;
  programme_id: string;
  window_start: Date;
  window_end: Date;
  schedule_authority: string;
};

async function loadProgrammeScope(pool: Pool, input: ProgrammeTimeSwapStagingInput): Promise<{
  items: [ItemRow, ItemRow];
  programmeRevisions: { programmeId: string; revision: number }[];
  expectedAggregateRevisions: ExpectedRevision[];
  affectedJourneyRefs: TypedRef[];
} | { error: string }> {
  const itemRows = await pool.query<ItemRow>(
    `SELECT id, programme_id, window_start, window_end, schedule_authority
       FROM programme_items
      WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
    [input.workspaceId, [input.itemARef, input.itemBRef]],
  );
  const itemA = itemRows.rows.find((row) => row.id === input.itemARef);
  const itemB = itemRows.rows.find((row) => row.id === input.itemBRef);
  if (!itemA || !itemB) return { error: 'PROGRAMME_ITEM_NOT_FOUND' };
  if (itemA.window_start === null || itemA.window_end === null || itemB.window_start === null || itemB.window_end === null) {
    return { error: 'PROGRAMME_ITEM_WINDOW_MISSING' };
  }
  if (itemA.programme_id !== itemB.programme_id) return { error: 'PROGRAMME_SCOPE_MISMATCH' };
  if (itemA.schedule_authority !== 'INTERNAL' || itemB.schedule_authority !== 'INTERNAL') {
    return { error: 'PROGRAMME_SCHEDULE_AUTHORITY_NOT_INTERNAL' };
  }

  const programmeRows = await pool.query<{ id: string; revision: string | number }>(
    `SELECT p.id, h.revision
       FROM programmes p
       JOIN aggregate_heads h ON h.workspace_id = p.workspace_id AND h.aggregate_id = p.id
      WHERE p.workspace_id = $1 AND p.id = $2`,
    [input.workspaceId, itemA.programme_id],
  );
  const programme = programmeRows.rows[0];
  if (!programme) return { error: 'PROGRAMME_NOT_FOUND' };
  const revision = Number(programme.revision);
  const expected = input.expectedProgrammeRevisions ?? [];
  if (expected.length > 1) return { error: 'PROGRAMME_REVISION_SCOPE_MISMATCH' };
  const supplied = expected.find((row) => row.aggregateRef.kind === 'PROGRAMME' && row.aggregateRef.id === programme.id);
  if (expected.some((row) => row.aggregateRef.kind !== 'PROGRAMME' || row.aggregateRef.id !== programme.id)) {
    return { error: 'PROGRAMME_REVISION_SCOPE_MISMATCH' };
  }
  if (supplied && supplied.expectedRevision !== revision) return { error: 'PROGRAMME_REVISION_STALE' };

  const participantRows = await pool.query<{ traveller_id: string }>(
    `SELECT DISTINCT traveller_id
       FROM participations
      WHERE workspace_id = $1 AND programme_item_id = ANY($2::uuid[])
      ORDER BY traveller_id`,
    [input.workspaceId, [itemA.id, itemB.id]],
  );
  const travellerIds = participantRows.rows.map((row) => row.traveller_id);
  const journeys = travellerIds.length === 0
    ? []
    : (await pool.query<{ id: string }>(
      `SELECT id FROM journeys
        WHERE workspace_id = $1 AND traveller_id = ANY($2::uuid[])
        ORDER BY id`,
      [input.workspaceId, travellerIds],
    )).rows;
  if (journeys.length === 0) return { error: 'PROGRAMME_PARTICIPANTS_MISSING' };

  return {
    items: [itemA, itemB],
    programmeRevisions: [{ programmeId: programme.id, revision }],
    expectedAggregateRevisions: [{ aggregateRef: { kind: 'PROGRAMME', id: programme.id }, expectedRevision: revision }],
    affectedJourneyRefs: journeys.map((row) => ({ kind: 'JOURNEY', id: row.id })),
  };
}

async function assertActiveCaseScope(
  pool: Pool,
  workspaceId: string,
  recoveryCaseId: string,
  itemRefs: readonly string[],
): Promise<string | undefined> {
  const caseRow = (await pool.query<{ lifecycle_status: string }>(
    `SELECT lifecycle_status FROM recovery_cases WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, recoveryCaseId],
  )).rows[0];
  if (!caseRow) return 'RECOVERY_CASE_NOT_FOUND';
  if (TERMINAL_CASE_STATUSES.has(caseRow.lifecycle_status)) return 'RECOVERY_CASE_NOT_ACTIVE';

  const linked = await pool.query(
    `SELECT 1
       FROM case_subjects cs
      WHERE cs.workspace_id = $1 AND cs.recovery_case_id = $2
        AND (
          (cs.subject_kind = 'PROGRAMME_ITEM' AND cs.subject_id = ANY($3::uuid[]))
          OR (cs.subject_kind = 'JOURNEY' AND EXISTS (
            SELECT 1
              FROM participations p
              JOIN journeys j ON j.workspace_id = p.workspace_id AND j.traveller_id = p.traveller_id
             WHERE p.workspace_id = cs.workspace_id
               AND p.programme_item_id = ANY($3::uuid[])
               AND j.id = cs.subject_id
          ))
        )
      LIMIT 1`,
    [workspaceId, recoveryCaseId, itemRefs],
  );
  return linked.rows[0] ? undefined : 'RECOVERY_CASE_SCOPE_MISMATCH';
}

async function existingStage(
  pool: Pool,
  workspaceId: string,
  strategyId: string,
  recoveryCaseId: string,
): Promise<StagedProgrammeTimeSwap | undefined> {
  const row = (await pool.query<{
    id: string;
    recovery_case_id: string;
    strategy_version: number;
    viability: string;
    scenario_change: { id?: string };
  }>(
    `SELECT id, recovery_case_id, strategy_version, viability, scenario_change
       FROM recovery_strategies WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, strategyId],
  )).rows[0];
  if (!row || row.recovery_case_id !== recoveryCaseId || row.viability !== 'VIABLE') return undefined;
  return {
    recoveryCaseId,
    strategyId: row.id,
    scenarioChangeId: row.scenario_change.id ?? '',
    strategyVersion: row.strategy_version,
  };
}

interface CaseFailureBasis {
  basisAssessmentId: string;
  resolveSubjectRefs: TypedRef[];
}

/**
 * Staging is a recovery action for the case's active failure, not a request
 * to prove every participant already has complete evidence. RC-6 requires
 * the current failing case subjects to become PASS; the rest of the
 * reassessment closure is still protected from regressions by the evaluator.
 */
async function loadCaseFailureBasis(
  pool: Pool,
  workspaceId: string,
  recoveryCaseId: string,
  now: string,
): Promise<CaseFailureBasis | undefined> {
  const subjects = await pool.query<{ subject_kind: string; subject_id: string }>(
    `SELECT subject_kind, subject_id
       FROM case_subjects
      WHERE workspace_id = $1 AND recovery_case_id = $2
        AND subject_kind IN ('JOURNEY', 'TRIP')
      ORDER BY subject_kind, subject_id`,
    [workspaceId, recoveryCaseId],
  );
  const failing: { subject: TypedRef; assessmentId: string }[] = [];
  for (const row of subjects.rows) {
    const subject: TypedRef = { kind: row.subject_kind as TypedRef['kind'], id: row.subject_id };
    const view = await currentAssessmentView(pool, workspaceId, subject, 'VIABILITY', now);
    if (view.status === 'CURRENT' && view.assessment?.overallVerdict === 'FAIL') {
      failing.push({ subject, assessmentId: view.assessment.id });
    }
  }
  if (failing.length === 0) return undefined;
  return {
    basisAssessmentId: failing[0]!.assessmentId,
    resolveSubjectRefs: failing.map((entry) => entry.subject),
  };
}

export async function stageProgrammeTimeSwap(
  ctx: ProgrammeTimeSwapStagingContext,
  input: ProgrammeTimeSwapStagingInput,
): Promise<ProgrammeTimeSwapStagingOutcome> {
  if (input.itemARef === input.itemBRef) return { ok: false, error: 'PROGRAMME_TIME_SWAP_REQUIRES_TWO_ITEMS' };

  const scope = await loadProgrammeScope(ctx.pool, input);
  if ('error' in scope) return { ok: false, error: scope.error };
  const caseError = await assertActiveCaseScope(ctx.pool, input.workspaceId, input.recoveryCaseId, [input.itemARef, input.itemBRef]);
  if (caseError) return { ok: false, error: caseError };

  const preview = await previewAuthoritativeBilateralProgrammeTimeSwap(ctx.pool, {
    workspaceId: input.workspaceId,
    recoveryCaseId: input.recoveryCaseId,
    itemARef: input.itemARef,
    itemBRef: input.itemBRef,
    now: input.now,
  });
  if (!preview.ok) return { ok: false, error: `AUTHORITATIVE_PREVIEW_${preview.error}` };
  if (!preview.result.previewAccepted || preview.result.strategyViability !== 'VIABLE') {
    return { ok: false, error: 'PROGRAMME_TIME_SWAP_PREVIEW_NOT_VIABLE' };
  }

  const registry = createM6Registry();
  const focus: TypedRef[] = [
    { kind: 'PROGRAMME_ITEM', id: input.itemARef },
    { kind: 'PROGRAMME_ITEM', id: input.itemBRef },
  ];
  const baseWorld = await captureWorld(ctx.pool, {
    workspaceId: input.workspaceId,
    focus,
    at: input.now,
    informationTopics: registry.informationTopics,
  });
  const caseFailureBasis = await loadCaseFailureBasis(ctx.pool, input.workspaceId, input.recoveryCaseId, input.now);
  if (!caseFailureBasis) return { ok: false, error: 'RECOVERY_CASE_ASSESSMENT_UNAVAILABLE' };
  const { basisAssessmentId, resolveSubjectRefs } = caseFailureBasis;
  // A peer's travel state can change without a programme revision. A fresh
  // preview must not return the old, permanently stale strategy in that case.
  const identity = programmeTimeSwapStrategyIdentity({
    workspaceId: input.workspaceId, recoveryCaseId: input.recoveryCaseId,
    itemARef: input.itemARef, itemBRef: input.itemBRef,
    programmeRevisions: scope.programmeRevisions,
    basisKey: canonicalPayloadHash({
      basisAssessmentId, aggregateReads: baseWorld.manifest.aggregateReads,
      scopeReads: baseWorld.manifest.scopeReads, evidenceReads: baseWorld.manifest.evidenceReads,
      nextInvalidationAt: baseWorld.manifest.nextInvalidationAt,
    }),
  });
  const prior = await existingStage(ctx.pool, input.workspaceId, identity.strategyId, input.recoveryCaseId);
  if (prior) return { ok: true, value: prior };
  const scenarioChange: ScenarioChange = ScenarioChangeSchema.parse({
    id: identity.scenarioChangeId,
    recoveryStrategyId: identity.strategyId,
    strategyVersion: 1,
    affectedSubjectRefs: focus,
    effects: [
      {
        effectKind: 'CHANGE_PROGRAMME_ITEM_TIME',
        programmeItemId: input.itemARef,
        proposedWindow: { start: preview.result.itemA.proposedWindow.start, end: preview.result.itemA.proposedWindow.end },
      },
      {
        effectKind: 'CHANGE_PROGRAMME_ITEM_TIME',
        programmeItemId: input.itemBRef,
        proposedWindow: { start: preview.result.itemB.proposedWindow.start, end: preview.result.itemB.proposedWindow.end },
      },
    ],
    basisAssessmentId,
  });

  const versions = await ctx.pool.query<{ max: string | null }>(
    `SELECT MAX(strategy_version)::text AS max
       FROM recovery_strategies WHERE workspace_id = $1 AND recovery_case_id = $2`,
    [input.workspaceId, input.recoveryCaseId],
  );
  const strategyVersion = Number(versions.rows[0]?.max ?? 0) + 1;
  scenarioChange.strategyVersion = strategyVersion;

  const evaluated = evaluateRecoveryStrategy({
    recoveryCaseId: input.recoveryCaseId,
    strategyId: identity.strategyId,
    strategyVersion,
    baseWorld,
    baseManifest: baseWorld.manifest,
    basisAssessmentId,
    scenarioChange,
    now: input.now,
    registry,
    resolveSubjectRefs,
  });
  if (!evaluated.ok) return { ok: false, error: `STRATEGY_EVALUATION_${evaluated.conflict.kind}` };
  const strategy: RecoveryStrategy = evaluated.value.strategy;
  if (strategy.viability !== 'VIABLE') return { ok: false, error: 'PROGRAMME_TIME_SWAP_STRATEGY_NOT_VIABLE' };

  const persisted = await persistRecoveryStrategy(ctx.uow(), {
    workspaceId: input.workspaceId,
    actorPrincipalId: input.actorPrincipalId,
    idempotencyKey: `programme-time-swap:stage:${identity.key}${input.idempotencyKey ? `|${input.idempotencyKey}` : ''}`,
    strategy: { ...strategy, status: 'EVALUATED', candidateAssessmentResults: [] },
    expectedAggregateRevisions: scope.expectedAggregateRevisions,
  });
  if (!persisted.ok) {
    const replay = await existingStage(ctx.pool, input.workspaceId, identity.strategyId, input.recoveryCaseId);
    if (replay) return { ok: true, value: replay };
    return { ok: false, error: `STRATEGY_PERSIST_${persisted.conflict.kind}:${persisted.conflict.message}` };
  }
  return {
    ok: true,
    value: {
      recoveryCaseId: input.recoveryCaseId,
      strategyId: persisted.value.strategyId,
      scenarioChangeId: scenarioChange.id,
      strategyVersion: persisted.value.strategyVersion,
    },
  };
}

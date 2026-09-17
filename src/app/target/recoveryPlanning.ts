/**
 * Recovery planning composition (B1): proposal -> validation -> deterministic
 * viability -> persisted strategy.
 *
 * This is the runtime seam between "a case exists for a failing subject" and
 * "the operator can choose a recovery option". It composes existing,
 * accepted pieces and adds no semantics of its own:
 *
 *   failing subjects (CURRENT FAIL assessments of the case's subjects)
 *   -> planning world capture (their closure + the programmes they depend on)
 *   -> StrategyProposer port (deterministic proposers; an LLM proposer would
 *      enter here and nowhere else)
 *   -> schema validation of every candidate (validateProposalCandidates)
 *   -> evaluateRecoveryStrategy: M6 overlay viability with base currentness
 *   -> persistRecoveryStrategy for VIABLE candidates only (real command)
 *   -> case phase OPEN -> PLANNING -> AWAITING_AUTHORITY when something is
 *      viable.
 *
 * Non-viable candidates are reported, never persisted as options. No
 * ActionPlan is compiled here: the plan is the persisted, versioned execution
 * basis and is minted at approval time for the one strategy chosen
 * (`recoveryApproval.ts`), so an unchosen option can never block resolution.
 */
import type { Pool } from '../../persistence/postgres/pool.ts';
import type { PgUnitOfWork } from '../../persistence/postgres/pgUnitOfWork.ts';
import type { TypedRef } from '../../domain/v2/shared/identity.ts';
import type { ApplicationError } from '../../contracts/v2/product/readModels.ts';
import { ScenarioChangeSchema } from '../../contracts/v2/scenario/scenarioChange.ts';
import type { StrategyViability } from '../../contracts/v2/scenario/recoveryStrategy.ts';
import { captureWorld, PgCurrentStateReader } from '../../persistence/postgres/world/pgCurrentState.ts';
import { currentAssessmentView } from '../../persistence/postgres/world/pgAssessments.ts';
import { persistRecoveryStrategy } from '../../persistence/postgres/commands/m7StrategyCommands.ts';
import { transitionRecoveryCase } from '../../persistence/postgres/commands/caseLifecycleCommands.ts';
import { createM6Registry } from '../../resolution/evaluation/registry.ts';
import { projectEffectiveWorld } from '../../resolution/world/effectiveItinerary.ts';
import { evaluateRecoveryStrategy } from '../../resolution/scenarios/evaluate.ts';
import { unmetProgrammeItems, validateProposalCandidates, type FailingSubject, type StrategyProposer } from '../../resolution/planning/proposer.ts';
import { createProgrammeTimeSwapProposer } from '../../resolution/planning/proposers/programmeTimeSwapProposer.ts';
import { deterministicUuid, RUNTIME_ID_NAMESPACES } from './deterministicId.ts';
import { applicationError } from './applicationCommands.ts';

export interface PlanningContext {
  pool: Pool;
  workspaceId: string;
  actorPrincipalId: string;
  uow: () => PgUnitOfWork;
  now?: string;
  /** Defaults to the deterministic proposers shipped with the runtime. */
  proposers?: readonly StrategyProposer[];
}

export interface PlanningCandidateReport {
  key: string;
  proposerId: string;
  strategyId: string;
  viability: StrategyViability | 'REJECTED_BY_VALIDATION';
  persisted: boolean;
  strategyVersion?: number;
  rejectionReason?: string;
  /** Subjects whose overlay assessment was not PASS, with their blocking reason codes — the evaluator's own words. */
  failedSubjects?: { subjectRef: string; verdict: string; blocking: string[] }[];
}

export interface PlanningReport {
  caseId: string;
  at: string;
  caseStatus: string;
  failingSubjects: TypedRef[];
  basisAssessmentId?: string;
  candidates: PlanningCandidateReport[];
  persistedCount: number;
}

export type PlanningOutcome = { ok: true; report: PlanningReport } | { ok: false; error: ApplicationError };

export function defaultProposers(): StrategyProposer[] {
  return [createProgrammeTimeSwapProposer()];
}

const TERMINAL = new Set(['RESOLVED', 'CLOSED', 'CANCELLED', 'SUPERSEDED']);

async function caseStatus(pool: Pool, workspaceId: string, caseId: string): Promise<string | undefined> {
  const row = await pool.query<{ lifecycle_status: string }>('SELECT lifecycle_status FROM recovery_cases WHERE workspace_id = $1 AND id = $2', [workspaceId, caseId]);
  return row.rows[0]?.lifecycle_status;
}

/** Steps the case phase forward along permitted transitions until it reaches `target`; tolerates concurrent progress. */
export async function advanceCasePhase(ctx: Pick<PlanningContext, 'pool' | 'workspaceId' | 'actorPrincipalId' | 'uow'>, caseId: string, target: string, reason: string): Promise<string> {
  const order = ['OPEN', 'PLANNING', 'AWAITING_AUTHORITY', 'EXECUTING'];
  for (let guard = 0; guard < order.length; guard += 1) {
    const current = await caseStatus(ctx.pool, ctx.workspaceId, caseId);
    if (!current || TERMINAL.has(current)) return current ?? 'MISSING';
    const from = order.indexOf(current);
    const to = order.indexOf(target);
    if (from < 0 || to < 0 || from >= to) return current;
    const next = order[from + 1]!;
    const moved = await transitionRecoveryCase(ctx.uow(), {
      workspaceId: ctx.workspaceId,
      actorPrincipalId: ctx.actorPrincipalId,
      idempotencyKey: `case-phase:${caseId}:${current}->${next}:${reason}`,
      caseId,
      from: current,
      to: next,
      reason,
    });
    if (!moved.ok && moved.conflict.kind !== 'STALE_AGGREGATE_REVISION') {
      throw new Error(`case phase ${current} -> ${next}: ${moved.conflict.kind}: ${moved.conflict.message}`);
    }
  }
  return (await caseStatus(ctx.pool, ctx.workspaceId, caseId)) ?? 'MISSING';
}

export async function proposeRecoveryStrategies(ctx: PlanningContext, input: { caseId: string }): Promise<PlanningOutcome> {
  const now = ctx.now ?? new Date().toISOString();
  const status = await caseStatus(ctx.pool, ctx.workspaceId, input.caseId);
  if (!status) return { ok: false, error: applicationError('CASE_NOT_FOUND', `recovery case ${input.caseId} does not exist`) };
  if (TERMINAL.has(status)) return { ok: false, error: applicationError('CASE_NOT_OPEN', `recovery case ${input.caseId} is ${status}`) };

  // 1. Failing subjects: CURRENT overall-FAIL assessments of the case's assessable subjects.
  const subjects = await ctx.pool.query<{ subject_kind: string; subject_id: string }>(
    `SELECT subject_kind, subject_id FROM case_subjects WHERE workspace_id = $1 AND recovery_case_id = $2 AND subject_kind IN ('JOURNEY', 'TRIP') ORDER BY subject_kind, subject_id`,
    [ctx.workspaceId, input.caseId],
  );
  const failing: FailingSubject[] = [];
  for (const row of subjects.rows) {
    const subject: TypedRef = { kind: row.subject_kind as TypedRef['kind'], id: row.subject_id };
    const view = await currentAssessmentView(ctx.pool, ctx.workspaceId, subject, 'VIABILITY', now);
    if (view.status === 'CURRENT' && view.assessment && view.assessment.overallVerdict === 'FAIL') failing.push({ subject, assessment: view.assessment });
  }
  const report: PlanningReport = { caseId: input.caseId, at: now, caseStatus: status, failingSubjects: failing.map((f) => f.subject), candidates: [], persistedCount: 0 };
  if (failing.length === 0) return { ok: true, report };
  const basisAssessmentId = failing[0]!.assessment.id;
  report.basisAssessmentId = basisAssessmentId;

  // 2. Planning world: the failing subjects plus the programmes their unmet
  //    obligations belong to (so a proposer can see every counterpart item).
  const unmetItemIds = [...new Set(failing.flatMap((f) => unmetProgrammeItems(f.assessment).map((r) => r.id)))];
  const programmeRefs: TypedRef[] = unmetItemIds.length === 0 ? [] : (await ctx.pool.query<{ programme_id: string }>(
    'SELECT DISTINCT programme_id FROM programme_items WHERE workspace_id = $1 AND id = ANY($2::uuid[]) ORDER BY programme_id',
    [ctx.workspaceId, unmetItemIds],
  )).rows.map((r) => ({ kind: 'PROGRAMME' as const, id: r.programme_id }));
  const registry = createM6Registry();
  const world = await captureWorld(ctx.pool, {
    workspaceId: ctx.workspaceId,
    focus: [...failing.map((f) => f.subject), ...programmeRefs],
    at: now,
    informationTopics: registry.informationTopics,
  });
  const effective = projectEffectiveWorld(world);
  const currentState = await new PgCurrentStateReader(ctx.pool).loadFor(ctx.workspaceId, world.manifest);

  // 3. Propose (port) -> 4. validate -> 5. evaluate -> 6. persist VIABLE.
  const existingVersions = await ctx.pool.query<{ max: string | null }>(
    'SELECT MAX(strategy_version)::text AS max FROM recovery_strategies WHERE workspace_id = $1 AND recovery_case_id = $2',
    [ctx.workspaceId, input.caseId],
  );
  let nextVersion = Number(existingVersions.rows[0]?.max ?? 0) + 1;
  await advanceCasePhase(ctx, input.caseId, 'PLANNING', 'planning started');

  for (const proposer of ctx.proposers ?? defaultProposers()) {
    const raw = await proposer.propose({ workspaceId: ctx.workspaceId, recoveryCaseId: input.caseId, now, failing, world, effective });
    const { accepted, rejected } = validateProposalCandidates(raw);
    for (const r of rejected) {
      report.candidates.push({ key: `${proposer.id}#${r.index}`, proposerId: proposer.id, strategyId: '', viability: 'REJECTED_BY_VALIDATION', persisted: false, rejectionReason: r.reason });
    }
    for (const candidate of accepted) {
      const strategyId = deterministicUuid(RUNTIME_ID_NAMESPACES.planning, `${ctx.workspaceId}|strategy|${input.caseId}|${basisAssessmentId}|${candidate.key}`);
      const alreadyPersisted = await ctx.pool.query<{ strategy_version: number; viability: string }>(
        'SELECT strategy_version, viability FROM recovery_strategies WHERE workspace_id = $1 AND id = $2',
        [ctx.workspaceId, strategyId],
      );
      if (alreadyPersisted.rows[0]) {
        report.candidates.push({ key: candidate.key, proposerId: proposer.id, strategyId, viability: alreadyPersisted.rows[0].viability as StrategyViability, persisted: true, strategyVersion: alreadyPersisted.rows[0].strategy_version });
        continue;
      }
      const scenarioChange = ScenarioChangeSchema.parse({
        id: deterministicUuid(RUNTIME_ID_NAMESPACES.planning, `${strategyId}|scenario-change`),
        recoveryStrategyId: strategyId,
        strategyVersion: nextVersion,
        affectedSubjectRefs: candidate.affectedSubjectRefs,
        effects: candidate.effects,
        basisAssessmentId,
      });
      const evaluated = evaluateRecoveryStrategy({
        recoveryCaseId: input.caseId,
        strategyId,
        strategyVersion: nextVersion,
        baseWorld: world,
        baseManifest: world.manifest,
        basisAssessmentId,
        scenarioChange,
        now,
        registry,
        currentState,
        assumptions: candidate.assumptions,
      });
      if (!evaluated.ok) {
        report.candidates.push({ key: candidate.key, proposerId: proposer.id, strategyId, viability: 'REJECTED', persisted: false, rejectionReason: `${evaluated.conflict.kind}: ${evaluated.conflict.message}` });
        continue;
      }
      const strategy = evaluated.value.strategy;
      if (strategy.viability !== 'VIABLE') {
        const failedSubjects = strategy.candidateAssessments
          .filter((c) => c.overallVerdict !== 'PASS')
          .map((c) => {
            const full = strategy.candidateAssessmentResults.find((r) => r.id === c.assessmentId);
            const blocking = full
              ? full.dimensions.filter((d) => d.applicable && d.blocking && d.verdict !== 'PASS').flatMap((d) => d.explanations.filter((e) => e.status !== 'PASS').map((e) => `${d.dimension}:${e.reasonCode}`))
              : [];
            return { subjectRef: `${c.subjectRef.kind}:${c.subjectRef.id}`, verdict: c.overallVerdict, blocking: [...new Set(blocking)].sort() };
          });
        report.candidates.push({ key: candidate.key, proposerId: proposer.id, strategyId, viability: strategy.viability, persisted: false, ...(strategy.rejectionReason ? { rejectionReason: strategy.rejectionReason } : {}), failedSubjects });
        continue;
      }
      const persisted = await persistRecoveryStrategy(ctx.uow(), {
        workspaceId: ctx.workspaceId,
        actorPrincipalId: ctx.actorPrincipalId,
        idempotencyKey: `planning:persist:${strategyId}`,
        strategy: { ...strategy, status: 'EVALUATED', candidateAssessmentResults: [] },
      });
      if (!persisted.ok) {
        report.candidates.push({ key: candidate.key, proposerId: proposer.id, strategyId, viability: 'VIABLE', persisted: false, rejectionReason: `persist: ${persisted.conflict.kind}: ${persisted.conflict.message}` });
        continue;
      }
      report.candidates.push({ key: candidate.key, proposerId: proposer.id, strategyId, viability: 'VIABLE', persisted: true, strategyVersion: nextVersion });
      report.persistedCount += 1;
      nextVersion += 1;
    }
  }

  const anyViable = report.persistedCount > 0 || report.candidates.some((c) => c.persisted && c.viability === 'VIABLE');
  report.caseStatus = anyViable ? await advanceCasePhase(ctx, input.caseId, 'AWAITING_AUTHORITY', 'viable strategies persisted') : (await caseStatus(ctx.pool, ctx.workspaceId, input.caseId)) ?? status;
  return { ok: true, report };
}

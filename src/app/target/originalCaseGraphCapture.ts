/**
 * R2 — capture of the immutable ORIGINAL focused Case graph.
 *
 * TRIGGER (documented, product-truth): the FIRST TRUTHFUL FOCUSED CASE GRAPH.
 * The case-lifecycle progression pass calls this the first time a case has a
 * SETTLED FAILING basis assessment, before it dispatches anything (resolution,
 * planning, attention) — so planning/approval/execution can never precede or
 * mutate the Original. A case that is opened before enough projection truth
 * exists (no settled failing assessment, an empty causal path, subjects still
 * PENDING_REASSESSMENT) captures nothing yet: no partial or invented graph is
 * ever stored merely to claim "captured at creation". The exact `capturedAt` and
 * basis assessment are recorded.
 *
 * It stores the SEMANTIC graph the focused renderer consumes and nothing else:
 * no HTML/SVG/layout/camera/animation, and neutral change-awareness hints (those
 * are poll-relative, not semantic). Idempotent: the command is insert-once, so a
 * duplicate wake, a retry or a later "better" graph is a no-op. CURRENT never
 * reads what this writes.
 */
import type { Pool } from '../../persistence/postgres/pool.ts';
import type { PgUnitOfWork } from '../../persistence/postgres/pgUnitOfWork.ts';
import {
  ORIGINAL_GRAPH_SNAPSHOT_SCHEMA_VERSION,
  type OriginalGraphSnapshotPayload,
  type RecoveryCaseView,
} from '../../contracts/v2/product/readModels.ts';
import {
  captureOriginalCaseGraphSnapshot,
  hasOriginalCaseGraphSnapshot,
} from '../../persistence/postgres/commands/caseGraphSnapshotCommands.ts';
import { loadRecoveryCaseFacts } from './readmodels/pgFactAssembler.ts';
import { projectRecoveryCase } from './readmodels/projectRecoveryCase.ts';

const NON_TERMINAL = new Set<RecoveryCaseView['status']>(['OPEN', 'PLANNING', 'AWAITING_AUTHORITY', 'EXECUTING']);

export interface OriginalCaptureContext {
  pool: Pool;
  workspaceId: string;
  actorPrincipalId: string;
  uow: () => PgUnitOfWork;
}

export type OriginalCaptureResult =
  | { status: 'CAPTURED' | 'EXISTS' }
  | { status: 'NOT_YET_TRUTHFUL'; reason: string };

/**
 * Pure: the semantic Original payload for a case view, or the reason the view is
 * not yet a truthful focused graph. Deterministic; reads nothing else.
 */
export function deriveOriginalGraphPayload(
  view: RecoveryCaseView,
): { ok: true; payload: OriginalGraphSnapshotPayload } | { ok: false; reason: string } {
  if (!NON_TERMINAL.has(view.status)) return { ok: false, reason: 'case_not_active' };
  if (view.tripViability.verdict !== 'FAIL') return { ok: false, reason: 'trip_not_failing' };
  if (!view.focusedGraph || view.focusedGraph.causalNodeRefs.length === 0) return { ok: false, reason: 'no_mapped_causal_path' };
  if (view.ldg.nodes.some((n) => n.evaluation === 'PENDING_REASSESSMENT')) return { ok: false, reason: 'assessment_not_settled' };
  const { ldg } = view;
  return {
    ok: true,
    payload: {
      schemaVersion: ORIGINAL_GRAPH_SNAPSHOT_SCHEMA_VERSION,
      caseStatusAtCapture: view.status,
      ldg: {
        scope: 'FOCUSED_CASE',
        nodes: ldg.nodes.map((n) => ({ ...n })),
        edges: ldg.edges.map((e) => ({ ...e })),
        change: {
          projectionRevision: ldg.change.projectionRevision,
          changedVisibleRefs: [],
          changedEdgeIds: [],
          currentSemanticState: ldg.change.currentSemanticState,
        },
      },
      focusedGraph: {
        causalNodeRefs: [...view.focusedGraph.causalNodeRefs],
        causalEdgeIds: [...view.focusedGraph.causalEdgeIds],
        ...(view.focusedGraph.firstBreakpoint ? { firstBreakpoint: { ...view.focusedGraph.firstBreakpoint } } : {}),
        unmappedCausalSteps: view.focusedGraph.unmappedCausalSteps.map((s) => ({ ...s })),
      },
      subjectLabels: { ...view.subjectLabels },
    },
  };
}

export async function ensureOriginalCaseGraph(
  ctx: OriginalCaptureContext,
  args: { caseId: string; basisAssessmentId?: string; now: string },
): Promise<OriginalCaptureResult> {
  if (await hasOriginalCaseGraphSnapshot(ctx.pool, ctx.workspaceId, args.caseId)) return { status: 'EXISTS' };
  const facts = await loadRecoveryCaseFacts(ctx.pool, ctx.workspaceId, args.caseId, args.now);
  if (!facts) return { status: 'NOT_YET_TRUTHFUL', reason: 'case_not_found' };
  const derived = deriveOriginalGraphPayload(projectRecoveryCase(facts));
  if (!derived.ok) return { status: 'NOT_YET_TRUTHFUL', reason: derived.reason };
  const outcome = await captureOriginalCaseGraphSnapshot(ctx.uow(), {
    workspaceId: ctx.workspaceId,
    actorPrincipalId: ctx.actorPrincipalId,
    idempotencyKey: `original-graph:${args.caseId}`,
    caseId: args.caseId,
    ...(args.basisAssessmentId ? { basisAssessmentId: args.basisAssessmentId } : {}),
    capturedAt: args.now,
    payload: derived.payload,
  });
  if (!outcome.ok) throw new Error(`original graph capture: ${outcome.conflict.kind}: ${outcome.conflict.message}`);
  return { status: outcome.value.captured ? 'CAPTURED' : 'EXISTS' };
}

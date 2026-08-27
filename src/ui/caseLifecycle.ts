/**
 * Authoritative Case workspace phase and CTA selection.
 *
 * The displayed CTA is a projection of persisted case/read-model state.
 * Browser memory must not decide whether a case looks impacted, planned,
 * awaiting approval, executable, or resolved.
 */
import type { CaseDetailView } from './case-view-model.ts';

/** Judge-facing workspace phase. Matches `data-case-phase`. */
export type CaseWorkspacePhase =
  | 'resolved'
  | 'executing'
  | 'execute'
  | 'awaiting_authority'
  | 'options'
  | 'impacted';

function matchingAction(view: CaseDetailView) {
  const intentId = view.approval?.intentId;
  if (!intentId) return undefined;
  return view.actions.find((action) => action.id === intentId);
}

/** True when an approved intent exists and has not yet been observed as done. */
export function executionIsPending(view: CaseDetailView): boolean {
  if (view.resolution || view.status === 'RESOLVED') return false;
  if (view.approval?.state !== 'APPROVED' || !view.approval.intentId) return false;
  const action = matchingAction(view);
  if (action?.state === 'DONE' || action?.state === 'FAILED' || action?.state === 'IN_PROGRESS') return false;
  return true;
}

export function isCaseResolved(view: CaseDetailView): boolean {
  return Boolean(view.resolution) || view.status === 'RESOLVED';
}

export function selectCaseWorkspacePhase(view: CaseDetailView): CaseWorkspacePhase {
  if (isCaseResolved(view)) return 'resolved';
  const action = matchingAction(view);
  if (action?.state === 'IN_PROGRESS' || view.actions.some((item) => item.state === 'IN_PROGRESS')) {
    return 'executing';
  }
  if (executionIsPending(view)) return 'execute';
  if (view.approval?.state === 'PENDING') return 'awaiting_authority';
  if (view.options.length > 0) return 'options';
  return 'impacted';
}

export function shouldShowResolveCta(view: CaseDetailView): boolean {
  if (isCaseResolved(view)) return false;
  if (view.approval?.state === 'PENDING' || executionIsPending(view)) return false;
  if (view.programmeChangeAvailable && view.anchorEventId) return false;
  if (view.planningExhausted) return false;
  if (view.options.length > 0) return false;
  return view.status === 'DISRUPTED' || view.status === 'CHANGE_REQUESTED';
}

export function shouldShowBeginCta(view: CaseDetailView): boolean {
  if (isCaseResolved(view)) return false;
  if (view.approval?.state === 'PENDING' || executionIsPending(view)) return false;
  if (view.programmeChangeAvailable && view.anchorEventId) return false;
  if (view.planningExhausted) return false;
  const recommended =
    view.options.find((option) => option.recommended) ??
    view.options.find((option) => option.verdict === 'VIABLE');
  return Boolean(recommended);
}

export function shouldShowExecuteCta(view: CaseDetailView): boolean {
  return executionIsPending(view);
}

export function shouldShowProgrammeChangeCta(view: CaseDetailView): boolean {
  if (isCaseResolved(view)) return false;
  if (view.approval?.state === 'PENDING' || executionIsPending(view)) return false;
  return Boolean(view.programmeChangeAvailable && view.anchorEventId);
}

/** Hide option picker once a plan is no longer the next action. */
export function shouldShowOptionsPanel(view: CaseDetailView): boolean {
  if (isCaseResolved(view)) return false;
  const phase = selectCaseWorkspacePhase(view);
  return phase === 'options' || phase === 'awaiting_authority';
}

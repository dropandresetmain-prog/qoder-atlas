/**
 * DecisionQueue (v2 read model) -> DecisionsPageView (legacy view-model shape).
 *
 * Pure. A case is "waiting on a person" only when the backend flagged it
 * awaitingAuthority; every other open case is reported separately as work
 * Northstar is doing, never dressed up as a pending decision. Cost, decide-by
 * and decided history are not projected by the backend, so they are omitted
 * rather than invented.
 */
import type { DecisionQueue } from '../../../contracts/v2/product/readModels.ts';
import type {
  DecidedDecisionRowView,
  DecisionsPageView,
  PendingDecisionRowView,
} from '../../../ui/operator-surfaces-view-model.ts';
import { CASE_STAGE_LABEL, CASE_WAIT_TEXT, isOpaqueLabel, relativeAge, scrubText } from './surfaceLabels.ts';

/** A case Northstar is progressing on its own (not waiting on a person). */
export interface WorkingCaseRowView {
  caseId: string;
  travellerName: string;
  stage: string;
  detail: string;
  age?: string;
}

export interface DecisionsSurfaceView extends DecisionsPageView {
  working: WorkingCaseRowView[];
  recent: NonNullable<DecisionQueue['recentDecisions']>;
}

function travellerName(labels: readonly string[]): string {
  const names = labels.map(scrubText).filter((label) => label.length > 0 && !isOpaqueLabel(label));
  return names.length > 0 ? names.join(', ') : 'Traveller';
}

export function adaptDecisionQueueToDecisionsPage(view: DecisionQueue): DecisionsSurfaceView {
  const pending: PendingDecisionRowView[] = [];
  const working: WorkingCaseRowView[] = [];
  const decided: DecidedDecisionRowView[] = [];
  for (const decision of view.decisions) {
    const name = travellerName(decision.subjectLabels);
    const age = decision.openedAt ? relativeAge(decision.openedAt, view.generatedAt) : undefined;
    if (decision.awaitingAuthority) {
      pending.push({
        caseId: decision.caseRef,
        travellerName: name,
        decision: `Approve the recovery plan for ${name === 'Traveller' ? 'this trip' : `${name}’s trip`}.`,
        waitingOn: 'Organiser',
        ...(age ? { age } : {}),
      });
    } else {
      working.push({
        caseId: decision.caseRef,
        travellerName: name,
        stage: CASE_STAGE_LABEL[decision.status] ?? 'In progress',
        detail: CASE_WAIT_TEXT[decision.status] ?? 'Northstar is working on this trip.',
        ...(age ? { age } : {}),
      });
    }
  }
  return { generatedAt: view.generatedAt, pending, decided, working, recent: view.recentDecisions ?? [] };
}

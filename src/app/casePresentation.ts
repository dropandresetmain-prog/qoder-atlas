/**
 * Case detail presentation enrichment (R3A).
 */
import type { Money } from '../domain/common.ts';
import type { AnchorEvent, Place } from '../domain/entities.ts';
import type { Engagement } from '../domain/elements.ts';
import type { Trip } from '../domain/trip.ts';
import type { RecoveryCase } from '../operational/case.ts';
import type { AuthorityDecision } from '../operational/intent.ts';
import type { TripSignal } from '../operational/signal.ts';
import type {
  ApprovalRequirementView,
  CaseCommitmentView,
  CaseDetailView,
  CaseRailSectionView,
  RecoveryOptionView,
} from '../ui/case-view-model.ts';
import { formatMoney } from '../ui/html.ts';
import { authorityNeededLabel } from '../ui/copy.ts';
import { presentAllocationSummary } from './presentation.ts';
import {
  formatCaseOpenedAt,
  formatProgrammeInstant,
  optionFlagsFromEvidence,
  projectAffectedItemViews,
  projectStatusTimeline,
  signalSourceLabel,
} from './presentationProjection.ts';
import type { ReadModelDependencies } from './readmodels.ts';
import { selectRecoveryCommitment } from './chainProjection.ts';

function primaryEngagement(trip: Trip, recoveryCase?: RecoveryCase): Engagement | undefined {
  return selectRecoveryCommitment(trip, recoveryCase);
}

function policyCapLabel(amount: Money | undefined): string | undefined {
  if (!amount) return undefined;
  return formatMoney(amount);
}

async function approverName(
  deps: ReadModelDependencies,
  decision: AuthorityDecision,
): Promise<string | undefined> {
  const approval = decision.approval;
  if (!approval) return undefined;
  if (approval.decidedBy.entityType === 'TRAVELLER') {
    const entry = await deps.snapshot.entities.get('TRAVELLER', approval.decidedBy.id);
    return entry?.entityType === 'TRAVELLER' ? entry.entity.name : undefined;
  }
  if (approval.decidedBy.entityType === 'ORGANISATION') {
    const entry = await deps.snapshot.entities.get('ORGANISATION', approval.decidedBy.id);
    return entry?.entityType === 'ORGANISATION' ? entry.entity.name : undefined;
  }
  return 'Organiser';
}

function whoDecidesLabel(approval: ApprovalRequirementView | undefined): string | undefined {
  if (!approval) return undefined;
  return authorityNeededLabel(approval.requestedFrom);
}

export function enrichCaseDetailView(
  view: CaseDetailView,
  context: {
    recoveryCase: RecoveryCase;
    trip: Trip;
    triggeringSignals: TripSignal[];
    allTripSignals?: TripSignal[];
    places: Map<string, Place>;
    anchorEvent?: AnchorEvent;
    connectionImpossible?: boolean;
  },
): CaseDetailView {
  const { recoveryCase, trip, triggeringSignals, places } = context;
  const affected = projectAffectedItemViews(trip, recoveryCase, places);
  const statusTimeline = projectStatusTimeline(
    context.allTripSignals ?? triggeringSignals,
    recoveryCase,
    context.connectionImpossible ? { connectionImpossible: true } : undefined,
  );

  const engagement = primaryEngagement(trip, recoveryCase);
  const commitment: CaseCommitmentView | undefined = engagement
    ? {
        title: engagement.data.title,
        ...(formatProgrammeInstant(engagement.data.startsAt.value)
          ? { body: formatProgrammeInstant(engagement.data.startsAt.value) }
          : {}),
        ...(view.criticalObjectiveAtRisk ? { ifMissed: view.criticalObjectiveAtRisk } : {}),
      }
    : view.criticalObjectiveAtRisk
      ? { title: view.criticalObjectiveAtRisk }
      : undefined;

  const railSections: CaseRailSectionView[] = [];
  const caseFacts: Array<{ label: string; value: string }> = [
    { label: 'Opened', value: formatCaseOpenedAt(recoveryCase.openedAt) },
  ];
  const signalLabel = signalSourceLabel(triggeringSignals[0]);
  if (signalLabel) caseFacts.push({ label: 'Reported by', value: signalLabel });
  railSections.push({ title: 'Case facts', rows: caseFacts });

  const whoRows: Array<{ label: string; value: string }> = [];
  const nextStep = whoDecidesLabel(view.approval);
  if (nextStep) whoRows.push({ label: 'Next step', value: nextStep });
  // approval.amount is the charge under review (often FX home restatement),
  // not the policy ceiling. Prefer funding allocation copy when present.
  const fundingLine = view.funding?.summary?.trim();
  if (fundingLine) {
    whoRows.push({ label: 'Who pays', value: fundingLine });
  } else {
    const amount = policyCapLabel(view.approval?.amount);
    if (amount) whoRows.push({ label: 'Amount under review', value: amount });
  }
  if (whoRows.length > 0) railSections.push({ title: 'Who decides', rows: whoRows });

  const options: RecoveryOptionView[] = view.options.map((option) => {
    if (option.flags && option.flags.length > 0) return option;
    const flags = optionFlagsFromEvidence({
      feasible: option.verdict === 'VIABLE',
      criticalObjectiveAtRisk: view.criticalObjectiveAtRisk,
      rejectionReason: option.rejectionReason,
    });
    return flags.length > 0 ? { ...option, flags } : option;
  });

  const actions = view.actions.map((action) => {
    const intent = recoveryCase.actionIntents.find((candidate) => candidate.id === action.id);
    const result = recoveryCase.executionResults.find((candidate) => candidate.intentId === action.id);
    const detail =
      result?.executedAt
        ? formatProgrammeInstant(result.executedAt)?.split(' · ').pop()
        : intent?.expectedResult;
    return detail ? { ...action, detail } : action;
  });

  return {
    ...view,
    ...(affected.length > 0 ? { affected } : {}),
    ...(statusTimeline.length > 0 ? { statusTimeline } : {}),
    ...(commitment ? { commitment } : {}),
    ...(railSections.length > 0 ? { railSections } : {}),
    options,
    actions,
  };
}

export async function decidedByLabel(
  deps: ReadModelDependencies,
  decision: AuthorityDecision,
): Promise<string | undefined> {
  return approverName(deps, decision);
}

export async function waitingOnLabel(
  deps: ReadModelDependencies,
  trip: Trip,
  requestedFrom: 'TRAVELLER' | 'ORGANISATION' | 'HUMAN_AGENT',
): Promise<string | undefined> {
  if (requestedFrom === 'HUMAN_AGENT') return 'Organiser';
  if (requestedFrom === 'ORGANISATION') {
    if (trip.anchorEventId) {
      const eventEntry = await deps.snapshot.entities.get('ANCHOR_EVENT', trip.anchorEventId);
      if (eventEntry?.entityType === 'ANCHOR_EVENT' && eventEntry.entity.organiserOrganisationId) {
        const orgEntry = await deps.snapshot.entities.get('ORGANISATION', eventEntry.entity.organiserOrganisationId);
        if (orgEntry?.entityType === 'ORGANISATION') return orgEntry.entity.name;
      }
    }
    return 'Organisation';
  }
  const travellerId = trip.travellerIds[0];
  if (!travellerId) return 'Traveller';
  const entry = await deps.snapshot.entities.get('TRAVELLER', travellerId);
  return entry?.entityType === 'TRAVELLER' ? entry.entity.name : 'Traveller';
}

export function formatDecisionCost(amount: Money | undefined, fundingSummary: string | undefined): string | undefined {
  if (!amount && !fundingSummary) return undefined;
  if (amount && fundingSummary) return `${formatMoney(amount)} · ${fundingSummary}`;
  if (amount) return formatMoney(amount);
  return fundingSummary;
}

export function fundingSummaryForIntent(
  allocation: Parameters<typeof presentAllocationSummary>[0],
): string | undefined {
  return presentAllocationSummary(allocation);
}

/**
 * Lifecycle/state CTA exclusivity, chain engagement semantics, and
 * workspace phase projection. No hero-specific branches.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { renderCaseDetailBody } from '../src/ui/screens/operator-case.ts';
import { renderOperatorDashboardBody } from '../src/ui/screens/operator-dashboard.ts';
import {
  executionIsPending,
  selectCaseWorkspacePhase,
  shouldShowBeginCta,
  shouldShowExecuteCta,
  shouldShowResolveCta,
} from '../src/ui/caseLifecycle.ts';
import { projectCaseChain } from '../src/app/chain.ts';
import { reconcilePriorOpenCasesIfTripViable } from '../src/app/caseReconciliation.ts';
import { isLegalCaseTransition } from '../src/operational/case.ts';
import type { CaseReconciliationDeps } from '../src/app/caseReconciliation.ts';
import { executionGateIssues } from '../src/operational/intent.ts';
import type { CaseDetailView } from '../src/ui/case-view-model.ts';
import type { OperatorDashboardView } from '../src/contracts/readmodels.ts';
import type { Trip } from '../src/domain/trip.ts';
import type { Engagement, TransportLeg } from '../src/domain/elements.ts';
import type { RecoveryCase } from '../src/operational/case.ts';

const AT = '2026-09-21T09:00:00+08:00';

function baseView(over: Partial<CaseDetailView> = {}): CaseDetailView {
  return {
    caseId: 'case-1',
    tripId: 'trip-1',
    travellerNames: ['Traveller One'],
    status: 'DISRUPTED',
    whatChanged: 'A booked sector changed',
    affectedItems: ['Arrival'],
    checks: [],
    options: [],
    actions: [],
    uncertainties: [],
    updatedAt: AT,
    ...over,
  };
}

const viableOption = {
  id: 'opt-1',
  title: 'Next-morning replacement',
  verdict: 'VIABLE' as const,
  recommended: true,
};

test('lifecycle: restoration transitions to RESOLVED are legal without execution', () => {
  assert.equal(isLegalCaseTransition('ASSESSING', 'RESOLVED'), true);
  assert.equal(isLegalCaseTransition('PLANNING', 'RESOLVED'), true);
  assert.equal(isLegalCaseTransition('AWAITING_APPROVAL', 'RESOLVED'), true);
  assert.equal(isLegalCaseTransition('AWAITING_TRAVELLER', 'RESOLVED'), true);
  assert.equal(isLegalCaseTransition('READY_TO_EXECUTE', 'RESOLVED'), true);
  assert.equal(isLegalCaseTransition('EXECUTING', 'RESOLVED'), false);
  assert.equal(isLegalCaseTransition('RESOLVED', 'PLANNING'), false);
});

test('lifecycle: no prior open case is left for later commitment fan-out', async () => {
  const result = await reconcilePriorOpenCasesIfTripViable({} as CaseReconciliationDeps, {
    tripId: 'trip-1',
    at: AT,
    priorOpen: [],
  });
  assert.equal(result.reconciled, false);
});

test('lifecycle: declined authority cannot pass the execution gate', () => {
  const issues = executionGateIssues({
    intent: {
      id: 'int-1',
      caseId: 'case-1',
      operation: 'flight.change',
      capability: 'FLIGHT',
      parameters: {},
      sideEffectLevel: 'MONEY_MOVING',
      evidenceRefs: [],
      status: 'AUTHORISED',
      createdAt: AT,
    },
    authority: {
      id: 'auth-1',
      intentId: 'int-1',
      outcome: 'REQUIRES_ORGANISATION_APPROVER',
      decidedAt: AT,
      ruleTrace: [],
      conditions: [],
      approval: {
        decision: 'DECLINED',
        decidedBy: { entityType: 'ORGANISATION', id: 'org-1' },
        decidedAt: AT,
      },
    },
  });
  assert.ok(issues.some((issue) => /declined/i.test(issue)));
});

test('lifecycle: impacted case without options shows only Resolve', () => {
  const view = baseView();
  assert.equal(selectCaseWorkspacePhase(view), 'impacted');
  assert.equal(shouldShowResolveCta(view), true);
  assert.equal(shouldShowBeginCta(view), false);
  assert.equal(shouldShowExecuteCta(view), false);
  const html = renderCaseDetailBody(view);
  assert.match(html, /data-case-phase="impacted"/);
  assert.match(html, /data-test="resolve-northstar-btn"/);
  assert.doesNotMatch(html, /data-test="begin-strategy-btn"/);
  assert.doesNotMatch(html, /data-test="execute-approved-strategy-btn"/);
});

test('lifecycle: options already projected show Begin and never Resolve', () => {
  const view = baseView({ status: 'RECOVERING', options: [viableOption] });
  assert.equal(selectCaseWorkspacePhase(view), 'options');
  assert.equal(shouldShowResolveCta(view), false);
  assert.equal(shouldShowBeginCta(view), true);
  const html = renderCaseDetailBody(view);
  assert.match(html, /data-case-phase="options"/);
  assert.match(html, /data-test="begin-strategy-btn"/);
  assert.doesNotMatch(html, /data-test="resolve-northstar-btn"/);
  assert.doesNotMatch(html, /data-test="execute-approved-strategy-btn"/);
});

test('lifecycle: pending approval hides Begin, Resolve, and Execute', () => {
  const view = baseView({
    status: 'RECOVERING',
    options: [viableOption],
    approval: {
      requestedFrom: 'ORGANISATION',
      intentId: 'int-1',
      state: 'PENDING',
      reason: 'Organisation must approve the flight change.',
      approver: { entityType: 'ORGANISATION', id: 'org-1' },
    },
  });
  assert.equal(selectCaseWorkspacePhase(view), 'awaiting_authority');
  assert.equal(shouldShowResolveCta(view), false);
  assert.equal(shouldShowBeginCta(view), false);
  assert.equal(shouldShowExecuteCta(view), false);
  const html = renderCaseDetailBody(view);
  assert.match(html, /data-case-phase="awaiting_authority"/);
  assert.match(html, /Approve as organiser/);
  assert.match(html, /data-test="organisation-decline-form"/);
  assert.match(html, /data-does-not-execute/);
  assert.doesNotMatch(html, /data-test="resolve-northstar-btn"/);
  assert.doesNotMatch(html, /data-test="begin-strategy-btn"/);
  assert.doesNotMatch(html, /data-test="execute-approved-strategy-btn"/);
});

test('lifecycle: organiser approval with remaining options exposes Execute only', () => {
  const view = baseView({
    status: 'RECOVERING',
    options: [viableOption],
    approval: {
      requestedFrom: 'ORGANISATION',
      intentId: 'int-1',
      state: 'APPROVED',
      reason: 'Organisation approved the flight change.',
      approver: { entityType: 'ORGANISATION', id: 'org-1' },
    },
    actions: [{ id: 'int-1', label: 'Change flight', state: 'QUEUED' }],
  });
  assert.equal(executionIsPending(view), true);
  assert.equal(selectCaseWorkspacePhase(view), 'execute');
  assert.equal(shouldShowExecuteCta(view), true);
  assert.equal(shouldShowResolveCta(view), false);
  assert.equal(shouldShowBeginCta(view), false);
  const html = renderCaseDetailBody(view);
  assert.match(html, /data-case-phase="execute"/);
  assert.match(html, /data-test="execute-approved-strategy-btn"/);
  assert.match(html, /Execute approved recovery/);
  assert.doesNotMatch(html, /data-test="resolve-northstar-btn"/);
  assert.doesNotMatch(html, /data-test="begin-strategy-btn"/);
  assert.doesNotMatch(html, /data-test="organisation-approve-form"/);
});

test('lifecycle: declined approval does not expose Execute', () => {
  const view = baseView({
    status: 'RECOVERING',
    options: [viableOption],
    approval: {
      requestedFrom: 'ORGANISATION',
      intentId: 'int-1',
      state: 'DECLINED',
      reason: 'Organisation declined the flight change.',
    },
    actions: [{ id: 'int-1', label: 'Change flight', state: 'FAILED' }],
  });
  assert.equal(shouldShowExecuteCta(view), false);
  const html = renderCaseDetailBody(view);
  assert.doesNotMatch(html, /data-test="execute-approved-strategy-btn"/);
  assert.match(html, /data-test="begin-strategy-btn"/);
});

test('lifecycle: resolved case never shows recovery CTAs', () => {
  const view = baseView({
    status: 'RESOLVED',
    options: [viableOption],
    approval: {
      requestedFrom: 'ORGANISATION',
      intentId: 'int-1',
      state: 'APPROVED',
      reason: 'Already approved.',
    },
    resolution: { outcome: 'FULLY_RECOVERED', summary: 'Trip is back on track.' },
    actions: [{ id: 'int-1', label: 'Change flight', state: 'DONE' }],
  });
  assert.equal(selectCaseWorkspacePhase(view), 'resolved');
  const html = renderCaseDetailBody(view);
  assert.match(html, /data-case-phase="resolved"/);
  assert.match(html, /data-test="back-to-overview"/);
  assert.doesNotMatch(html, /data-test="resolve-northstar-btn"/);
  assert.doesNotMatch(html, /data-test="begin-strategy-btn"/);
  assert.doesNotMatch(html, /data-test="execute-approved-strategy-btn"/);
  assert.doesNotMatch(html, /Approve as organiser/);
});

test('lifecycle: programme engagements are Scheduled, not Not booked', () => {
  const engagement: Engagement = {
    id: 'eng-1',
    tripId: 'trip-1',
    elementKind: 'ENGAGEMENT',
    importance: 'REQUIRED',
    flexibility: 'FIXED',
    reservationState: 'NONE',
    status: 'VALID',
    dependsOn: [],
    governedByRuleSetIds: [],
    data: {
      title: 'Headline interview',
      startsAt: {
        value: '2026-10-01T09:20:00+08:00',
        sourceId: 'src-1',
        authority: 'AUTHORITATIVE',
        observedAt: AT,
      },
      endsAt: {
        value: '2026-10-01T09:50:00+08:00',
        sourceId: 'src-1',
        authority: 'AUTHORITATIVE',
        observedAt: AT,
      },
      placeId: 'place-venue',
    },
  };
  const flight: TransportLeg = {
    id: 'leg-1',
    tripId: 'trip-1',
    elementKind: 'TRANSPORT_LEG',
    importance: 'REQUIRED',
    flexibility: 'CHANGEABLE',
    reservationState: 'CONFIRMED',
    status: 'VALID',
    dependsOn: [],
    governedByRuleSetIds: [],
    data: {
      mode: 'FLIGHT',
      originPlaceId: 'place-nrt',
      destinationPlaceId: 'place-sin',
    },
  };
  const trip = {
    id: 'trip-1',
    travellerIds: ['trv-1'],
    elements: [flight, engagement],
    objectives: [],
    relations: [],
    viability: 'VIABLE',
    updatedAt: AT,
    version: 1,
  } as Trip;
  const recoveryCase = {
    id: 'case-1',
    tripId: 'trip-1',
    status: 'PLANNING',
    affectedElementIds: ['leg-1'],
  } as RecoveryCase;
  const chain = projectCaseChain(trip, recoveryCase, { places: new Map() });
  assert.ok(chain);
  const commitment = chain.find((link) => link.kind === 'Commitment');
  assert.ok(commitment);
  assert.equal(commitment.state, 'CONFIRMED');
  const flightLink = chain.find((link) => link.id === 'leg-1');
  assert.equal(flightLink?.state, 'AT_RISK');
  const html = renderCaseDetailBody(
    baseView({
      chain,
      status: 'DISRUPTED',
    }),
  );
  assert.match(html, />Scheduled</);
  assert.doesNotMatch(html, />Not booked</);
});

test('lifecycle: Overview resolved traveller is Confirmed and history-linkable', () => {
  const view: OperatorDashboardView = {
    generatedAt: AT,
    summary: { ready: 1, atRisk: 0, disrupted: 0, recovering: 0, awaitingDecision: 0, managedConfirmed: 1 },
    arrangementCounts: { total: 1, northstarArranged: 1, selfOrOtherArranged: 0, unspecified: 0 },
    trips: [
      {
        tripId: 'trip-1',
        historyCaseId: 'case-resolved',
        travellerNames: ['Traveller One'],
        status: 'RESOLVED',
        travelArrangement: 'NORTHSTAR_ARRANGED',
        affectedItems: [],
        systemActivity: [],
        pendingDecisions: [],
        uncertainties: [],
        resolutionSummary: 'Trip is back on track.',
        updatedAt: AT,
      },
    ],
  };
  const html = renderOperatorDashboardBody(view);
  assert.match(html, /data-presentation="CONFIRMED"/);
  assert.match(html, /data-test="case-history-link"/);
  assert.match(html, /href="\/operator\/cases\/case-resolved"/);
  assert.doesNotMatch(html, /data-test="attention-queue"/);
});

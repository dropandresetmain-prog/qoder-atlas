import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

import { AppConfigSchema } from '../src/config/config.ts';
import { composeAppRuntime } from '../src/app/compose.ts';
import type { AppEndpoints } from '../src/server/http.ts';
import { createAppServer } from '../src/server/http.ts';
import { renderCaseDetailBody } from '../src/ui/screens/operator-case.ts';
import {
  activityFromTripActivities,
  decisionsFromApprovalsQueue,
} from '../src/ui/operator-surfaces-view-model.ts';
import {
  caseAwaitingOrganisationApproval,
  operatorDashboard,
} from '../src/ui/fixtures/readmodels.ts';

const NOW = '2026-10-01T12:00:00+08:00' as const;

test('final UI wiring: organisation approvals use the generic runtime path and human-agent escalation remains manual', () => {
  const organisationHtml = renderCaseDetailBody(caseAwaitingOrganisationApproval);
  assert.match(organisationHtml, /action="\/api\/runtime\/decide"/);
  assert.match(organisationHtml, /name="intentId" value="intent-approval"/);
  assert.match(organisationHtml, /name="decidedBy\.entityType" value="ORGANISATION"/);
  assert.doesNotMatch(organisationHtml, /traveller-decision/);

  const humanHtml = renderCaseDetailBody({
    ...caseAwaitingOrganisationApproval,
    approval: {
      intentId: 'intent-human',
      requestedFrom: 'HUMAN_AGENT',
      reason: 'This structural request needs human-agent handling.',
      state: 'PENDING',
    },
  });
  assert.match(humanHtml, /human-agent handling/);
  assert.doesNotMatch(humanHtml, /\/api\/runtime\/decide/);
  assert.doesNotMatch(humanHtml, /\/api\/runtime\/execute/);
});

test('final UI wiring: decisions and activity retain real authority and audit evidence', () => {
  const decisions = decisionsFromApprovalsQueue({
    generatedAt: NOW,
    pending: [
      {
        caseId: 'case-traveller', tripId: 'trip-traveller', travellerNames: ['Jonas Berg'], decisionId: 'decision-1',
        requestedFrom: 'TRAVELLER', requestedAt: NOW, action: 'Extend hotel stay', reason: 'Traveller-funded increment',
      },
      {
        caseId: 'case-human', tripId: 'trip-human', travellerNames: ['Oliver Bennett'], decisionId: 'decision-2',
        requestedFrom: 'HUMAN_AGENT', requestedAt: NOW, action: 'Change flight origin', reason: 'Structural change',
      },
    ],
  });
  assert.equal(decisions.pending[0]!.waitingOn, 'Traveller');
  assert.equal(decisions.pending[1]!.waitingOn, 'Human agent');

  const activity = activityFromTripActivities(NOW, [{
    tripId: 'trip-traveller', generatedAt: NOW,
    events: [{ action: 'APPROVAL_RECORDED', summary: 'Approval recorded', occurredAt: NOW, actor: 'app:recovery-execution', subject: 'trip-traveller' }],
  }]);
  assert.equal(activity.days[0]!.items[0]!.text, 'Approval recorded');
  assert.equal(activity.days[0]!.items[0]!.who, 'app:recovery-execution');
});

test('final UI wiring: Decisions and Activity are served HTML routes and reachable from operator navigation', async () => {
  const config = AppConfigSchema.parse({
    environment: 'local', adapterMode: 'REPLAY', sqlitePath: ':memory:', fixturesDir: 'fixtures',
    providers: { atlas: { env: 'sandbox' }, modelStudio: {}, googleRoutes: {} },
  });
  const endpoints: AppEndpoints = {
    now: () => NOW,
    operatorDashboard: async () => operatorDashboard,
    caseDetail: async () => undefined,
    travellerTrip: async () => undefined,
    firstTripId: async () => undefined,
    travellerDecision: async () => ({ accepted: false }),
    wave: {
      approvalsQueue: async () => ({ generatedAt: NOW, pending: [] }),
      tripActivity: async (tripId) => ({ tripId, generatedAt: NOW, events: [{ action: 'SIGNAL_PROCESSED', summary: 'Trip change recorded', occurredAt: NOW, actor: 'app:signal', subject: tripId }] }),
      tripUncertainties: async () => undefined,
      providers: async () => ({ generatedAt: NOW, capabilities: [] }),
    },
  };
  const server = createAppServer(config, endpoints);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  try {
    const decisions = await (await fetch(`${base}/decisions`)).text();
    assert.match(decisions, /data-ui-screen="decisions"/);
    assert.match(decisions, /href="\/activity"/);
    const activity = await (await fetch(`${base}/activity`)).text();
    assert.match(activity, /data-ui-screen="activity"/);
    assert.match(activity, /href="\/decisions"/);
    assert.match(activity, /Trip change recorded/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('final UI wiring: the real programme route renders persisted commitment timeline data', async () => {
  const config = AppConfigSchema.parse({
    environment: 'local', adapterMode: 'REPLAY', sqlitePath: ':memory:', fixturesDir: 'fixtures',
    providers: { atlas: { env: 'sandbox' }, modelStudio: {}, googleRoutes: {} },
  });
  const composed = await composeAppRuntime(config);
  const server = createAppServer(config, composed.endpoints);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  try {
    const response = await fetch(`${base}/programme?event=evt-ait-2026`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /aria-label="Programme timeline"/);
    assert.match(html, /Headline Interview: Aviation After Automation/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    composed.db.close();
  }
});

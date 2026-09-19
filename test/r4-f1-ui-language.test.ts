/**
 * R4-F1 — user-visible system language + duplicate option cards.
 *
 * Every surface is rendered from hand-built v2 views whose backend text is
 * deliberately LEAKY (the exact machine strings the projection layer emits),
 * then the PRIMARY visible text (no data-*, no Technical details) is scanned
 * for internal vocabulary. Machine values are allowed to stay in the JSON API,
 * data-* attributes and inside `Technical details` only.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  ActivityFeed,
  DecisionQueue,
  OperatorOverview,
  ProgrammeSchedule,
  RecoveryCaseView,
  RecoveryStrategyView,
  TravellerTripView,
} from '../src/contracts/v2/product/readModels.ts';
import { renderProductOperatorOverview } from '../src/ui/screens/product-operator-overview.ts';
import { renderProductRecoveryCase } from '../src/ui/screens/product-recovery-case.ts';
import { renderProductProgrammeSchedule } from '../src/ui/screens/product-programme-schedule.ts';
import { renderProductDecisionQueue } from '../src/ui/screens/product-decision-queue.ts';
import { renderProductActivityFeed } from '../src/ui/screens/product-activity-feed.ts';
import { renderProductTravellerTrip } from '../src/ui/screens/product-traveller-trip.ts';
import { renderProductIncidentProgramme } from '../src/ui/screens/product-incident-programme.ts';
import { plainChangeText, scrubText } from '../src/app/target/adapters/surfaceLabels.ts';
import { dedupeStrategies, plain, presentCaseWorkspace, strategySemanticKey } from '../src/app/target/adapters/caseWorkspacePresenter.ts';
import { findInternalLanguage, primaryVisibleText } from './support/visibleText.ts';

const generatedAt = '2031-09-15T08:00:00.000Z';
const CHANGE_CODE = 'TRANSPORT_SERVICE_CANCELLED_WITH_REPROTECTION';
const LEAKY_CHANGE = `${CHANGE_CODE} (PROVIDER) received 2031-09-15T07:55:00.000Z`;
const LEAKY_RESOLUTION = 'All 1 case JOURNEY/TRIP subjects CURRENT+PASS after observation/reassessment';
const PLACEHOLDER = 'Recovery case assembled from authoritative PostgreSQL state';
const UUID = '3f2b8c1e-5a4d-4c6e-9b7a-1d2e3f4a5b6c';

const change = {
  projectionRevision: 3,
  changedVisibleRefs: [],
  changedEdgeIds: [],
  currentSemanticState: 'AFFECTED' as const,
};
const ldg = { scope: 'FOCUSED_CASE' as const, nodes: [], edges: [], change };

function overview(): OperatorOverview {
  const item = (n: number, whatChanged: string | undefined, extra: object = {}) => ({
    tripRef: `trip-${n}`, travellerLabel: `Traveller ${n}`, status: 'DISRUPTED' as const,
    remainderViability: 'NOT_VIABLE' as const, caseRef: `case-${n}`, whatChanged,
    affectedPeople: [], affectedItems: [`journey-${n}`], decisionRequired: false, unresolvedUncertainty: [], ...extra,
  });
  return {
    generatedAt,
    summary: { ready: 0, atRisk: 0, disrupted: 3, recovering: 0, unknown: 0 },
    items: [item(1, LEAKY_CHANGE), item(2, PLACEHOLDER), item(3, undefined, { recoveryActivity: 'RECOVERY_PLANNING_COMPLETED' })],
    population: [1, 2, 3].map((n) => ({
      journeyRef: `journey-${n}`, tripRef: `trip-${n}`, travellerLabel: `Traveller ${n}`, obligation: 'REQUIRED' as const,
      status: 'DISRUPTED' as const, remainderViability: 'NOT_VIABLE' as const, evaluation: 'SETTLED' as const, caseRef: `case-${n}`,
    })),
    populationSummary: { total: 3, ready: 0, atRisk: 0, disrupted: 3, recovering: 0, unknown: 0, notAssessed: 0 },
    populationAssessmentLifecycle: { state: 'SETTLED', pendingCount: 0 },
    ldg: { ...ldg, scope: 'DASHBOARD' },
    change,
  } as unknown as OperatorOverview;
}

function strategy(n: number, version: number, at: string, other: string): RecoveryStrategyView {
  return {
    strategyRef: `strategy-${version}`, version, viability: 'VIABLE', status: 'EVALUATED', optionNumber: n,
    changes: [
      { effectKind: 'CHANGE_PROGRAMME_ITEM_TIME', subjectRef: 'PROGRAMME_ITEM:a', subjectLabel: 'Keynote', currentWindow: { start: '2031-09-30T02:30:00.000Z', end: '2031-09-30T03:15:00.000Z' }, proposedWindow: { start: `2031-09-30T${at}:00.000Z`, end: '2031-09-30T06:00:00.000Z' } },
      { effectKind: 'CHANGE_PROGRAMME_ITEM_TIME', subjectRef: `PROGRAMME_ITEM:${other}`, subjectLabel: `Session ${other}` },
    ],
    resolves: [{ subjectRef: 'JOURNEY:j1', personLabel: 'Sarah Lim', currentVerdict: 'FAIL', projectedVerdict: 'PASS' }],
    projectedSummary: { total: 10, pass: 10, fail: 0, unknown: 0 },
    projectedPeople: [],
  } as unknown as RecoveryStrategyView;
}

function caseView(overrides: Partial<RecoveryCaseView> = {}): RecoveryCaseView {
  return {
    generatedAt, caseRef: 'case-1', causalPath: [], status: 'OPEN', changeSummary: LEAKY_CHANGE, subjectLabels: {},
    bookingServiceState: { label: 'Transport booking', state: 'AFFECTED' },
    tripViability: { label: 'Remaining trip', verdict: 'FAIL' },
    affectedItems: [], strategies: [], recoveryActions: [], authorityState: 'None', executionState: 'None',
    reconciliationState: 'Settled', uncertainty: [], attention: [], duplicateBookingExposure: [],
    remainingRecoveryWork: [], ldg, change, ...overrides,
  } as unknown as RecoveryCaseView;
}

describe('presentation boundary: plainChangeText / scrubText / plain', () => {
  test('a machine change line becomes the plain sentence for its change type', () => {
    assert.equal(plainChangeText(LEAKY_CHANGE), 'A booked service was cancelled and the traveller was moved onto a replacement.');
  });
  test('an unknown machine code and a projection placeholder never pass through', () => {
    for (const raw of ['SOMETHING_NEW_HAPPENED (PROVIDER) received 2031-01-01T00:00:00Z', PLACEHOLDER]) {
      const out = plainChangeText(raw)!;
      assert.deepEqual(findInternalLanguage(out), [], out);
    }
  });
  test('ordinary language is kept', () => {
    assert.equal(plainChangeText('Gate moved to B12.'), 'Gate moved to B12.');
  });
  test('scrubText drops raw enums instead of humanising them into shouty words', () => {
    assert.equal(scrubText('RECOVERY_PLANNING_COMPLETED'), '');
    assert.equal(scrubText('moved on 2031-09-15T07:55:00.000Z'), 'moved on');
    assert.equal(scrubText('all JOURNEY/TRIP ok'), 'all ok');
  });
  test('resolution copy with engine vocabulary is refused by plain()', () => {
    assert.equal(plain(LEAKY_RESOLUTION), undefined);
    assert.equal(plain('The trip works again.'), 'The trip works again.');
  });
});

describe('primary visible text carries no internal language on any surface', () => {
  const resolved = (status: 'RESOLVED' | 'CLOSED') =>
    caseView({ status, resolutionSummary: LEAKY_RESOLUTION } as Partial<RecoveryCaseView>);
  const pages: [string, () => string][] = [
    ['Overview', () => renderProductOperatorOverview(overview())],
    ['Case (open, leaky change)', () => renderProductRecoveryCase(caseView())],
    ['Case (resolved, leaky resolution)', () => renderProductRecoveryCase(resolved('RESOLVED'))],
    ['Case (closed, leaky resolution)', () => renderProductRecoveryCase(resolved('CLOSED'))],
    ['Programme', () => renderProductProgrammeSchedule({
      generatedAt, eventTitle: 'Summit',
      items: [{ itemRef: 'PROGRAMME_ITEM:x', label: 'Opening keynote', itemType: 'SESSION', lifecycleStatus: 'SCHEDULED', requiredParticipants: 2, optionalParticipants: 0, requiresPhysicalPresence: true, windowStart: '2031-09-30T02:30:00.000Z', windowEnd: '2031-09-30T03:15:00.000Z', windowLabel: '30 Sep 02:30' }],
    } as ProgrammeSchedule)],
    ['Programme incident', () => renderProductIncidentProgramme({
      generatedAt, incidentRef: 'inc-1', sourceChangeSummary: LEAKY_CHANGE, affectedSet: [], programmeCommitments: [], ldg, change,
    } as never)],
    ['Decisions', () => renderProductDecisionQueue({
      generatedAt,
      decisions: [{ caseRef: 'case-1', status: 'AWAITING_AUTHORITY', openedAtLabel: '15 Sep 07:55', subjectLabels: ['Sarah Lim', `JOURNEY:${UUID}`], awaitingAuthority: true }],
    } as DecisionQueue)],
    ['Activity', () => renderProductActivityFeed({
      generatedAt, truncated: false,
      entries: [
        { entryRef: 'e1', atLabel: '15 Sep 07:55', actorLabel: `principal:${UUID}`, subjectLabel: `JOURNEY:${UUID}`, what: 'RECOVERY_PLANNING_COMPLETED', reason: 'RECOVERY_PLANNING_COMPLETED', subjectKind: 'RECOVERY_STRATEGY' },
        { entryRef: 'e2', atLabel: '15 Sep 07:56', actorLabel: 'system', subjectLabel: 'Sarah Lim', what: 'CHANGE_SIGNAL_RECORDED', reason: LEAKY_CHANGE, subjectName: 'Sarah Lim', subjectKind: 'JOURNEY' },
      ],
    } as ActivityFeed)],
    ['Traveller', () => renderProductTravellerTrip({
      generatedAt, tripRef: 'trip-1', amIOkay: 'NO', doesTheRestWork: 'NOT_VIABLE',
      whatChanged: `Linked recovery case ${UUID} is AWAITING_AUTHORITY`,
      whatMattersNow: 'Your participation is not viable under current assessments',
      whatNorthstarIsDoing: 'Recovery case status: AWAITING_AUTHORITY',
      whatDoYouNeedFromMe: 'Nothing yet', change,
    } as TravellerTripView)],
  ];
  for (const [name, render] of pages) {
    test(name, () => {
      const text = primaryVisibleText(render());
      assert.ok(text.length > 20, `${name} rendered no text`);
      assert.deepEqual(findInternalLanguage(text), [], `${name} leaks internal language`);
    });
  }

  test('the resolved case shows plain copy, never the engine sentence', () => {
    const visible = primaryVisibleText(renderProductRecoveryCase(resolved('RESOLVED')));
    assert.ok(!visible.includes('CURRENT+PASS'));
    assert.match(visible, /The trip works again/);
  });

  test('the scan itself catches a leak (guards the guard)', () => {
    assert.notDeepEqual(findInternalLanguage(`Trip ${CHANGE_CODE} changed`), []);
    assert.notDeepEqual(findInternalLanguage(LEAKY_RESOLUTION), []);
    assert.notDeepEqual(findInternalLanguage(`case ${UUID}`), []);
    assert.deepEqual(findInternalLanguage(primaryVisibleText('<p data-x="FOO_BAR">Fine</p><details><summary>Technical details</summary>FOO_BAR</details>')), []);
  });
});

describe('Overview roster and queue show plain change sentences', () => {
  test('queue rows and roster issues are never the raw change code', () => {
    const text = primaryVisibleText(renderProductOperatorOverview(overview()));
    assert.ok(!text.includes(CHANGE_CODE));
    assert.ok(!/assembled from/i.test(text));
    assert.match(text, /A booked service was cancelled/);
  });
});

describe('duplicate option cards (F)', () => {
  const repeated = [1, 2, 3].flatMap((attempt) => [
    strategy(1, attempt * 10 + 1, '05:00', 'p'),
    strategy(2, attempt * 10 + 2, '05:10', 'q'),
    strategy(3, attempt * 10 + 3, '05:20', 'r'),
  ]);

  test('semantic identity is over effects, not label or ref', () => {
    assert.equal(strategySemanticKey(strategy(1, 1, '05:00', 'p')), strategySemanticKey(strategy(9, 99, '05:00', 'p')));
    assert.notEqual(strategySemanticKey(strategy(1, 1, '05:00', 'p')), strategySemanticKey(strategy(1, 1, '05:10', 'p')));
  });

  test('N re-planning attempts of the same options collapse to one card each', () => {
    const out = dedupeStrategies(repeated, undefined);
    assert.equal(out.length, 3);
    assert.deepEqual(out.map((s) => s.version), [31, 32, 33]); // newest attempt wins
  });

  test('the recommended strategy is always the representative of its group', () => {
    const out = dedupeStrategies(repeated, 'strategy-12');
    assert.ok(out.some((s) => s.strategyRef === 'strategy-12'));
    assert.equal(out.length, 3);
  });

  test('options with no evidenced change are never collapsed (distinct fares stay visible)', () => {
    const bare = (v: number): RecoveryStrategyView => ({ ...strategy(v, v, '05:00', 'p'), changes: [] });
    assert.equal(dedupeStrategies([bare(1), bare(2), bare(3)], undefined).length, 3);
  });

  test('materially different options are never hidden', () => {
    const different = [strategy(1, 1, '05:00', 'p'), strategy(2, 2, '05:10', 'p'), strategy(3, 3, '05:00', 'q')];
    assert.equal(dedupeStrategies(different, undefined).length, 3);
  });

  test('the Case page renders one card per distinct option', () => {
    const model = presentCaseWorkspace(caseView({ status: 'AWAITING_AUTHORITY', strategies: repeated } as Partial<RecoveryCaseView>));
    assert.equal(model.alternatives.length + (model.recommended ? 1 : 0), 3);
    const titles = [model.recommended, ...model.alternatives].map((o) => o!.title);
    assert.equal(new Set(titles).size, titles.length, `duplicate card titles: ${titles.join(' | ')}`);
    // Technical details still lists the raw strategies (nothing is destroyed).
    assert.equal(model.technical.strategies.length, repeated.length);
  });

  test('two genuinely different options that read the same are told apart by option number', () => {
    const a = strategy(1, 1, '05:00', 'p');
    const base = strategy(2, 2, '05:00', 'p');
    const b = {
      ...base,
      changes: [{ ...base.changes[0]!, proposedWindow: { start: '2031-09-30T05:00:00.000Z', end: '2031-09-30T07:00:00.000Z' } }, base.changes[1]!],
    } as RecoveryStrategyView;
    const model = presentCaseWorkspace(caseView({ status: 'AWAITING_AUTHORITY', strategies: [a, b] } as Partial<RecoveryCaseView>));
    const titles = [model.recommended, ...model.alternatives].map((o) => o!.title);
    assert.equal(titles.length, 2);
    assert.equal(new Set(titles).size, 2, titles.join(' | '));
  });
});

describe('R4-F2 execution blocker: a blocked option is never offered as approvable', () => {
  test('a viable option with an executionBlocker has no approval block and states the reason', () => {
    const blocked = { ...strategy(1, 1, '05:00', 'p'), executionBlocker: { code: 'EXTERNAL_EXECUTION_NOT_COMPOSED', message: 'Booking through the airline is not switched on for this session.' } } as RecoveryStrategyView;
    const model = presentCaseWorkspace(caseView({ status: 'AWAITING_AUTHORITY', strategies: [blocked], recommendedStrategyRef: blocked.strategyRef } as Partial<RecoveryCaseView>));
    const option = [model.recommended, ...model.alternatives].find((o) => o)!;
    assert.equal(option.approvable, false);
    assert.equal(model.approval, undefined);
    assert.match(option.approverLine, /not switched on/);
  });
  test('the same option without a blocker stays approvable', () => {
    const ok = strategy(1, 1, '05:00', 'p');
    const model = presentCaseWorkspace(caseView({ status: 'AWAITING_AUTHORITY', strategies: [ok], recommendedStrategyRef: ok.strategyRef } as Partial<RecoveryCaseView>));
    assert.equal([model.recommended, ...model.alternatives].find((o) => o)!.approvable, true);
  });
});

describe('R4 transport option cards: leg label and strategy-scoped cost', () => {
  const itemRef = 'JOURNEY_ITEM:00000000-0000-4000-8000-000000000001';
  const transportStrategy = (n: number): RecoveryStrategyView => ({
    strategyRef: `transport-${n}`,
    version: n,
    viability: 'VIABLE',
    status: 'EVALUATED',
    optionNumber: n,
    changes: [{ effectKind: 'SELECT_OFFER', subjectRef: itemRef, subjectLabel: itemRef }],
    resolves: [{ subjectRef: 'JOURNEY:j1', personLabel: 'Sarah Lim', currentVerdict: 'FAIL', projectedVerdict: 'PASS' }],
    projectedSummary: { total: 1, pass: 1, fail: 0, unknown: 0 },
    projectedPeople: [],
  } as RecoveryStrategyView);

  test('SELECT_OFFER uses disrupted transport on the case graph instead of generic rebook copy', () => {
    const ldgWithLeg = {
      ...ldg,
      nodes: [{
        ref: 'SERVICE_BOOKING:s1',
        kind: 'SERVICE_BOOKING' as const,
        label: 'FLIGHT Z2',
        semanticState: 'FAILED' as const,
        authority: 'AUTHORITATIVE' as const,
        detail: 'Manila → Cebu',
      }],
    };
    const model = presentCaseWorkspace(caseView({
      status: 'AWAITING_AUTHORITY',
      strategies: [transportStrategy(1)],
      ldg: ldgWithLeg,
    } as unknown as Partial<RecoveryCaseView>));
    const option = model.recommended!;
    assert.match(option.title, /Replace travel \(FLIGHT Z2 · Manila → Cebu\)/);
    assert.match(option.changes[0]!.phrase!, /Book replacement travel \(FLIGHT Z2 · Manila → Cebu\)/);
    assert.ok(!option.title.includes('replacement service'));
  });

  test('strategy cost comes from matching recovery actions, not case-wide aggregate, when several options exist', () => {
    const itemA = 'JOURNEY_ITEM:00000000-0000-4000-8000-000000000001';
    const itemB = 'JOURNEY_ITEM:00000000-0000-4000-8000-000000000002';
    const stratA = { ...transportStrategy(1), strategyRef: 'transport-a', changes: [{ effectKind: 'SELECT_OFFER', subjectRef: itemA, subjectLabel: itemA }] } as RecoveryStrategyView;
    const stratB = { ...transportStrategy(2), strategyRef: 'transport-b', changes: [{ effectKind: 'SELECT_OFFER', subjectRef: itemB, subjectLabel: itemB }] } as RecoveryStrategyView;
    const actionCost = { amount: '20.95', currency: 'USD' as const };
    const model = presentCaseWorkspace(caseView({
      status: 'AWAITING_AUTHORITY',
      strategies: [stratA, stratB],
      aggregateRecoveryCost: { amount: '999.00', currency: 'USD' },
      recoveryActions: [{
        actionRef: 'a1',
        domain: 'travel',
        capability: 'external:offer.select',
        subjectRefs: [itemA, 'OFFER:offer-a'],
        cost: actionCost,
        authorityState: 'awaiting',
        dependencyOrder: 0,
        dependsOnActionRefs: [],
        executionState: 'PENDING',
        uncertainty: [],
      }],
      ldg: {
        ...ldg,
        nodes: [{
          ref: 'SERVICE_BOOKING:s1',
          kind: 'SERVICE_BOOKING' as const,
          label: 'FLIGHT Z2',
          semanticState: 'FAILED' as const,
          authority: 'AUTHORITATIVE' as const,
        }],
      },
    } as unknown as Partial<RecoveryCaseView>));
    const priced = [model.recommended, ...model.alternatives].find((o) => o!.strategyRef === 'transport-a')!;
    const other = [model.recommended, ...model.alternatives].find((o) => o!.strategyRef === 'transport-b')!;
    assert.equal(priced.costLine, 'Added cost: US$20.95');
    assert.equal(other.costLine, undefined);
  });
});

test('Decisions preserves waiting now and renders recent approval history with case navigation', () => {
  const html = renderProductDecisionQueue({
    generatedAt,
    decisions: [{
      caseRef: 'case-pending',
      status: 'AWAITING_AUTHORITY',
      openedAtLabel: '15 Sep 07:55',
      subjectLabels: ['Traveller One'],
      awaitingAuthority: true,
    }],
    recentDecisions: [{
      caseRef: 'case-closed',
      label: 'Traveller One · Programme change',
      decisionAt: '2031-09-14T07:55:00.000Z',
      actorLabel: 'Organiser',
      kind: 'approval',
    }, {
      caseRef: 'case-revoked',
      label: 'Traveller Two · Programme change',
      decisionAt: '2031-09-13T07:55:00.000Z',
      actorLabel: 'Traveller',
      kind: 'revocation',
    }],
  } satisfies DecisionQueue);

  assert.match(html, /Waiting now/);
  assert.match(html, /Traveller One/);
  assert.match(html, /Decided recently/);
  assert.match(html, /data-test="recent-decision-row" data-case-ref="case-closed"/);
  assert.match(html, /Approved/);
  assert.match(html, /Revoked/);
  assert.match(html, /Organiser/);
  assert.match(html, /Traveller/);
  assert.match(html, /href="\/operator\/cases\/case-closed"/);
  assert.doesNotMatch(html, /principal:[0-9a-f-]{36}/i);
});

describe('R4 acceptance: a blocked option is never headlined over an executable one', () => {
  const blockedOf = (n: number): RecoveryStrategyView => ({ ...strategy(n, n, '05:00', 'p'), executionBlocker: { code: 'EXECUTION_INPUTS_UNAVAILABLE', message: 'PASSENGER_NAME_MISSING: traveller x has no structured given/family name' } } as RecoveryStrategyView);
  test('the executable option is recommended and the blocked one carries a plain, specific reason', () => {
    const blocked = blockedOf(1);
    const ok = { ...strategy(2, 2, '05:10', 'q') } as RecoveryStrategyView;
    const view = caseView({ status: 'AWAITING_AUTHORITY', strategies: [blocked, ok] } as Partial<RecoveryCaseView>);
    const model = presentCaseWorkspace(view);
    assert.equal(model.recommended?.strategyRef, ok.strategyRef);
    assert.equal(model.recommended?.approvable, true);
    const alt = model.alternatives.find((o) => o.strategyRef === blocked.strategyRef)!;
    assert.equal(alt.approvable, false);
    assert.match(alt.approverLine, /booking details/);
    assert.deepEqual(findInternalLanguage(alt.approverLine), []);
  });
  test('with only blocked options the first is still shown, with its reason', () => {
    const model = presentCaseWorkspace(caseView({ status: 'AWAITING_AUTHORITY', strategies: [blockedOf(1)] } as Partial<RecoveryCaseView>));
    assert.equal(model.recommended?.approvable, false);
    assert.match(model.recommended!.approverLine, /booking details/);
    assert.equal(model.approval, undefined);
  });
});

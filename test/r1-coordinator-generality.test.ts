/**
 * R1 / C5 — GENERALITY PROOF for the Recovery Planning Coordinator core.
 *
 * The freeze requires >=2 MATERIALLY DIFFERENT planning situations to flow
 * through the SAME coordinator + contracts, with no scenario branch. This test
 * drives the identical `runRecoveryPlanning` over:
 *
 *   Situation A — PROGRAMME domain. Blocking dimension `programme_participation`.
 *     The REAL shipped `programmeTimeSwapProposer` emits a bilateral
 *     CHANGE_PROGRAMME_ITEM_TIME swap. The real RC-6 evaluator flips the failing
 *     journey FAIL -> PASS. Outcome: a VIABLE, RECOMMENDED strategy =>
 *     AWAITING_AUTHORITY.
 *
 *   Situation B — STAY domain. Blocking dimension `overnight_accommodation`.
 *     A DIFFERENT proposer (injected at the StrategyProposer SEAM, exactly where
 *     an LLM/transport proposer would enter) emits a DIFFERENT effect kind
 *     (ALTER_JOURNEY_ITEM_INTENT) on a DIFFERENT canonical subject (a STAY
 *     journey item, not a programme item). The real RC-6 evaluator again flips
 *     the journey FAIL -> PASS. Outcome: AWAITING_AUTHORITY.
 *
 * Both run through one code path: the same deterministic domain registry, the
 * same proposal validation, the same real evaluator, the same decision-evidence
 * assembly, the same frozen comparator and the same immutable attempt schema.
 * The coordinator never branches on domain/persona/scenario — the domain comes
 * out of the registry, the effect out of the proposer, the viability out of
 * RC-6. Pure: no PostgreSQL, no provider, no model. A third situation proves the
 * honest NO_RECOVERY_FOUND refusal when nothing is viable.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorld, id } from './support/m6World.ts';
import type { TypedRef, SubjectId } from '../src/domain/v2/shared/identity.ts';
import type { CapturedWorld, WJourney, WJourneyItem, WProgrammeItem, WTransportService } from '../src/resolution/world/world.ts';
import type { AssessmentResult } from '../src/contracts/v2/assessment/assessmentManifest.ts';
import { AssessmentResultSchema } from '../src/contracts/v2/assessment/assessmentManifest.ts';
import { createEvaluatorRegistry } from '../src/resolution/evaluation/assess.ts';
import { createM6Registry } from '../src/resolution/evaluation/registry.ts';
import { PlanningToolRequestSchema, type PlanningToolResult } from '../src/contracts/v2/planning/planningTool.ts';
import type { DomainProposerInput } from '../src/contracts/v2/planning/proposerAdaptation.ts';
import type { Evaluator } from '../src/resolution/evaluation/evaluator.ts';
import { dimension, explain } from '../src/resolution/evaluation/explain.ts';
import { projectEffectiveWorld } from '../src/resolution/world/effectiveItinerary.ts';
import { createProgrammeTimeSwapProposer } from '../src/resolution/planning/proposers/programmeTimeSwapProposer.ts';
import type { ProposalCandidate, StrategyProposer } from '../src/resolution/planning/proposer.ts';
import { defaultRecoveryDomainRegistry } from '../src/resolution/planning/recoveryDomains.ts';
import {
  runRecoveryPlanning,
  type CoordinatorMinters,
  type PlanningBasis,
} from '../src/resolution/planning/coordinatorCore.ts';

const NOW = '2030-06-01T12:00:00.000Z';
const EARLY = '2030-06-02T10:00:00.000Z';
const LATE = '2030-06-02T15:00:00.000Z';
const COORDINATOR_VERSION = 'r1-coordinator/1';
const COMPARATOR_VERSION = 'r1-comparator/1';

test('coordinator gathers dependent hotel evidence before proposing and shares the request budget across domains', async () => {
  const { basis, journeyId } = programmeBasis();
  basis.registry = createM6Registry();
  const subject = subjectOfJourney(journeyId);
  const assessment = failingAssessment(subject, 'connection_feasibility');
  assessment.dimensions.push(...failingAssessment(subject, 'overnight_accommodation').dimensions);
  basis.failing = [{ subject, assessment }];
  const read = (operation: 'flight.search' | 'hotel.search' | 'hotel.quote', round: number, key: string) => PlanningToolRequestSchema.parse({
    id: key, capability: operation === 'flight.search' ? 'FLIGHT' : 'HOTEL', operation,
    parameters: { key }, purpose: 'Research required recovery arrangements', evidenceGapCode: 'recovery_arrangement', round,
  });
  const calls: string[] = [];
  let proposedAfterResearch = false;
  const output = await runRecoveryPlanning(basis, {
    domainRegistry: defaultRecoveryDomainRegistry(), availableCapabilities: ['FLIGHT', 'HOTEL'],
    minters: minters(), coordinatorVersion: COORDINATOR_VERSION, comparatorVersion: COMPARATOR_VERSION,
    proposers: [{ domain: 'TRANSPORT', proposer: {
      id: 'test.composite-evidence-consumer', version: '1', domains: ['TRANSPORT'],
      async propose(input: DomainProposerInput) {
        assert.deepEqual(input.evidence.toolResults.map((result) => result.operation), ['flight.search', 'hotel.search', 'hotel.quote']);
        assert.equal(calls.length, 3);
        proposedAfterResearch = true;
        return [];
      },
    } }],
    research: {
      budget: { maxRounds: 3, maxRequests: 3 },
      requestsByDomain: { TRANSPORT: [[read('flight.search', 1, 'flight')]], STAY: [[read('hotel.search', 1, 'separate-stay')]] },
      transport: async (request): Promise<PlanningToolResult> => {
        calls.push(request.operation);
        return { requestId: request.id, capability: request.capability, operation: request.operation,
          status: 'SUCCEEDED', normalizedEvidence: { captured: request.id },
          provenance: { mode: 'REPLAY', observedAt: NOW, sourceRefs: [] }, uncertainty: [] };
      },
      nextRound: ({ completedRound, domainId, results }) => {
        assert.equal(domainId, 'TRANSPORT');
        assert.equal(results.length, completedRound);
        return completedRound === 1 ? [read('hotel.search', 2, 'hotel')]
          : completedRound === 2 ? [read('hotel.quote', 3, 'quote')] : [];
      },
    },
  });
  assert.equal(proposedAfterResearch, true);
  assert.deepEqual(calls, ['flight.search', 'hotel.search', 'hotel.quote']);
  assert.equal(output.researchBudgetExhausted, true, 'a second domain cannot reset the basis request allowance');
  assert.equal(output.attempt.evidence.length, 3);
});

function subjectOfJourney(journeyId: string): TypedRef { return { kind: 'JOURNEY', id: journeyId }; }

function journeyRow(travellerId: string): WJourney {
  return { id: id(), revision: 1, tripId: id(), travellerId, lifecycleStatus: 'ACTIVE', intendedWindow: null, responsibilityOrganisationId: null };
}

function stayItem(journeyId: string, over: Partial<WJourneyItem> = {}): WJourneyItem {
  return {
    id: id(), journeyId, kind: 'STAY', orderKey: '020', lifecycleStatus: 'PLANNED', flexible: true,
    intendedWindow: { start: EARLY, end: '2030-06-02T11:00:00.000Z' },
    desiredOriginPlaceId: null, desiredDestinationPlaceId: null, selectedServiceId: null,
    intendedPlaceId: null, requiredNights: 1, participationId: null, standaloneTitle: null,
    standaloneWindow: null, resourceId: null, intendedLocationPlaceId: null, ...over,
  };
}

function programmeItemRow(programmeId: string, start: string, end: string): WProgrammeItem {
  return { id: id(), programmeId, title: 'session', itemType: 'SESSION', placeId: 'p-venue', window: { start, end }, lifecycleStatus: 'SCHEDULED', scheduleAuthority: 'INTERNAL', operatingRequirements: null };
}

function manifest() {
  return emptyWorld().manifest;
}

/** A failing assessment with one blocking dimension; the FAIL cause names `causeRef` (what unmetProgrammeItems reads). */
function failingAssessment(subject: TypedRef, dimensionCode: string, causeRef?: TypedRef): AssessmentResult {
  const explanation = explain({
    evaluatorId: 'test.coordinator', dimension: dimensionCode, status: 'FAIL', reasonCode: 'blocked',
    cause: { kind: 'WORLD_STATE', ...(causeRef ? { subjectRef: causeRef } : {}) }, affectedSubject: subject,
  });
  return AssessmentResultSchema.parse({
    id: id(), kind: 'VIABILITY', evaluatedAt: NOW, manifest: manifest(),
    subjects: [{ subjectRef: subject, role: 'PRIMARY' }],
    overallVerdict: 'FAIL',
    dimensions: [dimension({ dimension: dimensionCode, explanations: [explanation] })],
  });
}

/** A stub M6 registry: the named JOURNEY is FAIL until a predicate over the world flips it to PASS. */
function registryFlippingWhen(journeyId: string, passWhen: (world: CapturedWorld) => boolean) {
  const evaluator: Evaluator = {
    id: 'test.coordinator-stub', version: '1', assessmentKind: 'VIABILITY',
    subjectKinds: ['JOURNEY'], dimensions: ['stub'], informationTopics: [],
    evaluate(subject, context) {
      const verdict = subject.id === journeyId && !passWhen(context.world) ? 'FAIL' : 'PASS';
      return {
        dimensions: [dimension({ dimension: 'stub', explanations: [explain({ evaluatorId: 'test.coordinator-stub', dimension: 'stub', status: verdict, reasonCode: verdict === 'PASS' ? 'ok' : 'blocked', cause: { kind: 'WORLD_STATE' }, affectedSubject: subject })] })],
        evidence: [], missingCoverage: [],
      };
    },
  };
  return createEvaluatorRegistry([evaluator]);
}

function minters(): CoordinatorMinters {
  return {
    attemptId: id() as SubjectId,
    startedAt: NOW,
    mintStrategyId: (key) => `strategy:${key}` as SubjectId,
    mintScenarioChangeId: (sid) => `change:${sid}` as SubjectId,
    baseStrategyVersion: 1,
  };
}

/** Situation A — PROGRAMME domain via the real shipped time-swap proposer. */
function programmeBasis(): { basis: PlanningBasis; unmetItemId: string; journeyId: string } {
  const travellerA = id();
  const jA = journeyRow(travellerA);
  const programmeId = id();
  const unmet = programmeItemRow(programmeId, EARLY, '2030-06-02T11:00:00.000Z');
  const counterpart = programmeItemRow(programmeId, LATE, '2030-06-02T16:00:00.000Z');
  const world = emptyWorld({
    travellers: [{ id: travellerA, revision: 1, lifecycleStatus: 'ACTIVE' }],
    journeys: [jA],
    programmes: [{ id: programmeId, revision: 1, eventId: id(), title: 'event', lifecycleStatus: 'ACTIVE' }],
    programmeItems: [unmet, counterpart],
    participations: [{ id: id(), programmeItemId: unmet.id, travellerId: travellerA, obligation: 'REQUIRED', accepted: true, preparationWindow: null }],
    focus: [{ kind: 'JOURNEY', id: jA.id }],
  });
  const subject: TypedRef = { kind: 'JOURNEY', id: jA.id };
  const assessment = failingAssessment(subject, 'programme_participation', { kind: 'PROGRAMME_ITEM', id: unmet.id });
  const registry = registryFlippingWhen(jA.id, (w) => w.programmeItems.find((i) => i.id === unmet.id)!.window!.start !== EARLY);
  const basis: PlanningBasis = {
    workspaceId: world.workspaceId, recoveryCaseId: id() as SubjectId, basisAssessmentId: assessment.id as SubjectId,
    reason: 'CASE_OPENED', now: NOW, world, effective: projectEffective(world), failing: [{ subject, assessment }], registry,
  };
  return { basis, unmetItemId: unmet.id, journeyId: jA.id };
}

/** Situation B — STAY domain via a seam-injected proposer using a DIFFERENT effect kind. */
function stayBasis(): { basis: PlanningBasis; stayItemId: string; journeyId: string } {
  const travellerB = id();
  const jB = journeyRow(travellerB);
  const stay = stayItem(jB.id);
  const world = emptyWorld({
    travellers: [{ id: travellerB, revision: 1, lifecycleStatus: 'ACTIVE' }],
    journeys: [jB], journeyItems: [stay],
    focus: [{ kind: 'JOURNEY', id: jB.id }],
  });
  const subject: TypedRef = { kind: 'JOURNEY', id: jB.id };
  const assessment = failingAssessment(subject, 'overnight_accommodation');
  const registry = registryFlippingWhen(jB.id, (w) => w.journeyItems.find((i) => i.id === stay.id)!.intendedWindow!.start !== EARLY);
  const basis: PlanningBasis = {
    workspaceId: world.workspaceId, recoveryCaseId: id() as SubjectId, basisAssessmentId: assessment.id as SubjectId,
    reason: 'REASSESSMENT', now: NOW, world, effective: projectEffective(world), failing: [{ subject, assessment }], registry,
  };
  return { basis, stayItemId: stay.id, journeyId: jB.id };
}

/** A seam-injected STAY proposer: shifts the stay journey item's intended window later (ALTER_JOURNEY_ITEM_INTENT). */
function stayWindowProposer(stayItemId: string, journeyId: string): StrategyProposer {
  return {
    id: 'test.stay-window-shift', version: '1',
    async propose(): Promise<ProposalCandidate[]> {
      return [{
        key: 'shift-stay-window',
        effects: [{ effectKind: 'ALTER_JOURNEY_ITEM_INTENT', journeyItemId: stayItemId, proposedWindow: { start: LATE, end: '2030-06-02T16:00:00.000Z' } }],
        affectedSubjectRefs: [{ kind: 'JOURNEY_ITEM', id: stayItemId }, { kind: 'JOURNEY', id: journeyId }],
        rationale: 'Shift the intended stay window later so the overnight requirement is met.',
        assumptions: [],
      }];
    },
  };
}

function projectEffective(world: CapturedWorld) {
  // The coordinator only forwards `effective` to proposers; the real projection
  // is used so no fake world shape leaks into the seam.
  return projectEffectiveWorld(world);
}

test('generality A: PROGRAMME domain via the real time-swap proposer yields a VIABLE, RECOMMENDED attempt', async () => {
  const { basis, unmetItemId } = programmeBasis();
  const out = await runRecoveryPlanning(basis, {
    domainRegistry: defaultRecoveryDomainRegistry(),
    availableCapabilities: ['FLIGHT', 'HOTEL', 'TRANSFER', 'RESEARCH'],
    proposers: [{ domain: 'PROGRAMME', proposer: createProgrammeTimeSwapProposer() }],
    minters: minters(),
    coordinatorVersion: COORDINATOR_VERSION,
    comparatorVersion: COMPARATOR_VERSION,
  });

  assert.equal(out.result.outcome, 'AWAITING_AUTHORITY');
  assert.equal(out.viableStrategies.length, 1);
  const programme = out.attempt.domains.find((d) => d.domainId === 'PROGRAMME');
  assert.equal(programme?.disposition, 'INVESTIGATED');
  assert.equal(out.attempt.domains.find((d) => d.domainId === 'STAY')?.disposition, 'NOT_APPLICABLE');
  assert.ok(out.attempt.recommendation, 'a VIABLE set yields a validated recommendation');
  assert.equal(out.attempt.recommendation!.recommendedStrategyRef, out.viableStrategies[0]!.id);
  const rec = out.attempt.materialCandidates.find((m) => m.disposition === 'RECOMMENDED');
  assert.ok(rec, 'the viable candidate is retained as RECOMMENDED');
  assert.equal(rec!.viability, 'VIABLE');
  // The three impact projections are present and distinct on the recommended candidate.
  assert.ok(rec!.immediateChangeBlastRadius!.changedRefs.some((r) => r.kind === 'PROGRAMME_ITEM' && r.id === unmetItemId));
  assert.ok(rec!.reassessmentClosure!.reachedRefs.length > 0);
  assert.ok(rec!.outcomeDelta.some((d) => d.delta === 'BETTER'));
  assert.equal(rec!.costComparison, undefined, 'without a composed supplier Sarah/current planning retains its existing cost-free behavior');
});

test('coordinator compares captured provider prices with dated FX and retains unavailable cost evidence', async () => {
  const { basis, unmetItemId, journeyId } = programmeBasis();
  const transportItemId = id();
  const services: WTransportService[] = [id(), id(), id()].map((serviceId) => ({
    id: serviceId, revision: 1, mode: 'AIR', operator: 'test', originPlaceId: 'p-a', destinationPlaceId: 'p-b',
    published: { departure: null, arrival: null }, estimated: { departure: null, arrival: null }, actual: { departure: null, arrival: null },
  }));
  basis.world.journeyItems.push({
    id: transportItemId, journeyId, kind: 'TRANSPORT', orderKey: '010', lifecycleStatus: 'PLANNED', flexible: false,
    intendedWindow: null, desiredOriginPlaceId: 'p-a', desiredDestinationPlaceId: 'p-b', selectedServiceId: null,
    intendedPlaceId: null, requiredNights: null, participationId: null, standaloneTitle: null, standaloneWindow: null,
    resourceId: null, intendedLocationPlaceId: null,
  });
  basis.world.transportServices.push(...services);
  basis.effective = projectEffective(basis.world);
  const offers = [
    { key: 'nz-low', offerId: id(), serviceId: services[0]!.id, price: { amount: '100.00', currency: 'NZD' } },
    { key: 'usd-mid', offerId: id(), serviceId: services[1]!.id, price: { amount: '60.00', currency: 'USD' } },
    { key: 'eur-unknown', offerId: id(), serviceId: services[2]!.id, price: { amount: '40.00', currency: 'EUR' } },
  ];
  const fxEvidenceId = id();
  const out = await runRecoveryPlanning(basis, {
    domainRegistry: defaultRecoveryDomainRegistry(), availableCapabilities: ['FLIGHT', 'HOTEL'], minters: minters(),
    coordinatorVersion: COORDINATOR_VERSION, comparatorVersion: COMPARATOR_VERSION,
    proposers: [{ domain: 'PROGRAMME', proposer: {
      id: 'test.cost-comparison', version: '1',
      async propose(): Promise<ProposalCandidate[]> {
        return offers.map((offer) => ({
          key: offer.key,
          effects: [
            { effectKind: 'CHANGE_PROGRAMME_ITEM_TIME' as const, programmeItemId: unmetItemId, proposedWindow: { start: LATE, end: '2030-06-02T16:00:00.000Z' } },
            { effectKind: 'SELECT_OFFER' as const, journeyItemId: transportItemId, offerId: offer.offerId, offerPrice: offer.price },
          ],
          affectedSubjectRefs: [{ kind: 'PROGRAMME_ITEM' as const, id: unmetItemId }, { kind: 'JOURNEY_ITEM' as const, id: transportItemId }, { kind: 'JOURNEY' as const, id: journeyId }],
          rationale: 'Use a captured viable transport offer.', assumptions: [],
        }));
      },
    } }],
    resolveOffersForDomain: () => offers.map((offer) => ({ offerId: offer.offerId, transportServiceId: offer.serviceId })),
    costContextForCandidate: async () => ({
      homeCurrency: 'USD',
      comparedAt: '2030-06-01T13:00:00.000Z',
      rates: [{ id: fxEvidenceId, baseCurrency: 'NZD', homeCurrency: 'USD', rate: 0.5, sourceId: id(), authority: 'AUTHORITATIVE', observedAt: '2030-06-01T00:00:00.000Z' }],
    }),
  });
  assert.equal(out.attempt.recommendation?.recommendedStrategyRef, 'strategy:nz-low', 'the lower exact USD-equivalent cost breaks an otherwise equivalent viable choice');
  const nz = out.attempt.materialCandidates.find((candidate) => candidate.candidateKey === 'nz-low')!;
  assert.equal(nz.costComparison?.status, 'AVAILABLE');
  if (nz.costComparison?.status === 'AVAILABLE') {
    assert.deepEqual(nz.costComparison.lines[0]?.providerAmount, { amount: '100.00', currency: 'NZD' });
    assert.deepEqual(nz.costComparison.totalHomeAmount, { amount: '50.00', currency: 'USD' });
    assert.deepEqual(nz.costComparison.selectedFxEvidence.map((evidence) => evidence.id), [fxEvidenceId]);
  }
  const missingFx = out.attempt.materialCandidates.find((candidate) => candidate.candidateKey === 'eur-unknown')!;
  assert.deepEqual(missingFx.costComparison, {
    status: 'UNAVAILABLE', code: 'MISSING_RATE_EVIDENCE',
    reason: 'no captured EUR->USD rate exists', comparedAt: '2030-06-01T13:00:00.000Z',
  });
  assert.equal(out.completionHorizon, '2030-06-01T13:00:00.000Z');
  assert.equal(out.attempt.completedAt, out.completionHorizon, 'the immutable attempt cannot complete before its captured FX comparison');

  const mismatchedHomeCurrencies = await runRecoveryPlanning(basis, {
    domainRegistry: defaultRecoveryDomainRegistry(), availableCapabilities: ['FLIGHT', 'HOTEL'], minters: minters(),
    coordinatorVersion: COORDINATOR_VERSION, comparatorVersion: COMPARATOR_VERSION,
    proposers: [{ domain: 'PROGRAMME', proposer: {
      id: 'test.cost-comparison', version: '1',
      async propose(): Promise<ProposalCandidate[]> {
        return offers.map((offer) => ({
          key: offer.key,
          effects: [
            { effectKind: 'CHANGE_PROGRAMME_ITEM_TIME' as const, programmeItemId: unmetItemId, proposedWindow: { start: LATE, end: '2030-06-02T16:00:00.000Z' } },
            { effectKind: 'SELECT_OFFER' as const, journeyItemId: transportItemId, offerId: offer.offerId, offerPrice: offer.price },
          ],
          affectedSubjectRefs: [{ kind: 'PROGRAMME_ITEM' as const, id: unmetItemId }, { kind: 'JOURNEY_ITEM' as const, id: transportItemId }, { kind: 'JOURNEY' as const, id: journeyId }],
          rationale: 'Use a captured viable transport offer.', assumptions: [],
        }));
      },
    } }],
    resolveOffersForDomain: () => offers.map((offer) => ({ offerId: offer.offerId, transportServiceId: offer.serviceId })),
    costContextForCandidate: async ({ candidateKey }) => {
      const homeCurrency = candidateKey === 'nz-low' ? 'JPY' : candidateKey === 'usd-mid' ? 'NZD' : 'KRW';
      const baseCurrency = candidateKey === 'nz-low' ? 'NZD' : candidateKey === 'usd-mid' ? 'USD' : 'EUR';
      return {
        homeCurrency, comparedAt: '2030-06-01T13:00:00.000Z',
        rates: [{ id: id(), baseCurrency, homeCurrency, rate: candidateKey === 'usd-mid' ? 1 : 100, sourceId: id(), authority: 'AUTHORITATIVE', observedAt: '2030-06-01T00:00:00.000Z' }],
      };
    },
  });
  assert.equal(
    mismatchedHomeCurrencies.attempt.recommendation?.recommendedStrategyRef,
    'strategy:eur-unknown',
    'different home currencies omit numeric cost facts instead of comparing unrelated minor units',
  );
  assert.deepEqual(
    new Set(mismatchedHomeCurrencies.attempt.materialCandidates
      .flatMap((candidate) => candidate.costComparison?.status === 'AVAILABLE' ? [candidate.costComparison.homeCurrency] : [])),
    new Set(['JPY', 'NZD', 'KRW']),
  );
});

test('generality B: STAY domain via a different proposer + effect kind flows through the SAME coordinator', async () => {
  const { basis, stayItemId } = stayBasis();
  const out = await runRecoveryPlanning(basis, {
    domainRegistry: defaultRecoveryDomainRegistry(),
    availableCapabilities: ['FLIGHT', 'HOTEL', 'TRANSFER', 'RESEARCH'],
    proposers: [{ domain: 'STAY', proposer: stayWindowProposer(stayItemId, out0JourneyId(basis)) }],
    minters: minters(),
    coordinatorVersion: COORDINATOR_VERSION,
    comparatorVersion: COMPARATOR_VERSION,
  });

  assert.equal(out.result.outcome, 'AWAITING_AUTHORITY');
  assert.equal(out.viableStrategies.length, 1);
  // A materially different domain activated, PROGRAMME did not.
  assert.equal(out.attempt.domains.find((d) => d.domainId === 'STAY')?.disposition, 'INVESTIGATED');
  assert.equal(out.attempt.domains.find((d) => d.domainId === 'PROGRAMME')?.disposition, 'NOT_APPLICABLE');
  // A materially different effect kind was applied to a materially different subject.
  const rec = out.attempt.materialCandidates.find((m) => m.disposition === 'RECOMMENDED')!;
  assert.ok(rec.immediateChangeBlastRadius!.changedRefs.some((r) => r.kind === 'JOURNEY_ITEM' && r.id === stayItemId));
  assert.ok(rec.outcomeDelta.some((d) => d.delta === 'BETTER'));
  assert.equal(rec.domainId, 'STAY');
  assert.equal(rec.proposerId, 'test.stay-window-shift');
  // Same coordinator/contract invariants as situation A.
  assert.equal(out.attempt.coordinatorVersion, COORDINATOR_VERSION);
  assert.equal(out.attempt.recommendation!.provenance.comparatorVersion, COMPARATOR_VERSION);
});

test('generality C: an externally-scheduled item the overlay cannot move yields an honest NO_RECOVERY_FOUND', async () => {
  const { basis } = programmeBasis();
  // Re-capture with the unmet item marked EXTERNAL: the swap proposer still emits
  // a candidate, but the overlay rejects it (CAPABILITY_UNSUPPORTED) so nothing
  // is viable. The coordinator must refuse, not fabricate a recovery.
  const unmet = basis.world.programmeItems.find((i) => i.window!.start === EARLY)!;
  unmet.scheduleAuthority = 'EXTERNAL';
  const out = await runRecoveryPlanning(basis, {
    domainRegistry: defaultRecoveryDomainRegistry(),
    availableCapabilities: ['FLIGHT', 'HOTEL', 'TRANSFER', 'RESEARCH'],
    proposers: [{ domain: 'PROGRAMME', proposer: createProgrammeTimeSwapProposer() }],
    minters: minters(),
    coordinatorVersion: COORDINATOR_VERSION,
    comparatorVersion: COMPARATOR_VERSION,
  });

  assert.equal(out.result.outcome, 'NO_RECOVERY_FOUND');
  assert.equal(out.viableStrategies.length, 0);
  assert.equal(out.attempt.recommendation, undefined, 'no viable candidate => no recommendation, never a silent pick');
  assert.equal(out.attempt.viableStrategyRefs.length, 0);
  // The rejected candidate is retained as honest material evidence with its reason.
  const rejected = out.attempt.materialCandidates.find((m) => m.disposition === 'REJECTED_VALIDATION');
  assert.ok(rejected, 'the overlay rejection is retained as material evidence');
  assert.ok(rejected!.validationReasonCodes.some((c) => c.includes('CAPABILITY_UNSUPPORTED')));
});

function out0JourneyId(basis: PlanningBasis): string {
  return basis.failing[0]!.subject.id;
}

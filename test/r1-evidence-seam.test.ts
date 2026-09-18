/**
 * R1 / C2+C4 — the coordinator evidence-threading SEAM.
 *
 * The frozen contracts already define `DomainStrategyProposer` /
 * `DomainProposerInput` / `PlanningEvidenceContext` / `bindDomainProposer`
 * (src/contracts/v2/planning/proposerAdaptation.ts). This test pins that the
 * coordinator CORE actually USES them: a domain-aware proposer bound to an
 * investigated domain receives the raw provider-normalized read-only tool results
 * (e.g. flight/hotel offers), the attempt evidence refs to cite, its domain and
 * the comparator preferences — while a base StrategyProposer is driven unchanged,
 * and while the RAW payload is NEVER persisted into the attempt (only the bounded
 * projected PlanningEvidenceRecord is). Pure: no PostgreSQL, no provider, no
 * model. The research transport is a checked-in seam stub returning a fixed
 * normalized result.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorld, id } from './support/m6World.ts';
import type { TypedRef, SubjectId } from '../src/domain/v2/shared/identity.ts';
import type { CapturedWorld, WJourney, WJourneyItem } from '../src/resolution/world/world.ts';
import type { AssessmentResult } from '../src/contracts/v2/assessment/assessmentManifest.ts';
import { AssessmentResultSchema } from '../src/contracts/v2/assessment/assessmentManifest.ts';
import { createEvaluatorRegistry } from '../src/resolution/evaluation/assess.ts';
import type { Evaluator } from '../src/resolution/evaluation/evaluator.ts';
import { dimension, explain } from '../src/resolution/evaluation/explain.ts';
import { projectEffectiveWorld } from '../src/resolution/world/effectiveItinerary.ts';
import { defaultRecoveryDomainRegistry } from '../src/resolution/planning/recoveryDomains.ts';
import {
  runRecoveryPlanning,
  type CoordinatorMinters,
  type PlanningBasis,
} from '../src/resolution/planning/coordinatorCore.ts';
import type {
  DomainProposerInput,
  DomainStrategyProposer,
  PlanningEvidenceContext,
} from '../src/contracts/v2/planning/proposerAdaptation.ts';
import type { ComparatorPreference } from '../src/contracts/v2/planning/strategyRecommendation.ts';
import {
  PlanningToolResultSchema,
  type PlanningToolRequest,
  type PlanningToolResult,
} from '../src/contracts/v2/planning/planningTool.ts';
import type { ProposalCandidate } from '../src/resolution/planning/proposer.ts';

const NOW = '2030-06-01T12:00:00.000Z';
const EARLY = '2030-06-02T10:00:00.000Z';
const LATE = '2030-06-02T15:00:00.000Z';
const COORDINATOR_VERSION = 'r1-coordinator/1';
const COMPARATOR_VERSION = 'r1-comparator/1';

/** A raw provider-neutral payload a transport proposer would reason over. */
const RAW_OFFERS = { offers: [{ offerId: 'offer-1', totalPrice: { currency: 'USD', amount: 250 } }] };

function journeyRow(travellerId: string): WJourney {
  return { id: id(), revision: 1, tripId: id(), travellerId, lifecycleStatus: 'ACTIVE', intendedWindow: null, responsibilityOrganisationId: null };
}

function stayItem(journeyId: string): WJourneyItem {
  return {
    id: id(), journeyId, kind: 'STAY', orderKey: '020', lifecycleStatus: 'PLANNED', flexible: true,
    intendedWindow: { start: EARLY, end: '2030-06-02T11:00:00.000Z' },
    desiredOriginPlaceId: null, desiredDestinationPlaceId: null, selectedServiceId: null,
    intendedPlaceId: null, requiredNights: 1, participationId: null, standaloneTitle: null,
    standaloneWindow: null, resourceId: null, intendedLocationPlaceId: null,
  };
}

function manifest() {
  return emptyWorld().manifest;
}

function failingAssessment(subject: TypedRef, dimensionCode: string): AssessmentResult {
  const explanation = explain({
    evaluatorId: 'test.seam', dimension: dimensionCode, status: 'FAIL', reasonCode: 'blocked',
    cause: { kind: 'WORLD_STATE' }, affectedSubject: subject,
  });
  return AssessmentResultSchema.parse({
    id: id(), kind: 'VIABILITY', evaluatedAt: NOW, manifest: manifest(),
    subjects: [{ subjectRef: subject, role: 'PRIMARY' }],
    overallVerdict: 'FAIL',
    dimensions: [dimension({ dimension: dimensionCode, explanations: [explanation] })],
  });
}

function registryFlippingWhen(journeyId: string, passWhen: (world: CapturedWorld) => boolean) {
  const evaluator: Evaluator = {
    id: 'test.seam-stub', version: '1', assessmentKind: 'VIABILITY',
    subjectKinds: ['JOURNEY'], dimensions: ['stub'], informationTopics: [],
    evaluate(subject, context) {
      const verdict = subject.id === journeyId && !passWhen(context.world) ? 'FAIL' : 'PASS';
      return {
        dimensions: [dimension({ dimension: 'stub', explanations: [explain({ evaluatorId: 'test.seam-stub', dimension: 'stub', status: verdict, reasonCode: verdict === 'PASS' ? 'ok' : 'blocked', cause: { kind: 'WORLD_STATE' }, affectedSubject: subject })] })],
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

/** STAY basis: blocking `overnight_accommodation`, the stay item window flips the journey to PASS. */
function stayBasis(): { basis: PlanningBasis; stayItemId: string } {
  const traveller = id();
  const journey = journeyRow(traveller);
  const stay = stayItem(journey.id);
  const world = emptyWorld({
    travellers: [{ id: traveller, revision: 1, lifecycleStatus: 'ACTIVE' }],
    journeys: [journey], journeyItems: [stay],
    focus: [{ kind: 'JOURNEY', id: journey.id }],
  });
  const subject: TypedRef = { kind: 'JOURNEY', id: journey.id };
  const assessment = failingAssessment(subject, 'overnight_accommodation');
  const registry = registryFlippingWhen(journey.id, (w) => w.journeyItems.find((i) => i.id === stay.id)!.intendedWindow!.start !== EARLY);
  const basis: PlanningBasis = {
    workspaceId: world.workspaceId, recoveryCaseId: id() as SubjectId, basisAssessmentId: assessment.id as SubjectId,
    reason: 'REASSESSMENT', now: NOW, world, effective: projectEffectiveWorld(world), failing: [{ subject, assessment }], registry,
  };
  return { basis, stayItemId: stay.id };
}

/** A read-only research request + a transport that returns a fixed normalized result. */
function stayResearch(): { requests: PlanningToolRequest[]; transport: (r: PlanningToolRequest) => Promise<PlanningToolResult> } {
  const request: PlanningToolRequest = {
    id: 'req-stay-1', capability: 'HOTEL', operation: 'hotel.search', parameters: { city: 'origin' },
    purpose: 'Find alternative overnight stays', evidenceGapCode: 'overnight_inventory', round: 1,
  };
  const transport = async (): Promise<PlanningToolResult> =>
    PlanningToolResultSchema.parse({
      requestId: request.id, capability: 'HOTEL', operation: 'hotel.search', status: 'SUCCEEDED',
      normalizedEvidence: RAW_OFFERS,
      provenance: { mode: 'REPLAY', observedAt: NOW, sourceRefs: [], recordingRef: 'rec_test' },
      uncertainty: [],
    });
  return { requests: [request], transport };
}

const PREFERENCES: ComparatorPreference[] = [
  { code: 'keeps_window', priority: 'EXPLICIT_TRAVELLER', inferred: false, summary: 'Traveller prefers to keep the original window' },
];

/** A domain-aware proposer that records exactly what the seam handed it, then proposes the stay shift. */
function recordingDomainProposer(stayItemId: string, journeyId: string, captured: { input?: DomainProposerInput }): DomainStrategyProposer {
  return {
    id: 'test.domain-stay', version: '1', domains: ['STAY'],
    async propose(input: DomainProposerInput): Promise<ProposalCandidate[]> {
      captured.input = input;
      return [{
        key: 'shift-stay-window',
        effects: [{ effectKind: 'ALTER_JOURNEY_ITEM_INTENT', journeyItemId: stayItemId, proposedWindow: { start: LATE, end: '2030-06-02T16:00:00.000Z' } }],
        affectedSubjectRefs: [{ kind: 'JOURNEY_ITEM', id: stayItemId }, { kind: 'JOURNEY', id: journeyId }],
        rationale: 'Shift the stay window using the searched inventory.',
        assumptions: [],
      }];
    },
  };
}

test('seam: a DomainStrategyProposer receives its domain, raw normalized tool results, evidence refs and preferences', async () => {
  const { basis, stayItemId } = stayBasis();
  const journeyId = basis.failing[0]!.subject.id;
  const { requests, transport } = stayResearch();
  const captured: { input?: DomainProposerInput } = {};

  const out = await runRecoveryPlanning(basis, {
    domainRegistry: defaultRecoveryDomainRegistry(),
    availableCapabilities: ['FLIGHT', 'HOTEL', 'TRANSFER', 'RESEARCH'],
    proposers: [{ domain: 'STAY', proposer: recordingDomainProposer(stayItemId, journeyId, captured) }],
    minters: minters(),
    coordinatorVersion: COORDINATOR_VERSION,
    comparatorVersion: COMPARATOR_VERSION,
    preferences: PREFERENCES,
    research: { transport, requestsByDomain: { STAY: [requests] } },
  });

  // The domain proposer WAS invoked with the additive C4 context.
  assert.ok(captured.input, 'the domain proposer was invoked through bindDomainProposer');
  const ctx: PlanningEvidenceContext = captured.input!.evidence;
  assert.equal(captured.input!.domain, 'STAY', 'the proposer is told which domain it serves');
  assert.equal(ctx.domainId, 'STAY');
  // The RAW normalized result reached the proposer (the offers it must reason over).
  assert.equal(ctx.toolResults.length, 1);
  assert.deepEqual(ctx.toolResults[0]!.normalizedEvidence, RAW_OFFERS, 'the raw provider-neutral payload is threaded, not a projection');
  assert.equal(ctx.toolResults[0]!.status, 'SUCCEEDED');
  // The attempt evidence refs the proposer should cite.
  assert.deepEqual(ctx.evidenceRefs, ['evidence:req-stay-1']);
  // Preferences are threaded for proposal shaping only.
  assert.deepEqual(captured.input!.preferences, PREFERENCES);

  // The pipeline still produced a VIABLE recommended strategy (the seam is additive).
  assert.equal(out.result.outcome, 'AWAITING_AUTHORITY');
  assert.equal(out.viableStrategies.length, 1);
});

test('seam: the RAW tool payload is NEVER persisted into the attempt — only the bounded projected record', async () => {
  const { basis, stayItemId } = stayBasis();
  const journeyId = basis.failing[0]!.subject.id;
  const { requests, transport } = stayResearch();

  const out = await runRecoveryPlanning(basis, {
    domainRegistry: defaultRecoveryDomainRegistry(),
    availableCapabilities: ['FLIGHT', 'HOTEL', 'TRANSFER', 'RESEARCH'],
    proposers: [{ domain: 'STAY', proposer: recordingDomainProposer(stayItemId, journeyId, {}) }],
    minters: minters(),
    coordinatorVersion: COORDINATOR_VERSION,
    comparatorVersion: COMPARATOR_VERSION,
    research: { transport, requestsByDomain: { STAY: [requests] } },
  });

  // The attempt carries exactly one evidence record: the projection.
  assert.equal(out.attempt.evidence.length, 1);
  const record = out.attempt.evidence[0]!;
  assert.equal(record.evidenceRef, 'evidence:req-stay-1');
  assert.equal(record.operation, 'hotel.search');
  assert.equal(record.status, 'SUCCEEDED');
  assert.equal(record.provenance.mode, 'REPLAY');
  // The summary is a bounded factual projection, NOT the raw payload.
  assert.ok(typeof record.summary === 'string');
  const serialized = JSON.stringify(record);
  assert.ok(!serialized.includes('offer-1'), 'the raw offer payload never reaches the persisted record');
  assert.ok(!serialized.includes('normalizedEvidence'), 'no raw normalized payload field is persisted');
});

test('seam: a domain with NO gathered research receives an EMPTY evidence context (never a fabricated payload)', async () => {
  const { basis, stayItemId } = stayBasis();
  const journeyId = basis.failing[0]!.subject.id;
  const captured: { input?: DomainProposerInput } = {};

  // Research configured for a DIFFERENT domain only; STAY gets no requests.
  const { requests, transport } = stayResearch();
  const out = await runRecoveryPlanning(basis, {
    domainRegistry: defaultRecoveryDomainRegistry(),
    availableCapabilities: ['FLIGHT', 'HOTEL', 'TRANSFER', 'RESEARCH'],
    proposers: [{ domain: 'STAY', proposer: recordingDomainProposer(stayItemId, journeyId, captured) }],
    minters: minters(),
    coordinatorVersion: COORDINATOR_VERSION,
    comparatorVersion: COMPARATOR_VERSION,
    research: { transport, requestsByDomain: { TRANSPORT: [requests] } },
  });

  assert.ok(captured.input);
  assert.equal(captured.input!.evidence.domainId, 'STAY');
  assert.equal(captured.input!.evidence.toolResults.length, 0, 'no STAY research => empty tool results');
  assert.deepEqual(captured.input!.evidence.evidenceRefs, []);
  assert.equal(out.attempt.evidence.length, 0, 'the unrelated-domain request is not dispatched (TRANSPORT not investigated)');
});

test('seam: a base StrategyProposer is driven unchanged alongside the domain context', async () => {
  const { basis, stayItemId } = stayBasis();
  const journeyId = basis.failing[0]!.subject.id;
  // A plain base StrategyProposer (no `domains` field) must still work.
  const baseProposer = {
    id: 'test.base-stay', version: '1',
    async propose(): Promise<ProposalCandidate[]> {
      return [{
        key: 'base-shift',
        effects: [{ effectKind: 'ALTER_JOURNEY_ITEM_INTENT', journeyItemId: stayItemId, proposedWindow: { start: LATE, end: '2030-06-02T16:00:00.000Z' } }],
        affectedSubjectRefs: [{ kind: 'JOURNEY_ITEM', id: stayItemId }, { kind: 'JOURNEY', id: journeyId }],
        rationale: 'Base proposer, canonical state only.',
        assumptions: [],
      }];
    },
  };
  const out = await runRecoveryPlanning(basis, {
    domainRegistry: defaultRecoveryDomainRegistry(),
    availableCapabilities: ['FLIGHT', 'HOTEL', 'TRANSFER', 'RESEARCH'],
    proposers: [{ domain: 'STAY', proposer: baseProposer }],
    minters: minters(),
    coordinatorVersion: COORDINATOR_VERSION,
    comparatorVersion: COMPARATOR_VERSION,
  });
  assert.equal(out.result.outcome, 'AWAITING_AUTHORITY');
  const rec = out.attempt.materialCandidates.find((m) => m.disposition === 'RECOMMENDED')!;
  assert.equal(rec.proposerId, 'test.base-stay');
});

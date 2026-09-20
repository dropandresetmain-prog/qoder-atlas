/**
 * R1 — decision-evidence assembly is a faithful, PURE re-projection of real
 * RC-6 output into the three frozen impact semantics (C7) and material
 * candidate evidence (C5). No PostgreSQL, no provider, no model: these tests run
 * the actual `evaluateRecoveryStrategy` on an in-memory captured world with a
 * stub evaluator registry (the same fixtures `strategy-viability.test.ts` uses)
 * and assert the projection preserves — never invents or collapses — what the
 * deterministic evaluator decided.
 *
 * The point of R1 "decision-evidence parity": the persisted attempt must carry
 * the evaluator's own verdicts, codes and three SEPARATE impact projections.
 * A rejected candidate must keep its honest rejection evidence; a viable one
 * must show baseline->candidate movement; the three projections must not be
 * conflated with each other.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorld, id } from './support/m6World.ts';
import type { TypedRef } from '../src/domain/v2/shared/identity.ts';
import type { CapturedWorld, WJourney, WProgrammeItem } from '../src/resolution/world/world.ts';
import { ScenarioChangeSchema } from '../src/contracts/v2/scenario/scenarioChange.ts';
import { evaluateRecoveryStrategy } from '../src/resolution/scenarios/evaluate.ts';
import { createEvaluatorRegistry } from '../src/resolution/evaluation/assess.ts';
import type { Evaluator } from '../src/resolution/evaluation/evaluator.ts';
import { dimension, explain } from '../src/resolution/evaluation/explain.ts';
import type { AssessmentVerdict } from '../src/contracts/v2/assessment/assessmentManifest.ts';
import type { WorldSnapshotManifest } from '../src/contracts/v2/scope/readScope.ts';
import {
  assemblePlanningAttempt,
  dispositionFor,
  effectChangedRefs,
  immediateBlastRadiusOf,
  materialCandidateFromEvaluation,
  materialCandidateFromValidationRejection,
  outcomeDeltaOf,
  reassessmentClosureOf,
  viabilityDecisionCodesOf,
} from '../src/resolution/planning/decisionEvidence.ts';

const NOW = '2030-06-01T12:00:00.000Z';
const EARLY = '2030-06-02T10:00:00.000Z';
const LATE = '2030-06-02T15:00:00.000Z';

function journeyRow(over: Partial<WJourney> = {}): WJourney {
  return { id: id(), revision: 1, tripId: id(), travellerId: id(), lifecycleStatus: 'ACTIVE', intendedWindow: null, responsibilityOrganisationId: null, ...over };
}

function emptyManifest(): WorldSnapshotManifest {
  return { evaluatedAt: NOW, evaluatorVersions: [], aggregateReads: [], scopeReads: [], evidenceReads: [], coverageReads: [], missingCoverage: [] };
}

function stubRegistry(verdictFor: (world: CapturedWorld, subject: TypedRef) => AssessmentVerdict) {
  const evaluator: Evaluator = {
    id: 'test.evidence-stub',
    version: '1',
    assessmentKind: 'VIABILITY',
    subjectKinds: ['JOURNEY'],
    dimensions: ['stub'],
    informationTopics: [],
    evaluate(subject, context) {
      const verdict = verdictFor(context.world, subject);
      const reason = verdict === 'PASS' ? 'ok' : verdict === 'FAIL' ? 'blocked' : 'unknown';
      return {
        dimensions: [dimension({
          dimension: 'stub',
          explanations: [explain({
            evaluatorId: 'test.evidence-stub',
            dimension: 'stub',
            status: verdict,
            reasonCode: reason,
            cause: { kind: 'WORLD_STATE' },
            affectedSubject: subject,
          })],
        })],
        evidence: [],
        missingCoverage: [],
      };
    },
  };
  return createEvaluatorRegistry([evaluator]);
}

function programmeItem(over: Partial<WProgrammeItem> & Pick<WProgrammeItem, 'id' | 'programmeId'>): WProgrammeItem {
  return {
    title: 'session', itemType: 'SESSION', placeId: 'p-venue',
    window: { start: EARLY, end: '2030-06-02T11:00:00.000Z' },
    lifecycleStatus: 'SCHEDULED', scheduleAuthority: 'INTERNAL', operatingRequirements: null,
    ...over,
  };
}

/** A programme-time-swap recovery for one traveller: FAIL at baseline, PASS after. */
function programmeTimeSwapWorld() {
  const programmeId = id();
  const itemId = id();
  const travellerA = id();
  const jA = journeyRow({ travellerId: travellerA });
  const world = emptyWorld({
    travellers: [{ id: travellerA, revision: 1, lifecycleStatus: 'ACTIVE' }],
    journeys: [jA],
    programmes: [{ id: programmeId, revision: 1, eventId: id(), title: 'event', lifecycleStatus: 'ACTIVE' }],
    programmeItems: [programmeItem({ id: itemId, programmeId })],
    participations: [
      { id: id(), programmeItemId: itemId, travellerId: travellerA, obligation: 'REQUIRED', accepted: true, preparationWindow: null },
    ],
    focus: [{ kind: 'JOURNEY', id: jA.id }],
  });
  const change = ScenarioChangeSchema.parse({
    id: id(), recoveryStrategyId: id(), strategyVersion: 1,
    affectedSubjectRefs: [{ kind: 'PROGRAMME_ITEM', id: itemId }, { kind: 'JOURNEY', id: jA.id }],
    basisAssessmentId: id(),
    effects: [{ effectKind: 'CHANGE_PROGRAMME_ITEM_TIME', programmeItemId: itemId, proposedWindow: { start: LATE, end: '2030-06-02T16:00:00.000Z' } }],
  });
  const evaluated = evaluateRecoveryStrategy({
    recoveryCaseId: id(),
    baseWorld: world,
    baseManifest: emptyManifest(),
    basisAssessmentId: change.basisAssessmentId,
    scenarioChange: change,
    now: NOW,
    resolveSubjectRefs: [{ kind: 'JOURNEY', id: jA.id }],
    registry: stubRegistry((w, subject) => {
      const item = w.programmeItems.find((i) => i.id === itemId);
      void subject;
      return item?.window?.start === EARLY ? 'FAIL' : 'PASS';
    }),
  });
  assert.equal(evaluated.ok, true, 'fixture strategy must evaluate');
  if (!evaluated.ok) throw new Error('unreachable');
  return { result: evaluated.value, itemId, journeyId: jA.id };
}

test('effectChangedRefs: maps each closed effect kind to the subjects it writes', () => {
  const journeyItemId = id();
  const offerId = id();
  const refs = effectChangedRefs({ effectKind: 'SELECT_OFFER', journeyItemId, offerId });
  assert.deepEqual(refs, [
    { kind: 'JOURNEY_ITEM', id: journeyItemId },
    { kind: 'OFFER', id: offerId },
  ]);
  const programmeItemId = id();
  assert.deepEqual(effectChangedRefs({ effectKind: 'CHANGE_PROGRAMME_ITEM_TIME', programmeItemId, proposedWindow: { start: EARLY, end: LATE } }), [
    { kind: 'PROGRAMME_ITEM', id: programmeItemId },
  ]);
});

test('immediateBlastRadiusOf: separates changed objects from directly-affected subjects', () => {
  const { result, itemId, journeyId } = programmeTimeSwapWorld();
  const blast = immediateBlastRadiusOf(result.strategy);
  // The programme item is what the effect CHANGES.
  assert.ok(blast.changedRefs.some((r) => r.kind === 'PROGRAMME_ITEM' && r.id === itemId));
  // The journey is directly affected but not itself written by the effect.
  assert.ok(blast.directlyAffectedRefs.some((r) => r.kind === 'JOURNEY' && r.id === journeyId));
  assert.ok(!blast.directlyAffectedRefs.some((r) => r.kind === 'PROGRAMME_ITEM' && r.id === itemId), 'a changed ref is not also a directly-affected ref');
});

test('reassessmentClosureOf: is the set RC-6 actually reevaluated (candidate assessments)', () => {
  const { result, journeyId } = programmeTimeSwapWorld();
  const closure = reassessmentClosureOf(result.strategy);
  assert.ok(closure.reachedRefs.some((r) => r.kind === 'JOURNEY' && r.id === journeyId));
  // The closure is the reassessed subjects; it equals the candidate assessment subject set.
  const candidateKeys = new Set(result.strategy.candidateAssessments.map((c) => `${c.subjectRef.kind}:${c.subjectRef.id}`));
  for (const r of closure.reachedRefs) assert.ok(candidateKeys.has(`${r.kind}:${r.id}`));
});

test('three projections stay distinct: blast radius is not the closure', () => {
  const { result } = programmeTimeSwapWorld();
  const blast = immediateBlastRadiusOf(result.strategy);
  const closure = reassessmentClosureOf(result.strategy);
  const blastKeys = new Set([...blast.changedRefs, ...blast.directlyAffectedRefs].map((r) => `${r.kind}:${r.id}`));
  const closureKeys = new Set(closure.reachedRefs.map((r) => `${r.kind}:${r.id}`));
  // The blast radius names the written programme item; the closure names reassessed journeys.
  assert.ok(blastKeys.size > 0 && closureKeys.size > 0);
  assert.notDeepEqual([...blastKeys].sort(), [...closureKeys].sort(), 'A and B must not be collapsed into one another');
});

test('outcomeDeltaOf: FAIL -> PASS on the named subject is BETTER, from real baseline/candidate', () => {
  const { result, journeyId } = programmeTimeSwapWorld();
  const delta = outcomeDeltaOf(result);
  const named = delta.find((d) => d.subjectRef.kind === 'JOURNEY' && d.subjectRef.id === journeyId);
  assert.ok(named, 'named journey is in the outcome delta');
  assert.equal(named!.baseline, 'FAIL');
  assert.equal(named!.candidate, 'PASS');
  assert.equal(named!.delta, 'BETTER');
});

test('outcomeDeltaOf: an unchanged reached subject is UNCHANGED, never a healing claim', () => {
  // Build a world where a co-participant stays UNKNOWN before and after.
  const programmeId = id();
  const itemId = id();
  const travellerA = id();
  const travellerB = id();
  const jA = journeyRow({ travellerId: travellerA });
  const jB = journeyRow({ travellerId: travellerB });
  const world = emptyWorld({
    travellers: [{ id: travellerA, revision: 1, lifecycleStatus: 'ACTIVE' }, { id: travellerB, revision: 1, lifecycleStatus: 'ACTIVE' }],
    journeys: [jA, jB],
    programmes: [{ id: programmeId, revision: 1, eventId: id(), title: 'event', lifecycleStatus: 'ACTIVE' }],
    programmeItems: [programmeItem({ id: itemId, programmeId })],
    participations: [
      { id: id(), programmeItemId: itemId, travellerId: travellerA, obligation: 'REQUIRED', accepted: true, preparationWindow: null },
      { id: id(), programmeItemId: itemId, travellerId: travellerB, obligation: 'REQUIRED', accepted: true, preparationWindow: null },
    ],
    focus: [{ kind: 'JOURNEY', id: jA.id }],
  });
  const change = ScenarioChangeSchema.parse({
    id: id(), recoveryStrategyId: id(), strategyVersion: 1,
    affectedSubjectRefs: [{ kind: 'PROGRAMME_ITEM', id: itemId }, { kind: 'JOURNEY', id: jA.id }],
    basisAssessmentId: id(),
    effects: [{ effectKind: 'CHANGE_PROGRAMME_ITEM_TIME', programmeItemId: itemId, proposedWindow: { start: LATE, end: '2030-06-02T16:00:00.000Z' } }],
  });
  const evaluated = evaluateRecoveryStrategy({
    recoveryCaseId: id(), baseWorld: world, baseManifest: emptyManifest(),
    basisAssessmentId: change.basisAssessmentId, scenarioChange: change, now: NOW,
    resolveSubjectRefs: [{ kind: 'JOURNEY', id: jA.id }],
    registry: stubRegistry((w, subject) => {
      if (subject.id === jB.id) return 'UNKNOWN';
      const item = w.programmeItems.find((i) => i.id === itemId);
      return item?.window?.start === EARLY ? 'FAIL' : 'PASS';
    }),
  });
  assert.equal(evaluated.ok, true);
  if (!evaluated.ok) return;
  const delta = outcomeDeltaOf(evaluated.value);
  const peer = delta.find((d) => d.subjectRef.id === jB.id);
  assert.ok(peer, 'co-participant is in the outcome delta');
  assert.equal(peer!.candidate, 'UNKNOWN');
  assert.equal(peer!.delta, 'UNCHANGED', 'UNKNOWN -> UNKNOWN is UNCHANGED, not BETTER');
});

test('viabilityDecisionCodesOf: dedupes and sorts the evaluator codes', () => {
  const codes = viabilityDecisionCodesOf([
    { code: 'REGRESSION_FAIL' }, { code: 'UNRESOLVED_FAIL' }, { code: 'REGRESSION_FAIL' },
  ]);
  assert.deepEqual(codes, ['REGRESSION_FAIL', 'UNRESOLVED_FAIL']);
});

test('dispositionFor: VIABLE+recommended=RECOMMENDED, VIABLE only=VIABLE_NOT_RECOMMENDED, else REJECTED_DETERMINISTIC', () => {
  assert.equal(dispositionFor('VIABLE', true), 'RECOMMENDED');
  assert.equal(dispositionFor('VIABLE', false), 'VIABLE_NOT_RECOMMENDED');
  assert.equal(dispositionFor('NOT_VIABLE', false), 'REJECTED_DETERMINISTIC');
  assert.equal(dispositionFor('NOT_EXECUTABLE', false), 'REJECTED_DETERMINISTIC');
});

test('materialCandidateFromEvaluation: a VIABLE candidate carries viability, codes and all three projections', () => {
  const { result } = programmeTimeSwapWorld();
  assert.equal(result.strategy.viability, 'VIABLE');
  const evidence = materialCandidateFromEvaluation({
    candidateKey: 'swap-session', proposerId: 'programme-time-swap', domainId: 'PROGRAMME',
    strategyRef: result.strategy.id, recommended: true, result,
  });
  assert.equal(evidence.disposition, 'RECOMMENDED');
  assert.equal(evidence.viability, 'VIABLE');
  assert.equal(evidence.strategyRef, result.strategy.id);
  assert.ok(evidence.immediateChangeBlastRadius, 'carries projection A');
  assert.ok(evidence.reassessmentClosure, 'carries projection B');
  assert.ok(evidence.outcomeDelta.length > 0, 'carries projection C');
  assert.deepEqual(evidence.viabilityDecisionCodes, [], 'VIABLE has no veto codes');
});

test('materialCandidateFromEvaluation: a rejected candidate keeps honest rejection codes and no fabricated healing', () => {
  // Force a NOT_VIABLE outcome: the named subject never heals.
  const programmeId = id();
  const itemId = id();
  const travellerA = id();
  const jA = journeyRow({ travellerId: travellerA });
  const world = emptyWorld({
    travellers: [{ id: travellerA, revision: 1, lifecycleStatus: 'ACTIVE' }],
    journeys: [jA],
    programmes: [{ id: programmeId, revision: 1, eventId: id(), title: 'event', lifecycleStatus: 'ACTIVE' }],
    programmeItems: [programmeItem({ id: itemId, programmeId })],
    participations: [{ id: id(), programmeItemId: itemId, travellerId: travellerA, obligation: 'REQUIRED', accepted: true, preparationWindow: null }],
    focus: [{ kind: 'JOURNEY', id: jA.id }],
  });
  const change = ScenarioChangeSchema.parse({
    id: id(), recoveryStrategyId: id(), strategyVersion: 1,
    affectedSubjectRefs: [{ kind: 'PROGRAMME_ITEM', id: itemId }, { kind: 'JOURNEY', id: jA.id }],
    basisAssessmentId: id(),
    effects: [{ effectKind: 'CHANGE_PROGRAMME_ITEM_TIME', programmeItemId: itemId, proposedWindow: { start: LATE, end: '2030-06-02T16:00:00.000Z' } }],
  });
  const evaluated = evaluateRecoveryStrategy({
    recoveryCaseId: id(), baseWorld: world, baseManifest: emptyManifest(),
    basisAssessmentId: change.basisAssessmentId, scenarioChange: change, now: NOW,
    resolveSubjectRefs: [{ kind: 'JOURNEY', id: jA.id }],
    registry: stubRegistry(() => 'FAIL'),
  });
  assert.equal(evaluated.ok, true);
  if (!evaluated.ok) return;
  assert.equal(evaluated.value.strategy.viability, 'NOT_VIABLE');
  const evidence = materialCandidateFromEvaluation({
    candidateKey: 'swap-does-not-heal', proposerId: 'programme-time-swap', domainId: 'PROGRAMME',
    recommended: false, result: evaluated.value,
  });
  assert.equal(evidence.disposition, 'REJECTED_DETERMINISTIC');
  assert.equal(evidence.viability, 'NOT_VIABLE');
  assert.ok(evidence.viabilityDecisionCodes.includes('UNRESOLVED_FAIL'), 'keeps the evaluator veto code');
  assert.deepEqual(evidence.proposal?.blockers, [{ dimension: 'stub', verdict: 'FAIL', reasonCode: 'blocked' }], 'persists the evaluator explanation rather than only its viability code');
  assert.equal(evidence.strategyRef, undefined, 'a rejected candidate is not promoted to a RecoveryStrategy ref');
  assert.ok(!evidence.outcomeDelta.some((d) => d.delta === 'BETTER'), 'no fabricated healing in a rejected candidate');
});

test('materialCandidateFromValidationRejection: carries reason codes, no viability, no projections', () => {
  const evidence = materialCandidateFromValidationRejection({
    candidateKey: 'malformed', proposerId: 'some-proposer', domainId: 'TRANSPORT',
    validationReasonCodes: ['effects: too_small'],
  });
  assert.equal(evidence.disposition, 'REJECTED_VALIDATION');
  assert.deepEqual(evidence.validationReasonCodes, ['effects: too_small']);
  assert.equal(evidence.viability, undefined);
  assert.deepEqual(evidence.outcomeDelta, []);
  assert.equal(evidence.immediateChangeBlastRadius, undefined);
});

test('assemblePlanningAttempt: a complete attempt with viable + rejected evidence validates and round-trips', () => {
  const { result } = programmeTimeSwapWorld();
  const recoveryCaseId = result.strategy.recoveryCaseId;
  const basisAssessmentId = result.strategy.basisAssessmentId;
  const recommended = materialCandidateFromEvaluation({
    candidateKey: 'swap-session', proposerId: 'programme-time-swap', domainId: 'PROGRAMME',
    strategyRef: result.strategy.id, recommended: true, result,
  });
  const rejected = materialCandidateFromValidationRejection({
    candidateKey: 'malformed', proposerId: 'some-proposer', domainId: 'TRANSPORT',
    validationReasonCodes: ['effects: too_small'],
  });
  const attempt = assemblePlanningAttempt({
    id: id(), recoveryCaseId, basisAssessmentId, basisManifest: emptyManifest(),
    startedAt: NOW, completedAt: NOW, coordinatorVersion: 'r1/1',
    domains: [
      { domainId: 'PROGRAMME', source: 'DETERMINISTIC', disposition: 'INVESTIGATED', reasonCode: 'programme_obligation_unmet' },
    ],
    evidence: [],
    materialCandidates: [recommended, rejected],
    viableStrategyRefs: [result.strategy.id],
  });
  assert.equal(attempt.materialCandidates.length, 2);
  assert.deepEqual(attempt.viableStrategyRefs, [result.strategy.id]);
  assert.equal(attempt.recommendation, undefined, 'no recommendation was supplied');
  // Round-trip: reassembling the parsed value is identical.
  const again = assemblePlanningAttempt({
    id: attempt.id, recoveryCaseId: attempt.recoveryCaseId, basisAssessmentId: attempt.basisAssessmentId,
    basisManifest: attempt.basisManifest, startedAt: attempt.startedAt, completedAt: attempt.completedAt,
    coordinatorVersion: attempt.coordinatorVersion, domains: attempt.domains, evidence: attempt.evidence,
    materialCandidates: attempt.materialCandidates, viableStrategyRefs: attempt.viableStrategyRefs,
  });
  assert.deepEqual(again, attempt);
});

test('assemblePlanningAttempt: completedAt before startedAt is rejected (bounded, honest interval)', () => {
  const { result } = programmeTimeSwapWorld();
  assert.throws(() => assemblePlanningAttempt({
    id: id(), recoveryCaseId: result.strategy.recoveryCaseId, basisAssessmentId: result.strategy.basisAssessmentId,
    basisManifest: emptyManifest(), startedAt: LATE, completedAt: EARLY, coordinatorVersion: 'r1/1',
    domains: [], evidence: [], materialCandidates: [], viableStrategyRefs: [],
  }));
});

test('candidate programme evidence preserves captured timing without calculating missing facts', () => {
  const { result, itemId } = programmeTimeSwapWorld();
  const dimension = result.strategy.candidateAssessmentResults[0]!.dimensions[0]!;
  dimension.dimension = 'programme_participation';
  const explanation = dimension.explanations[0]!;
  explanation.relatedSubjects = [{ kind: 'PROGRAMME_ITEM', id: itemId }];
  explanation.facts = { deadline: LATE, arrival: EARLY, availableMinutes: 300, requiredMinutes: 150, transferMinutes: 25 };
  const evidence = materialCandidateFromEvaluation({ candidateKey: 'captured-programme', proposerId: 'programme', domainId: 'PROGRAMME', recommended: true, result });
  assert.deepEqual(evidence.proposal?.programmeChecks?.[0], {
    label: result.proposedWorld.programmeItems.find(item => item.id === itemId)!.title,
    verdict: explanation.status, reasonCode: explanation.reasonCode,
    deadline: LATE, arrival: EARLY, availableMinutes: 300, requiredMinutes: 150, transferMinutes: 25,
  });
  delete explanation.facts.availableMinutes;
  const missing = materialCandidateFromEvaluation({ candidateKey: 'missing-timing', proposerId: 'programme', domainId: 'PROGRAMME', recommended: true, result });
  assert.equal(missing.proposal?.programmeChecks?.[0]?.availableMinutes, undefined, 'the projection must not calculate missing engine evidence from timestamps');
});

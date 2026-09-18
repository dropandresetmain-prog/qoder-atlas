/**
 * R1 — the pure selection layer (comparator-fact derivation + planning-outcome
 * mapping) never invents numbers or outcomes. Fact derivation is exercised
 * through REAL RC-6 output (the same evaluateRecoveryStrategy fixture the
 * decision-evidence test uses), so worseCount/betterCount/blastRadiusSize are
 * provably the evaluator's own projections. Outcome mapping is pinned against
 * the closed RecoveryPlanningOutcome precedence. Pure: no PG, no provider, no
 * model.
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
import { materialCandidateFromEvaluation, materialCandidateFromValidationRejection } from '../src/resolution/planning/decisionEvidence.ts';
import { comparisonFactsFromEvidence, planningOutcomeOf } from '../src/resolution/planning/planningSelection.ts';

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
    id: 'test.selection-stub', version: '1', assessmentKind: 'VIABILITY',
    subjectKinds: ['JOURNEY'], dimensions: ['stub'], informationTopics: [],
    evaluate(subject, context) {
      const verdict = verdictFor(context.world, subject);
      const reason = verdict === 'PASS' ? 'ok' : verdict === 'FAIL' ? 'blocked' : 'unknown';
      return {
        dimensions: [dimension({ dimension: 'stub', explanations: [explain({ evaluatorId: 'test.selection-stub', dimension: 'stub', status: verdict, reasonCode: reason, cause: { kind: 'WORLD_STATE' }, affectedSubject: subject })] })],
        evidence: [], missingCoverage: [],
      };
    },
  };
  return createEvaluatorRegistry([evaluator]);
}

function programmeItem(over: Partial<WProgrammeItem> & Pick<WProgrammeItem, 'id' | 'programmeId'>): WProgrammeItem {
  return { title: 'session', itemType: 'SESSION', placeId: 'p-venue', window: { start: EARLY, end: '2030-06-02T11:00:00.000Z' }, lifecycleStatus: 'SCHEDULED', scheduleAuthority: 'INTERNAL', operatingRequirements: null, ...over };
}

function viableEvidence() {
  const programmeId = id(); const itemId = id(); const travellerA = id();
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
    recoveryCaseId: id(), baseWorld: world, baseManifest: emptyManifest(), basisAssessmentId: change.basisAssessmentId,
    scenarioChange: change, now: NOW, resolveSubjectRefs: [{ kind: 'JOURNEY', id: jA.id }],
    registry: stubRegistry((w) => (w.programmeItems.find((i) => i.id === itemId)?.window?.start === EARLY ? 'FAIL' : 'PASS')),
  });
  assert.equal(evaluated.ok, true);
  if (!evaluated.ok) throw new Error('unreachable');
  return materialCandidateFromEvaluation({ candidateKey: 'swap-session', proposerId: 'programme-time-swap', domainId: 'PROGRAMME', strategyRef: evaluated.value.strategy.id, recommended: true, result: evaluated.value });
}

test('comparisonFactsFromEvidence: counts come from the evaluator outcome delta and blast radius', () => {
  const evidence = viableEvidence();
  const facts = comparisonFactsFromEvidence(evidence);
  assert.ok(facts);
  assert.equal(facts!.strategyRef, evidence.strategyRef);
  assert.equal(facts!.betterCount, evidence.outcomeDelta.filter((d) => d.delta === 'BETTER').length);
  assert.equal(facts!.worseCount, evidence.outcomeDelta.filter((d) => d.delta === 'WORSE').length);
  const blast = evidence.immediateChangeBlastRadius!;
  assert.equal(facts!.blastRadiusSize, blast.changedRefs.length + blast.directlyAffectedRefs.length);
  assert.ok(facts!.betterCount >= 1, 'the FAIL->PASS swap shows at least one improvement');
});

test('comparisonFactsFromEvidence: optional planner-computed extras are carried through, not fabricated', () => {
  const evidence = viableEvidence();
  const facts = comparisonFactsFromEvidence(evidence, { declaredCostMinorUnits: 1500, satisfiedPreferenceCodes: ['keeps_window'], semanticNotes: ['closer to venue'] });
  assert.ok(facts);
  assert.equal(facts!.declaredCostMinorUnits, 1500);
  assert.deepEqual(facts!.satisfiedPreferenceCodes, ['keeps_window']);
  assert.deepEqual(facts!.semanticNotes, ['closer to venue']);
  // Without extras, no cost/prefs/notes are invented.
  const bare = comparisonFactsFromEvidence(evidence)!;
  assert.equal(bare.declaredCostMinorUnits, undefined);
  assert.equal(bare.satisfiedPreferenceCodes, undefined);
});

test('comparisonFactsFromEvidence: a validation rejection (never reached RC-6) yields no facts', () => {
  const rejected = materialCandidateFromValidationRejection({ candidateKey: 'malformed', proposerId: 'some-proposer', domainId: 'TRANSPORT', validationReasonCodes: ['effects: too_small'] });
  assert.equal(comparisonFactsFromEvidence(rejected), undefined);
});

test('planningOutcomeOf: closed-vocabulary precedence', () => {
  // 1. stale basis dominates everything.
  assert.equal(planningOutcomeOf({ basisStale: true, researchBudgetExhausted: false, operatorDecisionRequired: false, viableStrategyCount: 2, recommendationProduced: true }), 'STALE_RETRY_REQUIRED');
  // 2. viable + recommendation + no operator decision => awaiting authority.
  assert.equal(planningOutcomeOf({ basisStale: false, researchBudgetExhausted: false, operatorDecisionRequired: false, viableStrategyCount: 1, recommendationProduced: true }), 'AWAITING_AUTHORITY');
  // 3a. viable but operator decision required => needs evidence/decision.
  assert.equal(planningOutcomeOf({ basisStale: false, researchBudgetExhausted: false, operatorDecisionRequired: true, viableStrategyCount: 1, recommendationProduced: true }), 'NEEDS_EVIDENCE_OR_DECISION');
  // 3b. viable but no recommendation => needs evidence/decision.
  assert.equal(planningOutcomeOf({ basisStale: false, researchBudgetExhausted: false, operatorDecisionRequired: false, viableStrategyCount: 1, recommendationProduced: false }), 'NEEDS_EVIDENCE_OR_DECISION');
  // 3c. nothing viable but research exhausted => needs evidence/decision.
  assert.equal(planningOutcomeOf({ basisStale: false, researchBudgetExhausted: true, operatorDecisionRequired: false, viableStrategyCount: 0, recommendationProduced: false }), 'NEEDS_EVIDENCE_OR_DECISION');
  // 4. nothing viable, nothing pending => honest no-recovery.
  assert.equal(planningOutcomeOf({ basisStale: false, researchBudgetExhausted: false, operatorDecisionRequired: false, viableStrategyCount: 0, recommendationProduced: false }), 'NO_RECOVERY_FOUND');
});

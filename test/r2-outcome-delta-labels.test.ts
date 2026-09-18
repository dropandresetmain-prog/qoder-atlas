/**
 * R2 — generic outcome-delta / planning-evidence human-label polish.
 *
 * R1 carry-forward: decision-time `outcomeDelta` subject labels said the
 * generic kind word ("Journey") even when authoritative traveller names were
 * available. R2 resolves this WITHOUT replacing typed refs and WITHOUT any
 * persona-specific lookup: the caller may supply a `<KIND>:<id> -> display
 * value` map built from canonical identity state, and the projector upgrades
 * the human label only. The typed ref stays secondary; the generic kind label
 * remains the honest fallback for refs the map does not cover.
 *
 * Pure Cloud test — no PostgreSQL, no browser, no scenario tokens.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RecoveryPlanningAttemptSchema,
  type RecoveryPlanningAttempt,
  type RecoveryPlanningOutcome,
} from '../src/contracts/v2/planning/index.ts';
import { projectPlanningEvidence } from '../src/app/target/readmodels/index.ts';

const NOW = '2031-05-01T00:00:00.000Z';
const EARLIER = '2031-04-30T23:00:00.000Z';
const OUTCOME: RecoveryPlanningOutcome = 'AWAITING_AUTHORITY';

function attempt(): RecoveryPlanningAttempt {
  return RecoveryPlanningAttemptSchema.parse({
    id: 'attempt-1',
    recoveryCaseId: 'case-1',
    basisAssessmentId: 'a-1',
    basisManifest: {
      evaluatedAt: NOW, evaluatorVersions: [], aggregateReads: [], scopeReads: [],
      evidenceReads: [], coverageReads: [], missingCoverage: [],
    },
    startedAt: EARLIER,
    completedAt: NOW,
    coordinatorVersion: '1.0.0',
    domains: [
      { domainId: 'TRANSPORT', source: 'DETERMINISTIC', disposition: 'INVESTIGATED', reasonCode: 'connection_feasibility_blocking' },
    ],
    evidence: [],
    materialCandidates: [
      {
        candidateKey: 'transport#1',
        proposerId: 'proposer.transport-offer',
        domainId: 'TRANSPORT',
        strategyRef: 's-viable-1',
        disposition: 'RECOMMENDED',
        evidenceRefs: [],
        validationReasonCodes: [],
        viability: 'VIABLE',
        viabilityDecisionCodes: [],
        immediateChangeBlastRadius: {
          changedRefs: [{ kind: 'JOURNEY_ITEM', id: 'item-1' }],
          directlyAffectedRefs: [{ kind: 'TRAVELLER', id: 'trav-1' }],
        },
        reassessmentClosure: { reachedRefs: [{ kind: 'JOURNEY', id: 'journey-1' }] },
        outcomeDelta: [
          { subjectRef: { kind: 'JOURNEY', id: 'journey-1' }, baseline: 'FAIL', candidate: 'PASS', delta: 'BETTER' },
        ],
      },
    ],
    viableStrategyRefs: ['s-viable-1'],
    recommendation: {
      recommendedStrategyRef: 's-viable-1',
      alternativeStrategyRefs: [],
      recommendationBasis: [{ code: 'lowest_total_cost', summary: 'Cheapest viable option', kind: 'DETERMINISTIC_FACT' }],
      tradeoffs: [], uncertainty: [], evidenceRefs: [],
      provenance: { kind: 'DETERMINISTIC', comparatorVersion: '1.0.0' },
    },
  });
}

test('R2: without a label map, subject labels stay the generic kind word', () => {
  const view = projectPlanningEvidence(attempt(), OUTCOME);
  const delta = view.candidates[0]?.outcomeDelta[0];
  assert.equal(delta?.subject.label, 'Journey');
  assert.equal(delta?.subject.ref, 'JOURNEY:journey-1');
});

test('R2: an authoritative label map upgrades the human label, keeps the ref', () => {
  const labels = new Map<string, string>([['JOURNEY:journey-1', 'Traveller A']]);
  const view = projectPlanningEvidence(attempt(), OUTCOME, labels);
  const delta = view.candidates[0]?.outcomeDelta[0];
  // Human label upgraded from authoritative identity…
  assert.equal(delta?.subject.label, 'Traveller A');
  // …typed ref preserved verbatim as secondary metadata (never replaced).
  assert.equal(delta?.subject.ref, 'JOURNEY:journey-1');
});

test('R2: labels also upgrade blast-radius subjects; uncovered refs fall back', () => {
  const labels = new Map<string, string>([['TRAVELLER:trav-1', 'Traveller A']]);
  const view = projectPlanningEvidence(attempt(), OUTCOME, labels);
  const radius = view.candidates[0]?.blastRadius;
  // Covered ref uses the authoritative name.
  assert.equal(radius?.directlyAffected[0]?.label, 'Traveller A');
  assert.equal(radius?.directlyAffected[0]?.ref, 'TRAVELLER:trav-1');
  // Uncovered refs keep the honest generic kind label, never a fabricated name.
  assert.equal(radius?.changed[0]?.label, 'Journey item');
  assert.equal(radius?.reassessed[0]?.label, 'Journey');
});

test('R2: an empty string label never overrides (honest fallback)', () => {
  const labels = new Map<string, string>([['JOURNEY:journey-1', '']]);
  const view = projectPlanningEvidence(attempt(), OUTCOME, labels);
  assert.equal(view.candidates[0]?.outcomeDelta[0]?.subject.label, 'Journey');
});

test('R2: the label map is generic — no persona key required, works for any kind', () => {
  // The SAME projector resolves names for whatever kinds the caller supplies;
  // nothing here branches on a specific traveller/event/route.
  const labels = new Map<string, string>([
    ['JOURNEY:journey-1', 'Named Person'],
    ['JOURNEY_ITEM:item-1', 'Morning Session'],
  ]);
  const view = projectPlanningEvidence(attempt(), OUTCOME, labels);
  assert.equal(view.candidates[0]?.outcomeDelta[0]?.subject.label, 'Named Person');
  assert.equal(view.candidates[0]?.blastRadius?.changed[0]?.label, 'Morning Session');
});

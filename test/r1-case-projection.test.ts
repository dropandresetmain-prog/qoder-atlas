/**
 * C9 — Case projection of decision-time planning evidence (freeze §12 Q4-Q12).
 *
 * Pure Cloud tests: they drive `projectPlanningEvidence` (and the end-to-end
 * spread through `projectRecoveryCase`) from a frozen `RecoveryPlanningAttempt`
 * record. No PostgreSQL, no providers — the loader that fetches the attempt is
 * a LOCAL acceptance item; the projection it feeds is proven here.
 *
 * Asserts the two structural guarantees freeze §12 demands:
 *   - human labels are PRIMARY, typed refs / closed-vocab codes SECONDARY
 *     (line 529: internal UUIDs/capability codes are never the primary
 *     product explanation);
 *   - planning-time evidence is VISIBLY distinguishable from current
 *     authoritative state (`phase: 'DECISION_TIME'` + `asOf`).
 *
 * All identifiers are generic (no persona/event/route/demo token).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RecoveryPlanningAttemptSchema,
  type RecoveryPlanningAttempt,
  type RecoveryPlanningOutcome,
} from '../src/contracts/v2/planning/index.ts';
import { projectPlanningEvidence, projectRecoveryCase } from '../src/app/target/readmodels/index.ts';

const NOW = '2031-05-01T00:00:00.000Z';
const EARLIER = '2031-04-30T23:00:00.000Z';

/** A complete, contract-valid attempt record with planning-time evidence. */
function attemptRecord(overrides: Partial<RecoveryPlanningAttempt> = {}): RecoveryPlanningAttempt {
  return RecoveryPlanningAttemptSchema.parse({
    id: 'attempt-1',
    recoveryCaseId: 'case-1',
    basisAssessmentId: 'a-1',
    basisManifest: {
      evaluatedAt: NOW,
      evaluatorVersions: [],
      aggregateReads: [],
      scopeReads: [],
      evidenceReads: [],
      coverageReads: [],
      missingCoverage: [],
    },
    startedAt: EARLIER,
    completedAt: NOW,
    coordinatorVersion: '1.0.0',
    domains: [
      { domainId: 'TRANSPORT', source: 'DETERMINISTIC', disposition: 'INVESTIGATED', reasonCode: 'connection_feasibility_blocking' },
      { domainId: 'PROGRAMME', source: 'DETERMINISTIC', disposition: 'NOT_APPLICABLE', reasonCode: 'no_programme_dependency' },
    ],
    evidence: [
      {
        evidenceRef: 'ev-1',
        requestFingerprint: 'FLIGHT|flight.search|{}',
        capability: 'FLIGHT',
        operation: 'flight.search',
        status: 'SUCCEEDED',
        summary: 'Two alternatives found',
        provenance: { mode: 'REPLAY', observedAt: NOW, sourceRefs: [], recordingRef: 'rec-1' },
        uncertainty: [{ code: 'price_volatility', summary: 'Fares may change before booking' }],
      },
    ],
    materialCandidates: [
      {
        candidateKey: 'transport#0',
        proposerId: 'proposer.transport-offer',
        domainId: 'TRANSPORT',
        disposition: 'REJECTED_VALIDATION',
        evidenceRefs: ['ev-1'],
        validationReasonCodes: ['service_not_captured'],
        viabilityDecisionCodes: [],
        outcomeDelta: [],
      },
      {
        candidateKey: 'transport#1',
        proposerId: 'proposer.transport-offer',
        domainId: 'TRANSPORT',
        strategyRef: 's-viable-1',
        disposition: 'RECOMMENDED',
        evidenceRefs: ['ev-1'],
        validationReasonCodes: [],
        viability: 'VIABLE',
        viabilityDecisionCodes: [],
        immediateChangeBlastRadius: {
          changedRefs: [{ kind: 'JOURNEY_ITEM', id: 'item-1' }],
          directlyAffectedRefs: [{ kind: 'TRAVELLER', id: 'trav-1' }],
        },
        reassessmentClosure: { reachedRefs: [{ kind: 'JOURNEY', id: 'journey-1' }] },
        outcomeDelta: [
          { subjectRef: { kind: 'JOURNEY_ITEM', id: 'item-1' }, baseline: 'FAIL', candidate: 'PASS', delta: 'BETTER' },
        ],
      },
    ],
    viableStrategyRefs: ['s-viable-1'],
    recommendation: {
      recommendedStrategyRef: 's-viable-1',
      alternativeStrategyRefs: [],
      recommendationBasis: [{ code: 'lowest_total_cost', summary: 'Cheapest viable option', kind: 'DETERMINISTIC_FACT' }],
      tradeoffs: [],
      uncertainty: [],
      evidenceRefs: ['ev-1'],
      provenance: { kind: 'DETERMINISTIC', comparatorVersion: '1.0.0' },
    },
    ...overrides,
  });
}

const OUTCOME: RecoveryPlanningOutcome = 'AWAITING_AUTHORITY';

test('C9: the attempt projects into human-label-primary planning evidence', () => {
  const view = projectPlanningEvidence(attemptRecord(), OUTCOME);

  // Planning-time discriminator + evidence horizon (visibly NOT current state).
  assert.equal(view.phase, 'DECISION_TIME');
  assert.equal(view.asOf, NOW);
  assert.equal(view.attemptRef, 'attempt-1');

  // Q4 — domains investigated, human label primary, code secondary.
  assert.equal(view.domains.length, 2);
  const transport = view.domains.find((d) => d.domain.code === 'TRANSPORT');
  assert.equal(transport?.domain.label, 'Transport');
  assert.equal(transport?.disposition.label, 'Investigated');
  const programme = view.domains.find((d) => d.domain.code === 'PROGRAMME');
  assert.equal(programme?.disposition.label, 'Not applicable');
  assert.equal(programme?.reason, 'No programme dependency');

  // Q5 — read-only tool with provenance + uncertainty, humanized operation.
  assert.equal(view.tools.length, 1);
  assert.equal(view.tools[0]?.tool.label, 'Flight search');
  assert.equal(view.tools[0]?.status.label, 'Succeeded');
  assert.equal(view.tools[0]?.provenanceMode.label, 'Replayed recording');
  assert.deepEqual(view.tools[0]?.uncertainties, ['Fares may change before booking']);

  // Q9 — outcome + recommendation human labels.
  assert.equal(view.outcome.label, 'Awaiting operator authority');
  assert.equal(view.recommendation?.provenance.label, 'Deterministic comparator 1.0.0');
  assert.equal(view.recommendation?.basis[0]?.kind.label, 'Deterministic fact');
});

test('C9: material candidates keep rejection reasons + the three distinct impact semantics', () => {
  const view = projectPlanningEvidence(attemptRecord(), OUTCOME);
  assert.equal(view.candidates.length, 2);

  // Q6/Q7 — a rejected candidate explains itself in human terms, never via uuid.
  const rejected = view.candidates.find((c) => c.candidateKey === 'transport#0');
  assert.equal(rejected?.disposition.label, 'Rejected by validation');
  assert.deepEqual(rejected?.reasons, ['Service not captured']);
  assert.equal(rejected?.strategyRef, undefined);

  // The recommended candidate carries all three impact projections SEPARATELY.
  const recommended = view.candidates.find((c) => c.candidateKey === 'transport#1');
  assert.equal(recommended?.strategyRef, 's-viable-1');
  assert.deepEqual(recommended?.reasons, ['Viable']);
  // A. immediate change blast radius (changed vs directly affected).
  assert.deepEqual(recommended?.blastRadius?.changed, [{ label: 'Journey item', ref: 'JOURNEY_ITEM:item-1' }]);
  assert.deepEqual(recommended?.blastRadius?.directlyAffected, [{ label: 'Traveller', ref: 'TRAVELLER:trav-1' }]);
  // B. reassessment closure — the broader set RC-6 reevaluated, kept distinct.
  assert.deepEqual(recommended?.blastRadius?.reassessed, [{ label: 'Journey', ref: 'JOURNEY:journey-1' }]);
  // C. outcome delta — decision-time movement, humanized direction.
  assert.equal(recommended?.outcomeDelta[0]?.direction.label, 'Better');
  assert.equal(recommended?.outcomeDelta[0]?.baseline, 'FAIL');
  assert.equal(recommended?.outcomeDelta[0]?.candidate, 'PASS');
  assert.equal(recommended?.outcomeDelta[0]?.subject.ref, 'JOURNEY_ITEM:item-1');
});

test('C9: every primary explanation is a human label, never a bare uuid or code', () => {
  const view = projectPlanningEvidence(attemptRecord(), OUTCOME);
  // Q8 — viable strategy refs are labelled, not surfaced as a raw uuid alone.
  assert.equal(view.viableStrategies.length, 1);
  assert.equal(view.viableStrategies[0]?.label, 'Viable strategy option');
  assert.equal(view.viableStrategies[0]?.ref, 's-viable-1');
  // The recommendation names its strategy by label first.
  assert.equal(view.recommendation?.recommended.label, 'Recommended viable strategy');

  // No label anywhere is just an opaque uuid/code: every label has a space or is
  // a known multi-word phrase; raw machine tokens live only in ref/code fields.
  for (const domain of view.domains) {
    assert.match(domain.domain.label, /^[A-Z][A-Za-z]/);
    assert.match(domain.disposition.label, /^[A-Z][A-Za-z]/);
  }
});

test('C9: an attempt with no recommendation projects no recommendation block', () => {
  const noRec = attemptRecord({
    recommendation: undefined,
    viableStrategyRefs: [],
    materialCandidates: [],
  });
  const view = projectPlanningEvidence(noRec, 'NO_RECOVERY_FOUND');
  assert.equal(view.recommendation, undefined);
  assert.equal(view.outcome.label, 'No viable recovery found');
  assert.deepEqual(view.viableStrategies, []);
  assert.deepEqual(view.candidates, []);
});

test('C9: projectRecoveryCase spreads planning evidence only when an attempt exists', () => {
  const baseFacts = {
    generatedAt: NOW,
    projectionRevision: 1,
    changedVisibleRefs: [] as readonly string[],
    changedEdgeIds: [] as readonly string[],
    currentSemanticState: 'AFFECTED' as const,
    nodes: [],
    edges: [],
    caseRef: 'case-1',
    status: 'AWAITING_AUTHORITY' as const,
    changeSummary: 'A booked service changed.',
    bookingServiceState: { label: 'Booking', state: 'AFFECTED' as const },
    tripViability: { label: 'Remaining trip', verdict: 'FAIL' as const },
    authorityState: 'awaiting',
    executionState: 'idle',
    reconciliationState: 'idle',
  };

  // Without an attempt, the view carries NO planningEvidence (never fabricated).
  const withoutAttempt = projectRecoveryCase(baseFacts);
  assert.equal(withoutAttempt.planningEvidence, undefined);

  // With an attempt, the decision-time block appears alongside current state,
  // structurally distinguishable via phase/asOf.
  const withAttempt = projectRecoveryCase({
    ...baseFacts,
    planningAttempt: { attempt: attemptRecord(), outcome: OUTCOME },
  });
  assert.equal(withAttempt.planningEvidence?.phase, 'DECISION_TIME');
  assert.equal(withAttempt.planningEvidence?.asOf, NOW);
  // Current authoritative state is untouched and remains separate.
  assert.equal(withAttempt.tripViability.verdict, 'FAIL');
  assert.equal(withAttempt.status, 'AWAITING_AUTHORITY');
  assert.equal(withAttempt.planningEvidence?.domains.length, 2);
});

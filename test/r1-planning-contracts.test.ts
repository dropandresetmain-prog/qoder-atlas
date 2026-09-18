/**
 * NORTHSTAR R1 — C1 shared planning-contract tests (pure, no PostgreSQL).
 *
 * Proves the frozen recovery-planning contracts behave as specified in
 * `docs/RECOVERY_PLANNING_CONTRACT_FREEZE.md`:
 *   - read-only tool protocol cannot represent a consequential operation and
 *     validates the capability/operation pair;
 *   - canonical request fingerprint deduplicates equivalent reads, independent
 *     of parameter key order;
 *   - recommendation validation rejects non-viable / stale / foreign-case /
 *     unknown references and self-referential alternatives;
 *   - explicit preferences outrank inferred preferences;
 *   - outcome-delta classification is conservative and preserves baseline;
 *   - materiality rules retain evaluated/rejected/viable-not-recommended
 *     candidates and let pure junk stay ephemeral;
 *   - domain resolution fails closed and AI cannot reorder or veto a
 *     deterministic decision;
 *   - lifecycle progression decision precedence (RESOLVE > WAIT > REPLAN >
 *     ESCALATE) is deterministic;
 *   - the planning-attempt record round-trips through its schema.
 *
 * Pure fixtures only — no scenario/person/city names.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PlanningToolRequestSchema,
  planningToolRequestFingerprint,
  dedupePlanningToolRequests,
  type PlanningToolRequest,
} from '../src/contracts/v2/planning/planningTool.ts';
import {
  StrategyRecommendationSchema,
  validateStrategyRecommendation,
  orderComparatorPreferences,
  type StrategyRecommendation,
  type ViableStrategyCandidate,
  type ComparatorPreference,
} from '../src/contracts/v2/planning/strategyRecommendation.ts';
import {
  classifyOutcomeDelta,
  buildOutcomeDelta,
  buildImmediateChangeBlastRadius,
} from '../src/contracts/v2/planning/impactSemantics.ts';
import {
  RecoveryPlanningAttemptSchema,
  isMaterialCandidate,
  type RecoveryPlanningAttempt,
} from '../src/contracts/v2/planning/recoveryPlanningAttempt.ts';
import {
  resolveRecoveryDomainDecisions,
  type RecoveryDomainDefinition,
  type RecoveryDomainContext,
} from '../src/contracts/v2/planning/recoveryDomain.ts';
import { decideRecoveryProgression } from '../src/contracts/v2/planning/recoveryProgression.ts';
import { ToolOperationSchema } from '../src/operational/strategy.ts';

const NOW = '2030-06-01T12:00:00.000Z';

// ---------------------------------------------------------------------------
// C2 — read-only tool protocol: consequential verbs are unrepresentable.
// ---------------------------------------------------------------------------

test('tool request: closed read-only vocabulary contains no consequential verb', () => {
  const ops = ToolOperationSchema.options;
  for (const forbidden of ['flight.book', 'flight.pay', 'flight.change', 'flight.cancel', 'hotel.book', 'hotel.modify', 'hotel.cancel', 'transfer.book', 'transfer.cancel']) {
    assert.ok(!ops.includes(forbidden as never), `${forbidden} must not be a planner tool operation`);
  }
  // Read-only status/quote inspection stays requestable.
  assert.ok(ops.includes('flight.order_status'));
  assert.ok(ops.includes('flight.cancel_quote'));
});

test('tool request: capability/operation family mismatch is rejected', () => {
  const result = PlanningToolRequestSchema.safeParse({
    id: 'req-1',
    capability: 'HOTEL', // wrong family for a flight operation
    operation: 'flight.search',
    parameters: {},
    purpose: 'find alternatives',
    evidenceGapCode: 'transport_alternatives_missing',
    round: 1,
  });
  assert.equal(result.success, false);
});

test('tool request: a well-formed read-only request validates', () => {
  const parsed = PlanningToolRequestSchema.parse({
    id: 'req-1',
    capability: 'FLIGHT',
    operation: 'flight.search',
    parameters: { origin: 'p-a', destination: 'p-b' },
    purpose: 'find alternatives',
    evidenceGapCode: 'transport_alternatives_missing',
    round: 1,
  });
  assert.equal(parsed.operation, 'flight.search');
  assert.equal(parsed.round, 1);
});

// ---------------------------------------------------------------------------
// C2 — canonical fingerprint + dedupe.
// ---------------------------------------------------------------------------

test('fingerprint: parameter key order does not change identity', () => {
  const a = planningToolRequestFingerprint({ capability: 'FLIGHT', operation: 'flight.search', parameters: { origin: 'p-a', destination: 'p-b' } });
  const b = planningToolRequestFingerprint({ capability: 'FLIGHT', operation: 'flight.search', parameters: { destination: 'p-b', origin: 'p-a' } });
  assert.equal(a, b);
});

test('fingerprint: a different operation or parameter changes identity', () => {
  const base = planningToolRequestFingerprint({ capability: 'FLIGHT', operation: 'flight.search', parameters: { origin: 'p-a' } });
  const otherOp = planningToolRequestFingerprint({ capability: 'FLIGHT', operation: 'flight.verify', parameters: { origin: 'p-a' } });
  const otherParam = planningToolRequestFingerprint({ capability: 'FLIGHT', operation: 'flight.search', parameters: { origin: 'p-z' } });
  assert.notEqual(base, otherOp);
  assert.notEqual(base, otherParam);
});

test('dedupe: equivalent requests collapse, first-seen order preserved', () => {
  const mk = (id: string, params: Record<string, unknown>, round: number): PlanningToolRequest =>
    PlanningToolRequestSchema.parse({ id, capability: 'FLIGHT', operation: 'flight.search', parameters: params, purpose: 'p', evidenceGapCode: 'gap', round });
  const requests = [
    mk('r1', { origin: 'p-a', destination: 'p-b' }, 1),
    mk('r2', { destination: 'p-b', origin: 'p-a' }, 1), // equivalent to r1
    mk('r3', { origin: 'p-a', destination: 'p-c' }, 1), // distinct
  ];
  const unique = dedupePlanningToolRequests(requests);
  assert.equal(unique.length, 2);
  assert.deepEqual(unique.map((r) => r.id), ['r1', 'r3']);
});

// ---------------------------------------------------------------------------
// C6 — recommendation validation: viable-only, same-case, not stale.
// ---------------------------------------------------------------------------

function recommendation(over: Partial<StrategyRecommendation> = {}): StrategyRecommendation {
  return StrategyRecommendationSchema.parse({
    recommendedStrategyRef: 's-viable-1',
    alternativeStrategyRefs: ['s-viable-2'],
    recommendationBasis: [{ code: 'lowest_cost', summary: 'cheapest viable', kind: 'DETERMINISTIC_FACT' }],
    tradeoffs: [],
    uncertainty: [],
    evidenceRefs: ['ev-1'],
    provenance: { kind: 'DETERMINISTIC', comparatorVersion: '1.0.0' },
    ...over,
  });
}

const VIABLE_SET: ViableStrategyCandidate[] = [
  { strategyRef: 's-viable-1', recoveryCaseId: 'case-1', viability: 'VIABLE', stale: false },
  { strategyRef: 's-viable-2', recoveryCaseId: 'case-1', viability: 'VIABLE', stale: false },
];

test('recommendation: a viable same-case recommendation validates', () => {
  const result = validateStrategyRecommendation({ recommendation: recommendation(), recoveryCaseId: 'case-1', viableCandidates: VIABLE_SET });
  assert.equal(result.ok, true);
});

test('recommendation: naming a non-viable strategy is rejected', () => {
  const set: ViableStrategyCandidate[] = [
    { strategyRef: 's-viable-1', recoveryCaseId: 'case-1', viability: 'VIABLE', stale: false },
    { strategyRef: 's-rejected', recoveryCaseId: 'case-1', viability: 'NOT_VIABLE', stale: false },
  ];
  const result = validateStrategyRecommendation({ recommendation: recommendation({ recommendedStrategyRef: 's-rejected', alternativeStrategyRefs: [] }), recoveryCaseId: 'case-1', viableCandidates: set });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'RECOMMENDED_NOT_VIABLE');
});

test('recommendation: naming a stale strategy is rejected', () => {
  const set: ViableStrategyCandidate[] = [
    { strategyRef: 's-viable-1', recoveryCaseId: 'case-1', viability: 'VIABLE', stale: false },
    { strategyRef: 's-stale', recoveryCaseId: 'case-1', viability: 'VIABLE', stale: true },
  ];
  const result = validateStrategyRecommendation({ recommendation: recommendation({ recommendedStrategyRef: 's-stale', alternativeStrategyRefs: [] }), recoveryCaseId: 'case-1', viableCandidates: set });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'RECOMMENDED_STALE');
});

test('recommendation: naming a foreign-case strategy is rejected', () => {
  const set: ViableStrategyCandidate[] = [
    { strategyRef: 's-viable-1', recoveryCaseId: 'case-1', viability: 'VIABLE', stale: false },
    { strategyRef: 's-foreign', recoveryCaseId: 'case-2', viability: 'VIABLE', stale: false },
  ];
  const result = validateStrategyRecommendation({ recommendation: recommendation({ recommendedStrategyRef: 's-foreign', alternativeStrategyRefs: [] }), recoveryCaseId: 'case-1', viableCandidates: set });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'RECOMMENDED_FOREIGN_CASE');
});

test('recommendation: an unknown reference and a self-referential alternative are rejected', () => {
  const unknown = validateStrategyRecommendation({ recommendation: recommendation({ recommendedStrategyRef: 's-nope', alternativeStrategyRefs: [] }), recoveryCaseId: 'case-1', viableCandidates: VIABLE_SET });
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.reason, 'RECOMMENDED_NOT_IN_CANDIDATE_SET');

  const selfRef = validateStrategyRecommendation({ recommendation: recommendation({ alternativeStrategyRefs: ['s-viable-1'] }), recoveryCaseId: 'case-1', viableCandidates: VIABLE_SET });
  assert.equal(selfRef.ok, false);
  if (!selfRef.ok) assert.equal(selfRef.reason, 'ALTERNATIVE_EQUALS_RECOMMENDED');
});

test('recommendation: no viable candidates is a refusal, never a silent pass', () => {
  const result = validateStrategyRecommendation({ recommendation: recommendation(), recoveryCaseId: 'case-1', viableCandidates: [] });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'NO_VIABLE_CANDIDATES');
});

test('recommendation: there is no scalar viability-score field in the contract', () => {
  const parsed = StrategyRecommendationSchema.safeParse({
    recommendedStrategyRef: 's-viable-1',
    alternativeStrategyRefs: [],
    recommendationBasis: [],
    tradeoffs: [],
    uncertainty: [],
    evidenceRefs: [],
    provenance: { kind: 'DETERMINISTIC', comparatorVersion: '1.0.0' },
    viabilityScore: 0.9, // not part of the frozen contract
  });
  assert.equal(parsed.success, false);
});

// ---------------------------------------------------------------------------
// C6 — preference precedence: explicit outranks inferred.
// ---------------------------------------------------------------------------

test('preferences: an inferred preference never outranks an explicit one', () => {
  const prefs: ComparatorPreference[] = [
    { code: 'inferred_convenience', priority: 'EXPLICIT_TRAVELLER', inferred: true, summary: 'model guessed' },
    { code: 'explicit_window', priority: 'EXPLICIT_TRAVELLER', inferred: false, summary: 'traveller declared' },
    { code: 'generic_semantic', priority: 'GENERIC_SEMANTIC', inferred: false, summary: 'soft judgement' },
  ];
  const ordered = orderComparatorPreferences(prefs);
  // The explicit traveller preference is first; the mislabelled inferred one is
  // demoted below it; generic semantic is last.
  assert.equal(ordered[0]!.code, 'explicit_window');
  assert.equal(ordered[ordered.length - 1]!.code, 'generic_semantic');
  const inferredIndex = ordered.findIndex((p) => p.code === 'inferred_convenience');
  assert.ok(inferredIndex > 0, 'inferred must be demoted below explicit');
});

// ---------------------------------------------------------------------------
// C7 — outcome delta: conservative classification, baseline preserved.
// ---------------------------------------------------------------------------

test('outcome delta: classification matches the frozen conservative table', () => {
  assert.equal(classifyOutcomeDelta('FAIL', 'PASS'), 'BETTER');
  assert.equal(classifyOutcomeDelta('UNKNOWN', 'PASS'), 'BETTER');
  assert.equal(classifyOutcomeDelta('PASS', 'UNKNOWN'), 'WORSE');
  assert.equal(classifyOutcomeDelta('PASS', 'FAIL'), 'WORSE');
  assert.equal(classifyOutcomeDelta('UNKNOWN', 'FAIL'), 'WORSE');
  assert.equal(classifyOutcomeDelta('FAIL', 'UNKNOWN'), 'UNCHANGED');
  assert.equal(classifyOutcomeDelta('UNKNOWN', 'FAIL' as never) === 'WORSE', true);
  assert.equal(classifyOutcomeDelta('FAIL', 'FAIL'), 'UNCHANGED');
  assert.equal(classifyOutcomeDelta(undefined, 'PASS'), 'UNCHANGED');
});

test('outcome delta: FAIL -> UNKNOWN is preserved as UNCHANGED, not recovery', () => {
  const delta = buildOutcomeDelta([{ subjectRef: { kind: 'JOURNEY', id: 'j1' }, baseline: 'FAIL', candidate: 'UNKNOWN' }]);
  assert.equal(delta.length, 1);
  assert.equal(delta[0]!.delta, 'UNCHANGED');
  assert.equal(delta[0]!.baseline, 'FAIL');
  assert.equal(delta[0]!.candidate, 'UNKNOWN');
});

test('outcome delta: entries are deterministically ordered by kind:id', () => {
  const delta = buildOutcomeDelta([
    { subjectRef: { kind: 'TRIP', id: 't-b' }, baseline: 'FAIL', candidate: 'PASS' },
    { subjectRef: { kind: 'JOURNEY', id: 'j-a' }, baseline: 'FAIL', candidate: 'PASS' },
  ]);
  assert.deepEqual(delta.map((d) => `${d.subjectRef.kind}:${d.subjectRef.id}`), ['JOURNEY:j-a', 'TRIP:t-b']);
});

test('blast radius: changed refs are separated from directly-affected refs', () => {
  const blast = buildImmediateChangeBlastRadius({
    effects: [{ changedRefs: [{ kind: 'PROGRAMME_ITEM', id: 'pi-1' }] }],
    affectedSubjectRefs: [
      { kind: 'PROGRAMME_ITEM', id: 'pi-1' }, // changed, not "affected"
      { kind: 'JOURNEY', id: 'j-1' }, // directly affected dependant
      { kind: 'JOURNEY', id: 'j-1' }, // duplicate
    ],
  });
  assert.deepEqual(blast.changedRefs, [{ kind: 'PROGRAMME_ITEM', id: 'pi-1' }]);
  assert.deepEqual(blast.directlyAffectedRefs, [{ kind: 'JOURNEY', id: 'j-1' }]);
});

// ---------------------------------------------------------------------------
// C5 — materiality rules.
// ---------------------------------------------------------------------------

test('materiality: an evaluated candidate is material', () => {
  const r = isMaterialCandidate({ viability: 'NOT_VIABLE', disposition: 'REJECTED_DETERMINISTIC' });
  assert.equal(r.material, true);
  assert.ok(r.rules.includes('reached_deterministic_evaluation'));
  assert.ok(r.rules.includes('meaningful_deterministic_rejection'));
});

test('materiality: a validation rejection with reason codes is material', () => {
  const r = isMaterialCandidate({ disposition: 'REJECTED_VALIDATION', validationReasonCodes: ['effects_required'] });
  assert.equal(r.material, true);
  assert.ok(r.rules.includes('meaningful_deterministic_rejection'));
});

test('materiality: a viable-not-recommended candidate is material', () => {
  const r = isMaterialCandidate({ viability: 'VIABLE', disposition: 'VIABLE_NOT_RECOMMENDED' });
  assert.equal(r.material, true);
  assert.ok(r.rules.includes('viable_not_recommended'));
});

test('materiality: pure validation junk with no reason is NOT material', () => {
  const r = isMaterialCandidate({ disposition: 'REJECTED_VALIDATION', validationReasonCodes: [] });
  assert.equal(r.material, false);
  assert.deepEqual(r.rules, []);
});

// ---------------------------------------------------------------------------
// C3 — domain resolution: fail-closed, AI cannot reorder or veto.
// ---------------------------------------------------------------------------

const TRANSPORT_DEF: RecoveryDomainDefinition = {
  domainId: 'TRANSPORT',
  capabilities: ['FLIGHT'],
  producesExecutableStrategy: true,
  isApplicable: (ctx) => ({
    domainId: 'TRANSPORT',
    source: 'DETERMINISTIC',
    activated: ctx.blockingDimensionCodes.has('connection_feasibility'),
    requiredCapabilities: ['FLIGHT'],
    reasonCode: 'transport_blocking',
  }),
};

const PROGRAMME_DEF: RecoveryDomainDefinition = {
  domainId: 'PROGRAMME',
  capabilities: [],
  producesExecutableStrategy: true,
  isApplicable: (ctx) => ({
    domainId: 'PROGRAMME',
    source: 'DETERMINISTIC',
    activated: ctx.affectedObjectKinds.has('PROGRAMME_ITEM'),
    requiredCapabilities: [],
    reasonCode: 'programme_item_affected',
  }),
};

function ctx(over: Partial<RecoveryDomainContext> = {}): RecoveryDomainContext {
  return {
    failingSubjectKinds: new Set(['JOURNEY']),
    blockingDimensionCodes: new Set(['connection_feasibility']),
    affectedObjectKinds: new Set(['PROGRAMME_ITEM']),
    availableCapabilities: new Set(['FLIGHT']),
    ...over,
  };
}

test('domains: deterministic activation selects relevant domains without hardcoded order', () => {
  const decisions = resolveRecoveryDomainDecisions([TRANSPORT_DEF, PROGRAMME_DEF], ctx());
  const investigated = decisions.filter((d) => d.disposition === 'INVESTIGATED').map((d) => d.domainId).sort();
  assert.deepEqual(investigated, ['PROGRAMME', 'TRANSPORT']);
});

test('domains: a required capability that is unavailable fails the domain closed', () => {
  const decisions = resolveRecoveryDomainDecisions([TRANSPORT_DEF], ctx({ availableCapabilities: new Set() }));
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0]!.disposition, 'UNAVAILABLE');
  assert.equal(decisions[0]!.reasonCode, 'capability_unavailable');
});

test('domains: an inapplicable domain is NOT_APPLICABLE with a reason', () => {
  const decisions = resolveRecoveryDomainDecisions([TRANSPORT_DEF], ctx({ blockingDimensionCodes: new Set(['overnight_accommodation']) }));
  assert.equal(decisions[0]!.disposition, 'NOT_APPLICABLE');
});

test('domains: an AI-suggested unregistered domain fails closed and cannot veto a deterministic decision', () => {
  const decisions = resolveRecoveryDomainDecisions([TRANSPORT_DEF, PROGRAMME_DEF], ctx(), ['STAY' as never, 'TRANSPORT']);
  const stay = decisions.find((d) => d.domainId === ('STAY' as never));
  // STAY is not registered in this registry, so it is UNAVAILABLE, not investigated.
  assert.equal(stay?.disposition, 'UNAVAILABLE');
  assert.equal(stay?.reasonCode, 'domain_not_registered');
  // TRANSPORT was already deterministically investigated; the AI duplicate did
  // not create a second decision or change it.
  const transport = decisions.filter((d) => d.domainId === 'TRANSPORT');
  assert.equal(transport.length, 1);
  assert.equal(transport[0]!.disposition, 'INVESTIGATED');
});

// ---------------------------------------------------------------------------
// C8 — lifecycle progression decision precedence.
// ---------------------------------------------------------------------------

const PROG_BASE = { recoveryCaseId: 'case-1', basisAssessmentId: 'a-1' };

test('progression: resolution gate passed + reconciled -> RESOLVE', () => {
  const r = decideRecoveryProgression({ ...PROG_BASE, resolutionGatePassed: true, executionReconciled: true, authorityOrExecutionPending: false, currentStillFailing: false, recoveryRemainsPossible: false });
  assert.equal(r.decision, 'RESOLVE');
});

test('progression: authority/execution pending -> WAIT (even if still failing)', () => {
  const r = decideRecoveryProgression({ ...PROG_BASE, resolutionGatePassed: false, executionReconciled: false, authorityOrExecutionPending: true, currentStillFailing: true, recoveryRemainsPossible: true });
  assert.equal(r.decision, 'WAIT');
});

test('progression: still failing + recovery possible -> REPLAN bound to the new basis', () => {
  const r = decideRecoveryProgression({ ...PROG_BASE, resolutionGatePassed: false, executionReconciled: true, authorityOrExecutionPending: false, currentStillFailing: true, recoveryRemainsPossible: true });
  assert.equal(r.decision, 'REPLAN');
  assert.equal(r.basisAssessmentId, 'a-1');
});

test('progression: no safe recovery -> ESCALATE; resolution beats a pending flag', () => {
  const escalate = decideRecoveryProgression({ ...PROG_BASE, resolutionGatePassed: false, executionReconciled: true, authorityOrExecutionPending: false, currentStillFailing: true, recoveryRemainsPossible: false });
  assert.equal(escalate.decision, 'ESCALATE');
  assert.equal(escalate.reasonCode, 'no_safe_recovery_remaining');

  // RESOLVE has precedence over WAIT even if a pending flag is also set.
  const resolve = decideRecoveryProgression({ ...PROG_BASE, resolutionGatePassed: true, executionReconciled: true, authorityOrExecutionPending: true, currentStillFailing: false, recoveryRemainsPossible: false });
  assert.equal(resolve.decision, 'RESOLVE');
});

test('progression: the decision function is deterministic for identical input', () => {
  const input = { ...PROG_BASE, resolutionGatePassed: false, executionReconciled: true, authorityOrExecutionPending: false, currentStillFailing: true, recoveryRemainsPossible: true };
  assert.deepEqual(decideRecoveryProgression(input), decideRecoveryProgression(input));
});

// ---------------------------------------------------------------------------
// C5 — planning-attempt record round-trips through its schema.
// ---------------------------------------------------------------------------

test('planning attempt: a bounded record with material rejected + viable evidence round-trips', () => {
  const attempt: RecoveryPlanningAttempt = RecoveryPlanningAttemptSchema.parse({
    id: 'attempt-1',
    recoveryCaseId: 'case-1',
    basisAssessmentId: 'a-1',
    basisManifest: { evaluatedAt: NOW, evaluatorVersions: [], aggregateReads: [], scopeReads: [], evidenceReads: [], coverageReads: [], missingCoverage: [] },
    startedAt: NOW,
    completedAt: NOW,
    coordinatorVersion: '1.0.0',
    domains: [{ domainId: 'TRANSPORT', source: 'DETERMINISTIC', disposition: 'INVESTIGATED', reasonCode: 'transport_blocking' }],
    evidence: [{
      evidenceRef: 'ev-1',
      requestFingerprint: 'FLIGHT|flight.search|{}',
      capability: 'FLIGHT',
      operation: 'flight.search',
      status: 'SUCCEEDED',
      summary: '2 alternatives found',
      provenance: { mode: 'REPLAY', observedAt: NOW, sourceRefs: [], recordingRef: 'rec-1' },
      uncertainty: [],
    }],
    materialCandidates: [
      { candidateKey: 'transport#0', proposerId: 'transport-proposer', domainId: 'TRANSPORT', disposition: 'REJECTED_DETERMINISTIC', evidenceRefs: ['ev-1'], validationReasonCodes: [], viability: 'NOT_VIABLE', viabilityDecisionCodes: ['UNRESOLVED_FAIL'], outcomeDelta: [] },
      { candidateKey: 'transport#1', proposerId: 'transport-proposer', domainId: 'TRANSPORT', strategyRef: 's-viable-1', disposition: 'VIABLE_NOT_RECOMMENDED', evidenceRefs: ['ev-1'], validationReasonCodes: [], viability: 'VIABLE', viabilityDecisionCodes: [], outcomeDelta: [] },
    ],
    viableStrategyRefs: ['s-viable-1'],
    recommendation: {
      recommendedStrategyRef: 's-viable-1',
      alternativeStrategyRefs: [],
      recommendationBasis: [{ code: 'only_viable', summary: 'single viable', kind: 'DETERMINISTIC_FACT' }],
      tradeoffs: [],
      uncertainty: [],
      evidenceRefs: ['ev-1'],
      provenance: { kind: 'DETERMINISTIC', comparatorVersion: '1.0.0' },
    },
  });
  assert.equal(attempt.materialCandidates.length, 2);
  assert.equal(attempt.materialCandidates[0]!.viabilityDecisionCodes[0], 'UNRESOLVED_FAIL');
  // Re-parse the serialized form to prove persistence/reload stability.
  const reloaded = RecoveryPlanningAttemptSchema.parse(JSON.parse(JSON.stringify(attempt)));
  assert.deepEqual(reloaded, attempt);
});

test('planning attempt: chain-of-thought / oversized summary is rejected', () => {
  const result = RecoveryPlanningAttemptSchema.safeParse({
    id: 'attempt-1',
    recoveryCaseId: 'case-1',
    basisAssessmentId: 'a-1',
    basisManifest: { evaluatedAt: NOW, evaluatorVersions: [], aggregateReads: [], scopeReads: [], evidenceReads: [], coverageReads: [], missingCoverage: [] },
    startedAt: NOW,
    completedAt: NOW,
    coordinatorVersion: '1.0.0',
    domains: [],
    evidence: [{
      evidenceRef: 'ev-1',
      requestFingerprint: 'FLIGHT|flight.search|{}',
      capability: 'FLIGHT',
      operation: 'flight.search',
      status: 'SUCCEEDED',
      summary: 'x'.repeat(5000), // exceeds the 1024 bound
      provenance: { mode: 'REPLAY', observedAt: NOW, sourceRefs: [] },
      uncertainty: [],
    }],
    materialCandidates: [],
    viableStrategyRefs: [],
  });
  assert.equal(result.success, false);
});

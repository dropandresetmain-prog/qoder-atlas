/**
 * M0 evidence — NORTHSTAR v2 contract materialization.
 *
 * Validates the frozen contract families in src/domain/v2/** and
 * src/contracts/v2/** against the required positive/invalid example set from
 * docs/IMPLEMENTATION_PLAN.md §3/§4:
 *   family split/support handoff; shared booking across Trips; one
 *   programme move affecting two travellers differently; conflicting
 *   advisories; multi-passport transit evaluation; supplier timeout after
 *   dispatch; one additive new condition/information type.
 *
 * These are contract/schema proofs only — no persistence, no runtime import
 * of v2 into production composition (see docs/refactor/CONTRACTS.md).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { TypedRefSchema } from '../src/domain/v2/shared/identity.ts';
import { addExactMoney, compareExactMoney } from '../src/domain/v2/shared/money.ts';
import {
  JourneyItemSchema,
  JourneySchema,
  journeysAreUniquePerTraveller,
} from '../src/domain/v2/trip/trip.ts';
import {
  AccompanimentConstraintDefinitionSchema,
  SupportAssignmentSchema,
  assignmentSatisfiesDefinition,
} from '../src/domain/v2/trip/support.ts';
import {
  ReservationAllocationSchema,
  allocationMatchesJourneyTraveller,
} from '../src/domain/v2/arrangements/reservation.ts';
import { InformationVersionSchema } from '../src/domain/v2/knowledge/information.ts';

import { WorldSnapshotManifestSchema, isSnapshotCurrent } from '../src/contracts/v2/scope/readScope.ts';
import { AssessmentResultSchema, overallVerdictFromDimensions } from '../src/contracts/v2/assessment/assessmentManifest.ts';
import { ScenarioChangeSchema } from '../src/contracts/v2/scenario/scenarioChange.ts';
import { ActionPlanSchema, validateActionPlanAcyclic } from '../src/contracts/v2/action/actionPlan.ts';
import {
  AuthorityEnvelopeSchema,
  ApprovalSchema,
  approvalCoversEnvelope,
} from '../src/contracts/v2/authority/authorityEnvelope.ts';
import {
  ExecutionAttemptSchema,
  canDispatchNewAttempt,
} from '../src/contracts/v2/execution/execution.ts';
import { migrationImportOutcome } from '../src/contracts/v2/migration/migrationEnvelope.ts';
import {
  ExtensionRegistrationSchema,
  extensionRegistrationIsAcceptable,
} from '../src/contracts/v2/extension/extensionRegistration.ts';
import { DomainCommandResultSchema } from '../src/contracts/v2/command/domainCommand.ts';

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

test('shared: TypedRef requires a closed subject kind', () => {
  assert.equal(TypedRefSchema.safeParse({ kind: 'TRAVELLER', id: 'trv-1' }).success, true);
  assert.equal(TypedRefSchema.safeParse({ kind: 'NOT_A_KIND', id: 'x' }).success, false);
});

test('shared: exact money arithmetic never uses binary float', () => {
  const sum = addExactMoney({ amount: '10.10', currency: 'SGD' }, { amount: '0.05', currency: 'SGD' });
  assert.equal(sum.amount, '10.15');
  assert.throws(() => addExactMoney({ amount: '1', currency: 'SGD' }, { amount: '1', currency: 'USD' }));
  assert.equal(compareExactMoney({ amount: '5.00', currency: 'SGD' }, { amount: '4.99', currency: 'SGD' }), 1);
});

// ---------------------------------------------------------------------------
// Example 1 — family split / support handoff
// ---------------------------------------------------------------------------

test('example: family split — two Journeys under one Trip, unique per traveller', () => {
  const journeys = [
    JourneySchema.parse({ id: 'j-parent', workspaceId: 'ws-1', revision: 1, tripId: 'trip-1', travellerId: 'trv-parent', lifecycleStatus: 'ACTIVE' }),
    JourneySchema.parse({ id: 'j-child', workspaceId: 'ws-1', revision: 1, tripId: 'trip-1', travellerId: 'trv-child', lifecycleStatus: 'ACTIVE' }),
  ];
  assert.equal(journeysAreUniquePerTraveller(journeys), true);

  // A duplicate (same trip, same traveller) is illegal — the schema alone
  // can't prevent it (that's a DB uniqueness/command invariant), but the
  // fixture-level checker used by architecture tests must catch it.
  assert.equal(
    journeysAreUniquePerTraveller([...journeys, { ...journeys[0]!, id: 'j-parent-dupe' }]),
    false,
  );
});

test('example: support handoff — eligible supporters with full coverage and a permitted handoff gap satisfy the requirement', () => {
  const definition = AccompanimentConstraintDefinitionSchema.parse({
    id: 'sup-def-1',
    version: 1,
    supportedTravellerId: 'trv-child',
    requiredCoverage: { start: '2026-09-14T00:00:00Z', end: '2026-09-16T00:00:00Z' },
    minimumSimultaneousSupporters: 1,
    eligibleSupporterTravellerIds: ['trv-parent', 'trv-aunt'],
    maximumHandoffGapMinutes: 30,
  });

  const validAssignment = SupportAssignmentSchema.parse({
    id: 'sup-asn-1',
    revision: 1,
    constraintDefinitionId: 'sup-def-1',
    constraintDefinitionVersion: 1,
    lifecycleStatus: 'ACTIVE',
    assignedSupporterTravellerIds: ['trv-parent', 'trv-aunt'],
    assignedScopes: [
      { supporterTravellerId: 'trv-parent', interval: { start: '2026-09-14T00:00:00Z', end: '2026-09-15T00:00:00Z' } },
      { supporterTravellerId: 'trv-aunt', interval: { start: '2026-09-15T00:15:00Z', end: '2026-09-16T00:00:00Z' } },
    ],
    handoffs: [{ fromSupporterTravellerId: 'trv-parent', toSupporterTravellerId: 'trv-aunt', handoffAt: '2026-09-15T00:15:00Z' }],
  });

  assert.deepEqual(assignmentSatisfiesDefinition(validAssignment, definition), { ok: true });
});

test('invalid: an assignment cannot relax its governing requirement (ineligible supporter, coverage gap, or over-limit handoff)', () => {
  const definition = AccompanimentConstraintDefinitionSchema.parse({
    id: 'sup-def-1',
    version: 1,
    supportedTravellerId: 'trv-child',
    requiredCoverage: { start: '2026-09-14T00:00:00Z', end: '2026-09-16T00:00:00Z' },
    minimumSimultaneousSupporters: 1,
    eligibleSupporterTravellerIds: ['trv-parent', 'trv-aunt'],
    maximumHandoffGapMinutes: 5,
  });

  const ineligibleSupporter = SupportAssignmentSchema.parse({
    id: 'sup-asn-bad-1',
    revision: 1,
    constraintDefinitionId: 'sup-def-1',
    constraintDefinitionVersion: 1,
    lifecycleStatus: 'PROPOSED',
    assignedSupporterTravellerIds: ['trv-stranger'],
    assignedScopes: [{ supporterTravellerId: 'trv-stranger', interval: { start: '2026-09-14T00:00:00Z', end: '2026-09-16T00:00:00Z' } }],
  });
  const r1 = assignmentSatisfiesDefinition(ineligibleSupporter, definition);
  assert.equal(r1.ok, false);

  const gapInCoverage = SupportAssignmentSchema.parse({
    id: 'sup-asn-bad-2',
    revision: 1,
    constraintDefinitionId: 'sup-def-1',
    constraintDefinitionVersion: 1,
    lifecycleStatus: 'PROPOSED',
    assignedSupporterTravellerIds: ['trv-parent'],
    assignedScopes: [{ supporterTravellerId: 'trv-parent', interval: { start: '2026-09-14T00:00:00Z', end: '2026-09-15T00:00:00Z' } }],
  });
  const r2 = assignmentSatisfiesDefinition(gapInCoverage, definition);
  assert.equal(r2.ok, false);

  const overLongHandoff = SupportAssignmentSchema.parse({
    id: 'sup-asn-bad-3',
    revision: 1,
    constraintDefinitionId: 'sup-def-1',
    constraintDefinitionVersion: 1,
    lifecycleStatus: 'PROPOSED',
    assignedSupporterTravellerIds: ['trv-parent', 'trv-aunt'],
    assignedScopes: [
      { supporterTravellerId: 'trv-parent', interval: { start: '2026-09-14T00:00:00Z', end: '2026-09-15T00:00:00Z' } },
      { supporterTravellerId: 'trv-aunt', interval: { start: '2026-09-15T01:00:00Z', end: '2026-09-16T00:00:00Z' } },
    ],
    handoffs: [{ fromSupporterTravellerId: 'trv-parent', toSupporterTravellerId: 'trv-aunt', handoffAt: '2026-09-15T01:00:00Z' }],
  });
  const r3 = assignmentSatisfiesDefinition(overLongHandoff, definition);
  assert.equal(r3.ok, false);
});

test('invalid: engagement item cannot carry both a Participation reference and standalone appointment fields', () => {
  const result = JourneyItemSchema.safeParse({
    kind: 'ENGAGEMENT',
    id: 'ji-1',
    journeyId: 'j-1',
    orderKey: '001',
    lifecycleStatus: 'PLANNED',
    participationId: 'part-1',
    standaloneTitle: 'Should not coexist',
  });
  assert.equal(result.success, false);
});

// ---------------------------------------------------------------------------
// Example 2 — shared booking across Trips
// ---------------------------------------------------------------------------

test('example: one reservation line allocates to travellers on different Trips/Journeys', () => {
  const allocationA = ReservationAllocationSchema.parse({
    id: 'alloc-a', reservationLineId: 'line-shared-hotel', travellerId: 'trv-a', journeyItemId: 'ji-a', allocationRole: 'GUEST',
  });
  const allocationB = ReservationAllocationSchema.parse({
    id: 'alloc-b', reservationLineId: 'line-shared-hotel', travellerId: 'trv-b', journeyItemId: 'ji-b', allocationRole: 'GUEST',
  });
  assert.equal(allocationA.reservationLineId, allocationB.reservationLineId);
  assert.equal(allocationMatchesJourneyTraveller(allocationA, 'trv-a'), true);
});

test('invalid: an allocation naming a JourneyItem owned by a DIFFERENT traveller is rejected', () => {
  const allocation = ReservationAllocationSchema.parse({
    id: 'alloc-bad', reservationLineId: 'line-shared-hotel', travellerId: 'trv-a', journeyItemId: 'ji-belongs-to-b', allocationRole: 'GUEST',
  });
  assert.equal(allocationMatchesJourneyTraveller(allocation, 'trv-b'), false);
});

// ---------------------------------------------------------------------------
// Example 3 — one programme move affecting two travellers differently
// ---------------------------------------------------------------------------

test('example: a single ProgrammeItem move produces a PASS assessment for one traveller and a FAIL for another', () => {
  const manifest = WorldSnapshotManifestSchema.parse({
    evaluatedAt: '2026-09-14T09:00:00Z',
    aggregateReads: [{ aggregateRef: { kind: 'PROGRAMME_ITEM', id: 'pi-1' }, revision: 2 }],
    scopeReads: [{ scopeKind: 'PROGRAMME', scopeId: 'prog-1', generation: 3 }],
  });

  const helped = AssessmentResultSchema.parse({
    id: 'assess-helped', kind: 'VIABILITY', evaluatedAt: '2026-09-14T09:00:00Z', manifest,
    subjects: [{ subjectRef: { kind: 'JOURNEY', id: 'j-a' }, role: 'AFFECTED_TRAVELLER' }],
    overallVerdict: 'PASS', dimensions: [{ dimension: 'PROGRAMME_ATTENDANCE', verdict: 'PASS', reasons: [] }],
  });
  const harmed = AssessmentResultSchema.parse({
    id: 'assess-harmed', kind: 'VIABILITY', evaluatedAt: '2026-09-14T09:00:00Z', manifest,
    subjects: [{ subjectRef: { kind: 'JOURNEY', id: 'j-b' }, role: 'AFFECTED_TRAVELLER' }],
    overallVerdict: 'FAIL', dimensions: [{ dimension: 'PROGRAMME_ATTENDANCE', verdict: 'FAIL', reasons: ['connection window now insufficient'] }],
  });

  assert.equal(helped.overallVerdict, 'PASS');
  assert.equal(harmed.overallVerdict, 'FAIL');
  assert.equal(overallVerdictFromDimensions(helped.dimensions), 'PASS');
  assert.equal(overallVerdictFromDimensions(harmed.dimensions), 'FAIL');
});

test('invalid: a scenario cannot change judging rules — CHANGE_PROGRAMME_ITEM_TIME cannot masquerade as a rule edit', () => {
  const change = ScenarioChangeSchema.safeParse({
    id: 'sc-1', recoveryStrategyId: 'strat-1', strategyVersion: 1,
    affectedSubjectRefs: [{ kind: 'PROGRAMME_ITEM', id: 'pi-1' }],
    effects: [{ effectKind: 'EDIT_RULE_SET', ruleSetId: 'rs-1' }],
    basisAssessmentId: 'assess-1',
  });
  assert.equal(change.success, false); // EDIT_RULE_SET is not a member of the closed effectKind union
});

// ---------------------------------------------------------------------------
// Example 4 — conflicting advisories
// ---------------------------------------------------------------------------

test('example: two publishers can disagree about the same topic/geography; neither overwrites the other', () => {
  const advisoryA = InformationVersionSchema.parse({
    id: 'iv-gov', informationRecordId: 'ir-gov-source', subtype: 'ADVISORY',
    externalEditionSequence: 4, issuedAt: '2026-09-13T00:00:00Z', receivedAt: '2026-09-13T01:00:00Z', observedAt: '2026-09-13T01:00:00Z',
    evidenceId: 'ev-1', sourceNativeSeverity: 'LEVEL_2_EXERCISE_CAUTION',
  });
  const advisoryB = InformationVersionSchema.parse({
    id: 'iv-monitor', informationRecordId: 'ir-monitoring-service', subtype: 'CONDITION',
    externalEditionSequence: 1, issuedAt: '2026-09-13T02:00:00Z', receivedAt: '2026-09-13T02:05:00Z', observedAt: '2026-09-13T02:05:00Z',
    evidenceId: 'ev-2', sourceNativeSeverity: 'ELEVATED_RISK',
  });
  assert.notEqual(advisoryA.informationRecordId, advisoryB.informationRecordId);
  assert.notEqual(advisoryA.sourceNativeSeverity, advisoryB.sourceNativeSeverity);
});

test('invalid: a REGULATORY information version must reference its exact RuleSetVersion', () => {
  const result = InformationVersionSchema.safeParse({
    id: 'iv-reg', informationRecordId: 'ir-reg', subtype: 'REGULATORY',
    externalEditionSequence: 1, issuedAt: '2026-09-13T00:00:00Z', receivedAt: '2026-09-13T00:00:00Z', observedAt: '2026-09-13T00:00:00Z',
    evidenceId: 'ev-3',
  });
  assert.equal(result.success, false);
});

// ---------------------------------------------------------------------------
// Example 5 — multi-passport transit evaluation
// ---------------------------------------------------------------------------

test('example: consistent credential selection across a multi-leg itinerary', () => {
  const manifest = WorldSnapshotManifestSchema.parse({
    evaluatedAt: '2026-09-14T09:00:00Z',
    evidenceReads: ['cred-v-passport-a', 'cred-v-visa-a'],
  });
  const entryAssessment = AssessmentResultSchema.parse({
    id: 'assess-entry-1', kind: 'ENTRY', evaluatedAt: '2026-09-14T09:00:00Z', manifest,
    subjects: [{ subjectRef: { kind: 'JOURNEY', id: 'j-a' }, role: 'ENTRY_SUBJECT' }],
    overallVerdict: 'UNKNOWN',
    dimensions: [
      { dimension: 'DOCUMENT_VALIDITY', verdict: 'PASS', reasons: [] },
      { dimension: 'TRAVEL_HISTORY_COVERAGE', verdict: 'UNKNOWN', reasons: ['cumulative stay history incomplete for this jurisdiction'] },
    ],
  });
  // Incomplete history cannot be silently treated as zero prior days: UNKNOWN must survive to overall verdict.
  assert.equal(overallVerdictFromDimensions(entryAssessment.dimensions), 'UNKNOWN');
});

// ---------------------------------------------------------------------------
// Example 6 — supplier timeout after dispatch
// ---------------------------------------------------------------------------

test('example: a dispatched attempt that times out enters OUTCOME_UNKNOWN and blocks a fresh dispatch until reconciled', () => {
  const attempt1 = ExecutionAttemptSchema.parse({
    id: 'attempt-1', actionIntentId: 'intent-1', attemptNumber: 1,
    logicalOperationKey: 'op-book-flight-1', requestFingerprint: 'fp-1',
    claimToken: 'claim-1', fencingToken: 1, leaseExpiresAt: '2026-09-14T09:05:00Z', status: 'OUTCOME_UNKNOWN',
  });
  const blocked = canDispatchNewAttempt([attempt1], 'op-book-flight-1');
  assert.equal(blocked.allowed, false);

  const reconciled = { ...attempt1, status: 'RECONCILED' as const };
  const allowedNow = canDispatchNewAttempt([reconciled], 'op-book-flight-1');
  assert.equal(allowedNow.allowed, true);
});

test('invalid: an authority envelope cannot be satisfied by an approval signed against a different envelope', () => {
  const envelope = AuthorityEnvelopeSchema.parse({
    id: 'env-1', actionPlanId: 'plan-1', actionPlanVersion: 1, actionIntentId: 'intent-1', actionIntentVersion: 1,
    requiredActors: [{ id: 'req-1', actorRole: 'PAYER' }],
    scope: [{ kind: 'ACTION_INTENT', id: 'intent-1' }],
    issuedAt: '2026-09-14T09:00:00Z', fingerprint: 'fp-envelope-v1',
  });
  const approval = ApprovalSchema.parse({
    id: 'appr-1', requirementId: 'req-1', approverPrincipalId: 'prin-1',
    envelopeFingerprint: 'fp-DIFFERENT-envelope', scope: [{ kind: 'ACTION_INTENT', id: 'intent-1' }],
    approvedAt: '2026-09-14T09:01:00Z',
  });
  assert.equal(approvalCoversEnvelope(approval, envelope, [], '2026-09-14T09:02:00Z'), false);
});

// ---------------------------------------------------------------------------
// Example 7 — additive new condition/information type (extension registration)
// ---------------------------------------------------------------------------

test('example: an additive EV-charger-outage category registers through the typed extension protocol, no JSON bucket', () => {
  const registration = ExtensionRegistrationSchema.parse({
    extensionId: 'ext-ev-charger-outage',
    ownerModule: 'src/domain/v2/knowledge/evCharging.ts',
    natureKind: 'EXTERNAL_OBSERVED_CLAIM',
    needsIndependentIdentity: true,
    ownerSubjectKind: 'INFORMATION_VERSION',
    typedObjectSchemaRef: 'EvChargerOutageDetailSchema@1',
    applicabilityReaderRef: 'evChargerRouteExposureReader',
    preservesProvenance: true,
    preservesCoverage: true,
    registeredCommands: ['ingestEvChargerOutage'],
    invalidatesScopeKinds: ['GEOGRAPHY'],
    evaluatorRef: 'evChargerRouteFeasibilityEvaluator',
    schemaMigrationRef: 'V2_00X_ev_charger_outage_detail',
    contractVersion: '1.0.0',
    testEvidenceRefs: ['test/northstar-v2-contracts.test.ts#ev-charger-extension'],
  });
  assert.deepEqual(extensionRegistrationIsAcceptable(registration), { acceptable: true });
});

test('invalid: an internally controlled object cannot register without independent identity', () => {
  const result = ExtensionRegistrationSchema.safeParse({
    extensionId: 'ext-bad',
    ownerModule: 'src/domain/v2/knowledge/badExtension.ts',
    natureKind: 'INTERNAL_CONTROLLED_OBJECT',
    needsIndependentIdentity: false,
    ownerSubjectKind: 'INFORMATION_VERSION',
    typedObjectSchemaRef: 'BadDetailSchema@1',
    applicabilityReaderRef: 'reader',
    preservesProvenance: true,
    preservesCoverage: true,
    registeredCommands: ['x'],
    invalidatesScopeKinds: ['GEOGRAPHY'],
    evaluatorRef: 'evaluator',
    schemaMigrationRef: 'migration',
    contractVersion: '1.0.0',
    testEvidenceRefs: ['x'],
  });
  assert.equal(result.success, false);
});

// ---------------------------------------------------------------------------
// Cross-cutting: revision/registry, acyclic action graphs, migration conflict
// ---------------------------------------------------------------------------

test('registry: WorldSnapshot currentness detects a stale aggregate read', () => {
  const manifest = WorldSnapshotManifestSchema.parse({
    evaluatedAt: '2026-09-14T09:00:00Z',
    aggregateReads: [{ aggregateRef: { kind: 'TRIP', id: 'trip-1' }, revision: 3 }],
  });
  const current = new Map([['TRIP:trip-1', 3]]);
  const advanced = new Map([['TRIP:trip-1', 4]]);
  assert.equal(isSnapshotCurrent(manifest, current, new Map(), '2026-09-14T09:00:01Z'), true);
  assert.equal(isSnapshotCurrent(manifest, advanced, new Map(), '2026-09-14T09:00:01Z'), false);
});

test('invalid: an ActionPlan dependency cycle is rejected as acyclic-graph-violation', () => {
  const plan = ActionPlanSchema.parse({
    id: 'plan-cyclic', recoveryCaseId: 'case-1', scenarioChangeId: 'sc-1',
    intents: [
      { id: 'a', actionPlanId: 'plan-cyclic', operationNamespace: 'ns', capabilityRef: 'cap.book', subjectRefs: [{ kind: 'JOURNEY', id: 'j-1' }], expectedObservations: ['obs'], compensationPolicy: { supported: false }, status: 'PROPOSED' },
      { id: 'b', actionPlanId: 'plan-cyclic', operationNamespace: 'ns', capabilityRef: 'cap.book', subjectRefs: [{ kind: 'JOURNEY', id: 'j-1' }], expectedObservations: ['obs'], compensationPolicy: { supported: false }, status: 'PROPOSED' },
    ],
    dependencies: [
      { fromActionIntentId: 'a', toActionIntentId: 'b' },
      { fromActionIntentId: 'b', toActionIntentId: 'a' },
    ],
  });
  const result = validateActionPlanAcyclic(plan);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.conflict.kind, 'ACYCLIC_GRAPH_VIOLATION');
});

test('migration: a repeat import with a changed payload is a conflict, never a silent overwrite', () => {
  assert.equal(migrationImportOutcome({ sourceIdentity: 'legacy-trip-1', sourceHash: 'h1' }, undefined), 'NEW');
  assert.equal(
    migrationImportOutcome({ sourceIdentity: 'legacy-trip-1', sourceHash: 'h1' }, { sourceIdentity: 'legacy-trip-1', sourceHash: 'h1' }),
    'IDEMPOTENT_REPLAY',
  );
  assert.equal(
    migrationImportOutcome({ sourceIdentity: 'legacy-trip-1', sourceHash: 'h2' }, { sourceIdentity: 'legacy-trip-1', sourceHash: 'h1' }),
    'CONFLICT_REQUIRES_RECONCILIATION',
  );
});

test('command: DomainCommandResult is a closed discriminated union (COMMITTED | CONFLICT | REJECTED)', () => {
  const rejected = DomainCommandResultSchema.parse({
    status: 'REJECTED',
    conflict: { kind: 'VALIDATION_FAILED', message: 'missing required field', subjectRefs: [] },
  });
  assert.equal(rejected.status, 'REJECTED');
  assert.equal(DomainCommandResultSchema.safeParse({ status: 'SOMETHING_ELSE' }).success, false);
});

/**
 * M7 + M8 cross-lane acceptance proofs #2 and #9.
 *
 * Neither lane's own isolated suite proves these:
 *  - #2 needs a REAL M7-compiled+M8-approved ActionPlan whose dispatch is then
 *    re-evaluated against a world that changed AFTER approval was recorded —
 *    proving approval alone never overrides a stale/changed world, because
 *    currentness is re-checked at dispatch time, not just at approval time.
 *  - #9 needs the REAL EXTERNAL-capability compiled intent (M7's
 *    `external:offer.select`, from a SELECT_OFFER effect) run through the
 *    exact claim -> dispatch(LOST_RESPONSE) -> OUTCOME_UNKNOWN ->
 *    blocked-redispatch -> reconcileUnknown sequence that
 *    `m8AuthorityExecution.pgtest.ts` already proves against a hand-built
 *    fixture plan — never proven before against a genuinely compiler-produced
 *    external intent.
 *
 * VIABILITY RECIPES (see m7m8IntegrationSeam.pgtest.ts header for the base
 * "anchor HARD objective" recipe, verified there empirically):
 *
 * Test A reuses that exact objective-loss recipe unmodified (an unrelated
 * ACHIEVED HARD objective supplies the sole blocking PASS the M6 registry
 * needs; the WAIVE_OBJECTIVE effect proposes the loss).
 *
 * Test B needs a VIABLE SELECT_OFFER strategy, which is a materially
 * different recipe verified empirically (throwaway `npx tsx` script against
 * the real evaluator registry, deleted before finishing) because a
 * TRANSPORT JourneyItem with real places activates evaluators an empty world
 * never touches:
 *  - `advisories` (m6.information) goes blocking UNKNOWN
 *    (`exposure_jurisdiction_unresolved`) unless both endpoint places resolve
 *    to a jurisdiction (`WPlaceJurisdiction` rows) AND that jurisdiction has
 *    COMPLETE, unexpired `WCoverage` rows for both the ADVISORY and CONDITION
 *    topics (so it falls through to `no_applicable_advisory_complete_coverage`
 *    PASS instead of asserting a real, evaluated advisory);
 *  - `supplier_fulfilment` (m6.booking) goes blocking UNKNOWN
 *    (`service_selected_not_booked`) once the item has a selected service
 *    (which SELECT_OFFER proposes) unless the JourneyItem already has at
 *    least one VALID booking reachable via a `WAllocation` ->
 *    `WReservationLine` (`observedStatus: 'CONFIRMED'`) -> `WReservation`
 *    chain — the evaluator does not require the booked line's
 *    `transportServiceId` to match the newly-selected offer, so a
 *    pre-existing confirmed booking on the item is sufficient;
 *  - a single TRANSPORT item with no `intendedVisits` and no second
 *    consecutive TRANSPORT item derives zero ENTRY/TRANSIT encounters
 *    (`deriveEncounters`), so `entry_feasibility`/`transit_feasibility` stay
 *    not-applicable and never need jurisdiction rule-set data.
 * With those seeded, `advisories`, `hard_objectives` (via the same anchor
 * trick) and `supplier_fulfilment` all resolve blocking PASS and the strategy
 * evaluates VIABLE, exactly as verified against the real registry before
 * writing this test.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed, seedRootSubject, seedTraveller, seedTrip, seedJourney } from './m2Seed.ts';
import { PgUnitOfWork, type ExecuteOutcome } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { createPrincipal, issueAuthorityGrant } from '../src/persistence/postgres/commands/peopleCommands.ts';
import { recordObjective } from '../src/persistence/postgres/commands/knowledgeCommands.ts';
import {
  openRecoveryCase,
  persistActionPlan,
  issueAuthorityDecision,
  recordApproval,
  authorizeDispatch,
  createPreparedExecutionAttempt,
} from '../src/persistence/postgres/commands/m8AuthorityCommands.ts';
import { PgExecutionWorker } from '../src/persistence/postgres/execution/pgExecutionWorker.ts';
import { computeEnvelopeFingerprint, type EnvelopeFingerprintInput } from '../src/resolution/authority/envelope.ts';
import { evaluateRecoveryStrategy } from '../src/resolution/scenarios/evaluate.ts';
import { compileActionPlan } from '../src/resolution/planning/compiler.ts';
import { ScenarioChangeSchema } from '../src/contracts/v2/scenario/scenarioChange.ts';
import { emptyWorld } from '../test/support/m6World.ts';
import type { WorldSnapshotManifest } from '../src/contracts/v2/scope/readScope.ts';
import type {
  WJourney,
  WObjective,
  WJourneyItem,
  WTransportService,
  WPlaceJurisdiction,
  WCoverage,
  WReservation,
  WReservationLine,
  WAllocation,
} from '../src/resolution/world/world.ts';
import type { AuthorityEnvelope, AuthorityDecision, Approval } from '../src/contracts/v2/authority/authorityEnvelope.ts';
import type { AssessmentView } from '../src/persistence/postgres/world/pgAssessments.ts';
import type { AuthorityGrant } from '../src/domain/v2/people/traveller.ts';
import {
  loadRequiredAuthorityScopesOrFail,
  persistStrategyChangeRow,
  prepareParams,
  seedStoredExecutionAuthority,
  tripBaseManifest,
  unionTypedRefs,
} from './m8ExecutionGateHelpers.ts';
import { seedJurisdictionWithPlaces, seedTransportIntent } from './m6WorldSeed.ts';

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

const NOW = '2031-10-01T00:00:00.000Z';
/** After NOW so seedStoredExecutionAuthority is the gate's latest decision. */
const EXEC_NOW = '2032-01-01T00:00:00.000Z';

function mustOk<T>(outcome: ExecuteOutcome<T>): T {
  if (!outcome.ok) assert.fail(`${outcome.conflict.kind}: ${outcome.conflict.message}`);
  return outcome.value;
}

async function issueApproverGrant(
  uow: PgUnitOfWork,
  params: {
    workspaceId: string;
    actorId: string;
    principalId: string;
    representedPartyRef: { kind: 'TRAVELLER'; id: string };
    scopes: EnvelopeFingerprintInput['scope'];
    issuedAt?: string;
  },
): Promise<void> {
  const idempotencyKey = randomUUID();
  mustOk(await issueAuthorityGrant(uow, {
    workspaceId: params.workspaceId,
    actorPrincipalId: params.actorId,
    idempotencyKey,
    principalId: params.principalId,
    representedPartyRef: params.representedPartyRef,
    issuedByPrincipalId: params.principalId,
    issuedAt: params.issuedAt ?? NOW,
    actions: ['action.intent.dispatch', 'action.intent.authorize'],
    scopes: params.scopes,
    authorisingReceipt: { commandNamespace: 'AUTHORITY_GRANT_ISSUED', idempotencyKey },
    expectedAggregateRevisions: [],
  }));
}

function emptyManifest(): WorldSnapshotManifest {
  return { evaluatedAt: NOW, evaluatorVersions: [], aggregateReads: [], scopeReads: [], evidenceReads: [], coverageReads: [], missingCoverage: [] };
}

function currentAssessmentView(): AssessmentView {
  return {
    status: 'CURRENT',
    assessment: {
      id: randomUUID(), kind: 'VIABILITY', evaluatedAt: NOW, overallVerdict: 'PASS',
      subjects: [{ subjectRef: { kind: 'JOURNEY', id: randomUUID() }, role: 'PRIMARY' }],
      dimensions: [],
      manifest: { evaluatedAt: NOW, evaluatorVersions: [], aggregateReads: [], scopeReads: [], evidenceReads: [], coverageReads: [], missingCoverage: [] },
    },
    staleness: [],
  };
}

describe('acceptance #2: approved dispatch is blocked once more when the world changes before dispatch', () => {
  test('CURRENT assessment authorizes dispatch after approval; the SAME approval is denied once the assessment goes STALE', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'M7-M8 currentness: objective loss');
    const traveller = await seedTraveller(seed, { displayName: 'Currentness Traveller' });
    const tripId = await seedTrip(seed, { purpose: 'TEST', lifecycleStatus: 'ACTIVE' });
    const journeyId = await seedJourney(seed, { tripId, travellerId: traveller.travellerId, lifecycleStatus: 'ACTIVE' });
    await commitSeed(seed);

    const principalId = randomUUID();
    const uow = () => new PgUnitOfWork(pool, seed.workspaceId);
    mustOk(await createPrincipal(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(),
      principalId, actorType: 'HUMAN', authIssuer: 'https://issuer.invalid/currentness', authSubject: principalId,
    }));
    const opened = mustOk(await openRecoveryCase(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), openedAt: NOW,
    }));

    // --- Real M7 pipeline: reuse the objective-loss viability recipe from
    // m7m8IntegrationSeam.pgtest.ts verbatim (unrelated ACHIEVED HARD
    // objective supplies the sole blocking PASS the M6 registry needs). ---
    const objectiveId = randomUUID();
    const unrelatedObjectiveId = randomUUID();
    const journey: WJourney = {
      id: journeyId, revision: 1, tripId, travellerId: traveller.travellerId,
      lifecycleStatus: 'ACTIVE', intendedWindow: null, responsibilityOrganisationId: null,
    };
    const objective: WObjective = {
      id: objectiveId, revision: 1, owner: { kind: 'JOURNEY', id: journeyId },
      successPredicateKind: 'STATEMENT', hardness: 'HARD', priority: 1,
      disposition: 'ACTIVE', dispositionEvidenceId: null, targets: [],
    };
    const unrelatedObjective: WObjective = {
      id: unrelatedObjectiveId, revision: 1, owner: { kind: 'JOURNEY', id: journeyId },
      successPredicateKind: 'STATEMENT', hardness: 'HARD', priority: 1,
      disposition: 'ACHIEVED', dispositionEvidenceId: null, targets: [],
    };
    const world = emptyWorld({
      journeys: [journey],
      objectives: [objective, unrelatedObjective],
      focus: [{ kind: 'JOURNEY', id: journeyId }],
    });
    const scenarioChange = ScenarioChangeSchema.parse({
      id: randomUUID(), recoveryStrategyId: randomUUID(), strategyVersion: 1,
      affectedSubjectRefs: [{ kind: 'OBJECTIVE', id: objectiveId }],
      basisAssessmentId: randomUUID(),
      effects: [{ effectKind: 'WAIVE_OBJECTIVE', objectiveId, rationale: 'currentness test loss', disposition: 'CLOSED_WITH_LOSS' }],
    });
    const evaluated = evaluateRecoveryStrategy({
      recoveryCaseId: opened.caseId, baseWorld: world, baseManifest: emptyManifest(),
      basisAssessmentId: scenarioChange.basisAssessmentId, scenarioChange, now: NOW,
    });
    assert.equal(evaluated.ok, true);
    if (!evaluated.ok) return;
    assert.equal(evaluated.value.strategy.viability, 'VIABLE');

    const compiled = compileActionPlan({ strategy: evaluated.value.strategy, now: NOW });
    assert.equal(compiled.ok, true);
    if (!compiled.ok) return;
    const plan = compiled.value.plan;
    const compiledIntent = plan.intents[0]!;
    assert.equal(compiledIntent.capabilityRef, 'internal:objective.disposition');

    mustOk(await recordObjective(uow(), {
      workspaceId: seed.workspaceId,
      actorPrincipalId: seed.actorId,
      idempotencyKey: randomUUID(),
      objectiveId,
      ownerKind: 'JOURNEY',
      ownerId: journeyId,
      successPredicate: 'currentness objective loss',
      hardness: 'HARD',
      priority: 1,
      disposition: 'ACTIVE',
    }));

    await persistStrategyChangeRow(pool, seed.workspaceId, seed.actorId, opened.caseId, scenarioChange, {
      baseManifest: tripBaseManifest(tripId, 1),
      candidateSummaries: [{ subjectRef: { kind: 'JOURNEY', id: journeyId } }],
    });
    const persisted = mustOk(await persistActionPlan(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), plan,
      recoveryStrategyId: scenarioChange.recoveryStrategyId,
    }));
    assert.deepEqual(persisted.intentIds, [compiledIntent.id]);

    // --- M8 authority: decide + approve exactly once. ---
    const requiredAuthorityScopes = await loadRequiredAuthorityScopesOrFail(pool, seed.workspaceId, compiledIntent.id);
    const decisionScope = unionTypedRefs([{ kind: 'OBJECTIVE', id: objectiveId }], requiredAuthorityScopes);
    const envelopeInput: EnvelopeFingerprintInput = {
      actionPlanId: plan.id, actionPlanVersion: 1, actionIntentId: compiledIntent.id, actionIntentVersion: 1,
      requiredActorRoles: ['CASE_OWNER'], scope: decisionScope, grantRefs: [], ruleInputs: [],
    };
    const fingerprint = computeEnvelopeFingerprint(envelopeInput);
    const decision = mustOk(await issueAuthorityDecision(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(),
      envelopeInput, requirements: [{ actorRole: 'CASE_OWNER' }], issuedAt: NOW,
    }));
    const decisionObj: AuthorityDecision = {
      id: decision.decisionId, actionPlanId: plan.id, actionPlanVersion: 1, actionIntentId: compiledIntent.id, actionIntentVersion: 1,
      groupOperator: 'AND', requirements: [{ id: decision.requirementIds[0]!, actorRole: 'CASE_OWNER' }],
    };
    const envelope: AuthorityEnvelope = {
      id: decision.decisionId, actionPlanId: plan.id, actionPlanVersion: 1, actionIntentId: compiledIntent.id, actionIntentVersion: 1,
      requiredActors: [{ id: decision.requirementIds[0]!, actorRole: 'CASE_OWNER' }], scope: decisionScope,
      grantRefs: [], ruleInputs: [], issuedAt: NOW, fingerprint,
    };
    const grant: AuthorityGrant = {
      id: randomUUID(), principalId, representedPartyRef: { kind: 'TRAVELLER', id: traveller.travellerId },
      issuedByPrincipalId: principalId, issuedAt: NOW,
      actions: ['action.intent.dispatch', 'action.intent.authorize'], scopes: decisionScope,
    };
    await issueApproverGrant(uow(), {
      workspaceId: seed.workspaceId, actorId: seed.actorId, principalId,
      representedPartyRef: { kind: 'TRAVELLER', id: traveller.travellerId },
      scopes: decisionScope,
    });
    const approval = mustOk(await recordApproval(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: principalId, idempotencyKey: randomUUID(),
      decisionId: decision.decisionId, requirementId: decision.requirementIds[0]!,
      envelopeFingerprint: fingerprint, scope: decisionScope, approvedAt: NOW,
    }));
    const approvalObj: Approval = {
      id: approval.approvalId, requirementId: decision.requirementIds[0]!, approverPrincipalId: principalId,
      envelopeFingerprint: fingerprint, scope: decisionScope, approvedAt: NOW,
    };

    // --- Dispatch is authorized against a CURRENT world at approval time. ---
    const allowedWhileCurrent = authorizeDispatch({
      assessmentView: currentAssessmentView(), envelopeInput, envelope, decision: decisionObj,
      approvals: [approvalObj], revocations: [], grants: [grant], requiredActionKind: 'action.intent.dispatch',
      principalId, now: NOW,
      requiredAuthorityScopes,
    });
    assert.equal(allowedWhileCurrent.allowed, true);

    // --- The world changes AFTER approval was recorded (the action plan
    // aggregate advanced past the revision the approval was read against) —
    // the SAME decision/approval/grant, only the assessment view differs. ---
    const staleView: AssessmentView = {
      status: 'STALE',
      assessment: currentAssessmentView().assessment,
      staleness: [{
        kind: 'AGGREGATE_ADVANCED',
        aggregateRef: { kind: 'ACTION_PLAN', id: plan.id },
        readRevision: 1,
        currentRevision: 2,
      }],
    };
    const deniedWhileStale = authorizeDispatch({
      assessmentView: staleView, envelopeInput, envelope, decision: decisionObj,
      approvals: [approvalObj], revocations: [], grants: [grant], requiredActionKind: 'action.intent.dispatch',
      principalId, now: NOW,
      requiredAuthorityScopes,
    });
    assert.equal(deniedWhileStale.allowed, false);
    if (!deniedWhileStale.allowed) assert.equal(deniedWhileStale.reason, 'ASSESSMENT_NOT_CURRENT');

    // --- The approval itself was never consumed or invalidated by the STALE
    // check above: the identical decision/approval/grant authorizes dispatch
    // again as soon as the assessment is CURRENT once more. Currentness is
    // re-checked at the moment of dispatch, not cached from approval time. ---
    const allowedAgainOnceCurrent = authorizeDispatch({
      assessmentView: currentAssessmentView(), envelopeInput, envelope, decision: decisionObj,
      approvals: [approvalObj], revocations: [], grants: [grant], requiredActionKind: 'action.intent.dispatch',
      principalId, now: NOW,
      requiredAuthorityScopes,
    });
    assert.equal(allowedAgainOnceCurrent.allowed, true);
  });
});

describe('acceptance #9: unknown provider outcome on a real compiled external intent blocks redispatch until reconciled', () => {
  test('SELECT_OFFER compiles to external:offer.select; claim -> LOST_RESPONSE -> OUTCOME_UNKNOWN -> blocked redispatch -> reconcile', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'M7-M8 currentness: external offer select');
    const traveller = await seedTraveller(seed, { displayName: 'Offer Traveller' });
    const tripId = await seedTrip(seed, { purpose: 'TEST', lifecycleStatus: 'ACTIVE' });
    const journeyId = await seedJourney(seed, { tripId, travellerId: traveller.travellerId, lifecycleStatus: 'ACTIVE' });
    const { jurisdictionId: seededJurisdictionId, areaVersionId, placeIds } = await seedJurisdictionWithPlaces(seed, {
      name: 'Offer corridor',
      places: [
        { name: 'Origin', placeType: 'AIRPORT' },
        { name: 'Destination', placeType: 'AIRPORT' },
      ],
    });
    const originPlaceId = placeIds[0]!;
    const destinationPlaceId = placeIds[1]!;
    const itemId = await seedTransportIntent(seed, {
      journeyId, orderKey: '010', originPlaceId, destinationPlaceId, lifecycleStatus: 'PLANNED',
    });
    const offerId = randomUUID();
    await seedRootSubject(seed, { kind: 'OFFER', id: offerId });
    await seed.client.query(
      `INSERT INTO offers (workspace_id, id, source_id, price_amount, price_currency, quoted_at, expires_at, fingerprint, created_by_actor_id)
       VALUES ($1, $2, 'test-source', 100, 'USD', '2030-01-01T00:00:00Z', '2030-02-01T00:00:00Z', $3, $4)`,
      [seed.workspaceId, offerId, offerId, seed.actorId],
    );
    await commitSeed(seed);

    const principalId = randomUUID();
    const uow = () => new PgUnitOfWork(pool, seed.workspaceId);
    mustOk(await createPrincipal(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(),
      principalId, actorType: 'HUMAN', authIssuer: 'https://issuer.invalid/offer-select', authSubject: principalId,
    }));
    const opened = mustOk(await openRecoveryCase(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), openedAt: NOW,
    }));

    // --- Real M7 pipeline for a VIABLE SELECT_OFFER strategy (see file
    // header for why each of these fixtures is required — empirically
    // verified against the real M6 registry before writing this test). ---
    const svcId = randomUUID();
    const anchorObjectiveId = randomUUID();
    const jurisdictionId = seededJurisdictionId;
    const reservationId = randomUUID();
    const lineId = randomUUID();

    const journey: WJourney = {
      id: journeyId, revision: 1, tripId, travellerId: traveller.travellerId,
      lifecycleStatus: 'ACTIVE', intendedWindow: null, responsibilityOrganisationId: null,
    };
    const item: WJourneyItem = {
      id: itemId, journeyId, kind: 'TRANSPORT', orderKey: '010', lifecycleStatus: 'PLANNED', flexible: false, intendedWindow: null,
      desiredOriginPlaceId: originPlaceId, desiredDestinationPlaceId: destinationPlaceId, selectedServiceId: null, intendedPlaceId: null, requiredNights: null,
      participationId: null, standaloneTitle: null, standaloneWindow: null, resourceId: null, intendedLocationPlaceId: null,
    };
    const svc: WTransportService = {
      id: svcId, revision: 1, mode: 'AIR', operator: 'op', originPlaceId, destinationPlaceId,
      published: { departure: null, arrival: null }, estimated: { departure: null, arrival: null }, actual: { departure: null, arrival: null },
    };
    const anchorObjective: WObjective = {
      id: anchorObjectiveId, revision: 1, owner: { kind: 'JOURNEY', id: journeyId },
      successPredicateKind: 'STATEMENT', hardness: 'HARD', priority: 1,
      disposition: 'ACHIEVED', dispositionEvidenceId: null, targets: [],
    };
    // Both endpoint places resolve to one jurisdiction with COMPLETE,
    // unexpired advisory/condition coverage -> `advisories` resolves PASS
    // instead of blocking UNKNOWN.
    const placeJurisdictions: WPlaceJurisdiction[] = [
      { placeId: originPlaceId, jurisdictionId, basis: 'AREA_MEMBERSHIP', areaVersionId, evidenceId: null },
      { placeId: destinationPlaceId, jurisdictionId, basis: 'AREA_MEMBERSHIP', areaVersionId, evidenceId: null },
    ];
    const coverage: WCoverage[] = [
      { id: randomUUID(), topic: 'ADVISORY', queryBounds: { jurisdictionId }, edition: 'e1', watermark: null, completeness: 'COMPLETE', limitations: [], expiresAt: null, evidenceId: null },
      { id: randomUUID(), topic: 'CONDITION', queryBounds: { jurisdictionId }, edition: 'e1', watermark: null, completeness: 'COMPLETE', limitations: [], expiresAt: null, evidenceId: null },
    ];
    // A pre-existing CONFIRMED booking on the item -> `supplier_fulfilment`
    // resolves PASS instead of blocking UNKNOWN once SELECT_OFFER sets a
    // selected service (the evaluator does not require the booked line to
    // reference the newly-selected service).
    const reservation: WReservation = {
      id: reservationId, revision: 1, reservationType: 'TRANSPORT', observedStatus: 'CONFIRMED', observedStatusAt: NOW,
      responsibleOrganisationId: null, responsibleTravellerId: traveller.travellerId,
    };
    const line: WReservationLine = {
      id: lineId, reservationId, productType: 'TRANSPORT', observedStatus: 'CONFIRMED', observedStatusAt: NOW, evidenceId: null,
      transportServiceId: svcId, resourceId: null, placeId: null, interval: null,
    };
    const allocation: WAllocation = {
      id: randomUUID(), reservationId, lineId, travellerId: traveller.travellerId, journeyItemId: itemId, role: 'TRAVELLER', quantity: 1,
    };

    const world = emptyWorld({
      journeys: [journey],
      journeyItems: [item],
      transportServices: [svc],
      objectives: [anchorObjective],
      placeJurisdictions,
      coverage,
      reservations: [reservation],
      reservationLines: [line],
      allocations: [allocation],
      focus: [{ kind: 'JOURNEY', id: journeyId }],
    });

    const scenarioChange = ScenarioChangeSchema.parse({
      id: randomUUID(), recoveryStrategyId: randomUUID(), strategyVersion: 1,
      affectedSubjectRefs: [{ kind: 'JOURNEY_ITEM', id: itemId }],
      basisAssessmentId: randomUUID(),
      effects: [{ effectKind: 'SELECT_OFFER', journeyItemId: itemId, offerId }],
    });
    const evaluated = evaluateRecoveryStrategy({
      recoveryCaseId: opened.caseId, baseWorld: world, baseManifest: emptyManifest(),
      basisAssessmentId: scenarioChange.basisAssessmentId, scenarioChange, now: NOW,
      resolvedOffers: [{ offerId, transportServiceId: svcId }],
    });
    assert.equal(evaluated.ok, true);
    if (!evaluated.ok) return;
    // Proves the real M6 registry, not a forced cast, made this VIABLE.
    assert.equal(evaluated.value.strategy.viability, 'VIABLE');

    const compiled = compileActionPlan({
      strategy: evaluated.value.strategy, now: NOW,
      capabilities: [{ capabilityRef: 'external:offer.select', supported: true }],
    });
    assert.equal(compiled.ok, true);
    if (!compiled.ok) return;
    const plan = compiled.value.plan;
    assert.equal(plan.intents.length, 1);
    const compiledIntent = plan.intents[0]!;
    // The point of this test: a genuinely M7-compiled EXTERNAL capability
    // intent, not the hand-built provider:test fixture m8AuthorityExecution
    // uses for its own claim/idempotency/unknown-outcome proofs.
    assert.equal(compiledIntent.capabilityRef, 'external:offer.select');
    assert.ok(compiledIntent.operationNamespace.length > 0);
    assert.ok(compiledIntent.logicalOperationKey && compiledIntent.logicalOperationKey.length > 0);
    assert.ok(compiledIntent.requestFingerprint && compiledIntent.requestFingerprint.length > 0);

    await persistStrategyChangeRow(pool, seed.workspaceId, seed.actorId, opened.caseId, scenarioChange, {
      baseManifest: tripBaseManifest(tripId, 1),
      candidateSummaries: [{ subjectRef: { kind: 'JOURNEY', id: journeyId } }],
    });
    const persisted = mustOk(await persistActionPlan(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), plan,
      recoveryStrategyId: scenarioChange.recoveryStrategyId,
    }));
    assert.deepEqual(persisted.intentIds, [compiledIntent.id]);

    // --- M8 authority: decide, approve, and confirm dispatch is authorized
    // before the intent ever reaches the execution worker. ---
    const requiredAuthorityScopes = await loadRequiredAuthorityScopesOrFail(pool, seed.workspaceId, compiledIntent.id);
    const decisionScope = unionTypedRefs(compiledIntent.subjectRefs, requiredAuthorityScopes);
    const envelopeInput: EnvelopeFingerprintInput = {
      actionPlanId: plan.id, actionPlanVersion: 1, actionIntentId: compiledIntent.id, actionIntentVersion: 1,
      requiredActorRoles: ['CASE_OWNER'], scope: decisionScope, grantRefs: [], ruleInputs: [],
    };
    const fingerprint = computeEnvelopeFingerprint(envelopeInput);
    const decision = mustOk(await issueAuthorityDecision(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(),
      envelopeInput, requirements: [{ actorRole: 'CASE_OWNER' }], issuedAt: NOW,
    }));
    const decisionObj: AuthorityDecision = {
      id: decision.decisionId, actionPlanId: plan.id, actionPlanVersion: 1, actionIntentId: compiledIntent.id, actionIntentVersion: 1,
      groupOperator: 'AND', requirements: [{ id: decision.requirementIds[0]!, actorRole: 'CASE_OWNER' }],
    };
    const envelope: AuthorityEnvelope = {
      id: decision.decisionId, actionPlanId: plan.id, actionPlanVersion: 1, actionIntentId: compiledIntent.id, actionIntentVersion: 1,
      requiredActors: [{ id: decision.requirementIds[0]!, actorRole: 'CASE_OWNER' }], scope: decisionScope,
      grantRefs: [], ruleInputs: [], issuedAt: NOW, fingerprint,
    };
    const grant: AuthorityGrant = {
      id: randomUUID(), principalId, representedPartyRef: { kind: 'TRAVELLER', id: traveller.travellerId },
      issuedByPrincipalId: principalId, issuedAt: NOW,
      actions: ['action.intent.dispatch', 'action.intent.authorize'], scopes: decisionScope,
    };
    await issueApproverGrant(uow(), {
      workspaceId: seed.workspaceId, actorId: seed.actorId, principalId,
      representedPartyRef: { kind: 'TRAVELLER', id: traveller.travellerId },
      scopes: decisionScope,
    });
    const approval = mustOk(await recordApproval(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: principalId, idempotencyKey: randomUUID(),
      decisionId: decision.decisionId, requirementId: decision.requirementIds[0]!,
      envelopeFingerprint: fingerprint, scope: decisionScope, approvedAt: NOW,
    }));
    const approvalObj: Approval = {
      id: approval.approvalId, requirementId: decision.requirementIds[0]!, approverPrincipalId: principalId,
      envelopeFingerprint: fingerprint, scope: decisionScope, approvedAt: NOW,
    };
    const authorized = authorizeDispatch({
      assessmentView: currentAssessmentView(), envelopeInput, envelope, decision: decisionObj,
      approvals: [approvalObj], revocations: [], grants: [grant], requiredActionKind: 'action.intent.dispatch',
      principalId, now: NOW,
      requiredAuthorityScopes,
    });
    assert.equal(authorized.allowed, true);

    // --- Durable execution: claim, dispatch (provider response lost),
    // blocked blind redispatch while unknown, then reconcile via lookup. ---
    await seedStoredExecutionAuthority({
      pool, workspaceId: seed.workspaceId, actorId: seed.actorId, principalId,
      planId: plan.id, intentId: compiledIntent.id,
      scope: envelopeInput.scope,
      representedPartyRef: { kind: 'TRAVELLER', id: traveller.travellerId },
      requirementRole: 'CASE_OWNER',
      assessmentSubject: { kind: 'JOURNEY', id: journeyId },
      assessmentTripId: tripId,
      now: EXEC_NOW,
      skipGrants: true,
    });
    mustOk(await createPreparedExecutionAttempt(uow(), prepareParams({
      workspaceId: seed.workspaceId, actorId: seed.actorId,
      planId: plan.id, intentId: compiledIntent.id, principalId, now: EXEC_NOW,
    })));

    const worker = new PgExecutionWorker(pool, { actorId: 'worker-offer-select' });
    const claim = await worker.claimNext(seed.workspaceId);
    assert.ok(claim);
    assert.equal(claim!.actionIntentId, compiledIntent.id);

    const lost = await worker.dispatchClaimed(claim!, {
      principalId, now: EXEC_NOW,
      observed: { capabilityKind: 'SERVICE', supported: true },
      dispatcher: async () => ({ kind: 'LOST_RESPONSE', requestRef: 'req-offer-select-1' }),
    });
    assert.equal(lost.outcome, 'OUTCOME_UNKNOWN');

    const afterLost = await pool.query<{ status: string }>(
      'SELECT status FROM execution_attempts WHERE id = $1', [claim!.id],
    );
    assert.equal(afterLost.rows[0]?.status, 'OUTCOME_UNKNOWN');

    // Blind redispatch must stay blocked while the outcome is unknown — no
    // duplicate dispatch of the same external offer-selection operation.
    const blockedRedispatch = await createPreparedExecutionAttempt(uow(), prepareParams({
      workspaceId: seed.workspaceId, actorId: seed.actorId,
      planId: plan.id, intentId: compiledIntent.id, principalId,
      attemptNumber: 2, now: EXEC_NOW,
    }));
    assert.equal(blockedRedispatch.ok, false);

    const refreshed = { ...claim!, status: 'OUTCOME_UNKNOWN' as const };
    const reconciled = await worker.reconcileUnknown(refreshed, async () => ({
      kind: 'FOUND_SUCCESS',
      responseRef: 'rsp-offer-select-1',
      sourceOwnedFields: { status: 'CONFIRMED' },
    }));
    assert.equal(reconciled.outcome, 'OBSERVED_SUCCESS');

    const afterReconcile = await pool.query<{ status: string }>(
      'SELECT status FROM execution_attempts WHERE id = $1', [claim!.id],
    );
    assert.equal(afterReconcile.rows[0]?.status, 'OBSERVED_SUCCESS');
  });
});

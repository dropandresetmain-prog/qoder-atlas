/**
 * M7 + M8 cross-lane acceptance proofs — shared-resource aggregation and
 * capability-refusal truthfulness. Companion to m7m8IntegrationSeam.pgtest.ts;
 * see that file's header for the VIABILITY RECIPE (anchor HARD/ACHIEVED
 * objectives short-circuit `hard_objectives` to a blocking PASS; keep
 * programme participation OPTIONAL to avoid the blocking
 * `programme_participation` dimension).
 *
 * ADDITIONAL RECIPE NOTE verified empirically for this file (throwaway
 * `npx tsx` scripts against the real evaluators, deleted before finishing):
 * a `SELECT_OFFER` effect against an ACTIVE (non-DROPPED/COMPLETED)
 * TRANSPORT JourneyItem always lands a real, non-fabricated blocking UNKNOWN
 * on `m6.booking`'s `supplier_fulfilment` dimension (reasonCode
 * `service_selected_not_booked`, because selecting an offer is intent only —
 * it is never itself a booking) and, once the item's place refs are
 * "touched", also on `advisories` (`exposure_jurisdiction_unresolved`) —
 * exactly the pitfall the sibling file's header warns about, and neither is
 * waived by an anchor objective (blocking UNKNOWN always beats blocking
 * PASS). There is no reservation/booking fixture path available here without
 * modelling a real supplier confirmation, which would contradict the very
 * "no fabricated success" property acceptance criterion #8 is proving. The
 * one honest, reusable way found to reach a real VIABLE strategy through a
 * SELECT_OFFER effect without hand-modelling a booking is to target a
 * JourneyItem whose `lifecycleStatus` is `DROPPED`: `effectiveItinerary.ts`
 * treats DROPPED/COMPLETED items as inactive, so `m6.booking` and the
 * places/jurisdiction evaluators skip it entirely (their filters are
 * `item.active && …`) while `applyScenarioOverlay`'s SELECT_OFFER handling
 * does not itself gate on lifecycle status, so the proposed selection still
 * applies and still compiles to a real `external:offer.select` ActionIntent.
 * Used below in acceptance #8 (Test C), which only needs the plan to
 * *compile*, not to model a real reachable booking.
 *
 * ACCEPTANCE #7 (Test B / budgeted paid action) — CLOSED. It was originally
 * blocked for the reason recorded in
 * docs/work/M7_M8_INTEGRATION_ACTIVE_TASK.md §7b: `compileActionPlan`'s
 * `intentForEffect` never set `costEstimate` on ANY compiled ActionIntent,
 * and `ResolvedOffer` (src/resolution/scenarios/overlay.ts) carried only
 * `{offerId, transportServiceId}`, never a price. Fixed, with the user's
 * explicit approval, by an additive `offerPrice?: ExactMoney` field on the
 * `SELECT_OFFER` `ScenarioEffect` variant
 * (src/contracts/v2/scenario/scenarioChange.ts — permitted under
 * CONTRACTS.md §7's additive-only rule) plus one line in `intentForEffect`
 * setting `costEstimate: effect.offerPrice` when present. Test B below uses
 * the same DROPPED-item SELECT_OFFER viability fixture as Test C.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed, seedRootSubject, seedTraveller, seedTrip, seedJourney } from './m2Seed.ts';
import { seedEvent, seedProgramme, seedProgrammeItem, seedParticipation } from './m4Seed.ts';
import { seedOrganisation } from './m3Seed.ts';
import { PgUnitOfWork, type ExecuteOutcome } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { createPrincipal, issueAuthorityGrant } from '../src/persistence/postgres/commands/peopleCommands.ts';
import { createBudget } from '../src/persistence/postgres/commands/arrangementCommands.ts';
import {
  openRecoveryCase,
  persistActionPlan,
  issueAuthorityDecision,
  recordApproval,
  authorizeDispatch,
  createPreparedExecutionAttempt,
  holdBudgetForIntent,
  type DispatchAuthorizationInput,
} from '../src/persistence/postgres/commands/m8AuthorityCommands.ts';
import { PgExecutionWorker } from '../src/persistence/postgres/execution/pgExecutionWorker.ts';
import { computeEnvelopeFingerprint, type EnvelopeFingerprintInput } from '../src/resolution/authority/envelope.ts';
import { evaluateRecoveryStrategy } from '../src/resolution/scenarios/evaluate.ts';
import { compileActionPlan } from '../src/resolution/planning/compiler.ts';
import { ScenarioChangeSchema } from '../src/contracts/v2/scenario/scenarioChange.ts';
import { emptyWorld } from '../test/support/m6World.ts';
import type { WorldSnapshotManifest } from '../src/contracts/v2/scope/readScope.ts';
import type { WJourney, WObjective, WProgrammeItem, WParticipation, WJourneyItem, WTransportService } from '../src/resolution/world/world.ts';
import type { AuthorityEnvelope, AuthorityDecision, Approval } from '../src/contracts/v2/authority/authorityEnvelope.ts';
import type { AssessmentView } from '../src/persistence/postgres/world/pgAssessments.ts';
import type { AuthorityGrant } from '../src/domain/v2/people/traveller.ts';
import {
  bootstrapTestGrantIssuer,
  loadRequiredAuthorityScopesOrFail,
  persistStrategyChangeRow,
  prepareParams,
  seedStoredExecutionAuthority,
  tripBaseManifest,
  unionTypedRefs,
} from './m8ExecutionGateHelpers.ts';
import { seedTransportIntent, seedUnlocatedPlace } from './m6WorldSeed.ts';

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

const NOW = '2031-09-01T00:00:00.000Z';
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
    /** ISSUER-POL: authorised issuer (self-issuance is rejected at the command level). */
    issuerPrincipalId: string;
  },
): Promise<void> {
  const idempotencyKey = randomUUID();
  mustOk(await issueAuthorityGrant(uow, {
    workspaceId: params.workspaceId,
    actorPrincipalId: params.actorId,
    idempotencyKey,
    principalId: params.principalId,
    representedPartyRef: params.representedPartyRef,
    issuedByPrincipalId: params.issuerPrincipalId,
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

describe('acceptance #6: shared-resource strategy considers every affected Journey before authority', () => {
  test('two travellers sharing one PROGRAMME_ITEM both appear in candidateAssessments; each resolves VIABLE on its own anchor objective', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'M7-M8 shared resource: two travellers, one programme item');
    const travellerA = await seedTraveller(seed, { displayName: 'Shared Resource Traveller A' });
    const travellerB = await seedTraveller(seed, { displayName: 'Shared Resource Traveller B' });
    const tripId = await seedTrip(seed, { purpose: 'TEST', lifecycleStatus: 'ACTIVE' });
    const journeyAId = await seedJourney(seed, { tripId, travellerId: travellerA.travellerId, lifecycleStatus: 'ACTIVE' });
    const journeyBId = await seedJourney(seed, { tripId, travellerId: travellerB.travellerId, lifecycleStatus: 'ACTIVE' });
    const eventId = await seedEvent(seed, { lifecycleStatus: 'ACTIVE' });
    const programmeId = await seedProgramme(seed, { eventId, lifecycleStatus: 'ACTIVE' });
    const originalWindow = { start: '2031-09-10T10:00:00.000Z', end: '2031-09-10T11:00:00.000Z' };
    const { programmeItemId } = await seedProgrammeItem(seed, {
      programmeId, lifecycleStatus: 'SCHEDULED', scheduleAuthority: 'INTERNAL', window: originalWindow,
    });
    // TWO real seeded participation rows on the SAME programme item — one per traveller.
    await seedParticipation(seed, { programmeItemId, travellerId: travellerA.travellerId, obligation: 'OPTIONAL', accepted: true });
    await seedParticipation(seed, { programmeItemId, travellerId: travellerB.travellerId, obligation: 'OPTIONAL', accepted: true });
    await commitSeed(seed);

    const principalId = randomUUID();
    const uow = () => new PgUnitOfWork(pool, seed.workspaceId);
    mustOk(await createPrincipal(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(),
      principalId, actorType: 'HUMAN', authIssuer: 'https://issuer.invalid/shared-resource', authSubject: principalId,
    }));
    const opened = mustOk(await openRecoveryCase(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), openedAt: NOW,
    }));

    // Real M7 pipeline. EVERY affected journey gets its own anchor ACHIEVED
    // HARD objective (see file header + sibling file's VIABILITY RECIPE) so
    // each resolves VIABLE independently — this codebase never averages
    // verdicts across people (participation.ts M6 evaluator contract).
    const proposedWindow = { start: '2031-09-10T14:00:00.000Z', end: '2031-09-10T15:00:00.000Z' };
    const journeyA: WJourney = {
      id: journeyAId, revision: 1, tripId, travellerId: travellerA.travellerId,
      lifecycleStatus: 'ACTIVE', intendedWindow: null, responsibilityOrganisationId: null,
    };
    const journeyB: WJourney = {
      id: journeyBId, revision: 1, tripId, travellerId: travellerB.travellerId,
      lifecycleStatus: 'ACTIVE', intendedWindow: null, responsibilityOrganisationId: null,
    };
    const anchorA: WObjective = {
      id: randomUUID(), revision: 1, owner: { kind: 'JOURNEY', id: journeyAId },
      successPredicateKind: 'STATEMENT', hardness: 'HARD', priority: 1,
      disposition: 'ACHIEVED', dispositionEvidenceId: null, targets: [],
    };
    const anchorB: WObjective = {
      id: randomUUID(), revision: 1, owner: { kind: 'JOURNEY', id: journeyBId },
      successPredicateKind: 'STATEMENT', hardness: 'HARD', priority: 1,
      disposition: 'ACHIEVED', dispositionEvidenceId: null, targets: [],
    };
    const worldProgrammeItem: WProgrammeItem = {
      id: programmeItemId, programmeId, title: 'Shared resource item', itemType: 'SESSION', placeId: null,
      window: originalWindow, lifecycleStatus: 'SCHEDULED', scheduleAuthority: 'INTERNAL', operatingRequirements: null,
    };
    const worldParticipationA: WParticipation = {
      id: randomUUID(), programmeItemId, travellerId: travellerA.travellerId,
      obligation: 'OPTIONAL', accepted: true, preparationWindow: null,
    };
    const worldParticipationB: WParticipation = {
      id: randomUUID(), programmeItemId, travellerId: travellerB.travellerId,
      obligation: 'OPTIONAL', accepted: true, preparationWindow: null,
    };
    const world = emptyWorld({
      journeys: [journeyA, journeyB],
      objectives: [anchorA, anchorB],
      programmes: [{ id: programmeId, revision: 1, eventId, title: 'e', lifecycleStatus: 'ACTIVE' }],
      programmeItems: [worldProgrammeItem],
      participations: [worldParticipationA, worldParticipationB],
      focus: [{ kind: 'PROGRAMME_ITEM', id: programmeItemId }],
    });
    const scenarioChange = ScenarioChangeSchema.parse({
      id: randomUUID(), recoveryStrategyId: randomUUID(), strategyVersion: 1,
      affectedSubjectRefs: [{ kind: 'PROGRAMME_ITEM', id: programmeItemId }],
      basisAssessmentId: randomUUID(),
      effects: [{ effectKind: 'CHANGE_PROGRAMME_ITEM_TIME', programmeItemId, proposedWindow }],
    });
    const evaluated = evaluateRecoveryStrategy({
      recoveryCaseId: opened.caseId, baseWorld: world, baseManifest: emptyManifest(),
      basisAssessmentId: scenarioChange.basisAssessmentId, scenarioChange, now: NOW,
    });
    assert.equal(evaluated.ok, true);
    if (!evaluated.ok) return;
    // Whole-strategy viability required BOTH affected journeys to independently PASS.
    assert.equal(evaluated.value.strategy.viability, 'VIABLE');

    // --- The core acceptance-#6 assertion: candidateAssessments covers BOTH
    // affected journeys, not just the first one reached by the closure walk. ---
    const assessedJourneyIds = evaluated.value.strategy.candidateAssessments
      .filter((a) => a.subjectRef.kind === 'JOURNEY')
      .map((a) => a.subjectRef.id);
    assert.equal(evaluated.value.strategy.candidateAssessments.length, 2);
    assert.ok(assessedJourneyIds.includes(journeyAId), 'traveller A journey must be independently assessed');
    assert.ok(assessedJourneyIds.includes(journeyBId), 'traveller B journey must be independently assessed');
    for (const entry of evaluated.value.strategy.candidateAssessments) {
      assert.equal(entry.overallVerdict, 'PASS', `journey ${entry.subjectRef.id} must resolve PASS on its own anchor objective`);
    }
    // candidateAssessmentResults carries the same two subjects with full dimension detail.
    assert.equal(evaluated.value.strategy.candidateAssessmentResults.length, 2);

    // --- Compile / persist / authorize as usual: one CHANGE_PROGRAMME_ITEM_TIME intent. ---
    const compiled = compileActionPlan({ strategy: evaluated.value.strategy, now: NOW });
    assert.equal(compiled.ok, true);
    if (!compiled.ok) return;
    const plan = compiled.value.plan;
    assert.equal(plan.intents.length, 1);
    const compiledIntent = plan.intents[0]!;
    assert.equal(compiledIntent.capabilityRef, 'internal:programme.schedule');

    await persistStrategyChangeRow(pool, seed.workspaceId, seed.actorId, opened.caseId, scenarioChange, {
      baseManifest: tripBaseManifest(tripId, 1),
      candidateSummaries: evaluated.value.strategy.candidateAssessments.map((a) => ({ subjectRef: a.subjectRef })),
    });
    const persisted = mustOk(await persistActionPlan(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), plan,
      recoveryStrategyId: scenarioChange.recoveryStrategyId,
    }));
    assert.deepEqual(persisted.intentIds, [compiledIntent.id]);

    const requiredAuthorityScopes = await loadRequiredAuthorityScopesOrFail(pool, seed.workspaceId, compiledIntent.id);
    const decisionScope = unionTypedRefs([{ kind: 'PROGRAMME_ITEM', id: programmeItemId }], requiredAuthorityScopes);
    const envelopeInput: EnvelopeFingerprintInput = {
      actionPlanId: plan.id, actionPlanVersion: 1, actionIntentId: compiledIntent.id, actionIntentVersion: 1,
      requiredActorRoles: ['CASE_OWNER'], scope: decisionScope, grantRefs: [], ruleInputs: [],
    };
    const fingerprint = computeEnvelopeFingerprint(envelopeInput);
    const decision = mustOk(await issueAuthorityDecision(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(),
      envelopeInput, requirements: [{ actorRole: 'CASE_OWNER' }], issuedAt: NOW,
    }));
    // ISSUER-POL: one authorised issuer for this workspace's fixture, scoped
    // to cover the decision scope the approver grant is about to target. The
    // bootstrap grant's own represented-party must be a kind the
    // authority_grants_represented_party_kind_known CHECK allows (TRAVELLER/
    // ORGANISATION/RESPONSIBILITY_ASSIGNMENT/PRINCIPAL) — decisionScope's
    // first entry is PROGRAMME_ITEM/JOURNEY, so a seeded TRAVELLER is
    // prepended; coverage is exact-set containment so this extra entry is
    // harmless to the requirement check below.
    const issuerRepresentedParty = { kind: 'TRAVELLER' as const, id: travellerA.travellerId };
    const issuerPrincipalId = await bootstrapTestGrantIssuer(
      pool, seed.workspaceId, seed.actorId, NOW,
      // bootstrapTestGrantIssuer uses coverageScopes[0] as the grant's own
      // represented party, so the valid-kind ref must be first, not merely
      // present (unionTypedRefs would re-sort it out of position).
      [issuerRepresentedParty, ...decisionScope.filter(
        (r) => !(r.kind === issuerRepresentedParty.kind && r.id === issuerRepresentedParty.id),
      )],
    );
    await issueApproverGrant(uow(), {
      workspaceId: seed.workspaceId, actorId: seed.actorId, principalId,
      representedPartyRef: { kind: 'TRAVELLER', id: travellerA.travellerId },
      scopes: decisionScope,
      issuerPrincipalId,
    });
    const approval = mustOk(await recordApproval(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: principalId, idempotencyKey: randomUUID(),
      decisionId: decision.decisionId, requirementId: decision.requirementIds[0]!,
      envelopeFingerprint: fingerprint, scope: decisionScope, approvedAt: NOW,
    }));
    const decisionObj: AuthorityDecision = {
      id: decision.decisionId, actionPlanId: plan.id, actionPlanVersion: 1, actionIntentId: compiledIntent.id, actionIntentVersion: 1,
      groupOperator: 'AND', requirements: [{ id: decision.requirementIds[0]!, actorRole: 'CASE_OWNER' }],
    };
    const approvalObj: Approval = {
      id: approval.approvalId, requirementId: decision.requirementIds[0]!, approverPrincipalId: principalId,
      envelopeFingerprint: fingerprint, scope: decisionScope, approvedAt: NOW,
    };
    const envelope: AuthorityEnvelope = {
      id: decision.decisionId, actionPlanId: plan.id, actionPlanVersion: 1, actionIntentId: compiledIntent.id, actionIntentVersion: 1,
      requiredActors: [{ id: decision.requirementIds[0]!, actorRole: 'CASE_OWNER' }], scope: decisionScope,
      grantRefs: [], ruleInputs: [], issuedAt: NOW, fingerprint,
    };
    const grant: AuthorityGrant = {
      id: randomUUID(), principalId, representedPartyRef: { kind: 'TRAVELLER', id: travellerA.travellerId },
      issuedByPrincipalId: principalId, issuedAt: NOW,
      actions: ['action.intent.dispatch', 'action.intent.authorize'], scopes: decisionScope,
    };
    const authorized = authorizeDispatch({
      assessmentView: currentAssessmentView(), envelopeInput, envelope, decision: decisionObj,
      approvals: [approvalObj], revocations: [], grants: [grant], requiredActionKind: 'action.intent.dispatch',
      principalId, now: NOW,
      requiredAuthorityScopes,
    });
    assert.equal(authorized.allowed, true);
  });
});

describe('acceptance #7: budgeted paid action — M7 cost/quote context feeds M8 exact-money budget hold', () => {
  test('a real compiled SELECT_OFFER costEstimate round-trips through Postgres into a budget hold with no second cost representation', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'M7-M8 budget: real compiled costEstimate');
    const organisationId = await seedOrganisation(seed, 'USD');
    await commitSeed(seed);

    const uow = () => new PgUnitOfWork(pool, seed.workspaceId);
    const opened = mustOk(await openRecoveryCase(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), openedAt: NOW,
    }));

    // Same DROPPED-item SELECT_OFFER viability fixture as Test C (file
    // header) — an ACTIVE transport item can never reach VIABLE through
    // SELECT_OFFER without fabricating a real booking.
    const journeyId = randomUUID();
    const tripId = randomUUID();
    const travellerId = randomUUID();
    const itemId = randomUUID();
    const serviceId = randomUUID();
    const offerId = randomUUID();
    const offerPrice = { amount: '432.10', currency: 'USD' as const };
    const journey: WJourney = {
      id: journeyId, revision: 1, tripId, travellerId,
      lifecycleStatus: 'ACTIVE', intendedWindow: null, responsibilityOrganisationId: null,
    };
    const anchorObjective: WObjective = {
      id: randomUUID(), revision: 1, owner: { kind: 'JOURNEY', id: journeyId },
      successPredicateKind: 'STATEMENT', hardness: 'HARD', priority: 1,
      disposition: 'ACHIEVED', dispositionEvidenceId: null, targets: [],
    };
    const item: WJourneyItem = {
      id: itemId, journeyId, kind: 'TRANSPORT', orderKey: '010', lifecycleStatus: 'DROPPED', flexible: false, intendedWindow: null,
      desiredOriginPlaceId: 'p-a', desiredDestinationPlaceId: 'p-b', selectedServiceId: null, intendedPlaceId: null, requiredNights: null,
      participationId: null, standaloneTitle: null, standaloneWindow: null, resourceId: null, intendedLocationPlaceId: null,
    };
    const service: WTransportService = {
      id: serviceId, revision: 1, mode: 'AIR', operator: 'op', originPlaceId: 'p-a', destinationPlaceId: 'p-b',
      published: { departure: null, arrival: null }, estimated: { departure: null, arrival: null }, actual: { departure: null, arrival: null },
    };
    const world = emptyWorld({
      journeys: [journey], objectives: [anchorObjective], journeyItems: [item], transportServices: [service],
      focus: [{ kind: 'JOURNEY', id: journeyId }],
    });
    const scenarioChange = ScenarioChangeSchema.parse({
      id: randomUUID(), recoveryStrategyId: randomUUID(), strategyVersion: 1,
      affectedSubjectRefs: [{ kind: 'JOURNEY_ITEM', id: itemId }],
      basisAssessmentId: randomUUID(),
      effects: [{ effectKind: 'SELECT_OFFER', journeyItemId: itemId, offerId, offerPrice }],
    });
    const evaluated = evaluateRecoveryStrategy({
      recoveryCaseId: opened.caseId, baseWorld: world, baseManifest: emptyManifest(),
      basisAssessmentId: scenarioChange.basisAssessmentId, scenarioChange, now: NOW,
      resolvedOffers: [{ offerId, transportServiceId: serviceId }],
    });
    assert.equal(evaluated.ok, true);
    if (!evaluated.ok) return;
    assert.equal(evaluated.value.strategy.viability, 'VIABLE');

    const compiled = compileActionPlan({
      strategy: evaluated.value.strategy, now: NOW,
      capabilities: [{ capabilityRef: 'external:offer.select', supported: true }],
    });
    assert.equal(compiled.ok, true);
    if (!compiled.ok) return;
    const plan = compiled.value.plan;
    const compiledIntent = plan.intents[0]!;
    assert.equal(compiledIntent.capabilityRef, 'external:offer.select');
    // The compiler carried the caller-supplied offer price straight onto the
    // ActionIntent — not re-derived, not invented, not a second cost source.
    assert.deepEqual(compiledIntent.costEstimate, offerPrice);

    const persisted = mustOk(await persistActionPlan(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), plan,
    }));
    assert.deepEqual(persisted.intentIds, [compiledIntent.id]);

    const persistedRow = await pool.query<{ cost_amount: string; cost_currency: string }>(
      'SELECT cost_amount, cost_currency FROM action_intents WHERE workspace_id = $1 AND id = $2',
      [seed.workspaceId, compiledIntent.id],
    );
    assert.equal(persistedRow.rows[0]?.cost_amount, offerPrice.amount);
    assert.equal(persistedRow.rows[0]?.cost_currency, offerPrice.currency);

    // --- M8's budget hold uses EXACTLY the persisted (DB-read) cost, not the
    // in-memory compiled object and not a hand-typed literal — proving the
    // round trip, not just the in-memory shape. ---
    const budgetId = randomUUID();
    mustOk(await createBudget(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(),
      budget: { id: budgetId, organisationId, purpose: 'travel', amount: { amount: '1000.00', currency: 'USD' } },
    }));
    const hold = mustOk(await holdBudgetForIntent(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(),
      budgetId, expectedBudgetRevision: 1, actionIntentId: compiledIntent.id,
      requested: { amount: persistedRow.rows[0]!.cost_amount, currency: persistedRow.rows[0]!.cost_currency as 'USD' },
    }));
    assert.equal(hold.holdAmount.amount, offerPrice.amount);
    assert.equal(hold.holdAmount.currency, offerPrice.currency);

    const commitments = await pool.query<{ amount: string; currency: string; action_intent_id: string }>(
      `SELECT amount::text AS amount, currency, action_intent_id FROM budget_commitments
        WHERE workspace_id = $1 AND budget_id = $2`,
      [seed.workspaceId, budgetId],
    );
    assert.equal(commitments.rowCount, 1, 'exactly one budget commitment, no duplicate cost representation');
    assert.equal(commitments.rows[0]?.action_intent_id, compiledIntent.id);
    assert.equal(commitments.rows[0]?.amount, offerPrice.amount);
    assert.equal(commitments.rows[0]?.currency, offerPrice.currency);
  });
});

describe('acceptance #8: unsupported provider capability — planner compiles, executor refuses truthfully', () => {
  test('SELECT_OFFER compiles under a planner-side supported:true capability statement, but the executor observes supported:false and never invokes the dispatcher', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'M7-M8 capability refusal: SELECT_OFFER');
    const seededTraveller = await seedTraveller(seed, { displayName: 'Capability Traveller' });
    const tripId = await seedTrip(seed);
    const journeyId = await seedJourney(seed, { tripId, travellerId: seededTraveller.travellerId });
    const originPlaceId = await seedUnlocatedPlace(seed, 'Capability origin');
    const destinationPlaceId = await seedUnlocatedPlace(seed, 'Capability destination');
    const itemId = await seedTransportIntent(seed, {
      journeyId, orderKey: '010', originPlaceId, destinationPlaceId, lifecycleStatus: 'DROPPED',
    });
    const offerId = randomUUID();
    await seedRootSubject(seed, { kind: 'OFFER', id: offerId });
    await seed.client.query(
      `INSERT INTO offers (workspace_id, id, source_id, price_amount, price_currency, quoted_at, expires_at, fingerprint, created_by_actor_id)
       VALUES ($1, $2, 'test-source', 100, 'USD', '2030-01-01T00:00:00Z', '2030-02-01T00:00:00Z', $3, $4)`,
      [seed.workspaceId, offerId, offerId, seed.actorId],
    );
    await commitSeed(seed);

    const uow = () => new PgUnitOfWork(pool, seed.workspaceId);
    const opened = mustOk(await openRecoveryCase(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), openedAt: NOW,
    }));

    // Real M7 pipeline. See file header: a SELECT_OFFER target must be a
    // DROPPED (inactive) JourneyItem to get a real VIABLE strategy without
    // fabricating a booking — effectiveItinerary.ts excludes DROPPED/
    // COMPLETED items from m6.booking's supplier_fulfilment and from the
    // places/advisories evaluators, while applyScenarioOverlay's SELECT_OFFER
    // handling itself does not gate on lifecycle status, so the proposed
    // offer selection still applies and still compiles for real.
    const travellerId = seededTraveller.travellerId;
    const serviceId = randomUUID();
    const journey: WJourney = {
      id: journeyId, revision: 1, tripId, travellerId,
      lifecycleStatus: 'ACTIVE', intendedWindow: null, responsibilityOrganisationId: null,
    };
    const anchorObjective: WObjective = {
      id: randomUUID(), revision: 1, owner: { kind: 'JOURNEY', id: journeyId },
      successPredicateKind: 'STATEMENT', hardness: 'HARD', priority: 1,
      disposition: 'ACHIEVED', dispositionEvidenceId: null, targets: [],
    };
    const item: WJourneyItem = {
      id: itemId, journeyId, kind: 'TRANSPORT', orderKey: '010', lifecycleStatus: 'DROPPED', flexible: false, intendedWindow: null,
      desiredOriginPlaceId: originPlaceId, desiredDestinationPlaceId: destinationPlaceId, selectedServiceId: null, intendedPlaceId: null, requiredNights: null,
      participationId: null, standaloneTitle: null, standaloneWindow: null, resourceId: null, intendedLocationPlaceId: null,
    };
    const service: WTransportService = {
      id: serviceId, revision: 1, mode: 'AIR', operator: 'op', originPlaceId, destinationPlaceId,
      published: { departure: null, arrival: null }, estimated: { departure: null, arrival: null }, actual: { departure: null, arrival: null },
    };
    const world = emptyWorld({
      journeys: [journey], objectives: [anchorObjective], journeyItems: [item], transportServices: [service],
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
      resolvedOffers: [{ offerId, transportServiceId: serviceId }],
    });
    assert.equal(evaluated.ok, true);
    if (!evaluated.ok) return;
    assert.equal(evaluated.value.strategy.viability, 'VIABLE');

    // The PLANNER is told the capability IS supported — compileActionPlan
    // succeeds for real (never CAPABILITY_UNSUPPORTED here; that refusal is
    // already covered by the M7-only unit test). The executor is the one
    // that will discover the truth below.
    const compiled = compileActionPlan({
      strategy: evaluated.value.strategy, now: NOW,
      capabilities: [{ capabilityRef: 'external:offer.select', supported: true }],
    });
    assert.equal(compiled.ok, true);
    if (!compiled.ok) return;
    const plan = compiled.value.plan;
    const compiledIntent = plan.intents[0]!;
    assert.equal(compiledIntent.capabilityRef, 'external:offer.select');
    assert.equal(compiledIntent.status, 'PROPOSED');

    await persistStrategyChangeRow(pool, seed.workspaceId, seed.actorId, opened.caseId, scenarioChange, {
      baseManifest: tripBaseManifest(tripId, 1),
      candidateSummaries: [{ subjectRef: { kind: 'JOURNEY', id: journeyId } }],
    });
    const persisted = mustOk(await persistActionPlan(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), plan,
      recoveryStrategyId: scenarioChange.recoveryStrategyId,
    }));
    assert.deepEqual(persisted.intentIds, [compiledIntent.id]);

    // --- M8 authority, exactly as usual. ---
    const principalId = randomUUID();
    mustOk(await createPrincipal(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(),
      principalId, actorType: 'HUMAN', authIssuer: 'https://issuer.invalid/capability-refusal', authSubject: principalId,
    }));
    const requiredAuthorityScopes = await loadRequiredAuthorityScopesOrFail(pool, seed.workspaceId, compiledIntent.id);
    const decisionScope = unionTypedRefs([{ kind: 'TRAVELLER', id: travellerId }], requiredAuthorityScopes);
    const envelopeInput: EnvelopeFingerprintInput = {
      actionPlanId: plan.id, actionPlanVersion: 1, actionIntentId: compiledIntent.id, actionIntentVersion: 1,
      requiredActorRoles: ['CASE_OWNER'], scope: decisionScope, grantRefs: [], ruleInputs: [],
    };
    const fingerprint = computeEnvelopeFingerprint(envelopeInput);
    const decision = mustOk(await issueAuthorityDecision(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(),
      envelopeInput, requirements: [{ actorRole: 'CASE_OWNER' }], issuedAt: NOW,
    }));
    // ISSUER-POL: one authorised issuer for this workspace's fixture, scoped
    // to cover the decision scope the approver grant is about to target (see
    // the other acceptance test's comment on the represented-party kind).
    const issuerRepresentedParty = { kind: 'TRAVELLER' as const, id: travellerId };
    const issuerPrincipalId = await bootstrapTestGrantIssuer(
      pool, seed.workspaceId, seed.actorId, NOW,
      [issuerRepresentedParty, ...decisionScope.filter(
        (r) => !(r.kind === issuerRepresentedParty.kind && r.id === issuerRepresentedParty.id),
      )],
    );
    await issueApproverGrant(uow(), {
      workspaceId: seed.workspaceId, actorId: seed.actorId, principalId,
      representedPartyRef: { kind: 'TRAVELLER', id: travellerId },
      scopes: decisionScope,
      issuerPrincipalId,
    });
    const approval = mustOk(await recordApproval(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: principalId, idempotencyKey: randomUUID(),
      decisionId: decision.decisionId, requirementId: decision.requirementIds[0]!,
      envelopeFingerprint: fingerprint, scope: decisionScope, approvedAt: NOW,
    }));
    const decisionObj: AuthorityDecision = {
      id: decision.decisionId, actionPlanId: plan.id, actionPlanVersion: 1, actionIntentId: compiledIntent.id, actionIntentVersion: 1,
      groupOperator: 'AND', requirements: [{ id: decision.requirementIds[0]!, actorRole: 'CASE_OWNER' }],
    };
    const approvalObj: Approval = {
      id: approval.approvalId, requirementId: decision.requirementIds[0]!, approverPrincipalId: principalId,
      envelopeFingerprint: fingerprint, scope: decisionScope, approvedAt: NOW,
    };
    const envelope: AuthorityEnvelope = {
      id: decision.decisionId, actionPlanId: plan.id, actionPlanVersion: 1, actionIntentId: compiledIntent.id, actionIntentVersion: 1,
      requiredActors: [{ id: decision.requirementIds[0]!, actorRole: 'CASE_OWNER' }], scope: decisionScope,
      grantRefs: [], ruleInputs: [], issuedAt: NOW, fingerprint,
    };
    const grant: AuthorityGrant = {
      id: randomUUID(), principalId, representedPartyRef: { kind: 'TRAVELLER', id: travellerId },
      issuedByPrincipalId: principalId, issuedAt: NOW,
      actions: ['action.intent.dispatch', 'action.intent.authorize'], scopes: decisionScope,
    };
    const authorization: DispatchAuthorizationInput = {
      assessmentView: currentAssessmentView(), envelopeInput, envelope, decision: decisionObj,
      approvals: [approvalObj], revocations: [], grants: [grant], requiredActionKind: 'action.intent.dispatch',
      principalId, now: NOW,
      requiredAuthorityScopes,
    };
    const preAuth = authorizeDispatch(authorization);
    assert.equal(preAuth.allowed, true);

    await seedStoredExecutionAuthority({
      pool, workspaceId: seed.workspaceId, actorId: seed.actorId, principalId,
      planId: plan.id, intentId: compiledIntent.id,
      scope: envelopeInput.scope,
      representedPartyRef: { kind: 'TRAVELLER', id: travellerId },
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

    // --- The executor is the one that discovers the truth: the observed
    // capability is unsupported. The dispatcher must NEVER be invoked, and
    // the outcome must be FAILED — no fabricated success. ---
    const worker = new PgExecutionWorker(pool, { actorId: 'worker-capability-refusal' });
    const claim = await worker.claimNext(seed.workspaceId);
    assert.ok(claim);
    let dispatcherInvoked = false;
    const result = await worker.dispatchClaimed(claim!, {
      principalId, now: EXEC_NOW,
      observed: { capabilityKind: 'SERVICE', supported: false },
      dispatcher: async () => {
        dispatcherInvoked = true;
        return { kind: 'SUCCESS', responseRef: 'should-never-happen', sourceOwnedFields: {} };
      },
    });
    assert.equal(dispatcherInvoked, false, 'the dispatcher must never be invoked once capability is observed unsupported');
    assert.equal(result.outcome, 'FAILED');

    const attemptRow = await pool.query<{ status: string; last_error: string | null }>(
      'SELECT status, last_error FROM execution_attempts WHERE id = $1', [claim!.id],
    );
    assert.equal(attemptRow.rows[0]?.status, 'FAILED');
    assert.match(attemptRow.rows[0]?.last_error ?? '', /CAPABILITY_UNSUPPORTED/);

    // The planner's ActionIntent status is the immutable planning disposition
    // — execution truth lives entirely in execution_attempts above, never here.
    const intentRow = await pool.query<{ status: string }>(
      'SELECT status FROM action_intents WHERE workspace_id = $1 AND id = $2',
      [seed.workspaceId, compiledIntent.id],
    );
    assert.equal(intentRow.rows[0]?.status, 'PROPOSED');
  });
});

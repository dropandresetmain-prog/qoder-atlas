/**
 * M7 + M8 cross-lane integration acceptance proofs.
 *
 * Neither M7's nor M8's own isolated test suite can prove these — they only
 * exist once a REAL M7-compiled ActionPlan (via evaluateRecoveryStrategy +
 * compileActionPlan, exactly as src/resolution/planning/compiler.ts produces
 * it) is persisted and authorized through the REAL M8 path
 * (persistActionPlan -> issueAuthorityDecision -> recordApproval ->
 * authorizeDispatch -> createPreparedExecutionAttempt), never a hand-built
 * stand-in ActionPlan object.
 *
 * VIABILITY RECIPE (docs/work/M7_M8_INTEGRATION_ACTIVE_TASK.md): an empty
 * CapturedWorld's overall verdict is UNKNOWN, not PASS (no dimension is
 * blocking+resolved). To get a real, reproducible VIABLE strategy without
 * hand-modelling reachability/jurisdiction data:
 *  - add one "anchor" HARD objective with disposition ACHIEVED on the
 *    journey under test -> objective.ts short-circuits to a blocking PASS
 *    (`hard_objectives`, reasonCode `objective_achieved`) regardless of any
 *    other world content;
 *  - keep any programme participation OPTIONAL (not REQUIRED) when its
 *    reachability inputs (place/transport/service) are not modelled, so its
 *    UNKNOWN (`participation_schedule_unknown`) lands on the non-blocking
 *    `optional_participation` dimension instead of the blocking
 *    `programme_participation` one.
 * A lone non-blocking PASS (e.g. `waived_objectives`) is NOT enough by
 * itself — overallVerdictFromDimensions needs at least one BLOCKING
 * dimension to resolve PASS, and any blocking UNKNOWN beats any PASS.
 * Verified empirically against the real evaluator registry before writing
 * these tests (not guessed).
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed, seedTraveller, seedTrip, seedJourney } from './m2Seed.ts';
import { seedEvent, seedProgramme, seedProgrammeItem, seedParticipation } from './m4Seed.ts';
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
  type DispatchAuthorizationInput,
} from '../src/persistence/postgres/commands/m8AuthorityCommands.ts';
import { executeInternalProgrammeItemSchedule } from '../src/persistence/postgres/execution/internalProgrammeExecutor.ts';
import { computeEnvelopeFingerprint, type EnvelopeFingerprintInput } from '../src/resolution/authority/envelope.ts';
import { evaluateRecoveryStrategy } from '../src/resolution/scenarios/evaluate.ts';
import { compileActionPlan } from '../src/resolution/planning/compiler.ts';
import { ScenarioChangeSchema } from '../src/contracts/v2/scenario/scenarioChange.ts';
import { emptyWorld } from '../test/support/m6World.ts';
import type { WorldSnapshotManifest } from '../src/contracts/v2/scope/readScope.ts';
import type { WJourney, WObjective, WProgrammeItem, WParticipation } from '../src/resolution/world/world.ts';
import type { AuthorityEnvelope, AuthorityDecision, Approval } from '../src/contracts/v2/authority/authorityEnvelope.ts';
import type { AssessmentView } from '../src/persistence/postgres/world/pgAssessments.ts';
import type { AuthorityGrant } from '../src/domain/v2/people/traveller.ts';
import {
  loadRequiredAuthorityScopesOrFail,
  prepareParams,
  persistStrategyChangeRow,
  seedStoredExecutionAuthority,
  tripBaseManifest,
  unionTypedRefs,
} from './m8ExecutionGateHelpers.ts';

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

describe('acceptance #1 + #4: real M7 ActionIntent shape, objective-loss authority, unrelated mandatory constraint', () => {
  test('objective-loss proposal viable only via M6 waived_objectives semantics; unrelated HARD objective stays mandatory; M8 authorizes the exact compiled intent', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'M7-M8 seam: objective loss');
    const traveller = await seedTraveller(seed, { displayName: 'Seam Traveller' });
    const tripId = await seedTrip(seed, { purpose: 'TEST', lifecycleStatus: 'ACTIVE' });
    const journeyId = await seedJourney(seed, { tripId, travellerId: traveller.travellerId, lifecycleStatus: 'ACTIVE' });
    await commitSeed(seed);

    const principalId = randomUUID();
    const uow = () => new PgUnitOfWork(pool, seed.workspaceId);
    mustOk(await createPrincipal(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(),
      principalId, actorType: 'HUMAN', authIssuer: 'https://issuer.invalid/seam', authSubject: principalId,
    }));
    const opened = mustOk(await openRecoveryCase(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), openedAt: NOW,
    }));

    // --- Real M7 pipeline: an UNRELATED mandatory HARD objective (already
    // ACHIEVED) plus the objective actually being proposed for loss. ---
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
      effects: [{ effectKind: 'WAIVE_OBJECTIVE', objectiveId, rationale: 'seam test loss', disposition: 'CLOSED_WITH_LOSS' }],
    });
    const evaluated = evaluateRecoveryStrategy({
      recoveryCaseId: opened.caseId, baseWorld: world, baseManifest: emptyManifest(),
      basisAssessmentId: scenarioChange.basisAssessmentId, scenarioChange, now: NOW,
    });
    assert.equal(evaluated.ok, true);
    if (!evaluated.ok) return;
    // Proves M6 semantics, not the planner's say-so, made this viable.
    assert.equal(evaluated.value.strategy.viability, 'VIABLE');
    // The unrelated objective's ACHIEVED disposition is untouched by the
    // proposal — it is a real, independent mandatory PASS, not fabricated.
    assert.equal(evaluated.value.proposedWorld.objectives.find((o) => o.id === unrelatedObjectiveId)?.disposition, 'ACHIEVED');
    assert.equal(evaluated.value.proposedWorld.objectives.find((o) => o.id === objectiveId)?.disposition, 'CLOSED_WITH_LOSS');
    // Canonical world (pre-overlay) never saw the loss — it is proposed only.
    assert.equal(world.objectives.find((o) => o.id === objectiveId)?.disposition, 'ACTIVE');
    assert.ok(evaluated.value.strategy.requiredAuthorityScopes.includes('objective.disposition:CLOSED_WITH_LOSS'));

    const compiled = compileActionPlan({ strategy: evaluated.value.strategy, now: NOW });
    assert.equal(compiled.ok, true);
    if (!compiled.ok) return;
    const plan = compiled.value.plan;
    assert.equal(plan.intents.length, 1);
    const compiledIntent = plan.intents[0]!;
    assert.equal(compiledIntent.capabilityRef, 'internal:objective.disposition');
    assert.ok(compiledIntent.requiredAuthorityScopes.includes('objective.disposition:CLOSED_WITH_LOSS'));

    mustOk(await recordObjective(uow(), {
      workspaceId: seed.workspaceId,
      actorPrincipalId: seed.actorId,
      idempotencyKey: randomUUID(),
      objectiveId,
      ownerKind: 'JOURNEY',
      ownerId: journeyId,
      successPredicate: 'seam objective loss',
      hardness: 'HARD',
      priority: 1,
      disposition: 'ACTIVE',
    }));

    await persistStrategyChangeRow(pool, seed.workspaceId, seed.actorId, opened.caseId, scenarioChange, {
      baseManifest: tripBaseManifest(tripId, 1),
      candidateSummaries: [{ subjectRef: { kind: 'JOURNEY', id: journeyId } }],
    });

    // --- M8 persists the compiled plan verbatim: no second ActionIntent representation. ---
    const persisted = mustOk(await persistActionPlan(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), plan,
      recoveryStrategyId: scenarioChange.recoveryStrategyId,
    }));
    assert.deepEqual(persisted.intentIds, [compiledIntent.id]);

    const row = await pool.query<{
      operation_namespace: string; logical_operation_key: string; request_fingerprint: string;
      capability_ref: string; status: string; required_authority_scopes: unknown;
      compensation_supported: boolean; compensation_requires_separate_authority: boolean;
    }>(
      `SELECT operation_namespace, logical_operation_key, request_fingerprint, capability_ref, status,
              required_authority_scopes, compensation_supported, compensation_requires_separate_authority
         FROM action_intents WHERE workspace_id = $1 AND id = $2`,
      [seed.workspaceId, compiledIntent.id],
    );
    const persistedIntent = row.rows[0]!;
    assert.equal(persistedIntent.operation_namespace, compiledIntent.operationNamespace);
    assert.equal(persistedIntent.logical_operation_key, compiledIntent.logicalOperationKey);
    assert.equal(persistedIntent.request_fingerprint, compiledIntent.requestFingerprint);
    assert.equal(persistedIntent.capability_ref, compiledIntent.capabilityRef);
    assert.equal(persistedIntent.status, compiledIntent.status);
    assert.deepEqual(persistedIntent.required_authority_scopes, compiledIntent.requiredAuthorityScopes);
    assert.equal(persistedIntent.compensation_supported, compiledIntent.compensationPolicy.supported);
    assert.equal(persistedIntent.compensation_requires_separate_authority, compiledIntent.compensationPolicy.requiresSeparateAuthority);

    // --- The objective-loss disposition is NOT effective merely because M7
    // proposed it — M8 authority is required before it can be accepted. ---
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

    // No approval yet: dispatch must be denied.
    const deniedNoApproval = authorizeDispatch({
      assessmentView: currentAssessmentView(), envelopeInput, envelope, decision: decisionObj,
      approvals: [], revocations: [], grants: [grant], requiredActionKind: 'action.intent.dispatch',
      principalId, now: NOW,
      requiredAuthorityScopes,
    });
    assert.equal(deniedNoApproval.allowed, false);
    if (!deniedNoApproval.allowed) assert.equal(deniedNoApproval.reason, 'APPROVALS_INCOMPLETE');

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
    const allowed = authorizeDispatch({
      assessmentView: currentAssessmentView(), envelopeInput, envelope, decision: decisionObj,
      approvals: [approvalObj], revocations: [], grants: [grant], requiredActionKind: 'action.intent.dispatch',
      principalId, now: NOW,
      requiredAuthorityScopes,
    });
    assert.equal(allowed.allowed, true);

    // --- Durable execution accepts the real compiled+persisted intent identity. ---
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
    const attempt = mustOk(await createPreparedExecutionAttempt(uow(), prepareParams({
      workspaceId: seed.workspaceId, actorId: seed.actorId,
      planId: plan.id, intentId: compiledIntent.id, principalId, now: EXEC_NOW,
    })));
    const attemptRow = await pool.query<{ logical_operation_key: string; request_fingerprint: string; status: string }>(
      'SELECT logical_operation_key, request_fingerprint, status FROM execution_attempts WHERE id = $1',
      [attempt.attemptId],
    );
    assert.equal(attemptRow.rows[0]?.logical_operation_key, compiledIntent.logicalOperationKey);
    assert.equal(attemptRow.rows[0]?.request_fingerprint, compiledIntent.requestFingerprint);
    assert.equal(attemptRow.rows[0]?.status, 'PREPARED');
  });
});

describe('acceptance #3: programme recovery end-to-end (proposal -> candidate viability -> authority -> durable internal execution -> programme mutation)', () => {
  test('a generic internal ProgrammeItem reschedule flows through M7 compile, M8 authority and the real M4 command', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'M7-M8 seam: programme recovery');
    const traveller = await seedTraveller(seed, { displayName: 'Programme Traveller' });
    const tripId = await seedTrip(seed, { purpose: 'TEST', lifecycleStatus: 'ACTIVE' });
    const journeyId = await seedJourney(seed, { tripId, travellerId: traveller.travellerId, lifecycleStatus: 'ACTIVE' });
    const eventId = await seedEvent(seed, { lifecycleStatus: 'ACTIVE' });
    const programmeId = await seedProgramme(seed, { eventId, lifecycleStatus: 'ACTIVE' });
    const originalWindow = { start: '2031-09-10T10:00:00.000Z', end: '2031-09-10T11:00:00.000Z' };
    const { programmeItemId } = await seedProgrammeItem(seed, {
      programmeId, lifecycleStatus: 'SCHEDULED', scheduleAuthority: 'INTERNAL', window: originalWindow,
    });
    await seedParticipation(seed, { programmeItemId, travellerId: traveller.travellerId, obligation: 'OPTIONAL', accepted: true });
    await commitSeed(seed);

    const principalId = randomUUID();
    const uow = () => new PgUnitOfWork(pool, seed.workspaceId);
    mustOk(await createPrincipal(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(),
      principalId, actorType: 'HUMAN', authIssuer: 'https://issuer.invalid/seam-prog', authSubject: principalId,
    }));
    const opened = mustOk(await openRecoveryCase(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), openedAt: NOW,
    }));

    // --- Real M7 pipeline. An unrelated ACHIEVED HARD objective supplies the
    // blocking PASS the M6 registry needs; participation stays OPTIONAL since
    // reachability (place/transport) is not modelled here — see file header. ---
    const anchorObjectiveId = randomUUID();
    const proposedWindow = { start: '2031-09-10T14:00:00.000Z', end: '2031-09-10T15:00:00.000Z' };
    const journey: WJourney = {
      id: journeyId, revision: 1, tripId, travellerId: traveller.travellerId,
      lifecycleStatus: 'ACTIVE', intendedWindow: null, responsibilityOrganisationId: null,
    };
    const anchorObjective: WObjective = {
      id: anchorObjectiveId, revision: 1, owner: { kind: 'JOURNEY', id: journeyId },
      successPredicateKind: 'STATEMENT', hardness: 'HARD', priority: 1,
      disposition: 'ACHIEVED', dispositionEvidenceId: null, targets: [],
    };
    const worldProgrammeItem: WProgrammeItem = {
      id: programmeItemId, programmeId, title: 'Seam item', itemType: 'SESSION', placeId: null,
      window: originalWindow, lifecycleStatus: 'SCHEDULED', scheduleAuthority: 'INTERNAL',
    };
    const worldParticipation: WParticipation = {
      id: randomUUID(), programmeItemId, travellerId: traveller.travellerId,
      obligation: 'OPTIONAL', accepted: true, preparationWindow: null,
    };
    const world = emptyWorld({
      journeys: [journey],
      objectives: [anchorObjective],
      programmes: [{ id: programmeId, revision: 1, eventId, title: 'e', lifecycleStatus: 'ACTIVE' }],
      programmeItems: [worldProgrammeItem],
      participations: [worldParticipation],
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
    assert.equal(evaluated.value.strategy.viability, 'VIABLE');

    const compiled = compileActionPlan({ strategy: evaluated.value.strategy, now: NOW });
    assert.equal(compiled.ok, true);
    if (!compiled.ok) return;
    const plan = compiled.value.plan;
    const compiledIntent = plan.intents[0]!;
    assert.equal(compiledIntent.capabilityRef, 'internal:programme.schedule');

    await persistStrategyChangeRow(pool, seed.workspaceId, seed.actorId, opened.caseId, scenarioChange, {
      baseManifest: tripBaseManifest(tripId, 1),
      candidateSummaries: [{ subjectRef: { kind: 'JOURNEY', id: journeyId } }],
    });
    const persisted = mustOk(await persistActionPlan(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), plan,
      recoveryStrategyId: scenarioChange.recoveryStrategyId,
    }));
    assert.deepEqual(persisted.intentIds, [compiledIntent.id]);

    // --- M8 authority ---
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
      id: randomUUID(), principalId, representedPartyRef: { kind: 'TRAVELLER', id: traveller.travellerId },
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

    // --- Durable internal execution: the REAL M4 command mutates the REAL programme_items row. ---
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
    const result = mustOk(await executeInternalProgrammeItemSchedule(pool, uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(),
      planId: plan.id, intentId: compiledIntent.id, attemptNumber: 1,
      principalId, now: EXEC_NOW,
    }));

    const attemptRow = await pool.query<{ status: string }>(
      'SELECT status FROM execution_attempts WHERE id = $1', [result.attemptId],
    );
    assert.equal(attemptRow.rows[0]?.status, 'OBSERVED_SUCCESS');

    const observationRow = await pool.query<{ origin: string; command_receipt_ref: string | null }>(
      'SELECT origin, command_receipt_ref FROM execution_observations WHERE id = $1', [result.observationId],
    );
    assert.equal(observationRow.rows[0]?.origin, 'INTERNAL_COMMAND_RECEIPT');
    assert.ok(observationRow.rows[0]?.command_receipt_ref);

    const itemRow = await pool.query<{ window_start: string; window_end: string }>(
      'SELECT window_start, window_end FROM programme_items WHERE workspace_id = $1 AND id = $2',
      [seed.workspaceId, programmeItemId],
    );
    assert.equal(new Date(itemRow.rows[0]!.window_start).toISOString(), proposedWindow.start);
    assert.equal(new Date(itemRow.rows[0]!.window_end).toISOString(), proposedWindow.end);

    // The planner's ActionIntent status is the immutable planning disposition
    // — execution truth lives entirely in execution_attempts/observations above.
    const intentRow = await pool.query<{ status: string }>(
      'SELECT status FROM action_intents WHERE workspace_id = $1 AND id = $2',
      [seed.workspaceId, compiledIntent.id],
    );
    assert.equal(intentRow.rows[0]?.status, compiledIntent.status);
  });
});

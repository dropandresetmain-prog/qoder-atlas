/**
 * M7 + M8 cross-lane acceptance proofs #5 and #10 (see
 * m7m8IntegrationSeam.pgtest.ts for the general recipe and viability notes
 * this file reuses verbatim — read that file's header first).
 *
 * #5 — Multi-intent DAG: dependencies enforced during M8 execution. Building
 *      this test found createPreparedExecutionAttempt never consulted
 *      action_dependencies at all (a downstream intent could dispatch before
 *      its prerequisite completed) — fixed in
 *      src/persistence/postgres/commands/m8AuthorityCommands.ts as part of
 *      this integration (docs/work/M7_M8_INTEGRATION_ACTIVE_TASK.md); this
 *      test now proves the fixed behavior against the real code.
 * #10 — The same evaluate/compile/persist/authorize engine handles two
 *        materially different recovery scenarios (cross-lane, persisted
 *        version of the M7-only unit test of the same name).
 *
 * VIABILITY RECIPE reused from m7m8IntegrationSeam.pgtest.ts: an "anchor"
 * HARD objective with disposition ACHIEVED supplies the one blocking PASS
 * the M6 registry needs (objective.ts short-circuits it to
 * `hard_objectives`/`objective_achieved`, independent of the scenario under
 * test); any programme Participation stays OPTIONAL since reachability
 * (place/transport/service) is not modelled, so its UNKNOWN lands on the
 * non-blocking `optional_participation` dimension. Verified empirically with
 * a throwaway `npx tsx` script against the real evaluator registry before
 * writing this file (deleted afterward, per instructions) — see the
 * candidate PASS/dependency-order output confirmed for the DAG fixture below.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed, seedTraveller, seedTrip, seedJourney } from './m2Seed.ts';
import { seedEvent, seedProgramme, seedProgrammeItem, seedParticipation } from './m4Seed.ts';
import { PgUnitOfWork, type ExecuteOutcome } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { createPrincipal } from '../src/persistence/postgres/commands/peopleCommands.ts';
import {
  openRecoveryCase,
  persistActionPlan,
  issueAuthorityDecision,
  recordApproval,
  authorizeDispatch,
  createPreparedExecutionAttempt,
} from '../src/persistence/postgres/commands/m8AuthorityCommands.ts';
import { computeEnvelopeFingerprint, type EnvelopeFingerprintInput } from '../src/resolution/authority/envelope.ts';
import { evaluateRecoveryStrategy } from '../src/resolution/scenarios/evaluate.ts';
import { compileActionPlan } from '../src/resolution/planning/compiler.ts';
import { ScenarioChangeSchema, type ScenarioChange } from '../src/contracts/v2/scenario/scenarioChange.ts';
import { emptyWorld } from '../test/support/m6World.ts';
import type {
  WJourney, WObjective, WProgrammeItem, WParticipation, WReservationLine, WTraveller,
} from '../src/resolution/world/world.ts';
import type { CapturedWorld } from '../src/resolution/world/world.ts';
import type { WorldSnapshotManifest } from '../src/contracts/v2/scope/readScope.ts';
import type { AuthorityEnvelope, AuthorityDecision, Approval } from '../src/contracts/v2/authority/authorityEnvelope.ts';
import type { AssessmentView } from '../src/persistence/postgres/world/pgAssessments.ts';
import type { AuthorityGrant } from '../src/domain/v2/people/traveller.ts';
import type { TypedRef } from '../src/domain/v2/shared/identity.ts';
import type { ActionIntent } from '../src/contracts/v2/action/actionPlan.ts';
import { prepareParams, seedStoredExecutionAuthority } from './m8ExecutionGateHelpers.ts';

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

/**
 * Generic pipeline runner shared by BOTH acceptance #10 scenarios below.
 * It performs no branching on scenario/effect kind whatsoever — it is handed
 * a fully-built world + ScenarioChange and drives the one real M7/M8 path:
 * evaluateRecoveryStrategy -> compileActionPlan -> persistActionPlan ->
 * issueAuthorityDecision -> recordApproval -> authorizeDispatch. This is the
 * proof that the SAME production code path handles materially different
 * scenarios, not two different code paths.
 */
async function runViableScenarioToAuthorizedDispatch(params: {
  pool: Awaited<ReturnType<typeof sharedTestPool>>;
  workspaceId: string;
  actorId: string;
  recoveryCaseId: string;
  principalId: string;
  travellerId: string;
  world: CapturedWorld;
  scenarioChange: ScenarioChange;
  scope: TypedRef[];
}): Promise<{ compiledIntent: ActionIntent }> {
  const uow = () => new PgUnitOfWork(params.pool, params.workspaceId);

  const evaluated = evaluateRecoveryStrategy({
    recoveryCaseId: params.recoveryCaseId, baseWorld: params.world, baseManifest: emptyManifest(),
    basisAssessmentId: params.scenarioChange.basisAssessmentId, scenarioChange: params.scenarioChange, now: NOW,
  });
  assert.equal(evaluated.ok, true);
  if (!evaluated.ok) throw new Error('unreachable');
  assert.equal(evaluated.value.strategy.viability, 'VIABLE');

  const compiled = compileActionPlan({ strategy: evaluated.value.strategy, now: NOW });
  assert.equal(compiled.ok, true);
  if (!compiled.ok) throw new Error('unreachable');
  const plan = compiled.value.plan;
  assert.equal(plan.intents.length, 1);
  const compiledIntent = plan.intents[0]!;

  const persisted = mustOk(await persistActionPlan(uow(), {
    workspaceId: params.workspaceId, actorPrincipalId: params.actorId, idempotencyKey: randomUUID(), plan,
  }));
  assert.deepEqual(persisted.intentIds, [compiledIntent.id]);

  const envelopeInput: EnvelopeFingerprintInput = {
    actionPlanId: plan.id, actionPlanVersion: 1, actionIntentId: compiledIntent.id, actionIntentVersion: 1,
    requiredActorRoles: ['CASE_OWNER'], scope: params.scope, grantRefs: [], ruleInputs: [],
  };
  const fingerprint = computeEnvelopeFingerprint(envelopeInput);
  const decision = mustOk(await issueAuthorityDecision(uow(), {
    workspaceId: params.workspaceId, actorPrincipalId: params.actorId, idempotencyKey: randomUUID(),
    envelopeInput, requirements: [{ actorRole: 'CASE_OWNER' }], issuedAt: NOW,
  }));
  const approval = mustOk(await recordApproval(uow(), {
    workspaceId: params.workspaceId, actorPrincipalId: params.principalId, idempotencyKey: randomUUID(),
    decisionId: decision.decisionId, requirementId: decision.requirementIds[0]!,
    envelopeFingerprint: fingerprint, scope: envelopeInput.scope, approvedAt: NOW,
  }));
  const decisionObj: AuthorityDecision = {
    id: decision.decisionId, actionPlanId: plan.id, actionPlanVersion: 1, actionIntentId: compiledIntent.id, actionIntentVersion: 1,
    groupOperator: 'AND', requirements: [{ id: decision.requirementIds[0]!, actorRole: 'CASE_OWNER' }],
  };
  const approvalObj: Approval = {
    id: approval.approvalId, requirementId: decision.requirementIds[0]!, approverPrincipalId: params.principalId,
    envelopeFingerprint: fingerprint, scope: envelopeInput.scope, approvedAt: NOW,
  };
  const envelope: AuthorityEnvelope = {
    id: decision.decisionId, actionPlanId: plan.id, actionPlanVersion: 1, actionIntentId: compiledIntent.id, actionIntentVersion: 1,
    requiredActors: [{ id: decision.requirementIds[0]!, actorRole: 'CASE_OWNER' }], scope: envelopeInput.scope,
    grantRefs: [], ruleInputs: [], issuedAt: NOW, fingerprint,
  };
  const grant: AuthorityGrant = {
    id: randomUUID(), principalId: params.principalId, representedPartyRef: { kind: 'TRAVELLER', id: params.travellerId },
    issuedByPrincipalId: params.principalId, issuedAt: NOW, actions: ['action.intent.dispatch'], scopes: envelopeInput.scope,
  };
  const allowed = authorizeDispatch({
    assessmentView: currentAssessmentView(), envelopeInput, envelope, decision: decisionObj,
    approvals: [approvalObj], revocations: [], grants: [grant], requiredActionKind: 'action.intent.dispatch',
    principalId: params.principalId, now: NOW,
  });
  assert.equal(allowed.allowed, true);

  return { compiledIntent };
}

describe('acceptance #5: multi-intent DAG dependencies persist as real data and are enforced by M8 execution', () => {
  test('a PROPOSE_ALLOCATION -> CHANGE_PROGRAMME_ITEM_TIME plan persists both action_intents and the action_dependencies edge; createPreparedExecutionAttempt blocks the downstream intent until the upstream one completes', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'M7-M8 DAG: allocation before programme reschedule');
    const traveller = await seedTraveller(seed, { displayName: 'DAG Traveller' });
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
      principalId, actorType: 'HUMAN', authIssuer: 'https://issuer.invalid/dag', authSubject: principalId,
    }));
    const opened = mustOk(await openRecoveryCase(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), openedAt: NOW,
    }));

    // --- Real M7 pipeline. Two effects of different kinds so the compiler's
    // defaultDependencies() actually emits an edge (same-kind pairs never do
    // — see src/resolution/planning/compiler.ts). An unrelated ACHIEVED HARD
    // objective supplies the blocking PASS; the reservation line is an
    // in-memory CapturedWorld fixture only (PROPOSE_ALLOCATION's overlay only
    // requires the line/traveller to be present in the CapturedWorld, not in
    // real reservation_lines rows — persistActionPlan stores subjectRefs as
    // opaque JSONB with no FK to reservation tables, so nothing here needs
    // seeding beyond what M7 evaluation itself reads). ---
    const anchorObjectiveId = randomUUID();
    const reservationId = randomUUID();
    const reservationLineId = randomUUID();
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
      id: programmeItemId, programmeId, title: 'DAG item', itemType: 'SESSION', placeId: null,
      window: originalWindow, lifecycleStatus: 'SCHEDULED', scheduleAuthority: 'INTERNAL',
    };
    const worldParticipation: WParticipation = {
      id: randomUUID(), programmeItemId, travellerId: traveller.travellerId,
      obligation: 'OPTIONAL', accepted: true, preparationWindow: null,
    };
    const worldTraveller: WTraveller = { id: traveller.travellerId, revision: 1, lifecycleStatus: 'ACTIVE' };
    const reservationLine: WReservationLine = {
      id: reservationLineId, reservationId, productType: 'RESOURCE_USE', observedStatus: 'CONFIRMED',
      observedStatusAt: NOW, evidenceId: null, transportServiceId: null, resourceId: null, placeId: null, interval: null,
    };
    const world = emptyWorld({
      journeys: [journey],
      objectives: [anchorObjective],
      programmes: [{ id: programmeId, revision: 1, eventId, title: 'e', lifecycleStatus: 'ACTIVE' }],
      programmeItems: [worldProgrammeItem],
      participations: [worldParticipation],
      travellers: [worldTraveller],
      reservationLines: [reservationLine],
      focus: [{ kind: 'PROGRAMME_ITEM', id: programmeItemId }],
    });
    const scenarioChange = ScenarioChangeSchema.parse({
      id: randomUUID(), recoveryStrategyId: randomUUID(), strategyVersion: 1,
      affectedSubjectRefs: [{ kind: 'PROGRAMME_ITEM', id: programmeItemId }, { kind: 'RESERVATION_LINE', id: reservationLineId }],
      basisAssessmentId: randomUUID(),
      effects: [
        { effectKind: 'PROPOSE_ALLOCATION', reservationLineId, travellerId: traveller.travellerId },
        { effectKind: 'CHANGE_PROGRAMME_ITEM_TIME', programmeItemId, proposedWindow },
      ],
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
    assert.equal(plan.intents.length, 2);
    const allocIntent = plan.intents.find((i) => i.capabilityRef === 'internal:reservation.allocation')!;
    const programmeIntent = plan.intents.find((i) => i.capabilityRef === 'internal:programme.schedule')!;
    assert.ok(allocIntent);
    assert.ok(programmeIntent);
    // Default ordering rule (compiler.ts defaultDependencies / the M7 DAG unit
    // test): allocation precedes programme moves.
    assert.equal(plan.dependencies.length, 1);
    assert.deepEqual(plan.dependencies[0], {
      fromActionIntentId: allocIntent.id, toActionIntentId: programmeIntent.id,
    });

    // --- Persist verbatim: both ActionIntents AND the dependency edge. ---
    const persisted = mustOk(await persistActionPlan(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), plan,
    }));
    assert.deepEqual(new Set(persisted.intentIds), new Set([allocIntent.id, programmeIntent.id]));

    const intentRows = await pool.query<{ id: string; capability_ref: string }>(
      'SELECT id, capability_ref FROM action_intents WHERE workspace_id = $1 AND action_plan_id = $2 ORDER BY id',
      [seed.workspaceId, plan.id],
    );
    assert.equal(intentRows.rows.length, 2);
    assert.ok(intentRows.rows.some((r) => r.id === allocIntent.id && r.capability_ref === 'internal:reservation.allocation'));
    assert.ok(intentRows.rows.some((r) => r.id === programmeIntent.id && r.capability_ref === 'internal:programme.schedule'));

    const depRows = await pool.query<{ from_action_intent_id: string; to_action_intent_id: string }>(
      'SELECT from_action_intent_id, to_action_intent_id FROM action_dependencies WHERE workspace_id = $1 AND action_plan_id = $2',
      [seed.workspaceId, plan.id],
    );
    assert.equal(depRows.rows.length, 1);
    assert.equal(depRows.rows[0]?.from_action_intent_id, allocIntent.id);
    assert.equal(depRows.rows[0]?.to_action_intent_id, programmeIntent.id);
    // The DAG is real, persisted data — not merely compiler in-memory output.

    // --- Authorize + prepare the UPSTREAM (allocation) intent, and leave its
    // execution_attempts row at PREPARED (never claimed/dispatched/observed). ---
    const upstreamScope: TypedRef[] = [{ kind: 'RESERVATION_LINE', id: reservationLineId }];
    const upstreamEnvelopeInput: EnvelopeFingerprintInput = {
      actionPlanId: plan.id, actionPlanVersion: 1, actionIntentId: allocIntent.id, actionIntentVersion: 1,
      requiredActorRoles: ['CASE_OWNER'], scope: upstreamScope, grantRefs: [], ruleInputs: [],
    };
    const upstreamFingerprint = computeEnvelopeFingerprint(upstreamEnvelopeInput);
    const upstreamDecision = mustOk(await issueAuthorityDecision(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(),
      envelopeInput: upstreamEnvelopeInput, requirements: [{ actorRole: 'CASE_OWNER' }], issuedAt: NOW,
    }));
    const upstreamApproval = mustOk(await recordApproval(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: principalId, idempotencyKey: randomUUID(),
      decisionId: upstreamDecision.decisionId, requirementId: upstreamDecision.requirementIds[0]!,
      envelopeFingerprint: upstreamFingerprint, scope: upstreamEnvelopeInput.scope, approvedAt: NOW,
    }));
    const upstreamGrant: AuthorityGrant = {
      id: randomUUID(), principalId, representedPartyRef: { kind: 'TRAVELLER', id: traveller.travellerId },
      issuedByPrincipalId: principalId, issuedAt: NOW, actions: ['action.intent.dispatch'], scopes: upstreamScope,
    };
    const upstreamAllowed = authorizeDispatch({
      assessmentView: currentAssessmentView(), envelopeInput: upstreamEnvelopeInput,
      envelope: {
        id: upstreamDecision.decisionId, actionPlanId: plan.id, actionPlanVersion: 1, actionIntentId: allocIntent.id, actionIntentVersion: 1,
        requiredActors: [{ id: upstreamDecision.requirementIds[0]!, actorRole: 'CASE_OWNER' }], scope: upstreamScope,
        grantRefs: [], ruleInputs: [], issuedAt: NOW, fingerprint: upstreamFingerprint,
      },
      decision: {
        id: upstreamDecision.decisionId, actionPlanId: plan.id, actionPlanVersion: 1, actionIntentId: allocIntent.id, actionIntentVersion: 1,
        groupOperator: 'AND', requirements: [{ id: upstreamDecision.requirementIds[0]!, actorRole: 'CASE_OWNER' }],
      },
      approvals: [{
        id: upstreamApproval.approvalId, requirementId: upstreamDecision.requirementIds[0]!, approverPrincipalId: principalId,
        envelopeFingerprint: upstreamFingerprint, scope: upstreamScope, approvedAt: NOW,
      }],
      revocations: [], grants: [upstreamGrant], requiredActionKind: 'action.intent.dispatch',
      principalId, now: NOW,
    });
    assert.equal(upstreamAllowed.allowed, true);

    await seedStoredExecutionAuthority({
      pool, workspaceId: seed.workspaceId, actorId: seed.actorId, principalId,
      planId: plan.id, intentId: allocIntent.id,
      scope: upstreamScope,
      representedPartyRef: { kind: 'TRAVELLER', id: traveller.travellerId },
      requirementRole: 'CASE_OWNER',
      now: EXEC_NOW,
    });
    const upstreamAttempt = mustOk(await createPreparedExecutionAttempt(uow(), prepareParams({
      workspaceId: seed.workspaceId, actorId: seed.actorId,
      planId: plan.id, intentId: allocIntent.id, principalId, now: EXEC_NOW,
    })));
    const upstreamAttemptRow = await pool.query<{ status: string }>(
      'SELECT status FROM execution_attempts WHERE id = $1', [upstreamAttempt.attemptId],
    );
    assert.equal(upstreamAttemptRow.rows[0]?.status, 'PREPARED');
    // Deliberately NOT claimed/dispatched/observed — the upstream intent's
    // work is still outstanding when we try the downstream one below.

    // --- DAG ENFORCEMENT (fixed during this integration; see
    // docs/work/M7_M8_INTEGRATION_ACTIVE_TASK.md) ---
    // createPreparedExecutionAttempt (src/persistence/postgres/commands/
    // m8AuthorityCommands.ts) now queries `action_dependencies` for the
    // target intent and requires every prerequisite `from_action_intent_id`
    // to have a terminal-success execution_attempts row
    // (OBSERVED_SUCCESS/COMPLETED) before preparing a downstream attempt; a
    // FAILED/OBSERVED_FAILURE prerequisite blocks it permanently, an
    // in-progress or not-yet-attempted one blocks it until it resolves. The
    // upstream `allocIntent` attempt above is still PREPARED (never
    // claimed/dispatched/observed), so the downstream (programme) intent's
    // prepared execution attempt must be rejected here.
    const downstreamScope: TypedRef[] = [{ kind: 'PROGRAMME_ITEM', id: programmeItemId }];
    const downstreamEnvelopeInput: EnvelopeFingerprintInput = {
      actionPlanId: plan.id, actionPlanVersion: 1, actionIntentId: programmeIntent.id, actionIntentVersion: 1,
      requiredActorRoles: ['CASE_OWNER'], scope: downstreamScope, grantRefs: [], ruleInputs: [],
    };
    const downstreamFingerprint = computeEnvelopeFingerprint(downstreamEnvelopeInput);
    const downstreamDecision = mustOk(await issueAuthorityDecision(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(),
      envelopeInput: downstreamEnvelopeInput, requirements: [{ actorRole: 'CASE_OWNER' }], issuedAt: NOW,
    }));
    const downstreamApproval = mustOk(await recordApproval(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: principalId, idempotencyKey: randomUUID(),
      decisionId: downstreamDecision.decisionId, requirementId: downstreamDecision.requirementIds[0]!,
      envelopeFingerprint: downstreamFingerprint, scope: downstreamEnvelopeInput.scope, approvedAt: NOW,
    }));
    const downstreamGrant: AuthorityGrant = {
      id: randomUUID(), principalId, representedPartyRef: { kind: 'TRAVELLER', id: traveller.travellerId },
      issuedByPrincipalId: principalId, issuedAt: NOW, actions: ['action.intent.dispatch'], scopes: downstreamScope,
    };
    const downstreamAllowed = authorizeDispatch({
      assessmentView: currentAssessmentView(), envelopeInput: downstreamEnvelopeInput,
      envelope: {
        id: downstreamDecision.decisionId, actionPlanId: plan.id, actionPlanVersion: 1, actionIntentId: programmeIntent.id, actionIntentVersion: 1,
        requiredActors: [{ id: downstreamDecision.requirementIds[0]!, actorRole: 'CASE_OWNER' }], scope: downstreamScope,
        grantRefs: [], ruleInputs: [], issuedAt: NOW, fingerprint: downstreamFingerprint,
      },
      decision: {
        id: downstreamDecision.decisionId, actionPlanId: plan.id, actionPlanVersion: 1, actionIntentId: programmeIntent.id, actionIntentVersion: 1,
        groupOperator: 'AND', requirements: [{ id: downstreamDecision.requirementIds[0]!, actorRole: 'CASE_OWNER' }],
      },
      approvals: [{
        id: downstreamApproval.approvalId, requirementId: downstreamDecision.requirementIds[0]!, approverPrincipalId: principalId,
        envelopeFingerprint: downstreamFingerprint, scope: downstreamScope, approvedAt: NOW,
      }],
      revocations: [], grants: [downstreamGrant], requiredActionKind: 'action.intent.dispatch',
      principalId, now: NOW,
    });
    // Authority itself is satisfied (this is not an authority-scope test) —
    // the only question is whether the DAG edge blocks preparation.
    assert.equal(downstreamAllowed.allowed, true);

    await seedStoredExecutionAuthority({
      pool, workspaceId: seed.workspaceId, actorId: seed.actorId, principalId,
      planId: plan.id, intentId: programmeIntent.id,
      scope: downstreamScope,
      representedPartyRef: { kind: 'TRAVELLER', id: traveller.travellerId },
      requirementRole: 'CASE_OWNER',
      now: EXEC_NOW,
    });
    const downstreamAttempt = await createPreparedExecutionAttempt(uow(), prepareParams({
      workspaceId: seed.workspaceId, actorId: seed.actorId,
      planId: plan.id, intentId: programmeIntent.id, principalId, now: EXEC_NOW,
    }));
    assert.equal(downstreamAttempt.ok, false);
    if (!downstreamAttempt.ok) {
      assert.match(downstreamAttempt.conflict.message, /prerequisite intent .* has not completed/);
    }
    const downstreamRows = await pool.query<{ status: string }>(
      'SELECT status FROM execution_attempts WHERE workspace_id = $1 AND action_intent_id = $2',
      [seed.workspaceId, programmeIntent.id],
    );
    assert.equal(downstreamRows.rowCount, 0, 'no execution_attempts row is created for a DAG-blocked downstream intent');

    // Complete the upstream attempt, then the same downstream request succeeds.
    await pool.query(
      `UPDATE execution_attempts SET status = 'OBSERVED_SUCCESS', updated_at = now() WHERE id = $1`,
      [upstreamAttempt.attemptId],
    );
    const downstreamAttemptAfter = mustOk(await createPreparedExecutionAttempt(uow(), prepareParams({
      workspaceId: seed.workspaceId, actorId: seed.actorId,
      planId: plan.id, intentId: programmeIntent.id, principalId, now: EXEC_NOW,
    })));
    const downstreamAttemptRow = await pool.query<{ status: string }>(
      'SELECT status FROM execution_attempts WHERE id = $1', [downstreamAttemptAfter.attemptId],
    );
    assert.equal(downstreamAttemptRow.rows[0]?.status, 'PREPARED');
  });
});

describe('acceptance #10: two materially different scenarios, persisted and authorized through the identical evaluate/compile/persist/authorize call sequence', () => {
  test('a programme reschedule and an objective-loss waiver both flow through runViableScenarioToAuthorizedDispatch with no scenario-specific branching', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'M7-M8 genericity: two scenario kinds, one engine');
    const traveller = await seedTraveller(seed, { displayName: 'Genericity Traveller' });
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
      principalId, actorType: 'HUMAN', authIssuer: 'https://issuer.invalid/genericity', authSubject: principalId,
    }));
    // Two separate recovery cases: action_plans enforces one plan per
    // (recovery_case_id, plan_version), and both scenarios below persist
    // their own plan at version 1 — a real independent recovery, not a
    // second version of the same one.
    const openedA = mustOk(await openRecoveryCase(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), openedAt: NOW,
    }));
    const openedB = mustOk(await openRecoveryCase(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), openedAt: NOW,
    }));

    const journey: WJourney = {
      id: journeyId, revision: 1, tripId, travellerId: traveller.travellerId,
      lifecycleStatus: 'ACTIVE', intendedWindow: null, responsibilityOrganisationId: null,
    };

    // --- Scenario A: CHANGE_PROGRAMME_ITEM_TIME reschedule. Anchor objective
    // ACHIEVED supplies the blocking PASS; participation stays OPTIONAL. ---
    const anchorObjectiveIdA = randomUUID();
    const anchorObjectiveA: WObjective = {
      id: anchorObjectiveIdA, revision: 1, owner: { kind: 'JOURNEY', id: journeyId },
      successPredicateKind: 'STATEMENT', hardness: 'HARD', priority: 1,
      disposition: 'ACHIEVED', dispositionEvidenceId: null, targets: [],
    };
    const worldProgrammeItem: WProgrammeItem = {
      id: programmeItemId, programmeId, title: 'Genericity item', itemType: 'SESSION', placeId: null,
      window: originalWindow, lifecycleStatus: 'SCHEDULED', scheduleAuthority: 'INTERNAL',
    };
    const worldParticipation: WParticipation = {
      id: randomUUID(), programmeItemId, travellerId: traveller.travellerId,
      obligation: 'OPTIONAL', accepted: true, preparationWindow: null,
    };
    const proposedWindowA = { start: '2031-09-10T16:00:00.000Z', end: '2031-09-10T17:00:00.000Z' };
    const worldA = emptyWorld({
      journeys: [journey],
      objectives: [anchorObjectiveA],
      programmes: [{ id: programmeId, revision: 1, eventId, title: 'e', lifecycleStatus: 'ACTIVE' }],
      programmeItems: [worldProgrammeItem],
      participations: [worldParticipation],
      focus: [{ kind: 'PROGRAMME_ITEM', id: programmeItemId }],
    });
    const scenarioChangeA = ScenarioChangeSchema.parse({
      id: randomUUID(), recoveryStrategyId: randomUUID(), strategyVersion: 1,
      affectedSubjectRefs: [{ kind: 'PROGRAMME_ITEM', id: programmeItemId }],
      basisAssessmentId: randomUUID(),
      effects: [{ effectKind: 'CHANGE_PROGRAMME_ITEM_TIME', programmeItemId, proposedWindow: proposedWindowA }],
    });

    // --- Scenario B: WAIVE_OBJECTIVE loss proposal on a SEPARATE objective;
    // an unrelated ACHIEVED HARD objective supplies the blocking PASS. ---
    const lossObjectiveId = randomUUID();
    const anchorObjectiveIdB = randomUUID();
    const lossObjective: WObjective = {
      id: lossObjectiveId, revision: 1, owner: { kind: 'JOURNEY', id: journeyId },
      successPredicateKind: 'STATEMENT', hardness: 'HARD', priority: 1,
      disposition: 'ACTIVE', dispositionEvidenceId: null, targets: [],
    };
    const anchorObjectiveB: WObjective = {
      id: anchorObjectiveIdB, revision: 1, owner: { kind: 'JOURNEY', id: journeyId },
      successPredicateKind: 'STATEMENT', hardness: 'HARD', priority: 1,
      disposition: 'ACHIEVED', dispositionEvidenceId: null, targets: [],
    };
    const worldB = emptyWorld({
      journeys: [journey],
      objectives: [lossObjective, anchorObjectiveB],
      focus: [{ kind: 'JOURNEY', id: journeyId }],
    });
    const scenarioChangeB = ScenarioChangeSchema.parse({
      id: randomUUID(), recoveryStrategyId: randomUUID(), strategyVersion: 1,
      affectedSubjectRefs: [{ kind: 'OBJECTIVE', id: lossObjectiveId }],
      basisAssessmentId: randomUUID(),
      effects: [{ effectKind: 'WAIVE_OBJECTIVE', objectiveId: lossObjectiveId, rationale: 'genericity test loss', disposition: 'CLOSED_WITH_LOSS' }],
    });

    // --- Same helper, same call sequence, zero branching on scenario kind. ---
    const resultA = await runViableScenarioToAuthorizedDispatch({
      pool, workspaceId: seed.workspaceId, actorId: seed.actorId, recoveryCaseId: openedA.caseId,
      principalId, travellerId: traveller.travellerId, world: worldA, scenarioChange: scenarioChangeA,
      scope: [{ kind: 'PROGRAMME_ITEM', id: programmeItemId }],
    });
    const resultB = await runViableScenarioToAuthorizedDispatch({
      pool, workspaceId: seed.workspaceId, actorId: seed.actorId, recoveryCaseId: openedB.caseId,
      principalId, travellerId: traveller.travellerId, world: worldB, scenarioChange: scenarioChangeB,
      scope: [{ kind: 'OBJECTIVE', id: lossObjectiveId }],
    });

    // --- Prove they are materially different AND both landed for real. ---
    assert.equal(resultA.compiledIntent.capabilityRef, 'internal:programme.schedule');
    assert.equal(resultA.compiledIntent.operationNamespace, 'internal.programme');
    assert.equal(resultB.compiledIntent.capabilityRef, 'internal:objective.disposition');
    assert.equal(resultB.compiledIntent.operationNamespace, 'internal.objective');
    assert.notEqual(resultA.compiledIntent.capabilityRef, resultB.compiledIntent.capabilityRef);
    assert.notEqual(resultA.compiledIntent.operationNamespace, resultB.compiledIntent.operationNamespace);

    const rows = await pool.query<{ id: string; capability_ref: string; operation_namespace: string; status: string }>(
      `SELECT id, capability_ref, operation_namespace, status FROM action_intents
        WHERE workspace_id = $1 AND id = ANY($2::uuid[]) ORDER BY id`,
      [seed.workspaceId, [resultA.compiledIntent.id, resultB.compiledIntent.id]],
    );
    assert.equal(rows.rows.length, 2);
    const rowA = rows.rows.find((r) => r.id === resultA.compiledIntent.id)!;
    const rowB = rows.rows.find((r) => r.id === resultB.compiledIntent.id)!;
    assert.equal(rowA.capability_ref, 'internal:programme.schedule');
    assert.equal(rowA.operation_namespace, 'internal.programme');
    assert.equal(rowB.capability_ref, 'internal:objective.disposition');
    assert.equal(rowB.operation_namespace, 'internal.objective');
  });
});

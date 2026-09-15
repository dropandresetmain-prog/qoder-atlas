/**
 * M9 — documented architectural finding: a genuine two-sided (bilateral)
 * programme time swap cannot complete BOTH sides as real ActionIntents
 * executed through the accepted M7 -> M8 internal-execution pipeline when
 * both programme items belong to the SAME Programme aggregate.
 *
 * This is not a bug introduced by M9 remediation work; it is a pre-existing
 * gap in accepted M7 (`src/resolution/planning/compiler.ts`) and M8
 * (`src/persistence/postgres/execution/internalProgrammeExecutor.ts`) code,
 * empirically confirmed here rather than assumed. Ground rules forbid
 * rewriting M6/M7/M8 or inventing workarounds for a genuine architectural
 * contradiction — this test PINS the exact observed behaviour as evidence
 * for the human/C4 reviewer instead of silently routing around it (e.g. by
 * calling `updateProgrammeItemSchedule` directly outside the ActionIntent/
 * execution-attempt layer for the second side, which is exactly the
 * "move Sarah only" shortcut C4 already rejected once).
 *
 * Sequence proven below:
 *  1. A real M7 strategy with TWO `CHANGE_PROGRAMME_ITEM_TIME` effects
 *     (genuinely bilateral — both items' windows swap) evaluates VIABLE
 *     through the real M6 registry (`evaluateRecoveryStrategy`).
 *  2. `compileActionPlan` produces two `internal:programme.schedule`
 *     ActionIntents; both persist via the real M8 `persistActionPlan`.
 *  3. Real authority (grant + decision + approval, via the accepted M8
 *     commands) is issued for both intents.
 *  4. Side A executes for real: `executeInternalProgrammeItemSchedule`
 *     dispatches, the real M4 `updateProgrammeItemSchedule` mutates
 *     `programme_items`, and a real `execution_attempts`/
 *     `execution_observations` pair records OBSERVED_SUCCESS.
 *  5. Side B's dispatch is correctly refused STALE_BASE — side A's own
 *     execution advanced the shared PROGRAMME aggregate that the ONE
 *     strategy's base_manifest read, and the accepted execution gate
 *     (`evaluateStoredExecutionGate`) checks currentness against that
 *     manifest before every dispatch. This part is the execution gate
 *     working exactly as designed, not a gap.
 *  6. The accepted IN-1 re-plan mechanism (a new strategy version evaluated
 *     against freshly captured post-A state) correctly clears STALE_BASE and
 *     the authority gate for side B — re-planning itself is not the gap.
 *  7. Side B's execution STILL fails, this time at the real M4 CAS check
 *     (`STALE_AGGREGATE_REVISION`), because `compiler.ts`'s
 *     `CHANGE_PROGRAMME_ITEM_TIME` case never stores an `expectedRevisions`
 *     entry for the PROGRAMME aggregate (unlike, e.g., its own
 *     `CHANGE_SUPPORT_ASSIGNMENT` case, which does store one) — so
 *     `internalProgrammeExecutor.ts`'s `loadStoredProgrammeSchedule` always
 *     falls back to a hardcoded `expectedProgrammeRevision: 1`, which is
 *     stale for any second internal schedule mutation to the same Programme,
 *     however many times the strategy is re-evaluated or re-planned.
 *
 * Fixing this needs either a frozen v2 ScenarioEffect contract change
 * (`scenarioChange.ts`), a compileActionPlan signature change (it does not
 * currently receive the base world needed to read a real revision), or
 * relaxing the M8 execution gate's currentness semantics — all three are
 * M7/M8 contract changes, not an M9 integration fix.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed, seedTraveller, seedTrip, seedJourney } from './m2Seed.ts';
import { seedEvent, seedProgramme, seedProgrammeItem, seedParticipation } from './m4Seed.ts';
import { PgUnitOfWork, type ExecuteOutcome } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { createPrincipal } from '../src/persistence/postgres/commands/peopleCommands.ts';
import { openRecoveryCase, persistActionPlan } from '../src/persistence/postgres/commands/m8AuthorityCommands.ts';
import { executeInternalProgrammeItemSchedule } from '../src/persistence/postgres/execution/internalProgrammeExecutor.ts';
import { evaluateRecoveryStrategy } from '../src/resolution/scenarios/evaluate.ts';
import { compileActionPlan } from '../src/resolution/planning/compiler.ts';
import { ScenarioChangeSchema } from '../src/contracts/v2/scenario/scenarioChange.ts';
import { emptyWorld } from '../test/support/m6World.ts';
import type { WJourney, WObjective, WProgrammeItem, WParticipation } from '../src/resolution/world/world.ts';
import type { WorldSnapshotManifest } from '../src/contracts/v2/scope/readScope.ts';
import {
  loadRequiredAuthorityScopesOrFail,
  persistStrategyChangeRow,
  seedStoredExecutionAuthority,
  seedMinimalCurrentAssessment,
  prepareParams,
} from './m8ExecutionGateHelpers.ts';

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

const NOW = '2031-09-01T00:00:00.000Z';
const EXEC_NOW = '2032-01-01T00:00:00.000Z';

function mustOk<T>(o: ExecuteOutcome<T>): T {
  if (!o.ok) assert.fail(`${o.conflict.kind}: ${o.conflict.message}`);
  return o.value;
}
function emptyManifest(): WorldSnapshotManifest {
  return { evaluatedAt: NOW, evaluatorVersions: [], aggregateReads: [], scopeReads: [], evidenceReads: [], coverageReads: [], missingCoverage: [] };
}

describe('M9 architectural finding — same-Programme bilateral swap cannot complete both sides as real ActionIntents', () => {
  test('side A executes for real; side B is correctly gated STALE_BASE, then blocked again at the M4 CAS layer even after a real IN-1 re-plan', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'M9 bilateral swap finding');
    const t1 = await seedTraveller(seed, { displayName: 'Side A traveller' });
    const t2 = await seedTraveller(seed, { displayName: 'Side B traveller' });
    const trip1 = await seedTrip(seed);
    const trip2 = await seedTrip(seed);
    const j1 = await seedJourney(seed, { tripId: trip1, travellerId: t1.travellerId });
    const j2 = await seedJourney(seed, { tripId: trip2, travellerId: t2.travellerId });
    const eventId = await seedEvent(seed, { lifecycleStatus: 'ACTIVE' });
    const programmeId = await seedProgramme(seed, { eventId, lifecycleStatus: 'ACTIVE' });
    const winA = { start: '2031-09-10T11:30:00.000Z', end: '2031-09-10T12:00:00.000Z' };
    const winB = { start: '2031-09-10T14:30:00.000Z', end: '2031-09-10T15:00:00.000Z' };
    const itemA = await seedProgrammeItem(seed, { programmeId, lifecycleStatus: 'SCHEDULED', scheduleAuthority: 'INTERNAL', window: winA });
    const itemB = await seedProgrammeItem(seed, { programmeId, lifecycleStatus: 'SCHEDULED', scheduleAuthority: 'INTERNAL', window: winB });
    await seedParticipation(seed, { programmeItemId: itemA.programmeItemId, travellerId: t1.travellerId, obligation: 'OPTIONAL', accepted: true });
    await seedParticipation(seed, { programmeItemId: itemB.programmeItemId, travellerId: t2.travellerId, obligation: 'OPTIONAL', accepted: true });
    await commitSeed(seed);

    const principalId = randomUUID();
    const uow = () => new PgUnitOfWork(pool, seed.workspaceId);
    mustOk(await createPrincipal(uow(), { workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), principalId, actorType: 'HUMAN', authIssuer: 'https://issuer.invalid/finding', authSubject: principalId }));
    const opened = mustOk(await openRecoveryCase(uow(), { workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), openedAt: NOW }));

    // Real M6/M7 viability recipe (docs/work/M7_M8_INTEGRATION_ACTIVE_TASK.md):
    // an ACHIEVED anchor HARD objective per journey supplies a blocking PASS.
    const journeyA: WJourney = { id: j1, revision: 1, tripId: trip1, travellerId: t1.travellerId, lifecycleStatus: 'ACTIVE', intendedWindow: null, responsibilityOrganisationId: null };
    const journeyB: WJourney = { id: j2, revision: 1, tripId: trip2, travellerId: t2.travellerId, lifecycleStatus: 'ACTIVE', intendedWindow: null, responsibilityOrganisationId: null };
    const objA: WObjective = { id: randomUUID(), revision: 1, owner: { kind: 'JOURNEY', id: j1 }, successPredicateKind: 'STATEMENT', hardness: 'HARD', priority: 1, disposition: 'ACHIEVED', dispositionEvidenceId: null, targets: [] };
    const objB: WObjective = { id: randomUUID(), revision: 1, owner: { kind: 'JOURNEY', id: j2 }, successPredicateKind: 'STATEMENT', hardness: 'HARD', priority: 1, disposition: 'ACHIEVED', dispositionEvidenceId: null, targets: [] };
    const wItemA: WProgrammeItem = { id: itemA.programmeItemId, programmeId, title: 'A', itemType: 'SESSION', placeId: null, window: winA, lifecycleStatus: 'SCHEDULED', scheduleAuthority: 'INTERNAL', operatingRequirements: null };
    const wItemB: WProgrammeItem = { id: itemB.programmeItemId, programmeId, title: 'B', itemType: 'SESSION', placeId: null, window: winB, lifecycleStatus: 'SCHEDULED', scheduleAuthority: 'INTERNAL', operatingRequirements: null };
    const pA: WParticipation = { id: randomUUID(), programmeItemId: itemA.programmeItemId, travellerId: t1.travellerId, obligation: 'OPTIONAL', accepted: true, preparationWindow: null };
    const pB: WParticipation = { id: randomUUID(), programmeItemId: itemB.programmeItemId, travellerId: t2.travellerId, obligation: 'OPTIONAL', accepted: true, preparationWindow: null };
    const world = emptyWorld({
      journeys: [journeyA, journeyB],
      objectives: [objA, objB],
      programmes: [{ id: programmeId, revision: 1, eventId, title: 'e', lifecycleStatus: 'ACTIVE' }],
      programmeItems: [wItemA, wItemB],
      participations: [pA, pB],
      focus: [{ kind: 'PROGRAMME_ITEM', id: itemA.programmeItemId }, { kind: 'PROGRAMME_ITEM', id: itemB.programmeItemId }],
    });
    const scenarioChange = ScenarioChangeSchema.parse({
      id: randomUUID(), recoveryStrategyId: randomUUID(), strategyVersion: 1,
      affectedSubjectRefs: [{ kind: 'PROGRAMME_ITEM', id: itemA.programmeItemId }, { kind: 'PROGRAMME_ITEM', id: itemB.programmeItemId }],
      basisAssessmentId: randomUUID(),
      // Genuinely bilateral: itemA <- itemB's window and itemB <- itemA's window.
      effects: [
        { effectKind: 'CHANGE_PROGRAMME_ITEM_TIME', programmeItemId: itemA.programmeItemId, proposedWindow: winB },
        { effectKind: 'CHANGE_PROGRAMME_ITEM_TIME', programmeItemId: itemB.programmeItemId, proposedWindow: winA },
      ],
    });
    const baseManifestV1: WorldSnapshotManifest = { ...emptyManifest(), aggregateReads: [{ aggregateRef: { kind: 'PROGRAMME', id: programmeId }, revision: 1 }] };
    const evaluated = evaluateRecoveryStrategy({
      recoveryCaseId: opened.caseId, baseWorld: world, baseManifest: baseManifestV1,
      basisAssessmentId: scenarioChange.basisAssessmentId, scenarioChange, now: NOW,
    });
    assert.equal(evaluated.ok, true, JSON.stringify(evaluated));
    if (!evaluated.ok) return;
    assert.equal(evaluated.value.strategy.viability, 'VIABLE', 'real M6-evaluated bilateral swap is viable');

    const compiled = compileActionPlan({ strategy: evaluated.value.strategy, now: NOW });
    assert.equal(compiled.ok, true);
    if (!compiled.ok) return;
    const plan = compiled.value.plan;
    assert.equal(plan.intents.length, 2, 'two real ActionIntents, one per side of the swap');
    for (const intent of plan.intents) {
      assert.equal(intent.capabilityRef, 'internal:programme.schedule');
      // The gap's root cause: neither intent carries a PROGRAMME expectedRevision.
      assert.deepEqual(intent.expectedRevisions, []);
    }

    await persistStrategyChangeRow(pool, seed.workspaceId, seed.actorId, opened.caseId, scenarioChange, {
      baseManifest: baseManifestV1,
      candidateSummaries: [{ subjectRef: { kind: 'JOURNEY', id: j1 } }, { subjectRef: { kind: 'JOURNEY', id: j2 } }],
    });
    mustOk(await persistActionPlan(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), plan,
      recoveryStrategyId: scenarioChange.recoveryStrategyId,
    }));

    // Real authority for BOTH intents (grant + decision + approval via accepted M8 commands).
    await seedMinimalCurrentAssessment(pool, seed.workspaceId, { kind: 'JOURNEY', id: j1 }, EXEC_NOW);
    await seedMinimalCurrentAssessment(pool, seed.workspaceId, { kind: 'JOURNEY', id: j2 }, EXEC_NOW);
    for (const intent of plan.intents) {
      const scope = await loadRequiredAuthorityScopesOrFail(pool, seed.workspaceId, intent.id);
      await seedStoredExecutionAuthority({
        pool, workspaceId: seed.workspaceId, actorId: seed.actorId, principalId,
        planId: plan.id, intentId: intent.id, scope,
        representedPartyRef: { kind: 'TRAVELLER', id: t1.travellerId },
        requirementRole: 'CASE_OWNER', now: EXEC_NOW,
      });
    }

    // --- Side A: real dispatch, real M4 mutation, real observation. ---
    const resultA = await executeInternalProgrammeItemSchedule(pool, uow(), prepareParams({
      workspaceId: seed.workspaceId, actorId: seed.actorId, planId: plan.id, intentId: plan.intents[0]!.id, principalId, now: EXEC_NOW,
    }));
    assert.equal(resultA.ok, true, !resultA.ok ? JSON.stringify(resultA.conflict) : '');
    if (!resultA.ok) return;
    const attemptA = await pool.query<{ status: string }>('SELECT status FROM execution_attempts WHERE id = $1', [resultA.value.attemptId]);
    assert.equal(attemptA.rows[0]?.status, 'OBSERVED_SUCCESS');
    const itemARow = await pool.query<{ window_start: Date }>('SELECT window_start FROM programme_items WHERE workspace_id = $1 AND id = $2', [seed.workspaceId, itemA.programmeItemId]);
    assert.equal(itemARow.rows[0]!.window_start.toISOString(), winB.start, 'side A really moved to itemB\'s original window');

    // --- Side B, same strategy/plan: correctly refused STALE_BASE. ---
    const resultB = await executeInternalProgrammeItemSchedule(pool, uow(), prepareParams({
      workspaceId: seed.workspaceId, actorId: seed.actorId, planId: plan.id, intentId: plan.intents[1]!.id, principalId, now: EXEC_NOW,
    }));
    assert.equal(resultB.ok, false, 'expected: side B is refused because side A\'s own execution advanced the shared PROGRAMME aggregate the ONE strategy\'s base manifest read');
    if (!resultB.ok) assert.match(resultB.conflict.message, /STALE_BASE/);

    // --- Real IN-1 re-plan: fresh capture, strategy v2, re-authorize. This part works as designed. ---
    const programmeHead2 = await pool.query<{ revision: string }>('SELECT revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2', [seed.workspaceId, programmeId]);
    const currentProgrammeRevision = Number(programmeHead2.rows[0]!.revision);
    assert.equal(currentProgrammeRevision, 2, 'side A\'s execution really did advance the PROGRAMME aggregate');
    const itemBRow = await pool.query<{ window_start: Date; window_end: Date }>('SELECT window_start, window_end FROM programme_items WHERE workspace_id = $1 AND id = $2', [seed.workspaceId, itemB.programmeItemId]);
    const wItemBFresh: WProgrammeItem = { ...wItemB, window: { start: itemBRow.rows[0]!.window_start.toISOString(), end: itemBRow.rows[0]!.window_end.toISOString() } };
    const world2 = emptyWorld({
      journeys: [journeyB], objectives: [objB],
      programmes: [{ id: programmeId, revision: currentProgrammeRevision, eventId, title: 'e', lifecycleStatus: 'ACTIVE' }],
      programmeItems: [wItemBFresh], participations: [pB],
      focus: [{ kind: 'PROGRAMME_ITEM', id: itemB.programmeItemId }],
    });
    const scenarioChange2 = ScenarioChangeSchema.parse({
      id: randomUUID(), recoveryStrategyId: randomUUID(), strategyVersion: 2,
      affectedSubjectRefs: [{ kind: 'PROGRAMME_ITEM', id: itemB.programmeItemId }],
      basisAssessmentId: randomUUID(),
      effects: [{ effectKind: 'CHANGE_PROGRAMME_ITEM_TIME', programmeItemId: itemB.programmeItemId, proposedWindow: winA }],
    });
    const baseManifestV2: WorldSnapshotManifest = { ...emptyManifest(), aggregateReads: [{ aggregateRef: { kind: 'PROGRAMME', id: programmeId }, revision: currentProgrammeRevision }] };
    const evaluated2 = evaluateRecoveryStrategy({
      recoveryCaseId: opened.caseId, baseWorld: world2, baseManifest: baseManifestV2,
      basisAssessmentId: scenarioChange2.basisAssessmentId, scenarioChange: scenarioChange2, now: NOW, strategyVersion: 2,
    });
    assert.equal(evaluated2.ok, true, JSON.stringify(evaluated2));
    if (!evaluated2.ok) return;
    assert.equal(evaluated2.value.strategy.viability, 'VIABLE');
    const compiled2 = compileActionPlan({ strategy: evaluated2.value.strategy, now: NOW });
    assert.equal(compiled2.ok, true);
    if (!compiled2.ok) return;
    // IN-1: the re-planned intent keeps the SAME effect-scoped logical operation key.
    assert.equal(compiled2.value.plan.intents[0]!.logicalOperationKey, plan.intents[1]!.logicalOperationKey);

    await persistStrategyChangeRow(pool, seed.workspaceId, seed.actorId, opened.caseId, scenarioChange2, {
      baseManifest: baseManifestV2,
      candidateSummaries: [{ subjectRef: { kind: 'JOURNEY', id: j2 } }],
    });
    mustOk(await persistActionPlan(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), plan: compiled2.value.plan,
      recoveryStrategyId: scenarioChange2.recoveryStrategyId, planVersion: 2,
    }));
    const scope2 = await loadRequiredAuthorityScopesOrFail(pool, seed.workspaceId, compiled2.value.plan.intents[0]!.id);
    await seedStoredExecutionAuthority({
      pool, workspaceId: seed.workspaceId, actorId: seed.actorId, principalId,
      planId: compiled2.value.plan.id, intentId: compiled2.value.plan.intents[0]!.id, scope: scope2,
      representedPartyRef: { kind: 'TRAVELLER', id: t1.travellerId },
      requirementRole: 'CASE_OWNER', now: EXEC_NOW, planVersion: 2,
    });

    // --- Side B, re-planned v2: clears STALE_BASE and authority — then hits the
    // real M4 CAS with a stale hardcoded expectedProgrammeRevision (the gap). ---
    const resultB2 = await executeInternalProgrammeItemSchedule(pool, uow(), prepareParams({
      workspaceId: seed.workspaceId, actorId: seed.actorId, planId: compiled2.value.plan.id, intentId: compiled2.value.plan.intents[0]!.id, principalId, now: EXEC_NOW,
    }));
    assert.equal(resultB2.ok, false, 'expected (documented gap): the M4 CAS still fails even after a correct re-plan');
    if (!resultB2.ok) {
      assert.equal(resultB2.conflict.kind, 'STALE_AGGREGATE_REVISION');
      assert.match(resultB2.conflict.message, /expected revision 1 for PROGRAMME/, 'compileActionPlan never stores a real PROGRAMME expectedRevision for CHANGE_PROGRAMME_ITEM_TIME, so the executor always falls back to a hardcoded 1');
    }

    // Item B's window was never actually moved: the swap is genuinely incomplete,
    // and truthfully reported as such rather than flattened to "recovered".
    const itemBFinal = await pool.query<{ window_start: Date }>('SELECT window_start FROM programme_items WHERE workspace_id = $1 AND id = $2', [seed.workspaceId, itemB.programmeItemId]);
    assert.equal(itemBFinal.rows[0]!.window_start.toISOString(), winB.start, 'item B never moved — the bilateral swap did not complete both sides');
  });
});

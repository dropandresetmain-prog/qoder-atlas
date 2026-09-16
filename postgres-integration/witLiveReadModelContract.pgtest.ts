/**
 * WiT live read-model contract — FIG-1/2/3/4/6/7 proof, corrected post-review
 * for five defects found in the original lane (see docs/work/ACTIVE_TASK.md):
 *
 *  1. The revision could permanently miss a change (xact-at-first-write vs
 *     commit-order race; mixed snapshots across several autocommit queries).
 *     Fixed with one REPEATABLE READ transaction per read and an xmin-based
 *     `changeCursor`/`sinceCursor`, compared with `>=` (at-least-once).
 *  2. The case revision ignored most case content (only `recovery_cases` row
 *     writes bumped it). Fixed with migration 0123's case-content triggers.
 *  3. The incident/blast-radius view was never converted off the pure cohort
 *     builder (traveller-count revision, "every traveller changed" always,
 *     raw traveller UUIDs as refs, no `evaluation`).
 *  4. The overview collapsed multi-subject cases to one item/node from the
 *     first subject.
 *  5. Nothing could render a subject before escalation — every PostgreSQL
 *     projection was case-driven.
 *
 * Two journeys (J1, J2) share one transport service; a third (J3) does not
 * depend on it. J1's onward connection is tight enough that the injected
 * delay breaks it (connection_broken -> FAIL); J2's onward connection has
 * enough slack to survive the same delay (stays PASS). This is the real M6
 * `connection_feasibility` evaluator (same mechanism as
 * m9ConnectionProgression.pgtest.ts), not a caller-supplied hint.
 *
 * No assessment or scheduled_reassessments row is hand-inserted for the
 * baseline/injection/settlement flow: the baseline uses
 * `evaluateImpact(..., persist)`, the injection uses
 * `acceptProviderShapedDemoEvent` (same as m9DemoIngress.pgtest.ts), and
 * reassessment is driven one claim at a time through the real
 * `PgReassessmentWorker`. The overlapping-transaction proof (defect 1) does
 * insert `assessments` rows directly through two explicit clients — that is
 * the one place a raw insert is used on purpose, to control commit timing
 * precisely while still firing the real `fig3_bump_on_assessment` trigger
 * (0121), not a fabricated cursor.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed, takeSeedEvidence, type SeedSession } from './m2Seed.ts';
import {
  KnowledgeFixture,
  seedBooking,
  seedJourney,
  seedJurisdictionWithPlaces,
  seedService,
  seedTransportIntent,
  seedTraveller,
  seedTrip,
} from './m6WorldSeed.ts';
import { seedEvent, seedParticipation, seedProgramme, seedProgrammeItem } from './m4Seed.ts';
import { acceptProviderShapedDemoEvent } from '../src/app/target/applicationCommands.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { openRecoveryCase } from '../src/persistence/postgres/commands/m8AuthorityCommands.ts';
import type { ExecuteOutcome } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { evaluateImpact } from '../src/persistence/postgres/world/pgEvaluation.ts';
import { captureWorld } from '../src/persistence/postgres/world/pgCurrentState.ts';
import { PgReassessmentWorker, type ReassessmentPipeline } from '../src/persistence/postgres/world/pgAssessments.ts';
import { projectEffectiveWorld } from '../src/resolution/world/effectiveItinerary.ts';
import { assessSubject } from '../src/resolution/evaluation/assess.ts';
import { createM6Registry } from '../src/resolution/evaluation/registry.ts';
import {
  loadIncidentProgrammeFacts,
  loadOperatorOverviewFacts,
  loadRecoveryCaseFacts,
} from '../src/app/target/readmodels/pgFactAssembler.ts';
import type { Pool } from '../src/persistence/postgres/pool.ts';

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

const NOW = '2031-06-02T00:00:00.000Z';
const ONWARD_TIGHT_DEPARTURE = '2031-06-02T12:00:00.000Z'; // J1's onward leg — matches m9ConnectionProgression's tight case
const ONWARD_SAFE_DEPARTURE = '2031-06-02T18:00:00.000Z'; // J2's onward leg — well clear of the delayed arrival

function mustOk<T>(outcome: ExecuteOutcome<T>): T {
  if (!outcome.ok) assert.fail(`${outcome.conflict.kind}: ${outcome.conflict.message}`);
  return outcome.value;
}

const registry = createM6Registry();

function pipeline(pool: Pool): ReassessmentPipeline {
  return async (claim, assessmentId) => {
    const world = await captureWorld(pool, {
      workspaceId: claim.workspaceId, focus: [claim.subject], at: NOW, informationTopics: registry.informationTopics,
    });
    return assessSubject({
      registry, world, effective: projectEffectiveWorld(world), subject: claim.subject, now: NOW, assessmentId,
    }).result;
  };
}

/**
 * Real trigger path (0121's `fig3_bump_on_assessment`), not a fabricated
 * stamp — but still a minimal, schema-valid manifest/subjects shape so a
 * later `currentAssessmentView`/`loadAssessment` read of this row (e.g. from
 * `loadRecoveryCaseFacts` re-reading the whole case after this insert) does
 * not fail to parse it.
 */
async function insertViabilityAssessment(
  client: { query: Pool['query'] },
  workspaceId: string,
  journeyId: string,
  actorId: string,
  verdict: 'PASS' | 'FAIL' | 'UNKNOWN',
): Promise<void> {
  const assessmentId = randomUUID();
  const manifestDetail = { capture: null, coverageReads: [], missingCoverage: [], evaluatedAt: NOW };
  await client.query(
    `INSERT INTO assessments (workspace_id, id, kind, subject_kind, subject_id, evaluated_at, overall_verdict, manifest_detail, manifest_schema_version, created_by_actor_id)
     VALUES ($1, $2, 'VIABILITY', 'JOURNEY', $3, $4::timestamptz, $5, $6::jsonb, 'wit-live-readmodel-contract-test', $7)`,
    [workspaceId, assessmentId, journeyId, NOW, verdict, JSON.stringify(manifestDetail), actorId],
  );
  await client.query(
    `INSERT INTO assessment_subjects (workspace_id, assessment_id, subject_kind, subject_id, role)
     VALUES ($1, $2, 'JOURNEY', $3, 'primary')`,
    [workspaceId, assessmentId, journeyId],
  );
}

describe('WiT live read-model contract (FIG-1/2/3/4/6/7, defects 1-5 corrected)', () => {
  test('pre-escalation dashboard -> disruption -> settle -> escalation -> case/incident/overview consistency', async () => {
    const pool = await sharedTestPool();
    const seed: SeedSession = await beginSeed(pool, 'WiT live read-model contract');

    const origin = await seedJurisdictionWithPlaces(seed, { name: 'Origin regime', places: [{ name: 'Origin', placeType: 'STATION' }] });
    const hub = await seedJurisdictionWithPlaces(seed, { name: 'Hub regime', places: [{ name: 'Hub', placeType: 'AIRPORT' }] });
    const dest1 = await seedJurisdictionWithPlaces(seed, { name: 'Dest1 regime', places: [{ name: 'Dest1', placeType: 'STATION' }] });
    const dest2 = await seedJurisdictionWithPlaces(seed, { name: 'Dest2 regime', places: [{ name: 'Dest2', placeType: 'STATION' }] });
    const dest3 = await seedJurisdictionWithPlaces(seed, { name: 'Dest3 regime', places: [{ name: 'Dest3', placeType: 'STATION' }] });
    const [originId] = origin.placeIds as [string];
    const [hubId] = hub.placeIds as [string];
    const [dest1Id] = dest1.placeIds as [string];
    const [dest2Id] = dest2.placeIds as [string];
    const [dest3Id] = dest3.placeIds as [string];

    // Shared inbound service — J1 and J2 both depend on it.
    const sharedServiceId = await seedService(seed, {
      mode: 'AIR', operator: 'Test Air', originPlaceId: originId, destinationPlaceId: hubId,
      published: { departure: '2031-06-02T05:00:00.000Z', arrival: '2031-06-02T09:20:00.000Z' },
    });
    // Independent inbound service — J3 does not depend on the shared service.
    const independentServiceId = await seedService(seed, {
      mode: 'RAIL', operator: 'Test Rail', originPlaceId: originId, destinationPlaceId: dest3Id,
      published: { departure: '2031-06-02T06:00:00.000Z', arrival: '2031-06-02T08:00:00.000Z' },
    });
    const tightOnwardId = await seedService(seed, {
      mode: 'AIR', operator: 'Test Air', originPlaceId: hubId, destinationPlaceId: dest1Id,
      published: { departure: ONWARD_TIGHT_DEPARTURE, arrival: '2031-06-02T15:00:00.000Z' },
    });
    const safeOnwardId = await seedService(seed, {
      mode: 'AIR', operator: 'Test Air', originPlaceId: hubId, destinationPlaceId: dest2Id,
      published: { departure: ONWARD_SAFE_DEPARTURE, arrival: '2031-06-02T21:00:00.000Z' },
    });

    const traveller1 = (await seedTraveller(seed, { displayName: 'Dependent Tight' })).travellerId;
    const traveller2 = (await seedTraveller(seed, { displayName: 'Dependent Safe' })).travellerId;
    const traveller3 = (await seedTraveller(seed, { displayName: 'Independent' })).travellerId;

    const journey1Id = await seedJourney(seed, { tripId: await seedTrip(seed), travellerId: traveller1 });
    const journey2Id = await seedJourney(seed, { tripId: await seedTrip(seed), travellerId: traveller2 });
    const journey3Id = await seedJourney(seed, { tripId: await seedTrip(seed), travellerId: traveller3 });

    const j1Inbound = await seedTransportIntent(seed, { journeyId: journey1Id, orderKey: '010', originPlaceId: originId, destinationPlaceId: hubId, selectedServiceId: sharedServiceId });
    const j1Onward = await seedTransportIntent(seed, { journeyId: journey1Id, orderKey: '020', originPlaceId: hubId, destinationPlaceId: dest1Id, selectedServiceId: tightOnwardId });
    await seedBooking(seed, { travellerId: traveller1, serviceId: sharedServiceId, journeyItemId: j1Inbound });
    await seedBooking(seed, { travellerId: traveller1, serviceId: tightOnwardId, journeyItemId: j1Onward });

    const j2Inbound = await seedTransportIntent(seed, { journeyId: journey2Id, orderKey: '010', originPlaceId: originId, destinationPlaceId: hubId, selectedServiceId: sharedServiceId });
    const j2Onward = await seedTransportIntent(seed, { journeyId: journey2Id, orderKey: '020', originPlaceId: hubId, destinationPlaceId: dest2Id, selectedServiceId: safeOnwardId });
    await seedBooking(seed, { travellerId: traveller2, serviceId: sharedServiceId, journeyItemId: j2Inbound });
    await seedBooking(seed, { travellerId: traveller2, serviceId: safeOnwardId, journeyItemId: j2Onward });

    const j3Item = await seedTransportIntent(seed, { journeyId: journey3Id, orderKey: '010', originPlaceId: originId, destinationPlaceId: dest3Id, selectedServiceId: independentServiceId });
    await seedBooking(seed, { travellerId: traveller3, serviceId: independentServiceId, journeyItemId: j3Item });

    // Defect-5 population scope key: an ACTIVE programme's programme_item with
    // an accepted REQUIRED participation for each traveller — the same
    // membership predicate loadIncidentProgrammeFacts already treats as
    // authoritative, reused here to bound the DASHBOARD subject population.
    // The programme item is seeded CANCELLED: `m6.participation`'s REQUIRED
    // dimension is otherwise blocking and needs a real reachable
    // window/place to resolve PASS (real scheduling feasibility, not a test
    // shortcut) — CANCELLED deterministically PASSes ("programme_item_cancelled")
    // regardless of itinerary, which is exactly what this scope-population
    // probe needs and does not touch the connection_feasibility proof this
    // test's disruption/settlement steps depend on.
    const eventId = await seedEvent(seed, { lifecycleStatus: 'ACTIVE' });
    const programmeId = await seedProgramme(seed, { eventId, lifecycleStatus: 'ACTIVE' });
    const { programmeItemId } = await seedProgrammeItem(seed, { programmeId, lifecycleStatus: 'CANCELLED' });
    for (const travellerId of [traveller1, traveller2, traveller3]) {
      await seedParticipation(seed, { programmeItemId, travellerId, obligation: 'REQUIRED', accepted: true });
    }

    await commitSeed(seed);

    const knowledge = new KnowledgeFixture(pool, seed);
    await knowledge.constraint({
      registeredType: 'minimum_connection_minutes', hardness: 'HARD', owner: { kind: 'PLACE', id: hubId },
      operands: [{ key: 'minutes', kind: 'NUMBER', value: 60 }],
    });
    // Complete coverage for every jurisdiction the three journeys' exposure
    // touches, so the advisories/transit_feasibility blocking dimensions
    // resolve PASS and connection_feasibility is what actually decides the
    // overall verdict (matches m9SarahTargetE2E.pgtest.ts's setup).
    for (const jurisdictionId of [origin.jurisdictionId, hub.jurisdictionId, dest1.jurisdictionId, dest2.jurisdictionId, dest3.jurisdictionId]) {
      for (const topic of ['ADVISORY', 'CONDITION', 'ENTRY_REQUIREMENT', 'TRANSIT_REQUIREMENT']) {
        await knowledge.coverage({ topic, completeness: 'COMPLETE', jurisdictionId });
      }
    }

    const j1Ref = `JOURNEY:${journey1Id}`;
    const j2Ref = `JOURNEY:${journey2Id}`;
    const j3Ref = `JOURNEY:${journey3Id}`;

    // --- Baseline evaluation (real evaluator, not hand-inserted rows). ---
    for (const journeyId of [journey1Id, journey2Id, journey3Id]) {
      await evaluateImpact(pool, {
        workspaceId: seed.workspaceId, focus: [{ kind: 'JOURNEY', id: journeyId }], now: NOW, registry, persist: { actorId: seed.actorId },
      });
    }

    // --- Requirement 1a: before escalation — with no case rows, the
    // DASHBOARD projection already renders the population's subjects. ---
    const dash1 = await loadOperatorOverviewFacts(pool, seed.workspaceId, NOW);
    const dashNodeByRef1 = new Map(dash1.nodes.map((n) => [n.ref, n]));
    assert.equal(dashNodeByRef1.get(j1Ref)?.evaluation, 'CURRENT', 'J1 renders before any case exists');
    assert.equal(dashNodeByRef1.get(j2Ref)?.evaluation, 'CURRENT', 'J2 renders before any case exists');
    assert.equal(dashNodeByRef1.get(j3Ref)?.evaluation, 'CURRENT', 'J3 (independent) renders before any case exists');
    assert.equal(dashNodeByRef1.get(j1Ref)?.semanticState, 'HEALTHY');
    assert.equal(dashNodeByRef1.get(j2Ref)?.semanticState, 'HEALTHY');
    assert.equal(dashNodeByRef1.get(j3Ref)?.semanticState, 'HEALTHY');
    assert.equal(dashNodeByRef1.get(j1Ref)?.caseRef, undefined, 'no case exists yet, so no caseRef');
    let dashCursor = dash1.changeCursor!;
    assert.ok(dashCursor, 'the dashboard read returns a changeCursor');

    // --- Step 2: inject the disruption through the normal ingestion path. ---
    const headBefore = await pool.query<{ revision: string }>(
      'SELECT revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2',
      [seed.workspaceId, sharedServiceId],
    );
    const ctx = { workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, uow: () => new PgUnitOfWork(pool, seed.workspaceId), pool };
    const ingress = await acceptProviderShapedDemoEvent(ctx, {
      providerId: 'test-supplier',
      providerEventId: `evt-${randomUUID()}`,
      receivedAt: '2031-06-01T23:00:00.000Z',
      payload: {
        subjectKind: 'TRANSPORT_SERVICE',
        subjectId: sharedServiceId,
        expectedRevision: Number(headBefore.rows[0]!.revision),
        field: 'ACTUAL',
        arrival: '2031-06-02T13:05:00.000Z', // gap vs ONWARD_TIGHT_DEPARTURE = -65min (IMPOSSIBLE); vs ONWARD_SAFE_DEPARTURE = +295min (safe)
        evidenceId: takeSeedEvidence(seed),
      },
      disclosedAsSimulatedDemoInput: true,
    });
    assert.equal(ingress.ok, true, ingress.ok ? '' : JSON.stringify(ingress.error));

    // --- Requirement 1a (cont'd): only the dependents go PENDING_REASSESSMENT. ---
    const dash2 = await loadOperatorOverviewFacts(pool, seed.workspaceId, NOW, dashCursor);
    const dashNodeByRef2 = new Map(dash2.nodes.map((n) => [n.ref, n]));
    assert.equal(dashNodeByRef2.get(j1Ref)?.evaluation, 'PENDING_REASSESSMENT');
    assert.equal(dashNodeByRef2.get(j2Ref)?.evaluation, 'PENDING_REASSESSMENT');
    assert.equal(dashNodeByRef2.get(j3Ref)?.evaluation, 'CURRENT');
    assert.deepEqual([...dash2.changedVisibleRefs].sort(), [j1Ref, j2Ref].sort(), 'changed refs name exactly the dependent subjects');
    dashCursor = dash2.changeCursor!;

    // --- Requirement 1a (cont'd): the real worker, one claim at a time —
    // changed refs reported since the previous cursor are correct at every step. ---
    const worker = new PgReassessmentWorker(pool, { actorId: 'm-lane-worker' });
    const settled: Record<string, 'HEALTHY' | 'FAILED'> = {};
    for (let step = 0; step < 2; step++) {
      const outcome = await worker.runOnce(NOW, pipeline(pool), seed.workspaceId);
      assert.equal(outcome.claimed, true, `expected a claim on step ${step}`);
      assert.equal(outcome.result, 'COMPLETED', JSON.stringify(outcome));

      const dash = await loadOperatorOverviewFacts(pool, seed.workspaceId, NOW, dashCursor);
      assert.equal(dash.changedVisibleRefs.length, 1, `exactly one subject should have settled on step ${step}`);
      const settledRef = dash.changedVisibleRefs[0]!;
      const node = dash.nodes.find((n) => n.ref === settledRef)!;
      assert.equal(node.evaluation, 'CURRENT', 'a settled subject reads CURRENT, not still-pending');
      assert.ok(node.semanticState === 'HEALTHY' || node.semanticState === 'FAILED', `settled subject must clear or fail, got ${node.semanticState}`);
      settled[settledRef] = node.semanticState as 'HEALTHY' | 'FAILED';
      dashCursor = dash.changeCursor!;
    }
    assert.equal(settled[j1Ref], 'FAILED', 'the tight onward connection settles to FAILED after the delay');
    assert.equal(settled[j2Ref], 'HEALTHY', 'the slack onward connection clears to HEALTHY despite the same delay');

    const dashFinal = await loadOperatorOverviewFacts(pool, seed.workspaceId, NOW);
    const dashNodeByRefFinal = new Map(dashFinal.nodes.map((n) => [n.ref, n]));
    assert.equal(dashNodeByRefFinal.get(j3Ref)?.evaluation, 'CURRENT', 'the independent subject was never touched');
    assert.equal(dashNodeByRefFinal.get(j3Ref)?.semanticState, 'HEALTHY');

    // --- Requirement 2: escalation — create the case through the real
    // escalation command (openRecoveryCase), attach subjects (the codebase
    // has no dedicated "attach subject" command anywhere — every existing
    // proof, including m9SarahTargetE2E.pgtest.ts, attaches case_subjects by
    // direct insert after the real command opens the case). ---
    const uow = () => new PgUnitOfWork(pool, seed.workspaceId);
    const caseId = mustOk(await openRecoveryCase(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), openedAt: NOW,
    })).caseId;
    for (const [subjectId, role] of [[journey1Id, 'dependent-tight'], [journey2Id, 'dependent-safe'], [journey3Id, 'independent']] as const) {
      await pool.query(
        `INSERT INTO case_subjects (workspace_id, recovery_case_id, subject_kind, subject_id, role) VALUES ($1, $2, 'JOURNEY', $3, $4)`,
        [seed.workspaceId, caseId, subjectId, role],
      );
    }

    const caseFacts = await loadRecoveryCaseFacts(pool, seed.workspaceId, caseId, NOW);
    assert.ok(caseFacts);
    const caseNodeByRef = new Map(caseFacts!.nodes.map((n) => [n.ref, n]));
    const failedCaseNode = caseNodeByRef.get(j1Ref)!;
    assert.equal(failedCaseNode.ref, j1Ref, 'the failed subject keeps the exact ref used before escalation');
    assert.equal(failedCaseNode.caseRef, caseId);

    const dashAfterEscalation = await loadOperatorOverviewFacts(pool, seed.workspaceId, NOW);
    const dashNodeAfterEscalation = new Map(dashAfterEscalation.nodes.map((n) => [n.ref, n]));
    assert.equal(dashNodeAfterEscalation.get(j1Ref)?.ref, j1Ref, 'same ref on the DASHBOARD population node after escalation');
    assert.equal(dashNodeAfterEscalation.get(j1Ref)?.caseRef, caseId, 'the DASHBOARD node now carries caseRef');

    // Defect-3: the incident/programme (PostgreSQL) projection uses the same
    // canonical ref as the case graph, and now carries a real `evaluation` —
    // not a raw traveller UUID and not an omitted field.
    const incidentFacts = await loadIncidentProgrammeFacts(pool, seed.workspaceId, caseId, NOW);
    assert.ok(incidentFacts);
    const incidentNodeByRef = new Map(incidentFacts!.nodes.map((n) => [n.ref, n]));
    const incidentJ1Node = incidentNodeByRef.get(j1Ref);
    assert.ok(incidentJ1Node, 'the incident projection uses the same canonical ref as the case graph');
    assert.equal(incidentJ1Node!.evaluation, 'CURRENT', 'defect-3: the incident projection now carries evaluation');
    assert.equal(incidentJ1Node!.caseRef, caseId);
    assert.deepEqual(
      [...incidentFacts!.nodes.map((n) => n.ref)].filter((r) => r.startsWith('JOURNEY:')).sort(),
      [j1Ref, j2Ref, j3Ref].sort(),
      'defect-3: canonical JOURNEY refs, not raw traveller UUIDs',
    );
    // Defect-3: a quiet second read must not claim every traveller changed.
    const incidentCursor = incidentFacts!.changeCursor!;
    const incidentQuiet = await loadIncidentProgrammeFacts(pool, seed.workspaceId, caseId, NOW, incidentCursor);
    assert.deepEqual(incidentQuiet!.changedVisibleRefs, [], 'a quiet read reports nothing changed, not "every traveller"');

    // --- Requirement 3: overlapping transactions. T1 (subject A = J1) starts
    // first (first write assigns the lower xid) but commits last; T2
    // (subject B = J2) starts second but commits first. A cursor read taken
    // while T1 is still open, then compared after T1 commits, must still
    // report A — this is exactly the case `stamp > sinceRevision` (assigned
    // at first write, not commit) could miss forever, and must fail against
    // pre-fix `4a04172`. ---
    const clientA = await pool.connect();
    const clientB = await pool.connect();
    try {
      await clientA.query('BEGIN');
      await insertViabilityAssessment(clientA, seed.workspaceId, journey1Id, seed.actorId, 'PASS'); // T1 first write — assigns the lower xid

      await clientB.query('BEGIN');
      await insertViabilityAssessment(clientB, seed.workspaceId, journey2Id, seed.actorId, 'PASS'); // T2 starts after T1
      await clientB.query('COMMIT'); // T2 commits before T1

      const readWhileOpen = await loadRecoveryCaseFacts(pool, seed.workspaceId, caseId, NOW);
      const cursorC = readWhileOpen!.changeCursor!;

      await clientA.query('COMMIT'); // T1 (the earlier-starting transaction) commits last

      const readAfter = await loadRecoveryCaseFacts(pool, seed.workspaceId, caseId, NOW, cursorC);
      assert.ok(
        readAfter!.changedVisibleRefs.includes(j1Ref),
        'the earlier-starting, later-committing transaction must still be reported — never silently missed',
      );
    } finally {
      clientA.release();
      clientB.release();
    }

    // --- Requirement 4: case content coverage (migration 0123). An
    // action-intent write (via a real action_plans/action_intents row, not a
    // recovery_cases write) must change the case's own cursor result. ---
    const caseFactsBeforeContent = (await loadRecoveryCaseFacts(pool, seed.workspaceId, caseId, NOW))!;
    const caseCursorBeforeContent = caseFactsBeforeContent.changeCursor!;
    const caseRevisionBeforeContent = caseFactsBeforeContent.projectionRevision;
    const actionPlanId = randomUUID();
    await pool.query(
      `INSERT INTO action_plans (workspace_id, id, recovery_case_id, scenario_change_id, plan_version, created_by_actor_id)
       VALUES ($1, $2, $3, $4, 1, $5)`,
      [seed.workspaceId, actionPlanId, caseId, randomUUID(), seed.actorId],
    );
    await pool.query(
      `INSERT INTO action_intents (
         workspace_id, id, action_plan_id, operation_namespace, capability_ref, subject_refs,
         expected_observations, compensation_supported, status, created_by_actor_id
       ) VALUES ($1, $2, $3, 'wit-live-readmodel-contract-test', 'test.capability.rebook', $4::jsonb, $5::jsonb, true, 'PROPOSED', $6)`,
      [
        seed.workspaceId, randomUUID(), actionPlanId,
        JSON.stringify([{ kind: 'JOURNEY', id: journey1Id }]),
        JSON.stringify([{ type: 'test-observation' }]),
        seed.actorId,
      ],
    );
    const caseFactsAfterContent = await loadRecoveryCaseFacts(pool, seed.workspaceId, caseId, NOW, caseCursorBeforeContent);
    const caseRefStr = `case:${caseId}`;
    assert.ok(
      caseFactsAfterContent!.changedVisibleRefs.includes(caseRefStr),
      'an action-intent write must change the case cursor result and report the case ref (migration 0123)',
    );
    assert.ok(
      caseFactsAfterContent!.projectionRevision > caseRevisionBeforeContent,
      `case revision must advance after case-content writes (${caseFactsAfterContent!.projectionRevision} > ${caseRevisionBeforeContent})`,
    );

    // --- Requirement 5: overview multi-subject fidelity (defect 4). A
    // two-subject case yields two DASHBOARD nodes, and the item carries no
    // first-subject evaluation. ---
    const twoSubjectCaseId = mustOk(await openRecoveryCase(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), openedAt: NOW,
    })).caseId;
    for (const [subjectId, role] of [[journey1Id, 'a'], [journey2Id, 'b']] as const) {
      await pool.query(
        `INSERT INTO case_subjects (workspace_id, recovery_case_id, subject_kind, subject_id, role) VALUES ($1, $2, 'JOURNEY', $3, $4)`,
        [seed.workspaceId, twoSubjectCaseId, subjectId, role],
      );
    }
    const overview5 = await loadOperatorOverviewFacts(pool, seed.workspaceId, NOW);
    const twoSubjectItem = overview5.items.find((i) => i.caseRef === twoSubjectCaseId);
    assert.ok(twoSubjectItem, 'the two-subject case still yields an overview item');
    assert.equal(twoSubjectItem!.evaluation, undefined, 'a multi-subject item must never report a single first-subject evaluation');
    const overviewNodeRefs = new Set(overview5.nodes.map((n) => n.ref));
    assert.ok(overviewNodeRefs.has(j1Ref) && overviewNodeRefs.has(j2Ref), 'both of the two-subject case\'s subjects render as separate DASHBOARD nodes');

    // --- Final: reading twice with no further changes yields an identical
    // revision, node/edge ids and order (case graph, unchanged assertion). ---
    const readA = await loadRecoveryCaseFacts(pool, seed.workspaceId, caseId, NOW);
    const readB = await loadRecoveryCaseFacts(pool, seed.workspaceId, caseId, NOW);
    assert.ok(readA && readB);
    assert.equal(readB!.projectionRevision, readA!.projectionRevision);
    assert.deepEqual(readB!.nodes.map((n) => n.ref), readA!.nodes.map((n) => n.ref), 'node order identical across quiet reads');
    assert.deepEqual(readB!.edges.map((e) => e.id), readA!.edges.map((e) => e.id), 'edge order identical across quiet reads');
    assert.deepEqual(
      readB!.nodes.map((n) => [n.ref, n.semanticState, n.evaluation]),
      readA!.nodes.map((n) => [n.ref, n.semanticState, n.evaluation]),
      'node content identical across quiet reads',
    );
  });
});

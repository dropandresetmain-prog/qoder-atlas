/**
 * WiT live read-model contract — FIG-1/2/3/4/6/7 proof.
 *
 * Proves, against real PostgreSQL, the sequence the live demo needs:
 * baseline -> operator injects a real disruption through the normal
 * ingestion path -> the engine identifies the dependent scope -> potentially
 * affected subjects read as under evaluation -> the unaffected subject stays
 * current -> the affected subjects settle (clear or fail) -> the failed
 * subject carries stable case linkage.
 *
 * Two journeys (J1, J2) share one transport service; a third (J3) does not
 * depend on it. J1's onward connection is tight enough that the injected
 * delay breaks it (connection_broken -> FAIL); J2's onward connection has
 * enough slack to survive the same delay (stays PASS). This is the real M6
 * `connection_feasibility` evaluator (same mechanism as
 * m9ConnectionProgression.pgtest.ts), not a caller-supplied hint.
 *
 * No assessment or scheduled_reassessments row is ever hand-inserted: the
 * baseline uses `evaluateImpact(..., persist)`, the injection uses
 * `acceptProviderShapedDemoEvent` (same as m9DemoIngress.pgtest.ts), and
 * reassessment is driven one claim at a time through the real
 * `PgReassessmentWorker`.
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
import { loadRecoveryCaseFacts } from '../src/app/target/readmodels/pgFactAssembler.ts';
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

describe('WiT live read-model contract (FIG-1/2/3/4/6/7)', () => {
  test('baseline -> disruption -> dependent scope under evaluation -> settle -> case linkage stays stable', async () => {
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

    const j1Ref = `JOURNEY:${journey1Id}`;
    const j2Ref = `JOURNEY:${journey2Id}`;
    const j3Ref = `JOURNEY:${journey3Id}`;

    // --- Step 1: baseline read — every subject CURRENT with its own verdict.
    // Evaluated one focus at a time so each manifest captures only what that
    // journey actually reads — a batched capture would otherwise record every
    // aggregate touched by ANY focus subject against ALL of them. ---
    for (const journeyId of [journey1Id, journey2Id, journey3Id]) {
      await evaluateImpact(pool, {
        workspaceId: seed.workspaceId, focus: [{ kind: 'JOURNEY', id: journeyId }], now: NOW, registry, persist: { actorId: seed.actorId },
      });
    }

    const read1 = await loadRecoveryCaseFacts(pool, seed.workspaceId, caseId, NOW);
    assert.ok(read1);
    const nodeByRef1 = new Map(read1!.nodes.map((n) => [n.ref, n]));
    assert.equal(nodeByRef1.get(j1Ref)?.evaluation, 'CURRENT');
    assert.equal(nodeByRef1.get(j2Ref)?.evaluation, 'CURRENT');
    assert.equal(nodeByRef1.get(j3Ref)?.evaluation, 'CURRENT');
    assert.equal(nodeByRef1.get(j1Ref)?.semanticState, 'HEALTHY');
    assert.equal(nodeByRef1.get(j2Ref)?.semanticState, 'HEALTHY');
    assert.equal(nodeByRef1.get(j3Ref)?.semanticState, 'HEALTHY');
    const revision1 = read1!.projectionRevision;
    const nodeRefs1 = read1!.nodes.map((n) => n.ref).sort();
    const edgeIds1 = read1!.edges.map((e) => e.id).sort();

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

    // --- Step 3: read again — exactly the dependent subjects are under evaluation. ---
    const read2 = await loadRecoveryCaseFacts(pool, seed.workspaceId, caseId, NOW, revision1);
    assert.ok(read2);
    const nodeByRef2 = new Map(read2!.nodes.map((n) => [n.ref, n]));
    assert.equal(nodeByRef2.get(j1Ref)?.evaluation, 'PENDING_REASSESSMENT');
    assert.equal(nodeByRef2.get(j2Ref)?.evaluation, 'PENDING_REASSESSMENT');
    assert.equal(nodeByRef2.get(j3Ref)?.evaluation, 'CURRENT');
    const revision2 = read2!.projectionRevision;
    assert.ok(revision2 > revision1, `revision must strictly increase (${revision2} > ${revision1})`);
    assert.deepEqual(read2!.nodes.map((n) => n.ref).sort(), nodeRefs1, 'node refs unchanged by re-evaluation');
    assert.deepEqual(read2!.edges.map((e) => e.id).sort(), edgeIds1, 'edge ids unchanged by re-evaluation');
    assert.deepEqual([...read2!.changedVisibleRefs].sort(), [j1Ref, j2Ref].sort(), 'changed refs name exactly the dependent subjects');

    // --- Step 4: run the real reassessment worker, one subject at a time. ---
    const worker = new PgReassessmentWorker(pool, { actorId: 'm-lane-worker' });
    let lastRevision = revision2;
    const settled: Record<string, 'HEALTHY' | 'FAILED'> = {};
    for (let step = 0; step < 2; step++) {
      const outcome = await worker.runOnce(NOW, pipeline(pool), seed.workspaceId);
      assert.equal(outcome.claimed, true, `expected a claim on step ${step}`);
      assert.equal(outcome.result, 'COMPLETED', JSON.stringify(outcome));

      const read = await loadRecoveryCaseFacts(pool, seed.workspaceId, caseId, NOW, lastRevision);
      assert.ok(read);
      const revision = read!.projectionRevision;
      assert.ok(revision > lastRevision, `revision must increase after step ${step} (${revision} > ${lastRevision})`);
      assert.equal(read!.changedVisibleRefs.length, 1, `exactly one subject should have settled on step ${step}`);
      const settledRef = read!.changedVisibleRefs[0]!;
      const node = read!.nodes.find((n) => n.ref === settledRef)!;
      assert.equal(node.evaluation, 'CURRENT', 'a settled subject reads CURRENT, not still-pending');
      assert.ok(node.semanticState === 'HEALTHY' || node.semanticState === 'FAILED', `settled subject must clear or fail, got ${node.semanticState}`);
      settled[settledRef] = node.semanticState as 'HEALTHY' | 'FAILED';
      assert.deepEqual(read!.nodes.map((n) => n.ref).sort(), nodeRefs1, 'node refs stay unchanged through settlement');
      assert.deepEqual(read!.edges.map((e) => e.id).sort(), edgeIds1, 'edge ids stay unchanged through settlement');
      lastRevision = revision;
    }

    // The tight connection (J1) breaks; the safe one (J2) clears.
    assert.equal(settled[j1Ref], 'FAILED', 'the tight onward connection settles to FAILED after the delay');
    assert.equal(settled[j2Ref], 'HEALTHY', 'the slack onward connection clears to HEALTHY despite the same delay');

    const readFinal = await loadRecoveryCaseFacts(pool, seed.workspaceId, caseId, NOW);
    assert.ok(readFinal);
    const nodeByRefFinal = new Map(readFinal!.nodes.map((n) => [n.ref, n]));
    assert.equal(nodeByRefFinal.get(j3Ref)?.evaluation, 'CURRENT', 'the independent subject was never touched');
    assert.equal(nodeByRefFinal.get(j3Ref)?.semanticState, 'HEALTHY');

    // --- Step 5: case linkage is stable — the failed subject's ref is
    // identical to the baseline read and it carries caseRef throughout. The
    // read model has no route to render a subject node before it is attached
    // to a case (see docs/work/ACTIVE_TASK.md FIG-4 note) — RecoveryCase
    // lifecycle transitions are M7/M8-owned and frozen for this lane, so no
    // lifecycle command is exercised here. ---
    const failedNode = nodeByRefFinal.get(j1Ref)!;
    assert.equal(failedNode.ref, j1Ref, 'the failed subject keeps the exact ref used at the baseline read');
    assert.equal(failedNode.caseRef, caseId);
    const overviewByRefFinal = readFinal!.affectedItems;
    assert.ok(overviewByRefFinal?.includes(j1Ref), 'affectedItems names the same canonical ref');

    // --- Step 6: reading twice with no further changes yields an identical
    // revision, node/edge ids and order. ---
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

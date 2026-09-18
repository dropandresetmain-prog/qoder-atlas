/**
 * R2 — focused Case decision surface on the REAL PostgreSQL Case read model.
 *
 * Proves, against live PostgreSQL (LOCAL acceptance only — NOT executed in the
 * Cloud sandbox, which has no PostgreSQL), that the R2 backend enrichment and
 * causal mapping land on the same `loadRecoveryCaseFacts -> projectRecoveryCase`
 * path R1 already proved:
 *
 *   1. The focused graph is enriched from canonical journey/programme state —
 *      SERVICE_BOOKING / TRANSFER_STAY / PROGRAMME_COMMITMENT nodes and
 *      RELIES_ON / MUST_HAPPEN_BEFORE / PARTICIPATES_IN edges — with human
 *      traveller labels, never bare uuids.
 *   2. `focusedGraph` maps the backend `causalPath` onto visible node refs and
 *      edge ids; the frontend never traverses topology (FIG-5b).
 *   3. `subjectLabels` carries authoritative display names keyed `<KIND>:<id>`.
 *   4. CHECKING is a presentation of `evaluation: PENDING_REASSESSMENT`, never a
 *      new semantic verdict.
 *   5. GENERALITY: the SAME code enriches two materially different worlds — an
 *      arrival-readiness/programme case AND a connection/transport case — with no
 *      scenario branch. The connection world has no programme, so it must produce
 *      SERVICE_BOOKING composition without PROGRAMME_COMMITMENT, honestly.
 *
 * Cloud truth boundary: this file is authored + typechecked + linted in Cloud and
 * classified in the `postgres` suite; it is NOT run here. Running it is a LOCAL
 * integration-acceptance proof (see docs/work/R2_LOCAL_ACCEPTANCE_HANDOFF.md).
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed } from './m2Seed.ts';
import {
  KnowledgeFixture, seedBooking, seedJourney, seedJurisdictionWithPlaces, seedService,
  seedTransportIntent, seedTraveller, seedTrip,
} from './m6WorldSeed.ts';
import { openDisruptionCase, worldAt, type DisruptedWorld, type OpenCase, type WorldSpec } from './r1ProgrammeWorld.ts';
import { loadRecoveryCaseFacts } from '../src/app/target/readmodels/pgFactAssembler.ts';
import { projectRecoveryCase } from '../src/app/target/readmodels/projectRecoveryCase.ts';
import { ensureOriginalCaseGraph } from '../src/app/target/originalCaseGraphCapture.ts';
import type { RecoveryCaseView } from '../src/contracts/v2/product/readModels.ts';

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

async function view(c: Pick<OpenCase, 'pool'> & { workspaceId: string; caseId: string }, at?: string): Promise<RecoveryCaseView> {
  const facts = await loadRecoveryCaseFacts(c.pool, c.workspaceId, c.caseId, at);
  assert.ok(facts, 'case facts load');
  return projectRecoveryCase(facts);
}

describe('R2 focused Case graph on the PostgreSQL programme world', () => {
  let c: OpenCase;
  after(async () => { if (c) await c.app.close(); });

  test('the read model enriches the focused graph from canonical journey/programme state', async () => {
    c = await openDisruptionCase('R2 focused graph programme');
    const v = await view({ pool: c.pool, workspaceId: c.world.workspaceId, caseId: c.caseId }, c.now);

    // The focused graph carries the case scope and the enriched node kinds.
    assert.equal(v.ldg.scope, 'FOCUSED_CASE');
    const kinds = new Set(v.ldg.nodes.map((n) => n.kind));
    assert.ok(kinds.has('SERVICE_BOOKING'), `transport composition present: ${[...kinds].join(',')}`);
    assert.ok(kinds.has('PROGRAMME_COMMITMENT'), `programme commitment present: ${[...kinds].join(',')}`);

    // Composition edges are producer-owned ids, never array position (FIG-1).
    const edgeKinds = new Set(v.ldg.edges.map((e) => e.kind));
    assert.ok(edgeKinds.has('RELIES_ON'), `RELIES_ON present: ${[...edgeKinds].join(',')}`);
    assert.ok(edgeKinds.has('PARTICIPATES_IN'), `PARTICIPATES_IN present: ${[...edgeKinds].join(',')}`);
    for (const edge of v.ldg.edges) {
      assert.ok(edge.id.length > 0, 'every edge has a stable producer id');
      assert.ok(v.ldg.nodes.some((n) => n.ref === edge.fromRef), `edge ${edge.id} fromRef resolves`);
      assert.ok(v.ldg.nodes.some((n) => n.ref === edge.toRef), `edge ${edge.id} toRef resolves`);
    }

    // Human labels: no node label is a bare uuid.
    for (const node of v.ldg.nodes) {
      assert.doesNotMatch(node.label, UUID, `node label is human, not a uuid: ${node.label}`);
    }
  });

  test('subjectLabels carries authoritative traveller display names keyed <KIND>:<id>', async () => {
    const v = await view({ pool: c.pool, workspaceId: c.world.workspaceId, caseId: c.caseId }, c.now);
    const keys = Object.keys(v.subjectLabels);
    assert.ok(keys.length > 0, 'at least one subject label resolved');
    for (const key of keys) {
      assert.match(key, /^JOURNEY:/, `subject label key is a typed ref: ${key}`);
      assert.doesNotMatch(v.subjectLabels[key]!, UUID, `label is a display name, not a uuid`);
      assert.ok(v.subjectLabels[key]!.length > 0, 'label is non-empty');
    }
    // The JOURNEY subject node label uses the same authoritative display name.
    const journeyNode = v.ldg.nodes.find((n) => n.ref.startsWith('JOURNEY:'));
    assert.ok(journeyNode, 'a journey subject node exists');
    assert.doesNotMatch(journeyNode.label, UUID, 'journey node label is the traveller name');
  });

  test('focusedGraph maps causalPath onto visible refs without frontend traversal', async () => {
    const v = await view({ pool: c.pool, workspaceId: c.world.workspaceId, caseId: c.caseId }, c.now);
    assert.ok(v.causalPath.length > 0, 'the disrupted case has a backend causal path');
    const fg = v.focusedGraph;
    assert.ok(fg, 'focusedGraph block is present when a causal path exists');

    // Every mapped causal node ref is a visible ldg node ref (FIG-5b).
    const visibleRefs = new Set(v.ldg.nodes.map((n) => n.ref));
    for (const ref of fg.causalNodeRefs) {
      assert.ok(visibleRefs.has(ref), `causal node ref is visible: ${ref}`);
    }
    // Every mapped causal edge id is a visible ldg edge id (FIG-1).
    const visibleEdgeIds = new Set(v.ldg.edges.map((e) => e.id));
    for (const id of fg.causalEdgeIds) {
      assert.ok(visibleEdgeIds.has(id), `causal edge id is visible: ${id}`);
    }
    // firstBreakpoint, when present, points at a visible node and echoes causalPath[0].
    if (fg.firstBreakpoint) {
      assert.ok(visibleRefs.has(fg.firstBreakpoint.nodeRef), 'first breakpoint is visible');
      assert.equal(fg.firstBreakpoint.dimension, v.causalPath[0]!.dimension);
      assert.equal(fg.firstBreakpoint.reasonCode, v.causalPath[0]!.reasonCode);
    }
    // Any causal step that could not be mapped is disclosed, never dropped.
    for (const step of fg.unmappedCausalSteps) {
      assert.ok(step.reason.length > 0, 'unmapped step carries an honest reason');
      assert.ok(!visibleRefs.has(step.subjectRef), 'an unmapped step is genuinely not visible');
    }
  });

  test('CHECKING is presented from evaluation PENDING_REASSESSMENT, never a new verdict', async () => {
    const v = await view({ pool: c.pool, workspaceId: c.world.workspaceId, caseId: c.caseId }, c.now);
    for (const node of v.ldg.nodes) {
      if (node.evaluation === 'PENDING_REASSESSMENT') {
        // The node's semanticState stays an authoritative verdict; CHECKING is a
        // separate evaluation-lifecycle presentation (FIG-7), never a state value.
        assert.ok(
          ['HEALTHY', 'CHANGED', 'AFFECTED', 'FAILED', 'PROPOSED', 'ACTIVE', 'UNKNOWN', 'RECOVERED'].includes(node.semanticState),
          `semanticState remains a closed-verdict value: ${node.semanticState}`,
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Second generality: a materially different world (broken connection, no
// programme) through the SAME enrichment code.
// ---------------------------------------------------------------------------

const CONN_SPEC: WorldSpec = {
  day: '2026-09-05',
  now: '2026-09-04T22:00:00.000Z',
  transport: { originIata: 'MNL', destinationIata: 'CEB', timeZone: 'Asia/Manila' },
};

async function seedConnectionWorld(label: string, spec: WorldSpec): Promise<DisruptedWorld> {
  const pool = await sharedTestPool();
  const seed = await beginSeed(pool, label);
  const tz = spec.transport!.timeZone;
  const at = (hhmm: string) => worldAt(spec, hhmm);
  const observedAt = new Date(Date.parse(spec.now) - 3 * 86_400_000).toISOString();
  const origin = await seedJurisdictionWithPlaces(seed, { name: 'Origin regime', places: [{ name: 'Origin', placeType: 'AIRPORT', timeZone: tz }] });
  const hub = await seedJurisdictionWithPlaces(seed, { name: 'Hub regime', places: [{ name: 'Hub', placeType: 'AIRPORT', timeZone: tz }] });
  const dest = await seedJurisdictionWithPlaces(seed, { name: 'Destination regime', places: [{ name: 'Destination', placeType: 'STATION', timeZone: tz }] });
  const [originId] = origin.placeIds as [string];
  const [hubId] = hub.placeIds as [string];
  const [destId] = dest.placeIds as [string];
  await seed.client.query(
    `INSERT INTO place_external_refs (workspace_id, id, place_id, provider_namespace, external_key, created_by_actor_id)
     VALUES ($1,$2,$3,'IATA',$4,$7), ($1,$5,$6,'IATA',$8,$7)`,
    [seed.workspaceId, randomUUID(), originId, spec.transport!.originIata, randomUUID(), hubId, seed.actorId, spec.transport!.destinationIata],
  );
  const traveller = await seedTraveller(seed, { displayName: 'Connection Traveller' });
  const tripId = await seedTrip(seed, { purpose: 'TEST', lifecycleStatus: 'ACTIVE' });
  const journeyId = await seedJourney(seed, { tripId, travellerId: traveller.travellerId, lifecycleStatus: 'ACTIVE' });
  const inboundServiceId = await seedService(seed, { mode: 'AIR', operator: 'Carrier', originPlaceId: originId, destinationPlaceId: hubId, published: { departure: at('05:00'), arrival: at('08:00'), observedAt } });
  const onwardServiceId = await seedService(seed, { mode: 'AIR', operator: 'Carrier', originPlaceId: hubId, destinationPlaceId: destId, published: { departure: at('12:00'), arrival: at('14:00'), observedAt } });
  const inboundItem = await seedTransportIntent(seed, { journeyId, orderKey: '010', originPlaceId: originId, destinationPlaceId: hubId, selectedServiceId: inboundServiceId, window: { start: at('03:00'), end: at('06:00') } });
  const onwardItem = await seedTransportIntent(seed, { journeyId, orderKey: '020', originPlaceId: hubId, destinationPlaceId: destId, selectedServiceId: onwardServiceId, window: { start: at('11:00'), end: at('13:00') } });
  await seedBooking(seed, { travellerId: traveller.travellerId, serviceId: inboundServiceId, journeyItemId: inboundItem });
  await seedBooking(seed, { travellerId: traveller.travellerId, serviceId: onwardServiceId, journeyItemId: onwardItem });
  await commitSeed(seed);
  const knowledge = new KnowledgeFixture(pool, seed);
  for (const jurisdictionId of [origin.jurisdictionId, hub.jurisdictionId, dest.jurisdictionId]) {
    for (const topic of ['ADVISORY', 'CONDITION', 'ENTRY_REQUIREMENT', 'TRANSIT_REQUIREMENT']) await knowledge.coverage({ topic, completeness: 'COMPLETE', jurisdictionId });
  }
  await knowledge.constraint({
    registeredType: 'minimum_connection_minutes', hardness: 'HARD', owner: { kind: 'PLACE', id: hubId },
    operands: [{ key: 'minutes', kind: 'NUMBER', value: 60 }],
  });
  return { spec, seed, workspaceId: seed.workspaceId, actorId: seed.actorId, people: [{ travellerId: traveller.travellerId, journeyId, tripId }], sharedServiceId: inboundServiceId };
}

describe('R2 focused Case graph generality — connection world, no programme (real PostgreSQL)', () => {
  let c: OpenCase<DisruptedWorld>;
  after(async () => { if (c) await c.app.close(); });

  test('the SAME enrichment code produces transport composition without fabricating programme nodes', async () => {
    c = await openDisruptionCase<DisruptedWorld>('R2 focused graph connection', CONN_SPEC, { seed: seedConnectionWorld, delayedArrival: worldAt(CONN_SPEC, '12:30') });
    const v = await view({ pool: c.pool, workspaceId: c.world.workspaceId, caseId: c.caseId }, c.now);

    assert.equal(v.ldg.scope, 'FOCUSED_CASE');
    const kinds = new Set(v.ldg.nodes.map((n) => n.kind));
    // Transport composition is enriched identically to the programme world.
    assert.ok(kinds.has('SERVICE_BOOKING'), `transport composition present: ${[...kinds].join(',')}`);
    // There is no programme in this world, so no PROGRAMME_COMMITMENT is fabricated.
    assert.ok(!kinds.has('PROGRAMME_COMMITMENT'), `no programme commitment invented: ${[...kinds].join(',')}`);

    // The two transport legs are linked MUST_HAPPEN_BEFORE by canonical order.
    const edgeKinds = new Set(v.ldg.edges.map((e) => e.kind));
    assert.ok(edgeKinds.has('MUST_HAPPEN_BEFORE'), `leg ordering present: ${[...edgeKinds].join(',')}`);

    // Human labels hold in this world too; no bare uuid label.
    for (const node of v.ldg.nodes) {
      assert.doesNotMatch(node.label, UUID, `node label is human: ${node.label}`);
    }
    // focusedGraph maps the connection causal path onto visible refs.
    assert.ok(v.causalPath.length > 0, 'the connection case has a causal path');
    const fg = v.focusedGraph;
    assert.ok(fg, 'focusedGraph present');
    const visibleRefs = new Set(v.ldg.nodes.map((n) => n.ref));
    for (const ref of fg.causalNodeRefs) assert.ok(visibleRefs.has(ref), `causal ref visible: ${ref}`);
  });

  test('the SAME capture code freezes a truthful Original for the connection world, with no programme structure', async () => {
    const ctx = { pool: c.pool, workspaceId: c.world.workspaceId, actorPrincipalId: c.world.actorId, uow: () => c.app.unitOfWork() };
    assert.equal((await ensureOriginalCaseGraph(ctx, { caseId: c.caseId, now: c.now })).status, 'CAPTURED');
    assert.equal((await ensureOriginalCaseGraph(ctx, { caseId: c.caseId, now: c.now })).status, 'EXISTS');
    const v = await view({ pool: c.pool, workspaceId: c.world.workspaceId, caseId: c.caseId }, c.now);
    const original = v.originalFocusedGraph;
    assert.ok(original, 'Original present on the Case read model');
    assert.ok(original.ldg.nodes.some((n) => n.kind === 'SERVICE_BOOKING'));
    assert.ok(!original.ldg.nodes.some((n) => n.kind === 'PROGRAMME_COMMITMENT'), 'no programme node fabricated in the stored Original');
    assert.ok(original.focusedGraph?.firstBreakpoint, 'first breakpoint frozen');
  });
});

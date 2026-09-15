/**
 * M9 3A — progressive connection state derived from the real M6 evaluator,
 * never a caller-supplied SAFE/AT_RISK/IMPOSSIBLE hint.
 *
 * A single Journey's inbound leg is progressively delayed through REAL
 * provider-shaped ingress (acceptProviderShapedDemoEvent ->
 * recordTransportObservation, same mechanism as the M9 1A ingress proof).
 * After each delay, a real evaluateImpact run produces the actual
 * `connection_feasibility` dimension (resolution/evaluation/evaluators/
 * connection.ts, part of the real M6 registry) against the onward leg's
 * fixed departure and the registered `minimum_connection_minutes` (60)
 * constraint at the connecting place. `deriveConnectionViabilityFromEvaluator`
 * (mapConnectionProgression.ts) turns that real verdict+reasonCode into the
 * VIABLE/TIGHT/IMPOSSIBLE hint `mapConnectionProgression` already consumes —
 * closing the C4 finding that this hint was previously caller-supplied.
 *
 * Geometry matches the task's own numbers: 160min -> SAFE, 85min -> SAFE,
 * 30min -> AT_RISK, -65min -> IMPOSSIBLE (minimum connection = 60 minutes).
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed, takeSeedEvidence } from './m2Seed.ts';
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
import { evaluateImpact } from '../src/persistence/postgres/world/pgEvaluation.ts';
import { createM6Registry } from '../src/resolution/evaluation/registry.ts';
import {
  deriveConnectionViabilityFromEvaluator,
  mapConnectionProgression,
} from '../src/app/target/readmodels/mapConnectionProgression.ts';

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

const NOW = '2031-06-02T00:00:00.000Z';
// Onward leg departs NRT at a fixed time; only the inbound arrival moves.
const ONWARD_DEPARTURE = '2031-06-02T12:00:00.000Z';

describe('M9 3A progressive connection state (real evaluator, not a hint)', () => {
  test('160min -> SAFE, 85min -> SAFE, 30min -> AT_RISK, -65min -> IMPOSSIBLE', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'M9 3A connection progression');
    const origin = await seedJurisdictionWithPlaces(seed, { name: 'Origin regime', places: [{ name: 'Origin', placeType: 'STATION' }] });
    const hub = await seedJurisdictionWithPlaces(seed, { name: 'Hub regime', places: [{ name: 'Hub', placeType: 'AIRPORT' }] });
    const dest = await seedJurisdictionWithPlaces(seed, { name: 'Destination regime', places: [{ name: 'Destination', placeType: 'STATION' }] });
    const [originId] = origin.placeIds as [string];
    const [hubId] = hub.placeIds as [string];
    const [destId] = dest.placeIds as [string];

    const travellerId = (await seedTraveller(seed, { displayName: 'Connection Traveller' })).travellerId;
    const journeyId = await seedJourney(seed, { tripId: await seedTrip(seed), travellerId });

    const inboundServiceId = await seedService(seed, {
      mode: 'AIR', operator: 'Test Air', originPlaceId: originId, destinationPlaceId: hubId,
      published: { departure: '2031-06-02T05:00:00.000Z', arrival: '2031-06-02T09:20:00.000Z' },
    });
    const onwardServiceId = await seedService(seed, {
      mode: 'AIR', operator: 'Test Air', originPlaceId: hubId, destinationPlaceId: destId,
      published: { departure: ONWARD_DEPARTURE, arrival: '2031-06-02T15:00:00.000Z' },
    });
    const inboundItem = await seedTransportIntent(seed, {
      journeyId, orderKey: '010', originPlaceId: originId, destinationPlaceId: hubId, selectedServiceId: inboundServiceId,
    });
    const onwardItem = await seedTransportIntent(seed, {
      journeyId, orderKey: '020', originPlaceId: hubId, destinationPlaceId: destId, selectedServiceId: onwardServiceId,
    });
    await seedBooking(seed, { travellerId, serviceId: inboundServiceId, journeyItemId: inboundItem });
    await seedBooking(seed, { travellerId, serviceId: onwardServiceId, journeyItemId: onwardItem });

    await commitSeed(seed);
    const knowledge = new KnowledgeFixture(pool, seed);
    await knowledge.constraint({
      registeredType: 'minimum_connection_minutes', hardness: 'HARD', owner: { kind: 'PLACE', id: hubId },
      operands: [{ key: 'minutes', kind: 'NUMBER', value: 60 }],
    });

    const registry = createM6Registry();
    const ctx = {
      workspaceId: seed.workspaceId,
      actorPrincipalId: seed.actorId,
      uow: () => new PgUnitOfWork(pool, seed.workspaceId),
      pool,
    };

    let stepReceivedAtDay = 1; // strictly increasing observedAt per progressive delay notification
    async function delayInboundArrivalTo(arrival: string): Promise<void> {
      const head = await pool.query<{ revision: string }>(
        'SELECT revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2',
        [seed.workspaceId, inboundServiceId],
      );
      const receivedAt = `2031-05-${String(stepReceivedAtDay++).padStart(2, '0')}T00:00:00.000Z`;
      const result = await acceptProviderShapedDemoEvent(ctx, {
        providerId: 'test-supplier',
        providerEventId: `evt-${randomUUID()}`,
        receivedAt,
        payload: {
          subjectKind: 'TRANSPORT_SERVICE',
          subjectId: inboundServiceId,
          expectedRevision: Number(head.rows[0]!.revision),
          field: 'ACTUAL',
          arrival,
          evidenceId: takeSeedEvidence(seed),
        },
        disclosedAsSimulatedDemoInput: true,
      });
      assert.equal(result.ok, true, result.ok ? '' : JSON.stringify(result.error));
    }

    async function connectionDimension(): Promise<{ verdict: string; reasonCode: string; gapMinutes: unknown }> {
      const run = await evaluateImpact(pool, {
        workspaceId: seed.workspaceId, focus: [{ kind: 'JOURNEY', id: journeyId }], now: NOW, registry,
      });
      const assessment = run.assessments.find((a) => a.subjects[0]?.subjectRef.id === journeyId);
      assert.ok(assessment, 'journey assessed');
      const dim = assessment!.dimensions.find((d) => d.dimension === 'connection_feasibility');
      assert.ok(dim, 'connection_feasibility dimension present');
      assert.equal(dim!.applicable, true);
      const reasonCode = dim!.explanations[0]?.reasonCode ?? '';
      const gapMinutes = dim!.explanations[0]?.facts?.gapMinutes;
      return { verdict: dim!.verdict, reasonCode, gapMinutes };
    }

    // Step 1: 160 minutes of slack -> SAFE.
    await delayInboundArrivalTo('2031-06-02T09:20:00.000Z'); // gap = 160
    let dim = await connectionDimension();
    assert.equal(dim.gapMinutes, 160);
    assert.equal(dim.verdict, 'PASS');
    assert.equal(deriveConnectionViabilityFromEvaluator({ verdict: dim.verdict as 'PASS', reasonCode: dim.reasonCode }), 'VIABLE');
    assert.equal(mapConnectionProgression({ viability: 'VIABLE' }), 'CONNECTION_SAFE');

    // Step 2: 85 minutes of slack (still above the 60-minute minimum) -> SAFE.
    await delayInboundArrivalTo('2031-06-02T10:35:00.000Z'); // gap = 85
    dim = await connectionDimension();
    assert.equal(dim.gapMinutes, 85);
    assert.equal(dim.verdict, 'PASS');
    assert.equal(deriveConnectionViabilityFromEvaluator({ verdict: dim.verdict as 'PASS', reasonCode: dim.reasonCode }), 'VIABLE');
    assert.equal(mapConnectionProgression({ viability: 'VIABLE' }), 'CONNECTION_SAFE');

    // Step 3: 30 minutes of slack (below the 60-minute minimum, still positive) -> AT_RISK.
    await delayInboundArrivalTo('2031-06-02T11:30:00.000Z'); // gap = 30
    dim = await connectionDimension();
    assert.equal(dim.gapMinutes, 30);
    assert.equal(dim.verdict, 'FAIL');
    assert.equal(dim.reasonCode, 'connection_below_minimum');
    assert.equal(deriveConnectionViabilityFromEvaluator({ verdict: dim.verdict as 'FAIL', reasonCode: dim.reasonCode }), 'TIGHT');
    assert.equal(mapConnectionProgression({ viability: 'TIGHT' }), 'CONNECTION_AT_RISK');

    // Step 4: -65 minutes (inbound now arrives after the onward leg departs) -> IMPOSSIBLE.
    await delayInboundArrivalTo('2031-06-02T13:05:00.000Z'); // gap = -65
    dim = await connectionDimension();
    assert.equal(dim.gapMinutes, -65);
    assert.equal(dim.verdict, 'FAIL');
    assert.equal(dim.reasonCode, 'connection_broken');
    assert.equal(deriveConnectionViabilityFromEvaluator({ verdict: dim.verdict as 'FAIL', reasonCode: dim.reasonCode }), 'IMPOSSIBLE');
    assert.equal(mapConnectionProgression({ viability: 'IMPOSSIBLE' }), 'CONNECTION_IMPOSSIBLE');
  });
});

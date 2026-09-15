/**
 * M9 1A — provider-shaped demo ingress proof.
 *
 * `acceptProviderShapedDemoEvent` must invoke the real target
 * signal-normalisation/processing path: provider-shaped event -> canonical
 * PostgreSQL mutation (TRANSPORT_SERVICE_OBSERVED via the accepted
 * `recordTransportObservation` command) -> durable invalidation/reassessment
 * -> downstream blast radius. No direct traveller/case status mutation.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed, takeSeedEvidence } from './m2Seed.ts';
import {
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
import { currentAssessmentView } from '../src/persistence/postgres/world/pgAssessments.ts';
import { evaluateImpact } from '../src/persistence/postgres/world/pgEvaluation.ts';
import { createM6Registry } from '../src/resolution/evaluation/registry.ts';

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

const NOW = '2031-06-02T00:00:00.000Z';

describe('M9 1A provider-shaped demo ingress (real canonical mutation + invalidation)', () => {
  test('a disclosed provider event mutates the transport service and durably invalidates the reached journey — no direct case/traveller write', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'M9 1A ingress');
    const origin = await seedJurisdictionWithPlaces(seed, { name: 'Origin regime', places: [{ name: 'Origin', placeType: 'STATION' }] });
    const host = await seedJurisdictionWithPlaces(seed, { name: 'Host regime', places: [{ name: 'Destination', placeType: 'STATION' }] });
    const [originId] = origin.placeIds as [string];
    const [destId] = host.placeIds as [string];

    const travellerId = (await seedTraveller(seed, { displayName: 'Ingress Traveller' })).travellerId;
    const journeyId = await seedJourney(seed, { tripId: await seedTrip(seed), travellerId });
    const serviceId = await seedService(seed, {
      mode: 'AIR', operator: 'Test Air', originPlaceId: originId, destinationPlaceId: destId,
      published: { departure: '2031-06-02T08:00:00.000Z', arrival: '2031-06-02T10:00:00.000Z' },
    });
    const itemId = await seedTransportIntent(seed, {
      journeyId, orderKey: '010', originPlaceId: originId, destinationPlaceId: destId, selectedServiceId: serviceId,
    });
    await seedBooking(seed, { travellerId, serviceId, journeyItemId: itemId });
    await commitSeed(seed);

    const registry = createM6Registry();
    // Baseline evaluation + persisted assessment so currentness has something to invalidate.
    await evaluateImpact(pool, {
      workspaceId: seed.workspaceId, focus: [{ kind: 'JOURNEY', id: journeyId }], now: NOW, registry, persist: { actorId: seed.actorId },
    });
    const baseline = await currentAssessmentView(pool, seed.workspaceId, { kind: 'JOURNEY', id: journeyId }, 'VIABILITY', NOW);
    assert.equal(baseline.status, 'CURRENT');

    const revisionBefore = await pool.query<{ revision: string }>(
      'SELECT revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2',
      [seed.workspaceId, serviceId],
    );
    const evidenceId = takeSeedEvidence(seed);
    const ctx = {
      workspaceId: seed.workspaceId,
      actorPrincipalId: seed.actorId,
      uow: () => new PgUnitOfWork(pool, seed.workspaceId),
      pool,
    };

    const result = await acceptProviderShapedDemoEvent(ctx, {
      providerId: 'test-supplier',
      providerEventId: `evt-${randomUUID()}`,
      receivedAt: '2031-06-01T23:00:00.000Z',
      payload: {
        subjectKind: 'TRANSPORT_SERVICE',
        subjectId: serviceId,
        expectedRevision: Number(revisionBefore.rows[0]!.revision),
        field: 'ACTUAL',
        arrival: '2031-06-02T13:00:00.000Z',
        evidenceId,
      },
      disclosedAsSimulatedDemoInput: true,
    });
    assert.equal(result.ok, true, result.ok ? '' : JSON.stringify(result.error));
    if (!result.ok) return;
    assert.equal(result.mutationStatus, 'APPLIED');
    assert.equal(result.subjectRef.kind, 'TRANSPORT_SERVICE');

    // Real canonical mutation — checked directly, never inferred.
    const row = await pool.query<{ actual_arrival: Date }>(
      'SELECT actual_arrival FROM transport_services WHERE workspace_id = $1 AND id = $2',
      [seed.workspaceId, serviceId],
    );
    assert.equal(row.rows[0]!.actual_arrival.toISOString(), '2031-06-02T13:00:00.000Z');

    // No case/traveller table was touched by ingress.
    const cases = await pool.query('SELECT id FROM recovery_cases WHERE workspace_id = $1', [seed.workspaceId]);
    assert.equal(cases.rows.length, 0, 'ingress must not open/mutate a RecoveryCase directly');

    // Downstream blast radius: the accepted M6 invalidation mechanism durably
    // marks the reached Journey for reassessment — nobody walked the graph by hand.
    const invalidated = await currentAssessmentView(pool, seed.workspaceId, { kind: 'JOURNEY', id: journeyId }, 'VIABILITY', NOW);
    assert.equal(invalidated.status, 'PENDING_REASSESSMENT', JSON.stringify(invalidated));

    // Re-evaluating now reflects the new (very late) arrival.
    const after = await evaluateImpact(pool, {
      workspaceId: seed.workspaceId, focus: [{ kind: 'TRANSPORT_SERVICE', id: serviceId }], now: NOW, registry, persist: { actorId: seed.actorId },
    });
    const journeyAssessment = after.assessments.find((a) => a.subjects[0]?.subjectRef.id === journeyId);
    assert.ok(journeyAssessment, 'reached journey re-assessed after ingress');
  });

  test('replaying the same provider event twice is idempotent (second call is a safe no-op, not a duplicate mutation)', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'M9 1A ingress idempotency');
    const origin = await seedJurisdictionWithPlaces(seed, { name: 'Origin regime', places: [{ name: 'Origin', placeType: 'STATION' }] });
    const host = await seedJurisdictionWithPlaces(seed, { name: 'Host regime', places: [{ name: 'Destination', placeType: 'STATION' }] });
    const [originId] = origin.placeIds as [string];
    const [destId] = host.placeIds as [string];
    const serviceId = await seedService(seed, {
      mode: 'AIR', operator: 'Test Air', originPlaceId: originId, destinationPlaceId: destId,
      published: { departure: '2031-06-02T08:00:00.000Z', arrival: '2031-06-02T10:00:00.000Z' },
    });
    await commitSeed(seed);

    const revisionBefore = await pool.query<{ revision: string }>(
      'SELECT revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2',
      [seed.workspaceId, serviceId],
    );
    const ctx = {
      workspaceId: seed.workspaceId,
      actorPrincipalId: seed.actorId,
      uow: () => new PgUnitOfWork(pool, seed.workspaceId),
      pool,
    };
    const providerEventId = `evt-${randomUUID()}`;
    const event = {
      providerId: 'test-supplier',
      providerEventId,
      receivedAt: '2031-06-01T23:00:00.000Z',
      payload: {
        subjectKind: 'TRANSPORT_SERVICE' as const,
        subjectId: serviceId,
        expectedRevision: Number(revisionBefore.rows[0]!.revision),
        field: 'ACTUAL' as const,
        arrival: '2031-06-02T13:00:00.000Z',
        evidenceId: takeSeedEvidence(seed),
      },
      disclosedAsSimulatedDemoInput: true as const,
    };
    const first = await acceptProviderShapedDemoEvent(ctx, event);
    assert.equal(first.ok, true);
    const second = await acceptProviderShapedDemoEvent(ctx, event);
    assert.equal(second.ok, true, second.ok ? '' : JSON.stringify(second.error));
    if (first.ok && second.ok) {
      assert.equal(second.revision, first.revision, 'replay must not advance the revision a second time');
    }
  });
});

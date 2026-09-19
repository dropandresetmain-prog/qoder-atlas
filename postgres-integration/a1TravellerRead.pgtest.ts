/**
 * A1 Traveller read proof against the real PostgreSQL projection.
 *
 * The programme and connection worlds deliberately use the existing R1/R2
 * fixture loaders. This keeps the assertions on allocation joins, required
 * participation and assessment currentness rather than on hand-built facts.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import { seedProgrammeWorld, openDisruptionCase, applyProviderDelay, worldAt, type OpenCase } from './r1ProgrammeWorld.ts';
import { CONN_SPEC, seedConnectionWorld } from './r2ConnectionWorld.ts';
import { attachSeedSession, commitSeed, rollbackSeed } from './m2Seed.ts';
import { seedBooking, seedService } from './m6WorldSeed.ts';
import { runBaselineEvaluation } from '../src/app/demo/baselineEvaluation.ts';
import { loadTravellerTripFacts } from '../src/app/target/readmodels/pgFactAssembler.ts';
import { transitionRecoveryCase } from '../src/persistence/postgres/commands/caseLifecycleCommands.ts';

after(async () => {
  await (await sharedTestPool()).end();
});

test('Traveller read uses authoritative allocations, commitments and currentness', async () => {
  const pool = await sharedTestPool();

  // The R1 programme world proves the selected service and REQUIRED accepted
  // participation are recovered through the real allocation joins.
  const programme = await seedProgrammeWorld('A1 Traveller read programme');
  await runBaselineEvaluation({ pool, workspaceId: programme.workspaceId, actorPrincipalId: programme.actorId, now: programme.spec.now });
  const programmeFacts = await loadTravellerTripFacts(pool, programme.workspaceId, programme.people[0]!.journeyId, programme.spec.now);
  assert.ok(programmeFacts);
  assert.equal(programmeFacts.whatChanged, undefined, 'a healthy journey with no case has no fictional change');
  assert.ok(programmeFacts.itinerary?.some((item) => item.label === 'Carrier' && item.status === 'CONFIRMED'));
  assert.ok(programmeFacts.itinerary?.some((item) => item.originLabel === 'Origin' && item.destinationLabel === 'Venue'));
  assert.equal(programmeFacts.commitment?.label, 'Early required item');
  assert.equal(programmeFacts.commitment?.placeLabel, 'Venue');

  // A replacement service must not inherit the status of an older allocation
  // merely because that allocation sorts first by UUID. The selected service
  // is the only authoritative booking identity for this JourneyItem.
  const item = await pool.query<{
    journey_item_id: string;
    origin_place_id: string;
    destination_place_id: string;
    old_allocation_id: string;
    old_line_id: string;
    old_reservation_id: string;
  }>(
    `SELECT ji.id AS journey_item_id,
            ts.origin_place_id, ts.destination_place_id,
            ra.id AS old_allocation_id, ra.line_id AS old_line_id,
            ra.reservation_id AS old_reservation_id
       FROM journey_items ji
       JOIN transport_item_details tid ON tid.workspace_id = ji.workspace_id AND tid.journey_item_id = ji.id
       JOIN transport_services ts ON ts.workspace_id = ji.workspace_id AND ts.id = tid.selected_service_id
       JOIN reservation_allocations ra ON ra.workspace_id = ji.workspace_id
        AND ra.journey_item_id = ji.id AND ra.traveller_id = $3
       JOIN transport_line_details old_tld ON old_tld.workspace_id = ra.workspace_id
        AND old_tld.line_id = ra.line_id AND old_tld.transport_service_id = tid.selected_service_id
      WHERE ji.workspace_id = $1 AND ji.journey_id = $2 AND ji.kind = 'TRANSPORT'
      LIMIT 1`,
    [programme.workspaceId, programme.people[0]!.journeyId, programme.people[0]!.travellerId],
  );
  assert.equal(item.rows.length, 1);
  const currentItem = item.rows[0]!;
  const replacementSeed = await attachSeedSession(pool, programme.workspaceId, programme.actorId, 16);
  let replacementCommitted = false;
  try {
    const replacementServiceId = await seedService(replacementSeed, {
      operator: 'Replacement Carrier',
      originPlaceId: currentItem.origin_place_id,
      destinationPlaceId: currentItem.destination_place_id,
      published: {
        departure: worldAt(programme.spec, '06:00'),
        arrival: worldAt(programme.spec, '09:00'),
        observedAt: programme.spec.now,
      },
    });
    await seedBooking(replacementSeed, {
      travellerId: programme.people[0]!.travellerId,
      serviceId: replacementServiceId,
      journeyItemId: currentItem.journey_item_id,
    });
    await commitSeed(replacementSeed);
    replacementCommitted = true;

    // Force the historical allocation to be the first UUID candidate so the
    // old LIMIT 1 projection would demonstrably report its cancelled status.
    await pool.query(
      `UPDATE reservation_allocations SET id = $3 WHERE workspace_id = $1 AND id = $2`,
      [programme.workspaceId, currentItem.old_allocation_id, '00000000-0000-0000-0000-000000000001'],
    );
    await pool.query(
      `UPDATE reservation_lines
          SET observed_status = 'CANCELLED', observed_status_at = NOW()
        WHERE workspace_id = $1 AND id = $2`,
      [programme.workspaceId, currentItem.old_line_id],
    );
    await pool.query(
      `UPDATE reservations
          SET observed_status = 'CANCELLED', observed_status_at = NOW()
        WHERE workspace_id = $1 AND id = $2`,
      [programme.workspaceId, currentItem.old_reservation_id],
    );
    await pool.query(
      `UPDATE transport_item_details
          SET selected_service_id = $3
        WHERE workspace_id = $1 AND journey_item_id = $2`,
      [programme.workspaceId, currentItem.journey_item_id, replacementServiceId],
    );

    const replacementFacts = await loadTravellerTripFacts(pool, programme.workspaceId, programme.people[0]!.journeyId, programme.spec.now);
    assert.equal(replacementFacts?.itinerary?.[0]?.label, 'Replacement Carrier');
    assert.equal(replacementFacts?.itinerary?.[0]?.status, 'CONFIRMED');

    const conflictSeed = await attachSeedSession(pool, programme.workspaceId, programme.actorId, 16);
    let conflictCommitted = false;
    try {
      await seedBooking(conflictSeed, {
        travellerId: programme.people[0]!.travellerId,
        serviceId: replacementServiceId,
        journeyItemId: currentItem.journey_item_id,
        lineStatus: 'CANCELLED',
      });
      await commitSeed(conflictSeed);
      conflictCommitted = true;
    } finally {
      if (!conflictCommitted) await rollbackSeed(conflictSeed);
    }
    const conflictingFacts = await loadTravellerTripFacts(pool, programme.workspaceId, programme.people[0]!.journeyId, programme.spec.now);
    assert.equal(conflictingFacts?.itinerary?.[0]?.status, 'UNKNOWN');
  } finally {
    if (!replacementCommitted) await rollbackSeed(replacementSeed);
  }

  // The existing R2 connection loader proves the same read path handles two
  // allocated legs without relying on programme-only data.
  const connection = await seedConnectionWorld('A1 Traveller read connection', CONN_SPEC);
  await runBaselineEvaluation({ pool, workspaceId: connection.workspaceId, actorPrincipalId: connection.actorId, now: connection.spec.now });
  const connectionFacts = await loadTravellerTripFacts(pool, connection.workspaceId, connection.people[0]!.journeyId, connection.spec.now);
  assert.ok(connectionFacts);
  assert.equal(connectionFacts.itinerary?.length, 2);
  assert.ok(connectionFacts.itinerary?.every((item) => item.status === 'CONFIRMED'));

  let disrupted: OpenCase | undefined;
  try {
    disrupted = await openDisruptionCase('A1 Traveller read currentness');
    const journeyId = disrupted.world.people[0]!.journeyId;

    // A canonical provider-shaped change creates real pending reassessment
    // work. Until it is drained, the traveller projection must stay UNKNOWN.
    await applyProviderDelay(disrupted, worldAt(disrupted.world.spec, '12:00'));
    const pending = await loadTravellerTripFacts(disrupted.pool, disrupted.world.workspaceId, journeyId, disrupted.now);
    assert.ok(pending);
    assert.equal(pending.amIOkay, 'UNKNOWN');
    assert.equal(pending.doesTheRestWork, 'UNKNOWN');

    // Removing only the open work item leaves the changed canonical input and
    // demonstrates the distinct STALE path also remains UNKNOWN.
    await disrupted.pool.query(
      `DELETE FROM scheduled_reassessments
        WHERE workspace_id = $1 AND subject_kind = 'JOURNEY' AND subject_id = $2 AND assessment_kind = 'VIABILITY' AND state <> 'DONE'`,
      [disrupted.world.workspaceId, journeyId],
    );
    const stale = await loadTravellerTripFacts(disrupted.pool, disrupted.world.workspaceId, journeyId, disrupted.now);
    assert.ok(stale);
    assert.equal(stale.amIOkay, 'UNKNOWN');
    assert.equal(stale.doesTheRestWork, 'UNKNOWN');

    const toPlanning = await transitionRecoveryCase(disrupted.app.unitOfWork(), {
      workspaceId: disrupted.world.workspaceId,
      actorPrincipalId: disrupted.world.actorId,
      idempotencyKey: randomUUID(),
      caseId: disrupted.caseId,
      from: 'OPEN',
      to: 'PLANNING',
      reason: 'A1 traveller read proof',
    });
    assert.equal(toPlanning.ok, true, JSON.stringify(toPlanning));
    const toAuthority = await transitionRecoveryCase(disrupted.app.unitOfWork(), {
      workspaceId: disrupted.world.workspaceId,
      actorPrincipalId: disrupted.world.actorId,
      idempotencyKey: randomUUID(),
      caseId: disrupted.caseId,
      from: 'PLANNING',
      to: 'AWAITING_AUTHORITY',
      reason: 'A1 traveller read proof',
    });
    assert.equal(toAuthority.ok, true, JSON.stringify(toAuthority));

    const awaiting = await loadTravellerTripFacts(disrupted.pool, disrupted.world.workspaceId, journeyId, disrupted.now);
    assert.ok(awaiting);
    assert.match(awaiting.whatDoYouNeedFromMe ?? '', /Nothing required from you right now/i);
    assert.match(awaiting.whatDoYouNeedFromMe ?? '', /waiting for approval/i);
    assert.doesNotMatch(awaiting.whatDoYouNeedFromMe ?? '', /organiser/i);

    await disrupted.pool.query(
      `UPDATE recovery_cases
          SET lifecycle_status = 'CLOSED', closed_at = NOW()
        WHERE workspace_id = $1 AND id = $2`,
      [disrupted.world.workspaceId, disrupted.caseId],
    );
    const closed = await loadTravellerTripFacts(disrupted.pool, disrupted.world.workspaceId, journeyId, disrupted.now);
    assert.ok(closed);
    assert.match(closed.whatNorthstarIsDoing ?? '', /closed the recovery work/i);
    assert.equal(closed.whatChangedAfterRecovery, undefined);
  } finally {
    if (disrupted!) await disrupted.app.close();
  }
});

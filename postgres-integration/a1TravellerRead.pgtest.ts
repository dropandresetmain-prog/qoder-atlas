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
    assert.match(awaiting.whatDoYouNeedFromMe ?? '', /organiser is reviewing/i);
    assert.doesNotMatch(awaiting.whatDoYouNeedFromMe ?? '', /authority decision may be required/i);
  } finally {
    if (disrupted!) await disrupted.app.close();
  }
});

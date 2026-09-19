/**
 * M9 1B — authoritative server-side programme time-swap preview proof.
 *
 * Proves the HTTP-facing preview command loads real PostgreSQL state, builds
 * a genuine bilateral M7 counterfactual overlay (two CHANGE_PROGRAMME_ITEM_TIME
 * effects), and gets its PASS/FAIL verdicts from the real M6 registry
 * (`participationEvaluator`'s programme-arrival-readiness check reading actual
 * booked-transport arrival facts) — never a caller-supplied `evaluate`
 * function, and never mutating authoritative state.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed } from './m2Seed.ts';
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
import { commandPreviewAuthoritativeBilateralProgrammeTimeSwap } from '../src/app/target/applicationCommands.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { stageProgrammeTimeSwap } from '../src/app/target/programmeTimeSwapStaging.ts';
import { seedRootSubject } from './m2Seed.ts';
import { runBaselineEvaluation } from '../src/app/demo/baselineEvaluation.ts';

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

const NOW = '2031-06-02T00:00:00.000Z';
const EARLY_WINDOW = { start: '2031-06-02T11:30:00.000Z', end: '2031-06-02T12:00:00.000Z' };
const LATE_WINDOW = { start: '2031-06-02T15:00:00.000Z', end: '2031-06-02T15:30:00.000Z' };

describe('M9 1B authoritative programme time-swap preview (real M6 evaluator)', () => {
  test('server builds the overlay and invokes the real evaluator; caller supplies only item refs', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'M9 1B preview');

    const host = await seedJurisdictionWithPlaces(seed, { name: 'Host regime', places: [{ name: 'Venue', placeType: 'VENUE' }] });
    const origin = await seedJurisdictionWithPlaces(seed, { name: 'Origin regime', places: [{ name: 'Origin', placeType: 'STATION' }] });
    const [venueId] = host.placeIds as [string];
    const [originId] = origin.placeIds as [string];

    // Alice's flight arrives late (10:30) — plenty of margin for the LATE
    // commitment, not enough for the EARLY one (150-minute readiness rule).
    const aliceId = (await seedTraveller(seed, { displayName: 'Alice' })).travellerId;
    const aliceJourney = await seedJourney(seed, { tripId: await seedTrip(seed), travellerId: aliceId });
    const aliceService = await seedService(seed, {
      mode: 'AIR', operator: 'Test Air', originPlaceId: originId, destinationPlaceId: venueId,
      published: { departure: '2031-06-02T08:00:00.000Z', arrival: '2031-06-02T10:30:00.000Z' },
    });
    const aliceItem = await seedTransportIntent(seed, {
      journeyId: aliceJourney, orderKey: '010', originPlaceId: originId, destinationPlaceId: venueId, selectedServiceId: aliceService,
    });
    await seedBooking(seed, { travellerId: aliceId, serviceId: aliceService, journeyItemId: aliceItem });

    // Bob's flight arrives early (07:00) — comfortable margin for either commitment.
    const bobId = (await seedTraveller(seed, { displayName: 'Bob' })).travellerId;
    const bobJourney = await seedJourney(seed, { tripId: await seedTrip(seed), travellerId: bobId });
    const bobService = await seedService(seed, {
      mode: 'AIR', operator: 'Test Air', originPlaceId: originId, destinationPlaceId: venueId,
      published: { departure: '2031-06-02T04:00:00.000Z', arrival: '2031-06-02T07:00:00.000Z' },
    });
    const bobItem = await seedTransportIntent(seed, {
      journeyId: bobJourney, orderKey: '010', originPlaceId: originId, destinationPlaceId: venueId, selectedServiceId: bobService,
    });
    await seedBooking(seed, { travellerId: bobId, serviceId: bobService, journeyItemId: bobItem });

    const eventId = await seedEvent(seed, { lifecycleStatus: 'ACTIVE' });
    const programmeId = await seedProgramme(seed, { eventId, lifecycleStatus: 'ACTIVE' });
    const earlyItem = await seedProgrammeItem(seed, {
      programmeId, title: 'Early required commitment', placeId: venueId, lifecycleStatus: 'SCHEDULED', scheduleAuthority: 'INTERNAL',
      window: EARLY_WINDOW, operatingRequirements: { requiresPhysicalPresence: true, readinessBufferMinutes: 150 },
    });
    const lateItem = await seedProgrammeItem(seed, {
      programmeId, title: 'Later commitment', placeId: venueId, lifecycleStatus: 'SCHEDULED', scheduleAuthority: 'INTERNAL',
      window: LATE_WINDOW, operatingRequirements: { requiresPhysicalPresence: true, readinessBufferMinutes: 150 },
    });
    await seedParticipation(seed, { programmeItemId: earlyItem.programmeItemId, travellerId: aliceId, obligation: 'REQUIRED', accepted: true });
    await seedParticipation(seed, { programmeItemId: lateItem.programmeItemId, travellerId: bobId, obligation: 'REQUIRED', accepted: true });
    const recoveryCaseId = await seedRootSubject(seed, { kind: 'RECOVERY_CASE' });
    await seed.client.query(
      `INSERT INTO recovery_cases (workspace_id, id, lifecycle_status, created_by_actor_id)
       VALUES ($1, $2, 'OPEN', $3)`,
      [seed.workspaceId, recoveryCaseId, seed.actorId],
    );
    await seed.client.query(
      `INSERT INTO case_subjects (workspace_id, recovery_case_id, subject_kind, subject_id, role)
       VALUES ($1, $2, 'JOURNEY', $3, 'AFFECTED')`,
      [seed.workspaceId, recoveryCaseId, aliceJourney],
    );
    const unrelatedCaseId = await seedRootSubject(seed, { kind: 'RECOVERY_CASE' });
    await seed.client.query(
      `INSERT INTO recovery_cases (workspace_id, id, lifecycle_status, created_by_actor_id)
       VALUES ($1, $2, 'OPEN', $3)`,
      [seed.workspaceId, unrelatedCaseId, seed.actorId],
    );
    const terminalCaseId = await seedRootSubject(seed, { kind: 'RECOVERY_CASE' });
    await seed.client.query(
      `INSERT INTO recovery_cases (workspace_id, id, lifecycle_status, closed_at, created_by_actor_id)
       VALUES ($1, $2, 'CANCELLED', $3, $4)`,
      [seed.workspaceId, terminalCaseId, NOW, seed.actorId],
    );
    await commitSeed(seed);

    // Complete knowledge coverage for both jurisdictions so the m6.entry /
    // m6.information dimensions resolve PASS instead of UNKNOWN — this test
    // targets programme-arrival-readiness (m6.participation), not entry/advisory
    // knowledge, but overall viability is genuinely whole-person (all dimensions).
    const knowledge = new KnowledgeFixture(pool, seed);
    for (const jurisdictionId of [host.jurisdictionId, origin.jurisdictionId]) {
      for (const topic of ['ADVISORY', 'CONDITION', 'ENTRY_REQUIREMENT', 'TRANSIT_REQUIREMENT']) {
        await knowledge.coverage({ topic, completeness: 'COMPLETE', jurisdictionId });
      }
    }
    const baseline = await runBaselineEvaluation({ pool, workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, now: NOW });
    assert.equal(baseline.evaluated, 2);

    const beforeWindows = await pool.query<{ id: string; window_start: Date }>(
      `SELECT id, window_start FROM programme_items WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
      [seed.workspaceId, [earlyItem.programmeItemId, lateItem.programmeItemId]],
    );

    const outcome = await commandPreviewAuthoritativeBilateralProgrammeTimeSwap(
      { workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, uow: () => { throw new Error('preview must not open a UnitOfWork'); }, pool },
      { itemARef: earlyItem.programmeItemId, itemBRef: lateItem.programmeItemId, now: NOW },
    );
    assert.equal(outcome.ok, true, !outcome.ok ? outcome.error : '');
    if (!outcome.ok) return;
    const { result } = outcome;

    assert.equal(result.mutatesAuthoritativeState, false);

    // Real evaluator verdicts: Alice FAILs the early commitment today (only
    // 60 of 150 required minutes), Bob PASSes the late one comfortably.
    const aliceProjection = result.projections.find((p) => p.travellerRef === aliceId);
    const bobProjection = result.projections.find((p) => p.travellerRef === bobId);
    assert.ok(aliceProjection, 'Alice projected');
    assert.ok(bobProjection, 'Bob projected');
    assert.equal(aliceProjection!.side, 'ITEM_A');
    assert.equal(bobProjection!.side, 'ITEM_B');

    // After the proposed swap (item windows exchanged, participants unchanged):
    // Alice inherits the late window (ample margin) -> PASS; Bob inherits the
    // early window but still arrives comfortably early -> PASS. Both viable.
    assert.equal(aliceProjection!.verdict, 'PASS', JSON.stringify(aliceProjection));
    assert.equal(bobProjection!.verdict, 'PASS', JSON.stringify(bobProjection));
    assert.equal(result.bothPartiesProjectedViable, true);
    assert.equal(result.othersRemainViable, true);
    assert.equal(result.previewAccepted, true);
    assert.equal(result.strategyViability, 'VIABLE');

    const staged = await stageProgrammeTimeSwap(
      { pool, uow: () => new PgUnitOfWork(pool, seed.workspaceId) },
      {
        workspaceId: seed.workspaceId,
        actorPrincipalId: seed.actorId,
        recoveryCaseId,
        itemARef: earlyItem.programmeItemId,
        itemBRef: lateItem.programmeItemId,
        now: NOW,
      },
    );
    assert.equal(staged.ok, true, !staged.ok ? staged.error : '');
    if (staged.ok) {
      assert.equal(staged.value.recoveryCaseId, recoveryCaseId);
      assert.ok(staged.value.strategyId);
      assert.ok(staged.value.scenarioChangeId);
      const replay = await stageProgrammeTimeSwap(
        { pool, uow: () => new PgUnitOfWork(pool, seed.workspaceId) },
        {
          workspaceId: seed.workspaceId,
          actorPrincipalId: seed.actorId,
          recoveryCaseId,
          itemARef: lateItem.programmeItemId,
          itemBRef: earlyItem.programmeItemId,
          now: NOW,
        },
      );
      assert.deepEqual(replay, staged, 'the same pair/case/revision replays the staged strategy');
      const stored = await pool.query<{ viability: string; status: string }>(
        `SELECT viability, status FROM recovery_strategies WHERE workspace_id = $1 AND id = $2`,
        [seed.workspaceId, staged.value.strategyId],
      );
      assert.deepEqual(stored.rows[0], { viability: 'VIABLE', status: 'EVALUATED' });
    }

    const programmeRevision = await pool.query<{ revision: string }>(
      `SELECT revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2`,
      [seed.workspaceId, programmeId],
    );
    const stale = await stageProgrammeTimeSwap(
      { pool, uow: () => new PgUnitOfWork(pool, seed.workspaceId) },
      {
        workspaceId: seed.workspaceId,
        actorPrincipalId: seed.actorId,
        recoveryCaseId,
        itemARef: earlyItem.programmeItemId,
        itemBRef: lateItem.programmeItemId,
        now: NOW,
        expectedProgrammeRevisions: [{ aggregateRef: { kind: 'PROGRAMME', id: programmeId }, expectedRevision: Number(programmeRevision.rows[0]!.revision) + 1 }],
      },
    );
    assert.deepEqual(stale, { ok: false, error: 'PROGRAMME_REVISION_STALE' });

    const unrelated = await stageProgrammeTimeSwap(
      { pool, uow: () => new PgUnitOfWork(pool, seed.workspaceId) },
      { workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, recoveryCaseId: unrelatedCaseId, itemARef: earlyItem.programmeItemId, itemBRef: lateItem.programmeItemId, now: NOW },
    );
    assert.deepEqual(unrelated, { ok: false, error: 'RECOVERY_CASE_SCOPE_MISMATCH' });
    const terminal = await stageProgrammeTimeSwap(
      { pool, uow: () => new PgUnitOfWork(pool, seed.workspaceId) },
      { workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, recoveryCaseId: terminalCaseId, itemARef: earlyItem.programmeItemId, itemBRef: lateItem.programmeItemId, now: NOW },
    );
    assert.deepEqual(terminal, { ok: false, error: 'RECOVERY_CASE_NOT_ACTIVE' });

    // Canonical state genuinely untouched.
    const afterWindows = await pool.query<{ id: string; window_start: Date }>(
      `SELECT id, window_start FROM programme_items WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
      [seed.workspaceId, [earlyItem.programmeItemId, lateItem.programmeItemId]],
    );
    assert.deepEqual(
      afterWindows.rows.map((r) => `${r.id}:${r.window_start.toISOString()}`).sort(),
      beforeWindows.rows.map((r) => `${r.id}:${r.window_start.toISOString()}`).sort(),
    );
  });

  test('rejects a request for programme items that do not exist, without leaking an evaluate hook', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'M9 1B preview missing items');
    await commitSeed(seed);
    const outcome = await commandPreviewAuthoritativeBilateralProgrammeTimeSwap(
      { workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, uow: () => { throw new Error('unused'); }, pool },
      { itemARef: '00000000-0000-0000-0000-000000000001', itemBRef: '00000000-0000-0000-0000-000000000002', now: NOW },
    );
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.error, 'PROGRAMME_ITEM_NOT_FOUND');
  });
});

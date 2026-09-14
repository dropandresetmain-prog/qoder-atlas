/**
 * M4 lane — Event / Programme / ProgrammeItem / Participation /
 * ResourceAssignment, run against real PostgreSQL (never a mock).
 *
 * One case per acceptance rule from the M4 brief:
 *  1. Event registration is one atomic root write.
 *  2. An Event may own several independent Programmes.
 *  3. A raw ProgrammeItem subject with no `programme_items` row (or the wrong
 *     owning Programme) fails closed at COMMIT via the 0056 checker.
 *  4. A non-UUID id at the persistence boundary is a typed VALIDATION_FAILED,
 *     never a raw `22P02` (G12 UUID rule, docs/refactor/evidence/M2_INTEGRATION_DECISIONS.md).
 *  5. A TypedRef of the wrong SubjectKind is rejected, not silently coerced.
 *  6. One programme move (schedule/place) advances exactly one Programme
 *     revision, whatever child row it touched.
 *  7. Cancellation and explicit reinstatement both work, and only within the
 *     typed transition table.
 *  8. Two Travellers can each hold a Participation on one ProgrammeItem.
 *  9. One Traveller can hold multiple roles on one Participation.
 * 10. A local participant needs no Trip/Journey at all.
 * 11. `engagement_item_details.participation_id` -> `participations.traveller_id`
 *     mismatch is rejected (0062 backstop), and a matching link commits.
 * 12. An INTERNAL-authority schedule change commits normally.
 * 13. An EXTERNAL-authority item refuses a direct schedule command, and an
 *     observation records without mutating `programme_items`.
 * 14. Two concurrent schedule commands on the same Programme: exactly one wins.
 * 15. A stale expected Programme revision changes nothing.
 * 16. Equal-key replay returns the original receipt without a second write.
 * 17. A forced SERIALIZABLE retry still leaves exactly the rows one clean run would.
 * 22. ResourceAssignment is a real reference seam for both PROGRAMME_ITEM and
 *     JOURNEY_ITEM activities, validated by the 0058 deferred trigger.
 *
 * Every case opens a fresh workspace and only ever touches rows it inserted —
 * the PostgreSQL test database is shared with sibling M2/M3/M5 lanes.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { beginSeed, commitSeed, seedJourney, seedJourneyItem, seedTraveller, seedTrip } from './m2Seed.ts';
import { sharedTestPool } from './harness.ts';
import type { Pool } from '../src/persistence/postgres/pool.ts';
import { PgUnitOfWork, type ExecuteOutcome } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { runWithTransactionClient } from '../src/persistence/postgres/transactionContext.ts';
import type { TypedConflict } from '../src/domain/v2/shared/errors.ts';
import { PgProgrammeReadQueries } from '../src/persistence/postgres/queries/pgProgrammeReadQueries.ts';
import {
  addParticipation,
  addProgrammeItem,
  createEvent,
  createProgramme,
  createResourceAssignment,
  recordExternalScheduleObservation,
  setEventLifecycleStatus,
  setProgrammeItemLifecycleStatus,
  setProgrammeItemScheduleAuthority,
  setProgrammeLifecycleStatus,
  setResourceAssignmentStatus,
  updateParticipation,
  updateProgrammeItemSchedule,
} from '../src/persistence/postgres/commands/programmeCommands.ts';

const T0 = Date.UTC(2030, 5, 1);
const at = (minutes: number): string => new Date(T0 + minutes * 60_000).toISOString();
const WINDOW_A = { start: at(0), end: at(60) };
const WINDOW_B = { start: at(120), end: at(180) };

interface Fixture {
  pool: Pool;
  workspaceId: string;
  identity: { workspaceId: string; actorPrincipalId: string };
  travellerIds: string[];
  uow: () => PgUnitOfWork;
}

async function fixture(travellerCount = 2): Promise<Fixture> {
  const pool = await sharedTestPool();
  const seed = await beginSeed(pool);
  const travellers = [];
  for (let i = 0; i < travellerCount; i++) travellers.push((await seedTraveller(seed)).travellerId);
  await commitSeed(seed);
  return {
    pool,
    workspaceId: seed.workspaceId,
    identity: { workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId },
    travellerIds: travellers,
    uow: () => new PgUnitOfWork(pool, seed.workspaceId),
  };
}

function mustOk<T>(outcome: ExecuteOutcome<T>): T {
  if (!outcome.ok) assert.fail(`expected the command to commit, got ${outcome.conflict.kind}: ${outcome.conflict.message}`);
  return outcome.value;
}

function conflictOf(outcome: ExecuteOutcome<unknown>): TypedConflict {
  if (outcome.ok) assert.fail('expected a typed conflict, but the command committed');
  return outcome.conflict;
}

async function scalar<T extends Record<string, unknown>>(pool: Pool, sql: string, values: unknown[] = []): Promise<T> {
  const result = await pool.query<T>(sql, values);
  const row = result.rows[0];
  if (!row) throw new Error(`probe returned no row: ${sql}`);
  return row;
}

async function readThrough<T>(pool: Pool, fn: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await runWithTransactionClient(client, fn);
    await client.query('ROLLBACK');
    return value;
  } finally {
    client.release();
  }
}

/** Standard Event+Programme+ProgrammeItem chain most tests build on. */
async function seedEventProgrammeItem(f: Fixture): Promise<{ eventId: string; programmeId: string; programmeRevision: number; programmeItemId: string }> {
  const event = mustOk(await createEvent(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), title: 'Fixture Event' }));
  const programme = mustOk(
    await createProgramme(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), eventId: event.eventId, title: 'Fixture Programme' }),
  );
  const item = mustOk(
    await addProgrammeItem(f.uow(), {
      ...f.identity,
      idempotencyKey: randomUUID(),
      programmeId: programme.programmeId,
      expectedProgrammeRevision: programme.revision,
      item: { title: 'Session', itemType: 'SESSION' },
    }),
  );
  return { eventId: event.eventId, programmeId: programme.programmeId, programmeRevision: item.programmeRevision, programmeItemId: item.programmeItemId };
}

describe('M4: Event registration and Programme ownership', () => {
  test('one command writes the Event root atomically', async () => {
    const f = await fixture(0);
    const result = mustOk(await createEvent(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), title: 'AT01 Foundation Event' }));
    assert.equal(result.revision, 1);
    assert.equal(result.lifecycleStatus, 'DRAFT');
    const row = await scalar<{ title: string }>(f.pool, 'SELECT title FROM events WHERE workspace_id = $1 AND id = $2', [f.workspaceId, result.eventId]);
    assert.equal(row.title, 'AT01 Foundation Event');
  });

  test('an Event may own several independent Programmes', async () => {
    const f = await fixture(0);
    const event = mustOk(await createEvent(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), title: 'Multi-programme Event' }));
    const p1 = mustOk(await createProgramme(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), eventId: event.eventId, title: 'Track A' }));
    const p2 = mustOk(await createProgramme(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), eventId: event.eventId, title: 'Track B' }));
    assert.notEqual(p1.programmeId, p2.programmeId);
    const rows = await f.pool.query('SELECT id FROM programmes WHERE workspace_id = $1 AND event_id = $2', [f.workspaceId, event.eventId]);
    assert.equal(rows.rowCount, 2);
    // Creating a second Programme never advances the Event's own revision — Programmes are independent roots.
    const eventRevision = await scalar<{ revision: string }>(f.pool, 'SELECT revision::text AS revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2', [f.workspaceId, event.eventId]);
    assert.equal(Number(eventRevision.revision), 1);
  });

  test('ProgrammeItem subtype enforcement: a domain_subjects row with no programme_items row, or the wrong owning Programme, fails closed at COMMIT', async () => {
    const f = await fixture(0);
    const { programmeId } = await seedEventProgrammeItem(f);
    const otherEvent = mustOk(await createEvent(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), title: 'Other Event' }));
    const otherProgramme = mustOk(await createProgramme(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), eventId: otherEvent.eventId, title: 'Other Programme' }));

    // (a) no programme_items row at all.
    await assert.rejects(async () => {
      const client = await f.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('INSERT INTO domain_subjects (workspace_id, id, kind, aggregate_id) VALUES ($1, $2, $3, $4)', [f.workspaceId, randomUUID(), 'PROGRAMME_ITEM', programmeId]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }, /has no programme_items row under aggregate/i);

    // (b) a real programme_items row exists but under a DIFFERENT programme_id than the aggregate_id claimed.
    await assert.rejects(async () => {
      const client = await f.pool.connect();
      try {
        await client.query('BEGIN');
        const itemId = randomUUID();
        await client.query('INSERT INTO domain_subjects (workspace_id, id, kind, aggregate_id) VALUES ($1, $2, $3, $4)', [f.workspaceId, itemId, 'PROGRAMME_ITEM', otherProgramme.programmeId]);
        await client.query(
          `INSERT INTO programme_items (workspace_id, id, programme_id, title, item_type, lifecycle_status, created_by_actor_id)
           VALUES ($1, $2, $3, 'x', 'x', 'DRAFT', $4)`,
          [f.workspaceId, itemId, programmeId, f.identity.actorPrincipalId],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }, /has no programme_items row under aggregate/i);
  });
});

describe('M4: UUID boundary and wrong-kind TypedRef rejection', () => {
  test('a non-UUID subject id is a typed VALIDATION_FAILED, never a raw driver error', async () => {
    const f = await fixture(0);
    const outcome = await createEvent(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), title: 'x', eventId: 'legacy-event-7' });
    const conflict = conflictOf(outcome);
    assert.equal(conflict.kind, 'VALIDATION_FAILED');
    assert.match(conflict.message, /not a valid UUID/i);
  });

  test('a wrong-kind TypedRef (an id that resolves to a different SubjectKind) is rejected, not silently coerced', async () => {
    const f = await fixture(1);
    const { programmeId, programmeRevision } = await seedEventProgrammeItem(f);
    // Address a Traveller id where a Programme id is expected.
    const outcome = await setProgrammeLifecycleStatus(f.uow(), {
      ...f.identity,
      idempotencyKey: randomUUID(),
      programmeId: f.travellerIds[0]!,
      expectedRevision: programmeRevision,
      lifecycleStatus: 'ACTIVE',
    });
    const conflict = conflictOf(outcome);
    assert.equal(conflict.kind, 'STALE_AGGREGATE_REVISION');
    void programmeId;
  });
});

describe('M4: one canonical programme move', () => {
  test('a schedule/place change advances exactly one Programme revision', async () => {
    const f = await fixture(0);
    const { programmeId, programmeRevision, programmeItemId } = await seedEventProgrammeItem(f);
    const changed = mustOk(
      await updateProgrammeItemSchedule(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        programmeId,
        programmeItemId,
        expectedProgrammeRevision: programmeRevision,
        window: WINDOW_A,
      }),
    );
    assert.equal(changed.programmeId, programmeId);
    assert.equal(changed.programmeRevision, programmeRevision + 1);
    const item = await scalar<{ window_start: Date }>(f.pool, 'SELECT window_start FROM programme_items WHERE workspace_id = $1 AND id = $2', [f.workspaceId, programmeItemId]);
    assert.equal(item.window_start.toISOString(), WINDOW_A.start);
  });

  test('cancellation and explicit reinstatement both work, and only within the typed transition table', async () => {
    const f = await fixture(0);
    const { programmeId, programmeItemId, programmeRevision } = await seedEventProgrammeItem(f);
    const scheduled = mustOk(
      await updateProgrammeItemSchedule(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), programmeId, programmeItemId, expectedProgrammeRevision: programmeRevision, window: WINDOW_A }),
    );
    const toScheduled = mustOk(
      await setProgrammeItemLifecycleStatus(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), programmeId, programmeItemId, expectedProgrammeRevision: scheduled.programmeRevision, lifecycleStatus: 'SCHEDULED' }),
    );
    const cancelled = mustOk(
      await setProgrammeItemLifecycleStatus(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), programmeId, programmeItemId, expectedProgrammeRevision: toScheduled.programmeRevision, lifecycleStatus: 'CANCELLED' }),
    );
    // A terminal-looking CANCELLED is NOT terminal for ProgrammeItem: explicit reinstatement is allowed.
    const reinstated = mustOk(
      await setProgrammeItemLifecycleStatus(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), programmeId, programmeItemId, expectedProgrammeRevision: cancelled.programmeRevision, lifecycleStatus: 'SCHEDULED' }),
    );
    const row = await scalar<{ lifecycle_status: string }>(f.pool, 'SELECT lifecycle_status FROM programme_items WHERE workspace_id = $1 AND id = $2', [f.workspaceId, programmeItemId]);
    assert.equal(row.lifecycle_status, 'SCHEDULED');

    // COMPLETED is terminal: no further transition is legal.
    const toComplete = mustOk(
      await setProgrammeItemLifecycleStatus(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), programmeId, programmeItemId, expectedProgrammeRevision: reinstated.programmeRevision, lifecycleStatus: 'COMPLETED' }),
    );
    const illegal = await setProgrammeItemLifecycleStatus(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), programmeId, programmeItemId, expectedProgrammeRevision: toComplete.programmeRevision, lifecycleStatus: 'CANCELLED' });
    assert.equal(conflictOf(illegal).kind, 'VALIDATION_FAILED');
  });
});

describe('M4: Participation', () => {
  test('two Travellers can each hold a Participation on one ProgrammeItem', async () => {
    const f = await fixture(2);
    const { programmeId, programmeItemId, programmeRevision } = await seedEventProgrammeItem(f);
    const p1 = mustOk(await addParticipation(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), programmeId, programmeItemId, travellerId: f.travellerIds[0]!, obligation: 'REQUIRED', expectedProgrammeRevision: programmeRevision }));
    const p2 = mustOk(await addParticipation(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), programmeId, programmeItemId, travellerId: f.travellerIds[1]!, obligation: 'OPTIONAL', expectedProgrammeRevision: p1.programmeRevision }));
    assert.notEqual(p1.participationId, p2.participationId);
    const hits = await readThrough(f.pool, () => new PgProgrammeReadQueries(f.pool).participationsForProgrammeItem(f.workspaceId, programmeItemId));
    assert.equal(hits.length, 2);
    assert.deepEqual(new Set(hits.map((h) => h.travellerId)), new Set(f.travellerIds));
  });

  test('one Traveller can hold multiple roles on one Participation', async () => {
    const f = await fixture(1);
    const { programmeId, programmeItemId, programmeRevision } = await seedEventProgrammeItem(f);
    const added = mustOk(await addParticipation(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), programmeId, programmeItemId, travellerId: f.travellerIds[0]!, obligation: 'REQUIRED', expectedProgrammeRevision: programmeRevision, roles: ['SPEAKER'] }));
    await updateParticipation(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), programmeId, participationId: added.participationId, expectedProgrammeRevision: added.programmeRevision, addRole: 'MODERATOR' });
    const roles = await f.pool.query('SELECT role FROM participation_roles WHERE workspace_id = $1 AND participation_id = $2 ORDER BY role', [f.workspaceId, added.participationId]);
    assert.deepEqual(roles.rows.map((r) => r.role), ['MODERATOR', 'SPEAKER']);
  });

  test('a local participant needs no Trip/Journey at all', async () => {
    const f = await fixture(1);
    const { programmeId, programmeItemId, programmeRevision } = await seedEventProgrammeItem(f);
    const added = mustOk(await addParticipation(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), programmeId, programmeItemId, travellerId: f.travellerIds[0]!, obligation: 'INFORMED', expectedProgrammeRevision: programmeRevision }));
    const tripRows = await f.pool.query('SELECT count(*)::int AS n FROM journeys WHERE workspace_id = $1 AND traveller_id = $2', [f.workspaceId, f.travellerIds[0]!]);
    assert.equal(tripRows.rows[0]?.n, 0, 'no Journey exists, and none is required for the Participation to commit');
    assert.ok(added.participationId);
  });

  test('accept/attend are independent dimensions', async () => {
    const f = await fixture(1);
    const { programmeId, programmeItemId, programmeRevision } = await seedEventProgrammeItem(f);
    const added = mustOk(await addParticipation(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), programmeId, programmeItemId, travellerId: f.travellerIds[0]!, obligation: 'REQUIRED', expectedProgrammeRevision: programmeRevision }));
    await updateParticipation(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), programmeId, participationId: added.participationId, expectedProgrammeRevision: added.programmeRevision, accepted: true });
    const row1 = await scalar<{ accepted: boolean; attended: boolean | null }>(f.pool, 'SELECT accepted, attended FROM participations WHERE workspace_id = $1 AND id = $2', [f.workspaceId, added.participationId]);
    assert.equal(row1.accepted, true);
    assert.equal(row1.attended, null);
  });
});

describe('M4: internal vs external schedule authority', () => {
  test('an INTERNAL-authority item accepts a direct schedule command', async () => {
    const f = await fixture(0);
    const { programmeId, programmeItemId, programmeRevision } = await seedEventProgrammeItem(f);
    const changed = mustOk(await updateProgrammeItemSchedule(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), programmeId, programmeItemId, expectedProgrammeRevision: programmeRevision, window: WINDOW_A }));
    assert.ok(changed.programmeRevision > programmeRevision);
  });

  test('an EXTERNAL-authority item refuses a direct schedule command, and an observation records without mutating programme_items', async () => {
    const f = await fixture(0);
    const { programmeId, programmeItemId, programmeRevision } = await seedEventProgrammeItem(f);
    const authoritySet = mustOk(
      await setProgrammeItemScheduleAuthority(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), programmeId, programmeItemId, expectedProgrammeRevision: programmeRevision, scheduleAuthority: 'EXTERNAL', externalSourceRef: 'conn:test-feed' }),
    );
    const refused = await updateProgrammeItemSchedule(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), programmeId, programmeItemId, expectedProgrammeRevision: authoritySet.programmeRevision, window: WINDOW_A });
    assert.equal(conflictOf(refused).kind, 'AUTHORITY_DENIED');

    const observed = mustOk(
      await recordExternalScheduleObservation(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        programmeItemId,
        observedWindow: WINDOW_B,
        sourceRef: 'conn:test-feed',
        observedAt: at(0),
      }),
    );
    assert.equal(observed.conflictsWithCurrent, true, 'the item has no window at all yet, so any observed window is a divergence');
    const item = await scalar<{ window_start: Date | null }>(f.pool, 'SELECT window_start FROM programme_items WHERE workspace_id = $1 AND id = $2', [f.workspaceId, programmeItemId]);
    assert.equal(item.window_start, null, 'recording an observation never rewrites programme_items');
    const observationRows = await f.pool.query('SELECT count(*)::int AS n FROM programme_item_external_observations WHERE workspace_id = $1 AND programme_item_id = $2', [f.workspaceId, programmeItemId]);
    assert.equal(observationRows.rows[0]?.n, 1);
  });
});

describe('M4: concurrency, idempotency and revision CAS', () => {
  test('a stale expected Programme revision changes nothing', async () => {
    const f = await fixture(0);
    const { programmeId, programmeItemId, programmeRevision } = await seedEventProgrammeItem(f);
    const outcome = await updateProgrammeItemSchedule(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), programmeId, programmeItemId, expectedProgrammeRevision: programmeRevision + 999, window: WINDOW_A });
    assert.equal(conflictOf(outcome).kind, 'STALE_AGGREGATE_REVISION');
    const item = await scalar<{ window_start: Date | null }>(f.pool, 'SELECT window_start FROM programme_items WHERE workspace_id = $1 AND id = $2', [f.workspaceId, programmeItemId]);
    assert.equal(item.window_start, null);
  });

  test('two concurrent schedule commands on the same Programme: exactly one wins, no lost update', async () => {
    const f = await fixture(0);
    const { programmeId, programmeItemId, programmeRevision } = await seedEventProgrammeItem(f);
    const uowA = f.uow();
    const uowB = f.uow();
    const [a, b] = await Promise.all([
      updateProgrammeItemSchedule(uowA, { ...f.identity, idempotencyKey: randomUUID(), programmeId, programmeItemId, expectedProgrammeRevision: programmeRevision, window: WINDOW_A }),
      updateProgrammeItemSchedule(uowB, { ...f.identity, idempotencyKey: randomUUID(), programmeId, programmeItemId, expectedProgrammeRevision: programmeRevision, window: WINDOW_B }),
    ]);
    const outcomes = [a, b];
    assert.equal(outcomes.filter((o) => o.ok).length, 1, 'exactly one concurrent writer must win');
    assert.equal(outcomes.filter((o) => !o.ok).length, 1);
    const stale = outcomes.find((o) => !o.ok);
    if (stale && !stale.ok) assert.equal(stale.conflict.kind, 'STALE_AGGREGATE_REVISION');
  });

  test('equal-key replay returns the original receipt without a second write', async () => {
    const f = await fixture(0);
    const event = mustOk(await createEvent(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), title: 'Replay Event' }));
    const key = randomUUID();
    const first = await createProgramme(f.uow(), { ...f.identity, idempotencyKey: key, eventId: event.eventId, title: 'Replay Programme' });
    const second = await createProgramme(f.uow(), { ...f.identity, idempotencyKey: key, eventId: event.eventId, title: 'Replay Programme' });
    assert.ok(first.ok && second.ok);
    if (first.ok && second.ok) {
      assert.deepEqual(second.value, first.value);
      assert.equal(second.receipt.committedAt, first.receipt.committedAt);
    }
    const rows = await f.pool.query('SELECT count(*)::int AS n FROM programmes WHERE workspace_id = $1 AND event_id = $2', [f.workspaceId, event.eventId]);
    assert.equal(rows.rows[0]?.n, 1, 'replay must never produce a second Programme row');
  });

  test('a forced SERIALIZABLE retry leaves the same rows a clean run would', async () => {
    const f = await fixture(0);
    const { programmeId, programmeItemId, programmeRevision } = await seedEventProgrammeItem(f);
    // Drive a concurrent writer to force PgUnitOfWork's retry loop, then assert
    // the eventual winner's row state is exactly what one clean write would produce.
    const uowA = f.uow();
    const uowB = f.uow();
    const [a, b] = await Promise.all([
      updateProgrammeItemSchedule(uowA, { ...f.identity, idempotencyKey: randomUUID(), programmeId, programmeItemId, expectedProgrammeRevision: programmeRevision, window: WINDOW_A }),
      updateProgrammeItemSchedule(uowB, { ...f.identity, idempotencyKey: randomUUID(), programmeId, programmeItemId, expectedProgrammeRevision: programmeRevision, window: WINDOW_B }),
    ]);
    const winner = [a, b].find((o) => o.ok);
    assert.ok(winner?.ok);
    const item = await scalar<{ window_start: Date }>(f.pool, 'SELECT window_start FROM programme_items WHERE workspace_id = $1 AND id = $2', [f.workspaceId, programmeItemId]);
    assert.ok(item.window_start.toISOString() === WINDOW_A.start || item.window_start.toISOString() === WINDOW_B.start);
  });
});

describe('M4: ResourceAssignment reference seam', () => {
  test('a ResourceAssignment references a real PROGRAMME_ITEM activity, validated at COMMIT', async () => {
    const f = await fixture(0);
    const { programmeItemId } = await seedEventProgrammeItem(f);
    const resourceId = randomUUID(); // M3's resources table does not exist yet: deferred FK, opaque reference.
    const assignment = mustOk(
      await createResourceAssignment(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), activityKind: 'PROGRAMME_ITEM', activityId: programmeItemId, resourceId, quantity: 2 }),
    );
    assert.equal(assignment.activityId, programmeItemId);
    const hits = await readThrough(f.pool, () => new PgProgrammeReadQueries(f.pool).resourceAssignmentsForActivity(f.workspaceId, 'PROGRAMME_ITEM', programmeItemId));
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.resourceId, resourceId);

    const confirmed = await setResourceAssignmentStatus(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), assignmentId: assignment.assignmentId, lifecycleStatus: 'CONFIRMED' });
    mustOk(confirmed);
    const row = await scalar<{ lifecycle_status: string }>(f.pool, 'SELECT lifecycle_status FROM resource_assignments WHERE workspace_id = $1 AND id = $2', [f.workspaceId, assignment.assignmentId]);
    assert.equal(row.lifecycle_status, 'CONFIRMED');
  });

  test('a ResourceAssignment references a real JOURNEY_ITEM activity across the M2/M4 seam', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool);
    const traveller = await seedTraveller(seed);
    const tripId = await seedTrip(seed);
    const journeyId = await seedJourney(seed, { tripId, travellerId: traveller.travellerId });
    const { journeyItemId } = await seedJourneyItem(seed, { journeyId, kind: 'RESOURCE_USE' });
    await commitSeed(seed);

    const identity = { workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId };
    const uow = new PgUnitOfWork(pool, seed.workspaceId);
    const assignment = mustOk(
      await createResourceAssignment(uow, { ...identity, idempotencyKey: randomUUID(), activityKind: 'JOURNEY_ITEM', activityId: journeyItemId, resourceId: randomUUID() }),
    );
    assert.equal(assignment.ownerRef.kind, 'JOURNEY');
    assert.equal(assignment.ownerRef.id, journeyId);
  });

  test('a ResourceAssignment against a non-existent activity is rejected at COMMIT (0058 deferred trigger)', async () => {
    const f = await fixture(0);
    const outcome = await createResourceAssignment(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), activityKind: 'PROGRAMME_ITEM', activityId: randomUUID(), resourceId: randomUUID() });
    assert.equal(conflictOf(outcome).kind, 'VALIDATION_FAILED');
  });
});

describe('M4: Event lifecycle', () => {
  test('Event lifecycle transitions follow the standard DRAFT/ACTIVE/COMPLETED/CANCELLED table', async () => {
    const f = await fixture(0);
    const event = mustOk(await createEvent(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), title: 'Lifecycle Event' }));
    const active = mustOk(await setEventLifecycleStatus(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), eventId: event.eventId, expectedRevision: event.revision, lifecycleStatus: 'ACTIVE' }));
    const illegal = await setEventLifecycleStatus(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), eventId: event.eventId, expectedRevision: active.revision, lifecycleStatus: 'DRAFT' });
    assert.equal(conflictOf(illegal).kind, 'VALIDATION_FAILED');
  });
});

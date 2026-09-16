/**
 * M2 lane T — Trip / Journey / JourneyItem / IntendedVisit / credential
 * selection, run against real PostgreSQL (never a mock).
 *
 * The evidence this file exists to produce, one case per architecture rule:
 *  1. one Journey per (Trip, Traveller) is the database's UNIQUE key, and there
 *     is no main/sub/primary traveller column to fall back on;
 *  2. an ACTIVE Trip without participation fails as a typed conflict, not as a
 *     driver stack, and terminal lifecycle states stay terminal;
 *  3. every JourneyItem kind writes exactly one kind-matching typed detail row,
 *     a STAY detail on a TRANSPORT item is a key violation, and an item with no
 *     detail cannot commit;
 *  4. a stale `expectedRevision` changes nothing, and a JourneyItem is a *child*
 *     subject: it has no revision counter of its own;
 *  5. `journeysForTravellerInWindow` / `journeysForTrip` honour half-open window
 *     overlap and cancelled-participant semantics;
 *  6. `intendedVisitsInJurisdictionWindow` and `itemsReferencingPlace` answer the
 *     reverse lookups through opaque UUID references with the exact place role;
 *  7. a credential selection pins its own Traveller's edition, is scoped to its
 *     own Journey's visits, is provenanced by its own command receipt, and
 *     refuses another Traveller's document (F06);
 *  8. replay returns the original receipt without a second write; a changed
 *     payload under the same key conflicts;
 *  9. revision CAS spans two aggregates, and a rejected command leaves no head,
 *     subject, receipt, outbox or typed row behind;
 * 10. one command advances one root, so the audit/outbox fan-out is exactly one
 *     pair of rows however many children it writes;
 * 11. each read statement can use the index its port names, verified by
 *     EXPLAINing the statements the implementation actually emits.
 *
 * Every case opens a fresh workspace through `m2Seed.ts` and only ever deletes
 * rows it inserted, because the PostgreSQL test database is shared with the
 * sibling M2 lanes.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  beginSeed,
  commitSeed,
  opaqueRef,
  seedCredential,
  seedTraveller,
  seedTrip,
  type SeedSession,
  attachSeedSession,
} from './m2Seed.ts';
import {
  seedEvent,
  seedJurisdiction,
  seedPlace,
  seedProgramme,
  seedProgrammeItem,
  seedParticipation,
} from './m4Seed.ts';
import { sharedTestPool } from './harness.ts';
import type { Pool, PoolClient } from '../src/persistence/postgres/pool.ts';
import { PgUnitOfWork, type ExecuteOutcome } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { runWithTransactionClient } from '../src/persistence/postgres/transactionContext.ts';
import { typedConflict, type TypedConflict } from '../src/domain/v2/shared/errors.ts';
import type { JourneyItem } from '../src/domain/v2/trip/trip.ts';
import { DomainCommandEnvelopeSchema } from '../src/contracts/v2/command/domainCommand.ts';
import { PgTripRepository } from '../src/persistence/postgres/repositories/pgTripRepository.ts';
import { PgJourneyRepository } from '../src/persistence/postgres/repositories/pgJourneyRepository.ts';
import { PgJourneyReadQueries } from '../src/persistence/postgres/queries/pgJourneyReadQueries.ts';
import {
  addIntendedVisit,
  addJourneyItem,
  createJourney,
  createTrip,
  removeCredentialSelection,
  selectCredential,
  setJourneyLifecycleStatus,
  setTripLifecycleStatus,
  updateJourneyDetails,
  updateJourneyItem,
  updateTripDetails,
  type JourneyItemSeed,
} from '../src/persistence/postgres/commands/travelCommands.ts';

// --- generic fixtures --------------------------------------------------------

/**
 * No scenario, place name, airline or demo label appears anywhere: instants are
 * offsets from one fixed epoch and every identifier is random.
 */
const T0 = Date.UTC(2030, 0, 1);
const at = (minutes: number): string => new Date(T0 + minutes * 60_000).toISOString();
const WINDOW_EARLY = { start: at(0), end: at(240) };
const WINDOW_INSIDE = { start: at(60), end: at(120) };
/** Touches `WINDOW_EARLY.end` exactly: half-open semantics must exclude it. */
const WINDOW_ADJACENT = { start: at(240), end: at(300) };
const WINDOW_LATE = { start: at(600), end: at(900) };

const PURPOSE_TEXT = 'M2 travel lane command purpose';
const REVISED_PURPOSE = 'M2 travel lane revised command purpose';
const VISIT_PURPOSE = 'M2 travel lane visit purpose';

/** Seeded roots per fresh workspace, used where a total is asserted. */
const SEEDED_HEADS = 7; // 3 travellers + 4 trips

interface SeededCredential {
  travellerId: string;
  credentialId: string;
  versionId: string;
}

interface Fixture {
  pool: Pool;
  workspaceId: string;
  /** Spread into every handler call as the command identity's fixed half. */
  identity: { workspaceId: string; actorPrincipalId: string };
  travellerIds: string[];
  tripIds: string[];
  credentials: SeededCredential[];
  uow: () => PgUnitOfWork;
}

async function fixture(): Promise<Fixture> {
  const pool = await sharedTestPool();
  const seed = await beginSeed(pool);
  const travellers = [await seedTraveller(seed), await seedTraveller(seed), await seedTraveller(seed)];
  const credentials: SeededCredential[] = [];
  for (const traveller of travellers) {
    const credential = await seedCredential(seed, { travellerId: traveller.travellerId });
    credentials.push({
      travellerId: traveller.travellerId,
      credentialId: credential.credentialId,
      versionId: credential.versionId,
    });
  }
  const tripIds = [await seedTrip(seed), await seedTrip(seed), await seedTrip(seed), await seedTrip(seed)];
  await commitSeed(seed);
  return {
    pool,
    workspaceId: seed.workspaceId,
    identity: { workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId },
    travellerIds: travellers.map((traveller) => traveller.travellerId),
    tripIds,
    credentials,
    uow: () => new PgUnitOfWork(pool, seed.workspaceId),
  };
}

/**
 * Continues seeding into the workspace `fixture()` already committed, for
 * tests that need one more M4-owned row (a Place, Jurisdiction or
 * Participation) after the fixture's own `beginSeed` session has closed.
 * `beginSeed` always mints a *new* workspace, so it cannot be called again
 * just to add rows to this one — this instead opens a plain transaction
 * against the existing workspace row and reuses `commitSeed` to close it,
 * exactly as `m2People.pgtest.ts`'s workspace-per-fixture pattern requires.
 */
async function attachSeed(f: Fixture): Promise<SeedSession> {
  return attachSeedSession(f.pool, f.workspaceId, f.identity.actorPrincipalId);
}

function mustOk<T>(outcome: ExecuteOutcome<T>): T {
  if (!outcome.ok) {
    assert.fail(`expected the command to commit, got ${outcome.conflict.kind}: ${outcome.conflict.message}`);
  }
  return outcome.value;
}

function conflictOf(outcome: ExecuteOutcome<unknown>): TypedConflict {
  if (outcome.ok) assert.fail('expected a typed conflict, but the command committed');
  return outcome.conflict;
}

/**
 * Like `mustOk`, but keeps the committed outcome: for assertions about the
 * receipt (which only exists on the ok branch) rather than about the value.
 */
function mustCommit<T>(outcome: ExecuteOutcome<T>): Extract<ExecuteOutcome<T>, { ok: true }> {
  if (!outcome.ok) {
    assert.fail(`expected the command to commit, got ${outcome.conflict.kind}: ${outcome.conflict.message}`);
  }
  return outcome;
}

async function scalar<T extends Record<string, unknown>>(
  pool: Pool,
  sql: string,
  values: unknown[] = [],
): Promise<T> {
  const result = await pool.query<T>(sql, values);
  const row = result.rows[0];
  if (!row) throw new Error(`probe returned no row: ${sql}`);
  return row;
}

async function countRows(pool: Pool, sql: string, values: unknown[] = []): Promise<number> {
  const row = await scalar<{ n: string | number }>(pool, sql, values);
  return Number(row.n);
}

/**
 * Runs a repository read on a checked-out client inside a transaction that is
 * rolled back: the repositories take `currentTransactionClient()`, so this is
 * also the proof that they are typed-row-only and write nothing themselves.
 */
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

/**
 * Drives raw statements behind the handler's back and asserts the transaction is
 * rejected — including when the rejection only happens at COMMIT, which is where
 * every `DEFERRABLE INITIALLY DEFERRED` assertion of 0021-0025 speaks.
 */
async function expectRejected(
  f: Fixture,
  body: (client: PoolClient) => Promise<void>,
  cause: RegExp,
): Promise<void> {
  const client = await f.pool.connect();
  let failure: unknown;
  try {
    await client.query('BEGIN');
    await body(client);
    await client.query('COMMIT');
  } catch (error) {
    failure = error;
    await client.query('ROLLBACK').catch(() => undefined);
  } finally {
    client.release();
  }
  assert.ok(failure, 'the transaction was expected to be rejected, but it committed');
  const described = `${(failure as Error).message} [code=${(failure as { code?: string }).code}]`;
  assert.match(described, cause);
}

async function headRevisionOf(f: Fixture, aggregateId: string): Promise<number | undefined> {
  const result = await f.pool.query<{ revision: string }>(
    'SELECT revision::text AS revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2',
    [f.workspaceId, aggregateId],
  );
  const row = result.rows[0];
  return row ? Number(row.revision) : undefined;
}

async function scopeGenerationOf(f: Fixture, scopeId: string): Promise<string> {
  const row = await scalar<{ generation: string }>(
    f.pool,
    'SELECT generation::text AS generation FROM scope_generations WHERE workspace_id = $1 AND scope_kind = $2 AND scope_id = $3',
    [f.workspaceId, 'TRIP', scopeId],
  );
  return row.generation;
}

function transportItem(originPlaceId: string, destinationPlaceId: string, id: string): JourneyItemSeed {
  return {
    id,
    kind: 'TRANSPORT',
    lifecycleStatus: 'PLANNED',
    desiredOriginPlaceId: originPlaceId,
    desiredDestinationPlaceId: destinationPlaceId,
  };
}

function stayItem(intendedPlaceId: string, id: string): JourneyItemSeed {
  return { id, kind: 'STAY', lifecycleStatus: 'PLANNED', intendedPlaceId, requiredNights: 2 };
}

function engagementItem(participationId: string, id: string): JourneyItemSeed {
  return { id, kind: 'ENGAGEMENT', lifecycleStatus: 'PLANNED', participationId };
}

/**
 * The standalone-appointment branch of 0023's source XOR, for the (common)
 * case where a test only needs *a* valid ENGAGEMENT detail row and never
 * asserts anything about a Participation identity — so it need not seed the
 * Event/Programme/ProgrammeItem/Participation chain that a real
 * `participationId` now requires under 0061/0062's live FK and trigger.
 */
function standaloneEngagementItem(id: string, window: { start: string; end: string } = WINDOW_INSIDE): JourneyItemSeed {
  return {
    id,
    kind: 'ENGAGEMENT',
    lifecycleStatus: 'PLANNED',
    standaloneTitle: 'Standalone engagement',
    standaloneWindow: window,
  };
}

function resourceUseItem(locationPlaceId: string, id: string): JourneyItemSeed {
  return { id, kind: 'RESOURCE_USE', lifecycleStatus: 'PLANNED', intendedLocationPlaceId: locationPlaceId };
}

/** Which of 0023's four detail tables hold a row for one item. */
async function detailTablesForItem(f: Fixture, journeyItemId: string): Promise<string[]> {
  const row = await scalar<Record<string, string>>(
    f.pool,
    `SELECT
       (SELECT COUNT(*) FROM transport_item_details WHERE workspace_id = $1 AND journey_item_id = $2) AS transport_item_details,
       (SELECT COUNT(*) FROM stay_item_details WHERE workspace_id = $1 AND journey_item_id = $2) AS stay_item_details,
       (SELECT COUNT(*) FROM engagement_item_details WHERE workspace_id = $1 AND journey_item_id = $2) AS engagement_item_details,
       (SELECT COUNT(*) FROM resource_use_item_details WHERE workspace_id = $1 AND journey_item_id = $2) AS resource_use_item_details`,
    [f.workspaceId, journeyItemId],
  );
  return Object.entries(row)
    .filter(([, count]) => Number(count) > 0)
    .map(([table]) => table);
}

function itemOfKind<K extends JourneyItem['kind']>(
  items: JourneyItem[],
  kind: K,
): Extract<JourneyItem, { kind: K }> {
  const matches = items.filter((item): item is Extract<JourneyItem, { kind: K }> => item.kind === kind);
  assert.equal(matches.length, 1, `expected exactly one ${kind} item`);
  const item = matches[0];
  if (!item) assert.fail(`no ${kind} item of the expected kind`);
  return item;
}

// --- 1. one Journey per (Trip, Traveller) ------------------------------------

describe('M2 lane T: Journey participation (F03/F04)', () => {
  test('a second Journey for the same Traveller and Trip is a duplicate registration, not a shadow itinerary', async () => {
    const f = await fixture();
    const traveller = f.travellerIds[0];
    const companion = f.travellerIds[1];
    const tripId = f.tripIds[0];
    assert.ok(traveller && companion && tripId);

    const first = mustOk(
      await createJourney(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), tripId, travellerId: traveller }),
    );
    const rejected = conflictOf(
      await createJourney(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), tripId, travellerId: traveller }),
    );
    assert.equal(rejected.kind, 'DUPLICATE_REGISTRATION');
    assert.match(
      rejected.message,
      /journeys_per_traveller_per_trip_uidx/,
      'the refusal must come from the schema key, not from a handler convention',
    );
    assert.equal(
      await countRows(f.pool, 'SELECT COUNT(*) AS n FROM aggregate_heads WHERE workspace_id = $1', [f.workspaceId]),
      SEEDED_HEADS + 1,
      'the rejected command had already created a head; its rollback must have removed it',
    );

    // A different Traveller in the same Trip is a distinct, legal participation.
    const second = mustOk(
      await createJourney(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), tripId, travellerId: companion }),
    );
    assert.notEqual(second.journeyId, first.journeyId);
    const journeys = await readThrough(f.pool, () => new PgJourneyRepository().listForTrip(f.workspaceId, tripId));
    assert.deepEqual(
      journeys.map((journey) => journey.travellerId).sort(),
      [traveller, companion].sort(),
    );
    assert.equal(
      await countRows(
        f.pool,
        'SELECT COUNT(DISTINCT traveller_id) AS n FROM journeys WHERE workspace_id = $1 AND trip_id = $2',
        [f.workspaceId, tripId],
      ),
      await countRows(f.pool, 'SELECT COUNT(*) AS n FROM journeys WHERE workspace_id = $1 AND trip_id = $2', [
        f.workspaceId,
        tripId,
      ]),
      'there is no such thing as two itineraries for one person in one undertaking',
    );

    // The model has no main/sub/primary traveller notion to assert against, so
    // query for its absence rather than trusting a comment.
    const columns = await f.pool.query<{ column_name: string }>(
      'SELECT column_name FROM information_schema.columns WHERE table_name = $1',
      ['journeys'],
    );
    assert.deepEqual(
      columns.rows.filter((column) => /main|primary|sub|lead|junior/i.test(column.column_name)),
      [],
    );
  });
});

// --- 2. Trip lifecycle guard -------------------------------------------------

describe('M2 lane T: Trip lifecycle (F03)', () => {
  test('activation without participation fails as a typed conflict and terminal states stay terminal', async () => {
    const f = await fixture();
    const tripId = f.tripIds[0];
    assert.ok(tripId);
    const loadTrip = () => readThrough(f.pool, () => new PgTripRepository().load(f.workspaceId, tripId));

    const empty = conflictOf(
      await setTripLifecycleStatus(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        tripId,
        expectedRevision: 1,
        lifecycleStatus: 'ACTIVE',
      }),
    );
    assert.equal(empty.kind, 'VALIDATION_FAILED');
    assert.match(empty.message, /F03/);
    assert.doesNotMatch(empty.message, /\n\s+at\s/, 'a guard must not surface a driver stack');
    assert.equal((await loadTrip())?.lifecycleStatus, 'DRAFT');
    assert.equal((await loadTrip())?.revision, 1);

    // Creating a Trip already ACTIVE is refused for the same reason, and before
    // any row is written.
    const bornActive = conflictOf(
      await createTrip(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        purpose: PURPOSE_TEXT,
        lifecycleStatus: 'ACTIVE',
      }),
    );
    assert.equal(bornActive.kind, 'VALIDATION_FAILED');
    assert.equal(
      await countRows(
        f.pool,
        'SELECT COUNT(*) AS n FROM trips WHERE workspace_id = $1 AND lifecycle_status = $2',
        [f.workspaceId, 'ACTIVE'],
      ),
      0,
    );

    const journey = mustOk(
      await createJourney(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        tripId,
        travellerId: f.travellerIds[0] ?? '',
      }),
    );
    const activated = mustOk(
      await setTripLifecycleStatus(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        tripId,
        expectedRevision: 1,
        lifecycleStatus: 'ACTIVE',
      }),
    );
    assert.equal(activated.revision, 2);
    assert.equal((await loadTrip())?.lifecycleStatus, 'ACTIVE');

    // Cancelling the last non-cancelled participant of an ACTIVE Trip is exactly
    // what 0021 refuses to commit; the handler must say so before COMMIT does.
    const lastOut = conflictOf(
      await setJourneyLifecycleStatus(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        journeyId: journey.journeyId,
        expectedRevision: 1,
        lifecycleStatus: 'CANCELLED',
      }),
    );
    assert.equal(lastOut.kind, 'VALIDATION_FAILED');
    assert.match(lastOut.message, /last non-cancelled participant/);
    assert.equal(
      (await readThrough(f.pool, () => new PgJourneyRepository().load(f.workspaceId, journey.journeyId)))
        ?.lifecycleStatus,
      'DRAFT',
    );
    assert.equal(await headRevisionOf(f, journey.journeyId), 1);

    // With a second participant, cancelling one is legal — and never deletes it.
    const companion = mustOk(
      await createJourney(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        tripId,
        travellerId: f.travellerIds[1] ?? '',
      }),
    );
    mustOk(
      await setJourneyLifecycleStatus(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        journeyId: journey.journeyId,
        expectedRevision: 1,
        lifecycleStatus: 'CANCELLED',
      }),
    );
    assert.equal(
      await countRows(f.pool, 'SELECT COUNT(*) AS n FROM journeys WHERE workspace_id = $1 AND id = $2', [
        f.workspaceId,
        journey.journeyId,
      ]),
      1,
      'cancelling is a state change; a Journey is never deleted to shed history',
    );

    const completed = mustOk(
      await setTripLifecycleStatus(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        tripId,
        expectedRevision: 2,
        lifecycleStatus: 'COMPLETED',
      }),
    );
    assert.equal(completed.revision, 3);
    const reopened = conflictOf(
      await setTripLifecycleStatus(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        tripId,
        expectedRevision: 3,
        lifecycleStatus: 'ACTIVE',
      }),
    );
    assert.equal(reopened.kind, 'VALIDATION_FAILED');
    assert.match(reopened.message, /COMPLETED is terminal/);
    const cancelledReopened = conflictOf(
      await setJourneyLifecycleStatus(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        journeyId: journey.journeyId,
        expectedRevision: 2,
        lifecycleStatus: 'ACTIVE',
      }),
    );
    assert.equal(cancelledReopened.kind, 'VALIDATION_FAILED');
    assert.match(cancelledReopened.message, /CANCELLED is terminal/);
    assert.equal(await headRevisionOf(f, companion.journeyId), 1);
    assert.equal(
      await countRows(f.pool, 'SELECT COUNT(*) AS n FROM command_receipts WHERE workspace_id = $1', [f.workspaceId]),
      5,
      'only the five committed commands may have receipts',
    );
  });
});

// --- 3. Typed item detail ----------------------------------------------------

describe('M2 lane T: JourneyItem typed detail (0023)', () => {
  test('each kind writes exactly one matching detail row and the discriminator is enforced by the schema', async () => {
    const f = await fixture();
    const tripId = f.tripIds[0] ?? '';
    const otherTripJourney = mustOk(
      await createJourney(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        tripId: f.tripIds[1] ?? '',
        travellerId: f.travellerIds[1] ?? '',
      }),
    );
    const journey = mustOk(
      await createJourney(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        tripId,
        travellerId: f.travellerIds[0] ?? '',
      }),
    );
    // Real M4 rows: 0061 gives desired_origin/destination_place_id,
    // intended_place_id, participation_id and intended_location_place_id live
    // FKs, and this test asserts the exact values round-trip (below), so this
    // is the one place in this file that must build the full
    // Event/Programme/ProgrammeItem/Participation chain rather than switching
    // the ENGAGEMENT item to a standalone appointment.
    const seed = await attachSeed(f);
    const origin = await seedPlace(seed, { name: 'Typed detail origin' });
    const destination = await seedPlace(seed, { name: 'Typed detail destination' });
    const stayPlace = await seedPlace(seed, { name: 'Typed detail stay' });
    const resourcePlace = await seedPlace(seed, { name: 'Typed detail resource' });
    const detailEventId = await seedEvent(seed);
    const detailProgrammeId = await seedProgramme(seed, { eventId: detailEventId });
    const { programmeItemId: detailProgrammeItemId } = await seedProgrammeItem(seed, {
      programmeId: detailProgrammeId,
    });
    // 0062 requires the Participation's traveller to match this item's own
    // Journey's traveller, so it must be the same person `journey` belongs to.
    const participation = await seedParticipation(seed, {
      programmeItemId: detailProgrammeItemId,
      travellerId: f.travellerIds[0] ?? '',
    });
    await commitSeed(seed);
    const transportItemId = randomUUID();
    const stayItemId = randomUUID();
    const engagementItemId = randomUUID();
    const resourceItemId = randomUUID();
    const seeds: { seed: JourneyItemSeed; table: string }[] = [
      { seed: transportItem(origin, destination, transportItemId), table: 'transport_item_details' },
      { seed: stayItem(stayPlace, stayItemId), table: 'stay_item_details' },
      { seed: engagementItem(participation, engagementItemId), table: 'engagement_item_details' },
      { seed: resourceUseItem(resourcePlace, resourceItemId), table: 'resource_use_item_details' },
    ];

    let revision = journey.revision;
    for (const entry of seeds) {
      const added = mustOk(
        await addJourneyItem(f.uow(), {
          ...f.identity,
          idempotencyKey: randomUUID(),
          journeyId: journey.journeyId,
          expectedRevision: revision,
          item: entry.seed,
        }),
      );
      revision = added.journeyRevision;
      assert.deepEqual(
        await detailTablesForItem(f, added.journeyItemId),
        [entry.table],
        'exactly one detail row, in the table its kind selects',
      );
    }
    // Four item writes, one revision counter: the Journey's.
    assert.equal(revision, journey.revision + seeds.length);

    const items = await readThrough(f.pool, () => new PgJourneyRepository().listItems(f.workspaceId, journey.journeyId));
    assert.equal(items.length, 4);
    assert.deepEqual(itemOfKind(items, 'TRANSPORT').desiredOriginPlaceId, origin);
    assert.equal(itemOfKind(items, 'TRANSPORT').desiredDestinationPlaceId, destination);
    assert.equal(itemOfKind(items, 'STAY').intendedPlaceId, stayPlace);
    assert.equal(itemOfKind(items, 'STAY').requiredNights, 2);
    assert.equal(itemOfKind(items, 'ENGAGEMENT').participationId, participation);
    assert.equal(itemOfKind(items, 'RESOURCE_USE').intendedLocationPlaceId, resourcePlace);
    assert.equal(
      await countRows(
        f.pool,
        'SELECT COUNT(*) AS n FROM engagement_item_details WHERE workspace_id = $1 AND participation_id = $2',
        [f.workspaceId, participation],
      ),
      1,
      'the opaque M4/M6 reference round-trips unchanged',
    );

    // Right shape, wrong kind: the discriminating composite FK is what refuses it.
    await expectRejected(
      f,
      async (client) => {
        await client.query(
          `INSERT INTO stay_item_details
             (workspace_id, journey_item_id, kind, intended_place_id, required_nights)
           VALUES ($1, $2, 'STAY', $3, 1)`,
          [f.workspaceId, transportItemId, opaqueRef()],
        );
      },
      /stay_item_details_item_fk|foreign key violation/i,
    );
    assert.deepEqual(await detailTablesForItem(f, transportItemId), ['transport_item_details']);

    // No detail at all: no ordinary constraint can express this, so it is a
    // deferred assertion — the failure lands at COMMIT.
    const bareItemId = randomUUID();
    await expectRejected(
      f,
      async (client) => {
        await client.query(
          'INSERT INTO domain_subjects (workspace_id, id, kind, aggregate_id) VALUES ($1, $2, $3, $4)',
          [f.workspaceId, bareItemId, 'JOURNEY_ITEM', journey.journeyId],
        );
        await client.query(
          `INSERT INTO journey_items
             (workspace_id, id, journey_id, kind, order_key, lifecycle_status, created_by_actor_id)
           VALUES ($1, $2, $3, 'STAY', $4, 'PLANNED', $5)`,
          [f.workspaceId, bareItemId, journey.journeyId, bareItemId, f.identity.actorPrincipalId],
        );
      },
      /has no typed detail row/,
    );
    assert.equal(
      await countRows(f.pool, 'SELECT COUNT(*) AS n FROM journey_items WHERE workspace_id = $1 AND id = $2', [
        f.workspaceId,
        bareItemId,
      ]),
      0,
    );

    // An item update rewrites only its parent row; the detail is untouched.
    const updated = mustOk(
      await updateJourneyItem(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        journeyId: journey.journeyId,
        journeyItemId: transportItemId,
        expectedRevision: revision,
        lifecycleStatus: 'ACTIVE',
        flexible: true,
        intendedWindow: WINDOW_INSIDE,
      }),
    );
    assert.equal(updated.journeyRevision, revision + 1);
    assert.deepEqual(await detailTablesForItem(f, transportItemId), ['transport_item_details']);
    const reread = await readThrough(f.pool, () => new PgJourneyRepository().loadItem(f.workspaceId, transportItemId));
    assert.ok(reread?.kind === 'TRANSPORT');
    assert.equal(reread.lifecycleStatus, 'ACTIVE');
    assert.equal(reread.flexible, true);
    assert.deepEqual(reread.intendedWindow, WINDOW_INSIDE);

    assert.equal(
      conflictOf(
        await updateJourneyItem(f.uow(), {
          ...f.identity,
          idempotencyKey: randomUUID(),
          journeyId: journey.journeyId,
          journeyItemId: transportItemId,
          expectedRevision: revision + 1,
          lifecycleStatus: 'PLANNED',
        }),
      ).kind,
      'VALIDATION_FAILED',
      'an active leg of an itinerary is not a suggestion to revisit it',
    );
    // An item cannot be addressed through a Journey that does not own it.
    assert.match(
      conflictOf(
        await updateJourneyItem(f.uow(), {
          ...f.identity,
          idempotencyKey: randomUUID(),
          journeyId: otherTripJourney.journeyId,
          journeyItemId: transportItemId,
          expectedRevision: 1,
          flexible: false,
        }),
      ).message,
      /belongs to journey/,
    );
  });
});

// --- 4. Child aggregate ownership + revision CAS -----------------------------

describe('M2 lane T: revision CAS and child-subject ownership', () => {
  test('a stale expectedRevision changes nothing and an item never owns a head of its own', async () => {
    const f = await fixture();
    const journey = mustOk(
      await createJourney(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        tripId: f.tripIds[0] ?? '',
        travellerId: f.travellerIds[0] ?? '',
      }),
    );
    // This item write commits, so its place must be real (0061 FK).
    const caseSeed = await attachSeed(f);
    const stayPlaceId = await seedPlace(caseSeed, { name: 'Revision CAS stay place' });
    await commitSeed(caseSeed);
    const accepted = mustOk(
      await addJourneyItem(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        journeyId: journey.journeyId,
        expectedRevision: 1,
        item: stayItem(stayPlaceId, randomUUID()),
      }),
    );
    assert.equal(accepted.journeyRevision, 2);

    const staleItemId = randomUUID();
    const stale = conflictOf(
      await addJourneyItem(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        journeyId: journey.journeyId,
        // The head is at 2; this command read it at 1.
        expectedRevision: 1,
        item: stayItem(opaqueRef(), staleItemId),
      }),
    );
    assert.equal(stale.kind, 'STALE_AGGREGATE_REVISION');
    assert.equal(
      await countRows(f.pool, 'SELECT COUNT(*) AS n FROM journey_items WHERE workspace_id = $1', [f.workspaceId]),
      1,
      'the rejected item must not exist',
    );
    assert.equal(await headRevisionOf(f, journey.journeyId), 2, 'a rejected command must not move the counter');
    assert.equal(
      await countRows(f.pool, 'SELECT COUNT(*) AS n FROM domain_subjects WHERE workspace_id = $1 AND id = $2', [
        f.workspaceId,
        staleItemId,
      ]),
      0,
    );

    // Ownership: the item is a registry subject that aggregates under its
    // Journey, with no revision counter of its own.
    const ownership = await scalar<{ aggregate_id: string; kind: string }>(
      f.pool,
      'SELECT aggregate_id, kind FROM domain_subjects WHERE workspace_id = $1 AND id = $2',
      [f.workspaceId, accepted.journeyItemId],
    );
    assert.equal(ownership.kind, 'JOURNEY_ITEM');
    assert.equal(ownership.aggregate_id, journey.journeyId);
    assert.equal(await headRevisionOf(f, accepted.journeyItemId), undefined);
    assert.equal(
      await countRows(
        f.pool,
        'SELECT COUNT(*) AS n FROM domain_subjects WHERE workspace_id = $1 AND aggregate_id = $2 AND kind = $3',
        [f.workspaceId, journey.journeyId, 'JOURNEY_ITEM'],
      ),
      1,
    );
    assert.equal(
      (await readThrough(f.pool, () => new PgJourneyRepository().load(f.workspaceId, journey.journeyId)))?.revision,
      2,
      'the repository reports the one counter that moved',
    );

    // A missing head is reported with the same vocabulary as a stale one.
    assert.equal(
      conflictOf(
        await addJourneyItem(f.uow(), {
          ...f.identity,
          idempotencyKey: randomUUID(),
          journeyId: randomUUID(),
          expectedRevision: 1,
          item: stayItem(opaqueRef(), randomUUID()),
        }),
      ).kind,
      'STALE_AGGREGATE_REVISION',
    );
    assert.equal(
      await countRows(f.pool, 'SELECT COUNT(*) AS n FROM journey_items WHERE workspace_id = $1', [f.workspaceId]),
      1,
    );
  });
});

// --- 5. Window reads ---------------------------------------------------------

describe('M2 lane T: journey window reads', () => {
  test('window overlap is half-open, cancelled participants are opt-in, and a Trip read spans every participant', async () => {
    const f = await fixture();
    const traveller = f.travellerIds[0] ?? '';
    const queries = new PgJourneyReadQueries(f.pool);
    const inside = mustOk(
      await createJourney(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        tripId: f.tripIds[0] ?? '',
        travellerId: traveller,
        intendedWindow: WINDOW_INSIDE,
      }),
    );
    const adjacent = mustOk(
      await createJourney(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        tripId: f.tripIds[1] ?? '',
        travellerId: traveller,
        intendedWindow: WINDOW_ADJACENT,
      }),
    );
    const cancelled = mustOk(
      await createJourney(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        tripId: f.tripIds[2] ?? '',
        travellerId: traveller,
        intendedWindow: WINDOW_EARLY,
      }),
    );
    mustOk(
      await setJourneyLifecycleStatus(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        journeyId: cancelled.journeyId,
        expectedRevision: 1,
        lifecycleStatus: 'CANCELLED',
      }),
    );
    // A Journey that claims no window at all cannot be placed in time.
    const headless = mustOk(
      await createJourney(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        tripId: f.tripIds[3] ?? '',
        travellerId: traveller,
      }),
    );
    assert.ok(headless);

    const overlapping = await queries.journeysForTravellerInWindow(f.workspaceId, traveller, WINDOW_EARLY);
    assert.deepEqual(
      overlapping.map((hit) => hit.journeyId),
      [inside.journeyId],
      'the cancelled and windowless Journeys are excluded, and so is the one that only touches the end bound',
    );
    assert.deepEqual(overlapping[0]?.intendedWindow, WINDOW_INSIDE);

    assert.deepEqual(
      (await queries.journeysForTravellerInWindow(f.workspaceId, traveller, WINDOW_ADJACENT)).map((hit) => hit.journeyId),
      [adjacent.journeyId],
    );
    assert.deepEqual(await queries.journeysForTravellerInWindow(f.workspaceId, traveller, WINDOW_LATE), []);

    const includingCancelled = await queries.journeysForTravellerInWindow(f.workspaceId, traveller, WINDOW_EARLY, {
      includeCancelled: true,
    });
    assert.deepEqual(
      includingCancelled.map((hit) => hit.journeyId).sort(),
      [inside.journeyId, cancelled.journeyId].sort(),
    );
    assert.equal(
      includingCancelled.find((hit) => hit.journeyId === cancelled.journeyId)?.lifecycleStatus,
      'CANCELLED',
    );

    // Another Traveller's Journeys in the same window are not this one's.
    const foreignTraveller = f.travellerIds[1] ?? '';
    const foreign = mustOk(
      await createJourney(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        tripId: f.tripIds[0] ?? '',
        travellerId: foreignTraveller,
        intendedWindow: WINDOW_INSIDE,
      }),
    );
    assert.equal((await queries.journeysForTravellerInWindow(f.workspaceId, traveller, WINDOW_EARLY)).length, 1);
    assert.deepEqual(
      (await queries.journeysForTravellerInWindow(f.workspaceId, foreignTraveller, WINDOW_EARLY)).map(
        (hit) => hit.journeyId,
      ),
      [foreign.journeyId],
    );

    const tripId = f.tripIds[0] ?? '';
    const tripRead = await queries.journeysForTrip(f.workspaceId, tripId);
    assert.deepEqual(tripRead.map((hit) => hit.travellerId).sort(), [traveller, foreignTraveller].sort());
    assert.ok(tripRead.every((hit) => hit.tripId === tripId));
    assert.equal(tripRead.find((hit) => hit.journeyId === foreign.journeyId)?.intendedWindow?.end, WINDOW_INSIDE.end);

    // journeysForTrip has no status option in the frozen port: it reports every
    // participant, which is what a Trip-level read must mean.
    const dropped = mustOk(
      await createJourney(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        tripId,
        travellerId: f.travellerIds[2] ?? '',
      }),
    );
    mustOk(
      await setJourneyLifecycleStatus(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        journeyId: dropped.journeyId,
        expectedRevision: 1,
        lifecycleStatus: 'CANCELLED',
      }),
    );
    assert.equal((await queries.journeysForTrip(f.workspaceId, tripId)).length, 3);
    assert.deepEqual(await queries.journeysForTrip(f.workspaceId, randomUUID()), []);
  });
});

// --- 6. Reverse lookups -----------------------------------------------------

describe('M2 lane T: jurisdiction and place reverse lookups', () => {
  test('intended visits and place references are found through opaque UUIDs with their exact role', async () => {
    const f = await fixture();
    const queries = new PgJourneyReadQueries(f.pool);
    // Both jurisdictions and the shared place are committed and read back by
    // exact value below, so all three must be real M4 rows (0061 FK).
    const lookupSeed = await attachSeed(f);
    const jurisdiction = await seedJurisdiction(lookupSeed, { name: 'Reverse lookup target jurisdiction' });
    const elsewhere = await seedJurisdiction(lookupSeed, { name: 'Reverse lookup elsewhere jurisdiction' });
    const sharedPlace = await seedPlace(lookupSeed, { name: 'Reverse lookup shared place' });
    const destinationForA = await seedPlace(lookupSeed, { name: 'Reverse lookup transport A destination' });
    const originForB = await seedPlace(lookupSeed, { name: 'Reverse lookup transport B origin' });
    await commitSeed(lookupSeed);
    const journeyA = mustOk(
      await createJourney(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        tripId: f.tripIds[0] ?? '',
        travellerId: f.travellerIds[0] ?? '',
      }),
    );
    const visit = mustOk(
      await addIntendedVisit(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        journeyId: journeyA.journeyId,
        expectedRevision: 1,
        visit: { jurisdictionId: jurisdiction, purpose: VISIT_PURPOSE, intendedDates: WINDOW_INSIDE, transitIntent: true },
      }),
    );
    const offTarget = mustOk(
      await addIntendedVisit(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        journeyId: journeyA.journeyId,
        expectedRevision: visit.journeyRevision,
        visit: { jurisdictionId: elsewhere, purpose: VISIT_PURPOSE, intendedDates: WINDOW_INSIDE },
      }),
    );

    const hits = await queries.intendedVisitsInJurisdictionWindow(f.workspaceId, jurisdiction, WINDOW_EARLY);
    assert.equal(hits.length, 1);
    const hit = hits[0];
    assert.ok(hit);
    assert.equal(hit.intendedVisitId, visit.intendedVisitId);
    assert.equal(hit.journeyId, journeyA.journeyId);
    assert.equal(hit.travellerId, journeyA.travellerId);
    assert.equal(hit.jurisdictionId, jurisdiction);
    assert.equal(hit.purpose, VISIT_PURPOSE);
    assert.equal(hit.transitIntent, true, 'a transit-only intent changes which rules apply and must survive the read');
    assert.deepEqual(hit.intendedDates, WINDOW_INSIDE);
    assert.deepEqual(
      await queries.intendedVisitsInJurisdictionWindow(f.workspaceId, jurisdiction, { start: at(120), end: at(360) }),
      [],
      'a window that starts exactly where the visit ends does not overlap it',
    );
    assert.equal((await queries.intendedVisitsInJurisdictionWindow(f.workspaceId, elsewhere, WINDOW_EARLY)).length, 1);
    assert.deepEqual(await queries.intendedVisitsInJurisdictionWindow(f.workspaceId, opaqueRef(), WINDOW_EARLY), []);

    // One place, four roles: the UNION labels each branch by the column that
    // matched, never by re-deriving a role from the item's kind.
    const journeyB = mustOk(
      await createJourney(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        tripId: f.tripIds[1] ?? '',
        travellerId: f.travellerIds[1] ?? '',
      }),
    );
    const originItemId = randomUUID();
    const stayItemId = randomUUID();
    const locationItemId = randomUUID();
    const destinationItemId = randomUUID();
    const addedA = mustOk(
      await addJourneyItem(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        journeyId: journeyA.journeyId,
        expectedRevision: offTarget.journeyRevision,
        item: transportItem(sharedPlace, destinationForA, originItemId),
      }),
    );
    const addedA2 = mustOk(
      await addJourneyItem(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        journeyId: journeyA.journeyId,
        expectedRevision: addedA.journeyRevision,
        item: stayItem(sharedPlace, stayItemId),
      }),
    );
    const addedB = mustOk(
      await addJourneyItem(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        journeyId: journeyB.journeyId,
        expectedRevision: journeyB.revision,
        item: resourceUseItem(sharedPlace, locationItemId),
      }),
    );
    mustOk(
      await addJourneyItem(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        journeyId: journeyB.journeyId,
        expectedRevision: addedB.journeyRevision,
        item: transportItem(originForB, sharedPlace, destinationItemId),
      }),
    );

    const placeHits = await queries.itemsReferencingPlace(f.workspaceId, sharedPlace);
    assert.deepEqual(
      placeHits.map((row) => `${row.journeyItemId}:${row.placeRole}:${row.kind}`).sort(),
      [
        `${originItemId}:ORIGIN:TRANSPORT`,
        `${stayItemId}:INTENDED:STAY`,
        `${locationItemId}:LOCATION:RESOURCE_USE`,
        `${destinationItemId}:DESTINATION:TRANSPORT`,
      ].sort(),
    );
    assert.deepEqual(await queries.itemsReferencingPlace(f.workspaceId, opaqueRef()), []);
    assert.ok(
      placeHits.every((row) => [journeyA.journeyId, journeyB.journeyId].includes(row.journeyId)),
      'a place hit never reaches outside this workspace',
    );
    assert.equal(addedA2.journeyRevision, offTarget.journeyRevision + 2);
  });
});

// --- 7. Credential selection (F06) ------------------------------------------

describe('M2 lane T: credential selection (F06)', () => {
  test('a Journey pins its own Traveller edition, scoped to its own visits, provenanced by its receipt', async () => {
    const f = await fixture();
    const journey = mustOk(
      await createJourney(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        tripId: f.tripIds[0] ?? '',
        travellerId: f.travellerIds[0] ?? '',
      }),
    );
    // All three visits below commit, so all three jurisdictions must be real
    // M4 rows (0061 FK); the test never asserts a specific jurisdiction value,
    // so one jurisdiction, reused, is enough.
    const visitSeed = await attachSeed(f);
    const visitJurisdictionId = await seedJurisdiction(visitSeed, { name: 'Credential selection jurisdiction' });
    await commitSeed(visitSeed);
    const firstVisit = mustOk(
      await addIntendedVisit(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        journeyId: journey.journeyId,
        expectedRevision: 1,
        visit: { jurisdictionId: visitJurisdictionId, purpose: VISIT_PURPOSE, intendedDates: WINDOW_INSIDE },
      }),
    );
    const secondVisit = mustOk(
      await addIntendedVisit(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        journeyId: journey.journeyId,
        expectedRevision: firstVisit.journeyRevision,
        visit: { jurisdictionId: visitJurisdictionId, purpose: VISIT_PURPOSE, intendedDates: WINDOW_ADJACENT },
      }),
    );
    const mine = f.credentials.find((credential) => credential.travellerId === journey.travellerId);
    const theirs = f.credentials.find((credential) => credential.travellerId !== journey.travellerId);
    assert.ok(mine && theirs);

    // Rule 2 of 0025: a credential is Traveller-owned, so another person's
    // document can never be pinned by this Journey.
    const foreign = conflictOf(
      await selectCredential(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        journeyId: journey.journeyId,
        expectedRevision: secondVisit.journeyRevision,
        credentialId: theirs.credentialId,
        scopeIntendedVisitIds: [firstVisit.intendedVisitId],
      }),
    );
    assert.equal(foreign.kind, 'VALIDATION_FAILED');
    assert.match(foreign.message, /F06/);
    assert.equal(
      await countRows(f.pool, 'SELECT COUNT(*) AS n FROM credential_selections WHERE workspace_id = $1', [
        f.workspaceId,
      ]),
      0,
    );

    // Rule 3: a scope may not reach into another Journey's visits.
    const foreignJourney = mustOk(
      await createJourney(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        tripId: f.tripIds[1] ?? '',
        travellerId: f.travellerIds[1] ?? '',
      }),
    );
    const foreignVisit = mustOk(
      await addIntendedVisit(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        journeyId: foreignJourney.journeyId,
        expectedRevision: 1,
        visit: { jurisdictionId: visitJurisdictionId, purpose: VISIT_PURPOSE, intendedDates: WINDOW_INSIDE },
      }),
    );
    const scopeViolation = conflictOf(
      await selectCredential(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        journeyId: journey.journeyId,
        expectedRevision: secondVisit.journeyRevision,
        credentialId: mine.credentialId,
        scopeIntendedVisitIds: [firstVisit.intendedVisitId, foreignVisit.intendedVisitId],
      }),
    );
    assert.equal(scopeViolation.kind, 'VALIDATION_FAILED');
    assert.match(scopeViolation.message, /not visits of journey/);
    assert.equal(await headRevisionOf(f, journey.journeyId), secondVisit.journeyRevision);

    const selectionKey = randomUUID();
    const selected = mustOk(
      await selectCredential(f.uow(), {
        ...f.identity,
        idempotencyKey: selectionKey,
        journeyId: journey.journeyId,
        expectedRevision: secondVisit.journeyRevision,
        credentialId: mine.credentialId,
        credentialVersionId: mine.versionId,
        scopeIntendedVisitIds: [firstVisit.intendedVisitId, secondVisit.intendedVisitId],
      }),
    );
    assert.equal(selected.credentialVersionId, mine.versionId);
    assert.equal(selected.journeyRevision, secondVisit.journeyRevision + 1);

    const persisted = await scalar<{ command_id: string; namespace: string; idem_key: string }>(
      f.pool,
      `SELECT selected_by_command_id AS command_id,
              selected_by_command_namespace AS namespace,
              selected_by_idempotency_key AS idem_key
         FROM credential_selections WHERE workspace_id = $1 AND id = $2`,
      [f.workspaceId, selected.selectionId],
    );
    assert.match(persisted.command_id, /^cmd-[0-9a-f]{32}$/, 'provenance is derived, so a retry derives it again');
    assert.equal(persisted.namespace, 'CREDENTIAL_SELECTED');
    assert.equal(persisted.idem_key, selectionKey);
    assert.equal(
      await countRows(
        f.pool,
        'SELECT COUNT(*) AS n FROM command_receipts WHERE workspace_id = $1 AND command_namespace = $2 AND idempotency_key = $3',
        [f.workspaceId, persisted.namespace, persisted.idem_key],
      ),
      1,
      'the deferred FK into the receipt ledger resolved at COMMIT',
    );

    const listed = await readThrough(f.pool, () =>
      new PgJourneyRepository().listCredentialSelections(f.workspaceId, journey.journeyId),
    );
    assert.equal(listed.length, 1);
    assert.deepEqual(
      [...(listed[0]?.scopeIntendedVisitIds ?? [])].sort(),
      [firstVisit.intendedVisitId, secondVisit.intendedVisitId].sort(),
    );
    assert.equal(listed[0]?.selectedByCommandId, persisted.command_id);

    // Re-selecting the same credential re-pins this row; it never accumulates a
    // second claim or a wider scope than the command claimed.
    const narrowed = mustOk(
      await selectCredential(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        journeyId: journey.journeyId,
        expectedRevision: selected.journeyRevision,
        credentialId: mine.credentialId,
        credentialVersionId: mine.versionId,
        scopeIntendedVisitIds: [secondVisit.intendedVisitId],
      }),
    );
    assert.equal(narrowed.selectionId, selected.selectionId);
    assert.equal(
      await countRows(f.pool, 'SELECT COUNT(*) AS n FROM credential_selections WHERE workspace_id = $1', [
        f.workspaceId,
      ]),
      1,
    );
    assert.equal(
      await countRows(
        f.pool,
        'SELECT COUNT(*) AS n FROM credential_selection_visits WHERE workspace_id = $1 AND selection_id = $2',
        [f.workspaceId, selected.selectionId],
      ),
      1,
    );

    const removed = mustOk(
      await removeCredentialSelection(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        journeyId: journey.journeyId,
        credentialId: mine.credentialId,
        expectedRevision: narrowed.journeyRevision,
      }),
    );
    assert.equal(removed.selectionId, selected.selectionId);
    assert.deepEqual(
      await readThrough(f.pool, () =>
        new PgJourneyRepository().listCredentialSelections(f.workspaceId, journey.journeyId),
      ),
      [],
    );
    assert.equal(
      await countRows(
        f.pool,
        'SELECT COUNT(*) AS n FROM credential_selection_visits WHERE workspace_id = $1 AND selection_id = $2',
        [f.workspaceId, selected.selectionId],
      ),
      0,
      'withdrawing the selection must not orphan its scope rows',
    );
    assert.equal(
      await countRows(f.pool, 'SELECT COUNT(*) AS n FROM journeys WHERE workspace_id = $1 AND id = $2', [
        f.workspaceId,
        journey.journeyId,
      ]),
      1,
      'withdrawing a selection never deletes the Journey that made it',
    );
    assert.match(
      conflictOf(
        await removeCredentialSelection(f.uow(), {
          ...f.identity,
          idempotencyKey: randomUUID(),
          journeyId: journey.journeyId,
          credentialId: mine.credentialId,
          expectedRevision: removed.journeyRevision,
        }),
      ).message,
      /no selection/,
    );
    // The Traveller's own credential row is untouched by all of the above.
    assert.equal(
      await countRows(f.pool, 'SELECT COUNT(*) AS n FROM travel_credentials WHERE workspace_id = $1 AND id = $2', [
        f.workspaceId,
        mine.credentialId,
      ]),
      1,
    );
  });
});

// --- 8. Idempotency ---------------------------------------------------------

describe('M2 lane T: idempotency', () => {
  test('replaying a command returns the original receipt and writes nothing a second time', async () => {
    const f = await fixture();
    const tripId = randomUUID();
    const idempotencyKey = randomUUID();
    const call = () =>
      createTrip(f.uow(), {
        ...f.identity,
        idempotencyKey,
        purpose: PURPOSE_TEXT,
        intendedWindow: WINDOW_EARLY,
        tripId,
      });

    const first = mustCommit(await call());
    const replay = mustCommit(await call());
    assert.deepEqual(replay.value, first.value);
    assert.equal(replay.receipt.committedAt, first.receipt.committedAt, 'replay returns the ORIGINAL commit instant');
    assert.equal(replay.receipt.payloadHash, first.receipt.payloadHash);
    assert.equal(replay.receipt.resultRef, first.receipt.resultRef);
    assert.equal(
      await countRows(f.pool, 'SELECT COUNT(*) AS n FROM trips WHERE workspace_id = $1 AND id = $2', [
        f.workspaceId,
        tripId,
      ]),
      1,
    );
    assert.equal(await headRevisionOf(f, tripId), 1, 'a replay never advances a head twice');
    assert.equal(
      await countRows(f.pool, 'SELECT COUNT(*) AS n FROM change_records WHERE workspace_id = $1', [f.workspaceId]),
      1,
    );
    assert.equal(
      await countRows(f.pool, 'SELECT COUNT(*) AS n FROM outbox WHERE workspace_id = $1', [f.workspaceId]),
      1,
    );

    const mismatched = conflictOf(
      await createTrip(f.uow(), { ...f.identity, idempotencyKey, purpose: REVISED_PURPOSE, tripId }),
    );
    assert.equal(mismatched.kind, 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');
    const unchanged = await readThrough(f.pool, () => new PgTripRepository().load(f.workspaceId, tripId));
    assert.equal(unchanged?.purpose, PURPOSE_TEXT);
    assert.equal(unchanged?.lifecycleStatus, 'DRAFT');

    // The same property holds for a child write: a replay must not add an item.
    const journey = mustOk(
      await createJourney(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        tripId,
        travellerId: f.travellerIds[0] ?? '',
      }),
    );
    // Built once, so both submissions hash identically. The write commits (a
    // replay must not add a second one), so the place must be real (0061 FK).
    const idemSeed = await attachSeed(f);
    const idemPlaceId = await seedPlace(idemSeed, { name: 'Idempotent stay place' });
    await commitSeed(idemSeed);
    const itemSeed = stayItem(idemPlaceId, randomUUID());
    const itemKey = randomUUID();
    const addItem = () =>
      addJourneyItem(f.uow(), {
        ...f.identity,
        idempotencyKey: itemKey,
        journeyId: journey.journeyId,
        expectedRevision: 1,
        item: itemSeed,
      });
    const added = mustOk(await addItem());
    const replayedItem = mustOk(await addItem());
    assert.deepEqual(replayedItem, added);
    assert.equal(
      await countRows(f.pool, 'SELECT COUNT(*) AS n FROM journey_items WHERE workspace_id = $1', [f.workspaceId]),
      1,
    );
    assert.equal(await headRevisionOf(f, journey.journeyId), 2);

    // A detail-only edit moves the Trip head exactly once.
    const changed = mustOk(
      await updateTripDetails(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        tripId,
        expectedRevision: 1,
        purpose: REVISED_PURPOSE,
        intendedWindow: WINDOW_ADJACENT,
      }),
    );
    assert.equal(changed.revision, 2);
    const reread = await readThrough(f.pool, () => new PgTripRepository().load(f.workspaceId, tripId));
    assert.equal(reread?.purpose, REVISED_PURPOSE);
    assert.deepEqual(reread?.intendedWindow, WINDOW_ADJACENT);
    assert.equal(
      conflictOf(
        await updateTripDetails(f.uow(), {
          ...f.identity,
          idempotencyKey: randomUUID(),
          tripId,
          expectedRevision: 2,
        }),
      ).kind,
      'VALIDATION_FAILED',
      'a command that changes nothing must say so instead of padding the history',
    );
    // A Journey detail edit keeps the Journey's own counter, never the Trip's.
    const windowed = mustOk(
      await updateJourneyDetails(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        journeyId: journey.journeyId,
        expectedRevision: 2,
        intendedWindow: WINDOW_INSIDE,
      }),
    );
    assert.equal(windowed.revision, 3);
    assert.equal(await headRevisionOf(f, tripId), 2);
    assert.deepEqual(
      (await readThrough(f.pool, () => new PgJourneyRepository().load(f.workspaceId, journey.journeyId)))
        ?.intendedWindow,
      WINDOW_INSIDE,
    );
  });
});

// --- 9. Cross-aggregate CAS and rollback atomicity --------------------------

describe('M2 lane T: cross-aggregate CAS and rollback', () => {
  test('one command may cite two aggregates and a rejected one leaves no trace of any kind', async () => {
    const f = await fixture();
    const tripId = f.tripIds[0] ?? '';
    const journey = mustOk(
      await createJourney(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        tripId,
        travellerId: f.travellerIds[0] ?? '',
      }),
    );
    const generation = await scopeGenerationOf(f, tripId);

    // (a) A hand-built envelope naming two roots: one current, one stale. The
    // ledger validates every expectation before the handler body may run.
    let bodyRan = false;
    const crossAggregate = await f.uow().execute<string>(
      DomainCommandEnvelopeSchema.parse({
        commandType: 'LANE_T_CROSS_AGGREGATE_PROBE',
        schemaVersion: '1',
        workspaceId: f.workspaceId,
        actorPrincipalId: f.identity.actorPrincipalId,
        idempotencyKey: randomUUID(),
        canonicalPayloadHash: 'cross-aggregate-probe',
        typedPayload: {},
        expectedAggregateRevisions: [
          { aggregateRef: { kind: 'TRIP', id: tripId }, expectedRevision: 1 },
          { aggregateRef: { kind: 'JOURNEY', id: journey.journeyId }, expectedRevision: 99 },
        ],
      }),
      async () => {
        bodyRan = true;
        return { ok: false, conflict: typedConflict('VALIDATION_FAILED', 'the handler body must not run') };
      },
    );
    assert.equal(bodyRan, false, 'a stale expectation must be rejected before the handler writes anything');
    assert.equal(crossAggregate.ok, false);
    if (!crossAggregate.ok) {
      assert.equal(crossAggregate.conflict.kind, 'STALE_AGGREGATE_REVISION');
      assert.ok(
        crossAggregate.conflict.subjectRefs.some((ref) => ref.kind === 'JOURNEY' && ref.id === journey.journeyId),
        'the conflict must name the aggregate that was actually stale',
      );
    }
    assert.equal(await headRevisionOf(f, tripId), 1);
    assert.equal(await headRevisionOf(f, journey.journeyId), 1);

    // (b) The same rule with a *new* root: creating a Journey may cite the Trip
    // it joins, and a stale citation rejects the whole command.
    const unboundJourneyId = randomUUID();
    const staleTripCitation = conflictOf(
      await createJourney(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        tripId,
        travellerId: f.travellerIds[1] ?? '',
        journeyId: unboundJourneyId,
        expectedTripRevision: 42,
      }),
    );
    assert.equal(staleTripCitation.kind, 'STALE_AGGREGATE_REVISION');
    assert.equal(await headRevisionOf(f, unboundJourneyId), undefined, 'no head may survive a rejected command');
    assert.equal(
      await countRows(f.pool, 'SELECT COUNT(*) AS n FROM domain_subjects WHERE workspace_id = $1 AND id = $2', [
        f.workspaceId,
        unboundJourneyId,
      ]),
      0,
    );
    assert.equal(
      await countRows(f.pool, 'SELECT COUNT(*) AS n FROM journeys WHERE workspace_id = $1 AND id = $2', [
        f.workspaceId,
        unboundJourneyId,
      ]),
      0,
    );
    assert.equal(
      await countRows(f.pool, 'SELECT COUNT(*) AS n FROM command_receipts WHERE workspace_id = $1', [f.workspaceId]),
      1,
      'the probe and the rejected membership have no receipt at all',
    );
    assert.equal(
      await scopeGenerationOf(f, tripId),
      generation,
      'a rejected membership must not move the Trip scope counter either',
    );

    // (c) Rollback atomicity through the middle of a multi-row write: the Journey
    // head exists before the typed row does, and a failed FK must undo both.
    const phantomTravellerId = randomUUID();
    const halfBuiltJourneyId = randomUUID();
    const orphan = conflictOf(
      await createJourney(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        tripId,
        travellerId: phantomTravellerId,
        journeyId: halfBuiltJourneyId,
        items: [stayItem(opaqueRef(), randomUUID())],
      }),
    );
    assert.equal(orphan.kind, 'VALIDATION_FAILED');
    assert.match(orphan.message, /journeys_traveller_fk|foreign key violation/i);
    assert.equal(await headRevisionOf(f, halfBuiltJourneyId), undefined);
    assert.equal(
      await countRows(f.pool, 'SELECT COUNT(*) AS n FROM domain_subjects WHERE workspace_id = $1', [f.workspaceId]),
      SEEDED_HEADS + 1,
      'the registry rows written before the failure are gone with them',
    );
    assert.equal(
      await countRows(f.pool, 'SELECT COUNT(*) AS n FROM journey_items WHERE workspace_id = $1', [f.workspaceId]),
      0,
      'the child item is written in the same transaction and must be gone too',
    );

    // (d) A TypedRef with the right id and the wrong kind is a miss, not a hit
    // (C1 amendment a at the head layer).
    let wrongKindRan = false;
    const wrongKind = await f.uow().execute<string>(
      DomainCommandEnvelopeSchema.parse({
        commandType: 'LANE_T_WRONG_KIND_PROBE',
        schemaVersion: '1',
        workspaceId: f.workspaceId,
        actorPrincipalId: f.identity.actorPrincipalId,
        idempotencyKey: randomUUID(),
        canonicalPayloadHash: 'wrong-kind-probe',
        typedPayload: {},
        expectedAggregateRevisions: [{ aggregateRef: { kind: 'TRIP', id: journey.journeyId }, expectedRevision: 1 }],
      }),
      async () => {
        wrongKindRan = true;
        return { ok: false, conflict: typedConflict('VALIDATION_FAILED', 'a wrong kind must not reach the body') };
      },
    );
    assert.equal(wrongKindRan, false);
    assert.equal(wrongKind.ok, false);
    if (!wrongKind.ok) {
      assert.equal(wrongKind.conflict.kind, 'STALE_AGGREGATE_REVISION');
      assert.match(wrongKind.conflict.message, /MISSING/);
    }
  });
});

// --- 10. Audit/outbox fan-out ----------------------------------------------

describe('M2 lane T: audit and outbox fan-out', () => {
  test('one command advances one root and emits exactly one change record and one outbox event', async () => {
    const f = await fixture();
    const tripId = f.tripIds[0] ?? '';
    const createKey = randomUUID();
    const fanOutSeed = await attachSeed(f);
    const fanOutOrigin = await seedPlace(fanOutSeed, { name: 'Fan-out transport origin' });
    const fanOutDestination = await seedPlace(fanOutSeed, { name: 'Fan-out transport destination' });
    const fanOutStayPlace = await seedPlace(fanOutSeed, { name: 'Fan-out stay place' });
    const fanOutJurisdictionId = await seedJurisdiction(fanOutSeed, { name: 'Fan-out jurisdiction' });
    await commitSeed(fanOutSeed);
    const item = transportItem(fanOutOrigin, fanOutDestination, randomUUID());
    const visit = {
      id: randomUUID(),
      jurisdictionId: fanOutJurisdictionId,
      purpose: VISIT_PURPOSE,
      intendedDates: WINDOW_INSIDE,
    };
    const created = mustOk(
      await createJourney(f.uow(), {
        ...f.identity,
        idempotencyKey: createKey,
        tripId,
        travellerId: f.travellerIds[0] ?? '',
        intendedWindow: WINDOW_EARLY,
        items: [item, stayItem(fanOutStayPlace, randomUUID())],
        intendedVisits: [visit],
      }),
    );

    assert.equal(
      await countRows(
        f.pool,
        'SELECT COUNT(*) AS n FROM change_records WHERE workspace_id = $1 AND command_namespace = $2 AND idempotency_key = $3',
        [f.workspaceId, 'JOURNEY_CREATED', createKey],
      ),
      1,
      'two items and one visit are children of one root: one history row',
    );
    assert.equal(
      await countRows(
        f.pool,
        'SELECT COUNT(*) AS n FROM outbox WHERE workspace_id = $1 AND destination_kind = $2',
        [f.workspaceId, 'JOURNEY_CREATED'],
      ),
      1,
    );
    const record = await scalar<{ subject_kind: string; subject_id: string; before: string | null; after: string }>(
      f.pool,
      `SELECT subject_kind, subject_id::text AS subject_id,
              before_revision::text AS before, after_revision::text AS after
         FROM change_records WHERE workspace_id = $1 AND command_namespace = $2 AND idempotency_key = $3`,
      [f.workspaceId, 'JOURNEY_CREATED', createKey],
    );
    assert.equal(record.subject_kind, 'JOURNEY');
    assert.equal(record.subject_id, created.journeyId);
    assert.equal(record.before, null, 'a new root has no previous revision');
    assert.equal(record.after, '1');
    assert.equal(
      await countRows(
        f.pool,
        'SELECT COUNT(*) AS n FROM change_records WHERE workspace_id = $1 AND subject_kind = $2',
        [f.workspaceId, 'JOURNEY_ITEM'],
      ),
      0,
      'children never fan out their own history',
    );

    // The children themselves landed in the same step.
    assert.equal(
      await countRows(
        f.pool,
        'SELECT COUNT(*) AS n FROM journey_items WHERE workspace_id = $1 AND journey_id = $2',
        [f.workspaceId, created.journeyId],
      ),
      2,
    );
    assert.equal(
      await countRows(
        f.pool,
        'SELECT COUNT(*) AS n FROM intended_visits WHERE workspace_id = $1 AND journey_id = $2',
        [f.workspaceId, created.journeyId],
      ),
      1,
    );
    assert.equal(
      await countRows(
        f.pool,
        `SELECT COUNT(*) AS n FROM transport_item_details d
           JOIN journey_items i ON i.workspace_id = d.workspace_id AND i.id = d.journey_item_id
          WHERE d.workspace_id = $1 AND i.journey_id = $2`,
        [f.workspaceId, created.journeyId],
      ),
      1,
    );
    const outbox = await scalar<{
      subject_kind: string;
      subject_id: string;
      state: string;
      payload: Record<string, unknown>;
    }>(
      f.pool,
      `SELECT subject_kind, subject_id::text AS subject_id, state, payload AS payload
         FROM outbox WHERE workspace_id = $1 AND destination_kind = $2`,
      [f.workspaceId, 'JOURNEY_CREATED'],
    );
    assert.equal(outbox.subject_kind, 'JOURNEY', 'the event is bound to the root aggregate, never to a child');
    assert.equal(outbox.subject_id, created.journeyId);
    assert.equal(outbox.state, 'PENDING', 'an event published by nobody yet stays claimable');
    // commandSupport.ts publishes `payload: value`, so the event body is exactly
    // the command result: a deep compare catches both dropped and leaked keys.
    assert.deepEqual(outbox.payload, created);

    // The next command on the same root chains before/after revisions.
    const added = mustOk(
      await addJourneyItem(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        journeyId: created.journeyId,
        expectedRevision: 1,
        item: standaloneEngagementItem(randomUUID()),
      }),
    );
    assert.equal(added.journeyRevision, 2);
    assert.deepEqual(
      await scalar<{ before: string; after: string }>(
        f.pool,
        `SELECT before_revision::text AS before, after_revision::text AS after
           FROM change_records WHERE workspace_id = $1 AND command_namespace = $2`,
        [f.workspaceId, 'JOURNEY_ITEM_ADDED'],
      ),
      { before: '1', after: '2' },
    );
    assert.equal(await headRevisionOf(f, created.journeyId), 2);
    assert.equal(
      await headRevisionOf(f, tripId),
      1,
      'a Journey write never moves the Trip aggregate: §3 makes it an independent root',
    );
    assert.equal(
      await scopeGenerationOf(f, tripId),
      '1',
      'membership advanced the Trip scope exactly once, and the item write did not',
    );

    // A cancelled Journey is never deleted to shed the history it produced.
    mustOk(
      await setJourneyLifecycleStatus(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        journeyId: created.journeyId,
        expectedRevision: 2,
        lifecycleStatus: 'CANCELLED',
      }),
    );
    assert.equal(
      await countRows(f.pool, 'SELECT COUNT(*) AS n FROM journeys WHERE workspace_id = $1 AND id = $2', [
        f.workspaceId,
        created.journeyId,
      ]),
      1,
    );
    assert.equal(
      await countRows(f.pool, 'SELECT COUNT(*) AS n FROM change_records WHERE workspace_id = $1', [f.workspaceId]),
      3,
      'history is append-only: the cancelled Journey adds a row, it never removes one',
    );
    assert.equal(await scopeGenerationOf(f, tripId), '2');
  });
});

// --- 11. Index access paths --------------------------------------------------

describe('M2 lane T: read-query access paths', () => {
  test('every statement the read model emits can use the index its port names', async () => {
    const f = await fixture();
    const traveller = f.travellerIds[0] ?? '';
    const tripId = f.tripIds[0] ?? '';
    const journey = mustOk(
      await createJourney(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        tripId,
        travellerId: traveller,
        intendedWindow: WINDOW_EARLY,
      }),
    );
    // `referenced` doubled as both a place and a jurisdiction id before 0061:
    // now the two are distinct real M4 rows in different tables, so a Place is
    // used for the item origin/stay columns and a Jurisdiction for the visit.
    const accessPathSeed = await attachSeed(f);
    const referencedPlace = await seedPlace(accessPathSeed, { name: 'Access-path place' });
    const otherPlace = await seedPlace(accessPathSeed, { name: 'Access-path transport other end' });
    const referencedJurisdiction = await seedJurisdiction(accessPathSeed, { name: 'Access-path jurisdiction' });
    await commitSeed(accessPathSeed);
    const withTransport = mustOk(
      await addJourneyItem(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        journeyId: journey.journeyId,
        expectedRevision: 1,
        item: transportItem(referencedPlace, otherPlace, randomUUID()),
      }),
    );
    const withStay = mustOk(
      await addJourneyItem(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        journeyId: journey.journeyId,
        expectedRevision: withTransport.journeyRevision,
        item: stayItem(referencedPlace, randomUUID()),
      }),
    );
    // Every item write advances the parent Journey's head, so the visit builds
    // on the revision the last one returned.
    mustOk(
      await addIntendedVisit(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        journeyId: journey.journeyId,
        expectedRevision: withStay.journeyRevision,
        visit: { jurisdictionId: referencedJurisdiction, purpose: VISIT_PURPOSE, intendedDates: WINDOW_INSIDE },
      }),
    );
    // Prove the fixture really wrote rows before measuring any plan — an empty
    // table would make every EXPLAIN result meaningless.
    const written = await readThrough(f.pool, async () => {
      const journeys = new PgJourneyRepository();
      return {
        items: await journeys.listItems(f.workspaceId, journey.journeyId),
        visits: await journeys.listIntendedVisits(f.workspaceId, journey.journeyId),
      };
    });
    assert.equal(written.items.length, 2, 'both items belong to the parent Journey');
    assert.equal(written.visits.length, 1);
    assert.equal(written.visits[0]?.jurisdictionId, referencedJurisdiction);

    // Capture the statements the implementation actually emits, so this proves
    // something about the read model rather than about a copy of its SQL.
    const statements: { text: string; values: readonly unknown[] }[] = [];
    const recorder = {
      query(text: string, values?: readonly unknown[]) {
        statements.push({ text, values: values ?? [] });
        return f.pool.query(text, values as unknown[] | undefined);
      },
    } as unknown as Pool;
    const queries = new PgJourneyReadQueries(recorder);
    await queries.journeysForTravellerInWindow(f.workspaceId, traveller, WINDOW_EARLY);
    await queries.journeysForTrip(f.workspaceId, tripId);
    await queries.itemsReferencingPlace(f.workspaceId, referencedPlace);
    await queries.intendedVisitsInJurisdictionWindow(f.workspaceId, referencedJurisdiction, WINDOW_EARLY);
    assert.equal(statements.length, 4, 'each read model method is exactly one statement');

    /**
     * One measurement of one statement: the incidental alternatives to remove
     * (inside a transaction that is rolled back) and the access paths the plan
     * must then be able to use.
     *
     * With a handful of rows the planner will use ANY index that starts with
     * `workspace_id`, so "can this statement use the access path its port
     * names" can only be answered by taking the incidental alternatives away.
     * Each measurement gets its own transaction because the drops must not
     * leak into the next one.
     *
     * A statement may need MORE THAN ONE measurement. `itemsReferencingPlace`
     * is a four-branch `UNION ALL` whose first two branches read the same
     * table through different place columns, so
     * `idx_transport_item_details_origin` and `_destination` are each other's
     * incidental alternative: both lead with `workspace_id`, both cost the
     * same on a small table, and the planner will happily serve the ORIGIN
     * branch from the destination index with `Filter: desired_origin_place_id`
     * once statistics exist. A single measurement therefore cannot prove both
     * branches — it proves whichever index the planner happened to pick and
     * reports the other as missing (`M2-ACCESS-PATH-PLANNER`). Each transport
     * branch is measured with its sibling removed instead; the two
     * single-place-index tables are proven in either measurement.
     */
    interface AccessPathProbe {
      readonly drop: readonly string[];
      readonly expect: readonly string[];
    }

    const probesByMethod: AccessPathProbe[][] = [
      [
        {
          drop: ['idx_journeys_traveller_window', 'idx_journeys_trip', 'idx_journeys_trip_window'],
          expect: ['idx_journeys_traveller'],
        },
      ],
      [
        {
          drop: ['idx_journeys_trip_window', 'idx_journeys_traveller', 'idx_journeys_traveller_window'],
          expect: ['idx_journeys_trip'],
        },
      ],
      [
        {
          drop: ['idx_transport_item_details_destination'],
          expect: [
            'idx_transport_item_details_origin',
            'idx_stay_item_details_place',
            'idx_resource_use_item_details_place',
          ],
        },
        {
          drop: ['idx_transport_item_details_origin'],
          expect: ['idx_transport_item_details_destination'],
        },
      ],
      [
        {
          drop: ['idx_intended_visits_journey'],
          expect: ['idx_intended_visits_jurisdiction_window'],
        },
      ],
    ];

    /**
     * Tables to `ANALYZE` before measuring, so the plan depends on the rows
     * this test actually wrote rather than on whether autovacuum happened to
     * reach the shared test database first. Without it the same assertion is
     * green on a cold database and red on a warm one, which is not a contract.
     */
    const analyzeTablesByMethod: string[][] = [
      ['journeys'],
      ['journeys'],
      ['transport_item_details', 'stay_item_details', 'resource_use_item_details', 'journey_items'],
      ['intended_visits', 'journeys'],
    ];

    /**
     * The most incidental alternative is the scanned table's own primary key,
     * because `(workspace_id, id)` also leads with the partition column. It
     * cannot be left in place: while the table carries no statistics the
     * planner treats `workspace_id = $1` as unselective and reaches for the
     * two-column index, but once autovacuum has analysed it the same statement
     * plans as a primary-key lookup that *filters* the discriminating column.
     * Both plans return the same rows, so without this the measurement only
     * holds on a cold database. `CASCADE` is needed because other M2 tables
     * declare FKs against these keys, and the whole transaction rolls back.
     *
     * Only tables carrying the statement's own predicate are listed. The
     * join-side keys (`journeys_pkey` behind an item/visit join,
     * `journey_items_pkey` behind a detail/item join) stay in place: they are
     * the path a correct plan is meant to use, not an alternative to it.
     */
    const incidentalPrimaryKeysByMethod: string[][] = [
      ['journeys'],
      ['journeys'],
      ['transport_item_details', 'stay_item_details', 'resource_use_item_details'],
      ['intended_visits'],
    ];

    for (const [index, statement] of statements.entries()) {
      for (const [probeIndex, probe] of (probesByMethod[index] ?? []).entries()) {
        const client = await f.pool.connect();
        let plan = '';
        try {
          await client.query('BEGIN');
          await client.query('SET LOCAL enable_seqscan = off');
          await client.query("SET LOCAL lock_timeout = '30s'");
          for (const table of analyzeTablesByMethod[index] ?? []) {
            await client.query(`ANALYZE ${table}`);
          }
          for (const name of probe.drop) {
            await client.query(`DROP INDEX IF EXISTS ${name}`);
          }
          for (const table of incidentalPrimaryKeysByMethod[index] ?? []) {
            await client.query(`ALTER TABLE ${table} DROP CONSTRAINT ${table}_pkey CASCADE`);
          }
          // Plain EXPLAIN returns one column literally named "QUERY PLAN".
          const rows = await client.query<{ 'QUERY PLAN': string }>(
            `EXPLAIN ${statement.text}`,
            statement.values as unknown[],
          );
          plan = rows.rows.map((row) => row['QUERY PLAN']).join('\n');
        } finally {
          await client.query('ROLLBACK').catch(() => undefined);
          client.release();
        }
        const where = `statement ${index} probe ${probeIndex}`;
        assert.ok(plan.length > 0, `${where} produced an empty plan`);
        assert.doesNotMatch(plan, /Seq Scan/, `${where} fell back to a sequential scan:\n${plan}`);
        for (const name of probe.expect) {
          assert.ok(plan.includes(name), `${where} cannot use ${name}:\n${plan}`);
        }
      }
    }
  });
});

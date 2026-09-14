/**
 * M2 lane S — coordination groups, accompaniment requirements and support
 * assignments against real PostgreSQL.
 *
 * Evidence this file exists to produce:
 *  1. a group is a *shared scope* over Journeys, and the window lookups only
 *     claim what the rows actually claim;
 *  2. a requirement edition is immutable and append-only, while an assignment
 *     moves only its own fulfilment — including the database's own copy of that
 *     rule, which is exercised by writing rows behind the handler's back;
 *  3. eligibility, coverage gaps, minimum-simultaneous supporters and the
 *     handoff gap are decided by `assignmentSatisfiesDefinition`, and the handler
 *     returns those exact reasons rather than re-deriving arithmetic;
 *  4. revision CAS and the kind-discriminating registry (C1 a) reject the writes
 *     they must reject without changing anything;
 *  5. the target model has no boolean support column to assert — its absence is
 *     queried from `information_schema`.
 *
 * Every fixture uses a fresh workspace (`beginSeed`) and never deletes rows it
 * did not insert: the PostgreSQL test database is shared with sibling M2 lanes.
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed, seedJourney, seedJourneyItem, seedTraveller, seedTrip } from './m2Seed.ts';
import { PgUnitOfWork, type ExecuteOutcome } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { runWithTransactionClient } from '../src/persistence/postgres/transactionContext.ts';
import { PgCoordinationRepository } from '../src/persistence/postgres/repositories/pgCoordinationRepository.ts';
import { PgSupportRepository } from '../src/persistence/postgres/repositories/pgSupportRepository.ts';
import { PgCoordinationReadQueries } from '../src/persistence/postgres/queries/pgCoordinationReadQueries.ts';
import { PgSupportReadQueries } from '../src/persistence/postgres/queries/pgSupportReadQueries.ts';
import {
  addJourneyToGroup,
  appendAccompanimentRequirement,
  createCoordinationGroup,
  createSupportAssignment,
  removeJourneyFromGroup,
  replaceSupportAssignmentScope,
  setSupportAssignmentStatus,
  shareJourneyItem,
  updateCoordinationGroup,
  type AccompanimentRequirementCommandResult,
  type CoordinationGroupCommandResult,
  type SupportAssignmentCommandResult,
} from '../src/persistence/postgres/commands/supportCommands.ts';
import {
  assignmentSatisfiesDefinition,
  type AccompanimentConstraintDefinition,
  type SupportAssignment,
} from '../src/domain/v2/trip/support.ts';
import type { TypedConflict } from '../src/domain/v2/shared/errors.ts';

/** A generic four-hour window; no scenario, city or demo date appears anywhere. */
const T0 = Date.UTC(2030, 0, 1);
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();
const FULL = { start: at(0), end: at(240) };
const MIDDLE = { start: at(60), end: at(120) };

interface Fixture {
  pool: Pool;
  workspaceId: string;
  actorPrincipalId: string;
  supportedTravellerId: string;
  supporterIds: [string, string];
  /** A traveller who is deliberately outside every eligible set. */
  outsiderId: string;
  journeyIds: [string, string];
  journeyItemIds: [string, string];
}

/**
 * A committed graph of the neighbours lane S reads through but does not own:
 * Travellers, Trip, Journeys and JourneyItems are seeded through `m2Seed.ts`
 * rather than through another lane's repository.
 *
 * The PostgreSQL test database is shared with sibling M2 lanes and with the
 * other tests in this file, so every call opens a *new* workspace: row counts
 * and read-query result sets then depend only on the calling test.
 */
async function fixture(): Promise<Fixture> {
  const pool = await sharedTestPool();
  const seed = await beginSeed(pool);
  const supported = await seedTraveller(seed);
  const supporterA = await seedTraveller(seed);
  const supporterB = await seedTraveller(seed);
  const outsider = await seedTraveller(seed);
  const tripId = await seedTrip(seed);
  const journeyA = await seedJourney(seed, {
    tripId,
    travellerId: supporterA.travellerId,
    window: FULL,
  });
  const journeyB = await seedJourney(seed, {
    tripId,
    travellerId: supporterB.travellerId,
    window: FULL,
  });
  const itemA = await seedJourneyItem(seed, { journeyId: journeyA, kind: 'ENGAGEMENT' });
  const itemB = await seedJourneyItem(seed, { journeyId: journeyB, kind: 'ENGAGEMENT' });
  await commitSeed(seed);

  const created: Fixture = {
    pool,
    workspaceId: seed.workspaceId,
    actorPrincipalId: seed.actorId,
    supportedTravellerId: supported.travellerId,
    supporterIds: [supporterA.travellerId, supporterB.travellerId],
    outsiderId: outsider.travellerId,
    journeyIds: [journeyA, journeyB],
    journeyItemIds: [itemA.journeyItemId, itemB.journeyItemId],
  };
  return created;
}

function unitOfWork(f: Fixture): PgUnitOfWork {
  return new PgUnitOfWork(f.pool, f.workspaceId);
}

function mustOk<T>(outcome: ExecuteOutcome<T>): T {
  if (!outcome.ok) assert.fail(`expected the command to commit, got ${outcome.conflict.kind}: ${outcome.conflict.message}`);
  return outcome.value;
}

function conflictOf(outcome: ExecuteOutcome<unknown>): TypedConflict {
  if (outcome.ok) assert.fail('expected a typed conflict, but the command committed');
  return outcome.conflict;
}

function reasonList(conflict: TypedConflict): string[] {
  const reasons = conflict.details?.['reasons'];
  assert.ok(Array.isArray(reasons), 'conflict must carry the domain reasons in details.reasons');
  return reasons as string[];
}

/**
 * Repository reads need the ambient transaction the repositories are written
 * against; they are read-only assertions, so the transaction is rolled back.
 */
async function inRepositoryRead<T>(pool: Pool, fn: () => Promise<T>): Promise<T> {
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

/** Runs statements on one connection and requires the write to be rejected — at the statement or at COMMIT. */
async function commitThatMustFail(
  pool: Pool,
  run: (client: PoolClient) => Promise<void>,
): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    try {
      await run(client);
    } catch (error) {
      // Statement-level guards (e.g. `forbid_mutation`) reject before COMMIT.
      await client.query('ROLLBACK').catch(() => undefined);
      return (error as Error).message;
    }
    try {
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      return (error as Error).message;
    }
    assert.fail('expected the database to reject the write');
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
}

/** The whole row as JSON: the strongest cheap statement of "byte-identical". */
async function requirementRow(pool: Pool, workspaceId: string, requirementId: string, version: number): Promise<string> {
  const result = await pool.query<{ doc: unknown }>(
    `SELECT row_to_json(t) AS doc FROM accompaniment_requirements t
      WHERE workspace_id = $1 AND id = $2 AND version = $3`,
    [workspaceId, requirementId, version],
  );
  const row = result.rows[0];
  assert.ok(row, `expected accompaniment_requirements ${requirementId} v${version} to exist`);
  return JSON.stringify(row.doc);
}

/** Appends a requirement edition and returns its identity, asserting the append committed. */
async function appendRequirement(
  uow: PgUnitOfWork,
  f: Fixture,
  params: {
    requirementId?: string;
    coverage?: { start: string; end: string };
    minimumSimultaneousSupporters?: number;
    eligibleSupporterTravellerIds?: string[];
    maximumHandoffGapMinutes?: number;
  } = {},
): Promise<AccompanimentRequirementCommandResult> {
  return mustOk(
    await appendAccompanimentRequirement(uow, {
      workspaceId: f.workspaceId,
      actorPrincipalId: f.actorPrincipalId,
      idempotencyKey: randomUUID(),
      ...(params.requirementId === undefined ? {} : { requirementId: params.requirementId }),
      supportedTravellerId: f.supportedTravellerId,
      requiredCoverage: params.coverage ?? FULL,
      minimumSimultaneousSupporters: params.minimumSimultaneousSupporters ?? 1,
      eligibleSupporterTravellerIds: params.eligibleSupporterTravellerIds ?? [...f.supporterIds],
      ...(params.maximumHandoffGapMinutes === undefined
        ? {}
        : { maximumHandoffGapMinutes: params.maximumHandoffGapMinutes }),
    }),
  );
}

async function createGroup(
  uow: PgUnitOfWork,
  f: Fixture,
  params: { name: string; purpose?: string; effectiveRange?: { start: string; end: string } },
): Promise<CoordinationGroupCommandResult> {
  return mustOk(
    await createCoordinationGroup(uow, {
      workspaceId: f.workspaceId,
      actorPrincipalId: f.actorPrincipalId,
      idempotencyKey: randomUUID(),
      name: params.name,
      ...(params.purpose === undefined ? {} : { purpose: params.purpose }),
      ...(params.effectiveRange === undefined ? {} : { effectiveRange: params.effectiveRange }),
    }),
  );
}

/**
 * Builds the *shape* the domain is asked about. These objects are never
 * persisted — the handler generates the real subject id — so the first argument
 * is only a label that keeps the failure messages readable.
 */
function assignmentShape(
  label: string,
  requirementId: string,
  requirementVersion: number,
  scopes: { supporter: string; start: string; end: string }[],
  handoffs: SupportAssignment['handoffs'] = [],
): SupportAssignment {
  return {
    id: label,
    revision: 1,
    constraintDefinitionId: requirementId,
    constraintDefinitionVersion: requirementVersion,
    lifecycleStatus: 'PROPOSED',
    assignedSupporterTravellerIds: [...new Set(scopes.map((scope) => scope.supporter))],
    assignedScopes: scopes.map((scope) => ({
      supporterTravellerId: scope.supporter,
      interval: { start: scope.start, end: scope.end },
    })),
    handoffs,
  };
}

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

describe('M2 lane S: coordination groups are shared scopes', () => {
  test('a group covering a window reports each member Journey and disappears when its last membership is removed', async () => {
    const f = await fixture();
    const uow = unitOfWork(f);
    const coordination = new PgCoordinationReadQueries(f.pool, f.workspaceId);

    const withRange = await createGroup(uow, f, {
      name: 'Shared scope A',
      purpose: 'joint window',
      effectiveRange: FULL,
    });
    const plain = await createGroup(uow, f, { name: 'Shared scope B', effectiveRange: FULL });

    const addedA = mustOk(
      await addJourneyToGroup(uow, {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorPrincipalId,
        idempotencyKey: randomUUID(),
        groupId: withRange.groupId,
        journeyId: f.journeyIds[0],
        expectedRevision: 1,
      }),
    );
    assert.equal(addedA.revision, 2, 'adding a participant is the group aggregate moving forward');
    mustOk(
      await addJourneyToGroup(uow, {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorPrincipalId,
        idempotencyKey: randomUUID(),
        groupId: withRange.groupId,
        journeyId: f.journeyIds[1],
        expectedRevision: 2,
        // A membership may narrow itself to part of the group's window.
        effectiveRange: { start: at(0), end: at(60) },
      }),
    );
    mustOk(
      await addJourneyToGroup(uow, {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorPrincipalId,
        idempotencyKey: randomUUID(),
        groupId: plain.groupId,
        journeyId: f.journeyIds[0],
        expectedRevision: 1,
      }),
    );

    const both = await coordination.coordinationGroupsCovering(f.workspaceId, { start: at(0), end: at(30) });
    assert.deepEqual(
      both.map((group) => group.groupId).sort(),
      [withRange.groupId, plain.groupId].sort(),
      'both live groups overlap the opening of the window',
    );
    const first = both.find((group) => group.groupId === withRange.groupId);
    assert.ok(first);
    assert.equal(first.name, 'Shared scope A');
    assert.deepEqual(
      [...first.journeyIds].sort(),
      [...f.journeyIds].sort(),
      'the narrowing membership still participates at the start of the window',
    );

    const narrowed = await coordination.coordinationGroupsCovering(f.workspaceId, MIDDLE);
    const stillFirst = narrowed.find((group) => group.groupId === withRange.groupId);
    assert.ok(stillFirst, 'the group itself still covers the middle of its window');
    assert.deepEqual(
      stillFirst.journeyIds,
      [f.journeyIds[0]],
      'the membership whose declared range stops at minute 60 no longer participates',
    );

    const removed = mustOk(
      await removeJourneyFromGroup(uow, {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorPrincipalId,
        idempotencyKey: randomUUID(),
        groupId: plain.groupId,
        journeyId: f.journeyIds[0],
        expectedRevision: 2,
      }),
    );
    assert.equal(removed.revision, 3, 'create 1 + add 2 + remove 3 on the same group head');
    const afterRemoval = await coordination.coordinationGroupsCovering(f.workspaceId, MIDDLE);
    assert.deepEqual(
      afterRemoval.map((group) => group.groupId),
      [withRange.groupId],
      'a group with no remaining membership coordinates nothing',
    );

    // A group outside its declared range makes no coverage claim at all.
    const outside = await coordination.coordinationGroupsCovering(f.workspaceId, { start: at(1000), end: at(1060) });
    assert.deepEqual(outside, []);

    // The typed port reads the live revision from `aggregate_heads`.
    const loaded = await inRepositoryRead(f.pool, () =>
      new PgCoordinationRepository(f.workspaceId).loadGroup(f.workspaceId, withRange.groupId),
    );
    assert.ok(loaded);
    assert.equal(loaded.revision, 3, 'two memberships added, so the group is at revision 3');
    assert.deepEqual(loaded.effectiveRange, FULL);

    const memberships = await inRepositoryRead(f.pool, () =>
      new PgCoordinationRepository(f.workspaceId).listMemberships(f.workspaceId, withRange.groupId),
    );
    assert.equal(memberships.length, 2);

    const groupsForJourney = await inRepositoryRead(f.pool, () =>
      new PgCoordinationRepository(f.workspaceId).listGroupsForJourney(f.workspaceId, f.journeyIds[1]),
    );
    assert.deepEqual(groupsForJourney.map((group) => group.id), [withRange.groupId]);

    const updated = mustOk(
      await updateCoordinationGroup(uow, {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorPrincipalId,
        idempotencyKey: randomUUID(),
        groupId: withRange.groupId,
        expectedRevision: 3,
        name: 'Renamed shared scope',
        purpose: null,
        lifecycleStatus: 'ACTIVE',
      }),
    );
    assert.equal(updated.revision, 4);
    const purposeCleared = await f.pool.query<{ purpose: string | null; name: string }>(
      'SELECT name, purpose FROM coordination_groups WHERE workspace_id = $1 AND id = $2',
      [f.workspaceId, withRange.groupId],
    );
    assert.equal(purposeCleared.rows[0]?.name, 'Renamed shared scope');
    assert.equal(purposeCleared.rows[0]?.purpose, null, 'an explicit null clears the business purpose');

    // A group with no declared effective range is not silently treated as
    // covering everything: absence of a coverage claim is UNKNOWN.
    const undated = await createGroup(uow, f, { name: 'No declared range' });
    mustOk(
      await addJourneyToGroup(uow, {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorPrincipalId,
        idempotencyKey: randomUUID(),
        groupId: undated.groupId,
        journeyId: f.journeyIds[0],
        expectedRevision: 1,
      }),
    );
    const undatedCoverage = await coordination.coordinationGroupsCovering(f.workspaceId, MIDDLE);
    assert.ok(!undatedCoverage.some((group) => group.groupId === undated.groupId));
  });

  test('shared item scope links one JourneyItem to one membership, and only its own Journey', async () => {
    const f = await fixture();
    const uow = unitOfWork(f);
    const coordination = new PgCoordinationReadQueries(f.pool, f.workspaceId);
    const group = await createGroup(uow, f, { name: 'Item-sharing scope', effectiveRange: FULL });
    mustOk(
      await addJourneyToGroup(uow, {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorPrincipalId,
        idempotencyKey: randomUUID(),
        groupId: group.groupId,
        journeyId: f.journeyIds[0],
        expectedRevision: 1,
      }),
    );

    const shared = mustOk(
      await shareJourneyItem(uow, {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorPrincipalId,
        idempotencyKey: randomUUID(),
        groupId: group.groupId,
        journeyId: f.journeyIds[0],
        journeyItemId: f.journeyItemIds[0],
        expectedRevision: 2,
      }),
    );
    assert.equal(shared.revision, 3);

    const scoped = await inRepositoryRead(f.pool, () =>
      new PgCoordinationRepository(f.workspaceId).listMemberships(f.workspaceId, group.groupId),
    );
    assert.equal(scoped.length, 1);
    const membership = scoped[0];
    assert.ok(membership, 'the group must carry exactly one membership row');
    assert.deepEqual(membership.scopeItemIds, [f.journeyItemIds[0]]);

    // The read query and the repository are separate statements over the same
    // rows, so they must agree on the identity of the membership that carries
    // the shared item — and only on that item's Journey.
    assert.deepEqual(await coordination.groupsCoveringJourneyItem(f.workspaceId, f.journeyItemIds[0]), [
      { groupId: group.groupId, membershipId: membership.id, journeyId: f.journeyIds[0] },
    ]);
    assert.deepEqual(await coordination.groupsCoveringJourneyItem(f.workspaceId, f.journeyItemIds[1]), []);

    // Adding an item that belongs to a Journey other than this membership's own:
    // 0026's deferred ownership trigger is the guard.
    const foreignItemScope = await commitThatMustFail(f.pool, (client) =>
      client
        .query(
          `INSERT INTO group_membership_items (workspace_id, membership_id, journey_item_id)
           VALUES ($1, $2, $3)`,
          [f.workspaceId, membership.id, f.journeyItemIds[1]],
        )
        .then(() => undefined),
    );
    assert.match(foreignItemScope, /belongs to journey/);

    // Re-sharing the same item through the same membership is a typed duplicate.
    const duplicate = conflictOf(
      await shareJourneyItem(uow, {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorPrincipalId,
        idempotencyKey: randomUUID(),
        groupId: group.groupId,
        journeyId: f.journeyIds[0],
        journeyItemId: f.journeyItemIds[0],
        expectedRevision: 3,
      }),
    );
    assert.equal(duplicate.kind, 'DUPLICATE_REGISTRATION');
    const unchanged = await f.pool.query(
      'SELECT COUNT(*)::int AS total FROM group_membership_items WHERE workspace_id = $1',
      [f.workspaceId],
    );
    assert.equal(unchanged.rows[0]?.['total'], 1);
  });
});

describe('M2 lane S: the requirement governs, the assignment fulfils', () => {
  test('appending edition 2 leaves edition 1 readable and immutable', async () => {
    const f = await fixture();
    const uow = unitOfWork(f);
    const requirementId = randomUUID();
    const support = new PgSupportRepository(f.workspaceId);

    const v1 = await appendRequirement(uow, f, { requirementId, minimumSimultaneousSupporters: 1 });
    assert.equal(v1.version, 1, 'a fresh requirement id opens at edition 1');
    const before = await requirementRow(f.pool, f.workspaceId, requirementId, 1);

    const v2 = await appendRequirement(uow, f, {
      requirementId,
      coverage: { start: at(0), end: at(600) },
      minimumSimultaneousSupporters: 2,
      eligibleSupporterTravellerIds: [...f.supporterIds, f.outsiderId],
      maximumHandoffGapMinutes: 15,
    });
    assert.equal(v2.version, 2);
    assert.equal(v2.requirementId, requirementId);

    assert.equal(await requirementRow(f.pool, f.workspaceId, requirementId, 1), before, 'edition 1 is byte-identical');
    const editions = await inRepositoryRead(f.pool, () => support.listRequirementVersions(f.workspaceId, requirementId));
    assert.deepEqual(editions.map((edition) => edition.version), [1, 2]);
    const latest = await inRepositoryRead(f.pool, () => support.latestRequirementVersion(f.workspaceId, requirementId));
    assert.equal(latest?.version, 2);

    const firstEdition = editions[0];
    assert.ok(firstEdition);
    assert.equal(firstEdition.minimumSimultaneousSupporters, 1, 'the older demand is unchanged, not inherited-forward');
    assert.deepEqual([...firstEdition.eligibleSupporterTravellerIds].sort(), [...f.supporterIds].sort());
    assert.deepEqual(
      [...(editions[1]?.eligibleSupporterTravellerIds ?? [])].sort(),
      [...f.supporterIds, f.outsiderId].sort(),
      'each edition restates its own eligible set',
    );

    // The demand cannot be edited in place at all.
    const updateMessage = await commitThatMustFail(f.pool, async (client) => {
      await client.query(
        `UPDATE accompaniment_requirements SET minimum_simultaneous_supporters = 9
          WHERE workspace_id = $1 AND id = $2 AND version = 1`,
        [f.workspaceId, requirementId],
      );
    });
    assert.match(updateMessage, /append-only/);
    const deleteMessage = await commitThatMustFail(f.pool, async (client) => {
      await client.query(`DELETE FROM accompaniment_requirements WHERE workspace_id = $1 AND id = $2 AND version = 1`, [
        f.workspaceId,
        requirementId,
      ]);
    });
    assert.match(deleteMessage, /append-only/);
    assert.equal(await requirementRow(f.pool, f.workspaceId, requirementId, 1), before);

    // An edition is not an aggregate: 0027 gives it no registry subject, so no
    // head exists for it, and appending one must not move anyone else's counter.
    const headsForRequirement = await f.pool.query(
      'SELECT COUNT(*)::int AS total FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2',
      [f.workspaceId, requirementId],
    );
    assert.equal(headsForRequirement.rows[0]?.['total'], 0, 'a requirement edition advances no aggregate');
    const travellerHead = await f.pool.query(
      'SELECT revision::int AS revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2',
      [f.workspaceId, f.supportedTravellerId],
    );
    assert.equal(travellerHead.rows[0]?.['revision'], 1, "the supported person's counter is not moved by a rule about them");

    const byTraveller = await new PgSupportReadQueries(f.pool, f.workspaceId).requirementsForTraveller(
      f.workspaceId,
      f.supportedTravellerId,
    );
    assert.deepEqual(byTraveller.map((row) => row.version), [1, 2]);
    const inWindow = await new PgSupportReadQueries(f.pool, f.workspaceId).requirementsForTraveller(
      f.workspaceId,
      f.supportedTravellerId,
      { start: at(300), end: at(360) },
    );
    assert.deepEqual(inWindow.map((row) => row.version), [2], 'only edition 2 is widened past minute 240');
    const inBoth = await new PgSupportReadQueries(f.pool, f.workspaceId).requirementsForTraveller(
      f.workspaceId,
      f.supportedTravellerId,
      { start: at(0), end: at(60) },
    );
    assert.deepEqual(inBoth.map((row) => row.version), [1, 2], 'the opening is demanded by both editions');
  });

  test('an ineligible supporter is rejected, and the database rejects it too', async () => {
    const f = await fixture();
    const uow = unitOfWork(f);
    const requirement = await appendRequirement(uow, f, { maximumHandoffGapMinutes: 0 });

    const rejected = conflictOf(
      await createSupportAssignment(uow, {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorPrincipalId,
        idempotencyKey: randomUUID(),
        requirementId: requirement.requirementId,
        requirementVersion: requirement.version,
        assignedSupporterTravellerIds: [f.outsiderId],
        assignedScopes: [{ supporterTravellerId: f.outsiderId, interval: FULL }],
      }),
    );
    assert.equal(rejected.kind, 'REQUIREMENT_WOULD_BE_RELAXED');
    assert.match(rejected.message, /not in the eligible set/);
    assert.ok(reasonList(rejected).length > 0);

    const orphan = randomUUID();
    const heads = await f.pool.query(
      'SELECT COUNT(*)::int AS total FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2',
      [f.workspaceId, orphan],
    );
    assert.equal(heads.rows[0]?.['total'], 0, 'a rejected assignment registers no subject and no head');

    // Behind the handler's back: 0028's deferred consistency assertion is the
    // same rule, so an assignment can never widen its requirement by construction.
    const message = await commitThatMustFail(f.pool, async (client) => {
      const assignmentId = randomUUID();
      await client.query(
        'INSERT INTO aggregate_heads (workspace_id, aggregate_id, revision) VALUES ($1, $2, 1)',
        [f.workspaceId, assignmentId],
      );
      await client.query(
        "INSERT INTO domain_subjects (workspace_id, id, kind, aggregate_id) VALUES ($1, $2, 'SUPPORT_ASSIGNMENT', $2)",
        [f.workspaceId, assignmentId],
      );
      await client.query(
        `INSERT INTO support_assignments
           (workspace_id, id, constraint_definition_id, constraint_definition_version, lifecycle_status, created_by_actor_id)
         VALUES ($1, $2, $3, $4, 'PROPOSED', 'principal:direct-sql')`,
        [f.workspaceId, assignmentId, requirement.requirementId, requirement.version],
      );
      await client.query(
        'INSERT INTO support_assignment_assignees (workspace_id, assignment_id, supporter_traveller_id) VALUES ($1, $2, $3)',
        [f.workspaceId, assignmentId, f.outsiderId],
      );
    });
    assert.match(message, /outside the eligible set/);
  });

  test('coverage gap, minimum simultaneous supporters and handoff gap are the domain verdict verbatim', async () => {
    const f = await fixture();
    const uow = unitOfWork(f);
    const support = new PgSupportRepository(f.workspaceId);
    const requirement = await appendRequirement(uow, f, { maximumHandoffGapMinutes: 0 });
    const definition = await inRepositoryRead(f.pool, () =>
      support.loadRequirement(f.workspaceId, requirement.requirementId, requirement.version),
    );
    assert.ok(definition);

    const satisfying = assignmentShape(requirement.requirementId + ':ok', requirement.requirementId, 1, [
      { supporter: f.supporterIds[0], start: at(0), end: at(240) },
    ]);
    const accepted = mustOk(
      await createSupportAssignment(uow, {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorPrincipalId,
        idempotencyKey: randomUUID(),
        requirementId: requirement.requirementId,
        requirementVersion: requirement.version,
        assignedSupporterTravellerIds: satisfying.assignedSupporterTravellerIds,
        assignedScopes: satisfying.assignedScopes,
      }),
    );
    assert.equal(accepted.revision, 1);
    assert.equal(assignmentSatisfiesDefinition(satisfying, definition).ok, true, 'the control case really satisfies');

    // A half-covered commitment: the gap is a requirement failure, not a
    // permitted relaxation, and the reason text is the domain's own.
    const gapped = assignmentShape('gapped', requirement.requirementId, 1, [
      { supporter: f.supporterIds[0], start: at(0), end: at(120) },
    ]);
    const gapConflict = conflictOf(
      await createSupportAssignment(uow, {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorPrincipalId,
        idempotencyKey: randomUUID(),
        requirementId: requirement.requirementId,
        requirementVersion: requirement.version,
        assignedSupporterTravellerIds: gapped.assignedSupporterTravellerIds,
        assignedScopes: gapped.assignedScopes,
      }),
    );
    const expectedGapReasons = assignmentSatisfiesDefinition(gapped, definition);
    assert.ok(!expectedGapReasons.ok);
    assert.equal(gapConflict.kind, 'REQUIREMENT_WOULD_BE_RELAXED');
    assert.deepEqual(reasonList(gapConflict), expectedGapReasons.reasons);

    // A demand of two simultaneous supporters met by one person.
    const pairRequirement = await appendRequirement(uow, f, {
      coverage: FULL,
      minimumSimultaneousSupporters: 2,
      maximumHandoffGapMinutes: 0,
    });
    const pairDefinition: AccompanimentConstraintDefinition = {
      ...definition,
      id: pairRequirement.requirementId,
      version: pairRequirement.version,
      minimumSimultaneousSupporters: 2,
    };
    const alone = assignmentShape('alone', pairRequirement.requirementId, pairRequirement.version, [
      { supporter: f.supporterIds[0], start: at(0), end: at(240) },
    ]);
    const aloneConflict = conflictOf(
      await createSupportAssignment(uow, {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorPrincipalId,
        idempotencyKey: randomUUID(),
        requirementId: pairRequirement.requirementId,
        requirementVersion: pairRequirement.version,
        assignedSupporterTravellerIds: alone.assignedSupporterTravellerIds,
        assignedScopes: alone.assignedScopes,
      }),
    );
    const expectedAlone = assignmentSatisfiesDefinition(alone, pairDefinition);
    assert.ok(!expectedAlone.ok);
    assert.deepEqual(reasonList(aloneConflict), expectedAlone.reasons);
    assert.ok(
      expectedAlone.reasons.some((reason) => /simultaneous/.test(reason)),
      'the min-count rule is what failed here',
    );

    // The same demand met by two overlapping supporters commits.
    const together = assignmentShape('together', pairRequirement.requirementId, pairRequirement.version, [
      { supporter: f.supporterIds[0], start: at(0), end: at(240) },
      { supporter: f.supporterIds[1], start: at(0), end: at(240) },
    ]);
    assert.equal(assignmentSatisfiesDefinition(together, pairDefinition).ok, true);
    mustOk(
      await createSupportAssignment(uow, {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorPrincipalId,
        idempotencyKey: randomUUID(),
        requirementId: pairRequirement.requirementId,
        requirementVersion: pairRequirement.version,
        assignedSupporterTravellerIds: together.assignedSupporterTravellerIds,
        assignedScopes: together.assignedScopes,
      }),
    );

    const covering = await inRepositoryRead(f.pool, () =>
      support.listAssignmentsForRequirement(f.workspaceId, requirement.requirementId, requirement.version),
    );
    assert.deepEqual(covering.map((row) => row.id), [accepted.assignmentId]);
  });

  test('replacing an assignment scope cannot reduce the requirement', async () => {
    const f = await fixture();
    const uow = unitOfWork(f);
    const support = new PgSupportRepository(f.workspaceId);
    const requirement = await appendRequirement(uow, f, { maximumHandoffGapMinutes: 0 });
    const requirementBefore = await requirementRow(f.pool, f.workspaceId, requirement.requirementId, 1);

    const created = mustOk(
      await createSupportAssignment(uow, {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorPrincipalId,
        idempotencyKey: randomUUID(),
        requirementId: requirement.requirementId,
        requirementVersion: requirement.version,
        assignedSupporterTravellerIds: [f.supporterIds[0]],
        assignedScopes: [{ supporterTravellerId: f.supporterIds[0], interval: FULL }],
      }),
    );

    const shrink = conflictOf(
      await replaceSupportAssignmentScope(uow, {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorPrincipalId,
        idempotencyKey: randomUUID(),
        assignmentId: created.assignmentId,
        expectedRevision: 1,
        assignedSupporterTravellerIds: [f.supporterIds[0]],
        assignedScopes: [{ supporterTravellerId: f.supporterIds[0], interval: { start: at(0), end: at(120) } }],
      }),
    );
    assert.equal(shrink.kind, 'REQUIREMENT_WOULD_BE_RELAXED');
    assert.equal(await requirementRow(f.pool, f.workspaceId, requirement.requirementId, 1), requirementBefore);

    const unchangedPin = await inRepositoryRead(f.pool, () =>
      support.loadAssignment(f.workspaceId, created.assignmentId),
    );
    assert.ok(unchangedPin);
    assert.equal(unchangedPin.constraintDefinitionId, requirement.requirementId);
    assert.equal(unchangedPin.constraintDefinitionVersion, 1);
    assert.deepEqual(unchangedPin.assignedScopes, [{ supporterTravellerId: f.supporterIds[0], interval: FULL }]);
    assert.equal(unchangedPin.revision, 1, 'a rejected replacement moves no revision');

    // Re-choosing the fulfilment is allowed: two supporters hand over exactly at
    // the boundary, so the same pinned edition is still met.
    const replaced = mustOk(
      await replaceSupportAssignmentScope(uow, {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorPrincipalId,
        idempotencyKey: randomUUID(),
        assignmentId: created.assignmentId,
        expectedRevision: 1,
        assignedSupporterTravellerIds: [...f.supporterIds],
        assignedScopes: [
          { supporterTravellerId: f.supporterIds[0], interval: { start: at(0), end: at(120) } },
          { supporterTravellerId: f.supporterIds[1], interval: { start: at(120), end: at(240) } },
        ],
        handoffs: [
          {
            fromSupporterTravellerId: f.supporterIds[0],
            toSupporterTravellerId: f.supporterIds[1],
            handoffAt: at(120),
          },
        ],
      }),
    );
    assert.equal(replaced.revision, 2);
    assert.equal(replaced.requirementVersion, 1, 'the pin is still edition 1');

    const after = await inRepositoryRead(f.pool, () => support.loadAssignment(f.workspaceId, created.assignmentId));
    assert.ok(after);
    assert.equal(after.constraintDefinitionVersion, 1);
    assert.deepEqual(
      [...after.assignedSupporterTravellerIds].sort(),
      [...f.supporterIds].sort(),
      'the assignee children were replaced, not merged with the old ones',
    );
    assert.equal(after.assignedScopes.length, 2);
    assert.equal(after.handoffs.length, 1);
    assert.equal(await requirementRow(f.pool, f.workspaceId, requirement.requirementId, 1), requirementBefore);
  });

  test('a handoff honours the maximum gap and is readable as a continuation obligation', async () => {
    const f = await fixture();
    const uow = unitOfWork(f);
    const requirement = await appendRequirement(uow, f, { maximumHandoffGapMinutes: 30 });
    const definition = await inRepositoryRead(f.pool, () =>
      new PgSupportRepository(f.workspaceId).loadRequirement(f.workspaceId, requirement.requirementId, 1),
    );
    assert.ok(definition);

    const withinGap = assignmentShape(
      'within-gap',
      requirement.requirementId,
      1,
      [
        { supporter: f.supporterIds[0], start: at(0), end: at(120) },
        { supporter: f.supporterIds[1], start: at(135), end: at(240) },
      ],
      [
        {
          fromSupporterTravellerId: f.supporterIds[0],
          toSupporterTravellerId: f.supporterIds[1],
          handoffAt: at(135),
        },
      ],
    );
    const accepted: SupportAssignmentCommandResult = mustOk(
      await createSupportAssignment(uow, {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorPrincipalId,
        idempotencyKey: randomUUID(),
        requirementId: requirement.requirementId,
        requirementVersion: 1,
        assignedSupporterTravellerIds: withinGap.assignedSupporterTravellerIds,
        assignedScopes: withinGap.assignedScopes,
        handoffs: [
          {
            fromSupporterTravellerId: f.supporterIds[0],
            toSupporterTravellerId: f.supporterIds[1],
            handoffAt: at(135),
          },
        ],
      }),
    );
    assert.equal(assignmentSatisfiesDefinition(withinGap, definition).ok, true);

    const handoffs = await new PgSupportReadQueries(f.pool, f.workspaceId).handoffsReceivedBy(
      f.workspaceId,
      f.supporterIds[1],
      at(0),
    );
    assert.deepEqual(handoffs, [
      {
        assignmentId: accepted.assignmentId,
        fromSupporterTravellerId: f.supporterIds[0],
        handoffAt: at(135),
      },
    ]);
    assert.deepEqual(
      await new PgSupportReadQueries(f.pool, f.workspaceId).handoffsReceivedBy(f.workspaceId, f.supporterIds[0], at(0)),
      [],
      'the outgoing supporter received nothing',
    );
    assert.deepEqual(
      await new PgSupportReadQueries(f.pool, f.workspaceId).handoffsReceivedBy(f.workspaceId, f.supporterIds[1], at(200)),
      [],
      'the `from` bound excludes an earlier handoff',
    );

    const beyondGap = assignmentShape(
      'beyond-gap',
      requirement.requirementId,
      1,
      [
        { supporter: f.supporterIds[0], start: at(0), end: at(120) },
        { supporter: f.supporterIds[1], start: at(170), end: at(240) },
      ],
      [
        {
          fromSupporterTravellerId: f.supporterIds[0],
          toSupporterTravellerId: f.supporterIds[1],
          handoffAt: at(170),
        },
      ],
    );
    const rejected = conflictOf(
      await createSupportAssignment(uow, {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorPrincipalId,
        idempotencyKey: randomUUID(),
        requirementId: requirement.requirementId,
        requirementVersion: 1,
        assignedSupporterTravellerIds: beyondGap.assignedSupporterTravellerIds,
        assignedScopes: beyondGap.assignedScopes,
        handoffs: beyondGap.handoffs,
      }),
    );
    const expected = assignmentSatisfiesDefinition(beyondGap, definition);
    assert.ok(!expected.ok);
    assert.deepEqual(reasonList(rejected), expected.reasons);
    assert.ok(expected.reasons.some((reason) => /handoff gap exceeds/.test(reason)));

    // What the database guarantees about a handoff. The permitted minute gap is
    // deliberately not one of them — 0028's own comment leaves that arithmetic to
    // the domain, so `maximum_handoff_gap_minutes` is guarded only by
    // `assignmentSatisfiesDefinition` above (reported as a schema gap). The DDL
    // does guarantee that both sides of a handoff are assignees of the very
    // assignment carrying it, and that nobody hands off to themselves.
    const outsiderHandoff = await commitThatMustFail(f.pool, (client) =>
      client
        .query(
          `INSERT INTO support_assignment_handoffs
             (workspace_id, assignment_id, from_supporter_traveller_id, to_supporter_traveller_id, handoff_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [f.workspaceId, accepted.assignmentId, f.supporterIds[0], f.outsiderId, at(135)],
        )
        .then(() => undefined),
    );
    assert.match(outsiderHandoff, /support_assignment_handoffs_to_assignee_fk/);
    const selfHandoff = await commitThatMustFail(f.pool, (client) =>
      client
        .query(
          `INSERT INTO support_assignment_handoffs
             (workspace_id, assignment_id, from_supporter_traveller_id, to_supporter_traveller_id, handoff_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [f.workspaceId, accepted.assignmentId, f.supporterIds[0], f.supporterIds[0], at(135)],
        )
        .then(() => undefined),
    );
    assert.match(selfHandoff, /support_assignment_handoffs_not_self/);
    const handoffRows = await f.pool.query(
      'SELECT COUNT(*)::int AS total FROM support_assignment_handoffs WHERE workspace_id = $1',
      [f.workspaceId],
    );
    assert.equal(handoffRows.rows[0]?.['total'], 1, 'both rejected attempts left no row behind');
  });

  test('a supporter committed scopes come back per segment and respect excluded statuses', async () => {
    const f = await fixture();
    const uow = unitOfWork(f);
    const queries = new PgSupportReadQueries(f.pool, f.workspaceId);
    const requirement = await appendRequirement(uow, f, { eligibleSupporterTravellerIds: [f.supporterIds[0]] });
    const created: SupportAssignmentCommandResult = mustOk(
      await createSupportAssignment(uow, {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorPrincipalId,
        idempotencyKey: randomUUID(),
        requirementId: requirement.requirementId,
        requirementVersion: 1,
        assignedSupporterTravellerIds: [f.supporterIds[0]],
        // Two adjacent segments of one journey: partial-route support is stored
        // as separate segments and must never be folded together on read.
        assignedScopes: [
          { supporterTravellerId: f.supporterIds[0], interval: { start: at(0), end: at(120) } },
          { supporterTravellerId: f.supporterIds[0], interval: { start: at(120), end: at(240) } },
        ],
      }),
    );

    const proposed = await queries.supportScopesForTravellerInWindow(f.workspaceId, f.supporterIds[0], FULL);
    assert.equal(proposed.length, 2, 'adjacent segments stay two rows');
    assert.deepEqual(
      proposed.map((row) => [row.scope.start, row.scope.end]),
      [
        [at(0), at(120)],
        [at(120), at(240)],
      ],
    );
    for (const row of proposed) {
      assert.equal(row.assignmentId, created.assignmentId);
      assert.equal(row.requirementId, requirement.requirementId);
      assert.equal(row.requirementVersion, 1);
      assert.equal(row.assignmentStatus, 'PROPOSED');
    }
    const secondHalf = await queries.supportScopesForTravellerInWindow(f.workspaceId, f.supporterIds[0], {
      start: at(200),
      end: at(240),
    });
    assert.deepEqual(secondHalf.map((row) => [row.scope.start, row.scope.end]), [[at(120), at(240)]]);

    assert.deepEqual(
      await queries.supportScopesForTravellerInWindow(f.workspaceId, f.supporterIds[0], FULL, {
        excludeStatuses: ['PROPOSED'],
      }),
      [],
      'a proposal is not a commitment',
    );

    const activated = mustOk(
      await setSupportAssignmentStatus(uow, {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorPrincipalId,
        idempotencyKey: randomUUID(),
        assignmentId: created.assignmentId,
        lifecycleStatus: 'ACTIVE',
        expectedRevision: 1,
      }),
    );
    assert.equal(activated.revision, 2);
    assert.equal(activated.lifecycleStatus, 'ACTIVE');

    const active = await queries.supportScopesForTravellerInWindow(f.workspaceId, f.supporterIds[0], FULL, {
      excludeStatuses: ['PROPOSED'],
    });
    assert.equal(active.length, 2);
    assert.equal(active[0]?.assignmentStatus, 'ACTIVE');
    assert.deepEqual(
      await queries.supportScopesForTravellerInWindow(f.workspaceId, f.supporterIds[0], FULL, {
        excludeStatuses: ['ACTIVE', 'SUPERSEDED', 'WITHDRAWN'],
      }),
      [],
    );

    const eligibleForSupporter = await queries.requirementsEligibleForSupporter(f.workspaceId, f.supporterIds[0]);
    assert.deepEqual(eligibleForSupporter.map((row) => row.requirementId), [requirement.requirementId]);
    assert.deepEqual(await queries.requirementsEligibleForSupporter(f.workspaceId, f.outsiderId), []);
  });
});

describe('M2 lane S: concurrency, kind discrimination and the absent support boolean', () => {
  test('the support model carries no boolean support claim', async () => {
    const f = await fixture();
    const offenders = await f.pool.query<{ table_name: string; column_name: string; data_type: string }>(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public'
          AND NOT (table_name = 'provider_capabilities' AND column_name = 'supported')
          AND (column_name IN ('is_supported', 'supported', 'has_support', 'support_confirmed')
               OR (data_type = 'boolean' AND column_name ~* 'support'))
        ORDER BY table_name, column_name`,
    );
    assert.deepEqual(offenders.rows, [], 'support is always a named requirement over named people on named intervals');

    const requirementColumns = await f.pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'accompaniment_requirements'
        ORDER BY column_name`,
    );
    assert.deepEqual(
      requirementColumns.rows.map((row) => row.column_name),
      [
        'accepted_at',
        'coverage_end',
        'coverage_start',
        'created_by_actor_id',
        'id',
        'maximum_handoff_gap_minutes',
        'minimum_simultaneous_supporters',
        'provenance_evidence_id',
        'supported_traveller_id',
        'version',
        'workspace_id',
      ],
      '0027 is the whole column list: no status, no verdict, no support flag',
    );

    const assignmentColumns = await f.pool.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'support_assignments'
        ORDER BY column_name`,
    );
    assert.ok(assignmentColumns.rows.length > 0);
    assert.deepEqual(
      assignmentColumns.rows.filter((row) => row.data_type === 'boolean').map((row) => row.column_name),
      [],
      '0028 carries no boolean at all',
    );
  });

  test('the reverse-lookup access paths named by the read contracts exist', async () => {
    const f = await fixture();
    const named = [
      'idx_coordination_groups_effective',
      'idx_group_memberships_group_window',
      'idx_group_membership_items_item',
      'idx_accompaniment_requirements_supported',
      'idx_accompaniment_eligible_supporters_traveller',
      'idx_support_assignment_scopes_traveller_window',
      'idx_support_assignment_handoffs_to',
    ];
    const indexes = await f.pool.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = ANY($1::text[])`,
      [named],
    );
    assert.deepEqual(
      indexes.rows.map((row) => row.indexname).sort(),
      [...named].sort(),
      'every index lane S reads through must be installed',
    );
    for (const row of indexes.rows) {
      assert.match(row.indexdef, /workspace_id/, `${row.indexname} must stay workspace-scoped`);
    }
  });

  test('a right-id/wrong-kind reference is a miss, not a match (C1 a)', async () => {
    const f = await fixture();
    const uow = unitOfWork(f);
    const group = await createGroup(uow, f, { name: 'Kind discriminator' });

    // The id exists and owns a head; only the kind is wrong.
    const conflict = conflictOf(
      await setSupportAssignmentStatus(uow, {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorPrincipalId,
        idempotencyKey: randomUUID(),
        assignmentId: group.groupId,
        lifecycleStatus: 'ACTIVE',
        expectedRevision: 1,
      }),
    );
    assert.equal(conflict.kind, 'STALE_AGGREGATE_REVISION');
    assert.deepEqual(conflict.subjectRefs, [{ kind: 'SUPPORT_ASSIGNMENT', id: group.groupId }]);

    const groupHead = await f.pool.query(
      'SELECT revision::int AS revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2',
      [f.workspaceId, group.groupId],
    );
    assert.equal(groupHead.rows[0]?.['revision'], 1, 'the group counter is untouched');
    const strayAssignment = await f.pool.query(
      'SELECT COUNT(*)::int AS total FROM support_assignments WHERE workspace_id = $1 AND id = $2',
      [f.workspaceId, group.groupId],
    );
    assert.equal(strayAssignment.rows[0]?.['total'], 0);

    const subjectKind = await f.pool.query<{ kind: string }>(
      'SELECT kind FROM domain_subjects WHERE workspace_id = $1 AND id = $2',
      [f.workspaceId, group.groupId],
    );
    assert.equal(subjectKind.rows[0]?.kind, 'COORDINATION_GROUP');

    // A registry row whose kind claims a subtype table it has no row in fails
    // closed at COMMIT, independently of any application check.
    const message = await commitThatMustFail(f.pool, async (client) => {
      const orphanId = randomUUID();
      await client.query(
        'INSERT INTO aggregate_heads (workspace_id, aggregate_id, revision) VALUES ($1, $2, 1)',
        [f.workspaceId, orphanId],
      );
      await client.query(
        "INSERT INTO domain_subjects (workspace_id, id, kind, aggregate_id) VALUES ($1, $2, 'SUPPORT_ASSIGNMENT', $2)",
        [f.workspaceId, orphanId],
      );
    });
    assert.match(message, /domain_subjects subtype violation/);
  });

  test('a stale expected revision conflicts and changes nothing', async () => {
    const f = await fixture();
    const uow = unitOfWork(f);
    const support = new PgSupportRepository(f.workspaceId);
    const requirement = await appendRequirement(uow, f, { maximumHandoffGapMinutes: 0 });
    const created = mustOk(
      await createSupportAssignment(uow, {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorPrincipalId,
        idempotencyKey: randomUUID(),
        requirementId: requirement.requirementId,
        requirementVersion: 1,
        assignedSupporterTravellerIds: [f.supporterIds[0]],
        assignedScopes: [{ supporterTravellerId: f.supporterIds[0], interval: FULL }],
      }),
    );
    mustOk(
      await setSupportAssignmentStatus(uow, {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorPrincipalId,
        idempotencyKey: randomUUID(),
        assignmentId: created.assignmentId,
        lifecycleStatus: 'ACTIVE',
        expectedRevision: 1,
      }),
    );

    const stale = conflictOf(
      await setSupportAssignmentStatus(uow, {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorPrincipalId,
        idempotencyKey: randomUUID(),
        assignmentId: created.assignmentId,
        lifecycleStatus: 'SUPERSEDED',
        expectedRevision: 1,
      }),
    );
    assert.equal(stale.kind, 'STALE_AGGREGATE_REVISION');

    const current = await inRepositoryRead(f.pool, () => support.loadAssignment(f.workspaceId, created.assignmentId));
    assert.equal(current?.lifecycleStatus, 'ACTIVE', 'the rejected transition left the lifecycle alone');
    assert.equal(current?.revision, 2, 'exactly one advance committed');
    const audit = await f.pool.query(
      `SELECT COUNT(*)::int AS total FROM change_records
        WHERE workspace_id = $1 AND subject_kind = 'SUPPORT_ASSIGNMENT' AND subject_id = $2`,
      [f.workspaceId, created.assignmentId],
    );
    assert.equal(audit.rows[0]?.['total'], 2, 'creation and the one accepted status change, nothing more');
    const receipts = await f.pool.query(
      'SELECT COUNT(*)::int AS total FROM command_receipts WHERE workspace_id = $1',
      [f.workspaceId],
    );
    assert.ok((receipts.rows[0]?.['total'] ?? 0) >= 2);

    // Illegal lifecycle moves are refused even with a correct revision: a
    // superseded assignment cannot quietly become live again.
    mustOk(
      await setSupportAssignmentStatus(uow, {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorPrincipalId,
        idempotencyKey: randomUUID(),
        assignmentId: created.assignmentId,
        lifecycleStatus: 'WITHDRAWN',
        expectedRevision: 2,
      }),
    );
    const resurrected = conflictOf(
      await setSupportAssignmentStatus(uow, {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorPrincipalId,
        idempotencyKey: randomUUID(),
        assignmentId: created.assignmentId,
        lifecycleStatus: 'ACTIVE',
        expectedRevision: 3,
      }),
    );
    assert.equal(resurrected.kind, 'VALIDATION_FAILED');
    assert.match(resurrected.message, /illegal support assignment lifecycle transition/);
  });
});

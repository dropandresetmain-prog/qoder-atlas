/**
 * NORTHSTAR M2 lane P — people, governance, credential and authority commands
 * against real PostgreSQL.
 *
 * Evidence this file exists to produce:
 *  1. a Traveller identity is registered *atomically*: one command writes the
 *     aggregate head, the registry row, the typed `travellers` row and its first
 *     name edition, and no step is observable on its own;
 *  2. identity, name history, contact history, profile assertions and travel
 *     history are four separate concerns — none of them rewrites the person, and
 *     a protected contact has no column that could hold the raw value;
 *  3. credentials are Traveller-owned, versioned documents whose edition numbers
 *     are derived by the database, whose superseded editions the database itself
 *     refuses to mutate, and whose typed detail row is kind-bound;
 *  4. F05 holds in SQL, not just in the handler: a relationship and a
 *     responsibility write zero `authority_grants`/`grant_actions`/`grant_scopes`
 *     rows, and a grant is the only writer of those tables;
 *  5. authority is a closed vocabulary — an action kind the registry does not
 *     know can never be granted, and `mayPrincipalAct` turns false on revocation;
 *  6. C1 (a) and (c): a right-id/wrong-kind TypedRef is rejected, and an
 *     idempotent replay returns the stored result instead of re-running;
 *  7. revision CAS, cross-workspace UUID invisibility and the `PARTIAL` vs
 *     `WINDOW_COMPLETE` coverage claim round-trip through the read queries.
 *
 * Every fixture uses a fresh workspace (`beginSeed`) and never deletes rows it
 * did not insert: the PostgreSQL test database is shared with sibling M2 lanes.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed, seedTraveller } from './m2Seed.ts';
import { PgUnitOfWork, type ExecuteFn, type ExecuteOutcome } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { currentTransactionClient, runWithTransactionClient } from '../src/persistence/postgres/transactionContext.ts';
import type { UnitOfWork } from '../src/contracts/v2/command/unitOfWork.ts';
import type { DomainCommandEnvelope } from '../src/contracts/v2/command/domainCommand.ts';
import { PgTravellerRepository } from '../src/persistence/postgres/repositories/pgTravellerRepository.ts';
import { PgGovernanceRepository } from '../src/persistence/postgres/repositories/pgGovernanceRepository.ts';
import { PgSubjectRegistryReadQueries } from '../src/persistence/postgres/queries/pgSubjectRegistryReadQueries.ts';
import { PgTravellerFactsReadQueries } from '../src/persistence/postgres/queries/pgTravellerFactsReadQueries.ts';
import { PgCredentialReadQueries } from '../src/persistence/postgres/queries/pgCredentialReadQueries.ts';
import { PgGovernanceReadQueries } from '../src/persistence/postgres/queries/pgGovernanceReadQueries.ts';
import {
  addTravellerContact,
  addTravellerName,
  appendCredentialVersion,
  appendProfileAssertion,
  assignResponsibility,
  createOrganisation,
  createPrincipal,
  issueAuthorityGrant,
  linkCredentials,
  mergeTraveller,
  recordTravelHistory,
  recordTraveller,
  recordTravellerRelationship,
  revokeAuthorityGrant,
  type AuthorityGrantIssuedResult,
  type TravellerRecordedResult,
} from '../src/persistence/postgres/commands/peopleCommands.ts';
import type { ProtectedDataRef, TypedRef } from '../src/domain/v2/shared/identity.ts';
import type { TypedConflict } from '../src/domain/v2/shared/errors.ts';

/**
 * Generic clock and calendar. No scenario, city, supplier or demo date appears
 * anywhere in this file; dates are offsets from one arbitrary instant.
 */
const T0 = Date.UTC(2030, 0, 1);
const at = (minutes: number): string => new Date(T0 + minutes * 60_000).toISOString();
const day = (days: number): string => new Date(T0 + days * 86_400_000).toISOString().slice(0, 10);
const OPEN_RANGE = { start: day(0) };
/** A sentinel the raw value could plausibly be stored under; it never may be. */
const PROTECTED_SENTINEL = 'sentinel-address-never-stored';

const PROTECTED: ProtectedDataRef = {
  contentHash: 'b'.repeat(64),
  storageRef: 'vault://m2-people/protected-1',
  accessPolicyId: 'policy:m2-people',
};
const OTHER_PROTECTED: ProtectedDataRef = {
  contentHash: 'c'.repeat(64),
  storageRef: 'vault://m2-people/protected-2',
  accessPolicyId: 'policy:m2-people',
};

interface Fixture {
  pool: Pool;
  workspaceId: string;
  actorId: string;
  /** Monotonic per fixture so two commands in one test never share a key. */
  seq: { value: number };
}

/** A workspace with nothing in it but the partition row. */
async function bareFixture(): Promise<Fixture> {
  const pool = await sharedTestPool();
  const seed = await beginSeed(pool);
  await commitSeed(seed);
  return { pool, workspaceId: seed.workspaceId, actorId: seed.actorId, seq: { value: 0 } };
}

interface PeopleFixture extends Fixture {
  /** Three already-registered people, so relationship/credential tests start from identity. */
  travellerIds: [string, string, string];
  organisationId: string;
  principalId: string;
  issuedByPrincipalId: string;
}

/**
 * The graph lane P reads through: Travellers seeded by SQL, the Organisation and
 * the two Principals created through their own commands, so those handlers are
 * exercised before anything that depends on them.
 *
 * The three people must share this fixture's workspace, so they are seeded in
 * one `beginSeed` session that owns that workspace row and committed before any
 * command runs — `beginSeed` mints a *new* workspace each time, so it can never
 * be called again just to add people to the same one.
 */
async function peopleFixture(): Promise<PeopleFixture> {
  const pool = await sharedTestPool();
  const seed = await beginSeed(pool);
  const first = await seedTraveller(seed);
  const second = await seedTraveller(seed);
  const third = await seedTraveller(seed);
  await commitSeed(seed);

  const base: Fixture = {
    pool,
    workspaceId: seed.workspaceId,
    actorId: seed.actorId,
    seq: { value: 0 },
  };
  const uow = new PgUnitOfWork(base.pool, base.workspaceId);
  const organisationId = randomUUID();
  const principalId = randomUUID();
  const issuedByPrincipalId = randomUUID();

  const organisation = mustOk(
    await createOrganisation(uow, {
      workspaceId: base.workspaceId,
      actorPrincipalId: base.actorId,
      idempotencyKey: nextKey(base),
      organisationId,
      legalName: 'Seed Organiser Co',
      defaultCurrencyCode: 'NZD',
    }),
  );
  const principal = mustOk(
    await createPrincipal(uow, {
      workspaceId: base.workspaceId,
      actorPrincipalId: base.actorId,
      idempotencyKey: nextKey(base),
      principalId,
      actorType: 'HUMAN',
      authIssuer: 'https://issuer.invalid/m2-people',
      authSubject: principalId,
    }),
  );
  const issuer = mustOk(
    await createPrincipal(uow, {
      workspaceId: base.workspaceId,
      actorPrincipalId: base.actorId,
      idempotencyKey: nextKey(base),
      principalId: issuedByPrincipalId,
      actorType: 'SERVICE',
      authIssuer: 'https://issuer.invalid/m2-people',
      authSubject: issuedByPrincipalId,
    }),
  );
  assert.equal(organisation.revision, 1);
  assert.equal(principal.revision, 1);
  assert.equal(issuer.revision, 1);

  return {
    ...base,
    travellerIds: [first.travellerId, second.travellerId, third.travellerId],
    organisationId,
    principalId,
    issuedByPrincipalId,
  };
}

function nextKey(f: Fixture): string {
  f.seq.value += 1;
  return `m2-people:${f.workspaceId.slice(0, 8)}:${f.seq.value}`;
}

function unitOfWork(f: Fixture): PgUnitOfWork {
  return new PgUnitOfWork(f.pool, f.workspaceId);
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

/** Repository reads need the ambient transaction; they are read-only, so it rolls back. */
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

async function scalar<T extends Record<string, unknown>>(
  pool: Pool,
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  const result = await pool.query<T>(sql, params);
  const row = result.rows[0];
  if (row === undefined) assert.fail('expected exactly one row');
  return row;
}

async function count(pool: Pool, sql: string, params: unknown[] = []): Promise<number> {
  const row = await scalar<{ n: number | string }>(pool, sql, params);
  return Number(row.n);
}

/** Runs statements on one connection and requires the write to be rejected. */
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
    client.release();
  }
}

/** The mirror of `commitThatMustFail`: a write that must survive COMMIT, deferred constraints included. */
async function commitWrite(pool: Pool, run: (client: PoolClient) => Promise<void>): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    try {
      await run(client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  } finally {
    client.release();
  }
}

const travellerRef = (id: string): TypedRef => ({ kind: 'TRAVELLER', id });

/** Current revision of one aggregate root, so a caller can pin `expectedRevision`. */
async function headRevision(pool: Pool, workspaceId: string, aggregateId: string): Promise<number> {
  const row = await scalar<{ revision: string }>(
    pool,
    'SELECT revision::text AS revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2',
    [workspaceId, aggregateId],
  );
  return Number(row.revision);
}

/**
 * A `UnitOfWork` that lets a command run on a real `PgUnitOfWork` but aborts the
 * *first* attempt with a genuine server-raised `40001`, after the handler's own
 * writes. `PgUnitOfWork` retries the whole transaction, so the second attempt
 * re-runs the same callback from scratch — the situation C1 (c) exists to make
 * safe. `attempts` proves the retry actually fired rather than the command
 * having succeeded on a first pass that never conflicted.
 */
function forcingSerializationConflictOnce(
  inner: PgUnitOfWork,
  probe: { attempts: number },
): UnitOfWork {
  let armed = true;
  return {
    heads: inner.heads,
    idempotency: inner.idempotency,
    scopes: inner.scopes,
    async execute<T>(envelope: DomainCommandEnvelope, fn: ExecuteFn<T>): Promise<ExecuteOutcome<T>> {
      return inner.execute<T>(envelope, async (ctx) => {
        probe.attempts += 1;
        const outcome = await fn(ctx);
        if (armed) {
          armed = false;
          await currentTransactionClient().query(
            "DO $$ BEGIN RAISE EXCEPTION 'forced serialization' USING ERRCODE = '40001'; END $$;",
          );
        }
        return outcome;
      });
    },
  };
}

// ---------------------------------------------------------------------------
// 1. Identity registration is atomic
// ---------------------------------------------------------------------------

describe('M2 lane P: a Traveller identity is registered in one atomic step', () => {
  test('one command writes head, registry row, typed row and first name edition together', async () => {
    const f = await bareFixture();
    const travellerId = randomUUID();
    const displayNameId = randomUUID();

    const result = mustOk(
      await recordTraveller(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        travellerId,
        displayName: {
          id: displayNameId,
          nameKind: 'DISPLAY',
          displayValue: 'A. Person',
          effectiveRange: { start: day(-4000) },
          evidenceId: randomUUID(),
        },
      }),
    );
    assert.equal(result.travellerId, travellerId);
    assert.equal(result.displayNameId, displayNameId);
    assert.equal(result.revision, 1);

    const registry = await scalar<{ kind: string; aggregate_id: string }>(
      f.pool,
      'SELECT kind, aggregate_id FROM domain_subjects WHERE workspace_id = $1 AND id = $2',
      [f.workspaceId, travellerId],
    );
    assert.equal(registry.kind, 'TRAVELLER');
    assert.equal(registry.aggregate_id, travellerId, 'a root owns an aggregate keyed by its own id');

    const head = await scalar<{ revision: number }>(
      f.pool,
      'SELECT revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2',
      [f.workspaceId, travellerId],
    );
    assert.equal(Number(head.revision), 1);

    const typed = await scalar<{ display_name_ref: string; lifecycle_status: string; created_by_actor_id: string }>(
      f.pool,
      'SELECT display_name_ref, lifecycle_status, created_by_actor_id FROM travellers WHERE workspace_id = $1 AND id = $2',
      [f.workspaceId, travellerId],
    );
    assert.equal(typed.display_name_ref, displayNameId);
    assert.equal(typed.lifecycle_status, 'ACTIVE');
    assert.equal(typed.created_by_actor_id, f.actorId);

    assert.equal(
      await count(f.pool, 'SELECT count(*) AS n FROM traveller_names WHERE workspace_id = $1 AND traveller_id = $2', [
        f.workspaceId,
        travellerId,
      ]),
      1,
    );
    assert.equal(
      await count(
        f.pool,
        `SELECT count(*) AS n FROM change_records
          WHERE workspace_id = $1 AND subject_kind = 'TRAVELLER' AND subject_id = $2`,
        [f.workspaceId, travellerId],
      ),
      1,
    );
    assert.equal(
      await count(
        f.pool,
        `SELECT count(*) AS n FROM outbox
          WHERE workspace_id = $1 AND destination_kind = 'TRAVELLER_IDENTITY_REGISTERED'`,
        [f.workspaceId],
      ),
      1,
    );
  });

  test('the same person id cannot be registered twice under a fresh idempotency key', async () => {
    const f = await bareFixture();
    const travellerId = randomUUID();
    const name = {
      nameKind: 'DISPLAY' as const,
      displayValue: 'A. Person',
      effectiveRange: OPEN_RANGE,
      evidenceId: randomUUID(),
    };
    mustOk(
      await recordTraveller(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        travellerId,
        displayName: name,
      }),
    );

    const conflict = conflictOf(
      await recordTraveller(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        travellerId,
        displayName: name,
      }),
    );
    assert.equal(conflict.kind, 'DUPLICATE_REGISTRATION');
    assert.match(conflict.message, /already/);
    assert.equal(
      await count(f.pool, 'SELECT count(*) AS n FROM travellers WHERE workspace_id = $1', [f.workspaceId]),
      1,
      'a rejected registration must leave one person, not two',
    );
  });

  test('a person is never created without its name edition (C1 b through the handler)', async () => {
    const f = await bareFixture();
    const travellerId = randomUUID();
    const outcome = await recordTraveller(unitOfWork(f), {
      workspaceId: f.workspaceId,
      actorPrincipalId: f.actorId,
      idempotencyKey: nextKey(f),
      travellerId,
      displayName: {
        nameKind: 'DISPLAY',
        displayValue: '',
        effectiveRange: OPEN_RANGE,
        evidenceId: randomUUID(),
      },
    });
    assert.equal(conflictOf(outcome).kind, 'VALIDATION_FAILED');
    assert.equal(
      await count(
        f.pool,
        'SELECT count(*) AS n FROM domain_subjects WHERE workspace_id = $1 AND id = $2',
        [f.workspaceId, travellerId],
      ),
      0,
      'nothing may reach the registry when the payload is invalid',
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Identity is stable; its attributes are versioned around it
// ---------------------------------------------------------------------------

describe('M2 lane P: name, contact, assertion and history editions never rewrite the person', () => {
  test('a later name edition appends a row and leaves the display pointer alone', async () => {
    const f = await bareFixture();
    const created = mustOk(
      await recordTraveller(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        displayName: {
          nameKind: 'DISPLAY',
          displayValue: 'Known As',
          effectiveRange: OPEN_RANGE,
          evidenceId: randomUUID(),
        },
      }),
    );

    const added = mustOk(
      await addTravellerName(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        travellerId: created.travellerId,
        expectedRevision: 1,
        name: {
          nameKind: 'LEGAL',
          displayValue: 'Full Legal Name',
          familyName: 'Name',
          givenName: 'Full',
          effectiveRange: OPEN_RANGE,
          evidenceId: randomUUID(),
        },
      }),
    );
    assert.equal(added.revision, 2, 'name history is an edition on the person aggregate');

    const names = await inRepositoryRead(f.pool, () =>
      new PgTravellerRepository(f.workspaceId).listNames(f.workspaceId, created.travellerId),
    );
    assert.deepEqual(
      names.map((name) => name.nameKind).sort(),
      ['DISPLAY', 'LEGAL'],
    );
    const pointer = await scalar<{ display_name_ref: string }>(
      f.pool,
      'SELECT display_name_ref FROM travellers WHERE workspace_id = $1 AND id = $2',
      [f.workspaceId, created.travellerId],
    );
    assert.equal(
      pointer.display_name_ref,
      created.displayNameId,
      'appending a name edition is not an intent to change which one is displayed',
    );
  });

  test('a contact stores only the ProtectedDataRef triple and a renderable mask', async () => {
    const f = await bareFixture();
    const created = mustOk(
      await recordTraveller(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        displayName: {
          nameKind: 'DISPLAY',
          displayValue: 'Known As',
          effectiveRange: OPEN_RANGE,
          evidenceId: randomUUID(),
        },
        contacts: [
          {
            channel: 'EMAIL',
            maskedLabel: 'a***@example.invalid',
            protectedValue: PROTECTED,
            effectiveRange: OPEN_RANGE,
            evidenceId: randomUUID(),
          },
        ],
      }),
    );

    const contacts = await inRepositoryRead(f.pool, () =>
      new PgTravellerRepository(f.workspaceId).listContacts(f.workspaceId, created.travellerId),
    );
    assert.equal(contacts.length, 1);
    const contact = contacts[0];
    if (contact === undefined) assert.fail('expected one contact');
    assert.deepEqual(contact.protectedValue, PROTECTED);
    assert.equal(contact.maskedLabel, 'a***@example.invalid');

    // The target model has no column that could hold the value itself.
    const columns = await scalar<{ cols: string[] }>(
      f.pool,
      `SELECT array_agg(column_name::text ORDER BY column_name) AS cols
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'traveller_contacts'`,
      [],
    );
    assert.ok(
      columns.cols.every((column) => !/(^|_)(raw|plain|value_text|email|phone|address)(_|$)/.test(column)),
      `traveller_contacts must not gain a plaintext value column, got ${columns.cols.join(',')}`,
    );
    assert.deepEqual(
      columns.cols.filter((column) => column.startsWith('value_')).sort(),
      ['value_access_policy_id', 'value_content_hash', 'value_storage_ref'],
    );

    // Nothing in the row set may contain the sentinel either way.
    const leaked = await count(
      f.pool,
      `SELECT count(*) AS n FROM traveller_contacts
        WHERE workspace_id = $1 AND (masked_label = $2 OR value_storage_ref = $2 OR value_access_policy_id = $2)`,
      [f.workspaceId, PROTECTED_SENTINEL],
    );
    assert.equal(leaked, 0);
  });

  test('correcting a profile assertion appends an edition that cites the old one', async () => {
    const f = await bareFixture();
    const created = mustOk(
      await recordTraveller(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        displayName: {
          nameKind: 'DISPLAY',
          displayValue: 'Known As',
          effectiveRange: OPEN_RANGE,
          evidenceId: randomUUID(),
        },
      }),
    );
    const repository = () => new PgTravellerRepository(f.workspaceId);

    const firstAssertion = mustOk(
      await appendProfileAssertion(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        travellerId: created.travellerId,
        assertionType: 'RESIDENCY',
        effectiveRange: OPEN_RANGE,
        evidenceId: randomUUID(),
        value: { countryOfResidence: 'NZ' },
        expectedRevision: 1,
      }),
    );
    const secondAssertion = mustOk(
      await appendProfileAssertion(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        travellerId: created.travellerId,
        assertionType: 'RESIDENCY',
        effectiveRange: OPEN_RANGE,
        evidenceId: randomUUID(),
        value: { countryOfResidence: 'AU' },
        supersedesAssertionId: firstAssertion.assertionId,
        expectedRevision: 2,
      }),
    );
    assert.equal(secondAssertion.revision, 3);

    const all = await inRepositoryRead(f.pool, () => repository().listProfileAssertions(f.workspaceId, created.travellerId));
    assert.equal(all.length, 2, 'superseded assertions stay in the history');
    const current = await inRepositoryRead(f.pool, () =>
      repository().listProfileAssertions(f.workspaceId, created.travellerId, { currentOnly: true }),
    );
    assert.equal(current.length, 1);
    const only = current[0];
    if (only === undefined) assert.fail('expected one current assertion');
    assert.equal(only.id, secondAssertion.assertionId);

    const immutability = await commitThatMustFail(f.pool, async (client) => {
      await client.query(
        'UPDATE profile_assertions SET value = $3::jsonb WHERE workspace_id = $1 AND id = $2',
        [f.workspaceId, firstAssertion.assertionId, JSON.stringify({ countryOfResidence: 'ZZ' })],
      );
    });
    assert.match(immutability, /profile_assertions is append-only/);
  });

  test('a coverage claim is stored verbatim; a row never implies completeness', async () => {
    const f = await bareFixture();
    const created = mustOk(
      await recordTraveller(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        displayName: {
          nameKind: 'DISPLAY',
          displayValue: 'Known As',
          effectiveRange: OPEN_RANGE,
          evidenceId: randomUUID(),
        },
      }),
    );
    const jurisdictionId = randomUUID();
    const partial = mustOk(
      await recordTravelHistory(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        travellerId: created.travellerId,
        jurisdictionId,
        entryDate: day(1),
        coverageClaim: 'PARTIAL',
        uncertaintyNote: 'source reports only the year of entry',
        evidenceId: randomUUID(),
        expectedRevision: 1,
      }),
    );
    assert.equal(partial.coverageClaim, 'PARTIAL');

    const window = await inRepositoryRead(f.pool, () =>
      new PgTravellerFactsReadQueries(f.pool).travelHistoryFor(f.workspaceId, created.travellerId, {
        start: day(0),
        end: day(10),
      }),
    );
    assert.equal(window.length, 1);
    const row = window[0];
    if (row === undefined) assert.fail('expected one movement');
    assert.equal(row.coverageClaim, 'PARTIAL', 'the claim must not be upgraded by the read path');
    assert.equal(row.uncertaintyNote, 'source reports only the year of entry');
    assert.equal(row.exitDate, null, 'an unobserved exit date stays absent rather than inferred');

    // The target model has no "this dataset is complete" flag to assert.
    const completenessColumns = await count(
      f.pool,
      `SELECT count(*) AS n FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'travel_history'
          AND column_name IN ('is_complete', 'complete', 'authoritative')`,
      [],
    );
    assert.equal(completenessColumns, 0);
  });

  test('a movement pinned to a stale Traveller revision conflicts and writes nothing', async () => {
    const f = await bareFixture();
    const created = mustOk(
      await recordTraveller(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        displayName: {
          nameKind: 'DISPLAY',
          displayValue: 'Known As',
          effectiveRange: OPEN_RANGE,
          evidenceId: randomUUID(),
        },
      }),
    );
    mustOk(
      await recordTravelHistory(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        travellerId: created.travellerId,
        jurisdictionId: randomUUID(),
        entryDate: day(1),
        coverageClaim: 'PARTIAL',
        evidenceId: randomUUID(),
        expectedRevision: 1,
      }),
    );

    const conflict = conflictOf(
      await recordTravelHistory(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        travellerId: created.travellerId,
        jurisdictionId: randomUUID(),
        entryDate: day(40),
        coverageClaim: 'PARTIAL',
        evidenceId: randomUUID(),
        expectedRevision: 1,
      }),
    );
    assert.equal(conflict.kind, 'STALE_AGGREGATE_REVISION');
    assert.equal(
      await count(f.pool, 'SELECT count(*) AS n FROM travel_history WHERE workspace_id = $1', [f.workspaceId]),
      1,
      'a movement is only ever recorded by a command that held the current Traveller revision',
    );
  });

  test("a movement cannot be attached to another workspace's person", async () => {
    const owner = await bareFixture();
    const other = await bareFixture();
    const foreignPerson = mustOk(
      await recordTraveller(unitOfWork(owner), {
        workspaceId: owner.workspaceId,
        actorPrincipalId: owner.actorId,
        idempotencyKey: nextKey(owner),
        displayName: {
          nameKind: 'DISPLAY',
          displayValue: 'Elsewhere',
          effectiveRange: OPEN_RANGE,
          evidenceId: randomUUID(),
        },
      }),
    );

    const conflict = conflictOf(
      await recordTravelHistory(unitOfWork(other), {
        workspaceId: other.workspaceId,
        actorPrincipalId: other.actorId,
        idempotencyKey: nextKey(other),
        travellerId: foreignPerson.travellerId,
        jurisdictionId: randomUUID(),
        entryDate: day(1),
        coverageClaim: 'PARTIAL',
        evidenceId: randomUUID(),
        expectedRevision: 1,
      }),
    );
    // A movement cites the person's head, so ownership is decided by the
    // UnitOfWork's revision gate before the handler body runs at all: another
    // workspace's Traveller has no head *here*, so the cited revision is simply
    // absent. The frozen vocabulary for that is STALE_AGGREGATE_REVISION; the
    // body's own `no travellers row` check is the second line of defence.
    assert.equal(conflict.kind, 'STALE_AGGREGATE_REVISION');
    assert.match(conflict.message, /, found MISSING$/);
    assert.deepEqual(conflict.subjectRefs, [travellerRef(foreignPerson.travellerId)]);
    assert.equal(
      await count(other.pool, 'SELECT count(*) AS n FROM travel_history WHERE traveller_id = $1', [
        foreignPerson.travellerId,
      ]),
      0,
      'the head, the audit trail and the movement are one transaction, so a foreign person is written nothing at all',
    );
  });

  test('replaying a movement returns the recorded result instead of a second movement', async () => {
    const f = await bareFixture();
    const created = mustOk(
      await recordTraveller(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        displayName: {
          nameKind: 'DISPLAY',
          displayValue: 'Known As',
          effectiveRange: OPEN_RANGE,
          evidenceId: randomUUID(),
        },
      }),
    );
    const replayKey = nextKey(f);
    // Replay needs the submission to hash identically, and every default this
    // handler would supply (row identity, observation instant) is computed
    // before `uow.execute` and hashed into the payload (C1 replay-safety rule).
    // So a caller that wants a replayable command pins them.
    const record = {
      workspaceId: f.workspaceId,
      actorPrincipalId: f.actorId,
      idempotencyKey: replayKey,
      travellerId: created.travellerId,
      historyId: randomUUID(),
      jurisdictionId: randomUUID(),
      entryDate: day(1),
      exitDate: day(9),
      coverageClaim: 'WINDOW_COMPLETE' as const,
      evidenceId: randomUUID(),
      recordedAt: at(30),
      expectedRevision: 1,
    };
    const first = mustOk(await recordTravelHistory(unitOfWork(f), record));
    const replay = mustOk(await recordTravelHistory(unitOfWork(f), record));

    assert.deepEqual(replay, first);
    assert.equal(
      await count(f.pool, 'SELECT count(*) AS n FROM travel_history WHERE workspace_id = $1', [f.workspaceId]),
      1,
    );
    assert.equal(await headRevision(f.pool, f.workspaceId, created.travellerId), 2, 'one movement, one revision');

    // The same key with a different payload is a refusal, not a second movement:
    // an idempotency key can never quietly re-issue a command it did not record.
    const { historyId: _fresh, recordedAt: _later, ...unpinned } = record;
    const mismatch = conflictOf(
      await recordTravelHistory(unitOfWork(f), {
        ...unpinned,
        idempotencyKey: replayKey,
        jurisdictionId: randomUUID(),
        expectedRevision: 2,
      }),
    );
    assert.equal(mismatch.kind, 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');
    assert.equal(
      await count(f.pool, 'SELECT count(*) AS n FROM travel_history WHERE workspace_id = $1', [f.workspaceId]),
      1,
      'the refused resubmission recorded nothing',
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Credentials: versioned, kind-bound, Traveller-owned
// ---------------------------------------------------------------------------

describe('M2 lane P: credentials are Traveller-owned, versioned documents', () => {
  async function seededPerson(f: Fixture): Promise<string> {
    const created = mustOk(
      await recordTraveller(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        displayName: {
          nameKind: 'DISPLAY',
          displayValue: 'Known As',
          effectiveRange: OPEN_RANGE,
          evidenceId: randomUUID(),
        },
      }),
    );
    return created.travellerId;
  }

  test('the second accepted edition re-points current_version_id and numbers itself in SQL', async () => {
    const f = await bareFixture();
    const travellerId = await seededPerson(f);
    const credentialId = randomUUID();

    const edition1 = mustOk(
      await appendCredentialVersion(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        travellerId,
        credentialId,
        kind: 'PASSPORT',
        issuerCountry: 'NZ',
        issueDate: day(-3000),
        expiryDate: day(400),
        issuerStatus: 'VALID',
        evidenceId: randomUUID(),
        documentNumber: PROTECTED,
        detail: { kind: 'PASSPORT', documentNumber: PROTECTED },
        expectedRevision: 1,
      }),
    );
    assert.equal(edition1.editionNumber, 1);
    assert.equal(edition1.revision, 2);

    const edition2 = mustOk(
      await appendCredentialVersion(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        travellerId,
        credentialId,
        kind: 'PASSPORT',
        issuerCountry: 'NZ',
        issueDate: day(-30),
        expiryDate: day(1500),
        issuerStatus: 'VALID',
        evidenceId: randomUUID(),
        documentNumber: OTHER_PROTECTED,
        detail: { kind: 'PASSPORT', documentNumber: OTHER_PROTECTED },
        expectedRevision: 2,
      }),
    );
    assert.equal(edition2.editionNumber, 2, 'the caller never supplies an edition number');
    assert.equal(edition2.revision, 3);

    const credential = await inRepositoryRead(f.pool, () =>
      new PgTravellerRepository(f.workspaceId).loadCredential(f.workspaceId, credentialId),
    );
    assert.ok(credential);
    assert.equal(credential.currentVersionId, edition2.versionId);
    assert.equal(credential.travellerId, travellerId);

    const versions = await inRepositoryRead(f.pool, () =>
      new PgTravellerRepository(f.workspaceId).listCredentialVersions(f.workspaceId, credentialId),
    );
    assert.deepEqual(
      versions.map((version) => version.id),
      [edition1.versionId, edition2.versionId],
      'editions are returned in the order they were accepted',
    );

    const supersededWindow = await new PgCredentialReadQueries(f.pool).credentialsExpiringIn(f.workspaceId, {
      start: day(300),
      end: day(500),
    });
    assert.deepEqual(
      supersededWindow.map((hit) => hit.versionId),
      [],
      'an expiry window is answered through current_version_id, so a superseded edition is never reported as live exposure',
    );

    const currentWindow = await new PgCredentialReadQueries(f.pool).credentialsExpiringIn(f.workspaceId, {
      start: day(1400),
      end: day(1600),
    });
    assert.deepEqual(
      currentWindow.map((hit) => [hit.versionId, hit.editionNumber]),
      [[edition2.versionId, 2]],
      'the edition the credential currently accepts is the one the window finds',
    );
  });

  test('a superseded edition cannot be rewritten, even by direct SQL', async () => {
    const f = await bareFixture();
    const travellerId = await seededPerson(f);
    const credentialId = randomUUID();
    const edition1 = mustOk(
      await appendCredentialVersion(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        travellerId,
        credentialId,
        kind: 'VISA',
        issuerCountry: 'AU',
        issueDate: day(-200),
        expiryDate: day(30),
        issuerStatus: 'VALID',
        evidenceId: randomUUID(),
        detail: { kind: 'VISA', documentNumber: PROTECTED, visaClass: 'TOURIST', entriesAllowed: 2 },
        expectedRevision: 1,
      }),
    );

    const message = await commitThatMustFail(f.pool, async (client) => {
      await client.query(
        'UPDATE credential_versions SET issuer_status = $3 WHERE workspace_id = $1 AND id = $2',
        [f.workspaceId, edition1.versionId, 'REVOKED'],
      );
    });
    assert.match(message, /credential_versions is append-only; UPDATE is not permitted/);

    const deleteMessage = await commitThatMustFail(f.pool, async (client) => {
      await client.query('DELETE FROM credential_versions WHERE workspace_id = $1 AND id = $2', [
        f.workspaceId,
        edition1.versionId,
      ]);
    });
    assert.match(deleteMessage, /credential_versions is append-only; DELETE is not permitted/);
  });

  test('a detail row whose kind disagrees with the version is rejected by the database', async () => {
    const f = await bareFixture();
    const travellerId = await seededPerson(f);
    const credentialId = randomUUID();
    const versionId = randomUUID();

    // Layer 1: the payload refuses a contradictory (kind, detail.kind) pair before any transaction opens.
    const conflict = conflictOf(
      await appendCredentialVersion(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        travellerId,
        credentialId,
        versionId,
        kind: 'VISA',
        issuerCountry: 'AU',
        issueDate: day(-10),
        issuerStatus: 'VALID',
        evidenceId: randomUUID(),
        detail: { kind: 'PASSPORT', documentNumber: PROTECTED },
        expectedRevision: 1,
      }),
    );
    assert.equal(conflict.kind, 'VALIDATION_FAILED');
    assert.match(conflict.message, /can never be satisfied/);
    assert.equal(
      await count(f.pool, 'SELECT count(*) AS n FROM travel_credentials WHERE workspace_id = $1', [f.workspaceId]),
      0,
      'the contradictory pair is refused before the transaction opens',
    );

    // Layer 2: the composite kind FK is the authority behind that claim, so it still closes the hole
    // for a writer that bypasses the schema and attaches a detail of the wrong kind to a real edition.
    mustOk(
      await appendCredentialVersion(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        travellerId,
        credentialId,
        versionId,
        kind: 'VISA',
        issuerCountry: 'AU',
        issueDate: day(-10),
        issuerStatus: 'VALID',
        evidenceId: randomUUID(),
        detail: { kind: 'VISA', documentNumber: PROTECTED, visaClass: 'TOURIST' },
        expectedRevision: 1,
      }),
    );

    const message = await commitThatMustFail(f.pool, async (client) => {
      await client.query(
        `INSERT INTO passport_details
           (workspace_id, credential_version_id, kind, issuing_state_code,
            document_number_content_hash, document_number_storage_ref,
            document_number_access_policy_id, created_by_actor_id)
         VALUES ($1, $2, 'PASSPORT', 'NZ', $3, $4, $5, $6)`,
        [f.workspaceId, versionId, PROTECTED.contentHash, PROTECTED.storageRef, PROTECTED.accessPolicyId, f.actorId],
      );
    });
    assert.match(message, /passport_details_version_fk/);
    assert.equal(
      await count(f.pool, 'SELECT count(*) AS n FROM passport_details WHERE workspace_id = $1', [f.workspaceId]),
      0,
      'the kind-bound detail row was never written, so the VISA edition still has exactly one detail',
    );
  });

  test('a passport fact with no column is refused, never dropped', async () => {
    const f = await bareFixture();
    const travellerId = await seededPerson(f);

    const conflict = conflictOf(
      await appendCredentialVersion(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        travellerId,
        credentialId: randomUUID(),
        kind: 'PASSPORT',
        issuerCountry: 'NZ',
        issueDate: day(-10),
        issuerStatus: 'VALID',
        evidenceId: randomUUID(),
        documentNumber: PROTECTED,
        detail: { kind: 'PASSPORT', documentNumber: PROTECTED, nationalityCountry: 'NZ' },
        expectedRevision: 1,
      }),
    );
    assert.equal(conflict.kind, 'VALIDATION_FAILED');
    assert.match(conflict.message, /G-P5/);
    assert.equal(
      await count(f.pool, 'SELECT count(*) AS n FROM travel_credentials WHERE workspace_id = $1', [f.workspaceId]),
      0,
      'the payload is refused before the transaction opens',
    );

    // The same field stays refused for a lane that goes straight to the seam.
    const seamCredentialId = randomUUID();
    const seamVersionId = randomUUID();
    const seamMessage = await commitThatMustFail(f.pool, (client) =>
      runWithTransactionClient(client, () =>
        new PgTravellerRepository(f.workspaceId).recordCredential({
          credential: {
            id: seamCredentialId,
            travellerId,
            kind: 'PASSPORT',
            issuerCountry: 'NZ',
            currentVersionId: seamVersionId,
          },
          version: {
            id: seamVersionId,
            credentialId: seamCredentialId,
            issueDate: day(-10),
            issuerStatus: 'VALID',
            evidenceId: randomUUID(),
            acceptedAt: new Date().toISOString(),
          },
          detail: { kind: 'PASSPORT', documentNumber: PROTECTED, machineReadable: true },
          actor: { workspaceId: f.workspaceId, actorPrincipalId: f.actorId },
        }),
      ),
    );
    assert.match(seamMessage, /G-P5/);
    assert.equal(
      await count(f.pool, 'SELECT count(*) AS n FROM passport_details WHERE workspace_id = $1', [f.workspaceId]),
      0,
    );
  });

  test('E_AUTHORISATION needs no typed detail row, and cannot carry one', async () => {
    const f = await bareFixture();
    const travellerId = await seededPerson(f);

    const accepted = mustOk(
      await appendCredentialVersion(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        travellerId,
        credentialId: randomUUID(),
        kind: 'E_AUTHORISATION',
        issuerCountry: 'JP',
        issueDate: day(-5),
        expiryDate: day(90),
        issuerStatus: 'VALID',
        evidenceId: randomUUID(),
        expectedRevision: 1,
      }),
    );
    assert.equal(accepted.editionNumber, 1);
    assert.equal(
      await count(f.pool, 'SELECT count(*) AS n FROM passport_details WHERE workspace_id = $1', [f.workspaceId]),
      0,
    );

    // GAP(G-P8): 0015 names no detail table for this kind, so a detail has nowhere to go.
    const conflict = conflictOf(
      await appendCredentialVersion(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        travellerId,
        credentialId: randomUUID(),
        kind: 'E_AUTHORISATION',
        issuerCountry: 'JP',
        issueDate: day(-5),
        issuerStatus: 'VALID',
        evidenceId: randomUUID(),
        detail: { kind: 'PASSPORT', documentNumber: PROTECTED },
        expectedRevision: 2,
      }),
    );
    assert.equal(conflict.kind, 'VALIDATION_FAILED');
    assert.match(conflict.message, /G-P8: E_AUTHORISATION has no typed credential detail table/);

    // The repository seam carries the same named guard independently, which is what makes the
    // gap an active refusal rather than a schema convenience.
    const seamCredentialId = randomUUID();
    const seamVersionId = randomUUID();
    const seamMessage = await commitThatMustFail(f.pool, (client) =>
      runWithTransactionClient(client, () =>
        new PgTravellerRepository(f.workspaceId).recordCredential({
          credential: {
            id: seamCredentialId,
            travellerId,
            kind: 'E_AUTHORISATION',
            issuerCountry: 'JP',
            currentVersionId: seamVersionId,
          },
          version: {
            id: seamVersionId,
            credentialId: seamCredentialId,
            issueDate: day(-5),
            issuerStatus: 'VALID',
            evidenceId: randomUUID(),
            acceptedAt: new Date().toISOString(),
          },
          detail: { kind: 'PASSPORT', documentNumber: PROTECTED },
          actor: { workspaceId: f.workspaceId, actorPrincipalId: f.actorId },
        }),
      ),
    );
    assert.match(seamMessage, /G-P8: E_AUTHORISATION has no typed credential detail table/);
    assert.equal(
      await count(f.pool, 'SELECT count(*) AS n FROM travel_credentials WHERE workspace_id = $1', [f.workspaceId]),
      1,
      'only the accepted detail-less edition survives',
    );
  });

  test('a document number with no matching typed detail row is rejected, not dropped', async () => {
    const f = await bareFixture();
    const travellerId = await seededPerson(f);
    await assert.rejects(
      appendCredentialVersion(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        travellerId,
        credentialId: randomUUID(),
        kind: 'PASSPORT',
        issuerCountry: 'NZ',
        issueDate: day(-10),
        issuerStatus: 'VALID',
        evidenceId: randomUUID(),
        documentNumber: PROTECTED,
        expectedRevision: 1,
      }),
      /G-P9: a credential document number without a matching typed detail row/,
    );
  });

  test('an accepted edition cannot move a document to another person', async () => {
    const f = await bareFixture();
    const owner = await seededPerson(f);
    const other = await seededPerson(f);
    const credentialId = randomUUID();
    mustOk(
      await appendCredentialVersion(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        travellerId: owner,
        credentialId,
        kind: 'PASSPORT',
        issuerCountry: 'NZ',
        issueDate: day(-100),
        issuerStatus: 'VALID',
        evidenceId: randomUUID(),
        detail: { kind: 'PASSPORT', documentNumber: PROTECTED },
        expectedRevision: 1,
      }),
    );

    const conflict = conflictOf(
      await appendCredentialVersion(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        travellerId: other,
        credentialId,
        kind: 'PASSPORT',
        issuerCountry: 'NZ',
        issueDate: day(-10),
        issuerStatus: 'VALID',
        evidenceId: randomUUID(),
        detail: { kind: 'PASSPORT', documentNumber: OTHER_PROTECTED },
        expectedRevision: 1,
      }),
    );
    assert.equal(conflict.kind, 'VALIDATION_FAILED');
    assert.match(conflict.message, /belongs to traveller/);
  });

  test('linking two documents of one Traveller records the relationship without inventing a version', async () => {
    const f = await bareFixture();
    const travellerId = await seededPerson(f);
    const passport = randomUUID();
    const visa = randomUUID();
    for (const [index, credentialId, kind, detail] of [
      [0, passport, 'PASSPORT', { kind: 'PASSPORT', documentNumber: PROTECTED }],
      [1, visa, 'VISA', { kind: 'VISA', documentNumber: OTHER_PROTECTED, visaClass: 'TOURIST' }],
    ] as const) {
      mustOk(
        await appendCredentialVersion(unitOfWork(f), {
          workspaceId: f.workspaceId,
          actorPrincipalId: f.actorId,
          idempotencyKey: nextKey(f),
          travellerId,
          credentialId,
          kind,
          issuerCountry: kind === 'PASSPORT' ? 'NZ' : 'AU',
          issueDate: day(-100),
          issuerStatus: 'VALID',
          evidenceId: randomUUID(),
          detail,
          expectedRevision: index + 1,
        }),
      );
    }

    const linked = mustOk(
      await linkCredentials(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        travellerId,
        credentialId: visa,
        relatedCredentialId: passport,
        linkType: 'VISA_TO_PASSPORT',
        evidenceId: randomUUID(),
        effectiveRange: OPEN_RANGE,
        expectedRevision: 3,
      }),
    );
    assert.equal(linked.revision, 4);
    assert.equal(
      await count(f.pool, 'SELECT count(*) AS n FROM credential_links WHERE workspace_id = $1', [f.workspaceId]),
      1,
    );
    assert.equal(
      await count(f.pool, 'SELECT count(*) AS n FROM credential_versions WHERE workspace_id = $1', [f.workspaceId]),
      2,
      'a link is provenance between documents, not a new edition of one',
    );
  });

  /**
   * GAP(G7): edition numbers are derived *inside* the handler, so two concurrent
   * appends are the case where a lost update would be silent. The advisory lock
   * keys only (workspace, command type, idempotency key), so distinct keys
   * genuinely overlap: the SERIALIZABLE head lock plus the expected revision
   * picks the winner, and `credential_versions_edition_unique` backs it up.
   */
  test('two concurrent appends to one document yield exactly one second edition', async () => {
    const f = await bareFixture();
    const travellerId = await seededPerson(f);
    const credentialId = randomUUID();
    mustOk(
      await appendCredentialVersion(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        travellerId,
        credentialId,
        kind: 'PASSPORT',
        issuerCountry: 'NZ',
        issueDate: day(-300),
        expiryDate: day(700),
        issuerStatus: 'VALID',
        evidenceId: randomUUID(),
        detail: { kind: 'PASSPORT', documentNumber: PROTECTED },
        expectedRevision: 1,
      }),
    );

    // Both callers pin their version id up front, so a transaction that has to
    // be re-run can never describe a different row than its receipt claims (C1c).
    const keys = [nextKey(f), nextKey(f)] as const;
    const versionIds = [randomUUID(), randomUUID()] as const;
    const appendEdition = (caller: 0 | 1) =>
      appendCredentialVersion(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: keys[caller],
        travellerId,
        credentialId,
        versionId: versionIds[caller],
        kind: 'PASSPORT',
        issuerCountry: 'NZ',
        issueDate: day(-10),
        expiryDate: day(1400),
        issuerStatus: 'VALID',
        evidenceId: randomUUID(),
        detail: { kind: 'PASSPORT', documentNumber: OTHER_PROTECTED },
        expectedRevision: 2,
      });

    const [first, second] = await Promise.all([appendEdition(0), appendEdition(1)]);
    // Which caller wins is a property of the server, not the contract, so the
    // test never presumes it — only that exactly one does.
    if (first.ok && second.ok) {
      assert.fail(`both concurrent appends committed: editions ${first.value.editionNumber} and ${second.value.editionNumber}`);
    }
    if (!first.ok && !second.ok) {
      assert.fail(`neither concurrent append committed: ${first.conflict.kind} / ${second.conflict.kind}`);
    }
    const winnerIndex = first.ok ? 0 : 1;
    const loserIndex = first.ok ? 1 : 0;
    const winner = mustOk(first.ok ? first : second);
    const loser = conflictOf(first.ok ? second : first);

    assert.equal(winner.editionNumber, 2);
    assert.equal(winner.revision, 3);
    assert.equal(winner.versionId, versionIds[winnerIndex]);
    assert.equal(loser.kind, 'STALE_AGGREGATE_REVISION');
    assert.match(loser.message, /found 3/, 'the loser reads the revision the winner committed, not the one it expected');

    assert.deepEqual(
      (
        await f.pool.query<{ edition_number: string }>(
          `SELECT edition_number FROM credential_versions
            WHERE workspace_id = $1 AND credential_id = $2 ORDER BY edition_number`,
          [f.workspaceId, credentialId],
        )
      ).rows.map((row) => Number(row.edition_number)),
      [1, 2],
      'the rolled-back caller leaves no second edition 2 row behind',
    );
    assert.equal(
      await count(
        f.pool,
        `SELECT count(*) AS n FROM command_receipts WHERE workspace_id = $1 AND idempotency_key = $2`,
        [f.workspaceId, keys[loserIndex]],
      ),
      0,
      'the claim lives in the receipt, so a rolled-back command never consumes its key',
    );

    const replayed = mustOk(
      await appendCredentialVersion(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: keys[loserIndex],
        travellerId,
        credentialId,
        versionId: versionIds[loserIndex],
        kind: 'PASSPORT',
        issuerCountry: 'NZ',
        issueDate: day(-10),
        expiryDate: day(1400),
        issuerStatus: 'VALID',
        evidenceId: randomUUID(),
        detail: { kind: 'PASSPORT', documentNumber: OTHER_PROTECTED },
        expectedRevision: 3,
      }),
    );
    assert.equal(replayed.editionNumber, 3, 'numbering stays contiguous across a lost race');
    assert.equal(replayed.revision, 4);

    const current = await inRepositoryRead(f.pool, () =>
      new PgTravellerRepository(f.workspaceId).loadCredential(f.workspaceId, credentialId),
    );
    assert.ok(current);
    assert.equal(current.currentVersionId, versionIds[loserIndex]);
    assert.equal(
      (
        await scalar<{ revision: string }>(
          f.pool,
          'SELECT revision::text AS revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2',
          [f.workspaceId, travellerId],
        )
      ).revision,
      '4',
      'the winner and the replayed loser each moved the same head once',
    );
    assert.equal(
      await count(
        f.pool,
        'SELECT count(*) AS n FROM outbox WHERE workspace_id = $1 AND destination_kind = $2',
        [f.workspaceId, 'CREDENTIAL_EDITION_ACCEPTED'],
      ),
      3,
      'one event per accepted edition: the loser published none',
    );
  });

  /**
   * C1 (c) closure evidence (gap G7). The M1 suite proves the retry
   * *mechanism* exists; only re-running a real command handler proves the
   * convention behind it is actually honoured. Edition numbers are derived by
   * `MAX()` inside the handler, so a callback that was merely "usually
   * idempotent" would surface here as a second version row, a numbering gap,
   * or a result describing a row that no longer exists. The control is the
   * same command with no injected conflict, so the comparison is literally
   * "retried" against "never failed".
   */
  test('a handler replayed after a forced 40001 leaves the same rows as one that never failed', async () => {
    const f = await bareFixture();
    const travellerId = await seededPerson(f);
    const evidenceId = randomUUID();

    const appendAsOfHead = async (uow: UnitOfWork, credentialId: string) =>
      appendCredentialVersion(uow, {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        travellerId,
        credentialId,
        versionId: randomUUID(),
        kind: 'PASSPORT',
        issuerCountry: 'NZ',
        issueDate: day(-400),
        expiryDate: day(1400),
        issuerStatus: 'VALID',
        evidenceId,
        detail: { kind: 'PASSPORT', documentNumber: PROTECTED },
        expectedRevision: await headRevision(f.pool, f.workspaceId, travellerId),
      });

    const probe = { attempts: 0 };
    const replayedId = randomUUID();
    const replayed = mustOk(
      await appendAsOfHead(forcingSerializationConflictOnce(unitOfWork(f), probe), replayedId),
    );
    const controlId = randomUUID();
    const control = mustOk(await appendAsOfHead(unitOfWork(f), controlId));

    assert.equal(probe.attempts, 2, 'the handler must have been re-run, not committed on a conflict-free first pass');
    assert.equal(replayed.editionNumber, 1);
    assert.equal(control.editionNumber, 1);
    assert.equal(
      (
        await scalar<{ id: string }>(
          f.pool,
          'SELECT id FROM credential_versions WHERE workspace_id = $1 AND credential_id = $2',
          [f.workspaceId, replayedId],
        )
      ).id,
      replayed.versionId,
      'the replayed command result describes the row that actually exists',
    );

    /**
     * The two runs may differ only in the identifiers they were handed and in
     * wall-clock stamps, so both are normalised away before comparing: every
     * known uuid is replaced by a token, and every `*_at` column is dropped.
     * Anything left — kind binding, issuer, dates, provenance, the ProtectedDataRef
     * triple, edition numbering — is domain content and must match exactly.
     */
    const snapshot = async (credentialId: string, versionId: string): Promise<unknown> => {
      const row = await scalar<{
        document: Record<string, unknown>;
        version: Record<string, unknown>;
        detail: Record<string, unknown> | null;
      }>(
        f.pool,
        `SELECT to_jsonb(c) AS document, to_jsonb(v) AS version, to_jsonb(p) AS detail
           FROM travel_credentials c
           JOIN credential_versions v
             ON v.workspace_id = c.workspace_id AND v.credential_id = c.id
           LEFT JOIN passport_details p
             ON p.workspace_id = v.workspace_id AND p.credential_version_id = v.id
          WHERE c.workspace_id = $1 AND c.id = $2`,
        [f.workspaceId, credentialId],
      );
      const tokens = new Map<string, string>([
        [credentialId, '#credential'],
        [versionId, '#version'],
        [travellerId, '#traveller'],
        [f.workspaceId, '#workspace'],
        [evidenceId, '#evidence'],
        [f.actorId, '#actor'],
      ]);
      const walk = (value: unknown): unknown => {
        if (typeof value === 'string') return tokens.get(value) ?? value;
        if (Array.isArray(value)) return value.map(walk);
        if (value !== null && typeof value === 'object') {
          return Object.fromEntries(
            Object.entries(value)
              .filter(([key]) => !key.endsWith('_at'))
              .map(([key, nested]) => [key, walk(nested)]),
          );
        }
        return value;
      };
      return walk(row);
    };

    assert.deepEqual(
      await snapshot(replayedId, replayed.versionId),
      await snapshot(controlId, control.versionId),
      'the replayed handler wrote the same credential facts as a run that never conflicted',
    );

    assert.equal(
      await count(
        f.pool,
        'SELECT count(*) AS n FROM credential_versions WHERE workspace_id = $1 AND credential_id = $2',
        [f.workspaceId, replayedId],
      ),
      1,
      'the rolled-back attempt left no version row behind',
    );
    assert.equal(
      await count(
        f.pool,
        'SELECT count(*) AS n FROM passport_details WHERE workspace_id = $1 AND credential_version_id = $2',
        [f.workspaceId, replayed.versionId],
      ),
      1,
      'the rolled-back attempt left no orphan typed detail row behind',
    );
  });
});

// ---------------------------------------------------------------------------
// 4. F05: relationship, responsibility and authority stay three concepts
// ---------------------------------------------------------------------------

describe('M2 lane P: a relationship and a responsibility are not authority', () => {
  test('recording a guardian relationship writes zero grant rows and advances neither person', async () => {
    const f = await peopleFixture();
    const [guardian, child] = f.travellerIds;

    const recorded = mustOk(
      await recordTravellerRelationship(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        fromTravellerId: guardian,
        toTravellerId: child,
        relationshipType: 'PARENT_GUARDIAN',
        effectiveRange: OPEN_RANGE,
        evidenceId: randomUUID(),
      }),
    );
    assert.equal(recorded.revision, 1, 'a relationship is its own aggregate root');

    for (const table of ['authority_grants', 'grant_actions', 'grant_scopes']) {
      assert.equal(
        await count(f.pool, `SELECT count(*) AS n FROM ${table} WHERE workspace_id = $1`, [f.workspaceId]),
        0,
        `F05: ${table} must stay empty when only a relationship was recorded`,
      );
    }
    for (const travellerId of f.travellerIds) {
      assert.equal(
        Number(
          (
            await scalar<{ revision: number }>(
              f.pool,
              'SELECT revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2',
              [f.workspaceId, travellerId],
            )
          ).revision,
        ),
        1,
        'a relationship must not move either person revision',
      );
    }

    const asChild = await new PgTravellerFactsReadQueries(f.pool).relationshipsInvolving(f.workspaceId, child);
    assert.equal(asChild.length, 1);
    const edge = asChild[0];
    if (edge === undefined) assert.fail('expected the recorded relationship');
    assert.equal(edge.fromTravellerId, guardian, 'direction is preserved, not flattened to "connected"');
    assert.equal(edge.toTravellerId, child);
  });

  test('a relationship must join two distinct, existing people', async () => {
    const f = await peopleFixture();
    const [a] = f.travellerIds;
    const selfConflict = conflictOf(
      await recordTravellerRelationship(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        fromTravellerId: a,
        toTravellerId: a,
        relationshipType: 'PEER',
        effectiveRange: OPEN_RANGE,
        evidenceId: randomUUID(),
      }),
    );
    assert.equal(selfConflict.kind, 'VALIDATION_FAILED');
    assert.match(selfConflict.message, /two distinct people/);

    const missingConflict = conflictOf(
      await recordTravellerRelationship(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        fromTravellerId: a,
        toTravellerId: randomUUID(),
        relationshipType: 'PEER',
        effectiveRange: OPEN_RANGE,
        evidenceId: randomUUID(),
      }),
    );
    assert.equal(missingConflict.kind, 'VALIDATION_FAILED');
    assert.match(missingConflict.message, /no travellers row/);
    assert.equal(
      await count(f.pool, 'SELECT count(*) AS n FROM traveller_relationships WHERE workspace_id = $1', [f.workspaceId]),
      0,
    );
  });

  test('assigning duty of care writes no grant and keeps the subject TypedRef exact', async () => {
    const f = await peopleFixture();
    const [subject] = f.travellerIds;
    const assigned = mustOk(
      await assignResponsibility(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        organisationId: f.organisationId,
        subjectRef: travellerRef(subject),
        role: 'DUTY_OF_CARE',
        effectiveRange: OPEN_RANGE,
      }),
    );
    assert.deepEqual(assigned.subjectRef, travellerRef(subject));
    assert.equal(
      await count(f.pool, 'SELECT count(*) AS n FROM authority_grants WHERE workspace_id = $1', [f.workspaceId]),
      0,
      'accountability is not permission',
    );

    const found = await new PgGovernanceReadQueries(f.pool).responsibilitiesForSubjects(f.workspaceId, [
      travellerRef(subject),
    ]);
    assert.equal(found.length, 1);
    const rightIdWrongKind = await new PgGovernanceReadQueries(f.pool).responsibilitiesForSubjects(f.workspaceId, [
      { kind: 'TRIP', id: subject },
    ]);
    assert.equal(rightIdWrongKind.length, 0, 'C1 (a): the same UUID with the wrong kind finds nothing');
  });

  test('a role that does not accept the subject kind is rejected by 0018 at commit', async () => {
    const f = await peopleFixture();
    const [subject] = f.travellerIds;
    await assert.rejects(
      assignResponsibility(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        organisationId: f.organisationId,
        subjectRef: travellerRef(subject),
        role: 'PAYER',
        effectiveRange: OPEN_RANGE,
      }),
      /role PAYER does not accept subject kind TRAVELLER/,
    );
    assert.equal(
      await count(f.pool, 'SELECT count(*) AS n FROM responsibility_assignments WHERE workspace_id = $1', [
        f.workspaceId,
      ]),
      0,
    );
  });
});

// ---------------------------------------------------------------------------
// 5. Authority is a closed vocabulary owned only by grants
// ---------------------------------------------------------------------------

describe('M2 lane P: authority exists only because a grant says so', () => {
  /**
   * By default the grant cites *its own* command receipt: `PgUnitOfWork` inserts
   * that row after the handler returns, and 0019's FK is deferrable, so the
   * citation resolves at COMMIT. Pass `authorisingReceipt` to cite a receipt an
   * earlier command in this workspace already committed.
   */
  async function grantTo(
    f: PeopleFixture,
    actions: string[],
    authorisingReceipt?: { commandNamespace: string; idempotencyKey: string },
  ): Promise<AuthorityGrantIssuedResult> {
    const [subject] = f.travellerIds;
    const idempotencyKey = nextKey(f);
    return mustOk(
      await issueAuthorityGrant(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey,
        principalId: f.principalId,
        representedPartyRef: travellerRef(subject),
        issuedByPrincipalId: f.issuedByPrincipalId,
        issuedAt: at(0),
        actions,
        scopes: [travellerRef(subject)],
        authorisingReceipt:
          authorisingReceipt ?? { commandNamespace: 'AUTHORITY_GRANT_ISSUED', idempotencyKey },
        expectedAggregateRevisions: [],
      }),
    );
  }

  test('a registered action kind makes the principal able to act until revoked', async () => {
    const f = await peopleFixture();
    const [subject] = f.travellerIds;
    const grant = await grantTo(f, ['traveller.profile.write']);
    assert.equal(grant.revision, 1, 'a grant is its own root, so it does not move the principal');

    const repository = () => new PgGovernanceRepository(f.workspaceId);
    const effective = await inRepositoryRead(f.pool, () =>
      repository().listEffectiveGrants(f.workspaceId, f.principalId, at(1)),
    );
    assert.equal(effective.length, 1);
    assert.deepEqual(effective[0]?.actions, ['traveller.profile.write']);

    assert.equal(
      await inRepositoryRead(f.pool, () =>
        repository().mayPrincipalAct({
          workspaceId: f.workspaceId,
          principalId: f.principalId,
          actionKind: 'traveller.profile.write',
          subjectRef: travellerRef(subject),
          at: at(1),
        }),
      ),
      true,
    );

    const revoked = mustOk(
      await revokeAuthorityGrant(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        grantId: grant.grantId,
        revokedAt: at(60),
        expectedRevision: 1,
      }),
    );
    assert.equal(revoked.revision, 2);

    assert.equal(
      await inRepositoryRead(f.pool, () =>
        repository().mayPrincipalAct({
          workspaceId: f.workspaceId,
          principalId: f.principalId,
          actionKind: 'traveller.profile.write',
          subjectRef: travellerRef(subject),
          at: at(120),
        }),
      ),
      false,
      'revocation must flip the answer, not merely record a timestamp',
    );
    assert.equal(
      await count(f.pool, 'SELECT count(*) AS n FROM authority_grants WHERE workspace_id = $1 AND revoked_at IS NULL', [
        f.workspaceId,
      ]),
      0,
    );
    assert.deepEqual(
      await new PgGovernanceReadQueries(f.pool).principalsHoldingAction(f.workspaceId, 'traveller.profile.write', at(120)),
      [],
    );
  });

  test('an instant before issuedAt is not covered by the grant', async () => {
    const f = await peopleFixture();
    const [subject] = f.travellerIds;
    await grantTo(f, ['traveller.credential.record']);
    assert.equal(
      await inRepositoryRead(f.pool, () =>
        new PgGovernanceRepository(f.workspaceId).mayPrincipalAct({
          workspaceId: f.workspaceId,
          principalId: f.principalId,
          actionKind: 'traveller.credential.record',
          subjectRef: travellerRef(subject),
          at: at(-1),
        }),
      ),
      false,
      'issuedAt is inclusive; one minute earlier is not covered',
    );
  });

  test('an unregistered action kind can never be granted', async () => {
    const f = await peopleFixture();
    const before = await count(f.pool, 'SELECT count(*) AS n FROM grant_actions WHERE workspace_id = $1', [
      f.workspaceId,
    ]);
    await assert.rejects(
      grantTo(f, ['traveller.whatever_we_invented']),
      /grant_actions_action_kind_fkey|violates foreign key constraint/,
    );
    assert.equal(
      await count(f.pool, 'SELECT count(*) AS n FROM grant_actions WHERE workspace_id = $1', [f.workspaceId]),
      before,
    );
    // The vocabulary is closed and M2-owned, so an unregistered kind stays not-authorised.
    assert.equal(
      await count(f.pool, "SELECT count(*) AS n FROM authority_action_kinds WHERE action_kind = $1", [
        'traveller.whatever_we_invented',
      ]),
      0,
    );
  });

  test('a grant requires real principals and a strictly later expiry', async () => {
    const f = await peopleFixture();
    const [subject] = f.travellerIds;
    // Both cite their own receipt, so the only thing wrong is the thing under test.
    const firstKey = nextKey(f);
    const unknownPrincipal = conflictOf(
      await issueAuthorityGrant(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: firstKey,
        principalId: randomUUID(),
        representedPartyRef: travellerRef(subject),
        issuedByPrincipalId: f.issuedByPrincipalId,
        actions: ['traveller.profile.write'],
        scopes: [travellerRef(subject)],
        authorisingReceipt: { commandNamespace: 'AUTHORITY_GRANT_ISSUED', idempotencyKey: firstKey },
        expectedAggregateRevisions: [],
      }),
    );
    assert.equal(unknownPrincipal.kind, 'VALIDATION_FAILED');
    assert.match(unknownPrincipal.message, /no principals row/);

    const secondKey = nextKey(f);
    const backwardsExpiry = conflictOf(
      await issueAuthorityGrant(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: secondKey,
        principalId: f.principalId,
        representedPartyRef: travellerRef(subject),
        issuedByPrincipalId: f.issuedByPrincipalId,
        issuedAt: at(100),
        expiresAt: at(50),
        actions: ['traveller.profile.write'],
        scopes: [travellerRef(subject)],
        authorisingReceipt: { commandNamespace: 'AUTHORITY_GRANT_ISSUED', idempotencyKey: secondKey },
        expectedAggregateRevisions: [],
      }),
    );
    assert.equal(backwardsExpiry.kind, 'VALIDATION_FAILED');
    assert.match(backwardsExpiry.message, /expire strictly after/);
  });

  test('a stale caller-cited revision conflicts before the grant is written', async () => {
    const f = await peopleFixture();
    const [subject] = f.travellerIds;
    mustOk(
      await addTravellerName(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        travellerId: subject,
        expectedRevision: 1,
        name: { nameKind: 'PREFERRED', displayValue: 'Preferred', effectiveRange: OPEN_RANGE, evidenceId: randomUUID() },
      }),
    );
    const idempotencyKey = nextKey(f);
    const conflict = conflictOf(
      await issueAuthorityGrant(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey,
        principalId: f.principalId,
        representedPartyRef: travellerRef(subject),
        issuedByPrincipalId: f.issuedByPrincipalId,
        actions: ['traveller.profile.write'],
        scopes: [travellerRef(subject)],
        authorisingReceipt: { commandNamespace: 'AUTHORITY_GRANT_ISSUED', idempotencyKey },
        expectedAggregateRevisions: [{ aggregateRef: travellerRef(subject), expectedRevision: 1 }],
      }),
    );
    assert.equal(conflict.kind, 'STALE_AGGREGATE_REVISION');
    assert.equal(
      await count(f.pool, 'SELECT count(*) AS n FROM authority_grants WHERE workspace_id = $1', [f.workspaceId]),
      0,
    );
  });

  test('a grant can cite a receipt another committed command left behind', async () => {
    const f = await peopleFixture();
    const [subject] = f.travellerIds;
    const recordKey = nextKey(f);
    mustOk(
      await addTravellerContact(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: recordKey,
        travellerId: subject,
        expectedRevision: 1,
        contact: {
          channel: 'EMAIL',
          maskedLabel: 'a***@example.invalid',
          protectedValue: PROTECTED,
          effectiveRange: OPEN_RANGE,
          evidenceId: randomUUID(),
        },
      }),
    );

    const grant = await grantTo(f, ['traveller.profile.write'], {
      commandNamespace: 'TRAVELLER_CONTACT_ADDED',
      idempotencyKey: recordKey,
    });

    const cited = await scalar<{ ns: string | null; key: string | null }>(
      f.pool,
      `SELECT authorising_command_namespace AS ns, authorising_idempotency_key AS key
         FROM authority_grants WHERE workspace_id = $1 AND id = $2`,
      [f.workspaceId, grant.grantId],
    );
    assert.equal(cited.ns, 'TRAVELLER_CONTACT_ADDED');
    assert.equal(cited.key, recordKey, 'the grant stores the receipt that authorised it, not a paraphrase of it');
  });

  test('a grant cannot cite an assertion the idempotency ledger does not hold', async () => {
    const f = await peopleFixture();
    const [subject] = f.travellerIds;
    const recordedKey = nextKey(f);
    mustOk(
      await recordTraveller(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: recordedKey,
        displayName: {
          nameKind: 'LEGAL',
          displayValue: 'Cited Person',
          effectiveRange: OPEN_RANGE,
          evidenceId: randomUUID(),
        },
      }),
    );

    // The first citation names no receipt at all; the second names a key the
    // ledger does hold — but under a different command namespace, so the
    // three-part identity still fails.
    const citations = [
      { commandNamespace: 'TRAVELLER_RECORDED', idempotencyKey: 'never-issued' },
      { commandNamespace: 'TRAVELLER_CONTACT_ADDED', idempotencyKey: recordedKey },
    ];
    for (const citation of citations) {
      const conflict = conflictOf(
        await issueAuthorityGrant(unitOfWork(f), {
          workspaceId: f.workspaceId,
          actorPrincipalId: f.actorId,
          idempotencyKey: nextKey(f),
          principalId: f.principalId,
          representedPartyRef: travellerRef(subject),
          issuedByPrincipalId: f.issuedByPrincipalId,
          actions: ['traveller.profile.write'],
          scopes: [travellerRef(subject)],
          authorisingReceipt: citation,
          expectedAggregateRevisions: [],
        }),
      );
      assert.equal(conflict.kind, 'VALIDATION_FAILED');
      assert.match(conflict.message, /no committed command receipt/);
    }
    assert.equal(
      await count(f.pool, 'SELECT count(*) AS n FROM authority_grants WHERE workspace_id = $1', [f.workspaceId]),
      0,
      'an uncitable authorisation is refused before the grant row exists, not repaired at COMMIT',
    );
  });

  test('0019 defers the receipt FK so a same-transaction citation still commits', async () => {
    const f = await peopleFixture();
    const [subject] = f.travellerIds;
    const grant = await grantTo(f, ['traveller.profile.write']);

    // The grant's own receipt exists only because the deferrable FK let the
    // insert precede it, so the two rows are visible together after COMMIT.
    const paired = await count(
      f.pool,
      `SELECT count(*) AS n FROM authority_grants g
         JOIN command_receipts r
           ON r.workspace_id = g.workspace_id
          AND r.command_namespace = g.authorising_command_namespace
          AND r.idempotency_key = g.authorising_idempotency_key
        WHERE g.workspace_id = $1 AND g.id = $2`,
      [f.workspaceId, grant.grantId],
    );
    assert.equal(paired, 1);

    // Bypassing the handler removes the pre-check, so only the constraint is left.
    const message = await commitThatMustFail(f.pool, (client) =>
      runWithTransactionClient(client, () =>
        new PgGovernanceRepository(f.workspaceId).issueAuthorityGrant({
          grant: {
            id: randomUUID(),
            principalId: f.principalId,
            representedPartyRef: travellerRef(subject),
            issuedByPrincipalId: f.issuedByPrincipalId,
            issuedAt: at(0),
            actions: ['traveller.profile.write'],
            scopes: [travellerRef(subject)],
          },
          receipt: { commandNamespace: 'WILL_NEVER_BE_A_RECEIPT', idempotencyKey: 'never' },
          actor: { workspaceId: f.workspaceId, actorPrincipalId: f.actorId },
        }),
      ),
    );
    assert.match(message, /authority_grants_authorising_receipt_fk/);
  });
});

// ---------------------------------------------------------------------------
// 6. Merge, tenancy, revisions and replay
// ---------------------------------------------------------------------------

describe('M2 lane P: identity redirects, tenancy and replay', () => {
  test('a merge is an explicit redirect that leaves the surviving person untouched', async () => {
    const f = await peopleFixture();
    const [loser, survivor] = f.travellerIds;

    const merged = mustOk(
      await mergeTraveller(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        travellerId: loser,
        mergedIntoTravellerId: survivor,
        expectedRevision: 1,
      }),
    );
    assert.equal(merged.revision, 2);

    const loaded = await inRepositoryRead(f.pool, () =>
      new PgTravellerRepository(f.workspaceId).load(f.workspaceId, loser),
    );
    assert.ok(loaded);
    assert.equal(loaded.lifecycleStatus, 'MERGED');
    assert.equal(loaded.mergedIntoTravellerId, survivor, 'the redirect, not a delete, is the merge');

    const survivorState = await inRepositoryRead(f.pool, () =>
      new PgTravellerRepository(f.workspaceId).load(f.workspaceId, survivor),
    );
    assert.ok(survivorState);
    assert.equal(survivorState.revision, 1, 'the surviving person is not modified by being merged into');
    assert.equal(survivorState.lifecycleStatus, 'ACTIVE');
  });

  test('a person cannot merge into themselves', async () => {
    const f = await peopleFixture();
    const [person] = f.travellerIds;
    const conflict = conflictOf(
      await mergeTraveller(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        travellerId: person,
        mergedIntoTravellerId: person,
        expectedRevision: 1,
      }),
    );
    assert.equal(conflict.kind, 'VALIDATION_FAILED');
  });

  test('another workspace UUID is invisible to reads, registry resolution and writes', async () => {
    const owner = await peopleFixture();
    const other = await bareFixture();
    const [foreignTraveller] = owner.travellerIds;

    assert.equal(
      await inRepositoryRead(other.pool, () =>
        new PgTravellerRepository(other.workspaceId).load(other.workspaceId, foreignTraveller),
      ),
      undefined,
    );
    assert.equal(
      await new PgSubjectRegistryReadQueries(other.pool).resolve(other.workspaceId, travellerRef(foreignTraveller)),
      undefined,
      'the registry is keyed by (workspace, id), so a foreign id resolves to nothing',
    );
    assert.equal(
      await new PgSubjectRegistryReadQueries(owner.pool).resolve(owner.workspaceId, {
        kind: 'TRIP',
        id: foreignTraveller,
      }),
      undefined,
      'C1 (a): the right workspace and id with the wrong kind also resolves to nothing',
    );
    const resolved = await new PgSubjectRegistryReadQueries(owner.pool).resolve(
      owner.workspaceId,
      travellerRef(foreignTraveller),
    );
    assert.ok(resolved);
    assert.equal(resolved.revision, 1);

    const conflict = conflictOf(
      await addTravellerName(unitOfWork(other), {
        workspaceId: other.workspaceId,
        actorPrincipalId: other.actorId,
        idempotencyKey: nextKey(other),
        travellerId: foreignTraveller,
        expectedRevision: 1,
        name: {
          nameKind: 'DISPLAY',
          displayValue: 'Should Not Exist',
          effectiveRange: OPEN_RANGE,
          evidenceId: randomUUID(),
        },
      }),
    );
    // The head is keyed by (workspace, aggregate), so a foreign person has no
    // head here: execute() refuses the write before the handler runs, which is
    // the fail-closed half of the tenancy proof.
    assert.equal(conflict.kind, 'STALE_AGGREGATE_REVISION');
    assert.equal(
      await count(other.pool, 'SELECT count(*) AS n FROM traveller_names WHERE workspace_id = $1', [other.workspaceId]),
      0,
    );
  });

  test('a stale expected revision conflicts and writes nothing', async () => {
    const f = await peopleFixture();
    const [person] = f.travellerIds;
    mustOk(
      await addTravellerContact(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        travellerId: person,
        expectedRevision: 1,
        contact: {
          channel: 'PHONE',
          maskedLabel: '+00 *** **11',
          protectedValue: PROTECTED,
          effectiveRange: OPEN_RANGE,
          evidenceId: randomUUID(),
        },
      }),
    );

    const conflict = conflictOf(
      await addTravellerContact(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        travellerId: person,
        expectedRevision: 1,
        contact: {
          channel: 'PHONE',
          maskedLabel: '+00 *** **22',
          protectedValue: OTHER_PROTECTED,
          effectiveRange: OPEN_RANGE,
          evidenceId: randomUUID(),
        },
      }),
    );
    assert.equal(conflict.kind, 'STALE_AGGREGATE_REVISION');
    assert.equal(
      await count(f.pool, 'SELECT count(*) AS n FROM traveller_contacts WHERE workspace_id = $1', [f.workspaceId]),
      1,
    );
  });

  test('an unknown aggregate head is a typed conflict, not a silent create', async () => {
    const f = await bareFixture();
    const unknownTravellerId = randomUUID();
    const conflict = conflictOf(
      await addTravellerName(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        travellerId: unknownTravellerId,
        expectedRevision: 1,
        name: {
          nameKind: 'DISPLAY',
          displayValue: 'Nobody',
          effectiveRange: OPEN_RANGE,
          evidenceId: randomUUID(),
        },
      }),
    );
    // No head row exists for a never-seen id, so the revision gate is what
    // rejects the command: it refuses to invent an aggregate.
    assert.equal(conflict.kind, 'STALE_AGGREGATE_REVISION');
    assert.equal(
      await count(
        f.pool,
        'SELECT count(*) AS n FROM domain_subjects WHERE workspace_id = $1 AND id = $2',
        [f.workspaceId, unknownTravellerId],
      ),
      0,
      'a rejected name append must not register the person either',
    );
    assert.equal(
      await count(f.pool, 'SELECT count(*) AS n FROM traveller_names WHERE workspace_id = $1', [f.workspaceId]),
      0,
    );
  });

  test('equal-key replay returns the stored result without running the handler again', async () => {
    const f = await bareFixture();
    const context = {
      workspaceId: f.workspaceId,
      actorPrincipalId: f.actorId,
      idempotencyKey: 'm2-people:replay-once',
    };
    // The claim hash covers the normalised payload, ids included, so a replay
    // needs caller-supplied ids; see the auto-id case below.
    const travellerId = randomUUID();
    const displayNameId = randomUUID();
    const payload = {
      travellerId,
      displayName: {
        id: displayNameId,
        nameKind: 'DISPLAY' as const,
        displayValue: 'Replayed Person',
        effectiveRange: OPEN_RANGE,
        evidenceId: randomUUID(),
      },
    };
    const uow = unitOfWork(f);
    const first = await recordTraveller(uow, { ...context, ...payload });
    if (!first.ok) {
      assert.fail(`expected the first command to commit, got ${first.conflict.kind}`);
    }
    assert.equal(first.value.travellerId, travellerId);
    assert.equal(first.value.displayNameId, displayNameId);
    const secondOutcome = await recordTraveller(uow, { ...context, ...payload });
    if (!secondOutcome.ok) {
      assert.fail(`expected a replay, got ${secondOutcome.conflict.kind}: ${secondOutcome.conflict.message}`);
    }
    assert.deepEqual(secondOutcome.value, first.value);
    assert.equal(
      secondOutcome.receipt.resultRef,
      first.receipt.resultRef,
      'the replayed receipt returns the stored result string verbatim',
    );
    assert.deepEqual(secondOutcome.receipt.committedRevisions, first.receipt.committedRevisions);
    assert.deepEqual(
      JSON.parse(secondOutcome.receipt.resultRef) as TravellerRecordedResult,
      first.value,
      'the replayed result decodes to the same committed value, not a re-run of it',
    );
    assert.equal(
      await count(f.pool, 'SELECT count(*) AS n FROM travellers WHERE workspace_id = $1', [f.workspaceId]),
      1,
      'replay must not register the person a second time',
    );
    assert.equal(
      await count(f.pool, 'SELECT count(*) AS n FROM change_records WHERE workspace_id = $1', [f.workspaceId]),
      1,
      'the audit trail is appended once, by the command that actually committed',
    );
  });

  test('a command that mints its own ids is replayable only when the caller pins them', async () => {
    const f = await bareFixture();
    const context = {
      workspaceId: f.workspaceId,
      actorPrincipalId: f.actorId,
      idempotencyKey: 'm2-people:replay-auto-id',
    };
    const payload = {
      displayName: {
        nameKind: 'DISPLAY' as const,
        displayValue: 'Auto Id Person',
        effectiveRange: OPEN_RANGE,
        evidenceId: randomUUID(),
      },
    };
    const uow = unitOfWork(f);
    mustOk(await recordTraveller(uow, { ...context, ...payload }));

    // C1 (c) requires ids to exist before the retryable body runs, and the claim
    // hash covers those ids, so an auto-minted create has no byte-stable payload
    // to compare against: the second call is a different command as far as the
    // ledger is concerned.
    const conflict = conflictOf(await recordTraveller(uow, { ...context, ...payload }));
    assert.equal(conflict.kind, 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');
    assert.equal(
      await count(f.pool, 'SELECT count(*) AS n FROM travellers WHERE workspace_id = $1', [f.workspaceId]),
      1,
      'the refused call never reaches the handler, so no second identity appears',
    );
    assert.equal(
      await count(f.pool, 'SELECT count(*) AS n FROM change_records WHERE workspace_id = $1', [f.workspaceId]),
      1,
    );
  });

  test('reusing an idempotency key for a different payload is a typed mismatch', async () => {
    const f = await bareFixture();
    const context = {
      workspaceId: f.workspaceId,
      actorPrincipalId: f.actorId,
      idempotencyKey: 'm2-people:replay-conflict',
    };
    const uow = unitOfWork(f);
    mustOk(
      await recordTraveller(uow, {
        ...context,
        displayName: {
          nameKind: 'DISPLAY',
          displayValue: 'First',
          effectiveRange: OPEN_RANGE,
          evidenceId: randomUUID(),
        },
      }),
    );
    const conflict = conflictOf(
      await recordTraveller(uow, {
        ...context,
        displayName: {
          nameKind: 'DISPLAY',
          displayValue: 'Second',
          effectiveRange: OPEN_RANGE,
          evidenceId: randomUUID(),
        },
      }),
    );
    assert.match(conflict.kind, /IDEMPOTENCY/);
    assert.equal(
      await count(f.pool, 'SELECT count(*) AS n FROM travellers WHERE workspace_id = $1', [f.workspaceId]),
      1,
    );
  });

  test('a result is replayable through the receipt JSON convention (C1 d)', async () => {
    const f = await bareFixture();
    const uow = unitOfWork(f);
    const outcome = await recordTraveller(uow, {
      workspaceId: f.workspaceId,
      actorPrincipalId: f.actorId,
      idempotencyKey: nextKey(f),
      displayName: {
        nameKind: 'DISPLAY',
        displayValue: 'Receipt Person',
        effectiveRange: OPEN_RANGE,
        evidenceId: randomUUID(),
      },
    });
    if (!outcome.ok) assert.fail('expected the command to commit');
    const decoded = JSON.parse(outcome.receipt.resultRef) as TravellerRecordedResult;
    assert.deepEqual(decoded, outcome.value, 'resultRef is the committed result, not an opaque pointer');
    assert.equal(typeof outcome.receipt.payloadHash, 'string');
    assert.ok(outcome.receipt.committedRevisions.length >= 1);
  });

  test('the typed payload never carries a plaintext secret into the audit trail', async () => {
    const f = await bareFixture();
    mustOk(
      await recordTraveller(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        displayName: {
          nameKind: 'LEGAL',
          displayValue: 'Known As',
          effectiveRange: OPEN_RANGE,
          evidenceId: randomUUID(),
        },
        contacts: [
          {
            channel: 'EMAIL',
            maskedLabel: 'a***@example.invalid',
            protectedValue: { ...PROTECTED, storageRef: PROTECTED_SENTINEL },
            effectiveRange: OPEN_RANGE,
            evidenceId: randomUUID(),
          },
        ],
      }),
    );
    const leaked = await count(
      f.pool,
      `SELECT count(*) AS n FROM outbox WHERE workspace_id = $1 AND payload::text LIKE $2`,
      [f.workspaceId, `%${PROTECTED_SENTINEL}%`],
    );
    assert.equal(leaked, 0, 'a storage reference is an opaque locator, so it must not reach a general-purpose fan-out payload');
  });
});

// ---------------------------------------------------------------------------
// 7. Governance roots
// ---------------------------------------------------------------------------

describe('M2 lane P: organisations and principals are distinct parties', () => {
  test('each registers its own root, typed row and kind, and neither is a Traveller', async () => {
    const f = await bareFixture();
    const uow = unitOfWork(f);
    const organisationId = randomUUID();
    const principalId = randomUUID();
    mustOk(
      await createOrganisation(uow, {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        organisationId,
        legalName: 'Party Co',
        displayName: 'Party',
        defaultCurrencyCode: 'AUD',
      }),
    );
    mustOk(
      await createPrincipal(uow, {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        principalId,
        actorType: 'HUMAN',
        authIssuer: 'https://issuer.invalid/m2-people',
        authSubject: principalId,
      }),
    );

    const kinds = await scalar<{ kinds: string[] }>(
      f.pool,
      `SELECT array_agg(kind ORDER BY kind) AS kinds FROM domain_subjects
        WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
      [f.workspaceId, [organisationId, principalId]],
    );
    assert.deepEqual(kinds.kinds, ['ORGANISATION', 'PRINCIPAL']);

    const repository = () => new PgGovernanceRepository(f.workspaceId);
    const organisation = await inRepositoryRead(f.pool, () => repository().loadOrganisation(f.workspaceId, organisationId));
    const principal = await inRepositoryRead(f.pool, () => repository().loadPrincipal(f.workspaceId, principalId));
    assert.equal(organisation?.legalName, 'Party Co');
    assert.equal(organisation?.defaultCurrencyCode, 'AUD');
    assert.equal(principal?.actorType, 'HUMAN');
  });

  test('a currency is a stated business fact, not a default', async () => {
    const f = await bareFixture();
    const conflict = conflictOf(
      await createOrganisation(unitOfWork(f), {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorId,
        idempotencyKey: nextKey(f),
        legalName: 'No Currency Co',
        defaultCurrencyCode: 'DOLLARS',
      }),
    );
    assert.equal(conflict.kind, 'VALIDATION_FAILED');
    assert.equal(
      await count(f.pool, 'SELECT count(*) AS n FROM organisations WHERE workspace_id = $1', [f.workspaceId]),
      0,
    );
  });

  test('a membership commits whole and 0011 owns the overlap rule', async () => {
    const f = await peopleFixture();
    const repository = new PgGovernanceRepository(f.workspaceId);
    const actor = { workspaceId: f.workspaceId, actorPrincipalId: f.actorId };
    const add = (membership: {
      id: string;
      role: 'STAFF' | 'AGENT' | 'MEMBER';
      validRange: { start: string; end?: string };
      evidenceId: string;
    }) =>
      commitWrite(f.pool, (client) =>
        runWithTransactionClient(client, () =>
          repository.recordMembership({
            membership: { ...membership, organisationId: f.organisationId, principalId: f.principalId },
            actor,
          }),
        ),
      );

    const firstId = randomUUID();
    const firstEvidenceId = randomUUID();
    await add({ id: firstId, role: 'STAFF', validRange: { start: day(0), end: day(90) }, evidenceId: firstEvidenceId });

    const stored = await scalar<{
      role: string;
      valid_from: string;
      valid_until: string | null;
      evidence_id: string;
      created_by_actor_id: string;
    }>(
      f.pool,
      `SELECT role, valid_from::text AS valid_from, valid_until::text AS valid_until,
              evidence_id, created_by_actor_id
         FROM organisation_memberships WHERE workspace_id = $1 AND id = $2`,
      [f.workspaceId, firstId],
    );
    assert.deepEqual(stored, {
      role: 'STAFF',
      valid_from: day(0),
      valid_until: day(90),
      evidence_id: firstEvidenceId,
      created_by_actor_id: f.actorId,
    });

    // The exclusion constraint, not the repository, decides what a duplicate is.
    const overlap = await commitThatMustFail(f.pool, (client) =>
      runWithTransactionClient(client, () =>
        repository.recordMembership({
          membership: {
            id: randomUUID(),
            organisationId: f.organisationId,
            principalId: f.principalId,
            role: 'STAFF',
            validRange: { start: day(45), end: day(120) },
            evidenceId: randomUUID(),
          },
          actor,
        }),
      ),
    );
    assert.match(overlap, /organisation_memberships_no_overlap/);

    await add({ id: randomUUID(), role: 'AGENT', validRange: { start: day(0), end: day(90) }, evidenceId: randomUUID() });
    await add({ id: randomUUID(), role: 'STAFF', validRange: { start: day(90) }, evidenceId: randomUUID() });
    assert.equal(
      await count(f.pool, 'SELECT count(*) AS n FROM organisation_memberships WHERE workspace_id = $1', [
        f.workspaceId,
      ]),
      3,
      'a different role in the same window and a later window for the same role are both legitimate facts',
    );
  });

  test('a membership cannot borrow a party or omit the evidence that states it', async () => {
    const f = await peopleFixture();
    const other = await bareFixture();
    mustOk(
      await createOrganisation(unitOfWork(other), {
        workspaceId: other.workspaceId,
        actorPrincipalId: other.actorId,
        idempotencyKey: `m2-people-other:${other.workspaceId.slice(0, 8)}`,
        organisationId: randomUUID(),
        legalName: 'Other Co',
        defaultCurrencyCode: 'NZD',
      }),
    );
    const foreignOrganisationId = await scalar<{ id: string }>(
      other.pool,
      'SELECT id::text AS id FROM organisations WHERE workspace_id = $1',
      [other.workspaceId],
    );

    const actor = { workspaceId: f.workspaceId, actorPrincipalId: f.actorId };
    const borrowed = await commitThatMustFail(f.pool, (client) =>
      runWithTransactionClient(client, () =>
        new PgGovernanceRepository(f.workspaceId).recordMembership({
          membership: {
            id: randomUUID(),
            organisationId: foreignOrganisationId.id,
            principalId: f.principalId,
            role: 'STAFF',
            validRange: OPEN_RANGE,
            evidenceId: randomUUID(),
          },
          actor,
        }),
      ),
    );
    assert.match(borrowed, /organisation_memberships_organisation_fk/);

    // 0011 makes provenance NOT NULL, so a write shape that cannot supply an
    // evidence reference could never commit — the reason membership is written by
    // its own operation instead of nested inside an organisation create.
    const unproven = await commitThatMustFail(f.pool, async (client) => {
      await client.query(
        `INSERT INTO organisation_memberships
           (workspace_id, id, organisation_id, principal_id, role, valid_from, evidence_id, created_by_actor_id)
         VALUES ($1, $2, $3, $4, 'STAFF', $5::date, NULL, $6)`,
        [f.workspaceId, randomUUID(), f.organisationId, f.principalId, day(0), f.actorId],
      );
    });
    assert.match(unproven, /null value in column "evidence_id"/);
  });
});

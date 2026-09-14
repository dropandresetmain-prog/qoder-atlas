/**
 * M2 C1 evidence: fail-closed typed-subject registration, lane-independent.
 *
 * This file is the integrator's own proof of the four C1 amendments as they
 * apply to the identity registry. It deliberately depends on nothing any M2
 * lane wrote — only on `m2Seed.ts` and raw SQL — so the acceptance evidence for
 * the pattern M3/M4/M5 must copy cannot be produced by the same code it audits.
 *
 * Two mechanisms are proven separately, because conflating them is the classic
 * way this pattern rots:
 * - the **deferred subtype constraint trigger** (0010 dispatcher → per-kind
 *   checker) decides whether a `domain_subjects` row may exist at all;
 * - the **unique index** `(workspace_id, id, kind)` (0019) is what lets an
 *   ordinary composite FK reject a correct UUID cited under the wrong kind.
 *
 * Negative cases use `SET CONSTRAINTS … IMMEDIATE` wherever the outcome is only
 * about the trigger, so the whole transaction (including any probe function or
 * probe table it creates) is rolled back and the shared test database keeps no
 * residue for the next lane.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import {
  beginSeed,
  commitSeed,
  rollbackSeed,
  seedChildSubject,
  seedCredential,
  seedJourneyItem,
  seedJourney,
  seedRootSubject,
  seedTraveller,
  seedTrip,
} from './m2Seed.ts';
import { PgSubjectRegistryReadQueries, typedRefKey } from '../src/persistence/postgres/queries/pgSubjectRegistryReadQueries.ts';

/** Kinds M2 activates — must match docs/refactor/evidence/M2.md exactly. */
const M2_ACTIVATED_KINDS = [
  'ORGANISATION',
  'PRINCIPAL',
  'TRAVELLER',
  'TRAVELLER_RELATIONSHIP',
  'RESPONSIBILITY_ASSIGNMENT',
  'AUTHORITY_GRANT',
  'TRIP',
  'JOURNEY',
  'JOURNEY_ITEM',
  'COORDINATION_GROUP',
  'SUPPORT_ASSIGNMENT',
];

/** Kinds M3 activates — must match docs/refactor/evidence/M3.md exactly. */
const M3_ACTIVATED_KINDS = [
  'TRANSPORT_SERVICE',
  'RESOURCE',
  'RESERVATION',
  'RESERVATION_LINE',
  'SERVICE_ENTITLEMENT',
  'OFFER',
  'COMMERCIAL_AGREEMENT',
  'EXTERNAL_CONNECTION',
  'EXTERNAL_RECORD',
  'OWNERSHIP_BINDING',
  'BUDGET',
];

/**
 * Kinds M4 activates — must match docs/refactor/evidence/M4.md exactly.
 * Added when M4 landed on this branch: EVENT/PROGRAMME/PROGRAMME_ITEM/
 * PARTICIPATION/PLACE/GEOGRAPHIC_AREA/JURISDICTION now have installed
 * checkers, so the "no M3/M4/M5 kind leaked a checker" invariant below is
 * scoped to M3/M5 from this point on — M4's own activation is expected,
 * not a leak.
 */
const M4_ACTIVATED_KINDS = [
  'EVENT',
  'PROGRAMME',
  'PROGRAMME_ITEM',
  'PARTICIPATION',
  'PLACE',
  'GEOGRAPHIC_AREA',
  'JURISDICTION',
];

describe('M2 fail-closed typed-subject registration (real PostgreSQL)', () => {
  test('every registered subtype checker function is actually installed', async () => {
    const pool = await sharedTestPool();
    const orphans = await pool.query<{ kind: string; checker_function: string }>(
      `SELECT c.kind, c.checker_function
         FROM subject_subtype_checkers c
         LEFT JOIN pg_proc p ON p.proname = c.checker_function
         WHERE p.oid IS NULL`,
    );
    assert.deepEqual(orphans.rows, []);

    const registered = await pool.query<{ kind: string }>(
      'SELECT kind FROM subject_subtype_checkers ORDER BY kind',
    );
    const kinds = registered.rows.map((row) => row.kind);
    assert.ok(kinds.includes('WORKSPACE'), 'M1 WORKSPACE branch must survive the dispatcher rewrite');
    for (const kind of M2_ACTIVATED_KINDS) {
      assert.ok(kinds.includes(kind), `${kind} must have an installed subtype checker`);
    }
  });

  test('only integrated-lane kinds have checkers; unintegrated kinds stay closed', async () => {
    const pool = await sharedTestPool();
    const leaked = await pool.query<{ kind: string }>(
      `SELECT kind FROM subject_subtype_checkers
        WHERE kind <> ALL($1::text[])`,
      [[...M2_ACTIVATED_KINDS, ...M3_ACTIVATED_KINDS, ...M4_ACTIVATED_KINDS, 'WORKSPACE']],
    );
    assert.deepEqual(leaked.rows, [], 'no kind outside the integrated M2/M3/M4 lanes may install a subtype checker');

    // The kinds are pre-registered (that is the frozen contract) but unactivated.
    const pending = await pool.query<{ kind: string }>(
      `SELECT k.kind FROM subject_kinds k
        WHERE NOT EXISTS (SELECT 1 FROM subject_subtype_checkers c WHERE c.kind = k.kind)`,
    );
    const pendingKinds = pending.rows.map((row) => row.kind);
    for (const kind of ['ASSESSMENT']) {
      assert.ok(pendingKinds.includes(kind), `${kind} must remain registered-but-unactivated`);
    }
  });

  test('a pre-registered kind with no checker cannot commit even with a head row', async () => {
    const pool = await sharedTestPool();
    for (const kind of ['ASSESSMENT']) {
      const seed = await beginSeed(pool, `M2 closed ${kind}`);
      await seedRootSubject(seed, { kind });
      await assert.rejects(
        () => commitSeed(seed),
        /has no installed typed-table enforcement/i,
        `${kind} must fail closed`,
      );
      await rollbackSeed(seed);
    }
  });

  test('an activated subject cannot commit without its typed row', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'M2 missing typed row');
    await seedRootSubject(seed, { kind: 'TRAVELLER' });
    await assert.rejects(() => commitSeed(seed), /subtype violation: TRAVELLER .* has no travellers row/i);
    await rollbackSeed(seed);
  });

  test('a registry row + head + typed row commit as one atomic unit', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'M2 atomic commit');
    const { travellerId } = await seedTraveller(seed, { displayName: 'Atomic Traveller' });
    const credential = await seedCredential(seed, { travellerId, kind: 'VISA' });
    await commitSeed(seed);

    const stored = await pool.query<{ subjects: string; versions: string }>(
      `SELECT
         (SELECT count(*) FROM domain_subjects WHERE workspace_id = $1 AND kind = 'TRAVELLER') AS subjects,
         (SELECT count(*) FROM credential_versions WHERE workspace_id = $1) AS versions`,
      [seed.workspaceId],
    );
    assert.equal(Number(stored.rows[0]?.subjects), 1);
    assert.equal(Number(stored.rows[0]?.versions), 1);
    assert.ok(credential.versionId);
  });

  test('a failed commit leaves no partial subject, head or typed row', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'M2 aborted commit');
    const travellerId = await seedRootSubject(seed, { kind: 'TRAVELLER' });
    // The travellers row exists, but the display name it must reference does not.
    await seed.client.query(
      `INSERT INTO travellers (workspace_id, id, display_name_ref, created_by_actor_id)
       VALUES ($1, $2, $3, $4)`,
      [seed.workspaceId, travellerId, randomUUID(), seed.actorId],
    );
    await assert.rejects(() => commitSeed(seed), /subtype violation|foreign key/i);
    await rollbackSeed(seed);

    const residue = await pool.query<{ total: string }>(
      `SELECT (SELECT count(*) FROM domain_subjects WHERE workspace_id = $1)
            + (SELECT count(*) FROM aggregate_heads WHERE workspace_id = $1)
            + (SELECT count(*) FROM travellers WHERE workspace_id = $1) AS total`,
      [seed.workspaceId],
    );
    assert.equal(Number(residue.rows[0]?.total), 0);
  });

  test('an aggregate head cannot commit without its registry subject row', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'M2 head without subject');
    await seed.client.query('INSERT INTO aggregate_heads (workspace_id, aggregate_id, revision) VALUES ($1, $2, 1)', [
      seed.workspaceId,
      randomUUID(),
    ]);
    await assert.rejects(() => commitSeed(seed), /violates foreign key constraint|aggregate_heads_subject_fk/i);
    await rollbackSeed(seed);
  });

  test('a subject cannot borrow another workspace aggregate head', async () => {
    const pool = await sharedTestPool();
    const owner = await beginSeed(pool, 'M2 aggregate owner');
    const { travellerId } = await seedTraveller(owner);
    await commitSeed(owner);

    const borrower = await beginSeed(pool, 'M2 aggregate borrower');
    await seedChildSubject(borrower, { id: randomUUID(), kind: 'JOURNEY_ITEM', aggregateId: travellerId });
    await assert.rejects(() => commitSeed(borrower), /violates foreign key constraint|domain_subjects_aggregate_fk/i);
    await rollbackSeed(borrower);
  });

  test('a registered checker whose function is missing still fails closed', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'M2 phantom checker');
    try {
      await seed.client.query(
        `INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by)
         VALUES ('ASSESSMENT', 'enforce_subject_subtype_assessment', 'M2-probe')`,
      );
      await seedRootSubject(seed, { kind: 'ASSESSMENT' });
      await assert.rejects(
        () => seed.client.query('SET CONSTRAINTS domain_subjects_subtype_check IMMEDIATE'),
        /registered for kind ASSESSMENT is not installed/i,
      );
    } finally {
      await rollbackSeed(seed);
    }
  });

  test('a lane can activate its own kind without touching the dispatcher', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'M2 extension contract');
    const probeTable = 'm2_probe_assessment_subject';
    const probeFunction = 'enforce_subject_subtype_probe_assessment';
    try {
      // Exactly the two steps 0010 documents as the lane's whole obligation.
      await seed.client.query(
        `CREATE TABLE ${probeTable} (
           workspace_id uuid NOT NULL REFERENCES workspaces (id),
           id uuid NOT NULL PRIMARY KEY
         )`,
      );
      await seed.client.query(
        `CREATE FUNCTION ${probeFunction}(
           p_workspace_id uuid, p_id uuid, p_kind text, p_aggregate_id uuid
         ) RETURNS void LANGUAGE plpgsql AS $fn$
         BEGIN
           IF NOT EXISTS (SELECT 1 FROM ${probeTable} t
                           WHERE t.workspace_id = p_workspace_id AND t.id = p_id) THEN
             RAISE EXCEPTION 'domain_subjects subtype violation: ASSESSMENT subject % has no % row',
               p_id, '${probeTable}';
           END IF;
         END;
         $fn$`,
      );
      await seed.client.query(
        `INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by)
         VALUES ('ASSESSMENT', $1, 'M2-probe')`,
        [probeFunction],
      );

      const subjectId = await seedRootSubject(seed, { kind: 'ASSESSMENT' });
      await seed.client.query(`INSERT INTO ${probeTable} (workspace_id, id) VALUES ($1, $2)`, [
        seed.workspaceId,
        subjectId,
      ]);
      await seed.client.query('SET CONSTRAINTS domain_subjects_subtype_check IMMEDIATE');

      // Negative control in the same probe: the lane's own checker is what gates
      // the kind, so a second subject with no backer row is rejected outright.
      await assert.rejects(
        () => seedRootSubject(seed, { kind: 'ASSESSMENT' }),
        /subtype violation: ASSESSMENT .* has no .* row/i,
      );
    } finally {
      await rollbackSeed(seed);
    }

    // The rolled-back transaction must leave the shared registry untouched.
    const residue = await pool.query<{ checkers: string; functions: string; tables: string; subjects: string }>(
      `SELECT
         (SELECT count(*) FROM subject_subtype_checkers WHERE kind = 'ASSESSMENT') AS checkers,
         (SELECT count(*) FROM pg_proc WHERE proname = 'enforce_subject_subtype_probe_assessment') AS functions,
         (SELECT count(*) FROM pg_class WHERE relname = 'm2_probe_assessment_subject') AS tables,
         (SELECT count(*) FROM domain_subjects WHERE kind = 'ASSESSMENT') AS subjects`,
    );
    assert.deepEqual(residue.rows[0], { checkers: '0', functions: '0', tables: '0', subjects: '0' });
  });

  test('(workspace_id, id, kind) is a real discriminating FK target', async () => {
    const pool = await sharedTestPool();

    // M2's own schema already uses it: a reference may not relabel an existing subject.
    const discriminating = await pool.query<{ conname: string; def: string }>(
      `SELECT con.conname AS conname, pg_get_constraintdef(con.oid) AS def
         FROM pg_constraint con
        WHERE con.confrelid = 'domain_subjects'::regclass
          AND con.contype = 'f'
          AND pg_get_constraintdef(con.oid) LIKE '%(workspace_id, id, kind)%'`,
    );
    const constraintNames = discriminating.rows.map((row) => row.conname);
    assert.ok(constraintNames.includes('grant_scopes_subject_fk'));
    assert.ok(constraintNames.includes('authority_grants_represented_party_fk'));

    const seed = await beginSeed(pool, 'M2 discriminating fk');
    const { travellerId } = await seedTraveller(seed);
    const tripId = await seedTrip(seed);
    try {
      // A surrogate key, so a second row citing the same subject with a relabelled
      // kind is rejected by the FK and not merely by a duplicate primary key.
      await seed.client.query(
        `CREATE TABLE m2_probe_typed_ref (
           probe_id uuid NOT NULL PRIMARY KEY,
           workspace_id uuid NOT NULL,
           ref_id uuid NOT NULL,
           ref_kind text NOT NULL,
           CONSTRAINT m2_probe_typed_ref_subject_fk
             FOREIGN KEY (workspace_id, ref_id, ref_kind)
             REFERENCES domain_subjects (workspace_id, id, kind)
         )`,
      );
      const insertProbe = (refId: string, refKind: string) =>
        seed.client.query('INSERT INTO m2_probe_typed_ref VALUES ($1, $2, $3, $4)', [
          randomUUID(),
          seed.workspaceId,
          refId,
          refKind,
        ]);

      // Each rejection aborts the transaction, so probe from a savepoint and
      // rewind — that keeps the positive rows intact and lets one test prove
      // both relabelling directions.
      const expectRejectedRef = async (refId: string, refKind: string) => {
        await seed.client.query('SAVEPOINT typed_ref_probe');
        let failure = 'the statement was accepted';
        try {
          await insertProbe(refId, refKind);
        } catch (error) {
          failure = (error as Error).message;
        }
        await seed.client.query('ROLLBACK TO SAVEPOINT typed_ref_probe');
        assert.match(
          failure,
          /violates foreign key constraint "m2_probe_typed_ref_subject_fk"/i,
          `${refKind}:${refId} must not satisfy a typed reference`,
        );
      };

      await insertProbe(travellerId, 'TRAVELLER');
      await insertProbe(tripId, 'TRIP');
      await expectRejectedRef(travellerId, 'TRIP');
      await expectRejectedRef(tripId, 'JOURNEY');
    } finally {
      await rollbackSeed(seed);
    }
  });

  test('registry reads resolve a TypedRef by kind, not by UUID', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'M2 registry reads');
    const { travellerId } = await seedTraveller(seed);
    const tripId = await seedTrip(seed);
    const journeyId = await seedJourney(seed, { tripId, travellerId });
    const { journeyItemId } = await seedJourneyItem(seed, { journeyId, kind: 'STAY' });
    await commitSeed(seed);

    const queries = new PgSubjectRegistryReadQueries(pool);
    assert.deepEqual(await queries.resolve(seed.workspaceId, { kind: 'TRAVELLER', id: travellerId }), {
      aggregateId: travellerId,
      revision: 1,
    });
    assert.equal(await queries.resolve(seed.workspaceId, { kind: 'TRIP', id: travellerId }), undefined);
    assert.equal(await queries.resolve(seed.workspaceId, { kind: 'TRAVELLER', id: journeyItemId }), undefined);

    const batch = await queries.resolveAll(seed.workspaceId, [
      { kind: 'TRAVELLER', id: travellerId },
      { kind: 'TRIP', id: travellerId },
      { kind: 'JOURNEY', id: journeyId },
      { kind: 'JOURNEY_ITEM', id: journeyItemId },
      { kind: 'COORDINATION_GROUP', id: randomUUID() },
    ]);
    assert.equal(batch.size, 3);
    assert.equal(batch.get(typedRefKey({ kind: 'JOURNEY_ITEM', id: journeyItemId }))?.aggregateId, journeyId);
    assert.equal(batch.get(typedRefKey({ kind: 'JOURNEY', id: journeyId }))?.aggregateId, journeyId);
    assert.ok(batch.has(typedRefKey({ kind: 'TRAVELLER', id: travellerId })));
  });

  test('JOURNEY_ITEM is a child subject that shares its Journey revision counter', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'M2 child aggregate');
    const { travellerId } = await seedTraveller(seed);
    const tripId = await seedTrip(seed);
    const journeyId = await seedJourney(seed, { tripId, travellerId });
    const { journeyItemId } = await seedJourneyItem(seed, { journeyId, kind: 'TRANSPORT' });
    await commitSeed(seed);

    const heads = await pool.query<{ count: string }>(
      'SELECT count(*) AS count FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2',
      [seed.workspaceId, journeyItemId],
    );
    assert.equal(Number(heads.rows[0]?.count), 0, 'a child subject must not own a revision counter');

    const subject = await pool.query<{ aggregate_id: string }>(
      'SELECT aggregate_id::text AS aggregate_id FROM domain_subjects WHERE workspace_id = $1 AND id = $2',
      [seed.workspaceId, journeyItemId],
    );
    assert.equal(subject.rows[0]?.aggregate_id, journeyId);
  });

  test('immutable M2 tables are protected by the append-only trigger', async () => {
    const pool = await sharedTestPool();
    const expected = [
      'profile_assertions',
      'credential_versions',
      'credential_links',
      'travel_history',
      'accompaniment_requirements',
      'passport_details',
      'visa_details',
      'residence_credential_details',
      'health_credential_details',
    ];
    const guarded = await pool.query<{ table_name: string }>(
      `SELECT rel.relname AS table_name
         FROM pg_trigger tg
         JOIN pg_class rel ON rel.oid = tg.tgrelid
         JOIN pg_proc p ON p.oid = tg.tgfoid
        WHERE NOT tg.tgisinternal AND p.proname = 'forbid_mutation' AND (tg.tgtype & 2) <> 0`,
    );
    const guardedNames = guarded.rows.map((row) => row.table_name);
    for (const table of expected) {
      assert.ok(guardedNames.includes(table), `${table} must reject UPDATE via forbid_mutation`);
    }
  });

  test('the schema contains no supported-flag boolean, fixture column or JSON fact bucket', async () => {
    const pool = await sharedTestPool();
    const scenarioLeaks = await pool.query<{ column_name: string }>(
      `SELECT DISTINCT column_name FROM information_schema.columns
        WHERE table_schema = 'public'
           AND (column_name ~* '(^|_)(city|scenario|fixture|demo|sarah|template)($|_)'
                OR column_name ~* 'is_supported|has_support|supported_flag')
           AND NOT (table_name = 'provider_capabilities' AND column_name = 'supported')`,
    );
    assert.deepEqual(scenarioLeaks.rows, [], 'support must be modelled as requirement + assignment, never a flag');

    // Bounded opaque preference detail (§10) is permitted and shape-checked;
    // an unbounded catch-all bag is not. A new jsonb column must be justified
    // here, which is the point of the allowlist.
    const envelopeTables = ['outbox', 'inbox', 'inbox_deliveries', 'inbox_delivery_conflicts', 'schema_migrations', 'command_receipts', 'migration_runs', 'workspaces', 'change_records'];
    const boundedJsonColumns = [
      'profile_assertions.value',
      'authority_grants.limits',
      'stay_item_details.occupancy_needs',
      'resource_use_item_details.use_requirements',
      'reservations.observed_context',
      'reservation_lines.observed_terms',
      'external_connections.capability_configuration',
      'provider_capabilities.provider_details',
      'offers.terms',
      'agreement_versions.published_terms',
      'stay_line_details.occupancy',
      // M4 (0056): bounded operating-requirement detail nothing reverse-looks-up,
      // shape-checked by programme_items_operating_requirements_shape.
      'programme_items.operating_requirements',
    ];
    const jsonColumns = await pool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND data_type = 'jsonb'`,
    );
    const unapproved = jsonColumns.rows
      .filter((row) => !envelopeTables.includes(row.table_name))
      .filter((row) => !boundedJsonColumns.includes(`${row.table_name}.${row.column_name}`));
    assert.deepEqual(unapproved, [], 'only documented bounded payloads may be jsonb');

    // The rule that actually protects M6/M9: nothing is *indexed* into JSON, so
    // every reverse lookup stays a plain column/index operation.
    const jsonIndexes = await pool.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND indexdef ~* '->|->>|jsonb_'`,
    );
    assert.deepEqual(jsonIndexes.rows, [], 'a JSON-expressing index would mean M6 must parse JSON');

    const catchAlls = await pool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name ~* '^(metadata|attributes|properties|extra|facts|details|data|payload)$'
          AND table_name <> ALL($1::text[])`,
      [envelopeTables],
    );
    assert.deepEqual(catchAlls.rows, [], 'business payload must be typed columns, per DATA_STRUCTURE_LOGICAL_SCHEMA.md §10');
  });
});

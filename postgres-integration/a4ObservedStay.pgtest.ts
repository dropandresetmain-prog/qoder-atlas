/** Atomic provider-observed STAY attachment against the real PostgreSQL target. */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed, seedChildSubject, seedExternalConnection, seedJourney, seedOrganisation, seedPlace, seedRootSubject, seedTraveller, seedTrip, takeSeedEvidence } from './m3Seed.ts';
import { seedCredential } from './m2Seed.ts';
import { seedJurisdiction } from './m4Seed.ts';
import { seedJourneyItem } from './m2Seed.ts';
import { PgUnitOfWork, type ExecuteOutcome } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { attachObservedStay, type ObservedStayAttachmentParams } from '../src/persistence/postgres/commands/observedStayCommands.ts';

const OBSERVED_AT = '2030-01-01T00:00:00.000Z';
const STAY_START = '2030-01-02T15:00:00.000Z';
const STAY_END = '2030-01-05T11:00:00.000Z';

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

function mustOk<T>(outcome: ExecuteOutcome<T>): T {
  if (!outcome.ok) assert.fail(`${outcome.conflict.kind}: ${outcome.conflict.message}`);
  return outcome.value;
}

async function setup(options: { externalId?: string; recordState?: 'UNVERIFIED' | 'QUARANTINED_UNKNOWN'; existingJourneyItem?: boolean } = {}) {
  const pool = await sharedTestPool();
  const seed = await beginSeed(pool, 'A4 observed stay fixture');
  const organisationId = await seedOrganisation(seed);
  const traveller = await seedTraveller(seed, { displayName: 'A4 Traveller' });
  const tripId = await seedTrip(seed, { lifecycleStatus: 'ACTIVE' });
  const journeyId = await seedJourney(seed, { tripId, travellerId: traveller.travellerId, lifecycleStatus: 'DRAFT' });
  const placeId = await seedPlace(seed, { name: 'A4 Stay Place' });
  const jurisdictionId = await seedJurisdiction(seed, { name: 'A4 Stay Jurisdiction' });
  const credential = await seedCredential(seed, { travellerId: traveller.travellerId, issuerCountry: 'SG', expiryDate: '2040-01-01' });
  const existingVisitId = randomUUID();
  await seed.client.query(
    `INSERT INTO intended_visits
       (workspace_id,id,journey_id,jurisdiction_id,purpose,intended_start,intended_end,created_by_actor_id)
     VALUES ($1,$2,$3,$4,'BUSINESS',$5,$6,$7)`,
    [seed.workspaceId, existingVisitId, journeyId, jurisdictionId, '2030-01-01T00:00:00Z', '2030-01-06T00:00:00Z', seed.actorId],
  );
  const existingJourneyItem = options.existingJourneyItem
    ? await seedJourneyItem(seed, { journeyId, kind: 'TRANSPORT', orderKey: 'existing-transport' })
    : undefined;
  const connectionId = await seedExternalConnection(seed, organisationId);
  const externalId = options.externalId ?? `booking-${randomUUID()}`;
  const externalRecordId = randomUUID();
  await seedChildSubject(seed, { id: externalRecordId, kind: 'EXTERNAL_RECORD', aggregateId: connectionId });
  {
    await seed.client.query(
      `INSERT INTO external_records
         (workspace_id,id,connection_id,record_type,external_id,identity_state,quarantine_reason,observed_at,payload_hash,created_by_actor_id)
       VALUES ($1,$2,$3,'STAY_BOOKING',$4,$5,$6,'2030-01-01T00:00:00.000Z',$7,$8)`,
      [seed.workspaceId, externalRecordId, connectionId, externalId, options.recordState ?? 'UNVERIFIED', options.recordState === 'QUARANTINED_UNKNOWN' ? 'seeded quarantine' : null, 'sha256:' + externalId, seed.actorId],
    );
  }
  await commitSeed(seed);
  return { pool, seed, organisationId, travellerId: traveller.travellerId, journeyId, placeId, jurisdictionId, credentialId: credential.credentialId, credentialVersionId: credential.versionId, existingVisitId, existingJourneyItemId: existingJourneyItem?.journeyItemId, connectionId, externalId, externalRecordId };
}

function input(f: Awaited<ReturnType<typeof setup>>, idempotencyKey: string, externalId = f.externalId): ObservedStayAttachmentParams {
  return {
    workspaceId: f.seed.workspaceId,
    actorPrincipalId: f.seed.actorId,
    idempotencyKey,
    journeyId: f.journeyId,
    expectedJourneyRevision: 1,
    travellerId: f.travellerId,
    expectedConnectionRevision: 1,
    provider: {
      connectionId: f.connectionId,
      externalRecordId: f.externalRecordId,
      externalId,
      recordType: 'STAY_BOOKING',
      observedAt: OBSERVED_AT,
      evidenceId: takeSeedEvidence(f.seed),
      payloadHash: `sha256:${externalId}`,
    },
    journeyItem: { intendedPlaceId: f.placeId, requiredNights: 3, orderKey: 'approved-stay-order-1' },
    booking: { placeId: f.placeId, stayInterval: { start: STAY_START, end: STAY_END }, status: 'CONFIRMED' },
  };
}

function approvedProposedVisit(f: Awaited<ReturnType<typeof setup>>) {
  const visitId = randomUUID();
  return {
    kind: 'PROPOSED' as const,
    visit: {
      id: visitId,
      journeyId: f.journeyId,
      jurisdictionId: f.jurisdictionId,
      purpose: 'BUSINESS',
      intendedDates: { start: STAY_START, end: STAY_END },
      transitIntent: false,
    },
    credentialSelection: {
      id: randomUUID(),
      credentialId: f.credentialId,
      credentialVersionId: f.credentialVersionId,
      scopeIntendedVisitIds: [visitId],
    },
  };
}

function approvedExistingVisit(f: Awaited<ReturnType<typeof setup>>) {
  return {
    kind: 'EXISTING' as const,
    visitId: f.existingVisitId,
    credentialSelection: {
      id: randomUUID(),
      credentialId: f.credentialId,
      credentialVersionId: f.credentialVersionId,
      scopeIntendedVisitIds: [f.existingVisitId],
    },
  };
}

describe('A4 atomic observed stay attachment', () => {
  test('creates one Journey STAY, booking graph, linked provider record, and replays without duplicates', async () => {
    const f = await setup();
    const uow = () => new PgUnitOfWork(f.pool, f.seed.workspaceId);
    const params = input(f, randomUUID());
    const first = mustOk(await attachObservedStay(uow(), params));
    const replay = mustOk(await attachObservedStay(uow(), params));
    assert.deepEqual(replay, first);

    const counts = await f.pool.query<{ journey_items: string; reservations: string; lines: string; allocations: string; records: string; links: string }>(
      `SELECT
         (SELECT COUNT(*) FROM journey_items WHERE workspace_id=$1 AND journey_id=$2)::text AS journey_items,
         (SELECT COUNT(*) FROM reservations WHERE workspace_id=$1 AND id=$3)::text AS reservations,
         (SELECT COUNT(*) FROM reservation_lines WHERE workspace_id=$1 AND reservation_id=$3)::text AS lines,
         (SELECT COUNT(*) FROM reservation_allocations WHERE workspace_id=$1 AND reservation_id=$3)::text AS allocations,
         (SELECT COUNT(*) FROM external_records WHERE workspace_id=$1 AND id=$4)::text AS records,
         (SELECT COUNT(*) FROM external_record_links WHERE workspace_id=$1 AND external_record_id=$4 AND superseded_at IS NULL)::text AS links`,
      [f.seed.workspaceId, f.journeyId, first.reservationId, first.externalRecordId],
    );
    assert.deepEqual(counts.rows[0], { journey_items: '1', reservations: '1', lines: '1', allocations: '1', records: '1', links: '1' });
  });

  test('rejects the same provider booking under a different command key', async () => {
    const f = await setup();
    const uow = () => new PgUnitOfWork(f.pool, f.seed.workspaceId);
    const firstInput = input(f, randomUUID());
    const first = mustOk(await attachObservedStay(uow(), firstInput));
    const duplicate = await attachObservedStay(uow(), {
      ...input(f, randomUUID()),
      expectedJourneyRevision: 2,
      expectedConnectionRevision: 2,
      provider: { ...firstInput.provider, evidenceId: takeSeedEvidence(f.seed) },
    });
    assert.equal(duplicate.ok, false);
    if (duplicate.ok) return;
    assert.equal(duplicate.conflict.kind, 'DUPLICATE_REGISTRATION');
    assert.equal((await f.pool.query('SELECT COUNT(*) FROM journey_items WHERE workspace_id=$1 AND journey_id=$2', [f.seed.workspaceId, f.journeyId])).rows[0].count, '1');
    assert.equal(first.reservationId.length, 36);
  });

  test('persists an approved proposed visit and selected credential atomically, then replays without duplicates', async () => {
    const f = await setup();
    const uow = () => new PgUnitOfWork(f.pool, f.seed.workspaceId);
    const params = { ...input(f, randomUUID()), approvedVisit: approvedProposedVisit(f) };
    const first = mustOk(await attachObservedStay(uow(), params));
    const replay = mustOk(await attachObservedStay(uow(), params));
    assert.deepEqual(replay, first);
    const rows = await f.pool.query<{ visits: string; selections: string; scoped: string }>(
      `SELECT
         (SELECT COUNT(*) FROM intended_visits WHERE workspace_id=$1 AND journey_id=$2)::text AS visits,
         (SELECT COUNT(*) FROM credential_selections WHERE workspace_id=$1 AND journey_id=$2)::text AS selections,
         (SELECT COUNT(*) FROM credential_selection_visits csv JOIN credential_selections cs ON cs.workspace_id=csv.workspace_id AND cs.id=csv.selection_id WHERE csv.workspace_id=$1 AND cs.journey_id=$2)::text AS scoped`,
      [f.seed.workspaceId, f.journeyId],
    );
    assert.deepEqual(rows.rows[0], { visits: '2', selections: '1', scoped: '1' });
  });

  test('binds an existing Journey visit only after ownership validation', async () => {
    const f = await setup();
    const uow = () => new PgUnitOfWork(f.pool, f.seed.workspaceId);
    const first = mustOk(await attachObservedStay(uow(), { ...input(f, randomUUID()), approvedVisit: approvedExistingVisit(f) }));
    const rows = await f.pool.query<{ visits: string; selections: string }>(
      `SELECT
         (SELECT COUNT(*) FROM intended_visits WHERE workspace_id=$1 AND journey_id=$2)::text AS visits,
         (SELECT COUNT(*) FROM credential_selections WHERE workspace_id=$1 AND journey_id=$2)::text AS selections`,
      [f.seed.workspaceId, f.journeyId],
    );
    assert.equal(first.journeyItemId.length, 36);
    assert.deepEqual(rows.rows[0], { visits: '1', selections: '1' });
  });

  test('rolls back the complete graph when provider identity is quarantined', async () => {
    const f = await setup({ externalId: 'quarantined-provider-booking', recordState: 'QUARANTINED_UNKNOWN' });
    const staleInput = input(f, randomUUID());
    const stale = await attachObservedStay(new PgUnitOfWork(f.pool, f.seed.workspaceId), {
      ...staleInput,
      provider: { ...staleInput.provider, payloadHash: 'sha256:' + f.externalId },
    });
    assert.equal(stale.ok, false);
    if (stale.ok) return;
    assert.match(stale.conflict.message, /quarantined/i);
    const counts = await f.pool.query<{ items: string; reservations: string; lines: string; allocations: string; links: string }>(
      `SELECT
         (SELECT COUNT(*) FROM journey_items WHERE workspace_id=$1 AND journey_id=$2)::text AS items,
         (SELECT COUNT(*) FROM reservations WHERE workspace_id=$1 AND reservation_type='STAY')::text AS reservations,
         (SELECT COUNT(*) FROM reservation_lines WHERE workspace_id=$1)::text AS lines,
         (SELECT COUNT(*) FROM reservation_allocations WHERE workspace_id=$1)::text AS allocations,
         (SELECT COUNT(*) FROM external_record_links WHERE workspace_id=$1)::text AS links`,
      [f.seed.workspaceId, f.journeyId],
    );
    assert.deepEqual(counts.rows[0], { items: '0', reservations: '0', lines: '0', allocations: '0', links: '0' });
  });

  test('refuses non-confirmed observations and missing approved ordering before writes', async () => {
    const f = await setup();
    const uow = () => new PgUnitOfWork(f.pool, f.seed.workspaceId);
    const base = input(f, randomUUID());
    const nonConfirmed = await attachObservedStay(uow(), { ...base, booking: { ...base.booking, status: 'CANCELLED' as 'CONFIRMED' } });
    assert.equal(nonConfirmed.ok, false);
    if (!nonConfirmed.ok) assert.match(nonConfirmed.conflict.message, /CONFIRMED/);
    const missingOrder = await attachObservedStay(uow(), { ...base, idempotencyKey: randomUUID(), journeyItem: { ...base.journeyItem, orderKey: '' } });
    assert.equal(missingOrder.ok, false);
    if (!missingOrder.ok) assert.match(missingOrder.conflict.message, /orderKey/);
    assert.equal((await f.pool.query('SELECT COUNT(*) FROM journey_items WHERE workspace_id=$1 AND journey_id=$2', [f.seed.workspaceId, f.journeyId])).rows[0].count, '0');
  });

  test('refuses transit visits and approved visit windows that do not cover the observed stay', async () => {
    const f = await setup();
    const uow = () => new PgUnitOfWork(f.pool, f.seed.workspaceId);
    const transitVisit = approvedProposedVisit(f);
    transitVisit.visit.transitIntent = true;
    const transit = await attachObservedStay(uow(), {
      ...input(f, randomUUID()),
      approvedVisit: transitVisit,
    });
    assert.equal(transit.ok, false);
    if (!transit.ok) assert.match(transit.conflict.message, /landside/);

    const narrowVisit = approvedProposedVisit(f);
    narrowVisit.visit.intendedDates = { start: '2030-01-03T00:00:00Z', end: '2030-01-04T00:00:00Z' };
    const narrow = await attachObservedStay(uow(), {
      ...input(f, randomUUID()),
      approvedVisit: narrowVisit,
    });
    assert.equal(narrow.ok, false);
    if (!narrow.ok) assert.match(narrow.conflict.message, /cover/);
    assert.equal((await f.pool.query('SELECT COUNT(*) FROM reservations WHERE workspace_id=$1', [f.seed.workspaceId])).rows[0].count, '0');
  });

  test('rolls back approved visit and credential selection when later stay attachment fails', async () => {
    const f = await setup({ existingJourneyItem: true });
    const uow = () => new PgUnitOfWork(f.pool, f.seed.workspaceId);
    const failed = await attachObservedStay(uow(), {
      ...input(f, randomUUID()),
      journeyItem: { ...input(f, randomUUID()).journeyItem, id: f.existingJourneyItemId },
      approvedVisit: approvedProposedVisit(f),
    });
    assert.equal(failed.ok, false);
    const counts = await f.pool.query<{ visits: string; selections: string; reservations: string; links: string }>(
      `SELECT
         (SELECT COUNT(*) FROM intended_visits WHERE workspace_id=$1 AND journey_id=$2)::text AS visits,
         (SELECT COUNT(*) FROM credential_selections WHERE workspace_id=$1 AND journey_id=$2)::text AS selections,
         (SELECT COUNT(*) FROM reservations WHERE workspace_id=$1)::text AS reservations,
         (SELECT COUNT(*) FROM external_record_links WHERE workspace_id=$1)::text AS links`,
      [f.seed.workspaceId, f.journeyId],
    );
    assert.deepEqual(counts.rows[0], { visits: '1', selections: '0', reservations: '0', links: '0' });
  });
});

/** M3 external identity, capabilities, entitlements, exact money, and FX. */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed, seedExternalConnection, seedOrganisation, seedReservation, seedTraveller, takeSeedEvidence, type SeedSession } from './m3Seed.ts';
import { PgUnitOfWork, type ExecuteOutcome } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { PgArrangementReadQueries } from '../src/persistence/postgres/queries/pgArrangementReadQueries.ts';
import {
  capabilityOutcome,
  createCostAllocation,
  createServiceEntitlement,
  linkExternalRecord,
  observeExternalRecord,
  recordFxObservation,
  recordProviderCapability,
} from '../src/persistence/postgres/commands/arrangementCommands.ts';
import { addExactMoney, type FxObservation } from '../src/domain/v2/shared/money.ts';

const AT0 = '2030-01-01T00:00:00.000Z';
const AT1 = '2030-01-01T01:00:00.000Z';
const AT2 = '2030-01-01T02:00:00.000Z';
const AT3 = '2030-01-01T03:00:00.000Z';

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

function identity(seed: SeedSession) {
  return { workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId };
}

function mustOk<T>(outcome: ExecuteOutcome<T>): T {
  if (!outcome.ok) assert.fail(`${outcome.conflict.kind}: ${outcome.conflict.message}`);
  return outcome.value;
}

function conflictOf(outcome: ExecuteOutcome<unknown>) {
  if (outcome.ok) assert.fail('expected a typed conflict');
  return outcome.conflict;
}

async function setup() {
  const pool = await sharedTestPool();
  const seed = await beginSeed(pool, 'M3 identity fixture');
  const organisationId = await seedOrganisation(seed, 'USD');
  const travellerId = (await seedTraveller(seed)).travellerId;
  const reservationId = await seedReservation(seed, { organisationId, travellerId });
  const connectionId = await seedExternalConnection(seed, organisationId);
  await commitSeed(seed);
  const evidence = () => takeSeedEvidence(seed);
  return { pool, seed, evidence, organisationId, travellerId, reservationId, connectionId };
}

describe('M3 identity, capability, entitlement, and money semantics', () => {
  test('unknown and ambiguous external identity remain quarantined until evidence-backed linking', async () => {
    const f = await setup();
    const uow = () => new PgUnitOfWork(f.pool, f.seed.workspaceId);
    const unknownId = randomUUID();
    const unknown = mustOk(await observeExternalRecord(uow(), { ...identity(f.seed), idempotencyKey: randomUUID(), connectionId: f.connectionId, expectedRevision: 1, record: { id: unknownId, recordType: 'RESERVATION', externalId: 'provider-unknown', identityState: 'QUARANTINED_UNKNOWN', quarantineReason: 'no canonical candidate', observedAt: AT0 } }));
    assert.equal(unknown.status, 'APPLIED');
    const quarantined = await new PgArrangementReadQueries(f.pool).quarantinedExternalRecords(f.seed.workspaceId, f.connectionId);
    assert.equal(quarantined.length, 1);
    assert.equal(quarantined[0]?.identityState, 'QUARANTINED_UNKNOWN');

    const linkedCandidate = mustOk(await observeExternalRecord(uow(), { ...identity(f.seed), idempotencyKey: randomUUID(), connectionId: f.connectionId, expectedRevision: 2, record: { recordType: 'RESERVATION', externalId: 'provider-linked', identityState: 'UNVERIFIED', observedAt: AT1 } }));
    const linkedId = linkedCandidate.recordId;
    const link = mustOk(await linkExternalRecord(uow(), { ...identity(f.seed), idempotencyKey: randomUUID(), connectionId: f.connectionId, expectedRevision: 3, link: { id: randomUUID(), externalRecordId: linkedId, canonicalSubject: { kind: 'RESERVATION', id: f.reservationId }, linkKind: 'SYSTEM_OF_RECORD', evidenceId: f.evidence(), linkedAt: AT2 } }));
    assert.ok(link.linkId);
    const linkedRows = await new PgArrangementReadQueries(f.pool).externalRecordsForSubject(f.seed.workspaceId, f.reservationId, 'RESERVATION');
    assert.equal(linkedRows.length, 1);
    assert.equal(linkedRows[0]?.identityState, 'LINKED');

    // Retiring the last link cannot silently leave the record claiming LINKED.
    // This is checked by a deferred database invariant even behind the command
    // boundary.
    const client = await f.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'UPDATE external_record_links SET superseded_at = $2 WHERE workspace_id = $1 AND id = $3',
        [f.seed.workspaceId, AT3, link.linkId],
      );
      await assert.rejects(
        () => client.query('COMMIT'),
        /has no live link row/i,
      );
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    const rejected = await linkExternalRecord(uow(), { ...identity(f.seed), idempotencyKey: randomUUID(), connectionId: f.connectionId, expectedRevision: 4, link: { id: randomUUID(), externalRecordId: unknownId, canonicalSubject: { kind: 'RESERVATION', id: f.reservationId }, linkKind: 'CORRELATED', evidenceId: f.evidence(), linkedAt: AT2 } });
    assert.equal(conflictOf(rejected).kind, 'VALIDATION_FAILED');
  });

  test('observation, servicing capability, and authority remain separate, including stale capability facts', async () => {
    const f = await setup();
    const uow = () => new PgUnitOfWork(f.pool, f.seed.workspaceId);
    const first = mustOk(await recordProviderCapability(uow(), { ...identity(f.seed), idempotencyKey: randomUUID(), expectedRevision: 1, capability: { id: randomUUID(), connectionId: f.connectionId, capabilityKind: 'OBSERVE', recordType: 'RESERVATION', supported: true, observedAt: AT1 } }));
    assert.equal(first.status, 'APPLIED');
    const stale = mustOk(await recordProviderCapability(uow(), { ...identity(f.seed), idempotencyKey: randomUUID(), expectedRevision: 2, capability: { id: randomUUID(), connectionId: f.connectionId, capabilityKind: 'OBSERVE', recordType: 'RESERVATION', supported: false, observedAt: AT0 } }));
    assert.equal(stale.status, 'STALE');
    const capability = await new PgArrangementReadQueries(f.pool).providerCapability(f.seed.workspaceId, f.connectionId, 'OBSERVE', 'RESERVATION');
    assert.equal(capability?.supported, true);
    mustOk(await recordProviderCapability(uow(), { ...identity(f.seed), idempotencyKey: randomUUID(), expectedRevision: 2, capability: { id: randomUUID(), connectionId: f.connectionId, capabilityKind: 'SERVICE', recordType: 'RESERVATION', supported: false, observedAt: AT1 } }));
    const serviceCapability = await new PgArrangementReadQueries(f.pool).providerCapability(f.seed.workspaceId, f.connectionId, 'SERVICE', 'RESERVATION');
    assert.equal(serviceCapability?.supported, false);
    assert.equal(capabilityOutcome(undefined).ok, false);
    assert.equal(capabilityOutcome({ supported: false }).ok, false);
    assert.equal(capabilityOutcome({ supported: true }).ok, true);
  });

  test('reservation confirmation does not issue an entitlement; positive issuance requires time and evidence', async () => {
    const f = await setup();
    const uow = () => new PgUnitOfWork(f.pool, f.seed.workspaceId);
    const missingEvidence = await createServiceEntitlement(uow(), { ...identity(f.seed), idempotencyKey: randomUUID(), entitlement: { entitlementType: 'TICKET', observedStatus: 'ISSUED', observedStatusAt: AT1 } });
    assert.equal(conflictOf(missingEvidence).kind, 'VALIDATION_FAILED');
    const unknown = mustOk(await createServiceEntitlement(uow(), { ...identity(f.seed), idempotencyKey: randomUUID(), entitlement: { entitlementType: 'TICKET', observedStatus: 'UNKNOWN' } }));
    assert.ok(unknown.id);
    const issued = mustOk(await createServiceEntitlement(uow(), { ...identity(f.seed), idempotencyKey: randomUUID(), entitlement: { entitlementType: 'TICKET', observedStatus: 'ISSUED', observedStatusAt: AT1, evidenceId: f.evidence() } }));
    const rows = await f.pool.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM service_entitlements WHERE workspace_id=$1', [f.seed.workspaceId]);
    assert.equal(rows.rows[0]?.n, '2');
    assert.notEqual(issued.id, unknown.id);
  });

  test('FX is sourced and exact, and cross-currency cost allocation cannot omit or miscite it', async () => {
    const f = await setup();
    const uow = () => new PgUnitOfWork(f.pool, f.seed.workspaceId);
    assert.deepEqual(addExactMoney({ amount: '9007199254740992.10', currency: 'USD' }, { amount: '0.90', currency: 'USD' }), { amount: '9007199254740993.00', currency: 'USD' });
    const observation: FxObservation = { id: randomUUID(), baseCurrency: 'USD', quoteCurrency: 'EUR', rate: '0.9123456789', asOf: AT0, sourceId: randomUUID() };
    mustOk(await recordFxObservation(uow(), { ...identity(f.seed), idempotencyKey: randomUUID(), observation }));
    const noFx = await createCostAllocation(uow(), { ...identity(f.seed), idempotencyKey: randomUUID(), expectedReservationRevision: 1, allocation: { id: randomUUID(), reservationId: f.reservationId, payerOrganisationId: f.organisationId, entryKind: 'INTENDED', amount: { amount: '10.01', currency: 'EUR' } } });
    assert.equal(conflictOf(noFx).kind, 'VALIDATION_FAILED');
    const applied = mustOk(await createCostAllocation(uow(), { ...identity(f.seed), idempotencyKey: randomUUID(), expectedReservationRevision: 1, allocation: { id: randomUUID(), reservationId: f.reservationId, payerOrganisationId: f.organisationId, entryKind: 'ACTUAL', amount: { amount: '10.01', currency: 'EUR' }, fxObservationId: observation.id, evidenceId: f.evidence(), occurredAt: AT1 } }));
    assert.equal(applied.reservationRevision, 2);
    const allocations = await new PgArrangementReadQueries(f.pool).costAllocationsForReservation(f.seed.workspaceId, f.reservationId);
    assert.equal(allocations.length, 1);
    assert.equal(allocations[0]?.amount.amount, '10.01');
  });

  test('competing writers produce one committed revision and one typed stale result', async () => {
    const f = await setup();
    const base = { ...identity(f.seed), connectionId: f.connectionId, expectedRevision: 1 } as const;
    const [left, right] = await Promise.all([
      recordProviderCapability(new PgUnitOfWork(f.pool, f.seed.workspaceId), { ...base, idempotencyKey: randomUUID(), capability: { id: randomUUID(), connectionId: f.connectionId, capabilityKind: 'SERVICE', recordType: 'RESERVATION', supported: true, observedAt: AT1 } }),
      recordProviderCapability(new PgUnitOfWork(f.pool, f.seed.workspaceId), { ...base, idempotencyKey: randomUUID(), capability: { id: randomUUID(), connectionId: f.connectionId, capabilityKind: 'SERVICE', recordType: 'RESERVATION', supported: false, observedAt: AT2 } }),
    ]);
    const outcomes = [left, right];
    assert.equal(outcomes.filter((outcome) => outcome.ok && outcome.value.status === 'APPLIED').length, 1);
    assert.equal(outcomes.filter((outcome) => !outcome.ok && outcome.conflict.kind === 'STALE_AGGREGATE_REVISION').length, 1);
  });
});

/**
 * F5 focused — replacement TransportService identity is NOT keyed to the
 * provider event identity.
 *
 * The replacement service id is minted from the provider's SERVICE identity
 * (recordType + externalId on the connection), not from `providerEventId`.
 * A later, DIFFERENT provider event that references the SAME real replacement
 * service must therefore resolve to the same canonical TransportService row
 * (F5: no duplicate), and the duplicate path must still terminate in the
 * ChangeSignal-completion-granted ALREADY_APPLIED (migration 0124).
 *
 * N1 note on fixture coverage: this positive proof needs a second event that
 * legitimately reuses the SAME replacement service (ID7153) from a DIFFERENT
 * provider event. The ideal shape would be two DIFFERENT original services on
 * the same real corridor (CGK->SIN, air) — but
 * `fixtures/programmes/ait-summit-2026/programme.json` contains exactly one
 * CGK->SIN service (ID7159); every other transport leg in the fixture
 * originates from a different airport (NRT, MNL, HKG, HND, LAX, LHR, KUL,
 * CDG, ICN, DEL, SGN, BOM, MAD, AKL, AMS, FRA, BKK, CNX, SYD — confirmed by
 * walking every TRANSPORT_LEG in the fixture). Per instructions, this test
 * does not invent a second same-corridor fixture service. Instead it proves
 * the closest faithful case available: TWO DISTINCT provider events (event A,
 * event B — different providerEventId, disjoint booked-traveller cohorts)
 * both name the SAME real original service ID7159 and both reprotect onto the
 * SAME real replacement ID7153, so the second event's reuse of the
 * already-created replacement row is exercised by a genuinely different event
 * rather than a retry of the same one. The corridor/schedule MISMATCH guard
 * itself (the actual N1 fix — rejecting reuse when the existing replacement
 * row does NOT match) is proven separately, with a real different-corridor
 * fixture service (TR883, HND->SIN), in
 * postgres-integration/t2N1ReplacementCorridorGuard.pgtest.ts.
 *
 * Proven against real PostgreSQL in one workspace:
 *   1. Event A: ID7159 cancelled, a 3-traveller subset of its cohort
 *      involuntarily reprotectioned onto replacement service ID7153 →
 *      APPLIED.
 *   2. Event B (different providerEventId, the SAME original service ID7159,
 *      the REMAINING 2 travellers of its cohort, SAME replacement external
 *      identity ID7153@...) → APPLIED, and event B's replacementServiceId
 *      equals event A's — one canonical service, reused, not duplicated.
 *   3. Duplicate delivery of event B → ALREADY_APPLIED (ChangeSignal-completion-granted).
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Pool } from '../src/persistence/postgres/pool.ts';
import { sharedTestPool } from './harness.ts';
import { loadDataset, type LoadedDataset } from '../src/app/demo/datasetLoader.ts';
import { resolveSourceSubjects, SOURCE_RECORD_TYPES } from '../src/app/demo/externalIdentity.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import {
  acceptProviderDisruptionDemoEvent,
  type TransportServiceCancelledWithReprotectionEvent,
} from '../src/app/target/providerDisruptionIngress.ts';
import type { TargetCommandContext } from '../src/app/target/applicationCommands.ts';
import { aitWorldModeFromEnv, obtainAitSummitWorld } from './aitFixtureClone.ts';

const BUNDLE_DIR = fileURLToPath(new URL('../fixtures/programmes/ait-summit-2026/', import.meta.url));
const ACTOR = 'principal:t2-f5-service-identity-test';
const ORIGINAL_EXTERNAL_ID = 'ID7159@2026-09-30T10:45:00.000Z';
const REPLACEMENT_EXTERNAL_ID = 'ID7153@2026-10-01T00:45:00.000Z';
const REPLACEMENT_DEPARTURE = '2026-10-01T07:45:00+07:00';
const REPLACEMENT_ARRIVAL = '2026-10-01T10:30:00+08:00';

let pool: Pool;
let dataset: LoadedDataset | undefined;
let sharedPool: Pool | undefined;
let disposeWorld: (() => Promise<void>) | undefined;

describe('F5 — replacement service identity resolves via external identity, not provider event identity', () => {
  before(async () => {
    if (aitWorldModeFromEnv() === 'fresh') {
      sharedPool = await sharedTestPool();
      pool = sharedPool;
      dataset = await loadDataset(BUNDLE_DIR);
    }
  });

  after(async () => {
    await disposeWorld?.().catch(() => undefined);
    await sharedPool?.end().catch(() => undefined);
  });

  test('a second provider event referencing the same real replacement service reuses the canonical service; duplicate delivery is ALREADY_APPLIED', async () => {
    const world = await obtainAitSummitWorld({
      actorPrincipalId: ACTOR,
      includeBaseline: true,
      sharedPool,
      dataset,
    });
    disposeWorld = world.dispose;
    pool = world.pool;
    const workspaceId = world.workspaceId;
    const connectionId = world.connectionId;
    assert.ok(
      world.provisionStatus === 'MATERIALIZED' || world.provisionStatus === 'CLONED',
      `world ready via ${world.provisionStatus}`,
    );
    assert.ok((world.baselineEvaluated ?? 0) > 0, 'baseline evaluation assessed at least one journey');
    console.log(`[timing] F5 setup mode=${world.mode} setupMs=${world.setupMs.toFixed(0)}`);

    const ctx: TargetCommandContext = {
      workspaceId,
      actorPrincipalId: ACTOR,
      uow: () => new PgUnitOfWork(pool, workspaceId),
      pool,
    };

    const mapping = await resolveSourceSubjects(pool, workspaceId, connectionId);
    const original = mapping.get(`${SOURCE_RECORD_TYPES.TRANSPORT_SERVICE}:${ORIGINAL_EXTERNAL_ID}`);
    assert.ok(original, 'original service ID7159 resolves');

    // ID7159's full confirmed cohort, split across two distinct events (see
    // the file-level note on fixture coverage above).
    const eventACohort = ['IDSYN03', 'IDSYN10', 'IDSYN11'];
    const eventBCohort = ['IDSYN14', 'IDSYN30'];

    // -- Event A: reprotections a 3-traveller subset of ID7159's cohort onto ID7153.
    const eventA: TransportServiceCancelledWithReprotectionEvent = {
      kind: 'TRANSPORT_SERVICE_CANCELLED_WITH_REPROTECTION',
      providerId: 'sim-airline-id',
      providerEventId: `sim-id-evt-f5-a-${randomUUID()}`,
      receivedAt: '2026-09-21T01:40:00.000Z',
      disclosedAsSimulatedDemoInput: true,
      originalService: { recordType: 'SOURCE_TRANSPORT_SERVICE', externalId: ORIGINAL_EXTERNAL_ID },
      replacementService: {
        recordType: 'SOURCE_TRANSPORT_SERVICE',
        externalId: REPLACEMENT_EXTERNAL_ID,
        operator: 'ID',
        scheduledDeparture: REPLACEMENT_DEPARTURE,
        scheduledArrival: REPLACEMENT_ARRIVAL,
      },
      affectedBookings: eventACohort.map((pnr) => ({
        recordType: 'SOURCE_BOOKING_REFERENCE' as const,
        externalId: pnr,
      })),
      reason: 'F5 service-identity scenario, event A.',
      provenanceKind: 'SCHEDULE_CHANGE',
    };

    const appliedA = await acceptProviderDisruptionDemoEvent(ctx, eventA);
    assert.equal(appliedA.ok, true, `event A applied: ${appliedA.ok ? '' : JSON.stringify(appliedA.error)}`);
    if (!appliedA.ok) return;
    assert.equal(appliedA.status, 'APPLIED', 'event A status APPLIED');

    // -- Event B: different providerEventId, the SAME real original service
    // (so the corridor genuinely matches by construction), the REMAINING
    // 2-traveller cohort (untouched by event A, so still CONFIRMED), SAME
    // replacement external identity and schedule.
    const eventB: TransportServiceCancelledWithReprotectionEvent = {
      kind: 'TRANSPORT_SERVICE_CANCELLED_WITH_REPROTECTION',
      providerId: 'sim-airline-id',
      providerEventId: `sim-id-evt-f5-b-${randomUUID()}`,
      receivedAt: '2026-09-21T02:10:00.000Z',
      disclosedAsSimulatedDemoInput: true,
      originalService: { recordType: 'SOURCE_TRANSPORT_SERVICE', externalId: ORIGINAL_EXTERNAL_ID },
      replacementService: {
        recordType: 'SOURCE_TRANSPORT_SERVICE',
        externalId: REPLACEMENT_EXTERNAL_ID,
        operator: 'ID',
        scheduledDeparture: REPLACEMENT_DEPARTURE,
        scheduledArrival: REPLACEMENT_ARRIVAL,
      },
      affectedBookings: eventBCohort.map((pnr) => ({
        recordType: 'SOURCE_BOOKING_REFERENCE' as const,
        externalId: pnr,
      })),
      reason: 'F5 service-identity scenario, event B.',
      provenanceKind: 'SCHEDULE_CHANGE',
    };

    const appliedB = await acceptProviderDisruptionDemoEvent(ctx, eventB);
    assert.equal(appliedB.ok, true, `event B applied: ${appliedB.ok ? '' : JSON.stringify(appliedB.error)}`);
    if (!appliedB.ok) return;
    assert.equal(appliedB.status, 'APPLIED', 'event B status APPLIED');

    // THE F5 TRUTH: both events resolve the SAME canonical replacement service.
    assert.equal(
      appliedB.replacementServiceId, appliedA.replacementServiceId,
      'event B resolves the SAME canonical replacement service as event A (identity from the service, not the event)',
    );

    // Exactly ONE canonical TransportService row for the provider service identity.
    const serviceRows = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM transport_services s
         JOIN external_records r ON r.workspace_id = s.workspace_id AND r.record_type = 'SOURCE_TRANSPORT_SERVICE' AND r.external_id = $2
         JOIN external_record_links l ON l.workspace_id = r.workspace_id AND l.external_record_id = r.id AND l.superseded_at IS NULL
           AND l.canonical_subject_id = s.id
        WHERE s.workspace_id = $1`,
      [workspaceId, REPLACEMENT_EXTERNAL_ID],
    );
    assert.equal(Number(serviceRows.rows[0]!.n), 1, 'exactly one canonical TransportService for the ID7153 external identity');

    // Duplicate delivery of event B → ChangeSignal-completion-granted ALREADY_APPLIED.
    const dup = await acceptProviderDisruptionDemoEvent(ctx, eventB);
    assert.equal(dup.ok, true, 'duplicate event B resolves ok');
    if (!dup.ok) return;
    assert.equal(dup.status, 'ALREADY_APPLIED', 'duplicate event B is ALREADY_APPLIED');
  });
});

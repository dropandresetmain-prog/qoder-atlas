/**
 * G12 — persistence-boundary UUID gate for the M2 travel (lane T) and support
 * (lane S) command handlers, run against real PostgreSQL.
 *
 * docs/refactor/evidence/M2_INTEGRATION_DECISIONS.md's G12 decision: the
 * frozen `SubjectIdSchema` (identity.ts) legally admits legacy/source-shaped
 * ids (e.g. `trip-legacy-7`, `journey:7`), but every id these two command
 * files hand to PostgreSQL reaches a `uuid` column (0020-0028). This file
 * proves, for every exported command in `travelCommands.ts` and
 * `supportCommands.ts`, that a legacy-shaped id is rejected as a typed
 * `VALIDATION_FAILED` conflict *before* `UnitOfWork.execute` ever runs —
 * never as a raw `22P02` surfacing from inside an open transaction, and
 * never as an escaped `ZodError`.
 *
 * "Before execute" is proven two independent ways per case:
 *  - a spy wrapping the real `PgUnitOfWork` counts `execute()` calls (must
 *    stay at 0 for a rejected command);
 *  - no `command_receipts` row exists for the command's idempotency key
 *    (only `PgUnitOfWork.execute`'s `runBody` ever inserts one, on commit).
 *
 * One positive control per file proves the gate does not false-positive on
 * an ordinary UUID command: it still runs through `execute()` exactly once
 * and leaves exactly one `command_receipts` row.
 *
 * Every case opens a fresh workspace through `m2Seed.ts` and writes nothing
 * else: a rejected command must leave the shared PostgreSQL test database
 * completely untouched, so there is nothing to clean up.
 */
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed } from './m2Seed.ts';
import type { Pool } from '../src/persistence/postgres/pool.ts';
import { PgUnitOfWork, type ExecuteOutcome } from '../src/persistence/postgres/pgUnitOfWork.ts';
import type { UnitOfWork } from '../src/contracts/v2/command/unitOfWork.ts';
import type { TypedConflict } from '../src/domain/v2/shared/errors.ts';
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
} from '../src/persistence/postgres/commands/travelCommands.ts';
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
} from '../src/persistence/postgres/commands/supportCommands.ts';

/** A generic four-hour window; no scenario, city or demo date appears anywhere. */
const T0 = Date.UTC(2030, 0, 1);
const at = (minutes: number): string => new Date(T0 + minutes * 60_000).toISOString();
const FULL = { start: at(0), end: at(240) };

interface Fixture {
  pool: Pool;
  workspaceId: string;
  actorPrincipalId: string;
}

/**
 * Every case in this file rejects before any repository read or write, so
 * the fixture only needs a real `workspaces` row (for the positive controls,
 * which do commit) — not a Traveller, Trip or Journey to address, since a
 * legacy-shaped id is refused before the handler ever looks one up.
 */
async function fixture(): Promise<Fixture> {
  const pool = await sharedTestPool();
  const seed = await beginSeed(pool);
  const created: Fixture = { pool, workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId };
  await commitSeed(seed);
  return created;
}

interface ExecuteSpy {
  uow: UnitOfWork;
  calls: () => number;
}

/** Wraps a real `PgUnitOfWork` and counts `execute()` calls without changing its behaviour at all. */
function spyUow(pool: Pool, workspaceId: string): ExecuteSpy {
  const real = new PgUnitOfWork(pool, workspaceId);
  let count = 0;
  const uow: UnitOfWork = {
    heads: real.heads,
    idempotency: real.idempotency,
    scopes: real.scopes,
    execute(envelope, fn) {
      count += 1;
      return real.execute(envelope, fn);
    },
  };
  return { uow, calls: () => count };
}

async function receiptCount(pool: Pool, workspaceId: string, idempotencyKey: string): Promise<number> {
  const result = await pool.query<{ n: string }>(
    'SELECT COUNT(*)::text AS n FROM command_receipts WHERE workspace_id = $1 AND idempotency_key = $2',
    [workspaceId, idempotencyKey],
  );
  return Number(result.rows[0]?.n ?? '0');
}

function mustOk<T>(outcome: ExecuteOutcome<T>): T {
  if (!outcome.ok) assert.fail(`expected the command to commit, got ${outcome.conflict.kind}: ${outcome.conflict.message}`);
  return outcome.value;
}

function conflictOf(outcome: ExecuteOutcome<unknown>): TypedConflict {
  if (outcome.ok) assert.fail('expected a typed conflict, but the command committed');
  return outcome.conflict;
}

/**
 * Runs `run` (a call into one exported command) and asserts the three-part
 * G12 contract: a typed `VALIDATION_FAILED` outcome, zero `execute()` calls
 * on the spy, and no `command_receipts` row for `idempotencyKey`.
 */
async function assertRejectedBeforeExecute(params: {
  label: string;
  fixture: Fixture;
  spy: ExecuteSpy;
  idempotencyKey: string;
  run: () => Promise<ExecuteOutcome<unknown>>;
}): Promise<void> {
  const before = params.spy.calls();
  const outcome = await params.run();
  const conflict = conflictOf(outcome);
  assert.equal(conflict.kind, 'VALIDATION_FAILED', `${params.label}: expected VALIDATION_FAILED, got ${conflict.kind}: ${conflict.message}`);
  assert.equal(params.spy.calls(), before, `${params.label}: UnitOfWork.execute must not run for a rejected id shape`);
  const receipts = await receiptCount(params.fixture.pool, params.fixture.workspaceId, params.idempotencyKey);
  assert.equal(receipts, 0, `${params.label}: no command_receipts row may exist for a rejected id-shape command`);
}

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

describe('G12 persistence boundary — travelCommands.ts rejects legacy-shaped ids before execute', () => {
  test('createTrip: legacy-shaped pinned tripId', async () => {
    const f = await fixture();
    const spy = spyUow(f.pool, f.workspaceId);
    const idempotencyKey = randomUUID();
    await assertRejectedBeforeExecute({
      label: 'createTrip',
      fixture: f,
      spy,
      idempotencyKey,
      run: () =>
        createTrip(spy.uow, {
          workspaceId: f.workspaceId,
          actorPrincipalId: f.actorPrincipalId,
          idempotencyKey,
          purpose: 'G12 legacy id probe',
          tripId: 'trip-legacy-7',
        }),
    });
  });

  test('updateTripDetails: legacy-shaped addressed tripId', async () => {
    const f = await fixture();
    const spy = spyUow(f.pool, f.workspaceId);
    const idempotencyKey = randomUUID();
    await assertRejectedBeforeExecute({
      label: 'updateTripDetails',
      fixture: f,
      spy,
      idempotencyKey,
      run: () =>
        updateTripDetails(spy.uow, {
          workspaceId: f.workspaceId,
          actorPrincipalId: f.actorPrincipalId,
          idempotencyKey,
          tripId: 'trip-legacy-7',
          expectedRevision: 1,
          purpose: 'G12 revised purpose',
        }),
    });
  });

  test('setTripLifecycleStatus: legacy-shaped addressed tripId', async () => {
    const f = await fixture();
    const spy = spyUow(f.pool, f.workspaceId);
    const idempotencyKey = randomUUID();
    await assertRejectedBeforeExecute({
      label: 'setTripLifecycleStatus',
      fixture: f,
      spy,
      idempotencyKey,
      run: () =>
        setTripLifecycleStatus(spy.uow, {
          workspaceId: f.workspaceId,
          actorPrincipalId: f.actorPrincipalId,
          idempotencyKey,
          tripId: 'trip-legacy-7',
          expectedRevision: 1,
          lifecycleStatus: 'ACTIVE',
        }),
    });
  });

  test('createJourney: legacy-shaped pinned journeyId', async () => {
    const f = await fixture();
    const spy = spyUow(f.pool, f.workspaceId);
    const idempotencyKey = randomUUID();
    await assertRejectedBeforeExecute({
      label: 'createJourney',
      fixture: f,
      spy,
      idempotencyKey,
      run: () =>
        createJourney(spy.uow, {
          workspaceId: f.workspaceId,
          actorPrincipalId: f.actorPrincipalId,
          idempotencyKey,
          tripId: randomUUID(),
          travellerId: randomUUID(),
          journeyId: 'journey:7',
        }),
    });
  });

  test('updateJourneyDetails: legacy-shaped addressed journeyId', async () => {
    const f = await fixture();
    const spy = spyUow(f.pool, f.workspaceId);
    const idempotencyKey = randomUUID();
    await assertRejectedBeforeExecute({
      label: 'updateJourneyDetails',
      fixture: f,
      spy,
      idempotencyKey,
      run: () =>
        updateJourneyDetails(spy.uow, {
          workspaceId: f.workspaceId,
          actorPrincipalId: f.actorPrincipalId,
          idempotencyKey,
          journeyId: 'journey:7',
          expectedRevision: 1,
          intendedWindow: FULL,
        }),
    });
  });

  test('setJourneyLifecycleStatus: legacy-shaped addressed journeyId', async () => {
    const f = await fixture();
    const spy = spyUow(f.pool, f.workspaceId);
    const idempotencyKey = randomUUID();
    await assertRejectedBeforeExecute({
      label: 'setJourneyLifecycleStatus',
      fixture: f,
      spy,
      idempotencyKey,
      run: () =>
        setJourneyLifecycleStatus(spy.uow, {
          workspaceId: f.workspaceId,
          actorPrincipalId: f.actorPrincipalId,
          idempotencyKey,
          journeyId: 'journey:7',
          expectedRevision: 1,
          lifecycleStatus: 'ACTIVE',
        }),
    });
  });

  test('addJourneyItem: legacy-shaped nested place id (no gate previously existed)', async () => {
    const f = await fixture();
    const spy = spyUow(f.pool, f.workspaceId);
    const idempotencyKey = randomUUID();
    await assertRejectedBeforeExecute({
      label: 'addJourneyItem',
      fixture: f,
      spy,
      idempotencyKey,
      run: () =>
        addJourneyItem(spy.uow, {
          workspaceId: f.workspaceId,
          actorPrincipalId: f.actorPrincipalId,
          idempotencyKey,
          journeyId: randomUUID(),
          expectedRevision: 1,
          item: {
            kind: 'STAY',
            lifecycleStatus: 'PLANNED',
            intendedPlaceId: 'place-legacy-1',
            requiredNights: 1,
          },
        }),
    });
  });

  test('updateJourneyItem: legacy-shaped addressed journeyItemId', async () => {
    const f = await fixture();
    const spy = spyUow(f.pool, f.workspaceId);
    const idempotencyKey = randomUUID();
    await assertRejectedBeforeExecute({
      label: 'updateJourneyItem',
      fixture: f,
      spy,
      idempotencyKey,
      run: () =>
        updateJourneyItem(spy.uow, {
          workspaceId: f.workspaceId,
          actorPrincipalId: f.actorPrincipalId,
          idempotencyKey,
          journeyId: randomUUID(),
          journeyItemId: 'item-legacy-1',
          expectedRevision: 1,
          orderKey: 'z',
        }),
    });
  });

  test('addIntendedVisit: legacy-shaped nested jurisdictionId (no gate previously existed)', async () => {
    const f = await fixture();
    const spy = spyUow(f.pool, f.workspaceId);
    const idempotencyKey = randomUUID();
    await assertRejectedBeforeExecute({
      label: 'addIntendedVisit',
      fixture: f,
      spy,
      idempotencyKey,
      run: () =>
        addIntendedVisit(spy.uow, {
          workspaceId: f.workspaceId,
          actorPrincipalId: f.actorPrincipalId,
          idempotencyKey,
          journeyId: randomUUID(),
          expectedRevision: 1,
          visit: {
            jurisdictionId: 'jurisdiction-legacy-1',
            purpose: 'G12 visit probe',
            intendedDates: FULL,
          },
        }),
    });
  });

  test('selectCredential: legacy-shaped credentialId', async () => {
    const f = await fixture();
    const spy = spyUow(f.pool, f.workspaceId);
    const idempotencyKey = randomUUID();
    await assertRejectedBeforeExecute({
      label: 'selectCredential',
      fixture: f,
      spy,
      idempotencyKey,
      run: () =>
        selectCredential(spy.uow, {
          workspaceId: f.workspaceId,
          actorPrincipalId: f.actorPrincipalId,
          idempotencyKey,
          journeyId: randomUUID(),
          expectedRevision: 1,
          credentialId: 'credential-legacy-1',
          scopeIntendedVisitIds: [randomUUID()],
        }),
    });
  });

  test('removeCredentialSelection: legacy-shaped credentialId (no gate previously existed)', async () => {
    const f = await fixture();
    const spy = spyUow(f.pool, f.workspaceId);
    const idempotencyKey = randomUUID();
    await assertRejectedBeforeExecute({
      label: 'removeCredentialSelection',
      fixture: f,
      spy,
      idempotencyKey,
      run: () =>
        removeCredentialSelection(spy.uow, {
          workspaceId: f.workspaceId,
          actorPrincipalId: f.actorPrincipalId,
          idempotencyKey,
          journeyId: randomUUID(),
          credentialId: 'credential-legacy-1',
          expectedRevision: 1,
        }),
    });
  });

  test('positive control: createTrip commits for an ordinary UUID command', async () => {
    const f = await fixture();
    const spy = spyUow(f.pool, f.workspaceId);
    const idempotencyKey = randomUUID();
    const result = mustOk(
      await createTrip(spy.uow, {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorPrincipalId,
        idempotencyKey,
        purpose: 'G12 valid UUID control',
      }),
    );
    assert.equal(result.revision, 1);
    assert.equal(spy.calls(), 1, 'a valid UUID command must still run through execute() exactly once');
    const receipts = await receiptCount(f.pool, f.workspaceId, idempotencyKey);
    assert.equal(receipts, 1, 'a committed command must leave exactly one command_receipts row');
  });
});

describe('G12 persistence boundary — supportCommands.ts rejects legacy-shaped ids before execute', () => {
  test('createCoordinationGroup: legacy-shaped pinned groupId', async () => {
    const f = await fixture();
    const spy = spyUow(f.pool, f.workspaceId);
    const idempotencyKey = randomUUID();
    await assertRejectedBeforeExecute({
      label: 'createCoordinationGroup',
      fixture: f,
      spy,
      idempotencyKey,
      run: () =>
        createCoordinationGroup(spy.uow, {
          workspaceId: f.workspaceId,
          actorPrincipalId: f.actorPrincipalId,
          idempotencyKey,
          groupId: 'group-legacy-1',
          name: 'G12 legacy probe',
        }),
    });
  });

  test('updateCoordinationGroup: legacy-shaped addressed groupId', async () => {
    const f = await fixture();
    const spy = spyUow(f.pool, f.workspaceId);
    const idempotencyKey = randomUUID();
    await assertRejectedBeforeExecute({
      label: 'updateCoordinationGroup',
      fixture: f,
      spy,
      idempotencyKey,
      run: () =>
        updateCoordinationGroup(spy.uow, {
          workspaceId: f.workspaceId,
          actorPrincipalId: f.actorPrincipalId,
          idempotencyKey,
          groupId: 'group-legacy-1',
          expectedRevision: 1,
          name: 'G12 legacy probe (revised)',
        }),
    });
  });

  test('addJourneyToGroup: legacy-shaped journeyId', async () => {
    const f = await fixture();
    const spy = spyUow(f.pool, f.workspaceId);
    const idempotencyKey = randomUUID();
    await assertRejectedBeforeExecute({
      label: 'addJourneyToGroup',
      fixture: f,
      spy,
      idempotencyKey,
      run: () =>
        addJourneyToGroup(spy.uow, {
          workspaceId: f.workspaceId,
          actorPrincipalId: f.actorPrincipalId,
          idempotencyKey,
          groupId: randomUUID(),
          journeyId: 'journey-legacy-1',
          expectedRevision: 1,
        }),
    });
  });

  test('removeJourneyFromGroup: legacy-shaped journeyId', async () => {
    const f = await fixture();
    const spy = spyUow(f.pool, f.workspaceId);
    const idempotencyKey = randomUUID();
    await assertRejectedBeforeExecute({
      label: 'removeJourneyFromGroup',
      fixture: f,
      spy,
      idempotencyKey,
      run: () =>
        removeJourneyFromGroup(spy.uow, {
          workspaceId: f.workspaceId,
          actorPrincipalId: f.actorPrincipalId,
          idempotencyKey,
          groupId: randomUUID(),
          journeyId: 'journey-legacy-1',
          expectedRevision: 1,
        }),
    });
  });

  test('shareJourneyItem: legacy-shaped journeyItemId', async () => {
    const f = await fixture();
    const spy = spyUow(f.pool, f.workspaceId);
    const idempotencyKey = randomUUID();
    await assertRejectedBeforeExecute({
      label: 'shareJourneyItem',
      fixture: f,
      spy,
      idempotencyKey,
      run: () =>
        shareJourneyItem(spy.uow, {
          workspaceId: f.workspaceId,
          actorPrincipalId: f.actorPrincipalId,
          idempotencyKey,
          groupId: randomUUID(),
          journeyId: randomUUID(),
          journeyItemId: 'item-legacy-1',
          expectedRevision: 1,
        }),
    });
  });

  test('appendAccompanimentRequirement: legacy-shaped pinned requirementId', async () => {
    const f = await fixture();
    const spy = spyUow(f.pool, f.workspaceId);
    const idempotencyKey = randomUUID();
    await assertRejectedBeforeExecute({
      label: 'appendAccompanimentRequirement',
      fixture: f,
      spy,
      idempotencyKey,
      run: () =>
        appendAccompanimentRequirement(spy.uow, {
          workspaceId: f.workspaceId,
          actorPrincipalId: f.actorPrincipalId,
          idempotencyKey,
          requirementId: 'requirement-legacy-1',
          supportedTravellerId: randomUUID(),
          requiredCoverage: FULL,
          minimumSimultaneousSupporters: 1,
          eligibleSupporterTravellerIds: [randomUUID()],
        }),
    });
  });

  test('createSupportAssignment: legacy-shaped requirementId', async () => {
    const f = await fixture();
    const spy = spyUow(f.pool, f.workspaceId);
    const idempotencyKey = randomUUID();
    await assertRejectedBeforeExecute({
      label: 'createSupportAssignment',
      fixture: f,
      spy,
      idempotencyKey,
      run: () =>
        createSupportAssignment(spy.uow, {
          workspaceId: f.workspaceId,
          actorPrincipalId: f.actorPrincipalId,
          idempotencyKey,
          requirementId: 'requirement-legacy-1',
          requirementVersion: 1,
          assignedSupporterTravellerIds: [randomUUID()],
          assignedScopes: [{ supporterTravellerId: randomUUID(), interval: FULL }],
        }),
    });
  });

  test('setSupportAssignmentStatus: legacy-shaped addressed assignmentId', async () => {
    const f = await fixture();
    const spy = spyUow(f.pool, f.workspaceId);
    const idempotencyKey = randomUUID();
    await assertRejectedBeforeExecute({
      label: 'setSupportAssignmentStatus',
      fixture: f,
      spy,
      idempotencyKey,
      run: () =>
        setSupportAssignmentStatus(spy.uow, {
          workspaceId: f.workspaceId,
          actorPrincipalId: f.actorPrincipalId,
          idempotencyKey,
          assignmentId: 'assignment-legacy-1',
          lifecycleStatus: 'ACTIVE',
          expectedRevision: 1,
        }),
    });
  });

  test('replaceSupportAssignmentScope: legacy-shaped addressed assignmentId', async () => {
    const f = await fixture();
    const spy = spyUow(f.pool, f.workspaceId);
    const idempotencyKey = randomUUID();
    await assertRejectedBeforeExecute({
      label: 'replaceSupportAssignmentScope',
      fixture: f,
      spy,
      idempotencyKey,
      run: () =>
        replaceSupportAssignmentScope(spy.uow, {
          workspaceId: f.workspaceId,
          actorPrincipalId: f.actorPrincipalId,
          idempotencyKey,
          assignmentId: 'assignment-legacy-1',
          assignedSupporterTravellerIds: [randomUUID()],
          assignedScopes: [{ supporterTravellerId: randomUUID(), interval: FULL }],
          expectedRevision: 1,
        }),
    });
  });

  test('positive control: createCoordinationGroup commits for an ordinary UUID command', async () => {
    const f = await fixture();
    const spy = spyUow(f.pool, f.workspaceId);
    const idempotencyKey = randomUUID();
    const result = mustOk(
      await createCoordinationGroup(spy.uow, {
        workspaceId: f.workspaceId,
        actorPrincipalId: f.actorPrincipalId,
        idempotencyKey,
        name: 'G12 valid UUID control group',
      }),
    );
    assert.equal(result.revision, 1);
    assert.equal(spy.calls(), 1, 'a valid UUID command must still run through execute() exactly once');
    const receipts = await receiptCount(f.pool, f.workspaceId, idempotencyKey);
    assert.equal(receipts, 1, 'a committed command must leave exactly one command_receipts row');
  });
});

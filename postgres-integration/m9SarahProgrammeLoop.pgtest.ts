/**
 * M9 — primary scenario programme recovery PG proof (no Atlas/Nuitée facts).
 *
 * Proves: readiness geometry, bilateral schedule mutation via real M4 command,
 * reassessment-driven resolution gate. Fixture UUIDs are seeded locally.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed, seedTraveller, seedTrip, seedJourney } from './m2Seed.ts';
import { seedEvent, seedProgramme, seedProgrammeItem, seedParticipation } from './m4Seed.ts';
import { PgUnitOfWork, type ExecuteOutcome } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { openRecoveryCase } from '../src/persistence/postgres/commands/m8AuthorityCommands.ts';
import { updateProgrammeItemSchedule } from '../src/persistence/postgres/commands/programmeCommands.ts';
import { saveAssessment } from '../src/persistence/postgres/world/pgAssessments.ts';
import { evaluateRecoveryCaseResolution } from '../src/app/target/recoveryCaseResolution.ts';
import { resolveRecoveryCase } from '../src/persistence/postgres/commands/m9CaseResolutionCommands.ts';
import { evaluateProgrammeArrivalReadiness } from '../src/resolution/evaluation/programmeArrivalReadiness.ts';
import { loadRecoveryCaseFacts } from '../src/app/target/readmodels/pgFactAssembler.ts';
import { projectRecoveryCase } from '../src/app/target/readmodels/projectRecoveryCase.ts';
import { commandPreviewBilateralProgrammeTimeSwap } from '../src/app/target/applicationCommands.ts';
import type { WorldSnapshotManifest } from '../src/contracts/v2/scope/readScope.ts';

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

const NOW = '2031-06-01T12:00:00.000Z';
const ARRIVAL = '2031-06-01T10:30:00.000Z';
const EARLY = '2031-06-01T11:30:00.000Z';
const LATE = '2031-06-01T15:00:00.000Z';

function mustOk<T>(outcome: ExecuteOutcome<T>): T {
  if (!outcome.ok) assert.fail(`${outcome.conflict.kind}: ${outcome.conflict.message}`);
  return outcome.value;
}

function emptyManifest(evaluatedAt = NOW): WorldSnapshotManifest {
  return {
    evaluatedAt,
    evaluatorVersions: [],
    aggregateReads: [],
    scopeReads: [],
    evidenceReads: [],
    coverageReads: [],
    missingCoverage: [],
  };
}

describe('M9 Sarah-equivalent programme loop (PG)', () => {
  test('readiness fail → bilateral schedule swap → assessments PASS → case resolves', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'M9 programme loop');

    const travellers = [];
    const journeys = [];
    for (let i = 1; i <= 5; i++) {
      const t = await seedTraveller(seed, { displayName: `Cohort Traveller ${i}` });
      const tripId = await seedTrip(seed, { purpose: 'TEST', lifecycleStatus: 'ACTIVE' });
      const journeyId = await seedJourney(seed, {
        tripId,
        travellerId: t.travellerId,
        lifecycleStatus: 'ACTIVE',
      });
      travellers.push(t);
      journeys.push({ tripId, journeyId, travellerId: t.travellerId });
    }

    const eventId = await seedEvent(seed, { lifecycleStatus: 'ACTIVE' });
    const programmeId = await seedProgramme(seed, { eventId, lifecycleStatus: 'ACTIVE' });

    const earlyItem = await seedProgrammeItem(seed, {
      programmeId,
      title: 'Early required commitment',
      lifecycleStatus: 'SCHEDULED',
      scheduleAuthority: 'INTERNAL',
      window: { start: EARLY, end: '2031-06-01T12:30:00.000Z' },
      operatingRequirements: {
        requiresPhysicalPresence: true,
        readinessBufferMinutes: 150,
      },
    });
    const lateItem = await seedProgrammeItem(seed, {
      programmeId,
      title: 'Later counterpart commitment',
      lifecycleStatus: 'SCHEDULED',
      scheduleAuthority: 'INTERNAL',
      window: { start: LATE, end: '2031-06-01T16:00:00.000Z' },
      operatingRequirements: {
        requiresPhysicalPresence: true,
        readinessBufferMinutes: 150,
      },
    });

    // Traveller 1 on early commitment; travellers 2-5 on late (and counterpart uses late item).
    await seedParticipation(seed, {
      programmeItemId: earlyItem.programmeItemId,
      travellerId: travellers[0]!.travellerId,
      obligation: 'REQUIRED',
      accepted: true,
    });
    for (let i = 1; i < 5; i++) {
      await seedParticipation(seed, {
        programmeItemId: lateItem.programmeItemId,
        travellerId: travellers[i]!.travellerId,
        obligation: 'REQUIRED',
        accepted: true,
      });
    }
    await commitSeed(seed);

    const uow = () => new PgUnitOfWork(pool, seed.workspaceId);

    // --- Readiness arithmetic (frozen geometry) ---
    const disrupted = evaluateProgrammeArrivalReadiness({
      scheduledArrival: ARRIVAL,
      commitmentStart: EARLY,
      requiredMinutes: 150,
      requiresPhysicalPresence: true,
      obligation: 'REQUIRED',
    });
    assert.equal(disrupted.verdict, 'FAIL');
    assert.equal(disrupted.availableMinutes, 60);

    const othersPass = evaluateProgrammeArrivalReadiness({
      scheduledArrival: ARRIVAL,
      commitmentStart: LATE,
      requiredMinutes: 150,
      requiresPhysicalPresence: true,
      obligation: 'REQUIRED',
    });
    assert.equal(othersPass.verdict, 'PASS');

    // --- Preview does not mutate ---
    const beforeWindows = await pool.query<{ id: string; window_start: Date }>(
      `SELECT id, window_start FROM programme_items WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
      [seed.workspaceId, [earlyItem.programmeItemId, lateItem.programmeItemId]],
    );
    const preview = commandPreviewBilateralProgrammeTimeSwap({
      itemA: {
        itemRef: earlyItem.programmeItemId,
        title: 'Early',
        window: { start: EARLY, end: '2031-06-01T12:30:00.000Z' },
        participantTravellerRef: travellers[0]!.travellerId,
        participantLabel: 'Cohort Traveller 1',
      },
      itemB: {
        itemRef: lateItem.programmeItemId,
        title: 'Late',
        window: { start: LATE, end: '2031-06-01T16:00:00.000Z' },
        participantTravellerRef: 'local-counterpart',
        participantLabel: 'Local counterpart',
      },
      evaluate: ({ travellerRef, window }) => {
        if (travellerRef === 'local-counterpart') return { verdict: 'PASS' };
        const readiness = evaluateProgrammeArrivalReadiness({
          scheduledArrival: ARRIVAL,
          commitmentStart: window.start,
          requiredMinutes: 150,
          requiresPhysicalPresence: true,
          obligation: 'REQUIRED',
        });
        return { verdict: readiness.verdict === 'PASS' ? 'PASS' : readiness.verdict === 'FAIL' ? 'FAIL' : 'UNKNOWN' };
      },
    });
    assert.equal(preview.mutatesAuthoritativeState, false);
    assert.ok(preview.bothPartiesProjectedViable);

    const afterPreview = await pool.query<{ id: string; window_start: Date }>(
      `SELECT id, window_start FROM programme_items WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
      [seed.workspaceId, [earlyItem.programmeItemId, lateItem.programmeItemId]],
    );
    assert.deepEqual(
      afterPreview.rows.map((r) => r.window_start.toISOString()).sort(),
      beforeWindows.rows.map((r) => r.window_start.toISOString()).sort(),
    );

    // --- Authoritative bilateral schedule swap via real M4 command ---
    const caseOpened = mustOk(await openRecoveryCase(uow(), {
      workspaceId: seed.workspaceId,
      actorPrincipalId: seed.actorId,
      idempotencyKey: randomUUID(),
      openedAt: NOW,
    }));

    mustOk(await updateProgrammeItemSchedule(uow(), {
      workspaceId: seed.workspaceId,
      actorPrincipalId: seed.actorId,
      idempotencyKey: randomUUID(),
      programmeId,
      programmeItemId: earlyItem.programmeItemId,
      expectedProgrammeRevision: 1,
      window: { start: LATE, end: '2031-06-01T16:00:00.000Z' },
    }));
    mustOk(await updateProgrammeItemSchedule(uow(), {
      workspaceId: seed.workspaceId,
      actorPrincipalId: seed.actorId,
      idempotencyKey: randomUUID(),
      programmeId,
      programmeItemId: lateItem.programmeItemId,
      expectedProgrammeRevision: 2,
      window: { start: EARLY, end: '2031-06-01T12:30:00.000Z' },
    }));

    const swappedEarly = await pool.query<{ window_start: Date }>(
      `SELECT window_start FROM programme_items WHERE workspace_id = $1 AND id = $2`,
      [seed.workspaceId, earlyItem.programmeItemId],
    );
    assert.equal(swappedEarly.rows[0]!.window_start.toISOString(), LATE);

    // After swap, disrupted traveller's item (earlyItem) is now LATE → PASS
    const afterSwap = evaluateProgrammeArrivalReadiness({
      scheduledArrival: ARRIVAL,
      commitmentStart: LATE,
      requiredMinutes: 150,
      requiresPhysicalPresence: true,
      obligation: 'REQUIRED',
    });
    assert.equal(afterSwap.verdict, 'PASS');

    // Attach journeys to case scope (authoritative resolution subjects).
    for (const j of journeys) {
      await pool.query(
        `INSERT INTO case_subjects (workspace_id, recovery_case_id, subject_kind, subject_id, role)
         VALUES ($1, $2, 'JOURNEY', $3, 'affected')`,
        [seed.workspaceId, caseOpened.caseId, j.journeyId],
      );
    }

    // --- Save PASS assessments for all journeys; resolve case ---
    for (const j of journeys) {
      await saveAssessment(pool, seed.workspaceId, {
        id: randomUUID(),
        kind: 'VIABILITY',
        evaluatedAt: NOW,
        overallVerdict: 'PASS',
        subjects: [{ subjectRef: { kind: 'JOURNEY', id: j.journeyId }, role: 'PRIMARY' }],
        dimensions: [],
        manifest: emptyManifest(),
      }, seed.actorId);
    }

    const evaluation = await evaluateRecoveryCaseResolution(pool, {
      workspaceId: seed.workspaceId,
      recoveryCaseId: caseOpened.caseId,
      now: NOW,
      requiredAffectedPeople: journeys.map((j) => ({ kind: 'JOURNEY' as const, id: j.journeyId })),
    });
    assert.equal(evaluation.allowed, true, !evaluation.allowed ? evaluation.detail : '');

    mustOk(await resolveRecoveryCase(uow(), {
      workspaceId: seed.workspaceId,
      actorPrincipalId: seed.actorId,
      idempotencyKey: randomUUID(),
      recoveryCaseId: caseOpened.caseId,
      now: NOW,
      requiredAffectedPeople: journeys.map((j) => ({ kind: 'JOURNEY' as const, id: j.journeyId })),
    }));

    const facts = await loadRecoveryCaseFacts(pool, seed.workspaceId, caseOpened.caseId, NOW);
    assert.ok(facts);
    projectRecoveryCase(facts!);

    const statusRow = await pool.query<{ lifecycle_status: string }>(
      `SELECT lifecycle_status FROM recovery_cases WHERE workspace_id = $1 AND id = $2`,
      [seed.workspaceId, caseOpened.caseId],
    );
    assert.ok(['RESOLVED', 'CLOSED'].includes(statusRow.rows[0]!.lifecycle_status));
  });
});

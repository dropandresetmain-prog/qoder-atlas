/**
 * M9 C4 item 2B — Sarah-equivalent target PostgreSQL end-to-end acceptance.
 *
 * Real ingress → five real M6 journey evaluations → recovery case → authoritative
 * bilateral programme swap preview → M7 strategy/plan → M8 authority → internal
 * execution of BOTH CHANGE_PROGRAMME_ITEM_TIME intents → reassessment → resolution.
 * No saveAssessment shortcuts, no direct updateProgrammeItemSchedule for the swap.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed, takeSeedEvidence } from './m2Seed.ts';
import {
  KnowledgeFixture,
  seedBooking,
  seedEngagementIntent,
  seedJourney,
  seedJurisdictionWithPlaces,
  seedService,
  seedTransportIntent,
  seedTraveller,
  seedTrip,
} from './m6WorldSeed.ts';
import { seedEvent, seedParticipation, seedProgramme, seedProgrammeItem } from './m4Seed.ts';
import { composeTargetApplication } from '../src/app/target/composeTargetApplication.ts';
import type { TargetApplication } from '../src/app/target/composeTargetApplication.ts';
import {
  acceptProviderShapedDemoEvent,
  commandPreviewAuthoritativeBilateralProgrammeTimeSwap,
} from '../src/app/target/applicationCommands.ts';
import { openRecoveryCase, persistActionPlan } from '../src/persistence/postgres/commands/m8AuthorityCommands.ts';
import { createPrincipal } from '../src/persistence/postgres/commands/peopleCommands.ts';
import { executeInternalProgrammeItemSchedule } from '../src/persistence/postgres/execution/internalProgrammeExecutor.ts';
import { PgUnitOfWork, type ExecuteOutcome } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { captureWorld } from '../src/persistence/postgres/world/pgCurrentState.ts';
import {
  currentAssessmentView,
  type ReassessmentPipeline,
} from '../src/persistence/postgres/world/pgAssessments.ts';
import { evaluateImpact } from '../src/persistence/postgres/world/pgEvaluation.ts';
import { evaluateRecoveryCaseResolution } from '../src/app/target/recoveryCaseResolution.ts';
import { resolveRecoveryCase } from '../src/persistence/postgres/commands/m9CaseResolutionCommands.ts';
import { createM6Registry } from '../src/resolution/evaluation/registry.ts';
import { assessSubject } from '../src/resolution/evaluation/assess.ts';
import { projectEffectiveWorld } from '../src/resolution/world/effectiveItinerary.ts';
import { evaluateRecoveryStrategy } from '../src/resolution/scenarios/evaluate.ts';
import { compileActionPlan } from '../src/resolution/planning/compiler.ts';
import { ScenarioChangeSchema } from '../src/contracts/v2/scenario/scenarioChange.ts';
import type { WorldSnapshotManifest } from '../src/contracts/v2/scope/readScope.ts';
import type { TypedRef } from '../src/domain/v2/shared/identity.ts';
import type { WObjective } from '../src/resolution/world/world.ts';
import {
  loadRequiredAuthorityScopesOrFail,
  persistStrategyChangeRow,
  prepareParams,
  seedStoredExecutionAuthority,
  seedMinimalCurrentAssessment,
  bootstrapTestGrantIssuer,
} from './m8ExecutionGateHelpers.ts';

const NOW = '2031-06-02T00:00:00.000Z';
const EXEC_NOW = '2032-01-01T00:00:00.000Z';
const EARLY_WINDOW = { start: '2031-06-02T11:30:00.000Z', end: '2031-06-02T12:00:00.000Z' };
const LATE_WINDOW = { start: '2031-06-02T14:30:00.000Z', end: '2031-06-02T15:00:00.000Z' };
const PEER_WINDOW = { start: '2031-06-02T16:00:00.000Z', end: '2031-06-02T17:00:00.000Z' };
const BASELINE_ARRIVAL = '2031-06-02T08:00:00.000Z';
const DELAYED_ARRIVAL = '2031-06-02T10:30:00.000Z';

function mustOk<T>(o: ExecuteOutcome<T>): T {
  if (!o.ok) assert.fail(`${o.conflict.kind}: ${o.conflict.message}`);
  return o.value;
}

function journeyRef(id: string): TypedRef {
  return { kind: 'JOURNEY', id };
}

async function overallVerdict(
  pool: Awaited<ReturnType<typeof sharedTestPool>>,
  workspaceId: string,
  journeyId: string,
  now: string,
): Promise<string> {
  const view = await currentAssessmentView(pool, workspaceId, journeyRef(journeyId), 'VIABILITY', now);
  if (view.status !== 'CURRENT' || !view.assessment) {
    assert.fail(`journey ${journeyId} not CURRENT at ${now}: ${JSON.stringify(view)}`);
  }
  return view.assessment.overallVerdict;
}

async function drainReassessment(
  app: TargetApplication,
  pipeline: ReassessmentPipeline,
  maxRounds = 30,
): Promise<void> {
  for (let i = 0; i < maxRounds; i++) {
    await app.reassessmentWorker.runOnce(NOW, pipeline, app.workspaceId);
    const pending = await app.pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM scheduled_reassessments
        WHERE workspace_id = $1 AND state IN ('PENDING', 'CLAIMED')`,
      [app.workspaceId],
    );
    if (pending.rows[0]!.n === '0') return;
  }
  assert.fail('reassessment worker did not drain pending work');
}

describe('M9 Sarah target PG E2E (composeTargetApplication)', () => {
  let seedPool: Awaited<ReturnType<typeof sharedTestPool>>;
  let app: TargetApplication | undefined;

  after(async () => {
    if (app) await app.close();
    if (seedPool) await seedPool.end();
  });

  test('ingress, cohort evaluation, bilateral swap execution, resolution — no flight purchase intents', async () => {
    seedPool = await sharedTestPool();
    const seed = await beginSeed(seedPool, 'M9 Sarah target E2E');

    const host = await seedJurisdictionWithPlaces(seed, {
      name: 'Host regime',
      places: [{ name: 'Venue', placeType: 'VENUE' }],
    });
    const origin = await seedJurisdictionWithPlaces(seed, {
      name: 'Origin regime',
      places: [{ name: 'Origin', placeType: 'STATION' }],
    });
    const [venueId] = host.placeIds as [string];
    const [originId] = origin.placeIds as [string];

    const travellers: { travellerId: string; journeyId: string; tripId: string }[] = [];
    for (let i = 0; i < 5; i++) {
      const t = await seedTraveller(seed, { displayName: `Cohort member ${i + 1}` });
      const tripId = await seedTrip(seed, { purpose: 'TEST', lifecycleStatus: 'ACTIVE' });
      const journeyId = await seedJourney(seed, {
        tripId,
        travellerId: t.travellerId,
        lifecycleStatus: 'ACTIVE',
      });
      travellers.push({ travellerId: t.travellerId, journeyId, tripId });
    }

    const sharedServiceId = await seedService(seed, {
      mode: 'AIR',
      operator: 'Test Air',
      originPlaceId: originId,
      destinationPlaceId: venueId,
      published: { departure: '2031-06-02T05:00:00.000Z', arrival: BASELINE_ARRIVAL },
    });
    const localHostServiceId = await seedService(seed, {
      mode: 'AIR',
      operator: 'Test Air',
      originPlaceId: originId,
      destinationPlaceId: venueId,
      published: { departure: '2031-06-02T04:00:00.000Z', arrival: '2031-06-02T07:00:00.000Z' },
    });

    // Shared disrupted inbound for the cohort (Felix-analog is index 2).
    for (const idx of [0, 2, 3, 4]) {
      const { journeyId, travellerId } = travellers[idx]!;
      const itemId = await seedTransportIntent(seed, {
        journeyId,
        orderKey: '010',
        originPlaceId: originId,
        destinationPlaceId: venueId,
        selectedServiceId: sharedServiceId,
      });
      await seedBooking(seed, { travellerId, serviceId: sharedServiceId, journeyItemId: itemId });
    }
    {
      const { journeyId, travellerId } = travellers[1]!;
      const itemId = await seedTransportIntent(seed, {
        journeyId,
        orderKey: '010',
        originPlaceId: originId,
        destinationPlaceId: venueId,
        selectedServiceId: localHostServiceId,
      });
      await seedBooking(seed, { travellerId, serviceId: localHostServiceId, journeyItemId: itemId });
    }

    const eventId = await seedEvent(seed, { lifecycleStatus: 'ACTIVE' });
    const programmeId = await seedProgramme(seed, { eventId, lifecycleStatus: 'ACTIVE' });
    const earlyItem = await seedProgrammeItem(seed, {
      programmeId,
      title: 'Early required headline',
      placeId: venueId,
      lifecycleStatus: 'SCHEDULED',
      scheduleAuthority: 'INTERNAL',
      window: EARLY_WINDOW,
      operatingRequirements: { requiresPhysicalPresence: true, readinessBufferMinutes: 150 },
    });
    const lateItem = await seedProgrammeItem(seed, {
      programmeId,
      title: 'Late local-host commitment',
      placeId: venueId,
      lifecycleStatus: 'SCHEDULED',
      scheduleAuthority: 'INTERNAL',
      window: LATE_WINDOW,
      operatingRequirements: { requiresPhysicalPresence: true, readinessBufferMinutes: 150 },
    });
    const peerItem = await seedProgrammeItem(seed, {
      programmeId,
      title: 'Late peer commitment',
      placeId: venueId,
      lifecycleStatus: 'SCHEDULED',
      scheduleAuthority: 'INTERNAL',
      window: PEER_WINDOW,
      operatingRequirements: { requiresPhysicalPresence: true, readinessBufferMinutes: 150 },
    });

    const earlyParticipation = await seedParticipation(seed, {
      programmeItemId: earlyItem.programmeItemId,
      travellerId: travellers[0]!.travellerId,
      obligation: 'REQUIRED',
      accepted: true,
    });
    await seedEngagementIntent(seed, {
      journeyId: travellers[0]!.journeyId,
      orderKey: '020',
      participationId: earlyParticipation,
    });

    const lateParticipation = await seedParticipation(seed, {
      programmeItemId: lateItem.programmeItemId,
      travellerId: travellers[1]!.travellerId,
      obligation: 'REQUIRED',
      accepted: true,
    });
    await seedEngagementIntent(seed, {
      journeyId: travellers[1]!.journeyId,
      orderKey: '020',
      participationId: lateParticipation,
    });

    for (const idx of [2, 3, 4]) {
      const participationId = await seedParticipation(seed, {
        programmeItemId: peerItem.programmeItemId,
        travellerId: travellers[idx]!.travellerId,
        obligation: 'REQUIRED',
        accepted: true,
      });
      await seedEngagementIntent(seed, {
        journeyId: travellers[idx]!.journeyId,
        orderKey: '020',
        participationId,
      });
    }

    await commitSeed(seed);

    const knowledge = new KnowledgeFixture(seedPool, seed);
    for (const jurisdictionId of [host.jurisdictionId, origin.jurisdictionId]) {
      for (const topic of ['ADVISORY', 'CONDITION', 'ENTRY_REQUIREMENT', 'TRANSIT_REQUIREMENT']) {
        await knowledge.coverage({ topic, completeness: 'COMPLETE', jurisdictionId });
      }
    }

    app = await composeTargetApplication({ workspaceId: seed.workspaceId, actorId: seed.actorId });
    const pool = app.pool;
    const uow = app.unitOfWork;
    const registry = createM6Registry();
    const journeyIds = travellers.map((t) => t.journeyId);
    const focusJourneys = journeyIds.map((id) => journeyRef(id));

    const cmdCtx = {
      workspaceId: seed.workspaceId,
      actorPrincipalId: seed.actorId,
      uow,
      pool,
    };

    const reassessmentPipeline: ReassessmentPipeline = async (claim, assessmentId) => {
      const world = await captureWorld(pool, {
        workspaceId: claim.workspaceId,
        focus: [claim.subject],
        at: NOW,
        informationTopics: registry.informationTopics,
      });
      return assessSubject({
        registry,
        world,
        effective: projectEffectiveWorld(world),
        subject: claim.subject,
        now: NOW,
        assessmentId,
      }).result;
    };

    // --- Baseline: all five journeys PASS ---
    const baseline = await evaluateImpact(pool, {
      workspaceId: seed.workspaceId,
      focus: focusJourneys,
      now: NOW,
      registry,
      persist: { actorId: seed.actorId },
    });
    for (const j of journeyIds) {
      const a = baseline.assessments.find((x) => x.subjects[0]?.subjectRef.id === j);
      assert.ok(a, `baseline assessment for ${j}`);
      assert.equal(a!.overallVerdict, 'PASS', JSON.stringify(a!.dimensions));
    }

    // --- Provider-shaped ingress: shared service arrival 10:30 ---
    const revisionBefore = await pool.query<{ revision: string }>(
      'SELECT revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2',
      [seed.workspaceId, sharedServiceId],
    );
    const ingress = await acceptProviderShapedDemoEvent(cmdCtx, {
      providerId: 'test-supplier',
      providerEventId: `evt-${randomUUID()}`,
      receivedAt: '2031-06-01T23:00:00.000Z',
      payload: {
        subjectKind: 'TRANSPORT_SERVICE',
        subjectId: sharedServiceId,
        expectedRevision: Number(revisionBefore.rows[0]!.revision),
        field: 'ACTUAL',
        arrival: DELAYED_ARRIVAL,
        evidenceId: takeSeedEvidence(seed),
      },
      disclosedAsSimulatedDemoInput: true,
    });
    assert.equal(ingress.ok, true, ingress.ok ? '' : JSON.stringify(ingress));

    await drainReassessment(app, reassessmentPipeline);

    assert.equal(await overallVerdict(pool, seed.workspaceId, journeyIds[0]!, NOW), 'FAIL');
    for (const j of journeyIds.slice(1)) {
      assert.equal(await overallVerdict(pool, seed.workspaceId, j, NOW), 'PASS', `expected PASS for ${j}`);
    }

    // Felix-analog (index 2) must be on the shared service and evaluated.
    const felixBooking = await pool.query(
      `SELECT 1 FROM transport_line_details tld
        JOIN reservation_allocations ra ON ra.workspace_id = tld.workspace_id AND ra.line_id = tld.line_id
       WHERE tld.workspace_id = $1 AND tld.transport_service_id = $2 AND ra.traveller_id = $3`,
      [seed.workspaceId, sharedServiceId, travellers[2]!.travellerId],
    );
    assert.equal(felixBooking.rowCount, 1, 'Felix-analog booked on shared transport');

    const principalId = randomUUID();
    mustOk(await createPrincipal(uow(), {
      workspaceId: seed.workspaceId,
      actorPrincipalId: seed.actorId,
      idempotencyKey: randomUUID(),
      principalId,
      actorType: 'HUMAN',
      authIssuer: 'https://issuer.invalid/sarah-e2e',
      authSubject: principalId,
    }));

    const opened = mustOk(await openRecoveryCase(uow(), {
      workspaceId: seed.workspaceId,
      actorPrincipalId: seed.actorId,
      idempotencyKey: randomUUID(),
      openedAt: NOW,
    }));

    for (const j of journeyIds) {
      await pool.query(
        `INSERT INTO case_subjects (workspace_id, recovery_case_id, subject_kind, subject_id, role)
         VALUES ($1, $2, 'JOURNEY', $3, 'affected')`,
        [seed.workspaceId, opened.caseId, j],
      );
    }

    const beforeWindows = await pool.query<{ id: string; window_start: Date }>(
      `SELECT id, window_start FROM programme_items WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
      [seed.workspaceId, [earlyItem.programmeItemId, lateItem.programmeItemId]],
    );

    const previewOutcome = await commandPreviewAuthoritativeBilateralProgrammeTimeSwap(cmdCtx, {
      itemARef: earlyItem.programmeItemId,
      itemBRef: lateItem.programmeItemId,
      now: NOW,
    });
    assert.equal(previewOutcome.ok, true, !previewOutcome.ok ? previewOutcome.error : '');
    if (!previewOutcome.ok) return;
    const preview = previewOutcome.result;
    assert.equal(preview.mutatesAuthoritativeState, false);
    assert.equal(preview.previewAccepted, true);
    assert.equal(preview.bothPartiesProjectedViable, true);
    assert.equal(preview.othersRemainViable, true);

    const earlyTraveller = travellers[0]!.travellerId;
    const lateTraveller = travellers[1]!.travellerId;
    const earlyProjection = preview.projections.find((p) => p.travellerRef === earlyTraveller);
    const lateProjection = preview.projections.find((p) => p.travellerRef === lateTraveller);
    assert.ok(earlyProjection);
    assert.ok(lateProjection);
    assert.equal(earlyProjection!.verdict, 'PASS');
    assert.equal(lateProjection!.verdict, 'PASS');

    const afterPreview = await pool.query<{ id: string; window_start: Date }>(
      `SELECT id, window_start FROM programme_items WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
      [seed.workspaceId, [earlyItem.programmeItemId, lateItem.programmeItemId]],
    );
    assert.deepEqual(
      afterPreview.rows.map((r) => `${r.id}:${r.window_start.toISOString()}`).sort(),
      beforeWindows.rows.map((r) => `${r.id}:${r.window_start.toISOString()}`).sort(),
    );

    const programmeRevisionRow = await pool.query<{ revision: string }>(
      'SELECT revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2',
      [seed.workspaceId, programmeId],
    );
    const programmeRevision = Number(programmeRevisionRow.rows[0]!.revision);

    const strategyFocus: TypedRef[] = [
      { kind: 'PROGRAMME_ITEM', id: earlyItem.programmeItemId },
      { kind: 'PROGRAMME_ITEM', id: lateItem.programmeItemId },
    ];
    const captured = await captureWorld(pool, {
      workspaceId: seed.workspaceId,
      focus: strategyFocus,
      at: NOW,
      informationTopics: registry.informationTopics,
    });
    const anchorObjectives: WObjective[] = journeyIds.map((journeyId) => ({
      id: randomUUID(),
      revision: 1,
      owner: { kind: 'JOURNEY', id: journeyId },
      successPredicateKind: 'STATEMENT',
      hardness: 'HARD',
      priority: 1,
      disposition: 'ACHIEVED',
      dispositionEvidenceId: null,
      targets: [],
    }));
    const baseWorld = { ...captured, objectives: [...captured.objectives, ...anchorObjectives] };
    const baseManifest: WorldSnapshotManifest = {
      ...captured.manifest,
      aggregateReads: [
        ...(captured.manifest.aggregateReads ?? []).filter((r) => r.aggregateRef.kind !== 'PROGRAMME'),
        { aggregateRef: { kind: 'PROGRAMME', id: programmeId }, revision: programmeRevision },
      ],
    };

    const scenarioChange = ScenarioChangeSchema.parse({
      id: randomUUID(),
      recoveryStrategyId: randomUUID(),
      strategyVersion: 1,
      affectedSubjectRefs: strategyFocus,
      basisAssessmentId: randomUUID(),
      effects: [
        {
          effectKind: 'CHANGE_PROGRAMME_ITEM_TIME',
          programmeItemId: earlyItem.programmeItemId,
          proposedWindow: LATE_WINDOW,
        },
        {
          effectKind: 'CHANGE_PROGRAMME_ITEM_TIME',
          programmeItemId: lateItem.programmeItemId,
          proposedWindow: EARLY_WINDOW,
        },
      ],
    });

    const evaluated = evaluateRecoveryStrategy({
      recoveryCaseId: opened.caseId,
      baseWorld,
      baseManifest,
      basisAssessmentId: scenarioChange.basisAssessmentId,
      scenarioChange,
      now: NOW,
      registry,
    });
    assert.equal(evaluated.ok, true, JSON.stringify(evaluated));
    if (!evaluated.ok) return;
    assert.equal(evaluated.value.strategy.viability, 'VIABLE');

    const programmeOwnership = new Map([
      [earlyItem.programmeItemId, programmeId],
      [lateItem.programmeItemId, programmeId],
    ]);
    const compiled = compileActionPlan({
      strategy: evaluated.value.strategy,
      now: NOW,
      programmeItemOwnership: programmeOwnership,
    });
    assert.equal(compiled.ok, true);
    if (!compiled.ok) return;
    const plan = compiled.value.plan;
    assert.equal(plan.intents.length, 2);
    assert.ok(
      plan.dependencies.some(
        (d) =>
          (d.fromActionIntentId === plan.intents[0]!.id && d.toActionIntentId === plan.intents[1]!.id)
          || (d.fromActionIntentId === plan.intents[1]!.id && d.toActionIntentId === plan.intents[0]!.id),
      ),
      `same-Programme intents must be ordered; deps=${JSON.stringify(plan.dependencies)} expected=${JSON.stringify(plan.intents.map((i) => i.expectedRevisions))}`,
    );
    const firstIntentId = plan.dependencies.find((d) =>
      plan.intents.some((i) => i.id === d.fromActionIntentId)
      && plan.intents.some((i) => i.id === d.toActionIntentId),
    )?.fromActionIntentId ?? plan.intents[0]!.id;
    const secondIntentId = plan.intents.find((i) => i.id !== firstIntentId)!.id;

    for (const intent of plan.intents) {
      assert.notEqual(intent.capabilityRef, 'external:flight.book');
      assert.equal(/flight/i.test(intent.operationNamespace), false);
      assert.equal(intent.capabilityRef, 'internal:programme.schedule');
    }

    await persistStrategyChangeRow(pool, seed.workspaceId, seed.actorId, opened.caseId, scenarioChange, {
      baseManifest,
      candidateSummaries: journeyIds.map((id) => ({ subjectRef: journeyRef(id) })),
    });
    mustOk(await persistActionPlan(uow(), {
      workspaceId: seed.workspaceId,
      actorPrincipalId: seed.actorId,
      idempotencyKey: randomUUID(),
      plan,
      recoveryStrategyId: scenarioChange.recoveryStrategyId,
    }));

    for (const journeyId of journeyIds) {
      await seedMinimalCurrentAssessment(pool, seed.workspaceId, journeyRef(journeyId), EXEC_NOW, {
        tripId: travellers.find((t) => t.journeyId === journeyId)!.tripId,
      });
    }

    // ISSUER-POL: bootstrap once for this workspace, scoped to cover every
    // intent's required authority scope, then reuse below — bootstrap only
    // satisfies a workspace's very first grant.
    const intentScopes = await Promise.all(
      plan.intents.map((intent) => loadRequiredAuthorityScopesOrFail(pool, seed.workspaceId, intent.id)),
    );
    const issuerPrincipalId = await bootstrapTestGrantIssuer(
      pool, seed.workspaceId, seed.actorId, EXEC_NOW, intentScopes.flat(),
    );
    for (let i = 0; i < plan.intents.length; i++) {
      const intent = plan.intents[i]!;
      const scope = intentScopes[i]!;
      await seedStoredExecutionAuthority({
        pool,
        workspaceId: seed.workspaceId,
        actorId: seed.actorId,
        principalId,
        planId: plan.id,
        intentId: intent.id,
        scope,
        representedPartyRef: { kind: 'TRAVELLER', id: travellers[0]!.travellerId },
        requirementRole: 'CASE_OWNER',
        now: EXEC_NOW,
        assessmentSubject: { kind: 'JOURNEY', id: travellers[0]!.journeyId },
        assessmentTripId: travellers[0]!.tripId,
        issuerPrincipalId,
      });
    }

    const execUow = () => new PgUnitOfWork(pool, seed.workspaceId);
    const first = await executeInternalProgrammeItemSchedule(pool, execUow(), prepareParams({
      workspaceId: seed.workspaceId,
      actorId: seed.actorId,
      planId: plan.id,
      intentId: firstIntentId,
      principalId,
      now: EXEC_NOW,
    }));
    assert.equal(first.ok, true, !first.ok ? JSON.stringify(first.conflict) : '');
    const second = await executeInternalProgrammeItemSchedule(pool, execUow(), prepareParams({
      workspaceId: seed.workspaceId,
      actorId: seed.actorId,
      planId: plan.id,
      intentId: secondIntentId,
      principalId,
      now: EXEC_NOW,
    }));
    assert.equal(second.ok, true, !second.ok ? JSON.stringify(second.conflict) : '');

    const swappedEarly = await pool.query<{ window_start: Date }>(
      'SELECT window_start FROM programme_items WHERE workspace_id = $1 AND id = $2',
      [seed.workspaceId, earlyItem.programmeItemId],
    );
    assert.equal(swappedEarly.rows[0]!.window_start.toISOString(), LATE_WINDOW.start);

    await evaluateImpact(pool, {
      workspaceId: seed.workspaceId,
      focus: focusJourneys,
      now: NOW,
      registry,
      persist: { actorId: seed.actorId },
    });

    for (const j of journeyIds) {
      assert.equal(await overallVerdict(pool, seed.workspaceId, j, NOW), 'PASS', `post-swap ${j}`);
    }

    const resolution = await evaluateRecoveryCaseResolution(pool, {
      workspaceId: seed.workspaceId,
      recoveryCaseId: opened.caseId,
      now: NOW,
      requiredAffectedPeople: journeyIds.map((id) => journeyRef(id)),
    });
    assert.equal(resolution.allowed, true, !resolution.allowed ? resolution.detail : '');

    mustOk(await resolveRecoveryCase(uow(), {
      workspaceId: seed.workspaceId,
      actorPrincipalId: seed.actorId,
      idempotencyKey: randomUUID(),
      recoveryCaseId: opened.caseId,
      now: NOW,
      requiredAffectedPeople: journeyIds.map((id) => journeyRef(id)),
    }));

    const statusRow = await pool.query<{ lifecycle_status: string }>(
      'SELECT lifecycle_status FROM recovery_cases WHERE workspace_id = $1 AND id = $2',
      [seed.workspaceId, opened.caseId],
    );
    assert.ok(['RESOLVED', 'CLOSED'].includes(statusRow.rows[0]!.lifecycle_status));

    const forbiddenIntents = await pool.query<{ capability_ref: string; operation_namespace: string }>(
      `SELECT capability_ref, operation_namespace FROM action_intents WHERE workspace_id = $1 AND action_plan_id = $2`,
      [seed.workspaceId, plan.id],
    );
    for (const row of forbiddenIntents.rows) {
      assert.equal(/external:flight/i.test(row.capability_ref), false);
      assert.equal(/SELECT_OFFER/i.test(row.operation_namespace), false);
      assert.equal(/flight-purchase/i.test(row.operation_namespace), false);
    }
  });
});

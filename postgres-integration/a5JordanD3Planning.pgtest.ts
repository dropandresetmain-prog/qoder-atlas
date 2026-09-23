/**
 * Jordan D3 on the configured AiT world, planned through the same REPLAY
 * transport research seam normal boot uses. Classification stays in
 * a3JordanConnectionFoundation; this file exists so a search miss cannot
 * hide that proof.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { acceptProviderShapedDemoEvent } from '../src/app/target/applicationCommands.ts';
import { bootstrapProviderStayBaseline } from '../src/app/demo/providerStayBaseline.ts';
import { NuiteeAdapter } from '../src/providers/hotel/nuiteeAdapter.ts';
import { FileRecordingStore } from '../src/providers/recordingStore.ts';
import { runCaseEscalation } from '../src/app/target/caseEscalation.ts';
import { runCaseResolutionPass } from '../src/app/target/caseResolutionPass.ts';
import { approveRecoveryStrategy } from '../src/app/target/recoveryApproval.ts';
import { createRecoveryPlanningCoordinator } from '../src/app/target/recoveryPlanningCoordinator.ts';
import { composeOfferExecution, runExternalExecutionCycle, EXTERNAL_OFFER_SELECT_STATEMENTS } from '../src/app/target/externalOfferExecution.ts';
import { composeStayExecution, runExternalStayExecutionCycle, EXTERNAL_STAY_CAPABILITY_STATEMENTS } from '../src/app/target/externalStayExecution.ts';
import { provisionWorkspaceAuthority } from '../src/app/target/workspaceAuthority.ts';
import { loadRecoveryCaseFacts } from '../src/app/target/readmodels/pgFactAssembler.ts';
import { projectRecoveryCase } from '../src/app/target/readmodels/projectRecoveryCase.ts';
import { createBudget, createExternalConnection } from '../src/persistence/postgres/commands/arrangementCommands.ts';
import { composeTargetRecoveryResearch } from '../src/app/composeTargetRecoveryResearch.ts';
import { createPrincipal } from '../src/persistence/postgres/commands/peopleCommands.ts';
import { selectCredential } from '../src/persistence/postgres/commands/travelCommands.ts';
import { buildTargetTimezoneResolver, composeTargetTransportResearch } from '../src/app/targetTransportResearch.ts';
import { loadConfig } from '../src/config/config.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { currentAssessmentView, PgReassessmentWorker, type ReassessmentPipeline } from '../src/persistence/postgres/world/pgAssessments.ts';
import { captureWorld } from '../src/persistence/postgres/world/pgCurrentState.ts';
import { assessSubject } from '../src/resolution/evaluation/assess.ts';
import { createM6Registry } from '../src/resolution/evaluation/registry.ts';
import { projectEffectiveWorld } from '../src/resolution/world/effectiveItinerary.ts';
import {
  AIT_FIXTURE_NOW,
  buildAitFixtureDatabase,
  cloneAitFixtureDatabase,
  type AitCloneHandle,
  type AitFixtureHandle,
} from './aitFixtureClone.ts';
import { attachSeedSession, commitSeed, takeSeedEvidence } from './m2Seed.ts';

const ACTOR = 'principal:a5-jordan-d3-planning';
const SANDBOX_ENV_PATH = 'C:/Dev/qoder-atlas/.env.local';

function sandboxRecordEnv(): Record<string, string> {
  const text = readFileSync(SANDBOX_ENV_PATH, 'utf8');
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    env[trimmed.slice(0, eq).trim()] = value;
  }
  env.ADAPTER_MODE = 'RECORD';
  return env;
}
const TIMELINE_PATH = fileURLToPath(
  new URL('../data/ait-demo-input-pack/scenarios/s2-missed-connection/inputs/progressive-delay-timeline.json', import.meta.url),
);

interface DelayStage {
  id: string;
  at: string;
  eventId: string;
  arrTime: string;
}

interface DelayTimeline {
  stages: DelayStage[];
}

const timeline = JSON.parse(readFileSync(TIMELINE_PATH, 'utf8')) as DelayTimeline;

function stage(id: string): DelayStage {
  const found = timeline.stages.find((entry) => entry.id === id);
  assert.ok(found, `configured S2 timeline includes ${id}`);
  return found;
}

function summarizePlanning(row: {
  outcome: string;
  domains: unknown;
  evidence: unknown;
  material_candidates: unknown;
}): string {
  const domains = Array.isArray(row.domains)
    ? row.domains.map((entry) => {
      const decision = entry as { domainId?: string; disposition?: string; reasonCode?: string };
      return `${decision.domainId}:${decision.disposition}${decision.reasonCode ? `:${decision.reasonCode}` : ''}`;
    })
    : [];
  const evidenceRows = Array.isArray(row.evidence) ? row.evidence as Array<{ capability?: string; operation?: string; status?: string; errorCode?: string }> : [];
  const flightOk = evidenceRows.filter((record) => (record.capability === 'FLIGHT' || record.operation === 'flight.search') && record.status === 'SUCCEEDED').length;
  const evidence = [
    `flightSucceeded:${flightOk}`,
    ...evidenceRows
      .filter((record) => !((record.capability === 'FLIGHT' || record.operation === 'flight.search') && record.status === 'SUCCEEDED'))
      .slice(0, 12)
      .map((record) => `${record.capability ?? record.operation ?? 'evidence'}:${record.operation ?? ''}:${record.status ?? 'unknown'}${record.errorCode ? `:${record.errorCode}` : ''}`),
  ];
  const candidateCounts = new Map<string, number>();
  if (Array.isArray(row.material_candidates)) {
    for (const entry of row.material_candidates) {
      const candidate = entry as {
        domainId?: string;
        disposition?: string;
        viabilityDecisionCodes?: string[];
        validationReasonCodes?: string[];
        proposal?: { blockers?: Array<{ reasonCode?: string }> };
      };
      const blocker = candidate.proposal?.blockers?.map((item) => item.reasonCode).filter(Boolean).join('+') ?? '';
      const decision = candidate.viabilityDecisionCodes?.[0] ?? candidate.validationReasonCodes?.[0] ?? '';
      const key = `${candidate.domainId}:${candidate.disposition}:${decision}:${blocker}`;
      candidateCounts.set(key, (candidateCounts.get(key) ?? 0) + 1);
    }
  }
  const candidates = [...candidateCounts.entries()].map(([key, count]) => `${count}x ${key}`);
  return JSON.stringify({ outcome: row.outcome, domains, evidence, candidates, candidateCount: Array.isArray(row.material_candidates) ? row.material_candidates.length : 0 });
}

describe('A5 Jordan D3 planning (composed REPLAY transport research)', () => {
  let fixture: AitFixtureHandle | undefined;
  let clone: AitCloneHandle | undefined;

  after(async () => {
    await clone?.drop().catch(() => undefined);
    await fixture?.drop().catch(() => undefined);
  });

  test('D3 broken connection plans through composed REPLAY flight research', async () => {
    fixture = await buildAitFixtureDatabase({ runBaseline: true });
    clone = await cloneAitFixtureDatabase(fixture.databaseName);
    const { pool, workspaceId } = clone;
    const registry = createM6Registry();

    const jordanJourney = await pool.query<{ journey_id: string }>(
      `SELECT j.id AS journey_id
         FROM journeys j
         JOIN travellers t ON t.workspace_id = j.workspace_id AND t.id = j.traveller_id
         JOIN external_record_links l
           ON l.workspace_id = t.workspace_id
          AND l.canonical_subject_kind = 'TRAVELLER'
          AND l.canonical_subject_id = t.id
          AND l.superseded_at IS NULL
         JOIN external_records r ON r.workspace_id = l.workspace_id AND r.id = l.external_record_id
        WHERE j.workspace_id = $1
          AND r.record_type = 'SOURCE_TRAVELLER_DRAFT'
          AND r.external_id = 'ait-draft-09'`,
      [workspaceId],
    );
    assert.equal(jordanJourney.rowCount, 1);
    const journeyId = jordanJourney.rows[0]!.journey_id;

    const inboundService = await pool.query<{ service_id: string }>(
      `SELECT l.canonical_subject_id AS service_id
         FROM external_record_links l
         JOIN external_records r ON r.workspace_id = l.workspace_id AND r.id = l.external_record_id
        WHERE l.workspace_id = $1
          AND l.canonical_subject_kind = 'TRANSPORT_SERVICE'
          AND l.superseded_at IS NULL
          AND r.record_type = 'SOURCE_TRANSPORT_SERVICE'
          AND r.external_id LIKE 'ZG023@%'`,
      [workspaceId],
    );
    assert.equal(inboundService.rowCount, 1);
    const serviceId = inboundService.rows[0]!.service_id;

    const evidenceSeed = await attachSeedSession(pool, workspaceId, ACTOR, 3);
    const evidenceIds = [takeSeedEvidence(evidenceSeed), takeSeedEvidence(evidenceSeed), takeSeedEvidence(evidenceSeed)];
    await commitSeed(evidenceSeed);

    let currentStageAt = AIT_FIXTURE_NOW;
    const pipeline: ReassessmentPipeline = async (claim, assessmentId) => {
      const world = await captureWorld(pool, {
        workspaceId: claim.workspaceId,
        focus: [claim.subject],
        at: claim.kind === 'VIABILITY' ? currentStageAt : AIT_FIXTURE_NOW,
        informationTopics: registry.informationTopics,
      });
      return assessSubject({
        registry,
        world,
        effective: projectEffectiveWorld(world),
        subject: claim.subject,
        now: currentStageAt,
        assessmentId,
      }).result;
    };
    const commandCtx = {
      workspaceId,
      actorPrincipalId: ACTOR,
      uow: () => new PgUnitOfWork(pool, workspaceId),
      pool,
    };

    const applyStage = async (delay: DelayStage, evidenceId: string) => {
      currentStageAt = delay.at;
      const revision = await pool.query<{ revision: string }>(
        `SELECT revision::text AS revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2`,
        [workspaceId, serviceId],
      );
      const ingress = await acceptProviderShapedDemoEvent(commandCtx, {
        providerId: 's2-configured-provider-event',
        providerEventId: delay.eventId,
        receivedAt: delay.at,
        disclosedAsSimulatedDemoInput: true,
        payload: {
          subjectKind: 'TRANSPORT_SERVICE',
          subjectId: serviceId,
          expectedRevision: Number(revision.rows[0]!.revision),
          field: 'ESTIMATED',
          arrival: delay.arrTime,
          evidenceId,
        },
      });
      assert.equal(ingress.ok, true, JSON.stringify(ingress));
      const drained = await new PgReassessmentWorker(pool, { actorId: ACTOR })
        .drainAvailable(delay.at, pipeline, { workspaceId, maxItems: 100, maxMs: 60_000 });
      assert.equal(drained.stoppedReason, 'EMPTY', JSON.stringify(drained));
    };

    await applyStage(stage('delay_begins_connection_viable'), evidenceIds[0]!);
    const d2 = stage('delay_increases_connection_at_risk');
    await applyStage(d2, evidenceIds[1]!);
    const opened = await runCaseEscalation({ ...commandCtx, now: d2.at });
    assert.equal(opened.opened, 1, JSON.stringify(opened));
    const caseId = opened.outcomes.find((outcome) => outcome.caseId)?.caseId;
    assert.ok(caseId);

    const d3 = stage('zg053_impossible');
    await applyStage(d3, evidenceIds[2]!);
    const attached = await runCaseEscalation({ ...commandCtx, now: d3.at });
    assert.equal(attached.attached, 1, JSON.stringify(attached));
    const view = await currentAssessmentView(pool, workspaceId, { kind: 'JOURNEY', id: journeyId }, 'VIABILITY', d3.at);
    assert.equal(view.assessment?.overallVerdict, 'FAIL');

    const research = composeTargetTransportResearch(
      loadConfig({ ADAPTER_MODE: 'REPLAY', PG_TARGET_WORKSPACE_ID: workspaceId }),
      process.cwd(),
      buildTargetTimezoneResolver(pool, workspaceId),
    );
    assert.ok(research, 'REPLAY flight research composes without live credentials');
    const sourceConnection = await pool.query<{ id: string; provider_kind: string }>(
      `SELECT c.id, c.provider_kind
         FROM external_connections c
         JOIN external_records r ON r.workspace_id = c.workspace_id AND r.connection_id = c.id
        WHERE c.workspace_id = $1
          AND r.record_type = 'SOURCE_PLACE'
          AND r.external_id = 'place-nrt'`,
      [workspaceId],
    );
    assert.equal(sourceConnection.rowCount, 1);
    // Fixture build already provisioned Jordan's synthetic sandbox passport
    // (prepareAitBaselineReadiness). Re-provisioning with a different document
    // key hits KEY_ID_MISMATCH on the same content hash — assert reuse instead.
    const existingPassport = await pool.query<{ credential_id: string; version_id: string }>(
      `SELECT tc.id AS credential_id, tc.current_version_id AS version_id
         FROM travel_credentials tc
         JOIN travellers t ON t.workspace_id = tc.workspace_id AND t.id = tc.traveller_id
         JOIN external_record_links l
           ON l.workspace_id = t.workspace_id AND l.canonical_subject_kind = 'TRAVELLER'
          AND l.canonical_subject_id = t.id AND l.superseded_at IS NULL
         JOIN external_records r ON r.workspace_id = l.workspace_id AND r.id = l.external_record_id
        WHERE tc.workspace_id = $1 AND tc.kind = 'PASSPORT' AND tc.issuer_country = 'SG'
          AND r.record_type = 'SOURCE_TRAVELLER_DRAFT' AND r.external_id = 'ait-draft-09'`,
      [workspaceId],
    );
    assert.equal(existingPassport.rowCount, 1, 'fixture sandbox passport for Jordan must already exist');
    assert.equal(existingPassport.rows[0]!.credential_id, '6f1c0a2e-7b44-4c1a-9d3e-2a8b5c6d7e01');
    const passportDrain = await new PgReassessmentWorker(pool, { actorId: ACTOR })
      .drainAvailable(d3.at, pipeline, { workspaceId, maxItems: 100, maxMs: 60_000 });
    assert.equal(passportDrain.stoppedReason, 'EMPTY', JSON.stringify(passportDrain));
    const passport = await pool.query<{ credential_id: string; version_id: string }>(
      `SELECT tc.id AS credential_id, tc.current_version_id AS version_id
         FROM travel_credentials tc
         JOIN travellers t ON t.workspace_id = tc.workspace_id AND t.id = tc.traveller_id
         JOIN external_record_links l
           ON l.workspace_id = t.workspace_id
          AND l.canonical_subject_kind = 'TRAVELLER'
          AND l.canonical_subject_id = t.id
          AND l.superseded_at IS NULL
         JOIN external_records r ON r.workspace_id = l.workspace_id AND r.id = l.external_record_id
        WHERE tc.workspace_id = $1
          AND tc.kind = 'PASSPORT'
          AND tc.issuer_country = 'SG'
          AND r.record_type = 'SOURCE_TRAVELLER_DRAFT'
          AND r.external_id = 'ait-draft-09'`,
      [workspaceId],
    );
    assert.equal(passport.rowCount, 1, 'the configured traveller has one SG passport');
    const reviewerId = randomUUID();
    const reviewer = await createPrincipal(new PgUnitOfWork(pool, workspaceId), {
      workspaceId,
      actorPrincipalId: ACTOR,
      idempotencyKey: `a5-jordan-reviewer:${reviewerId}`,
      principalId: reviewerId,
      actorType: 'HUMAN',
      authIssuer: 'urn:northstar:test',
      authSubject: reviewerId,
    });
    assert.equal(reviewer.ok, true, JSON.stringify(reviewer));
    if (!reviewer.ok) return;
    const stay = await pool.query<{ reservation_id: string; line_id: string }>(
      `SELECT rsv.id AS reservation_id, line.id AS line_id
         FROM external_records er
         JOIN external_record_links link
           ON link.workspace_id = er.workspace_id
          AND link.external_record_id = er.id
          AND link.canonical_subject_kind = 'RESERVATION'
          AND link.superseded_at IS NULL
         JOIN reservations rsv
           ON rsv.workspace_id = link.workspace_id AND rsv.id = link.canonical_subject_id
         JOIN reservation_lines line
           ON line.workspace_id = rsv.workspace_id AND line.reservation_id = rsv.id AND line.product_type = 'STAY'
        WHERE er.workspace_id = $1
          AND er.record_type = 'SOURCE_BOOKING_REFERENCE'
          AND er.external_id = 'ait-draft-09-destination-stay'`,
      [workspaceId],
    );
    assert.equal(stay.rowCount, 1, 'the lyf stay is one stay reservation line bound by source reference');

    // The dataset stay carries only a source-booking reference; the provider
    // stay element is never configured. REPLAY the same explicit bootstrap
    // normal boot uses to attach the fresh sandbox booking (DpnZRH43H) before
    // recovery research can resolve a stay element to replace it.
    const baselineHotel = new NuiteeAdapter({
      mode: 'REPLAY',
      store: new FileRecordingStore({ readDirs: [resolve('recordings'), resolve('fixtures/recordings')] }),
    });
    const baseline = await bootstrapProviderStayBaseline({
      pool,
      uow: () => new PgUnitOfWork(pool, workspaceId),
      workspaceId,
      actorPrincipalId: ACTOR,
      hotel: baselineHotel,
      mode: 'REPLAY',
      binding: {
        sourceBookingReference: 'ait-draft-09-destination-stay',
        propertyExternalRef: { system: 'nuitee-hotel-id', value: 'lp6d67d' },
        guestNationality: 'SG',
        guests: { adults: 1, rooms: 1 },
      },
      observedAt: d3.at,
    });
    assert.equal(baseline.ok, true, JSON.stringify(baseline));
    if (!baseline.ok) return;
    assert.ok(baseline.status === 'ATTACHED' || baseline.status === 'ALREADY_ATTACHED', baseline.status);
    // Domain logic never depends on the exact provider booking id; only that
    // one was attached and reads back with confirmed terms.
    assert.ok(baseline.bookingId.length > 0);
    const jurisdiction = await pool.query<{ id: string }>(
      `SELECT l.canonical_subject_id AS id
         FROM external_records r
         JOIN external_record_links l
           ON l.workspace_id = r.workspace_id AND l.external_record_id = r.id AND l.superseded_at IS NULL
        WHERE r.workspace_id = $1 AND r.record_type = 'SOURCE_JURISDICTION' AND r.external_id = 'jur-sg'
          AND l.canonical_subject_kind = 'JURISDICTION'`,
      [workspaceId],
    );
    assert.equal(jurisdiction.rowCount, 1);
    // Fixture + prepareBaselineExistingVisits already declared the Singapore
    // intended visit, bound the SG passport, and published reviewed entry
    // coverage. Re-declaring the same SOURCE_INTENDED_VISIT external id would
    // conflict; reuse the fixture visit identity.
    const visit = await pool.query<{ id: string }>(
      `SELECT id FROM intended_visits
        WHERE workspace_id = $1 AND journey_id = $2 AND transit_intent = false`,
      [workspaceId, journeyId],
    );
    assert.equal(visit.rowCount, 1, 'the Singapore stay is one declared intended visit');
    const journeyHead = await pool.query<{ revision: string }>(
      `SELECT revision::text AS revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2`,
      [workspaceId, journeyId],
    );
    const selected = await selectCredential(new PgUnitOfWork(pool, workspaceId), {
      workspaceId,
      actorPrincipalId: ACTOR,
      idempotencyKey: `a5-jordan-passport:${passport.rows[0]!.credential_id}`,
      journeyId,
      expectedRevision: Number(journeyHead.rows[0]!.revision),
      credentialId: passport.rows[0]!.credential_id,
      credentialVersionId: passport.rows[0]!.version_id,
      scopeIntendedVisitIds: [visit.rows[0]!.id],
    });
    assert.equal(selected.ok, true, JSON.stringify(selected));
    const selectionDrain = await new PgReassessmentWorker(pool, { actorId: ACTOR })
      .drainAvailable(d3.at, pipeline, { workspaceId, maxItems: 100, maxMs: 60_000 });
    assert.equal(selectionDrain.stoppedReason, 'EMPTY', JSON.stringify(selectionDrain));
    const afterSelection = await currentAssessmentView(pool, workspaceId, { kind: 'JOURNEY', id: journeyId }, 'VIABILITY', d3.at);
    assert.equal(afterSelection.assessment?.overallVerdict, 'FAIL', JSON.stringify(afterSelection.staleness));
    const configurationDirectory = await mkdtemp(join(tmpdir(), 'northstar-jordan-research-'));
    const configurationFile = join(configurationDirectory, 'research.json');
    await writeFile(configurationFile, JSON.stringify({
      schemaVersion: 1,
      hotelPoliciesFile: resolve('data/ait-demo-input-pack/global/hotel-property-policies.json'),
      entryPoliciesFile: resolve('data/ait-demo-input-pack/global/reviewed-entry-policies.json'),
      sourceConnectionProviderKind: sourceConnection.rows[0]!.provider_kind,
      overnightTargets: [{
        arrivalAirportSourceRef: 'SOURCE_PLACE:place-nrt',
        hotelPolicyId: 'hotel-policy-narita-gateway-2026',
        jurisdictionSourceRef: 'SOURCE_JURISDICTION:jur-jp',
        countryCode: 'JP',
        entryPolicyId: 'jp-short-visit-sg-passport-2026-09',
      }],
      existingVisitTargets: [{
        visitSourceRef: 'SOURCE_INTENDED_VISIT:ait-draft-09-singapore-destination',
        visitId: visit.rows[0]!.id,
        jurisdictionSourceRef: 'SOURCE_JURISDICTION:jur-sg',
        entryPolicyId: 'sg-issued-passport-eligibility-2026-09',
        countryCode: 'SG',
      }],
      passportSelections: [{
        travellerSourceRef: 'SOURCE_TRAVELLER_DRAFT:ait-draft-09',
        credentialId: passport.rows[0]!.credential_id,
        credentialVersionId: passport.rows[0]!.version_id,
        guestNationality: 'SG',
      }],
      stayReplacementBinding: {
        // Reservation/line/provider stay element are never configured: they
        // resolve from the source-booking reference and whatever provider
        // booking the bootstrap above attached (see completeStayBinding).
        sourceBookingReference: 'ait-draft-09-destination-stay',
        propertyExternalRef: { system: 'nuitee-hotel-id', value: 'lp6d67d' },
        passport: {
          credentialId: passport.rows[0]!.credential_id,
          credentialVersionId: passport.rows[0]!.version_id,
          guestNationality: 'SG',
        },
        guests: { adults: 1, rooms: 1 },
        visitId: visit.rows[0]!.id,
        provenance: {
          mode: 'REPLAY',
          observedAt: '2026-09-21T01:40:00.000Z',
          sourceRefs: ['ait-draft-09-destination-stay'],
        },
      },
    }));
    const recoveryResearch = await composeTargetRecoveryResearch({
      config: loadConfig({ ADAPTER_MODE: 'REPLAY', PG_TARGET_WORKSPACE_ID: workspaceId }),
      cwd: process.cwd(),
      configurationFile,
      pool,
      workspaceId,
      actorPrincipalId: ACTOR,
      uow: () => new PgUnitOfWork(pool, workspaceId),
      reviewerPrincipalId: reviewerId,
    });
    assert.ok(recoveryResearch, 'reviewed hotel and entry research composes from the recorded publisher pages');
    const planner = createRecoveryPlanningCoordinator({
      pool,
      workspaceId,
      actorPrincipalId: ACTOR,
      uow: () => new PgUnitOfWork(pool, workspaceId),
      now: d3.at,
      availableCapabilities: ['FLIGHT', 'HOTEL', 'RESEARCH'],
      transportPlanning: research,
      preparePlanningContext: recoveryResearch.prepare,
    });
    let planned = await planner.planCaseDetailed({ recoveryCaseId: caseId, reason: 'REASSESSMENT', now: d3.at });
    assert.equal(planned.ok, true, JSON.stringify(planned));
    if (!planned.ok) return;
    if (planned.result.outcome === 'STALE_RETRY_REQUIRED') {
      const drained = await new PgReassessmentWorker(pool, { actorId: ACTOR })
        .drainAvailable(d3.at, pipeline, { workspaceId, maxItems: 100, maxMs: 60_000 });
      assert.equal(drained.stoppedReason, 'EMPTY', JSON.stringify(drained));
      planned = await planner.planCaseDetailed({ recoveryCaseId: caseId, reason: 'REASSESSMENT', now: d3.at });
      assert.equal(planned.ok, true, JSON.stringify(planned));
      if (!planned.ok) return;
    }

    const stored = await pool.query<{
      outcome: string;
      domains: unknown;
      evidence: unknown;
      material_candidates: unknown;
    }>(
      `SELECT outcome, domains, evidence, material_candidates
         FROM recovery_planning_attempts
        WHERE workspace_id = $1 AND recovery_case_id = $2
        ORDER BY completed_at`,
      [workspaceId, caseId],
    );
    assert.ok((stored.rowCount ?? 0) >= 1, JSON.stringify(planned.ok ? planned.result : planned));
    const summary = stored.rows.map((row) => summarizePlanning(row)).join('\n');
    assert.equal(planned.result.outcome, 'AWAITING_AUTHORITY', summary);

    const recommended = await pool.query<{
      strategy_id: string;
      scenario_change: {
        effects?: Array<{
          effectKind?: string;
          cancellationPenalty?: { amount?: string; currency?: string };
          freeCancellationUntil?: string;
          scheduledCancellationPenalty?: { amount?: string; currency?: string };
          recoverableStayCredit?: { amount?: string; currency?: string };
        }>;
      };
    }>(
      `SELECT s.id AS strategy_id, s.scenario_change
         FROM recovery_planning_attempts a
         JOIN recovery_strategies s
           ON s.workspace_id = a.workspace_id
          AND s.id = (a.recommendation->>'recommendedStrategyRef')::uuid
        WHERE a.workspace_id = $1 AND a.recovery_case_id = $2 AND a.outcome = 'AWAITING_AUTHORITY'`,
      [workspaceId, caseId],
    );
    assert.equal(recommended.rowCount, 1, summary);
    const replayEffects = recommended.rows[0]!.scenario_change.effects ?? [];
    const replayKinds = replayEffects.map((effect) => effect.effectKind);
    assert.ok(replayKinds.includes('SELECT_OFFER'), JSON.stringify(replayKinds));
    assert.ok(replayKinds.includes('ADD_JOURNEY_STAY'), JSON.stringify(replayKinds));
    const replayCancel = replayEffects.find((effect) => effect.effectKind === 'CANCEL_STAY');
    assert.ok(replayCancel, JSON.stringify(replayKinds));
    // The fresh booking's free-cancel deadline (2026-09-26T10:00:00Z) is
    // already behind D3 (29 Sep): the current fee is the full confirmed
    // total, nothing is scheduled for later, and nothing is recoverable.
    // See recoveryCostComparison.ts — this fee must not also inflate the
    // strategy's net cost once recoverableStayCredit nets it to zero.
    assert.equal(replayCancel.cancellationPenalty?.currency, 'USD');
    assert.equal(Number(replayCancel.cancellationPenalty?.amount), 955.69);
    assert.equal(replayCancel.freeCancellationUntil, undefined);
    assert.equal(replayCancel.scheduledCancellationPenalty, undefined);
    assert.equal(Number(replayCancel.recoverableStayCredit?.amount), 0);
    assert.equal(replayCancel.recoverableStayCredit?.currency, 'USD');
    // Sandbox book/cancel is destructive and was already proven with this flag set.
    // The default gate stops at the replayed recommendation so a second run does not
    // cancel the same provider booking again.
    if (process.env.NORTHSTAR_JORDAN_SANDBOX_EXECUTION !== '1') return;

    const refreshSeed = await attachSeedSession(pool, workspaceId, ACTOR, 1);
    const refreshEvidence = takeSeedEvidence(refreshSeed);
    await commitSeed(refreshSeed);
    await applyStage({ ...d3, eventId: `${d3.eventId}:record-basis` }, refreshEvidence);

    const recordConfig = loadConfig(sandboxRecordEnv());
    const recordTransport = composeTargetTransportResearch(recordConfig, process.cwd(), buildTargetTimezoneResolver(pool, workspaceId));
    assert.ok(recordTransport, 'RECORD flight research composes with sandbox credentials');
    const recordRecovery = await composeTargetRecoveryResearch({
      config: recordConfig,
      cwd: process.cwd(),
      configurationFile,
      pool,
      workspaceId,
      actorPrincipalId: ACTOR,
      uow: () => new PgUnitOfWork(pool, workspaceId),
      reviewerPrincipalId: reviewerId,
    });
    assert.ok(recordRecovery, 'RECORD hotel research composes with sandbox credentials');
    const organisation = await pool.query<{ id: string }>(
      `SELECT t.business_context_organisation_id AS id
         FROM journeys j
         JOIN trips t ON t.workspace_id = j.workspace_id AND t.id = j.trip_id
        WHERE j.workspace_id = $1 AND j.id = $2`,
      [workspaceId, journeyId],
    );
    assert.equal(organisation.rowCount, 1);
    const budget = await createBudget(new PgUnitOfWork(pool, workspaceId), {
      workspaceId,
      actorPrincipalId: ACTOR,
      idempotencyKey: `a5-jordan-budget:${workspaceId}`,
      budget: {
        id: randomUUID(),
        organisationId: organisation.rows[0]!.id,
        purpose: 'recovery execution',
        amount: { amount: '100000.00', currency: 'USD' },
      },
    });
    assert.equal(budget.ok, true, JSON.stringify(budget));
    const providerConnection = await createExternalConnection(new PgUnitOfWork(pool, workspaceId), {
      workspaceId,
      actorPrincipalId: ACTOR,
      idempotencyKey: `a5-jordan-nuitee:${workspaceId}`,
      connection: {
        id: randomUUID(),
        organisationId: organisation.rows[0]!.id,
        providerKind: 'nuitee',
      },
    });
    assert.equal(providerConnection.ok, true, JSON.stringify(providerConnection));
    const authority = await provisionWorkspaceAuthority({
      pool,
      uow: () => new PgUnitOfWork(pool, workspaceId),
      workspaceId,
      actorPrincipalId: ACTOR,
      now: d3.at,
    });
    const funded = await new PgReassessmentWorker(pool, { actorId: ACTOR })
      .drainAvailable(d3.at, pipeline, { workspaceId, maxItems: 100, maxMs: 60_000 });
    assert.equal(funded.stoppedReason, 'EMPTY', JSON.stringify(funded));
    const recordPlanner = createRecoveryPlanningCoordinator({
      pool,
      workspaceId,
      actorPrincipalId: ACTOR,
      uow: () => new PgUnitOfWork(pool, workspaceId),
      now: d3.at,
      availableCapabilities: ['FLIGHT', 'HOTEL', 'RESEARCH'],
      transportPlanning: recordTransport,
      preparePlanningContext: recordRecovery.prepare,
    });
    let recorded = await recordPlanner.planCaseDetailed({ recoveryCaseId: caseId, reason: 'REASSESSMENT', now: d3.at });
    for (let attempt = 0; attempt < 3 && recorded.ok && recorded.result.outcome === 'STALE_RETRY_REQUIRED'; attempt += 1) {
      const drained = await new PgReassessmentWorker(pool, { actorId: ACTOR })
        .drainAvailable(d3.at, pipeline, { workspaceId, maxItems: 100, maxMs: 60_000 });
      assert.equal(drained.stoppedReason, 'EMPTY', JSON.stringify(drained));
      recorded = await recordPlanner.planCaseDetailed({ recoveryCaseId: caseId, reason: 'REASSESSMENT', now: d3.at });
    }
    assert.equal(recorded.ok, true, JSON.stringify(recorded));
    if (!recorded.ok) return;
    assert.equal(recorded.result.outcome, 'AWAITING_AUTHORITY', JSON.stringify(recorded.result));

    const executable = await pool.query<{ strategy_id: string }>(
      `SELECT s.id AS strategy_id
         FROM recovery_planning_attempts a
         JOIN recovery_strategies s
           ON s.workspace_id = a.workspace_id
          AND s.id = (a.recommendation->>'recommendedStrategyRef')::uuid
         JOIN offer_execution_bindings b
           ON b.workspace_id = s.workspace_id
          AND b.recovery_strategy_id = s.id
          AND b.research_mode IN ('RECORD', 'LIVE')
        WHERE a.workspace_id = $1 AND a.recovery_case_id = $2 AND a.outcome = 'AWAITING_AUTHORITY'
        ORDER BY a.completed_at DESC
        LIMIT 1`,
      [workspaceId, caseId],
    );
    assert.equal(executable.rowCount, 1, 'the executable recommendation is priced from a fresh provider quote');
    const strategyId = executable.rows[0]!.strategy_id;
    const approved = await approveRecoveryStrategy({
      pool,
      workspaceId,
      actorPrincipalId: ACTOR,
      uow: () => new PgUnitOfWork(pool, workspaceId),
      now: d3.at,
      executorPrincipalId: authority.principals.executor,
      externalCapabilities: [...EXTERNAL_OFFER_SELECT_STATEMENTS, ...EXTERNAL_STAY_CAPABILITY_STATEMENTS],
    }, {
      caseId,
      strategyId,
      approverPrincipalId: authority.principals.operator,
    });
    assert.equal(approved.ok, true, JSON.stringify(approved));
    if (!approved.ok) return;

    const offerExecution = composeOfferExecution(recordConfig, process.cwd());
    const stayExecution = composeStayExecution(recordConfig, process.cwd());
    assert.ok(offerExecution, 'sandbox flight execution composes');
    assert.ok(stayExecution, 'sandbox stay execution composes');
    const executionBase = {
      pool,
      workspaceId,
      actorPrincipalId: ACTOR,
      uow: () => new PgUnitOfWork(pool, workspaceId),
      executorPrincipalId: authority.principals.executor,
      now: d3.at,
    };
    let executed = 0;
    let lastFlights: Awaited<ReturnType<typeof runExternalExecutionCycle>> | undefined;
    let lastStays: Awaited<ReturnType<typeof runExternalStayExecutionCycle>> | undefined;
    for (let pass = 0; pass < 8 && executed < approved.report.intents.length; pass += 1) {
      lastFlights = await runExternalExecutionCycle({ ...executionBase, external: offerExecution });
      lastStays = await runExternalStayExecutionCycle({ ...executionBase, external: stayExecution });
      assert.equal(lastFlights.report.failed, 0, JSON.stringify(lastFlights.report));
      assert.equal(lastStays.report.failed, 0, JSON.stringify(lastStays.report));
      executed += lastFlights.report.executed + lastStays.report.executed;
      const drained = await new PgReassessmentWorker(pool, { actorId: ACTOR })
        .drainAvailable(d3.at, pipeline, { workspaceId, maxItems: 100, maxMs: 60_000 });
      assert.equal(drained.stoppedReason, 'EMPTY', JSON.stringify(drained));
    }
    assert.equal(executed, approved.report.intents.length, JSON.stringify({
      executed,
      expected: approved.report.intents.length,
      flights: lastFlights?.report,
      stays: lastStays?.report,
    }));

    const afterView = await currentAssessmentView(pool, workspaceId, { kind: 'JOURNEY', id: journeyId }, 'VIABILITY', d3.at);
    assert.equal(afterView.status, 'CURRENT', JSON.stringify(afterView.staleness));
    assert.equal(afterView.assessment?.overallVerdict, 'PASS');
    const resolution = await runCaseResolutionPass({
      pool,
      workspaceId,
      actorPrincipalId: ACTOR,
      uow: () => new PgUnitOfWork(pool, workspaceId),
      now: d3.at,
    });
    assert.ok(resolution.outcomes.some((outcome) => outcome.caseId === caseId && outcome.result === 'RESOLVED'), JSON.stringify(resolution.outcomes));
    const finalView = projectRecoveryCase((await loadRecoveryCaseFacts(pool, workspaceId, caseId, d3.at))!);
    assert.equal(finalView.status, 'RESOLVED');
    assert.equal(finalView.tripViability.verdict, 'PASS');
  });
});

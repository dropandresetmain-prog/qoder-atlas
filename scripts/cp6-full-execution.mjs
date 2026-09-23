/**
 * CP6 Phase 4/5 independent re-derivation (owned by this session, not the prior probe).
 * Mirrors postgres-integration/a5JordanD3Planning.pgtest.ts through approval,
 * but STOPS before runExternalExecutionCycle / runExternalStayExecutionCycle
 * (the actual provider dispatchers). No book/pay/cancel/ticket calls are made.
 *
 * Fix over the prior probe: RECORDINGS_DIR is forced to the CP6 staging corpus
 * (recordings/jordan-corpus-2026-09-23-cp6-staging), never the frozen canonical
 * corpus, so any RECORD-mode research writes land only in staging. This is
 * belt-and-suspenders with the generic FrozenCorpusWriteError guard added in
 * src/providers/recordingStoreFactory.ts — that guard alone would already stop
 * this script from writing into the canonical path if this override were absent.
 */
process.env.PGTEST_HOST ??= '127.0.0.1';
process.env.PGTEST_PORT ??= '55432';
process.env.PGTEST_DB ??= 'northstar_test';
process.env.PGTEST_USER ??= 'northstar_test';
process.env.PGTEST_PASSWORD ??= 'northstar_test';

import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
process.chdir(ROOT);

/** Stable for this disposable CP6 run only — Atlas wire identity, not canonical traveller. */
const CP6_SANDBOX_PASSENGER_ALIAS = {
  givenName: 'CpSix',
  familyName: 'Aliasbffb',
};

const {
  buildAitFixtureDatabase,
  cloneAitFixtureDatabase,
  AIT_FIXTURE_NOW,
} = await import('../postgres-integration/aitFixtureClone.ts');
const { acceptProviderShapedDemoEvent } = await import('../src/app/target/applicationCommands.ts');
const { runCaseEscalation } = await import('../src/app/target/caseEscalation.ts');
const { bootstrapProviderStayBaseline } = await import('../src/app/demo/providerStayBaseline.ts');
const { NuiteeAdapter } = await import('../src/providers/hotel/nuiteeAdapter.ts');
const { FileRecordingStore } = await import('../src/providers/recordingStore.ts');
const { composeTargetTransportResearch, buildTargetTimezoneResolver } = await import('../src/app/targetTransportResearch.ts');
const { composeTargetRecoveryResearch } = await import('../src/app/composeTargetRecoveryResearch.ts');
const { createRecoveryPlanningCoordinator } = await import('../src/app/target/recoveryPlanningCoordinator.ts');
const { approveRecoveryStrategy } = await import('../src/app/target/recoveryApproval.ts');
const { EXTERNAL_OFFER_SELECT_STATEMENTS, composeOfferExecution, runExternalExecutionCycle } = await import('../src/app/target/externalOfferExecution.ts');
const { EXTERNAL_STAY_CAPABILITY_STATEMENTS, composeStayExecution, runExternalStayExecutionCycle } = await import('../src/app/target/externalStayExecution.ts');
const { runCaseResolutionPass } = await import('../src/app/target/caseResolutionPass.ts');
const { loadRecoveryCaseFacts } = await import('../src/app/target/readmodels/pgFactAssembler.ts');
const { projectRecoveryCase } = await import('../src/app/target/readmodels/projectRecoveryCase.ts');
const { provisionWorkspaceAuthority, workspacePrincipalId } = await import('../src/app/target/workspaceAuthority.ts');
const { runDemoReadinessPreflight } = await import('../src/app/target/demoReadinessPreflight.ts');
const { createPrincipal } = await import('../src/persistence/postgres/commands/peopleCommands.ts');
const { selectCredential } = await import('../src/persistence/postgres/commands/travelCommands.ts');
const { createBudget, createExternalConnection } = await import('../src/persistence/postgres/commands/arrangementCommands.ts');
const { loadConfig } = await import('../src/config/config.ts');
const { PgUnitOfWork } = await import('../src/persistence/postgres/pgUnitOfWork.ts');
const { currentAssessmentView, PgReassessmentWorker } = await import('../src/persistence/postgres/world/pgAssessments.ts');
const { captureWorld } = await import('../src/persistence/postgres/world/pgCurrentState.ts');
const { assessSubject } = await import('../src/resolution/evaluation/assess.ts');
const { createM6Registry } = await import('../src/resolution/evaluation/registry.ts');
const { projectEffectiveWorld } = await import('../src/resolution/world/effectiveItinerary.ts');
const { loadRequiredAuthorityScope, loadGrantsForPrincipal } = await import('../src/persistence/postgres/execution/storedExecutionGate.ts');
const { scopeCoversRequired, AUTHORIZE_ACTION_KIND, DISPATCH_ACTION_KIND } = await import('../src/resolution/authority/authorize.ts');
const { attachSeedSession, commitSeed, takeSeedEvidence } = await import('../postgres-integration/m2Seed.ts');

const ACTOR = 'principal:cp6-authority-verify';
const SANDBOX_ENV_PATH = join(ROOT, '.env.local');
function sandboxRecordEnv() {
  const text = readFileSync(SANDBOX_ENV_PATH, 'utf8');
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    env[trimmed.slice(0, eq).trim()] = value;
  }
  env.ADAPTER_MODE = 'RECORD';
  env.RECORDINGS_DIR = 'recordings/jordan-corpus-2026-09-23-cp6-staging';
  env.ATLAS_SANDBOX_PASSENGER_ALIAS_GIVEN_NAME = CP6_SANDBOX_PASSENGER_ALIAS.givenName;
  env.ATLAS_SANDBOX_PASSENGER_ALIAS_FAMILY_NAME = CP6_SANDBOX_PASSENGER_ALIAS.familyName;
  return env;
}
const TIMELINE_PATH = join(ROOT, 'data/ait-demo-input-pack/scenarios/s2-missed-connection/inputs/progressive-delay-timeline.json');
const timeline = JSON.parse(readFileSync(TIMELINE_PATH, 'utf8'));
const stage = (id) => {
  const found = timeline.stages.find((entry) => entry.id === id);
  if (!found) throw new Error(`missing stage ${id}`);
  return found;
};

const report = {
  verdict: undefined,
  sandboxPassengerAlias: {
    ...CP6_SANDBOX_PASSENGER_ALIAS,
    provenance: 'SANDBOX_TEST_ALIAS',
    note: 'Atlas wire only; canonical Jordan Hale unchanged',
  },
};

console.log('=== STEP 1: fresh AiT workspace via normal provisioning path ===');
const fixture = await buildAitFixtureDatabase({ runBaseline: true });
const clone = await cloneAitFixtureDatabase(fixture.databaseName);
const { pool, workspaceId } = clone;
report.workspaceId = workspaceId;
console.log('workspace', workspaceId, 'fixtureDb', fixture.databaseName, 'cloneDb', clone.databaseName);

try {
  const registry = createM6Registry();

  // Explicit re-provision (idempotent) to capture a fresh authority report.
  const authorityReport = await provisionWorkspaceAuthority({
    pool,
    uow: () => new PgUnitOfWork(pool, workspaceId),
    workspaceId,
    actorPrincipalId: ACTOR,
    now: AIT_FIXTURE_NOW,
  });
  report.workspaceAuthority = authorityReport;
  console.log('workspaceAuthority', JSON.stringify(authorityReport, null, 2));
  if (authorityReport.uncoveredSubjectCount > 0) {
    console.log('!!! uncoveredSubjectCount > 0 — investigating immediately');
  }

  // --- STEP 2: demo readiness preflight ---
  const preflight = await runDemoReadinessPreflight({ pool, workspaceId, now: AIT_FIXTURE_NOW });
  report.preflight = preflight.checks.filter((c) => c.id === 'authority_authorize' || c.id === 'authority_dispatch');
  console.log('=== STEP 2: demo readiness preflight (authority checks) ===');
  console.log(JSON.stringify(report.preflight, null, 2));

  // --- STEP 3: drive Jordan to D3 (REPLAY), no provider mutation ---
  console.log('=== STEP 3: drive Jordan D3 planning ===');
  const jordanJourney = await pool.query(
    `SELECT j.id AS journey_id
       FROM journeys j
       JOIN travellers t ON t.workspace_id = j.workspace_id AND t.id = j.traveller_id
       JOIN external_record_links l
         ON l.workspace_id = t.workspace_id AND l.canonical_subject_kind = 'TRAVELLER'
        AND l.canonical_subject_id = t.id AND l.superseded_at IS NULL
       JOIN external_records r ON r.workspace_id = l.workspace_id AND r.id = l.external_record_id
      WHERE j.workspace_id = $1 AND r.record_type = 'SOURCE_TRAVELLER_DRAFT' AND r.external_id = 'ait-draft-09'`,
    [workspaceId],
  );
  const journeyId = jordanJourney.rows[0].journey_id;
  report.journeyId = journeyId;

  const inboundService = await pool.query(
    `SELECT l.canonical_subject_id AS service_id
       FROM external_record_links l
       JOIN external_records r ON r.workspace_id = l.workspace_id AND r.id = l.external_record_id
      WHERE l.workspace_id = $1 AND l.canonical_subject_kind = 'TRANSPORT_SERVICE'
        AND l.superseded_at IS NULL AND r.record_type = 'SOURCE_TRANSPORT_SERVICE'
        AND r.external_id LIKE 'ZG023@%'`,
    [workspaceId],
  );
  const serviceId = inboundService.rows[0].service_id;

  const evidenceSeed = await attachSeedSession(pool, workspaceId, ACTOR, 4);
  const evidenceIds = [takeSeedEvidence(evidenceSeed), takeSeedEvidence(evidenceSeed), takeSeedEvidence(evidenceSeed), takeSeedEvidence(evidenceSeed)];
  await commitSeed(evidenceSeed);

  let currentStageAt = AIT_FIXTURE_NOW;
  const pipeline = async (claim, assessmentId) => {
    const world = await captureWorld(pool, {
      workspaceId: claim.workspaceId,
      focus: [claim.subject],
      at: claim.kind === 'VIABILITY' ? currentStageAt : AIT_FIXTURE_NOW,
      informationTopics: registry.informationTopics,
    });
    return assessSubject({
      registry, world, effective: projectEffectiveWorld(world),
      subject: claim.subject, now: currentStageAt, assessmentId,
    }).result;
  };
  const commandCtx = { workspaceId, actorPrincipalId: ACTOR, uow: () => new PgUnitOfWork(pool, workspaceId), pool };

  const applyStage = async (delay, evidenceId) => {
    currentStageAt = delay.at;
    const revision = await pool.query(
      `SELECT revision::text AS revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2`,
      [workspaceId, serviceId],
    );
    const ingress = await acceptProviderShapedDemoEvent(commandCtx, {
      providerId: 's2-configured-provider-event',
      providerEventId: delay.eventId,
      receivedAt: delay.at,
      disclosedAsSimulatedDemoInput: true,
      payload: {
        subjectKind: 'TRANSPORT_SERVICE', subjectId: serviceId,
        expectedRevision: Number(revision.rows[0].revision),
        field: 'ESTIMATED', arrival: delay.arrTime, evidenceId,
      },
    });
    if (!ingress.ok) throw new Error(`accept failed: ${JSON.stringify(ingress)}`);
    const drained = await new PgReassessmentWorker(pool, { actorId: ACTOR })
      .drainAvailable(delay.at, pipeline, { workspaceId, maxItems: 100, maxMs: 60_000 });
    if (drained.stoppedReason !== 'EMPTY') throw new Error(`drain: ${JSON.stringify(drained)}`);
  };

  await applyStage(stage('delay_begins_connection_viable'), evidenceIds[0]);
  const d2 = stage('delay_increases_connection_at_risk');
  await applyStage(d2, evidenceIds[1]);
  const opened = await runCaseEscalation({ ...commandCtx, now: d2.at });
  const caseId = opened.outcomes.find((outcome) => outcome.caseId)?.caseId;
  if (!caseId) throw new Error(`case did not open: ${JSON.stringify(opened)}`);

  const d3 = stage('zg053_impossible');
  await applyStage(d3, evidenceIds[2]);
  await runCaseEscalation({ ...commandCtx, now: d3.at });
  const view = await currentAssessmentView(pool, workspaceId, { kind: 'JOURNEY', id: journeyId }, 'VIABILITY', d3.at);
  console.log('D3 journey overallVerdict', view.assessment?.overallVerdict, 'caseId', caseId);
  report.caseId = caseId;

  // REPLAY transport/hotel research composition (matches normal boot seam).
  const research = composeTargetTransportResearch(
    loadConfig({ ADAPTER_MODE: 'REPLAY', PG_TARGET_WORKSPACE_ID: workspaceId }),
    process.cwd(),
    buildTargetTimezoneResolver(pool, workspaceId),
  );
  const sourceConnection = await pool.query(
    `SELECT c.id, c.provider_kind FROM external_connections c
       JOIN external_records r ON r.workspace_id = c.workspace_id AND r.connection_id = c.id
      WHERE c.workspace_id = $1 AND r.record_type = 'SOURCE_PLACE' AND r.external_id = 'place-nrt'`,
    [workspaceId],
  );
  const passport = await pool.query(
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
  const reviewerId = randomUUID();
  await createPrincipal(new PgUnitOfWork(pool, workspaceId), {
    workspaceId, actorPrincipalId: ACTOR,
    idempotencyKey: `probe-reviewer:${reviewerId}`,
    principalId: reviewerId, actorType: 'HUMAN',
    authIssuer: 'urn:northstar:test', authSubject: reviewerId,
  });

  const baselineHotel = new NuiteeAdapter({
    mode: 'REPLAY',
    store: new FileRecordingStore({ readDirs: [resolve('recordings'), resolve('fixtures/recordings')] }),
  });
  await bootstrapProviderStayBaseline({
    pool, uow: () => new PgUnitOfWork(pool, workspaceId), workspaceId, actorPrincipalId: ACTOR,
    hotel: baselineHotel, mode: 'REPLAY',
    binding: {
      sourceBookingReference: 'ait-draft-09-destination-stay',
      propertyExternalRef: { system: 'nuitee-hotel-id', value: 'lp6d67d' },
      guestNationality: 'SG', guests: { adults: 1, rooms: 1 },
    },
    observedAt: d3.at,
  });

  const visit = await pool.query(
    `SELECT id FROM intended_visits WHERE workspace_id = $1 AND journey_id = $2 AND transit_intent = false`,
    [workspaceId, journeyId],
  );
  const journeyHead = await pool.query(
    `SELECT revision::text AS revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2`,
    [workspaceId, journeyId],
  );
  await selectCredential(new PgUnitOfWork(pool, workspaceId), {
    workspaceId, actorPrincipalId: ACTOR,
    idempotencyKey: `probe-passport:${passport.rows[0].credential_id}`,
    journeyId, expectedRevision: Number(journeyHead.rows[0].revision),
    credentialId: passport.rows[0].credential_id, credentialVersionId: passport.rows[0].version_id,
    scopeIntendedVisitIds: [visit.rows[0].id],
  });
  await new PgReassessmentWorker(pool, { actorId: ACTOR }).drainAvailable(d3.at, pipeline, { workspaceId, maxItems: 100, maxMs: 60_000 });

  const configurationDirectory = await mkdtemp(join(tmpdir(), 'northstar-jordan-probe-'));
  const configurationFile = join(configurationDirectory, 'research.json');
  await writeFile(configurationFile, JSON.stringify({
    schemaVersion: 1,
    hotelPoliciesFile: resolve('data/ait-demo-input-pack/global/hotel-property-policies.json'),
    entryPoliciesFile: resolve('data/ait-demo-input-pack/global/reviewed-entry-policies.json'),
    sourceConnectionProviderKind: sourceConnection.rows[0].provider_kind,
    overnightTargets: [{
      arrivalAirportSourceRef: 'SOURCE_PLACE:place-nrt', hotelPolicyId: 'hotel-policy-narita-gateway-2026',
      jurisdictionSourceRef: 'SOURCE_JURISDICTION:jur-jp', countryCode: 'JP', entryPolicyId: 'jp-short-visit-sg-passport-2026-09',
    }],
    existingVisitTargets: [{
      visitSourceRef: 'SOURCE_INTENDED_VISIT:ait-draft-09-singapore-destination', visitId: visit.rows[0].id,
      jurisdictionSourceRef: 'SOURCE_JURISDICTION:jur-sg', entryPolicyId: 'sg-issued-passport-eligibility-2026-09', countryCode: 'SG',
    }],
    passportSelections: [{
      travellerSourceRef: 'SOURCE_TRAVELLER_DRAFT:ait-draft-09',
      credentialId: passport.rows[0].credential_id, credentialVersionId: passport.rows[0].version_id, guestNationality: 'SG',
    }],
    stayReplacementBinding: {
      sourceBookingReference: 'ait-draft-09-destination-stay',
      propertyExternalRef: { system: 'nuitee-hotel-id', value: 'lp6d67d' },
      passport: { credentialId: passport.rows[0].credential_id, credentialVersionId: passport.rows[0].version_id, guestNationality: 'SG' },
      guests: { adults: 1, rooms: 1 }, visitId: visit.rows[0].id,
      provenance: { mode: 'REPLAY', observedAt: '2026-09-21T01:40:00.000Z', sourceRefs: ['ait-draft-09-destination-stay'] },
    },
  }));

  const recoveryResearch = await composeTargetRecoveryResearch({
    config: loadConfig({ ADAPTER_MODE: 'REPLAY', PG_TARGET_WORKSPACE_ID: workspaceId }),
    cwd: process.cwd(), configurationFile, pool, workspaceId, actorPrincipalId: ACTOR,
    uow: () => new PgUnitOfWork(pool, workspaceId), reviewerPrincipalId: reviewerId,
  });
  const planner = createRecoveryPlanningCoordinator({
    pool, workspaceId, actorPrincipalId: ACTOR, uow: () => new PgUnitOfWork(pool, workspaceId),
    now: d3.at, availableCapabilities: ['FLIGHT', 'HOTEL', 'RESEARCH'],
    transportPlanning: research, preparePlanningContext: recoveryResearch.prepare,
  });
  let planned = await planner.planCaseDetailed({ recoveryCaseId: caseId, reason: 'REASSESSMENT', now: d3.at });
  if (planned.ok && planned.result.outcome === 'STALE_RETRY_REQUIRED') {
    await new PgReassessmentWorker(pool, { actorId: ACTOR }).drainAvailable(d3.at, pipeline, { workspaceId, maxItems: 100, maxMs: 60_000 });
    planned = await planner.planCaseDetailed({ recoveryCaseId: caseId, reason: 'REASSESSMENT', now: d3.at });
  }
  console.log('REPLAY planning outcome', planned.ok ? planned.result.outcome : planned);

  // --- STEP 3b: RECORD-mode research (provider READ-only) to reach an
  // execution-eligible (fresh-quote) recommendation. NO book/pay/ticket calls. ---
  console.log('=== STEP 3b: RECORD-mode research reads (no mutation) for execution-eligible plan ===');
  const refreshSeed = await attachSeedSession(pool, workspaceId, ACTOR, 1);
  const refreshEvidence = takeSeedEvidence(refreshSeed);
  await commitSeed(refreshSeed);
  await applyStage({ ...d3, eventId: `${d3.eventId}:probe-record-basis` }, refreshEvidence);

  const recordConfig = loadConfig(sandboxRecordEnv());
  const recordTransport = composeTargetTransportResearch(recordConfig, process.cwd(), buildTargetTimezoneResolver(pool, workspaceId));
  const recordRecovery = await composeTargetRecoveryResearch({
    config: recordConfig, cwd: process.cwd(), configurationFile, pool, workspaceId, actorPrincipalId: ACTOR,
    uow: () => new PgUnitOfWork(pool, workspaceId), reviewerPrincipalId: reviewerId,
  });
  const organisation = await pool.query(
    `SELECT t.business_context_organisation_id AS id FROM journeys j
       JOIN trips t ON t.workspace_id = j.workspace_id AND t.id = j.trip_id
      WHERE j.workspace_id = $1 AND j.id = $2`,
    [workspaceId, journeyId],
  );
  await createBudget(new PgUnitOfWork(pool, workspaceId), {
    workspaceId, actorPrincipalId: ACTOR, idempotencyKey: `probe-budget:${workspaceId}`,
    budget: { id: randomUUID(), organisationId: organisation.rows[0].id, purpose: 'recovery execution (probe, no dispatch)', amount: { amount: '100000.00', currency: 'USD' } },
  });
  // Prefer the existing org-scoped Nuitee connection; only create one if absent.
  const existingNuitee = await pool.query(
    `SELECT id FROM external_connections
      WHERE workspace_id = $1 AND provider_kind = 'nuitee' AND organisation_id = $2
      ORDER BY id LIMIT 1`,
    [workspaceId, organisation.rows[0].id],
  );
  if (existingNuitee.rowCount === 0) {
    await createExternalConnection(new PgUnitOfWork(pool, workspaceId), {
      workspaceId, actorPrincipalId: ACTOR, idempotencyKey: `probe-nuitee:${workspaceId}`,
      connection: { id: randomUUID(), organisationId: organisation.rows[0].id, providerKind: 'nuitee' },
    });
  }
  // Re-provision authority AFTER budget/connection subjects (matches test order; idempotent).
  const authorityAfter = await provisionWorkspaceAuthority({
    pool, uow: () => new PgUnitOfWork(pool, workspaceId), workspaceId, actorPrincipalId: ACTOR, now: d3.at,
  });
  report.workspaceAuthorityAfterBudget = authorityAfter;
  await new PgReassessmentWorker(pool, { actorId: ACTOR }).drainAvailable(d3.at, pipeline, { workspaceId, maxItems: 100, maxMs: 60_000 });

  const recordPlanner = createRecoveryPlanningCoordinator({
    pool, workspaceId, actorPrincipalId: ACTOR, uow: () => new PgUnitOfWork(pool, workspaceId),
    now: d3.at, availableCapabilities: ['FLIGHT', 'HOTEL', 'RESEARCH'],
    transportPlanning: recordTransport, preparePlanningContext: recordRecovery.prepare,
  });
  let recorded = await recordPlanner.planCaseDetailed({ recoveryCaseId: caseId, reason: 'REASSESSMENT', now: d3.at });
  for (let attempt = 0; attempt < 3 && recorded.ok && recorded.result.outcome === 'STALE_RETRY_REQUIRED'; attempt += 1) {
    await new PgReassessmentWorker(pool, { actorId: ACTOR }).drainAvailable(d3.at, pipeline, { workspaceId, maxItems: 100, maxMs: 60_000 });
    recorded = await recordPlanner.planCaseDetailed({ recoveryCaseId: caseId, reason: 'REASSESSMENT', now: d3.at });
  }
  console.log('RECORD planning outcome', recorded.ok ? recorded.result.outcome : recorded);
  if (!recorded.ok || recorded.result.outcome !== 'AWAITING_AUTHORITY') {
    throw new Error(`RECORD planning did not reach AWAITING_AUTHORITY: ${JSON.stringify(recorded)}`);
  }

  const executable = await pool.query(
    `SELECT s.id AS strategy_id FROM recovery_planning_attempts a
       JOIN recovery_strategies s ON s.workspace_id = a.workspace_id AND s.id = (a.recommendation->>'recommendedStrategyRef')::uuid
       JOIN offer_execution_bindings b ON b.workspace_id = s.workspace_id AND b.recovery_strategy_id = s.id AND b.research_mode IN ('RECORD', 'LIVE')
      WHERE a.workspace_id = $1 AND a.recovery_case_id = $2 AND a.outcome = 'AWAITING_AUTHORITY'
      ORDER BY a.completed_at DESC LIMIT 1`,
    [workspaceId, caseId],
  );
  if (executable.rowCount !== 1) throw new Error('no execution-eligible (fresh-quote) recommendation found');
  const strategyId = executable.rows[0].strategy_id;
  report.strategyId = strategyId;
  console.log('execution-eligible strategyId', strategyId);

  // --- PHASE 6: compiled action DAG, BEFORE approval ---
  console.log('=== PHASE 6: compiled action DAG (before approval) ===');
  const planRow = await pool.query(
    `SELECT id FROM action_plans WHERE workspace_id = $1 AND recovery_strategy_id = $2`,
    [workspaceId, strategyId],
  );
  const actionPlanId = planRow.rows[0]?.id;
  const dagIntents = await pool.query(
    `SELECT id, capability_ref, subject_refs FROM action_intents WHERE workspace_id = $1 AND action_plan_id = $2`,
    [workspaceId, actionPlanId],
  );
  const dagEdges = await pool.query(
    `SELECT from_action_intent_id, to_action_intent_id FROM action_dependencies WHERE workspace_id = $1 AND action_plan_id = $2`,
    [workspaceId, actionPlanId],
  );
  report.actionPlanId = actionPlanId;
  report.dagIntents = dagIntents.rows;
  report.dagEdges = dagEdges.rows;
  console.log('actionPlanId', actionPlanId);
  console.log('intents', JSON.stringify(dagIntents.rows, null, 2));
  console.log('dependency edges (from -> to, "to" runs after "from")', JSON.stringify(dagEdges.rows, null, 2));

  // --- STEP 4/5: exact required authority scope + production authority gate, NO DISPATCH ---
  console.log('=== STEP 4/5: approveRecoveryStrategy (compile + authority gate, no dispatch) ===');
  const executorPrincipalId = authorityAfter.principals.executor;
  const operatorPrincipalId = authorityAfter.principals.operator;
  const approved = await approveRecoveryStrategy({
    pool, workspaceId, actorPrincipalId: ACTOR, uow: () => new PgUnitOfWork(pool, workspaceId), now: d3.at,
    executorPrincipalId,
    externalCapabilities: [...EXTERNAL_OFFER_SELECT_STATEMENTS, ...EXTERNAL_STAY_CAPABILITY_STATEMENTS],
  }, { caseId, strategyId, approverPrincipalId: operatorPrincipalId });

  report.approved = { ok: approved.ok };
  if (!approved.ok) {
    report.approved.error = approved.error;
    console.log('APPROVAL REFUSED', JSON.stringify(approved.error, null, 2));
  } else {
    console.log('APPROVAL ACCEPTED', JSON.stringify(approved.report, null, 2));
    report.approved.report = approved.report;
  }

  // --- Independent exact-scope-coverage cross-check for every compiled intent ---
  console.log('=== Independent per-intent exact scope coverage check ===');
  const intentsRows = await pool.query(
    `SELECT id, capability_ref, subject_refs FROM action_intents WHERE workspace_id = $1 AND action_plan_id IN
      (SELECT id FROM action_plans WHERE workspace_id = $1 AND recovery_strategy_id = $2)`,
    [workspaceId, strategyId],
  );
  const now = d3.at;
  const executorGrants = await loadGrantsForPrincipal(pool, workspaceId, executorPrincipalId, now);
  const operatorGrants = await loadGrantsForPrincipal(pool, workspaceId, operatorPrincipalId, now);
  const intentDetails = [];
  for (const row of intentsRows.rows) {
    const required = await loadRequiredAuthorityScope(pool, workspaceId, row.id);
    const requiredOk = Array.isArray(required);
    const dispatchCovers = requiredOk
      ? executorGrants.filter((g) => g.actions.includes(DISPATCH_ACTION_KIND)).some((g) => scopeCoversRequired(g.scopes, required))
      : false;
    const authorizeCovers = requiredOk
      ? operatorGrants.filter((g) => g.actions.includes(AUTHORIZE_ACTION_KIND)).some((g) => scopeCoversRequired(g.scopes, required))
      : false;
    const detail = {
      intentId: row.id,
      capability: row.capability_ref,
      subjectRefs: row.subject_refs,
      requiredScope: requiredOk ? required : undefined,
      requiredScopeDenial: requiredOk ? undefined : required,
      executorPrincipalId,
      executorDispatchGrantScopes: executorGrants.filter((g) => g.actions.includes(DISPATCH_ACTION_KIND)).map((g) => g.scopes),
      dispatchScopeCoversRequired: dispatchCovers,
      operatorPrincipalId,
      operatorAuthorizeGrantScopes: operatorGrants.filter((g) => g.actions.includes(AUTHORIZE_ACTION_KIND)).map((g) => g.scopes),
      authorizeScopeCoversRequired: authorizeCovers,
    };
    intentDetails.push(detail);
    console.log(JSON.stringify(detail, null, 2));
  }
  report.intentDetails = intentDetails;

  const allDispatchOk = intentDetails.length > 0 && intentDetails.every((d) => d.dispatchScopeCoversRequired);
  const allAuthorizeOk = intentDetails.length > 0 && intentDetails.every((d) => d.authorizeScopeCoversRequired);

  if (approved.ok && allDispatchOk && allAuthorizeOk) {
    report.verdict = 'RUNTIME_AUTHORITY_PASS';
  } else if (!approved.ok && approved.error && JSON.stringify(approved.error).includes('GRANT_MISSING')) {
    report.verdict = 'RUNTIME_GRANT_MISSING_CONFIRMED';
  } else if (!allDispatchOk || !allAuthorizeOk) {
    report.verdict = 'RUNTIME_GRANT_MISSING_CONFIRMED';
  } else {
    report.verdict = approved.ok ? 'RUNTIME_AUTHORITY_PASS' : 'RUNTIME_GRANT_MISSING_CONFIRMED';
  }

  console.log('=== PREFLIGHT/AUTHORITY VERDICT ===', report.verdict);
  console.log(JSON.stringify({
    verdict: report.verdict,
    workspaceId: report.workspaceId,
    caseId: report.caseId,
    strategyId: report.strategyId,
    workspaceAuthority: report.workspaceAuthority,
    workspaceAuthorityAfterBudget: report.workspaceAuthorityAfterBudget,
    preflight: report.preflight,
    approved: report.approved,
    intentCount: intentDetails.length,
    allDispatchOk,
    allAuthorizeOk,
  }, null, 2));

  if (report.verdict === 'RUNTIME_GRANT_MISSING_CONFIRMED') {
    console.log('=== GENUINE STOP: GRANT_MISSING reproduced for real. Not proceeding to Phase 8 execution. ===');
    report.finalVerdict = 'CP6_BLOCKED_GRANT_MISSING';
  } else {
    // --- PHASE 8: real sandbox execution (Atlas + Nuitee), real network calls ---
    console.log('=== PHASE 8: real sandbox execution ===');
    const offerExecution = composeOfferExecution(recordConfig, process.cwd());
    const stayExecution = composeStayExecution(recordConfig, process.cwd());
    if (!offerExecution) throw new Error('composeOfferExecution refused to compose (sandbox credentials/host check failed)');
    if (!stayExecution) throw new Error('composeStayExecution refused to compose (sandbox credentials check failed)');
    // Atlas sandbox often stays on orderStatus=1 (PAID / ticketing) for tens of
    // seconds after pay.do before reaching orderStatus=2 (TICKETED). Default
    // 6×1s poll is too short and leaves OUTCOME_UNKNOWN until later reconcile.
    offerExecution.ticketingPoll = { attempts: 45, delayMs: 2000 };
    const executionBase = {
      pool, workspaceId, actorPrincipalId: ACTOR,
      uow: () => new PgUnitOfWork(pool, workspaceId),
      executorPrincipalId, now: d3.at,
    };
    let executed = 0;
    let lastFlights, lastStays;
    const flightPassReports = [];
    const stayPassReports = [];
    const expectedIntents = approved.report.intents.length;
    for (let pass = 0; pass < 12 && executed < expectedIntents; pass += 1) {
      lastFlights = await runExternalExecutionCycle({ ...executionBase, external: offerExecution });
      lastStays = await runExternalStayExecutionCycle({ ...executionBase, external: stayExecution });
      flightPassReports.push({ pass, ...lastFlights.report });
      stayPassReports.push({ pass, ...lastStays.report });
      console.log(`pass ${pass}: flights executed=${lastFlights.report.executed} failed=${lastFlights.report.failed} unknown=${lastFlights.report.unknown} outcomes=${JSON.stringify(lastFlights.report.outcomes)}`);
      console.log(`pass ${pass}: stays executed=${lastStays.report.executed} failed=${lastStays.report.failed} unknown=${lastStays.report.unknown} outcomes=${JSON.stringify(lastStays.report.outcomes)}`);
      if (lastFlights.report.failed > 0 || lastStays.report.failed > 0) {
        console.log('=== GENUINE STOP: execution pass reported a failure ===', JSON.stringify({ flights: lastFlights.report, stays: lastStays.report }));
        report.finalVerdict = 'CP6_RECONCILIATION_REQUIRED';
        break;
      }
      executed += lastFlights.report.executed + lastStays.report.executed;
      const drained = await new PgReassessmentWorker(pool, { actorId: ACTOR })
        .drainAvailable(d3.at, pipeline, { workspaceId, maxItems: 100, maxMs: 60_000 });
      if (drained.stoppedReason !== 'EMPTY') throw new Error(`drain did not empty: ${JSON.stringify(drained)}`);
      if (executed < expectedIntents) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
    report.executed = executed;
    report.expectedIntents = expectedIntents;
    report.lastFlights = lastFlights?.report;
    report.lastStays = lastStays?.report;
    report.flightPassReports = flightPassReports;
    report.stayPassReports = stayPassReports;
    console.log('executed', executed, 'of', expectedIntents, 'intents');

    if (!report.finalVerdict) {
      if (executed !== expectedIntents) {
        console.log('=== GENUINE STOP: not all intents executed after 8 passes ===');
        report.finalVerdict = 'CP6_RECONCILIATION_REQUIRED';
      } else {
        // --- PHASE 9: observe/reassess to terminal state ---
        console.log('=== PHASE 9: reassessment + resolution ===');
        const afterView = await currentAssessmentView(pool, workspaceId, { kind: 'JOURNEY', id: journeyId }, 'VIABILITY', d3.at);
        report.afterView = { status: afterView.status, verdict: afterView.assessment?.overallVerdict };
        console.log('post-execution journey viability', JSON.stringify(report.afterView));
        const resolution = await runCaseResolutionPass({
          pool, workspaceId, actorPrincipalId: ACTOR, uow: () => new PgUnitOfWork(pool, workspaceId), now: d3.at,
        });
        report.resolutionOutcomes = resolution.outcomes;
        console.log('resolution outcomes', JSON.stringify(resolution.outcomes, null, 2));
        const finalCaseView = projectRecoveryCase((await loadRecoveryCaseFacts(pool, workspaceId, caseId, d3.at)));
        report.finalCaseStatus = finalCaseView.status;
        report.finalTripViability = finalCaseView.tripViability;
        console.log('final case status', finalCaseView.status, 'trip viability', JSON.stringify(finalCaseView.tripViability));
        report.finalVerdict = finalCaseView.status === 'RESOLVED' && finalCaseView.tripViability?.verdict === 'PASS'
          ? 'CP6_RESOLVED_PASS'
          : 'CP6_RECOVERED_WITH_LOSS';
      }
    }
  }

  console.log('=== CP6 FINAL VERDICT ===', report.finalVerdict);
  await writeFile(
    join(ROOT, 'docs/work/cp6-evidence/cp6-execution-report.json'),
    JSON.stringify({
      ...report,
      cloneDatabaseName: clone.databaseName,
      fixtureDatabaseName: fixture.databaseName,
      pgHost: process.env.PGTEST_HOST,
      pgPort: process.env.PGTEST_PORT,
      pgUser: process.env.PGTEST_USER,
      pgPassword: process.env.PGTEST_PASSWORD,
    }, null, 2),
  );
} finally {
  // Keep disposable DBs for browser evidence OR for OUTCOME_UNKNOWN reconciliation.
  if (
    report.finalVerdict === 'CP6_RESOLVED_PASS'
    || report.finalVerdict === 'CP6_RECOVERED_WITH_LOSS'
    || report.finalVerdict === 'CP6_RECONCILIATION_REQUIRED'
  ) {
    console.log('=== Keeping clone/fixture databases ALIVE for Phase 10 / reconciliation ===');
    console.log('cloneDb', clone.databaseName, 'fixtureDb', fixture.databaseName, 'workspaceId', workspaceId);
  } else {
    await clone.drop().catch((e) => console.error('clone drop failed', e));
    await fixture.drop().catch((e) => console.error('fixture drop failed', e));
  }
}

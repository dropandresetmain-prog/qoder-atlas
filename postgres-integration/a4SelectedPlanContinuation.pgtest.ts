/**
 * A4 continuation proofs against real PostgreSQL, the production M6 registry,
 * and the existing Atlas canonical-application path. No hotel dispatcher runs.
 * Provider responses are explicitly controlled test doubles, not live evidence.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import { plannedTransportCase, stampBindingResearchMode } from './r4TransportWorld.ts';
import { seedCredential } from './m2Seed.ts';
import { seedIntendedVisit } from './m6WorldSeed.ts';
import { mustOk, persistStrategyChangeRow } from './m8ExecutionGateHelpers.ts';
import { captureWorld } from '../src/persistence/postgres/world/pgCurrentState.ts';
import { ScenarioChangeSchema } from '../src/contracts/v2/scenario/scenarioChange.ts';
import { createM6Registry } from '../src/resolution/evaluation/registry.ts';
import { evaluateRecoveryStrategy } from '../src/resolution/scenarios/evaluate.ts';
import { approveRecoveryStrategy } from '../src/app/target/recoveryApproval.ts';
import { createPreparedExecutionAttempt } from '../src/persistence/postgres/commands/m8AuthorityCommands.ts';
import { updateJourneyItem } from '../src/persistence/postgres/commands/travelCommands.ts';
import { persistOfferExecutionBindings } from '../src/persistence/postgres/execution/providerExecutionInputs.ts';
import { PgExecutionWorker } from '../src/persistence/postgres/execution/pgExecutionWorker.ts';
import { evaluateStoredExecutionGate } from '../src/persistence/postgres/execution/storedExecutionGate.ts';
import { selectedPlanDependencyReadiness, loadCurrentSelectedPlanContinuation } from '../src/persistence/postgres/execution/selectedPlanContinuation.ts';
import { createSelectedPlanContinuationService } from '../src/app/target/selectedPlanContinuation.ts';
import { retainSelectedPlanEvaluationInputs, type SelectedEvaluationInputs } from '../src/app/target/selectedPlanEvaluationInputs.ts';
import { selectedPlanApplicationUnitOfWork } from '../src/app/target/selectedPlanCanonicalApplication.ts';
import { EXTERNAL_OFFER_SELECT_STATEMENTS, runExternalOfferExecutionPass, type ExternalOfferExecutionDeps } from '../src/app/target/externalOfferExecution.ts';
import type { HotelPlanningMaterialization } from '../src/app/targetHotelCompanionPlanning.ts';

after(async () => { await (await sharedTestPool()).end(); });

type Shape = 'FLIGHT_STAY' | 'FLIGHT_INTENT';

async function fixture(shape: Shape = 'FLIGHT_STAY') {
  const f = await plannedTransportCase(`A4 selected continuation ${shape}`);
  const pool = f.c.pool; const workspaceId = f.ws; const actorId = f.c.world.actorId;
  const person = f.c.world.people[0]!; const registry = createM6Registry();
  const material = (await pool.query<{ materialization: SelectedEvaluationInputs }>(
    'SELECT materialization FROM selected_plan_evaluation_inputs WHERE workspace_id=$1 AND recovery_strategy_id=$2',
    [workspaceId, f.strategyId])).rows[0]!.materialization;
  const original = (await pool.query<{ scenario_change: unknown }>(
    'SELECT scenario_change FROM recovery_strategies WHERE workspace_id=$1 AND id=$2', [workspaceId, f.strategyId])).rows[0]!;
  const originalChange = ScenarioChangeSchema.parse(original.scenario_change);
  const capture = () => captureWorld(pool, { workspaceId, focus: [{ kind: 'JOURNEY', id: person.journeyId }], at: f.c.now, informationTopics: registry.informationTopics });
  let world = await capture();
  const selectedFlight = originalChange.effects[0]!;
  assert.equal(selectedFlight.effectKind, 'SELECT_OFFER');
  if (selectedFlight.effectKind !== 'SELECT_OFFER') throw new Error('fixture flight missing');
  const flightItem = world.journeyItems.find((i) => i.id === selectedFlight.journeyItemId)!;
  let hotel: HotelPlanningMaterialization | undefined;
  let nextEffect: unknown;
  if (shape === 'FLIGHT_STAY') {
    const last = world.journeyItems.filter((i) => i.journeyId === person.journeyId).sort((a,b) => a.orderKey.localeCompare(b.orderKey)).at(-1)!;
    const service = world.transportServices.find((s) => s.id === last.selectedServiceId)!;
    const placeId = service.destinationPlaceId;
    const jurisdictionId = world.placeJurisdictions.find((p) => p.placeId === placeId)!.jurisdictionId;
    const arrival = Date.parse(service.published.arrival!.value);
    const stayWindow = { start: new Date(arrival + 3_600_000).toISOString(), end: new Date(arrival + 25 * 3_600_000).toISOString() };
    const seedClient = await pool.connect();
    let visitId: string;
    try {
      await seedClient.query('BEGIN');
      const seed = { ...f.c.world.seed, client: seedClient };
      const passport = await seedCredential(seed, { travellerId: person.travellerId, expiryDate: '2035-01-01' });
      visitId = await seedIntendedVisit(seed, { journeyId: person.journeyId, jurisdictionId, purpose: 'LEISURE', ...stayWindow });
      const selectionId = randomUUID();
      await seedClient.query(`INSERT INTO credential_selections
        (workspace_id,id,journey_id,credential_id,credential_version_id,created_by_actor_id) VALUES ($1,$2,$3,$4,$5,$6)`,
      [workspaceId,selectionId,person.journeyId,passport.credentialId,passport.versionId,actorId]);
      await seedClient.query('INSERT INTO credential_selection_visits (workspace_id,selection_id,intended_visit_id) VALUES ($1,$2,$3)', [workspaceId,selectionId,visitId]);
      await seedClient.query('COMMIT');
    } catch (error) { await seedClient.query('ROLLBACK'); throw error; }
    finally { seedClient.release(); }
    const offer = { offerId: randomUUID(), placeId, stayWindow, price: { amount: '10.00', currency: 'USD' } };
    const proposedJourneyItemId = randomUUID();
    const visit = { kind: 'EXISTING' as const, visitId };
    const provenance = { providerId: 'controlled-stay-research', mode: 'RECORD' as const, observedAt: f.c.now, sourceRefs: [] };
    hotel = { resolvedStayOffers: [offer], quotedStays: [{ baseCandidateKey: 'selected-continuation-fixture', journeyId: person.journeyId,
      context: { placeId, stayWindow, proposedJourneyItemId, orderKey: '030', visit, provenance }, offer,
      provider: { propertyId: 'property-1', rateId: 'rate-1', quoteId: 'quote-1', searchRequestFingerprint: 'fixture-search', quoteProvenance: provenance },
    }] };
    nextEffect = { effectKind: 'ADD_JOURNEY_STAY', proposedJourneyItemId, journeyId: person.journeyId, orderKey: '030',
      offerId: offer.offerId, offerPrice: offer.price, visit };
    world = await capture();
  } else {
    // A materially different selected shape; the same continuation has no stay
    // terms or stay execution assumptions. No demo-name/route branch in product.
    nextEffect = { effectKind: 'ALTER_JOURNEY_ITEM_INTENT', journeyItemId: flightItem.id,
      proposedWindow: flightItem.intendedWindow ?? { start: f.c.now, end: new Date(Date.parse(f.c.now)+3_600_000).toISOString() } };
  }
  const change = ScenarioChangeSchema.parse({ ...originalChange, id: randomUUID(), recoveryStrategyId: randomUUID(),
    strategyVersion: 20, effects: [selectedFlight, nextEffect] });
  const evaluated = evaluateRecoveryStrategy({ recoveryCaseId: f.c.caseId, strategyId: change.recoveryStrategyId,
    strategyVersion: change.strategyVersion, basisAssessmentId: change.basisAssessmentId, scenarioChange: change,
    baseWorld: { ...world, transportServices: [...world.transportServices, ...material.services] }, baseManifest: world.manifest,
    resolvedOffers: material.offers, resolvedStayOffers: hotel?.resolvedStayOffers, registry, now: f.c.now,
    resolveSubjectRefs: [{ kind: 'JOURNEY', id: person.journeyId }],
  });
  assert.equal(evaluated.ok, true, JSON.stringify(evaluated));
  if (!evaluated.ok) throw new Error('fixture RC-6 failed');
  assert.equal(evaluated.value.strategy.viability, 'VIABLE', JSON.stringify(evaluated.value.viabilityDecisions));
  await persistStrategyChangeRow(pool, workspaceId, actorId, f.c.caseId, change, { baseManifest: world.manifest });
  await persistOfferExecutionBindings(pool, { workspaceId, actorId, recoveryCaseId: f.c.caseId, strategies: [evaluated.value.strategy], services: material.services, resolvedOffers: material.offers });
  await stampBindingResearchMode(pool, workspaceId, 'RECORD');
  await retainSelectedPlanEvaluationInputs(pool, { workspaceId, actorId, strategies: [evaluated.value.strategy], services: material.services, offers: material.offers, ...(hotel ? { hotel } : {}) });
  await f.c.drain();
  const approved = await approveRecoveryStrategy({ pool, workspaceId, actorPrincipalId: actorId, uow: () => f.c.app.unitOfWork(),
    now: f.c.now, executorPrincipalId: f.c.executorPrincipalId,
    externalCapabilities: [...EXTERNAL_OFFER_SELECT_STATEMENTS, { capabilityRef: 'external:stay.book', supported: true }],
  }, { caseId: f.c.caseId, strategyId: change.recoveryStrategyId, approverPrincipalId: f.c.operatorPrincipalId });
  assert.equal(approved.ok, true, JSON.stringify(approved));
  await f.c.drain();
  const plan = (await pool.query<{ id: string }>('SELECT id FROM action_plans WHERE workspace_id=$1 AND recovery_strategy_id=$2', [workspaceId,change.recoveryStrategyId])).rows[0]!;
  const intents = (await pool.query<{ id: string }>('SELECT id FROM action_intents WHERE workspace_id=$1 AND action_plan_id=$2 ORDER BY source_effect_index', [workspaceId,plan.id])).rows;
  const firstId = intents[0]!.id; const nextId = intents[1]!.id;
  const service = createSelectedPlanContinuationService({ pool, workspaceId, actorId, executorPrincipalId: () => f.c.executorPrincipalId, clock: () => f.c.now });
  const request = { actionPlanId: plan.id, nextActionIntentId: nextId };
  const gate = () => evaluateStoredExecutionGate(pool, { workspaceId, intentId: nextId, principalId: f.c.executorPrincipalId, now: f.c.now });
  const prepare = (intentId: string, attemptNumber = 1) => createPreparedExecutionAttempt(f.c.app.unitOfWork(), {
    workspaceId, actorPrincipalId: actorId, idempotencyKey: randomUUID(), planId: plan.id, intentId, attemptNumber,
    principalId: f.c.executorPrincipalId, now: f.c.now,
  });
  return { f, pool, workspaceId, actorId, person, change, plan, firstId, nextId, gate, prepare, service, request, world };
}

async function observe(f: Awaited<ReturnType<typeof fixture>>, outcome: 'SUCCESS' | 'UNKNOWN' = 'SUCCESS') {
  const prepared = mustOk(await f.prepare(f.firstId));
  const worker = new PgExecutionWorker(f.pool, { actorId: f.actorId });
  const claim = await worker.claimPrepared(f.workspaceId, prepared.attemptId);
  assert.ok(claim);
  const dispatched = await worker.dispatchClaimed(claim, {
    principalId: f.f.c.executorPrincipalId, now: f.f.c.now, observed: { capabilityKind: 'SERVICE', supported: true },
    dispatcher: async () => outcome === 'UNKNOWN' ? { kind: 'LOST_RESPONSE', requestRef: 'controlled-order' }
      : { kind: 'SUCCESS', responseRef: 'controlled-order', sourceOwnedFields: { orderStatus: 'TICKETED', providerOrderRef: 'controlled-order' } },
  });
  assert.equal(dispatched.outcome, outcome === 'SUCCESS' ? 'OBSERVED_SUCCESS' : 'OUTCOME_UNKNOWN');
  return { worker, attemptId: prepared.attemptId };
}

async function applyObservedFlight(f: Awaited<ReturnType<typeof fixture>>) {
  let providerCalls = 0;
  const forbidden = async () => { providerCalls++; throw new Error('Known provider success must not be redispatched'); };
  const deps: ExternalOfferExecutionDeps = {
    mode: 'RECORD', flight: { verifyOffer: forbidden },
    transactions: { descriptor: { family: 'FLIGHT', providerId: 'atlas', mode: 'RECORD', supportedOperations: [], maxSideEffectLevel: 'MONEY_MOVING' },
      createOrder: forbidden, payOrder: forbidden, retrieveOrder: forbidden, quoteCancellation: forbidden,
      submitCancellation: forbidden, retrieveCancellationStatus: forbidden },
    paymentRef: 'TEST_ONLY_NO_PAYMENT',
  };
  const report = await runExternalOfferExecutionPass(f.f.execCtx(deps));
  assert.equal(providerCalls, 0);
  assert.equal(report.canonicalPending.length, 0, JSON.stringify(report));
  assert.equal((await f.pool.query('SELECT 1 FROM selected_plan_canonical_applications WHERE workspace_id=$1 AND action_intent_id=$2 AND completes_effect', [f.workspaceId, f.firstId])).rows.length, 1);
}

async function mutateJourney(f: Awaited<ReturnType<typeof fixture>>) {
  const revision = Number((await f.pool.query<{ revision: string }>('SELECT revision FROM aggregate_heads WHERE workspace_id=$1 AND aggregate_id=$2', [f.workspaceId,f.person.journeyId])).rows[0]!.revision);
  const item = f.world.journeyItems.find((i) => i.journeyId === f.person.journeyId)!;
  mustOk(await updateJourneyItem(f.f.c.app.unitOfWork(), { workspaceId: f.workspaceId, actorPrincipalId: f.actorId,
    idempotencyKey: randomUUID(), journeyId: f.person.journeyId, journeyItemId: item.id, expectedRevision: revision, flexible: !item.flexible }));
}

describe('A4 exact selected-plan continuation', () => {
  test('A/B: external success alone blocks stay; exact Atlas canonical application + production residual evaluation permits preparation', async () => {
    const f = await fixture(); await observe(f);
    assert.equal((await selectedPlanDependencyReadiness(f.pool,f.workspaceId,f.nextId)).ready, false);
    assert.equal((await f.gate()).allowed, false);
    assert.equal((await f.prepare(f.nextId)).ok, false);
    assert.equal((await f.service(f.request)).ok, false);
    await applyObservedFlight(f);
    assert.equal((await selectedPlanDependencyReadiness(f.pool,f.workspaceId,f.nextId)).ready, true);
    assert.equal((await f.gate()).allowed, false, 'receipt alone does not replace residual evaluation');
    const checkpoint = await f.service(f.request);
    assert.equal(checkpoint.ok,true,JSON.stringify(checkpoint));
    assert.equal((await f.gate()).allowed,true);
    assert.equal((await f.prepare(f.nextId)).ok,true,'eligibility only: no stay dispatcher runs');
    assert.equal((await f.pool.query('SELECT 1 FROM selected_plan_canonical_applications WHERE workspace_id=$1 AND action_intent_id=$2',[f.workspaceId,f.nextId])).rows.length,0);
    await f.f.c.app.close();
  });

  test('C: unrelated canonical mutation cannot be laundered through fresh viable re-evaluation', async () => {
    const f = await fixture(); await observe(f); await applyObservedFlight(f); await mutateJourney(f);
    const result = await f.service(f.request);
    assert.equal(result.ok,false);
    if (!result.ok) assert.match(result.code,/UNEXPLAINED_CANONICAL_CHANGE|UNEXPLAINED_SCOPE_CHANGE/);
    assert.equal((await f.gate()).allowed,false); await f.f.c.app.close();
  });

  test('C/currentness: post-checkpoint mutation and expiry both revoke continuation eligibility', async () => {
    const f = await fixture(); await observe(f); await applyObservedFlight(f);
    const checkpoint = await f.service(f.request); assert.equal(checkpoint.ok,true,JSON.stringify(checkpoint));
    if (!checkpoint.ok) return;
    assert.equal(await loadCurrentSelectedPlanContinuation(f.pool,f.workspaceId,f.plan.id,f.nextId,checkpoint.expiresAt),undefined);
    await mutateJourney(f); assert.equal((await f.gate()).allowed,false); await f.f.c.app.close();
  });

  test('D: unknown outcome permits lookup only; successor and second dispatch attempt stay blocked', async () => {
    const f = await fixture(); const observed = await observe(f,'UNKNOWN');
    assert.equal((await f.service(f.request)).ok,false); assert.equal((await f.gate()).allowed,false);
    assert.equal((await f.prepare(f.firstId,2)).ok,false);
    const reconciled = await observed.worker.claimForReconciliation(f.workspaceId,observed.attemptId); assert.ok(reconciled);
    assert.equal(reconciled.status,'RECONCILIATION_REQUIRED');
    assert.equal((await f.pool.query('SELECT 1 FROM execution_attempts WHERE workspace_id=$1 AND action_intent_id=$2',[f.workspaceId,f.firstId])).rows.length,1);
    assert.equal((await f.pool.query('SELECT 1 FROM selected_plan_canonical_applications WHERE workspace_id=$1',[f.workspaceId])).rows.length,0);
    await f.f.c.app.close();
  });

  test('E: wrong source kind or observation cannot attach a canonical effect; no caller-world evidence accepted', async () => {
    const f = await fixture(); const attempt = await observe(f);
    const revision = Number((await f.pool.query<{ revision: string }>('SELECT revision FROM aggregate_heads WHERE workspace_id=$1 AND aggregate_id=$2',[f.workspaceId,f.person.journeyId])).rows[0]!.revision);
    const effect = f.change.effects[0]!; assert.equal(effect.effectKind,'SELECT_OFFER'); if (effect.effectKind !== 'SELECT_OFFER') return;
    for (const source of [{kind:'INTERNAL_COMMAND'} as const,{kind:'EXTERNAL_PROVIDER',observationId:randomUUID()} as const]) {
      const uow = selectedPlanApplicationUnitOfWork(f.f.c.app.unitOfWork(),{workspaceId:f.workspaceId,actionIntentId:f.firstId,attemptId:attempt.attemptId,source});
      const result = await updateJourneyItem(uow,{workspaceId:f.workspaceId,actorPrincipalId:f.actorId,idempotencyKey:randomUUID(),journeyId:f.person.journeyId,journeyItemId:effect.journeyItemId,expectedRevision:revision,flexible:true});
      assert.equal(result.ok,false);
    }
    const extra = { ...f.request, currentWorld: f.world };
    const injected = await f.service(extra); assert.equal(injected.ok,false);
    if (!injected.ok) assert.equal(injected.code,'CONTINUATION_IDS_ONLY');
    assert.equal((await f.pool.query('SELECT 1 FROM selected_plan_canonical_applications WHERE workspace_id=$1',[f.workspaceId])).rows.length,0);
    await f.f.c.app.close();
  });

  test('E: receipt owner constraints refuse wrong plan, strategy, effect, receipt and source identity', async () => {
    const f = await fixture(); await observe(f); await applyObservedFlight(f);
    for (const replacement of [
      "action_plan_id='"+randomUUID()+"'::uuid", "source_strategy_id='"+randomUUID()+"'::uuid",
      "source_effect_fingerprint=repeat('0',64)", "receipt_payload_hash=repeat('0',64)",
      "application_origin='INTERNAL_COMMAND'",
    ]) {
      // Tests use an explicit transaction and rollback: no permanent trigger
      // disabling or mutation of existing immutable evidence.
      const client = await f.pool.connect();
      try {
        await client.query('BEGIN');
        const row = (await client.query<Record<string,unknown>>('SELECT * FROM selected_plan_canonical_applications WHERE workspace_id=$1 AND completes_effect LIMIT 1',[f.workspaceId])).rows[0]!;
        const [column, expression] = replacement.split('=');
        // Remove only this fixture's original bridge within the rolled-back
        // transaction so uniqueness cannot masquerade as an ownership refusal.
        await client.query('SET LOCAL session_replication_role = replica');
        await client.query('DELETE FROM selected_plan_canonical_applications WHERE workspace_id=$1 AND completes_effect', [f.workspaceId]);
        await client.query('SET LOCAL session_replication_role = origin');
        const columns = Object.keys(row).filter((key) => key !== 'created_at');
        const values = columns.map((key,index) => `$${index+1}`);
        await assert.rejects(async () => {
          await client.query(`INSERT INTO selected_plan_canonical_applications (${columns.join(',')}) VALUES (${values.join(',')})`,columns.map((key) => key === column ? (column === 'source_effect_fingerprint' || column === 'receipt_payload_hash' ? '0'.repeat(64) : column === 'application_origin' ? 'INTERNAL_COMMAND' : expression!.split("'")[1]) : key==='scope_changes' ? JSON.stringify(row[key]) : row[key]));
          await client.query('SET CONSTRAINTS ALL IMMEDIATE');
        });
      } finally { await client.query('ROLLBACK'); client.release(); }
    }
    await f.f.c.app.close();
  });

  test('E/checkpoint: an unexpired row must bind exact plan, strategy, next action and the complete residual', async () => {
    const f = await fixture(); await observe(f); await applyObservedFlight(f);
    const checkpoint = await f.service(f.request); assert.equal(checkpoint.ok,true,JSON.stringify(checkpoint));
    if (!checkpoint.ok) return;
    assert.equal(await loadCurrentSelectedPlanContinuation(f.pool,f.workspaceId,randomUUID(),f.nextId,f.f.c.now),undefined);
    assert.equal(await loadCurrentSelectedPlanContinuation(f.pool,f.workspaceId,f.plan.id,f.firstId,f.f.c.now),undefined);
    for (const [column,value] of [
      ['source_strategy_id',randomUUID()], ['next_request_fingerprint','wrong-request'],
      ['residual_effect_fingerprints','[]'], ['source_fingerprint','0'.repeat(64)],
      ['prerequisite_receipts','[]'],
    ]) {
      const client = await f.pool.connect();
      try {
        await client.query('BEGIN');
        // Fault injection only. Restore all production constraints before the
        // consumer runs; rollback leaves immutable evidence exactly unchanged.
        await client.query('SET LOCAL session_replication_role = replica');
        await client.query(`UPDATE selected_plan_continuation_checkpoints SET ${column}=$3 WHERE workspace_id=$1 AND id=$2`,[f.workspaceId,checkpoint.checkpointId,value]);
        await client.query('SET LOCAL session_replication_role = origin');
        await assert.rejects(loadCurrentSelectedPlanContinuation(client,f.workspaceId,f.plan.id,f.nextId,f.f.c.now),/differ|mismatch|bound|receipt|residual|source/i);
      } finally { await client.query('ROLLBACK'); client.release(); }
    }
    await f.f.c.app.close();
  });

  test('F: retained selected prices/terms are immutable; a changed quote cannot replace approved material', async () => {
    const f = await fixture();
    await assert.rejects(f.pool.query("UPDATE selected_plan_evaluation_inputs SET materialization=jsonb_set(materialization,'{stays,0,price,amount}','\"999\"') WHERE workspace_id=$1 AND recovery_strategy_id=$2",[f.workspaceId,f.change.recoveryStrategyId]));
    await f.f.c.app.close();
  });

  test('materially different flight -> internal-intent shape uses the identical production continuation service', async () => {
    const f = await fixture('FLIGHT_INTENT'); await observe(f); await applyObservedFlight(f);
    const result = await f.service(f.request); assert.equal(result.ok,true,JSON.stringify(result));
    assert.equal((await f.gate()).allowed,true); await f.f.c.app.close();
  });
});

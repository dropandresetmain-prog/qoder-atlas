/**
 * A4 protected stay execution inputs and external dependency bridge.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import {
  beginSeed,
  commitSeed,
  seedJourney,
  seedRootSubject,
  seedPlace,
  seedTraveller,
  seedTrip,
  takeSeedEvidence,
} from './m3Seed.ts';
import { seedCredential } from './m2Seed.ts';
import { seedJurisdiction } from './m4Seed.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import {
  createPreparedExecutionAttempt,
  openRecoveryCase,
  persistActionPlan,
  transitionExecutionAttempt,
} from '../src/persistence/postgres/commands/m8AuthorityCommands.ts';
import { createPrincipal } from '../src/persistence/postgres/commands/peopleCommands.ts';
import {
  persistStayExecutionBindings,
  resolveStayExecutionInputs,
} from '../src/persistence/postgres/execution/stayExecutionInputs.ts';
import { recordSelectedPlanCanonicalApplication } from '../src/persistence/postgres/execution/selectedPlanContinuation.ts';
import {
  bootstrapTestGrantIssuer,
  loadRequiredAuthorityScopesOrFail,
  mustOk,
  persistStrategyChangeRow,
  seedMinimalCurrentAssessment,
  seedStoredExecutionAuthority,
  tripBaseManifest,
} from './m8ExecutionGateHelpers.ts';
import type { CapturedHotelQuote } from '../src/app/targetHotelCompanionPlanning.ts';
import type { RecoveryStrategy } from '../src/contracts/v2/scenario/recoveryStrategy.ts';
import type { ActionPlan } from '../src/contracts/v2/action/actionPlan.ts';

const NOW = '2033-04-01T00:00:00.000Z';
const STAY_WINDOW = {
  start: '2033-05-02T15:00:00.000Z',
  end: '2033-05-05T11:00:00.000Z',
};

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

async function setup() {
  const pool = await sharedTestPool();
  const seed = await beginSeed(pool, 'A4 stay execution inputs');
  const traveller = await seedTraveller(seed, { displayName: 'A4 Stay Traveller' });
  await seed.client.query(
    `INSERT INTO traveller_names
       (workspace_id,id,traveller_id,name_kind,display_value,family_name,given_name,valid_from,evidence_id,created_by_actor_id)
     VALUES ($1,$2,$3,'LEGAL','Ada Northstar','Northstar','Ada','2030-01-01',$4,$5)`,
    [seed.workspaceId, randomUUID(), traveller.travellerId, takeSeedEvidence(seed), seed.actorId],
  );
  const tripId = await seedTrip(seed, { lifecycleStatus: 'ACTIVE' });
  const journeyId = await seedJourney(seed, {
    tripId,
    travellerId: traveller.travellerId,
    lifecycleStatus: 'ACTIVE',
  });
  const placeId = await seedPlace(seed, { name: 'A4 Hotel Place' });
  const jurisdictionId = await seedJurisdiction(seed, { name: 'A4 Hotel Jurisdiction' });
  const credential = await seedCredential(seed, {
    travellerId: traveller.travellerId,
    issuerCountry: 'SG',
    expiryDate: '2040-01-01',
  });
  const connectionId = await seedRootSubject(seed, { kind: 'EXTERNAL_CONNECTION' });
  await seed.client.query(
    `INSERT INTO external_connections
       (workspace_id,id,provider_kind,created_by_actor_id)
     VALUES ($1,$2,'nuitee',$3)`,
    [seed.workspaceId, connectionId, seed.actorId],
  );
  await commitSeed(seed);
  return {
    pool,
    seed,
    travellerId: traveller.travellerId,
    tripId,
    journeyId,
    placeId,
    jurisdictionId,
    credential,
    connectionId,
    uow: () => new PgUnitOfWork(pool, seed.workspaceId),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

function strategyAndQuote(ctx: Setup) {
  const recoveryCaseId = randomUUID();
  const strategyId = randomUUID();
  const scenarioChangeId = randomUUID();
  const offerId = `hotel-offer-${randomUUID()}`;
  const proposedJourneyItemId = randomUUID();
  const displacedJourneyItemId = randomUUID();
  const reservationLineId = randomUUID();
  const proposedVisitId = randomUUID();
  const proposedSelectionId = randomUUID();
  const visit = {
    kind: 'PROPOSED' as const,
    proposedVisitId,
    jurisdictionId: ctx.jurisdictionId,
    purpose: 'BUSINESS',
    intendedWindow: STAY_WINDOW,
    credentialSelections: [{
      proposedSelectionId,
      credentialId: ctx.credential.credentialId,
      credentialVersionId: ctx.credential.versionId,
    }],
  };
  const effects: RecoveryStrategy['scenarioChange']['effects'] = [
    {
      effectKind: 'ADD_JOURNEY_STAY',
      proposedJourneyItemId,
      journeyId: ctx.journeyId,
      orderKey: '020',
      offerId,
      offerPrice: { amount: '425.50', currency: 'USD' },
      visit,
    },
    {
      effectKind: 'CANCEL_STAY',
      journeyItemId: displacedJourneyItemId,
      reservationLineId,
      cancellationPenalty: { amount: '75.25', currency: 'USD' },
      cancellationPenaltyBasis: 'PROVIDER_POLICY',
    },
  ];
  const strategy: RecoveryStrategy = {
    id: strategyId,
    recoveryCaseId,
    strategyVersion: 1,
    status: 'SELECTED',
    baseManifest: {
      evaluatedAt: NOW,
      evaluatorVersions: [],
      aggregateReads: [],
      scopeReads: [],
      evidenceReads: [],
      coverageReads: [],
      missingCoverage: [],
    },
    basisAssessmentId: randomUUID(),
    affectedSubjectRefs: [{ kind: 'JOURNEY', id: ctx.journeyId }],
    scenarioChange: {
      id: scenarioChangeId,
      recoveryStrategyId: strategyId,
      strategyVersion: 1,
      affectedSubjectRefs: [{ kind: 'JOURNEY', id: ctx.journeyId }],
      basisAssessmentId: randomUUID(),
      effects,
    },
    assumptions: [],
    requiredUnknowns: [],
    candidateAssessments: [],
    candidateAssessmentResults: [],
    viability: 'VIABLE',
    requiredAuthorityScopes: [],
    createdAt: NOW,
    evaluatedAt: NOW,
  };
  const provenance = {
    providerId: 'nuitee',
    mode: 'RECORD' as const,
    observedAt: NOW,
    sourceRefs: [],
    recordingRef: 'a4-stay-execution',
  };
  const quote: CapturedHotelQuote = {
    baseCandidateKey: 'a4-stay-candidate',
    journeyId: ctx.journeyId,
    context: {
      placeId: ctx.placeId,
      stayWindow: STAY_WINDOW,
      provenance,
      proposedJourneyItemId,
      orderKey: '020',
      visit,
    },
    offer: {
      offerId,
      placeId: ctx.placeId,
      stayWindow: STAY_WINDOW,
      price: { amount: '425.50', currency: 'USD' },
    },
    provider: {
      propertyId: 'property-a4',
      rateId: 'rate-a4',
      quoteId: 'quote-a4',
      workflowState: { token: 'protected-state' },
      searchRequestFingerprint: 'search-a4',
      quoteProvenance: provenance,
    },
    replacement: {
      oldJourneyItemId: displacedJourneyItemId,
      reservationLineId,
      cancellationPenalty: { amount: '75.25', currency: 'USD' },
      cancellationPenaltyBasis: 'PROVIDER_POLICY',
      provider: {
        stayElementId: 'booking-a4-displaced',
        policyProvenance: provenance,
      },
    },
  };
  return { recoveryCaseId, strategy, quote, offerId, proposedJourneyItemId, displacedJourneyItemId, reservationLineId };
}

async function seedPlanRows(
  ctx: Setup,
  strategyId: string,
  recoveryCaseId: string,
  scenarioChangeId: string,
  intents: Array<{ id: string; capability: string; refs: Array<{ kind: string; id: string }> }>,
) {
  await ctx.pool.query(
    `INSERT INTO recovery_cases (workspace_id,id,lifecycle_status,created_by_actor_id)
     VALUES ($1,$2,'OPEN',$3)`,
    [ctx.seed.workspaceId, recoveryCaseId, ctx.seed.actorId],
  );
  await ctx.pool.query(
    `INSERT INTO recovery_strategies
       (workspace_id,id,recovery_case_id,strategy_version,status,viability,base_manifest,scenario_change,created_by_actor_id)
     VALUES ($1,$2,$3,1,'SELECTED','VIABLE',$4::jsonb,$5::jsonb,$6)`,
    [
      ctx.seed.workspaceId,
      strategyId,
      recoveryCaseId,
      JSON.stringify({ evaluatedAt: NOW, evaluatorVersions: [], aggregateReads: [], scopeReads: [], evidenceReads: [], coverageReads: [], missingCoverage: [] }),
      JSON.stringify({ id: scenarioChangeId, recoveryStrategyId: strategyId, strategyVersion: 1, affectedSubjectRefs: [{ kind: 'JOURNEY', id: ctx.journeyId }], effects: [] }),
      ctx.seed.actorId,
    ],
  );
  const planId = randomUUID();
  await ctx.pool.query(
    `INSERT INTO action_plans
       (workspace_id,id,recovery_case_id,scenario_change_id,recovery_strategy_id,created_by_actor_id)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [ctx.seed.workspaceId, planId, recoveryCaseId, scenarioChangeId, strategyId, ctx.seed.actorId],
  );
  for (const intent of intents) {
    await ctx.pool.query(
      `INSERT INTO action_intents (
         workspace_id,id,action_plan_id,operation_namespace,logical_operation_key,request_fingerprint,
         capability_ref,subject_refs,expected_observations,compensation_supported,
         compensation_requires_separate_authority,status,created_by_actor_id
       ) VALUES ($1,$2,$3,'provider:nuitee',$4,$5,$6,$7::jsonb,$8::jsonb,false,true,'AUTHORIZED',$9)`,
      [
        ctx.seed.workspaceId,
        intent.id,
        planId,
        `stay:${intent.id}`,
        intent.id.replaceAll('-', ''),
        intent.capability,
        JSON.stringify(intent.refs),
        JSON.stringify(['EXTERNAL_PROVIDER:nuitee']),
        ctx.seed.actorId,
      ],
    );
  }
  return planId;
}

describe('A4 stay execution inputs', () => {
  test('persists complete immutable BOOK and CANCEL provider bindings', async () => {
    const ctx = await setup();
    const fixture = strategyAndQuote(ctx);
    assert.equal(await persistStayExecutionBindings(ctx.pool, {
      workspaceId: ctx.seed.workspaceId,
      actorId: ctx.seed.actorId,
      recoveryCaseId: fixture.recoveryCaseId,
      strategies: [fixture.strategy],
      quotedStays: [fixture.quote],
    }), 2);

    const rows = await ctx.pool.query<Record<string, unknown>>(
      `SELECT action, provider_connection_id, offer_key, provider_property_id, provider_rate_id,
              quote_handle, workflow_state, stay_window, place_id, order_key, required_nights,
              quoted_amount::text, quoted_currency, quote_observed_at, research_mode, journey_item_id,
              reservation_line_id, stay_element_id, cancellation_maximum_loss_amount::text,
              cancellation_maximum_loss_currency, approved_visit
         FROM stay_execution_bindings
        WHERE workspace_id=$1 AND recovery_strategy_id=$2
        ORDER BY action`,
      [ctx.seed.workspaceId, fixture.strategy.id],
    );
    assert.equal(rows.rows.length, 2);
    const book = rows.rows.find((row) => row.action === 'BOOK')!;
    assert.equal(book.provider_connection_id, ctx.connectionId);
    assert.equal(book.offer_key, fixture.offerId);
    assert.equal(book.provider_property_id, 'property-a4');
    assert.equal(book.provider_rate_id, 'rate-a4');
    assert.equal(book.quote_handle, 'quote-a4');
    assert.deepEqual(book.workflow_state, { token: 'protected-state' });
    assert.deepEqual(book.stay_window, STAY_WINDOW);
    assert.equal(book.place_id, ctx.placeId);
    assert.equal(book.order_key, '020');
    assert.equal(book.required_nights, 3);
    assert.equal(book.quoted_amount, '425.50');
    assert.equal(book.quoted_currency, 'USD');
    assert.equal(new Date(String(book.quote_observed_at)).toISOString(), NOW);
    assert.equal(book.research_mode, 'RECORD');
    assert.equal(book.journey_item_id, fixture.proposedJourneyItemId);
    assert.deepEqual(book.approved_visit, {
      kind: 'PROPOSED',
      visit: {
        id: fixture.quote.context.visit.kind === 'PROPOSED' ? fixture.quote.context.visit.proposedVisitId : '',
        journeyId: ctx.journeyId,
        jurisdictionId: ctx.jurisdictionId,
        purpose: 'BUSINESS',
        intendedDates: STAY_WINDOW,
        transitIntent: false,
      },
      credentialSelection: {
        id: fixture.quote.context.visit.kind === 'PROPOSED' ? fixture.quote.context.visit.credentialSelections[0]!.proposedSelectionId : '',
        credentialId: ctx.credential.credentialId,
        credentialVersionId: ctx.credential.versionId,
        scopeIntendedVisitIds: [fixture.quote.context.visit.kind === 'PROPOSED' ? fixture.quote.context.visit.proposedVisitId : ''],
      },
    });
    const cancel = rows.rows.find((row) => row.action === 'CANCEL')!;
    assert.equal(cancel.journey_item_id, fixture.displacedJourneyItemId);
    assert.equal(cancel.reservation_line_id, fixture.reservationLineId);
    assert.equal(cancel.stay_element_id, 'booking-a4-displaced');
    assert.equal(cancel.cancellation_maximum_loss_amount, '75.25');
    assert.equal(cancel.cancellation_maximum_loss_currency, 'USD');
  });

  test('resolve fails closed for missing, ambiguous, and incomplete bindings', async () => {
    const ctx = await setup();
    const fixture = strategyAndQuote(ctx);
    const missingIntent = randomUUID();
    await seedPlanRows(ctx, fixture.strategy.id, fixture.recoveryCaseId, fixture.strategy.scenarioChange.id, [{
      id: missingIntent,
      capability: 'external:stay.book',
      refs: [{ kind: 'OFFER', id: fixture.offerId }],
    }]);
    assert.equal((await resolveStayExecutionInputs(ctx.pool, ctx.seed.workspaceId, missingIntent)).ready, false);
    const missing = await resolveStayExecutionInputs(ctx.pool, ctx.seed.workspaceId, missingIntent);
    assert.deepEqual(missing.ready ? undefined : missing.reason, 'STAY_BINDING_MISSING');

    await persistStayExecutionBindings(ctx.pool, {
      workspaceId: ctx.seed.workspaceId,
      actorId: ctx.seed.actorId,
      recoveryCaseId: fixture.recoveryCaseId,
      strategies: [fixture.strategy],
      quotedStays: [fixture.quote],
    });
    await ctx.pool.query(
      `INSERT INTO stay_execution_bindings (
         workspace_id,id,recovery_case_id,recovery_strategy_id,action,journey_id,offer_key,provider_id,
         provider_connection_id,provider_property_id,provider_rate_id,quote_handle,stay_window,place_id,
         order_key,required_nights,quoted_amount,quoted_currency,quote_observed_at,research_mode,
         journey_item_id,approved_visit,created_by_actor_id
       ) SELECT workspace_id,$1,recovery_case_id,recovery_strategy_id,action,journey_id,offer_key,provider_id,
                provider_connection_id,provider_property_id,provider_rate_id,quote_handle,stay_window,place_id,
                order_key,required_nights,quoted_amount,quoted_currency,quote_observed_at,research_mode,
                $2,approved_visit,created_by_actor_id
           FROM stay_execution_bindings
          WHERE workspace_id=$3 AND recovery_strategy_id=$4 AND action='BOOK'`,
      [randomUUID(), randomUUID(), ctx.seed.workspaceId, fixture.strategy.id],
    );
    const ambiguous = await resolveStayExecutionInputs(ctx.pool, ctx.seed.workspaceId, missingIntent);
    assert.deepEqual(ambiguous.ready ? undefined : ambiguous.reason, 'STAY_BINDING_AMBIGUOUS');

    const incompleteFixture = strategyAndQuote(ctx);
    const incompleteIntent = randomUUID();
    await seedPlanRows(
      ctx,
      incompleteFixture.strategy.id,
      incompleteFixture.recoveryCaseId,
      incompleteFixture.strategy.scenarioChange.id,
      [{
        id: incompleteIntent,
        capability: 'external:stay.book',
        refs: [{ kind: 'OFFER', id: incompleteFixture.offerId }],
      }],
    );
    await ctx.pool.query(
      `INSERT INTO stay_execution_bindings (
         workspace_id,id,recovery_case_id,recovery_strategy_id,action,journey_id,offer_key,provider_id,
         provider_connection_id,quote_handle,stay_window,place_id,order_key,required_nights,
         quoted_amount,quoted_currency,quote_observed_at,research_mode,journey_item_id,created_by_actor_id
       ) VALUES ($1,$2,$3,$4,'BOOK',$5,$6,'nuitee',$7,'quote-incomplete',$8::jsonb,$9,'030',3,
                 100,'USD',$10,'RECORD',$11,$12)`,
      [
        ctx.seed.workspaceId, randomUUID(), incompleteFixture.recoveryCaseId, incompleteFixture.strategy.id,
        ctx.journeyId, incompleteFixture.offerId, ctx.connectionId, JSON.stringify(STAY_WINDOW),
        ctx.placeId, NOW, incompleteFixture.proposedJourneyItemId, ctx.seed.actorId,
      ],
    );
    const incomplete = await resolveStayExecutionInputs(ctx.pool, ctx.seed.workspaceId, incompleteIntent);
    assert.deepEqual(incomplete.ready ? undefined : incomplete.reason, 'STAY_TERMS_MISSING');
  });

  test('external success requires matching canonical receipt before successor prepare', async () => {
    const ctx = await setup();
    const opened = mustOk(await openRecoveryCase(ctx.uow(), {
      workspaceId: ctx.seed.workspaceId,
      actorPrincipalId: ctx.seed.actorId,
      idempotencyKey: randomUUID(),
      openedAt: NOW,
    }));
    const strategyId = randomUUID();
    const scenarioChange = {
      id: randomUUID(),
      recoveryStrategyId: strategyId,
      strategyVersion: 1,
      affectedSubjectRefs: [{ kind: 'JOURNEY' as const, id: ctx.journeyId }],
      effects: [{
        effectKind: 'ALTER_JOURNEY_ITEM_INTENT' as const,
        journeyItemId: randomUUID(),
        proposedWindow: STAY_WINDOW,
      }],
      basisAssessmentId: randomUUID(),
    };
    await persistStrategyChangeRow(
      ctx.pool,
      ctx.seed.workspaceId,
      ctx.seed.actorId,
      opened.caseId,
      scenarioChange,
      {
        baseManifest: tripBaseManifest(ctx.tripId, 1, NOW),
        candidateSummaries: [{ subjectRef: { kind: 'JOURNEY', id: ctx.journeyId } }],
      },
    );
    const planId = randomUUID();
    const firstId = randomUUID();
    const secondId = randomUUID();
    const intent = (id: string, capabilityRef: string) => ({
      id,
      actionPlanId: planId,
      operationNamespace: 'provider:a4-stay-dependency',
      logicalOperationKey: `a4-stay-${id}`,
      requestFingerprint: id.replaceAll('-', ''),
      capabilityRef,
      subjectRefs: [{ kind: 'JOURNEY' as const, id: ctx.journeyId }],
      expectedRevisions: [],
      preconditions: [],
      requiredAuthorityScopes: [],
      expectedObservations: ['EXTERNAL_PROVIDER:a4-stay'],
      compensationPolicy: { supported: false, requiresSeparateAuthority: true },
      status: 'AUTHORIZED' as const,
    });
    const plan: ActionPlan = {
      id: planId,
      recoveryCaseId: opened.caseId,
      scenarioChangeId: scenarioChange.id,
      intents: [intent(firstId, 'external:stay.book'), intent(secondId, 'external:stay.cancel')],
      dependencies: [{ fromActionIntentId: firstId, toActionIntentId: secondId }],
    };
    mustOk(await persistActionPlan(ctx.uow(), {
      workspaceId: ctx.seed.workspaceId,
      actorPrincipalId: ctx.seed.actorId,
      idempotencyKey: randomUUID(),
      plan,
      recoveryStrategyId: strategyId,
    }));
    const principalId = randomUUID();
    mustOk(await createPrincipal(ctx.uow(), {
      workspaceId: ctx.seed.workspaceId,
      actorPrincipalId: ctx.seed.actorId,
      idempotencyKey: randomUUID(),
      principalId,
      actorType: 'HUMAN',
      authIssuer: 'urn:northstar:a4-stay-test',
      authSubject: principalId,
    }));
    await seedMinimalCurrentAssessment(ctx.pool, ctx.seed.workspaceId, { kind: 'JOURNEY', id: ctx.journeyId }, NOW);
    const scopes = await Promise.all(
      plan.intents.map((item) => loadRequiredAuthorityScopesOrFail(ctx.pool, ctx.seed.workspaceId, item.id)),
    );
    const issuerPrincipalId = await bootstrapTestGrantIssuer(
      ctx.pool,
      ctx.seed.workspaceId,
      ctx.seed.actorId,
      NOW,
      scopes.flat(),
    );
    for (let index = 0; index < plan.intents.length; index += 1) {
      await seedStoredExecutionAuthority({
        pool: ctx.pool,
        workspaceId: ctx.seed.workspaceId,
        actorId: ctx.seed.actorId,
        principalId,
        planId,
        intentId: plan.intents[index]!.id,
        scope: scopes[index]!,
        representedPartyRef: { kind: 'TRAVELLER', id: ctx.travellerId },
        requirementRole: 'CASE_OWNER',
        now: NOW,
        issuerPrincipalId,
      });
    }
    const first = mustOk(await createPreparedExecutionAttempt(ctx.uow(), {
      workspaceId: ctx.seed.workspaceId,
      actorPrincipalId: ctx.seed.actorId,
      idempotencyKey: randomUUID(),
      planId,
      intentId: firstId,
      attemptNumber: 1,
      principalId,
      now: NOW,
    }));
    for (const [from, to] of [
      ['PREPARED', 'CLAIMED'],
      ['CLAIMED', 'DISPATCHING'],
      ['DISPATCHING', 'DISPATCHED'],
    ] as const) {
      assert.equal(await transitionExecutionAttempt(ctx.pool, {
        workspaceId: ctx.seed.workspaceId,
        attemptId: first.attemptId,
        from,
        to,
      }), 'APPLIED');
    }
    const observationId = randomUUID();
    await ctx.pool.query(
      `INSERT INTO execution_observations (
         workspace_id,id,attempt_id,action_intent_id,origin,external_record_id,
         source_owned_fields,observed_at,owned_subject_refs,created_by_actor_id
       ) VALUES ($1,$2,$3,$4,'EXTERNAL_PROVIDER',$5,'{}'::jsonb,$6,'[]'::jsonb,$7)`,
      [ctx.seed.workspaceId, observationId, first.attemptId, firstId, randomUUID(), NOW, ctx.seed.actorId],
    );
    assert.equal(await transitionExecutionAttempt(ctx.pool, {
      workspaceId: ctx.seed.workspaceId,
      attemptId: first.attemptId,
      from: 'DISPATCHED',
      to: 'OBSERVED_SUCCESS',
    }), 'APPLIED');
    const prepareSecond = () => createPreparedExecutionAttempt(ctx.uow(), {
      workspaceId: ctx.seed.workspaceId,
      actorPrincipalId: ctx.seed.actorId,
      idempotencyKey: randomUUID(),
      planId,
      intentId: secondId,
      attemptNumber: 1,
      principalId,
      now: NOW,
    });
    const blocked = await prepareSecond();
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.match(blocked.conflict.message, /prerequisite intent .* has not completed/);

    const commandNamespace = 'A4_STAY_CANONICAL_TEST';
    const commandKey = randomUUID();
    await ctx.pool.query(
      `INSERT INTO command_receipts
         (workspace_id,command_namespace,idempotency_key,payload_hash,result_ref,committed_revisions)
       VALUES ($1,$2,$3,$4,$5,'[]'::jsonb)`,
      [ctx.seed.workspaceId, commandNamespace, commandKey, 'a'.repeat(64), JSON.stringify({ applied: true })],
    );
    assert.deepEqual(await recordSelectedPlanCanonicalApplication(ctx.pool, {
      workspaceId: ctx.seed.workspaceId,
      actorId: ctx.seed.actorId,
      attemptId: first.attemptId,
      actionPlanId: planId,
      actionIntentId: firstId,
      commandNamespace,
      idempotencyKey: commandKey,
      source: { kind: 'EXTERNAL_PROVIDER', observationId },
    }), { ok: true });
    mustOk(await prepareSecond());
  });
});

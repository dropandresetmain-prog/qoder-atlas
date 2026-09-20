/**
 * Narrow observed-command bridge. The normal domain command still owns every
 * mutation and receipt. This wrapper adds provenance INSIDE that same command
 * transaction; it never adopts an unrelated existing entity/receipt.
 *
 * Checkpoint 2 implements the existing offer-selection canonical path and one
 * internal Journey-intent path. Stay book/cancel application is deliberately
 * unsupported until Checkpoint 3 supplies its own exact command validation.
 */
import type { UnitOfWork } from '../../contracts/v2/command/unitOfWork.ts';
import type { CommandReceipt, DomainCommandEnvelope } from '../../contracts/v2/command/domainCommand.ts';
import { ScenarioChangeSchema, type ScenarioEffect } from '../../contracts/v2/scenario/scenarioChange.ts';
import { typedConflict } from '../../domain/v2/shared/errors.ts';
import { compareExactMoney } from '../../domain/v2/shared/money.ts';
import { selectedEffectFingerprint, selectedPlanFingerprint, capabilityForSelectedEffect } from '../../resolution/execution/selectedPlanIdentity.ts';
import { currentTransactionClient } from '../../persistence/postgres/transactionContext.ts';
import type { ContinuationDb, ScopeChange } from '../../persistence/postgres/execution/selectedPlanContinuation.ts';
import { continuationAssert, ContinuationRefusal, decodeJson } from '../../persistence/postgres/execution/selectedPlanContinuation.ts';
import { resolveOfferExecutionInputs } from '../../persistence/postgres/execution/providerExecutionInputs.ts';
import { deterministicUuid, RUNTIME_ID_NAMESPACES } from './deterministicId.ts';

export interface SelectedPlanApplicationIdentity {
  workspaceId: string;
  actionIntentId: string;
  attemptId: string;
  source: { kind: 'EXTERNAL_PROVIDER'; observationId: string } | { kind: 'INTERNAL_COMMAND' };
}
interface Source {
  planId: string; strategyId: string; index: number; fingerprint: string; requestFingerprint: string;
  effect: ScenarioEffect;
}

async function loadSource(db: ContinuationDb, identity: SelectedPlanApplicationIdentity): Promise<Source> {
  const row = (await db.query<{
    action_plan_id: string; recovery_strategy_id: string; source_effect_index: number | null;
    source_effect_fingerprint: string | null; request_fingerprint: string; capability_ref: string;
    scenario_change: unknown; status: string; observation_fields: Record<string, unknown> | null;
  }>(`SELECT i.action_plan_id,p.recovery_strategy_id,i.source_effect_index,i.source_effect_fingerprint,
             i.request_fingerprint,i.capability_ref,s.scenario_change,a.status,o.source_owned_fields AS observation_fields
        FROM execution_attempts a JOIN action_intents i ON i.workspace_id=a.workspace_id AND i.id=a.action_intent_id
        JOIN action_plans p ON p.workspace_id=i.workspace_id AND p.id=i.action_plan_id
        JOIN recovery_strategies s ON s.workspace_id=p.workspace_id AND s.id=p.recovery_strategy_id
        LEFT JOIN execution_observations o ON o.workspace_id=a.workspace_id AND o.attempt_id=a.id
          AND o.action_intent_id=i.id AND o.id=$4 AND o.origin='EXTERNAL_PROVIDER'
       WHERE a.workspace_id=$1 AND a.id=$2 AND i.id=$3 AND a.request_fingerprint=i.request_fingerprint`,
  [identity.workspaceId, identity.attemptId, identity.actionIntentId,
    identity.source.kind === 'EXTERNAL_PROVIDER' ? identity.source.observationId : null])).rows[0];
  continuationAssert(row && row.source_effect_index !== null && row.source_effect_fingerprint,
    'SOURCE_EFFECTS_UNBOUND', 'No immutable effect mapping for this exact attempt and intent.');
  const scenario = ScenarioChangeSchema.parse(decodeJson(row.scenario_change));
  const effect = scenario.effects[row.source_effect_index];
  continuationAssert(effect && scenario.recoveryStrategyId === row.recovery_strategy_id
    && selectedEffectFingerprint(effect) === row.source_effect_fingerprint
    && capabilityForSelectedEffect(effect) === row.capability_ref,
  'SOURCE_EFFECT_MISMATCH', 'Attempt, strategy, capability and selected source effect differ.');
  const external = row.capability_ref.startsWith('external:');
  continuationAssert(external === (identity.source.kind === 'EXTERNAL_PROVIDER'), 'SOURCE_KIND_MISMATCH', 'An external effect cannot use internal-command evidence.');
  if (external) {
    continuationAssert(['OBSERVED_SUCCESS', 'COMPLETED', 'RECONCILED'].includes(row.status) && row.observation_fields,
      'PROVIDER_OUTCOME_UNKNOWN', 'Canonical application requires this attempt\'s known-success external observation.');
    // Only the already-accepted Atlas SELECT_OFFER handoff is implemented here.
    continuationAssert(effect.effectKind === 'SELECT_OFFER' && row.observation_fields.orderStatus === 'TICKETED'
      && typeof row.observation_fields.providerOrderRef === 'string' && row.observation_fields.providerOrderRef.length > 0,
    'CANONICAL_EFFECT_UNSUPPORTED', 'This bridge requires a ticketed selected-offer observation; stay execution is not implemented.');
  } else {
    continuationAssert(effect.effectKind === 'ALTER_JOURNEY_ITEM_INTENT'
      && ['PREPARED', 'CLAIMED', 'DISPATCHING', 'OBSERVED_SUCCESS', 'COMPLETED'].includes(row.status),
    'CANONICAL_EFFECT_UNSUPPORTED', 'Internal continuation evidence is limited to the exact Journey-intent command.');
  }
  return { planId: row.action_plan_id, strategyId: row.recovery_strategy_id, index: row.source_effect_index,
    fingerprint: row.source_effect_fingerprint, requestFingerprint: row.request_fingerprint, effect };
}

async function readScopes(db: ContinuationDb, workspaceId: string): Promise<Map<string, { kind: string; id: string; generation: number }>> {
  const rows = (await db.query<{ scope_kind: string; scope_id: string; generation: string }>(
    'SELECT scope_kind,scope_id,generation FROM scope_generations WHERE workspace_id=$1', [workspaceId])).rows;
  return new Map(rows.map((r) => [`${r.scope_kind}:${r.scope_id}`, { kind: r.scope_kind, id: r.scope_id, generation: Number(r.generation) }]));
}

/** Deterministic correlation identity already used by the accepted Atlas path. */
export function selectedOfferCanonicalId(intentId: string, part: string): string {
  return deterministicUuid(RUNTIME_ID_NAMESPACES.planning, `${intentId}|offer-select|${part}`);
}

export function selectedOfferCanonicalMode(mode: string): 'AIR' | 'RAIL' | 'ROAD' | 'SEA' {
  return mode === 'RAIL' || mode === 'ROAD' || mode === 'SEA' ? mode : 'AIR';
}

function record(value: unknown): Record<string, unknown> {
  continuationAssert(value !== null && typeof value === 'object' && !Array.isArray(value), 'CANONICAL_PAYLOAD_MISMATCH', 'Expected a typed canonical command payload.');
  return value as Record<string, unknown>;
}

async function validateCanonicalCommand(
  db: ContinuationDb, identity: SelectedPlanApplicationIdentity, source: Source,
  envelope: DomainCommandEnvelope, receipt: CommandReceipt,
): Promise<boolean> {
  continuationAssert(envelope.workspaceId === identity.workspaceId && receipt.workspaceId === identity.workspaceId
    && receipt.commandNamespace === envelope.commandType && receipt.idempotencyKey === envelope.idempotencyKey
    && receipt.payloadHash === envelope.canonicalPayloadHash && selectedPlanFingerprint(envelope.typedPayload) === receipt.payloadHash,
  'CANONICAL_RECEIPT_MISMATCH', 'Receipt does not belong to this actual canonical command.');
  const payload = record(envelope.typedPayload);
  const result = record(JSON.parse(receipt.resultRef));
  const effect = source.effect;
  if (effect.effectKind === 'ALTER_JOURNEY_ITEM_INTENT') {
    const item = (await db.query<{ journey_id: string }>('SELECT journey_id FROM journey_items WHERE workspace_id=$1 AND id=$2',
      [identity.workspaceId, effect.journeyItemId])).rows[0];
    continuationAssert(envelope.commandType === 'JOURNEY_ITEM_UPDATED'
      && selectedPlanFingerprint(payload) === selectedPlanFingerprint({ intendedWindow: effect.proposedWindow })
      && result.journeyItemId === effect.journeyItemId && result.journeyId === item?.journey_id,
    'CANONICAL_EFFECT_MISMATCH', 'Journey-intent command is not the exact selected effect.');
    return true;
  }
  continuationAssert(effect.effectKind === 'SELECT_OFFER', 'CANONICAL_EFFECT_UNSUPPORTED', 'No canonical stay behavior in this checkpoint.');
  const inputs = await resolveOfferExecutionInputs(db, identity.workspaceId, identity.actionIntentId);
  continuationAssert(inputs.ready, 'PROTECTED_INPUTS_UNAVAILABLE', inputs.ready ? '' : inputs.reason);
  const bound = inputs.binding;
  continuationAssert(bound.recoveryStrategyId === source.strategyId && bound.journeyItemId === effect.journeyItemId
    && bound.offerKey === effect.offerId && effect.offerPrice && effect.offerPrice.currency === bound.quotedCurrency
    && compareExactMoney(effect.offerPrice, { amount: bound.quotedAmount, currency: bound.quotedCurrency }) === 0,
  'APPROVED_TERMS_CHANGED', 'Current protected provider binding no longer matches approved selected terms.');
  const id = (part: string) => selectedOfferCanonicalId(identity.actionIntentId, part);
  const key = (part: string) => envelope.idempotencyKey === `offer-select:${identity.actionIntentId}:${part}`;
  let valid = false;
  switch (envelope.commandType) {
    case 'SOURCE_RECORDED':
      valid = key('source') && payload.sourceId === id('source') && result.sourceId === id('source')
        && payload.sourceIdentity === `provider-order:${bound.providerId}:${identity.actionIntentId}`;
      break;
    case 'EVIDENCE_RECORDED':
      valid = key('evidence') && payload.evidenceId === id('evidence') && result.evidenceId === id('evidence')
        && payload.assertionType === 'PROVIDER_ORDER_TICKETED'
        && selectedPlanFingerprint(payload.sourceIds) === selectedPlanFingerprint([id('source')])
        && selectedPlanFingerprint(payload.subjectRefs) === selectedPlanFingerprint([{ kind: 'JOURNEY_ITEM', id: effect.journeyItemId }]);
      break;
    case 'TRANSPORT_SERVICE_CREATED': {
      const dep = record(payload.publishedDeparture); const arr = record(payload.publishedArrival);
      valid = key('service') && payload.id === id('service') && result.id === id('service')
        && payload.originPlaceId === bound.itinerary.originPlaceId && payload.destinationPlaceId === bound.itinerary.destinationPlaceId
        && payload.operator === bound.itinerary.operator && payload.mode === selectedOfferCanonicalMode(bound.itinerary.mode)
        && dep.value === bound.itinerary.departure && arr.value === bound.itinerary.arrival
        && dep.sourceId === id('evidence') && arr.sourceId === id('evidence');
      break;
    }
    case 'RESERVATION_CREATED':
      valid = key('reservation') && payload.id === id('reservation') && result.id === id('reservation')
        && payload.observedStatus === 'CONFIRMED' && payload.responsibleTravellerId === inputs.passengers[0]?.travellerId;
      break;
    case 'RESERVATION_LINE_ADDED': {
      const line = record(payload.line); const detail = record(payload.detail);
      valid = key('line') && payload.reservationId === id('reservation') && line.id === id('line')
        && result.lineId === id('line') && line.observedStatus === 'CONFIRMED' && line.observationEvidenceId === id('evidence')
        && detail.productType === 'TRANSPORT' && detail.transportServiceId === id('service');
      break;
    }
    case 'RESERVATION_ALLOCATED': {
      const passenger = inputs.passengers.find((p) => p.travellerId === payload.travellerId);
      valid = Boolean(passenger) && key(`allocation:${String(payload.travellerId)}`)
        && payload.id === id(`allocation:${String(payload.travellerId)}`) && result.allocationId === payload.id
        && payload.reservationId === id('reservation') && payload.reservationLineId === id('line')
        && payload.journeyItemId === effect.journeyItemId && payload.quantity === 1;
      break;
    }
    case 'JOURNEY_ITEM_UPDATED':
      valid = key('select') && selectedPlanFingerprint(payload) === selectedPlanFingerprint({ selectedServiceId: id('service') })
        && result.journeyItemId === effect.journeyItemId && result.journeyId === bound.journeyId;
      break;
  }
  continuationAssert(valid, 'CANONICAL_EFFECT_MISMATCH', 'Canonical command identity/material fields do not implement this exact selected effect.');
  if (envelope.commandType === 'JOURNEY_ITEM_UPDATED') {
    // Completion is not inferred from a selected service merely existing. All
    // supporting canonical commands must themselves have the exact observation
    // bridge, including every allocation's scope changes.
    const requiredKeys = ['source', 'evidence', 'service', 'reservation', 'line',
      ...inputs.passengers.map((p) => `allocation:${p.travellerId}`)]
      .map((part) => `offer-select:${identity.actionIntentId}:${part}`);
    const applied = (await db.query<{ idempotency_key: string }>(
      `SELECT c.idempotency_key FROM selected_plan_canonical_applications c
       JOIN command_receipts r ON r.workspace_id=c.workspace_id AND r.command_namespace=c.command_namespace
         AND r.idempotency_key=c.idempotency_key AND r.payload_hash=c.receipt_payload_hash
       WHERE c.workspace_id=$1 AND c.attempt_id=$2 AND c.action_intent_id=$3
         AND c.source_observation_id=$4 AND c.source_effect_fingerprint=$5`,
      [identity.workspaceId, identity.attemptId, identity.actionIntentId,
        identity.source.kind === 'EXTERNAL_PROVIDER' ? identity.source.observationId : null, source.fingerprint])).rows;
    const keys = new Set(applied.map((r) => r.idempotency_key));
    continuationAssert(requiredKeys.every((key) => keys.has(key)), 'CANONICAL_APPLICATION_INCOMPLETE',
      'Supporting commands lack exact committed observation-to-receipt provenance.');
    return true;
  }
  return false;
}

/**
 * No callback/world/receipt can be supplied as execution authority. The wrapper
 * inspects the ACTUAL domain envelope and returned receipt, validates its closed
 * effect mapping, and records before/after PG scopes in that same transaction.
 */
export function selectedPlanApplicationUnitOfWork(inner: UnitOfWork, identity: SelectedPlanApplicationIdentity): UnitOfWork {
  return {
    heads: inner.heads, idempotency: inner.idempotency, scopes: inner.scopes,
    async execute(envelope, fn) {
      try {
        return await inner.execute(envelope, async (context) => {
          const db = currentTransactionClient();
          const source = await loadSource(db, identity);
          const before = await readScopes(db, identity.workspaceId);
          const outcome = await fn(context);
          if (!outcome.ok) return outcome;
          const complete = await validateCanonicalCommand(db, identity, source, envelope, outcome.receipt);
          const after = await readScopes(db, identity.workspaceId);
          const scopes: ScopeChange[] = [];
          for (const [key, value] of after) {
            const old = before.get(key)?.generation ?? 0;
            if (old !== value.generation) {
              continuationAssert(value.generation === old + 1, 'SCOPE_ACCOUNTING_INVALID', 'A command advanced a scope by more than one transaction.');
              scopes.push({ scopeKind: value.kind, scopeId: value.id, beforeGeneration: old, afterGeneration: value.generation });
            }
          }
          await db.query(
            `INSERT INTO selected_plan_canonical_applications
             (workspace_id,attempt_id,action_plan_id,action_intent_id,source_strategy_id,source_effect_index,
              source_effect_fingerprint,request_fingerprint,application_origin,source_observation_id,
              command_namespace,idempotency_key,receipt_payload_hash,completes_effect,scope_changes,created_by_actor_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16)`,
            [identity.workspaceId,identity.attemptId,source.planId,identity.actionIntentId,source.strategyId,source.index,
              source.fingerprint,source.requestFingerprint,identity.source.kind,
              identity.source.kind === 'EXTERNAL_PROVIDER' ? identity.source.observationId : null,
              envelope.commandType,envelope.idempotencyKey,outcome.receipt.payloadHash,complete,JSON.stringify(scopes.sort((a, b) => `${a.scopeKind}:${a.scopeId}`.localeCompare(`${b.scopeKind}:${b.scopeId}`))),envelope.actorPrincipalId]);
          return outcome;
        });
      } catch (error) {
        if (error instanceof ContinuationRefusal) return { ok: false, conflict: typedConflict('VALIDATION_FAILED', `${error.code}: ${error.message}`) };
        throw error;
      }
    },
  };
}

/**
 * R4-F2 — `external:offer.select` execution through the Atlas SANDBOX.
 *
 * Chain (nothing here is reachable from a planner or an LLM):
 *
 *   approved intent (stored decision + approval + HELD budget)
 *     -> resolveOfferExecutionInputs (PG protected inputs; else refuse, no attempt)
 *     -> createPreparedExecutionAttempt  (stored authority/currentness/budget gate;
 *                                         durable PREPARED row BEFORE any network)
 *     -> PgExecutionWorker.claim -> dispatchClaimed
 *          (CLAIMED -> DISPATCHING committed BEFORE the dispatcher runs)
 *     -> Atlas dispatcher: verify -> createOrder -> payment ceiling gate -> payOrder
 *          -> observe ticketing (read)
 *     -> OBSERVED_SUCCESS | OBSERVED_FAILURE | OUTCOME_UNKNOWN (classified)
 *     -> canonical update (transport service + reservation + selected service)
 *     -> M6 triggers -> reassessment -> C4 resolution.
 *
 * Safety properties (each proved by test/postgres-integration/r4AtlasOfferExecution):
 *  - One attempt per approved intent per pass; an intent with ANY prior attempt is
 *    never re-dispatched by this pass (no blind retry; a failed/unknown attempt
 *    stays visible until reconciled or re-approved under a new plan).
 *  - OUTCOME_UNKNOWN is resolved only by `runExternalReconciliation`, which uses
 *    read-only provider lookups keyed by the order reference persisted on the attempt.
 *  - Pay only when the provider-observed payable is within the authority-frozen
 *    ceiling (the intent's stored cost); the adapter re-checks independently.
 */
import type { Pool } from '../../persistence/postgres/pool.ts';
import type { PgUnitOfWork } from '../../persistence/postgres/pgUnitOfWork.ts';
import type { AdapterMode } from '../../contracts/envelope.ts';
import type { FlightCapability, FlightTransactionCapability } from '../../contracts/capabilities.ts';
import { createPreparedExecutionAttempt } from '../../persistence/postgres/commands/m8AuthorityCommands.ts';
import { PgExecutionWorker, type DispatchControl, type ExecutionClaim, type ExternalDispatcher, type ReconcileLookup } from '../../persistence/postgres/execution/pgExecutionWorker.ts';
import { loadStoredIntent } from '../../persistence/postgres/execution/storedExecutionGate.ts';
import { resolveOfferExecutionInputs, type OfferExecutionInputs } from '../../persistence/postgres/execution/providerExecutionInputs.ts';
import { recordSource, recordEvidence } from '../../persistence/postgres/commands/knowledgeCommands.ts';
import { createTransportService, createReservation, addReservationLine, allocateReservationLine } from '../../persistence/postgres/commands/arrangementCommands.ts';
import { updateJourneyItem } from '../../persistence/postgres/commands/travelCommands.ts';
import { PgAggregateHeadReader } from '../../persistence/postgres/pgAggregateHeadReader.ts';
import {
  createSelectedPlanContinuationCheckpoint,
  loadNextSelectedPlanIntents,
  recordSelectedPlanCanonicalApplication,
} from '../../persistence/postgres/execution/selectedPlanContinuation.ts';
import { createHash } from 'node:crypto';
import { deterministicUuid, RUNTIME_ID_NAMESPACES } from './deterministicId.ts';
import { ATLAS_SANDBOX_BALANCE_PAYMENT_REF, ATLAS_SANDBOX_HOST, AtlasFlightTransactionAdapter } from '../../providers/atlas/transactionAdapter.ts';
import {
  applySandboxPassengerAliasToPassengers,
  resolveAtlasSandboxPassengerAlias,
  sandboxPassengerAliasRefuseMessage,
  SANDBOX_TEST_ALIAS_PROVENANCE,
  type AtlasSandboxPassengerAliasConfig,
} from '../../providers/atlas/sandboxPassengerAlias.ts';
import { AtlasFlightAdapter } from '../../providers/atlas/adapter.ts';
import { createAppRecordingStore } from '../../providers/recordingStoreFactory.ts';
import { hasLiveCredentials, type AppConfig } from '../../config/config.ts';
import {
  DEMO_PLAYBACK_PLACEHOLDER_CREDENTIAL,
  DEMO_PLAYBACK_SANDBOX_BASE_URL,
  isDemoPlaybackActive,
} from '../../config/demoPlayback.ts';
import type { CapabilityStatement } from '../../resolution/planning/compiler.ts';
import { validateExistingOrder, type ExpectedOrderTerms } from './existingOrderValidation.ts';
import type { FlightOrderStatus } from '../../contracts/capabilities.ts';
import { tryAcquireWorkspaceOperationLease } from './workspaceOperationLease.ts';

export const EXTERNAL_OFFER_SELECT_CAPABILITY = 'external:offer.select';

/** The declared capability truth boot hands to approval when (and only when) this seam is composed. */
export const EXTERNAL_OFFER_SELECT_STATEMENTS: readonly CapabilityStatement[] = [
  { capabilityRef: EXTERNAL_OFFER_SELECT_CAPABILITY, supported: true },
];

export interface ExternalOfferExecutionDeps {
  flight: Pick<FlightCapability, 'verifyOffer'>;
  transactions: FlightTransactionCapability;
  mode: AdapterMode;
  /** Opaque sandbox payment handle. The adapter accepts only its approved sandbox handle. */
  paymentRef?: string;
  /**
   * Sandbox-only synthetic passenger names transmitted to Atlas. Stable for one
   * disposable execution world. Never canonical traveller truth.
   */
  sandboxPassengerAlias?: AtlasSandboxPassengerAliasConfig;
  ticketingPoll?: { attempts: number; delayMs: number };
  sleep?: (ms: number) => Promise<void>;
  /**
   * TEST-ONLY fault injection (never set by `composeOfferExecution`). Awaited at named points of
   * the dispatcher; a test simulates a process crash by returning a promise that never resolves,
   * then "restarts" by running the reconciliation sweep with fresh deps.
   */
  faultInjection?: (point: DispatchFaultPoint) => Promise<void>;
}

export type DispatchFaultPoint = 'AFTER_CREATE' | 'AFTER_CHECKPOINT' | 'AFTER_PAY' | 'BEFORE_FINAL_WRITE';

export interface ExternalExecutionContext {
  pool: Pool;
  workspaceId: string;
  actorPrincipalId: string;
  uow: () => PgUnitOfWork;
  executorPrincipalId: string;
  external: ExternalOfferExecutionDeps;
  now?: string;
}

export interface ExternalExecutionOutcome {
  intentId: string;
  attemptNumber: number;
  result: 'SUCCEEDED' | 'FAILED' | 'OUTCOME_UNKNOWN' | 'DEFERRED' | 'REFUSED';
  detail?: string;
}

export interface ExternalExecutionReport {
  at: string;
  candidates: number;
  executed: number;
  failed: number;
  unknown: number;
  deferred: number;
  refused: number;
  canonicalUpdates: number;
  /** Successful attempts whose canonical update has not landed yet (retried every pass; NOT an execution failure). */
  canonicalPending: { intentId: string; error: string }[];
  outcomes: ExternalExecutionOutcome[];
}

/** One complete external pass, including its read-only reconciliation. */
export interface ExternalExecutionCycleReport {
  report: ExternalExecutionReport;
  reconciliation: { reconciled: number; stillUnknown: number; canonicalUpdates: number };
  /** Another reset or provider cycle owns this workspace; no query or network work ran. */
  leaseUnavailable: boolean;
}

const SUCCESS = ['OBSERVED_SUCCESS', 'COMPLETED', 'RECONCILED'];

// ---------------------------------------------------------------------------
// Candidate selection (reconcile-from-state)
// ---------------------------------------------------------------------------

async function loadCandidates(pool: Pool, workspaceId: string): Promise<string[]> {
  const result = await pool.query<{ intent_id: string }>(
    `SELECT ai.id AS intent_id
       FROM action_intents ai
       JOIN action_plans ap ON ap.workspace_id = ai.workspace_id AND ap.id = ai.action_plan_id
       JOIN recovery_cases rc ON rc.workspace_id = ap.workspace_id AND rc.id = ap.recovery_case_id
      WHERE ai.workspace_id = $1
        AND ai.capability_ref = $2
        AND rc.lifecycle_status NOT IN ('RESOLVED', 'CLOSED', 'CANCELLED', 'SUPERSEDED')
        AND EXISTS (SELECT 1 FROM authority_decisions d JOIN approvals a ON a.workspace_id = d.workspace_id AND a.decision_id = d.id
                     WHERE d.workspace_id = ai.workspace_id AND d.action_intent_id = ai.id)
        -- No prior attempt except a never-claimed PREPARED one (no network happened yet):
        -- an attempted intent is never re-dispatched here.
        AND NOT EXISTS (SELECT 1 FROM execution_attempts ea WHERE ea.workspace_id = ai.workspace_id AND ea.action_intent_id = ai.id AND ea.status <> 'PREPARED')
        AND NOT EXISTS (
          SELECT 1 FROM action_dependencies d
           WHERE d.workspace_id = ai.workspace_id AND d.to_action_intent_id = ai.id
             AND NOT EXISTS (SELECT 1 FROM execution_attempts pe WHERE pe.workspace_id = d.workspace_id AND pe.action_intent_id = d.from_action_intent_id AND pe.status = ANY($3::text[])))
      ORDER BY ap.created_at, ai.created_at, ai.id`,
    [workspaceId, EXTERNAL_OFFER_SELECT_CAPABILITY, SUCCESS],
  );
  return result.rows.map((r) => r.intent_id);
}

// ---------------------------------------------------------------------------
// The Atlas dispatcher (the ONLY code that mutates at the provider)
// ---------------------------------------------------------------------------

const DEFAULT_POLL = { attempts: 6, delayMs: 1000 };
const ORDER_REF_PREFIX = 'atlas:order:';
const CLIENT_REF_PREFIX = 'atlas:clientref:';
/** A provider order the create pointed at (duplicate detection) that could not be proven to be this intent's: reference kept for humans, NEVER a reconcile key. */
const DUPLICATE_UNPROVEN_PREFIX = 'atlas:duplicate-unproven:';
const HOLD_EXPIRY_MARGIN_MS = 60_000;

/** execution_observations.external_record_id is a uuid: the provider order number maps to a stable uuid; the raw ref stays in source_owned_fields + request_ref. */
export function externalRecordIdForOrder(orderRef: string): string {
  return deterministicUuid(RUNTIME_ID_NAMESPACES.planning, `atlas-order|${orderRef}`);
}

export function clientReferenceFor(intentId: string): string {
  return `ns-${createHash('sha256').update(intentId).digest('hex').slice(0, 24)}`;
}

export function buildAtlasOfferDispatcher(
  deps: ExternalOfferExecutionDeps,
  inputs: Extract<OfferExecutionInputs, { ready: true }>,
  ceiling: { amount: number; currency: string },
  intentId: string,
  counters: { verify: number; create: number; pay: number },
  /** Approved terms an existing (duplicate) order must match. Absent => a duplicate can never be adopted. */
  expected?: ExpectedOrderTerms,
): ExternalDispatcher {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const poll = deps.ticketingPoll ?? DEFAULT_POLL;
  const clientReference = clientReferenceFor(intentId);
  const providerPassengers = deps.sandboxPassengerAlias
    ? applySandboxPassengerAliasToPassengers(inputs.passengers, deps.sandboxPassengerAlias)
    : inputs.passengers;
  return async (_claim: ExecutionClaim, control: DispatchControl) => {
    const fault = deps.faultInjection ?? (async () => undefined);
    if (!deps.paymentRef) return { kind: 'FAILURE', error: 'payment_handle_unavailable: no sandbox payment handle composed' };
    // 1. Read: verify the exact researched offer and obtain the provider session state.
    counters.verify += 1;
    const verify = await deps.flight.verifyOffer({ offerId: inputs.binding.providerOfferRef });
    if (!verify.ok) return { kind: 'FAILURE', error: `offer_verification_failed:${verify.error.category}/${verify.error.code}` };
    if (verify.data.status === 'UNAVAILABLE') return { kind: 'FAILURE', error: 'offer_unavailable' };
    if (verify.data.status === 'PRICE_CHANGED') return { kind: 'FAILURE', error: 'offer_price_changed: re-enter viability/authority' };

    // 2. Mutation #1: create the order (hold, no money moves).
    // Passenger names may be SANDBOX_TEST_ALIAS at the Atlas wire only; inputs.passengers stay canonical.
    counters.create += 1;
    const create = await deps.transactions.createOrder({
      offerId: inputs.binding.providerOfferRef,
      passengers: providerPassengers.map((p) => ({
        givenName: p.givenName, familyName: p.familyName, gender: p.gender,
        ...(p.dateOfBirth ? { dateOfBirth: p.dateOfBirth } : {}),
        ...(p.nationality ? { nationality: p.nationality } : {}),
      })),
      contact: { name: inputs.contactName, email: inputs.contactEmail },
      ...(verify.data.workflowState ? { workflowState: verify.data.workflowState } : {}),
      clientReference,
    });
    if (!create.ok) {
      // Ambiguous create => unknown, reconcile before anything else. Definitive => failure.
      // No order reference exists: nothing can be looked up (Atlas has no client-reference lookup;
      // see docs/work/r4-evidence/atlas-create-idempotency-decision.md) => human/provider reconciliation, never a retry.
      if (create.error.category === 'TIMEOUT') return { kind: 'LOST_RESPONSE', requestRef: `${CLIENT_REF_PREFIX}${clientReference}` };
      return { kind: 'FAILURE', error: `order_create_failed:${create.error.category}/${create.error.code}` };
    }
    let orderRef = create.data.transactionState?.orderRef;
    if (create.data.status === 'FAILED' || !orderRef) return { kind: 'FAILURE', error: create.data.detail ?? 'order_create_refused' };
    await fault('AFTER_CREATE');

    // 2a. N3: a duplicate-detection hit is a POINTER to some existing order, not proof it is this
    // intent's. Retrieve it read-only and prove it against the approved terms BEFORE adopting or paying.
    let payable = create.data.totalPrice;
    let adoptedState: FlightOrderStatus | undefined;
    if (create.data.duplicateOfExisting) {
      const refs = create.data.duplicateOfExisting.orderRefs;
      const unproven = (why: string): { kind: 'LOST_RESPONSE'; requestRef: string } => ({ kind: 'LOST_RESPONSE', requestRef: `${DUPLICATE_UNPROVEN_PREFIX}${refs.join(',')}:${why}` });
      if (refs.length !== 1) return unproven('ambiguous_multiple_existing_orders');
      if (!expected) return unproven('approved_terms_unavailable');
      const existing = await deps.transactions.retrieveOrder({ orderRef: refs[0]! });
      if (!existing.ok) return unproven('existing_order_unreadable');
      const verdict = validateExistingOrder(existing.data, expected);
      if (verdict.verdict === 'MISMATCH') return { kind: 'FAILURE', error: `duplicate_order_mismatch: existing order ${refs[0]} is not this intent's order (${verdict.reasons.join(',')}); not adopted, not paid` };
      if (verdict.verdict === 'INSUFFICIENT') return unproven(verdict.reasons.join('+'));
      orderRef = refs[0]!;
      adoptedState = verdict.orderStatus;
      payable = existing.data.totalPrice;
    }
    const orderMarker = `${ORDER_REF_PREFIX}${orderRef}`;

    // 2b. N1: the provider order now exists. Durably checkpoint its reference onto THIS attempt
    // BEFORE any pay call. If the write does not land we must not pay: the order stays HELD at the
    // provider and the attempt is reported unknown carrying the reference.
    if (!(await control.checkpointRequestRef(orderMarker))) return { kind: 'LOST_RESPONSE', requestRef: orderMarker };
    await fault('AFTER_CHECKPOINT');

    // An adopted (proven) existing order that is already beyond HELD needs no payment: observe only.
    if (adoptedState === undefined || adoptedState === 'HELD') {
      // 3. Ceiling gate: only pay a provider-observed payable within the authority-frozen ceiling.
      if (!payable) {
        const check = await deps.transactions.retrieveOrder({ orderRef, clientReference });
        if (check.ok && check.data.totalPrice) payable = check.data.totalPrice;
      }
      if (!payable) return { kind: 'FAILURE', error: `payable_total_missing: order ${orderRef} remains HELD` };
      if (payable.currency !== ceiling.currency) return { kind: 'FAILURE', error: `payable_currency_mismatch: order ${orderRef} remains HELD` };
      if (payable.amount > ceiling.amount) return { kind: 'FAILURE', error: `payable_exceeds_ceiling: order ${orderRef} remains HELD; re-enter authority with the observed price` };

      // 4. Mutation #2: pay the held order with the sandbox test-balance handle.
      counters.pay += 1;
      const pay = await deps.transactions.payOrder({
        orderRef, paymentRef: deps.paymentRef, authorisedAmount: { amount: ceiling.amount, currency: ceiling.currency }, clientReference,
      });
      if (!pay.ok) {
        if (pay.error.category === 'TIMEOUT' || pay.error.code === 'payment_in_progress') return { kind: 'LOST_RESPONSE', requestRef: orderMarker };
        return { kind: 'FAILURE', error: `order_pay_failed:${pay.error.category}/${pay.error.code}; order ${orderRef} remains HELD` };
      }
      if (pay.data.status === 'HELD' || pay.data.status === 'FAILED') return { kind: 'FAILURE', error: `payment_not_accepted; order ${orderRef} remains HELD` };
      await fault('AFTER_PAY');
    }

    // 5. Observe (read-only) until ticketed; otherwise the outcome is UNKNOWN, never assumed.
    for (let i = 0; i < poll.attempts; i += 1) {
      const seen = await deps.transactions.retrieveOrder({ orderRef, clientReference });
      if (seen.ok) {
        if (seen.data.status === 'TICKETED') {
          await fault('BEFORE_FINAL_WRITE');
          return {
            kind: 'SUCCESS', responseRef: orderMarker, externalRecordId: externalRecordIdForOrder(orderRef),
            sourceOwnedFields: {
              providerOrderRef: orderRef,
              orderStatus: 'TICKETED',
              ...(seen.data.totalPrice ? { totalPrice: seen.data.totalPrice } : {}),
              provenance: seen.data.provenance,
              ...(deps.sandboxPassengerAlias
                ? { passengerIdentityProvenance: SANDBOX_TEST_ALIAS_PROVENANCE }
                : {}),
            },
          };
        }
        if (seen.data.status === 'CANCELLED' || seen.data.status === 'FAILED') return { kind: 'FAILURE', error: `order_failed_after_payment:${seen.data.status}` };
      }
      if (i < poll.attempts - 1) await sleep(poll.delayMs);
    }
    return { kind: 'LOST_RESPONSE', requestRef: orderMarker };
  };
}

/**
 * The approved terms an existing order must match, resolved from persisted truth only (binding +
 * protected identities + place IATA refs/time zones). Undefined when any piece is missing: a
 * duplicate order then fails closed instead of being adopted.
 *
 * When a sandbox passenger alias is active, provider-facing passenger names in these terms match
 * what was transmitted to Atlas (SANDBOX_TEST_ALIAS) so retry/duplicate validation can MATCH an
 * order this intent created. Canonical traveller rows are not modified.
 */
export async function loadExpectedOrderTerms(
  pool: Pool,
  workspaceId: string,
  inputs: Extract<OfferExecutionInputs, { ready: true }>,
  ceiling: { amount: number; currency: string },
  sandboxPassengerAlias?: AtlasSandboxPassengerAliasConfig,
): Promise<ExpectedOrderTerms | undefined> {
  const b = inputs.binding;
  // Same airport-code vocabulary as transport research timezone resolution:
  // demo/dataset places commonly carry `airport-code`, not only `IATA`.
  const rows = (await pool.query<{ id: string; time_zone: string; code: string }>(
    `SELECT DISTINCT ON (p.id) p.id, p.time_zone, x.external_key AS code
       FROM places p
       JOIN place_external_refs x
         ON x.workspace_id = p.workspace_id AND x.place_id = p.id
        AND lower(x.provider_namespace) IN ('iata', 'airport-code')
      WHERE p.workspace_id = $1 AND p.id = ANY($2::uuid[])
      ORDER BY p.id, (lower(x.provider_namespace) = 'iata') DESC, x.external_key`,
    [workspaceId, [b.itinerary.originPlaceId, b.itinerary.destinationPlaceId]],
  )).rows;
  const origin = rows.find((r) => r.id === b.itinerary.originPlaceId);
  const destination = rows.find((r) => r.id === b.itinerary.destinationPlaceId);
  if (!origin || !destination) return undefined;
  const providerPassengers = sandboxPassengerAlias
    ? applySandboxPassengerAliasToPassengers(inputs.passengers, sandboxPassengerAlias)
    : inputs.passengers;
  return {
    passengers: providerPassengers.map((p) => ({
      givenName: p.givenName, familyName: p.familyName, gender: p.gender,
      ...(p.dateOfBirth ? { dateOfBirth: p.dateOfBirth } : {}), ...(p.nationality ? { nationality: p.nationality } : {}),
    })),
    contactEmail: inputs.contactEmail,
    origin: { code: origin.code, timeZone: origin.time_zone },
    destination: { code: destination.code, timeZone: destination.time_zone },
    departure: b.itinerary.departure, arrival: b.itinerary.arrival,
    ceiling, quoted: { amount: Number(b.quotedAmount), currency: b.quotedCurrency },
  };
}

/** Read-only reconciliation lookup keyed by the reference persisted on the attempt. */
export function buildAtlasReconcileLookup(pool: Pool, deps: ExternalOfferExecutionDeps): ReconcileLookup {
  return async (claim: ExecutionClaim) => {
    const row = (await pool.query<{ request_ref: string | null }>(
      'SELECT request_ref FROM execution_attempts WHERE workspace_id = $1 AND id = $2', [claim.workspaceId, claim.id],
    )).rows[0];
    const ref = row?.request_ref ?? '';
    // No provider order reference was ever obtained: nothing can be looked up. Stay unknown (human owner).
    if (!ref.startsWith(ORDER_REF_PREFIX)) return { kind: 'STILL_UNKNOWN' };
    const orderRef = ref.slice(ORDER_REF_PREFIX.length);
    const seen = await deps.transactions.retrieveOrder({ orderRef });
    if (!seen.ok) return { kind: 'STILL_UNKNOWN' };
    switch (seen.data.status) {
      case 'TICKETED':
        return { kind: 'FOUND_SUCCESS', responseRef: ref, externalRecordId: externalRecordIdForOrder(orderRef), sourceOwnedFields: { providerOrderRef: orderRef, orderStatus: 'TICKETED', reconciled: true } };
      case 'HELD': {
        // A single HELD reading cannot exclude a pay request that was in flight when the dispatcher
        // died (or timed out): HELD is a failure only once the hold has lapsed unpaid, so no payment
        // can land any more. Until then it stays unknown (never assumed either way).
        const expires = seen.data.transactionState?.holdExpiresAt;
        if (expires && Date.now() > Date.parse(expires) + HOLD_EXPIRY_MARGIN_MS) {
          return { kind: 'FOUND_FAILURE', responseRef: ref, error: `reconciled: order ${orderRef} is HELD and its hold expired unpaid` };
        }
        return { kind: 'STILL_UNKNOWN' };
      }
      case 'CANCELLED':
      case 'FAILED':
        return { kind: 'FOUND_FAILURE', responseRef: ref, error: `reconciled: order ${orderRef} is ${seen.data.status}` };
      default:
        return { kind: 'STILL_UNKNOWN' };
    }
  };
}

// ---------------------------------------------------------------------------
// Canonical update after an OBSERVED success (idempotent, no provider call)
// ---------------------------------------------------------------------------

const AIR_MODE: Record<string, 'AIR' | 'RAIL' | 'ROAD' | 'SEA'> = { FLIGHT: 'AIR', AIR: 'AIR', RAIL: 'RAIL', ROAD: 'ROAD', SEA: 'SEA' };

async function ensureAtlasCanonicalApplicationBridge(
  ctx: ExternalExecutionContext,
  intentId: string,
  selectKey: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ws = ctx.workspaceId;
  const bridge = await ctx.pool.query<{
    attempt_id: string; observation_id: string; action_plan_id: string; recovery_strategy_id: string | null;
  }>(
    `SELECT ea.id AS attempt_id, eo.id AS observation_id, ai.action_plan_id, ap.recovery_strategy_id
       FROM execution_attempts ea
       JOIN action_intents ai ON ai.workspace_id = ea.workspace_id AND ai.id = ea.action_intent_id
       JOIN action_plans ap ON ap.workspace_id = ai.workspace_id AND ap.id = ai.action_plan_id
       JOIN execution_observations eo ON eo.workspace_id = ea.workspace_id AND eo.attempt_id = ea.id
      WHERE ea.workspace_id = $1 AND ea.action_intent_id = $2
        AND ea.status = ANY($3::text[])
        AND eo.origin = 'EXTERNAL_PROVIDER'
      ORDER BY ea.created_at DESC, eo.observed_at DESC
      LIMIT 1`,
    [ws, intentId, SUCCESS],
  );
  const link = bridge.rows[0];
  if (!link) return { ok: false, error: 'canonical bridge: missing successful attempt/observation' };
  const receipt = await ctx.pool.query<{ command_namespace: string }>(
    `SELECT command_namespace FROM command_receipts
      WHERE workspace_id = $1 AND command_namespace = 'JOURNEY_ITEM_UPDATED' AND idempotency_key = $2`,
    [ws, selectKey],
  );
  if (!receipt.rows[0]) return { ok: false, error: 'canonical bridge: missing Journey selection receipt' };
  const recorded = await recordSelectedPlanCanonicalApplication(ctx.pool, {
    workspaceId: ws,
    actorId: ctx.actorPrincipalId,
    attemptId: link.attempt_id,
    actionPlanId: link.action_plan_id,
    actionIntentId: intentId,
    commandNamespace: receipt.rows[0].command_namespace,
    idempotencyKey: selectKey,
    source: { kind: 'EXTERNAL_PROVIDER', observationId: link.observation_id },
  });
  if (!recorded.ok) return { ok: false, error: `canonical bridge: ${recorded.reason}` };

  if (link.recovery_strategy_id) {
    const now = ctx.now ?? new Date().toISOString();
    const nextIntentIds = await loadNextSelectedPlanIntents(ctx.pool, ws, link.action_plan_id, intentId);
    for (const nextIntentId of nextIntentIds) {
      await createSelectedPlanContinuationCheckpoint(ctx.pool, {
        workspaceId: ws,
        actorId: ctx.actorPrincipalId,
        actionPlanId: link.action_plan_id,
        nextActionIntentId: nextIntentId,
        sourceStrategyId: link.recovery_strategy_id,
        now,
      });
    }
  }
  return { ok: true };
}

async function applyCanonicalSelection(
  ctx: ExternalExecutionContext, intentId: string, inputs: Extract<OfferExecutionInputs, { ready: true }>, observedAt: string,
): Promise<{ ok: true; already?: true } | { ok: false; error: string }> {
  const ws = ctx.workspaceId;
  const ns = RUNTIME_ID_NAMESPACES.planning;
  const id = (name: string) => deterministicUuid(ns, `${intentId}|offer-select|${name}`);
  const b = inputs.binding;
  const serviceId = id('service');
  const already = await ctx.pool.query('SELECT 1 FROM transport_item_details WHERE workspace_id = $1 AND journey_item_id = $2 AND selected_service_id = $3', [ws, b.journeyItemId, serviceId]);
  if ((already.rowCount ?? 0) > 0) {
    const bridged = await ensureAtlasCanonicalApplicationBridge(ctx, intentId, `offer-select:${intentId}:select`);
    if (!bridged.ok && !bridged.error.includes('missing successful attempt')) return bridged;
    return { ok: true, already: true };
  }
  const base = { workspaceId: ws, actorPrincipalId: ctx.actorPrincipalId };
  const uow = () => ctx.uow();

  const sourceId = id('source');
  const evidenceId = id('evidence');
  const src = await recordSource(uow(), {
    ...base, idempotencyKey: `offer-select:${intentId}:source`, sourceId,
    sourceIdentity: `provider-order:${b.providerId}:${intentId}`, receivedAt: observedAt,
    contentHash: createHash('sha256').update(`${intentId}|${observedAt}`).digest('hex'), contentType: 'application/json',
  });
  if (!src.ok) return { ok: false, error: `source: ${src.conflict.message}` };
  const ev = await recordEvidence(uow(), {
    ...base, idempotencyKey: `offer-select:${intentId}:evidence`, evidenceId, assertionType: 'PROVIDER_ORDER_TICKETED',
    observedAt, schemaVersion: '1', sourceIds: [sourceId], subjectRefs: [{ kind: 'JOURNEY_ITEM', id: b.journeyItemId }],
  });
  if (!ev.ok) return { ok: false, error: `evidence: ${ev.conflict.message}` };

  const observed = (value: string | null) => (value ? { value, observedAt: b.observedAt, sourceId: evidenceId } : undefined);
  const dep = observed(b.itinerary.departure);
  const arr = observed(b.itinerary.arrival);
  const svc = await createTransportService(uow(), {
    ...base, idempotencyKey: `offer-select:${intentId}:service`,
    service: {
      id: serviceId, mode: AIR_MODE[b.itinerary.mode] ?? 'AIR', operator: b.itinerary.operator,
      originPlaceId: b.itinerary.originPlaceId, destinationPlaceId: b.itinerary.destinationPlaceId,
      ...(dep ? { publishedDeparture: dep } : {}), ...(arr ? { publishedArrival: arr } : {}),
    },
    evidenceRefs: [evidenceId],
  });
  if (!svc.ok) return { ok: false, error: `service: ${svc.conflict.message}` };

  const reservationId = id('reservation');
  const lead = inputs.passengers[0]!;
  const res = await createReservation(uow(), {
    ...base, idempotencyKey: `offer-select:${intentId}:reservation`,
    reservation: { id: reservationId, reservationType: 'TRANSPORT', observedStatus: 'CONFIRMED', observedStatusAt: observedAt, responsibleTravellerId: lead.travellerId },
    evidenceRefs: [evidenceId],
  });
  if (!res.ok) return { ok: false, error: `reservation: ${res.conflict.message}` };
  const lineId = id('line');
  const line = await addReservationLine(uow(), {
    ...base, idempotencyKey: `offer-select:${intentId}:line`, reservationId, expectedRevision: res.value.revision,
    line: { id: lineId, productType: 'TRANSPORT', observedStatus: 'CONFIRMED', observedStatusAt: observedAt, transportServiceId: serviceId, observationEvidenceId: evidenceId },
    detail: { productType: 'TRANSPORT', transportServiceId: serviceId },
    evidenceRefs: [evidenceId],
  });
  if (!line.ok) return { ok: false, error: `line: ${line.conflict.message}` };
  let revision = line.value.reservationRevision;
  for (const passenger of inputs.passengers) {
    const allocated = await allocateReservationLine(uow(), {
      ...base, idempotencyKey: `offer-select:${intentId}:allocation:${passenger.travellerId}`, reservationId, expectedRevision: revision,
      allocation: { id: id(`allocation:${passenger.travellerId}`), reservationLineId: lineId, travellerId: passenger.travellerId, journeyItemId: b.journeyItemId, allocationRole: 'TRAVELLER', quantity: 1 },
      evidenceRefs: [evidenceId],
    });
    if (!allocated.ok) return { ok: false, error: `allocation: ${allocated.conflict.message}` };
    revision = allocated.value.reservationRevision;
  }

  const head = await new PgAggregateHeadReader(ctx.pool, ws).loadHead({ kind: 'JOURNEY', id: b.journeyId });
  if (!head) return { ok: false, error: 'journey head missing' };
  const selectKey = `offer-select:${intentId}:select`;
  const selected = await updateJourneyItem(uow(), {
    ...base, idempotencyKey: selectKey, journeyId: b.journeyId, journeyItemId: b.journeyItemId,
    expectedRevision: head.revision, selectedServiceId: serviceId, evidenceRefs: [evidenceId],
  });
  if (!selected.ok) return { ok: false, error: `select: ${selected.conflict.message}` };

  const bridged = await ensureAtlasCanonicalApplicationBridge(ctx, intentId, selectKey);
  if (!bridged.ok) return bridged;
  return { ok: true };
}

/** Successful attempts whose canonical update has not landed yet (safe to re-run: no provider call). */
async function applyPendingCanonicalUpdates(ctx: ExternalExecutionContext, report: ExternalExecutionReport): Promise<void> {
  const pending = await ctx.pool.query<{ intent_id: string; observed_at: Date }>(
    `SELECT ai.id AS intent_id, max(eo.observed_at) AS observed_at
       FROM action_intents ai
       JOIN execution_attempts ea ON ea.workspace_id = ai.workspace_id AND ea.action_intent_id = ai.id AND ea.status = ANY($3::text[])
       JOIN execution_observations eo ON eo.workspace_id = ea.workspace_id AND eo.attempt_id = ea.id
      WHERE ai.workspace_id = $1 AND ai.capability_ref = $2
      GROUP BY ai.id`,
    [ctx.workspaceId, EXTERNAL_OFFER_SELECT_CAPABILITY, SUCCESS],
  );
  for (const row of pending.rows) {
    const inputs = await resolveOfferExecutionInputs(ctx.pool, ctx.workspaceId, row.intent_id);
    if (!inputs.ready) continue;
    const applied = await applyCanonicalSelection(ctx, row.intent_id, inputs, row.observed_at.toISOString());
    if (applied.ok) { if (!applied.already) report.canonicalUpdates += 1; }
    else report.canonicalPending.push({ intentId: row.intent_id, error: applied.error });
  }
}

// ---------------------------------------------------------------------------
// Passes
// ---------------------------------------------------------------------------

function emptyReport(now: string): ExternalExecutionReport {
  return { at: now, candidates: 0, executed: 0, failed: 0, unknown: 0, deferred: 0, refused: 0, canonicalUpdates: 0, canonicalPending: [], outcomes: [] };
}

export interface ExternalDispatchCounters { verify: number; create: number; pay: number }

export async function runExternalOfferExecutionPass(ctx: ExternalExecutionContext): Promise<ExternalExecutionReport> {
  const now = ctx.now ?? new Date().toISOString();
  const report = emptyReport(now);
  const worker = new PgExecutionWorker(ctx.pool, { actorId: `northstar-external-execution:${ctx.workspaceId}` });
  const candidates = await loadCandidates(ctx.pool, ctx.workspaceId);
  report.candidates = candidates.length;
  for (const intentId of candidates) {
    const outcome: ExternalExecutionOutcome = { intentId, attemptNumber: 1, result: 'REFUSED' };
    report.outcomes.push(outcome);
    // N4: an executor that is not LIVE/RECORD never mutates (no attempt, no network).
    if (ctx.external.mode !== 'LIVE' && ctx.external.mode !== 'RECORD') { outcome.detail = `EXECUTOR_MODE_NOT_LIVE: executor runs in ${ctx.external.mode}; provider mutation needs LIVE or RECORD`; report.refused += 1; continue; }
    // 1. Protected inputs: refuse (NO attempt row, NO network) when they cannot support execution.
    const inputs = await resolveOfferExecutionInputs(ctx.pool, ctx.workspaceId, intentId);
    if (!inputs.ready) { outcome.detail = `${inputs.reason}: ${inputs.detail}`; report.refused += 1; continue; }
    const stored = await loadStoredIntent(ctx.pool, ctx.workspaceId, intentId);
    if (!stored?.costAmount || !stored.costCurrency) { outcome.detail = 'CEILING_MISSING: intent carries no authority-frozen cost'; report.refused += 1; continue; }
    // 2. Stored gate + durable PREPARED attempt, written before any network.
    const leftover = (await ctx.pool.query<{ id: string }>(
      `SELECT id FROM execution_attempts WHERE workspace_id = $1 AND action_intent_id = $2 AND status = 'PREPARED' ORDER BY created_at LIMIT 1`,
      [ctx.workspaceId, intentId],
    )).rows[0];
    let attemptId = leftover?.id;
    if (!attemptId) {
      const prepared = await createPreparedExecutionAttempt(ctx.uow(), {
        workspaceId: ctx.workspaceId, actorPrincipalId: ctx.actorPrincipalId, idempotencyKey: `external-execution:${intentId}:1:prepare`,
        planId: stored.actionPlanId, intentId, attemptNumber: 1, principalId: ctx.executorPrincipalId, now,
      });
      if (!prepared.ok) {
        outcome.detail = `${prepared.conflict.kind}: ${prepared.conflict.message}`;
        if (prepared.conflict.message.includes('ASSESSMENT_NOT_CURRENT')) { outcome.result = 'DEFERRED'; report.deferred += 1; } else { report.refused += 1; }
        continue;
      }
      if (prepared.value.replayed) { outcome.result = 'DEFERRED'; outcome.detail = 'replayed known attempt'; report.deferred += 1; continue; }
      attemptId = prepared.value.attemptId;
    }
    // 3. Claim exactly this attempt and dispatch (DISPATCHING is committed before the dispatcher runs).
    const claim = await worker.claimPrepared(ctx.workspaceId, attemptId);
    if (!claim) { outcome.result = 'DEFERRED'; outcome.detail = 'attempt not claimable'; report.deferred += 1; continue; }
    const counters: ExternalDispatchCounters = { verify: 0, create: 0, pay: 0 };
    const ceiling = { amount: Number(stored.costAmount), currency: stored.costCurrency };
    const expected = await loadExpectedOrderTerms(
      ctx.pool, ctx.workspaceId, inputs, ceiling, ctx.external.sandboxPassengerAlias,
    );
    const dispatcher = buildAtlasOfferDispatcher(ctx.external, inputs, ceiling, intentId, counters, expected);
    const dispatched = await worker.dispatchClaimed(claim, {
      principalId: ctx.executorPrincipalId, now, observed: { capabilityKind: 'SERVICE', supported: true } /* external:offer.select maps to SERVICE in externalCapabilityKindFromRef */, dispatcher,
    });
    outcome.detail = dispatched.detail;
    if (dispatched.outcome === 'OBSERVED_SUCCESS') {
      outcome.result = 'SUCCEEDED'; report.executed += 1;
    } else if (dispatched.outcome === 'OUTCOME_UNKNOWN') {
      outcome.result = 'OUTCOME_UNKNOWN'; report.unknown += 1;
    } else if (dispatched.outcome === 'OBSERVED_FAILURE' || dispatched.outcome === 'FAILED') {
      outcome.result = 'FAILED'; report.failed += 1;
    } else {
      outcome.result = 'DEFERRED'; report.deferred += 1;
    }
  }
  await applyPendingCanonicalUpdates(ctx, report);
  return report;
}

/** Read-only provider lookups for unknown outcomes; never dispatches. */
export async function runExternalReconciliation(ctx: ExternalExecutionContext): Promise<{ reconciled: number; stillUnknown: number; canonicalUpdates: number }> {
  const worker = new PgExecutionWorker(ctx.pool, { actorId: `northstar-external-reconcile:${ctx.workspaceId}` });
  const lookup = buildAtlasReconcileLookup(ctx.pool, ctx.external);
  const unknown = await ctx.pool.query<{ id: string }>(
    `SELECT ea.id FROM execution_attempts ea JOIN action_intents ai ON ai.workspace_id = ea.workspace_id AND ai.id = ea.action_intent_id
      WHERE ea.workspace_id = $1 AND ai.capability_ref = $2
        AND (ea.status IN ('OUTCOME_UNKNOWN', 'RECONCILIATION_REQUIRED')
             -- N1: a DISPATCHING/DISPATCHED attempt whose dispatcher lease lapsed (crashed/abandoned) can
             -- only ever be reconciled read-only; it is never dispatch-eligible again.
             OR (ea.status IN ('DISPATCHING', 'DISPATCHED') AND (ea.lease_expires_at IS NULL OR ea.lease_expires_at < now())))
      ORDER BY ea.created_at`,
    [ctx.workspaceId, EXTERNAL_OFFER_SELECT_CAPABILITY],
  );
  let reconciled = 0;
  let stillUnknown = 0;
  for (const row of unknown.rows) {
    const claim = await worker.claimForReconciliation(ctx.workspaceId, row.id);
    if (!claim) continue;
    const result = await worker.reconcileUnknown(claim, lookup);
    if (result.outcome === 'OBSERVED_SUCCESS' || result.outcome === 'OBSERVED_FAILURE') reconciled += 1; else stillUnknown += 1;
  }
  const report = emptyReport(ctx.now ?? new Date().toISOString());
  await applyPendingCanonicalUpdates(ctx, report);
  return { reconciled, stillUnknown, canonicalUpdates: report.canonicalUpdates };
}

/**
 * Serializes the entire provider dispatch/reconciliation/canonical-update
 * cycle with demo reset for one workspace. The advisory lock is session-held;
 * individual DB operations remain short transactions and provider calls never
 * run inside a transaction.
 */
export async function runExternalExecutionCycle(ctx: ExternalExecutionContext): Promise<ExternalExecutionCycleReport> {
  const lease = await tryAcquireWorkspaceOperationLease(ctx.pool, ctx.workspaceId);
  const at = ctx.now ?? new Date().toISOString();
  if (!lease) {
    return {
      report: emptyReport(at),
      reconciliation: { reconciled: 0, stillUnknown: 0, canonicalUpdates: 0 },
      leaseUnavailable: true,
    };
  }
  try {
    const report = await runExternalOfferExecutionPass(ctx);
    const reconciliation = await runExternalReconciliation(ctx);
    return { report, reconciliation, leaseUnavailable: false };
  } finally {
    await lease.release();
  }
}

export { ATLAS_SANDBOX_BALANCE_PAYMENT_REF };

// ---------------------------------------------------------------------------
// Boot composition: honest or absent (never a fabricated capability)
// ---------------------------------------------------------------------------

/**
 * Compose the Atlas SANDBOX execution seam from the shared provider config.
 *
 * Composed ONLY when (a) ADAPTER_MODE is LIVE or RECORD (REPLAY makes no
 * provider call and cannot prove a mutation, so it is never advertised as
 * executable), (b) Atlas credentials are present, and (c) the base URL is the
 * Atlas sandbox host. Otherwise `undefined`: approval then refuses transport
 * options with the explicit `EXTERNAL_EXECUTION_NOT_COMPOSED` reason.
 * RECORD persists sanitized provider results under the recordings dir so REPLAY
 * keeps a fallback corpus.
 */
function composeOfferExecutionDemoPlayback(config: AppConfig, cwd: string): ExternalOfferExecutionDeps {
  const store = createAppRecordingStore({
    recordingsDir: config.recordingsDir,
    fixturesDir: config.fixturesDir,
    cwd,
    adapterMode: 'REPLAY',
  });
  const baseUrl = config.providers.atlas.baseUrl ?? DEMO_PLAYBACK_SANDBOX_BASE_URL;
  const common = {
    mode: 'REPLAY' as const,
    store,
    baseUrl,
    clientId: config.providers.atlas.clientId ?? DEMO_PLAYBACK_PLACEHOLDER_CREDENTIAL,
    clientSecret: config.providers.atlas.clientSecret ?? DEMO_PLAYBACK_PLACEHOLDER_CREDENTIAL,
  };
  const aliasResolution = resolveAtlasSandboxPassengerAlias({
    configured: config.providers.atlas.sandboxPassengerAlias,
    baseUrl,
    mode: 'REPLAY',
  });
  const alias =
    aliasResolution.status === 'APPLIED' ? aliasResolution.alias : undefined;
  const speed = config.demoPlaybackSpeed > 0 ? config.demoPlaybackSpeed : 1;
  const ticketingDelayMs = Math.max(500, Math.round(1000 / speed));
  return {
    flight: new AtlasFlightAdapter(common),
    transactions: new AtlasFlightTransactionAdapter({
      ...common,
      ...(alias ? { sandboxPassengerAlias: alias } : {}),
    }),
    mode: 'REPLAY',
    paymentRef: ATLAS_SANDBOX_BALANCE_PAYMENT_REF,
    ...(alias ? { sandboxPassengerAlias: alias } : {}),
    ticketingPoll: { attempts: 7, delayMs: ticketingDelayMs },
  };
}

export function composeOfferExecution(config: AppConfig, cwd: string): ExternalOfferExecutionDeps | undefined {
  if (config.adapterMode === 'REPLAY') {
    return isDemoPlaybackActive(config) ? composeOfferExecutionDemoPlayback(config, cwd) : undefined;
  }
  const atlas = config.providers.atlas;
  if (!hasLiveCredentials(config, 'atlas') || !atlas.baseUrl) return undefined;
  let host: string;
  try { host = new URL(atlas.baseUrl).hostname; } catch { return undefined; }
  if (host !== ATLAS_SANDBOX_HOST) {
    // Alias against production/unknown must fail closed — never silently omit.
    if (atlas.sandboxPassengerAlias) {
      throw new Error(sandboxPassengerAliasRefuseMessage('non_sandbox_host'));
    }
    return undefined;
  }
  const aliasResolution = resolveAtlasSandboxPassengerAlias({
    configured: atlas.sandboxPassengerAlias,
    baseUrl: atlas.baseUrl,
    mode: config.adapterMode,
  });
  if (aliasResolution.status === 'REFUSED') {
    throw new Error(sandboxPassengerAliasRefuseMessage(aliasResolution.reason));
  }
  const store = createAppRecordingStore({
    recordingsDir: config.recordingsDir,
    fixturesDir: config.fixturesDir,
    cwd,
    adapterMode: config.adapterMode,
  });
  const common = {
    mode: config.adapterMode,
    store,
    baseUrl: atlas.baseUrl,
    clientId: atlas.clientId,
    clientSecret: atlas.clientSecret,
  };
  const alias =
    aliasResolution.status === 'APPLIED' ? aliasResolution.alias : undefined;
  return {
    flight: new AtlasFlightAdapter(common),
    transactions: new AtlasFlightTransactionAdapter({
      ...common,
      ...(alias ? { sandboxPassengerAlias: alias } : {}),
    }),
    mode: config.adapterMode,
    paymentRef: ATLAS_SANDBOX_BALANCE_PAYMENT_REF,
    ...(alias ? { sandboxPassengerAlias: alias } : {}),
  };
}

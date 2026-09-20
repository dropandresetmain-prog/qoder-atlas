/**
 * Protected Nuitée stay dispatch for `external:stay.book` / `external:stay.cancel`.
 *
 * Provider outcome and canonical application are separate passes. Unknown outcomes
 * reconcile by lookup only — never redispatch. Successors require exact canonical
 * application under the CP2 selected-plan bridge.
 */
import { createHash } from 'node:crypto';
import type { Pool } from '../../persistence/postgres/pool.ts';
import type { PgUnitOfWork } from '../../persistence/postgres/pgUnitOfWork.ts';
import type { AdapterMode } from '../../contracts/envelope.ts';
import type { HotelBookingStatusView, HotelCapability } from '../../contracts/capabilities.ts';
import { createPreparedExecutionAttempt } from '../../persistence/postgres/commands/m8AuthorityCommands.ts';
import {
  PgExecutionWorker,
  type ExternalDispatcher,
  type ReconcileLookup,
} from '../../persistence/postgres/execution/pgExecutionWorker.ts';
import { loadStoredIntent } from '../../persistence/postgres/execution/storedExecutionGate.ts';
import {
  resolveStayExecutionInputs,
  type StayExecutionBinding,
  type StayExecutionInputs,
} from '../../persistence/postgres/execution/stayExecutionInputs.ts';
import { tryAcquireWorkspaceOperationLease } from './workspaceOperationLease.ts';
import { recordSource, recordEvidence } from '../../persistence/postgres/commands/knowledgeCommands.ts';
import { observeExternalRecord } from '../../persistence/postgres/commands/arrangementCommands.ts';
import { attachObservedStay } from '../../persistence/postgres/commands/observedStayCommands.ts';
import { applyObservedStayCancellation } from '../../persistence/postgres/commands/observedStayCancellationCommands.ts';
import { PgAggregateHeadReader } from '../../persistence/postgres/pgAggregateHeadReader.ts';
import {
  createSelectedPlanContinuationCheckpoint,
  loadNextSelectedPlanIntents,
} from '../../persistence/postgres/execution/selectedPlanContinuation.ts';
import { hasLiveCredentials, type AppConfig } from '../../config/config.ts';
import { NuiteeAdapter } from '../../providers/hotel/nuiteeAdapter.ts';
import { FileRecordingStore } from '../../providers/recordingStore.ts';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { CapabilityStatement } from '../../resolution/planning/compiler.ts';

export const EXTERNAL_STAY_BOOK_CAPABILITY = 'external:stay.book';
export const EXTERNAL_STAY_CANCEL_CAPABILITY = 'external:stay.cancel';

export const EXTERNAL_STAY_CAPABILITY_STATEMENTS: readonly CapabilityStatement[] = [
  { capabilityRef: EXTERNAL_STAY_BOOK_CAPABILITY, supported: true },
  { capabilityRef: EXTERNAL_STAY_CANCEL_CAPABILITY, supported: true },
];

const SUCCESS = ['OBSERVED_SUCCESS', 'COMPLETED', 'RECONCILED'];
const STAY_CAPS = [EXTERNAL_STAY_BOOK_CAPABILITY, EXTERNAL_STAY_CANCEL_CAPABILITY];

const refFor = (intentId: string) =>
  `ns-stay-${createHash('sha256').update(intentId).digest('hex').slice(0, 24)}`;

const recordId = (value: string) => {
  const h = createHash('sha256').update(`nuitee-stay|${value}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

export interface ExternalStayExecutionDeps {
  hotel: Pick<
    HotelCapability,
    'quoteRate' | 'bookStay' | 'retrieveBooking' | 'findBookingsByClientReference' | 'cancelStay'
  >;
  mode: AdapterMode;
  paymentRef?: string;
}

export interface ExternalStayExecutionContext {
  pool: Pool;
  workspaceId: string;
  actorPrincipalId: string;
  executorPrincipalId: string;
  uow: () => PgUnitOfWork;
  external: ExternalStayExecutionDeps;
  now?: string;
}

export interface ExternalStayExecutionReport {
  at: string;
  candidates: number;
  executed: number;
  failed: number;
  unknown: number;
  refused: number;
  deferred: number;
  outcomes: { intentId: string; result: string; detail?: string }[];
  canonicalPending: { intentId: string; error: string }[];
  canonicalUpdates: number;
}

function emptyReport(at: string): ExternalStayExecutionReport {
  return {
    at,
    candidates: 0,
    executed: 0,
    failed: 0,
    unknown: 0,
    refused: 0,
    deferred: 0,
    outcomes: [],
    canonicalPending: [],
    canonicalUpdates: 0,
  };
}

/** Date prefix YYYY-MM-DD for window comparison when provider returns date-only. */
function datePrefix(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Material match of an observed booking against the approved binding.
 * Returns ok when every represented provider field matches; fail-closed when a
 * required approved term cannot be verified from provider-returned fields.
 */
export function matchApprovedStayBooking(
  binding: StayExecutionBinding,
  observed: HotelBookingStatusView,
  options: { clientReference?: string; expectedAmount?: number; expectedCurrency?: string } = {},
): { ok: true } | { ok: false; reason: string } {
  if (observed.status !== 'CONFIRMED') {
    return { ok: false, reason: `status_${observed.status}` };
  }
  if (binding.providerPropertyId) {
    if (!observed.propertyId) {
      return { ok: false, reason: 'property_identity_unverifiable' };
    }
    if (observed.propertyId !== binding.providerPropertyId) {
      return { ok: false, reason: 'property_identity_mismatch' };
    }
  }
  if (binding.stayWindow) {
    const expectedStart = datePrefix(binding.stayWindow.start);
    const expectedEnd = datePrefix(binding.stayWindow.end);
    const seenStart = observed.checkInDate ?? (observed.checkIn ? datePrefix(observed.checkIn) : undefined);
    const seenEnd = observed.checkOutDate ?? (observed.checkOut ? datePrefix(observed.checkOut) : undefined);
    if (!seenStart || !seenEnd) {
      return { ok: false, reason: 'stay_window_unverifiable' };
    }
    if (seenStart !== expectedStart || seenEnd !== expectedEnd) {
      return { ok: false, reason: 'stay_window_mismatch' };
    }
  }
  const expectedCurrency = options.expectedCurrency ?? binding.quotedCurrency;
  const expectedAmount = options.expectedAmount ?? (binding.quotedAmount != null ? Number(binding.quotedAmount) : undefined);
  if (expectedCurrency && expectedAmount != null) {
    if (!observed.totalPrice) {
      return { ok: false, reason: 'amount_unverifiable' };
    }
    if (
      observed.totalPrice.currency !== expectedCurrency
      || observed.totalPrice.amount !== expectedAmount
    ) {
      return { ok: false, reason: 'amount_mismatch' };
    }
  }
  if (options.clientReference) {
    if (!observed.clientReference) {
      return { ok: false, reason: 'client_reference_unverifiable' };
    }
    if (observed.clientReference !== options.clientReference) {
      return { ok: false, reason: 'client_reference_mismatch' };
    }
  }
  return { ok: true };
}

async function loadCandidates(pool: Pool, workspaceId: string): Promise<string[]> {
  // Dependency readiness mirrors m8: external prerequisites need canonical application.
  const result = await pool.query<{ id: string }>(
    `SELECT ai.id
       FROM action_intents ai
       JOIN action_plans ap ON ap.workspace_id = ai.workspace_id AND ap.id = ai.action_plan_id
       JOIN recovery_cases rc ON rc.workspace_id = ap.workspace_id AND rc.id = ap.recovery_case_id
      WHERE ai.workspace_id = $1
        AND ai.capability_ref = ANY($2::text[])
        AND rc.lifecycle_status NOT IN ('RESOLVED', 'CLOSED', 'CANCELLED', 'SUPERSEDED')
        AND EXISTS (
          SELECT 1 FROM authority_decisions d
          JOIN approvals a ON a.workspace_id = d.workspace_id AND a.decision_id = d.id
           WHERE d.workspace_id = ai.workspace_id AND d.action_intent_id = ai.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM execution_attempts ea
           WHERE ea.workspace_id = ai.workspace_id
             AND ea.action_intent_id = ai.id
             AND ea.status <> 'PREPARED'
        )
        AND NOT EXISTS (
          SELECT 1 FROM action_dependencies d
           WHERE d.workspace_id = ai.workspace_id
             AND d.to_action_intent_id = ai.id
             AND NOT EXISTS (
               SELECT 1 FROM execution_attempts ea
                WHERE ea.workspace_id = d.workspace_id
                  AND ea.action_intent_id = d.from_action_intent_id
                  AND ea.status = ANY($3::text[])
                  AND (
                    EXISTS (
                      SELECT 1 FROM action_intents prerequisite_intent
                       WHERE prerequisite_intent.workspace_id = d.workspace_id
                         AND prerequisite_intent.id = d.from_action_intent_id
                         AND prerequisite_intent.capability_ref NOT LIKE 'external:%'
                    )
                    OR EXISTS (
                      SELECT 1 FROM selected_plan_canonical_applications application
                      JOIN command_receipts canonical_receipt
                        ON canonical_receipt.workspace_id = application.workspace_id
                       AND canonical_receipt.command_namespace = application.command_namespace
                       AND canonical_receipt.idempotency_key = application.idempotency_key
                       WHERE application.workspace_id = d.workspace_id
                         AND application.attempt_id = ea.id
                    )
                  )
             )
        )
      ORDER BY ap.created_at, ai.created_at`,
    [workspaceId, STAY_CAPS, SUCCESS],
  );
  return result.rows.map((r) => r.id);
}

export function buildNuiteeStayDispatcher(
  hotel: ExternalStayExecutionDeps['hotel'],
  inputs: Extract<StayExecutionInputs, { ready: true }>,
  ceiling: { amount: number; currency: string },
  intentId: string,
  paymentRef?: string,
): ExternalDispatcher {
  return async (_claim, control) => {
    const b = inputs.binding;
    const clientReference = refFor(intentId);

    if (b.action === 'CANCEL') {
      if (!b.stayElementId) return { kind: 'FAILURE', error: 'stay_element_missing' };
      const cancelRef = `nuitee:cancel:${b.stayElementId}`;
      if (!(await control.checkpointRequestRef(cancelRef))) {
        return { kind: 'LOST_RESPONSE', requestRef: cancelRef };
      }
      const cancelled = await hotel.cancelStay({ stayElementId: b.stayElementId });
      if (!cancelled.ok) {
        return cancelled.error.category === 'TIMEOUT'
          ? { kind: 'LOST_RESPONSE', requestRef: cancelRef }
          : { kind: 'FAILURE', error: `stay_cancel_failed:${cancelled.error.category}/${cancelled.error.code}` };
      }
      if (!cancelled.data.confirmed) return { kind: 'FAILURE', error: 'stay_cancel_not_confirmed' };
      const seen = await hotel.retrieveBooking({ bookingId: b.stayElementId });
      if (!seen.ok || seen.data.status !== 'CANCELLED') {
        return { kind: 'LOST_RESPONSE', requestRef: cancelRef };
      }
      return {
        kind: 'SUCCESS',
        responseRef: cancelRef,
        externalRecordId: recordId(b.stayElementId),
        sourceOwnedFields: { bookingId: b.stayElementId, status: 'CANCELLED', provider: 'nuitee' },
      };
    }

    if (!b.quoteHandle || !b.providerRateId || !b.quotedAmount || !b.quotedCurrency) {
      return { kind: 'FAILURE', error: 'approved_stay_terms_missing' };
    }

    const refreshed = await hotel.quoteRate({
      rateId: b.providerRateId,
      ...(b.workflowState ? { workflowState: b.workflowState } : {}),
    });
    if (!refreshed.ok) {
      return {
        kind: 'FAILURE',
        error: `stay_quote_refresh_failed:${refreshed.error.category}/${refreshed.error.code}`,
      };
    }
    if (
      refreshed.data.status !== 'QUOTED'
      || !refreshed.data.quoteId
      || !refreshed.data.quotedPrice
      || refreshed.data.quotedPrice.amount !== Number(b.quotedAmount)
      || refreshed.data.quotedPrice.currency !== b.quotedCurrency
    ) {
      return { kind: 'FAILURE', error: 'stay_quote_changed: re-enter authority' };
    }
    if (
      refreshed.data.quotedPrice.currency !== ceiling.currency
      || refreshed.data.quotedPrice.amount > ceiling.amount
    ) {
      return { kind: 'FAILURE', error: 'stay_quote_exceeds_authority_ceiling' };
    }

    const clientRefKey = `nuitee:clientref:${clientReference}`;
    if (!(await control.checkpointRequestRef(clientRefKey))) {
      return { kind: 'LOST_RESPONSE', requestRef: clientRefKey };
    }

    const booked = await hotel.bookStay({
      quoteId: refreshed.data.quoteId,
      guestNames: inputs.guestNames,
      clientReference,
      ...(paymentRef ? { paymentRef } : {}),
    });
    if (!booked.ok) {
      return booked.error.category === 'TIMEOUT'
        ? { kind: 'LOST_RESPONSE', requestRef: clientRefKey }
        : { kind: 'FAILURE', error: `stay_book_failed:${booked.error.category}/${booked.error.code}` };
    }
    if (!booked.data.confirmed || !booked.data.bookingId) {
      return { kind: 'FAILURE', error: 'stay_book_not_confirmed' };
    }

    // Known external side effect: booking confirmed. Term mismatch must NOT be
    // ordinary FAILURE (would hide the side effect / invite blind retry).
    // Preserve request_ref and route via OUTCOME_UNKNOWN → reconcile.
    const priceOk =
      booked.data.totalPrice
      && booked.data.totalPrice.amount === Number(b.quotedAmount)
      && booked.data.totalPrice.currency === b.quotedCurrency;
    if (!priceOk) {
      return { kind: 'LOST_RESPONSE', requestRef: clientRefKey };
    }

    const seen = await hotel.retrieveBooking({ bookingId: booked.data.bookingId });
    if (!seen.ok) {
      return { kind: 'LOST_RESPONSE', requestRef: clientRefKey };
    }
    const matched = matchApprovedStayBooking(b, seen.data, {
      clientReference,
      expectedAmount: Number(b.quotedAmount),
      expectedCurrency: b.quotedCurrency,
    });
    if (!matched.ok) {
      return { kind: 'LOST_RESPONSE', requestRef: clientRefKey };
    }

    return {
      kind: 'SUCCESS',
      responseRef: `nuitee:booking:${booked.data.bookingId}`,
      externalRecordId: recordId(booked.data.bookingId),
      sourceOwnedFields: {
        bookingId: booked.data.bookingId,
        status: 'CONFIRMED',
        provider: 'nuitee',
        clientReference,
        totalPrice: booked.data.totalPrice,
        propertyId: seen.data.propertyId ?? b.providerPropertyId,
      },
    };
  };
}

export function buildNuiteeStayReconcileLookup(
  pool: Pool,
  hotel: ExternalStayExecutionDeps['hotel'],
): ReconcileLookup {
  return async (claim) => {
    const requestRef = (
      await pool.query<{ request_ref: string | null }>(
        `SELECT request_ref FROM execution_attempts WHERE workspace_id = $1 AND id = $2`,
        [claim.workspaceId, claim.id],
      )
    ).rows[0]?.request_ref;
    if (!requestRef) return { kind: 'STILL_UNKNOWN' };

    if (requestRef.startsWith('nuitee:cancel:')) {
      const bookingId = requestRef.slice('nuitee:cancel:'.length);
      const seen = await hotel.retrieveBooking({ bookingId });
      if (!seen.ok) return { kind: 'STILL_UNKNOWN' };
      if (seen.data.status === 'CANCELLED') {
        return {
          kind: 'FOUND_SUCCESS',
          responseRef: requestRef,
          externalRecordId: recordId(bookingId),
          sourceOwnedFields: { bookingId, status: 'CANCELLED', reconciled: true },
        };
      }
      if (seen.data.status === 'CONFIRMED') return { kind: 'STILL_UNKNOWN' };
      return {
        kind: 'FOUND_FAILURE',
        responseRef: requestRef,
        error: `reconciled cancellation status ${seen.data.status}`,
      };
    }

    if (!requestRef.startsWith('nuitee:clientref:') || !hotel.findBookingsByClientReference) {
      return { kind: 'STILL_UNKNOWN' };
    }

    const clientReference = requestRef.slice('nuitee:clientref:'.length);
    const found = await hotel.findBookingsByClientReference({ clientReference });
    if (!found.ok || found.data.bookings.length !== 1) return { kind: 'STILL_UNKNOWN' };

    const bookingId = found.data.bookings[0]!.bookingId;
    const seen = await hotel.retrieveBooking({ bookingId });
    if (!seen.ok) return { kind: 'STILL_UNKNOWN' };
    if (seen.data.status === 'CANCELLED') {
      return {
        kind: 'FOUND_FAILURE',
        responseRef: `nuitee:booking:${bookingId}`,
        error: 'reconciled booking cancelled',
      };
    }
    if (seen.data.status !== 'CONFIRMED') return { kind: 'STILL_UNKNOWN' };

    const inputs = await resolveStayExecutionInputs(pool, claim.workspaceId, claim.actionIntentId);
    if (!inputs.ready) {
      // Binding missing: keep unknown for operator — do not adopt as success.
      return { kind: 'STILL_UNKNOWN' };
    }
    const matched = matchApprovedStayBooking(inputs.binding, seen.data, {
      clientReference,
      expectedAmount: inputs.binding.quotedAmount != null ? Number(inputs.binding.quotedAmount) : undefined,
      expectedCurrency: inputs.binding.quotedCurrency,
    });
    if (!matched.ok) {
      // Confirmed but not the approved booking: preserve side effect, block successors.
      return {
        kind: 'FOUND_FAILURE',
        responseRef: `nuitee:booking:${bookingId}`,
        error: `reconciled_booking_mismatch:${matched.reason}`,
      };
    }
    return {
      kind: 'FOUND_SUCCESS',
      responseRef: `nuitee:booking:${bookingId}`,
      externalRecordId: recordId(bookingId),
      sourceOwnedFields: {
        bookingId,
        status: 'CONFIRMED',
        clientReference,
        reconciled: true,
        ...(seen.data.totalPrice ? { totalPrice: seen.data.totalPrice } : {}),
        ...(seen.data.propertyId ? { propertyId: seen.data.propertyId } : {}),
      },
    };
  };
}

async function mintContinuationCheckpoints(
  ctx: ExternalStayExecutionContext,
  actionPlanId: string,
  intentId: string,
  recoveryStrategyId: string | null,
): Promise<void> {
  if (!recoveryStrategyId) return;
  const now = ctx.now ?? new Date().toISOString();
  const nextIntentIds = await loadNextSelectedPlanIntents(ctx.pool, ctx.workspaceId, actionPlanId, intentId);
  for (const nextIntentId of nextIntentIds) {
    await createSelectedPlanContinuationCheckpoint(ctx.pool, {
      workspaceId: ctx.workspaceId,
      actorId: ctx.actorPrincipalId,
      actionPlanId,
      nextActionIntentId: nextIntentId,
      sourceStrategyId: recoveryStrategyId,
      now,
    });
  }
}

async function hasExactCanonicalApplication(
  pool: Pool,
  workspaceId: string,
  intentId: string,
  commandNamespace: string,
  idempotencyKey: string,
): Promise<boolean> {
  // selected_plan_canonical_applications has no action_intent_id column;
  // intent identity is via execution_attempts.action_intent_id on attempt_id.
  const row = (
    await pool.query(
      `SELECT 1
         FROM selected_plan_canonical_applications application
         JOIN command_receipts receipt
           ON receipt.workspace_id = application.workspace_id
          AND receipt.command_namespace = application.command_namespace
          AND receipt.idempotency_key = application.idempotency_key
         JOIN execution_attempts ea
           ON ea.workspace_id = application.workspace_id AND ea.id = application.attempt_id
        WHERE application.workspace_id = $1
          AND ea.action_intent_id = $2
          AND application.command_namespace = $3
          AND application.idempotency_key = $4
        LIMIT 1`,
      [workspaceId, intentId, commandNamespace, idempotencyKey],
    )
  ).rows[0];
  return Boolean(row);
}

async function applyCanonicalStay(
  ctx: ExternalStayExecutionContext,
  intentId: string,
  inputs: Extract<StayExecutionInputs, { ready: true }>,
  observedAt: string,
  fields: Record<string, unknown>,
  canonicalApplication: {
    attemptId: string;
    actionPlanId: string;
    source: { kind: 'EXTERNAL_PROVIDER'; observationId: string };
  },
  recoveryStrategyId: string | null,
): Promise<{ ok: true; already?: true } | { ok: false; error: string }> {
  const b = inputs.binding;
  const base = { workspaceId: ctx.workspaceId, actorPrincipalId: ctx.actorPrincipalId };
  const sourceId = recordId(`${intentId}|source`);
  const evidenceId = recordId(`${intentId}|evidence`);

  if (b.action === 'CANCEL') {
    const cancelKey = `stay:${intentId}:canonical-cancel`;
    if (await hasExactCanonicalApplication(ctx.pool, ctx.workspaceId, intentId, 'OBSERVED_STAY_CANCELLED', cancelKey)) {
      return { ok: true, already: true };
    }
    if (!b.journeyItemId || !b.reservationLineId) {
      return { ok: false, error: 'cancel binding missing subjects' };
    }
    // Entity cancelled without this action's receipt is not exact replay.
    const entity = (
      await ctx.pool.query<{ observed_status: string; lifecycle_status: string }>(
        `SELECT rl.observed_status, ji.lifecycle_status
           FROM reservation_lines rl
           JOIN reservation_allocations ra
             ON ra.workspace_id = rl.workspace_id AND ra.line_id = rl.id
           JOIN journey_items ji
             ON ji.workspace_id = ra.workspace_id AND ji.id = ra.journey_item_id
          WHERE rl.workspace_id = $1 AND rl.id = $2 AND ji.id = $3`,
        [ctx.workspaceId, b.reservationLineId, b.journeyItemId],
      )
    ).rows[0];
    if (entity?.observed_status === 'CANCELLED' && entity.lifecycle_status === 'DROPPED') {
      const receipt = await ctx.pool.query(
        `SELECT 1 FROM command_receipts
          WHERE workspace_id = $1 AND command_namespace = 'OBSERVED_STAY_CANCELLED' AND idempotency_key = $2`,
        [ctx.workspaceId, cancelKey],
      );
      if (!receipt.rows[0]) {
        return { ok: false, error: 'cancel entity exists without matching canonical receipt for this action' };
      }
    }

    const src = await recordSource(ctx.uow(), {
      ...base,
      idempotencyKey: `stay:${intentId}:source`,
      sourceId,
      sourceIdentity: `nuitee:${String(fields.bookingId ?? b.stayElementId ?? intentId)}`,
      receivedAt: observedAt,
      contentHash: createHash('sha256').update(JSON.stringify(fields)).digest('hex'),
      contentType: 'application/json',
    });
    if (!src.ok) return { ok: false, error: `source:${src.conflict.message}` };
    const ev = await recordEvidence(ctx.uow(), {
      ...base,
      idempotencyKey: `stay:${intentId}:evidence`,
      evidenceId,
      assertionType: 'PROVIDER_STAY_CANCELLED',
      observedAt,
      schemaVersion: '1',
      sourceIds: [sourceId],
      subjectRefs: [{ kind: 'JOURNEY', id: b.journeyId }],
    });
    if (!ev.ok) return { ok: false, error: `evidence:${ev.conflict.message}` };

    const row = (
      await ctx.pool.query<{ reservation_id: string }>(
        `SELECT reservation_id FROM reservation_lines WHERE workspace_id = $1 AND id = $2`,
        [ctx.workspaceId, b.reservationLineId],
      )
    ).rows[0];
    const heads = new PgAggregateHeadReader(ctx.pool, ctx.workspaceId);
    const j = await heads.loadHead({ kind: 'JOURNEY', id: b.journeyId });
    const r = row ? await heads.loadHead({ kind: 'RESERVATION', id: row.reservation_id }) : undefined;
    if (!row || !j || !r) return { ok: false, error: 'cancel canonical heads missing' };

    const result = await applyObservedStayCancellation(ctx.uow(), {
      ...base,
      idempotencyKey: cancelKey,
      journeyId: b.journeyId,
      expectedJourneyRevision: j.revision,
      reservationId: row.reservation_id,
      expectedReservationRevision: r.revision,
      journeyItemId: b.journeyItemId,
      reservationLineId: b.reservationLineId,
      observedAt,
      evidenceId,
      canonicalApplication: { ...canonicalApplication, actionIntentId: intentId },
    });
    if (!result.ok) return { ok: false, error: `cancel:${result.conflict.message}` };
    await mintContinuationCheckpoints(ctx, canonicalApplication.actionPlanId, intentId, recoveryStrategyId);
    return { ok: true };
  }

  const attachKey = `stay:${intentId}:attach`;
  if (await hasExactCanonicalApplication(ctx.pool, ctx.workspaceId, intentId, 'OBSERVED_STAY_ATTACHED', attachKey)) {
    return { ok: true, already: true };
  }
  if (
    !b.providerConnectionId
    || !b.journeyItemId
    || !b.placeId
    || !b.stayWindow
    || !b.orderKey
    || !b.requiredNights
    || !b.quoteHandle
    || !b.approvedVisit
  ) {
    return { ok: false, error: 'book canonical binding incomplete' };
  }

  const existingItem = await ctx.pool.query(
    `SELECT 1 FROM journey_items WHERE workspace_id = $1 AND id = $2`,
    [ctx.workspaceId, b.journeyItemId],
  );
  if ((existingItem.rowCount ?? 0) > 0) {
    const receipt = await ctx.pool.query(
      `SELECT 1 FROM command_receipts
        WHERE workspace_id = $1 AND command_namespace = 'OBSERVED_STAY_ATTACHED' AND idempotency_key = $2`,
      [ctx.workspaceId, attachKey],
    );
    if (!receipt.rows[0]) {
      return { ok: false, error: 'journey item exists without matching canonical receipt for this action' };
    }
    await mintContinuationCheckpoints(ctx, canonicalApplication.actionPlanId, intentId, recoveryStrategyId);
    return { ok: true, already: true };
  }

  const bookingId = typeof fields.bookingId === 'string' ? fields.bookingId : undefined;
  if (!bookingId) return { ok: false, error: 'booking observation has no booking id' };

  const src = await recordSource(ctx.uow(), {
    ...base,
    idempotencyKey: `stay:${intentId}:source`,
    sourceId,
    sourceIdentity: `nuitee:${bookingId}`,
    receivedAt: observedAt,
    contentHash: createHash('sha256').update(JSON.stringify(fields)).digest('hex'),
    contentType: 'application/json',
  });
  if (!src.ok) return { ok: false, error: `source:${src.conflict.message}` };
  const ev = await recordEvidence(ctx.uow(), {
    ...base,
    idempotencyKey: `stay:${intentId}:evidence`,
    evidenceId,
    assertionType: 'PROVIDER_STAY_CONFIRMED',
    observedAt,
    schemaVersion: '1',
    sourceIds: [sourceId],
    subjectRefs: [{ kind: 'JOURNEY', id: b.journeyId }],
  });
  if (!ev.ok) return { ok: false, error: `evidence:${ev.conflict.message}` };

  const heads = new PgAggregateHeadReader(ctx.pool, ctx.workspaceId);
  const c = await heads.loadHead({ kind: 'EXTERNAL_CONNECTION', id: b.providerConnectionId });
  const j = await heads.loadHead({ kind: 'JOURNEY', id: b.journeyId });
  if (!c || !j) return { ok: false, error: 'booking canonical heads missing' };

  const externalId = recordId(bookingId);
  const payloadHash = createHash('sha256').update(JSON.stringify(fields)).digest('hex');
  const observed = await observeExternalRecord(ctx.uow(), {
    ...base,
    idempotencyKey: `stay:${intentId}:record`,
    connectionId: b.providerConnectionId,
    expectedRevision: c.revision,
    record: {
      id: externalId,
      recordType: 'HOTEL_BOOKING',
      externalId: bookingId,
      identityState: 'UNVERIFIED',
      observedAt,
      payloadHash,
    },
    evidenceRefs: [evidenceId],
  });
  if (!observed.ok) return { ok: false, error: `record:${observed.conflict.message}` };

  const attached = await attachObservedStay(ctx.uow(), {
    ...base,
    idempotencyKey: attachKey,
    journeyId: b.journeyId,
    expectedJourneyRevision: j.revision,
    travellerId: inputs.travellerId,
    expectedConnectionRevision: observed.value.connectionRevision,
    provider: {
      connectionId: b.providerConnectionId,
      externalRecordId: externalId,
      externalId: bookingId,
      recordType: 'HOTEL_BOOKING',
      observedAt,
      evidenceId,
      payloadHash,
    },
    journeyItem: {
      id: b.journeyItemId,
      intendedPlaceId: b.placeId,
      requiredNights: b.requiredNights,
      intendedWindow: b.stayWindow,
      orderKey: b.orderKey,
    },
    booking: { placeId: b.placeId, stayInterval: b.stayWindow, status: 'CONFIRMED' },
    approvedVisit: b.approvedVisit,
    canonicalApplication: { ...canonicalApplication, actionIntentId: intentId },
    evidenceRefs: [evidenceId],
  });
  if (!attached.ok) return { ok: false, error: `attach:${attached.conflict.message}` };
  await mintContinuationCheckpoints(ctx, canonicalApplication.actionPlanId, intentId, recoveryStrategyId);
  return { ok: true };
}

async function applyPendingCanonicalUpdates(
  ctx: ExternalStayExecutionContext,
  report: ExternalStayExecutionReport,
): Promise<void> {
  const rows = (
    await ctx.pool.query<{
      intent_id: string;
      action_plan_id: string;
      recovery_strategy_id: string | null;
      attempt_id: string;
      source_observation_id: string;
      observed_at: Date;
      source_owned_fields: unknown;
    }>(
      `SELECT ai.id AS intent_id,
              ai.action_plan_id,
              ap.recovery_strategy_id,
              (array_agg(ea.id ORDER BY eo.observed_at DESC))[1] AS attempt_id,
              (array_agg(eo.id ORDER BY eo.observed_at DESC))[1] AS source_observation_id,
              max(eo.observed_at) AS observed_at,
              (array_agg(eo.source_owned_fields ORDER BY eo.observed_at DESC))[1] AS source_owned_fields
         FROM action_intents ai
         JOIN action_plans ap ON ap.workspace_id = ai.workspace_id AND ap.id = ai.action_plan_id
         JOIN execution_attempts ea ON ea.workspace_id = ai.workspace_id AND ea.action_intent_id = ai.id
         JOIN execution_observations eo ON eo.workspace_id = ea.workspace_id AND eo.attempt_id = ea.id
        WHERE ai.workspace_id = $1
          AND ai.capability_ref = ANY($2::text[])
          AND ea.status = ANY($3::text[])
        GROUP BY ai.id, ai.action_plan_id, ap.recovery_strategy_id`,
      [ctx.workspaceId, STAY_CAPS, SUCCESS],
    )
  ).rows;

  for (const row of rows) {
    const inputs = await resolveStayExecutionInputs(ctx.pool, ctx.workspaceId, row.intent_id);
    if (!inputs.ready) continue;
    const applied = await applyCanonicalStay(
      ctx,
      row.intent_id,
      inputs,
      row.observed_at.toISOString(),
      row.source_owned_fields as Record<string, unknown>,
      {
        attemptId: row.attempt_id,
        actionPlanId: row.action_plan_id,
        source: { kind: 'EXTERNAL_PROVIDER', observationId: row.source_observation_id },
      },
      row.recovery_strategy_id,
    );
    if (applied.ok) {
      if (!applied.already) report.canonicalUpdates += 1;
    } else {
      report.canonicalPending.push({ intentId: row.intent_id, error: applied.error });
    }
  }
}

export async function runExternalStayExecutionPass(
  ctx: ExternalStayExecutionContext,
): Promise<ExternalStayExecutionReport> {
  const at = ctx.now ?? new Date().toISOString();
  const report = emptyReport(at);
  if (ctx.external.mode !== 'LIVE' && ctx.external.mode !== 'RECORD') {
    report.refused = 1;
    return report;
  }

  const worker = new PgExecutionWorker(ctx.pool, {
    actorId: `northstar-external-stay:${ctx.workspaceId}`,
  });
  const candidates = await loadCandidates(ctx.pool, ctx.workspaceId);
  report.candidates = candidates.length;

  for (const intentId of candidates) {
    const inputs = await resolveStayExecutionInputs(ctx.pool, ctx.workspaceId, intentId);
    if (!inputs.ready) {
      report.refused += 1;
      report.outcomes.push({ intentId, result: 'REFUSED', detail: `${inputs.reason}:${inputs.detail}` });
      continue;
    }
    const stored = await loadStoredIntent(ctx.pool, ctx.workspaceId, intentId);
    if (!stored?.costAmount || !stored.costCurrency) {
      report.refused += 1;
      report.outcomes.push({ intentId, result: 'REFUSED', detail: 'CEILING_MISSING' });
      continue;
    }

    let attempt = (
      await ctx.pool.query<{ id: string }>(
        `SELECT id FROM execution_attempts
          WHERE workspace_id = $1 AND action_intent_id = $2 AND status = 'PREPARED'
          ORDER BY created_at LIMIT 1`,
        [ctx.workspaceId, intentId],
      )
    ).rows[0]?.id;

    if (!attempt) {
      const prepared = await createPreparedExecutionAttempt(ctx.uow(), {
        workspaceId: ctx.workspaceId,
        actorPrincipalId: ctx.actorPrincipalId,
        idempotencyKey: `external-stay:${intentId}:1:prepare`,
        planId: stored.actionPlanId,
        intentId,
        attemptNumber: 1,
        principalId: ctx.executorPrincipalId,
        now: at,
      });
      if (!prepared.ok) {
        report.refused += 1;
        report.outcomes.push({ intentId, result: 'REFUSED', detail: prepared.conflict.message });
        continue;
      }
      if (prepared.value.replayed) {
        report.deferred += 1;
        report.outcomes.push({ intentId, result: 'DEFERRED', detail: 'replayed known attempt' });
        continue;
      }
      attempt = prepared.value.attemptId;
    }

    const claim = await worker.claimPrepared(ctx.workspaceId, attempt);
    if (!claim) {
      report.deferred += 1;
      report.outcomes.push({ intentId, result: 'DEFERRED', detail: 'attempt not claimable' });
      continue;
    }

    const result = await worker.dispatchClaimed(claim, {
      principalId: ctx.executorPrincipalId,
      now: at,
      observed: { capabilityKind: 'SERVICE', supported: true },
      dispatcher: buildNuiteeStayDispatcher(
        ctx.external.hotel,
        inputs,
        { amount: Number(stored.costAmount), currency: stored.costCurrency },
        intentId,
        ctx.external.paymentRef,
      ),
    });

    if (result.outcome === 'OBSERVED_SUCCESS') {
      report.executed += 1;
      report.outcomes.push({ intentId, result: 'SUCCEEDED' });
    } else if (result.outcome === 'OUTCOME_UNKNOWN') {
      report.unknown += 1;
      report.outcomes.push({ intentId, result: 'OUTCOME_UNKNOWN' });
    } else {
      report.failed += 1;
      report.outcomes.push({ intentId, result: 'FAILED', detail: result.detail });
    }
  }

  await applyPendingCanonicalUpdates(ctx, report);
  return report;
}

/** Reconciliation only: a prior unknown is never rebooked or re-cancelled. */
export async function runExternalStayReconciliation(
  ctx: ExternalStayExecutionContext,
): Promise<{ reconciled: number; stillUnknown: number; canonicalUpdates: number }> {
  const worker = new PgExecutionWorker(ctx.pool, {
    actorId: `northstar-external-stay-reconcile:${ctx.workspaceId}`,
  });
  const rows = (
    await ctx.pool.query<{ id: string }>(
      `SELECT ea.id
         FROM execution_attempts ea
         JOIN action_intents ai ON ai.workspace_id = ea.workspace_id AND ai.id = ea.action_intent_id
        WHERE ea.workspace_id = $1
          AND ai.capability_ref = ANY($2::text[])
          AND (
            ea.status IN ('OUTCOME_UNKNOWN', 'RECONCILIATION_REQUIRED')
            OR (
              ea.status IN ('DISPATCHING', 'DISPATCHED')
              AND (ea.lease_expires_at IS NULL OR ea.lease_expires_at < now())
            )
          )
        ORDER BY ea.created_at`,
      [ctx.workspaceId, STAY_CAPS],
    )
  ).rows;

  let reconciled = 0;
  let stillUnknown = 0;
  const lookup = buildNuiteeStayReconcileLookup(ctx.pool, ctx.external.hotel);
  for (const row of rows) {
    const claim = await worker.claimForReconciliation(ctx.workspaceId, row.id);
    if (!claim) continue;
    const outcome = await worker.reconcileUnknown(claim, lookup);
    if (outcome.outcome === 'OBSERVED_SUCCESS' || outcome.outcome === 'OBSERVED_FAILURE') {
      reconciled += 1;
    } else {
      stillUnknown += 1;
    }
  }

  const canonical = emptyReport(ctx.now ?? new Date().toISOString());
  await applyPendingCanonicalUpdates(ctx, canonical);
  return {
    reconciled,
    stillUnknown,
    canonicalUpdates: canonical.canonicalUpdates,
  };
}

/** Dispatch once, then reconcile unknowns under the same workspace lease. */
export async function runExternalStayExecutionCycle(
  ctx: ExternalStayExecutionContext,
): Promise<{
  report: ExternalStayExecutionReport;
  reconciliation: { reconciled: number; stillUnknown: number; canonicalUpdates: number };
  leaseUnavailable: boolean;
}> {
  const lease = await tryAcquireWorkspaceOperationLease(ctx.pool, ctx.workspaceId);
  if (!lease) {
    return {
      report: emptyReport(ctx.now ?? new Date().toISOString()),
      reconciliation: { reconciled: 0, stillUnknown: 0, canonicalUpdates: 0 },
      leaseUnavailable: true,
    };
  }
  try {
    const report = await runExternalStayExecutionPass(ctx);
    const reconciliation = await runExternalStayReconciliation(ctx);
    return { report, reconciliation, leaseUnavailable: false };
  } finally {
    await lease.release();
  }
}

/** Compose Nuitée stay mutation only when LIVE/RECORD credentials are honest. */
export function composeStayExecution(config: AppConfig, cwd: string): ExternalStayExecutionDeps | undefined {
  if (config.adapterMode === 'REPLAY') return undefined;
  if (!hasLiveCredentials(config, 'nuitee')) return undefined;
  const nuitee = config.providers.nuitee;
  if (!nuitee.apiKey) return undefined;

  const scenariosDir = join(cwd, config.fixturesDir, 'scenarios');
  const scenarioRecordingDirs = existsSync(scenariosDir)
    ? readdirSync(scenariosDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => join(config.fixturesDir, 'scenarios', e.name, 'recordings'))
    : [];
  const store = new FileRecordingStore({
    readDirs: [config.recordingsDir, join(config.fixturesDir, 'recordings'), ...scenarioRecordingDirs],
    ...(config.adapterMode === 'RECORD' ? { writeDir: config.recordingsDir } : {}),
  });

  const hotel = new NuiteeAdapter({
    mode: config.adapterMode,
    store,
    ...(nuitee.searchBaseUrl ? { searchBaseUrl: nuitee.searchBaseUrl } : {}),
    ...(nuitee.bookingBaseUrl ? { bookingBaseUrl: nuitee.bookingBaseUrl } : {}),
    apiKey: nuitee.apiKey,
  });

  return {
    hotel,
    mode: config.adapterMode,
  };
}

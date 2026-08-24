/**
 * DR-2 — provider-backed execution composition (1B.2/1B.4/1B.5/1B.6/1B.8/1B.9).
 *
 * Replaces simulation-first execution for operations a wired provider
 * capability can actually perform, behind the same ExecutorService seam the
 * recovery loop already uses. Selection depends ONLY on the ActionIntent
 * operation, the configured capability, and the adapter mode — never on
 * scenario/traveller/route/fixture identity.
 *
 * Invariants preserved here (G3R-R0 A1/A2, ADR-042/043):
 *  - The deterministic authority gate is re-checked before ANY provider call.
 *  - Money-moving flight booking follows the Option-B sequence:
 *    verify -> create (hold) -> compare observed payable total against the
 *    authorised ceiling -> pay ONLY when safe -> retrieve through ticketing.
 *    Missing total, currency mismatch, or a payable above the ceiling leaves
 *    the order HELD and loops the case back to viability/authority.
 *    The ceiling is the authority-frozen `ActionIntent.spendExposure` — the
 *    maximum gross provider charge authority reviewed (ADR-048). Neither
 *    `ActionIntent.priceDelta` (a delta) nor mutable strategy state is ever
 *    used for this comparison; the executor holds no strategy resolver at all.
 *  - `flight.book` is hold-without-payment only and never chains into pay.
 *  - Ambiguous/timeout results reconcile via retrieve before any retry.
 *  - Cancellation quote != submission != observed cancellation; UNSUPPORTED
 *    is normal structured data; PROCESSING never becomes CANCELLED.
 *  - Hotel replacement is confirmed BEFORE the displaced stay is cancelled;
 *    a failed old-stay cancellation preserves both provider states as
 *    duplicate exposure instead of faking a rollback.
 *  - Provider success is not trip recovery: outcomes are execution evidence;
 *    observation + CaseVerifier still own authoritative state.
 */
import type { IsoDateTime, Money } from '../domain/common.ts';
import { instantMillis } from '../domain/common.ts';
import type { AdapterMode, CapabilityResult } from '../contracts/envelope.ts';
import type {
  FlightCapability,
  FlightContactInput,
  FlightPassengerInput,
  FlightTransactionCapability,
  HotelCapability,
} from '../contracts/capabilities.ts';
import type {
  ActionIntent,
  AuthorisedExecution,
  ExecutionResult,
  SideEffectLevel,
} from '../operational/intent.ts';
import { CONFIRMS_CANDIDATE_STATE, executionGateIssues } from '../operational/intent.ts';
import type { ExecutorService } from '../contracts/services.ts';

// ---------------------------------------------------------------------------
// Dossiers: structured booking identity the frozen ontology does not carry.
// ---------------------------------------------------------------------------
//
// The Traveller entity carries a display name only — no given/family split,
// date of birth, or gender. Real provider booking therefore needs an
// application-owned dossier resolved PER INTENT by the composing runtime.
// Absent dossier => structured refusal for consequential provider execution
// (never guessed identity). Injected dossiers must come from authoritative
// or operator-validated data, never from an LLM proposal.

export interface FlightBookingDossier {
  passengers: FlightPassengerInput[];
  contact: FlightContactInput;
  /** Opaque pre-authorised payment handle (e.g. provider sandbox balance). */
  paymentRef: string;
}

export interface HotelReplacementDossier {
  /** Provider rate/offer id the replacement should be quoted/booked from. */
  replacementRateId: string;
  guestNames: string[];
  /** Provider booking id of the displaced stay to cancel, when known. */
  displacedBookingId?: string;
  paymentRef?: string;
}

export interface ProviderBackedExecutorDependencies {
  /** Simulation boundary used when no provider path applies (ADR-007). */
  fallback: ExecutorService;
  /** Adapter mode governing replay-miss fallback honesty. */
  mode: AdapterMode;
  /** Read-side flight capability (offer verify -> session state). */
  flight?: FlightCapability;
  /** Transactional flight capability (create/pay/retrieve/cancellation). */
  flightTransactions?: FlightTransactionCapability;
  /** Hotel capability (quote/book/retrieve/cancel). */
  hotel?: HotelCapability;
  /**
   * Booking identity resolved per intent from APPLICATION-OWNED validated
   * data (dossier stores seeded from operator/authoritative sources) — never
   * from LLM output and never scenario-keyed. May resolve asynchronously
   * against authoritative state. Absent dossier => structured refusal for
   * consequential LIVE/RECORD execution.
   */
  flightDossier?: (intent: ActionIntent) => FlightBookingDossier | undefined | Promise<FlightBookingDossier | undefined>;
  hotelDossier?: (intent: ActionIntent) => HotelReplacementDossier | undefined | Promise<HotelReplacementDossier | undefined>;
  /** Bounded ticketing observation window (async ticketing is real). */
  ticketingPoll?: { attempts: number; delayMs: number };
  sleep?: (ms: number) => Promise<void>;
  now?: () => IsoDateTime;
}

const DEFAULT_TICKETING_POLL = { attempts: 6, delayMs: 1000 };

/** Deterministic per-intent idempotency key for provider clientReference. */
function clientReferenceFor(intent: ActionIntent): string {
  return intent.id;
}

/**
 * Execution evidence must never be stamped causally before the intent it
 * executes (which is itself lifted to the case's causal horizon). A wall
 * clock earlier than the intent instant is lifted to the intent instant.
 */
function effectiveExecutedAt(intent: ActionIntent, now: () => IsoDateTime): IsoDateTime {
  const wallClock = now();
  return instantMillis(wallClock) >= instantMillis(intent.createdAt) ? wallClock : intent.createdAt;
}

function isReplayMiss(result: CapabilityResult<unknown>): boolean {
  return !result.ok && result.error.code === 'recording_not_found';
}

/** CapabilityResult meta mode -> execution provenance (truthful, no SIMULATED). */
function provenanceFor(mode: AdapterMode): ExecutionResult['provenance'] {
  return mode;
}

interface BookingRefEntry {
  system: string;
  reference: string;
}

function bookingRefsOf(intent: ActionIntent): BookingRefEntry[] {
  const raw = intent.parameters['bookingRefs'];
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is BookingRefEntry =>
      Boolean(entry) &&
      typeof entry === 'object' &&
      typeof (entry as Record<string, unknown>)['system'] === 'string' &&
      typeof (entry as Record<string, unknown>)['reference'] === 'string',
  );
}

function stringParameter(intent: ActionIntent, key: string): string | undefined {
  const value = intent.parameters[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

// ---------------------------------------------------------------------------
// Payment / cost gate: observed provider price vs the authorised ceiling.
// ---------------------------------------------------------------------------

export type PaymentGateCode =
  | 'no_authorised_ceiling'
  | 'payable_total_missing'
  | 'payable_currency_mismatch'
  | 'payable_exceeds_ceiling';

export type PaymentGateVerdict =
  | { ok: true }
  | { ok: false; code: PaymentGateCode; message: string };

/**
 * Deterministic do-not-pay gate (ADR-042 A1/A2, test-enforced). The ceiling
 * is the authority-frozen gross spend (intent spendExposure, ADR-048); the
 * payable is the provider-observed total. Absence or incomparability fails
 * CLOSED: no FX invention, no priceDelta substitution, no silent pass.
 */
export function paymentGateVerdict(
  payable: Money | undefined,
  ceiling: Money | undefined,
): PaymentGateVerdict {
  if (ceiling === undefined) {
    return {
      ok: false,
      code: 'no_authorised_ceiling',
      message: 'no authoritative ceiling available; payment refused (fail closed)',
    };
  }
  if (payable === undefined) {
    return {
      ok: false,
      code: 'payable_total_missing',
      message: 'provider reported no payable total; payment refused',
    };
  }
  if (payable.currency !== ceiling.currency) {
    return {
      ok: false,
      code: 'payable_currency_mismatch',
      message: `payable currency ${payable.currency} differs from authorised ceiling currency ${ceiling.currency}; payment refused`,
    };
  }
  if (payable.amount > ceiling.amount) {
    return {
      ok: false,
      code: 'payable_exceeds_ceiling',
      message: `payable ${payable.amount} ${payable.currency} exceeds authorised ceiling ${ceiling.amount} ${ceiling.currency}; payment refused`,
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Side-effect classification guard (G3R-R1 A1).
// ---------------------------------------------------------------------------
//
// Authority decides on the intent's DECLARED sideEffectLevel: the default
// ladder auto-approves REVERSIBLE and demands the traveller for anything
// irreversible or money-moving. Once provider-backed execution replaced the
// simulation boundary, a misclassified intent stopped being harmless — a
// REVERSIBLE-declared `hotel.modify` would have reached a real chargeable
// booking plus an irreversible cancellation under an auto-approval.
//
// So the executor refuses to make a provider call whose REAL side effect
// outranks the level authority reviewed. This is a structural backstop, not
// a replacement for correct classification in `consequentialOperationFor`.

const SIDE_EFFECT_RANK: Record<SideEffectLevel, number> = {
  READ_ONLY: 0,
  REVERSIBLE: 1,
  IRREVERSIBLE: 2,
  MONEY_MOVING: 3,
};

/** The real side effect each provider-backed operation performs. */
const REQUIRED_SIDE_EFFECT_LEVEL: Record<string, SideEffectLevel> = {
  // Creates a provider-side order/hold; no money moves at create.
  'flight.book': 'IRREVERSIBLE',
  'flight.pay': 'MONEY_MOVING',
  'flight.change': 'MONEY_MOVING',
  'flight.cancel': 'IRREVERSIBLE',
  // Books a chargeable replacement stay and cancels the displaced one.
  'hotel.book': 'MONEY_MOVING',
  'hotel.modify': 'MONEY_MOVING',
};

/**
 * `undefined` when the declared level covers the operation's real side
 * effect; otherwise the level the operation actually requires.
 */
export function insufficientSideEffectLevel(intent: ActionIntent): SideEffectLevel | undefined {
  const required = REQUIRED_SIDE_EFFECT_LEVEL[intent.operation];
  if (required === undefined) return undefined;
  return SIDE_EFFECT_RANK[intent.sideEffectLevel] < SIDE_EFFECT_RANK[required]
    ? required
    : undefined;
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export function createProviderBackedExecutor(
  deps: ProviderBackedExecutorDependencies,
): ExecutorService {
  const now = deps.now ?? ((): IsoDateTime => new Date().toISOString());
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const poll = deps.ticketingPoll ?? DEFAULT_TICKETING_POLL;

  /**
   * ADR-048: the payment ceiling is the authority-frozen gross spend the
   * intent carries (`spendExposure`) — the maximum provider charge authority
   * reviewed when it authorised THIS intent. The executor holds no strategy
   * resolver: re-reading mutable strategy state after authority would let a
   * later strategy mutation raise the authorised spend without review.
   */
  function ceilingFor(intent: ActionIntent): Money | undefined {
    return intent.spendExposure;
  }

  /**
   * The spend authority actually reviewed against SPEND_LIMIT /
   * APPROVAL_ABOVE_SPEND (ADR-048) — the intent's gross spendExposure, never
   * the incremental priceDelta. A consequential payment whose intent carries
   * no reviewed gross spend is refused: authority cannot have evaluated a
   * charge it never saw, and the order remains HELD for re-entry.
   */
  function reviewedSpendFor(intent: ActionIntent): Money | undefined {
    return intent.spendExposure;
  }

  function failure(
    execution: AuthorisedExecution,
    code: string,
    message: string,
    observedEffects?: Record<string, unknown>,
    retryable?: boolean,
  ): ExecutionResult {
    return {
      id: `exec-${execution.intent.id}`,
      intentId: execution.intent.id,
      executedAt: effectiveExecutedAt(execution.intent, now),
      status: 'FAILURE',
      provenance: 'SIMULATED',
      ...(observedEffects ? { observedEffects } : {}),
      error: { code, message, ...(retryable === undefined ? {} : { retryable }) },
    };
  }

  function providerFailure(
    execution: AuthorisedExecution,
    providerId: string,
    mode: AdapterMode,
    code: string,
    message: string,
    observedEffects?: Record<string, unknown>,
    retryable?: boolean,
  ): ExecutionResult {
    return {
      id: `exec-${execution.intent.id}`,
      intentId: execution.intent.id,
      executedAt: effectiveExecutedAt(execution.intent, now),
      status: 'FAILURE',
      provenance: provenanceFor(mode),
      providerId,
      ...(observedEffects ? { observedEffects } : {}),
      error: { code, message, ...(retryable === undefined ? {} : { retryable }) },
    };
  }

  // -------------------------------------------------------------------------
  // Flight booking: verify -> create -> payment gate -> pay -> ticketing
  // -------------------------------------------------------------------------

  async function executeFlightBooking(execution: AuthorisedExecution): Promise<ExecutionResult> {
    const { intent } = execution;
    const transactions = deps.flightTransactions;
    if (!transactions || !deps.flight) return deps.fallback.execute(execution);
    const providerId = transactions.descriptor.providerId;

    // Validated booking identity is a precondition. REPLAY keeps the historic
    // simulation behavior when no dossier is wired; LIVE/RECORD fails closed —
    // a money-moving booking with guessed identity never runs.
    const dossier = await deps.flightDossier?.(intent);
    if (!dossier) {
      if (deps.mode === 'REPLAY') return deps.fallback.execute(execution);
      return failure(
        execution,
        'booking_dossier_absent',
        'no validated passenger/contact dossier available for provider booking',
      );
    }

    const offerId =
      stringParameter(intent, 'offerId') ?? bookingRefsOf(intent)[0]?.reference;
    if (!offerId) {
      return failure(
        execution,
        'missing_offer_reference',
        'intent carries no provider offer reference; provider booking impossible',
      );
    }

    // 1. Verify/revalidate the offer and obtain provider session state.
    const verify = await deps.flight.verifyOffer({ offerId });
    if (!verify.ok) {
      if (isReplayMiss(verify) && deps.mode === 'REPLAY') return deps.fallback.execute(execution);
      return providerFailure(
        execution, providerId, verify.meta.mode,
        'offer_verification_failed',
        `offer verification failed: ${verify.error.category}/${verify.error.code}`,
        undefined,
        verify.error.retryable,
      );
    }
    if (verify.data.status === 'UNAVAILABLE') {
      return providerFailure(
        execution, providerId, verify.meta.mode,
        'offer_unavailable',
        'offer no longer available for booking',
      );
    }
    if (verify.data.status === 'PRICE_CHANGED') {
      // Observed drift re-enters viability/authority; never book on stale price.
      return providerFailure(
        execution, providerId, verify.meta.mode,
        'offer_price_changed',
        'offer price changed since strategy evaluation; re-enter viability/authority',
        { observedPrice: verify.data.updatedPrice },
      );
    }

    // 2. Create the order (hold only; no money moves here).
    const create = await transactions.createOrder({
      offerId,
      passengers: dossier.passengers,
      contact: dossier.contact,
      ...(verify.data.workflowState ? { workflowState: verify.data.workflowState } : {}),
      clientReference: clientReferenceFor(intent),
    });
    if (!create.ok) {
      if (isReplayMiss(create) && deps.mode === 'REPLAY') return deps.fallback.execute(execution);
      // Ambiguous create: retrieve-before-recreate on any later attempt is
      // covered by the adapter's clientReference duplicate adoption; report
      // TIMEOUT honestly instead of claiming a definitive failure.
      if (create.error.category === 'TIMEOUT') {
        return {
          id: `exec-${intent.id}`,
          intentId: intent.id,
          executedAt: effectiveExecutedAt(intent, now),
          status: 'TIMEOUT',
          provenance: provenanceFor(create.meta.mode),
          providerId,
          error: {
            code: 'create_result_ambiguous',
            message: 'order creation timed out; reconcile via retrieve before recreating',
            retryable: true,
          },
        };
      }
      return providerFailure(
        execution, providerId, create.meta.mode,
        'order_create_failed',
        `order creation failed: ${create.error.category}/${create.error.code}`,
      );
    }
    const orderRef = create.data.transactionState?.orderRef;
    if (create.data.status === 'FAILED' || !orderRef) {
      return providerFailure(
        execution, providerId, create.meta.mode,
        'order_create_refused',
        create.data.detail ?? 'provider refused order creation',
        { orderStatus: create.data.status, ...(create.data.transactionState ? { transactionState: create.data.transactionState } : {}) },
      );
    }
    const heldEffects: Record<string, unknown> = {
      operation: intent.operation,
      orderStatus: create.data.status,
      transactionState: create.data.transactionState,
      ...(create.data.totalPrice ? { observedPayable: create.data.totalPrice } : {}),
    };

    // Hold-only authority semantics: flight.book NEVER chains into pay.
    if (intent.operation === 'flight.book') {
      return {
        id: `exec-${intent.id}`,
        intentId: intent.id,
        executedAt: effectiveExecutedAt(intent, now),
        status: 'SUCCESS',
        provenance: provenanceFor(create.meta.mode),
        providerId,
        resultSummary: `order ${orderRef} held without payment`,
        // Deliberately NOT marked CONFIRMS_CANDIDATE_STATE: a hold is not a
        // booking. HELD must never become a confirmed trip element (A2).
        observedEffects: { ...heldEffects, holdOnly: true },
      };
    }

    // 3. Payment gate against the ceiling authority reviewed.
    const reviewedSpend = reviewedSpendFor(intent);
    if (!reviewedSpend) {
      return providerFailure(
        execution, providerId, create.meta.mode,
        'authority_reviewed_no_spend',
        'intent carries no spendExposure, so authority evaluated no gross spend for this payment;' +
          ' order remains HELD, re-enter authority with the observed price',
        { ...heldEffects, paymentGate: 'authority_reviewed_no_spend' },
      );
    }
    const ceiling = ceilingFor(intent);
    const gate = paymentGateVerdict(create.data.totalPrice, ceiling);
    if (!gate.ok) {
      // DO NOT PAY. Preserve the HELD order and loop back to authority.
      return providerFailure(
        execution, providerId, create.meta.mode,
        gate.code,
        `${gate.message}; order remains HELD, re-enter viability/authority with the observed price`,
        { ...heldEffects, paymentGate: gate.code, authorisedCeiling: ceiling, reviewedSpend },
      );
    }

    // 4. Pay with the authoritative ceiling attached. The Atlas adapter
    //    independently re-checks the observed payable against this ceiling
    //    before issuing the provider payment (G3R-R1 A3).
    const pay = await transactions.payOrder({
      orderRef,
      paymentRef: dossier.paymentRef,
      authorisedAmount: ceiling as Money,
      clientReference: clientReferenceFor(intent),
    });
    if (!pay.ok) {
      if (isReplayMiss(pay) && deps.mode === 'REPLAY') return deps.fallback.execute(execution);
      // Ambiguous pay: retrieve-before-retry. PAID/TICKETED observed state
      // continues the sequence; HELD means the payment did not land.
      if (pay.error.category === 'TIMEOUT' || pay.error.code === 'payment_in_progress') {
        const retrieve = await transactions.retrieveOrder({
          orderRef,
          clientReference: clientReferenceFor(intent),
        });
        if (retrieve.ok && (retrieve.data.status === 'PAID' || retrieve.data.status === 'TICKETED' || retrieve.data.status === 'TICKETING')) {
          return observeTicketing(execution, providerId, retrieve.meta.mode, orderRef, retrieve.data.status);
        }
        return {
          id: `exec-${intent.id}`,
          intentId: intent.id,
          executedAt: effectiveExecutedAt(intent, now),
          status: 'TIMEOUT',
          provenance: provenanceFor(pay.meta.mode),
          providerId,
          observedEffects: heldEffects,
          error: {
            code: 'pay_result_ambiguous',
            message: 'payment result ambiguous and retrieve did not observe payment; order remains HELD',
            retryable: true,
          },
        };
      }
      return providerFailure(
        execution, providerId, pay.meta.mode,
        'order_pay_failed',
        `payment failed: ${pay.error.category}/${pay.error.code}`,
        heldEffects,
      );
    }
    if (pay.data.status === 'HELD' || pay.data.status === 'FAILED') {
      return providerFailure(
        execution, providerId, pay.meta.mode,
        'payment_not_accepted',
        pay.data.detail ?? 'provider did not accept payment; order remains HELD',
        { ...heldEffects, orderStatus: pay.data.status },
      );
    }

    // 5. Observe asynchronous ticketing through the read path.
    return observeTicketing(execution, providerId, pay.meta.mode, orderRef, pay.data.status);
  }

  async function observeTicketing(
    execution: AuthorisedExecution,
    providerId: string,
    mode: AdapterMode,
    orderRef: string,
    lastStatus: string,
  ): Promise<ExecutionResult> {
    const { intent } = execution;
    const transactions = deps.flightTransactions as FlightTransactionCapability;
    let status = lastStatus;
    let finalData: Record<string, unknown> = {};
    for (let attempt = 0; attempt < poll.attempts; attempt += 1) {
      const retrieve = await transactions.retrieveOrder({
        orderRef,
        clientReference: clientReferenceFor(intent),
      });
      if (retrieve.ok) {
        status = retrieve.data.status;
        finalData = {
          ...(retrieve.data.transactionState ? { transactionState: retrieve.data.transactionState } : {}),
          ...(retrieve.data.totalPrice ? { totalPrice: retrieve.data.totalPrice } : {}),
        };
        if (retrieve.data.status === 'TICKETED') {
          return {
            id: `exec-${intent.id}`,
            intentId: intent.id,
            executedAt: effectiveExecutedAt(intent, now),
            status: 'SUCCESS',
            provenance: provenanceFor(retrieve.meta.mode),
            providerId,
            resultSummary: `order ${orderRef} paid and ticketed`,
            observedEffects: {
              operation: intent.operation,
              orderStatus: 'TICKETED',
              // Issued tickets ARE the candidate state: safe to confirm.
              [CONFIRMS_CANDIDATE_STATE]: true,
              ...finalData,
            },
          };
        }
        if (retrieve.data.status === 'CANCELLED' || retrieve.data.status === 'FAILED') {
          return providerFailure(
            execution, providerId, retrieve.meta.mode,
            'order_failed_after_payment',
            `order observed ${retrieve.data.status} after payment`,
            { orderStatus: retrieve.data.status, ...finalData },
          );
        }
      }
      if (attempt < poll.attempts - 1) await sleep(poll.delayMs);
    }
    // PAID/TICKETING without issued tickets inside the bounded window is
    // honest TIMEOUT — never SUCCESS, so no premature confirmed mutation.
    return {
      id: `exec-${intent.id}`,
      intentId: intent.id,
      executedAt: effectiveExecutedAt(intent, now),
      status: 'TIMEOUT',
      provenance: provenanceFor(mode),
      providerId,
      observedEffects: { orderStatus: status, ...finalData },
      error: {
        code: 'ticketing_not_observed',
        message: `payment accepted but ticketing not observed within the bounded window (last status ${status})`,
        retryable: true,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Flight cancellation: quote -> submit -> observe status
  // -------------------------------------------------------------------------

  async function executeFlightCancellation(execution: AuthorisedExecution): Promise<ExecutionResult> {
    const { intent } = execution;
    const transactions = deps.flightTransactions;
    if (!transactions) return deps.fallback.execute(execution);
    const providerId = transactions.descriptor.providerId;
    const clientReference = clientReferenceFor(intent);

    const orderRef =
      stringParameter(intent, 'orderRef') ?? bookingRefsOf(intent)[0]?.reference;
    if (!orderRef) {
      return failure(
        execution,
        'missing_order_reference',
        'intent carries no provider order reference for cancellation',
      );
    }

    const quote = await transactions.quoteCancellation({ orderRef, clientReference });
    if (!quote.ok) {
      if (isReplayMiss(quote) && deps.mode === 'REPLAY') return deps.fallback.execute(execution);
      if (quote.error.category === 'TIMEOUT') {
        return {
          id: `exec-${intent.id}`,
          intentId: intent.id,
          executedAt: effectiveExecutedAt(intent, now),
          status: 'TIMEOUT',
          provenance: provenanceFor(quote.meta.mode),
          providerId,
          error: { code: 'cancel_quote_ambiguous', message: 'cancellation quote timed out', retryable: true },
        };
      }
      return providerFailure(
        execution, providerId, quote.meta.mode,
        'cancel_quote_failed',
        `cancellation quote failed: ${quote.error.category}/${quote.error.code}`,
      );
    }
    const quoteEffects = {
      cancellation: {
        availability: quote.data.availability,
        ...(quote.data.expectedReturn ? { expectedReturn: quote.data.expectedReturn } : {}),
        ...(quote.data.transactionState ? { transactionState: quote.data.transactionState } : {}),
      },
    };
    if (quote.data.availability === 'UNSUPPORTED') {
      // Normal data: provider does not support cancellation for this order.
      return {
        id: `exec-${intent.id}`,
        intentId: intent.id,
        executedAt: effectiveExecutedAt(intent, now),
        status: 'UNAVAILABLE',
        provenance: provenanceFor(quote.meta.mode),
        providerId,
        resultSummary: 'provider does not support cancellation for this order',
        observedEffects: quoteEffects,
      };
    }
    if (quote.data.availability === 'UNAVAILABLE' || quote.data.availability === 'UNKNOWN') {
      return {
        id: `exec-${intent.id}`,
        intentId: intent.id,
        executedAt: effectiveExecutedAt(intent, now),
        status: 'UNAVAILABLE',
        provenance: provenanceFor(quote.meta.mode),
        providerId,
        resultSummary: `cancellation ${quote.data.availability.toLowerCase()}: ${quote.data.detail ?? 'no detail'}`,
        observedEffects: quoteEffects,
      };
    }

    const quoteRef = quote.data.transactionState?.cancellationQuoteRef;
    const submit = await transactions.submitCancellation({
      orderRef,
      ...(quoteRef ? { cancellationQuoteRef: quoteRef } : {}),
      clientReference,
    });
    if (!submit.ok) {
      if (isReplayMiss(submit) && deps.mode === 'REPLAY') return deps.fallback.execute(execution);
      if (submit.error.category === 'TIMEOUT') {
        // Ambiguous submission: retrieve cancellation state before resubmitting.
        const status = await transactions.retrieveCancellationStatus({ orderRef, clientReference });
        if (status.ok && status.data.status !== 'UNKNOWN') {
          return cancellationStatusResult(execution, providerId, status.meta.mode, orderRef, status.data.status, status.data.expectedReturn, status.data.transactionState);
        }
        return {
          id: `exec-${intent.id}`,
          intentId: intent.id,
          executedAt: effectiveExecutedAt(intent, now),
          status: 'TIMEOUT',
          provenance: provenanceFor(submit.meta.mode),
          providerId,
          observedEffects: quoteEffects,
          error: { code: 'cancel_submit_ambiguous', message: 'cancellation submission timed out; retrieve status before resubmitting', retryable: true },
        };
      }
      return providerFailure(
        execution, providerId, submit.meta.mode,
        'cancel_submit_failed',
        `cancellation submission failed: ${submit.error.category}/${submit.error.code}`,
        quoteEffects,
      );
    }
    if (submit.data.status === 'REJECTED') {
      return providerFailure(
        execution, providerId, submit.meta.mode,
        'cancellation_rejected',
        submit.data.detail ?? 'provider rejected the cancellation submission',
        quoteEffects,
      );
    }

    // REQUEST_ACCEPTED/PROCESSING is acceptance only — observe final state.
    const requestRef = submit.data.transactionState?.cancellationRequestRef;
    const status = await transactions.retrieveCancellationStatus({
      orderRef,
      ...(requestRef ? { cancellationRequestRef: requestRef } : {}),
      clientReference,
    });
    if (!status.ok) {
      return {
        id: `exec-${intent.id}`,
        intentId: intent.id,
        executedAt: effectiveExecutedAt(intent, now),
        status: 'UNAVAILABLE',
        provenance: provenanceFor(status.meta.mode),
        providerId,
        resultSummary: 'cancellation submitted but status could not be observed',
        observedEffects: { ...quoteEffects, cancellationRequestRef: requestRef },
      };
    }
    return cancellationStatusResult(
      execution, providerId, status.meta.mode, orderRef,
      status.data.status, status.data.expectedReturn, status.data.transactionState,
    );
  }

  function cancellationStatusResult(
    execution: AuthorisedExecution,
    providerId: string,
    mode: AdapterMode,
    orderRef: string,
    status: 'REQUEST_ACCEPTED' | 'PROCESSING' | 'CANCELLED' | 'REJECTED' | 'UNKNOWN',
    expectedReturn: Money | undefined,
    transactionState: Record<string, unknown> | undefined,
  ): ExecutionResult {
    const { intent } = execution;
    const effects = {
      cancellation: {
        orderRef,
        status,
        ...(expectedReturn ? { expectedReturn } : {}),
        ...(transactionState ? { transactionState } : {}),
      },
    };
    if (status === 'CANCELLED') {
      return {
        id: `exec-${intent.id}`,
        intentId: intent.id,
        executedAt: effectiveExecutedAt(intent, now),
        status: 'SUCCESS',
        provenance: provenanceFor(mode),
        providerId,
        resultSummary: `order ${orderRef} observed cancelled`,
        observedEffects: { ...effects, [CONFIRMS_CANDIDATE_STATE]: true },
      };
    }
    if (status === 'REJECTED') {
      return providerFailure(execution, providerId, mode, 'cancellation_rejected', 'provider rejected the cancellation', effects);
    }
    // PROCESSING / REQUEST_ACCEPTED / UNKNOWN: truthful non-final result;
    // no authoritative CANCELLED mutation can follow from this execution.
    return {
      id: `exec-${intent.id}`,
      intentId: intent.id,
      executedAt: effectiveExecutedAt(intent, now),
      status: 'UNAVAILABLE',
      provenance: provenanceFor(mode),
      providerId,
      resultSummary: `cancellation still ${status.toLowerCase()}; final provider state not yet observed`,
      observedEffects: effects,
    };
  }

  // -------------------------------------------------------------------------
  // Hotel: quote -> gate -> book -> CONFIRMED -> cancel old -> CANCELLED
  // -------------------------------------------------------------------------

  async function executeHotelReplacement(execution: AuthorisedExecution): Promise<ExecutionResult> {
    const { intent } = execution;
    const hotel = deps.hotel;
    if (!hotel) return deps.fallback.execute(execution);
    const providerId = hotel.descriptor.providerId;
    const clientReference = clientReferenceFor(intent);

    const dossier = await deps.hotelDossier?.(intent);
    if (!dossier) {
      // REPLAY keeps historic simulation behaviour; LIVE/RECORD fail closed —
      // a money-moving hotel booking without validated identity never runs.
      if (deps.mode === 'REPLAY') return deps.fallback.execute(execution);
      return failure(
        execution,
        'hotel_dossier_absent',
        'no validated replacement dossier available for hotel execution',
      );
    }

    // 1. Quote/revalidate the replacement rate.
    const quote = await hotel.quoteRate({ rateId: dossier.replacementRateId });
    if (!quote.ok) {
      if (isReplayMiss(quote) && deps.mode === 'REPLAY') return deps.fallback.execute(execution);
      return providerFailure(
        execution, providerId, quote.meta.mode,
        'hotel_quote_failed',
        `replacement quote failed: ${quote.error.category}/${quote.error.code}`,
        undefined,
        quote.error.retryable,
      );
    }
    if (quote.data.status === 'UNAVAILABLE') {
      return providerFailure(execution, providerId, quote.meta.mode, 'hotel_quote_unavailable', 'replacement rate no longer available');
    }
    if (quote.data.status === 'PRICE_CHANGED') {
      return providerFailure(
        execution, providerId, quote.meta.mode,
        'hotel_quote_price_changed',
        'replacement rate price changed; re-enter viability/authority',
        { observedPrice: quote.data.quotedPrice },
      );
    }
    const quoteId = quote.data.quoteId;
    if (!quoteId) {
      return providerFailure(execution, providerId, quote.meta.mode, 'hotel_quote_handle_missing', 'quote returned no booking handle');
    }

    // 2. Cost gate against the ceiling authority reviewed (same discipline
    //    as flight payment: incomparable cost never books).
    const reviewedSpend = reviewedSpendFor(intent);
    if (!reviewedSpend) {
      return providerFailure(
        execution, providerId, quote.meta.mode,
        'authority_reviewed_no_spend',
        'intent carries no spendExposure, so authority evaluated no gross spend for this chargeable' +
          ' replacement; booking refused, re-enter authority with the observed price',
        { observedPrice: quote.data.quotedPrice },
      );
    }
    const ceiling = ceilingFor(intent);
    const gate = paymentGateVerdict(quote.data.quotedPrice, ceiling);
    if (!gate.ok) {
      return providerFailure(
        execution, providerId, quote.meta.mode,
        gate.code,
        `${gate.message}; replacement booking refused`,
        { observedPrice: quote.data.quotedPrice, paymentGate: gate.code, authorisedCeiling: ceiling, reviewedSpend },
      );
    }

    // 3. Book the replacement.
    const book = await hotel.bookStay({
      quoteId,
      guestNames: dossier.guestNames,
      ...(dossier.paymentRef ? { paymentRef: dossier.paymentRef } : {}),
      clientReference,
    });
    if (!book.ok) {
      if (isReplayMiss(book) && deps.mode === 'REPLAY') return deps.fallback.execute(execution);
      return providerFailure(
        execution, providerId, book.meta.mode,
        'hotel_book_failed',
        `replacement booking failed: ${book.error.category}/${book.error.code}`,
        undefined,
        book.error.retryable,
      );
    }
    if (!book.data.confirmed || !book.data.bookingId) {
      return providerFailure(
        execution, providerId, book.meta.mode,
        'hotel_booking_not_confirmed',
        'provider did not confirm the replacement booking; old stay NOT cancelled',
      );
    }
    const replacementBookingId = book.data.bookingId;

    // 4. Require observed CONFIRMED through the read path before touching
    //    the displaced stay (never strand the traveller).
    const retrieved = await hotel.retrieveBooking({ bookingId: replacementBookingId });
    if (!retrieved.ok || retrieved.data.status !== 'CONFIRMED') {
      return providerFailure(
        execution, providerId, retrieved.ok ? retrieved.meta.mode : book.meta.mode,
        'replacement_not_confirmed',
        `replacement booking ${replacementBookingId} not observed CONFIRMED; old stay NOT cancelled`,
        { replacementBookingId },
      );
    }
    const replacementEffects: Record<string, unknown> = {
      replacementBooking: {
        bookingId: replacementBookingId,
        status: 'CONFIRMED',
        ...(book.data.totalPrice ? { totalPrice: book.data.totalPrice } : {}),
        ...(book.data.providerConfirmationCode ? { providerConfirmationCode: book.data.providerConfirmationCode } : {}),
      },
    };

    // 5. Cancel the displaced stay, if one was identified.
    if (!dossier.displacedBookingId) {
      return {
        id: `exec-${intent.id}`,
        intentId: intent.id,
        executedAt: effectiveExecutedAt(intent, now),
        status: 'SUCCESS',
        provenance: provenanceFor(retrieved.meta.mode),
        providerId,
        resultSummary: `replacement booking ${replacementBookingId} confirmed; no displaced stay to cancel`,
        observedEffects: {
          operation: intent.operation,
          [CONFIRMS_CANDIDATE_STATE]: true,
          ...replacementEffects,
        },
      };
    }
    const displacedBookingId = dossier.displacedBookingId;
    const cancel = await hotel.cancelStay({ stayElementId: displacedBookingId });
    const cancelObserved = cancel.ok && cancel.data.confirmed;
    // Retrieve-before-concluding even when the cancel call reported success.
    const displacedStatus = await hotel.retrieveBooking({ bookingId: displacedBookingId });
    const displacedCancelled = displacedStatus.ok && displacedStatus.data.status === 'CANCELLED';
    if (!cancelObserved || !displacedCancelled) {
      // PARTIAL FAILURE: replacement confirmed, old stay still active. Both
      // provider states are preserved as duplicate exposure — never a fake
      // rollback, never FULLY_RECOVERED from this execution.
      return providerFailure(
        execution, providerId, (cancel.ok ? cancel.meta : displacedStatus.ok ? displacedStatus.meta : book.meta).mode,
        'displaced_stay_not_cancelled',
        'replacement confirmed but displaced stay cancellation was not observed; duplicate booking exposure preserved',
        {
          ...replacementEffects,
          duplicateBookingExposure: true,
          displacedBooking: {
            bookingId: displacedBookingId,
            status: displacedStatus.ok ? displacedStatus.data.status : 'UNKNOWN',
            ...(displacedStatus.ok && displacedStatus.data.cancellationFee
              ? { cancellationFee: displacedStatus.data.cancellationFee }
              : {}),
          },
        },
      );
    }
    return {
      id: `exec-${intent.id}`,
      intentId: intent.id,
      executedAt: effectiveExecutedAt(intent, now),
      status: 'SUCCESS',
      provenance: provenanceFor(displacedStatus.meta.mode),
      providerId,
      resultSummary: `replacement ${replacementBookingId} confirmed and displaced stay ${displacedBookingId} cancelled`,
      observedEffects: {
        operation: intent.operation,
        [CONFIRMS_CANDIDATE_STATE]: true,
        ...replacementEffects,
        displacedBooking: {
          bookingId: displacedBookingId,
          status: 'CANCELLED',
          ...(displacedStatus.data.cancellationFee ? { cancellationFee: displacedStatus.data.cancellationFee } : {}),
        },
      },
    };
  }

  // -------------------------------------------------------------------------
  // Dispatch
  // -------------------------------------------------------------------------

  return {
    execute: async (execution: AuthorisedExecution): Promise<ExecutionResult> => {
      const issues = executionGateIssues(execution);
      if (issues.length > 0) return deps.fallback.execute(execution);
      // Structural backstop: never let a provider call outrank the
      // side-effect level authority actually reviewed (G3R-R1 A1). This
      // fails LOUD rather than falling back to simulation, because a
      // misclassified consequential intent is a policy defect to surface,
      // not a case to quietly simulate.
      const required = insufficientSideEffectLevel(execution.intent);
      if (required !== undefined) {
        return failure(
          execution,
          'side_effect_level_misclassified',
          `operation ${execution.intent.operation} performs a ${required} provider side effect but the` +
            ` intent authority reviewed was declared ${execution.intent.sideEffectLevel}; refusing to execute`,
        );
      }
      switch (execution.intent.operation) {
        case 'flight.book':
        case 'flight.pay':
        case 'flight.change':
          return executeFlightBooking(execution);
        case 'flight.cancel':
          return executeFlightCancellation(execution);
        case 'hotel.modify':
        case 'hotel.book':
          return executeHotelReplacement(execution);
        default:
          return deps.fallback.execute(execution);
      }
    },
  };
}

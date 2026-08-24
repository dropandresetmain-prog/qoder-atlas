/**
 * DR-2 — Atlas FlightTransactionCapability adapter (G3R-R0 seams ADR-042..043).
 *
 * Implements the frozen provider-neutral transaction surface against the
 * Atlas sandbox for the empirically proven operations:
 *
 *   createOrder            -> order.do            (hold without payment)
 *   payOrder               -> pay.do              (sandbox test-balance only)
 *   retrieveOrder          -> queryOrderDetails.do
 *   quoteCancellation      -> voidQuotation.do    ("void" stays in this file)
 *   submitCancellation     -> void.do
 *   retrieveCancellationStatus -> queryVoidOrders.do
 *
 * Safety rules enforced here (adapter boundary):
 *  - Consequential calls are REFUSED unless the configured base URL is
 *    unambiguously the Atlas sandbox host. Any other environment fails
 *    closed (no production side effects are ever reachable).
 *  - Payment uses ONLY the opaque sandbox test-balance handle; the seam
 *    structurally cannot carry PAN/CVV, and unrecognised payment refs are
 *    rejected rather than guessed.
 *  - transactionState is a curated mapping of deliberately selected
 *    reconciliation fields — raw provider responses are never dumped into it.
 *  - Provider status numbers are mapped inside this adapter only; generic
 *    application code receives the frozen FlightOrderStatus /
 *    FlightCancellationStatus vocabulary.
 *
 * LIVE/RECORD/REPLAY share one normalization path through runAdapter; the
 * recording key is a PII-free projection of the generic query.
 */
import type { AdapterMode, CapabilityResult, ProviderAdapter } from '../../contracts/envelope.ts';
import type {
  CapabilityDescriptor,
  FlightCancellationQuoteOutcome,
  FlightCancellationQuoteQuery,
  FlightCancellationStatusQuery,
  FlightCancellationStatusView,
  FlightCancellationSubmitOutcome,
  FlightCancellationSubmitQuery,
  FlightOrderCreateQuery,
  FlightOrderOutcome,
  FlightOrderPayQuery,
  FlightOrderRetrieveQuery,
  FlightOrderStatusView,
  FlightTransactionCapability,
  FlightTransactionState,
} from '../../contracts/capabilities.ts';
import type { Money } from '../../domain/common.ts';
import type { RecordingStore } from '../recordingStore.ts';
import { capabilityFailure, runAdapter } from '../runner.ts';
import { AtlasClient } from './client.ts';
import type { AtlasEndpoint } from './client.ts';
import {
  AtlasOrderBodySchema,
  AtlasOrderDetailsBodySchema,
  AtlasPayBodySchema,
  AtlasVoidBodySchema,
  AtlasVoidOrdersBodySchema,
  AtlasVoidQuotationBodySchema,
  type AtlasOrderBody,
  type AtlasOrderDetailsBody,
  type AtlasPayBody,
  type AtlasVoidBody,
  type AtlasVoidOrdersBody,
  type AtlasVoidQuotationBody,
} from './types.ts';
import { ATLAS_PROVIDER_ID } from './adapter.ts';

/** The only Atlas environment this adapter may execute transactions against. */
export const ATLAS_SANDBOX_HOST = 'sandbox.atriptech.com';

/**
 * The approved opaque sandbox payment reference. It maps INSIDE this adapter
 * to Atlas's balance/deposit test payment mechanism; the generic seam never
 * sees a provider payment-method identifier, and no other handle is
 * accepted (fail closed, never guessed).
 */
export const ATLAS_SANDBOX_BALANCE_PAYMENT_REF = 'atlas-sandbox-balance';

/** Atlas payment method 1 = account balance/deposit (sandbox test funding). */
const ATLAS_PAYMENT_METHOD_BALANCE = 1;

export interface AtlasTransactionAdapterOptions {
  mode: AdapterMode;
  store: RecordingStore;
  baseUrl?: string;
  clientId?: string;
  clientSecret?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

type TransactionProvenance = 'LIVE' | 'REPLAY';

/** Recording-key projection for pay: reconciliation refs only. */
interface OrderPayRequest {
  orderRef: string;
  clientReference?: string;
}

const LATIN_NAME = /^[A-Za-z][A-Za-z ]*$/;
const FAMILY_GIVEN_NAME = /^[A-Za-z][A-Za-z ]*\/[A-Za-z][A-Za-z ]*$/;
const ATLAS_MOBILE = /^\d{4}-\d{8}$/;

export class AtlasFlightTransactionAdapter implements FlightTransactionCapability {
  readonly descriptor: CapabilityDescriptor;
  private readonly mode: AdapterMode;
  private readonly store: RecordingStore;
  private readonly baseUrl?: string;
  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly timeoutMs?: number;
  private readonly fetchImpl?: typeof fetch;

  constructor(options: AtlasTransactionAdapterOptions) {
    this.mode = options.mode;
    this.store = options.store;
    this.baseUrl = options.baseUrl;
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.timeoutMs = options.timeoutMs;
    this.fetchImpl = options.fetchImpl;
    this.descriptor = {
      family: 'FLIGHT',
      providerId: ATLAS_PROVIDER_ID,
      mode: options.mode,
      supportedOperations: [
        'flight.book',
        'flight.pay',
        'flight.order_status',
        'flight.cancel_quote',
        'flight.cancel_status',
        'flight.cancel',
      ],
      maxSideEffectLevel: 'MONEY_MOVING',
    };
  }

  // -------------------------------------------------------------------------
  // Order lifecycle
  // -------------------------------------------------------------------------

  async createOrder(query: FlightOrderCreateQuery): Promise<CapabilityResult<FlightOrderOutcome>> {
    const problem = validateCreateQuery(query);
    if (problem) return this.invalidRequest(problem);

    const sessionId = typeof query.workflowState?.['sessionId'] === 'string'
      ? (query.workflowState['sessionId'] as string)
      : undefined;
    if (!sessionId) {
      return this.invalidRequest(
        'createOrder requires the verified session workflow state (sessionId from verify); refusing to book unverified',
      );
    }

    const provenance = this.provenance();
    const adapter: ProviderAdapter<FlightOrderCreateQuery, AtlasOrderBody, FlightOrderOutcome> = {
      providerId: ATLAS_PROVIDER_ID,
      mode: this.mode,
      obtainRaw: async (request) => {
        const body = await this.post('/order.do', {
          sessionId,
          passengers: request.passengers.map((passenger) => ({
            name: `${passenger.familyName}/${passenger.givenName}`,
            // The generic seam carries no passenger-type vocabulary; the
            // documented deterministic adapter default is adult.
            passengerType: 0,
            gender: passenger.gender === 'MALE' ? 'M' : 'F',
            ...(passenger.dateOfBirth === undefined
              ? {}
              : { birthday: passenger.dateOfBirth.replaceAll('-', '') }),
            ...(passenger.nationality === undefined ? {} : { nationality: passenger.nationality }),
          })),
          contact: {
            name: request.contact.name,
            ...(request.contact.email === undefined ? {} : { email: request.contact.email }),
            ...(request.contact.phone !== undefined && ATLAS_MOBILE.test(request.contact.phone)
              ? { mobile: request.contact.phone }
              : {}),
          },
        });
        return AtlasOrderBodySchema.parse(body);
      },
      normalize: (raw) => normalizeOrderCreate(raw, provenance),
    };
    // PII-free recording key: identity counts and refs only, never names.
    return runAdapter(
      adapter,
      this.store,
      query,
      { operation: 'order_create', secrets: this.secrets() },
    );
  }

  async payOrder(query: FlightOrderPayQuery): Promise<CapabilityResult<FlightOrderOutcome>> {
    if (!query.orderRef) return this.invalidRequest('payOrder requires orderRef');
    if (query.paymentRef !== ATLAS_SANDBOX_BALANCE_PAYMENT_REF) {
      return this.invalidRequest(
        'payOrder only accepts the approved sandbox test-balance payment reference; ' +
          'no other payment handle is mapped (raw card data can never cross this seam)',
      );
    }

    const provenance = this.provenance();
    const adapter: ProviderAdapter<OrderPayRequest, AtlasPayBody, FlightOrderOutcome> = {
      providerId: ATLAS_PROVIDER_ID,
      mode: this.mode,
      obtainRaw: async (request) => {
        const body = await this.post('/pay.do', {
          orderNo: request.orderRef,
          paymentMethod: ATLAS_PAYMENT_METHOD_BALANCE,
          ...(request.clientReference === undefined ? {} : { clientOrderNo: request.clientReference }),
        });
        return AtlasPayBodySchema.parse(body);
      },
      normalize: (raw) => normalizeOrderPay(raw, query.orderRef, provenance),
    };
    return runAdapter(
      adapter,
      this.store,
      { orderRef: query.orderRef, ...(query.clientReference === undefined ? {} : { clientReference: query.clientReference }) },
      { operation: 'order_pay', secrets: this.secrets() },
    );
  }

  async retrieveOrder(
    query: FlightOrderRetrieveQuery,
  ): Promise<CapabilityResult<FlightOrderStatusView>> {
    if (!query.orderRef) return this.invalidRequest('retrieveOrder requires orderRef');

    const provenance = this.provenance();
    const adapter: ProviderAdapter<FlightOrderRetrieveQuery, AtlasOrderDetailsBody, FlightOrderStatusView> = {
      providerId: ATLAS_PROVIDER_ID,
      mode: this.mode,
      obtainRaw: async (request) => {
        const body = await this.post('/queryOrderDetails.do', { orderNo: request.orderRef });
        return AtlasOrderDetailsBodySchema.parse(body);
      },
      normalize: (raw) => normalizeOrderDetails(raw, query.orderRef, provenance),
    };
    return runAdapter(
      adapter,
      this.store,
      { orderRef: query.orderRef },
      { operation: 'order_retrieve', secrets: this.secrets() },
    );
  }

  // -------------------------------------------------------------------------
  // Cancellation lifecycle (Atlas "void" terminology stays in this adapter)
  // -------------------------------------------------------------------------

  async quoteCancellation(
    query: FlightCancellationQuoteQuery,
  ): Promise<CapabilityResult<FlightCancellationQuoteOutcome>> {
    if (!query.orderRef) return this.invalidRequest('quoteCancellation requires orderRef');

    const provenance = this.provenance();
    const adapter: ProviderAdapter<
      FlightCancellationQuoteQuery,
      AtlasVoidQuotationBody,
      FlightCancellationQuoteOutcome
    > = {
      providerId: ATLAS_PROVIDER_ID,
      mode: this.mode,
      obtainRaw: async (request) => {
        const body = await this.post('/voidQuotation.do', { orderNo: request.orderRef });
        return AtlasVoidQuotationBodySchema.parse(body);
      },
      normalize: (raw) => normalizeCancellationQuote(raw, provenance),
    };
    return runAdapter(
      adapter,
      this.store,
      { orderRef: query.orderRef },
      { operation: 'cancel_quote', secrets: this.secrets() },
    );
  }

  async submitCancellation(
    query: FlightCancellationSubmitQuery,
  ): Promise<CapabilityResult<FlightCancellationSubmitOutcome>> {
    if (!query.orderRef) return this.invalidRequest('submitCancellation requires orderRef');
    if (!query.cancellationQuoteRef) {
      return this.invalidRequest(
        'submitCancellation requires a prior cancellation quote handle; quote before submit',
      );
    }

    const provenance = this.provenance();
    const adapter: ProviderAdapter<
      FlightCancellationSubmitQuery,
      AtlasVoidBody,
      FlightCancellationSubmitOutcome
    > = {
      providerId: ATLAS_PROVIDER_ID,
      mode: this.mode,
      obtainRaw: async (request) => {
        const body = await this.post('/void.do', {
          orderNo: request.orderRef,
          voidOfferId: request.cancellationQuoteRef,
        });
        return AtlasVoidBodySchema.parse(body);
      },
      normalize: (raw) => normalizeCancellationSubmit(raw, query.orderRef, provenance),
    };
    return runAdapter(
      adapter,
      this.store,
      { orderRef: query.orderRef, cancellationQuoteRef: query.cancellationQuoteRef },
      { operation: 'cancel_submit', secrets: this.secrets() },
    );
  }

  async retrieveCancellationStatus(
    query: FlightCancellationStatusQuery,
  ): Promise<CapabilityResult<FlightCancellationStatusView>> {
    if (!query.orderRef) return this.invalidRequest('retrieveCancellationStatus requires orderRef');

    const provenance = this.provenance();
    const adapter: ProviderAdapter<
      FlightCancellationStatusQuery,
      AtlasVoidOrdersBody,
      FlightCancellationStatusView
    > = {
      providerId: ATLAS_PROVIDER_ID,
      mode: this.mode,
      obtainRaw: async (request) => {
        const body = await this.post('/queryVoidOrders.do', {
          orderNo: request.orderRef,
          ...(request.cancellationRequestRef === undefined
            ? {}
            : { voidCode: request.cancellationRequestRef }),
        });
        return AtlasVoidOrdersBodySchema.parse(body);
      },
      normalize: (raw) => normalizeCancellationStatus(raw, query.orderRef, query.cancellationRequestRef, provenance),
    };
    return runAdapter(
      adapter,
      this.store,
      {
        orderRef: query.orderRef,
        ...(query.cancellationRequestRef === undefined
          ? {}
          : { cancellationRequestRef: query.cancellationRequestRef }),
      },
      { operation: 'cancel_status', secrets: this.secrets() },
    );
  }

  // -------------------------------------------------------------------------
  // Transport / environment policy
  // -------------------------------------------------------------------------

  private async post(endpoint: AtlasEndpoint, body: Record<string, unknown>): Promise<unknown> {
    return this.transactionalClient().post(endpoint, body);
  }

  /**
   * Fail-closed environment gate: REPLAY never calls the provider, missing
   * credentials are NOT_CONFIGURED, and ANY non-sandbox base URL is refused
   * outright for the transaction surface. A transactional call only ever
   * reaches an unambiguously sandbox environment.
   */
  private transactionalClient(): AtlasClient {
    if (this.mode === 'REPLAY') {
      throw capabilityFailure('PROVIDER_ERROR', 'atlas_live_call_in_replay', 'REPLAY must not call the provider');
    }
    if (!this.baseUrl || !this.clientId || !this.clientSecret) {
      throw capabilityFailure(
        'NOT_CONFIGURED',
        'atlas_missing_credentials',
        'Atlas LIVE/RECORD requires ATLAS_BASE_URL, ATLAS_CLIENT_ID and ATLAS_CLIENT_SECRET',
      );
    }
    if (!isAtlasSandboxBaseUrl(this.baseUrl)) {
      throw capabilityFailure(
        'NOT_CONFIGURED',
        'atlas_not_sandbox',
        'Atlas transactional operations are only permitted against the sandbox host; refusing to execute',
      );
    }
    return new AtlasClient({
      baseUrl: this.baseUrl,
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      ...(this.timeoutMs === undefined ? {} : { timeoutMs: this.timeoutMs }),
      ...(this.fetchImpl === undefined ? {} : { fetchImpl: this.fetchImpl }),
    });
  }

  private secrets(): string[] {
    return [this.clientId, this.clientSecret].filter((value): value is string => typeof value === 'string');
  }

  private provenance(): TransactionProvenance {
    // RECORD is still a genuine live execution (it additionally persists a
    // sanitized recording); only REPLAY reads recorded evidence.
    return this.mode === 'REPLAY' ? 'REPLAY' : 'LIVE';
  }

  private invalidRequest<T>(message: string): CapabilityResult<T> {
    return {
      ok: false,
      error: { category: 'INVALID_REQUEST', code: 'invalid_transaction_query', message },
      meta: { providerId: ATLAS_PROVIDER_ID, mode: this.mode, requestedAt: new Date().toISOString() },
    };
  }
}

/** True only when the base URL's host is unambiguously the Atlas sandbox. */
export function isAtlasSandboxBaseUrl(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === ATLAS_SANDBOX_HOST;
  } catch {
    return false;
  }
}

function validateCreateQuery(query: FlightOrderCreateQuery): string | undefined {
  if (!query.clientReference) return 'createOrder requires clientReference (idempotency key)';
  if (query.passengers.length === 0) return 'createOrder requires at least one passenger';
  for (const passenger of query.passengers) {
    if (!LATIN_NAME.test(passenger.familyName) || !LATIN_NAME.test(passenger.givenName)) {
      return `passenger name must be Latin letters for provider wire format: ${passenger.familyName}/${passenger.givenName}`;
    }
    if (passenger.gender !== 'MALE' && passenger.gender !== 'FEMALE') {
      return 'provider requires a mappable passenger gender (MALE/FEMALE); refusing to invent one';
    }
  }
  if (!FAMILY_GIVEN_NAME.test(query.contact.name)) {
    return 'contact.name must use the provider Family/Given Latin format';
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Normalizers (shared by LIVE/RECORD/REPLAY; provider statuses mapped here)
// ---------------------------------------------------------------------------

/**
 * Provider-local deadline string ("yyyy-MM-dd HH:mm:ss", Atlas SGT = UTC+8)
 * to an honest ISO instant. Fixed offset: host timezone can never shift it.
 */
export function atlasSgtDeadlineToIso(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}+08:00`;
}

function money(amount: number | null | undefined, currency: string | null | undefined): Money | undefined {
  if (amount == null || !currency) return undefined;
  return { amount, currency };
}

function providerDetail(raw: { status: number; msg?: string | null }): string {
  return `provider status ${raw.status}${raw.msg ? `: ${raw.msg}` : ''}`;
}

/** First usable order reference from a duplicate-detection payload. */
function duplicateOrderRef(entries: AtlasOrderBody['duplicateOrders']): string | undefined {
  for (const entry of entries ?? []) {
    if (typeof entry === 'string') {
      if (entry !== '') return entry;
      continue;
    }
    if (typeof entry.orderNo === 'string' && entry.orderNo !== '') return entry.orderNo;
  }
  return undefined;
}

export function normalizeOrderCreate(raw: AtlasOrderBody, provenance: TransactionProvenance): FlightOrderOutcome {
  // Provider-native duplicate detection (create ambiguity reconciliation):
  // a repeated create for the same session returns the existing order — adopt
  // it instead of producing a second booking.
  if (raw.status === 318) {
    // Wire reality: duplicateOrders entries arrive as either plain order-number
    // strings or objects carrying orderNo — both shapes are reconciled here.
    const adopted = duplicateOrderRef(raw.duplicateOrders);
    if (adopted) {
      return {
        status: 'HELD',
        transactionState: { orderRef: adopted },
        detail: 'provider detected a duplicate order; existing held order adopted, no second booking created',
        provenance,
      };
    }
  }
  if (raw.status !== 0 || !raw.orderNo) {
    return {
      status: 'FAILED',
      detail: raw.status !== 0 ? `order creation failed (${providerDetail(raw)})` : 'order creation returned no order reference',
      provenance,
    };
  }
  const transactionState: FlightTransactionState = { orderRef: raw.orderNo };
  if (raw.pnrCode) transactionState.providerRecordLocator = raw.pnrCode;
  const holdExpiresAt = atlasSgtDeadlineToIso(raw.tktLimitTime);
  if (holdExpiresAt) transactionState.holdExpiresAt = holdExpiresAt;
  const ticketRefs = ticketRefsFrom(raw.paxTicketInfos);
  if (ticketRefs.length > 0) transactionState.ticketRefs = ticketRefs;
  return {
    // flight.book is hold-without-payment: creation never moves money.
    status: 'HELD',
    transactionState,
    ...(money(raw.totalPrice, raw.currency) === undefined ? {} : { totalPrice: money(raw.totalPrice, raw.currency) }),
    detail: 'held order created; payment not yet requested',
    provenance,
  };
}

export function normalizeOrderPay(
  raw: AtlasPayBody,
  orderRef: string,
  provenance: TransactionProvenance,
): FlightOrderOutcome {
  const transactionState: FlightTransactionState = { orderRef: raw.orderNo ?? orderRef };
  if (raw.status === 0) {
    return {
      status: 'PAID',
      transactionState,
      detail: 'payment accepted; ticketing may still be asynchronous — retrieve before treating as ticketed',
      provenance,
    };
  }
  if (raw.status === 404) {
    // Idempotency signal: the order is already paid. Never re-pay.
    return {
      status: 'PAID',
      transactionState,
      detail: 'provider reports the order is already paid; no duplicate payment was issued',
      provenance,
    };
  }
  if (raw.status === 402) {
    return {
      status: 'PAID',
      transactionState,
      detail: 'provider reports the order is already beyond the payment stage; retrieve for ticketing state',
      provenance,
    };
  }
  if (raw.status === 406) {
    // Payment in flight: no trustworthy observation. The reconciliation
    // discipline is retrieve-before-retry, never blind re-payment.
    return {
      status: 'UNKNOWN',
      transactionState,
      detail: 'provider reports payment in progress; retrieve the order before any retry',
      provenance,
    };
  }
  return {
    status: 'FAILED',
    transactionState,
    detail: `payment not accepted (${providerDetail(raw)}); order remains held`,
    provenance,
  };
}

export function normalizeOrderDetails(
  raw: AtlasOrderDetailsBody,
  orderRef: string,
  provenance: TransactionProvenance,
): FlightOrderStatusView {
  const transactionState: FlightTransactionState = { orderRef: raw.orderNo ?? orderRef };
  const locator = raw.airlineBookings?.find((entry) => typeof entry.airlinePnr === 'string' && entry.airlinePnr !== '')
    ?.airlinePnr ?? raw.pnrCode;
  if (locator) transactionState.providerRecordLocator = locator;
  const ticketRefs = ticketRefsFrom(raw.paxTicketInfos);
  if (ticketRefs.length > 0) transactionState.ticketRefs = ticketRefs;
  const holdExpiresAt = atlasSgtDeadlineToIso(raw.tktLimitTime);
  if (holdExpiresAt) transactionState.holdExpiresAt = holdExpiresAt;

  const observedAt = new Date().toISOString();
  const base = {
    orderRef: raw.orderNo ?? orderRef,
    transactionState,
    ...(money(raw.totalPrice, raw.currency) === undefined ? {} : { totalPrice: money(raw.totalPrice, raw.currency) }),
    observedAt,
    provenance,
  };

  if (raw.status !== 0) {
    return { ...base, status: 'UNKNOWN', detail: `order query failed (${providerDetail(raw)})` };
  }
  // Issued tickets are the strongest observation: TICKETED regardless of the
  // coarse order-status digit. PAID alone never implies ticketing completed.
  if (ticketRefs.length > 0) {
    return { ...base, status: 'TICKETED', detail: 'provider observes issued ticket(s)' };
  }
  const orderStatus = raw.orderStatus === undefined ? undefined : String(raw.orderStatus);
  if (orderStatus === '0') return { ...base, status: 'HELD', detail: 'provider observes an unpaid held order' };
  if (orderStatus === '1') {
    return { ...base, status: 'PAID', detail: 'payment accepted; ticketing may still be in progress' };
  }
  if (orderStatus === '2') return { ...base, status: 'TICKETED', detail: 'provider observes the order as ticketed' };
  return { ...base, status: 'UNKNOWN', detail: `unmapped provider order status ${String(raw.orderStatus)}` };
}

export function normalizeCancellationQuote(
  raw: AtlasVoidQuotationBody,
  provenance: TransactionProvenance,
): FlightCancellationQuoteOutcome {
  // Provider-unsupported cancellation is NORMAL DATA, never an exception.
  if (raw.status === 843 || raw.status === 841) {
    return { availability: 'UNSUPPORTED', detail: providerDetail(raw), provenance };
  }
  if (raw.status === 808 || raw.status === 820 || raw.status === 822 || raw.status === 805) {
    return {
      availability: 'UNAVAILABLE',
      conditions: [providerDetail(raw)],
      detail: 'provider declined the cancellation quote for this order',
      provenance,
    };
  }
  if (raw.status === 803 || raw.status === 814 || raw.status === 816 || raw.status === 817 || raw.status === 818) {
    return {
      availability: 'UNAVAILABLE',
      conditions: ['a cancellation request is already submitted or in progress for this order'],
      detail: providerDetail(raw),
      provenance,
    };
  }
  if (raw.status === 801 || raw.status === 815 || raw.status === 824) {
    return { availability: 'UNKNOWN', detail: providerDetail(raw), provenance };
  }
  if (raw.status !== 0) {
    return { availability: 'UNKNOWN', detail: providerDetail(raw), provenance };
  }

  const conditions: string[] = [];
  if (raw.voidMethod) conditions.push(`return method: ${raw.voidMethod}`);
  if (raw.serviceFee?.transactionFee !== undefined) {
    conditions.push(
      `service fee: ${raw.serviceFee.transactionFee} ${raw.serviceFee.currency ?? ''}`.trim(),
    );
  }
  if (raw.voidWindow?.sameDayDeadlineTime) {
    conditions.push(
      `same-day deadline: ${raw.voidWindow.sameDayDeadlineTime}${raw.voidWindow.sameDayTimezone ? ` (${raw.voidWindow.sameDayTimezone})` : ''}`,
    );
  }
  if (raw.voidWindow?.voidTimeBeforeDepature) {
    conditions.push(`must void before departure by: ${raw.voidWindow.voidTimeBeforeDepature}`);
  }

  const expectedReturn = money(raw.voidFareAmount?.estimatedRefundAmount, raw.voidFareAmount?.currency);
  if (raw.isVoidable !== false && raw.voidOfferId) {
    return {
      availability: 'AVAILABLE',
      ...(expectedReturn === undefined ? {} : { expectedReturn }),
      ...(conditions.length === 0 ? {} : { conditions }),
      transactionState: {
        ...(raw.orderNo ? { orderRef: raw.orderNo } : {}),
        cancellationQuoteRef: raw.voidOfferId,
      },
      detail: 'cancellation quote issued; submission is a separate consequential step',
      provenance,
    };
  }
  return {
    availability: 'UNAVAILABLE',
    ...(conditions.length === 0 ? {} : { conditions }),
    detail: raw.isVoidable === false ? 'provider reports the order is not cancellable' : 'no cancellation offer issued',
    provenance,
  };
}

export function normalizeCancellationSubmit(
  raw: AtlasVoidBody,
  orderRef: string,
  provenance: TransactionProvenance,
): FlightCancellationSubmitOutcome {
  const transactionState: FlightTransactionState = { orderRef: raw.orderNo ?? orderRef };
  if (raw.voidCode) transactionState.cancellationRequestRef = raw.voidCode;

  if (raw.status === 0) {
    // Submission acceptance is NEVER final cancellation: REQUEST_ACCEPTED
    // only; the final state must be retrieved and observed separately.
    return {
      status: 'REQUEST_ACCEPTED',
      transactionState,
      detail: 'cancellation request accepted; processing must be observed via status retrieval',
      provenance,
    };
  }
  if (raw.status === 803 || raw.status === 814 || raw.status === 816 || raw.status === 817 || raw.status === 818) {
    // Idempotency signal: a request already exists — never resubmit blindly.
    return {
      status: 'REQUEST_ACCEPTED',
      transactionState,
      detail: `submission already recorded by provider (${providerDetail(raw)}); retrieve cancellation status`,
      provenance,
    };
  }
  if (
    raw.status === 805 ||
    raw.status === 808 ||
    raw.status === 820 ||
    raw.status === 822 ||
    raw.status === 841 ||
    raw.status === 843
  ) {
    return {
      status: 'REJECTED',
      transactionState,
      detail: `cancellation submission rejected (${providerDetail(raw)})`,
      provenance,
    };
  }
  return {
    status: 'UNKNOWN',
    transactionState,
    detail: `unmapped cancellation submission result (${providerDetail(raw)})`,
    provenance,
  };
}

export function normalizeCancellationStatus(
  raw: AtlasVoidOrdersBody,
  orderRef: string,
  cancellationRequestRef: string | undefined,
  provenance: TransactionProvenance,
): FlightCancellationStatusView {
  const base = {
    orderRef,
    observedAt: new Date().toISOString(),
    provenance,
  };
  if (raw.status !== 0) {
    return { ...base, status: 'UNKNOWN', detail: `cancellation status query failed (${providerDetail(raw)})` };
  }
  const orders = raw.voidOrders ?? [];
  const entry = cancellationRequestRef
    ? orders.find((candidate) => candidate.voidCode === cancellationRequestRef) ?? orders[0]
    : orders[0];
  if (!entry) {
    return {
      ...base,
      status: 'UNKNOWN',
      detail: 'no cancellation request observed for this order',
    };
  }
  const transactionState: FlightTransactionState = { orderRef };
  if (entry.voidCode) transactionState.cancellationRequestRef = entry.voidCode;
  const expectedReturn = money(entry.voidFareAmount?.estimatedRefundAmount, entry.voidFareAmount?.currency);

  const mapped = mapVoidStatus(entry.voidStatus);
  return {
    ...base,
    status: mapped.status,
    transactionState,
    ...(expectedReturn === undefined ? {} : { expectedReturn }),
    detail: mapped.detail ?? `provider cancellation state ${String(entry.voidStatus)}`,
  };
}

/** Provider-private void processing states -> generic cancellation status. */
function mapVoidStatus(voidStatus: number | null | undefined): {
  status: FlightCancellationStatusView['status'];
  detail?: string;
} {
  switch (voidStatus) {
    case 0:
      return { status: 'PROCESSING', detail: 'cancellation accepted; processing at provider' };
    case 1:
      return { status: 'PROCESSING', detail: 'cancellation processing with the carrier' };
    case 3:
      return { status: 'PROCESSING', detail: 'carrier refund in progress' };
    case 2:
      return { status: 'CANCELLED', detail: 'provider observes the order cancelled (refund settled)' };
    case 5:
      return { status: 'CANCELLED', detail: 'provider observes cancellation fulfilment complete' };
    case 4:
      return { status: 'REJECTED', detail: 'provider rejected the cancellation request' };
    case 6:
      return { status: 'REJECTED', detail: 'cancellation request withdrawn' };
    default:
      return { status: 'UNKNOWN' };
  }
}

function ticketRefsFrom(
  paxTicketInfos: Array<{ ticketNos?: string[] }> | null | undefined,
): string[] {
  const refs: string[] = [];
  for (const info of paxTicketInfos ?? []) {
    for (const ticketNo of info.ticketNos ?? []) {
      if (ticketNo && !refs.includes(ticketNo)) refs.push(ticketNo);
    }
  }
  return refs;
}

/**
 * Wave 3R Mission 1C — LIVE sandbox validation through the implemented code.
 *
 * Drives the DR-2 provider-backed executor + Atlas transaction adapter +
 * Nuitée adapter against the real sandbox environments in RECORD mode:
 * genuine provider execution with sanitized recordings persisted under
 * fixtures/recordings (additive only), and a sanitized evidence summary
 * written to output/wave3r-mission1-live-evidence.json.
 *
 * Safety:
 *  - Atlas transactional calls are refused unless the configured base URL is
 *    unambiguously the sandbox host (adapter fail-closed gate re-checked here).
 *  - Payment uses ONLY the provider sandbox test-balance reference; the pay
 *    adapter rejects any other paymentRef. No card data exists in this seam.
 *  - Passenger/guest identity is synthetic; no real PII is transmitted.
 *  - Every created resource is tracked and cancelled/observed before exit.
 *  - Credentials are read from config and never printed.
 *
 * Run: node --experimental-strip-types scripts/wave3r-live-validation.ts [offerIndex] [resumeOrderRef]
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from '../src/config/config.ts';
import { FileRecordingStore } from '../src/providers/recordingStore.ts';
import { AtlasFlightAdapter } from '../src/providers/atlas/adapter.ts';
import type { AtlasTimezoneResolver } from '../src/providers/atlas/normalize.ts';
import {
  AtlasFlightTransactionAdapter,
  ATLAS_SANDBOX_BALANCE_PAYMENT_REF,
  isAtlasSandboxBaseUrl,
} from '../src/providers/atlas/transactionAdapter.ts';
import { NuiteeAdapter } from '../src/providers/hotel/nuiteeAdapter.ts';
import { BoundaryExecutor } from '../src/engine/executor.ts';
import { DeterministicAuthorityEngine, ACTION_APPROVAL_PERMISSION } from '../src/engine/authority.ts';
import type { RuleSetSource } from '../src/engine/authority.ts';
import type { RuleSet } from '../src/domain/rules.ts';
import type { AuthorityContext } from '../src/contracts/services.ts';
import {
  createProviderBackedExecutor,
  type FlightBookingDossier,
  type HotelReplacementDossier,
} from '../src/app/providerExecution.ts';
import type { ActionIntent, AuthorisedExecution } from '../src/operational/intent.ts';
import type { RecoveryStrategy } from '../src/operational/strategy.ts';
import type { CapabilityFamily, CapabilityOperation } from '../src/operational/strategy.ts';
import type { SideEffectLevel } from '../src/operational/intent.ts';
import type { Money } from '../src/domain/common.ts';
import type { ExecutorService } from '../src/contracts/services.ts';
import type { ExecutionResult } from '../src/operational/intent.ts';

interface EvidenceStage {
  stage: string;
  provider: string;
  mode: string;
  timestamp: string;
  request: Record<string, unknown>;
  result: Record<string, unknown>;
}

const evidence: EvidenceStage[] = [];

function record(stage: string, provider: string, request: Record<string, unknown>, result: unknown): void {
  const entry: EvidenceStage = {
    stage,
    provider,
    mode: 'RECORD',
    timestamp: new Date().toISOString(),
    request,
    result: result as Record<string, unknown>,
  };
  evidence.push(entry);
  process.stdout.write(`${stage}: ${JSON.stringify(resultSummary(result))}\n`);
}

function resultSummary(result: unknown): Record<string, unknown> {
  if (result === null || typeof result !== 'object') return { result: String(result) };
  const r = result as Record<string, unknown>;
  if (r['ok'] !== undefined) {
    return r['ok'] === true
      ? { ok: true, data: r['data'] }
      : { ok: false, error: r['error'] };
  }
  return r;
}

function nowIso(): string {
  return new Date().toISOString();
}

let intentSequence = 0;

// Per-run identity component: provider clientReferences (derived from intent
// ids by the executor) must be unique across runs — the hotel provider
// remembers previously booked references and rejects duplicates. IDs remain
// deterministic WITHIN a run so retrieve-before-retry reconciliation keeps
// using the same reference.
const RUN_ID = Date.now().toString(36);

// ---------------------------------------------------------------------------
// REAL deterministic authority (Mission 3 fix): no hand-built AUTO_APPROVED
// envelopes. Every money-moving intent runs through the same
// DeterministicAuthorityEngine the application uses, against an explicit
// validation rule set + principal. If the engine refuses, the harness stops.
// ---------------------------------------------------------------------------

const VALIDATION_RULE_SET_ID = 'rule-set-live-validation';

const validationRuleSet: RuleSet = {
  id: VALIDATION_RULE_SET_ID,
  kind: 'ORGANISATION',
  name: 'Live validation sandbox guardrails',
  sourceId: 'src-live-validation',
  rules: [
    {
      id: 'rule-live-validation-consequential-approval',
      sourceId: 'src-live-validation',
      description: 'consequential provider operations require organisation approval',
      kind: 'APPROVAL_REQUIRED',
      approver: 'ORGANISATION_APPROVER',
      operations: ['flight.pay', 'flight.cancel', 'hotel.modify'],
    },
  ],
};

const validationRuleSets: RuleSetSource = {
  getRuleSet: async (id) => (id === VALIDATION_RULE_SET_ID ? validationRuleSet : undefined),
};

const validationAuthority = new DeterministicAuthorityEngine({ ruleSets: validationRuleSets });

// Explicit validation organiser principal: it holds the ACTION_APPROVAL
// permission with no delegated spend limit, so the deterministic engine
// AUTO_APPROVES sandbox validation operations of any size. This is a declared
// guardrail, not a bypass — without this principal the same engine returns
// REQUIRES_ORGANISATION_APPROVER and the harness refuses to execute.
const validationAuthorityContext: AuthorityContext = {
  tripId: 'trip-live-validation',
  caseId: 'case-live-validation',
  ruleSetIds: [VALIDATION_RULE_SET_ID],
  principals: [
    {
      ref: { entityType: 'ORGANISATION', id: 'org-live-validation' },
      permissions: [ACTION_APPROVAL_PERMISSION],
    },
  ],
};

async function authorisedExecution(
  label: string,
  operation: CapabilityOperation,
  capability: CapabilityFamily,
  parameters: Record<string, unknown>,
  ceiling: Money | undefined,
): Promise<{ execution: AuthorisedExecution; strategy: RecoveryStrategy }> {
  intentSequence += 1;
  const intentId = `int-live-${label}-${RUN_ID}-${intentSequence}`;
  const intent: ActionIntent = {
    id: intentId,
    caseId: 'case-live-validation',
    operation,
    capability,
    parameters,
    sideEffectLevel: 'MONEY_MOVING' as SideEffectLevel,
    // ADR-048: the executor ceiling is the authority-frozen gross spend.
    ...(ceiling ? { priceDelta: ceiling, spendExposure: ceiling } : {}),
    evidenceRefs: [],
    status: 'PROPOSED',
    createdAt: nowIso(),
  };
  // The REAL deterministic authority path: identical intent + context always
  // yields an identical decision. A non-AUTO_APPROVED outcome stops the run.
  const decision = await validationAuthority.decide(intent, validationAuthorityContext);
  if (decision.outcome !== 'AUTO_APPROVED') {
    throw new Error(
      `deterministic authority refused ${operation} (${decision.outcome}): ${decision.ruleTrace.join('; ')}`,
    );
  }
  const strategy: RecoveryStrategy = {
    id: `strat-live-${label}-${RUN_ID}-${intentSequence}`,
    caseId: 'case-live-validation',
    summary: `live validation strategy for ${operation}`,
    candidateOperations: [],
    toolRequests: [],
    assumptions: [],
    uncertainties: [],
    expectedOutcomes: [],
    ...(ceiling ? { costImpact: ceiling } : {}),
    createdAt: nowIso(),
  };
  const execution: AuthorisedExecution = {
    intent: { ...intent, status: 'AUTHORISED' },
    authority: decision,
  };
  return { execution, strategy };
}

// Validation data only (same category as the route choice below): airport ->
// IANA zone for Mexican airports so airport-local schedule strings convert to
// honest instants. Unknown codes return undefined -> normalization fails
// honestly instead of fabricating an offset.
const VALIDATION_AIRPORT_TIMEZONES: Record<string, string> = {
  // Mexico
  MEX: 'America/Mexico_City',
  NLU: 'America/Mexico_City',
  CUN: 'America/Cancun',
  MTY: 'America/Monterrey',
  GDL: 'America/Mexico_City',
  TIJ: 'America/Tijuana',
  MID: 'America/Merida',
  BJX: 'America/Mexico_City',
  PVR: 'America/Mexico_City',
  SJD: 'America/Mazatlan',
  HMO: 'America/Hermosillo',
  OAX: 'America/Mexico_City',
  VER: 'America/Mexico_City',
  TAP: 'America/Mexico_City',
  CZM: 'America/Cancun',
  CTM: 'America/Cancun',
  MZT: 'America/Mazatlan',
  CUL: 'America/Mazatlan',
  LAP: 'America/Mazatlan',
  ZLO: 'America/Mexico_City',
  TAM: 'America/Monterrey',
  TRC: 'America/Monterrey',
  CJS: 'America/Ciudad_Juarez',
  CUU: 'America/Chihuahua',
  DGO: 'America/Monterrey',
  AGU: 'America/Mexico_City',
  SLW: 'America/Monterrey',
  QRO: 'America/Mexico_City',
  TLC: 'America/Mexico_City',
  HUX: 'America/Mexico_City',
  ZCL: 'America/Mexico_City',
  MTT: 'America/Mexico_City',
  VSA: 'America/Mexico_City',
  CEN: 'America/Hermosillo',
  MXL: 'America/Tijuana',
  // Central America + Caribbean (sandbox routings observed beyond Mexico)
  GUA: 'America/Guatemala',
  SAL: 'America/El_Salvador',
  SAP: 'America/Tegucigalpa',
  TGU: 'America/Tegucigalpa',
  LCE: 'America/Tegucigalpa',
  RTB: 'America/Tegucigalpa',
  MGA: 'America/Managua',
  SJO: 'America/Costa_Rica',
  LIR: 'America/Costa_Rica',
  PTY: 'America/Panama',
  DAV: 'America/Panama',
  BZE: 'America/Belize',
  // Northern South America
  BOG: 'America/Bogota',
  MDE: 'America/Bogota',
  CLO: 'America/Bogota',
  CTG: 'America/Bogota',
  BAQ: 'America/Bogota',
  UIO: 'America/Guayaquil',
  GYE: 'America/Guayaquil',
  LIM: 'America/Lima',
  CUZ: 'America/Lima',
  // Caribbean
  HAV: 'America/Havana',
  SDQ: 'America/Santo_Domingo',
  PUJ: 'America/Santo_Domingo',
  STI: 'America/Santo_Domingo',
  SJU: 'America/Puerto_Rico',
  NAS: 'America/Nassau',
  FPO: 'America/Nassau',
  KIN: 'America/Jamaica',
  MBJ: 'America/Jamaica',
  PAP: 'America/Port-au-Prince',
  CUR: 'America/Curacao',
  AUA: 'America/Aruba',
  BGI: 'America/Barbados',
  POS: 'America/Port_of_Spain',
  GCM: 'America/Cayman',
  UVF: 'America/St_Lucia',
  ANU: 'America/Antigua',
  // Major US hubs (possible connecting points in sandbox data)
  IAH: 'America/Chicago',
  HOU: 'America/Chicago',
  DFW: 'America/Chicago',
  DAL: 'America/Chicago',
  AUS: 'America/Chicago',
  SAT: 'America/Chicago',
  ELP: 'America/Denver',
  MFE: 'America/Chicago',
  LRD: 'America/Chicago',
  MSY: 'America/Chicago',
  MIA: 'America/New_York',
  FLL: 'America/New_York',
  MCO: 'America/New_York',
  TPA: 'America/New_York',
  ATL: 'America/New_York',
  CLT: 'America/New_York',
  JFK: 'America/New_York',
  EWR: 'America/New_York',
  LGA: 'America/New_York',
  PHL: 'America/New_York',
  BOS: 'America/New_York',
  IAD: 'America/New_York',
  DCA: 'America/New_York',
  BWI: 'America/New_York',
  ORD: 'America/Chicago',
  MDW: 'America/Chicago',
  DTW: 'America/Detroit',
  MSP: 'America/Chicago',
  MKE: 'America/Chicago',
  STL: 'America/Chicago',
  MCI: 'America/Chicago',
  MEM: 'America/Chicago',
  BNA: 'America/Chicago',
  DEN: 'America/Denver',
  SLC: 'America/Denver',
  ABQ: 'America/Denver',
  PHX: 'America/Phoenix',
  LAS: 'America/Los_Angeles',
  LAX: 'America/Los_Angeles',
  BUR: 'America/Los_Angeles',
  SNA: 'America/Los_Angeles',
  ONT: 'America/Los_Angeles',
  SAN: 'America/Los_Angeles',
  SJC: 'America/Los_Angeles',
  SFO: 'America/Los_Angeles',
  OAK: 'America/Los_Angeles',
  SMF: 'America/Los_Angeles',
  PDX: 'America/Los_Angeles',
  SEA: 'America/Los_Angeles',
};

const validationTimezoneResolver: AtlasTimezoneResolver = (airportCode) =>
  VALIDATION_AIRPORT_TIMEZONES[airportCode.toUpperCase()];

async function validateAtlasFlightChain(config: ReturnType<typeof loadConfig>, store: FileRecordingStore): Promise<void> {
  const { baseUrl, clientId, clientSecret } = config.providers.atlas;
  if (!baseUrl || !clientId || !clientSecret) throw new Error('Atlas credentials ABSENT — refusing LIVE validation');
  if (!isAtlasSandboxBaseUrl(baseUrl)) throw new Error('Atlas base URL is NOT the sandbox host — refusing to execute');

  const flight = new AtlasFlightAdapter({ mode: 'RECORD', store, baseUrl, clientId, clientSecret, timeoutMs: 60_000, timezoneResolver: validationTimezoneResolver });
  const flightTransactions = new AtlasFlightTransactionAdapter({ mode: 'RECORD', store, baseUrl, clientId, clientSecret, timeoutMs: 60_000 });

  // Synthetic booking identity — never real PII. Atlas wire reality (DR-0 +
  // docs): contact requires a valid email address, and route-specific
  // bookingRequirement can require nationality (ISO 3166-1 alpha-2; the
  // Y4 domestic route refused the order without it, provider status 407).
  const dossier: FlightBookingDossier = {
    passengers: [{ givenName: 'Sandbox', familyName: 'Northstar', dateOfBirth: '1990-01-01', gender: 'FEMALE', nationality: 'MX' }],
    contact: { name: 'Northstar/Sandbox', email: 'wave3r-validation@example.com' },
    paymentRef: ATLAS_SANDBOX_BALANCE_PAYMENT_REF,
  };

  const executor: ExecutorService = createProviderBackedExecutor({
    fallback: new BoundaryExecutor(),
    mode: 'RECORD',
    flight,
    flightTransactions,
    flightDossier: () => dossier,
    ticketingPoll: { attempts: 36, delayMs: 5_000 },
  });

  // Resume path (retrieve-before-continue, the same reconciliation discipline
  // as retry): a prior run may have paid an order but exited before ticketing
  // completed. With a CLI orderRef, observe the existing order through the
  // adapter and continue the evidence chain from there — never double-pay or
  // double-create. Otherwise run the full search → book chain.
  const resumeOrderRef = process.argv[3];
  let transactionState: Record<string, unknown> | undefined;
  let orderRef: string | undefined;
  if (resumeOrderRef) {
    orderRef = resumeOrderRef;
    // Bounded poll: ticketing is asynchronous; observe honestly until TICKETED
    // or the window closes (never invent a terminal state).
    let observed = await flightTransactions.retrieveOrder({ orderRef });
    for (let attempt = 0; attempt < 12 && observed.ok && observed.data.status !== 'TICKETED'; attempt += 1) {
      record('atlas.resume_poll', 'atlas', { orderRef, attempt: attempt + 1 }, observed);
      await new Promise((r) => setTimeout(r, 10_000));
      observed = await flightTransactions.retrieveOrder({ orderRef });
    }
    record('atlas.resume_retrieve', 'atlas', { orderRef }, observed);
    if (!observed.ok) throw new Error(`resume retrieve failed: ${observed.error.code}`);
    if (observed.data.status !== 'TICKETED') {
      throw new Error(`resume order ${orderRef} observed as ${observed.data.status}, not TICKETED`);
    }
    transactionState = observed.data.transactionState as Record<string, unknown> | undefined;
  } else {
  // 1. Search prerequisite (read-only). Route chosen from DR-0 evidence: a
  //    void-supported carrier region so the cancellation leg is provable.
  const departureDate = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const searchQuery = {
    origin: { system: 'iata', value: 'MEX' },
    destination: { system: 'iata', value: 'CUN' },
    departureDate,
    passengers: { adults: 1 },
  };
  const search = await flight.searchFlights(searchQuery);
  record('atlas.search', 'atlas', { ...searchQuery }, search);
  if (!search.ok || search.data.offers.length === 0) throw new Error('Atlas search returned no offers');

  // Offer selection is validation data only (never in application code).
  // Direct Y4 offers first: DR-0 empirically proved the direct MEX→CUN
  // Volaris chain end to end. Re-runs rotate off the offer used by earlier
  // runs (optional CLI index) because the sandbox detects an identical
  // offer + passenger re-booking and returns the existing order instead of a
  // fresh one (wire status 318), which would tangle the evidence chain.
  const directY4 = search.data.offers.filter(
    (candidate) => candidate.segments.length === 1 && candidate.segments.some((s) => s.carrierCode === 'Y4'),
  );
  const requestedIndex = process.argv[2] === undefined ? 1 : Number.parseInt(process.argv[2] ?? '0', 10);
  const offer =
    (directY4.length > 0
      ? directY4[Math.min(Math.max(Number.isNaN(requestedIndex) ? 1 : requestedIndex, 0), directY4.length - 1)]
      : undefined) ??
    search.data.offers.find((candidate) => candidate.segments.some((s) => s.carrierCode === 'Y4')) ??
    search.data.offers[0];
  record('atlas.offer_selected', 'atlas', { offerId: offer.offerId }, {
    totalPrice: offer.totalPrice,
    segments: offer.segments.map((s) => `${s.carrierCode ?? '?'}${s.flightNumber ?? '?'} ${s.origin.value}-${s.destination.value}`),
  });

  // 2. Money-moving booking through the executor (verify -> create -> gate ->
  //    pay -> ticketing observation). Ceiling = the offer total an authority
  //    review would have approved.
  const booking = await authorisedExecution('atlas-book', 'flight.pay', 'FLIGHT', { offerId: offer.offerId }, offer.totalPrice);
  let bookingResult: ExecutionResult = await executor.execute(booking.execution);
  record('atlas.executor_flight_pay', 'atlas', { operation: 'flight.pay', offerId: offer.offerId, ceiling: offer.totalPrice }, bookingResult);

  // Documented re-entry: if the observed payable exceeded the approved
  // ceiling, ONE fresh attempt runs under the OBSERVED payable as the new
  // gross spend. The refused HELD order simply expires.
  //
  // Mission 3: the re-entry is re-authorised through the SAME deterministic
  // authority engine with spendExposure = observed payable. If the declared
  // validation guardrails refuse the higher amount, the run stops honestly.
  if (bookingResult.status === 'FAILURE' && bookingResult.error?.code === 'payable_exceeds_ceiling') {
    const observed = bookingResult.observedEffects?.['observedPayable'] as Money | undefined;
    if (observed) {
      const retry = await authorisedExecution('atlas-book-reentry', 'flight.pay', 'FLIGHT', { offerId: offer.offerId }, observed);
      bookingResult = await executor.execute(retry.execution);
      record('atlas.executor_flight_pay_reentry', 'atlas', { operation: 'flight.pay', ceiling: observed }, bookingResult);
    }
  }

  if (bookingResult.status !== 'SUCCESS') {
    throw new Error(`Atlas booking did not reach TICKETED: ${bookingResult.status} ${bookingResult.error?.code ?? ''}`);
  }
  transactionState = bookingResult.observedEffects?.['transactionState'] as Record<string, unknown> | undefined;
  orderRef = typeof transactionState?.['orderRef'] === 'string' ? (transactionState['orderRef'] as string) : undefined;
  if (!orderRef) throw new Error('Atlas booking succeeded but no orderRef observed');
  }

  // 3. Cancellation through the generic three-stage seam (quote -> submit ->
  //    observe status). PROCESSING at the end of the window is recorded
  //    truthfully; no indefinite waiting, no invented success.
  //
  //    Optional CLI arg 4 = 'ticketing': stop here with a TICKETED order and
  //    skip the cancellation leg (used by the voidQuotation read-only probe,
  //    which must run BEFORE any cancellation touches the order).
  if (process.argv[4] === 'ticketing') {
    record('atlas.stop_after_ticketing', 'atlas', { orderRef }, { observed: 'TICKETED', next: 'voidQuotation read-only probe' });
    return;
  }
  const cancellation = await authorisedExecution('atlas-cancel', 'flight.cancel', 'FLIGHT', { orderRef }, undefined);
  const cancelResult = await executor.execute(cancellation.execution);
  record('atlas.executor_flight_cancel', 'atlas', { operation: 'flight.cancel', orderRef }, cancelResult);
}

async function validateNuiteeReplacement(config: ReturnType<typeof loadConfig>, store: FileRecordingStore): Promise<void> {
  const { apiKey, searchBaseUrl, bookingBaseUrl } = config.providers.nuitee;
  if (!apiKey) throw new Error('Nuitée API key ABSENT — refusing LIVE validation');

  const hotel = new NuiteeAdapter({ mode: 'RECORD', store, apiKey, searchBaseUrl, bookingBaseUrl, timeoutMs: 30_000 });

  // Tracked provider bookings; all must be observed CANCELLED before exit.
  const openBookings: string[] = [];

  // 1. Search (read-only). Singapore coordinates match the proven capture area.
  const searchQuery = {
    location: { coordinates: { latitude: 1.2839, longitude: 103.8607, radiusKm: 5 } },
    checkInDate: '2026-10-01',
    checkOutDate: '2026-10-04',
    guests: { adults: 1 },
    rooms: 1,
  };
  const search = await hotel.searchHotels(searchQuery);
  record('nuitee.search', 'nuitee', { ...searchQuery }, search.ok
    ? { ok: true, properties: search.data.properties.length, rates: search.data.rates.length }
    : search);
  if (!search.ok) throw new Error('Nuitée search failed');

  const refundable = search.data.rates
    .filter((rate) => rate.refundable && rate.availability === 'AVAILABLE')
    .sort((a, b) => a.totalPrice.amount - b.totalPrice.amount);
  if (refundable.length === 0) throw new Error('no refundable rates available for safe cleanup');
  const displacedRate = refundable[0];
  const replacementRate = refundable.find((rate) => rate.rateId !== displacedRate.rateId) ?? displacedRate;

  // 2. Setup: book the displaced stay directly through the adapter (the
  //    booking the traveller would already hold).
  const displacedQuote = await hotel.quoteRate({ rateId: displacedRate.rateId });
  record('nuitee.setup_quote_displaced', 'nuitee', { rateId: displacedRate.rateId }, displacedQuote);
  if (!displacedQuote.ok || !displacedQuote.data.quoteId) throw new Error('displaced quote failed');
  const displacedBook = await hotel.bookStay({
    quoteId: displacedQuote.data.quoteId,
    guestNames: ['Northstar Sandbox'],
    clientReference: `wave3r-m1-displaced-${Date.now()}`,
  });
  record('nuitee.setup_book_displaced', 'nuitee', { quoteId: displacedQuote.data.quoteId }, displacedBook);
  if (!displacedBook.ok || !displacedBook.data.bookingId) throw new Error('displaced booking failed');
  const displacedBookingId = displacedBook.data.bookingId;
  openBookings.push(displacedBookingId);
  const displacedCheck = await hotel.retrieveBooking({ bookingId: displacedBookingId });
  record('nuitee.setup_retrieve_displaced', 'nuitee', { bookingId: displacedBookingId }, displacedCheck);

  // 3. Replacement orchestration THROUGH THE EXECUTOR: quote replacement ->
  //    cost gate -> book -> CONFIRMED -> cancel displaced -> CANCELLED.
  const executor: ExecutorService = createProviderBackedExecutor({
    fallback: new BoundaryExecutor(),
    mode: 'RECORD',
    hotel,
    hotelDossier: (): HotelReplacementDossier => ({
      replacementRateId: replacementRate.rateId,
      guestNames: ['Northstar Sandbox'],
      displacedBookingId,
    }),
  });
  const replacement = await authorisedExecution('nuitee-replace', 'hotel.modify', 'HOTEL', {}, replacementRate.totalPrice);
  const replacementResult = await executor.execute(replacement.execution);
  record('nuitee.executor_hotel_replacement', 'nuitee', {
    operation: 'hotel.modify',
    replacementRateId: replacementRate.rateId,
    displacedBookingId,
    ceiling: replacementRate.totalPrice,
  }, replacementResult);

  const replacementBookingId = (
    replacementResult.observedEffects?.['replacementBooking'] as Record<string, unknown> | undefined
  )?.['bookingId'];
  if (typeof replacementBookingId === 'string') openBookings.push(replacementBookingId);

  // 4. Cleanup: every still-open booking is cancelled and observed CANCELLED.
  for (const bookingId of openBookings) {
    const pre = await hotel.retrieveBooking({ bookingId });
    if (pre.ok && pre.data.status === 'CANCELLED') {
      record('nuitee.cleanup_already_cancelled', 'nuitee', { bookingId }, pre);
      continue;
    }
    const cancel = await hotel.cancelStay({ stayElementId: bookingId, reason: 'wave3r-mission1-cleanup' });
    record('nuitee.cleanup_cancel', 'nuitee', { bookingId }, cancel);
    const post = await hotel.retrieveBooking({ bookingId });
    record('nuitee.cleanup_observe', 'nuitee', { bookingId }, post);
    if (!post.ok || post.data.status !== 'CANCELLED') {
      throw new Error(`cleanup failed: booking ${bookingId} not observed CANCELLED`);
    }
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.providers.atlas.baseUrl || !config.providers.nuitee.apiKey) {
    throw new Error('provider credentials absent; LIVE validation refused');
  }

  const store = new FileRecordingStore({ readDirs: ['fixtures/recordings'], writeDir: 'fixtures/recordings' });

  await validateAtlasFlightChain(config, store);
  // 'ticketing' runs are Atlas-only: the order is handed to the read-only
  // probe and the cancellation leg runs later via the resume path.
  if (process.argv[4] !== 'ticketing') {
    await validateNuiteeReplacement(config, store);
  }

  mkdirSync(resolve('output'), { recursive: true });
  // Evidence accumulates across resumed/continued runs: stages from earlier
  // successful runs are preserved and the new continuation appended, so the
  // final record stays coherent without rerunning money-moving stages.
  const evidencePath = resolve('output/wave3r-mission1-live-evidence.json');
  let priorStages: EvidenceStage[] = [];
  if (existsSync(evidencePath)) {
    try {
      const prior = JSON.parse(readFileSync(evidencePath, 'utf8')) as { aborted?: string; stages?: EvidenceStage[] };
      if (!prior.aborted && Array.isArray(prior.stages)) priorStages = prior.stages;
    } catch {
      // Unreadable prior evidence: start fresh rather than failing the run.
    }
  }
  const report = {
    mission: 'wave3r-mission-1c',
    mode: 'RECORD (genuine LIVE sandbox execution, sanitized recordings persisted)',
    generatedAt: nowIso(),
    providers: {
      atlas: { host: new URL(config.providers.atlas.baseUrl as string).hostname, environment: 'sandbox' },
      nuitee: {
        searchHost: new URL(config.providers.nuitee.searchBaseUrl ?? 'https://api.liteapi.travel').hostname,
        bookingHost: new URL(config.providers.nuitee.bookingBaseUrl ?? 'https://book.liteapi.travel').hostname,
        environment: 'sandbox API key',
      },
    },
    stages: [...priorStages, ...evidence],
  };
  writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`EVIDENCE WRITTEN output/wave3r-mission1-live-evidence.json (${report.stages.length} stages)\n`);
}

main().catch((error) => {
  // Aborted evidence goes to a PARTIAL file: it must never clobber the
  // accumulated successful evidence record.
  try {
    mkdirSync(resolve('output'), { recursive: true });
    writeFileSync(
      resolve('output/wave3r-mission1-live-evidence.partial.json'),
      `${JSON.stringify({ mission: 'wave3r-mission-1c', aborted: String(error), stages: evidence }, null, 2)}\n`,
      'utf8',
    );
  } catch {
    // Evidence persistence must never mask the primary error.
  }
  process.stderr.write(`LIVE VALIDATION FAILED: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});

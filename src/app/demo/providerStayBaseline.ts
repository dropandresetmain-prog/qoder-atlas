/**
 * Explicit provider-world bootstrap for a destination stay.
 *
 * A frozen template can never hold external provider state: a sandbox booking
 * exists outside the database and cannot be cloned. This bootstrap runs only
 * when an operator explicitly asks for it on a working clone:
 *
 *   pristine clone -> book the configured stay at the provider (RECORD/LIVE)
 *   or replay that booking (REPLAY) -> read its confirmed terms -> attach the
 *   provider booking to the canonical reservation as an observed HOTEL_BOOKING.
 *
 * It never runs at ordinary boot, never books twice for the same reservation
 * (existing link, then provider client-reference lookup, are checked first),
 * and never invents terms: the attached booking id, confirmed total and
 * cancellation policy all come from the provider's own responses.
 */
import { createHash } from 'node:crypto';
import type { AdapterMode } from '../../contracts/envelope.ts';
import type { ExternalRef, HotelCapability, HotelRateView, StayContext } from '../../contracts/capabilities.ts';
import type { Pool } from '../../persistence/postgres/pool.ts';
import type { PgUnitOfWork } from '../../persistence/postgres/pgUnitOfWork.ts';
import { recordEvidence, recordSource } from '../../persistence/postgres/commands/knowledgeCommands.ts';
import {
  createExternalConnection,
  linkExternalRecord,
  observeExternalRecord,
} from '../../persistence/postgres/commands/arrangementCommands.ts';
import { PgAggregateHeadReader } from '../../persistence/postgres/pgAggregateHeadReader.ts';

export const PROVIDER_STAY_RECORD_TYPE = 'HOTEL_BOOKING';
export const NUITEE_PROVIDER_KIND = 'nuitee';

export interface ProviderStayBaselineBinding {
  /** Source (dataset) booking reference that identifies the canonical stay reservation. */
  sourceBookingReference: string;
  propertyExternalRef: ExternalRef;
  guestNationality: string;
  guests: { adults: number; rooms: number };
}

export interface ProviderStayBaselineInput {
  pool: Pool;
  uow: () => PgUnitOfWork;
  workspaceId: string;
  actorPrincipalId: string;
  hotel: Pick<HotelCapability, 'searchHotels' | 'quoteRate' | 'bookStay' | 'getStayContext' | 'findBookingsByClientReference'>;
  mode: AdapterMode;
  binding: ProviderStayBaselineBinding;
  /** Wall-clock observation instant for provenance. */
  observedAt: string;
}

export interface ProviderStayBaselineAttached {
  ok: true;
  status: 'ATTACHED' | 'ALREADY_ATTACHED';
  bookingId: string;
  reservationId: string;
  checkInDate: string;
  checkOutDate: string;
  context?: StayContext;
}

export interface ProviderStayBaselineFailure {
  ok: false;
  code:
    | 'STAY_NOT_FOUND'
    | 'STAY_PROPERTY_MISMATCH'
    | 'GUEST_NAME_MISSING'
    | 'PROVIDER_SEARCH_FAILED'
    | 'NO_REFUNDABLE_RATE'
    | 'PROVIDER_QUOTE_FAILED'
    | 'PROVIDER_BOOK_FAILED'
    | 'PROVIDER_CONTEXT_FAILED'
    | 'CANONICAL_ATTACH_FAILED';
  message: string;
}

export type ProviderStayBaselineResult = ProviderStayBaselineAttached | ProviderStayBaselineFailure;

function uuidFrom(namespace: string, value: string): string {
  const h = createHash('sha256').update(`${namespace}|${value}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function localDate(instant: Date, timeZone: string): string {
  const parts = new Map(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(instant).map((part) => [part.type, part.value]));
  return `${parts.get('year')}-${parts.get('month')}-${parts.get('day')}`;
}

function fail(code: ProviderStayBaselineFailure['code'], message: string): ProviderStayBaselineFailure {
  return { ok: false, code, message };
}

interface StayRow {
  reservation_id: string;
  line_id: string;
  traveller_id: string;
  interval_start: Date;
  interval_end: Date;
  time_zone: string;
  place_refs: unknown;
}

async function loadStay(input: ProviderStayBaselineInput): Promise<StayRow | undefined> {
  const rows = await input.pool.query<StayRow>(
    `SELECT rsv.id AS reservation_id, line.id AS line_id, alloc.traveller_id,
            sd.stay_interval_start AS interval_start, sd.stay_interval_end AS interval_end,
            p.time_zone,
            (SELECT COALESCE(jsonb_agg(jsonb_build_object('system', r.provider_namespace, 'value', r.external_key)), '[]'::jsonb)
               FROM place_external_refs r WHERE r.workspace_id = p.workspace_id AND r.place_id = p.id) AS place_refs
       FROM external_records er
       JOIN external_record_links link
         ON link.workspace_id = er.workspace_id AND link.external_record_id = er.id
        AND link.canonical_subject_kind = 'RESERVATION' AND link.superseded_at IS NULL
       JOIN reservations rsv ON rsv.workspace_id = link.workspace_id AND rsv.id = link.canonical_subject_id
       JOIN reservation_lines line
         ON line.workspace_id = rsv.workspace_id AND line.reservation_id = rsv.id AND line.product_type = 'STAY'
       JOIN reservation_allocations alloc
         ON alloc.workspace_id = line.workspace_id AND alloc.line_id = line.id
       JOIN stay_line_details sd ON sd.workspace_id = line.workspace_id AND sd.line_id = line.id
       JOIN places p ON p.workspace_id = sd.workspace_id AND p.id = sd.place_id
      WHERE er.workspace_id = $1 AND er.record_type = 'SOURCE_BOOKING_REFERENCE' AND er.external_id = $2
        AND line.observed_status IN ('HELD', 'CONFIRMED')`,
    [input.workspaceId, input.binding.sourceBookingReference],
  );
  return rows.rows.length === 1 ? rows.rows[0] : undefined;
}

/** The provider booking already attached to a reservation, if any. */
export async function findAttachedProviderStayBooking(
  pool: Pool,
  workspaceId: string,
  reservationId: string,
): Promise<string | undefined> {
  const rows = await pool.query<{ external_id: string }>(
    `SELECT er.external_id
       FROM external_records er
       JOIN external_connections c ON c.workspace_id = er.workspace_id AND c.id = er.connection_id
       JOIN external_record_links link
         ON link.workspace_id = er.workspace_id AND link.external_record_id = er.id
        AND link.canonical_subject_kind = 'RESERVATION' AND link.superseded_at IS NULL
      WHERE er.workspace_id = $1 AND link.canonical_subject_id = $2
        AND er.record_type = $3 AND c.provider_kind = $4
      ORDER BY er.external_id`,
    [workspaceId, reservationId, PROVIDER_STAY_RECORD_TYPE, NUITEE_PROVIDER_KIND],
  );
  return rows.rows.length === 1 ? rows.rows[0]!.external_id : undefined;
}

/** Stay execution and baseline attach share exactly one provider connection. */
async function ensureProviderConnection(input: ProviderStayBaselineInput): Promise<string | undefined> {
  const existing = await input.pool.query<{ id: string }>(
    `SELECT id FROM external_connections WHERE workspace_id = $1 AND provider_kind = $2 ORDER BY id LIMIT 2`,
    [input.workspaceId, NUITEE_PROVIDER_KIND],
  );
  if (existing.rows.length === 1) return existing.rows[0]!.id;
  if (existing.rows.length > 1) return undefined;
  const id = uuidFrom('provider-connection', `${input.workspaceId}|${NUITEE_PROVIDER_KIND}`);
  const created = await createExternalConnection(input.uow(), {
    workspaceId: input.workspaceId,
    actorPrincipalId: input.actorPrincipalId,
    idempotencyKey: `provider-stay-baseline:connection:${NUITEE_PROVIDER_KIND}`,
    connection: { id, providerKind: NUITEE_PROVIDER_KIND },
  });
  return created.ok ? id : undefined;
}

function pickRate(rates: readonly HotelRateView[], propertyId: string): HotelRateView | undefined {
  return rates
    .filter((rate) => rate.propertyId === propertyId && rate.refundable === true && rate.availability !== 'UNKNOWN')
    .sort((a, b) => Number(a.totalPrice.amount) - Number(b.totalPrice.amount) || a.rateId.localeCompare(b.rateId))[0];
}

/**
 * Book (or replay) the configured stay and attach it. Idempotent per
 * reservation: a second call returns the attached booking without a provider
 * transaction.
 */
export async function bootstrapProviderStayBaseline(input: ProviderStayBaselineInput): Promise<ProviderStayBaselineResult> {
  const stay = await loadStay(input);
  if (!stay) return fail('STAY_NOT_FOUND', 'the configured source booking reference does not resolve to exactly one active stay line');
  const refs = Array.isArray(stay.place_refs) ? stay.place_refs as ExternalRef[] : [];
  if (!refs.some((ref) => ref.system === input.binding.propertyExternalRef.system && ref.value === input.binding.propertyExternalRef.value)) {
    return fail('STAY_PROPERTY_MISMATCH', 'the stay place does not carry the configured provider property reference');
  }
  const checkInDate = localDate(stay.interval_start, stay.time_zone);
  const checkOutDate = localDate(stay.interval_end, stay.time_zone);

  const attached = await findAttachedProviderStayBooking(input.pool, input.workspaceId, stay.reservation_id);
  if (attached) {
    return { ok: true, status: 'ALREADY_ATTACHED', bookingId: attached, reservationId: stay.reservation_id, checkInDate, checkOutDate };
  }

  const name = (await input.pool.query<{ given_name: string; family_name: string }>(
    `SELECT given_name, family_name FROM traveller_names
      WHERE workspace_id = $1 AND traveller_id = $2 AND given_name IS NOT NULL AND family_name IS NOT NULL
      ORDER BY (name_kind = 'LEGAL') DESC, valid_from DESC, id LIMIT 1`,
    [input.workspaceId, stay.traveller_id],
  )).rows[0];
  if (!name) return fail('GUEST_NAME_MISSING', 'the stay traveller has no structured guest name');

  // Deterministic per dataset stay identity (never per internal reservation
  // uuid, which is only stable within one seed lineage and can legitimately
  // differ between a product boot and a test fixture importing the same
  // dataset) so REPLAY reproduces the recorded request in any world that
  // imports this stay, and a retried RECORD run can find a booking an
  // interrupted run created.
  const clientReference = `ns-baseline-${createHash('sha256')
    .update(`${input.binding.sourceBookingReference}|${checkInDate}|${checkOutDate}`).digest('hex').slice(0, 24)}`;

  let bookingId: string | undefined;
  // Prefer client-reference recovery when the adapter can honour it. RECORD may
  // hit the sandbox; REPLAY loads a booking_lookup recording (never a live call).
  // NORTHSTAR_BASELINE_FORCE_BOOK=1 skips lookup so a corpus capture can exercise
  // search → quote → book when the sandbox booking is absent.
  const forceBook = process.env.NORTHSTAR_BASELINE_FORCE_BOOK === '1';
  if (!forceBook && input.hotel.findBookingsByClientReference) {
    const found = await input.hotel.findBookingsByClientReference({ clientReference });
    if (found.ok && found.data.bookings.length === 1) bookingId = found.data.bookings[0]!.bookingId;
    if (found.ok && found.data.bookings.length > 1) {
      return fail('PROVIDER_BOOK_FAILED', 'several provider bookings already carry this baseline reference; resolve manually');
    }
  }

  if (!bookingId) {
    const search = await input.hotel.searchHotels({
      location: { externalRef: input.binding.propertyExternalRef },
      checkInDate, checkOutDate,
      guests: { adults: input.binding.guests.adults },
      rooms: input.binding.guests.rooms,
      guestNationality: input.binding.guestNationality,
    });
    if (!search.ok) return fail('PROVIDER_SEARCH_FAILED', `${search.error.category}/${search.error.code}`);
    const rate = pickRate(search.data.rates, input.binding.propertyExternalRef.value);
    if (!rate) return fail('NO_REFUNDABLE_RATE', 'no available refundable rate at the configured property for the stay dates');
    const quote = await input.hotel.quoteRate({ rateId: rate.rateId });
    if (!quote.ok || quote.data.status !== 'QUOTED' || !quote.data.quoteId) {
      return fail('PROVIDER_QUOTE_FAILED', quote.ok ? `quote status ${quote.data.status}` : `${quote.error.category}/${quote.error.code}`);
    }
    const booked = await input.hotel.bookStay({
      quoteId: quote.data.quoteId,
      guestNames: [`${name.given_name} ${name.family_name}`],
      clientReference,
    });
    if (!booked.ok || !booked.data.confirmed || !booked.data.bookingId) {
      return fail('PROVIDER_BOOK_FAILED', booked.ok ? 'booking was not confirmed' : `${booked.error.category}/${booked.error.code}`);
    }
    bookingId = booked.data.bookingId;
  }

  // Confirmed terms come from the provider's own booking record.
  const context = await input.hotel.getStayContext({ stayElementId: bookingId });
  if (!context.ok || !context.data.bookedTotal || !context.data.cancellation) {
    return fail('PROVIDER_CONTEXT_FAILED', context.ok ? 'booking record lacks a confirmed total or cancellation policy' : `${context.error.category}/${context.error.code}`);
  }

  const connectionId = await ensureProviderConnection(input);
  if (!connectionId) return fail('CANONICAL_ATTACH_FAILED', 'expected exactly one provider stay connection');
  const key = (part: string) => `provider-stay-baseline:${stay.reservation_id}:${bookingId}:${part}`;
  const payload = JSON.stringify({ bookingId, bookedTotal: context.data.bookedTotal, cancellation: context.data.cancellation });
  const payloadHash = createHash('sha256').update(payload).digest('hex');
  const sourceId = uuidFrom('provider-stay-baseline-source', `${input.workspaceId}|${bookingId}`);
  const evidenceId = uuidFrom('provider-stay-baseline-evidence', `${input.workspaceId}|${bookingId}`);
  const base = { workspaceId: input.workspaceId, actorPrincipalId: input.actorPrincipalId };
  const source = await recordSource(input.uow(), {
    ...base, idempotencyKey: key('source'), sourceId, sourceIdentity: `${NUITEE_PROVIDER_KIND}:${bookingId}`,
    receivedAt: input.observedAt, contentHash: payloadHash, contentType: 'application/json',
  });
  if (!source.ok) return fail('CANONICAL_ATTACH_FAILED', `source: ${source.conflict.message}`);
  const evidence = await recordEvidence(input.uow(), {
    ...base, idempotencyKey: key('evidence'), evidenceId, assertionType: 'PROVIDER_STAY_CONFIRMED',
    observedAt: input.observedAt, schemaVersion: '1', sourceIds: [sourceId],
    subjectRefs: [{ kind: 'RESERVATION', id: stay.reservation_id }],
  });
  if (!evidence.ok) return fail('CANONICAL_ATTACH_FAILED', `evidence: ${evidence.conflict.message}`);
  const heads = new PgAggregateHeadReader(input.pool, input.workspaceId);
  const connection = await heads.loadHead({ kind: 'EXTERNAL_CONNECTION', id: connectionId });
  if (!connection) return fail('CANONICAL_ATTACH_FAILED', 'provider connection head missing');
  const recordId = uuidFrom('nuitee-stay', bookingId);
  const observed = await observeExternalRecord(input.uow(), {
    ...base, idempotencyKey: key('record'), connectionId, expectedRevision: connection.revision,
    record: { id: recordId, recordType: PROVIDER_STAY_RECORD_TYPE, externalId: bookingId, identityState: 'UNVERIFIED', observedAt: input.observedAt, payloadHash },
    evidenceRefs: [evidenceId],
  });
  if (!observed.ok) return fail('CANONICAL_ATTACH_FAILED', `record: ${observed.conflict.message}`);
  const linked = await linkExternalRecord(input.uow(), {
    ...base, idempotencyKey: key('link'), connectionId, expectedRevision: observed.value.connectionRevision,
    link: {
      id: uuidFrom('provider-stay-baseline-link', `${input.workspaceId}|${bookingId}`),
      externalRecordId: observed.value.recordId,
      canonicalSubject: { kind: 'RESERVATION', id: stay.reservation_id },
      linkKind: 'SYSTEM_OF_RECORD',
      evidenceId,
      linkedAt: input.observedAt,
    },
    evidenceRefs: [evidenceId],
  });
  if (!linked.ok) return fail('CANONICAL_ATTACH_FAILED', `link: ${linked.conflict.message}`);
  return { ok: true, status: 'ATTACHED', bookingId, reservationId: stay.reservation_id, checkInDate, checkOutDate, context: context.data };
}

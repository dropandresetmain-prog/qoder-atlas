/**
 * Provider-shaped "transport service cancelled with involuntary reprotection" ingress.
 *
 * This is the application-layer entry point for the T2 disruption scenario:
 * a provider reports that a transport service is cancelled and has automatically
 * reprotected affected bookings onto a replacement service. The ingress normalizes
 * this provider-shaped event into canonical PostgreSQL mutations through the
 * accepted M2-M6 commands, maintaining the same revision discipline and evidence
 * provenance as the rest of the system.
 *
 * The flow:
 * 1. Resolve the original service and affected bookings via external identity links
 * 2. Validate that each booking has a CONFIRMED transport line for the original service
 * 3. Record provenance (source + evidence) for the cancellation event
 * 4. Mark displaced reservation lines as CANCELLED
 * 5. Create the replacement transport service
 * 6. Per affected booking: create replacement reservation with lines + allocations
 * 7. Observe external identity links for the replacement service and synthetic booking refs
 *
 * Idempotency: each command uses a deterministic idempotency key derived from
 * (providerId, providerEventId, sub-key). Replay short-circuits before revision checks,
 * so stale expectedRevision values on replay are harmless.
 *
 * Identity minting: all new IDs are deterministic UUIDv5 derived from provider identity,
 * never from names or random values.
 */
import { createHash } from 'node:crypto';
import type { TargetCommandContext } from './applicationCommands.ts';
import type { TransportServiceCancelledWithReprotectionEvent } from './applicationCommands.ts';
export type { TransportServiceCancelledWithReprotectionEvent };
import { recordSource, recordEvidence } from '../../persistence/postgres/commands/knowledgeCommands.ts';
import {
  recordReservationLineObservation,
  createTransportService,
  createReservation,
  addReservationLine,
  allocateReservationLine,
  observeExternalRecord,
  linkExternalRecord,
} from '../../persistence/postgres/commands/arrangementCommands.ts';
import { recordInformationRecord } from '../../persistence/postgres/commands/knowledgeCommands.ts';
import { updateJourneyItem } from '../../persistence/postgres/commands/travelCommands.ts';
import type { Pool } from '../../persistence/postgres/pool.ts';

// UUID v5 minting (same namespace as DatasetIdentityMinter)
const DATASET_NAMESPACE = '6f6a1d4c-1b2e-4d3a-9c7f-2a5b8e0d4c11';

function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}

function uuidV5(namespace: string, name: string): string {
  const hash = createHash('sha1').update(uuidToBytes(namespace)).update(Buffer.from(name, 'utf8')).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

class IdentityMinter {
  private readonly prefix: string;
  constructor(workspaceId: string, datasetKey: string) {
    this.prefix = `${workspaceId}|${datasetKey}`;
  }
  id(kind: string, ...parts: (string | number)[]): string {
    return uuidV5(DATASET_NAMESPACE, `${this.prefix}|${kind}|${parts.join('|')}`);
  }
}

export interface ProviderDisruptionEvent {
  kind: 'TRANSPORT_SERVICE_CANCELLED_WITH_REPROTECTION';
  providerId: string;
  providerEventId: string;
  receivedAt: string;
  disclosedAsSimulatedDemoInput: true;
  originalService: {
    recordType: 'SOURCE_TRANSPORT_SERVICE';
    externalId: string;
  };
  replacementService: {
    recordType: 'SOURCE_TRANSPORT_SERVICE';
    externalId: string;
    operator: string;
    scheduledDeparture: string;
    scheduledArrival: string;
  };
  affectedBookings: Array<{
    recordType: 'SOURCE_BOOKING_REFERENCE';
    externalId: string;
  }>;
  reason: string;
  provenanceKind: string;
}

/**
 * F6: the replacement's transport mode. It is derived from the original
 * canonical service (a like-for-like involuntary reprotection keeps the same
 * mode); a provider MAY state a different mode explicitly and it is validated
 * against the mode vocabulary before any work happens.
 */
export const TRANSPORT_MODES = ['AIR', 'RAIL', 'ROAD', 'SEA'] as const;
export type TransportMode = (typeof TRANSPORT_MODES)[number];

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/u;

/**
 * F5: resolve the replacement service's CANONICAL TransportService id from
 * the service's own identity — never from the provider event identity.
 *
 * Order of resolution:
 *   1. If the connection already links the replacement's recordType/externalId
 *      to a canonical TRANSPORT_SERVICE, that linked subject IS the service
 *      (a later event referencing the same real service reuses it).
 *   2. Otherwise mint deterministically from the service's schedule identity
 *      using the SAME derivation the provisioning materializer uses
 *      (`transport-service` id kind over
 *      carrierRef|departureInstant|originRef|destinationRef), so an event that
 *      names a service the dataset materialized lands on the same id the
 *      materializer would have given it. The externalId form is
 *      `carrier@departureInstant`; origin/destination are NOT part of this
 *      mint key (they are workspace-scoped wildcards, `*`/`*`), so the minted
 *      id alone does not encode — and cannot be used to verify — a corridor.
 *
 * Because this id can resolve to an existing transport_services row (a real
 * service being rediscovered, or this same event retrying), and Step 5 below
 * reuses that row on a create conflict, corridor/schedule safety is enforced
 * separately by a guard immediately before Step 3: when a row already exists
 * for this id, it must match the CURRENT event's original (cancelled)
 * service's origin, destination and mode, and its stored published
 * departure/arrival must match this event's stated replacement schedule.
 * A mismatch returns VALIDATION_FAILED with no mutation instead of silently
 * reusing an unrelated service.
 *
 * The mint uses a workspace+connection-scoped minter prefix so two events in
 * the same workspace resolve identically without knowing the dataset key.
 */
async function canonicalReplacementServiceId(
  ctx: TargetCommandContext,
  replacement: ProviderDisruptionEvent['replacementService'],
): Promise<string> {
  // 1. External-identity resolution wins: the linked subject is the service.
  const linked = await ctx.pool.query<{ canonical_subject_id: string }>(
    `SELECT l.canonical_subject_id
     FROM external_records r
     JOIN external_record_links l ON l.workspace_id = r.workspace_id AND l.external_record_id = r.id AND l.superseded_at IS NULL
     WHERE r.workspace_id = $1 AND r.record_type = $2 AND r.external_id = $3
     LIMIT 1`,
    [ctx.workspaceId, replacement.recordType, replacement.externalId]
  );
  if (linked.rows.length > 0) return linked.rows[0]!.canonical_subject_id;

  // 2. Schedule-derived mint: same id kind + key composition as the
  // provisioning materializer's serviceKey, derived from the externalId the
  // provider states (`carrier@departureInstant`).
  const at = replacement.externalId.lastIndexOf('@');
  const carrier = at === -1 ? replacement.externalId : replacement.externalId.slice(0, at);
  const departureInstant = at === -1 ? replacement.scheduledDeparture : replacement.externalId.slice(at + 1);
  const normalizedDeparture = new Date(departureInstant).toISOString();
  if (Number.isNaN(new Date(normalizedDeparture).getTime())) {
    throw new Error(`replacement service externalId does not carry a parsable departure instant: ${replacement.externalId}`);
  }
  const scopeMinter = new IdentityMinter(ctx.workspaceId, 'disruption-replacement-service');
  return scopeMinter.id('transport-service', carrier, normalizedDeparture, '*', '*');
}

/**
 * F3: schema validation of the provider event before any canonical work.
 * Returns a field-path message on the first violation; undefined when valid.
 * Instants are additionally checked to be real datetimes (zod-free here to
 * keep the ingress's HTTP boundary dependency-light and its errors exact).
 */
export function validateProviderDisruptionEvent(event: unknown): { ok: true; event: ProviderDisruptionEvent } | { ok: false; message: string } {
  const fail = (message: string): { ok: false; message: string } => ({ ok: false, message });
  if (typeof event !== 'object' || event === null) return fail('provider event must be a JSON object');
  const e = event as Record<string, unknown>;
  if (e.kind !== 'TRANSPORT_SERVICE_CANCELLED_WITH_REPROTECTION') return fail('unsupported event kind');
  if (e.disclosedAsSimulatedDemoInput !== true) return fail('demo ingress requires disclosed simulated demo input');
  if (typeof e.providerId !== 'string' || e.providerId.length === 0) return fail('providerId must be a non-empty string');
  if (typeof e.providerEventId !== 'string' || e.providerEventId.length === 0) return fail('providerEventId must be a non-empty string');
  if (typeof e.receivedAt !== 'string' || Number.isNaN(new Date(e.receivedAt).getTime())) return fail('receivedAt must be a valid datetime');
  for (const [label, section] of [['originalService', e.originalService], ['replacementService', e.replacementService]] as const) {
    if (typeof section !== 'object' || section === null) return fail(`${label} must be an object`);
    const s = section as Record<string, unknown>;
    if (s.recordType !== 'SOURCE_TRANSPORT_SERVICE') return fail(`${label}.recordType must be SOURCE_TRANSPORT_SERVICE`);
    if (typeof s.externalId !== 'string' || s.externalId.length === 0) return fail(`${label}.externalId must be a non-empty string`);
  }
  const replacement = e.replacementService as Record<string, unknown>;
  if (typeof replacement.operator !== 'string' || replacement.operator.length === 0) return fail('replacementService.operator must be a non-empty string');
  for (const field of ['scheduledDeparture', 'scheduledArrival'] as const) {
    if (typeof replacement[field] !== 'string' || !INSTANT.test(replacement[field] as string) || Number.isNaN(new Date(replacement[field] as string).getTime())) {
      return fail(`replacementService.${field} must be a valid instant`);
    }
  }
  if (replacement.mode !== undefined) {
    if (typeof replacement.mode !== 'string' || !(TRANSPORT_MODES as readonly string[]).includes(replacement.mode)) {
      return fail(`replacementService.mode must be one of ${TRANSPORT_MODES.join(', ')}`);
    }
  }
  if (!Array.isArray(e.affectedBookings) || e.affectedBookings.length === 0) return fail('affectedBookings must be a non-empty array');
  for (const [index, booking] of e.affectedBookings.entries()) {
    if (typeof booking !== 'object' || booking === null) return fail(`affectedBookings[${index}] must be an object`);
    const b = booking as Record<string, unknown>;
    if (b.recordType !== 'SOURCE_BOOKING_REFERENCE') return fail(`affectedBookings[${index}].recordType must be SOURCE_BOOKING_REFERENCE`);
    if (typeof b.externalId !== 'string' || b.externalId.length === 0) return fail(`affectedBookings[${index}].externalId must be a non-empty string`);
  }
  if (typeof e.reason !== 'string' || e.reason.length === 0) return fail('reason must be a non-empty string');
  if (typeof e.provenanceKind !== 'string' || e.provenanceKind.length === 0) return fail('provenanceKind must be a non-empty string');
  return { ok: true, event: e as unknown as ProviderDisruptionEvent };
}

export type ProviderDisruptionResult =
  | {
      ok: true;
      status: 'APPLIED' | 'ALREADY_APPLIED';
      originalServiceId: string;
      replacementServiceId: string;
      cancelledLineIds: string[];
      replacementReservationIds: string[];
      affectedBookingCount: number;
      evidenceId: string;
      sourceId: string;
    }
  | {
      ok: false;
      error: { code: string; message: string };
    };

async function readAggregateRevision(pool: Pool, workspaceId: string, aggregateId: string): Promise<number> {
  const result = await pool.query<{ revision: string }>(
    'SELECT revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2',
    [workspaceId, aggregateId]
  );
  if (result.rows.length === 0) {
    throw new Error(`Aggregate head not found for ${aggregateId}`);
  }
  return Number(result.rows[0]!.revision);
}

/** Surface a command conflict truthfully: its own kind becomes the error code. */
function conflictError(label: string, conflict: unknown): { ok: false; error: { code: string; message: string } } {
  const kind = (conflict as { kind?: string } | undefined)?.kind ?? 'PROVIDER_INFO_UNAVAILABLE';
  const message = (conflict as { message?: string } | undefined)?.message ?? 'unknown conflict';
  return { ok: false, error: { code: kind, message: `${label}: ${message}` } };
}

/**
 * Canonical fingerprint of a disruption event: substance over syntax. Instants
 * are normalized to UTC, receipt metadata (receivedAt) is excluded, identity
 * fields are compared exactly. A re-delivery that states the same disruption
 * in a different surface formatting still matches; one that states a
 * different disruption does not.
 */
export function canonicalDisruptionEventHash(event: TransportServiceCancelledWithReprotectionEvent): string {
  const instant = (value: string): string => new Date(value).toISOString();
  const canonical = {
    providerId: event.providerId,
    providerEventId: event.providerEventId,
    originalService: {
      recordType: event.originalService.recordType,
      externalId: event.originalService.externalId,
    },
    replacementService: {
      recordType: event.replacementService.recordType,
      externalId: event.replacementService.externalId,
      operator: event.replacementService.operator,
      departure: instant(event.replacementService.scheduledDeparture),
      arrival: instant(event.replacementService.scheduledArrival),
    },
    affectedBookings: event.affectedBookings.map((booking) => ({
      recordType: booking.recordType,
      externalId: booking.externalId,
    })).sort((a, b) => a.externalId.localeCompare(b.externalId) || a.recordType.localeCompare(b.recordType)),
    reason: event.reason,
    provenanceKind: event.provenanceKind,
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export async function acceptProviderDisruptionDemoEvent(
  ctx: TargetCommandContext,
  event: ProviderDisruptionEvent
): Promise<ProviderDisruptionResult> {
  try {
    // F3/F6: schema-validate the whole event BEFORE any work — invalid
    // provider input must fail with VALIDATION_FAILED and no canonical
    // mutation, not surface later as a mid-flow conflict.
    const validated = validateProviderDisruptionEvent(event);
    if (!validated.ok) {
      return { ok: false, error: { code: 'VALIDATION_FAILED', message: validated.message } };
    }

    // Canonical fingerprint of THIS delivery: identity fields with normalized
    // instants, excluding receipt metadata (receivedAt). The same provider
    // event identity must always carry the same substance, however the
    // instant was written; a different substance is a real mismatch.
    const eventContentHash = canonicalDisruptionEventHash(event);

    // Replacement service identity (F5): the canonical TransportService id is
    // NOT keyed to this provider event. It is derived from the replacement
    // service's own identity, using the SAME derivation the provisioning
    // materializer uses (`transport-service` id kind over
    // carrierRef|departureInstant|origin|destination), so two events that name
    // the same real service resolve to one canonical service. When the
    // provider event carries the service's own recordType/externalId we
    // resolve it through external identity before falling back to the
    // schedule-derived mint below.
    const replacementServiceId = await canonicalReplacementServiceId(
      ctx,
      event.replacementService,
    );

    // Deterministic id + idempotency keys for this event's own writes.
    const minter = new IdentityMinter(ctx.workspaceId, `disruption:${event.providerId}:${event.providerEventId}`);

    // ALREADY_APPLIED is decided ONLY by the durable completion marker (an
    // information record minted with a deterministic id for this provider
    // event, written by the LAST step after every required mutation has
    // committed). Marker present + same substance → ALREADY_APPLIED. Marker
    // absent → the run is still in progress, whatever partial state exists;
    // fall through to the full retry path below, which replays completed
    // steps and executes the missing ones.
    const sourceId = minter.id('source', event.providerEventId);
    const completionMarkerId = minter.id('completion-marker', event.providerEventId);
    const completionMarker = await ctx.pool.query<{ id: string }>(
      'SELECT id FROM information_records WHERE workspace_id = $1 AND id = $2',
      [ctx.workspaceId, completionMarkerId]
    );
    if (completionMarker.rows.length > 0) {
      // Same event identity must always carry the same substance: compare
      // against the content hash recorded with the event's own provenance.
      const recordedSource = await ctx.pool.query<{ content_hash: string }>(
        'SELECT content_hash FROM source_records WHERE workspace_id = $1 AND id = $2',
        [ctx.workspaceId, sourceId]
      );
      if (recordedSource.rows.length > 0 && recordedSource.rows[0]!.content_hash !== eventContentHash) {
        return {
          ok: false,
          error: {
            code: 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH',
            message: `provider event ${event.providerEventId} was already ingested with a different payload`,
          },
        };
      }
      // Resolve original service ID for the response
      const originalServiceResolution = await ctx.pool.query<{ canonical_subject_id: string }>(
        `SELECT l.canonical_subject_id
         FROM external_records r
         JOIN external_record_links l ON l.workspace_id = r.workspace_id AND l.external_record_id = r.id
         WHERE r.workspace_id = $1 AND r.record_type = $2 AND r.external_id = $3 AND l.superseded_at IS NULL`,
        [ctx.workspaceId, event.originalService.recordType, event.originalService.externalId]
      );

      const originalServiceId = originalServiceResolution.rows[0]?.canonical_subject_id ?? '';
      const evidenceId = minter.id('evidence', event.providerEventId);
      const replacementReservationIds = event.affectedBookings.map(booking =>
        minter.id('reservation', booking.externalId)
      );

      return {
        ok: true,
        status: 'ALREADY_APPLIED',
        originalServiceId,
        replacementServiceId,
        cancelledLineIds: [],
        replacementReservationIds,
        affectedBookingCount: event.affectedBookings.length,
        evidenceId,
        sourceId,
      };
    }

    // Mint replacement reservation ids for the main flow
    const replacementReservationIds = event.affectedBookings.map(booking =>
      minter.id('reservation', booking.externalId)
    );

    // Step 1: Resolve provisioning connection + canonical subjects
    const originalServiceResolution = await ctx.pool.query<{
      connection_id: string;
      canonical_subject_kind: string;
      canonical_subject_id: string;
    }>(
      `SELECT r.connection_id, l.canonical_subject_kind, l.canonical_subject_id
       FROM external_records r
       JOIN external_record_links l ON l.workspace_id = r.workspace_id AND l.external_record_id = r.id
       WHERE r.workspace_id = $1 AND r.record_type = $2 AND r.external_id = $3 AND l.superseded_at IS NULL`,
      [ctx.workspaceId, event.originalService.recordType, event.originalService.externalId]
    );

    if (originalServiceResolution.rows.length === 0) {
      return { ok: false, error: { code: 'PROVIDER_INFO_UNAVAILABLE', message: `original service ${event.originalService.externalId} not resolved` } };
    }

    const originalServiceSubject = originalServiceResolution.rows[0]!;
    if (originalServiceSubject.canonical_subject_kind !== 'TRANSPORT_SERVICE') {
      return { ok: false, error: { code: 'PROVIDER_INFO_UNAVAILABLE', message: `original service resolved to ${originalServiceSubject.canonical_subject_kind}, expected TRANSPORT_SERVICE` } };
    }

    const originalServiceId = originalServiceSubject.canonical_subject_id;
    const connectionId = originalServiceSubject.connection_id;

    // Resolve affected bookings
    const affectedBookingSubjects = [];
    for (const booking of event.affectedBookings) {
      const resolution = await ctx.pool.query<{
        connection_id: string;
        canonical_subject_kind: string;
        canonical_subject_id: string;
      }>(
        `SELECT r.connection_id, l.canonical_subject_kind, l.canonical_subject_id
         FROM external_records r
         JOIN external_record_links l ON l.workspace_id = r.workspace_id AND l.external_record_id = r.id
         WHERE r.workspace_id = $1 AND r.record_type = $2 AND r.external_id = $3 AND l.superseded_at IS NULL`,
        [ctx.workspaceId, booking.recordType, booking.externalId]
      );

      if (resolution.rows.length === 0) {
        return { ok: false, error: { code: 'PROVIDER_INFO_UNAVAILABLE', message: `affected booking ${booking.externalId} not resolved` } };
      }

      const subject = resolution.rows[0]!;
      if (subject.canonical_subject_kind !== 'RESERVATION') {
        return { ok: false, error: { code: 'PROVIDER_INFO_UNAVAILABLE', message: `affected booking ${booking.externalId} resolved to ${subject.canonical_subject_kind}, expected RESERVATION` } };
      }

      if (subject.connection_id !== connectionId) {
        return { ok: false, error: { code: 'PROVIDER_INFO_UNAVAILABLE', message: `affected booking ${booking.externalId} on different connection` } };
      }

      affectedBookingSubjects.push({
        externalId: booking.externalId,
        reservationId: subject.canonical_subject_id,
      });
    }

    // Step 2: Validate truth — for each booking, collect ALL transport lines on
    // the original service. Two states are acceptable, and which one applies
    // depends on whether this event has already started mutating the world
    // (partial-failure retry):
    //   • first delivery: ≥1 CONFIRMED original line to displace;
    //   • in-progress retry of THIS event: its original lines are already
    //     CANCELLED (evidence-stamped by this event's own idempotent commands)
    //     and the intended replacement state may already partially exist.
    // A line cancelled by anything OTHER than this event's evidence is not
    // progress — it is a conflict (the provider story doesn't hold).
    // The evidence id is minted HERE because Step 2's in-progress recognition
    // compares line stamps against it: it is the deterministic mark that
    // distinguishes THIS event's own displacement from any other cancellation.
    const evidenceId = minter.id('evidence', event.providerEventId);
    const originalService = await ctx.pool.query<{
      origin_place_id: string;
      destination_place_id: string;
      mode: string;
    }>(
      'SELECT origin_place_id, destination_place_id, mode FROM transport_services WHERE workspace_id = $1 AND id = $2',
      [ctx.workspaceId, originalServiceId]
    );

    if (originalService.rows.length === 0) {
      return { ok: false, error: { code: 'PROVIDER_INFO_UNAVAILABLE', message: `original service ${originalServiceId} not found` } };
    }
    const originalServiceRow = originalService.rows[0]!;
    // F6: a like-for-like involuntary reprotection keeps the original's mode
    // unless the provider explicitly validated a different one.
    const replacementMode = (event.replacementService as { mode?: string }).mode ?? originalServiceRow.mode;

    interface DisplacedLine { id: string; reservationId: string; observedStatus: string; observationEvidenceId: string | null }
    const displacedLinesByBooking: Map<string, DisplacedLine[]> = new Map();
    let anyConfirmed = false;
    let anyCancelledByThisEvent = false;

    for (const booking of affectedBookingSubjects) {
      const lineCheck = await ctx.pool.query<{ id: string; observed_status: string; observation_evidence_id: string | null }>(
        `SELECT l.id, l.observed_status, l.observation_evidence_id
         FROM reservation_lines l
         JOIN transport_line_details t ON t.workspace_id = l.workspace_id AND t.line_id = l.id
         WHERE l.workspace_id = $1 AND l.reservation_id = $2
         AND l.product_type = 'TRANSPORT'
         AND t.transport_service_id = $3`,
        [ctx.workspaceId, booking.reservationId, originalServiceId]
      );

      if (lineCheck.rows.length === 0) {
        return { ok: false, error: { code: 'PROVIDER_INFO_UNAVAILABLE', message: `booking ${booking.externalId} has no transport line for service ${originalServiceId}` } };
      }

      const cancelledByOtherEvidence = lineCheck.rows.some(
        (line) => line.observed_status === 'CANCELLED' && line.observation_evidence_id !== evidenceId
      );
      if (cancelledByOtherEvidence) {
        return { ok: false, error: { code: 'PROVIDER_INFO_UNAVAILABLE', message: `booking ${booking.externalId} original service line was cancelled outside this disruption` } };
      }

      const confirmed = lineCheck.rows.filter((line) => line.observed_status === 'CONFIRMED');
      const cancelledByThisEvent = lineCheck.rows.filter((line) => line.observed_status === 'CANCELLED' && line.observation_evidence_id === evidenceId);
      if (confirmed.length > 0) anyConfirmed = true;
      if (cancelledByThisEvent.length > 0) anyCancelledByThisEvent = true;
      displacedLinesByBooking.set(booking.externalId, lineCheck.rows.map((line) => ({
        id: line.id,
        reservationId: booking.reservationId,
        observedStatus: line.observed_status,
        observationEvidenceId: line.observation_evidence_id,
      })));
    }

    if (!anyConfirmed && !anyCancelledByThisEvent) {
      return { ok: false, error: { code: 'PROVIDER_INFO_UNAVAILABLE', message: `no CONFIRMED transport line for service ${originalServiceId} and no in-progress cancellation from this event` } };
    }

    // N1 guard: the replacement service id (resolved above) may already have
    // a transport_services row — a real service being rediscovered, an
    // in-progress retry of THIS event, or (the bug this guards against) an
    // UNRELATED event that happens to mint/link the same id for a different
    // corridor. Nothing upstream ties the replacement id to a corridor (the
    // schedule-derived mint uses wildcard origin/destination; see the doc
    // comment on canonicalReplacementServiceId), so before any mutation is
    // allowed, an existing row must match THIS event's original (cancelled)
    // service on origin, destination and mode, must match this event's
    // stated operator, and its stored published departure/arrival must match
    // this event's stated replacement schedule — compared as instants, not
    // strings, since the same instant can be written in different offsets.
    // published_departure/published_arrival are nullable columns (a service
    // row can carry an incomplete published schedule); a null stored value
    // can never equal a stated instant, so it is treated as a schedule
    // mismatch rather than risking a TypeError off `.getTime()` on null. A
    // retry of the SAME event always passes: Step 5 would create (or already
    // created) the row from these exact values, so it matches by
    // construction. A mismatch is a truthful conflict, not a create-time
    // detail — no mutation happens below it.
    const existingReplacementService = await ctx.pool.query<{
      origin_place_id: string;
      destination_place_id: string;
      mode: string;
      operator: string;
      published_departure: Date | null;
      published_arrival: Date | null;
    }>(
      'SELECT origin_place_id, destination_place_id, mode, operator, published_departure, published_arrival FROM transport_services WHERE workspace_id = $1 AND id = $2',
      [ctx.workspaceId, replacementServiceId]
    );
    if (existingReplacementService.rows.length > 0) {
      const existingRow = existingReplacementService.rows[0]!;
      const statedDeparture = new Date(event.replacementService.scheduledDeparture).getTime();
      const statedArrival = new Date(event.replacementService.scheduledArrival).getTime();
      const corridorMatches =
        existingRow.origin_place_id === originalServiceRow.origin_place_id &&
        existingRow.destination_place_id === originalServiceRow.destination_place_id &&
        existingRow.mode === replacementMode &&
        existingRow.operator === event.replacementService.operator;
      const scheduleMatches =
        existingRow.published_departure !== null &&
        existingRow.published_arrival !== null &&
        existingRow.published_departure.getTime() === statedDeparture &&
        existingRow.published_arrival.getTime() === statedArrival;
      if (!corridorMatches || !scheduleMatches) {
        return {
          ok: false,
          error: {
            code: 'VALIDATION_FAILED',
            message:
              `replacement service ${replacementServiceId} already exists as a different ` +
              `${!corridorMatches ? 'corridor/mode/operator' : 'schedule'} than event ${event.providerEventId}'s ` +
              `original service ${originalServiceId} and stated replacement operator/schedule ` +
              `(${event.replacementService.operator}, ${event.replacementService.scheduledDeparture} -> ${event.replacementService.scheduledArrival})`,
          },
        };
      }
    }

    // Step 3: Provenance - record source + evidence. The idempotent commands
    // below replay their receipts when already applied.
    const sourceResult = await recordSource(ctx.uow(), {
      workspaceId: ctx.workspaceId,
      actorPrincipalId: ctx.actorPrincipalId,
      idempotencyKey: `demo-ingress:${event.providerId}:${event.providerEventId}:source`,
      sourceId,
      sourceIdentity: `provider-disruption:${event.providerId}:${event.providerEventId}`,
      receivedAt: event.receivedAt,
      contentHash: eventContentHash,      contentType: 'application/json',
    });

    if (!sourceResult.ok) {
      return conflictError('failed to record source', sourceResult.conflict);
    }

    const evidenceResult = await recordEvidence(ctx.uow(), {
      workspaceId: ctx.workspaceId,
      actorPrincipalId: ctx.actorPrincipalId,
      idempotencyKey: `demo-ingress:${event.providerId}:${event.providerEventId}:evidence`,
      evidenceId,
      assertionType: 'TRANSPORT_SERVICE_CANCELLED_WITH_REPROTECTION',
      observedAt: event.receivedAt,
      schemaVersion: '1',
      sourceIds: [sourceId],
      subjectRefs: [{ kind: 'TRANSPORT_SERVICE', id: originalServiceId }],
    });

    if (!evidenceResult.ok) {
      return conflictError('failed to record evidence', evidenceResult.conflict);
    }

    // Step 4: Displacement — mark CONFIRMED original lines as CANCELLED.
    // On retry, lines this event already cancelled are skipped (their state is
    // the truthful in-progress displacement recorded above); only lines still
    // CONFIRMED get the cancellation observation, each through its own
    // idempotent command.
    const cancelledLineIds: string[] = [];
    for (const booking of affectedBookingSubjects) {
      for (const line of displacedLinesByBooking.get(booking.externalId) ?? []) {
        if (line.observedStatus !== 'CONFIRMED') {
          continue;
        }

        const reservationRevision = await readAggregateRevision(ctx.pool, ctx.workspaceId, booking.reservationId);
        const obsResult = await recordReservationLineObservation(ctx.uow(), {
          workspaceId: ctx.workspaceId,
          actorPrincipalId: ctx.actorPrincipalId,
          idempotencyKey: `demo-ingress:${event.providerId}:${event.providerEventId}:displace:${line.id}`,
          reservationId: booking.reservationId,
          lineId: line.id,
          expectedRevision: reservationRevision,
          observation: {
            observedStatus: 'CANCELLED',
            observedStatusAt: event.receivedAt,
            observationEvidenceId: evidenceId,
          },
          evidenceRefs: [evidenceId],
        });

        if (!obsResult.ok) {
          return conflictError(`failed to cancel line ${line.id}`, obsResult.conflict);
        }

        cancelledLineIds.push(line.id);
      }
    }

    // Step 5: Create replacement transport service (F5: identity is minted
    // from the provider service identity on the connection — the same
    // replacement service on a later event resolves to the same canonical
    // service, and an already-existing service row is reused below; F6: mode
    // is derived from the original service, not hardcoded).
    const serviceResult = await createTransportService(ctx.uow(), {
      workspaceId: ctx.workspaceId,
      actorPrincipalId: ctx.actorPrincipalId,
      idempotencyKey: `demo-ingress:${event.providerId}:${event.providerEventId}:replacement-service`,
      service: {
        id: replacementServiceId,
        mode: replacementMode as 'AIR' | 'RAIL' | 'ROAD' | 'SEA',
        operator: event.replacementService.operator,
        originPlaceId: originalServiceRow.origin_place_id,
        destinationPlaceId: originalServiceRow.destination_place_id,
        publishedDeparture: {
          value: event.replacementService.scheduledDeparture,
          observedAt: event.receivedAt,
          sourceId: evidenceId,
        },
        publishedArrival: {
          value: event.replacementService.scheduledArrival,
          observedAt: event.receivedAt,
          sourceId: evidenceId,
        },
      },
      evidenceRefs: [evidenceId],
    });

    if (!serviceResult.ok) {
      // F5: the replacement service identity is derived from the provider's
      // service identity, so a service row that already exists for it is the
      // SAME canonical service being discovered again (later event targeting
      // the same real service, or this event retrying after a partial run) —
      // reuse it rather than failing. This is safe because the N1 guard above
      // (before Step 3) already proved any pre-existing row matches this
      // event's corridor/mode/schedule; it would have returned
      // VALIDATION_FAILED before any mutation if it didn't. Any conflict
      // other than that duplicate is still surfaced.
      const existing = await ctx.pool.query<{ id: string }>(
        'SELECT id FROM transport_services WHERE workspace_id = $1 AND id = $2',
        [ctx.workspaceId, replacementServiceId]
      );
      if (existing.rows.length === 0) {
        return conflictError('failed to create replacement service', serviceResult.conflict);
      }
    }

    // Step 6a: create ALL replacement reservations first. Splitting this from
    // line/allocation work makes "all reservations exist but no line does" a
    // real crash-retry boundary (F1 failure-injection point 2): on retry the
    // reservation commands replay their receipts and the remaining steps
    // execute fresh.
    for (let i = 0; i < affectedBookingSubjects.length; i++) {
      const booking = affectedBookingSubjects[i]!;
      const replacementReservationId = replacementReservationIds[i]!;

      // Read original reservation to get responsibleOrganisationId
      const originalReservation = await ctx.pool.query<{
        responsible_organisation_id: string | null;
        responsible_traveller_id: string | null;
      }>(
        `SELECT responsible_organisation_id, responsible_traveller_id
         FROM reservations WHERE workspace_id = $1 AND id = $2`,
        [ctx.workspaceId, booking.reservationId]
      );

      if (originalReservation.rows.length === 0) {
        return { ok: false, error: { code: 'PROVIDER_INFO_UNAVAILABLE', message: `original reservation ${booking.reservationId} not found` } };
      }

      const originalReservationRow = originalReservation.rows[0]!;

      const reservationResult = await createReservation(ctx.uow(), {
        workspaceId: ctx.workspaceId,
        actorPrincipalId: ctx.actorPrincipalId,
        idempotencyKey: `demo-ingress:${event.providerId}:${event.providerEventId}:reservation:${booking.externalId}`,
        reservation: {
          id: replacementReservationId,
          reservationType: 'TRANSPORT',
          observedStatus: 'CONFIRMED',
          observedStatusAt: event.receivedAt,
          ...(originalReservationRow.responsible_organisation_id ? { responsibleOrganisationId: originalReservationRow.responsible_organisation_id } : {}),
          ...(originalReservationRow.responsible_traveller_id ? { responsibleTravellerId: originalReservationRow.responsible_traveller_id } : {}),
          externalConnectionId: connectionId,
        },
        evidenceRefs: [evidenceId],
      });

      if (!reservationResult.ok) {
        return conflictError('failed to create replacement reservation', reservationResult.conflict);
      }
    }

    // Step 6b: per displaced PNR — lines, allocations, journey selection.
    for (let i = 0; i < affectedBookingSubjects.length; i++) {
      const booking = affectedBookingSubjects[i]!;
      const replacementReservationId = replacementReservationIds[i]!;

      // Read the allocations that bind THIS reservation to the displaced lines:
      // scoping to the cancelled lines is the truthful displacement boundary —
      // a multi-leg PNR's other bookings must not be reprotected or re-pointed.
      const displacedAllocations = await ctx.pool.query<{
        traveller_id: string;
        journey_item_id: string | null;
        line_id: string;
      }>(
        `SELECT DISTINCT a.traveller_id, a.journey_item_id, a.line_id
         FROM reservation_allocations a
         JOIN reservation_lines l ON l.workspace_id = a.workspace_id AND l.id = a.line_id
           AND l.reservation_id = a.reservation_id
         JOIN transport_line_details t ON t.workspace_id = l.workspace_id AND t.line_id = l.id
         WHERE a.workspace_id = $1 AND a.reservation_id = $2
           AND l.observed_status = 'CANCELLED'
           AND t.transport_service_id = $3`,
        [ctx.workspaceId, booking.reservationId, originalServiceId]
      );

      // Replay returns the reservation's CURRENT committed revision, so the
      // line commands below always chain from the real head on a retry.
      let currentReservationRevision = await readAggregateRevision(ctx.pool, ctx.workspaceId, replacementReservationId);

      for (const allocation of displacedAllocations.rows) {
        // Add reservation line
        const lineId = minter.id('reservation-line', booking.externalId, allocation.traveller_id, allocation.journey_item_id ?? 'none');
        const lineResult = await addReservationLine(ctx.uow(), {
          workspaceId: ctx.workspaceId,
          actorPrincipalId: ctx.actorPrincipalId,
          idempotencyKey: `demo-ingress:${event.providerId}:${event.providerEventId}:line:${booking.externalId}:${allocation.traveller_id}:${allocation.journey_item_id ?? 'none'}`,
          reservationId: replacementReservationId,
          expectedRevision: currentReservationRevision,
          line: {
            id: lineId,
            productType: 'TRANSPORT',
            observedStatus: 'CONFIRMED',
            observedStatusAt: event.receivedAt,
            transportServiceId: replacementServiceId,
            observationEvidenceId: evidenceId,
          },
          detail: {
            productType: 'TRANSPORT',
            transportServiceId: replacementServiceId,
          },
          evidenceRefs: [evidenceId],
        });

        if (!lineResult.ok) {
          return conflictError('failed to add replacement line', lineResult.conflict);
        }

        currentReservationRevision = lineResult.value.reservationRevision;

        // Allocate reservation line
        const allocResult = await allocateReservationLine(ctx.uow(), {
          workspaceId: ctx.workspaceId,
          actorPrincipalId: ctx.actorPrincipalId,
          idempotencyKey: `demo-ingress:${event.providerId}:${event.providerEventId}:allocation:${booking.externalId}:${allocation.traveller_id}:${allocation.journey_item_id ?? 'none'}`,
          reservationId: replacementReservationId,
          expectedRevision: currentReservationRevision,
          allocation: {
            // Deterministic id: the command hashes this payload into its
            // idempotency receipt, so a random id would make every replay of
            // this command a payload mismatch instead of a replay.
            id: minter.id('allocation', booking.externalId, allocation.traveller_id, allocation.journey_item_id ?? 'none'),
            reservationLineId: lineId,
            travellerId: allocation.traveller_id,
            ...(allocation.journey_item_id ? { journeyItemId: allocation.journey_item_id } : {}),
            allocationRole: 'TRAVELLER',
            quantity: 1,
          },
          evidenceRefs: [evidenceId],
        });

        if (!allocResult.ok) {
          return conflictError('failed to allocate replacement line', allocResult.conflict);
        }

        currentReservationRevision = allocResult.value.reservationRevision;

        // Update journey item selection to the replacement service: this is how
        // the journey's effective itinerary flips to the replacement. Selected
        // service is supported by updateJourneyItem (written to
        // transport_item_details.selected_service_id).
        if (allocation.journey_item_id) {
          const journeyItem = await ctx.pool.query<{ journey_id: string }>(
            'SELECT journey_id FROM journey_items WHERE workspace_id = $1 AND id = $2',
            [ctx.workspaceId, allocation.journey_item_id]
          );

          if (journeyItem.rows.length > 0) {
            const journeyRevision = await readAggregateRevision(ctx.pool, ctx.workspaceId, journeyItem.rows[0]!.journey_id);
            const selectionResult = await updateJourneyItem(ctx.uow(), {
              workspaceId: ctx.workspaceId,
              actorPrincipalId: ctx.actorPrincipalId,
              idempotencyKey: `demo-ingress:${event.providerId}:${event.providerEventId}:journey-item:${allocation.journey_item_id}`,
              journeyId: journeyItem.rows[0]!.journey_id,
              journeyItemId: allocation.journey_item_id,
              expectedRevision: journeyRevision,
              selectedServiceId: replacementServiceId,
              evidenceRefs: [evidenceId],
            });
            if (!selectionResult.ok) {
              return conflictError(`failed to select replacement service on journey item ${allocation.journey_item_id}`, selectionResult.conflict);
            }
          }
        }
      }
    }

    // Step 7: External identity on the connection
    let connectionRevision = await readAggregateRevision(ctx.pool, ctx.workspaceId, connectionId);

    // Observe and link replacement service.
    // F5: if the service's external record already exists AND is live-linked
    // to the canonical replacement service, this event is re-discovering the
    // same real service — the required end state already holds, so the
    // observe/link pair is skipped (re-observing a LINKED record is rejected
    // by the F08 identity-state guard). On this event's own retry the command
    // keys replay through receipts instead, so no state is skipped there.
    const existingServiceRecord = await ctx.pool.query<{ id: string; identity_state: string; canonical_subject_id: string | null }>(
      `SELECT r.id, r.identity_state, l.canonical_subject_id
       FROM external_records r
       LEFT JOIN external_record_links l ON l.workspace_id = r.workspace_id AND l.external_record_id = r.id AND l.superseded_at IS NULL
       WHERE r.workspace_id = $1 AND r.connection_id = $2 AND r.record_type = $3 AND r.external_id = $4`,
      [ctx.workspaceId, connectionId, event.replacementService.recordType, event.replacementService.externalId]
    );
    const serviceRecordRow = existingServiceRecord.rows[0];
    const serviceIdentityAlreadyHolds =
      serviceRecordRow !== undefined &&
      serviceRecordRow.identity_state === 'LINKED' &&
      serviceRecordRow.canonical_subject_id === replacementServiceId;

    const replacementServiceRecordId = minter.id('external-record', event.replacementService.recordType, event.replacementService.externalId);
    const observeServiceResult = serviceIdentityAlreadyHolds
      ? null
      : await observeExternalRecord(ctx.uow(), {
      workspaceId: ctx.workspaceId,
      actorPrincipalId: ctx.actorPrincipalId,
      idempotencyKey: `demo-ingress:${event.providerId}:${event.providerEventId}:external-service`,
      connectionId,
      expectedRevision: connectionRevision,
      record: {
        id: replacementServiceRecordId,
        recordType: event.replacementService.recordType,
        externalId: event.replacementService.externalId,
        identityState: 'UNVERIFIED',
        observedAt: event.receivedAt,
      },
      evidenceRefs: [evidenceId],
    });

    if (observeServiceResult !== null && !observeServiceResult.ok) {
      return conflictError('failed to observe replacement service external record', observeServiceResult.conflict);
    }

    if (observeServiceResult !== null) {
      connectionRevision = observeServiceResult.value.connectionRevision;
    }

    const linkServiceResult = serviceIdentityAlreadyHolds
      ? null
      : await linkExternalRecord(ctx.uow(), {
      workspaceId: ctx.workspaceId,
      actorPrincipalId: ctx.actorPrincipalId,
      idempotencyKey: `demo-ingress:${event.providerId}:${event.providerEventId}:external-link-service`,
      connectionId,
      expectedRevision: connectionRevision,
      link: {
        id: minter.id('external-link', event.replacementService.recordType, event.replacementService.externalId),
        externalRecordId: replacementServiceRecordId,
        canonicalSubject: { kind: 'TRANSPORT_SERVICE', id: replacementServiceId },
        linkKind: 'SYSTEM_OF_RECORD',
        evidenceId,
        linkedAt: event.receivedAt,
      },
      evidenceRefs: [evidenceId],
    });

    if (linkServiceResult !== null && !linkServiceResult.ok) {
      return conflictError('failed to link replacement service external record', linkServiceResult.conflict);
    }

    if (linkServiceResult !== null) {
      connectionRevision = linkServiceResult.value.connectionRevision;
    }

    // Observe and link synthetic booking references
    for (let i = 0; i < affectedBookingSubjects.length; i++) {
      const booking = affectedBookingSubjects[i]!;
      const replacementReservationId = replacementReservationIds[i]!;
      const syntheticExternalId = `REPROTECTED:${event.providerEventId}:${booking.externalId}`;

      const syntheticRecordId = minter.id('external-record', 'SOURCE_BOOKING_REFERENCE', syntheticExternalId);
      const observeBookingResult = await observeExternalRecord(ctx.uow(), {
        workspaceId: ctx.workspaceId,
        actorPrincipalId: ctx.actorPrincipalId,
        idempotencyKey: `demo-ingress:${event.providerId}:${event.providerEventId}:external-booking:${booking.externalId}`,
        connectionId,
        expectedRevision: connectionRevision,
        record: {
          id: syntheticRecordId,
          recordType: 'SOURCE_BOOKING_REFERENCE',
          externalId: syntheticExternalId,
          identityState: 'UNVERIFIED',
          observedAt: event.receivedAt,
        },
        evidenceRefs: [evidenceId],
      });

      if (!observeBookingResult.ok) {
        return conflictError('failed to observe synthetic booking external record', observeBookingResult.conflict);
      }

      connectionRevision = observeBookingResult.value.connectionRevision;

      const linkBookingResult = await linkExternalRecord(ctx.uow(), {
        workspaceId: ctx.workspaceId,
        actorPrincipalId: ctx.actorPrincipalId,
        idempotencyKey: `demo-ingress:${event.providerId}:${event.providerEventId}:external-link-booking:${booking.externalId}`,
        connectionId,
        expectedRevision: connectionRevision,
        link: {
          id: minter.id('external-link', 'SOURCE_BOOKING_REFERENCE', syntheticExternalId),
          externalRecordId: syntheticRecordId,
          canonicalSubject: { kind: 'RESERVATION', id: replacementReservationId },
          linkKind: 'SYSTEM_OF_RECORD',
          evidenceId,
          linkedAt: event.receivedAt,
        },
        evidenceRefs: [evidenceId],
      });

      if (!linkBookingResult.ok) {
        return conflictError('failed to link synthetic booking external record', linkBookingResult.conflict);
      }

      connectionRevision = linkBookingResult.value.connectionRevision;
    }

    // Step 8: Completion marker (F1) — the LAST required step. Only after
    // every mutation above has committed does this durable receipt get
    // written through its own idempotent M5 command; from then on, duplicate
    // deliveries of the same provider event resolve ALREADY_APPLIED from this
    // marker, never from "things exist".
    const markerResult = await recordInformationRecord(ctx.uow(), {
      workspaceId: ctx.workspaceId,
      actorPrincipalId: ctx.actorPrincipalId,
      idempotencyKey: `demo-ingress:${event.providerId}:${event.providerEventId}:completion-marker`,
      informationRecordId: completionMarkerId,
      externalPublicationKey: `provider-disruption:${event.providerId}:${event.providerEventId}`,
      topic: `provider-disruption-completion:${event.providerId}:${event.providerEventId}`,
      sourceConnectionIdentity: `provider-disruption:${event.providerId}:${event.providerEventId}`,
    });
    if (!markerResult.ok) {
      return conflictError('failed to write disruption completion marker', markerResult.conflict);
    }

    return {
      ok: true,
      status: 'APPLIED',
      originalServiceId,
      replacementServiceId,
      cancelledLineIds,
      replacementReservationIds,
      affectedBookingCount: event.affectedBookings.length,
      evidenceId,
      sourceId,
    };
  } catch (error) {
    return { ok: false, error: { code: 'PROVIDER_INFO_UNAVAILABLE', message: error instanceof Error ? error.message : String(error) } };
  }
}

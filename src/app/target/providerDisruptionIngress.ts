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
    // Validate input
    if (!event.disclosedAsSimulatedDemoInput) {
      return { ok: false, error: { code: 'VALIDATION_FAILED', message: 'demo ingress requires disclosed simulated demo input' } };
    }
    if (!event.providerId || !event.providerEventId) {
      return { ok: false, error: { code: 'VALIDATION_FAILED', message: 'provider event identity required' } };
    }
    if (event.kind !== 'TRANSPORT_SERVICE_CANCELLED_WITH_REPROTECTION') {
      return { ok: false, error: { code: 'VALIDATION_FAILED', message: 'unsupported event kind' } };
    }

    const minter = new IdentityMinter(ctx.workspaceId, `disruption:${event.providerId}:${event.providerEventId}`);

    // Canonical fingerprint of THIS delivery: identity fields with normalized
    // instants, excluding receipt metadata (receivedAt). The same provider
    // event identity must always carry the same substance, however the
    // instant was written; a different substance is a real mismatch.
    const eventContentHash = canonicalDisruptionEventHash(event);

    // Mint replacement service id
    const replacementServiceId = minter.id('transport-service', event.replacementService.externalId);

    // Mint replacement reservation ids
    const replacementReservationIds = event.affectedBookings.map(booking =>
      minter.id('reservation', booking.externalId)
    );

    // ALREADY_APPLIED check: verify replacement service + all reservations exist
    const serviceCheck = await ctx.pool.query<{ id: string }>(
      'SELECT id FROM transport_services WHERE workspace_id = $1 AND id = $2',
      [ctx.workspaceId, replacementServiceId]
    );
    if (serviceCheck.rows.length > 0) {
      const reservationChecks = await Promise.all(
        replacementReservationIds.map(id =>
          ctx.pool.query<{ id: string }>(
            'SELECT id FROM reservations WHERE workspace_id = $1 AND id = $2',
            [ctx.workspaceId, id]
          )
        )
      );
      const allReservationsExist = reservationChecks.every(r => r.rows.length > 0);
      if (allReservationsExist) {
        // Same event identity must always carry the same payload: compare
        // against the content hash recorded with the event's own provenance.
        const sourceId = minter.id('source', event.providerEventId);
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
    }

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

    // Step 2: Validate truth - each reservation has ≥1 CONFIRMED transport line for original service
    for (const booking of affectedBookingSubjects) {
      const lineCheck = await ctx.pool.query<{ id: string }>(
        `SELECT l.id
         FROM reservation_lines l
         JOIN transport_line_details t ON t.workspace_id = l.workspace_id AND t.line_id = l.id
         WHERE l.workspace_id = $1 AND l.reservation_id = $2
         AND l.product_type = 'TRANSPORT'
         AND t.transport_service_id = $3
         AND l.observed_status = 'CONFIRMED'`,
        [ctx.workspaceId, booking.reservationId, originalServiceId]
      );

      if (lineCheck.rows.length === 0) {
        return { ok: false, error: { code: 'PROVIDER_INFO_UNAVAILABLE', message: `booking ${booking.externalId} has no CONFIRMED transport line for service ${originalServiceId}` } };
      }
    }

    // Step 3: Provenance - record source + evidence
    const sourceId = minter.id('source', event.providerEventId);
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

    const evidenceId = minter.id('evidence', event.providerEventId);
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

    // Step 4: Displacement - mark displaced lines as CANCELLED
    const cancelledLineIds: string[] = [];
    for (const booking of affectedBookingSubjects) {
      const lines = await ctx.pool.query<{ id: string; reservation_id: string }>(
        `SELECT l.id, l.reservation_id
         FROM reservation_lines l
         JOIN transport_line_details t ON t.workspace_id = l.workspace_id AND t.line_id = l.id
         WHERE l.workspace_id = $1 AND l.reservation_id = $2
         AND l.product_type = 'TRANSPORT'
         AND t.transport_service_id = $3
         AND l.observed_status = 'CONFIRMED'`,
        [ctx.workspaceId, booking.reservationId, originalServiceId]
      );

      for (const line of lines.rows) {
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

    // Step 5: Create replacement transport service
    const originalService = await ctx.pool.query<{
      origin_place_id: string;
      destination_place_id: string;
    }>(
      'SELECT origin_place_id, destination_place_id FROM transport_services WHERE workspace_id = $1 AND id = $2',
      [ctx.workspaceId, originalServiceId]
    );

    if (originalService.rows.length === 0) {
      return { ok: false, error: { code: 'PROVIDER_INFO_UNAVAILABLE', message: `original service ${originalServiceId} not found` } };
    }

    const originalServiceRow = originalService.rows[0]!;
    const serviceResult = await createTransportService(ctx.uow(), {
      workspaceId: ctx.workspaceId,
      actorPrincipalId: ctx.actorPrincipalId,
      idempotencyKey: `demo-ingress:${event.providerId}:${event.providerEventId}:replacement-service`,
      service: {
        id: replacementServiceId,
        mode: 'AIR',
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
      return conflictError('failed to create replacement service', serviceResult.conflict);
    }

    // Step 6: Per displaced PNR - create replacement reservations
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

      let currentReservationRevision = reservationResult.value.revision;

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

    // Observe and link replacement service
    const replacementServiceRecordId = minter.id('external-record', event.replacementService.recordType, event.replacementService.externalId);
    const observeServiceResult = await observeExternalRecord(ctx.uow(), {
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

    if (!observeServiceResult.ok) {
      return conflictError('failed to observe replacement service external record', observeServiceResult.conflict);
    }

    connectionRevision = observeServiceResult.value.connectionRevision;

    const linkServiceResult = await linkExternalRecord(ctx.uow(), {
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

    if (!linkServiceResult.ok) {
      return conflictError('failed to link replacement service external record', linkServiceResult.conflict);
    }

    connectionRevision = linkServiceResult.value.connectionRevision;

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

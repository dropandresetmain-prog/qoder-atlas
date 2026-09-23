/**
 * Atomic attachment of one already-observed provider stay to a Journey.
 *
 * This command consumes a normalized provider observation. It never calls a
 * provider and it never changes supplier state. The Journey item is intent;
 * the Reservation line is the evidence-backed supplier observation.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { UnitOfWork } from '../../../contracts/v2/command/unitOfWork.ts';
import { DomainCommandEnvelopeSchema, type DomainCommandEnvelope } from '../../../contracts/v2/command/domainCommand.ts';
import type { ExternalRecordLinkRecord } from '../../../contracts/v2/repository/arrangements.ts';
import type { ActorContext } from '../../../contracts/v2/repository/people.ts';
import type { TypedRef } from '../../../domain/v2/shared/identity.ts';
import {
  CredentialSelectionSchema,
  IntendedVisitSchema,
  JourneyItemSchema,
  type CredentialSelection,
  type JourneyItem,
} from '../../../domain/v2/trip/trip.ts';
import {
  ReservationAllocationSchema,
  ReservationLineSchema,
  ReservationSchema,
  type ReservationAllocation,
  type ReservationLine,
  type Reservation,
} from '../../../domain/v2/arrangements/reservation.ts';
import { InstantIntervalSchema, InstantSchema } from '../../../domain/v2/shared/time.ts';
import { typedConflict, type TypedConflict } from '../../../domain/v2/shared/errors.ts';
import { canonicalPayloadHash } from '../canonicalHash.ts';
import {
  advanceHead,
  appendAuditTrail,
  buildReceipt,
  createRoot,
  derivedCommandRef,
  lockedRevisionOf,
  registerChildSubject,
  type AdvancedRoot,
} from '../commandSupport.ts';
import type { ExecuteOutcome } from '../pgUnitOfWork.ts';
import { PgArrangementRepositories } from '../repositories/pgArrangementRepositories.ts';
import { PgGeographyRepository } from '../repositories/pgGeographyRepository.ts';
import { PgJourneyRepository } from '../repositories/pgJourneyRepository.ts';
import { currentTransactionClient } from '../transactionContext.ts';
import { recordSelectedPlanCanonicalApplication } from '../execution/selectedPlanContinuation.ts';

const COMMAND_TYPE = 'OBSERVED_STAY_ATTACHED';
const Uuid = z.uuid();

const ApprovedCredentialSelectionInputSchema = z.strictObject({
  id: Uuid,
  credentialId: Uuid,
  credentialVersionId: Uuid,
  scopeIntendedVisitIds: z.array(Uuid).min(1),
});

const ApprovedVisitInputSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('PROPOSED'),
    visit: IntendedVisitSchema,
    credentialSelection: ApprovedCredentialSelectionInputSchema,
  }),
  z.strictObject({
    kind: z.literal('EXISTING'),
    visitId: Uuid,
    credentialSelection: ApprovedCredentialSelectionInputSchema,
  }),
]);

export type ApprovedVisitInput = z.infer<typeof ApprovedVisitInputSchema>;

export interface ObservedStayAttachmentParams {
  workspaceId: string;
  actorPrincipalId: string;
  idempotencyKey: string;
  journeyId: string;
  expectedJourneyRevision: number;
  travellerId: string;
  expectedConnectionRevision: number;
  provider: {
    connectionId: string;
    externalRecordId: string;
    externalId: string;
    recordType: string;
    observedAt: string;
    evidenceId: string;
    payloadHash: string;
  };
  journeyItem: {
    id?: string;
    intendedPlaceId: string;
    requiredNights: number;
    intendedWindow?: { start: string; end: string };
    orderKey: string;
  };
  booking: {
    reservationResponsibleOrganisationId?: string;
    lineId?: string;
    allocationId?: string;
    placeId: string;
    stayInterval: { start: string; end: string };
    status: 'CONFIRMED';
    occupancy?: Record<string, unknown>;
  };
  /** Explicit approved entry context for a stay. Omitted for legacy callers. */
  approvedVisit?: ApprovedVisitInput;
  /** Links a successful external attempt to this canonical receipt in the same transaction. */
  canonicalApplication?: {
    attemptId: string;
    actionPlanId: string;
    actionIntentId: string;
    source: { kind: 'EXTERNAL_PROVIDER'; observationId: string };
  };
  evidenceRefs?: string[];
}

export interface ObservedStayAttachmentValue {
  journeyItemId: string;
  reservationId: string;
  reservationLineId: string;
  allocationId: string;
  externalRecordId: string;
  journeyRevision: number;
  reservationRevision: number;
  connectionRevision: number;
}

function ref(kind: TypedRef['kind'], id: string): TypedRef {
  return { kind, id };
}

function deterministicUuid(seed: string): string {
  const hex = createHash('sha256').update(seed, 'utf8').digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

function actor(params: ObservedStayAttachmentParams): ActorContext {
  return { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId };
}

function reject(message: string, refs: TypedRef[] = []): ExecuteOutcome<never> {
  return { ok: false, conflict: typedConflict('VALIDATION_FAILED', `${COMMAND_TYPE}: ${message}`, refs) };
}

function databaseConflict(error: unknown, refs: TypedRef[]): TypedConflict {
  const code = (error as { code?: unknown }).code;
  const constraint = (error as { constraint?: unknown }).constraint;
  const message = error instanceof Error ? error.message : String(error);
  const suffix = typeof constraint === 'string' && constraint ? ` [constraint: ${constraint}]` : '';
  if (code === '23505') return typedConflict('DUPLICATE_REGISTRATION', `${message}${suffix}`, refs);
  if (code === '23503' || code === '23514' || code === '23502' || code === '23501' || code === '22P02' || code === 'P0001') {
    return typedConflict('VALIDATION_FAILED', `${message}${suffix}`, refs);
  }
  throw error;
}

function advance(
  workspaceId: string,
  aggregateRef: TypedRef,
  lockedHeads: { aggregateRef: TypedRef; revision: number }[],
): Promise<{ ok: true; value: AdvancedRoot } | { ok: false; conflict: TypedConflict }> {
  const before = lockedRevisionOf(lockedHeads, aggregateRef.id);
  if (before === undefined) return Promise.resolve({ ok: false, conflict: typedConflict('VALIDATION_FAILED', `missing aggregate head for ${aggregateRef.kind}:${aggregateRef.id}`, [aggregateRef]) });
  return advanceHead({ workspaceId, aggregateId: aggregateRef.id, fromRevision: before }).then((after) => {
    if (after === undefined) return { ok: false, conflict: typedConflict('STALE_AGGREGATE_REVISION', `aggregate ${aggregateRef.id} changed while attaching observed stay`, [aggregateRef]) };
    return { ok: true, value: { aggregateRef, beforeRevision: before, afterRevision: after } };
  });
}

export async function attachObservedStay(
  uow: UnitOfWork,
  params: ObservedStayAttachmentParams,
): Promise<ExecuteOutcome<ObservedStayAttachmentValue>> {
  const journeyRef = ref('JOURNEY', params.journeyId);
  const connectionRef = ref('EXTERNAL_CONNECTION', params.provider.connectionId);
  const reservationId = deterministicUuid(`${params.workspaceId}|${COMMAND_TYPE}|${params.idempotencyKey}|reservation`);
  const lineId = params.booking.lineId ?? deterministicUuid(`${params.workspaceId}|${COMMAND_TYPE}|${params.idempotencyKey}|line`);
  const allocationId = params.booking.allocationId ?? deterministicUuid(`${params.workspaceId}|${COMMAND_TYPE}|${params.idempotencyKey}|allocation`);
  const journeyItemId = params.journeyItem.id ?? deterministicUuid(`${params.workspaceId}|${COMMAND_TYPE}|${params.idempotencyKey}|journey-item`);
  const externalRecordId = params.provider.externalRecordId;
  const linkId = deterministicUuid(`${params.workspaceId}|${COMMAND_TYPE}|${params.idempotencyKey}|external-link`);
  const reservationRef = ref('RESERVATION', reservationId);
  const lineRef = ref('RESERVATION_LINE', lineId);
  const itemRef = ref('JOURNEY_ITEM', journeyItemId);
  const externalRecordRef = ref('EXTERNAL_RECORD', externalRecordId);
  const refs = [journeyRef, connectionRef, reservationRef, lineRef, itemRef, externalRecordRef];

  const expectedAggregateRevisions = [
    { aggregateRef: journeyRef, expectedRevision: params.expectedJourneyRevision },
    { aggregateRef: connectionRef, expectedRevision: params.expectedConnectionRevision },
  ];
  const inputIds = [
    params.journeyId, params.travellerId, params.provider.connectionId, params.provider.externalRecordId,
    params.provider.evidenceId, params.journeyItem.intendedPlaceId, params.booking.placeId,
    reservationId, lineId, allocationId, journeyItemId, externalRecordId, linkId,
    params.booking.reservationResponsibleOrganisationId,
  ].filter((id): id is string => id !== undefined);
  if (inputIds.some((id) => !Uuid.safeParse(id).success)) return reject('all domain references must be UUIDs', refs);
  if (params.canonicalApplication) {
    const bridgeIds = [
      params.canonicalApplication.attemptId,
      params.canonicalApplication.actionPlanId,
      params.canonicalApplication.actionIntentId,
      params.canonicalApplication.source.observationId,
    ];
    if (bridgeIds.some((id) => !Uuid.safeParse(id).success)) {
      return reject('canonicalApplication ids must be valid UUIDs when supplied', refs);
    }
  }
  const approvedVisitResult = params.approvedVisit === undefined
    ? undefined
    : ApprovedVisitInputSchema.safeParse(params.approvedVisit);
  if (approvedVisitResult && !approvedVisitResult.success) return reject('approved visit and credential selection are malformed', [journeyRef]);
  const approvedVisit = approvedVisitResult?.success ? approvedVisitResult.data : undefined;
  if (params.booking.status !== 'CONFIRMED') return reject('observed stay attachment requires CONFIRMED provider status', [lineRef]);
  if (!params.journeyItem.orderKey.trim()) return reject('approved Journey STAY intent requires a nonempty orderKey', [itemRef]);
  if (params.journeyItem.intendedPlaceId !== params.booking.placeId) return reject('Journey STAY place must match the observed booking place', [itemRef, lineRef]);
  if (!Number.isInteger(params.journeyItem.requiredNights) || params.journeyItem.requiredNights <= 0) return reject('requiredNights must be a positive integer', [itemRef]);
  if (!params.provider.recordType || !params.provider.externalId || !params.provider.payloadHash) return reject('provider record type, external id, and payload hash are required', [externalRecordRef]);
  const observedAt = InstantSchema.safeParse(params.provider.observedAt);
  const bookingInterval = InstantIntervalSchema.safeParse(params.booking.stayInterval);
  const intendedWindow = params.journeyItem.intendedWindow === undefined ? undefined : InstantIntervalSchema.safeParse(params.journeyItem.intendedWindow);
  if (!observedAt.success || !bookingInterval.success || (intendedWindow !== undefined && !intendedWindow.success)) return reject('provider observation and stay windows must be valid offset instants', [lineRef]);
  const evidenceRefs = [...new Set([params.provider.evidenceId, ...(params.evidenceRefs ?? [])])];
  if (evidenceRefs.some((id) => !Uuid.safeParse(id).success)) return reject('evidence references must be UUIDs', [lineRef]);

  const item = JourneyItemSchema.parse({
    id: journeyItemId,
    journeyId: params.journeyId,
    kind: 'STAY',
    intendedPlaceId: params.journeyItem.intendedPlaceId,
    requiredNights: params.journeyItem.requiredNights,
    lifecycleStatus: 'PLANNED',
    flexible: false,
    orderKey: params.journeyItem.orderKey,
    ...(params.journeyItem.intendedWindow ? { intendedWindow: params.journeyItem.intendedWindow } : {}),
  }) as JourneyItem;
  const line = ReservationLineSchema.parse({
    id: lineId,
    reservationId,
    productType: 'STAY',
    observedStatus: params.booking.status,
    observedStatusAt: params.provider.observedAt,
    observationEvidenceId: params.provider.evidenceId,
  }) as ReservationLine;
  const allocation = ReservationAllocationSchema.parse({
    id: allocationId,
    reservationId,
    reservationLineId: lineId,
    travellerId: params.travellerId,
    journeyItemId,
    allocationRole: 'PRIMARY',
    quantity: 1,
  }) as ReservationAllocation;
  const newReservation = ReservationSchema.parse({
    id: reservationId,
    revision: 1,
    reservationType: 'STAY',
    observedStatus: params.booking.status,
    observedStatusAt: params.provider.observedAt,
    responsibleTravellerId: params.travellerId,
    ...(params.booking.reservationResponsibleOrganisationId ? { responsibleOrganisationId: params.booking.reservationResponsibleOrganisationId } : {}),
  }) as Reservation;
  const link: ExternalRecordLinkRecord = {
    id: linkId,
    externalRecordId,
    canonicalSubject: reservationRef,
    linkKind: 'SYSTEM_OF_RECORD',
    evidenceId: params.provider.evidenceId,
    linkedAt: params.provider.observedAt,
  };
  const payload = {
    journeyId: params.journeyId,
    travellerId: params.travellerId,
    item,
    reservation: newReservation,
    line,
    allocation,
    provider: params.provider,
    link,
    bookingInterval: bookingInterval.data,
    ...(approvedVisit ? { approvedVisit } : {}),
  };
  const envelope: DomainCommandEnvelope = DomainCommandEnvelopeSchema.parse({
    commandType: COMMAND_TYPE,
    schemaVersion: '1',
    workspaceId: params.workspaceId,
    actorPrincipalId: params.actorPrincipalId,
    idempotencyKey: params.idempotencyKey,
    canonicalPayloadHash: canonicalPayloadHash(payload),
    expectedAggregateRevisions,
    typedPayload: payload,
    evidenceRefs,
  });
  const refsForError = refs;
  try {
    return await uow.execute(envelope, async ({ lockedHeads }) => {
      const journeys = new PgJourneyRepository();
      const arrangements = new PgArrangementRepositories();
      const journey = await journeys.load(params.workspaceId, params.journeyId);
      if (!journey) return { ok: false, conflict: typedConflict('VALIDATION_FAILED', `journey ${params.journeyId} does not exist`, [journeyRef]) };
      if (journey.travellerId !== params.travellerId) return { ok: false, conflict: typedConflict('VALIDATION_FAILED', 'observed stay traveller does not own the Journey', [journeyRef, ref('TRAVELLER', params.travellerId)]) };

      if (approvedVisit) {
        const geography = new PgGeographyRepository();
        const journeysVisits = await journeys.listIntendedVisits(params.workspaceId, params.journeyId);
        const visit = approvedVisit.kind === 'PROPOSED'
          ? approvedVisit.visit
          : journeysVisits.find((candidate) => candidate.id === approvedVisit.visitId);
        if (!visit) {
          return { ok: false, conflict: typedConflict('VALIDATION_FAILED', 'approved visit does not belong to the Journey', [journeyRef]) };
        }
        if (visit.journeyId !== params.journeyId) {
          return { ok: false, conflict: typedConflict('VALIDATION_FAILED', 'approved visit belongs to another Journey', [journeyRef, ref('JOURNEY', visit.journeyId)]) };
        }
        if (visit.transitIntent) {
          return { ok: false, conflict: typedConflict('VALIDATION_FAILED', 'approved visit must be a landside visit for an observed stay attachment', [journeyRef]) };
        }
        const visitStart = Date.parse(visit.intendedDates.start);
        const visitEnd = Date.parse(visit.intendedDates.end);
        const stayStart = Date.parse(bookingInterval.data.start);
        const stayEnd = Date.parse(bookingInterval.data.end);
        if (visitStart > stayStart || visitEnd < stayEnd) {
          return { ok: false, conflict: typedConflict('VALIDATION_FAILED', 'approved visit dates must cover the observed stay window', [journeyRef]) };
        }
        if (!await geography.loadJurisdiction(params.workspaceId, visit.jurisdictionId)) {
          return { ok: false, conflict: typedConflict('VALIDATION_FAILED', 'approved visit jurisdiction is not present in this workspace', [journeyRef, ref('JURISDICTION', visit.jurisdictionId)]) };
        }
        if (approvedVisit.kind === 'PROPOSED' && journeysVisits.some((candidate) => candidate.id === visit.id)) {
          return { ok: false, conflict: typedConflict('DUPLICATE_REGISTRATION', 'approved proposed visit already exists on the Journey', [journeyRef]) };
        }
        const approvedScopeIds = approvedVisit.credentialSelection.scopeIntendedVisitIds;
        if (new Set(approvedScopeIds).size !== approvedScopeIds.length) {
          return { ok: false, conflict: typedConflict('VALIDATION_FAILED', 'credential selection scope must not repeat an intended visit', [journeyRef]) };
        }
        const knownVisitIds = new Set([...journeysVisits.map((candidate) => candidate.id), visit.id]);
        if (!approvedScopeIds.includes(visit.id) || approvedScopeIds.some((id) => !knownVisitIds.has(id))) {
          return { ok: false, conflict: typedConflict('VALIDATION_FAILED', 'credential selection must cover the approved visit and only visits on this Journey', [journeyRef]) };
        }
        const owner = await journeys.credentialOwner(params.workspaceId, approvedVisit.credentialSelection.credentialId);
        if (!owner || owner.travellerId !== journey.travellerId) {
          return { ok: false, conflict: typedConflict('VALIDATION_FAILED', 'approved credential belongs to another traveller or is missing', [journeyRef, ref('TRAVELLER', journey.travellerId)]) };
        }
        const versionOwner = await journeys.credentialVersionOwner(params.workspaceId, approvedVisit.credentialSelection.credentialVersionId);
        if (versionOwner !== approvedVisit.credentialSelection.credentialId) {
          return { ok: false, conflict: typedConflict('VALIDATION_FAILED', 'approved credential edition does not belong to the selected credential', [journeyRef]) };
        }
        // One credential claim per Journey (uidx). Match stayVisitOverlay: re-selecting
        // for an overnight/proposed encounter must UNION onto any existing visit scope,
        // never replace and drop destination (or other) coverage already claimed.
        const existingSelections = await journeys.listCredentialSelections(params.workspaceId, params.journeyId);
        const existingForCredential = existingSelections.filter(
          (candidate) => candidate.credentialId === approvedVisit.credentialSelection.credentialId,
        );
        if (existingForCredential.length > 1) {
          return { ok: false, conflict: typedConflict('VALIDATION_FAILED', 'Journey has duplicate credential selections for the approved credential', [journeyRef]) };
        }
        const prior = existingForCredential[0];
        if (prior && prior.credentialVersionId !== approvedVisit.credentialSelection.credentialVersionId) {
          return { ok: false, conflict: typedConflict('VALIDATION_FAILED', 'approved credential edition cannot re-pin an existing Journey credential selection', [journeyRef]) };
        }
        const scopeIds = [...new Set([
          ...(prior?.scopeIntendedVisitIds ?? []),
          ...approvedScopeIds,
        ])].sort();
        if (approvedVisit.kind === 'PROPOSED') {
          await journeys.addIntendedVisit({ visit, actor: actor(params) });
        }
        const selection: CredentialSelection = CredentialSelectionSchema.parse({
          id: prior?.id ?? approvedVisit.credentialSelection.id,
          journeyId: params.journeyId,
          credentialId: approvedVisit.credentialSelection.credentialId,
          credentialVersionId: approvedVisit.credentialSelection.credentialVersionId,
          scopeIntendedVisitIds: scopeIds,
          selectedByCommandId: derivedCommandRef(envelope),
        });
        await journeys.selectCredential({
          selection,
          receipt: { commandNamespace: envelope.commandType, idempotencyKey: envelope.idempotencyKey },
          actor: actor(params),
        });
      }

      const observedRecord = await arrangements.external.loadRecord({ workspaceId: params.workspaceId, recordId: externalRecordId });
      if (!observedRecord
        || observedRecord.connectionId !== params.provider.connectionId
        || observedRecord.recordType !== params.provider.recordType
        || observedRecord.externalId !== params.provider.externalId
        || !observedRecord.observedAt
        || Date.parse(observedRecord.observedAt) !== Date.parse(params.provider.observedAt)
        || observedRecord.payloadHash !== params.provider.payloadHash) {
        return { ok: false, conflict: typedConflict('VALIDATION_FAILED', 'provider observation must be materialized with matching identity, time, and payload before attachment', [externalRecordRef, connectionRef]) };
      }
      const actualExternalRecordId = observedRecord.id;
      const liveLinks = await arrangements.external.findLiveCanonicalSubjects(params.workspaceId, actualExternalRecordId);
      if (liveLinks.length > 0) {
        const linkedToThisAttach = liveLinks.some(
          (link) => link.kind === 'RESERVATION' && link.id === reservationId,
        );
        if (linkedToThisAttach) {
          const existingItem = await journeys.loadItem(params.workspaceId, journeyItemId);
          if (!existingItem) {
            return {
              ok: false,
              conflict: typedConflict(
                'VALIDATION_FAILED',
                'provider booking is linked but the expected Journey item is missing',
                [externalRecordRef, itemRef],
              ),
            };
          }
          const journeyAdvanced = await advance(params.workspaceId, journeyRef, lockedHeads);
          if (!journeyAdvanced.ok) return journeyAdvanced;
          advanced.push(journeyAdvanced.value);
          const connectionAdvanced = await advance(params.workspaceId, connectionRef, lockedHeads);
          if (!connectionAdvanced.ok) return connectionAdvanced;
          advanced.push(connectionAdvanced.value);
          const value: ObservedStayAttachmentValue = {
            journeyItemId,
            reservationId,
            reservationLineId: lineId,
            allocationId,
            externalRecordId: actualExternalRecordId,
            journeyRevision: journeyAdvanced.value.afterRevision,
            reservationRevision: 1,
            connectionRevision: connectionAdvanced.value.afterRevision,
          };
          if (params.canonicalApplication) {
            const application = await recordSelectedPlanCanonicalApplication(currentTransactionClient(), {
              workspaceId: params.workspaceId,
              actorId: params.actorPrincipalId,
              attemptId: params.canonicalApplication.attemptId,
              actionPlanId: params.canonicalApplication.actionPlanId,
              actionIntentId: params.canonicalApplication.actionIntentId,
              commandNamespace: envelope.commandType,
              idempotencyKey: envelope.idempotencyKey,
              source: params.canonicalApplication.source,
            });
            if (!application.ok) {
              return {
                ok: false,
                conflict: typedConflict(
                  'VALIDATION_FAILED',
                  `selected-plan canonical application rejected: ${application.reason}`,
                  [journeyRef],
                ),
              };
            }
          }
          await appendAuditTrail({ envelope, advanced, destinationKind: COMMAND_TYPE, payload: value });
          return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced }) };
        }
        return { ok: false, conflict: typedConflict('DUPLICATE_REGISTRATION', 'provider booking is already linked to a canonical subject', [externalRecordRef]) };
      }

      const advanced: AdvancedRoot[] = [];
      await createRoot({ workspaceId: params.workspaceId, id: reservationId, kind: 'RESERVATION' });
      await arrangements.reservations.create({ reservation: newReservation, actor: actor(params) });
      advanced.push({ aggregateRef: reservationRef, beforeRevision: null, afterRevision: 1 });

      await registerChildSubject({ workspaceId: params.workspaceId, id: journeyItemId, kind: 'JOURNEY_ITEM', aggregateId: params.journeyId });
      await journeys.addItem({ journeyId: params.journeyId, item, actor: actor(params) });
      await registerChildSubject({ workspaceId: params.workspaceId, id: lineId, kind: 'RESERVATION_LINE', aggregateId: reservationId });
      await arrangements.reservations.addLine({ line, detail: { productType: 'STAY', stayInterval: bookingInterval.data, placeId: params.booking.placeId, occupancy: params.booking.occupancy }, actor: actor(params) });
      await arrangements.reservations.addAllocation({ allocation, actor: actor(params) });

      await arrangements.external.linkRecord({ link: { ...link, externalRecordId: actualExternalRecordId }, actor: actor(params) });

      const journeyAdvanced = await advance(params.workspaceId, journeyRef, lockedHeads);
      if (!journeyAdvanced.ok) return journeyAdvanced;
      advanced.push(journeyAdvanced.value);
      const connectionAdvanced = await advance(params.workspaceId, connectionRef, lockedHeads);
      if (!connectionAdvanced.ok) return connectionAdvanced;
      advanced.push(connectionAdvanced.value);
      const value: ObservedStayAttachmentValue = {
        journeyItemId,
        reservationId,
        reservationLineId: lineId,
        allocationId,
        externalRecordId: actualExternalRecordId,
        journeyRevision: journeyAdvanced.value.afterRevision,
        reservationRevision: 1,
        connectionRevision: connectionAdvanced.value.afterRevision,
      };
      if (params.canonicalApplication) {
        const application = await recordSelectedPlanCanonicalApplication(currentTransactionClient(), {
          workspaceId: params.workspaceId,
          actorId: params.actorPrincipalId,
          attemptId: params.canonicalApplication.attemptId,
          actionPlanId: params.canonicalApplication.actionPlanId,
          actionIntentId: params.canonicalApplication.actionIntentId,
          commandNamespace: envelope.commandType,
          idempotencyKey: envelope.idempotencyKey,
          source: params.canonicalApplication.source,
        });
        if (!application.ok) {
          return {
            ok: false,
            conflict: typedConflict(
              'VALIDATION_FAILED',
              `selected-plan canonical application rejected: ${application.reason}`,
              [journeyRef],
            ),
          };
        }
      }
      await appendAuditTrail({ envelope, advanced, destinationKind: COMMAND_TYPE, payload: value });
      return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced }) };
    });
  } catch (error) {
    return { ok: false, conflict: databaseConflict(error, refsForError) };
  }
}

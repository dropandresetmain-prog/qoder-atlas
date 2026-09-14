/**
 * M3 commands: the only application write boundary for services, reservations,
 * enterprise arrangements, external observations, offers, and exact money.
 *
 * Every UUID that will reach a PostgreSQL domain-id column is checked before
 * `UnitOfWork.execute`. IDs and the receipt timestamp are allocated before the
 * callback because PgUnitOfWork may replay that callback after a serializable
 * conflict. The callback contains only deterministic validation and typed-row
 * writes; provider/model calls do not belong here.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainCommandEnvelopeSchema, type DomainCommandEnvelope } from '../../../contracts/v2/command/domainCommand.ts';
import type { UnitOfWork } from '../../../contracts/v2/command/unitOfWork.ts';
import type {
  AccountingAssignmentRecord,
  AccountingDimensionRecord,
  ExternalConnectionRecord,
  ExternalRecordLinkRecord,
  ExternalRecordRecord,
  OwnershipBindingRecord,
  ProviderCapabilityRecord,
  ReservationLineDetail,
  ResourceDetail,
  TransportScheduleObservation,
} from '../../../contracts/v2/repository/arrangements.ts';
import type { ActorContext } from '../../../contracts/v2/repository/people.ts';
import type { ExpectedRevision, SubjectKind, TypedRef } from '../../../domain/v2/shared/identity.ts';
import { SubjectKindSchema, TypedRefSchema } from '../../../domain/v2/shared/identity.ts';
import {
  CommercialAgreementSchema,
  OfferSchema,
  ReservationAllocationSchema,
  ReservationLineSchema,
  ReservationSchema,
  ResourceSchema,
  ServiceEntitlementSchema,
  TransportServiceSchema,
  type CommercialAgreement,
  type Offer,
  type Reservation,
  type ReservationAllocation,
  type ReservationLine,
  type Resource,
  type ServiceEntitlement,
  type TransportService,
} from '../../../domain/v2/arrangements/reservation.ts';
import { BudgetCommitmentSchema } from '../../../domain/v2/arrangements/reservation.ts';
import { ExactMoneySchema, FxObservationSchema, type FxObservation } from '../../../domain/v2/shared/money.ts';
import { InstantSchema, InstantIntervalSchema } from '../../../domain/v2/shared/time.ts';
import { typedConflict, type TypedConflict, type TypedResult } from '../../../domain/v2/shared/errors.ts';
import { canonicalPayloadHash } from '../canonicalHash.ts';
import {
  advanceHead,
  appendAuditTrail,
  buildReceipt,
  createRoot,
  lockedRevisionOf,
  missingHeadConflict,
  registerChildSubject,
  staleRevisionConflict,
  type AdvancedRoot,
} from '../commandSupport.ts';
import type { ExecuteOutcome } from '../pgUnitOfWork.ts';
import { PgArrangementRepositories } from '../repositories/pgArrangementRepositories.ts';

const SCHEMA_VERSION = '1';
const Uuid = z.uuid();

export interface ArrangementCommandIdentity {
  workspaceId: string;
  actorPrincipalId: string;
  idempotencyKey: string;
}

interface SubmitSpec<R> {
  uow: UnitOfWork;
  identity: ArrangementCommandIdentity;
  commandType: string;
  destinationKind: string;
  payload: unknown;
  expectedAggregateRevisions?: ExpectedRevision[];
  evidenceRefs?: string[];
  refs: TypedRef[];
  body: (ctx: { envelope: DomainCommandEnvelope; lockedHeads: { aggregateRef: TypedRef; revision: number }[] }) => Promise<BodyResult<R>>;
}

type BodyResult<R> =
  | { ok: true; value: R; advanced: AdvancedRoot[] }
  | { ok: false; conflict: TypedConflict };

function ref(kind: SubjectKind, id: string): TypedRef {
  return { kind, id };
}

function reject(commandType: string, message: string, refs: TypedRef[] = []): ExecuteOutcome<never> {
  return { ok: false, conflict: typedConflict('VALIDATION_FAILED', `${commandType}: ${message}`, refs) };
}

function validateUuidIds(commandType: string, entries: Array<[string, string | undefined]>, refs: TypedRef[] = []): ExecuteOutcome<never> | undefined {
  const bad = entries.filter(([, id]) => id !== undefined && !Uuid.safeParse(id).success);
  if (bad.length === 0) return undefined;
  return reject(commandType, `PostgreSQL domain ids must be UUIDs: ${bad.map(([name, id]) => `${name}=${JSON.stringify(id)}`).join(', ')}`, refs);
}

function validateRefs(commandType: string, values: TypedRef[]): ExecuteOutcome<never> | undefined {
  const bad = values.filter((value) => !TypedRefSchema.safeParse(value).success || !Uuid.safeParse(value.id).success);
  return bad.length === 0 ? undefined : reject(commandType, 'typed references must contain UUID ids', bad);
}

function validateEvidence(commandType: string, evidenceRefs: string[] | undefined): ExecuteOutcome<never> | undefined {
  return validateUuidIds(commandType, (evidenceRefs ?? []).map((id, index) => [`evidenceRefs[${index}]`, id]));
}

function databaseConflict(error: unknown, refs: TypedRef[]): TypedConflict {
  const code = (error as { code?: unknown }).code;
  const constraint = (error as { constraint?: unknown }).constraint;
  const message = error instanceof Error ? error.message : String(error);
  const suffix = typeof constraint === 'string' && constraint.length > 0 ? ` [constraint: ${constraint}]` : '';
  if (code === '23505') return typedConflict('DUPLICATE_REGISTRATION', `${message}${suffix}`, refs);
  if (code === '23503' || code === '23514' || code === '23502' || code === '23501' || code === '22P02' || code === 'P0001') {
    return typedConflict('VALIDATION_FAILED', `${message}${suffix}`, refs);
  }
  throw error;
}

async function submit<R>(spec: SubmitSpec<R>): Promise<ExecuteOutcome<R>> {
  const envelope = DomainCommandEnvelopeSchema.parse({
    commandType: spec.commandType,
    schemaVersion: SCHEMA_VERSION,
    workspaceId: spec.identity.workspaceId,
    actorPrincipalId: spec.identity.actorPrincipalId,
    idempotencyKey: spec.identity.idempotencyKey,
    canonicalPayloadHash: canonicalPayloadHash(spec.payload),
    expectedAggregateRevisions: spec.expectedAggregateRevisions ?? [],
    typedPayload: spec.payload,
    evidenceRefs: spec.evidenceRefs ?? [],
  });
  const committedAt = new Date().toISOString();
  try {
    return await spec.uow.execute<R>(envelope, async ({ lockedHeads }) => {
      const outcome = await spec.body({ envelope, lockedHeads });
      if (!outcome.ok) return outcome;
      await appendAuditTrail({
        envelope,
        advanced: outcome.advanced,
        destinationKind: spec.destinationKind,
        payload: outcome.value,
      });
      return {
        ok: true,
        value: outcome.value,
        receipt: buildReceipt({ envelope, value: outcome.value, advanced: outcome.advanced, committedAt }),
      };
    });
  } catch (error) {
    return { ok: false, conflict: databaseConflict(error, spec.refs) };
  }
}

function actor(identity: ArrangementCommandIdentity): ActorContext {
  return { workspaceId: identity.workspaceId, actorPrincipalId: identity.actorPrincipalId };
}

async function advance(
  workspaceId: string,
  aggregateRef: TypedRef,
  lockedHeads: { aggregateRef: TypedRef; revision: number }[],
): Promise<TypedResult<AdvancedRoot>> {
  const beforeRevision = lockedRevisionOf(lockedHeads, aggregateRef.id);
  if (beforeRevision === undefined) return { ok: false, conflict: missingHeadConflict(aggregateRef) };
  const afterRevision = await advanceHead({ workspaceId, aggregateId: aggregateRef.id, fromRevision: beforeRevision });
  if (afterRevision === undefined) return { ok: false, conflict: staleRevisionConflict(aggregateRef, beforeRevision) };
  return { ok: true, value: { aggregateRef, beforeRevision, afterRevision } };
}

function rootCreated(aggregateRef: TypedRef): AdvancedRoot {
  return { aggregateRef, beforeRevision: null, afterRevision: 1 };
}

function parsed<T>(commandType: string, result: { success: true; data: T } | { success: false; error: { message: string } }): T | ExecuteOutcome<never> {
  return result.success ? result.data : reject(commandType, result.error.message);
}

function isOutcome(value: unknown): value is ExecuteOutcome<never> {
  return typeof value === 'object' && value !== null && 'ok' in value && (value as { ok?: unknown }).ok === false;
}

function rootExpected(kind: SubjectKind, id: string, expectedRevision: number): ExpectedRevision[] {
  return [{ aggregateRef: ref(kind, id), expectedRevision }];
}

// ---------------------------------------------------------------------------
// Services and resources
// ---------------------------------------------------------------------------

export type TransportServiceInput = Omit<TransportService, 'id' | 'revision'> & { id?: string; revision?: number };

export interface CreateTransportServiceParams extends ArrangementCommandIdentity {
  service: TransportServiceInput;
  evidenceRefs?: string[];
}

export interface ArrangementCreatedValue {
  id: string;
  revision: number;
}

export async function createTransportService(uow: UnitOfWork, params: CreateTransportServiceParams): Promise<ExecuteOutcome<ArrangementCreatedValue>> {
  const id = params.service.id ?? randomUUID();
  const serviceRef = ref('TRANSPORT_SERVICE', id);
  const bad = validateUuidIds('TRANSPORT_SERVICE_CREATED', [
    ['service.id', id],
    ['originPlaceId', params.service.originPlaceId],
    ['destinationPlaceId', params.service.destinationPlaceId],
    ['publishedDeparture.sourceId', params.service.publishedDeparture?.sourceId],
    ['publishedArrival.sourceId', params.service.publishedArrival?.sourceId],
    ['estimatedDeparture.sourceId', params.service.estimatedDeparture?.sourceId],
    ['estimatedArrival.sourceId', params.service.estimatedArrival?.sourceId],
    ['actualDeparture.sourceId', params.service.actualDeparture?.sourceId],
    ['actualArrival.sourceId', params.service.actualArrival?.sourceId],
  ], [serviceRef]);
  if (bad) return bad;
  const evidenceBad = validateEvidence('TRANSPORT_SERVICE_CREATED', params.evidenceRefs);
  if (evidenceBad) return evidenceBad;
  const serviceValue = parsed('TRANSPORT_SERVICE_CREATED', TransportServiceSchema.safeParse({ ...params.service, id, revision: 1 }));
  if (isOutcome(serviceValue)) return serviceValue;
  const service = serviceValue;
  return submit({
    uow,
    identity: params,
    commandType: 'TRANSPORT_SERVICE_CREATED',
    destinationKind: 'TRANSPORT_SERVICE',
    payload: service,
    evidenceRefs: params.evidenceRefs,
    refs: [serviceRef],
    body: async () => {
      await createRoot({ workspaceId: params.workspaceId, id, kind: 'TRANSPORT_SERVICE' });
      await new PgArrangementRepositories().transportServices.create({ service, actor: actor(params) });
      return { ok: true, value: { id, revision: 1 }, advanced: [rootCreated(serviceRef)] };
    },
  });
}

export interface RecordTransportObservationParams extends ArrangementCommandIdentity {
  serviceId: string;
  expectedRevision: number;
  observation: TransportScheduleObservation;
  evidenceRefs?: string[];
}

export async function recordTransportObservation(uow: UnitOfWork, params: RecordTransportObservationParams): Promise<ExecuteOutcome<{ id: string; status: 'APPLIED' | 'STALE'; revision: number }>> {
  const serviceRef = ref('TRANSPORT_SERVICE', params.serviceId);
  const bad = validateUuidIds('TRANSPORT_SERVICE_OBSERVED', [['serviceId', params.serviceId], ['evidenceId', params.observation.evidenceId]], [serviceRef]);
  if (bad) return bad;
  const evidenceBad = validateEvidence('TRANSPORT_SERVICE_OBSERVED', params.evidenceRefs);
  if (evidenceBad) return evidenceBad;
  const parsedObservation = parsed('TRANSPORT_SERVICE_OBSERVED', z.strictObject({
    field: z.enum(['PUBLISHED', 'ESTIMATED', 'ACTUAL']),
    departure: InstantSchema.optional(),
    arrival: InstantSchema.optional(),
    observedAt: InstantSchema,
    evidenceId: Uuid,
  }).refine((value) => value.departure !== undefined || value.arrival !== undefined, 'departure or arrival is required').safeParse(params.observation));
  if (isOutcome(parsedObservation)) return parsedObservation;
  return submit({
    uow,
    identity: params,
    commandType: 'TRANSPORT_SERVICE_OBSERVED',
    destinationKind: 'TRANSPORT_SERVICE',
    payload: { serviceId: params.serviceId, observation: parsedObservation },
    expectedAggregateRevisions: rootExpected('TRANSPORT_SERVICE', params.serviceId, params.expectedRevision),
    evidenceRefs: params.evidenceRefs,
    refs: [serviceRef],
    body: async ({ lockedHeads }) => {
      const status = await new PgArrangementRepositories().transportServices.recordObservation({
        workspaceId: params.workspaceId,
        serviceId: params.serviceId,
        observation: parsedObservation,
        actor: actor(params),
      });
      if (status === 'STALE') return { ok: true, value: { id: params.serviceId, status: status as 'APPLIED' | 'STALE', revision: params.expectedRevision }, advanced: [] };
      const advanced = await advance(params.workspaceId, serviceRef, lockedHeads);
      if (!advanced.ok) return advanced;
      return { ok: true, value: { id: params.serviceId, status: status as 'APPLIED' | 'STALE', revision: advanced.value.afterRevision }, advanced: [advanced.value] };
    },
  });
}

export interface CreateResourceParams extends ArrangementCommandIdentity {
  resource: Omit<Resource, 'id'> & { id?: string };
  detail: ResourceDetail;
  evidenceRefs?: string[];
}

export async function createResource(uow: UnitOfWork, params: CreateResourceParams): Promise<ExecuteOutcome<ArrangementCreatedValue>> {
  const id = params.resource.id ?? randomUUID();
  const resourceRef = ref('RESOURCE', id);
  const bad = validateUuidIds('RESOURCE_CREATED', [['resource.id', id], ['placeId', params.resource.placeId]], [resourceRef]);
  if (bad) return bad;
  const evidenceBad = validateEvidence('RESOURCE_CREATED', params.evidenceRefs);
  if (evidenceBad) return evidenceBad;
  const resourceValue = parsed('RESOURCE_CREATED', ResourceSchema.safeParse({ ...params.resource, id }));
  if (isOutcome(resourceValue)) return resourceValue;
  if (resourceValue.resourceType !== params.detail.resourceType) return reject('RESOURCE_CREATED', 'resource and typed detail kinds differ', [resourceRef]);
  return submit({
    uow,
    identity: params,
    commandType: 'RESOURCE_CREATED',
    destinationKind: 'RESOURCE',
    payload: { resource: resourceValue, detail: params.detail },
    evidenceRefs: params.evidenceRefs,
    refs: [resourceRef],
    body: async () => {
      await createRoot({ workspaceId: params.workspaceId, id, kind: 'RESOURCE' });
      await new PgArrangementRepositories().resources.create({ resource: resourceValue, detail: params.detail, actor: actor(params) });
      return { ok: true, value: { id, revision: 1 }, advanced: [rootCreated(resourceRef)] };
    },
  });
}

// ---------------------------------------------------------------------------
// Reservations, lines, and explicit allocations
// ---------------------------------------------------------------------------

export interface CreateReservationParams extends ArrangementCommandIdentity {
  reservation: Omit<Reservation, 'id' | 'revision'> & { id?: string; revision?: number };
  evidenceRefs?: string[];
}

export async function createReservation(uow: UnitOfWork, params: CreateReservationParams): Promise<ExecuteOutcome<ArrangementCreatedValue>> {
  const id = params.reservation.id ?? randomUUID();
  const reservationRef = ref('RESERVATION', id);
  const bad = validateUuidIds('RESERVATION_CREATED', [
    ['reservation.id', id],
    ['responsibleOrganisationId', params.reservation.responsibleOrganisationId],
    ['responsibleTravellerId', params.reservation.responsibleTravellerId],
  ], [reservationRef]);
  if (bad) return bad;
  if (!params.reservation.responsibleOrganisationId && !params.reservation.responsibleTravellerId) return reject('RESERVATION_CREATED', 'a reservation must name a responsible organisation or traveller', [reservationRef]);
  const evidenceBad = validateEvidence('RESERVATION_CREATED', params.evidenceRefs);
  if (evidenceBad) return evidenceBad;
  const reservationValue = parsed('RESERVATION_CREATED', ReservationSchema.safeParse({ ...params.reservation, id, revision: 1 }));
  if (isOutcome(reservationValue)) return reservationValue;
  if (reservationValue.observedStatus && reservationValue.observedStatus !== 'UNKNOWN' && !reservationValue.observedStatusAt) return reject('RESERVATION_CREATED', 'known reservation status requires observation time', [reservationRef]);
  return submit({
    uow,
    identity: params,
    commandType: 'RESERVATION_CREATED',
    destinationKind: 'RESERVATION',
    payload: reservationValue,
    evidenceRefs: params.evidenceRefs,
    refs: [reservationRef],
    body: async () => {
      await createRoot({ workspaceId: params.workspaceId, id, kind: 'RESERVATION' });
      await new PgArrangementRepositories().reservations.create({ reservation: reservationValue, actor: actor(params) });
      return { ok: true, value: { id, revision: 1 }, advanced: [rootCreated(reservationRef)] };
    },
  });
}

export interface AddReservationLineParams extends ArrangementCommandIdentity {
  reservationId: string;
  expectedRevision: number;
  line: Omit<ReservationLine, 'id' | 'reservationId'> & { id?: string };
  detail: ReservationLineDetail;
  evidenceRefs?: string[];
}

export async function addReservationLine(uow: UnitOfWork, params: AddReservationLineParams): Promise<ExecuteOutcome<{ lineId: string; reservationId: string; reservationRevision: number }>> {
  const id = params.line.id ?? randomUUID();
  const reservationRef = ref('RESERVATION', params.reservationId);
  const lineRef = ref('RESERVATION_LINE', id);
  const ids: Array<[string, string | undefined]> = [
    ['reservationId', params.reservationId], ['line.id', id],
    ['transportServiceId', params.detail.productType === 'TRANSPORT' ? params.detail.transportServiceId : undefined],
    ['resourceId', params.detail.productType !== 'TRANSPORT' ? params.detail.resourceId : undefined],
    ['placeId', params.detail.productType === 'STAY' || params.detail.productType === 'RESOURCE_USE' ? params.detail.placeId : undefined],
    ['observationEvidenceId', params.line.observationEvidenceId],
  ];
  const bad = validateUuidIds('RESERVATION_LINE_ADDED', ids, [reservationRef, lineRef]);
  if (bad) return bad;
  const evidenceBad = validateEvidence('RESERVATION_LINE_ADDED', params.evidenceRefs);
  if (evidenceBad) return evidenceBad;
  const lineValue = parsed('RESERVATION_LINE_ADDED', ReservationLineSchema.safeParse({ ...params.line, id, reservationId: params.reservationId }));
  if (isOutcome(lineValue)) return lineValue;
  if (lineValue.productType !== params.detail.productType) return reject('RESERVATION_LINE_ADDED', 'line and typed detail kinds differ', [lineRef]);
  if (lineValue.observedStatus !== 'UNKNOWN' && !lineValue.observationEvidenceId) return reject('RESERVATION_LINE_ADDED', 'known reservation line status requires observation evidence', [lineRef]);
  return submit({
    uow,
    identity: params,
    commandType: 'RESERVATION_LINE_ADDED',
    destinationKind: 'RESERVATION',
    payload: { reservationId: params.reservationId, line: lineValue, detail: params.detail },
    expectedAggregateRevisions: rootExpected('RESERVATION', params.reservationId, params.expectedRevision),
    evidenceRefs: params.evidenceRefs,
    refs: [reservationRef, lineRef],
    body: async ({ lockedHeads }) => {
      await registerChildSubject({ workspaceId: params.workspaceId, id, kind: 'RESERVATION_LINE', aggregateId: params.reservationId });
      await new PgArrangementRepositories().reservations.addLine({ line: lineValue, detail: params.detail, actor: actor(params) });
      const advanced = await advance(params.workspaceId, reservationRef, lockedHeads);
      if (!advanced.ok) return advanced;
      return { ok: true, value: { lineId: id, reservationId: params.reservationId, reservationRevision: advanced.value.afterRevision }, advanced: [advanced.value] };
    },
  });
}

export interface RecordReservationLineObservationParams extends ArrangementCommandIdentity {
  reservationId: string;
  lineId: string;
  expectedRevision: number;
  observation: { observedStatus: ReservationLine['observedStatus']; observedStatusAt?: string; observationEvidenceId?: string; observedTerms?: Record<string, unknown> };
  evidenceRefs?: string[];
}

export async function recordReservationLineObservation(uow: UnitOfWork, params: RecordReservationLineObservationParams): Promise<ExecuteOutcome<{ lineId: string; status: 'APPLIED' | 'STALE'; reservationRevision: number }>> {
  const reservationRef = ref('RESERVATION', params.reservationId);
  const lineRef = ref('RESERVATION_LINE', params.lineId);
  const bad = validateUuidIds('RESERVATION_LINE_OBSERVED', [['reservationId', params.reservationId], ['lineId', params.lineId], ['observationEvidenceId', params.observation.observationEvidenceId]], [reservationRef, lineRef]);
  if (bad) return bad;
  const evidenceBad = validateEvidence('RESERVATION_LINE_OBSERVED', params.evidenceRefs);
  if (evidenceBad) return evidenceBad;
  const observationValue = parsed('RESERVATION_LINE_OBSERVED', z.strictObject({
    observedStatus: z.enum(['HELD', 'CONFIRMED', 'CANCELLED', 'FULFILLED', 'UNKNOWN']),
    observedStatusAt: InstantSchema.optional(),
    observationEvidenceId: Uuid.optional(),
    observedTerms: z.record(z.string(), z.unknown()).optional(),
  }).refine((value) => value.observedStatus === 'UNKNOWN' ? value.observedStatusAt === undefined && value.observationEvidenceId === undefined : value.observedStatusAt !== undefined && value.observationEvidenceId !== undefined, 'status observation requires paired time/evidence; UNKNOWN has neither').safeParse(params.observation));
  if (isOutcome(observationValue)) return observationValue;
  return submit({
    uow,
    identity: params,
    commandType: 'RESERVATION_LINE_OBSERVED',
    destinationKind: 'RESERVATION',
    payload: { reservationId: params.reservationId, lineId: params.lineId, observation: observationValue },
    expectedAggregateRevisions: rootExpected('RESERVATION', params.reservationId, params.expectedRevision),
    evidenceRefs: params.evidenceRefs,
    refs: [reservationRef, lineRef],
    body: async ({ lockedHeads }) => {
      const status = await new PgArrangementRepositories().reservations.recordLineObservation({ workspaceId: params.workspaceId, lineId: params.lineId, observation: observationValue, actor: actor(params) });
      if (status === 'STALE') return { ok: true, value: { lineId: params.lineId, status: status as 'APPLIED' | 'STALE', reservationRevision: params.expectedRevision }, advanced: [] };
      const advanced = await advance(params.workspaceId, reservationRef, lockedHeads);
      if (!advanced.ok) return advanced;
      return { ok: true, value: { lineId: params.lineId, status: status as 'APPLIED' | 'STALE', reservationRevision: advanced.value.afterRevision }, advanced: [advanced.value] };
    },
  });
}

export interface AllocateReservationLineParams extends ArrangementCommandIdentity {
  reservationId: string;
  expectedRevision: number;
  allocation: Omit<ReservationAllocation, 'id' | 'reservationId'> & { id?: string };
  evidenceRefs?: string[];
}

export async function allocateReservationLine(uow: UnitOfWork, params: AllocateReservationLineParams): Promise<ExecuteOutcome<{ allocationId: string; reservationRevision: number }>> {
  const id = params.allocation.id ?? randomUUID();
  const reservationRef = ref('RESERVATION', params.reservationId);
  const allocationRef = ref('RESERVATION_LINE', params.allocation.reservationLineId);
  const bad = validateUuidIds('RESERVATION_ALLOCATED', [
    ['reservationId', params.reservationId], ['allocation.id', id], ['reservationLineId', params.allocation.reservationLineId],
    ['travellerId', params.allocation.travellerId], ['journeyItemId', params.allocation.journeyItemId],
  ], [reservationRef, allocationRef]);
  if (bad) return bad;
  const evidenceBad = validateEvidence('RESERVATION_ALLOCATED', params.evidenceRefs);
  if (evidenceBad) return evidenceBad;
  const allocationValue = parsed('RESERVATION_ALLOCATED', ReservationAllocationSchema.safeParse({ ...params.allocation, id, reservationId: params.reservationId }));
  if (isOutcome(allocationValue)) return allocationValue;
  return submit({
    uow,
    identity: params,
    commandType: 'RESERVATION_ALLOCATED',
    destinationKind: 'RESERVATION',
    payload: allocationValue,
    expectedAggregateRevisions: rootExpected('RESERVATION', params.reservationId, params.expectedRevision),
    evidenceRefs: params.evidenceRefs,
    refs: [reservationRef, allocationRef],
    body: async ({ lockedHeads }) => {
      if (allocationValue.journeyItemId) {
        const owner = await new PgArrangementRepositories().reservations.journeyItemTraveller(params.workspaceId, allocationValue.journeyItemId);
        if (owner !== allocationValue.travellerId) return { ok: false, conflict: typedConflict('VALIDATION_FAILED', 'allocation JourneyItem belongs to a different Traveller', [allocationRef, ref('TRAVELLER', allocationValue.travellerId)]) };
      }
      await new PgArrangementRepositories().reservations.addAllocation({ allocation: allocationValue, actor: actor(params) });
      const advanced = await advance(params.workspaceId, reservationRef, lockedHeads);
      if (!advanced.ok) return advanced;
      return { ok: true, value: { allocationId: id, reservationRevision: advanced.value.afterRevision }, advanced: [advanced.value] };
    },
  });
}

export const allocateReservation = allocateReservationLine;

// ---------------------------------------------------------------------------
// Entitlements
// ---------------------------------------------------------------------------

export interface CreateEntitlementParams extends ArrangementCommandIdentity {
  entitlement: Omit<ServiceEntitlement, 'id'> & { id?: string };
  evidenceRefs?: string[];
}

export async function createServiceEntitlement(uow: UnitOfWork, params: CreateEntitlementParams): Promise<ExecuteOutcome<ArrangementCreatedValue>> {
  const id = params.entitlement.id ?? randomUUID();
  const entitlementRef = ref('SERVICE_ENTITLEMENT', id);
  const bad = validateUuidIds('SERVICE_ENTITLEMENT_CREATED', [['entitlement.id', id], ['issuerOrganisationId', params.entitlement.issuerOrganisationId], ['exchangedFromEntitlementId', params.entitlement.exchangedFromEntitlementId], ['evidenceId', params.entitlement.evidenceId]], [entitlementRef]);
  if (bad) return bad;
  const evidenceBad = validateEvidence('SERVICE_ENTITLEMENT_CREATED', params.evidenceRefs);
  if (evidenceBad) return evidenceBad;
  const entitlementValue = parsed('SERVICE_ENTITLEMENT_CREATED', ServiceEntitlementSchema.safeParse({ ...params.entitlement, id }));
  if (isOutcome(entitlementValue)) return entitlementValue;
  if (entitlementValue.observedStatus !== 'UNKNOWN' && (!entitlementValue.observedStatusAt || !entitlementValue.evidenceId)) return reject('SERVICE_ENTITLEMENT_CREATED', 'positive entitlement status requires time and issuer evidence', [entitlementRef]);
  return submit({
    uow,
    identity: params,
    commandType: 'SERVICE_ENTITLEMENT_CREATED',
    destinationKind: 'SERVICE_ENTITLEMENT',
    payload: entitlementValue,
    evidenceRefs: params.evidenceRefs,
    refs: [entitlementRef],
    body: async () => {
      await createRoot({ workspaceId: params.workspaceId, id, kind: 'SERVICE_ENTITLEMENT' });
      await new PgArrangementRepositories().entitlements.create({ entitlement: entitlementValue, actor: actor(params) });
      return { ok: true, value: { id, revision: 1 }, advanced: [rootCreated(entitlementRef)] };
    },
  });
}

export const createEntitlement = createServiceEntitlement;

export interface EntitlementLinkParams extends ArrangementCommandIdentity {
  entitlementId: string;
  expectedRevision: number;
  lineId?: string;
  travellerId?: string;
  componentId?: string;
  evidenceRefs?: string[];
}

export async function linkEntitlementLine(uow: UnitOfWork, params: EntitlementLinkParams): Promise<ExecuteOutcome<{ entitlementId: string; revision: number }>> {
  if (!params.lineId) return reject('ENTITLEMENT_LINE_LINKED', 'lineId is required');
  return linkEntitlement(uow, params, 'ENTITLEMENT_LINE_LINKED', async (repos, a) => repos.entitlements.linkLine({ entitlementId: a.entitlementId, lineId: a.lineId!, componentId: a.componentId, actor: actor(a) }));
}

export async function linkEntitlementTraveller(uow: UnitOfWork, params: EntitlementLinkParams): Promise<ExecuteOutcome<{ entitlementId: string; revision: number }>> {
  if (!params.travellerId) return reject('ENTITLEMENT_TRAVELLER_LINKED', 'travellerId is required');
  return linkEntitlement(uow, params, 'ENTITLEMENT_TRAVELLER_LINKED', async (repos, a) => repos.entitlements.linkTraveller({ entitlementId: a.entitlementId, travellerId: a.travellerId!, actor: actor(a) }));
}

async function linkEntitlement(
  uow: UnitOfWork,
  params: EntitlementLinkParams,
  commandType: string,
  write: (repos: PgArrangementRepositories, params: EntitlementLinkParams) => Promise<void>,
): Promise<ExecuteOutcome<{ entitlementId: string; revision: number }>> {
  const entitlementRef = ref('SERVICE_ENTITLEMENT', params.entitlementId);
  const bad = validateUuidIds(commandType, [['entitlementId', params.entitlementId], ['lineId', params.lineId], ['travellerId', params.travellerId], ['componentId', params.componentId]], [entitlementRef]);
  if (bad) return bad;
  const evidenceBad = validateEvidence(commandType, params.evidenceRefs);
  if (evidenceBad) return evidenceBad;
  return submit({
    uow, identity: params, commandType, destinationKind: 'SERVICE_ENTITLEMENT',
    payload: { entitlementId: params.entitlementId, lineId: params.lineId, travellerId: params.travellerId, componentId: params.componentId },
    expectedAggregateRevisions: rootExpected('SERVICE_ENTITLEMENT', params.entitlementId, params.expectedRevision),
    evidenceRefs: params.evidenceRefs, refs: [entitlementRef],
    body: async ({ lockedHeads }) => {
      const repos = new PgArrangementRepositories();
      await write(repos, params);
      const advanced = await advance(params.workspaceId, entitlementRef, lockedHeads);
      if (!advanced.ok) return advanced;
      return { ok: true, value: { entitlementId: params.entitlementId, revision: advanced.value.afterRevision }, advanced: [advanced.value] };
    },
  });
}

export interface AddEntitlementComponentParams extends ArrangementCommandIdentity {
  entitlementId: string;
  expectedRevision: number;
  id?: string;
  componentType: string;
  componentStatus: 'ISSUED' | 'ACTIVE' | 'USED' | 'EXCHANGED' | 'VOID' | 'REVOKED' | 'UNKNOWN';
  exchangedFromComponentId?: string;
  evidenceRefs?: string[];
}

export async function addEntitlementComponent(uow: UnitOfWork, params: AddEntitlementComponentParams): Promise<ExecuteOutcome<{ componentId: string; entitlementRevision: number }>> {
  const id = params.id ?? randomUUID();
  const entitlementRef = ref('SERVICE_ENTITLEMENT', params.entitlementId);
  const bad = validateUuidIds('ENTITLEMENT_COMPONENT_ADDED', [['entitlementId', params.entitlementId], ['componentId', id], ['exchangedFromComponentId', params.exchangedFromComponentId]], [entitlementRef]);
  if (bad) return bad;
  if (params.componentStatus !== 'UNKNOWN' && !params.evidenceRefs?.length) return reject('ENTITLEMENT_COMPONENT_ADDED', 'positive component status needs an evidence reference', [entitlementRef]);
  const evidenceBad = validateEvidence('ENTITLEMENT_COMPONENT_ADDED', params.evidenceRefs);
  if (evidenceBad) return evidenceBad;
  return submit({
    uow, identity: params, commandType: 'ENTITLEMENT_COMPONENT_ADDED', destinationKind: 'SERVICE_ENTITLEMENT',
    payload: { id, entitlementId: params.entitlementId, componentType: params.componentType, componentStatus: params.componentStatus, exchangedFromComponentId: params.exchangedFromComponentId },
    expectedAggregateRevisions: rootExpected('SERVICE_ENTITLEMENT', params.entitlementId, params.expectedRevision), evidenceRefs: params.evidenceRefs, refs: [entitlementRef],
    body: async ({ lockedHeads }) => {
      const repos = new PgArrangementRepositories();
      await repos.entitlements.addComponent({ id, entitlementId: params.entitlementId, componentType: params.componentType, componentStatus: params.componentStatus, exchangedFromComponentId: params.exchangedFromComponentId, actor: actor(params) });
      const advanced = await advance(params.workspaceId, entitlementRef, lockedHeads);
      if (!advanced.ok) return advanced;
      return { ok: true, value: { componentId: id, entitlementRevision: advanced.value.afterRevision }, advanced: [advanced.value] };
    },
  });
}

// ---------------------------------------------------------------------------
// Immutable offers and agreement scopes
// ---------------------------------------------------------------------------

export interface CreateOfferParams extends ArrangementCommandIdentity {
  offer: Omit<Offer, 'id'> & { id?: string };
  evidenceRefs?: string[];
}

export async function createOffer(uow: UnitOfWork, params: CreateOfferParams): Promise<ExecuteOutcome<ArrangementCreatedValue>> {
  const id = params.offer.id ?? randomUUID();
  const offerRef = ref('OFFER', id);
  const bad = validateUuidIds('OFFER_CREATED', [['offer.id', id], ['accountId', params.offer.accountId], ['sourceId', params.offer.sourceId], ['eligiblePartyRef', params.offer.eligiblePartyRef]], [offerRef]);
  if (bad) return bad;
  const evidenceBad = validateEvidence('OFFER_CREATED', params.evidenceRefs);
  if (evidenceBad) return evidenceBad;
  if (params.offer.eligiblePartyRef && !params.offer.eligiblePartyKind) return reject('OFFER_CREATED', 'eligiblePartyKind is required; identity prefixes are never inferred', [offerRef]);
  const offerValue = parsed('OFFER_CREATED', OfferSchema.safeParse({ ...params.offer, id }));
  if (isOutcome(offerValue)) return offerValue;
  return submit({
    uow, identity: params, commandType: 'OFFER_CREATED', destinationKind: 'OFFER', payload: offerValue,
    evidenceRefs: params.evidenceRefs, refs: [offerRef],
    body: async () => {
      await createRoot({ workspaceId: params.workspaceId, id, kind: 'OFFER' });
      await new PgArrangementRepositories().offers.create({ offer: offerValue, actor: actor(params) });
      return { ok: true, value: { id, revision: 1 }, advanced: [rootCreated(offerRef)] };
    },
  });
}

export interface OfferItemParams extends ArrangementCommandIdentity {
  offerId: string;
  expectedRevision: number;
  id?: string;
  detail: ReservationLineDetail;
  amount: z.input<typeof ExactMoneySchema>;
  evidenceRefs?: string[];
}

export async function addOfferItem(uow: UnitOfWork, params: OfferItemParams): Promise<ExecuteOutcome<{ itemId: string; offerRevision: number }>> {
  const id = params.id ?? randomUUID();
  const offerRef = ref('OFFER', params.offerId);
  const bad = validateUuidIds('OFFER_ITEM_ADDED', [['offerId', params.offerId], ['itemId', id], ['transportServiceId', params.detail.productType === 'TRANSPORT' ? params.detail.transportServiceId : undefined], ['resourceId', params.detail.productType !== 'TRANSPORT' ? params.detail.resourceId : undefined]], [offerRef]);
  if (bad) return bad;
  const evidenceBad = validateEvidence('OFFER_ITEM_ADDED', params.evidenceRefs);
  if (evidenceBad) return evidenceBad;
  const amount = parsed('OFFER_ITEM_ADDED', ExactMoneySchema.safeParse(params.amount));
  if (isOutcome(amount)) return amount;
  return submit({
    uow, identity: params, commandType: 'OFFER_ITEM_ADDED', destinationKind: 'OFFER', payload: { id, offerId: params.offerId, detail: params.detail, amount },
    expectedAggregateRevisions: rootExpected('OFFER', params.offerId, params.expectedRevision), evidenceRefs: params.evidenceRefs, refs: [offerRef],
    body: async ({ lockedHeads }) => {
      const repos = new PgArrangementRepositories();
      await repos.offers.addItem({ id, offerId: params.offerId, detail: params.detail, amount, actor: actor(params) });
      const advanced = await advance(params.workspaceId, offerRef, lockedHeads);
      if (!advanced.ok) return advanced;
      return { ok: true, value: { itemId: id, offerRevision: advanced.value.afterRevision }, advanced: [advanced.value] };
    },
  });
}

export interface OfferEligibilityParams extends ArrangementCommandIdentity {
  offerId: string;
  expectedRevision: number;
  id?: string;
  travellerId?: string;
  organisationId?: string;
  agreementScopeId?: string;
  evidenceRefs?: string[];
}

export async function addOfferEligibility(uow: UnitOfWork, params: OfferEligibilityParams): Promise<ExecuteOutcome<{ eligibilityId: string; offerRevision: number }>> {
  const id = params.id ?? randomUUID();
  const offerRef = ref('OFFER', params.offerId);
  const selected = [params.travellerId, params.organisationId, params.agreementScopeId].filter((value) => value !== undefined);
  const bad = validateUuidIds('OFFER_ELIGIBILITY_ADDED', [['offerId', params.offerId], ['eligibilityId', id], ['travellerId', params.travellerId], ['organisationId', params.organisationId], ['agreementScopeId', params.agreementScopeId]], [offerRef]);
  if (bad) return bad;
  if (selected.length !== 1) return reject('OFFER_ELIGIBILITY_ADDED', 'exactly one Traveller, Organisation, or AgreementScope eligibility target is required', [offerRef]);
  const evidenceBad = validateEvidence('OFFER_ELIGIBILITY_ADDED', params.evidenceRefs);
  if (evidenceBad) return evidenceBad;
  return submit({
    uow, identity: params, commandType: 'OFFER_ELIGIBILITY_ADDED', destinationKind: 'OFFER', payload: { id, offerId: params.offerId, travellerId: params.travellerId, organisationId: params.organisationId, agreementScopeId: params.agreementScopeId },
    expectedAggregateRevisions: rootExpected('OFFER', params.offerId, params.expectedRevision), evidenceRefs: params.evidenceRefs, refs: [offerRef],
    body: async ({ lockedHeads }) => {
      await new PgArrangementRepositories().offers.addEligibility({ id, offerId: params.offerId, travellerId: params.travellerId, organisationId: params.organisationId, agreementScopeId: params.agreementScopeId, actor: actor(params) });
      const advanced = await advance(params.workspaceId, offerRef, lockedHeads);
      if (!advanced.ok) return advanced;
      return { ok: true, value: { eligibilityId: id, offerRevision: advanced.value.afterRevision }, advanced: [advanced.value] };
    },
  });
}

export function offerIsExecutable(offer: Pick<Offer, 'expiresAt'>, at: string): TypedResult<true> {
  if (Date.parse(at) >= Date.parse(offer.expiresAt)) return { ok: false, conflict: typedConflict('VALIDATION_FAILED', 'offer has expired') };
  return { ok: true, value: true };
}

export interface CreateCommercialAgreementParams extends ArrangementCommandIdentity {
  agreement: Omit<CommercialAgreement, 'id' | 'revision'> & { id?: string; revision?: number };
  evidenceRefs?: string[];
}

export async function createCommercialAgreement(uow: UnitOfWork, params: CreateCommercialAgreementParams): Promise<ExecuteOutcome<ArrangementCreatedValue>> {
  const id = params.agreement.id ?? randomUUID();
  const agreementRef = ref('COMMERCIAL_AGREEMENT', id);
  const bad = validateUuidIds('COMMERCIAL_AGREEMENT_CREATED', [['agreement.id', id], ['organisationId', params.agreement.organisationId], ...params.agreement.eligibleAccountIds.map((value, index): [string, string] => [`eligibleAccountIds[${index}]`, value])], [agreementRef]);
  if (bad) return bad;
  if (!params.agreement.publishedAt) return reject('COMMERCIAL_AGREEMENT_CREATED', 'initial publishedAt is required for retry-safe version creation', [agreementRef]);
  const evidenceBad = validateEvidence('COMMERCIAL_AGREEMENT_CREATED', params.evidenceRefs);
  if (evidenceBad) return evidenceBad;
  const agreementValue = parsed('COMMERCIAL_AGREEMENT_CREATED', CommercialAgreementSchema.safeParse({ ...params.agreement, id, revision: 1 }));
  if (isOutcome(agreementValue)) return agreementValue;
  return submit({
    uow, identity: params, commandType: 'COMMERCIAL_AGREEMENT_CREATED', destinationKind: 'COMMERCIAL_AGREEMENT', payload: agreementValue, evidenceRefs: params.evidenceRefs, refs: [agreementRef],
    body: async () => {
      await createRoot({ workspaceId: params.workspaceId, id, kind: 'COMMERCIAL_AGREEMENT' });
      await new PgArrangementRepositories().agreements.create({ agreement: agreementValue, actor: actor(params) });
      return { ok: true, value: { id, revision: 1 }, advanced: [rootCreated(agreementRef)] };
    },
  });
}

export interface AppendAgreementVersionParams extends ArrangementCommandIdentity {
  agreementId: string;
  expectedRevision: number;
  id?: string;
  editionNumber: number;
  publishedAt: string;
  effectiveWindow?: { start: string; end: string };
  publishedTerms: Record<string, unknown>;
  evidenceRefs?: string[];
}

export async function appendAgreementVersion(uow: UnitOfWork, params: AppendAgreementVersionParams): Promise<ExecuteOutcome<{ versionId: string; agreementRevision: number }>> {
  const id = params.id ?? randomUUID();
  const agreementRef = ref('COMMERCIAL_AGREEMENT', params.agreementId);
  const bad = validateUuidIds('AGREEMENT_VERSION_APPENDED', [['agreementId', params.agreementId], ['versionId', id]], [agreementRef]);
  if (bad) return bad;
  const window = params.effectiveWindow ? parsed('AGREEMENT_VERSION_APPENDED', InstantIntervalSchema.safeParse(params.effectiveWindow)) : undefined;
  if (isOutcome(window)) return window;
  const evidenceBad = validateEvidence('AGREEMENT_VERSION_APPENDED', params.evidenceRefs);
  if (evidenceBad) return evidenceBad;
  return submit({
    uow, identity: params, commandType: 'AGREEMENT_VERSION_APPENDED', destinationKind: 'COMMERCIAL_AGREEMENT', payload: { ...params, id, effectiveWindow: window },
    expectedAggregateRevisions: rootExpected('COMMERCIAL_AGREEMENT', params.agreementId, params.expectedRevision), evidenceRefs: params.evidenceRefs, refs: [agreementRef],
    body: async ({ lockedHeads }) => {
      await new PgArrangementRepositories().agreements.appendVersion({ id, agreementId: params.agreementId, editionNumber: params.editionNumber, publishedAt: params.publishedAt, effectiveWindow: window, publishedTerms: params.publishedTerms, actor: actor(params) });
      const advanced = await advance(params.workspaceId, agreementRef, lockedHeads);
      if (!advanced.ok) return advanced;
      return { ok: true, value: { versionId: id, agreementRevision: advanced.value.afterRevision }, advanced: [advanced.value] };
    },
  });
}

export interface AddAgreementScopeParams extends ArrangementCommandIdentity {
  agreementId: string;
  expectedRevision: number;
  id?: string;
  agreementVersionId: string;
  eligibleOrganisationId?: string;
  scopeKind: 'ACCOUNT' | 'NEGOTIATED_RATE' | 'CORPORATE_CODE' | 'OTHER';
  scopeReference?: string;
  validFrom?: string;
  validUntil?: string;
  evidenceRefs?: string[];
}

export async function addAgreementScope(uow: UnitOfWork, params: AddAgreementScopeParams): Promise<ExecuteOutcome<{ scopeId: string; agreementRevision: number }>> {
  const id = params.id ?? randomUUID();
  const agreementRef = ref('COMMERCIAL_AGREEMENT', params.agreementId);
  const bad = validateUuidIds('AGREEMENT_SCOPE_ADDED', [['agreementId', params.agreementId], ['scopeId', id], ['agreementVersionId', params.agreementVersionId], ['eligibleOrganisationId', params.eligibleOrganisationId]], [agreementRef]);
  if (bad) return bad;
  if (params.scopeKind !== 'ACCOUNT' && !params.scopeReference) return reject('AGREEMENT_SCOPE_ADDED', 'non-account scope requires a provider/agreement reference', [agreementRef]);
  const evidenceBad = validateEvidence('AGREEMENT_SCOPE_ADDED', params.evidenceRefs);
  if (evidenceBad) return evidenceBad;
  return submit({
    uow, identity: params, commandType: 'AGREEMENT_SCOPE_ADDED', destinationKind: 'COMMERCIAL_AGREEMENT', payload: { ...params, id }, expectedAggregateRevisions: rootExpected('COMMERCIAL_AGREEMENT', params.agreementId, params.expectedRevision), evidenceRefs: params.evidenceRefs, refs: [agreementRef],
    body: async ({ lockedHeads }) => {
      await new PgArrangementRepositories().agreements.addScope({ id, agreementVersionId: params.agreementVersionId, eligibleOrganisationId: params.eligibleOrganisationId, scopeKind: params.scopeKind, scopeReference: params.scopeReference, validFrom: params.validFrom, validUntil: params.validUntil, actor: actor(params) });
      const advanced = await advance(params.workspaceId, agreementRef, lockedHeads);
      if (!advanced.ok) return advanced;
      return { ok: true, value: { scopeId: id, agreementRevision: advanced.value.afterRevision }, advanced: [advanced.value] };
    },
  });
}

// ---------------------------------------------------------------------------
// External identity, ownership, and capability observations
// ---------------------------------------------------------------------------

export async function createExternalConnection(uow: UnitOfWork, params: ArrangementCommandIdentity & { connection: ExternalConnectionRecord; evidenceRefs?: string[] }): Promise<ExecuteOutcome<ArrangementCreatedValue>> {
  const connectionRef = ref('EXTERNAL_CONNECTION', params.connection.id);
  const bad = validateUuidIds('EXTERNAL_CONNECTION_CREATED', [['connectionId', params.connection.id], ['organisationId', params.connection.organisationId], ['authAccessPolicyId', params.connection.authRef?.accessPolicyId]], [connectionRef]);
  if (bad) return bad;
  const evidenceBad = validateEvidence('EXTERNAL_CONNECTION_CREATED', params.evidenceRefs);
  if (evidenceBad) return evidenceBad;
  return submit({ uow, identity: params, commandType: 'EXTERNAL_CONNECTION_CREATED', destinationKind: 'EXTERNAL_CONNECTION', payload: params.connection, evidenceRefs: params.evidenceRefs, refs: [connectionRef], body: async () => {
    await createRoot({ workspaceId: params.workspaceId, id: params.connection.id, kind: 'EXTERNAL_CONNECTION' });
    await new PgArrangementRepositories().external.createConnection({ connection: params.connection, actor: actor(params) });
    return { ok: true, value: { id: params.connection.id, revision: 1 }, advanced: [rootCreated(connectionRef)] };
  } });
}

export interface ObserveExternalRecordParams extends ArrangementCommandIdentity {
  connectionId: string;
  record: Omit<ExternalRecordRecord, 'id' | 'connectionId'> & { id?: string };
  expectedRevision: number;
  evidenceRefs?: string[];
}

export async function observeExternalRecord(uow: UnitOfWork, params: ObserveExternalRecordParams): Promise<ExecuteOutcome<{ recordId: string; status: 'APPLIED' | 'STALE'; connectionRevision: number }>> {
  const id = params.record.id ?? randomUUID();
  const connectionRef = ref('EXTERNAL_CONNECTION', params.connectionId);
  const recordRef = ref('EXTERNAL_RECORD', id);
  const bad = validateUuidIds('EXTERNAL_RECORD_OBSERVED', [['connectionId', params.connectionId], ['recordId', id]], [connectionRef, recordRef]);
  if (bad) return bad;
  if (params.record.identityState === 'LINKED') return reject('EXTERNAL_RECORD_OBSERVED', 'a record cannot claim LINKED identity before a separate evidence-backed link command', [recordRef]);
  const evidenceBad = validateEvidence('EXTERNAL_RECORD_OBSERVED', params.evidenceRefs);
  if (evidenceBad) return evidenceBad;
  const recordValue: ExternalRecordRecord = { ...params.record, id, connectionId: params.connectionId };
  return submit({
    uow, identity: params, commandType: 'EXTERNAL_RECORD_OBSERVED', destinationKind: 'EXTERNAL_CONNECTION', payload: recordValue, expectedAggregateRevisions: rootExpected('EXTERNAL_CONNECTION', params.connectionId, params.expectedRevision), evidenceRefs: params.evidenceRefs, refs: [connectionRef, recordRef],
    body: async ({ lockedHeads }) => {
      const repos = new PgArrangementRepositories();
      const existing = await repos.external.findRecord({ workspaceId: params.workspaceId, connectionId: params.connectionId, recordType: recordValue.recordType, externalId: recordValue.externalId });
      if (!existing) await registerChildSubject({ workspaceId: params.workspaceId, id, kind: 'EXTERNAL_RECORD', aggregateId: params.connectionId });
      const status = await repos.external.createOrObserveRecord({ record: recordValue, actor: actor(params) });
      if (status === 'STALE') return { ok: true, value: { recordId: existing?.id ?? id, status: status as 'APPLIED' | 'STALE', connectionRevision: params.expectedRevision }, advanced: [] };
      const advanced = await advance(params.workspaceId, connectionRef, lockedHeads);
      if (!advanced.ok) return advanced;
      return { ok: true, value: { recordId: existing?.id ?? id, status: status as 'APPLIED' | 'STALE', connectionRevision: advanced.value.afterRevision }, advanced: [advanced.value] };
    },
  });
}

export const createExternalRecord = observeExternalRecord;

export interface LinkExternalRecordParams extends ArrangementCommandIdentity {
  connectionId: string;
  expectedRevision: number;
  link: ExternalRecordLinkRecord;
  evidenceRefs?: string[];
}

export async function linkExternalRecord(uow: UnitOfWork, params: LinkExternalRecordParams): Promise<ExecuteOutcome<{ linkId: string; connectionRevision: number }>> {
  const connectionRef = ref('EXTERNAL_CONNECTION', params.connectionId);
  const linkRef = ref('EXTERNAL_RECORD', params.link.externalRecordId);
  const canonicalCheck = SubjectKindSchema.safeParse(params.link.canonicalSubject.kind);
  const bad = validateUuidIds('EXTERNAL_RECORD_LINKED', [['connectionId', params.connectionId], ['externalRecordId', params.link.externalRecordId], ['linkId', params.link.id], ['canonicalSubjectId', params.link.canonicalSubject.id], ['evidenceId', params.link.evidenceId]], [connectionRef, linkRef]);
  if (bad) return bad;
  if (!canonicalCheck.success) return reject('EXTERNAL_RECORD_LINKED', 'canonical subject kind is not in the registry', [linkRef]);
  const evidenceBad = validateEvidence('EXTERNAL_RECORD_LINKED', params.evidenceRefs);
  if (evidenceBad) return evidenceBad;
  return submit({ uow, identity: params, commandType: 'EXTERNAL_RECORD_LINKED', destinationKind: 'EXTERNAL_CONNECTION', payload: params.link, expectedAggregateRevisions: rootExpected('EXTERNAL_CONNECTION', params.connectionId, params.expectedRevision), evidenceRefs: params.evidenceRefs, refs: [connectionRef, linkRef], body: async ({ lockedHeads }) => {
    await new PgArrangementRepositories().external.linkRecord({ link: params.link, actor: actor(params) });
    const advanced = await advance(params.workspaceId, connectionRef, lockedHeads);
    if (!advanced.ok) return advanced;
    return { ok: true, value: { linkId: params.link.id, connectionRevision: advanced.value.afterRevision }, advanced: [advanced.value] };
  } });
}

export async function createOwnershipBinding(uow: UnitOfWork, params: ArrangementCommandIdentity & { binding: OwnershipBindingRecord; expectedRevision: number; evidenceRefs?: string[] }): Promise<ExecuteOutcome<{ bindingId: string; subjectRevision: number }>> {
  const subjectRef = params.binding.subject;
  const bad = validateUuidIds('OWNERSHIP_BINDING_CREATED', [['subjectId', subjectRef.id], ['bindingId', params.binding.id], ['connectionId', params.binding.connectionId], ['sourceId', params.binding.sourceId], ['evidenceId', params.binding.evidenceId]], [subjectRef]);
  if (bad) return bad;
  const refCheck = validateRefs('OWNERSHIP_BINDING_CREATED', [subjectRef]);
  if (refCheck) return refCheck;
  const evidenceBad = validateEvidence('OWNERSHIP_BINDING_CREATED', params.evidenceRefs);
  if (evidenceBad) return evidenceBad;
  return submit({ uow, identity: params, commandType: 'OWNERSHIP_BINDING_CREATED', destinationKind: 'OWNERSHIP_BINDING', payload: params.binding, expectedAggregateRevisions: rootExpected(subjectRef.kind, subjectRef.id, params.expectedRevision), evidenceRefs: params.evidenceRefs, refs: [subjectRef], body: async ({ lockedHeads }) => {
    await registerChildSubject({ workspaceId: params.workspaceId, id: params.binding.id, kind: 'OWNERSHIP_BINDING', aggregateId: subjectRef.id });
    await new PgArrangementRepositories().external.createOwnershipBinding({ binding: params.binding, actor: actor(params) });
    const advanced = await advance(params.workspaceId, subjectRef, lockedHeads);
    if (!advanced.ok) return advanced;
    return { ok: true, value: { bindingId: params.binding.id, subjectRevision: advanced.value.afterRevision }, advanced: [advanced.value] };
  } });
}

export async function activateOwnershipBinding(uow: UnitOfWork, params: ArrangementCommandIdentity & { bindingId: string; subjectRef: TypedRef; expectedRevision: number; evidenceRefs?: string[] }): Promise<ExecuteOutcome<{ bindingId: string; subjectRevision: number }>> {
  const bad = validateUuidIds('OWNERSHIP_BINDING_ACTIVATED', [['bindingId', params.bindingId], ['subjectId', params.subjectRef.id]], [params.subjectRef]);
  if (bad) return bad;
  const refCheck = validateRefs('OWNERSHIP_BINDING_ACTIVATED', [params.subjectRef]);
  if (refCheck) return refCheck;
  return submit({ uow, identity: params, commandType: 'OWNERSHIP_BINDING_ACTIVATED', destinationKind: 'OWNERSHIP_BINDING', payload: { bindingId: params.bindingId, subjectRef: params.subjectRef }, expectedAggregateRevisions: rootExpected(params.subjectRef.kind, params.subjectRef.id, params.expectedRevision), evidenceRefs: params.evidenceRefs, refs: [params.subjectRef], body: async ({ lockedHeads }) => {
    await new PgArrangementRepositories().external.activateOwnershipBinding({ bindingId: params.bindingId, actor: actor(params) });
    const advanced = await advance(params.workspaceId, params.subjectRef, lockedHeads);
    if (!advanced.ok) return advanced;
    return { ok: true, value: { bindingId: params.bindingId, subjectRevision: advanced.value.afterRevision }, advanced: [advanced.value] };
  } });
}

export async function recordProviderCapability(uow: UnitOfWork, params: ArrangementCommandIdentity & { capability: ProviderCapabilityRecord; expectedRevision: number; evidenceRefs?: string[] }): Promise<ExecuteOutcome<{ connectionId: string; status: 'APPLIED' | 'STALE'; connectionRevision: number }>> {
  const connectionRef = ref('EXTERNAL_CONNECTION', params.capability.connectionId);
  const bad = validateUuidIds('PROVIDER_CAPABILITY_OBSERVED', [['connectionId', params.capability.connectionId], ['capabilityId', params.capability.id], ['observationEvidenceId', params.capability.observationEvidenceId]], [connectionRef]);
  if (bad) return bad;
  const evidenceBad = validateEvidence('PROVIDER_CAPABILITY_OBSERVED', params.evidenceRefs);
  if (evidenceBad) return evidenceBad;
  return submit<{ connectionId: string; status: 'APPLIED' | 'STALE'; connectionRevision: number }>({ uow, identity: params, commandType: 'PROVIDER_CAPABILITY_OBSERVED', destinationKind: 'EXTERNAL_CONNECTION', payload: params.capability, expectedAggregateRevisions: rootExpected('EXTERNAL_CONNECTION', params.capability.connectionId, params.expectedRevision), evidenceRefs: params.evidenceRefs, refs: [connectionRef], body: async ({ lockedHeads }) => {
    const status = await new PgArrangementRepositories().external.recordCapability({ capability: params.capability, actor: actor(params) });
    if (status === 'STALE') return { ok: true, value: { connectionId: params.capability.connectionId, status, connectionRevision: params.expectedRevision }, advanced: [] };
    const advanced = await advance(params.workspaceId, connectionRef, lockedHeads);
    if (!advanced.ok) return advanced;
    return { ok: true, value: { connectionId: params.capability.connectionId, status, connectionRevision: advanced.value.afterRevision }, advanced: [advanced.value] };
  } });
}

export function capabilityOutcome(capability: { supported: boolean } | undefined): TypedResult<true> {
  if (!capability) return { ok: false, conflict: typedConflict('CAPABILITY_UNSUPPORTED', 'provider capability is unknown; servicing cannot be assumed') };
  if (!capability.supported) return { ok: false, conflict: typedConflict('CAPABILITY_UNSUPPORTED', 'provider capability is explicitly unsupported') };
  return { ok: true, value: true };
}

// ---------------------------------------------------------------------------
// Accounting, budgets, and FX evidence
// ---------------------------------------------------------------------------

export async function createAccountingDimension(uow: UnitOfWork, params: ArrangementCommandIdentity & { dimension: AccountingDimensionRecord; evidenceRefs?: string[] }): Promise<ExecuteOutcome<{ dimensionId: string }>> {
  const bad = validateUuidIds('ACCOUNTING_DIMENSION_CREATED', [['dimensionId', params.dimension.id], ['organisationId', params.dimension.organisationId]], [ref('ORGANISATION', params.dimension.organisationId)]);
  if (bad) return bad;
  const evidenceBad = validateEvidence('ACCOUNTING_DIMENSION_CREATED', params.evidenceRefs);
  if (evidenceBad) return evidenceBad;
  return submit({ uow, identity: params, commandType: 'ACCOUNTING_DIMENSION_CREATED', destinationKind: 'ACCOUNTING_DIMENSION', payload: params.dimension, evidenceRefs: params.evidenceRefs, refs: [ref('ORGANISATION', params.dimension.organisationId)], body: async () => {
    await new PgArrangementRepositories().accounting.createDimension({ dimension: params.dimension, actor: actor(params) });
    return { ok: true, value: { dimensionId: params.dimension.id }, advanced: [] };
  } });
}

export async function assignAccountingDimension(uow: UnitOfWork, params: ArrangementCommandIdentity & { assignment: AccountingAssignmentRecord; evidenceRefs?: string[] }): Promise<ExecuteOutcome<{ assignmentId: string }>> {
  const bad = validateUuidIds('ACCOUNTING_DIMENSION_ASSIGNED', [['assignmentId', params.assignment.id], ['dimensionId', params.assignment.dimensionId], ['subjectId', params.assignment.subject.id]], [params.assignment.subject]);
  if (bad) return bad;
  const refCheck = validateRefs('ACCOUNTING_DIMENSION_ASSIGNED', [params.assignment.subject]);
  if (refCheck) return refCheck;
  const evidenceBad = validateEvidence('ACCOUNTING_DIMENSION_ASSIGNED', params.evidenceRefs);
  if (evidenceBad) return evidenceBad;
  return submit({ uow, identity: params, commandType: 'ACCOUNTING_DIMENSION_ASSIGNED', destinationKind: 'ACCOUNTING_DIMENSION', payload: params.assignment, evidenceRefs: params.evidenceRefs, refs: [params.assignment.subject], body: async () => {
    await new PgArrangementRepositories().accounting.assignDimension({ assignment: params.assignment, actor: actor(params) });
    return { ok: true, value: { assignmentId: params.assignment.id }, advanced: [] };
  } });
}

export async function createBudget(uow: UnitOfWork, params: ArrangementCommandIdentity & { budget: { id: string; organisationId: string; purpose: string; amount: z.input<typeof ExactMoneySchema>; validFrom?: string; validUntil?: string }; evidenceRefs?: string[] }): Promise<ExecuteOutcome<ArrangementCreatedValue>> {
  const budgetRef = ref('BUDGET', params.budget.id);
  const bad = validateUuidIds('BUDGET_CREATED', [['budgetId', params.budget.id], ['organisationId', params.budget.organisationId]], [budgetRef]);
  if (bad) return bad;
  const amount = parsed('BUDGET_CREATED', ExactMoneySchema.safeParse(params.budget.amount));
  if (isOutcome(amount)) return amount;
  const evidenceBad = validateEvidence('BUDGET_CREATED', params.evidenceRefs);
  if (evidenceBad) return evidenceBad;
  return submit({ uow, identity: params, commandType: 'BUDGET_CREATED', destinationKind: 'BUDGET', payload: { ...params.budget, amount }, evidenceRefs: params.evidenceRefs, refs: [budgetRef], body: async () => {
    await createRoot({ workspaceId: params.workspaceId, id: params.budget.id, kind: 'BUDGET' });
    await new PgArrangementRepositories().accounting.createBudget({ budget: { ...params.budget, amount }, actor: actor(params) });
    return { ok: true, value: { id: params.budget.id, revision: 1 }, advanced: [rootCreated(budgetRef)] };
  } });
}

export async function createBudgetCommitment(uow: UnitOfWork, params: ArrangementCommandIdentity & { budgetId: string; expectedRevision: number; commitment: Omit<z.infer<typeof BudgetCommitmentSchema>, 'id'> & { id?: string }; evidenceRefs?: string[] }): Promise<ExecuteOutcome<{ commitmentId: string; budgetRevision: number }>> {
  const id = params.commitment.id ?? randomUUID();
  const budgetRef = ref('BUDGET', params.budgetId);
  const bad = validateUuidIds('BUDGET_COMMITMENT_CREATED', [['budgetId', params.budgetId], ['commitmentId', id], ['actionIntentId', params.commitment.actionIntentId]], [budgetRef]);
  if (bad) return bad;
  const commitment = parsed('BUDGET_COMMITMENT_CREATED', BudgetCommitmentSchema.safeParse({ ...params.commitment, id }));
  if (isOutcome(commitment)) return commitment;
  const evidenceBad = validateEvidence('BUDGET_COMMITMENT_CREATED', params.evidenceRefs);
  if (evidenceBad) return evidenceBad;
  return submit({ uow, identity: params, commandType: 'BUDGET_COMMITMENT_CREATED', destinationKind: 'BUDGET', payload: { budgetId: params.budgetId, commitment }, expectedAggregateRevisions: rootExpected('BUDGET', params.budgetId, params.expectedRevision), evidenceRefs: params.evidenceRefs, refs: [budgetRef], body: async ({ lockedHeads }) => {
    await new PgArrangementRepositories().accounting.createCommitment({ commitment, actor: actor(params) });
    const advanced = await advance(params.workspaceId, budgetRef, lockedHeads);
    if (!advanced.ok) return advanced;
    return { ok: true, value: { commitmentId: id, budgetRevision: advanced.value.afterRevision }, advanced: [advanced.value] };
  } });
}

export async function addBudgetEntry(uow: UnitOfWork, params: ArrangementCommandIdentity & { budgetId: string; expectedRevision: number; commitmentId: string; entry: { id?: string; entryKind: 'HOLD' | 'SETTLEMENT' | 'RELEASE'; amount: z.input<typeof ExactMoneySchema>; evidenceId?: string; entryAt?: string }; evidenceRefs?: string[] }): Promise<ExecuteOutcome<{ entryId: string; budgetRevision: number }>> {
  const id = params.entry.id ?? randomUUID();
  const budgetRef = ref('BUDGET', params.budgetId);
  const bad = validateUuidIds('BUDGET_ENTRY_ADDED', [['budgetId', params.budgetId], ['commitmentId', params.commitmentId], ['entryId', id], ['evidenceId', params.entry.evidenceId]], [budgetRef]);
  if (bad) return bad;
  const amount = parsed('BUDGET_ENTRY_ADDED', ExactMoneySchema.safeParse(params.entry.amount));
  if (isOutcome(amount)) return amount;
  if (params.entry.entryKind !== 'HOLD' && !params.entry.evidenceId) return reject('BUDGET_ENTRY_ADDED', 'settlement/release entries require evidence', [budgetRef]);
  const evidenceBad = validateEvidence('BUDGET_ENTRY_ADDED', params.evidenceRefs);
  if (evidenceBad) return evidenceBad;
  return submit({ uow, identity: params, commandType: 'BUDGET_ENTRY_ADDED', destinationKind: 'BUDGET', payload: { ...params, entry: { ...params.entry, id, amount } }, expectedAggregateRevisions: rootExpected('BUDGET', params.budgetId, params.expectedRevision), evidenceRefs: params.evidenceRefs, refs: [budgetRef], body: async ({ lockedHeads }) => {
    await new PgArrangementRepositories().accounting.addBudgetEntry({ workspaceId: params.workspaceId, commitmentId: params.commitmentId, entry: { ...params.entry, id, amount }, actor: actor(params) });
    const advanced = await advance(params.workspaceId, budgetRef, lockedHeads);
    if (!advanced.ok) return advanced;
    return { ok: true, value: { entryId: id, budgetRevision: advanced.value.afterRevision }, advanced: [advanced.value] };
  } });
}

export async function createCostAllocation(uow: UnitOfWork, params: ArrangementCommandIdentity & { allocation: import('../../../contracts/v2/repository/arrangements.ts').CostAllocationRecord; expectedReservationRevision?: number; evidenceRefs?: string[] }): Promise<ExecuteOutcome<{ allocationId: string; reservationRevision?: number }>> {
  const a = params.allocation;
  const reservationRef = a.reservationId ? ref('RESERVATION', a.reservationId) : undefined;
  const bad = validateUuidIds('COST_ALLOCATION_CREATED', [['allocationId', a.id], ['reservationId', a.reservationId], ['actionIntentId', a.actionIntentId], ['payerOrganisationId', a.payerOrganisationId], ['payerTravellerId', a.payerTravellerId], ['fxObservationId', a.fxObservationId], ['accountingDimensionId', a.accountingDimensionId], ['evidenceId', a.evidenceId]], reservationRef ? [reservationRef] : []);
  if (bad) return bad;
  const amount = parsed('COST_ALLOCATION_CREATED', ExactMoneySchema.safeParse(a.amount));
  if (isOutcome(amount)) return amount;
  if (a.entryKind === 'ACTUAL' && !a.evidenceId) return reject('COST_ALLOCATION_CREATED', 'actual allocation requires evidence', reservationRef ? [reservationRef] : []);
  if (reservationRef && params.expectedReservationRevision === undefined) return reject('COST_ALLOCATION_CREATED', 'reservation allocations require an expected reservation revision', [reservationRef]);
  const evidenceBad = validateEvidence('COST_ALLOCATION_CREATED', params.evidenceRefs);
  if (evidenceBad) return evidenceBad;
  const refs = reservationRef ? [reservationRef] : [];
  return submit<{ allocationId: string; reservationRevision?: number }>({ uow, identity: params, commandType: 'COST_ALLOCATION_CREATED', destinationKind: 'COST_ALLOCATION', payload: { ...a, amount }, expectedAggregateRevisions: reservationRef ? rootExpected('RESERVATION', a.reservationId!, params.expectedReservationRevision!) : [], evidenceRefs: params.evidenceRefs, refs, body: async ({ lockedHeads }) => {
    await new PgArrangementRepositories().accounting.createCostAllocation({ allocation: { ...a, amount }, actor: actor(params) });
    if (!reservationRef) return { ok: true, value: { allocationId: a.id, reservationRevision: undefined }, advanced: [] };
    const advanced = await advance(params.workspaceId, reservationRef, lockedHeads);
    if (!advanced.ok) return advanced;
    return { ok: true, value: { allocationId: a.id, reservationRevision: advanced.value.afterRevision }, advanced: [advanced.value] };
  } });
}

export async function recordFxObservation(uow: UnitOfWork, params: ArrangementCommandIdentity & { observation: FxObservation; evidenceRefs?: string[] }): Promise<ExecuteOutcome<{ observationId: string }>> {
  const bad = validateUuidIds('FX_OBSERVATION_RECORDED', [['observationId', params.observation.id]], []);
  if (bad) return bad;
  const observation = parsed('FX_OBSERVATION_RECORDED', FxObservationSchema.safeParse(params.observation));
  if (isOutcome(observation)) return observation;
  const evidenceBad = validateEvidence('FX_OBSERVATION_RECORDED', params.evidenceRefs);
  if (evidenceBad) return evidenceBad;
  return submit({ uow, identity: params, commandType: 'FX_OBSERVATION_RECORDED', destinationKind: 'FX_OBSERVATION', payload: observation, evidenceRefs: params.evidenceRefs, refs: [], body: async () => {
    await new PgArrangementRepositories().accounting.recordFxObservation({ observation, actor: actor(params) });
    return { ok: true, value: { observationId: observation.id }, advanced: [] };
  } });
}

export const createFxObservation = recordFxObservation;

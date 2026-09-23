/**
 * PostgreSQL typed-row repositories for M3 arrangements.
 *
 * Command handlers own identity registration, aggregate-head CAS, receipts and
 * audit/outbox rows. This class only writes the typed M3 rows through the
 * ambient transaction client, matching the M2 repository boundary. A caller
 * cannot use it to turn a Journey intention into supplier truth or to bypass a
 * workspace predicate.
 */
import { createHash } from 'node:crypto';
import type { PoolClient } from '../pool.ts';
import type {
  AccountingAssignmentRecord,
  AccountingDimensionRecord,
  ArrangementRepositories,
  CommercialAgreementRepository,
  CostAllocationRecord,
  EntitlementRepository,
  ExternalConnectionRecord,
  ExternalIntegrationRepository,
  ExternalRecordLinkRecord,
  ExternalRecordRecord,
  OfferRepository,
  OwnershipBindingRecord,
  ProviderCapabilityRecord,
  ReservationLineDetail,
  ReservationLineObservation,
  ReservationRepository,
  ResourceDetail,
  ResourceRepository,
  TransportScheduleObservation,
  TransportServiceRepository,
  BudgetEntryRecord,
  BudgetRecord,
} from '../../../contracts/v2/repository/arrangements.ts';
import type { ActorContext } from '../../../contracts/v2/repository/people.ts';
import {
  OfferSchema,
  ReservationLineSchema,
  ReservationSchema,
  ResourceSchema,
  ServiceEntitlementSchema,
  TransportServiceSchema,
  type Offer,
  type Reservation,
  type ReservationAllocation,
  type ReservationLine,
  type Resource,
  type ServiceEntitlement,
  type TransportService,
} from '../../../domain/v2/arrangements/reservation.ts';
import type { ExactMoney, FxObservation } from '../../../domain/v2/shared/money.ts';
import { currentTransactionClient } from '../transactionContext.ts';

interface TransportRow {
  id: string;
  mode: string;
  operator: string;
  origin_place_id: string;
  destination_place_id: string;
  published_departure: Date | null;
  published_arrival: Date | null;
  published_observed_at: Date | null;
  published_evidence_id: string | null;
  estimated_departure: Date | null;
  estimated_arrival: Date | null;
  estimated_observed_at: Date | null;
  estimated_evidence_id: string | null;
  actual_departure: Date | null;
  actual_arrival: Date | null;
  actual_observed_at: Date | null;
  actual_evidence_id: string | null;
  revision: string;
}

interface ReservationRow {
  id: string;
  reservation_type: string;
  observed_status: string;
  observed_status_at: Date | null;
  responsible_organisation_id: string | null;
  responsible_traveller_id: string | null;
  external_connection_id: string | null;
  external_record_id: string | null;
  revision: string;
}

interface LineRow {
  id: string;
  reservation_id: string;
  product_type: string;
  observed_status: string;
  observed_status_at: Date | null;
  observation_evidence_id: string | null;
}

interface AllocationRow {
  id: string;
  line_id: string;
  reservation_id: string;
  traveller_id: string;
  journey_item_id: string | null;
  allocation_role: string;
  quantity: number;
}

interface EntitlementRow {
  id: string;
  entitlement_type: string;
  observed_status: string;
  observed_status_at: Date | null;
  issuer_organisation_id: string | null;
  identifier_content_hash: string | null;
  identifier_storage_ref: string | null;
  identifier_access_policy_id: string | null;
  exchanged_from_entitlement_id: string | null;
  observation_evidence_id: string | null;
}

const TRANSPORT_COLUMNS = `
  s.id, s.mode, s.operator, s.origin_place_id, s.destination_place_id,
  s.published_departure, s.published_arrival, s.published_observed_at, s.published_evidence_id,
  s.estimated_departure, s.estimated_arrival, s.estimated_observed_at, s.estimated_evidence_id,
  s.actual_departure, s.actual_arrival, s.actual_observed_at, s.actual_evidence_id,
  h.revision`;

const RESERVATION_COLUMNS = `
  r.id, r.reservation_type, r.observed_status, r.observed_status_at,
  r.responsible_organisation_id, r.responsible_traveller_id,
  er.connection_id AS external_connection_id, er.id AS external_record_id,
  h.revision`;

function deterministicUuid(seed: string): string {
  const hex = createHash('sha256').update(seed, 'utf8').digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

function asIso(value: Date | null): string | undefined {
  return value?.toISOString();
}

function observedInstant(value: Date | null, observedAt: Date | null, evidenceId: string | null) {
  if (!value) return undefined;
  if (!observedAt || !evidenceId) throw new Error('transport service contains a time without complete provenance');
  return { value: value.toISOString(), observedAt: observedAt.toISOString(), sourceId: evidenceId };
}

function toTransportService(row: TransportRow): TransportService {
  return TransportServiceSchema.parse({
    id: row.id,
    revision: Number(row.revision),
    mode: row.mode,
    operator: row.operator,
    originPlaceId: row.origin_place_id,
    destinationPlaceId: row.destination_place_id,
    ...(observedInstant(row.published_departure, row.published_observed_at, row.published_evidence_id)
      ? { publishedDeparture: observedInstant(row.published_departure, row.published_observed_at, row.published_evidence_id) }
      : {}),
    ...(observedInstant(row.published_arrival, row.published_observed_at, row.published_evidence_id)
      ? { publishedArrival: observedInstant(row.published_arrival, row.published_observed_at, row.published_evidence_id) }
      : {}),
    ...(observedInstant(row.estimated_departure, row.estimated_observed_at, row.estimated_evidence_id)
      ? { estimatedDeparture: observedInstant(row.estimated_departure, row.estimated_observed_at, row.estimated_evidence_id) }
      : {}),
    ...(observedInstant(row.estimated_arrival, row.estimated_observed_at, row.estimated_evidence_id)
      ? { estimatedArrival: observedInstant(row.estimated_arrival, row.estimated_observed_at, row.estimated_evidence_id) }
      : {}),
    ...(observedInstant(row.actual_departure, row.actual_observed_at, row.actual_evidence_id)
      ? { actualDeparture: observedInstant(row.actual_departure, row.actual_observed_at, row.actual_evidence_id) }
      : {}),
    ...(observedInstant(row.actual_arrival, row.actual_observed_at, row.actual_evidence_id)
      ? { actualArrival: observedInstant(row.actual_arrival, row.actual_observed_at, row.actual_evidence_id) }
      : {}),
  });
}

function toReservation(row: ReservationRow): Reservation {
  return ReservationSchema.parse({
    id: row.id,
    revision: Number(row.revision),
    reservationType: row.reservation_type,
    observedStatus: row.observed_status,
    ...(asIso(row.observed_status_at) ? { observedStatusAt: asIso(row.observed_status_at) } : {}),
    ...(row.responsible_organisation_id ? { responsibleOrganisationId: row.responsible_organisation_id } : {}),
    ...(row.responsible_traveller_id ? { responsibleTravellerId: row.responsible_traveller_id } : {}),
    ...(row.external_connection_id ? { externalConnectionId: row.external_connection_id } : {}),
    ...(row.external_record_id ? { externalRecordId: row.external_record_id } : {}),
  });
}

function toReservationLine(row: LineRow): ReservationLine {
  return ReservationLineSchema.parse({
    id: row.id,
    reservationId: row.reservation_id,
    productType: row.product_type,
    observedStatus: row.observed_status,
    ...(row.observed_status_at ? { observedStatusAt: row.observed_status_at.toISOString() } : {}),
    ...(row.observation_evidence_id ? { observationEvidenceId: row.observation_evidence_id } : {}),
  });
}

function toAllocation(row: AllocationRow): ReservationAllocation {
  return {
    id: row.id,
    reservationId: row.reservation_id,
    reservationLineId: row.line_id,
    travellerId: row.traveller_id,
    ...(row.journey_item_id ? { journeyItemId: row.journey_item_id } : {}),
    allocationRole: row.allocation_role,
    quantity: row.quantity,
  };
}

function toEntitlement(row: EntitlementRow): ServiceEntitlement {
  const protectedIdentifier =
    row.identifier_content_hash && row.identifier_storage_ref && row.identifier_access_policy_id
      ? {
          contentHash: row.identifier_content_hash,
          storageRef: row.identifier_storage_ref,
          accessPolicyId: row.identifier_access_policy_id,
        }
      : undefined;
  return ServiceEntitlementSchema.parse({
    id: row.id,
    entitlementType: row.entitlement_type,
    observedStatus: row.observed_status,
    ...(row.observed_status_at ? { observedStatusAt: row.observed_status_at.toISOString() } : {}),
    ...(row.issuer_organisation_id ? { issuerOrganisationId: row.issuer_organisation_id } : {}),
    ...(protectedIdentifier ? { protectedIdentifier } : {}),
    ...(row.exchanged_from_entitlement_id ? { exchangedFromEntitlementId: row.exchanged_from_entitlement_id } : {}),
    ...(row.observation_evidence_id ? { evidenceId: row.observation_evidence_id } : {}),
  });
}

export class PgArrangementRepositories implements ArrangementRepositories {
  private readonly boundWorkspaceId?: string;
  readonly transportServices: TransportServiceRepository;
  readonly resources: ResourceRepository;
  readonly reservations: ReservationRepository;
  readonly entitlements: EntitlementRepository;
  readonly offers: OfferRepository;
  readonly agreements: CommercialAgreementRepository;
  readonly external: ExternalIntegrationRepository;
  readonly accounting: import('../../../contracts/v2/repository/arrangements.ts').AccountingRepository;

  constructor(boundWorkspaceId?: string) {
    this.boundWorkspaceId = boundWorkspaceId;
    this.transportServices = {
      create: (params) => this.createTransportService(params),
      load: (workspaceId, serviceId) => this.loadTransportService(workspaceId, serviceId),
      recordObservation: (params) => this.recordTransportObservation(params),
    };
    this.resources = {
      create: (params) => this.createResource(params),
      load: (workspaceId, resourceId) => this.loadResource(workspaceId, resourceId),
    };
    this.reservations = {
      create: (params) => this.createReservation(params),
      load: (workspaceId, reservationId) => this.loadReservation(workspaceId, reservationId),
      listLines: (workspaceId, reservationId) => this.listReservationLines(workspaceId, reservationId),
      addLine: (params) => this.addReservationLine(params),
      recordLineObservation: (params) => this.recordReservationLineObservation(params),
      listAllocations: (workspaceId, reservationId) => this.listReservationAllocations(workspaceId, reservationId),
      addAllocation: (params) => this.addReservationAllocation(params),
      journeyItemTraveller: (workspaceId, journeyItemId) => this.journeyItemTraveller(workspaceId, journeyItemId),
    };
    this.entitlements = {
      create: (params) => this.createEntitlement(params),
      load: (workspaceId, entitlementId) => this.loadEntitlement(workspaceId, entitlementId),
      linkLine: (params) => this.linkEntitlementLine(params),
      linkTraveller: (params) => this.linkEntitlementTraveller(params),
      addComponent: (params) => this.addEntitlementComponent(params),
    };
    this.offers = {
      create: (params) => this.createOffer(params),
      addItem: (params) => this.addOfferItem(params),
      addEligibility: (params) => this.addOfferEligibility(params),
    };
    this.agreements = {
      create: (params) => this.createCommercialAgreement(params),
      appendVersion: (params) => this.appendAgreementVersion(params),
      addScope: (params) => this.addAgreementScope(params),
    };
    this.external = {
      createConnection: (params) => this.createExternalConnection(params),
      findRecord: (params) => this.findExternalRecord(params),
      loadRecord: (params) => this.loadExternalRecord(params),
      findLiveCanonicalSubjects: (workspaceId, externalRecordId) => this.findLiveCanonicalSubjects(workspaceId, externalRecordId),
      createOrObserveRecord: (params) => this.createOrObserveExternalRecord(params),
      linkRecord: (params) => this.linkExternalRecord(params),
      createOwnershipBinding: (params) => this.createOwnershipBinding(params),
      activateOwnershipBinding: (params) => this.activateOwnershipBinding(params),
      recordCapability: (params) => this.recordProviderCapability(params),
    };
    this.accounting = {
      createDimension: (params) => this.createAccountingDimension(params),
      assignDimension: (params) => this.assignAccountingDimension(params),
      createBudget: (params) => this.createBudget(params),
      createCommitment: (params) => this.createBudgetCommitment(params),
      addBudgetEntry: (params) => this.addBudgetEntry(params),
      createCostAllocation: (params) => this.createCostAllocation(params),
      recordFxObservation: (params) => this.recordFxObservation(params),
    };
  }

  private client(): PoolClient {
    return currentTransactionClient();
  }

  private scope(...workspaceIds: (string | undefined)[]): string {
    const workspaceId = this.boundWorkspaceId ?? workspaceIds.find((value): value is string => value !== undefined);
    if (!workspaceId) throw new Error('M3 repository requires a workspace id');
    for (const candidate of workspaceIds) {
      if (candidate !== undefined && candidate !== workspaceId) {
        throw new Error(`M3 repository is bound to workspace ${workspaceId}; refuses ${candidate}`);
      }
    }
    return workspaceId;
  }

  private assertInserted(rowCount: number | null, what: string): void {
    if (rowCount !== 1) throw new Error(`${what} was not written`);
  }

  async createTransportService(params: { service: TransportService; actor: ActorContext }): Promise<void> {
    const service = params.service;
    const workspaceId = this.scope(params.actor.workspaceId);
    const published = service.publishedDeparture ?? service.publishedArrival;
    if (!published) throw new Error('a TransportService requires published schedule evidence');
    const group = (field: 'published' | 'estimated' | 'actual') => {
      const departure = service[`${field}Departure`];
      const arrival = service[`${field}Arrival`];
      const observation = departure ?? arrival;
      if (!observation) return [null, null, null, null];
      if (departure && arrival && (departure.observedAt !== arrival.observedAt || departure.sourceId !== arrival.sourceId)) {
        throw new Error(`${field} transport times must share one observation edition`);
      }
      return [departure?.value ?? null, arrival?.value ?? null, observation.observedAt, observation.sourceId];
    };
    const [publishedDeparture, publishedArrival, publishedObservedAt, publishedEvidenceId] = group('published');
    const [estimatedDeparture, estimatedArrival, estimatedObservedAt, estimatedEvidenceId] = group('estimated');
    const [actualDeparture, actualArrival, actualObservedAt, actualEvidenceId] = group('actual');
    const result = await this.client().query(
      `INSERT INTO transport_services
         (workspace_id, id, mode, operator, origin_place_id, destination_place_id,
          published_departure, published_arrival, published_observed_at, published_evidence_id,
          estimated_departure, estimated_arrival, estimated_observed_at, estimated_evidence_id,
          actual_departure, actual_arrival, actual_observed_at, actual_evidence_id,
          created_by_actor_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [
        workspaceId,
        service.id,
        service.mode,
        service.operator,
        service.originPlaceId,
        service.destinationPlaceId,
        publishedDeparture,
        publishedArrival,
        publishedObservedAt,
        publishedEvidenceId,
        estimatedDeparture,
        estimatedArrival,
        estimatedObservedAt,
        estimatedEvidenceId,
        actualDeparture,
        actualArrival,
        actualObservedAt,
        actualEvidenceId,
        params.actor.actorPrincipalId,
      ],
    );
    this.assertInserted(result.rowCount, `transport service ${service.id}`);
  }

  async loadTransportService(workspaceId: string, serviceId: string): Promise<TransportService | undefined> {
    const scoped = this.scope(workspaceId);
    const result = await this.client().query<TransportRow>(
      `SELECT ${TRANSPORT_COLUMNS}
         FROM transport_services s
         JOIN aggregate_heads h ON h.workspace_id = s.workspace_id AND h.aggregate_id = s.id
        WHERE s.workspace_id = $1 AND s.id = $2`,
      [scoped, serviceId],
    );
    return result.rows[0] ? toTransportService(result.rows[0]) : undefined;
  }

  async recordTransportObservation(params: {
    workspaceId: string;
    serviceId: string;
    observation: TransportScheduleObservation;
    actor: ActorContext;
  }): Promise<'APPLIED' | 'STALE'> {
    const workspaceId = this.scope(params.workspaceId, params.actor.workspaceId);
    const { field, departure, arrival, observedAt, evidenceId } = params.observation;
    if (!departure && !arrival) throw new Error('transport observation must contain departure or arrival');
    const prefix = field.toLowerCase();
    const current = await this.client().query<{ observed_at: Date | null }>(
      `SELECT ${prefix}_observed_at AS observed_at
         FROM transport_services WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, params.serviceId],
    );
    if (!current.rows[0]) throw new Error(`transport service ${params.serviceId} not found`);
    if (current.rows[0].observed_at && current.rows[0].observed_at.getTime() >= Date.parse(observedAt)) return 'STALE';
    const result = await this.client().query(
      `UPDATE transport_services SET
         ${prefix}_departure = COALESCE($3::timestamptz, ${prefix}_departure),
         ${prefix}_arrival = COALESCE($4::timestamptz, ${prefix}_arrival),
         ${prefix}_observed_at = $5::timestamptz,
         ${prefix}_evidence_id = $6::uuid,
         updated_at = now()
       WHERE workspace_id = $1 AND id = $2
         AND (${prefix}_observed_at IS NULL OR ${prefix}_observed_at < $5::timestamptz)`,
      [workspaceId, params.serviceId, departure ?? null, arrival ?? null, observedAt, evidenceId],
    );
    return result.rowCount === 1 ? 'APPLIED' : 'STALE';
  }

  async createResource(params: { resource: Resource; detail: ResourceDetail; actor: ActorContext }): Promise<void> {
    const workspaceId = this.scope(params.actor.workspaceId);
    if (params.resource.resourceType !== params.detail.resourceType) throw new Error('resource/detail kind mismatch');
    const resource = params.resource;
    const result = await this.client().query(
      `INSERT INTO resources
         (workspace_id, id, resource_type, location_place_id, capacity, created_by_actor_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [workspaceId, resource.id, resource.resourceType, resource.placeId ?? null, resource.capacity ?? null, params.actor.actorPrincipalId],
    );
    this.assertInserted(result.rowCount, `resource ${resource.id}`);
    const detailTable =
      resource.resourceType === 'VEHICLE'
        ? 'vehicle_resource_details'
        : resource.resourceType === 'ROOM'
          ? 'room_resource_details'
          : 'equipment_resource_details';
    const values = resource.resourceType === 'ROOM'
      ? [workspaceId, resource.id, 'ROOM', params.detail.resourceType === 'ROOM' ? params.detail.bedConfiguration ?? null : null]
      : [workspaceId, resource.id, resource.resourceType];
    const detailResult = await this.client().query(
      resource.resourceType === 'ROOM'
        ? `INSERT INTO room_resource_details (workspace_id, resource_id, resource_type, bed_configuration) VALUES ($1,$2,$3,$4)`
        : `INSERT INTO ${detailTable} (workspace_id, resource_id, resource_type) VALUES ($1,$2,$3)`,
      values,
    );
    this.assertInserted(detailResult.rowCount, `${resource.resourceType} resource detail ${resource.id}`);
  }

  async loadResource(workspaceId: string, resourceId: string): Promise<Resource | undefined> {
    const scoped = this.scope(workspaceId);
    const result = await this.client().query<{
      resource_type: string;
      location_place_id: string | null;
      capacity: number | null;
    }>(
      `SELECT resource_type, location_place_id, capacity FROM resources WHERE workspace_id = $1 AND id = $2`,
      [scoped, resourceId],
    );
    const row = result.rows[0];
    return row
      ? ResourceSchema.parse({
          id: resourceId,
          resourceType: row.resource_type,
          ...(row.location_place_id ? { placeId: row.location_place_id } : {}),
          ...(row.capacity !== null ? { capacity: row.capacity } : {}),
        })
      : undefined;
  }

  async createReservation(params: { reservation: Reservation; actor: ActorContext }): Promise<void> {
    const workspaceId = this.scope(params.actor.workspaceId);
    const r = params.reservation;
    const result = await this.client().query(
      `INSERT INTO reservations
         (workspace_id, id, reservation_type, observed_status, observed_status_at,
          responsible_organisation_id, responsible_traveller_id, created_by_actor_id)
       VALUES ($1,$2,$3,COALESCE($4,'UNKNOWN'),$5,$6,$7,$8)`,
      [
        workspaceId,
        r.id,
        r.reservationType,
        r.observedStatus ?? 'UNKNOWN',
        r.observedStatus === 'UNKNOWN' || !r.observedStatus ? null : r.observedStatusAt ?? (() => { throw new Error('known reservation status requires observation time'); })(),
        r.responsibleOrganisationId ?? null,
        r.responsibleTravellerId ?? null,
        params.actor.actorPrincipalId,
      ],
    );
    this.assertInserted(result.rowCount, `reservation ${r.id}`);
  }

  async loadReservation(workspaceId: string, reservationId: string): Promise<Reservation | undefined> {
    const scoped = this.scope(workspaceId);
    const result = await this.client().query<ReservationRow>(
      `SELECT ${RESERVATION_COLUMNS}
         FROM reservations r
         JOIN aggregate_heads h ON h.workspace_id = r.workspace_id AND h.aggregate_id = r.id
         LEFT JOIN LATERAL (
           SELECT er.connection_id, er.id
             FROM external_record_links l
             JOIN external_records er ON er.workspace_id = l.workspace_id AND er.id = l.external_record_id
            WHERE l.workspace_id = r.workspace_id
              AND l.canonical_subject_id = r.id
              AND l.canonical_subject_kind = 'RESERVATION'
              AND l.superseded_at IS NULL
              AND er.identity_state = 'LINKED'
            ORDER BY l.linked_at DESC, l.id DESC
            LIMIT 1
         ) er ON true
        WHERE r.workspace_id = $1 AND r.id = $2`,
      [scoped, reservationId],
    );
    return result.rows[0] ? toReservation(result.rows[0]) : undefined;
  }

  async listReservationLines(workspaceId: string, reservationId: string): Promise<ReservationLine[]> {
    const scoped = this.scope(workspaceId);
    const result = await this.client().query<LineRow>(
      `SELECT id, reservation_id, product_type, observed_status, observed_status_at, observation_evidence_id
         FROM reservation_lines WHERE workspace_id = $1 AND reservation_id = $2 ORDER BY created_at, id`,
      [scoped, reservationId],
    );
    return result.rows.map(toReservationLine);
  }

  async addReservationLine(params: { line: ReservationLine; detail: ReservationLineDetail; actor: ActorContext }): Promise<void> {
    const workspaceId = this.scope(params.actor.workspaceId);
    const line = params.line;
    if (line.productType !== params.detail.productType) throw new Error('reservation line/detail kind mismatch');
    const lineResult = await this.client().query(
      `INSERT INTO reservation_lines
         (workspace_id, id, reservation_id, product_type, observed_status, observed_status_at,
          observation_evidence_id, created_by_actor_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        workspaceId,
        line.id,
        line.reservationId,
        line.productType,
        line.observedStatus,
        line.observedStatus === 'UNKNOWN' ? null : line.observedStatusAt ?? (() => { throw new Error('known reservation line status requires observation time'); })(),
        line.observationEvidenceId ?? null,
        params.actor.actorPrincipalId,
      ],
    );
    this.assertInserted(lineResult.rowCount, `reservation line ${line.id}`);
    const detail = params.detail;
    let sql: string;
    let values: unknown[];
    if (detail.productType === 'TRANSPORT') {
      sql = `INSERT INTO transport_line_details (workspace_id, line_id, product_type, transport_service_id) VALUES ($1,$2,$3,$4)`;
      values = [workspaceId, line.id, detail.productType, detail.transportServiceId];
    } else if (detail.productType === 'STAY') {
      sql = `INSERT INTO stay_line_details
        (workspace_id, line_id, product_type, stay_interval_start, stay_interval_end, resource_id, place_id, occupancy)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`;
      values = [workspaceId, line.id, detail.productType, detail.stayInterval?.start ?? null, detail.stayInterval?.end ?? null, detail.resourceId ?? null, detail.placeId ?? null, detail.occupancy ? JSON.stringify(detail.occupancy) : null];
    } else {
      sql = `INSERT INTO resource_use_line_details
        (workspace_id, line_id, product_type, resource_id, use_interval_start, use_interval_end, place_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`;
      values = [workspaceId, line.id, detail.productType, detail.resourceId, detail.useInterval?.start ?? null, detail.useInterval?.end ?? null, detail.placeId ?? null];
    }
    const detailResult = await this.client().query(sql, values);
    this.assertInserted(detailResult.rowCount, `reservation line detail ${line.id}`);
  }

  async recordReservationLineObservation(params: {
    workspaceId: string;
    lineId: string;
    observation: ReservationLineObservation;
    actor: ActorContext;
  }): Promise<'APPLIED' | 'STALE'> {
    const workspaceId = this.scope(params.workspaceId, params.actor.workspaceId);
    const observation = params.observation;
    if (observation.observedStatus !== 'UNKNOWN' && !observation.observedStatusAt) {
      throw new Error('known reservation line status requires observation time');
    }
    const current = await this.client().query<{ observed_status_at: Date | null }>(
      `SELECT observed_status_at FROM reservation_lines WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, params.lineId],
    );
    if (!current.rows[0]) throw new Error(`reservation line ${params.lineId} not found`);
    if (!observation.observedStatusAt && current.rows[0].observed_status_at) return 'STALE';
    if (current.rows[0].observed_status_at && observation.observedStatusAt && current.rows[0].observed_status_at.getTime() >= Date.parse(observation.observedStatusAt)) return 'STALE';
    const result = await this.client().query(
      `UPDATE reservation_lines SET observed_status = $3, observed_status_at = $4,
         observation_evidence_id = $5, observed_terms = $6, updated_at = now()
       WHERE workspace_id = $1 AND id = $2
         AND (observed_status_at IS NULL OR ($4::timestamptz IS NOT NULL AND observed_status_at < $4::timestamptz))`,
      [workspaceId, params.lineId, observation.observedStatus, observation.observedStatusAt ?? null, observation.observationEvidenceId ?? null, observation.observedTerms ? JSON.stringify(observation.observedTerms) : null],
    );
    return result.rowCount === 1 ? 'APPLIED' : 'STALE';
  }

  async listReservationAllocations(workspaceId: string, reservationId: string): Promise<ReservationAllocation[]> {
    const scoped = this.scope(workspaceId);
    const result = await this.client().query<AllocationRow>(
      `SELECT id, line_id, reservation_id, traveller_id, journey_item_id, allocation_role, quantity
         FROM reservation_allocations WHERE workspace_id = $1 AND reservation_id = $2 ORDER BY created_at, id`,
      [scoped, reservationId],
    );
    return result.rows.map(toAllocation);
  }

  async addReservationAllocation(params: { allocation: ReservationAllocation; actor: ActorContext }): Promise<void> {
    const workspaceId = this.scope(params.actor.workspaceId);
    const a = params.allocation;
    // The contract field is additive-optional; persistence requires the owning reservation.
    if (a.reservationId === undefined) throw new Error('reservation allocation must name its reservation before persistence');
    const result = await this.client().query(
      `INSERT INTO reservation_allocations
         (workspace_id, id, reservation_id, line_id, traveller_id, journey_item_id, allocation_role, quantity, created_by_actor_id)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9
        WHERE EXISTS (SELECT 1 FROM reservation_lines l WHERE l.workspace_id = $1 AND l.id = $4 AND l.reservation_id = $3)`,
      [workspaceId, a.id, params.allocation.reservationId, a.reservationLineId, a.travellerId, a.journeyItemId ?? null, a.allocationRole, a.quantity, params.actor.actorPrincipalId],
    );
    this.assertInserted(result.rowCount, `reservation allocation ${a.id}`);
  }

  async journeyItemTraveller(workspaceId: string, journeyItemId: string): Promise<string | undefined> {
    const scoped = this.scope(workspaceId);
    const result = await this.client().query<{ traveller_id: string }>(
      `SELECT j.traveller_id
         FROM journey_items i JOIN journeys j ON j.workspace_id = i.workspace_id AND j.id = i.journey_id
        WHERE i.workspace_id = $1 AND i.id = $2`,
      [scoped, journeyItemId],
    );
    return result.rows[0]?.traveller_id;
  }

  async createEntitlement(params: { entitlement: ServiceEntitlement; actor: ActorContext }): Promise<void> {
    const workspaceId = this.scope(params.actor.workspaceId);
    const e = params.entitlement;
    const ref = e.protectedIdentifier;
    const result = await this.client().query(
      `INSERT INTO service_entitlements
         (workspace_id, id, entitlement_type, observed_status, observed_status_at,
          issuer_organisation_id, identifier_content_hash, identifier_storage_ref, identifier_access_policy_id,
          exchanged_from_entitlement_id, observation_evidence_id, created_by_actor_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [workspaceId, e.id, e.entitlementType, e.observedStatus, e.observedStatus === 'UNKNOWN' ? null : e.observedStatusAt ?? (() => { throw new Error('positive entitlement status requires observation time'); })(), e.issuerOrganisationId ?? null, ref?.contentHash ?? null, ref?.storageRef ?? null, ref?.accessPolicyId ?? null, e.exchangedFromEntitlementId ?? null, e.evidenceId ?? null, params.actor.actorPrincipalId],
    );
    this.assertInserted(result.rowCount, `service entitlement ${e.id}`);
  }

  async loadEntitlement(workspaceId: string, entitlementId: string): Promise<ServiceEntitlement | undefined> {
    const scoped = this.scope(workspaceId);
    const result = await this.client().query<EntitlementRow>(
      `SELECT id, entitlement_type, observed_status, observed_status_at, issuer_organisation_id,
              identifier_content_hash, identifier_storage_ref, identifier_access_policy_id,
              exchanged_from_entitlement_id, observation_evidence_id
         FROM service_entitlements WHERE workspace_id = $1 AND id = $2`,
      [scoped, entitlementId],
    );
    return result.rows[0] ? toEntitlement(result.rows[0]) : undefined;
  }

  async linkEntitlementLine(params: { entitlementId: string; lineId: string; componentId?: string; actor: ActorContext }): Promise<void> {
    const workspaceId = this.scope(params.actor.workspaceId);
    const id = deterministicUuid(`m3-entitlement-line|${workspaceId}|${params.entitlementId}|${params.lineId}|${params.componentId ?? ''}`);
    const result = await this.client().query(
      `INSERT INTO entitlement_line_links (workspace_id, id, entitlement_id, line_id, component_id, created_by_actor_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [workspaceId, id, params.entitlementId, params.lineId, params.componentId ?? null, params.actor.actorPrincipalId],
    );
    this.assertInserted(result.rowCount, `entitlement line link ${id}`);
  }

  async linkEntitlementTraveller(params: { entitlementId: string; travellerId: string; actor: ActorContext }): Promise<void> {
    const workspaceId = this.scope(params.actor.workspaceId);
    const id = deterministicUuid(`m3-entitlement-traveller|${workspaceId}|${params.entitlementId}|${params.travellerId}`);
    const result = await this.client().query(
      `INSERT INTO entitlement_person_links (workspace_id, id, entitlement_id, traveller_id, created_by_actor_id)
       VALUES ($1,$2,$3,$4,$5)`,
      [workspaceId, id, params.entitlementId, params.travellerId, params.actor.actorPrincipalId],
    );
    this.assertInserted(result.rowCount, `entitlement traveller link ${id}`);
  }

  async addEntitlementComponent(params: {
    id: string;
    entitlementId: string;
    componentType: string;
    componentStatus: string;
    exchangedFromComponentId?: string;
    actor: ActorContext;
  }): Promise<void> {
    const workspaceId = this.scope(params.actor.workspaceId);
    const result = await this.client().query(
      `INSERT INTO entitlement_components
         (workspace_id, id, entitlement_id, component_type, component_status, exchanged_from_component_id, created_by_actor_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [workspaceId, params.id, params.entitlementId, params.componentType, params.componentStatus, params.exchangedFromComponentId ?? null, params.actor.actorPrincipalId],
    );
    this.assertInserted(result.rowCount, `entitlement component ${params.id}`);
  }

  async createOffer(params: { offer: Offer; actor: ActorContext }): Promise<void> {
    const workspaceId = this.scope(params.actor.workspaceId);
    const offer = OfferSchema.parse(params.offer);
    const result = await this.client().query(
      `INSERT INTO offers
         (workspace_id, id, account_organisation_id, source_id, price_amount, price_currency, terms,
          quoted_at, expires_at, fingerprint, created_by_actor_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [workspaceId, offer.id, offer.accountId ?? null, offer.sourceId, offer.price.amount, offer.price.currency, offer.terms ? JSON.stringify(offer.terms) : null, offer.quotedAt, offer.expiresAt, offer.fingerprint, params.actor.actorPrincipalId],
    );
    this.assertInserted(result.rowCount, `offer ${offer.id}`);
    if (offer.eligiblePartyRef) {
      if (!offer.eligiblePartyKind) throw new Error('offer eligibility kind is required when eligiblePartyRef is present');
      const eligibilityId = deterministicUuid(`m3-offer-eligibility|${offer.id}|${offer.eligiblePartyKind}|${offer.eligiblePartyRef}`);
      await this.addOfferEligibility({
        id: eligibilityId,
        offerId: offer.id,
        ...(offer.eligiblePartyKind === 'TRAVELLER' ? { travellerId: offer.eligiblePartyRef } : {}),
        ...(offer.eligiblePartyKind === 'ORGANISATION' ? { organisationId: offer.eligiblePartyRef } : {}),
        ...(offer.eligiblePartyKind === 'AGREEMENT_SCOPE' ? { agreementScopeId: offer.eligiblePartyRef } : {}),
        actor: params.actor,
      });
    }
  }

  async addOfferItem(params: { id: string; offerId: string; detail: ReservationLineDetail; amount: ExactMoney; actor: ActorContext }): Promise<void> {
    const workspaceId = this.scope(params.actor.workspaceId);
    const d = params.detail;
    const result = await this.client().query(
      `INSERT INTO offer_items
         (workspace_id, id, offer_id, product_type, transport_service_id, resource_id,
          stay_interval_start, stay_interval_end, place_id, item_amount, item_currency, created_by_actor_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [workspaceId, params.id, params.offerId, d.productType, d.productType === 'TRANSPORT' ? d.transportServiceId : null, d.productType === 'RESOURCE_USE' ? d.resourceId : d.productType === 'STAY' ? d.resourceId ?? null : null, d.productType === 'STAY' ? d.stayInterval?.start ?? null : null, d.productType === 'STAY' ? d.stayInterval?.end ?? null : null, d.productType === 'STAY' || d.productType === 'RESOURCE_USE' ? d.placeId ?? null : null, params.amount.amount, params.amount.currency, params.actor.actorPrincipalId],
    );
    this.assertInserted(result.rowCount, `offer item ${params.id}`);
  }

  async addOfferEligibility(params: { id: string; offerId: string; travellerId?: string; organisationId?: string; agreementScopeId?: string; actor: ActorContext }): Promise<void> {
    const workspaceId = this.scope(params.actor.workspaceId);
    if (!params.travellerId && !params.organisationId && !params.agreementScopeId) throw new Error('offer eligibility must narrow a party or agreement scope');
    const result = await this.client().query(
      `INSERT INTO offer_eligibility
         (workspace_id, id, offer_id, eligible_traveller_id, eligible_organisation_id, agreement_scope_id, created_by_actor_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [workspaceId, params.id, params.offerId, params.travellerId ?? null, params.organisationId ?? null, params.agreementScopeId ?? null, params.actor.actorPrincipalId],
    );
    this.assertInserted(result.rowCount, `offer eligibility ${params.id}`);
  }

  async createCommercialAgreement(params: { agreement: import('../../../domain/v2/arrangements/reservation.ts').CommercialAgreement; actor: ActorContext }): Promise<void> {
    const workspaceId = this.scope(params.actor.workspaceId);
    const agreement = params.agreement;
    const versionId = deterministicUuid(`m3-agreement-version|${workspaceId}|${agreement.id}|1`);
    const publishedAt = agreement.publishedAt;
    if (!publishedAt) throw new Error('commercial agreement requires an explicit initial publishedAt');
    await this.client().query(
      `INSERT INTO commercial_agreements (workspace_id, id, organisation_id, current_version_id, created_by_actor_id)
       VALUES ($1,$2,$3,NULL,$4)`,
      [workspaceId, agreement.id, agreement.organisationId, params.actor.actorPrincipalId],
    );
    await this.client().query(
      `INSERT INTO agreement_versions
         (workspace_id, id, agreement_id, edition_number, published_at, effective_from, effective_until, published_terms, created_by_actor_id)
       VALUES ($1,$2,$3,1,$4,$5,$6,$7,$8)`,
      [workspaceId, versionId, agreement.id, publishedAt, agreement.effectiveWindow?.start ?? null, agreement.effectiveWindow?.end ?? null, JSON.stringify(agreement.publishedTerms), params.actor.actorPrincipalId],
    );
    const result = await this.client().query(
      `UPDATE commercial_agreements SET current_version_id = $3, updated_at = now() WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, agreement.id, versionId],
    );
    this.assertInserted(result.rowCount, `commercial agreement ${agreement.id}`);
  }

  async appendAgreementVersion(params: { id: string; agreementId: string; editionNumber: number; publishedAt: string; effectiveWindow?: { start: string; end: string }; publishedTerms: Record<string, unknown>; actor: ActorContext }): Promise<void> {
    const workspaceId = this.scope(params.actor.workspaceId);
    await this.client().query(
      `INSERT INTO agreement_versions
         (workspace_id, id, agreement_id, edition_number, published_at, effective_from, effective_until, published_terms, created_by_actor_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [workspaceId, params.id, params.agreementId, params.editionNumber, params.publishedAt, params.effectiveWindow?.start ?? null, params.effectiveWindow?.end ?? null, JSON.stringify(params.publishedTerms), params.actor.actorPrincipalId],
    );
    const result = await this.client().query(
      `UPDATE commercial_agreements SET current_version_id = $3, updated_at = now() WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, params.agreementId, params.id],
    );
    this.assertInserted(result.rowCount, `agreement ${params.agreementId} current version`);
  }

  async addAgreementScope(params: { id: string; agreementVersionId: string; eligibleOrganisationId?: string; scopeKind: 'ACCOUNT' | 'NEGOTIATED_RATE' | 'CORPORATE_CODE' | 'OTHER'; scopeReference?: string; validFrom?: string; validUntil?: string; actor: ActorContext }): Promise<void> {
    const workspaceId = this.scope(params.actor.workspaceId);
    const result = await this.client().query(
      `INSERT INTO agreement_scopes
         (workspace_id, id, agreement_version_id, eligible_organisation_id, scope_kind, scope_reference, valid_from, valid_until, created_by_actor_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [workspaceId, params.id, params.agreementVersionId, params.eligibleOrganisationId ?? null, params.scopeKind, params.scopeReference ?? null, params.validFrom ?? null, params.validUntil ?? null, params.actor.actorPrincipalId],
    );
    this.assertInserted(result.rowCount, `agreement scope ${params.id}`);
  }

  async createExternalConnection(params: { connection: ExternalConnectionRecord; actor: ActorContext }): Promise<void> {
    const workspaceId = this.scope(params.actor.workspaceId);
    const c = params.connection;
    const result = await this.client().query(
      `INSERT INTO external_connections
         (workspace_id, id, organisation_id, provider_kind, auth_content_hash, auth_storage_ref, auth_access_policy_id, capability_configuration, created_by_actor_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [workspaceId, c.id, c.organisationId ?? null, c.providerKind, c.authRef?.contentHash ?? null, c.authRef?.storageRef ?? null, c.authRef?.accessPolicyId ?? null, c.capabilityConfiguration ? JSON.stringify(c.capabilityConfiguration) : null, params.actor.actorPrincipalId],
    );
    this.assertInserted(result.rowCount, `external connection ${c.id}`);
  }

  async findExternalRecord(params: { workspaceId: string; connectionId: string; recordType: string; externalId: string }): Promise<{ id: string } | undefined> {
    const workspaceId = this.scope(params.workspaceId);
    const result = await this.client().query<{ id: string }>(
      `SELECT id FROM external_records
        WHERE workspace_id = $1 AND connection_id = $2 AND record_type = $3 AND external_id = $4`,
      [workspaceId, params.connectionId, params.recordType, params.externalId],
    );
    return result.rows[0];
  }

  async loadExternalRecord(params: { workspaceId: string; recordId: string }): Promise<ExternalRecordRecord | undefined> {
    const workspace = this.scope(params.workspaceId);
    const result = await this.client().query<{
      id: string;
      connection_id: string;
      record_type: string;
      external_id: string;
      identity_state: ExternalRecordRecord['identityState'];
      quarantine_reason: string | null;
      source_sequence: string | null;
      source_version: string | null;
      observed_at: Date | null;
      payload_hash: string | null;
    }>(
      `SELECT id, connection_id, record_type, external_id, identity_state,
              quarantine_reason, source_sequence, source_version, observed_at, payload_hash
         FROM external_records WHERE workspace_id = $1 AND id = $2`,
      [workspace, params.recordId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      id: row.id,
      connectionId: row.connection_id,
      recordType: row.record_type,
      externalId: row.external_id,
      identityState: row.identity_state,
      ...(row.quarantine_reason ? { quarantineReason: row.quarantine_reason } : {}),
      ...(row.source_sequence === null ? {} : { sourceSequence: Number(row.source_sequence) }),
      ...(row.source_version ? { sourceVersion: row.source_version } : {}),
      ...(row.observed_at ? { observedAt: row.observed_at.toISOString() } : {}),
      ...(row.payload_hash ? { payloadHash: row.payload_hash } : {}),
    };
  }

  async findLiveCanonicalSubjects(workspaceId: string, externalRecordId: string): Promise<Array<{ kind: import('../../../domain/v2/shared/identity.ts').SubjectKind; id: string }>> {
    const workspace = this.scope(workspaceId);
    const result = await this.client().query<{ canonical_subject_kind: import('../../../domain/v2/shared/identity.ts').SubjectKind; canonical_subject_id: string }>(
      `SELECT canonical_subject_kind, canonical_subject_id
         FROM external_record_links
        WHERE workspace_id = $1 AND external_record_id = $2 AND superseded_at IS NULL
        ORDER BY linked_at, id`,
      [workspace, externalRecordId],
    );
    return result.rows.map((row) => ({ kind: row.canonical_subject_kind, id: row.canonical_subject_id }));
  }

  async createOrObserveExternalRecord(params: { record: ExternalRecordRecord; actor: ActorContext }): Promise<'APPLIED' | 'STALE'> {
    const workspaceId = this.scope(params.actor.workspaceId);
    const r = params.record;
    const existing = await this.client().query<{
      id: string;
      identity_state: string;
      source_sequence: string | null;
      observed_at: Date | null;
    }>(
      `SELECT id, identity_state, source_sequence, observed_at FROM external_records
        WHERE workspace_id = $1 AND connection_id = $2 AND record_type = $3 AND external_id = $4`,
      [workspaceId, r.connectionId, r.recordType, r.externalId],
    );
    const old = existing.rows[0];
    if (old && ((old.source_sequence !== null && r.sourceSequence !== undefined && Number(old.source_sequence) >= r.sourceSequence) || (old.source_sequence === null && old.observed_at && r.observedAt && old.observed_at.getTime() >= Date.parse(r.observedAt)))) return 'STALE';
    if (!old) {
      const result = await this.client().query(
        `INSERT INTO external_records
           (workspace_id, id, connection_id, record_type, external_id, identity_state, quarantine_reason,
            source_sequence, source_version, observed_at, payload_hash, created_by_actor_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [workspaceId, r.id, r.connectionId, r.recordType, r.externalId, r.identityState, r.quarantineReason ?? null, r.sourceSequence ?? null, r.sourceVersion ?? null, r.observedAt ?? null, r.payloadHash ?? null, params.actor.actorPrincipalId],
      );
      this.assertInserted(result.rowCount, `external record ${r.id}`);
      return 'APPLIED';
    }
    let identityState = r.identityState;
    if (old.identity_state === 'LINKED' && identityState !== 'LINKED') {
      const liveLinks = await this.client().query<{ n: string }>(
        `SELECT '1' AS n FROM external_record_links
          WHERE workspace_id = $1 AND external_record_id = $2 AND superseded_at IS NULL
          LIMIT 1`,
        [workspaceId, old.id],
      );
      if (liveLinks.rows[0]) {
        identityState = 'LINKED';
      }
    }
    const result = await this.client().query(
      `UPDATE external_records SET identity_state = $5, quarantine_reason = $6,
         source_sequence = $7, source_version = $8, observed_at = $9, payload_hash = $10, updated_at = now()
       WHERE workspace_id = $1 AND id = $2 AND connection_id = $3 AND record_type = $4`,
      [workspaceId, old.id, r.connectionId, r.recordType, identityState, r.quarantineReason ?? null, r.sourceSequence ?? null, r.sourceVersion ?? null, r.observedAt ?? null, r.payloadHash ?? null],
    );
    this.assertInserted(result.rowCount, `external record observation ${old.id}`);
    return 'APPLIED';
  }

  async linkExternalRecord(params: { link: ExternalRecordLinkRecord; actor: ActorContext }): Promise<void> {
    const workspaceId = this.scope(params.actor.workspaceId);
    const link = params.link;
    const result = await this.client().query(
      `INSERT INTO external_record_links
         (workspace_id, id, external_record_id, canonical_subject_id, canonical_subject_kind, link_kind, evidence_id, linked_at, created_by_actor_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::timestamptz, now()),$9)`,
      [workspaceId, link.id, link.externalRecordId, link.canonicalSubject.id, link.canonicalSubject.kind, link.linkKind, link.evidenceId, link.linkedAt ?? null, params.actor.actorPrincipalId],
    );
    this.assertInserted(result.rowCount, `external record link ${link.id}`);
    const state = await this.client().query(
      `UPDATE external_records SET identity_state = 'LINKED', quarantine_reason = NULL, updated_at = now()
        WHERE workspace_id = $1 AND id = $2 AND identity_state IN ('UNVERIFIED','LINKED')`,
      [workspaceId, link.externalRecordId],
    );
    if (state.rowCount !== 1) {
      const error = new Error(`external record ${link.externalRecordId} is quarantined or missing and cannot be linked` ) as Error & { code: string };
      error.code = 'P0001';
      throw error;
    }
  }

  async createOwnershipBinding(params: { binding: OwnershipBindingRecord; actor: ActorContext }): Promise<void> {
    const workspaceId = this.scope(params.actor.workspaceId);
    const b = params.binding;
    const result = await this.client().query(
      `INSERT INTO ownership_bindings
         (workspace_id, id, subject_id, subject_kind, field_group, owner_kind, connection_id, source_id,
          binding_state, effective_from, effective_until, evidence_id, created_by_actor_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [workspaceId, b.id, b.subject.id, b.subject.kind, b.fieldGroup, b.ownerKind, b.connectionId ?? null, b.sourceId ?? null, b.bindingState, b.effectiveFrom, b.effectiveUntil ?? null, b.evidenceId ?? null, params.actor.actorPrincipalId],
    );
    this.assertInserted(result.rowCount, `ownership binding ${b.id}`);
  }

  async activateOwnershipBinding(params: { bindingId: string; actor: ActorContext }): Promise<void> {
    const workspaceId = this.scope(params.actor.workspaceId);
    await this.client().query(
      `UPDATE ownership_bindings SET binding_state = 'HISTORICAL', effective_until = now()
        WHERE workspace_id = $1 AND field_group = (SELECT field_group FROM ownership_bindings WHERE workspace_id = $1 AND id = $2)
          AND subject_id = (SELECT subject_id FROM ownership_bindings WHERE workspace_id = $1 AND id = $2)
          AND binding_state = 'CURRENT'`,
      [workspaceId, params.bindingId],
    );
    const result = await this.client().query(
      `UPDATE ownership_bindings SET binding_state = 'CURRENT', updated_at = now()
        WHERE workspace_id = $1 AND id = $2 AND binding_state = 'PROPOSED'`,
      [workspaceId, params.bindingId],
    );
    this.assertInserted(result.rowCount, `ownership binding ${params.bindingId} activation`);
  }

  async recordProviderCapability(params: { capability: ProviderCapabilityRecord; actor: ActorContext }): Promise<'APPLIED' | 'STALE'> {
    const workspaceId = this.scope(params.actor.workspaceId);
    const c = params.capability;
    const result = await this.client().query(
      `INSERT INTO provider_capabilities
         (workspace_id, id, connection_id, capability_kind, record_type, supported, provider_details,
          observed_at, observation_evidence_id, created_by_actor_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (workspace_id, connection_id, capability_kind, record_type) DO UPDATE SET
         supported = EXCLUDED.supported, provider_details = EXCLUDED.provider_details,
          observed_at = EXCLUDED.observed_at, observation_evidence_id = EXCLUDED.observation_evidence_id, updated_at = now()
        WHERE provider_capabilities.observed_at < EXCLUDED.observed_at`,
      [workspaceId, c.id, c.connectionId, c.capabilityKind, c.recordType, c.supported, c.providerDetails ? JSON.stringify(c.providerDetails) : null, c.observedAt, c.observationEvidenceId ?? null, params.actor.actorPrincipalId],
    );
    return result.rowCount === 1 ? 'APPLIED' : 'STALE';
  }

  async createAccountingDimension(params: { dimension: AccountingDimensionRecord; actor: ActorContext }): Promise<void> {
    const workspaceId = this.scope(params.actor.workspaceId);
    const d = params.dimension;
    const result = await this.client().query(
      `INSERT INTO accounting_dimensions
         (workspace_id, id, organisation_id, namespace, external_key, display_name, valid_from, valid_until, created_by_actor_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [workspaceId, d.id, d.organisationId, d.namespace, d.externalKey, d.displayName, d.validFrom ?? null, d.validUntil ?? null, params.actor.actorPrincipalId],
    );
    this.assertInserted(result.rowCount, `accounting dimension ${d.id}`);
  }

  async assignAccountingDimension(params: { assignment: AccountingAssignmentRecord; actor: ActorContext }): Promise<void> {
    const workspaceId = this.scope(params.actor.workspaceId);
    const a = params.assignment;
    const result = await this.client().query(
      `INSERT INTO accounting_assignments
         (workspace_id, id, dimension_id, subject_id, subject_kind, allocation_basis, valid_from, valid_until, created_by_actor_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [workspaceId, a.id, a.dimensionId, a.subject.id, a.subject.kind, a.allocationBasis, a.validFrom ?? null, a.validUntil ?? null, params.actor.actorPrincipalId],
    );
    this.assertInserted(result.rowCount, `accounting assignment ${a.id}`);
  }

  async createBudget(params: { budget: BudgetRecord; actor: ActorContext }): Promise<void> {
    const workspaceId = this.scope(params.actor.workspaceId);
    const b = params.budget;
    const result = await this.client().query(
      `INSERT INTO budgets
         (workspace_id, id, organisation_id, purpose, amount, currency, valid_from, valid_until, created_by_actor_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [workspaceId, b.id, b.organisationId, b.purpose, b.amount.amount, b.amount.currency, b.validFrom ?? null, b.validUntil ?? null, params.actor.actorPrincipalId],
    );
    this.assertInserted(result.rowCount, `budget ${b.id}`);
  }

  async createBudgetCommitment(params: { commitment: import('../../../domain/v2/arrangements/reservation.ts').BudgetCommitment; actor: ActorContext }): Promise<void> {
    const workspaceId = this.scope(params.actor.workspaceId);
    const c = params.commitment;
    const result = await this.client().query(
      `INSERT INTO budget_commitments
         (workspace_id, id, budget_id, action_intent_id, amount, currency, status, created_by_actor_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [workspaceId, c.id, c.budgetId, c.actionIntentId, c.amount.amount, c.amount.currency, c.status, params.actor.actorPrincipalId],
    );
    this.assertInserted(result.rowCount, `budget commitment ${c.id}`);
  }

  async addBudgetEntry(params: { workspaceId: string; commitmentId: string; entry: BudgetEntryRecord; actor: ActorContext }): Promise<void> {
    const workspaceId = this.scope(params.workspaceId, params.actor.workspaceId);
    const e = params.entry;
    const result = await this.client().query(
      `INSERT INTO budget_entries
         (workspace_id, id, commitment_id, entry_kind, amount, currency, evidence_id, entry_at, created_by_actor_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::timestamptz, now()),$9)`,
      [workspaceId, e.id, params.commitmentId, e.entryKind, e.amount.amount, e.amount.currency, e.evidenceId ?? null, e.entryAt ?? null, params.actor.actorPrincipalId],
    );
    this.assertInserted(result.rowCount, `budget entry ${e.id}`);
  }

  async createCostAllocation(params: { allocation: CostAllocationRecord; actor: ActorContext }): Promise<void> {
    const workspaceId = this.scope(params.actor.workspaceId);
    const a = params.allocation;
    const result = await this.client().query(
      `INSERT INTO cost_allocations
         (workspace_id, id, reservation_id, action_intent_id, payer_organisation_id, payer_traveller_id,
          entry_kind, amount, currency, fx_observation_id, accounting_dimension_id, evidence_id, occurred_at, created_by_actor_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [workspaceId, a.id, a.reservationId ?? null, a.actionIntentId ?? null, a.payerOrganisationId ?? null, a.payerTravellerId ?? null, a.entryKind, a.amount.amount, a.amount.currency, a.fxObservationId ?? null, a.accountingDimensionId ?? null, a.evidenceId ?? null, a.occurredAt ?? null, params.actor.actorPrincipalId],
    );
    this.assertInserted(result.rowCount, `cost allocation ${a.id}`);
  }

  async recordFxObservation(params: { observation: FxObservation; actor: ActorContext }): Promise<void> {
    const workspaceId = this.scope(params.actor.workspaceId);
    const o = params.observation;
    const result = await this.client().query(
      `INSERT INTO fx_observations
         (workspace_id, id, base_currency, quote_currency, rate, as_of, source_id, edition, expires_at, created_by_actor_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [workspaceId, o.id, o.baseCurrency, o.quoteCurrency, o.rate, o.asOf, o.sourceId, o.id, o.expiresAt ?? null, params.actor.actorPrincipalId],
    );
    this.assertInserted(result.rowCount, `FX observation ${o.id}`);
  }

  // Public aliases make the typed seam easy to use without exposing a generic
  // save method. They are intentionally namespaced by object kind.
  createService = this.createTransportService.bind(this);
  loadService = this.loadTransportService.bind(this);
  createReservationLine = this.addReservationLine.bind(this);
  allocateReservationLine = this.addReservationAllocation.bind(this);
  createExternalRecord = this.createOrObserveExternalRecord.bind(this);
}

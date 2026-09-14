/** PostgreSQL implementation of the typed M3 arrangement reverse lookups. */
import type { Queryable } from '../commandSupport.ts';
import type {
  ArrangementReadQueries,
  CostAllocationHit,
  EntitlementHit,
  ExternalRecordHit,
  FxObservationHit,
  OfferHit,
  ProviderCapabilityHit,
  ReservationAllocationHit,
  ReservationLineHit,
} from '../../../contracts/v2/repository/arrangementQueries.ts';
import type { ProviderCapabilityKind } from '../../../contracts/v2/repository/arrangements.ts';

interface AllocationRow {
  reservation_id: string;
  line_id: string;
  allocation_id: string;
  traveller_id: string;
  journey_item_id: string | null;
  journey_id: string | null;
  trip_id: string | null;
  allocation_role: string;
  quantity: number;
}

interface LineRow {
  reservation_id: string;
  line_id: string;
  product_type: ReservationLineHit['productType'];
  observed_status: string;
  observed_status_at: Date | null;
  transport_service_id: string | null;
  resource_id: string | null;
  interval_start: Date | null;
  interval_end: Date | null;
}

interface OfferRow {
  offer_id: string;
  source_id: string;
  price_amount: string;
  price_currency: string;
  terms: Record<string, unknown> | null;
  quoted_at: Date;
  expires_at: Date;
  fingerprint: string;
  eligible_traveller_ids: string[];
  eligible_organisation_ids: string[];
  eligible_agreement_scope_ids: string[];
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function mapAllocation(row: AllocationRow): ReservationAllocationHit {
  return {
    reservationId: row.reservation_id,
    lineId: row.line_id,
    allocationId: row.allocation_id,
    travellerId: row.traveller_id,
    journeyItemId: row.journey_item_id,
    journeyId: row.journey_id,
    tripId: row.trip_id,
    allocationRole: row.allocation_role,
    quantity: row.quantity,
  };
}

function mapLine(row: LineRow): ReservationLineHit {
  return {
    reservationId: row.reservation_id,
    lineId: row.line_id,
    productType: row.product_type,
    observedStatus: row.observed_status,
    observedStatusAt: iso(row.observed_status_at),
    transportServiceId: row.transport_service_id,
    resourceId: row.resource_id,
    stayInterval:
      row.interval_start && row.interval_end
        ? { start: row.interval_start.toISOString(), end: row.interval_end.toISOString() }
        : null,
  };
}

export class PgArrangementReadQueries implements ArrangementReadQueries {
  private readonly db: Queryable;

  constructor(db: Queryable) {
    this.db = db;
  }

  async allocationsForReservation(workspaceId: string, reservationId: string): Promise<ReservationAllocationHit[]> {
    const result = await this.db.query<AllocationRow>(
      `SELECT a.reservation_id, a.line_id, a.id AS allocation_id, a.traveller_id,
              a.journey_item_id, j.id AS journey_id, t.id AS trip_id,
              a.allocation_role, a.quantity
         FROM reservation_allocations a
         LEFT JOIN journey_items ji
           ON ji.workspace_id = a.workspace_id AND ji.id = a.journey_item_id
         LEFT JOIN journeys j
           ON j.workspace_id = ji.workspace_id AND j.id = ji.journey_id
         LEFT JOIN trips t
           ON t.workspace_id = j.workspace_id AND t.id = j.trip_id
        WHERE a.workspace_id = $1 AND a.reservation_id = $2
        ORDER BY a.line_id, a.traveller_id, a.id`,
      [workspaceId, reservationId],
    );
    return result.rows.map(mapAllocation);
  }

  async linesForReservation(workspaceId: string, reservationId: string): Promise<ReservationLineHit[]> {
    const result = await this.db.query<LineRow>(
      `SELECT l.reservation_id, l.id AS line_id, l.product_type, l.observed_status,
              l.observed_status_at, td.transport_service_id,
              COALESCE(sd.resource_id, rud.resource_id) AS resource_id,
              sd.stay_interval_start AS interval_start, sd.stay_interval_end AS interval_end
         FROM reservation_lines l
         LEFT JOIN transport_line_details td
           ON td.workspace_id = l.workspace_id AND td.line_id = l.id
         LEFT JOIN stay_line_details sd
           ON sd.workspace_id = l.workspace_id AND sd.line_id = l.id
         LEFT JOIN resource_use_line_details rud
           ON rud.workspace_id = l.workspace_id AND rud.line_id = l.id
        WHERE l.workspace_id = $1 AND l.reservation_id = $2
        ORDER BY l.created_at, l.id`,
      [workspaceId, reservationId],
    );
    return result.rows.map(mapLine);
  }

  async linesForTransportService(workspaceId: string, serviceId: string): Promise<ReservationLineHit[]> {
    const result = await this.db.query<LineRow>(
      `SELECT l.reservation_id, l.id AS line_id, l.product_type, l.observed_status,
              l.observed_status_at, td.transport_service_id,
              NULL::uuid AS resource_id, NULL::timestamptz AS interval_start,
              NULL::timestamptz AS interval_end
         FROM transport_line_details td
         JOIN reservation_lines l
           ON l.workspace_id = td.workspace_id AND l.id = td.line_id
        WHERE td.workspace_id = $1 AND td.transport_service_id = $2
        ORDER BY l.reservation_id, l.id`,
      [workspaceId, serviceId],
    );
    return result.rows.map(mapLine);
  }

  async reservationsForTraveller(workspaceId: string, travellerId: string): Promise<string[]> {
    const result = await this.db.query<{ reservation_id: string }>(
      `SELECT DISTINCT a.reservation_id
         FROM reservation_allocations a
        WHERE a.workspace_id = $1 AND a.traveller_id = $2
        ORDER BY a.reservation_id`,
      [workspaceId, travellerId],
    );
    return result.rows.map((row) => row.reservation_id);
  }

  async entitlementsForLine(workspaceId: string, lineId: string): Promise<EntitlementHit[]> {
    const result = await this.db.query<EntitlementHit & {
      entitlement_id: string;
      entitlement_type: EntitlementHit['entitlementType'];
      observed_status: string;
      observed_status_at: Date | null;
      line_id: string | null;
      traveller_id: string | null;
    }>(
      `SELECT e.id AS entitlement_id, e.entitlement_type, e.observed_status,
              e.observed_status_at, l.line_id, p.traveller_id
         FROM entitlement_line_links l
         JOIN service_entitlements e
           ON e.workspace_id = l.workspace_id AND e.id = l.entitlement_id
         LEFT JOIN entitlement_person_links p
           ON p.workspace_id = e.workspace_id AND p.entitlement_id = e.id
        WHERE l.workspace_id = $1 AND l.line_id = $2
        ORDER BY e.id, p.traveller_id NULLS FIRST`,
      [workspaceId, lineId],
    );
    return result.rows.map((row) => ({
      entitlementId: row.entitlement_id,
      entitlementType: row.entitlement_type,
      observedStatus: row.observed_status,
      observedStatusAt: iso(row.observed_status_at),
      lineId: row.line_id,
      travellerId: row.traveller_id,
    }));
  }

  async offersEligibleFor(
    workspaceId: string,
    context: { at: string; travellerId?: string; organisationIds?: string[]; agreementScopeIds?: string[] },
  ): Promise<OfferHit[]> {
    const travellerId = context.travellerId ?? null;
    const organisationIds = context.organisationIds ?? [];
    const agreementScopeIds = context.agreementScopeIds ?? [];
    const result = await this.db.query<OfferRow>(
      `SELECT o.id AS offer_id, o.source_id, o.price_amount::text AS price_amount,
              o.price_currency, o.terms, o.quoted_at, o.expires_at, o.fingerprint,
              COALESCE(array_agg(DISTINCT e.eligible_traveller_id)
                FILTER (WHERE e.eligible_traveller_id IS NOT NULL), ARRAY[]::uuid[]) AS eligible_traveller_ids,
              COALESCE(array_agg(DISTINCT e.eligible_organisation_id)
                FILTER (WHERE e.eligible_organisation_id IS NOT NULL), ARRAY[]::uuid[]) AS eligible_organisation_ids,
              COALESCE(array_agg(DISTINCT e.agreement_scope_id)
                FILTER (WHERE e.agreement_scope_id IS NOT NULL), ARRAY[]::uuid[]) AS eligible_agreement_scope_ids
         FROM offers o
         LEFT JOIN offer_eligibility e
           ON e.workspace_id = o.workspace_id AND e.offer_id = o.id
        WHERE o.workspace_id = $1 AND o.expires_at > $2::timestamptz
          AND (
            e.id IS NULL
            OR e.eligible_traveller_id = $3::uuid
            OR e.eligible_organisation_id = ANY($4::uuid[])
            OR (
              e.agreement_scope_id = ANY($5::uuid[])
              AND EXISTS (
                SELECT 1
                  FROM agreement_scopes s
                  JOIN agreement_versions v
                    ON v.workspace_id = s.workspace_id AND v.id = s.agreement_version_id
                 WHERE s.workspace_id = o.workspace_id
                   AND s.id = e.agreement_scope_id
                   AND (s.valid_from IS NULL OR s.valid_from <= $2::timestamptz)
                   AND (s.valid_until IS NULL OR s.valid_until > $2::timestamptz)
                   AND v.published_at <= $2::timestamptz
                   AND (v.effective_from IS NULL OR v.effective_from <= $2::timestamptz)
                   AND (v.effective_until IS NULL OR v.effective_until > $2::timestamptz)
              )
            )
          )
        GROUP BY o.id, o.source_id, o.price_amount, o.price_currency, o.terms,
                 o.quoted_at, o.expires_at, o.fingerprint
        ORDER BY o.expires_at, o.id`,
      [workspaceId, context.at, travellerId, organisationIds, agreementScopeIds],
    );
    return result.rows.map((row) => ({
      offerId: row.offer_id,
      sourceId: row.source_id,
      price: { amount: row.price_amount, currency: row.price_currency },
      terms: row.terms,
      quotedAt: row.quoted_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      fingerprint: row.fingerprint,
      eligibleTravellerIds: row.eligible_traveller_ids,
      eligibleOrganisationIds: row.eligible_organisation_ids,
      eligibleAgreementScopeIds: row.eligible_agreement_scope_ids,
    }));
  }

  async externalRecordsForSubject(workspaceId: string, subjectId: string, subjectKind: string): Promise<ExternalRecordHit[]> {
    const result = await this.db.query<ExternalRecordHit & {
      record_id: string;
      connection_id: string;
      record_type: string;
      external_id: string;
      identity_state: ExternalRecordHit['identityState'];
      quarantine_reason: string | null;
      observed_at: Date | null;
      canonical_subject_id: string | null;
      canonical_subject_kind: string | null;
    }>(
      `SELECT r.id AS record_id, r.connection_id, r.record_type, r.external_id,
              r.identity_state, r.quarantine_reason, r.observed_at,
              l.canonical_subject_id, l.canonical_subject_kind
         FROM external_record_links l
         JOIN external_records r
           ON r.workspace_id = l.workspace_id AND r.id = l.external_record_id
        WHERE l.workspace_id = $1 AND l.canonical_subject_id = $2
          AND l.canonical_subject_kind = $3
          AND l.superseded_at IS NULL
        ORDER BY r.id, l.linked_at DESC`,
      [workspaceId, subjectId, subjectKind],
    );
    return result.rows.map((row) => ({
      recordId: row.record_id,
      connectionId: row.connection_id,
      recordType: row.record_type,
      externalId: row.external_id,
      identityState: row.identity_state,
      quarantineReason: row.quarantine_reason,
      observedAt: iso(row.observed_at),
      canonicalSubjectId: row.canonical_subject_id,
      canonicalSubjectKind: row.canonical_subject_kind,
    }));
  }

  async quarantinedExternalRecords(workspaceId: string, connectionId?: string): Promise<ExternalRecordHit[]> {
    const result = await this.db.query<{
      record_id: string;
      connection_id: string;
      record_type: string;
      external_id: string;
      identity_state: ExternalRecordHit['identityState'];
      quarantine_reason: string | null;
      observed_at: Date | null;
    }>(
      `SELECT r.id AS record_id, r.connection_id, r.record_type, r.external_id,
              r.identity_state, r.quarantine_reason, r.observed_at
         FROM external_records r
        WHERE r.workspace_id = $1
          AND r.identity_state IN ('QUARANTINED_UNKNOWN', 'QUARANTINED_AMBIGUOUS')
          AND ($2::uuid IS NULL OR r.connection_id = $2::uuid)
        ORDER BY r.observed_at NULLS FIRST, r.id`,
      [workspaceId, connectionId ?? null],
    );
    return result.rows.map((row) => ({
      recordId: row.record_id,
      connectionId: row.connection_id,
      recordType: row.record_type,
      externalId: row.external_id,
      identityState: row.identity_state,
      quarantineReason: row.quarantine_reason,
      observedAt: iso(row.observed_at),
      canonicalSubjectId: null,
      canonicalSubjectKind: null,
    }));
  }

  async providerCapability(
    workspaceId: string,
    connectionId: string,
    capabilityKind: ProviderCapabilityKind,
    recordType: string,
  ): Promise<ProviderCapabilityHit | undefined> {
    const result = await this.db.query<{
      connection_id: string;
      capability_kind: ProviderCapabilityKind;
      record_type: string;
      supported: boolean;
      provider_details: Record<string, unknown> | null;
      observed_at: Date;
      observation_evidence_id: string | null;
    }>(
      `SELECT connection_id, capability_kind, record_type, supported, provider_details,
              observed_at, observation_evidence_id
         FROM provider_capabilities
        WHERE workspace_id = $1 AND connection_id = $2
          AND capability_kind = $3 AND record_type = $4`,
      [workspaceId, connectionId, capabilityKind, recordType],
    );
    const row = result.rows[0];
    return row
      ? {
          connectionId: row.connection_id,
          capabilityKind: row.capability_kind,
          recordType: row.record_type,
          supported: row.supported,
          providerDetails: row.provider_details,
          observedAt: row.observed_at.toISOString(),
          observationEvidenceId: row.observation_evidence_id,
        }
      : undefined;
  }

  async costAllocationsForReservation(workspaceId: string, reservationId: string): Promise<CostAllocationHit[]> {
    const result = await this.db.query<{
      allocation_id: string;
      reservation_id: string | null;
      entry_kind: CostAllocationHit['entryKind'];
      amount: string;
      currency: string;
      fx_observation_id: string | null;
      evidence_id: string | null;
      occurred_at: Date | null;
    }>(
      `SELECT id AS allocation_id, reservation_id, entry_kind, amount::text AS amount,
              currency, fx_observation_id, evidence_id, occurred_at
         FROM cost_allocations
        WHERE workspace_id = $1 AND reservation_id = $2
        ORDER BY occurred_at NULLS FIRST, id`,
      [workspaceId, reservationId],
    );
    return result.rows.map((row) => ({
      allocationId: row.allocation_id,
      reservationId: row.reservation_id,
      entryKind: row.entry_kind,
      amount: { amount: row.amount, currency: row.currency },
      fxObservationId: row.fx_observation_id,
      evidenceId: row.evidence_id,
      occurredAt: iso(row.occurred_at),
    }));
  }

  async fxObservationsForPair(workspaceId: string, baseCurrency: string, quoteCurrency: string, at?: string): Promise<FxObservationHit[]> {
    const result = await this.db.query<{
      observation_id: string;
      base_currency: string;
      quote_currency: string;
      rate: string;
      as_of: Date;
      source_id: string;
      edition: string;
      expires_at: Date | null;
    }>(
      `SELECT id AS observation_id, base_currency, quote_currency, rate::text AS rate,
              as_of, source_id, edition, expires_at
         FROM fx_observations
        WHERE workspace_id = $1 AND base_currency = $2 AND quote_currency = $3
          AND ($4::timestamptz IS NULL OR as_of <= $4::timestamptz)
          AND ($4::timestamptz IS NULL OR expires_at IS NULL OR expires_at > $4::timestamptz)
        ORDER BY as_of DESC, id`,
      [workspaceId, baseCurrency, quoteCurrency, at ?? null],
    );
    return result.rows.map((row) => ({
      observationId: row.observation_id,
      baseCurrency: row.base_currency,
      quoteCurrency: row.quote_currency,
      rate: row.rate,
      asOf: row.as_of.toISOString(),
      sourceId: row.source_id,
      edition: row.edition,
      expiresAt: iso(row.expires_at),
    }));
  }
}

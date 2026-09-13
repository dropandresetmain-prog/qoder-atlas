/**
 * PostgreSQL implementation of the frozen `JourneyRepository` port
 * (src/contracts/v2/repository/travel.ts) over `journeys` (0021),
 * `journey_items` + the four kind-detail tables (0022/0023),
 * `intended_visits` (0024) and `credential_selections` +
 * `credential_selection_visits` (0025).
 *
 * Scope of this class (M2 division of labour): typed-row SQL only. Each
 * statement runs on the client installed by `PgUnitOfWork.execute` and is
 * workspace-scoped; nothing here calls `uow.execute`, registers a
 * `domain_subjects`/`aggregate_heads` pair or writes `change_records`/`outbox` —
 * identity registration (`createRoot` / `registerChildSubject`), the head
 * advance and the audit fan-out belong to `commands/travelCommands.ts`.
 *
 * Three properties the database, not this file, guarantees:
 *  - one Journey per (Trip, Traveller): `journeys_per_traveller_per_trip_uidx`;
 *  - exactly one kind-matching detail row per item: 0023's discriminating
 *    composite FK plus its deferred "exactly one" assertion, so an item write
 *    here always pairs the parent row with its one detail row;
 *  - a credential selection belongs to the Journey's own Traveller and scopes
 *    at least one of that Journey's intended visits: 0025's deferred assertion.
 */
import type { PoolClient } from 'pg';
import type {
  JourneyItemDetailByKind,
  JourneyRepository,
  NewCredentialSelection,
  NewJourney,
  OptionalWindow,
} from '../../../contracts/v2/repository/travel.ts';
import type { ActorContext } from '../../../contracts/v2/repository/people.ts';
import {
  CredentialSelectionSchema,
  IntendedVisitSchema,
  JourneyItemSchema,
  JourneySchema,
  type CredentialSelection,
  type IntendedVisit,
  type Journey,
  type JourneyItem,
  type JourneyItemLifecycle,
  type LifecycleStatus,
} from '../../../domain/v2/trip/trip.ts';
import { currentTransactionClient } from '../transactionContext.ts';

interface JourneyRow {
  id: string;
  trip_id: string;
  traveller_id: string;
  lifecycle_status: string;
  intended_window_start: Date | null;
  intended_window_end: Date | null;
  responsibility_organisation_id: string | null;
  revision: string;
}

interface JourneyItemRow {
  id: string;
  journey_id: string;
  kind: string;
  order_key: string;
  lifecycle_status: string;
  flexible: boolean;
  intended_window_start: Date | null;
  intended_window_end: Date | null;
  desired_origin_place_id: string | null;
  desired_destination_place_id: string | null;
  selected_service_id: string | null;
  intended_place_id: string | null;
  required_nights: number | null;
  occupancy_needs: Record<string, unknown> | null;
  participation_id: string | null;
  standalone_title: string | null;
  standalone_window_start: Date | null;
  standalone_window_end: Date | null;
  resource_id: string | null;
  intended_location_place_id: string | null;
  use_requirements: Record<string, unknown> | null;
}

interface IntendedVisitRow {
  id: string;
  journey_id: string;
  jurisdiction_id: string;
  purpose: string;
  intended_start: Date;
  intended_end: Date;
  transit_intent: boolean;
}

interface CredentialSelectionRow {
  id: string;
  journey_id: string;
  credential_id: string;
  credential_version_id: string;
  selected_by_command_id: string;
  scope_intended_visit_ids: string[] | null;
}

/**
 * Closed map from the contract's `JourneyItemDetailByKind` keys to 0023's
 * tables. Every value is a literal declared here, so the table name that reaches
 * a statement is never caller-controlled.
 */
type DetailTableByKind = { [K in keyof JourneyItemDetailByKind]: string };

const DETAIL_TABLE_BY_KIND: DetailTableByKind = {
  TRANSPORT: 'transport_item_details',
  STAY: 'stay_item_details',
  ENGAGEMENT: 'engagement_item_details',
  RESOURCE_USE: 'resource_use_item_details',
};

const JOURNEY_SELECT = `
  SELECT j.id,
         j.trip_id,
         j.traveller_id,
         j.lifecycle_status,
         j.intended_window_start,
         j.intended_window_end,
         j.responsibility_organisation_id,
         h.revision
    FROM journeys j
    JOIN aggregate_heads h
      ON h.workspace_id = j.workspace_id AND h.aggregate_id = j.id`;

const JOURNEY_ITEM_SELECT = `
  SELECT i.id,
         i.journey_id,
         i.kind,
         i.order_key,
         i.lifecycle_status,
         i.flexible,
         i.intended_window_start,
         i.intended_window_end,
         tr.desired_origin_place_id,
         tr.desired_destination_place_id,
         tr.selected_service_id,
         st.intended_place_id,
         st.required_nights,
         st.occupancy_needs,
         en.participation_id,
         en.standalone_title,
         en.standalone_window_start,
         en.standalone_window_end,
         ru.resource_id,
         ru.intended_location_place_id,
         ru.use_requirements
    FROM journey_items i
    LEFT JOIN transport_item_details tr
      ON tr.workspace_id = i.workspace_id AND tr.journey_item_id = i.id
    LEFT JOIN stay_item_details st
      ON st.workspace_id = i.workspace_id AND st.journey_item_id = i.id
    LEFT JOIN engagement_item_details en
      ON en.workspace_id = i.workspace_id AND en.journey_item_id = i.id
    LEFT JOIN resource_use_item_details ru
      ON ru.workspace_id = i.workspace_id AND ru.journey_item_id = i.id`;

function required<T>(value: T | null, column: string): T {
  if (value === null || value === undefined) {
    throw new Error(`journey item detail column ${column} is null; 0023 requires it for its kind`);
  }
  return value;
}

function windowField(start: Date | null, end: Date | null): { intendedWindow?: { start: string; end: string } } {
  if (!start || !end) return {};
  return { intendedWindow: { start: start.toISOString(), end: end.toISOString() } };
}

function toJourney(workspaceId: string, journeyId: string, row: JourneyRow): Journey {
  return JourneySchema.parse({
    id: journeyId,
    workspaceId,
    revision: Number(row.revision),
    tripId: row.trip_id,
    travellerId: row.traveller_id,
    lifecycleStatus: row.lifecycle_status,
    ...windowField(row.intended_window_start, row.intended_window_end),
    ...(row.responsibility_organisation_id
      ? { responsibilityOrganisationId: row.responsibility_organisation_id }
      : {}),
  });
}

function toJourneyItem(journeyItemId: string, row: JourneyItemRow): JourneyItem {
  return JourneyItemSchema.parse({
    id: journeyItemId,
    journeyId: row.journey_id,
    kind: row.kind,
    orderKey: row.order_key,
    lifecycleStatus: row.lifecycle_status,
    flexible: row.flexible,
    ...windowField(row.intended_window_start, row.intended_window_end),
    ...(row.kind === 'TRANSPORT'
      ? {
          desiredOriginPlaceId: required(row.desired_origin_place_id, 'desired_origin_place_id'),
          desiredDestinationPlaceId: required(row.desired_destination_place_id, 'desired_destination_place_id'),
          ...(row.selected_service_id ? { selectedServiceId: row.selected_service_id } : {}),
        }
      : {}),
    ...(row.kind === 'STAY'
      ? {
          intendedPlaceId: required(row.intended_place_id, 'intended_place_id'),
          requiredNights: required(row.required_nights, 'required_nights'),
          ...(row.occupancy_needs ? { occupancyNeeds: row.occupancy_needs } : {}),
        }
      : {}),
    ...(row.kind === 'ENGAGEMENT'
      ? {
          ...(row.participation_id ? { participationId: row.participation_id } : {}),
          ...(row.standalone_title ? { standaloneTitle: row.standalone_title } : {}),
          ...(row.standalone_window_start && row.standalone_window_end
            ? {
                standaloneWindow: {
                  start: row.standalone_window_start.toISOString(),
                  end: row.standalone_window_end.toISOString(),
                },
              }
            : {}),
        }
      : {}),
    ...(row.kind === 'RESOURCE_USE'
      ? {
          ...(row.resource_id ? { resourceId: row.resource_id } : {}),
          ...(row.intended_location_place_id ? { intendedLocationPlaceId: row.intended_location_place_id } : {}),
          ...(row.use_requirements ? { useRequirements: row.use_requirements } : {}),
        }
      : {}),
  });
}

function toIntendedVisit(row: IntendedVisitRow): IntendedVisit {
  return IntendedVisitSchema.parse({
    id: row.id,
    journeyId: row.journey_id,
    jurisdictionId: row.jurisdiction_id,
    purpose: row.purpose,
    intendedDates: { start: row.intended_start.toISOString(), end: row.intended_end.toISOString() },
    transitIntent: row.transit_intent,
  });
}

export class PgJourneyRepository implements JourneyRepository {
  private client(): PoolClient {
    return currentTransactionClient();
  }

  async create(params: NewJourney): Promise<void> {
    const { journey, actor } = params;
    const result = await this.client().query(
      `INSERT INTO journeys
         (workspace_id, id, trip_id, traveller_id, lifecycle_status,
          intended_window_start, intended_window_end, responsibility_organisation_id,
          created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        journey.workspaceId,
        journey.id,
        journey.tripId,
        journey.travellerId,
        journey.lifecycleStatus,
        journey.intendedWindow?.start ?? null,
        journey.intendedWindow?.end ?? null,
        journey.responsibilityOrganisationId ?? null,
        actor.actorPrincipalId,
      ],
    );
    if (result.rowCount !== 1) {
      throw new Error(`journey ${journey.id} was not inserted`);
    }
    for (const item of params.items ?? []) {
      await this.insertItemRows(journey.workspaceId, item, actor.actorPrincipalId);
    }
    for (const visit of params.intendedVisits ?? []) {
      await this.insertIntendedVisitRow(journey.workspaceId, visit, actor.actorPrincipalId);
    }
  }

  async load(workspaceId: string, journeyId: string): Promise<Journey | undefined> {
    const result = await this.client().query<JourneyRow>(
      `${JOURNEY_SELECT} WHERE j.workspace_id = $1 AND j.id = $2`,
      [workspaceId, journeyId],
    );
    const row = result.rows[0];
    return row ? toJourney(workspaceId, journeyId, row) : undefined;
  }

  async listForTrip(workspaceId: string, tripId: string): Promise<Journey[]> {
    const result = await this.client().query<JourneyRow>(
      `${JOURNEY_SELECT}
        WHERE j.workspace_id = $1 AND j.trip_id = $2
        ORDER BY j.created_at, j.id`,
      [workspaceId, tripId],
    );
    return result.rows.map((row) => toJourney(workspaceId, row.id, row));
  }

  async listForTraveller(workspaceId: string, travellerId: string): Promise<Journey[]> {
    const result = await this.client().query<JourneyRow>(
      `${JOURNEY_SELECT}
        WHERE j.workspace_id = $1 AND j.traveller_id = $2
        ORDER BY j.created_at, j.id`,
      [workspaceId, travellerId],
    );
    return result.rows.map((row) => toJourney(workspaceId, row.id, row));
  }

  async updateDetails(params: {
    workspaceId: string;
    journeyId: string;
    intendedWindow?: OptionalWindow | undefined;
    responsibilityOrganisationId?: string | null;
    lifecycleStatus?: LifecycleStatus;
    actor: ActorContext;
  }): Promise<void> {
    const responsibilityProvided = params.responsibilityOrganisationId !== undefined;
    const result = await this.client().query(
      `UPDATE journeys SET
         intended_window_start = CASE WHEN $3::timestamptz IS NULL THEN intended_window_start ELSE $3::timestamptz END,
         intended_window_end = CASE WHEN $4::timestamptz IS NULL THEN intended_window_end ELSE $4::timestamptz END,
         responsibility_organisation_id = CASE WHEN $5 THEN $6::uuid ELSE responsibility_organisation_id END,
         lifecycle_status = CASE WHEN $7::text IS NULL THEN lifecycle_status ELSE $7::text END,
         updated_at = now()
       WHERE workspace_id = $1 AND id = $2`,
      [
        params.workspaceId,
        params.journeyId,
        params.intendedWindow?.start ?? null,
        params.intendedWindow?.end ?? null,
        responsibilityProvided,
        params.responsibilityOrganisationId ?? null,
        params.lifecycleStatus ?? null,
      ],
    );
    if (result.rowCount !== 1) {
      throw new Error(`journey ${params.journeyId} not found in workspace ${params.workspaceId}`);
    }
  }

  async addItem(params: { journeyId: string; item: JourneyItem; actor: ActorContext }): Promise<void> {
    await this.insertItemRows(params.actor.workspaceId, params.item, params.actor.actorPrincipalId);
  }

  async loadItem(workspaceId: string, journeyItemId: string): Promise<JourneyItem | undefined> {
    const result = await this.client().query<JourneyItemRow>(
      `${JOURNEY_ITEM_SELECT} WHERE i.workspace_id = $1 AND i.id = $2`,
      [workspaceId, journeyItemId],
    );
    const row = result.rows[0];
    return row ? toJourneyItem(journeyItemId, row) : undefined;
  }

  async listItems(workspaceId: string, journeyId: string): Promise<JourneyItem[]> {
    const result = await this.client().query<JourneyItemRow>(
      `${JOURNEY_ITEM_SELECT}
        WHERE i.workspace_id = $1 AND i.journey_id = $2
        ORDER BY i.order_key, i.id`,
      [workspaceId, journeyId],
    );
    return result.rows.map((row) => toJourneyItem(row.id, row));
  }

  async updateItem(params: {
    workspaceId: string;
    journeyId: string;
    journeyItemId: string;
    orderKey?: string;
    lifecycleStatus?: JourneyItemLifecycle;
    flexible?: boolean;
    intendedWindow?: OptionalWindow | undefined;
    actor: ActorContext;
  }): Promise<void> {
    // `order_key` is text while `id`/`journey_id` are uuid: a COALESCE that
    // mixes the two would be a PostgreSQL type error, so every default is
    // computed in JavaScript and each column gets its own typed placeholder.
    const result = await this.client().query(
      `UPDATE journey_items SET
         order_key = CASE WHEN $4::text IS NULL THEN order_key ELSE $4::text END,
         lifecycle_status = CASE WHEN $5::text IS NULL THEN lifecycle_status ELSE $5::text END,
         flexible = COALESCE($6::boolean, flexible),
         intended_window_start = CASE WHEN $7::timestamptz IS NULL THEN intended_window_start ELSE $7::timestamptz END,
         intended_window_end = CASE WHEN $8::timestamptz IS NULL THEN intended_window_end ELSE $8::timestamptz END,
         updated_at = now()
       WHERE workspace_id = $1 AND id = $2 AND journey_id = $3`,
      [
        params.workspaceId,
        params.journeyItemId,
        params.journeyId,
        params.orderKey ?? null,
        params.lifecycleStatus ?? null,
        params.flexible ?? null,
        params.intendedWindow?.start ?? null,
        params.intendedWindow?.end ?? null,
      ],
    );
    if (result.rowCount !== 1) {
      throw new Error(
        `journey item ${params.journeyItemId} not found under journey ${params.journeyId} in workspace ${params.workspaceId}`,
      );
    }
  }

  async addIntendedVisit(params: { visit: IntendedVisit; actor: ActorContext }): Promise<void> {
    await this.insertIntendedVisitRow(params.actor.workspaceId, params.visit, params.actor.actorPrincipalId);
  }

  async listIntendedVisits(workspaceId: string, journeyId: string): Promise<IntendedVisit[]> {
    const result = await this.client().query<IntendedVisitRow>(
      `SELECT id, journey_id, jurisdiction_id, purpose, intended_start, intended_end, transit_intent
         FROM intended_visits
        WHERE workspace_id = $1 AND journey_id = $2
        ORDER BY intended_start, id`,
      [workspaceId, journeyId],
    );
    return result.rows.map(toIntendedVisit);
  }

  async selectCredential(params: NewCredentialSelection): Promise<void> {
    const { selection, receipt, actor } = params;
    const client = this.client();
    const upserted = await client.query<{ id: string }>(
      `INSERT INTO credential_selections
         (workspace_id, id, journey_id, credential_id, credential_version_id,
          selected_by_command_id, selected_by_command_namespace, selected_by_idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       -- One credential is claimed once per Journey: re-selecting re-pins this
       -- row's edition instead of creating a second parallel claim (0025 uidx).
       ON CONFLICT (workspace_id, journey_id, credential_id) DO UPDATE SET
         credential_version_id = EXCLUDED.credential_version_id,
         selected_by_command_id = EXCLUDED.selected_by_command_id,
         selected_by_command_namespace = EXCLUDED.selected_by_command_namespace,
         selected_by_idempotency_key = EXCLUDED.selected_by_idempotency_key
       RETURNING id`,
      [
        actor.workspaceId,
        selection.id,
        selection.journeyId,
        selection.credentialId,
        selection.credentialVersionId,
        selection.selectedByCommandId,
        receipt.commandNamespace,
        receipt.idempotencyKey,
      ],
    );
    const persistedId = upserted.rows[0]?.id;
    if (!persistedId) {
      throw new Error(`credential selection ${selection.id} was not persisted`);
    }
    // The scope set is an association table, so it is replaced wholesale: a
    // re-selection can narrow or widen the visits it covers, never accumulate.
    await client.query('DELETE FROM credential_selection_visits WHERE workspace_id = $1 AND selection_id = $2', [
      actor.workspaceId,
      persistedId,
    ]);
    for (const visitId of selection.scopeIntendedVisitIds) {
      await client.query(
        `INSERT INTO credential_selection_visits (workspace_id, selection_id, intended_visit_id)
         VALUES ($1, $2, $3)`,
        [actor.workspaceId, persistedId, visitId],
      );
    }
  }

  async listCredentialSelections(workspaceId: string, journeyId: string): Promise<CredentialSelection[]> {
    const result = await this.client().query<CredentialSelectionRow>(
      `SELECT s.id, s.journey_id, s.credential_id, s.credential_version_id, s.selected_by_command_id,
              COALESCE(
                array_agg(v.intended_visit_id ORDER BY v.intended_visit_id)
                  FILTER (WHERE v.intended_visit_id IS NOT NULL),
                '{}'::uuid[]
              ) AS scope_intended_visit_ids
         FROM credential_selections s
         LEFT JOIN credential_selection_visits v
           ON v.workspace_id = s.workspace_id AND v.selection_id = s.id
        WHERE s.workspace_id = $1 AND s.journey_id = $2
        GROUP BY s.workspace_id, s.id, s.journey_id, s.credential_id, s.credential_version_id, s.selected_by_command_id
        ORDER BY s.created_at, s.id`,
      [workspaceId, journeyId],
    );
    return result.rows.map((row) =>
      CredentialSelectionSchema.parse({
        id: row.id,
        journeyId: row.journey_id,
        credentialId: row.credential_id,
        credentialVersionId: row.credential_version_id,
        scopeIntendedVisitIds: row.scope_intended_visit_ids ?? [],
        selectedByCommandId: row.selected_by_command_id,
      }),
    );
  }

  async removeCredentialSelection(params: {
    workspaceId: string;
    journeyId: string;
    credentialId: string;
    actor: ActorContext;
  }): Promise<void> {
    const result = await this.client().query(
      `DELETE FROM credential_selections
        WHERE workspace_id = $1 AND journey_id = $2 AND credential_id = $3`,
      [params.workspaceId, params.journeyId, params.credentialId],
    );
    if (result.rowCount === 0) {
      throw new Error(
        `no credential selection for credential ${params.credentialId} on journey ${params.journeyId}`,
      );
    }
  }

  // --- handler-support reads -------------------------------------------------
  // Read-only lookups a command handler needs *before* it mutates, so a rejected
  // claim is a typed conflict rather than a COMMIT abort. Each crosses into a
  // table another M2 lane owns for reading only, and only because F06's
  // ownership rule is a business rule this Journey write must respect.

  /** Owning Traveller plus current edition of a Traveller-owned credential (0014). */
  async credentialOwner(
    workspaceId: string,
    credentialId: string,
  ): Promise<{ travellerId: string; currentVersionId: string | null } | undefined> {
    const result = await this.client().query<{ traveller_id: string; current_version_id: string | null }>(
      `SELECT traveller_id, current_version_id FROM travel_credentials WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, credentialId],
    );
    const row = result.rows[0];
    return row ? { travellerId: row.traveller_id, currentVersionId: row.current_version_id } : undefined;
  }

  /** Which credential an edition belongs to (0014) — 0025's rule 1. */
  async credentialVersionOwner(workspaceId: string, versionId: string): Promise<string | undefined> {
    const result = await this.client().query<{ credential_id: string }>(
      `SELECT credential_id FROM credential_versions WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, versionId],
    );
    return result.rows[0]?.credential_id;
  }

  /** Journey count for a Trip excluding cancelled participants (0021's F03 rule). */
  async nonCancelledCountForTrip(workspaceId: string, tripId: string): Promise<number> {
    const result = await this.client().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM journeys
        WHERE workspace_id = $1 AND trip_id = $2 AND lifecycle_status <> 'CANCELLED'`,
      [workspaceId, tripId],
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  // --- private row writers ---------------------------------------------------

  /**
   * Parent row plus exactly one kind-detail row (0023). The child's
   * `domain_subjects` registration is the handler's job; the deferred subtype
   * checker is what makes forgetting it impossible to commit.
   */
  private async insertItemRows(workspaceId: string, item: JourneyItem, actorId: string): Promise<void> {
    const client = this.client();
    await client.query(
      `INSERT INTO journey_items
         (workspace_id, id, journey_id, kind, order_key, lifecycle_status, flexible,
          intended_window_start, intended_window_end, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        workspaceId,
        item.id,
        item.journeyId,
        item.kind,
        item.orderKey,
        item.lifecycleStatus,
        item.flexible,
        item.intendedWindow?.start ?? null,
        item.intendedWindow?.end ?? null,
        actorId,
      ],
    );
    await this.insertDetailRow(workspaceId, item);
  }

  private async insertDetailRow(workspaceId: string, item: JourneyItem): Promise<void> {
    const client = this.client();
    switch (item.kind) {
      case 'TRANSPORT': {
        const detail: JourneyItemDetailByKind['TRANSPORT'] = item;
        await client.query(
          `INSERT INTO ${DETAIL_TABLE_BY_KIND.TRANSPORT}
             (workspace_id, journey_item_id, kind, desired_origin_place_id, desired_destination_place_id, selected_service_id)
           VALUES ($1, $2, 'TRANSPORT', $3, $4, $5)`,
          [
            workspaceId,
            detail.id,
            detail.desiredOriginPlaceId,
            detail.desiredDestinationPlaceId,
            detail.selectedServiceId ?? null,
          ],
        );
        return;
      }
      case 'STAY': {
        const detail: JourneyItemDetailByKind['STAY'] = item;
        await client.query(
          `INSERT INTO ${DETAIL_TABLE_BY_KIND.STAY}
             (workspace_id, journey_item_id, kind, intended_place_id, required_nights, occupancy_needs)
           VALUES ($1, $2, 'STAY', $3, $4, $5)`,
          [
            workspaceId,
            detail.id,
            detail.intendedPlaceId,
            detail.requiredNights,
            detail.occupancyNeeds === undefined ? null : JSON.stringify(detail.occupancyNeeds),
          ],
        );
        return;
      }
      case 'ENGAGEMENT': {
        const detail: JourneyItemDetailByKind['ENGAGEMENT'] = item;
        await client.query(
          `INSERT INTO ${DETAIL_TABLE_BY_KIND.ENGAGEMENT}
             (workspace_id, journey_item_id, kind, participation_id, standalone_title,
              standalone_window_start, standalone_window_end)
           VALUES ($1, $2, 'ENGAGEMENT', $3, $4, $5, $6)`,
          [
            workspaceId,
            detail.id,
            detail.participationId ?? null,
            detail.standaloneTitle ?? null,
            detail.standaloneWindow?.start ?? null,
            detail.standaloneWindow?.end ?? null,
          ],
        );
        return;
      }
      case 'RESOURCE_USE': {
        const detail: JourneyItemDetailByKind['RESOURCE_USE'] = item;
        await client.query(
          `INSERT INTO ${DETAIL_TABLE_BY_KIND.RESOURCE_USE}
             (workspace_id, journey_item_id, kind, resource_id, intended_location_place_id, use_requirements)
           VALUES ($1, $2, 'RESOURCE_USE', $3, $4, $5)`,
          [
            workspaceId,
            detail.id,
            detail.resourceId ?? null,
            detail.intendedLocationPlaceId ?? null,
            detail.useRequirements === undefined ? null : JSON.stringify(detail.useRequirements),
          ],
        );
        return;
      }
      default: {
        const unsupported: never = item;
        throw new Error(`unsupported journey item kind: ${JSON.stringify(unsupported)}`);
      }
    }
  }

  private async insertIntendedVisitRow(workspaceId: string, visit: IntendedVisit, actorId: string): Promise<void> {
    const result = await this.client().query(
      `INSERT INTO intended_visits
         (workspace_id, id, journey_id, jurisdiction_id, purpose,
          intended_start, intended_end, transit_intent, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        workspaceId,
        visit.id,
        visit.journeyId,
        visit.jurisdictionId,
        visit.purpose,
        visit.intendedDates.start,
        visit.intendedDates.end,
        visit.transitIntent,
        actorId,
      ],
    );
    if (result.rowCount !== 1) {
      throw new Error(`intended visit ${visit.id} was not inserted`);
    }
  }
}

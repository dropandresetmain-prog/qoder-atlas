/**
 * PostgreSQL implementation of the frozen `TripRepository` port
 * (src/contracts/v2/repository/travel.ts) over `trips` (migration 0020).
 *
 * Deliberately narrow, per the M2 division of labour: this class is *typed-row
 * SQL only*. Every statement runs on the transaction client installed by
 * `PgUnitOfWork.execute`, every statement is workspace-scoped, and nothing here
 * touches `aggregate_heads`, `change_records` or `outbox`. Identity
 * registration and the revision counter belong to the command handler in
 * `commands/travelCommands.ts`, so a repository method can never silently
 * advance a head (the port's own doc comment requires that).
 *
 * Revision is read back from `aggregate_heads` because `trips` has no version
 * column: §1 makes the head the single current-revision counter for the root.
 */
import type { PoolClient } from 'pg';
import type { OptionalWindow, TripRepository } from '../../../contracts/v2/repository/travel.ts';
import type { ActorContext } from '../../../contracts/v2/repository/people.ts';
import { TripSchema, type LifecycleStatus, type Trip } from '../../../domain/v2/trip/trip.ts';
import { currentTransactionClient } from '../transactionContext.ts';

interface TripRow {
  purpose: string;
  lifecycle_status: string;
  intended_window_start: Date | null;
  intended_window_end: Date | null;
  business_context_organisation_id: string | null;
  revision: string;
}

/** `aggregate_heads.revision` is a bigint; node-postgres returns it as a string. */
const TRIP_SELECT = `
  SELECT t.purpose,
         t.lifecycle_status,
         t.intended_window_start,
         t.intended_window_end,
         t.business_context_organisation_id,
         h.revision
    FROM trips t
    JOIN aggregate_heads h
      ON h.workspace_id = t.workspace_id AND h.aggregate_id = t.id`;

function toTrip(workspaceId: string, tripId: string, row: TripRow): Trip {
  return TripSchema.parse({
    id: tripId,
    workspaceId,
    revision: Number(row.revision),
    purpose: row.purpose,
    lifecycleStatus: row.lifecycle_status,
    ...(row.intended_window_start && row.intended_window_end
      ? {
          intendedWindow: {
            start: row.intended_window_start.toISOString(),
            end: row.intended_window_end.toISOString(),
          },
        }
      : {}),
    ...(row.business_context_organisation_id
      ? { businessContextOrganisationId: row.business_context_organisation_id }
      : {}),
  });
}

export class PgTripRepository implements TripRepository {
  private client(): PoolClient {
    return currentTransactionClient();
  }

  async create(params: { trip: Trip; actor: ActorContext }): Promise<void> {
    const { trip } = params;
    const result = await this.client().query(
      `INSERT INTO trips
         (workspace_id, id, purpose, lifecycle_status,
          intended_window_start, intended_window_end, business_context_organisation_id,
          created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        trip.workspaceId,
        trip.id,
        trip.purpose,
        trip.lifecycleStatus,
        trip.intendedWindow?.start ?? null,
        trip.intendedWindow?.end ?? null,
        trip.businessContextOrganisationId ?? null,
        params.actor.actorPrincipalId,
      ],
    );
    if (result.rowCount !== 1) {
      throw new Error(`trip ${trip.id} was not inserted`);
    }
  }

  async load(workspaceId: string, tripId: string): Promise<Trip | undefined> {
    const result = await this.client().query<TripRow>(
      `${TRIP_SELECT} WHERE t.workspace_id = $1 AND t.id = $2`,
      [workspaceId, tripId],
    );
    const row = result.rows[0];
    return row ? toTrip(workspaceId, tripId, row) : undefined;
  }

  async updateDetails(params: {
    workspaceId: string;
    tripId: string;
    purpose?: string;
    intendedWindow?: OptionalWindow | undefined;
    businessContextOrganisationId?: string | null;
    actor: ActorContext;
  }): Promise<void> {
    // Omission leaves a column alone; `businessContextOrganisationId: null`
    // clears it, which a COALESCE cannot express — hence the explicit $5 flag.
    // `params.actor` is not bound: `trips` has no updated-by column, so the
    // actor is recorded once in `change_records` by the command handler.
    const businessContextProvided = params.businessContextOrganisationId !== undefined;
    const result = await this.client().query(
      `UPDATE trips SET
         purpose = CASE WHEN $3::text IS NULL THEN purpose ELSE $3::text END,
         intended_window_start = CASE WHEN $4::timestamptz IS NULL THEN intended_window_start ELSE $4::timestamptz END,
         intended_window_end = CASE WHEN $5::timestamptz IS NULL THEN intended_window_end ELSE $5::timestamptz END,
         business_context_organisation_id = CASE WHEN $6 THEN $7::uuid ELSE business_context_organisation_id END,
         updated_at = now()
       WHERE workspace_id = $1 AND id = $2`,
      [
        params.workspaceId,
        params.tripId,
        params.purpose ?? null,
        params.intendedWindow?.start ?? null,
        params.intendedWindow?.end ?? null,
        businessContextProvided,
        params.businessContextOrganisationId ?? null,
      ],
    );
    if (result.rowCount !== 1) {
      throw new Error(`trip ${params.tripId} not found in workspace ${params.workspaceId}`);
    }
  }

  async setLifecycleStatus(params: {
    workspaceId: string;
    tripId: string;
    lifecycleStatus: LifecycleStatus;
    actor: ActorContext;
  }): Promise<void> {
    const result = await this.client().query(
      `UPDATE trips SET lifecycle_status = $3, updated_at = now()
        WHERE workspace_id = $1 AND id = $2`,
      [params.workspaceId, params.tripId, params.lifecycleStatus],
    );
    if (result.rowCount !== 1) {
      throw new Error(`trip ${params.tripId} not found in workspace ${params.workspaceId}`);
    }
  }

  /**
   * Handler support read for F03's "an ACTIVE Trip has a non-cancelled Journey"
   * rule (0021 asserts it at COMMIT). Checking it before mutating turns a commit
   * abort into a typed conflict; the trigger stays the backstop.
   */
  async nonCancelledJourneyCount(workspaceId: string, tripId: string): Promise<number> {
    const result = await this.client().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM journeys
        WHERE workspace_id = $1 AND trip_id = $2 AND lifecycle_status <> 'CANCELLED'`,
      [workspaceId, tripId],
    );
    const row = result.rows[0];
    return row ? Number(row.count) : 0;
  }
}

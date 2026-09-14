/**
 * PostgreSQL implementation of `EventRepository`/`ProgrammeRepository`
 * (src/contracts/v2/repository/programmes.ts) over `events`/`programmes`/
 * `programme_items`/`participations`/`participation_roles`/
 * `programme_item_external_observations` (migrations 0054-0057, 0059).
 *
 * Typed-row SQL only, per the M2 division of labour this lane reuses: every
 * statement runs on the ambient transaction client, is workspace-scoped, and
 * never touches `aggregate_heads`/`change_records`/`outbox` — that belongs to
 * `commands/programmeCommands.ts`.
 */
import type { PoolClient } from 'pg';
import type {
  EventRepository,
  ProgrammeRepository,
  NewProgrammeItem,
  ProgrammeItemScheduleChange,
  ExternalScheduleObservation,
} from '../../../contracts/v2/repository/programmes.ts';
import type { ActorContext } from '../../../contracts/v2/repository/people.ts';
import {
  EventSchema,
  ProgrammeSchema,
  ProgrammeItemSchema,
  ParticipationSchema,
  type Event,
  type Programme,
  type ProgrammeItem,
  type ProgrammeItemLifecycle,
  type Participation,
} from '../../../domain/v2/programmes/programme.ts';
import { currentTransactionClient } from '../transactionContext.ts';

interface EventRow {
  title: string;
  organiser_organisation_id: string | null;
  lifecycle_status: string;
  revision: string;
}

const EVENT_SELECT = `
  SELECT e.title, e.organiser_organisation_id, e.lifecycle_status, h.revision
    FROM events e
    JOIN aggregate_heads h ON h.workspace_id = e.workspace_id AND h.aggregate_id = e.id`;

function toEvent(workspaceId: string, eventId: string, row: EventRow): Event {
  return EventSchema.parse({
    id: eventId,
    revision: Number(row.revision),
    title: row.title,
    lifecycleStatus: row.lifecycle_status,
    ...(row.organiser_organisation_id ? { organiserOrganisationId: row.organiser_organisation_id } : {}),
  });
}

export class PgEventRepository implements EventRepository {
  private client(): PoolClient {
    return currentTransactionClient();
  }

  async create(params: { event: Event; actor: ActorContext }): Promise<void> {
    const { event } = params;
    const result = await this.client().query(
      `INSERT INTO events (workspace_id, id, title, organiser_organisation_id, lifecycle_status, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        params.actor.workspaceId,
        event.id,
        event.title,
        event.organiserOrganisationId ?? null,
        event.lifecycleStatus,
        params.actor.actorPrincipalId,
      ],
    );
    if (result.rowCount !== 1) throw new Error(`event ${event.id} was not inserted`);
  }

  async load(workspaceId: string, eventId: string): Promise<Event | undefined> {
    const result = await this.client().query<EventRow>(`${EVENT_SELECT} WHERE e.workspace_id = $1 AND e.id = $2`, [
      workspaceId,
      eventId,
    ]);
    const row = result.rows[0];
    return row ? toEvent(workspaceId, eventId, row) : undefined;
  }

  async setLifecycleStatus(params: {
    workspaceId: string;
    eventId: string;
    lifecycleStatus: Event['lifecycleStatus'];
    actor: ActorContext;
  }): Promise<void> {
    const result = await this.client().query(
      `UPDATE events SET lifecycle_status = $3, updated_at = now() WHERE workspace_id = $1 AND id = $2`,
      [params.workspaceId, params.eventId, params.lifecycleStatus],
    );
    if (result.rowCount !== 1) throw new Error(`event ${params.eventId} not found in workspace ${params.workspaceId}`);
  }
}

interface ProgrammeRow {
  event_id: string;
  title: string;
  lifecycle_status: string;
  revision: string;
}

const PROGRAMME_SELECT = `
  SELECT p.event_id, p.title, p.lifecycle_status, h.revision
    FROM programmes p
    JOIN aggregate_heads h ON h.workspace_id = p.workspace_id AND h.aggregate_id = p.id`;

function toProgramme(workspaceId: string, programmeId: string, row: ProgrammeRow): Programme {
  return ProgrammeSchema.parse({
    id: programmeId,
    revision: Number(row.revision),
    eventId: row.event_id,
    title: row.title,
    lifecycleStatus: row.lifecycle_status,
  });
}

interface ProgrammeItemRow {
  id: string;
  programme_id: string;
  title: string;
  item_type: string;
  place_id: string | null;
  window_start: Date | null;
  window_end: Date | null;
  time_zone: string | null;
  lifecycle_status: string;
  operating_requirements: Record<string, unknown> | null;
  schedule_authority: string;
  external_source_ref: string | null;
}

const PROGRAMME_ITEM_SELECT = `
  SELECT id, programme_id, title, item_type, place_id, window_start, window_end, time_zone,
         lifecycle_status, operating_requirements, schedule_authority, external_source_ref
    FROM programme_items`;

function toProgrammeItem(row: ProgrammeItemRow): ProgrammeItem {
  return ProgrammeItemSchema.parse({
    id: row.id,
    programmeId: row.programme_id,
    title: row.title,
    itemType: row.item_type,
    lifecycleStatus: row.lifecycle_status,
    scheduleAuthority: row.schedule_authority,
    ...(row.place_id ? { placeId: row.place_id } : {}),
    ...(row.window_start && row.window_end
      ? { window: { start: row.window_start.toISOString(), end: row.window_end.toISOString() } }
      : {}),
    ...(row.time_zone ? { timeZone: row.time_zone } : {}),
    ...(row.operating_requirements ? { operatingRequirements: row.operating_requirements } : {}),
    ...(row.external_source_ref ? { externalSourceRef: row.external_source_ref } : {}),
  });
}

interface ParticipationRow {
  id: string;
  programme_item_id: string;
  traveller_id: string;
  obligation: string;
  preparation_window_start: Date | null;
  preparation_window_end: Date | null;
  release_window_start: Date | null;
  release_window_end: Date | null;
  accepted: boolean;
  attended: boolean | null;
}

const PARTICIPATION_SELECT = `
  SELECT id, programme_item_id, traveller_id, obligation,
         preparation_window_start, preparation_window_end,
         release_window_start, release_window_end, accepted, attended
    FROM participations`;

function toParticipation(row: ParticipationRow): Participation {
  return ParticipationSchema.parse({
    id: row.id,
    programmeItemId: row.programme_item_id,
    travellerId: row.traveller_id,
    obligation: row.obligation,
    accepted: row.accepted,
    ...(row.preparation_window_start && row.preparation_window_end
      ? {
          preparationWindow: {
            start: row.preparation_window_start.toISOString(),
            end: row.preparation_window_end.toISOString(),
          },
        }
      : {}),
    ...(row.release_window_start && row.release_window_end
      ? { releaseWindow: { start: row.release_window_start.toISOString(), end: row.release_window_end.toISOString() } }
      : {}),
    ...(row.attended !== null && row.attended !== undefined ? { attended: row.attended } : {}),
  });
}

export class PgProgrammeRepository implements ProgrammeRepository {
  private client(): PoolClient {
    return currentTransactionClient();
  }

  async create(params: { programme: Programme; actor: ActorContext }): Promise<void> {
    const { programme } = params;
    const result = await this.client().query(
      `INSERT INTO programmes (workspace_id, id, event_id, title, lifecycle_status, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        params.actor.workspaceId,
        programme.id,
        programme.eventId,
        programme.title,
        programme.lifecycleStatus,
        params.actor.actorPrincipalId,
      ],
    );
    if (result.rowCount !== 1) throw new Error(`programme ${programme.id} was not inserted`);
  }

  async load(workspaceId: string, programmeId: string): Promise<Programme | undefined> {
    const result = await this.client().query<ProgrammeRow>(
      `${PROGRAMME_SELECT} WHERE p.workspace_id = $1 AND p.id = $2`,
      [workspaceId, programmeId],
    );
    const row = result.rows[0];
    return row ? toProgramme(workspaceId, programmeId, row) : undefined;
  }

  async listForEvent(workspaceId: string, eventId: string): Promise<Programme[]> {
    const result = await this.client().query<ProgrammeRow & { id: string }>(
      `SELECT p.id, ${PROGRAMME_SELECT.replace(/^\s*SELECT /, '')} WHERE p.workspace_id = $1 AND p.event_id = $2 ORDER BY p.created_at`,
      [workspaceId, eventId],
    );
    return result.rows.map((row) => toProgramme(workspaceId, row.id, row));
  }

  async setLifecycleStatus(params: {
    workspaceId: string;
    programmeId: string;
    lifecycleStatus: Programme['lifecycleStatus'];
    actor: ActorContext;
  }): Promise<void> {
    const result = await this.client().query(
      `UPDATE programmes SET lifecycle_status = $3, updated_at = now() WHERE workspace_id = $1 AND id = $2`,
      [params.workspaceId, params.programmeId, params.lifecycleStatus],
    );
    if (result.rowCount !== 1) {
      throw new Error(`programme ${params.programmeId} not found in workspace ${params.workspaceId}`);
    }
  }

  async addItem(params: NewProgrammeItem): Promise<void> {
    const { item } = params;
    const result = await this.client().query(
      `INSERT INTO programme_items
         (workspace_id, id, programme_id, title, item_type, place_id, window_start, window_end,
          time_zone, lifecycle_status, operating_requirements, schedule_authority, external_source_ref,
          created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        params.actor.workspaceId,
        item.id,
        item.programmeId,
        item.title,
        item.itemType,
        item.placeId ?? null,
        item.window?.start ?? null,
        item.window?.end ?? null,
        item.timeZone ?? null,
        item.lifecycleStatus,
        item.operatingRequirements ? JSON.stringify(item.operatingRequirements) : null,
        item.scheduleAuthority ?? 'INTERNAL',
        item.externalSourceRef ?? null,
        params.actor.actorPrincipalId,
      ],
    );
    if (result.rowCount !== 1) throw new Error(`programme item ${item.id} was not inserted`);
  }

  async loadItem(workspaceId: string, programmeItemId: string): Promise<ProgrammeItem | undefined> {
    const result = await this.client().query<ProgrammeItemRow>(
      `${PROGRAMME_ITEM_SELECT} WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, programmeItemId],
    );
    const row = result.rows[0];
    return row ? toProgrammeItem(row) : undefined;
  }

  async listItems(workspaceId: string, programmeId: string): Promise<ProgrammeItem[]> {
    const result = await this.client().query<ProgrammeItemRow>(
      `${PROGRAMME_ITEM_SELECT} WHERE workspace_id = $1 AND programme_id = $2 ORDER BY created_at`,
      [workspaceId, programmeId],
    );
    return result.rows.map(toProgrammeItem);
  }

  async updateItemSchedule(params: ProgrammeItemScheduleChange): Promise<void> {
    const windowProvided = params.window !== undefined;
    const placeProvided = params.placeId !== undefined;
    const tzProvided = params.timeZone !== undefined;
    const result = await this.client().query(
      `UPDATE programme_items SET
         window_start = CASE WHEN $3 THEN $4::timestamptz ELSE window_start END,
         window_end = CASE WHEN $3 THEN $5::timestamptz ELSE window_end END,
         place_id = CASE WHEN $6 THEN $7::uuid ELSE place_id END,
         time_zone = CASE WHEN $8 THEN $9::text ELSE time_zone END,
         updated_at = now()
       WHERE workspace_id = $1 AND id = $2`,
      [
        params.workspaceId,
        params.programmeItemId,
        windowProvided,
        params.window?.start ?? null,
        params.window?.end ?? null,
        placeProvided,
        params.placeId ?? null,
        tzProvided,
        params.timeZone ?? null,
      ],
    );
    if (result.rowCount !== 1) {
      throw new Error(`programme item ${params.programmeItemId} not found in workspace ${params.workspaceId}`);
    }
  }

  async setItemLifecycleStatus(params: {
    workspaceId: string;
    programmeItemId: string;
    lifecycleStatus: ProgrammeItemLifecycle;
    actor: ActorContext;
  }): Promise<void> {
    const result = await this.client().query(
      `UPDATE programme_items SET lifecycle_status = $3, updated_at = now() WHERE workspace_id = $1 AND id = $2`,
      [params.workspaceId, params.programmeItemId, params.lifecycleStatus],
    );
    if (result.rowCount !== 1) {
      throw new Error(`programme item ${params.programmeItemId} not found in workspace ${params.workspaceId}`);
    }
  }

  async recordExternalObservation(params: ExternalScheduleObservation): Promise<void> {
    const result = await this.client().query(
      `INSERT INTO programme_item_external_observations
         (workspace_id, id, programme_item_id, observed_window_start, observed_window_end,
          observed_place_id, observed_lifecycle_status, source_ref, observed_at,
          conflicts_with_current, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        params.workspaceId,
        params.id,
        params.programmeItemId,
        params.observedWindow?.start ?? null,
        params.observedWindow?.end ?? null,
        params.observedPlaceId ?? null,
        params.observedLifecycleStatus ?? null,
        params.sourceRef,
        params.observedAt,
        params.conflictsWithCurrent,
        params.actor.actorPrincipalId,
      ],
    );
    if (result.rowCount !== 1) throw new Error(`external observation ${params.id} was not inserted`);
  }

  async addParticipation(params: { participation: Participation; roles?: string[]; actor: ActorContext }): Promise<void> {
    const { participation } = params;
    const result = await this.client().query(
      `INSERT INTO participations
         (workspace_id, id, programme_item_id, traveller_id, obligation,
          preparation_window_start, preparation_window_end,
          release_window_start, release_window_end, accepted, attended, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        params.actor.workspaceId,
        participation.id,
        participation.programmeItemId,
        participation.travellerId,
        participation.obligation,
        participation.preparationWindow?.start ?? null,
        participation.preparationWindow?.end ?? null,
        participation.releaseWindow?.start ?? null,
        participation.releaseWindow?.end ?? null,
        participation.accepted,
        participation.attended ?? null,
        params.actor.actorPrincipalId,
      ],
    );
    if (result.rowCount !== 1) throw new Error(`participation ${participation.id} was not inserted`);
    for (const role of params.roles ?? []) {
      await this.client().query(
        `INSERT INTO participation_roles (workspace_id, participation_id, role, created_by_actor_id)
         VALUES ($1, $2, $3, $4)`,
        [params.actor.workspaceId, participation.id, role, params.actor.actorPrincipalId],
      );
    }
  }

  async loadParticipation(workspaceId: string, participationId: string): Promise<Participation | undefined> {
    const result = await this.client().query<ParticipationRow>(
      `${PARTICIPATION_SELECT} WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, participationId],
    );
    const row = result.rows[0];
    return row ? toParticipation(row) : undefined;
  }

  async listParticipationsForItem(workspaceId: string, programmeItemId: string): Promise<Participation[]> {
    const result = await this.client().query<ParticipationRow>(
      `${PARTICIPATION_SELECT} WHERE workspace_id = $1 AND programme_item_id = $2 ORDER BY created_at`,
      [workspaceId, programmeItemId],
    );
    return result.rows.map(toParticipation);
  }

  async listParticipationsForTraveller(workspaceId: string, travellerId: string): Promise<Participation[]> {
    const result = await this.client().query<ParticipationRow>(
      `${PARTICIPATION_SELECT} WHERE workspace_id = $1 AND traveller_id = $2 ORDER BY created_at`,
      [workspaceId, travellerId],
    );
    return result.rows.map(toParticipation);
  }

  async updateParticipation(params: {
    workspaceId: string;
    participationId: string;
    accepted?: boolean;
    attended?: boolean | null;
    actor: ActorContext;
  }): Promise<void> {
    const attendedProvided = params.attended !== undefined;
    const result = await this.client().query(
      `UPDATE participations SET
         accepted = CASE WHEN $3::boolean IS NULL THEN accepted ELSE $3::boolean END,
         attended = CASE WHEN $4 THEN $5::boolean ELSE attended END,
         updated_at = now()
       WHERE workspace_id = $1 AND id = $2`,
      [params.workspaceId, params.participationId, params.accepted ?? null, attendedProvided, params.attended ?? null],
    );
    if (result.rowCount !== 1) {
      throw new Error(`participation ${params.participationId} not found in workspace ${params.workspaceId}`);
    }
  }

  async addParticipationRole(params: {
    workspaceId: string;
    participationId: string;
    role: string;
    actor: ActorContext;
  }): Promise<void> {
    await this.client().query(
      `INSERT INTO participation_roles (workspace_id, participation_id, role, created_by_actor_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (workspace_id, participation_id, role) DO NOTHING`,
      [params.workspaceId, params.participationId, params.role, params.actor.actorPrincipalId],
    );
  }

  async listParticipationRoles(workspaceId: string, participationId: string): Promise<string[]> {
    const result = await this.client().query<{ role: string }>(
      `SELECT role FROM participation_roles WHERE workspace_id = $1 AND participation_id = $2 ORDER BY role`,
      [workspaceId, participationId],
    );
    return result.rows.map((row) => row.role);
  }

  async programmeIdForItem(workspaceId: string, programmeItemId: string): Promise<string | undefined> {
    const result = await this.client().query<{ programme_id: string }>(
      `SELECT programme_id FROM programme_items WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, programmeItemId],
    );
    return result.rows[0]?.programme_id;
  }

  async programmeIdForParticipation(workspaceId: string, participationId: string): Promise<string | undefined> {
    const result = await this.client().query<{ programme_id: string }>(
      `SELECT pi.programme_id
         FROM participations p
         JOIN programme_items pi ON pi.workspace_id = p.workspace_id AND pi.id = p.programme_item_id
        WHERE p.workspace_id = $1 AND p.id = $2`,
      [workspaceId, participationId],
    );
    return result.rows[0]?.programme_id;
  }
}

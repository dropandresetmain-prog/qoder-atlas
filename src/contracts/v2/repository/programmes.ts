/**
 * NORTHSTAR v2 — Programme/geography repository seams (M4).
 *
 * DATA_STRUCTURE_LOGICAL_SCHEMA.md §5/§12. Mirrors the M2 division of labour
 * (`repository/travel.ts`): each method writes exactly one ownership rule,
 * repository methods never advance an aggregate head, and revision checking
 * stays in the command handlers via `UnitOfWork`.
 *
 * `resource_id` on ResourceAssignment is M3's opaque reference (deferred FK,
 * see docs/refactor/evidence/M4.md); this seam does not validate it.
 */
import type {
  Event,
  Programme,
  ProgrammeItem,
  ProgrammeItemLifecycle,
  Participation,
  ResourceAssignment,
  Place,
  GeographicArea,
  GeographicAreaVersion,
  Jurisdiction,
  JurisdictionArea,
} from '../../../domain/v2/programmes/programme.ts';
import type { InstantInterval } from '../../../domain/v2/shared/time.ts';
import type { ActorContext } from './people.ts';

export type OptionalWindow = Pick<InstantInterval, 'start' | 'end'>;

export interface EventRepository {
  create(params: { event: Event; actor: ActorContext }): Promise<void>;
  load(workspaceId: string, eventId: string): Promise<Event | undefined>;
  setLifecycleStatus(params: {
    workspaceId: string;
    eventId: string;
    lifecycleStatus: Event['lifecycleStatus'];
    actor: ActorContext;
  }): Promise<void>;
}

export interface NewProgrammeItem {
  item: ProgrammeItem;
  actor: ActorContext;
}

export interface ProgrammeItemScheduleChange {
  workspaceId: string;
  programmeItemId: string;
  /** Explicit null clears the window; omission leaves it alone. */
  window?: OptionalWindow | null;
  placeId?: string | null;
  timeZone?: string | null;
  actor: ActorContext;
}

export interface ExternalScheduleObservation {
  id: string;
  workspaceId: string;
  programmeItemId: string;
  observedWindow?: OptionalWindow;
  observedPlaceId?: string;
  observedLifecycleStatus?: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
  sourceRef: string;
  observedAt: string;
  conflictsWithCurrent: boolean;
  actor: ActorContext;
}

/**
 * Programme is the single aggregate owner of its ProgrammeItems and
 * Participations (F07): every write here is a child write the command layer
 * attributes to exactly one Programme revision advance.
 */
export interface ProgrammeRepository {
  create(params: { programme: Programme; actor: ActorContext }): Promise<void>;
  load(workspaceId: string, programmeId: string): Promise<Programme | undefined>;
  listForEvent(workspaceId: string, eventId: string): Promise<Programme[]>;
  setLifecycleStatus(params: {
    workspaceId: string;
    programmeId: string;
    lifecycleStatus: Programme['lifecycleStatus'];
    actor: ActorContext;
  }): Promise<void>;

  addItem(params: NewProgrammeItem): Promise<void>;
  loadItem(workspaceId: string, programmeItemId: string): Promise<ProgrammeItem | undefined>;
  listItems(workspaceId: string, programmeId: string): Promise<ProgrammeItem[]>;
  /** The one canonical schedule/place-move path (M4 brief §C). */
  updateItemSchedule(params: ProgrammeItemScheduleChange): Promise<void>;
  setItemLifecycleStatus(params: {
    workspaceId: string;
    programmeItemId: string;
    lifecycleStatus: ProgrammeItemLifecycle;
    actor: ActorContext;
  }): Promise<void>;
  /** Immutable capture; never rewrites `programme_items` (M4 brief §F). */
  recordExternalObservation(params: ExternalScheduleObservation): Promise<void>;

  addParticipation(params: { participation: Participation; roles?: string[]; actor: ActorContext }): Promise<void>;
  loadParticipation(workspaceId: string, participationId: string): Promise<Participation | undefined>;
  listParticipationsForItem(workspaceId: string, programmeItemId: string): Promise<Participation[]>;
  listParticipationsForTraveller(workspaceId: string, travellerId: string): Promise<Participation[]>;
  updateParticipation(params: {
    workspaceId: string;
    participationId: string;
    accepted?: boolean;
    attended?: boolean | null;
    actor: ActorContext;
  }): Promise<void>;
  addParticipationRole(params: { workspaceId: string; participationId: string; role: string; actor: ActorContext }): Promise<void>;
  listParticipationRoles(workspaceId: string, participationId: string): Promise<string[]>;

  /** Resolves the owning Programme id for a child row — the aggregate a command must lock/advance. */
  programmeIdForItem(workspaceId: string, programmeItemId: string): Promise<string | undefined>;
  programmeIdForParticipation(workspaceId: string, participationId: string): Promise<string | undefined>;
}

/** ResourceAssignment's `activity_id` is kind-checked at command time, never a blind uuid. */
export interface ResourceAssignmentRepository {
  create(params: {
    assignment: ResourceAssignment;
    activityKind: 'PROGRAMME_ITEM' | 'JOURNEY_ITEM';
    actor: ActorContext;
  }): Promise<void>;
  load(workspaceId: string, assignmentId: string): Promise<ResourceAssignment | undefined>;
  listForActivity(
    workspaceId: string,
    activityKind: 'PROGRAMME_ITEM' | 'JOURNEY_ITEM',
    activityId: string,
  ): Promise<ResourceAssignment[]>;
  setLifecycleStatus(params: {
    workspaceId: string;
    assignmentId: string;
    lifecycleStatus: ResourceAssignment['lifecycleStatus'];
    actor: ActorContext;
  }): Promise<void>;
}

export interface PlaceRepository {
  create(params: { place: Place; actor: ActorContext }): Promise<void>;
  load(workspaceId: string, placeId: string): Promise<Place | undefined>;
  /** `id` is generated by the caller before the command's retryable callback (C1 amendment c: no non-deterministic value inside `execute`). */
  addExternalRef(params: {
    workspaceId: string;
    id: string;
    placeId: string;
    providerNamespace: string;
    externalKey: string;
    actor: ActorContext;
  }): Promise<void>;
  addAssociation(params: {
    workspaceId: string;
    id: string;
    placeId: string;
    relatedPlaceId: string;
    associationType: string;
    actor: ActorContext;
  }): Promise<void>;
}

export interface GeographyRepository {
  createArea(params: { area: GeographicArea; actor: ActorContext }): Promise<void>;
  loadArea(workspaceId: string, areaId: string): Promise<GeographicArea | undefined>;
  /** WKT geometry text (e.g. `MULTIPOLYGON(((...)))`); validated by `area_versions_geometry_valid`. */
  addAreaVersion(params: { version: GeographicAreaVersion; geometryWkt: string; actor: ActorContext }): Promise<void>;
  listAreaVersions(workspaceId: string, areaId: string): Promise<GeographicAreaVersion[]>;
  addAreaMembership(params: {
    workspaceId: string;
    id: string;
    memberKind: 'PLACE' | 'AREA';
    memberPlaceId?: string;
    memberAreaId?: string;
    containingAreaVersionId: string;
    validFrom: string;
    validUntil?: string;
    evidenceId: string;
    actor: ActorContext;
  }): Promise<void>;

  createJurisdiction(params: { jurisdiction: Jurisdiction; actor: ActorContext }): Promise<void>;
  loadJurisdiction(workspaceId: string, jurisdictionId: string): Promise<Jurisdiction | undefined>;
  addJurisdictionArea(params: { link: JurisdictionArea; id: string; actor: ActorContext }): Promise<void>;

  // Reverse lookup H ("jurisdictions for an area edition", "areas containing a
  // Place") lives in the read-only `GeographyReadQueries` seam
  // (repository/programmeQueries.ts), not here — this port is typed-row
  // writes only, matching the M2 repository/read-query file split.
}

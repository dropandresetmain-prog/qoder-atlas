/**
 * NORTHSTAR v2 — Trip/Journey/coordination/support repository seams (M2).
 *
 * DATA_STRUCTURE_LOGICAL_SCHEMA.md §3/§12. Each method writes one ownership
 * rule; none of them accepts a loose JSON aggregate. Journey intent here is
 * deliberately *intent only*: supplier/service/reservation truth is M3's,
 * place/jurisdiction truth is M4's and the executable dependency graph is M6's,
 * so those appear as opaque UUID references that the database does not
 * cross-check yet (docs/refactor/MIGRATION_MAPPING.md deferral ledger).
 *
 * Revision checking lives in the command handlers via `UnitOfWork`, not here —
 * a repository method never silently advances an aggregate head.
 */
import type { JourneyItemKind, JourneyItemLifecycle, LifecycleStatus } from '../../../domain/v2/trip/trip.ts';
import type {
  CoordinationGroup,
  CredentialSelection,
  GroupMembership,
  IntendedVisit,
  Journey,
  JourneyItem,
  Trip,
} from '../../../domain/v2/trip/trip.ts';
import type { AccompanimentConstraintDefinition, SupportAssignment } from '../../../domain/v2/trip/support.ts';
import type { InstantInterval } from '../../../domain/v2/shared/time.ts';
import type { ActorContext } from './people.ts';

/** Half-open window columns are written as a pair or not at all (CHECK-enforced). */
export type OptionalWindow = Pick<InstantInterval, 'start' | 'end'>;

export interface NewCredentialSelection {
  selection: CredentialSelection;
  /** Receipt that authorised the selection; persisted as a deferred FK. */
  receipt: { commandNamespace: string; idempotencyKey: string };
  actor: ActorContext;
}

/**
 * Trip is the shared undertaking. The "ACTIVE Trip has a Journey" invariant is
 * a deferred database assertion (0021), so `setLifecycleStatus` cannot be
 * cheated by statement order — it either commits with participation or rolls back.
 */
export interface TripRepository {
  create(params: { trip: Trip; actor: ActorContext }): Promise<void>;
  load(workspaceId: string, tripId: string): Promise<Trip | undefined>;
  updateDetails(params: {
    workspaceId: string;
    tripId: string;
    purpose?: string;
    intendedWindow?: OptionalWindow | undefined;
    /** Explicit null clears the business context; omission leaves it alone. */
    businessContextOrganisationId?: string | null;
    actor: ActorContext;
  }): Promise<void>;
  setLifecycleStatus(params: {
    workspaceId: string;
    tripId: string;
    lifecycleStatus: LifecycleStatus;
    actor: ActorContext;
  }): Promise<void>;
}

export interface NewJourney {
  journey: Journey;
  actor: ActorContext;
  /** Written in the same step so a Journey can never exist without its items' owner. */
  items?: JourneyItem[];
  intendedVisits?: IntendedVisit[];
}

/**
 * One Journey per (Trip, Traveller) is the database's UNIQUE key, not a
 * handler convention; there is no main/sub/primary traveller notion to express.
 */
export interface JourneyRepository {
  create(params: NewJourney): Promise<void>;
  load(workspaceId: string, journeyId: string): Promise<Journey | undefined>;
  listForTrip(workspaceId: string, tripId: string): Promise<Journey[]>;
  listForTraveller(workspaceId: string, travellerId: string): Promise<Journey[]>;
  updateDetails(params: {
    workspaceId: string;
    journeyId: string;
    intendedWindow?: OptionalWindow | undefined;
    responsibilityOrganisationId?: string | null;
    lifecycleStatus?: LifecycleStatus;
    actor: ActorContext;
  }): Promise<void>;
  /** `item.orderKey` is a stable sort key only — never an executable dependency (M6 owns that). */
  addItem(params: { journeyId: string; item: JourneyItem; actor: ActorContext }): Promise<void>;
  /** Re-reads the parent row plus exactly one kind-detail row. */
  loadItem(workspaceId: string, journeyItemId: string): Promise<JourneyItem | undefined>;
  listItems(workspaceId: string, journeyId: string): Promise<JourneyItem[]>;
  updateItem(params: {
    workspaceId: string;
    journeyId: string;
    journeyItemId: string;
    orderKey?: string;
    lifecycleStatus?: JourneyItemLifecycle;
    flexible?: boolean;
    intendedWindow?: OptionalWindow | undefined;
    actor: ActorContext;
  }): Promise<void>;
  addIntendedVisit(params: { visit: IntendedVisit; actor: ActorContext }): Promise<void>;
  listIntendedVisits(workspaceId: string, journeyId: string): Promise<IntendedVisit[]>;
  /**
   * Selecting a credential for a Journey pins an immutable accepted edition.
   * Re-selecting the same credential updates the pinned edition in place, so a
   * Journey never holds two parallel claims for one document.
   */
  selectCredential(params: NewCredentialSelection): Promise<void>;
  listCredentialSelections(workspaceId: string, journeyId: string): Promise<CredentialSelection[]>;
  removeCredentialSelection(params: {
    workspaceId: string;
    journeyId: string;
    credentialId: string;
    actor: ActorContext;
  }): Promise<void>;
}

/** Coordination is membership-based; it is not a relationship and grants no authority. */
export interface CoordinationRepository {
  createGroup(params: { group: CoordinationGroup; purpose?: string; actor: ActorContext }): Promise<void>;
  loadGroup(workspaceId: string, groupId: string): Promise<CoordinationGroup | undefined>;
  updateGroup(params: {
    workspaceId: string;
    groupId: string;
    name?: string;
    purpose?: string | null;
    effectiveRange?: OptionalWindow | undefined;
    lifecycleStatus?: LifecycleStatus;
    actor: ActorContext;
  }): Promise<void>;
  addMembership(params: { membership: GroupMembership; actor: ActorContext }): Promise<void>;
  listMemberships(workspaceId: string, groupId: string): Promise<GroupMembership[]>;
  listGroupsForJourney(workspaceId: string, journeyId: string): Promise<CoordinationGroup[]>;
  removeMembership(params: {
    workspaceId: string;
    groupId: string;
    journeyId: string;
    actor: ActorContext;
  }): Promise<void>;
}

export interface NewSupportRequirement {
  requirement: AccompanimentConstraintDefinition;
  actor: ActorContext;
}

/**
 * The requirement edition is append-only; an assignment may only ever narrow
 * itself inside the exact edition it pins. Coverage gaps and minimum-simultaneous
 * arithmetic stay in the domain (`assignmentSatisfiesDefinition`); the database
 * guarantees the two properties that must not be conventional — the pin and the
 * eligible set.
 */
export interface SupportRepository {
  appendRequirement(params: NewSupportRequirement): Promise<void>;
  loadRequirement(
    workspaceId: string,
    requirementId: string,
    version: number,
  ): Promise<AccompanimentConstraintDefinition | undefined>;
  listRequirementVersions(workspaceId: string, requirementId: string): Promise<AccompanimentConstraintDefinition[]>;
  latestRequirementVersion(workspaceId: string, requirementId: string): Promise<AccompanimentConstraintDefinition | undefined>;
  createAssignment(params: { assignment: SupportAssignment; actor: ActorContext }): Promise<void>;
  loadAssignment(workspaceId: string, assignmentId: string): Promise<SupportAssignment | undefined>;
  listAssignmentsForRequirement(
    workspaceId: string,
    requirementId: string,
    version: number,
  ): Promise<SupportAssignment[]>;
  setAssignmentStatus(params: {
    workspaceId: string;
    assignmentId: string;
    lifecycleStatus: SupportAssignment['lifecycleStatus'];
    actor: ActorContext;
  }): Promise<void>;
  /** Replaces the selected-fulfilment detail; the pinned requirement edition is unchanged. */
  replaceAssignmentScope(params: {
    workspaceId: string;
    assignmentId: string;
    assignedSupporterTravellerIds: string[];
    assignedScopes: { supporterTravellerId: string; interval: InstantInterval }[];
    handoffs: SupportAssignment['handoffs'];
    actor: ActorContext;
  }): Promise<void>;
}

/** Kind-detail shapes the JourneyItem writers accept, keyed by the discriminator. */
export type JourneyItemDetailByKind = {
  TRANSPORT: Extract<JourneyItem, { kind: 'TRANSPORT' }>;
  STAY: Extract<JourneyItem, { kind: 'STAY' }>;
  ENGAGEMENT: Extract<JourneyItem, { kind: 'ENGAGEMENT' }>;
  RESOURCE_USE: Extract<JourneyItem, { kind: 'RESOURCE_USE' }>;
};

export type { JourneyItemKind, JourneyItemLifecycle };

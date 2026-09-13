/**
 * NORTHSTAR v2 — reverse-lookup query seams (M2).
 *
 * DATA_STRUCTURE_LOGICAL_SCHEMA.md §9 requires indexes to follow actual
 * operations, and §12 forbids a caller from reaching for SQL. The consequence
 * for M2 is that every lookup a later milestone will need must already have a
 * *named, typed* port here, so M6/M9 never have to parse a JSON bag or guess a
 * join. Each method below maps to an index that 0029 (or its owning migration)
 * actually creates; the matching index is named in the doc comment.
 *
 * These are read-only. They return the minimum identifying tuple needed to
 * continue a computation — not aggregated business payloads.
 *
 * One interface per owning lane. A lane implements its own interfaces in its
 * own file and never edits another's. A later milestone (M3/M4/M5) extends this
 * seam by adding its own contract + implementation file, not by editing here.
 */
import type { DateInterval, Instant, InstantInterval, LocalDate } from '../../../domain/v2/shared/time.ts';
import type { SubjectKind, TypedRef } from '../../../domain/v2/shared/identity.ts';
import type { RelationshipType, ResponsibilityRole } from '../../../domain/v2/people/traveller.ts';

/** A Journey located by person + time: `idx_journeys_traveller` / `idx_trips_...`. */
export interface JourneyWindowHit {
  journeyId: string;
  tripId: string;
  travellerId: string;
  lifecycleStatus: string;
  intendedWindow: InstantInterval | null;
}

/** A JourneyItem found through a place it references (M4 owns `places`). */
export interface ItemPlaceHit {
  journeyItemId: string;
  journeyId: string;
  kind: string;
  /** Which role the place plays in this item, so callers do not re-derive it. */
  placeRole: 'ORIGIN' | 'DESTINATION' | 'INTENDED' | 'LOCATION';
}

/** An intended visit found through jurisdiction + window: entry/advisory applicability. */
export interface JurisdictionVisitHit {
  intendedVisitId: string;
  journeyId: string;
  travellerId: string;
  jurisdictionId: string;
  purpose: string;
  intendedDates: InstantInterval;
  transitIntent: boolean;
}

/** Which Journeys pinned a credential edition — the reverse link §9 asks for. */
export interface CredentialExposureHit {
  selectionId: string;
  journeyId: string;
  travellerId: string;
  credentialId: string;
  credentialVersionId: string;
  intendedVisitIds: string[];
}

/** A credential edition about to lapse, for freshness/reassessment scheduling. */
export interface CredentialExpiryHit {
  credentialId: string;
  travellerId: string;
  kind: string;
  versionId: string;
  editionNumber: number;
  expiryDate: LocalDate | null;
}

export interface JourneyReadQueries {
  /** `idx_journeys_traveller` + active travel window predicate. */
  journeysForTravellerInWindow(
    workspaceId: string,
    travellerId: string,
    window: InstantInterval,
    opts?: { includeCancelled?: boolean },
  ): Promise<JourneyWindowHit[]>;
  /** `idx_journeys_trip`. */
  journeysForTrip(workspaceId: string, tripId: string): Promise<JourneyWindowHit[]>;
  /** `idx_*_item_details_*` place indexes; the four roles are unioned server-side. */
  itemsReferencingPlace(workspaceId: string, placeId: string): Promise<ItemPlaceHit[]>;
  /** `idx_intended_visits_jurisdiction_window`. */
  intendedVisitsInJurisdictionWindow(
    workspaceId: string,
    jurisdictionId: string,
    window: InstantInterval,
  ): Promise<JurisdictionVisitHit[]>;
}

export interface CoordinationReadQueries {
  /** `idx_group_memberships_journey` + `idx_coordination_groups_*`. */
  coordinationGroupsCovering(
    workspaceId: string,
    window: InstantInterval,
  ): Promise<{ groupId: string; name: string; journeyIds: string[] }[]>;
  /** `idx_group_membership_items_item` — which shared group scopes one item. */
  groupsCoveringJourneyItem(
    workspaceId: string,
    journeyItemId: string,
  ): Promise<{ groupId: string; membershipId: string; journeyId: string }[]>;
}

export interface CredentialReadQueries {
  /** `idx_credential_selections_version` — the "this edition changed, who used it" link. */
  selectionsPinningVersion(workspaceId: string, credentialVersionId: string): Promise<CredentialExposureHit[]>;
  /** `idx_credential_selections_credential`. */
  selectionsForCredential(workspaceId: string, credentialId: string): Promise<CredentialExposureHit[]>;
  /** `idx_travel_credentials_current_version` — is this document in active use at all? */
  credentialsInUseByTraveller(workspaceId: string, travellerId: string): Promise<string[]>;
  /**
   * `idx_credential_versions_expiry` partial index: current editions whose
   * date-only validity ends inside `range`. Expired is an observed fact, never
   * a guess about whether the traveller still physically holds the document.
   */
  credentialsExpiringIn(workspaceId: string, range: DateInterval): Promise<CredentialExpiryHit[]>;
}

/**
 * Facts recorded *about* a person that are neither credentials nor travel
 * intent: who they are related to, and what movements were observed.
 */
export interface TravellerFactsReadQueries {
  /** `idx_traveller_relationships_from/to` — relationships in both directions. */
  relationshipsInvolving(
    workspaceId: string,
    travellerId: string,
    at?: Instant,
  ): Promise<
    {
      relationshipId: string;
      fromTravellerId: string;
      toTravellerId: string;
      relationshipType: RelationshipType;
      validRange: { start: LocalDate; end: LocalDate | null };
    }[]
  >;
  /**
   * `idx_travel_history_traveller_window` — date-only observed movements. A
   * PARTIAL claim is never promoted to WINDOW_COMPLETE by a query; the coverage
   * claim is the recorded fact.
   */
  travelHistoryFor(
    workspaceId: string,
    travellerId: string,
    range: DateInterval,
  ): Promise<
    {
      historyId: string;
      jurisdictionId: string;
      entryDate: LocalDate | null;
      exitDate: LocalDate | null;
      coverageClaim: 'PARTIAL' | 'WINDOW_COMPLETE';
      uncertaintyNote: string | null;
      evidenceId: string;
    }[]
  >;
}

export interface GovernanceReadQueries {
  /**
   * `idx_authority_grants_principal` + scope/action children. Returns grants
   * effective at `at`; scope narrowing is included so M9 can distinguish a
   * global grant from one scoped to the exact subject.
   */
  grantsEffectiveFor(
    workspaceId: string,
    principalId: string,
    at: Instant,
  ): Promise<
    {
      grantId: string;
      actionKinds: string[];
      scopeRefs: TypedRef[];
      representedPartyRef: TypedRef | null;
      expiresAt: Instant | null;
    }[]
  >;
  /** `idx_grant_actions_action` — who may perform this action, for audit/review. */
  principalsHoldingAction(workspaceId: string, actionKind: string, at: Instant): Promise<string[]>;
  /**
   * `idx_responsibility_assignments_subject` — reverse lookup by TypedRef
   * identity. Responsibility is borne by an Organisation party, never by a
   * principal; holding it does not authorise any action (F05). A reference
   * matches only on its exact (kind, id) pair.
   */
  responsibilitiesForSubjects(workspaceId: string, subjectRefs: TypedRef[]): Promise<
    {
      assignmentId: string;
      role: ResponsibilityRole;
      subjectKind: SubjectKind;
      subjectId: string;
      organisationId: string;
      effectiveRange: DateInterval;
    }[]
  >;
}

export interface SupportReadQueries {
  /** `idx_accompaniment_requirements_supported` — editions pinning a supported person. */
  requirementsForTraveller(
    workspaceId: string,
    travellerId: string,
    window?: InstantInterval,
  ): Promise<
    {
      requirementId: string;
      version: number;
      coverage: InstantInterval;
      minimumSimultaneousSupporters: number;
      maximumHandoffGapMinutes: number;
    }[]
  >;
  /**
   * `idx_accompaniment_eligible_supporters_traveller` — "who else could cover
   * this?" without implying the supporter is currently assigned.
   */
  requirementsEligibleForSupporter(workspaceId: string, supporterTravellerId: string): Promise<
    {
      requirementId: string;
      version: number;
      supportedTravellerId: string;
      coverage: InstantInterval;
    }[]
  >;
  /** `idx_support_assignment_scopes_traveller_window` — a supporter's committed time. */
  supportScopesForTravellerInWindow(
    workspaceId: string,
    supporterTravellerId: string,
    window: InstantInterval,
    opts?: { excludeStatuses?: string[] },
  ): Promise<
    {
      assignmentId: string;
      requirementId: string;
      requirementVersion: number;
      assignmentStatus: string;
      scope: InstantInterval;
    }[]
  >;
  /** `idx_support_assignment_handoffs_to` — continuation obligations for a handoff. */
  handoffsReceivedBy(
    workspaceId: string,
    supporterTravellerId: string,
    from: Instant,
  ): Promise<
    { assignmentId: string; fromSupporterTravellerId: string; handoffAt: Instant }[]
  >;
}

/** Registry-level existence check that respects kind, not just id (C1 amendment a). */
export interface SubjectRegistryReadQueries {
  /** Uses `domain_subjects_workspace_id_id_kind_uidx`; a wrong kind is a miss. */
  resolve(workspaceId: string, ref: TypedRef): Promise<{ aggregateId: string; revision: number } | undefined>;
  /** Batch form so a handler can validate many references in one statement. */
  resolveAll(workspaceId: string, refs: TypedRef[]): Promise<Map<string, { aggregateId: string; revision: number }>>;
}

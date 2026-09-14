/**
 * NORTHSTAR v2 — identity/governance repository seams (M2).
 *
 * DATA_STRUCTURE_LOGICAL_SCHEMA.md §12: "Domain handlers never call
 * `save(anyEntity)` or direct SQL" — every method here is typed, workspace-scoped
 * and named after the ownership rule it writes. The PostgreSQL implementations
 * in `src/persistence/postgres/repositories/**` run inside the ambient
 * `UnitOfWork` transaction, so a command that registers a subject, its head,
 * its typed rows and its audit trail commits atomically or not at all.
 *
 * Some inputs below have no frozen C0 zod schema (traveller name editions and
 * protected contacts are §2 tables the contract models only as `displayNameRef`
 * and as the ProtectedDataRef triple). They are declared here as typed inputs
 * rather than invented as JSON bags; see docs/refactor/evidence/M2.md.
 */
import type { SubjectKind, TypedRef } from '../../../domain/v2/shared/identity.ts';
import type { AuthorityGrant } from '../../../domain/v2/people/traveller.ts';
import type {
  CredentialLink,
  CredentialVersion,
  ProfileAssertion,
  ResponsibilityAssignment,
  TravelCredential,
  Traveller,
  TravellerRelationship,
} from '../../../domain/v2/people/traveller.ts';
import type { LocalDate, Instant } from '../../../domain/v2/shared/time.ts';
import type { ProtectedDataRef } from '../../../domain/v2/shared/identity.ts';

/** Who is performing a write; provenance, not a foreign key (see M2.md gap G-3). */
export interface ActorContext {
  workspaceId: string;
  actorPrincipalId: string;
}

export interface DateRange {
  start: LocalDate;
  end?: LocalDate;
}

export type NameKind = 'LEGAL' | 'DISPLAY' | 'PREFERRED' | 'OTHER';

export interface TravellerNameRecord {
  id: string;
  nameKind: NameKind;
  displayValue: string;
  familyName?: string;
  givenName?: string;
  effectiveRange: DateRange;
  evidenceId: string;
}

export interface TravellerContactRecord {
  id: string;
  channel: string;
  maskedLabel: string;
  protectedValue: ProtectedDataRef;
  effectiveRange: DateRange;
  evidenceId: string;
}

/**
 * Observed entry/exit movement — 0016's `travel_history` columns, typed rather
 * than a JSON bag (C0 froze no zod schema for a movement). `recordedAt` is
 * supplied by the command handler, computed outside the retryable callback, so a
 * serializable retry records the same instant.
 */
export interface TravelHistoryRecord {
  id: string;
  travellerId: string;
  /** Opaque until M4 owns `jurisdictions`; 0016 keeps the FK deferred. */
  jurisdictionId: string;
  entryDate?: LocalDate;
  exitDate?: LocalDate;
  coverageClaim: 'PARTIAL' | 'WINDOW_COMPLETE';
  uncertaintyNote?: string;
  evidenceId: string;
  recordedAt: string;
}

export interface NewTraveller {
  traveller: Traveller;
  /** The row `traveller.displayNameRef` points at; both are written in one step. */
  displayName: TravellerNameRecord;
  contacts?: TravellerContactRecord[];
  relationships?: TravellerRelationship[];
}

export interface NewCredentialVersion {
  credential: TravelCredential;
  version: CredentialVersion;
  /** Protected reference to the identifier printed on the document, never the value. */
  documentNumber?: ProtectedDataRef;
  /** Kind-specific structured detail; the database rejects a mismatch with the version kind. */
  detail?: PassportDetailInput | VisaDetailInput | ResidenceDetailInput | HealthDetailInput;
}

export interface PassportDetailInput {
  kind: 'PASSPORT';
  documentNumber: ProtectedDataRef;
  nationalityCountry?: string;
  machineReadable?: boolean;
}

export interface VisaDetailInput {
  kind: 'VISA';
  documentNumber: ProtectedDataRef;
  visaClass?: string;
  permittedActivities?: string[];
  restrictions?: string;
  entriesAllowed?: number;
  permittedStayDays?: number;
}

export interface ResidenceDetailInput {
  kind: 'RESIDENCE_PERMIT';
  documentNumber: ProtectedDataRef;
}

export interface HealthDetailInput {
  kind: 'HEALTH_CREDENTIAL';
  documentNumber: ProtectedDataRef;
}

export interface TravellerMergeParams {
  workspaceId: string;
  travellerId: string;
  mergedIntoTravellerId: string;
  expectedRevision: number;
  actor: ActorContext;
}

/**
 * Writes and reads the Traveller root and its children. `create` is the only
 * method that registers identity, so a Traveller can never exist as a bare
 * `domain_subjects` row without its typed rows (0012's subtype checker).
 */
export interface TravellerRepository {
  create(params: NewTraveller & { actor: ActorContext }): Promise<void>;
  load(workspaceId: string, travellerId: string): Promise<Traveller | undefined>;
  loadName(workspaceId: string, nameId: string): Promise<TravellerNameRecord | undefined>;
  listNames(workspaceId: string, travellerId: string): Promise<TravellerNameRecord[]>;
  listContacts(workspaceId: string, travellerId: string): Promise<TravellerContactRecord[]>;
  addName(params: { travellerId: string; name: TravellerNameRecord; actor: ActorContext }): Promise<void>;
  addContact(params: { travellerId: string; contact: TravellerContactRecord; actor: ActorContext }): Promise<void>;
  appendProfileAssertion(params: { assertion: ProfileAssertion; actor: ActorContext }): Promise<void>;
  listProfileAssertions(
    workspaceId: string,
    travellerId: string,
    opts?: { currentOnly?: boolean; assertionType?: ProfileAssertion['assertionType'] },
  ): Promise<ProfileAssertion[]>;
  merge(params: TravellerMergeParams): Promise<number>;
  recordRelationship(params: { relationship: TravellerRelationship; actor: ActorContext }): Promise<void>;
  listRelationships(
    workspaceId: string,
    travellerId: string,
    direction: 'FROM' | 'TO' | 'ANY',
  ): Promise<TravellerRelationship[]>;
  recordCredential(params: NewCredentialVersion & { actor: ActorContext }): Promise<void>;
  loadCredential(workspaceId: string, credentialId: string): Promise<TravelCredential | undefined>;
  listCredentials(workspaceId: string, travellerId: string): Promise<TravelCredential[]>;
  listCredentialVersions(workspaceId: string, credentialId: string): Promise<CredentialVersion[]>;
  linkCredentials(params: { link: CredentialLink; actor: ActorContext }): Promise<void>;
  recordHistory(params: { history: TravelHistoryRecord; actor: ActorContext }): Promise<void>;
}

export interface NewOrganisation {
  organisation: {
    id: string;
    legalName: string;
    displayName?: string;
    /** 0011: NOT NULL `char(3)` — a currency is a stated business fact, never a default. */
    defaultCurrencyCode: string;
    lifecycleStatus: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  };
  actor: ActorContext;
}

export interface NewPrincipal {
  principal: {
    id: string;
    actorType: 'HUMAN' | 'SERVICE' | 'SYSTEM';
    /** 0011: both NOT NULL and the unique auth identity within the workspace. */
    authIssuer: string;
    authSubject: string;
  };
  actor: ActorContext;
}

/**
 * A principal's sourced association with an organisation (0011). A membership is
 * neither a principal child nor an organisation child — it names both owners and
 * carries its own provenance, so it is written by its own operation rather than
 * smuggled inside a principal creation that cannot supply `evidence_id`.
 */
export interface OrganisationMembershipRecord {
  id: string;
  organisationId: string;
  principalId: string;
  role: 'STAFF' | 'AGENT' | 'MEMBER';
  validRange: DateRange;
  evidenceId: string;
}

/** Organisation/principal governance roots (§2): parties, identities and memberships. */
export interface GovernanceRepository {
  createOrganisation(params: NewOrganisation): Promise<void>;
  loadOrganisation(workspaceId: string, organisationId: string): Promise<NewOrganisation['organisation'] | undefined>;
  createPrincipal(params: NewPrincipal): Promise<void>;
  loadPrincipal(workspaceId: string, principalId: string): Promise<NewPrincipal['principal'] | undefined>;
  recordMembership(params: { membership: OrganisationMembershipRecord; actor: ActorContext }): Promise<void>;
  assignResponsibility(params: {
    assignment: ResponsibilityAssignment;
    actor: ActorContext;
  }): Promise<void>;
  listResponsibilityForSubject(
    workspaceId: string,
    subjectRef: TypedRef,
  ): Promise<ResponsibilityAssignment[]>;
  issueAuthorityGrant(params: {
    grant: AuthorityGrant;
    /**
     * Identity of the command receipt that authorised the grant. Persisted on
     * `authority_grants` and checked by a deferrable FK into `command_receipts`:
     * deferred because `PgUnitOfWork` inserts this command's own receipt after
     * the handler body has run.
     */
    receipt: { commandNamespace: string; idempotencyKey: string };
    actor: ActorContext;
  }): Promise<void>;
  listEffectiveGrants(
    workspaceId: string,
    principalId: string,
    at: Instant,
  ): Promise<AuthorityGrant[]>;
  /**
   * Authority evaluation seam for M9 and for command handlers: the closed
   * action vocabulary is `authority_action_kinds`, so an unregistered action
   * kind is reported as not-authorised rather than matching everything.
   */
  mayPrincipalAct(params: {
    workspaceId: string;
    principalId: string;
    actionKind: string;
    subjectRef: TypedRef;
    at: Instant;
  }): Promise<boolean>;
  revokeAuthorityGrant(params: {
    workspaceId: string;
    grantId: string;
    revokedAt: Instant;
    actor: ActorContext;
  }): Promise<void>;
}

export type M2PeopleSubjectKind = Extract<
  SubjectKind,
  'ORGANISATION' | 'PRINCIPAL' | 'TRAVELLER' | 'TRAVELLER_RELATIONSHIP' | 'RESPONSIBILITY_ASSIGNMENT' | 'AUTHORITY_GRANT'
>;

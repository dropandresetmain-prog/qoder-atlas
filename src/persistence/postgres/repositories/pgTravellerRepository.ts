/**
 * NORTHSTAR M2 lane P — PostgreSQL `TravellerRepository`.
 *
 * Typed-row SQL only. Every method here runs on the ambient transaction client
 * installed by `PgUnitOfWork.execute`, writes only the tables the Traveller
 * aggregate owns (`travellers`, `traveller_names`, `traveller_contacts`,
 * `profile_assertions`, `travel_credentials`, `credential_versions`, the four
 * 0015 typed detail tables, `credential_links`, `traveller_relationships`,
 * `travel_history`) and never claims idempotency, never inserts
 * `change_records`/`outbox` and never advances a head — that is the command
 * handler's job (`src/persistence/postgres/peopleCommands.ts`), mirroring the
 * accepted `workspaceCommands.ts` precedent.
 *
 * Aggregate policy this file depends on (docs/DATA_STRUCTURE_LOGICAL_SCHEMA.md
 * §1/§2, frozen by the M2 lane brief): `TRAVELLER` and `TRAVELLER_RELATIONSHIP`
 * are registry roots with their own `aggregate_heads` row; `traveller_names`,
 * `traveller_contacts`, `profile_assertions`, `travel_credentials`,
 * `credential_versions`, typed credential details, `credential_links` and
 * `travel_history` are plain children with **no** registry row and **no** head
 * of their own, so nothing here registers them.
 *
 * Architecture gaps this implementation deliberately reports instead of papering
 * over are marked `GAP(G-Pn)` at the site where the frozen contract and the
 * real DDL disagree.
 */
import {
  TravellerRelationshipSchema,
  type CredentialLink,
  type CredentialVersion,
  type ProfileAssertion,
  type TravelCredential,
  type Traveller,
  type TravellerRelationship,
} from '../../../domain/v2/people/traveller.ts';
import type { LocalDate } from '../../../domain/v2/shared/time.ts';
import { currentTransactionClient } from '../transactionContext.ts';
import type {
  ActorContext,
  NameKind,
  NewCredentialVersion,
  NewTraveller,
  TravelHistoryRecord,
  TravellerContactRecord,
  TravellerMergeParams,
  TravellerNameRecord,
  TravellerRepository,
} from '../../../contracts/v2/repository/people.ts';

/**
 * `profile_assertions.value_schema_version` is NOT NULL (0013) while the frozen
 * `ProfileAssertionSchema` carries no schema-version field. Persistence
 * therefore stamps the version of the *writer's* contract rather than
 * inventing a domain fact; the value is stable, derived from
 * `src/domain/v2/people/traveller.ts`.
 * GAP(G-P2): the port cannot carry an assertion value schema version.
 */
export const PROFILE_ASSERTION_VALUE_SCHEMA_VERSION = 'domain-v2/ProfileAssertionSchema/1';

/**
 * `residence_credential_details.residence_type` and
 * `health_credential_details.product_name` are NOT NULL with a non-blank CHECK
 * (0015), but `ResidenceDetailInput`/`HealthDetailInput` (frozen in
 * `contracts/v2/repository/people.ts`) carry only `kind` + `documentNumber`.
 * The only claim that is not a fabricated certainty is "the source did not
 * state it", matching 0015's own treatment of an unstated `entries_allowed`.
 * GAP(G-P4): a frozen detail input that cannot fill its own NOT NULL column.
 */
export const PROTECTED_DETAIL_NOT_STATED = 'UNSTATED';

interface TravellerRow {
  id: string;
  display_name_ref: string;
  lifecycle_status: 'ACTIVE' | 'MERGED' | 'ARCHIVED';
  merged_into_traveller_id: string | null;
  revision: string; // bigint arrives as a string from node-postgres
}

interface TravellerNameRow {
  id: string;
  name_kind: NameKind;
  display_value: string;
  family_name: string | null;
  given_name: string | null;
  valid_from: string; // read with to_char: never a local-midnight Date
  valid_until: string | null;
  evidence_id: string;
}

interface TravellerContactRow {
  id: string;
  channel_kind: string;
  masked_label: string;
  value_content_hash: string;
  value_storage_ref: string;
  value_access_policy_id: string;
  valid_from: string;
  valid_until: string | null;
  evidence_id: string;
}

interface ProfileAssertionRow {
  id: string;
  traveller_id: string;
  assertion_type: ProfileAssertion['assertionType'];
  effective_from: string;
  effective_to: string | null;
  value: Record<string, unknown>;
  evidence_id: string;
  supersedes_assertion_id: string | null;
}

interface CredentialRow {
  id: string;
  traveller_id: string;
  kind: TravelCredential['kind'];
  issuer_country: string;
  current_version_id: string;
}

interface CredentialVersionRow {
  id: string;
  credential_id: string;
  issue_date: string;
  expiry_date: string | null;
  issuer_status: CredentialVersion['issuerStatus'];
  physically_available: boolean | null;
  evidence_id: string;
  accepted_at: Date;
}

interface RelationshipRow {
  id: string;
  from_traveller_id: string;
  to_traveller_id: string;
  relationship_type: TravellerRelationship['relationshipType'];
  effective_from: string;
  effective_to: string | null;
  evidence_id: string;
}

function toNameRecord(row: TravellerNameRow): TravellerNameRecord {
  return {
    id: row.id,
    nameKind: row.name_kind,
    displayValue: row.display_value,
    familyName: row.family_name ?? undefined,
    givenName: row.given_name ?? undefined,
    effectiveRange: { start: row.valid_from as LocalDate, end: (row.valid_until ?? undefined) as LocalDate | undefined },
    evidenceId: row.evidence_id,
  };
}

function toContactRecord(row: TravellerContactRow): TravellerContactRecord {
  return {
    id: row.id,
    channel: row.channel_kind,
    maskedLabel: row.masked_label,
    protectedValue: {
      contentHash: row.value_content_hash,
      storageRef: row.value_storage_ref,
      accessPolicyId: row.value_access_policy_id,
    },
    effectiveRange: { start: row.valid_from as LocalDate, end: (row.valid_until ?? undefined) as LocalDate | undefined },
    evidenceId: row.evidence_id,
  };
}

function toAssertion(row: ProfileAssertionRow): ProfileAssertion {
  return {
    id: row.id,
    travellerId: row.traveller_id,
    assertionType: row.assertion_type,
    effectiveRange: { start: row.effective_from as LocalDate, end: (row.effective_to ?? undefined) as LocalDate | undefined },
    evidenceId: row.evidence_id,
    value: row.value,
    supersedesAssertionId: row.supersedes_assertion_id ?? undefined,
  };
}

/** `date` columns are always read through `to_char` so a driver Date can never shift the calendar day. */
const DATE = (column: string): string => `to_char(${column}, 'YYYY-MM-DD')`;

export class PgTravellerRepository implements TravellerRepository {
  private readonly workspaceId: string;

  constructor(workspaceId: string) {
    this.workspaceId = workspaceId;
  }

  /**
   * Writes the Traveller root row plus its display-name edition and any
   * contacts. `traveller_names.traveller_id` is an immediate FK while
   * `travellers.display_name_ref` is deferred, so the person must be inserted
   * before the name that cites it (the same order `postgres-integration/m2Seed.ts`
   * proves against the live database).
   */
  async create(params: NewTraveller & { actor: ActorContext }): Promise<void> {
    const client = currentTransactionClient();
    const { traveller, displayName, contacts } = params;
    if (params.relationships !== undefined && params.relationships.length > 0) {
      // GAP(G-P1): `NewTraveller.relationships` cannot be persisted here —
      // `traveller_relationships` is its own registry root, so writing it would
      // require this repository to create aggregate heads, which the M2
      // division of labour reserves for command handlers. Relationships are
      // recorded through `recordRelationship` / the
      // `TRAVELLER_RELATIONSHIP_RECORDED` command instead.
      throw new Error(
        'architecture gap G-P1: NewTraveller.relationships cannot be written by TravellerRepository.create; record each relationship as its own root subject',
      );
    }
    if (traveller.workspaceId !== this.workspaceId) {
      throw new Error(`traveller.workspaceId ${traveller.workspaceId} is not this repository's workspace ${this.workspaceId}`);
    }

    await client.query(
      `INSERT INTO travellers (workspace_id, id, display_name_ref, lifecycle_status, merged_into_traveller_id, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        this.workspaceId,
        traveller.id,
        displayName.id,
        traveller.lifecycleStatus,
        traveller.mergedIntoTravellerId ?? null,
        params.actor.actorPrincipalId,
      ],
    );
    await this.insertName(client, traveller.id, displayName, params.actor.actorPrincipalId);
    for (const contact of contacts ?? []) {
      await this.insertContact(client, traveller.id, contact, params.actor.actorPrincipalId);
    }
  }

  async load(workspaceId: string, travellerId: string): Promise<Traveller | undefined> {
    const client = currentTransactionClient();
    const result = await client.query<TravellerRow>(
      `SELECT t.id, t.display_name_ref, t.lifecycle_status, t.merged_into_traveller_id, h.revision
         FROM travellers t
         JOIN aggregate_heads h ON h.workspace_id = t.workspace_id AND h.aggregate_id = t.id
        WHERE t.workspace_id = $1 AND t.id = $2`,
      [workspaceId, travellerId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      id: row.id,
      workspaceId,
      revision: Number(row.revision),
      displayNameRef: row.display_name_ref,
      lifecycleStatus: row.lifecycle_status,
      mergedIntoTravellerId: row.merged_into_traveller_id ?? undefined,
    };
  }

  async loadName(workspaceId: string, nameId: string): Promise<TravellerNameRecord | undefined> {
    const client = currentTransactionClient();
    const result = await client.query<TravellerNameRow>(
      `SELECT id, name_kind, display_value, family_name, given_name,
              ${DATE('valid_from')} AS valid_from, ${DATE('valid_until')} AS valid_until, evidence_id
         FROM traveller_names
        WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, nameId],
    );
    const row = result.rows[0];
    return row ? toNameRecord(row) : undefined;
  }

  /** `idx_traveller_names_traveller (workspace_id, traveller_id, name_kind)`. */
  async listNames(workspaceId: string, travellerId: string): Promise<TravellerNameRecord[]> {
    const client = currentTransactionClient();
    const result = await client.query<TravellerNameRow>(
      `SELECT id, name_kind, display_value, family_name, given_name,
              ${DATE('valid_from')} AS valid_from, ${DATE('valid_until')} AS valid_until, evidence_id
         FROM traveller_names
        WHERE workspace_id = $1 AND traveller_id = $2
        ORDER BY valid_from, id`,
      [workspaceId, travellerId],
    );
    return result.rows.map(toNameRecord);
  }

  /**
   * Returns only the `(content_hash, storage_ref, access_policy_id)` triple plus
   * the renderable mask: there is no plaintext column to read (0012).
   */
  async listContacts(workspaceId: string, travellerId: string): Promise<TravellerContactRecord[]> {
    const client = currentTransactionClient();
    const result = await client.query<TravellerContactRow>(
      `SELECT id, channel_kind, masked_label, value_content_hash, value_storage_ref, value_access_policy_id,
              ${DATE('valid_from')} AS valid_from, ${DATE('valid_until')} AS valid_until, evidence_id
         FROM traveller_contacts
        WHERE workspace_id = $1 AND traveller_id = $2
        ORDER BY valid_from, id`,
      [workspaceId, travellerId],
    );
    return result.rows.map(toContactRecord);
  }

  async addName(params: {
    travellerId: string;
    name: TravellerNameRecord;
    actor: ActorContext;
  }): Promise<void> {
    const client = currentTransactionClient();
    await this.insertName(client, params.travellerId, params.name, params.actor.actorPrincipalId);
  }

  async addContact(params: {
    travellerId: string;
    contact: TravellerContactRecord;
    actor: ActorContext;
  }): Promise<void> {
    const client = currentTransactionClient();
    await this.insertContact(client, params.travellerId, params.contact, params.actor.actorPrincipalId);
  }

  async appendProfileAssertion(params: {
    assertion: ProfileAssertion;
    actor: ActorContext;
  }): Promise<void> {
    const client = currentTransactionClient();
    const { assertion } = params;
    await client.query(
      `INSERT INTO profile_assertions
         (workspace_id, id, traveller_id, assertion_type, effective_from, effective_to,
          value, value_schema_version, evidence_id, supersedes_assertion_id, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5::date, $6::date, $7::jsonb, $8, $9, $10, $11)`,
      [
        this.workspaceId,
        assertion.id,
        assertion.travellerId,
        assertion.assertionType,
        assertion.effectiveRange.start,
        assertion.effectiveRange.end ?? null,
        JSON.stringify(assertion.value),
        PROFILE_ASSERTION_VALUE_SCHEMA_VERSION, // GAP(G-P2)
        assertion.evidenceId,
        assertion.supersedesAssertionId ?? null,
        params.actor.actorPrincipalId,
      ],
    );
  }

  /**
   * A current edition is one that nothing later supersedes. Because the table is
   * append-only (0013) the supersession pointer lives on the *new* row, so
   * `supersedes_assertion_id IS NULL` only identifies a chain's first edition;
   * "current" is therefore an anti-join, served by 0013's
   * `idx_profile_assertions_supersedes` rather than by a partial index.
   */
  async listProfileAssertions(
    workspaceId: string,
    travellerId: string,
    opts?: { currentOnly?: boolean; assertionType?: ProfileAssertion['assertionType'] },
  ): Promise<ProfileAssertion[]> {
    const client = currentTransactionClient();
    const result = await client.query<ProfileAssertionRow>(
      `SELECT p.id, p.traveller_id, p.assertion_type,
              ${DATE('p.effective_from')} AS effective_from, ${DATE('p.effective_to')} AS effective_to,
              p.value, p.evidence_id, p.supersedes_assertion_id
         FROM profile_assertions p
        WHERE p.workspace_id = $1
          AND p.traveller_id = $2
          AND ($3::text IS NULL OR p.assertion_type = $3)
          AND ($4::bool IS NOT TRUE OR NOT EXISTS (
                 SELECT 1 FROM profile_assertions superseding
                  WHERE superseding.workspace_id = p.workspace_id
                    AND superseding.supersedes_assertion_id = p.id))
        ORDER BY p.assertion_type, p.effective_from, p.id`,
      [workspaceId, travellerId, opts?.assertionType ?? null, opts?.currentOnly === true],
    );
    return result.rows.map(toAssertion);
  }

  /**
   * Performs the redirect write only: `MERGED` is a lifecycle transition with a
   * mandatory surviving person (0012's `travellers_merge_shape` and
   * `travellers_not_self_merge` remain the real guards).
   *
   * The frozen port returns `Promise<number>`, which for a repository that owns
   * no counter can only be the revision the enclosing handler just advanced, so
   * this method *reads* (never writes) `aggregate_heads` to report it.
   * GAP(G-P7): a typed-row repository port cannot express "return the new
   * revision" without a head read; `merge()` would more honestly be `void`.
   */
  async merge(params: TravellerMergeParams): Promise<number> {
    const client = currentTransactionClient();
    const updated = await client.query(
      `UPDATE travellers
          SET lifecycle_status = 'MERGED', merged_into_traveller_id = $3, updated_at = now()
        WHERE workspace_id = $1 AND id = $2 AND lifecycle_status = 'ACTIVE'`,
      [params.workspaceId, params.travellerId, params.mergedIntoTravellerId],
    );
    if (updated.rowCount !== 1) {
      throw new Error(
        `merge: no ACTIVE travellers row for ${params.workspaceId}/${params.travellerId} to redirect`,
      );
    }
    const head = await client.query<{ revision: string }>(
      'SELECT revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2',
      [params.workspaceId, params.travellerId],
    );
    return Number(head.rows[0]?.revision ?? 0);
  }

  /**
   * Writes only the relationship row. The caller has already created the
   * `TRAVELLER_RELATIONSHIP` root; 0017's EXCLUDE constraint rejects an
   * overlapping duplicate record of the same directional relationship.
   */
  async recordRelationship(params: {
    relationship: TravellerRelationship;
    actor: ActorContext;
  }): Promise<void> {
    const client = currentTransactionClient();
    const relationship = TravellerRelationshipSchema.parse(params.relationship);
    await client.query(
      `INSERT INTO traveller_relationships
         (workspace_id, id, from_traveller_id, to_traveller_id, relationship_type,
          effective_from, effective_to, evidence_id, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6::date, $7::date, $8, $9)`,
      [
        this.workspaceId,
        relationship.id,
        relationship.fromTravellerId,
        relationship.toTravellerId,
        relationship.relationshipType,
        relationship.effectiveRange.start,
        relationship.effectiveRange.end ?? null,
        relationship.evidenceId,
        params.actor.actorPrincipalId,
      ],
    );
  }

  /** `idx_traveller_relationships_from` + `idx_traveller_relationships_to` (BitmapOr). */
  async listRelationships(
    workspaceId: string,
    travellerId: string,
    direction: 'FROM' | 'TO' | 'ANY',
  ): Promise<TravellerRelationship[]> {
    const client = currentTransactionClient();
    const result = await client.query<RelationshipRow>(
      `SELECT id, from_traveller_id, to_traveller_id, relationship_type,
              ${DATE('effective_from')} AS effective_from, ${DATE('effective_to')} AS effective_to, evidence_id
         FROM traveller_relationships
        WHERE workspace_id = $1
          AND ($2 = 'FROM' AND from_traveller_id = $3
            OR $2 = 'TO' AND to_traveller_id = $3
            OR $2 = 'ANY' AND (from_traveller_id = $3 OR to_traveller_id = $3))
        ORDER BY effective_from, id`,
      [workspaceId, direction, travellerId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      fromTravellerId: row.from_traveller_id,
      toTravellerId: row.to_traveller_id,
      relationshipType: row.relationship_type,
      effectiveRange: {
        start: row.effective_from as LocalDate,
        end: (row.effective_to ?? undefined) as LocalDate | undefined,
      },
      evidenceId: row.evidence_id,
    }));
  }

  /**
   * Creates the credential on its first accepted edition and re-points
   * `current_version_id` on every later one. Edition numbers are derived in
   * SQL (`max + 1` per credential) because the frozen `CredentialVersion`
   * carries no edition field while 0014 requires a unique one — a caller must
   * never claim an edition number. GAP(G-P3).
   */
  async recordCredential(params: NewCredentialVersion & { actor: ActorContext }): Promise<void> {
    const client = currentTransactionClient();
    const { credential, version, detail } = params;
    const actorId = params.actor.actorPrincipalId;

    if (credential.kind === 'E_AUTHORISATION' && detail !== undefined) {
      // GAP(G-P8): 0015 records that §2 names no detail table for
      // E_AUTHORISATION, so a typed detail for that kind has nowhere to go.
      throw new Error(
        'architecture gap G-P8: E_AUTHORISATION has no typed credential detail table in the frozen 0015 inventory',
      );
    }
    if (params.documentNumber !== undefined) {
      // GAP(G-P9): `NewCredentialVersion.documentNumber` duplicates
      // `detail.documentNumber`; the only protected-identifier columns in the
      // schema are on the typed detail row, so an identifier with nowhere to be
      // written is rejected rather than silently dropped.
      const sameTriple =
        detail !== undefined &&
        detail.documentNumber.contentHash === params.documentNumber.contentHash &&
        detail.documentNumber.storageRef === params.documentNumber.storageRef &&
        detail.documentNumber.accessPolicyId === params.documentNumber.accessPolicyId;
      if (!sameTriple) {
        throw new Error(
          'architecture gap G-P9: a credential document number without a matching typed detail row has no column to live in',
        );
      }
    }
    // `detail === undefined` for a four-kind credential is deliberately not
    // rejected here: 0015's deferred `credential_versions_typed_detail_assert`
    // is the authority that makes a detail-less accepted edition impossible,
    // and it fires at COMMIT.
    if (version.credentialId !== credential.id) {
      throw new Error(
        `credential_versions row ${version.id} cites credential ${version.credentialId} but is being recorded against ${credential.id}`,
      );
    }
    const existing = await client.query<{ traveller_id: string; kind: TravelCredential['kind'] }>(
      'SELECT traveller_id, kind FROM travel_credentials WHERE workspace_id = $1 AND id = $2',
      [this.workspaceId, credential.id],
    );
    const current = existing.rows[0];
    if (current) {
      if (current.traveller_id !== credential.travellerId || current.kind !== credential.kind) {
        throw new Error(
          `credential ${credential.id} is already a ${current.kind} of traveller ${current.traveller_id}; an accepted edition cannot move a document to another person or kind`,
        );
      }
      await client.query(
        `UPDATE travel_credentials
            SET current_version_id = $3, updated_at = now()
          WHERE workspace_id = $1 AND id = $2`,
        [this.workspaceId, credential.id, version.id],
      );
    } else {
      await client.query(
        `INSERT INTO travel_credentials
           (workspace_id, id, traveller_id, kind, issuer_country, current_version_id, created_by_actor_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          this.workspaceId,
          credential.id,
          credential.travellerId,
          credential.kind,
          credential.issuerCountry,
          version.id,
          actorId,
        ],
      );
    }

    await client.query(
      `INSERT INTO credential_versions
           (workspace_id, id, credential_id, kind, edition_number, issue_date, expiry_date,
            issuer_status, physically_available, evidence_id, accepted_at, created_by_actor_id)
       SELECT $1, $2, $3, $4, COALESCE(MAX(v.edition_number), 0) + 1,
              $5::date, $6::date, $7, $8, $9, $10::timestamptz, $11
         FROM credential_versions v
        WHERE v.workspace_id = $1 AND v.credential_id = $3`,
      [
        this.workspaceId,
        version.id,
        version.credentialId,
        credential.kind,
        version.issueDate,
        version.expiryDate ?? null,
        version.issuerStatus,
        version.physicallyAvailable ?? null,
        version.evidenceId,
        version.acceptedAt,
        actorId,
      ],
    );

    if (detail !== undefined) {
      await this.insertTypedDetail(client, credential, version.id, detail, actorId);
    }
  }

  async loadCredential(workspaceId: string, credentialId: string): Promise<TravelCredential | undefined> {
    const client = currentTransactionClient();
    const result = await client.query<CredentialRow>(
      'SELECT id, traveller_id, kind, issuer_country, current_version_id FROM travel_credentials WHERE workspace_id = $1 AND id = $2',
      [workspaceId, credentialId],
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          travellerId: row.traveller_id,
          kind: row.kind,
          issuerCountry: row.issuer_country,
          currentVersionId: row.current_version_id,
        }
      : undefined;
  }

  /** `idx_travel_credentials_traveller (workspace_id, traveller_id, kind)`. */
  async listCredentials(workspaceId: string, travellerId: string): Promise<TravelCredential[]> {
    const client = currentTransactionClient();
    const result = await client.query<CredentialRow>(
      'SELECT id, traveller_id, kind, issuer_country, current_version_id FROM travel_credentials WHERE workspace_id = $1 AND traveller_id = $2 ORDER BY kind, id',
      [workspaceId, travellerId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      travellerId: row.traveller_id,
      kind: row.kind,
      issuerCountry: row.issuer_country,
      currentVersionId: row.current_version_id,
    }));
  }

  /** `idx_credential_versions_credential (workspace_id, credential_id, edition_number DESC)`. */
  async listCredentialVersions(workspaceId: string, credentialId: string): Promise<CredentialVersion[]> {
    const client = currentTransactionClient();
    const result = await client.query<CredentialVersionRow>(
      `SELECT id, credential_id, ${DATE('issue_date')} AS issue_date, ${DATE('expiry_date')} AS expiry_date,
              issuer_status, physically_available, evidence_id, accepted_at
         FROM credential_versions
        WHERE workspace_id = $1 AND credential_id = $2
        ORDER BY edition_number`,
      [workspaceId, credentialId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      credentialId: row.credential_id,
      issueDate: row.issue_date as LocalDate,
      expiryDate: (row.expiry_date ?? undefined) as LocalDate | undefined,
      issuerStatus: row.issuer_status,
      physicallyAvailable: row.physically_available ?? undefined,
      evidenceId: row.evidence_id,
      acceptedAt: row.accepted_at.toISOString(),
    }));
  }

  async linkCredentials(params: { link: CredentialLink; actor: ActorContext }): Promise<void> {
    const client = currentTransactionClient();
    const { link } = params;
    await client.query(
      `INSERT INTO credential_links
         (workspace_id, credential_id, related_credential_id, traveller_id, link_type,
          effective_from, effective_to, evidence_id, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6::date, $7::date, $8, $9)`,
      [
        this.workspaceId,
        link.credentialId,
        link.relatedCredentialId,
        link.travellerId,
        link.linkType,
        link.effectiveRange.start,
        link.effectiveRange.end ?? null,
        link.evidenceId,
        params.actor.actorPrincipalId,
      ],
    );
  }

  /**
   * Observed entry/exit movement. `travel_history` is a Traveller child with no
   * registry row, so the enclosing command advances the Traveller head and this
   * method registers nothing.
   */
  async recordHistory(params: { history: TravelHistoryRecord; actor: ActorContext }): Promise<void> {
    const client = currentTransactionClient();
    const { history } = params;
    await client.query(
      `INSERT INTO travel_history
         (workspace_id, id, traveller_id, jurisdiction_id, entry_date, exit_date,
          coverage_claim, uncertainty_note, evidence_id, recorded_at, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, $8, $9, $10::timestamptz, $11)`,
      [
        this.workspaceId,
        history.id,
        history.travellerId,
        history.jurisdictionId,
        history.entryDate ?? null,
        history.exitDate ?? null,
        history.coverageClaim,
        history.uncertaintyNote ?? null,
        history.evidenceId,
        history.recordedAt,
        params.actor.actorPrincipalId,
      ],
    );
  }

  private async insertName(
    client: ReturnType<typeof currentTransactionClient>,
    travellerId: string,
    name: TravellerNameRecord,
    actorId: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO traveller_names
         (workspace_id, id, traveller_id, name_kind, display_value, family_name, given_name,
          valid_from, valid_until, evidence_id, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9::date, $10, $11)`,
      [
        this.workspaceId,
        name.id,
        travellerId,
        name.nameKind,
        name.displayValue,
        name.familyName ?? null,
        name.givenName ?? null,
        name.effectiveRange.start,
        name.effectiveRange.end ?? null,
        name.evidenceId,
        actorId,
      ],
    );
  }

  private async insertContact(
    client: ReturnType<typeof currentTransactionClient>,
    travellerId: string,
    contact: TravellerContactRecord,
    actorId: string,
  ): Promise<void> {
    // Only the triple is bound. No plaintext identifier or address value ever
    // reaches this statement, so nothing here can leak into a log or a prompt.
    await client.query(
      `INSERT INTO traveller_contacts
         (workspace_id, id, traveller_id, channel_kind, masked_label,
          value_content_hash, value_storage_ref, value_access_policy_id,
          valid_from, valid_until, evidence_id, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10::date, $11, $12)`,
      [
        this.workspaceId,
        contact.id,
        travellerId,
        contact.channel,
        contact.maskedLabel,
        contact.protectedValue.contentHash,
        contact.protectedValue.storageRef,
        contact.protectedValue.accessPolicyId,
        contact.effectiveRange.start,
        contact.effectiveRange.end ?? null,
        contact.evidenceId,
        actorId,
      ],
    );
  }

  private async insertTypedDetail(
    client: ReturnType<typeof currentTransactionClient>,
    credential: NewCredentialVersion['credential'],
    versionId: string,
    detail: NonNullable<NewCredentialVersion['detail']>,
    actorId: string,
  ): Promise<void> {
    const triple = [
      detail.documentNumber.contentHash,
      detail.documentNumber.storageRef,
      detail.documentNumber.accessPolicyId,
    ];
    if (detail.kind === 'PASSPORT') {
      if (detail.nationalityCountry !== undefined || detail.machineReadable !== undefined) {
        // GAP(G-P5): 0015's passport_details has neither a nationality nor a
        // machine-readable column, so the frozen input cannot carry them.
        throw new Error(
          'architecture gap G-P5: passport_details has no nationality or machine-readable column',
        );
      }
      await client.query(
        `INSERT INTO passport_details
           (workspace_id, credential_version_id, kind, issuing_state_code,
            document_number_content_hash, document_number_storage_ref,
            document_number_access_policy_id, created_by_actor_id)
         VALUES ($1, $2, 'PASSPORT', $3, $4, $5, $6, $7)`,
        [this.workspaceId, versionId, credential.issuerCountry, ...triple, actorId],
      );
      return;
    }
    if (detail.kind === 'VISA') {
      await client.query(
        `INSERT INTO visa_details
           (workspace_id, credential_version_id, kind, issuing_state_code,
            document_number_content_hash, document_number_storage_ref,
            document_number_access_policy_id, visa_class, permitted_activities,
            restrictions, entries_allowed, permitted_stay_days, created_by_actor_id)
         VALUES ($1, $2, 'VISA', $3, $4, $5, $6, $7, $8::text[], $9, $10, $11, $12)`,
        [
          this.workspaceId,
          versionId,
          credential.issuerCountry,
          ...triple,
          detail.visaClass ?? PROTECTED_DETAIL_NOT_STATED, // GAP(G-P4) family
          detail.permittedActivities ?? [],
          detail.restrictions ?? null,
          detail.entriesAllowed ?? null,
          detail.permittedStayDays ?? null,
          actorId,
        ],
      );
      return;
    }
    if (detail.kind === 'RESIDENCE_PERMIT') {
      // GAP(G-P4): `ResidenceDetailInput` carries no residence type while
      // 0015's `residence_type` is NOT NULL with a non-blank CHECK.
      await client.query(
        `INSERT INTO residence_credential_details
           (workspace_id, credential_version_id, kind, issuing_state_code,
            document_number_content_hash, document_number_storage_ref,
            document_number_access_policy_id, residence_type, created_by_actor_id)
         VALUES ($1, $2, 'RESIDENCE_PERMIT', $3, $4, $5, $6, $7, $8)`,
        [this.workspaceId, versionId, credential.issuerCountry, ...triple, PROTECTED_DETAIL_NOT_STATED, actorId],
      );
      return;
    }
    // GAP(G-P4): `HealthDetailInput` carries no product name while 0015's
    // `product_name` is NOT NULL with a non-blank CHECK.
    await client.query(
      `INSERT INTO health_credential_details
         (workspace_id, credential_version_id, kind, issuing_state_code,
          document_number_content_hash, document_number_storage_ref,
          document_number_access_policy_id, product_name, created_by_actor_id)
       VALUES ($1, $2, 'HEALTH_CREDENTIAL', $3, $4, $5, $6, $7, $8)`,
      [this.workspaceId, versionId, credential.issuerCountry, ...triple, PROTECTED_DETAIL_NOT_STATED, actorId],
    );
  }
}

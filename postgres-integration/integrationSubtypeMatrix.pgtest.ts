/**
 * M6 integration evidence: table-driven proof that every M2-M5 activated
 * subject kind's typed-table enforcement (0010 dispatcher + per-kind checker,
 * see m2SubtypeIntegrity.pgtest.ts) holds for EVERY kind, not just the
 * hand-picked ones the per-lane suites happen to exercise.
 *
 * For every kind in the union of M2_ACTIVATED_KINDS / M3_ACTIVATED_KINDS /
 * M4_ACTIVATED_KINDS / M5_ACTIVATED_KINDS (copied verbatim from
 * m2SubtypeIntegrity.pgtest.ts) this file proves four properties:
 *   1. VALID:     registry row (+head if root) + a valid typed row commits.
 *   2. MISSING:   registry row (+head if root) with NO typed row fails at
 *                 COMMIT.
 *   3. WRONG KIND: a real, valid typed row for kind K, registered under a
 *                 DIFFERENT activated kind K' (the next kind in the union
 *                 list), fails at COMMIT -- a real row under the wrong table
 *                 must not satisfy K''s checker.
 *   4. CROSS-WORKSPACE: a typed row that exists only in workspace A does not
 *                 satisfy a registry row of the same id+kind in workspace B.
 *                 Where the kind's typed row carries a parent/owner FK
 *                 (JOURNEY -> trip/traveller, JOURNEY_ITEM -> journey,
 *                 PROGRAMME -> event, PARTICIPATION -> programme item /
 *                 traveller, RESERVATION_LINE -> reservation, and every other
 *                 child-aggregate kind), a dedicated sub-test also proves that
 *                 FK cannot be redirected at a foreign workspace's row.
 *
 * Every kind is driven off one `KindCase` descriptor: `prepareDeps` builds
 * whatever prerequisite rows the typed row's own FKs require (reusing
 * m2Seed/m3Seed/m4Seed helpers wherever one already exists), and
 * `insertTypedRowOnly` inserts ONLY the kind's own typed row (and any child
 * rows its own deferred consistency triggers require) -- deliberately never
 * touching `domain_subjects`/`aggregate_heads`, so the four properties above
 * can drive registration independently of typed-row content.
 */
import { after, test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import {
  beginSeed,
  commitSeed,
  rollbackSeed,
  seedChildSubject,
  seedJourney,
  seedRootSubject,
  seedTraveller,
  seedTrip,
  takeSeedEvidence,
  type SeedSession,
} from './m2Seed.ts';
import { seedExternalConnection, seedOrganisation, seedReservation, seedResource } from './m3Seed.ts';
import { seedEvent, seedPlace, seedProgramme, seedProgrammeItem } from './m4Seed.ts';

/** Kinds M2 activates -- must match docs/refactor/evidence/M2.md exactly (copied from m2SubtypeIntegrity.pgtest.ts). */
const M2_ACTIVATED_KINDS = [
  'ORGANISATION',
  'PRINCIPAL',
  'TRAVELLER',
  'TRAVELLER_RELATIONSHIP',
  'RESPONSIBILITY_ASSIGNMENT',
  'AUTHORITY_GRANT',
  'TRIP',
  'JOURNEY',
  'JOURNEY_ITEM',
  'COORDINATION_GROUP',
  'SUPPORT_ASSIGNMENT',
];

/** Kinds M3 activates -- must match docs/refactor/evidence/M3.md exactly (copied from m2SubtypeIntegrity.pgtest.ts). */
const M3_ACTIVATED_KINDS = [
  'TRANSPORT_SERVICE',
  'RESOURCE',
  'RESERVATION',
  'RESERVATION_LINE',
  'SERVICE_ENTITLEMENT',
  'OFFER',
  'COMMERCIAL_AGREEMENT',
  'EXTERNAL_CONNECTION',
  'EXTERNAL_RECORD',
  'OWNERSHIP_BINDING',
  'BUDGET',
];

/** Kinds M4 activates -- must match docs/refactor/evidence/M4.md exactly (copied from m2SubtypeIntegrity.pgtest.ts). */
const M4_ACTIVATED_KINDS = ['EVENT', 'PROGRAMME', 'PROGRAMME_ITEM', 'PARTICIPATION', 'PLACE', 'GEOGRAPHIC_AREA', 'JURISDICTION'];

/** Kinds M5 activates -- must match docs/refactor/evidence/M5.md exactly (copied from m2SubtypeIntegrity.pgtest.ts). */
const M5_ACTIVATED_KINDS = [
  'SOURCE_RECORD',
  'EVIDENCE_RECORD',
  'OBJECTIVE',
  'CONSTRAINT_DEFINITION',
  'RULE_SET',
  'PREFERENCE',
  'INFORMATION_RECORD',
  'INFORMATION_VERSION',
];

/** Union of every lane-activated kind, in the exact order used to pick a deterministic "wrong kind". */
const INTEGRATED_ACTIVATED_KINDS = [...M2_ACTIVATED_KINDS, ...M3_ACTIVATED_KINDS, ...M4_ACTIVATED_KINDS, ...M5_ACTIVATED_KINDS];

function nextKind(kind: string): string {
  const idx = INTEGRATED_ACTIVATED_KINDS.indexOf(kind);
  if (idx < 0) throw new Error(`${kind} is not in the integrated activated-kind list`);
  return INTEGRATED_ACTIVATED_KINDS[(idx + 1) % INTEGRATED_ACTIVATED_KINDS.length]!;
}

// ---------------------------------------------------------------------------
// KindCase machinery
// ---------------------------------------------------------------------------

/** A bag of prerequisite ids a kind's typed row needs. Child kinds set `aggregateId` to the real parent aggregate id. */
interface Deps {
  aggregateId?: string;
  [key: string]: string | undefined;
}

interface KindCase {
  kind: string;
  isChild: boolean;
  /** Create whatever prerequisite rows the typed row's own FKs require; for a child kind, sets `aggregateId` to a real, fully registered parent aggregate. */
  prepareDeps(seed: SeedSession): Promise<Deps>;
  /** Insert ONLY the kind's own typed row (plus any child rows its own deferred consistency triggers require). Never touches domain_subjects/aggregate_heads. */
  insertTypedRowOnly(seed: SeedSession, id: string, deps: Deps): Promise<void>;
}

/** Registers the kind properly (head if root, or child under the real parent aggregate) and inserts its valid typed row -- exactly property 1 (VALID). */
async function createFullyRegistered(kindCase: KindCase, seed: SeedSession): Promise<{ id: string; aggregateId: string; deps: Deps }> {
  const deps = await kindCase.prepareDeps(seed);
  const id = randomUUID();
  if (kindCase.isChild) {
    if (!deps.aggregateId) throw new Error(`${kindCase.kind}: prepareDeps must set aggregateId for a child kind`);
    await seedChildSubject(seed, { id, kind: kindCase.kind, aggregateId: deps.aggregateId });
  } else {
    await seedRootSubject(seed, { id, kind: kindCase.kind });
  }
  await kindCase.insertTypedRowOnly(seed, id, deps);
  return { id, aggregateId: kindCase.isChild ? deps.aggregateId! : id, deps };
}

// ---------------------------------------------------------------------------
// Raw-SQL typed-row builders. One per kind, matching the exact CHECK/FK shape
// each migration declares (read directly off src/persistence/postgres/migrations).
// ---------------------------------------------------------------------------

async function insertOrganisationRow(seed: SeedSession, id: string): Promise<void> {
  await seed.client.query(
    `INSERT INTO organisations (workspace_id, id, legal_name, display_name, default_currency_code, created_by_actor_id)
     VALUES ($1, $2, 'Matrix Org', 'Matrix Org', 'USD', $3)`,
    [seed.workspaceId, id, seed.actorId],
  );
}

async function insertPrincipalRow(seed: SeedSession, id: string): Promise<void> {
  await seed.client.query(
    `INSERT INTO principals (workspace_id, id, auth_issuer, auth_subject, actor_type, created_by_actor_id)
     VALUES ($1, $2, 'matrix-issuer', $3, 'HUMAN', $4)`,
    [seed.workspaceId, id, id, seed.actorId],
  );
}

async function seedPrincipal(seed: SeedSession): Promise<string> {
  const id = await seedRootSubject(seed, { kind: 'PRINCIPAL' });
  await insertPrincipalRow(seed, id);
  return id;
}

async function insertTravellerRow(seed: SeedSession, id: string): Promise<void> {
  const displayNameId = randomUUID();
  await seed.client.query(
    `INSERT INTO travellers (workspace_id, id, display_name_ref, lifecycle_status, created_by_actor_id)
     VALUES ($1, $2, $3, 'ACTIVE', $4)`,
    [seed.workspaceId, id, displayNameId, seed.actorId],
  );
  await seed.client.query(
    `INSERT INTO traveller_names (workspace_id, id, traveller_id, name_kind, display_value, valid_from, evidence_id, created_by_actor_id)
     VALUES ($1, $2, $3, 'DISPLAY', 'Matrix Traveller', '2000-01-01', $4, $5)`,
    [seed.workspaceId, displayNameId, id, takeSeedEvidence(seed), seed.actorId],
  );
}

async function insertTravellerRelationshipRow(seed: SeedSession, id: string, fromTravellerId: string, toTravellerId: string): Promise<void> {
  await seed.client.query(
    `INSERT INTO traveller_relationships (workspace_id, id, from_traveller_id, to_traveller_id, relationship_type, effective_from, evidence_id, created_by_actor_id)
     VALUES ($1, $2, $3, $4, 'PEER', '2000-01-01', $5, $6)`,
    [seed.workspaceId, id, fromTravellerId, toTravellerId, takeSeedEvidence(seed), seed.actorId],
  );
}

async function insertResponsibilityAssignmentRow(seed: SeedSession, id: string, organisationId: string, tripId: string): Promise<void> {
  await seed.client.query(
    `INSERT INTO responsibility_assignments (workspace_id, id, organisation_id, subject_ref_kind, subject_ref_id, role, effective_from, created_by_actor_id)
     VALUES ($1, $2, $3, 'TRIP', $4, 'ARRANGER', '2000-01-01', $5)`,
    [seed.workspaceId, id, organisationId, tripId, seed.actorId],
  );
}

async function insertCommandReceipt(seed: SeedSession, namespace: string, idempotencyKey: string): Promise<void> {
  await seed.client.query(
    `INSERT INTO command_receipts (workspace_id, command_namespace, idempotency_key, payload_hash, result_ref, committed_revisions)
     VALUES ($1, $2, $3, 'matrix-hash', '{}', '{}')`,
    [seed.workspaceId, namespace, idempotencyKey],
  );
}

async function insertAuthorityGrantRow(
  seed: SeedSession,
  id: string,
  principalId: string,
  representedTravellerId: string,
  namespace: string,
  idempotencyKey: string,
): Promise<void> {
  await seed.client.query(
    `INSERT INTO authority_grants
       (workspace_id, id, principal_id, represented_party_kind, represented_party_id,
        issued_by_principal_id, authorising_command_namespace, authorising_idempotency_key, issued_at, created_by_actor_id)
     VALUES ($1, $2, $3, 'TRAVELLER', $4, $3, $5, $6, now(), $7)`,
    [seed.workspaceId, id, principalId, representedTravellerId, namespace, idempotencyKey, seed.actorId],
  );
  await seed.client.query(`INSERT INTO grant_actions (workspace_id, grant_id, action_kind) VALUES ($1, $2, 'traveller.profile.write')`, [
    seed.workspaceId,
    id,
  ]);
  await seed.client.query(`INSERT INTO grant_scopes (workspace_id, grant_id, scope_kind, scope_id) VALUES ($1, $2, 'TRAVELLER', $3)`, [
    seed.workspaceId,
    id,
    representedTravellerId,
  ]);
}

async function insertTripRow(seed: SeedSession, id: string): Promise<void> {
  await seed.client.query(
    `INSERT INTO trips (workspace_id, id, purpose, lifecycle_status, created_by_actor_id) VALUES ($1, $2, 'Matrix trip', 'DRAFT', $3)`,
    [seed.workspaceId, id, seed.actorId],
  );
}

async function insertJourneyRow(seed: SeedSession, id: string, tripId: string, travellerId: string): Promise<void> {
  await seed.client.query(
    `INSERT INTO journeys (workspace_id, id, trip_id, traveller_id, lifecycle_status, created_by_actor_id)
     VALUES ($1, $2, $3, $4, 'DRAFT', $5)`,
    [seed.workspaceId, id, tripId, travellerId, seed.actorId],
  );
}

async function insertJourneyItemRow(seed: SeedSession, id: string, journeyId: string): Promise<void> {
  await seed.client.query(
    `INSERT INTO journey_items (workspace_id, id, journey_id, kind, order_key, lifecycle_status, created_by_actor_id)
     VALUES ($1, $2, $3, 'ENGAGEMENT', $4, 'PLANNED', $5)`,
    [seed.workspaceId, id, journeyId, id, seed.actorId],
  );
  await seed.client.query(
    `INSERT INTO engagement_item_details (workspace_id, journey_item_id, kind, standalone_title, standalone_window_start, standalone_window_end)
     VALUES ($1, $2, 'ENGAGEMENT', 'Matrix Engagement', '2030-01-01T00:00:00Z', '2030-01-02T00:00:00Z')`,
    [seed.workspaceId, id],
  );
}

async function insertCoordinationGroupRow(seed: SeedSession, id: string): Promise<void> {
  await seed.client.query(
    `INSERT INTO coordination_groups (workspace_id, id, name, lifecycle_status, created_by_actor_id) VALUES ($1, $2, 'Matrix Group', 'DRAFT', $3)`,
    [seed.workspaceId, id, seed.actorId],
  );
}

async function createAccompanimentRequirement(
  seed: SeedSession,
  supportedTravellerId: string,
  supporterTravellerId: string,
): Promise<{ requirementId: string; version: number }> {
  const requirementId = randomUUID();
  await seed.client.query(
    `INSERT INTO accompaniment_requirements
       (workspace_id, id, version, supported_traveller_id, coverage_start, coverage_end, minimum_simultaneous_supporters, created_by_actor_id)
     VALUES ($1, $2, 1, $3, '2030-01-01T00:00:00Z', '2030-01-02T00:00:00Z', 1, $4)`,
    [seed.workspaceId, requirementId, supportedTravellerId, seed.actorId],
  );
  await seed.client.query(
    `INSERT INTO accompaniment_eligible_supporters (workspace_id, requirement_id, requirement_version, supporter_traveller_id) VALUES ($1, $2, 1, $3)`,
    [seed.workspaceId, requirementId, supporterTravellerId],
  );
  return { requirementId, version: 1 };
}

async function insertSupportAssignmentRow(seed: SeedSession, id: string, requirementId: string, version: number, supporterId: string): Promise<void> {
  await seed.client.query(
    `INSERT INTO support_assignments (workspace_id, id, constraint_definition_id, constraint_definition_version, created_by_actor_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [seed.workspaceId, id, requirementId, version, seed.actorId],
  );
  await seed.client.query(`INSERT INTO support_assignment_assignees (workspace_id, assignment_id, supporter_traveller_id) VALUES ($1, $2, $3)`, [
    seed.workspaceId,
    id,
    supporterId,
  ]);
}

async function insertTransportServiceRow(seed: SeedSession, id: string, originPlaceId: string, destinationPlaceId: string): Promise<void> {
  await seed.client.query(
    `INSERT INTO transport_services
       (workspace_id, id, mode, operator, origin_place_id, destination_place_id,
        published_departure, published_arrival, published_observed_at, published_evidence_id, created_by_actor_id)
     VALUES ($1, $2, 'AIR', 'Matrix Operator', $3, $4, '2030-01-01T00:00:00Z', '2030-01-01T02:00:00Z', '2030-01-01T00:00:00Z', $5, $6)`,
    [seed.workspaceId, id, originPlaceId, destinationPlaceId, takeSeedEvidence(seed), seed.actorId],
  );
}

async function insertResourceRow(seed: SeedSession, id: string, placeId: string): Promise<void> {
  await seed.client.query(
    `INSERT INTO resources (workspace_id, id, resource_type, location_place_id, capacity, created_by_actor_id) VALUES ($1, $2, 'ROOM', $3, 1, $4)`,
    [seed.workspaceId, id, placeId, seed.actorId],
  );
  await seed.client.query(`INSERT INTO room_resource_details (workspace_id, resource_id, resource_type, bed_configuration) VALUES ($1, $2, 'ROOM', 'standard')`, [
    seed.workspaceId,
    id,
  ]);
}

async function insertReservationRow(seed: SeedSession, id: string, organisationId: string): Promise<void> {
  await seed.client.query(
    `INSERT INTO reservations (workspace_id, id, reservation_type, observed_status, responsible_organisation_id, created_by_actor_id)
     VALUES ($1, $2, 'TRANSPORT', 'UNKNOWN', $3, $4)`,
    [seed.workspaceId, id, organisationId, seed.actorId],
  );
}

async function insertReservationLineRow(seed: SeedSession, id: string, reservationId: string, resourceId: string): Promise<void> {
  await seed.client.query(
    `INSERT INTO reservation_lines (workspace_id, id, reservation_id, product_type, observed_status, observed_status_at, observation_evidence_id, created_by_actor_id)
     VALUES ($1, $2, $3, 'RESOURCE_USE', 'CONFIRMED', '2030-01-01T00:00:00Z', $4, $5)`,
    [seed.workspaceId, id, reservationId, takeSeedEvidence(seed), seed.actorId],
  );
  await seed.client.query(`INSERT INTO resource_use_line_details (workspace_id, line_id, product_type, resource_id) VALUES ($1, $2, 'RESOURCE_USE', $3)`, [
    seed.workspaceId,
    id,
    resourceId,
  ]);
}

async function insertServiceEntitlementRow(seed: SeedSession, id: string): Promise<void> {
  await seed.client.query(`INSERT INTO service_entitlements (workspace_id, id, entitlement_type, created_by_actor_id) VALUES ($1, $2, 'VOUCHER', $3)`, [
    seed.workspaceId,
    id,
    seed.actorId,
  ]);
}

async function insertOfferRow(seed: SeedSession, id: string): Promise<void> {
  await seed.client.query(
    `INSERT INTO offers (workspace_id, id, source_id, price_amount, price_currency, quoted_at, expires_at, fingerprint, created_by_actor_id)
     VALUES ($1, $2, 'matrix-source', 100, 'USD', '2030-01-01T00:00:00Z', '2030-02-01T00:00:00Z', $3, $4)`,
    [seed.workspaceId, id, id, seed.actorId],
  );
}

async function insertCommercialAgreementRow(seed: SeedSession, id: string, organisationId: string): Promise<void> {
  const versionId = randomUUID();
  await seed.client.query(`INSERT INTO commercial_agreements (workspace_id, id, organisation_id, current_version_id, created_by_actor_id) VALUES ($1, $2, $3, $4, $5)`, [
    seed.workspaceId,
    id,
    organisationId,
    versionId,
    seed.actorId,
  ]);
  await seed.client.query(
    `INSERT INTO agreement_versions (workspace_id, id, agreement_id, edition_number, published_at, published_terms, created_by_actor_id)
     VALUES ($1, $2, $3, 1, now(), '{}', $4)`,
    [seed.workspaceId, versionId, id, seed.actorId],
  );
}

async function insertExternalConnectionRow(seed: SeedSession, id: string): Promise<void> {
  await seed.client.query(`INSERT INTO external_connections (workspace_id, id, provider_kind, created_by_actor_id) VALUES ($1, $2, 'MATRIX_SEED', $3)`, [
    seed.workspaceId,
    id,
    seed.actorId,
  ]);
}

async function insertExternalRecordRow(seed: SeedSession, id: string, connectionId: string): Promise<void> {
  await seed.client.query(
    `INSERT INTO external_records (workspace_id, id, connection_id, record_type, external_id, created_by_actor_id) VALUES ($1, $2, $3, 'MATRIX_TYPE', $4, $5)`,
    [seed.workspaceId, id, connectionId, id, seed.actorId],
  );
}

async function insertOwnershipBindingRow(seed: SeedSession, id: string, subjectId: string, subjectKind = 'TRAVELLER'): Promise<void> {
  await seed.client.query(
    `INSERT INTO ownership_bindings (workspace_id, id, subject_id, subject_kind, field_group, owner_kind, binding_state, effective_from, created_by_actor_id)
     VALUES ($1, $2, $3, $4, 'matrix-field', 'INTERNAL', 'CURRENT', '2000-01-01T00:00:00Z', $5)`,
    [seed.workspaceId, id, subjectId, subjectKind, seed.actorId],
  );
}

async function insertBudgetRow(seed: SeedSession, id: string, organisationId: string): Promise<void> {
  await seed.client.query(
    `INSERT INTO budgets (workspace_id, id, organisation_id, purpose, amount, currency, created_by_actor_id) VALUES ($1, $2, $3, 'Matrix budget', 100, 'USD', $4)`,
    [seed.workspaceId, id, organisationId, seed.actorId],
  );
}

async function insertEventRow(seed: SeedSession, id: string): Promise<void> {
  await seed.client.query(`INSERT INTO events (workspace_id, id, title, lifecycle_status, created_by_actor_id) VALUES ($1, $2, 'Matrix Event', 'DRAFT', $3)`, [
    seed.workspaceId,
    id,
    seed.actorId,
  ]);
}

async function insertProgrammeRow(seed: SeedSession, id: string, eventId: string): Promise<void> {
  await seed.client.query(
    `INSERT INTO programmes (workspace_id, id, event_id, title, lifecycle_status, created_by_actor_id) VALUES ($1, $2, $3, 'Matrix Programme', 'DRAFT', $4)`,
    [seed.workspaceId, id, eventId, seed.actorId],
  );
}

async function insertProgrammeItemRow(seed: SeedSession, id: string, programmeId: string): Promise<void> {
  await seed.client.query(
    `INSERT INTO programme_items (workspace_id, id, programme_id, title, item_type, lifecycle_status, schedule_authority, created_by_actor_id)
     VALUES ($1, $2, $3, 'Matrix Item', 'SESSION', 'DRAFT', 'INTERNAL', $4)`,
    [seed.workspaceId, id, programmeId, seed.actorId],
  );
}

async function insertParticipationRow(seed: SeedSession, id: string, programmeItemId: string, travellerId: string): Promise<void> {
  await seed.client.query(
    `INSERT INTO participations (workspace_id, id, programme_item_id, traveller_id, obligation, accepted, created_by_actor_id)
     VALUES ($1, $2, $3, $4, 'REQUIRED', false, $5)`,
    [seed.workspaceId, id, programmeItemId, travellerId, seed.actorId],
  );
}

async function insertPlaceRow(seed: SeedSession, id: string): Promise<void> {
  await seed.client.query(`INSERT INTO places (workspace_id, id, name, place_type, time_zone, created_by_actor_id) VALUES ($1, $2, 'Matrix Place', 'VENUE', 'UTC', $3)`, [
    seed.workspaceId,
    id,
    seed.actorId,
  ]);
}

async function insertGeographicAreaRow(seed: SeedSession, id: string): Promise<void> {
  await seed.client.query(`INSERT INTO geographic_areas (workspace_id, id, name, area_type, created_by_actor_id) VALUES ($1, $2, 'Matrix Area', 'COUNTRY', $3)`, [
    seed.workspaceId,
    id,
    seed.actorId,
  ]);
}

async function insertJurisdictionRow(seed: SeedSession, id: string): Promise<void> {
  await seed.client.query(`INSERT INTO jurisdictions (workspace_id, id, name, regime_kind, created_by_actor_id) VALUES ($1, $2, 'Matrix Jurisdiction', 'COUNTRY', $3)`, [
    seed.workspaceId,
    id,
    seed.actorId,
  ]);
}

async function insertSourceRecordRow(seed: SeedSession, id: string): Promise<void> {
  await seed.client.query(
    `INSERT INTO source_records (workspace_id, id, source_identity, received_at, content_hash, content_type, capture_metadata_version, created_by_actor_id)
     VALUES ($1, $2, 'matrix-source', '2030-01-01T00:00:00Z', $3, 'application/test', 'matrix/1', $4)`,
    [seed.workspaceId, id, id.replace(/-/g, '').padEnd(64, 'e'), seed.actorId],
  );
}

async function insertEvidenceRecordRow(seed: SeedSession, id: string): Promise<void> {
  await seed.client.query(
    `INSERT INTO evidence_records (workspace_id, id, assertion_type, observed_at, schema_version, created_by_actor_id)
     VALUES ($1, $2, 'MATRIX_ASSERTION', '2030-01-01T00:00:00Z', 'matrix/1', $3)`,
    [seed.workspaceId, id, seed.actorId],
  );
}

async function insertObjectiveRow(seed: SeedSession, id: string, tripId: string): Promise<void> {
  await seed.client.query(
    `INSERT INTO objectives (workspace_id, id, owner_kind, owner_id, success_predicate, hardness, priority, created_by_actor_id)
     VALUES ($1, $2, 'TRIP', $3, 'Matrix objective predicate', 'HARD', 1, $4)`,
    [seed.workspaceId, id, tripId, seed.actorId],
  );
}

async function insertConstraintDefinitionRow(seed: SeedSession, id: string, tripId: string): Promise<void> {
  await seed.client.query(
    `INSERT INTO constraint_definitions (workspace_id, id, registered_type, hardness, owner_kind, owner_id, parameter_schema_version, created_by_actor_id)
     VALUES ($1, $2, 'matrix_type', 'HARD', 'TRIP', $3, 'matrix/1', $4)`,
    [seed.workspaceId, id, tripId, seed.actorId],
  );
}

async function insertRuleSetRow(seed: SeedSession, id: string, organisationId: string): Promise<void> {
  await seed.client.query(
    `INSERT INTO rule_sets (workspace_id, id, issuer_kind, issuer_id, policy_family, created_by_actor_id) VALUES ($1, $2, 'ORGANISATION', $3, 'matrix-family', $4)`,
    [seed.workspaceId, id, organisationId, seed.actorId],
  );
}

async function insertPreferenceRow(seed: SeedSession, id: string, travellerId: string): Promise<void> {
  await seed.client.query(
    `INSERT INTO preferences (workspace_id, id, owner_kind, owner_id, preference_kind, source, value, value_schema_version, evidence_id, effective_from, created_by_actor_id)
     VALUES ($1, $2, 'TRAVELLER', $3, 'matrix-pref', 'EXPLICIT', '{}', 'matrix/1', $4, '2030-01-01T00:00:00Z', $5)`,
    [seed.workspaceId, id, travellerId, takeSeedEvidence(seed), seed.actorId],
  );
}

async function insertInformationRecordRow(seed: SeedSession, id: string): Promise<void> {
  await seed.client.query(
    `INSERT INTO information_records (workspace_id, id, external_publication_key, topic, created_by_actor_id) VALUES ($1, $2, $3, 'ADVISORY', $4)`,
    [seed.workspaceId, id, `matrix-pub-${id}`, seed.actorId],
  );
}

async function insertInformationVersionRow(seed: SeedSession, id: string, informationRecordId: string): Promise<void> {
  await seed.client.query(
    `INSERT INTO information_versions
       (workspace_id, id, information_record_id, subtype, external_edition_sequence, issued_at, received_at, observed_at, evidence_id, payload_hash, normalization_version, created_by_actor_id)
     VALUES ($1, $2, $3, 'ADVISORY', 1, '2030-01-01T00:00:00Z', '2030-01-01T00:00:00Z', '2030-01-01T00:00:00Z', $4, $5, 'matrix/1', $6)`,
    [seed.workspaceId, id, informationRecordId, takeSeedEvidence(seed), 'p'.repeat(64), seed.actorId],
  );
  await seed.client.query(
    `INSERT INTO advisory_details (workspace_id, information_version_id, source_native_severity, detail_schema_version) VALUES ($1, $2, 'NOTICE', 'advisory/1')`,
    [seed.workspaceId, id],
  );
}

// ---------------------------------------------------------------------------
// KindCase table
// ---------------------------------------------------------------------------

const KIND_CASES: KindCase[] = [
  // ---- M2 -------------------------------------------------------------
  { kind: 'ORGANISATION', isChild: false, prepareDeps: async () => ({}), insertTypedRowOnly: (seed, id) => insertOrganisationRow(seed, id) },
  { kind: 'PRINCIPAL', isChild: false, prepareDeps: async () => ({}), insertTypedRowOnly: (seed, id) => insertPrincipalRow(seed, id) },
  { kind: 'TRAVELLER', isChild: false, prepareDeps: async () => ({}), insertTypedRowOnly: (seed, id) => insertTravellerRow(seed, id) },
  {
    kind: 'TRAVELLER_RELATIONSHIP',
    isChild: false,
    prepareDeps: async (seed) => {
      const { travellerId: fromTravellerId } = await seedTraveller(seed);
      const { travellerId: toTravellerId } = await seedTraveller(seed);
      return { fromTravellerId, toTravellerId };
    },
    insertTypedRowOnly: (seed, id, deps) => insertTravellerRelationshipRow(seed, id, deps.fromTravellerId!, deps.toTravellerId!),
  },
  {
    kind: 'RESPONSIBILITY_ASSIGNMENT',
    isChild: false,
    prepareDeps: async (seed) => {
      const organisationId = await seedOrganisation(seed);
      const tripId = await seedTrip(seed);
      return { organisationId, tripId };
    },
    insertTypedRowOnly: (seed, id, deps) => insertResponsibilityAssignmentRow(seed, id, deps.organisationId!, deps.tripId!),
  },
  {
    kind: 'AUTHORITY_GRANT',
    isChild: false,
    prepareDeps: async (seed) => {
      const principalId = await seedPrincipal(seed);
      const { travellerId } = await seedTraveller(seed);
      const namespace = 'matrix-authority-grant';
      const idempotencyKey = randomUUID();
      await insertCommandReceipt(seed, namespace, idempotencyKey);
      return { principalId, travellerId, namespace, idempotencyKey };
    },
    insertTypedRowOnly: (seed, id, deps) => insertAuthorityGrantRow(seed, id, deps.principalId!, deps.travellerId!, deps.namespace!, deps.idempotencyKey!),
  },
  { kind: 'TRIP', isChild: false, prepareDeps: async () => ({}), insertTypedRowOnly: (seed, id) => insertTripRow(seed, id) },
  {
    kind: 'JOURNEY',
    isChild: false,
    prepareDeps: async (seed) => {
      const tripId = await seedTrip(seed);
      const { travellerId } = await seedTraveller(seed);
      return { tripId, travellerId };
    },
    insertTypedRowOnly: (seed, id, deps) => insertJourneyRow(seed, id, deps.tripId!, deps.travellerId!),
  },
  {
    kind: 'JOURNEY_ITEM',
    isChild: true,
    prepareDeps: async (seed) => {
      const tripId = await seedTrip(seed);
      const { travellerId } = await seedTraveller(seed);
      const journeyId = await seedJourney(seed, { tripId, travellerId });
      return { aggregateId: journeyId };
    },
    insertTypedRowOnly: (seed, id, deps) => insertJourneyItemRow(seed, id, deps.aggregateId!),
  },
  { kind: 'COORDINATION_GROUP', isChild: false, prepareDeps: async () => ({}), insertTypedRowOnly: (seed, id) => insertCoordinationGroupRow(seed, id) },
  {
    kind: 'SUPPORT_ASSIGNMENT',
    isChild: false,
    prepareDeps: async (seed) => {
      const { travellerId: supportedTravellerId } = await seedTraveller(seed);
      const { travellerId: supporterId } = await seedTraveller(seed);
      const { requirementId, version } = await createAccompanimentRequirement(seed, supportedTravellerId, supporterId);
      return { requirementId, version: String(version), supporterId };
    },
    insertTypedRowOnly: (seed, id, deps) => insertSupportAssignmentRow(seed, id, deps.requirementId!, Number(deps.version!), deps.supporterId!),
  },
  // ---- M3 -------------------------------------------------------------
  {
    kind: 'TRANSPORT_SERVICE',
    isChild: false,
    prepareDeps: async (seed) => {
      const originPlaceId = await seedPlace(seed);
      const destinationPlaceId = await seedPlace(seed);
      return { originPlaceId, destinationPlaceId };
    },
    insertTypedRowOnly: (seed, id, deps) => insertTransportServiceRow(seed, id, deps.originPlaceId!, deps.destinationPlaceId!),
  },
  {
    kind: 'RESOURCE',
    isChild: false,
    prepareDeps: async (seed) => ({ placeId: await seedPlace(seed) }),
    insertTypedRowOnly: (seed, id, deps) => insertResourceRow(seed, id, deps.placeId!),
  },
  {
    kind: 'RESERVATION',
    isChild: false,
    prepareDeps: async (seed) => ({ organisationId: await seedOrganisation(seed) }),
    insertTypedRowOnly: (seed, id, deps) => insertReservationRow(seed, id, deps.organisationId!),
  },
  {
    kind: 'RESERVATION_LINE',
    isChild: true,
    prepareDeps: async (seed) => {
      const organisationId = await seedOrganisation(seed);
      const reservationId = await seedReservation(seed, { organisationId });
      const resourceId = await seedResource(seed);
      return { aggregateId: reservationId, resourceId };
    },
    insertTypedRowOnly: (seed, id, deps) => insertReservationLineRow(seed, id, deps.aggregateId!, deps.resourceId!),
  },
  { kind: 'SERVICE_ENTITLEMENT', isChild: false, prepareDeps: async () => ({}), insertTypedRowOnly: (seed, id) => insertServiceEntitlementRow(seed, id) },
  { kind: 'OFFER', isChild: false, prepareDeps: async () => ({}), insertTypedRowOnly: (seed, id) => insertOfferRow(seed, id) },
  {
    kind: 'COMMERCIAL_AGREEMENT',
    isChild: false,
    prepareDeps: async (seed) => ({ organisationId: await seedOrganisation(seed) }),
    insertTypedRowOnly: (seed, id, deps) => insertCommercialAgreementRow(seed, id, deps.organisationId!),
  },
  { kind: 'EXTERNAL_CONNECTION', isChild: false, prepareDeps: async () => ({}), insertTypedRowOnly: (seed, id) => insertExternalConnectionRow(seed, id) },
  {
    kind: 'EXTERNAL_RECORD',
    isChild: true,
    prepareDeps: async (seed) => ({ aggregateId: await seedExternalConnection(seed) }),
    insertTypedRowOnly: (seed, id, deps) => insertExternalRecordRow(seed, id, deps.aggregateId!),
  },
  {
    kind: 'OWNERSHIP_BINDING',
    isChild: true,
    prepareDeps: async (seed) => {
      const { travellerId } = await seedTraveller(seed);
      return { aggregateId: travellerId };
    },
    insertTypedRowOnly: (seed, id, deps) => insertOwnershipBindingRow(seed, id, deps.aggregateId!),
  },
  {
    kind: 'BUDGET',
    isChild: false,
    prepareDeps: async (seed) => ({ organisationId: await seedOrganisation(seed) }),
    insertTypedRowOnly: (seed, id, deps) => insertBudgetRow(seed, id, deps.organisationId!),
  },
  // ---- M4 -------------------------------------------------------------
  { kind: 'EVENT', isChild: false, prepareDeps: async () => ({}), insertTypedRowOnly: (seed, id) => insertEventRow(seed, id) },
  {
    kind: 'PROGRAMME',
    isChild: false,
    prepareDeps: async (seed) => ({ eventId: await seedEvent(seed) }),
    insertTypedRowOnly: (seed, id, deps) => insertProgrammeRow(seed, id, deps.eventId!),
  },
  {
    kind: 'PROGRAMME_ITEM',
    isChild: true,
    prepareDeps: async (seed) => {
      const eventId = await seedEvent(seed);
      const programmeId = await seedProgramme(seed, { eventId });
      return { aggregateId: programmeId };
    },
    insertTypedRowOnly: (seed, id, deps) => insertProgrammeItemRow(seed, id, deps.aggregateId!),
  },
  {
    kind: 'PARTICIPATION',
    isChild: true,
    prepareDeps: async (seed) => {
      const eventId = await seedEvent(seed);
      const programmeId = await seedProgramme(seed, { eventId });
      const { programmeItemId } = await seedProgrammeItem(seed, { programmeId });
      const { travellerId } = await seedTraveller(seed);
      return { aggregateId: programmeId, programmeItemId, travellerId };
    },
    insertTypedRowOnly: (seed, id, deps) => insertParticipationRow(seed, id, deps.programmeItemId!, deps.travellerId!),
  },
  { kind: 'PLACE', isChild: false, prepareDeps: async () => ({}), insertTypedRowOnly: (seed, id) => insertPlaceRow(seed, id) },
  { kind: 'GEOGRAPHIC_AREA', isChild: false, prepareDeps: async () => ({}), insertTypedRowOnly: (seed, id) => insertGeographicAreaRow(seed, id) },
  { kind: 'JURISDICTION', isChild: false, prepareDeps: async () => ({}), insertTypedRowOnly: (seed, id) => insertJurisdictionRow(seed, id) },
  // ---- M5 -------------------------------------------------------------
  { kind: 'SOURCE_RECORD', isChild: false, prepareDeps: async () => ({}), insertTypedRowOnly: (seed, id) => insertSourceRecordRow(seed, id) },
  { kind: 'EVIDENCE_RECORD', isChild: false, prepareDeps: async () => ({}), insertTypedRowOnly: (seed, id) => insertEvidenceRecordRow(seed, id) },
  {
    kind: 'OBJECTIVE',
    isChild: false,
    prepareDeps: async (seed) => ({ tripId: await seedTrip(seed) }),
    insertTypedRowOnly: (seed, id, deps) => insertObjectiveRow(seed, id, deps.tripId!),
  },
  {
    kind: 'CONSTRAINT_DEFINITION',
    isChild: false,
    prepareDeps: async (seed) => ({ tripId: await seedTrip(seed) }),
    insertTypedRowOnly: (seed, id, deps) => insertConstraintDefinitionRow(seed, id, deps.tripId!),
  },
  {
    kind: 'RULE_SET',
    isChild: false,
    prepareDeps: async (seed) => ({ organisationId: await seedOrganisation(seed) }),
    insertTypedRowOnly: (seed, id, deps) => insertRuleSetRow(seed, id, deps.organisationId!),
  },
  {
    kind: 'PREFERENCE',
    isChild: false,
    prepareDeps: async (seed) => {
      const { travellerId } = await seedTraveller(seed);
      return { travellerId };
    },
    insertTypedRowOnly: (seed, id, deps) => insertPreferenceRow(seed, id, deps.travellerId!),
  },
  { kind: 'INFORMATION_RECORD', isChild: false, prepareDeps: async () => ({}), insertTypedRowOnly: (seed, id) => insertInformationRecordRow(seed, id) },
  {
    kind: 'INFORMATION_VERSION',
    isChild: true,
    prepareDeps: async (seed) => {
      const rec = await createFullyRegistered(CASE_BY_KIND.get('INFORMATION_RECORD')!, seed);
      return { aggregateId: rec.id };
    },
    insertTypedRowOnly: (seed, id, deps) => insertInformationVersionRow(seed, id, deps.aggregateId!),
  },
];

const CASE_BY_KIND = new Map(KIND_CASES.map((c) => [c.kind, c]));

// Every KindCase's kind must be exactly the union list, in the same order (so
// nextKind's wraparound is deterministic and this table cannot silently drift
// from the frozen per-lane kind lists).
{
  const caseKinds = KIND_CASES.map((c) => c.kind);
  if (caseKinds.length !== INTEGRATED_ACTIVATED_KINDS.length || caseKinds.some((k, i) => k !== INTEGRATED_ACTIVATED_KINDS[i])) {
    throw new Error('integrationSubtypeMatrix.pgtest.ts: KIND_CASES must exactly match INTEGRATED_ACTIVATED_KINDS, in order');
  }
}

// ---------------------------------------------------------------------------
// Property 1: VALID
// ---------------------------------------------------------------------------

describe('M2-M5 integration subtype matrix: VALID registry + typed row commits (real PostgreSQL)', () => {
  for (const kindCase of KIND_CASES) {
    test(kindCase.kind, async () => {
      const pool = await sharedTestPool();
      const seed = await beginSeed(pool, `M6 matrix valid ${kindCase.kind}`);
      const { id } = await createFullyRegistered(kindCase, seed);
      await commitSeed(seed);

      const stored = await pool.query<{ count: string }>(
        'SELECT count(*) AS count FROM domain_subjects WHERE workspace_id = $1 AND id = $2 AND kind = $3',
        [seed.workspaceId, id, kindCase.kind],
      );
      assert.equal(Number(stored.rows[0]?.count), 1, `${kindCase.kind} registry row must exist after commit`);
    });
  }
});

// ---------------------------------------------------------------------------
// Property 2: MISSING TYPED ROW
// ---------------------------------------------------------------------------

describe('M2-M5 integration subtype matrix: registry row with NO typed row fails at COMMIT (real PostgreSQL)', () => {
  for (const kindCase of KIND_CASES) {
    test(kindCase.kind, async () => {
      const pool = await sharedTestPool();
      const seed = await beginSeed(pool, `M6 matrix missing ${kindCase.kind}`);
      const deps = await kindCase.prepareDeps(seed);
      const id = randomUUID();
      if (kindCase.isChild) {
        await seedChildSubject(seed, { id, kind: kindCase.kind, aggregateId: deps.aggregateId! });
      } else {
        await seedRootSubject(seed, { id, kind: kindCase.kind });
      }
      // Deliberately no typed-row insert.
      await assert.rejects(() => commitSeed(seed), /subtype violation/i, `${kindCase.kind} must fail closed without its typed row`);
      await rollbackSeed(seed);
    });
  }
});

// ---------------------------------------------------------------------------
// Property 3: WRONG KIND
// ---------------------------------------------------------------------------

describe('M2-M5 integration subtype matrix: real typed row registered under the WRONG kind fails at COMMIT (real PostgreSQL)', () => {
  for (const kindCase of KIND_CASES) {
    const otherKind = nextKind(kindCase.kind);
    test(`${kindCase.kind} typed row registered as ${otherKind}`, async () => {
      const pool = await sharedTestPool();
      const seed = await beginSeed(pool, `M6 matrix wrong-kind ${kindCase.kind}`);
      const deps = await kindCase.prepareDeps(seed);
      const id = randomUUID();
      // A real, valid typed row for `kind`, but never registered as `kind`.
      await kindCase.insertTypedRowOnly(seed, id, deps);
      // The registry instead claims the SAME id is a different activated kind.
      await seedRootSubject(seed, { id, kind: otherKind });
      await assert.rejects(
        () => commitSeed(seed),
        /subtype violation/i,
        `a real ${kindCase.kind} row must not satisfy ${otherKind}'s checker`,
      );
      await rollbackSeed(seed);
    });
  }
});

// ---------------------------------------------------------------------------
// Property 4: CROSS-WORKSPACE (base case, every kind)
// ---------------------------------------------------------------------------

describe('M2-M5 integration subtype matrix: CROSS-WORKSPACE typed row does not satisfy another workspace (real PostgreSQL)', () => {
  for (const kindCase of KIND_CASES) {
    test(kindCase.kind, async () => {
      const pool = await sharedTestPool();

      const seedA = await beginSeed(pool, `M6 matrix cross-ws A ${kindCase.kind}`);
      const depsA = await kindCase.prepareDeps(seedA);
      const id = randomUUID();
      await kindCase.insertTypedRowOnly(seedA, id, depsA);
      await commitSeed(seedA);

      const seedB = await beginSeed(pool, `M6 matrix cross-ws B ${kindCase.kind}`);
      await seedRootSubject(seedB, { id, kind: kindCase.kind });
      await assert.rejects(
        () => commitSeed(seedB),
        /subtype violation/i,
        `${kindCase.kind} registered in workspace B must not resolve workspace A's typed row`,
      );
      await rollbackSeed(seedB);
    });
  }
});

// ---------------------------------------------------------------------------
// Property 4 (continued): CROSS-WORKSPACE parent/owner FK redirection.
//
// Named examples from the task plus every remaining child-aggregate kind:
// JOURNEY -> trip/traveller, JOURNEY_ITEM -> journey, PROGRAMME -> event,
// PARTICIPATION -> programme item / traveller, RESERVATION_LINE -> reservation,
// PROGRAMME_ITEM -> programme, EXTERNAL_RECORD -> external connection,
// OWNERSHIP_BINDING -> bound subject, INFORMATION_VERSION -> information record.
// ---------------------------------------------------------------------------

/**
 * Attempts `attempt()` inside `seed`'s transaction and asserts it is rejected
 * by a foreign-key violation -- whether the FK is IMMEDIATE (the insert
 * itself throws) or DEFERRABLE INITIALLY DEFERRED (only COMMIT throws).
 * Always leaves `seed`'s client rolled back and released.
 */
async function expectParentRedirectionRejected(seed: SeedSession, attempt: () => Promise<unknown>, message: string): Promise<void> {
  const pattern = /violates foreign key|foreign key constraint/i;
  try {
    await attempt();
    // The insert didn't throw -- the FK must be deferred, so COMMIT should.
    await assert.rejects(() => seed.client.query('COMMIT'), pattern, message);
  } catch (error) {
    assert.match((error as Error).message, pattern, message);
  } finally {
    await seed.client.query('ROLLBACK').catch(() => undefined);
    seed.client.release();
  }
}

describe('M2-M5 integration subtype matrix: CROSS-WORKSPACE parent/owner FK cannot be redirected (real PostgreSQL)', () => {
  test("JOURNEY: trip_id cannot point at another workspace's Trip", async () => {
    const pool = await sharedTestPool();
    const seedA = await beginSeed(pool, 'M6 matrix journey-parent A');
    const foreignTripId = await seedTrip(seedA);
    await commitSeed(seedA);

    const seedB = await beginSeed(pool, 'M6 matrix journey-parent B');
    const { travellerId } = await seedTraveller(seedB);
    await expectParentRedirectionRejected(
      seedB,
      () => insertJourneyRow(seedB, randomUUID(), foreignTripId, travellerId),
      "JOURNEY.trip_id must not resolve another workspace's Trip",
    );
  });

  test("PROGRAMME: event_id cannot point at another workspace's Event", async () => {
    const pool = await sharedTestPool();
    const seedA = await beginSeed(pool, 'M6 matrix programme-parent A');
    const foreignEventId = await seedEvent(seedA);
    await commitSeed(seedA);

    const seedB = await beginSeed(pool, 'M6 matrix programme-parent B');
    await expectParentRedirectionRejected(
      seedB,
      () => insertProgrammeRow(seedB, randomUUID(), foreignEventId),
      "PROGRAMME.event_id must not resolve another workspace's Event",
    );
  });

  test("JOURNEY_ITEM: journey_id cannot point at another workspace's Journey", async () => {
    const pool = await sharedTestPool();
    const seedA = await beginSeed(pool, 'M6 matrix journey-item-parent A');
    const tripId = await seedTrip(seedA);
    const { travellerId } = await seedTraveller(seedA);
    const foreignJourneyId = await seedJourney(seedA, { tripId, travellerId });
    await commitSeed(seedA);

    const seedB = await beginSeed(pool, 'M6 matrix journey-item-parent B');
    await expectParentRedirectionRejected(
      seedB,
      () => insertJourneyItemRow(seedB, randomUUID(), foreignJourneyId),
      "JOURNEY_ITEM.journey_id must not resolve another workspace's Journey",
    );
  });

  test("PROGRAMME_ITEM: programme_id cannot point at another workspace's Programme", async () => {
    const pool = await sharedTestPool();
    const seedA = await beginSeed(pool, 'M6 matrix programme-item-parent A');
    const eventId = await seedEvent(seedA);
    const foreignProgrammeId = await seedProgramme(seedA, { eventId });
    await commitSeed(seedA);

    const seedB = await beginSeed(pool, 'M6 matrix programme-item-parent B');
    await expectParentRedirectionRejected(
      seedB,
      () => insertProgrammeItemRow(seedB, randomUUID(), foreignProgrammeId),
      "PROGRAMME_ITEM.programme_id must not resolve another workspace's Programme",
    );
  });

  test("PARTICIPATION: programme_item_id cannot point at another workspace's ProgrammeItem", async () => {
    const pool = await sharedTestPool();
    const seedA = await beginSeed(pool, 'M6 matrix participation-item-parent A');
    const eventId = await seedEvent(seedA);
    const programmeId = await seedProgramme(seedA, { eventId });
    const { programmeItemId: foreignProgrammeItemId } = await seedProgrammeItem(seedA, { programmeId });
    await commitSeed(seedA);

    const seedB = await beginSeed(pool, 'M6 matrix participation-item-parent B');
    const { travellerId } = await seedTraveller(seedB);
    await expectParentRedirectionRejected(
      seedB,
      () => insertParticipationRow(seedB, randomUUID(), foreignProgrammeItemId, travellerId),
      "PARTICIPATION.programme_item_id must not resolve another workspace's ProgrammeItem",
    );
  });

  test("PARTICIPATION: traveller_id cannot point at another workspace's Traveller", async () => {
    const pool = await sharedTestPool();
    const seedA = await beginSeed(pool, 'M6 matrix participation-traveller-parent A');
    const { travellerId: foreignTravellerId } = await seedTraveller(seedA);
    await commitSeed(seedA);

    const seedB = await beginSeed(pool, 'M6 matrix participation-traveller-parent B');
    const eventId = await seedEvent(seedB);
    const programmeId = await seedProgramme(seedB, { eventId });
    const { programmeItemId } = await seedProgrammeItem(seedB, { programmeId });
    await expectParentRedirectionRejected(
      seedB,
      () => insertParticipationRow(seedB, randomUUID(), programmeItemId, foreignTravellerId),
      "PARTICIPATION.traveller_id must not resolve another workspace's Traveller",
    );
  });

  test("RESERVATION_LINE: reservation_id cannot point at another workspace's Reservation", async () => {
    const pool = await sharedTestPool();
    const seedA = await beginSeed(pool, 'M6 matrix reservation-line-parent A');
    const organisationId = await seedOrganisation(seedA);
    const foreignReservationId = await seedReservation(seedA, { organisationId });
    await commitSeed(seedA);

    const seedB = await beginSeed(pool, 'M6 matrix reservation-line-parent B');
    const resourceId = await seedResource(seedB);
    await expectParentRedirectionRejected(
      seedB,
      () => insertReservationLineRow(seedB, randomUUID(), foreignReservationId, resourceId),
      "RESERVATION_LINE.reservation_id must not resolve another workspace's Reservation",
    );
  });

  test("EXTERNAL_RECORD: connection_id cannot point at another workspace's ExternalConnection", async () => {
    const pool = await sharedTestPool();
    const seedA = await beginSeed(pool, 'M6 matrix external-record-parent A');
    const foreignConnectionId = await seedExternalConnection(seedA);
    await commitSeed(seedA);

    const seedB = await beginSeed(pool, 'M6 matrix external-record-parent B');
    await expectParentRedirectionRejected(
      seedB,
      () => insertExternalRecordRow(seedB, randomUUID(), foreignConnectionId),
      "EXTERNAL_RECORD.connection_id must not resolve another workspace's ExternalConnection",
    );
  });

  test("OWNERSHIP_BINDING: subject_id cannot point at another workspace's subject", async () => {
    const pool = await sharedTestPool();
    const seedA = await beginSeed(pool, 'M6 matrix ownership-binding-parent A');
    const { travellerId: foreignTravellerId } = await seedTraveller(seedA);
    await commitSeed(seedA);

    const seedB = await beginSeed(pool, 'M6 matrix ownership-binding-parent B');
    await expectParentRedirectionRejected(
      seedB,
      () => insertOwnershipBindingRow(seedB, randomUUID(), foreignTravellerId, 'TRAVELLER'),
      "OWNERSHIP_BINDING.subject_id must not resolve another workspace's subject",
    );
  });

  test("INFORMATION_VERSION: information_record_id cannot point at another workspace's InformationRecord", async () => {
    const pool = await sharedTestPool();
    const seedA = await beginSeed(pool, 'M6 matrix information-version-parent A');
    const record = await createFullyRegistered(CASE_BY_KIND.get('INFORMATION_RECORD')!, seedA);
    await commitSeed(seedA);

    const seedB = await beginSeed(pool, 'M6 matrix information-version-parent B');
    await expectParentRedirectionRejected(
      seedB,
      () => insertInformationVersionRow(seedB, randomUUID(), record.id),
      "INFORMATION_VERSION.information_record_id must not resolve another workspace's InformationRecord",
    );
  });
});

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

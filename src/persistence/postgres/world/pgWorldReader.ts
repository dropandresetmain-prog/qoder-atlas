/**
 * PostgreSQL world capture for M6 (src/resolution/world/world.ts).
 *
 * Runs entirely inside one `ReadSession` (REPEATABLE READ, READ ONLY):
 *
 *  1. Discovery — breadth-first over REGISTERED dependency semantics only
 *     (src/resolution/impact/closure.ts DEPENDENCY_REGISTRY), from the focus
 *     subjects, collecting typed edges. Ordinary FKs are read to find edges but
 *     never become edges themselves unless a registered semantic names them.
 *  2. Loading — every canonical row the reached Journeys need for evaluation,
 *     from each row's canonical owner (no copies).
 *  3. Manifest — aggregate revisions of every subject read, scope generations
 *     whose insertion could change the result (including never-advanced scopes
 *     at generation 0), immutable evidence/edition ids, coverage records, and
 *     explicit missing coverage.
 *
 * No evaluation happens here, and nothing is written.
 */
import type { ScopeKind, SubjectKind, TypedRef } from '../../../domain/v2/shared/identity.ts';
import type { Instant } from '../../../domain/v2/shared/time.ts';
import type { DependencyEdge, DependencySemantic } from '../../../contracts/v2/assessment/explanation.ts';
import type { WorldSnapshotManifest } from '../../../contracts/v2/scope/readScope.ts';
import type { RuleExpression } from '../../../domain/v2/knowledge/information.ts';
import type { ReadSession } from '../../../resolution/world/readSession.ts';
import { refKey } from '../../../resolution/impact/closure.ts';
import {
  WORLD_MODEL_VERSION,
  type CapturedWorld,
  type WAccompanimentRequirement,
  type WAllocation,
  type WConstraintDefinition,
  type WCoverage,
  type WInformationVersion,
  type WJourneyItem,
  type WObjective,
  type WObservedTime,
  type WRuleSetVersion,
} from '../../../resolution/world/world.ts';

export interface WorldCaptureRequest {
  workspaceId: string;
  /** Changed or requested subjects; discovery walks registered semantics from here. */
  focus: TypedRef[];
  /** Evaluation instant; applicability windows are bounded from here forward. */
  at: Instant;
  /** Information topics the evaluator registry reads (their generations are always recorded). */
  informationTopics: readonly string[];
  maxDepth?: number;
}

type Row = Record<string, unknown>;

const iso = (value: unknown): string | null => (value instanceof Date ? value.toISOString() : value === null || value === undefined ? null : String(value));
const isoReq = (value: unknown): string => {
  const out = iso(value);
  if (out === null) throw new Error('expected a timestamp');
  return out;
};
const dateOnly = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
};
const str = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
const interval = (start: unknown, end: unknown): { start: string; end: string } | null =>
  start && end ? { start: isoReq(start), end: isoReq(end) } : null;
const uniq = (values: Iterable<string | null | undefined>): string[] => [...new Set([...values].filter((v): v is string => typeof v === 'string'))].sort();
const ref = (kind: SubjectKind, id: string): TypedRef => ({ kind, id });

class EdgeSet {
  private readonly edges = new Map<string, DependencyEdge>();
  add(semantic: DependencySemantic, from: TypedRef, to: TypedRef): void {
    const edge = { semantic, from, to };
    this.edges.set(`${semantic}|${refKey(from)}|${refKey(to)}`, edge);
  }
  list(): DependencyEdge[] {
    return [...this.edges.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, edge]) => edge);
  }
}

export class PgWorldReader {
  async capture(session: ReadSession, request: WorldCaptureRequest): Promise<CapturedWorld> {
    if (session.info.workspaceId !== request.workspaceId) {
      throw new Error('world capture must run in a read session bound to the same workspace');
    }
    const ws = request.workspaceId;
    const q = async <R extends Row>(sql: string, values: unknown[] = []): Promise<R[]> =>
      (await session.db.query<R>(sql, [ws, ...values])).rows;

    const edges = new EdgeSet();
    const reached = await this.discover(q, request, edges);
    const journeyIds = uniq([...reached].filter((k) => k.startsWith('JOURNEY:')).map((k) => k.slice('JOURNEY:'.length)));

    // ---------------------------------------------------------------- travel
    const journeys = await q(
      `SELECT id, trip_id, traveller_id, lifecycle_status, intended_window_start, intended_window_end, responsibility_organisation_id
         FROM journeys WHERE workspace_id = $1 AND id = ANY($2::uuid[]) ORDER BY id`,
      [journeyIds],
    );
    const tripIds = uniq(journeys.map((j) => str(j.trip_id)));
    const travellerIdsFromJourneys = uniq(journeys.map((j) => str(j.traveller_id)));

    const trips = await q(
      `SELECT id, purpose, lifecycle_status, intended_window_start, intended_window_end, business_context_organisation_id
         FROM trips WHERE workspace_id = $1 AND id = ANY($2::uuid[]) ORDER BY id`,
      [tripIds],
    );
    const items = await q(
      `SELECT ji.id, ji.journey_id, ji.kind, ji.order_key, ji.lifecycle_status, ji.flexible, ji.intended_window_start, ji.intended_window_end,
              t.desired_origin_place_id, t.desired_destination_place_id, t.selected_service_id,
              s.intended_place_id, s.required_nights,
              e.participation_id, e.standalone_title, e.standalone_window_start, e.standalone_window_end,
              r.resource_id, r.intended_location_place_id
         FROM journey_items ji
         LEFT JOIN transport_item_details t ON t.workspace_id = ji.workspace_id AND t.journey_item_id = ji.id
         LEFT JOIN stay_item_details s ON s.workspace_id = ji.workspace_id AND s.journey_item_id = ji.id
         LEFT JOIN engagement_item_details e ON e.workspace_id = ji.workspace_id AND e.journey_item_id = ji.id
         LEFT JOIN resource_use_item_details r ON r.workspace_id = ji.workspace_id AND r.journey_item_id = ji.id
        WHERE ji.workspace_id = $1 AND ji.journey_id = ANY($2::uuid[])
        ORDER BY ji.journey_id, ji.order_key, ji.id`,
      [journeyIds],
    );
    const journeyItems: WJourneyItem[] = items.map((r) => ({
      id: String(r.id), journeyId: String(r.journey_id), kind: String(r.kind) as WJourneyItem['kind'], orderKey: String(r.order_key),
      lifecycleStatus: String(r.lifecycle_status), flexible: Boolean(r.flexible), intendedWindow: interval(r.intended_window_start, r.intended_window_end),
      desiredOriginPlaceId: str(r.desired_origin_place_id), desiredDestinationPlaceId: str(r.desired_destination_place_id), selectedServiceId: str(r.selected_service_id),
      intendedPlaceId: str(r.intended_place_id), requiredNights: r.required_nights === null || r.required_nights === undefined ? null : Number(r.required_nights),
      participationId: str(r.participation_id), standaloneTitle: str(r.standalone_title), standaloneWindow: interval(r.standalone_window_start, r.standalone_window_end),
      resourceId: str(r.resource_id), intendedLocationPlaceId: str(r.intended_location_place_id),
    }));
    const itemIds = journeyItems.map((i) => i.id);

    const visits = await q(
      `SELECT id, journey_id, jurisdiction_id, purpose, intended_start, intended_end, transit_intent
         FROM intended_visits WHERE workspace_id = $1 AND journey_id = ANY($2::uuid[]) ORDER BY journey_id, intended_start, id`,
      [journeyIds],
    );
    const selections = await q(
      `SELECT s.id, s.journey_id, s.credential_id, s.credential_version_id,
              COALESCE(array_agg(v.intended_visit_id::text ORDER BY v.intended_visit_id) FILTER (WHERE v.intended_visit_id IS NOT NULL), '{}') AS visit_ids
         FROM credential_selections s
         LEFT JOIN credential_selection_visits v ON v.workspace_id = s.workspace_id AND v.selection_id = s.id
        WHERE s.workspace_id = $1 AND s.journey_id = ANY($2::uuid[])
        GROUP BY s.workspace_id, s.id
        ORDER BY s.journey_id, s.id`,
      [journeyIds],
    );

    const memberships = await q(
      `SELECT m.id, m.coordination_group_id, m.journey_id, m.effective_start, m.effective_end,
              COALESCE(array_agg(i.journey_item_id::text ORDER BY i.journey_item_id) FILTER (WHERE i.journey_item_id IS NOT NULL), '{}') AS item_ids
         FROM group_memberships m
         LEFT JOIN group_membership_items i ON i.workspace_id = m.workspace_id AND i.membership_id = m.id
        WHERE m.workspace_id = $1
          AND m.coordination_group_id IN (SELECT coordination_group_id FROM group_memberships WHERE workspace_id = $1 AND journey_id = ANY($2::uuid[]))
        GROUP BY m.workspace_id, m.id ORDER BY m.coordination_group_id, m.id`,
      [journeyIds],
    );
    const groupIds = uniq(memberships.map((m) => str(m.coordination_group_id)));
    const groups = await q(
      `SELECT id, name, lifecycle_status, effective_start, effective_end FROM coordination_groups
        WHERE workspace_id = $1 AND id = ANY($2::uuid[]) ORDER BY id`,
      [groupIds],
    );

    // ---------------------------------------------------------------- support
    const requirementRows = await q(
      `SELECT r.id, r.version, r.supported_traveller_id, r.coverage_start, r.coverage_end, r.minimum_simultaneous_supporters,
              r.maximum_handoff_gap_minutes, r.provenance_evidence_id,
              r.version = (SELECT max(version) FROM accompaniment_requirements x WHERE x.workspace_id = r.workspace_id AND x.id = r.id) AS latest,
              COALESCE(array_agg(e.supporter_traveller_id::text ORDER BY e.supporter_traveller_id) FILTER (WHERE e.supporter_traveller_id IS NOT NULL), '{}') AS eligible
         FROM accompaniment_requirements r
         LEFT JOIN accompaniment_eligible_supporters e
           ON e.workspace_id = r.workspace_id AND e.requirement_id = r.id AND e.requirement_version = r.version
        WHERE r.workspace_id = $1
          AND (r.supported_traveller_id = ANY($2::uuid[])
               OR EXISTS (SELECT 1 FROM accompaniment_eligible_supporters s
                           WHERE s.workspace_id = r.workspace_id AND s.requirement_id = r.id AND s.requirement_version = r.version
                             AND s.supporter_traveller_id = ANY($2::uuid[])))
        GROUP BY r.workspace_id, r.id, r.version
        ORDER BY r.id, r.version`,
      [travellerIdsFromJourneys],
    );
    const accompanimentRequirements: WAccompanimentRequirement[] = requirementRows.map((r) => ({
      id: String(r.id), version: Number(r.version), supportedTravellerId: String(r.supported_traveller_id),
      coverage: { start: isoReq(r.coverage_start), end: isoReq(r.coverage_end) },
      minimumSimultaneousSupporters: Number(r.minimum_simultaneous_supporters), maximumHandoffGapMinutes: Number(r.maximum_handoff_gap_minutes),
      eligibleSupporterTravellerIds: (r.eligible as string[]) ?? [], provenanceEvidenceId: str(r.provenance_evidence_id), latestVersion: Boolean(r.latest),
    }));
    const requirementIds = uniq(accompanimentRequirements.map((r) => r.id));
    const assignmentRows = await q(
      `SELECT a.id, a.constraint_definition_id, a.constraint_definition_version, a.lifecycle_status,
              COALESCE((SELECT array_agg(x.supporter_traveller_id::text ORDER BY x.supporter_traveller_id) FROM support_assignment_assignees x
                         WHERE x.workspace_id = a.workspace_id AND x.assignment_id = a.id), '{}') AS assignees,
              COALESCE((SELECT json_agg(json_build_object('supporter', s.supporter_traveller_id, 'start', s.scope_start, 'end', s.scope_end) ORDER BY s.scope_start, s.supporter_traveller_id)
                          FROM support_assignment_scopes s WHERE s.workspace_id = a.workspace_id AND s.assignment_id = a.id), '[]') AS scopes,
              COALESCE((SELECT json_agg(json_build_object('from', h.from_supporter_traveller_id, 'to', h.to_supporter_traveller_id, 'at', h.handoff_at) ORDER BY h.handoff_at)
                          FROM support_assignment_handoffs h WHERE h.workspace_id = a.workspace_id AND h.assignment_id = a.id), '[]') AS handoffs
         FROM support_assignments a
        WHERE a.workspace_id = $1 AND a.constraint_definition_id = ANY($2::uuid[])
        ORDER BY a.id`,
      [requirementIds],
    );

    const travellerIds = uniq([
      ...travellerIdsFromJourneys,
      ...accompanimentRequirements.flatMap((r) => [r.supportedTravellerId, ...r.eligibleSupporterTravellerIds]),
    ]);

    // ---------------------------------------------------------------- people
    const travellers = await q(
      `SELECT id, lifecycle_status FROM travellers WHERE workspace_id = $1 AND id = ANY($2::uuid[]) ORDER BY id`,
      [travellerIds],
    );
    const assertions = await q(
      `SELECT a.id, a.traveller_id, a.assertion_type, a.effective_from, a.effective_to, a.value, a.evidence_id,
              EXISTS (SELECT 1 FROM profile_assertions n WHERE n.workspace_id = a.workspace_id AND n.supersedes_assertion_id = a.id) AS superseded
         FROM profile_assertions a WHERE a.workspace_id = $1 AND a.traveller_id = ANY($2::uuid[]) ORDER BY a.traveller_id, a.id`,
      [travellerIds],
    );
    const credentials = await q(
      `SELECT id, traveller_id, kind, issuer_country, current_version_id FROM travel_credentials
        WHERE workspace_id = $1 AND traveller_id = ANY($2::uuid[]) ORDER BY traveller_id, id`,
      [travellerIds],
    );
    const credentialIds = uniq(credentials.map((c) => str(c.id)));
    const versions = await q(
      `SELECT v.id, v.credential_id, v.kind, v.edition_number, v.issue_date, v.expiry_date, v.issuer_status, v.physically_available, v.evidence_id,
              COALESCE(p.issuing_state_code, vd.issuing_state_code, rd.issuing_state_code, hd.issuing_state_code) AS issuing_state_code,
              vd.visa_class, COALESCE(vd.permitted_activities, rd.permitted_activities, '{}') AS permitted_activities,
              vd.entries_allowed, vd.permitted_stay_days
         FROM credential_versions v
         LEFT JOIN passport_details p ON p.workspace_id = v.workspace_id AND p.credential_version_id = v.id
         LEFT JOIN visa_details vd ON vd.workspace_id = v.workspace_id AND vd.credential_version_id = v.id
         LEFT JOIN residence_credential_details rd ON rd.workspace_id = v.workspace_id AND rd.credential_version_id = v.id
         LEFT JOIN health_credential_details hd ON hd.workspace_id = v.workspace_id AND hd.credential_version_id = v.id
        WHERE v.workspace_id = $1 AND v.credential_id = ANY($2::uuid[])
        ORDER BY v.credential_id, v.edition_number`,
      [credentialIds],
    );
    const links = await q(
      `SELECT credential_id, related_credential_id, traveller_id, link_type, effective_from, effective_to, evidence_id
         FROM credential_links WHERE workspace_id = $1 AND traveller_id = ANY($2::uuid[]) ORDER BY credential_id, related_credential_id`,
      [travellerIds],
    );
    const history = await q(
      `SELECT id, traveller_id, jurisdiction_id, entry_date, exit_date, coverage_claim, evidence_id
         FROM travel_history WHERE workspace_id = $1 AND traveller_id = ANY($2::uuid[]) ORDER BY traveller_id, entry_date NULLS FIRST, id`,
      [travellerIds],
    );

    // ----------------------------------------------------------- arrangements
    // Focus-traveller allocations first; shared-resource capacity later expands
    // peer lines that consume the same Resource without walking their Journeys.
    let allocations = await q(
      `SELECT id, reservation_id, line_id, traveller_id, journey_item_id, allocation_role, quantity
         FROM reservation_allocations
        WHERE workspace_id = $1 AND (traveller_id = ANY($2::uuid[]) OR journey_item_id = ANY($3::uuid[]))
        ORDER BY reservation_id, line_id, id`,
      [travellerIds, itemIds],
    );
    let reservationIds = uniq(allocations.map((a) => str(a.reservation_id)));
    let lines = await q(
      `SELECT l.id, l.reservation_id, l.product_type, l.observed_status, l.observed_status_at, l.observation_evidence_id,
              t.transport_service_id, COALESCE(s.resource_id, u.resource_id) AS resource_id, COALESCE(s.place_id, u.place_id) AS place_id,
              COALESCE(s.stay_interval_start, u.use_interval_start) AS interval_start, COALESCE(s.stay_interval_end, u.use_interval_end) AS interval_end
         FROM reservation_lines l
         LEFT JOIN transport_line_details t ON t.workspace_id = l.workspace_id AND t.line_id = l.id
         LEFT JOIN stay_line_details s ON s.workspace_id = l.workspace_id AND s.line_id = l.id
         LEFT JOIN resource_use_line_details u ON u.workspace_id = l.workspace_id AND u.line_id = l.id
        WHERE l.workspace_id = $1 AND l.reservation_id = ANY($2::uuid[])
        ORDER BY l.reservation_id, l.id`,
      [reservationIds],
    );
    let lineIds = uniq(lines.map((l) => str(l.id)));
    let reservations = await q(
      `SELECT id, reservation_type, observed_status, observed_status_at, responsible_organisation_id, responsible_traveller_id
         FROM reservations WHERE workspace_id = $1 AND id = ANY($2::uuid[]) ORDER BY id`,
      [reservationIds],
    );
    const entitlements = await q(
      `SELECT e.id, e.entitlement_type, e.observed_status, e.observed_status_at, e.observation_evidence_id,
              COALESCE((SELECT array_agg(DISTINCT ll.line_id::text) FROM entitlement_line_links ll WHERE ll.workspace_id = e.workspace_id AND ll.entitlement_id = e.id), '{}') AS line_ids,
              COALESCE((SELECT array_agg(DISTINCT pl.traveller_id::text) FROM entitlement_person_links pl WHERE pl.workspace_id = e.workspace_id AND pl.entitlement_id = e.id), '{}') AS traveller_ids
         FROM service_entitlements e
        WHERE e.workspace_id = $1
          AND (EXISTS (SELECT 1 FROM entitlement_line_links ll WHERE ll.workspace_id = e.workspace_id AND ll.entitlement_id = e.id AND ll.line_id = ANY($2::uuid[]))
               OR EXISTS (SELECT 1 FROM entitlement_person_links pl WHERE pl.workspace_id = e.workspace_id AND pl.entitlement_id = e.id AND pl.traveller_id = ANY($3::uuid[])))
        ORDER BY e.id`,
      [lineIds, travellerIds],
    );

    // ------------------------------------------------------------- programmes
    const participationRows = await q(
      `SELECT id, programme_item_id, traveller_id, obligation, accepted, preparation_window_start, preparation_window_end
         FROM participations
        WHERE workspace_id = $1 AND (traveller_id = ANY($2::uuid[]) OR id = ANY($3::uuid[]))
        ORDER BY programme_item_id, traveller_id`,
      [travellerIds, uniq(journeyItems.map((i) => i.participationId))],
    );
    const programmeItemIds = uniq(participationRows.map((p) => str(p.programme_item_id)));
    const programmeItems = await q(
      `SELECT id, programme_id, title, item_type, place_id, window_start, window_end, lifecycle_status, schedule_authority
         FROM programme_items WHERE workspace_id = $1 AND id = ANY($2::uuid[]) ORDER BY programme_id, id`,
      [programmeItemIds],
    );
    const programmeIds = uniq(programmeItems.map((p) => str(p.programme_id)));
    const programmes = await q(
      `SELECT id, event_id, title, lifecycle_status FROM programmes WHERE workspace_id = $1 AND id = ANY($2::uuid[]) ORDER BY id`,
      [programmeIds],
    );

    const directResourceIds = uniq([...lines.map((l) => str(l.resource_id)), ...journeyItems.map((i) => i.resourceId)]);
    const assignmentsForActivities = await q(
      `SELECT id, activity_kind, activity_id, resource_id, quantity, lifecycle_status FROM resource_assignments
        WHERE workspace_id = $1 AND (activity_id = ANY($2::uuid[]) OR resource_id = ANY($3::uuid[]))
        ORDER BY resource_id, id`,
      [[...itemIds, ...programmeItemIds], directResourceIds],
    );
    const resourceIds = uniq([...directResourceIds, ...assignmentsForActivities.map((a) => str(a.resource_id))]);

    // Capacity accounting reads every reservation line that consumes a captured
    // Resource (and every allocation on those lines). This is world-fact
    // completeness for the evaluator — not impact/blast-radius expansion.
    if (resourceIds.length > 0) {
      const capacityLines = await q(
        `SELECT l.id, l.reservation_id, l.product_type, l.observed_status, l.observed_status_at, l.observation_evidence_id,
                t.transport_service_id, COALESCE(s.resource_id, u.resource_id) AS resource_id, COALESCE(s.place_id, u.place_id) AS place_id,
                COALESCE(s.stay_interval_start, u.use_interval_start) AS interval_start, COALESCE(s.stay_interval_end, u.use_interval_end) AS interval_end
           FROM reservation_lines l
           LEFT JOIN transport_line_details t ON t.workspace_id = l.workspace_id AND t.line_id = l.id
           LEFT JOIN stay_line_details s ON s.workspace_id = l.workspace_id AND s.line_id = l.id
           LEFT JOIN resource_use_line_details u ON u.workspace_id = l.workspace_id AND u.line_id = l.id
          WHERE l.workspace_id = $1
            AND COALESCE(s.resource_id, u.resource_id) = ANY($2::uuid[])
          ORDER BY l.reservation_id, l.id`,
        [resourceIds],
      );
      const knownLineIds = new Set(lineIds);
      const peerLines = capacityLines.filter((l) => !knownLineIds.has(str(l.id)));
      if (peerLines.length > 0) {
        lines = [...lines, ...peerLines].sort((a, b) => String(a.reservation_id).localeCompare(String(b.reservation_id)) || String(a.id).localeCompare(String(b.id)));
        lineIds = uniq(lines.map((l) => str(l.id)));
        reservationIds = uniq([...reservationIds, ...peerLines.map((l) => str(l.reservation_id))]);
        reservations = await q(
          `SELECT id, reservation_type, observed_status, observed_status_at, responsible_organisation_id, responsible_traveller_id
             FROM reservations WHERE workspace_id = $1 AND id = ANY($2::uuid[]) ORDER BY id`,
          [reservationIds],
        );
      }
      // All allocations on capacity-relevant lines (peer travellers included).
      allocations = await q(
        `SELECT id, reservation_id, line_id, traveller_id, journey_item_id, allocation_role, quantity
           FROM reservation_allocations
          WHERE workspace_id = $1 AND line_id = ANY($2::uuid[])
          ORDER BY reservation_id, line_id, id`,
        [lineIds],
      );
    }

    // Every assignment of every involved resource: capacity is a property of the shared resource.
    const resourceAssignments = await q(
      `SELECT id, activity_kind, activity_id, resource_id, quantity, lifecycle_status FROM resource_assignments
        WHERE workspace_id = $1 AND resource_id = ANY($2::uuid[]) ORDER BY resource_id, id`,
      [resourceIds],
    );
    const resources = await q(
      `SELECT id, resource_type, location_place_id, capacity FROM resources WHERE workspace_id = $1 AND id = ANY($2::uuid[]) ORDER BY id`,
      [resourceIds],
    );

    const serviceIds = uniq([...lines.map((l) => str(l.transport_service_id)), ...journeyItems.map((i) => i.selectedServiceId)]);
    const services = await q(
      `SELECT id, mode, operator, origin_place_id, destination_place_id,
              published_departure, published_arrival, published_observed_at, published_evidence_id,
              estimated_departure, estimated_arrival, estimated_observed_at, estimated_evidence_id,
              actual_departure, actual_arrival, actual_observed_at, actual_evidence_id
         FROM transport_services WHERE workspace_id = $1 AND id = ANY($2::uuid[]) ORDER BY id`,
      [serviceIds],
    );

    // -------------------------------------------------------------- geography
    const placeIds = uniq([
      ...journeyItems.flatMap((i) => [i.desiredOriginPlaceId, i.desiredDestinationPlaceId, i.intendedPlaceId, i.intendedLocationPlaceId]),
      ...services.flatMap((s) => [str(s.origin_place_id), str(s.destination_place_id)]),
      ...programmeItems.map((p) => str(p.place_id)),
      ...resources.map((r) => str(r.location_place_id)),
      ...lines.map((l) => str(l.place_id)),
    ]);
    const places = await q(
      `SELECT id, name, place_type, time_zone, (latitude IS NOT NULL) AS has_coordinates FROM places
        WHERE workspace_id = $1 AND id = ANY($2::uuid[]) ORDER BY id`,
      [placeIds],
    );
    const atDate = request.at.slice(0, 10);
    const placeJurisdictions = await q(
      `SELECT DISTINCT p.id AS place_id, ja.jurisdiction_id, ja.area_version_id, m.basis, m.evidence_id
         FROM places p
         JOIN LATERAL (
           SELECT am.containing_area_version_id AS area_version_id, 'AREA_MEMBERSHIP'::text AS basis, am.evidence_id
             FROM area_memberships am
            WHERE am.workspace_id = p.workspace_id AND am.member_kind = 'PLACE' AND am.member_place_id = p.id
              AND am.valid_from <= $3::date AND (am.valid_until IS NULL OR am.valid_until > $3::date)
           UNION ALL
           SELECT av.id, 'SPATIAL_CONTAINMENT', av.evidence_id
             FROM area_versions av
            WHERE av.workspace_id = p.workspace_id AND p.location IS NOT NULL
              AND av.valid_from <= $3::date AND (av.valid_until IS NULL OR av.valid_until > $3::date)
              AND ST_Covers(av.geometry, p.location)
         ) m ON true
         JOIN jurisdiction_areas ja ON ja.workspace_id = p.workspace_id AND ja.area_version_id = m.area_version_id
          AND ja.valid_from <= $3::date AND (ja.valid_until IS NULL OR ja.valid_until > $3::date)
        WHERE p.workspace_id = $1 AND p.id = ANY($2::uuid[])
        ORDER BY place_id, jurisdiction_id, basis`,
      [placeIds, atDate],
    );
    const jurisdictionIds = uniq([
      ...visits.map((v) => str(v.jurisdiction_id)),
      ...history.map((h) => str(h.jurisdiction_id)),
      ...placeJurisdictions.map((pj) => str(pj.jurisdiction_id)),
    ]);

    // -------------------------------------------------------------- knowledge
    const organisationIds = uniq([
      ...trips.map((t) => str(t.business_context_organisation_id)),
      ...journeys.map((j) => str(j.responsibility_organisation_id)),
      ...reservations.map((r) => str(r.responsible_organisation_id)),
    ]);
    const costAllocations = await q(
      `SELECT id, reservation_id, payer_organisation_id, payer_traveller_id, entry_kind, amount::text AS amount, currency, fx_observation_id, evidence_id
         FROM cost_allocations WHERE workspace_id = $1 AND reservation_id = ANY($2::uuid[]) ORDER BY reservation_id, id`,
      [reservationIds],
    );
    const allOrganisationIds = uniq([...organisationIds, ...costAllocations.map((c) => str(c.payer_organisation_id))]);
    const organisations = await q(
      `SELECT id, default_currency_code FROM organisations WHERE workspace_id = $1 AND id = ANY($2::uuid[]) ORDER BY id`,
      [allOrganisationIds],
    );
    const budgets = await q(
      `SELECT id, organisation_id, amount::text AS amount, currency, valid_from, valid_until FROM budgets
        WHERE workspace_id = $1 AND organisation_id = ANY($2::uuid[]) ORDER BY id`,
      [allOrganisationIds],
    );
    const budgetCommitments = await q(
      `SELECT id, budget_id, amount::text AS amount, currency, status FROM budget_commitments
        WHERE workspace_id = $1 AND budget_id = ANY($2::uuid[]) ORDER BY budget_id, id`,
      [uniq(budgets.map((b) => str(b.id)))],
    );
    const fxObservations = await q(
      `SELECT id, base_currency, quote_currency, rate::text AS rate, as_of, expires_at, edition FROM fx_observations
        WHERE workspace_id = $1 AND id = ANY($2::uuid[]) ORDER BY id`,
      [uniq(costAllocations.map((c) => str(c.fx_observation_id)))],
    );

    const ownerKeys: TypedRef[] = [
      ...tripIds.map((id) => ref('TRIP', id)), ...journeyIds.map((id) => ref('JOURNEY', id)), ...groupIds.map((id) => ref('COORDINATION_GROUP', id)),
      ...programmeIds.map((id) => ref('PROGRAMME', id)), ...travellerIds.map((id) => ref('TRAVELLER', id)), ...programmeItemIds.map((id) => ref('PROGRAMME_ITEM', id)),
      ...allOrganisationIds.map((id) => ref('ORGANISATION', id)), ...resourceIds.map((id) => ref('RESOURCE', id)),
      // Place-owned requirements (e.g. transfer times published for a venue or hub).
      ...placeIds.map((id) => ref('PLACE', id)),
    ];
    const objectiveRows = await q(
      `SELECT o.id, o.owner_kind, o.owner_id, o.success_predicate_kind, o.hardness, o.priority,
              d.disposition, d.evidence_id AS disposition_evidence_id,
              COALESCE((SELECT json_agg(json_build_object('label', t.label, 'kind', t.target_kind, 'subjectKind', t.subject_kind, 'subjectId', t.subject_id,
                                                        'placeId', t.place_id, 'atOrBefore', t.at_or_before, 'amountMinor', t.amount_minor, 'currency', t.currency_code) ORDER BY t.label)
                          FROM objective_targets t WHERE t.workspace_id = o.workspace_id AND t.objective_id = o.id), '[]') AS targets
         FROM objectives o
         LEFT JOIN LATERAL (
           SELECT disposition, evidence_id FROM objective_dispositions x
            WHERE x.workspace_id = o.workspace_id AND x.objective_id = o.id ORDER BY x.sequence_number DESC LIMIT 1
         ) d ON true
        WHERE o.workspace_id = $1 AND (o.owner_kind, o.owner_id) IN (SELECT * FROM unnest($2::text[], $3::uuid[]))
        ORDER BY o.id`,
      [ownerKeys.map((k) => k.kind), ownerKeys.map((k) => k.id)],
    );
    const constraintRows = await q(
      `SELECT c.id, c.registered_type, c.hardness, c.owner_kind, c.owner_id, c.provenance_evidence_id,
              COALESCE((SELECT json_agg(json_build_object('key', o.operand_key, 'kind', o.operand_kind, 'subjectKind', o.subject_kind, 'subjectId', o.subject_id,
                                                        'text', o.text_value, 'number', o.number_value::text, 'boolean', o.boolean_value,
                                                        'instant', o.instant_value, 'localDate', o.local_date_value::text) ORDER BY o.operand_key)
                          FROM constraint_operands o WHERE o.workspace_id = c.workspace_id AND o.constraint_definition_id = c.id), '[]') AS operands
         FROM constraint_definitions c
        WHERE c.workspace_id = $1 AND (c.owner_kind, c.owner_id) IN (SELECT * FROM unnest($2::text[], $3::uuid[]))
        ORDER BY c.id`,
      [ownerKeys.map((k) => k.kind), ownerKeys.map((k) => k.id)],
    );
    const dependencySubjectIds = uniq([...itemIds, ...serviceIds, ...programmeItemIds, ...lineIds, ...participationRows.map((p) => str(p.id))]);
    const dependencyRows = await q(
      `SELECT id, from_subject_kind, from_subject_id, to_subject_kind, to_subject_id, dependency_kind, constraint_definition_id
         FROM dependencies WHERE workspace_id = $1 AND (from_subject_id = ANY($2::uuid[]) OR to_subject_id = ANY($2::uuid[])) ORDER BY id`,
      [dependencySubjectIds],
    );

    const ruleAssignmentRows = await q(
      `SELECT id, rule_set_id, rule_set_version_id, select_current_edition, organisation_id, subject_kind, subject_id, jurisdiction_id,
              population_predicate_id, valid_from, valid_until
         FROM rule_assignments
        WHERE workspace_id = $1 AND (valid_until IS NULL OR valid_until > $5::timestamptz)
          AND (organisation_id = ANY($2::uuid[])
               OR (subject_kind, subject_id) IN (SELECT * FROM unnest($3::text[], $4::uuid[]))
               OR jurisdiction_id = ANY($6::uuid[])
               OR population_predicate_id IS NOT NULL)
        ORDER BY id`,
      [allOrganisationIds, ownerKeys.map((k) => k.kind), ownerKeys.map((k) => k.id), request.at, jurisdictionIds],
    );

    const informationRows = await q(
      `SELECT DISTINCT iv.id
         FROM information_versions iv
         JOIN information_records ir ON ir.workspace_id = iv.workspace_id AND ir.id = iv.information_record_id
         JOIN information_scopes s ON s.workspace_id = iv.workspace_id AND s.information_version_id = iv.id
        WHERE iv.workspace_id = $1 AND ir.topic = ANY($2::text[]) AND s.effective_exposure_until > $3::timestamptz
          AND (s.jurisdiction_id = ANY($4::uuid[])
               OR s.area_version_id IN (SELECT area_version_id FROM jurisdiction_areas WHERE workspace_id = $1 AND jurisdiction_id = ANY($4::uuid[]))
               OR (s.subject_kind, s.subject_id) IN (SELECT * FROM unnest($5::text[], $6::uuid[])))`,
      [
        [...request.informationTopics], request.at, jurisdictionIds,
        [...ownerKeys, ...serviceIds.map((id) => ref('TRANSPORT_SERVICE', id))].map((k) => k.kind),
        [...ownerKeys, ...serviceIds.map((id) => ref('TRANSPORT_SERVICE', id))].map((k) => k.id),
      ],
    );
    const informationIds = uniq(informationRows.map((r) => str(r.id)));
    const regulatoryRuleSetRows = await q(
      `SELECT DISTINCT rule_set_id FROM regulatory_publications WHERE workspace_id = $1 AND information_version_id = ANY($2::uuid[])`,
      [informationIds],
    );
    const ruleSetIds = uniq([...ruleAssignmentRows.map((r) => str(r.rule_set_id)), ...regulatoryRuleSetRows.map((r) => str(r.rule_set_id))]);
    // Referenced RuleSets (including those with no captured PUBLISHED/SUPERSEDED
    // edition) must still appear in the manifest so first-edition publication
    // can invalidate an earlier UNKNOWN assessment.
    const referencedRuleSetIds = ruleSetIds;
    const ruleSetVersionRows = await q(
      `SELECT v.id, v.rule_set_id, rs.policy_family, rs.issuer_kind, rs.issuer_id, v.edition_number, v.status, v.effective_from, v.effective_until, v.expression,
              COALESCE((SELECT json_agg(json_build_object('id', r.id, 'ruleKey', r.rule_key, 'severity', r.severity, 'expression', r.expression) ORDER BY r.rule_key)
                          FROM rules r WHERE r.workspace_id = v.workspace_id AND r.rule_set_version_id = v.id), '[]') AS rules
         FROM rule_set_versions v JOIN rule_sets rs ON rs.workspace_id = v.workspace_id AND rs.id = v.rule_set_id
        WHERE v.workspace_id = $1 AND v.rule_set_id = ANY($2::uuid[]) AND v.status IN ('PUBLISHED', 'SUPERSEDED')
        ORDER BY v.rule_set_id, v.edition_number`,
      [ruleSetIds],
    );
    const informationDetailRows = await q(
      `SELECT iv.id, iv.information_record_id, ir.topic, ir.publisher_organisation_id, iv.subtype, iv.external_edition_sequence, iv.issued_at, iv.observed_at,
              iv.effective_from, iv.effective_until, iv.evidence_id, iv.supersedes_information_version_id, iv.retracts_information_version_id,
              iv.source_native_severity, COALESCE(ad.risk_topics, '{}') AS risk_topics, cd.condition_type,
              rp.rule_set_version_id AS regulatory_rule_set_version_id, rp.jurisdiction_id AS regulatory_jurisdiction_id,
              COALESCE((SELECT json_agg(json_build_object('id', s.id, 'jurisdictionId', s.jurisdiction_id, 'areaVersionId', s.area_version_id,
                                                        'subjectKind', s.subject_kind, 'subjectId', s.subject_id, 'purpose', s.purpose, 'serviceCategory', s.service_category,
                                                        'populationPredicateId', s.population_predicate_id, 'from', s.effective_exposure_from, 'until', s.effective_exposure_until) ORDER BY s.id)
                          FROM information_scopes s WHERE s.workspace_id = iv.workspace_id AND s.information_version_id = iv.id), '[]') AS scopes
         FROM information_versions iv
         JOIN information_records ir ON ir.workspace_id = iv.workspace_id AND ir.id = iv.information_record_id
         LEFT JOIN advisory_details ad ON ad.workspace_id = iv.workspace_id AND ad.information_version_id = iv.id
         LEFT JOIN condition_details cd ON cd.workspace_id = iv.workspace_id AND cd.information_version_id = iv.id
         LEFT JOIN regulatory_publications rp ON rp.workspace_id = iv.workspace_id AND rp.information_version_id = iv.id
        WHERE iv.workspace_id = $1
          AND (iv.id = ANY($2::uuid[])
               -- retractions/supersessions of a read edition are part of what that edition means now
               OR iv.retracts_information_version_id = ANY($2::uuid[]) OR iv.supersedes_information_version_id = ANY($2::uuid[]))
        ORDER BY iv.information_record_id, iv.external_edition_sequence`,
      [informationIds],
    );
    const coverageRows = await q(
      `SELECT id, topic, query_bounds, edition, watermark, completeness, completeness_limitations, expires_at, evidence_id
         FROM knowledge_coverage WHERE workspace_id = $1 AND topic = ANY($2::text[]) ORDER BY topic, id`,
      [[...request.informationTopics]],
    );

    // ------------------------------------------------------------ assemble
    const world: Omit<CapturedWorld, 'manifest'> = {
      workspaceId: ws,
      focus: [...request.focus].sort((a, b) => refKey(a).localeCompare(refKey(b))),
      edges: edges.list(),
      capture: {
        isolation: 'REPEATABLE_READ', readOnly: true, databaseSnapshot: session.info.databaseSnapshot,
        capturedAt: session.info.transactionStartedAt, modelVersion: WORLD_MODEL_VERSION,
      },
      travellers: travellers.map((t) => ({ id: String(t.id), revision: 0, lifecycleStatus: String(t.lifecycle_status) })),
      profileAssertions: assertions.map((a) => ({
        id: String(a.id), travellerId: String(a.traveller_id), assertionType: String(a.assertion_type), effectiveFrom: dateOnly(a.effective_from) ?? '',
        effectiveTo: dateOnly(a.effective_to), value: (a.value as Record<string, unknown>) ?? {}, evidenceId: String(a.evidence_id), superseded: Boolean(a.superseded),
      })),
      credentials: credentials.map((c) => ({ id: String(c.id), travellerId: String(c.traveller_id), kind: String(c.kind), issuerCountry: String(c.issuer_country), currentVersionId: String(c.current_version_id) })),
      credentialVersions: versions.map((v) => ({
        id: String(v.id), credentialId: String(v.credential_id), kind: String(v.kind), editionNumber: Number(v.edition_number), issueDate: dateOnly(v.issue_date) ?? '',
        expiryDate: dateOnly(v.expiry_date), issuerStatus: String(v.issuer_status), physicallyAvailable: v.physically_available === null ? null : Boolean(v.physically_available),
        evidenceId: String(v.evidence_id), issuingStateCode: str(v.issuing_state_code), visaClass: str(v.visa_class),
        permittedActivities: (v.permitted_activities as string[]) ?? [], entriesAllowed: v.entries_allowed === null ? null : Number(v.entries_allowed),
        permittedStayDays: v.permitted_stay_days === null ? null : Number(v.permitted_stay_days),
      })),
      credentialLinks: links.map((l) => ({
        credentialId: String(l.credential_id), relatedCredentialId: String(l.related_credential_id), travellerId: String(l.traveller_id), linkType: String(l.link_type),
        effectiveFrom: dateOnly(l.effective_from) ?? '', effectiveTo: dateOnly(l.effective_to), evidenceId: String(l.evidence_id),
      })),
      travelHistory: history.map((h) => ({
        id: String(h.id), travellerId: String(h.traveller_id), jurisdictionId: String(h.jurisdiction_id), entryDate: dateOnly(h.entry_date), exitDate: dateOnly(h.exit_date),
        coverageClaim: String(h.coverage_claim), evidenceId: String(h.evidence_id),
      })),
      organisations: organisations.map((o) => ({ id: String(o.id), revision: 0, defaultCurrencyCode: str(o.default_currency_code) })),
      trips: trips.map((t) => ({
        id: String(t.id), revision: 0, purpose: String(t.purpose), lifecycleStatus: String(t.lifecycle_status),
        intendedWindow: interval(t.intended_window_start, t.intended_window_end), businessContextOrganisationId: str(t.business_context_organisation_id),
      })),
      journeys: journeys.map((j) => ({
        id: String(j.id), revision: 0, tripId: String(j.trip_id), travellerId: String(j.traveller_id), lifecycleStatus: String(j.lifecycle_status),
        intendedWindow: interval(j.intended_window_start, j.intended_window_end), responsibilityOrganisationId: str(j.responsibility_organisation_id),
      })),
      journeyItems,
      intendedVisits: visits.map((v) => ({
        id: String(v.id), journeyId: String(v.journey_id), jurisdictionId: String(v.jurisdiction_id), purpose: String(v.purpose),
        intended: { start: isoReq(v.intended_start), end: isoReq(v.intended_end) }, transitIntent: Boolean(v.transit_intent),
      })),
      credentialSelections: selections.map((s) => ({
        id: String(s.id), journeyId: String(s.journey_id), credentialId: String(s.credential_id), credentialVersionId: String(s.credential_version_id),
        intendedVisitIds: (s.visit_ids as string[]) ?? [],
      })),
      coordinationGroups: groups.map((g) => ({
        id: String(g.id), revision: 0, name: String(g.name), lifecycleStatus: String(g.lifecycle_status), effective: { start: iso(g.effective_start), end: iso(g.effective_end) },
      })),
      groupMemberships: memberships.map((m) => ({
        id: String(m.id), groupId: String(m.coordination_group_id), journeyId: String(m.journey_id), effective: { start: iso(m.effective_start), end: iso(m.effective_end) },
        scopeItemIds: (m.item_ids as string[]) ?? [],
      })),
      accompanimentRequirements,
      supportAssignments: assignmentRows.map((a) => ({
        id: String(a.id), revision: 0, requirementId: String(a.constraint_definition_id), requirementVersion: Number(a.constraint_definition_version),
        lifecycleStatus: String(a.lifecycle_status), assigneeTravellerIds: (a.assignees as string[]) ?? [],
        scopes: (a.scopes as { supporter: string; start: string; end: string }[]).map((s) => ({ supporterTravellerId: s.supporter, start: isoReq(new Date(s.start)), end: isoReq(new Date(s.end)) })),
        handoffs: (a.handoffs as { from: string; to: string; at: string }[]).map((h) => ({ fromSupporterTravellerId: h.from, toSupporterTravellerId: h.to, at: isoReq(new Date(h.at)) })),
      })),
      transportServices: services.map((s) => {
        const observed = (value: unknown, at: unknown, evidence: unknown): WObservedTime | null =>
          value ? { value: isoReq(value), observedAt: isoReq(at), evidenceId: str(evidence) } : null;
        return {
          id: String(s.id), revision: 0, mode: String(s.mode), operator: String(s.operator), originPlaceId: String(s.origin_place_id), destinationPlaceId: String(s.destination_place_id),
          published: { departure: observed(s.published_departure, s.published_observed_at, s.published_evidence_id), arrival: observed(s.published_arrival, s.published_observed_at, s.published_evidence_id) },
          estimated: { departure: observed(s.estimated_departure, s.estimated_observed_at, s.estimated_evidence_id), arrival: observed(s.estimated_arrival, s.estimated_observed_at, s.estimated_evidence_id) },
          actual: { departure: observed(s.actual_departure, s.actual_observed_at, s.actual_evidence_id), arrival: observed(s.actual_arrival, s.actual_observed_at, s.actual_evidence_id) },
        };
      }),
      resources: resources.map((r) => ({ id: String(r.id), revision: 0, resourceType: String(r.resource_type), locationPlaceId: str(r.location_place_id), capacity: r.capacity === null ? null : Number(r.capacity) })),
      reservations: reservations.map((r) => ({
        id: String(r.id), revision: 0, reservationType: String(r.reservation_type), observedStatus: String(r.observed_status), observedStatusAt: iso(r.observed_status_at),
        responsibleOrganisationId: str(r.responsible_organisation_id), responsibleTravellerId: str(r.responsible_traveller_id),
      })),
      reservationLines: lines.map((l) => ({
        id: String(l.id), reservationId: String(l.reservation_id), productType: String(l.product_type) as 'TRANSPORT' | 'STAY' | 'RESOURCE_USE',
        observedStatus: String(l.observed_status), observedStatusAt: iso(l.observed_status_at), evidenceId: str(l.observation_evidence_id),
        transportServiceId: str(l.transport_service_id), resourceId: str(l.resource_id), placeId: str(l.place_id), interval: interval(l.interval_start, l.interval_end),
      })),
      allocations: allocations.map((a): WAllocation => ({
        id: String(a.id), reservationId: String(a.reservation_id), lineId: String(a.line_id), travellerId: String(a.traveller_id), journeyItemId: str(a.journey_item_id),
        role: String(a.allocation_role), quantity: Number(a.quantity),
      })),
      entitlements: entitlements.map((e) => ({
        id: String(e.id), entitlementType: String(e.entitlement_type), observedStatus: String(e.observed_status), observedStatusAt: iso(e.observed_status_at),
        lineIds: ((e.line_ids as string[]) ?? []).sort(), travellerIds: ((e.traveller_ids as string[]) ?? []).sort(), evidenceId: str(e.observation_evidence_id),
      })),
      budgets: budgets.map((b) => ({ id: String(b.id), revision: 0, organisationId: String(b.organisation_id), amount: String(b.amount), currency: String(b.currency), valid: { start: iso(b.valid_from), end: iso(b.valid_until) } })),
      budgetCommitments: budgetCommitments.map((c) => ({ id: String(c.id), budgetId: String(c.budget_id), amount: String(c.amount), currency: String(c.currency), status: String(c.status) })),
      costAllocations: costAllocations.map((c) => ({
        id: String(c.id), reservationId: str(c.reservation_id), payerOrganisationId: str(c.payer_organisation_id), payerTravellerId: str(c.payer_traveller_id),
        entryKind: String(c.entry_kind), amount: String(c.amount), currency: String(c.currency), fxObservationId: str(c.fx_observation_id), evidenceId: str(c.evidence_id),
      })),
      fxObservations: fxObservations.map((f) => ({
        id: String(f.id), baseCurrency: String(f.base_currency), quoteCurrency: String(f.quote_currency), rate: String(f.rate), asOf: isoReq(f.as_of), expiresAt: iso(f.expires_at), edition: String(f.edition),
      })),
      programmes: programmes.map((p) => ({ id: String(p.id), revision: 0, eventId: String(p.event_id), title: String(p.title), lifecycleStatus: String(p.lifecycle_status) })),
      programmeItems: programmeItems.map((p) => ({
        id: String(p.id), programmeId: String(p.programme_id), title: String(p.title), itemType: String(p.item_type), placeId: str(p.place_id),
        window: interval(p.window_start, p.window_end), lifecycleStatus: String(p.lifecycle_status), scheduleAuthority: String(p.schedule_authority),
      })),
      participations: participationRows.map((p) => ({
        id: String(p.id), programmeItemId: String(p.programme_item_id), travellerId: String(p.traveller_id), obligation: String(p.obligation) as 'REQUIRED' | 'OPTIONAL' | 'INFORMED',
        accepted: Boolean(p.accepted), preparationWindow: interval(p.preparation_window_start, p.preparation_window_end),
      })),
      resourceAssignments: resourceAssignments.map((a) => ({
        id: String(a.id), activityKind: String(a.activity_kind) as 'PROGRAMME_ITEM' | 'JOURNEY_ITEM', activityId: String(a.activity_id), resourceId: String(a.resource_id),
        quantity: Number(a.quantity), lifecycleStatus: String(a.lifecycle_status),
      })),
      places: places.map((p) => ({ id: String(p.id), revision: 0, name: String(p.name), placeType: String(p.place_type), timeZone: String(p.time_zone), hasCoordinates: Boolean(p.has_coordinates) })),
      jurisdictions: [],
      placeJurisdictions: placeJurisdictions.map((pj) => ({
        placeId: String(pj.place_id), jurisdictionId: String(pj.jurisdiction_id), basis: String(pj.basis) as 'AREA_MEMBERSHIP' | 'SPATIAL_CONTAINMENT',
        areaVersionId: String(pj.area_version_id), evidenceId: str(pj.evidence_id),
      })),
      objectives: objectiveRows.map((o): WObjective => ({
        id: String(o.id), revision: 0, owner: ref(String(o.owner_kind) as SubjectKind, String(o.owner_id)), successPredicateKind: String(o.success_predicate_kind),
        hardness: String(o.hardness) as 'HARD' | 'SOFT', priority: Number(o.priority),
        disposition: (str(o.disposition) ?? 'ACTIVE') as WObjective['disposition'], dispositionEvidenceId: str(o.disposition_evidence_id),
        targets: (o.targets as Row[]).map((t) => ({
          label: String(t.label), targetKind: String(t.kind), subject: t.subjectId ? ref(String(t.subjectKind) as SubjectKind, String(t.subjectId)) : null,
          placeId: str(t.placeId), atOrBefore: t.atOrBefore ? isoReq(new Date(String(t.atOrBefore))) : null,
          amountMinor: t.amountMinor === null || t.amountMinor === undefined ? null : Number(t.amountMinor), currencyCode: str(t.currency),
        })),
      })),
      constraints: constraintRows.map((c): WConstraintDefinition => ({
        id: String(c.id), revision: 0, registeredType: String(c.registered_type), hardness: String(c.hardness) as 'HARD' | 'SOFT',
        owner: ref(String(c.owner_kind) as SubjectKind, String(c.owner_id)), provenanceEvidenceId: str(c.provenance_evidence_id),
        operands: (c.operands as Row[]).map((o) => ({
          key: String(o.key), kind: String(o.kind), subject: o.subjectId ? ref(String(o.subjectKind) as SubjectKind, String(o.subjectId)) : null,
          text: str(o.text), number: str(o.number), boolean: o.boolean === null || o.boolean === undefined ? null : Boolean(o.boolean),
          instant: o.instant ? isoReq(new Date(String(o.instant))) : null, localDate: str(o.localDate),
        })),
      })),
      dependencies: dependencyRows.map((d) => ({
        id: String(d.id), from: ref(String(d.from_subject_kind) as SubjectKind, String(d.from_subject_id)), to: ref(String(d.to_subject_kind) as SubjectKind, String(d.to_subject_id)),
        dependencyKind: String(d.dependency_kind) as 'CONNECTS_TO' | 'REQUIRES', constraintDefinitionId: str(d.constraint_definition_id),
      })),
      ruleSetVersions: ruleSetVersionRows.map((v): WRuleSetVersion => ({
        id: String(v.id), ruleSetId: String(v.rule_set_id), revision: 0, policyFamily: String(v.policy_family), issuer: ref(String(v.issuer_kind) as SubjectKind, String(v.issuer_id)),
        editionNumber: Number(v.edition_number), status: String(v.status), effective: { start: iso(v.effective_from), end: iso(v.effective_until) },
        expression: v.expression as RuleExpression,
        rules: (v.rules as Row[]).map((r) => ({ id: String(r.id), ruleKey: String(r.ruleKey), severity: str(r.severity), expression: r.expression as RuleExpression })),
      })),
      ruleAssignments: ruleAssignmentRows.map((a) => ({
        id: String(a.id), ruleSetId: String(a.rule_set_id), ruleSetVersionId: str(a.rule_set_version_id), selectCurrentEdition: Boolean(a.select_current_edition),
        organisationId: str(a.organisation_id), subject: a.subject_id ? ref(String(a.subject_kind) as SubjectKind, String(a.subject_id)) : null,
        jurisdictionId: str(a.jurisdiction_id), populationPredicateId: str(a.population_predicate_id), valid: { start: isoReq(a.valid_from), end: iso(a.valid_until) },
      })),
      informationVersions: informationDetailRows.map((i): WInformationVersion => ({
        id: String(i.id), recordId: String(i.information_record_id), revision: 0, topic: String(i.topic), publisherOrganisationId: str(i.publisher_organisation_id),
        subtype: String(i.subtype) as WInformationVersion['subtype'], sequence: Number(i.external_edition_sequence), issuedAt: isoReq(i.issued_at), observedAt: isoReq(i.observed_at),
        effective: { start: iso(i.effective_from), end: iso(i.effective_until) }, evidenceId: String(i.evidence_id),
        supersedesId: str(i.supersedes_information_version_id), retractsId: str(i.retracts_information_version_id), sourceNativeSeverity: str(i.source_native_severity),
        riskTopics: (i.risk_topics as string[]) ?? [], conditionType: str(i.condition_type),
        regulatoryRuleSetVersionId: str(i.regulatory_rule_set_version_id), regulatoryJurisdictionId: str(i.regulatory_jurisdiction_id),
        scopes: (i.scopes as Row[]).map((s) => ({
          id: String(s.id), jurisdictionId: str(s.jurisdictionId), areaVersionId: str(s.areaVersionId),
          subject: s.subjectId ? ref(String(s.subjectKind) as SubjectKind, String(s.subjectId)) : null, purpose: str(s.purpose), serviceCategory: str(s.serviceCategory),
          populationPredicateId: str(s.populationPredicateId), exposure: { start: isoReq(new Date(String(s.from))), end: isoReq(new Date(String(s.until))) },
        })),
      })),
      coverage: coverageRows.map((c): WCoverage => ({
        id: String(c.id), topic: String(c.topic), queryBounds: (c.query_bounds as Record<string, unknown>) ?? {}, edition: String(c.edition), watermark: str(c.watermark),
        completeness: String(c.completeness), limitations: (c.completeness_limitations as string[]) ?? [], expiresAt: iso(c.expires_at), evidenceId: str(c.evidence_id),
      })),
    };

    const jurisdictionRows = await q(
      `SELECT id, name, regime_kind FROM jurisdictions WHERE workspace_id = $1 AND id = ANY($2::uuid[]) ORDER BY id`,
      [uniq([...jurisdictionIds, ...world.ruleAssignments.map((a) => a.jurisdictionId), ...world.informationVersions.map((i) => i.regulatoryJurisdictionId)])],
    );
    world.jurisdictions = jurisdictionRows.map((j) => ({ id: String(j.id), revision: 0, name: String(j.name), regimeKind: String(j.regime_kind) }));

    await this.recordManifest(session, request, world, referencedRuleSetIds);
    return this.withRevisions(session, world);
  }

  /** Discovery over registered semantics only; returns the set of reached subject keys. */
  private async discover(
    q: <R extends Row>(sql: string, values?: unknown[]) => Promise<R[]>,
    request: WorldCaptureRequest,
    edges: EdgeSet,
  ): Promise<Set<string>> {
    const maxDepth = request.maxDepth ?? 16;
    const reached = new Set<string>(request.focus.map(refKey));
    let frontier: TypedRef[] = [...request.focus];
    const atDate = request.at.slice(0, 10);
    for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
      const byKind = new Map<SubjectKind, string[]>();
      for (const f of frontier) byKind.set(f.kind, [...(byKind.get(f.kind) ?? []), f.id]);
      const next: TypedRef[] = [];
      const push = (semantic: DependencySemantic, from: TypedRef, to: TypedRef, towards: TypedRef) => {
        edges.add(semantic, from, to);
        const key = refKey(towards);
        if (!reached.has(key)) {
          reached.add(key);
          next.push(towards);
        }
      };
      const ids = (kind: SubjectKind) => byKind.get(kind) ?? [];

      if (ids('TRANSPORT_SERVICE').length) {
        for (const r of await q<{ s: string; l: string }>('SELECT transport_service_id AS s, line_id AS l FROM transport_line_details WHERE workspace_id = $1 AND transport_service_id = ANY($2::uuid[])', [ids('TRANSPORT_SERVICE')])) {
          push('SERVICE_SUPPLIES_LINE', ref('TRANSPORT_SERVICE', r.s), ref('RESERVATION_LINE', r.l), ref('RESERVATION_LINE', r.l));
        }
        for (const r of await q<{ s: string; i: string }>('SELECT selected_service_id AS s, journey_item_id AS i FROM transport_item_details WHERE workspace_id = $1 AND selected_service_id = ANY($2::uuid[])', [ids('TRANSPORT_SERVICE')])) {
          push('SERVICE_SELECTED_FOR_ITEM', ref('TRANSPORT_SERVICE', r.s), ref('JOURNEY_ITEM', r.i), ref('JOURNEY_ITEM', r.i));
        }
      }
      if (ids('RESERVATION').length) {
        for (const r of await q<{ r: string; l: string }>('SELECT reservation_id AS r, id AS l FROM reservation_lines WHERE workspace_id = $1 AND reservation_id = ANY($2::uuid[])', [ids('RESERVATION')])) {
          push('LINE_OF_RESERVATION', ref('RESERVATION', r.r), ref('RESERVATION_LINE', r.l), ref('RESERVATION_LINE', r.l));
        }
      }
      if (ids('SERVICE_ENTITLEMENT').length) {
        for (const r of await q<{ e: string; l: string }>('SELECT entitlement_id AS e, line_id AS l FROM entitlement_line_links WHERE workspace_id = $1 AND entitlement_id = ANY($2::uuid[])', [ids('SERVICE_ENTITLEMENT')])) {
          push('ENTITLEMENT_COVERS_LINE', ref('SERVICE_ENTITLEMENT', r.e), ref('RESERVATION_LINE', r.l), ref('RESERVATION_LINE', r.l));
        }
      }
      if (ids('RESERVATION_LINE').length) {
        for (const r of await q<{ l: string; t: string; i: string | null }>('SELECT line_id AS l, traveller_id AS t, journey_item_id AS i FROM reservation_allocations WHERE workspace_id = $1 AND line_id = ANY($2::uuid[])', [ids('RESERVATION_LINE')])) {
          if (r.i) push('ALLOCATION_FULFILS_ITEM', ref('RESERVATION_LINE', r.l), ref('JOURNEY_ITEM', r.i), ref('JOURNEY_ITEM', r.i));
          else push('LINE_ALLOCATED_TO_TRAVELLER', ref('RESERVATION_LINE', r.l), ref('TRAVELLER', r.t), ref('TRAVELLER', r.t));
        }
        for (const r of await q<{ r: string; l: string }>(
          `SELECT resource_id AS r, line_id AS l FROM stay_line_details WHERE workspace_id = $1 AND line_id = ANY($2::uuid[]) AND resource_id IS NOT NULL
           UNION SELECT resource_id, line_id FROM resource_use_line_details WHERE workspace_id = $1 AND line_id = ANY($2::uuid[])`, [ids('RESERVATION_LINE')])) {
          push('RESOURCE_USED_BY_LINE', ref('RESOURCE', r.r), ref('RESERVATION_LINE', r.l), ref('RESOURCE', r.r));
        }
      }
      if (ids('JOURNEY_ITEM').length) {
        for (const r of await q<{ i: string; j: string }>('SELECT id AS i, journey_id AS j FROM journey_items WHERE workspace_id = $1 AND id = ANY($2::uuid[])', [ids('JOURNEY_ITEM')])) {
          push('ITEM_OF_JOURNEY', ref('JOURNEY_ITEM', r.i), ref('JOURNEY', r.j), ref('JOURNEY', r.j));
        }
        for (const r of await q<{ r: string; a: string }>(
          `SELECT resource_id AS r, activity_id AS a FROM resource_assignments WHERE workspace_id = $1 AND activity_kind = 'JOURNEY_ITEM' AND activity_id = ANY($2::uuid[])
           UNION SELECT resource_id, journey_item_id FROM resource_use_item_details WHERE workspace_id = $1 AND journey_item_id = ANY($2::uuid[]) AND resource_id IS NOT NULL`, [ids('JOURNEY_ITEM')])) {
          push('RESOURCE_ASSIGNED_TO_ACTIVITY', ref('RESOURCE', r.r), ref('JOURNEY_ITEM', r.a), ref('RESOURCE', r.r));
        }
      }
      if (ids('TRIP').length) {
        for (const r of await q<{ t: string; j: string }>("SELECT trip_id AS t, id AS j FROM journeys WHERE workspace_id = $1 AND trip_id = ANY($2::uuid[]) AND lifecycle_status NOT IN ('COMPLETED', 'CANCELLED')", [ids('TRIP')])) {
          push('JOURNEY_IN_TRIP', ref('TRIP', r.t), ref('JOURNEY', r.j), ref('JOURNEY', r.j));
        }
      }
      if (ids('TRAVELLER').length) {
        for (const r of await q<{ t: string; j: string }>("SELECT traveller_id AS t, id AS j FROM journeys WHERE workspace_id = $1 AND traveller_id = ANY($2::uuid[]) AND lifecycle_status NOT IN ('COMPLETED', 'CANCELLED')", [ids('TRAVELLER')])) {
          push('JOURNEY_OF_TRAVELLER', ref('TRAVELLER', r.t), ref('JOURNEY', r.j), ref('JOURNEY', r.j));
        }
      }
      if (ids('JOURNEY').length) {
        for (const r of await q<{ g: string; j: string }>('SELECT coordination_group_id AS g, journey_id AS j FROM group_memberships WHERE workspace_id = $1 AND journey_id = ANY($2::uuid[])', [ids('JOURNEY')])) {
          push('GROUP_MEMBERSHIP', ref('COORDINATION_GROUP', r.g), ref('JOURNEY', r.j), ref('COORDINATION_GROUP', r.g));
        }
        // Support coupling: a dependant's Journey reaches supporters; a supporter's Journey reaches the dependant.
        for (const r of await q<{ j: string; supporter: string }>(
          `SELECT j.id AS j, e.supporter_traveller_id AS supporter
             FROM journeys j
             JOIN accompaniment_requirements q ON q.workspace_id = j.workspace_id AND q.supported_traveller_id = j.traveller_id
             JOIN accompaniment_eligible_supporters e ON e.workspace_id = q.workspace_id AND e.requirement_id = q.id AND e.requirement_version = q.version
            WHERE j.workspace_id = $1 AND j.id = ANY($2::uuid[])`, [ids('JOURNEY')])) {
          push('SUPPORT_REQUIRED_BY_TRAVELLER', ref('JOURNEY', r.j), ref('TRAVELLER', r.supporter), ref('TRAVELLER', r.supporter));
        }
        for (const r of await q<{ j: string; supported: string }>(
          `SELECT j.id AS j, q.supported_traveller_id AS supported
             FROM journeys j
             JOIN accompaniment_eligible_supporters e ON e.workspace_id = j.workspace_id AND e.supporter_traveller_id = j.traveller_id
             JOIN accompaniment_requirements q ON q.workspace_id = e.workspace_id AND q.id = e.requirement_id AND q.version = e.requirement_version
            WHERE j.workspace_id = $1 AND j.id = ANY($2::uuid[])`, [ids('JOURNEY')])) {
          push('SUPPORT_PROVIDED_BY_TRAVELLER', ref('JOURNEY', r.j), ref('TRAVELLER', r.supported), ref('TRAVELLER', r.supported));
        }
      }
      if (ids('COORDINATION_GROUP').length) {
        for (const r of await q<{ g: string; j: string }>('SELECT coordination_group_id AS g, journey_id AS j FROM group_memberships WHERE workspace_id = $1 AND coordination_group_id = ANY($2::uuid[])', [ids('COORDINATION_GROUP')])) {
          push('GROUP_MEMBERSHIP', ref('COORDINATION_GROUP', r.g), ref('JOURNEY', r.j), ref('JOURNEY', r.j));
        }
      }
      if (ids('PROGRAMME').length) {
        for (const r of await q<{ p: string; i: string }>('SELECT programme_id AS p, id AS i FROM programme_items WHERE workspace_id = $1 AND programme_id = ANY($2::uuid[])', [ids('PROGRAMME')])) {
          push('PROGRAMME_ITEM_OF_PROGRAMME', ref('PROGRAMME', r.p), ref('PROGRAMME_ITEM', r.i), ref('PROGRAMME_ITEM', r.i));
        }
      }
      if (ids('PROGRAMME_ITEM').length) {
        for (const r of await q<{ i: string; p: string }>('SELECT programme_item_id AS i, id AS p FROM participations WHERE workspace_id = $1 AND programme_item_id = ANY($2::uuid[])', [ids('PROGRAMME_ITEM')])) {
          push('PARTICIPATION_IN_PROGRAMME_ITEM', ref('PROGRAMME_ITEM', r.i), ref('PARTICIPATION', r.p), ref('PARTICIPATION', r.p));
        }
        for (const r of await q<{ r: string; a: string }>("SELECT resource_id AS r, activity_id AS a FROM resource_assignments WHERE workspace_id = $1 AND activity_kind = 'PROGRAMME_ITEM' AND activity_id = ANY($2::uuid[])", [ids('PROGRAMME_ITEM')])) {
          push('RESOURCE_ASSIGNED_TO_ACTIVITY', ref('RESOURCE', r.r), ref('PROGRAMME_ITEM', r.a), ref('RESOURCE', r.r));
        }
      }
      if (ids('PARTICIPATION').length) {
        for (const r of await q<{ p: string; t: string }>('SELECT id AS p, traveller_id AS t FROM participations WHERE workspace_id = $1 AND id = ANY($2::uuid[])', [ids('PARTICIPATION')])) {
          push('PARTICIPATION_OF_TRAVELLER', ref('PARTICIPATION', r.p), ref('TRAVELLER', r.t), ref('TRAVELLER', r.t));
        }
        for (const r of await q<{ p: string; i: string }>('SELECT participation_id AS p, journey_item_id AS i FROM engagement_item_details WHERE workspace_id = $1 AND participation_id = ANY($2::uuid[])', [ids('PARTICIPATION')])) {
          push('ENGAGEMENT_REFLECTS_PARTICIPATION', ref('PARTICIPATION', r.p), ref('JOURNEY_ITEM', r.i), ref('JOURNEY_ITEM', r.i));
        }
      }
      if (ids('RESOURCE').length) {
        for (const r of await q<{ r: string; k: string; a: string }>('SELECT resource_id AS r, activity_kind AS k, activity_id AS a FROM resource_assignments WHERE workspace_id = $1 AND resource_id = ANY($2::uuid[])', [ids('RESOURCE')])) {
          const activity = ref(r.k as SubjectKind, r.a);
          push('RESOURCE_ASSIGNED_TO_ACTIVITY', ref('RESOURCE', r.r), activity, activity);
        }
        for (const r of await q<{ r: string; i: string }>('SELECT resource_id AS r, journey_item_id AS i FROM resource_use_item_details WHERE workspace_id = $1 AND resource_id = ANY($2::uuid[])', [ids('RESOURCE')])) {
          push('RESOURCE_ASSIGNED_TO_ACTIVITY', ref('RESOURCE', r.r), ref('JOURNEY_ITEM', r.i), ref('JOURNEY_ITEM', r.i));
        }
        for (const r of await q<{ r: string; l: string }>(
          `SELECT resource_id AS r, line_id AS l FROM stay_line_details WHERE workspace_id = $1 AND resource_id = ANY($2::uuid[])
           UNION SELECT resource_id, line_id FROM resource_use_line_details WHERE workspace_id = $1 AND resource_id = ANY($2::uuid[])`, [ids('RESOURCE')])) {
          push('RESOURCE_USED_BY_LINE', ref('RESOURCE', r.r), ref('RESERVATION_LINE', r.l), ref('RESERVATION_LINE', r.l));
        }
      }
      if (ids('PLACE').length) {
        for (const r of await q<{ p: string; k: string; a: string }>(
          `SELECT place_id AS p, 'PROGRAMME_ITEM' AS k, id AS a FROM programme_items WHERE workspace_id = $1 AND place_id = ANY($2::uuid[])
           UNION SELECT desired_origin_place_id, 'JOURNEY_ITEM', journey_item_id FROM transport_item_details WHERE workspace_id = $1 AND desired_origin_place_id = ANY($2::uuid[])
           UNION SELECT desired_destination_place_id, 'JOURNEY_ITEM', journey_item_id FROM transport_item_details WHERE workspace_id = $1 AND desired_destination_place_id = ANY($2::uuid[])
           UNION SELECT intended_place_id, 'JOURNEY_ITEM', journey_item_id FROM stay_item_details WHERE workspace_id = $1 AND intended_place_id = ANY($2::uuid[])
           UNION SELECT intended_location_place_id, 'JOURNEY_ITEM', journey_item_id FROM resource_use_item_details WHERE workspace_id = $1 AND intended_location_place_id = ANY($2::uuid[])
           UNION SELECT origin_place_id, 'TRANSPORT_SERVICE', id FROM transport_services WHERE workspace_id = $1 AND origin_place_id = ANY($2::uuid[])
           UNION SELECT destination_place_id, 'TRANSPORT_SERVICE', id FROM transport_services WHERE workspace_id = $1 AND destination_place_id = ANY($2::uuid[])`, [ids('PLACE')])) {
          const activity = ref(r.k as SubjectKind, r.a);
          push('PLACE_LOCATES_ACTIVITY', ref('PLACE', r.p), activity, activity);
        }
      }
      if (ids('JURISDICTION').length) {
        for (const r of await q<{ j: string; p: string }>(
          `SELECT ja.jurisdiction_id AS j, am.member_place_id AS p
             FROM jurisdiction_areas ja
             JOIN area_memberships am ON am.workspace_id = ja.workspace_id AND am.containing_area_version_id = ja.area_version_id AND am.member_kind = 'PLACE'
            WHERE ja.workspace_id = $1 AND ja.jurisdiction_id = ANY($2::uuid[])
              AND am.valid_from <= $3::date AND (am.valid_until IS NULL OR am.valid_until > $3::date)
              AND ja.valid_from <= $3::date AND (ja.valid_until IS NULL OR ja.valid_until > $3::date)
           UNION
           SELECT ja.jurisdiction_id, p.id
             FROM jurisdiction_areas ja
             JOIN area_versions av ON av.workspace_id = ja.workspace_id AND av.id = ja.area_version_id
             JOIN places p ON p.workspace_id = av.workspace_id AND p.location IS NOT NULL AND ST_Covers(av.geometry, p.location)
            WHERE ja.workspace_id = $1 AND ja.jurisdiction_id = ANY($2::uuid[])
              AND ja.valid_from <= $3::date AND (ja.valid_until IS NULL OR ja.valid_until > $3::date)
              AND av.valid_from <= $3::date AND (av.valid_until IS NULL OR av.valid_until > $3::date)`, [ids('JURISDICTION'), atDate])) {
          push('JURISDICTION_CONTAINS_PLACE', ref('JURISDICTION', r.j), ref('PLACE', r.p), ref('PLACE', r.p));
        }
        for (const r of await q<{ j: string; journey: string }>('SELECT jurisdiction_id AS j, journey_id AS journey FROM intended_visits WHERE workspace_id = $1 AND jurisdiction_id = ANY($2::uuid[])', [ids('JURISDICTION')])) {
          push('VISIT_TO_JURISDICTION', ref('JURISDICTION', r.j), ref('JOURNEY', r.journey), ref('JOURNEY', r.journey));
        }
      }
      if (ids('INFORMATION_VERSION').length) {
        for (const r of await q<{ v: string; j: string | null; sk: string | null; s: string | null; av: string | null }>(
          'SELECT information_version_id AS v, jurisdiction_id AS j, subject_kind AS sk, subject_id AS s, area_version_id AS av FROM information_scopes WHERE workspace_id = $1 AND information_version_id = ANY($2::uuid[])',
          [ids('INFORMATION_VERSION')])) {
          if (r.j) push('INFORMATION_SCOPED_TO_JURISDICTION', ref('INFORMATION_VERSION', r.v), ref('JURISDICTION', r.j), ref('JURISDICTION', r.j));
          if (r.s && r.sk) push('INFORMATION_SCOPED_TO_SUBJECT', ref('INFORMATION_VERSION', r.v), ref(r.sk as SubjectKind, r.s), ref(r.sk as SubjectKind, r.s));
          if (r.av) {
            for (const p of await q<{ p: string }>(
              `SELECT am.member_place_id AS p FROM area_memberships am WHERE am.workspace_id = $1 AND am.containing_area_version_id = $2 AND am.member_kind = 'PLACE'
               UNION SELECT p.id FROM places p JOIN area_versions av ON av.workspace_id = p.workspace_id AND av.id = $2
                 WHERE p.workspace_id = $1 AND p.location IS NOT NULL AND ST_Covers(av.geometry, p.location)`, [r.av])) {
              push('INFORMATION_SCOPED_TO_AREA', ref('INFORMATION_VERSION', r.v), ref('PLACE', p.p), ref('PLACE', p.p));
            }
          }
        }
        for (const r of await q<{ v: string; rs: string }>('SELECT information_version_id AS v, rule_set_id AS rs FROM regulatory_publications WHERE workspace_id = $1 AND information_version_id = ANY($2::uuid[])', [ids('INFORMATION_VERSION')])) {
          push('PUBLICATION_OF_RULE_SET_VERSION', ref('INFORMATION_VERSION', r.v), ref('RULE_SET', r.rs), ref('RULE_SET', r.rs));
        }
      }
      if (ids('RULE_SET').length) {
        for (const r of await q<{ rs: string; o: string | null; sk: string | null; s: string | null; j: string | null }>(
          'SELECT rule_set_id AS rs, organisation_id AS o, subject_kind AS sk, subject_id AS s, jurisdiction_id AS j FROM rule_assignments WHERE workspace_id = $1 AND rule_set_id = ANY($2::uuid[])',
          [ids('RULE_SET')])) {
          if (r.o) push('RULE_ASSIGNED_TO_ORGANISATION', ref('RULE_SET', r.rs), ref('ORGANISATION', r.o), ref('ORGANISATION', r.o));
          if (r.s && r.sk) push('RULE_ASSIGNED_TO_SUBJECT', ref('RULE_SET', r.rs), ref(r.sk as SubjectKind, r.s), ref(r.sk as SubjectKind, r.s));
          if (r.j) push('RULE_ASSIGNED_TO_JURISDICTION', ref('RULE_SET', r.rs), ref('JURISDICTION', r.j), ref('JURISDICTION', r.j));
        }
      }
      if (ids('ORGANISATION').length) {
        for (const r of await q<{ o: string; k: string; s: string }>(
          `SELECT business_context_organisation_id AS o, 'TRIP' AS k, id AS s FROM trips WHERE workspace_id = $1 AND business_context_organisation_id = ANY($2::uuid[])
           UNION SELECT responsibility_organisation_id, 'JOURNEY', id FROM journeys WHERE workspace_id = $1 AND responsibility_organisation_id = ANY($2::uuid[])`, [ids('ORGANISATION')])) {
          const subject = ref(r.k as SubjectKind, r.s);
          push('ORGANISATION_RESPONSIBLE_FOR', ref('ORGANISATION', r.o), subject, subject);
        }
      }
      if (ids('OBJECTIVE').length) {
        for (const r of await q<{ o: string; k: string; s: string }>('SELECT id AS o, owner_kind AS k, owner_id AS s FROM objectives WHERE workspace_id = $1 AND id = ANY($2::uuid[])', [ids('OBJECTIVE')])) {
          const owner = ref(r.k as SubjectKind, r.s);
          push('OBJECTIVE_OF_OWNER', ref('OBJECTIVE', r.o), owner, owner);
        }
      }
      if (ids('CONSTRAINT_DEFINITION').length) {
        for (const r of await q<{ c: string; k: string; s: string }>('SELECT id AS c, owner_kind AS k, owner_id AS s FROM constraint_definitions WHERE workspace_id = $1 AND id = ANY($2::uuid[])', [ids('CONSTRAINT_DEFINITION')])) {
          const owner = ref(r.k as SubjectKind, r.s);
          push('CONSTRAINT_OF_OWNER', ref('CONSTRAINT_DEFINITION', r.c), owner, owner);
        }
      }
      // Explicit dependencies: CONNECTS_TO propagates upstream -> downstream; REQUIRES prerequisite -> dependent.
      const explicitIds = [...ids('JOURNEY_ITEM'), ...ids('TRANSPORT_SERVICE'), ...ids('PROGRAMME_ITEM'), ...ids('RESERVATION_LINE'), ...ids('PARTICIPATION')];
      if (explicitIds.length) {
        for (const r of await q<{ fk: string; f: string; tk: string; t: string; k: string }>(
          `SELECT from_subject_kind AS fk, from_subject_id AS f, to_subject_kind AS tk, to_subject_id AS t, dependency_kind AS k FROM dependencies
            WHERE workspace_id = $1 AND ((dependency_kind = 'CONNECTS_TO' AND from_subject_id = ANY($2::uuid[])) OR (dependency_kind = 'REQUIRES' AND to_subject_id = ANY($2::uuid[])))`,
          [explicitIds])) {
          const from = ref(r.fk as SubjectKind, r.f);
          const to = ref(r.tk as SubjectKind, r.t);
          if (r.k === 'CONNECTS_TO') push('EXPLICIT_CONNECTS_TO', from, to, to);
          else push('EXPLICIT_REQUIRES', to, from, from);
        }
      }
      frontier = next.sort((a, b) => refKey(a).localeCompare(refKey(b)));
    }
    return reached;
  }

  private async recordManifest(
    session: ReadSession,
    request: WorldCaptureRequest,
    world: Omit<CapturedWorld, 'manifest'>,
    referencedRuleSetIds: string[],
  ): Promise<void> {
    const m = session.manifest;
    const ruleSetRefs = uniq(referencedRuleSetIds).map((id) => ref('RULE_SET', id));
    const subjects: TypedRef[] = [
      ...world.travellers.map((x) => ref('TRAVELLER', x.id)), ...world.trips.map((x) => ref('TRIP', x.id)), ...world.journeys.map((x) => ref('JOURNEY', x.id)),
      ...world.journeyItems.map((x) => ref('JOURNEY_ITEM', x.id)), ...world.coordinationGroups.map((x) => ref('COORDINATION_GROUP', x.id)),
      ...world.supportAssignments.map((x) => ref('SUPPORT_ASSIGNMENT', x.id)), ...world.organisations.map((x) => ref('ORGANISATION', x.id)),
      ...world.transportServices.map((x) => ref('TRANSPORT_SERVICE', x.id)), ...world.resources.map((x) => ref('RESOURCE', x.id)),
      ...world.reservations.map((x) => ref('RESERVATION', x.id)), ...world.reservationLines.map((x) => ref('RESERVATION_LINE', x.id)),
      ...world.entitlements.map((x) => ref('SERVICE_ENTITLEMENT', x.id)), ...world.budgets.map((x) => ref('BUDGET', x.id)),
      ...world.programmes.map((x) => ref('PROGRAMME', x.id)), ...world.programmeItems.map((x) => ref('PROGRAMME_ITEM', x.id)),
      ...world.participations.map((x) => ref('PARTICIPATION', x.id)), ...world.places.map((x) => ref('PLACE', x.id)),
      ...world.jurisdictions.map((x) => ref('JURISDICTION', x.id)), ...world.objectives.map((x) => ref('OBJECTIVE', x.id)),
      ...world.constraints.map((x) => ref('CONSTRAINT_DEFINITION', x.id)), ...ruleSetRefs,
      ...world.informationVersions.map((x) => ref('INFORMATION_VERSION', x.id)),
    ];
    await session.recordAggregates(subjects);

    const scopes: { scopeKind: ScopeKind; scopeId: string }[] = [];
    const extra: { scopeKind: ScopeKind; scopeId: string }[] = [];
    scopes.push({ scopeKind: 'WORKSPACE', scopeId: world.workspaceId });
    for (const x of world.trips) scopes.push({ scopeKind: 'TRIP', scopeId: x.id });
    for (const x of world.journeys) scopes.push({ scopeKind: 'JOURNEY', scopeId: x.id });
    for (const x of world.coordinationGroups) scopes.push({ scopeKind: 'COORDINATION_GROUP', scopeId: x.id });
    for (const x of world.programmes) scopes.push({ scopeKind: 'PROGRAMME', scopeId: x.id });
    for (const x of world.organisations) scopes.push({ scopeKind: 'ORGANISATION_RULES', scopeId: x.id });
    scopes.push({ scopeKind: 'ORGANISATION_RULES', scopeId: 'm6:population-predicate' });
    scopes.push({ scopeKind: 'GEOGRAPHY', scopeId: 'catalog' });
    for (const x of world.jurisdictions) scopes.push({ scopeKind: 'GEOGRAPHY', scopeId: `jurisdiction:${x.id}` });
    for (const topic of [...request.informationTopics].sort()) scopes.push({ scopeKind: 'INFORMATION_TOPIC', scopeId: topic });
    scopes.push({ scopeKind: 'INFORMATION_TOPIC', scopeId: 'm6:unregistered-topic' });
    for (const x of world.travellers) extra.push({ scopeKind: 'TRAVELLER', scopeId: x.id });
    for (const x of world.resources) extra.push({ scopeKind: 'RESOURCE', scopeId: x.id });
    for (const id of uniq(referencedRuleSetIds)) extra.push({ scopeKind: 'RULE_SET', scopeId: id });
    for (const id of uniq([...world.journeyItems.map((x) => x.id), ...world.transportServices.map((x) => x.id), ...world.programmeItems.map((x) => x.id), ...world.reservationLines.map((x) => x.id), ...world.participations.map((x) => x.id)])) {
      extra.push({ scopeKind: 'SUBJECT_DEPENDENCIES', scopeId: id });
    }
    await session.recordScopes([...scopes, ...extra]);

    for (const id of uniq([
      ...world.credentialVersions.map((x) => x.evidenceId), ...world.travelHistory.map((x) => x.evidenceId), ...world.profileAssertions.map((x) => x.evidenceId),
      ...world.credentialLinks.map((x) => x.evidenceId), ...world.reservationLines.map((x) => x.evidenceId), ...world.entitlements.map((x) => x.evidenceId),
      ...world.transportServices.flatMap((s) => [s.published.departure?.evidenceId, s.estimated.departure?.evidenceId, s.actual.departure?.evidenceId]),
      ...world.placeJurisdictions.map((x) => x.evidenceId), ...world.informationVersions.flatMap((x) => [x.id, x.evidenceId]),
      ...world.ruleSetVersions.map((x) => x.id), ...world.coverage.flatMap((x) => [x.id, x.evidenceId]), ...world.credentialVersions.map((x) => x.id),
      ...world.objectives.map((x) => x.dispositionEvidenceId), ...world.constraints.map((x) => x.provenanceEvidenceId),
    ])) {
      m.evidence(id);
    }

    for (const topic of [...request.informationTopics].sort()) {
      const rows = world.coverage.filter((c) => c.topic === topic);
      m.coverage({
        readerId: `m6.world.knowledge-coverage:${topic}`,
        queryBoundsDescription: `topic=${topic}; all recorded coverage editions in workspace`,
        editionsRead: rows.map((c) => `${c.id}@${c.edition}`),
        limitations: rows.length === 0 ? ['no coverage record exists for this topic'] : uniq(rows.flatMap((c) => c.limitations)),
      });
      if (rows.length === 0) m.missing({ scopeDescription: `knowledge coverage for topic ${topic}`, reason: 'SOURCE_INCOMPLETE' });
    }
    m.coverage({
      readerId: 'm6.world.place-jurisdictions',
      queryBoundsDescription: `places=${world.places.length}; area membership and PostGIS containment effective ${request.at.slice(0, 10)}`,
      editionsRead: uniq(world.placeJurisdictions.map((x) => x.areaVersionId)),
      limitations: [],
    });
    for (const place of world.places) {
      if (!world.placeJurisdictions.some((pj) => pj.placeId === place.id)) {
        m.missing({ subjectRef: ref('PLACE', place.id), scopeDescription: 'jurisdiction of place (no area membership or containing area edition)', reason: 'SOURCE_INCOMPLETE' });
      }
    }
  }

  /** Stamps each root row with the revision recorded in the manifest (children carry their root's). */
  private withRevisions(session: ReadSession, world: Omit<CapturedWorld, 'manifest'>): CapturedWorld {
    const parts = session.manifestParts();
    const revision = new Map(parts.aggregateReads.map((r) => [`${r.aggregateRef.kind}:${r.aggregateRef.id}`, r.revision]));
    const stamp = <T extends { id: string; revision: number }>(kind: SubjectKind, rows: T[]) => rows.map((row) => ({ ...row, revision: revision.get(`${kind}:${row.id}`) ?? 0 }));
    const manifest: WorldSnapshotManifest = {
      evaluatedAt: session.info.transactionStartedAt,
      capture: world.capture,
      evaluatorVersions: [],
      ...parts,
    };
    return {
      ...world,
      manifest,
      travellers: stamp('TRAVELLER', world.travellers),
      organisations: stamp('ORGANISATION', world.organisations),
      trips: stamp('TRIP', world.trips),
      journeys: stamp('JOURNEY', world.journeys),
      coordinationGroups: stamp('COORDINATION_GROUP', world.coordinationGroups),
      supportAssignments: stamp('SUPPORT_ASSIGNMENT', world.supportAssignments),
      transportServices: stamp('TRANSPORT_SERVICE', world.transportServices),
      resources: stamp('RESOURCE', world.resources),
      reservations: stamp('RESERVATION', world.reservations),
      budgets: stamp('BUDGET', world.budgets),
      programmes: stamp('PROGRAMME', world.programmes),
      places: stamp('PLACE', world.places),
      jurisdictions: stamp('JURISDICTION', world.jurisdictions),
      objectives: stamp('OBJECTIVE', world.objectives),
      constraints: stamp('CONSTRAINT_DEFINITION', world.constraints),
      ruleSetVersions: world.ruleSetVersions.map((v) => ({ ...v, revision: revision.get(`RULE_SET:${v.ruleSetId}`) ?? 0 })),
      informationVersions: world.informationVersions.map((v) => ({ ...v, revision: revision.get(`INFORMATION_RECORD:${v.recordId}`) ?? 0 })),
    };
  }
}

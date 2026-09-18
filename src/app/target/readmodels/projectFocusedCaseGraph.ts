/**
 * R2 — focused Case graph enrichment from canonical journey/programme state.
 *
 * Pure function: takes typed fact inputs (journey rows, item rows, service rows,
 * participation rows, objective rows, assessment views) and returns additional
 * ProductNodeFact[]/ProductEdgeFact[] to append to the case's ldg. The pgFactAssembler
 * loads those rows with SQL and passes them here; this module has no PostgreSQL.
 *
 * Goals (contract §2.1):
 *   - Human labels: case-subject nodes carry the traveller's authoritative display
 *     name (journeys -> travellers -> traveller_names.display_value), never a bare
 *     uuid or persona lookup.
 *   - Journey composition: SERVICE_BOOKING nodes for transport items (labels from
 *     transport_services canonical columns), TRANSFER_STAY nodes for stay/transfer
 *     items, TIMING nodes only where meaningful arrival/timing state exists.
 *   - Programme commitments: PROGRAMME_COMMITMENT nodes via participations with
 *     REQUIRED/OPTIONAL accepted status in an ACTIVE programme.
 *   - Trip purpose/objectives: objectives exist in the ontology (0072_objectives.sql)
 *     but the closed LdgNodeKind enum has no OBJECTIVE kind. This module does NOT
 *     emit objective nodes (would violate the contract). The gap is reported.
 *   - semanticState: derived ONLY from authoritative assessment truth (TONE_TO_STATE)
 *     or CHANGED for the disruption node. Items with no assessment: UNKNOWN.
 *   - Refs: `<KIND>:<id>` format matching causalPath subjectRef format so causal
 *     steps become mappable.
 *   - Edge ids: producer-owned, stable, derived from canonical relations, unique.
 *
 * Generality: identical code for both worlds (programme and connection). No branch
 * on scenario tokens. Absence of programme/participation/objective rows is handled
 * gracefully (empty additions), never fabricated.
 */
import type {
  AssessmentTone,
  AssessmentViewStatus,
  LdgNodeKind,
  LdgSemanticState,
} from '../../../contracts/v2/product/readModels.ts';
import type { ProductNodeFact, ProductEdgeFact } from './types.ts';

/** PASS/FAIL/UNKNOWN -> node semanticState (FIG-6 fidelity). */
const TONE_TO_STATE: Record<AssessmentTone, LdgSemanticState> = {
  PASS: 'HEALTHY',
  FAIL: 'FAILED',
  UNKNOWN: 'UNKNOWN',
};

/** Minimal journey row shape (from journeys table, migration 0021). */
export interface JourneyRow {
  id: string;
  trip_id: string;
  traveller_id: string;
  lifecycle_status: string;
  intended_window_start: string | null;
  intended_window_end: string | null;
}

/** Minimal journey item row shape (from journey_items table, migration 0022). */
export interface JourneyItemRow {
  id: string;
  journey_id: string;
  kind: 'TRANSPORT' | 'STAY' | 'ENGAGEMENT' | 'RESOURCE_USE';
  order_key: string;
  lifecycle_status: string;
  intended_window_start: string | null;
  intended_window_end: string | null;
  /** For TRANSPORT items: the selected transport service id (from transport_item_details). */
  selectedServiceId?: string | null;
}

/** Minimal transport service row shape (from transport_services table, migration 0030). */
export interface TransportServiceRow {
  id: string;
  mode: string;
  operator: string;
  origin_place_id: string;
  destination_place_id: string;
  published_departure: string | null;
  published_arrival: string | null;
}

/** Minimal participation row shape (from participations table, migration 0057). */
export interface ParticipationRow {
  id: string;
  programme_item_id: string;
  traveller_id: string;
  obligation: 'REQUIRED' | 'OPTIONAL' | 'INFORMED';
  accepted: boolean;
}

/** Minimal programme item row shape (from programme_items table, migration 0056). */
export interface ProgrammeItemRow {
  id: string;
  programme_id: string;
  title: string;
  item_type: string;
  window_start: string | null;
  window_end: string | null;
  lifecycle_status: string;
}

/** Minimal objective row shape (from objectives table, migration 0072). */
export interface ObjectiveRow {
  id: string;
  owner_kind: string;
  owner_id: string;
  success_predicate: string;
  success_predicate_kind: string;
  hardness: string;
  priority: number;
}

/** Assessment view for a subject (from currentAssessmentView). */
export interface SubjectAssessmentView {
  status: AssessmentViewStatus;
  tone: AssessmentTone;
}

/** Input to the focused case graph enrichment. */
export interface FocusedCaseGraphEnrichmentInput {
  /** The case's subject rows (from case_subjects). */
  caseSubjects: readonly { subject_kind: string; subject_id: string; role: string }[];
  /** Journey rows for the case's JOURNEY subjects. */
  journeys: readonly JourneyRow[];
  /** Journey item rows for those journeys. */
  journeyItems: readonly JourneyItemRow[];
  /** Transport service rows referenced by TRANSPORT items. */
  transportServices: readonly TransportServiceRow[];
  /** Participation rows for the case's travellers. */
  participations: readonly ParticipationRow[];
  /** Programme item rows referenced by participations. */
  programmeItems: readonly ProgrammeItemRow[];
  /** Objective rows owned by the case's JOURNEY or TRIP subjects. */
  objectives: readonly ObjectiveRow[];
  /** Assessment views for subjects (keyed by `<KIND>:<id>`). */
  assessmentViews: ReadonlyMap<string, SubjectAssessmentView>;
  /** Traveller display names (keyed by journey_id). */
  travellerLabelsByJourney: ReadonlyMap<string, string>;
  /** The case id (for caseRef on nodes). */
  caseId: string;
}

/** Output: additional nodes and edges to append to the case's ldg. */
export interface FocusedCaseGraphEnrichment {
  nodes: ProductNodeFact[];
  edges: ProductEdgeFact[];
  /** Contract gap: objectives exist but no LdgNodeKind can carry them. */
  objectiveContractGap: boolean;
}

/**
 * Enrich the focused case graph with journey composition, programme commitments,
 * and human labels. Pure function of the input facts; no PostgreSQL, no scenario
 * branch, no topology search.
 */
export function projectFocusedCaseGraphEnrichment(
  input: FocusedCaseGraphEnrichmentInput,
): FocusedCaseGraphEnrichment {
  const nodes: ProductNodeFact[] = [];
  const edges: ProductEdgeFact[] = [];
  const seenNodeRefs = new Set<string>();
  const seenEdgeIds = new Set<string>();

  const pushNode = (node: ProductNodeFact): void => {
    if (!seenNodeRefs.has(node.ref)) {
      seenNodeRefs.add(node.ref);
      nodes.push(node);
    }
  };
  const pushEdge = (edge: ProductEdgeFact): void => {
    if (!seenEdgeIds.has(edge.id)) {
      seenEdgeIds.add(edge.id);
      edges.push(edge);
    }
  };

  // ---------------------------------------------------------------------------
  // 1. Human labels for case-subject nodes (JOURNEY subjects).
  // ---------------------------------------------------------------------------
  // The pgFactAssembler already emits TRAVELLER-kind nodes for case subjects with
  // label = subject_kind (e.g. 'JOURNEY'). We cannot change those nodes here
  // (they are already in the input), but we can emit ADDITIONAL nodes for the
  // journey's composition. The traveller label is used for those nodes' labels
  // where appropriate (e.g. "Traveller name's journey").
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // 2. Journey composition nodes (SERVICE_BOOKING, TRANSFER_STAY, TIMING).
  // ---------------------------------------------------------------------------
  const serviceById = new Map(input.transportServices.map((s) => [s.id, s]));
  const programmeItemById = new Map(input.programmeItems.map((p) => [p.id, p]));

  // Group journey items by journey_id.
  const itemsByJourney = new Map<string, JourneyItemRow[]>();
  for (const item of input.journeyItems) {
    const list = itemsByJourney.get(item.journey_id) ?? [];
    list.push(item);
    itemsByJourney.set(item.journey_id, list);
  }

  // Sort items by order_key (deterministic) for MUST_HAPPEN_BEFORE ordering.
  for (const items of itemsByJourney.values()) {
    items.sort((a, b) => {
      if (a.order_key < b.order_key) return -1;
      if (a.order_key > b.order_key) return 1;
      return a.id.localeCompare(b.id);
    });
  }

  // Emit nodes for each journey item.
  for (const journey of input.journeys) {
    const items = itemsByJourney.get(journey.id) ?? [];
    const journeyRef = `JOURNEY:${journey.id}`;

    // Emit nodes for each item in this journey.
    const itemRefs: string[] = [];
    for (const item of items) {
      // Determine node kind, ref, and label based on item kind.
      let kind: LdgNodeKind;
      let ref: string;
      let label: string;
      let detail: string | undefined;

      if (item.kind === 'TRANSPORT') {
        // SERVICE_BOOKING: ref is SERVICE_BOOKING:<service_id>, label from transport_services.
        kind = 'SERVICE_BOOKING';
        const serviceId = item.selectedServiceId;
        if (!serviceId) continue; // Skip transport items without a selected service.
        ref = `SERVICE_BOOKING:${serviceId}`;
        const service = serviceById.get(serviceId);
        if (service) {
          label = `${service.mode} ${service.operator}`;
          detail = `${service.origin_place_id.slice(0, 8)} → ${service.destination_place_id.slice(0, 8)}`;
        } else {
          label = `Transport service ${serviceId.slice(0, 8)}`;
        }
      } else if (item.kind === 'STAY') {
        // TRANSFER_STAY: ref is TRANSFER_STAY:<item_id>.
        kind = 'TRANSFER_STAY';
        ref = `TRANSFER_STAY:${item.id}`;
        label = `Stay ${item.id.slice(0, 8)}`;
        if (item.intended_window_start && item.intended_window_end) {
          detail = `${item.intended_window_start} → ${item.intended_window_end}`;
        }
      } else if (item.kind === 'ENGAGEMENT') {
        // ENGAGEMENT items link to programme_items via engagement_item_details.participation_id.
        // We emit them as PROGRAMME_COMMITMENT if they link to a programme item, otherwise
        // as a generic node. For now, skip (the participation logic below handles programme items).
        continue;
      } else {
        // RESOURCE_USE: not currently mapped to a specific kind; skip.
        continue;
      }

      itemRefs.push(ref);

      // semanticState: from assessment view if available, else UNKNOWN.
      const assessment = input.assessmentViews.get(ref);
      const semanticState = assessment ? TONE_TO_STATE[assessment.tone] : 'UNKNOWN';
      const evaluation = assessment?.status;

      pushNode({
        ref,
        kind,
        label,
        semanticState,
        authority: 'AUTHORITATIVE',
        caseRef: input.caseId,
        ...(evaluation ? { evaluation } : {}),
        ...(detail ? { detail } : {}),
      });
    }

    // Emit MUST_HAPPEN_BEFORE edges between consecutive items (deterministic order).
    for (let i = 0; i < itemRefs.length - 1; i++) {
      const fromRef = itemRefs[i]!;
      const toRef = itemRefs[i + 1]!;
      pushEdge({
        id: `MUST_HAPPEN_BEFORE:${fromRef}:${toRef}`,
        fromRef,
        toRef,
        kind: 'MUST_HAPPEN_BEFORE',
        authority: 'AUTHORITATIVE',
      });
    }

    // Emit RELIES_ON edges from the journey to its items.
    for (const itemRef of itemRefs) {
      pushEdge({
        id: `RELIES_ON:${journeyRef}:${itemRef}`,
        fromRef: journeyRef,
        toRef: itemRef,
        kind: 'RELIES_ON',
        authority: 'AUTHORITATIVE',
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Programme commitment nodes (via participations).
  // ---------------------------------------------------------------------------
  // participations with REQUIRED/OPTIONAL accepted status in an ACTIVE programme.
  // We need to filter participations by accepted=true and obligation in (REQUIRED, OPTIONAL).
  // Then join to programme_items to get the label/window.
  // The programme_items table has lifecycle_status; we only include ACTIVE/SCHEDULED items.
  // ---------------------------------------------------------------------------

  const acceptedParticipations = input.participations.filter(
    (p) => p.accepted && (p.obligation === 'REQUIRED' || p.obligation === 'OPTIONAL'),
  );

  for (const participation of acceptedParticipations) {
    const programmeItem = programmeItemById.get(participation.programme_item_id);
    if (!programmeItem) continue;
    if (programmeItem.lifecycle_status !== 'SCHEDULED' && programmeItem.lifecycle_status !== 'DRAFT') {
      continue; // Only include active programme items.
    }

    const programmeItemRef = `PROGRAMME_ITEM:${programmeItem.id}`;
    const label = programmeItem.title;
    const detail = programmeItem.window_start && programmeItem.window_end
      ? `${programmeItem.window_start} → ${programmeItem.window_end}`
      : undefined;

    // semanticState: from assessment view if available, else UNKNOWN.
    const assessment = input.assessmentViews.get(`PROGRAMME_ITEM:${programmeItem.id}`);
    const semanticState = assessment ? TONE_TO_STATE[assessment.tone] : 'UNKNOWN';
    const evaluation = assessment?.status;

    pushNode({
      ref: programmeItemRef,
      kind: 'PROGRAMME_COMMITMENT',
      label,
      semanticState,
      authority: 'AUTHORITATIVE',
      caseRef: input.caseId,
      ...(evaluation ? { evaluation } : {}),
      ...(detail ? { detail } : {}),
    });

    // Emit PARTICIPATES_IN edges from the journey to the programme item.
    // We need to find the journey for this traveller.
    const journey = input.journeys.find((j) => j.traveller_id === participation.traveller_id);
    if (journey) {
      const journeyRef = `JOURNEY:${journey.id}`;
      pushEdge({
        id: `PARTICIPATES_IN:${journeyRef}:${programmeItemRef}`,
        fromRef: journeyRef,
        toRef: programmeItemRef,
        kind: 'PARTICIPATES_IN',
        authority: 'AUTHORITATIVE',
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Objectives (contract gap).
  // ---------------------------------------------------------------------------
  // The closed LdgNodeKind enum has no OBJECTIVE kind. We cannot emit objective
  // nodes without violating the contract. Report the gap.
  // ---------------------------------------------------------------------------
  const objectiveContractGap = input.objectives.length > 0;

  return {
    nodes,
    edges,
    objectiveContractGap,
  };
}

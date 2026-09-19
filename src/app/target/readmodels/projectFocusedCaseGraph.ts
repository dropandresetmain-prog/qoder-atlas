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
 *     items, and TIMING nodes only where a canonical changed arrival is explicitly
 *     implicated by a persisted evaluator explanation.
 *   - Programme commitments: PROGRAMME_COMMITMENT nodes via participations with
 *     REQUIRED/OPTIONAL accepted status in an ACTIVE programme.
 *   - Trip purpose/objectives: TRIP_OBJECTIVE is a presentation of the existing
 *     canonical objective, never a new domain entity or copied journey verdict.
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
  /** Canonical endpoint/place zone for STAY windows, when the place is known. */
  timeZone?: string | null;
  /** For TRANSPORT items: the selected transport service id (from transport_item_details). */
  selectedServiceId?: string | null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Human window text for a node card: `19 Sep 11:30 → 12:00 UTC` (same day) or
 * `19 Sep 22:00 → 20 Sep 01:00 UTC`. Accepts the driver's Date or ISO string; never
 * emits a runtime `Date#toString` (host-timezone text).
 */
export function formatWindowUtc(start: unknown, end: unknown): string {
  return formatWindowInTimeZone(start, end, 'UTC');
}

/** Format a canonical programme window in its supplied zone, defaulting to UTC. */
export function formatWindowInTimeZone(start: unknown, end: unknown, timeZone?: string | null): string {
  const parse = (v: unknown): Date | undefined => {
    const d = v instanceof Date ? v : new Date(String(v));
    return Number.isNaN(d.getTime()) ? undefined : d;
  };
  const a = parse(start);
  const b = parse(end);
  if (!a || !b) return `${String(start)} → ${String(end)}`;
  const zone = timeZone || 'UTC';
  const parts = (d: Date, requestedZone: string) => {
    const format = (tz: string) => new Intl.DateTimeFormat('en-GB', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      hour12: false, timeZone: tz, timeZoneName: 'short',
    }).formatToParts(d);
    try {
      const values = Object.fromEntries(format(requestedZone).map((part) => [part.type, part.value]));
      return {
        day: `${values.day} ${values.month}`,
        clock: `${values.hour}:${values.minute}`,
        zone: values.timeZoneName || requestedZone,
      };
    } catch {
      const values = Object.fromEntries(format('UTC').map((part) => [part.type, part.value]));
      return {
        day: `${values.day} ${values.month}`,
        clock: `${values.hour}:${values.minute}`,
        zone: 'UTC',
      };
    }
  };
  const first = parts(a, zone);
  const second = parts(b, zone);
  return first.day === second.day
    ? `${first.day} ${first.clock} → ${second.clock} ${first.zone}`
    : `${first.day} ${first.clock} → ${second.day} ${second.clock} ${first.zone}`;
}

/** `19 Sep 22:00 UTC` for a single instant (Date or ISO string). */
export function formatInstantUtc(value: unknown): string {
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
}

/** Minimal transport service row shape (from transport_services table, migration 0030). */
export interface TransportServiceRow {
  id: string;
  mode: string;
  operator: string;
  origin_place_id: string;
  destination_place_id: string;
  /** Human place names (LEFT JOIN places); absent => no place text is invented. */
  origin_place_name?: string | null;
  destination_place_name?: string | null;
  published_departure: string | null;
  published_arrival: string | null;
  estimated_arrival?: string | null;
  actual_arrival?: string | null;
  /** Canonical IANA time zone of the arrival place, where available. */
  destination_time_zone?: string | null;
}

function transportModeLabel(mode: string): string {
  const labels: Record<string, string> = {
    AIR: 'flight',
    FLIGHT: 'flight',
    RAIL: 'train',
    TRAIN: 'train',
    ROAD: 'ground journey',
    BUS: 'bus',
    SEA: 'ferry',
    FERRY: 'ferry',
  };
  const normalized = mode.trim().toUpperCase();
  return labels[normalized] ?? (mode.trim().toLowerCase() || 'transport');
}

/** Exact reservation evidence for a journey's selected transport service. */
export interface TransportBookingFact {
  journeyId: string;
  serviceId: string;
  lineCount: number;
  lineStatus: string | null;
  reservationStatus: string | null;
  observedAt?: string | null;
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
  time_zone?: string | null;
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
  /** Reservation evidence joined to the exact selected service and journey item. */
  transportBookingFacts?: readonly TransportBookingFact[];
  /** Participation rows for the case's travellers. */
  participations: readonly ParticipationRow[];
  /** Programme item rows referenced by participations. */
  programmeItems: readonly ProgrammeItemRow[];
  /** Objective rows owned by the case's JOURNEY or TRIP subjects. */
  objectives: readonly ObjectiveRow[];
  /** Assessment views for subjects (keyed by `<KIND>:<id>`). */
  assessmentViews: ReadonlyMap<string, SubjectAssessmentView>;
  /** Blocking evaluator explanations, including optional persisted cause refs. */
  causalPath?: readonly import('../../../contracts/v2/product/readModels.ts').CausalPathStep[];
  /** Traveller display names (keyed by journey_id). */
  travellerLabelsByJourney: ReadonlyMap<string, string>;
  /** The case id (for caseRef on nodes). */
  caseId: string;
  /** Applied linked change signal that may causally create/update a service. */
  changeSignalRef?: string;
  /** Service ids proven by change_records to be changed under that signal. */
  changedTransportServiceRefs?: ReadonlySet<string>;
}

/** Output: additional nodes and edges to append to the case's ldg. */
export interface FocusedCaseGraphEnrichment {
  nodes: ProductNodeFact[];
  edges: ProductEdgeFact[];
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
  const assessmentFor = (ref: string): SubjectAssessmentView | undefined => input.assessmentViews.get(ref);
  const stateFor = (ref: string): { semanticState: LdgSemanticState; evaluation?: AssessmentViewStatus } => {
    const assessment = assessmentFor(ref);
    return assessment
      ? { semanticState: TONE_TO_STATE[assessment.tone], evaluation: assessment.status }
      : { semanticState: 'UNKNOWN' };
  };
  const hasArrivalExplanation = (itemRef: string, serviceRef: string, currentAt: string): boolean => (input.causalPath ?? []).some((step) => {
    const referencesArrivalSubject = step.causeSubjectRef === itemRef
      || step.causeSubjectRef === serviceRef
      || step.relatedSubjectRefs.includes(itemRef)
      || step.relatedSubjectRefs.includes(serviceRef);
    if (!referencesArrivalSubject) return false;
    const factAt = (...keys: string[]): boolean => keys.some((key) => step.facts[key] === currentAt);
    // Connection facts explicitly distinguish upstream arrival from downstream
    // departure. Related refs alone cover both legs and cannot establish which
    // arrival is operationally responsible.
    if (step.dimension === 'connection_feasibility') return factAt('upstreamArrival');
    // Participation/objective arrival checks carry the reach/readiness instant.
    // A departure-after-engagement failure includes that same arrival context,
    // but the failed fact is the departure and must not turn arrival red.
    if ((step.dimension === 'programme_participation' || step.dimension === 'hard_objectives')
      && step.reasonCode !== 'departs_before_item_ends') {
      return factAt('arrival', 'readyAt', 'scheduledArrival');
    }
    return false;
  });
  const hasProgrammeFailure = (ref: string): boolean => (input.causalPath ?? []).some((step) =>
    step.dimension === 'programme_participation' && step.causeSubjectRef === ref,
  );
  const hasObjectiveFailure = (ref: string): boolean => (input.causalPath ?? []).some((step) =>
    step.dimension === 'hard_objectives' && step.causeSubjectRef === ref,
  );

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
  const selectedJourneysByService = new Map<string, Set<string>>();
  for (const item of input.journeyItems) {
    if (item.kind !== 'TRANSPORT' || !item.selectedServiceId) continue;
    const journeys = selectedJourneysByService.get(item.selectedServiceId) ?? new Set<string>();
    journeys.add(item.journey_id);
    selectedJourneysByService.set(item.selectedServiceId, journeys);
  }
  const bookingFactByJourneyService = new Map(
    (input.transportBookingFacts ?? []).map((fact) => [`${fact.journeyId}:${fact.serviceId}`, fact]),
  );
  const bookingStateFor = (serviceId: string): { state: LdgSemanticState; detail?: string } => {
    const journeyIds = selectedJourneysByService.get(serviceId);
    if (!journeyIds || journeyIds.size === 0) return { state: 'UNKNOWN' };
    const facts = [...journeyIds]
      .map((journeyId) => bookingFactByJourneyService.get(`${journeyId}:${serviceId}`));
    const confirmed = facts.length === journeyIds.size
      && facts.every((fact) => fact?.lineCount === 1 && fact.lineStatus === 'CONFIRMED'
        && fact.reservationStatus === 'CONFIRMED');
    if (!confirmed) return { state: 'UNKNOWN' };
    const observedAt = facts.find((fact) => fact?.observedAt)?.observedAt;
    return {
      state: input.changedTransportServiceRefs?.has(serviceId) ? 'RECOVERED' : 'HEALTHY',
      detail: `Booking line confirmed${observedAt ? ` · observed ${formatInstantUtc(observedAt)}` : ''}`,
    };
  };

  // Group journey items by journey_id.
  const itemsByJourney = new Map<string, JourneyItemRow[]>();
  const timingRefByJourneyItem = new Map<string, string>();
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
      let transportService: TransportServiceRow | undefined;

      if (item.kind === 'TRANSPORT') {
        // SERVICE_BOOKING: ref is SERVICE_BOOKING:<service_id>, label from transport_services.
        kind = 'SERVICE_BOOKING';
        const serviceId = item.selectedServiceId;
        if (!serviceId) continue; // Skip transport items without a selected service.
        ref = `SERVICE_BOOKING:${serviceId}`;
        transportService = serviceById.get(serviceId);
        if (transportService) {
          label = `${transportService.operator} ${transportModeLabel(transportService.mode)}`;
          if (transportService.origin_place_name && transportService.destination_place_name) {
            detail = `${transportService.origin_place_name} → ${transportService.destination_place_name}`;
          }
        } else {
          label = 'Transport service';
        }
      } else if (item.kind === 'STAY') {
        // TRANSFER_STAY: ref is TRANSFER_STAY:<item_id>.
        kind = 'TRANSFER_STAY';
        ref = `TRANSFER_STAY:${item.id}`;
        label = 'Stay';
        if (item.intended_window_start && item.intended_window_end) {
          detail = formatWindowInTimeZone(item.intended_window_start, item.intended_window_end, item.timeZone);
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

      const bookingState = item.kind === 'TRANSPORT' && item.selectedServiceId
        ? bookingStateFor(item.selectedServiceId)
        : undefined;
      const state = item.kind === 'TRANSPORT'
        ? { semanticState: bookingState?.state ?? 'UNKNOWN' as LdgSemanticState }
        : stateFor(ref);
      if (bookingState?.detail) {
        detail = detail ? `${detail} · ${bookingState.detail}` : bookingState.detail;
      }

      const serviceSubjectRef = item.kind === 'TRANSPORT' && item.selectedServiceId
        ? `TRANSPORT_SERVICE:${item.selectedServiceId}`
        : undefined;
      const itemSubjectRef = `JOURNEY_ITEM:${item.id}`;
      const currentAt = transportService
        ? transportService.actual_arrival ?? transportService.estimated_arrival ?? transportService.published_arrival
        : null;
      const timingImplicated = currentAt !== null && serviceSubjectRef !== undefined && (
        hasArrivalExplanation(itemSubjectRef, serviceSubjectRef, currentAt)
      );

      pushNode({
        ref,
        kind,
        label,
        semanticState: state.semanticState,
        authority: 'AUTHORITATIVE',
        caseRef: input.caseId,
        ...(serviceSubjectRef
          ? { subjectRefs: timingImplicated ? [serviceSubjectRef] : [serviceSubjectRef, itemSubjectRef] }
          : {}),
        ...(state.evaluation ? { evaluation: state.evaluation } : {}),
        ...(detail ? { detail } : {}),
      });

      if (item.kind === 'TRANSPORT' && item.selectedServiceId
        && input.changeSignalRef && input.changedTransportServiceRefs?.has(item.selectedServiceId)) {
        pushEdge({
          id: `AFFECTED_BY:${input.changeSignalRef}:${ref}`,
          fromRef: input.changeSignalRef,
          toRef: ref,
          kind: 'AFFECTED_BY',
          authority: 'AUTHORITATIVE',
          semanticState: 'CHANGED',
        });
      }

      if (item.kind === 'TRANSPORT' && transportService && currentAt && timingImplicated) {
          const timingRef = `TIMING:${item.id}:ARRIVAL`;
          timingRefByJourneyItem.set(item.id, timingRef);
          pushNode({
            ref: timingRef,
            kind: 'TIMING',
            label: 'Arrival timing',
            // CHANGED requires a canonical published baseline that differs. A
            // replacement schedule matching its own published time (or a timing
            // fact without that baseline) is still shown when a blocking
            // evaluator explanation implicates it, as FAILED rather than falsely
            // calling that schedule change itself.
            semanticState: transportService.published_arrival !== null && currentAt !== transportService.published_arrival ? 'CHANGED' : 'FAILED',
            authority: 'AUTHORITATIVE',
            caseRef: input.caseId,
            // The service remains the visual home of TRANSPORT_SERVICE; the
            // timing node is the visual home of a causal JOURNEY_ITEM when it
            // exists. This keeps every canonical ref one-to-one.
            subjectRefs: [itemSubjectRef],
            timing: {
              currentAt,
              ...(transportService.published_arrival ? { publishedAt: transportService.published_arrival } : {}),
              ...(transportService.destination_time_zone ? { timeZone: transportService.destination_time_zone } : {}),
            },
          });
          pushEdge({
            id: `MUST_HAPPEN_BEFORE:${ref}:${timingRef}`,
            fromRef: ref,
            toRef: timingRef,
            kind: 'MUST_HAPPEN_BEFORE',
            authority: 'AUTHORITATIVE',
          });
      }
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
      ? formatWindowInTimeZone(programmeItem.window_start, programmeItem.window_end, programmeItem.time_zone)
      : undefined;

    const programmeItemSubjectRef = `PROGRAMME_ITEM:${programmeItem.id}`;
    const state = stateFor(programmeItemSubjectRef);
    // A journey-wide failure is not a programme consequence. The only fallback
    // is the participation evaluator's own failing explanation for this item.
    const semanticState = assessmentFor(programmeItemSubjectRef)
      ? state.semanticState
      : hasProgrammeFailure(programmeItemSubjectRef) ? 'FAILED' : 'UNKNOWN';

    pushNode({
      ref: programmeItemRef,
      kind: 'PROGRAMME_COMMITMENT',
      label,
      semanticState,
      authority: 'AUTHORITATIVE',
      caseRef: input.caseId,
      subjectRefs: [programmeItemSubjectRef],
      ...(state.evaluation ? { evaluation: state.evaluation } : {}),
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

      for (const participationStep of input.causalPath ?? []) {
        if (participationStep.dimension !== 'programme_participation' || participationStep.causeSubjectRef !== programmeItemSubjectRef) continue;
        for (const relatedRef of participationStep.relatedSubjectRefs) {
          if (!relatedRef.startsWith('JOURNEY_ITEM:')) continue;
          const timingRef = timingRefByJourneyItem.get(relatedRef.slice('JOURNEY_ITEM:'.length));
          if (!timingRef) continue;
          pushEdge({
            id: `MUST_HAPPEN_BEFORE:${timingRef}:${programmeItemRef}`,
            fromRef: timingRef,
            toRef: programmeItemRef,
            kind: 'MUST_HAPPEN_BEFORE',
            authority: 'AUTHORITATIVE',
            // This specific arrival-to-participation relationship failed in the
            // stored evaluator explanation; no endpoint tone is substituted.
            semanticState: 'FAILED',
          });
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Objectives — presentation of existing canonical rows only.
  // ---------------------------------------------------------------------------
  for (const objective of input.objectives) {
    const objectiveSubjectRef = `OBJECTIVE:${objective.id}`;
    const state = stateFor(objectiveSubjectRef);
    const semanticState = assessmentFor(objectiveSubjectRef)
      ? state.semanticState
      : hasObjectiveFailure(objectiveSubjectRef) ? 'FAILED' : 'UNKNOWN';
    const objectiveRef = `OBJECTIVE:${objective.id}`;
    pushNode({
      ref: objectiveRef,
      kind: 'TRIP_OBJECTIVE',
      label: objective.success_predicate,
      semanticState,
      authority: 'AUTHORITATIVE',
      caseRef: input.caseId,
      subjectRefs: [objectiveSubjectRef],
      ...(state.evaluation ? { evaluation: state.evaluation } : {}),
    });
  }

  return {
    nodes,
    edges,
  };
}

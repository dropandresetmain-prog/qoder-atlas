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
  /** Canonical intended place display name for STAY items, when known. */
  placeName?: string | null;
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
  /** Provider service designator when a linked external record supplies one. */
  service_code?: string | null;
}

/** Explain a failed arrival-readiness check from the evaluator's own minutes. */
function readinessShortfall(
  steps: readonly { facts: Record<string, string | number | boolean | null> }[] | undefined,
  currentAt: string,
): string | undefined {
  for (const step of steps ?? []) {
    const available = step.facts.availableMinutes;
    const required = step.facts.requiredMinutes;
    if (typeof available !== 'number' || typeof required !== 'number') continue;
    const scheduled = step.facts.scheduledArrival;
    if (typeof scheduled === 'string' && scheduled !== currentAt) continue;
    const shortfall = required - available;
    if (shortfall <= 0) continue;
    return `${available} minutes available before the commitment, ${required} minutes required, ${shortfall} minutes short`;
  }
  return undefined;
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

/**
 * A participant-scoped programme explanation from a Journey assessment.
 * Programme-item assessments are not participant-specific, so the Case
 * projection carries this exact scope separately instead of copying an
 * aggregate Journey verdict onto every commitment.
 */
export interface ProgrammeParticipationAssessment {
  journeyId: string;
  travellerId: string;
  participationId: string;
  programmeId: string;
  programmeItemId: string;
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
  /** Currentness-aware participant-scoped programme explanations. */
  programmeParticipationAssessments?: readonly ProgrammeParticipationAssessment[];
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
  /** A completed supplier replacement, distinct from a schedule deterioration. */
  reprotectedTransportServiceRefs?: ReadonlySet<string>;
  /**
   * Published arrival of the single original service this change displaced.
   * Used as the before-time on a reprotected booking whose own published
   * arrival already equals the replacement schedule.
   */
  displacedPublishedArrival?: string;
  /**
   * Proposed SELECT_OFFER transport services keyed by journey item id.
   * When present, the Case graph shows the proposed card BESIDE the still-visible
   * canonical booking (FAILED when the connection is broken) — never as a
   * replacement that hides the original onward leg. Build with
   * `selectProposedServicePreview`; canonical selection is never mutated.
   */
  proposedServiceByJourneyItem?: ReadonlyMap<string, string>;
  /**
   * Presentation rows for the proposed services named above, derived from the
   * recorded offer itinerary (operator/mode/route/times). They are NOT
   * `transport_services` rows, never shadow one, and carry no service code —
   * an offer itinerary has none, so none is invented.
   */
  proposedTransportServices?: readonly TransportServiceRow[];
  /**
   * Exact reservation evidence for stay journey items (CONFIRMED line + reservation).
   * When present, the stay card paints HEALTHY with confirmation detail instead of
   * UNKNOWN merely because no assessment tone was recorded.
   */
  stayBookingFacts?: readonly StayBookingFact[];
}

/** Exact reservation evidence for a stay journey item. */
export interface StayBookingFact {
  journeyItemId: string;
  lineCount: number;
  lineStatus: string | null;
  reservationStatus: string | null;
  observedAt?: string | null;
}

/** One recorded proposed SELECT_OFFER binding, reduced to what the preview needs. */
export interface ProposedServiceBinding {
  journeyItemId: string;
  proposedTransportServiceId: string;
}

/**
 * Which journey items the focused Case graph may preview as rebound to a
 * proposed service. Pure and conservative:
 *   - the caller supplies only the bindings of the ONE recommended strategy
 *     (never every candidate);
 *   - once execution of that strategy has started, canonical state (and later
 *     observation) owns the card — no preview, so a booked service is never
 *     hidden behind a stale proposal;
 *   - only TRANSPORT items of the case's journeys are eligible;
 *   - a proposal equal to the canonical selection previews nothing;
 *   - two different proposals for one item are ambiguous and preview nothing.
 */
export function selectProposedServicePreview(input: {
  journeyItems: readonly JourneyItemRow[];
  bindings: readonly ProposedServiceBinding[];
  executionStarted: boolean;
}): Map<string, string> {
  const preview = new Map<string, string>();
  if (input.executionStarted) return preview;
  const itemById = new Map(input.journeyItems.map((item) => [item.id, item]));
  const ambiguous = new Set<string>();
  for (const binding of input.bindings) {
    const item = itemById.get(binding.journeyItemId);
    if (!item || item.kind !== 'TRANSPORT') continue;
    if (binding.proposedTransportServiceId === item.selectedServiceId) continue;
    if (ambiguous.has(item.id)) continue;
    const existing = preview.get(item.id);
    if (existing === undefined) {
      preview.set(item.id, binding.proposedTransportServiceId);
    } else if (existing !== binding.proposedTransportServiceId) {
      preview.delete(item.id);
      ambiguous.add(item.id);
    }
  }
  return preview;
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
      return;
    }
    // Topology edges are emitted first without a condition. A later evaluator
    // explanation may annotate the same producer-owned id with relationship
    // truth (AFFECTED / FAILED) without inventing a second edge.
    if (edge.semanticState) {
      const index = edges.findIndex((candidate) => candidate.id === edge.id);
      if (index >= 0 && edges[index] && !edges[index]!.semanticState) {
        edges[index] = { ...edges[index]!, semanticState: edge.semanticState };
      }
    }
  };
  /**
   * Connection relationship colour comes from the evaluator reason, not from
   * endpoint tones. A delayed arrival stays CHANGED; the connection itself is
   * AFFECTED when merely below minimum, FAILED when broken/impossible.
   */
  const connectionRelationshipState = (
    step: NonNullable<FocusedCaseGraphEnrichmentInput['causalPath']>[number],
  ): LdgSemanticState | undefined => {
    if (step.dimension !== 'connection_feasibility') return undefined;
    const gap = typeof step.facts.gapMinutes === 'number' ? step.facts.gapMinutes : undefined;
    if (step.reasonCode === 'connection_broken' || (gap !== undefined && gap < 0)) return 'FAILED';
    if (step.reasonCode === 'connection_below_minimum') return 'AFFECTED';
    if (step.reasonCode === 'transfer_does_not_fit') return gap !== undefined && gap < 0 ? 'FAILED' : 'AFFECTED';
    return undefined;
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
  // Itinerary-derived proposal rows only label a proposal; they never replace
  // a canonical row that happens to share the id.
  for (const proposed of input.proposedTransportServices ?? []) {
    if (!serviceById.has(proposed.id)) serviceById.set(proposed.id, proposed);
  }
  const programmeItemById = new Map(input.programmeItems.map((p) => [p.id, p]));
  /** The proposed service previewed for this item, when it differs from canonical. */
  const previewServiceIdFor = (item: JourneyItemRow): string | undefined => {
    if (item.kind !== 'TRANSPORT') return undefined;
    const proposed = input.proposedServiceByJourneyItem?.get(item.id);
    return proposed !== undefined && proposed !== item.selectedServiceId ? proposed : undefined;
  };
  /** Canonical selected service — always preferred for the authoritative spine. */
  const canonicalServiceIdFor = (item: JourneyItemRow): string | undefined =>
    item.kind === 'TRANSPORT' ? (item.selectedServiceId ?? undefined) : undefined;
  // Presentation refs of previewed (not yet booked) services — used when emitting
  // the recovery branch so the broken-connection verdict stays on the canonical
  // onward booking and is never transplanted onto the proposal.
  const selectedJourneysByService = new Map<string, Set<string>>();
  for (const item of input.journeyItems) {
    const serviceId = canonicalServiceIdFor(item);
    if (!serviceId) continue;
    const journeys = selectedJourneysByService.get(serviceId) ?? new Set<string>();
    journeys.add(item.journey_id);
    selectedJourneysByService.set(serviceId, journeys);
  }
  const bookingFactByJourneyService = new Map(
    (input.transportBookingFacts ?? []).map((fact) => [`${fact.journeyId}:${fact.serviceId}`, fact]),
  );
  const stayBookingByItem = new Map(
    (input.stayBookingFacts ?? []).map((fact) => [fact.journeyItemId, fact]),
  );
  /**
   * Onward bookings made impossible by a broken connection are FAILED on the
   * card itself — not only on the timing→onward edge. Topology uses journey
   * order_key so alphabetical relatedSubject sorting cannot reverse legs.
   * The verdict always attaches to the CANONICAL onward service, even when a
   * proposed replacement is also previewed beside it.
   */
  const connectionFailedDownstreamServices = new Set<string>();
  for (const step of input.causalPath ?? []) {
    if (connectionRelationshipState(step) !== 'FAILED') continue;
    const relatedItems = step.relatedSubjectRefs
      .filter((ref) => ref.startsWith('JOURNEY_ITEM:'))
      .map((ref) => input.journeyItems.find((item) => item.id === ref.slice('JOURNEY_ITEM:'.length)))
      .filter((item): item is JourneyItemRow => item != null && !!canonicalServiceIdFor(item))
      .sort((a, b) => {
        if (a.order_key < b.order_key) return -1;
        if (a.order_key > b.order_key) return 1;
        return a.id.localeCompare(b.id);
      });
    if (relatedItems.length < 2) continue;
    const downstream = relatedItems[relatedItems.length - 1]!;
    const downstreamServiceId = canonicalServiceIdFor(downstream);
    if (downstreamServiceId) connectionFailedDownstreamServices.add(downstreamServiceId);
  }
  const bookingStateFor = (serviceId: string): { state: LdgSemanticState; detail?: string } => {
    if (connectionFailedDownstreamServices.has(serviceId)) {
      return { state: 'FAILED', detail: 'Onward booking unreachable after broken connection' };
    }
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
      state: input.reprotectedTransportServiceRefs?.has(serviceId) ? 'RECOVERED'
        : input.changedTransportServiceRefs?.has(serviceId) ? 'CHANGED' : 'HEALTHY',
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
    // itemRefs holds the AUTHORITATIVE composition sequence (canonical bookings +
    // stays). Proposed replacements are emitted beside the sequence, not in it.
    const itemRefs: string[] = [];
    const proposedRefs: string[] = [];

    const emitTransportBooking = (args: {
      item: JourneyItemRow;
      serviceId: string;
      proposed: boolean;
    }): string | undefined => {
      const { item, serviceId, proposed } = args;
      const transportService = serviceById.get(serviceId);
      const ref = `SERVICE_BOOKING:${serviceId}`;
      let label: string;
      let detail: string | undefined;
      if (transportService) {
        const rawCode = transportService.service_code?.trim();
        const code = rawCode && !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(rawCode) ? rawCode : undefined;
        label = [transportService.operator, code, transportModeLabel(transportService.mode)]
          .filter((part) => part && part.length > 0)
          .join(' ');
        if (transportService.origin_place_name && transportService.destination_place_name) {
          detail = `${transportService.origin_place_name} → ${transportService.destination_place_name}`;
        }
      } else {
        label = 'Transport service';
      }

      const serviceSubjectRef = `TRANSPORT_SERVICE:${serviceId}`;
      const itemSubjectRef = `JOURNEY_ITEM:${item.id}`;
      // Proposed cards must not claim the journey-item subject — that maps
      // evaluator explanations onto the canonical FAILED booking.
      const subjectRefs = proposed
        ? [serviceSubjectRef]
        : undefined;

      if (proposed) {
        const note = 'Proposed replacement · not booked yet';
        detail = detail ? `${detail} · ${note}` : note;
        pushNode({
          ref,
          kind: 'SERVICE_BOOKING',
          label,
          semanticState: 'PROPOSED',
          authority: 'PROPOSED',
          caseRef: input.caseId,
          subjectRefs: subjectRefs!,
          detail,
        });
        return ref;
      }

      const bookingState = bookingStateFor(serviceId);
      const semanticState = bookingState.state;
      if (bookingState.detail) {
        detail = detail ? `${detail} · ${bookingState.detail}` : bookingState.detail;
      }

      const currentAt = transportService
        ? transportService.actual_arrival ?? transportService.estimated_arrival ?? transportService.published_arrival
        : null;
      const timingImplicated = currentAt !== null && (
        hasArrivalExplanation(itemSubjectRef, serviceSubjectRef, currentAt)
      );

      pushNode({
        ref,
        kind: 'SERVICE_BOOKING',
        label,
        semanticState,
        authority: 'AUTHORITATIVE',
        caseRef: input.caseId,
        subjectRefs: timingImplicated ? [serviceSubjectRef] : [serviceSubjectRef, itemSubjectRef],
        ...(detail ? { detail } : {}),
      });

      if (input.changeSignalRef && input.changedTransportServiceRefs?.has(serviceId)) {
        pushEdge({
          id: `AFFECTED_BY:${input.changeSignalRef}:${ref}`,
          fromRef: input.changeSignalRef,
          toRef: ref,
          kind: 'AFFECTED_BY',
          authority: 'AUTHORITATIVE',
          semanticState: 'CHANGED',
        });
      }

      if (transportService && currentAt && timingImplicated) {
        const timingRef = `TIMING:${item.id}:ARRIVAL`;
        timingRefByJourneyItem.set(item.id, timingRef);
        const reprotected = input.reprotectedTransportServiceRefs?.has(serviceId) === true;
        const displaced = reprotected ? input.displacedPublishedArrival : undefined;
        const ownPublished = transportService.published_arrival ?? undefined;
        const priorAt = displaced && displaced !== currentAt ? displaced : ownPublished;
        const readiness = readinessShortfall(input.causalPath, currentAt);
        pushNode({
          ref: timingRef,
          kind: 'TIMING',
          label: 'Arrival timing',
          semanticState: priorAt !== undefined && priorAt !== currentAt ? 'CHANGED' : 'AFFECTED',
          authority: 'AUTHORITATIVE',
          caseRef: input.caseId,
          subjectRefs: [itemSubjectRef],
          ...(readiness ? { detail: readiness } : {}),
          timing: {
            currentAt,
            ...(priorAt ? { publishedAt: priorAt } : {}),
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
      return ref;
    };

    for (const item of items) {
      if (item.kind === 'TRANSPORT') {
        const canonicalId = canonicalServiceIdFor(item);
        const previewId = previewServiceIdFor(item);
        if (!canonicalId && !previewId) continue;
        if (canonicalId) {
          const ref = emitTransportBooking({ item, serviceId: canonicalId, proposed: false });
          if (ref) itemRefs.push(ref);
        }
        if (previewId) {
          const ref = emitTransportBooking({ item, serviceId: previewId, proposed: true });
          if (ref) proposedRefs.push(ref);
        }
        continue;
      }

      if (item.kind === 'STAY') {
        const ref = `TRANSFER_STAY:${item.id}`;
        const place = item.placeName?.trim();
        const label = place ? `Stay · ${place}` : 'Stay';
        let detail: string | undefined;
        if (item.intended_window_start && item.intended_window_end) {
          detail = formatWindowInTimeZone(item.intended_window_start, item.intended_window_end, item.timeZone);
        }
        const itemSubjectRef = `JOURNEY_ITEM:${item.id}`;
        const stayFact = stayBookingByItem.get(item.id);
        const stayConfirmed = stayFact
          && stayFact.lineCount === 1
          && stayFact.lineStatus === 'CONFIRMED'
          && stayFact.reservationStatus === 'CONFIRMED';
        const assessed = stateFor(ref);
        const state = stayConfirmed
          ? {
              semanticState: 'HEALTHY' as LdgSemanticState,
              detail: `Booking line confirmed${stayFact?.observedAt ? ` · observed ${formatInstantUtc(stayFact.observedAt)}` : ''}`,
            }
          : assessed;
        if (stayConfirmed && state.detail) {
          detail = detail ? `${detail} · ${state.detail}` : state.detail;
        }
        itemRefs.push(ref);
        pushNode({
          ref,
          kind: 'TRANSFER_STAY',
          label,
          semanticState: stayConfirmed ? 'HEALTHY' : assessed.semanticState,
          authority: 'AUTHORITATIVE',
          caseRef: input.caseId,
          subjectRefs: [itemSubjectRef],
          ...(!stayConfirmed && assessed.evaluation ? { evaluation: assessed.evaluation } : {}),
          ...(detail ? { detail } : {}),
        });
        continue;
      }

      // ENGAGEMENT / RESOURCE_USE: programme path or skip.
      if (item.kind === 'ENGAGEMENT' || item.kind === 'RESOURCE_USE') continue;
    }

    // MUST_HAPPEN_BEFORE between consecutive AUTHORITATIVE items only.
    for (let i = 0; i < itemRefs.length - 1; i++) {
      const fromRef = itemRefs[i]!;
      const toRef = itemRefs[i + 1]!;
      const upstreamItem = items.find((candidate) => {
        const canonical = canonicalServiceIdFor(candidate);
        if (canonical && `SERVICE_BOOKING:${canonical}` === fromRef) return true;
        if (candidate.kind === 'STAY' && `TRANSFER_STAY:${candidate.id}` === fromRef) return true;
        return false;
      });
      if (upstreamItem && timingRefByJourneyItem.has(upstreamItem.id)) continue;
      pushEdge({
        id: `MUST_HAPPEN_BEFORE:${fromRef}:${toRef}`,
        fromRef,
        toRef,
        kind: 'MUST_HAPPEN_BEFORE',
        authority: 'AUTHORITATIVE',
      });
    }

    // Traveller → every composed authoritative item; proposed separately.
    for (const itemRef of itemRefs) {
      pushEdge({
        id: `RELIES_ON:${journeyRef}:${itemRef}`,
        fromRef: journeyRef,
        toRef: itemRef,
        kind: 'RELIES_ON',
        authority: 'AUTHORITATIVE',
      });
    }
    for (const proposedRef of proposedRefs) {
      pushEdge({
        id: `RELIES_ON:${journeyRef}:${proposedRef}`,
        fromRef: journeyRef,
        toRef: proposedRef,
        kind: 'RELIES_ON',
        authority: 'PROPOSED',
      });
    }
  }

  // Connection feasibility owns the relationship between the delayed arrival
  // and the onward booking. Canonical FAILED stays on the mainline; a proposed
  // replacement (when present) gets its own Arrival → proposed branch.
  for (const step of input.causalPath ?? []) {
    const relationshipState = connectionRelationshipState(step);
    if (!relationshipState) continue;
    const relatedItems = step.relatedSubjectRefs
      .filter((ref) => ref.startsWith('JOURNEY_ITEM:'))
      .map((ref) => input.journeyItems.find((item) => item.id === ref.slice('JOURNEY_ITEM:'.length)))
      .filter((item): item is JourneyItemRow => item != null && !!canonicalServiceIdFor(item))
      .sort((a, b) => {
        if (a.order_key < b.order_key) return -1;
        if (a.order_key > b.order_key) return 1;
        return a.id.localeCompare(b.id);
      });
    if (relatedItems.length < 2) continue;
    const upstreamItem = relatedItems[0]!;
    const downstreamItem = relatedItems[relatedItems.length - 1]!;
    const upstreamServiceId = canonicalServiceIdFor(upstreamItem)!;
    const downstreamServiceId = canonicalServiceIdFor(downstreamItem)!;
    const upstreamBooking = `SERVICE_BOOKING:${upstreamServiceId}`;
    const downstreamBooking = `SERVICE_BOOKING:${downstreamServiceId}`;
    const timingRef = timingRefByJourneyItem.get(upstreamItem.id);
    if (timingRef) {
      pushEdge({
        id: `MUST_HAPPEN_BEFORE:${timingRef}:${downstreamBooking}`,
        fromRef: timingRef,
        toRef: downstreamBooking,
        kind: 'MUST_HAPPEN_BEFORE',
        authority: 'AUTHORITATIVE',
        semanticState: relationshipState,
      });
    } else {
      pushEdge({
        id: `MUST_HAPPEN_BEFORE:${upstreamBooking}:${downstreamBooking}`,
        fromRef: upstreamBooking,
        toRef: downstreamBooking,
        kind: 'MUST_HAPPEN_BEFORE',
        authority: 'AUTHORITATIVE',
        semanticState: relationshipState,
      });
    }
    const previewId = previewServiceIdFor(downstreamItem);
    if (previewId) {
      const proposedBooking = `SERVICE_BOOKING:${previewId}`;
      const fromRef = timingRef ?? upstreamBooking;
      pushEdge({
        id: `MUST_HAPPEN_BEFORE:${fromRef}:${proposedBooking}`,
        fromRef,
        toRef: proposedBooking,
        kind: 'MUST_HAPPEN_BEFORE',
        authority: 'PROPOSED',
        semanticState: 'PROPOSED',
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

  const participantAssessmentsFor = (
    participation: ParticipationRow,
    programmeItem: ProgrammeItemRow,
  ): ProgrammeParticipationAssessment[] => {
    const caseJourneyIdsForTraveller = new Set(
      input.journeys
        .filter((journey) => journey.traveller_id === participation.traveller_id)
        .map((journey) => journey.id),
    );
    return (input.programmeParticipationAssessments ?? []).filter(
      (assessment) => assessment.travellerId === participation.traveller_id
        && assessment.participationId === participation.id
        && assessment.programmeId === programmeItem.programme_id
        && assessment.programmeItemId === programmeItem.id
        && caseJourneyIdsForTraveller.has(assessment.journeyId),
    );
  };

  const scopedAssessmentsFor = (programmeItem: ProgrammeItemRow): ProgrammeParticipationAssessment[] => {
    const relevantParticipations = acceptedParticipations.filter(
      (participation) => participation.programme_item_id === programmeItem.id,
    );
    const direct = relevantParticipations.flatMap((participation) => participantAssessmentsFor(participation, programmeItem));
    if (direct.length === 0) return [];
    // If one relevant accepted participant has no scoped record, retain that
    // missing evidence as UNKNOWN so another participant's PASS cannot make a
    // shared commitment look healthy. The assembler normally supplies this
    // record; synthesising it here keeps the pure projector conservative too.
    return relevantParticipations.flatMap((participation) => {
      const records = participantAssessmentsFor(participation, programmeItem);
      return records.length > 0
        ? records
        : [{
            journeyId: '',
            travellerId: participation.traveller_id,
            participationId: participation.id,
            programmeId: programmeItem.programme_id,
            programmeItemId: programmeItem.id,
            status: 'NONE' as AssessmentViewStatus,
            tone: 'UNKNOWN' as AssessmentTone,
          }];
    });
  };

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
    // A journey-wide failure is not a programme consequence. Prefer exact
    // participant explanations, and fall back only to a standalone item
    // assessment or that item's own failing explanation.
    const scopedAssessments = scopedAssessmentsFor(programmeItem);
    const lifecycleRank: Record<AssessmentViewStatus, number> = {
      NONE: 0,
      CURRENT: 1,
      STALE: 2,
      PENDING_REASSESSMENT: 3,
      UNAVAILABLE: 4,
    };
    const scopedEvaluation = scopedAssessments.length > 0
      ? scopedAssessments.some((assessment) => assessment.status === 'NONE')
        ? 'NONE' as const
        : scopedAssessments.reduce((worst, assessment) =>
            lifecycleRank[assessment.status] > lifecycleRank[worst]
              ? assessment.status
              : worst, 'NONE' as AssessmentViewStatus)
      : undefined;
    const scopedSemanticState = scopedAssessments.length > 0
      ? scopedAssessments.some((assessment) => assessment.status === 'CURRENT' && assessment.tone === 'FAIL')
        ? 'FAILED' as const
        : scopedAssessments.some((assessment) => assessment.status !== 'CURRENT' || assessment.tone !== 'PASS')
          ? 'UNKNOWN' as const
          : 'HEALTHY' as const
      : undefined;
    const semanticState = scopedSemanticState
      ?? (assessmentFor(programmeItemSubjectRef)
        ? state.semanticState
        : hasProgrammeFailure(programmeItemSubjectRef) ? 'FAILED' : 'UNKNOWN');
    const evaluation = scopedEvaluation ?? state.evaluation;

    pushNode({
      ref: programmeItemRef,
      kind: 'PROGRAMME_COMMITMENT',
      label,
      semanticState,
      authority: 'AUTHORITATIVE',
      caseRef: input.caseId,
      subjectRefs: [programmeItemSubjectRef],
      ...(evaluation ? { evaluation } : {}),
      ...(detail ? { detail } : {}),
    });

    // Emit PARTICIPATES_IN edges from the exact assessed journey when the
    // participant evidence supplies one. The traveller fallback preserves
    // the pre-existing composition path for worlds without explanations.
    const scopedJourneyId = participantAssessmentsFor(participation, programmeItem).find(
      (assessment) => assessment.journeyId,
    )?.journeyId;
    const journey = (scopedJourneyId
      ? input.journeys.find((candidate) => candidate.id === scopedJourneyId)
      : undefined)
      ?? input.journeys.find((candidate) => candidate.traveller_id === participation.traveller_id);
    if (journey) {
      const journeyRef = `JOURNEY:${journey.id}`;
      pushEdge({
        id: `PARTICIPATES_IN:${journeyRef}:${programmeItemRef}`,
        fromRef: journeyRef,
        toRef: programmeItemRef,
        kind: 'PARTICIPATES_IN',
        authority: 'AUTHORITATIVE',
      });

      // Composition: Arrival → required programmes (Sarah mechanic), not only on
      // participation FAIL. Mark FAILED only when that participation failed.
      const journeyArrivalTimings = (itemsByJourney.get(journey.id) ?? [])
        .map((item) => timingRefByJourneyItem.get(item.id))
        .filter((ref): ref is string => ref !== undefined);
      const arrivalTimingRef = journeyArrivalTimings[journeyArrivalTimings.length - 1];
      const participationFailed = semanticState === 'FAILED' || (input.causalPath ?? []).some(
        (step) => step.dimension === 'programme_participation'
          && step.causeSubjectRef === programmeItemSubjectRef,
      );
      if (arrivalTimingRef) {
        pushEdge({
          id: `MUST_HAPPEN_BEFORE:${arrivalTimingRef}:${programmeItemRef}`,
          fromRef: arrivalTimingRef,
          toRef: programmeItemRef,
          kind: 'MUST_HAPPEN_BEFORE',
          authority: 'AUTHORITATIVE',
          ...(participationFailed ? { semanticState: 'FAILED' as const } : {}),
        });
      }

      for (const participationStep of input.causalPath ?? []) {
        if (participationStep.dimension !== 'programme_participation' || participationStep.causeSubjectRef !== programmeItemSubjectRef) continue;
        for (const relatedRef of participationStep.relatedSubjectRefs) {
          if (!relatedRef.startsWith('JOURNEY_ITEM:')) continue;
          const timingRef = timingRefByJourneyItem.get(relatedRef.slice('JOURNEY_ITEM:'.length));
          if (!timingRef || timingRef === arrivalTimingRef) continue;
          pushEdge({
            id: `MUST_HAPPEN_BEFORE:${timingRef}:${programmeItemRef}`,
            fromRef: timingRef,
            toRef: programmeItemRef,
            kind: 'MUST_HAPPEN_BEFORE',
            authority: 'AUTHORITATIVE',
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

/**
 * F2 — operator/traveller read models (FR-12, FR-13, ARCHITECTURE.md §17).
 *
 * UI consumes these purpose-built projections only — never arbitrary graph
 * queries. Copy is user-facing: no graph/agent/constraint jargon.
 */
import type { EntityId, IsoDateTime, Money } from '../domain/common.ts';

export type ReadModelState = 'LOADED' | 'LOADING' | 'ERROR';

/** Envelope so UI can render loading/error/unknown states honestly. */
export interface ReadModelEnvelope<T> {
  state: ReadModelState;
  data?: T;
  errorMessage?: string;
  generatedAt?: IsoDateTime;
}

/**
 * Operational status for a traveller/trip surface.
 * - PLANNING: confirmed traveller, no viable trip yet (initial planning).
 * - NEEDS_TRAVELLER_INFO: intake/promotion blocked on traveller input.
 * - CHANGE_REQUESTED: traveller ChangeRequest accepted, resolution in flight.
 */
export type ReadModelStatus =
  | 'READY'
  | 'PLANNING'
  | 'NEEDS_TRAVELLER_INFO'
  | 'CHANGE_REQUESTED'
  | 'AT_RISK'
  | 'DISRUPTED'
  | 'RECOVERING'
  | 'RESOLVED'
  | 'UNKNOWN';

export type RemainderViability = 'VIABLE' | 'AT_RISK' | 'NOT_VIABLE' | 'UNKNOWN';

// ---------------------------------------------------------------------------
// Operator projections
// ---------------------------------------------------------------------------

export interface OperatorDecisionRequest {
  caseId: EntityId;
  decisionType: 'APPROVAL' | 'INPUT';
  description: string;
  amount?: Money;
  requestedAt?: IsoDateTime;
}

export interface OperatorTripView {
  tripId: EntityId;
  /** Open operator case for this trip. Absent when no case is actionable. */
  activeCaseId?: EntityId;
  label?: string;
  travellerNames: string[];
  anchorEventName?: string;
  /** Explicit intake travel arrangement when declared on the traveller entity. */
  travelArrangement?: 'NORTHSTAR_ARRANGED' | 'SELF_OR_OTHER_ARRANGED' | 'UNSPECIFIED';
  status: ReadModelStatus;
  /** What changed, in user-facing language. */
  whatChanged?: string;
  affectedItems: string[];
  systemActivity: string[];
  pendingDecisions: OperatorDecisionRequest[];
  uncertainties: string[];
  travellerResponseStatus?: 'AWAITING' | 'RESPONDED' | 'NOT_REQUIRED';
  resolutionSummary?: string;
  updatedAt: IsoDateTime;
}

export interface OperatorDashboardSummary {
  ready: number;
  atRisk: number;
  disrupted: number;
  recovering: number;
  awaitingDecision: number;
  /** Managed travellers in confirmed/on-track state (READY + RESOLVED). */
  managedConfirmed: number;
}

export interface OperatorDashboardView {
  generatedAt: IsoDateTime;
  summary: OperatorDashboardSummary;
  trips: OperatorTripView[];
  /** Authoritative arrangement counts for the scoped programme. */
  arrangementCounts: ProgrammeArrangementCounts;
}

// ---------------------------------------------------------------------------
// Programme projection (Northstar)
// ---------------------------------------------------------------------------

/** Per-status rollup for every traveller/trip in one AnchorEvent programme. */
export interface ProgrammeStatusSummary {
  total: number;
  ready: number;
  planning: number;
  needsTravellerInfo: number;
  changeRequested: number;
  atRisk: number;
  disrupted: number;
  recovering: number;
  awaitingDecision: number;
  resolved: number;
  unknown: number;
}

/**
 * Organiser-facing travel-arrangement counts (G3R-Closure fix B). Derived
 * ONLY from the explicit `travelArrangement` declaration each traveller
 * carried at intake — never from home locations, airport codes, or any other
 * incidental value. `total = northstarArranged + selfOrOtherArranged +
 * unspecified` by construction.
 */
export interface ProgrammeArrangementCounts {
  total: number;
  northstarArranged: number;
  selfOrOtherArranged: number;
  unspecified: number;
}

/** A shared event commitment with evidence of danger, from authoritative state. */
export interface EndangeredCommitmentView {
  commitmentId: EntityId;
  title: string;
  /** Deterministic reason the commitment is endangered. */
  reason: string;
  /** Travellers whose engagement of it is threatened. */
  affectedTravellerIds: EntityId[];
}

/** One traveller's programme-level row: status + open cases + decisions. */
export interface ProgrammeTravellerView {
  tripId: EntityId;
  travellerId: EntityId;
  travellerName: string;
  status: ReadModelStatus;
  activeCaseIds: EntityId[];
  decisionsRequired: number;
  uncertainties: string[];
  updatedAt: IsoDateTime;
  /** Explicit intake arrangement when known — used for Local cohort presentation. */
  travelArrangement?: 'NORTHSTAR_ARRANGED' | 'SELF_OR_OTHER_ARRANGED' | 'UNSPECIFIED';
}

/**
 * Operator view over one AnchorEvent programme — a pure projection over
 * authoritative AnchorEvent / Trip / RecoveryCase state (no UI-local truth).
 */
export interface ProgrammeView {
  generatedAt: IsoDateTime;
  anchorEventId: EntityId;
  anchorEventName: string;
  summary: ProgrammeStatusSummary;
  /** Explicit arrangement responsibility counts for the organiser screen. */
  arrangementCounts: ProgrammeArrangementCounts;
  travellers: ProgrammeTravellerView[];
  endangeredCommitments: EndangeredCommitmentView[];
  /** Unresolved UNKNOWN evidence across the programme. */
  unresolvedUncertainties: string[];
}

// ---------------------------------------------------------------------------
// Traveller projections
// ---------------------------------------------------------------------------

export interface TravellerInputRequest {
  caseId: EntityId;
  prompt: string;
  options?: string[];
  decidedAt?: IsoDateTime;
}

export interface TravellerTripView {
  tripId: EntityId;
  /** Present only when this trip has one unambiguous traveller principal. */
  travellerId?: EntityId;
  status: ReadModelStatus;
  whatChanged?: string;
  whatMattersNow?: string;
  actionsInProgress: string[];
  inputRequested: TravellerInputRequest[];
  remainderViable: RemainderViability;
  resolutionSummary?: string;
  updatedAt: IsoDateTime;
}

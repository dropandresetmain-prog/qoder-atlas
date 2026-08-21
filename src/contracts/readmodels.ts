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

export type ReadModelStatus =
  | 'READY'
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
  label?: string;
  travellerNames: string[];
  anchorEventName?: string;
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
}

export interface OperatorDashboardView {
  generatedAt: IsoDateTime;
  summary: OperatorDashboardSummary;
  trips: OperatorTripView[];
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
  status: ReadModelStatus;
  whatChanged?: string;
  whatMattersNow?: string;
  actionsInProgress: string[];
  inputRequested: TravellerInputRequest[];
  remainderViable: RemainderViability;
  resolutionSummary?: string;
  updatedAt: IsoDateTime;
}

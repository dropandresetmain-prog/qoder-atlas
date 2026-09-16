import type {
  AssessmentTone,
  AssessmentViewStatus,
  ChangeAwareness,
  LdgEdgeKind,
  LdgNodeKind,
  LdgSemanticState,
  ProductOperationalStatus,
  RemainderViability,
} from '../../../contracts/v2/product/readModels.ts';

export interface ChangeAwarenessInput {
  projectionRevision: number;
  changedVisibleRefs: readonly string[];
  changedEdgeIds: readonly string[];
  previousSemanticState?: LdgSemanticState;
  currentSemanticState: LdgSemanticState;
  now?: string;
  changedAt?: string;
  changeSource?: string;
  /** See `ChangeAwarenessSchema.changeCursor` — opaque at-least-once xid8 cursor. */
  changeCursor?: string;
}

export interface ProductNodeFact {
  ref: string;
  kind: LdgNodeKind;
  label: string;
  semanticState: LdgSemanticState;
  authority?: 'AUTHORITATIVE' | 'PROPOSED';
  caseRef?: string;
  evaluation?: AssessmentViewStatus;
  detail?: string;
}

export interface ProductEdgeFact {
  id: string;
  fromRef: string;
  toRef: string;
  kind: LdgEdgeKind;
  semanticState?: LdgSemanticState;
  authority?: 'AUTHORITATIVE' | 'PROPOSED';
}

export interface LiveDependencyFacts {
  nodes: readonly ProductNodeFact[];
  edges: readonly ProductEdgeFact[];
}

export interface ProductWorldFacts extends LiveDependencyFacts, ChangeAwarenessInput {
  generatedAt: string;
  scope?: 'DASHBOARD' | 'INCIDENT_PROGRAMME' | 'FOCUSED_CASE';
}

export interface OperatorItemFact {
  tripRef: string;
  travellerLabel: string;
  status: ProductOperationalStatus;
  remainderViability: RemainderViability;
  incidentRef?: string;
  caseRef?: string;
  whatChanged?: string;
  affectedPeople?: readonly string[];
  affectedItems?: readonly string[];
  recoveryActivity?: string;
  decisionRequired?: boolean;
  unresolvedUncertainty?: readonly string[];
  evaluation?: AssessmentViewStatus;
}

export interface OperatorOverviewFacts extends ProductWorldFacts {
  items: readonly OperatorItemFact[];
}

export interface ProgrammeCommitmentFact {
  itemRef: string;
  label: string;
  windowLabel?: string;
  state: LdgSemanticState;
}

export interface IncidentProgrammeFacts extends ProductWorldFacts {
  incidentRef: string;
  sourceChangeSummary: string;
  affectedSet: readonly {
    personLabel: string;
    tripRef: string;
    outcome: AssessmentTone;
    remainderViability: RemainderViability;
  }[];
  programmeCommitments: readonly ProgrammeCommitmentFact[];
  currentProgrammeState?: string;
  proposedProgrammeState?: string;
}

export interface BookingServiceFact {
  label: string;
  state: LdgSemanticState;
  detail?: string;
}

export interface RecoveryStrategyFact {
  strategyRef: string;
  version: number;
  viability: string;
  status: string;
  projectedPeople: readonly { personLabel: string; verdict: AssessmentTone }[];
}

export interface RecoveryActionFact {
  actionRef: string;
  domain: string;
  capability: string;
  subjectRefs: readonly string[];
  cost?: { amount: string; currency: string };
  authorityState: string;
  approvalState?: string;
  dependencyOrder: number;
  dependsOnActionRefs?: readonly string[];
  executionState: import('../../../contracts/v2/product/readModels.ts').RecoveryActionExecutionState;
  observationResult?: string;
  uncertainty?: readonly string[];
}

export interface RecoveryCaseFacts extends ProductWorldFacts {
  caseRef: string;
  status: 'OPEN' | 'PLANNING' | 'AWAITING_AUTHORITY' | 'EXECUTING' | 'RESOLVED' | 'CLOSED' | 'CANCELLED' | 'SUPERSEDED';
  changeSummary: string;
  bookingServiceState: BookingServiceFact;
  tripViability: { label: string; verdict: AssessmentTone; detail?: string };
  affectedItems?: readonly string[];
  criticalCommitment?: string;
  causalFailureReason?: string;
  requirementVsActual?: { requirement: string; actual: string };
  strategies?: readonly RecoveryStrategyFact[];
  authorityState: string;
  executionState: string;
  reconciliationState: string;
  uncertainty?: readonly string[];
  resolutionSummary?: string;
  connectionProgression?: import('../../../contracts/v2/product/readModels.ts').ConnectionProgression;
  recoveryActions?: readonly RecoveryActionFact[];
  /** When omitted, derived from recoveryActions when present. */
  remainingRecoveryWork?: readonly string[];
  aggregateRecoveryCost?: { amount: string; currency: string };
  partialRecovery?: import('../../../contracts/v2/product/readModels.ts').PartialRecoveryView;
  duplicateBookingExposure?: readonly import('../../../contracts/v2/product/readModels.ts').DuplicateBookingExposureView[];
  /**
   * Internal only — never parsed into `RecoveryCaseView`. Each case subject's
   * own tone/evaluation status (and, defect-1, its raw EVALUATION_LIFECYCLE
   * xid8 `stamp`), so callers building other projections (e.g. the overview,
   * incident/programme) can reuse the CURRENT-assessment lookup already done
   * here instead of re-querying (FIG-6/FIG-7) and stay on the same cursor
   * scale without a second stamp read.
   */
  subjectFacts?: readonly { ref: string; tone: AssessmentTone; evaluation: AssessmentViewStatus; stamp?: bigint }[];
}

export interface TravellerTripFacts extends ProductWorldFacts {
  tripRef: string;
  amIOkay: 'YES' | 'NO' | 'UNKNOWN';
  whatChanged?: string;
  whatMattersNow?: string;
  whatNorthstarIsDoing?: string;
  whatDoYouNeedFromMe?: string;
  doesTheRestWork: RemainderViability;
  whatChangedAfterRecovery?: string;
}

export type ProductChangeAwareness = ChangeAwareness;

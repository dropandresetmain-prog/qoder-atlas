import type {
  AssessmentTone,
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
  previousSemanticState?: LdgSemanticState;
  currentSemanticState: LdgSemanticState;
  now?: string;
  changedAt?: string;
  changeSource?: string;
}

export interface ProductNodeFact {
  ref: string;
  kind: LdgNodeKind;
  label: string;
  semanticState: LdgSemanticState;
  authority?: 'AUTHORITATIVE' | 'PROPOSED';
  detail?: string;
}

export interface ProductEdgeFact {
  fromRef: string;
  toRef: string;
  kind: LdgEdgeKind;
  semanticState?: LdgSemanticState;
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

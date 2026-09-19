import type {
  AssessmentTone,
  AssessmentViewStatus,
  CaseCauseView,
  CausalPathStep,
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
  subjectRefs?: readonly string[];
  timing?: { currentAt: string; publishedAt?: string; timeZone?: string };
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

/**
 * One in-scope subject, independent of whether a case exists for it. See
 * `OperatorPopulationEntrySchema` for why this is additive to `items`.
 */
export interface OperatorPopulationFact {
  journeyRef: string;
  tripRef: string;
  travellerLabel: string;
  obligation: 'REQUIRED' | 'OPTIONAL' | 'INFORMED';
  status: ProductOperationalStatus;
  remainderViability: RemainderViability;
  evaluation: AssessmentViewStatus;
  caseRef?: string;
}

export interface EventContextFact {
  eventRef: string;
  title: string;
  organiserLabel?: string;
  programmeRef?: string;
}

/**
 * Raw authoritative rows behind the bounded Event Overview projection.
 * Local dates/times are computed by the store in each row's own time zone so
 * the pure builder stays free of time-zone logic. All arrays are bounded by
 * the producer; refs are typed (`PROGRAMME_ITEM:`, `SERVICE:`, `JOURNEY:`).
 */
export interface EventOverviewSourceFacts {
  /** Windowed, non-cancelled items of ACTIVE programmes. */
  programmeItems: readonly {
    itemRef: string;
    title: string;
    /** Local `YYYY-MM-DD` of window_start in the item's time zone. */
    localDate: string;
    /** Local `HH:MM` of window_start. */
    localTime: string;
    /** UTC ISO instant of window_start (ordering only). */
    windowStart: string;
  }[];
  /** Accepted participations, expanded to the participant's journeys. */
  participations: readonly {
    itemRef: string;
    journeyRef: string;
    obligation: 'REQUIRED' | 'OPTIONAL' | 'INFORMED';
  }[];
  /** One row per (journey, selected transport service). */
  journeyServices: readonly {
    journeyRef: string;
    serviceRef: string;
    mode: 'AIR' | 'RAIL' | 'ROAD' | 'SEA';
    operator: string;
    /** Effective (actual > estimated > published) arrival in the destination's zone. */
    arrivalLocalDate?: string;
    arrivalLocalTime?: string;
    publishedArrivalLocalTime?: string;
    /** Effective timing differs from published. */
    changed: boolean;
  }[];
}

export interface OperatorOverviewFacts extends ProductWorldFacts {
  items: readonly OperatorItemFact[];
  /**
   * Optional because only a store-backed producer can answer "who is in
   * scope" — the pure in-memory producers build a specific case's facts and
   * have no population to report, and must not fabricate one.
   */
  population?: readonly OperatorPopulationFact[];
  eventContext?: EventContextFact;
  /** Raw rows for the bounded Event Overview projection; see `buildEventOverview`. */
  eventOverviewSource?: EventOverviewSourceFacts;
  /** Demo ingress configuration flags */
  demoIngress?: {
    airlineRebookingConfigured: boolean;
  };
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

export interface RecoveryStrategyChangeFact {
  effectKind: string;
  subjectRef: string;
  subjectLabel: string;
  currentWindow?: { start: string; end: string };
  proposedWindow?: { start: string; end: string };
}

export interface RecoveryStrategyFact {
  strategyRef: string;
  version: number;
  viability: string;
  status: string;
  /** 1-based option number within the case, ascending by version. */
  optionNumber: number;
  /** Projected from the strategy's own persisted ScenarioChange effects. */
  changes: readonly RecoveryStrategyChangeFact[];
  /** Currently-blocking case subjects and the verdict this option projects. */
  resolves: readonly {
    subjectRef: string;
    personLabel: string;
    currentVerdict: AssessmentTone;
    projectedVerdict: AssessmentTone;
  }[];
  projectedSummary: { total: number; pass: number; fail: number; unknown: number };
  projectedPeople: readonly { subjectRef: string; personLabel: string; verdict: AssessmentTone }[];
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
  /** T3: the linked change signal (latest by receipt) that caused this case, when one is linked. */
  cause?: CaseCauseView;
  /** T3: blocking FAIL explanations of the case's failing subjects, in evaluator order. */
  causalPath?: readonly CausalPathStep[];
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
   * C9 — the latest completed recovery planning attempt for this case (raw
   * frozen C1 record + its closed outcome), when one exists. `projectRecoveryCase`
   * derives the decision-time `planningEvidence` view from it; the record is
   * passed through UNMODIFIED so the projector stays a pure function of frozen
   * contract types. Optional: a case that has not planned carries none.
   */
  /** R1 — durable case attention records (migration 0126), oldest first. */
  attention?: readonly import('../../../contracts/v2/planning/recoveryCaseAttention.ts').RecoveryCaseAttentionRecord[];
  /** R2 — the persisted immutable Original focused graph (migration 0127), when captured. */
  originalFocusedGraph?: import('../../../contracts/v2/product/readModels.ts').OriginalFocusedGraphView;
  planningAttempt?: {
    attempt: import('../../../contracts/v2/planning/recoveryPlanningAttempt.ts').RecoveryPlanningAttempt;
    outcome: import('../../../contracts/v2/planning/recoveryPlanningAttempt.ts').RecoveryPlanningOutcome;
  };
  /**
   * R2 carry-forward — authoritative human display labels for typed subject
   * refs (key `<KIND>:<id>`), resolved by the assembler from canonical
   * identity state (e.g. a Journey's traveller display name). Used ONLY to
   * upgrade decision-time planning-evidence subject labels; refs stay
   * secondary and the generic kind label is the fallback. Never persona
   * lookup: the map is a projection of stored names.
   */
  subjectHumanLabels?: ReadonlyMap<string, string>;
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

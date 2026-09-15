/**
 * M9 second-scenario foundation — Jordan S2.
 *
 * Supersedes the earlier traveller-initiated single-Journey placeholder.
 *
 * Materially different from Sarah (shared supplier → programme cohort):
 * - progressive individual disruption on one Journey
 * - deeper dependency chain (travel → stay → ground → programme)
 * - coordinated multi-action recovery with partial-execution truth
 *
 * Same runtime / read models / planner / LDG concepts as Sarah.
 * No second WiT hero polish for M9 completion.
 * Scenario facts (flights, hotels, rates, timings) arrive later from
 * Atlas + Nuitée evidence — never invent or hardcode them in app logic.
 */
export const JORDAN_S2_SCENARIO_KIND = 'jordan_s2_progressive_individual_disruption' as const;

/** @deprecated Retained name alias so older imports fail closed to the new kind. */
export const TRAVELLER_INITIATED_SCENARIO_KIND = JORDAN_S2_SCENARIO_KIND;

export type ConnectionProgressionState =
  | 'HEALTHY'
  | 'CONNECTION_SAFE'
  | 'CONNECTION_AT_RISK'
  | 'CONNECTION_IMPOSSIBLE'
  | 'RECOVERY_PLANNING'
  | 'AWAITING_APPROVAL'
  | 'EXECUTING_COORDINATED_RECOVERY'
  | 'CHECKING_RESULTS'
  | 'RECOVERED'
  | 'STILL_UNRESOLVED';

/**
 * How Jordan progression maps onto existing CK1 generic product enums
 * (no Jordan-only status field):
 *
 * | Progression              | ProductOperationalStatus | RemainderViability | AssessmentTone | LdgSemanticState |
 * |--------------------------|--------------------------|--------------------|----------------|------------------|
 * | HEALTHY / SAFE           | READY                    | VIABLE             | PASS           | HEALTHY          |
 * | CONNECTION_AT_RISK       | AT_RISK                  | AT_RISK            | UNKNOWN*       | AFFECTED         |
 * | CONNECTION_IMPOSSIBLE    | DISRUPTED                | NOT_VIABLE         | FAIL           | FAILED           |
 * | RECOVERY_PLANNING…       | RECOVERING               | (as assessed)      | (as assessed)  | ACTIVE/PROPOSED  |
 * | RECOVERED                | READY                    | VIABLE             | PASS           | RECOVERED        |
 *
 * (*) AT_RISK may present as UNKNOWN on assessment tone when connection
 * margin is uncertain; product copy uses remainderViability AT_RISK.
 */
export interface JordanS2ScenarioFoundation {
  kind: typeof JORDAN_S2_SCENARIO_KIND;
  signalOrigin: 'PROVIDER_PROGRESSIVE_DELAY';
  scope: {
    journeyCount: 1;
    programmeWideRecovery: false;
    multiDomainBlastRadius: true;
  };
  domains: readonly [
    'travel',
    'stay',
    'ground_transfer',
    'programme',
  ];
  progression: {
    states: readonly ConnectionProgressionState[];
    /** Transitions must come from runtime/read-model truth — never timers. */
    timerDrivenFakeProgression: false;
  };
  recovery: {
    multiActionStrategy: true;
    partialExecutionVisible: true;
    /** Case resolves only via CK1 deterministic reassessment gate. */
    providerSuccessDoesNotResolveCase: true;
    /**
     * Additive multi-stay contract (generic — not Jordan-only):
     * a strategy may include hub overnight insert AND destination
     * cancel+rebook as independent ActionIntents with dependency order
     * (cancel displaced only after replacement CONFIRMED).
     */
    multipleStayActionsPerStrategy: true;
    cancelDisplacedAfterReplacementConfirmed: true;
    duplicateStayExposureMustRemainVisible: true;
  };
  productSurfaces: {
    usesSharedReadModels: true;
    usesSharedPlanner: true;
    usesSharedLdgConcepts: true;
    dedicatedHeroUi: false;
    sarahLevelVisualPolishRequired: false;
  };
  pendingEvidence: {
    atlasFlightFacts: 'PENDING' | 'LANDED';
    nuiteeStayFacts: 'PENDING' | 'LANDED';
    exactTimings: 'PENDING' | 'LANDED';
    flightProvenance?: string;
    hotelProvenance?: string;
    groundTransferProvenance?: string;
  };
}

export const jordanS2ScenarioFoundation: JordanS2ScenarioFoundation = {
  kind: JORDAN_S2_SCENARIO_KIND,
  signalOrigin: 'PROVIDER_PROGRESSIVE_DELAY',
  scope: {
    journeyCount: 1,
    programmeWideRecovery: false,
    multiDomainBlastRadius: true,
  },
  domains: ['travel', 'stay', 'ground_transfer', 'programme'],
  progression: {
    states: [
      'HEALTHY',
      'CONNECTION_SAFE',
      'CONNECTION_AT_RISK',
      'CONNECTION_IMPOSSIBLE',
      'RECOVERY_PLANNING',
      'AWAITING_APPROVAL',
      'EXECUTING_COORDINATED_RECOVERY',
      'CHECKING_RESULTS',
      'RECOVERED',
      'STILL_UNRESOLVED',
    ],
    timerDrivenFakeProgression: false,
  },
  recovery: {
    multiActionStrategy: true,
    partialExecutionVisible: true,
    providerSuccessDoesNotResolveCase: true,
    multipleStayActionsPerStrategy: true,
    cancelDisplacedAfterReplacementConfirmed: true,
    duplicateStayExposureMustRemainVisible: true,
  },
  productSurfaces: {
    usesSharedReadModels: true,
    usesSharedPlanner: true,
    usesSharedLdgConcepts: true,
    dedicatedHeroUi: false,
    sarahLevelVisualPolishRequired: false,
  },
  pendingEvidence: {
    atlasFlightFacts: 'LANDED',
    nuiteeStayFacts: 'LANDED',
    exactTimings: 'LANDED',
    flightProvenance: 'ATLAS_REPLAY',
    hotelProvenance: 'NUITEE_SANDBOX_RECORD',
    groundTransferProvenance: 'SCENARIO_SIMULATED_PROVIDER_BOUNDARY',
  },
};

/** @deprecated Use jordanS2ScenarioFoundation. */
export const travellerInitiatedScenarioFoundation = jordanS2ScenarioFoundation;

/**
 * Multi-stay Jordan requirement audit (additive to first Jordan addendum).
 *
 * Domain ActionPlan already allows N ActionIntents + dependency edges with
 * independent subject/cost/authority/status — no one-hotel-per-strategy rule.
 *
 * CK1 product RecoveryCaseView still projects singular bookingServiceState /
 * executionState rollups. That is presentation compression, not a frozen
 * uniqueness constraint. Land per-action arrays at CK2 (below) so operators
 * can see independent stay outcomes and duplicate-booking exposure.
 *
 * Legacy whole-trip plan presentation currently `.find()`s one hotel.book and
 * may surface other stays as MANUAL_FOLLOWUP — correct generically at CK2;
 * do not reopen CK1.
 *
 * Verdict: multi-stay Jordan requirement compatible — no CK1 reopen.
 */
export const JORDAN_S2_MULTI_STAY_AUDIT_VERDICT =
  'multi-stay Jordan requirement compatible — no CK1 reopen.' as const;

/**
 * Additive generic read-model fields to land at Checkpoint 2 start
 * (not a CK1 reopen — existing enums already express SAFE/AT_RISK/IMPOSSIBLE).
 */
export const JORDAN_S2_CK2_ADDITIVE_READMODEL_FIELDS = [
  'RecoveryCaseView.connectionProgression — optional enum mapped from existing RemainderViability/status (presentation aid)',
  'RecoveryCaseView.recoveryActions[] — per ActionIntent: domain/capability, subject/booking identity, cost, authority, approval, dependency order, execution, observed outcome (supports multiple stay / hotel.book intents)',
  'RecoveryCaseView.aggregateRecoveryCost — deterministic total when all action costs known',
  'RecoveryCaseView.remainingRecoveryWork[] — unresolved consequences after partial execution (incl. failed/unknown displaced cancellation)',
  'RecoveryCaseView.partialRecovery — explicit successful/failed/pending action summaries (never collapse to one boolean or hotel=recovered)',
  'RecoveryCaseView.duplicateBookingExposure[] — when replacement stay CONFIRMED and displaced cancellation FAILED/OUTCOME_UNKNOWN',
  'Strategy/action projections — no one-action-per-domain assumption; cancel displaced depends on replacement CONFIRMED unless strategy explicitly permits otherwise',
  'Legacy wholeTripRecoveryPlan — stop assuming a single hotel.book via .find(); sequence hub overnight + destination cancel+rebook as independent intents when strategy requires both',
] as const;

/**
 * Jordan acceptance additions before C4 candidate (fixture facts still pending
 * Atlas + Nuitée — do not invent hotel/date/rate/provider values now).
 */
export const JORDAN_S2_ACCEPTANCE_MULTI_STAY = [
  'disruption → hub overnight required → destination stay affected',
  'strategy contains both stay consequences as independent ActionIntents',
  'safe destination replacement: quote → spend/authority gate → book → observe CONFIRMED → cancel displaced → observe CANCELLED',
  'partial-failure test: replacement CONFIRMED + displaced cancel FAILED/OUTCOME_UNKNOWN → duplicate exposure visible → case unresolved',
  'success path: replacement CONFIRMED + displaced CANCELLED + other mandatory actions complete + whole-trip reassessment PASS → case may resolve',
] as const;

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
  };
  productSurfaces: {
    usesSharedReadModels: true;
    usesSharedPlanner: true;
    usesSharedLdgConcepts: true;
    dedicatedHeroUi: false;
    sarahLevelVisualPolishRequired: false;
  };
  pendingEvidence: {
    atlasFlightFacts: 'PENDING';
    nuiteeStayFacts: 'PENDING';
    exactTimings: 'PENDING';
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
  },
  productSurfaces: {
    usesSharedReadModels: true,
    usesSharedPlanner: true,
    usesSharedLdgConcepts: true,
    dedicatedHeroUi: false,
    sarahLevelVisualPolishRequired: false,
  },
  pendingEvidence: {
    atlasFlightFacts: 'PENDING',
    nuiteeStayFacts: 'PENDING',
    exactTimings: 'PENDING',
  },
};

/** @deprecated Use jordanS2ScenarioFoundation. */
export const travellerInitiatedScenarioFoundation = jordanS2ScenarioFoundation;

/**
 * Additive generic read-model fields to land at Checkpoint 2 start
 * (not a CK1 reopen — existing enums already express SAFE/AT_RISK/IMPOSSIBLE).
 */
export const JORDAN_S2_CK2_ADDITIVE_READMODEL_FIELDS = [
  'RecoveryCaseView.connectionProgression — optional enum mapped from existing RemainderViability/status (presentation aid)',
  'RecoveryCaseView.recoveryActions[] — per ActionIntent: domain/capability, cost, authority, execution, observed outcome, order',
  'RecoveryCaseView.aggregateRecoveryCost — deterministic total when all action costs known',
  'RecoveryCaseView.remainingRecoveryWork[] — unresolved consequences after partial execution',
  'RecoveryCaseView.partialRecovery — explicit successful/failed/pending action summaries (never collapse to one boolean)',
] as const;

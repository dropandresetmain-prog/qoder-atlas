/**
 * M9 second-scenario foundation — traveller-initiated single-Journey change.
 *
 * Materially different from the shared-programme cohort hero:
 * - traveller-origin signal/request
 * - one Journey (not programme-wide recovery)
 * - policy/funding/approval reasoning
 *
 * Same runtime / read models / planner. No second WiT hero UI.
 * Scenario facts belong in fixtures — no domain branching on names/routes.
 */
export const TRAVELLER_INITIATED_SCENARIO_KIND = 'traveller_initiated_single_journey' as const;

export interface TravellerInitiatedScenarioFoundation {
  kind: typeof TRAVELLER_INITIATED_SCENARIO_KIND;
  /** Signal origin — never programme/organiser blast. */
  signalOrigin: 'TRAVELLER_REQUEST';
  scope: {
    journeyCount: 1;
    programmeWideRecovery: false;
  };
  approvalReasoning: {
    /** Policy/funding gate rather than programme cohort authority. */
    requiresPolicyFundingApproval: true;
    sharedProgrammeAuthority: false;
  };
  /** Same application surfaces; no dedicated hero. */
  productSurfaces: {
    usesSharedReadModels: true;
    usesSharedPlanner: true;
    dedicatedHeroUi: false;
  };
}

export const travellerInitiatedScenarioFoundation: TravellerInitiatedScenarioFoundation = {
  kind: TRAVELLER_INITIATED_SCENARIO_KIND,
  signalOrigin: 'TRAVELLER_REQUEST',
  scope: {
    journeyCount: 1,
    programmeWideRecovery: false,
  },
  approvalReasoning: {
    requiresPolicyFundingApproval: true,
    sharedProgrammeAuthority: false,
  },
  productSurfaces: {
    usesSharedReadModels: true,
    usesSharedPlanner: true,
    dedicatedHeroUi: false,
  },
};

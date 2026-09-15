/**
 * M9 primary WiT scenario foundation — shared supplier → programme cohort.
 *
 * Product semantics are frozen; fixture IDs/provider artifacts remain in the
 * fixture lane. Application logic must not hardcode traveller names, airports,
 * flight IDs, commitment IDs, or provider refs.
 */
export const SHARED_SUPPLIER_PROGRAMME_COHORT_KIND =
  'shared_supplier_programme_cohort_disruption' as const;

export interface SharedSupplierProgrammeCohortFoundation {
  kind: typeof SHARED_SUPPLIER_PROGRAMME_COHORT_KIND;
  signalOrigin: 'PROVIDER_SUPPLIER_DISRUPTION';
  scope: {
    /** Product contract: five travellers share the disrupted supplier service. */
    expectedTravellerCount: 5;
    programmeWideRecovery: true;
    multiDomainBlastRadius: true;
  };
  readiness: {
    /** Semantic trigger — not a role-name list. */
    appliesWhen: {
      obligation: 'REQUIRED';
      requiresPhysicalPresence: true;
    };
    /** Default policy minutes for this scenario pack — RuleSet may override. */
    defaultRequiredMinutes: 150;
    /** Frozen failure geometry used by tests (config data, not app branches). */
    failureGeometry: {
      replacementArrivalLocalHint: '10:30';
      earlyCommitmentLocalHint: '11:30';
      availableMinutes: 60;
      requiredMinutes: 150;
    };
  };
  recovery: {
    kind: 'BILATERAL_PROGRAMME_TIME_SWAP';
    requiresNewFlightPurchase: false;
    previewMustNotMutateAuthoritativeState: true;
    counterpartCommitmentIdFromFixtureLane: true;
  };
  productSurfaces: {
    usesSharedReadModels: true;
    usesSharedPlanner: true;
    usesSharedLdgConcepts: true;
    ldgScopes: readonly [
      'DASHBOARD',
      'INCIDENT_PROGRAMME',
      'FOCUSED_CASE',
      'PROPOSED_VS_AUTHORITATIVE_PREVIEW',
    ];
  };
  pendingFixtureLane: {
    providerArtifacts: 'PENDING';
    exactCommitmentIds: 'PENDING';
    exactFlightNumbers: 'PENDING';
  };
}

export const sharedSupplierProgrammeCohortFoundation: SharedSupplierProgrammeCohortFoundation = {
  kind: SHARED_SUPPLIER_PROGRAMME_COHORT_KIND,
  signalOrigin: 'PROVIDER_SUPPLIER_DISRUPTION',
  scope: {
    expectedTravellerCount: 5,
    programmeWideRecovery: true,
    multiDomainBlastRadius: true,
  },
  readiness: {
    appliesWhen: {
      obligation: 'REQUIRED',
      requiresPhysicalPresence: true,
    },
    defaultRequiredMinutes: 150,
    failureGeometry: {
      replacementArrivalLocalHint: '10:30',
      earlyCommitmentLocalHint: '11:30',
      availableMinutes: 60,
      requiredMinutes: 150,
    },
  },
  recovery: {
    kind: 'BILATERAL_PROGRAMME_TIME_SWAP',
    requiresNewFlightPurchase: false,
    previewMustNotMutateAuthoritativeState: true,
    counterpartCommitmentIdFromFixtureLane: true,
  },
  productSurfaces: {
    usesSharedReadModels: true,
    usesSharedPlanner: true,
    usesSharedLdgConcepts: true,
    ldgScopes: [
      'DASHBOARD',
      'INCIDENT_PROGRAMME',
      'FOCUSED_CASE',
      'PROPOSED_VS_AUTHORITATIVE_PREVIEW',
    ],
  },
  pendingFixtureLane: {
    providerArtifacts: 'PENDING',
    exactCommitmentIds: 'PENDING',
    exactFlightNumbers: 'PENDING',
  },
};

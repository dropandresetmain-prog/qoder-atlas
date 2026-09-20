/**
 * Demo/input-boundary dataset contract.
 *
 * This is the *boundary* shape of an external programme dataset directory —
 * the format a runtime bundle is written in, not a second domain model. It is
 * deliberately separate from `ProgrammeImportBundle` (the narrow generic
 * intake contract, which stays narrow) because a real programme bundle
 * carries far more than a title and a traveller list, and forcing it through
 * the narrow schema would silently discard facts.
 *
 * Nothing here names a scenario, person, place, carrier or event. Every
 * identifier is opaque source-semantic text supplied by the dataset; the
 * materializer resolves it to internal UUIDs through explicit external
 * identity mapping.
 */
import { z } from 'zod';

const NonEmpty = z.string().min(1);

/** A value the source stated, with who said it and when it was observed. */
export const ObservedValueSchema = z.looseObject({
  value: NonEmpty,
  sourceId: NonEmpty.optional(),
  authority: NonEmpty.optional(),
  observedAt: NonEmpty.optional(),
});

export const ExternalRefSchema = z.looseObject({
  system: NonEmpty,
  value: NonEmpty.optional(),
  reference: NonEmpty.optional(),
});
export type DatasetExternalRef = z.infer<typeof ExternalRefSchema>;

export const DatasetPlaceSchema = z.looseObject({
  id: NonEmpty,
  name: NonEmpty,
  kind: NonEmpty,
  timezone: NonEmpty,
  externalRefs: z.array(ExternalRefSchema).default([]),
  servedByPlaceIds: z.array(NonEmpty).default([]),
  coordinates: z.looseObject({ latitude: z.number(), longitude: z.number() }).optional(),
});
export type DatasetPlace = z.infer<typeof DatasetPlaceSchema>;

export const DatasetCommitmentSchema = z.looseObject({
  id: NonEmpty,
  anchorEventId: NonEmpty,
  title: NonEmpty,
  kind: NonEmpty,
  placeId: NonEmpty.optional(),
  startsAt: ObservedValueSchema.optional(),
  endsAt: ObservedValueSchema.optional(),
});
export type DatasetCommitment = z.infer<typeof DatasetCommitmentSchema>;

export const DatasetAnchorEventSchema = z.looseObject({
  id: NonEmpty,
  name: NonEmpty,
  kind: NonEmpty,
  placeId: NonEmpty.optional(),
  window: z.looseObject({ startsAt: NonEmpty, endsAt: NonEmpty }).optional(),
  organiserOrganisationId: NonEmpty,
  instructions: ObservedValueSchema.optional(),
  commitments: z.array(DatasetCommitmentSchema).default([]),
  sourceIds: z.array(NonEmpty).default([]),
});

export const DatasetOrganisationSchema = z.looseObject({
  id: NonEmpty,
  name: NonEmpty,
  roles: z.array(NonEmpty).default([]),
  homeCurrency: NonEmpty,
});

/**
 * A policy rule as the source stated it. `kind` and the operand fields are
 * open: the materializer maps the kinds it can express onto real rule-set
 * editions and registered constraints, and preserves the rest verbatim in the
 * published edition rather than dropping them.
 */
export const DatasetRuleSchema = z.looseObject({
  id: NonEmpty,
  kind: NonEmpty,
  sourceId: NonEmpty.optional(),
  description: z.string().optional(),
  appliesTo: z.array(NonEmpty).default([]),
});
export type DatasetRule = z.infer<typeof DatasetRuleSchema>;

export const DatasetRuleSetSchema = z.looseObject({
  id: NonEmpty,
  kind: NonEmpty,
  name: NonEmpty,
  ownerOrganisationId: NonEmpty,
  sourceId: NonEmpty.optional(),
  rules: z.array(DatasetRuleSchema).default([]),
});
export type DatasetRuleSet = z.infer<typeof DatasetRuleSetSchema>;

export const DatasetTransportLegSchema = z.looseObject({
  itemKind: z.literal('TRANSPORT_LEG'),
  mode: NonEmpty,
  originRef: ExternalRefSchema,
  destinationRef: ExternalRefSchema,
  scheduledDeparture: NonEmpty,
  scheduledArrival: NonEmpty,
  carrierRef: ExternalRefSchema,
  bookingRef: ExternalRefSchema.optional(),
  flexibility: NonEmpty.optional(),
  reservationState: NonEmpty.optional(),
});

export const DatasetStaySchema = z.looseObject({
  itemKind: z.literal('STAY'),
  stayPlaceRef: ExternalRefSchema,
  checkIn: NonEmpty,
  checkOut: NonEmpty,
  bookingRef: ExternalRefSchema.optional(),
  reservationState: NonEmpty.optional(),
});

export const DatasetDeclaredTravelSchema = z.discriminatedUnion('itemKind', [
  DatasetTransportLegSchema,
  DatasetStaySchema,
]);
export type DatasetDeclaredTravel = z.infer<typeof DatasetDeclaredTravelSchema>;

export const DatasetEngagementImportanceSchema = z.looseObject({
  commitmentId: NonEmpty,
  role: NonEmpty.optional(),
  importance: z.enum(['REQUIRED', 'PREFERRED', 'OPTIONAL']),
  flexibility: NonEmpty.optional(),
});

/**
 * A generic, data-carried planning preference a dataset MAY state for a
 * traveller (G09). Materialized through the ordinary `recordPreference` command
 * as a `planning-preference/1` value; EXPLICIT outranks INFERRED at planning
 * time. `effectiveFrom` defaults to the dataset's `context.at`, `effectiveUntil`
 * to ten years later. Nothing in code keys on any traveller.
 */
export const DatasetPreferenceSchema = z.looseObject({
  preferenceKind: NonEmpty,
  source: z.enum(['EXPLICIT', 'INFERRED']),
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  summary: NonEmpty,
  match: z.looseObject({
    domains: z.array(NonEmpty).optional(),
    proposerIds: z.array(NonEmpty).optional(),
    changedRefKinds: z.array(NonEmpty).optional(),
  }).optional(),
  effectiveFrom: NonEmpty.optional(),
  effectiveUntil: NonEmpty.optional(),
});
export type DatasetPreference = z.infer<typeof DatasetPreferenceSchema>;

export const DatasetTravellerSchema = z.looseObject({
  draftId: NonEmpty,
  displayName: NonEmpty,
  identity: z.looseObject({ email: NonEmpty.optional(), lastName: NonEmpty.optional() }).default({}),
  homeLocationText: z.string().optional(),
  nationalityCodes: z.array(NonEmpty).default([]),
  notes: z.array(z.string()).default([]),
  accessibilityStatements: z.array(z.string()).default([]),
  anchorCommitmentIds: z.array(NonEmpty).default([]),
  travelArrangement: NonEmpty.optional(),
  declaredTravel: z.array(DatasetDeclaredTravelSchema).default([]),
  engagementImportance: z.array(DatasetEngagementImportanceSchema).default([]),
  preferences: z.array(DatasetPreferenceSchema).default([]),
});
export type DatasetTraveller = z.infer<typeof DatasetTravellerSchema>;

export const DatasetProgrammeSchema = z.looseObject({
  context: z.looseObject({
    at: NonEmpty,
    sourceId: NonEmpty,
    organisation: DatasetOrganisationSchema,
    anchorEvent: DatasetAnchorEventSchema,
    places: z.array(DatasetPlaceSchema).default([]),
    ruleSets: z.array(DatasetRuleSetSchema).default([]),
  }),
  importDraft: z.looseObject({
    id: NonEmpty,
    anchorEventId: NonEmpty,
    channel: NonEmpty.optional(),
    sourceId: NonEmpty,
    receivedAt: NonEmpty,
    travellers: z.array(DatasetTravellerSchema).default([]),
    unresolvedStatements: z.array(z.string()).default([]),
  }),
});
export type DatasetProgramme = z.infer<typeof DatasetProgrammeSchema>;

/**
 * Ground-transfer durations between two places. Registered as generic
 * `transfer_minutes` constraints, which is what the reachability reasoning
 * reads; absence stays UNKNOWN rather than becoming an assumed duration.
 */
export const DatasetGroundTransfersSchema = z.looseObject({
  sourceIds: z.array(NonEmpty).default([]),
  estimates: z.array(z.looseObject({
    from: NonEmpty,
    to: NonEmpty,
    mode: NonEmpty.optional(),
    estimate: z.looseObject({
      expectedMinutes: z.number().int().positive().optional(),
      minimumMinutes: z.number().int().positive().optional(),
      conservativeMinutes: z.number().int().positive().optional(),
      sourceId: NonEmpty.optional(),
      observedAt: NonEmpty.optional(),
      quality: NonEmpty.optional(),
    }),
  })).default([]),
});
export type DatasetGroundTransfers = z.infer<typeof DatasetGroundTransfersSchema>;

/**
 * Place -> jurisdiction attribution plus the dataset's own declaration of
 * what advisory / entry knowledge it covers. Both are source facts, not
 * verdicts: the evaluators still compute every dimension from them.
 */
export const DatasetJurisdictionsSchema = z.looseObject({
  sourceId: NonEmpty,
  observedAt: NonEmpty,
  validFrom: NonEmpty,
  coverage: z.looseObject({
    edition: NonEmpty,
    queryBoundsVersion: NonEmpty,
    completeness: z.enum(['COMPLETE', 'INCOMPLETE', 'UNKNOWN', 'UNSUPPORTED_CATEGORY', 'SOURCE_UNAVAILABLE']),
    completenessLimitations: z.array(NonEmpty).default([]),
    expiresAt: NonEmpty.optional(),
    topics: z.array(NonEmpty).min(1),
  }).optional(),
  jurisdictions: z.array(z.looseObject({
    id: NonEmpty,
    name: NonEmpty,
    regimeKind: z.enum(['COUNTRY', 'SUPRANATIONAL', 'SUBNATIONAL']),
    area: z.looseObject({
      id: NonEmpty,
      name: NonEmpty,
      areaType: NonEmpty,
      /** `[west, south, east, north]` degrees, WGS84. */
      boundingBoxes: z.array(z.tuple([z.number(), z.number(), z.number(), z.number()])).min(1),
    }),
    placeIds: z.array(NonEmpty).default([]),
  })).default([]),
});
export type DatasetJurisdictions = z.infer<typeof DatasetJurisdictionsSchema>;

/**
 * Optional organiser-declared Journey requirement facts. These are source
 * policy statements, not evaluator verdicts or discovered legal requirements.
 */
const DatasetJourneyItemSourceRefSchema = z.strictObject({
  system: z.literal('journey-item'),
  value: NonEmpty,
});
export type DatasetJourneyItemSourceRef = z.infer<typeof DatasetJourneyItemSourceRefSchema>;

export const DatasetStayArrivalDateAlignedRequirementSchema = z.strictObject({
  id: NonEmpty,
  travellerDraftId: NonEmpty,
  kind: z.literal('STAY_ARRIVAL_DATE_ALIGNED'),
  originalStayItemRef: DatasetJourneyItemSourceRefSchema,
  arrivalTransportItemRef: DatasetJourneyItemSourceRefSchema,
});
export type DatasetStayArrivalDateAlignedRequirement = z.infer<typeof DatasetStayArrivalDateAlignedRequirementSchema>;

export const DatasetJourneyRequirementSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    id: NonEmpty,
    travellerDraftId: NonEmpty,
    kind: z.literal('OVERNIGHT_ACCOMMODATION'),
    minimumGapHours: z.number().finite().positive(),
  }),
  DatasetStayArrivalDateAlignedRequirementSchema,
]);
export type DatasetJourneyRequirement = z.infer<typeof DatasetJourneyRequirementSchema>;

export const DatasetJourneyRequirementsSchema = z.strictObject({
  sourceId: NonEmpty,
  observedAt: z.iso.datetime({ offset: true }),
  requirements: z.array(DatasetJourneyRequirementSchema).superRefine((requirements, context) => {
    const ids = new Set<string>();
    for (const requirement of requirements) {
      if (ids.has(requirement.id)) {
        context.addIssue({ code: 'custom', message: `duplicate journey requirement id ${requirement.id}` });
      }
      ids.add(requirement.id);
    }
  }),
});
export type DatasetJourneyRequirements = z.infer<typeof DatasetJourneyRequirementsSchema>;

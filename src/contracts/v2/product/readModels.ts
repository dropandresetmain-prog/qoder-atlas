/**
 * M9 product read-model contracts — presentation-safe projections.
 * UI must not reconstruct business logic from raw tables.
 */
import { z } from 'zod';

export const ProductOperationalStatusSchema = z.enum([
  'READY',
  'AT_RISK',
  'DISRUPTED',
  'RECOVERING',
  'UNKNOWN',
]);
export type ProductOperationalStatus = z.infer<typeof ProductOperationalStatusSchema>;

export const RemainderViabilitySchema = z.enum(['VIABLE', 'AT_RISK', 'NOT_VIABLE', 'UNKNOWN']);
export type RemainderViability = z.infer<typeof RemainderViabilitySchema>;

export const AssessmentToneSchema = z.enum(['PASS', 'FAIL', 'UNKNOWN']);
export type AssessmentTone = z.infer<typeof AssessmentToneSchema>;

export const LdgSemanticStateSchema = z.enum([
  'HEALTHY',
  'CHANGED',
  'AFFECTED',
  'FAILED',
  'PROPOSED',
  'ACTIVE',
  'UNKNOWN',
  'RECOVERED',
]);
export type LdgSemanticState = z.infer<typeof LdgSemanticStateSchema>;

export const LdgNodeKindSchema = z.enum([
  'DISRUPTION',
  'SERVICE_BOOKING',
  'TRAVELLER',
  'TIMING',
  'TRANSFER_STAY',
  'PROGRAMME_COMMITMENT',
  'RECOVERY_PROPOSAL',
]);
export type LdgNodeKind = z.infer<typeof LdgNodeKindSchema>;

export const LdgEdgeKindSchema = z.enum([
  'AFFECTED_BY',
  'RELIES_ON',
  'MUST_HAPPEN_BEFORE',
  'PARTICIPATES_IN',
  'PROPOSED_CHANGE',
]);
export type LdgEdgeKind = z.infer<typeof LdgEdgeKindSchema>;

/** Deterministic change-awareness metadata for truthful settle transitions. */
export const ChangeAwarenessSchema = z.strictObject({
  projectionRevision: z.number().int().min(0),
  changedVisibleRefs: z.array(z.string().min(1)),
  previousSemanticState: LdgSemanticStateSchema.optional(),
  currentSemanticState: LdgSemanticStateSchema,
  changedAt: z.string().datetime({ offset: true }).optional(),
  changeSource: z.string().min(1).optional(),
});
export type ChangeAwareness = z.infer<typeof ChangeAwarenessSchema>;

export const LdgNodeSchema = z.strictObject({
  ref: z.string().min(1),
  kind: LdgNodeKindSchema,
  label: z.string().min(1),
  semanticState: LdgSemanticStateSchema,
  /** Authoritative vs proposed presentation — UI must not invent this. */
  authority: z.enum(['AUTHORITATIVE', 'PROPOSED']),
  detail: z.string().max(2048).optional(),
});
export type LdgNode = z.infer<typeof LdgNodeSchema>;

export const LdgEdgeSchema = z.strictObject({
  fromRef: z.string().min(1),
  toRef: z.string().min(1),
  kind: LdgEdgeKindSchema,
  semanticState: LdgSemanticStateSchema.optional(),
});
export type LdgEdge = z.infer<typeof LdgEdgeSchema>;

export const LiveDependencyGraphSchema = z.strictObject({
  scope: z.enum(['DASHBOARD', 'INCIDENT_PROGRAMME', 'FOCUSED_CASE']),
  nodes: z.array(LdgNodeSchema),
  edges: z.array(LdgEdgeSchema),
  change: ChangeAwarenessSchema,
});
export type LiveDependencyGraph = z.infer<typeof LiveDependencyGraphSchema>;

export const OperatorOverviewItemSchema = z.strictObject({
  tripRef: z.string().min(1),
  travellerLabel: z.string().min(1),
  status: ProductOperationalStatusSchema,
  remainderViability: RemainderViabilitySchema,
  incidentRef: z.string().min(1).optional(),
  caseRef: z.string().min(1).optional(),
  whatChanged: z.string().max(2048).optional(),
  affectedPeople: z.array(z.string()),
  affectedItems: z.array(z.string()),
  recoveryActivity: z.string().max(2048).optional(),
  decisionRequired: z.boolean(),
  unresolvedUncertainty: z.array(z.string()),
});
export type OperatorOverviewItem = z.infer<typeof OperatorOverviewItemSchema>;

export const OperatorOverviewSchema = z.strictObject({
  generatedAt: z.string().datetime({ offset: true }),
  items: z.array(OperatorOverviewItemSchema),
  summary: z.strictObject({
    ready: z.number().int().min(0),
    atRisk: z.number().int().min(0),
    disrupted: z.number().int().min(0),
    recovering: z.number().int().min(0),
    unknown: z.number().int().min(0),
  }),
  ldg: LiveDependencyGraphSchema,
  change: ChangeAwarenessSchema,
});
export type OperatorOverview = z.infer<typeof OperatorOverviewSchema>;

export const IncidentProgrammeViewSchema = z.strictObject({
  generatedAt: z.string().datetime({ offset: true }),
  incidentRef: z.string().min(1),
  sourceChangeSummary: z.string().min(1),
  affectedSet: z.array(z.strictObject({
    personLabel: z.string(),
    tripRef: z.string(),
    outcome: AssessmentToneSchema,
    remainderViability: RemainderViabilitySchema,
  })),
  programmeCommitments: z.array(z.strictObject({
    itemRef: z.string(),
    label: z.string(),
    windowLabel: z.string().optional(),
    state: LdgSemanticStateSchema,
  })),
  currentProgrammeState: z.string().max(4096).optional(),
  proposedProgrammeState: z.string().max(4096).optional(),
  ldg: LiveDependencyGraphSchema,
  change: ChangeAwarenessSchema,
});
export type IncidentProgrammeView = z.infer<typeof IncidentProgrammeViewSchema>;

export const RecoveryCaseViewSchema = z.strictObject({
  generatedAt: z.string().datetime({ offset: true }),
  caseRef: z.string().min(1),
  status: z.enum([
    'OPEN', 'PLANNING', 'AWAITING_AUTHORITY', 'EXECUTING', 'RESOLVED', 'CLOSED', 'CANCELLED', 'SUPERSEDED',
  ]),
  changeSummary: z.string().min(1),
  /** Booking/service state — independent of whole-trip viability. */
  bookingServiceState: z.strictObject({
    label: z.string(),
    state: LdgSemanticStateSchema,
    detail: z.string().optional(),
  }),
  /** Whole journey/trip viability. */
  tripViability: z.strictObject({
    label: z.string(),
    verdict: AssessmentToneSchema,
    detail: z.string().optional(),
  }),
  affectedItems: z.array(z.string()),
  criticalCommitment: z.string().optional(),
  causalFailureReason: z.string().optional(),
  requirementVsActual: z.strictObject({
    requirement: z.string(),
    actual: z.string(),
  }).optional(),
  strategies: z.array(z.strictObject({
    strategyRef: z.string(),
    version: z.number().int().min(1),
    viability: z.string(),
    status: z.string(),
    projectedPeople: z.array(z.strictObject({
      personLabel: z.string(),
      verdict: AssessmentToneSchema,
    })),
  })),
  authorityState: z.string(),
  executionState: z.string(),
  reconciliationState: z.string(),
  uncertainty: z.array(z.string()),
  resolutionSummary: z.string().optional(),
  ldg: LiveDependencyGraphSchema,
  change: ChangeAwarenessSchema,
});
export type RecoveryCaseView = z.infer<typeof RecoveryCaseViewSchema>;

export const TravellerTripViewSchema = z.strictObject({
  generatedAt: z.string().datetime({ offset: true }),
  tripRef: z.string().min(1),
  amIOkay: z.enum(['YES', 'NO', 'UNKNOWN']),
  whatChanged: z.string().optional(),
  whatMattersNow: z.string().optional(),
  whatNorthstarIsDoing: z.string().optional(),
  whatDoYouNeedFromMe: z.string().optional(),
  doesTheRestWork: RemainderViabilitySchema,
  whatChangedAfterRecovery: z.string().optional(),
  change: ChangeAwarenessSchema,
});
export type TravellerTripView = z.infer<typeof TravellerTripViewSchema>;

export const ApplicationErrorCodeSchema = z.enum([
  'LOADING',
  'READ_UNAVAILABLE',
  'PLANNER_UNAVAILABLE',
  'PROVIDER_INFO_UNAVAILABLE',
  'NO_VIABLE_RECOVERY',
  'UNKNOWN_VIABILITY',
  'APPROVAL_PENDING',
  'APPROVAL_REJECTED',
  'EXECUTION_FAILED',
  'OUTCOME_UNKNOWN',
  'RECONCILING',
  'ACTION_SUCCEEDED_TRIP_INVALID',
  'OBJECTIVE_DISPOSITION_FORBIDDEN',
  'GRANT_SCOPE_INSUFFICIENT',
  'RESOLUTION_DENIED',
]);
export type ApplicationErrorCode = z.infer<typeof ApplicationErrorCodeSchema>;

export const ApplicationErrorSchema = z.strictObject({
  code: ApplicationErrorCodeSchema,
  message: z.string().min(1),
  /** Read/API failures never mutate trip state. */
  mutatesState: z.literal(false),
});
export type ApplicationError = z.infer<typeof ApplicationErrorSchema>;

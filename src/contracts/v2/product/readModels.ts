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

/**
 * Mirrors `AssessmentViewStatus` in
 * `src/persistence/postgres/world/pgAssessments.ts` — the assessment
 * lifecycle (never domain viability/health), shared here so the frontend
 * boundary (`src/ui/**`, which must not import `src/persistence`) can present
 * it without inventing its own copy (FIG-7).
 */
export const AssessmentViewStatusSchema = z.enum([
  'CURRENT',
  'STALE',
  'PENDING_REASSESSMENT',
  'UNAVAILABLE',
  'NONE',
]);
export type AssessmentViewStatus = z.infer<typeof AssessmentViewStatusSchema>;

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
  /** Edge ids (FIG-1) whose presented fields differ from the compared revision (FIG-2/3). */
  changedEdgeIds: z.array(z.string().min(1)),
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
  /** Escalation marker (FIG-4): the case this subject is linked to, if any. Never identity. */
  caseRef: z.string().min(1).optional(),
  /**
   * Assessment lifecycle (FIG-7), non-domain. Omitted for nodes that are not
   * assessed subjects (case, disruption). Never used to signal evaluation via
   * semanticState/changeState/tone.
   */
  evaluation: AssessmentViewStatusSchema.optional(),
  detail: z.string().max(2048).optional(),
});
export type LdgNode = z.infer<typeof LdgNodeSchema>;

export const LdgEdgeSchema = z.strictObject({
  /** Producer-owned, unique within a graph, stable across revisions (FIG-1). Never array position. */
  id: z.string().min(1),
  fromRef: z.string().min(1),
  toRef: z.string().min(1),
  kind: LdgEdgeKindSchema,
  semanticState: LdgSemanticStateSchema.optional(),
  /** Authoritative vs proposed — from backend evidence only, never inferred (FIG-2). */
  authority: z.enum(['AUTHORITATIVE', 'PROPOSED']),
});
export type LdgEdge = z.infer<typeof LdgEdgeSchema>;

export const LiveDependencyGraphSchema = z.strictObject({
  scope: z.enum(['DASHBOARD', 'INCIDENT_PROGRAMME', 'FOCUSED_CASE']),
  nodes: z.array(LdgNodeSchema),
  edges: z.array(LdgEdgeSchema),
  change: ChangeAwarenessSchema,
}).superRefine((graph, ctx) => {
  const seen = new Set<string>();
  for (const edge of graph.edges) {
    if (seen.has(edge.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate LdgEdge id: ${edge.id}`, path: ['edges'] });
      return;
    }
    seen.add(edge.id);
  }
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
  /** Assessment lifecycle (FIG-7), non-domain. Never fabricated. */
  evaluation: AssessmentViewStatusSchema.optional(),
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

/** Progressive connection / disruption presentation (generic — not scenario-named). */
export const ConnectionProgressionSchema = z.enum([
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
]);
export type ConnectionProgression = z.infer<typeof ConnectionProgressionSchema>;

export const RecoveryActionExecutionStateSchema = z.enum([
  'PROPOSED',
  'AUTHORIZED',
  'REJECTED',
  'SUPERSEDED',
  'EXECUTING',
  'COMPLETED',
  'FAILED',
  'PENDING',
  'RECONCILING',
  'OUTCOME_UNKNOWN',
]);
export type RecoveryActionExecutionState = z.infer<typeof RecoveryActionExecutionStateSchema>;

/** One ActionIntent projection — same-domain actions must not collapse. */
export const RecoveryActionViewSchema = z.strictObject({
  actionRef: z.string().min(1),
  domain: z.string().min(1),
  capability: z.string().min(1),
  subjectRefs: z.array(z.string().min(1)).default([]),
  cost: z.strictObject({
    amount: z.string().min(1),
    currency: z.string().length(3),
  }).optional(),
  authorityState: z.string().min(1),
  approvalState: z.string().min(1).optional(),
  dependencyOrder: z.number().int().min(0),
  dependsOnActionRefs: z.array(z.string().min(1)).default([]),
  executionState: RecoveryActionExecutionStateSchema,
  observationResult: z.string().min(1).optional(),
  uncertainty: z.array(z.string()).default([]),
});
export type RecoveryActionView = z.infer<typeof RecoveryActionViewSchema>;

export const PartialRecoveryViewSchema = z.strictObject({
  succeeded: z.array(z.string().min(1)),
  failed: z.array(z.string().min(1)),
  pending: z.array(z.string().min(1)),
});
export type PartialRecoveryView = z.infer<typeof PartialRecoveryViewSchema>;

/** Replacement CONFIRMED + displaced cancel FAILED/UNKNOWN → incomplete recovery. */
export const DuplicateBookingExposureViewSchema = z.strictObject({
  replacementActionRef: z.string().min(1),
  displacedActionRef: z.string().min(1).optional(),
  displacedSubjectRef: z.string().min(1),
  replacementObservation: z.string().min(1),
  displacedCancellationObservation: z.string().min(1),
  detail: z.string().max(2048).optional(),
});
export type DuplicateBookingExposureView = z.infer<typeof DuplicateBookingExposureViewSchema>;

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
  /** Optional progressive connection presentation aid (CK2). */
  connectionProgression: ConnectionProgressionSchema.optional(),
  /** Per-ActionIntent projections — multiple stay/hotel actions allowed. */
  recoveryActions: z.array(RecoveryActionViewSchema).default([]),
  aggregateRecoveryCost: z.strictObject({
    amount: z.string().min(1),
    currency: z.string().length(3),
  }).optional(),
  remainingRecoveryWork: z.array(z.string().min(1)).default([]),
  partialRecovery: PartialRecoveryViewSchema.optional(),
  duplicateBookingExposure: z.array(DuplicateBookingExposureViewSchema).default([]),
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

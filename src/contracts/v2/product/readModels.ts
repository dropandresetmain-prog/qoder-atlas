/**
 * M9 product read-model contracts — presentation-safe projections.
 * UI must not reconstruct business logic from raw tables.
 */
import { z } from 'zod';
import { MaterialCandidateProposalSchema, PlanningSourceLinkSchema } from '../planning/recoveryPlanningAttempt.ts';

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
  /** Presentation of an existing canonical Objective; never a new domain entity. */
  'TRIP_OBJECTIVE',
  /** Kept for immutable pre-A1 Original snapshots; current focused projection no longer emits it. */
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
  /**
   * Node refs the producer reports as changed since the caller's `sinceCursor`
   * — an at-least-once hint for transition/emphasis, never an exact
   * transactional diff. A ref already seen may be reported again; a ref that
   * really changed is never silently omitted. Absence is not proof of
   * unchanged: a client applies every complete snapshot it receives and reads
   * a node's actual presented fields for truth.
   */
  changedVisibleRefs: z.array(z.string().min(1)),
  /** Edge ids (FIG-1) whose presented fields differ from the compared revision (FIG-2/3). */
  changedEdgeIds: z.array(z.string().min(1)),
  previousSemanticState: LdgSemanticStateSchema.optional(),
  currentSemanticState: LdgSemanticStateSchema,
  changedAt: z.string().datetime({ offset: true }).optional(),
  changeSource: z.string().min(1).optional(),
  /**
   * Opaque at-least-once change cursor (xid8-derived), to be echoed back as
   * `sinceCursor` on the next read. Present only on projections backed by the
   * PostgreSQL snapshot-xmin mechanism (case/overview/incident-programme/
   * dashboard); omitted on pure/count-based producers (cohort, traveller
   * trip), which have no durable revision source to draw one from. Carried as
   * a string so the 64-bit xid8 value is never coerced through a JS number.
   * Equal `projectionRevision` values do NOT prove nothing changed, and
   * neither does an empty changed set: a changed set compared against a
   * previously returned `changeCursor` is an at-least-once hint, so a client
   * applies every complete snapshot it receives and uses the changed set only
   * to decide what to emphasise.
   */
  changeCursor: z.string().min(1).optional(),
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
  /**
   * Canonical subject refs represented by this presentation node. They let the
   * backend map an evaluator explanation onto a visual object without asking
   * the browser to traverse or infer graph meaning.
   */
  subjectRefs: z.array(z.string().min(1)).max(16).optional(),
  /**
   * Canonical timing facts for a TIMING presentation node. The renderer may
   * format them but must not calculate lateness or a semantic condition.
   */
  timing: z.strictObject({
    currentAt: z.string().datetime({ offset: true }),
    publishedAt: z.string().datetime({ offset: true }).optional(),
    timeZone: z.string().min(1).optional(),
  }).optional(),
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

/**
 * One recovery option as the operator reads it.
 *
 * The persisted `RecoveryStrategy` is a domain/evaluation record: it stores
 * `subjectRef` / `assessmentId` / `overallVerdict` per assessed subject and
 * keeps its proposed effects in `strategy_changes`. It deliberately carries
 * no display names — so this view resolves human identity from authoritative
 * canonical state instead, and explains the option from the strategy's own
 * stored effects. Nothing here is generated prose; every field is a
 * projection of persisted data.
 */
export const RecoveryStrategyChangeViewSchema = z.strictObject({
  /** The persisted ScenarioChange effect kind, verbatim. */
  effectKind: z.string().min(1),
  /** Typed ref of the subject the effect changes, e.g. `PROGRAMME_ITEM:<id>`. */
  subjectRef: z.string().min(1),
  /**
   * The subject's authoritative title. Falls back to `subjectRef` when
   * canonical state has no title for it — never an invented name.
   */
  subjectLabel: z.string().min(1),
  /** Canonical programme item's IANA zone, or UTC when no zone is available. */
  timeZone: z.string().min(1).optional(),
  /** Canonical window before the change, when the subject has one. */
  currentWindow: z.strictObject({ start: z.string().min(1), end: z.string().min(1) }).optional(),
  /** Window this option proposes, when the effect carries one. */
  proposedWindow: z.strictObject({ start: z.string().min(1), end: z.string().min(1) }).optional(),
  /** Current cancellation loss when the effect is CANCEL_STAY. */
  cancellationPenalty: z.strictObject({ amount: z.string().min(1), currency: z.string().length(3) }).optional(),
  /** Free-cancellation window end when current loss is zero only until then. */
  freeCancellationUntil: z.iso.datetime({ offset: true }).optional(),
  /** Provider-stated penalty after the free window; not current loss. */
  scheduledCancellationPenalty: z.strictObject({ amount: z.string().min(1), currency: z.string().length(3) }).optional(),
});
export type RecoveryStrategyChangeView = z.infer<typeof RecoveryStrategyChangeViewSchema>;

/** A subject this option was assessed against, with its resolved identity. */
export const RecoveryStrategySubjectViewSchema = z.strictObject({
  subjectRef: z.string().min(1),
  /**
   * Authoritative traveller display name when the subject is a Journey whose
   * traveller is known; otherwise the typed ref itself. Never `Traveller`.
   */
  personLabel: z.string().min(1),
  /** The verdict this option projects — the persisted `overallVerdict`. */
  verdict: AssessmentToneSchema,
});
export type RecoveryStrategySubjectView = z.infer<typeof RecoveryStrategySubjectViewSchema>;

export const RecoveryStrategyViewSchema = z.strictObject({
  strategyRef: z.string(),
  version: z.number().int().min(1),
  viability: z.string(),
  status: z.string(),
  /** Stable 1-based option number within this case, ascending by version. */
  optionNumber: z.number().int().min(1),
  /** What this option changes, from its own persisted effects. */
  changes: z.array(RecoveryStrategyChangeViewSchema).default([]),
  /**
   * The case subjects that are currently blocking, and the verdict this
   * option projects for them. This is "who the option fixes".
   */
  resolves: z.array(z.strictObject({
    subjectRef: z.string().min(1),
    personLabel: z.string().min(1),
    currentVerdict: AssessmentToneSchema,
    projectedVerdict: AssessmentToneSchema,
  })).default([]),
  /** Counts over every subject the option was assessed against. */
  projectedSummary: z.strictObject({
    total: z.number().int().min(0),
    pass: z.number().int().min(0),
    fail: z.number().int().min(0),
    unknown: z.number().int().min(0),
  }).default({ total: 0, pass: 0, fail: 0, unknown: 0 }),
  /** Every assessed subject, as persisted. Complete, and usually large. */
  projectedPeople: z.array(RecoveryStrategySubjectViewSchema),
  /**
   * R4-F2: present when this viable option cannot genuinely be EXECUTED by this
   * runtime (provider execution not composed, protected booking inputs or budget
   * missing). Surfaces must not offer such an option as an executable Recover;
   * `message` is the explicit reason. Absent for options that can run.
   */
  executionBlocker: z.strictObject({ code: z.string().min(1), message: z.string().min(1) }).optional(),
});
export type RecoveryStrategyView = z.infer<typeof RecoveryStrategyViewSchema>;

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

/**
 * One in-scope subject of the operator's world, present whether or not a
 * RecoveryCase exists for it.
 *
 * `items` answers "what needs me right now" and is case-driven, so it is
 * legitimately empty in a healthy world. That made the baseline product
 * surface look like it had no world at all. This collection answers the
 * different, prior question — "whose travel am I responsible for" — and is
 * therefore additive rather than a replacement: nothing about `items` or
 * `summary` changes.
 *
 * Every field is an authoritative backend value. `status` and
 * `remainderViability` use the same product vocabulary as `items`, and
 * `evaluation` carries the assessment lifecycle, so a subject with no
 * assessment yet reads as `UNKNOWN` + `NONE` instead of being presented as
 * healthy or hidden.
 */
export const OperatorPopulationEntrySchema = z.strictObject({
  journeyRef: z.string().min(1),
  tripRef: z.string().min(1),
  travellerLabel: z.string().min(1),
  /** Strongest accepted programme obligation this subject holds. */
  obligation: z.enum(['REQUIRED', 'OPTIONAL', 'INFORMED']),
  status: ProductOperationalStatusSchema,
  remainderViability: RemainderViabilitySchema,
  evaluation: AssessmentViewStatusSchema,
  /** Escalation marker when a case already covers this subject. Never identity. */
  caseRef: z.string().min(1).optional(),
});
export type OperatorPopulationEntry = z.infer<typeof OperatorPopulationEntrySchema>;

/**
 * Bounded Event Overview projection (V7.2 contract, docs/design/event-overview-graph).
 *
 * Everything the Overview graph draws AND everything the browser must not
 * infer is supplied here: programme days/landmarks, shared-dependency
 * concentration, traveller cohorts, promoted travellers, blast-radius
 * membership (cleared vs unresolved) and the routing case. Every collection is
 * capped; the projection is curated, never a dump of the topology. Health is
 * the producer's verdict (GREEN functioning, AMBER changed/being checked, RED
 * cannot be satisfied, NEUTRAL context) — the renderer maps it to colour and
 * motion only.
 */
export const EventOverviewHealthSchema = z.enum(['GREEN', 'AMBER', 'RED', 'NEUTRAL']);
export type EventOverviewHealth = z.infer<typeof EventOverviewHealthSchema>;

export const EventOverviewMembershipSchema = z.enum(['CLEARED', 'CHECKING', 'UNRESOLVED', 'ATTENTION']);
export type EventOverviewMembership = z.infer<typeof EventOverviewMembershipSchema>;

export const EventOverviewRelationKindSchema = z.enum([
  'DEPENDENCY_TO_COMMITMENT',
  'DEPENDENCY_TO_TRAVELLER',
  'TRAVELLER_TO_COMMITMENT',
  'COHORT_TO_COMMITMENT',
]);
export type EventOverviewRelationKind = z.infer<typeof EventOverviewRelationKindSchema>;

export const EventOverviewSchema = z.strictObject({
  /** Programme territories, ascending. `index` is 1-based and dense. */
  days: z.array(z.strictObject({
    index: z.number().int().min(1),
    localDate: z.string().min(1),
    dateLabel: z.string().min(1),
  })).max(14),
  /** Major programme commitments only (bounded per day). */
  landmarks: z.array(z.strictObject({
    ref: z.string().min(1),
    dayIndex: z.number().int().min(1),
    title: z.string().min(1),
    timeLabel: z.string().min(1).optional(),
    health: EventOverviewHealthSchema,
    participantCount: z.number().int().min(0),
    /** Participants of this commitment currently in the blast radius or disrupted. */
    affectedCount: z.number().int().min(0),
  })).max(42),
  /** Shared service dependencies that concentrate several travellers. */
  dependencies: z.array(z.strictObject({
    ref: z.string().min(1),
    kindLabel: z.string().min(1),
    label: z.string().min(1),
    detailLabel: z.string().min(1).optional(),
    dayIndex: z.number().int().min(1).optional(),
    health: EventOverviewHealthSchema,
    /** True when the service's authoritative timing differs from what was published. */
    changed: z.boolean(),
    travellerCount: z.number().int().min(0),
    clearedCount: z.number().int().min(0),
    checkingCount: z.number().int().min(0),
    unresolvedCount: z.number().int().min(0),
    /** The landmark this dependency materially feeds, when one is in the projection. */
    feedsLandmarkRef: z.string().min(1).optional(),
  })).max(12),
  /** Compressed population by programme day, or a date-free unassigned cohort. */
  cohorts: z.array(z.strictObject({
    ref: z.string().min(1),
    dayIndex: z.number().int().min(1).optional(),
    label: z.string().min(1),
    total: z.number().int().min(0),
    ready: z.number().int().min(0),
    unknown: z.number().int().min(0),
    attention: z.number().int().min(0),
    landmarkRef: z.string().min(1).optional(),
  })).max(15),
  /** Travellers promoted out of their cohort by current operational importance. */
  promotedTravellers: z.array(z.strictObject({
    journeyRef: z.string().min(1),
    label: z.string().min(1),
    roleLabel: z.string().min(1),
    status: ProductOperationalStatusSchema,
    membership: EventOverviewMembershipSchema,
    dependencyRef: z.string().min(1).optional(),
    landmarkRef: z.string().min(1).optional(),
    caseRef: z.string().min(1).optional(),
  })).max(16),
  /** Travellers eligible for promotion beyond the cap; they stay in their cohort. */
  promotedOverflow: z.number().int().min(0),
  /** The active shared change, when one exists. */
  blastRadius: z.strictObject({
    dependencyRef: z.string().min(1),
    affectedCount: z.number().int().min(0),
    clearedCount: z.number().int().min(0),
    checkingCount: z.number().int().min(0),
    unresolvedCount: z.number().int().min(0),
    landmarkRefs: z.array(z.string().min(1)).max(12),
  }).optional(),
  /** Optional for historical projections; current producers supply explicit relation truth. */
  relations: z.array(z.strictObject({
    id: z.string().min(1),
    kind: EventOverviewRelationKindSchema,
    fromRef: z.string().min(1),
    toRef: z.string().min(1),
    health: EventOverviewHealthSchema,
  })).max(256).optional(),
});
export type EventOverview = z.infer<typeof EventOverviewSchema>;

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
  /** The in-scope subject population; see OperatorPopulationEntrySchema. */
  population: z.array(OperatorPopulationEntrySchema),
  /** Counts over `population`, not over `items`. */
  populationSummary: z.strictObject({
    total: z.number().int().min(0),
    ready: z.number().int().min(0),
    atRisk: z.number().int().min(0),
    disrupted: z.number().int().min(0),
    recovering: z.number().int().min(0),
    unknown: z.number().int().min(0),
    /** Subjects holding no current assessment — honest, not counted as ready. */
    notAssessed: z.number().int().min(0),
  }),
  /**
   * Aggregate assessment lifecycle over `population` (FIG-7).
   *
   * `RECONCILING` means at least one in-scope subject currently reports
   * `PENDING_REASSESSMENT` — open scheduled reassessment work, not a guessed
   * timer. Presentation may hold the last SETTLED snapshot while this is
   * RECONCILING; it must not invent readiness, blast radius or affected set.
   */
  populationAssessmentLifecycle: z.strictObject({
    state: z.enum(['SETTLED', 'RECONCILING']),
    /** Subjects whose evaluation is currently PENDING_REASSESSMENT. */
    pendingCount: z.number().int().min(0),
  }),
  /** The event the operator is working, when the workspace holds one. */
  eventContext: z.strictObject({
    eventRef: z.string().min(1),
    title: z.string().min(1),
    organiserLabel: z.string().min(1).optional(),
    programmeRef: z.string().min(1).optional(),
  }).optional(),
  /** Bounded curated projection for the Event Overview graph; see EventOverviewSchema. */
  eventOverview: EventOverviewSchema.optional(),
  ldg: LiveDependencyGraphSchema,
  change: ChangeAwarenessSchema,
  /** Demo ingress configuration flags */
  demoIngress: z.strictObject({
    airlineRebookingConfigured: z.boolean(),
  }).optional(),
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

/**
 * T3 — the authoritative cause of a case: the change signal (migration 0124)
 * whose consequence produced the escalating assessment. Absent when the case
 * was opened without a signal (e.g. a baseline failure or a manual open).
 */
export const CaseCauseViewSchema = z.strictObject({
  changeSignalRef: z.string().min(1),
  originKind: z.string().min(1),
  changeType: z.string().min(1),
  receivedAt: z.string().datetime({ offset: true }),
  /** Whether the signal's application completed (all consequential commands committed). */
  applied: z.boolean(),
});
export type CaseCauseView = z.infer<typeof CaseCauseViewSchema>;

/**
 * T3 — one step of the deterministic causal path behind a failing subject:
 * the evaluator's own typed explanation (dimension, registered reason code,
 * facts), never prose parsed by a frontend. Ordered as the evaluator
 * reported it; the first entry is the first operational breakpoint.
 */
export const CausalPathStepSchema = z.strictObject({
  subjectRef: z.string().min(1),
  /** Canonical cause from the persisted evaluator explanation, when one exists. */
  causeSubjectRef: z.string().min(1).optional(),
  dimension: z.string().min(1),
  reasonCode: z.string().min(1),
  evaluatorId: z.string().min(1),
  facts: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  relatedSubjectRefs: z.array(z.string().min(1)).default([]),
});
export type CausalPathStep = z.infer<typeof CausalPathStepSchema>;

/**
 * C9 — a human-label-primary presentation of one decision-time fact, with the
 * typed ref / closed-vocab code kept as SECONDARY metadata (freeze §12: "human
 * labels plus typed refs as secondary metadata"; line 529: "Internal
 * UUIDs/capability codes are never the primary product explanation"). `label`
 * is always present and human-readable; `ref`/`code` are optional and machine.
 */
export const PlanningEvidenceLabelSchema = z.strictObject({
  /** Human-readable explanation — PRIMARY. Never an internal UUID. */
  label: z.string().min(1),
  /** Typed subject/strategy ref — SECONDARY. */
  ref: z.string().min(1).optional(),
  /** Closed-vocabulary code — SECONDARY. */
  code: z.string().min(1).optional(),
});
export type PlanningEvidenceLabel = z.infer<typeof PlanningEvidenceLabelSchema>;

/** C9 Q4 — one recovery domain NORTHSTAR investigated (or did not), and why. */
export const PlanningDomainEvidenceViewSchema = z.strictObject({
  domain: PlanningEvidenceLabelSchema,
  disposition: PlanningEvidenceLabelSchema,
  /** Human-readable reason derived from the domain's closed reason code. */
  reason: z.string().min(1).optional(),
});
export type PlanningDomainEvidenceView = z.infer<typeof PlanningDomainEvidenceViewSchema>;

/** C9 Q5 — one read-only tool/evidence result with provenance + uncertainty. */
export const PlanningToolEvidenceViewSchema = z.strictObject({
  tool: PlanningEvidenceLabelSchema,
  status: PlanningEvidenceLabelSchema,
  provenanceMode: PlanningEvidenceLabelSchema,
  /** Human provider label when the result carried one; never required. */
  provider: z.string().min(1).optional(),
  observedAt: z.string().datetime({ offset: true }).optional(),
  /** Bounded factual summary carried by the evidence record. */
  summary: z.string().min(1),
  uncertainties: z.array(z.string().min(1)).default([]),
  evidenceRef: z.string().min(1),
  sourceLinks: z.array(PlanningSourceLinkSchema).max(8).optional(),
});
export type PlanningToolEvidenceView = z.infer<typeof PlanningToolEvidenceViewSchema>;

/** C9 Q12 — one subject's decision-time baseline -> candidate movement. */
export const PlanningOutcomeDeltaViewSchema = z.strictObject({
  subject: PlanningEvidenceLabelSchema,
  direction: PlanningEvidenceLabelSchema,
  baseline: z.string().min(1).optional(),
  candidate: z.string().min(1),
});
export type PlanningOutcomeDeltaView = z.infer<typeof PlanningOutcomeDeltaViewSchema>;

/**
 * C9 Q10/Q11 — the three distinct impact semantics, kept separate (never
 * collapsed): what the proposal directly changes/affects versus the broader
 * closure RC-6 reassessed.
 */
export const PlanningBlastRadiusViewSchema = z.strictObject({
  changed: z.array(PlanningEvidenceLabelSchema).default([]),
  directlyAffected: z.array(PlanningEvidenceLabelSchema).default([]),
  reassessed: z.array(PlanningEvidenceLabelSchema).default([]),
});
export type PlanningBlastRadiusView = z.infer<typeof PlanningBlastRadiusViewSchema>;

/** Decision-time comparison evidence, kept separate from any booked amount. */
export const PlanningCostLineViewSchema = z.strictObject({
  kind: PlanningEvidenceLabelSchema,
  providerAmount: z.strictObject({ amount: z.string().min(1), currency: z.string().length(3) }),
  homeAmount: z.strictObject({ amount: z.string().min(1), currency: z.string().length(3) }),
  observed: z.boolean(),
});
export type PlanningCostLineView = z.infer<typeof PlanningCostLineViewSchema>;

export const PlanningFxEvidenceViewSchema = z.strictObject({
  source: PlanningEvidenceLabelSchema,
  baseCurrency: z.string().length(3),
  homeCurrency: z.string().length(3),
  rate: z.number().positive(),
  observedAt: z.string().datetime({ offset: true }),
  validUntil: z.string().datetime({ offset: true }).optional(),
});
export type PlanningFxEvidenceView = z.infer<typeof PlanningFxEvidenceViewSchema>;

/** An explicit cost comparison or the reason it could not be made. */
export const PlanningCostComparisonViewSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('AVAILABLE'),
    homeCurrency: z.string().length(3),
    totalHomeAmount: z.strictObject({ amount: z.string().min(1), currency: z.string().length(3) }),
    newSpendHomeAmount: z.strictObject({ amount: z.string().min(1), currency: z.string().length(3) }).optional(),
    potentialLossHomeAmount: z.strictObject({ amount: z.string().min(1), currency: z.string().length(3) }).optional(),
    creditHomeAmount: z.strictObject({ amount: z.string().min(1), currency: z.string().length(3) }).optional(),
    lines: z.array(PlanningCostLineViewSchema).default([]),
    selectedFxEvidence: z.array(PlanningFxEvidenceViewSchema).default([]),
    comparedAt: z.string().datetime({ offset: true }),
  }),
  z.strictObject({
    status: z.literal('UNAVAILABLE'),
    reason: z.string().min(1),
    comparedAt: z.string().datetime({ offset: true }),
  }),
]);
export type PlanningCostComparisonView = z.infer<typeof PlanningCostComparisonViewSchema>;

/** C9 Q6/Q7 — one material alternative considered, and its disposition/reasons. */
export const PlanningCandidateViewSchema = z.strictObject({
  candidateKey: z.string().min(1),
  domain: PlanningEvidenceLabelSchema,
  proposer: PlanningEvidenceLabelSchema,
  disposition: PlanningEvidenceLabelSchema,
  /** Present only when the candidate was promoted to a viable RecoveryStrategy. */
  strategyRef: z.string().min(1).optional(),
  /** Human-readable rejection / viability reasons (never the primary uuid). */
  reasons: z.array(z.string().min(1)).default([]),
  outcomeDelta: z.array(PlanningOutcomeDeltaViewSchema).default([]),
  blastRadius: PlanningBlastRadiusViewSchema.optional(),
  /** Present only when planning captured a comparison or its uncertainty. */
  costComparison: PlanningCostComparisonViewSchema.optional(),
  proposal: MaterialCandidateProposalSchema.optional(),
});
export type PlanningCandidateView = z.infer<typeof PlanningCandidateViewSchema>;

/** C9 Q9 — the recommended viable strategy and the human "why" behind it. */
export const PlanningRecommendationViewSchema = z.strictObject({
  recommended: PlanningEvidenceLabelSchema,
  alternatives: z.array(PlanningEvidenceLabelSchema).default([]),
  basis: z.array(z.strictObject({
    kind: PlanningEvidenceLabelSchema,
    summary: z.string().min(1),
  })).default([]),
  provenance: PlanningEvidenceLabelSchema,
});
export type PlanningRecommendationView = z.infer<typeof PlanningRecommendationViewSchema>;

/** Bounded model-call provenance captured with the planning attempt. */
export const PlanningModelActivityViewSchema = z.strictObject({
  operation: z.union([
    z.literal('recovery.domain_suggestion'),
    z.literal('recovery.offer_selection'),
  ]),
  providerId: z.string().min(1),
  model: z.string().min(1),
  mode: z.enum(['LIVE', 'REPLAY']),
  status: z.enum(['SUCCEEDED', 'FAILED']),
  observedAt: z.string().datetime({ offset: true }),
  latencyMs: z.number().int().nonnegative().optional(),
  errorCategory: z.enum([
    'NOT_CONFIGURED',
    'AUTH',
    'NETWORK',
    'TIMEOUT',
    'RATE_LIMITED',
    'PROVIDER_ERROR',
    'INVALID_OUTPUT',
    'UNAVAILABLE',
  ]).optional(),
});
export type PlanningModelActivityView = z.infer<typeof PlanningModelActivityViewSchema>;

/**
 * C9 — the planning-time decision-evidence block. `phase` is a hard literal and
 * `asOf` is the attempt's completion instant, so this evidence is VISIBLY
 * distinguishable from the current authoritative state presented elsewhere in
 * `RecoveryCaseView` (freeze §12 line 529). It answers Q4-Q12: domains
 * investigated, read-only tools/evidence + provenance, material alternatives and
 * their rejection reasons, the recommendation and its human basis, and the three
 * distinct impact projections. Q1-Q3 and Q13-Q17 are already answered by the
 * current-state fields of `RecoveryCaseView`.
 */
export const PlanningEvidenceViewSchema = z.strictObject({
  /** Decision-time discriminator — never current authoritative state. */
  phase: z.literal('DECISION_TIME'),
  /** When this planning attempt completed (its evidence horizon). */
  asOf: z.string().datetime({ offset: true }),
  attemptRef: z.string().min(1),
  coordinatorVersion: z.string().min(1),
  outcome: PlanningEvidenceLabelSchema,
  domains: z.array(PlanningDomainEvidenceViewSchema).default([]),
  tools: z.array(PlanningToolEvidenceViewSchema).default([]),
  modelActivities: z.array(PlanningModelActivityViewSchema).default([]),
  candidates: z.array(PlanningCandidateViewSchema).default([]),
  /**
   * Decision-time viable strategy refs (Q8). Their rich human detail (option
   * number, who they fix, cost) lives in the current-state `strategies[]` block;
   * these are the refs the attempt promoted, labeled so a uuid is never primary.
   */
  viableStrategies: z.array(PlanningEvidenceLabelSchema).default([]),
  recommendation: PlanningRecommendationViewSchema.optional(),
});
export type PlanningEvidenceView = z.infer<typeof PlanningEvidenceViewSchema>;

/**
 * R1 — durable human attention on a case (C8 ESCALATE). Orthogonal to `status`:
 * a case may be PLANNING and also need a person. Never implies approval or
 * resolution. Label/detail are user-safe presentation of the stable reason code.
 */
export const RecoveryCaseAttentionViewSchema = z.strictObject({
  attentionRef: z.string().min(1),
  reason: z.strictObject({ label: z.string().min(1), code: z.string().min(1) }),
  detail: z.string().min(1),
  status: z.strictObject({ label: z.string().min(1), code: z.enum(['OPEN', 'RESOLVED']) }),
  openedAt: z.string().datetime({ offset: true }),
  /** The settled assessment this attention was raised against. */
  basisAssessmentRef: z.string().min(1),
  resolvedAt: z.string().datetime({ offset: true }).optional(),
  resolution: z.strictObject({ label: z.string().min(1), code: z.string().min(1) }).optional(),
});
export type RecoveryCaseAttentionView = z.infer<typeof RecoveryCaseAttentionViewSchema>;

/**
 * R2 — the backend-supplied mapping of the ordered authoritative `causalPath`
 * onto the visible focused Case graph. The frontend must NOT traverse graph
 * topology to infer causality (FRONTEND_SEMANTIC_CONTRACT FIG-5b); this block is
 * the backend's answer. Computed purely by `projectRecoveryCase` from the
 * produced `ldg` visible refs/edge ids and the case's `causalPath`.
 *
 * Honest gaps: a causal step whose subject has no visible graph node is reported
 * in `unmappedCausalSteps`, never silently dropped and never guessed. Optional on
 * the case view: a case with an empty causal path carries no `focusedGraph`.
 */
export const FocusedGraphFirstBreakpointSchema = z.strictObject({
  /** The visible `ldg` node ref the first operational breakpoint maps to. */
  nodeRef: z.string().min(1),
  /** Human operational wording, from the visible node's own label. */
  label: z.string().min(1),
  /** The evaluator dimension of `causalPath[0]`. */
  dimension: z.string().min(1),
  /** The evaluator reason code of `causalPath[0]`. */
  reasonCode: z.string().min(1),
});
export type FocusedGraphFirstBreakpoint = z.infer<typeof FocusedGraphFirstBreakpointSchema>;

export const FocusedGraphUnmappedStepSchema = z.strictObject({
  subjectRef: z.string().min(1),
  dimension: z.string().min(1),
  reasonCode: z.string().min(1),
  /** Why it could not be mapped, e.g. `no visible graph node for subject`. */
  reason: z.string().min(1),
});
export type FocusedGraphUnmappedStep = z.infer<typeof FocusedGraphUnmappedStepSchema>;

export const FocusedGraphViewSchema = z.strictObject({
  /** Ordered subset of `ldg` node refs on the causal chain (may be empty). */
  causalNodeRefs: z.array(z.string().min(1)).default([]),
  /** Subset of `ldg` edge ids (FIG-1 producer-owned ids) on the causal chain. */
  causalEdgeIds: z.array(z.string().min(1)).default([]),
  /** `causalPath[0]` mapped to a visible ref, when it is mappable. */
  firstBreakpoint: FocusedGraphFirstBreakpointSchema.optional(),
  /** Causal steps with no visible graph object — explicit, never dropped. */
  unmappedCausalSteps: z.array(FocusedGraphUnmappedStepSchema).default([]),
});
export type FocusedGraphView = z.infer<typeof FocusedGraphViewSchema>;

/**
 * R2 — the ONE immutable ORIGINAL focused-graph snapshot of a RecoveryCase
 * (table `recovery_case_graph_snapshots`, migration 0127).
 *
 * It is the first truthful focused Case graph, frozen once, so the operator can
 * compare Original <-> Current. It is SEMANTIC only — exactly the inputs the
 * focused renderer consumes (`ldg`, `focusedGraph`, `caseStatus`) plus the human
 * subject labels — never HTML/SVG/layout/camera/animation state. CURRENT always
 * comes from authoritative state (`RecoveryCaseView.ldg`) and never from this.
 * It is case-owned presentation history: not trip truth, not an assessment, not
 * planning evidence. Change-awareness hints inside the stored `ldg` are neutral
 * (they are poll-relative, not semantic).
 */
export const ORIGINAL_GRAPH_SNAPSHOT_SCHEMA_VERSION = 1;
export const ORIGINAL_GRAPH_MAX_NODES = 200;
export const ORIGINAL_GRAPH_MAX_EDGES = 400;
export const ORIGINAL_GRAPH_MAX_LABELS = 200;

const OriginalGraphLdgSchema = z.strictObject({
  scope: z.literal('FOCUSED_CASE'),
  nodes: z.array(LdgNodeSchema).max(ORIGINAL_GRAPH_MAX_NODES),
  edges: z.array(LdgEdgeSchema).max(ORIGINAL_GRAPH_MAX_EDGES),
  change: ChangeAwarenessSchema,
});

/** The stored JSONB payload (capture time and basis live in dedicated columns). */
export const OriginalGraphSnapshotPayloadSchema = z.strictObject({
  schemaVersion: z.literal(ORIGINAL_GRAPH_SNAPSHOT_SCHEMA_VERSION),
  /** The case's lifecycle status when captured — the renderer's only non-graph input. */
  caseStatusAtCapture: z.enum([
    'OPEN', 'PLANNING', 'AWAITING_AUTHORITY', 'EXECUTING', 'RESOLVED', 'CLOSED', 'CANCELLED', 'SUPERSEDED',
  ]),
  ldg: OriginalGraphLdgSchema,
  focusedGraph: FocusedGraphViewSchema.optional(),
  subjectLabels: z.record(z.string().min(1), z.string().min(1)).default({}).refine(
    (labels) => Object.keys(labels).length <= ORIGINAL_GRAPH_MAX_LABELS,
    { message: 'too many subject labels' },
  ),
}).superRefine((payload, ctx) => {
  const refs = new Set(payload.ldg.nodes.map((n) => n.ref));
  const edgeIds = new Set(payload.ldg.edges.map((e) => e.id));
  for (const ref of payload.focusedGraph?.causalNodeRefs ?? []) {
    if (!refs.has(ref)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `causal node ref ${ref} is not in the snapshot graph`, path: ['focusedGraph'] });
  }
  for (const id of payload.focusedGraph?.causalEdgeIds ?? []) {
    if (!edgeIds.has(id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `causal edge id ${id} is not in the snapshot graph`, path: ['focusedGraph'] });
  }
});
export type OriginalGraphSnapshotPayload = z.infer<typeof OriginalGraphSnapshotPayloadSchema>;

/** What the Case read path exposes: the payload plus its capture provenance. */
export const OriginalFocusedGraphViewSchema = z.strictObject({
  capturedAt: z.string().datetime({ offset: true }),
  /** The settled failing assessment the Original was captured against, when known. */
  basisAssessmentRef: z.string().min(1).optional(),
  schemaVersion: z.literal(ORIGINAL_GRAPH_SNAPSHOT_SCHEMA_VERSION),
  caseStatusAtCapture: OriginalGraphSnapshotPayloadSchema.shape.caseStatusAtCapture,
  ldg: OriginalGraphLdgSchema,
  focusedGraph: FocusedGraphViewSchema.optional(),
  subjectLabels: z.record(z.string().min(1), z.string().min(1)).default({}),
});
export type OriginalFocusedGraphView = z.infer<typeof OriginalFocusedGraphViewSchema>;

export const RecoveryCaseViewSchema = z.strictObject({
  generatedAt: z.string().datetime({ offset: true }),
  caseRef: z.string().min(1),
  cause: CaseCauseViewSchema.optional(),
  causalPath: z.array(CausalPathStepSchema).default([]),
  /**
   * R2 — backend-supplied mapping of `causalPath` onto the visible focused graph
   * (`ldg`). Optional: absent when the case has no causal path. The frontend reads
   * this instead of traversing topology (FIG-5b).
   */
  focusedGraph: FocusedGraphViewSchema.optional(),
  status: z.enum([
    'OPEN', 'PLANNING', 'AWAITING_AUTHORITY', 'EXECUTING', 'RESOLVED', 'CLOSED', 'CANCELLED', 'SUPERSEDED',
  ]),
  changeSummary: z.string().min(1),
  /**
   * R2 — authoritative human display labels for the case's typed subject refs
   * (key `<KIND>:<id>`), resolved from canonical identity state (e.g. a
   * Journey's traveller display name). Presentation-only: refs stay secondary,
   * and refs the map does not cover simply have no entry (the UI falls back to
   * its existing generic wording). Never persona lookup, never identity.
   */
  subjectLabels: z.record(z.string().min(1), z.string().min(1)).default({}),
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
  strategies: z.array(RecoveryStrategyViewSchema),
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
  /**
   * C9 — planning-time decision evidence (Q4-Q12), structurally distinguishable
   * from the current authoritative state above via its `phase`/`asOf` fields.
   * Optional: a case that has not yet run a planning attempt carries none.
   */
  planningEvidence: PlanningEvidenceViewSchema.optional(),
  /** Durable human-attention records (open first-class, resolved kept as history). */
  attention: z.array(RecoveryCaseAttentionViewSchema).default([]),
  ldg: LiveDependencyGraphSchema,
  /**
   * R2 — the persisted immutable Original focused graph (historical presentation
   * evidence). Absent when the case has no captured Original (honest unavailable
   * state); never derived from `ldg` and never read by CURRENT.
   */
  originalFocusedGraph: OriginalFocusedGraphViewSchema.optional(),
  change: ChangeAwarenessSchema,
});
export type RecoveryCaseView = z.infer<typeof RecoveryCaseViewSchema>;

export const TravellerItineraryItemSchema = z.strictObject({
  label: z.string().min(1),
  originLabel: z.string().min(1).optional(),
  destinationLabel: z.string().min(1).optional(),
  placeLabel: z.string().min(1).optional(),
  startsAt: z.string().datetime({ offset: true }).optional(),
  endsAt: z.string().datetime({ offset: true }).optional(),
  startTimeZone: z.string().min(1).optional(),
  endTimeZone: z.string().min(1).optional(),
  status: z.string().min(1),
});
export type TravellerItineraryItem = z.infer<typeof TravellerItineraryItemSchema>;

export const TravellerCommitmentSchema = z.strictObject({
  label: z.string().min(1),
  windowStart: z.string().datetime({ offset: true }).optional(),
  windowEnd: z.string().datetime({ offset: true }).optional(),
  timeZone: z.string().min(1).optional(),
  placeLabel: z.string().min(1).optional(),
});
export type TravellerCommitment = z.infer<typeof TravellerCommitmentSchema>;

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
  itinerary: z.array(TravellerItineraryItemSchema).optional(),
  commitment: TravellerCommitmentSchema.optional(),
  change: ChangeAwarenessSchema,
});
export type TravellerTripView = z.infer<typeof TravellerTripViewSchema>;

/**
 * The three secondary operator surfaces the accepted shell navigates to.
 *
 * Each is a read-only projection of authoritative state and each is
 * legitimately empty in a baseline world. They exist so the shell's nav is
 * honest — a link that 404s is worse than no link — and they present only
 * values the backend supplied.
 */
export const ProgrammeScheduleSchema = z.strictObject({
  generatedAt: z.string().datetime({ offset: true }),
  eventTitle: z.string().min(1),
  /** Bounded participant/readiness rollup from the active programme population. */
  populationSummary: z.strictObject({
    total: z.number().int().min(0),
    withJourney: z.number().int().min(0),
    withoutJourney: z.number().int().min(0),
    ready: z.number().int().min(0),
    disrupted: z.number().int().min(0),
    unknown: z.number().int().min(0),
  }).optional(),
  /** One row per authoritative Traveller, with links to its actual journeys/cases. */
  travellers: z.array(z.strictObject({
    travellerRef: z.string().min(1),
    label: z.string().min(1),
    journeyRefs: z.array(z.string().min(1)),
    caseRefs: z.array(z.string().min(1)),
    status: z.enum(['READY', 'DISRUPTED', 'UNKNOWN', 'UNSPECIFIED']),
    assessmentStatus: z.enum(['CURRENT', 'STALE', 'PENDING_REASSESSMENT', 'UNAVAILABLE', 'NONE']).optional(),
    missingInformation: z.array(z.string().min(1)).optional(),
  })).optional(),
  /** A commitment is emitted once even when several affected people share it. */
  endangeredCommitments: z.array(z.strictObject({
    commitmentRef: z.string().min(1),
    label: z.string().min(1),
    reason: z.string().min(1),
    affectedTravellerRefs: z.array(z.string().min(1)),
    affectedTravellerLabels: z.array(z.string().min(1)),
    caseRefs: z.array(z.string().min(1)),
  })).optional(),
  /** Explicit unresolved readiness information; absent means none was supplied. */
  missingInformation: z.array(z.strictObject({
    travellerRef: z.string().min(1),
    label: z.string().min(1),
    reason: z.string().min(1),
  })).optional(),
  items: z.array(z.strictObject({
    itemRef: z.string().min(1),
    label: z.string().min(1),
    itemType: z.string().min(1),
    windowLabel: z.string().min(1).optional(),
    placeLabel: z.string().min(1).optional(),
    lifecycleStatus: z.string().min(1),
    /** Accepted participation counts — authoritative, never inferred from names. */
    requiredParticipants: z.number().int().min(0),
    optionalParticipants: z.number().int().min(0),
    requiresPhysicalPresence: z.boolean(),
    /** ISO window bounds so a surface can group by event day without re-parsing labels. */
    windowStart: z.string().datetime({ offset: true }).optional(),
    windowEnd: z.string().datetime({ offset: true }).optional(),
    /** An open recovery case touching a person committed to this item, when one exists. */
    affectedCaseRef: z.string().min(1).optional(),
    affectedCaseCount: z.number().int().min(0).optional(),
  })),
});
export type ProgrammeSchedule = z.infer<typeof ProgrammeScheduleSchema>;

export const DecisionQueueSchema = z.strictObject({
  generatedAt: z.string().datetime({ offset: true }),
  decisions: z.array(z.strictObject({
    caseRef: z.string().min(1),
    status: z.string().min(1),
    openedAtLabel: z.string().min(1),
    /** ISO instant the case opened, so a surface can show a relative age. */
    openedAt: z.string().datetime({ offset: true }).optional(),
    subjectLabels: z.array(z.string().min(1)),
    /** Only cases the backend reports as awaiting authority require a decision. */
    awaitingAuthority: z.boolean(),
  })),
  /** Immutable human approval outcomes, including later revocations. */
  recentDecisions: z.array(z.strictObject({
    caseRef: z.string().min(1).optional(),
    label: z.string().min(1),
    decisionAt: z.string().datetime({ offset: true }),
    actorLabel: z.string().min(1),
    kind: z.enum(['approval', 'revocation']),
  })).max(20).optional(),
});
export type DecisionQueue = z.infer<typeof DecisionQueueSchema>;

export const ActivityFeedSchema = z.strictObject({
  generatedAt: z.string().datetime({ offset: true }),
  entries: z.array(z.strictObject({
    entryRef: z.string().min(1),
    atLabel: z.string().min(1),
    actorLabel: z.string().min(1),
    subjectLabel: z.string().min(1),
    what: z.string().min(1),
    reason: z.string().min(1).optional(),
    /** Resolved display name of the traveller the change concerns, when it concerns one. */
    subjectName: z.string().min(1).optional(),
    /** Kind of the changed record (e.g. JOURNEY) — presentation maps it to a noun, never shows it. */
    subjectKind: z.string().min(1).optional(),
    /** Whether the recorded actor is a person, a service or the system, when known. */
    actorKind: z.enum(['HUMAN', 'SERVICE', 'SYSTEM']).optional(),
    /** Recovery case this change belongs to, when one is known. */
    caseRef: z.string().min(1).optional(),
  })),
  /** True when older entries exist beyond the page returned. */
  truncated: z.boolean(),
  /** Exclusive, workspace-scoped change-record cursor for the next older page. */
  nextCursor: z.string().uuid().optional(),
  /** Present when this is an older page, so the surface can offer the latest activity. */
  beforeCursor: z.string().uuid().optional(),
});
export type ActivityFeed = z.infer<typeof ActivityFeedSchema>;

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
  // B1 additive: planning / approval / principal outcomes of the normal
  // application paths. Truthful refusals, never silent fallbacks.
  'CASE_NOT_FOUND',
  'CASE_NOT_OPEN',
  'STRATEGY_NOT_FOUND',
  'STRATEGY_NOT_VIABLE',
  'STRATEGY_BASE_STALE',
  'PLAN_COMPILE_FAILED',
  'PLAN_PERSIST_FAILED',
  'BUDGET_HOLD_REQUIRED',
  'AUTHORITY_SCOPE_UNRESOLVED',
  'APPROVER_UNAUTHORIZED',
  'DISPATCHER_UNAUTHORIZED',
  'INTENT_MISSING',
  'AUTHORITY_DECISION_FAILED',
  'APPROVAL_FAILED',
  'PRINCIPAL_UNRESOLVED',
  // R4-F2 additive: truthful refusal reasons for provider-executed (external) options.
  'EXTERNAL_EXECUTION_NOT_COMPOSED',
  'EXECUTION_INPUTS_UNAVAILABLE',
  // R4-F2f additive: a REPLAY/SIMULATED-researched option needs a fresh live provider quote first.
  'FRESH_PROVIDER_QUOTE_REQUIRED',
  'BUDGET_UNAVAILABLE',
]);
export type ApplicationErrorCode = z.infer<typeof ApplicationErrorCodeSchema>;

export const ApplicationErrorSchema = z.strictObject({
  code: ApplicationErrorCodeSchema,
  message: z.string().min(1),
  /** Read/API failures never mutate trip state. */
  mutatesState: z.literal(false),
});
export type ApplicationError = z.infer<typeof ApplicationErrorSchema>;

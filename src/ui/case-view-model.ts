/**
 * E1 — operator recovery-case detail view model (UI-local projection).
 *
 * The frozen read models (`src/contracts/readmodels.ts`) cover the dashboard
 * and trip-level views. The case/trip detail screen needs a richer
 * projection (checked items, recovery options with verdicts and rejection
 * reasons, approval requirement, action progress, resolution outcome).
 *
 * This shape is defined here as the UI's information architecture, not as a
 * fork of frozen DTOs: it reuses frozen domain types and is documented for
 * the integrator (E3/I5) as the application read model the UI expects.
 * Nothing here may be scenario-specific; screens render any conforming view.
 */
import type { EntityId, EntityRef, IsoDateTime, Money } from '../domain/common.ts';
import type { ReadModelStatus } from '../contracts/readmodels.ts';
import type { ResolutionOutcome } from '../operational/case.ts';
import type { CostAllocation } from '../operational/intent.ts';

/** Deterministic check outcome mirrors the frozen PASS/FAIL/UNKNOWN model. */
export type CaseCheckResult = 'PASS' | 'FAIL' | 'UNKNOWN';

/** A user-facing check the system ran on the candidate plan. */
export interface CaseCheckView {
  id: EntityId;
  /** Plain language, e.g. "New arrival is before the speaking slot". */
  label: string;
  result: CaseCheckResult;
}

/** One chronological evidence row for progressive deterioration (Pass 2). */
export interface StatusTimelineEntryView {
  id: EntityId;
  at?: IsoDateTime;
  label: string;
  detail?: string;
  tone?: 'neutral' | 'watch' | 'alert' | 'ok';
}

export type OptionVerdict = 'VIABLE' | 'NOT_VIABLE' | 'UNKNOWN';

export type WholeTripPlanItemKind = 'CHECKED' | 'RECOMMENDED' | 'EXECUTABLE' | 'MANUAL_FOLLOWUP';

export interface WholeTripPlanItemView {
  id: EntityId;
  category: 'FLIGHT' | 'OVERNIGHT' | 'ENTRY' | 'INSURANCE' | 'HOTEL' | 'EVENT' | 'COST';
  title: string;
  finding: string;
  kind: WholeTripPlanItemKind;
  /**
   * The bookable fact being replaced (FLIGHT category): the onward leg that
   * no longer works, phrased for judges. Present makes the Before → After
   * comparison unmistakable; absent when nothing is being replaced.
   */
  before?: string;
  /**
   * Semantic outcome label derived by the projection from the item's actual
   * evidence (e.g. "Covered" for an insurance check that found coverage).
   * Rendered as a shared coloured badge; absent falls back to the kind label.
   */
  statusLabel?: string;
  /** Shared badge tone for statusLabel (ok=green, watch=amber, alert=red). */
  statusTone?: 'ok' | 'watch' | 'alert' | 'neutral';
}

export interface WholeTripRecoveryPlanView {
  headline: string;
  items: WholeTripPlanItemView[];
  knownIncrementalCost?: Money;
  costNotes?: string[];
}

/** A recovery option as presented to the operator. */
export interface RecoveryOptionView {
  id: EntityId;
  title: string;
  summary?: string;
  verdict: OptionVerdict;
  /** Required when verdict is NOT_VIABLE; plain-language reason. */
  rejectionReason?: string;
  recommended?: boolean;
  /** Plain-language reason the planner ranked this option first. */
  whyRecommended?: string;
  /** Positive = extra cost, negative = saving, versus the original plan. */
  costDelta?: Money;
  /**
   * ADR-052: when the cost was quoted in a non-home currency and normalized,
   * the ORIGINAL provider amount/currency stays visible beside the
   * home-currency restatement (`costDelta` carries the restatement when the
   * intent was built through the FX path). Absent => no normalization.
   */
  providerCost?: Money;
  requiresApproval?: boolean;
  /**
   * Short plain-language consequence chips (approved C3 card flags), e.g.
   * "Makes the rehearsal". Projected by the backend; never invented here.
   */
  flags?: string[];
  /** Structured advantages derived from evidence (timing, cost, disruption). */
  pros?: string[];
  /** Structured tradeoffs / uncertainties derived from evidence. */
  cons?: string[];
  /** Plain-language effect on the hard commitment (keeps / breaks / unknown). */
  commitmentEffect?: string;
  /** Who must approve this option, in judge-facing language. */
  authorityLabel?: string;
  /**
   * Whole-trip reasoning card: checked context vs executable vs manual follow-up.
   * Present when the planner staged a transport recovery with downstream consequences.
   */
  wholeTripPlan?: WholeTripRecoveryPlanView;
  /**
   * Deterministic payer allocation of this option's cost (ADR-037), present
   * only when FUNDED_WINDOW rules + a cost anchor could decide. Absence
   * means allocation is UNKNOWN — never silently event-funded.
   */
  costAllocation?: CostAllocation;
  /** User-facing one-liner projected from costAllocation (renderer stays pure). */
  costAllocationSummary?: string;
}

export interface ApprovalRequirementView {
  /** Exact deterministic authority outcome; never collapse human escalation into approval. */
  requestedFrom: 'TRAVELLER' | 'ORGANISATION' | 'HUMAN_AGENT';
  /** The persisted intent the runtime must decide/execute, when actionable. */
  intentId?: EntityId;
  /**
   * A real in-scope organisation principal for an organisation decision.
   * Omitted when the authority outcome is traveller or human-agent.
   */
  approver?: EntityRef;
  /** Plain-language reason, e.g. policy threshold exceeded. */
  reason: string;
  amount?: Money;
  state: 'PENDING' | 'APPROVED' | 'DECLINED';
}

export type ActionProgressState = 'QUEUED' | 'IN_PROGRESS' | 'DONE' | 'FAILED';

export interface ActionProgressView {
  id: EntityId;
  label: string;
  state: ActionProgressState;
  /** Supporting detail (approved C2 row sub-line), e.g. a time or "2 left". */
  detail?: string;
}

/**
 * One downstream item the change touches, with its honest state (approved
 * C1 "What this touches" list). Rich alternative to `affectedItems`
 * strings; when absent the screen falls back to the plain list.
 */
export interface AffectedItemView {
  label: string;
  detail?: string;
  state: 'BROKEN' | 'AT_RISK' | 'UNKNOWN' | 'INTACT';
}

/**
 * The commitment at stake, structured for the ink rail card (approved
 * C1–C6). Optional: when the projection cannot structure it, the case view
 * falls back to `criticalObjectiveAtRisk` inline. Never fabricated.
 */
export interface CaseCommitmentView {
  title: string;
  body?: string;
  ifMissed?: string;
}

/**
 * One generic rail card of label/value rows (approved C1–C6 rail: case
 * facts, recovery pace, who decides, recovery timeline…). The backend
 * projects the rows; the UI renders any conforming section.
 */
export interface CaseRailSectionView {
  title: string;
  rows: ReadonlyArray<{ label: string; value: string }>;
  note?: string;
}

export interface CaseResolutionView {
  outcome: ResolutionOutcome;
  summary: string;
  /** User-facing descriptions of what could not be kept (RECOVERED_WITH_LOSS). */
  remainingLosses?: string[];
}

/**
 * One link of the trip as a chain (docs/DESIGN.md §4.2). The chain is how
 * the case view answers "is the trip still a trip?" — fixing one booking is
 * not fixing the trip.
 *
 * Colour logic is binding (user-directed):
 * - CONFIRMED renders green — a healthy component is never grey;
 * - PROPOSED renders dashed brass — checked option, not booked yet;
 * - BROKEN renders vermilion — no longer works as booked;
 * - UNBOOKED / UNKNOWN render grey — grey means missing or unverifiable;
 * - AT_RISK renders brass — standing, but something it depends on moved.
 */
export type ChainLinkState =
  | 'CONFIRMED'
  | 'PROPOSED'
  | 'BROKEN'
  | 'UNBOOKED'
  | 'UNKNOWN'
  | 'AT_RISK';

export interface ChainLinkView {
  id: EntityId;
  /** Component kind, user-facing, e.g. "Flight", "Transfer", "Stay". */
  kind: string;
  /** Short name, e.g. "SQ 317 · London → Singapore". */
  label: string;
  /** Supporting detail, e.g. "Cancelled 15 Sep" or "2 nights · check-in 15:00". */
  detail?: string;
  state: ChainLinkState;
  /** Optional override for link state word (e.g. Change pending). */
  stateLabel?: string;
  /** The commitment link carries the ✦ and never disappears. */
  commitment?: boolean;
  /** Icon family for roster mini-chains: flight, ground, stay, commitment. */
  linkType?: 'FLIGHT' | 'GROUND' | 'STAY' | 'COMMITMENT';
}

/**
 * Mixed-funding evidence for a case (ADR-037): the deterministic allocation
 * attached to the case's latest priced intent, with a user-facing summary.
 * Absent on the view when no allocation could be derived — UNKNOWN stays
 * visible instead of being silently treated as event-funded.
 */
export interface CaseFundingView {
  allocation: CostAllocation;
  summary: string;
}

export interface CaseDetailView {
  caseId: EntityId;
  tripId: EntityId;
  tripLabel?: string;
  travellerNames: string[];
  status: ReadModelStatus;
  /** What changed, in user-facing language. */
  whatChanged?: string;
  /**
   * Chronological evidence/status log when multiple signals or staged
   * deterioration exist. Never fabricated — projected from trip signals only.
   */
  statusTimeline?: StatusTimelineEntryView[];
  /** Downstream items affected by the change, user-facing. */
  affectedItems: string[];
  /**
   * Rich per-item impact states for the approved "What this touches" list.
   * When present it replaces `affectedItems`; either may be empty, never
   * invented.
   */
  affected?: AffectedItemView[];
  /** The must-not-miss objective currently threatened, user-facing. */
  criticalObjectiveAtRisk?: string;
  /** Structured commitment for the ink rail card (approved C1–C6). */
  commitment?: CaseCommitmentView;
  /** Generic rail cards (case facts, recovery pace, timeline…). */
  railSections?: CaseRailSectionView[];
  /**
   * The trip as a chain of dependent components, ordered travel-first to
   * commitment. Optional: when the projection cannot provide it, the case
   * view falls back to the affected-items list. Never fabricated.
   */
  chain?: ChainLinkView[];
  checks: CaseCheckView[];
  options: RecoveryOptionView[];
  approval?: ApprovalRequirementView;
  actions: ActionProgressView[];
  /** Mixed-funding evidence (ADR-037); absent when allocation is UNKNOWN. */
  funding?: CaseFundingView;
  uncertainties: string[];
  /**
   * True once the planning loop has run for this case but produced no
   * actionable strategy and the case is still unresolved — the honest "no
   * automated recovery path" end-state. The view must say so plainly rather
   * than re-offer a planning action that already completed empty.
   */
  planningExhausted?: boolean;
  resolution?: CaseResolutionView;
  updatedAt: IsoDateTime;
  /** Anchor event for programme-side recovery when travel-only recovery is insufficient. */
  anchorEventId?: EntityId;
  /** When true, surface the programme-change preview/commit affordance. */
  programmeChangeAvailable?: boolean;
  /** Anchor commitment id for programme-side recovery (when available). */
  programmeChangeCommitmentId?: EntityId;
  /** Prefill for programme-change modal (ISO); human labels rendered in UI. */
  programmeChangeProposedStartsAt?: IsoDateTime;
  programmeChangeProposedEndsAt?: IsoDateTime;
  /**
   * Programme-recovery presentation stage. Server sets `travel_analysis` when
   * travel-only recovery is insufficient; client may advance to
   * `programme_recommendation` after the travel-analysis overlay completes.
   */
  programmeRecoveryStage?: 'travel_analysis' | 'programme_recommendation';
  /** Operator-facing Northstar analysis steps before planning completes. */
  recoveryAnalysisSteps?: string[];
}

/**
 * Deterministic consistency guard for case projections. Renderers and tests
 * use this so malformed views (e.g. a rejected option without a reason) are
 * surfaced instead of silently presented.
 */
export function caseDetailViewIssues(view: CaseDetailView): string[] {
  const issues: string[] = [];
  for (const option of view.options) {
    if (option.verdict === 'NOT_VIABLE' && !option.rejectionReason) {
      issues.push(`option ${option.id}: NOT_VIABLE without rejectionReason`);
    }
  }
  if (view.resolution?.outcome === 'RECOVERED_WITH_LOSS' && (view.resolution.remainingLosses?.length ?? 0) === 0) {
    issues.push('resolution: RECOVERED_WITH_LOSS without remainingLosses');
  }
  if (view.approval?.state === 'PENDING' && !view.approval.reason) {
    issues.push('approval: PENDING without reason');
  }
  return issues;
}

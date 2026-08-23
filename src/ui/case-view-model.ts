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
import type { EntityId, IsoDateTime, Money } from '../domain/common.ts';
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

export type OptionVerdict = 'VIABLE' | 'NOT_VIABLE' | 'UNKNOWN';

/** A recovery option as presented to the operator. */
export interface RecoveryOptionView {
  id: EntityId;
  title: string;
  summary?: string;
  verdict: OptionVerdict;
  /** Required when verdict is NOT_VIABLE; plain-language reason. */
  rejectionReason?: string;
  recommended?: boolean;
  /** Positive = extra cost, negative = saving, versus the original plan. */
  costDelta?: Money;
  requiresApproval?: boolean;
  /**
   * Deterministic payer allocation of this option's cost (ADR-037), present
   * only when FUNDED_WINDOW rules + a cost anchor could decide. Absence
   * means allocation is UNKNOWN — never silently event-funded.
   */
  costAllocation?: CostAllocation;
}

export interface ApprovalRequirementView {
  requestedFrom: 'TRAVELLER' | 'ORGANISATION';
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
  /** The commitment link carries the ✦ and never disappears. */
  commitment?: boolean;
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
  /** Downstream items affected by the change, user-facing. */
  affectedItems: string[];
  /** The must-not-miss objective currently threatened, user-facing. */
  criticalObjectiveAtRisk?: string;
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
  resolution?: CaseResolutionView;
  updatedAt: IsoDateTime;
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

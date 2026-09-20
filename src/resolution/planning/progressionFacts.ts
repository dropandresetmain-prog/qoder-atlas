/**
 * NORTHSTAR R1 — Recovery Lifecycle Progression fact mapping (freeze C8 impl).
 *
 * The frozen DECISION (`decideRecoveryProgression` in the C8 contract) is pure
 * and already tested. What the concrete service still needs is an HONEST, pure
 * mapping from what the EXISTING owners actually observe — the deterministic
 * resolution gate, the case lifecycle phase, pending authority/execution and the
 * current assessment verdict — into the frozen `RecoveryProgressionInput`. This
 * module is that mapping. It re-derives nothing: it only projects observed facts
 * onto the frozen input shape, so the single post-reassessment owner cannot
 * quietly disagree with the resolution gate or invent progress.
 *
 * Ownership boundaries (freeze §11), all preserved here:
 *   - the progression service REUSES the existing case lifecycle and resolution
 *     gate; it invents no second status machine and re-derives no gate verdict;
 *   - it never assumes an old candidate is current (the input is bound to a
 *     basisAssessmentId);
 *   - RESOLVE/WAIT/REPLAN/ESCALATE come only from the frozen precedence.
 *
 * ESCALATE SURFACE — RESOLVED (R1 local, migration 0126): the case lifecycle has
 * no "escalated" phase and does not gain one. ESCALATE is recorded as durable,
 * Case-owned human attention (`recovery_case_attention`), orthogonal to phase;
 * see `src/contracts/v2/planning/recoveryCaseAttention.ts`. This mapper only
 * returns the truthful decision.
 *
 * Pure: no PostgreSQL, no provider, no model.
 */
import {
  decideRecoveryProgression,
  type RecoveryProgressionInput,
  type RecoveryProgressionResult,
} from '../../contracts/v2/planning/recoveryProgression.ts';
import type { SubjectId } from '../../domain/v2/shared/identity.ts';
import type { ResolutionGateResult } from '../../app/target/recoveryCaseResolution.ts';

/**
 * Resolution-gate denial reasons that mean authority and/or execution is still
 * in flight — i.e. the case is mid-flight and the honest decision is WAIT, not
 * REPLAN or ESCALATE. These are the gate's own reasons; nothing is invented.
 */
const PENDING_EXECUTION_REASONS: ReadonlySet<string> = new Set([
  'EXECUTION_NOT_RECONCILED',
  'ACTION_INTENT_NOT_COMPLETE',
  'PROPOSED_STATE_ONLY',
]);

/**
 * Observed facts the progression pass collects from existing owners. Every field
 * is produced elsewhere (resolution gate, case lifecycle, authority/execution
 * state, current assessment); the mapper only combines them.
 */
export interface ObservedProgressionFacts {
  recoveryCaseId: SubjectId;
  /** The settled current assessment this decision is bound to. */
  basisAssessmentId: SubjectId;
  /** The deterministic resolution gate result for the case. */
  gate: ResolutionGateResult;
  /**
   * True when authority provisioning and/or execution is still pending for the
   * case (an approved-but-not-yet-reconciled intent, an in-flight dispatch). A
   * separate owner from the gate; supplied explicitly.
   */
  authorityOrExecutionPending: boolean;
  /**
   * True when the case is not terminal and a further planning basis could
   * plausibly help. Supplied by the pass from the case lifecycle + whether the
   * current failure is one recovery can address.
   */
  recoveryRemainsPossible: boolean;
  /**
   * A5 FIX-1 — True when the still-failing state is MONITORABLE: replacement
   * planning is intentionally not yet eligible for this basis (e.g. a tight-only
   * connection) and nothing has been planned for it yet. Supplied by the pass
   * from the deterministic planning-eligibility classification plus whether an
   * attempt already exists for this basis; never a scenario branch. When set (and
   * the basis is still failing, not already awaiting authority, and not
   * replan-eligible) the honest decision is WAIT, not ESCALATE.
   */
  failingStateMonitorable: boolean;
  /**
   * The CURRENT settled overall verdict the pass read from the assessment owner.
   * When supplied it is authoritative for "still failing": the resolution gate
   * checks execution/proposal state BEFORE verdicts, so a stale proposal must not
   * hide a newly failing basis behind PROPOSED_STATE_ONLY. Omitted => the mapper
   * falls back to the gate's own denial reason.
   */
  currentAssessmentVerdict?: 'PASS' | 'FAIL' | 'UNKNOWN';
}

/**
 * Project observed facts onto the frozen `RecoveryProgressionInput`. Derives the
 * gate-sourced fields honestly:
 *   - resolutionGatePassed: the gate's own `allowed`;
 *   - executionReconciled: true unless the gate denied specifically on an
 *     unreconciled-execution / incomplete-mandatory-action reason;
 *   - authorityOrExecutionPending: the explicit owner flag OR a gate denial on a
 *     pending-execution reason;
 *   - currentStillFailing: the gate denied specifically on a blocking FAIL.
 */
export function toProgressionInput(facts: ObservedProgressionFacts): RecoveryProgressionInput {
  const gate = facts.gate;
  const reason = gate.allowed ? undefined : gate.reason;
  return {
    recoveryCaseId: facts.recoveryCaseId,
    basisAssessmentId: facts.basisAssessmentId,
    resolutionGatePassed: gate.allowed,
    executionReconciled: gate.allowed || !isUnreconciledExecution(reason),
    authorityOrExecutionPending: facts.authorityOrExecutionPending
      || (reason !== undefined && (facts.currentAssessmentVerdict === undefined
        ? PENDING_EXECUTION_REASONS.has(reason)
        // Explicit verdict: only in-flight execution is pending by itself; a
        // proposal awaiting authority is the owner flag's call (per basis).
        : isUnreconciledExecution(reason))),
    currentStillFailing: facts.currentAssessmentVerdict === undefined ? reason === 'BLOCKING_FAIL' : facts.currentAssessmentVerdict === 'FAIL',
    recoveryRemainsPossible: facts.recoveryRemainsPossible,
    failingStateMonitorable: facts.failingStateMonitorable,
  };
}

function isUnreconciledExecution(reason: string | undefined): boolean {
  return reason === 'EXECUTION_NOT_RECONCILED' || reason === 'ACTION_INTENT_NOT_COMPLETE';
}

/**
 * Map observed facts to the frozen progression decision in one pure step:
 * project onto the input, then apply the frozen precedence. The same settled
 * facts always yield the same decision (idempotent, safe to wake repeatedly).
 */
export function decideProgressionFromFacts(facts: ObservedProgressionFacts): RecoveryProgressionResult {
  return decideRecoveryProgression(toProgressionInput(facts));
}

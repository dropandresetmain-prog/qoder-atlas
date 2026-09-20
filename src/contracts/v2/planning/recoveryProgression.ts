/**
 * NORTHSTAR v2 — Recovery Lifecycle Progression seam (R1 / freeze C8).
 *
 * `RuntimeOrchestrator` is NOT restored. There is exactly ONE normal
 * application owner for post-reassessment case progression: a Recovery
 * Lifecycle Progression service composed once under `runtimeServices`. This
 * module freezes the decision contract; the concrete service (wiring the
 * existing case lifecycle, resolution gate, reassessment and the C1
 * coordinator) lives with the primary/integrator.
 *
 * Frozen decision (freeze §11), evaluated AFTER a settled current reassessment:
 *
 *   execution/observation or other canonical change
 *   -> normal invalidation/reassessment
 *   -> settled current assessment
 *   -> Recovery Lifecycle Progression
 *       -> resolution gate passes + execution reconciled: RESOLVE
 *       -> authority/execution still pending:            WAIT
 *       -> still failing + recovery remains possible:     REPLAN (planCase from NEW basis)
 *       -> still failing + monitorable (planning intentionally
 *          deferred, nothing planned for this basis yet):  WAIT (monitor)
 *       -> no safe recovery / human evidence or decision:  ESCALATE
 *
 * A5 FIX-1 — the four-state vocabulary already expresses a monitorable failing
 * state: it is WAIT. Before this correction WAIT was reachable only via
 * "authority/execution pending", so a tight-only connection that is FAILing but
 * intentionally NOT yet replacement-planning-eligible fell through to
 * ESCALATE / no_safe_recovery_remaining — semantically wrong, because "do not
 * replace yet" does NOT mean "no safe recovery exists". The smallest
 * generalized correction adds an explicit `failingStateMonitorable` truth that
 * also yields WAIT (with its own reason code), keeping the case open for a
 * subsequent observation/time/state transition. It never fakes authority
 * pending, never marks the assessment PASS, and is derived generically from
 * planning eligibility, not from any scenario identity.
 *
 * Rules this contract encodes:
 *   - the progression service reuses the EXISTING case lifecycle; it invents no
 *     second status machine;
 *   - it never assumes an old candidate remains current; a planning attempt is
 *     bound to its basis assessment/manifest;
 *   - execution workers do NOT recursively plan;
 *   - the planning coordinator does NOT own execution;
 *   - case resolution stays in the existing deterministic resolution gate;
 *   - progression is bounded/idempotent: the same settled basis yields the same
 *     decision, and a decision that triggers REPLAN does so exactly once per
 *     basis (guarded by the basis assessment identity).
 */
import { z } from 'zod';
import { SubjectIdSchema, type SubjectId } from '../../../domain/v2/shared/identity.ts';

/**
 * The four frozen progression decisions. Exactly one is returned per settled
 * basis. `ESCALATE` covers "no safe recovery" and "human evidence or decision
 * required"; if the existing case lifecycle proves it lacks a truthful state
 * for a required human/escalation condition, that is reported as a contract gap
 * rather than papered over with a new phase.
 */
export const RecoveryProgressionDecisionSchema = z.enum([
  'RESOLVE',
  'WAIT',
  'REPLAN',
  'ESCALATE',
]);
export type RecoveryProgressionDecision = z.infer<typeof RecoveryProgressionDecisionSchema>;

/**
 * The settled current facts the progression service reads to decide. All of
 * these come from existing owners: the resolution gate, the execution/
 * observation state, the current assessment and the case lifecycle. The
 * progression service COMPUTES a decision; it does not re-derive these inputs.
 */
export interface RecoveryProgressionInput {
  recoveryCaseId: SubjectId;
  /** Identity of the settled current assessment this decision is bound to. */
  basisAssessmentId: SubjectId;
  /** Existing deterministic resolution gate says required subjects PASS. */
  resolutionGatePassed: boolean;
  /** All required execution for the case is observed and reconciled. */
  executionReconciled: boolean;
  /** Authority and/or execution is still in flight (pending). */
  authorityOrExecutionPending: boolean;
  /** The current settled assessment still FAILs for a required subject. */
  currentStillFailing: boolean;
  /**
   * Recovery remains possible: the case is not in a terminal/no-safe-recovery
   * state and a further planning basis could plausibly help.
   */
  recoveryRemainsPossible: boolean;
  /**
   * A5 FIX-1 — the still-failing state is MONITORABLE: planning is
   * intentionally not yet eligible (e.g. a tight-only connection that may
   * resolve on its own) and nothing has been planned for this basis yet. The
   * honest decision is WAIT (keep the case open, observe again later), NOT
   * ESCALATE — "do not replace yet" is not "no safe recovery remains".
   *
   * This is an explicit truth supplied by the pass from the deterministic
   * planning-eligibility classification, never assumed and never derived from a
   * scenario identity. It is consulted only after RESOLVE and the
   * authority/execution-pending WAIT, and only when the state is still failing;
   * a basis that has already been planned (an attempt exists) is NOT monitorable
   * — its options are exhausted and it escalates as before.
   */
  failingStateMonitorable: boolean;
}

/**
 * The frozen decision plus the reason it was taken. `REPLAN` carries the basis
 * assessment id the new planning attempt MUST use, so a stale candidate can
 * never be reused: replanning is always against the NEW canonical basis.
 */
export const RecoveryProgressionResultSchema = z.strictObject({
  recoveryCaseId: SubjectIdSchema,
  basisAssessmentId: SubjectIdSchema,
  decision: RecoveryProgressionDecisionSchema,
  reasonCode: z.string().regex(/^[a-z][a-z0-9_]*$/),
});
export type RecoveryProgressionResult = z.infer<typeof RecoveryProgressionResultSchema>;

/**
 * The frozen progression decision function. PURE and deterministic: the same
 * settled input always yields the same decision, which is what makes the
 * service idempotent and safe to wake repeatedly.
 *
 * Precedence (freeze §11, with the A5 FIX-1 monitorable WAIT):
 *   1. resolution gate passed AND execution reconciled -> RESOLVE
 *   2. authority/execution still pending               -> WAIT
 *   3. still failing AND recovery remains possible      -> REPLAN
 *   4. still failing AND monitorable (planning deferred,
 *      nothing planned for this basis)                  -> WAIT (monitor)
 *   5. otherwise                                        -> ESCALATE
 */
export function decideRecoveryProgression(
  input: RecoveryProgressionInput,
): RecoveryProgressionResult {
  const base = {
    recoveryCaseId: input.recoveryCaseId,
    basisAssessmentId: input.basisAssessmentId,
  };

  if (input.resolutionGatePassed && input.executionReconciled) {
    return RecoveryProgressionResultSchema.parse({
      ...base,
      decision: 'RESOLVE',
      reasonCode: 'resolution_gate_passed_and_reconciled',
    });
  }

  if (input.authorityOrExecutionPending) {
    return RecoveryProgressionResultSchema.parse({
      ...base,
      decision: 'WAIT',
      reasonCode: 'authority_or_execution_pending',
    });
  }

  if (input.currentStillFailing && input.recoveryRemainsPossible) {
    return RecoveryProgressionResultSchema.parse({
      ...base,
      decision: 'REPLAN',
      reasonCode: 'still_failing_recovery_possible',
    });
  }

  // A5 FIX-1 — a still-failing state that is monitorable (replacement planning
  // intentionally deferred and nothing planned for this basis yet) WAITs: the
  // case stays open for a subsequent observation/time/state transition. This is
  // NOT ESCALATE: deferring replacement is not the same as exhausting recovery.
  if (input.currentStillFailing && input.failingStateMonitorable) {
    return RecoveryProgressionResultSchema.parse({
      ...base,
      decision: 'WAIT',
      reasonCode: 'failing_state_monitorable',
    });
  }

  return RecoveryProgressionResultSchema.parse({
    ...base,
    decision: 'ESCALATE',
    reasonCode: input.currentStillFailing
      ? 'no_safe_recovery_remaining'
      : 'human_evidence_or_decision_required',
  });
}

/**
 * The progression service port. Composed exactly once under `runtimeServices`.
 * It reuses the existing case lifecycle and resolution gate; it owns no
 * execution and no canonical mutation. `progressCase` is expected to be
 * idempotent per settled basis: calling it twice for the same
 * `basisAssessmentId` triggers at most one REPLAN.
 */
export interface RecoveryLifecycleProgression {
  progressCase(input: RecoveryProgressionInput): Promise<RecoveryProgressionResult>;
}

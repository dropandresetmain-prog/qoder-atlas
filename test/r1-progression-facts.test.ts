/**
 * R1 — the pure Recovery Lifecycle Progression fact mapper (freeze C8). The
 * DECISION (`decideRecoveryProgression`) is already frozen and contract-tested
 * in test/r1-planning-contracts.test.ts; this file pins the HONEST projection
 * from what existing owners OBSERVE — the deterministic resolution gate result,
 * an explicit authority/execution-pending flag, recovery-remains-possible and
 * the settled basis assessment id — onto that frozen input, then through the
 * frozen precedence. It proves the mapper never re-derives a gate verdict and
 * never invents progress: gate facts flow straight through, and the same settled
 * facts always yield the same decision (idempotent). Pure: no PG, no provider,
 * no model.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SubjectId } from '../src/domain/v2/shared/identity.ts';
import type { ResolutionGateResult } from '../src/app/target/recoveryCaseResolution.ts';
import {
  toProgressionInput,
  decideProgressionFromFacts,
  type ObservedProgressionFacts,
} from '../src/resolution/planning/progressionFacts.ts';

const CASE_ID = 'case-1' as SubjectId;
const BASIS_ID = 'assess-basis-1' as SubjectId;

function facts(over: Partial<ObservedProgressionFacts> = {}): ObservedProgressionFacts {
  return {
    recoveryCaseId: CASE_ID,
    basisAssessmentId: BASIS_ID,
    gate: { allowed: false, reason: 'BLOCKING_FAIL', detail: 'still failing' },
    authorityOrExecutionPending: false,
    recoveryRemainsPossible: false,
    failingStateMonitorable: false,
    ...over,
  };
}

function passGate(): ResolutionGateResult {
  return { allowed: true, resolutionKind: 'RECOVERED', summary: 'all current+pass', subjectVerdicts: [] };
}

test('gate PASSED -> RESOLVE (gate verdict flows straight through, never re-derived)', () => {
  const input = toProgressionInput(facts({ gate: passGate() }));
  assert.equal(input.resolutionGatePassed, true);
  assert.equal(input.executionReconciled, true);
  assert.equal(input.currentStillFailing, false);
  const decision = decideProgressionFromFacts(facts({ gate: passGate() }));
  assert.equal(decision.decision, 'RESOLVE');
  assert.equal(decision.reasonCode, 'resolution_gate_passed_and_reconciled');
  assert.equal(decision.recoveryCaseId, CASE_ID);
  assert.equal(decision.basisAssessmentId, BASIS_ID);
});

test('EXECUTION_NOT_RECONCILED / ACTION_INTENT_NOT_COMPLETE / PROPOSED_STATE_ONLY -> WAIT (mid-flight, not replan)', () => {
  for (const reason of ['EXECUTION_NOT_RECONCILED', 'ACTION_INTENT_NOT_COMPLETE', 'PROPOSED_STATE_ONLY'] as const) {
    const f = facts({ gate: { allowed: false, reason, detail: reason }, recoveryRemainsPossible: true });
    const input = toProgressionInput(f);
    // A pending-execution denial must NOT be mistaken for an unreconciled
    // execution that blocks RESOLVE-by-definition, and must set the pending flag.
    assert.equal(input.authorityOrExecutionPending, true, `${reason} is pending authority/execution`);
    assert.equal(input.currentStillFailing, false, `${reason} is not a blocking FAIL`);
    const decision = decideProgressionFromFacts(f);
    assert.equal(decision.decision, 'WAIT', reason);
    assert.equal(decision.reasonCode, 'authority_or_execution_pending', reason);
  }
});

test('explicit authorityOrExecutionPending flag alone -> WAIT even on a blocking FAIL', () => {
  // The pending flag is a separate owner; when it is set the case is mid-flight,
  // so WAIT outranks REPLAN even though the gate denied on BLOCKING_FAIL.
  const f = facts({ authorityOrExecutionPending: true, recoveryRemainsPossible: true });
  const input = toProgressionInput(f);
  assert.equal(input.authorityOrExecutionPending, true);
  assert.equal(input.currentStillFailing, true);
  const decision = decideProgressionFromFacts(f);
  assert.equal(decision.decision, 'WAIT');
});

test('BLOCKING_FAIL + recovery remains possible -> REPLAN bound to the NEW basis assessment', () => {
  const newBasis = 'assess-rebased-9' as SubjectId;
  const f = facts({ recoveryRemainsPossible: true, basisAssessmentId: newBasis });
  const input = toProgressionInput(f);
  assert.equal(input.currentStillFailing, true);
  assert.equal(input.recoveryRemainsPossible, true);
  assert.equal(input.authorityOrExecutionPending, false);
  const decision = decideProgressionFromFacts(f);
  assert.equal(decision.decision, 'REPLAN');
  assert.equal(decision.reasonCode, 'still_failing_recovery_possible');
  // The stale candidate can never be reused: the decision is bound to the new basis.
  assert.equal(decision.basisAssessmentId, newBasis);
});

test('BLOCKING_FAIL + no recovery remaining -> ESCALATE no_safe_recovery_remaining', () => {
  const decision = decideProgressionFromFacts(facts({ recoveryRemainsPossible: false }));
  assert.equal(decision.decision, 'ESCALATE');
  assert.equal(decision.reasonCode, 'no_safe_recovery_remaining');
});

test('A5 FIX-1: BLOCKING_FAIL, monitorable (planning deferred, nothing planned) -> WAIT failing_state_monitorable', () => {
  // A tight-only connection FAIL: not replan-eligible yet, no authority pending,
  // nothing planned for this basis. The honest decision is WAIT (keep the case
  // open and observe later), NOT ESCALATE no_safe_recovery_remaining.
  const monitorable = facts({ recoveryRemainsPossible: false, failingStateMonitorable: true });
  const input = toProgressionInput(monitorable);
  assert.equal(input.currentStillFailing, true);
  assert.equal(input.failingStateMonitorable, true);
  const decision = decideProgressionFromFacts(monitorable);
  assert.equal(decision.decision, 'WAIT');
  assert.equal(decision.reasonCode, 'failing_state_monitorable');
});

test('A5 FIX-1: a monitorable state that already has an attempt is NOT monitorable -> ESCALATE (options exhausted)', () => {
  // The pass only sets failingStateMonitorable when no attempt exists for the
  // basis. With the flag false (attempt present) the failing basis escalates.
  const exhausted = facts({ recoveryRemainsPossible: false, failingStateMonitorable: false });
  const decision = decideProgressionFromFacts(exhausted);
  assert.equal(decision.decision, 'ESCALATE');
  assert.equal(decision.reasonCode, 'no_safe_recovery_remaining');
});

test('A5 FIX-1: REPLAN outranks monitorable (replan-eligible is never merely watched)', () => {
  const decision = decideProgressionFromFacts(facts({ recoveryRemainsPossible: true, failingStateMonitorable: true }));
  assert.equal(decision.decision, 'REPLAN');
});

test('A5 FIX-1: authority/execution pending outranks monitorable', () => {
  const decision = decideProgressionFromFacts(facts({ authorityOrExecutionPending: true, failingStateMonitorable: true }));
  assert.equal(decision.decision, 'WAIT');
  assert.equal(decision.reasonCode, 'authority_or_execution_pending');
});

test('A5 FIX-1: a non-failing denial is not rescued by the monitorable flag', () => {
  // UNKNOWN verdict: currentStillFailing false, so monitorable does not apply.
  const decision = decideProgressionFromFacts(facts({
    gate: { allowed: false, reason: 'BLOCKING_UNKNOWN', detail: 'unknown' },
    currentAssessmentVerdict: 'UNKNOWN',
    failingStateMonitorable: true,
  }));
  assert.equal(decision.decision, 'ESCALATE');
  assert.equal(decision.reasonCode, 'human_evidence_or_decision_required');
});

test('non-failing denial (BLOCKING_UNKNOWN / CONSTRAINT_NOT_SATISFIED / ASSESSMENT_NOT_CURRENT) -> ESCALATE human_evidence_or_decision_required', () => {
  // A denial that is NOT a blocking FAIL is not "still failing" for replan
  // purposes; it needs human evidence or a decision, so it escalates.
  for (const reason of ['BLOCKING_UNKNOWN', 'CONSTRAINT_NOT_SATISFIED', 'ASSESSMENT_NOT_CURRENT'] as const) {
    const f = facts({ gate: { allowed: false, reason, detail: reason }, recoveryRemainsPossible: true });
    const input = toProgressionInput(f);
    assert.equal(input.currentStillFailing, false, reason);
    const decision = decideProgressionFromFacts(f);
    assert.equal(decision.decision, 'ESCALATE', reason);
    assert.equal(decision.reasonCode, 'human_evidence_or_decision_required', reason);
  }
});

test('CASE_NOT_OPEN (terminal) with recovery not possible -> ESCALATE, never RESOLVE/REPLAN', () => {
  const f = facts({ gate: { allowed: false, reason: 'CASE_NOT_OPEN', detail: 'terminal' }, recoveryRemainsPossible: false });
  const decision = decideProgressionFromFacts(f);
  assert.equal(decision.decision, 'ESCALATE');
  assert.equal(decision.reasonCode, 'human_evidence_or_decision_required');
});

test('idempotent: the same settled facts always yield the same decision', () => {
  const f = facts({ recoveryRemainsPossible: true });
  assert.deepEqual(decideProgressionFromFacts(f), decideProgressionFromFacts(facts({ recoveryRemainsPossible: true })));
  assert.deepEqual(toProgressionInput(f), toProgressionInput(facts({ recoveryRemainsPossible: true })));
});

test('mapper re-derives nothing: executionReconciled is false ONLY for a genuine unreconciled-execution denial', () => {
  // RESOLVE requires executionReconciled; the mapper sets it false only when the
  // gate denied specifically on EXECUTION_NOT_RECONCILED / ACTION_INTENT_NOT_COMPLETE.
  const unreconciled = toProgressionInput(facts({ gate: { allowed: false, reason: 'EXECUTION_NOT_RECONCILED', detail: '' } }));
  assert.equal(unreconciled.executionReconciled, false);
  const blocking = toProgressionInput(facts({ gate: { allowed: false, reason: 'BLOCKING_FAIL', detail: '' } }));
  // A blocking FAIL is not an unreconciled execution; executionReconciled stays
  // true so the decision is driven by currentStillFailing, not by a fabricated
  // reconciliation gap.
  assert.equal(blocking.executionReconciled, true);
  assert.equal(blocking.currentStillFailing, true);
});

test('explicit current verdict: a stale proposal never hides a newly failing basis behind PROPOSED_STATE_ONLY', () => {
  const stale = facts({
    gate: { allowed: false, reason: 'PROPOSED_STATE_ONLY', detail: 'old proposal' },
    currentAssessmentVerdict: 'FAIL',
    recoveryRemainsPossible: true,
  });
  assert.equal(decideProgressionFromFacts(stale).decision, 'REPLAN');
  // Once the owner flags authority pending for THIS basis, it waits instead.
  assert.equal(decideProgressionFromFacts({ ...stale, authorityOrExecutionPending: true }).decision, 'WAIT');
  // In-flight execution is pending regardless of the verdict.
  const inFlight = facts({ gate: { allowed: false, reason: 'EXECUTION_NOT_RECONCILED', detail: 'open attempt' }, currentAssessmentVerdict: 'FAIL', recoveryRemainsPossible: true });
  assert.equal(decideProgressionFromFacts(inFlight).decision, 'WAIT');
});

test('explicit current verdict: UNKNOWN escalates for human evidence; FAIL with no recovery escalates as no-safe-recovery', () => {
  const unknown = decideProgressionFromFacts(facts({ gate: { allowed: false, reason: 'BLOCKING_UNKNOWN', detail: 'unknown' }, currentAssessmentVerdict: 'UNKNOWN' }));
  assert.equal(unknown.decision, 'ESCALATE');
  assert.equal(unknown.reasonCode, 'human_evidence_or_decision_required');
  const failing = decideProgressionFromFacts(facts({ currentAssessmentVerdict: 'FAIL', recoveryRemainsPossible: false }));
  assert.equal(failing.decision, 'ESCALATE');
  assert.equal(failing.reasonCode, 'no_safe_recovery_remaining');
});

/**
 * NORTHSTAR M8 — Checkpoint-0 authority decision gates (pre-dispatch).
 *
 * Composes current-assessment and traveller-payer-currency checks that must
 * pass before any consequential approval or execution claim. Full grant /
 * envelope / budget machinery lands in the main M8 package; these gates are
 * the C2-mandated blockers that may not be bypassed.
 */
import type { AssessmentResult } from '../../contracts/v2/assessment/assessmentManifest.ts';
import type { AssessmentView } from '../../persistence/postgres/world/pgAssessments.ts';
import {
  requireCurrentAssessmentForDecision,
  type AssessmentGateDenial,
} from './assessmentGate.ts';
import {
  requireKnownPayerCurrencyForAuthority,
  type PayerCurrencyGateDenial,
} from './payerCurrencyGate.ts';

export type AuthorityDecisionDenial =
  | AssessmentGateDenial
  | PayerCurrencyGateDenial;

export type AuthorityDecisionGateResult =
  | { allowed: true; assessment: AssessmentResult }
  | AuthorityDecisionDenial;

/**
 * Decision-time gate for consequential authority:
 * 1. assessment must be CURRENT now;
 * 2. traveller payer home currency must not be UNKNOWN.
 *
 * Approval fingerprints and grants are checked by later M8 modules; they
 * cannot override a denial from this gate.
 */
export function evaluateAuthorityDecisionGates(view: AssessmentView): AuthorityDecisionGateResult {
  const current = requireCurrentAssessmentForDecision(view);
  if (!current.allowed) return current;
  const payer = requireKnownPayerCurrencyForAuthority(current.assessment);
  if (!payer.allowed) return payer;
  return { allowed: true, assessment: current.assessment };
}

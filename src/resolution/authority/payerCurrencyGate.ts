/**
 * NORTHSTAR M8 — G-B traveller payer / home currency gate.
 *
 * Architecture gap G-B: there is no authoritative Traveller payer/home
 * currency in the world model. The M6 funding evaluator correctly emits
 * blocking UNKNOWN `payer_home_currency_unknown`. Authority must not invent
 * a currency and must not approve or dispatch through that UNKNOWN.
 */
import type { AssessmentResult } from '../../contracts/v2/assessment/assessmentManifest.ts';
import type { CausalExplanation } from '../../contracts/v2/assessment/explanation.ts';

export const PAYER_HOME_CURRENCY_UNKNOWN_REASON = 'payer_home_currency_unknown' as const;
export const PAYER_HOME_CURRENCY_UNCERTAINTY_CODE = 'payer_home_currency' as const;

export type PayerCurrencyGateDenial = {
  allowed: false;
  reason: 'PAYER_HOME_CURRENCY_UNKNOWN';
  explanations: CausalExplanation[];
};

export type PayerCurrencyGatePass = { allowed: true };

export type PayerCurrencyGateResult = PayerCurrencyGatePass | PayerCurrencyGateDenial;

function fundingExplanations(assessment: AssessmentResult): CausalExplanation[] {
  const funding = assessment.dimensions.find((d) => d.dimension === 'funding');
  return funding?.explanations ?? [];
}

/** Explanations that prove traveller payer currency is missing (never invent one). */
export function payerHomeCurrencyUnknownExplanations(assessment: AssessmentResult): CausalExplanation[] {
  return fundingExplanations(assessment).filter(
    (e) =>
      e.reasonCode === PAYER_HOME_CURRENCY_UNKNOWN_REASON ||
      e.uncertainty.some((u) => u.code === PAYER_HOME_CURRENCY_UNCERTAINTY_CODE),
  );
}

/**
 * Authority boundary: if spend authority depends on a traveller-payer
 * allocation whose home currency is UNKNOWN, deny. Organisation-payer paths
 * that do not raise this reason are unaffected.
 */
export function requireKnownPayerCurrencyForAuthority(assessment: AssessmentResult): PayerCurrencyGateResult {
  const blocking = payerHomeCurrencyUnknownExplanations(assessment);
  if (blocking.length > 0) {
    return { allowed: false, reason: 'PAYER_HOME_CURRENCY_UNKNOWN', explanations: blocking };
  }
  return { allowed: true };
}

export function isPayerHomeCurrencyBlocking(assessment: AssessmentResult): boolean {
  return !requireKnownPayerCurrencyForAuthority(assessment).allowed;
}

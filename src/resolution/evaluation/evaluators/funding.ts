/**
 * NORTHSTAR M6 — L3 evaluator: `m6.funding`.
 *
 * Dimension `funding` (blocking), applicable when at least one cost
 * allocation is recorded on a reservation allocated to the Journey (an
 * allocation whose line's reservation carries a WCostAllocation row, and
 * whose line is allocated either to one of this Journey's items or directly
 * to this Journey's traveller).
 *
 * Organisation payer: the total of that organisation's budget commitments
 * (INTENDED/ACTUAL/HELD, in the budget's own currency) plus this allocation's
 * own amount (converted into the budget's currency using the allocation's
 * cited FX observation when currencies differ) is compared against the
 * budget amount. Traveller payer: always UNKNOWN `payer_home_currency_unknown`
 * — no authoritative traveller home currency exists anywhere in the captured
 * world (an M3 gap named directly in M6_EVALUATOR_CONTRACT.md §2 L3); a
 * currency is never invented.
 *
 * Exact money / FX conversion uses the shared I-10 seam in
 * `src/domain/v2/shared/money.ts` (`currencyExponent`, `convertExactMoney`,
 * `addExactMoney`, `compareExactMoney`). This file must not reimplement
 * BigInt decimal arithmetic.
 *
 * Pure: reads only `(subject, { now, world, effective })`, no I/O.
 */
import type { TypedRef } from '../../../domain/v2/shared/identity.ts';
import type { Instant } from '../../../domain/v2/shared/time.ts';
import { compareInstants } from '../../../domain/v2/shared/time.ts';
import {
  addExactMoney,
  compareExactMoney,
  convertExactMoney,
  type ExactMoney,
  type FxObservation,
} from '../../../domain/v2/shared/money.ts';
import type { CapturedWorld, WBudget, WCostAllocation } from '../../world/world.ts';
import type { Evaluator, EvaluatorOutput } from '../evaluator.ts';
import { dimension, explain, notApplicable, earliestAfter } from '../explain.ts';
import type { CausalExplanation, EvidenceRef } from '../../../contracts/v2/assessment/explanation.ts';

const EVALUATOR_ID = 'm6.funding';
const DIMENSION = 'funding';

function dedupeEvidence(refs: EvidenceRef[]): EvidenceRef[] {
  const map = new Map<string, EvidenceRef>();
  for (const r of refs) map.set(`${r.kind}:${r.id}:${r.detail ?? ''}`, r);
  return [...map.values()].sort((a, b) => `${a.kind}:${a.id}:${a.detail ?? ''}`.localeCompare(`${b.kind}:${b.id}:${b.detail ?? ''}`));
}

function budgetValidAt(budget: WBudget, now: Instant): boolean {
  const afterStart = budget.valid.start === null || compareInstants(now, budget.valid.start) >= 0;
  const beforeEnd = budget.valid.end === null || compareInstants(now, budget.valid.end) < 0;
  return afterStart && beforeEnd;
}

function applicableCostAllocations(journeyId: string, travellerId: string, world: CapturedWorld): (WCostAllocation & { reservationId: string })[] {
  const itemIds = new Set(world.journeyItems.filter((i) => i.journeyId === journeyId).map((i) => i.id));
  const reservationIds = new Set<string>();
  for (const line of world.reservationLines) {
    const hasAllocation = world.allocations.some((a) => a.lineId === line.id && (
      (a.journeyItemId !== null && itemIds.has(a.journeyItemId)) ||
      (a.journeyItemId === null && a.travellerId === travellerId)
    ));
    if (hasAllocation) reservationIds.add(line.reservationId);
  }
  return world.costAllocations
    .filter((c): c is WCostAllocation & { reservationId: string } => c.reservationId !== null && reservationIds.has(c.reservationId))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export const fundingEvaluator: Evaluator = {
  id: EVALUATOR_ID,
  version: '1',
  assessmentKind: 'VIABILITY',
  subjectKinds: ['JOURNEY'],
  dimensions: [DIMENSION],
  informationTopics: [],
  evaluate(subject, { now, world }): EvaluatorOutput {
    const journey = world.journeys.find((j) => j.id === subject.id);
    if (!journey) return { dimensions: [notApplicable(DIMENSION)], evidence: [], missingCoverage: [] };

    const allocations = applicableCostAllocations(journey.id, journey.travellerId, world);
    if (allocations.length === 0) return { dimensions: [notApplicable(DIMENSION)], evidence: [], missingCoverage: [] };

    const explanations: CausalExplanation[] = [];
    const invalidations: (Instant | undefined)[] = [];

    for (const allocation of allocations) {
      const reservationRef: TypedRef = { kind: 'RESERVATION', id: allocation.reservationId };
      const allocationEvidence: EvidenceRef[] = allocation.evidenceId ? [{ kind: 'EVIDENCE_RECORD', id: allocation.evidenceId }] : [];

      if (allocation.payerTravellerId) {
        const payerRef: TypedRef = { kind: 'TRAVELLER', id: allocation.payerTravellerId };
        explanations.push(explain({
          evaluatorId: EVALUATOR_ID, dimension: DIMENSION, status: 'UNKNOWN', reasonCode: 'payer_home_currency_unknown',
          cause: { kind: 'MISSING_INFORMATION' }, affectedSubject: subject, relatedSubjects: [reservationRef, payerRef],
          evidenceRefs: allocationEvidence,
          facts: { allocationAmount: allocation.amount, allocationCurrency: allocation.currency, payerTravellerId: allocation.payerTravellerId },
          uncertainty: [{ kind: 'MISSING_INPUT', code: 'payer_home_currency', subjectRef: payerRef }],
        }));
        continue;
      }

      if (!allocation.payerOrganisationId) continue; // neither payer type recorded: nothing this dimension can claim

      const orgRef: TypedRef = { kind: 'ORGANISATION', id: allocation.payerOrganisationId };
      const candidateBudgets = world.budgets
        .filter((b) => b.organisationId === allocation.payerOrganisationId && budgetValidAt(b, now))
        .sort((a, b) => a.id.localeCompare(b.id));

      if (candidateBudgets.length === 0) {
        explanations.push(explain({
          evaluatorId: EVALUATOR_ID, dimension: DIMENSION, status: 'UNKNOWN', reasonCode: 'budget_missing',
          cause: { kind: 'MISSING_INFORMATION' }, affectedSubject: subject, relatedSubjects: [reservationRef, orgRef],
          evidenceRefs: allocationEvidence,
          facts: { allocationAmount: allocation.amount, allocationCurrency: allocation.currency, organisationId: allocation.payerOrganisationId },
          uncertainty: [{ kind: 'MISSING_INPUT', code: 'budget', subjectRef: orgRef }],
        }));
        continue;
      }

      for (const budget of candidateBudgets) {
        const budgetRef: TypedRef = { kind: 'BUDGET', id: budget.id };
        if (budget.valid.end) invalidations.push(budget.valid.end);

        let fxEvidence: EvidenceRef[] = [];
        const fxRow = allocation.fxObservationId
          ? world.fxObservations.find((f) => f.id === allocation.fxObservationId)
          : undefined;
        const fx: FxObservation | undefined = fxRow
          ? {
              id: fxRow.id,
              baseCurrency: fxRow.baseCurrency,
              quoteCurrency: fxRow.quoteCurrency,
              rate: fxRow.rate,
              asOf: fxRow.asOf,
              // World capture carries edition identity; FxObservation.sourceId is the evidence lineage key.
              sourceId: fxRow.edition,
              ...(fxRow.expiresAt ? { expiresAt: fxRow.expiresAt } : {}),
            }
          : undefined;
        const converted = convertExactMoney(
          { amount: allocation.amount, currency: allocation.currency as ExactMoney['currency'] },
          budget.currency as ExactMoney['currency'],
          fx,
          { now },
        );
        if (!converted.ok) {
          explanations.push(explain({
            evaluatorId: EVALUATOR_ID, dimension: DIMENSION, status: 'UNKNOWN', reasonCode: 'fx_missing',
            cause: { kind: 'MISSING_INFORMATION' }, affectedSubject: subject, relatedSubjects: [reservationRef, orgRef, budgetRef],
            evidenceRefs: allocationEvidence,
            facts: {
              allocationAmount: allocation.amount, allocationCurrency: allocation.currency, budgetCurrency: budget.currency,
              ...(fx ? { fxObservationId: fx.id, fxFailure: converted.reason } : { fxFailure: converted.reason }),
            },
            uncertainty: [{ kind: 'MISSING_INPUT', code: 'fx_observation', subjectRef: reservationRef }],
          }));
          if (fx?.expiresAt) invalidations.push(fx.expiresAt);
          continue;
        }
        const allocationInBudgetCurrency = converted.money.amount;
        if (allocation.currency !== budget.currency) {
          fxEvidence = [{ kind: 'AGGREGATE_REVISION', id: converted.fxObservationId, detail: 'fx_observation' }];
          if (fx?.expiresAt) invalidations.push(fx.expiresAt);
        }

        const commitments = world.budgetCommitments.filter(
          (c) => c.budgetId === budget.id && c.currency === budget.currency && (c.status === 'INTENDED' || c.status === 'ACTUAL' || c.status === 'HELD'),
        );
        let total: ExactMoney = { amount: '0', currency: budget.currency };
        for (const c of commitments) total = addExactMoney(total, { amount: c.amount, currency: c.currency });
        total = addExactMoney(total, { amount: allocationInBudgetCurrency, currency: budget.currency });

        const withinBudget = compareExactMoney(total, { amount: budget.amount, currency: budget.currency }) <= 0;
        explanations.push(explain({
          evaluatorId: EVALUATOR_ID, dimension: DIMENSION, status: withinBudget ? 'PASS' : 'FAIL',
          reasonCode: withinBudget ? 'within_budget' : 'budget_exceeded',
          cause: { kind: 'WORLD_STATE' }, affectedSubject: subject, relatedSubjects: [reservationRef, orgRef, budgetRef],
          evidenceRefs: [...allocationEvidence, ...fxEvidence, { kind: 'AGGREGATE_REVISION', id: budget.id, detail: 'budget' }],
          facts: {
            totalCommitted: total.amount, budgetAmount: budget.amount, budgetCurrency: budget.currency,
            allocationAmountInBudgetCurrency: allocationInBudgetCurrency,
          },
        }));
      }
    }

    // Every allocation carried neither payer type: nothing was actually evaluated
    // (each iteration `continue`d without a claim). `dimension()` on an empty
    // explanation list still reports `applicable: true` with an UNKNOWN verdict
    // and no explanation/reasonCode/uncertainty behind it — a blocking dimension
    // with nothing to show is worse than contract rule 2 ("absence is never
    // PASS"); it is absence with no signal at all. Report not-applicable instead,
    // matching "No allocations ⇒ not applicable" for this equivalent case.
    if (explanations.length === 0) {
      return { dimensions: [notApplicable(DIMENSION)], evidence: [], missingCoverage: [] };
    }

    const evidence = dedupeEvidence(explanations.flatMap((e) => e.evidenceRefs));
    return {
      dimensions: [dimension({ dimension: DIMENSION, explanations })],
      evidence, missingCoverage: [],
      nextInvalidationAt: earliestAfter(now, invalidations),
    };
  },
};

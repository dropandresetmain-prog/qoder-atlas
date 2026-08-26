/**
 * A4 — deterministic authority engine (FR-10, ARCHITECTURE.md §12).
 *
 * Identical intent + context always yields an identical AuthorityDecision
 * (decidedAt derives from the intent, never a wall clock). Rule evaluation
 * order is deterministic: rule sets in context order, rules in array order.
 * Spend thresholds, approval requirements, delegated spend authority and
 * side-effect level fully determine the outcome — there is no model call on
 * this path.
 */
import type { EntityId, EntityRef, IsoDateTime, Money } from '../domain/common.ts';
import { RuleSetSchema, type RuleSet, type PolicyRule, type ApproverPrincipal } from '../domain/rules.ts';
import {
  FxRateEvidenceSchema,
  fxNormalizeSpend,
  isFxNormalizationFailure,
  type FxNormalizedSpend,
  type FxRateEvidence,
} from './fx.ts';
import type { ActionIntent, AuthorityDecision, AuthorityOutcome } from '../operational/intent.ts';
import type { AuthorityContext, AuthorityEngine, PrincipalRecord } from '../contracts/services.ts';

export interface RuleSetSource {
  getRuleSet(id: EntityId): Promise<RuleSet | undefined>;
}

/** Adapt any entity store to the engine seam; payloads are re-validated. */
export function ruleSetSource(store: {
  get(entityType: 'RULE_SET', id: EntityId): Promise<{ entityType: string; entity: unknown } | undefined>;
}): RuleSetSource {
  return {
    getRuleSet: async (id) => {
      const entry = await store.get('RULE_SET', id);
      if (entry && entry.entityType === 'RULE_SET') return RuleSetSchema.parse(entry.entity);
      return undefined;
    },
  };
}

const APPROVER_OUTCOME: Record<ApproverPrincipal, AuthorityOutcome> = {
  TRAVELLER: 'REQUIRES_TRAVELLER',
  ORGANISATION_APPROVER: 'REQUIRES_ORGANISATION_APPROVER',
  HUMAN_AGENT: 'REQUIRES_HUMAN_AGENT',
};

const APPROVER_ENTITY_TYPES: Record<ApproverPrincipal, readonly string[]> = {
  TRAVELLER: ['TRAVELLER'],
  ORGANISATION_APPROVER: ['ORGANISATION'],
  HUMAN_AGENT: ['ORGANISATION', 'TRAVELLER'],
};

/** Permission string granting a principal delegated approval authority. */
export const ACTION_APPROVAL_PERMISSION = 'ACTION_APPROVAL';

export class DeterministicAuthorityEngine implements AuthorityEngine {
  private readonly ruleSets: RuleSetSource;

  constructor(deps: { ruleSets: RuleSetSource }) {
    this.ruleSets = deps.ruleSets;
  }

  async decide(intent: ActionIntent, context: AuthorityContext): Promise<AuthorityDecision> {
    const ruleTrace: string[] = [];
    const conditions: string[] = [`sideEffectLevel=${intent.sideEffectLevel}`, `operation=${intent.operation}`];

    if (intent.sideEffectLevel === 'READ_ONLY') {
      return this.decision(intent, 'AUTO_APPROVED', ['read-only operation requires no authority'], conditions);
    }

    const rules = await this.scopedRules(context.ruleSetIds);
    // ADR-048: spend rules evaluate the GROSS provider charge the action will
    // pay or commit (spendExposure), never the incremental priceDelta. Money-
    // moving actions must carry a deterministic gross spend before authority
    // permits them: a missing exposure is not "no spend" — it is unreviewed
    // spend, which fails closed.
    const spend = intent.spendExposure;
    if (intent.sideEffectLevel === 'MONEY_MOVING' && !spend) {
      ruleTrace.push(
        'money-moving intent carries no deterministic spendExposure; the gross charge authority would' +
          ' review is unknown and cannot execute unreviewed; fail closed',
      );
      return this.decision(intent, 'BLOCKED', ruleTrace, conditions);
    }
    if (spend) conditions.push(`spendExposure=${spend.amount} ${spend.currency}`);
    if (intent.priceDelta) {
      conditions.push(`priceDelta=${intent.priceDelta.amount} ${intent.priceDelta.currency}`);
    }

    // ADR-052: normalize a non-home gross spend into the organisation home
    // currency BEFORE rule evaluation. Same-currency spends pass through with
    // an exact identity record; cross-currency spends need evidenced, effective,
    // trusted rate data — any gap is structured failure data and BLOCKS below.
    // The provider amount on the intent stays untouched: normalization only
    // restates what policy compares against, never what the executor pays.
    const normalization = this.normalizeForPolicy(intent, spend, context, ruleTrace);
    if (normalization.status === 'BLOCKED') {
      return this.decision(intent, 'BLOCKED', ruleTrace, conditions);
    }
    const homeSpend = normalization.status === 'NORMALIZED' ? normalization.spend : undefined;

    // 1. Hard spend ceiling: breaching it blocks execution outright. A
    //    binding ceiling whose currency cannot be deterministically compared
    //    to the spend MUST fail closed (DR-1.3, ADR-045): "cannot compare" is
    //    never "within limit", and authority invents no FX conversion. With
    //    FX evidence present (ADR-052) the comparison runs against either
    //    deterministically-known statement of the charge: the frozen original
    //    provider amount or its home-currency restatement.
    const knownSpendStatements = [spend, intent.providerSpend].filter(
      (candidate): candidate is Money => candidate !== undefined,
    );
    for (const rule of rules) {
      if (rule.kind !== 'SPEND_LIMIT' || !spend) continue;
      const comparable = this.comparableAgainst(rule.maxAmount, knownSpendStatements, homeSpend);
      if (comparable === undefined) {
        ruleTrace.push(
          `rule ${rule.id}: hard spend limit currency ${rule.maxAmount.currency} is not deterministically` +
            ` comparable to spend currencies ${knownSpendStatements.map((c) => c.currency).join('/')}; fail closed`,
        );
        return this.decision(intent, 'BLOCKED', ruleTrace, conditions);
      }
      // The MOST PROTECTIVE statement governs: when both the provider amount
      // and its home restatement are comparable, the larger one decides, so a
      // favourable FX restatement can never launder a breach past the ceiling.
      if (comparable > rule.maxAmount.amount) {
        ruleTrace.push(`rule ${rule.id}: spend ${comparable} exceeds limit ${rule.maxAmount.amount}`);
        return this.decision(intent, 'BLOCKED', ruleTrace, conditions);
      }
      ruleTrace.push(`rule ${rule.id}: spend ${comparable} within limit ${rule.maxAmount.amount}`);
    }

    // 2. Explicit approval requirements (operation-scoped first).
    let required: { approver: ApproverPrincipal; ruleId: EntityId } | undefined;
    for (const rule of rules) {
      if (rule.kind === 'APPROVAL_REQUIRED') {
        if (rule.operations && !rule.operations.includes(intent.operation)) continue;
        required = { approver: rule.approver, ruleId: rule.id };
        ruleTrace.push(`rule ${rule.id}: approval required for ${intent.operation}`);
        break;
      }
    }
    // 3. Spend-threshold approvals. An incomparable threshold currency fails
    //    toward requiring approval (DR-1.3, ADR-045): the system can never
    //    verify the spend is BELOW the threshold, so skipping it would turn
    //    "cannot compare" into unsafe auto-execution.
    if (!required && spend) {
      const knownSpendStatements = [spend, intent.providerSpend].filter(
        (candidate): candidate is Money => candidate !== undefined,
      );
      for (const rule of rules) {
        if (rule.kind !== 'APPROVAL_ABOVE_SPEND') continue;
        const comparable = this.comparableAgainst(rule.threshold, knownSpendStatements, homeSpend);
        // An incomparable threshold currency fails toward requiring approval
        // (DR-1.3, ADR-045): "cannot verify it is below" never auto-executes.
        if (comparable === undefined) {
          required = { approver: rule.approver, ruleId: rule.id };
          ruleTrace.push(
            `rule ${rule.id}: approval threshold currency ${rule.threshold.currency} not comparable to spend` +
              ` currencies ${knownSpendStatements.map((c) => c.currency).join('/')}; cannot verify spend is below` +
              ' threshold, approval required',
          );
          break;
        }
        // Mirror of the ceiling discipline: the MOST DEMANDING statement
        // governs, so a favourable restatement cannot hide an above-threshold
        // provider charge.
        if (comparable > rule.threshold.amount) {
          required = { approver: rule.approver, ruleId: rule.id };
          ruleTrace.push(`rule ${rule.id}: spend ${comparable} above approval threshold ${rule.threshold.amount}`);
          break;
        }
      }
    }

    if (required) {
      // 4. Delegated spend authority may satisfy the requirement
      //    deterministically — explicit permission plus a covering limit.
      const delegate = this.delegatedPrincipal(required.approver, spend, context.principals);
      if (delegate) {
        ruleTrace.push(
          `delegated authority: principal ${delegate.ref.id} holds ${ACTION_APPROVAL_PERMISSION}` +
            (delegate.delegatedSpendLimit
              ? ` with limit ${delegate.delegatedSpendLimit.amount} ${delegate.delegatedSpendLimit.currency}`
              : ''),
        );
        return this.decision(intent, 'AUTO_APPROVED', ruleTrace, conditions);
      }
      return this.decision(intent, APPROVER_OUTCOME[required.approver], ruleTrace, conditions);
    }

    // 5. Default policy: reversible side effects are auto-approved; anything
    //    irreversible or money-moving requires the affected traveller.
    if (intent.sideEffectLevel === 'REVERSIBLE') {
      ruleTrace.push('reversible side effect with no approval rule: auto-approved');
      return this.decision(intent, 'AUTO_APPROVED', ruleTrace, conditions);
    }
    ruleTrace.push('irreversible/money-moving action defaults to traveller authority');
    return this.decision(intent, 'REQUIRES_TRAVELLER', ruleTrace, conditions);
  }

  private delegatedPrincipal(
    approver: ApproverPrincipal,
    spend: Money | undefined,
    principals: PrincipalRecord[],
  ): PrincipalRecord | undefined {
    const allowedTypes = APPROVER_ENTITY_TYPES[approver];
    for (const principal of principals) {
      if (!principal.permissions.includes(ACTION_APPROVAL_PERMISSION)) continue;
      if (!allowedTypes.includes(principal.ref.entityType)) continue;
      if (spend && principal.delegatedSpendLimit) {
        // Delegated limits stay same-currency only (ADR-045 discipline): a
        // delegate whose limit is in a different currency than the reviewed
        // spend cannot cover it, even when FX data exists.
        if (principal.delegatedSpendLimit.currency !== spend.currency) continue;
        if (principal.delegatedSpendLimit.amount < spend.amount) continue;
      }
      return principal;
    }
    return undefined;
  }

  /**
   * ADR-052 seam: restate a non-home gross spend into the context's home
   * currency using evidenced rates. Outcomes:
   *  - `BLOCKED`: a cross-currency spend could NOT be normalized (missing,
   *    expired or untrusted evidence) — the caller fails closed;
   *  - `NORMALIZED`: a home restatement exists (identity for same-currency);
   *  - `NOT_NEEDED`: no home currency configured, no spend, or already in
   *    home currency — the legacy same-currency-only behaviour applies.
   *
   * Invalid evidence entries on the context are dropped, never partially
   * trusted: a malformed rate behaves like a missing one.
   */
  private normalizeForPolicy(
    intent: ActionIntent,
    spend: Money | undefined,
    context: AuthorityContext,
    ruleTrace: string[],
  ):
    | { status: 'NOT_NEEDED' }
    | { status: 'BLOCKED'; reason: string }
    | { status: 'NORMALIZED'; spend?: FxNormalizedSpend } {
    if (!spend || !context.homeCurrency) return { status: 'NOT_NEEDED' };
    if (spend.currency === context.homeCurrency) return { status: 'NOT_NEEDED' };

    const candidates: FxRateEvidence[] = [];
    if (Array.isArray(context.fxRates)) {
      for (const candidate of context.fxRates) {
        const parsed = FxRateEvidenceSchema.safeParse(candidate);
        if (parsed.success) candidates.push(parsed.data);
      }
    }
    const outcome = fxNormalizeSpend({
      providerSpend: spend,
      homeCurrency: context.homeCurrency,
      at: intent.createdAt,
      candidates,
    });
    if (!isFxNormalizationFailure(outcome)) {
      ruleTrace.push(
        `fx normalization: ${outcome.providerAmount.amount} ${outcome.providerAmount.currency} = ` +
          `${outcome.homeSpend.amount} ${outcome.homeSpend.currency} via rate evidence ${outcome.fxSourceId}` +
          ` effective at ${intent.createdAt}`,
      );
      return { status: 'NORMALIZED', spend: outcome };
    }
    ruleTrace.push(
      `fx normalization failed (${outcome.code}): ${outcome.reason}; cannot compare against home-currency` +
        ' policy; fail closed',
    );
    return { status: 'BLOCKED', reason: outcome.reason };
  }

  /**
   * Compare a rule amount against every deterministically-known statement of
   * the spend: the raw provider amount(s) on the intent and, when
   * normalization succeeded, its home restatement. When several statements
   * are comparable in the rule's currency, the LARGEST governs — the most
   * protective reading. No statement matches => undefined ("not
   * deterministically comparable"); each caller applies its own fail direction.
   */
  private comparableAgainst(
    ruleAmount: Money,
    spendStatements: readonly Money[],
    homeSpend: FxNormalizedSpend | undefined,
  ): number | undefined {
    const candidates = [...spendStatements];
    if (homeSpend) candidates.push(homeSpend.homeSpend);
    let best: number | undefined;
    for (const candidate of candidates) {
      if (candidate.currency !== ruleAmount.currency) continue;
      if (best === undefined || candidate.amount > best) best = candidate.amount;
    }
    return best;
  }

  private async scopedRules(ruleSetIds: EntityId[]): Promise<PolicyRule[]> {
    const rules: PolicyRule[] = [];
    for (const id of ruleSetIds) {
      const ruleSet = await this.ruleSets.getRuleSet(id);
      if (ruleSet) rules.push(...ruleSet.rules);
    }
    return rules;
  }

  private decision(
    intent: ActionIntent,
    outcome: AuthorityOutcome,
    ruleTrace: string[],
    conditions: string[],
  ): AuthorityDecision {
    return {
      id: `authority-${intent.id}`,
      intentId: intent.id,
      outcome,
      decidedAt: intent.createdAt,
      ruleTrace,
      conditions,
    };
  }
}

/**
 * Record an approval on an existing decision. Pure: returns a new decision;
 * the execution gate (executionGateIssues) remains the only proof an
 * executor accepts.
 */
export function withApproval(
  decision: AuthorityDecision,
  decidedBy: EntityRef,
  decidedAt: IsoDateTime,
  verdict: 'APPROVED' | 'DECLINED',
  note?: string,
): AuthorityDecision {
  return {
    ...decision,
    approval: { decidedAt, decidedBy, decision: verdict, note },
  };
}

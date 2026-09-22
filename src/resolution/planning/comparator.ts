/**
 * NORTHSTAR R1 — viable-only strategy comparator / recommendation selector
 * (freeze C6). This is the comparator implementation the freeze says "lives in
 * the planner lane".
 *
 * Hard boundaries this module keeps structurally true:
 *   - it selects ONLY among candidates it is handed; the coordinator hands it
 *     current VIABLE strategies of one case and nothing else. It cannot turn a
 *     non-viable, stale or foreign candidate into a recommendation, and
 *     `validateStrategyRecommendation` re-checks that before it returns.
 *   - hard constraints are already enforced by RC-6 BEFORE comparison and are
 *     never re-litigated here. Every candidate that reaches this module is
 *     already VIABLE, so selection among them is genuinely a matter of
 *     preference + soft deterministic facts + convenience.
 *   - there is NO scalar LLM "viability score" anywhere. Ranking is a
 *     deterministic tuple: precedence-ordered explicit-preference alignment,
 *     then deterministic facts (regressions, declared total exposure,
 *     improvements, blast radius), then a stable strategyRef tiebreak.
 *   - explicit preferences outrank inferred ones: an inferred preference is
 *     demoted by `orderComparatorPreferences`, so it can never outrank an
 *     explicit traveller/organisation preference even if mislabelled.
 *   - optional semantic notes may EXPLAIN a choice (SEMANTIC_JUDGEMENT basis /
 *     tradeoffs) but never affect the ranking. AI judgement cannot override a
 *     deterministic fact.
 *
 * Pure: no PostgreSQL, no provider, no model call, no scenario branch. The
 * planner computes the deterministic facts from canonical captured state and
 * passes them in.
 */
import type { SubjectId } from '../../domain/v2/shared/identity.ts';
import {
  orderComparatorPreferences,
  validateStrategyRecommendation,
  type ComparatorPreference,
  type RecommendationBasis,
  type StrategyRecommendation,
  type StrategyTradeoff,
  type ViableStrategyCandidate,
} from '../../contracts/v2/planning/strategyRecommendation.ts';

/**
 * The deterministic, planner-computed facts about ONE viable candidate that the
 * comparator may rank on. All counts are derived from the RC-6 outcome delta and
 * impact projections (see decisionEvidence.ts) — never from an LLM.
 */
export interface CandidateComparisonFacts {
  strategyRef: SubjectId;
  /** Subjects whose verdict WORSENED under this candidate (regressions). Fewer is better. */
  worseCount: number;
  /** Subjects whose verdict IMPROVED. More is better. */
  betterCount: number;
  /** Size of the immediate change blast radius (changed + directly affected). Smaller is better. */
  blastRadiusSize: number;
  /**
   * Declared cost in minor units, when the candidate has one.
   * A priced action with no usable evidence leaves this absent and sorts LAST
   * (unknown exposure is never treated as free). An internal strategy with no
   * monetary effects at all is known-zero and must pass `0`, not omit the field.
   */
  declaredCostMinorUnits?: number;
  /**
   * Largest absolute programme-item start shift, in milliseconds, when the
   * candidate moves programme time. Smaller is a nearer swap. Absent means this
   * candidate is not a programme-time move, so it does not participate in this
   * tiebreak. It never outranks regressions, cost, or an explicit preference.
   */
  scheduleDisplacementMs?: number;
  /**
   * Preference codes this candidate deterministically satisfies, computed from
   * canonical state (e.g. "keeps the session inside the traveller's declared
   * availability window"). Matched against comparator preferences by precedence.
   */
  satisfiedPreferenceCodes?: readonly string[];
  /**
   * Optional semantic notes that may explain the choice but NEVER affect
   * ranking. Recorded as SEMANTIC_JUDGEMENT basis / tradeoff text.
   */
  semanticNotes?: readonly string[];
}

export interface SelectRecommendationInput {
  recoveryCaseId: SubjectId;
  /** The current VIABLE candidate set of one case (the coordinator's only input). */
  viableCandidates: readonly ViableStrategyCandidate[];
  /** Deterministic facts per candidate. A candidate with no facts ranks last. */
  facts: readonly CandidateComparisonFacts[];
  /** Preference inputs, labelled with precedence and inferred-ness. */
  preferences?: readonly ComparatorPreference[];
  /** Version of this deterministic comparator, recorded in provenance. */
  comparatorVersion: string;
}

const NO_FACTS: Omit<CandidateComparisonFacts, 'strategyRef'> = {
  worseCount: Number.MAX_SAFE_INTEGER,
  betterCount: 0,
  blastRadiusSize: Number.MAX_SAFE_INTEGER,
};

/**
 * Rank viable candidates deterministically and build the validated
 * recommendation. Returns `undefined` when there is no viable candidate — a
 * refusal, never a silent pick. The coordinator maps that to a
 * NEEDS_EVIDENCE_OR_DECISION / NO_RECOVERY_FOUND outcome.
 */
export function selectRecommendation(
  input: SelectRecommendationInput,
): StrategyRecommendation | undefined {
  const usable = input.viableCandidates.filter(
    (c) => c.viability === 'VIABLE' && !c.stale && c.recoveryCaseId === input.recoveryCaseId,
  );
  if (usable.length === 0) return undefined;

  const orderedPrefs = orderComparatorPreferences(input.preferences ?? []);
  const factsByRef = new Map(input.facts.map((f) => [f.strategyRef, f]));
  const usableRefs = usable.map((c) => c.strategyRef);

  const ranked = [...usableRefs].sort((a, b) =>
    compareCandidates(a, b, orderedPrefs, factsByRef),
  );

  const [recommended, ...alternatives] = ranked;
  const recommendedFacts = factsByRef.get(recommended!);

  const recommendation: StrategyRecommendation = {
    recommendedStrategyRef: recommended!,
    alternativeStrategyRefs: alternatives,
    recommendationBasis: buildBasis(recommendedFacts, orderedPrefs),
    tradeoffs: buildTradeoffs(ranked, factsByRef),
    uncertainty: [],
    evidenceRefs: [],
    provenance: { kind: 'DETERMINISTIC', comparatorVersion: input.comparatorVersion },
  };

  // Re-validate against the same boundary the contract enforces: a programming
  // error that let a non-viable/foreign ref through must fail loudly, never
  // silently recommend it.
  const validation = validateStrategyRecommendation({
    recommendation,
    recoveryCaseId: input.recoveryCaseId,
    viableCandidates: input.viableCandidates,
  });
  if (!validation.ok) {
    throw new Error(
      `selectRecommendation produced an invalid recommendation: ${validation.reason}${validation.strategyRef ? ` (${validation.strategyRef})` : ''}`,
    );
  }
  return recommendation;
}

/**
 * Deterministic candidate ordering. Precedence-ordered preference alignment
 * dominates (lexicographic over the ordered preference list), then deterministic
 * facts, then a stable strategyRef tiebreak so the result never depends on input
 * order.
 */
function compareCandidates(
  a: SubjectId,
  b: SubjectId,
  orderedPrefs: readonly ComparatorPreference[],
  factsByRef: ReadonlyMap<SubjectId, CandidateComparisonFacts>,
): number {
  const fa = factsByRef.get(a);
  const fb = factsByRef.get(b);

  // 1. Preference alignment in precedence order: the first preference on which
  //    the two candidates differ decides. Explicit preferences are already
  //    ordered ahead of inferred ones by orderComparatorPreferences.
  for (const pref of orderedPrefs) {
    const sa = fa?.satisfiedPreferenceCodes?.includes(pref.code) ? 1 : 0;
    const sb = fb?.satisfiedPreferenceCodes?.includes(pref.code) ? 1 : 0;
    if (sa !== sb) return sb - sa;
  }

  const na = { ...NO_FACTS, ...fa };
  const nb = { ...NO_FACTS, ...fb };

  // 2. Fewer regressions wins. Unacceptable regressions beat saving money.
  if (na.worseCount !== nb.worseCount) return na.worseCount - nb.worseCount;
  // 3. Lower declared total exposure wins. Absent cost sorts last (never free).
  const ca = na.declaredCostMinorUnits ?? Number.MAX_SAFE_INTEGER;
  const cb = nb.declaredCostMinorUnits ?? Number.MAX_SAFE_INTEGER;
  if (ca !== cb) return ca - cb;
  // 4. More improvements wins.
  if (na.betterCount !== nb.betterCount) return nb.betterCount - na.betterCount;
  // 5. Smaller immediate blast radius wins, only after cost.
  if (na.blastRadiusSize !== nb.blastRadiusSize) return na.blastRadiusSize - nb.blastRadiusSize;
  // 6. Among programme-time moves, the smaller schedule shift wins. This sits
  //    ahead of the stable ref so a nearer slot is not lost to identifier order.
  if (na.scheduleDisplacementMs !== undefined && nb.scheduleDisplacementMs !== undefined
    && na.scheduleDisplacementMs !== nb.scheduleDisplacementMs) {
    return na.scheduleDisplacementMs - nb.scheduleDisplacementMs;
  }
  // 7. Stable tiebreak.
  return a.localeCompare(b);
}

/**
 * Typed recommendation basis. Satisfied EXPLICIT preferences are labelled
 * EXPLICIT_PREFERENCE; the deterministic facts that drove the ranking are
 * labelled DETERMINISTIC_FACT; any semantic notes are labelled
 * SEMANTIC_JUDGEMENT and are clearly subordinate (they never ranked anything).
 */
function buildBasis(
  facts: CandidateComparisonFacts | undefined,
  orderedPrefs: readonly ComparatorPreference[],
): RecommendationBasis[] {
  const basis: RecommendationBasis[] = [];
  const satisfied = new Set(facts?.satisfiedPreferenceCodes ?? []);
  for (const pref of orderedPrefs) {
    if (!satisfied.has(pref.code)) continue;
    const explicit = !pref.inferred && (pref.priority === 'EXPLICIT_TRAVELLER' || pref.priority === 'EXPLICIT_ORGANISATION_POLICY');
    basis.push({
      code: pref.code,
      summary: pref.summary,
      kind: explicit ? 'EXPLICIT_PREFERENCE' : 'DETERMINISTIC_FACT',
    });
  }
  if (facts) {
    basis.push({
      code: 'deterministic_comparison',
      summary: `selected among viable candidates: ${facts.worseCount} regression(s), ${facts.betterCount} improvement(s), blast radius ${facts.blastRadiusSize}${facts.declaredCostMinorUnits === undefined ? '' : `, declared total exposure ${facts.declaredCostMinorUnits} minor unit(s)`}`,
      kind: 'DETERMINISTIC_FACT',
    });
  }
  for (const note of facts?.semanticNotes ?? []) {
    basis.push({ code: 'semantic_judgement', summary: note, kind: 'SEMANTIC_JUDGEMENT' });
  }
  return basis;
}

/** Per-candidate tradeoffs in rank order (recommended first). */
function buildTradeoffs(
  ranked: readonly SubjectId[],
  factsByRef: ReadonlyMap<SubjectId, CandidateComparisonFacts>,
): StrategyTradeoff[] {
  return ranked.map((ref) => {
    const facts = factsByRef.get(ref);
    const advantages: string[] = [];
    const disadvantages: string[] = [];
    if (facts) {
      if (facts.betterCount > 0) advantages.push(`${facts.betterCount} subject(s) improve`);
      if (facts.worseCount === 0) advantages.push('no regressions among reassessed subjects');
      if (facts.worseCount > 0) disadvantages.push(`${facts.worseCount} subject(s) regress`);
      if (facts.declaredCostMinorUnits !== undefined) disadvantages.push(`declared total exposure ${facts.declaredCostMinorUnits} minor unit(s)`);
      for (const note of facts.semanticNotes ?? []) advantages.push(note);
    }
    return { strategyRef: ref, advantages, disadvantages };
  });
}

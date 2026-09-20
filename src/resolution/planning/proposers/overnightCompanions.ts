/**
 * Builds bounded flight-plus-stay candidates only when the existing overnight
 * evaluator finds exactly one uncovered gap after applying a transport
 * candidate. This helper does not judge viability: RC-6 evaluates its output.
 */
import { createHash } from 'node:crypto';
import type { ScenarioChange, ScenarioEffect } from '../../../contracts/v2/scenario/scenarioChange.ts';
import type { TypedRef } from '../../../domain/v2/shared/identity.ts';
import { typedConflict, type TypedResult, ok, conflict } from '../../../domain/v2/shared/errors.ts';
import type { Instant } from '../../../domain/v2/shared/time.ts';
import { projectEffectiveWorld } from '../../world/effectiveItinerary.ts';
import type { CapturedWorld } from '../../world/world.ts';
import { overnightEvaluator } from '../../evaluation/evaluators/overnight.ts';
import { applyScenarioOverlay, type ResolvedOffer, type ResolvedStayOffer } from '../../scenarios/overlay.ts';
import { MAX_CANDIDATES_PER_PROPOSER, ProposalCandidateSchema, type ProposalCandidate } from '../proposer.ts';

type AddStayEffect = Extract<ScenarioEffect, { effectKind: 'ADD_JOURNEY_STAY' }>;

export interface QuotedStayOption {
  /** The flight candidate this quote was gathered for. */
  baseCandidateKey: string;
  journeyId: string;
  /** Redundant with `offer.offerId` so mismatched supplier bindings fail closed. */
  offerId: string;
  offer: ResolvedStayOffer;
  proposedJourneyItemId: string;
  orderKey: string;
  visit: AddStayEffect['visit'];
}

export interface OvernightCompanionInput {
  flightCandidates: readonly ProposalCandidate[];
  world: CapturedWorld;
  resolvedOffers: readonly ResolvedOffer[];
  quotedStayOptions: readonly QuotedStayOption[];
  now: Instant;
  /** At most two stay quotes are paired with one flight candidate. */
  maxStayOptionsPerCandidate?: number;
  /** Global companion cap; original flight candidates are never removed. */
  maxCombinedCandidates?: number;
}

export interface UncoveredOvernightGap {
  baseCandidateKey: string;
  journeyId: string;
  itemRefs: TypedRef[];
  reasonCode: 'overnight_unaccommodated';
}

export interface CompanionSkip {
  baseCandidateKey: string;
  reason: 'not_single_select_offer' | 'journey_not_captured' | 'base_overlay_rejected' | 'no_uncovered_overnight_gap' | 'multiple_uncovered_overnight_gaps' | 'no_compatible_stay_option' | 'candidate_limit_reached';
}

export interface OvernightCompanionResult {
  /** Originals first, then bounded combined candidates. */
  candidates: ProposalCandidate[];
  /** Captured stay facts selected for each emitted combined candidate. */
  resolvedStayOffers: { candidateKey: string; baseCandidateKey: string; offer: ResolvedStayOffer }[];
  uncoveredGaps: UncoveredOvernightGap[];
  skipped: CompanionSkip[];
}

const DEFAULT_MAX_STAYS_PER_CANDIDATE = 2;
const DEFAULT_MAX_COMBINED_CANDIDATES = 16;

function stableId(seed: string): string {
  return `overnight-companion:${createHash('sha256').update(seed).digest('hex').slice(0, 32)}`;
}

function uniqueRefs(refs: readonly TypedRef[]): TypedRef[] {
  return [...new Map(refs.map((ref) => [`${ref.kind}:${ref.id}`, ref] as const)).values()];
}

function reject(message: string): TypedResult<never> {
  return conflict(typedConflict('VALIDATION_FAILED', message));
}

function validCap(value: number | undefined): value is number | undefined {
  return value === undefined || (Number.isFinite(value) && Number.isInteger(value) && value >= 0);
}

function sameStayOffer(a: ResolvedStayOffer, b: ResolvedStayOffer): boolean {
  return a.offerId === b.offerId
    && a.placeId === b.placeId
    && a.stayWindow.start === b.stayWindow.start
    && a.stayWindow.end === b.stayWindow.end
    && a.price.amount === b.price.amount
    && a.price.currency === b.price.currency;
}

function validateInput(input: OvernightCompanionInput): TypedResult<true> {
  if (!validCap(input.maxStayOptionsPerCandidate) || !validCap(input.maxCombinedCandidates)) {
    return reject('overnight companion caps must be finite non-negative integers');
  }
  const candidateKeys = new Set<string>();
  for (const candidate of input.flightCandidates) {
    if (candidateKeys.has(candidate.key)) return reject(`duplicate base candidate key ${candidate.key}`);
    candidateKeys.add(candidate.key);
  }
  const offers = new Map<string, ResolvedStayOffer>();
  const optionsByBaseOffer = new Set<string>();
  for (const option of input.quotedStayOptions) {
    if (option.offerId !== option.offer.offerId) return reject(`quoted stay option ${option.offerId} does not match its resolved offer identity`);
    const existing = offers.get(option.offerId);
    if (existing && !sameStayOffer(existing, option.offer)) return reject(`quoted stay offer ${option.offerId} has conflicting captured facts`);
    offers.set(option.offerId, option.offer);
    const baseOfferKey = `${option.baseCandidateKey}\u0000${option.journeyId}\u0000${option.offerId}`;
    if (optionsByBaseOffer.has(baseOfferKey)) return reject(`duplicate quoted stay option for base candidate ${option.baseCandidateKey}`);
    optionsByBaseOffer.add(baseOfferKey);
  }
  return ok(true);
}

function scenarioFor(candidate: ProposalCandidate): ScenarioChange {
  const seed = stableId(candidate.key);
  return {
    id: `${seed}:change`,
    recoveryStrategyId: `${seed}:strategy`,
    strategyVersion: 1,
    affectedSubjectRefs: candidate.affectedSubjectRefs,
    basisAssessmentId: `${seed}:basis`,
    effects: candidate.effects,
  };
}

function journeyForSingleSelect(world: CapturedWorld, candidate: ProposalCandidate): string | undefined {
  const selects = candidate.effects.filter((effect): effect is Extract<ScenarioEffect, { effectKind: 'SELECT_OFFER' }> => effect.effectKind === 'SELECT_OFFER');
  if (selects.length !== 1) return undefined;
  return world.journeyItems.find((item) => item.id === selects[0]!.journeyItemId)?.journeyId;
}

function uncoveredGaps(params: { candidate: ProposalCandidate; world: CapturedWorld; resolvedOffers: readonly ResolvedOffer[]; now: Instant; journeyId: string }): UncoveredOvernightGap[] | undefined {
  const overlay = applyScenarioOverlay({
    baseWorld: params.world,
    scenarioChange: scenarioFor(params.candidate),
    resolvedOffers: params.resolvedOffers,
  });
  if (!overlay.ok) return undefined;
  const output = overnightEvaluator.evaluate(
    { kind: 'JOURNEY', id: params.journeyId },
    { world: overlay.value.proposedWorld, effective: projectEffectiveWorld(overlay.value.proposedWorld), now: params.now },
  );
  return output.dimensions.flatMap((dimension) => dimension.explanations)
    .filter((explanation) => explanation.status === 'FAIL' && explanation.reasonCode === 'overnight_unaccommodated')
    .map((explanation) => ({
      baseCandidateKey: params.candidate.key,
      journeyId: params.journeyId,
      itemRefs: explanation.relatedSubjects.filter((ref) => ref.kind === 'JOURNEY_ITEM'),
      reasonCode: 'overnight_unaccommodated' as const,
    }));
}

/**
 * Leaves every original flight candidate visible. A companion is emitted only
 * for one actual evaluator-reported gap and a captured, explicitly-bound quote.
 */
export function proposeOvernightCompanions(input: OvernightCompanionInput): TypedResult<OvernightCompanionResult> {
  const validated = validateInput(input);
  if (!validated.ok) return validated;
  const candidates = [...input.flightCandidates];
  const resolvedStayOffers: OvernightCompanionResult['resolvedStayOffers'] = [];
  const uncovered: UncoveredOvernightGap[] = [];
  const skipped: CompanionSkip[] = [];
  const emittedKeys = new Set(candidates.map((candidate) => candidate.key));
  const maxPerCandidate = Math.min(DEFAULT_MAX_STAYS_PER_CANDIDATE, input.maxStayOptionsPerCandidate ?? DEFAULT_MAX_STAYS_PER_CANDIDATE);
  const maxCombined = Math.max(
    0,
    Math.min(
      MAX_CANDIDATES_PER_PROPOSER - candidates.length,
      input.maxCombinedCandidates ?? DEFAULT_MAX_COMBINED_CANDIDATES,
    ),
  );
  let combined = 0;

  for (const base of input.flightCandidates) {
    const selects = base.effects.filter((effect) => effect.effectKind === 'SELECT_OFFER');
    if (selects.length !== 1) {
      skipped.push({ baseCandidateKey: base.key, reason: 'not_single_select_offer' });
      continue;
    }
    const journeyId = journeyForSingleSelect(input.world, base);
    if (!journeyId) {
      skipped.push({ baseCandidateKey: base.key, reason: 'journey_not_captured' });
      continue;
    }
    const gaps = uncoveredGaps({ candidate: base, world: input.world, resolvedOffers: input.resolvedOffers, now: input.now, journeyId });
    if (!gaps) {
      skipped.push({ baseCandidateKey: base.key, reason: 'base_overlay_rejected' });
      continue;
    }
    if (gaps.length === 0) {
      skipped.push({ baseCandidateKey: base.key, reason: 'no_uncovered_overnight_gap' });
      continue;
    }
    if (gaps.length > 1) {
      skipped.push({ baseCandidateKey: base.key, reason: 'multiple_uncovered_overnight_gaps' });
      continue;
    }
    uncovered.push(gaps[0]!);

    const options = input.quotedStayOptions
      .filter((option) => option.baseCandidateKey === base.key && option.journeyId === journeyId)
      .slice(0, maxPerCandidate);
    if (options.length === 0) {
      skipped.push({ baseCandidateKey: base.key, reason: 'no_compatible_stay_option' });
      continue;
    }

    for (const option of options) {
      if (combined >= maxCombined) {
        skipped.push({ baseCandidateKey: base.key, reason: 'candidate_limit_reached' });
        break;
      }
      const stayEffect: AddStayEffect = {
        effectKind: 'ADD_JOURNEY_STAY',
        proposedJourneyItemId: option.proposedJourneyItemId,
        journeyId,
        orderKey: option.orderKey,
        offerId: option.offerId,
        offerPrice: option.offer.price,
        visit: option.visit,
      };
      const key = stableId(`${base.key}|${option.offerId}|${option.proposedJourneyItemId}`);
      if (emittedKeys.has(key)) continue;
      const parsed = ProposalCandidateSchema.safeParse({
        key,
        effects: [...base.effects, stayEffect],
        affectedSubjectRefs: uniqueRefs([
          ...base.affectedSubjectRefs,
          { kind: 'JOURNEY', id: journeyId },
          { kind: 'OFFER', id: option.offerId },
        ]),
        rationale: 'Add overnight accommodation to cover the itinerary gap.',
        assumptions: base.assumptions,
      });
      if (!parsed.success) continue;
      emittedKeys.add(key);
      candidates.push(parsed.data);
      resolvedStayOffers.push({ candidateKey: key, baseCandidateKey: base.key, offer: option.offer });
      combined += 1;
    }
  }
  return ok({ candidates, resolvedStayOffers, uncoveredGaps: uncovered, skipped });
}

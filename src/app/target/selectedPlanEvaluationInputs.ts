/**
 * Retain the exact research materialization which the application used for the
 * selected strategy. This is read-only evaluation evidence, NOT a stay booking
 * binding. No credentials, payment handles or provider workflow state survive.
 */
import type { RecoveryStrategy } from '../../contracts/v2/scenario/recoveryStrategy.ts';
import type { CapturedHotelQuote, HotelPlanningMaterialization } from '../targetHotelCompanionPlanning.ts';
import type { ResolvedOffer, ResolvedStayOffer } from '../../resolution/scenarios/overlay.ts';
import type { WTransportService } from '../../resolution/world/world.ts';
import { selectedPlanFingerprint } from '../../resolution/execution/selectedPlanIdentity.ts';
import { compareExactMoney } from '../../domain/v2/shared/money.ts';
import { continuationAssert, decodeJson, type ContinuationDb, type SelectedPlanState } from '../../persistence/postgres/execution/selectedPlanContinuation.ts';
import { resolveOfferExecutionInputs } from '../../persistence/postgres/execution/providerExecutionInputs.ts';

export interface SelectedEvaluationInputs {
  services: WTransportService[];
  offers: ResolvedOffer[];
  stays: ResolvedStayOffer[];
  stayTerms: Array<{
    offerId: string; propertyId: string; rateId: string; quoteId: string;
    provenance: CapturedHotelQuote['provider']['quoteProvenance'];
    replacement?: Omit<NonNullable<CapturedHotelQuote['replacement']>, 'provider'>;
  }>;
}

/** Same comparator for the later provider preflight: never silently reprice. */
export function selectedProviderTermsMatch(approved: unknown, current: unknown): boolean {
  return selectedPlanFingerprint(approved) === selectedPlanFingerprint(current);
}

/** Called by the normal application planning coordinator AFTER strategy persistence. */
export async function retainSelectedPlanEvaluationInputs(db: ContinuationDb, input: {
  workspaceId: string; actorId: string; strategies: readonly RecoveryStrategy[];
  services: readonly WTransportService[]; offers: readonly ResolvedOffer[];
  hotel?: HotelPlanningMaterialization;
}): Promise<void> {
  for (const strategy of input.strategies) {
    const flightIds = new Set(strategy.scenarioChange.effects.flatMap((e) => e.effectKind === 'SELECT_OFFER' ? [e.offerId] : []));
    const stayIds = new Set(strategy.scenarioChange.effects.flatMap((e) => e.effectKind === 'ADD_JOURNEY_STAY' ? [e.offerId] : []));
    const offers = [...new Map(input.offers.filter((o) => flightIds.has(o.offerId)).map((o) => [o.offerId, o])).values()];
    const serviceIds = new Set(offers.map((o) => o.transportServiceId));
    const services = [...new Map(input.services.filter((s) => serviceIds.has(s.id)).map((s) => [s.id, s])).values()];
    const stays = [...new Map((input.hotel?.resolvedStayOffers ?? []).filter((o) => stayIds.has(o.offerId)).map((o) => [o.offerId, o])).values()];
    const stayTerms = [...new Map((input.hotel?.quotedStays ?? []).filter((q) => stayIds.has(q.offer.offerId)).map((q) => [q.offer.offerId, {
      offerId: q.offer.offerId, propertyId: q.provider.propertyId, rateId: q.provider.rateId, quoteId: q.provider.quoteId,
      provenance: q.provider.quoteProvenance,
      ...(q.replacement ? { replacement: {
        oldJourneyItemId: q.replacement.oldJourneyItemId, reservationLineId: q.replacement.reservationLineId,
        cancellationPenalty: q.replacement.cancellationPenalty, cancellationPenaltyBasis: q.replacement.cancellationPenaltyBasis,
      } } : {}),
    }])).values()];
    const material: SelectedEvaluationInputs = { services, offers, stays, stayTerms };
    const sourceFingerprint = selectedPlanFingerprint(strategy.scenarioChange);
    const fingerprint = selectedPlanFingerprint(material);
    // Existing materialization is immutable: a retry must be IDENTICAL, not an
    // opportunity to attach a new provider/price to an already approved strategy.
    await db.query(`INSERT INTO selected_plan_evaluation_inputs
      (workspace_id,recovery_strategy_id,source_fingerprint,materialization,materialization_fingerprint,created_by_actor_id)
      VALUES ($1,$2,$3,$4::jsonb,$5,$6) ON CONFLICT (workspace_id,recovery_strategy_id) DO NOTHING`,
    [input.workspaceId, strategy.id, sourceFingerprint, JSON.stringify(material), fingerprint, input.actorId]);
    const saved = (await db.query<{ source_fingerprint: string; materialization_fingerprint: string }>(
      'SELECT source_fingerprint,materialization_fingerprint FROM selected_plan_evaluation_inputs WHERE workspace_id=$1 AND recovery_strategy_id=$2',
      [input.workspaceId, strategy.id])).rows[0];
    continuationAssert(saved?.source_fingerprint === sourceFingerprint && saved.materialization_fingerprint === fingerprint,
      'APPROVED_TERMS_CHANGED', 'Research retry attempted to change retained selected-plan material terms.');
  }
}

/** All inputs come from protected immutable PG rows, never a request body. */
export async function loadSelectedPlanEvaluationInputs(
  db: ContinuationDb, workspaceId: string, state: SelectedPlanState, now: string,
): Promise<{ material: SelectedEvaluationInputs; fingerprint: string }> {
  const stored = (await db.query<{ source_fingerprint: string; materialization: unknown; materialization_fingerprint: string }>(
    'SELECT source_fingerprint,materialization,materialization_fingerprint FROM selected_plan_evaluation_inputs WHERE workspace_id=$1 AND recovery_strategy_id=$2',
    [workspaceId, state.strategyId])).rows[0];
  continuationAssert(stored && stored.source_fingerprint === selectedPlanFingerprint(state.scenario),
    'SELECTED_INPUTS_MISSING', 'No retained application-owned materialization for this strategy. Replanning is required; do not reconstruct a quote.');
  const material = decodeJson<SelectedEvaluationInputs>(stored.materialization);
  continuationAssert(selectedPlanFingerprint(material) === stored.materialization_fingerprint
    && Array.isArray(material.services) && Array.isArray(material.offers) && Array.isArray(material.stays) && Array.isArray(material.stayTerms),
  'SELECTED_INPUTS_INVALID', 'Selected materialization hash/shape is invalid.');
  for (const effect of state.residualEffects) {
    if (effect.effectKind === 'SELECT_OFFER') {
      const intent = state.intents.find((i) => i.source_effect_fingerprint === selectedPlanFingerprint(effect));
      continuationAssert(intent, 'SOURCE_EFFECT_MISMATCH', 'Residual flight has no selected intent.');
      const inputs = await resolveOfferExecutionInputs(db, workspaceId, intent.id);
      continuationAssert(inputs.ready, 'PROTECTED_INPUTS_UNAVAILABLE', inputs.ready ? '' : inputs.reason);
      const offer = material.offers.find((o) => o.offerId === effect.offerId);
      const service = material.services.find((s) => s.id === offer?.transportServiceId);
      const researched = service?.researchedOffer;
      const b = inputs.binding;
      continuationAssert(service && researched && researched.providerId === b.providerId && researched.rawOfferId === b.providerOfferRef
        && effect.offerPrice && effect.offerPrice.currency === b.quotedCurrency
        && compareExactMoney(effect.offerPrice, { amount: b.quotedAmount, currency: b.quotedCurrency }) === 0
        && service.originPlaceId === b.itinerary.originPlaceId && service.destinationPlaceId === b.itinerary.destinationPlaceId
        && service.published.departure?.value === b.itinerary.departure && service.published.arrival?.value === b.itinerary.arrival
        && service.operator === b.itinerary.operator && service.mode === b.itinerary.mode
        && (!researched.commercial.expiresAt || Date.parse(researched.commercial.expiresAt) > Date.parse(now)),
      'APPROVED_TERMS_CHANGED', 'Provider identity, amount, currency, itinerary or quote expiry differs from the approved source.');
    }
    if (effect.effectKind === 'ADD_JOURNEY_STAY') {
      const quote = material.stays.filter((o) => o.offerId === effect.offerId);
      const terms = material.stayTerms.filter((t) => t.offerId === effect.offerId);
      continuationAssert(quote.length === 1 && terms.length === 1 && terms[0]!.propertyId && terms[0]!.rateId && terms[0]!.quoteId
        && quote[0]!.price.currency === effect.offerPrice.currency && compareExactMoney(quote[0]!.price, effect.offerPrice) === 0,
      'APPROVED_TERMS_CHANGED', 'Exact selected stay quote/material terms were not retained.');
    }
    if (effect.effectKind === 'CANCEL_STAY') {
      continuationAssert(material.stayTerms.some((t) => t.replacement?.oldJourneyItemId === effect.journeyItemId
        && t.replacement.reservationLineId === effect.reservationLineId
        && selectedProviderTermsMatch(t.replacement.cancellationPenalty, effect.cancellationPenalty)
        && t.replacement.cancellationPenaltyBasis === effect.cancellationPenaltyBasis),
      'APPROVED_TERMS_CHANGED', 'Displaced stay cancellation policy/ceiling differs from the selected plan.');
    }
  }
  return { material, fingerprint: stored.materialization_fingerprint };
}

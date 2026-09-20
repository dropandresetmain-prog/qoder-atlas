/** Protected, immutable provider inputs for approved stay actions. */
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from '../pool.ts';
import type { RecoveryStrategy } from '../../../contracts/v2/scenario/recoveryStrategy.ts';
import type { CapturedHotelQuote } from '../../../app/targetHotelCompanionPlanning.ts';
import type { ApprovedVisitInput } from '../commands/observedStayCommands.ts';

type Queryable = Pick<Pool | PoolClient, 'query'>;
export const LIVE_STAY_RESEARCH_MODES = ['LIVE', 'RECORD'] as const;

export interface StayExecutionBinding {
  id: string; recoveryStrategyId: string; journeyId: string; action: 'BOOK' | 'CANCEL'; providerConnectionId?: string;
  offerKey?: string; providerId: string; providerPropertyId?: string; providerRateId?: string;
  quoteHandle?: string; workflowState?: Record<string, unknown>; stayWindow?: { start: string; end: string };
  placeId?: string; orderKey?: string; requiredNights?: number; quotedAmount?: string; quotedCurrency?: string; quoteObservedAt?: string; researchMode?: string;
  journeyItemId?: string; reservationLineId?: string; stayElementId?: string;
  cancellationMaximumLossAmount?: string; cancellationMaximumLossCurrency?: string;
  approvedVisit?: ApprovedVisitInput;
}
export type StayExecutionInputs =
  | { ready: true; binding: StayExecutionBinding; travellerId: string; guestNames: string[] }
  | { ready: false; reason: 'STAY_BINDING_MISSING' | 'STALE_STAY_QUOTE' | 'STAY_TRAVELLER_UNRESOLVED' | 'STAY_GUEST_NAME_MISSING' | 'STAY_TERMS_MISSING'; detail: string };

async function visitInput(db: Queryable, workspaceId: string, quote: CapturedHotelQuote): Promise<ApprovedVisitInput | undefined> {
  const visit = quote.context.visit;
  if (visit.kind === 'EXISTING') {
    const selection = (await db.query<{ id: string; credential_id: string; credential_version_id: string; scope_intended_visit_ids: string[] }>(`SELECT id,credential_id,credential_version_id,scope_intended_visit_ids FROM credential_selections WHERE workspace_id=$1 AND journey_id=$2 AND $3::uuid = ANY(scope_intended_visit_ids) ORDER BY id LIMIT 1`, [workspaceId, quote.journeyId, visit.visitId])).rows[0];
    return selection ? { kind: 'EXISTING', visitId: visit.visitId, credentialSelection: { id: selection.id, credentialId: selection.credential_id, credentialVersionId: selection.credential_version_id, scopeIntendedVisitIds: selection.scope_intended_visit_ids } } : undefined;
  }
  const selected = visit.credentialSelections[0];
  if (!selected) return undefined;
  return { kind: 'PROPOSED', visit: { id: visit.proposedVisitId, journeyId: quote.journeyId, jurisdictionId: visit.jurisdictionId, purpose: visit.purpose, intendedDates: visit.intendedWindow, transitIntent: false }, credentialSelection: { id: selected.proposedSelectionId, credentialId: selected.credentialId, credentialVersionId: selected.credentialVersionId, scopeIntendedVisitIds: [visit.proposedVisitId] } };
}

/** Persist only quoted terms that are actually used by a durable viable strategy. */
export async function persistStayExecutionBindings(db: Queryable, params: { workspaceId: string; actorId: string; recoveryCaseId: string; strategies: readonly RecoveryStrategy[]; quotedStays: readonly CapturedHotelQuote[] }): Promise<number> {
  let written = 0;
  const connections = (await db.query<{ id: string }>(`SELECT id FROM external_connections WHERE workspace_id=$1 AND provider_kind='nuitee' ORDER BY id LIMIT 2`, [params.workspaceId])).rows;
  const connectionId = connections.length === 1 ? connections[0]!.id : null;
  for (const strategy of params.strategies) for (const effect of strategy.scenarioChange.effects) {
    if (effect.effectKind === 'ADD_JOURNEY_STAY') {
      const quote = params.quotedStays.find((candidate) => candidate.offer.offerId === effect.offerId && candidate.context.proposedJourneyItemId === effect.proposedJourneyItemId);
      if (!quote || quote.offer.price.amount !== effect.offerPrice.amount || quote.offer.price.currency !== effect.offerPrice.currency) continue;
      const approvedVisit = await visitInput(db, params.workspaceId, quote);
      const result = await db.query(`INSERT INTO stay_execution_bindings (workspace_id,id,recovery_case_id,recovery_strategy_id,action,journey_id,offer_key,provider_id,provider_connection_id,provider_property_id,provider_rate_id,quote_handle,workflow_state,stay_window,place_id,order_key,required_nights,quoted_amount,quoted_currency,quote_observed_at,research_mode,journey_item_id,approved_visit,created_by_actor_id)
        VALUES ($1,$2,$3,$4,'BOOK',$5,$6,'nuitee',$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14,$15,$16,$17,$18,$19::jsonb,$20)
        ON CONFLICT ON CONSTRAINT stay_execution_bindings_identity_uidx DO NOTHING`, [params.workspaceId, randomUUID(), params.recoveryCaseId, strategy.id, effect.journeyId, effect.offerId, connectionId, quote.provider.propertyId, quote.provider.rateId, quote.provider.quoteId, JSON.stringify(quote.provider.workflowState ?? {}), JSON.stringify(quote.offer.stayWindow), quote.offer.placeId, quote.context.orderKey, Math.max(1, Math.round((Date.parse(quote.offer.stayWindow.end)-Date.parse(quote.offer.stayWindow.start))/86400000)), quote.offer.price.amount, quote.offer.price.currency, quote.provider.quoteProvenance.observedAt, quote.provider.quoteProvenance.mode, effect.proposedJourneyItemId, JSON.stringify(approvedVisit ?? null), params.actorId]);
      written += result.rowCount ?? 0;
    }
    if (effect.effectKind === 'CANCEL_STAY') {
      const quote = params.quotedStays.find((candidate) => candidate.replacement?.oldJourneyItemId === effect.journeyItemId && candidate.replacement?.reservationLineId === effect.reservationLineId);
      if (!quote?.replacement || quote.replacement.cancellationPenalty.amount !== effect.cancellationPenalty.amount || quote.replacement.cancellationPenalty.currency !== effect.cancellationPenalty.currency) continue;
      const result = await db.query(`INSERT INTO stay_execution_bindings (workspace_id,id,recovery_case_id,recovery_strategy_id,action,journey_id,provider_id,provider_connection_id,journey_item_id,reservation_line_id,stay_element_id,cancellation_maximum_loss_amount,cancellation_maximum_loss_currency,created_by_actor_id)
        VALUES ($1,$2,$3,$4,'CANCEL',$5,'nuitee',$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT ON CONSTRAINT stay_execution_bindings_identity_uidx DO NOTHING`, [params.workspaceId, randomUUID(), params.recoveryCaseId, strategy.id, quote.journeyId, connectionId, effect.journeyItemId, effect.reservationLineId, quote.replacement.provider.stayElementId, effect.cancellationPenalty.amount, effect.cancellationPenalty.currency, params.actorId]);
      written += result.rowCount ?? 0;
    }
  }
  return written;
}

export async function resolveStayExecutionInputs(db: Queryable, workspaceId: string, intentId: string): Promise<StayExecutionInputs> {
  const intent = (await db.query<{ strategy_id: string; capability_ref: string; subject_refs: unknown }>(`SELECT ap.recovery_strategy_id AS strategy_id, ai.capability_ref, ai.subject_refs FROM action_intents ai JOIN action_plans ap ON ap.workspace_id=ai.workspace_id AND ap.id=ai.action_plan_id WHERE ai.workspace_id=$1 AND ai.id=$2`, [workspaceId, intentId])).rows[0];
  if (!intent) return { ready: false, reason: 'STAY_BINDING_MISSING', detail: 'action intent is absent' };
  const action = intent.capability_ref === 'external:stay.book' ? 'BOOK' : intent.capability_ref === 'external:stay.cancel' ? 'CANCEL' : undefined;
  if (!action) return { ready: false, reason: 'STAY_BINDING_MISSING', detail: 'intent is not a stay action' };
  const refs = (Array.isArray(intent.subject_refs) ? intent.subject_refs : JSON.parse(String(intent.subject_refs))) as { kind: string; id: string }[];
  const binding = (await db.query<any>(`SELECT * FROM stay_execution_bindings WHERE workspace_id=$1 AND recovery_strategy_id=$2 AND action=$3 AND (($3='BOOK' AND offer_key=$4) OR ($3='CANCEL' AND journey_item_id=$5 AND reservation_line_id=$6))`, [workspaceId, intent.strategy_id, action, refs.find((r) => r.kind === 'OFFER')?.id ?? null, refs.find((r) => r.kind === 'JOURNEY_ITEM')?.id ?? null, refs.find((r) => r.kind === 'RESERVATION_LINE')?.id ?? null])).rows[0];
  if (!binding) return { ready: false, reason: 'STAY_BINDING_MISSING', detail: 'no immutable provider stay binding matches the approved effect' };
  if (action === 'BOOK' && (!binding.quote_handle || !LIVE_STAY_RESEARCH_MODES.includes(binding.research_mode))) return { ready: false, reason: 'STALE_STAY_QUOTE', detail: 'book action has no protected LIVE/RECORD quote handle' };
  const traveller = (await db.query<{ traveller_id: string }>(`SELECT traveller_id FROM journeys WHERE workspace_id=$1 AND id=$2`, [workspaceId, binding.journey_id])).rows[0];
  if (!traveller) return { ready: false, reason: 'STAY_TRAVELLER_UNRESOLVED', detail: 'binding Journey no longer exists' };
  const name = (await db.query<{ given_name: string; family_name: string }>(`SELECT given_name,family_name FROM traveller_names WHERE workspace_id=$1 AND traveller_id=$2 AND given_name IS NOT NULL AND family_name IS NOT NULL ORDER BY (name_kind='LEGAL') DESC,valid_from DESC,id LIMIT 1`, [workspaceId, traveller.traveller_id])).rows[0];
  if (!name) return { ready: false, reason: 'STAY_GUEST_NAME_MISSING', detail: 'traveller has no protected structured guest name' };
  if (action === 'BOOK' && !binding.approved_visit) return { ready: false, reason: 'STAY_TERMS_MISSING', detail: 'approved visit and credential selection were not persisted for this stay' };
  const parsed: StayExecutionBinding = { id: binding.id, recoveryStrategyId: binding.recovery_strategy_id, journeyId: binding.journey_id, action, providerId: binding.provider_id, ...(binding.provider_connection_id ? { providerConnectionId: binding.provider_connection_id } : {}), ...(binding.offer_key ? { offerKey: binding.offer_key } : {}), ...(binding.provider_property_id ? { providerPropertyId: binding.provider_property_id } : {}), ...(binding.provider_rate_id ? { providerRateId: binding.provider_rate_id } : {}), ...(binding.quote_handle ? { quoteHandle: binding.quote_handle } : {}), ...(binding.workflow_state ? { workflowState: binding.workflow_state } : {}), ...(binding.stay_window ? { stayWindow: binding.stay_window } : {}), ...(binding.place_id ? { placeId: binding.place_id } : {}), ...(binding.order_key ? { orderKey: binding.order_key } : {}), ...(binding.required_nights ? { requiredNights: Number(binding.required_nights) } : {}), ...(binding.quoted_amount ? { quotedAmount: String(binding.quoted_amount), quotedCurrency: binding.quoted_currency, quoteObservedAt: new Date(binding.quote_observed_at).toISOString(), researchMode: binding.research_mode } : {}), ...(binding.journey_item_id ? { journeyItemId: binding.journey_item_id } : {}), ...(binding.reservation_line_id ? { reservationLineId: binding.reservation_line_id } : {}), ...(binding.stay_element_id ? { stayElementId: binding.stay_element_id } : {}), ...(binding.cancellation_maximum_loss_amount ? { cancellationMaximumLossAmount: String(binding.cancellation_maximum_loss_amount), cancellationMaximumLossCurrency: binding.cancellation_maximum_loss_currency } : {}), ...(binding.approved_visit ? { approvedVisit: binding.approved_visit } : {}) };
  return { ready: true, binding: parsed, travellerId: traveller.traveller_id, guestNames: [`${name.given_name} ${name.family_name}`] };
}

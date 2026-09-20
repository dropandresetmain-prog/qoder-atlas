/** Protected, immutable provider inputs for approved stay actions. */
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from '../pool.ts';
import type { RecoveryStrategy } from '../../../contracts/v2/scenario/recoveryStrategy.ts';
import type { CapturedHotelQuote } from '../../../app/targetHotelCompanionPlanning.ts';
import type { ApprovedVisitInput } from '../commands/observedStayCommands.ts';

type Queryable = Pick<Pool | PoolClient, 'query'>;

export const LIVE_STAY_RESEARCH_MODES = ['LIVE', 'RECORD'] as const;

export interface StayExecutionBinding {
  id: string;
  recoveryStrategyId: string;
  journeyId: string;
  action: 'BOOK' | 'CANCEL';
  providerConnectionId?: string;
  offerKey?: string;
  providerId: string;
  providerPropertyId?: string;
  providerRateId?: string;
  quoteHandle?: string;
  workflowState?: Record<string, unknown>;
  stayWindow?: { start: string; end: string };
  placeId?: string;
  orderKey?: string;
  requiredNights?: number;
  quotedAmount?: string;
  quotedCurrency?: string;
  quoteObservedAt?: string;
  researchMode?: string;
  journeyItemId?: string;
  reservationLineId?: string;
  stayElementId?: string;
  cancellationMaximumLossAmount?: string;
  cancellationMaximumLossCurrency?: string;
  approvedVisit?: ApprovedVisitInput;
}

export type StayExecutionInputs =
  | { ready: true; binding: StayExecutionBinding; travellerId: string; guestNames: string[] }
  | {
      ready: false;
      reason:
        | 'STAY_BINDING_MISSING'
        | 'STALE_STAY_QUOTE'
        | 'STAY_TRAVELLER_UNRESOLVED'
        | 'STAY_GUEST_NAME_MISSING'
        | 'STAY_TERMS_MISSING'
        | 'STAY_BINDING_AMBIGUOUS';
      detail: string;
    };

async function visitInput(
  db: Queryable,
  workspaceId: string,
  quote: CapturedHotelQuote,
): Promise<ApprovedVisitInput | undefined> {
  const visit = quote.context.visit;
  if (visit.kind === 'EXISTING') {
    const selection = (
      await db.query<{
        id: string;
        credential_id: string;
        credential_version_id: string;
        scope_intended_visit_ids: string[];
      }>(
        `SELECT id, credential_id, credential_version_id, scope_intended_visit_ids
           FROM credential_selections
          WHERE workspace_id = $1 AND journey_id = $2 AND $3::uuid = ANY(scope_intended_visit_ids)
          ORDER BY id LIMIT 1`,
        [workspaceId, quote.journeyId, visit.visitId],
      )
    ).rows[0];
    return selection
      ? {
          kind: 'EXISTING',
          visitId: visit.visitId,
          credentialSelection: {
            id: selection.id,
            credentialId: selection.credential_id,
            credentialVersionId: selection.credential_version_id,
            scopeIntendedVisitIds: selection.scope_intended_visit_ids,
          },
        }
      : undefined;
  }
  const selected = visit.credentialSelections[0];
  if (!selected) return undefined;
  return {
    kind: 'PROPOSED',
    visit: {
      id: visit.proposedVisitId,
      journeyId: quote.journeyId,
      jurisdictionId: visit.jurisdictionId,
      purpose: visit.purpose,
      intendedDates: visit.intendedWindow,
      transitIntent: false,
    },
    credentialSelection: {
      id: selected.proposedSelectionId,
      credentialId: selected.credentialId,
      credentialVersionId: selected.credentialVersionId,
      scopeIntendedVisitIds: [visit.proposedVisitId],
    },
  };
}

function requiredNights(window: { start: string; end: string }): number {
  return Math.max(1, Math.round((Date.parse(window.end) - Date.parse(window.start)) / 86_400_000));
}

/** Persist only quoted terms that are actually used by a durable viable strategy. */
export async function persistStayExecutionBindings(
  db: Queryable,
  params: {
    workspaceId: string;
    actorId: string;
    recoveryCaseId: string;
    strategies: readonly RecoveryStrategy[];
    quotedStays: readonly CapturedHotelQuote[];
  },
): Promise<number> {
  let written = 0;
  const connections = (
    await db.query<{ id: string }>(
      `SELECT id FROM external_connections
        WHERE workspace_id = $1 AND provider_kind = 'nuitee'
        ORDER BY id LIMIT 2`,
      [params.workspaceId],
    )
  ).rows;
  // Exactly one connection → bind it; zero or many → leave null and fail closed at resolve/canonical.
  const connectionId = connections.length === 1 ? connections[0]!.id : null;

  for (const strategy of params.strategies) {
    for (const effect of strategy.scenarioChange.effects) {
      if (effect.effectKind === 'ADD_JOURNEY_STAY') {
        const quote = params.quotedStays.find(
          (candidate) =>
            candidate.offer.offerId === effect.offerId
            && candidate.context.proposedJourneyItemId === effect.proposedJourneyItemId,
        );
        if (
          !quote
          || quote.offer.price.amount !== effect.offerPrice.amount
          || quote.offer.price.currency !== effect.offerPrice.currency
        ) {
          continue;
        }
        if (
          !quote.provider.propertyId
          || !quote.provider.rateId
          || !quote.provider.quoteId
          || !quote.offer.placeId
          || !quote.context.orderKey
          || !effect.proposedJourneyItemId
        ) {
          continue;
        }
        const approvedVisit = await visitInput(db, params.workspaceId, quote);
        // Column count must match value expressions exactly (repaired from WIP).
        const result = await db.query(
          `INSERT INTO stay_execution_bindings (
             workspace_id, id, recovery_case_id, recovery_strategy_id, action, journey_id,
             offer_key, provider_id, provider_connection_id, provider_property_id, provider_rate_id,
             quote_handle, workflow_state, stay_window, place_id, order_key, required_nights,
             quoted_amount, quoted_currency, quote_observed_at, research_mode, journey_item_id,
             approved_visit, created_by_actor_id
           ) VALUES (
             $1, $2, $3, $4, 'BOOK', $5,
             $6, 'nuitee', $7, $8, $9,
             $10, $11::jsonb, $12::jsonb, $13, $14, $15,
             $16, $17, $18, $19, $20,
             $21::jsonb, $22
           )
           ON CONFLICT ON CONSTRAINT stay_execution_bindings_identity_uidx DO NOTHING`,
          [
            params.workspaceId,
            randomUUID(),
            params.recoveryCaseId,
            strategy.id,
            effect.journeyId,
            effect.offerId,
            connectionId,
            quote.provider.propertyId,
            quote.provider.rateId,
            quote.provider.quoteId,
            JSON.stringify(quote.provider.workflowState ?? {}),
            JSON.stringify(quote.offer.stayWindow),
            quote.offer.placeId,
            quote.context.orderKey,
            requiredNights(quote.offer.stayWindow),
            quote.offer.price.amount,
            quote.offer.price.currency,
            quote.provider.quoteProvenance.observedAt,
            quote.provider.quoteProvenance.mode,
            effect.proposedJourneyItemId,
            JSON.stringify(approvedVisit ?? null),
            params.actorId,
          ],
        );
        written += result.rowCount ?? 0;
      }

      if (effect.effectKind === 'CANCEL_STAY') {
        const quote = params.quotedStays.find(
          (candidate) =>
            candidate.replacement?.oldJourneyItemId === effect.journeyItemId
            && candidate.replacement?.reservationLineId === effect.reservationLineId,
        );
        if (
          !quote?.replacement
          || quote.replacement.cancellationPenalty.amount !== effect.cancellationPenalty.amount
          || quote.replacement.cancellationPenalty.currency !== effect.cancellationPenalty.currency
          || !quote.replacement.provider.stayElementId
        ) {
          continue;
        }
        const result = await db.query(
          `INSERT INTO stay_execution_bindings (
             workspace_id, id, recovery_case_id, recovery_strategy_id, action, journey_id,
             provider_id, provider_connection_id, journey_item_id, reservation_line_id, stay_element_id,
             cancellation_maximum_loss_amount, cancellation_maximum_loss_currency, created_by_actor_id
           ) VALUES (
             $1, $2, $3, $4, 'CANCEL', $5,
             'nuitee', $6, $7, $8, $9,
             $10, $11, $12
           )
           ON CONFLICT ON CONSTRAINT stay_execution_bindings_identity_uidx DO NOTHING`,
          [
            params.workspaceId,
            randomUUID(),
            params.recoveryCaseId,
            strategy.id,
            quote.journeyId,
            connectionId,
            effect.journeyItemId,
            effect.reservationLineId,
            quote.replacement.provider.stayElementId,
            effect.cancellationPenalty.amount,
            effect.cancellationPenalty.currency,
            params.actorId,
          ],
        );
        written += result.rowCount ?? 0;
      }
    }
  }
  return written;
}

function parseSubjectRefs(raw: unknown): { kind: string; id: string }[] {
  const value = Array.isArray(raw) ? raw : JSON.parse(String(raw));
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is { kind: string; id: string } =>
      typeof entry === 'object'
      && entry !== null
      && typeof (entry as { kind?: unknown }).kind === 'string'
      && typeof (entry as { id?: unknown }).id === 'string',
  );
}

function mapBinding(row: Record<string, unknown>, action: 'BOOK' | 'CANCEL'): StayExecutionBinding {
  const stayWindow = row.stay_window as { start: string; end: string } | null | undefined;
  const approvedVisit = row.approved_visit as ApprovedVisitInput | null | undefined;
  return {
    id: String(row.id),
    recoveryStrategyId: String(row.recovery_strategy_id),
    journeyId: String(row.journey_id),
    action,
    providerId: String(row.provider_id),
    ...(row.provider_connection_id ? { providerConnectionId: String(row.provider_connection_id) } : {}),
    ...(row.offer_key ? { offerKey: String(row.offer_key) } : {}),
    ...(row.provider_property_id ? { providerPropertyId: String(row.provider_property_id) } : {}),
    ...(row.provider_rate_id ? { providerRateId: String(row.provider_rate_id) } : {}),
    ...(row.quote_handle ? { quoteHandle: String(row.quote_handle) } : {}),
    ...(row.workflow_state ? { workflowState: row.workflow_state as Record<string, unknown> } : {}),
    ...(stayWindow ? { stayWindow } : {}),
    ...(row.place_id ? { placeId: String(row.place_id) } : {}),
    ...(row.order_key ? { orderKey: String(row.order_key) } : {}),
    ...(row.required_nights != null ? { requiredNights: Number(row.required_nights) } : {}),
    ...(row.quoted_amount != null
      ? {
          quotedAmount: String(row.quoted_amount),
          quotedCurrency: String(row.quoted_currency),
          quoteObservedAt: new Date(String(row.quote_observed_at)).toISOString(),
          researchMode: String(row.research_mode),
        }
      : {}),
    ...(row.journey_item_id ? { journeyItemId: String(row.journey_item_id) } : {}),
    ...(row.reservation_line_id ? { reservationLineId: String(row.reservation_line_id) } : {}),
    ...(row.stay_element_id ? { stayElementId: String(row.stay_element_id) } : {}),
    ...(row.cancellation_maximum_loss_amount != null
      ? {
          cancellationMaximumLossAmount: String(row.cancellation_maximum_loss_amount),
          cancellationMaximumLossCurrency: String(row.cancellation_maximum_loss_currency),
        }
      : {}),
    ...(approvedVisit ? { approvedVisit } : {}),
  };
}

export async function resolveStayExecutionInputs(
  db: Queryable,
  workspaceId: string,
  intentId: string,
): Promise<StayExecutionInputs> {
  const intent = (
    await db.query<{ strategy_id: string; capability_ref: string; subject_refs: unknown }>(
      `SELECT ap.recovery_strategy_id AS strategy_id, ai.capability_ref, ai.subject_refs
         FROM action_intents ai
         JOIN action_plans ap ON ap.workspace_id = ai.workspace_id AND ap.id = ai.action_plan_id
        WHERE ai.workspace_id = $1 AND ai.id = $2`,
      [workspaceId, intentId],
    )
  ).rows[0];
  if (!intent) return { ready: false, reason: 'STAY_BINDING_MISSING', detail: 'action intent is absent' };

  const action =
    intent.capability_ref === 'external:stay.book'
      ? 'BOOK'
      : intent.capability_ref === 'external:stay.cancel'
        ? 'CANCEL'
        : undefined;
  if (!action) return { ready: false, reason: 'STAY_BINDING_MISSING', detail: 'intent is not a stay action' };

  const refs = parseSubjectRefs(intent.subject_refs);
  const offerId = refs.find((r) => r.kind === 'OFFER')?.id ?? null;
  const journeyItemId = refs.find((r) => r.kind === 'JOURNEY_ITEM')?.id ?? null;
  const reservationLineId = refs.find((r) => r.kind === 'RESERVATION_LINE')?.id ?? null;

  const matches = (
    await db.query<Record<string, unknown>>(
      `SELECT *
         FROM stay_execution_bindings
        WHERE workspace_id = $1
          AND recovery_strategy_id = $2
          AND action = $3
          AND (
            ($3 = 'BOOK' AND offer_key = $4)
            OR ($3 = 'CANCEL' AND journey_item_id = $5 AND reservation_line_id = $6)
          )`,
      [workspaceId, intent.strategy_id, action, offerId, journeyItemId, reservationLineId],
    )
  ).rows;

  if (matches.length === 0) {
    return {
      ready: false,
      reason: 'STAY_BINDING_MISSING',
      detail: 'no immutable provider stay binding matches the approved effect',
    };
  }
  if (matches.length > 1) {
    return {
      ready: false,
      reason: 'STAY_BINDING_AMBIGUOUS',
      detail: 'multiple stay bindings match the approved effect',
    };
  }

  const bindingRow = matches[0]!;
  const binding = mapBinding(bindingRow, action);

  if (action === 'BOOK') {
    if (!binding.quoteHandle || !LIVE_STAY_RESEARCH_MODES.includes(binding.researchMode as (typeof LIVE_STAY_RESEARCH_MODES)[number])) {
      return { ready: false, reason: 'STALE_STAY_QUOTE', detail: 'book action has no protected LIVE/RECORD quote handle' };
    }
    if (
      !binding.providerPropertyId
      || !binding.providerRateId
      || !binding.stayWindow
      || !binding.placeId
      || !binding.quotedAmount
      || !binding.quotedCurrency
      || !binding.journeyItemId
      || !binding.approvedVisit
    ) {
      return {
        ready: false,
        reason: 'STAY_TERMS_MISSING',
        detail: 'book binding is incomplete (property/rate/window/place/price/item/visit required)',
      };
    }
  }

  if (action === 'CANCEL') {
    if (
      !binding.journeyItemId
      || !binding.reservationLineId
      || !binding.stayElementId
      || binding.cancellationMaximumLossAmount == null
      || !binding.cancellationMaximumLossCurrency
    ) {
      return {
        ready: false,
        reason: 'STAY_TERMS_MISSING',
        detail: 'cancel binding is incomplete (displaced item/line/element and max-loss required)',
      };
    }
  }

  const traveller = (
    await db.query<{ traveller_id: string }>(
      `SELECT traveller_id FROM journeys WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, binding.journeyId],
    )
  ).rows[0];
  if (!traveller) {
    return { ready: false, reason: 'STAY_TRAVELLER_UNRESOLVED', detail: 'binding Journey no longer exists' };
  }

  const name = (
    await db.query<{ given_name: string; family_name: string }>(
      `SELECT given_name, family_name
         FROM traveller_names
        WHERE workspace_id = $1 AND traveller_id = $2
          AND given_name IS NOT NULL AND family_name IS NOT NULL
        ORDER BY (name_kind = 'LEGAL') DESC, valid_from DESC, id
        LIMIT 1`,
      [workspaceId, traveller.traveller_id],
    )
  ).rows[0];
  if (!name) {
    return { ready: false, reason: 'STAY_GUEST_NAME_MISSING', detail: 'traveller has no protected structured guest name' };
  }

  return {
    ready: true,
    binding,
    travellerId: traveller.traveller_id,
    guestNames: [`${name.given_name} ${name.family_name}`],
  };
}

/** Preflight helper: resolve stay inputs for a strategy effect without an intent row. */
export async function resolveStayExecutionInputsForStrategy(
  db: Queryable,
  workspaceId: string,
  params: {
    strategyId: string;
    action: 'BOOK' | 'CANCEL';
    offerKey?: string;
    journeyItemId?: string;
    reservationLineId?: string;
  },
): Promise<StayExecutionInputs> {
  const matches = (
    await db.query<Record<string, unknown>>(
      `SELECT *
         FROM stay_execution_bindings
        WHERE workspace_id = $1
          AND recovery_strategy_id = $2
          AND action = $3
          AND (
            ($3 = 'BOOK' AND offer_key = $4)
            OR ($3 = 'CANCEL' AND journey_item_id = $5 AND reservation_line_id = $6)
          )`,
      [
        workspaceId,
        params.strategyId,
        params.action,
        params.offerKey ?? null,
        params.journeyItemId ?? null,
        params.reservationLineId ?? null,
      ],
    )
  ).rows;
  if (matches.length === 0) {
    return { ready: false, reason: 'STAY_BINDING_MISSING', detail: 'no immutable provider stay binding matches the approved effect' };
  }
  if (matches.length > 1) {
    return { ready: false, reason: 'STAY_BINDING_AMBIGUOUS', detail: 'multiple stay bindings match the approved effect' };
  }
  const binding = mapBinding(matches[0]!, params.action);
  const traveller = (
    await db.query<{ traveller_id: string }>(
      `SELECT traveller_id FROM journeys WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, binding.journeyId],
    )
  ).rows[0];
  if (!traveller) {
    return { ready: false, reason: 'STAY_TRAVELLER_UNRESOLVED', detail: 'binding Journey no longer exists' };
  }
  const name = (
    await db.query<{ given_name: string; family_name: string }>(
      `SELECT given_name, family_name FROM traveller_names
        WHERE workspace_id = $1 AND traveller_id = $2
          AND given_name IS NOT NULL AND family_name IS NOT NULL
        ORDER BY (name_kind = 'LEGAL') DESC, valid_from DESC, id LIMIT 1`,
      [workspaceId, traveller.traveller_id],
    )
  ).rows[0];
  if (!name) {
    return { ready: false, reason: 'STAY_GUEST_NAME_MISSING', detail: 'traveller has no protected structured guest name' };
  }
  if (params.action === 'BOOK' && !binding.approvedVisit) {
    return { ready: false, reason: 'STAY_TERMS_MISSING', detail: 'approved visit and credential selection were not persisted for this stay' };
  }
  return {
    ready: true,
    binding,
    travellerId: traveller.traveller_id,
    guestNames: [`${name.given_name} ${name.family_name}`],
  };
}

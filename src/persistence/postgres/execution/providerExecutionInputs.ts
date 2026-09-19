/**
 * R4-F2 — the PG-native PROTECTED execution input contract for
 * `external:offer.select` (migration 0128).
 *
 * Two tables, two readers, nothing else:
 *  - `offer_execution_bindings`  written by the planning coordinator when it
 *    persists a viable SELECT_OFFER strategy (application composition, never an
 *    LLM/proposer), read by the external execution boundary.
 *  - `traveller_booking_identities` operator/authoritative booking attributes;
 *    absence refuses execution (never guessed, never hardcoded).
 *
 * `resolveOfferExecutionInputs` is the single truthfulness probe: the SAME
 * function is used by (a) approval (refuse to mint authority for an option that
 * can never run), (b) the execution boundary (before any attempt), and (c) the
 * read-model (Recover offered only when this says `ready`).
 */
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from '../pool.ts';
import type { RecoveryStrategy } from '../../../contracts/v2/scenario/recoveryStrategy.ts';
import type { WTransportService } from '../../../resolution/world/world.ts';
import type { ResolvedOffer } from '../../../resolution/scenarios/overlay.ts';

type Queryable = Pick<Pool | PoolClient, 'query'>;

export interface OfferBindingItinerary {
  originPlaceId: string;
  destinationPlaceId: string;
  departure: string | null;
  arrival: string | null;
  operator: string;
  mode: string;
}

export interface OfferExecutionBinding {
  id: string;
  recoveryStrategyId: string;
  journeyItemId: string;
  journeyId: string;
  offerKey: string;
  providerId: string;
  providerOfferRef: string;
  researchMode: string;
  observedAt: string;
  quotedAmount: string;
  quotedCurrency: string;
  itinerary: OfferBindingItinerary;
}

export interface BookingPassenger {
  travellerId: string;
  givenName: string;
  familyName: string;
  gender: 'MALE' | 'FEMALE';
  dateOfBirth?: string;
  nationality?: string;
}

export type OfferExecutionInputs =
  | { ready: true; binding: OfferExecutionBinding; passengers: BookingPassenger[]; contactName: string }
  | { ready: false; reason: OfferExecutionInputGap; detail: string };

export type OfferExecutionInputGap =
  | 'OFFER_BINDING_MISSING'
  | 'JOURNEY_ITEM_MISSING'
  | 'PASSENGER_UNRESOLVED'
  | 'PASSENGER_NAME_MISSING'
  | 'BOOKING_IDENTITY_MISSING';

/** Insert immutable bindings for the viable SELECT_OFFER strategies just persisted. Idempotent. */
export async function persistOfferExecutionBindings(
  db: Queryable,
  params: {
    workspaceId: string;
    actorId: string;
    recoveryCaseId: string;
    strategies: readonly RecoveryStrategy[];
    services: readonly WTransportService[];
    resolvedOffers: readonly ResolvedOffer[];
  },
): Promise<number> {
  let written = 0;
  for (const strategy of params.strategies) {
    for (const effect of strategy.scenarioChange.effects) {
      if (effect.effectKind !== 'SELECT_OFFER') continue;
      const resolved = params.resolvedOffers.find((o) => o.offerId === effect.offerId);
      const service = resolved ? params.services.find((s) => s.id === resolved.transportServiceId) : undefined;
      const researched = service?.researchedOffer;
      if (!service || !researched || !researched.providerId) continue;
      const itinerary: OfferBindingItinerary = {
        originPlaceId: service.originPlaceId,
        destinationPlaceId: service.destinationPlaceId,
        departure: service.published.departure?.value ?? null,
        arrival: service.published.arrival?.value ?? null,
        operator: service.operator,
        mode: service.mode,
      };
      const price = effect.offerPrice;
      const result = await db.query(
        `INSERT INTO offer_execution_bindings (
           workspace_id, id, recovery_case_id, recovery_strategy_id, journey_item_id, offer_key,
           provider_id, provider_offer_ref, research_mode, observed_at, quoted_amount, quoted_currency,
           itinerary, created_by_actor_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz,$11,$12,$13::jsonb,$14)
         ON CONFLICT ON CONSTRAINT offer_execution_bindings_identity_uidx DO NOTHING`,
        [
          params.workspaceId, randomUUID(), params.recoveryCaseId, strategy.id, effect.journeyItemId, effect.offerId,
          researched.providerId, researched.rawOfferId,
          researched.provenance.mode === 'INTERNAL' ? 'SIMULATED' : researched.provenance.mode,
          researched.provenance.observedAt,
          price?.amount ?? String(researched.commercial.amount), price?.currency ?? researched.commercial.currency,
          JSON.stringify(itinerary), params.actorId,
        ],
      );
      written += result.rowCount ?? 0;
    }
  }
  return written;
}

interface StoredIntentLite {
  strategyId: string;
  journeyItemId: string;
  offerKey: string;
}

async function loadIntentSelection(db: Queryable, workspaceId: string, intentId: string): Promise<StoredIntentLite | undefined> {
  const row = (await db.query<{ recovery_strategy_id: string | null; subject_refs: unknown }>(
    `SELECT p.recovery_strategy_id, i.subject_refs
       FROM action_intents i
       JOIN action_plans p ON p.workspace_id = i.workspace_id AND p.id = i.action_plan_id
      WHERE i.workspace_id = $1 AND i.id = $2`,
    [workspaceId, intentId],
  )).rows[0];
  if (!row?.recovery_strategy_id) return undefined;
  const refs = (Array.isArray(row.subject_refs) ? row.subject_refs : JSON.parse(String(row.subject_refs))) as { kind: string; id: string }[];
  const item = refs.find((r) => r.kind === 'JOURNEY_ITEM');
  const offer = refs.find((r) => r.kind === 'OFFER');
  if (!item || !offer) return undefined;
  return { strategyId: row.recovery_strategy_id, journeyItemId: item.id, offerKey: offer.id };
}

/** The strategy-level probe (approval time): is there a binding + passengers for this SELECT_OFFER effect? */
export async function resolveOfferExecutionInputsForStrategy(
  db: Queryable,
  workspaceId: string,
  selection: { strategyId: string; journeyItemId: string; offerKey: string },
): Promise<OfferExecutionInputs> {
  const bound = (await db.query<{
    id: string; provider_id: string; provider_offer_ref: string; research_mode: string; observed_at: Date;
    quoted_amount: string; quoted_currency: string; itinerary: OfferBindingItinerary;
  }>(
    `SELECT id, provider_id, provider_offer_ref, research_mode, observed_at, quoted_amount::text AS quoted_amount,
            quoted_currency, itinerary
       FROM offer_execution_bindings
      WHERE workspace_id = $1 AND recovery_strategy_id = $2 AND journey_item_id = $3 AND offer_key = $4`,
    [workspaceId, selection.strategyId, selection.journeyItemId, selection.offerKey],
  )).rows[0];
  if (!bound) {
    return { ready: false, reason: 'OFFER_BINDING_MISSING', detail: 'no protected provider offer binding was recorded for this option' };
  }
  const item = (await db.query<{ journey_id: string; traveller_id: string }>(
    `SELECT ji.journey_id, j.traveller_id
       FROM journey_items ji JOIN journeys j ON j.workspace_id = ji.workspace_id AND j.id = ji.journey_id
      WHERE ji.workspace_id = $1 AND ji.id = $2`,
    [workspaceId, selection.journeyItemId],
  )).rows[0];
  if (!item) return { ready: false, reason: 'JOURNEY_ITEM_MISSING', detail: `journey item ${selection.journeyItemId} not found` };

  // Same passenger rule as the research party: allocations, else the journey's traveller.
  const allocated = (await db.query<{ traveller_id: string }>(
    `SELECT DISTINCT traveller_id FROM reservation_allocations
      WHERE workspace_id = $1 AND journey_item_id = $2 ORDER BY traveller_id`,
    [workspaceId, selection.journeyItemId],
  )).rows.map((r) => r.traveller_id);
  const travellerIds = allocated.length > 0 ? allocated : [item.traveller_id];
  if (travellerIds.length === 0) return { ready: false, reason: 'PASSENGER_UNRESOLVED', detail: 'no traveller resolved for the journey item' };

  const passengers: BookingPassenger[] = [];
  for (const travellerId of travellerIds) {
    const name = (await db.query<{ given_name: string | null; family_name: string | null }>(
      `SELECT given_name, family_name FROM traveller_names
        WHERE workspace_id = $1 AND traveller_id = $2 AND given_name IS NOT NULL AND family_name IS NOT NULL
          AND name_kind IN ('LEGAL', 'DISPLAY', 'PREFERRED')
        ORDER BY (name_kind = 'LEGAL') DESC, valid_from DESC, id LIMIT 1`,
      [workspaceId, travellerId],
    )).rows[0];
    if (!name?.given_name || !name.family_name) {
      return { ready: false, reason: 'PASSENGER_NAME_MISSING', detail: `traveller ${travellerId} has no structured given/family name` };
    }
    const identity = (await db.query<{ gender: 'MALE' | 'FEMALE'; date_of_birth: Date | null; nationality: string | null }>(
      'SELECT gender, date_of_birth, nationality FROM traveller_booking_identities WHERE workspace_id = $1 AND traveller_id = $2',
      [workspaceId, travellerId],
    )).rows[0];
    if (!identity) {
      return { ready: false, reason: 'BOOKING_IDENTITY_MISSING', detail: `traveller ${travellerId} has no protected booking identity (gender is required by the provider)` };
    }
    passengers.push({
      travellerId,
      givenName: name.given_name,
      familyName: name.family_name,
      gender: identity.gender,
      ...(identity.date_of_birth ? { dateOfBirth: identity.date_of_birth.toISOString().slice(0, 10) } : {}),
      ...(identity.nationality ? { nationality: identity.nationality.trim() } : {}),
    });
  }
  const lead = passengers[0]!;
  return {
    ready: true,
    passengers,
    contactName: `${lead.familyName}/${lead.givenName}`,
    binding: {
      id: bound.id, recoveryStrategyId: selection.strategyId, journeyItemId: selection.journeyItemId, journeyId: item.journey_id,
      offerKey: selection.offerKey, providerId: bound.provider_id, providerOfferRef: bound.provider_offer_ref,
      researchMode: bound.research_mode, observedAt: bound.observed_at.toISOString(),
      quotedAmount: bound.quoted_amount, quotedCurrency: bound.quoted_currency, itinerary: bound.itinerary,
    },
  };
}

/** The intent-level probe (execution time). */
export async function resolveOfferExecutionInputs(db: Queryable, workspaceId: string, intentId: string): Promise<OfferExecutionInputs> {
  const selection = await loadIntentSelection(db, workspaceId, intentId);
  if (!selection) return { ready: false, reason: 'OFFER_BINDING_MISSING', detail: 'stored intent carries no JOURNEY_ITEM/OFFER selection' };
  return resolveOfferExecutionInputsForStrategy(db, workspaceId, selection);
}

/** Operator/authoritative booking identity write (idempotent upsert-by-absence: never overwrites). */
export async function recordTravellerBookingIdentity(
  db: Queryable,
  params: { workspaceId: string; actorId: string; travellerId: string; gender: 'MALE' | 'FEMALE'; dateOfBirth?: string; nationality?: string },
): Promise<void> {
  await db.query(
    `INSERT INTO traveller_booking_identities (workspace_id, traveller_id, gender, date_of_birth, nationality, created_by_actor_id)
     VALUES ($1,$2,$3,$4::date,$5,$6) ON CONFLICT (workspace_id, traveller_id) DO NOTHING`,
    [params.workspaceId, params.travellerId, params.gender, params.dateOfBirth ?? null, params.nationality ?? null, params.actorId],
  );
}

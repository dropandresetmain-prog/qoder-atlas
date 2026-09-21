/**
 * Bounded AI transport offer selection for recovery planning (A5 CP4).
 *
 * Within each corridor's existing boardable researched offers and the
 * deterministic corridor cap, the model may prefer a subset / order of real
 * offer keys. Deterministic ranking remains the fallback. Schema validation
 * fails closed. The model cannot invent offers, declare viability, grant
 * authority, or execute.
 */
import { z } from 'zod';
import type { IntelligenceClient } from '../../intelligence/client.ts';
import type { PlanningToolResult } from '../../contracts/v2/planning/planningTool.ts';
import type { Instant } from '../../domain/v2/shared/time.ts';
import type { TransportCorridor } from '../../resolution/planning/transportCorridors.ts';
import { transportRequestId } from '../../resolution/planning/transportCorridors.ts';
import {
  correlatedTransportOffers,
  type TransportCorrelatedOffer,
} from '../../resolution/planning/proposers/transportProposer.ts';

const CorridorSelectionSchema = z.strictObject({
  requestId: z.string().min(1).max(256),
  preferredOfferKeys: z.array(z.string().min(1).max(256)).max(8),
});

const SelectionSchema = z.strictObject({
  selections: z.array(CorridorSelectionSchema).max(12),
  rationale: z.string().max(400).optional(),
});

export type OfferSelectionCandidateSummary = {
  requestId: string;
  offerKey: string;
  segmentCount: number;
  priceAmount: string;
  priceCurrency: string;
  route: string;
};

export type OfferSelectionResult = {
  preferredOfferKeysByRequestId: Readonly<Record<string, readonly string[]>>;
  activity: {
    providerId: string;
    model: string;
    mode: 'LIVE' | 'REPLAY';
    status: 'SUCCEEDED' | 'FAILED';
    latencyMs?: number;
    errorCategory?: 'NOT_CONFIGURED' | 'AUTH' | 'NETWORK' | 'TIMEOUT' | 'RATE_LIMITED' | 'PROVIDER_ERROR' | 'INVALID_OUTPUT' | 'UNAVAILABLE';
  };
  rationale?: string;
};

const SYSTEM = `You assist a travel-recovery planner by preferring researched flight offers within each corridor.
Return JSON only. For each requestId, preferredOfferKeys MUST be a subset of the provided offerKey values for that requestId.
Prefer fewer segments and workable timing when reasonable. Do not invent offer keys. Do not invent request ids.
Do not claim viability, authority, or booking. Keep rationale under 400 characters if present.`;

function routeOf(offer: TransportCorrelatedOffer): string {
  const first = offer.offer.segments[0];
  const last = offer.offer.segments[offer.offer.segments.length - 1];
  if (!first || !last) return 'unknown';
  return `${first.origin.value}->${last.destination.value}`;
}

/**
 * Build the closed candidate list the model may choose from — only boardable,
 * price-valid researched offers, before the corridor cap is applied so the
 * model can surface a boardable offer that deterministic ranking would have
 * truncated out of the cap.
 */
export function buildOfferSelectionCandidates(input: {
  corridors: readonly TransportCorridor[];
  toolResults: readonly PlanningToolResult[];
  now: Instant;
}): { summaries: OfferSelectionCandidateSummary[]; allowedKeysByRequestId: Readonly<Record<string, ReadonlySet<string>>> } {
  // Cap high enough that the model sees the full boardable set; the real cap
  // is re-applied after preference by applyPreferredOfferSelection.
  const { offers } = correlatedTransportOffers({
    corridors: input.corridors,
    toolResults: input.toolResults,
    now: input.now,
    maxOffersPerCorridor: 64,
  });
  const allowedKeysByRequestId: Record<string, Set<string>> = {};
  const summaries: OfferSelectionCandidateSummary[] = [];
  for (const offer of offers) {
    const allowed = allowedKeysByRequestId[offer.requestId] ?? new Set<string>();
    allowed.add(offer.offerKey);
    allowedKeysByRequestId[offer.requestId] = allowed;
    summaries.push({
      requestId: offer.requestId,
      offerKey: offer.offerKey,
      segmentCount: offer.segmentCount,
      priceAmount: offer.price.amount,
      priceCurrency: offer.price.currency,
      route: routeOf(offer),
    });
  }
  return { summaries, allowedKeysByRequestId };
}

/**
 * Keep only preferred keys that exist in the allowed boardable set for that
 * request. Unknown requestIds and unknown keys are dropped (fail closed).
 */
export function sanitizeOfferSelection(
  selections: readonly { requestId: string; preferredOfferKeys: readonly string[] }[],
  allowedKeysByRequestId: Readonly<Record<string, ReadonlySet<string>>>,
): Record<string, readonly string[]> {
  const out: Record<string, string[]> = {};
  for (const selection of selections) {
    const allowed = allowedKeysByRequestId[selection.requestId];
    if (!allowed) continue;
    const keys: string[] = [];
    const seen = new Set<string>();
    for (const key of selection.preferredOfferKeys) {
      if (!allowed.has(key) || seen.has(key)) continue;
      keys.push(key);
      seen.add(key);
    }
    if (keys.length > 0) out[selection.requestId] = keys;
  }
  return out;
}

export async function suggestTransportOfferSelection(
  client: IntelligenceClient,
  input: {
    corridors: readonly TransportCorridor[];
    toolResults: readonly PlanningToolResult[];
    now: Instant;
    maxOffersPerCorridor: number;
  },
): Promise<OfferSelectionResult> {
  const { summaries, allowedKeysByRequestId } = buildOfferSelectionCandidates(input);
  if (summaries.length === 0) {
    return {
      preferredOfferKeysByRequestId: {},
      activity: {
        providerId: client.providerId,
        model: client.model,
        mode: client.mode,
        status: 'SUCCEEDED',
      },
    };
  }

  const userPrompt = JSON.stringify({
    maxOffersPerCorridor: input.maxOffersPerCorridor,
    corridors: input.corridors.map((corridor) => ({
      requestId: transportRequestId(corridor),
      journeyItemId: corridor.journeyItemId,
    })),
    candidates: summaries,
  });

  const result = await client.call({
    id: 'recovery.offer_selection',
    systemPrompt: SYSTEM,
    userPrompt,
    schema: SelectionSchema,
  });

  if (!result.ok) {
    return {
      preferredOfferKeysByRequestId: {},
      activity: {
        providerId: result.meta.providerId,
        model: result.meta.model,
        mode: result.meta.mode,
        status: 'FAILED',
        ...(result.meta.latencyMs === undefined ? {} : { latencyMs: result.meta.latencyMs }),
        errorCategory: result.error.category,
      },
    };
  }

  return {
    preferredOfferKeysByRequestId: sanitizeOfferSelection(result.value.selections, allowedKeysByRequestId),
    activity: {
      providerId: result.meta.providerId,
      model: result.meta.model,
      mode: result.meta.mode,
      status: 'SUCCEEDED',
      ...(result.meta.latencyMs === undefined ? {} : { latencyMs: result.meta.latencyMs }),
    },
    ...(result.value.rationale ? { rationale: result.value.rationale } : {}),
  };
}

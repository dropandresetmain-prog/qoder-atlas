/**
 * Shared hotel-search evidence machinery for deterministic planners.
 *
 * Structural guards + derived place identity + per-property cheapest-rate
 * ranking, used identically by the window-shift stay track and the
 * failed-leg planner's required-overnight follow-up, so both speak the same
 * provider evidence dialect. Selection stays evidence-first: refundable rates
 * outrank non-refundable, then price, then deterministic rateId order.
 */
import type { EntityId } from '../domain/common.ts';
import type { HotelPropertyView, HotelRateView } from '../contracts/capabilities.ts';
import type { PriorToolResult } from '../contracts/planner.ts';

/** Presentation bound: cheapest rate per distinct property, capped. */
export const MAX_HOTEL_STRATEGIES = 3;

/** Normalized hotel.search evidence a planner consumes. */
export interface HotelSearchEvidence {
  properties: HotelPropertyView[];
  rates: HotelRateView[];
}

export interface RankedHotelRate {
  rate: HotelRateView;
  property: HotelPropertyView;
}

/** Structural guards: only well-formed provider views become candidates. */
export function isHotelPropertyView(value: unknown): value is HotelPropertyView {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record['propertyId'] === 'string' && record['propertyId'].length > 0;
}

export function isHotelRateView(value: unknown): value is HotelRateView {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const price = record['totalPrice'] as Record<string, unknown> | undefined;
  return (
    typeof record['rateId'] === 'string' &&
    record['rateId'].length > 0 &&
    typeof record['propertyId'] === 'string' &&
    record['propertyId'].length > 0 &&
    price !== undefined &&
    typeof price === 'object' &&
    typeof price['amount'] === 'number' &&
    typeof price['currency'] === 'string'
  );
}

/**
 * Deterministic place id for a search-derived property: derived purely from
 * the property's provider externalRef — no scenario or name knowledge.
 */
export function derivedPlaceIdFor(property: HotelPropertyView): EntityId {
  const primary = property.externalRefs?.[0];
  return `place-hotel-${primary ? `${primary.system}-${primary.value}` : property.propertyId}`.replace(
    /[^A-Za-z0-9_.:-]/g,
    '-',
  );
}

/**
 * Collect hotel.search evidence from prior tool results. Matches by tool
 * request id when supplied (deterministic scoped requests), else any result
 * carrying hotel search shape.
 */
export function collectHotelSearchEvidence(
  priorToolResults: PriorToolResult[],
  toolRequestId?: EntityId,
): HotelSearchEvidence | undefined {
  const properties: HotelPropertyView[] = [];
  const rates: HotelRateView[] = [];
  let sawSearch = false;
  const propertyIds = new Set<string>();
  const rateIds = new Set<string>();
  for (const result of priorToolResults) {
    if (toolRequestId !== undefined && result.toolRequestId !== toolRequestId) continue;
    const data = result.data;
    const rawProperties = data['properties'];
    const rawRates = data['rates'];
    if (!Array.isArray(rawProperties) && !Array.isArray(rawRates)) continue;
    sawSearch = true;
    for (const value of Array.isArray(rawProperties) ? rawProperties : []) {
      if (isHotelPropertyView(value) && !propertyIds.has(value.propertyId)) {
        propertyIds.add(value.propertyId);
        properties.push(value);
      }
    }
    for (const value of Array.isArray(rawRates) ? rawRates : []) {
      if (isHotelRateView(value) && !rateIds.has(value.rateId)) {
        rateIds.add(value.rateId);
        rates.push(value);
      }
    }
  }
  if (!sawSearch) return undefined;
  return { properties, rates };
}

/**
 * One representative rate per distinct property, ranked refundable-first,
 * then by price, then deterministic rateId order. Within a property the
 * representative is likewise the cheapest REFUNDABLE rate when one exists
 * (a non-refundable rate only represents its property when no refundable
 * one exists). Capped at MAX_HOTEL_STRATEGIES.
 */
export function rankHotelRates(evidence: HotelSearchEvidence): RankedHotelRate[] {
  const propertyById = new Map(evidence.properties.map((property) => [property.propertyId, property]));
  const bestByProperty = new Map<string, HotelRateView>();
  for (const rate of evidence.rates) {
    if (!propertyById.has(rate.propertyId)) continue;
    const incumbent = bestByProperty.get(rate.propertyId);
    if (!incumbent || betterRateForProperty(rate, incumbent)) {
      bestByProperty.set(rate.propertyId, rate);
    }
  }
  const ranked = [...bestByProperty.entries()]
    .map(([propertyId, rate]) => ({ rate, property: propertyById.get(propertyId)! }))
    .sort((a, b) => {
      const refundableDiff = Number(b.rate.refundable === true) - Number(a.rate.refundable === true);
      if (refundableDiff !== 0) return refundableDiff;
      const priceDiff = a.rate.totalPrice.amount - b.rate.totalPrice.amount;
      if (priceDiff !== 0) return priceDiff;
      return a.rate.rateId.localeCompare(b.rate.rateId);
    });
  return ranked.slice(0, MAX_HOTEL_STRATEGIES);
}

function betterRateForProperty(candidate: HotelRateView, incumbent: HotelRateView): boolean {
  const refundableDiff = Number(candidate.refundable === true) - Number(incumbent.refundable === true);
  if (refundableDiff !== 0) return refundableDiff > 0;
  if (candidate.totalPrice.amount !== incumbent.totalPrice.amount) {
    return candidate.totalPrice.amount < incumbent.totalPrice.amount;
  }
  return candidate.rateId.localeCompare(incumbent.rateId) < 0;
}

/**
 * A programme-known place is reusable only when provider externalRef EVIDENCE
 * ties the searched property to it; absent evidence the candidate introduces
 * a derived place keyed by the provider ref. No name guessing.
 */
export function knownPlaceForProperty(
  places: ReadonlyArray<{ id: EntityId; externalRefs: ReadonlyArray<{ system: string; value: string }> }>,
  property: HotelPropertyView,
): { id: EntityId } | undefined {
  return places.find((place) =>
    place.externalRefs.some(
      (ref) =>
        property.externalRefs?.some(
          (candidate) => candidate.system === ref.system && candidate.value === ref.value,
        ) ?? false,
    ),
  );
}

/** Stable identities for the bounded selected-plan continuation seam.
 * JSONB may reorder object keys. Array order (especially source-effect order)
 * is material and must never be sorted away.
 */
import { createHash } from 'node:crypto';
import type { ScenarioEffect } from '../../contracts/v2/scenario/scenarioChange.ts';

export function selectedPlanFingerprint(value: unknown): string {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical);
    if (item !== null && typeof item === 'object') {
      return Object.fromEntries(Object.entries(item as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]));
    }
    return item;
  };
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export function selectedEffectFingerprint(effect: ScenarioEffect): string {
  return selectedPlanFingerprint(effect);
}

/** A source-kind mismatch is not a recoverable continuation. No demo names. */
export function capabilityForSelectedEffect(effect: ScenarioEffect): string {
  switch (effect.effectKind) {
    case 'SELECT_OFFER': return 'external:offer.select';
    case 'ADD_JOURNEY_STAY': return 'external:stay.book';
    case 'CANCEL_STAY': return 'external:stay.cancel';
    case 'ALTER_JOURNEY_ITEM_INTENT': return 'internal:journey.intent';
    case 'CHANGE_PROGRAMME_ITEM_TIME': return 'internal:programme.schedule';
    case 'PROPOSE_ALLOCATION': return 'internal:reservation.allocation';
    case 'CHANGE_SUPPORT_ASSIGNMENT': return 'internal:support.assignment';
    case 'WAIVE_OBJECTIVE': return 'internal:objective.disposition';
  }
}

/**
 * Shared full EvaluationContext builder (PL-4). Impact assessment, signal
 * pipeline constraint persistence, candidate viability and post-execution
 * verification must all evaluate against the same generic context shape —
 * trip, places, travellers, rule sets and the anchor event — never a thin
 * subset that silently turns location/traveller-aware evidence into UNKNOWN.
 */
import type { IsoDateTime } from '../domain/common.ts';
import type { Trip } from '../domain/trip.ts';
import type { Place, Traveller } from '../domain/entities.ts';
import type { RuleSet } from '../domain/rules.ts';
import type { EntityStore } from '../persistence/entityStore.ts';
import type { EvaluationContext } from './evaluators.ts';

export async function buildEvaluationContext(
  entities: EntityStore,
  trip: Trip,
  now: IsoDateTime,
): Promise<EvaluationContext> {
  const places = new Map<string, Place>(
    (await entities.list('PLACE'))
      .filter((entry) => entry.entityType === 'PLACE')
      .map((entry) => [entry.entity.id, entry.entity]),
  );
  const ruleSets = new Map<string, RuleSet>(
    (await entities.list('RULE_SET'))
      .filter((entry) => entry.entityType === 'RULE_SET')
      .map((entry) => [entry.entity.id, entry.entity]),
  );
  const travellers: Traveller[] = (await entities.list('TRAVELLER'))
    .filter((entry) => entry.entityType === 'TRAVELLER')
    .map((entry) => entry.entity);
  const anchorEntry = trip.anchorEventId ? await entities.get('ANCHOR_EVENT', trip.anchorEventId) : undefined;
  return {
    trip,
    places,
    ruleSets,
    travellers,
    anchorEvent: anchorEntry?.entityType === 'ANCHOR_EVENT' ? anchorEntry.entity : undefined,
    now,
  };
}

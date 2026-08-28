/**
 * Derive substitution-target element ids for open change/recovery cases.
 * Generic — uses strategy overlay operations and change-request targets only.
 */
import type { EntityId } from '../domain/common.ts';
import type { Place } from '../domain/entities.ts';
import type { TransportLeg, TripElement } from '../domain/elements.ts';
import type { Trip } from '../domain/trip.ts';
import type { RecoveryCase } from '../operational/case.ts';
import type { RecoveryStrategy } from '../operational/strategy.ts';
import type { MutationOperation } from '../operational/mutation.ts';
import type { ResolutionTarget } from '../contracts/changeRequest.ts';

function isTransportLeg(element: TripElement): element is TransportLeg {
  return element.elementKind === 'TRANSPORT_LEG';
}

function airportCodeFromPlaceId(
  placeId: EntityId,
  places?: ReadonlyMap<string, Place>,
): string | undefined {
  if (!places) return undefined;
  const place = places.get(placeId);
  const code = place?.externalRefs.find((ref) => ref.system === 'airport-code')?.value;
  return code ? code.toUpperCase() : undefined;
}

/** Elements a staged strategy replaces in-place (same element id UPSERT). */
export function substitutionTargetsFromStrategy(strategy: RecoveryStrategy | undefined, trip: Trip): EntityId[] {
  if (!strategy) return [];
  const existingIds = new Set(trip.elements.map((element) => element.id));
  const targets: EntityId[] = [];
  for (const operation of strategy.candidateOperations) {
    if (operation.op !== 'UPSERT_ENTITY' || operation.entityType !== 'TRIP_ELEMENT') continue;
    const elementId = operation.id;
    if (!elementId || !existingIds.has(elementId)) continue;
    const current = trip.elements.find((element) => element.id === elementId);
    if (!current || !isTransportLeg(current)) continue;
    targets.push(elementId);
  }
  return targets;
}

export function substitutionTargetsFromStrategies(
  strategies: readonly RecoveryStrategy[],
  trip: Trip,
  bestStrategyId?: EntityId,
): EntityId[] {
  const preferred = bestStrategyId
    ? strategies.find((strategy) => strategy.id === bestStrategyId)
    : strategies[0];
  return substitutionTargetsFromStrategy(preferred, trip);
}

/** Inbound legs made obsolete by a declared departure-gateway substitution. */
export function substitutionTargetsFromChangeTarget(
  trip: Trip,
  target: ResolutionTarget | undefined,
  places?: ReadonlyMap<string, Place>,
): EntityId[] {
  if (!target?.departureOrigin) return [];
  const declared = target.departureOrigin.value.toUpperCase();
  const targets: EntityId[] = [];
  for (const element of trip.elements) {
    if (!isTransportLeg(element)) continue;
    const originCode = airportCodeFromPlaceId(element.data.originPlaceId, places);
    if (!originCode) continue;
    if (originCode !== declared && element.reservationState !== 'CANCELLED') {
      targets.push(element.id);
    }
  }
  return targets;
}

export function resolveSubstitutionTargetIds(input: {
  trip: Trip;
  recoveryCase?: RecoveryCase;
  bestStrategyId?: EntityId;
  changeTarget?: ResolutionTarget;
  places?: ReadonlyMap<string, Place>;
}): EntityId[] {
  const fromStrategy = input.recoveryCase
    ? substitutionTargetsFromStrategies(
        input.recoveryCase.strategies,
        input.trip,
        input.bestStrategyId,
      )
    : [];
  const fromChange = substitutionTargetsFromChangeTarget(input.trip, input.changeTarget, input.places);
  return [...new Set<EntityId>([...fromStrategy, ...fromChange])];
}

export type PendingChangePhase = 'NONE' | 'REQUESTED' | 'APPROVED_AWAITING_EXECUTION';

export function pendingChangePhaseForCase(
  recoveryCase?: RecoveryCase,
  options?: { changeRequestCase?: boolean },
): PendingChangePhase {
  if (!recoveryCase || recoveryCase.status === 'RESOLVED') return 'NONE';
  if (!options?.changeRequestCase) return 'NONE';
  const approved = recoveryCase.authorityDecisions.some(
    (decision) => decision.approval?.decision === 'APPROVED' || decision.outcome === 'AUTO_APPROVED',
  );
  const executable = recoveryCase.actionIntents.some(
    (intent) => intent.status === 'AUTHORISED' || intent.status === 'PROPOSED',
  );
  if (approved && executable) return 'APPROVED_AWAITING_EXECUTION';
  return 'REQUESTED';
}

export function consequentialOperationTargets(operations: readonly MutationOperation[], trip: Trip): EntityId[] {
  const existing = new Set(trip.elements.map((element) => element.id));
  const targets: EntityId[] = [];
  for (const operation of operations) {
    if (operation.op !== 'UPSERT_ENTITY' || operation.entityType !== 'TRIP_ELEMENT') continue;
    const elementId = operation.id;
    if (!elementId || !existing.has(elementId)) continue;
    targets.push(elementId);
  }
  return targets;
}

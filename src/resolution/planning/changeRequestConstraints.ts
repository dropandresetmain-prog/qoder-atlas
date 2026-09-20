import type { ComparatorPreference } from '../../contracts/v2/planning/strategyRecommendation.ts';
import type { ChangeRequestPlanningBasis } from '../../contracts/v2/planning/changeRequestPlanning.ts';
import type { RecoveryDomainId } from '../../contracts/v2/planning/recoveryDomain.ts';
import type { TypedRef } from '../../domain/v2/shared/identity.ts';
import type { ScenarioChange } from '../../contracts/v2/scenario/scenarioChange.ts';
import type { CapturedWorld } from '../world/world.ts';
import type { ResolvedOffer } from '../scenarios/overlay.ts';
import { applyScenarioOverlay } from '../scenarios/overlay.ts';
import { projectEffectiveWorld } from '../world/effectiveItinerary.ts';
import { compareInstants } from '../../domain/v2/shared/time.ts';

export interface RequestConstraint {
  code: string;
  domain: RecoveryDomainId;
  /** HARD excludes non-matching candidates; SOFT only orders viable matches. */
  mode: 'HARD' | 'SOFT';
}

export interface RequestPlanningContext {
  basis: ChangeRequestPlanningBasis;
  requestedSubjects: readonly TypedRef[];
  constraints: readonly RequestConstraint[];
  /** Every target field without a current evaluator/proposer meaning. */
  unresolved: readonly { code: string; description: string; domain: RecoveryDomainId }[];
  domains: ReadonlySet<RecoveryDomainId>;
  comparatorPreferences: readonly ComparatorPreference[];
}

const constraint = (code: string, domain: RecoveryDomainId, mode: RequestConstraint['mode']): RequestConstraint => ({ code, domain, mode });

/**
 * Maps the frozen typed desire into either a deterministic current planner
 * constraint or a factual unsupported-evidence record. It never invents a
 * canonical change or silently discards a field.
 */
export function deriveRequestPlanningContext(input: {
  basis: ChangeRequestPlanningBasis;
  journeyId: string;
  representedTravellerId: string;
}): RequestPlanningContext {
  const mode: RequestConstraint['mode'] = input.basis.urgency === 'HARD_INSTRUCTION' ? 'HARD' : 'SOFT';
  const target = input.basis.desiredTarget;
  const constraints: RequestConstraint[] = [];
  const unresolved: RequestPlanningContext['unresolved'][number][] = [];
  const supported = (present: boolean | undefined, code: string): void => { if (present) constraints.push(constraint(code, 'TRANSPORT', mode)); };
  supported(target.arriveBy !== undefined, 'request_arrive_by');
  supported(target.departAfter !== undefined, 'request_depart_after');
  supported(target.transport?.preferDirect === true, 'request_prefer_direct');
  supported(target.transport?.earliestDeparture !== undefined, 'request_earliest_departure');
  supported(target.transport?.latestDeparture !== undefined, 'request_latest_departure');
  const unsupported = (present: boolean, code: string, description: string, domain: RecoveryDomainId): void => {
    if (present) unresolved.push({ code, description, domain });
  };
  unsupported(target.departureOrigin !== undefined, 'request_origin_unresolved', 'Requested departure origin has no current canonical transport-corridor override.', 'TRANSPORT');
  unsupported(target.preserveReturnDestination !== undefined, 'request_return_destination_unresolved', 'Requested return preservation has no current candidate constraint.', 'TRANSPORT');
  unsupported(target.preferredStayProximityPlaceId !== undefined, 'request_stay_proximity_unresolved', 'Requested stay proximity has no current stay candidate evaluator.', 'STAY');
  unsupported(target.stayCheckOut !== undefined, 'request_stay_checkout_unresolved', 'Requested stay checkout has no current stay candidate evaluator.', 'STAY');
  unsupported(target.stayPlaceExternalRef !== undefined || target.preferredStayPlaceId !== undefined || target.guests !== undefined, 'request_stay_selection_unresolved', 'Requested stay selection or guest count has no current stay candidate evaluator.', 'STAY');
  unsupported(target.travelWithTravellerIds.length > 0, 'request_travel_together_unresolved', 'Requested travel association has no current candidate binding evaluator.', 'TRANSPORT');
  unsupported(target.objectiveEffects.length > 0, 'request_objective_effect_unresolved', 'Requested objective effect has no current request-to-scenario evaluator.', 'PROGRAMME');
  const domains = new Set<RecoveryDomainId>([...constraints.map((c) => c.domain), ...unresolved.map((u) => u.domain)]);
  const comparatorPreferences: ComparatorPreference[] = mode === 'SOFT'
    ? constraints.map((c) => ({ code: c.code, priority: 'EXPLICIT_TRAVELLER', inferred: false, summary: `Traveller requested ${c.code.replace(/^request_/, '').replaceAll('_', ' ')}.`, subjectRef: { kind: 'JOURNEY', id: input.journeyId } }))
    : [];
  return {
    basis: input.basis,
    requestedSubjects: [
      { kind: 'JOURNEY', id: input.journeyId },
      { kind: 'TRAVELLER', id: input.representedTravellerId },
    ],
    constraints,
    unresolved,
    domains,
    comparatorPreferences,
  };
}

export interface RequestConstraintEvaluation {
  satisfiedCodes: readonly string[];
  unsatisfiedHardCodes: readonly string[];
}

/**
 * Evaluate request constraints from the validated scenario overlay. Proposers
 * cannot self-attest satisfaction: the selected effective item/service is the
 * only source for hard filtering and soft ranking.
 */
export function evaluateRequestConstraints(input: {
  context: RequestPlanningContext;
  scenarioChange: ScenarioChange;
  world: CapturedWorld;
  resolvedOffers: readonly ResolvedOffer[];
}): RequestConstraintEvaluation {
  const overlay = applyScenarioOverlay({
    baseWorld: input.world,
    scenarioChange: input.scenarioChange,
    resolvedOffers: input.resolvedOffers,
  });
  if (!overlay.ok) {
    return {
      satisfiedCodes: [],
      unsatisfiedHardCodes: input.context.constraints.filter((value) => value.mode === 'HARD').map((value) => value.code),
    };
  }

  const effective = projectEffectiveWorld(overlay.value.proposedWorld);
  const selectedItemIds = new Set(input.scenarioChange.effects.flatMap((effect) => effect.effectKind === 'SELECT_OFFER' ? [effect.journeyItemId] : []));
  const journey = effective.journeys.find((value) => value.journeyRef.id === input.context.basis.journeyId);
  const selected = journey?.items.filter((item) => selectedItemIds.has(item.itemRef.id) && item.kind === 'TRANSPORT') ?? [];
  const satisfied = new Set<string>();
  const target = input.context.basis.desiredTarget;
  for (const item of selected) {
    if (target.arriveBy && item.end.value && compareInstants(item.end.value, target.arriveBy) <= 0) satisfied.add('request_arrive_by');
    if (target.departAfter && item.start.value && compareInstants(item.start.value, target.departAfter) >= 0) satisfied.add('request_depart_after');
    if (target.transport?.earliestDeparture && item.start.value && compareInstants(item.start.value, target.transport.earliestDeparture) >= 0) satisfied.add('request_earliest_departure');
    if (target.transport?.latestDeparture && item.start.value && compareInstants(item.start.value, target.transport.latestDeparture) <= 0) satisfied.add('request_latest_departure');
    if (target.transport?.preferDirect === true && item.serviceRef) {
      const service = overlay.value.proposedWorld.transportServices.find((value) => value.id === item.serviceRef!.id);
      if (service?.researchedOffer?.segments.length === 1) satisfied.add('request_prefer_direct');
    }
  }
  const satisfiedCodes = [...satisfied].sort();
  return {
    satisfiedCodes,
    unsatisfiedHardCodes: input.context.constraints
      .filter((value) => value.mode === 'HARD' && !satisfied.has(value.code))
      .map((value) => value.code),
  };
}

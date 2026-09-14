/**
 * NORTHSTAR M7 — ActionPlan compiler.
 *
 * Compiles a VIABLE RecoveryStrategy into a typed, acyclic ActionPlan.
 * Every consequential ScenarioEffect maps to one or more ActionIntents.
 * There is no generic "upsert entity" escape hatch. Unsupported capability
 * yields CAPABILITY_UNSUPPORTED. Cycles are rejected. Stale / non-viable /
 * UNKNOWN strategies are refused.
 *
 * This module does not execute actions, grant authority, or call providers.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { ScenarioEffect } from '../../contracts/v2/scenario/scenarioChange.ts';
import type { RecoveryStrategy } from '../../contracts/v2/scenario/recoveryStrategy.ts';
import {
  ActionPlanSchema,
  validateActionPlanAcyclic,
  type ActionDependency,
  type ActionIntent,
  type ActionPlan,
} from '../../contracts/v2/action/actionPlan.ts';
import { typedConflict, type TypedResult, ok, conflict } from '../../domain/v2/shared/errors.ts';
import type { TypedRef } from '../../domain/v2/shared/identity.ts';
import { assessManifestCurrentness, type CurrentState } from '../world/currentness.ts';
import type { Instant } from '../../domain/v2/shared/time.ts';

/** Declared capability truth supplied by the caller — never invented here. */
export interface CapabilityStatement {
  capabilityRef: string;
  supported: boolean;
}

export interface CompileActionPlanInput {
  strategy: RecoveryStrategy;
  now: Instant;
  /** When set, refuse compile if the strategy base manifest is no longer current. */
  currentState?: CurrentState;
  /** Known capability statements; missing → unsupported (do not fabricate). */
  capabilities?: readonly CapabilityStatement[];
  actionPlanId?: string;
}

export interface CompileActionPlanResult {
  plan: ActionPlan;
}

const INTERNAL_PROGRAMME_SCHEDULE = 'internal:programme.schedule';
const INTERNAL_JOURNEY_INTENT = 'internal:journey.intent';
const INTERNAL_SUPPORT_ASSIGNMENT = 'internal:support.assignment';
const INTERNAL_OBJECTIVE_DISPOSITION = 'internal:objective.disposition';
const INTERNAL_RESERVATION_ALLOCATION = 'internal:reservation.allocation';
const EXTERNAL_SELECT_OFFER = 'external:offer.select';

function capabilitySupported(capabilities: readonly CapabilityStatement[] | undefined, ref: string): boolean {
  // Internal executors are always structurally available at compile time; M8
  // still requires authority. External capabilities must be explicitly supported.
  if (ref.startsWith('internal:')) return true;
  const row = capabilities?.find((c) => c.capabilityRef === ref);
  return row?.supported === true;
}

function fingerprint(parts: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

function intentForEffect(
  planId: string,
  strategy: RecoveryStrategy,
  effect: ScenarioEffect,
  index: number,
): TypedResult<ActionIntent> {
  const id = randomUUID();
  const base = {
    id,
    actionPlanId: planId,
    status: 'PROPOSED' as const,
    compensationPolicy: { supported: false, requiresSeparateAuthority: true },
  };

  switch (effect.effectKind) {
    case 'SELECT_OFFER': {
      const capabilityRef = EXTERNAL_SELECT_OFFER;
      const subjectRefs: TypedRef[] = [
        { kind: 'JOURNEY_ITEM', id: effect.journeyItemId },
        { kind: 'OFFER', id: effect.offerId },
      ];
      return ok({
        ...base,
        operationNamespace: 'provider.offer',
        logicalOperationKey: `select-offer:${effect.journeyItemId}:${effect.offerId}`,
        requestFingerprint: fingerprint({ effect, strategyVersion: strategy.strategyVersion }),
        capabilityRef,
        subjectRefs,
        expectedRevisions: [],
        preconditions: [
          `basisAssessment:${strategy.basisAssessmentId}`,
          `strategyVersion:${strategy.strategyVersion}`,
        ],
        requiredAuthorityScopes: ['journey.service_selection'],
        expectedObservations: ['EXTERNAL_PROVIDER:reservation_or_ticket_confirmation'],
        offerFingerprint: effect.offerId,
      });
    }
    case 'PROPOSE_ALLOCATION': {
      const capabilityRef = INTERNAL_RESERVATION_ALLOCATION;
      return ok({
        ...base,
        operationNamespace: 'internal.reservation',
        logicalOperationKey: `allocate:${effect.reservationLineId}:${effect.travellerId}`,
        requestFingerprint: fingerprint({ effect, strategyVersion: strategy.strategyVersion }),
        capabilityRef,
        subjectRefs: [
          { kind: 'RESERVATION_LINE', id: effect.reservationLineId },
          { kind: 'TRAVELLER', id: effect.travellerId },
        ],
        expectedRevisions: [],
        preconditions: [`basisAssessment:${strategy.basisAssessmentId}`],
        requiredAuthorityScopes: ['reservation.allocation'],
        expectedObservations: ['INTERNAL_COMMAND_RECEIPT:allocation_recorded'],
      });
    }
    case 'CHANGE_PROGRAMME_ITEM_TIME': {
      const capabilityRef = INTERNAL_PROGRAMME_SCHEDULE;
      return ok({
        ...base,
        operationNamespace: 'internal.programme',
        logicalOperationKey: `programme-schedule:${effect.programmeItemId}:${effect.proposedWindow.start}`,
        requestFingerprint: fingerprint({ effect, strategyVersion: strategy.strategyVersion }),
        capabilityRef,
        subjectRefs: [{ kind: 'PROGRAMME_ITEM', id: effect.programmeItemId }],
        expectedRevisions: [],
        preconditions: [`basisAssessment:${strategy.basisAssessmentId}`],
        requiredAuthorityScopes: ['programme.schedule'],
        expectedObservations: ['INTERNAL_COMMAND_RECEIPT:programme_item_schedule_updated'],
      });
    }
    case 'ALTER_JOURNEY_ITEM_INTENT': {
      const capabilityRef = INTERNAL_JOURNEY_INTENT;
      return ok({
        ...base,
        operationNamespace: 'internal.journey',
        logicalOperationKey: `journey-intent:${effect.journeyItemId}:${index}`,
        requestFingerprint: fingerprint({ effect, strategyVersion: strategy.strategyVersion }),
        capabilityRef,
        subjectRefs: [{ kind: 'JOURNEY_ITEM', id: effect.journeyItemId }],
        expectedRevisions: [],
        preconditions: [`basisAssessment:${strategy.basisAssessmentId}`],
        requiredAuthorityScopes: ['journey.intent'],
        expectedObservations: ['INTERNAL_COMMAND_RECEIPT:journey_item_intent_updated'],
      });
    }
    case 'CHANGE_SUPPORT_ASSIGNMENT': {
      const capabilityRef = INTERNAL_SUPPORT_ASSIGNMENT;
      return ok({
        ...base,
        operationNamespace: 'internal.support',
        logicalOperationKey: `support:${effect.constraintDefinitionId}:v${effect.constraintDefinitionVersion}`,
        requestFingerprint: fingerprint({ effect, strategyVersion: strategy.strategyVersion }),
        capabilityRef,
        subjectRefs: [{ kind: 'CONSTRAINT_DEFINITION', id: effect.constraintDefinitionId }],
        expectedRevisions: [{
          aggregateRef: { kind: 'CONSTRAINT_DEFINITION', id: effect.constraintDefinitionId },
          expectedRevision: effect.constraintDefinitionVersion,
        }],
        preconditions: [`basisAssessment:${strategy.basisAssessmentId}`],
        requiredAuthorityScopes: ['support.assignment'],
        expectedObservations: ['INTERNAL_COMMAND_RECEIPT:support_assignment_updated'],
      });
    }
    case 'WAIVE_OBJECTIVE': {
      const capabilityRef = INTERNAL_OBJECTIVE_DISPOSITION;
      const disposition = effect.disposition ?? 'WAIVED';
      return ok({
        ...base,
        operationNamespace: 'internal.objective',
        logicalOperationKey: `objective-disposition:${effect.objectiveId}:${disposition}`,
        requestFingerprint: fingerprint({ effect, strategyVersion: strategy.strategyVersion }),
        capabilityRef,
        subjectRefs: [{ kind: 'OBJECTIVE', id: effect.objectiveId }],
        expectedRevisions: [],
        preconditions: [`basisAssessment:${strategy.basisAssessmentId}`, `rationale:${effect.rationale}`],
        requiredAuthorityScopes: ['objective.disposition', `objective.disposition:${disposition}`],
        expectedObservations: ['INTERNAL_COMMAND_RECEIPT:objective_disposition_recorded'],
      });
    }
    default: {
      const _exhaustive: never = effect;
      return conflict(typedConflict('VALIDATION_FAILED', `no typed action mapping for ${JSON.stringify(_exhaustive)}`));
    }
  }
}

/**
 * Default dependency order: external offer selection before allocations;
 * journey/service changes before programme moves; objective disposition last.
 */
function defaultDependencies(intents: ActionIntent[], effects: ScenarioEffect[]): ActionDependency[] {
  const byEffect = intents.map((intent, i) => ({ intent, effect: effects[i]! }));
  const deps: ActionDependency[] = [];
  const select = byEffect.filter((x) => x.effect.effectKind === 'SELECT_OFFER');
  const alloc = byEffect.filter((x) => x.effect.effectKind === 'PROPOSE_ALLOCATION');
  const programme = byEffect.filter((x) => x.effect.effectKind === 'CHANGE_PROGRAMME_ITEM_TIME');
  const disposition = byEffect.filter((x) => x.effect.effectKind === 'WAIVE_OBJECTIVE');

  for (const s of select) {
    for (const a of alloc) {
      deps.push({ fromActionIntentId: s.intent.id, toActionIntentId: a.intent.id });
    }
    for (const p of programme) {
      deps.push({ fromActionIntentId: s.intent.id, toActionIntentId: p.intent.id });
    }
  }
  for (const a of alloc) {
    for (const p of programme) {
      deps.push({ fromActionIntentId: a.intent.id, toActionIntentId: p.intent.id });
    }
  }
  for (const prior of [...select, ...alloc, ...programme]) {
    for (const d of disposition) {
      deps.push({ fromActionIntentId: prior.intent.id, toActionIntentId: d.intent.id });
    }
  }
  return deps;
}

export function compileActionPlan(input: CompileActionPlanInput): TypedResult<CompileActionPlanResult> {
  const { strategy } = input;

  if (strategy.viability === 'STALE_BASE') {
    return conflict(typedConflict('STALE_AGGREGATE_REVISION', 'cannot compile action plan from a stale-base strategy'));
  }
  if (input.currentState) {
    const currentness = assessManifestCurrentness(strategy.baseManifest, input.currentState, input.now);
    if (!currentness.current) {
      return conflict(typedConflict(
        'STALE_AGGREGATE_REVISION',
        `strategy base manifest is no longer current: ${currentness.reasons.map((r) => r.kind).join(',')}`,
      ));
    }
  }
  if (strategy.viability === 'NOT_EXECUTABLE') {
    return conflict(typedConflict('VALIDATION_FAILED', 'UNKNOWN candidate is not executable viability'));
  }
  if (strategy.viability !== 'VIABLE') {
    return conflict(typedConflict('VALIDATION_FAILED', `strategy viability ${strategy.viability} cannot be compiled`));
  }

  const planId = input.actionPlanId ?? randomUUID();
  const intents: ActionIntent[] = [];
  for (let i = 0; i < strategy.scenarioChange.effects.length; i += 1) {
    const effect = strategy.scenarioChange.effects[i]!;
    const built = intentForEffect(planId, strategy, effect, i);
    if (!built.ok) return built;
    if (!capabilitySupported(input.capabilities, built.value.capabilityRef)) {
      return conflict(typedConflict(
        'CAPABILITY_UNSUPPORTED',
        `capability ${built.value.capabilityRef} is not supported; refusing to fabricate provider capability`,
        built.value.subjectRefs,
      ));
    }
    intents.push(built.value);
  }

  if (intents.length === 0) {
    return conflict(typedConflict('VALIDATION_FAILED', 'action plan requires at least one typed intent'));
  }

  const dependencies = defaultDependencies(intents, strategy.scenarioChange.effects);
  const plan = ActionPlanSchema.parse({
    id: planId,
    recoveryCaseId: strategy.recoveryCaseId,
    scenarioChangeId: strategy.scenarioChange.id,
    intents,
    dependencies,
  });

  const acyclic = validateActionPlanAcyclic(plan);
  if (!acyclic.ok) return acyclic;

  return ok({ plan });
}

/** Explicit cycle injection helper for tests — not used by the compiler. */
export function withForcedCycle(plan: ActionPlan): ActionPlan {
  if (plan.intents.length < 2) return plan;
  const a = plan.intents[0]!.id;
  const b = plan.intents[1]!.id;
  return {
    ...plan,
    dependencies: [
      ...plan.dependencies,
      { fromActionIntentId: a, toActionIntentId: b },
      { fromActionIntentId: b, toActionIntentId: a },
    ],
  };
}

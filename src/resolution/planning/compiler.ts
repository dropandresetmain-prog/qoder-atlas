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
import { selectedEffectFingerprint } from '../execution/selectedPlanIdentity.ts';
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
  /**
   * Optional programmeItemId → programmeId ownership map used to capture a
   * real PROGRAMME expectedRevision on CHANGE_PROGRAMME_ITEM_TIME intents.
   * When omitted, a single PROGRAMME aggregateRead on the strategy base
   * manifest is used as a deterministic fallback (bilateral same-Programme
   * plans). Never invents a revision: missing ownership/manifest → empty
   * expectedRevisions (executor may still resolve from the stored manifest).
   */
  programmeItemOwnership?: ReadonlyMap<string, string>;
  /**
   * Captured ownership for a stay cancellation. This is supplied by the
   * caller's authoritative world capture; the compiler never guesses it from
   * an unrelated manifest read.
   */
  stayCancellationOwnership?: ReadonlyMap<string, { journeyId: string; reservationId: string; orderKey?: string }>;
  /** Authoritative owner of existing JourneyItems selected by transport effects. */
  journeyItemOwnership?: ReadonlyMap<string, { journeyId: string; orderKey: string }>;
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
const EXTERNAL_STAY_BOOK = 'external:stay.book';
const EXTERNAL_STAY_CANCEL = 'external:stay.cancel';

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

/**
 * Resolve the Programme aggregate + revision that a programme-item schedule
 * mutation must CAS against. Prefer explicit ownership; otherwise accept a
 * single PROGRAMME aggregateRead on the strategy base manifest.
 */
function programmeExpectedRevisions(
  strategy: RecoveryStrategy,
  programmeItemId: string,
  ownership: ReadonlyMap<string, string> | undefined,
): { aggregateRef: TypedRef; expectedRevision: number }[] {
  const programmeReads = strategy.baseManifest.aggregateReads.filter((r) => r.aggregateRef.kind === 'PROGRAMME');
  const ownedProgrammeId = ownership?.get(programmeItemId);
  const programmeId = ownedProgrammeId
    ?? (programmeReads.length === 1 ? programmeReads[0]!.aggregateRef.id : undefined);
  if (!programmeId) return [];
  const read = programmeReads.find((r) => r.aggregateRef.id === programmeId);
  if (!read) return [];
  return [{
    aggregateRef: { kind: 'PROGRAMME', id: programmeId },
    expectedRevision: read.revision,
  }];
}

function intentForEffect(
  planId: string,
  strategy: RecoveryStrategy,
  effect: ScenarioEffect,
  index: number,
  ownership: ReadonlyMap<string, string> | undefined,
  stayCancellationOwnership: ReadonlyMap<string, { journeyId: string; reservationId: string; orderKey?: string }> | undefined,
): TypedResult<ActionIntent> {
  const id = randomUUID();
  const base = {
    id,
    actionPlanId: planId,
    sourceEffectIndex: index,
    sourceEffectFingerprint: selectedEffectFingerprint(effect),
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
        ...(effect.offerPrice ? { costEstimate: effect.offerPrice } : {}),
      });
    }
    case 'ADD_JOURNEY_STAY': {
      // The new overlay item is correlation only. The owning Journey is the
      // mutable aggregate and must have been captured in the base manifest;
      // compiling without that revision would make a later booking stale-safe
      // only by invention, so refuse it here.
      const journeyRead = strategy.baseManifest.aggregateReads.find(
        (read) => read.aggregateRef.kind === 'JOURNEY' && read.aggregateRef.id === effect.journeyId,
      );
      if (!journeyRead) {
        return conflict(typedConflict(
          'STALE_AGGREGATE_REVISION',
          'ADD_JOURNEY_STAY requires the owning Journey revision in the strategy base manifest',
          [{ kind: 'JOURNEY', id: effect.journeyId }],
        ));
      }
      return ok({
        ...base,
        operationNamespace: 'provider.stay',
        logicalOperationKey: `stay-book:${effect.journeyId}:${effect.offerId}:${effect.proposedJourneyItemId}`,
        requestFingerprint: fingerprint({ effect, strategyVersion: strategy.strategyVersion }),
        capabilityRef: EXTERNAL_STAY_BOOK,
        subjectRefs: [
          { kind: 'JOURNEY', id: effect.journeyId },
          { kind: 'OFFER', id: effect.offerId },
        ],
        expectedRevisions: [{
          aggregateRef: { kind: 'JOURNEY', id: effect.journeyId },
          expectedRevision: journeyRead.revision,
        }],
        preconditions: [
          `basisAssessment:${strategy.basisAssessmentId}`,
          `strategyVersion:${strategy.strategyVersion}`,
        ],
        requiredAuthorityScopes: ['journey.stay'],
        expectedObservations: ['EXTERNAL_PROVIDER:stay_booking_confirmation'],
        offerFingerprint: effect.offerId,
        costEstimate: effect.offerPrice,
      });
    }
    case 'CANCEL_STAY': {
      const owner = stayCancellationOwnership?.get(effect.reservationLineId);
      const journeyRead = owner ? strategy.baseManifest.aggregateReads.find(
        (read) => read.aggregateRef.kind === 'JOURNEY' && read.aggregateRef.id === owner.journeyId,
      ) : undefined;
      const reservationRead = owner ? strategy.baseManifest.aggregateReads.find(
        (read) => read.aggregateRef.kind === 'RESERVATION' && read.aggregateRef.id === owner.reservationId,
      ) : undefined;
      if (!owner || !journeyRead || !reservationRead) {
        return conflict(typedConflict(
          'STALE_AGGREGATE_REVISION',
          'CANCEL_STAY requires captured owning Journey and Reservation revisions',
          [{ kind: 'RESERVATION_LINE', id: effect.reservationLineId }],
        ));
      }
      return ok({
        ...base,
        operationNamespace: 'provider.stay',
        logicalOperationKey: `stay-cancel:${owner.journeyId}:${owner.reservationId}:${effect.reservationLineId}`,
        requestFingerprint: fingerprint({ effect, strategyVersion: strategy.strategyVersion }),
        capabilityRef: EXTERNAL_STAY_CANCEL,
        subjectRefs: [
          { kind: 'JOURNEY_ITEM', id: effect.journeyItemId },
          { kind: 'RESERVATION_LINE', id: effect.reservationLineId },
          { kind: 'JOURNEY', id: owner.journeyId },
          { kind: 'RESERVATION', id: owner.reservationId },
        ],
        expectedRevisions: [
          { aggregateRef: { kind: 'JOURNEY', id: owner.journeyId }, expectedRevision: journeyRead.revision },
          { aggregateRef: { kind: 'RESERVATION', id: owner.reservationId }, expectedRevision: reservationRead.revision },
        ],
        preconditions: [
          `basisAssessment:${strategy.basisAssessmentId}`,
          `strategyVersion:${strategy.strategyVersion}`,
          `cancellationPenalty:${effect.cancellationPenalty.currency}:${effect.cancellationPenalty.amount}`,
        ],
        requiredAuthorityScopes: ['journey.stay.cancel'],
        expectedObservations: ['EXTERNAL_PROVIDER:stay_cancellation_confirmation'],
        // This cost estimate is the evidenced cancellation-policy ceiling for
        // authority review. It does not state a charge, refund, payment, or
        // supplier-observed financial outcome.
        costEstimate: effect.cancellationPenalty,
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
        expectedRevisions: programmeExpectedRevisions(strategy, effect.programmeItemId, ownership),
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
 * Sequential CHANGE_PROGRAMME_ITEM_TIME intents that share a Programme are
 * ordered by effect index so action N+1 can rebase against action N's
 * observed revision (same-aggregate multi-action plans).
 */
function defaultDependencies(
  intents: ActionIntent[],
  effects: ScenarioEffect[],
  ownership: ReadonlyMap<string, string> | undefined,
  strategy: RecoveryStrategy,
  stayCancellationOwnership: ReadonlyMap<string, { journeyId: string; reservationId: string; orderKey?: string }> | undefined,
  journeyItemOwnership: ReadonlyMap<string, { journeyId: string; orderKey: string }> | undefined,
): TypedResult<ActionDependency[]> {
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

  const programmeReads = strategy.baseManifest.aggregateReads.filter((r) => r.aggregateRef.kind === 'PROGRAMME');
  const singleProgrammeId = programmeReads.length === 1 ? programmeReads[0]!.aggregateRef.id : undefined;
  const byProgramme = new Map<string, typeof programme>();
  for (const row of programme) {
    if (row.effect.effectKind !== 'CHANGE_PROGRAMME_ITEM_TIME') continue;
    const programmeId = ownership?.get(row.effect.programmeItemId)
      ?? row.intent.expectedRevisions.find((r) => r.aggregateRef.kind === 'PROGRAMME')?.aggregateRef.id
      ?? singleProgrammeId;
    if (!programmeId) continue;
    const group = byProgramme.get(programmeId) ?? [];
    group.push(row);
    byProgramme.set(programmeId, group);
  }
  for (const group of byProgramme.values()) {
    for (let i = 0; i < group.length - 1; i += 1) {
      deps.push({
        fromActionIntentId: group[i]!.intent.id,
        toActionIntentId: group[i + 1]!.intent.id,
      });
    }
  }
  // A selected transport effect is a prerequisite for candidate stays in the
  // same Journey. Ownership comes only from the authoritative capture supplied
  // by the application adapter; a missing owner cannot be guessed.
  const stays = byEffect.filter((x) => x.effect.effectKind === 'ADD_JOURNEY_STAY');
  for (const stay of stays) {
    if (stay.effect.effectKind !== 'ADD_JOURNEY_STAY') continue;
    for (const selected of select) {
      if (selected.effect.effectKind !== 'SELECT_OFFER') continue;
      const selectedOwner = journeyItemOwnership?.get(selected.effect.journeyItemId);
      if (!selectedOwner) {
        return conflict(typedConflict('STALE_AGGREGATE_REVISION', 'SELECT_OFFER requires captured Journey ownership for selected-plan dependency ordering', [{ kind: 'JOURNEY_ITEM', id: selected.effect.journeyItemId }]));
      }
      if (selectedOwner.journeyId === stay.effect.journeyId) {
        deps.push({ fromActionIntentId: selected.intent.id, toActionIntentId: stay.intent.id });
      }
    }
  }

  // New stays within one Journey are ordered by their authoritative itinerary
  // order keys. Ambiguous keys fail closed instead of depending on proposal
  // array order.
  const staysByJourney = new Map<string, typeof stays>();
  for (const stay of stays) {
    if (stay.effect.effectKind !== 'ADD_JOURNEY_STAY') continue;
    const group = staysByJourney.get(stay.effect.journeyId) ?? [];
    group.push(stay);
    staysByJourney.set(stay.effect.journeyId, group);
  }
  for (const group of staysByJourney.values()) {
    const ordered = [...group].sort((a, b) => {
      const left = a.effect.effectKind === 'ADD_JOURNEY_STAY' ? a.effect.orderKey : '';
      const right = b.effect.effectKind === 'ADD_JOURNEY_STAY' ? b.effect.orderKey : '';
      return left.localeCompare(right);
    });
    for (let i = 1; i < ordered.length; i += 1) {
      const previous = ordered[i - 1]!;
      const next = ordered[i]!;
      if (previous.effect.effectKind !== 'ADD_JOURNEY_STAY' || next.effect.effectKind !== 'ADD_JOURNEY_STAY') continue;
      if (previous.effect.orderKey === next.effect.orderKey) {
        return conflict(typedConflict('VALIDATION_FAILED', 'multiple selected stays have the same authoritative itinerary order key'));
      }
      deps.push({ fromActionIntentId: previous.intent.id, toActionIntentId: next.intent.id });
    }
  }

  // A displacement is explicit in the candidate effect. The replacement must
  // be supplier-confirmed before the old stay can be cancelled; names, dates,
  // properties and fixture identity are never used to infer this relation.
  const cancellations = byEffect.filter((x) => x.effect.effectKind === 'CANCEL_STAY');
  for (const replacement of stays) {
    const replacementEffect = replacement.effect;
    if (!('replacesReservationLineId' in replacementEffect) || !replacementEffect.replacesReservationLineId) continue;
    const matching = cancellations.filter((candidate) => candidate.effect.effectKind === 'CANCEL_STAY'
      && candidate.effect.reservationLineId === replacementEffect.replacesReservationLineId);
    if (matching.length !== 1) {
      return conflict(typedConflict('VALIDATION_FAILED', 'replacement stay must link to exactly one selected cancellation'));
    }
    const old = stayCancellationOwnership?.get(replacementEffect.replacesReservationLineId);
    if (!old || old.journeyId !== replacementEffect.journeyId || !old.orderKey) {
      return conflict(typedConflict('STALE_AGGREGATE_REVISION', 'replacement stay requires captured displaced reservation ownership and itinerary order'));
    }
    deps.push({ fromActionIntentId: replacement.intent.id, toActionIntentId: matching[0]!.intent.id });
  }
  return ok(dedupeDependencies(deps));
}

function dedupeDependencies(dependencies: ActionDependency[]): ActionDependency[] {
  const unique = new Map<string, ActionDependency>();
  for (const dependency of dependencies) {
    unique.set(`${dependency.fromActionIntentId}:${dependency.toActionIntentId}`, dependency);
  }
  return [...unique.values()];
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
    const built = intentForEffect(planId, strategy, effect, i, input.programmeItemOwnership, input.stayCancellationOwnership);
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

  const dependencies = defaultDependencies(
    intents,
    strategy.scenarioChange.effects,
    input.programmeItemOwnership,
    strategy,
    input.stayCancellationOwnership,
    input.journeyItemOwnership,
  );
  if (!dependencies.ok) return dependencies;
  const plan = ActionPlanSchema.parse({
    id: planId,
    recoveryCaseId: strategy.recoveryCaseId,
    scenarioChangeId: strategy.scenarioChange.id,
    intents,
    dependencies: dependencies.value,
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

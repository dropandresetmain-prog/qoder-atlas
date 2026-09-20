/**
 * Selected-plan identity arithmetic only. These functions do not capture a
 * world, produce an assessment, grant authority, schedule work or call a tool.
 * PostgreSQL readers supply the persisted plan and committed application IDs.
 */
import { canonicalPayloadHash } from '../../domain/v2/shared/canonicalHash.ts';
import type { ScenarioEffect } from '../../contracts/v2/scenario/scenarioChange.ts';

export const SELECTED_PLAN_CONTINUATION_VERSION = 'selected-plan-continuation/1';
export const MAX_SELECTED_EFFECTS = 64;

export class ContinuationSafetyError extends Error {
  readonly code: string;
  constructor(code: string, detail: string) {
    super(detail);
    this.name = 'ContinuationSafetyError';
    this.code = code;
  }
}

export function requireContinuation(condition: unknown, code: string, detail: string): asserts condition {
  if (!condition) throw new ContinuationSafetyError(code, detail);
}

export interface SelectedEffectIdentity {
  actionIntentId: string;
  sourceEffectIndex: number;
  sourceEffectFingerprint: string;
}

export interface SelectedIntentIdentity {
  id: string;
  actionPlanId: string;
  capabilityRef: string;
  sourceEffectIndex: number | null;
  sourceEffectFingerprint: string | null;
}

export interface SelectedDependency {
  fromActionIntentId: string;
  toActionIntentId: string;
}

const EFFECT_CAPABILITY: Readonly<Record<ScenarioEffect['effectKind'], string>> = {
  SELECT_OFFER: 'external:offer.select',
  ADD_JOURNEY_STAY: 'external:stay.book',
  CANCEL_STAY: 'external:stay.cancel',
  PROPOSE_ALLOCATION: 'internal:reservation.allocation',
  CHANGE_PROGRAMME_ITEM_TIME: 'internal:programme.schedule',
  ALTER_JOURNEY_ITEM_INTENT: 'internal:journey.intent',
  CHANGE_SUPPORT_ASSIGNMENT: 'internal:support.assignment',
  WAIVE_OBJECTIVE: 'internal:objective.disposition',
};

/** Stable through PostgreSQL jsonb key reordering, without weakening array identity. */
export function selectedEffectFingerprint(effect: ScenarioEffect): string {
  return canonicalPayloadHash(effect);
}

/**
 * Derive the exact residual from persisted identities, never by recompiling a
 * smaller strategy or trusting a caller's residual list. One source effect has
 * exactly one intent in this bounded seam; unsupported plan shapes fail closed.
 */
export function deriveSelectedResidual(input: {
  actionPlanId: string;
  nextActionIntentId: string;
  effects: readonly ScenarioEffect[];
  intents: readonly SelectedIntentIdentity[];
  dependencies: readonly SelectedDependency[];
  appliedIntentIds: ReadonlySet<string>;
}): {
  source: SelectedEffectIdentity[];
  residual: SelectedEffectIdentity[];
  residualEffects: ScenarioEffect[];
  prerequisiteIntentIds: string[];
} {
  const { effects, intents } = input;
  requireContinuation(effects.length > 0 && effects.length <= MAX_SELECTED_EFFECTS && intents.length === effects.length,
    'SOURCE_IDENTITY_MISMATCH', 'selected continuation requires one persisted intent per source effect');
  const byId = new Map(intents.map((intent) => [intent.id, intent]));
  requireContinuation(byId.size === intents.length && byId.has(input.nextActionIntentId),
    'NEXT_INTENT_MISMATCH', 'next intent must be a unique member of the selected plan');
  const indices = new Set<number>();
  const source = intents.map((intent): SelectedEffectIdentity => {
    const index = intent.sourceEffectIndex;
    requireContinuation(intent.actionPlanId === input.actionPlanId && index !== null
      && Number.isInteger(index) && index >= 0 && index < effects.length && !indices.has(index),
    'SOURCE_IDENTITY_MISMATCH', 'source index is missing, duplicated or belongs to another plan');
    indices.add(index);
    const effect = effects[index]!;
    requireContinuation(intent.sourceEffectFingerprint === selectedEffectFingerprint(effect)
      && intent.capabilityRef === EFFECT_CAPABILITY[effect.effectKind],
    'SOURCE_KIND_OR_FINGERPRINT_MISMATCH', `persisted intent ${intent.id} no longer identifies its exact source effect`);
    return { actionIntentId: intent.id, sourceEffectIndex: index, sourceEffectFingerprint: intent.sourceEffectFingerprint };
  }).sort((a, b) => a.sourceEffectIndex - b.sourceEffectIndex);
  for (const applied of input.appliedIntentIds) {
    requireContinuation(byId.has(applied), 'APPLICATION_PLAN_MISMATCH', 'canonical application belongs to another plan');
  }
  requireContinuation(!input.appliedIntentIds.has(input.nextActionIntentId),
    'INTENT_ALREADY_APPLIED', 'a canonically applied effect cannot become a new dispatch');
  const parents = new Map<string, string[]>();
  const edgeIds = new Set<string>();
  for (const dependency of input.dependencies) {
    const key = `${dependency.fromActionIntentId}:${dependency.toActionIntentId}`;
    requireContinuation(byId.has(dependency.fromActionIntentId) && byId.has(dependency.toActionIntentId)
      && dependency.fromActionIntentId !== dependency.toActionIntentId && !edgeIds.has(key),
    'DEPENDENCY_IDENTITY_MISMATCH', 'dependency is duplicated or escapes the selected plan');
    edgeIds.add(key);
    parents.set(dependency.toActionIntentId, [...(parents.get(dependency.toActionIntentId) ?? []), dependency.fromActionIntentId]);
  }
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string): void => {
    requireContinuation(!visiting.has(id), 'DEPENDENCY_CYCLE', 'selected plan dependencies contain a cycle');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const parent of parents.get(id) ?? []) visit(parent);
    visiting.delete(id);
    visited.add(id);
  };
  // Check the whole stored plan, not only the next intent's reachable subgraph.
  for (const intent of intents) visit(intent.id);
  const prerequisites = new Set<string>();
  const collect = (id: string): void => {
    for (const parent of parents.get(id) ?? []) {
      if (prerequisites.has(parent)) continue;
      prerequisites.add(parent);
      collect(parent);
    }
  };
  collect(input.nextActionIntentId);
  for (const id of prerequisites) {
    requireContinuation(input.appliedIntentIds.has(id), 'PREREQUISITE_NOT_CANONICAL',
      `predecessor ${id} needs known success and matching committed canonical application`);
  }
  const residual = source.filter((identity) => !input.appliedIntentIds.has(identity.actionIntentId));
  return {
    source,
    residual,
    residualEffects: residual.map((identity) => effects[identity.sourceEffectIndex]!),
    prerequisiteIntentIds: [...prerequisites].sort(),
  };
}

/** Every increment must be present exactly once. Equal endpoints do not excuse a gap. */
export function requireContiguousAdvances(
  before: number,
  after: number,
  changes: readonly { before: number; after: number }[],
  subject: string,
): void {
  requireContinuation(Number.isSafeInteger(before) && Number.isSafeInteger(after) && after >= before,
    'UNEXPLAINED_STATE_CHANGE', `${subject} has a missing, regressed or unsafe revision`);
  let cursor = before;
  for (const change of [...changes].sort((a, b) => a.before - b.before)) {
    requireContinuation(change.before === cursor && change.after === cursor + 1,
      'UNEXPLAINED_STATE_CHANGE', `${subject} has an unaccounted or duplicate increment at ${cursor}`);
    cursor = change.after;
  }
  requireContinuation(cursor === after, 'UNEXPLAINED_STATE_CHANGE', `${subject} has an unaccounted increment after ${cursor}`);
}

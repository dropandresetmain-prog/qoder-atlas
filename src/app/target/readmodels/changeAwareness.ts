import {
  ChangeAwarenessSchema,
  type LdgSemanticState,
} from '../../../contracts/v2/product/readModels.ts';
import type { ChangeAwarenessInput } from './types.ts';

export function buildChangeAwareness(input: ChangeAwarenessInput) {
  const changedVisibleRefs = [...new Set(input.changedVisibleRefs)].sort();
  return ChangeAwarenessSchema.parse({
    projectionRevision: input.projectionRevision,
    changedVisibleRefs,
    ...(input.previousSemanticState ? { previousSemanticState: input.previousSemanticState } : {}),
    currentSemanticState: input.currentSemanticState,
    ...((input.changedAt ?? input.now) ? { changedAt: input.changedAt ?? input.now } : {}),
    ...(input.changeSource ? { changeSource: input.changeSource } : {}),
  });
}

export function transitionChangeAwareness(input: {
  projectionRevision: number;
  changedVisibleRefs: readonly string[];
  previousSemanticState: LdgSemanticState;
  currentSemanticState: LdgSemanticState;
  changedAt?: string;
  changeSource?: string;
}) {
  return buildChangeAwareness(input);
}

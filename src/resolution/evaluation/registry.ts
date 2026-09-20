/**
 * NORTHSTAR M6 — the evaluator registry: the one set of evaluator families
 * every scenario (family, corporate, programme, …) is assessed with.
 *
 * Adding an information category or check means adding an evaluator here
 * against the frozen contract (docs/refactor/evidence/M6_EVALUATOR_CONTRACT.md);
 * `createEvaluatorRegistry` rejects duplicate ids and dimension collisions, and
 * the union of declared information topics is what a WorldSnapshot records
 * generations for. No scenario selects a subset.
 */
import { createEvaluatorRegistry, type EvaluatorRegistry } from './assess.ts';
import type { Evaluator } from './evaluator.ts';
import { bookingEvaluator } from './evaluators/booking.ts';
import { connectionEvaluator } from './evaluators/connection.ts';
import { credentialsEvaluator } from './evaluators/credentials.ts';
import { entryEvaluator } from './evaluators/entry.ts';
import { fundingEvaluator } from './evaluators/funding.ts';
import { groupEvaluator } from './evaluators/group.ts';
import { informationEvaluator } from './evaluators/information.ts';
import { objectiveEvaluator } from './evaluators/objective.ts';
import { overnightEvaluator } from './evaluators/overnight.ts';
import { participationEvaluator } from './evaluators/participation.ts';
import { supportEvaluator } from './evaluators/support.ts';
import { stayArrivalDateAlignedEvaluator } from './evaluators/stayArrivalDateAligned.ts';

export const M6_EVALUATORS: readonly Evaluator[] = [
  bookingEvaluator,
  connectionEvaluator,
  overnightEvaluator,
  stayArrivalDateAlignedEvaluator,
  objectiveEvaluator,
  participationEvaluator,
  supportEvaluator,
  groupEvaluator,
  fundingEvaluator,
  credentialsEvaluator,
  entryEvaluator,
  informationEvaluator,
];

export function createM6Registry(): EvaluatorRegistry {
  return createEvaluatorRegistry(M6_EVALUATORS);
}

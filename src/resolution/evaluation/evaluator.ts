/**
 * NORTHSTAR M6 — evaluator contract and registry.
 *
 * An evaluator is a pure deterministic function of (captured world, effective
 * projection, subject, injected clock). It performs no I/O and reads no
 * repository. It reports PASS/FAIL/UNKNOWN per dimension with typed
 * explanations, the evidence it relied on, what coverage it lacked, and the
 * next instant at which time alone could change its answer.
 *
 * Rules every evaluator must honour:
 *  - absence of a fact is never PASS (UNKNOWN + uncertainty instead);
 *  - a dimension that does not apply returns `applicable: false`, not PASS;
 *  - only mandatory (blocking) dimensions feed the overall verdict — an
 *    authorised objective loss makes that objective non-blocking but never
 *    relaxes an entry/support/overnight/constraint dimension;
 *  - no scenario, fixture, traveller, place or supplier special case.
 */
import type { TypedRef } from '../../domain/v2/shared/identity.ts';
import type { Instant } from '../../domain/v2/shared/time.ts';
import type { AssessmentKind, AssessmentVerdict } from '../../contracts/v2/assessment/assessmentManifest.ts';
import type { MissingCoverage } from '../../contracts/v2/scope/readScope.ts';
import type { CausalExplanation, EvidenceRef } from '../../contracts/v2/assessment/explanation.ts';
import type { CapturedWorld } from '../world/world.ts';
import type { EffectiveWorld } from '../world/effectiveTypes.ts';

export interface EvaluationContext {
  /** Injected clock: the instant the assessment is evaluated at. */
  now: Instant;
  world: CapturedWorld;
  effective: EffectiveWorld;
}

export interface DimensionResult {
  dimension: string;
  verdict: AssessmentVerdict;
  /** false when the dimension does not apply to this subject (excluded from composition, never counted as PASS). */
  applicable: boolean;
  /** true when a FAIL/UNKNOWN here must block the overall verdict. */
  blocking: boolean;
  explanations: CausalExplanation[];
}

export interface EvaluatorOutput {
  dimensions: DimensionResult[];
  evidence: EvidenceRef[];
  missingCoverage: MissingCoverage[];
  /** Earliest instant at which time alone may change any dimension here. */
  nextInvalidationAt?: Instant;
}

export interface Evaluator {
  id: string;
  version: string;
  assessmentKind: AssessmentKind;
  /** Subject kinds this evaluator assesses (normally JOURNEY). */
  subjectKinds: readonly TypedRef['kind'][];
  /** Dimensions this evaluator may emit — declared so the registry can detect collisions. */
  dimensions: readonly string[];
  /** Information topics whose generations the snapshot must record for this evaluator. */
  informationTopics: readonly string[];
  evaluate(subject: TypedRef, context: EvaluationContext): EvaluatorOutput;
}

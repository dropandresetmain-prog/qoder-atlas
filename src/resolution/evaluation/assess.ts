/**
 * NORTHSTAR M6 — evaluator registry and cross-evaluator composition (pure).
 *
 * Owned by the M6 primary: evaluators are independent pure functions; this
 * module decides how their outputs become ONE immutable AssessmentResult:
 *
 *  - every applicable dimension is kept (never averaged across people or dims);
 *  - the overall verdict uses only applicable AND blocking dimensions, with the
 *    C0 rule FAIL > UNKNOWN > PASS and "nothing evaluated" = UNKNOWN;
 *  - the manifest is the capture manifest plus evaluator versions, evaluator
 *    evidence, evaluator-reported missing coverage and the earliest
 *    time-only invalidation;
 *  - the blast radius is explicit: when the subject was reached from a changed
 *    subject through registered semantics, an `impact` dimension carries the
 *    typed causal path, and evaluator explanations that mention a subject on
 *    that path receive the same path.
 */
import type { TypedRef } from '../../domain/v2/shared/identity.ts';
import type { Instant } from '../../domain/v2/shared/time.ts';
import { compareInstants } from '../../domain/v2/shared/time.ts';
import {
  overallVerdictFromDimensions,
  type AssessmentDimension,
  type AssessmentKind,
  type AssessmentResult,
} from '../../contracts/v2/assessment/assessmentManifest.ts';
import type { CausalExplanation, DependencyEdge } from '../../contracts/v2/assessment/explanation.ts';
import type { MissingCoverage } from '../../contracts/v2/scope/readScope.ts';
import { computeClosure, refKey } from '../impact/closure.ts';
import type { CapturedWorld } from '../world/world.ts';
import type { EffectiveWorld } from '../world/effectiveTypes.ts';
import type { DimensionResult, Evaluator, EvaluatorOutput } from './evaluator.ts';
import { dimension, explain } from './explain.ts';

export const COMPOSER_ID = 'm6.compose';
export const COMPOSER_VERSION = '1';

export interface EvaluatorRegistry {
  readonly evaluators: readonly Evaluator[];
  /** Union of topics the snapshot must record generations for. */
  readonly informationTopics: readonly string[];
}

export function createEvaluatorRegistry(evaluators: readonly Evaluator[]): EvaluatorRegistry {
  const ids = new Set<string>();
  const dimensionOwner = new Map<string, string>();
  for (const evaluator of evaluators) {
    if (ids.has(evaluator.id)) throw new Error(`duplicate evaluator id ${evaluator.id}`);
    ids.add(evaluator.id);
    for (const name of evaluator.dimensions) {
      const owner = dimensionOwner.get(name);
      if (owner) throw new Error(`dimension ${name} is declared by both ${owner} and ${evaluator.id}`);
      dimensionOwner.set(name, evaluator.id);
    }
  }
  const informationTopics = [...new Set(evaluators.flatMap((e) => e.informationTopics))].sort();
  return { evaluators: [...evaluators].sort((a, b) => a.id.localeCompare(b.id)), informationTopics };
}

export interface AssessInput {
  registry: EvaluatorRegistry;
  world: CapturedWorld;
  effective: EffectiveWorld;
  subject: TypedRef;
  now: Instant;
  /** Caller-minted UUID (so replay and persistence use the same identity). */
  assessmentId: string;
  kind?: AssessmentKind;
}

export interface AssessOutput {
  result: AssessmentResult;
  /** Registered causal path from a changed subject to the assessed subject, if it was reached through one. */
  impactPath: DependencyEdge[];
}

function pathOnto(explanation: CausalExplanation, path: DependencyEdge[]): CausalExplanation {
  if (path.length === 0 || explanation.dependencyPath.length > 0) return explanation;
  const onPath = new Set(path.flatMap((e) => [refKey(e.from), refKey(e.to)]));
  const touches = explanation.relatedSubjects.some((s) => onPath.has(refKey(s)));
  if (!touches) return explanation;
  const { id: _id, ...rest } = explanation;
  return explain({ ...rest, dependencyPath: path });
}

export function assessSubject(input: AssessInput): AssessOutput {
  const { registry, world, effective, subject, now } = input;
  const applicable = registry.evaluators.filter((e) => e.subjectKinds.includes(subject.kind));

  const outputs: { evaluator: Evaluator; output: EvaluatorOutput }[] = applicable.map((evaluator) => {
    const output = evaluator.evaluate(subject, { now, world, effective });
    for (const dim of output.dimensions) {
      if (!evaluator.dimensions.includes(dim.dimension)) {
        throw new Error(`evaluator ${evaluator.id} emitted undeclared dimension ${dim.dimension}`);
      }
    }
    return { evaluator, output };
  });

  // Blast radius: the registered path from any focus subject (other than the subject itself) to this subject.
  const causes = world.focus.filter((f) => refKey(f) !== refKey(subject));
  const closure = computeClosure({ causes, edges: world.edges });
  const reached = closure.reached.find((r) => refKey(r.subject) === refKey(subject));
  const impactPath = reached?.path ?? [];

  const dimensions: DimensionResult[] = outputs.flatMap(({ output }) =>
    output.dimensions.map((dim) => ({ ...dim, explanations: dim.explanations.map((e) => pathOnto(e, impactPath)) })),
  );
  if (reached && impactPath.length > 0) {
    dimensions.push(
      dimension({
        dimension: 'impact',
        blocking: false,
        explanations: [
          explain({
            evaluatorId: COMPOSER_ID,
            dimension: 'impact',
            status: 'PASS',
            reasonCode: 'reached_through_registered_dependency',
            cause: { kind: 'CHANGED_SUBJECT', subjectRef: reached.cause },
            affectedSubject: subject,
            dependencyPath: impactPath,
            relatedSubjects: impactPath.flatMap((e) => [e.from, e.to]),
            facts: { depth: reached.depth },
          }),
        ],
      }),
    );
  }
  dimensions.sort((a, b) => a.dimension.localeCompare(b.dimension));

  const blocking = dimensions.filter((d) => d.applicable && d.blocking);
  const toContract = (d: DimensionResult): AssessmentDimension => ({
    dimension: d.dimension,
    verdict: d.verdict,
    reasons: [...new Set(d.explanations.map((e) => `${e.status}:${e.reasonCode}`))].sort(),
    explanations: d.explanations,
    applicable: d.applicable,
    blocking: d.blocking,
  });
  const overallVerdict = overallVerdictFromDimensions(blocking.map(toContract));

  const missing = new Map<string, MissingCoverage>();
  for (const m of [...world.manifest.missingCoverage, ...outputs.flatMap(({ output }) => output.missingCoverage)]) {
    missing.set(`${m.subjectRef ? refKey(m.subjectRef) : ''}|${m.scopeDescription}|${m.reason}`, m);
  }
  const nextTimes = outputs.map(({ output }) => output.nextInvalidationAt).filter((t): t is Instant => t !== undefined);
  if (world.manifest.nextInvalidationAt) nextTimes.push(world.manifest.nextInvalidationAt);
  const nextInvalidationAt = nextTimes.sort((a, b) => compareInstants(a, b))[0];

  const result: AssessmentResult = {
    id: input.assessmentId,
    kind: input.kind ?? 'VIABILITY',
    evaluatedAt: now,
    manifest: {
      ...world.manifest,
      evaluatedAt: now,
      evaluatorVersions: [
        { evaluatorId: COMPOSER_ID, version: COMPOSER_VERSION },
        ...outputs.map(({ evaluator }) => ({ evaluatorId: evaluator.id, version: evaluator.version })),
      ].sort((a, b) => a.evaluatorId.localeCompare(b.evaluatorId)),
      evidenceReads: [...new Set([...world.manifest.evidenceReads, ...outputs.flatMap(({ output }) => output.evidence.map((e) => e.id))])].sort(),
      missingCoverage: [...missing.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, m]) => m),
      ...(nextInvalidationAt ? { nextInvalidationAt } : {}),
    },
    subjects: [{ subjectRef: subject, role: 'ASSESSED' }],
    overallVerdict,
    dimensions: dimensions.map(toContract),
    ...(nextInvalidationAt ? { expiresAt: nextInvalidationAt } : {}),
  };
  return { result, impactPath };
}

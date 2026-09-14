/**
 * NORTHSTAR M6 — shared helpers every evaluator uses to build results.
 *
 * Deterministic explanation ids (a stable hash of the explanation content),
 * canonical ordering, dimension construction and exact minute arithmetic.
 * Pure: no I/O, no clock reads (the clock is always passed in).
 */
import { createHash } from 'node:crypto';
import type { TypedRef } from '../../domain/v2/shared/identity.ts';
import type { Instant } from '../../domain/v2/shared/time.ts';
import type { AssessmentVerdict } from '../../contracts/v2/assessment/assessmentManifest.ts';
import type { CausalExplanation, DependencyEdge, EvidenceRef, Uncertainty } from '../../contracts/v2/assessment/explanation.ts';
import type { DimensionResult } from './evaluator.ts';

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, stable((value as Record<string, unknown>)[key])]));
  }
  return value;
}

export function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex').slice(0, 32);
}

export interface ExplanationInput {
  evaluatorId: string;
  dimension: string;
  status: AssessmentVerdict;
  reasonCode: string;
  cause: CausalExplanation['cause'];
  affectedSubject: TypedRef;
  dependencyPath?: DependencyEdge[];
  relatedSubjects?: TypedRef[];
  evidenceRefs?: EvidenceRef[];
  facts?: Record<string, string | number | boolean | null>;
  uncertainty?: Uncertainty[];
  validUntil?: Instant;
}

const refOrder = (a: TypedRef, b: TypedRef) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`);

export function explain(input: ExplanationInput): CausalExplanation {
  const body = {
    evaluatorId: input.evaluatorId,
    dimension: input.dimension,
    status: input.status,
    reasonCode: input.reasonCode,
    cause: input.cause,
    affectedSubject: input.affectedSubject,
    dependencyPath: input.dependencyPath ?? [],
    relatedSubjects: [...new Map((input.relatedSubjects ?? []).map((r) => [`${r.kind}:${r.id}`, r])).values()].sort(refOrder),
    evidenceRefs: [...new Map((input.evidenceRefs ?? []).map((e) => [`${e.kind}:${e.id}:${e.detail ?? ''}`, e])).values()].sort((a, b) =>
      `${a.kind}:${a.id}:${a.detail ?? ''}`.localeCompare(`${b.kind}:${b.id}:${b.detail ?? ''}`)),
    facts: input.facts ?? {},
    uncertainty: [...(input.uncertainty ?? [])].sort((a, b) => `${a.kind}:${a.code}:${a.subjectRef?.id ?? ''}`.localeCompare(`${b.kind}:${b.code}:${b.subjectRef?.id ?? ''}`)),
    ...(input.validUntil ? { validUntil: input.validUntil } : {}),
  };
  return { id: stableHash(body), ...body };
}

/**
 * Verdict of a set of explanations: any FAIL -> FAIL, else any UNKNOWN ->
 * UNKNOWN, else PASS only when at least one PASS explanation exists. An empty
 * set is UNKNOWN — nothing evaluated is never PASS.
 */
export function verdictOf(explanations: CausalExplanation[]): AssessmentVerdict {
  if (explanations.some((e) => e.status === 'FAIL')) return 'FAIL';
  if (explanations.some((e) => e.status === 'UNKNOWN')) return 'UNKNOWN';
  return explanations.length > 0 ? 'PASS' : 'UNKNOWN';
}

export function dimension(params: { dimension: string; explanations: CausalExplanation[]; blocking?: boolean }): DimensionResult {
  const explanations = [...params.explanations].sort((a, b) => a.id.localeCompare(b.id));
  return { dimension: params.dimension, verdict: verdictOf(explanations), applicable: true, blocking: params.blocking ?? true, explanations };
}

/** A dimension that does not apply to this subject: never PASS, never blocking. */
export function notApplicable(dimensionName: string, explanation?: CausalExplanation): DimensionResult {
  return { dimension: dimensionName, verdict: 'UNKNOWN', applicable: false, blocking: false, explanations: explanation ? [explanation] : [] };
}

export function minutesBetween(from: Instant, to: Instant): number {
  return Math.floor((Date.parse(to) - Date.parse(from)) / 60_000);
}

export function addMinutes(instant: Instant, minutes: number): Instant {
  return new Date(Date.parse(instant) + minutes * 60_000).toISOString();
}

/** Earliest of the given instants strictly after `now`, if any. */
export function earliestAfter(now: Instant, instants: (Instant | null | undefined)[]): Instant | undefined {
  const nowMs = Date.parse(now);
  const future = instants.filter((i): i is Instant => typeof i === 'string' && Date.parse(i) > nowMs).sort((a, b) => Date.parse(a) - Date.parse(b));
  return future[0] ? new Date(Date.parse(future[0])).toISOString() : undefined;
}

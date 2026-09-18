/**
 * NORTHSTAR v2 — Three distinct impact semantics (R1 / freeze C7).
 *
 * These three names are FROZEN and MUST stay separate in backend/read models.
 * The browser never derives or collapses them.
 *
 *   A. `immediateChangeBlastRadius` — what the proposed strategy DIRECTLY
 *      changes or affects. Source: validated ScenarioChange effects +
 *      affectedSubjectRefs + a deterministic direct-impact projection. NOT the
 *      RC-6 dependency closure.
 *
 *   B. `reassessmentClosure` — the BROADER state NORTHSTAR actually reevaluated
 *      to prove the candidate safe. Source: the M6/RC-6 dependency/applicability
 *      closure actually assessed. May be much broader than A.
 *
 *   C. `outcomeDelta` — who becomes BETTER / WORSE / UNCHANGED under the
 *      candidate relative to the captured baseline. Source: the RC-6
 *      baseline/candidate subject pairs (`StrategySubjectVerdict`) captured at
 *      decision time. Retained because recomputing later against newer
 *      canonical state would falsify what was known when the decision was made.
 *
 * Every projection here is a PURE function of data already produced by
 * `evaluateRecoveryStrategy` (RC-6): `affectedSubjectRefs`, the candidate
 * assessment summaries, and `StrategySubjectVerdict[]`. No scenario branches,
 * no provider data, no names.
 */
import { z } from 'zod';
import { TypedRefSchema, type TypedRef } from '../../../domain/v2/shared/identity.ts';
import {
  AssessmentVerdictSchema,
  type AssessmentVerdict,
} from '../assessment/assessmentManifest.ts';

/**
 * A. Immediate proposed-change blast radius: typed identifiers grouped as
 * objects actually CHANGED by the effects versus subjects DIRECTLY AFFECTED by
 * those changes. Carries refs, not only a count.
 */
export const ImmediateChangeBlastRadiusSchema = z.strictObject({
  /** Objects the validated ScenarioChange effects directly modify. */
  changedRefs: z.array(TypedRefSchema).default([]),
  /** Subjects directly affected by those changes (dependants, participants). */
  directlyAffectedRefs: z.array(TypedRefSchema).default([]),
});
export type ImmediateChangeBlastRadius = z.infer<typeof ImmediateChangeBlastRadiusSchema>;

/**
 * B. Reassessment closure: the set of subjects RC-6 actually reevaluated. This
 * is the dependency/applicability closure, which may be much broader than the
 * immediate blast radius. Represented as the reached subject refs.
 */
export const ReassessmentClosureSchema = z.strictObject({
  reachedRefs: z.array(TypedRefSchema).default([]),
});
export type ReassessmentClosure = z.infer<typeof ReassessmentClosureSchema>;

/** Conservative better/worse/unchanged classification of one subject. */
export const OutcomeDeltaDirectionSchema = z.enum(['BETTER', 'WORSE', 'UNCHANGED']);
export type OutcomeDeltaDirection = z.infer<typeof OutcomeDeltaDirectionSchema>;

/**
 * C. One subject's decision-time baseline -> candidate verdict and its
 * conservative classification. Baseline/candidate values are preserved so an
 * unresolved movement such as FAIL -> UNKNOWN is never mislabelled as recovery.
 */
export const OutcomeDeltaEntrySchema = z.strictObject({
  subjectRef: TypedRefSchema,
  baseline: AssessmentVerdictSchema.optional(),
  candidate: AssessmentVerdictSchema,
  delta: OutcomeDeltaDirectionSchema,
});
export type OutcomeDeltaEntry = z.infer<typeof OutcomeDeltaEntrySchema>;

/**
 * Conservative deterministic classification (freeze §10.C):
 *   FAIL -> PASS, UNKNOWN -> PASS               = BETTER
 *   PASS -> UNKNOWN, PASS -> FAIL, UNKNOWN->FAIL = WORSE
 *   everything else                              = UNCHANGED
 * A missing baseline (subject newly reached, nothing to compare) is UNCHANGED
 * unless the candidate itself is a non-PASS introduced state, which RC-6
 * already handles separately via viability decisions — delta never invents a
 * healing claim from an absent baseline.
 */
export function classifyOutcomeDelta(
  baseline: AssessmentVerdict | undefined,
  candidate: AssessmentVerdict,
): OutcomeDeltaDirection {
  if (baseline === undefined) return 'UNCHANGED';
  if (baseline === candidate) return 'UNCHANGED';
  const better =
    (baseline === 'FAIL' && candidate === 'PASS') ||
    (baseline === 'UNKNOWN' && candidate === 'PASS');
  if (better) return 'BETTER';
  const worse =
    (baseline === 'PASS' && candidate === 'UNKNOWN') ||
    (baseline === 'PASS' && candidate === 'FAIL') ||
    (baseline === 'UNKNOWN' && candidate === 'FAIL');
  if (worse) return 'WORSE';
  // e.g. FAIL -> UNKNOWN, UNKNOWN -> FAIL are preserved but not "recovery".
  return 'UNCHANGED';
}

/** A minimal subject verdict pair, structurally compatible with RC-6's `StrategySubjectVerdict`. */
export interface SubjectVerdictPair {
  subjectRef: { kind: string; id: string };
  baseline?: AssessmentVerdict;
  candidate: AssessmentVerdict;
}

/**
 * Build the outcome-delta list from RC-6 subject verdict pairs, deterministically
 * ordered by `kind:id` so persistence/reload is stable.
 */
export function buildOutcomeDelta(
  verdicts: readonly SubjectVerdictPair[],
): OutcomeDeltaEntry[] {
  return verdicts
    .map((v) => ({
      subjectRef: { kind: v.subjectRef.kind, id: v.subjectRef.id } as TypedRef,
      ...(v.baseline !== undefined ? { baseline: v.baseline } : {}),
      candidate: v.candidate,
      delta: classifyOutcomeDelta(v.baseline, v.candidate),
    }))
    .sort((a, b) =>
      `${a.subjectRef.kind}:${a.subjectRef.id}`.localeCompare(`${b.subjectRef.kind}:${b.subjectRef.id}`),
    );
}

/**
 * Build the immediate-change blast radius from a validated ScenarioChange's
 * effects plus its affectedSubjectRefs, using a deterministic direct-impact
 * projection. `changedRefs` are the objects the effects directly name;
 * `directlyAffectedRefs` are the remaining affected subjects (dependants,
 * participants) that are not themselves modified.
 *
 * This is deliberately NOT the RC-6 closure: it names only what the proposal
 * itself touches.
 */
export function buildImmediateChangeBlastRadius(input: {
  effects: readonly ScenarioEffectTarget[];
  affectedSubjectRefs: readonly TypedRef[];
}): ImmediateChangeBlastRadius {
  const changed = new Map<string, TypedRef>();
  for (const target of input.effects) {
    for (const ref of target.changedRefs) {
      changed.set(`${ref.kind}:${ref.id}`, ref);
    }
  }
  const directlyAffected = input.affectedSubjectRefs.filter(
    (ref) => !changed.has(`${ref.kind}:${ref.id}`),
  );
  return {
    changedRefs: [...changed.values()].sort(byRefKey),
    directlyAffectedRefs: [...dedupeRefs(directlyAffected)].sort(byRefKey),
  };
}

/**
 * The object(s) each validated effect directly modifies. Derived by the
 * scenario layer from the closed ScenarioEffect union; kept as a narrow input
 * here so this projection stays pure and free of the effect-kind switch.
 */
export interface ScenarioEffectTarget {
  changedRefs: readonly TypedRef[];
}

function dedupeRefs(refs: readonly TypedRef[]): TypedRef[] {
  const seen = new Set<string>();
  const out: TypedRef[] = [];
  for (const ref of refs) {
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

function byRefKey(a: TypedRef, b: TypedRef): number {
  return `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`);
}

export type { TypedRef, AssessmentVerdict };

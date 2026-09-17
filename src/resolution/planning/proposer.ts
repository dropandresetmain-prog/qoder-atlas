/**
 * StrategyProposer port (B1).
 *
 * A proposer turns a failing subject's current, typed situation into
 * candidate `ScenarioChange` effects. It is the ONLY place candidate content
 * comes from, and it is deliberately narrow:
 *
 *  - input is canonical captured state (`CapturedWorld`/`EffectiveWorld`)
 *    plus the failing subjects' CURRENT assessments — never names, fixtures
 *    or provider identities;
 *  - output is data (`ProposalCandidate[]`), re-validated by
 *    `validateProposalCandidates` against the closed `ScenarioEffectSchema`
 *    before anything downstream sees it. A proposer cannot assert viability,
 *    authority, execution or observed truth: viability comes from the M6
 *    overlay evaluation of each candidate, authority from M8, execution from
 *    the durable executors. An LLM-backed proposer is just another
 *    implementation of this port and gets exactly the same treatment.
 *
 * Deterministic proposers ship first; see `proposers/`.
 */
import { z } from 'zod';
import type { AssessmentResult } from '../../contracts/v2/assessment/assessmentManifest.ts';
import { ScenarioEffectSchema, type ScenarioEffect } from '../../contracts/v2/scenario/scenarioChange.ts';
import { StrategyAssumptionSchema, type StrategyAssumption } from '../../contracts/v2/scenario/recoveryStrategy.ts';
import { TypedRefSchema, type TypedRef } from '../../domain/v2/shared/identity.ts';
import type { Instant } from '../../domain/v2/shared/time.ts';
import type { CapturedWorld } from '../world/world.ts';
import type { EffectiveWorld } from '../world/effectiveTypes.ts';

export interface FailingSubject {
  subject: TypedRef;
  /** The subject's CURRENT assessment (overall FAIL with blocking failures). */
  assessment: AssessmentResult;
}

export interface ProposerInput {
  workspaceId: string;
  recoveryCaseId: string;
  now: Instant;
  failing: readonly FailingSubject[];
  /** Planning world: the failing subjects' closure plus the programmes their obligations belong to. */
  world: CapturedWorld;
  effective: EffectiveWorld;
}

export const ProposalCandidateSchema = z.strictObject({
  /** Deterministic per (proposer, content); lets a rerun recognise the same candidate. */
  key: z.string().min(1).max(256),
  effects: z.array(ScenarioEffectSchema).min(1).max(32),
  affectedSubjectRefs: z.array(TypedRefSchema).min(1).max(64),
  rationale: z.string().min(1).max(2048),
  assumptions: z.array(StrategyAssumptionSchema).max(16).default([]),
});
export type ProposalCandidate = z.infer<typeof ProposalCandidateSchema>;

export interface StrategyProposer {
  readonly id: string;
  readonly version: string;
  propose(input: ProposerInput): Promise<ProposalCandidate[]>;
}

export const MAX_CANDIDATES_PER_PROPOSER = 16;

/**
 * Schema-validates raw proposer output. Anything that is not a well-formed,
 * bounded candidate is dropped with a reason — never repaired, never
 * trusted. Duplicate keys collapse to the first occurrence.
 */
export function validateProposalCandidates(
  raw: readonly unknown[],
): { accepted: ProposalCandidate[]; rejected: { index: number; reason: string }[] } {
  const accepted: ProposalCandidate[] = [];
  const rejected: { index: number; reason: string }[] = [];
  const seen = new Set<string>();
  raw.forEach((item, index) => {
    if (accepted.length >= MAX_CANDIDATES_PER_PROPOSER) {
      rejected.push({ index, reason: `candidate limit ${MAX_CANDIDATES_PER_PROPOSER} reached` });
      return;
    }
    const parsed = ProposalCandidateSchema.safeParse(item);
    if (!parsed.success) {
      rejected.push({ index, reason: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
      return;
    }
    if (seen.has(parsed.data.key)) {
      rejected.push({ index, reason: `duplicate candidate key ${parsed.data.key}` });
      return;
    }
    seen.add(parsed.data.key);
    accepted.push(parsed.data);
  });
  return { accepted, rejected };
}

/** Helper for proposers: the PROGRAMME_ITEM subjects a failing assessment names as the unmet requirement. */
export function unmetProgrammeItems(assessment: AssessmentResult): TypedRef[] {
  const out = new Map<string, TypedRef>();
  for (const dim of assessment.dimensions) {
    if (!dim.applicable || !dim.blocking || dim.verdict !== 'FAIL') continue;
    for (const explanation of dim.explanations) {
      if (explanation.status !== 'FAIL') continue;
      const cause = explanation.cause.subjectRef;
      if (cause?.kind === 'PROGRAMME_ITEM') out.set(cause.id, cause);
      for (const related of explanation.relatedSubjects) {
        if (related.kind === 'PROGRAMME_ITEM' && cause?.kind !== 'PROGRAMME_ITEM') out.set(related.id, related);
      }
    }
  }
  return [...out.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export type { ScenarioEffect, StrategyAssumption };

/**
 * NORTHSTAR v2 — StrategyProposer evidence/domain input adaptation (R1 / freeze C4).
 *
 * The current `StrategyProposer` port (src/resolution/planning/proposer.ts)
 * SURVIVES unchanged and remains proposal-only. This module defines the
 * ADDITIVE context the R1 coordinator supplies so a proposer can serve a
 * specific recovery domain using normalized read-only evidence — without any
 * proposer gaining the ability to assert viability, authority or execution.
 *
 * Minimum adaptation (freeze §7):
 *   - proposer registration declares the recovery domain(s) it can serve;
 *   - proposer input gains ONLY the relevant normalized planning evidence and
 *     explicit/inferred preference context needed to propose;
 *   - candidate provenance records proposer id, domain and evidence refs in the
 *     planning attempt;
 *   - the current `ProposalCandidate` validation and closed `ScenarioEffect`
 *     vocabulary remain the safety boundary.
 *
 * This is a contract module: it declares shapes and a registration wrapper. The
 * concrete transport/travel proposer implementation lives in the planner lane.
 */
import { z } from 'zod';
import { EntityIdSchema } from '../../../domain/common.ts';
import { RecoveryDomainIdSchema, type RecoveryDomainId } from './recoveryDomain.ts';
import type { PlanningToolResult } from './planningTool.ts';
import type { ComparatorPreference } from './strategyRecommendation.ts';
import type { ProposalCandidate, StrategyProposer, ProposerInput } from '../../../resolution/planning/proposer.ts';

/**
 * A proposer's declared domain coverage plus the evidence/preference context it
 * needs. Registration is data; the coordinator uses it to route the right
 * evidence to the right proposer without any scenario branch.
 */
export const ProposerRegistrationSchema = z.strictObject({
  proposerId: z.string().min(1),
  version: z.string().min(1),
  /** Recovery domains this proposer can serve. At least one. */
  domains: z.array(RecoveryDomainIdSchema).min(1),
});
export type ProposerRegistration = z.infer<typeof ProposerRegistrationSchema>;

/**
 * The normalized, provider-neutral evidence handed to a proposer for one
 * domain. Only SUCCEEDED/PARTIAL results with `normalizedEvidence` are useful;
 * FAILED/UNAVAILABLE results are still passed so a proposer can emit an honest
 * `NEEDS_EVIDENCE` assumption rather than fabricate.
 */
export interface PlanningEvidenceContext {
  /** The domain this evidence batch was gathered for. */
  readonly domainId: RecoveryDomainId;
  /** Normalized read-only tool results relevant to the domain. */
  readonly toolResults: readonly PlanningToolResult[];
  /** Evidence refs (into the planning attempt) the proposer should cite. */
  readonly evidenceRefs: readonly string[];
}

/**
 * Additive proposer input: the existing `ProposerInput` plus the domain and
 * evidence/preference context. Keeping this as an intersection means the
 * current port and the programme-time-swap proposer stay valid untouched.
 */
export interface DomainProposerInput extends ProposerInput {
  /** The single recovery domain this invocation is proposing for. */
  domain: RecoveryDomainId;
  /** Normalized evidence gathered for that domain (may be empty). */
  evidence: PlanningEvidenceContext;
  /**
   * Preference/policy context for proposal shaping only. Explicit outranks
   * inferred; a proposer may use these to ORDER or FILTER its own candidates
   * but can never use them to assert viability.
   */
  preferences: readonly ComparatorPreference[];
}

/**
 * A domain-aware proposer. It is still a `StrategyProposer`: proposal-only,
 * schema-bound, and it cannot assert viability/authority/execution. The
 * coordinator adapts a `DomainStrategyProposer` to the base port by binding the
 * domain/evidence context per invocation.
 */
export interface DomainStrategyProposer {
  readonly id: string;
  readonly version: string;
  /** Recovery domains this proposer declares it can serve. */
  readonly domains: readonly RecoveryDomainId[];
  propose(input: DomainProposerInput): Promise<ProposalCandidate[]>;
}

/**
 * Build the registration record for a domain proposer. Pure data; used by the
 * coordinator to route evidence and by the planning attempt to record
 * provenance.
 */
export function registrationFor(proposer: DomainStrategyProposer): ProposerRegistration {
  return ProposerRegistrationSchema.parse({
    proposerId: proposer.id,
    version: proposer.version,
    domains: [...proposer.domains],
  });
}

/**
 * Adapt a `DomainStrategyProposer` to the base `StrategyProposer` port for one
 * fixed domain + evidence context. The returned proposer ignores the base
 * input's absent domain fields and delegates to the domain proposer with the
 * bound context. This is how the existing sequential proposer loop in
 * `recoveryPlanning.ts` can drive domain proposers unchanged.
 */
export function bindDomainProposer(
  proposer: DomainStrategyProposer,
  domain: RecoveryDomainId,
  context: { evidence: PlanningEvidenceContext; preferences: readonly ComparatorPreference[] },
): StrategyProposer {
  return {
    id: proposer.id,
    version: proposer.version,
    async propose(input: ProposerInput): Promise<ProposalCandidate[]> {
      return proposer.propose({ ...input, domain, evidence: context.evidence, preferences: context.preferences });
    },
  };
}

/**
 * Provenance recorded for a candidate inside the planning attempt: which
 * proposer, which domain, and which evidence refs informed it. Bounded and
 * factual — no chain-of-thought.
 */
export const CandidateProvenanceSchema = z.strictObject({
  proposerId: z.string().min(1),
  domainId: RecoveryDomainIdSchema,
  evidenceRefs: z.array(EntityIdSchema).default([]),
});
export type CandidateProvenance = z.infer<typeof CandidateProvenanceSchema>;

export type { RecoveryDomainId };

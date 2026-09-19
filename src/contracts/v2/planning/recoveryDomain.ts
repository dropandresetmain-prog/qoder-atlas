/**
 * NORTHSTAR v2 — Recovery-domain registry (R1 / freeze C3).
 *
 * A recovery domain names a class of generalized recovery work the coordinator
 * may investigate for a failing case. The initial set is frozen by
 * `docs/RECOVERY_PLANNING_CONTRACT_FREEZE.md` §6; it is a registry boundary,
 * not a permanent exhaustive enum for all future domains.
 *
 * Selection is HYBRID and MUST stay free of scenario branches:
 *   1. deterministic activators identify domains made obviously relevant by
 *      current failing dimensions, affected object kinds, ownership and
 *      available capabilities;
 *   2. an optional AI seam may propose additional domains from semantic context;
 *   3. the deterministic registry validates applicability, capability
 *      availability and required-input coverage;
 *   4. unsupported/inapplicable domains fail closed and remain explainable
 *      evidence where material;
 *   5. the coordinator invokes every applicable domain without hardcoded order.
 *
 * There is deliberately no `if persona -> transport + programme` rule and no
 * global `flight first -> programme second` pipeline. Ordering is an
 * implementation scheduling concern, never a contract.
 */
import { z } from 'zod';
import type { CapabilityFamily } from '../../../operational/strategy.ts';

/**
 * Frozen initial recovery-domain identifiers (freeze §6). `INFORMATION_RESEARCH`
 * may be evidence-only and need not produce an executable strategy.
 */
export const RecoveryDomainIdSchema = z.enum([
  'TRANSPORT',
  'STAY',
  'TRANSFER',
  'PROGRAMME',
  'SUPPORT_COORDINATION',
  'INFORMATION_RESEARCH',
]);
export type RecoveryDomainId = z.infer<typeof RecoveryDomainIdSchema>;

/** Where a domain's relevance came from. AI suggestions are validated, never trusted. */
export const RecoveryDomainSourceSchema = z.enum(['DETERMINISTIC', 'AI']);
export type RecoveryDomainSource = z.infer<typeof RecoveryDomainSourceSchema>;

/**
 * The registry's deterministic verdict on a domain for the current basis.
 * Fail-closed: anything not INVESTIGATED must carry a reason code so the
 * decision stays explainable in the persisted planning attempt.
 */
export const RecoveryDomainDispositionSchema = z.enum([
  'INVESTIGATED',
  'NOT_APPLICABLE',
  'UNAVAILABLE',
]);
export type RecoveryDomainDisposition = z.infer<typeof RecoveryDomainDispositionSchema>;

/**
 * A deterministic activator's evidence for why a domain is (or is not)
 * relevant to the current failing basis. Activators are pure functions of
 * current canonical state; they never read provider wire data or scenario ids.
 */
export const RecoveryDomainActivationSchema = z.strictObject({
  domainId: RecoveryDomainIdSchema,
  source: RecoveryDomainSourceSchema,
  /** True when the deterministic activator considers this domain relevant. */
  activated: z.boolean(),
  /**
   * Closed-vocabulary capability families this domain would need to research
   * or propose. Empty for evidence-only domains such as INFORMATION_RESEARCH
   * when no capability read is required.
   */
  requiredCapabilities: z.array(z.custom<CapabilityFamily>()).default([]),
  /** Machine-readable reason the domain is relevant / not applicable / unavailable. */
  reasonCode: z.string().regex(/^[a-z][a-z0-9_]*$/).optional(),
});
export type RecoveryDomainActivation = z.infer<typeof RecoveryDomainActivationSchema>;

/**
 * The registry-validated disposition of one domain for a planning basis. This
 * is the shape persisted inside `RecoveryPlanningAttempt.domains`.
 */
export const RecoveryDomainDecisionSchema = z.strictObject({
  domainId: RecoveryDomainIdSchema,
  source: RecoveryDomainSourceSchema,
  disposition: RecoveryDomainDispositionSchema,
  reasonCode: z.string().regex(/^[a-z][a-z0-9_]*$/).optional(),
});
export type RecoveryDomainDecision = z.infer<typeof RecoveryDomainDecisionSchema>;

/**
 * A domain-registry entry declares, deterministically, how a domain becomes
 * relevant and what it needs. The registry is data + pure predicates, not a
 * scenario switch: `isApplicable` receives only current canonical planning
 * context and returns an activation with a closed reason code.
 */
export interface RecoveryDomainDefinition {
  readonly domainId: RecoveryDomainId;
  /** Human-independent capability families the domain may research through. */
  readonly capabilities: readonly CapabilityFamily[];
  /**
   * Whether this domain can ever produce an executable strategy.
   * INFORMATION_RESEARCH is evidence-only (`false`); the others are `true`.
   */
  readonly producesExecutableStrategy: boolean;
  /**
   * Pure deterministic applicability test over current canonical context.
   * MUST NOT branch on traveller/event/scenario identity. An AI-suggested
   * domain is passed through the same predicate and fails closed when the
   * current state does not actually support it.
   */
  isApplicable(context: RecoveryDomainContext): RecoveryDomainActivation;
}

/**
 * The current, canonical, provider-neutral context a deterministic activator
 * may read. Deliberately narrow: failing-subject kinds and their blocking
 * assessment dimension codes, plus which capability families are available in
 * this composition. No names, no fixtures, no scenario ids.
 */
export interface RecoveryDomainContext {
  /** Distinct subject kinds among the case's currently FAILing subjects. */
  readonly failingSubjectKinds: ReadonlySet<string>;
  /** Closed assessment dimension codes that are blocking on those subjects. */
  readonly blockingDimensionCodes: ReadonlySet<string>;
  /** Distinct object kinds the current failure directly touches. */
  readonly affectedObjectKinds: ReadonlySet<string>;
  /** Capability families actually available to this planning composition. */
  readonly availableCapabilities: ReadonlySet<CapabilityFamily>;
  /** Explicit typed request activation, kept separate from failure dimensions. */
  readonly requestedDomains?: ReadonlySet<RecoveryDomainId>;
}

/**
 * Deterministic validation of a registry's activations for one basis. Pure and
 * fail-closed: a domain the AI suggested but the registry does not define, or
 * that is activated without its required capabilities being available, is
 * demoted to UNAVAILABLE/NOT_APPLICABLE with a reason code rather than
 * silently investigated.
 */
export function resolveRecoveryDomainDecisions(
  definitions: readonly RecoveryDomainDefinition[],
  context: RecoveryDomainContext,
  aiSuggested: readonly RecoveryDomainId[] = [],
): RecoveryDomainDecision[] {
  const byId = new Map<RecoveryDomainId, RecoveryDomainDefinition>();
  for (const def of definitions) byId.set(def.domainId, def);

  const decisions: RecoveryDomainDecision[] = [];
  const seen = new Set<RecoveryDomainId>();

  const record = (domainId: RecoveryDomainId, source: RecoveryDomainSource): void => {
    if (seen.has(domainId)) return;
    seen.add(domainId);
    const def = byId.get(domainId);
    if (!def) {
      // An AI suggestion the deterministic registry does not define fails closed.
      decisions.push({ domainId, source, disposition: 'UNAVAILABLE', reasonCode: 'domain_not_registered' });
      return;
    }
    const activation = def.isApplicable(context);
    if (!activation.activated) {
      decisions.push({
        domainId,
        source,
        disposition: 'NOT_APPLICABLE',
        reasonCode: activation.reasonCode ?? 'not_applicable',
      });
      return;
    }
    const missing = activation.requiredCapabilities.filter((c) => !context.availableCapabilities.has(c));
    if (missing.length > 0) {
      decisions.push({ domainId, source, disposition: 'UNAVAILABLE', reasonCode: 'capability_unavailable' });
      return;
    }
    decisions.push({
      domainId,
      source,
      disposition: 'INVESTIGATED',
      ...(activation.reasonCode ? { reasonCode: activation.reasonCode } : {}),
    });
  };

  // Deterministic activations are evaluated for every registered domain first,
  // so the investigated set never depends on AI suggestion order.
  for (const def of definitions) record(def.domainId, 'DETERMINISTIC');
  // AI may only ADD domains the registry can still validate; it cannot reorder
  // or veto a deterministic decision already recorded above.
  for (const domainId of aiSuggested) record(domainId, 'AI');

  return decisions;
}

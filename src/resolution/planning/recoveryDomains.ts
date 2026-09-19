/**
 * NORTHSTAR R1 — deterministic recovery-domain registry (freeze C3 impl).
 *
 * Pure data + predicates over the CURRENT canonical planning context: which
 * domains are relevant is decided exclusively by the closed M6 assessment
 * dimension codes that are actually blocking on the failing subjects, plus the
 * capability families this composition really has. There is no persona, event
 * or scenario branch anywhere — the same registry serves every case, and a
 * domain whose required capability is unavailable fails CLOSED to UNAVAILABLE
 * with a reason code rather than being silently investigated.
 *
 * Dimension codes below are the real evaluator dimensions shipped in
 * src/resolution/evaluation/evaluators (connection, booking, entry, overnight,
 * participation, support, credentials, information) — not invented tokens.
 */
import type { CapabilityFamily } from '../../operational/strategy.ts';
import {
  type RecoveryDomainContext,
  type RecoveryDomainDefinition,
  type RecoveryDomainId,
} from '../../contracts/v2/planning/recoveryDomain.ts';

/**
 * A dimension-scoped reason token (`<dimension>__<reasonCode>`), for the cases
 * where a dimension alone is too coarse to say which recovery lever is relevant.
 * Derived only from the evaluator's own closed reason codes on a failing
 * explanation — never from a scenario. Kept snake_case so it can also serve as a
 * decision `reasonCode`.
 */
export function dimensionReasonToken(dimension: string, reasonCode: string): string {
  return `${dimension}__${reasonCode}`.replace(/[^a-z0-9_]/g, '_');
}

/** Real M6 blocking dimension codes that make movement/fulfilment recovery relevant. */
const TRANSPORT_DIMENSIONS: ReadonlySet<string> = new Set([
  // A programme obligation the traveller cannot reach ready in time is also a
  // movement problem: an earlier arrival is a legitimate recovery lever, to be
  // researched and judged by RC-6 alongside the programme lever.
  dimensionReasonToken('programme_participation', 'insufficient_arrival_readiness'),
  'connection_feasibility',
  'supplier_fulfilment',
  'booking_validity',
  'entry_feasibility',
  'transit_feasibility',
]);

/** Real M6 blocking dimension codes that make ground-transfer recovery relevant. */
const TRANSFER_DIMENSIONS: ReadonlySet<string> = new Set(['connection_feasibility']);

/** Real M6 blocking dimension codes that make overnight-stay recovery relevant. */
const STAY_DIMENSIONS: ReadonlySet<string> = new Set(['overnight_accommodation']);

/** Real M6 blocking dimension codes that make programme-schedule recovery relevant. */
const PROGRAMME_DIMENSIONS: ReadonlySet<string> = new Set([
  'programme_participation',
  'optional_participation',
]);

/** Real M6 blocking dimension codes that make support-assignment recovery relevant. */
const SUPPORT_DIMENSIONS: ReadonlySet<string> = new Set(['support_continuity']);

/** Real M6 blocking dimension codes that make evidence-only research relevant. */
const RESEARCH_DIMENSIONS: ReadonlySet<string> = new Set([
  'advisories',
  'credential_selection',
  'entry_feasibility',
  'transit_feasibility',
]);

function anyBlocking(context: RecoveryDomainContext, dimensions: ReadonlySet<string>): string | undefined {
  for (const code of context.blockingDimensionCodes) {
    if (dimensions.has(code)) return code;
  }
  return undefined;
}

function activator(
  domainId: RecoveryDomainId,
  dimensions: ReadonlySet<string>,
  capabilities: readonly CapabilityFamily[],
  producesExecutableStrategy: boolean,
): RecoveryDomainDefinition {
  return {
    domainId,
    capabilities,
    producesExecutableStrategy,
    isApplicable(context) {
      const matched = anyBlocking(context, dimensions);
      const requested = context.requestedDomains?.has(domainId) ?? false;
      return {
        domainId,
        source: 'DETERMINISTIC',
        activated: matched !== undefined || requested,
        requiredCapabilities: [...capabilities],
        ...(matched !== undefined
          ? { reasonCode: `blocking_${matched}` as const }
          : requested
            ? { reasonCode: 'typed_change_request' as const }
          : { reasonCode: 'no_blocking_dimension_match' as const }),
      };
    },
  };
}

/**
 * The frozen initial registry (freeze §6), in a stable declaration order.
 * Order is NOT priority: `resolveRecoveryDomainDecisions` evaluates every
 * registered domain and the coordinator invokes every INVESTIGATED one.
 */
export function defaultRecoveryDomainRegistry(): RecoveryDomainDefinition[] {
  return [
    activator('TRANSPORT', TRANSPORT_DIMENSIONS, ['FLIGHT'], true),
    activator('STAY', STAY_DIMENSIONS, ['HOTEL'], true),
    activator('TRANSFER', TRANSFER_DIMENSIONS, ['TRANSFER'], true),
    activator('PROGRAMME', PROGRAMME_DIMENSIONS, [], true),
    activator('SUPPORT_COORDINATION', SUPPORT_DIMENSIONS, [], true),
    // Evidence-only domain: never produces an executable strategy, and without
    // the RESEARCH capability it fails closed to UNAVAILABLE.
    activator('INFORMATION_RESEARCH', RESEARCH_DIMENSIONS, ['RESEARCH'], false),
  ];
}

/**
 * Build the deterministic registry context from what the failing subjects'
 * CURRENT assessments actually say. Pure; the coordinator supplies the sets
 * from canonical state, never from model output.
 */
export function recoveryDomainContext(input: {
  failingSubjectKinds: Iterable<string>;
  blockingDimensionCodes: Iterable<string>;
  affectedObjectKinds: Iterable<string>;
  availableCapabilities: Iterable<CapabilityFamily>;
  requestedDomains?: Iterable<RecoveryDomainId>;
}): RecoveryDomainContext {
  return {
    failingSubjectKinds: new Set(input.failingSubjectKinds),
    blockingDimensionCodes: new Set(input.blockingDimensionCodes),
    affectedObjectKinds: new Set(input.affectedObjectKinds),
    availableCapabilities: new Set(input.availableCapabilities),
    ...(input.requestedDomains ? { requestedDomains: new Set(input.requestedDomains) } : {}),
  };
}

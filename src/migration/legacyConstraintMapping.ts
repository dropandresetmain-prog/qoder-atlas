/**
 * M10 — legacy constraint -> target registered constraint type.
 *
 * The legacy model stored a broad `kind` (TEMPORAL/TRANSFER/...) plus free
 * `parameters`, and kept the verdict on the definition. The target requires
 * a *registered* type whose operand contract an M6 evaluator actually
 * implements (`src/resolution/evaluation/constraintTypes.ts`); an
 * unregistered type is reported UNSUPPORTED_EVALUATION, never silently
 * satisfied.
 *
 * Legacy data therefore does not determine a target evaluator on its own. A
 * legacy `kind` is not a registered type, and inferring one from prose in
 * `description` would fabricate evaluator provenance. So this module maps
 * only the legacy constraint forms the legacy engine genuinely implemented —
 * identified by their parameter signature, not by label or scenario — and
 * everything else is quarantined for explicit reconciliation.
 *
 * This is legacy-format mapping in the transform layer, the same category as
 * a provider adapter's field mapping. It must never grow scenario, fixture,
 * traveller, city or supplier specifics.
 */

export interface LegacyConstraintMapping {
  legacyKind: string;
  /** Legacy parameter keys that must all be present and numeric. */
  requiredNumericParameters: readonly string[];
  registeredType: string;
  /** Legacy parameter key -> target operand key. */
  operandFromParameter: Readonly<Record<string, string>>;
  /** Why this mapping is deterministic, recorded on the migration evidence. */
  justification: string;
}

/**
 * The single legacy constraint form with a real implemented evaluator:
 * `src/engine/evaluators.ts` reads `minBufferMinutes` off TEMPORAL
 * constraints and requires the referenced subject to be reachable with at
 * least that many minutes of margin. The target's
 * `programme_arrival_readiness_minutes` (operand `minutes`) is the same
 * assertion under the frozen ontology.
 */
export const LEGACY_CONSTRAINT_MAPPINGS: readonly LegacyConstraintMapping[] = [
  {
    legacyKind: 'TEMPORAL',
    requiredNumericParameters: ['minBufferMinutes'],
    registeredType: 'programme_arrival_readiness_minutes',
    operandFromParameter: { minBufferMinutes: 'minutes' },
    justification:
      'legacy TEMPORAL constraint carrying minBufferMinutes is the arrival-readiness buffer evaluated by ' +
      'src/engine/evaluators.ts; programme_arrival_readiness_minutes is its registered target equivalent',
  },
];

export interface LegacyConstraintShape {
  kind?: unknown;
  hardness?: unknown;
  parameters?: unknown;
}

export type LegacyConstraintResolution =
  | {
      mapped: true;
      registeredType: string;
      hardness: 'HARD' | 'SOFT';
      operands: { key: string; kind: 'NUMBER'; value: number }[];
      justification: string;
    }
  | { mapped: false; reason: string };

/**
 * Resolve a legacy constraint payload to a target registered type, or explain
 * precisely why it cannot be resolved. Never guesses.
 */
export function resolveLegacyConstraint(payload: LegacyConstraintShape): LegacyConstraintResolution {
  const kind = typeof payload.kind === 'string' ? payload.kind : undefined;
  if (kind === undefined) {
    return { mapped: false, reason: 'legacy constraint has no "kind"; nothing identifies a target evaluator' };
  }
  const hardness = payload.hardness === 'HARD' || payload.hardness === 'SOFT' ? payload.hardness : undefined;
  if (hardness === undefined) {
    return {
      mapped: false,
      reason: `legacy constraint "${kind}" has no HARD/SOFT hardness; the target requires it and it must not be assumed`,
    };
  }
  const parameters =
    payload.parameters !== null && typeof payload.parameters === 'object'
      ? (payload.parameters as Record<string, unknown>)
      : {};

  for (const mapping of LEGACY_CONSTRAINT_MAPPINGS) {
    if (mapping.legacyKind !== kind) continue;
    const values = mapping.requiredNumericParameters.map((key) => [key, parameters[key]] as const);
    if (!values.every(([, value]) => typeof value === 'number' && Number.isFinite(value))) continue;
    return {
      mapped: true,
      registeredType: mapping.registeredType,
      hardness,
      operands: values.map(([key, value]) => ({
        key: mapping.operandFromParameter[key] ?? key,
        kind: 'NUMBER' as const,
        value: value as number,
      })),
      justification: mapping.justification,
    };
  }

  const parameterKeys = Object.keys(parameters).sort().join(', ');
  return {
    mapped: false,
    reason:
      `legacy constraint kind "${kind}" with parameter keys [${parameterKeys}] matches no registered target ` +
      'constraint type; inferring an evaluator would fabricate provenance',
  };
}

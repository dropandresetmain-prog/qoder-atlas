/**
 * NORTHSTAR M8 — capability separation for dispatch.
 *
 * M3 semantics: observation capability ≠ servicing capability ≠ authority.
 * Seeing a booking does not imply we can modify it. Unsupported capability
 * yields a structured unavailable / manual escalation path — never fake success.
 */
export type CapabilityKind = 'OBSERVE' | 'SERVICE' | 'BOOK' | 'CANCEL' | 'MODIFY';

export type CapabilityDecision =
  | { ok: true; capabilityKind: CapabilityKind }
  | {
      ok: false;
      reason: 'CAPABILITY_UNSUPPORTED' | 'CAPABILITY_UNKNOWN' | 'AUTHORITY_REQUIRED';
      escalation: 'MANUAL' | 'UNAVAILABLE';
      detail: string;
    };

export function requireProviderCapability(params: {
  required: CapabilityKind;
  observed?: { capabilityKind: CapabilityKind; supported: boolean } | null;
}): CapabilityDecision {
  if (!params.observed) {
    return {
      ok: false,
      reason: 'CAPABILITY_UNKNOWN',
      escalation: 'UNAVAILABLE',
      detail: `no capability observation for ${params.required}`,
    };
  }
  if (params.observed.capabilityKind !== params.required) {
    return {
      ok: false,
      reason: 'CAPABILITY_UNSUPPORTED',
      escalation: 'MANUAL',
      detail: `observed ${params.observed.capabilityKind} cannot satisfy ${params.required}`,
    };
  }
  if (!params.observed.supported) {
    return {
      ok: false,
      reason: 'CAPABILITY_UNSUPPORTED',
      escalation: 'MANUAL',
      detail: `${params.required} is observed as unsupported`,
    };
  }
  return { ok: true, capabilityKind: params.required };
}

/** Observation success never implies servicing authority. */
export function observationImpliesServicing(): false {
  return false;
}

/**
 * M9 — objective disposition authority boundary.
 *
 * No application path may set WAIVED or CLOSED_WITH_LOSS without an authorised
 * typed ActionIntent. Planner proposals remain proposed-only (overlay).
 *
 * Until a durable disposition executor exists behind M8 authority, terminal
 * objective disposition is not exposed on M9 product APIs/UI.
 */
export const TERMINAL_OBJECTIVE_DISPOSITIONS = ['WAIVED', 'CLOSED_WITH_LOSS'] as const;
export type TerminalObjectiveDisposition = (typeof TERMINAL_OBJECTIVE_DISPOSITIONS)[number];

export const OBJECTIVE_DISPOSITION_CAPABILITY = 'internal:objective.disposition';

/** True when a disposition is terminal loss/waiver (requires authorised ActionIntent). */
export function isTerminalObjectiveDisposition(disposition: string): disposition is TerminalObjectiveDisposition {
  return (TERMINAL_OBJECTIVE_DISPOSITIONS as readonly string[]).includes(disposition);
}

/**
 * Product/API surface: refuse direct terminal disposition mutations.
 * Returns a structured denial — never mutates state.
 */
export function denyDirectObjectiveDisposition(input: {
  disposition: string;
  viaAuthorisedActionIntent: boolean;
}): { allowed: true } | { allowed: false; reason: string } {
  if (!isTerminalObjectiveDisposition(input.disposition)) {
    return { allowed: true };
  }
  if (!input.viaAuthorisedActionIntent) {
    return {
      allowed: false,
      reason:
        'OBJECTIVE_DISPOSITION_REQUIRES_AUTHORITY: WAIVED/CLOSED_WITH_LOSS require an authorised typed ActionIntent; direct application mutation is forbidden',
    };
  }
  return { allowed: true };
}

/** M9 product API: terminal disposition endpoints are not exposed. */
export const M9_OBJECTIVE_DISPOSITION_API_EXPOSED = false as const;
